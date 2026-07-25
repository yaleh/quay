// Re-exports from the config/ module (DIR-087: extract gate factory config).
// Factory files continue to import from this path unchanged.

export type { GateConfig, RunnerOptions } from "../config/types.ts";
export { shQuote, resolveRunnerOptions } from "../config/utils.ts";
