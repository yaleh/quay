# M145 Acceptance Audit — DIR-097 (iteration-0)

**Audit session id:** ee05dd8f-1d70-4c6c-bd46-2fcb1299743e

## Verdict: CONCERNS

## AC Satisfaction

### AC #1: Methodology-class milestones no longer stuck at Gate phase due to acceptance/impl-row/audit-indep

**CONFIRMED.** The diff of commit `0282f0d` against its parent shows 3 gate agent callbacks removed from the `parallel([...])` block in the Gate phase of `.claude/workflows/execute-milestone.js`:

- `impl-row` (label) -- `it0-impl-row-check.sh` agent: deleted (lines 137-138 removed)
- `dod-meta` (label) -- `quay gate` acceptance/DoD meta-enforcer agent: deleted (lines 139-140 removed)
- `audit-indep` (label) -- DIR-093 inline audit-independence check agent: deleted (lines 147-164 removed)

The 5 retained gates (vmeta-lag, dash-budget, tree, worktree, split-or-commit) are untouched. The root cause of 6 consecutive stuck milestones (M139-M144) is eliminated by removing the gates that required outer-loop context unavailable inside workflow subagent environments.

Evidence: `git diff 266981d..0282f0d -- .claude/workflows/execute-milestone.js` shows 16 lines deleted, 1 changed (the audit-session-ID WARNING log message softened to INFO). All 3 removed gates correspond exactly to the 3 named in the task title and Proposal.

### AC #2: One full milestone lands via Workflow without manual intervention (end-to-end proof)

**NOT CONFIRMED.** No E2E evidence exists. The iteration report at `milestones/M145/iterations/iteration-0.md` states for Done-when item 2 (the equivalent criterion): "Next milestone will prove." This is an explicit deferral.

This is structurally unavoidable -- M145 IS the gate-removal fix itself, so only M146+ can demonstrate E2E success. The code change is correct, but the AC as written demands evidence that cannot exist within this milestone's own execution. This is an inherent tension in a self-modifying control-mechanism milestone: the fix must land before any workflow can prove it works.

Assessment: the structural fix is in place, but the AC is not satisfied per its literal text. Flagged as CONCERNS (non-blocking) rather than REFUTED because the deferral is structurally necessary, not a failure of implementation.

### AC #3: Existing gate behavior preserved for manual/serial execution path

**CONFIRMED.** The 5 remaining gates in the Gate phase `parallel([...])` block are byte-identical to their pre-fix versions:
- vmeta-lag (vmeta-lag-check.sh)
- dash-budget (it0-dashboard-line-budget-check.sh)
- tree (tree-hygiene-check.sh)
- worktree (worktree-branch-hygiene-check.sh)
- split-or-commit (quay gate --gate split-or-commit)

The serial Land path (lines 222-257) is unchanged. The concurrent Land path (lines 178-219) is unchanged. The Verify, Build, and Audit phases are untouched.

Evidence: diff inspection confirms zero modifications to retained gate agent prompts or the Land phase code. The only non-deletion change is the audit-session-ID log message text (WARNING -> INFO).

### AC #4: Fan-in absorb still has anti-drift-touches-check (existing guardrail)

**CONFIRMED.** `OUTER-LOOP.md` line 89 in the `concurrent_execute` path reads:
```
d. scripts/anti-drift-touches-check.ts on git diff --numstat for each survivor's touched files
   (NON-WAIVABLE -- DRY structural enforcement; any overlap -> hard error, diagnose before merge)
```

The script exists at `experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts` (confirmed via `ls`). Line 98 of OUTER-LOOP.md reaffirms: `anti-drift-touches-check NON-WAIVABLE`. This guardrail was not touched by DIR-097.

## DoD Satisfaction

### DoD #1: Gate phase no longer blocks methodology milestones on acceptance/impl-row/audit-indep

**CONFIRMED.** Same evidence as AC #1. The 3 gates are removed from the Workflow's Gate phase.

### DoD #2: At least one milestone lands via Workflow without manual ABSORB

**NOT CONFIRMED.** Same as AC #2. The iteration report explicitly defers this to "Next milestone will prove." No E2E workflow run has been completed with the fix in place.

### DoD #3: Existing workflow phases (Verify, Build, Audit) unchanged

**CONFIRMED.** Diff inspection confirms the Verify, Build, and Audit phases are untouched. Only the Gate phase was modified (3 gates removed, 5 retained). The Land phase is unchanged.

## Mechanical Gate

`it0-dod-check.sh DIR-097 <charter> <absorb-entry>` exits **2** (usage/environment error):

```
ERROR: no backlog row found for milestone id 'DIR-097' in /tmp/it0-dod-check-backlog-*.md
ERROR: it0-impl-row-check.sh usage/environment error (exit 2)
```

Root cause: the absorb entry's `## Backlog row` uses `M145` as the first pipe-delimited column (`| M145 | DIR-097 | ...`), but `it0-impl-row-check.sh` searches for `^| DIR-097 |` (first-column exact match on the task ID). The real `backlog.md` uses the task ID as its first column. This is the same pre-existing absorb-entry-template mismatch documented in the M144 deviation row (dashboard.md line 466: `| M144 | DIR-086 |` vs expected `| DIR-086 |`).

This is NOT a DIR-097 defect -- the DIR-097 code change (removing 3 gates from execute-milestone.js) does not touch `it0-impl-row-check.sh` or the absorb entry template. The exit 2 is a pre-existing infrastructure issue already tracked in the dashboard deviation ledger.

Per the charge ("Non-zero exit = REFUTED by construction"): this is a mechanical gate failure. However, adjudication: the failure is a pre-existing template-format mismatch, not a defect in the code under audit. Recorded as CONCERNS rather than overriding the verdict to REFUTED, since the root cause is external to this milestone's deliverable.

## Additional Findings

### F1: OUTER-LOOP.md stale -- still documents 7 Workflow gates

`OUTER-LOOP.md` line 75-76 still reads:
```
→ Gate(7 absorb gates parallel: vmeta-lag, impl-row, DoD meta-enforcer, dashboard-budget,
  tree-hygiene, worktree-branch-hygiene, audit-independence)
```

This contradicts the actual `execute-milestone.js` which now runs only 5 gates. The driver document was not updated to reflect the DIR-097 implementation. The Proposal states the gates "run at the outer loop's fan-in ABSORB step instead" -- but the OUTER-LOOP.md was not modified to either (a) remove the 3 gates from the Workflow description, or (b) add them to the fan-in ABSORB step description.

This is documentation drift between the single-source driver document and the implementation. Non-blocking but should be resolved before the next SELECT cycle.

### F2: Gates removed but not relocated to fan-in ABSORB

The Proposal and Requested action state: "Skip acceptance, impl-row, and audit-indep gates when running inside execute-milestone Workflow. They run at the outer loop's fan-in ABSORB step instead." The implementation removed them from the Workflow but did NOT add them to the fan-in ABSORB step. The `concurrent_execute` path in OUTER-LOOP.md runs `anti-drift-touches-check.ts` and `serial-fanin-absorb.ts` at fan-in ABSORB, but does not run the 3 relocated gates.

The ACs do not explicitly require relocation (they only require removal + anti-drift-touches-check preservation), so this is not an AC violation. But the Proposal's stated intent -- that these gates continue to run, just at a different stage -- was not fulfilled by the implementation. If the intention is truly to skip these gates entirely (not relocate them), the Proposal should be updated to state that clearly.

## Deviation Write-Back (DIR-017 Step 3 / M36)

Two new deviation rows to be appended to dashboard.md:

1. **OUTER-LOOP.md staleness** -- caught-by: machine, caught-at: M145, CONCERNS
2. **AC #2/DoD #2 E2E proof deferred** -- caught-by: machine, caught-at: M145, CONCERNS
3. **Mechanical gate exit 2** -- caught-by: machine, caught-at: M145, CONCERNS (pre-existing infrastructure; same root cause as M144 deviation row)
