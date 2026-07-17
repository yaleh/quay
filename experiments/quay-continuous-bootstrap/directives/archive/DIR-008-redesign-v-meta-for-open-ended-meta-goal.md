# DIR-008

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Redesign V_meta's four factors + aggregation to match experiment 4's open-ended meta goal

## Finding

Experiment 4 redesigned `V_instance` for open-ended work (durable
dimensions, rescored against a moving gap list, `ΔV` as the primary
signal, cumulative-gaps-closed counter — proposal §4.2–4.4) but
deliberately left `V_meta` **unchanged** ("`V_meta` is **not**
redesigned" — proposal §1, §2). This asymmetry is now the core problem
with the meta-layer metric:

1. **The meta goal changed; V_meta did not.** Experiments 1–3 asked a
   *bounded* meta question ("does quay-native build quay-native", "does
   the methodology transfer to a second Provider unmodified"). Experiment
   4's actual meta goal (proposal §6) is a *different, open-ended* one:
   "does the inherited methodology drive open-ended, self-directed,
   continuously-rescoped work?" V_meta's four factors were designed for
   the old question and structurally cannot reflect progress on the new
   one.

2. **Two of the four factors are frozen because they measure
   already-answered, one-time events, and their product caps the whole
   score.**
   - `effectiveness` (0.26): defined as a *speedup ratio* of building
     feature N+1 via the tool vs. seed/ad-hoc, measured on the marginal
     increment. It froze at iteration 23 of experiment 1 and has not
     moved across ~65+ subsequent iterations. Its value is not even a
     coherent speedup measurement: every honest timing comparison showed
     native *slower* (parity-to-4.5%-slower at matched scope); the 0.26 is
     the un-reversed residue of iterations 21–22 crediting *measurement-
     fairness improvements* as if they were speedups — a scoring artifact
     the auditor caught and the experiment then froze rather than reverted
     to ~0. It measures a one-time bootstrap event that is long past.
   - `reusability` (0.79): defined as transfer to a **second Provider
     (GitHub) unmodified** — a one-time transfer completed back in
     experiment 1. Frozen since iteration 25.
   - Because `V_meta = completeness × effectiveness × reusability ×
     validation` is multiplicative, these frozen factors impose an
     arithmetic ceiling `V_meta_ceiling = 0.26 < 0.80` (the convergence
     threshold), making meta-convergence unreachable by construction. The
     experiment has effectively routed around this (declaring the ceiling
     out-of-scope, inventing PAUSE) rather than fixing the metric.

3. **The genuinely important, non-frozen meta question is already named
   in the inherited stall analysis but is not a scored factor.**
   `quay-native-methodology/reference/v-meta-stall-analysis.md` records
   (iterations 86–88) that late-experiment `V_instance` gains came
   *entirely through ad-hoc engineering, not through the methodology
   (`quay:author`/`quay:execute`) being the active driver*, and flags
   this as "the central open question, not a footnote." That question —
   **how much of each iteration's real improvement is actually driven by
   the methodology vs. bypassed by ad-hoc work** — is exactly what an
   open-ended meta metric should measure, moves every iteration, and is
   not currently scored anywhere.

## Requested action

A future experiment-4 iteration (once resumed) should **formally adopt a
redesigned `V_meta`** and **re-baseline** it, following the same
open-ended contract experiment 4 already adopted for `V_instance`
(proposal §4.2–4.4). Specifically:

1. **Redefine the four factors** so each corresponds to a *renewable*
   question that can genuinely move every iteration in open-ended work
   (not a one-time event frozen into a perpetual formula):
   - **`methodology_leverage`** (replaces `effectiveness`): the fraction
     of this iteration's delivered improvement that was driven by the
     methodology loop (`quay:author`/`quay:execute`, directive lifecycle,
     the simulated-user → priority feedback loop) rather than by ad-hoc
     engineering that bypassed it. Attribution is per closed gap,
     recorded at closure time, and subject to G3 audit. This directly
     scores the stall-analysis "central open question."
   - **`strategy_completeness`** (redefines `completeness`): whether the
     Skill set covers *strategy formation* — deciding what to work on
     next under an open-ended objective, and encoding the "iteration
     feedback → next-priority" loop — not merely execution of a known
     objective (the new completeness demand proposal §6 itself names).
   - **`transfer_breadth`** (redefines `reusability`): whether the
     methodology transfers, unmodified, across the *surface types* quay
     now spans (CLI, MCP, Web UI, packaging/distribution, docs) — a live,
     non-frozen transfer question — instead of the one-time "second
     Provider" transfer already completed in experiment 1.
   - **`validation`** (unchanged): σ + independent out-of-band G3 audit.
2. **Make `ΔV_meta` the primary signal**, with a per-factor cumulative
   counter alongside — mirroring `V_instance`'s §4.3 contract — rather
   than treating a multiplicative *level* as comparable across a
   re-baseline. If a product level is retained for continuity, no factor
   may be one that is structurally frozen by an already-past event.
3. **Preserve G2 and G3 unchanged.** The anti-inflation core — "measure
   the marginal increment, never the cumulative artifact" (G2) — and the
   independent out-of-band audit (G3) are retained verbatim; the redesign
   must not weaken them. In particular `methodology_leverage` must be
   honest attribution (which may *lower* V_meta), not "credit for having
   invoked a Skill at all."
4. **Re-baseline explicitly and non-retroactively.** Record the old
   formula, the new formula, and both values at the switch point; declare
   `ΔV_meta` across the switch boundary non-comparable; do not
   retroactively rescore history. (Same discipline as experiment 3's
   σ-reset and experiment 4's §4.3 gap-list snapshotting.)
5. **This is a meta-layer metric change, so it must be adopted under the
   independence rule discussed with the human**: it is human-authored
   here (this directive), and the adopting iteration must additionally
   subject the *change itself* (not just that iteration's development
   work) to an independent G3 audit checking that the redesign measures
   something more real, not merely something looser — before the
   re-baselined numbers are trusted.

Note: the companion governance question (a general, repeatable procedure
for amending goals/metrics mid-experiment — tiers of mutability, the
"constitutional directive" gate, legitimacy tests) is being discussed
separately and may become its own directive; this DIR-008 is scoped to
the concrete V_meta redesign + re-baseline only.

## Resolution

**Status:** APPLIED — Iteration 14 (2026-07-17)
**Applied in:** QX-050
**G3 co-sign:** PASS-WITH-NOTES (iteration-14-adjudicate.md)

New formula: methodology_leverage × strategy_completeness × transfer_breadth × validation
Re-baseline: 0.40 × 0.83 × 0.75 × 0.962 = 0.240 (FINAL, post-Persona-C correction; transfer_breadth revised 0.80 → 0.75 after synthesis review found docs coverage "thin and irregular" inconsistent with "covered" scoring)
VMETAFORMULA.md created with full rubric and history.
ITERATION-PROMPTS.md updated (header + operational body; META-001 body inconsistency fixed in synthesis).
Non-comparability statement recorded.
