# Iteration 22 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access and ran all tests/scripts directly.

**Verdict: PASS** (with two minor judgment-call notes, consistent with prior audits at iterations 20/21)

## Findings

1. **`config.test.mjs` genuinely demonstrates its claims, confirmed by direct execution and independent reproduction of the break/restore cycle.** Ran the test: 16/16 pass, exercising `findConfig()`'s upward directory search (found + not-found cases), `loadConfig()`'s happy/error paths, and all of `activeProvider()`'s branches against the real, unmodified `config.js`. The auditor independently reproduced the adversarial break/restore cycle by inverting `activeProvider`'s enabled-lookup predicate, confirming exactly 3 failures as claimed, then restoring and confirming a byte-identical diff and 16/16 pass again. `git status --short` was confirmed clean both before and after this independent reproduction — directly confirming iteration 22 addressed iteration 21's audit finding about leftover working-tree residue.

2. **Zero source-code changes confirmed.** `git show --stat 8ffa1ef` touches exactly 4 files (iteration-22.md, provenance.md, config.test.mjs, QN-032.md) — no file under `packages/*/src/` appears.

3. **Effectiveness comparison: real timestamps, materially fairer scope-match than iteration 21's, but the +0.02 credit remains a soft judgment call.** Both timing logs read and confirmed real/internally consistent. The auditor's independent assessment: QN-032 (pure test-addition, zero source changes) is closer in gestalt to QN-006's stage-0 scope than iteration 21's QN-031 comparison was, but not perfectly matched — QN-006 involved implementing new locking behavior under first-ever-session conditions, while QN-032 benefited from an already-warmed, conventionalized pipeline. The auditor judges the +0.02 credit (smaller than iteration 21's +0.04) as conservative and defensible, but flags an ongoing watch-item: `effectiveness`'s incremental credits (0→0.24→0.26) are being awarded for progressively fairer *measurement methodology*, not for a demonstrated speedup — the raw numbers across both iterations 21 and 22 still show native as slower, not faster. The report is scrupulously explicit about this distinction, which the auditor credits as honest, not inflated.

4. **Reusability re-check confirmed accurate** — still exactly 2 primitive issues, 4th consecutive iteration of no change.

5. **Regression suite confirmed 16/16 green** (config.test.mjs is new; helper scripts correctly excluded per established convention). `abi-symmetry.mjs` confirms all four surfaces symmetric.

6. **σ/V arithmetic confirmed exactly.** 31 task files. σ_strict=24/31=0.7742, σ_inclusive=26/31=0.8387, σ_author_only=30/31=0.9677. V_instance=0.63×0.94×0.76×0.94=0.4231, V_meta=0.74×0.26×0.68×0.64=0.0837 — all recompute exactly to 4 decimal places.

7. **Scope confirmed clean**, timing logs correctly gitignored and absent from the commit.

8. **Working-tree hygiene confirmed clean** both before and after the auditor's own reproduction — directly closing the loop on iteration 21's audit finding.

9. **Convergence criterion 5's reasoning confirmed a faithful continuation** of the standard established at iteration 17 and applied identically at iterations 20, 21, and now 22 — not a convenient reinterpretation.

10. **`experiments/quay-native-bootstrap/directives/pending/` confirmed empty.**

11. **Independent diligence check**: `validation` correctly stays flat per §5.2's discipline; no evidence of retrospective task-selection bias (the gap-finding narrative for QN-032 is genuine and independently reproducible); no self-dispatch anti-pattern recurrence. The auditor's standing watch-item: future audits should keep pressing on whether "credit for measuring more fairly" on the `effectiveness` factor risks being conflated with actual demonstrated native-speedup evidence if it continues to accrue small increments without ever crossing into a real speedup.

## Net assessment
All primary claims independently verified against primary evidence — direct test execution, independent break/restore reproduction, live GitHub re-check, git diff inspection, and recomputed arithmetic. Working-tree hygiene is confirmed clean, directly closing the gap iteration 21's own audit flagged. The one standing area for ongoing scrutiny — not a failure, but a watch-item the report itself honestly surfaces — is whether `effectiveness`'s incremental credits for fairer comparison methodology could, over further iterations, be mistaken for genuine demonstrated speedup evidence, when the raw numbers so far still show native as slower. Nothing rises to the level of fabrication, undisclosed scope, or metric inflation warranting a FAIL.
