# A quay-task-native proposal→plan skill, and the exp5 milestone-model changes it requires

**Status:** MATURED / dispatch-ready (design-doc-only). §1-11 are the original
DRAFT (commit `05a8066`, 2026-07-18, authored live alongside DIR-012) — read in
full and cited, not re-derived, per this milestone's Done-when clause 1. `git
log -- docs/proposals/exp5-quay-task-proposal-plan-skill.md` at the time §12-18
below were authored shows exactly one prior commit (`05a8066`), so §1-11 is the
current, not a stale, version of the starting draft. §12-18 are new, added by
milestone M17-task-to-plan-skill-design (charter:
`experiments/quay-perpetual-stream/charters/M17-task-to-plan-skill-design.md`)
to fully specify the skill per DIR-012 Requested-action item 1, and to produce a
dispatch-ready "Done-when clauses a future implementing milestone would need"
section, matching the M13 (`exp5-task-backlog-primitive-projection.md` §15) /
M14 (`exp5-cli-edit-parity.md` §6) precedent.

**Scope:** introduce a new skill, analogous to the existing `proposal-to-plan`
but native to quay's task spec, and adopt the milestone-model changes that make
it usable inside the exp5 perpetual OUTER loop for typical *development* work
(up to ~2000 lines of change), not just the small methodology milestones exp5
has run so far.

## Table of contents — M17 addition map (§12-18)

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

**Bootstrap resolution (the pipeline can't run through itself before it exists).**
The skill-implementation milestone cannot be run through `quay-task-to-plan`
because that skill is its own deliverable. Resolve the chicken-and-egg explicitly:
that first milestone runs through the **existing `proposal-to-plan`** skill (which
already produces the proposal→review→plan→review→commit artifacts, just as
free markdown) as its plan-discipline substrate, and the *design* of
`quay-task-to-plan` is cross-checked against `proposal-to-plan` step-by-step. Only
the *second* dev-class milestone onward runs through the new skill itself. So the
"clean dogfooding loop" begins one milestone later than the skill build; the build
itself is bootstrapped on the proven prior-art skill.

**Routing note (added M17, 2026-07-18):** the human-steering origin has since been
captured as `DIR-012` (archived), resolved at the m16→m17 SELECT boundary by
chartering this milestone (M17-task-to-plan-skill-design) exactly per DIR-012
Requested-action item 1 — design-doc-only, no implementation, no
`inherited-core.md`/`OUTER-LOOP.md` edits (DIR-012 items 2/3, explicitly deferred
to a following milestone; see §18 below and this milestone's own charter). §12-18
below are that maturation.

---

## 12. Quay task read/write behavior (charter in-scope item 2 / Done-when clause 2)

This section fully specifies the skill's Provider ABI usage, the proposal→`body`
write-back shape, and the milestone→task grouping mechanism — reusing existing
mechanisms exactly, no new ABI surface.

### 12.1 Provider ABI tool(s) used (per DIR-009 item 8's convention)

The skill reads and writes quay tasks exclusively through the Provider ABI's MCP
tools — never by reading/writing `backlog.md` or any generated view directly, the
same discipline DIR-009 item 8 established for SELECT:

- **Read the milestone's grouped task set:** `mcp__quay__task_list` filtered by
  the milestone's grouping key (`label: milestone:M-NN`, per §12.3 below — reusing
  DIR-009 §12's chosen primary grouping key, not `parent`/`children`). CLI
  equivalent: `node packages/quay/bin/quay.js task list --label milestone:M-NN
  --json`.
- **Read a single task's current state before writing** (idempotent-write
  discipline, same pattern M14 §5's conformance probes use):
  `mcp__quay__task_get` / `task get <id> --json`.
- **Write the proposal back onto a task:** `mcp__quay__task_write` (or the Core
  CLI's `task edit`, post-M14/DIR-011 full-field parity) with a `body` patch —
  never `extra` as the sole carrier (§12.2). This is the same `client.taskWrite`
  → MCP `task_write` → provider hard-error-floor path M14 §2.2 already documents;
  the skill introduces no new write path, it is a **caller** of the existing one.
- **Verify a milestone's grouping-gate state (if the skill needs to confirm a
  task is dispatch-eligible before authoring a proposal for it):**
  `mcp__quay__task_check`, reused unchanged — same tool exp5's own gate mechanics
  already use, per `inherited-core.md` §1's "gate mechanics `task check`" citation.

No new Provider ABI tool is introduced. This directly satisfies DIR-012's own
Requested-action item 1 framing ("provider tool per DIR-009 item 8") and mirrors
M14 §2.1's "Core CLI must not assume native" principle: the skill is a caller of
`task_list`/`task_get`/`task_write`/`task_check`, provider-agnostic by
construction, with no skill-level branch on which Provider is active — see §16
for what happens when a write the active Provider does not support is attempted.

### 12.2 Proposal→`body` write-back shape (per DIR-011's portable-metadata rule)

The proposal is written back onto its task's `body` as a new, named markdown
section — **not** into `extra{}`, per the portable-metadata convention already
landed in `inherited-core.md` (M16-cli-edit-parity-impl, DIR-011 item 3; quoted
verbatim in `inherited-core.md`'s own "Portable-metadata convention" section).
Concrete shape, following the exact `## <Section Name>` / `Key: value` pattern
M05's `Status mirror:` line and M13's `## Backfill provenance` / `## Execution
record` sections already established (no new body-shape convention invented):

```markdown
## Proposal (quay-task-to-plan)

Approach: <1-3 sentence summary of the adjudicated proposal's chosen approach>
Adjudication: <"single candidate, no divergence" | "N=2, converged on round R" |
  "N=2, escalated to human — see below">
Proposal-round: <git-log-citable marker, e.g. authored-2026-07-18>

<full proposal prose — problem framing, approach, rejected alternatives, same
shape `proposal-to-plan`'s own step-1 output already uses>
```

- **Portable:** this whole section lives in `body` markdown — readable/writable
  on native AND GitHub (issue body), the same portability guarantee M14 §1/§3
  already proves for full-field `task edit`.
  Because this landed in M16, `quay-task-to-plan` needs zero further Core-CLI
  change; it is a **direct downstream beneficiary** of M14/M16, not something
  this design has to re-derive.
- **`extra{}` MAY additionally mirror the same fact** (e.g.
  `extra.proposalRound`) as a native-only query-performance convenience, per
  DIR-011's MAY clause — but the body section above is the sole authoritative
  copy; nothing the skill does may depend on the `extra{}` mirror being present
  (the DIR-011 corollary, quoted in full in `inherited-core.md`).
- **Regeneration discipline (per §3's note that a task's proposal is "not
  write-once"):** if a task is re-grouped (DIR-009's variable-granularity
  regrouping — an epic splits, or smalls merge into a new task), the skill
  REPLACES the `## Proposal (quay-task-to-plan)` section wholesale on the next
  run rather than appending a second copy — the same whole-section-replace
  discipline M05's projection anti-drift check already applies to `Status
  mirror:`. A stale proposal section left on a since-regrouped task is a drift
  bug, not an accepted state.

### 12.3 Milestone→task grouping (reusing M12's real parent/children WRITE — and DIR-009's label key)

Per §3's four-entity model, `plan ↔ milestone` — the plan is milestone-level, not
a child-task tree (§3's own "Accepted consequence"). The skill's grouping READ
uses the **same primary key DIR-009 §12 already chose for milestone membership**:
the `milestone:M-NN` **label** (portable on both providers — native and GitHub
both support label write; this is DIR-009's own reasoning for why label, not
parent/children, is the primary grouping key, reused unchanged here, not
re-derived).

`parent`/`children` (M12's real WRITE capability, `M-ABI-PARENT-WRITE`, merged
m12, confirmed still in `TASK_WRITE_SUPPORTED_FIELDS` per M14 §2.3's correction)
is used by this skill **only for the orthogonal epic-decomposition axis** — i.e.
if the N-independent-proposal step (§13) or the plan-author step (§14) needs to
literally split a task into sub-tasks as part of authoring the plan, it does so
via `task_write`'s `parent`/`children` fields, the same mechanism DIR-009 §2/§12
already documents, not a new mechanism. The skill does **not** invent a
plan-specific relation field; it reuses exactly the two existing portable/
native-enrichment axes DIR-009 already separated (label = milestone membership,
parent/children = epic decomposition), consistent with the charter's explicit
instruction ("reusing M12's real parent/children WRITE capability, not a new
mechanism").

---

## 13. Proposal step: N-independent-proposal + adjudication (charter in-scope item 3 / Done-when clause 3)

### 13.1 Mechanism

For each task in the milestone's grouped set (§12.3), N independent subagents
(default **N=2**, per §10's open-decision resolution — the prior art and exp5's
own M13 both used 2 independent passes) each author a full proposal **blank-slate-
leaning** (§6's grounding rule: minimize shared context between the N subagents so
divergence is a real signal, not an artifact of anchoring on shared context — the
documented condition for ensemble diversity to actually cancel error, §12 of the
original draft/§6 above). Each subagent's prompt includes only: the task's current
`body`/`labels` (its problem statement), the relevant repo context needed to
propose an approach, and NOT the other subagent(s)' output.

**Adjudication step** (new relative to `proposal-to-plan`'s single-pass flow):
after the N proposals are produced, a dedicated adjudication pass:
1. Diffs the N proposals for divergence on approach (not wording) — same
   detection shape as M13's own real divergence (the DIR-010 namespace decision:
   `extra.experiment` vs. experiment-prefixed ids), which the outer loop
   reconciled.
2. If the proposals **converge** (same approach, differ only in prose/emphasis):
   pick either deterministically (e.g. lexically-first subagent id) or merge
   prose — no escalation needed, adjudication is a no-op beyond logging
   convergence.
3. If the proposals **diverge** on a real approach decision: the adjudication
   step does NOT silently pick one. It writes the divergence explicitly into the
   task body's `Adjudication:` line (§12.2's shape) as
   `"N=2, escalated to human — see below"` plus a short structured comparison
   (option A vs. option B, one paragraph each), and defers the actual pick to the
   next human-review-cadence touchpoint (`inherited-core.md`'s human-review
   cadence rule) or an outer-loop reconciliation step (same pattern M13's own
   DIR-010 divergence was resolved by the outer loop, not by a scripted
   tie-break) — this design does NOT invent an automatic tie-breaking heuristic
   for genuine approach divergence, because that is precisely the judgment call
   §5/§7 of the original draft identifies as needing a human or outer-loop
   arbiter, not a mechanical rule.

### 13.2 Relation to `proposal-to-plan`'s existing architect-review — strengthens, does not replace

`proposal-to-plan`'s existing pipeline is: proposal → architect-review → plan →
architect-review → commit (single sequential proposal, single architect-review
pass per stage). This skill's N-independent + adjudication step is inserted
**upstream of, and in addition to**, that existing architect-review — it does
not remove or substitute it:

```
quay-task-to-plan proposal step:
   N independent proposal subagents (blank-slate-leaning)
        │
        ▼
   adjudication (converge, or explicit escalation — §13.1)
        │
        ▼
   [UNCHANGED] architect-review pass, exactly as proposal-to-plan already runs it
        │
        ▼
   adjudicated + architect-reviewed proposal → written back to task body (§12.2)
```

Concretely: the adjudicated proposal (output of §13.1) becomes the **input** to
the same architect-review subagent `proposal-to-plan` already dispatches for its
proposal-review stage — that reviewer still runs, unchanged, as an added
adversarial pass on top of the parallel re-derivation, exactly as the charter's
in-scope item 3 requires ("strengthening... into parallel re-derivation... while
keeping architect-review as an added adversarial pass"). The two mechanisms catch
different error classes (§5 of the original draft): N-independent re-derivation
surfaces **approach-level divergence** (a judgment call, caught by disagreement
between blank-slate peers); architect-review catches **review-detectable defects
in a single given proposal** (an already-committed approach's internal flaws) —
they are complementary, not redundant, which is why architect-review is retained
rather than dropped.

---

## 14. Plan step: author + grounded convergent check (charter in-scope item 4 / Done-when clause 4)

### 14.1 Mechanism

One subagent **authors** the milestone-level plan (phases ≤500 lines, stages
≤200 lines, dependency order, per-stage TDD ≥80% acceptance target — §4/§8.3 of
the original draft), grounded in the adjudicated+reviewed proposal(s) (§13) for
every task in the milestone's grouped set. This is a single author pass, not
independently re-derived (§7 of the original draft's core finding: re-deriving
the plan buys little because two independent readers of the same code tend to
share the same misreadings — diversity is spent upstream at the proposal instead,
§5).

The **plan-check subagent** is separate from the author, **maximally
codebase-grounded** (§6's grounding-differs-by-role rule): it reads real function
signatures, call-sites, and the dependency graph the plan claims to sequence, and
flags any of the concrete error classes §2 of the original draft documents from
real review-loop commits (wrong signatures, wrong call-site line numbers, wrong
stage ordering, wrong TDD semantics, off-by-one counts, line-estimate/schema-
conformance gaps). The check subagent proposes corrections; the author subagent
(or a fresh instance with the same authoring prompt + the check's findings)
revises the plan; the check subagent re-runs against the revised plan. This is
one **round**.

### 14.2 Convergence / stop condition — precise

Reusing BAIME's own ΔV-small-and-stable pattern (`inherited-core.md`'s inner
termination condition 2: "ΔV<0.02 both layers K=2 consecutive"), adapted to the
plan-check loop's own observable:

- Define **round delta** `Δ_round` = count of material findings the check
  subagent raises against the plan on round `R`, where "material" excludes
  purely cosmetic/wording changes (same class distinction §2 of the original
  draft draws between the two real review rounds it cites — round 1 caught
  signature/ordering errors, round 2 caught a distinct off-by-one + schema gap,
  both material; a hypothetical round finding only prose polish would NOT count).
- **Stop (converged) when:** `Δ_round = 0` on a round (the check subagent finds
  no further material issues) — the plan is accepted as-is.
- **Cap:** regardless of convergence, run **at most 3 rounds** (per the charter's
  "cap ~2-3 rounds" and the original draft §7's citation of real practice —
  meta-cc's two rounds, quay's "two rounds each"). If round 3 still finds
  material issues, the milestone does NOT proceed silently — it is flagged for
  outer-loop/human escalation (the same "genuinely contested decomposition"
  escalation path §7 of the original draft names for the declined-by-default
  plan-re-derivation option), rather than either accepting a known-flawed plan or
  looping unboundedly.
- **Minimum:** at least 1 round always runs (an authored plan is never accepted
  without at least one grounded check pass) — this is what makes the check
  load-bearing rather than a formality that can be skipped when round 1 "looks
  fine" to the author.

This gives a precise 3-value stop table:

| Round outcome | Action |
|---|---|
| `Δ_round = 0` on round R (R ≤ 3) | STOP — converged, plan accepted |
| `Δ_round > 0` on round R < 3 | Revise plan, run round R+1 |
| `Δ_round > 0` on round 3 (cap reached) | STOP — escalate to outer-loop/human, do not silently accept |

---

## 15. TDD ≥80%-per-stage hard gate (charter in-scope item 5 / Done-when clause 5)

### 15.1 What it gates, precisely

Every plan **stage** (≤200 lines, §4) that the single implementation pass (§6's
pipeline diagram — "single implementation, TDD ≥80% per stage") produces MUST
achieve **≥80% test coverage on the lines that stage changed**, measured by the
project's existing coverage tooling (same tool/invocation the stage's own tests
already run under — no new coverage tool introduced by this skill), **before**
that stage is marked complete and the implementation proceeds to the next stage.
This is stricter than exp5's current general "paste test output" evidence gate
(inherited-core / OUTER-LOOP's existing Done-when discipline) in two specific
ways: (a) it is a **numeric threshold**, not merely "tests were pasted and
passed"; (b) it is checked **per stage**, not only once at the end of the whole
milestone — a stage may not be marked done, and the next stage may not start,
until its own coverage number is pasted and ≥80%.

**Scope caveat, carried forward from §8.4 of the original draft (this design does
not weaken it):** the ≥80% *line-coverage number* applies only to
**executable-code stages** (JS, shell, etc.). For **prose/skill/template/manifest
stages** (a `SKILL.md`, subagent prompt templates, or a design-doc section —
which is what a good fraction of `quay-task-to-plan`'s own eventual
implementation will actually consist of), the gate is not "80% coverage" (a
category error — prose has no lines to execute) but the **mechanical-check**
discipline the M13/M14 doc-only precedent and plan-2's own finding already
established: gate-hash/projection-check script runs (`it0-*.sh`-style),
scaffold-lint, isolation tests. Each plan stage MUST be classified
code-or-prose by its author (§8.4's "per-stage classifier" requirement) and the
matching net applied — a stage may not claim TDD ≥80% compliance via a prose
mechanical-check pass, nor may a prose stage be waved through with no evidence at
all.

### 15.2 Why it is load-bearing SPECIFICALLY here (single-implementation rationale)

Per §6's "clamp at both ends" pipeline: independence is spent **upstream**
(N-proposal re-derivation, §13) and **downstream** (the existing adversarial-
audit gate, unchanged, at ABSORB) — the implementation itself runs **once**, in
the middle, with no independently re-derived second implementation to diff
against and no independent tail-verifier subagent spawned for it (§6: "tail
verification therefore degrades to a light self-check"). This is exactly the
structural difference from exp5's earlier M09-style milestones, which — even
where not literally re-implemented twice — could rely on a comparatively richer
downstream verification net (the adversarial-audit gate applied to smaller,
single-shot deliverables where the whole thing was small enough to hold in one
reviewer's head). At ~2000-line milestone scale, the single implementation pass
is the ONLY place a genuine implementation-correctness defect (as opposed to an
approach-level or plan-level defect, both already caught upstream) can be
caught before it reaches the light tail self-check + downstream audit. The
per-stage ≥80% TDD gate is what stands in for the "second independent pair of
eyes" the two-ends-clamp design deliberately does NOT spend on the
implementation itself — remove it, and single-implementation-at-scale has *no*
mechanical net between plan-check (§14, which checks the plan, not the code
actually written) and the light tail self-check, reproducing exactly the DIR-002
"invariant with no mechanical enforcement" pattern this milestone's own charter
names as a value-hypothesis driver. This is why the gate must be **hard** (a
milestone cannot proceed past a stage below threshold) rather than advisory.

---

## 16. Provider-agnostic degradation on GitHub (charter in-scope item 6 / Done-when clause 6)

Restating and making explicit (per the charter's own wording) what §12.1/§12.2
already implies structurally:

- **No skill-level provider branch.** Per §12.1, the skill calls
  `task_list`/`task_get`/`task_write`/`task_check` generically — it does not
  special-case "if GitHub then..." anywhere in its own logic, mirroring M14
  §2.1's "Core CLI must not assume native" principle exactly (this skill sits
  one layer above the Core CLI, same principle applies unchanged).
- **What happens when a write hits the GitHub hard-error floor (M09
  PR-ABI-001, unchanged, reused not modified):** if any step of the skill
  (proposal write-back §12.2, adjudication-escalation note, plan-record
  bookkeeping) ever attempts to write a field GitHub's `task_write` handler
  rejects — today, per M14 §2.3's correction, this is **only `extra`** among the
  fields this skill would plausibly touch (`title`/`body`/`labels`/`parent`/
  `children` are all GitHub-writable post-M12) — the MCP tool returns
  `isError:true` with the literal message
  `task_write: unsupported field(s) [extra] — this Provider does not implement
  writing extra. Supported fields: id, status, title, body, labels, parent,
  children.`, which `client.taskWrite` turns into a thrown `Error`, which
  propagates up as a **surfaced, non-silent failure** — never a silently
  dropped write. This skill introduces ZERO new error-handling code for this
  case; it inherits the existing floor for free, exactly as M14 §2.2 designed.
  Because §12.2 already designs the proposal write-back as **body-first, `extra`
  only as an optional native-only mirror**, in ordinary operation the skill
  should never actually need to write `extra` on a GitHub-backed task — the
  hard-error floor is a backstop against a future coding mistake, not a path the
  design intends to exercise routinely.
- **Milestone→task grouping degrades identically on both providers** (§12.3):
  the `milestone:M-NN` label write is supported on both native and GitHub
  (DIR-009 §12's own reasoning for choosing label as the *primary* grouping
  key specifically because parent/children was GitHub-unsupported at DIR-009's
  authoring time — now that M12 has closed that gap, label remains primary
  per DIR-009's design, with parent/children available as an enrichment on
  both providers, not exclusively native).
- **No new Provider-ABI capability is introduced by this skill** (mirrors M14
  §4's non-goal): `quay-task-to-plan` is a caller of the existing Provider ABI
  surface, at the existing hard-error floor, on both providers — it does not
  ask for, and does not require, any GitHub ABI extension (e.g. an `extra`-to
  -issue mapping) to function correctly.

---

## 17. Done-when clauses a future implementing milestone would need (charter in-scope item 7 / Done-when clause 7)

Matching the concrete, checklist-shaped, pasted-diff/invocation form M13 §15 and
M14 §6 both used — not narrative:

- [ ] `.claude/skills/quay-task-to-plan/SKILL.md` created, analogous in structure
      to `.claude/skills/proposal-to-plan/`'s existing `SKILL.md` (pipeline
      stages, subagent dispatch shape) — pasted diff / new-file listing.
- [ ] Provider ABI read path implemented per §12.1: milestone task-set read via
      `mcp__quay__task_list --label milestone:M-NN` (or CLI equivalent) — pasted
      invocation + JSON output against a real fixture milestone with ≥2 grouped
      tasks.
- [ ] Proposal write-back implemented per §12.2: `## Proposal (quay-task-to-plan)`
      body section written via `task_write`/`task edit --body`, round-trip
      verified via `task_get` — pasted before/after body diff for one real task,
      on native.
- [ ] Same proposal write-back round-trip verified on GitHub — pasted before/after
      issue-body diff for one real `gh-*` task, proving body-first portability
      (§12.2/§16) actually holds, not just claimed.
- [ ] N-independent-proposal + adjudication step implemented per §13.1 with
      N=2 default — pasted transcript/log showing two independent subagent
      proposal outputs for one real task plus the adjudication step's
      convergence-or-escalation determination.
- [ ] A real divergence case exercised at least once (either from real
      dispatch or a constructed fixture) showing the adjudication step's
      explicit-escalation path (§13.1 step 3) fires correctly (writes the
      `Adjudication: ... escalated to human` body line, does NOT silently
      pick a side) — pasted body excerpt.
- [ ] Architect-review stage confirmed to still run, unchanged, downstream of
      adjudication (§13.2) — pasted transcript/log showing both stages firing
      in sequence for one real task.
- [ ] Plan author + grounded-convergent-check loop implemented per §14 —
      pasted round-by-round log showing `Δ_round` counts per round and the
      terminal STOP reason (converged, or cap-reached escalation) for one real
      milestone-level plan.
- [ ] Per-stage TDD ≥80% gate enforced per §15 — pasted coverage-tool output
      for at least one executable-code stage showing the numeric percentage
      checked against the 80% threshold, AND at least one prose/template stage
      showing the mechanical-check evidence path (§15.1's caveat) used instead
      — proving the code-vs-prose classifier (§15.1) is real, not aspirational.
- [ ] A stage deliberately under 80% coverage is shown to BLOCK progression to
      the next stage (negative-path test of the hard-gate claim in §15.2) —
      pasted failure output, then pasted output after the gap is closed showing
      the stage now proceeds.
- [ ] Provider-agnostic degradation (§16) verified: a deliberate attempt to
      write `extra` on a GitHub-backed task via this skill's own code path
      surfaces the exact PR-ABI-001 hard-error message and leaves the target
      task otherwise unmodified — pasted error output + before/after task
      snapshot, same evidential shape as M14 §5.2's GitHub `--extra` probe.
- [ ] Milestone→task grouping via `milestone:M-NN` label (§12.3) and
      `parent`/`children` epic-decomposition (orthogonal axis, same section)
      both demonstrated on a real fixture, both providers — pasted `task_list`
      output per provider.
- [ ] The skill is dispatched at least once end-to-end (proposal → adjudication
      → architect-review → plan → plan-check-to-convergence → single
      implementation with per-stage TDD gates → ABSORB) on the **bootstrap
      milestone** identified in §11's "Bootstrap resolution" — since
      `quay-task-to-plan` cannot dogfood itself for its own first build, this
      clause applies to the FIRST milestone that runs through the new skill
      once built (per §11, the second dev-class milestone onward, after the
      skill's own build runs through `proposal-to-plan`) — pasted end-to-end
      log/transcript reference.
- [ ] `git diff --stat` against the implementing milestone's own pre-charter
      base commit shows only the expected files touched (new skill directory,
      any conformance-test additions, no unrelated product code) — same
      evidence-gate discipline M13/M14's own closing Done-when clauses used.
- [ ] Full existing test suite still passes post-change (pasted raw output) —
      same closing gate M05/M13/M14's own Done-when clauses used.

---

## 18. Non-goals (charter in-scope item 8 / Done-when clause 8)

Restated explicitly at M17-maturation fidelity (these were named in the original
draft §10 and DIR-012's own "Non-goals" list; this section makes each one a
standalone, unambiguous statement rather than leaving it folded into other
prose):

- **No Web UI process rendering.** Stage-by-stage implementation progress
  (phase/stage status, plan-check round count, TDD gate pass/fail per stage) is
  **never** rendered in the Web UI. Per §3's four-entity model, the Web UI/task
  board surfaces *value* (task/milestone done-or-not) only; the plan tracks
  *process* and stays out of the board entirely. This is a deliberate narrowing
  of DIR-009's self-hosting goal to "self-host the value structure, not the
  process," not an oversight to fix later.
- **No fork or deletion of `proposal-to-plan`.** `quay-task-to-plan` is
  **additive** — a new, separate skill. `proposal-to-plan` is not modified,
  forked, or retired; it remains available unchanged for free-markdown
  (non-quay-task) workflows, and (per §11's bootstrap resolution) is itself
  relied upon as the plan-discipline substrate for `quay-task-to-plan`'s own
  first implementation milestone.
- **No `extra{}` storage on GitHub tasks.** The GitHub Provider's hard-error
  floor on `extra` (M09 PR-ABI-001) is unchanged and unextended by this skill
  (§16). This design does not propose, and a future implementing milestone must
  not add, any GitHub-side `extra`-equivalent mechanism (e.g. a hidden
  HTML-comment or side-channel gist) — that would violate the body-first
  portable-metadata rule (§12.2/DIR-011) by creating a second, GitHub-only
  metadata channel outside the body, exactly the anti-pattern M14 §4's own
  non-goals list already rejected for the Core CLI relaxation this skill builds
  on.
- **No new Provider ABI tool or capability.** Confirmed again at §12.1/§16: the
  skill is a caller of the existing `task_list`/`task_get`/`task_write`/
  `task_check` surface, at the existing hard-error floor. It does not request or
  require any ABI growth to function.
- **No milestone-model changes to `inherited-core.md`/`OUTER-LOOP.md` in this
  design or this milestone** (DIR-012 item 2 — explicitly deferred to a
  following milestone once this design lands and is reviewed; see this
  milestone's own charter "Explicitly OUT of scope" section).
- **No implementation or dogfooding in this design or this milestone**
  (DIR-012 item 3 — no code, no `.claude/skills/quay-task-to-plan/` file, no
  live dispatch of the pipeline described above; design-doc-only, exactly like
  M13/M14).
