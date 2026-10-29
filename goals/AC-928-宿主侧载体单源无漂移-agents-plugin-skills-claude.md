---
id: AC-928
title: 宿主侧载体单源无漂移（.agents ↔ plugin/skills ↔ .claude）
status: retired
kind: criterion
goal: GOAL-912
criterion: node --experimental-strip-types scripts/agents-claude-drift-check.ts
expect: exit 0——.agents 面与 .claude 面解析到同一 canonical 契约，无漂移；改任一 SKILL.md 后 exit 非 0
origin: 人 2026-10-29 裁定长期支持（SPEC-codex-long-term-support §4.2 AC-928）；今天已 exit
  0，复验域抓未来回归
statusLog:
  - at: 2026-10-29T07:38:25.655Z
    from: draft
    to: retired
    actor: goal-cli
    reason: 冗余：drift-check 已被 AC-930 的 adapter 套件 A1-A6 覆盖；fidelity 闸判 vacuous 正确（单条
      check 脚本无显式取假臂）
long-term: true
phase: pre-merge
---
