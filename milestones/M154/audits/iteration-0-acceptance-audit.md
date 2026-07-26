# M154 iteration-0 acceptance audit -- DIR-073

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Verdict:** REFUTED

## 1. AC Satisfaction

Auditing against the detailed AC (lines 135-155 of tasks/DIR-073.md).

### Refactor Verify phase (item 0)

| # | AC Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | ceiling-check, gate-hash, line-budget are direct shell calls (NOT agent calls) | **REFUTED** | `.claude/workflows/execute-milestone.js` lines 22-52: all 4 mechanical checks run through a single `mechanical-checks` agent that invokes `bash` internally. No direct shell call in the workflow script body. The iteration report acknowledges this as "pragmatic approximation" due to workflow JS runtime lacking Bash tool. |
| 2 | only domain-misfit and dogfood-evidence remain as agents | **REFUTED** | Actual agents: `mechanical-checks` (lines 23-53) and `domain-misfit` (lines 54-57). Dogfood-evidence was consolidated into mechanical-checks as a script -- it is NOT an agent. The agent composition is `mechanical-checks + domain-misfit`, not `domain-misfit + dogfood-evidence` as specified. |
| 3 | `runShellCheck` helper exists in workflow script | **REFUTED** | No `runShellCheck` JS function exists anywhere in `.claude/workflows/execute-milestone.js`. The proposal's helper was abandoned in favor of agent-mediated script execution. |
| 4 | All 5 check results recorded in journal with unified shape `{check, ok, detail, source}` | **CONFIRMED** | Lines 61-67 map results to unified shape. Agents' schemas (lines 49-53, 56) require `{check, ok}` with optional detail/source. Source is set to `"script"` or `"agent"`. |
| 5 | Verify phase wall-clock time reduced from ~5-9 min to ~1-2 min | **UNVERIFIABLE** | Structurally: 5 agents reduced to 2 parallel agents. The mechanical-checks agent runs 4 scripts serially, so wall-clock would be ~2 parallel agent calls rather than 5. Cannot verify empirical timing without running against live milestone. Agent count reduction is confirmed; timing claim is directionally correct but unmeasured. |

### Diagnostic script + workflow (items 1-3)

| # | AC Criterion | Verdict | Evidence |
|---|---|---|---|
| 6 | `diagnose-verify-failure.ts` exists with pure functions + CLI | **CONFIRMED** | File at `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts` (474 lines). Exported functions: `extractDirectiveIds`, `readDirectiveStatus`, `setDirStatusApplied`, `computeGateHash`, `updateCharterHash`, `runDiagnostic`. CLI main at line 390. |
| 7 | Correctly parses workflow journal, handles `source: "script"` and `source: "agent"` | **CONFIRMED** | The `runDiagnostic` function takes `CheckResult[]` input. `classify()` handles all 5 check types. Unit test "handles both source: script and source: agent entries uniformly" passes. |
| 8 | stale-directive detection: extracts directive IDs from charter -> `task_get` -> checks `dirStatus` -> auto-fixes via `task_write` | **PARTIALLY MET** | Functionality works (tested: `extractDirectiveIds`, `readDirectiveStatus`, `setDirStatusApplied` all pass). BUT: uses direct filesystem reads/writes instead of `task_get`/`task_write` MCP calls as stated in AC. The AC explicitly names MCP tools; the implementation bypasses them. |
| 9 | hash-mismatch detection: re-computes hash -> updates charter | **CONFIRMED** | `computeGateHash()` computes SHA256 from pinned ITERATION-PROMPTS.md block. `updateCharterHash()` replaces GATE-HASH-REF line. Unit tests pass (3 tests). |
| 10 | line-budget-exceeded, domain-misfit, dogfood-evidence-gap: included in `unfixable` with detail | **CONFIRMED** | `isAutoFixable()` returns false for all three. They populate `unfixable[]` in `runDiagnostic()`. Tests confirm. |
| 11 | Auto-fixed checks re-verified by re-running the corresponding check as direct script call | **CONFIRMED** | `recheck()` function (line 257) re-runs check scripts via `execSync`. Called for both stale-directive and hash-mismatch auto-fixes. |
| 12 | Unit-tested: journal parsing, stale-directive, hash-mismatch, auto-fix/recheck, edge cases, unified source handling | **CONFIRMED** | 30 tests, 30 pass (verified live). Coverage: extractDirectiveIds (6), readDirectiveStatus (5), setDirStatusApplied (5), updateCharterHash (3), computeGateHash (1), runDiagnostic (10). |
| 13 | `.claude/workflows/diagnose-verify-failure.js` exists with RunScript -> DiagnoseComplex phases (<=2 phases) | **CONFIRMED** | File at `.claude/workflows/diagnose-verify-failure.js` (154 lines). Two phases: RunDiagnostic + conditional DiagnoseComplex. Note: the charter and task body (line 125) requested `.claude/workflows/diagnose-complex.js`; the actual name diverges. The AC (line 152) uses `diagnose-verify-failure.js` which matches the implementation. |
| 14 | Only ONE agent call in the workflow | **PARTIALLY MET** | Two agent calls: RunDiagnostic phase (line 17, always runs) + DiagnoseComplex phase (line 98, conditional). The AC says "only ONE agent call" but there are 2 (one of which is conditional). |
| 15 | Manual smoke: known-failing milestone through execute-milestone -> diagnose-verify-failure -> auto-fixed -> retry succeeds | **REFUTED** | No evidence of any manual smoke test in the iteration report, commit messages, or any other artifact. The iteration report contains no smoke test section. |
| 16 | OUTER-LOOP.md retry block updated | **REFUTED** | OUTER-LOOP.md has no retry block. No `/diagnose-verify-failure` invocation. The `execute` section (lines 72-80) calls execute-milestone with no retry logic for Verify failures. The integration with the outer loop was never wired. |

### Second AC set (lines 185-191) -- cross-check

| # | AC Criterion | Verdict |
|---|---|---|
| S1 | execute-milestone.js Verify phase: ceiling-check, gate-hash, line-budget run as direct Bash calls, NOT as agents | **REFUTED** (same as AC-1 above) |
| S2 | diagnose-verify-failure.ts exists, parses workflow journal JSONL, classifies failure types, outputs structured diagnostic | **PARTIALLY MET** -- script exists and works, but takes pre-extracted JSON arrays, not raw JSONL journal files as stated |
| S3 | diagnose-complex workflow exists: thin 2-phase invocation | **REFUTED** -- file `.claude/workflows/diagnose-complex.js` does not exist. The actual file is `diagnose-verify-failure.js`. |
| S4 | Selfcheck: Verify phase completes with <=2 agents (domain-misfit + dogfood-evidence) | **REFUTED** -- 2 agents exist (`mechanical-checks + domain-misfit`) but not the named agents. Dogfood-evidence is not an agent. |
| S5 | Existing selfchecks/fixtures stay green | **CONFIRMED** -- 30/30 unit tests pass; it0-split-or-commit-check exits 0 |

## 2. DoD Satisfaction

Auditing against the detailed DoD (lines 157-173 of tasks/DIR-073.md).

| # | DoD Criterion | Verdict | Evidence |
|---|---|---|---|
| D1 | execute-milestone.js Verify phase refactored (3 scripts direct, 2 agents) | **REFUTED** | Not 3 direct scripts; 1 agent runs 4 scripts. Agent count is 2, which matches the number but not the described architecture. |
| D2 | runShellCheck helper working in workflow script context | **REFUTED** | No `runShellCheck` function exists. |
| D3 | Unified journal output shape for all 5 Verify checks | **CONFIRMED** | Lines 61-67 unify output. |
| D4 | scripts/diagnose-verify-failure.ts authored and unit-tested | **CONFIRMED** | File exists, 30/30 tests pass. |
| D5 | .claude/workflows/diagnose-verify-failure.js authored | **CONFIRMED** | File exists at 154 lines. |
| D6 | Stale-directive auto-fix demonstrated on a real case | **REFUTED** | No evidence in iteration report, commit messages, or artifacts. |
| D7 | Hash-mismatch auto-fix demonstrated on a real case | **REFUTED** | No evidence. |
| D8 | Complex failure diagnostic demonstrated | **REFUTED** | No evidence. |
| D9 | OUTER-LOOP.md step 4 retry block updated | **REFUTED** | Not updated. Grep confirms no `diagnose`, `retry`, or `/diagnose-verify-failure` in OUTER-LOOP.md. |
| D10 | /execute-milestone retry loop closes autonomously for stale-directive and hash-mismatch failures | **REFUTED** | No integration exists. The OUTER-LOOP.md execute section has no retry logic. |
| D11 | Existing driver selfchecks/fixtures stay green | **CONFIRMED** | 30/30 unit tests pass; it0-split-or-commit-check exits 0. |
| D12 | it0-split-or-commit-check.ts . stays green | **CONFIRMED** | `PASS: 417 task(s) checked -- no split-or-commit violations` |

## 3. Mechanical Gate

```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-073 \
  experiments/quay-perpetual-stream/charters/M154-dir073-verify-diagnostic.md \
  /tmp/m154-absorb-entry.md
```

**EXIT CODE: 1** -- REFUTED by construction.

### Clause failures:

| Clause | Status | Detail |
|--------|--------|--------|
| clause0-ac-dod-present | **FAIL** | 16 AC items remain unchecked (`- [ ]`) in `tasks/DIR-073.md`. The build never wrote back checklist ticks to the task file. |
| clause1-adversarial-audit | **FAIL** | No disposition statement in ABSORB entry (audit artifact didn't exist at time of check). |
| clause2-vmeta-lag | **FAIL** | No disposition statement in ABSORB entry. |
| clause7-test-floor | **FAIL** | No test-coverage disposition or WAIVER line in ABSORB entry. |
| clause12-audit-independence | **FAIL** | Declared audit artifact did not exist on disk at check time. |
| clauses 3,4,5,6,8,10,11 | **PASS** or **N/A** | All other clauses cleared or not applicable. |

### Passing clauses:
- clause3-line-budget: PASS
- clause4-impl-row: PASS/N/A
- clause5-no-self-exemption: PASS
- clause6-escrow-delta-v: N/A
- clause8-task-canonical-lifecycle-record: N/A
- clause10-tree-hygiene: PASS
- clause11-worktree-branch-hygiene: PASS
- clause9-split-or-commit: N/A

## 4. Additional Observations

### Plugin copy divergence
`plugin/workflows/execute-milestone.js` is 7 lines shorter than `.claude/workflows/execute-milestone.js` -- missing the DIR-090 TIMEOUT DISCIPLINE block. The refactor was applied to both but the TIMEOUT block was only added to the main copy.

### Naming inconsistency
- Charter and task body (line 125): `.claude/workflows/diagnose-complex.js`
- AC (line 152): `.claude/workflows/diagnose-verify-failure.js`
- Actual file: `.claude/workflows/diagnose-verify-failure.js`

The charter's Done-when says "diagnose-complex workflow exists" but `diagnose-complex.js` doesn't exist. The implementation renamed the file without updating the charter.

### Architecture divergence from proposal
The proposal called for `runShellCheck` helper running scripts directly in the workflow JS body. The implementation replaced this with a single `mechanical-checks` agent running the scripts. The iteration report justifies this as a "pragmatic approximation" because the workflow JS runtime lacks Bash/Read/Write tools. The 60% agent reduction (5->2) was achieved, but the architecture differs from the proposal.

### No integration with outer loop
The stated goal (line 133): "When /execute-milestone returns needs-human on Verify, the outer loop invokes /diagnose-verify-failure". This integration was never implemented. OUTER-LOOP.md's execute section remains unchanged. This is the single most impactful gap -- the diagnostic script exists but nothing calls it.

## 5. Summary

**19 criteria audited (AC + cross-check). 10 CONFIRMED or PARTIALLY MET, 9 REFUTED.**
**12 DoD items audited. 5 CONFIRMED, 7 REFUTED.**
**Mechanical gate: FAILED (exit 1, 5 clause violations).**

The implementation is directionally correct and the core artifacts (`diagnose-verify-failure.ts` with 30 passing tests, the 2-agent refactor, unified journal shape) are well-crafted. The refutations stem from three categories:

1. **Architecture drift from AC:** The proposal's `runShellCheck` direct-script pattern was replaced by agent-mediated script execution. The AC was written against the proposal, not the implementation.
2. **Missing integration:** The outer-loop retry block, manual smoke test, and real-case demonstrations were never performed.
3. **Task write-back gap:** 16 AC checkboxes remain unchecked in the task file -- the build never wrote back.
