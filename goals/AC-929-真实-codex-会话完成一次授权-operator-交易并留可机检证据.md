---
id: AC-929
title: 真实 Codex 会话完成一次授权 operator 交易并留可机检证据
status: draft
kind: criterion
goal: GOAL-912
criterion: node plugin/scripts/codex-stage1-live-proof-check.ts
  docs/codex-stage1/evidence.json
expect: exit 0——证据含 fresh Codex 会话引用、真实 task 编辑与创建、MCP/CLI readback、CAS
  拒绝、scoped commit SHA，且非 probe/fixture
origin: 人 2026-10-29 裁定长期支持（SPEC-codex-long-term-support §4.2
  AC-929）；单调达成量，证据提交进分支故 pre-merge
phase: pre-merge
---
