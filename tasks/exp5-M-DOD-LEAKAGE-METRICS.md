---
id: exp5-M-DOD-LEAKAGE-METRICS
title: "DIR-017 Step 3: add leakage metrics onto dashboard.md as homeostatic
  variables — deviations caught by machine vs human, fraction of recorded
  deviations reaching verified-eliminated, median deviation age, product-value
  shipped per K milestones — making the exp6 meta-objective measurable"
status: in-progress
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M36-dod-leakage-metrics
extra: {}
---
## Provenance
Materialized at m36 DRAIN/SELECT boundary (2026-07-19), sourced directly to DIR-017 Step 3 (`pending`,
human-verification gate CLEARED 2026-07-19 for Steps 2/3, Step 2 delivered @m32). Only open candidate
in `directives/pending/` as of m36 DRAIN — no competing candidate this cycle (unlike m34/m35's
explicit choices among multiple open items).

## Source
`experiments/quay-perpetual-stream/directives/pending/DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md`,
"Requested action" § Step 3 (verbatim): "the leakage metrics onto `dashboard.md` as homeostatic
variables: deviations caught by machine vs human; fraction of recorded deviations reaching
`verified-eliminated`; median deviation age; product-value shipped per K milestones (the exp6
meta-objective made measurable)."

## Value type / cadence
governance-integrity (primary) — makes the exp6 meta-objective (self-correcting perpetual stream)
measurable, not just aspirational prose. explore (no existing deviation-tracking schema/log exists
today — confirmed via grep, "deviation" appears only as ad hoc prose mentions in `dashboard.md`, e.g.
M30's self-disclosed process deviation; there is no structured log with a `status` field, so
"fraction reaching verified-eliminated" and "median deviation age" cannot be computed without first
designing what a recorded deviation IS). Δv̂ ≈ 0 (methodology/governance, no VT chart cell — mirrors
the DoD-program lineage's own established no-VT-cell precedent, M25/M30/M31/M32/M34).

## Notes (current-state, re-verified at task-authoring time)
- No dedicated deviation-tracking file exists (`ls *.md` in `experiments/quay-perpetual-stream/`:
  `OUTER-LOOP.md`, `README.md`, `backlog.md`, `dashboard.md`, `inherited-core.md`,
  `v-meta-ledger.md` — none is a deviation log).
  Grep for "deviation" across `dashboard.md` finds only free-text prose mentions (M30's self-disclosed
  single-commit deviation, DIR-019's own resolution note) with no structured `status`/`caught-by`/
  `age` fields to aggregate.
- DIR-017 Step 3's four named metrics genuinely require a DESIGN decision first: what counts as a
  "deviation" (a defect the DoD gate or an adversarial audit catches vs. a self-disclosed process
  departure like M30's?), who/what "catches" it (machine = a mechanical `it0-*` check failing;
  human = a directive like DIR-019/DIR-020 or a human-verification-gate finding), what
  "verified-eliminated" means operationally (the underlying defect is fixed AND externally re-tested,
  mirroring DIR-019's own resolution discipline), and where "product-value shipped per K milestones"
  draws its value figure from (Realized Δv entries already recorded per-ABSORB in `dashboard.md`).
- This is a genuinely open design question, not a mechanical formatting task — charter accordingly
  (explore type, with room for the two dispatched iterations to propose and reconcile a schema, not
  just implement a pre-specified one).

## Acceptance Criteria
- [ ] A structured schema for a "deviation" record is defined and documented in `inherited-core.md`
  (or a new dedicated file it references) — at minimum: what event qualifies as a deviation, its
  `caught-by` field (machine / human), its `status` field (including a `verified-eliminated` terminal
  state), and a way to compute its age.
- [ ] The schema is retroactively backfilled (best-effort, not exhaustive) from `dashboard.md`'s
  existing history — known real deviations already on record: M11's audit-gate self-exemption
  (DIR-007-era), M26's path-traversal finding, DIR-019's clause-5 blind spot, M30's self-disclosed
  process deviation, M32's Clause 7 negation-blind regex gap — each classified per the new schema
  (caught-by, status, approximate age) as worked examples, not a claim of completeness.
- [ ] `dashboard.md` gains a homeostatic-variables section (or a clearly-marked subsection of an
  existing one) computing, from the schema, the four DIR-017 Step 3 metrics: deviations caught by
  machine vs human (a count/ratio), fraction of recorded deviations reaching `verified-eliminated`,
  median deviation age, and product-value shipped per K milestones (derivable from the Realized Δv
  figures already recorded per-ABSORB — cite the actual arithmetic, don't hand-wave it).
- [ ] The section/mechanism is designed to be updated going forward (each future ABSORB entry that
  discloses or resolves a deviation appends/updates a record) — state explicitly in `OUTER-LOOP.md`
  or `inherited-core.md` whose job this update is (mirrors how Clause 1's audit write-back is now a
  named, standing step per DIR-020/M34).
- [ ] A live computation of the four metrics against the actual current backfilled data is shown in
  the report (not just the mechanism's existence) — real numbers, not placeholders.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget — this is a larger, explore-type
milestone, budget explicitly at charter time, 4 impl-row, 5 no-self-exemption, 6 escrow-Δv — likely
APPLIES if scoped as design-then-later-impl, decide at charter time, 7 test-floor — N/A,
`surface:method-infra` non-product-touching). No task-specific exemption from any clause.
- [ ] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed).
- [ ] If this milestone is scoped as design-only (charter-time decision), an `-IMPL` follow-up row is
  seeded in `backlog.md` per the escrow-Δv clause's own requirement — do not let this ship as
  shelfware, exactly the failure class DIR-017 itself exists to prevent.

## Status mirror
SELECTed @m36 DRAIN/SELECT boundary, 2026-07-19. Sole open candidate this cycle — no competing choice
to reason through (unlike m34/m35). DIR-017 Step 3 is now finally in progress; Steps 0-2 already
delivered (M21, M25/DIR-019-fix/M30, M32 respectively).
