---
id: gap-main-manager-doc-doc-only-ff-only-tracking
title: main/manager-doc 纯文档化 + ff-only 追踪——任务状态只落 develop、doc 分支同步不再靠 propagate
  merge-fallback
status: todo
labels:
  - gap
parent: gap-ff-propagate-structurally-broken-filing-must-target-develop
children: []
extra: {}
---
**type:** execution

## Proposal

main/manager-doc 当前既承载文档（CLAUDE.md、orchestration/*.md），又承载任务状态提交（立案、todo→ready 晋升翻转）——后者与 develop 上的 fan-in「done」翻转各自产生对方没有的提交，两分支永远分叉，propagate 的 ff push 永远 non-fast-forward，fallback `git merge develop` 每次冲突（实证 2026-08-30：主检出卡 10 个 UU 半合并态；近 30 天 `Merge branch 'develop' into main/manager-doc` 1795 次全由 propagate fallback 产生）。

**目标分支模型**（与 `gap-ff-propagate-structurally-broken-filing-must-target-develop` 配对，本任务是它的终态/下一步）：

1. **任务状态只落 develop**——立案、晋升、needs-human 翻转全部直接落 develop（ref-level，`1e7fb9be4` 已实现待落地；write-side 完成后 develop 为任务状态唯一正源）。
2. **main/manager-doc 纯文档化**——只含 CLAUDE.md / orchestration docs / 非任务非代码文件；不再承载任务状态。
3. **develop→doc 同步改 ff-only 追踪**——main/manager-doc 只做 `git merge --ff-only develop`，绝不 merge-fallback；非 ff 即当场暴露（硬规则 3b：读不懂/同步不了必须取独立态，不得与「同步成功」同形）。
4. **doc-only 属性加 guard**——main/manager-doc 上出现非文档提交（任务文件/产品代码）即报红，不再静默分叉。
5. **「同步到同一次 commit」重新定义**——不是「两 ref 任意时刻相等」（develop 每时每刻被 fan-in 推进，机制上做不到），而是「每次同步循环结束时两 ref 指向同一 SHA，两次同步之间的漂移只限文档增量这一种可廉价 ff 收敛的类型」。

**与 gap-ff-propagate 的分工**：该任务管写侧（立案/翻转直落 develop + propagate 退役）；本任务管分支模型终态（main/manager-doc 纯文档化 + ff-only 追踪 + doc-only guard）。本任务依赖写侧先落。

## Plan

1. 写侧落地后（ff-propagate 退役、任务状态直落 develop），把 main/manager-doc 上残留的任务状态提交收敛掉（历史不改，HEAD 以上归零）。
2. develop→doc 同步从 propagate 的 merge-fallback 改为 `git merge --ff-only develop`；非 ff 时 guard 报红而非静默 catch。
3. 立 doc-only guard：main/manager-doc 新增提交含 tasks/ 或产品代码即拦截。
4. 用真实晋升/立案各一次做负控制：状态只出现在 develop、main/manager-doc 无对应提交。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：同步后 `git rev-parse main/manager-doc develop` 两 ref 相等（同一次 commit）；（⛔ 仍分叉 ⇒ 假）。
- [ ] AC2（能取假，guard）：main/manager-doc 上新增提交不含任务文件/产品代码——`git diff --stat develop...main/manager-doc -- tasks/ packages/ plugin/scripts/` 为空；含即 guard 报红；（⛔ 静默分叉 ⇒ 假）。
- [ ] AC3（能取假，ff-only）：develop→doc 同步不再 merge-fallback——grep 无 `git merge develop` 兜底；非 ff 时报「无法 ff-only 同步」（独立取值，非「同步成功」同形）；（⛔ 仍静默 catch ⇒ 假）。
- [ ] AC4（能取假，真实载体）：一次真实晋升翻转后 `git show develop:tasks/<id>.md` 的 status 为翻转后值、main/manager-doc 无该提交；（⛔ 状态仍只在 doc 分支 ⇒ 假）。

## Definition of Done

写侧（gap-ff-propagate）落地后：main/manager-doc 纯文档化；develop→doc 同步改 ff-only 追踪；doc-only guard 接线；AC1-AC4 全勾；一次真实晋升/立案证明状态只落 develop。

## Touches

- plugin/scripts/driver-filters.ts（propagateDocBranchToDevelop 退役；改 ff-only 追踪 + doc-only guard 调用点）
- plugin/scripts/ready-pool-check.ts（调用点：applyPromotions 读 develop、翻转落 develop）
- plugin/scripts/promotion-driver.ts（晋升翻转路径）
- CLAUDE.md（分支同步纪律更新：main/manager-doc 纯文档化 + ff-only）
- tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md（自身）
