---
name: quay-task-to-plan
description: Proposal step (Phase 6) + plan step (Phase 7) of the quay-task-to-plan pipeline — for a development-class milestone's grouped task(s), run N independent blank-slate subagents to draft proposals, adjudicate divergence M13-style, write the reconciled proposal back to the task's body via the Provider ABI (task_write/task_get, portable per DIR-011), then author a milestone-level plan record and run a maximally codebase-grounded convergent check against it, enforcing the TDD ≥80% hard gate (code-vs-prose classifier) per stage. Invoke after a development-class milestone's tasks are grouped (milestone:<id> label / M12 parent-children) and before proposal-to-plan's own architect-review + implementation runs. NOT yet wired into OUTER-LOOP.md DISPATCH (manual invocation only) — see "Relationship / bootstrap" below for which milestone is the first true-dogfood customer.
allowed-tools: Bash, Read, Write
---

# quay-task-to-plan

    read     :: TaskId → task_get/task_list → TaskRecord            -- Provider ABI, never backlog.md
    propose  :: TaskRecord × N → [Proposal]                          -- N independent, blank-slate, no inter-agent comms
    adjudicate :: [Proposal] → ReconciledProposal                    -- M13-style; explicit on convergence vs divergence
    write_back :: ReconciledProposal → task_write → task_get(readback) -- body-portable, regeneratable, not write-once
    plan     :: ReconciledProposal → PlanRecord                      -- milestone-level, phases/stages/budgets/TDD-acceptance, NOT a child-task tree
    plan_check :: PlanRecord × Round(≤3) → Converged | Findings       -- maximally codebase-grounded CHECK, not re-derivation
    tdd_gate :: Stage → CodeCoverage(≥80%) | MechanicalCheck           -- code-vs-prose classifier, HARD GATE, not skippable

This skill implements **Phase 6 AND Phase 7** of
`docs/plans/3-7-quay-task-to-plan-skill.md`: Phase 6 is the **proposal step**
(N-independent-subagent authoring + adjudication + write-back to the task's
`body`); Phase 7 (this milestone, M22) is the **plan step** (milestone-level
plan record + grounded convergent check), the **TDD ≥80% hard gate**, and the
**dogfooding/bootstrap-resolution wiring**. It is modeled structurally on
`.claude/skills/quay-directive/SKILL.md`'s shape (YAML frontmatter, numbered
`## Steps`, explicit provider-tool citations, evidence-by-readback discipline)
and on `~/.claude/skills/proposal-to-plan/SKILL.md`'s isolated-Task-agent
step structure (each step = one independent agent invocation, sequential, not
parallel-and-merged).

**Still explicitly OUT OF SCOPE for this skill as currently built:**
`OUTER-LOOP.md` DISPATCH wiring (this skill is not yet invoked automatically
for any milestone — see "Relationship / bootstrap" below) and
de-optionalizing the two-class diversity policy (that remains Phase-5/
`inherited-core.md` territory, already built at M18, referenced but not
re-wired here). Until DISPATCH wiring lands, invoke this skill manually
(`/quay-task-to-plan <task-id-or-ids>`) for a development-class milestone's
grouped tasks.

## 0. Provider read/write contract (Stage 6.1)

Per DIR-009 item 8's provider-tool convention (`exp5-task-backlog-primitive-
projection.md` §8, "SELECT reads quay via the provider tool — read path"):
this skill uses the **Provider ABI tool surface exclusively** — it never
reads or writes `backlog.md` or any other generated markdown view as a data
source or sink.

- **Read.** MCP `mcp__quay__task_get` (single task, including current `body`,
  `labels`, `parent`/`children`) and `mcp__quay__task_list` (candidate /
  milestone-membership queries, e.g. `label: milestone:<id>`) — preferred
  in-session. CLI fallback when MCP tools are unavailable in the running
  context: `node packages/quay/bin/quay.js task list --label milestone:<id>
  --json` / `task get <id> --json`.
- **Write.** MCP `mcp__quay__task_write` — **the full-field write path**,
  never a status-only patch. CLI fallback: **`packages/quay/bin/quay.js task
  edit` is deliberately status-only in v1** (per QN-024's comment in
  `packages/quay/bin/quay.js` — it errors/no-ops on `--labels`/`--extra`/
  `--body`), so it **cannot** perform this skill's write-back. For the native
  provider (this repo's default, `.quay/config.yml`), the CLI fallback is the
  provider's own richer CLI: `QUAY_NATIVE_TASKS_DIR=./tasks node
  packages/quay-native/bin/quay-native.js task edit <id> --body "..." --extra
  '{"proposalStatus":"..."}' --json` — same "never the Core CLI's `task edit`
  for a body/extra write" discipline `quay-directive`'s own SKILL.md states.
  If a future provider is active, check that provider's own CLI for the
  equivalent richer write path rather than assuming this one.
- **Check.** MCP `mcp__quay__task_check` (or CLI `task check`) for any
  gate-mechanics read a later Phase-7 plan-check/TDD-gate step will need —
  this skill's own proposal step does not call it, but the contract is
  documented here so Phase 7 does not have to re-derive it.

### DIR-011 portability rule (body-portable, extra-native-only, GitHub degradation)

Per the portable-metadata convention (`inherited-core.md`, inserted verbatim
by M16-cli-edit-parity-impl): a task's proposal is **portable metadata** — it
MUST live in the task's `body`, never solely in `extra{}`.

- **`body`** carries the authoritative `## Proposal` section (§2 below) — this
  is what makes the proposal visible and portable across both the native
  provider and GitHub.
- **`extra.proposalStatus`** (e.g. `"adjudicated"` / `"pending"`) is an
  **optional, native-only convenience mirror** for query performance — it is
  NEVER the sole record of the fact; the `## Proposal` body section is
  authoritative and sufficient on its own.
- **GitHub degradation.** `body` and `labels` writes are fully portable
  (no degradation needed); `parent`/`children` epic-decomposition writes are
  fully supported on GitHub post-M12 (checkbox-in-body convention,
  `extractChildRefs`/`CHILD_CHECKBOX_RE` in `packages/quay-github/src/
  github-client.js`). The **one** path that still hard-errors on GitHub is
  `extra{}` (PR-ABI-001's existing hard-error floor, unchanged, not reopened
  by this skill) — since `extra.proposalStatus` is explicitly optional and
  non-load-bearing, the skill's write-back step MUST check provider
  capability before attempting the `extra` write (never attempt-then-catch a
  hard error as normal control flow) and simply omit it on GitHub. This
  skill introduces no new `extra{}` dependency beyond that existing floor.

### M12 milestone→task grouping (reused unchanged)

This skill does not invent a new grouping mechanism. A development-class
milestone's tasks are already grouped via the `milestone:<id>` label (the
provider-portable grouping key, since GitHub issues have no native
parent-link field) before this skill runs — the skill's read step (`task_list
--label milestone:<id>`) simply consumes that existing grouping. `parent`/
`children` (the real, bidirectionally-writable M12 WRITE surface,
`packages/quay-native/src/store.js:264-307` native / `github-client.js`
GitHub) is reserved for epic-decomposition (a proposal concluding a task
should be split into sub-tasks before planning) — a different relationship
than milestone membership — and this skill calls `task_write` with
`parent`/`children` exactly as any other quay client would if an
adjudicated proposal recommends a split; it never uses `parent`/`children`
as the milestone-grouping key itself.

## Steps

1. **Resolve target task(s).** Given a task id or a `milestone:<id>` label
   (the invocation argument), call `mcp__quay__task_list` (filtered by
   `label: milestone:<id>`) or `mcp__quay__task_get` (single id) to read the
   current `body`/`title`/`labels`/`parent`/`children` for every task this
   invocation covers. This is read-only — nothing is written in this step.

2. **Proposal step (Stage 6.2) — N independent subagents.** For each target
   task, dispatch **N=2 independent Task-agent runs** (default; raise N only
   for a task explicitly flagged high-stakes at SELECT time, never as a
   silent per-task judgment call inside this skill) using the parametrized
   template at `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md`.
   - **Blank-slate-leaning, no inter-agent communication.** Each subagent
     receives only: the task's current `body`/title/labels, the milestone
     charter (if one exists yet) or the raw candidate description
     (pre-charter), and the write-back shape instruction (§2 below). Agents
     are NOT shown each other's output and do NOT run in the same context —
     this is what makes divergence a real signal rather than an artifact of
     shared anchoring.
   - **Persona differentiation** (cheap diversity widener, e.g. "propose the
     minimal-surface-area approach" vs. "propose the approach most
     consistent with existing patterns in this codebase") is applied via the
     template's `{{persona}}` parameter — see the prompt file for the two
     default personas.
   - **Writes nothing to the task.** Each proposal subagent's output is
     returned to the orchestrating context (this skill), never written to
     the task directly — this avoids a race/overwrite hazard between N≥2
     concurrent writers and defers all writing to step 3.

3. **Adjudication + write-back (Stage 6.3).** Dispatch ONE further Task-agent
   run using `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md`,
   giving it BOTH (all N) raw proposals from step 2. It must:
   a. Determine **convergence** (same approach, differing only in low-stakes
      framing) vs **divergence** (a real approach-level disagreement, the
      M13 DIR-010-namespace precedent) — explicitly, not silently.
   b. For divergence: adjudicate a winner, or explicitly synthesize a merged
      approach, and record the adjudication note (§2's `### Adjudication
      note`). For convergence: write back the (near-)identical content with
      no adjudication note required — do not fabricate a divergence to fill
      the section.
   c. Preserve the alternatives-considered-and-rejected list from whichever
      proposal(s) are not selected — never silently discard it.
   d. **Write back via `mcp__quay__task_write`** (never any other channel —
      no direct file edits to the native store, even though this skill runs
      inside the same repo that hosts it) to the task's `body`, using the
      **idempotent full-section replace** discipline: replace the existing
      `## Proposal` heading through (but not past) the next `##` heading if
      present, otherwise append the section. This is the SAME regeneration
      discipline the M05 projection design already uses for `## Status
      mirror` — a task's `## Proposal` is **not write-once**: because task
      granularity is variable (DIR-009), the section MUST be regenerable
      (fully replaced, never appended-and-orphaned) whenever the task is
      re-grouped into a different milestone or its proposal is
      re-requested. Optionally also write `extra.proposalStatus` (native
      only, capability-checked first per the GitHub-degradation rule above).
   e. **Read back with `mcp__quay__task_get`** immediately after the write,
      and show the raw tool output as evidence the write landed with the
      expected `## Proposal` content — same evidence discipline as
      `quay-directive`'s own step 5d.

4. **Relationship to `proposal-to-plan`'s architect-review — STRENGTHENS, does
   not replace.** This skill's N-independent-proposal + adjudication step is
   an ADDED adversarial pass inserted UPSTREAM of `proposal-to-plan`'s
   existing sequential architect-review (`~/.claude/skills/proposal-to-plan/
   SKILL.md` Step 2/4), not a substitute for it. The chain for a
   `quay-task-to-plan`-driven task is:

   ```
   N independent proposal authors → adjudication → [existing] architect-review → plan (Steps 5-6 below) → [existing] architect-review → implementation (Step 7 TDD gate) → commit
                                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^ unchanged, reused as-is, still runs every time
   ```

   If the N proposals converge, architect-review proceeds exactly as it
   would with a single author (negligible added cost). If they diverge,
   architect-review still runs afterward on whichever approach adjudication
   selected — it is never skipped, and never asked to arbitrate between the
   raw candidate proposals itself (that is adjudication's job).

5. **Plan step: author (Stage 7.1).** Once the reconciled proposal has
   passed `proposal-to-plan`'s existing architect-review (step 4, unchanged),
   dispatch ONE Task-agent run whose job is to author a **milestone-level
   plan record** from the reconciled proposal — the exact shape this
   repository's own `docs/plans/N-*.md` documents already use: **phases,
   stages, dependency-order between stages, per-stage line budgets
   (≤200/stage, ≤500/phase, ≤2000/milestone — the Phase-3 sizing convention,
   `inherited-core.md`'s "Milestone ceiling expansion" subsection, unchanged
   and only referenced here), and per-stage TDD ≥80% acceptance** (see §Step
   7 below for the code-vs-prose classifier each stage's acceptance must
   commit to up front).

   **The plan record is milestone-level and is explicitly NOT written as a
   child-task tree.** The quay task board tracks VALUE (what got delivered,
   at what cost); the plan record tracks PROCESS (how the delivery is
   sequenced) — these are deliberately different layers. Stage-by-stage plan
   progress is **NOT rendered in the Web UI or task board** as child tasks,
   sub-issues, or checklist items; the plan record lives in the plan
   document / task `body` only. State this explicitly to the plan-author
   subagent so it does not, e.g., attempt to `task_write` a `children` array
   of one task per stage — that would silently violate this invariant even
   though nothing would technically error.

6. **Plan step: grounded convergent check (Stage 7.1).** After the
   plan-author subagent (step 5) produces a plan record, dispatch ONE
   **maximally codebase-grounded** Task-agent run using
   `.claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md` — this
   is a CHECK, not a second independent plan authored blind (plan
   re-derivation is **declined by default** for the development class, per
   `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 5 Stage 5.3; available
   ad hoc only if a decomposition is genuinely contested). The check
   subagent reads real signatures/call-sites/existing file layout — not the
   plan's prose claims about them — and verifies mechanical correctness,
   stage ordering, budget compliance, and TDD-acceptance concreteness (see
   the prompt file for the full 5-point checklist). **This check consumes
   the Phase-4 plan-time budget gate
   (`experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh`,
   the canonical script name M18 actually shipped — plan 3-7 Phase 4's text
   names it `it0-plan-budget-check.sh`, but that filename never landed; cite
   the real script, not the plan's stale name) as one of its own
   ground-truth checks**, not a separate step the orchestrating skill must
   remember to run independently.

   **Stopping rule (reused, not reinvented):** iterate plan-author-revise →
   grounded-check, capped at **~2-3 rounds**, using the SAME
   ΔV-small-and-stable convergence discipline exp5's own outer loop already
   applies (`docs/plans/3-7-quay-task-to-plan-skill.md` Phase 5 Stage 5.3) —
   the check subagent reports CONVERGED once a round produces zero material
   findings, or NOT-CONVERGED with bounded, cite-able findings for a
   targeted (not wholesale) revision. If round 3 is still NOT-CONVERGED,
   this is reported as stopping-rule exhaustion and escalated to a human
   decision rather than silently looping a 4th round.

7. **TDD ≥80% hard gate (Stage 7.2).** Once the plan converges (step 6),
   implementation proceeds stage-by-stage. **Every stage's completion is
   gated on the TDD ≥80% rule below — this is a HARD GATE, not an
   evidence-paste courtesy.** See "TDD ≥80% hard gate" section below for the
   full code-vs-prose classifier and the `Constraints`-block entry that
   forbids skipping it. This step does not reinvent `feature-developer`'s
   TDD-implementation loop (RED→GREEN→REFACTOR, worktree-isolated Task
   agents) — where a stage's shape fits that loop, this skill's
   implementation step wraps/reuses it rather than re-authoring a competing
   TDD harness (see "Relationship / bootstrap" below).

## TDD ≥80% hard gate (Stage 7.2)

**This gate is STRICTER than exp5's current general-purpose "paste test
output as evidence" convention.** Because this skill's pipeline runs a
**single implementation** in the middle (independence is spent at both ends —
proposal step upstream, the existing adversarial-audit gate downstream — not
in the middle, per `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 5 Stage
5.2's two-ends-clamp), the TDD gate is the **primary correctness net** for
the implementation itself: there is no second independent implementer to
catch a defect the single implementer missed, so the gate must be mechanical
and non-negotiable rather than advisory.

**Code-vs-prose classifier** — applied per stage, not once per milestone:

- **Executable code stages** (JS/shell/`.mjs`/any stage whose `Files:` line
  lists source files that run) — the gate is **literal ≥80% line coverage**,
  measured with the project's existing coverage tooling (e.g. `c8`/node
  `--test` coverage reporting, matching the convention
  `docs/plans/3-7-quay-task-to-plan-skill.md`'s own Phase 4 Stage 4.2 used
  for `it0-ceiling-line-budget-check.sh`'s TDD acceptance). A stage's
  coverage number MUST be pasted as raw tool output, not summarized.
- **Prose / skill / template / manifest stages** (a `SKILL.md` edit, a
  prompt template, a doc/plan file, a frontmatter manifest — this skill's
  OWN Phase 6/7 implementation is itself almost entirely this class) — a
  coverage percentage is meaningless (there is no executable line to run a
  coverage tool over), so the gate **degrades to the mechanical-check
  discipline** `docs/plans/2-exp5-driver-deliverability-packaging.md`
  established: gate-hash / projection-check `it0-*.sh` runs still PASS
  unchanged (`it0-gate-hash-check.sh`, `it0-dir-projection-check.sh`,
  `it0-ceiling-line-budget-check.sh`), a **scaffold-lints-clean** check
  (no dangling/unresolved references left in the emitted prose asset), and
  an **isolation test** appropriate to the asset (for a skill file: does it
  parse as valid frontmatter + resolve every tool/skill/script citation it
  makes — see "Prose-asset mechanical checks" below). **State explicitly:
  this classifier applies to this very skill's own implementation** (Phases
  6 and 7 are themselves prose/skill-asset stages, not executable-code
  stages — the mechanical-check branch, not the coverage-% branch, is what
  actually gates M20/M22's own Done-when clause 5).

## Constraints

```
require(target task(s) resolved via task_get/task_list, never backlog.md) ∧
propose: N=2 default, independent, blank-slate, no inter-agent communication ∧
propose: writes nothing to the task (defers to adjudication) ∧
adjudicate: exactly one write-back step, explicit convergence-vs-divergence call ∧
write_back: task_write on body (full-section replace of `## Proposal`, not write-once) ∧
write_back: extra{} only as optional native-only mirror, capability-checked before GitHub attempt ∧
write_back: task_get readback pasted as evidence ∧
forbid(status-only `task edit` as the write path) ∧
forbid(architect-review skip or replacement) ∧
plan: milestone-level record (phases/stages/dependency-order/budgets/TDD-acceptance) ∧
forbid(plan rendered as a child-task tree in the Web UI/task board) ∧
plan_check: maximally codebase-grounded, CHECK not re-derivation, N=1 (not N-independent) ∧
plan_check: consumes Phase-4 budget gate (`it0-ceiling-line-budget-check.sh`) as a ground-truth check ∧
plan_check: stopping rule ~2-3 rounds, ΔV-small-and-stable convergence, reused from exp5's own stop condition ∧
forbid(plan re-derivation as the default — ad hoc only, genuinely contested decomposition) ∧
tdd_gate: HARD GATE, per stage, not skippable, not an evidence-paste courtesy ∧
tdd_gate: code stages → literal ≥80% line coverage (pasted raw tool output) ∧
tdd_gate: prose/skill/template/manifest stages → mechanical-check discipline (gate-hash/projection-check/scaffold-lint/isolation test), NOT a coverage number ∧
forbid(skipping the TDD gate for any stage, code or prose) ∧
forbid(DISPATCH auto-wiring into OUTER-LOOP.md — manual invocation only, this milestone) ∧
forbid(de-optionalizing the two-class diversity policy — Phase-5/M18 territory, referenced not re-wired)
```

## Output

```
outputs = {
  proposals:     [Proposal] (N raw, ephemeral — not persisted to the task),
  reconciled:    ReconciledProposal (adjudicated or converged),
  task_write:    raw tool-call result,
  task_get:      raw readback tool-call result (evidence the write landed),
  plan_record:   PlanRecord (milestone-level; phases/stages/dependency-order/
                 per-stage budgets/per-stage TDD acceptance; kept in the plan
                 document / task body, NEVER materialized as child tasks),
  plan_check:    CONVERGED | NOT-CONVERGED (per round, ≤3 rounds) + the raw
                 `it0-ceiling-line-budget-check.sh` tool output consumed as
                 evidence,
  tdd_evidence:  per stage — {coverage_pct: N (code stages)} OR
                 {mechanical_checks: [gate-hash PASS, scaffold-lint PASS,
                 isolation-test PASS, ...]} (prose stages) — raw, not
                 summarized
}
```

## Relationship / bootstrap (Stage 7.3)

**Bootstrap chicken-and-egg, resolved explicitly** (`docs/plans/
3-7-quay-task-to-plan-skill.md`'s "Dogfooding note", preserving the original
proposal draft's §11): `quay-task-to-plan` **cannot build its own
deliverable** — a skill cannot run itself before it exists. Concretely:

- **The skill-implementation milestones themselves (Phase 6 = M20, Phase 7 =
  THIS milestone, M22) ran/run through the existing `proposal-to-plan`
  skill** (the bootstrap substrate), not through `quay-task-to-plan`. This
  is not a gap to be closed later — it is the permanent, structurally
  necessary shape of how this skill came to exist. `quay-task-to-plan`'s own
  design was (and continues to be, at each phase) cross-checked against
  `proposal-to-plan` step-by-step (frontmatter shape, numbered `## Steps`,
  isolated-Task-agent-per-step structure — see the skill header above).
- **From the SECOND development-class milestone onward, `quay-task-to-plan`
  is the standing route.** The named first true-dogfood candidates are the
  still-deferred implementation milestones already materialized on
  `backlog.md`: `M-TASK-BACKLOG-PROJECTION-IMPL` (DIR-015 item 2, DIR-016
  retroactive-sweep row) and a future release-cadence implementation.
  **Explicitly NOT** `M16-cli-edit-parity-impl` — that milestone is already
  complete (`milestone_counter` passed 16 long before this skill existed),
  so it cannot retroactively become a dogfood instance; it is cited here
  only to rule it out, not as a candidate.
- This charter (M22) does **not** wire a live end-to-end dogfooding run
  against `M-TASK-BACKLOG-PROJECTION-IMPL` — that is
  `M-TASK-BACKLOG-PROJECTION-IMPL`'s own future milestone's job, once
  SELECTed. This section states the bootstrap-resolution + names the
  customer; it does not execute the dogfood run itself (see charter
  "Explicitly OUT of scope").

**`feature-developer` reuse note** (proposal §8 point 6 / §17): this skill
does **not** reinvent `feature-developer`'s TDD-implementation review loop
(RED→GREEN→REFACTOR, parallel worktree-isolated Task agents, self-analysis
validation — see `~/.claude/skills/feature-developer/SKILL.md` phases 3-9).
Where a plan stage's shape fits that loop (an executable-code stage with a
clear RED/GREEN cycle), Step 7's implementation dispatch should **wrap or
invoke `feature-developer`'s existing implementation phase** rather than
re-authoring a competing TDD harness — the reuse principle is "reuse/wrap
where it fits, don't reinvent the review loop," not "always delegate
unconditionally": a prose/skill/manifest stage (the mechanical-check branch
of the TDD classifier above) has no RED/GREEN code cycle to hand off, so for
those stages this skill's own implementation step runs directly, per the
mechanical-check discipline, without invoking `feature-developer` at all.

**Output contract** (restated here for the plan+implementation pipeline,
distinct from the Phase-6-only `Output` block above): tasks carry their
proposals in `body` (Phase 6, unchanged); a **milestone-level plan record**
(Phase 7) lives in the plan document (or, for a task-scoped plan, the task's
`body` under a `## Plan` section using the same full-section-replace,
not-write-once discipline as `## Proposal`) — never as a set of child tasks.

**Non-goals** (proposal §10, restated for Phase 7): this skill does **not**
delete or fork `proposal-to-plan` — it is a narrower, task-native front-end
for the development class, coexisting with `proposal-to-plan` as the
methodology/design class's continuing route. It does **not** render plan
stage-progress in the Web UI or task board (see step 5 above — the plan
record is deliberately process-invisible there). It does **not** wire
`OUTER-LOOP.md` DISPATCH to invoke this skill automatically for any real
milestone (explicitly out of scope this charter — manual invocation only,
see the skill-header note above). It does **not** make the two-class
diversity policy non-discretionary (Phase-5/M18 territory, referenced, not
re-wired here).
