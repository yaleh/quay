# DIR-062-C Adversarial Acceptance Audit -- Iteration 0

**Audit session id:** 890af9ef-77fb-4a3c-9673-01ab2951058b

**Date:** 2026-07-26
**Charter:** `experiments/quay-perpetual-stream/charters/M171-dir062-c-classifier-operative.md`
**Task:** DIR-062-C
**Verdict:** CONCERNS

## Context

DIR-062-C is the real-landing proof child for DIR-062: demonstrate that the wired SELECT logic classifies a real board task (not a fixture/demo) and produces a durable classification artifact. Depends on DIR-062-B (SELECT wiring). The charger claims: select-preflight.ts wired to call human-steered-classify.ts, 3 real cases classified, self-tests green, select-preflight.js synced, mechanical gate passes.

## AC Satisfaction

### AC-1: Real board task classified by wired SELECT logic, verdict + triggering clauses recorded in durable artifact

**CONFIRMED.** DIR-072 and DIR-073 are real board tasks existing at `tasks/DIR-072.md` and `tasks/DIR-073.md`. The classification evidence in `milestones/M171/iterations/iteration-0.md` records verdicts keyed to real task IDs:

| Task | Touches (parsed from `## Touches`) | humanSteered | Triggering Clause |
|---|---|---|---|
| DIR-072 | `experiments/quay-perpetual-stream/OUTER-LOOP.md` (driver file) | `true` | `driverFileEdit` |
| DIR-073 | `.claude/workflows/execute-milestone.js`, scripts/ (non-driver) | `false` | (autonomous-eligible) |

DIR-072's `## Touches` section was independently verified: it includes `experiments/quay-perpetual-stream/OUTER-LOOP.md`, confirmed via manual grep. DIR-073's `## Touches` section includes `.claude/workflows/execute-milestone.js` and scripts -- neither are driver files. The evidence table also lists a fourth case (DIR-070-E, touches `.claude/skills/quay-task-to-plan/` → humanSteered:true, driverFileEdit), confirmed.

The iteration-0.md is a durable, git-tracked artifact on the master branch (commit 7b13cc0). Evidence citation: `touchesDriverFile("experiments/quay-perpetual-stream/OUTER-LOOP.md") === true`, `touchesDriverFile(".claude/workflows/execute-milestone.js") === false` (verified by direct invocation, 2026-07-26).

### AC-2: Three cases produce expected verdicts through wired path (not by hand)

**CONFIRMED (with note).** Two of three primary cases are real board tasks verified through the wired path:

1. **Driver-edit (DIR-072):** `classify({touchedFiles: [OUTER-LOOP.md], ...})` → `{humanSteered: true, clauses: {driverFileEdit: true}}` -- matches expected. Wired path: `classifyCandidate()` in `select-preflight.ts` line 197 calls `classify()` from `human-steered-classify.ts` line 63 (confirmed by grep at line 304: `const cr = classifyCandidate(workspaceRoot, c.id, c.extra, registry)`).

2. **Non-driver (DIR-073):** `classify({touchedFiles: [.claude/workflows/execute-milestone.js, ...], ...})` → `{humanSteered: false}` -- matches expected.

3. **Cross-workspace:** `classify({drivenWorkspaces: ["/opt/some-other-place"], ...})` → `{humanSteered: true, clauses: {unauthorizedWorkspace: true}}` -- matches expected. NOTE: The iteration-0.md evidence table lists "CLI test" rather than a real task ID for this case. No task on the board has `extra.drivenWorkspaces` set (confirmed by `grep -rl drivenWorkspaces tasks/` returning empty). The proposal specifies "a task targeting a path outside /home/yale/work" -- implying a real board task. The classification logic is correct (verified by direct CLI invocation), but the cross-workspace evidence is through a synthetic CLI invocation, not a real board task.

The wiring is confirmed: `select-preflight.ts` imports `classify` at line 27, `classifyCandidate()` calls `classify()` at line 197, and `buildPreflightResult()` calls `classifyCandidate()` at line 304. The `label:human-steered` string-match pre-filter was removed from `getCandidates()` (line 98: no longer pre-filters). All 25 selftest cases (19 original + 6 new classifier integration) pass.

### AC-3: Verdict matches DIR-062 definition for each case

**CONFIRMED.** DIR-062's 3-clause definition:
1. `driverFileEdit`: touches OUTER-LOOP.md, inherited-core.md, or `.claude/skills/` files
2. `missionRedirection`: declared mission-redirection marker
3. `unauthorizedWorkspace`: drives workspace not covered by `drivable-workspaces.yml`

Verified via direct `classify()` invocation:
- DIR-072 (OUTER-LOOP.md): `{humanSteered: true, driverFileEdit: true, missionRedirection: false, unauthorizedWorkspace: false}` -- no false-autonomous on a driver-edit ✓
- DIR-073 (workflow scripts): `{humanSteered: false}` -- no false-steered on a registry-covered task ✓
- Cross-workspace (/opt): `{humanSteered: true, unauthorizedWorkspace: true}` -- fail-closed on unlisted workspace ✓
- Edge case: "OUTER-LOOP-notes-draft.md" NOT classified as driverFileEdit (basename exact match only) -- no false-positive ✓

## DoD Satisfaction

### DoD-1: Classification evidence is a REAL object, not a fixture -- pasted into resolving milestone's ## Resolution

**CONCERN.** Two issues:

(a) **Format:** The classification evidence lives in `milestones/M171/iterations/iteration-0.md` under "## Done-when completion" -- not under a "## Resolution" heading as the DoD requires. The milestone directory `milestones/M171/` has only `iterations/iteration-0.md`; there is no top-level milestone resolution file.

(b) **GateEvent artifact:** No acceptance gate event exists for DIR-062-C in `.quay/gate-events.jsonl`. The only gate event for DIR-062-C is a `drivable-workspace` gate FAIL from 2026-07-24 (before this milestone executed). The DoD requires "a durable GateEvent/engine artifact" as part of the evidence package. The `it0-dod-check.sh` PASS recorded during the build does not produce a GateEvent in the gate-events.jsonl log (it outputs to stdout only). The iteration-0.md IS a durable git-tracked artifact containing REAL task classification data from the wired logic, but the GateEvent/engine-artifact component is absent.

### DoD-2: Together with DIR-062-B, satisfies DIR-062's DoD "gate is OPERATIVE" clause; on landing, DIR-062 flips dirStatus: applied

**CONCERN.** DIR-062-B is `status: done` with `dirStatus: resolved` (confirmed). DIR-062-C provides the real-classification evidence DIR-062's DoD demands. The mechanical components are all in place. However:

- DIR-062 currently has `dirStatus: applied` even though its `status` is `todo` (confirmed: frontmatter lines 6 and 16). The DoD clause says "on landing, DIR-062 itself flips dirStatus: applied" -- implying DIR-062-C's landing should trigger the flip. But `dirStatus: applied` is already set, which is premature if DIR-062-C is the mechanism that proves the gate is operative. This is a parent-task lifecycle concern -- it does not refute DIR-062-C's substantive work, but it means the "on landing" sequence is out of order.

## Mechanical Gate

**PASS.** `it0-dod-check.sh DIR-062-C ...` exits 0. All 12 clauses satisfied:
- clause0: AC/DoD present (3 checkable AC items, DoD references standard)
- clause1: adversarial-audit disposition present
- clause2: V_meta consolidation-lag disposition present
- clause3: line-budget PASS
- clause4: impl-row N/A
- clause5: no-self-exemption PASS
- clause6: escrow-Δv N/A
- clause7: test-floor N/A (method-infra surface)
- clause8: task-canonical-lifecycle-record N/A
- clause10: tree-hygiene PASS
- clause11: worktree-branch-hygiene PASS
- clause12: audit-independence N/A

## Self-test Verification

All self-tests independently confirmed passing (2026-07-26):
- `human-steered-classify.ts --selftest`: 8/8 PASS
- `select-preflight.ts --selftest`: 25/25 PASS (19 original + 6 new classifier integration)
- `drivable-workspace-check.ts --selftest`: 13/13 PASS

## Files Changed (verified via git log)

- Commit `7b13cc0` on master: `select-preflight.ts` wired classifier, `select-preflight.js` synced meta description and agent prompt

## Summary

**Verdict: CONCERNS** -- the substantive implementation is correct and all AC items are confirmed: the classifier is wired into `select-preflight.ts`, real board tasks (DIR-072, DIR-073) are classified correctly, all 25 selftests pass, and the mechanical gate passes (exit 0). Three concerns prevent a clean NO REFUTATION FOUND:

1. **Cross-workspace evidence is synthetic** -- the evidence table lists "CLI test" rather than a real board task ID. The proposal says "a task targeting a path outside /home/yale/work" which implies a real board task. No task on the board has `extra.drivenWorkspaces`. The classifier logic is correct; the concern is about evidence provenance.
2. **GateEvent artifact missing** -- the DoD requires a GateEvent/engine artifact alongside classification evidence. No acceptance gate event for DIR-062-C exists in `.quay/gate-events.jsonl`.
3. **Evidence format deviation** -- classification evidence is under "## Done-when completion" in iteration-0.md, not "## Resolution" as the DoD requires.

None of these block the substantive claim: the classifier is operative, wired, and produces correct verdicts on real tasks. The concerns are about audit-trail completeness and format -- they can be resolved by: (a) running one more classification against a real board task with `extra.drivenWorkspaces`, (b) recording a GateEvent via `quay gate DIR-062-C`, and (c) adding a "## Resolution" section to the milestone evidence.
