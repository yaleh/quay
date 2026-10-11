---
id: gap-ownership-active-repair-unknown-symbol-guard-false-positive
title: "repair loop's fabricated-symbol guard flags real exports as unknown:
  graphSymbols() only sees names that cross a directory edge, so 6/16 genuine
  symbols of the live candidate would burn every repair round as UNKNOWN_SYMBOL"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

联合回归后续(2026-10-11)对 2026-10-11 盲测候选切法(carrier `.quay/ownership-shadow-proposals.jsonl` 第 91 条,run_id `live:2026-10-11T09-28-34-622Z:1`,commit `ec00fcc00`,3 个 move 共 16 个符号)做负对照时,按位置核实到:`docs/analysis/ownership-active-proposal-repair.mjs` 的 `unknownSymbols(graph, moves)` 以 `graphSymbols(graph)`(= 全图**跨目录边**的 `importedNames` 并集,约第 119-123 行)作为"符号存在"的判据。一个真实导出、但当前**没有任何跨目录 importer**(只在本目录内被用、或尚无人用)的符号不在该并集里,被判为"未知/编造"。`attemptRepair` 约第 377-378 行对非空 unknown 集直接 `record(… bucket:"unknown_symbol", matched:"UNKNOWN_SYMBOL" …); continue`——整轮作废、计入轮次消耗。

**实测(确定性复现,非推测)**:对该真实候选,`unknownSymbols` 返回 `["AcceptanceResult","AcceptanceVerdict","GateDefinition","GateVerdict","GateVerdictKind","NotEvaluatedCause"]`——**6/16 个真实符号**(均为 `packages/quay/src/gate/types.ts` / `gate/acceptance-runner.ts` 在 `ec00fcc00` 的真实导出)被误判为编造;真正编造的 `fabricatedLoaderFn` 也在列(正确)。用于判定的 ArchJSON 是 package 级(`entities` 仅 8 个聚合实体),**不携带逐符号实体**,所以同一快照内无法据此证明存在性。`GateFn` 未被误判,因为它恰好在 `gate/factories -> gate` 边上。

**后果**:任何保留这类符号的 judge 修订在每一轮都会被当作"编造符号"作废,修复环对"搬迁当前无跨目录 importer 的符号"这类切法**结构上必然在轮次耗尽后 honest_abstain**,且记录里留下对真实符号的"编造"指控(把证据标错)。这是代理量取代直接量(硬规则 4b):"被跨目录 import"是"存在"的代理。

**负对照基线(同次测得,证据 `.quay/joint-regress-2026-10-11/replay-nc.json`)**:ArchGuard 原语本身对编造符号**静默忽略**(钉住的源码构建 `8e634bad`,`simulate.js` sha256 `78b1eeda7365769f…`:加入 `fabricatedLoaderFn` 后仍 `evaluated` exit 0、delta 不变)——所以 Quay 侧这道守卫是唯一防线,不能简单删掉,只能把判据换成直接量。

<!-- dedup-ref -->
去重:open 任务对 `unknownSymbols`/`UNKNOWN_SYMBOL`/`graphSymbols`/`ownership-active` 零命中;`task-granularity-advice` 对本 Touches 无 peer。与 `gap-ownership-active-investigator-holdout-deny-list`(todo,只改 `ownership-active-contract.mjs`)、`gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal`(done)文件不重叠。

## AC

- [ ] AC1 存在性判据改为直接量:一个 move 符号被视为"存在"当且仅当它出现在某条图边的 `importedNames` 中,**或**是该 move 声明的源文件(`move.file`,相对 `scope_root`)在**锁定 commit** 上的真实导出(经 git-at-commit 读取 + 导出解析,或经 ArchGuard 逐文件实体查询;二者择一,须同一 commit,不得读工作树、不得凭名字猜测)。
- [ ] AC2 生产形状回归:对上述真实候选(第 91 条记录的 `proposed_slice`,锁定 `ec00fcc00`),修复后 `unknownSymbols` 对 16 个原始符号返回 `[]`(6 个误报消失)。
- [ ] AC3 负对照(守卫仍有牙):同一候选加入 `fabricatedLoaderFn`(及一个拼写近似的假名如 `loadWorkspaceGatez`)后,`unknownSymbols` 恰好返回这两个名字,不多不少;`attemptRepair` 对含它们的修订仍以 `UNKNOWN_SYMBOL` 作废该轮。
- [ ] AC4 负对照(不读工作树):在工作树里临时给源文件追加一个未提交的导出名,该名字仍被判为未知(判据只认锁定 commit)。测试结束恢复文件(cp 备份法,不用 git checkout)。
- [ ] AC5 既有回归全绿(`plugin/test/ownership-active-proposal-repair.test.mjs` 等);准入门限/streak=3/fail-closed/只写 draft 均不触碰;`bash scripts/test.sh --for-task gap-ownership-active-repair-unknown-symbol-guard-false-positive` exit 0。

## DoD

修复环的编造符号守卫以"锁定 commit 上的真实导出 ∪ 图边 importedNames"为判据,真实候选的 6 个误报消失,编造名仍被拦,工作树未提交改动不被采信。⛔ 不改 ArchGuard,不放宽任何准入/fail-closed 行为,不创建/激活任何 Goal。

## Touches

- docs/analysis/ownership-active-proposal-repair.mjs
- plugin/test/ownership-active-proposal-repair.test.mjs
- tasks/gap-ownership-active-repair-unknown-symbol-guard-false-positive.md
