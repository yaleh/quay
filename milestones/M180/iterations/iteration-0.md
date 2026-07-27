# M180 iteration-0 — gap-absorb-entry-clause-disposition-sequencing

**Task:** gap-absorb-entry-clause-disposition-sequencing
**Charter:** experiments/quay-perpetual-stream/charters/M180-gap-absorb-disposition-sequencing.md
**Class:** development (execution / instrument-correction)

## What was done

Root cause (confirmed by the task's own finding, an independent second audit): `it0-dod-check.ts`
clause1 (adversarial-audit disposition), clause2 (V_meta consolidation-lag disposition), and
clause7 (test-floor / `surface:` tag) grep the ABSORB-entry file's TEXT for disposition language
that no phase of `.claude/workflows/execute-milestone.js` ever wrote into that file before the
mechanical gate (`it0-dod-check.sh`) ran. This is a pipeline-sequencing gap, not a filesystem-
visibility bug (the earlier `/tmp`-sandbox-isolation theory was already refuted by a prior audit).

### Edits (both `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js`,
kept byte-identical)

1. **Build phase pre-flight — new step 1a** (clause7 fix): immediately after the existing
   `extra.acceptance` pre-flight step, instructs the build agent to check the absorb-entry file's
   `## Backlog row` pipe-line for a `surface:<label>` token and add an accurate one (drawn from the
   milestone's real `## Touches` list) if missing. `it0-dod-check.ts`'s clause7 (~line 506-533)
   fails closed (treats the milestone as product-touching) only when NO `surface:` token is present
   at all; when the only present tokens are exactly `method-infra`/`docs`/`cross-cutting`/`packaging`
   it auto-resolves N/A-PASS with no coverage figure needed. This is the cheapest of the three
   fixes — most ABSORB-entry stubs (per the M138-M180 pattern) already carry a `surface:` tag once
   authored correctly; this step is a fail-safe backstop, not a rewrite of the authoring convention.

2. **Audit phase — new step 2a**, positioned between step 2 (DoD satisfaction) and step 3 (the
   mechanical gate invocation) (clause1 + clause2 fix): instructs the audit agent, BEFORE invoking
   `it0-dod-check.sh`, to append two real disposition lines into `$a.absorbEntryFile`:
   - `adversarial-audit disposition: <VERDICT>` — using the verdict it just determined in step 1
     (never fabricated, never written before the verdict exists).
   - Run the SAME `vmeta-lag-check.sh --counter <milestone_counter-1> v-meta-ledger.md` invocation
     the later Gate phase runs (cheap, read-only, safe to duplicate), then append
     `V_meta consolidation-lag: <verbatim reason text from that command's own output>`.

   This makes the disposition-writing step run in the SAME agent turn that computes the verdict
   (resolving the structural circularity the task's Finding section identified: the Audit phase's
   own gate-check step was invoking `it0-dod-check.sh` in the same turn that produces the verdict,
   before that verdict could ever be written back into the file the gate reads).

3. `plugin/workflows/execute-milestone.js` mirrored via direct copy from `.claude/workflows/` —
   confirmed byte-identical with `diff`.

## Verification

- `node --check` passes on both files (no syntax regression).
- `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh` — all 17 pre-existing
  DoD fixtures still behave as asserted (no regression to `it0-dod-check.ts` itself — untouched, as
  required by the charter's Out-of-scope clause).
- **Mechanism self-test** (real, non-fabricated, using the actual scripts — done because this very
  milestone is the one under test, and a full live `execute-milestone.js` re-dispatch of an
  already-in-flight run cannot pick up a script edit made mid-run — see CLAUDE.md's documented
  workflow-script-staleness anti-pattern):
  1. Ran `it0-dod-check.sh gap-absorb-entry-clause-disposition-sequencing <charter>
     /tmp/m180-absorb-entry.md` BEFORE any disposition text was added: clause1 and clause2 FAIL
     ("NO disposition statement found"); clause7 already PASSes N/A (the orchestrator's stub already
     carried `surface:method-infra`).
  2. Ran the real `vmeta-lag-check.sh --counter 179 experiments/quay-perpetual-stream/v-meta-ledger.md`
     — got a real PASS with reason `no confirmed-unconsolidated row past K without a dated
     carry-forward`.
  3. Appended, to a scratch copy, exactly the two disposition lines step 2a instructs (`adversarial-
     audit disposition: NO REFUTATION FOUND` and `V_meta consolidation-lag: <the real
     vmeta-lag-check.sh output above>`).
  4. Re-ran `it0-dod-check.sh` against the modified file: **clause1, clause2, clause7 all PASS**.
     Only clause0 (task's own unchecked AC boxes / DoD standard-reference — both outside this
     milestone's `## Touches` scope, and clause0's AC-ticking is the Audit phase's job per DIR-020,
     not the Build phase's) still fails, confirming the fix targets exactly clause1/2/7 and nothing
     else.
  5. Restored `/tmp/m180-absorb-entry.md` to its original pre-test content (the file this
     milestone's own real Audit/Gate/Land phases will use) — no permanent pollution from the
     self-test.
- Broader regression check: `node --test plugin/test/plugin-packaging.test.mjs` — 1 pre-existing
  failure (`task-schema.ts` bundled-copy drift, unrelated to `execute-milestone.js`), confirmed via
  `git stash` to exist identically on `master` before this change — not caused by this milestone.
- Full canonical `scripts/test.sh` run (background, ~356s, DIR-090 timeout discipline): **521 tests,
  517 pass, 1 fail, 3 skipped** (the 3 skipped are the documented LIVE-GitHub tests, correctly
  skipping without `GH_TOKEN`/`QUAY_TEST_LIVE_GITHUB=1`). The 1 failure is the SAME pre-existing
  `plugin-packaging.test.mjs` `task-schema.ts` drift noted above — confirmed pre-existing via
  `git stash`, not introduced by this change.

## Scope discipline

Per the charter's explicit Out-of-scope clause, `it0-dod-check.ts` itself was NOT modified — its
clause logic is correct and well-documented; this fix is entirely on the CALLER side (the workflow
script) supplying the disposition text the checker already knows how to recognize. The Gate phase's
own `vmeta-lag` (and other) mechanical checks are also untouched.

## Files changed

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `milestones/M180/iterations/iteration-0.md` (this file)
