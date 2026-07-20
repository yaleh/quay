---
id: ADR-007
title: Instrument the dark axes L_G/L_D/L_S — a milestone is not judged on L_T alone
status: accepted
date: 2026-07-19
accepted-date: 2026-07-20
enforcement: "bash experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh"
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

<!-- enforcement (WIRED 2026-07-20 as the `adr-007` gate, via .quay/gates.yml → makeAdrGate): the
     frontmatter `enforcement:` command runs `git-lens-selfcheck.sh` — the fixture-backed RED/GREEN
     regression gate for the three L_D/L_G/L_S proxies (landed M41). This is a REAL fail-closed
     guarantee, but a NARROWER one than the original spec below: it guards the INSTRUMENT against rot
     (the proxies still detect a prose-heavy diff / a new cycle / a weak module), NOT that any given
     milestone actually CONSULTED it. Enforcement + fixture both already landed (M41), so this
     satisfies ADR-011 for the instrument-integrity half.
     STILL FUTURE WORK (a proper milestone, not an off-loop edit): the per-milestone predicate — check
     the milestone DoD records an L_D/L_G reading (no new cycle / no new god-package) + an L_S reading,
     or an explicit "axis still dark" note; fail-closed if all three are silently absent. A live
     git-lens gate over the milestone's own diff would RED immediately on exp5's ~1:8 code:doc ratio
     — which is the point (see DIR-036 / the 2026-07-20 evaluation). -->

## Consequences
- **Forbids:** an ABSORB/DoD that reports only `L_T` green while `L_G/L_D/L_S` are silently unexamined.
- **Enables:** archguard and mutation/property tests become standing milestone instruments (→ CLAUDE.md Tools pointer); the L_T..L_S review question (ADR-006) has runnable answers.
- **Scope / relations:** instance-of ADR-006; uses ADR-005's rationale; the proxies themselves are 硬形变 per ADR-004. Complements ADR-010 (which keeps `L_T` on the REAL axis).
