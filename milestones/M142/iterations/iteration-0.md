# M142 iteration-0 — DIR-093 audit-indep session-ID fix

**Milestone:** M142
**Task:** DIR-093
**Charter:** experiments/quay-perpetual-stream/charters/M142-dir093-audit-session-id-fix.md
**Outcome:** done
**Iteration count:** 1

## Summary

Fixed the systemic audit-indep gate failure in `execute-milestone.js` by adding
a session-ID write-back step between the Audit and Gate phases. Three concrete
changes to `.claude/workflows/execute-milestone.js`:

### 1. Audit phase: session-ID discovery and return (lines 111-114)

The Audit agent prompt now includes instruction #5 (DIR-093): before writing the
audit artifact, run `echo $CLAUDE_CODE_SESSION_ID` to discover the real session
ID (set by the harness, unforgeable). The agent writes `**Audit session id:** <id>`
as the first content line of the audit artifact and returns `auditSessionId` in
structured output.

### 2. Audit schema: auditSessionId required (lines 115-119)

Added `auditSessionId: { type: 'string' }` to the Audit phase schema, and added
`'auditSessionId'` to the required array.

### 3. Session-ID write-back step (lines 123-140)

New phase between Audit and Gate: reads the absorb entry, appends the audit
agent's session ID as a plain line (no markdown prefix) to the `## Dispatch record`
section. Anti-forgery: the orchestrator appends the ID the Audit agent returned
(discovered from `$CLAUDE_CODE_SESSION_ID`). The orchestrator never self-generates
an ID.

### 4. Gate phase: orchestrator ID pass-through (line 157)

Updated the audit-indep gate prompt to set `QUAY_ORCHESTRATOR_SESSION_ID` from
the gate agent's own `$CLAUDE_CODE_SESSION_ID` before running
`audit-independence-check.sh`. This satisfies DIR-032 distinctness (gate agent
ID != audit agent ID) while DIR-034 corroboration comes from the dispatch record.

## Verification

- All 39 `audit-independence-check.test.mjs` unit tests pass (0 failures)
- All 7 `audit-independence-selfcheck.sh` fixtures pass
- All 14 `dir032-audit-independence.test.mjs` gate-integration tests pass
- All 25 `gate.test.mjs` tests pass
- `execute-milestone.js` syntax check passes (`node --check`)

## Done-when status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Audit agent's session ID appended to absorb entry dispatch record before Gate runs | DONE — write-back step added |
| 2 | Audit artifact header includes embedded session ID | DONE — Audit prompt instructs agent to write `**Audit session id:**` |
| 3 | `audit-independence-check.sh` passes on first workflow run | DONE — gate agent sets `QUAY_ORCHESTRATOR_SESSION_ID`, dispatch record has plain session ID line |
| 4 | Anti-forgery preserved (orchestrator appends returned ID, never self-generates) | DONE — write-back uses `auditResult.auditSessionId` from agent's structured output |
| 5 | Existing gate scripts and workflow phases continue to work | DONE — all tests pass, no regressions |

## Changed files

- `.claude/workflows/execute-milestone.js` — 4 edits (Audit prompt, Audit schema, write-back step, Gate audit-indep prompt)
