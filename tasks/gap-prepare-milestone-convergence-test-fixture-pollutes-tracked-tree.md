---
id: gap-prepare-milestone-convergence-test-fixture-pollutes-tracked-tree
title: prepare-milestone-convergence.test.mjs writes fixture Plan/receipt files
  into docs/plans/ and milestones/ (shared production namespace) with cleanup
  only on graceful completion — 322 orphans found in the tracked tree
status: done
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

- [x] A real interrupted-run reproduction confirms the after-hook sweep removes orphans from a
  PRIOR run on the NEXT invocation of this test file. Verified both by the implementer (planted an
  `M955555` orphan before invoking `plugin/test/prepare-milestone-convergence.test.mjs`, confirmed
  gone after) and independently re-verified by a fresh adversarial reviewer subagent (same
  reproduction, plus a throwaway `node:test` file confirming `after()` fires even on assertion
  failure — only `SIGKILL` bypasses it).
- [x] The standalone sweep script/mode removes real `M9xxxxx`-shaped orphans and leaves everything
  else untouched — proven via a fixture with both orphan and non-orphan paths present.
  `experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.mjs` (`findOrphans`/
  `sweepOrphans`, `--dry-run` CLI mode). Independently re-verified live by the reviewer against a
  wider adversarial fixture set (real `M209`, `M90`-`M99`, `M91-foo.md`, 5-digit `M99999`, 7-digit
  `M9123456`) — zero over-matches. A **permanent automated regression test** for this exact
  boundary was added post-review (the reviewer noted only manual verification existed, and flagged
  that the implementer's own manual testing once accidentally `rm -rf`'d a real `M209` — caught and
  restored — as evidence this boundary deserves a standing test, not tribal knowledge):
  `experiments/quay-perpetual-stream/test/sweep-fixture-orphans.test.mjs`, 6/6 pass, covering both
  real shapes, the non-orphan near-miss cases above, dry-run non-mutation, real-sweep selectivity,
  and the `shapes` filter used by the `after()` hook.
- [x] `tree-hygiene-check.sh` flags a manually-planted `M9xxxxx` orphan even though it is
  gitignored — real command output, not asserted. Both mirrors now carry the WARN block:
  `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` (original) AND
  `plugin/scripts/tree-hygiene-check.sh` (the shipped copy — a reviewer-flagged gap: only the
  former had the block initially, meaning any downstream workspace adopting this plugin would have
  had no detection for the identical pollution class their own copy of the convergence test
  produces; fixed by porting the same `fixture_orphans` scan into the plugin copy, adapted to its
  path-prefix convention). Both re-verified live post-fix: planted fixtures, both scripts WARN and
  exit 0 (non-blocking); this session's own accumulated real pollution (multiple concurrent test
  runs during this batch of gap-fixes) was itself caught by this exact mechanism and swept via
  `sweep-fixture-orphans.mjs` before landing.
- [x] Existing `prepare-milestone-convergence.test.mjs` assertions and cleanup behavior are
  unchanged for the normal (non-interrupted) path. Full suite: 70/70 pass (implementer and
  reviewer, independently, twice each).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master`, verified via real test/script output, not asserted.
- [x] A fresh audit confirms no change to the production `prepare-milestone.js` path-construction
  logic (this task is test/hygiene-tooling only). Confirmed by the independent reviewer: diff
  touches exactly `sweep-fixture-orphans.mjs` (new), `tree-hygiene-check.sh` (both mirrors), and
  `plugin/test/prepare-milestone-convergence.test.mjs`'s `after()` hook — no workflow file in the
  diff.

## Human verification when exp5 marks this task done

1. Does re-running the convergence test suite after a simulated kill leave fewer/zero orphans on
   the next run?
2. Can the manual sweep script be safely run against a real, non-test working tree without
   deleting anything real?
3. Does `tree-hygiene-check.sh` (or equivalent) now surface this class if it recurs?

## Touches

- plugin/test/prepare-milestone-convergence.test.mjs
- experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
- plugin/scripts/tree-hygiene-check.sh
- experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.mjs
- experiments/quay-perpetual-stream/test/sweep-fixture-orphans.test.mjs

## Execution record

Executed directly (mixed mode, 2026-07-31, per explicit user instruction), dispatched to a
worktree-isolated background subagent (`worktree-agent-acbd13d04375324b2`, commit `4a60886`),
merged cleanly into `master` (`git merge-tree` confirmed no conflicts before merging; no manual
resolution needed, unlike the sibling gap-split-or-commit-not-continuously-checked merge).

Independent fresh-subagent review (standing in for Audit) returned CONCERNS with two real,
non-blocking gaps: (1) `plugin/scripts/tree-hygiene-check.sh` (the shipped copy) never got the new
WARN block, only the `experiments/` original did; (2) no automated regression test existed for
`sweep-fixture-orphans.mjs`'s own orphan/non-orphan matching boundary, despite the implementer's
own near-miss (accidentally `rm -rf`'d a real `M209` during manual testing, caught and restored).
Both closed directly by the orchestrating session after the merge: ported the WARN block to the
plugin mirror, added `sweep-fixture-orphans.test.mjs` (6/6 pass). Running the newly-fixed plugin
`tree-hygiene-check.sh` immediately surfaced this session's own real accumulated orphan pollution
(dozens of `M9xxxxx` files from concurrent test runs across this batch of gap-fixes) — swept clean
before landing, a live demonstration the mechanism works.

**Outcome:** done.
