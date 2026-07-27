# M180 iteration-1 — gap-absorb-entry-clause-disposition-sequencing

**Task:** gap-absorb-entry-clause-disposition-sequencing
**Charter:** experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md
**Class:** development (execution / instrument-correction)
**Prior iteration:** `milestones/M180/iterations/iteration-0.md` (landed as commit `c201b4c`), then
audited: `milestones/M180/audits/iteration-0-acceptance-audit.md` (verdict **REFUTED** —
`3b90ef5`).

## Why this iteration exists

The iteration-0 acceptance audit confirmed AC1 (the disposition-append instructions really were
added to both `execute-milestone.js` mirrors, and really do match `it0-dod-check.ts`'s clause1/
clause2 regexes) and AC3 (byte-identical mirrors), but **REFUTED AC2** ("a real, unmodified-by-hand
absorb-entry file actually passes clause1/2/7") and the DoD's "verified via a real dispatch, not
asserted" clause. The only verification iteration-0 performed was: hand-append the two disposition
lines to `/tmp/m180-absorb-entry.md`, re-run `it0-dod-check.sh`, observe clause1/2/7 flip to PASS,
then **explicitly revert the file**. The audit correctly called this "the opposite of without any
manual post-hoc edit" — it proves the regex wiring is correct exactly once, by hand, and leaves zero
durable evidence: a live re-run against the (reverted) real file still FAILs clause1/clause2 today.

## What this iteration does — and, honestly, what it does NOT do

**Tool-access constraint, stated up front:** this Build-phase subagent has no `Workflow` tool
available (checked: not in the deferred-tool listing for this session). A literal, live,
LLM-agent-driven `execute-milestone.js` orchestrated dispatch (Verify → Build → Audit → Gate →
Land, with the Audit phase's own step 2a actually firing in a fresh-context agent turn) is
therefore **not something this iteration can produce**. AC2's literal wording ("A real
(non-fixture) milestone dispatch...") is not closed by this iteration — that step genuinely
requires a live orchestrated run, driven by whatever system dispatches `execute-milestone.js` for
real, which is outside this subagent's own tool surface. Pretending otherwise (e.g. hand-writing
the disposition lines into `/tmp/m180-absorb-entry.md` myself, in this same Build turn, and calling
that "the Audit phase ran") would exactly repeat iteration-0's mistake — role-blending a Build-phase
agent into fabricating "fresh-context audit" output it structurally cannot produce (the Audit phase
is defined to be a FRESH, unseen-the-build context; this session has seen the build). I did not do
that. `/tmp/m180-absorb-entry.md` is left completely untouched by this iteration — no disposition
lines added, none reverted. Deciding what that file should be augmented with is correctly the real
Audit phase's job (step 2a), not this Build phase's.

**PRE-FLIGHT check (per this Build phase's own instruction 1):** `extra.acceptance` on the task was
already set to the exact required command (confirmed via `task_get` — unchanged from iteration-0,
no write needed).

**Backlog-row surface tag (instruction 1a):** `/tmp/m180-absorb-entry.md`'s `## Backlog row` line
already carries `surface:method-infra`, an accurate label for this milestone (its `## Touches` list
is exactly `.claude/workflows/execute-milestone.js` + `plugin/workflows/execute-milestone.js`, both
method-infra, no `packages/quay*` product code). Left as-is, no change needed.

**What IS new, real work in this iteration:** the code fix from iteration-0 (Audit-phase step 2a,
Build-phase step 1a) is genuinely correct and already landed — what was missing was any *durable*
evidence of that correctness beyond a single, since-reverted, manual test run. This iteration adds
a permanent, CI-enforced regression test:

`plugin/test/execute-milestone-disposition-conformance.test.mjs` (new file, 16 tests, all passing)

It imports the REAL exported `runDodCheck()` from `experiments/quay-perpetual-stream/scripts/
it0-dod-check.ts` and the REAL exported `checkLedger()` from `experiments/quay-perpetual-stream/
scripts/vmeta-lag-check.ts` — never reimplements either (per the charter's explicit
out-of-scope clause) — and proves, mechanically and repeatably on every `scripts/test.sh` run:

1. **Drift guard**: the literal phrase templates `adversarial-audit disposition: <VERDICT>` and
   `V_meta consolidation-lag: <verbatim` are still present verbatim in both workflow mirrors, AND
   the `DISPOSITION APPEND` (step 2a) instruction still precedes the `MECHANICAL GATE` (step 3)
   invocation in prompt-text order — structurally locking in the exact sequencing fix the charter's
   Finding section identified (a regression that reordered the steps would fail this test even
   though no regex changed).
2. **clause1 positive**: the literal template `adversarial-audit disposition: <verdict>`, for each
   of the 3 real verdicts the Audit phase can return (`NO REFUTATION FOUND`/`CONCERNS`/`REFUTED`),
   satisfies the real `it0-dod-check.ts` clause1 regex.
3. **clause2 positive**: the literal template populated with a REAL `checkLedger()` result — both a
   genuine PASS-shaped call and a genuine FAIL/ALARM-shaped call (a synthetic ledger with a
   confirmed, non-consolidated, no-carry-forward row) — satisfies the real clause2 regex. This
   directly exercises the Audit-phase instruction's own caveat ("copy the script's actual reason
   text; do not paraphrase or invent a 'clear' result").
4. **clause2 negative control**: an arbitrary non-conforming line does NOT pass — the test is not
   tautological.
5. **clause7**: the Build-phase step 1a `surface:` vocabulary resolves exactly as claimed — all 4
   non-product labels (`method-infra`/`docs`/`cross-cutting`/`packaging`) N/A-pass with no coverage/
   WAIVER text; a product-touching label (`cli`) and the no-token case both still fail closed.
6. **Baseline control**: absorb text with NEITHER disposition line still FAILs clause1 AND clause2
   — proves the fix is necessary, not just sufficient (the pre-fix bug is still real and would still
   be caught if the fix were reverted).
7. **End-to-end**: all three literal templates together, in one absorb-entry text, produce
   simultaneous clause1+clause2+clause7 PASS — the actual shape a real Audit-phase run should leave
   behind.

This converts iteration-0's one-off, already-reverted manual proof into something that (a) runs on
every future CI invocation via `scripts/test.sh`'s canonical glob (`plugin/test/*.test.mjs`), (b)
cannot be silently "reverted away" the way a hand-edited scratch file can, and (c) would catch a
future wording regression in either workflow mirror before it ever reached a real dispatch. It
closes the **wiring-correctness** half of AC2/DoD1's concern durably. It does **not** close the
**live-dispatch** half — that remains an open item for whoever next runs `execute-milestone.js` for
real against this or any milestone (which, per the already-landed fix, should now produce
clause1/2/7 PASS without any manual intervention — a claim this test suite backs mechanically, but
has not yet been observed on a live agent-driven run end-to-end).

## Verification

- `node --check` on both workflow mirrors: unchanged from iteration-0, still pass (no edits made to
  either file this iteration).
- New test file: `node --test plugin/test/execute-milestone-disposition-conformance.test.mjs` — 16/16
  pass.
- Full canonical suite: `scripts/test.sh` (background, DIR-090 timeout discipline, ~297s) —
  **537 tests, 533 pass, 1 fail, 3 skipped** (the 3 documented LIVE-GitHub tests, correctly skipping
  without `GH_TOKEN`/`QUAY_TEST_LIVE_GITHUB=1`). The 1 failure is
  `plugin-packaging.test.mjs`'s pre-existing `task-schema.ts` bundled-copy drift — the SAME failure
  iteration-0 disclosed and confirmed pre-existing via `git stash`. Independently re-confirmed here:
  `git stash push -u -- plugin/test/execute-milestone-disposition-conformance.test.mjs
  milestones/M180/iterations/iteration-1.md && node --test plugin/test/plugin-packaging.test.mjs`
  reproduces the identical failure with none of this iteration's files present, then `git stash pop`
  restored them — confirming this iteration neither causes nor masks it.
- `/tmp/m180-absorb-entry.md` was read but never written by this iteration (verified: no diff/mtime
  change) — the real Audit-phase disposition-append still has not happened for real on this file;
  a live re-run of the task's own `extra.acceptance` command against it right now would still show
  clause1/clause2 FAIL, unchanged from the iteration-0-audit's own finding. This is disclosed
  honestly rather than worked around.

## Files changed

- `plugin/test/execute-milestone-disposition-conformance.test.mjs` (new)
- `milestones/M180/iterations/iteration-1.md` (this file)

No changes to `.claude/workflows/execute-milestone.js`, `plugin/workflows/execute-milestone.js`,
`it0-dod-check.ts`, or `vmeta-lag-check.ts` — all already correct from iteration-0 and left
untouched per the charter's out-of-scope clause.

## Remaining gap (disclosed, not closed)

AC2 / DoD1's literal "real (non-fixture) milestone dispatch ... without any manual post-hoc edit"
still requires an actual live orchestrated `execute-milestone.js` run — Audit phase step 2a firing
for real, in a fresh-context agent turn, on a real milestone's `absorbEntryFile`. That is a
live-dispatch event this Build-phase subagent's tool surface cannot produce (no `Workflow` tool
available). The task's AC2/DoD1 checkboxes are intentionally left unticked by this iteration; a
future Audit or Land phase with real dispatch evidence (or a human confirming a live run) should
close them, not another manual self-test.
