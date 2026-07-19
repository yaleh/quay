---
id: ADR-006
title: Apply the GIT lens — validated layers only (goal-closure L_T..L_S + hard-over-soft + Π_{S→E}); reject the continuous math
status: proposed
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - git-lens
  - crystallization
---
## Context
Two reference docs frame this program: `docs/references/geometry-as-llm-architecture-interface.md` (a self-audit that grades the geometry framework into 证据充分 / 机制成立待验 / 假统一) and `docs/references/基于几何信息论的未来软件开发与信息系统建设(两阶段周期版).md`. The audit is explicit: the continuous math (Fisher metric, natural gradient, intrinsic dimension `d`, compression ratio `ρ`) is **abuse of notation / 假统一** — it makes "the shape of rigor" without doing the arithmetic; it made zero out-of-sample predictions. Only specific layers survive.

## Decision
Adopt, as analytical tools, the **validated layers only**:
1. the **goal-closure checklist** `L_T` (feasibility/tests) / `L_C` (constraints/types) / `L_D` (description length) / `L_G` (generative-alignment: reinvented/duplicated abstractions) / `L_S` (stability/behavior-variance) — its value is telling you which axis is still DARK;
2. **hard-over-soft** (ADR-004);
3. **Π_{S→E}** (region → executable check).

EXPLICITLY REJECT citing the continuous math (Fisher / natural gradient / intrinsic dimension / `ρ`) as rigor or as justification for any decision. Fluency of a geometric argument is not evidence — especially from an LLM.

<!-- enforcement (E3, deferred): applies-to adr,plan,proposal; check no accepted decision cites Fisher/natural-gradient/intrinsic-dimension/compression-ratio as a load-bearing justification (grep guard); L_T..L_S referenced as a checklist is allowed -->

## Consequences
- **Forbids:** grounding a decision in the continuous-dynamics layer; presenting a geometric metaphor as proof without an out-of-sample check.
- **Enables:** ADR-007 (instrument dark axes) and ADR-008 (two-phase breathing) are instances of this lens applied; the L_T..L_S checklist becomes the milestone review question (see CLAUDE.md pointer).
- **Scope / relations:** parent of ADR-007 and ADR-008; consistent with ADR-004/005 (which are the two validated levers this lens keeps). Reference both `docs/references/` files for the framework AND its limits.
