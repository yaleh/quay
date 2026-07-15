# Iteration 16 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context.

**Verdict: PASS**

## Findings

1. **Backlog/σ arithmetic confirmed.** 22 done, 3 needs-human, 1 todo = 26. σ_strict=19/26=0.7308, σ_inclusive=21/26=0.8077.

2. **V-component values confirmed byte-identical to iteration 15** (`diff iteration-15.md iteration-16.md`), genuinely flat not merely asserted. Recomputed: 0.60×0.94×0.75×0.94=0.3976; 0.74×0.20×0.60×0.64=0.0568. Both match protocol §5.1/§5.2 formulas.

3. **Scope and regression suite confirmed.** `git diff --stat` on `092e988`: exactly `iteration-16.md` and `provenance.md` touched, 0 deletions, no code changes (consistent with "no new task authored" claim). Full suite independently re-run: 12/12 green (11 `.test.mjs` files + `abi-symmetry.mjs`, a non-standard-suffixed script correctly included per established convention).

4. **Dispatch-vs-Agent contract-level claim verified against actual tool schemas.** `Dispatch`'s own description confirms it requires an already-live claimer (errors without an explicit `pool:true` opt-in "because... the shared pending pool usually has NO subscriber"); `Agent`'s description confirms a synchronous fresh-context spawn via `agent.spawn`. The report's characterization is an accurate reading, not an overreach.

5. **Declining to credit iteration 15's audit toward this iteration's own `validation` score confirmed as genuine, consistent precedent** — iterations 13 and 14 both state near-identical language ("movement on this factor is left for the genuinely independent audit to decide, per the same discipline iterations 11-12 applied"). Not an invented rationalization.

6. **Convergence criterion 5's threshold confirmed genuinely pre-stated, not post-hoc.** Iteration 15's own text (lines ~553-554, ~623-624) states "one more fully-flat iteration with no new angle" / "a third consecutive flat iteration... is the concrete threshold." Iteration 16's claim that this now fires is a faithful application. The claim that overall §7 convergence remains NO (criteria 1-3 unmet, V_meta an order of magnitude below 0.80) is internally consistent with the protocol's all-criteria-must-hold structure.

7. **`experiment/directives/pending/` confirmed empty.**

## Net assessment
No discrepancies found. All quantitative claims independently reproduced from primary evidence; the contract-level tool-schema claim and the cross-iteration precedent claim both check out against actual primary sources (tool schemas, prior iteration text) rather than being taken on faith. Iteration 16's practical-convergence question — whether to author quay-github's gate/skill as the experiment's real remaining V-moving work, or declare practical convergence given the backlog exhaustion — is a genuine, well-reasoned judgment call correctly surfaced rather than silently resolved either way.
