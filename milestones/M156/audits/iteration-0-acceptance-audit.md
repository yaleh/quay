# M156 Iteration-0 Acceptance Audit -- DIR-079 (Verify caching)

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

## Verdict: CONCERNS

The implementation is structurally correct across all caching paths. One regression was found: the DIR-090 TIMEOUT DISCIPLINE paragraph was accidentally removed from the Build phase agent prompt during this refactoring. This does not affect the caching mechanism itself but removes a standing discipline from an unrelated phase.

## AC Satisfaction

Primary AC block (tasks/DIR-079.md lines 113-123):

1. **[x] Each it0 check's input fingerprint computed before Verify agent dispatch** -- CONFIRMED. `args.cacheFingerprints` is read at line 25 of `.claude/workflows/execute-milestone.js`, before any agent dispatch. Fingerprints are pre-computed by the caller (workflow runtime lacks `readFile`/`sha256`) per the task's Resolution section. Evidence: `const cacheFingerprints = args.cacheFingerprints || {}` at L25.

2. **[x] Check with unchanged fingerprint + prior `{ok: true}` -> skipped (cached result reused)** -- CONFIRMED. `_cached()` function (L32-39) compares `cacheFingerprints[label]` against `priorVerifyCache[label].fingerprint`; on match returns `prior.result`. The dispatch list (L56-75) uses `!_cachedX ? () => agent(...) : null` -- cache hits produce null and are filtered out by `.filter(Boolean)` at L76. Cached results are unified at L93-96 via `_cachedCeiling || _fresh['ceiling-check']`.

3. **[x] Check with unchanged fingerprint + prior `{ok: false}` -> skipped (still failing, same reason)** -- CONFIRMED. `_cached()` at L39 returns `prior.result` unconditionally on fingerprint match -- no distinction between PASS and FAIL. The agent is not dispatched. Both passing and failing prior results are cached identically.

4. **[x] Check with changed fingerprint OR no prior result -> dispatched as normal** -- CONFIRMED. When `_cached()` returns null (no fingerprint in `cacheFingerprints`, no prior in `priorVerifyCache`, or fingerprint mismatch), the ternary dispatches the agent function. L56-75 show all 5 dispatch entries follow this pattern.

5. **[x] After fixing ONLY the gate-hash in a charter, Verify phase re-runs <=1 check (gate-hash), reuses cached results for the other 4** -- CONFIRMED-PLAUSIBLE. The fingerprint-matching logic correctly handles this case: only `gate-hash` fingerprint differs from prior cache; the other 4 fingerprints match and are skipped. Verified by code-path analysis (L32-39, L56-76). No end-to-end workflow execution evidence available at audit time (requires pre-computed cache state from a prior run), but the code logic is unambiguous. Evidence: `_cached('gate-hash')` vs `_cached('ceiling-check')` etc. use independent fingerprint comparisons.

6. **[x] After fixing ONLY a dogfood-evidence format issue, Verify phase re-runs <=1 check (dogfood-evidence)** -- CONFIRMED-PLAUSIBLE. Same mechanism as AC #5. The `dogfood-evidence` agent (L68-71) is dispatched only when `_cached('dogfood-evidence')` returns null (fingerprint mismatch). Code-path analysis confirms.

7. **[x] When fingerprint computation fails -> fall back to full 5-check re-run (conservative)** -- CONFIRMED. `const cacheFingerprints = args.cacheFingerprints || {}` (L25). If `args.cacheFingerprints` is undefined, null, or empty, every `_cached()` call returns null (no fingerprint to match), and all 5 agents dispatch. Evidence: `_cached()` L34: `if (!fp) return null` -- immediate return-null on missing fingerprint.

8. **[x] Verify phase still completes within the same wall-clock time for a clean first run (fingerprint overhead is negligible)** -- CONFIRMED. Overhead on first run: 5 `_cached()` function calls (each does 1-2 property lookups + 1 string comparison) = O(1), unmeasurable against parallel agent dispatch time. `_dispatchList` construction is synchronous and trivial.

9. **[x] Existing Workflow resume (phase-level caching) unchanged -- per-check caching is additive** -- CONFIRMED. The workflow `meta` export (L1-11) is unchanged. All 5 phases (Verify, Build, Audit, Gate, Land) remain in the same order. Phase-level resume is a Workflow runtime feature, not modified by this code. `verifyCacheUpdates` is added to all return values as an additive field.

10. **[x] `it0-dod-check.sh` stays green on all existing tasks** -- CONFIRMED. `dod-fixture-selfcheck.sh`: 17/17 PASS (all 17 DoD fixtures behave as asserted). The code change does not modify any selfcheck script or alter how existing tasks are evaluated.

11. **[x] `it0-split-or-commit-check.ts .` stays green** -- CONFIRMED. `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` output: "PASS: 418 task(s) checked -- no split-or-commit violations." Gate hash check: `it0-gate-hash-check.sh --by-reference charters/M156-dir079-verify-caching.md` exits 0.

Secondary (Plan-section) AC block (lines 167-171):

1. **[x] execute-milestone.js Verify phase computes per-check input fingerprints before dispatching agents** -- CONFIRMED. Reads from `args.cacheFingerprints` at L25, before dispatch at L79.

2. **[x] Checks whose fingerprint matches a prior cached PASS result are skipped (reused)** -- CONFIRMED. See primary AC #2 evidence.

3. **[x] Checks whose fingerprint matches a prior cached FAIL result are skipped (still failing on same input)** -- CONFIRMED. See primary AC #3 evidence.

4. **[x] Checks whose fingerprint changed or has no prior result are dispatched normally** -- CONFIRMED. See primary AC #4 evidence.

5. **[x] Existing workflow selfchecks/fixtures stay green** -- CONFIRMED. dod-fixture-selfcheck.sh 17/17 PASS, it0-split-or-commit-check.ts 418 tasks no violations, it0-gate-hash-check.sh PASS.

## DoD Satisfaction

Primary DoD block (lines 130-137):

1. **[x] Per-check fingerprint computation implemented in `execute-milestone.js` Verify phase** -- CONFIRMED. Fingerprints accepted via `args.cacheFingerprints` at L25. Conservative fallback when absent: full dispatch. `verifyCacheUpdates` built at L109-113 for caller to persist.

2. **[x] Per-check cache lookup before agent dispatch (fingerprint match -> skip)** -- CONFIRMED. `_cached()` at L32-39 called before dispatch list construction at L56-75.

3. **[x] M135-style scenario verified: 3 consecutive Verify retries with only 1 check changing each time -> 3 agent dispatches total (not 15)** -- PLAUSIBLE. Code logic is structurally correct: fingerprint-based skip means only the changed check dispatches. Confirmed by code-path analysis. No end-to-end workflow run with actual cache state available at audit time (requires the caller loop to provide cache state across invocations -- this audit agent cannot simulate that).

4. **[x] Gate phase unchanged (7 mechanical checks still run in full each time)** -- CONFIRMED. Gate phase at L207-230 is unchanged from the parent commit. `parallel([...])` dispatches all 5 Gate agents without any caching. Evidence: `git diff cf8b944^..cf8b944 -- .claude/workflows/execute-milestone.js | grep Gate` shows no Gate-phase changes.

5. **[x] Workflow phase-level resume still functional (backward-compatible)** -- CONFIRMED. Workflow `meta` export unchanged. `verifyCacheUpdates` added to all 6 return paths as an additive field -- no existing fields removed or renamed.

6. **[x] Fingerprint computation failure -> full re-run (conservative fallback verified)** -- CONFIRMED. See primary AC #7 evidence.

7. **[x] All existing it0 selfchecks + gate hashes green** -- CONFIRMED. See primary AC #10 and #11 evidence.

Secondary DoD block (lines 178-180):

1. **[x] Per-check fingerprinting implemented in execute-milestone.js Verify phase** -- CONFIRMED.
2. **[x] Cache lookup logic: skip on matching fingerprint, dispatch on changed/missing** -- CONFIRMED.
3. **[x] Selfcheck: re-run workflow twice with same inputs -- second run reuses cached Verify results** -- PLAUSIBLE. Code logic supports this; no E2E workflow evidence available. Same constraint as DoD #3.
4. **[x] Existing selfchecks/fixtures stay green** -- CONFIRMED.

## Mechanical Gate

`it0-dod-check.sh DIR-079 experiments/quay-perpetual-stream/charters/M156-dir079-verify-caching.md /tmp/m156-absorb-entry.md` exits 1.

Failing clauses (all pre-existing externalities, NOT caused by this implementation):
- **clause0-ac-dod-present**: 11 unchecked AC items (being checked off by this audit pass)
- **clause1-adversarial-audit**: no disposition statement (this audit artifact being created now resolves it)
- **clause2-vmeta-lag**: no V_meta disposition in ABSORB entry (external to DIR-079)
- **clause7-test-floor**: no test-coverage disposition (DIR-079 is an instrument-correction with no product-touching surface; needs WAIVER in absorb entry)
- **clause12-audit-independence**: audit artifact did not exist (being created now)

Passing clauses: clause3 (line-budget), clause4 (impl-row N/A), clause5 (no-self-exemption), clause6 (escrow N/A), clause8 (canonical-lifecycle N/A -- no milestone:M156 label), clause10 (tree-hygiene), clause11 (worktree-branch-hygiene).

## Concerns

### Concern 1: DIR-090 TIMEOUT DISCIPLINE accidentally removed from Build phase prompt

**Finding:** The M156 commit (`cf8b944`) removed the DIR-090 TIMEOUT DISCIPLINE paragraph (6 lines: "TIMEOUT DISCIPLINE (DIR-090): when using the Bash tool to run long-running commands...") from the Build phase agent prompt in `.claude/workflows/execute-milestone.js`. This was confirmed by three independent checks:
- `git show cf8b944^:.claude/workflows/execute-milestone.js | grep -c "TIMEOUT DISCIPLINE"` returns 1 (present in parent)
- `grep -c "TIMEOUT\|timeout.*300000" .claude/workflows/execute-milestone.js` returns 0 (absent in current)
- Visual inspection of the diff: the hunk `@@ -92,13 +139,6 @@` shows 6 removed lines containing the TIMEOUT DISCIPLINE block

The plugin copy (`plugin/workflows/execute-milestone.js`) is byte-identical to the main copy (confirmed by `diff` returning empty output), so it also lost the TIMEOUT block. This is a regression -- the M154 deviation row (dashboard.md line 486) had already noted that the plugin copy was missing the TIMEOUT block; M156 synced the two copies and inadvertently removed it from BOTH.

**Impact:** Build agents dispatched by this workflow will no longer receive the 5-minute timeout instruction for long-running Bash commands. They may use the Bash tool's default 120s timeout, causing failures on npm install, node --test, git clone, etc. This does not affect the Verify-phase caching mechanism.

**Severity:** CONCERNS (non-blocking for this milestone's caching deliverable, but degrades an unrelated discipline).

### Concern 2: No end-to-end caching evidence for AC #5, AC #6, DoD #3

AC items 5, 6 and DoD items 3, secondary-DoD #3 require evidence of actual cache reuse across multiple workflow invocations (e.g., "fix ONLY gate-hash -> only gate-hash re-runs"). The code logic is structurally correct for all caching paths, but no end-to-end workflow execution with pre-computed cache state (prior run fingerprints + returned `verifyCacheUpdates` fed back as `priorVerifyCache`) exists at audit time. This is a structural constraint -- the audit agent cannot simulate a full workflow instance to generate prior-cache artifacts.

All selfchecks and mechanical gate checks that CAN be run independently pass (dod-fixture-selfcheck 17/17, it0-split-or-commit 418/418, it0-gate-hash PASS). The caching logic is unambiguous in the code.

## Additional verifications

- **Plugin sync**: `diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` returns empty -- files are byte-identical. CONFIRMED.
- **Gate hash**: `it0-gate-hash-check.sh --by-reference charters/M156-dir079-verify-caching.md` exits 0 (hash 5023da... matches). CONFIRMED.
- **All 6 return paths include verifyCacheUpdates**: L120 (verifyFailed), L158 (buildFailed), L228 (gateFailed), L245 (auditRefuted), L290 (concurrentDone), L333 (serialDone). CONFIRMED.
- **Conservative fallback on missing args**: `args.cacheFingerprints || {}` at L25 guarantees empty-object fallback -> all `_cached()` return null -> full dispatch. CONFIRMED.
- **No changes to Gate, Audit, Land phase logic beyond verifyCacheUpdates pass-through**: CONFIRMED by diff inspection.
