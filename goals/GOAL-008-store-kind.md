---
id: GOAL-008
title: 五种 store kind 的提交面统一 —— 一个原语、四态返回、传播跟读者走
status: achieved
kind: goal
origin: >-
  人 2026-09-08：「显然，我们应当讨论如何为 task 的提交构建更统一的机制。而且不光是 task，还有 goal 和 meta
  等类型的文件。」并给出四条裁定：①五 kind 统一机制 ②adr / docs-managed 也要有 commit-after-write
  ③倾向简化设计（排除「完全不提交、会话末尾一起提交」，采纳「提交到当前检出」为默认）④可选参数显式覆盖。


  规格正本：orchestration/SPEC-store-commit-unification-2026-09-08.md（已落 develop）。


  实测现状（2026-09-08）：五个 store kind 中 tasks/goals/meta 各有一套互不相同的
  commit-after-write，adr/docs-managed 完全没有。四类实质分歧：①root 解析（store.ts 用 git
  rev-parse --show-toplevel，goal/meta 用 path.dirname(<kind>Dir)
  这一「恰好等于当前布局」的假设，硬规则 4 推论二，实测 2 处）②传播（只有 tasks ff-push
  develop）③幂等（三种各不相同）④失败词表（只有 tasks 四态；goal/meta 把「不在 git 里」「内容没变」「commit
  真失败」压成同一个 false，硬规则 3b）。


  核心判准：传播策略由【谁读这个字段、什么时候读】决定，不由【谁写它】决定。该判准解释了 2026-09-07
  的一次实测烧毁：gap-cli-write-surface-lacks-toplevel-fields 的 worker 经 ABI 勾满 8 条
  AC（212f4e811 落 author/develop），5 分钟后 acShortCircuitVerdict 读 worktree 副本见 0/8
  ⇒ exited-not-landed，烧 45 分钟并重派。


  现成的缝：frontmatter-store-base.ts 已抽出 parse/serialize/lockfile/filename
  共享机件（"shared MECHANICS, independent SCHEMAS"），而 commit-after-write 是纯 MECHANIC
  却不在里面。


  范围：本 goal 只覆盖 SPEC 阶段 1（原语 + 五 kind 接线）。阶段 2（传播按读者归位，含修
  acShortCircuitVerdict）与阶段 3（驱动侧 5 个直写点，占 tasks 写面 68.4%）另立。


  ---


  【2026-09-08 重开，人裁定】GOAL-008 于 04:54 由 driver 机械 flip 为 achieved（AC-195..199 全
  pass，

  经机械 fan-in 全量 suite 落地，生产载体已换新原语——04:54 起 goals 提交消息为「（store-commit）」）。

  管理者复核后报出：**SPEC §8 要求的残留 evidence 块清理未做，且五条 AC 均不覆盖它**（立 goal 时的漏）。

  人裁定「补一条 AC-200 重开 GOAL-008」⇒ 本记录 status 由 achieved 退回 active，AC-200 为其新增判据。


  复核同时确认的两点（不改变本 goal 的范围，记在此备查）：

  ① AC-197「五 kind 全接线」对 adr（7 天 3 条提交）与 docs-managed（7 天 0 条）**只有单测证据、零生产写入**——
     证据等级弱于 goals/meta/tasks（后三者有 04:54 的生产提交作证）。
  ② tasks 侧的分支感知**没有回归**：store.ts:1129 传 propagate:"none" 并保留三分支逻辑
     （task/ 分支不推 develop），未出现「任务分支直推 develop 绕过 fan-in」的风险。
---

## 背景

五个 store kind 的 commit-after-write 互不一致：tasks/goals/meta 各有一套互不相同的实现，adr/docs-managed 完全没有。四类实质分歧：①root 解析（store.ts 用 git rev-parse --show-toplevel，goal/meta 用 path.dirname(<kind>Dir) 这一「恰好等于当前布局」的假设）②传播（只有 tasks ff-push develop）③幂等（三种各不相同）④失败词表（只有 tasks 四态；goal/meta 把「不在 git 里」「内容没变」「commit 真失败」压成同一个 false）。核心判准：传播策略由【谁读这个字段、什么时候读】决定，不由【谁写它】决定。现成的缝：frontmatter-store-base.ts 已抽出 parse/serialize/lockfile/filename 共享机件，而 commit-after-write 是纯 MECHANIC 却不在里面。

## 范围与非目标

范围：本 goal 只覆盖 SPEC 阶段 1（一个原语 + 五 kind 接线）。阶段 2（传播按读者归位，含修 acShortCircuitVerdict）与阶段 3（驱动侧 5 个直写点，占 tasks 写面 68.4%）另立。

非目标/备注：AC-197「五 kind 全接线」对 adr（7 天 3 条提交）与 docs-managed（7 天 0 条）只有单测证据、零生产写入——证据等级弱于 goals/meta/tasks；tasks 侧分支感知无回归（store.ts:1129 传 propagate:"none" 并保留三分支逻辑）。

## 退出条件

SPEC 阶段 1 完成：AC-195..199 全 pass，经机械 fan-in 全量 suite 落地，生产载体换新原语（04:54 起 goals 提交消息为「（store-commit）」）。重开后补 AC-200（残留 evidence 块清理）。现已 achieved。
