---
id: exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH
title: "defect: it0-dod-check.ts clause8 uses first-match-wins on
  multi-milestone-labeled tasks, misreports N/A on 3 real done tasks"
status: todo
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Found by the M119 adversarial audit (`milestones/M119/audits/iteration-0-adversarial-audit.md`) while
independently verifying the clause8 hyphen-label regex fix (M119, commit `36d2a67`): 3 real,
`status: done` tasks — `exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`,
`exp5-M-GATE-MCP-PARITY-GAP` — each carry TWO `milestone:M<N>` labels: a low-numbered
`milestone:M37-discover-post-qeng` discovery label (added early, before the task was actually
scoped/landed) plus a real, later, ≥cutover landed label (`milestone:M51`/`M53`/`M56`
respectively). `it0-dod-check.ts`'s clause8 label scan (`taskText.match(/milestone:M-?(\d+)/i)`,
no `/g` flag) returns only the FIRST match in file order, which resolves to `37` — itself below the
`CLAUSE8_CUTOVER_MILESTONE_NUM = 40` threshold — so clause8 incorrectly N/A-passes all 3 tasks even
though their real landing milestone (51/53/56) is well past the cutover and the task's own body
genuinely does carry `## Proposal`/`## Plan` sections that clause8 should be checking.

**Confirmed pre-existing, NOT introduced or fixed by M119:** the pre-fix hyphenless regex
(`/milestone:M(\d+)/i`) already matched the hyphenless `milestone:M37-discover-post-qeng` label
identically — these 3 tasks were N/A both before and after M119's hyphen fix. This is a genuinely
separate defect (multi-label ambiguity), not a regression from M119.

## Plan
N/A — small, bounded fix: change the label scan to consider ALL `milestone:M<N>` matches in the task
text (use the `/g` flag or `matchAll`) and take the MAXIMUM matched number (the real/final landing
label, since a task only ever gains higher-numbered milestone labels over time as it's re-selected/
re-scoped, never a lower one after landing) rather than the first.

## Acceptance Criteria
- [ ] Clause8's label scan considers all `milestone:M<N>` labels present in a task's text, not just the first.
- [ ] `exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`, `exp5-M-GATE-MCP-PARITY-GAP` each show clause8 genuinely APPLYING (not N/A) when re-run — pasted output for all 3.
- [ ] `dod-fixture-selfcheck.sh` still passes (golden-diff evidence); a new fixture pair (multi-label task, low-then-high vs high-then-low label order) added to cover this case going forward.
- [ ] No other clause's verdict changes as a side effect.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 4 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.

## Not selected (M121)

Not selected — `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead: higher DIR-004-urgency
priority and an explicit chart-2 Δv mover named by DIR-064-B. This candidate is small, cleanly bounded,
and a good next exploit pick.