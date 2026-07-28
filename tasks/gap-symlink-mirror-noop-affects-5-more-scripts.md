---
id: gap-symlink-mirror-noop-affects-5-more-scripts
title: The fixed config-wiring-check.ts/concurrent-batch-scheduler.ts mirror-symlink
  silent-no-op bug affects 5 more scripts that were never checked
status: needs-human
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Resolution, closed (2026-07-28)

Duplicate of the pre-existing `gap-touches-orthogonality-symlink-isdirect-mismatch`, found the same
day this task was filed. That task already had real `git stash`-based reproduction evidence for
`touches-orthogonality-check.ts`/`anti-drift-touches-check.ts` and predates this one; its stale
`concurrent-batch-scheduler.ts` scope item has been corrected (already fixed elsewhere) and the 3
additional scripts this task found (`routine-file-gate.ts`, `routine-scheduler.ts`,
`serial-fanin-absorb.ts`) plus its "enumerate symlinks, don't hardcode" regression-test design have
been merged into it. Superseded by, and closed in favor of, `gap-touches-orthogonality-symlink-
isdirect-mismatch` — no further work should land against this file. AC/DoD checkboxes below are left
unticked (DIR-020: they were never executed under this task's own identity).

## Finding

`gap-config-wiring-check-symlink-noop` (closed `done` via M-DIR119-C-CANARY, 2026-07-27) fixed the
`process.argv[1] === fileURLToPath(import.meta.url)` entrypoint-guard bug for exactly
`config-wiring-check.ts` and `concurrent-batch-scheduler.ts` — invoking either via its
`experiments/quay-perpetual-stream/scripts/` mirror symlink silently no-ops (`main()` never runs)
instead of behaving identically to the real `plugin/scripts/` path.

Discovered 2026-07-28, while re-running `touches-orthogonality-check.ts` for an unrelated execution-
order check: the SAME symptom reproduced — `node --experimental-strip-types
experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts tasks/A.md tasks/B.md`
produced zero output and exit 0/1, while `node --experimental-strip-types
plugin/scripts/touches-orthogonality-check.ts tasks/A.md tasks/B.md` (the real path) printed the
correct OVERLAP/DISJOINT verdict. A repo-wide check of every symlinked script under
`experiments/quay-perpetual-stream/scripts/` for the same `process.argv[1] ===
fileURLToPath(...)`-shaped guard found 5 more instances, none covered by the prior fix's scope:

```
routine-file-gate.ts
routine-scheduler.ts
serial-fanin-absorb.ts
anti-drift-touches-check.ts
touches-orthogonality-check.ts
```

The prior gap's own AC/DoD were satisfied exactly as written — it named two specific scripts and
fixed exactly those two, verified by real command-output comparison. It did not do a repo-wide sweep
for the pattern class, so this recurrence was not caught by that task's own closure, nor by the
independent audit that confirmed it done.

This matters here specifically because `touches-orthogonality-check.ts` is a safety-relevant gate:
if it is ever invoked via its mirror path (the natural choice for an exp5-authored gate call, same
reasoning the original gap task gave for `config-wiring-check.ts`) it silently reports nothing
instead of blocking an unsafe concurrent dispatch — the exact failure shape
`gap-halt-sentinel-path-mismatch`/`gap-config-wiring-check-symlink-noop` both already warned about.

## Requested action

Apply the same fix already landed for `config-wiring-check.ts`/`concurrent-batch-scheduler.ts`
(the `fs.realpathSync`-based `isDirectInvocation()` helper) to all 5 scripts named above. Then add a
repo-wide regression test (not 5 more copy-pasted per-script tests) that enumerates every symlink
under `experiments/quay-perpetual-stream/scripts/` pointing into `plugin/scripts/`, and for each one
asserts non-silent, output-identical behavior between the mirror and real invocation paths — so a
6th future instance of this exact pattern is caught mechanically instead of by accidental discovery.

## Acceptance Criteria
- [ ] All 5 named scripts use the same realpath-based direct-invocation check as the already-fixed
  two; mirror-path invocation produces identical output/exit-code to the real-path invocation for
  each, shown with real command output (not asserted).
- [ ] A single repo-wide test enumerates every `experiments/quay-perpetual-stream/scripts/*` symlink
  target and asserts mirror-path invocation is non-silent for all of them — RED against at least one
  of the 5 real scripts before the fix, GREEN after.
- [ ] The regression test is written so a new script added later with the same vulnerable guard shape
  is caught automatically (enumerates symlinks, not a hardcoded script list).

## Definition of Done
- [ ] Landed on `master`, verified via real command output, not asserted.
- [ ] Per DIR-026 Reading A: script changes alone do not satisfy this — real before/after command
  output for all 5 scripts is required.

## Human verification when exp5 marks this task done
1. Do all 5 named scripts now behave identically via both invocation paths?
2. Does the new regression test enumerate symlinks (catching future recurrences) rather than
   hardcoding today's 5 script names?

## Touches

- plugin/scripts/routine-file-gate.ts
- plugin/scripts/routine-scheduler.ts
- plugin/scripts/serial-fanin-absorb.ts
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/touches-orthogonality-check.ts
- experiments/quay-perpetual-stream/test/*symlink*mirror*.test.mjs (or sibling path)
