---
name: quay-task-to-plan
description: Proposal step (Phase 6) + plan step + TDD ≥80% hard gate (Phase 7) of the quay-task-to-plan pipeline — for a development-class milestone's grouped task(s), run N independent blank-slate subagents to draft proposals, adjudicate divergence M13-style, write the reconciled proposal back to the task's body via the Provider ABI (task_write/task_get, portable per DIR-011), then author a milestone-level plan record and iterate a grounded convergent check on it before implementation, gated per-stage by the TDD ≥80% code-vs-prose classifier. Invoke after a development-class milestone's tasks are grouped (milestone:<id> label / M12 parent-children) and before proposal-to-plan's own architect-review + commit step runs. See the "Relationship / bootstrap" section below before invoking for a skill-implementation milestone.
allowed-tools: Bash, Read, Write
---

# quay-task-to-plan

    read     :: TaskId → task_get/task_list → TaskRecord            -- Provider ABI, never backlog.md
    propose  :: TaskRecord × N → [Proposal]                          -- N independent, blank-slate, no inter-agent comms
    adjudicate :: [Proposal] → ReconciledProposal                    -- M13-style; explicit on convergence vs divergence
    write_back :: ReconciledProposal → task_write → task_get(readback) -- body-portable, regeneratable, not write-once
    plan     :: ReconciledProposal → DraftPlan                       -- one author subagent, milestone-level, kept OUT of the task tree
    check    :: DraftPlan × Round → DraftPlan | Converged             -- one grounded check subagent, ~2-3 rounds, Phase-5 stopping rule
    gate     :: Stage → Coverage% | MechanicalCheck                   -- TDD ≥80% hard gate, code-vs-prose classifier

This skill implements **Phase 6** (the **proposal step**: N-independent-
subagent authoring + adjudication + write-back to the task's `body`) AND
**Phase 7** (the **plan step**: author + grounded convergent check producing
a milestone-level plan record kept out of the task tree; the **TDD ≥80% hard
gate** with its code-vs-prose classifier; and the dogfooding/bootstrap wiring)
of `docs/plans/3-7-quay-task-to-plan-skill.md`. It is modeled structurally on
`.claude/skills/quay-directive/SKILL.md`'s shape (YAML frontmatter, numbered
`## Steps`, explicit provider-tool citations, evidence-by-readback discipline)
and on `~/.claude/skills/proposal-to-plan/SKILL.md`'s isolated-Task-agent
step structure (each step = one independent agent invocation, sequential, not
parallel-and-merged).

**`OUTER-LOOP.md` DISPATCH wiring and de-optionalizing the two-class
diversity policy remain explicitly OUT OF SCOPE for this skill as currently
built** (DIR-014 items covering those two points are not addressed by this
Phase-7 build — see `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 7's own
scope and this skill's "Relationship / bootstrap" section below for why: the
first skill-implementation milestone itself runs on `proposal-to-plan`, not
this skill). Until that wiring lands, invoke this skill manually
(`/quay-task-to-plan <task-id-or-ids>`) for a development-class milestone's
grouped tasks — nothing in `OUTER-LOOP.md` dispatches it automatically yet.

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
   N independent proposal authors → adjudication → [existing] architect-review → plan (Stage 7.1, below) → [existing] architect-review → commit
                                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^ unchanged, reused as-is, still runs every time
   ```

   If the N proposals converge, architect-review proceeds exactly as it
   would with a single author (negligible added cost). If they diverge,
   architect-review still runs afterward on whichever approach adjudication
   selected — it is never skipped, and never asked to arbitrate between the
   raw candidate proposals itself (that is adjudication's job).

5. **Plan step (Stage 7.1) — author + grounded convergent check, milestone-
   level, out of the task tree.** After architect-review (step 4) has passed
   on the reconciled proposal, author and converge a **milestone-level plan
   record** (phases/stages, dependency order, per-stage line budgets,
   per-stage TDD ≥80% acceptance — the exact shape of
   `docs/plans/3-7-quay-task-to-plan-skill.md` itself) BEFORE any
   implementation begins. This has two sub-steps, always sequential, never
   parallel:

   a. **Author (once, unparametrized).** Dispatch ONE Task-agent to read the
      reconciled proposal (`task_get`'s current `body`) and the target
      codebase, and produce a first-draft plan record: phases → stages →
      dependency order → per-stage line-budget estimate → per-stage TDD
      acceptance criterion, with every stage tagged **explicitly `[code]` or
      `[prose]`** at authoring time (proposal §15.2 — classification is
      mandatory and explicit, never decided ad hoc later at
      stage-completion time; a stage genuinely touching both is split, or
      its `[code]`/`[prose]` files' acceptance is stated separately) per the
      code-vs-prose classifier (§Hard gate below). This draft is the
      plan-check's round-1 input — it is not
      itself the final artifact.

   b. **Grounded convergent check (iterated, capped at 3 rounds).** Dispatch
      `.claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md` — ONE
      **maximally codebase-grounded** check subagent per round — feeding each
      round's output back in as the next round's input. This check subagent
      reads real signatures/call-sites/existing files to catch the mechanical
      plan-class errors `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
      §7 documents ("two independent re-derivations could both misread the
      same code the same way; a grounded single check catches them instead").
      **Precise stop condition** (proposal §14.2, the Phase-5 stopping rule —
      `docs/plans/3-7-quay-task-to-plan-skill.md` Stage 5.3; this
      mechanism-level detail was deliberately NOT duplicated into
      `inherited-core.md` by M18, per that file's own "Mechanism detail — see
      the design doc, not duplicated here" note on its two-class diversity
      policy section, so this skill cites the plan/proposal directly): each
      round produces a count `F_i` of MATERIAL findings (an issue that would
      change the plan's content if fixed, not cosmetic wording) — STOP when
      EITHER (a) **zero-finding convergence**: one round finds `F_i = 0` (that
      round itself is the confirmation, no extra confirmatory round required —
      unlike BAIME's dual-layer K=2 smoothing, this is a discrete single-metric
      signal, not a noisy continuous score), OR (b) **round-cap**: round 3 is
      reached — if round 3 still finds material issues, the check loop STOPS
      and escalates to a human/architect-review decision rather than iterating
      indefinitely (mirrors `inherited-core.md`'s own condition-3
      "ceiling → redesign-OR-stop" pattern, at plan-check granularity). Plan
      **re-derivation is declined by default** under this rule — available ad
      hoc ONLY if round 3 still finds issues AND the disagreement is a
      decomposition-shape question, not a ground-truth-checkable fact (proposal
      §7's own carve-out) — an explicit, justified exception, never a silent
      per-round judgment call.
      - **The check consumes the Phase-4 budget gate as one of its ground-
        truth checks**: the orchestrator runs
        `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh`
        against the draft's declared phase/stage line estimates BEFORE each
        check round and hands the raw PASS/FAIL verdict to the check subagent
        as `{{budget_gate_result}}` (see the prompt template) — the check
        subagent does not re-run the gate itself, it consumes the result as
        one of the grounded facts it must reconcile the draft against
        (`≤2000` milestone / `≤500` phase / `≤200` stage, per
        `inherited-core.md`'s ceiling).
   c. **The plan record is milestone-level and is NOT written as a
      child-task tree.** Per proposal §3 (the board tracks VALUE; the plan
      tracks PROCESS): this plan record is a standalone artifact (a
      milestone/iteration-report-adjacent document, analogous to
      `docs/plans/*.md`), never decomposed into per-stage quay child tasks via
      `parent`/`children`. **Process is deliberately invisible in the Web
      UI/task board** — a future reader must not expect stage-by-stage
      progress to render on the task board; only the task-level `##
      Proposal` (step 3) and the eventual implementation outcome are
      task-tree-visible. State this explicitly to any caller before this step
      runs, so no one later files a bug that "the plan's stages don't show up
      in the Web UI" — they are not supposed to.

## TDD ≥80% hard gate — code-vs-prose classifier (Stage 7.2)

Per `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §15 (§15.1 gate,
§15.2 classifier): **TDD ≥80% per stage is a HARD GATE**, stricter than
exp5's current "paste test output" evidence gate, because single-
implementation (the development-class narrower diversity pattern — no
whole-milestone independent re-derivation on this side) makes it the
**primary correctness net** (`inherited-core.md`'s two-class diversity policy
§6 pipeline: independence is spent upstream at the proposal and downstream at
the existing adversarial-audit gate, NOT at the implementation itself — the
TDD gate is what stands in the gap between those two ends). This gate is
**mandatory and MUST NOT be skipped** for any stage this skill's plan record
produces, regardless of stage size.

**The classifier — apply per stage, not once per milestone:**

- **Code branch.** If a stage's `Files:` entry is executable code (JS/shell/
  any `.mjs`/`.sh`/etc. source or test file), the gate is **literal ≥80% line
  coverage**, measured by the project's normal coverage tool on that file,
  written test-first (RED → GREEN), exactly as
  `docs/plans/3-7-quay-task-to-plan-skill.md`'s own "Test / verification
  strategy" section already demonstrates for `it0-ceiling-line-budget-check.
  {sh,mjs}` (under-budget PASS / over-budget FAIL / malformed-input exit 2
  unit tests, coverage measured on the `.sh`/`.mjs`).
- **Prose branch.** If a stage's `Files:` entry is prose/skill/template/
  manifest content (a `SKILL.md`, a prompt template, a methodology doc, a
  charter), a coverage percentage does not apply and MUST NOT be fabricated
  to satisfy the gate. Instead the gate **degrades to the mechanical-check
  discipline** `docs/plans/2-exp5-driver-deliverability-packaging.md`
  established: the relevant `experiments/quay-perpetual-stream/scripts/
  it0-*.sh` gate-hash / projection-check runs still PASS, a **scaffold-lint**
  (emitted/blanked scaffolds contain no leftover placeholder markers) is
  clean, and, where applicable, an **isolation test** (the artifact still
  works when consumed standalone, outside the authoring context) passes.
  `grep`-checkable structural assertions (the load-bearing rule text is
  literally present in the file, not merely alluded to) stand in for coverage
  on this branch.
- **This skill's OWN implementation is largely prose** (a `SKILL.md` +
  prompt-template `.md` files, no executable code of its own beyond any small
  helper it might invoke) — **the prose branch of this exact classifier
  applies to the skill's own build**, not the code branch. A future reader
  auditing this skill's own Phase 6/7 build should check frontmatter
  validity, `grep`-checkable presence of load-bearing rules, and existing
  `it0-*.sh` scripts still passing — NOT ask for a coverage percentage on
  `SKILL.md`.

**Constraints (added to the block below):** `forbid(skipping the ≥80% gate
for a code stage on the grounds the milestone is "mostly prose")` and
`forbid(fabricating a coverage percentage for a prose/skill/template/manifest
stage — use the mechanical-check branch instead)`.

## Relationship / bootstrap (Stage 7.3)

**The bootstrap chicken-and-egg, resolved explicitly** (proposal §19,
preserving the original pre-merge draft's §11 bootstrap-resolution
paragraph): this skill (`quay-task-to-plan`) **cannot build its own
deliverable** — a skill cannot run itself before it exists. Therefore:

- **The skill-implementation milestones (M20-task-to-plan-skill-proposal-step
  / Phase 6, and this milestone, M22-quay-task-to-plan-skill-phase7 / Phase
  7) run through the existing `proposal-to-plan` skill**
  (`~/.claude/skills/proposal-to-plan/SKILL.md`), NOT through
  `quay-task-to-plan` — they are the bootstrap substrate this skill is built
  on top of, not this skill's own first customers. `quay-task-to-plan`'s
  design is cross-checked against `proposal-to-plan` step-by-step (both are
  5-ish-step, sequential, isolated-Task-agent pipelines with an
  architect-review/check gate before commit — see step 4 above for the
  explicit strengthens-not-replaces relationship).
- **Only the SECOND development-class milestone onward is the first
  true-dogfood customer.** Named candidates:
  `M-TASK-BACKLOG-PROJECTION-IMPL` (materialized at m21's DIR-016 retroactive
  sweep, per DIR-015; still pending its own SELECT+charter+dispatch) and the
  release-cadence implementation. **Explicitly NOT
  M16-cli-edit-parity-impl** — it is already complete (landed at
  `milestone_counter → 16`, and is in fact the milestone that landed the
  `task edit` full-field write surface this skill's own write-back step
  (step 3d) consumes) — it predates this skill and cannot retroactively be
  routed through it.
- **`feature-developer` reuse note** (proposal §8 point 6 / §17's Done-when
  item): where `~/.claude/skills/feature-developer/SKILL.md`'s existing
  orchestration already fits a sub-step of this pipeline (e.g. its Phase 3-9
  Task-agent-per-phase orchestration shape, its "orchestrator never writes
  files directly, only spawns Task agents" discipline), **reuse or wrap it —
  do not reinvent the review loop**. Concretely: this skill's own step
  4 architect-review reuses `proposal-to-plan`'s existing step (already
  stated); a future implementer wiring this skill into `OUTER-LOOP.md`
  DISPATCH (explicitly out of scope for this Phase-7 build, see the
  frontmatter `description` above) should check whether `feature-developer`'s
  orchestrator-only pattern is directly reusable for the implementation phase
  before authoring a new orchestration layer from scratch.

**Output contract:** see the canonical `## Output` block at the end of this
file — it now carries both the Stage 6.3 task write-back outputs (unchanged)
and this stage's `plan_record` (a milestone-level plan document, NOT a quay
task, NOT a child-task tree, analogous in shape/location to `docs/plans/*.md`).

**Non-goals (proposal §10, restated for Phase 7):**

- **Not deleting or forking `proposal-to-plan`.** It remains the bootstrap
  substrate and the reused architect-review step; this skill adds an upstream
  proposal-adjudication pass and a downstream plan-check pass around it, it
  does not replace or fork it.
- **Not rendering stage process in the Web UI.** The plan record's
  phases/stages are process, not value — per step 5c above, they are
  deliberately kept off the task board; this skill does not add any Web UI
  surface for plan-check round progress.
- **Not wiring `OUTER-LOOP.md` DISPATCH** to invoke this skill automatically,
  and **not de-optionalizing the two-class diversity policy** — both remain
  DIR-014 items 2/3, explicitly deferred past this Phase-7 build (see the
  frontmatter `description` above and this milestone's own charter's
  "Explicitly OUT of scope" section).

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
plan: author once (unparametrized) → grounded check iterates to convergence, cap 3 rounds ∧
plan: check consumes Phase-4 budget gate (it0-ceiling-line-budget-check.sh) as ground truth ∧
plan: re-derivation declined by default (check-not-re-derive), ad hoc exception only, explicit ∧
plan: milestone-level record kept OUT of the quay task tree, never a child-task tree ∧
gate: TDD ≥80% line coverage for code stages, mechanical-check discipline for prose stages ∧
forbid(skipping the ≥80% gate for a code stage on the grounds the milestone is "mostly prose") ∧
forbid(fabricating a coverage percentage for a prose/skill/template/manifest stage) ∧
forbid(OUTER-LOOP.md DISPATCH auto-wiring, non-discretionary policy — explicitly out of scope)
```

## Output

```
outputs = {
  proposals:     [Proposal] (N raw, ephemeral — not persisted to the task),
  reconciled:    ReconciledProposal (adjudicated or converged),
  task_write:    raw tool-call result,
  task_get:      raw readback tool-call result (evidence the write landed),
  plan_record:   a milestone-level plan document (phases/stages/dependency-order/
                 per-stage budgets/per-stage TDD acceptance), produced by Stage
                 7.1's author+check — NOT a quay task, NOT a child-task tree,
                 analogous in shape/location to docs/plans/*.md; kept OUT of the
                 task tree / invisible in the Web UI (see "Relationship /
                 bootstrap" above)
}
```
