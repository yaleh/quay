# M116 iteration-0 — TS migration P5-A (bin entrypoints, DIR-058)

**Milestone:** M116 — `exp5-M-TS-MIGRATION-P5-A`
**Charter:** `experiments/quay-perpetual-stream/charters/M116-ts-migration-p5-a.md`
**Implementation commit:** `3667b02c4aef531f5d9a710c743451a8657fc5ac` (`feat(M116): TS migration P5-A (DIR-058) — migrate 4 CLI bin/*.js entrypoints to .ts`)
**Note:** this report is authored at ABSORB time (2026-07-23), after the implementation already
landed on `master` in a prior session/turn whose ABSORB bookkeeping was not completed before the
turn ended. It documents the real, already-committed change with fresh evidence re-verified this
ABSORB — it is not a retrospective narrative substituting for evidence.

## What changed (per `git show --stat 3667b02`)

- `packages/quay-native/bin/quay-native.js` → `packages/quay-native/bin/quay-native.ts`
- `packages/quay-github/bin/quay-github.js` → `packages/quay-github/bin/quay-github.ts`
- `packages/quay/bin/quay.js` → `packages/quay/bin/quay.ts`
- `packages/quay-backlog/bin/quay-backlog.js` → `packages/quay-backlog/bin/quay-backlog.ts`
- Each package's `package.json` `bin` field, `.quay/config.yml`, `.mcp.json`/`plugin/.mcp.json`
  `mcp_entry` paths, `esbuild-sea.mjs` bundler configs, `.github/workflows/release.yml`, and test
  helpers referencing a `bin/*.js` path updated to match.

## AC1 — behavior-preserving golden-diff (re-verified live, this ABSORB)

For each of the 4 entrypoints, the PRE-migration `.js` blob (`git show 3667b02~1:<path>`) was
extracted to its original directory (so ESM relative-import resolution matches), run with `--help`,
and diffed against the current `.ts` file's `--help` output:

```
quay-native: old_exit=1 new_exit=1  IDENTICAL
quay-github: old_exit=1 new_exit=1  IDENTICAL
quay-backlog: old_exit=1 new_exit=1  DIFF: only file-path/line-number text inside the stack trace
  (expected — file renamed .js→.ts, one extra type-stripping frame), the actual error MESSAGE is
  byte-identical: "Error: QUAY_BACKLOG_TASKS_DIR must be set to the Backlog.md board's tasks
  directory (e.g. /path/to/backlog/tasks)"
quay: old_exit=0 new_exit=0  IDENTICAL
```

No CLI accepts a real `--help` flag (all 4 are thin launchers with no arg-parsing for it); the
observed exit=1/"usage"-style output on 3 of 4 is the PRE-EXISTING behavior, confirmed identical
before/after by the diff above, not a regression introduced by this migration.

## AC2 — `tsc --noEmit` (per-package, DIR-059's split gate)

```
$ for d in packages/*/; do npx tsc --noEmit -p "$d"; echo "$d exit=$?"; done
packages/quay-backlog/ exit=0
packages/quay-github/  exit=0
packages/quay-native/  exit=0
packages/quay/         exit=0
```

Zero errors across all 4 packages (no pre-existing TS2589 either — DIR-059's zod-dedup fix, landed
same session, eliminated those; see that directive's own evidence).

## AC3 — full non-flaky suite green (golden-diff before/after)

```
$ cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')
ℹ tests 354
ℹ pass 354
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

354/354 pass (re-run live this ABSORB, 2026-07-23). Note: at M114 this same suite showed 346/354
(8 pre-existing, migration-unrelated failures, filed as `exp5-DEFECT-M114-TESTSUITE-DRIFT`). All 8
are now fixed — as a side effect of DIR-059's same-session work (zod dedup removed the 3 TS2589
failures; the cwd fix + stale-`.mjs`-ref fix + fixture/assertion updates fixed the other 5). See
DIR-059's commit `6f183ef` for the itemized breakdown. This is evidence for DIR-059's own disposition
below, not new work by this milestone.

```
$ node --test experiments/quay-perpetual-stream/test/*.mjs
ℹ tests 343
ℹ pass 343
ℹ fail 0
```

## AC4 — SEA shims named out-of-scope

`packages/quay-native/scripts/manifest.sea-shim.js` and `packages/quay/scripts/version-sea-shim.js`
remain `.js` by design (esbuild `--alias` substitution targets, must never join the ESM/TS module
graph) — explicitly named in DIR-058 and this milestone's charter as a permanent exemption, not
silently skipped.

## Full JS-elimination scope check (DIR-058, informational — P5-B not yet done)

```
$ find packages -path '*/node_modules/*' -prune -o -name '*.js' -print | grep -v '/test/'
packages/quay-native/scripts/manifest.sea-shim.js       (exempt, expected)
packages/quay-backlog/src/manifest.js                    (P5-B scope, not this milestone)
packages/quay-backlog/src/backlog-client.js              (P5-B scope, not this milestone)
packages/quay-backlog/src/mcp-server.js                  (P5-B scope, not this milestone)
packages/quay/scripts/version-sea-shim.js                (exempt, expected)
```

Confirms P5-A's own scope (the 4 `bin/*.js` files) is fully migrated; the remaining 3 files are
P5-B's explicit scope (`exp5-M-TS-MIGRATION-P5-B`, still `todo`), not this milestone's.

## Recommendation

DONE. All 4 AC + 3 DoD items independently re-verified true with fresh evidence pasted above, this
same ABSORB.
