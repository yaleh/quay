// Barrel re-exports for gate/config/ — the single import point for all
// gate config types, utilities, and the workspace-gate loader.
//
// Extracted from gate/factories/ to reduce fanOut (DIR-087).

export type { GateConfig, RunnerOptions } from "../../kernel/gate-run-options.ts";

export type {
  It0Entry,
  FixedEntry,
  TestPassEntry,
  CoverageFloorEntry,
  RedGreenEntry,
  GatesConfig,
} from "./types.ts";

export { shQuote, resolveRunnerOptions } from "../../kernel/gate-run-options.ts";

export {
  discoverWorkspaceRoot,
  readGatesConfig,
  loadWorkspaceGates,
} from "./loader.ts";
