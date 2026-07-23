---
name: quay-directive
description: Record a directive as a TASK-CANONICAL quay task (DIR-028) — task IS the single source of truth. Auto-detects active experiment.
allowed-tools: Bash, Read, Write, Edit
---

# quay-directive

## Spec

    λ(conversation, opts?) → CanonicalTask

    detect  :: Context → ActiveExperiment                           -- bash: grep '\\*\\*Status\\*\\*:' experiments/*/README.md
    next_id :: ActiveExperiment → DIR-NNN                           -- bash: quay task list --label directive --json | sort | +1
    author  :: ConversationContext × ActiveExperiment → Directive   -- from conversation, not invented
    create  :: Directive → task_write(label:directive, body, schema:v1) → task_get(readback)
    land    :: CanonicalTask → git add + commit                     -- ff-merge if worktree

**DIR-028 (TASK-CANONICAL):** No `directives/*.md` file, no projection, no anti-drift check. The task at `tasks/DIR-NNN.md` IS the one canonical record.

## contracts:

1. **Experiment detection**: grep `experiments/*/README.md` for `**Status**:` → verify exactly one `active`. Ambiguous or zero → STOP. Pasted output.
2. **ID computation**: `quay task list --label directive --json | jq -r '.tasks[].id' | sort | tail -1` → parse number, +1, zero-pad. Recompute every invocation; never reuse from memory. Pasted.
3. **Write-back verification**: after task_write → `task_get <id>` and assert body match. Pasted `diff <(echo "$written") <(quay task get <id> --json | jq -r '.task.body')` → empty.

## Steps

1. **Detect experiment.** `grep -l 'Status:' experiments/*/README.md | while read f; do echo "$f: $(grep 'Status:' "$f")"; done` → identify active.
2. **Compute ID.** `quay task list --label directive --json | jq -r '.tasks[] | select(.id | test("^DIR-\\\\d+$")) | .id' | sort -t- -k2 -n | tail -1` → +1.
3. **Author in this conversation.** `## Proposal` (approach from conversation) + `## Plan` (`N/A — directive resolved via a milestone`) + `## Finding` + `## Requested action` + `## Acceptance Criteria` (checklist, each runnable) + `## Definition of Done` (real-landing, DIR-026 Reading A). All boxes `- [ ]` (DIR-020). Set `extra.schema:"v1"`.
4. **Write via Provider ABI.** `task_write(id, title, labels:["directive"], body, extra:{dirStatus:"pending", schema:"v1"})` → `task_get(readback)` → verify.
5. **Commit.** `git add tasks/DIR-NNN.md && git commit -m "DIR-NNN: <title>"`.

**Reference:** `docs/proposals/exp5-crystallization-strategy.md` (single-source-of-truth discipline); `tasks/DIR-028.md` (Plan A task-canonical); `tasks/DIR-026.md` (SPLIT-OR-COMMIT Reading A).
