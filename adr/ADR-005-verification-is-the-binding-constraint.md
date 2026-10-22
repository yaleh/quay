---
id: ADR-005
title: Verification is the binding constraint — invest in cheap executable
  verification over more generation
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

**Amended 2026-10-22 (re-evaluation against 3 months of production data)** — human-approved 2026-10-22.

- **Reinforced: verification is the binding constraint; generation was never the bottleneck.**
  Three months of the autonomous loop produced generation in volume (e.g. 10,572 commits on this
  branch since 2026-09-13T20:35Z alone, `git rev-list --count --since=2026-09-13T20:35 HEAD`); the
  binding constraints recorded in this re-evaluation (below) are all on the verification side.
- **"Verification" splits into three binding resources**, each of which can bind independently:
  1. **Verification cost** — the full suite takes 19+ min per round (`tasks/gap-subagent-turn-budget-13min-falsified.md`:
     "suite 实测 19+ min"), and there are many distinct load-flake classes (host-load / timing reds
     that are not defects in the diff under test), each of which costs a re-run or an adjudication.
  2. **Verification liveness** — a check that exists but does not run, or runs on nothing, verifies
     nothing (ADR-004's 2026-10-22 amendment: `adr-007` gate 0 events since 2026-07-20;
     `git-lens-selfcheck.sh` exit 1 while printing PASS lines; `arch-cycle-report` never
     `evaluated:true`). Cheapness is worthless without liveness.
  3. **Deformation-direction supply** — knowing *which way* to change the design.
     `docs/references/维度边界与结晶——从熔融实现中发现原则.md` §3 ("问题从实践涌现，形变由人供给")
     finds that in the documented architecture evolutions the problem was surfaced by practice and
     measurement, but the direction (the 形变) was supplied by the human; LPT is the boundary case.
     Verification can tell you that a direction is wrong; it does not supply one.
- **Decision on promotion: KEEP `proposed`.** ADR-011 (accepted) rules that "a design without its
  landed enforcement is `pending`, not done", and forbids phased "design now, wire the enforcement
  later". This ADR's enforcement comment is `E3, deferred` — a concrete, mechanizable check
  (report milestones that add generation with zero new verification) that has not landed. That is
  the opposite of ADR-006's promotion basis, whose enforcement comment reads "N/A … nothing left to
  land per ADR-011" (the stance is irreducibly judgment, so there was no deferred enforcement to
  wait for). ADR-005's check is not N/A, so promoting it now would be exactly the phased deferral
  ADR-011 prohibits. Promotion path: land the E3 check (or argue, as ADR-006 did, that it is N/A
  and record that ruling), then promote.
