// Re-exports from the config/ module (DIR-087: extract gate factory config).
// Existing consumers (registry.ts) continue to import from this path unchanged.

export type {
  It0Entry,
  FixedEntry,
  TestPassEntry,
  CoverageFloorEntry,
  RedGreenEntry,
  GatesConfig,
} from "../config/types.ts";

export {
  discoverWorkspaceRoot,
  readGatesConfig,
  loadWorkspaceGates,
} from "../config/loader.ts";
