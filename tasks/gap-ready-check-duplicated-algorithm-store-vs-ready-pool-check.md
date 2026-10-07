---
id: gap-ready-check-duplicated-algorithm-store-vs-ready-pool-check
title: todo→ready 四要素判定算法存在两份独立实现：store.ts check() 与 ready-pool-check.ts
  artifactsComplete()
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

`packages/quay-native/src/store.ts:1934`（`check()`，支撑 MCP `task_check`/CLI `quay task check`）与 `plugin/scripts/ready-pool-check.ts:713`（`artifactsComplete()`，用于晋升 driver 的 pool 判定路径）都实现了 todo→ready 门的 shape-aware 节完整性判断。它们目前只共享底层数据表（`SHAPE_SECTIONS`，从 `packages/quay/src/kernel/shape-sections.ts` 重新导出）——匹配/判定的**算法本身被独立写了两遍**。本仓库自己的历史已经证明这曾经真实造成一次漂移：一个标题变体的新增（如 `（draft）` 后缀的 AC/DoD 标题形式）曾只落在其中一个实现上,而共享数据表尚未统一——这由已完成任务 `cand-cjk-proposal-slot-word-boundary` 独立证实了同类问题的另一个实例：`store.ts` 的 `sectionAfterHeading`/`artifactSections.has()` 用 `\b` 正则匹配标题，对 CJK 结尾的标题（如 `## 人的裁定`）永不匹配边界，而 `ready-pool-check.ts` 走 `task-schema.ts` 的 `extractSection`（整行精确匹配，无 `\b`）正确识别——同一 body 在两个判据上给出相反结论。该具体 bug 已修复（统一为整行精确匹配），但**修复方式是在两份独立实现里分别/统一调整正则**，并没有消除「两份独立算法」这个结构性根因——未来任何新的标题形式/别名变体仍可能重复同样的漂移模式。

CLAUDE.md 明确说明 author→ready 的 shape 判定「is the single judge quay and meta-cc must share」——目前这条规则靠两份实现各自保持同步来维持，而不是靠单一实现的结构保证。

Proposed action：让 `store.ts` 的 `check()` 直接调用 `ready-pool-check.ts` 的 `artifactsComplete()`（它是更完整、持续维护、由 SHAPE_REGISTRY 驱动的实现），而不是重新实现判定谓词。切换前，先对全量 `tasks/*.md` 语料（截至本文撰写时 2573 个任务）跑两个函数并 diff 结果，确认除已知的历史漂移外没有引入意外行为变化，然后再切换。

## Acceptance Criteria

- [ ] 对全量 `tasks/*.md`（当前语料）跑 `store.ts check()` 与 `ready-pool-check.ts artifactsComplete()` 两个函数并逐任务 diff 结果，贴出差异清单（若有）
- [ ] `store.ts` 的 `check()` 改为调用（import）`ready-pool-check.ts` 的 `artifactsComplete()`，不再维护独立的判定谓词实现
- [ ] 跨包依赖方向符合 Provider ABI 纪律（`packages/quay-native` 若需要依赖 `plugin/scripts` 下的逻辑，需确认不违反现有的 import 边界约束；若直接 import 不可行，先把共享算法下沉到两边都能合法 import 的位置，再双边切换到它）
- [ ] 切换后，全量语料的两个判定结果一致（除本任务修复的差异外，无新的不一致）
- [ ] 既有门测试（`gate-shape-dispatch.test.mjs`、`ready-pool-check.test.mjs` 等）全绿，无回归

## Definition of Done

全部 AC 勾选；`check()` 与 `artifactsComplete()` 不再是两份独立算法；全量语料 diff 证据贴出；既有测试全绿。

## Touches

- packages/quay-native/src/store.ts
- plugin/scripts/ready-pool-check.ts
- packages/quay-native/test/gate-shape-dispatch.test.mjs
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-ready-check-duplicated-algorithm-store-vs-ready-pool-check.md
