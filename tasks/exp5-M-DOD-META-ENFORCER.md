---
id: exp5-M-DOD-META-ENFORCER
title: "DIR-017 Step 1: the Definition-of-Done meta-enforcer (load-bearing
  foothold) - unify the adversarial-audit/V_meta-lag/line-budget/-IMPL-row
  gates into one inherited-core.md DoD section, a no-self-exemption clause,
  and a standing mechanical it0-style check that HARD-BLOCKS
  milestone_counter++"
status: ready
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M25-dod-meta-enforcer
parent: null
children: []
extra: {}
---
## Provenance
Materialized at m25 DRAIN, sourced to DIR-017 (pending) step 1. DIR-017's step 0 prerequisite
("self-host the record" — DIR-015 item 2 / `M-TASK-BACKLOG-PROJECTION-IMPL`) is now DONE
(M24, 2026-07-18), unblocking this step for the first time. Deferred out-of-scope by M23
("Explicitly OUT of scope" section, verbatim).

## Source
DIR-017 (pending), step 1 — the human-flagged "load-bearing foothold": a mechanical,
standing, non-self-exemptible DoD enforcer must exist and be human-confirmed operative
BEFORE DIR-017's steps 2-3 (escrow-Δv clause, product-work test-floor clause, leakage
metrics) may proceed.

## Value type / cadence
explore, governance-integrity (primary) — directly closes the Goodhart/self-exemption
hole DIR-017's Finding names (M17/M18's designed-not-wired disease, DIR-015's own
re-deferral pattern). No VT chart cell (method infra).

## Scope note (per DIR-017's own text)
Step 1 build only: (1) collect the 4 existing gates (adversarial-audit DIR-007/M10,
V_meta-lag DIR-005/M07, line-budget M18, -IMPL-row DIR-016/M21) as named clauses in a
single `inherited-core.md` "Definition of Done" section; (2) no-self-exemption
meta-clause; (3) a standing `scripts/it0-dod-*.{sh,mjs}` mechanical check (exit 0/1/2,
fixture-testable against both a synthetic violating stub AND a compliant stub per
DIR-017's own "Human verification" checklist items 1-5); (4) wire it into
`OUTER-LOOP.md`'s ABSORB as a HARD BLOCK on `milestone_counter++`, same shape as the
existing gates. Steps 2-3 (escrow-Δv, test-floor, leakage metrics) are explicitly OUT
of scope for this row — DIR-017 gates them behind human confirmation that step 1 is
actually operative, not merely designed.

## Status mirror
ready (SELECTed @M25, DIR-017 Step 1 — the DoD meta-enforcer; charter to follow)
