# M109 Acceptance Audit — iteration-0

**Auditor:** fresh-context adversarial pass  
**Date:** 2026-07-22  
**Audit session id:** claude-sonnet-4-6-session-m109-2026-07-22  
**Verdict:** NO REFUTATION FOUND

## AC 1: All 9 vendor-copy scripts renamed .mjs → .ts in `experiments/quay-perpetual-stream/scripts/`; old .mjs files deleted.

**REFUTE attempt:** verify the 9 .ts files exist and no .mjs counterparts remain.

Evidence:
```
$ ls experiments/quay-perpetual-stream/scripts/*.ts | grep -E "anti-drift|concurrent-batch|read-probe|routine-file|routine-sched|serial-fanin|task-schema|touches-orthogonality"
anti-drift-touches-check.ts    ✓
concurrent-batch-scheduler.ts  ✓
read-probe-spec.ts             ✓
routine-file-gate.ts           ✓
routine-scheduler.ts           ✓
serial-fanin-absorb.ts         ✓
task-schema-check.ts           ✓
task-schema.ts                 ✓
touches-orthogonality-check.ts ✓

$ ls experiments/quay-perpetual-stream/scripts/*.mjs | grep -E "anti-drift|concurrent-batch|read-probe|routine-file|routine-sched|serial-fanin|task-schema\.|task-schema-check|touches-orthogonality"
(empty — only it0-dod-check.mjs, it0-enforcement-with-design-check.test.mjs, it0-split-or-commit-check.test.mjs remain)
```

**Verdict:** NOT REFUTED. All 9 .ts files exist; no .mjs counterparts remain.

## AC 2: `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` exits 0.

**REFUTE attempt:** re-run tsc to catch any residual type errors.

Evidence:
```
$ npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json; echo $?
0
```

Type fixes applied:
- `anti-drift-touches-check.ts`: import path `.mjs` → `.js`
- `concurrent-batch-scheduler.ts`: import path `.mjs` → `.js`
- `task-schema-check.ts`: import path `.mjs` → `.js`
- `regenerate-backlog-view.ts`: import path `.mjs` → `.js`
- `golden-replay-dir044.ts`: 4 import paths `.mjs` → `.js`
- `routine-file-gate.ts`: `boardKeys` return type annotated `Set<string>`, `gateFinding` opts typed explicitly
- `routine-scheduler.ts`: `isDue`/`dueRoutines` state parameter typed `{ iteration?: number; event?: string }`; main's local vars annotated

**Verdict:** NOT REFUTED. tsc exits 0.

## AC 3: `sync-vendor.sh` updated to copy `.ts` files; `bash plugin/scripts/sync-vendor.sh` runs without error; `plugin/scripts/` now contains `.ts` files (old `.mjs` deleted).

**REFUTE attempt:** verify plugin/scripts/ contains .ts files, no .mjs counterparts, and sync-vendor.sh has .ts in its copy commands.

Evidence:
```
$ ls plugin/scripts/*.ts
anti-drift-touches-check.ts  read-probe-spec.ts        serial-fanin-absorb.ts
concurrent-batch-scheduler.ts  routine-file-gate.ts    task-schema-check.ts
                               routine-scheduler.ts    task-schema.ts
                               touches-orthogonality-check.ts

$ ls plugin/scripts/*.mjs 2>/dev/null
(empty)

$ grep "\.mjs\|\.ts" plugin/scripts/sync-vendor.sh | grep -E "cp.*\.mjs" | head -5
(empty — all cp commands use .ts)
```

sync-vendor.sh run output: `[sync-vendor] done. Run 'npm install --omit=dev' in .../plugin/vendor/quay to (re)populate its node_modules before use/testing.` — exit 0.

**Verdict:** NOT REFUTED. plugin/scripts/ has .ts copies; old .mjs deleted; sync-vendor.sh updated.

## AC 4: All active `.mjs` references to the 9 scripts updated to `.ts` (loop-driver/SKILL.md, quay-directive/SKILL.md, plugin.json version bumped to 0.3.20).

**REFUTE attempt:** grep for any remaining executable import/call paths using .mjs for the 9 scripts.

Evidence:
- `plugin/skills/loop-driver/SKILL.md`: 6 references updated (concurrent-batch-scheduler, anti-drift-touches-check, serial-fanin-absorb, routine-scheduler, read-probe-spec, routine-file-gate) — verified by grep
- `plugin/skills/quay-directive/SKILL.md`: 1 reference updated (task-schema-check)
- `plugin/.claude-plugin/plugin.json`: `"version": "0.3.20"` confirmed
- Shell wrappers updated: serial-fanin-absorb.sh, touches-orthogonality-check.sh, concurrent-batch-scheduler.sh, anti-drift-touches-check.sh, task-schema-check.sh (both exp5 and plugin copies), routine-file-gate-selfcheck.sh, routine-scheduler-selfcheck.sh
- exp5 test files: 9 test imports updated from `.mjs` to `.ts`
- packages/quay/test/loop-params.test.mjs: routine-scheduler import updated
- plugin/test/plugin-packaging.test.mjs: task-schema/task-schema-check/read-probe-spec refs updated
- plugin/test/probe-spec-wiring.test.mjs: read-probe-spec and routine-scheduler imports updated

Remaining `.mjs` mentions are comments/docs inside .ts files (header comments, usage strings) and historical charters/archives — NOT active execution paths.

**Verdict:** NOT REFUTED. All active import/execution paths updated to .ts.

## AC 5: `it0-dod-check.mjs` untouched: `sha256sum` = `33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`.

**REFUTE attempt:** re-run sha256sum to detect any accidental modification.

Evidence:
```
$ sha256sum experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs
33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb  experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs
```

**Verdict:** NOT REFUTED. GATE-HASH-REF matches exactly.

## Test suite

Full test suite (`packages/quay/test/*.mjs` excluding serve-github + provider-abi-conformance):
- Pre-existing failures: `ts-typecheck-gate` (acceptance timeout, known `.quay/gates.yml` config issue) and `web-ui-browser` (browser test, pre-existing)
- No new regressions introduced

## Summary

All 5 ACs pass adversarial scrutiny. **NO REFUTATION FOUND.**
