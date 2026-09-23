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

/**
 * A gate verdict — THREE states, ⛔ never a boolean
 * (gap-goal-gate-verdict-single-mapping-not-evaluated).
 *
 * "not-evaluated" is a DISTINCT value from "fail": "this was not measured" must never wear the
 * same output shape as "this is false" (hard rule 3b). Before this type existed, two of the three
 * GateEvent write points in this repo mapped the acceptance runner's result with the binary
 * `ok ? "pass" : "fail"` — so a criterion that TIMED OUT, failed to spawn, or could not be run at
 * all (exit 126/127) was recorded as a claim that the criterion was FALSE. On the live
 * claudecodeui ledger that was 61 timeouts + ~370 exit-127 events (criteria whose scripts no
 * longer exist) among 8185 `fail`s — indistinguishable from a criterion that genuinely said no.
 */
export type GateVerdictKind = "pass" | "fail" | "not-evaluated";

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
