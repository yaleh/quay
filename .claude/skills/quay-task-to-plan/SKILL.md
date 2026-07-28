---
name: quay-task-to-plan
description: Proposal→plan pipeline for development-class milestones — N independent proposals, M13 adjudication, write-back via Provider ABI, milestone plan authoring, convergent plan-check. Invoke with /quay-task-to-plan <task-id>.
allowed-tools: Bash, Read, Write
---

# quay-task-to-plan

## Spec

    λ(taskId, N=2, highRisk=false) → {proposal: Proposal, plan: PlanRecord}
    -- DIR-117 (M191): standardized N=2 default / N=3 ONLY on an explicit SELECT-time
    -- high-risk flag — this header previously said N=3 unconditionally while the actual
    -- prompt/design (prompts/proposal-subagent.md, docs/plans/3-7-quay-task-to-plan-skill.md)
    -- already used N=2 default; this drift is now resolved in the design doc's favor.

    read     :: TaskId → task_get → TaskRecord                    -- Provider ABI, never backlog.md
    propose  :: TaskRecord × N → [Proposal]                       -- N independent subagents, blank-slate
    adjudicate :: [Proposal] → ReconciledProposal                  -- M13-style, explicit on divergence
    write_back :: ReconciledProposal → task_write → readback       -- body-portable, DIR-011
    plan     :: ReconciledProposal → DraftPlan                     -- milestone-level, kept out of task tree
    check    :: DraftPlan × Round → DraftPlan | Converged          -- ~2-3 rounds, Phase-5 stopping rule

## contracts:

1. **Provider ABI for all reads/writes.** Use `mcp__quay__task_get`/`task_list`/`task_write` exclusively — never read/write backlog.md or any generated view as data source. CLI fallback: `quay task get <id> --json`.
2. **N independent blank-slate proposals.** N=2 by default; N=3 ONLY on an explicit SELECT-time high-risk flag (DIR-117) — never a per-invocation ad hoc choice. Dispatch N agents (`Agent` tool, `subagent_type: "general-purpose"`), each receiving the task record + context but NO access to other agents' outputs. Feed the `proposal-subagent` prompt (see prompts/). Collect all N proposals.
3. **M13-style adjudication.** Compare proposals on: approach divergence, scope overlap, risk coverage. Explicitly record where they agree (converge) vs disagree (diverge). Pick the best elements from each — never default to the first. Feed the `adjudicate-proposal` prompt.
4. **Write-back + readback.** `task_write(body=<reconciled proposal>)` then `task_get(readback)` — assert the write landed. Write to the task's `## Proposal` body section.
   - **DIR-125 (M193) bounded ProposalReview, when this Phase-6 Proposal is orchestrated by `prepare-milestone.js`:** that workflow (not this skill's own bare `propose`/`adjudicate`/`write_back` spec above) is the ONE place a grounded independent review runs after write-back, and it uses the SAME stopping-rule SHAPE as contract 6's plan-check below — ONE full review per generation, then up to 2 (3 if `highRisk`) focused-revise + independent-delta-review rounds against a typed, disposition-tracked finding ledger, gated by a 45m/75m soft budget and a split checkpoint. A caller MUST NOT restart Phase 6 from scratch (re-dispatch N new authors + a new adjudicator) just because a review found something — see `.claude/workflows/prepare-milestone.js` (canonical) for the actual mechanism; this note exists so the two documents never re-diverge on the stopping rule the way ProposalReview and PlanCheck once did (DIR-120/M192).
5. **Milestone plan authoring.** One subagent authors `docs/plans/<slug>.md` — kept OUT of the task tree. Plan references task ID(s) and reconciled proposal.
6. **Grounded convergent plan-check.** One subagent checks the plan against the proposal + known constraints. ONE stopping rule everywhere (DIR-117): at most 3 rounds; success requires F_i=0 (zero findings), not merely "no NEW substantive issues" — a nonzero-but-unchanged finding count is still a failure. Feed the `plan-check-subagent` prompt.

## Steps

### Phase 6 — Proposal

1. **Read.** `task_get <id>` via Provider ABI. Extract `body`, `labels`, `title`, `parent`/`children`.
2. **Dispatch N proposals.** N=2 independent agents by default (N=3 only on an explicit SELECT-time high-risk flag, DIR-117) with `subagent_type: "general-purpose"`, each fed the task + charter context. Prompt: `prompts/proposal-subagent.md`.
3. **Adjudicate.** One agent compares all N proposals. Prompt: `prompts/adjudicate-proposal.md`. Output: reconciled proposal with explicit convergence/divergence notes.
4. **Write back.** `task_write(id, body=<reconciled>)` → `task_get(readback)` → verify. Pasted evidence.

### Phase 7 — Plan

5. **Author plan.** One proposal agent writes `docs/plans/<slug>.md` referencing the reconciled proposal. Kept OUT of the task tree (DIR-011 portable).
6. **Convergent check.** One agent checks the plan. At most 3 rounds; success requires F_i=0 (DIR-117 standardized stopping rule — same rule everywhere, not a size-dependent convention).
7. **Commit.** `git add docs/plans/<slug>.md tasks/<id>.md && git commit -m "... "`.

**Reference:** `prompts/proposal-subagent.md` (agent prompt template for step 2); `prompts/adjudicate-proposal.md` (adjudication prompt for step 3); `prompts/plan-check-subagent.md` (plan-check prompt for step 6); `docs/plans/3-7-quay-task-to-plan-skill.md` (full Phase-6/7 design); `tasks/DIR-011.md` (portable proposal write-back).
