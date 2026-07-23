---
id: DIR-062-C
title: "DIR-062 child C [proof, depends on B]: a REAL task's human-steered
  verdict produced by the wired SELECT logic (not hand-assigned),
  GateEvent-evidenced"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: DIR-062
children: []
extra:
  schema: v1
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
- [ ] A REAL board task is classified by the wired SELECT logic and its `human-steered` verdict + the triggering clause(s) are recorded in a durable artifact (GateEvent via `quay gate --gate drivable-workspace`, or the SELECT/engine output) — pasted, keyed to the real task id.
- [ ] The three cases above produce the expected verdicts through the wired path (not by hand) — pasted.
- [ ] The verdict matches the [[DIR-062]] definition for each case (no false-autonomous on a driver-edit or unlisted-workspace task; no false-steered on a registry-covered validation task).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget, impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: NOT done on a fixture/demo. Done ONLY when:
- [ ] The classification evidence is a REAL object — an actual board task's verdict from the wired logic + a durable GateEvent/engine artifact — pasted into the resolving milestone's `## Resolution`, not a synthetic fixture or an asserted "it would classify correctly".
- [ ] Together with [[DIR-062-B]], this satisfies [[DIR-062]]'s DoD "the gate is OPERATIVE" clause; on landing, [[DIR-062]] itself flips `dirStatus: applied`.