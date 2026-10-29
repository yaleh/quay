---
id: AC-930
title: Codex operator 契约不含生命周期权限（权限边界）
status: active
kind: criterion
goal: GOAL-912
criterion: node --test plugin/test/codex-stage1-adapter.test.mjs
expect: 全绿，含 C4（prohibited lifecycle authority disclaimed）与 E3（CODEX-PROBE
  反伪造）；今天已绿，复验域抓权限 creep
origin: 人 2026-10-29 裁定长期支持（SPEC-codex-long-term-support §4.2 AC-930）；今天 26/26 pass
activatedAt: 2026-10-29T07:36:23.768Z
statusLog:
  - at: 2026-10-29T07:36:23.768Z
    from: draft
    to: active
    actor: goal-cli
    reason: 人 2026-10-29 裁定激活（SPEC §1 ③）
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T07:36:23.768Z
phase: pre-merge
---
