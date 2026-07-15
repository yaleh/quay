# Iteration 34 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Ran all tests/diffs/adversarial checks directly. Two-part scope: Part A — DIR-011's scope-triage handling (a directive targeting a file outside the quay repo); Part B — QN-045's engineering work and V-factor scoring.

**Verdict: PASS WITH CONCERNS** — DIR-011 handling judged clean; QN-045's engineering judged genuine; the `abi_symmetry` credit judged an overclaim, corrected post-hoc.

## Part A — DIR-011 scope-triage

1. **Scope determination — VERIFIED correct.** DIR-011's substantive ask (updating `parent-injection-preamble.md`) targets `/home/yale/work/manda`, a separate git repository outside `/home/yale/work/quay`'s tree and outside the protocol's own deliverable scope (quay-native/quay Core/quay-github). Confirmed via `git -C /home/yale/work/quay rev-parse --show-toplevel` and inspecting the directive's own referenced path.

2. **In-repo check (point 1) — VERIFIED.** Re-ran `grep -rn "mcp__manda__Agent" experiment/ packages/ docs/` independently: only match is inside the directive file itself. The claim that nothing in-repo needed correction is accurate.

3. **No out-of-scope edits — VERIFIED.** No file outside `/home/yale/work/quay` was touched; `git diff`/`git show` for iteration 34's commits show only in-repo paths.

4. **Resolution section — VERIFIED honest and complete.** `experiment/directives/archive/DIR-011-*.md`'s `## Resolution` section transparently explains the scope-boundary determination without silently dropping the directive or fabricating any credit for the triage itself. This is a model instance of the established DIR-011-handling pattern.

## Part B — QN-045 engineering and scoring

5. **Genuineness of the fix — VERIFIED.** Prior to the fix, `serve.js`'s `startServer()` read `provider.tasks_dir` directly while `bin/quay.js` and `mcp-server.js` used a separate local `resolveProviderEnv()` copy reading only `provider.env` — a real 3-way divergence. `packages/quay/src/provider-env.js` is a genuine new shared-extraction module; all three call sites now use it (confirmed via `grep -rn resolveProviderEnv packages/quay/`).

6. **New test genuineness — VERIFIED, adversarially confirmed.** `provider-env-symmetry.test.mjs` (3 assertions, matches claim). Reintroduced the old `serve.js` divergence (reverted to reading `provider.tasks_dir` directly) — the test correctly failed. Restored — test passed again, `git diff --quiet` confirmed clean. The claimed hang-bug fix (missing `server.client.close()`) was also independently reproduced: removing the `close()` call caused the test process to hang past a 15s timeout; restored, it completed normally.

7. **`abi_symmetry` credit — OVERCLAIM, confirmed and corrected.** Per protocol §5.1, `abi_symmetry` measures output schema/content equivalence across CLI/MCP(/Web-UI). QN-045 changes no output — `core-three-way-symmetry.test.mjs` (iteration 33) already proved, and continues unchanged to prove, all three surfaces' outputs equivalent; QN-045 only fixes upstream config/env-resolution plumbing that feeds that already-proven surface. Searched `provenance.md` for the closest precedent and found **QN-039 (iteration 29)** — which fixed and tested this *exact same* `resolveProviderEnv()` function and explicitly held `abi_symmetry` flat with directly analogous reasoning. Iteration 34 instead cited QN-007 (iteration 3), a much looser, early-stage match, and never mentions QN-039 at all. This is the same root-cause pattern as all four prior corrections this session: citing a plausible-sounding precedent without checking whether a more directly on-point one exists elsewhere in `provenance.md`.

8. **Corrected values — recomputed independently, matching the correction applied to `iteration-34.md` and `provenance.md`.** `abi_symmetry` = 0.95 (flat). V_instance = 0.69 × 0.95 × 0.76 × 0.96 = 0.4783 (flat, unchanged from iteration 33). ΔV_instance = 0.0000. V_meta unaffected (0.0973, all 4 factors flat, correctly reasoned). σ_strict = 37/44 = 0.8409 (Δσ = +0.0037), independently recomputed exact — task-count denominator confirmed via `ls tasks/QN-*.md | wc -l` = 44.

9. **Full regression suite — VERIFIED**, all test-bearing files pass, zero regressions, including the newly-updated `serve.test.mjs`/`cli.test.mjs` fixtures.

10. **Convergence criteria — correct after correction.** With ΔV_instance now 0.0000 (not +0.0047), criterion 5's literal wording (ΔV < 0.02) is satisfied for two consecutive iterations (33: +0.0119, 34: 0.0000), but V_instance (0.4783) and V_meta (0.0973) remain far below the 0.80 dual threshold and criteria 1-4 remain clearly unmet — overall NOT CONVERGED stands, correctly reasoned in the corrected iteration-34.md text.

11. **`git status --short` — VERIFIED clean** at iteration 34's own session end (prior to this correction), modulo the same pre-existing untracked file noted since iteration 31.

## Net assessment

DIR-011's scope-triage is handled cleanly — honest, transparent, no fabricated credit, no out-of-scope edits. QN-045's engineering (the shared `provider-env.js` extraction, the new symmetry test, the hang-bug fix) is genuine and adversarially verified. The one issue — crediting `abi_symmetry` +0.01 by citing a loose precedent (QN-007) while missing a directly on-point one (QN-039) that would have held it flat — is a real overclaim, now corrected: `abi_symmetry` = 0.95 (flat), V_instance = 0.4783 (flat), ΔV_instance = 0.0000. This is the fifth confirmed post-hoc correction this session, continuing to validate the standing discipline that a precedent must be verified as the *closest* match, not merely a plausible one, before any V-factor is credited.
