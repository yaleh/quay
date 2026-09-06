---
id: AC-155
title: 配置合并 + 保留配置/控制态分界 + 事件触发保留兜底轮询
status: active
kind: criterion
goal: GOAL-002
origin: |
  人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；
  正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md §2.1/§2.5/§2.6。
  人 2026-08-25 逐字裁定「AC155：在切换时一并要求完成」——优先级提升，本阶段当前唯一未完成的地基项。
---

**判据（能取假）**：现散在六处的配置合并到**声明式配置**一侧；**⛔ `.quay/worker-control.json`
（运行时控制态，机器热写）保持独立**，不并入配置文件。

**取假**：①合并后仍存在两份以上的并发解析（现有三份：`CAP_DEFAULT=5` / `resolveConcurrency` /
`cap-from-gate.ts:FIXED_EFFECTIVE_CAP=5`，而后者注释自称"single source is QUAY_MAX_TASK_SUBAGENTS"）
⇒ 假；②控制态被并进 git 版本化的配置文件 ⇒ 假（机器改人的源文件，同 CLAUDE.md 11b）；
③事件源不可用时 driver 静默停摆 ⇒ 假（**事件是提前唤醒，⛔ 不是替代轮询**——`cmd_liveness`
零调用者就是"机制建好了但从不触发"的现成反例）。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
