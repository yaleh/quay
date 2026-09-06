---
id: AC-151
title: driver 两级分层落地（Layer 0 + Layer 1a/1b）
status: active
kind: criterion
goal: GOAL-002
origin: |
  人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；
  正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md §2.1/§2.5/§2.6，
  ⛔ 判据在此、设计在 SPEC，不互相复制。
---

**判据（能取假）**：存在 **Layer 0（driver-runtime）** 与 **Layer 1a（task-processing）/ 1b（routine）**
两级；promotion/worker 继承 0+1a，manager-kind 继承 0+1b。⛔ 不是一个 kernel + N 个平级 plugin。

**取假**：①manager-kind 里出现空的候选池/选择/verify 三段（被骨架强制）⇒ 分层错，判假。
⊢ 反向取假同样成立：**若 1b 里重新实现了一份 Layer 0 已有的循环/心跳/判停 ⇒ 假**（分层没起作用）。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
