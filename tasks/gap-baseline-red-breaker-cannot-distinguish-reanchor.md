---
id: gap-baseline-red-breaker-cannot-distinguish-reanchor
title: baseline-red 断路器不能区分 re-anchor 与 LOOP DEADLOCK：只比签名、诊断恒写死锁，被红 checker 自身
  exit 0 的信号缺失
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**atom H12**：同签名红 3 轮看似死锁，先看被红 checker 自身 exit 0（是则欠 re-anchor）。

**carrier**：`code`（签名死锁已承载；re-anchor 判别未承载）。

**carrierRef 目标**：`plugin/scripts/worker-fan-in.ts:1529-1559`。

**负臂读数（现在）**：`decideBaselineRedCircuitBreaker` 只比 `signature`；`:1551` 无条件生成 `LOOP DEADLOCK: …` 诊断；`grep -c -E 're-anchor|checkerExit' plugin/scripts/worker-fan-in.ts` = **0**；`BaselineRedRound`（`:1481-1488`）只有 `{task, signature, ts, blocked}`，无 checker exit 字段。

**判据上的关键裁决（必须写进实现）**：re-anchor 信号**不能**从 `BaselineRedRound` 记录或 suite 结果取——它们记录的是**产生红的那一轮**，那一刻 checker 按定义就是非 0，存下来对判别零信息（硬规则 4）。必须**在判定时刻新鲜测量**：cap 命中时对被挡住的 red point 各自的 checker 跑一次（**有界超时**），拿它自己的 exit。

**D 收缩预期**：H12 fresh→stale（⛔ 不作验收）。

## Plan

1. `decideBaselineRedCircuitBreaker` 保持**纯函数**，新增入参 `checkerProbes: Array<{ point: string; exit: number | null }>`（调用方测量后传入）。
2. 判词三态（`CircuitBreakerVerdict` 加 `re-anchor` 分支）。**`checkerProbes` 是被挡住的多个 red point 的数组，必须显式规定聚合**，按下列**优先级**给出**单个顶层判词**（逐 point 结果写进诊断，不另出顶层多值）：
   - **① 任一 `exit === 0`** ⇒ `{ kind: "re-anchor", probes, … }`，诊断逐字写「欠 re-anchor，不是死锁」并点名哪些 point exit 0（只要有一个 red point 已不再红，红集就是陈旧的，死锁不成立）；
   - **② 否则，`probes` 为空 或 任一 `exit === null`** ⇒ `stop-terminal`，但诊断**必须写「未评估」**且 ⛔ **不得出现「LOOP DEADLOCK」**（没测成不等于确认死锁；硬规则 3b）；
   - **③ 否则（全部 `exit !== 0`，且至少一条）** ⇒ `stop-terminal` + 现有 LOOP DEADLOCK 诊断。
   ⛔ 优先级不可调换：`0` 压过 `null`（陈旧已被证实，重锚是安全动作）；空数组按 `null` 处理，不得回落成 ③。
3. 测量侧：在 cap 命中处调用，逐 red point 跑其 checker，**有界超时**（给出上限值并说明依据），⛔ 不得让断路器自己变成卡死点。
4. 纯函数不读盘子；测量与 I/O 留在调用方。

## Acceptance Criteria

- [x] AC1: 正臂 + **聚合优先级**——① 任一点 `exit: 0` ⇒ `kind: "re-anchor"`，诊断含「欠 re-anchor」并点名该 point（**多点混合**用例：一个 0 + 一个非 0 ⇒ 仍为 `re-anchor`）；③ 全部非 0 ⇒ `stop-terminal` 与现有 LOOP DEADLOCK 诊断。两条行为测试，且多点用例单独一条。
- [x] AC2（**null / 空臂单独一条，不得并入 AC1**）: ② 当 `probes` **为空**或含 `exit: null` 且无 `exit: 0` 时，返回 `stop-terminal`，诊断含「未评估」且**不含「LOOP DEADLOCK」**；断言它与 `exit: 0` 的输出**逐字不同形**、与全部非 0 的输出也**逐字不同形**（给出三侧逐字读数）。
- [x] AC3: 新鲜测量与有界超时——给出调用点的测量代码位置、超时上限值、以及「测量失败 ⇒ null 而非抛异常」的负臂读数（注入一个必然超时的 checker）。

## Definition of Done

- 三条 AC 勾选并附逐字读数与可复跑命令。
- `scripts/test.sh --for-task gap-baseline-red-breaker-cannot-distinguish-reanchor` 绿；全量 suite 不回归。
- `CircuitBreakerVerdict` 的三态在类型层面可区分（不是靠字符串判断）；`re-anchor` 的消费者若存在，必须显式处理，⛔ 不得默认落回 stop-terminal 而静默。
- ⛔ 完成证据中不得出现「|D| 下降」。

## Evidence

复跑（唯一入口）：`node --no-warnings --experimental-strip-types --test plugin/test/worker-fan-in-baseline-red.test.mjs`
（它是本任务 Touches 内的测试文件；下「门」段的 `scripts/test.sh --for-task … --allow-thin` 也覆盖它）

### AC1 — 正臂 + 聚合优先级（逐字读数）

- ① 单点 exit 0：`[AC1/①] kind=re-anchor basis=(none) stalePoints=["plugin/test/r2.test.mjs"]`；诊断逐字含 `欠 re-anchor，不是死锁: task T 连续 3 轮撞同一签名` 与 `Stale red points (此刻已不再红): plugin/test/r2.test.mjs.`，且断言 `diagnostic.includes("LOOP DEADLOCK") === false`。
- ① **多点混合（单独一条测试）**：`[AC1/① multi] mixed kind=re-anchor stale=["plugin/test/r2.test.mjs"] | both-nonzero kind=stop-terminal basis=confirmed-deadlock`（一个 0 + 一个非 0 ⇒ 仍为 re-anchor；同一条测试把两臂都翻成非 0 ⇒ 落回 ③，作为聚合顺序的负控）。
- ③ 全部非 0：`[AC1/③] kind=stop-terminal basis=confirmed-deadlock`，诊断逐字以 `LOOP DEADLOCK: task T has been blocked by the SAME pre-existing red set for 3 consecutive fan-in rounds (signature unchanged across rounds). Blocked red points: plugin/test/r2.test.mjs.` 开头，并保留 `Suggested resolution` / `NOT relaxed`。

### AC2 — null / 空臂（单独一条测试，三侧逐字读数）

- exit-0 侧：`欠 re-anchor，不是死锁: task T 连续 3 轮撞同一签名，但判定时刻新鲜重测发现已有点不再红 (checker exit 0 ⇒ 记录的红集陈旧，死锁不成立). Probed at decision time: plugin/test/r2.test.mjs=exit 0. …`
- null 侧：`未评估（not evaluated）: task T 连续 3 轮撞同一签名，但「这些 red point 此刻是否仍然红」没测成 ⇒ ⛔ 不判定为死锁。Probed at decision time: plugin/test/r2.test.mjs=未评估. 无法获得读数的 red point: plugin/test/r2.test.mjs（超时 / 项目未声明 rerun 命令 / 命令读不懂 / 进程起不来）。 …`
- 全部非 0 侧：`LOOP DEADLOCK: task T has been blocked by the SAME pre-existing red set for 3 consecutive fan-in rounds …`
- 空数组侧（成因与 null 可分，⛔ 不并成同一句）：`未评估（not evaluated）: … Probed at decision time: (没有可探测的 red point). 没有可探测的 red point（记录里没有归因到任何文件）——停派，但没有「仍然红」的读数。 …`
- 断言：null / 空两臂 `kind === "stop-terminal"` 且 `basis === "not-evaluated"`、诊断含「未评估」、`includes("LOOP DEADLOCK") === false`；`assert.notEqual` 三条（null vs exit-0、null vs 全部非 0、empty vs null）**逐字不同形**；`0` 压过 `null`（`[0, null]` ⇒ `re-anchor`）。

### AC3 — 新鲜测量与有界超时

- 测量代码位置：`plugin/scripts/worker-fan-in.ts:1700 probeBlockedRedPoints`（逐 point 解析项目声明的 checker 并调用 `runCheckerProbe`）、`:1675 runCheckerProbe`（`spawnSync` + `timeout` + `killSignal:SIGKILL` + `detached` 成组后补 `process.kill(-pid)` 清孙进程）、调用点 `:1746`（`baselineRedDeadlockReading` 里**只有连续轮数够 cap** 才测量）。
- 超时上限值（三重量）：`CHECKER_PROBE_TIMEOUT_MS = 90_000`（逐点，`:1652`）、`CHECKER_PROBE_MAX_POINTS = 3`（`:1655`）、`CHECKER_PROBE_TOTAL_BUDGET_MS = 180_000`（总预算，`:1660`）。依据：checker = 项目自己声明的 `loop.rerun_command`（本仓库 = `bash {worktree}/scripts/test.sh {files}`，该入口带 ~25s 固定静态检查开销、单文件实测 32s）⇒ 90s ≈ 2.8× 余量；总预算把 `3 × 90s` 的理论上限压到 180s（断路器跑在 driver 的**同步**终态记账路径上，必须有上界 ⇒ ⛔ 不让判定本身变成卡死点）。超预算/超点数的 point 一律 `exit: null`（未评估），⛔ 不截断成「仍然红」。
- 负臂读数（注入必然超时的 checker `bash -c "sleep 30"`，上限 200ms）：`[AC3] timeout-injected: [{"point":"plugin/test/r2.test.mjs","exit":null},{"point":"plugin/test/r3.test.mjs","exit":null}] wall=403ms verdict=stop-terminal/not-evaluated | exit7=[{"point":"plugin/test/r2.test.mjs","exit":7}] | capped=[0,null,null] | re-anchor-on-exit0=re-anchor` —— 两个点各 200ms 实际总耗时 403ms（有界生效）、返回 `null` 而非抛异常；同一缝的正控 `exit 7` ⇒ `exit:7`、`exit 0` ⇒ `re-anchor`（证明不是恒 null 的读数）。

### DoD

- 门：`bash scripts/test.sh --for-task gap-baseline-red-breaker-cannot-distinguish-reanchor --allow-thin`（worktree，已 `merge develop` 后）⇒ `ℹ tests 184 / ℹ pass 184 / ℹ fail 0 / ℹ duration_ms 36842`，exit 0。
- 类型层三态：`CircuitBreakerVerdict` = `continue | stop-terminal{basis} | re-anchor` 的可辨识联合（判别式 `kind`）；`stop-terminal` 内部再用 `basis: "confirmed-deadlock" | "not-evaluated"` 区分，代码里⛔ 没有任何一处靠 `diagnostic` 文本分支。
- `re-anchor` 的消费者**显式处理**：`plugin/scripts/worker-driver.ts:6273` 独立分支——落 `exited_not_landed_stops`（`kind:"re-anchor"`）+ json 事件 `baseline-red-reanchor` + 读数写 `{kind:"continue"}`（走既有 count-and-retry 重派路径，⛔ 不 park），⛔ 不是「没匹配上 stop-terminal 就静默落回」。
- ⛔ 本条不作「|D| 下降」一类结论（D 收缩预期明确标注不作验收）。

- 该轴仍暗,理由:本任务只在 worker-fan-in.ts 内新增一个判定分支与一个测量助手、在 worker-driver.ts 加一个消费分支，未新增/移动模块或跨包依赖边，L_D/L_G 无可比 delta，本轮未取 ArchGuard 读数

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-fan-in-baseline-red.test.mjs
- tasks/gap-baseline-red-breaker-cannot-distinguish-reanchor.md
