# A quay-task-native proposal→plan skill, and the exp5 milestone-model changes it requires

**Status:** MATURED — dispatch-ready skill design (M17-task-to-plan-skill-design,
m16→m17). Sections 1-11 are the original DRAFT (authored 2026-07-18 from a live
human-steering conversation, git revision `05a8066`, the conversational draft
DIR-012 references and cites verbatim as its precursor artifact) — kept
unmodified as the rationale/evidence base. Sections 12-19 are NEW, added by this
milestone per its charter's in-scope items 1-8: they fully specify the skill's
quay task read/write behavior, the N-independent-proposal + adjudication step,
the plan author + grounded-convergent-check step (with a precise stop
condition), the TDD ≥80%-per-stage hard gate, provider-agnostic GitHub
degradation, a dispatch-ready Done-when checklist for a future implementing
milestone, explicit non-goals, and a closing status/next-step section — at the
same fidelity M13
(`docs/proposals/exp5-task-backlog-primitive-projection.md` §15) and M14
(`docs/proposals/exp5-cli-edit-parity.md` §6) achieved for their own skill/design
docs. Per this milestone's charter, sections 12-19 are **design-doc-only**: no
skill implementation, no code under `.claude/skills/`, no edits to
`inherited-core.md`/`OUTER-LOOP.md` (DIR-012 items 2/3 stay explicitly out of
scope here — see §18).

**Scope:** introduce a new skill, analogous to the existing `proposal-to-plan`
but native to quay's task spec, and adopt the milestone-model changes that make
it usable inside the exp5 perpetual OUTER loop for typical *development* work
(up to ~2000 lines of change), not just the small methodology milestones exp5
has run so far.

## Table of contents — M17 addition map (§12-19)

| Doc section | DIR-012/charter in-scope item | Charter Done-when clause |
|---|---|---|
| §1-11 | (original draft — cited here, not re-derived) | 1 |
| §12 Provider ABI read/write behavior, write-back shape, milestone→task grouping | 2 | 2 |
| §13 Proposal step: N-independent + adjudication, relation to architect-review | 3 | 3 |
| §14 Plan step: author + grounded convergent check, stop condition | 4 | 4 |
| §15 TDD ≥80%-per-stage hard gate | 5 | 5 |
| §16 Provider-agnostic GitHub degradation | 6 | 6 |
| §17 Done-when clauses for a future implementing milestone | 7 | 7 |
| §18 Non-goals (M17-level restatement) | 8 | 8 |
| §19 Status / next step (closing summary, supersedes original §11's DRAFT-era framing) | (closing section, not a separate charter item) | — |

---

## 1. Problem — exp5 milestones carry acceptance criteria, but no plan

Ground-truth check this conversation:

- Recent quay tasks (all `DIR-*`) have deliberately thin bodies — but that is the
  **M05 projection design** (task body = Source link + Finding first paragraph +
  Status mirror; the canonical content is the DIR *file*). The thinness is not
  the real gap.
- The real gap is one level deeper: an exp5 milestone's charter carries **Value
  hypothesis + In-scope work + Binary Done-when (acceptance) + HARD GATES**, but
  **no Phase/Stage implementation plan with line budgets**. The charter freezes a
  milestone's *shape and acceptance*, not its *decomposition and implementation
  route*. (Verified against `M12`/`M14` charters — no `Phase`/`Stage`/`≤200`/
  `≤500` structure exists in them.)
- Meanwhile a *proven* tool for exactly this — the `proposal-to-plan` skill —
  already exists and has been used in this very repo (`docs/plans/1-…read-path-
  slimming.md`, `docs/plans/2-exp5-driver-deliverability-packaging.md`) and
  heavily in sibling projects (meta-cc: `docs/plans/` phases 41–94; the
  project-split plan was a **~10,019-line** change decomposed into 6 phases and
  reviewed in 2 rounds). It produces phase/stage decomposition (≤200 lines/stage,
  ≤500 lines/phase), dependency ordering, and TDD ≥80% acceptance per stage.
- But `proposal-to-plan` is **not wired into the OUTER loop** and writes free
  markdown under `docs/`, not quay tasks. It has been used *beside* exp5, never
  *inside* its SELECT→charter→execute cycle.

There is also a forming anti-pattern: `M13` (task-backlog-projection) and `M14`
(cli-edit-parity) are both *design-doc-only* milestones that each end with a
"Done-when clauses a future implementing milestone would need" section — exp5 is
accreting a chain of designs while deferring the large *implementations* they
describe. When those implementation milestones are finally SELECTed, they are
precisely the ~1000–2000-line tasks `proposal-to-plan` is proven for, and the
current charter machinery has no plan discipline for them.

## 2. Prior art, and what its review loops actually catch (evidence)

`proposal-to-plan` is a 5-step pipeline, each step an isolated Task agent:
proposal → architect-review → plan → architect-review → commit. Inspecting the
real review-loop commits shows the two review stages catch **two distinct classes
of error**:

- **Plan/proposal review catches verifiable, mechanical errors** (meta-cc
  `8ad476a`, `3f851b0`): wrong function signatures (`[]types.Entry` →
  `[]parser.SessionEntry`), wrong call-site line numbers, **wrong stage ordering**
  (update manifests before deleting files), wrong TDD semantics ("expect BUILD
  FAIL" for undefined Go functions), off-by-one counts (12→11 deletions; 17 not
  ~20 tools), line-estimate corrections, missing schema-conformance items. quay's
  own `a391032`: a wrong size figure (~42.7KB not ~31KB), a mis-located rationale.
- These are all **checkable against the actual codebase** — not matters of
  approach or judgment.

Two operational facts from the same commits, load-bearing for the design below:

1. Review is **independent** and **iterates** — quay `a391032`'s message: "Two
   rounds of independent review each on the proposal and the plan
   (feature-developer orchestration)"; meta-cc ran a "second architectural review"
   that caught *new* errors. Convergence, not one-shot.
2. `feature-developer` is the orchestrator that ran these loops — prior art the
   new skill can reuse or borrow from rather than reinventing.

## 3. The four-entity model (resolved this conversation)

The design turns on keeping four entities distinct and aligning them in pairs:

| entity | axis | value | aligns with | lives where |
|---|---|---|---|---|
| **task** | unit of value/work | intrinsic | **proposal** | quay task board; body carries the proposal (portable) |
| **milestone** | cost/value grouping | must be justified **and** cost-sized | **plan** | quay grouping task + a milestone-level plan record |
| **proposal** | "getting it right" — approach/correctness | — | task | task body |
| **plan** | implementation *process* | — | milestone | milestone-level doc; **not** the task tree |

Consequences that fall out of the alignment:

- **`proposal` ↔ `task`.** A task is a valuable thing described by a proposal;
  the proposal is written back onto the task (its `body`, so it is portable across
  providers per DIR-011; `extra{}` is a native-only mirror only). Because task
  granularity is variable (DIR-009: epics split, smalls merge), a task's proposal
  is **not write-once** — it needs a regeneration discipline like the M05
  projection when the task is re-grouped.
- **`plan` ↔ `milestone`.** The plan sequences the *implementation* of a
  milestone's grouped tasks into phases/stages. It is **milestone-level**, so
  **phase/stage are NOT written into the task board as a child-task tree.** The
  board tracks *value* (tasks, grouped into milestones); the plan tracks
  *process*.
- **Accepted consequence:** the implementation *process* (stage-by-stage progress)
  becomes **invisible in the Web UI / task board** — only value delivery
  (task/milestone done-or-not) shows there. This deliberately narrows DIR-009's
  "self-hosting" goal to *self-host the value structure, not the process*. This
  must be stated so no one later expects the Web UI to render stage progress.
- Because proposals are task-attached and the plan only *sequences* them, the
  earlier "many-proposals → one-plan synthesis" worry dissolves: the plan does not
  merge proposal *content*, it orders the grouped tasks' realization.

## 4. Milestone sizing: expand to ≤2000 lines — but only because the plan makes it safe

Adopt **milestone ≤ ~2000 lines**, aligning the milestone ceiling with
`proposal-to-plan`'s proven scale, with the plan's own budgets nested inside:

```
milestone ≤ ~2000 lines   =  one whole plan (multiple phases)
   phase  ≤ ~500  lines
   stage  ≤ ~200  lines
```

This answers the sizing question M06-sizing (DIR-004) left open — **a milestone is
a whole plan, not a single phase.** The expansion is only safe *because* of the
plan decomposition: exp5's inner-convergence record (13/13, no mid-milestone
re-scope) has held only because milestones were small; going to 2000 lines without
phase/stage structure would almost certainly force mid-milestone re-scope. The two
changes (bigger milestone + plan skill) therefore **must ship together** — the
plan is what contains the risk the larger size introduces.

SELECT's grouping rule (DIR-009) thereby gains a concrete two-sided criterion:
**group tasks by value coherence, cap by ~2000-line cost** — first bound to bind
stops the group.

## 5. Two milestone classes, two diversity strategies

Independence/diversity is a budget; spend it where errors are costly and cheap to
catch early. That location differs by milestone class — keyed on the value-typed
ledger exp5 already records:

| class | deliverable | where diversity is applied | value-type |
|---|---|---|---|
| **methodology / design** (M10–M14 today) | the design/doc itself | **whole-milestone independent re-derivation** (cheap — the whole deliverable is a doc) — keep as-is | discovery / governance-integrity |
| **development / test** (≤2000 lines of code) | product code | **independent re-derivation of the *proposal*** (approach is the expensive error); implement once; verify at the tail | capability-growth |

The key insight for the dev class: **re-deriving 2000 lines of implementation is
waste; re-deriving the approach is not.** The costly error in dev work is a wrong
*approach*, caught almost for free at proposal time and catastrophically late
after 2000 lines are written. M13 is the existence proof — its two independent
iterations *diverged on a design decision* (the DIR-010 namespace: `extra.
experiment` vs. experiment-prefixed ids) and the outer loop reconciled them. That
"design-level divergence, then adjudication" is exactly the mechanism the dev
class needs — relocated from whole-milestone re-derivation down to the proposal.

## 6. The pipeline — "clamp at both ends", plan-check in the middle

For a **development milestone**:

```
task (intrinsic value) ── independent subagent writes proposal ──► written back to task body

   [UPSTREAM INDEPENDENCE]  proposal re-derivation:
        N independent subagents each author a proposal → reconcile/adjudicate (M13-style)

milestone (≤2000 lines; SELECT groups by value coherence, caps by cost)
   │
   ├─ plan (independent subagent; milestone-level; NOT a child-task tree)
   │     └─ PLAN CHECK: one heavily codebase-grounded independent subagent,
   │        iterated to convergence (see §7) — a CHECK, not a re-derivation
   │
   ├─ single implementation, TDD ≥80% per stage   ← the implementation-correctness net
   ├─ tail self-check (light; independence already provided at both ends)
   │
   └─ ABSORB → [DOWNSTREAM INDEPENDENCE] adversarial-audit gate
        (existing, out-of-band; fires on capability-growth + Δv≠0 — dev milestones hit this)
```

Independence is provided at **both ends** (upstream proposal re-derivation +
downstream adversarial audit); the implementation runs **once** in the middle. The
tail verification therefore degrades to a light self-check — no separate
independent verifier agent is spawned for it. This is the "two-ends clamp" agreed
this conversation.

Every generative/critical step is an **independent subagent** (as
`proposal-to-plan` already does), but their **grounding differs by role**:

- proposal re-derivation subagents: **blank-slate-leaning** — minimize shared
  context so divergence is a real signal.
- plan-check subagent: **maximally codebase-grounded** — it must read the real
  signatures / call-sites / dependency graph to catch the mechanical errors §2
  documents; without grounding it cannot find them.

## 7. Plan is *checked*, not *re-derived* — and the stopping rule

Answering "after the plan, do we need a re-derivation or a check?": **a check, not
a re-derivation.** Grounding, from §2's evidence:

- Plan-class errors (signatures, call-sites, stage ordering, sizing, TDD
  semantics) are **verifiable against ground truth**, not judgment divergences.
- Two independently-derived plans from the *same reconciled proposal* would differ
  mainly in where phase/stage boundaries fall (low-stakes) and could **both misread
  the same code the same way** (the high-stakes errors) — whereas one grounded
  check catches them reliably. So at the plan stage, **check > re-derive**, and it
  is cheaper.

**Stopping rule (borrowed from BAIME's own convergence discipline):** iterate the
plan check until a round produces no material change (convergence), cap ~2–3
rounds. This mirrors the observed real practice (meta-cc's two rounds; quay's "two
rounds each") and reuses exp5's ΔV-small-and-stable stop condition rather than
inventing a new one.

The optional **plan re-derivation** the conversation floated is therefore
**declined by default** for the dev class; if a milestone's decomposition is
itself genuinely contested (rare), a second independent plan can be requested
ad hoc, but it is not the standing mechanism.

## 8. What the new skill is, concretely

A new skill (working name `quay-task-to-plan`), analogous to `proposal-to-plan`
but quay-native. Differences from the existing skill:

1. **Reads and writes quay tasks**, not just `docs/` markdown: pull the milestone's
   grouped tasks via the provider tool (CLI/MCP, DIR-009 item 8); write each task's
   proposal back to its `body` (portable, DIR-011); this dogfoods M12's new
   parent/children WRITE for the milestone→task grouping and DIR-011's edit-surface
   relaxation (M14) for full-field task writes.
2. **Proposal step = N independent subagents + adjudication** (strengthening
   `proposal-to-plan`'s single sequential architect-review into parallel
   re-derivation for the approach), while **keeping architect-review as an
   additional adversarial pass**.
3. **Plan step = author + grounded convergent check** (§7), producing a
   milestone-level plan record (phases/stages, dependency order, per-stage line
   budgets, per-stage TDD ≥80% acceptance) — kept **out of the task tree**.
4. **TDD ≥80% per stage is a hard gate**, not advisory: single-implementation
   makes it the primary implementation-correctness net (§6). This is stricter than
   exp5's current "paste test output" evidence gate and must be enforced as such.
5. **Provider-agnostic**: everything the skill writes to tasks respects the
   body-portable / extra-native-only rule; it must degrade correctly on GitHub
   (no `extra`, parent/children via checkbox body per M12).
6. Reuse or wrap `feature-developer`'s orchestration where it fits, rather than
   reinventing the review loop.

## 9. Relationship to existing exp5 mechanisms (compose, don't duplicate)

- **M06-sizing (DIR-004):** this proposal *sets* the sizing decision (milestone =
  ≤2000-line plan) M06 left open; the plan's ≤500/≤200 nesting are the sub-budgets.
  A plan-time line-budget gate is required (else it is the DIR-002 "enforcement
  half never built" pattern again).
- **M12 (parent/children WRITE):** the milestone→task grouping representation; now
  writable on both providers, so the skill can build it portably.
- **M13 / DIR-009 (task-backlog projection):** proposals attach to the same tasks
  DIR-009 makes canonical; §3's "process invisible in the board" is an explicit
  refinement of DIR-009's self-hosting scope.
- **DIR-011 (edit-surface + portable metadata):** the body-vs-extra rule the
  proposal write-back depends on; M14 is designing the Core-CLI relaxation that
  makes full-field task writes ergonomic.
- **Adversarial-audit gate (DIR-007 / M10):** the downstream independence end of
  the clamp — reused unchanged, not merged into the tail verification (kept as two
  distinct capabilities, consistent with the release-cadence proposal's
  separation-of-concerns principle).

## 10. Non-goals / open decisions

- **Non-goal:** rendering stage-level process in the Web UI (§3 accepted
  consequence). **Non-goal:** deleting or forking `proposal-to-plan` for non-quay
  use — it stays as-is for free-markdown workflows; the new skill is additive.
- **Open (non-blocking):** exact line-budget gate thresholds and how "lines" are
  counted (follow `proposal-to-plan`'s files-touched + added/changed convention);
  the precise convergence delta for the plan check's stop rule; whether the
  methodology class should *also* eventually adopt proposal-re-derivation or keep
  whole-milestone re-derivation.

---

# Part II — Fully-specified `quay-task-to-plan` skill design (M17-task-to-plan-skill-design)

The sections below mature §§1-10's conversational draft into a dispatch-ready
skill design, per this milestone's charter in-scope items 1-8. Each section is
labeled with the charter item it satisfies. Nothing here contradicts §§1-10; it
makes those decisions concrete and operational.

## 12. Quay task read/write behavior (charter item 2 / DIR-012 item 1's read/write half)

### 12.1 Provider ABI tool(s) used

Per DIR-009 item 8's existing provider-tool convention (§8 of
`docs/proposals/exp5-task-backlog-primitive-projection.md`, "SELECT reads quay via
the provider tool — read path"): the skill MUST use the Provider ABI tool surface
exclusively, never read/write `backlog.md` or any other generated markdown view as
a data source or sink.

- **Read.** `mcp__quay__task_list` (candidate/milestone-membership queries, e.g.
  `label: milestone:<id>`) and `mcp__quay__task_get` (single-task detail, including
  current `body`, `labels`, `parent`/`children`) — or their CLI equivalents
  (`node packages/quay/bin/quay.js task list --label milestone:<id> --json`,
  `task get <id> --json`) when the skill runs outside an MCP-tool-equipped context.
- **Write.** `mcp__quay__task_write` (or CLI `task edit`, per M16-cli-edit-parity-
  impl's now-landed full-field flag surface) for every proposal write-back (§12.2)
  and every milestone→task grouping write (§12.3). The skill never writes task
  data through any channel other than this tool — no direct file edits to the
  native store's frontmatter, even though the skill runs inside the same repo
  that hosts the native store, because that would silently break the
  provider-agnostic contract §12's own point is to preserve.
- **Check.** `mcp__quay__task_check` (or CLI `task check`) for the gate-mechanics
  read used at plan-check/TDD-gate time (§14, §15) — the skill's plan-check and
  TDD-gate steps consult `task_check`'s existing gate semantics rather than
  inventing a parallel status representation.

### 12.2 Proposal → `body` write-back shape (DIR-011 portable-metadata rule)

Per the portable-metadata convention (`inherited-core.md`, "Portable-metadata
convention (body-first, `extra{}` native-only)", inserted verbatim by
M16-cli-edit-parity-impl): a task's proposal is portable metadata — it MUST live
in the task's `body`, not solely in `extra{}`.

**Concrete write-back shape** (mirrors the existing `## Status mirror` body-section
convention M05's projection design and M13's `Status mirror:` line already
established — same shape, new section name):

```markdown
## Proposal

Source: <adjudicated | single-author>, <ISO date>, <author identity: subagent
persona label(s) or "single-pass">

<proposal body — the adjudicated (or, for N=1 fallback, single-author) approach
description: problem framing, approach, key design decisions, explicitly-listed
alternatives considered and rejected (§13.2 requires this list to be preserved,
not discarded at adjudication)>

### Adjudication note
<present only when N≥2 — which proposal(s) diverged, on what axis, and which
resolution was chosen and why; absent entirely for N=1 fallback or when N≥2
proposals converged with no material divergence>
```

- **`extra{}` mirror (optional, native-only convenience):** the skill MAY
  additionally write `extra.proposalStatus` (e.g. `adjudicated` / `pending`) on
  native as a query-performance convenience — per the portable-metadata rule's own
  corollary, this mirror is never the sole record of the fact; the `## Proposal`
  body section above is authoritative and sufficient on its own.
- **Regeneration, not write-once.** Per §3's "not write-once" finding (task
  granularity is variable, DIR-009), a task's `## Proposal` section is
  REPLACED (not appended-and-orphaned) whenever the task is re-grouped into a
  different milestone or its proposal is regenerated — the skill's write-back
  step always does a full-section replace of `## Proposal` through (but not past)
  the next `##` heading, the same idempotent-section-replace discipline the M05
  projection design already uses for `## Status mirror`.

### 12.3 Milestone → task grouping (M12 parent/children WRITE, reused unchanged)

Per charter item 2's explicit instruction ("reusing M12's real parent/children
WRITE capability, not a new mechanism") and §12's grouping precedent already
established by the task-backlog-projection design (`exp5-task-backlog-primitive-
projection.md` §2/§12): this skill does **not** invent a new grouping mechanism.

- **Primary portable grouping key: the `milestone:<id>` label** (per
  `exp5-task-backlog-primitive-projection.md` §2/§12 — label is the
  provider-portable grouping mechanism, since GitHub issues have no native
  parent-link field and M09's hard-error floor pre-M12 blocked `parent`/`children`
  writes; label write is supported on both providers unconditionally).
- **`parent`/`children` is reserved for epic-decomposition** (a single
  over-scoped task split into several sub-tasks), a DIFFERENT relationship than
  milestone membership, per the same §2/§12 distinction — the skill uses
  `parent`/`children` ONLY when it is itself performing an epic-split (e.g. a
  proposal-adjudication step concludes the task should be decomposed into
  multiple sub-tasks before planning), never as the milestone-grouping key.
  This is real, bidirectionally-writable on both providers as of M12
  (native: `parent`/`children` frontmatter fields, `packages/quay-native/src/
  store.js:264-307`; GitHub: checkbox-in-body convention,
  `packages/quay-github/src/github-client.js`'s `extractChildRefs`/
  `CHILD_CHECKBOX_RE`, write side landed by M12-abi-parent-write) — the skill
  calls `task_write` with `parent`/`children` fields exactly as any other quay
  client would; it does not need provider-specific branching, because M12 already
  made this portable at the Provider ABI layer.
- **Milestone-level plan record placement.** Per §3's `plan ↔ milestone` alignment
  ("phase/stage are NOT written into the task board as a child-task tree"): the
  plan document itself is NOT a quay task and is NOT represented via
  `parent`/`children` — it lives at
  `experiments/quay-perpetual-stream/milestones/M<NN>-<slug>/plan.md` (or the
  equivalent path inside whatever repo/experiment structure hosts the milestone),
  a plain file, cross-referenced from the milestone's grouping tasks' `body` via a
  `Plan: <path>` line (same body-line convention as M05's `Status mirror:` line)
  but never written INTO the task tree as child tasks per phase/stage.

## 13. N-independent-proposal + adjudication step (charter item 3)

### 13.1 Mechanism

For each task selected into a development-class milestone (per §5's two-class
split), the skill dispatches **N=2 independent subagents** (§10's "Open"
decision now resolved — 2 is the default, per the prior-art precedent
(`proposal-to-plan`) and exp5's own M13 both having used 2 independent passes;
raise N only for a task explicitly flagged high-stakes at SELECT time, never as a
silent per-task judgment call inside the skill itself):

1. **Blank-slate-leaning dispatch.** Each of the N subagents receives only: the
   task's current `body`/title/labels (the value description), the milestone
   charter (if one exists yet) or the raw candidate description (if pre-charter),
   and this design doc's §12.2 write-back shape instruction. Subagents are NOT
   shown each other's output and are NOT run in the same context — per §6's
   "no inter-agent communication" requirement, this is what makes divergence a
   real signal rather than an artifact of shared anchoring. Persona/prompt
   differentiation (e.g. "propose the minimal-surface-area approach" vs. "propose
   the approach most consistent with existing patterns in this codebase") is
   permitted and encouraged as a cheap way to widen genuine divergence (§6).
2. **Adjudication step.** A THIRD subagent (or, at the milestone author's
   discretion for small tasks, a synchronous review by whoever is running the
   dispatch) receives BOTH proposals and is charged explicitly to: (a) identify
   whether they converged (same approach, differing only in low-stakes framing)
   or diverged (a real approach-level disagreement, the M13 DIR-010-namespace
   precedent), (b) for divergence, adjudicate a winner or explicitly synthesize a
   merged approach, recording the adjudication note per §12.2's body shape, (c)
   for convergence, write back the (near-)identical content with no adjudication
   note required.
3. **Write-back.** The adjudicated (or converged) proposal is written to the
   task's `body` per §12.2's shape — exactly once per task, by the adjudication
   step, never by either of the N proposal subagents directly (this avoids a
   race/overwrite hazard between N≥2 concurrent writers).

### 13.2 Relationship to `proposal-to-plan`'s existing architect-review — STRENGTHENS, does not replace

This is the charter's explicit disambiguation requirement (item 3): the
N-independent-proposal + adjudication step is an ADDED adversarial pass, not a
substitute for `proposal-to-plan`'s existing single sequential architect-review
step.

- **`proposal-to-plan`'s existing pipeline** (§2's citation): proposal →
  architect-review → plan → architect-review → commit — ONE proposal author,
  reviewed sequentially by a SECOND agent that critiques (not re-derives) it.
- **What `quay-task-to-plan` adds:** it inserts parallel re-derivation UPSTREAM of
  where `proposal-to-plan`'s architect-review sits — N independent AUTHORS
  (not reviewers) produce N candidate proposals before any review happens, then
  adjudication (§13.1 step 2) resolves them into the single proposal that THEN
  enters `proposal-to-plan`'s own architect-review step unchanged. So the full
  chain for a `quay-task-to-plan`-driven task is:

  ```
  N independent proposal authors → adjudication → [existing] architect-review → plan → [existing] architect-review → commit
                                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^ unchanged, reused as-is
  ```

  The architect-review step's existing job (catching mechanical/verifiable errors
  in the SINGLE adjudicated proposal, per §2's evidence) is unchanged and still
  runs; `quay-task-to-plan` neither removes it nor duplicates its function. It
  answers a different question (§5's framing): N-independent-proposal +
  adjudication catches APPROACH-divergence (a judgment call, e.g. M13's DIR-010
  namespace decision) that a single-author + reviewer pipeline cannot surface at
  all, because there is only ever one proposal in that pipeline for the reviewer
  to critique — nothing to diverge FROM.
- **Concrete non-overlap check:** if the N proposals converge (§13.1 step 2's
  convergence case), the adjudication step adds negligible cost (a same-approach
  confirmation) and architect-review proceeds exactly as it would have with a
  single author. If they diverge, architect-review still runs afterward on
  whichever approach adjudication selected — it is never skipped, and never
  asked to arbitrate between the two raw candidate proposals itself (that is
  adjudication's job, not architect-review's).

## 14. Plan author + grounded convergent-check step (charter item 4)

### 14.1 Mechanism

Once a milestone's tasks all carry adjudicated proposals (§13), a SINGLE plan
author subagent produces the milestone-level plan record (§12.3's placement) —
phases (≤500 lines), stages (≤200 lines), dependency order, per-stage TDD ≥80%
acceptance criteria (§15) — sequencing the ALREADY-ADJUDICATED task proposals'
implementation, per §7's "check, not re-derive" grounding (plan-class errors —
signatures, call-sites, stage ordering, sizing, TDD semantics — are verifiable
against ground truth, not judgment divergences the way approach is).

The plan author is followed by a **grounded convergent-check subagent**:

1. **Maximally codebase-grounded** (§6's grounding-differs-by-role
   requirement): the check subagent reads the actual current signatures,
   call-sites, and dependency graph the plan claims to sequence — it does not
   re-derive a second independent plan from the proposals; it CHECKS the one plan
   that exists against ground truth.
2. **What it checks, concretely** (per §2's evidence of what these checks
   actually catch): function/type signatures referenced in the plan match the
   real codebase; call-site line numbers are current (not stale from an earlier
   plan-author pass); stage ordering respects real dependencies (e.g. update
   call-sites before deleting the old symbol, not after); TDD semantics per stage
   are correct for the language/toolchain (e.g. "expect BUILD FAIL" only applies
   where the toolchain actually fails to build on an undefined reference); line
   budgets (≤500/phase, ≤200/stage) are arithmetically correct against the plan's
   own stated file-touch list; the code-vs-prose classifier (§15.2) is applied
   correctly per stage.
3. **Revision loop.** If the check finds material issues, the plan author
   revises (not a fresh independent plan — an edit to the existing one,
   informed by the check's findings) and the check subagent re-runs against the
   revised plan.

### 14.2 Convergence / stop condition — precise statement

Reusing BAIME's own ΔV-small-and-stable pattern (§7's citation), stated
precisely for this context (adapting `inherited-core.md`'s inner-termination
condition 2, "ΔV<0.02 both layers K=2 consecutive," to the plan-check's
single-metric setting):

- **Convergence metric.** Each check round produces a count of MATERIAL findings
  (an issue in the §14.1.2 checklist that would change the plan's content if
  fixed — NOT cosmetic wording changes). Call this `F_i` for round `i`.
- **Stop condition (met when EITHER fires):**
  - **(a) Zero-finding convergence:** `F_i = 0` for one full round — the check
    subagent reviewed the plan in full against ground truth and found no
    material issue. This is the expected/common case and requires only one
    round beyond the round that produced `F_i = 0` to confirm (i.e. the round
    itself IS the confirmation; no extra confirmatory round is required, since
    unlike BAIME's dual-layer V this is a single boolean-ish signal per round,
    not a continuous score needing K=2 stability).
  - **(b) Diminishing-returns cap:** the round count reaches **3** (the cap
    stated in §7 and DIR-012's own Finding #5, "iterate to convergence... cap
    ~2-3 rounds") — if round 3 still finds material issues, the milestone STOPS
    the automated check loop and escalates to a human/architect-review decision
    rather than iterating indefinitely (mirrors `inherited-core.md`'s own
    condition-3 "ceiling → redesign-OR-stop" pattern, applied at the plan-check
    granularity rather than the whole-milestone granularity).
- **Why not BAIME's literal K=2-of-ΔV<0.02:** that pattern was designed for a
  continuous dual-layer VALUE score trending toward a threshold across many
  iterations; the plan-check loop is a discrete, small-N (≤3), single-metric
  correction loop, so the adaptation keeps the SHAPE (stop when additional
  rounds stop finding new problems, cap the total cost) without importing the
  two-consecutive-reading smoothing BAIME uses for a noisier, continuously-valued
  metric. This is stated explicitly here so a future implementing milestone does
  not need to re-derive whether the literal K=2/ε=0.02 numbers apply (they do
  not — F_i=0-once or round-cap-3 are this context's own precise numbers).
- **Optional ad hoc re-derivation escape hatch (§7's own carve-out, unchanged):**
  if round 3 still finds material issues AND the underlying disagreement is a
  decomposition-shape question (not a ground-truth-checkable fact), the milestone
  MAY request a second independent plan ad hoc — this remains the exception, not
  the standing mechanism (§7).

## 15. TDD ≥80%-per-stage hard gate (charter item 5)

### 15.1 What it gates, precisely

Every stage (≤200 lines, per §4's nested budget) in the milestone-level plan
record MUST carry, before that stage is marked complete in the plan (not the
task board — §12.3):

- A stated **acceptance test set** for the stage (specific test file(s)/case(s),
  not "tests pass" as a bare claim).
- A **coverage figure for the stage's own changed/added lines** (not the whole
  repo's aggregate coverage, which would let a well-covered stage mask a
  poorly-tested one) of **≥80%**, computed by whatever coverage tool the
  target language/toolchain already uses in this repo (e.g. `c8`/`nyc` for the
  Node.js packages here), with the RAW tool output pasted into the stage's
  completion evidence — narrative claims of coverage are explicitly insufficient
  (same evidence-gate discipline `inherited-core.md`'s "dogfooding evidence-gate"
  it0 check already applies elsewhere in this experiment).
- This is a **hard gate, not advisory**: a stage without a pasted ≥80% coverage
  figure (or the §15.2 prose-net substitute) CANNOT be marked DONE in the plan
  record, full stop — stricter than exp5's current default "paste test output"
  evidence convention, which does not enforce a numeric threshold.

### 15.2 Code-vs-prose per-stage classifier (scope caveat, carried from §8's point 4, "TDD ≥80% per stage is a hard gate")

The ≥80% LINE-coverage number applies **only to executable code** stages (JS,
shell, etc.). For prose/skill/template/manifest stages (a `SKILL.md`, subagent
prompt templates, markdown design docs — which `quay-task-to-plan`'s OWN
eventual implementation is largely made of), the gate degrades to the
**mechanical-check discipline** already established by `docs/plans/2-exp5-
driver-deliverability-packaging.md` (gate-hash / projection-check `it0-*.sh`
script runs, scaffold-lint, isolation test) — never a coverage percentage,
since "80% of a markdown file's lines are covered" is not a meaningful claim.

**Per-stage classification is mandatory and explicit**, recorded in the plan
record itself at plan-author time (not decided ad hoc at stage-completion time):
each stage in the plan is tagged `[code]` or `[prose]`, and the plan-check
subagent (§14.1.2) verifies the tag is correct (a stage that touches both gets
split, or the code portion's ≥80% figure is computed on only the code files
within that stage, with the prose files in the same stage separately satisfying
the mechanical-check net).

### 15.3 Why load-bearing specifically here — single-implementation rationale

Per §6's two-ends-clamp design: independence is spent at BOTH ends (upstream
proposal re-derivation, §13; downstream adversarial-audit, unchanged/reused from
DIR-007/M10) but the IMPLEMENTATION itself runs **once**, in the middle, with no
separate independent re-implementation or independent tail-verifier spawned
(§6's explicit "tail self-check degrades to light" design choice). This is the
precise reason the TDD gate must be a HARD gate here, stricter than the
"paste test output" convention this experiment otherwise defaults to:

- In a whole-milestone-independent-re-derivation design (the methodology class,
  §5), a second independent pass over the SAME deliverable is itself a
  correctness net — if the two independent derivations agree, that agreement is
  evidence; if they disagree, the disagreement itself is caught.
- In the dev class's two-ends-clamp design, there is **no second independent
  pass over the implementation itself** — proposal-level independence (§13)
  catches approach errors BEFORE any code is written, and adversarial-audit
  catches claim-inflation AFTER the milestone claims completion, but NEITHER
  independently re-derives or re-checks the actual line-by-line correctness of
  the code the single implementation pass wrote. The TDD ≥80%-per-stage gate is
  therefore the ONLY mechanism in this pipeline that can catch a
  correctly-approached, correctly-planned, but incorrectly-CODED stage — remove
  it (or leave it advisory) and the pipeline has a hole exactly where M09-style
  milestones currently rely on tail-verification (which THIS design deliberately
  degrades to a light self-check, per §6, precisely because it is trusting the
  TDD gate to have already done the load-bearing work per-stage, incrementally,
  rather than waiting to catch everything at the end).

## 16. Provider-agnostic GitHub degradation (charter item 6)

Stated explicitly, extending §8's point 5 ("Provider-agnostic: everything the
skill writes to tasks respects the body-portable / extra-native-only rule...")
one-line summary into a precise behavior specification:

- **`## Proposal` body write-back (§12.2):** fully supported on GitHub — `body`
  is a portable field per the portable-metadata convention; no degradation
  needed. Same for the `extra.proposalStatus` native-only mirror: simply omitted
  on GitHub (never attempted), per the portable-metadata rule's own corollary —
  the body copy alone remains sufficient.
- **`milestone:<id>` label grouping (§12.3):** fully supported on GitHub — label
  write is unconditionally supported on both providers per
  `exp5-task-backlog-primitive-projection.md` §2's own citation; no degradation
  needed.
- **`parent`/`children` epic-decomposition writes (§12.3):** fully supported on
  GitHub as of M12-abi-parent-write (checkbox-in-body convention,
  `extractChildRefs`/`CHILD_CHECKBOX_RE`) — this was the LAST unimplemented
  Provider-ABI write field pre-M12; post-M12 there is no remaining GitHub
  hard-error floor on this path. The skill calls `task_write` with
  `parent`/`children` exactly as it would on native.
- **`extra{}` on GitHub tasks — the ONE path that still hits the hard-error
  floor.** Per PR-ABI-001 (M09-gh-write)'s hard-error floor, unchanged and not
  reopened by this design: any attempt to write `extra{}` fields on a GitHub
  task MUST hard-error with the existing PR-ABI-001 floor message, leaving the
  GitHub issue unmodified — exactly the same behavior M14-cli-edit-parity's §5.2
  worked example already conformance-tests for `--extra`. `quay-task-to-plan`
  does not introduce any NEW `extra{}` dependency (§12.2 explicitly makes the
  `extra.proposalStatus` mirror optional/native-only-convenience, never load-
  bearing) — so this skill hits the SAME, already-established floor, not a new
  one, and requires no new provider-branching logic of its own. This is also
  §18's non-goal 3, restated here as the operational behavior.
- **Net effect:** every write `quay-task-to-plan` performs as part of its
  standing operation (`body`, `labels`, `parent`/`children`) is fully portable
  post-M12; only the OPTIONAL, non-load-bearing `extra{}` convenience mirror
  degrades, and it degrades by simply not being attempted on GitHub (the skill's
  own write-back logic branches on provider capability the same way M14's
  `task edit` relaxation already does — check provider capability before
  attempting the `extra` write, never attempt-then-catch a hard error as normal
  control flow).

## 17. Dispatch-ready Done-when clauses a future implementing milestone would need (charter item 7)

Matching the concrete, pasted-diff/invocation-style checklist form of
`exp5-task-backlog-primitive-projection.md` §15 and `exp5-cli-edit-parity.md` §6
(both M13/M14's own equivalent sections) — narrative descriptions are
insufficient for each item below; the implementing milestone must paste the
literal evidence named.

- [ ] A new skill directory `.claude/skills/quay-task-to-plan/` exists with a
      `SKILL.md` describing the pipeline in §13/§14 (proposal N-independent +
      adjudication → architect-review [reused from `proposal-to-plan`] → plan
      author + grounded convergent-check → single implementation with per-stage
      TDD gate → light tail self-check) — pasted `SKILL.md` content or diff.
- [ ] The skill's proposal-authoring subagent prompt(s) implement the
      blank-slate-leaning dispatch of §13.1 step 1 (task body/title/labels +
      charter/candidate description only, NO cross-subagent context sharing) —
      pasted subagent prompt text, plus a real dispatch trace (e.g. manda
      `Dispatch`/`Agent` tool-call log) showing N=2 independent, non-communicating
      invocations for at least one real task.
- [ ] The adjudication subagent prompt implements §13.1 step 2's three outcomes
      (converged / diverged-adjudicated / diverged-synthesized) and writes back
      per §12.2's exact body shape — pasted before/after `task_get` body output
      for at least one real task showing the `## Proposal` section landed
      correctly, including an `### Adjudication note` subsection for at least one
      genuinely-diverged case (not only convergent cases — a diverged case must
      be demonstrated, or the adjudication step's actual function is unverified).
- [ ] The plan-author + grounded-convergent-check loop (§14) is implemented as
      two distinct subagent roles (author vs. checker, per §14.1) with the
      checker's grounding requirement (real signature/call-site/dependency-graph
      reads, not proposal-text-only) demonstrable — pasted checker subagent
      prompt text plus at least one real round-trip (author output → checker
      findings → author revision) for a real milestone-shaped plan.
- [ ] The §14.2 convergence/stop condition (`F_i=0` once, OR round-cap 3) is
      implemented as an explicit, mechanically-checked loop-exit condition in the
      skill's orchestration code/prompt (not left to the dispatching agent's
      informal judgment of "looks converged") — pasted orchestration logic/prompt
      excerpt showing the exit check.
- [ ] The plan record includes the §15.2 mandatory per-stage `[code]`/`[prose]`
      classification tag, and the plan-check subagent verifies tag correctness
      per §14.1.2 — pasted example plan-record excerpt showing at least one
      `[code]` and one `[prose]` stage, correctly tagged.
- [ ] The per-stage TDD ≥80% hard gate (§15.1) is enforced as a mechanical block
      on marking a `[code]` stage DONE in the plan record — i.e. the skill's own
      tooling refuses (not merely warns) to advance past a stage lacking a pasted
      ≥80% coverage figure — pasted evidence of the block actually firing on a
      deliberately-under-tested stage (a real negative-case demonstration, not
      only the positive "gate passed" case).
- [ ] `[prose]`-tagged stages are gated by the mechanical-check discipline (§15.2)
      instead of a coverage percentage, demonstrated on at least one real prose
      stage (e.g. the skill's own `SKILL.md` authoring, if self-hosted per §19's
      preserved bootstrap-resolution paragraph, "bootstrapped on the existing
      `proposal-to-plan`") — pasted gate-hash/projection-check script output.
- [ ] Milestone→task grouping writes exclusively through `task_write`'s
      `labels`/`parent`/`children` fields (§12.3), verified on BOTH providers —
      pasted two-provider conformance probe output (native + GitHub), following
      the same conformance-harness pattern M14-cli-edit-parity's §5 established.
- [ ] The GitHub `extra{}` hard-error floor (§16) is NOT reopened — a
      conformance probe confirms `quay-task-to-plan`'s own write-back logic never
      attempts an `extra{}` write on a GitHub task (checks provider capability
      first, per §16's "check before attempt" requirement) — pasted probe output
      showing zero `extra` write attempts logged against the GitHub provider
      across a full skill dry-run.
- [ ] Reuse (not reimplementation) of `feature-developer`'s orchestration is
      demonstrated where applicable (DIR-012 item 1's explicit instruction,
      carried through from this doc's §8 point 6) — pasted citation showing which
      parts of `feature-developer`'s existing orchestration logic the new skill
      invokes or wraps, and which parts it necessarily diverges from (with a
      stated reason for each divergence).
- [ ] `git diff --stat` against the implementing milestone's own pre-charter base
      commit shows only the expected files touched (new skill directory under
      `.claude/skills/quay-task-to-plan/`, any conformance-test additions, no
      unrelated product code) — same evidence-gate discipline M13/M14's own §15/
      §6 closing clauses used.
- [ ] Full existing test suite still passes post-change (pasted raw output) —
      same closing gate M05/M13/M14's own Done-when clauses used.

## 18. Non-goals (charter item 8, DIR-012's carried-through list — restated precisely for this skill)

1. **No stage-level process rendered in the Web UI.** Per §3's accepted
   consequence (unchanged, restated for completeness here): the plan record
   (§12.3's placement, a plain file, not a quay task) is never surfaced through
   the Web UI's task/milestone views. Only the value structure (task/milestone
   done-or-not) is self-hosted; the implementation PROCESS (phase/stage progress)
   stays invisible to the Web UI by design. A future milestone MAY choose to
   change this, but `quay-task-to-plan`'s own design does not attempt it, and no
   Done-when clause in §17 above requires or implies Web UI rendering of stages.
2. **No fork or deletion of `proposal-to-plan` for non-quay use.**
   `proposal-to-plan` stays exactly as it is today, for free-markdown workflows
   outside the quay task board (e.g. this very design doc's own precedent docs,
   `docs/plans/1-…`/`docs/plans/2-…`) — `quay-task-to-plan` is purely additive, a
   NEW skill directory, never a modification to or replacement of the existing
   one. §13.2's pipeline diagram shows `quay-task-to-plan` CALLING INTO
   `proposal-to-plan`'s existing architect-review step, not absorbing or forking
   its code.
3. **No `extra{}` storage on GitHub tasks — the PR-ABI-001 hard-error floor is
   unchanged.** Per §16: `quay-task-to-plan` introduces no new `extra{}`
   dependency of its own, and any attempt to write `extra{}` on a GitHub task
   must still hard-error exactly as it does today. This design does not request,
   and a future implementing milestone must not add, any GitHub-side `extra{}`
   write path.

---

## 19. Status / next step (supersedes original §11's DRAFT-era framing)

**Original §11 (DRAFT, 05a8066), preserved for provenance:** "Design-only.
Natural routing (consistent with DIR-009/010/011): capture the human-steering
origin as a DIR, which requests a design-doc milestone to fully specify the new
skill; then a first *implementation* milestone builds the skill and is itself
the first dev-class milestone to run through the very pipeline it defines (a
clean dogfooding loop — and the new skill can be designed using the existing
`proposal-to-plan` as a cross-check). The overdue implementation milestones
already queued (M-TASK-BACKLOG-PROJECTION impl, M-CLI-EDIT-PARITY impl, release
cadence) are the natural first customers."

**Current status (M17-task-to-plan-skill-design, this milestone):** the DIR was
filed (`DIR-012`) and drained exactly per that routing — this milestone
(charter item 1) has now produced the "fully specify the new skill" deliverable
the DIR's Requested-action item 1 asked for (§§12-19 above, this closing status
section included). Still Design-only:
per this milestone's charter, DIR-012 items 2 (`inherited-core.md`/
`OUTER-LOOP.md` milestone-model changes — the ≤2000-line ceiling, nested ≤500/
≤200 budgets, two-class diversity policy, two-ends-clamp pipeline as reusable
substrate) and 3 (dogfooding — the first implementation milestone building and
running through the skill) are explicitly OUT OF SCOPE here, left for
following milestones once this design is itself reviewed. The natural next
steps, unchanged from DIR-012's own routing: (a) a future milestone lands DIR-012
item 2's `inherited-core.md`/`OUTER-LOOP.md` changes; (b) a following
implementation milestone builds `.claude/skills/quay-task-to-plan/` per §17's
checklist, bootstrapped on the existing `proposal-to-plan` per this doc's
original §11 bootstrap-resolution paragraph (unchanged — still the correct
answer to the chicken-and-egg problem, since that skill still does not exist
after this milestone). `M16-cli-edit-parity-impl` (already ABSORBed, m16) and
the overdue `M-TASK-BACKLOG-PROJECTION` implementation remain the natural first
true-dogfood customers, as originally stated.
