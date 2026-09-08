---
id: AC-153
title: 核心不变式单一实现 + 结果词表含「无法评估」
status: achieved
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/driver-result.ts").then(m=>{const r=m.verifyIndependently({value:1,verifiedBy:"t",failedReason:"f",notEvaluatedReason:"n"},()=>null);process.exit(typeof m.notEvaluated==="function"&&r.state==="not-evaluated"?0:1)})'
expect: exit 0
origin: >
  人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；

  正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md
  §2.1/§2.5/§2.6。
---

**判据（能取假）**：「⛔ 不信执行者自述，用独立于执行者的量复核」**只存在一份**；且 `DriverResult`
词表强制含 `not-evaluated`（与 `verified` 不同形）。

**取假**：①任一 kind 能在未经独立判据证实时产出 `verified` ⇒ 假；②「读不到输入」能被表达成非
`not-evaluated` 的值 ⇒ 假。⊢ **本条是抽 kernel 的第一理由**：该不变式此前被独立实现两遍
（promotion AC133 / worker `computeLandingState`），**其中 worker 那份在 2026-08-23 11:37 之前
一直是坏的**（`exitCode===0 ⇒ completed`）。


