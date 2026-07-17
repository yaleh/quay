# Quay Continuous Bootstrap — Fourth-Generation Bootstrap Experiment (proposal)

- **Status:** Proposal — authoritative for experiment 4, adopted at the point
  `experiments/quay-continuous-bootstrap/README.md` and `provenance.md` are
  created and iteration 0 is authorized. This document defines a **new,
  separate experiment**; it is not a protocol amendment to
  `quay-bootstrap-experiment.md`, `quay-core-bootstrap-experiment-v2.md`, or
  `quay-webui-bootstrap-experiment-v3.md`, and not a directive.
- **Date:** 2026-07-17
- **Owner:** Yale Huang
- **Relates:** [`quay-webui-bootstrap-experiment-v3.md`](./quay-webui-bootstrap-experiment-v3.md)
  (experiment 3's protocol — this document inherits its layout and
  methodology conventions rather than redefining them),
  [`quay-core-bootstrap-experiment-v2.md`](./quay-core-bootstrap-experiment-v2.md)
  (experiment 2's protocol), [`quay-bootstrap-experiment.md`](./quay-bootstrap-experiment.md)
  (experiment 1's protocol), [`quay-proposal.md`](./quay-proposal.md),
  [`quay-native-design.md`](./quay-native-design.md), [`glossary.md`](./glossary.md)
- **Origin:** an explicit strategic redirection asserted directly by the human
  in a live conversation (2026-07-17), captured as
  `experiments/quay-webui-bootstrap/directives/pending/DIR-007-close-experiment-3-hand-off-to-experiment-4-continuous-improvement.md`.
  Verbatim (translated from the human's own Chinese-language statement): *"I
  want to adjust the experiment's direction. No longer limited to this
  pre-determined, bounded objective — instead pursue continuous iterative
  optimization of the whole `quay` project, continuously use `quay` to drive
  its own development process, and continuously simulate a human user
  observing and using it, and continuously improve."* When asked to clarify
  scope and mechanism, the human chose explicitly: (1) close experiment 3 and
  open a new experiment 4, rather than amend experiment 3 in place or abandon
  the BAIME structure project-wide; (2) keep quantitative `V_instance`/`V_meta`
  tracking, but make it **open-ended** — no fixed ceiling, no fixed "Done
  when" checklist frozen at design time.

> Frozen vocabulary applies (see `glossary.md`). BAIME terms (`V_instance`,
> `V_meta`, OCA, `A_n`, `M_n`, `O`) are used verbatim per the
> `methodology-bootstrapping` skill.

---

## 1. Summary

Experiments 1–3 each pursued a **fixed, bounded** instance objective chosen
deliberately to make `V_instance` completable within a foreseeable number of
iterations: experiment 1 bootstrapped quay-native's own self-hosting loop,
experiment 2 built Core CLI/MCP/Web-UI symmetry and verification
infrastructure, experiment 3 built Web UI read capability and visual/design
quality against a fixed capability checklist. All three succeeded at their
own bounded instance objective (experiment 1 reached a high but not-1.0
skeleton/symmetry/gate/skill-convergence product; experiments 2 and 3 both
reached `V_instance = 1.0` on their own four factors) while never reaching
full BAIME convergence (`V_meta ≥ 0.80`), because `V_meta`'s `effectiveness`
factor has been structurally frozen at 0.26 since experiment 1's iteration
23 — the ceiling this creates (`V_meta_ceiling = 0.26`) has been arithmetic
fact since experiment 2's iteration 4 and remains unchanged through
experiment 3's close.

Experiment 4 **does not attempt to fix that ceiling** — it is not this
experiment's problem to solve, and manufacturing a fake trigger for
`effectiveness` would be a G2 violation. Instead, experiment 4 changes what
kind of experiment this is: rather than a bounded instance objective with a
finish line, it is an **open-ended continuous-improvement loop** over the
whole `quay` project (CLI, Core/MCP client, Web UI, packaging/distribution,
documentation — everything that is genuinely `quay` itself, not the BAIME
experiment-tracking machinery around it), structurally organized around two
new standing mechanisms the human specifically required:

1. **Self-hosted task tracking** — the experiment's own backlog is tracked
   using `quay`'s own MCP task tools (`task_write`, `task_list`, `task_get`,
   `task_check`), not an ad hoc markdown TODO list maintained outside quay's
   tooling. This is literal dogfooding, continuing and generalizing
   experiment 1's `M(Q) = Q` self-hosting identity to project-wide scope
   (not just Skill authorship, but day-to-day task backlog management).
2. **Continuous simulated-user usage** — a standing, recurring practice
   (not a one-time or narrowly-scoped mechanism) in which an independent
   subagent uses quay's interfaces (Web UI, CLI, MCP tools) the way a real
   user would, holistically, across all surfaces, and reports friction,
   confusion, bugs, and missing affordances that feed directly into the next
   iteration's priority-setting. This generalizes experiment 3's
   §4.2/§0c independent holistic visual-review mechanism beyond
   visual/Web-UI-only review to general usability across every surface.

`V_instance` and `V_meta` are both retained as real, computed numbers every
iteration (per the human's explicit instruction to keep quantification) —
but `V_instance`'s shape changes fundamentally, from "product of four
factors each with a frozen finish line" to "a small set of durable quality
dimensions, rescored each iteration against the current best-known gap
list, with trend (`ΔV`) as the primary signal and a monotonically-growing
cumulative gaps-closed counter as a secondary, non-comparable-mixing
signal." See §4 for the full design and the tradeoffs this accepts.
`V_meta` is **not** redesigned — its four-factor product shape
(`completeness × effectiveness × reusability × validation`) continues
unchanged in form, inheriting its value from experiment 3's stopping point
(§2).

---

## 2. Relationship to experiments 1–3 (the inheritance boundary)

Experiment 4 inherits methodology from all three prior experiments the same
way experiment 3 inherited from experiments 1 and 2: extraction artifacts,
Skill files, gate mechanics, directive lifecycle, G3 audit discipline — not
σ, not `V_instance`, and `V_meta` only as a continuing baseline, never reset
to zero.

**Provisional V_meta inheritance value — flagged, not final.** At the time
this document is written, experiment 3 has not yet produced a formal
closing report (`experiments/quay-webui-bootstrap/CLOSING-REPORT.md`);
`DIR-007` requests one but it had not been filed as of this document. The
latest recorded values are from `experiments/quay-webui-bootstrap/iterations/iteration-4.md`
and `experiments/quay-webui-bootstrap/provenance.md`:

```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.778 = 0.123
```

(`σ_QW = 7/9 = 0.778`, floor reset to 0 per experiment 3's own iteration-0
design decision; `validation = σ_QW` directly.) **This document treats
0.123 as a provisional inheritance baseline only.** Iteration 0 of
experiment 4 MUST re-confirm the actual inherited value against experiment
3's real, final closing report once it exists (iteration 4 is not
necessarily experiment 3's final iteration — a directive resolution, a
closing-report-writing iteration, or further iterations could still change
the recorded state before the closing report is filed). If the closing
report records different final values, experiment 4 inherits **those**,
not this document's provisional number — treat a mismatch as an expected,
routine reconciliation step for iteration 0, not an error requiring
escalation.

`V_instance` does **not** carry forward as a number — experiment 3's four
bounded factors (`ui_read_capability`, `visual_design_quality`,
`verified_by_construction`, `backlog_health`) do not have the same shape as
experiment 4's open-ended dimensions (§4). What *does* carry forward is the
**system state** those factors measured: experiment 3's iteration-4 report
records all four factors at 1.0 (bounded scope fully satisfied) — this is
useful context for experiment 4's iteration-0 baseline survey (a
already-fairly-healthy starting system, not a from-scratch rebuild) but is
not itself experiment 4's starting `V_instance` number, which must be
freshly measured against experiment 4's own dimensions (§4).

**Backlog-health non-regression carries forward as a standing constraint**,
generalized: none of the V-factor snapshots recorded by experiments 1, 2,
or 3 at their own stopping points may regress silently during experiment 4
(see §4's `system_health` dimension, which subsumes and continues
experiment 3's `backlog_health` factor and experiment 2's
`native_backlog_health` factor).

---

## 3. Scope: the whole `quay` project, not a bounded sub-surface

Unlike experiments 2 and 3 (each deliberately bounded to a sub-surface —
Core symmetry/verification infrastructure; Web UI read/visual quality),
experiment 4's scope is **the whole `quay` project**: CLI
(`packages/quay/bin/quay.js`), Core/MCP client (`packages/quay/src/`), Web
UI (`serve.js`), packaging/distribution, documentation, and anything else
that is genuinely `quay` itself.

**Explicitly in scope, for the first time**: packaging/distribution work
(the DIR-004 idea — Node SEA or Bun compile, GitHub Actions release
automation), previously deferred as out-of-scope under experiment 3's
bounded Web-UI-only objective. `DIR-004` is carried forward into
experiment 4's own directive backlog (§8) rather than silently dropped.

**What remains out of scope**: the BAIME experiment-tracking machinery
itself (this document, `ITERATION-PROMPTS.md`, `provenance.md`, the
`.claude/skills/*-methodology/` artifacts) is the apparatus that studies and
drives `quay`'s development — it is not itself `quay`, and improving *it*
for its own sake is not an experiment-4 objective (though the meta-layer,
§6, does study and may evolve the *methodology*, as all four experiments
have).

**Write-surface boundary — reconsidered, not silently dropped.**
Experiment 3's write-surface boundary ("no task creation from the browser,
no field editing from the browser, no new write path beyond the existing
action-button trigger... Core stays dumb") was a deliberate scope
restriction specific to experiment 3's bounded objective, not a permanent
architectural constraint on `quay` itself — quay's own MCP `task_write`
tool already exists and is a legitimate write surface at the Core/MCP
layer (§5's self-hosted task-tracking mechanism relies on it directly).
Experiment 4 does not inherit experiment 3's Web-UI-specific write
boundary as a blanket rule; instead, any change that would add a **new**
write surface (Web UI or otherwise) is evaluated on its own merits against
the `capability_breadth`/`usability_quality` gap evidence (§4), the "Core
stays dumb" backend-agnosticism principle (`quay-proposal.md`, unchanged),
and ordinary G3/G5 discipline — not pre-authorized, but not pre-forbidden
either. State explicitly, per change, which of these applies.

---

## 4. Instance objective: open-ended `V_instance`

### 4.1 Why the fixed-product-of-bounded-factors shape doesn't fit

Experiments 1–3's `V_instance` formulas each multiply a small, fixed set of
factors, each with a design-time-frozen "Done when" clause. This works
precisely because the objective is bounded — the whole point was to define
completion in advance so the experiment has a finish line. Experiment 4's
whole premise is that there is **no** design-time-frozen finish line: the
set of gaps quay has is expected to keep growing (new capabilities get
built, new corners get exposed by the simulated-user mechanism, new
surfaces like packaging come into scope) as fast as or faster than gaps get
closed. A frozen checklist would either become obsolete within a few
iterations (understating real remaining work) or would have to be
perpetually amended by protocol change (defeating the purpose of being
open-ended).

### 4.2 The chosen shape: durable dimensions, rescored against the current gap list

`V_instance` is the product of four **durable quality dimensions** — not a
fixed checklist, but stable *categories* under which specific gaps are
filed, closed, and re-measured every iteration:

```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
```

- **`capability_breadth`**: how much of the surface area a reasonable user
  of `quay` (CLI, Web UI, or MCP client) would expect to find functional
  and complete is actually present. Includes both experiment 3's inherited
  read-capability surface and any newly-identified capability gap
  (packaging/distribution reachability, CLI subcommand completeness, MCP
  tool coverage, etc.) — this dimension **absorbs and continues**
  experiment 3's `ui_read_capability`, generalized to all of quay, not just
  the Web UI.
- **`usability_quality`**: how good the experience actually is when using
  what exists — visual/design quality (continuing experiment 3's
  `visual_design_quality`), but also CLI ergonomics, error-message clarity,
  MCP tool-description quality, documentation findability, and anything
  else the simulated-user mechanism (§5.2) or direct observation surfaces
  as friction. Mechanical checks (Lighthouse, where applicable) remain
  necessary-but-not-sufficient exactly as experiment 3 established;
  holistic simulated-user judgment is the other mandatory half.
- **`verification_coverage`**: what fraction of currently-existing,
  currently-claimed-working capability has a committed automated test
  (unit, integration, or browser-automation, as appropriate to the
  surface) confirming it — continues experiment 3's
  `verified_by_construction`, generalized beyond browser-automation-only
  to cover CLI and MCP-tool-level tests as well.
- **`system_health`**: binary-style regression guard — no inherited
  V-factor snapshot from experiments 1, 2, or 3 has regressed, AND no
  newly-discovered severity-significant bug (per §5.2's simulated-user
  findings) remains open past the iteration it was found in without an
  explicit, recorded triage decision. Continues and generalizes
  experiment 3's `backlog_health`.

Each dimension is scored 0.0–1.0 **every iteration**, against **the current
best-known gap list for that dimension** — not against a fixed checklist
frozen at design time. The gap list itself is a first-class, versioned
artifact (§4.4): it grows when the simulated-user mechanism or direct
observation finds a new gap, and shrinks when a gap is closed and verified.

### 4.3 The hard problem: keeping the score meaningful when the denominator moves

If "the current best-known gap list" is the denominator, and that list
itself changes size and composition every iteration, then a rise or fall in
the raw dimension score does not mean the same thing from iteration to
iteration — improving from 0.6 to 0.7 could mean real progress, or it could
mean five new gaps were discovered that make the *previous* 0.6
retroactively look like it was really 0.3 all along. Experiment 4's
concrete, defensible answer, accepting an explicit tradeoff:

1. **Each dimension is scored against the gap list as it stood at the
   START of the current iteration** (the gap list "as of this iteration"),
   not retroactively adjusted for gaps discovered mid-iteration. A gap
   discovered mid-iteration is added to the list for the *next*
   iteration's scoring, and is recorded in that iteration's report as
   "found this iteration, will be reflected starting next iteration" —
   this keeps each single iteration's score internally consistent
   (computed against one fixed snapshot of the gap list), even though the
   snapshot itself moves between iterations.
2. **`ΔV` (the iteration-over-iteration delta in each dimension score, and
   in the product) is the PRIMARY trend signal**, not the raw level. A
   raw-level number (e.g. `capability_breadth = 0.55`) is reported for
   transparency but is explicitly NOT comparable in an absolute sense
   across iterations where the gap list changed size — only `ΔV` computed
   consistently (same gap-list snapshot before/after a specific increment
   of work) carries that comparative weight. Convergence/pause reasoning
   (§4.5) is built on `ΔV` trend, not on raw level crossing a fixed
   threshold.
3. **A separate, monotonically-growing "cumulative gaps closed" counter is
   logged alongside the dimension scores**, per dimension and in total.
   This number only ever increases (a gap, once closed and verified, stays
   closed in the count even if the gap list's total size changes later)
   and gives a comparable, denominator-independent measure of total
   delivered improvement over the experiment's life — complementary to
   `ΔV`, not a replacement for it.
4. **The gap list itself is versioned and logged** (§4.4) so that any
   apparent score discontinuity (e.g. a dimension score dropping because
   five new gaps were discovered) is traceable to a specific, dated,
   evidenced addition — never a silent, unexplained drop.

**The tradeoff being accepted, stated explicitly**: this design gives up
strict cross-iteration comparability of the *raw* dimension scores (an
honest, unavoidable consequence of an open-ended denominator) in exchange
for (a) a real, computed number every iteration that is internally
consistent within that iteration, (b) a trend signal (`ΔV`) that remains
meaningful throughout, and (c) a cumulative counter that is strictly
comparable and only grows. This is a genuinely different contract than
experiments 1–3's `V_instance`, which promised "this number approaches 1.0
as the fixed checklist is completed" — experiment 4's `V_instance` instead
promises "this number reflects genuine improvement pressure and a
representative snapshot of remaining known gaps, honestly re-based every
iteration, with `ΔV` as the number that means the same thing every time."

### 4.4 The gap list — a first-class, versioned artifact

`experiments/quay-continuous-bootstrap/gap-list.md` (or an equivalent
Provider-backed representation once the self-hosted task-tracking
mechanism, §5.1, is in place — see the open design question in §9)
maintains, per dimension:

- **Open gaps**: id, dimension, one-line description, severity (see below),
  source (direct observation | simulated-user finding | directive), date
  added, date last re-confirmed still open.
- **Closed gaps**: same fields plus date closed, iteration that closed it,
  evidence pointer (test, PR, iteration report section).

**Severity** (borrowed loosely from a standard bug-triage vocabulary, not
invented fresh): `blocking` (breaks a core workflow), `significant`
(meaningfully degrades the experience but has a workaround), `minor`
(cosmetic or edge-case). Severity matters for §4.5's pause criterion (a
"no new gap of significant severity" bar, not "no new gap of any kind" —
minor cosmetic nitpicks should not by themselves prevent a pause
recommendation).

The gap list is read at the start of every iteration (§0 preconditions,
`ITERATION-PROMPTS.md`) and updated at the end. It is the operative
"denominator" §4.3 describes — every dimension score cites specific gap-list
entries as its evidence, not a vague impression.

### 4.5 What "halt," "pause," and "converge" mean for an open-ended experiment

Experiments 1–3 used CONVERGED (all criteria met, a genuine terminal state)
and HALT/practical-convergence-accepted (stopped deliberately without
meeting all criteria, typically because of the `effectiveness` ceiling) as
their two possible stopping vocabularies. Neither fits an experiment
designed to have no fixed target: there is no checklist to complete, so
"CONVERGED" in the experiments-1–3 sense is not a coherent end state here.

Experiment 4 introduces a **third vocabulary word: PAUSE**, distinct from
both:

- **PAUSE** (the expected, normal, and only self-terminating state this
  experiment can reach on its own): triggered when **both** of the
  following hold simultaneously, for **2 or more consecutive iterations**:
  1. `ΔV_instance` (the product's iteration-over-iteration delta, per
     §4.3's `ΔV`-based comparison) is flat — below a small threshold
     (0.02, matching experiments 1–3's own diminishing-returns bar, for
     consistency) — AND
  2. The simulated-user mechanism (§5.2) finds **no new gap of `blocking`
     or `significant` severity** in that same iteration window (new
     `minor` gaps alone do not block a PAUSE recommendation).
  
  PAUSE is **not** CONVERGED and is **not** HALT-as-failure. It means: at
  the current level of scrutiny, diminishing returns have set in and no
  urgent new work has surfaced — this is a natural point for a human to
  review, redirect, or explicitly resume. **PAUSE is resumable by
  construction** — nothing about reaching it forecloses future iterations;
  it is a checkpoint, not a terminus. State this explicitly every time a
  PAUSE is recommended: "this is a pause the human can resume, not a
  terminal halt."
- **CONVERGED** is retained only for the `V_meta` half (§6) — `V_meta`'s
  formula and its own convergence bar (`≥ 0.80`, unchanged in form) still
  describes a genuine, non-open-ended target, because the meta-layer
  question ("does the inherited methodology generalize to open-ended,
  self-directed, continuously-scoped work?") **is** a bounded question even
  though the instance-layer work it studies is not. If `V_meta` alone
  reaches its threshold while `V_instance` is still open (which it always
  will be, by design), record that explicitly as "meta-layer convergence
  reached; instance-layer work continues" — a new, asymmetric state this
  experiment introduces because its two layers no longer share a single
  finish line the way experiments 1–3's did.
- **HALT** (human-directed stop, for any reason, at any time) remains
  available exactly as in experiments 1–3 — a human can always stop the
  experiment regardless of where `V_instance`/`V_meta` stand — but is
  explicitly distinguished from PAUSE: HALT is imposed from outside
  (directive, explicit human decision); PAUSE is a self-assessed,
  self-reported diminishing-returns signal the iteration loop itself
  proposes, which the human may accept (staying paused), override (resume
  immediately with a new priority), or convert into a HALT (stop for good,
  e.g. to redirect the project entirely).

**No fixed numeric ceiling on `V_instance` is defined by this document.**
Because the dimensions are rescored against a moving gap list, "1.0"
carries a specific, narrow meaning at any given iteration (all
*currently-known* gaps in that dimension closed) but explicitly does NOT
mean "the dimension can never move again" — a later iteration's simulated-
user pass can always surface a new gap and pull a dimension back down from
1.0. This is intended and correct, not a scoring bug: it is the direct
consequence of choosing an honest, non-frozen denominator.

---

## 5. The two standing continuous mechanisms

### 5.1 Self-hosted task tracking (quay drives its own development)

From iteration 0 onward, experiment 4's own backlog of development tasks
**must** be tracked using quay's own MCP task tools —
`mcp__quay__task_write`, `mcp__quay__task_list`, `mcp__quay__task_get`,
`mcp__quay__task_check` — which proxy the native Provider, backed by
`tasks/*.md` files in this repository (the same `tasks/` directory
experiments 1–3 already populate with `QN-*`/`QC-*`/`QW-*` files, via the
native Provider's file-based backend). This is **not** a new backend or a
simulated dogfood environment — it is quay's own real, already-existing
Provider ABI, used to manage the very tasks this experiment executes.

Concretely: `QX-*` tasks (§7) are created via `task_write`, listed via
`task_list`, inspected via `task_get`, and gated via `task_check` — not via
an ad hoc markdown TODO list maintained outside this tooling. The
`quay:author`/`quay:execute` Layer-2 Skills inherited from experiment 1
already drive this file-based backend; what's new here is that this
experiment additionally requires **using the MCP tool surface itself**
(not just the underlying file convention it happens to produce), so that
the maintainers doing the work experience the same MCP-tool interaction a
real quay user/agent would.

**Why this matters as a mechanism, not just a convention**: it means any
friction in quay's own task tools (a confusing error message from
`task_write`, an awkward `task_check` gate semantics edge case, a
`task_list` filter that doesn't do what's expected) is discovered
*organically*, during real use, by the people building quay — exactly the
kind of first-hand "does this feel good to use" signal the human's
redirection is asking for. Any such friction found this way is itself a
`usability_quality` gap (§4.2) and/or a candidate `effectiveness`/
`reusability` V_meta re-trigger (§6) — record it as both.

### 5.2 Continuous simulated-user usage

**Cadence**: every iteration, not merely periodically. This is a stronger
commitment than experiment 3's mechanism (visual review was dispatched
per-claimed-visual-change, not on a standing schedule) — because
experiment 4 has no fixed checklist to exhaust, the simulated-user pass is
the *primary* mechanism by which new gaps enter the gap list (§4.4) at
all, not merely a verification step for changes already planned. An
iteration that skips this dispatch has no organic source of new priorities
for the following iteration, other than direct human/orchestrator
observation — which is a legitimate secondary source but not a substitute
for the standing mechanism.

**Mechanism (mirrors G3/§0c's dispatch discipline exactly, generalized in
scope)**: dispatched by the orchestrator, using the native Agent/Task
tool, `run_in_background=true`, from a fresh context — never the same
session that did the iteration's development work, and never via manda
(§0b's absolute G3 exclusion extends unchanged to this mechanism).

**What the dispatched agent does**: uses quay's interfaces — Web UI (via
browser automation, desktop AND mobile viewport per the inherited DIR-003
requirement), CLI (`quay task list`, `quay task view`, etc.), and MCP
tools (`task_list`, `task_get`, `task_write`, `task_check`, `action_list`,
etc., as applicable) — the way a real first-time or returning user would.
This is explicitly a **holistic "does this feel good to use" pass across
ALL surfaces**, not a checklist-driven audit and not limited to visual/
Web-UI review the way experiment 3's mechanism was. The agent should:

1. Approach the system with a plausible real task in mind (e.g. "I'm a new
   contributor trying to find out what to work on next," "I'm triaging
   the backlog," "I want to trigger an action on a task") rather than
   probing features in isolation.
2. Try more than one surface where the task allows it (e.g. the same
   underlying goal via CLI and via Web UI) — asymmetries between surfaces
   are themselves a `capability_breadth` or `usability_quality` gap
   worth flagging.
3. Judge each surface **as a whole first** (the same discipline experiment
   3's §0c established for visual review, generalized: holistic
   impression before itemized detail) before recording specific friction
   points.
4. Render **PASS / CONCERNS / FAIL** per surface reviewed (not a single
   verdict for the whole system — a CLI PASS alongside a Web UI CONCERNS
   is a normal, expected, and useful outcome, not a contradiction to
   resolve), with concrete friction points, confusion, bugs, or missing
   affordances listed per surface, each tagged with a proposed severity
   (§4.4).
5. Write the verdict to
   `experiments/quay-continuous-bootstrap/audits/iteration-{N}-simulated-user-{surface}.md`.

**Findings feed directly into gap-list updates (§4.4) and into the next
iteration's priority-setting** — this is the concrete link between the
mechanism and `V_instance`'s dimension scoring: a CONCERNS/FAIL finding of
severity `blocking` or `significant` is added to the gap list for the
dimension(s) it affects (most often `usability_quality`, but a missing
affordance found this way can also be a `capability_breadth` gap), and
directly informs §4.5's pause-criterion check (no new significant-severity
gap is one of the two PAUSE conditions).

**Relationship to G3**: this mechanism is independent of, and does not
substitute for, the G3 out-of-band functional-correctness audit (§8,
inherited unchanged). A surface can be functionally correct (G3 PASS) and
still get a usability CONCERNS/FAIL verdict from the simulated-user pass,
or vice versa. Keep them as separate dispatches with separate report
sections, exactly as experiment 3's §0c required for the visual-review/G3
distinction.

---

## 6. Meta objective — `V_meta` unchanged in form, continued in value

`V_meta`'s formula and shape are **not** part of this redirection — the
human's request was to change the instance-layer objective's shape, not
the meta-layer's. `V_meta = completeness × effectiveness × reusability ×
validation`, exactly as experiments 1–3 define each factor, continues into
experiment 4 unchanged in form, inheriting its starting value from
experiment 3's stopping point (§2, provisional 0.123 pending experiment
3's actual closing report).

**What experiment 4 tests, at the meta layer**: does the inherited
methodology (Skill files, directive lifecycle, provenance/gate mechanics,
G3 audit discipline, the newly-generalized simulated-user mechanism)
transfer to **open-ended, self-directed, continuously-rescoped** work,
where there is no design-time-frozen instance objective to check progress
against? This is a different transfer question than any of experiments
1–3 asked (self-hosting identity; backend/API-shaped work; frontend/
visual/UX-shaped work) — experiment 4's domain shape is "the methodology
itself must now also decide what to work on next, not just how to execute
a known objective," which is a meaningfully different demand on
`completeness` (does the Skill set's Method cover *strategy formation
under an open-ended objective*, not just execution of a known one?) than
any prior experiment tested.

**The `effectiveness`-ceiling situation is inherited unchanged and is not
this experiment's problem to solve.** `V_meta_ceiling = 0.26` (if
`effectiveness` remains frozen) stays a standing fact, restated every
iteration per the inherited ceiling-diagnostic discipline
(`.claude/skills/quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md`).
The self-hosted task-tracking mechanism (§5.1) is, notably, a plausible
*organic* re-trigger candidate for `effectiveness` specifically — using
quay's own MCP tools to manage the experiment's own tasks is exactly the
kind of "genuinely different scenario" experiment 1's own hypothesis
predicted might surface a scope-matched marginal task, and unlike
experiments 2/3's own domains, this one puts the task-management tooling
itself directly in the loop of daily work rather than as a passive
substrate. This must be **observed**, not assumed — an iteration that
asserts re-triggering without timing evidence is a scoring error, the same
discipline all three prior experiments apply.

---

## 7. Task IDs

All new tasks in this experiment use the **`QX-*`** prefix.

**Rationale**: `QN-*` (experiment 1, quay-Native), `QC-*` (experiment 2,
quay-Core), `QW-*` (experiment 3, quay-Web) each encode the experiment's
sub-scope in the letter. Experiment 4 has no comparable single sub-scope
to encode — its scope is the whole project, pursued via a
conte**X**tual, open-ended, e**X**periment-4 process. `QX-*` reads
naturally as "quay, eXperiment 4 / eXpanded scope," keeps the two-letter
convention (`Q` + one distinguishing letter) all three prior experiments
share, and — checked directly — collides with no existing prefix in
`tasks/` (`QN-*`, `QC-*`, `QW-*` are the only three populated so far).
This keeps all four task populations physically distinguishable in
`tasks/`, per the standing convention.

---

## 8. Guardrails — G1–G6 carried forward unchanged, plus generalized new ones

All six guardrails (G1–G6) from experiments 1–3 carry over **unchanged**:

- **G1**: provenance is a fact, not an aspiration — σ_QX is computed, not
  asserted.
- **G2**: `V_meta` factors are measured on marginal increments and
  held-out targets only, never the accumulated artifact.
- **G3**: independent out-of-band audit (`adjudicate`) is mandatory for
  every Core-touching change and every V-factor lift — dispatched by the
  orchestrator via the native Agent/Task tool, **never** manda, **never**
  self-dispatched by the iteration-executor. Experiment 3's own iterations
  1, 3, and 4 each fell back to inline self-audit citing an "ENV gap" (no
  unconditional native Agent/Task tool found in the executing session's
  own deferred-tool list) — `DIR-002` and `DIR-005` both required
  **concrete evidence of the blocker** (not just an assertion) before any
  inline fallback is permitted, and required the fallback to be flagged
  explicitly as a deviation requiring separate review. Experiment 4
  restates this requirement at the same evidentiary bar: an iteration
  claiming the ENV gap must show the actual `ToolSearch` (or equivalent)
  negative result, not merely state that dispatch "wasn't available."
- **G4**: human fixpoint sign-off, where applicable — reinterpreted for
  this experiment's PAUSE vocabulary (§4.5): a PAUSE recommendation is the
  point at which human sign-off is most naturally sought, though (unlike
  a fixpoint) it does not require the human's agreement to be valid as a
  self-assessment; it requires the human's decision on what to do next.
- **G5**: walking-skeleton discipline. For the open-ended `V_instance`
  dimensions, "improving is the point" (§4.2) exactly as experiment 3
  established for its own read/visual dimensions — but silently folding
  an out-of-scope discovery into the current task, or silently expanding
  a dimension's definition beyond what the gap list actually evidences,
  is still forbidden.
- **G6**: manda daemon liveness + monitor-bound-to-session check before
  each iteration — read `.manda/hub.addr` for the live address at
  runtime, never a hardcoded port.

**Two guardrails generalized from experiment-3-specific directives to
standing experiment-4 requirements, from iteration 0 onward (not deferred
and re-earned):**

- **Desktop + mobile dual-viewport requirement** (originally DIR-003):
  any browser-based test, visual check, or simulated-user Web-UI pass must
  cover both a desktop and a mobile viewport, never desktop-only.
- **Git worktree isolation for iteration execution** (originally DIR-006,
  filed but not yet applied in experiment 3): each iteration's development
  and testing work executes in a dedicated git worktree, created fresh for
  that iteration, merged to `master` only after that iteration's own
  success criteria are confirmed inside the isolated worktree, and removed
  after a successful merge. If a genuine structural blocker prevents
  worktree creation, the iteration must show concrete evidence of the
  blocker (not merely assert unavailability) before falling back to direct
  execution in the shared tree, flagging that fallback explicitly as a
  deviation — the same evidentiary bar DIR-002/DIR-006 both set for any
  fallback claim.

**One new guardrail, specific to experiment 4:**

- **G7 (new) — standing web-service reachability**: quay's own Web UI
  (`quay serve`) is kept running and reachable on `0.0.0.0` (not
  localhost-only), continuously, as a live target the simulated-user
  mechanism (§5.2) can actually reach at any point without first having to
  start it — generalizing experiment 3's `DIR-001` precedent from a
  one-time fix into a standing, every-iteration-checked precondition
  (§0 of `ITERATION-PROMPTS.md`).

**Directives carried forward from experiment 3, not silently dropped**
(per `DIR-007` action 4): `DIR-004` (packaging/distribution, deferred in
experiment 3, now **explicitly in scope** per §3 above — re-filed into
experiment 4's own `directives/pending/` with a note citing its
experiment-3 origin) and `DIR-006` (worktree isolation, not yet applied in
experiment 3 — **adopted directly as a standing guardrail above**, rather
than re-filed as a still-open directive, since this document itself
resolves the "should we do this" question experiment 3 left open).

---

## 9. Open design questions — explicitly left unresolved by this document

This document deliberately does not resolve the following; they are
flagged for the orchestrating session or the human to decide, not silently
decided here:

1. **Where does the gap list (§4.4) actually live?** As a plain markdown
   file (`gap-list.md`) for simplicity and human-readability, or as a set
   of `QX-*` tasks themselves (via the self-hosted task-tracking mechanism,
   §5.1) with a `gap` label, using `task_list --label gap` as the query
   surface? The latter is more consistent with §5.1's own dogfooding
   spirit (using quay's own tools for quay's own backlog, including the
   gap list itself) but the former is simpler to stand up at iteration 0
   and avoids conflating "a task someone is actively executing" with "a
   known gap not yet turned into a task." Iteration 0 should make and
   record this choice explicitly, the same discipline experiment 3's
   iteration 0 applied to the σ-vs-inherited-floor decision.
2. **Exact numeric weighting within each dimension**, when a dimension's
   gap list spans very different kinds of gaps (e.g. `capability_breadth`
   covering both "a missing CLI flag" and "no packaging pipeline at all")
   — this document specifies the scoring *mechanism* (§4.3) but leaves the
   precise per-gap weighting scheme (equal weight per gap? severity-
   weighted? surface-weighted?) to be determined empirically at iteration
   0/1, once a real gap list exists to weight.
3. **Whether `system_health`'s "no inherited V-factor regression" check
   should itself now track a `QX-*`-scoped concept**, or continue citing
   experiments 1/2/3's original V-factor names directly (as experiment 3
   did for experiments 1 and 2's factors) — this document assumes the
   latter (continuity of citation) but does not mandate it if the
   orchestrating session finds a cleaner formulation.
4. **The precise cadence/scope of the 2-consecutive-iteration PAUSE
   check** (§4.5) once experiment 4 has run long enough to have real data
   — this document specifies the mechanism but the actual threshold values
   (0.02 for `ΔV`, "2 consecutive iterations") are carried over from
   experiments 1–3's diminishing-returns bar for consistency, not
   re-derived from experiment-4-specific evidence (none exists yet at
   design time). If early iterations show this threshold is poorly
   calibrated for the open-ended shape, that recalibration is itself
   exactly the kind of evidence-driven methodology evolution the
   inherited discipline expects — not something this document should
   pre-empt.
5. **Whether/how `QX-*` provenance interacts with the self-hosted
   task-tracking mechanism's own MCP-tool-driven writes** — i.e., does a
   `task_write` call made *through* the MCP tool (rather than a direct
   file edit) change how `{author_by, execute_by, gate_by}` provenance is
   recorded, given that the tool itself is now part of what's being
   dogfooded? This document assumes provenance mechanics are unchanged
   (native/seed distinction still tracks who/what actually did the
   authoring/executing/gating, independent of which interface was used to
   record it) but flags this as worth an explicit confirmation at
   iteration 0 rather than an unstated assumption.
