// gate/types.ts — the QENG gate FUNCTION-SHAPE type family (tasks/gap-arch-import-cycles-zero,
// GOAL-025 AC-308).
//
// WHY A SEPARATE FILE: these three types were defined in registry.ts while every gate factory
// (`factories/*.ts`) and the workspace-gate loader (`config/loader.ts`) imported them back FROM
// registry.ts — but registry.ts VALUE-imports `factories/document-contract.ts` and
// `factories/goal.ts`, so the merged graph had a type-level import cycle (import-graph-check.ts
// `typeSccs`). Moving the shared type definitions here removes the cycle's back edge: this module
// imports nothing from registry.ts / factories/* / config/*, so the factories' `import type` now
// points at a leaf. registry.ts re-exports all three, so its public API is unchanged.
//
// ⚠️ ALL THREE MOVE TOGETHER — moving only `GateFn` would leave `GateFn` referencing `GateVerdict`
// across the module boundary and simply RELOCATE the cycle (types.ts → registry.ts for GateVerdict,
// registry.ts → types.ts for GateFn) while `valueSccs` still looked unchanged. `GateVerdict`,
// `GateDefinition` and `GateFn` are one coherent cluster and are defined here as a unit.
//
// ⛔ Keep this file a LEAF: only `import type` from ../abi.ts and `node:*` are allowed here. A value
// import (or a type import of anything under gate/) re-creates the cycle this file exists to break.

import type { Task } from "../abi.ts";

export interface GateVerdict { ok: boolean; reason: string; }
export interface GateDefinition { description?: string; onPass?: string; onFail?: string; check?: (task: Task, client: unknown) => Promise<GateVerdict>; }
export type GateFn = (task: Task, client: unknown) => Promise<GateVerdict>;
