---
id: gap-prepare-milestone-convergence-test-fixture-pollutes-tracked-tree
title: prepare-milestone-convergence.test.mjs writes fixture Plan/receipt files
  into docs/plans/ and milestones/ (shared production namespace) with cleanup
  only on graceful completion — 322 orphans found in the tracked tree
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Proposal

Harden `plugin/test/prepare-milestone-convergence.test.mjs`'s own cleanup discipline with a
suite-level `after()` sweep (defense-in-depth against interrupted individual test cases), and add
a standalone `experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.sh` (or similar)
that can be run manually/periodically to clear any `M9[0-9]{5}`-shaped orphans left on local disk
from prior interrupted runs, now that `.gitignore` (commit `9f35c85`) keeps them out of the
tracked tree.

## Finding

`prepare-milestone-convergence.test.mjs` drives the REAL, unmodified `prepare-milestone.js`
source (`loadWorkflow()` loads it as a live `AsyncFunction`) to get real workflow-integration
coverage — this is deliberate and correct (see the file's own header comment). Because it drives
the real workflow, the Plan-file and receipt paths it writes to are NOT test-controlled — they
are derived from the SAME production path formula under test: `docs/plans/${milestoneId}-
${slug}.md` (workflow line ~882) and `milestones/${milestoneId}/preparation.json`. The test can
only influence WHERE these land by choosing `milestoneId`, which it does via `M${Math.floor
(900000 + Math.random() * 90000)}` (line 352) specifically to avoid colliding with real milestone
IDs — but the files still land directly in `docs/plans/` and `milestones/`, the same tracked
directories real milestone artifacts live in, not inside the test's own `fixtures/preparation/`
scratch tree (which IS properly isolated and leaves zero residue, confirmed via `git status`).

Each test wraps its scratch state in `try { ... } finally { cleanup(scratchDir, planFile,
milestoneId) }` (`cleanup()` at line 380: `fs.rmSync` on the scratch dir, the Plan file, and
`milestones/<id>/`). This works when a test completes (pass or fail) normally. It does NOT run
when the whole Node process is killed before the `finally` block executes — which happened
repeatedly during 2026-07-31 prepare-milestone debugging (circular-JSON crash in `--decide-
split`, `MODULE_TYPELESS_PACKAGE_JSON`-poisoned agent stdout causing `admission-check-failed`
crashes, workflows forcibly stopped mid-run). A `git status` audit on 2026-07-31 found 262
orphaned `docs/plans/M9xxxxx--...task.md` files and 60 orphaned `milestones/M9xxxxx/`
directories — pure accumulated debris from interrupted test runs, none referencing anything real,
all cleared by hand (commit `9f35c85`).

`tree-hygiene-check.sh` (the repo's own DIR-031 scratch-detection gate) does NOT catch this class
at all — its `scratch` regex only matches known backup-file suffixes (`.bak`/`.tmp`/`.swp`/`~`
etc.), and its separate `evidence_untracked` WARN-only regex only matches `charters/M[0-9]+-...md`
and `milestones/M[0-9]+/(audits|iterations)/...md` (a different allowlist for a different
purpose — flagging real un-landed ABSORB evidence, not screening test scratch). Neither pattern
matches `docs/plans/M9xxxxx--*.md` or bare `milestones/M9xxxxx/`. This class was invisible to
existing tooling until manually audited.

**Why relocating the fixture write path isn't the fix**: the test's entire value proposition is
exercising the REAL path-construction logic inside `prepare-milestone.js` unmodified. Redirecting
`docs/plans/`/`milestones/` writes to an isolated scratch subtree would require either (a)
patching the production workflow source before loading it (defeats "drives the REAL unmodified
workflow" testing philosophy), or (b) intercepting the mock `agent()`'s file-write side effect and
silently redirecting it to a different path than the one the real workflow computed and reported
(masks the very path-construction behavior under test). Neither is a clean fix. The `.gitignore`
addition (commit `9f35c85`, pattern `docs/plans/M9[0-9][0-9][0-9][0-9][0-9]-*.md` /
`milestones/M9[0-9][0-9][0-9][0-9][0-9]/`) is the correct primary fix — it cannot collide with a
real milestone ID (six digits starting at 900000; real milestone IDs are nowhere near that), and
it keeps interrupted-run debris out of `git status` regardless of process-kill timing. What
remains open is bounding LOCAL DISK accumulation (now git-invisible, but still real files
consuming space and inode count indefinitely) and closing the `tree-hygiene-check.sh` blind spot
for defense-in-depth.

## Requested action

1. Add a `node:test` suite-level `after(() => { ... })` hook to `prepare-milestone-convergence.
   test.mjs` (both this file, if mirrored, and its `plugin/test/` location) that globs
   `docs/plans/M9[0-9][0-9][0-9][0-9][0-9]-*.md` and `milestones/M9[0-9][0-9][0-9][0-9][0-9]/`
   and removes any found — catches orphans from a prior interrupted run of THIS SAME test file
   (not from other tests), reducing local-disk accumulation across repeated ad-hoc runs during
   active debugging. This does not fully solve mid-suite `SIGKILL` (a suite-level hook cannot run
   if the whole process is killed), but narrows the window significantly.
2. Add a standalone, manually-invocable sweep script (or a `--sweep-orphans` mode on an existing
   script) that removes any `docs/plans/M9xxxxx-*.md` / `milestones/M9xxxxx/` found in the
   working tree, for periodic manual/loop-driven hygiene independent of any single test run.
3. Extend `tree-hygiene-check.sh`'s scratch-detection regex to also flag this shape (belt-and-
   suspenders visibility even though `.gitignore` already prevents it from surfacing in `git
   status --porcelain`'s `??` output — note: since these paths are now gitignored, `git status
   --porcelain` will no longer list them at all, so this specific mechanism may need `git status
   --porcelain --ignored` or an equivalent explicit local-disk scan rather than relying on the
   existing untracked-file detection path).
4. Do not attempt to relocate the Plan/receipt write path itself (see Finding's explanation of why
   this compromises test fidelity) — this is an explicit non-goal.

## Acceptance Criteria

- [ ] A real interrupted-run reproduction (kill the test process mid-run, e.g. via a deliberately
  throwing mock `agent()` combined with a suite-level hook bypass, or a fixture harness) confirms
  the after-hook sweep removes orphans from a PRIOR run on the NEXT invocation of this test file.
- [ ] The standalone sweep script/mode removes real `M9xxxxx`-shaped orphans and leaves everything
  else (real `M2xx` milestones, non-matching files) untouched — proven via a fixture with both
  orphan and non-orphan paths present.
- [ ] `tree-hygiene-check.sh` (or its replacement mechanism) flags a manually-planted `M9xxxxx`
  orphan even though it is gitignored — real command output, not asserted.
- [ ] Existing `prepare-milestone-convergence.test.mjs` assertions and cleanup behavior are
  unchanged for the normal (non-interrupted) path.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`, verified via real test/script output, not asserted.
- [ ] A fresh audit confirms no change to the production `prepare-milestone.js` path-construction
  logic (this task is test/hygiene-tooling only).

## Human verification when exp5 marks this task done

1. Does re-running the convergence test suite after a simulated kill leave fewer/zero orphans on
   the next run?
2. Can the manual sweep script be safely run against a real, non-test working tree without
   deleting anything real?
3. Does `tree-hygiene-check.sh` (or equivalent) now surface this class if it recurs?

## Touches

- plugin/test/prepare-milestone-convergence.test.mjs
- experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
- experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.sh (or equivalent new script)
- experiments/quay-perpetual-stream/test/tree-hygiene-check.test.mjs (if it exists, or sibling path)
