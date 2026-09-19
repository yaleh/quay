// `makeFixedScriptGate` — zero-argument fixed-script gate factory (DIR-035-D).
//
// A thin sibling of `makeIt0Gate` for a FIXED script that takes NO
// `task.extra` args at all. Reuses the SAME `runAcceptance` runner.

import type { GateFn } from "../types.ts";
import { runAcceptance } from "../acceptance-runner.ts";
import { type GateConfig, resolveRunnerOptions, shQuote } from "./utils.ts";

/**
 * DIR-035-D — a thin sibling of `makeIt0Gate` for a FIXED script that takes
 * NO `task.extra` args at all (unlike the it0-style scripts, which require
 * >=1 positional arg). Reuses the SAME `runAcceptance` runner (no new
 * process-spawn logic) — this is the missing zero-arg case in the same
 * factory family, not a duplication of `makeIt0Gate`'s args-required logic.
 */
export function makeFixedScriptGate(scriptPath: string, _label: string, gateConfig?: GateConfig): GateFn {
  return async () => {
    const command = shQuote(scriptPath);
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
