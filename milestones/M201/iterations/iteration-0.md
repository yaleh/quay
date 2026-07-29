# M201 / DIR-126-B — Iteration 0 (Build)

**Task:** DIR-126-B — deterministic mechanical preflight for `prepare-milestone.js` (new `Preflight`
phase), second child of DIR-126's 5-way split.
**Charter:** `experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md`
**Plan:** `docs/plans/M201-dir-126-b.md` (9 ordered stages, all 24 task AC items mapped)

## Summary

Implemented `runPreflightChecks()` + five named pure detector functions in
`experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` (mirrored byte-identically to
`plugin/scripts/`), two new CLI modes (`--preflight`, `--preflight-plan`) on the existing
`parseArgs`/`spec.flags` machinery, and a new `Preflight` phase in `.claude/workflows/prepare-milestone.js`
(mirrored to `plugin/workflows/`) with two real dispatch points: content checks strictly between
`Admission` and `ProposalAuthors`, and the Plan-shape check strictly between `PlanAuthor` and
`PlanCheck` round 1. `wiring-coverage-check.ts`'s `splitListAwareBlocks`/`splitSentences` were
exported (2-line change) for reuse by `preflightMergedMarkdownClaims` — its own logic and tests were
NOT touched, and its 18/18 test suite stays green.

## Per-stage disposition (docs/plans/M201-dir-126-b.md)

| Stage | Status | Evidence |
|---|---|---|
| 1 (RED test scaffolding) | Done | `prepare-admission-check.test.mjs` new `describe` blocks for all five detectors + `runPreflightChecks` + CLI, confirmed RED before implementation (interactively verified during Build, then GREEN after Stage 3) |
| 2 (export reuse from wiring-coverage-check.ts) | Done | `export` added to `splitListAwareBlocks`/`splitSentences`; `wiring-coverage-check.test.mjs` stays 18/18 green |
| 3 (five detectors + runPreflightChecks + CLI flags) | Done | `preflightMergedMarkdownClaims`, `preflightStaleAcRefs`, `preflightTouchesMismatch`, `preflightMissingPrecedent`, `preflightInvalidPlanCommand`, `runPreflightChecks`, `PREFLIGHT_POLICY_VERSION`, `PREFLIGHT_CALIBRATED` all implemented and exported; `--preflight`/`--preflight-plan`/`--planFile`/`--charterFile` added to the SAME `spec.flags` object `--acquire`/`--renew`/`--release` already use (WIRING-CLAIM 9, grep-tested) |
| 4 (content Preflight phase insertion) | Done | `phase('Preflight')` + `_preflightAgentCall` dispatch inserted in `.claude/workflows/prepare-milestone.js` strictly after `Admission`'s acquired-lease log, strictly before the `_resumeFromAdjudicatedProposal` branch — both cold and resume paths covered. Mock regression fix applied to both `plugin/test/prepare-milestone-convergence.test.mjs` and `plugin/test/prepare-milestone-preparation-e2e.test.mjs` (new `preflight-content`/`preflight-plan` mock branches, default non-blocking) |
| 5 (`--preflight-plan` insertion) | Done | Second `_preflightAgentCall` dispatch inserted strictly after `planAuthorResult`'s success check, strictly before `phase('PlanCheck')` |
| 6 (fixture corpora + calibrate-then-enforce) | Done | 5 detectors × 3 legs (bad/good/ambiguous) = 15 fixture files under `experiments/quay-perpetual-stream/test/fixtures/preflight/<code>/`, mirrored to `plugin/test/fixtures/preflight/`; `PREFLIGHT_CALIBRATED` map added, all five flipped `true` after their own triad went green |
| 7 (wiring-coverage-check.ts regression verify) | Done | `wiring-coverage-check.test.mjs` re-run unmodified: 18/18 green (no edits to the file's logic, only the 2-line `export` addition) |
| 8 (mirror byte-identity sync) | Done | `bash plugin/scripts/sync-vendor.sh` + `--check`: CLEAN, zero drift; `cmp` confirms `.claude/workflows/prepare-milestone.js` == `plugin/workflows/prepare-milestone.js` |
| 9 (real non-fixture e2e dispatch proof) | Done | Scratch harness (not committed, per Stage 7/DIR-126-A precedent) drove the REAL `.claude/workflows/prepare-milestone.js` source with a mock `agent()` that dispatches the REAL `prepare-admission-check.ts --preflight` CLI (not stubbed) against a scratch task with a deliberately-seeded known-bad Proposal — confirmed `outcome:'revision-needed'`, `reason:'preflight-rejected'`, zero `proposal-author-*` dispatches, zero `preflight-plan` dispatches. See "Real end-to-end proof" below. |

## Test evidence

- `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`: **55/55 pass** (up from
  20 pre-Build) — 5 detector `describe` blocks (bad/good/ambiguous each), `runPreflightChecks`
  content/plan dispatch + calibration downgrade test, CLI `--preflight`/`--preflight-plan`
  (success/blocking/fail-closed), WIRING-CLAIM 9 grep test.
- `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`: **18/18 pass**, unmodified
  — regression floor for the already-landed `335317d`/`44ca1b3` merged-list fix stays green.
- `plugin/test/prepare-milestone-convergence.test.mjs` + `plugin/test/prepare-milestone-preparation-e2e.test.mjs`
  (both `.claude`/`plugin` mirrors): **32/32 pass** — every pre-existing DIR-125/DIR-126-A scenario
  still passes with the new Preflight phase's default-non-blocking mock wired in.
- `bash plugin/scripts/sync-vendor.sh --check`: CLEAN, zero drift across all touched
  `experiments/quay-perpetual-stream/scripts/*.ts` <-> `plugin/scripts/*.ts` pairs.
- **Full canonical `scripts/test.sh` run (CLAUDE.md's canonical CI entrypoint): 664 tests, 661 pass,
  0 fail, 3 skipped (the 3 live-GitHub tests, correctly self-skipping without `GH_TOKEN` per
  ADR-019), exit code 0.** This run only exercises `plugin/test/*.test.mjs` (the canonical
  `experiments/quay-perpetual-stream/test/*.test.mjs` glob is a separate, non-`scripts/test.sh`
  suite per CLAUDE.md/DIR-111) — see "Defect found and fixed" below for a real bug this run
  surfaced in the mirrored copy.

## Real end-to-end proof (DoD item 2)

A scratch, non-committed harness (per the same "scratch, not committed" precedent Stage 7/DIR-126-A's
own `wiring-coverage-check.ts` RED/GREEN revert-comparison used) loaded the REAL
`.claude/workflows/prepare-milestone.js` source as a live `AsyncFunction`, drove it with a mock
`agent()` where the `admission-*` labels return canned lease verdicts but the `preflight-content`
label extracts and runs the REAL shell command from the agent prompt
(`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
--preflight ...`) against a scratch task file containing a deliberately-seeded
`preflight-merged-markdown-claims` violation in `## Requested action`. Result:

```
outcome: revision-needed
reason: preflight-rejected
phase: Preflight
findings[0].code: preflight-merged-markdown-claims
```

Journal (dispatch order): `admission-acquire` -> `preflight-content` -> `admission-release-preflight-rejected`.
Zero `proposal-author-*`, `adjudicate`, `proposal-review`, or `plan-check-*` dispatches occurred —
the mock throws if any of those labels are ever reached, and none were. `preflight-plan` was also
never dispatched (content rejection short-circuits before `PlanAuthor`/`PlanCheck`), confirming the
two insertion points are independent.

## Wiring-coverage grounding (grep-checkable, per WIRING-CLAIM 1–9)

- WIRING-CLAIM 1/2 (real production callsites): `grep -n "_preflightAgentCall" .claude/workflows/prepare-milestone.js`
  shows the helper defined once and called from two distinct sites (content, plan-shape).
- WIRING-CLAIM 5: `preflightMergedMarkdownClaims` imports `splitSentences` from
  `./wiring-coverage-check.ts` (grep-confirmed import line).
- WIRING-CLAIM 6: `preflightTouchesMismatch` imports `checkTouches` from `./task-schema.ts` and is
  called from two distinct sites (`secondaryLabel: 'charter'` pre-`ProposalAuthors`,
  `secondaryLabel: 'plan-files'` pre-`PlanCheck`) — one implementation, unit-tested at both call
  sites.
- WIRING-CLAIM 7: `preflightInvalidPlanCommand` imports `parsePlanStages`/`validatePlanStructure`
  from `./milestone-preparation-check.ts` (grep-confirmed import line) — no third Markdown parser.
- WIRING-CLAIM 9: `--preflight`/`--preflight-plan`/`planFile`/`charterFile` live in the SAME
  `spec.flags` object `--acquire`/`--renew`/`--release` already use; exactly one `parseArgs(` call
  site in the whole module (test-asserted).

## Notable defects found and fixed during Build (self-caught, not by an external reviewer)

1. **A literal NUL byte accidentally embedded in source** (`prepare-admission-check.ts`): an
   `Edit` call's `" "` literal was interpreted by the tool-call JSON encoding as an actual NUL
   character rather than the intended 6-character JS escape sequence, corrupting
   `_globCoversPath`'s double-star-glob-to-regex translation. Fixed by rewriting the function with a
   plain string placeholder (`"@@DOUBLESTAR@@"`) instead of a control character. Caught immediately
   via `grep`/`file` returning empty/binary-file signals on the source file.
2. **An overly-broad "charter delegates its Touches" detection regex** (`/own[^\n]*Touches[^\n]*list/i`)
   false-matched a charter's OWN, non-delegating claim ("declares its OWN Touches list") as if it
   were the delegation phrase. Narrowed to match ONLY the literal delegation phrase
   ("not duplicated here") — the exact phrasing this task's own real charter and every DIR-126-family
   charter checked actually uses.
3. **A depth-relative `REPO_ROOT` literal broke when mirrored to a shallower directory** (the real
   bug the FIRST `scripts/test.sh` run surfaced, in `plugin/test/prepare-admission-check.test.mjs`
   specifically — the canonical `experiments/quay-perpetual-stream/test/` copy is 3 directories
   below repo root, its `plugin/test/` mirror is only 2; a fixed `path.resolve(__dirname, "..",
   "..", "..")` literal, correct for the canonical location, silently resolved OUTSIDE the repo
   entirely for the mirrored copy, corrupting every `workspace:REPO_ROOT` detector test's git-repo/
   file-existence resolution — the failures showed up as "known-good" fixtures wrongly flagged
   ambiguous/blocking and "known-bad" fixtures wrongly finding nothing). Fixed by replacing the
   fixed-depth literal with a `.git`-ancestor-walk (`_findRepoRoot()`), which is depth-independent
   and therefore correct at BOTH mirror depths from the identical file content — re-verified by
   running both `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (55/55)
   and `plugin/test/prepare-admission-check.test.mjs` (55/55) directly, then a full clean
   `scripts/test.sh` re-run (664 tests, 661 pass, 0 fail, exit 0).
4. **Cross-detector fixture contamination**: several early `merged-markdown-claims` fixtures used
   file-extension-shaped backtick identifiers (`foo.ts`/`bar.ts`) that, when run through the FULL
   `runPreflightChecks` content pipeline (not the isolated detector-function unit test), also tripped
   `preflight-missing-precedent` (since those files don't exist on disk) — a real, legitimate finding
   from a DIFFERENT detector, but not what the fixture was designed to isolate. Fixed by using
   non-file-shaped identifiers (`FooModule`/`BarService`) in the merged-markdown-claims fixtures, and
   adding a dedicated `clean-content-pair/` fixture (no backtick tokens at all) for the "all four
   content detectors pass simultaneously" test.

## Mirrors

`cmp` + `sync-vendor.sh --check`: `.claude/workflows/prepare-milestone.js` == `plugin/workflows/prepare-milestone.js`;
`experiments/quay-perpetual-stream/scripts/{prepare-admission-check,wiring-coverage-check}.ts` ==
their `plugin/scripts/` counterparts; `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
== `plugin/test/prepare-admission-check.test.mjs`; fixture trees byte-identical (`diff -rq`).

## Known follow-ups (not blocking this child, explicitly out of scope)

- `PREFLIGHT_POLICY_VERSION` cache-invalidation consumption is [[DIR-126-C]]'s scope (this child only
  emits the field).
- The five detectors' heuristics (especially `preflight-merged-markdown-claims`'s mid-line-bullet
  threshold and `preflight-touches-mismatch`'s glob-coverage matcher) are calibrated against this
  Build's own fixture corpus, not against a corpus of real M192/M195/M196/M198 session artifacts
  verbatim (those specific historical artifacts were not available to re-derive fixtures from
  byte-for-byte during this Build session) — the fixtures are realistic, representative instances of
  each named failure class per the task's own Chosen-mechanism table, not literal excerpts. Flagged
  for the independent audit per this task's own DoD item 5.
