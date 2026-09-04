---
id: gap-fan-in-failure-semantic-subagent
title: fan-in 失败处置改语义 subagent——输入完整现场输出原因分类，outcome_class 替换 advanceRetryCap
  的裸退出码（SPEC §4）
status: superseded
labels:
  - gap
  - feature
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-suite-lifecycle-driver-kind
  superseded: true
  superseded_at: 2026-08-27
  superseded_by: gap-fan-in-driver-mechanical-orchestration
---
**type:** execution
> **SUPERSEDED / 作废（人 2026-08-27 裁定，新 SPEC gap-fan-in-driver-mechanical-orchestration）**：语义 subagent 概念重定向到 driver，并入新 SPEC「失败点唤起 Claude 会话」（happy-path 之后的步骤），非独立任务；Touches 含已退役 fan-in-execute.js。历史分析保留，不重开。

> **正本**：`orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md` §4。**⛔ 边界**：lane/S 不动；⛔ 不为语义 agent 设准确率阈值（成本结构未测量前不设数值阈值，硬规则 4 推论）。
> **前置**：`gap-suite-lifecycle-driver-kind`（§3）先落地——其 carrier（suite-round.jsonl 三态 outcome）是本条输入前提之一。
> **⛔ 裁决（2026-08-26，`gap-fan-in-workflow-lock-and-S1` AC6 / SPEC-fan-in-workflow-lock-and-S1-2026-08-26 §3 约束 5）**：
> **`ff-race-loss` class 砍掉**。fan-in WORKFLOW 锁落地后，develop 在持锁任务 fan-in 期间【不前进】⇒ ff-race
> **结构上不可能发生**（24h 实测 27 次 ff-race 全部归零）⇒ 为 0 发生率 class 保留 `rebase-and-retry` 恢复路径是
> 「为 0 发生率保留恢复路径」的镜像错误。**保留**：`suite-red-own` / `suite-red-other-task` / `infra-hang` /
> `gate-blocked` 的语义分类。落地本条时 ⛔ 不得再实现 ff-race-loss 与 rebase-and-retry 分支。

## Proposal

**把 fan-in 失败的「之后怎么办」从机械计数器升级为 workflow 末端的语义 subagent，让它产出【原因分类】，再由既有机械机制按分类执行。**

**⊢ 为什么机械判据必然不够（SPEC §4.1，人判断）**：
- 重试上限：机械计数器只数次数，数不出「三次是不是同一原因」「是不是任务自己的错」。
- ff-only 输了：机械重试只能「整份重来」，判断不了「rebase 一下就行」「develop 新提交与我根本不冲突」。

**⊢ 实测坐实（SPEC §1.1 泄漏②，manager 自查推翻自己前一轮判断）**：`gap-ac143` 三次 `exited-not-landed` 在 `fan-in-retries` / `fan-in-merge-lock-events` / `fan-in-ff-escalations` 三处载体**全部 0 命中**（正控制：同谓词对 load-sampler-orphan 有命中）⇒ 无一次走到过 ff-merge 这一步，却被「该不该放弃」计数器等价计数 → needs-human。**同族** `cause-carrier-must-be-distinguishable`：把「任务自己的问题」与「系统欠它的资源」压成一个整数。

**⊢ 定量依据（manager 24h 窗口，verification-round + per-task-suite-records + fan-in-retries 三载体交叉，非单源）**：最近 24h 的 28 个 fan-in 任务——
```
suite 总运行 52 次，平均每个 fan-in 跑 1.86 次 suite
suite 真红 = 0 次（52 全绿，verification-round 完整红绿记录，非只记绿的假零）
ff-race 失败 = 27 次（27/28 = 96.4% 任务撞上）
额外 suite 运行（=ff-race 整份重跑）= 24/52 = 46.2%
白费墙钟 = 11.02h / 17.80h = 61.9%（最惨 load-sampler-orphan 8 次 suite 白费 5.1h）
```
**⊢ 含义**：suite 红与 infra-hang 在 24h 内 **0 次**——当前把「ff-race 输」「suite 红」「挂死」压进同一个退出码、喂给同一个 `advanceRetryCap`，是在为一件**发生率 0** 的事保留昂贵的「整份重跑」语义。**62% 墙钟纯由 ff-race 的「整份作废→重跑」造成，且多数 ff-race 是「develop 那条新提交与本分支根本不冲突」**（rebase 一下就行）⇒ AC3 落地理论上可回收这 46% 次数 / 62% 墙钟，是当前所有改进方向里投入产出比最高的一项（suite 执行本身 0 失败，压 suite 已无油水）。

**⊢ 形态（SPEC §4.2）**：
```
(a) 输入 = 完整现场（⛔ 非退出码）：失败发生在哪一相（suite/gate/ff）、suite 红的具体文件与断言、
    ff 时 develop 尖端 sha 及本分支与它的实际 diff 是否冲突、历史失败次数及各自原因
(b) 输出 = 分类 + 建议动作（⛔ 不直接执行）：
    outcome_class: suite-red-own | suite-red-other-task | infra-hang | gate-blocked
    suggested:     retry-as-is | fix-then-retry | escalate-human | defer-with-reason
    confidence:    high|medium|low + 理由
    ⇒ agent【判定】，机械机制【执行】——不把「能不能改 develop」交给 agent 自由裁量
(c) outcome_class 天然就是泄漏②缺的那个原因分类层——⛔ 不需要另造
(d) 必须有「我判不了」的独立取值（outcome_class: unknown + evaluated: false），⛔ 不得与「没问题」同形
   （硬规则 3b）；判不了退回当前机械行为（保守重试或升级人），⛔ 不静默放行
```

**⊢ 与 advanceRetryCap 的接线**：重试上限改读 `outcome_class`（不再读裸退出码），「降 cap 让路」与「放弃」订阅不同 class——它们从来不是策略打架，是被喂了同一个不分原因的输入。

## Plan

1. fan-in workflow 末端加失败处置 subagent：输入完整现场，输出 outcome_class + suggested + confidence。
2. `advanceRetryCap` 改读 outcome_class（替换裸退出码输入），按 class 路由「降 cap 让路」vs「放弃」。

## Acceptance Criteria

- [ ] AC1（能取假，输入完整现场）：失败 subagent 输入是完整现场（失败相 / suite 红文件+断言 / ff 时 develop sha + diff 冲突 / 历史失败+各自原因），⛔ 非一个退出码；（⛔ 只喂退出码 ⇒ 假——垃圾进垃圾出）。
- [ ] AC2（能取假，判定与执行分离）：输出 outcome_class + suggested + confidence，agent 只判定、机械机制执行（⛔ 不把改 develop 的权限交给 agent 自由裁量）；（⛔ agent 直接改 develop ⇒ 假）。
- [ ] AC3（能取假，替换裸退出码）：advanceRetryCap 改读 outcome_class，「降 cap 让路」与「放弃」订阅不同 class（不再读同一个不分原因的退出码）；（⛔ 仍读裸退出码 ⇒ 假）。
- [ ] AC4（能取假，unknown 独立取值）：判不了时输出 `outcome_class: unknown` + `evaluated: false`（退回机械行为），⛔ 不得与「没问题」同形、不得静默放行；（⛔ 判不了与没问题同形 ⇒ 假）。

## Definition of Done

失败处置语义 subagent 落地；AC1-AC4 全勾；outcome_class 替换裸退出码输入；判不了可区分。

## Touches

- .claude/workflows/fan-in-execute.js（末端失败处置 subagent）
- plugin/workflows/fan-in-execute.js（dual-copy 同步）
- plugin/scripts/worker-driver.ts（advanceRetryCap 改读 outcome_class）
- plugin/test/（outcome_class 路由 + unknown 独立取值负控制）
- tasks/gap-fan-in-failure-semantic-subagent.md（自身）
