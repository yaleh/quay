---
id: gap-config-wiring-check-symlink-noop
title: config-wiring-check.ts silently no-ops (exit 0, zero output) when invoked
  via its own shipped experiments/ mirror symlink instead of the real
  plugin/scripts/ path
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

Discovered 2026-07-27 by M186's independent acceptance audit while verifying DIR-120's Phase 0
deliverable (`config-wiring-check.ts`). Real, reproduced, root-caused:

```
$ node experiments/quay-perpetual-stream/scripts/config-wiring-check.ts --driver both
$ echo $?
0
```

versus the real path:

```
$ node plugin/scripts/config-wiring-check.ts --driver both
config-wiring-check — workspace=... drivers=[bespoke,generic]
...
FAIL: 7 issue(s) across 8 field(s)
$ echo $?
1
```

**Root cause**: the module's CLI-entrypoint guard is
`process.argv[1] === fileURLToPath(import.meta.url)`. `fileURLToPath(import.meta.url)` always
resolves THROUGH the symlink to the real file's absolute path; `process.argv[1]` is never resolved
through the symlink (stays exactly as typed on the command line). The two can therefore **never**
be equal when the script is invoked via the `experiments/quay-perpetual-stream/scripts/`
mirror path, under any combination of relative/absolute argv — so `main()` never runs and the
process falls through to a clean, silent exit 0, indistinguishable from "ran and found zero
issues."

This matches an existing repo convention (`concurrent-batch-scheduler.ts` has the same shape,
always invoked via its `plugin/scripts/` path, never via the mirror) and was honestly disclosed in
`milestones/M186/iterations/iteration-0.md`'s own build report — not hidden. But it is **not
guarded against**: nothing asserts that the mirror path fails loudly (or at least non-silently)
rather than silently reporting "0 issues" if it is ever actually invoked that way.

**Why this matters more for THIS script than the existing precedent**: DIR-120's own Requested
Action item 1 explicitly names "接进 CI 或 `.quay/config.yml` 的 gate 集" as the intended next step
for `config-wiring-check`. If a future gate-wiring pass registers this check using the
`experiments/quay-perpetual-stream/scripts/` path (the natural choice for an exp5-authored gate,
and the path most existing exp5 gate registrations use), it would silently, permanently report "0
issues" regardless of the real config state — the exact "authoritative-looking-but-dead" failure
shape that motivated DIR-120 in the first place ([[gap-halt-sentinel-path-mismatch]]). A check
whose entire purpose is catching silently-dead wiring would itself be silently dead.

## Requested action

Either:
1. Make the mirror symlink re-exec the real file so both invocation paths behave identically
   (e.g. the entrypoint guard should compare realpath-resolved forms of both sides, or check
   `import.meta.url`'s basename against `process.argv[1]`'s basename plus a content/identity check
   rather than raw string equality), OR
2. Have the CLI entrypoint fail loudly (non-zero exit + stderr message) whenever the module was
   loaded but `main()` was never reached via any recognized invocation path, rather than silently
   falling through to a clean exit.

Whichever fix is chosen, apply the SAME fix to the pre-existing `concurrent-batch-scheduler.ts`
instance of this shape if it's the same root cause (worth confirming, not assuming) — no reason to
fix it in one script and leave the other silently fragile.

## Acceptance Criteria
- [x] `node experiments/quay-perpetual-stream/scripts/config-wiring-check.ts --driver both` (mirror
  path) produces the SAME real output/exit-code as `node plugin/scripts/config-wiring-check.ts
  --driver both` (real path), against the same repo state — not silently 0/no-output. -- [audit
  M-DIR119-C-CANARY: ran both commands independently, redirected to files, `diff`'d — identical
  content (only the node warning line's PID differs, cosmetic), both exit 1, both print the real
  8-field FAIL report. The historical silent-0/no-output bug is gone.]
- [x] A regression test exists asserting the mirror-path invocation is non-silent (either identical
  output to the real path, or a loud failure) — RED against the current behavior, GREEN after the fix. -- [audit: `experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs` test
  "config-wiring-check.ts: mirror-path invocation is real, not a silent no-op" — ran it, PASS.
  Asserts non-empty output, matching exit code, and byte-identical stdout between mirror and real
  paths.]
- [x] `concurrent-batch-scheduler.ts` checked for the same shape; fixed identically if confirmed, or
  explicitly noted as a different mechanism if not. -- [audit: confirmed same root cause (raw
  `process.argv[1] === fileURLToPath(...)` guard) and fixed identically via the same
  `fs.realpathSync`-based `isDirectInvocation()` helper — `tail -20
  plugin/scripts/concurrent-batch-scheduler.ts` shows the matching fix; sibling test
  "concurrent-batch-scheduler.ts: mirror-path invocation is real, not a silent no-op" in the same
  test file, ran it, PASS.]

## Definition of Done
- [x] Landed on `master`, verified via real command output comparing both invocation paths, not asserted. -- [audit: both fixes are part of commit `23f43d5` on local `master`; live command-output comparison performed directly by this audit (see AC1 evidence) — not merely re-reading the implementer's own claim. NOTE: local `master` is 55 commits ahead of `origin/master` at audit time (not yet pushed) — "landed on master" is true for the local branch this repo is driven from, not yet reflected on the remote.]

## Human verification when exp5 marks this task done
1. Do both invocation paths of `config-wiring-check.ts` now produce identical, real output?
2. Was `concurrent-batch-scheduler.ts` checked for the same bug class?

## Touches

- plugin/scripts/config-wiring-check.ts
- experiments/quay-perpetual-stream/scripts/config-wiring-check.ts
- plugin/scripts/concurrent-batch-scheduler.ts
- experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs (or sibling test path)

## Execution record

- **Milestone:** M-DIR119-C-CANARY (composite, 7 member tasks; DIR-119-C proof)
- **Iteration count:** 1 (direct-to-master build, no separate worktree — precedent: M187/M188/M189)
- **Realized Δv:** defect fix, deliverable=yes — both `config-wiring-check.ts` and
  `concurrent-batch-scheduler.ts` mirror-path silent-no-op fixed identically, RED/GREEN regression
  tests confirmed passing. All AC/DoD items independently confirmed, no gaps.
- **Merge commit:** 23f43d5 (Build, direct on master) + this Land's Reconcile/write-back commit
- **Outcome:** DONE, no refutation — fully confirmed.