# Charter M84-ts-migration-p3b2 — TS migration P3-B-2: quay Core gate/ subdirectory

**Milestone id:** M84  
**Task:** `tasks/exp5-M-TS-MIGRATION-P3-B-2.md` (milestone-candidate, crystallization)  
**Surface:** `packages/quay/src/gate/` — 7 gate engine files (~1316 lines)  
**Type:** capability-growth (L_C hardening, ADR-012) + governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P3-B-2 covers the gate/ engine — QENG. P3-B-1 (M82) already ported the 10 utility modules in
`packages/quay/src/*.ts`. The M83 archguard audit confirmed the gate/ dependency surface:

- Clean DAG — no cycles between gate/ files or into the rest of src/
- External imports: stdlib only (fs, path, crypto, child_process, url) + `yaml` npm + 4 already-migrated
  TS modules referenced from registry.js (`../adr-store.ts`, `../document-store.ts`,
  `../contract-validator.ts`, `../config.ts`)
- mcp-server.js (P3-B-3 scope) imports 3 gate/ files → this milestone MUST land before P3-B-3

Files in scope (7 files, 1316 lines total):
1. `gate/engine.js` (54L) — gate evaluation orchestrator
2. `gate/gate-log.js` (62L) — gate event log reader
3. `gate/acceptance-runner.js` (70L) — shell-command acceptance gate runner
4. `gate/gate-event-store.js` (88L) — immutable gate event persistence (JSONL)
5. `gate/driver.js` (130L) — CLI driver for gate subcommands
6. `gate/lifecycle.js` (216L) — task lifecycle transitions (todo→ready→done, needs-human)
7. `gate/registry.js` (696L) — multi-gate routing DSL (MEDIUM risk — largest file)

## Scope

**In-scope work:**

For each of the 7 gate/ files:
1. Rename `.js → .ts`
2. Remove any `@ts-nocheck` directives
3. Add TypeScript type annotations on exported function signatures and gate-definition DSL shapes
4. Where functions accept `Task` or gate-event shapes, use types from `abi.ts`

Update all import references in files that import from gate/:
- `packages/quay/src/mcp-server.js` imports: engine.js, gate-log.js, lifecycle.js
- `packages/quay/bin/quay.js` imports: driver.js (and others via gate/)
- Any test files in `packages/quay/test/` that import gate/ files directly

**Behavior-preserving constraints:**
- NO runtime logic changes. Type annotations only.
- `tsc --noEmit` GREEN (exit 0) across the repo.
- Test baselines: quay + quay-native ≤ 11 failures (master baseline: 388/377/11); quay-github 21/21/0.
- Golden-diff: zero behavior change.

**Out of scope:**
- `serve.js`, `mcp-server.js` (P3-B-3)
- `bin/quay.js` entry point restructuring
- Any runtime logic change

**Special attention for registry.js (696L):**
The gate registry defines a DSL for named gates (acceptance, split-or-commit, audit-independence, etc.).
Each gate definition is an object with `check`, `description`, `onPass`, `onFail` fields. Define a
`GateDefinition` interface for these. The registry also loads dynamic plugins via `require`/`import` —
type these as `unknown` and cast at the point of use rather than over-specifying plugin shapes.

## Value hypothesis

- **Y:** All 7 gate/ `.ts` files; `tsc --noEmit` exits 0; baselines held
- **Δv̂ = 0** (L_C internal hardening, no cov-cell change)
- **Value type:** capability-growth (L_C hardening, ADR-012) + governance-integrity

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** 7 files, 1316 lines total. Under 2000-line ceiling. registry.js at 696L is the largest single file.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverables are `.ts` source files.

**(e) plan-time line-budget gate:** ~1316 lines in scope, no declared budget > 2000.

**Sizing:** 7 files, 1316 lines total. registry.js (696L) is the MEDIUM-risk target. This is larger than P3-B-1's 10-file scope but still within the one-iteration ceiling. registry.js's complexity is manageable — it's DSL definitions, not complex logic.

## Class routing

**Development-class** (deliverable = `.ts` implementation files). Direct to implementation.

## Done-when (binary)

1. All 7 gate/ files exist as `.ts` (replacing `.js`): `gate/engine.ts`, `gate/gate-log.ts`, `gate/acceptance-runner.ts`, `gate/gate-event-store.ts`, `gate/driver.ts`, `gate/lifecycle.ts`, `gate/registry.ts`. Paste `ls packages/quay/src/gate/*.ts` output.
2. No `@ts-nocheck` in any of the 7 renamed `.ts` files. Paste `grep -r "@ts-nocheck" packages/quay/src/gate/*.ts` (should be empty).
3. `npx tsc --noEmit` exits 0. Paste exit code.
4. quay + quay-native tests: ≤ 11 failures (master baseline 388/377/11). Paste `ℹ tests / ℹ pass / ℹ fail`.
5. quay-github tests: 21 tests, 21 pass, 0 fail. Paste `ℹ tests / ℹ pass / ℹ fail`.
6. All consumers of gate/ files updated to import `.ts`: `mcp-server.js`, `bin/quay.js`, any test files.

## Inner termination (§3.2)

1. All 6 Done-when confirmed.
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
2. Read 3+ of the 7 renamed `.ts` files — confirm no `@ts-nocheck`, public shapes typed.
3. Confirm no `any` on primary public-facing function signatures.
4. Run both test suites — confirm ≤11 failures and 21/21/0; paste output.
5. Confirm zero import-resolution failures (check mcp-server.js and bin/quay.js).
6. Confirm registry.js has a `GateDefinition` interface (or equivalent typed gate shape).

Output to `milestones/M84/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P3-B-2 experiments/quay-perpetual-stream/charters/M84-ts-migration-p3b2.md /tmp/m84-absorb-entry.md`
- `quay gate exp5-M-TS-MIGRATION-P3-B-2`
- Worktree: `milestones/M84/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m84 · exp5-M-TS-MIGRATION-P3-B-2 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M84/`
- No Web UI verification required
- VT Δ = 0
