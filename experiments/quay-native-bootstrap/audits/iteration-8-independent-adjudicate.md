# Iteration 8 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context, instructed not to read the same-session self-check.

**Verdict: PASS-WITH-CONCERNS**

## Findings

1. **V_meta formula correction** — largely verified.
   - Confirmed protocol §5.2 literally specifies a product, not a mean.
   - Confirmed `provenance.md` now has a recomputed historical table (iterations 0-7), both mean and product columns.
   - Spot-checked iterations 3, 5, 7 by hand-recomputing from each iteration's own originally-reported component scores: all three match provenance.md's corrected values exactly (iter3=0.0000, iter5=0.0358, iter7=0.0475).
   - **Defect found**: iteration 8's own Executive Summary states V_meta = 0.72×0.20×0.55×0.62 = 0.0491, using the PREVIOUS iteration's completeness (0.72) instead of this iteration's own incremented value (0.73). §8 of the same report correctly computes 0.73×0.20×0.55×0.62=0.0498. The two most prominent numbers in the document contradict each other. Does not change the qualitative story (both ≈0.05) and is not evidence of deliberate softening, but is a genuine uncaught internal inconsistency — ironic given the report's central theme is catching a prior arithmetic sloppiness.

2. **QN-019 checked-state gate fix** — VERIFIED via direct code execution against both old and new `store.js` (old passes an all-unchecked task, new correctly fails it with `0/2 AC checkboxes checked`). TDD red/green reproduced exactly (4 failures pre-fix, matching report). Minor: report says "13/13" for `gate-checked-state.test.mjs`; file actually has 14 passing assertions — cosmetic.

3. **QN-020/QN-021 / executeEpic needs-human** — VERIFIED. Frontmatter statuses confirmed directly (QN-019 done, QN-020 needs-human, QN-021 todo). Task count = 20 exactly, numbering gap at QN-018 confirmed. σ=14/20=0.700 reproduced from raw ledger. Live `store.check()` re-run reproduces the exact reported JSON for both tasks. The "partially proven" claim about executeEpic's needs-human path is honest — SKILL.md explicitly names the still-unexercised sub-case (all children done but integration-level accept itself fails).

4. **Test suites** — all green, no regressions vs iteration 7's audit baseline; one new suite (gate-checked-state, 14/14) fully passing.

5. **Honesty of framing** — no burying detected. The V_meta drop is stated prominently and unambiguously as "an order of magnitude lower"; the old mean-equivalent number appears exactly once, parenthetically, explicitly marked as not used for convergence.

## Net assessment
No fabrication. The correction of the V_meta formula from mean to the protocol's actual product, with full historical recomputation, is real and transparently reported. Two minor, non-material self-verification slips found (the Executive-Summary-vs-§8 arithmetic mismatch, and a trivial test-count miscount) — both should be fixed in iteration 9's report/provenance pass but neither undermines the substance of iteration 8's work.
