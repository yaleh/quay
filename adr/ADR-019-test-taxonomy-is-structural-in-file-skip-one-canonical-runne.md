---
id: ADR-019
title: Test taxonomy is structural (in-file skip + one canonical runner), never
  an external exclusion list
status: proposed
date: 2026-07-26
enforcement: "bash scripts/test.sh; node --experimental-strip-types scripts/test-coverage-check.ts"
tags:
  - testing
  - methodology
  - ci
---
## Context

This repo has no documented test taxonomy. The distinction between test kinds — offline
unit/local-integration tests, live-GitHub/conformance tests, packaging e2e, and browser/agent-driven
e2e — exists only as informal filename convention (`live-*`, `*-conformance.test.mjs`) and per-file
docstrings. Nothing mechanically enforces or even records the classification.

Two concrete failures surfaced this in the same session (2026-07-26):

1. **Duplicated, drift-prone exclusion list.** The 3 live/conformance test files
   (`serve-github.test.mjs`, `provider-abi-conformance.test.mjs`,
   `cli-edit-parity-conformance.test.mjs`) are excluded from offline runs by a hand-written
   `grep -vE 'serve-github|provider-abi-conformance|cli-edit-parity-conformance'` pattern —
   written out independently in CLAUDE.md's prose AND in `.github/workflows/ci.yml`'s command.
   Nothing keeps these two copies in sync; a new live-test file added without updating both
   either leaks a live-network call into an offline run or is silently invisible to CI.
2. **A CI blind spot from exactly this class of drift.** The DIR-108 wiring audit (M172,
   2026-07-26) found `plugin/test/plugin-packaging.test.mjs` sitting on `master` with 2 failing
   tests, invisible to `ci.yml`'s test step because its glob (`packages/*/test/*.test.mjs`) never
   matched `plugin/test/`. No external list said "this file exists and should run somewhere" —
   the only source of truth was a human remembering to update the glob, which nobody did.

Separately, quantified profiling of the full local suite (`node --test packages/*/test/*.test.mjs
plugin/test/*.test.mjs`, 80 files, 514 tests, 2026-07-26) found:
- Default concurrency (~3 on a 4-core box): 315.97s wall-clock.
- `--test-concurrency=8`: 283.42s (10.3% faster, 514/514 pass, no flakiness observed across 3
  runs at concurrency 4/8/16).
- `--test-concurrency=16`: 274.81s (13.0% faster than default, only 3% better than 8 — steep
  diminishing returns past ~8 on this hardware).
- `packages/quay/test/cli.test.mjs` alone accounts for 236s inside the full run but only 108.9s
  run in isolation — the gap (~127s) is CPU/disk contention with other concurrently-scheduled
  test files, not the file's own necessary cost. The file is a single un-parallelized script (no
  `node:test` `test()` registrations) making 68 sequential `execFileSync` calls into fresh `node
  bin/quay.ts` subprocesses; it is internally organized into ~10 filesystem-isolated scenario
  blocks (each with its own `mkdtempSync` workspace, no shared `process.env`/`chdir` mutation)
  that are structurally independent and currently forced to run serially by construction, not by
  correctness necessity.

This is the same disease ADR-004 names for prose rules, applied to test infrastructure: the
taxonomy and the run-selection logic are knowledge that lives in a human's head / a doc, not in
an executable, single-sourced form.

## Decision

1. **Classification lives INSIDE the test file, not in an external glob/grep list.** Any test
   that needs network/credentials/external state (live-GitHub, conformance, etc.) declares its own
   skip condition via `node:test`'s `test(name, {skip: <condition>}, fn)` (or a file-level guard
   that sets `process.exitCode` early), gated on a concrete, checkable condition (env var presence,
   a cheap reachability probe) — never on the runner remembering a filename. A default
   `node --test **/*.test.mjs` invocation is then always safe to run offline; opting into the live
   subset is a matter of setting the env var, not knowing which 3 filenames to avoid.
2. **One canonical invocation script, not parallel copies of the same command.** All test
   invocation (local dev, CI) goes through a single runnable script (not an npm script — this repo
   has none, ADR-013/CLAUDE.md's "no build step" plain-ESM stance stands) that owns the file glob
   and the concurrency flag. CLAUDE.md and `ci.yml` both call this script; neither hand-writes its
   own copy of the glob or exclusion pattern again.
3. **`--test-concurrency=8` is the default** for the canonical script, on the measured evidence
   above (10% faster, zero correctness regression across repeated runs). This is a scheduling
   parameter, not a test-semantics change, and is re-measured (not re-guessed) if the CI runner's
   core count changes.
4. **A mechanical taxonomy self-check** verifies every `*.test.mjs` file under any package's
   `test/` directory (or `plugin/test/`) is reachable by the canonical script's glob, and fails
   closed on a new, unmatched test directory — the direct fix for the DIR-108 CI-blind-spot
   failure mode, generalized so it can't recur under a different path next time.
5. **Non-`node:test` "e2e" categories are named as what they are, not folded into the same
   mechanism.** Packaging e2e (`dist-verify-node-floor`-style: build the real tarball, install it,
   run it on the declared Node floor) is a distinct CI job, not a `*.test.mjs` file, and is
   labeled as such. Browser/agent-driven e2e (ADR-010, milestone-cadence, MCP-tool-driven,
   `status: proposed`/`enforcement: deferred`) is documented as a manual/agent process that
   `node --test` does not and will not cover — nobody should read a green test run as proof this
   ran.

## Consequences

- **Forbids:** adding a live/external-dependency test file's exclusion as a hand-written glob/grep
  pattern anywhere outside the file itself; hand-duplicating the test-invocation command in more
  than one place (CLAUDE.md prose and CI config must reference the same script, not restate it).
- **Enables:** a new test file is safe-by-default (included, and skips itself if it can't run
  offline) instead of unsafe-by-default (silently excluded until someone remembers to add it to a
  list) — directly closes the failure class the DIR-108 audit found.
- **Landed (M173/DIR-109):** items 1-3 are implemented — `scripts/test.sh` is the canonical
  invocation script (`enforcement` field above), the 3 live/conformance files
  (`serve-github.test.mjs`, `provider-abi-conformance.test.mjs`,
  `cli-edit-parity-conformance.test.mjs`) each declare their own in-file `node:test` skip
  condition (opt-in via `QUAY_TEST_LIVE_GITHUB=1`), and both `CLAUDE.md` and
  `.github/workflows/ci.yml` reference the script instead of restating the glob/exclusion.
- **Does not yet enable:** item 4 (the mechanical taxonomy self-check that fails closed on a new,
  unmatched test directory) is tracked separately as DIR-110/M174 — depends on `scripts/test.sh`
  existing, per this ADR's own Decision #4 and the directive's own scope note.
- **Scope / relations:** concretizes ADR-004 (hard over soft) and ADR-003 (form-vs-substance) for
  the specific domain of test infrastructure; the taxonomy self-check (item 4) is a direct
  instance of ADR-018's selfcheck-fixture pattern applied one level up (checking that gates/tests
  themselves are wired, not just that they pass when run).