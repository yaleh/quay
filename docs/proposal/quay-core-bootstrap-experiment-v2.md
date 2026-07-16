# Quay Core — Second-Generation Bootstrap Experiment (proposal)

- **Status:** Proposal — **not adopted**. Requires an explicit human decision to
  start (see §7 "Preconditions to start"). This is a design document, not a
  protocol amendment to `quay-bootstrap-experiment.md` and not a directive —
  it defines a **new, separate experiment** to run after the first one stops.
- **Date:** 2026-07-16
- **Owner:** Yale Huang
- **Relates:** [`quay-bootstrap-experiment.md`](./quay-bootstrap-experiment.md)
  (experiment 1's protocol — this document inherits from it rather than
  redefining it), [`quay-core-scope-expansion-discussion.md`](./quay-core-scope-expansion-discussion.md),
  [`quay-proposal.md`](./quay-proposal.md), [`quay-native-design.md`](./quay-native-design.md),
  [`glossary.md`](./glossary.md)
- **Origin:** captured from a live conversation (2026-07-16) reviewing
  experiment 1's state at iteration 63 (σ = 0.8939, V_instance = 0.5533,
  V_meta = 0.0973, all 5 convergence criteria still NO) and discussing
  whether/how to pursue more complete Core development as its own effort.

> Frozen vocabulary applies (see `glossary.md`). BAIME terms (`V_instance`,
> `V_meta`, OCA, `A_n`, `M_n`, `O`) are used verbatim per the
> `methodology-bootstrapping` skill.

---

## 1. Summary

Experiment 1 (`quay-bootstrap-experiment.md`) bootstraps **quay-native**
end-to-end via BAIME's self-hosting identity (`M(Q) = Q`): the deliverable
*is* the methodology, and quay-native must progressively author, execute,
and gate its own backlog. As of iteration 63 it has **not converged**
(V_instance 0.5533, V_meta 0.0973, both far below the 0.80 dual threshold)
and four of its eight V-factors have been flat for 38-54 consecutive
iterations (`effectiveness`, `reusability`, `completeness`, `validation`)
— strong evidence that the marginal, single-gap-at-a-time task selection
this stage of the experiment converged on is no longer moving the metrics
that matter, even though it keeps producing genuine, individually-valid
increments (test coverage, negative-path closures).

This document proposes a **second experiment**, run only after experiment 1
is deliberately stopped (not necessarily converged — see §7), with a
different shape:

- **Instance objective, made explicit:** iteratively develop **quay Core**
  (`packages/quay`: CLI + Web UI + action-trigger edge + Core MCP) to a
  materially more complete state, alongside continued quay-native work —
  not as an implicit consequence of "the v0 skeleton already touches
  Core" (experiment 1's framing, `ITERATION-PROMPTS.md` §Core-scope work
  item 4(a)), but as a first-class, explicitly scoped goal.
- **Meta objective, reframed as refinement, not bootstrap-from-zero:**
  experiment 1's methodology (Skills, gate discipline, σ-provenance
  tracking, directive/audit/provenance machinery) is **inherited**, not
  reinvented. The meta goal here is to identify where that methodology's
  transfer was weak (the four stalled V_meta factors above are the
  starting hypothesis) and fix the methodology itself, using continued
  Core + quay-native development as the proving ground.
- **Verification target unchanged:** `quay-github` remains the transfer
  target / held-out Provider, per experiment 1's Resolved Decision 4
  (§10.1) — this document does not reopen that decision, only continues
  to rely on it.

This is deliberately **not** a `docs/proposal/quay-bootstrap-experiment.md`
§10 "Resolved decisions" amendment. §10 amendments extend an existing,
running experiment's protocol; this proposal describes a **distinct
experiment** with its own instance objective, meant to start only once
experiment 1 has ended. It is also deliberately **not** a directive —
`experiment/directives/README.md`'s own format requires a concrete,
checkable Finding and Requested action, and "develop quay Core more
completely" fails that bar for exactly the reason G5 (walking-skeleton
discipline) warns about: no checkable acceptance criterion, an
open-ended scope, a blank check for gold-plating.

---

## 2. Relationship to experiment 1 (the inheritance boundary)

The central design question this document must answer precisely, because
getting it wrong reproduces experiment 1's own `completeness`/`reusability`
stall: **what, exactly, transfers from experiment 1 to experiment 2, and
how is that transfer itself verified rather than asserted?**

### 2.1 Extraction before stop

Recommendation: before experiment 1 is stopped, run
`baime:knowledge-extractor` against it — **even though it has not met its
own convergence thresholds (§7 of `quay-bootstrap-experiment.md`)**. This
is a deliberate deviation from the extractor's normal post-convergence
use, justified because:

- Experiment 1's `reusability` and `completeness` factors are *already*
  the thing being measured — extracting now, before further marginal
  iterations, produces an honest artifact: "here is what experiment 1's
  methodology actually contained as of iteration N," not a polished
  retrospective narrative assembled after the fact.
- It converts "experiment 2 applies lessons from experiment 1" from an
  informal, unverifiable claim (the exact self-certification risk G3
  exists to prevent) into a concrete artifact — extracted `quay:*`
  Skills, gate logic, and documented methodology — that experiment 2's
  own G3-equivalent audit can check against.
- It gives experiment 2 a clean **inheritance boundary**: everything
  extracted is "inherited, stage 0"; everything experiment 2 changes
  after that point is new work subject to experiment 2's own provenance
  tracking, not silently credited to experiment 1's numbers or vice
  versa.

### 2.2 What inherits vs. what is new

| Carries over from experiment 1 | New to experiment 2 |
|---|---|
| Layer-1 operation Skills (`write-proposal`, `review-proposal`, `write-plan`, `review-plan`, `implement`, `adjudicate`) and Layer-2 orchestration Skills (`quay:author`, `quay:execute`), as extracted | Explicit Core-development task backlog, scoped per §4 |
| The `task check` gate mechanics (design §3, §5) | Whatever gate/methodology changes are motivated by fixing the stalled factors (§5) |
| The directive mechanism (`experiment/directives/`) and its lifecycle | A fresh `provenance.md` (σ resets — see §6) |
| The out-of-band audit discipline (G3) and the "Resolved decisions" §10 mechanism | The manda-nested-subagent audit requirement from DIR-012, evaluated as a live methodology change rather than assumed |
| `quay-github` as the transfer target (§10.1 of experiment 1) | Core-level ABI symmetry evidence (three-way CLI ⟷ Core MCP ⟷ Web UI, per the unresolved discussion-doc §2.2 proposal) |

### 2.3 What "stop" means for experiment 1

Experiment 1 is not required to reach its own convergence criteria before
experiment 2 starts. "Stop" means: run the extraction (§2.1), write a
closing iteration report stating the final V_instance/V_meta/σ snapshot
and explicitly marking the experiment as **halted, not converged**
(distinct from experiment 1's own in-progress status line, which must be
updated to reflect this), and leave `experiment/directives/pending/`
either empty or explicitly triaged (each pending directive marked
carried-forward-to-experiment-2, deferred indefinitely, or resolved) —
not silently abandoned.

---

## 3. Why this needs a new top-level document, not a §10 amendment

`quay-bootstrap-experiment.md` §10 "Resolved decisions" is scoped to
protocol-level decisions *within* the running experiment (σ granularity,
seed retirement schedule, auditor split, transfer target, effectiveness
baseline) — all decisions that leave the instance objective ("implement
quay-native") and meta objective ("quay-native builds quay-native")
unchanged. What this document proposes changes the instance objective
itself (Core becomes explicit and primary, not an implicit dependency of
the v0 skeleton) and changes the character of the meta objective (refine
an inherited methodology, rather than bootstrap one from a seed at σ=0).
That is a new experiment by BAIME's own definition, not a resolved
decision about how to run the existing one — hence a new document,
modeled on `quay-bootstrap-experiment.md`'s own format but not nested
inside it.

---

## 4. Instance objective (proposed)

Develop **quay Core** (`packages/quay`) and continue **quay-native**
development to a materially more complete state, specifically:

1. **Core CLI/MCP/Web-UI three-way symmetry** (discussion doc §2.2,
   codified as in-scope-but-not-yet-actioned by DIR-008/DIR-010): extend
   the Provider-level P3 CLI/MCP symmetry principle one layer up, with an
   explicit Core-level equivalent of `abi-symmetry.mjs`.
2. **Browser-driven Web UI verification** (discussion doc §2.1): using
   browser-automation tooling (chrome-devtools / playwright MCP —
   terminology kept unambiguous per `ITERATION-PROMPTS.md` §Core-scope
   work item 1) to verify existing Web UI behavior, explicitly bounded by
   G5 (confirm existing behavior; do not improve appearance/interactivity
   as a side effect).
3. **Mock/log-file action-delivery verification mode** (discussion doc
   §2.3): a deterministic, file-based recording mode for
   `action.js`'s `deliverTrigger()`, as the default automated-test
   harness, with live-manda delivery kept as a separate, additional
   check — per the manda-investigation reuse discipline already
   established (do not make automated-test pass/fail hinge on live manda
   delivery).
4. **Continued quay-native backlog work**, using whatever of experiment
   1's methodology survives inheritance (§2.2), so Core development does
   not happen at the expense of regressing quay-native's own state.

`quay-github` continues as the verification/transfer Provider throughout
(no change to experiment 1's Resolved Decision 4).

This list is a **starting scope**, not a closed acceptance criterion —
per §3's own reasoning about why "comprehensive Core development" cannot
be a directive, this document's own §7 requires converting it into a
concrete, checkable instance objective statement (mirroring
`quay-bootstrap-experiment.md` §1's own scoped instance-goal bullet list)
before experiment 2 actually starts, not left as an open-ended ambition.

---

## 5. Meta objective (proposed): refine, don't re-bootstrap

Experiment 1's meta objective was "establish a development methodology
that drives quay-native's own development, and use it to drive that
development" — bootstrapping from an explicit seed at σ=0 up toward
self-hosting. Experiment 2 starts from an **inherited, already-partially-
mature** methodology (§2.1's extraction), so re-running the same σ ladder
from scratch would not measure anything new.

Proposed meta objective instead: **identify and fix the specific reasons
experiment 1's `effectiveness`, `reusability`, `completeness`, and
`validation` factors stalled**, using continued Core + quay-native
development as the proving ground. Concretely, this means experiment 2's
iteration reports must, for each of these four factors, either (a) show
genuine movement with evidence, or (b) if still flat, give a **different**
stalling reason than experiment 1 recorded — a repeat of experiment 1's
own stalling reason after a supposed methodology refinement would be
itself a finding (the refinement didn't work) requiring escalation, not
just another "held flat" note.

This reframes experiment 2's own value function work: `V_meta`'s formula
(`completeness × effectiveness × reusability × validation`) is inherited
unchanged in *shape*, but its **baseline is not the naive 0.15-0.25
seed-stage baseline** experiment 1 documented (§9 of
`quay-bootstrap-experiment.md`) — it starts from experiment 1's own final
values (§2.1's extracted snapshot) and must show real movement from
*there*, not from zero. A first iteration of experiment 2 that re-derives
low baseline V_meta numbers as if starting fresh would misrepresent the
inheritance and should be treated as a scoring error.

---

## 6. Provenance and σ: reset, with an explicit inheritance record

σ (self-hosting fraction, `quay-bootstrap-experiment.md` §4) is defined
per-task against experiment 1's specific task backlog (`tasks/QN-*.md`
being `{native, native, native}`). Experiment 2's new Core-development
tasks are a different population — σ **resets to a fresh count** scoped
to experiment 2's own task set, not averaged or concatenated with
experiment 1's final 0.8939. `experiment/provenance.md` (or a new,
separately named ledger — to be decided when this document is adopted,
per §7) must carry an explicit **inheritance record**: a pointer to
experiment 1's final provenance state and the extracted-methodology
artifact from §2.1, so a reader can distinguish "this task was driven by
inherited, already-proven Skills" from "this task exercised newly
modified Skills as part of experiment 2's own methodology-refinement
work" — the same distinction experiment 1's own G1 (`the seed cannot be
hidden`) makes for its seed-vs-native split.

---

## 7. Preconditions to start (not yet satisfied)

This document does not authorize starting experiment 2. Before it starts:

1. **Experiment 1 stop decision**, made explicitly by the human owner —
   not inferred from this document's existence.
2. **Extraction run** (§2.1) against experiment 1's current state,
   producing the inheritance artifact §2.2/§6 reference.
3. **Instance objective converted from §4's starting-scope list into a
   concrete, checkable statement** — mirroring how
   `quay-bootstrap-experiment.md` §1 states quay-native's instance goal
   as a specific, bounded bullet list, not an open-ended ambition. This
   is the same G5 discipline that made "comprehensive Core development"
   unsuitable as a directive (per this conversation's own reasoning) —
   it applies with equal force to this proposal document before it can
   be adopted.
4. **Experiment layout decided**: whether experiment 2 reuses
   `experiment/` (with the inheritance record making the boundary
   explicit) or gets its own top-level directory (e.g. `experiment-2/`)
   — an open question this document does not resolve.
5. **DIR-012's manda-nested-subagent audit requirement resolved one way
   or another** (applied, deferred, or rejected) before being assumed as
   a standing practice for experiment 2's own audits — experiment 2
   should not silently inherit an unresolved, still-pending directive
   from experiment 1 as if it were settled.

Until all five are satisfied, this document remains a proposal, not a
protocol.
