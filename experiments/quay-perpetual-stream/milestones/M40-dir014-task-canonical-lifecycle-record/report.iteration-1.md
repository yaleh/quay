# M40-dir014-task-canonical-lifecycle-record — iteration-1 report

**Branch:** `exp5-m40-iteration-1` · **Base:** `exp5-outer-driver` @ `8c3c2bf` · **Independent
verification attempt** (no materials from iteration-0 were read).

## Plan-time gate re-confirmation

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md
PASS: experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```
Charter unchanged, gate still valid.

**Web UI / manda healthz / port-4173 gates: N/A this milestone** — no Web UI surface touched, stated
explicitly per the charter's HARD GATES note.

## What was built

1. **AC item 6a/6b (task carries `## Proposal` + `## Plan`):** the task
   (`tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md`) was already committed at the base
   commit with a well-formed `## Proposal` (~4.4KB of real approach text, single chosen approach for
   a design-class milestone, explicit rejected-alternative paragraph) and a `## Plan` section stating
   `N/A — this is a small, single-pass mechanical change ...` with genuine reasoning. I read it
   carefully against the AC text and found no gaps — no extension was needed. I did not modify the
   task file.

2. **AC item 6c (new DoD sibling clause, both script variants):** added **Clause 8** to
   `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` (98 new lines), placed as the last
   clause block before the final report/exit-code section, reusing the identical
   `taskCandidates`/`extractSection()` lookup pattern Clause 0 already uses (not a parallel
   implementation). Clause 8:
   - FAILs if `## Proposal` is missing or present-but-empty/placeholder (`<40` chars after trim, or
     matches a `TBD|TODO|N/A|xxx|...`-only line).
   - FAILs if `## Plan` is missing entirely.
   - PASSes if `## Plan`'s trimmed body matches `^N\/A\s*[-—:]\s*\S.+` (case-insensitive `N/A` +
     dash/colon + real reasoning).
   - PASSes if `## Plan` contains one or more `docs/plans/*.md`-shaped paths and ALL of them resolve
     on disk (relative to repo root, computed the same way the existing `tasks/` fallback path is
     computed — 3 levels up from `scripts/`).
   - FAILs if any referenced `docs/plans/*.md` path does NOT resolve.
   - FAILs if `## Plan` is present but names neither an `N/A` statement nor a `docs/plans/*.md` path.

   `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh` (the shell wrapper) was **not**
   modified. This is a deliberate, checked decision, not an oversight: the wrapper is a pure
   argument-count/node-availability check that delegates entirely to `it0-dod-check.mjs` — it
   contains zero clause-specific logic today, and `git log` confirms it has never been touched by any
   prior clause addition either (M25's original 6 clauses, or M32's Clause 6/7 addition) — the "add
   to both" instruction is satisfied in spirit because both files run all 9 clauses (0-8) on every
   invocation; there is no clause enumeration inside the `.sh` file to extend.

   I also updated Clause 5's `MECHANICALLY_UNCONDITIONAL_CLAUSES` set and `clauseNames` list to
   include `"task-lifecycle-record"`, since Clause 8 — like Clauses 3/4/6/7 — calls
   `dispositionedClauses.add(...)` on both its pass and fail branches (confirmed by reading my own
   code), which per the DIR-019 reasoning documented at Clause 5 means an "already dispositioned"
   state is not legitimate evidence a self-exemption of it is safe to allow through un-waived.

3. **AC item 6c (2 new fixtures + selfcheck wiring):** added
   `fixtures/dod/task-lifecycle-record-compliant-stub.md` (GREEN, fake id
   `M89-fake-lifecycle-compliant`, asserted exit 0 — well-formed `## Proposal` + `## Plan: N/A —
   <reason>`) and `fixtures/dod/task-lifecycle-record-violating-stub.md` (RED, fake id
   `M88-fake-lifecycle-violating`, asserted exit 1 — well-formed `## Proposal` but a `## Plan`
   referencing `docs/plans/M88-this-path-does-not-exist-anywhere-in-the-repo.md`, which does not
   resolve). Both wired into `experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh`'s
   `CASES` array.

   Running the new fixtures alone against the enforcer, isolating Clause 8's own output:
   ```
   === GREEN ===
   PASS: clause8-task-lifecycle-record: '## Proposal' has real content (540 chars); '## Plan' N/A-with-reasoning [fixture text — no real task file]
   PASS: DoD check passed — all clauses satisfied (9 disposition(s) confirmed), no undeclared self-exemption.
   EXIT: 0

   === RED ===
   FAIL: clause8-task-lifecycle-record: '## Plan' references docs/plans path(s) that do NOT resolve on disk: docs/plans/M88-this-path-does-not-exist-anywhere-in-the-repo.md [fixture text — no real task file]
   FAIL: DoD check failed — 3 clause violation(s) found (see above).
   EXIT: 1
   ```
   (The RED fixture is a deliberate double/triple violation — like the pre-existing `violating-stub.md`
   precedent — clause0 and clause4 also legitimately fire on it, robust to any single clause's exact
   wording changing later; Clause 8's own FAIL line is present and names the exact offending path,
   which is what the AC actually requires.)

   **Backward-compatibility fix required and applied:** the first full selfcheck run surfaced that 4
   pre-existing GREEN fixtures (`compliant-stub.md`, `escrow-deltav-compliant-stub.md`,
   `test-floor-compliant-stub.md`, `checklist-all-checked-compliant-stub.md`) had no `## Proposal`/
   `## Plan` sections and started FAILing Clause 8 (regression). I added a minimal, honest
   `## Proposal`/`## Plan` pair to each of those 4 fixtures (not touching their own already-asserted
   clause content) so they stay GREEN. This is a fixture-file update, not a retroactive real-task
   backfill — DIR-014's own "forward-only, no retroactive sweep" language is about real ≤M39
   milestone tasks, not synthetic testing fixtures, and I documented this reasoning in
   `inherited-core.md`'s Clause 8 section (see below) rather than silently making the edit.

   **Full fixture-suite run (real output, 15 fixtures, all pass):**
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
   PASS: M89-fake-lifecycle-compliant — exit 0 (expected 0) [fixtures/dod/task-lifecycle-record-compliant-stub.md]
   PASS: M88-fake-lifecycle-violating — exit 1 (expected 1) [fixtures/dod/task-lifecycle-record-violating-stub.md]

   PASS: all 15 DoD fixtures behaved as asserted.
   ```

4. **AC item 4 (`inherited-core.md` documentation):** added a new `### Clause 8 —
   Task-canonical-lifecycle-record gate (DIR-014 item 6 / M40-dir014-task-canonical-lifecycle-record,
   2026-07-19)` subsection immediately after Clause 0's own documentation (before Clause 1), following
   the same four-field template (Trigger condition / What it checks / Pass/fail semantics / Current
   invocation point) every other clause uses, plus a fifth "Regression fixtures" field naming the 2
   new fixtures and documenting the 4-fixture backward-compat fix above. Cross-references "DIR-014
   item 6" by name in the section heading and body. Also updated: the "Definition of Done" section's
   intro paragraph (now names M40/DIR-014 item 6 alongside M25/M32), the "Mechanical enforcement"
   paragraph's clause count (eight→nine), and the "`scripts/it0-dod-check.{sh,mjs}` — the standing
   mechanical check" closing section's clause range (0-7→0-8) and Source paragraph (added a DIR-014
   sourcing sentence). I deliberately did **not** touch the two-class diversity policy's dev-class
   discretionary language (confirmed via `git diff` that lines 312-380, the two-class-diversity
   subsections, are untouched).

5. **AC item 5 (self-referential ABSORB-gate proof):** ran the check both directly and via `quay
   gate` against this milestone's own task, using a hand-authored `/tmp/m40-absorb-entry.md`
   ABSORB-entry stub (not a real ABSORB — this milestone hasn't reached ABSORB yet; the stub exists
   purely to exercise the check, per the task's own `extra.acceptance` field which already points at
   this exact file path).

## Self-referential DoD-check proof (AC item 5, real output)

**Direct invocation** (`it0-dod-check.sh`, since the new clause is engine-wired into the same script
`quay gate` calls — stating explicitly, per the AC's "state which": the clause is engine-wired via
`it0-dod-check.mjs`, invoked identically by both the raw script and by `quay gate`'s task
`extra.acceptance` field):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md /tmp/m40-absorb-entry.md
--- it0-dod-check: exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD ---
charter: experiments/quay-perpetual-stream/charters/M40-dir014-task-canonical-lifecycle-record.md
absorb-entry: /tmp/m40-absorb-entry.md

PASS: clause1-adversarial-audit: disposition statement present (documented no-op)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — ... scope within the small-milestone norm ...
PASS: clause4-impl-row: PASS — ... not design-only per its backlog row text ... impl-row gate does not apply.
PASS: clause5-no-self-exemption: no undeclared self-exemption language found ...
PASS: clause6-escrow-delta-v: N/A — milestone is not design-only (rule does not apply)
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching ...
PASS: clause8-task-lifecycle-record: '## Proposal' has real content (4390 chars); '## Plan' N/A-with-reasoning [tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]
FAIL: clause0-ac-dod-present: checklist-form AC has 5 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does): [... 5 unchecked AC boxes named ...] [tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md]

FAIL: DoD check failed — 1 clause violation(s) found (see above).
```
Exit code: 1.

**Via `quay gate`** (confirms the engine-wired invocation, same underlying command, from the task's
own `extra.acceptance` field):
```
$ npx quay gate exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD
quay-native mcp: serving tasks from .../tasks
FAIL — acceptance failed (exit 1)
```
Exit code: 1 — matches the direct invocation's exit code.

**Reading of this result, per the charter's own AC 5 instruction:** Clause 8 specifically
**PASSes**, citing real evidence: it read `tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md`
(not a fixture fallback — the real task file was found and used), confirmed the `## Proposal`
section has 4390 characters of real content, and confirmed the `## Plan` section matches the
`N/A-with-reasoning` accepted form. This is the genuine self-referential proof the AC asks for: the
clause is live, wired, reads the right file, and passes for the right, cited reason.

Clause 0 legitimately FAILs (5 AC checkboxes remain unchecked, as they should — the per-milestone
acceptance audit is an out-of-band step that has not yet run for this in-progress iteration, and per
`inherited-core.md`'s Clause 1 documentation only the audit is permitted to tick boxes). This is
exactly the "other clauses may legitimately FAIL/be-pending" case the assignment prompt calls out —
it does not indicate a defect in Clause 8's own implementation. (In one earlier run, before I
corrected an absolute-vs-relative-path mistake in my own terminal session, Clause 1 also showed FAIL
for the same reason — both are expected pre-audit states, not clause-8-related.)

## Deviations from the charter's suggested design

1. **`it0-dod-check.sh` left unmodified** (see item 2 above) — the charter/task's own text says "add
   ... to BOTH `it0-dod-check.sh` ... and `it0-dod-check.mjs`", which reads as a literal file-count
   instruction. I judged, and verified via `git log`, that the `.sh` file has zero clause-specific
   code in it for ANY of the 8 pre-existing clauses either — it is a pure delegate. Editing it to add
   clause-8-specific text would be introducing the very "parallel implementation" the charter warns
   against reusing `extractSection()` to avoid. I consider this the correct reading of the intent
   (both *scripts* enforce clause 8, because the `.sh` always calls the `.mjs`), not a shortcut, but
   flagging it explicitly since it's a literal deviation from the "add to both files" phrasing.
2. **Backward-compat fix to 4 pre-existing GREEN fixtures** (see item 3 above) — not explicitly
   anticipated by the charter, but necessary: without it, `dod-fixture-selfcheck.sh` would have
   regressed (4 previously-GREEN fixtures newly FAILing), which the charter explicitly requires to
   stay green ("the fixture suite stays green (all fixtures behave as asserted, including the 2 new
   ones)" — "including" implies the others too). Documented the reasoning inline in
   `inherited-core.md` rather than silently patching.
3. **Clause 8 numbering** — added as clause **8** (next free slot after clause 7), matching the
   task's own `## Proposal` text ("call it Clause 8, next free slot after Clause 7"), not inserted
   between existing clauses, to avoid renumbering any existing citation.
4. **No `docs/plans/*.md` file authored for this milestone itself** — per the task's own explicit
   "Rejected alternative" paragraph, which I agreed with: manufacturing a plan doc purely to exercise
   the "resolves" branch would be Goodharting the test; the fixture pair (item 3 above) exercises both
   branches in isolation instead, and this task's own real `## Plan` legitimately uses the `N/A`
   branch.

## Self-assessment against the 5 Acceptance Criteria

- **item 6a (proposal embedded):** MET. The task's `## Proposal` section (pre-existing, verified not
  authored by me) is 4390 characters of real, specific approach text with a named rejected
  alternative — not boilerplate. Confirmed both by manual reading and by Clause 8's own PASS output
  citing the real character count against the real task file.
- **item 6b (plan referenced):** MET. The task's `## Plan` section states `N/A — this is a small,
  single-pass mechanical change ...` with concrete reasoning (cites the exact scope: one DoD clause,
  2 fixtures, one doc subsection) — matches the `N/A-with-reasoning` accepted form exactly, confirmed
  by Clause 8's PASS output.
- **item 6c (enforcement is real, not prose):** MET. Clause 8 is implemented in
  `it0-dod-check.mjs`, reuses `extractSection()` (not a parallel implementation), HARD-BLOCKs on all
  3 specified conditions (verified live: the non-resolving-path branch — the genuinely NEW piece of
  logic clause 8 introduces beyond clause 0's own pattern — is the RED fixture's specific target and
  is confirmed firing; missing-Proposal/missing-Plan failure shape mirrors clause 0's pre-existing
  fixture coverage and was also unit-verified against the 4 patched pre-existing fixtures losing/
  regaining their `## Proposal`/`## Plan` sections during the backward-compat fix). 2 new fixtures
  added and wired; full 15-fixture suite green (real command output pasted above).
- **`inherited-core.md` documents the new clause:** MET. New `### Clause 8` subsection immediately
  after Clause 0, four-field template, cross-references "DIR-014 item 6" by name twice (heading +
  body). Two-class diversity policy's dev-class language (lines ~312-380) untouched — verified via
  diff review.
- **Self-referential ABSORB-gate proof:** MET. Both direct `it0-dod-check.sh` and `quay gate`
  invocations against this milestone's own real task genuinely evaluate Clause 8 (confirmed reading
  the real `tasks/exp5-M-DIR014-TASK-CANONICAL-LIFECYCLE-RECORD.md` file, not a fallback) and it
  PASSes for the correct, cited reason. Overall exit code is 1 this run because Clause 0/1
  legitimately fail pre-audit (expected, per the assignment's own note) — not because Clause 8 failed
  or was skipped.

## Honest limitations / things I'd flag for the reconciliation step

- I did not attempt to independently verify DIR-014's own text beyond what the charter/task already
  cite (did not re-read `directives/pending/DIR-014-*.md` in full) — relied on the charter's own
  "Current-state notes" section as the source of truth for DIR-014's requirements, per the
  instruction to work from the charter and task file only.
- The `## Plan`-path-resolution regex (`docs\/plans\/[A-Za-z0-9._\-\/]+\.md`) requires ALL matched
  paths in the `## Plan` section to resolve for a PASS (if a plan text mentions multiple paths, one
  broken reference fails the whole clause) — this is a stricter reading than "at least one resolves";
  I believe it's the more defensible interpretation (a broken reference in the canonical record is a
  drift risk regardless of how many good references sit alongside it), but flagging the design choice
  explicitly in case iteration-0 diverged here.
- I did not add a `missing-Proposal`-specific or `missing-Plan`-specific fixture beyond the
  path-resolution RED case, reasoning that Clause 0's own pre-existing `missing-ac-stub.md` fixture
  family already demonstrates the "task file entirely malformed" shape and the charter's AC only
  requires "a new RED/GREEN fixture pair" (singular pair), not one pair per failure branch. If the
  reconciliation step wants per-branch fixture coverage, that would be a natural follow-up, not a gap
  in what was asked.
