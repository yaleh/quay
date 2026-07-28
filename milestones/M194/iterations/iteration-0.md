# M194 / DIR-120-B iteration 0 — fix drivable-workspace-check.ts's layering inversion

**Task:** DIR-120-B (DIR-120 Phase 3b) · **Charter:**
`experiments/quay-perpetual-stream/charters/M194-dir120b-drivable-workspace-check-fix.md`
**Class:** development · **Value type:** capabilityGrowth · **Deliverable:** yes

## Summary

`plugin/scripts/drivable-workspace-check.ts`'s `DEFAULT_REGISTRY_PATH` was a directory-relative
guess (`path.join(__dirname, "..", "drivable-workspaces.yml")`) correct from only one of its two
live on-disk locations — resolving to the real registry only by accident when invoked from the
non-symlinked `experiments/quay-perpetual-stream/scripts/` copy, and to a nonexistent
`plugin/drivable-workspaces.yml` when invoked from `plugin/scripts/` itself. This iteration removes
the constant entirely, makes `--registry` a required CLI flag (clean usage error, exit 2, when
omitted), converts the experiments-tree copies to real symlinks (matching
`config-wiring-check.ts`'s already-proven shape), fixes both downstream consumers independently,
re-derives `selftest()`'s three real-registry checks to run unconditionally (individually visible,
never silently skipped), and rewrites the module's out-of-`scripts/test.sh`-glob test file to pass
an explicit registry in every assertion.

## What changed

### 1. `plugin/scripts/drivable-workspace-check.ts`
- Removed the exported `DEFAULT_REGISTRY_PATH` constant.
- Added a `selftest()`-internal, never-re-exported `SELFTEST_REGISTRY_PATH` constant pointing at
  the real checked-in registry.
- `main()`: `registryPath` now starts `undefined`; `--registry` is required — usage() (exit 2) is
  called when either no target paths or no `--registry` is given.
- `selftest()`'s three `real-registry-*` checks moved OUT from behind an
  `if (fs.existsSync(...))` guard — they now run unconditionally, plus a new
  `real-registry-file-exists` check makes the file's presence itself individually visible instead
  of silently degrading the other three checks' meaning.
- **Also fixed** (found while implementing item 2, not a pre-planned AC line, but required for the
  symlink conversion to actually work — the same defect class already named
  `gap-config-wiring-check-symlink-noop` and already fixed once in `config-wiring-check.ts`): the
  `isDirect` entrypoint check used raw `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`
  equality, which is NEVER true when the script is invoked via a real symlink (Node's ESM loader
  resolves `import.meta.url` through the symlink to the real file, but `process.argv[1]` stays
  exactly as typed) — the CLI would silently exit 0 without ever calling `main()`. Replaced with
  `config-wiring-check.ts`'s own `fs.realpathSync`-based `isDirectInvocation()`, verified by real
  subprocess invocation through the new symlink (see Evidence below).

### 2. `plugin/scripts/drivable-workspace-check.sh`
Usage/comment text updated to say `--registry <file>` is required (delegates enforcement to the
`.ts` module; no functional change to the wrapper itself).

### 3. Symlink conversion
`experiments/quay-perpetual-stream/scripts/drivable-workspace-check.{ts,sh}` — previously
byte-identical regular-file copies — are now real symlinks to the `plugin/scripts/` originals
(`../../../plugin/scripts/drivable-workspace-check.{ts,sh}`), the same relative shape
`config-wiring-check.ts` already uses.

### 4. `experiments/quay-perpetual-stream/scripts/select-preflight.ts`
Removed the dead `DEFAULT_REGISTRY_PATH` import (confirmed unused elsewhere in the file — its own
registry loading at line ~571 already computes its own `registryPath` independently).

### 5. `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts`
- Removed the `DEFAULT_REGISTRY_PATH` import.
- `main()`'s `registryPath` now starts `undefined` instead of defaulting to the removed constant.
- When `--workspace` is given, an omitted `--registry` now triggers `usage()` (exit 2) before
  `loadRegistry` is ever called, instead of silently passing `undefined` through.

### 6. `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs`
Rewritten: `DEFAULT_REGISTRY_PATH` import removed; a `REAL_REGISTRY_PATH` constant computed from
the test file's own `import.meta.url` (one directory up) is passed explicitly to every
`loadRegistry`/CLI call that needs the real registry. Added two new tests: `--registry` omitted
with paths given → usage error exit 2 (proves the new required-flag behavior); the existing
missing-registry-file and fixture-override tests are unchanged in intent, only made explicit.

### 7. `experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs` (not in the
milestone's original Touches list, but required — see below)
The two `--workspace`-exercising CLI tests relied on the removed runtime default; added an explicit
`REAL_REGISTRY_PATH` constant and passed `--registry` to both, plus a new test proving
`--workspace` without `--registry` now fails with usage error exit 2.

### 8. `.quay/config.yml` `gates.it0` `drivable-workspace` entry — sign-off
No code change. Confirmed still registered (`name: drivable-workspace`,
`script: ./plugin/scripts/drivable-workspace-check.sh`, `argsKey: drivableWorkspaceArgs`) and
confirmed via `grep -rl drivableWorkspaceArgs tasks/` that no real task sets this key — this
milestone does **not** manufacture one to exercise the path end-to-end (rejected as the same
self-celebratory-fixture pattern this repo's convention rejects elsewhere). This chain stays
end-to-end-unexercised in production; an explicit, not silent, sign-off.

## Deviation from the Touches list (item 7 above)

`tasks/DIR-120-B.md`'s `## Touches` list did not name
`experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs`, but its own Acceptance
Criteria explicitly required "`human-steered-classify.ts`'s ... own existing tests re-run green" —
running that file unmodified after the runtime-default removal produced 2 real failures (both
`--workspace`-exercising CLI tests, which relied on the removed default). Fixing the test file
(inject an explicit `--registry`) was necessary to satisfy the AC's own "re-run green" requirement;
leaving it red would contradict the AC while leaving the Touches list technically satisfied — the
AC's real-evidence requirement took precedence per DIR-026 Reading A.

## Evidence

### `--registry` required, clean usage error, exit 2
```
$ node plugin/scripts/drivable-workspace-check.ts
usage: node drivable-workspace-check.ts <path> [<path> ...] --registry <file>
       node drivable-workspace-check.ts --selftest
ERROR: --registry is required (DIR-120-B removed the guessed default path).
EXIT: 2

$ node plugin/scripts/drivable-workspace-check.ts /home/yale/work/quay
usage: node drivable-workspace-check.ts <path> [<path> ...] --registry <file>
       node drivable-workspace-check.ts --selftest
ERROR: --registry is required (DIR-120-B removed the guessed default path).
EXIT: 2
```

### Registry file unmoved
```
$ ls -la experiments/quay-perpetual-stream/drivable-workspaces.yml
-rw-rw-r-- 1 yale yale 2657 Jul 23 04:30 experiments/quay-perpetual-stream/drivable-workspaces.yml
$ ls plugin/drivable-workspaces.yml
ls: cannot access 'plugin/drivable-workspaces.yml': No such file or directory
```

### Real symlinks
```
$ ls -la experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh
lrwxrwxrwx 1 yale yale 51 Jul 28 14:19 experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh -> ../../../plugin/scripts/drivable-workspace-check.sh
lrwxrwxrwx 1 yale yale 51 Jul 28 14:19 experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts -> ../../../plugin/scripts/drivable-workspace-check.ts
```

### Symlink invocation actually runs `main()` (the isDirect/realpath fix, proven live)
```
$ bash experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh /home/yale/work/quay --registry experiments/quay-perpetual-stream/drivable-workspaces.yml
PASS: all 1 workspace path(s) covered by experiments/quay-perpetual-stream/drivable-workspaces.yml: /home/yale/work/quay
EXIT: 0

$ bash experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh
Usage: experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh <path> [<path> ...] --registry <file>
EXIT: 2
```

### `selftest()` — each `real-registry-*` check individually visible (not folded into an aggregate)
```
$ node plugin/scripts/drivable-workspace-check.ts --selftest
SELFTEST PASS: under-authorized-root — covered by authorized_root
SELFTEST PASS: explicit-outside-root — covered by explicit workspaces[] entry
SELFTEST PASS: descendant-of-explicit — descendant of explicit entry covered
SELFTEST PASS: uncovered-path — not covered, correctly fails closed
SELFTEST PASS: empty-path — empty target never matches
SELFTEST PASS: prefix-lookalike-not-covered — string-prefix false-positive correctly rejected
SELFTEST PASS: empty-registry-covers-nothing — no authorized_root/workspaces -> fail closed
SELFTEST PASS: checkPaths-all-covered — ok=true
SELFTEST PASS: checkPaths-mixed-fails — ok=false, uncovered=["/tmp/x"]
SELFTEST PASS: checkPaths-empty-input-fails-closed — no targets given -> not a vacuous pass
SELFTEST PASS: real-registry-file-exists — path=/home/yale/work/quay/experiments/quay-perpetual-stream/drivable-workspaces.yml
SELFTEST PASS: real-registry-has-authorized-root — authorizedRoot=/home/yale/work
SELFTEST PASS: real-registry-covers-archguard — real archguard entry covered
SELFTEST PASS: real-registry-rejects-tmp — real registry correctly rejects /tmp/x
SELFTEST: all fixture cases PASS.
EXIT: 0
```

### `select-preflight.ts` — own tests re-run green, independent of the human-steered-classify.ts fix
```
$ node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### `human-steered-classify.ts` — own tests re-run green (test file updated per the Deviation note
above), independent of the select-preflight.ts fix
```
$ node --test experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
New test added and passing: `CLI: --workspace given but --registry omitted -> usage error exit 2
(DIR-120-B: no more guessed default)`.

### `drivable-workspace-check.test.mjs` — the out-of-`scripts/test.sh`-glob file, run directly
```
$ node --test experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs
ℹ tests 27
ℹ suites 0
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### `plugin/test/plugin-packaging.test.mjs` — exp5-label-leak test re-run, confirmed unaffected by
the symlink conversion (all 34 tests in the file, not just the leak one)
```
$ scripts/test.sh plugin/test/plugin-packaging.test.mjs
ℹ tests 34
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
(This run also caught a real self-inflicted regression during implementation: the first version of
the `isDirectInvocation()` fix-comment literally said `` `experiments/quay-perpetual-stream/scripts/`
mirror symlink `` — a leak this same test file's `exp5-label-leak` check correctly flagged. Fixed
by rewording the comment to describe the mechanism generically instead of naming this repo's own
path; re-run went green.)

### Full canonical suite (`scripts/test.sh`, no args) — regression check
Run in full for regression safety; result recorded at commit time (see below — this file's own
`node --test` count matches the individually-listed files above, which are the ones this
milestone's Touches list and AC actually govern).

## Sign-off: `.quay/config.yml`'s `drivable-workspace` gate stays end-to-end-unexercised

```
$ grep -n -A2 "name: drivable-workspace" .quay/config.yml
    - name: drivable-workspace
      script: "./plugin/scripts/drivable-workspace-check.sh"
      argsKey: drivableWorkspaceArgs

$ grep -rl drivableWorkspaceArgs tasks/
(no output — zero real tasks set this key)
```
Explicitly signed off, not a silent omission: no real task in this repo's history sets
`extra.drivableWorkspaceArgs`, so `quay gate --gate drivable-workspace` is never invoked by the
real loop end-to-end. Manufacturing one solely to poke this path is rejected as the same
self-celebratory-fixture pattern this repo's own convention rejects elsewhere (per the task's own
Proposal). The gate is real, wired, and independently proven correct (selftest + the direct test
file above) — just not yet exercised by a real task.

## Files changed

- `plugin/scripts/drivable-workspace-check.ts` (removed `DEFAULT_REGISTRY_PATH`, required
  `--registry`, re-derived `selftest()`, fixed `isDirectInvocation` symlink noop)
- `plugin/scripts/drivable-workspace-check.sh` (usage text)
- `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts` (now a real symlink)
- `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh` (now a real symlink)
- `experiments/quay-perpetual-stream/scripts/select-preflight.ts` (dead import removed)
- `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts` (required `--registry`)
- `experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs` (rewritten, explicit
  registry everywhere)
- `experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs` (explicit registry in
  the 2 `--workspace` CLI tests + 1 new usage-error test — not in the original Touches list, fixed
  under the AC's "own existing tests re-run green" requirement; see Deviation note)
- `tasks/DIR-120-B.md` (`extra.acceptance` set to the it0-dod-check invocation)

`experiments/quay-perpetual-stream/drivable-workspaces.yml` and
`plugin/test/plugin-packaging.test.mjs` were read/verified, not modified (both AC items were
already satisfied without a code change to either).
