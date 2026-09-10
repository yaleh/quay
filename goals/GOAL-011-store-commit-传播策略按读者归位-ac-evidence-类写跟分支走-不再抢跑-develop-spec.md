---
id: GOAL-011
title: store-commit 传播策略按读者归位——AC/evidence 类写跟分支走，不再抢跑 develop（SPEC 阶段2）
status: achieved
kind: goal
origin: >-
  规格正本：orchestration/SPEC-store-commit-unification-2026-09-08.md §5「阶段
  2：传播策略按读者归位」。

  该 SPEC 阶段 1（GOAL-008，已 achieved）只统一了五个 store kind 的提交原语，明确把「把 AC 勾选从『ff 到
  develop』改回『跟分支走』，并同步修 acShortCircuitVerdict」列为阶段
  2、原话「这一步会改变生产行为，必须单独一条任务、单独一轮验证」——阶段 2 从未立案。


  判准（SPEC §2.2 原文）：一个写的传播策略，由「谁读这个字段、什么时候读」决定，不由「谁写它」决定。

  读者表：派发/调度读者（ready-pool-check / slot-refill 读 develop ref）→必须尽快到 develop；该任务自己的
  fan-in（ac-precheck 读 worktree 副本）→跟分支走正好；不存在的对象（新建 task/goal）→必须到 develop。

  今天 AC 勾选 / evidence 类字段走的是第一类路径（task_write ff 到 develop），但它只被第二类读者读——SPEC
  已实测一次因此烧毁的具体事故：gap-cli-write-surface-lacks-toplevel-fields 的 worker 经 ABI 勾满 8
  条 AC（212f4e811 落 author/develop），5 分钟后 acShortCircuitVerdict 读 worktree 副本见
  0/8，exited-not-landed，烧 45 分钟并重派。


  2026-09-09 在讨论「过去 48h fan-in 落地/吞吐瓶颈/如何提高 fan-in 通过率」时独立验证到同一根因仍在发生：过去 48h 24
  次 ff-red 全部是「not a fast-forward」/「refusing to update checked out branch」，且
  SPEC 自己的 7 天基线（291 次 fan-in、31 次冲突、其中 12 次冲突落在
  tasks/*.md）与今天的读数互相印证——该缺口不是历史遗留、是仍在持续发生的生产成本。


  人在本轮对话中裁定：「根据该 SPEC 创建 goal；并激活（单次授权）」。
statusLog:
  - at: 2026-09-10T04:28:29.676Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景

SPEC-store-commit-unification-2026-09-08.md 阶段 1（GOAL-008）统一了五个 store kind（tasks/goals/meta/adr/docs-managed）的提交原语（`commitStoreWrite`，四态返回、`git rev-parse --show-toplevel` 求根），但只统一了「怎么提交」，没有动「提交到哪、什么时候传播」。SPEC §2.2 给出的判准是：一个写的传播策略由【谁读这个字段、什么时候读】决定，不由【谁写它】决定——AC 勾选 / `## Evidence` / 该 task 关联的 goal 状态更新，只被「该任务自己的 fan-in」（worktree 副本）读，却今天走的是「task_write ff 到 develop」这条只该给「派发/调度读者」和「新建对象」用的路径。

## 范围与非目标

范围：①把 AC 勾选、`## Evidence`、任务自身关联的 goal 状态更新这类"只被自己 fan-in 读"的写，从"ff 到 develop"改为"跟分支走"（落在 worktree 的 task 分支上，随该任务 fan-in 一起进 develop）；②同步修 `acShortCircuitVerdict`，使其判据覆盖 develop ref 与 worktree 副本的并集，不再对刚写完还没来得及 ff 的 worktree 副本视而不见。

非目标（明确排除，另立）：① SPEC 阶段 3（驱动侧 5 个直写点收敛，占 tasks 写面 68.4%，SPEC 原话「⛔ 不与阶段 1 混做」，本 goal 同样不与之混做）；②不改「写面保留 author」（人 2026-08-31 裁定，SPEC §6 已明确排除）；③不改动 promotion-driver 的 todo→ready、新建 task/goal 立案这类"必须尽快到 develop"的写——按读者判准它们的传播策略本就正确，不在本 goal 改动范围内。

## 退出条件

①AC 勾选 / evidence 类字段的传播路径改为跟分支走（不再 ff 到 develop），且 `acShortCircuitVerdict` 改判 develop ref 与 worktree 副本的并集；②SPEC §5 指出的「必须单独一轮验证」以经验读数兑现——**2026-09-09/10 修订**：原计划用 SPEC §5 提出的方法（fan-in 冲突率前后对照，基线：7 天 291 次 fan-in、31 次冲突、12 次在 tasks/*.md）测量，但人 2026-09-09 反馈「现有 AC 牵扯的因素太多」——实测该比率混了跟 AC/evidence 写完全无关的普通代码合并冲突，且落地窗口的并发吞吐量与 7 天基线均值不可比（45 次/11h vs 291 次/168h），比率本身既不能证实也不能证伪修复效果。改为直接测量 commitTaskWrite 自己的传播决定：新增 `.quay/store-commit-propagation.jsonl` 生产日志（gap-store-commit-propagation-log），判据变成一个硬不变式——changeKind=self-only 的写，propagated 必须恒为 false（AC-220，样本量 ≥5、0 违规实测通过）——不再是一个统计比率，直接验证的是①声称的行为本身，而非它的下游噪声代理；③2026-09-07 已实证的那类事故（ABI 勾完 AC，worktree 副本看不到，exited-not-landed 重派）在实现落地后的窗口内实测发生次数为 0（AC-221：对每条落地后短路事件用 git 历史回放 develop 当时状态、跑生产同一判定函数自动消歧真复发 vs 正常拦截，实测 0 条真复发）。
