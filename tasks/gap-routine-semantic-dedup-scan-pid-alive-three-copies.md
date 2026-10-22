---
id: gap-routine-semantic-dedup-scan-pid-alive-three-copies
title: "semantic-dedup-scan: All three implement kill(pid,0) with EPERM read as
  ALIVE; server-state.ts:187 is the exported canonical copy (driver-runtime
  already re-exports it) and discove"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
All three implement kill(pid,0) with EPERM read as ALIVE; server-state.ts:187 is the exported canonical copy (driver-runtime already re-exports it) and discovery-method-routine's copy is a plain importable leftover.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792647604889` · ts `2026-10-22T05:40:04.889Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pidAlive`
- 涉及文件：
- `plugin/scripts/discovery-method-routine.ts:657`
- `plugin/scripts/start-drivers.ts:147`
- `packages/quay/src/core/server-state.ts:187`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
merge

## Disposition
**修掉（merge）——探针收敛为一份实现。**

- 新正本：`packages/quay/src/kernel/pid-alive.ts`（kernel leaf，**零 import**；`EPERM = exists-but-not-ours = ALIVE`，其余失败 = DEAD；输入强制转成正整数，读不懂 ⇒ 不报存活）。
  之所以要 leaf 而不是让 `start-drivers.ts` 直接 import `core/server-state.ts`：后者是 esbuild 打包入口，会把 `server-state.ts` 的整个闭包内联进 `dist/start-drivers.js`（同 `serve-log.ts` / `systemd-scope.ts` / `serve-heap-cap.ts` 的 leaf 先例）。原文件里「zero-closure-deps 入口不得 import 单一真相源」的理由已被该文件自己的跨树 import 证伪。
- `packages/quay/src/core/server-state.ts` 改为 **re-export** leaf（公开面不变：`serve.ts` / `cli/server.ts` / `loaded-version.ts` 仍从这里取）。
- `plugin/scripts/start-drivers.ts` 删除本地副本，改为 import leaf。
- `plugin/scripts/discovery-method-routine.ts` 删除本地副本，从其**既有**的 `./driver-runtime.ts` import 取符号（driver-runtime 已 re-export 正本）并 re-export（测试从这里取符号）。

复核读数（本轮实跑）：
- `grep -rn "function pidAlive" plugin/scripts packages/quay/src` ⇒ 生产代码只剩 `packages/quay/src/kernel/pid-alive.ts:33`（其余命中全在 `*/test/*` 的 fixture 与 archive）。
- 上述三文件 + leaf 的 `process.kill(..., 0)` 探针数 ⇒ leaf 1 处，其余 0 处。
- `serverState===leaf true | dmr===leaf true`（re-export 的是同一个函数对象，不是第二份实现）。
- 行为读数：`pidAlive(process.pid)=true`、`pidAlive(999999999)=false`、`pidAlive(null)=false`、`pidAlive("abc")=false`。
- `node --test plugin/test/start-drivers.test.mjs` ⇒ 21/21 pass；`node --test plugin/test/discovery-method-routine.test.mjs` ⇒ 59/59 pass。
- `plugin/scripts/import-graph-check.ts` ⇒ PASS（`kernelChecked=true violations=0`，`valueSccs=0`）；`tsc --noEmit -p packages/quay` ⇒ exit 0。

## L_D/L_G 轴
该轴仍暗,理由:本任务只收敛一个零 import 的进程存活探针（单符号去重），不改变模块依赖结构、包边界或 gate 分层，故未取 L_D/L_G 读数。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `pid-alive-three-copies`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792647604889`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
**2026-10-22 第三轮（worker，续做 exited-not-landed 的 worktree）复核读数**——分支已在 `d9048855a` 完成实现，本轮只重跑判据 + 处置上轮 suite 红。

- 同一性：`pidAlive(process.pid)=true`、`pidAlive("`+process.pid+`")=true`、`pidAlive(999999999)=false`、`pidAlive(null)=false`、`pidAlive("abc")=false`；`server-state.ts` 与 `discovery-method-routine.ts` 导出的 `pidAlive` 与 leaf **同一个函数对象**（`===` 均为 true）。
- 探针计数（按位置，不是按关键词）：`grep -rn "function pidAlive" plugin/scripts packages/quay/src` ⇒ 1 处（`kernel/pid-alive.ts:33`）；四文件 `process.kill` 计数 = leaf 1 / server-state 0 / discovery-method-routine 0 / start-drivers 1 —— start-drivers 那一处是 `process.kill(pid, "SIGTERM")`（发信号，不是存活探针），存活判断走 leaf 的 `pidAlive`。
- `node --experimental-strip-types --test plugin/test/start-drivers.test.mjs` ⇒ 21 pass / 0 fail；`plugin/test/discovery-method-routine.test.mjs` ⇒ 59 pass / 0 fail。
- `plugin/scripts/import-graph-check.ts` ⇒ PASS（`kernelChecked=true`，`valueSccs=0`）；`npx tsc --noEmit -p packages/quay` ⇒ exit 0。

**上轮 suite 红的真因与处置（`plugin/test/design-evolution-readings.test.mjs` AC2 real-history）**：
- 症状：`AssertionError: 11639 !== 11644`（`nonCentralDelta`），被 fan-in 的 baseline A/B 判为 task-introduced。
- 真因：该 AC2 的 **serve 臂没有钉 head**（默认 `HEAD`），而同一测试的 worker 臂钉了 `{head:"ff32d031d"}`。finding 表格的两行本来是**同一次历史读数**；本任务把 `core/server-state.ts` 的实现移进 leaf（净减 5 行）⇒ serve 臂对着移动的树重算，读出 11639。测试自己的头注释写的是「real readings … LOWER BOUNDS」，代码却是等值钉死 —— 头注释与代码不一致是真缺陷。
- 处置：**给 serve 臂钉上 worker 臂用的同一个 ref** `{head:"ff32d031d"}`（在该 ref 实测 `centralDelta=153 / nonCentralDelta=11644 / share=1%`，与 finding 表格逐字一致；`measureSubsystem` 本就以 `head` 表达「可复现的历史窗口」，且有专门测试覆盖该性质）。这不是放宽：把**移动的 HEAD** 换成**钉死的窗口**，判据从「随任何合法重构漂移」变成「可复现且仍断言表格」。⛔ 没有放宽任何数值。
- 复核：`node --experimental-strip-types --test plugin/test/design-evolution-readings.test.mjs` ⇒ 41 pass / 0 fail。
- 附：同轮 suite 里 `plugin/test/task-granularity-advice.test.mjs` AC6 也是红，但它在**develop 基线上就是红**（读的是主检出 `.quay/worker-outcome.jsonl`，与分支无关；fan-in baseline A/B 未把它列为 added），不是本任务引入，未在此处置。

## Touches
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/start-drivers.ts`
- `packages/quay/src/core/server-state.ts`
- `packages/quay/src/kernel/pid-alive.ts`
- `plugin/test/design-evolution-readings.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-pid-alive-three-copies.md`

## Blocker

**2026-10-22T05:59:10.120Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/design-evolution-readings.test.mjs changed=-]
- run_id：wk-prod-anchor

（处置见 `## Evidence` 末段：真因是该测试 serve 臂未钉 head，已钉 `ff32d031d` 并复跑 41/41 绿。）
