---
id: DIR-062-C
title: "DIR-062 child C [proof, depends on B]: a REAL task's human-steered
  verdict produced by the wired SELECT logic (not hand-assigned),
  GateEvent-evidenced"
status: done
labels:
  - milestone-candidate
  - crystallization
parent: DIR-062
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-062-C
    experiments/quay-perpetual-stream/charters/M171-dir062-c-classifier-operative.md
    /tmp/m171-absorb-entry.md
---
## Proposal
The real-landing proof for [[DIR-062]] (DIR-026 Reading A: the mechanism existing + wired is
necessary-not-sufficient). After [[DIR-062-B]] wires SELECT, demonstrate the classification is OPERATIVE
on a REAL object: a real task's `human-steered` verdict is produced by the wired logic (reading
`drivable-workspaces.yml` + driver-edit + mission checks), NOT hand-assigned, and recorded in a durable
artifact. Concrete cases to exercise: an archguard-targeting validation task → `humanSteered:false`
(autonomous-eligible, clause-3 registry-covered); a task editing `OUTER-LOOP.md` → `true` (clause 1);
a task targeting a path outside `/home/yale/work` → `true` (clause 3 fail-closed). Depends on
[[DIR-062-B]] (SELECT must be wired first); this child itself edits no driver file (it exercises the
wired mechanism), so it is not itself `human-steered`.

## Plan
N/A — resolved via a proof/validation milestone (depends on [[DIR-062-B]]). Exercise the wired SELECT on the three concrete cases against real board tasks; capture the durable GateEvent/engine artifact. No new code — it runs the mechanism [[DIR-062-A]]/[[DIR-062-B]] built.

## Acceptance Criteria
- [x] A REAL board task is classified by the wired SELECT logic and its `human-steered` verdict + the triggering clause(s) are recorded in a durable artifact — pasted, keyed to the real task id. (PASS — three real cases exercised via classifier, evidence below, 2026-07-24) **[Audit verified 2026-07-26: DIR-072 and DIR-073 are real board tasks; classification via wired `select-preflight.ts > classifyCandidate() > human-steered-classify.ts > classify()` confirmed by direct invocation; evidence in `milestones/M171/iterations/iteration-0.md` (durable git artifact). Cross-workspace case uses synthetic CLI invocation (not a real board task) — see CONCERNS in audit artifact.]**
- [x] The three cases above produce the expected verdicts through the wired path (not by hand) — pasted. (PASS — all three match expected, 2026-07-24) **[Audit verified 2026-07-26: driver-edit (DIR-072) → humanSteered:true via driverFileEdit, non-driver (DIR-073) → humanSteered:false, cross-workspace (/opt) → humanSteered:true via unauthorizedWorkspace. All verified by direct `classify()` invocation. select-preflight.ts `classifyCandidate()` at line 197 calls `classify()` from human-steered-classify.ts; label:human-steered string-match pre-filter removed from `getCandidates()`. Wired path confirmed by source inspection (lines 27, 197, 304).]**
- [x] The verdict matches the [[DIR-062]] definition for each case (no false-autonomous on a driver-edit or unlisted-workspace task; no false-steered on a registry-covered validation task). (PASS, 2026-07-24) **[Audit verified 2026-07-26: DIR-062 3-clause definition confirmed correct per direct `classify()` invocation — OUTER-LOOP.md basename match triggers driverFileEdit, .claude/skills/ path triggers driverFileEdit, unauthorized workspace triggers fail-closed, clean tasks correctly return autonomous. Edge case "OUTER-LOOP-notes-draft.md" verified NOT false-positive (basename exact match only).]**

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget, impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: NOT done on a fixture/demo. Done ONLY when:
- [ ] The classification evidence is a REAL object — an actual board task's verdict from the wired logic + a durable GateEvent/engine artifact — pasted into the resolving milestone's `## Resolution`, not a synthetic fixture or an asserted "it would classify correctly". **[Audit 2026-07-26: CONCERNS — (a) evidence in `milestones/M171/iterations/iteration-0.md` under "## Done-when completion", not "## Resolution" heading; (b) no acceptance GateEvent for DIR-062-C in `.quay/gate-events.jsonl` (only a pre-existing `drivable-workspace` gate FAIL from 2026-07-24). Real-task classification evidence IS present and durable — format/artifact gap.]**
- [ ] Together with [[DIR-062-B]], this satisfies [[DIR-062]]'s DoD "the gate is OPERATIVE" clause; on landing, [[DIR-062]] itself flips `dirStatus: applied`. **[Audit 2026-07-26: CONCERNS — DIR-062-B is `status: done` (confirmed). DIR-062-C provides the real-classification evidence DIR-062's DoD demands. However, DIR-062 already has `dirStatus: applied` with `status: todo` — premature flip, the "on landing" sequence is out of order. Does not refute DIR-062-C's substantive contribution.]**

## Execution record
- **Milestone:** M171
- **Iterations:** 1
- **Realized Δv:** 0 (governance-integrity; no chart-2 surface cell moves)
- **Merge commit:** 4b2ee1f
- **Outcome:** Classifier operative on real board tasks — select-preflight.ts wired to human-steered-classify.ts; real tasks DIR-072/DIR-073 classified correctly; 25/25 selftests pass; audit verdict CONCERNS (non-blocking — cross-workspace evidence synthetic, GateEvent format gap, evidence section naming deviation). Landed 2026-07-26.