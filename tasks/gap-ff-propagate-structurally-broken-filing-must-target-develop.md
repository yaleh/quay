---
id: gap-ff-propagate-structurally-broken-filing-must-target-develop
title: ff-propagate 结构不可用——立案落 main/manager-doc 靠 ff 到 develop 永远分叉；立案必须直接落 develop
status: ready
labels:
  - gap
parent: null
children:
  - gap-main-manager-doc-doc-only-ff-only-tracking
extra: {}
---
**type:** execution
## Proposal
`propagateDocBranchToDevelop`（driver-filters.ts:207，ff push main/manager-doc → develop）结构上不可用：fan-in 落 develop 的「done」提交（driver 机械翻 done + merge commit）与立案落 main/manager-doc 的「ready」提交各自产生对方没有的提交 ⇒ 两分支永远分叉 ⇒ ff 永远 non-fast-forward。实证 2026-08-30：分叉 develop-only 39 / main/manager-doc-only 13，全是这个模式。正确机制：**立案直接落 develop**（与 `gap-dispatch-reads-stale-main-checkout-task-status` 读 develop 配对）。

**⛔ 架构复核（2026-08-30，人确认）——「分叉」不是病根，是设计**：两分支各自演进（develop 被 fan-in 持续推进、main/manager-doc 是 doc-only 分支）**应当长期存在**。写侧 ref-level 落 develop（实现 `1e7fb9be4`）**兼容**该模型——绕开分叉、不收敛分支、develop→main/manager-doc 反向同步（worker-driver landing）保留，不破坏两分支模式。**真正的问题 = 晋升读侧仍在盘上**：

- **机制级确认（2026-08-30）**：ready-pool-check `--apply`（promotion-driver 的晋升路径）**读盘上**——`ready-pool-check.ts:2689` 的 `base` 不含 `taskReadRef`、`:2701` 只给**非 apply 的分析路径**补 `taskReadRef: develop`、`applyPromotions(base)` 走盘上解析；无 CLI 标志、无测试断言晋升读 develop。
- 而写侧（`1e7fb9be4`）落 develop 后 `git checkout -- rel` 把**盘上 restore 回旧状态** ⇒ **晋升每轮读盘上旧状态重复晋升、develop 累积同内容提交**（直到某次 landing 反向 merge 把 develop 带回盘上才停）。
- `gap-dispatch-reads-stale-main-checkout-task-status` 的「dispatch 读面 done」只覆盖 **slot-refill + 分析路径**，**不含 --apply 晋升决策路径** ⇒ 不能作为本任务写侧的释放条件。
- ⇒ **写侧（1e7fb9be4）不得先于「晋升路径读 develop」落**。

## Plan
1. 立案提交目标分支改为 develop（过渡期 (c) 落 main/manager-doc + manager clean-window merge；dispatch 读 develop 落地后终态 (a) 用 develop worktree 提交）。
2. `propagateDocBranchToDevelop` 退役或加 guard（再有人按老模式立案落 main/manager-doc 即报红）。
3. 与 `gap-dispatch-reads-stale-main-checkout-task-status` 配对：dispatch 读 develop 后 (a) 才闭环。
4. **⛔ 时序硬门（2026-08-30，人裁定）：本任务写侧实现（1e7fb9be4）的 fan-in 暂缓**——先让晋升路径读 develop（见 Needs-Human 释放条件），否则晋升读盘上旧状态重复晋升。

## Acceptance Criteria
- [ ] AC1（能取假，机制级）：新立案提交目标分支 = develop（grep 最近立案 commit 的 parent 是 develop 非 main/manager-doc）；（⛔ 仍落 main/manager-doc ⇒ 假）。
- [ ] AC2（能取假，guard）：ff-propagate 退役或加 guard——再按老模式（立案落 main/manager-doc）立案即报红，不再静默分叉；（⛔ 仍静默 ⇒ 假）。
- [ ] AC3（能取假，配对 + 时序）：`gap-dispatch-reads-stale-main-checkout-task-status` 落 done 后 (a) 闭环（dispatch 读 develop、立案落 develop 两端一致）；（⛔ 依赖未落即标闭环 ⇒ 假）。**⛔ 且晋升路径（ready-pool-check --apply）读 develop 是写侧落地的硬前置**——该路径仍读盘上时 fan-in 本任务落地 = 假。
## Definition of Done
立案目标切 develop；ff-propagate 退役或加 guard；AC1-AC3 全勾；**晋升路径（--apply）先读 develop、写侧再落**；dispatch 读 develop 与立案落 develop 两端配对闭环。
## Touches
- plugin/scripts/driver-filters.ts（propagateDocBranchToDevelop 退役或加 guard）
- plugin/scripts/ready-pool-check.ts（调用点：ff-propagate 退役后调用点移除/改 + **applyPromotions 路径补 taskReadRef: develop**）
- tasks/gap-ff-propagate-structurally-broken-filing-must-target-develop.md（自身）

## Needs-Human
**2026-08-30 — 人裁定暂缓 fan-in（写读时序硬门）**
- 原因：写侧（1e7fb9be4）落 develop 后盘上 restore 回旧状态；而晋升路径（ready-pool-check `--apply`，promotion-driver 所用）**读盘上**（`ready-pool-check.ts:2701` applyPromotions(base) 未传 taskReadRef）⇒ 晋升每轮读旧状态重复晋升、develop 累积同内容提交。「两分支分叉」是设计不是病根，写侧已兼容；问题在晋升读盘 vs 写侧落 develop 不同步。
- **释放条件 + 顺序（2026-08-30，人裁定）**：
  1. **① 晋升路径读 develop**——已并入 `gap-dispatch-reads-stale-main-checkout-task-status` 的 **AC6**（`ready-pool-check.ts:2701` 改 `applyPromotions({ ...base, taskReadRef: develop })` + 晋升单测断言读 develop）；**该 AC6 落 develop 后**方可进入 ③。
  2. **② web 显示部分**（该任务 AC1-AC5：updated 同源/详情页 develop-first/分歧标记）与 ① 独立，可并行或随后落。
  3. **③ 本任务落地**：① 落 develop 后，把本任务从 needs-human 重新 promote 到 ready → fan-in `1e7fb9be4`（写侧落 develop，propagateDocBranchToDevelop 退役）。
  4. **④ 收尾**：AC1（新立案直接落 develop）+ AC3（dispatch 读 develop 与立案落 develop 两端一致）闭环。
  - ⛔ **不得跳过 ① 直接 fan-in**——晋升路径仍读盘上时写侧落地 = 重复晋升。