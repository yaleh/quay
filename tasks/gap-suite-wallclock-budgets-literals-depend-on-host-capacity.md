---
id: gap-suite-wallclock-budgets-literals-depend-on-host-capacity
title: 负载敏感测试钉死墙钟预算——字面阈值只在「当前机器产能」下成立，满载必红（3 本：observation AC1 /
  worker-driver-resident AC1·AC3 / ts-typecheck-gate 接线）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`gap-load-sensitive-tests-read-live-host-class-level-seam` 的 AC5 五本处置表——那本收口的是「测试读**宿主读数**」这一类；本条是它的**兄弟机制**：量不是「读到的一个值」，而是**经过的墙钟时间**。⇒ seam（把宿主读数注入）**套不上**：注入时钟只会把断言变成空转（用假时钟测性能＝什么都没测），所以必须另立案。

**三个实例（实测读数取自 `.quay/verification-round.jsonl`，2026-09-13 核）**：

| 文件 | runs/fails | 失败率 | 妨害的不同任务数 | 钉死的量 |
|---|---|---|---|---|
| `packages/quay/test/observation.test.mjs` | 701 / 25 | 3.57% | 15 | AC1 冷请求 <3s / 预热 <500ms（实测红时 32.4s～65.2s） |
| `plugin/test/worker-driver-resident.test.mjs` | 611 / 17 | 2.78% | 13 | AC1/AC3 的 `waitFor(…, 10000)` |
| `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` | 532 / 5 | 0.94% | 5 | M63 D1 跑真 ts-typecheck 门（`.quay/config.yml` `timeoutMs` 120000） |

**共同的形态（硬规则 4 推论二）**：这三个字面量之所以「合理」，只因为它们**恰好**匹配当前这台 16 核机器的产能。换一台更忙的机器，它们就静默变成真限制，而且没有任何检查会报出来——报出来的是**受害任务的套件轮**。

**「再抬一次数字」已经被走过，且没按住**：`observation` 的阈值由人 2026-09-01 裁定从 1.5s/200ms 放宽到 3s/500ms（`gap-observation-ac1-perf-threshold-relax`，done），**放宽后仍 25 次红**；`worker-driver-resident` 的 `waitFor` 已从 5000 抬到 10000（见该测试体内注释），**仍红**；ts-typecheck 门的 `timeoutMs` 已从 60000 抬到 120000（`.quay/config.yml:95-98` 的注释自己写着「~25s 隔离 / >60s 满载」），**仍红**。⇒ 本条的修法**不得**是第三个数字。

## Plan

1. 逐处判断该断言**真正要守的性质**：
   - `observation` AC1 的真性质是「冷请求**不付全量历史遍历**」——这是结构性质，可用 instrument 计数（请求路径上是否发生了全量 walk/子进程数）直接量表示，⛔ 不该用墙钟代理；
   - `worker-driver-resident` AC1/AC3 的真性质是「常驻循环**最终**会派发第二个」——`waitFor` 的上限是防挂死的安全网，不是断言本身，可改成读宿主的推导值或直接去掉上限（由循环停条件收口）；
   - ts-typecheck 门是**真接线检查**（跑真 `npx tsc --noEmit`），其 `timeoutMs` 必须至少按宿主核数与实测基线推导，⛔ 不是再写一个更大的字面量。
2. 每一步的取值来源必须写成**读宿主**（`nproc` / 同轮同 N 的前后对照基线 / instrument 计数），⛔ 禁裸字面量。
3. 硬规则 5b：本条是**类级**收口，落完一处后 grep 同形态（`waitFor(..., <数字>)` / 裸墙钟阈值）的兄弟实例，把命中数与前 3 条贴进提交。

## Acceptance Criteria

- [x] AC1（字面量零残留，⛔ 非布尔）：三处的裸墙钟字面量全部消除，且每处都能指出新取值的来源量（读哪个宿主量 / 哪个同轮基线）。判据：`git diff` 中不再出现「依赖宿主产能的裸数字阈值」，并在提交信息里逐处写出取值来源。✅ 三处**取值来源**：①`observation` = **instrument 计数**（新增 `getDevelopRefFullWalkCount()` / `getDevelopRefBoundedWalkCount()`，`packages/quay/src/observation.ts` 的 `fullBuild()` / 增量分支各 +1）；②`worker-driver-resident` 9 处 waitFor = **宿主当下抢占读数** `/proc/loadavg`(1m) ÷ `availableParallelism()`（`hostContentionFactor()`，每次调用重读）× base（base 只表达「不被抢占时该操作需要多久」）；③ts-typecheck 门 = **本 workspace 在 `.quay/config.yml` 为该门声明的 deadline**（`readGatesConfig` 读同一份配置项，实测 120000）× 同一抢占因子（空载因子=1 ⇒ 与配置逐字相同，⛔ 未放宽阈值）。复跑谓词 `grep -nE "assert\.[a-z]+\(.*(ms|Ms|MS) [<>]|[<>] *[0-9]{3,}|for \(let i = 0; i < [0-9]{3,}"` 对三处命中 **2**，两条**都是注释**（在描述「旧判据是什么」），可执行字面量 0。⚠️ 5b 另在**同文件内**查出一处兄弟实例（内联 `for (i<1000)` + `sleep(20)` = 固定 20s 墙钟）并一并收口（见提交 `78e06567b`）。
- [x] AC2（双向对照，可取假）：三处各在①近空载 ②人为制造满载（load ≥ nproc）两种条件下各跑 ≥3 次并落盘 `.quay/wallclock-budget-evidence.jsonl`。判据：两种条件下**判定一致**，每条读数带 `condition` `passed` `durationMs`。✅ **18/18 全绿、两种条件判定一致**（每条带 `condition`/`passed`/`durationMs`/`budget`/`host`/`load`）：observation 近空载 40.6/40.9/39.6s、满载 55.5/56.7/58.8s；worker-driver-resident 近空载 97.6/111.1/54.5s、满载 66.1/79.0/78.3s；ts-typecheck-gate 近空载 9.2/10.2/8.0s、满载 19.3/16.0/15.3s。满载条件实测 loadavg **20.3–38.3（≥ nproc=16）**，此时推导值随之变长（waitFor 15s→19.5–35.9s；ts-typecheck 120s→252.8/259.2/265.5s）而受护判定不变。⚠️ 条件 A 非字面空闲（共享宿主，其余 quay 循环的 ambient load 5.7–38.3）——逐条读数带**真实** loadavg，未美化。
- [x] AC3（可告伪，防空转）：人为把宿主推导值压到极小 ⇒ 对应用例必须**红**。判据：干跑一次，退出码非 0，命令与输出尾部贴进读数段。✅ 两处各一次（evidence `kind=AC3`）：①`QUAY_TEST_HOST_BUDGET_SCALE=0.0001 node --test packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` ⇒ **exit 1**，尾部 `AssertionError: expected pass against this repo's real workspace; got reason=acceptance timed out after 24ms (killed)`（⇒ 推导出的 24ms 确被 runner 消费）；②同法跑 `--test-name-pattern="AC1 — resident loop does not exit"` ⇒ **exit 1**，尾部 `AC1: two sequential selections — the resident loop kept going after the first`。⛔ 不是「压到极小仍绿」。
- [x] AC4（结构量替代代理量，⛔ 非布尔）：`observation` AC1 的「不付全量遍历」改用可读产物（instrument 计数）。判据：附**一次回退干跑**——把优化回退后该计数必须变化，证明它确能取假（硬规则 4）。✅ evidence `kind=AC4`：把 `serve-task.ts:68` 的 `{ cacheOnly: true }` 去掉（= 回退优化）⇒ `node --test --test-name-pattern="AC1 — a COLD" packages/quay/test/observation.test.mjs` **exit 1**，尾部 `AC1: a COLD request spawned 1 full tasks/ history walk(s)`（计数 **0→1**）。干跑后 `git checkout -- packages/quay/src/serve-task.ts` 已还原，该文件 `git status` 为空。另附非空转保证：AC1 同时要求冷请求建出 1500 条 status 面（零 walk ≠ 什么都没做）、且 refresh 必须真产生 ≥1 次 full walk（否则「冷请求 0 次」恒真）。
- [x] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后三本的 `perFile` 失败率下降。判据：给出五元读数（落地时刻 / 落地前 runs·fails / 落地后窗口 runs·fails / 窗口长度 / 不同任务数），落地后窗口 runs < 20 ⇒ 记 not-evaluated 并写明 runs 数。⚠️ **not-evaluated（落地后窗口 runs = 0 < 20）**：落地前 observation 703/25（3.56%，末次失败 2026-09-09T16:31:48Z，妨害 15 个任务）/ worker-driver-resident 612/17（2.78%，2026-09-09T13:12:29Z，13）/ ts-typecheck-gate-config-wiring 533/5（0.94%，2026-09-09T19:47:41Z，5）；落地时刻 = 本任务 fan-in（在本 worker 退出后由 driver 执行）；窗口长度 0 ⇒ 落地后 runs = 0。⛔ 不用「0 次失败」宣告修好。复评法：fan-in 后从 `.quay/verification-round.jsonl` 取该文件 `perFile`、窗口限定在落地提交时刻之后，runs ≥ 20 再判。

## Definition of Done

- 三处不再有「依赖宿主产能的裸字面预算」；每处的取值来源可指认。
- `.quay/wallclock-budget-evidence.jsonl` 含 AC2 的真实双向读数；AC4 的干跑读数在案。
- ⛔ 本条**不新增**比现状更松的阈值（第三次数值放宽＝未达成）。
- ⛔ 本条**不动**泳道机制（`gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in` / `gap-serial-lowconc-reclassify-post-waterline-cap` 的范围）。

## Evidence（AC1–AC5；原始读数 21 条在 `.quay/wallclock-budget-evidence.jsonl`）

**改了什么 / 三处取值来源**（提交 `fc22c625f` + `78e06567b`，逐处来源写在提交信息里）：

1. `packages/quay/src/observation.ts` + `packages/quay/test/observation.test.mjs`——AC1 从
   「`coldMs < 3000` / `warmMs < 500`（宿主产能代理）」换成「请求路径 full-walk **计数** = 0」；
   冷/热两态改用 cache 空 vs 满 1500 区分；AC2 的 `incrMs*5 < fullMs` 比值判据（实测 load 23.9 下
   自己先红）换成走的是哪一类 walk（full 1 次 / bounded 1 次）。
2. `plugin/test/helpers/worker-driver-harness.mjs` + `plugin/test/worker-driver-resident.test.mjs`——
   `waitFor(fn, base)` 的预算 = base × `hostContentionFactor()`，每次调用重读宿主读数；
   9 处显式 ms 参数删除（含一处内联 `for (i<1000)`+`sleep(20)`）。
3. `packages/quay/test/ts-typecheck-gate-helpers.mjs` + 同族三个 `*.test.mjs`——deadline = 该门在
   `.quay/config.yml` 声明的 `timeoutMs` × 同一因子；node:test 的 `{ timeout }` 与 runner 的
   `QUAY_ACCEPTANCE_TIMEOUT_MS` 同取该值（另两个文件是 5b 查出的兄弟实例）。
4. 新机件 `plugin/test/helpers/host-budget.mjs`（`hostLoadAvg1` / `hostCores` / `hostContentionFactor` /
   `hostScaledMs` / `hostGateDeadlineMs` / `hostBudgetSource`；告伪缝 `QUAY_TEST_HOST_BUDGET_SCALE`）。

**AC2 双向对照**（18 条，两种条件判定一致，全部 rc=0）：

| site | 近空载 duration（loadavg） | 满载 duration（loadavg ≥ 16） |
|---|---|---|
| observation | 40.6 / 40.9 / 39.6s（15.4 / 10.2 / 7.4） | 55.5 / 56.7 / 58.8s（20.3 / 22.0 / 25.5） |
| worker-driver-resident | 97.6 / 111.1 / 54.5s（38.3 / 14.2 / 10.0） | 66.1 / 79.0 / 78.3s（20.8 / 23.3 / 26.5） |
| ts-typecheck-gate | 9.2 / 10.2 / 8.0s（8.9 / 11.8 / 12.7） | 19.3 / 16.0 / 15.3s（33.7 / 34.6 / 35.4） |

满载条件下推导值随宿主变长而判定不变：waitFor 15s→19.5/21.8/24.8s（2× 同理）；
ts-typecheck deadline 120s→252.8/259.2/265.5s（空载时严格 = 配置的 120000，未放宽）。
⚠️ **条件 A 不是字面空闲**：这是共享宿主，其余 quay 循环带来 ambient load 5.7–38.3；条件 B 由
`nice -n 19` 的 burner × nproc 叠加，实测 loadavg 20.3–38.3（≥ nproc=16）。两种条件的 loadavg
差异真实（如 worker-driver-resident 的 10.0 vs 26.5），未挑选读数。

**⛔ 附带发现（不归因于本改动，AC5 复评要分开看）**：ts-typecheck-gate-config-wiring 那 5 次历史失败里，
**2 次是 4.6s / 7.9s 的快速失败**（`.quay/verification-round.jsonl` round 1449 load 16.45 / round 1418
load 24.22），**不是超时**——同轮 `ts-typecheck-gate-pass` / `ts-typecheck-gate-cli-event` 也一起红，
指向另一条机制（疑似并发资源，如共享 node_modules 上的 tsc 竞争/OOM）。本改动只收口 deadline 那一条
路径，**快速失败那类未处理**。

**硬规则 5b 兄弟实例枚举**（谓词与命中数进提交信息）：(a) `}, { timeout: NNNNN });` 命中 3，全在
`packages/quay/test/delivery-standalone-smoke-gate.test.mjs`；(b) `waitFor(..., <数字>)` 命中 26
（`worker-driver.test.mjs` 2 / `worker-driver-fan-in.test.mjs` 24）——已由 harness 类级改动覆盖
（数字降级为 base）；(c) 带 ms 字面量的墙钟断言命中 4 个文件，前 3 条：`gap-webui-goal-task-rollup-
via-shared-summary-cache.test.mjs:301` `assert.ok(hitP50 <= 2000, ...)`、`full-suite-runner-phases.test.mjs:708`
`assert.ok(rec.lock_wait_ms < 5000, ...)`、`quality-gate-driver.test.mjs:498`（注释里的 1500ms judge）。
(a)(c) 不在本条 Touches，**未修，仅报**。

**落地口径**：分支 `task/gap-suite-wallclock-budgets-literals-depend-on-host-capacity`，提交
`fc22c625f`（三处）+ `78e06567b`（5b 同文件兄弟实例）；`scripts/test.sh --for-task
gap-suite-wallclock-budgets-literals-depend-on-host-capacity --allow-thin` 绿。

## Touches

- tasks/gap-suite-wallclock-budgets-literals-depend-on-host-capacity.md
- packages/quay/test/observation.test.mjs
- plugin/test/worker-driver-resident.test.mjs
- packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs
- packages/quay/src/observation.ts
- plugin/test/helpers/host-budget.mjs
- plugin/test/helpers/worker-driver-harness.mjs
- packages/quay/test/ts-typecheck-gate-helpers.mjs
- packages/quay/test/ts-typecheck-gate-pass.test.mjs
- packages/quay/test/ts-typecheck-gate-cli-event.test.mjs
