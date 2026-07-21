# Charter M81-ts-migration-p3c — TS migration P3-C: port quay-github src/ to TypeScript

**Milestone id:** M81  
**Task:** `tasks/exp5-M-TS-MIGRATION-P3-C.md` (milestone-candidate, crystallization)  
**Surface:** `packages/quay-github/src/` (3 JS files → TS)  
**Type:** capability-growth (L_C hardening, ADR-012) + governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P0 (M63) established the TS tooling. P1 (M77) ported `provider-client.ts`. P2 (M79) defined ABI interfaces in `abi.ts`. P3-A (M80) ported quay-native src/. P3-C (this milestone) ports quay-github's src/ — the GitHub Issues provider, the third and final P3 sub-milestone among the per-package splits.

Note: P3-B (quay Core internals, 19 files, ~2837 lines) is explicitly deferred — its scope requires further per-module splitting and is larger than a single milestone. P3-C (quay-github, 3 files, 1254 lines) is sized appropriately for a single milestone.

Current state of `packages/quay-github/src/`:
- `manifest.js` (16 lines) — no `@ts-nocheck`; YAML reader; same pattern as P3-A
- `mcp-server.js` (310 lines) — has `@ts-nocheck` (P0 nocheck ramp); MCP server with Zod schemas
- `github-client.js` (928 lines) — has `@ts-nocheck` (P0 nocheck ramp); maps GitHub Issues → task view-model

Total: 3 files, 1254 lines. The largest file (`github-client.js`) wraps `gh api` CLI calls and translates GitHub Issue shape into the `Task` view-model; this is where `Task` from `abi.ts` (M79) is most directly applicable.

## Scope

**In-scope work:**

1. `packages/quay-github/src/manifest.js` → `manifest.ts`: rename, add return type for `readManifest()` using `Manifest` from `abi.ts`.

2. `packages/quay-github/src/mcp-server.js` → `mcp-server.ts`: rename, remove `@ts-nocheck`, add TypeScript types. Zod schemas carry most types; add explicit return types where needed.

3. `packages/quay-github/src/github-client.js` → `github-client.ts`: rename, remove `@ts-nocheck`, add TypeScript types. Use `Task` from `abi.ts` for the view-model mapping function return types. The `execFileSync` result parsing produces `unknown`-typed JSON — narrow appropriately.

**Behavior-preserving constraints:**
- NO runtime logic changes. Type annotations only; Node 25 strips them.
- `tsc --noEmit` must remain GREEN (exit 0) across the entire repo.
- Test baselines (offline-only): quay + quay-native 388/380/8; quay-github 21/21/0.
- The `provider-abi-conformance.test.mjs` (live-GitHub) stays as runtime ABI enforcement; excluded from CI baseline.
- Golden-diff: zero behavior change confirmed by test suite.

**Out of scope:**
- `packages/quay-github/bin/` — bin entry point may still have `@ts-nocheck`; deferred.
- `packages/quay/` Core internals (P3-B — deferred, scope too large for one milestone).
- Any change to test assertions (golden-diff — behavior-preserving).
- Any runtime logic change.

## Value hypothesis

- **Y (metric):** 3 quay-github `src/*.ts` files exist; `tsc --noEmit` exits 0; baselines held; `@ts-nocheck` removed from src/
- **Δv̂ = 0** (no user-visible capability change, no cov-cell improvement — L_C internal hardening)
- **Value type:** capability-growth (L_C hardening at quay-github layer) + governance-integrity (ADR-012 P3 progress)

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** N/A — source is the `exp5-M-TS-MIGRATION-P3-C` task and ADR-012. `it0-ceiling-check.sh` not applicable.

**(b) gate-hash / transclusion (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time — runs against each iteration's report.

**(d) domain-misfit audit-channel:** Deliverables are `.ts` source files. Auditor can independently run `npx tsc --noEmit`, read renamed `.ts` files. Domain-misfit does NOT apply.

**(e) plan-time line-budget gate:** This charter is ~120 lines, 3 in-scope items, well under ≤2000-line ceiling.

**Sizing (SPLIT-OR-COMMIT):** 3 files, ~1254 lines — similar scope to P3-A (which landed cleanly in iteration-0). No split needed unless `tsc` reveals broad unexpected fan-in.

## Class routing

**Development-class** (deliverable = real `.ts` implementation files). Direct to implementation.

## Done-when (binary)

1. `packages/quay-github/src/manifest.ts` exists (replacing `.js`); no `@ts-nocheck`. Paste first 3 lines.
2. `packages/quay-github/src/mcp-server.ts` exists (replacing `.js`); `@ts-nocheck` removed; public shapes typed. Paste function signature(s).
3. `packages/quay-github/src/github-client.ts` exists (replacing `.js`); `@ts-nocheck` removed; `Task` from `abi.ts` used in view-model mapping return types. Paste the view-model mapping function signature(s).
4. `npx tsc --noEmit` exits 0. Paste exit code.
5. Test suites pass at or above baselines:
   - quay + quay-native (excl. live-GitHub): 388 tests, 380 pass, 8 fail
   - quay-github (offline, all 13 test files): 21 tests, 21 pass, 0 fail
   Paste `ℹ tests / ℹ pass / ℹ fail` for each.

## Inner termination (§3.2)

1. All 5 Done-when confirmed with pasted evidence.
2. ΔV < 0.02 both layers, K=2 consecutive (stall).
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations with nothing advancing.
5. External HALT (`.halt` sentinel).
6. `tsc` reveals broad unexpected fan-in → `needs-human` + record finding.

## HARD GATES (by-reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly in the iteration report.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)

Specific audit charge:
1. Run `npx tsc --noEmit` — confirm exit 0.
2. Read `manifest.ts`, `mcp-server.ts`, `github-client.ts` — confirm all exist; no `@ts-nocheck`; public shapes use named types.
3. Confirm `Task` from `abi.ts` appears in `github-client.ts` view-model return types.
4. Run quay-github offline tests — confirm 21/21/0. Run quay+quay-native tests — confirm 388/380/8.
5. Confirm no runtime behavior change: zero import-resolution failures.

Output to `milestones/M81/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P3-C experiments/quay-perpetual-stream/charters/M81-ts-migration-p3c.md /tmp/m81-absorb-entry.md`
- `quay gate exp5-M-TS-MIGRATION-P3-C` (uses `extra.acceptance` seeded at SELECT)
- Worktree: `milestones/M81/worktrees/iteration-0` off master HEAD at dispatch time
- milestone_counter: do NOT increment until all gates clear
- Dashboard ABSORB row (ONE-LINE format): `m81 · exp5-M-TS-MIGRATION-P3-C · Δv=<realized> (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M81/`
- No Web UI verification required
- VT Δ = 0 (L_C hardening, no cov-cell change)
