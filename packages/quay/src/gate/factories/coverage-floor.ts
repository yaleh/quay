// `makeCoverageFloorGate` — coverage-floor DoD gate factory (DIR-042-A).
//
// Run a workspace-configured coverage command, extract a numeric coverage
// percentage from its stdout via a workspace-configured regex (default matches
// a bare `NN(.N)%`), and PASS iff the extracted number is >= floor.
// `spawnSyncCapture` is kept private to this file (not re-exported).

import { spawnSync } from "node:child_process";
import type { GateFn } from "../types.ts";
import { type GateConfig, resolveRunnerOptions } from "./utils.ts";

interface SpawnCaptureResult {
  output: string;
  timedOut: boolean;
  error: string | null;
}

/**
 * Run `command` in `cwd` capturing combined stdout+stderr text (unlike
 * `runAcceptance`, which reports only ok/reason/code — `coverage-floor` needs
 * the actual output text to extract a number from). Kept as a tiny sibling
 * rather than changing `runAcceptance`'s return shape.
 */
function spawnSyncCapture(command: string, cwd: string, timeoutMs: number): SpawnCaptureResult {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { output: "", timedOut: true, error: null };
  }
  if (r.error) {
    return { output: "", timedOut: false, error: r.error.message };
  }
  return { output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, timedOut: false, error: null };
}

/**
 * `coverage-floor` — run a workspace-configured coverage command, extract a
 * numeric coverage percentage from its stdout via a workspace-configured
 * regex (default matches a bare `NN(.N)%`), and PASS iff the extracted
 * number is `>= floor`. The extraction PATTERN itself is workspace config too
 * (an optional `pattern` — a JS regex source string with one capture group for
 * the number). Fails closed when: the command is unset, the command
 * errors/times out, or its output does not contain a number matching the
 * pattern at all.
 */
export function makeCoverageFloorGate(command: string, floor: number, pattern: string | undefined, _label: string, gateConfig?: GateConfig): GateFn {
  return async () => {
    if (typeof command !== "string" || command.trim() === "") {
      return { ok: false, reason: "no coverage command configured (set gates.yml coverageFloor[].command)" };
    }
    if (typeof floor !== "number" || Number.isNaN(floor)) {
      return { ok: false, reason: "no coverage floor configured (set gates.yml coverageFloor[].floor, a number 0-100)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const r = spawnSyncCapture(command, cwd, timeoutMs);
    if (r.timedOut) return { ok: false, reason: `coverage command timed out after ${timeoutMs}ms (killed) — raise gates.yml timeoutMs / --timeout` };
    if (r.error) return { ok: false, reason: `coverage command failed to spawn: ${r.error}` };
    const re = new RegExp(pattern && pattern.trim() !== "" ? pattern : "([\\d.]+)\\s*%");
    const m = re.exec(r.output);
    if (!m || m[1] === undefined) {
      return {
        ok: false,
        reason: `could not find a coverage percentage in command output (pattern ${JSON.stringify(re.source)} matched nothing)`,
      };
    }
    const actual = Number(m[1]);
    if (Number.isNaN(actual)) {
      return { ok: false, reason: `matched coverage value ${JSON.stringify(m[1])} is not a number` };
    }
    const ok = actual >= floor;
    return {
      ok,
      reason: ok
        ? `coverage ${actual}% >= floor ${floor}%`
        : `coverage ${actual}% below floor ${floor}%`,
    };
  };
}
