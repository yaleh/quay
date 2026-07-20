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

/**
 * Run `command` in `cwd` under a `timeoutMs` deadline.
 *
 * @param {Object} args
 * @param {string} args.command       shell command to run (shell:true, so `&&`/pipes work)
 * @param {string} args.cwd           working directory the command runs in
 * @param {number} [args.timeoutMs=60000]  kill deadline in ms (SIGKILL on expiry)
 * @returns {{ ok: boolean, reason: string, code: number|null, signal: string|null, timedOut: boolean }}
 */
export function runAcceptance({ command, cwd, timeoutMs = 60000 }) {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  // ETIMEDOUT first — the hanging-command branch, unambiguous.
  if (r.error && r.error.code === "ETIMEDOUT") {
    return {
      ok: false,
      code: null,
      signal: "SIGKILL",
      timedOut: true,
      reason: `acceptance timed out after ${timeoutMs}ms (killed)`,
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
