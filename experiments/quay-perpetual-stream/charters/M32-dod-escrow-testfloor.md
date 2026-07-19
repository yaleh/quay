# Charter M32-dod-escrow-testfloor — DIR-017 Step 2: escrow-Δv clause + product-work
# test-floor clause, added to inherited-core.md's Definition of Done

**Milestone id:** M32-dod-escrow-testfloor · **surface:** method-infra
(`inherited-core.md`/`scripts/it0-dod-check.mjs`) · **type:** explore (governance-integrity)
**Source:** `tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md` (SELECTed m32) — DIR-017 Step 2, unblocked by
DIR-017's human-verification-gate clearance (commit `e6bc3a2`, human, 2026-07-19; grounded in
DIR-019/M30's clause-5 fix, re-verified against `master`@`a96ff23`).
**Charter authored:** m31→m32 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD
`b93a391` (post-m31-publish + Clause-1 prose-drift fix, confirmed via `git rev-parse
exp5-outer-driver`).

## Acceptance Criteria / Definition of Done
Authored into the task, not duplicated here — see `tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md`'s
`## Acceptance Criteria` (5 clauses) and `## Definition of Done` sections (per
`inherited-core.md`'s "AC/DoD live in the TASK" rule, Clause 0). This charter is the
implementation PLAN against that task's AC/DoD, not a second copy of them.

## Value hypothesis
- Value type(s): **explore, governance-integrity (primary)** — closes two more Goodhart surfaces
  DIR-017's own Finding names: (1) a design-only milestone's VT Δv counted as final before its
  `-IMPL` ships, (2) product-touching work shipping without a recorded test-coverage floor. No
  exploit/capability-growth component — this is pure methodology infra, mirrors M25/M30/M31's own
  no-VT-cell precedent.
- **Δv̂: 0** (method infra, no VT chart cell — recorded explicitly, not omitted).
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file) — two new named DoD
  clauses in `inherited-core.md`, mechanically enforced in `it0-dod-check.mjs`, ≥2 new fixtures
  proving both directions (violate/comply) for each clause, `dod-fixture-selfcheck.sh` green
  end-to-end (existing 5 + new fixtures), `OUTER-LOOP.md` step 6 text updated to name both new
  clauses (no prose/mechanical drift — the exact class of gap this milestone's own DRAIN just
  fixed for Clause 1, see "Current-state notes" below).

## Current-state notes (re-verified directly against source at charter-authoring time)
- `inherited-core.md`'s "Definition of Done" section currently has 6 clauses: Clause 0 (AC/DoD
  present), Clause 1 (per-milestone acceptance audit — UNCONDITIONAL as of `bb3a199`, prose fixed
  to match at this DRAIN boundary), Clause 2 (V_meta-lag), Clause 3 (line-budget), Clause 4
  (impl-row), Clause 5 (no-self-exemption). This milestone adds Clause 6 (escrow-Δv) and Clause 7
  (test-floor) — do not renumber the existing six.
- `scripts/it0-dod-check.mjs` currently checks clauses 0-5 (Clause 3/4 mechanically unconditional
  per DIR-019's fix; Clauses 1/2 documentation-discipline checks; Clause 0/5 pattern checks). New
  clauses 6/7 must follow the SAME dispatch shape (`MECHANICALLY_UNCONDITIONAL_CLAUSES` set vs.
  disposition-statement checks) — read the existing clause 3/4 implementation (mechanical,
  unconditional) as the template for escrow-Δv (also mechanically checkable: does the ABSORB
  entry's VT-curve-append language for a design-only milestone use escrow/provisional language) and
  clause 4/impl-row's trigger-condition shape as the template for test-floor's product-touching
  trigger condition (only fires when the milestone's backlog row / task labels indicate a
  product-code surface, e.g. `surface:cli`/`surface:web-ui`/`surface:provider-abi`, not
  `surface:method-infra`/`surface:docs`).
- `scripts/dod-fixture-selfcheck.sh` currently asserts 5 fixtures (`fixtures/dod/*.md`) — add at
  least 2 more (one per new clause) without touching the existing 5's content (mirrors DIR-019's
  own "fixtures unchanged" discipline for a fix to the enforcer's own code).
- **DIR-017's own text is directly authoritative for clause DEFINITION** (quoted in the task's
  Scope note) — do not invent a materially different design; this charter operationalizes DIR-017's
  own wording, not a reinterpretation of it.

## In scope
1. Author Clause 6 (escrow-Δv) in `inherited-core.md`'s Definition of Done section, same
   four-field template (Trigger condition / What it checks / Pass/fail semantics / Current
   invocation point) as Clauses 0-5.
2. Author Clause 7 (product-work test-floor) in the same section, same template.
3. Implement both as new checks in `scripts/it0-dod-check.mjs`, wired into the same HARD-BLOCK
   exit-code contract (0 = PASS, 1 = FAIL, 2 = usage/env error) as the existing 6 clauses.
4. Add ≥2 new fixtures under `fixtures/dod/` (one violating each new clause) + their compliant
   counterparts if not already covered by the existing `compliant-stub.md`; update
   `scripts/dod-fixture-selfcheck.sh` to assert them; existing 5 fixtures/assertions unchanged.
5. Update `OUTER-LOOP.md` step 6's DoD meta-enforcer gate sub-step text to name Clauses 6/7
   alongside 0-5 (prevents the exact Clause-1 prose-drift class this milestone's own DRAIN fixed).
6. Update `tasks/DIR-017.md`'s and the DIR-017 pending-file's status-mirror language to note Step 2
   is now in-progress/delivered by this milestone (Step 3 — leakage metrics — remains open,
   separately selectable; DIR-017's own `status:` stays `pending` until Step 3 also lands, per its
   own "Step 2/3 unlocks, does not complete them" clearance-note language).

## Explicitly OUT of scope
- **Step 3 (leakage metrics onto `dashboard.md`)** — DIR-017's own text names this as a separate,
  later, separately-selectable step; this charter is Step 2 only.
- Renumbering or re-deriving Clauses 0-5 — cited by reference only, never re-implemented.
- Any change to `OUTER-LOOP.md`'s SELECT/ABSORB step SEQUENCE or the DIR-projection/master↔driver
  isolation mechanics (DIR-018/M23's scope) — this charter only adds two clause bodies + their
  mechanical checks + doc cross-reference, not process restructuring.
- V_meta consolidation-lag gate: N/A this milestone (no `v-meta-ledger.md` row applies — confirmed
  at ABSORB, not assumed here).
- Design-only-milestone impl-row gate: N/A — this milestone is not design-only (produces real code:
  `inherited-core.md` clauses + `it0-dod-check.mjs` logic + fixtures + `OUTER-LOOP.md` text), gate
  does not apply (no exemption claimed, simply inapplicable per its own trigger condition).

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (see `tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md`) plus
the standard cross-cutting hygiene clause:
1. Clause 6 (escrow-Δv) authored in `inherited-core.md`, four-field template, cross-referencing this
   milestone + DIR-017 Step 2.
2. Clause 7 (test-floor) authored in `inherited-core.md`, four-field template, same cross-reference.
3. `scripts/it0-dod-check.mjs` mechanically checks both (exit 1 HARD-block on violation).
4. `scripts/dod-fixture-selfcheck.sh` gains ≥2 new fixtures, full suite exits 0 with ALL fixtures
   (existing 5 + new) behaving as asserted.
5. Synthetic violating stubs for BOTH new clauses FAIL as expected; corresponding compliant stubs
   PASS.
6. `OUTER-LOOP.md` step 6 text updated to name Clauses 6/7 — no prose/mechanical drift between the
   two files (verified by re-reading both side by side, not assumed).
7. `git diff --stat` scoped to `inherited-core.md`, `scripts/it0-dod-check.mjs`,
   `scripts/dod-fixture-selfcheck.sh`, `fixtures/dod/*`, `OUTER-LOOP.md`, `tasks/DIR-017.md`, the
   DIR-017 pending file, and this milestone's own report — no unrelated files touched. Real
   repo-root `tasks/` directory confirmed untouched by any test run.
8. Full existing test suite (`dod-fixture-selfcheck.sh` + `it0-dir-projection-check.sh` +
   `packages/quay` test suite) green before AND after — this milestone touches shared governance
   infra, a regression here would silently break EVERY future milestone's ABSORB gate.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim; the
manda hub healthz gate and port-4173 reachability gate are explicitly N/A here and must be STATED as
N/A in each iteration's own report, not silently omitted):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged (same discipline as M25-M31).

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 6 in-scope items — under the
  small-milestone threshold (8). PASS expected, re-confirm before dispatch.
- `it0-impl-row-check.sh exp5-M-DOD-ESCROW-TESTFLOOR backlog.md`: not design-only, gate does not
  apply — PASS expected (re-run after `backlog.md` regen picks up this task's new row).

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Runs regardless of VT cadence per the now-corrected Clause 1 text — dispatch a fresh-context,
out-of-band adversarial-audit subagent at ABSORB, refute-first stance against this task's 5 AC
clauses + DoD + a live re-run of `dod-fixture-selfcheck.sh` and `it0-dod-check.sh` against the
merged state. Given this milestone modifies the enforcer's OWN mechanics, the audit must explicitly
re-run the FULL fixture suite itself (not trust the milestone's self-reported PASS), mirroring
DIR-019's own self-referential-fix discipline.

## Note for ABSORB
1. Confirm both new clauses were operationalized as DIR-017's own text specifies, not a
   reinterpretation — quote the relevant DIR-017 sentence next to each clause's implementation.
2. State explicitly whether the escrow-Δv clause interacts with any currently-open design-only
   backlog row (there may be none at m32 — check `backlog.md` for any `design delivered` marker) —
   if one exists, note whether this clause's landing changes how its Δv is currently being recorded.
3. Realized Δv: expected 0 (method infra, no VT chart cell) — confirm explicitly.
4. DIR-017 status: Step 2 delivered; DIR-017 itself stays `pending` (Step 3 still open) — restate
   at DRAIN per the DIR's own clearance-note discipline, do not silently imply DIR-017 is fully
   resolved.
5. State plainly whether Step 3 (leakage metrics) should be the m33 SELECT candidate, or whether
   iteration work surfaced a reason to prioritize something else — do not silently assume Step 3 is
   next without checking against the backlog's other open rows at that boundary.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit, same
worktree/branch-per-iteration pattern as M25-M31 (`experiments/quay-perpetual-stream/milestones/
M32-dod-escrow-testfloor/worktrees/iteration-{0,1}`, branches `exp5-m32-iteration-{0,1}`).
Iteration-1 must NOT read iteration-0's materials (independent-verification discipline). Explicitly
instruct BOTH iterations that this milestone modifies the SAME mechanism that will gate their own
ABSORB (self-referential, same class as M30/DIR-019) — extra care against the temptation to design a
lenient check that trivially passes their own work; both iterations must independently attempt to
construct a genuinely violating synthetic fixture for each new clause, not just a fixture shaped to
pass.
