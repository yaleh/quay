---
name: quay-task-to-plan
description: Proposal step (Phase 6) of the quay-task-to-plan pipeline — for a development-class milestone's grouped task(s), run N independent blank-slate subagents to draft proposals, adjudicate divergence M13-style, and write the reconciled proposal back to the task's body via the Provider ABI (task_write/task_get), portable per DIR-011. Invoke after a development-class milestone's tasks are grouped (milestone:<id> label / M12 parent-children) and before proposal-to-plan's own architect-review + plan step (Phase 7, not yet built) runs.
allowed-tools: Bash, Read, Write
---

# quay-task-to-plan

    read     :: TaskId → task_get/task_list → TaskRecord            -- Provider ABI, never backlog.md
    propose  :: TaskRecord × N → [Proposal]                          -- N independent, blank-slate, no inter-agent comms
    adjudicate :: [Proposal] → ReconciledProposal                    -- M13-style; explicit on convergence vs divergence
    write_back :: ReconciledProposal → task_write → task_get(readback) -- body-portable, regeneratable, not write-once

This skill implements **Phase 6 only** of `docs/plans/3-7-quay-task-to-plan-skill.md`
(the **proposal step**: N-independent-subagent authoring + adjudication +
write-back to the task's `body`). It is modeled structurally on
`.claude/skills/quay-directive/SKILL.md`'s shape (YAML frontmatter, numbered
`## Steps`, explicit provider-tool citations, evidence-by-readback discipline)
and on `~/.claude/skills/proposal-to-plan/SKILL.md`'s isolated-Task-agent
step structure (each step = one independent agent invocation, sequential, not
parallel-and-merged).

**Phase 7 (plan step + grounded convergent check + TDD ≥80% hard gate +
`OUTER-LOOP.md` DISPATCH wiring + de-optionalizing the two-class diversity
policy) is explicitly OUT OF SCOPE for this skill as currently built** — see
`docs/plans/3-7-quay-task-to-plan-skill.md` Phase 7. This skill's proposal
step is a standing artifact that a future Phase-7 milestone will chain a plan
step onto; it does not yet self-invoke, and nothing in `OUTER-LOOP.md`
dispatches it automatically. Until Phase 7 lands, invoke this skill manually
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
   N independent proposal authors → adjudication → [existing] architect-review → plan (Phase 7, not built) → [existing] architect-review → commit
                                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^ unchanged, reused as-is, still runs every time
   ```

   If the N proposals converge, architect-review proceeds exactly as it
   would with a single author (negligible added cost). If they diverge,
   architect-review still runs afterward on whichever approach adjudication
   selected — it is never skipped, and never asked to arbitrate between the
   raw candidate proposals itself (that is adjudication's job).

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
forbid(Phase 7: plan step, TDD gate, DISPATCH wiring, non-discretionary policy)
```

## Output

```
outputs = {
  proposals:     [Proposal] (N raw, ephemeral — not persisted to the task),
  reconciled:    ReconciledProposal (adjudicated or converged),
  task_write:    raw tool-call result,
  task_get:      raw readback tool-call result (evidence the write landed)
}
```
