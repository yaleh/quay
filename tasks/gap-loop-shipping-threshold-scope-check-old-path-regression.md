---
id: gap-loop-shipping-threshold-scope-check-old-path-regression
title: quantified-stop-conditions 的 threshold-scope-check.ts 引用旧 tick-doc 路径且不在
  loop-shipping 排除表——round-200 全量套件红在 loop-shipping AC1b（176 文件绿仅此 1
  失败）；SCAN_DOCS 扫 docs/analysis/+orchestration/ 旧部署副本，其他
  checker（adr016/no-manager/instrument-failure）都扫 plugin/loop/ 规范路径且已排除
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**round-200（609fbd40，2026-08-09 21:20-21:30）全量套件红，唯一失败 = `plugin/test/loop-shipping.test.mjs` AC1b（13.2s）——`threshold-scope-check.ts`（quantified-stop-conditions 32702dbc 新增）的 `SCAN_DOCS` 引用旧 tick-doc 路径（`orchestration/orchestrator-loop-tick.md` + `docs/analysis/fast-mode-loop-tick.md`）且不在 loop-shipping 排除表。176 个测试文件全绿，仅此 1 失败——这是 quantified fan-in 的 cross-cut 盲区回归（scoped 门没跑 loop-shipping）。**

### 实证（outer 2026-08-09 21:30 红窗分诊）

- **round-200 红**：`loop-shipping.test.mjs passed=false`（13185ms），AC1b「after the move, no live reference to the 5 old paths remains (comments/history excluded)」。
- **solo 复现**：`node --test plugin/test/loop-shipping.test.mjs` → 12 tests / 11 pass / 1 fail（AC1b）。
- **AC1b 报出的引用**：
  - `docs/analysis/threshold-scope-violations.md`：contains `/orchestration\/orchestrator-loop-tick\.md/`
  - `plugin/scripts/threshold-scope-check.ts`：contains `/orchestration\/orchestrator-loop-tick\.md/`
- **根因**：`threshold-scope-check.ts` 是 32702dbc（gap-quantified-stop-conditions-have-no-scope）新增的 603 行 checker，`SCAN_DOCS = ["docs/analysis/fast-mode-loop-tick.md", "orchestration/orchestrator-loop-tick.md", "CLAUDE.md"]` ——引用的是**旧部署副本**路径，不是 loop-shipping 移动后的 `plugin/loop/` 规范路径。
- **对比（既有 checker 的正确模式）**：
  - `adr016-screen-use-check.ts:100-105`：`MD_TICK_DOCS = [plugin/loop/fast-mode-loop-tick.md, plugin/loop/manager-loop-tick.md, plugin/loop/orchestrator-loop-tick.md, orchestration/orchestrator-loop-tick.md]`——扫规范 + 部署，且在排除表。
  - `no-manager-tick-doc-check.ts:78-79`：`[plugin/loop/orchestrator-loop-tick.md, orchestration/orchestrator-loop-tick.md]`——同样在排除表。
  - `instrument-failure-check.ts:66-68`：`[orchestration/orchestrator-loop-tick.md, plugin/loop/fast-mode-loop-tick.md, plugin/loop/manager-loop-tick.md]`——同样在排除表。
  - **`threshold-scope-check.ts` 不在排除表**（`grep -c threshold-scope-check plugin/scripts/loop-shipping-exclusion-data.mjs` = 0）。
- **历史**：loop-shipping round-36（19:23）passed=true；round-37 是 quantified fan-in 后首次全量跑 ⇒ 该回归由 32702dbc 引入。round-199 在静态检查阶段 abort（0 测试跑），从未暴露。

**为什么重要**：loop-shipping AC1b 是「移动后不许残留旧路径引用」的机械闸。quantified 的 checker 引用旧部署路径（且没进排除表）是同一 cross-cut 盲区族（github-client sabotage / create-mcp 等）——scoped 门只跑自己 touches 的测试，没跑 loop-shipping。全量套件 176 绿仅 1 红，修好即绿。

### 选定机制方向（实现归内层，接法留执行时）

1. **主修**：`threshold-scope-check.ts` 的 `SCAN_DOCS` 改用 `plugin/loop/fast-mode-loop-tick.md` + `plugin/loop/orchestrator-loop-tick.md`（规范路径，与 adr016/no-manager/instrument-failure 同形），或同时扫规范+部署并进排除表。
2. **排除表备选**：若设计上要扫部署副本，把 `threshold-scope-check.ts` 加进 `loop-shipping-exclusion-data.mjs`（reason=「扫部署 tick-doc 副本，target-layout 引用」——与 adr016-screen-use-check 同类）。
3. **AC1b 回归验证**：修后 `loop-shipping.test.mjs` 12/12 绿；`--for-task` scoped 门绿。

**验证锚**：修后 (a) loop-shipping AC1b 绿（无新 checker 引用旧路径或已排除）；(b) threshold-scope-check 仍扫到 CLAUDE.md（其核心扫描面不丢）；(c) 全量套件绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 round-200 实证（176 绿仅 loop-shipping AC1b 红、solo 12/11、threshold-scope-check 旧路径引用 + 不在排除表）（本任务 Proposal 已含）
- [ ] AC2: **旧路径引用消除**——threshold-scope-check.ts 不再引用旧部署路径（改 plugin/loop/ 规范路径），或已进排除表
- [ ] AC3: **loop-shipping 绿**——AC1b 回归验证 12/12（含 necessity-check 不炸）
- [ ] AC4: **扫描面不丢**——threshold-scope-check 仍扫 CLAUDE.md + 有效 tick-doc 面（Contract invariant 保持）
- [ ] AC5: **全量套件绿**——round-200 类场景不再红（fail 0 且 cancelled 0 且 FULL-SUITE-EXIT=0）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：loop-shipping 12/12 绿（贴任务体）；threshold-scope-check 扫描面核对
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/threshold-scope-check.ts（SCAN_DOCS：改用 plugin/loop/ 规范路径，或保留部署路径 + 进排除表）
- plugin/scripts/loop-shipping-exclusion-data.mjs（若选备选：新增 threshold-scope-check 排除条目）
- plugin/test/loop-shipping.test.mjs（AC1b 回归验证，既有）
- tasks/gap-quantified-stop-conditions-have-no-scope.md（交叉标注——回归源头）
- tasks/gap-loop-shipping-threshold-scope-check-old-path-regression.md（自身：勾 AC + 贴证据）

## Contract

measure   loop_shipping_red_after_fix = `node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs 2>&1 | grep -c '✖ AC1b'` 的 stdout 数字
band      loop_shipping_red_after_fix = 0（AC1b 绿）
invariant threshold_scan_surface_preserved = 1（CLAUDE.md + 有效 tick-doc 面仍在扫描面内）
invariant existing_checkers_unchanged = 1（adr016/no-manager/instrument-failure 不回归）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs`
control   AC1b 绿；扫描面不丢；既有 checker 不回归
resume    SCAN_DOCS 改路径 / 排除表分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-200 176 绿仅 loop-shipping AC1b 红）——threshold-scope-check.ts（32702dbc 新增）SCAN_DOCS 引用旧部署路径且不在排除表，其他 checker 均扫 plugin/loop/ 规范路径且已排除。quantified fan-in 的 cross-cut 盲区回归。实现归内层
