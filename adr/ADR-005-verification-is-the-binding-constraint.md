---
id: ADR-005
title: Verification is the binding constraint — invest in cheap executable verification over more generation
status: proposed
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - verification
  - crystallization
---
## Context
The geometry self-audit (`docs/references/geometry-as-llm-architecture-interface.md` §6.3, §5) names verification asymmetry as THE binding constraint: an LLM generates faster than a human (or another LLM) can review. The manda evidence shows real progress came from **upgrading the verification instrument** (import-guard, real-subagent e2e, fixpoint meter), not from writing more or better code. The scarce resource is trustworthy cheap checks, not generation capacity.

## Decision
When choosing where to spend effort, prefer building **cheap, executable verification** (a gate, an assertion, a property/mutation test, a static analyzer) over generating more artifacts. A milestone's marginal engineering hour goes to closing a verification gap before it goes to new generation. Verification must be executable and fail-closed (per ADR-004), not asserted in prose.

<!-- enforcement (E3, deferred): applies-to milestone; check each milestone lands or extends at least one executable verification (gate/test/analyzer) and does not merely add generated artifacts; report milestones that add generation with zero new verification -->

## Consequences
- **Forbids:** treating "more code/docs generated" as milestone progress when the corresponding checks are absent; accepting a self-assessed (non-runnable) verification claim.
- **Enables:** this ADR is the cited rationale for the gate engine (QENG), scheduled milestone e2e incl. browser tests (ADR-010), and the dark-axis instruments archguard/mutation-tests (ADR-007).
- **Scope / relations:** instance-of relationship — ADR-007 and ADR-010 are concrete applications; ADR-004 supplies the "must be a hard check" constraint. Do not cite the continuous-math verification story (Fisher/natural-gradient) as rigor (ADR-006).
