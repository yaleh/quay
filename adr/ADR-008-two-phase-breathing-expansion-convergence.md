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

**Amended 2026-10-22 (re-evaluation against 3 months of production data) — Status note**
— human-approved 2026-10-22. Status stays `proposed`.

- **The phase field was declared once and never moved.** `.quay/two-phase-state.json` holds exactly
  one declaration (`history` length 1): `phase: convergence`, `declaredAt: 2026-09-13T20:35:47Z`,
  based on an L_D code:doc reading from the now-archived git-lens rule.
- **Since then:** `git rev-list --count --since=2026-09-13T20:35 HEAD` = **10,572** commits
  (≈10,566 when this amendment was drafted; the loop kept committing), and new goals
  GOAL-906..GOAL-910 were opened. That is visible new work being absorbed, i.e. expansion, yet the
  phase field never moved. (Caveat: GOAL-906..910 are themselves consolidation-shaped by title,
  e.g. shim deletion and cycle breaking. Whether this period was expansion or continued convergence
  is exactly what a stale phase field cannot tell us; the field carries no information either way.)
- **Observed asymmetry: expansion needs no mechanism, contraction needs a human.** Expansion
  happened by default (the loop absorbs whatever is filed); the only recorded phase declaration, a
  convergence, was a human judgment ("人判定当前处于收缩相"). Nothing switches the phase back, and
  nothing notices that it has not been switched.
- **Follow-up, as an observation item and not a blocker:** a phase-record-staleness reading (how long
  since the last declaration, against how much commit / goal activity) is being filed as an
  observation item. Per 硬规则 12 its occurrence count is **1** (this one stale record), which is
  below the bar for a blocking prerequisite.
