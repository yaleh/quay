# Iteration 33 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Ran all tests/diffs/adversarial checks directly. Main focus, per explicit dispatch instruction: scrutinize the novel double `skeleton`+`abi_symmetry` V-factor credit — this project's first simultaneous two-factor V_instance movement since iteration 8.

**Verdict: PASS WITH CONCERNS** — the double-factor credit itself is judged legitimate (not an iteration-25-style double-count); one purely descriptive overclaim was found and corrected.

## Findings

1. **Genuineness of new MCP tools and symmetry test — VERIFIED.** `action_list`/`action_run` confirmed genuinely new (+100 lines production code), mirroring existing tools' shape; `action_run` genuinely wired to DIR-009's mock-mode delivery, not live manda. Assertion counts independently re-verified: 11 new in `mcp-server.test.mjs`, 26 in `core-three-way-symmetry.test.mjs`, both matching claims exactly (via `grep`, not trusted estimation, per the iteration-31 miscount precedent). **Adversarial break performed**: a full-divergence mutation of the Web UI's rendered button label was correctly caught by the symmetry test; restored cleanly, zero residual diff. One minor, honestly-noted robustness gap: a weaker suffix-mutation slipped through one substring-matching assertion — a real test-quality nit, not a genuineness failure.

2. **Scope-fidelity — VERIFIED.** `task edit`/`task check` appear only in explanatory comments documenting their deliberate exclusion from the Web-UI leg; no assertion silently tests or silently skips checking their absence as a gap.

3. **Zero-Provider-diff claim — VERIFIED.** `git show 3f133bc --stat -- packages/quay-native packages/quay-github` empty.

4. **THE double `skeleton`+`abi_symmetry` credit — judged legitimate, not a double-count.** Independently re-derived precedent: QN-036/iteration 26 credited `skeleton` alone and explicitly *declined* to also credit `abi_symmetry`, reasoning that broadening the factor's Provider-CLI↔Provider-MCP scope was "out of scope for a single iteration to do unilaterally." That constraint was later resolved: `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` constraint 4(b) (ratified at iteration 29, four iterations before this one) explicitly pre-authorizes exactly this dual mapping — new Core capability code → `skeleton`; new Core-level CLI/MCP/Web-UI schema-symmetry proof (extending `abi-symmetry.mjs`'s discipline one layer up) → `abi_symmetry`. A scan of all prior iterations found zero simultaneous two-factor V_instance movements from iteration 9 through iteration 32 (24 consecutive iterations) — this is the first since the factors matured — but the crediting is grounded in a standing, previously-ratified policy, not invented ad hoc. Critically, roughly half of the new symmetry test's 26 assertions exercise `task_list`/`task_get` — MCP tools that already existed since iteration 26, entirely independent of this iteration's new tools — confirming the two credited facts (new tool code; new cross-binding equivalence proof) are genuinely separable evidence, not one event described twice (the iteration-25 `gate_correctness`/`reusability` pattern this project explicitly guards against).

5. **Magnitude check — individual +0.01/+0.01 sizes judged appropriately conservative** (smallest in `abi_symmetry`'s own diminishing historical sequence; matched to `skeleton`'s smaller "new mode/tools in existing link" precedent, not the larger "entirely new link" sizing). **However**, the report's claim that ΔV_instance=+0.0119 is "the largest V_instance movement since iteration 25 (in 8 iterations)" is **false** — independently re-tabulated, iteration 26's own ΔV_instance was +0.0134, larger. **Corrected** via strikethrough in `iteration-33.md` §10 and a new post-hoc correction section in `provenance.md`: the correct framing is "second-largest since iteration 25, largest since iteration 26." This does not change V_instance itself (0.4783, confirmed exact) nor the substantive criterion-5 NO verdict, which stands on its own merits.

6. **V_meta all 4 factors flat — VERIFIED correct** against §5.2 wording and precedent (completeness/effectiveness/reusability/validation).

7. **Full regression suite — VERIFIED**, 21 test-bearing files + `abi-symmetry.mjs`, all pass, zero regressions.

8. **σ/V arithmetic — recomputed exactly.** 43 total tasks. σ_strict=36/43=0.8372. V_instance=0.69×0.95×0.76×0.96=0.4783 (ΔV_instance=+0.0119, confirmed exact). V_meta=0.0973 (unchanged).

9. **`git status --short`, DIR-010 archival — VERIFIED**, full Resolution section addressing all 5 points. (Note: a new directive, DIR-011, appeared shortly after iteration 33's own commit — postdates this iteration entirely, does not contradict its claims, left for iteration 34.)

10. **Convergence criterion 5 honesty — judged correct in substance**, despite the magnitude-framing error in finding 5: scoring NO despite a literal numeric pass is directionally sound and non-self-serving; the underlying reasoning (a genuine double-factor movement of this evidentiary weight should not be waved through as plateau noise) holds without needing the superlative claim.

## Net assessment

Every mechanically-checkable claim — new tool genuineness, mock-mode wiring, assertion counts, scope-fidelity, zero-Provider-diff, the adversarially-verified symmetry test, full regression suite, and σ/V arithmetic — holds up exactly under independent, adversarial re-verification. The central self-flagged question (double V-factor credit) resolves in the report's favor: this is not an iteration-25-style double-count, but two genuinely separable, independently-evidenced facts, credited under a policy ratified four iterations earlier. The one confirmed issue — a factually false "largest in 8 iterations" superlative — is a descriptive overclaim, not a scoring error; corrected in-place per this project's established convention. V_instance (0.4783) and V_meta (0.0973) stand unchanged.
