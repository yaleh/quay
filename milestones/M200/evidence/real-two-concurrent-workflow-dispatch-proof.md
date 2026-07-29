# M200/DIR-126-A — real two-concurrent-`Workflow`-dispatch proof (AC "Single-flight RED/GREEN")

Captured 2026-07-29 by the coordinator session (which has real `Workflow` tool access, unlike the
Build subagent that honestly disclosed it could not produce this evidence itself — see
`milestones/M200/iterations/iteration-0.md`'s "Honest disclosures" and the OS-process-level
fallback at `milestones/M200/stage9-two-process-race-evidence.md`).

## Setup

Two real `Workflow({scriptPath: '.claude/workflows/prepare-milestone.js', args: {taskId:
'DIR-126-A-fixture', milestoneId: 'M200-fixture-race', charterFile:
'experiments/quay-perpetual-stream/charters/M200-scratch-dir126a-fixture-concurrency-proof.md',
class: 'development'}})` calls dispatched back-to-back in the same turn (both cold, no resume
flag), against a throwaway scratch fixture task (`tasks/DIR-126-A-fixture.md`, deleted after this
proof) — real `Workflow` dispatches through the real harness, not a unit-test mock.

## Result — real journal evidence, dispatch-count ordering

**Loser (run `wf_043cc072-371`, task id `wgcrjm060`)** — full journal:
`milestones/M200/evidence/real-two-concurrent-dispatch-LOSER-journal.jsonl` (2 entries total: one
`started`, one `result`). Real returned outcome:

```json
{"outcome":"needs-human","reason":"prepare-already-running","phase":"Admission",
 "owner":{"ownerExecutionId":"9b3ffa31-5bd7-4274-86f3-74def2f0a1f1",
 "acquiredAt":1785334131530,"leaseUntil":1785352131530,"stage":"Admission"}}
```

`agent_count:1` for the entire run (per the tool result usage block) — confirms **zero**
`ProposalAuthors` (or any other) agent was ever dispatched on the loser; the single agent call was
the `admission-acquire` CLI invocation itself, which lost the race and returned
`prepare-already-running` — this is the literal dispatch-count-ordering proof the AC text requires,
not just the returned code.

**Winner (run `wf_ced7b8f1-d73`)** — journal excerpt (first 5 entries):
`milestones/M200/evidence/real-two-concurrent-dispatch-WINNER-journal-excerpt.jsonl`. Real
sequence: (1) `admission-acquire` result `{"outcome":"acquired","lease":{"key":".::DIR-126-A-
fixture",...,"fencingToken":0,...},"reclaimed":false}`; (2) two real `proposal-author-*` agents
started; (3) `proposal-author-2` already returned a real, non-fabricated `proposalText` before this
evidence was captured. The run was then deliberately stopped (`TaskStop`) once this dispatch-count
evidence existed — completing the fixture's full `ProposalAuthors`→`Adjudicate`→`ProposalReview`→
`PlanAuthor`→`PlanCheck`→`Receipt` chain would add real agent cost with no further evidentiary
value for this specific AC (which only requires proving the ORDERING: winner dispatches
`ProposalAuthors`, loser does not). The lease was released cleanly afterward
(`--release --taskId DIR-126-A-fixture --workspace .` → `{"ok":true,"releaseMethod":"normal"}`).

## Conclusion

Real, non-fixture, two-concurrent-`Workflow`-dispatch evidence via the actual harness (not a
process-level lease-primitive race, not a unit-test mock): exactly one dispatch reached
`ProposalAuthors` (2 real author agents, one already completed); the other returned
`prepare-already-running` at the `Admission` phase with zero author-agent dispatches. Different
task IDs are already independently covered by the loser/winner both keying off the same
`(workspace, taskId)` — a different `taskId` uses a different lease key by construction (see
`prepare-admission-check.ts`'s `key` field, `${workspace}::${taskId}`), not re-tested here since
that property is structural, not a race outcome.
