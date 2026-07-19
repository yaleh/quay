# M40-dir014-task-canonical-lifecycle-record — iteration-0 report

**Branch:** `exp5-m40-iteration-0` · **Base:** `exp5-outer-driver` @ `8c3c2bf` · **Worktree:**
`experiments/quay-perpetual-stream/milestones/M40-dir014-task-canonical-lifecycle-record/worktrees/iteration-0`

## HARD GATES

`GATE-HASH-REF` re-confirmed unchanged immediately before starting work:

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md
PASS: experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```

Re-confirmed again at the end of the build (same output, unchanged).

manda healthz gate and port-4173 reachability gate: **N/A** — no Web UI surface touched by this
milestone (per the charter's own note).

## What I built

1. **Task's own `## Proposal`/`## Plan` (AC item 1).** The task
   `tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md` already carried a well-formed
   `## Proposal` (real, non-boilerplate approach text, ~4.4KB) and `## Plan` (`N/A — <reason>`,
   correctly reasoned as a small mechanical change) authored by the outer-loop orchestrator. I
   verified it against my own Clause-8 implementation (see AC 5 below) and found it well-formed —
   I did not need to extend it.

2. **New DoD Clause 8 in both `it0-dod-check.sh` and `it0-dod-check.mjs` (AC item 2).** Added a new
   block in `it0-dod-check.mjs` (the shell wrapper just delegates, its header comment updated to
   match) that:
   - Reuses the SAME `extractSection()` helper Clause 0 already uses (no parallel implementation).
   - FAILs if `## Proposal` is missing, or present-but-placeholder (empty, `TBD`/`TODO`/`N/A`/`xxx`/
     `...`, or under a 40-char real-content floor).
   - FAILs if `## Plan` is missing entirely.
   - PASSes if `## Plan`'s body starts with `N/A` (case-insensitive) + a dash/colon + real reasoning.
   - PASSes if `## Plan`'s body references a `docs/plans/*.md`-shaped path that resolves on disk
     (checked against both `process.cwd()` and the script's own repo-root-relative candidate).
   - FAILs if a referenced `docs/plans/*.md` path does NOT resolve (a broken reference is a harder
     failure than an honest N/A).
   - Added `"task-canonical-lifecycle-record"` to Clause 5's `MECHANICALLY_UNCONDITIONAL_CLAUSES`
     set and `clauseNames` array, so an undeclared self-exemption of Clause 8 in a charter's
     "Explicitly OUT of scope" section is caught, mirroring Clauses 3/4/6/7's own DIR-019 fix.

3. **Fixtures (AC item 3).** Added exactly 2 new fixtures under `fixtures/dod/`:
   - `task-canonical-record-compliant-stub.md` (GREEN, `M40B-fake-canonical-compliant`) — a
     well-formed `## Proposal` + `## Plan: N/A — <reason>`.
   - `task-canonical-record-violating-stub.md` (RED, `M40C-fake-canonical-violating`) — a
     placeholder `## Proposal` (`TBD`) AND a `## Plan` referencing a non-existent
     `docs/plans/*.md` path (both defects present simultaneously, to prove the failure output names
     both, not just one).
   Both wired into `scripts/dod-fixture-selfcheck.sh` (2 new `CASES` entries, all 13 prior cases
   unchanged).

4. **`inherited-core.md` documentation (AC item 4).** Added a new subsection immediately after
   Clause 0's own documentation block (before Clause 1's), titled "Clause 0's sibling — task
   canonical-lifecycle-record gate", followed by the full "Clause 8" four-field-template entry
   (Trigger condition / What it checks / Pass/fail semantics / Current invocation point), explicitly
   cross-referencing "DIR-014 item 6" by name. Updated the section's own header and summary
   paragraphs to mention the ninth clause and M40. Did NOT touch the two-class diversity policy
   section (verified via `git diff inherited-core.md | grep -B3 -A3 "diversity policy"` — zero
   hits).

5. **Self-referential proof (AC item 5).** See "Self-referential DoD-check proof" below.

## Deviation from the charter's suggested design — and why

The charter/task's suggested design describes Clause 8 as firing "every milestone, unconditionally"
(mirroring Clause 0). **I deviated from this**, because an unconditional trigger directly
contradicts an explicit constraint elsewhere in the SAME charter/task: "Explicitly OUT of scope:
Retroactively backfilling `## Proposal`/`## Plan` onto the ≤M39 milestones' tasks — DIR-014's own
text is explicit this is forward-only, same as DIR-020's AC/DoD rule," and the "Current-state notes"
section's own finding that "0 of the 24 exp5-M-* tasks currently carry a `## Proposal` section."

I verified this concretely: I ran the mjs's Clause-0-style task lookup against all 24 pre-existing
`exp5-M-*` tasks in `tasks/` — 23 of them have NO `## Proposal` section at all (only this
milestone's own task does). An unconditional Clause 8 would retroactively HARD-BLOCK every one of
those 23 tasks' hypothetical re-ABSORB, which the charter explicitly disclaims doing.

**Fix:** I gated Clause 8's trigger condition on the EXISTING `milestone:M<N>` task-label convention
(already present on most `exp5-M-*` tasks, e.g. this task's own `milestone:M40-...` label) — it
fires only for `N >= 40` (this milestone, the first to require the section). A task with no
`milestone:M<N>` label, or `N < 40`, N/A-passes as legacy/grandfathered, with the reasoning stated
explicitly in the PASS message (not silently skipped). This exactly mirrors DIR-020/M34's own
precedent for Clause 0's checklist-vs-prose distinction ("checklist form MANDATED going forward ...
NOT retroactively rewritten ... no retroactive sweep required").

I verified the fix does not weaken the clause for its intended target: it correctly FAILs against
the RED fixture (which carries a `milestone:M41-...` label, i.e. post-cutover) and correctly PASSes
against this milestone's own real task (`milestone:M40-...`). I also spot-checked it against a real
pre-M40 task (`exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES`, `milestone:M39-...`) and confirmed it
N/A-passes with an explicit grandfather-reason message (see verification transcript below) — proving
the backward-compatibility guarantee holds for a REAL task, not just a synthetic case.

No other deviations from the suggested design (extractSection reuse, 2 fixtures, inherited-core.md
subsection placement) — those match the task's own Proposal exactly.

## Verification

### Fixture selfcheck (AC item 3 requirement)

```
$ bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh
PASS: M98-fake-compliant — exit 0 (expected 0) [fixtures/dod/compliant-stub.md]
PASS: M99-fake-violating — exit 1 (expected 1) [fixtures/dod/violating-stub.md]
PASS: M96-fake-linebudget-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-linebudget-stub.md]
PASS: M95-fake-implrow-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-implrow-stub.md]
PASS: M94-fake-missing-ac — exit 1 (expected 1) [fixtures/dod/missing-ac-stub.md]
PASS: M97-fake-escrow-violating — exit 1 (expected 1) [fixtures/dod/escrow-deltav-violating-stub.md]
PASS: M97B-fake-escrow-compliant — exit 0 (expected 0) [fixtures/dod/escrow-deltav-compliant-stub.md]
PASS: M93-fake-testfloor-violating — exit 1 (expected 1) [fixtures/dod/test-floor-violating-stub.md]
PASS: M93B-fake-testfloor-compliant — exit 0 (expected 0) [fixtures/dod/test-floor-compliant-stub.md]
PASS: M92-fake-escrow-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-escrow-stub.md]
PASS: M91-fake-testfloor-negation — exit 1 (expected 1) [fixtures/dod/test-floor-negation-poison-stub.md]
PASS: M90-fake-checklist-unchecked — exit 1 (expected 1) [fixtures/dod/checklist-unchecked-box-stub.md]
PASS: M90B-fake-checklist-checked — exit 0 (expected 0) [fixtures/dod/checklist-all-checked-compliant-stub.md]
PASS: M40C-fake-canonical-violating — exit 1 (expected 1) [fixtures/dod/task-canonical-record-violating-stub.md]
PASS: M40B-fake-canonical-compliant — exit 0 (expected 0) [fixtures/dod/task-canonical-record-compliant-stub.md]

PASS: all 15 DoD fixtures behaved as asserted.
```

All 13 pre-existing fixtures continue to pass UNCHANGED (backward-compatibility confirmed — Clause 8
correctly N/A-passes them all, since none carry a `milestone:M40+` label). The 2 new fixtures
correctly exercise the RED/GREEN split, isolated to Clause 8 only — I confirmed by running both
individually and diffing clause-by-clause output: every clause 0-7 disposition is IDENTICAL between
the RED and GREEN fixture; only clause 8 differs (FAIL with 2 named violations vs. PASS).

### Self-referential DoD-check proof (AC item 5 requirement)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md /tmp/m40-absorb-entry.md
--- it0-dod-check: exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD ---
charter: experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md
absorb-entry: /tmp/m40-absorb-entry.md

PASS: clause1-adversarial-audit: disposition statement present (documented no-op)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — ... scope within the small-milestone norm ...
PASS: clause4-impl-row: PASS — ... not design-only ... impl-row gate does not apply.
PASS: clause5-no-self-exemption: no undeclared self-exemption language found ...
PASS: clause6-escrow-delta-v: N/A — milestone is not design-only (rule does not apply)
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching ...
PASS: clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' (4390 chars) and a well-formed '## Plan' [tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]
FAIL: clause0-ac-dod-present: checklist-form AC has 5 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does): "**item 6a ...", "**item 6b ...", "**item 6c ...", "`inherited-core.md` gains ...", "This milestone's own ABSORB DoD check ..." [tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]

FAIL: DoD check failed — 1 clause violation(s) found (see above).
EXIT=1
```

This is the **genuinely self-referential invocation** requested: the CLI reads the REAL task file
(`tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md`, resolved via the same lookup path Clause
0 uses) and confirms **Clause 8 specifically PASSES for the right reason** — it found a real,
4390-character `## Proposal` body and a well-formed `## Plan` (`N/A — <reason>`) in this task's own
body. Note `[tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]` in the PASS line — proof it
read the real task file, not a fixture-text fallback.

The overall run exits 1 — but per the charter's own note 5 ("other DoD clauses ... may legitimately
FAIL/be-pending at this stage since the audit hasn't run yet — that's expected"), this is exactly
that expected case: Clause 0 fails because the checklist-form AC boxes are still unchecked (`- [ ]`)
— they are only ticked by the per-milestone acceptance audit at real ABSORB time (a step that has
not run in this iteration), not because Clause 8 or any of my new code failed. **Clause 8's own
disposition is unambiguously PASS**, which is what AC item 5 asks me to confirm.

I invoked `it0-dod-check.sh` (task id as first arg, per the charter's own convention note 3) rather
than `quay gate ...`, because Clause 8 is not yet wired into a separate `quay gate` engine command —
stating this explicitly per the AC's own "state which" instruction.

### Grandfather-path spot-check against a REAL pre-M40 task (extra verification, not a formal AC)

```
$ bash scripts/it0-dod-check.sh exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES /tmp/m39-absorb-entry.md /tmp/m39-absorb-entry.md 2>&1 | grep clause8
PASS: clause8-task-canonical-lifecycle-record: N/A — milestone:M39 < M40 cutover — legacy task, predates DIR-014 item 6 (forward-only, no retroactive backfill per this milestone's own charter) [../../tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md]
```

Confirms the forward-only cutover mechanism works correctly against a real repo task (not just a
synthetic fixture), and states its N/A reason explicitly rather than silently passing.

### Syntax / regression checks

```
$ node --check scripts/it0-dod-check.mjs && bash -n scripts/it0-dod-check.sh && bash -n scripts/dod-fixture-selfcheck.sh
ALL SYNTAX OK
```

### Gate-hash re-confirmation (post-build)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md
PASS: ... matches current pinned source ... sha256.
```

## Scope discipline

- No `packages/quay*` product files touched (`git status --porcelain` shows only
  `inherited-core.md`, `scripts/dod-fixture-selfcheck.sh`, `scripts/it0-dod-check.{mjs,sh}`, and 2
  new fixture files).
- `.claude/skills/quay-task-to-plan/` not touched.
- `tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md` not modified (already well-formed).
- No other `exp5-M-*` task's `## Proposal`/`## Plan` retroactively backfilled.
- Two-class diversity policy's dev-class discretionary language in `inherited-core.md` not touched
  (verified via targeted diff grep, zero hits).

## Honest self-assessment against the 5 Acceptance Criteria

1. **item 6a (proposal embedded):** MET. The task's `## Proposal` is real, non-placeholder content
   (~4.4KB), verified both by reading it and by Clause 8's own PASS disposition against it.
2. **item 6b (plan referenced):** MET. The task's `## Plan` states `N/A — <reason>` with genuine
   mechanical-change reasoning, verified the same way.
3. **item 6c (enforcement is real, not prose):** MET, with one documented, justified deviation
   (forward-only cutover gating rather than a fully unconditional trigger — see "Deviation" section
   above; this deviation is REQUIRED by the charter's own out-of-scope constraint, not an
   independent judgment call). Clause 8 exists in both `.sh` and `.mjs`, HARD-blocks on all 3 named
   failure modes (missing/placeholder Proposal, missing Plan, unresolved `docs/plans/*.md`
   reference), 2 new fixtures added and wired, full 15-fixture suite green.
4. **inherited-core.md documentation:** MET. New subsection placed immediately after Clause 0's own
   documentation, cross-references "DIR-014 item 6" by name, two-class diversity policy untouched.
5. **Self-referential ABSORB-gate proof:** MET. Real `it0-dod-check.sh` invocation against the real
   task and real charter shows Clause 8 PASSing specifically because the task's own Proposal/Plan
   sections are present and well-formed — transcript above, with the real task-file path visible in
   the PASS line as evidence it read the genuine source, not a fixture fallback.

**Residual risk / honest caveat for the adversarial audit to probe:** the forward-only cutover
mechanism (M<N>-label-based) is my own design addition beyond the task's literal Proposal text,
which described an unconditional trigger. I believe the deviation is correct and necessary (I
demonstrated the contradiction concretely against all 24 real tasks), but it IS a design decision an
independent iteration-1 attempt might resolve differently (e.g. a dated cutover instead of a label-
number cutover) — worth cross-checking during reconciliation.
