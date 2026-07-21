# Charter M77-ts-migration-p1 — TS migration P1: port provider-client.js → .ts

**Milestone id:** M77  
**Task:** `tasks/exp5-M-TS-MIGRATION-P1.md` (milestone-candidate, milestone:M-77)  
**Surface:** packages/quay/src (provider-client.ts — leaf module)  
**Type:** capability-growth (L_C hardening, ADR-012) + governance-integrity (ADR-012 compliance)  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md` git SHA a1e6f03d57fb66ce739dc1e63854fb253cf1148c

## Scope

Port exactly ONE leaf module: `packages/quay/src/provider-client.js` (99 lines, the `connectProvider` factory — thin ABI client wrapper, only external imports from `@modelcontextprotocol/sdk`).

**In scope (this milestone):**
- Rename `provider-client.js` → `provider-client.ts`
- Add real TypeScript types to `connectProvider`'s parameter and return type (not `any`-everywhere — real types on the public API surface per ADR-012)
- Remove the `// @ts-nocheck` P0 ramp marker at the top of that file
- Confirm `tsc --noEmit` stays GREEN (exit 0) including the newly-typed file
- Confirm the existing test suite stays green (behavior-preserving / golden-diff — NO logic changes)

**Out of scope:**
- task-schema.mjs (separate milestone — dual-source complication)
- gate/registry.js (696 lines — too large for this milestone per SPLIT-OR-COMMIT)
- Any caller change (callers use `.js` extension; TypeScript Bundler moduleResolution resolves `.js` → `.ts`)
- Provider ABI surface, CLI, MCP tool wiring, web UI (not authorized for autonomous SELECT)

**SPLIT-OR-COMMIT:** if `provider-client.js` turns out to have broad call-site changes needed (beyond what the existing `.js`-extension import pattern already handles), the outcome is `needs-human` (flag the issue, do NOT widen scope to callers).

## Value hypothesis

- **Y (metric):** `tsc --noEmit` GREEN + `provider-client.ts` exists with real types + test suite green
- **Δv̂ = 0** (no user-visible capability change, no cov-cell improvement — L_C internal hardening)
- **Value type:** capability-growth (L_C hardening) + governance-integrity (first real product-code TS file beyond tooling-only P0)
- **Governance:product ratio benefit:** this is packages/ product code (unlike recent methodology milestones), helping the rolling governance:product ratio

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** N/A — this milestone cites no `gap-list.md` gap or directive ID (source is `exp5-M-TS-MIGRATION-P1` task and ADR-012); `it0-ceiling-check.sh` not applicable.

**(b) gate-hash / transclusion (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Gate-hash check: `bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M77-ts-migration-p1.md` → **PASS** (run at charter-authoring time; re-confirm at dispatch if any time passes).

**(c) dogfooding evidence-gate:** N/A at charter time — runs against each inner iteration's report as it's produced.

**(d) domain-misfit audit-channel:** The deliverable is `provider-client.ts` (a source file). An independent mechanism IS reachable: the auditor can independently run `npx tsc --noEmit` against the repo including the new file and confirm exit 0; can re-run the test suite covering provider-client's callers; can read the `.ts` file and verify the types are real (non-`any`). Domain-misfit does NOT apply — this is standard development-class with a clear, independently runnable acceptance check.

**(e) plan-time line-budget gate:** This charter is ~120 lines, single-phase, well under the ≤2000-line ceiling. No phase/stage plan reference required (single-phase milestone). `it0-ceiling-line-budget-check.sh` would FLAG only if a phase/stage plan is missing AND the scope exceeds ~2000 lines — neither applies here.

**Sizing (SPLIT-OR-COMMIT):** scope is ONE 99-line file. Iteration-0 should land ALL Done-when in one pass; iteration-1 independently re-derives and verifies. Scope is within the milestone ceiling; no split needed.

## Class routing (5a)

**Development-class** (deliverable = real `.ts` product file). The plan is "N/A — split-or-commit: each milestone ports 1 leaf file" (task's own `## Plan`). The implementation is so constrained by the golden-diff discipline (99 lines, behavior-preserving, no new logic) that the full quay-task-to-plan pipeline would produce a plan identical to the task itself. Proceeding directly to implementation (same as a micro-refactoring milestone where the "proposal" IS the task).

## Done-when (binary)

1. `packages/quay/src/provider-client.ts` exists (not `.js`) with the same exported function `connectProvider` — no `.js` file remaining at the same path.
2. `connectProvider`'s parameter and return type have real TypeScript types on the public surface (no `// @ts-nocheck` on this file; no untyped `any` on the `connectProvider` signature itself — internal vars may still be inferred).
3. `npx tsc --noEmit` exits 0 on the whole repo including the newly-typed file.
4. The existing test suite (excluding known-failing live-GitHub + browser tests) passes green — NO assertion changes, NO logic changes.
5. The callers (`mcp-server.js`, `serve.js`, `quay.js`) all import `"./provider-client.js"` (TypeScript Bundler moduleResolution resolves `.js` → `.ts` automatically); NO caller modification required — if a caller change IS required, the outcome is `needs-human` with the finding documented.

## Inner termination (§3.2)

Terminate inner iteration on the FIRST of:
1. All 5 Done-when above confirmed with pasted evidence.
2. ΔV < 0.02 both layers, K=2 consecutive (stall — unlikely for this tiny scope).
3. Ceiling exceeded → redesign or stop.
4. Past budget ~10 iterations with nothing advancing.
5. External HALT (`.halt` sentinel).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
lines 100-131 for the full literal text; the dispatched iteration-0 prompt MUST include the full
literal gate text — NOT just this hash reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly in the iteration report — do not silently omit.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)

Every ABSORB dispatches a fresh-context adversarial audit subagent. The audit's specific charge:
1. Independently run `npx tsc --noEmit` — confirm exit 0 including `provider-client.ts`.
2. Confirm `provider-client.ts` exists; `provider-client.js` does NOT exist at the same path.
3. Read `provider-client.ts` — confirm `connectProvider`'s signature has real types (non-`any`), no `// @ts-nocheck`.
4. Run the test suite covering provider-client's callers — confirm green with NO assertion changes.
5. Confirm NO caller `.js` file was modified (scope discipline).

Output to `milestones/M77/audits/iteration-N-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-TS-MIGRATION-P1 experiments/quay-perpetual-stream/charters/M77-ts-migration-p1.md /tmp/m77-absorb-entry.md`
- `quay gate exp5-M-TS-MIGRATION-P1` (uses `extra.acceptance` seeded at SELECT)
- Worktree: `milestones/M77/worktrees/iteration-0` off master HEAD at dispatch time
- milestone_counter: do NOT increment until audit + vmeta-lag + impl-row + DoD meta-enforcer gates ALL clear
- Dashboard: append SELECT + ABSORB entries; Δv = 0 (L_C hardening, no cov-cell improvement)
- Backlog: regenerate via `node experiments/quay-perpetual-stream/scripts/it0-backlog-regen.mjs` after status update
- No Web UI verification required (no UI surface touched)
