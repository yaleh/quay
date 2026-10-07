---
id: gap-ready-check-duplicated-algorithm-store-vs-ready-pool-check
title: todo→ready 四要素判定算法存在两份独立实现：store.ts check() 与 ready-pool-check.ts
  artifactsComplete()
status: done
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

- [x] 对全量 `tasks/*.md`（当前语料）跑 `store.ts check()` 与 `ready-pool-check.ts artifactsComplete()` 两个函数并逐任务 diff 结果，贴出差异清单（若有）
- [x] `store.ts` 的 `check()` 改为调用（import）`ready-pool-check.ts` 的 `artifactsComplete()`，不再维护独立的判定谓词实现
- [x] 跨包依赖方向符合 Provider ABI 纪律（`packages/quay-native` 若需要依赖 `plugin/scripts` 下的逻辑，需确认不违反现有的 import 边界约束；若直接 import 不可行，先把共享算法下沉到两边都能合法 import 的位置，再双边切换到它）
- [x] 切换后，全量语料的两个判定结果一致（除本任务修复的差异外，无新的不一致）
- [x] 既有门测试（`gate-shape-dispatch.test.mjs`、`ready-pool-check.test.mjs` 等）全绿，无回归

## Evidence

**AC1/AC4 — 全量语料 diff（2587 个 `tasks/*.md`；`store.artifactSections()`/`detectShape()` vs `ready-pool-check.artifactsComplete()`/`detectShape()`，逐任务比对 shape + artifacts 映射 + complete）**

切换前：**66 处差异**
- 63 处 = 仅 unknown-shape 的 artifacts 映射**表示差异**（store `{proposal:false,plan:false,ac:false,dod:false}` vs pc `{}`）；两侧 `complete` 本就都是 `false`，非判定差异。
- 3 处 = **真实判定差异**（均 contract shape，`plan`：store `true` / pc `false`）：`gap-no-explicit-blocked-signal-from-inner-layer`、`gap-suite-concurrency-4-vs-8-measurement`、`gap-sync-vendor-drift-mislabelled-as-task-schema`。根因：store 的 `sectionAfterHeading` 以 `^##\s` 收尾，遇到更浅的 `# ` 标题不收束，把夹在两个 `## ` 之间的 H1 及其内容吞进前面的 `## Contract`，使一个实际为空的 Contract 段读到 `plan:true`。三个任务状态均为 `done`（且 `check()` 对 done 直接返回 terminal，故对生产无影响）。

切换后：**0 处差异**（两侧同调 kernel 单一实现）。

另：`ready-pool-check.artifactsComplete()` 自身在语料上的 `complete`/`missing`/`shape` 读数**逐任务字节一致**（旧实现 vs 新实现单独复核），仅 unknown-shape 的 `artifacts` 映射由 `{}` 变为 all-false——与 store 既有输出对齐，无判定影响。

**AC2 — 单一判定谓词**：新增 `packages/quay/src/kernel/task-shape-artifacts.ts`（`detectShape` / `findShapeSection` / `artifactsComplete` / `artifactSections` / `MIN_SECTION_CHARS` / `TaskShape`）。`store.ts` 删除私有 `artifactSections`/`hasExactHeading`/`detectShape`/`sectionAfterHeading`/`MIN_SECTION_CHARS`，改 import + re-export kernel；`ready-pool-check.ts` 删除私有 `detectShape`/`sectionNonWsLength`/`artifactsComplete`/`MIN_SECTION_CHARS`，同样改 import + re-export。AC2 字面的「import `ready-pool-check.ts`」在 AC3 下**不可行**（那是 `packages/**`→`plugin/**` 反向边），故按 AC3 明列的替代路径执行：先下沉共享算法到 kernel，再双边切换。

**AC3 — 依赖方向**：共享算法落在 kernel（`packages/quay/src/kernel/`）——产品判据（quay-native，禁反 import plugin）与方法论判据（plugin/scripts，可 import Core 源）都能合法 import 的唯一位置；kernel 模块只 import 两个 kernel 叶子。`plugin/scripts/import-graph-check.ts` 通过：`valueSccs=0 typeSccs=0 reverseEdges=0 kernelChecked=true (violations=0)`。

**AC5 — 测试**：`packages/quay-native/test/*`（122）全绿；`plugin/test/ready-pool-check-*.test.mjs` + `rework-predictors`（213）全绿；`--for-task` scoped 门 EXIT=0（含 gate-shape-dispatch 全 16 例）；`npx tsc --noEmit` EXIT=0。新增门锁：`gate-shape-dispatch` 的「ONE judge」+「depth-aware boundary」两例，`ready-pool-check-s04` 的「IS the shared kernel judge」一例。

## Definition of Done

全部 AC 勾选；`check()` 与 `artifactsComplete()` 不再是两份独立算法；全量语料 diff 证据贴出；既有测试全绿。

## Touches

- packages/quay-native/src/store.ts
- plugin/scripts/ready-pool-check.ts
- packages/quay/src/kernel/task-shape-artifacts.ts
- packages/quay-native/test/gate-shape-dispatch.test.mjs
- plugin/test/ready-pool-check-s04.test.mjs
- tasks/gap-ready-check-duplicated-algorithm-store-vs-ready-pool-check.md
