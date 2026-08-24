# 派发倾向（dispatch preference）—— 正本

> 本文件是 inner 选择「先派谁」时的倾向正本（`SPEC-dispatch-ordering-semantic-2026-08-13.md` §4）。
> 机制只答「能不能派」（disjointness / deps-ready / self-touch / 非 PARKED / 非 compound）；
> 本文件承载「先派谁」的**语义倾向**。三段齐全：**默认段 / 覆盖段 / 维护者字段**；
> 缺任一段即视为文件被破坏（`dispatch-preference-check.ts` 报红，AC54 判据2）。
> 本文件 **git 可见**（不在 gitignored 的 `.quay/` 下），可 diff、抗 compact、跨会话重启存活。

## 默认段

manager 不在时生效（inner/outer 独立运行时回落到这一段）。

- **红窗优先**：存在红色（失败）继承/未收敛红窗时，优先派发与其直接相关的任务。
- **gap 优先于 DIR**：`label:gap` 任务优先于 `label:directive` 任务。
- **其余任选**：同尺寸互斥集内，由 inner 按语义选择，并把「为什么选它」写进派发记录（AC55 产物）。

## 覆盖段

manager 在时的当前倾向（本阶段优先）。

- **2026-08-24T07:4xZ 起（manager 裁定，实测驱动——见 `gap-worker-driver-stopreason-latch-permanent-stop`
  与 `gap-worker-needs-human-destroys-branch-worktree` 两条任务体的量化证据）：以下两条
  `label:delivery-critical` 任务优先于池中其它任务，除非结构上不可派（Touches 冲突/依赖未满）：**
  - `gap-worker-driver-stopreason-latch-permanent-stop`（worker-driver 瞬时资源闸拒绝被永久 latch，
    实测单次停摆损失 ≈3.4 条任务的槽位时间，且此刻仍在复发）
  - `gap-worker-needs-human-destroys-branch-worktree`（AC 闸拒绝翻 done 后走孤儿清理销毁分支+worktree，
    实测已发生 2 次数据丢失）
  - 两条落地后（或从池中移除后），此条优先级项失效，回落到下一条「本阶段」倾向或默认段。
- ~~本阶段（语义派发，AC54–AC57）：优先派发与阶段目标直接相关的任务~~ **陈旧，2026-08-24 manager 核实
  ——AC54-57 所属阶段早已推进，`manager-phase-goal.md` 当前段为 AC54–AC78（详见该文件，不在此复制），
  且当前实际派发已在 AC120+ 序列；本行不再代表当前倾向，保留仅供追溯，下次覆盖段整体刷新时删除。**
- **覆盖段生效条件**：manager 在场（可见、维护）。manager 不在场时回落到默认段。

## 维护者字段

- **维护者**：manager（负责更新覆盖段；`manager-phase-goal.md` 归属逐字「manager 定义要什么/怎么判 + 维护倾向文件的覆盖段」）。
- **默认段的维护**：inner/outer 在 manager 缺席时按需修订；修订须带回覆盖段并在本字段登记变更。
