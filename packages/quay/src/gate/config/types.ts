// Gate config types — extracted from gate/factories/ to reduce fanOut.
// Types used by the config/loader.ts and workspace-gate builder, plus
// the shared GateConfig / RunnerOptions originally in factories/utils.ts.

/** Shared gate configuration (cwd/timeoutMs). */
export interface GateConfig {
  cwd?: string;
  timeoutMs?: number;
}

/** Resolved runner configuration (always concrete). */
export interface RunnerOptions {
  cwd: string;
  timeoutMs: number;
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
}

export interface FixedEntry {
  name: string;
  script: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface TestPassEntry {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface CoverageFloorEntry {
  name: string;
  command: string;
  floor: number;
  pattern?: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface RedGreenEntry {
  name: string;
  red: string;
  green: string;
  cwd?: string;
  timeoutMs?: number;
}

/** Parsed shape of a workspace's gates.yml (or config.yml `gates:` section). */
export interface GatesConfig {
  it0: It0Entry[];
  adr: string[];
  fixed: FixedEntry[];
  testPass: TestPassEntry[];
  coverageFloor: CoverageFloorEntry[];
  redGreen: RedGreenEntry[];
}
