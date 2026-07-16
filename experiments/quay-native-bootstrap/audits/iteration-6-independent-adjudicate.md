# Iteration 6 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, dispatched by the top-level orchestrator with zero prior context, explicitly instructed not to read the same-session self-check (`iteration-6-adjudicate.md`).

**Verdict: PASS-WITH-CONCERNS**

## Findings

1. **QN-012 compound-aware gate fix** — VERIFIED. Independently reconstructed the pre-fix `store.js` in a scratch worktree; confirmed `compound-gate.test.mjs` genuinely fails 9/18 against the old code and passes 18/18 against the fix (real TDD red/green, not narrated).
   - **Unaddressed limitation found**: `childrenStatus()` only checks one level (`child.status`), not recursively into a child's own children. A `done` child whose grandchild reverted would not be caught. Not mentioned in the iteration report. Likely acceptable under G5 walking-skeleton discipline, but should be tracked as a known gap.

2. **QN-015 CAS-write/TOCTOU fix** — VERIFIED. `ConflictError` + `expectedStatus` compare-inside-lock logic is real. The "two-process race" test genuinely spawns two separate `node` child processes (not two in-process calls). Report's own honesty caveat ("sequential, not simultaneous") is accurate, not overclaimed.
   - **Minor discrepancy**: report claims 11 assertions; actual is 12 (verified by running the test). Immaterial miscounting, not fabrication.

3. **Adversarial epic / `executeEpic` needs-human fallback** — VERIFIED as an honest negative result. The fallback branch exists in `skills/execute/SKILL.md` pseudocode; QN-015 passed cleanly on a genuinely hard, honestly-scoped task. Framing does not look manufactured either way.

4. **σ claims** — VERIFIED exactly. Recomputed independently from `provenance.md`'s raw per-task table: 12/15 = 0.800 (strict), 14/15 = 0.933 (author_only/inclusive). Arithmetic matches.

5. **Test suites** — ALL GREEN. `cas-write.test.mjs` (12 pass, not 11 as claimed — see #2), `compound-gate.test.mjs` (18/18), `gate-correctness.test.mjs` (13/13), `lock.test.mjs` (7/7), `abi-symmetry.mjs` (symmetric across all 4 surfaces), `pagination.test.mjs` (6/6), `view-model.test.mjs` (14/14).

6. **gate_correctness = 0.65 spot-check** — VERIFIED. The AC gate is still a checkbox-counting regex with no verification that checked boxes reflect real work — a structurally real, correctly-scoped-out residual gap, honestly named in the report.

## Net assessment
No fabricated claims. Two minor issues: (a) an undisclosed one-level-recursion limitation in the compound gate fix, (b) a trivial assertion-count discrepancy (11 vs 12). Both are minor and do not undermine the substance of iteration 6's claims. Carry item (a) forward as a known gap for a future iteration.
