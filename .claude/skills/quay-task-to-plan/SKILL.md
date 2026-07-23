---
name: quay-task-to-plan
description: Proposal→plan pipeline for development-class milestones — N independent proposals, M13 adjudication, write-back via Provider ABI, milestone plan authoring, convergent plan-check. Invoke with /quay-task-to-plan <task-id>.
allowed-tools: Bash, Read, Write
---

# quay-task-to-plan

## Spec

    λ(taskId, N=3) → {proposal: Proposal, plan: PlanRecord}

    read     :: TaskId → task_get → TaskRecord                    -- Provider ABI, never backlog.md
    propose  :: TaskRecord × N → [Proposal]                       -- N independent subagents, blank-slate
    adjudicate :: [Proposal] → ReconciledProposal                  -- M13-style, explicit on divergence
    write_back :: ReconciledProposal → task_write → readback       -- body-portable, DIR-011
    plan     :: ReconciledProposal → DraftPlan                     -- milestone-level, kept out of task tree
    check    :: DraftPlan × Round → DraftPlan | Converged          -- ~2-3 rounds, Phase-5 stopping rule

## contracts:

1. **Provider ABI for all reads/writes.** Use `mcp__quay__task_get`/`task_list`/`task_write` exclusively — never read/write backlog.md or any generated view as data source. CLI fallback: `quay task get <id> --json`.
2. **N independent blank-slate proposals.** Dispatch N agents (`Agent` tool, `subagent_type: "general-purpose"`), each receiving the task record + context but NO access to other agents' outputs. Feed the `proposal-subagent` prompt (see reference/). Collect all N proposals.
3. **M13-style adjudication.** Compare proposals on: approach divergence, scope overlap, risk coverage. Explicitly record where they agree (converge) vs disagree (diverge). Pick the best elements from each — never default to the first. Feed the `adjudicate-proposal` prompt.
4. **Write-back + readback.** `task_write(body=<reconciled proposal>)` then `task_get(readback)` — assert the write landed. Write to the task's `## Proposal` body section.
5. **Milestone plan authoring.** One subagent authors `docs/plans/<slug>.md` — kept OUT of the task tree. Plan references task ID(s) and reconciled proposal.
6. **Grounded convergent plan-check.** One subagent checks the plan against the proposal + known constraints. ~2-3 rounds until converged (Phase-5 stopping: no new substantive issues). Feed the `plan-check-subagent` prompt.

## Steps

### Phase 6 — Proposal

1. **Read.** `task_get <id>` via Provider ABI. Extract `body`, `labels`, `title`, `parent`/`children`.
2. **Dispatch N proposals.** N=3 independent agents with `subagent_type: "general-purpose"`, each fed the task + charter context. Prompt: `prompts/proposal-subagent.md`.
3. **Adjudicate.** One agent compares all N proposals. Prompt: `prompts/adjudicate-proposal.md`. Output: reconciled proposal with explicit convergence/divergence notes.
4. **Write back.** `task_write(id, body=<reconciled>)` → `task_get(readback)` → verify. Pasted evidence.

### Phase 7 — Plan

5. **Author plan.** One proposal agent writes `docs/plans/<slug>.md` referencing the reconciled proposal. Kept OUT of the task tree (DIR-011 portable).
6. **Convergent check.** One agent checks the plan. Repeat until Phase-5 stopping rule (≤2 rounds with no new substantive issues).
7. **Commit.** `git add docs/plans/<slug>.md tasks/<id>.md && git commit -m "... "`.

**Reference:** `prompts/proposal-subagent.md` (agent prompt template for step 2); `prompts/adjudicate-proposal.md` (adjudication prompt for step 3); `prompts/plan-check-subagent.md` (plan-check prompt for step 6); `docs/plans/3-7-quay-task-to-plan-skill.md` (full Phase-6/7 design); `tasks/DIR-011.md` (portable proposal write-back).
