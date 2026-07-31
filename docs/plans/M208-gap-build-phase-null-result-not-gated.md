# Plan: M208 -- Build-phase null-result gate

**Milestone:** M208  
**Task:** `gap-build-phase-null-result-not-gated`  
**Charter:** `experiments/quay-perpetual-stream/charters/M208-gap-build-phase-null-result-not-gated.md`  
**Base revision:** `28c3822`  
**Classification:** defect-fix (code + test)  
**Risk:** low -- surgical gate-change (net +3 lines per mirror -- the if-block grows from 3 lines to 6) + regression fixture; no change to `agent()` contract, Build prompt, or downstream phases.

## Touch set

| File | Role | Pre-existing | Line budget |
|---|---|---|---|
| `.claude/workflows/execute-milestone.js` | Apply positive-outcome gate at lines 273-277 | 508 lines | replace 3-line if-block (275-277: if/return/`}`) with 6-line if-block (275-280: if/const reason/?/:/return/`}`) -- net +3 |
| `plugin/workflows/execute-milestone.js` | Identical change (mirror) | 508 lines | replace 3-line if-block (275-277) with 6-line if-block (275-280) -- net +3 |
| `plugin/test/execute-milestone-build-phase-gate.test.mjs` | New regression test fixture | new file | ~220 lines |
| `plugin/test/execute-milestone-preparation-gate.test.mjs` | Existing regression test, run as a GREEN-compatibility check in Stage 4/5 -- NOT edited | 293 lines | 0 (unmodified, exercised read-only) |
| `plugin/test/prepare-milestone-preparation-e2e.test.mjs` | Existing regression test, run as a GREEN-compatibility check in Stage 4/5 -- NOT edited | pre-existing | 0 (unmodified, exercised read-only) |

Total line delta: ~+225 (new test file) + 6 net across both mirrors (+3 per mirror, gate logic) = **~+231 total**. No new `agent()` dispatches, no new phases, no prompt or schema changes. The two existing regression-test files are touched per the task's own `## Touches` declaration (they gate Stage 4/5 GREEN-compatibility) but carry zero line delta -- they are exercised unmodified, never edited.

## Dependencies

- None -- this is a standalone defect fix. The two mirror files share no import relationship; editing both is the established mirror-maintenance pattern (documented in the file's own `IMPORTANT: mirror` comment at line 1).
- The new test fixture depends on the same `loadWorkflow` + mock-`agent()` harness used by `plugin/test/execute-milestone-preparation-gate.test.mjs` (293 lines, DIR-117), which already exists and passes.
- **Human-steered** per the task's own DoD (touches `.claude/workflows/execute-milestone.js` -- a driver execution-chain script).

## AC coverage map

| AC | Summary | Stage |
|----|---------|-------|
| 1 | Positive gate in both mirrors; RED/GREEN fixtures prove null/undefined returns `needs-human` with `reason: 'build-agent-no-result'` | 2, 3, 4 |
| 2 | Gate rejects any non-`'done'` outcome, grep-confirmable in both mirrors | 3, 5 |
| 3 | Regression test simulates M192 null scenario; real test output pasted | 2, 4, 5 |
| 4 | Separate fixtures for `undefined`, unknown outcome, schema-invalid `outcome: 'done'` | 2, 4 |
| 5 | Static call-path inspection covers singleton + composite/concurrent Build gates | 1, 5 |
| 6 | Existing `execute-milestone-preparation-gate.test.mjs` / `prepare-milestone-preparation-e2e.test.mjs` pass unchanged | 4 |

Note: the task's `## Acceptance Criteria` checklist has exactly 6 items (indices 1-6 above); "zero new `agent()`/`parallel()`/`dispatch()` calls" is a diff-minimality property called out in the task's own Proposal (Non-goals item 8) as code-review-time, not AC-gated -- it is still verified mechanically as an exit check in Stage 3 (check 5) and Stage 5 (check 2-3), just not tracked as a separate AC index.

## Stages

### Stage 1: Structural audit -- confirm call-path and scope
- AC: 5
- Files: .claude/workflows/execute-milestone.js, plugin/workflows/execute-milestone.js
- Command: `grep -n 'buildResult' .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` -- confirm exactly one declaration (`const buildResult = await agent(` at line 229), exactly one gate block (lines 273-277), and that the `IS_CONCURRENT` branch (line ~407) forks only the Land phase (references `buildResult?.mergeCommit` but does NOT dispatch a separate Build agent). Also confirm `buildResult` does not appear in any other guard condition. Expected exit: all structural claims from the proposal confirmed -- the gate is the sole Build result check in the file.

**Stage type:** prose (audit). No code changes.

### Stage 2: RED -- Write regression test fixture
- AC: 1, 3, 4
- Files: plugin/test/execute-milestone-build-phase-gate.test.mjs
- Command: `node --experimental-strip-types --test plugin/test/execute-milestone-build-phase-gate.test.mjs`

**Test harness design** (mirrors the existing `execute-milestone-preparation-gate.test.mjs` pattern):
- `loadWorkflow()` loads the real, unmodified source from both `.claude/workflows/` and `plugin/workflows/` mirrors (only the `export` keyword stripped; every other character of production logic executes as-is).
- `makeAgentMock()` returns `null` for the Build phase (simulating a terminally-errored `agent()` call -- the M192 scenario) and throws on any unexpected call (proving no Audit/Gate/Land agent is dispatched after a null Build result).
- Verify-phase labels return stub success so control flow reaches the Build gate.

**Test cases (one per `[mirrorName]`, over both mirrors):**
1. **Null Build result (AC3):** `agent()` returns `null` for Build phase. Assert `{ outcome: 'needs-human', reason: 'build-agent-no-result', phase: 'Build' }`. The mock throws on any non-Verify/non-Build agent call, proving zero Audit/Gate/Land dispatch.
2. **Undefined Build result (AC4):** `agent()` returns `undefined` for Build phase. Assert `{ outcome: 'needs-human', reason: 'build-agent-no-result', phase: 'Build' }`. Same zero-dispatch proof.
3. **Unknown outcome string (AC4):** `agent()` returns `{ outcome: 'stale' }` for Build phase. Assert `{ outcome: 'needs-human', reason: 'build-outcome-not-done', phase: 'Build' }`. The agent's reason field is falsy, so the default fallback fires.
4. **Schema-invalid `outcome: 'done'` (AC4, boundary):** `agent()` returns `{ outcome: 'done' }` (missing `taskId`, `iterationCount`, `mergeCommit`). Assert `{ outcome: 'needs-human', reason: 'test-short-circuit-after-build', phase: ... }` -- the gate does NOT block this case (outcome IS `'done'`), so the mock's Build-phase short-circuit sentinel reaches the test. This documents the current scope boundary (full schema validation is a non-goal).

**RED expectation:** tests 1-3 fail against the current, unmodified gate -- it only rejects the literal `'needs-human'` string, so null/undefined/unknown-outcome Build results all pass through to the mock's unexpected-call throw, proving the gap Stage 3 fixes. Test 4 is different in kind, not degree: for input `{ outcome: 'done' }`, the OLD condition (`outcome === 'needs-human'`) and the Stage-3 NEW condition (`outcome !== 'done'`) evaluate identically -- both let it pass through the Build gate unchanged. Test 4 therefore does NOT exercise the Stage-3 code diff at all; whether it is RED or GREEN at this point in the Plan depends entirely on whether the Stage-2 test harness's mock `agent()` has an Audit-phase short-circuit stub wired up to catch the boundary case, which is a test-authoring completeness concern, not a production-code gap. Stage 2 must write that stub so test 4 passes both before and after Stage 3's gate change -- it is a scope-boundary fixture (documenting Non-goals item 8's schema-invalid-`'done'`-passes-through behavior), not a regression test for the Stage-3 diff. Stage succeeds when RED output confirms tests 1-3 fail against the unmodified gate and test 4 already passes (via the harness's short-circuit stub, independent of the gate condition).

**Stage type:** code.

### Stage 3: Implementation -- Apply positive-outcome gate to both mirrors
- AC: 1, 2
- Files: .claude/workflows/execute-milestone.js, plugin/workflows/execute-milestone.js
- Command: `grep -A3 'Build phase complete' .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` (before and after)

**Change (both mirrors, lines 273-277):**

Before:
```js
  log(`Build phase complete: outcome=${buildResult?.outcome}`)

  if (buildResult?.outcome === 'needs-human') {
    return { outcome: 'needs-human', reason: buildResult?.reason || 'build-failed', phase: 'Build', verifyCacheUpdates }
  }
```

After:
```js
  log(`Build phase complete: outcome=${buildResult?.outcome}`)

  if (buildResult?.outcome !== 'done') {
    const reason = !buildResult
      ? 'build-agent-no-result'
      : (buildResult.reason || 'build-outcome-not-done')
    return { outcome: 'needs-human', reason, phase: 'Build', verifyCacheUpdates }
  }
```

**Exit checks:**
1. `grep 'outcome !== .done.'` matches exactly once per mirror file.
2. `grep 'outcome === .needs-human.'` matches zero times across both mirrors (old negative-whitelist removed).
3. `grep 'buildResult'` count is unchanged (same references, same lines except the gate block).
4. `diff` between the two mirrors' gate blocks (lines 273-280) is empty (byte-identical).
5. No new `agent(`, `parallel(`, or `dispatch(` appeared in the diff.

**Stage type:** code.

### Stage 4: GREEN -- Run new regression test + existing tests
- AC: 1, 3, 4, 6
- Files: plugin/test/execute-milestone-build-phase-gate.test.mjs, plugin/test/execute-milestone-preparation-gate.test.mjs, plugin/test/prepare-milestone-preparation-e2e.test.mjs
- Command: `scripts/test.sh plugin/test/execute-milestone-build-phase-gate.test.mjs plugin/test/execute-milestone-preparation-gate.test.mjs plugin/test/prepare-milestone-preparation-e2e.test.mjs`

**Expected exit:**
- New regression test (Stage 2): all test cases GREEN -- null returns `needs-human` with `reason: 'build-agent-no-result'`, undefined same, unknown outcome returns `build-outcome-not-done`, schema-invalid `outcome:'done'` passes through (boundary documented).
- `execute-milestone-preparation-gate.test.mjs`: all tests pass unchanged. The Build short-circuit sentinel `{ outcome: 'needs-human', reason: 'test-short-circuit-after-build', taskId: 'reached-build' }` has `outcome: 'needs-human'` which is `!== 'done'` -- the new gate triggers, `buildResult.reason` (`'test-short-circuit-after-build'`) is truthy, so the reason is forwarded. Assertions `result.outcome === 'needs-human'` and `result.reason === 'test-short-circuit-after-build'` preserved.
- `prepare-milestone-preparation-e2e.test.mjs`: all tests pass unchanged (does not exercise the Build-phase gate).

**Real test output capture:** stdout of the test run is captured verbatim and pasted into the commit message body (AC3 requirement -- "real test output pasted, not asserted").

**Stage type:** code.

### Stage 5: Landing -- Final verification, grep, commit
- AC: 1, 2, 3, 4, 5, 6
- Files: .claude/workflows/execute-milestone.js, plugin/workflows/execute-milestone.js, plugin/test/execute-milestone-build-phase-gate.test.mjs
- Command: `scripts/test.sh` (full suite), then `git diff --stat` + `git commit`

**Exit checks:**
1. Full test suite green (including the new regression test, all existing tests).
2. Re-run Stage 1 grep confirmations -- structural claims still hold.
3. Re-run Stage 3 grep confirmations -- gate condition is `!== 'done'` in both mirrors.
4. Real test output from Stage 4 captured in commit message body.
5. Commit message format: `M208: positive-outcome Build-phase gate + regression test for null-result path` with body including the real test output.

**Stage type:** prose + code (commit).

## Guardrails

- **Rollback:** revert the commit. The fix is a 2-line gate condition change per mirror -- no schema migration, no data migration, no API change. Rollback is a single `git revert`.
- **Forward compatibility:** any new Build-agent outcome string (e.g. `'stale'`, `'partial'`) added in the future fails closed with `reason: 'build-outcome-not-done'` until the gate is explicitly updated. This follows the Prepared phase's own pattern (`preparedResult.ok !== true`).
- **No Audit-phase creep:** the Audit phase has the same structural vulnerability (`auditResult` null flows through), but its resolution requires a distinct design (partial-state recovery) and is explicitly out of scope (non-goal #2 in the task Proposal). This Plan does not expand to cover it.
- **No Build-agent retry logic:** a transient `agent()` error returns `needs-human` -- the human or OUTER-LOOP decides whether to re-dispatch. Automatic retry is a non-goal (#3).
- **Human-steered landing:** per the task's DoD ("Because this touches `.claude/workflows/execute-milestone.js` ... resolving it must run under human-steered discipline"), the commit must be reviewed by a human before landing on `master`. The test fixture provides mechanical verification; human review provides qualitative confirmation.

## Stopping rule

At most 3 Plan-check rounds. Success only at F_i = 0 (the preparation checker's iterative refinement cycle). If the Plan reaches 3 rounds with F_i > 0, mark the task `needs-human` with the accumulated findings.

## Real-landing verification

After the gate fix lands, verify by dispatching M208 itself through `execute-milestone` (or a lightweight test dispatch). The Build phase must return `{ outcome: 'done', ... }` -- structural confirmation that the new gate does not block a legitimate Build. Additionally, verify the Land phase still correctly receives `buildResult?.mergeCommit` by inspecting the Land agent's prompt (should NOT contain `Build outcome: null`).
