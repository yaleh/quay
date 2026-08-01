// Gate config types — extracted from gate/factories/ to reduce fanOut.
// Types used by the config/loader.ts and workspace-gate builder, plus
// the shared GateConfig / RunnerOptions originally in factories/utils.ts.

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

/** Shared gate configuration (cwd/timeoutMs). */
export interface GateConfig {
  cwd?: string;
  timeoutMs?: number;
}

/** Resolved runner configuration (always concrete). */
export interface RunnerOptions {
  cwd: string;
  timeoutMs: number;
  /** Per-provider `acceptance_env` file path, resolved and pinned via
   *  QUAY_ACCEPTANCE_ENV at the CLI/MCP layer — DIR-103-C. When set, the
   *  runner dot-sources this file before the acceptance command; missing
   *  file fails closed pre-execution. Undefined means no env file. */
  envFile?: string;
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
