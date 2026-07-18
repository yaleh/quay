---
name: quay-task-to-plan
description: For a development-class quay task (or a milestone's grouped task set), run N independent blank-slate proposal subagents, adjudicate their divergence, and write the reconciled proposal back to the task's body via the Provider ABI's task_write tool (never a status-only patch). This is the PROPOSAL STEP ONLY (Phase 6 of docs/plans/3-7-quay-task-to-plan-skill.md) — it stops after write-back; the plan-authoring step, TDD gate, and DISPATCH wiring are a separate future phase and are explicitly not invoked by this skill yet. Invoke on a development/capability-growth-typed task that needs a proposal before it can be planned.
allowed-tools: Bash, Read, Write, Task
---

# quay-task-to-plan (proposal step)

    read    :: TaskId → TaskDetail                          -- mcp__quay__task_get / task_list
    propose :: TaskDetail → [Proposal; N=2]                  -- N independent, blank-slate, no inter-agent comms
    adjudicate :: [Proposal; N] → ReconciledProposal          -- M13-style: converge silently, diverge explicitly
    write_back :: (TaskId, ReconciledProposal) → TaskDetail  -- mcp__quay__task_write, full-field, body-portable
    readback :: TaskId → TaskDetail                          -- mcp__quay__task_get, confirms the write landed

This skill implements **Phase 6 only** of `docs/plans/3-7-quay-task-to-plan-skill.md`
(the `quay-task-to-plan` skill's **proposal step**): read a task, run N independent
proposal subagents, adjudicate them, and write the reconciled proposal back to the
task's `body`. It stops there. **Phase 7** (the plan-authoring step, the grounded
convergent check, the TDD ≥80% hard gate, and wiring `OUTER-LOOP.md` DISPATCH to
invoke this skill automatically for development-class milestones) is explicitly
**out of scope** for this skill as currently built — do not treat this skill's
existence as making the two-class diversity policy non-discretionary; that
de-optionalization is a separate future milestone's job (DIR-014 items 2-3).

Authoritative build spec: `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 6
(Stages 6.1-6.3). Full design detail: `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
§§12-13. Structural precedent for this file's shape: `.claude/skills/quay-directive/SKILL.md`.

## 0. Provider read/write contract (Stage 6.1)

Per DIR-009 item 8's provider-tool convention: this skill uses the **Provider ABI
tool surface exclusively** — it never reads or writes `backlog.md` or any other
generated markdown view as a data source or sink, and it never edits a native
store's frontmatter file directly even though it may be running inside the same
repo that hosts the native store (that would silently break the provider-agnostic
contract this section exists to preserve).

- **Read.** `mcp__quay__task_get` (single task, full detail: `body`, `labels`,
  `parent`/`children`, `status`) and `mcp__quay__task_list` (candidate/milestone-
  membership queries, e.g. `label: ["milestone:<id>"]`) — MCP tools preferred
  in-session. CLI fallback when no MCP session is available: `node
  packages/quay/bin/quay.js task list --label milestone:<id> --json` / `task get
  <id> --json`.
- **Write.** `mcp__quay__task_write` — **the full-field write path**
  (`body`/`extra`/`labels`/`parent`/`children`/`status`/`title`, per M16-cli-
  edit-parity-impl's landed full-field flag surface), **never a status-only
  patch**. CLI fallback for the native provider specifically:
  `packages/quay-native/bin/quay-native.js task edit <id> --body '...' --extra
  '{"proposalStatus":"..."}' --json` (mirrors the quay-directive skill's own
  documented fallback — the Core CLI's `packages/quay/bin/quay.js task edit` is
  deliberately status-only in v1 per QN-024 and **cannot** perform this write;
  do not use it for this purpose). MCP `task_write` is preferred whenever this
  skill runs in an MCP-tool-equipped session.
- **Check (not used by the proposal step, cited for completeness).**
  `mcp__quay__task_check` / CLI `task check` is reserved for the Phase 7
  plan/TDD-gate steps this skill does not yet implement.

**Portability rule (DIR-011, body-first / extra-native-only-mirror):** a task's
proposal is *portable metadata* and MUST live in the task's `body`, not solely in
`extra{}`. The write-back step (§3 below) writes the adjudicated proposal into a
`## Proposal` body section; `extra.proposalStatus` (`adjudicated` / `pending`) MAY
additionally be written as a native-only, query-performance convenience, but is
**never the sole record of the fact** — the body section alone must be sufficient
to reconstruct the proposal's content and provenance on any provider, including
one with no `extra{}` field at all.

**GitHub degradation.** On the GitHub provider, `extra{}` does not exist and there
is no native `parent`/`children` field — the `## Proposal` body section is written
exactly the same way (body is provider-portable by construction), but the
`extra.proposalStatus` mirror is simply omitted (native-only convenience, not
required), and any parent/children grouping this skill would otherwise perform
degrades to the checkbox-in-body convention per M12 (`extractChildRefs`/
`CHILD_CHECKBOX_RE` in `packages/quay-github/src/github-client.js`). This skill
does not live-test the GitHub path this phase (per the charter's explicit scope
note); it documents the degradation so a future GitHub-path probe has a contract
to test against.

**Milestone → task grouping** is NOT invented by this skill — it reuses M12's
real parent/children WRITE (`packages/quay-native/src/store.js` parent/children
fields; GitHub checkbox-in-body write side landed by M12-abi-parent-write). The
*primary* portable grouping key for milestone membership is the `milestone:<id>`
label (label writes are supported unconditionally on both providers); `parent`/
`children` is reserved for a DIFFERENT relationship — epic-decomposition of a
single over-scoped task into sub-tasks — and this skill only writes `parent`/
`children` when the adjudication step itself concludes a task should be split
into sub-tasks before planning (rare; see §3 step 3c), never as the milestone-
grouping mechanism.

## 1. Input

A task id (or a milestone's `label:"milestone:<id>"` task set, read via
`task_list`). For a milestone-grouped set, steps 2-4 below run once per task in
the set, independently — this skill does not batch multiple tasks' proposals
into a single subagent run (each task gets its own N-subagent fan-out; different
tasks' proposal drafting never shares an agent context, for the same
blank-slate reason within-task subagents don't share context).

## 2. Proposal step — N independent subagents (Stage 6.2)

For the target task, dispatch **N=2 independent Task-agent subagents** (default;
raise N only when the *task itself* is flagged high-stakes at SELECT time by a
human/charter decision — never as a silent per-task judgment call made inside
this skill).

- **Blank-slate-leaning dispatch.** Each subagent receives *only*: the task's
  current `title`/`body`/`labels` (read via `task_get`), the owning milestone's
  charter if one exists yet (else the raw candidate description), and this
  skill's §0 write-back shape instruction (so each proposal is drafted in the
  shape adjudication expects, without seeing the *other* subagent's draft).
  Subagents are **not** shown each other's output and are **not** run in the
  same context/thread — this is what makes divergence a real signal rather than
  an artifact of shared anchoring (proposal §13.1 step 1, §6's "no
  inter-agent-communication" requirement).
- **Persona differentiation** (permitted, encouraged, cheap divergence widener):
  e.g. subagent A is instructed to "propose the minimal-surface-area approach";
  subagent B is instructed to "propose the approach most consistent with
  existing patterns already in this codebase." See
  `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md` for the full
  parametrized template (parametrized by `N` and `PERSONA`).
- **Architect-review is retained, unchanged, as an ADDITIONAL pass** — this step
  does not replace `proposal-to-plan`'s existing single sequential
  architect-review; it inserts parallel re-derivation *upstream* of where that
  review sits. The full chain for a `quay-task-to-plan`-driven task is:

  ```
  N independent proposal authors → adjudication (this skill, §3)
    → [existing, unchanged] architect-review → plan → [existing] architect-review → commit
  ```

  Architect-review's existing job (catching mechanical/verifiable errors in the
  SINGLE adjudicated proposal) is unchanged; it is never skipped and never asked
  to arbitrate between the raw N candidates itself — that is adjudication's job.
- **Writes nothing.** Neither proposal subagent calls `task_write`. This avoids
  a race/overwrite hazard between N≥2 concurrent writers (proposal §13.1 step 3)
  — the task is written to exactly once, by the adjudication step (§3), never by
  either proposal author directly.

## 3. Adjudication + write-back step (Stage 6.3)

A **third** subagent (or, at the milestone author's discretion for small/low-
stakes tasks, a synchronous review by whoever is running this skill) receives
**both** N proposals in full and performs, in order:

1. **Convergence check.** Determine whether the N proposals converged (same
   approach, differing only in low-stakes framing/wording) or diverged (a real
   approach-level disagreement — the M13 DIR-010-namespace-decision precedent:
   two independently-derived designs disagreeing on a genuine design axis, not
   a wording nit).
2. **Divergence handling (when diverged).** Adjudicate a winner OR explicitly
   synthesize a merged approach, and record *why* in an `### Adjudication note`
   sub-section — which proposal(s) diverged, on what axis, and which resolution
   was chosen and why. Per proposal §13.2, the alternatives-considered-and-
   rejected list from each losing proposal is **preserved in the write-back**,
   not silently discarded — adjudication summarizes, it does not erase, the
   rejected reasoning.
3. **Convergence handling (when converged).** Write back the (near-)identical
   content with **no** `### Adjudication note` required (the note is present
   only when N≥2 diverged; absent for N=1 fallback or clean convergence).
   3a. **N=1 fallback.** If only one proposal subagent was run (e.g. a
       resource-constrained dispatch), the adjudication step still runs, but
       degrades to "pass the single proposal through, source = single-pass,
       no adjudication note" — it does not fabricate a second opinion.
   3b. **Epic-split exception.** If adjudication concludes the task itself
       should be decomposed into multiple sub-tasks before planning (rather
       than proposing one design for it as-is), this is the ONE case where
       this skill writes `parent`/`children` (§0's grouping section) as part
       of the write-back — a different relationship than milestone membership,
       used only here.
4. **Write-back (exactly once, by this step, via `mcp__quay__task_write`).**
   The reconciled proposal is written into the task's `body` in the shape
   below. This is the **full-field write path** — `task_write`'s `body`
   parameter is a *full replacement body*, so the adjudication step reads the
   task's *current* full body first (`task_get`), does an **idempotent
   section-replace** of the existing `## Proposal` section (through, but not
   past, the next `##` heading) if one is already present, and passes the
   *entire* reconstructed body back — never a bare partial fragment, and never
   the status-only patch path.

### Write-back shape (DIR-011 body-first, mirrors M05's `## Status mirror` / M13's `Status mirror:` convention)

```markdown
## Proposal

Source: <adjudicated | single-author>, <ISO date>, <author identity: subagent
persona label(s), e.g. "minimal-surface-area + pattern-consistent", or
"single-pass">

<the adjudicated (or, for N=1 fallback, single-author) approach: problem
framing, approach, key design decisions, explicitly-listed alternatives
considered and rejected (from BOTH proposals when N≥2, not just the winner)>

### Adjudication note
<present only when N≥2 AND the proposals diverged — which proposal(s)
diverged, on what axis, and which resolution was chosen and why. Absent
entirely for N=1 fallback or clean convergence.>
```

- **`extra` mirror (optional, native-only).** The skill MAY additionally write
  `extra.proposalStatus: "adjudicated"` (or `"pending"` before this step runs)
  on the native provider as a query-performance convenience. This mirror is
  never authoritative on its own — the `## Proposal` body section is sufficient
  by itself, per §0's portability rule.
- **Regeneration, not write-once (proposal §3 / §12.2).** A task's `## Proposal`
  section is **not** a one-time artifact. Task granularity is variable (DIR-009)
  — a task may be re-grouped into a different milestone, or its proposal
  re-derived after new information — so this write-back step is always safe to
  re-run: it REPLACES the existing `## Proposal` section wholesale (never
  appends a second, orphaned copy alongside the old one), the same idempotent-
  section-replace discipline the M05 projection design already uses for its own
  `## Status mirror` section. Whatever later action triggers a re-proposal
  (re-grouping, explicit "regenerate the proposal" request) re-invokes steps
  2-3 of this skill and re-runs this write-back step exactly the same way —
  there is no separate "first write" vs. "update" code path.
- **Readback (mandatory evidence step).** Immediately after `task_write`, call
  `mcp__quay__task_get` on the same task id and confirm the returned `body`
  contains the just-written `## Proposal` section verbatim — same evidence
  discipline as the quay-directive skill's own step 5d. Do not report the
  write-back as complete without pasting this readback.

See `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md` for the
full adjudication subagent prompt template.

## 4. Steps (operational summary)

0. Resolve the target: a single task id, or a milestone's `label:
   ["milestone:<id>"]` task set via `task_list`. For a set, repeat steps 1-4
   independently per task.
1. `task_get <id>` — read current `title`/`body`/`labels`/`status`. This is
   the blank-slate input every proposal subagent receives (§2).
2. Dispatch N=2 (default) independent proposal subagents per
   `prompts/proposal-subagent.md`, persona-differentiated, no shared context,
   no inter-agent communication. Collect both raw proposal texts. **No writes
   yet.**
3. Dispatch one adjudication subagent per `prompts/adjudicate-proposal.md`
   with both raw proposals. Collect the reconciled proposal (+ adjudication
   note if divergent).
4. Read the task's current full `body` again (`task_get`, freshest state —
   avoid a stale-read race if time has passed since step 1), idempotently
   section-replace `## Proposal` (append if absent), and call
   `mcp__quay__task_write` with the **full reconstructed body** (never a
   partial fragment) — plus `extra.proposalStatus` mirror if using the native
   provider.
5. `task_get <id>` again — readback evidence, paste verbatim.
6. Stop. Do **not** proceed to plan-authoring, TDD-gate checks, or any
   DISPATCH-level wiring — those are Phase 7, out of scope for this skill.

## Non-goals (this skill, as built)

- Does not author a plan document (Phase 7's plan step).
- Does not run a grounded convergent check or a TDD ≥80% hard gate (Phase 7).
- Does not wire itself into `OUTER-LOOP.md` DISPATCH, and does not make the
  two-class diversity policy non-discretionary (Phase 7 / DIR-014 items 2-3).
- Does not touch `inherited-core.md` or `OUTER-LOOP.md`.
- Does not run against a live GitHub repo this phase (documented degradation
  only, not live-tested — see §0).
