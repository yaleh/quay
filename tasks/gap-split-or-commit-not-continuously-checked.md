---
id: gap-split-or-commit-not-continuously-checked
title: "it0-split-or-commit-check.ts only runs opportunistically inside a
  milestone's own Gate phase, scoped to whichever task that milestone is
  landing — a parent-done/child-open violation introduced by ONE milestone's
  Land can sit undetected indefinitely until some later, unrelated
  milestone's Gate phase happens to catch it"
status: todo
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Wire `it0-split-or-commit-check.ts .` (the whole-task-store scan, not the single-task `quay gate
--gate split-or-commit <id>` CLI form) into a continuously/periodically-run surface — either
`scripts/test.sh`'s canonical suite, a CI job, or a dedicated periodic routine already registered
in `.quay/loop.yml`/`OUTER-LOOP.md` — so a `PARENT-DONE-IFF-CHILDREN` (or the other two
split-or-commit rules) violation is caught within one check cycle of being introduced, not left to
whichever future milestone's Gate phase happens to run next.

## Finding

Discovered 2026-07-28 by the independent fresh-context audit dispatched after M194 (DIR-120-B)
landed (session `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`). Real sequence of events that exposed this:

1. M192 (DIR-120's own Land, commit `8c096e9`) marked `tasks/DIR-120.md` `status: done` while its
   already-existing child `tasks/DIR-120-B.md` remained `status: todo` — a real violation of
   `ADR-014`'s parent-done-iff-children rule. M192's own Gate phase had run `split-or-commit`
   moments earlier, against the SAME whole task store, and legitimately reported PASS — because
   Gate runs *before* Land within one milestone dispatch, so it necessarily checks the
   pre-Land state, where `DIR-120` was not yet `done`. The violation was created by Land itself,
   *after* the one and only mechanical check for that milestone had already run.
2. This violation then sat, live and undetected, on `master` for the entire gap between M192's Land
   (2026-07-28, commit `8c096e9`) and M194's own Gate phase (2026-07-28, later the same day) — the
   very next milestone dispatch to invoke `split-or-commit` at all. It was caught purely by
   coincidence: M194 happened to be dispatched for `DIR-120-B` itself, and `split-or-commit`'s
   underlying script always scans the ENTIRE task store (`node plugin/scripts/
   it0-split-or-commit-check.ts .`), not just the task named on the CLI.
3. Confirmed via direct grep (independent audit, re-confirmed here): `it0-split-or-commit-check.ts`
   is **not** referenced in `scripts/test.sh`, **not** in `.github/workflows/ci.yml`, and **not**
   wired as a periodic routine in any `.quay/loop.yml`. Its only two invocation paths are (a) a
   human running it manually, or (b) a milestone's own Gate phase, which only fires when SOME
   milestone happens to be dispatched next, for ANY task, and only checks the store at that
   incidental moment.
4. The practical consequence, stated precisely: if the outer loop is halted between milestones
   (exactly the state at the time of this audit — a root `.halt` sentinel was present) after a
   Land that introduces a split-or-commit violation, that violation has **zero** mechanical
   detection until the loop resumes and some future milestone's Gate phase happens to run. There is
   no CI job, no test-suite assertion, and no standalone periodic check that would catch it in the
   meantime.
5. This is a real, generalizable risk, not a one-off: it applies to EVERY future DIR-026
   SPLIT-OR-COMMIT split that keeps a formal `parent`/`children` link (as opposed to de-parenting,
   the alternative pattern used by e.g. `gap-execute-milestone-no-worktree-isolation` → `DIR-123`,
   which avoided this exact class of exposure by never creating a parent/children link in the first
   place).

## Requested action

1. Add `it0-split-or-commit-check.ts .` (whole-store form) to a surface that runs on every relevant
   change, not just opportunistically:
   - Simplest: add it as a step in `scripts/test.sh` (the canonical suite both this repo and CI
     already run on every change) — a plain script invocation, not a `node --test` file, so it may
     need its own small wrapper or direct inline call; check the existing precedent for how other
     non-`node --test` mechanical checks (if any) are folded into `scripts/test.sh`, or add it as
     its own explicit step alongside the test-file glob.
   - Alternative/additional: wire it as a `.github/workflows/ci.yml` job step, independent of
     `scripts/test.sh`.
2. Add the whole-store check to Land's own post-mutation steps. It must run after Land has applied
   authoritative task/parent/child lifecycle writes and before the workflow may report `done`.
   A failure returns a typed non-success terminal and records the check result in the current
   stage receipt when DIR-124-B receipts are available. Pre-Land Gate coverage remains
   defense-in-depth; it cannot substitute for observing the state after mutation.
3. Confirm the fix actually closes the gap: reproduce the exact M192/M194 scenario as a fixture (a
   parent marked `done` with a still-`todo` child, injected into a temp/fixture task store) and show
   the new continuous check catches it — RED before the fix is wired in this scope, GREEN after.

## Acceptance Criteria
- [ ] RED/GREEN integration evidence proves the whole-store
  `it0-split-or-commit-check.ts .`—not `quay gate --gate split-or-commit <id>`—is wired through
  `scripts/test.sh`, CI, or the registered `.quay/loop.yml`/`OUTER-LOOP.md` periodic surface and
  catches `PARENT-DONE-IFF-CHILDREN` within that surface's next check cycle.
- [ ] If the canonical-suite route is selected, real integration evidence proves
  `scripts/test.sh` invokes the plain check outside the `node --test` file glob and therefore does
  not silently omit it.
- [ ] If the CI route is selected, real integration evidence proves
  `.github/workflows/ci.yml` invokes the check independently of `scripts/test.sh`; if not selected,
  the task records that CI inherits the canonical-suite call instead.
- [ ] `it0-split-or-commit-check.ts .` (or equivalent whole-store invocation) runs on a surface that
  fires on every relevant change (canonical test suite and/or CI), not only inside a milestone's own
  Gate phase — grep/CI-config-confirmable.
- [ ] A fixture reproduces the exact M192/M194 shape (parent `done`, child `todo`, formal
  `parent`/`children` link) and demonstrates the new continuous surface catches it — real RED
  (before this fix's wiring) and GREEN (after) output pasted, not asserted.
- [ ] Land itself runs the whole-store split-or-commit check after its authoritative lifecycle
  edits and before reporting `outcome: done`; the M192/M194-shaped violation produces a typed
  non-success and cannot advance.
- [ ] When DIR-124-B stage receipts are installed, the post-Land check's command identity,
  input/task-store hash, outcome, and reason are included in or referenced by the Land receipt;
  before that dependency lands, the same facts remain visible in deterministic workflow output.
- [ ] Existing `scripts/test.sh`/CI runs remain green with the new check wired in (no regression,
  no flakiness introduced by scanning the full task store on every run).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code and prose claims alone are necessary but insufficient — real command output
is required for every item above.

- [ ] Landed on `master`, verified via the new fixture's real RED/GREEN output, not asserted.
- [ ] Because the wiring point is likely `scripts/test.sh` and/or `.github/workflows/ci.yml` (and
  possibly `.claude/workflows/execute-milestone.js`'s Land phase, if item 2 above is implemented,
  which is a driver execution-chain script), this must run under human-steered discipline.

## Human verification when exp5 marks this task done
1. Does a split-or-commit violation introduced by one milestone's Land now get caught before the
   next milestone dispatch, rather than waiting on an unrelated future Gate phase?
2. Does Land itself check the state it just mutated, rather than relying only on a pre-mutation
   Gate or a later unrelated CI run?

## Touches

- scripts/test.sh
- .github/workflows/ci.yml
- plugin/scripts/it0-split-or-commit-check.ts
- experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts
- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
