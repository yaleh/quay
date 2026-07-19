---
id: ADR-004
title: Hard over soft — load-bearing rules become executable checks (Π_{S→E}); prose is rationale, not source
status: proposed
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - code-over-prompt
  - crystallization
---
## Context
The geometry self-audit (`docs/references/geometry-as-llm-architecture-interface.md` §8.3) isolates the ONE empirically-paid-for lever: **硬形变 / Π_{S→E}** — turning "a region of intent" into an executable check that fails on drift. A **软形变** (prose/prompt) only bends the model's conditional distribution `U`; the density-prior re-erodes it every cycle because the LLM mode-seeks back to training-typical attractors. This is the mechanism behind ADR-003 (form-vs-substance dilution): a rule that lives only as prose gets paraphrased away. This ADR is the master decision that unifies the crystallization program.

## Decision
A **load-bearing** rule (one whose violation is a real defect) MUST become an executable check — a gate, test, lint, validator, or schema — that **fails closed on drift** (硬形变 / Π_{S→E}, state-space truncation the density-prior cannot erode). Prose (an ADR body, CLAUDE.md, a plan) is **rationale + a pointer to the check**, NEVER the single source of the rule. Soft forms (prompts, descriptions) may carry the rationale but may not be the only place a load-bearing rule lives.

<!-- enforcement (E3, deferred): applies-to adr[?tags contains 'load-bearing' or decision names an invariant]; check each load-bearing Decision names an executable check (gate/test/lint id) it maps to; flag an accepted ADR whose Decision is load-bearing but has no bound check -->

## Consequences
- **Forbids:** landing a load-bearing invariant that exists only as re-narratable prose; treating an ADR/CLAUDE.md paragraph as the enforcement of a rule.
- **Enables:** the E3 "adr-as-contract" direction — an accepted, mechanizable ADR later attaches a named `adr-<id>` gate; the crystallization program (ADR-006/007/008) is the systematic application of this decision.
- **Scope / relations:** generalizes ADR-003 (which named the failure family) into a positive construction rule; ADR-005 justifies WHY the check is cheap-verification-first; ADR-006 adopts Π_{S→E} as a first-class analytical tool. The continuous-math half of the geometry framework is explicitly NOT invoked here (see ADR-006) — only 硬形变 is load-bearing.
