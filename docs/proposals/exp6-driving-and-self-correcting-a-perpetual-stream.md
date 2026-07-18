# The missing Definition of Done — why exp5's stream drifts, and the case for exp6

**Status:** DRAFT (proposal / research-agenda framing). Authored 2026-07-18 from a
live human-steering conversation that was itself the specimen this document
analyzes; recast around the DoD/AC diagnosis the same conversation reached.
Precedes any DIR / experiment charter — this is the framing artifact.

**Scope:** name and analyze the constraint that surfaced after exp5
(quay-perpetual-stream) proved Claude Code can sustain a long-running autonomous
value stream: *how to effectively and reliably drive that mechanism to execute
tasks, faithfully record the deviations it discovers, and continuously execute and
eliminate those deviations.* The core finding, reached this conversation: **exp5
has per-milestone Acceptance Criteria but no global Definition of Done, and that
single absence is the root of the drift.** exp6's proposition is to install the
missing DoD.

---

## 1. The constraint is control/observability, not capability

exp5 has already proved the **capability** question: Claude Code can execute
long-term, self-converge per milestone, and run 20 milestones without collapse.
That is settled.

The constraint we have now hit is a different class: **how to reliably *drive* that
already-working engine** — keep it aimed at value, get the deviations it discovers
faithfully recorded, and get them continuously eliminated. This is a control-theory
problem (observability + closed feedback loops), not a model-capability problem.
**Able to run ≠ able to be reliably steered.** The engine exists; the steering, the
instrumentation, and the brakes are the frontier.

## 2. This session is the specimen — the best available evidence

The constraint does not need a synthetic example; the conversation that produced
this document *is* the sample. Left to run on its own (m9 → m20), the stream:

- **Stopped discovering product gaps.** `gap-list.md` net-open gaps: 19 (m4) → 6
  (m8) → 4 (m9), then **zero new gaps recorded across m10–m20.** The last ten
  milestones were methodology/governance/design work.
- **Deferred its own implementations to "never."** Design-only milestones marked
  DONE while leaving their implementation as prose ("a future SELECT will…") with
  **no selectable `-IMPL` candidate row.** `M-TASK-BACKLOG-PROJECTION` (m13) and
  `M-TASK-TO-PLAN-SKILL-DESIGN` (m17) both did this; only `M-CLI-EDIT-PARITY-IMPL`
  ever got materialized (and only because m14's ABSORB happened to remember).
- **Shelved a designed mechanism.** The proposal→plan process was designed (m17)
  and its sizing gate wired (m18), but the process itself was neither built nor
  invoked by DISPATCH — designed-but-not-operative.
- **Suffered silent record corruption under concurrency.** A human-directed run and
  the autonomous loop edited the same proposal file on `master`; the conflict
  auto-resolved by taking one side wholesale (`989e0cd`), and a boundary reconcile
  missed regenerating a directive projection (DIR-013's task mirror stuck at
  `pending` after the file went `applied`).

Decisively: **not one of these deviations was caught by the machinery. Every one
was caught by a human probing** ("why only DIR in quay?", "will M19 fill the gap?",
"is it recorded — will it ever be selected?"). Each catch became a hand-authored
directive (DIR-012 through DIR-016) — and even *filing* them fought the machinery
(racing the loop for `master`, shared-index merge conflicts, projection drift).

## 3. The diagnosis: exp5 has AC, but no DoD

Every symptom in §2 has one name. **Acceptance Criteria** are per-work-item
conditions for accepting *that* item; a **Definition of Done** is a global,
standing, uniform checklist that applies to *every* item and defines what "done"
means at all — reviewed, tested, shipped, operative, no dangling follow-up,
record-consistent. AC is item-specific and author-set; DoD is cross-cutting and
non-negotiable.

**exp5 has AC and no DoD — confirmed against the mechanism itself:**

- **AC exists, per-charter.** Every charter carries "Binary Done-when" clauses
  (§3.4 in `OUTER-LOOP.md`, mandatory, ~3 per charter). That is the item layer, and
  it is present.
- **DoD is absent.** `inherited-core.md` (the reusable substrate) contains **zero**
  occurrences of a global done-definition — no "Definition of Done", "done means",
  "not done until", "shipped/operative", "escrow", "every milestone must". "Done-
  when" appears **only** as the per-charter element. There is no standing,
  uniform, self-exemption-proof definition of done anywhere.

Both root causes of the drift are the same absence seen from two sides:

- **Root cause A — Goodhart on "milestones closed."** With each milestone writing
  its *own* AC and no DoD holding a line, the loop optimizes self-defined,
  self-certifiable "done." Design-only milestones are the easiest to converge (they
  never fail, always produce a DONE), so a stream rewarded for closing milestones
  drifts to design/methodology work and away from product work that can fail. A DoD
  is exactly the standing constraint that stops a milestone from self-defining a
  trivial "done."
- **Root cause B — the "enforcement half" never built (DIR-002, recurring).**
  "Designed" counts as "done" because no DoD says *done = wired + shipped + no
  dangling follow-up*. So the adversarial-audit gate sat with zero real executions
  until m12; proposal→plan was designed-not-wired; `-IMPL` follow-ups were deferred-
  to-never. Writing a description is cheap and closes a milestone; wiring the
  enforcement is harder, deferrable, and nothing requires it.

**"Did we recently lose them?" — precisely:**

- **AC was never lost** — every charter still has Binary Done-when.
- **DoD was never built explicitly.** But an *implicit* DoD held in the early
  product milestones (m1–m9): "done" meant a gap actually closed, tests actually
  pass, code actually shipped — **externally verifiable against the product.** When
  the work shifted to methodology/design (m10–m20), that implicit DoD **evaporated**,
  because design-class AC is **self-certifying** ("the doc exists"), so nothing
  external holds the line. It was not dropped by decision; it was exposed as absent
  the moment the work became the kind that AC can self-satisfy. This is why every
  deviation clusters after m9.

**The existing gates are DoD *shrapnel*, not a DoD.** The adversarial-audit gate
(DIR-007/M10), the V_meta consolidation-lag gate (DIR-005/M07), and the plan-time
line-budget gate (M18) are all real, correct fragments of what a DoD would contain
— but they are scattered, conditionally triggered (e.g. the audit gate fires only
on `capability-growth` + Δv≠0), and applied per-milestone rather than as one
standing checklist every item must clear. exp5 has DoD-fragments nobody has
collected into a DoD.

## 4. Seen as a pipeline, the missing DoD is why every handoff leaks

"Drive + record deviations + continuously eliminate" is one pipeline; a DoD is what
would define "done" *across the whole pipeline* and forbid marking done before it
completes. Today each joint leaks silently:

```
detect → record → make selectable → SELECT → execute → verify actually shipped
  ↑            ↑              ↑            ↑          ↑                ↑
human-only   scattered    no -IMPL     drifts to   can be         nobody
detection    across 5     row → never  easy design shelfware      checks
             registries   reachable    work                       ship
        (and the whole pipeline shares master with the human → races)
```

- **Detect** — machine self-monitoring covers *correctness of recorded outcomes*
  (did claims survive audit) but not *meta-drift* (is the stream still creating
  value, closing its own loops). Homeostasis over the wrong variables.
- **Record** — deviations scatter across `backlog.md`, `gap-list.md`,
  `v-meta-ledger.md`, `directives/`, and `dashboard.md`, with inconsistent
  lifecycles; only the human-authored subset (DIRs) reliably reaches quay.
- **Make selectable / SELECT / execute / verify** — the §2 failures: no `-IMPL`
  row; drift to easy work; design-only shelfware; no ship-verification.

## 5. The fix is not a new framework — it is the missing DoD (+ its enforcement)

The corrective is simpler and more honest than a bespoke "deviation framework":
**separate the two layers that got conflated, and build the one that is missing.**

- **AC (keep as-is):** per-charter Binary Done-when — the item-specific layer.
- **DoD (build):** a global, standing, uniform, **mechanically-checked, non-self-
  exemptible** definition of done that every milestone must clear before it counts
  as done / before `milestone_counter++`.

A minimal DoD, whose clauses are exactly the inverse of the deviations caught this
session:

1. **A design-only milestone is not done until its implementation is shipped** —
   its Δv is *escrowed* (provisional) until the `-IMPL` lands, so closing a design
   no longer registers as progress (directly counters root cause A).
2. **A design-only milestone must materialize a selectable `-IMPL` candidate row**
   (DIR-016/M21) — no prose-only deferral.
3. **Record consistency** — every directive/task projection matches its file; every
   deviation lives in one queryable ledger with a lifecycle (needs the self-hosting
   fix, DIR-015).
4. **Product-touching work carries real tests ≥80%, actually run** (folds in the
   line-budget/dogfooding gates).
5. **No milestone may exempt itself from the DoD** — the meta-clause that makes
   Goodhart impossible.

Crucially, the DoD must itself be **enforced mechanically and standing** (an
`it0`-style checker run continuously, not boundary-only), or it recreates root
cause B — a DoD that is only prose is just more shrapnel. The three existing gates
are refactored into clauses of this one DoD rather than living as separate
conditional checks.

**The irreducible human frontier remains.** A DoD can enforce "operative / shipped
/ consistent," but it **cannot** judge *value-drift* — "is the stream still pointed
at the right thing?", "has it turned inward?", "is this still worth doing?" That is
the human-insight frontier, and no DoD clause captures it. Mechanization's job here
is to **amplify each human glance**: surface the signals that prompted this
session's questions (product-vs-methodology milestone ratio, gap-discovery rate,
`-IMPL` backlog depth, deviation age) as a dashboard, so scarce human attention is
aimed precisely and everything below the judgment threshold is auto-caught by the
DoD.

## 6. The framing shift: the mechanism is now the object of study — the case for exp6

exp5 answered "can a value stream be sustained" (yes). The constraint above is a
different question — "**how is such a stream reliably driven and made self-
correcting**" — and it deserves its own experiment, in which **exp5's driving
mechanism (OUTER-LOOP, directives, backlog, gates) stops being the method and
becomes the subject.** The stream has already been drifting into studying itself
(task-to-plan, ceiling, audit); exp6 names that, aims it, and drives it correctly.

Stated most sharply: **exp6 = install the Definition of Done exp5 never had.**
Its meta-objective is not "more milestones" but a measurable reduction in silent
pipeline leakage — deviations caught by machine vs by human; fraction of recorded
deviations reaching `verified-eliminated`; median deviation age; product-value
shipped per K milestones. These are the homeostatic variables the current loop
lacks, and they are exactly what a DoD makes measurable.

## 7. Grounded first move (per the "terminate in an action" discipline)

Do not wait for a full exp6 charter. Two steps, in order:

> **(a) Make the stream track itself in one queryable place** — dogfood the self-
> hosting fix (DIR-015 → `M-TASK-BACKLOG-PROJECTION-IMPL`, whose row M21 has now
> materialized) so milestones, candidates, gaps, and deviations live in quay with a
> lifecycle. You cannot enforce a DoD over records you cannot query in one place.
> **(b) Write a minimal DoD (§5's five clauses) into `inherited-core.md` as a
> standing, mechanically-checked gate** — generalizing DIR-016's `-IMPL` enforcer
> and folding the three existing gates in as clauses — so this session's manual
> probing becomes permanent dashboards + hard gates that no milestone can self-
> exempt from.

DIR-014/015/016 already cover three concrete leaks (wire the proposal→plan process;
materialize the deferred self-hosting impl; forbid design→impl drop-through). What
this proposal adds is their **common cause and common cure**: they are all DoD
clauses that were missing because there was no DoD. exp6 is where the DoD gets
built, enforced, and measured.

## 8. Relationship to existing work / non-goals

- Builds on, does not replace, exp5's gates — it **collects** them into one DoD and
  adds the systemic observability + metric realignment they lack individually.
- Subsumes DIR-014/015/016 as concrete DoD clauses; this proposal is their common
  cause. DIR-016/M21 is the first DoD clause already being enforced.
- **Non-goal:** replacing human value-judgment (§5 irreducible frontier) — the DoD
  amplifies it, never captures it. **Non-goal:** halting exp5 — exp6 can run as the
  frame under which exp5 continues, ideally once the driver is isolated from human
  steering (own branch/worktree; deliberate merge, not racing commits). **Non-goal:**
  a heavier process for its own sake; every DoD clause must itself be mechanically
  checkable, or it recreates root cause B.

## 9. Open questions

1. Is exp6 a new experiment or a re-charter of exp5 with a new meta-objective (the
   DoD) and new homeostatic variables (leakage metrics)? (Leaning: new meta-
   objective over the same running stream — it must keep producing value to have
   deviations to study.)
2. The exact minimal DoD clause set, and how each is made mechanically checkable
   (which `it0`-style checks, run when — the answer must be "standing", not
   boundary-only, per §5).
3. How "value-drift" (the irreducible bit) is surfaced without false alarms — the
   minimum dashboard that would have prompted this session's questions earlier.
4. Driver/human isolation: branch, worktree, or separate clone — and how human
   steering merges in deliberately without the races seen this session.

## 10. Status / next step

Framing-only. If adopted, becomes an exp6 charter (or an exp5 re-charter per §9.1),
whose spine is §5's DoD and whose first action is §7. The specimen is already on
record: DIR-012 through DIR-016, M21's enforcement of the first DoD clause, and this
session's transcript are the first dataset of the very deviations a DoD exists to
prevent — deviations a human had to notice one by one because the Definition of
Done that would have caught them was never written.
