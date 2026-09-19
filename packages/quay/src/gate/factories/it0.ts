// `makeIt0Gate` — thin it0-script-wrapping gate factory.
//
// Reads `task.extra[argsKey]` (array of positional args, first required),
// shells out to `scriptPath` via the shared `runAcceptance` runner, and maps
// exit-0 -> ok:true, non-zero -> ok:false (fail-closed on missing args).

import type { GateFn } from "../types.ts";
import { runAcceptance } from "../acceptance-runner.ts";
import { type GateConfig, resolveRunnerOptions, shQuote } from "./utils.ts";
import type { Task } from "../../abi.ts";

/**
 * Build a thin it0-script-wrapping gate fn: reads `task.extra[argsKey]`
 * (expected to be an array of positional args, first arg required), shells
 * out to `scriptPath` via the shared `runAcceptance` runner (no duplicated
 * process-spawn/timeout logic), and maps its exit code straight through
 * (0 = ok:true; the script's own doc'd non-zero exit(s) = ok:false).
 */
export function makeIt0Gate(scriptPath: string, argsKey: string, label: string, gateConfig?: GateConfig): GateFn {
  return async (task: Task) => {
    const args = (task.extra as Record<string, unknown>)?.[argsKey];
    if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== "string" || (args[0] as string).trim() === "") {
      return {
        ok: false,
        reason: `no ${label} arguments defined (set task.extra.${argsKey} to an array, e.g. via ` +
          `\`quay task edit <id> --extra '{"${argsKey}":["<arg1>"]}'\`)`,
      };
    }
    const command = [scriptPath, ...(args as string[])].map(shQuote).join(" ");
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
