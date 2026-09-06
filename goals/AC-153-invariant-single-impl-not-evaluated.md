---
id: AC-153
title: 核心不变式单一实现 + 结果词表含「无法评估」
status: active
kind: criterion
goal: GOAL-002
origin: >
  人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；

  正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md
  §2.1/§2.5/§2.6。
evidence:
  at: 2026-09-06T09:44:32.289Z
  verdict: fail
  reading: AC-153 has no criterion defined (fail-closed — an unenforceable AC must
    never silently pass)
---

**判据（能取假）**：「⛔ 不信执行者自述，用独立于执行者的量复核」**只存在一份**；且 `DriverResult`
词表强制含 `not-evaluated`（与 `verified` 不同形）。

**取假**：①任一 kind 能在未经独立判据证实时产出 `verified` ⇒ 假；②「读不到输入」能被表达成非
`not-evaluated` 的值 ⇒ 假。⊢ **本条是抽 kernel 的第一理由**：该不变式此前被独立实现两遍
（promotion AC133 / worker `computeLandingState`），**其中 worker 那份在 2026-08-23 11:37 之前
一直是坏的**（`exitCode===0 ⇒ completed`）。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
