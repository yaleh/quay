---
id: GOAL-008
title: 五种 store kind 的提交面统一 —— 一个原语、四态返回、传播跟读者走
status: active
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
