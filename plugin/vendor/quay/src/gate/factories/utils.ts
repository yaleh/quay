// Shared utilities for gate factory functions.
// No imports from ../registry.ts or any other gate/ file (pure utilities).
//
// Exports: GateConfig, RunnerOptions, shQuote, resolveRunnerOptions

export interface RunnerOptions {
  cwd: string;
  timeoutMs: number;
}

export interface GateConfig {
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Shell-quote one argument for safe interpolation into a `runAcceptance`
 * command string (spawnSync shell:true). Wraps in single quotes, escaping any
 * embedded single quote the POSIX-safe way: close, escaped quote, reopen.
 */
export function shQuote(arg: string): string {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

/**
 * DIR-046 (A/B) — resolve the acceptance runner's cwd/timeoutMs for ONE gate
 * invocation, with a single shared precedence rule used by every factory
 * (single-source, ADR-004):
 *
 *   cwd:       pre-set `QUAY_ACCEPTANCE_CWD` env var  >  this gate's own
 *              `gates.yml` `cwd` field  >  `process.cwd()`
 *   timeoutMs: pre-set `QUAY_ACCEPTANCE_TIMEOUT_MS` env var > this gate's
 *              own `gates.yml` `timeoutMs` field > the 60000ms default.
 */
export function resolveRunnerOptions(gateConfig: GateConfig = {}): RunnerOptions {
  const cwd = process.env.QUAY_ACCEPTANCE_CWD || gateConfig.cwd || process.cwd();
  const envTimeout = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS);
  const timeoutMs = (Number.isFinite(envTimeout) && envTimeout > 0)
    ? envTimeout
    : (typeof gateConfig.timeoutMs === "number" && gateConfig.timeoutMs > 0 ? gateConfig.timeoutMs : 60000);
  return { cwd, timeoutMs };
}
