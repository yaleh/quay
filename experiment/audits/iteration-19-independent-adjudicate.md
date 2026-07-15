# Iteration 19 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access, enabling genuine live reproduction.

**Verdict: PASS**

## Findings

1. **Compound/epic GitHub-task candidate confirmed absent.** Live `gh issue list --repo yaleh/quay` shows only 2 primitive issues (#3/#4) — no compound/epic-shaped issue exists to drive a new reusability increment from.

2. **`data.write` scope-symmetry claim independently reproduced live.** Ran the same CLI check against both `--provider native` and `--provider github`: identical `--status <s> is required (v1 supports status-only writes)` error surfaces in both cases, confirming no asymmetric gap remains to close.

3. **Third-Provider-out-of-scope claim confirmed against primary source.** Protocol §10 decision 4's verbatim text: "V_meta transfer target — GitHub Provider only (v1). No third toy backend... out of scope until the ABI is declared stable." Iteration 19's framing matches this exactly.

4. **`validation` component definition confirmed against protocol §5.2's table**: "Corroborated by out-of-band audit (G3)" — not additional transfer targets or usage evidence. This resolves the ambiguity iteration 19 flagged and matches the interpretation iterations have consistently applied.

5. **Zero code changed this iteration, confirmed.** `git show --stat 8155b1a` touches only `iteration-19.md` and `provenance.md` — no source files.

6. **Regression suite independently re-run: 12/12 pass**, including `abi-symmetry.mjs`, confirming all four surfaces remain symmetric.

7. **σ/V arithmetic recomputed exactly.** 28 total task files confirmed via count. σ_strict = 21/28 = 0.75, σ_inclusive = 23/28 = 0.8214285714, both correct. All 8 V-component factors byte-identical between iteration-18.md and iteration-19.md (V_instance=0.3976, V_meta=0.0644 — both flat, consistent with zero code movement).

8. **`experiment/directives/pending/` confirmed empty.**

9. **Independent diligence check**: the auditor separately attempted to surface additional candidates the report might have missed (multi-repo/org-level Providers, richer `gh issue` search passthrough, CI/webhook triggering) and concluded none were materially stronger than what iteration 19 already considered — the "decline to build" conclusion is judged as genuine diligence, not a lazy punt.

## Net assessment
All nine primary-evidence checks and the pending-directives check corroborate the iteration-19 report's claims exactly, with no discrepancies found. Iteration 19's honest "no further tractable reusability gap" finding, after a genuinely fresh 3-candidate search, holds up under independent live reproduction and independent diligence. This strengthens the case that the experiment may be approaching a second, more serious candidacy for convergence criterion 5 (diminishing returns) — a question iteration 19 itself correctly flagged as open for iteration 20 onward, rather than resolving unilaterally in either direction.
