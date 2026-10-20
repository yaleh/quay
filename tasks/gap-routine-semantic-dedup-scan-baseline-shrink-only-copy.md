---
id: gap-routine-semantic-dedup-scan-baseline-shrink-only-copy
title: "semantic-dedup-scan: Both ratchet checkers define the same exported
  shrink-only judgment (head-null bootstrap, worktree-null, raised axes) with
  only the axis source differing (Obje"
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
Both ratchet checkers define the same exported shrink-only judgment (head-null bootstrap, worktree-null, raised axes) with only the axis source differing (Object.keys vs BASELINE_AXES).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792405443214` · ts `2026-10-19T10:24:03.214Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`checkBaselineShrinkOnly`
- 涉及文件：
- `plugin/scripts/import-graph-check.ts:478`
- `plugin/scripts/sh-census-check.ts:879`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Disposition

已修复（extract）。复核时发现同一符号还有**第三份**副本 `plugin/scripts/shipped-set-rules.ts`
（硬规则 5b：兄弟实例同簇），一并处置。

- 判定机制收敛到 `plugin/scripts/ratchet-baseline.ts` 的单一导出
  `checkBaselineShrinkOnly(worktree, head, axes)`：head-null ⇒ bootstrap、worktree-null ⇒ 不报 raised、
  否则逐轴比较。
- **每个棘轮自己拥有的轴列表留在调用点**（`import-graph-check.ts` 新增显式 `BASELINE_AXES`，
  `sh-census-check.ts` / `shipped-set-rules.ts` 沿用各自既有 `BASELINE_AXES`），以 2 参包装保留各模块
  既有公开面与测试形态 —— 与 `baselinePath` / `baselineFile` 的既有抽取先例同形。
- 直接单测：`plugin/test/ratchet-baseline.test.mjs` 新增一条，覆盖 bootstrap / worktree-null /
  逐轴 raised / **调用点轴列表具约束力**（未传入的轴不会被报告）。

验证（在本任务的 worktree 中实跑）：
- `node --experimental-strip-types --test plugin/test/ratchet-baseline.test.mjs` → 16 pass
- `node --experimental-strip-types --test plugin/test/import-graph-check.test.mjs plugin/test/sh-census-check.test.mjs` → 42 pass
- `node --experimental-strip-types --test plugin/test/shipped-set.test.mjs` → 11 pass

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `baseline-shrink-only-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792405443214`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/sh-census-check.ts`
- `plugin/scripts/ratchet-baseline.ts`
- `plugin/scripts/shipped-set-rules.ts`
- `plugin/test/ratchet-baseline.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-baseline-shrink-only-copy.md`
