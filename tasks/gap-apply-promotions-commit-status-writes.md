---
id: gap-apply-promotions-commit-status-writes
title: applyPromotions 写 status 后当场 commit（promotion 脏树挡 fan-in 的单一真相源修法，manager 裁定方案①）
status: ready
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

**（outer 2026-08-23 立案——manager 对「promotion 翻转不 commit → 脏树挡 fan-in」第 3 次实证的最终裁定：方案①，⛔ 推翻先前的方案③）**

**现象（实测）**：`applyPromotions()` 写 status（todo→ready）不 commit ⇒ 主检出 `git status --porcelain` 非空 ⇒ `fan-in-ff-merge.sh:205` 判脏树 exit 2，**先于 bypass-check 挡掉所有 ff**。发生率 3 次（memory `uncommitted-promotion-blocks-fan-in-clean-tree` 记 2 次 + 本次）。

**为什么是方案①而非方案③（manager 裁定，人推翻方案③）**：人指出「应参考 outer 原行为，在 develop 分支长期留一个未 commit 文件是不对的」。`promotion-driver.ts:25`「⛔ 不做任何 commit」是【权责边界】（只做 AC130-133 判据，不越界 AC135-136），⛔ 非架构安全禁令——读 :14 完整上下文可证。

**修法（精确到函数，单一真相源）**：写点不在 `promotion-driver.ts`，在 `ready-pool-check.ts:2296 applyPromotions()`——**唯一写点，且被 A22 手动路径与 driver 自动路径共用**。在这里加 commit，一次修好两个调用方。

**实现要求**：
```
applyPromotions() 每写完一个任务的 status →
  git add tasks/<id>.md && git commit -m "tasks: <id> <from>→<to>（promotion-driver 机械晋升）"
  （硬规则11：add 与 commit 之间不许有等待；-- pathspec 限定单文件，⛔ 不裸 git commit 带走别层暂存的东西）
```
批量晋升多条时：逐条 commit 或攒批一次 commit 均可——但若攒批，批与批之间同样不能有等待（收集完当轮全部 applied 后立即一次性 add+commit，⛔ 不跨轮攒）。

## Plan

1. 读 `ready-pool-check.ts:2296 applyPromotions()` 的写点。
2. 每写 status 后（或攒批后）`git add tasks/<id>.md && git commit -- <pathspec>`（硬规则 11，单文件 pathspec）。
3. 测试：晋升后主检出立即 clean。

## Acceptance Criteria

- [x] AC1（能取假）：applyPromotions 晋升一个任务后，主检出 `git status --porcelain` 立即 clean（⛔ 仍脏 ⇒ 假）。

## Definition of Done

- [x] applyPromotions 写 status 后当场 commit 落地（单一真相源，A22 手动路径 + driver 自动路径都干净），AC1 全勾，land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/ready-pool-check.ts（applyPromotions 写 status 后 commit）
- plugin/test/ready-pool-check.test.mjs（test）
- plugin/scripts/promotion-driver.ts（联调验证：晋升路径复用 applyPromotions 后不再脏树）
- tasks/gap-apply-promotions-commit-status-writes.md（自身）
