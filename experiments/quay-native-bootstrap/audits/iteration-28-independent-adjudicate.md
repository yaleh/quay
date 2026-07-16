# Iteration 28 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access and independently reproduced the wire-protocol test with a from-scratch probe script. Primary scrutiny: whether the claimed wire-protocol-level MCP verification is genuine external evidence, or dressed-up internal function calls.

**Verdict: PASS** (one cosmetic finding: test-file count claimed as 20, actual is 19 — immaterial to substance)

## Findings

1. **Wire-protocol verification — VERIFIED, genuine.** The auditor wrote its own probe script importing only `node:child_process` (zero project code), spawned `node packages/quay/bin/quay.js mcp` as a raw OS subprocess, and spoke JSON-RPC directly over stdio (`initialize`/`notifications/initialized`/`tools/list`/`tools/call`). Genuinely received real server info, real tool schemas, and real task data — matching the report's own transcript exactly (same server name, same tool set, same leading task id). This is externally-observed, protocol-level behavior, not internal calls dressed up as external ones.

2. **"Pending approval" claim — VERIFIED, genuine.** The `claude` binary is present in this environment; the auditor independently ran `claude mcp list`/`claude mcp get quay` and reproduced the exact claimed output, including the literal "Pending approval" string.

3. **Flat V-factor scoring — judged CORRECT.** Consistent with iteration 26's own precedent (which credited `skeleton` for *constructing* the new `quay mcp` binding, distinct from iteration 28's *registering/verifying an already-existing* binding). `completeness` held flat is consistent with ~20 iterations of unbroken convention for Gaps-section-only SKILL.md edits. No factor starved of due credit, none manufactured.

4. **Full regression suite — 19/19 pass, zero regressions.** Minor cosmetic inaccuracy: report claims "20 files," actual count is 19 (18 `*.test.mjs` + `abi-symmetry.mjs`). Does not affect substance — all tests genuinely pass.

5. **`git status --short` clean**, `.mcp.json` confirmed tracked and committed, not half-staged.

6. **Scope check — VERIFIED clean.** `git show c471f4e --stat` contains exactly the 5 claimed files.

7. **σ/V arithmetic — recomputed exactly.** 37 total tasks. σ_strict=30/37=0.8108, σ_inclusive=32/37=0.8649, σ_author_only=36/37=0.9730. V_instance=0.4595, V_meta=0.0973 — both correctly unchanged, matching exactly.

8. **`experiments/quay-native-bootstrap/directives/pending/` confirmed empty.**

9. **Honesty about residual gap — no overclaiming found.** The report precisely distinguishes "cannot be closed from this already-running session" from "unclosable by any means," matching the actual mechanics of MCP session-startup-time approval, independently reconfirmed by the auditor's own session also showing "Pending approval" for `quay`.

## Net assessment

The single most important claim — genuine external wire-protocol verification of `quay mcp` — reproduces faithfully under the auditor's own from-scratch probe script, distinct from and independent of any project code. The "Pending approval" claim, the flat V-factor scoring judgment, git scope/hygiene, and σ/V arithmetic all check out. The one minor finding (a test-file count off by one, 20 vs. 19) is cosmetic and does not affect the substance of any claim. No fabrication, no overclaiming, no double-counting.
