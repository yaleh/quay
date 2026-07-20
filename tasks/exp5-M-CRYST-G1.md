---
id: exp5-M-CRYST-G1
title: "G1 [executable] North-star metric: per-milestone code:doc increment
  ratio on dashboard + flag"
status: todo
labels:
  - milestone-candidate
  - crystallization
  - observability
  - milestone:M41-cryst-g1
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
Make CONVERGENCE observable — the meter for "are we crystallizing?" (implements **ADR-007** instrument-the-dark-axes; the closure half of ADR-006's L_T..L_S checklist). Today only L_T + half L_C are lit; L_D/L_G/L_S are dark, so we cannot quantitatively SEE convergence. Build cheap executable proxies per milestone, recorded on `dashboard.md` + flagged:
- **L_D (description length)** — per-milestone `code:doc` increment ratio (the north-star) + archguard description-length/compression; flag a milestone whose delta is overwhelmingly new prose.
- **L_G (generative-alignment)** — archguard duplicated/reinvented-abstraction + dependency-cycle/god-package signals.
- **L_S (stability)** — behavior variance via mutation/property probes on touched code.
Single-source scripts wrappable by a future `quay gate`; archguard is the L_D/L_G instrument (owner-maintained, fixable-fast).
## Plan
N/A — one metric module (git-delta code:doc) + an archguard-backed L_D/L_G probe + a mutation/property L_S probe, each a single-source `scripts/*.mjs` + fixtures (RED-then-GREEN per ADR-001); no staged docs/plans doc warranted.
## Acceptance Criteria
- [ ] `code:doc` (L_D) computes from real git deltas and FLAGs a synthetic prose-heavy milestone; recorded on dashboard at a real ABSORB.
- [ ] L_G proxy via archguard surfaces a real dependency cycle / god-package / duplicated abstraction on the live repo (not just a fixture).
- [ ] L_S proxy reports behavior variance for a touched module; fixtures pin each metric.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The dark axes L_D/L_G/L_S each have a runnable proxy that RAN at a real ABSORB and is recorded on the dashboard — convergence is now MEASURABLE, not asserted.
- [ ] Flags a real regression (prose-heavy milestone / new cycle / behavior-variance spike); single-source, quay-wrappable.