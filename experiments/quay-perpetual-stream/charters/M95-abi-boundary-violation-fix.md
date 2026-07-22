# Charter M95-abi-boundary-violation-fix — ABI boundary violation fix (ARCH-M93-004)

**Milestone id:** M95  
**Task:** `tasks/ARCH-M93-004.md` (milestone-candidate)  
**Surface:** `packages/quay-native/src/mcp-server.ts` — remove `createAdrStore` import from Core  
**Type:** development-class / defect (architecture / ABI boundary enforcement)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

`packages/quay-native/src/mcp-server.ts` line 13 imports `createAdrStore` from `quay/src/adr-store.ts` — a concrete Core implementation function, not an ABI type. This is the only cross-package implementation import in the codebase (archguard confirms fanIn=1 for `adr-store.ts`), and it violates the stated architectural invariant: providers depend on Core only through the Provider ABI (`quay/src/abi.ts`), not through Core's internal implementation modules.

Filed as ARCH-M93-004 at M93 archguard audit. The fix is bounded: one import line and its single usage (`createAdrStore(resolvedAdrDir)` at line 25 in quay-native's mcp-server.ts).

## Scope

**In scope:**

Two implementation options — adjudicated via quay-task-to-plan:
- **Option A (inline):** quay-native implements its own `createAdrStore`-equivalent function inline in `mcp-server.ts` (or extracted to a new `quay-native/src/adr-store.ts`), using the local `store.ts` primitives that quay-native already owns. Removes the cross-package dependency entirely.
- **Option B (move to shared):** Move `createAdrStore` from `packages/quay/src/adr-store.ts` to `packages/quay-native/src/adr-store.ts` (the native provider owns ADR storage, not Core). Core imports from the ABI or from a thin shared module. Requires checking whether Core's `gate/registry.ts` also uses `createAdrStore` (it does, via `makeAdrGate`).

1. Remove `import { createAdrStore } from "quay/src/adr-store.ts"` from `packages/quay-native/src/mcp-server.ts`.
2. Provide the `createAdrStore` capability via whichever approach the adjudicator selects.
3. Verify with grep: `grep -rn 'from "quay/src/adr-store' packages/quay-native/src/` returns zero results.
4. Confirm no regression in existing tests.

**Out of scope:**
- ARCH-M93-001 (gate/ god-package), ARCH-M93-002 (startMcpServer god-function), ARCH-M93-003 (startServer god-function) — separate milestones.
- Adding new ABI surface to `quay/src/abi.ts` for ADR operations beyond what is needed for the import fix.

## Class routing

**Development-class** — product code change in `packages/quay-native/src/`. MUST go through `quay-task-to-plan` pipeline (N independent blank-slate proposals → adjudication → reconciled proposal → milestone-level plan) BEFORE dispatch to `baime:iteration-executor`. Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `quay-native/src/mcp-server.ts` no longer imports `createAdrStore` from Core. `grep -rn 'from "quay/src/adr-store' packages/quay-native/src/` returns zero results.
- [ ] ADR-related MCP tools in quay-native still work (no regression in `quay-native`-layer ADR tests).
- [ ] No regression in Core's existing tests (gate tests that use `makeAdrGate` → `createAdrStore` still pass).

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] `grep -rn 'from "quay/src/adr-store' packages/quay-native/src/` returns zero results; confirmed with pasted output.
- [ ] TDD per ADR-001: test exercises the fixed ADR path (quay-native ADR list/get still works after the boundary fix).
- [ ] Plugin re-vendored + bumped if any plugin scripts were touched.
- [ ] Fresh-context adversarial audit confirms no other cross-package implementation imports remain in quay-native (DIR-034 anti-forgery).
- [ ] Per DIR-026 SPLIT-OR-COMMIT: the ABI boundary fix lands done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`  
(SHA-256 of `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` at charter time — the iteration-0 agent MUST verify this matches before running gates)
