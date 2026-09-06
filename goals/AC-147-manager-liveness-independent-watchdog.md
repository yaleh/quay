---
id: AC-147
title: manager 自身活性由【不依赖 manager】的通道兜底
status: active
kind: criterion
goal: GOAL-002
origin: |
  「看门人」缺口（manager 分析时主动指出，⛔ 不是人提出的）：今天是三层互看——outer 阻塞 3h17m
  期间，是 manager 发现、inner 执行。取消两层后只剩人看 manager。新架构下 manager 阻塞时 driver
  仍在跑（更好）；但语义工作停摆且无人察觉，直到人去看。本质是用【层间冗余】换【机制连续性】。
---

**判据（能取假）**：manager 会话失能（阻塞在交互提示 / 心跳停 / 进程死）超过阈值 T，**存在一个
不经过 manager 的机制**让人知道。

**取假**：把 manager 置于一个 `AskUserQuestion` 阻塞态（本会话已有现成真实样本可回放：
outer `04:13:54Z`–`07:30:07Z`），T 之后无任何通知 ⇒ 假。

**⊢ 非目标**：⛔ 不要求自动解除该阻塞（那需要代人作答，越界）；只要求**让人知道**。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
