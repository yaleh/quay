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

## Touches
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/start-drivers.ts`
- `packages/quay/src/core/server-state.ts`
- `packages/quay/src/kernel/pid-alive.ts`
- `tasks/gap-routine-semantic-dedup-scan-pid-alive-three-copies.md`