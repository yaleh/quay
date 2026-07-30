---
id: gap-prepare-admission-check-plan-files-backtick-asymmetry
title: prepare-admission-check.ts's preflightTouchesMismatch compared a task's
  '## Touches' bullets (backticks stripped) against a Plan Stage's '- Files:'
  entries (backticks NEVER stripped) -- a PlanAuthor that stylistically
  backtick-wraps its Files: line produces a permanent, redispatch-proof
  false preflight-touches-mismatch, found live during real-dispatch
  evidence-gathering for DIR-126-D's REFUTED audit
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs
---
## Proposal

Fix `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`'s (+ `plugin/scripts/`
mirror) `preflightTouchesMismatch()`: the task's own `## Touches` bullets and a checked Plan's
`### Stage N` `- Files:` entries are compared for set-coverage via `_globCoversPath()`, but only
the Touches side had its wrapping backticks stripped (`_extractGlobsFromSection()`); the Plan-Files
side (`parsePlanStages()`'s `.files` field, consumed raw) never had backticks stripped. Add a shared
`_stripWrappingBacktick()` helper and apply it to BOTH sides of the comparison.

## Finding

Discovered 2026-07-30 during real-dispatch evidence-gathering for DIR-126-D's (M203) REFUTED
adversarial acceptance audit — attempting to reach a real `prepared` terminal via a disposable
fixture task (`FIXTURE-M203-PREPARED-PROOF`, deleted) to close AC12 (Receipt real-dispatch-count
evidence). The fixture's `## Touches` list named `` `experiments/quay-perpetual-stream/test/
gate-script-base.test.mjs` `` (clean, single-line, backtick-wrapped — the correctly-formatted
convention this session's own precedent established for `preflight-touches-mismatch` closure,
see commit `28a0a4a` on `tasks/DIR-126-D.md`). A real `prepare-milestone` dispatch
(`wf_15fc949b-db9`) cleared Admission/Preflight/ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor
cleanly (17 real agent dispatches), then failed the Plan-level `--preflight-plan` check with
`preflight-touches-mismatch`, `calibrated:true`, `blocking:true` — even though the exact same path
string was present in both the task's Touches and the Plan's Stage `- Files:` lines.

Root cause, confirmed by direct source read: `_extractGlobsFromSection()`
(`prepare-admission-check.ts`, Touches side) strips a bullet's wrapping backticks
(`if (g.startsWith("\`") && g.endsWith("\`")) g = g.slice(1, -1)`). The Plan-Files side builds
`secondaryGlobs` directly from `parsePlanStages()`'s (`milestone-preparation-check.ts`) `.files`
field with only `.split(",").map((f) => f.trim())` — no backtick stripping at all. The PlanAuthor
agent that generated `docs/plans/M203-PREPARED-PROOF-fixture-m203-prepared-proof.md` chose (a
stylistic, non-deterministic choice — contrast with `docs/plans/M203-dir-126-d.md`'s own Stage 12,
whose `- Files:` line for an analogous case used plain, unquoted paths) to write
`` - Files: \`experiments/quay-perpetual-stream/test/gate-script-base.test.mjs\` `` — backtick-
wrapped. `_globCoversPath("experiments/.../gate-script-base.test.mjs",
"\`experiments/.../gate-script-base.test.mjs\`")` never matches (neither string-equal nor via the
constructed glob regex, since the literal backtick characters are extra content the regex doesn't
account for).

**This defect is redispatch-proof, not a one-off fluke**: since `PreflightPlan`/
`preflight-touches-mismatch` is NOT in `CACHEABLE_TERMINALS`, a fresh `prepare-milestone` dispatch
after this failure goes cold and re-runs `ProposalAuthors`/`Adjudicate`/`ProposalReview`/
`PlanAuthor` from scratch — regenerating a NEW Plan whose `- Files:` backtick-wrapping choice is
independently, non-deterministically re-rolled each time. A milestone unlucky enough to keep
drawing a backtick-wrapping PlanAuthor could fail this check repeatedly across many expensive real
dispatches with no actionable fix available to the human coordinator (editing the CURRENT Plan file
does nothing, since the next PlanAuthor regenerates it).

## Requested action

1. Add `_stripWrappingBacktick(g)` to `prepare-admission-check.ts` (+ `plugin/scripts/` mirror),
   applying the same single-backtick-pair-stripping logic `_extractGlobsFromSection()` already uses.
2. Apply it to `_extractGlobsFromSection()`'s own per-bullet glob (refactor, no behavior change) AND
   to `preflightTouchesMismatch()`'s `secondaryGlobs` construction from `parsePlanStages()`'s
   `.files` field (per comma-separated entry, since a Files: line can list multiple paths, some
   individually backtick-wrapped).
3. Re-verify against the real failing case (the disposable fixture's actual generated Plan, or an
   equivalent fixture) that `--preflight-plan` now returns `{"ok":true,"findings":[]}`.

## Acceptance Criteria

- [x] `_stripWrappingBacktick()` is a single shared helper (`prepare-admission-check.ts` +
  `plugin/scripts/` mirror, `cmp`-confirmed byte-identical), used by BOTH
  `_extractGlobsFromSection()` (Touches side) and `preflightTouchesMismatch()`'s `secondaryGlobs`
  construction (Plan-Files side) — one implementation, not two.
- [x] Regression fixture: a Plan Stage `- Files:` line with a backtick-wrapped path matching a
  plain (post-strip) task `## Touches` bullet is confirmed to pass `preflightTouchesMismatch`
  (previously a false-positive block).
- [x] `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` and
  `plugin/test/prepare-admission-check.test.mjs` (122 tests total) pass unmodified — no regression
  to the existing charter/plan-files mismatch detection.
- [x] Real, non-fixture evidence: re-running `prepare-admission-check.ts --preflight-plan` against
  the actual Plan document that triggered this defect
  (`docs/plans/M203-PREPARED-PROOF-fixture-m203-prepared-proof.md`, generated by real dispatch
  `wf_15fc949b-db9`) returns `{"ok":true,"policyVersion":"preflight-v1","findings":[]}` post-fix.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` (this touches `prepare-admission-check.ts`, a mechanical gate every real
  `prepare-milestone` Plan-phase dispatch runs through — a defect here can silently block ANY
  future milestone's Prepare pipeline, not just this one's disposable fixture).
- [x] Real, non-fixture evidence: the fix was verified against the actual real Plan document that
  surfaced the defect via a genuine `prepare-milestone` dispatch, not merely a hand-written fixture.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
