# Iteration 7 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context, instructed not to read the same-session self-check.

**Verdict: PASS-WITH-CONCERNS**

## Findings

1. **QN-016 recursive compound-gate fix** — VERIFIED TRUE. Independently reconstructed old vs new `childrenStatus()` via `git show`: genuine 5/13 → 13/13 red/green. Constructed additional adversarial cases beyond the shipped fixture (5-level nesting, dangling grandchild, 3-hop cycle, diamond sharing, duplicate ids, self-referential child) — all handled correctly, none broke it.

2. **QN-017 needs-human exercise** — VERIFIED TRUE. `tasks/QN-017.md` frontmatter genuinely `status: needs-human`. Re-ran `quay-native task check QN-017 --json` directly, reproduced the exact reported gate failure. This is a genuine mechanical gate failure (unmet AC precondition — no subagent-dispatch primitive exists), not a hand-set status field. Noted one methodological wrinkle: the AC's self-referential design (an item requiring quoting the gate's own future output) is unusual but not dishonest — the timeline across provenance.md/iteration-7.md is internally consistent.

3. **σ arithmetic** — VERIFIED CORRECT. 17 task files confirmed; 13/17=0.765, 16/17=0.941 match exactly. The σ decrease from 0.800→0.765 is the honest, correct mechanical consequence of the strict formula (QN-017 used native tooling throughout but didn't reach `done`) — not rationalization.

4. **gate_correctness=0.70 evidence** — VERIFIED REAL, same red/green reconstruction as #1.

5. **Test suites** — ALL GREEN, all counts match iteration 6's audit baseline, zero regressions.

6. **Iteration 6's two named minor issues** — childrenStatus one-level limitation genuinely fixed; cas-write.test.mjs discrepancy traced to iteration 6's report text only (test file itself always had 12 assertions), correctly left untouched since untouched by this iteration's work.

## Material systemic concern (why PASS-WITH-CONCERNS, not PASS)

**V_meta has been computed as a MEAN, not the PRODUCT the protocol document specifies, since iteration 1.** `docs/proposal/quay-bootstrap-experiment.md` §5.2 line 129 explicitly states:

```
V_meta = completeness × effectiveness × reusability × validation
```

— a product, mirroring V_instance's own product formula (which iteration 7 correctly applies: 0.60×0.90×0.70×0.90=0.3402). But every iteration's V_meta has instead been `(completeness + effectiveness + reusability + validation) / 4`. Iteration 7 computed `(0.72+0.20+0.55+0.60)/4 = 0.5175`. Under the protocol's actual product formula: `0.72×0.20×0.55×0.60 ≈ 0.0475` — an order of magnitude lower, materially relevant to the ≥0.80 dual-threshold convergence criterion.

This was silently substituted starting iteration 1 without ever amending the source protocol document. It is not a fabrication introduced by iteration 7 (inherited, applied consistently, arithmetic is internally honest given the substituted formula) — but it means the entire experiment's V_meta trend line has been measuring something structurally different from what the governing protocol specifies, since the beginning.

**This needs to be resolved in iteration 8**: either (a) correct the formula to the protocol's product going forward and recompute the historical V_meta series for transparency, or (b) formally amend the protocol document to adopt the mean (with an explicit rationale for why a product is too punishing/unrealistic for 4 independent sub-scores — a common critique of multiplicative composite metrics). Silently continuing either way without addressing this discrepancy would compound a measurement-integrity problem across further iterations.
