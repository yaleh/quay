# A quay-task-native proposal→plan skill, and the exp5 milestone-model changes it requires

**Status:** DRAFT (proposal). Authored 2026-07-18 from a live human-steering
conversation. Precedes any DIR / backlog candidate — this is the design artifact
the eventual DIR and milestone charters build against.

**Scope:** introduce a new skill, analogous to the existing `proposal-to-plan`
but native to quay's task spec, and adopt the milestone-model changes that make
it usable inside the exp5 perpetual OUTER loop for typical *development* work
(up to ~2000 lines of change), not just the small methodology milestones exp5
has run so far.

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

## 11. Status / next step

Design-only. Natural routing (consistent with DIR-009/010/011): capture the
human-steering origin as a DIR, which requests a design-doc milestone to fully
specify the new skill; then a first *implementation* milestone builds the skill
and is itself the first dev-class milestone to run through the very pipeline it
defines (a clean dogfooding loop — and the new skill can be designed using the
existing `proposal-to-plan` as a cross-check). The overdue implementation
milestones already queued (M-TASK-BACKLOG-PROJECTION impl, M-CLI-EDIT-PARITY impl,
release cadence) are the natural first customers.
