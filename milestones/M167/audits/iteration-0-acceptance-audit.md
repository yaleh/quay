# M167 acceptance audit -- DIR-107

**Audit session id:** 890af9ef-77fb-4a3c-9673-01ab2951058b

**Task:** DIR-107 · **Charter:** M167-dir107-concurrent-fan-in-safety · **Date:** 2026-07-26

**Verdict:** CONCERNS -- all structural code changes confirmed correct by git diff; one AC + one DoD item are E2E-behavioral and structurally unverifiable under `.halt`; mechanical gate exit 2 is a pre-existing absorb-entry template issue, not a DIR-107 defect.

## AC satisfaction (10 criteria)

### AC1: IS_CONCURRENT Land phase no longer merges to master, commits in own branch, returns buildBranch
**Confirmed.** Git diff `8d96df9^..0f2d257` shows the concurrent Land agent prompt in `plugin/workflows/execute-milestone.js` (L253-278) changed from "MERGE the iteration worktree into master" to "COMMIT the build in its OWN worktree branch. Do NOT merge to master." Step 2 captures `buildBranch` via `git branch --show-current`. Return schema changed from `mergeCommit` to `buildBranch` (L280). Return statement uses `buildBranch` (L289).

### AC2: Return schema includes buildBranch for concurrent mode
**Confirmed.** `execute-milestone.js` L280 schema: `required: ['outcome', 'buildBranch', 'touchedFiles', 'dashboardEntry']`. Previously required `mergeCommit`.

### AC3: Serial path merge + counter++ + dashboard behavior UNCHANGED
**Confirmed.** The git diff shows zero changes to lines 292-330 of `execute-milestone.js` (the serial Land phase). The serial path still opens with "MERGE the iteration worktree into master", includes counter++, dashboard update, capture/prune, execution provenance, and PHI consolidation. `OUTER-LOOP.md` execute(|batch|=1) (L80-90) is also unchanged.

### AC4: Anti-drift runs BEFORE fan-in merge -- pre-merge gate
**Confirmed.** `OUTER-LOOP.md` L112-115: step e is the anti-drift check, explicitly labeled "PRE-MERGE GATE" with "Runs BEFORE any merge step g -- master stays clean on HARD FAIL." The merge is at step g (L118-119). L124-125 explicitly document "audit-independence + anti-drift-touches-check are PRE-MERGE gates (steps d,e before step g)."

Note: AC text says "step d" for anti-drift; implementation has it at step e because the new audit-independence check (Fix 3) occupies step d. This is a lettering shift, not a functional gap.

### AC5: Step f (now g) is the sole merge owner, consuming buildBranch, pruning after merge
**Confirmed.** `OUTER-LOOP.md` L118-119: "MERGE each survivor one at a time in plan order consuming buildBranch (SOLE merge owner; single git worktree). Prune each branch after its merge." L128: "step g is SOLE merge owner -- workflows produce committed branches; fan-in owns all merges."

### AC6: Concurrent fan-in includes audit-independence check per survivor
**Confirmed.** `OUTER-LOOP.md` L107-111: new step d, "PRE-MERGE GATE -- audit-independence per survivor (DIR-107 Fix 3): verify each survivor's audit session ID != its build session ID (DIR-032/034 anti-forgery; inline verification per DIR-093). Any survivor failing -> route to needs-human, EXCLUDE from fan-in (partial-batch: independent survivors still land)."

### AC7: Dispatch documents the |batch|=0 branch explicitly
**Confirmed.** `OUTER-LOOP.md` L92-97: new `dispatch` function with three explicit branches (`|batch| = 0`, `|batch| = 1`, `|batch| >= 2`) and annotation "explicit empty-batch branch (DIR-107 Fix 4): 'nothing selected' is logged and observable."

### AC8: Real >=2-wide concurrent batch executes end-to-end
**CONCERNS.** Structurally unverifiable at audit time. The task was executed under `.halt` as a human-steered (`label:human-steered`) directive -- no loop is running to produce a real concurrent batch. The code changes are structurally correct (confirmed by diff for all other AC items), and the execution path through `concurrent_execute` steps a-i is well-defined in `OUTER-LOOP.md`. However, end-to-end evidence of anti-drift passing pre-merge, fan-in merging serially, counter += survivors.length, and both dashboard entries present requires an actual concurrent batch execution which cannot occur while `.halt` is present. E2E verification is deferred until the loop runs concurrent after `.halt` removal.

### AC9: Existing it0 selfchecks + gate hashes stay green
**Confirmed.** Gate-hash check: PASS (exit 0) -- "GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source sha256." Line-budget check: PASS (exit 0). Ceiling check: exit 1 "NOT-FOUND" -- the charter cites no gap-list IDs (normal for a development-class charter implementing a directive, not a gap-driven charter). DoD check: exit 2 -- pre-existing absorb-entry template issue (no "## Backlog row" section in `/tmp/m167-absorb-entry.md`); same pattern as M139-M166, NOT a DIR-107 regression.

### AC10: No serial-path regression
**Confirmed.** Git diff confirms zero changes to the serial execution path in both `execute-milestone.js` (L292-330 unchanged) and `OUTER-LOOP.md` (execute(|batch|=1) at L80-90 unchanged).

## DoD satisfaction (6 criteria)

### DoD1: execute-milestone.js concurrent Land -- merge removed, branch retained, buildBranch returned
**Confirmed.** Verified by git diff -- concurrent Land agent prompt rewritten, schema updated, return value uses buildBranch.

### DoD2: OUTER-LOOP.md concurrent_execute -- all four items confirmed
**Confirmed.** Anti-drift pre-merge (step e), fan-in sole merge owner (step g), audit-independence per survivor (step d), empty-batch dispatch branch (L92-97). All verified by diff.

### DoD3: One real >=2-wide batch lands on master with anti-drift passing BEFORE merge
**CONCERNS.** Same as AC8 -- structurally unverifiable under `.halt`. The code path is correct but no E2E evidence exists.

### DoD4: milestone_counter advances by survivors.length in concurrent path
**Confirmed.** `OUTER-LOOP.md` L120 step h: "milestone_counter += |survivors|; dashboard.md append each survivor's dashboardEntry."

### DoD5: Serial path proven backward-compatible
**Confirmed.** Zero changes to serial path in git diff. A 1-wide batch remains byte-identical in behavior.

### DoD6: All it0 selfchecks + gate hashes green
**Confirmed.** Gate-hash PASS, line-budget PASS. Ceiling NOT-FOUND is non-blocking (development charter, no gap IDs). DoD check exit 2 is pre-existing template issue.

## Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-107 experiments/quay-perpetual-stream/charters/M167-dir107-concurrent-fan-in-safety.md /tmp/m167-absorb-entry.md
ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause against a synthetic milestone)
EXIT_CODE=2
```

Exit 2 -- pre-existing absorb-entry template issue. `/tmp/m167-absorb-entry.md` is a template with `{selfcheck}` and `{date}` placeholders. Same pattern documented across M139-M166 deviation rows. NOT a DIR-107 implementation defect -- the absorb entry is never populated for off-loop human-steered tasks.

## Separate gate checks

| Check | Result | Evidence |
|---|---|---|
| gate-hash | PASS (exit 0) | Hash matches pinned source |
| line-budget | PASS (exit 0) | Charter within small-milestone norm |
| ceiling | exit 1 (NOT-FOUND) | Charter has no gap-list IDs (development task, not gap-driven) |

## Deviation-log write-back

One CONCERNS-level finding recorded in dashboard.md deviation table (caught-by: machine, caught-at: M167, level: CONCERNS, status: open, age: 0): AC8/DoD3 E2E concurrent batch execution unverifiable under `.halt` -- structurally deferred until loop runs concurrent.
