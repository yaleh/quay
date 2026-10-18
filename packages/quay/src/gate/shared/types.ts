// gate/shared/types.ts — the QENG gate FUNCTION-SHAPE type family
// (tasks/gap-arch-import-cycles-zero, GOAL-025 AC-308; moved into `shared/` by
// tasks/gap-gate-directory-cycle-break-by-extracting-shared-leaves).
//
// WHY A SEPARATE FILE: these three types were defined in registry.ts while every gate factory
// (`factories/*.ts`) and the workspace-gate loader (`config/loader.ts`) imported them back FROM
// registry.ts — but registry.ts VALUE-imports `factories/document-contract.ts` and
// `factories/goal.ts`, so the merged graph had a type-level import cycle (import-graph-check.ts
// `typeSccs`). Moving the shared type definitions here removes the cycle's back edge: this module
// imports nothing from registry.ts / factories/* / config/*, so the factories' `import type` now
// points at a leaf. registry.ts re-exports all three, so its public API is unchanged.
//
// WHY `shared/` AND NOT THE `gate/` ROOT: archguard's DIRECTORY-level moduleGraph saw a
// `gate/config ⇄ gate/factories ⇄ gate` cycle even after the file-level typeScc above was gone —
// `factories/*.ts` and `config/loader.ts` imported `../types.ts`, a file in the PARENT directory
// that itself is imported BY that parent (registry.ts). A file in a subdirectory reaching up into
// the parent directory is a directory-level back edge regardless of whether the import is a type
// import. Sitting in `gate/shared/` makes every edge point DOWN (parent → shared, child → shared),
// so no parent↔child pair remains. `acceptance-runner.ts` moved here for the same reason.
//
// ⚠️ ALL THREE MOVE TOGETHER — moving only `GateFn` would leave `GateFn` referencing `GateVerdict`
// across the module boundary and simply RELOCATE the cycle (types.ts → registry.ts for GateVerdict,
// registry.ts → types.ts for GateFn) while `valueSccs` still looked unchanged. `GateVerdict`,
// `GateDefinition` and `GateFn` are one coherent cluster and are defined here as a unit.
//
// ⛔ Keep this file a LEAF: only `import type` from ../../core/types.ts and `node:*` are allowed
// here. A value import (or a type import of anything else under gate/) re-creates the cycle this
// file breaks.
//
// tasks/gap-src-root-gate-cycle-break: `Task` moved with the ABI to `core/types.ts`, and
// `GateVerdictKind` moved there too (the acceptance runner in `core/` produces it, and `core/`
// must not import `gate/`). Everything this file still DEFINES — `GateVerdict`, `GateDefinition`,
// `GateFn` — is the gate function-shape family, which no `core/` module consumes.

import type { Task, GateVerdictKind } from "../../core/types.ts";

// Re-exported so `gate/shared/types.ts`'s public API is unchanged for its existing importers.
export type { GateVerdictKind } from "../../core/types.ts";

export interface GateVerdict {
  ok: boolean;
  reason: string;
  /**
   * The 3-valued verdict this check reached, when the check can produce one. A check shape that
   * only ever has a boolean answer (`taskCheck` — "are all ACs ticked?" — is genuinely binary, it
   * has no third answer to give) leaves this unset, and the engine's single mapping
   * (`verdictFromGateCheck`) falls back to `ok → pass/fail`.
   * ⛔ Optional rather than required so existing boolean-only checkers need no change; the point is
   * that a check which CAN report "not evaluated" cannot have that signal dropped at the write site.
   */
  kind?: GateVerdictKind;
}
export interface GateDefinition { description?: string; onPass?: string; onFail?: string; check?: (task: Task, client: unknown) => Promise<GateVerdict>; }
export type GateFn = (task: Task, client: unknown) => Promise<GateVerdict>;
