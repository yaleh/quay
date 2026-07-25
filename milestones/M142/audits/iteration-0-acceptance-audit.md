# M142 acceptance audit — DIR-093 (audit-indep session-ID fix)

**Audit session id:** ee05dd8f-1d70-4c6c-bd46-2fcb1299743e

**Date:** 2026-07-25
**Task:** DIR-093
**Charter:** experiments/quay-perpetual-stream/charters/M142-dir093-audit-session-id-fix.md
**Implementation commit:** 6f9a3c7 (on master)
**Task status on master:** todo (lifecycle never promoted)

## Verdict: CONCERNS

The implementation code is structurally correct and satisfies 3 of 6 AC and 1 of 3 DoD items.
The mechanical gate fails due to a pre-existing infrastructure regression (DIR-070-C), not a
DIR-093 defect. Two AC items and one DoD item require E2E workflow evidence that does not exist.

## Detailed AC assessment

### AC #1 -- Audit session ID appended to absorb entry dispatch record before Gate phase runs

**CONFIRMED.** The diff for commit 6f9a3c7 adds a session-ID write-back phase (lines 127-140 in
`.claude/workflows/execute-milestone.js`) between the Audit phase and the Gate phase. After the
Audit agent returns its `auditSessionId` in structured output, the write-back step reads the
absorb entry file, appends the returned session ID as a plain line to the `## Dispatch record`
section, and writes the file back. The Gate phase (line 143 onward) runs AFTER this write-back.

Evidence: `git diff 6f9a3c7^..6f9a3c7 -- .claude/workflows/execute-milestone.js` shows the
`// ── Session-ID write-back (DIR-093): append to absorb entry dispatch record ─────────` block
inserted between the Audit phase log and the `phase('Gate')` call.

### AC #2 -- Audit artifact header includes embedded session ID for independence corroboration

**CONFIRMED.** The Audit agent prompt (line 112 of the current `execute-milestone.js`) includes
instruction #5 (DIR-093): `BEFORE writing the audit artifact, run \`echo \$CLAUDE_CODE_SESSION_ID\`
to discover your REAL session ID (this is set by the harness and cannot be forged). Write
\`**Audit session id:** <that-id>\` as the FIRST content line of the audit artifact (after the title).`

This audit artifact itself demonstrates the pattern: `**Audit session id:** ee05dd8f-...`.

### AC #3 -- `audit-independence-check.sh` passes on the first workflow run for a new milestone

**CANNOT CONFIRM.** No evidence of an actual end-to-end workflow run exists. The iteration-0
report cites only structural code changes and test results, not a real `execute-milestone.js`
execution. The mechanical gate (`it0-dod-check.sh`) exits with code 2 due to a pre-existing
DIR-070-C infrastructure regression in `it0-impl-row-check.sh` (positional arg while-loop bug
where the second positional arg overwrites MILESTONE_ID). This is NOT a DIR-093 defect -- it
affects all milestones since M139. However, AC #3 literally requires "first workflow run"
evidence, and none is available.

All 85 unit/integration tests pass (39 audit-indep unit tests, 14 DIR-032 integration tests,
25 gate tests, 7 selfcheck fixtures), confirming the structural logic is correct. But tests
are not a workflow run.

### AC #4 -- Full `execute-milestone.js` run completes without audit-indep gate failure

**CANNOT CONFIRM.** Same as AC #3 -- no E2E workflow evidence exists.

### AC #5 -- DIR-034 anti-forgery property preserved

**CONFIRMED.** The write-back step (line 131) uses `auditResult.auditSessionId` -- the ID the
Audit agent returned in its own structured output, which the agent discovered from
`$CLAUDE_CODE_SESSION_ID` (set by the harness, unforgeable by the agent). The orchestrator
never self-generates an ID. The comment block at lines 123-126 explicitly states this:
"Anti-forgery: the orchestrator appends the Audit agent's returned session ID -- the Audit
agent discovered it from $CLAUDE_CODE_SESSION_ID (harness-set, unforgeable). The orchestrator
never self-generates an ID."

### AC #6 -- Existing milestones (M136-M141) not broken by the change

**PARTIALLY CONFIRMED.** The change is purely additive: a new session-ID write-back phase
inserted between Audit and Gate, plus prompt modifications to the Audit and audit-indep gate
agents. No existing phase behavior is modified. All 85 tests + 7 selfcheck fixtures pass.
However, no regression workflow run against an existing milestone was performed.

## Detailed DoD assessment

### DoD #1 -- `execute-milestone.js` updated with session-ID write-back step

**CONFIRMED.** The diff shows 4 edits to `.claude/workflows/execute-milestone.js`:
1. Audit phase prompt: added instruction #5 (session-ID discovery + artifact header)
2. Audit phase schema: added `auditSessionId` to required fields
3. New session-ID write-back phase (lines 123-140)
4. Gate audit-indep prompt: added `QUAY_ORCHESTRATOR_SESSION_ID` pass-through

Evidence: `git diff 6f9a3c7^..6f9a3c7 -- .claude/workflows/execute-milestone.js`.

### DoD #2 -- At least one successful E2E `execute-milestone.js` run with audit-indep gate passing

**CANNOT CONFIRM.** No E2E workflow run evidence exists. The iteration-0 report describes code
changes and test results but not a real workflow execution.

### DoD #3 -- No regression: existing gate scripts and workflow phases continue to work

**PARTIALLY CONFIRMED.** All 85 tests pass (audit-independence 39 unit + 7 fixtures all pass;
dir032-audit-independence 14 pass; gate 25 pass). The change is additive and does not modify
existing gate logic. However, no regression workflow run was performed against an existing
milestone.

## Mechanical gate result

`it0-dod-check.sh DIR-093 ...` exits with code **2** (usage/environment error):
```
ERROR: backlog file not found: backlog.md
ERROR: it0-impl-row-check.sh usage/environment error (exit 2)
```

**Root cause:** Pre-existing DIR-070-C `it0-impl-row-check.sh` positional arg regression
(documented in dashboard.md deviation rows for M139, M140, M141). The while-loop parser at
lines 44-56 treats ALL non-flag positional args as MILESTONE_ID, causing the second arg
(the temp backlog file path) to overwrite the first. `it0-dod-check.ts` line 304 passes two
positional args: `[milestoneId, tmpBacklog]`. This is NOT a DIR-093 defect -- the same bug
blocks every milestone since the DIR-070-C parameterization was merged.

The absorb entry at `/tmp/m142-absorb-entry.md` has a valid `## Backlog row` section with a
pipe-delimited row. Under normal conditions (when `it0-impl-row-check.sh` correctly parses
its args), this gate would evaluate normally.

## Deviation log write-back

Two deviations to record:

1. **REFUTED/machine** -- Mechanical gate cannot complete due to pre-existing DIR-070-C
   `it0-impl-row-check.sh` positional arg regression. Root cause is external to DIR-093.
2. **CONCERNS/machine** -- Task lifecycle is `status: todo` on master despite implementation
   being merged (commit 6f9a3c7). AC/DoD checkboxes were unchecked until this audit
   write-back. Task was never promoted through todo→ready→done.

See dashboard.md write-back below for the formal deviation rows.
