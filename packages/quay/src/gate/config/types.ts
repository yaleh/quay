// Gate config types — extracted from gate/factories/ to reduce fanOut.
// Types used by the config/loader.ts and workspace-gate builder.
//
// ⛔ `GateConfig` / `RunnerOptions` moved OUT of this file (GOAL-034): they are not config-loading
// types but the shared acceptance-runner primitives, and now live in
// `packages/quay/src/kernel/gate-run-options.ts` together with the four functions that use them.

/** Source provenance: which file and line a gate entry was defined at. */
export interface GateSource {
  file: string;
  line: number;
}

/** A diagnostic emitted during gate loading (malformed entry, shadowed gate, etc.). */
export interface GateDiagnostic {
  level: "WARNING" | "ERROR";
  message: string;
}

// ---------------------------------------------------------------------------
// Workspace-level gate entries (from gates.yml / config.yml `gates:` section)
// ---------------------------------------------------------------------------

export interface It0Entry {
  name: string;
  script: string;
  argsKey: string;
  cwd?: string;
  timeoutMs?: number;
  src?: GateSource;
}

export interface FixedEntry {
  name: string;
  script: string;
  cwd?: string;
  timeoutMs?: number;
  src?: GateSource;
}

export interface TestPassEntry {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  src?: GateSource;
}

export interface CoverageFloorEntry {
  name: string;
  command: string;
  floor: number;
  pattern?: string;
  cwd?: string;
  timeoutMs?: number;
  src?: GateSource;
}

export interface RedGreenEntry {
  name: string;
  red: string;
  green: string;
  cwd?: string;
  timeoutMs?: number;
  src?: GateSource;
}

/** Parsed shape of a workspace's gates.yml (or config.yml `gates:` section). */
export interface GatesConfig {
  it0: It0Entry[];
  adr: string[];
  fixed: FixedEntry[];
  testPass: TestPassEntry[];
  coverageFloor: CoverageFloorEntry[];
  redGreen: RedGreenEntry[];
  srcFile?: string;
}
