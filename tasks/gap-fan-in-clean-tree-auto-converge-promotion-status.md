---
id: gap-fan-in-clean-tree-auto-converge-promotion-status
title: fan-in clean-tree 判据前自动收敛 promotion-driver 的 status-only 翻转（manager 裁定方案③，⛔ 非路径排除）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（outer 2026-08-23 立案——manager 对「promotion 翻转不 commit → 脏树挡 fan-in」第 3 次实证的裁定：方案③，⛔ 排除①②）**

**现象（实测）**：promotion-driver 翻转 status（todo→ready）写盘但不 commit ⇒ 主检出 `git status --porcelain` 非空 ⇒ `fan-in-ff-merge.sh:205` 判脏树 exit 2，**先于 bypass-check 挡掉所有 ff**。发生率 3 次（memory `uncommitted-promotion-blocks-fan-in-clean-tree` 记 2 次 + 本次 `6d4ef4d8`）。

**为什么排除①②（manager 裁定）**：
- ①promotion-driver 自己 commit：`promotion-driver.ts:25` 明写「驱动 ⛔ 不做任何 commit」——有意架构边界，改它 = 重开已裁定边界。
- ②clean-tree 判据路径级排除 `tasks/*.md`：太粗——`fan-in-ff-merge.sh:202` 的严格性是故意保护「caller 破坏了协议假设」这类真实错误；目录级排除会连带放过非 promotion 造成的脏（如误操作手工编辑）。

**裁定（方案③，⛔ 内容级校验非路径排除）**：fan-in-ff-merge.sh 自己在 clean-tree 判据【之前】做窄范围 housekeeping commit——
```
判据：porcelain 输出【全部】限于 tasks/*.md，且逐个文件 diff 【只命中】YAML frontmatter 的
     status: 字段（⛔ 按 diff 内容判定，非路径；任何混进 tasks/*.md 的其它改动都不满足「只命中 status」）
动作：git add tasks/ && git commit -m "tasks: promotion-driver 翻转（fan-in 自动收敛）"（清楚归因，可查）
再动作：走原 clean-tree 判据，此时应已 clean，继续 ff
```
非 status-only 的脏仍然照挡（保护范围不放宽）。

**⊢ 降级说明（manager 2026-08-23 补，⛔ 不重写判据）**：人推翻方案③改判方案①（`gap-apply-promotions-commit-status-writes`：`applyPromotions()` 写 status 后当场 commit）。本任务定位从「主要修法」降为「防御纵深（兜底）」——applyPromotions 修好后晋升路径不再产生脏树，本任务兜底的是**其它不经过 applyPromotions 的写入源**若产生同类 status-only 脏时的收敛。判据不变（AC1 正向收敛 / AC2 非 status 仍挡）。

## Plan

1. 读 `fan-in-ff-merge.sh` clean-tree 判据（:205 前）加 status-only 收敛逻辑。
2. 收敛判据：porcelain 全限 tasks/*.md + 逐文件 diff 只命中 frontmatter `status:` 字段。
3. 收敛动作：`git add tasks/ && git commit`（归因清楚），再走原 clean-tree 判据。
4. 测试：正向（status-only 收敛继续 ff）+ 负向（非 status 脏仍 exit 2）。

## Acceptance Criteria

- [x] AC1（正向，能取假）：porcelain 仅含 `tasks/*.md` 的 status-only diff 时，fan-in 自动收敛并继续完成 ff，⛔ 不应报脏树 exit 2。
- [x] AC2（负向，能取假）：porcelain 含非 status 字段改动（如 tasks/*.md 正文或非 tasks 路径）时，仍报脏树 exit 2，⛔ 不应静默通过。

## Definition of Done

- [x] fan-in clean-tree 判据前自动收敛 status-only 翻转 + 非 status 脏仍挡，AC1-2 全勾，land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/fan-in-ff-merge.sh（clean-tree 判据前加 status-only 收敛 commit）
- plugin/test/fan-in-ff-merge.test.mjs（test）
- tasks/gap-fan-in-clean-tree-auto-converge-promotion-status.md（自身）
