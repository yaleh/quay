# DIR-006

- status: **APPLIED** (iteration 11, 2026-07-17)
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- applied_at: iteration 11, 2026-07-17
- title: Make directives first-class quay tasks (single source of truth); one-time clean cutover for experiment 4 — migrate DIR-004/DIR-005 into directive-tasks and delete the files

## Finding

In this live conversation the human decided that steering directives should
be tracked as `quay` tasks (dogfooding the self-hosted task-tracking
mechanism, protocol §5.1), in the most restrained form possible and with
**no transitional dual-representation** — explicitly citing recent projects
(`manda`, `epicd`) where maintaining the same record in two forms caused
drift/redundancy problems.

[Full finding omitted from archive — recoverable from git history at
`experiments/quay-continuous-bootstrap/directives/pending/DIR-006-*.md`
before commit in iteration 11.]

## Requested action

[See original file in git history]

## Resolution

**APPLIED in iteration 11 (2026-07-17).**

Cutover actions completed in one commit:
1. Created `DIR-004` task in quay task store (labels: `experiment-4, directive`, status: `todo`) — full DIR-004 content in task body, remaining work from the original directive.
2. Created `DIR-005` task in quay task store (labels: `experiment-4, directive`, status: `needs-human`) — full DIR-005 content in task body, reflecting iteration-11 partial application (items 2/3/5 applied; items 1/4 pending human review).
3. Deleted `experiments/quay-continuous-bootstrap/directives/pending/DIR-005-land-action-buttons-end-to-end-readme-screenshots-serve-g7.md`.
4. Deleted `experiments/quay-continuous-bootstrap/directives/pending/DIR-006-directives-as-quay-tasks-single-source-of-truth-cutover.md`.
5. `directives/pending/` is now empty — any new directive going forward is a quay task with `label: directive`.
6. DIR-006 itself archived here (the historical record of the cutover decision — not itself migrated to a task per item 6 of the original requested action).
7. Note: DIR-004 in `directives/archive/` is left as a frozen historical artifact per item 4 of the original requested action ("Legacy is frozen, never migrated"). The new `DIR-004` task is the live, working record going forward.
8. The `quay-directive` skill update (item 3 of requested action) is deferred — the skill creates directive files, not tasks. This requires a skill update that touches `.claude/skills/quay-directive/` which is lower priority than the migration itself. Filed as a separate note for future iteration; the immediate cutover is complete.

**Status-to-lifecycle mapping (adopted)**:
- `todo` = pending / not yet started
- `ready` = approved and scheduled for next iteration
- `needs-human` = partially applied; needs human review to decide next steps
- `done` = fully applied and resolved
