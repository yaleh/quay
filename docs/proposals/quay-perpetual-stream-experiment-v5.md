# quay-perpetual-stream — Experiment 5 Protocol (v5, DRAFT)

**Status:** DRAFT for human review. Name `quay-perpetual-stream` provisional.
**Supersedes:** experiment 4 (quay-continuous-bootstrap) via HALT + three-way carry (§5).
**Empirical basis:** `experiments/offline-replay/` (155-sample corpus, `harness.py`, `RESULTS.md`).

This protocol is different in kind from experiments 1–4. Those were **convergent** BAIME
experiments (drive V_meta→0.80, extract a skill, HALT). Experiment 5 is the first
**perpetual** experiment: a standing, non-terminating outer loop that governs open-ended
software value delivery, with convergent BAIME experiments nested inside it as milestones.

---

## §1 Purpose & the standing falsifiable hypothesis

**Meta goal (open-ended, homeostatic — NOT a threshold):** sustain healthy value growth on
quay indefinitely under a two-layer evaluation model, without the layer-collapse pathologies
experiment 4 exhibited (non-comparable V_instance level, invented PAUSE, orphaned directives,
an URGENT item aging 8 iterations).

**Standing hypothesis (continuously falsifiable, re-tested every checkpoint):**
> A perpetual OUTER layer that only *selects and designs* bounded milestones — delegating all
> convergent work to nested inner BAIME experiments — sustains value growth without layer collapse.

**Falsified at any checkpoint if:** milestones systematically fail to converge (bad outer design),
OR value growth stalls while opportunities remain (outer selection failure), OR the outer layer
starts doing inner work directly (layer collapse creeping back), OR the health dashboard fails to
flag a pathology the record later shows was present.

A perpetual experiment is an experiment because it is *continuously falsifiable*, not because it
terminates. HALT remains available as an external human decision at any checkpoint; it is the only
exit, and it is no longer the goal.

**Instance goal (what the milestones build):** quay's continued development across its surfaces
(CLI, MCP, Web UI, packaging/distribution, docs), with a standing bias toward capabilities that also
strengthen this method's OWN infrastructure. quay is both the product and the substrate of its own
methodology experiment (it is the task tracker the method dogfoods; directives-as-tasks,
provenance, the charter store all live in quay). So the milestone backlog carries two kinds —
**product-value milestones** and **methodology-infrastructure milestones** (e.g. DIR-006
directives-as-quay-tasks, the discovery-channel gates of §4.4) — and the outer explore/exploit
policy spans both. Improving quay improves the method's tooling and vice-versa; that self-referential
loop is part of VT growth, not a distraction from it.

---

## §2 Two-layer architecture

```
OUTER (perpetual, homeostatic) — value-growth stream
  state:  current product + accumulated value (VT) + milestone/opportunity backlog
  action: design & launch the NEXT inner milestone-experiment (produce a charter)
  evolves: milestone-selection/design competence (never frozen)
  health:  VT slope + methodology-maturation (ρ/φ) + charter-thickness + discovery-latency
  exit:    external HALT at a checkpoint (e.g. marginal value/milestone below threshold)
        │  spawns one at a time (serial by default; parallel only for provably independent surfaces)
        ▼
  INNER (convergent, BAIME-classic) — one milestone
     a full BAIME experiment: V_instance/σ, iterations, G3, terminates (§3.2).
     returns: converged artifact + realized-value delta + adaptation log (feeds outer ρ/φ)
```

Timescale separation: outer slow (milestone-level, weeks), inner fast (iteration-level, hours/days).
Three rates of change: **architecture frozen** (this protocol, tested by the hypothesis) ·
**outer methodology evolves** (rolling skill) · **milestones ephemeral** (convergent, generated then retired).

The single governing rule: **never point BAIME at the stream; always point it at a milestone.**
(Experiment 4's every pathology traces to violating this — it ran an inner convergent machine on a
perpetual object.)

---

## §3 Inner (episode) layer — milestone BAIME

### §3.1 Milestone charter (the outer→inner interface; three tiers)

The outer layer's action IS producing a charter. It replaces experiment 4's 74 KB per-iteration
read-set (~40–83 K tokens before any work) with three tiers (offline-replay Agent-C design):

- **Tier A — CHARTER (inlined, target < ~2 K tokens, authored per milestone/iteration):**
  - HARD GATES block **transcluded byte-for-byte** from the pinned standing template — never
    paraphrased. A CI/lint check asserts the charter's gate text is a literal substring / hash
    match of the pinned template. *(This is the DIR-009 defense — see §3.2 and §6.)*
  - the **in-scope gap subset only** (the specific gaps + every OPEN blocking gap verbatim) — not
    the full gap-list.
  - the milestone's **binary Done-when clauses** (§3.4) + dispatcher one-liner.
  - a **pinned pointer** (path + git SHA) to the immutable standing rules.
- **Tier B — PINNED IMMUTABLE RULES (referenced, read once at milestone it0):** Meta-Agent
  architecture, dispatch mechanics, inherited constraints. Re-read only if the SHA changes.
- **Tier C — READ-ON-DEMAND (grep, never full-load):** provenance CURRENT-STATE row only;
  gap-list in-scope subset only; older iteration logs by named grep; V_meta rubric only at EVALUATE.

### §3.2 Inner termination — five conditions (offline-calibrated)

Constants **K=2, BUDGET≈10** are calibrated against experiments 1–4 (low sensitivity; only
BUDGET=12 changes exp1's stop from it10→it15). STOP the inner experiment when **any** of:

1. **Done-when complete** — all binary clauses met (§3.4) and stable ≥1 iteration. *(exp2 it3, exp3 it4.)*
2. **Mechanical plateau** — ΔV<0.02 on **both layers** for **K=2** consecutive iterations AND no
   new significant/blocking gap. Purely counter-driven; resets on any ΔV≥0.02. No "is work
   exhausted?" judgment permitted. *(exp4 self-paused correctly at it19; exp1's subjective version
   never fired across ~63 flat iterations.)*
3. **Ceiling → redesign-OR-stop** — if a frozen factor makes V_meta≥threshold arithmetically
   impossible (compute the ceiling at it0), this **branches**: either accept the ceiling and stop,
   or redesign the metric (once, non-retroactively). It is NOT a blind STOP. *(exp1 wasted ~63
   iters grinding an unreachable 0.80; exp4's ceiling-flag at it6 correctly demanded the DIR-008
   redesign that came late at it14.)*
4. **Budget backstop** — past BUDGET≈10 iterations AND nothing climbing on either layer → default
   is HALT; *continuing requires explicit authorization* (evidence of live progress or an
   intervention like #3). Inverts experiment 1, where stopping needed the human.
5. **External HALT** — available every iteration, independent of self-assessment.

Offline result: this rule converge-stops exp1 at it10 (vs actual it88, **−78 wasted iterations**),
catches exp2/exp3 at their Done-when (it3/it4), and flags exp4's pre-redesign stall — precision
0.69 / recall 0.95, one FN. See `RESULTS.md` Part A.

### §3.3 Inner value

- **V_instance** (per-milestone software quality; convergent; rescored against the milestone's own
  gap subset) — only ΔV within the fixed milestone scope is meaningful; the level is **never** a
  product-completeness claim.
- **σ** (validation ledger, per task).
- **Adaptation log** — the raw record of where the inherited method didn't fit this domain (feeds
  outer ρ/φ). The inner layer does NOT compute a methodology-maturation score; that lives at the
  outer layer (§4.2), because "did this adaptation generalize" is only visible across the stream.

### §3.4 Binary Done-when is REQUIRED (empirical)

Offline finding: experiments **with** binary Done-when clauses (exp2, exp3 — 4 each) stopped clean
at it3/it4; experiments **without** (exp1, exp4) dragged/went open-ended. Therefore every milestone
charter MUST enumerate binary Done-when clauses sufficient to freeze one V_instance shape for the
whole milestone. If you'd need to change the inner V_instance mid-milestone, the milestone is too
large — split it (milestone right-sizing, calibrated to exp1–4 as reference units).

---

## §4 Outer (stream) layer — perpetual homeostasis

Evaluated by a **health dashboard**, never a scalar-with-threshold. Four tracks:

### §4.1 VT — Value Trajectory (renamed from any V_* to avoid collision)

Cumulative, **unbounded, non-convergent, NUMERICALLY QUANTIFIED** value (decision ④). Lives on a
manifold/atlas: **adjacent milestones share a local chart** (value units continuous & comparable);
long-range **drift is a chart transition** (CLI→multi-surface SaaS), logged as an explicit
re-baseline **with a numeric conversion factor** so adjacent-chart values stay comparable across the
seam (this normalizes experiment 4's awkward "non-comparability statement"). Per milestone the outer
layer commits, BEFORE launch, to a **numeric value hypothesis**: an estimated value delta `Δv̂`
on the current chart's scale + the metric `Y` that will measure it. At the checkpoint the realized
`Δv` is measured and appended to the VT curve; `|Δv − Δv̂| / Δv̂` is the outer calibration-error
signal (predict-then-measure = the outer's G3 analog). **Health = VT slope** (numeric marginal value
per milestone), not level. Exit signal = slope below a pre-declared threshold. The chosen value scale is
**weighted surface-capability points** — defined concretely in §6.2.

### §4.2 Methodology-maturation track — ρ, φ, consolidation

- **ρ (reuse rate):** fraction of a milestone executed with inherited methodology unchanged
  (charter Tier-B transclusion). Rising ρ→1 is SUCCESS, not stagnation. *(This is why absolute
  V_meta read "stagnation" — it measured construction, not reuse; the ceiling artifact froze it at
  0.26 across exp1–3 until DIR-008.)*
- **φ (fold-back), confirmed retroactively:** an adaptation counts as folded-back only when a
  LATER, different-domain milestone reuses it unchanged. *(Confirmed edges: exp3 §0c visual-review →
  exp4; exp2 dispatch/G3 discipline → exp3 → exp4; exp2 σ-floor-trap → exp3 → exp4.)*
- **Consolidation trigger:** when φ is confirmed, **merge** that adaptation from its delta-skill into
  the pinned core (Tier B), retiring the citation. This is the mechanism that drives reuse +
  continuous iteration, and it fixes the current weakness (delta pile-up: by exp4 a consumer must
  read 3 skills in order; no consolidated core; silent drift).

### §4.3 Charter-thickness track

As the pinned core grows (via consolidation) and milestones mature, the per-milestone charter should
get **thinner** and the inner **budget tighter**. Charter token-weight and inner iteration count are
outer health signals (a maturing methodology writes thinner charters).

### §4.4 Discovery engine — three-tier channel portfolio

Offline finding (49 discovery samples): the standing simulated-user mechanism is a **polish engine**
(6/7 polish, **0 structural**); all high-value directions came from human insight + observation of
the process itself. The outer discovery engine is therefore a portfolio:

1. **Exploit channel** — standing simulated-user (polish of the known surface). Keep; don't expect
   exploration-grade value from it.
2. **Systematic-explore channels** — institutionalize as **mandatory it0 diagnostics + continuous
   gates**. Offline-validated (4/5 checks; `RESULTS.md` Part B2):
   - **ceiling/floor arithmetic** at it0 (would have flagged exp1's unreachable V_meta at it23 vs
     the it88 drag; every experiment at it0).
   - **gate-hash / transclusion** check (caught 3/3 dilution events at first occurrence vs 13×
     recurrence — the DIR-009 defense).
   - **dogfooding evidence-gate** (prose "applied" without a real run → flag; caught DIR-004/DIR-006
     false-"applied", +19 iters).
   - **domain-misfit audit-channel** it0 check ("does the new domain's primary quality have an
     independent audit channel?" — would have pre-placed exp3 §0c).
   - *(cross-exp trap-carry was honestly refuted offline — traps were already carried; acting on
     them is the ceiling check's job. Retained as documentation, not a separate gate.)*
   These target **206 iterations of accumulated late-discovery latency**. Discovery-latency is a
   core outer health metric.
3. **Human-insight frontier** — irreducible (15 discoveries, incl. all 6 structural). Not
   mechanizable; institutionalized only by *invitation*: the human↔Claude design conversation IS
   the channel, formalized via `/quay-directive`. exp5 preserves and schedules this, does not
   pretend to automate it.

### §4.5 Milestone selection — explore/exploit policy

The outer layer's selection is an explicit explore/exploit policy: **exploit** = high-value,
high-ρ milestones the current method handles; **explore** = novel-domain milestones that stress the
method and grow the reusable core. The protocol requires a minimum explore cadence (else the core
ossifies and the stream eventually meets domains it cannot serve). *(This is the only outer
component NOT offline-validatable — no counterfactual milestone trajectories exist; it is the
irreducibly-live part of exp5.)*

### §4.6 Checkpoints, external HALT, ledger

- **Checkpoint every 5 milestones — NON-BLOCKING:** the loop writes a health snapshot across all four
  tracks and re-tests the standing hypothesis (§1), then **continues** — it does NOT wait for a human.
  The human reviews snapshots asynchronously. The loop self-halts only on an internal exit signal (VT
  slope below threshold with no explore chart, or the hypothesis falsified).
- **External HALT (async, human):** issued any time — a `.halt` sentinel or a directive — and takes
  effect at the next milestone boundary for a clean stop (or aborts the in-flight milestone if flagged
  urgent). It is the only *exit*; it is never a scheduled *wait*. The loop never blocks on the human;
  human input is async (§4.7).
- **Ledger:** exp5 enters the BAIME ledger as a new class — a **standing experiment** — recording
  "latest checkpoint health snapshot + current rolling-skill version", not a terminal V_meta.

### §4.7 Human asynchronous side-channel input — handled by the OUTER layer

The human-insight frontier (§4.4 tier 3) is the irreducible source of structural value and arrives
**asynchronously**, not on iteration boundaries. Handling rule: **all human async input is handled
by the OUTER layer; it never perturbs an in-flight inner milestone.**

- **Normal path:** the human injects input any time via `/quay-directive`, which writes to the
  `experiments/quay-perpetual-stream/directives/pending/` **inbox** (the inherited directive
  mechanism; `/quay-directive` auto-detects exp5 as active). The outer loop **drains the inbox at each
  milestone boundary** (OUTER-LOOP cycle step 0), dispositioning each into a backlog milestone
  candidate / standing-rule amendment / out-of-cycle action, then archiving it. The running inner
  milestone keeps its frozen charter (§3.4) — no mid-flight mutation.
- **Urgent path (rare, expensive by design):** if a running milestone is fundamentally broken, the
  human exercises an **authorized external HALT of that inner milestone**, aborting it; the correction
  becomes an outer re-design. Aborting a milestone is deliberately costly so this is not casual.
- **Structural privilege:** the human channel is the only input that may rescope the stream, trigger
  a **VT chart transition** (re-baseline), retire a milestone, or call an **out-of-cycle checkpoint**.

Why outer, not inner: an inner milestone is a frozen-charter convergent task; absorbing async input
mid-flight IS the mis-sizing anti-pattern. Reference failure: DIR-008 (human insight that V_meta was
mis-designed) arrived async during exp4; the correct handling was an outer between-milestones metric
re-design, but layer-collapsed exp4 absorbed it **inside** iteration 14 — which is exactly why it was
forced to issue a "non-comparability statement." exp5's rule structurally prevents this.

---

## §5 exp4 → exp5 three-way carry

- **Converged code** → exp5's current product state (VT origin).
- **Open DIRs / gaps** (incl. DIR-004 packaging, DIR-006 cutover) → the **milestone/opportunity
  backlog**. DIR-004 becomes a *Distribution milestone* candidate — not an inner gap (which is why
  it rotted 8 iterations with no outer owner).
- **Extracted skills** (native/core/webui/continuous deltas) → the **inherited inner methodology
  library** (Tier B seed), to be consolidated per §4.2.

exp4 itself: HALT with practical-convergence-accepted (consistent with exp1/2/3), state carried.

---

## §6 Control limits (initial, from offline replay)

Pre-declared so "healthy" is not defined post-hoc (SPC discipline):
- inner ΔV plateau band: <0.02 for K=2 → stop-eligible; inner budget ≈10.
- gate-hash check: any non-verbatim gate re-authoring → block (0 tolerance; DIR-009).
- discovery-latency alarm: any mechanizable-channel discovery arriving >~8 iters late (the offline
  mean) signals a missing/disabled it0 diagnostic.
- VT slope alarm & ρ-must-not-fall thresholds: seeded at the first checkpoint from live data
  (offline gives shape, not live control limits).

### §6.1 Expected operating envelope (dashboard initial values)

Basis: `hard` = harness/exp1–4 calibrated; `soft` = no baseline, set at first live checkpoint.

**Inner (per-milestone / per-iteration):**

| metric | expected | basis | matures toward |
|---|---|---|---|
| iterations / milestone | **3–7**, hard cap **~10** | exp2 Done-when it3, exp3 it4; rule stops exp1 it10 | `hard` → 3–5 |
| iteration-startup context (charter Tier A) | **≤ 2 K tokens** | Tier-A design vs current 40–83 K/iter | `hard` → thinner |
| milestone-it0 one-time (Tier B pinned) | **~10–20 K, read once** | current 74 K prompt's arch/dispatch/constraints | amortized |
| iteration N≥1 read | **~2–5 K** (charter + grep) | Tier-C grep, no full-load | `hard` ↓ |
| total context / milestone | **~25–40 K** (5 iters) | vs current ~400–800 K | **~20–40× cut** |
| ρ reuse rate (start) | **0.70–0.80** | exp2/3 skeleton 70–80 % stable | `hard` ↑ >0.9 |
| adaptations / milestone | **5–6** (build) → **0–2** (mature) | exp2/3 delta skills = 6 net-new each | `hard` ↓ |
| σ validation (per task) | **→ 1** (alarm < ~0.9) | exp4 σ=0.962 | `hard` |
| ΔV plateau | **<0.02, K=2 consecutive → stop** | harness-calibrated, param-robust | `hard` |

Inner control limits: budget=10 (past it → default HALT, continue needs authorization) ·
charter Tier A >2 K = dilution alarm · gate-hash **0 tolerance** · binary Done-when **mandatory**.

**Outer (stream):**

| metric | expected | basis |
|---|---|---|
| VT slope (marginal value / milestone) | trend flat-or-rising when healthy; slope < threshold = exit | `soft` |
| discovery latency (core health metric) | mechanizable → **0 (it0 hit)**; alarm **>8 iters** | `hard` (206-iter history, mean 7.6) |
| φ fold-back confirmation latency | **~1–2 milestones downstream** | §0c exp3→exp4; σ-floor exp2→exp3 |
| consolidation events / checkpoint | a few | `soft` |
| inner-convergence success (no mid-flight re-scope) | target **>80 %** | exp2/3 pass, exp4 fail |
| predicted-vs-realized value calibration error | shrinking per milestone | `soft` |
| mid-milestone charter-change frequency | **→ 0** | each change = a mis-sized milestone |
| checkpoint cadence | every **5 milestones** | §4.6 |
| explore/exploit ratio | **≥ 1 explore / 5** | §4.5 |

**Build → mature trajectory (this shape IS the "drive"):** iterations/milestone 5–10 → 3–5 ·
charter thick → thin · ρ 0.7 → >0.9 · adaptations 5–6 → 0–2 · inner budget 10 → 6–8 ·
discovery latency mean 7.6 (late) → ≈0 (it0). The *decline* of charter-thickness, iteration-count,
and discovery-latency, and the *rise* of ρ, are exactly what the outer dashboard reads as "methodology
maturing." The inverse (ρ falling, charters thickening, latency lengthening, mid-milestone re-scopes
rising) is the degradation signal.

### §6.2 VT value scale — weighted surface-capability points (decision ④)

The VT currency is **capability points across quay's surfaces**, chosen to connect continuously with
the existing V_instance `capability_breadth` dimension. Definition:

- **Surfaces + initial weights (chart-0):**

  | surface | weight | note |
  |---|---|---|
  | CLI | 25 | core interaction surface |
  | MCP | 20 | integration/consumer surface |
  | Web UI | 20 | visual/interactive surface |
  | Packaging / Distribution | 20 | currently the largest gap (DIR-004) |
  | Docs | 15 | enablement surface |
  | **Σ** | **100** | chart-0 maximum |

- **Coverage** `cov_s ∈ [0,1]` per surface, scored as capability_breadth is scored today
  (fraction of the surface's known capabilities delivered & verified).
- **VT on the current chart** `= Σ_s weight_s · cov_s` (chart-0 range 0–100).
- **Per-milestone value hypothesis** `Δv̂ = Σ_s weight_s · Δĉov_s` (predicted coverage gain);
  realized `Δv` measured the same way at the checkpoint; `|Δv − Δv̂|/Δv̂` = calibration error.

- **Unbounded via chart transitions (resolves the "bounded coverage vs unbounded VT" tension):**
  within one chart VT saturates toward 100; **a chart transition adds new surfaces or deepens a
  surface's capability ceiling** (e.g. CLI→multi-surface SaaS opens auth/multi-tenant/API surfaces),
  re-baselining to a larger scale with a numeric conversion factor mapping old points→new. The
  manifold (all charts) is unbounded even though each chart is bounded.
- **This makes the exit signal natural:** as a chart saturates, VT slope (marginal points/milestone)
  → 0; the outer layer either **opens a new chart** (an explore milestone that adds a surface) or, if
  none is worthwhile, the declining slope is the honest external-HALT signal.

Weights are **initial and soft** — revised at the first checkpoint from live data (§6 principle:
offline gives shape, live gives control limits).

- **Offline-validated (cheap, done):** inner termination rule (exp1 −78, param-robust, 1 FN);
  4/5 systematic-explore checks (+1 honest refutation); binary-Done-when-mandatory; K/BUDGET
  constants; ρ/φ as measurement.
- **Live-only (irreducible):** the outer milestone-selection policy (§4.5) — no counterfactual data.
- **Caveats:** n=4 experiments; discovery features are retrospective reconstructions; counterfactual
  leakage (stopping exp4 at it13 would have lost DIR-008 — hence the §3.2 redesign-OR-stop branch).

---

## §8 Decisions (resolved 2026-07-18)

1. **Name:** `quay-perpetual-stream`.
2. **Checkpoint cadence:** every **5 milestones**, **non-blocking** — a health snapshot + hypothesis
   self-test the loop writes and continues past. The human reviews asynchronously and may steer
   (`/quay-directive`) or stop (`.halt` sentinel) at any time; the loop never blocks waiting.
3. **Minimum explore cadence:** **≥1 explore milestone per 5** (aligned with the checkpoint window).
4. **VT:** **numerically quantified** (§4.1) — numeric per-milestone value hypothesis, numeric VT
   curve, chart transitions carry a numeric conversion factor. **Scale = weighted
   surface-capability points (§6.2).**
5. **exp4:** **HALT with practical-convergence-accepted + three-way carry (§5)** — decided. The
   filesystem-level carry is executed as the §9 startup action, not before this protocol is greenlit.

---

## §9 Startup

Startup = **execute one outer-loop driver prompt**, `experiments/quay-perpetual-stream/OUTER-LOOP.md`.
Unlike experiments 1–4 (a single static `ITERATION-PROMPTS.md`), this driver is thin and *generates*
per-milestone charters rather than being one large prompt.

On first execution it:
1. performs the §5 three-way carry (exp4 code→product state; open DIRs/gaps→milestone backlog;
   skills→inherited core) and marks exp4 HALTed;
2. seeds the outer dashboard: VT origin = 0 on chart-0, control limits from §6/§6.1;
3. runs the outer cycle — **select milestone → author Tier-A charter (§3.1) → dispatch the inner
   BAIME milestone to convergence (§3.2) → absorb results (VT, adaptation log, ρ/φ) → checkpoint
   every 5**.

Operationally it can be placed under `/loop` for continuous running, with the 5-milestone checkpoint
as the standing human gate and `/quay-directive` as the async human side-channel (§4.7). The first
milestone is expected to be one of the aged exp4 backlog items — DIR-004 (Distribution, product) or
DIR-006 (directives-as-quay-tasks, methodology-infrastructure).

The `OUTER-LOOP.md` driver itself is authored as the first build step once this protocol is approved.
