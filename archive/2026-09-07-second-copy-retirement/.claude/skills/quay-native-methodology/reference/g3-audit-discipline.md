# G3 out-of-band audit discipline

Source: protocol `docs/proposals/quay-bootstrap-experiment.md` §6 (guardrail
G3, G4), `experiments/quay-native-bootstrap/audits/iteration-N-independent-adjudicate.md` (one per
iteration from 0 through 88).

## The guardrail, verbatim intent

"The gate is both contestant and judge." `task check` is simultaneously a
quay-native product feature and the experiment's own convergence oracle.
If it is wrong, the feature and the stopping rule are wrong together,
self-certified. Mechanism: lift the "no self-certification / review
independence" principle to the meta level. Until the fixpoint reproduces,
"did quay-native build quay-native correctly?" is not decided by
quay-native's own gate alone — an out-of-band check (human review or an
independent `adjudicate`-style run) co-signs every σ lift.

Related guardrail G4 ("fixpoint ≠ correctness — Trusting Trust"): a
self-hosting system can reproduce itself bit-identically and still be
wrong, because both copies share the bug. σ = 1 and a stable Skill set
prove stability, not quality. Convergence must retain **both** the dual-V
thresholds **and** the out-of-band audit — never collapse to "it
reproduced itself."

## Mechanics as actually practiced

- Every iteration produces `experiments/quay-native-bootstrap/audits/iteration-N-independent-
  adjudicate.md`, dispatched separately by the top-level orchestrator via
  its own native Agent/Task tool invocation — **never self-performed by
  the iteration-executor session that did the work**, and never via manda
  (manda was tried and explicitly retired for this specific purpose per
  DIR-015 action 3, after manda-based audit dispatch failed to complete
  reliably — 7/7 timeouts as of iteration 68).
- The audit independently re-verifies the iteration's claimed evidence —
  e.g. iteration 88's audit was expected to redo branch enumeration and
  adversarial revert/restore checks itself, not simply read the
  iteration's own narration and agree with it.
- Audits render one of: PASS, or a specific finding requiring correction.
  A finding is not merely noted — the iteration/provenance record is
  actually corrected (see the concrete overclaim-and-revert precedent
  below), and the correction itself becomes part of the permanent record.

## Concrete evidence the discipline functions (not just theory)

Three separate overclaim attempts were made on V_meta factors across the
experiment's life — iterations 29, 59, and 61 — and **each was
independently caught and correctly reverted** by this audit mechanism.
This is the load-bearing evidence that the anti-inflation guardrails
(G1/G2/G3/G5) are functioning as designed, cited directly in the
V_meta stall analysis (`v-meta-stall-analysis.md`) as the reason repeated
negative search results across 6+ passes were trusted as a genuine
practical ceiling rather than dismissed as under-searching.

Example of a caught-and-reverted claim: iteration 61's `completeness`
credit for a documentation-only Skill-file update (feeding the
negative/error-path discipline back into `quay:execute`'s Method) was
reverted by its own audit — "documentation content alone, without any
runtime exercise of the new content within the same iteration, does not
by itself satisfy completeness's bar." This precedent was cited directly
by iteration 88 itself to correctly decline crediting a similar-looking
finding (Skill-file Gaps-section staleness re: manda dispatch) that
"looked promising" but did not meet the bar.

## Consuming-scope guidance

- Any new experiments/quay-native-bootstrap/scope inheriting this methodology must dispatch its
  own audits from a genuinely separate invocation (a background subagent
  or an independent human/adjudicate pass), never have the same session
  that did the work also grade it.
- Do not accept a self-reported "PASS" without checking that the audit
  actually re-derived evidence (re-ran a branch enumeration, an
  adversarial revert/restore, a primary-source code read) rather than
  re-stating the iteration's own claims.
- When a factor is reported "held flat for N iterations" as evidence of a
  ceiling, require the same standard this experiment used: multiple
  independently-motivated search passes converging on the same negative
  result, not merely "nobody looked this iteration."
- Treat any single-session self-certified convergence claim as
  presumptively invalid until an out-of-band audit co-signs it — this is
  the same posture that let this experiment's own owner correctly treat
  iteration 88 as "not converged" despite 3 consecutive iterations of
  V_instance movement.
