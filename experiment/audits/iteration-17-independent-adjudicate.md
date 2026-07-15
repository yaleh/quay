# Iteration 17 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had working `gh` CLI auth and network access, enabling genuine live reproduction rather than plausibility assessment alone.

**Verdict: PASS**

## Findings

1. **Pre-fix state confirmed genuine.** `git show 1f3e27d^:packages/quay-github/provider.yml` shows `gate: false`; pre-fix `github-client.js`/`mcp-server.js` had zero matches for `checkGate`/`task_check`. The capability gap was real, not staged.

2. **Implementation confirmed as a faithful, non-superficial port**, not a rubber stamp. Direct comparison of `store.js#check()` against the new `checkGate()`: identical `MIN_SECTION_CHARS=40` floor, identical checkbox regexes, and correct reuse of native's own QN-005 fix (the `(?![\s\S])` end-of-string lookahead, replacing the invalid `\Z` JS anchor) — a subtle detail that would be easy to silently reintroduce, and wasn't.

3. **Tests confirmed: 13/13 files green**, including `gate.test.mjs` (19 assertions, independently re-run). `store.js` confirmed byte-for-byte untouched via empty `git diff`.

4. **Live-verification claim independently reproduced with real network/GitHub access** — not merely trusted. Fetched real issues gh-3/gh-4 via `gh issue view`, ran `quay-github task check` and `quay task check --provider github` directly, confirmed byte-identical JSON output matching the report's quoted transcript. Confirmed zero `provider ===` branching in Core's passthrough. Genuine, reproduced evidence.

5. **σ arithmetic confirmed.** 27 task files (23 done, 3 needs-human, 1 todo). 20/27=0.7407, 22/27=0.8148, both recompute correctly.

6. **V_instance/V_meta arithmetic confirmed exactly.** 0.60×0.94×0.75×0.94=0.3976; 0.74×0.20×0.65×0.64=0.0616. The reasoning for V_instance staying flat is judged sound, not evasive: protocol §5.1 defines V_instance's components against quay-native itself, while `reusability` is explicitly V_meta-only per §5.2 and G2's held-out-transfer discipline. Since `store.js`/native's Skills were untouched, V_instance correctly stays flat by the protocol's own definitions — not a loophole.

7. **Scope confirmed clean** — exactly the 9 claimed files changed, nothing unexpected.

8. **DIR-005 confirmed as the sole pending directive**, pre-existing and correctly noted as unrelated to iteration 17's own scope.

## Net assessment
No discrepancies found at any verification point, including claims independently reproduced against the real live GitHub repo (not just static code review). QN-028 is a genuine, well-executed port of quay-native's gate semantics onto GitHub issues, correctly scoped (G5), and honestly measured — the first real V_meta movement in 4 iterations, with V_instance's flatness correctly explained by the protocol's own component definitions rather than glossed over.
