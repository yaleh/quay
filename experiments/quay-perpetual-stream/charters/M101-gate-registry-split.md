# Charter M101-gate-registry-split — gate/registry.ts factory split (ARCH-M93-001)

**Milestone id:** M101  
**Task:** `tasks/ARCH-M93-001.md` (milestone-candidate)  
**Surface:** `packages/quay/src/gate/registry.ts` — split 7 inline factory functions into per-factory files  
**Type:** development-class / defect (architecture)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

`gate/registry.ts` in `packages/quay/src/gate/` is 736 lines and contains 7 gate factory functions inline:

| Factory | Start line | Approx. size |
|---|---|---|
| `makeIt0Gate` | 168 | ~26L |
| `makeFixedScriptGate` | 194 | ~32L |
| `makeAdrGate` | 226 | ~43L |
| `makeTestPassGate` | 269 | ~60L |
| `makeCoverageFloorGate` | 329 | ~49L |
| `makeRedGreenGate` | 378 | ~39L |
| `makeDocumentContractGate` | 417 | ~variable |

Before the factories (lines 1–167): imports, type definitions (`GateSpec`, `GatesConfig`, `GateFn`, `GateConfig`), and the resolver/loader logic (`resolveGate`, `loadGates`, etc.).

After the factories (roughly lines 450+): remaining resolver/loader logic.

The `gate/` package is the largest concentration in the codebase: 52 entities (59.8% of all entities), fanOut=62, but no cycles. The concentration is a discoverability and maintenance smell, not a correctness defect. The fix is file-level: each factory lives in its own file; `registry.ts` becomes a thin loader/resolver.

**Lesson from M97/M99/M100:** Same-file extraction does NOT reduce archguard outDegree (class-level type imports are counted, not body calls). For this milestone, the AC is file size reduction — not an outDegree target — because the per-file entity count is what matters for the god-package smell.

## Scope

**In scope:**

1. Create `packages/quay/src/gate/factories/` directory with one file per factory:
   - `gate/factories/it0.ts` — exports `makeIt0Gate`
   - `gate/factories/fixed-script.ts` — exports `makeFixedScriptGate`
   - `gate/factories/adr.ts` — exports `makeAdrGate`
   - `gate/factories/test-pass.ts` — exports `makeTestPassGate`
   - `gate/factories/coverage-floor.ts` — exports `makeCoverageFloorGate`
   - `gate/factories/red-green.ts` — exports `makeRedGreenGate`
   - `gate/factories/document-contract.ts` — exports `makeDocumentContractGate`
   - `gate/factories/index.ts` — re-exports all 7 (barrel file for registry.ts to import from)

2. `gate/registry.ts` becomes a thin loader/resolver: remove factory function bodies; import all 7 from `./factories/index.ts`; keep resolver/loader logic. Target: ≤150 lines.

3. All imports of factory functions from `gate/registry.ts` in other files remain unchanged (the public API is `loadGates`/`resolveGate`, not the individual factory functions directly — verify this before removing exports).

4. All existing gate tests pass without modification.

**Out of scope:**
- Changing gate behavior, schemas, or error messages
- Reducing archguard fanOut=62 (intra-package relations stay intra-package; file splitting doesn't reduce package-level fanOut)
- ARCH-M93-002/003 (already closed)
- Other files in gate/ (lifecycle.ts, engine.ts, etc. — they are under 400L already)

**Adjudication:** Single approach (no proposals needed beyond confirming the factory locations). The factories are all unexported (`function makeXxx`) so only `registry.ts` itself calls them — they do NOT form part of the public package API. Each factory file needs only the types it uses locally imported from `../engine.ts` or the shared gate types.

## Class routing

**Development-class** — code change in `packages/quay/src/`. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `gate/registry.ts` ≤150 lines (thin loader/resolver; factory bodies removed).
- [ ] 7 factory files created under `gate/factories/`; each ≤120 lines; no single file in gate/ exceeds 400 lines.
- [ ] All existing gate tests pass (`node --test packages/quay/test/gate.test.mjs` and related).
- [ ] Archguard re-run: no new cycles introduced; per-file entityCount for `registry.ts` reduced; no file in gate/ exceeds 400 lines.

## Definition of Done

- [ ] `gate/registry.ts` ≤150 lines; 7 factory files created under `gate/factories/`; all files ≤400 lines.
- [ ] Full test suite passes (gate + MCP + serve tests; no regressions).
- [ ] Fresh-context adversarial audit confirms no gate behavior change.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: split lands done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
