# Charter M80-ts-migration-p3a — TS migration P3-A: port quay-native src/ to TypeScript

**Milestone id:** M80  
**Task:** `tasks/exp5-M-TS-MIGRATION-P3-A.md` (milestone-candidate, crystallization)  
**Surface:** `packages/quay-native/src/` (3 JS files → TS)  
**Type:** capability-growth (L_C hardening, ADR-012) + governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P0 (M63) established the TS tooling (tsconfig, `tsc --noEmit` gate). P1 (M77) ported `provider-client.js → .ts`. P2 (M79) defined the ABI view-model interfaces (`Task`, `AdrRecord`, `Manifest` in `packages/quay/src/abi.ts`) and wired `ProviderClient` to use them.

P3 is the per-package internal migration. P3-A covers the quay-native package — the reference native file-system provider. P3 was split into three per-package children at SELECT (DIR-026 SPLIT-OR-COMMIT, mandatory).

Current state of `packages/quay-native/src/`:
- `manifest.js` (17 lines) — no `@ts-nocheck`; simple YAML-read function
- `mcp-server.js` (233 lines) — has `@ts-nocheck` (P0 nocheck ramp); MCP server with Zod schemas
- `store.js` (763 lines) — has `@ts-nocheck` (P0 nocheck ramp); core task store logic

Total: 3 files, 1013 lines. All have P0's `@ts-nocheck` or no types at all. P3-A removes the nocheck comments, adds TypeScript annotations, and ensures `tsc --noEmit` passes across the whole repo with strict-enough types on public-facing shapes.

## Scope

**In-scope work:**

1. `packages/quay-native/src/manifest.js` → `manifest.ts`: rename, add return type annotation for `readManifest()`.

2. `packages/quay-native/src/mcp-server.js` → `mcp-server.ts`: rename, remove `// @ts-nocheck`, add TypeScript types. Cross-package import `quay/src/adr-store.js` — verify resolution. Zod-inferred types may carry most of the burden.

3. `packages/quay-native/src/store.js` → `store.ts`: rename, remove `// @ts-nocheck`, add TypeScript types. Use `Task`, `AdrRecord`, `Manifest` from `packages/quay/src/abi.ts` (M79) on public API surfaces. Internal helper types as needed.

**Behavior-preserving constraints:**
- NO runtime logic changes. Type annotations only; Node 25 strips them.
- `tsc --noEmit` must remain GREEN (exit 0) across the entire repo (including the renamed `.ts` files).
- The full existing test suite (excluding known-failing live-GitHub + browser tests) must remain green — 338/342, same baseline as P2.
- The `provider-abi-conformance.test.mjs` stays as the runtime ABI enforcement.
- Golden-diff: zero behavior change, confirmed by test suite.

**Out of scope:**
- `packages/quay-native/bin/quay-native.js` — bin entry point has its own `@ts-nocheck`; deferred to a follow-up (P3-A-bin) if needed.
- `packages/quay/` and `packages/quay-github/` — P3-B and P3-C respectively.
- Any change to test assertions (golden-diff — behavior-preserving).
- Any runtime logic change.

## Value hypothesis

- **Y (metric):** 3 quay-native `src/*.ts` files exist with real typed interfaces; `tsc --noEmit` exits 0; test suite 338/342 baseline; `@ts-nocheck` removed from src/
- **Δv̂ = 0** (no user-visible capability change, no cov-cell improvement — L_C internal hardening)
- **Value type:** capability-growth (L_C hardening at quay-native implementation layer) + governance-integrity (ADR-012 P3 progress)

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** N/A — source is the `exp5-M-TS-MIGRATION-P3-A` task and ADR-012; no gap-list references. `it0-ceiling-check.sh` not applicable.

**(b) gate-hash / transclusion (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Gate-hash check: `bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M80-ts-migration-p3a.md` → PASS (re-confirm at dispatch).

**(c) dogfooding evidence gate:** N/A at charter time — runs against each iteration's report.

**(d) domain-misfit audit-channel:** Deliverables are `.ts` source files. Auditor can independently run `npx tsc --noEmit`, read renamed `.ts` files to confirm typed (non-nocheck) implementations, re-run the test suite. Domain-misfit does NOT apply.

**(e) plan-time line-budget gate:** This charter is ~130 lines, 3 in-scope items, well under ≤2000-line ceiling and ≤8 item proxy.

**Sizing (SPLIT-OR-COMMIT):** Scope is THREE files (manifest.ts ~17L, mcp-server.ts ~233L, store.ts ~763L = ~1013 lines). Largest file (`store.js`) may require careful type annotation work, but all 3 can land in one iteration-0 pass. No split needed unless `tsc` reveals broad unexpected fan-in requiring structural changes beyond type annotations.

## Class routing

**Development-class** (deliverable = real `.ts` implementation files). Direct to implementation.

## Done-when (binary)

1. `packages/quay-native/src/manifest.ts` exists (replacing `.js`); no `@ts-nocheck`.
2. `packages/quay-native/src/mcp-server.ts` exists (replacing `.js`); `@ts-nocheck` removed; public-facing shapes typed.
3. `packages/quay-native/src/store.ts` exists (replacing `.js`); `@ts-nocheck` removed; public-facing shapes typed using `Task`, `AdrRecord`, `Manifest` from `abi.ts`. Paste the public-API type signatures from the file.
4. `npx tsc --noEmit` exits 0 on the whole repo. Paste exit code.
5. Test suite (excluding live-GitHub + browser tests): 342 tests, 338 pass, 4 fail — identical to P2 baseline. Paste `ℹ tests / ℹ pass / ℹ fail` output.

## Inner termination (§3.2)

Terminate inner iteration on the FIRST of:
1. All 5 Done-when confirmed with pasted evidence.
2. ΔV < 0.02 both layers, K=2 consecutive (stall).
3. Ceiling exceeded → redesign or stop with `needs-human`.
4. Past budget ~10 iterations with nothing advancing.
5. External HALT (`.halt` sentinel).
6. `tsc` reveals broad unexpected fan-in that can't be fixed without structural changes → `needs-human` + record finding.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131 for the full literal text — NOT just this hash reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly in the iteration report.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)

Every ABSORB dispatches a fresh-context adversarial audit subagent. The audit's specific charge:
1. Independently run `npx tsc --noEmit` — confirm exit 0.
2. Read `packages/quay-native/src/manifest.ts`, `mcp-server.ts`, `store.ts` — confirm all exist; confirm no `@ts-nocheck`; confirm public-facing shapes use named types (not `any`).
3. Confirm `Task`, `AdrRecord`, `Manifest` from `abi.ts` appear in `store.ts` return types.
4. Run the test suite — confirm 342/338/4 (baseline match); paste `ℹ tests / ℹ pass / ℹ fail`.
5. Confirm no runtime behavior change: the test suite runs with zero import-resolution failures.

Output to `milestones/M80/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P3-A experiments/quay-perpetual-stream/charters/M80-ts-migration-p3a.md /tmp/m80-absorb-entry.md`
- `quay gate exp5-M-TS-MIGRATION-P3-A` (uses `extra.acceptance` seeded at SELECT)
- Worktree: `milestones/M80/worktrees/iteration-0` off master HEAD at dispatch time
- milestone_counter: do NOT increment until audit + vmeta-lag + impl-row + DoD meta-enforcer gates ALL clear
- Dashboard ABSORB row (ONE-LINE format): `m80 · exp5-M-TS-MIGRATION-P3-A · Δv=<realized> (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M80/`
- Backlog: regenerate via `node experiments/quay-perpetual-stream/scripts/it0-backlog-regen.mjs experiments/quay-perpetual-stream --write` after status update
- No Web UI verification required (no UI surface touched)
- VT Δ = 0 (L_C hardening, no cov-cell change)
