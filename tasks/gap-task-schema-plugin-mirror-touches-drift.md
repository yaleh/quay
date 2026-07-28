---
id: gap-task-schema-plugin-mirror-touches-drift
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Re-sync `plugin/scripts/task-schema.ts` (the vendored mirror) with
`experiments/quay-perpetual-stream/scripts/task-schema.ts` (the canonical source) — M178/DIR-113
(commit `3f28b4e`) changed `checkTouches`'s signature and behavior on the canonical source (added a
`kind` parameter and a soft, non-blocking `touches-absent-milestone-candidate` INFO code for
milestone-candidate tasks with no `## Touches` section) but did not touch the plugin mirror,
leaving the two copies functionally divergent, not just textually divergent.

## Plan

N/A — mechanical re-sync (copy the canonical source's current `checkTouches` implementation, and
any other drifted regions, into the plugin mirror; re-run the vendor-sync check). No separate design
doc needed; the `## Requested action` section below is the plan.

## Finding

Discovered live during DIR-114/M175's Build-phase re-verification full-suite regression run
(`bash scripts/test.sh`, session `006748f4-b16e-4522-a7a6-68b595240e42`, 2026-07-27) — NOT
introduced by DIR-114's own changes (DIR-114 touches only `.claude/workflows/*.js` /
`plugin/workflows/*.js`, confirmed via `git status`/`git diff`, zero overlap with
`task-schema.ts`).

`plugin/test/plugin-packaging.test.mjs`'s "shipped schema-check modules are byte-identical to their
exp5 canonical source, modulo attribution-only sanitization" test FAILS on current `master` HEAD:
the assertion diff shows `experiments/quay-perpetual-stream/scripts/task-schema.ts`'s `checkTouches`
now takes `(task, kind)` and, for `kind === "milestone-candidate"` tasks with no `## Touches`
section, returns a soft `{ok: true, code: "touches-absent-milestone-candidate", ...}` INFO instead
of falling through to the stricter absent-section handling — while `plugin/scripts/task-schema.ts`
still has the old `checkTouches(task)` (no `kind` param, no milestone-candidate carve-out).

Root cause: `git show --stat 3f28b4e` (M178/DIR-113's landing commit, "pre-screen task-level Touches
orthogonality before charter-authoring") shows it modified
`experiments/quay-perpetual-stream/scripts/task-schema.ts` but did **not** touch
`plugin/scripts/task-schema.ts` — the dual-copy vendor-sync step this exact test exists to enforce
was skipped for this one file in that commit.

This means: any consumer relying on the shipped `plugin/scripts/task-schema.ts` (e.g. a plugin
install, or `plugin/scripts/task-schema-check.sh`) does NOT get DIR-113's milestone-candidate soft-
warning behavior — a functional regression for plugin consumers, not merely a cosmetic text
mismatch. Confirmed via direct `diff` between the two files (not just the test's own truncated
assertion output).

## Requested action

1. Copy the current `experiments/quay-perpetual-stream/scripts/task-schema.ts` canonical source
   into `plugin/scripts/task-schema.ts` (whatever this repo's standard vendor-sync mechanism is —
   `plugin/sync.sh` or equivalent — rather than a manual copy, to avoid re-diverging).
2. Re-run `bash scripts/test.sh plugin/test/plugin-packaging.test.mjs` to confirm the byte-identical
   assertion passes.
3. Re-run the full suite (`bash scripts/test.sh`) to confirm no other latent drift and zero
   regressions.
4. Audit whether any other `experiments/quay-perpetual-stream/scripts/*.ts` ↔ `plugin/scripts/*.ts`
   pairs have similarly drifted since the last full sync (a broader `diff`-based sweep), since this
   is evidence the M178 landing process can silently skip a file in the vendor-sync step.

## Acceptance Criteria
- [ ] `plugin/scripts/task-schema.ts` is byte-identical (modulo attribution-only sanitization) to
  `experiments/quay-perpetual-stream/scripts/task-schema.ts` — `bash scripts/test.sh
  plugin/test/plugin-packaging.test.mjs` passes.
- [ ] Full suite (`bash scripts/test.sh`) passes with zero failures attributable to this drift.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Fix landed on `master` via a real commit touching `plugin/scripts/task-schema.ts`, verified by
  re-running the previously-failing test directly (not asserted from self-report).
- [ ] No behavior change to the canonical `experiments/quay-perpetual-stream/scripts/task-schema.ts`
  source — this is a one-directional re-sync (canonical → vendored mirror), matching this repo's
  documented single-source-of-truth direction (vendor copy follows canonical, never the reverse).

## Touches

- experiments/quay-perpetual-stream/scripts/task-schema.ts
- plugin/scripts/task-schema.ts
- plugin/test/plugin-packaging.test.mjs
