---
id: gap-routine-semantic-dedup-scan-fs-walk-family
title: "semantic-dedup-scan: 22 recursive readdirSync({withFileTypes:true})
  walkers across 19 files share one skeleton (try/catch-return + Dirent loop +
  sorted output) and differ ONLY in t"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
22 recursive readdirSync({withFileTypes:true}) walkers across 19 files share one skeleton (try/catch-return + Dirent loop + sorted output) and differ ONLY in the skip-set/roots/ext constants — four of the six cited pairs are byte-identical code, the other two differ only in comments.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789322638156` · ts `2026-09-13T18:03:58.156Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`walk`
- 涉及文件：
- `plugin/scripts/adr016-screen-use-check.ts:169`
- `plugin/scripts/dead-code-after-return-check.ts:122`
- `plugin/scripts/kernel-sibling-resolution-check.ts:438`
- `plugin/scripts/target-identity-literal-check.ts:190`
- `plugin/scripts/concurrency-literal-check.ts:262`
- `plugin/scripts/suite-slot-ssot-check.ts:64`
- `plugin/scripts/deletion-closure-check.ts:96`
- `plugin/scripts/identity-replication-check.ts:110`
- `plugin/scripts/derive-touches-heuristic.ts:88`
- `plugin/scripts/touches-orthogonality-check.ts:138`
- `plugin/scripts/threshold-scope-check.ts:152`
- `plugin/scripts/tick-core-static-check.ts:249`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Disposition
**复核结论：finding 属实，且实测比 finding 报得更宽。** finding 只点了 `readdirSync({withFileTypes:true})` 一族；逐文件核过之后，同骨架的还有另外两族（`readdirSync`+`statSync` 族、`SCAN_ROOTS` 表族），实际是 **12 个文件 13 处调用点**，不是 12 处。逐对核实的「逐字节相同」实例：

- `collectShellScripts`：`adr016-screen-use-check.ts` 与 `dead-code-after-return-check.ts` 逐字节相同（仅文档注释不同）。
- `buildFileIndex`：`threshold-scope-check.ts` 与 `tick-core-static-check.ts` 逐字节相同（仅注释不同）——两处同名同签名导出。
- `scanSurface`：`kernel-sibling-resolution-check.ts` 与 `target-identity-literal-check.ts` 逐字节相同。

**处置 = 修掉（extract）**，不是「已注意到」，也不是「已有机制在管」：

- 新增单一遍历实现 `plugin/scripts/fs-walk.ts`，导出 `walkFiles`（骨架：try/catch-readdir + 逐项循环 + skip 剪枝 + path.join + 排序返回）、`scanRoots`（SCAN_ROOTS 表形态）、`buildFileIndex`（按 basename/stem 建索引）。
- 12 个检查器改为 import；**各自保留自己的 skip 集、扩展名集与软链语义**（⛔ 本文不把三者「统一」——理由见下）。
- 代码位 `readdirSync` 调用点 **151 → 139（−12）**。逐文件核对过增减集合：变化**只**落在这 12 个文件（各 −1 或 −2）与新增的 `fs-walk.ts`（+1），无第四个受影响文件。

**行为等价的取证（本条最硬的一条）**：12 个检查器的 CLI 在改动前后各跑一次，stdout + stderr + exit code **全量 diff，12/12 一致**。唯二差异均已定位且都是预期：

- (a) 4 个会报告「扫描文件数」的检查器计数 +1 —— 新增的 `fs-walk.ts` 进了它们自己的扫描面（`target-identity-literal-check` 358→359 等）。
- (b) `identity-replication-check` 仍是**同一条既存崩溃**（悬空软链 `experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts`），仅栈帧行号随删行位移；崩溃本身与触发文件逐字未变 —— 这恰好证明「dirent 模式把软链当文件」这条语义被保住了。
- 另：`deletion-closure-check` 用一个**与本次改动无关的稳定构件**（`task-schema.ts`）在 `91da932fc` 的独立检出上与改动后对拍，root 归一后逐字节一致（该检查器首次取证用的构件是 `fs-walk.ts` 本身，改动前它还不存在，故那次对拍无意义，已用稳定构件重做）。

**为什么必须「保留语义而不是统一语义」**：这些 walker 在**同一件事上有三种互不相同的取法** —— `entryKind:"dirent"` 把软链当普通项、`dirent` + `isFile()` 把软链整个丢掉、`entryKind:"stat"` 跟随软链（同一文件可经目录软链被访问两次）。把它们合成一条会让检查器**静默少扫文件**，而「读不懂输入」与「合格」同形正是硬规则 3b 最贵的形态（假绿横扫整个静态层）。故 `fs-walk.ts` 把这条轴做成显式参数，`plugin/test/fs-walk.test.mjs` 用三条断言把它钉死（dirent / dirent+isFile / stat 对同一棵含软链的树给出三种不同结果）。

**验证读数**：`plugin/test/fs-walk.test.mjs` 15/15 绿；这 12 个检查器的既有测试 233/233 绿；`capability-catalog.sh --entry-surface` rc=0（`fs-walk.ts` 六表已登记）；`rhythm-consumer-check --check` rc=0；`checker-count-drift-check` rc=0；`instrument-failure-check --gate` 5/5 PASS。

**划界（本条不声称什么）**：全仓仍有约 130 处 `readdirSync`，其中多数不是递归 walker（单层枚举目录、读一个目录），不在本族内。本条只消除这 12 个文件里那 13 处**同骨架递归遍历**，⛔ 不声称「全仓 readdirSync 已消除」。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `fs-walk-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789322638156`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/adr016-screen-use-check.ts`
- `plugin/scripts/dead-code-after-return-check.ts`
- `plugin/scripts/kernel-sibling-resolution-check.ts`
- `plugin/scripts/target-identity-literal-check.ts`
- `plugin/scripts/concurrency-literal-check.ts`
- `plugin/scripts/suite-slot-ssot-check.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/derive-touches-heuristic.ts`
- `plugin/scripts/touches-orthogonality-check.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tick-core-static-check.ts`
- `plugin/scripts/fs-walk.ts`
- `plugin/scripts/capability-catalog.sh`
- `plugin/test/fs-walk.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-fs-walk-family.md`