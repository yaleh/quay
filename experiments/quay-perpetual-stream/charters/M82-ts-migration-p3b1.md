# Charter M82-ts-migration-p3b1 — TS migration P3-B-1: quay Core utility modules

**Milestone id:** M82  
**Task:** `tasks/exp5-M-TS-MIGRATION-P3-B-1.md` (milestone-candidate, crystallization)  
**Surface:** `packages/quay/src/` — 10 small utility files (all < 200 lines)  
**Type:** capability-growth (L_C hardening, ADR-012) + governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P3-B covers quay Core's `packages/quay/src/` `.js` files (~2837 lines in 19 files + gate/ dir). It was split at SELECT (DIR-026 SPLIT-OR-COMMIT) into three children:
- P3-B-1 (this milestone): 10 small utility files (<200 lines each, ~965 lines total)
- P3-B-2: gate/ subdirectory (7 files, ~1316 lines)
- P3-B-3: serve.js + mcp-server.js (2 files, ~1872 lines)

P3-A (M80) ported quay-native/src/; P3-C (M81) ported quay-github/src/. P3-B-1 continues the Core package, starting with the small utility modules where risk of complex type errors is lowest.

Current state: these 10 files use the P0 `@ts-nocheck` pattern selectively, or are plain JS without `@ts-nocheck` but also without type annotations.

Files in scope:
1. `version.js` (17L) — `export const version = ...`
2. `provider-env.js` (32L) — env var resolution helpers
3. `config.js` (55L) — `.quay/config.yml` reader
4. `contract-validator.js` (60L) — provider ABI conformance validation
5. `migrate.js` (80L) — workspace migration utilities
6. `frontmatter-store-base.js` (114L) — abstract base for frontmatter-based stores
7. `action.js` (124L) — quay action dispatch (`action_list`, `action_run`)
8. `document-store.js` (131L) — markdown document store (shares base with adr-store)
9. `loop-params.js` (169L) — `.quay/loop.yml` parameter loading
10. `adr-store.js` (183L) — ADR store (wraps frontmatter-store-base)

## Scope

**In-scope work:**

1–10. Rename each file `.js` → `.ts` in `packages/quay/src/`. Remove any `@ts-nocheck`. Add TypeScript type annotations on public-facing functions and exported types. Use named types; avoid `any` on public shapes. Where relevant, use `Task`/`AdrRecord`/`Manifest` from `abi.ts` on function signatures that deal with task/ADR view-models.

Update all import references in other files that import from these modules (search with `grep -rn "from.*version\|from.*provider-env\|from.*config\|from.*contract-validator\|from.*migrate\|from.*frontmatter-store\|from.*action\|from.*document-store\|from.*loop-params\|from.*adr-store" packages/quay/`).

**Behavior-preserving constraints:**
- NO runtime logic changes. Type annotations only.
- `tsc --noEmit` GREEN (exit 0) across the repo.
- Test baselines: quay + quay-native 388/380/8; quay-github 21/21/0.
- Golden-diff: zero behavior change.

**Out of scope:**
- `gate/` subdirectory (P3-B-2)
- `serve.js`, `mcp-server.js` (P3-B-3)
- `bin/quay.js` entry point
- Any runtime logic change

## Value hypothesis

- **Y:** 10 utility `.ts` files in quay Core; `tsc --noEmit` exits 0; baselines held
- **Δv̂ = 0** (L_C internal hardening, no cov-cell change)
- **Value type:** capability-growth (L_C hardening, ADR-012) + governance-integrity

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** N/A. `it0-ceiling-check.sh` not applicable.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverables are `.ts` source files.

**(e) plan-time line-budget gate:** ~120 lines charter, 10 in-scope files (all individually tiny), no declared budget >2000.

**Sizing:** 10 files, ~965 lines total. All files under 200 lines; no single file is a complexity risk. Should land clean in iteration-0 per precedent from P3-A/P3-C.

## Class routing

**Development-class** (deliverable = `.ts` implementation files). Direct to implementation.

## Done-when (binary)

1. All 10 files exist as `.ts` (replacing `.js`): `version.ts`, `provider-env.ts`, `config.ts`, `contract-validator.ts`, `migrate.ts`, `frontmatter-store-base.ts`, `action.ts`, `document-store.ts`, `loop-params.ts`, `adr-store.ts`. Paste `ls packages/quay/src/*.ts` output.
2. No `@ts-nocheck` in any of the 10 renamed `.ts` files. Paste `grep -r "@ts-nocheck" packages/quay/src/*.ts` (should be empty).
3. `npx tsc --noEmit` exits 0. Paste exit code.
4. quay + quay-native tests: 388 tests, 380 pass, 8 fail. Paste `ℹ tests / ℹ pass / ℹ fail`.
5. quay-github tests: 21 tests, 21 pass, 0 fail. Paste `ℹ tests / ℹ pass / ℹ fail`.

## Inner termination (§3.2)

1. All 5 Done-when confirmed.
2. ΔV < 0.02 both layers, K=2 consecutive.
3. Ceiling exceeded → `needs-human`.
4. Past budget ~10 iterations.
5. External HALT.
6. `tsc` reveals broad unexpected fan-in → `needs-human`.

## HARD GATES (by-reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Run `npx tsc --noEmit` — confirm exit 0.
2. Read 3+ of the 10 renamed `.ts` files — confirm no `@ts-nocheck`, public shapes typed.
3. Confirm no `any` on primary public-facing function signatures.
4. Run both test suites — confirm 388/380/8 and 21/21/0; paste output.
5. Confirm zero import-resolution failures.

Output to `milestones/M82/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P3-B-1 experiments/quay-perpetual-stream/charters/M82-ts-migration-p3b1.md /tmp/m82-absorb-entry.md`
- `quay gate exp5-M-TS-MIGRATION-P3-B-1`
- Worktree: `milestones/M82/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m82 · exp5-M-TS-MIGRATION-P3-B-1 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M82/`
- No Web UI verification required
- VT Δ = 0
