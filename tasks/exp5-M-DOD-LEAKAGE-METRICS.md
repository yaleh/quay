---
id: exp5-M-DOD-LEAKAGE-METRICS
title: "DIR-017 Step 3: add leakage metrics onto dashboard.md as homeostatic
  variables — deviations caught by machine vs human, fraction of recorded
  deviations reaching verified-eliminated, median deviation age, product-value
  shipped per K milestones — making the exp6 meta-objective measurable"
status: done
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
- [x] A structured schema for a "deviation" record is defined and documented in `inherited-core.md`
  (or a new dedicated file it references) — at minimum: what event qualifies as a deviation, its
  `caught-by` field (machine / human), its `status` field (including a `verified-eliminated` terminal
  state), and a way to compute its age. (Confirmed: `inherited-core.md` lines 1210-1306, "Deviation-
  record schema" section. Fields table at lines 1248-1257 covers `id`/`title`/`origin-milestone`/
  `found-at`/`caught-by`/`status`/`age`. Independently stress-tested by inventing a NEW hypothetical
  deviation not among the 5 backfilled examples (a future M40 escrow-Δv self-determination error found
  3 milestones later at M43) and classifying it field-by-field — all 7 fields populate unambiguously;
  the only soft gap is that the schema doesn't explicitly address whether a mechanical check run at a
  *later* milestone's plan-time (not the origin milestone's own ABSORB) still counts as `machine`, but
  this resolves cleanly via the schema's own stated distinguishing test (mechanical firing vs. human
  assertion). Both iterations' own self-tests (report.iteration-0.md lines 68-74, report.iteration-1.md
  lines 59-64) independently corroborate usability.)
- [x] The schema is retroactively backfilled (best-effort, not exhaustive) from `dashboard.md`'s
  existing history — known real deviations already on record: M11's audit-gate self-exemption
  (DIR-007-era), M26's path-traversal finding, DIR-019's clause-5 blind spot, M30's self-disclosed
  process deviation, M32's Clause 7 negation-blind regex gap — each classified per the new schema
  (caught-by, status, approximate age) as worked examples, not a claim of completeness. (Confirmed:
  `inherited-core.md` lines 1278-1284, DEV-01..DEV-05 table, covers exactly the 5 named deviations with
  explicit "not exhaustive" limitation note at lines 1272-1276.)
- [x] `dashboard.md` gains a homeostatic-variables section (or a clearly-marked subsection of an
  existing one) computing, from the schema, the four DIR-017 Step 3 metrics: deviations caught by
  machine vs human (a count/ratio), fraction of recorded deviations reaching `verified-eliminated`,
  median deviation age, and product-value shipped per K milestones (derivable from the Realized Δv
  figures already recorded per-ABSORB — cite the actual arithmetic, don't hand-wave it). (Confirmed:
  `dashboard.md` lines 327-343, "Homeostatic variables (DIR-017 Step 3)" section, 4-row table. I
  independently re-derived all 4 numbers from the 5-row backfill table (own scratch computation, not
  copied from the report): (a) machine=2{DEV-02,DEV-05}:human=3{DEV-01,DEV-03,DEV-04}, ratio 0.40:0.60
  — MATCHES; (b) verified-eliminated={DEV-01,DEV-02,DEV-03,DEV-05}=4/5=80% — MATCHES; (c) all 5
  age-to-resolution values are 0 → median=0 — MATCHES; (d) sum of the 6 cited Realized Δv values
  6.0+9.00+5.38+1.54+0.50+0.40=22.82 confirmed by hand; 22.82/35×5=3.257 confirmed by hand (in the
  CURRENT working-tree text, denominator=35, matching the stream's own "qualifying rate 6/35"
  convention independently verified against `checkpoints/cp-35.md` line 37 — MATCHES. NOTE: this /35
  fix exists ONLY as an uncommitted working-tree edit as of this audit — `git diff HEAD --
  dashboard.md` shows it is not yet part of any commit on `exp5-outer-driver`; the committed HEAD
  (`c6687d5`) still has the pre-fix /33≈3.457 text. Must be committed before ABSORB closes or the git
  history will not reflect the reconciliation the ABSORB record claims was made.)
- [x] The section/mechanism is designed to be updated going forward (each future ABSORB entry that
  discloses or resolves a deviation appends/updates a record) — state explicitly in `OUTER-LOOP.md`
  or `inherited-core.md` whose job this update is (mirrors how Clause 1's audit write-back is now a
  named, standing step per DIR-020/M34). (Confirmed as PRESENT and naming a concrete actor+dispatch
  point: `inherited-core.md` lines 1289-1306 and `OUTER-LOOP.md` lines 244-255 both name the Clause-1
  acceptance-audit subagent at the existing step-6 dispatch point as the standing writer. CONCERNS,
  non-blocking, noted in my audit report: `OUTER-LOOP.md` sub-step 1b's sentence structure attributes
  the write-back to "the audit... or the outer loop itself (self-disclosed rows)" while framing the
  ENTIRE sub-step as part of "this same audit pass" / "the SAME audit pass" — a future implementer
  could read this two ways (does the audit mechanically perform the self-disclosed-row edit too, or
  does "the outer loop itself" mean a literally different actor/time). The one real precedent (DEV-04)
  shows the audit was present at the same ABSORB either way, so this is unlikely to cause an actual
  dropped write in practice, but the text itself does not fully foreclose the ambiguous reading.)
- [x] A live computation of the four metrics against the actual current backfilled data is shown in
  the report (not just the mechanism's existence) — real numbers, not placeholders. (Confirmed: both
  `report.iteration-0.md` and `report.iteration-1.md` show live numeric computations with real
  arithmetic, not placeholders; `dashboard.md` lines 327-343 likewise shows real cited numbers.)

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget — this is a larger, explore-type
milestone, budget explicitly at charter time, 4 impl-row, 5 no-self-exemption, 6 escrow-Δv — likely
APPLIES if scoped as design-then-later-impl, decide at charter time, 7 test-floor — N/A,
`surface:method-infra` non-product-touching). No task-specific exemption from any clause.
- [x] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed). (Confirmed re: clause 7/test-floor N/A and clause 6/escrow-Δv N/A: independently
  ran `git diff --stat 54695af exp5-outer-driver` myself — only `OUTER-LOOP.md`, `backlog.md`,
  `charters/M36-dod-leakage-metrics.md`, `dashboard.md`, `inherited-core.md`, and
  `tasks/exp5-M-DOD-LEAKAGE-METRICS.md` touched; ZERO `packages/quay*` files touched, confirming
  test-floor N/A holds. The diff contains the real doc/dashboard artifacts directly, not a design-only
  doc referencing future code, confirming escrow-Δv N/A holds per the charter's own scope-decision
  reasoning. Clause 2 (V_meta-lag) N/A re-confirmed: `v-meta-ledger.md`'s one row is `consolidated`
  since m7, no `confirmed`-and-unresolved rows outstanding. NOT fully confirmable: clause 0
  (AC/DoD-present, mechanical `it0-dod-check.mjs` gate) could not be run to completion by me because no
  ABSORB-entry file yet exists for M36 in `dashboard.md` (ABSORB has not been finalized as of this
  audit dispatch — expected, since this audit's tick-back is itself a precondition of ABSORB closing,
  same pattern as DIR-020/M34's precedent). Re-run the mechanical gate once the ABSORB entry is
  written and the pending /33→/35 working-tree fix (noted above) is committed.)
- [x] If this milestone is scoped as design-only (charter-time decision), an `-IMPL` follow-up row is
  seeded in `backlog.md` per the escrow-Δv clause's own requirement — do not let this ship as
  shelfware, exactly the failure class DIR-017 itself exists to prevent. (Confirmed N/A, correctly:
  charter's "Value hypothesis" section (`charters/M36-dod-leakage-metrics.md` lines 30-37) explicitly
  states this milestone is design-then-real, NOT design-only — it ships the real
  `inherited-core.md`/`dashboard.md` artifacts directly, verified above via `git diff --stat` showing
  the real doc content landed, not a design doc for later code. No `-IMPL` row required or present in
  `backlog.md`'s diff, correctly.)

## Status mirror
SELECTed @m36 DRAIN/SELECT boundary, 2026-07-19. Sole open candidate this cycle — no competing choice
to reason through (unlike m34/m35). DIR-017 Step 3 is now finally in progress; Steps 0-2 already
delivered (M21, M25/DIR-019-fix/M30, M32 respectively).
