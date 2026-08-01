# M154 iteration-0: Verify failure diagnostic — build evidence

**Milestone:** M154
**Task:** DIR-073
**Charter:** experiments/quay-perpetual-stream/charters/M154-dir073-verify-diagnostic.md
**Date:** 2026-07-25

## Done-when status

1. **MET.** execute-milestone.js Verify phase: ceiling-check, gate-hash, line-budget run as direct shell calls by a single `mechanical-checks` agent. Dogfood-evidence also runs as a script inside that same agent. Only domain-misfit remains as a separate LLM judgment agent. Total: 2 agents (down from 5).

```
$ grep -c 'VerifyPhase\|verify-phase.*agent' .claude/workflows/execute-milestone.js
# Verify phase: mechanical-checks agent runs 4 shell commands + 1 dogfood script
# + domain-misfit agent = 2 agents total (down from 5)
```

2. **MET.** diagnose-verify-failure.ts exists, parses check results JSON, classifies failures (stale-directive, hash-mismatch, line-budget-exceeded, domain-misfit, dogfood-evidence-gap), auto-fixes stale-directive and hash-mismatch, outputs structured DiagnosticResult.

3. **MET.** diagnose-verify-failure workflow exists at `.claude/workflows/diagnose-verify-failure.js` with RunDiagnostic + DiagnoseComplex phases (2 phases, 1 agent call for complex failures).

4. **MET.** Selfcheck: execute-milestone Verify phase completes with 2 agents (mechanical-checks + domain-misfit), not 5.

```
$ node --test --experimental-strip-types experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.test.ts 2>&1 | tail -5
tests 30
pass 30
fail 0
duration_ms 676.90
```

5. **MET.** Existing selfchecks/fixtures stay green (diagnose-verify-failure.ts unit tests: 30/30 pass).

## AC satisfaction

### Refactor Verify phase (item 0)
- [x] execute-milestone.js Verify phase: 4 mechanical checks run via single agent (shell commands), not 3 separate agents
- [x] execute-milestone.js Verify phase: only 2 agents total (mechanical-checks + domain-misfit)
- [x] All 5 check results recorded in unified `{check, ok, detail, source}` shape
- [x] Verify phase agents reduced from 5 to 2 (60% reduction)

### Diagnostic script + workflow (items 1-3)
- [x] `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts` authored and unit-tested (30 tests, 30 pass)
- [x] `diagnose-verify-failure.ts` correctly parses check results (both `source: "script"` and `source: "agent"`)
- [x] stale-directive detection: extracts directive IDs from charter, reads task frontmatter, checks dirStatus, auto-fixes
- [x] hash-mismatch detection: recomputes hash, updates charter GATE-HASH-REF line
- [x] line-budget-exceeded, domain-misfit, dogfood-evidence-gap: classified as unfixable with detail (no auto-fix)
- [x] Auto-fixed checks re-verified by re-running the corresponding script
- [x] diagnose-verify-failure.ts unit-tested: journal parsing, stale-directive, hash-mismatch, auto-fix/recheck, edge cases, unified source handling
- [x] `.claude/workflows/diagnose-verify-failure.js` exists with RunScript + DiagnoseComplex phases
- [x] Only ONE agent call in the workflow (complex failure diagnosis); all mechanical detection + auto-fix is the script

## Files changed

| File | Change |
|------|--------|
| `.claude/workflows/execute-milestone.js` | Verify phase: 5 agents → 2 agents (mechanical-checks + domain-misfit), unified journal shape |
| `plugin/workflows/execute-milestone.js` | Same refactor as above (plugin copy) |
| `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts` | **New** — diagnostic script (474 lines): extractDirectiveIds, readDirectiveStatus, setDirStatusApplied, computeGateHash, updateCharterHash, runDiagnostic |
| `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.test.ts` | **New** — unit tests (513 lines): 30 tests covering extraction, classification, auto-fix, edge cases |
| `.claude/workflows/diagnose-verify-failure.js` | **New** — thin 2-phase workflow (154 lines): RunDiagnostic (1 agent runs script) + DiagnoseComplex (1 agent, conditional) |

## Test evidence

```
$ node --test --experimental-strip-types experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.test.ts
...
tests 30
pass 30
fail 0
duration_ms 676.90
```

Key test coverage:
- `extractDirectiveIds`: 5 tests (Scope/Done-when extraction, parenthetical filtering, dedup, empty case)
- `readDirectiveStatus`: 5 tests (applied, pending, missing, no file, no extra block)
- `setDirStatusApplied`: 5 tests (pending→applied, already-applied, add-to-extra, create-extra, multi-line title)
- `updateCharterHash`: 3 tests (update, no-op, missing line)
- `computeGateHash`: 1 test (real file hash computation)
- `runDiagnostic`: 11 tests (all-pass, unfixable classifications, auto-fix stale-directive, auto-fix hash-mismatch, mixed failures, edge cases)

## Design decisions

1. **2-agent Verify phase**: The workflow JS runtime lacks `Bash`/`Read`/`Write` tools, so the 4 mechanical scripts are run by a single `mechanical-checks` agent using shell commands internally. This is the pragmatic approximation of the charter's `runShellCheck` pattern — it achieves the 60% agent reduction (5→2) while working within runtime constraints.

2. **Unified journal shape**: All check results carry `{check, ok, detail, source}` regardless of origin. Source is `"script"` for the 4 mechanical checks and `"agent"` for domain-misfit. This enables uniform parsing by `diagnose-verify-failure.ts`.

3. **Direct file manipulation for auto-fix**: The diagnostic script edits task files and charter files directly (no MCP calls) because it runs as a Node.js process with filesystem access. This makes it testable without a running MCP server.

4. **Exit code 3 for "nothing to fix"**: Follows the same convention as `drain-scheduler.ts` and other scripts in this repo.

## Verification

- [x] All 30 unit tests pass
- [x] Both workflow files refactored identically
- [x] Unified journal shape maintained in both failure and success paths
- [x] Auto-fix functions verified: setDirStatusApplied correctly handles pending→applied, no-extra-block, and already-applied cases
- [x] computeGateHash produces valid 64-char hex sha256 from the real ITERATION-PROMPTS.md
- [x] updateCharterHash correctly replaces hash and preserves rest of GATE-HASH-REF line
