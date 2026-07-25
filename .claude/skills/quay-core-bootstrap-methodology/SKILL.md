---
name: quay-core-bootstrap-methodology
description: Use when inheriting or extending the quay-native methodology into a THIRD scope, or when deciding whether to trust manda nested-subagent dispatch, the G3 audit dispatch channel, or a multiplicative V_meta configuration in a new BAIME experiment. Extracted HALT-with-practical-convergence-accepted from experiments/quay-core-bootstrap/ (experiment 2, a transfer test of experiment 1's methodology) at iteration 10: V_instance=1.0 (all 4 Done-when clauses met), V_meta=0.1012 (mathematically ceilinged at 0.26 by a frozen effectiveness factor). This is a companion/delta skill to quay-native-methodology — read that skill first; this one packages only what experiment 2 discovered that experiment 1 did not already have.
---

# quay-core-bootstrap-methodology

λ(scope, task) → GatedOutcome | inherit(quay-native-methodology) ∧ apply_delta(scope, task)

## Status (read first)

Source experiment `experiments/quay-core-bootstrap/` (experiment 2 in this
project's BAIME history; protocol source cited in its own directives/
provenance.md) **halted at iteration 10 with practical convergence
accepted — NOT formally CONVERGED**. Authoritative closing report:
`experiments/quay-core-bootstrap/iterations/iteration-10.md` §11.

```
V_instance = core_abi_symmetry × web_ui_verification × action_delivery_mode × native_backlog_health
           = 1.0 × 1.0 × 1.0 × 1.0 = 1.0   (stable since iteration 3)

V_meta     = completeness × effectiveness × reusability × validation
           = 0.77 × 0.26 × 0.79 × 0.64 = 0.1012   (flat since iteration 6,
             5 consecutive iterations; mathematical ceiling = 0.26,
             criterion V_meta≥0.80 arithmetically unreachable)

σ_QC       = 4/10 = 0.40   (own-experiment ledger; dominated by an
             inherited floor σ_strict=0.8493 from experiment 1 — see
             reference/sigma-inherited-floor-trap.md)
```

Formal convergence criteria met: 2 (all 4 Done-when clauses), 4 (G3 green,
vacuously), 5 (diminishing returns). NOT met: 1 (V_meta≥0.80, structurally
impossible), 3 (≥2 V_meta factors genuinely moved — only 1 did). This is
the same HALT-not-CONVERGED shape as experiment 1, for structurally
related reasons — see `reference/transfer-test-outcome.md`.

## Relationship to quay-native-methodology (read that skill first)

This skill is a **delta**, not a replacement. Experiment 2 inherited
experiment 1's Layer-2 `quay:author`/`quay:execute` Skills, the `task
check` gate, the directive lifecycle, and the G3 out-of-band audit
discipline verbatim — all of that is already documented in
`.claude/skills/quay-native-methodology/`. Do not re-read or re-derive
that material from this skill; the reference files here only cover what
experiment 2 discovered that experiment 1's snapshot did not already
contain. Where experiment 2 merely reconfirmed an experiment-1 finding
with more evidence (e.g. the completeness stall's "same dimension"
character), that reconfirmation is noted in `reference/transfer-test-outcome.md`
but not re-documented in full — see `quay-native-methodology/reference/v-meta-stall-analysis.md`
for the original.

## What this Skill packages (net-new findings only)

1. **The manda-daemon address discovery bug and fix** — iterations 0-3
   probed a hardcoded, wrong daemon port; the correct address must be read
   from `.manda/hub.addr` at runtime. See `reference/manda-daemon-address-bug.md`.
2. **A characterized three-tier reliability envelope for
   `mcp__plugin_manda_manda__Agent`** — trivial/medium/complex task
   dispatch, each tested at specific timeouts, with a corrected
   ("succeeds at 150s", not "always times out") result for the
   complex/G3-shaped tier. See `reference/manda-reliability-envelope.md`.
3. **The G3-audit-via-manda anti-pattern and its correction (DIR-003)** —
   a concrete methodology-drift case study: the iteration-executor
   subagent mistakenly self-dispatched G3 audits via manda, contrary to
   the protocol's own orchestrator-dispatched-native-Agent-tool design.
   See `reference/g3-audit-dispatch-drift-case-study.md`.
3a. The other two experiment-2 directives (DIR-001 daemon/G6 recheck,
   DIR-002 proactive provenance size control) are packaged alongside the
   DIR-003 case study in the same reference file's directive index, since
   all three are short and share the "directive lifecycle in active use"
   theme.
4. **The mathematical-ceiling diagnostic for multiplicative V_meta** — a
   reusable technique for early-recognizing that a V_meta configuration
   cannot converge when one factor is structurally frozen. See
   `reference/v-meta-ceiling-diagnostic.md`.
5. **The σ_QC-vs-inherited-floor structural trap** — when a new
   experiment inherits a high σ_strict floor from a prior experiment but
   starts its own count at 0/N, validation is dominated by the floor
   until the new experiment's native-provenance count grows very large.
   See `reference/sigma-inherited-floor-trap.md`.
6. **Confirmation the {native,native,native} provenance triple is
   reproducible on demand under the degraded-fallback Method** (4
   consecutive tasks, QC-007 through QC-010) — evidence about what
   "native" provenance can mean without true independent subagent
   dispatch. Documented within `reference/manda-reliability-envelope.md`
   (same evidentiary source) rather than as a separate file.

## Spec :: formal constraints

:: delta_not_duplicate : Knowledge → CanonicalSource
| ∀ k ∈ skill.knowledge . source(k) = quay-native-methodology ∨ new_experiment_2(k)
| exec: cite quay-native-methodology for shared findings; this skill documents only Δ

:: honest_inheritance : Claim → EvidencePath
| ∀ claim ∈ skill.knowledge . claim.evidence ∈ {iteration-10.md, iterations/}
| exec: iteration-10.md (authoritative closing report) + specific iteration file

:: ¬imply_convergence : Status → AssertionConstraint
| status = halted ∧ V_meta = 0.1012 ∧ (V_meta < V_meta_ceiling = 0.26)
| exec: "HALT with practical convergence accepted" — a distinct, weaker status

:: reliability_envelope_precision : MandaCall → CapabilitySpec
| tier ∈ {trivial, medium, complex} ∧ timeout ∈ {90s, 150s}
| trivial@90s = success ∧ medium@150s = success ∧ complex@90s = timeout ∧ complex@150s = success
| exec: reference/manda-reliability-envelope.md — state exact tuple, never compress

:: ceiling_diagnostic_before_iterating : V_meta_Goal → FeasibilityCheck
| before(iterate(V_meta)) . require(ceiling_computation(factors))
| ceiling < threshold ⇒ ¬reachable(criterion_1) without unfreeze(factor)
| exec: reference/v-meta-ceiling-diagnostic.md

:: floor_reset_or_throughput_decision : NewExperiment → DesignDecision
| inherit(σ_strict_floor) ⇒ decide(reset(0) ∨ throughput(sufficient_to_exceed_floor))
| exec: reference/sigma-inherited-floor-trap.md — never let this default silently

## Constraints

- delta_not_duplicate: never restate quay-native-methodology's content
  wholesale here; cite it. If a claim in this skill and that skill
  conflict, quay-native-methodology's source (experiment 1's own
  provenance/iterations) is authoritative for experiment-1-era facts;
  this skill is authoritative only for facts discovered in experiment 2.
- honest_inheritance: cite `experiments/quay-core-bootstrap/iterations/iteration-10.md`
  (the authoritative closing report) and the specific iteration file for
  any claim about what experiment 2 found — never assert from this
  skill's own prose alone.
- ¬imply_convergence: never state or imply experiment 2 formally
  converged. It did not (V_meta=0.1012, criterion 1 mathematically
  unreachable at V_meta_ceiling=0.26). It is HALT with practical
  convergence accepted, a distinct, weaker status explicitly
  distinguished in iteration-10.md §11e.
- reliability_envelope_precision: when citing the manda Agent reliability
  envelope, state the exact tier/timeout/result triple
  (trivial@90s=success, medium@150s=success, complex@90s=timeout,
  complex@150s=success) — do not compress this into "manda times out" or
  "manda always works"; both are false simplifications of the actual
  3-tier, timeout-dependent finding.
- ceiling_diagnostic_before_iterating: before running additional
  iterations toward a multiplicative V_meta threshold, compute the
  ceiling (product of each factor's structural maximum) first — see
  `reference/v-meta-ceiling-diagnostic.md`. If the ceiling is already
  below the threshold, further iteration cannot converge criterion 1
  without an explicit factor-unfreezing event; say so early, as iteration
  6 did here, rather than discovering it only at the formal halt point.
- floor_reset_or_throughput_decision: any experiment inheriting a prior
  experiment's σ_strict floor must explicitly decide, at design time, to
  either (a) reset the floor to 0 for the new experiment's own ledger, or
  (b) design for high native-task throughput sufficient to exceed the
  inherited floor — see `reference/sigma-inherited-floor-trap.md` for the
  arithmetic. Do not let this decision default silently.

## Validation

- V_instance_snapshot = 1.0 (experiment 2's own achieved ceiling on its 4
  Done-when clauses; do not claim this transfers to a new scope's own
  V_instance without new evidence)
- V_meta_snapshot honestly carried forward as 0.1012, ceiling 0.26 — not
  re-baselined upward
- every reference file here traceable to a specific iteration in
  `experiments/quay-core-bootstrap/iterations/` or a directive in
  `experiments/quay-core-bootstrap/directives/archive/`
- reference files total kept short — this is a delta skill, not a full
  methodology re-extraction

## Implementation

When a consuming scope (e.g. an experiment 3) invokes this skill:

1. Read `.claude/skills/quay-native-methodology/SKILL.md` and its
   `reference/` files first — this skill assumes that context.
2. Read `reference/transfer-test-outcome.md` for the full "what
   transferred, what didn't, what's genuinely new" accounting before
   assuming methodology transfer is either free or impossible.
3. Before relying on manda nested-subagent dispatch for anything,
   read `reference/manda-daemon-address-bug.md` (get the address right)
   and `reference/manda-reliability-envelope.md` (know which task shapes
   are safe to dispatch at which timeout).
4. Before writing a G3 audit dispatch step into a new iteration protocol,
   read `reference/g3-audit-dispatch-drift-case-study.md` — copy the
   corrected (DIR-003) design, not the pre-correction (iterations 3-5)
   design.
5. Before setting a V_meta formula/threshold for a new experiment, run
   the `reference/v-meta-ceiling-diagnostic.md` computation against the
   proposed factor set and any known-frozen factors.
6. Before inheriting a σ_strict floor from a prior experiment, read
   `reference/sigma-inherited-floor-trap.md` and make an explicit,
   recorded choice (reset vs. design-for-throughput).
7. For the specific findings recorded for "any experiment 3 design" by
   iteration-10.md's own closing section, see
   `reference/transfer-test-outcome.md`'s final section — these are
   quoted, not paraphrased, from the authoritative source.
