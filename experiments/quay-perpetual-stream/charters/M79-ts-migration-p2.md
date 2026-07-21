# Charter M79-ts-migration-p2 — TS migration P2: Provider ABI view-model interfaces

**Milestone id:** M79  
**Task:** `tasks/exp5-M-TS-MIGRATION-P2.md` (milestone-candidate, crystallization)  
**Surface:** `packages/quay/src/` (new ABI type file + provider-client.ts update)  
**Type:** capability-growth (L_C hardening, ADR-012) + governance-integrity  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

P0 (M63) established the TS tooling (tsconfig, `tsc --noEmit` gate, Node 25 native `.ts` run). P1 (M77) ported the first leaf module (`provider-client.ts`) with named interfaces but left its method returns typed as `Promise<unknown>` — a deliberate P1 deferral (the task view-model type didn't exist yet). P2 is the highest-value phase: define the **ABI view-model types** and wire `ProviderClient`'s methods to use them, making the ABI contract a compile-time type, not just a prose document + conformance test.

## Scope

**Deliverable — `packages/quay/src/abi.ts`** (new file):

```typescript
export interface Task {
  id: string;
  title: string;
  status: 'todo' | 'ready' | 'done' | 'needs-human';
  role: 'primitive' | 'compound';
  labels: string[];
  parent: string | null;
  children: string[];
  body: string;
  extra: Record<string, unknown>;
}

export interface AdrRecord {
  id: string;
  title: string;
  status: string;
  body: string;
}

export interface Manifest {
  [key: string]: unknown;
}
```

**Update — `packages/quay/src/provider-client.ts`**:

Replace the `ProviderClient` interface methods' `Promise<unknown>` / `Promise<unknown[]>` return types with the typed ABI types from `abi.ts`:
- `taskList(filter?)` → `Promise<Task[]>`
- `taskGet(id)` → `Promise<Task>`
- `taskWrite(patch)` → `Promise<Task>`
- `taskCheck(id)` → `Promise<unknown>` (gate result — keep unknown; no typed gate result model in scope)
- `adrList(filter?)` → `Promise<AdrRecord[]>`
- `adrGet(id)` → `Promise<AdrRecord>`
- `adrWrite(patch)` → `Promise<AdrRecord>`
- `manifest()` → `Promise<Manifest>`

**Behavior-preserving constraints:**
- NO runtime logic changes. Types are compile-time only; Node 25 strips them.
- `tsc --noEmit` must remain GREEN (exit 0) including the new `abi.ts` and updated `provider-client.ts`.
- The full existing test suite (excluding known-failing live-GitHub + browser tests) must remain green — 338/342, same baseline as P1.
- The `provider-abi-conformance.test.mjs` stays as the runtime enforcement of the ABI contract.

**Out of scope:**
- Any changes to `packages/quay-native/` or `packages/quay-github/` internal logic — the conformance tests enforce the ABI at runtime.
- P3 (per-package internal migration) — the providers' `.js` files are not ported to `.ts` here.
- P4 (exp5 method-infra scripts).
- Any change to `DESIGN.md` or `README.md` prose (not a re-specification, just type enforcement).
- Any change to test assertions (golden-diff — behavior-preserving).

## Value hypothesis

- **Y (metric):** `abi.ts` exists with real typed interfaces; `provider-client.ts` uses them; `tsc --noEmit` exits 0; test suite 338/342 baseline
- **Δv̂ = 0** (no user-visible capability change, no cov-cell improvement — L_C internal hardening)
- **Value type:** capability-growth (L_C hardening at the ABI seam) + governance-integrity (ADR-012 compliance, single-source ABI contract)

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** N/A — source is the `exp5-M-TS-MIGRATION-P2` task and ADR-012; no gap-list references. `it0-ceiling-check.sh` not applicable.

**(b) gate-hash / transclusion (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Gate-hash check: `bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M79-ts-migration-p2.md` → PASS (re-confirm at dispatch).

**(c) dogfooding evidence gate:** N/A at charter time — runs against each iteration's report.

**(d) domain-misfit audit-channel:** Deliverables are `.ts` source files + updated interface. Auditor can independently run `npx tsc --noEmit`, read `abi.ts` to confirm typed (non-`any`) interfaces, re-run the test suite. Domain-misfit does NOT apply.

**(e) plan-time line-budget gate:** This charter is ~120 lines, single-phase, well under ≤2000-line ceiling.

**Sizing (SPLIT-OR-COMMIT):** Scope is ONE new file (`abi.ts`, ~30 lines) + ONE updated file (`provider-client.ts` — import + 8 method return types). Iteration-0 should land all Done-when in one pass. No split needed unless `tsc` reveals unexpected transitive fan-in.

## Class routing

**Development-class** (deliverable = real `.ts` type-declaration file + updated interface in `provider-client.ts`). Direct to implementation — same pattern as P1.

## Done-when (binary)

1. `packages/quay/src/abi.ts` exists with `Task`, `AdrRecord`, `Manifest` interfaces; no `any` on any field (real types throughout). Paste the file content.
2. `packages/quay/src/provider-client.ts` `ProviderClient` interface methods use the typed returns from `abi.ts` (not `Promise<unknown>` for task/adr methods). Paste the updated interface block.
3. `npx tsc --noEmit` exits 0 on the whole repo including the new `abi.ts`. Paste the exit code.
4. Test suite (excluding live-GitHub + browser tests): 342 tests, 338 pass, 4 fail — identical to P1 baseline. Paste `ℹ tests / ℹ pass / ℹ fail` output.
5. No runtime import resolution issues — the test suite run confirms Node 25 resolves `abi.ts` correctly in all callers (demonstrated by Done-when 4 being green).

## Inner termination (§3.2)

Terminate inner iteration on the FIRST of:
1. All 5 Done-when confirmed with pasted evidence.
2. ΔV < 0.02 both layers, K=2 consecutive (stall — unlikely for this tiny scope).
3. Ceiling exceeded → redesign or stop with `needs-human`.
4. Past budget ~10 iterations with nothing advancing.
5. External HALT (`.halt` sentinel).
6. `tsc` reveals broad unexpected fan-in that can't be fixed without P3 scope → `needs-human` + record finding.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131 for the full literal text — NOT just this hash reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly in the iteration report.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)

Every ABSORB dispatches a fresh-context adversarial audit subagent. The audit's specific charge:
1. Independently run `npx tsc --noEmit` — confirm exit 0 including `abi.ts` and updated `provider-client.ts`.
2. Read `abi.ts` — confirm `Task`, `AdrRecord`, `Manifest` interfaces exist with real (non-`any`) types on every field.
3. Read the `ProviderClient` interface in `provider-client.ts` — confirm method returns use the typed ABI interfaces (not `Promise<unknown>` for task/adr methods).
4. Run the test suite — confirm 342/338/4 (baseline match); paste `ℹ tests / ℹ pass / ℹ fail`.
5. Confirm no runtime behavior change: the test suite runs with zero import-resolution failures.

Output to `milestones/M79/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P2 experiments/quay-perpetual-stream/charters/M79-ts-migration-p2.md /tmp/m79-absorb-entry.md`
- `quay gate exp5-M-TS-MIGRATION-P2` (uses `extra.acceptance` seeded at SELECT)
- Worktree: `milestones/M79/worktrees/iteration-0` off master HEAD at dispatch time
- milestone_counter: do NOT increment until audit + vmeta-lag + impl-row + DoD meta-enforcer gates ALL clear
- Dashboard ABSORB row (ONE-LINE format): `m79 · exp5-M-TS-MIGRATION-P2 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M79/`
- Backlog: regenerate via `node experiments/quay-perpetual-stream/scripts/it0-backlog-regen.mjs experiments/quay-perpetual-stream --write` after status update
- No Web UI verification required (no UI surface touched)
- VT Δ = 0 (L_C hardening, no cov-cell change)
