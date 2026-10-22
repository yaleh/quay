---
id: gap-routine-semantic-dedup-scan-extract-section-byte-identical
title: "semantic-dedup-scan: Depth-aware heading extractor is byte-identical
  (same escapeRegExp call, same stopRe logic); task-schema.ts neither imports
  nor re-exports the product copy, so"
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
Depth-aware heading extractor is byte-identical (same escapeRegExp call, same stopRe logic); task-schema.ts neither imports nor re-exports the product copy, so the twin is hand-maintained and only parity-tested.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792647604889` · ts `2026-10-22T05:40:04.889Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`extractSection`
- 涉及文件：
- `plugin/scripts/task-schema.ts:88`
- `packages/quay/src/task-parsing.ts:55`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Disposition（处置结论）
**已修掉（merge），不是「已注意到」。** finding `extract-section-byte-identical` 报的两个 byte-identical body
现收敛为**一个**定义：

- 新落点：`packages/quay/src/kernel/extract-section.ts` —— 全仓唯一的 `function extractSection` 声明。
- `packages/quay/src/task-parsing.ts` 与 `plugin/scripts/task-schema.ts` 都改为 re-export 同一个 kernel 函数
  ⇒ 两层拿到的是**同一个函数对象**（identity），不再靠 parity 测试维持同步。
- 落点与可达性论证沿用 sibling `countAcCheckboxes`（task gap-three-pure-judges-kernel-single-def, AC-909）：
  `packages/**` → `plugin/**` 是反向边（`plugin/scripts/import-graph-check.ts` ratchet=0），kernel 是两层都能
  import 的唯一位置；`build-plugin-dist.mjs` 的 `coreSrcAliasPlugin` 把 `packages/quay/src/**` inline 进 `dist/*.js`。
- kernel leaf 只 import `kernel/regex-escape.ts`：无 fs / node 内建 / 副作用，不能形成环。

**可核证据（本轮实跑）**：
- `node --no-warnings --experimental-strip-types --test packages/quay/test/kernel-pure-judges.test.mjs`
  → 8/8 pass；其中 ①扫描「`extractSection` 在 `packages/quay/src` + `plugin/scripts` + `scripts` 上恰好 1 处
  声明且位于 kernel/」，②断言 product entry ≡ mechanism entry ≡ kernel leaf（同一对象）。
- `node --no-warnings --experimental-strip-types --test plugin/test/task-parsing-parity.test.mjs`
  → 8/8 pass（原「两副本行为一致」用例改为 identity + 行为双断言）。
- `grep -rnE "(function|const|let|var)\s+extractSection\b" packages/quay/src plugin/scripts scripts`
  → 修复后 1 处（`packages/quay/src/kernel/extract-section.ts:45`）；修复前 2 处
  （`plugin/scripts/task-schema.ts:88` / `packages/quay/src/task-parsing.ts:55`，即 finding 记录的位置）。
- 落地提交：`1d626c071`（worktree `task/gap-routine-semantic-dedup-scan-extract-section-byte-identical`）。

**5b 边界（修好一处 ≠ 只在一处，写明而非沉默略过）**：同族 `extractSectionFenceAware` 只存在于
`plugin/scripts/task-schema.ts`（产品层无对应实现），不是 twin；`packages/quay-github/src/github-client.ts`
的 issue-body 切片使用不同锚约定（`(?![\s\S])`），不在本 finding 的 `byte-identical-body` 判定内。
本任务只收敛 `extractSection` 这一对，未扩大范围。

## ADR-007 dark-axis reading
- L_D: docLines=0 codeLines=209 ratio=0.000 verdict=PASS（`plugin/scripts/phase-declare.ts --ld-reading --numstat-file`，numstat = `git diff --numstat develop...HEAD`，本任务落地提交 `1d626c071`；实现 delta 无 .md 变更 ⇒ 文档增量 0，是「没有文档改动」而非未测量）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `extract-section-byte-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792647604889`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-schema.ts`
- `packages/quay/src/task-parsing.ts`
- `packages/quay/src/kernel/extract-section.ts`
- `plugin/test/task-parsing-parity.test.mjs`
- `packages/quay/test/kernel-pure-judges.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-extract-section-byte-identical.md`