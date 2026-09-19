// `makeTestPassGate` — generic test-pass DoD gate factory (DIR-042-A).
//
// Run a workspace-configured command, PASS iff exit 0. No test runner name
// is ever mentioned here; the command is workspace data (gates.yml).

import type { GateFn } from "../types.ts";
import { runAcceptance } from "../acceptance-runner.ts";
import { type GateConfig, resolveRunnerOptions } from "./utils.ts";

/**
 * `test-pass` — run a workspace-configured command, PASS iff exit 0. This is
 * the generic "some command exits clean" shape shared by any test-runner
 * invocation, whatever language or tool a workspace happens to use — no such
 * tool name ever appears here; the actual invocation is workspace DATA (a
 * `gates.yml` `testPass[].command`).
 */
export function makeTestPassGate(command: string, _label: string, gateConfig?: GateConfig): GateFn {
  return async () => {
    if (typeof command !== "string" || command.trim() === "") {
      return { ok: false, reason: "no test command configured (set gates.yml testPass[].command)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
