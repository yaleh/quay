---
id: ADR-007
title: Instrument the dark axes L_G/L_D/L_S — a milestone is not judged on L_T alone
status: proposed
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - git-lens
  - verification
  - crystallization
---
## Context
Applying the GIT lens (ADR-006) to this project's own review: normal review instruments `L_T` (tests pass) and half of `L_C` (types/constraints); `L_G` (reinvented/duplicated abstractions), `L_D` (description length / dependency structure), and `L_S` (behavior variance) are DARK (`docs/references/geometry-as-llm-architecture-interface.md` §5, layer-一). A green `L_T` on a cheap proxy can be a pseudo-convergence on the wrong axis (the curl-vs-real-subagent lesson; see ADR-010). Judging a milestone on `L_T` alone is systematic blindness.

## Decision
A milestone MUST NOT be judged on `L_T` (tests pass) alone. Build **cheap executable proxies** for the dark axes and consult them before calling a milestone done:
- `L_D` (description length / dependency structure): **archguard** — dependency cycles, god-packages, fan-in/out, structure metrics.
- `L_G` (generative-alignment / reinvented-duplicated abstractions): **archguard** entity/duplication signals + review for concept-level reinvention.
- `L_S` (stability / behavior variance): **mutation / property tests**.
This is an instance of ADR-006 and a specific application of ADR-005 (cheap verification over more generation).

<!-- enforcement (E3, deferred): applies-to milestone; check the milestone DoD records an L_D/L_G reading (archguard: no new cycle, no new god-package) and an L_S reading (mutation/property test) or an explicit "axis still dark" note; fail-closed if all three are silently absent -->

## Consequences
- **Forbids:** an ABSORB/DoD that reports only `L_T` green while `L_G/L_D/L_S` are silently unexamined.
- **Enables:** archguard and mutation/property tests become standing milestone instruments (→ CLAUDE.md Tools pointer); the L_T..L_S review question (ADR-006) has runnable answers.
- **Scope / relations:** instance-of ADR-006; uses ADR-005's rationale; the proxies themselves are 硬形变 per ADR-004. Complements ADR-010 (which keeps `L_T` on the REAL axis).
