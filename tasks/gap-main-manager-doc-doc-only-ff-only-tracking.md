---
id: gap-main-manager-doc-doc-only-ff-only-tracking
title: 任务状态直落 develop 限 inert 面——tasks/*.md 直落 develop、non-inert 面留
  main/manager-doc 汇聚 + ff-only 追踪
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

**目标分支模型**（与 `gap-ff-propagate-structurally-broken-filing-must-target-develop` 配对，本任务是它的终态/下一步）。核心是「直落 develop 的边界」——**2026-08-30 人复核**，见 CLAUDE.md 分支同步节：

1. **任务状态只落 develop，且只限 inert 面**——立案、晋升、needs-human 翻转（全部为 `tasks/*.md`）直接落 develop（ref-level CAS，`1e7fb9be4` 已实现待落地）。inert 判定 = `select-static-checks-for-touches.ts --classify-delta`（`tasks/ docs/ adr/ .quay/` 等面 + 无 checker `@static-object` 命中）。**inert 翻转落在 fan-in 持锁窗口内被 `fan-in-ff-merge.sh` 的 inert re-ff 毫秒级吸收**（锁内 re-merge + 立即 re-ff，不重跑 suite，不写 retry record——`gap-fan-in-ff-retry-reruns-suite-on-inert-increment` 已实现）。
2. **non-inert 面 ⛔ 不得直落 develop**——代码 / 被 checker `@static-object` 依赖的路径若 ref-level 直落 develop，撞 fan-in 的 ff ⇒ 分类 non-inert ⇒ 返回 retry record + 整个 fan-in 从头重跑（merge→suite→ff，又一个 9–17 min，实测锁 hold 9–17min）。此类变更**必须走 main/manager-doc 汇聚 + 锁外 ff 同步**，不得以「直落 develop」绕过。**CAS 不等锁**（`update-ref refs/heads/develop <new> <old>`，old-oid guard，develop 并发前进则失败无害、下一轮重试）——不存在「等 fan-in 锁几十分钟」。
3. **main/manager-doc = 非权威汇聚点**——承载 non-inert 非 driver 变更 + 文档；任务状态不再承载（inert 面直落 develop）。
4. **develop→doc 同步改 ff-only 追踪**——main/manager-doc 只做 `git merge --ff-only develop`，绝不 merge-fallback；非 ff 即当场暴露（硬规则 3b）。
5. **inert 面直落 + non-inert 汇聚的属性加 guard**——main/manager-doc 上出现本应直落 develop 的任务状态提交、或 ref-level 直落出现 non-inert 路径，即报红。

**与 gap-ff-propagate 的分工**：该任务管写侧机制（立案/翻转 ref-level 直落 develop + propagate 退役）；本任务管分支模型终态（inert 直落 / non-inert 汇聚 + ff-only 追踪 + guard）。本任务依赖写侧先落。

## Plan

1. 写侧落地后（ff-propagate 退役、任务状态 ref-level 直落 develop），把 main/manager-doc 上残留的任务状态提交收敛掉（历史不改，HEAD 以上归零）。
2. develop→doc 同步从 propagate 的 merge-fallback 改为 `git merge --ff-only develop`；非 ff 时 guard 报红而非静默 catch。
3. 立边界 guard：① ref-level 直落 develop 的调用点只写 inert 面（`tasks/*.md`）；② main/manager-doc 新增提交不含本应直落的任务状态。
4. 用真实晋升/立案各一次做负控制：状态只出现在 develop（inert 直落）、main/manager-doc 无对应提交；且 fan-in 持锁窗口内 develop 无 non-inert 前进。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：同步后 `git rev-parse main/manager-doc develop` 两 ref 相等（同一次 commit）；（⛔ 仍分叉 ⇒ 假）。
- [ ] AC2（能取假，guard）：main/manager-doc 上新增提交不含任务状态——`git diff --stat develop...main/manager-doc -- tasks/` 为空；含即 guard 报红；（⛔ 静默分叉 ⇒ 假）。
- [ ] AC3（能取假，ff-only）：develop→doc 同步不再 merge-fallback——grep 无 `git merge develop` 兜底；非 ff 时报「无法 ff-only 同步」（独立取值，非「同步成功」同形）；（⛔ 仍静默 catch ⇒ 假）。
- [ ] AC4（能取假，真实载体）：一次真实晋升翻转后 `git show develop:tasks/<id>.md` 的 status 为翻转后值、main/manager-doc 无该提交；（⛔ 状态仍只在 doc 分支 ⇒ 假）。
- [ ] AC5（能取假，inert 边界）：ref-level 直落 develop 的调用点只写 inert 面——grep `commitFileToRef`/ref-level 落 develop 的 rel 全为 `tasks/*.md`；（⛔ 出现 non-inert 路径直落 ⇒ 假）。

## Definition of Done

写侧（gap-ff-propagate）落地后：任务状态只经 inert 面直落 develop、non-inert 面留 main/manager-doc 汇聚；develop→doc 同步改 ff-only 追踪；inert 边界 guard 接线；AC1-AC5 全勾；一次真实晋升/立案证明 inert 直落、一次 fan-in 持锁窗口验证无 non-inert 前进。

## Touches

- plugin/scripts/driver-filters.ts（propagateDocBranchToDevelop 退役；ref-level 直落 develop 限 inert 面）
- plugin/scripts/ready-pool-check.ts（调用点：applyPromotions 读 develop、翻转落 develop）
- plugin/scripts/promotion-driver.ts（晋升翻转路径）
- CLAUDE.md（分支同步纪律更新：inert 直落 / non-inert 汇聚边界 + ff-only）
- tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md（自身）