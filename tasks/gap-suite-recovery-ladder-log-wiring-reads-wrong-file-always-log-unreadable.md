---
id: gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable
title: 恢复阶梯每档读错日志——argv 的 --log-file 未按档改写，classifyRecoveryRound 恒
  log-unreadable，即便该档其实完整零 OOM
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
depends_on:
  - gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
---
## Proposal

**发现于本会话的只读 fan-in 错误审计（2026-10-15），当场复核仍在实时发生**：`gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`（done，14/14 AC）落地的 OOM/incomplete 低并发恢复阶梯，在生产上**结构性失能**——它从未真正证实过一档恢复轮的完整绿，即便那一档其实是干净、完整、零 OOM 的。

**查重结果**：全库搜索 `recoverySuiteCommand`/`classifyRecoveryRound`/`recLogFile`/`log-unreadable` 等字面量，命中的任务只有 `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`（落地该机制的原任务）与下游引用它的 `gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls`（`needs-human`，其阻碍记录里把本缺陷列为"不在自己 diff 里"的真因之一）。**没有任何现有任务把本缺陷本身登记为独立的修复对象**，故本任务是新建，不是重复。

**实测根因（当场复核，行号为本次读取时的真实行号）**：
1. `worker-fan-in.ts:1958`：主轮给 `full-suite-runner.ts` 的 argv 里带 `--log-file <suiteLogFile>`。
2. `worker-fan-in.ts:879-883`：`recoverySuiteCommand(base, n)` 只做 `[...base, "--lane-count", String(n)]`——**原样保留 `base` 里那个 `--log-file <suiteLogFile>`，没有把它替换成本档自己的日志路径**。
3. `worker-fan-in.ts:2930-2934`：恢复轮另起一个 `recLogFile`（命名形如 `recovery-${n}-${suffix}`）传给 `spawnSuiteAndWait`，但那只是外层 wrapper 捕获 `child.stdout` 的落点。
4. `suite-driver.ts:204-205`：`spawnSuiteAndWait` 只把 `child.stdout` tee 进它拿到的 `logFile`；而 `full-suite-runner.ts` 真正的 `SUITE-PLAN`/`__PERFILE__` 结构化输出是按**自己 argv 里的 `--log-file`**（仍是原始 `suiteLogFile`，被每一档依次覆写）直接写文件的，不经过 stdout。
5. `classifyRecoveryRound`（`worker-fan-in.ts:827`，缺省分支在 836 行落 `"log-unreadable"`）读的是那个几乎空的 `recLogFile`，永远读不到真内容 ⇒ 每一档恒 `no-conclusion(log-unreadable)`。

**真实生产实例（今天，2026-10-15，三个独立任务各命中 ≥1 次）**：
```
gap-routine-...-list-script-basenames...: round 2715(lane48,red/failed,584/584,oom=1) → round 2716(lane32,red/aborted,584/584,oom=0)
  fan-in 仍判：suite-recovery×3 "log-unreadable" → suite-recovery-blocked "no declared rung produced a complete verdict"
gap-routine-...-defaultroot-byte-identical-quad...: round 2719(lane48,red/failed,583/583,oom=1) → round 2720(lane32,red/failed,583/583,oom=0)
  fan-in 仍判：同上三连 "log-unreadable" → exhausted
```
`verification-round.jsonl` 自己的记录（由 runner 独立写，不经过本缺陷读的那份日志）证明：floor 档（32）在两个案例里都是**完整、零 OOM 的真实结论**（一个是遗留进程误判 aborted，一个是真实断言失败）——不是"读不到结论"，是分类器读错了文件。三个任务各烧掉 3 次满量重跑（每次约 5 分钟）后 `exited-not-landed`。

## Plan

1. 修复 `recoverySuiteCommand`（或其调用点）：每一档恢复轮必须让 `full-suite-runner.ts` 自己的 `--log-file` 参数指向**该档专属的** `recLogFile`，而不是原样沿用 `base` 里的原始路径——实现时先确认当前 `recoverySuiteCommand` 签名是否该接收 `recLogFile` 作为参数来替换 argv 里的 `--log-file` 值,而不是仅由调用方另传一个 `logFile` 给 `spawnSuiteAndWait`（两件事当前被当成同一件事,实际不是）。
2. `classifyRecoveryRound` 的判定来源改为读**该档自己真正写入的那份结构化日志**（即 runner argv 里 `--log-file` 真正指向的文件），不是 `spawnSuiteAndWait` 的 stdout 捕获文件——或者如果两者语义上应当是同一个文件,则要让 argv 覆盖生效,使 runner 真的把结构化输出写进调用方期望读取的那个路径。
3. 不改变现有「某档确实读不到/确实没跑完」时报 `log-unreadable`/`no-conclusion` 的语义——那条路径本身是对的（见硬规则 3b：无法评估要显式说明），本任务只修"明明有真实结论、却被误判为读不到"的那一半。
4. 负控制：构造一个真实完整、零 OOM 的恢复档（fixture 或对真实 `full-suite-runner.ts` 做最小规模调用），证明修复前它被误判 `log-unreadable`，修复后能被正确读出其真实 `planned/terminal/oomKill` 结论。
5. 保留现有判据不变：不放宽/不忽略真正的 OOM 计数，不放宽 `missing==0`/`oomKill==0`/完整阶段的认证门槛（AC10-14 的既有语义继续生效），不提高 16GiB `MemoryMax` 上限。
6. **验证方式按本次授权收窄**：在隔离 worktree 内对 `worker-fan-in.ts`/`suite-driver.ts` 相关单测跑**定向/受限范围**验证（`scripts/test.sh --for-task <this task>` 的 scoped 门禁 + 直接运行受影响的单测文件），**不要求触发一次昂贵的全量 `scripts/test.sh` 跑**，不部署，不重启任何生产/共享服务。

## Acceptance Criteria

- [x] AC1: 在实现前重新核对当前 `recoverySuiteCommand`/`classifyRecoveryRound`/`spawnSuiteAndWait` 的真实代码（粘贴核对结果，含行号）——确认 Proposal 里描述的"argv 里的 `--log-file` 未被替换"这一现状在实现时仍然成立。**核对结果（`git show c94783e0e:plugin/scripts/worker-fan-in.ts`，基线 = 本 worktree 分叉点）**：`:879-883` 逐字为 `export function recoverySuiteCommand(base: string[], n: number): string[] | null { const isRunner = …; if (!isRunner) return null; return [...base, "--lane-count", String(n)]; }` ⇒ **`--log-file` 原样沿用，现状成立**；`:2920` `const recArgv = recoverySuiteCommand(suiteCmd, n);`、`:2930` 才另起 `recLogFile`、`:2932` `spawnSuiteAndWait({…, logFile: recLogFile, …})`、`:2934` 读它、`:2939` `classifyRecoveryRound(rec, recLog, n, worktree)`；`classifyRecoveryRound` 缺省分支 `:836` 落 `"log-unreadable"`；`suite-driver.ts:204-205` `fs.createWriteStream(logFile,{flags:"a"})` + `child.stdout?.on("data", …)`（**只 tee stdout**）；`full-suite-runner.ts:2227` `path.resolve(flagValue(argv,"--log-file") ?? …)`、`:4155-4157` `fs.appendFileSync(logFile, SUITE-PLAN …)`，且**全文件零 `process.stdout.write`**。⇒ Proposal 五条逐条成立，非静态抄录。修复后：`recoverySuiteCommand` 在 `:919`（三参），调用点在 `:2968-2969`（`recLogFile` 先于 argv 定下来）。
- [x] AC2: 恢复轮的每一档都读到**自己真实写出的日志**，不再混用原始轮/其它档覆写过的文件。**证据**：`retargetLogFile`（`worker-fan-in.ts:875-893`）**就地替换** argv 里的 `--log-file`（⛔ 非追加——runner 用 `flagValue` = `argv.indexOf`，取**第一份**），且 `recLogFile` 在调 `recoverySuiteCommand` **之前**生成 ⇒ 同一个路径同时是 (a) runner argv 的 `--log-file`、(b) `spawnSuiteAndWait` 的 stdout tee/看门狗 mtime 观察对象、(c) `classifyRecoveryRound` 的读取对象。集成证据（`full-suite-runner-oom-policy.test.mjs`，绿）：AC10/AC11 断言该轮 argv 的 `--log-file` 命中 `/recovery-48-/` 且 `≠ suiteLogFile`，且 `argvTokensOf(argv)` **不含**原轮路径；AC13(a) 断言两档（48、32）各自 argv 里的 `--log-file` 尾号分别是 `recovery-48-`/`recovery-32-` 且 `new Set(...).size === 2`（**两档不共用一份**）；AC2/AC3/AC4 断言修复后的档写完后 `!fs.existsSync(originalLog)`（⛔ 一个字节都不再落进原轮那份）。
- [x] AC3: 负控制——构造一个真实完整、零 OOM 的恢复档，修复前验证它被误判 `log-unreadable`，修复后同一档被正确读出 `planned==terminal`、`oomKill==0` 的真实结论。**修复前（真实代码路径，单 token 变异）**：把 `recoverySuiteCommand` 的 `return [...retargetLogFile(base, recLogFile), …]` 临时改回 `return [...base, …]`（其余逐字不动，含接线守卫），跑真实 fan-in 集成测试（`--test-name-pattern="AC10/AC11"`）⇒ `✖ fail 1`，`actual: 'red'` / `expected: 'landed'`，reason 逐字为：`step=suite reason=oom-killed (4) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts` —— 与生产实测「no declared rung produced a complete verdict」**同形**。恢复修复后该测试绿（`outcome: landed`，认证读数 `planned=579 terminal=579 missing=0 oomKill=0 @48`）。**定点控制（`AC2/AC3/AC4` 测试，绿）**：同一个完整零 OOM 的档，修复前那条 argv ⇒ `kind="no-conclusion"`、`reason="log-unreadable"`，**而盘上真的躺着一份** `SUITE-PLAN … planned=579 terminal=579 missing=0 … oomKill=0`（断言该正则命中原轮那份）；换由真函数给出的 argv ⇒ `kind="certified"`，`{planned:579, terminal:579, missing:0, oomKill:0}`。
- [x] AC4: 一个真正读不到/真正没跑完的档，修复后仍然正确报 `log-unreadable`/`no-conclusion`。**证据**：`AC2/AC3/AC4` 测试第三臂 —— 照抄真 runner 契约的假 runner **什么都不写**（`writes:false`），独立退出 0 ⇒ `classifyRecoveryRound` 仍判 `kind="no-conclusion"`、`reason="log-unreadable"`（⛔ 没有被折进 `certified`）。既有语义分支（`run.hungByWatchdog` / `run.spawnFailed` / 空日志）逐字未改。
- [x] AC5: 既有 AC10-14 的判据语义不变：不放宽 `missing==0`/`oomKill==0`/完整阶段的认证门槛，不把 OOM/unknown/缺失记录混进 `runBaselineEquivalence` 的比较集合。**证据**：本 diff `git diff develop --stat` 只有 `plugin/scripts/worker-fan-in.ts` + `plugin/test/full-suite-runner-oom-policy.test.mjs` 两个文件；`SUITE_RECOVERY_CONCURRENCY_LADDER`(64/48/32)、`recoveryConcurrencySteps` 三态、`classifyRecoveryRound` 四分形状、`suiteRecoveryFloor`、`runBaselineEquivalence` 的**形状闸**（只有 `complete-red` 带 `failures`）逐字未改，`suite-driver.ts` **零改动**（Touches 里声明但未触碰）。测试证据：scoped 门禁（下）`ℹ tests 43 / pass 43 / fail 0`，其中含 `✔ AC12 unit — the recovery reading is a FOUR-WAY SHAPE …`、`✔ AC10/AC11 …`、`✔ AC13(a) …`、`✔ AC13(b) …`、`✔ AC12 — a COMPLETE-but-red recovery …`（"an OOM/missing record never reaches the signature comparator"），以及既有 `✔ AC8 — a round whose scope really OOM-killed processes is NEVER green …`、`✔ AC9 — unreadable memory telemetry is recorded as unknown, ⛔ never 0`。
- [x] AC6: `.quay/config.yml` 等预算/内存上限（16GiB `MemoryMax`）未被本任务改动。**证据**：`git diff develop --name-only` = 2 个文件（上面的 worker-fan-in.ts + 测试文件），`.quay/config.yml` 与 `packages/quay/src/systemd-scope.ts`（MemoryMax 策略正本）**均无 diff**（`git diff develop -- .quay/config.yml packages/quay/src/systemd-scope.ts` 空输出）；`.quay/config.yml` 由 `worktree-include.sh` 从主检出复制，本会话未编辑。
- [x] AC7: `scripts/test.sh --for-task <this task>` 的 scoped 门禁绿；未触发全量 `scripts/test.sh`。**证据**：`bash scripts/test.sh --for-task gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable --allow-thin` ⇒ `[exited with code 0]`，尾部逐字：`ℹ tests 43 / ℹ suites 0 / ℹ pass 43 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0 / ℹ duration_ms 33934.800583`（跑的是 change-relevant 静态子集 + Touches 选出的测试集：`full-suite-runner-oom-policy.test.mjs`、`suite-driver.test.mjs`、`worker-fan-in.test.mjs`）。本会话**未**触发全量 suite（按人 2026-10-15 裁定收窄）。附带：`node --no-warnings --experimental-strip-types --test` 直接跑受影响的 oom-policy 文件恢复子集 ⇒ `✔ 7 / ✖ 0`；`npx tsc --noEmit -p tsconfig.json` ⇒ `tsc exit=0`；`anti-drift-touches-check.ts` ⇒ `ANTI-DRIFT OK — 2 actual file(s), all within declared Touches (5 glob(s))`。

## Definition of Done

- AC1-7 均带真实或受控 fixture 粘贴证据勾选。
- 不部署、不重启任何生产或共享服务（含 ClaudeCodeUI 的 anchor/driver），不触碰主机资源配置或预算。
- 现有测试覆盖与门禁未被削弱；不忽略/屏蔽任何 leak 或 OOM 判定。

## Touches
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/suite-driver.ts
- plugin/test/worker-fan-in.test.mjs
- plugin/test/suite-driver.test.mjs
- plugin/test/full-suite-runner-oom-policy.test.mjs

## Blocker

**2026-10-15T06:48:07.378Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (1) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：85af2db5-c09e-4757-84e2-08f0fdf9aab0
