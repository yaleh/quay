---
id: gap-loop-shipping-verify-delivery-surface-consumer-laid-ref
title: verify-delivery-surface.ts consumer-laid 交付物引用旧 tick-doc 路径且不在
  loop-shipping 排除表——08853779 fan-in 的 cross-cut 回归（round-203 红于 loop-shipping
  AC1b）；consumer-laid 引用是有意的，应收编排除表（同族 adr016/no-manager/instrument-failure）
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

**round-203 红于 loop-shipping AC1b——`verify-delivery-surface.ts` 引用旧 tick-doc 路径（line 164 consumer-laid deliverables）且不在 loop-shipping 排除表。这是 `gap-verify-delivery-surface-checks-source-layout-not-consumer-laid`（08853779）fan-in 引入的 cross-cut 盲区回归：它加了 consumer-laid 交付物引用，但没把 verify-delivery-surface.ts 收进排除表（同族：adr016/no-manager/instrument-failure 都进表了）。**

### 实证（outer 2026-08-09 22:38 红窗分诊）

- **round-203 红**：唯一失败 = `loop-shipping.test.mjs` AC1b（13.4s）。
- **solo 复现**：AC1b flag：
  - `plugin/scripts/verify-delivery-surface.ts: contains "/orchestration\/orchestrator-loop-tick\.md/"`
  - `plugin/scripts/verify-delivery-surface.ts: contains "/docs\/analysis\/fast-mode-loop-tick\.md/"`
- **根因**：`verify-delivery-surface.ts:164` `deliverables: ["orchestration/orchestrator-loop-tick.md", "docs/analysis/fast-mode-loop-tick.md"]`——consumer-laid（铺入目标布局）的交付物引用。`git show 08853779` 确认这一行是该 fan-in 新增。
- **任务归属**：`gap-verify-delivery-surface-checks-source-layout-not-consumer-laid`（status ready，08853779 实现）——任务本意就是「check source layout not consumer-laid」，line 164 的 consumer-laid deliverables 是**有意的**（验证铺入的布局），不是 stale 引用。
- **不在排除表**：`grep -c verify-delivery-surface loop-shipping-exclusion-data.mjs` = 0。其他同样引用 consumer-laid/目标布局的 checker（adr016-screen-use-check / no-manager-tick-doc-check / instrument-failure-check）都在排除表。
- **同族**：cross-cut 盲区（改 checker 但没跑/没收编 loop-shipping）——与 github-client sabotage / create-mcp / loop-shipping-threshold-scope 同族。

**为什么重要**：全量套件每轮有概率红在 loop-shipping AC1b（新 checker 引用 consumer-laid 路径但没进排除表）。这是 verify-delivery-surface fan-in 的 cross-cut 回归，修好即绿。

### 选定机制方向（实现归内层，接法留执行时）

1. **排除表收编**：`verify-delivery-surface.ts` 加进 `loop-shipping-exclusion-data.mjs`（reason=「consumer-laid 交付物引用，验证铺入布局的目标路径」——与 adr016-screen-use-check / no-manager-tick-doc-check 同类）。
2. **AC1b 回归验证**：修后 `loop-shipping.test.mjs` 12/12 绿；`--for-task` scoped 门绿。

**验证锚**：修后 (a) loop-shipping AC1b 绿；(b) verify-delivery-surface 功能不丢（consumer-laid 校验仍工作）；(c) 全量套件绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-203 实证（verify-delivery-surface.ts:164 consumer-laid deliverables 引用旧路径 + 不在排除表 + 08853779 新增）（本任务 Proposal 已含）
- [x] AC2: **排除表收编**——verify-delivery-surface.ts 进 loop-shipping 排除表（consumer-laid 目标布局引用，与同类 checker 一致）
- [x] AC3: **loop-shipping 绿**——AC1b 回归验证 12/12
- [x] AC4: **verify-delivery-surface 功能不丢**——consumer-laid 校验仍工作（--surface 模式 6/6 COVERED）
- [ ] AC5: **全量套件绿**——round-203 类场景不再红（fail 0 且 cancelled 0 且 FULL-SUITE-EXIT=0）——外层 verification-round 验证

## Definition of Done

- [ ] AC1–AC5 全部勾上（AC5 未勾——全量套件归外层 verification-round）
- [x] 修后实跑：loop-shipping 12/12 绿（贴任务体）；verify-delivery-surface --surface 6/6 COVERED
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `caused 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/loop-shipping-exclusion-data.mjs（新增 verify-delivery-surface.ts 排除条目——consumer-laid 交付物引用）
- plugin/test/loop-shipping.test.mjs（AC1b 回归验证，既有）
- tasks/gap-verify-delivery-surface-checks-source-layout-not-consumer-laid.md（交叉标注——回归源头）
- tasks/gap-loop-shipping-verify-delivery-surface-consumer-laid-ref.md（自身：勾 AC + 贴证据）

## Contract

measure   loop_shipping_ac1b_red_after_fix = `node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs 2>&1 | grep -c '✖ AC1b'` 的 stdout 数字
band      loop_shipping_ac1b_red_after_fix = 0（AC1b 绿）
invariant verify_delivery_surface_works = 1（--surface 6/6 COVERED 不回归）
invariant existing_exclusions_unchanged = 1（既有排除条目不动）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs`
control   AC1b 绿；verify-delivery-surface 功能不丢；既有排除不回归
resume    排除表条目 + 验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-203 红于 loop-shipping AC1b）——verify-delivery-surface.ts:164 consumer-laid deliverables 引用旧 tick-doc 路径且不在排除表，08853779 fan-in 新增。consumer-laid 引用是有意的（任务本意），正确修法=收编排除表（同族 adr016/no-manager/instrument-failure）。实现归内层

## Evidence（内层实现 2026-08-09）

**修复**：`plugin/scripts/loop-shipping-exclusion-data.mjs` 排除表新增
`plugin/scripts/verify-delivery-surface.ts` 条目（rel=plugin/scripts/verify-delivery-surface.ts），
reason=「consumer-laid target layout reference」——LAID_MANIFEST deliverables 有意引用消费者 laid
布局的 tick-doc 路径（orchestration/orchestrator-loop-tick.md + docs/analysis/fast-mode-loop-tick.md，
--layout laid 验证消费者 orchestration/ + docs/analysis/ 副本），与 adr016-screen-use-check /
no-manager-tick-doc-check / instrument-failure-check 同类。带 retainedNote（源-only checkout 下
LAID_MANIFEST 缺失时条目惰性——oscillation 同 batch2-queue-state/tick-log 类）。既有排除条目不动。
同步更新数据文件末尾「None of the entries above carry a retainedNote」注释（现已不成立）。

**回归源头交叉标注**：tasks/gap-verify-delivery-surface-checks-source-layout-not-consumer-laid.md
追加「交叉标注——loop-shipping cross-cut 回归」段（LAID_MANIFEST fan-in 引入盲区 + 本任务修复）。

**Contract invoke 实跑（worktree 内）**：
- `node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs`
  → **12/12 pass, 0 fail, 0 cancelled**（`grep -c '✖ AC1b'` = 0，AC1b 绿）
- `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface`
  → **surface_categories_covered=6/6**, spec_is_live=1, PASS: all 6 delivery categories covered
- necessity-check 手工复核：`plugin/scripts/verify-delivery-surface.ts` 条目分类为
  `inert ... retainedNote=YES`（非违规）；`inert_exclusions` 计数中的唯一 VIOLATION 是
  `orchestration/manager-tick-log.md`（gitignored runtime ledger，fresh worktree 缺失故惰性且无
  retainedNote）——**既有条目，main checkout 中该文件存在故非惰性**，非本任务引入、按
  「既有排除条目不动」不改。

**AC 勾选**：AC1–AC4 已勾（复现固化 / 排除表收编 / loop-shipping 12/12 / --surface 6/6）。
AC5（全量套件）未勾——归外层 verification-round；DoD 全量套件行亦未勾。

### 内层复核（2026-08-11，fresh worktree from develop 2be095ae）

任务再派发时以 develop 头部（2be095ae）fresh worktree 复核，确认修复在最新 develop 上仍成立：

```
$ bash scripts/test.sh --for-task gap-loop-shipping-verify-delivery-surface-consumer-laid-ref --allow-thin
# 12 pass / 0 fail / 0 cancelled / EXIT=0
# AC1b 绿；AC2 绿；verify-delivery-surface 功能不丢（--surface 6/6 COVERED）

$ node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs
# 12 pass / 0 fail / 0 cancelled；Contract measure `grep -c '✖ AC1b'` = 0

$ node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping-necessity-check.test.mjs
# 3 pass / 0 fail（inert_exclusions=0——全部惰性条目带 retainedNote；
#   verify-delivery-surface.ts 条目非惰性：LAID_MANIFEST:164 有实命中，抑制真实 AC1b 命中）

$ node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface
# surface_categories_covered=6/6, spec_is_live=1, PASS: all 6 delivery categories covered
```

无新增代码改动（修复 `36298bf6` 已在 develop，fan-in `ce824e9b` 已收编；exclusion 条目
`plugin/scripts/loop-shipping-exclusion-data.mjs:189-193` 存在，reason/retainedNote 完整，
既有排除条目不动）。AC1–AC4 保持勾选，AC5（全量套件）按 DoD 留待外层 verification-round 验证。
