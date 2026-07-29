# M197 AC 1/2/6/7/10 real journal evidence — `resumeFromAdjudicatedProposal` skips ProposalAuthors/Adjudicate

## What this proves

A real `Workflow({scriptPath: '.claude/workflows/prepare-milestone.js'})` dispatch (run
`wf_2cc60d00-181`, 2026-07-29) with `resumeFromAdjudicatedProposal: true` produced a real
`journal.jsonl` (12 entries, 6 agent dispatches) whose agent results are **exclusively**
`ProposalReview`-shaped (`findings`/review-verdict payloads) — **zero** `authorIdx`-shaped
(`proposal-author-*`) or bare-adjudicator-shaped results appear anywhere. This is the real,
harness-tracked artifact AC 1/2/6/7/10 and DoD item 1 require in their own literal text
("a real run's journal" / "a real dispatch's journal"), which the M197 Build subagent could not
produce because it had no `Workflow` tool access (honestly disclosed in
`milestones/M197/iterations/iteration-0.md`, confirmed by the M197 audit as the sole reason for
the `audit-refuted` verdict on those 5 items).

## Dispatch parameters

```json
{"charterFile":"experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md","class":"development","milestoneId":"M197-PROOF","resumeFromAdjudicatedProposal":true,"taskId":"FIXTURE-M197-RESUME-PROOF"}
```

`FIXTURE-M197-RESUME-PROOF` (now deleted, `tasks/FIXTURE-M197-RESUME-PROOF.md`) was a disposable
scratch copy of the real task's body, used ONLY so the proof dispatch could not mutate the real
task's already-verified state (Prepared receipt, Land pipeline). Journal:
`/home/yale/.claude/projects/-home-yale-work-quay/ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78/subagents/workflows/wf_2cc60d00-181/journal.jsonl`.

## Real journal result (verbatim agent-result shapes, one line per dispatch)

| # | key (truncated) | result shape |
|---|---|---|
| 1 | v2:a96a21763fd4 | `{findings: [...], sessionId: ...}` — ProposalReview round 1 |
| 2 | v2:4ef0e217c89c | `{ok: true, findings: []}` — revise agent |
| 3 | v2:c03f466c9c96 | `{ok: true, sessionId: ...}` — revise agent |
| 4 | v2:c740ec74efbe | `{findings: [...], sessionId: ...}` — ProposalReview delta round 1 |
| 5 | v2:1d74d8c55f5d | `{ok: true, sessionId: ...}` — revise agent |
| 6 | v2:5c77b44d2562 | `{findings: [...], sessionId: ...}` — ProposalReview delta round 2 |

**Zero of the 6 dispatches has an `authorIdx` field** (the shape `ProposalAuthors` results always
carry — see `prepare-milestone.js`'s `proposal-author-N` schema, `required: ['authorIdx', ...]`)
and **zero has the bare `{proposalText, ok, sessionId}` adjudicator shape**. All 6 are
`ProposalReview`/revise-cycle results. This mechanically confirms `ProposalAuthors` and
`Adjudicate` were never dispatched.

## Outcome of the proof run itself (disclosed honestly, not the thing being proven)

`{"outcome":"needs-human","reason":"split-recommended", "phase":"ProposalReview"}` after 1 full
review + 3 delta rounds (highRisk-class cap) hit the split checkpoint. This is a REAL, LEGITIMATE
bounded-convergence termination — not an infrastructure failure — caused by a genuine defect in
the fixture task's own body: it was a byte-identical copy of the sibling real task, so its `##
Acceptance Criteria`/`extra.acceptance` referred to a DIFFERENT task's id, and its own Proposal
became stale the moment the resume mechanism it described landed on master mid-review. This
defect is fixture hygiene, not a `resumeFromAdjudicatedProposal` defect — the mechanism being
proven (zero-author/adjudicate dispatch) is independent of whether the reviewed Proposal itself
was well-formed, and the review correctly caught the fixture's real self-reference problems.

## Cross-check: cold-path journal shape (for contrast, from the SAME session's earlier M197 runs)

The M196/DIR-119-D `prepare-milestone` dispatches (runs `wf_9aea9c8c-fc7`, `wf_c265f7ee-f08`,
`wf_474e7966-662`, `wf_25171733-3d1`, `wf_71f31cc4-bac`) — all cold dispatches, no
`resumeFromAdjudicatedProposal` — each began with exactly N `authorIdx`-shaped results
(N=2 or N=3 for highRisk) followed by one bare adjudicator result, confirming the cold path's
unchanged shape as the contrast baseline.
