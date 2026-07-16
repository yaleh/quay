# Iteration 26 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context. Had `gh` CLI/network access and ran all tests/scripts and live GitHub round-trips directly. Special scrutiny applied to whether iteration 26 genuinely internalized iteration 25's post-hoc `gate_correctness`/`reusability` double-counting correction, rather than merely paying lip service to it.

**Verdict: PASS**

## Findings

1. **`packages/quay/src/mcp-server.js` genuine implementation — VERIFIED.** Confirmed direct use of `McpServer`/`StdioServerTransport` (same SDK as `quay-native`/`quay-github`'s own server files), and confirmed `provider-client.js#connectProvider()` is reused **unmodified** — `git show 355e06f -- packages/quay/src/provider-client.js` is an empty diff. `bin/quay.js`'s diff adds exactly the claimed `mcp` dispatch branch.

2. **`mcp-server.test.mjs` — VERIFIED, genuine multi-Provider exercise.** Independently run: 13/13 assertions pass. Confirmed it spawns two independently-seeded native stores as two distinct Provider ids (real isolated fixture directories, not one store masquerading as two), and genuinely checks default-Provider resolution, explicit `provider` routing, negative cross-Provider-leakage in both directions, byte-identical proxy-vs-direct comparisons, and both error paths.

3. **Live GitHub claim — SUBSTANTIATED and INDEPENDENTLY REPRODUCED.** The real `gh-7` fixture confirmed live in `yaleh/quay`. `.quay/config.yml`'s `github.enabled` confirmed `false` and `git diff` empty at audit time (genuinely restored). The auditor independently flipped it to `true`, ran a real MCP client through `quay mcp` against the live repo, confirmed `task_check(gh-7)` via proxy vs. direct `quay-github mcp` is byte-identical, then restored the config file and re-confirmed a clean diff.

4. **Byte-identical proxy-vs-direct (local native) — INDEPENDENTLY REPRODUCED** via the auditor's own script comparing `quay-native mcp` direct vs. `quay mcp` fanout for `taskList`/`taskGet`/`taskCheck`.

5. **Full regression suite — ALL PASS, ZERO REGRESSIONS.** All 19 test files (8 quay-native + 6 quay-github + 5 quay, including the new file) exit 0; subprocess-helper scripts correctly excluded per established convention. `abi-symmetry.mjs` re-confirms "ALL FOUR SURFACES SYMMETRIC."

6. **Score double-counting check (highest priority) — PASS, lesson genuinely internalized.** `skeleton` (+0.02) is legitimate: the protocol's own definition names `mcp` as a v0-loop stage, and this is its first Core-level (not Provider-level) instance, with zero diff to either Provider package. `abi_symmetry`, `gate_correctness`, and `reusability` are all correctly held flat, each with a diff-grounded rationale distinguishing this iteration's Core-side transport work from Provider-side conformance/transfer work — explicitly citing and applying the iteration-25 correction rather than restating it superficially. One cosmetic nit: the archived DIR-007's `## Resolution` section (added by the separate hygiene-fix commit) loosely echoes the *directive's own original* wording suggesting `reusability` should move, which superficially conflicts with iteration-26.md's own carefully-reasoned decision to hold it flat — likely an uncritical restatement of the original ask rather than a competing claim, and `provenance.md`/`iteration-26.md` remain the authoritative, internally-consistent scoring record. Worth a lightweight future cleanup, not a scoring fault.

7. **Scope check — VERIFIED clean.** `git show 355e06f --stat` and `git show a97e29a --stat` each contain exactly the files claimed, no stray unrelated changes.

8. **σ/V arithmetic — RECOMPUTED, exact match.** 35 total tasks (QN-001..QN-036 minus never-allocated QN-018). σ_strict 28/35=0.8000, σ_inclusive 30/35, σ_author_only 34/35. V_instance = 0.67×0.94×0.76×0.94 = 0.4499 (Δ+0.0134). V_meta = 0.74×0.26×0.79×0.64 = 0.0973 (unchanged) — both recompute exactly.

9. **`git status --short` confirmed clean** at audit time.

10. **`experiments/quay-native-bootstrap/directives/pending/` confirmed empty** — no new directive has appeared since DIR-007's archival.

## Net assessment

Every mechanically-checkable claim in iteration 26 — the MCP server's genuine dual server/client role, unmodified reuse of `provider-client.js`, the committed test's genuine multi-Provider assertions, the live byte-identical proxy proof against both local native and the real live `yaleh/quay` repository (including config restoration), the full regression suite, git scope/hygiene, and σ/V arithmetic — independently reproduces exactly as claimed. Most importantly, on the specific double-counting risk this iteration was explicitly warned about following iteration 25's correction, the report demonstrates genuine, diff-grounded reasoning rather than superficial compliance: it correctly resists crediting `reusability` for Core-side infrastructure work and keeps `abi_symmetry`/`gate_correctness` flat by checking actual diffs against each factor's precise protocol definition. The one nit found (stale echo of the original directive's wording in the archived Resolution section) is cosmetic and does not affect the authoritative scoring record.
