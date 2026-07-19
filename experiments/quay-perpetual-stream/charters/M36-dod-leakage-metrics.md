# Charter M36-dod-leakage-metrics — DIR-017 Step 3: leakage metrics as
# homeostatic variables on dashboard.md

**Milestone id:** M36-dod-leakage-metrics · **surface:** method-infra (`inherited-core.md`,
`dashboard.md`, `OUTER-LOOP.md`) · **type:** explore, governance-integrity
**Source:** `tasks/exp5-M-DOD-LEAKAGE-METRICS.md` (SELECTed m36, sole open candidate this cycle) —
`directives/pending/DIR-017-*.md` Step 3.
**Charter authored:** m35→m36 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD `54695af`
(post-m35-publish-and-sync, confirmed via `git rev-parse exp5-outer-driver`).

## SELECT reasoning
Only one open candidate in `directives/pending/` at this DRAIN boundary: DIR-017 Step 3. No competing
choice to reason through this cycle (unlike m34/m35's explicit multi-candidate choices). Steps 0-2 of
DIR-017's ordered program are already delivered (Step 0: M21; Step 1: M25 + DIR-019-fix/M30; Step 2:
M32) — Step 3 is the last remaining piece of the ordered program DIR-017 originally established.

## Acceptance Criteria / Definition of Done
Authored into the task, not duplicated here — see `tasks/exp5-M-DOD-LEAKAGE-METRICS.md`'s
`## Acceptance Criteria` (5 checklist items) and `## Definition of Done` sections.

## Value hypothesis
- Value type(s): **governance-integrity (primary)** — makes the exp6 meta-objective (a
  self-correcting perpetual stream) measurable with real numbers instead of only qualitative prose
  judgments ("seems to be working", scattered across ABSORB entries). **explore** — no existing
  deviation-tracking schema exists; this milestone must design one, not just implement a
  pre-specified mechanism (confirmed via direct grep at task-authoring time, see task's own
  "Notes" section).
- **Δv̂:** ≈0 (methodology/governance-integrity, no VT chart cell — mirrors M25/M30/M31/M32/M34's own
  established no-VT-cell precedent for this DoD-program lineage).
- **Scope decision (design-then-real, NOT design-only):** this milestone ships real doc/dashboard
  changes directly (the schema documented in `inherited-core.md`, a real homeostatic-variables
  section computed against real backfilled data in `dashboard.md`) — it is NOT design-only, so the
  escrow-Δv clause (6) does not apply and no `-IMPL` follow-up row is required. Reasoning: unlike a
  milestone that produces a design doc for future code (escrow-Δv's intended trigger), this
  milestone's "implementation" IS the doc/dashboard artifact itself — there is no separate future
  code-shipping step to escrow against. State this explicitly in the report; do not let it be
  read as a silent self-exemption (Clause 5) — this is a genuine non-trigger, not an exemption.
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file).

## Current-state notes (re-verified directly against source at charter-authoring time)
- No dedicated deviation-tracking file exists today. `ls experiments/quay-perpetual-stream/*.md`:
  `OUTER-LOOP.md`, `README.md`, `backlog.md`, `dashboard.md`, `inherited-core.md`,
  `v-meta-ledger.md` — none is a deviation log. `grep -n "deviation" dashboard.md` finds only
  free-text prose mentions, no structured fields.
- Known real deviations already on record in `dashboard.md`'s own history, usable as backfill worked
  examples (re-verify each citation directly, do not assume from this summary): M11's audit-gate
  self-exemption (pre-DIR-017 era), M26's path-traversal finding (ADV-004), DIR-019's clause-5 blind
  spot (found ~m29, fixed M30), M30's own self-disclosed single-commit process deviation, M32's
  Clause 7 negation-blind regex gap (found and fixed within m32's own ABSORB).
- `v-meta-ledger.md` already has ONE structured record type (insight/origin/status ledger,
  `confirmed`/`consolidated` states) — a plausible schema-design reference/precedent for the new
  deviation-record schema (a table with typed status transitions), though the fields differ (insight
  vs. deviation is a different concept — do not conflate them, but the tabular-ledger PATTERN is
  reusable).
- Realized Δv figures are already recorded per-ABSORB in `dashboard.md` (e.g. m29 +0.50, m33 +0.40) —
  the "product-value shipped per K milestones" metric can be computed directly from these existing
  entries without needing new instrumentation; cite the actual arithmetic in the report.

## In scope
1. Design and document a structured "deviation" record schema in `inherited-core.md` (or a new
   dedicated file it references, implementer's choice — state which and why): fields at minimum —
   what qualifies as a deviation, `caught-by` (machine: an `it0-*` check failing / adversarial-audit
   CONCERNS-or-worse finding; human: a directive like DIR-019/DIR-020 or a human-verification-gate
   finding), `status` (including a `verified-eliminated` terminal state — define what "verified"
   means operationally, e.g. externally re-tested per DIR-019's own resolution discipline), and a way
   to compute age (e.g. milestone-count or date span from found to verified-eliminated).
2. Best-effort backfill of the schema against `dashboard.md`'s existing history, using the 5 known
   deviations named in "Current-state notes" above as worked examples (not a claim of exhaustive
   historical coverage — state this limitation explicitly).
3. Add a homeostatic-variables section to `dashboard.md` computing, from the backfilled schema, the
   four DIR-017 Step 3 metrics: (a) deviations caught by machine vs human (count/ratio), (b) fraction
   of recorded deviations reaching `verified-eliminated`, (c) median deviation age, (d) product-value
   shipped per K milestones (derived from existing Realized Δv entries).
4. State explicitly, in `OUTER-LOOP.md` or `inherited-core.md`, whose job it is to update the
   deviation log going forward (each future ABSORB that discloses/resolves a deviation should
   append/update a record) — mirrors how DIR-020/M34 named the audit as the standing checklist
   write-back writer; this milestone must similarly name the writer and the trigger point.
5. Show a live computation of the four metrics against the real backfilled data in the report (real
   numbers, not placeholders or "TBD").

## Explicitly OUT of scope
- Exhaustive historical backfill of every deviation since m1 — best-effort against the 5 named
  examples is sufficient; state the limitation, do not claim completeness.
- Building tooling/scripts to auto-detect deviations from git history or CI — this milestone is a
  schema + manual backfill + dashboard section, not an automated detector. A future candidate may
  build automation on top of this schema.
- V_meta consolidation-lag gate: N/A pending re-confirmation at ABSORB — `v-meta-ledger.md`'s one row
  is already `consolidated` (m7), no `confirmed`-and-unresolved rows as of m35 (re-confirm, not
  assumed here).
- Escrow-Δv gate (Clause 6): N/A — this milestone is NOT design-only, per the Value hypothesis
  section's explicit scope decision above (ships the real doc/dashboard artifact directly).
- Test-floor gate (Clause 7): N/A — `surface:method-infra` is exclusively non-product-touching (no
  `packages/quay*` files touched by this milestone's scope; re-confirm via `git diff --stat` at
  ABSORB).

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (see `tasks/exp5-M-DOD-LEAKAGE-METRICS.md`) plus:
1. Deviation-record schema documented in `inherited-core.md` (or a clearly-referenced dedicated file).
2. ≥5 real historical deviations backfilled as worked examples, each with `caught-by`/`status`/age.
3. `dashboard.md`'s new homeostatic-variables section computes all 4 DIR-017 Step 3 metrics with real
   numbers, citing the actual arithmetic.
4. The forward-update responsibility (who updates the log, and when) is explicitly named in
   `OUTER-LOOP.md` or `inherited-core.md`.
5. `git diff --stat` confirms no `packages/quay*` product files touched (method-infra only); no
   unrelated files touched.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged (same discipline as M25-M35). The manda healthz
gate and port-4173 reachability gate are N/A this milestone (no Web UI surface touched) — state N/A
explicitly in each iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 5 in-scope items — under the
  small-milestone threshold (8), though this is an explore/design milestone with more open-ended
  reasoning than a typical small fix; re-confirm before dispatch.
- `it0-impl-row-check.sh exp5-M-DOD-LEAKAGE-METRICS backlog.md`: not design-only per the explicit
  scope decision above — gate does not apply, PASS expected (re-run after `backlog.md` regen).

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Runs regardless of VT cadence. Dispatch a fresh-context, out-of-band adversarial-audit subagent at
ABSORB, refute-first stance against this task's 5 AC clauses + DoD. Given the schema is genuinely a
DESIGN artifact, the audit should specifically probe: (a) is the schema actually usable to classify a
NEW deviation the audit itself invents as a test case (not just the 5 backfilled examples)? (b) do the
4 computed metrics' numbers actually follow from the backfilled data, re-derived independently, not
copied from the report? (c) is the "who updates this going forward" responsibility actually stated
unambiguously, or vague enough to be ignored in practice (the exact failure class DIR-017 itself
exists to prevent)? Per DIR-020/M34/M35's standing write-back mechanism, the audit ticks `- [x]` on
each AC/DoD checklist item it confirms, via a direct write-back to
`tasks/exp5-M-DOD-LEAKAGE-METRICS.md`, with an inline evidence citation per item.

## Note for ABSORB
1. Confirm the escrow-Δv N/A determination holds — re-verify this milestone genuinely shipped the
   real artifact, not a design doc for later code (re-read the actual diff, don't assume from this
   charter).
2. Confirm the 4 metrics' numbers in `dashboard.md`'s new section are independently re-derivable from
   the backfilled schema data, not just asserted.
3. State the m37 DRAIN/SELECT candidate note explicitly — after this milestone, DIR-017 will be fully
   resolved (all 3 steps delivered); check whether `directives/pending/` is now empty, and if so, note
   that the standing backlog (post-M28 forward-looking candidates, if any remain) or a fresh SELECT
   sweep is needed — do not silently default.
4. Checkpoint cadence: **not due at this milestone's ABSORB.** `milestone_counter` becomes **36** at
   this ABSORB (m35 set it to 35) — the next checkpoint is due at `milestone_counter=40` (every-5
   rule, last written cp-35 at m35). Do not miscount.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit, same
worktree/branch-per-iteration pattern as M25-M35 (`experiments/quay-perpetual-stream/milestones/
M36-dod-leakage-metrics/worktrees/iteration-{0,1}`, branches `exp5-m36-iteration-{0,1}`). Iteration-1
must NOT read iteration-0's materials (independent-verification discipline). This milestone is
genuinely open-ended design work (schema definition) — the two iterations are likely to propose
DIFFERENT schemas; do not assume convergence the way M34/M35 happened to converge. If they diverge
meaningfully, reconcile on the merits (mirrors M32's precedent: a live repro/argument deciding between
two real designs, not defaulting to iteration-0 without justification). Both iterations must actually
compute the 4 metrics against real backfilled data, not leave them as formulas/placeholders.
