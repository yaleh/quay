---
id: GOAL-914
title: goal-driver 自驱闭环：立案生命周期、下一步投影与请求消费（quay-native）
status: active
kind: goal
origin: 人 2026-11-06 授权：按 1 goal + 4 AC + 6 task 的结构立案；先定位/修复 driver 读 store，再建
  goal 与任务，激活前核 Touches/依赖。
activatedAt: 2026-11-06T07:25:14.586Z
statusLog:
  - at: 2026-11-06T07:25:14.586Z
    from: draft
    to: active
    actor: goal-cli
    reason: 人 2026-11-06 授权激活：1 goal + 4 AC + 6 task 结构；Touches/依赖已核
---
## 命题

quay 的 goal 层现在只能"验收"：每轮对 active AC 跑判据、机械翻转、算缺口，并在四种缺口态下 spawn 短命 agent 立案。它不能把自己的读数变成可执行的下一步，也不能确认"立案是否真的发生"，更不能把上层（manager / fleet / 人）的「请重新评估这条判据」接住。结果是：goal 的推进仍然依赖人读 round fact、人写任务、人恢复卡住的任务。

本 goal 把 goal-driver 从"验收环"补成"驱动环"，但严格保持在 quay 的边界内：goal 侧只产出读数、状态翻转、立案与请求消费；task 的晋升/派发/落地仍归 promotion-driver 与 worker-driver；通知、卡片、跨项目仍归 quay-fleet。本 goal 不引入任何对 quay-fleet 的依赖。

## 范围

- AC-934 立案生命周期：每次 gap spawn 落 `.quay/goal-filing.jsonl`，下一轮独立核实是否真的出现了带 `goal_ac` 的任务；`filed` / `not-filed` 是两个可区分的终态，`not-filed` 触发有界重试而不是无限重派。
- AC-935 下一步投影：每个 active GOAL 产出恰好一行 `{ac, gapState, owner, action}`；`owner` 是枚举（driver / worker / human / world），`action` 是枚举动作；同一行写进 round fact 并有 `quay goal next --json` 读面。
- AC-936 请求消费：`quay goal request <goal> <ac> --reason` 写入 `.quay/goal-requests.jsonl`；goal-driver 每轮消费 `submitted` 行并写 `accepted/refused/not-evaluated`，幂等。
- AC-937 端到端：一条由 driver 自己立案（无预置任务）的任务，经 promotion/worker 落地，并使该 AC 机械翻 achieved；整链在真实账本中可回查。AC-937 故意不预置任务，它是 driver 自己立案路径的直接量。

## 非目标

- 不写 task 状态（DIR-131 边界不变）：恢复/重派/关闭仍归 promotion/worker 或人。
- 不做通知、卡片、跨项目编排；这些是 quay-fleet 的层。
- 不自动激活 draft GOAL（SPEC §0 裁定 3 不变）；激活就绪读数只作为后续 task。
- 不引入 quay-fleet 的 ActionRequest 契约；quay 的请求面是自己的 `goal request` 队列。
- 不改 AC 判据的执行语义（criterion 仍是读数，不得成为无人值守的写者）。

## 退出条件

AC-934..937 均 achieved，且每条都有实现落地之后的生产载体读数：AC-934 至少一条真实 `filed` 终态且不存在仍 open 的 spawned 行；AC-935 至少一个 active GOAL 的一行投影且出现在 round fact；AC-936 至少一条真实请求被 driver 消费；AC-937 至少一条 driver 自己立案的任务落地并使 AC 机械翻 achieved。sufficiency 判官对在域 AC 集合判 covered。既有 GOAL 的 AC/退出条件不回退。

此外两条**否证条件**必须同时成立：AC-938（AC-934 的绿必须来自工作区树上真实存在的台账写入代码，而不是任务 worktree 一次证据跑留下的静态文件）——它未达成时，AC-934 的 achieved 不算证据；AC-940（本节不得被「AC-934 绿 ∧ AC-938 红」这一自相矛盾的组合满足）——两者冲突时 GOAL 不得退出。该冲突在每轮读数上可见（meta-driver 第五类 divergence `achieved-but-superseder-unmet`，reason 点名替代者与其状态），⛔ 不是只在人读导出时才看得见。