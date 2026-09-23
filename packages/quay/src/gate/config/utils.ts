// Shared utilities for gate config — pure, no imports from ../registry.ts
// or any other gate/ file.
//
// Extracted from gate/factories/utils.ts. Exports: GateConfig, RunnerOptions,
// shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS, resolveAcceptanceTimeoutMs,
// resolveRunnerOptions.

import type { GateConfig, RunnerOptions } from "./types.ts";

export type { GateConfig, RunnerOptions };

/**
 * Shell-quote one argument for safe interpolation into a `runAcceptance`
 * command string (spawnSync shell:true). Wraps in single quotes, escaping any
 * embedded single quote the POSIX-safe way: close, escaped quote, reopen.
 */
export function shQuote(arg: string): string {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

/**
 * The acceptance runner's kill deadline when NOTHING overrides it — the SINGLE home of the
 * 60000ms default (gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout).
 * `runAcceptance` / `runAcceptanceCapture` default to it, and `resolveAcceptanceTimeoutMs` /
 * `resolveRunnerOptions` fall back to it.
 *
 * ⛔ Why this constant exists at all: the default used to be spelled as a bare `60000` literal in
 * FIVE places across three files — `acceptance-runner.ts` ×2, this file, and `goal-store.ts` ×4
 * (where it silently bypassed the whole DIR-046 configuration surface). Five copies of one number
 * is not five times the safety; it is one number that four readers cannot agree on. Exported, not
 * inlined, so `grep` for the default finds exactly one definition.
 */
export const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 60000;

/**
 * Resolve ONLY the acceptance runner's kill deadline (ms). This is the timeout half of
 * `resolveRunnerOptions`, extracted so the `goal` path (`goal-store.ts`) can honour the SAME
 * configuration surface WITHOUT inheriting the cwd rule.
 *
 * Precedence (unchanged, and deliberately the single source of it):
 *   pre-set `QUAY_ACCEPTANCE_TIMEOUT_MS` env var  >  this gate's own `gates.yml` `timeoutMs`
 *   field  >  `DEFAULT_ACCEPTANCE_TIMEOUT_MS` (60000).
 *
 * ⛔ Deliberately NOT cwd-aware. A caller that wants the cwd too calls `resolveRunnerOptions`.
 * The goal criterion's cwd is the git root (a deliberate choice — `hard rule 4 corollary 2`:
 * the value must not depend on where the process happens to have been started), while
 * `resolveRunnerOptions` prefers `QUAY_ACCEPTANCE_CWD`; adopting the whole options object would
 * silently relocate every goal criterion the moment someone set that variable.
 */
export function resolveAcceptanceTimeoutMs(gateConfig: GateConfig = {}): number {
  const envTimeout = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
  const cfgTimeout = gateConfig.timeoutMs;
  return typeof cfgTimeout === "number" && cfgTimeout > 0 ? cfgTimeout : DEFAULT_ACCEPTANCE_TIMEOUT_MS;
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
 *   envFile:   pre-set `QUAY_ACCEPTANCE_ENV` env var > undefined (no env
 *              file) — per DIR-103-C; the CLI/MCP layer pins the env var
 *              from the enabled provider's `acceptance_env` config key.
 *
 * The timeoutMs rule lives in `resolveAcceptanceTimeoutMs` (above) so the goal path can take it
 * without the cwd rule; this function only composes the three values.
 */
export function resolveRunnerOptions(gateConfig: GateConfig = {}): RunnerOptions {
  const cwd = process.env.QUAY_ACCEPTANCE_CWD || gateConfig.cwd || process.cwd();
  const timeoutMs = resolveAcceptanceTimeoutMs(gateConfig);
  const envFile = process.env.QUAY_ACCEPTANCE_ENV || undefined;
  return { cwd, timeoutMs, envFile };
}
