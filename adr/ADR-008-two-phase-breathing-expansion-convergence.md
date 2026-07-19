---
id: ADR-008
title: Two-phase breathing — alternate expansion ⇄ convergence explicitly
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
The two reference docs model a system's lifecycle as expansion (absorb new requirements, entropy↑) ⇄ convergence (compress/crystallize, entropy↓) — "breathing" (`docs/references/基于几何信息论的未来软件开发与信息系统建设(两阶段周期版).md` §5.4). The current crystallization program (molten prose → executable single-source; `docs/proposals/exp5-crystallization-strategy.md`) IS a convergence phase. Running one phase implicitly risks either over-engineering (converging with an empty demand queue) or unmaintainability (expanding while `L_S`/`L_D` blow past threshold).

## Decision
Track the phase explicitly and switch by rule:
- **Switch to EXPANSION** when `∂L_D/∂t → 0` (description-length improvement has flattened) AND the demand queue is non-empty — i.e. stop compressing when compression stops paying and there is new work to absorb.
- **Force CONVERGENCE** (even with new demand queued) when `L_S` or `L_D` exceeds threshold.
`L_D`/`L_S` here are the ADR-007 proxies (archguard, mutation/property tests), NOT the continuous-math quantities (ADR-006 rejects those as rigor). `∂L_D/∂t → 0` is read qualitatively from the proxy trend, not computed from a Fisher metric.

<!-- enforcement (E3, deferred): applies-to milestone/dashboard; check dashboard records the current phase (expansion|convergence) and, at a phase switch, the trigger (flattened L_D + non-empty queue, OR L_S/L_D over threshold) -->

## Consequences
- **Forbids:** treating the crystallization/convergence program as permanent; expanding indefinitely while stability/description-length degrade unchecked.
- **Enables:** a legible phase field on the dashboard; a principled "when do we stop crystallizing" answer.
- **Scope / relations:** instance-of ADR-006; consumes ADR-007's dark-axis proxies as the switch signals. Complements ADR-009 (background workflow cadence runs whichever phase is active).
