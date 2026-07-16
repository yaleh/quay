# Iteration 29 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access and ran all tests/scripts directly. Special scrutiny on the `completeness` V_meta credit (first V_meta movement claimed since iteration 25's overclaim) and DIR-008's mid-iteration timing honesty.

**Verdict: PASS WITH CONCERNS** — all mechanical/factual claims independently reproduce exactly; the `completeness` +0.01 credit for QN-040 is a genuine, small overclaim that departs from a consistently-applied 9+ iteration precedent (including an exact on-point iteration-10 precedent for revising this very file).

## Findings

1. **QN-039's two new tests — VERIFIED, genuine.** `resolveProviderEnv()`'s passthrough branch and `serve`'s CLI-dispatch branch confirmed to exist exactly as described; both were previously untested (only QN-033 had touched this test file before). Independently ran the test file: both new tests pass, one making a real live `gh`-authenticated call against `yaleh/quay`, one spawning a real subprocess and polling a real HTTP port. Independently reproduced test-authoring bug #1 (`--provider github` before `task list` silently failing) as real, not fabricated. Zero production-code diff confirmed.

2. **DIR-008 timing claim — VERIFIED, genuine.** `c0829d5` (adding DIR-008) is timestamped 2026-07-15T14:39:48Z; the iteration's own precondition check (14:27:49) genuinely preceded it. Not fabricated.

3. **"Core-scope work" section / DIR-008 Resolution — VERIFIED faithful and complete.** Diffed against DIR-008's original text; all four constraints present, none dropped, explicit resolutions given for both open sub-questions as requested. Resolution section accurately represents what was done.

4. **`completeness` +0.01 credit — NOT LEGITIMATE, the report's weakest point.** Protocol §5.2 scopes `completeness` to `quay:author`/`quay:execute`'s own documented methodology (SKILL.md), not `ITERATION-PROMPTS.md` (a distinct, experiment-process-driving artifact per §8/§10). Iterations 20-28 consistently held `completeness` flat for anything outside SKILL.md Method-step content — Gaps-history narrative entries were explicitly declined credit for exactly this reason (iterations 26-28). Iteration 10 set a directly on-point precedent: it also revised `ITERATION-PROMPTS.md` and explicitly held `completeness` flat ("No new Skill or gate-mechanism gap was closed this iteration"). Iteration 29's rationale contradicts this established convention and precedent without adequately distinguishing it — structurally similar in kind (though far smaller in magnitude) to the iteration-25 `gate_correctness` overclaim this project explicitly works to avoid.

5. **Convergence criterion 5 honesty — VERIFIED honest and correctly reasoned.** ΔV_instance = 0.0000, ΔV_meta = +0.0013 (both < 0.02) this iteration; iteration 28 also both 0.0000. Genuinely the first 2-consecutive-iteration run satisfying criterion 5's literal wording. The report correctly flags this as literally satisfied while explicitly and correctly arguing it doesn't meaningfully indicate approaching convergence. No overclaim or burial.

6. **Full regression suite — VERIFIED, 20 test-bearing files (19 `*.test.mjs` + `abi-symmetry.mjs`), all pass, zero regressions.**

7. **`git status --short` clean** — only the pre-existing, correctly-untracked discussion doc remains.

8. **Scope check — VERIFIED clean.** `git show 321426c --stat` contains exactly the 7 claimed files, no stray production-code diff.

9. **σ/V arithmetic — recomputed exactly.** 39 total tasks. σ_strict=32/39=0.8205 (exact). V_instance=0.4595 (unchanged, correct). V_meta as originally scored = 0.0986 (arithmetically correct given the inputs, but see finding 4 on the input's legitimacy).

10. **`experiments/quay-native-bootstrap/directives/pending/` confirmed empty**; DIR-008 correctly archived.

## Net assessment

All factual/mechanical claims — test genuineness, bug reproduction, DIR-008 timing, section faithfulness, regression suite, scope, and arithmetic — check out under independent verification. The one substantive issue is the `completeness` +0.01 credit, which departs from a clean, consistently-applied precedent (including an exact on-point iteration-10 precedent for revising this very file) without adequate justification. This does not rise to fabrication or bad faith — the report transparently flagged this exact point for audit scrutiny in its own §9 — but it should not stand as scored. Corrected: `completeness` remains 0.74 (flat), V_meta = 0.0973 (unchanged from iteration 28, ΔV_meta = 0.0000). This does not affect criterion 5's literal-satisfaction finding (ΔV_meta = 0.0000 either way, still < 0.02), only the "first nonzero V_meta movement since iteration 25" framing, which is retracted.
