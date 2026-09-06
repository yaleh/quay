// Barrel re-export of all 7 gate factory functions + gateFactories dispatch map.
// Does NOT re-export utils.ts or loader.ts content.

import type { GateFn } from "../registry.ts";
import { makeIt0Gate } from "./it0.ts";
import { makeFixedScriptGate } from "./fixed-script.ts";
import { makeAdrGate } from "./adr.ts";
import { makeTestPassGate } from "./test-pass.ts";
import { makeCoverageFloorGate } from "./coverage-floor.ts";
import { makeRedGreenGate } from "./red-green.ts";
import { makeDocumentContractGate } from "./document-contract.ts";
import { makeGoalGate } from "./goal.ts";

export {
  makeIt0Gate,
  makeFixedScriptGate,
  makeAdrGate,
  makeTestPassGate,
  makeCoverageFloorGate,
  makeRedGreenGate,
  makeDocumentContractGate,
  makeGoalGate,
};

// Dispatch map for loadWorkspaceGates — maps gates.yml `type` string -> factory.
// "document-contract" is excluded: it is a built-in in gate/registry.ts.gateRegistry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const gateFactories: Record<string, (...args: any[]) => GateFn> = {
  "it0": makeIt0Gate,
  "fixed-script": makeFixedScriptGate,
  "adr": makeAdrGate,
  "test-pass": makeTestPassGate,
  "coverage-floor": makeCoverageFloorGate,
  "red-green": makeRedGreenGate,
  // SPEC-goal-mechanism-2026-09-06.md §5.2 / AC-176: makeGoalGate was exported but
  // missing from this dispatch map — a goal gate could not be configured via
  // gates.yml. Registered here so `type: goal` resolves (same gap the spec flagged
  // in its §9 "gateFactories 缺口" note).
  "goal": makeGoalGate,
};
