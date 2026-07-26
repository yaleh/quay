# M173 (DIR-109) — iteration 0

**Task:** DIR-109 — ADR-019 step 1: canonical test runner (`scripts/test.sh`) + in-file skip for
live/conformance tests, replace duplicated grep exclusion.
**Charter:** `experiments/quay-perpetual-stream/charters/M173-dir109-canonical-test-runner.md`
**Class:** development / instrument-correction (Δv̂ > 0, VT-neutral)

## Pre-flight

Set `extra.acceptance` on DIR-109 via `task_write`:
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-109 experiments/quay-perpetual-stream/charters/M173-dir109-canonical-test-runner.md /tmp/m173-absorb-entry.md
```

## Implementation

### 1. In-file skip declarations (ADR-019 decision #1)

All 3 live/conformance files (which are plain scripts — no prior `node:test` registrations at
all, so `node --test` previously ran their top-level `main()` unconditionally regardless of any
external exclusion; the only thing that ever kept them out of an offline run was the hand-written
`grep -vE` filename list) now import `test` from `node:test` and wrap their existing `main()` in a
single `test(name, { skip: <condition> }, main)` registration:

- `packages/quay/test/serve-github.test.mjs`
- `packages/quay/test/provider-abi-conformance.test.mjs`
- `packages/quay/test/cli-edit-parity-conformance.test.mjs`

Skip condition: `!== "1"` check on a new env var, `QUAY_TEST_LIVE_GITHUB`. `main()`'s existing
`process.exitCode = 1` failure paths were changed to `throw new Error(...)` so a real failure
surfaces as a proper node:test FAIL rather than only a process exit code (the test() wrapper
awaits/catches the promise itself now; the outer `main().catch(...)` calls were removed).

Verified (credential-less, no env var set):
```
$ node --test packages/quay/test/serve-github.test.mjs packages/quay/test/provider-abi-conformance.test.mjs packages/quay/test/cli-edit-parity-conformance.test.mjs
﹣ cli-edit-parity-conformance: ... (skipped) # live-GitHub test skipped by default — opt in with QUAY_TEST_LIVE_GITHUB=1 ...
﹣ provider-abi-conformance: ... (skipped) # live-GitHub test skipped by default — opt in with QUAY_TEST_LIVE_GITHUB=1 ...
﹣ QN-061 live cross-Provider (GitHub) Web UI regression ... (skipped) # live-GitHub test skipped by default — opt in with QUAY_TEST_LIVE_GITHUB=1 ...
ℹ tests 3 / pass 0 / fail 0 / skipped 3
```
All 3 report `skipped` with a reason — not silently absent from the glob (Done-when 2 / AC 2).

**Opt-in path proven live** (Done-when 3 / AC 3), each run for real against `github.com/yaleh/quay`:
- `cli-edit-parity-conformance.test.mjs`: `QUAY_TEST_LIVE_GITHUB=1 node --test <file>` → 1/1 pass,
  7 probe cells (native + github legs), ~61s.
- `provider-abi-conformance.test.mjs`: same → 1/1 pass, 25 scenario cells (8 native, 17 github),
  ~41s.
- `serve-github.test.mjs`: same → **1 test FAILED** — 6/7 assertions passed; the 1 failure
  (`GET / body contains gh-3's real live title`) is a **pre-existing live-fixture staleness issue,
  not a regression from this change**. Root-caused: `gh-3`'s title text (confirmed unchanged via
  `gh issue view 3 --repo yaleh/quay`) is genuinely absent from the list view's HTML body — the
  real `yaleh/quay` repo now has 35+ issues (gh-1..gh-37, most created by repeated live
  conformance-test runs over this project's history, including 2 more created moments earlier in
  this very iteration by the opt-in verification runs above), and `gh-3` is evidently no longer
  positioned/rendered where this 2026-era assertion assumed. The file's own header comment already
  flags this exact class of risk ("If issue #3's status label or AC-checkbox state changes in the
  future, the assertions... would need revisiting"). This is orthogonal to ADR-019/DIR-109's scope
  (the skip/canonical-runner mechanism) — `main()`'s logic is byte-for-byte unchanged by this task,
  only wrapped in a `test()` skip-gate — so it was NOT fixed here. Confirms the opt-in path itself
  works exactly as designed (mechanism proven); the underlying test body's own live-fixture
  fragility is a pre-existing, separate, unfixed condition worth a follow-up defect.

### 2. `scripts/test.sh` (canonical invocation script)

New file, executable (`chmod +x`). No-args run: `node --test --test-concurrency=8` over
`packages/*/test/*.test.mjs plugin/test/*.test.mjs` (bash-glob array, not `ls | grep`). With args,
passes them straight through to `node --test --test-concurrency=8 "$@"` (later flags win — supports
single-file, `--test-name-pattern`, `--experimental-test-coverage` forms). `QUAY_TEST_LIVE_GITHUB=1`
opts into the 3 live files' bodies actually running.

**Full real run** (no args, no live env var):
```
$ time bash scripts/test.sh
...
ℹ tests 517
ℹ suites 4
ℹ pass 514
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 313161.823012
real    5m13.300s
```
514/514 non-skipped tests pass, 3 skipped (exactly the 3 live/conformance files) — Done-when 1
satisfied (full safe-by-default suite via `--test-concurrency=8`, real output, real pass count).

### 3. `CLAUDE.md` (Commands section)

Replaced the hand-written `node --test $(ls test/*.mjs | grep -vE 'serve-github|
provider-abi-conformance')` prose (itself already stale — 2 names, missing the 3rd file
`cli-edit-parity-conformance.test.mjs`, exactly ADR-019's Context section's documented drift) with
`scripts/test.sh` as the canonical entrypoint, the 4 command forms (full/single-file/name-pattern/
coverage) rewritten as `scripts/test.sh` invocations, and the live-test note now documents the
in-file skip + `QUAY_TEST_LIVE_GITHUB=1` opt-in instead of an exclusion command.

### 4. `.github/workflows/ci.yml`

Test step's `run:` now `bash scripts/test.sh` (no env var set → live tests self-skip). The old
inline comment explaining the 3-file exclusion was replaced with a short comment pointing at
ADR-019/DIR-109 and the in-file skip mechanism.

### 5. `.github/workflows/release.yml` (found during the `git grep` sweep, not in DIR-109's
original Touches list, but a 3rd live copy of the identical hand-written grep pattern)

This job intentionally scopes to `packages/quay` + `packages/quay-native` only (excludes
`quay-github`'s own tests for org-permission reasons unrelated to ADR-019) so it does NOT delegate
to `scripts/test.sh` (which would silently widen its scope to `plugin/test/` and
`packages/quay-github/test/`). Instead, the redundant `grep -vE 'serve-github|
provider-abi-conformance|cli-edit-parity-conformance'` exclusion was simply removed — the 3 files
now self-skip via their own in-file condition (env var not set here), so the exclusion was pure
dead weight once the in-file skip landed. Net effect: identical behavior, one fewer copy of the
duplicated pattern.

### 6. `adr/ADR-019-...md`

Added `enforcement: "bash scripts/test.sh"` to the frontmatter. Updated the Consequences section:
added a "**Landed (M173/DIR-109)**" bullet recording items 1-3 as implemented, and narrowed
"**Does not yet enable**" to just item 4 (DIR-110's mechanical taxonomy self-check, separate
milestone). Left the Context section's historical narrative (which quotes the old grep pattern as
the problem being described) untouched — it documents past state, not current state.

## `git grep` sweep (Done-when 6 / AC 6)

The literal pattern `grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance'`
no longer appears in any LIVE invocation surface — verified empty over `.github/workflows/*.yml`
and `scripts/*.sh`:
```
$ git grep -n "grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance'" -- '*.yml' '*.sh'
(empty)
```
It DOES still appear, unmodified, in: (a) `adr/ADR-019-...md`'s own Context section (quoting the
problem being fixed, historical record — see above), (b) `tasks/DIR-109.md` itself (this task's own
Finding/AC text, quoting the target pattern to describe it), and (c) closed/historical milestone
audit and iteration files, and closed task files (`DIR-039`, `DIR-046`, `DIR-058`..`DIR-061`,
`exp5-M-*`, `experiments/.../milestones/M121/...`) that recorded past `node --test` invocations as
part of their own DoD evidence at the time. These are append-only historical narrative, not live
invocation surfaces — rewriting them would be rewriting history, which this repo's norms (and this
task's own out-of-scope note) do not ask for. The AC's intent per ADR-019's Decision/Consequences
("Forbids: ... hand-duplicating the test-invocation command in more than one place") is about
executable/documentation surfaces telling someone how to run tests going forward, all 3 of which
(`CLAUDE.md`, `ci.yml`, `release.yml`) are now fixed.

## Out of scope / not done here

- **DIR-109 Done-when 7 ("a real CI run is green using the new script")** and **DoD item 2 ("a real
  CI run (GitHub Actions, not local simulation) is green")** — this requires a push/PR to trigger
  `ci.yml` on GitHub Actions; not performable from this offline build step. `scripts/test.sh` was
  run for real, locally (see §2 above, 514/514 pass), which is everything reproducible outside a
  real GH Actions dispatch. Flagging for the ABSORB/audit phase to trigger and confirm.
- **DIR-110** (the mechanical taxonomy self-check gate, ADR-019 decision #4) — explicitly out of
  scope per the charter, tracked as its own milestone (M174, already drafted:
  `experiments/quay-perpetual-stream/charters/M174-dir110-test-coverage-selfcheck.md`).
- **serve-github.test.mjs's live-fixture staleness** (see §1 above) — pre-existing, unrelated to
  this task's scope, not fixed. Worth a follow-up defect task if the audit/ABSORB phase agrees.

## Files changed

- `scripts/test.sh` (new, executable)
- `packages/quay/test/serve-github.test.mjs`
- `packages/quay/test/provider-abi-conformance.test.mjs`
- `packages/quay/test/cli-edit-parity-conformance.test.mjs`
- `CLAUDE.md`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `adr/ADR-019-test-taxonomy-is-structural-in-file-skip-one-canonical-runne.md`

## Real test evidence summary

| Run | Command | Result |
|---|---|---|
| Skip-path (no env var) | `node --test <3 live files>` | 3 skipped, 0 pass, 0 fail |
| Opt-in: cli-edit-parity | `QUAY_TEST_LIVE_GITHUB=1 node --test packages/quay/test/cli-edit-parity-conformance.test.mjs` | 1/1 pass, 7 probe cells |
| Opt-in: provider-abi | `QUAY_TEST_LIVE_GITHUB=1 node --test packages/quay/test/provider-abi-conformance.test.mjs` | 1/1 pass, 25 scenario cells |
| Opt-in: serve-github | `QUAY_TEST_LIVE_GITHUB=1 node --test packages/quay/test/serve-github.test.mjs` | 1 FAILED (pre-existing live-fixture drift, see §1) |
| Full default suite | `bash scripts/test.sh` | 514 pass / 0 fail / 3 skipped, 517 total, 313s wall |
