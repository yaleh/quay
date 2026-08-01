# M212 / DIR-119-D4 — Build iteration-0 report

**Milestone:** M212 · **Task:** DIR-119-D4 — literal Reconcile phase as sole composite state
writer + Gate-failure attribution fix (composite-reconcile.ts)
**Iteration:** 0 · **Class:** development · **Value type:** capabilityGrowth
**Date:** 2026-08-01
**Build branch:** `milestone/M212/iteration-0` (DIR-123 worktree isolation)
**Build base:** `27428dc6`

## Pre-flight

- **extra.acceptance set** on `tasks/DIR-119-D4.md` via `task_write`:
  `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-119-D4
  experiments/quay-perpetual-stream/charters/M212-dir119d4-reconcile-gate-attribution.md
  milestones/M212/absorb-entry.md`
- **Backlog-row surface tag (M180 clause7):** `milestones/M212/absorb-entry.md`'s `## Backlog row`
  already carries `surface:method-infra`, which accurately matches this milestone's `## Touches`
  (workflow scripts, composite-reconcile.ts mirrors, their tests, the plan doc — all method-infra;
  no `packages/quay*` product code). Left as-is. (Note: `absorb-entry.md` is an untracked
  Land-phase artifact living in the primary checkout, not in the worktree — its disposition
  sections are completed at Audit/Land per the file's own header.)

## What was implemented

Nine mechanical stages from `docs/plans/M212-dir-119-d4.md` (Stages 1–7 in Build; Stages 8–9 are
Land/Audit phase). All changes made in the worktree on `milestone/M212/iteration-0`.

### Stage 1 — RED tests (experiments mirror)
Added 10 tests to `experiments/quay-perpetual-stream/test/composite-reconcile.test.mjs`:
`attributeGateFailures` partition cases (failing NON-primary member named, all-passing control,
primary-only-if-self-failed, milestone-failures-separate, structural-taskId-not-label,
deterministic-membership) and CLI-mode subprocess tests (`--attribute-gates-json`,
`--reconcile-json` pass/fail-closed). New tests resolve `attributeGateFailures` via the module
namespace (dynamic import) so RED only breaks the new assertions while the pre-existing static
`reconcile()`/`selftest()` tests stay green (the plan's pinned RED strategy — no static import of a
not-yet-existing export).

**RED evidence:** `node --test experiments/quay-perpetual-stream/test/composite-reconcile.test.mjs`
→ exit 1; 11 pre-existing tests PASS, 10 new tests FAIL (`/tmp/cr-test-red.log`).

### Stage 2 — implement `attributeGateFailures` + CLI modes (canonical script)
`experiments/quay-perpetual-stream/scripts/composite-reconcile.ts`:
- New exported `attributeGateFailures(gates, taskIds)` → `{failedTaskIds, passingTaskIds,
  milestoneFailures}`. Identity is the structural `taskId` field (never the
  `split-or-commit-${tid}` label); membership order is deterministic (follows `taskIds`); unknown
  ids excluded; milestone-scoped failures reported separately; `_primaryTaskId` marked only if
  itself failed.
- Non-selftest CLI modes: `--attribute-gates-json` (wraps `attributeGateFailures`) and
  `--reconcile-json` (wraps the already-exported `reconcile()`). Input JSON via `--in <file>` (the
  production interface) or inline JSON arg; result JSON on stdout; `--reconcile-json` exits nonzero
  fail-closed on contract violation while still emitting the deterministic recovery record.
- Embedded selftest extended with 5 attribution cases.

**GREEN evidence:** `node --experimental-strip-types .../composite-reconcile.ts --selftest` →
`SELFTEST: all fixture cases PASS`; `node --test .../composite-reconcile.test.mjs` → exit 0, 21
pass, 0 fail (`/tmp/cr-test-green.log`).

### Stage 3 — byte-identical script mirror
`plugin/scripts/composite-reconcile.ts` = byte copy; `diff` clean; plugin selftest PASS.

### Stage 4 — plugin mirror test (new, in canonical glob)
`plugin/test/composite-reconcile.test.mjs` = byte copy (same relative import path resolves to
`plugin/scripts/composite-reconcile.ts`). `scripts/test.sh plugin/test/composite-reconcile.test.mjs`
→ 21 pass, 0 fail.

### Stage 5 — workflow wiring (both mirrors, byte-identical)
`.claude/workflows/execute-milestone.js` + `plugin/workflows/execute-milestone.js`:
- **(a) Typed Gate closures:** task gates return `{scope:"task", taskId, gate, ok, detail}`;
  milestone gates return `{scope:"milestone", gate, ok, detail}`. The `split-or-commit-${tid}`
  label stays as observability metadata only. Width-1 (`_isComposite===false`) keeps the legacy
  untyped `{ok, detail}` shape byte-identical (golden replay).
- **(b) Gate failure branch:** for composite dispatches, an `attribute-gates` helper agent runs
  `composite-reconcile.ts --attribute-gates-json --in <typed vector file>` (the REAL
  `attributeGateFailures` — AC#3, no re-derivation, no `_primaryTaskId` hardcode) and feeds the
  returned `failedTaskIds` to the `mark-needs-human` agent; milestone-scoped failures reported
  separately. Width-1 keeps the old prompt verbatim.
- **(c) Literal Reconcile phase** inserted in `meta.phases` between Gate and Land (both mirrors).
- **(d) `reconcile-apply` agent** dispatched in the Reconcile phase ONLY for composite dispatches
  (`_isComposite && $a.compositeManifestFile`); it runs `composite-reconcile.ts --reconcile-json
  --in <ReconcileInput>` (consuming the `BundleAuditResult` shard verdicts threaded through from
  `_compositePerShardAudit`, which now returns the full `bundleAudit`), and is the ONLY agent whose
  prompt instructs success-path composite writes (AC/DoD ticks, status:done, absorb dispositions,
  dashboard rows, deviation/write-back rows), all-or-nothing with pre-image capture. Width-1 /
  manifest-less dispatches SKIP the phase (golden replay).
- **(e) Failure-path carve-out preserved:** `mark-needs-human` / `mark-needs-human-refuted` remain
  the sole needs-human lifecycle-status writers; Gate's failure branch still early-returns before
  Reconcile.
- **(f) Land-prompt sole-writer relocation:** `_compositeLandNote` rewritten validation-only (no
  "mark ALL of ... status:done", no "milestone_counter increment", no "dashboard log entry");
  serial Land steps 3/4/7 and both concurrent paths' step 3 made
  `_isComposite ? <validate-only> : <width-1 verbatim>`; `IS_CONCURRENT` hoisted above the Reconcile
  phase. Width-1 Land prompts stay byte-for-behavior identical.

### Stage 6 — mechanical wiring verification (all pass, both mirrors)
- AC#1 (real production callsites): `grep -n "reconcile-json\|attribute-gates-json"` → both modes
  present, non-selftest, in both mirrors.
- AC#2 (Reconcile phase entry): `grep -n "title: 'Reconcile'"` → both mirrors, byte-identical.
- AC#3 (typed records + attributeGateFailures as failure-branch call): `scope:"task"` /
  `scope:"milestone"` present in composite gate prompts; failure branch invokes
  `--attribute-gates-json` (the `attributeGateFailures` wrap).
- AC#5 scoped grep chain: `grep -c 'mark ALL of'` = 0; `_compositeLandNote` region free of
  `status:done|milestone_counter increment|dashboard log entry`; `reconcile-apply` present ≥ 1 —
  passes in both mirrors.

### Stage 7 — canonical suite + selftests
- `node --test experiments/quay-perpetual-stream/test/composite-reconcile.test.mjs` → 21 pass / 0 fail.
- `scripts/test.sh plugin/test/composite-reconcile.test.mjs` → 21 pass / 0 fail.
- Both `composite-reconcile.ts --selftest` → all fixture cases PASS.
- `node --experimental-strip-types --test plugin/test/execute-milestone-worktree.test.mjs` → 22 pass /
  0 fail (GOLDEN REPLAY + WORKTREE MODE, both mirrors) — width-1 legacy is byte-for-behavior
  identical (the only prompt delta remains the intentional DIR-123 Land step-1 text fix).

## Full-suite note (pre-existing failures, NOT regressions)

`scripts/test.sh` (full canonical glob, run in the worktree) → 878 tests: 872 pass, 3 fail, 3 skip.
The 3 failures are PRE-EXISTING on the base commit `27428dc6`, not introduced by this milestone:

1. `DIR-070-B: universal-gate plugin files (4 of 5) have zero exp5/experiment-path references` —
   `plugin/scripts/tree-hygiene-check.sh` leaks `experiments/quay-perpetual-stream` (2 hits).
   This file is UNCHANGED by this milestone (verified `git status --short` empty; `git show
   HEAD:plugin/scripts/tree-hygiene-check.sh | grep -c` = 2 at base).
2. `no shipped/foreign-workspace-facing file leaks ... experiments/quay-perpetual-stream ...` —
   same root cause (`tree-hygiene-check.sh`).
3. `M136 (DIR-070-A): sync-vendor.sh --check ...` — passes standalone (concurrency artifact of the
   concurrent full-suite run).

**Proof of pre-existing:** a pristine `git worktree add` at `27428dc6` runs the same
`plugin/test/plugin-packaging.test.mjs` with 4 failures (the same 2 leak tests + M136 sync-vendor
+ M172 vendored-bundle, the latter environment/build-state dependent). Fixing `tree-hygiene-check.sh`
is OUT OF SCOPE for this milestone (not in `## Touches`; touch-set discipline). Documented here for
the Audit phase; the prior milestones (M210/M211) land on the same base.

## AC → evidence mapping

| AC | Evidence |
|---|---|
| AC1 (real production callsites, both mirrors) | Stage 6 grep: `--reconcile-json` / `--attribute-gates-json` invoked from both workflow mirrors (non-selftest) |
| AC2 (Reconcile in meta.phases + journal between Audit and Land) | `title: 'Reconcile'` in `meta.phases` both mirrors; real journal entry pending Stage 8 (real composite dispatch at Land) |
| AC3 (typed Gate records; attributeGateFailures is what failure branch calls) | Stage 5(a)/(b) source; Stage 6 grep |
| AC4 (RED/GREEN attribution fixture) | Stage 1/2/3/4 tests: failing NON-primary member named (`failedTaskIds: ["T-1"]`), passing control empty — 21/21 GREEN both mirrors |
| AC5 (reconcile-apply sole success-path writer) | Stage 5(f) + Stage 6 scoped grep chain (0 "mark ALL of", 0 write-instruction phrases in `_compositeLandNote`, reconcile-apply present) |
| AC6 (git status diff-timing from a real dispatch) | Stage 8 (Land phase) — pending real composite dispatch |
| AC7 (fresh independent wiring audit, Gate-failure branch exercised) | Stage 9 (Audit phase) |
| AC8 (DIR-119-C AC#10 re-confirmed) | Stage 9 (Audit phase) |

## Files touched (all within `## Touches`)

- `.claude/workflows/execute-milestone.js` (+178 net)
- `plugin/workflows/execute-milestone.js` (byte-identical mirror)
- `experiments/quay-perpetual-stream/scripts/composite-reconcile.ts` (+139 net)
- `plugin/scripts/composite-reconcile.ts` (byte-identical mirror)
- `experiments/quay-perpetual-stream/test/composite-reconcile.test.mjs` (+183 net)
- `plugin/test/composite-reconcile.test.mjs` (NEW, byte-identical mirror)
- `docs/plans/M212-dir-119-d4.md` (plan file — referenced, not edited, per the plan's own note)

## Notes / follow-ups for Audit

- Stages 8 and 9 (real composite dispatch journal evidence, `git status` diff-timing, independent
  wiring audit exercising the Gate-failure branch, DIR-119-C AC#10 re-confirmation) are Land/Audit
  phase responsibilities and intentionally not part of this Build iteration.
- Pre-existing `plugin/scripts/tree-hygiene-check.sh` experiment-path leak breaks 2 plugin-packaging
  tests on master — recommended follow-up task (out of this milestone's touch set).
