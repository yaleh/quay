---
id: exp5-M-CRYST-G1
title: "G1 [executable] North-star metric: per-milestone code:doc increment
  ratio on dashboard + flag"
status: done
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
- [x] `code:doc` (L_D) computes from real git deltas and FLAGs a synthetic prose-heavy milestone; recorded on dashboard at a real ABSORB. MET — `scripts/git-lens-l-d-code-doc-ratio.mjs`; real finding `5c7ac2f..ba1edb8`: docLines=11679 codeLines=4234 ratio=2.758 PASS (independently re-run at ABSORB m41, see `milestones/M41-cryst-g1-observability/audit.md`); synthetic prose-heavy fixture (`fixtures/git-lens/l-d/prose-heavy.numstat`) FLAGs (exit 1).
- [x] L_G proxy via archguard surfaces a real dependency cycle / god-package / duplicated abstraction on the live repo (not just a fixture). MET — archguard primary path probed live (3 independent calls across this milestone) and confirmed to fail ("No query scopes were persisted") for this plain-JS/ESM repo — a real, disclosed upstream gap (ADR-007). `scripts/git-lens-l-g-structural-drift.mjs` fallback surfaces a REAL finding on `packages/`: 0 cycles, 3 god-modules (`github-client.js` 851L/fanin8, `store.js` 729L/fanin14, `serve.js` 1079L/fanin8), FLAGGED — independently re-confirmed at ABSORB m41.
- [x] L_S proxy reports behavior variance for a touched module; fixtures pin each metric. MET — `scripts/git-lens-l-s-behavior-variance.mjs`; real finding on `packages/quay/src/gate/registry.js` + `packages/quay/test/gate.test.mjs`: totalMutants=31 killed=3 survived=28 mutationScore=0.097 FLAGGED (independently re-run at ABSORB m41; module verified restored clean pre/post). 7/7 RED/GREEN fixtures pass (`git-lens-selfcheck.sh`).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] The dark axes L_D/L_G/L_S each have a runnable proxy that RAN at a real ABSORB and is recorded on the dashboard — convergence is now MEASURABLE, not asserted. MET — all 3 proxies ran at ABSORB m41 (see `dashboard.md` ABSORB m41 entry + `milestones/M41-cryst-g1-observability/audit.md`).
- [x] Flags a real regression (prose-heavy milestone / new cycle / behavior-variance spike); single-source, quay-wrappable. MET — L_G and L_S both genuinely FLAG on the live repo (real, not synthetic, regressions); all 3 scripts are pure-function-plus-thin-CLI, documented as wrappable unchanged by a future `quay gate --gate l-d/l-g/l-s` (M39 registry precedent).
