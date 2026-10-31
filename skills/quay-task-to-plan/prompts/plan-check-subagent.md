# plan-check-subagent — parametrized Task-agent prompt (Stage 7.1)

This is a **template**, not a script. The orchestrating skill (`SKILL.md`
plan-step section) fills in the `{{...}}` placeholders and dispatches this as
ONE maximally codebase-grounded check subagent, run AFTER the plan-author
subagent (a separate, unparametrized Task-agent authoring pass — see
`SKILL.md`'s plan-step section, step 1) has produced a draft milestone-level
plan record. This check subagent never authors the plan from scratch; it
iterates the SAME draft to convergence per the Phase-5 stopping rule
(`docs/plans/3-7-quay-task-to-plan-skill.md` Stage 5.3 — the
mechanism-level detail is deliberately not duplicated into
`inherited-core.md`; see `SKILL.md`'s plan-step section for the
citation note) — **check, not re-derive**.

## Parameters

- `{{task_id_or_milestone_ref}}` — the target task id(s) or `milestone:<id>`
  label this plan covers (read via `task_get`/`task_list`, never `backlog.md`,
  per §0's provider read/write contract).
- `{{reconciled_proposal}}` — the adjudicated `## Proposal` section from
  Stage 6.3 (`adjudicate-proposal.md`'s write-back), read fresh via
  `task_get` immediately before this dispatch — the plan step's INPUT.
- `{{draft_plan}}` — the current draft milestone-level plan record (round 1:
  the plan-author subagent's first pass; round 2+: the previous round's
  check-subagent output, i.e. this template is re-dispatched on itself,
  feeding its own prior output back in as `{{draft_plan}}`).
- `{{round_number}}` — 1, 2, or 3 (the Phase-5 stopping rule caps at
  ~2-3 rounds; the orchestrator refuses to dispatch a 4th round — see
  "Stopping rule" below).
- `{{budget_gate_result}}` — the raw output of the workspace's
  line-budget gate script run against the draft plan's declared
  phase/stage line estimates, computed by the orchestrator BEFORE this
  dispatch and handed in as ground truth (this subagent does not re-run
  the gate itself; it consumes the gate's PASS/FAIL verdict as one of
  its checks — see item 4 below).

## Prompt body (dispatch verbatim with parameters substituted)

```
You are the grounded plan-check for {{task_id_or_milestone_ref}}, round
{{round_number}} of at most 3. You have been given a draft milestone-level
plan record ({{draft_plan}}) and the reconciled proposal it must implement
({{reconciled_proposal}}). Your job is to CHECK this draft against the real
codebase — not to re-author it from a blank slate, and not to accept it
uncritically. Be maximally codebase-grounded: read real file paths, real
function/class signatures, real call-sites, real existing test files before
passing judgment on any claim the draft plan makes about them.

Perform these checks, in order:

1. SIGNATURE/CALL-SITE GROUNDING. For every file the draft plan says it will
   edit or create, and every function/API/CLI flag/tool name the draft plan
   cites, verify against the actual current codebase (Read/Grep/Glob — do not
   trust the draft's claims). Flag any reference to a signature, path, or
   tool that does not exist, or that exists but differs from how the draft
   describes it (plan-class errors — "both misread the same code the same
   way" is why a grounded CHECK, not a second blind re-derivation, is the
   right tool here).

2. STAGE ORDERING AND DEPENDENCY CHECK. Confirm the draft's phase/stage
   dependency order is actually satisfiable (no stage depends on a file or
   interface a LATER stage creates) and that the decomposition is
   milestone-level (phases → stages → dependency order), NOT a per-task
   child-task tree — this plan record is process documentation, kept OUT of
   the quay task tree entirely; if the draft plan writes or proposes writing
   stage-tracking as quay child tasks, flag this as a hard error (see
   "process is deliberately invisible in the Web UI/task board" in SKILL.md).

3. PER-STAGE TDD ACCEPTANCE CHECK. Confirm every stage in the draft carries
   an EXPLICIT `[code]` or `[prose]` tag (proposal §15.2 — classification is
   mandatory and explicit, recorded at plan-author time, not decided ad hoc
   at stage-completion time) and that its stated TDD acceptance criterion
   matches its tag using the code-vs-prose classifier (SKILL.md's TDD
   hard-gate section): `[code]` stages require literal >=80% line coverage;
   `[prose]` stages require the mechanical-check discipline (gate-hash /
   projection-check it0-* runs, scaffold-lint, isolation test), never a
   coverage percentage. Flag any stage missing its `[code]`/`[prose]` tag, or
   whose acceptance criterion is misclassified (e.g. a `[prose]` stage
   claiming a coverage percentage it cannot produce). A stage that
   genuinely touches both MUST be split, or have its `[code]` files' >=80%
   figure computed separately from its `[prose]` files' mechanical-check net
   — flag a mixed stage that does not do this.

4. BUDGET GATE CONSUMPTION. Consume {{budget_gate_result}} (the
   it0-ceiling-line-budget-check.sh verdict, already run by the orchestrator
   against this draft's declared line estimates) as ground truth — do not
   re-run the gate yourself. If it is FAIL, the draft plan MUST be revised to
   fit under budget (>=phase <=500 lines, >=stage <=200 lines,
   >=milestone <=2000 lines per inherited-core.md's ceiling) before this
   check can pass; state this explicitly in your output. If PASS, cite the
   raw gate output as evidence.

5. CONVERGENCE CALL. Compare this round's draft against the PREVIOUS round's
   draft (if {{round_number}} > 1 — for round 1, compare against the
   plan-author's first pass). Report `F_i` = the COUNT of MATERIAL findings
   this round (an issue from items 1-4 above that would change the plan's
   content if fixed — NOT cosmetic wording/formatting changes). Per the
   precise stop condition (proposal §14.2, the Phase-5 stopping rule — plan
   Stage 5.3; this mechanism-level detail was deliberately not duplicated
   verbatim into inherited-core.md by M18, see SKILL.md's plan-step section
   for the citation note): CONVERGED = `F_i = 0` for this round (this round
   IS the confirmation, no extra confirmatory round required). The
   orchestrator stops dispatching further rounds once `F_i = 0` fires, or
   after round 3, whichever comes first — round 3 with `F_i > 0` still
   escalates to a human/architect-review decision rather than iterating
   further (this subagent itself does not enforce the round cap — it only
   reports `F_i` and its convergence verdict; the orchestrating skill
   enforces the cap and the escalation).

6. OUTPUT. Produce the (possibly revised) plan record in the SAME
   phases/stages/dependency-order/per-stage-budgets/per-stage-TDD-acceptance
   shape as {{draft_plan}}, with every flagged error from items 1-4 corrected
   in place (not just listed as a comment) if this round found any, and your
   explicit `F_i` count and convergence verdict from item 5 as a trailing
   note. Do NOT author a wholly new plan structure — you are checking and
   correcting the given draft, not replacing it with your own independent
   decomposition (that would be plan RE-DERIVATION, which is declined by
   default for this class per the Phase-5 stopping rule; only escalate to
   re-derivation if round 3 still finds `F_i > 0` AND the disagreement is a
   decomposition-shape question, not a ground-truth-checkable fact — proposal
   §7's own carve-out — and state this explicitly as an exceptional outcome
   if it happens).
```

## Stopping rule (orchestrator-enforced, not subagent-enforced)

Per proposal §14.2 (plan Stage 5.3, §7): the
orchestrating skill re-dispatches this template, feeding each round's output
back in as the next round's `{{draft_plan}}`, until either (a) a round's
CONVERGENCE CALL (item 5) reports `F_i = 0`, or (b) 3 rounds have
run — whichever comes first; if round 3 still reports `F_i > 0`, escalate to
a human/architect-review decision rather than dispatching a 4th round. Plan
**re-derivation is declined by default**
(the check-not-re-derive rule) — only escalate to a fresh independent
re-derivation if a round's item 6 output explicitly states the exceptional
"draft is fundamentally unsound" outcome, and only as an ad hoc, explicitly
justified exception, never a silent per-task judgment call.

## Non-goals for this template

- Does not author the FIRST draft plan (that is the separate, unparametrized
  plan-author dispatch — see `SKILL.md`'s plan-step section, step 1 — which
  runs once, before this template's round 1).
- Does not write the plan record to a quay task's `body` or `extra` — the
  plan record is milestone-level process documentation kept OUT of the task
  tree entirely (see "process is deliberately invisible in the Web UI/task
  board" in `SKILL.md`); this template's output is handed back to the
  orchestrating skill/human, not written via `task_write`.
- Does not run the TDD >=80% hard gate itself (that happens per-stage, during
  implementation — see `SKILL.md`'s TDD hard-gate section); it only checks
  that each stage's acceptance criterion in the draft plan correctly STATES
  which gate branch (coverage-% vs mechanical-check) applies.
