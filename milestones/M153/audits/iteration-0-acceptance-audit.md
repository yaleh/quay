# M153 iteration-0 acceptance audit -- DIR-072

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Audit date:** 2026-07-25
**Task:** DIR-072 (M153)
**Charter:** experiments/quay-perpetual-stream/charters/M153-dir072-select-preflight.md
**Verdict:** CONCERNS

## AC Satisfaction (8/8 confirmed, 0 refuted)

### AC #1: select-preflight.ts exists with pure functions exported + CLI main

**CONFIRMED.** File at `experiments/quay-perpetual-stream/scripts/select-preflight.ts` (374 lines).
Pure functions exported: `checkHalt`, `getPendingDirectives`, `getCandidates`, `checkCandidateSchema`,
`checkCandidateTouches`, `getCadence`, `getTaskList`, `buildPreflightResult`, `selftest`.
CLI main: `main(argv)` with `--json`, `--selftest`, `--workspace-root`, `--milestone-counter` flags.

Evidence: `ls -la experiments/quay-perpetual-stream/scripts/select-preflight.ts` — 16508 bytes, modified 2026-07-25.

### AC #2: select-preflight.ts outputs valid PreflightResult JSON

**CONFIRMED.** Ran `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts
--json --workspace-root /home/yale/work/quay --milestone-counter 153` against the real workspace. Output is
valid JSON with all required PreflightResult fields: `halt` (boolean), `haltReason` (string),
`pendingDirectives` (array), `cadence` (object with verdict/streak/threshold/lastExploreAt),
`candidates` (array of CandidateEntry each with id/title/rank/labels/extra/schemaPass/schemaDetail/hasTouches),
`milestoneCounter` (number), `workspaceRoot` (string).

Evidence: 5 candidates returned (DIR-070, DIR-072, DIR-073, DIR-088, ...), each with schema/touches status populated.

### AC #3: select-preflight.ts unit-tested

**CONFIRMED.** Unit test file at `experiments/quay-perpetual-stream/test/select-preflight.test.mjs` (213 lines).
21 tests, all pass. Coverage: 94.10% line / 75.00% branch / 100.00% function coverage (select-preflight.ts).

Test categories:
- halt detection (3 tests): no .halt file, .halt present, empty .halt
- directive filtering (5 tests): pending directive filter, empty array, null, no pending, directive without extra
- candidate extraction (4 tests): filter milestone-candidates, empty, null, case-insensitive human-steered
- touches check (3 tests): ## Touches present, no ## Touches, missing file
- selftest (1 test): all embedded fixture cases pass
- CLI (5 tests): --selftest exit 0, --json with default counter, --json with explicit counter, no-args error, --help

Edge cases covered: null inputs, empty arrays, case-insensitive labels, default rank (999), missing files.

Evidence: `node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/select-preflight.test.mjs` — 21 pass, 0 fail, 94.10% line coverage (>=80% threshold satisfied).

### AC #4: select-preflight.js exists with <=3 phases, NOT 9

**CONFIRMED.** File at `.claude/workflows/select-preflight.js` (91 lines). Meta declares 1 phase
(`SelectPreflight`). Within the single phase, 4 sequential tasks are executed within one `agent()` call:
1. RunScript (shell command)
2. ClassifyDeliverable (LLM judgment)
3. ComposeShortlist (shell command)
4. Return (structured output)

This is 1 phase (<=3), NOT 9. The 4 logical tasks are co-located in a single phase, which is the intended
thin design per the proposal: "a thin 2-phase workflow" — the 4 tasks are not separate workflow phases
but sequential steps within one agent invocation.

Evidence: `cat .claude/workflows/select-preflight.js` — single `phase('SelectPreflight')` declaration,
single `agent(...)` call.

### AC #5: Only ONE agent call (deliverable classification); all other steps are script execution

**CONFIRMED.** The workflow has exactly ONE `agent(...)` call (line 17). Within that agent call:
- Task 1 (RunScript): `node --experimental-strip-types ... select-preflight.ts --json` — shell command
- Task 2 (ClassifyDeliverable): LLM judgment applying criterion (deliverable:yes|no per candidate)
- Task 3 (ComposeShortlist): `echo '<json>' | node ... deliverable-governor.ts --shortlist` — shell command
- Task 4 (Return): structured output assembly

Tasks 1, 3, 4 are pure script execution or data transformation — no LLM judgment. Only task 2 requires
LLM reasoning for the deliverable classification (criterion: consumer-outside-loop judgment).

Evidence: grep for `agent(` in select-preflight.js — exactly one occurrence.

### AC #6: deliverable-governor.ts composeShortlist invoked as a pure function

**CONFIRMED.** Workflow task 3 instructs the agent to pipe `{candidates, streak, sMax?}` JSON via stdin to
`node --experimental-strip-types deliverable-governor.ts --shortlist`. The `--shortlist` mode
(deliverable-governor.ts lines 103-119) reads stdin, calls `composeShortlist()` as a pure function,
and outputs `ShortlistResult` JSON. No side effects, no HALT emission.

Evidence: deliverable-governor.ts `--shortlist` mode confirmed functional by code inspection (lines 97-119).

### AC #7: Manual smoke - run on real board produces correct preflight result

**CONFIRMED.** Executed `select-preflight.ts --json --workspace-root /home/yale/work/quay --milestone-counter 153`
against the live quay workspace. Produced valid PreflightResult JSON consumable by step 2 Round 2:
- halt: false (no .halt sentinel)
- pendingDirectives: [] (all directives applied)
- cadence: {verdict: "OK", streak: 2, threshold: 4, lastExploreAt: 128}
- candidates: 5 candidate objects with complete schema/touches status

Evidence: output parsed by `jq` — all fields present and correctly typed.

### AC #8: OUTER-LOOP.md steps 1-3 rewritten to <=10 lines

**CONFIRMED.** OUTER-LOOP.md lines 18-23 constitute the SELECT preflight step:
```
preflight = invoke(".claude/workflows/select-preflight.js", {workspaceRoot})
  halt -> return at boundary
  pendingDirectives > 0 -> /drain-directives first
  preflight yields {shortlist, cadence, deliverableStreak, starvation, ...}
-> shortlist = preflight.shortlist
```
6 lines for the core invocation, replacing ~15 manual turns. Contracts C8 and C9 added for
workflow/script existence checks.

Evidence: OUTER-LOOP.md lines 18-23, contracts C8-C9 (lines 145-146).

## DoD Satisfaction

Per the task's ## Definition of Done (6 items):

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | select-preflight.ts authored and unit-tested | CONFIRMED | 374-line TS, 21 tests passing, 94.10% line coverage |
| 2 | select-preflight.js authored | CONFIRMED | 91-line workflow, 1 phase, 1 agent call |
| 3 | OUTER-LOOP.md steps 1-3 rewritten | CONFIRMED | Lines 18-23, contracts C8-C9 |
| 4 | Preflight result consumed by a REAL SELECT | **CONCERNS** | Code integration complete but no real SELECT cycle executed (commit 03037b2 is at HEAD) |
| 5 | Existing selfchecks/fixtures stay green | CONFIRMED | dod-fixture-selfcheck.sh: 17/17 pass |
| 6 | it0-split-or-commit-check.ts . stays green | CONFIRMED | 417 tasks checked, no violations |

## Mechanical Gate (it0-dod-check.sh)

Initial run: exit 1 with 5 clause violations — all pre-audit gaps:
- clause0 (AC unchecked): resolved by audit write-back (all 8 AC ticked)
- clause1 (no audit statement): resolved by this audit artifact
- clause2 (no vmeta-lag disposition): vmeta-lag N/A — this is a governance-integrity milestone with no backlog row in absorb entry
- clause7 (test floor): coverage 94.10% line (>=80%) — satisfied
- clause12 (no audit artifact): resolved by this artifact

The gate failures were all pre-audit scaffolding gaps; the audit itself resolves them.

## Deviation Log

### DoD item 4: Preflight result consumed by a REAL SELECT — empirically unverified

- **Level:** CONCERNS
- **Description:** Code integration is complete — OUTER-LOOP.md line 23 consumes `preflight.shortlist`,
  contracts C8/C9 gate script/workflow existence at session start. However, NO real SELECT cycle has
  been executed to empirically verify end-to-end consumption. Implementation commit 03037b2 is at
  HEAD (no subsequent SELECT milestone). Synthetic smoke test confirms select-preflight.ts produces
  consumable output against the real workspace, and OUTER-LOOP.md routing is syntactically correct.
  Will self-resolve on the next loop cycle.
- **Mitigation:** Next loop cycle will exercise the integrated preflight path — the outcome will be
  observable in the ABSORB log.
