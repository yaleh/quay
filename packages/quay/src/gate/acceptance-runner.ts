// QENG-2 — pure acceptance-command runner (epicd ADR-019 "runnable meter",
// harness runShellCommands adapted to Node).
//
// A single synchronous function that runs a shell command in a pinned cwd under
// an enforced timeout and maps the REAL Node child-process outcome to a verdict.
// spawnSync (not async spawn) keeps this a trivially-testable pure function that
// still drives real process I/O, with built-in timeout/kill semantics.
//
// Verified Node timeout semantics (node v25.x): on timeout the result carries
// BOTH `status === null && signal === "SIGKILL"` AND `error.code === "ETIMEDOUT"`.
// The mapping therefore keys off ETIMEDOUT FIRST (unambiguous) before the generic
// spawn-error and the status-based pass/fail branches (proposal §5).

import { spawnSync } from "node:child_process";

export interface AcceptanceResult {
  ok: boolean;
  reason: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
}

export interface RunAcceptanceArgs {
  /** shell command to run (shell:true, so `&&`/pipes work) */
  command: string;
  /** working directory the command runs in */
  cwd: string;
  /** kill deadline in ms (SIGKILL on expiry) */
  timeoutMs?: number;
}

/**
 * Run `command` in `cwd` under a `timeoutMs` deadline.
 */
export function runAcceptance({ command, cwd, timeoutMs = 60000 }: RunAcceptanceArgs): AcceptanceResult {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  // ETIMEDOUT first — the hanging-command branch, unambiguous.
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return {
      ok: false,
      code: null,
      signal: "SIGKILL",
      timedOut: true,
      // DIR-046-C: name the actual knob to raise, not just the fact of the
      // timeout — this is the exact discoverability gap session 8b74052c hit
      // (the user spent ~15min grepping installed source for the env var).
      reason: `acceptance timed out after ${timeoutMs}ms (killed) — raise gates.yml timeoutMs / --timeout`,
    };
  }
  // Any other spawn error (e.g. bad cwd / unrunnable shell).
  if (r.error) {
    return {
      ok: false,
      code: null,
      signal: r.signal ?? null,
      timedOut: false,
      reason: `acceptance failed to spawn: ${r.error.message}`,
    };
  }
  // Normal exit: status 0 passes, anything else fails.
  const ok = r.status === 0;
  return {
    ok,
    code: r.status,
    signal: r.signal ?? null,
    timedOut: false,
    reason: ok
      ? "acceptance passed (exit 0)"
      : `acceptance failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ""})`,
  };
}
