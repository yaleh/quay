---
id: ADR-004
title: Hard over soft — load-bearing rules become executable checks (Π_{S→E});
  prose is rationale, not source
status: accepted
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - code-over-prompt
  - crystallization
accepted-date: 2026-07-24
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
- **Implemented by:** [[DIR-080]] (2026-07-24) — refactors executed documents to agent-spec style:
  every load-bearing rule becomes a formal constraint with a pointer to its executable check
  (it0-dod-check.ts, human-steered-classify.ts, task-schema-check.sh, etc.); prose moves to
  rationale + provenance.md. Promoted proposed→accepted on this implementation.

**Amended 2026-10-22 (re-evaluation against 3 months of production data)** — human-approved 2026-10-22.

- **New consequence: a hard check is immune to *paraphrase*, not to *disconnection*. Present ≠ running.**
  The Decision above protects a rule from being re-narrated away; it says nothing about the check
  silently ceasing to run, or running on nothing. Three production instances, each re-measured 2026-10-22:
  - (a) The `adr-007` gate has been declared in `.quay/config.yml` `gates.adr` since 2026-07-20
    (the config line's own comment: "wired 2026-07-20"), yet `.quay/gate-events.jsonl`
    (619,083 events) holds **0** events with `gate == "adr-007"`.
  - (b) `bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` exits **1**
    deterministically because the probes it invokes are gone (`MODULE_NOT_FOUND`), yet it still
    prints `PASS: l-d/prose-heavy` — and likewise `PASS: l-g/cycle-repo` and `PASS: l-s/weak-module`,
    i.e. every fixture whose expected exit is 1. The load failure is shaped like a verdict: the
    硬规则 3b shape.
  - (c) The `arch-cycle-report` routine evaluated **every** round as `evaluated:false`: 25 of 25 at
    the time `tasks/gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts.md` was filed,
    26 of 26 in `.quay/arch-cycle-history.jsonl` when re-read (2026-10-18T10:25Z → 2026-10-22T00:40Z).
    Here the check is honest (it says "not evaluated"), but nobody consumed that answer, so it
    never ran on real input.
- **Rule added:** a hard check must (1) sit on the **write path** (the path that actually produces
  the state it guards — not a side command someone may remember to run), AND (2) carry a **liveness
  reading**: when it last actually ran on real input, with an evaluated result. **A check with no
  liveness reading counts as a dark axis** (in the ADR-006/007 sense) — its presence in config, in
  a script directory, or in an ADR's `enforcement:` field is not evidence that the axis is lit.
- **Honest limitation:** this ADR's own E3 enforcement (the comment above) is still deferred, so
  neither the original Decision nor this added rule is bound to an executable check. Both are
  currently carried only by prose — the exact state this ADR forbids for load-bearing rules. It is
  recorded here rather than papered over; mechanizing it is out of scope for this amendment.
