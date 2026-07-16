# Generalizing the quay-bootstrap loop to drive external projects — discussion notes

- **Status:** forward-looking discussion notes, not a resolved decision or a
  commitment to build. No protocol amendment, `ITERATION-PROMPTS.md` edit, or
  directive follows from this document.
- **Date:** 2026-07-15
- **Context:** captured from a live conversation between the human (Yale) and a
  Claude Code session, after 24 iterations of the `quay-bootstrap` BAIME
  experiment (`experiment/`). The human observed that the BAIME method has
  driven the development of quay-native — a small project — nearly
  autonomously, long-running and continuously, with a working asynchronous
  steering (adjustment) mechanism (the `experiment/directives/` apparatus),
  and proposed a natural generalization: pairing quay-native (+ the Core,
  `quay`) with a BAIME-*derived* iteration mechanism (with the meta-goal and
  V_meta removed) to drive continuous, automated development of **other**
  projects, supporting the same asynchronous adjustment interaction.
- **Related:** [`quay-bootstrap-experiment.md`](./quay-bootstrap-experiment.md)
  (the protocol this generalizes from) · [`quay-proposal.md`](./quay-proposal.md) ·
  [`quay-core-scope-expansion-discussion.md`](./quay-core-scope-expansion-discussion.md) ·
  `experiment/directives/README.md` (the steering mechanism) ·
  `experiment/iterations/iteration-{22,23,24}.md` (the diminishing-returns
  signal referenced below).

## 1. The observation being generalized

Two things were empirically demonstrated by the experiment, independent of
quay-native's specific subject matter:

1. **Long-running, near-unattended continuity is real.** 24 iterations, each
   self-continuing via a fixed `observe → strategy → execute →
   convergence-check → problems-for-next` structure, ran without a human in
   the per-iteration loop.
2. **Asynchronous, out-of-band steering works.** The `directives` mechanism
   lets a human inject adjustments mid-flight without interrupting or waiting
   for the running iteration (DIR-006, DIR-007 were added this way during
   this very conversation).

The proposal: these are general capabilities. Combined with quay (a
provider-agnostic task store + gate + MCP surface), a BAIME-derived loop with
the self-referential layer stripped out should be able to drive continuous
automated development of arbitrary projects, with the same async adjustment
affordance.

## 2. Separate the reusable mechanism from what this task gave for free

The experiment's most important interpretive risk is mistaking the
*convenience of a self-referential task* for the *general power of the
method*. Splitting them:

### 2.1 Genuinely portable assets (independent of self-reference)

- **The asynchronous, out-of-band steering mechanism (`directives`).** Its
  design is the most solid reusable artifact here: one-time consumption,
  explicit accept/defer/reject outcomes, a mandatory safety check against
  touching in-flight iteration files, and computed-not-asserted resolution
  records. None of this depends on quay-native's self-reference. This *is*
  the "asynchronous adjustment interaction" the proposal names.
- **The provenance ledger (computed, not asserted).** Every increment's
  origin is recorded and independently recomputed rather than self-scored. In
  a non-self-referential project this matters *more*, not less — the natural
  honesty pressure of self-reference is gone.
- **The iteration report scaffold** (`observe → strategy → execute →
  convergence-check → problems-for-next`) — the carrier of long-horizon
  continuity, letting iteration N+1 resume from iteration N's honest
  self-assessment.
- **quay itself as the substrate.** task store + gate + MCP surface, designed
  provider-agnostic from the start; pointing it at another project's backlog
  is its intended use, not a hack.
- **The anti-self-flattery machinery, battle-tested.** G1 (the seed cannot be
  hidden), G2 (metric collapse), computed provenance, adversarial
  break/restore verification (deliberately breaking one line to confirm a
  test actually fails), and independent out-of-band audit. These were
  exercised against real failures in this experiment (e.g. iteration 10's
  fabricated directives, caught by the iteration-10 independent audit).

### 2.2 What quay-native gave for free — gone the moment you drive another project

- **A natively CLI+MCP interaction surface.** The clean "CLI is the golden
  test harness" discipline (`abi-symmetry.mjs`) is possible because the thing
  under test *is* a command-line tool. Real projects often need verification
  through GUIs, external services, or non-deterministic behavior.
- **A cheap gate/oracle.** `quay-native task check` can mechanically decide
  "done" because tasks are small and acceptance is checkable. "Did this
  feature actually do the right thing?" is not this cheap on a general
  project.
- **No externally-imported goal.** Because the meta-goal is "build me," there
  is *no need for anyone to author a backlog* — the project is its own goal.
  This is the most underrated free lunch; see §3.

## 3. Removing V_meta / the meta-goal removes two things — and one of them you want to keep

The instinct to strip the self-referential layer (M(Q)=Q, σ, V_meta) when
driving other projects is correct. But it removes two distinct things:

- **It removes the self-hosting convergence criterion** — good. External
  projects need no "rebuild v_{n+1} from v_n and diff" fixpoint.
- **It also removes the free answer to "where do goals come from."** The
  self-referential version could run ~24 rounds nearly autonomously because
  it *never had to import a goal*: the backlog was simply its own remaining
  to-do. Once you drive an external project, **"who decomposes a
  human-given high-level goal into a continuous, non-padding backlog"
  becomes a new load-bearing core problem** — and that is exactly the part
  the self-reference hid, and that this experiment never pressure-tested.

**Reframing:** dropping the meta-goal is not a simplification; it *relocates*
the hard problem from "can it build itself" to "can it correctly decompose an
external goal, and know when a task is genuinely done." The epicd / authoring
/ decomposition machinery moves from supporting cast to lead.

## 4. The two decisive variables for the generalized system

### 4.1 Backlog supply quality (the new stopping-condition problem)

The self-referential version had a luxury: a definite stopping condition
(σ→1 + fixpoint). An external project under continuous development has, in
principle, *no* fixpoint — it is never "done." So:

- Per-task convergence = gate green + acceptance satisfied (quay already has a
  prototype of this).
- Project-level: no global convergence, only "backlog empty / current epic's
  acceptance all satisfied." Therefore **backlog quality decides everything.**
  When the backlog thins, the loop behaves exactly as it did in iterations
  22-24: honestly reporting it can only find "one more test file to add." On
  a tiny self-referential project that is merely an end-of-life signal; **on
  a real project the identical behavior manifests as make-work (padding).**
  The experiment's honesty machinery lets it *truthfully report* that it is
  padding — but cannot prevent the backlog itself from drying up. The
  load-bearing requirement is therefore an upstream engine that continuously
  supplies non-trivial tasks with real acceptance criteria.

### 4.2 Gate / oracle trustworthiness (G3 at full strength)

The self-referential version's gate was both contestant and judge, backstopped
by independent audit (G3). On an external project the "did this PR actually
satisfy the requirement?" judgment must come from either:

- a test suite — but then *who guarantees the tests aren't written to flatter
  the agent's own implementation?* The adversarial break/restore discipline
  this experiment already uses partially answers this and is directly
  portable; or
- human review.

Either way, **independent audit stops being a luxury and becomes mandatory**,
and it must cover the *domain* of the project under development — it can no
longer be the same quay gate self-certifying. This is G3's principle applied
at full strength, without the self-reference that softened it here.

## 5. A quieter loss: the effectiveness signal

In this experiment `effectiveness` (native-vs-seed speedup) was debated across
several iterations and parked at 0.26. It is tempting to discard it entirely
when driving external projects. Caution: **`effectiveness` is the only signal
that tells you whether the automation is actually faster than a human.** A
self-referential experiment can let it lie flat because the point is to prove
the method *works at all*; but when the loop is spending real resources on a
real project you are accountable for, "is N hours of agent looping actually
saving human time" is precisely what should be measured. Recommendation:
**drop the self-referential V_meta, but keep a plain input/output (speedup or
cost-per-increment) metric** — otherwise you lose the basis for deciding
whether the loop is worth continuing to run on a given project.

## 6. What the generalized system looks like (one-paragraph form)

**quay** (task store + gate + MCP surface + the asynchronous `directives`
steering mechanism) **+ a BAIME-lite iterator** that drops the self-hosting
layer (M(Q)=Q, σ, V_meta) **but retains, unchanged, the entire
anti-self-flattery / audit / out-of-band-steering apparatus** (G1, G2,
G3-at-full-strength, computed provenance, adversarial verification, the
iteration report scaffold) — **with the removed self-hosting layer replaced,
not left empty, by a load-bearing external-goal-driven authoring/decomposition
engine** (epicd promoted from supporting role to core). The two variables that
decide success shift from "can it build itself" to (1) **backlog-supply
quality** and (2) **gate/oracle trustworthiness** — the two things the
self-referential small project never pressure-tested.

## 7. Recommended first step (not: jump straight to a large project)

Do not start on a large project. Start on a **medium external project whose
goal must be externally imported but whose acceptance is still relatively
mechanizable** — e.g. a project with a full test suite, pure CLI/library, no
GUI. Use it specifically to stress the two new load-bearing points (§4.1
backlog authoring, §4.2 independent gate). This mirrors how the GitHub
Provider was deliberately chosen as "the heterogeneous backend, the mirror
that exposes every shortcut in view-model normalization" (quay-proposal.md
§14): you need an *"external-project mirror"* to expose the authoring and gate
shortcuts that self-reference has been quietly hiding all along.

## 8. Open questions (not resolved here)

- What concretely plays the role of the epicd/authoring engine when the goal
  is external, and how is its output quality (non-padding, real acceptance
  criteria) measured?
- What is the minimal independent-audit setup that can judge an *external
  project's* domain correctness, rather than quay self-certifying?
- What replaces σ/fixpoint as the operational "keep going / pause / this epic
  is done" signal at the project level?
- Which parts of the BAIME guardrail set (G1-G6) transfer unchanged, which are
  dropped with the self-hosting layer, and which need domain-specific
  replacements? (A concrete mapping — kept / dropped / replaced — was offered
  in conversation but not yet written down.)

This document records the discussion and its analysis only. Turning any of it
into a protocol, a new experiment, or an implementation is a separate,
explicit, human-authorized step.
