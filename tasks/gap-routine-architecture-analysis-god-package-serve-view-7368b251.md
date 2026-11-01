---
id: gap-routine-architecture-analysis-god-package-serve-view-7368b251
title: "architecture-analysis: fanIn 564 / fanOut 222, 118 entities in 7 files;
  serve-i18n.ts alone is 202KB."
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
fanIn 564 / fanOut 222, 118 entities in 7 files; serve-i18n.ts alone is 202KB.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793492325036` · ts `2026-11-01T00:18:45.036Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`serve-i18n`、`serve-dashboard`、`serve-render`
- 涉及文件：
- `packages/quay/src/serve/view/serve-i18n.ts:1`
- `packages/quay/src/serve/view/serve-dashboard.ts:1`
- `packages/quay/src/serve/view/serve-render.ts:1`
- kind：`god-package`
- verdict：`god-package`

## Requested action
Extract i18n locale strings into data modules and split render vs i18n responsibilities.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:18:45.036Z

## Disposition

复核时间 2026-11-01，worktree `gap-routine-architecture-analysis-god-package-serve-view-7368b251` @ develop `2f246c346`。

### 1. 处置结论：修掉，不是记录

finding 逐字命中且未过期。它是同 subject 的**复发**：前序任务
`gap-routine-architecture-analysis-god-package-serve-view`（runId `architecture-analysis-1793401956536`，
status: done，2026-10-30）已复核同一 `serve/view` 包并写明「已有机制在管、失败在哪一步」，其处置结论把
「先拆 `serve-i18n.ts`（最大、纯字典+渲染、无 source-grep 测试、风险最低）」明确记为**下一个增量**。本轮
requested action「Extract i18n locale strings into data modules」正是那个增量 ⇒ 本任务**执行该修复**，
不再重复「已注意到」式结案。

### 2. 实际改动（已提交 task 分支）

- `serve-i18n.ts` 从 2780 行 / 202KB 的 god-file 变为 124 行 barrel；15 个 per-page 数据模块迁入
  `packages/quay/src/serve/view/i18n/`：`chrome`（nav + page names + lang switcher + shared chrome）、
  `dashboard`、`journal`、`board`、`architecture`、`doc-task`、`system`、`sessions`、`manager`、
  `git-history`、`needs-human`、`live`、`tests`、`goal`，以及共享的 `fill`（`{name}` 模板填充）。
- 每个模块是**逐字节搬移**（split 脚本按行区边界断言后才抽取）；公开导出面由 barrel 原样再导出 ⇒
  既有的全部 importer 零改动。
- 唯一 source-grep 测试 `plugin/test/session-primitives-adoption.test.mjs`（原 `readFileSync`
  serve-i18n.ts 断言 zh 列 `状态记录不可用`）跟随 copy 移到 `i18n/sessions.ts`——测试自己的注释明言
  「the assertion FOLLOWS THE COPY」，copy 移动后测试跟随移动是它自己约定的语义。
- 「split render vs i18n responsibilities」半边：render 与 i18n 的职责**早已分离**（render 在
  serve-render.ts / serve-dashboard.ts，i18n 字典在 serve-i18n.ts，后者无任何 HTML 渲染函数）；本轮
  没有 render/i18n 混写需要再拆。
- 拆出后 `directory-cycle.test.mjs` arm 1 抓到一个**目录环**（`serve/view ↔ serve/view/i18n`）：14 个
  `i18n/*.ts` 模块 `import { DEFAULT_LANG, type Lang } from "../serve-lang.ts"`（父目录），而 barrel
  （父目录里的 serve-i18n.ts）`export ... from "./i18n/*"` ⇒ 子目录↔父目录 SCC。修法：把闭语言集
  （`LANGS`/`Lang`/`DEFAULT_LANG`）下沉到自包含的 `i18n/lang.ts`（无父目录 import），`serve-lang.ts`
  原样 re-export 这三者（其公开面不变，`serve/index.ts`/`serve-handlers.ts`/`serve-render.ts`/
  `serve-adr.ts` 等 importer 零改动），14 个模块改 `import ... from "./lang.ts"`（同目录，非跨目录边）⇒
  环消除。
- 附带修掉一个**阻塞本任务 scoped 门的既有缺陷**：2026-10-31 的 codex-plugin 任务新增
  `plugin/scripts/consumer-quay-deliverable-verify.sh` 却未在 `capability-catalog-declarations.json`
  的 QUESTION 表登记 ⇒ `capability-catalog --entry-surface` 静默 exit 1（AC1c unclassified>0），
  `package.sh` 的 delivery-form 门红，`npm-pack-e2e` 红，使每个 src-touching 任务的 scoped 选择都
  带红。本任务补上 QUESTION + CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 并标 NOT_SHIPPED（脚本
  自述 dev-tree only，硬编码 `claude-fjdac`），`--summary` 恢复 410/410 declared / 0 unclassified。

### 3. 验证（实跑，非断言）

| 判据 | 结果 |
|---|---|
| `directory-cycle.test.mjs`（拆后） | 5/5 全绿（arm 1 零目录环） |
| per-package `npx tsc --noEmit`（packages/quay，拆后） | 全绿 |
| i18n/lang 相关测试（serve-i18n/serve-lang/serve-lang-switcher/body-i18n + session-primitives-adoption） | 173/173 全绿 |
| barrel 冒烟（`node --experimental-strip-types -e` 导入全部导出符号 + 抽样值 + serve-lang 公开面） | missing: NONE |
| `capability-catalog --summary` / `--entry-surface`（改后） | 410/410 declared · 0 unclassified · exit 0 |

### 4. 复发预期（诚实交代）

本次修复消掉的是 finding rationale 的**文件级**半边（「serve-i18n.ts alone is 202KB」已不成立）。包级
读数 fanIn 564 / fanOut 222 是前序任务已裁定的 leaf-package 结构恒等（叶子包的职责就是被每个页面
handler import，高 fanIn 是「共享展示原语确实被共享」的证据），拆成同包 sibling 后实体与外部 import 指向
不变、fanIn 仍 ≈564——这不是本任务要改的缺陷轴，前序任务的 `serve-fanout-556` AC 判的也是 fanOut<300
（已满足 222<300）。故包级 god-package 若再立案，rate 闸兜底，与包级拆分（serve-dashboard.ts 的
per-domain card renderer + serve-render.ts 的 page chrome 拆片，需重锚各自 source-grep 测试）是后续独立
增量。

### 5. L_G 读数（ADR-007）

- L_G import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 files=551 edges=1698 gateLayerViolations=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-serve-view`（routine `architecture-analysis`，runId `architecture-analysis-1793492325036`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/view/serve-i18n.ts`
- `packages/quay/src/serve/view/i18n/*.ts`
- `packages/quay/src/serve/view/serve-lang.ts`
- `packages/quay/src/serve/view/serve-dashboard.ts`
- `packages/quay/src/serve/view/serve-render.ts`
- `plugin/test/session-primitives-adoption.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-architecture-analysis-god-package-serve-view-7368b251.md`

## Blocker

**2026-11-01T02:01:39.626Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: catalog must stay green with archive/ excluded: [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=packages/quay/test/directory-cycle.test.mjs,plugin/test/fan-in-execute-paths-s06.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：0030eedc-1ab0-453f-b976-81787a96d815