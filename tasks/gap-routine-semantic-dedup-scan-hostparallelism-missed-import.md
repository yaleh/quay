---
id: gap-routine-semantic-dedup-scan-hostparallelism-missed-import
title: "semantic-dedup-scan: runner-concurrency.ts already exports
  hostParallelism as the shared home (re-exported by full-suite-runner.ts) yet
  pre-verified-round-record.ts re-declares it "
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
runner-concurrency.ts already exports hostParallelism as the shared home (re-exported by full-suite-runner.ts) yet pre-verified-round-record.ts re-declares it locally instead of importing

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790851304231` · ts `2026-10-01T10:41:44.231Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`hostParallelism`
- 涉及文件：
- `plugin/scripts/pre-verified-round-record.ts:516`
- `plugin/scripts/runner-concurrency.ts:43`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
merge — import hostParallelism from runner-concurrency.ts

## Disposition（复核结论：**已修掉**，不是「已注意到」）

**复核**：finding 属实。两处是**逐字节相同**的读宿主表达式（`RESOURCE_GATE_NPROC` seam →
`os.availableParallelism()` → `os.cpus().length`，下限 1），`pre-verified-round-record.ts:516`
的那份是本地 `export function`，`runner-concurrency.ts:43` 才是共享家（`full-suite-runner.ts:182`
从它 re-export）。⇒ 一个量两个家：任一侧的 seam/口径改动都会让另一侧静默漂移，而**记录里没有任何
检查在盯这个同一性**（`suite-slot-ssot-check` 的 I3 只盯 `suite-lock-slots.ts` 的消费者，不盯
`runner-concurrency.ts`；发现它的是 semantic-dedup-scan 例程本身）。

**处置（requested action: merge → 单一定义点）**：
- `plugin/scripts/pre-verified-round-record.ts` 删除本地 `hostParallelism()` 函数体，改为
  `import { hostParallelism } from "./runner-concurrency.ts"` + `export { hostParallelism };`
  —— 本模块内部调用点（`record.nproc = hostParallelism()`，:916）与既有测试的 import 都读**同一个函数对象**。
  `node:os` 在本模块已无其它用途，一并删掉 import。
  ⚠️ 用的是「import 出一个真正的本地绑定 + 再 export」，**不是** `export { … } from` 的纯转发：
  后者只绑导出表、不绑模块作用域，本模块自己的调用点会 `ReferenceError`（同族前例见
  `tasks/gap-routine-semantic-dedup-scan-concurrency-parse-divergence.md` 的运行时臂教训）。
- 顶部「thin local replicas」注释块同步改写为**逐符号的现状**（hostParallelism 已 import；
  concurrentSuiteSlots 委托 `suiteLockSlotCount()`；countHeldSuiteLocks 仍是 full-suite-runner 的本地副本）
  —— 注释失实本身就是下一轮 finding 的种子。

**产物（可核，且能取假）**：`plugin/test/pre-verified-round-record.test.mjs` 新增一条 SSOT 棘轮，
三半缺一不可：① 在 `plugin/scripts` 下**按位置**扫描 `^export function hostParallelism(` ，
断言**恰好一处**（命中清单进断言消息，硬规则 2：引用计数前先看命中的是不是要的）；
② 本模块导出的 `hostParallelism` **必须 `===` `runner-concurrency.hostParallelism`**（同一函数
对象 ⇒ 本地重declare 必红）；③ 扫描器负控制（合成第二处声明必须被看见，否则「恰好一处」这半恒真=空转）。
棘轮落在**既有** pvr 测试文件里而非新文件：scoped 门按 basename 配对选测（`pre-verified-round-record.ts`
↔ `pre-verified-round-record.test.mjs`），新文件名的测试**不会被选中**。

**5b 扫描（同一原则在本载体的其它落点）**：`plugin/scripts` 下本地声明而别处已导出的同族符号共 3 处 ——
① `concurrentSuiteSlots` ← `runner-concurrency.ts`（本模块的是一行委托 `suiteLockSlotCount()`，不是被复制的表达式）；
② `countHeldSuiteLocks` ← `full-suite-runner.ts:669`；③ `effectiveParallelism` ← `full-suite-runner.ts`。
②③ 的家在**重的** full-suite-runner（本地副本存在正是为了不 import 它），且已被例程自己的 rate 闸排队
（`routine-findings.jsonl` 立案轮里 `probelockheld-dup` / `effectiveparallelism-dup` 均 `rejected: "rate: … ≥ cap 3"`）
—— 由那条通道在后续窗口立案，本轮不动。三处均已在上面的注释块里写明现状。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `hostparallelism-missed-import`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790851304231`）所描述的问题被复核并处置 —— 复核：属实（逐字节重复，2 个家）；处置：按 requested action 合并为单一定义点（本地函数体删除，改为 re-export）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 已修掉，且留下**能取假**的棘轮：`^export function hostParallelism(` 在 `plugin/scripts` 下恰好 1 处（`runner-concurrency.ts:43`）+ 同一性断言；变异实跑（恢复本地副本 ⇒ 红，见 Evidence）

## DoD
- [x] 上面的判据实跑通过 —— `node --test plugin/test/pre-verified-round-record.test.mjs` ⇒ 71/71 pass；变异（本地副本回归）⇒ 该条红，输出实打实的声明清单
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由本任务的装派链（worker）执行；例程只读 `plugin/scripts` 立案，未代跑任何产出者；本任务的 Touches 也由 worker 提交

## Evidence

### AC1 — 复核与处置（修前 / 修后都是实打实跑出来的读数）

**修前（finding 的形态，逐字对照）**：`grep -n "export function hostParallelism" plugin/scripts/*.ts`
⇒ `pre-verified-round-record.ts:516` 与 `runner-concurrency.ts:43` 各一处，两段函数体逐字节相同。

**修后 —— 声明点只剩一个（按位置，非关键词）**：
```
$ grep -rn "^export function hostParallelism" plugin/scripts/*.ts
plugin/scripts/runner-concurrency.ts:43:export function hostParallelism(): number {
$ grep -rln "^export function hostParallelism" plugin/scripts/*.ts | wc -l
1
```

**修后 —— 本模块是 re-export，不是副本**：
```
$ grep -n "hostParallelism" plugin/scripts/pre-verified-round-record.ts
173:// hostParallelism's single definition point — runner-concurrency.ts is the lightweight SSOT home
178:import { hostParallelism } from "./runner-concurrency.ts";
203://   hostParallelism      → IMPORTED from runner-concurrency.ts (the extracted lightweight SSOT home
528:export { hostParallelism };
916:  record.nproc = hostParallelism();      ← 本模块自己的调用点，读同一绑定
```

**同一性 + seam 仍生效（运行时，非 import 层回声）**：
```
$ RESOURCE_GATE_NPROC=8 node --experimental-strip-types -e '… import pvr, rc …'
pvr.hostParallelism === rc.hostParallelism : true
pvr.hostParallelism() = 8 (RESOURCE_GATE_NPROC=8 seam honored)
```

**负控制（棘轮能取假，实跑）**：`cp` 备份 → 把本地函数体写回（并移除 import）⇒
`✖ SSOT — hostParallelism has exactly ONE definition point …`
`AssertionError: hostParallelism must be DECLARED in exactly one place — actual declarations: [{"file":"pre-verified-round-record.ts","line":528},{"file":"runner-concurrency.ts","line":43"}]`
（71 tests / 70 pass / 1 fail）。`cp` 复原后 md5 与变异前一致（`a10f93bcf3522fd89228c3531ca0d0e5`），71/71 绿。

**import-graph 棘轮复跑**（确认 re-export 没引入环）：`import-graph-check.ts . --json` ⇒
`valueSccs=0 / typeSccs=0 / reverseEdges=0`，`verdict.ok=true`，exit 0。

### AC2 — 处置可核

- 判据载体：`plugin/test/pre-verified-round-record.test.mjs` 的 SSOT 用例（① 声明点恰好一处 ② 同一性
  ③ 扫描器负控制）。
- 三个读数：修后全绿（71/71）；本地副本回归 ⇒ 红；import-graph 棘轮不升。

## Touches
- `plugin/scripts/pre-verified-round-record.ts`
- `plugin/scripts/runner-concurrency.ts`
- `plugin/test/pre-verified-round-record.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-hostparallelism-missed-import.md`
## Needs-Human

**执行 2026-10-01T11:01:22.261Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 46
- run_id：wk-prod-anchor
- session_id：822264a7-dd99-43fd-a005-12be0261d7c2
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-semantic-dedup-scan-hostparallelism-missed-import~wk-prod-anchor~1790852443388-60abec.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-semantic-dedup-scan-hostparallelism-missed-import-wk-prod-anchor.log
