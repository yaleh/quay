---
id: exp5-M-TS-MIGRATION
title: "TS migration program (ADR-012): gradually port quay product code
  JS→TypeScript, phased + behavior-preserving, to unlock archguard +
  type-safety"
status: ready
labels:
  - milestone-candidate
  - crystallization
parent: null
children:
  - exp5-M-TS-MIGRATION-P0
extra:
  schema: v1
---
## Proposal
Execute ADR-012: gradually migrate quay product code (`packages/**`) from JS/ESM to TypeScript — NOT a big-bang, NOT Go. TS is a JS superset, so the migration is behavior-preserving-by-construction and file-by-file, exploiting Node 25 native type-stripping (runs `.ts` with no build step) + `allowJs` coexistence, keeping npm workspaces / `node --test` / the MCP SDK. Types are `L_C` constraint-hardening (a crystallization move) and unlock archguard (the `L_G/L_D` instrument for G1/ADR-007). Labeled `human-steered`: it touches product code broadly and must proceed only under the behavior-preserving + golden-diff discipline (never a mid-loop autonomous self-rewrite).

Phased (each phase is its own split-or-commit milestone per DIR-026):
- **P0 tooling** — tsconfig (`allowJs`+`checkJs`, `strict` ramped), `tsc --noEmit` type gate wired into the DoD/gates, Node 25 type-strip run path, `node --test` on `.ts` confirmed.
- **P1 leaf modules** — pure-logic first (`task-schema`-shaped modules, view-model types, `provider-client`, gate `registry`).
- **P2 ABI boundary** — the Provider ABI (task + ADR view-models) expressed as TS interfaces — the ABI contract becomes a type (highest-value).
- **P3 per-package** — quay-native store → Core CLI/serve/mcp → quay-github.
- **P4 exp5 method-infra scripts** — the load-bearing gates, migrated under the golden-diff discipline (like the it0-dod-check restructure).
Interim: G1's `L_G/L_D` uses JS-native proxies (madge/dependency-cruiser/jscpd); archguard is the post-migration upgrade — this program does NOT block G1.

## Plan
N/A — a phased program (P0–P4); each phase is split-or-commit at SELECT (DIR-026) into a fully-completable milestone; behavior-preservation verified per file by the existing selfchecks/gates + a golden-diff. No single staged docs/plans doc; ADR-012 is the decision of record.

## Acceptance Criteria
- [ ] P0: `tsconfig` + a `tsc --noEmit` type gate exist and pass on the repo; `node --test` runs a `.ts` test; a `.ts` module runs under Node native type-stripping with no separate build.
- [ ] Each migrated phase is behavior-preserving: the full existing test + selfcheck + gate suite stays green before/after (golden-diff on any load-bearing script), net no behavior change.
- [ ] The Provider ABI (task + ADR view-models) is expressed as TS interfaces (P2) and the packages typecheck against it.
- [ ] archguard produces a real `L_G/L_D` reading on the migrated (TS) product code — the observability upgrade ADR-012 targets.
## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] quay product code runs on TypeScript (via Node native type-stripping), all tests/gates/selfchecks green — behavior-preserving throughout (no regression on a real milestone).
- [ ] archguard runs on the migrated product and yields an `L_G/L_D` reading recorded on the dashboard (closes the ADR-007 instrument gap for the product).
- [ ] Net: types add hard `L_C` (no dual source, no behavior drift); Go NOT adopted (unless single-binary distribution later dominates — a separate decision).
