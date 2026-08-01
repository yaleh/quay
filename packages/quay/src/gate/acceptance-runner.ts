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
import fs from "node:fs";
import { shQuote } from "./config/utils.ts";

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
  /** DIR-103-C: per-provider `acceptance_env` file path (resolved absolute).
   *  When set, the runner dot-sources this file before the acceptance command;
   *  missing file fails closed pre-execution. Undefined means no env file. */
  envFile?: string;
}

/**
 * Run `command` in `cwd` under a `timeoutMs` deadline.
 *
 * DIR-103-C: when `envFile` is set, it is dot-sourced before the acceptance
 * command via `sh -c ". <quoted-file> && <command>"` — the clean-shell contract
 * means no `.bashrc`/`.profile` is sourced; only the configured env file's
 * exports are visible to the acceptance command, and the remaining environment
 * is inherited from the invoking process.
 */
export function runAcceptance({ command, cwd, timeoutMs = 60000, envFile }: RunAcceptanceArgs): AcceptanceResult {
  // DIR-103-C: fail-closed BEFORE execution when envFile is set but missing.
  if (envFile !== undefined && !fs.existsSync(envFile)) {
    return {
      ok: false,
      code: null,
      signal: null,
      timedOut: false,
      reason: `acceptance_env file not found: ${envFile}`,
    };
  }

  // DIR-103-C: dot-source the env file so its exports are visible to the
  // acceptance command. `sh -c` sources NO shell init files — the child's
  // remaining environment is inherited from the invoking process.
  const shellCmd = envFile
    ? `. ${shQuote(envFile)} && ${command}`
    : command;

  const r = spawnSync(shellCmd, {
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

// DIR-103-A (M223): dry-run capture sibling — mirrors coverage-floor.ts's
// spawnSyncCapture: runs the acceptance command and captures stdout/stderr
// text, unlike `runAcceptance` which reports only ok/reason/code and discards
// the output. A tiny sibling rather than changing `runAcceptance`'s return
// shape (the codebase's explicit choice, per the DIR-103-A task Proposal).

export interface AcceptanceCaptureResult {
  /** combined stdout+stderr text (the whole point of a dry-run) */
  output: string;
  /** exit code, or null on timeout/spawn-error */
  code: number | null;
  /** signal name, or null */
  signal: string | null;
  /** true when the command was killed at the timeout deadline */
  timedOut: boolean;
  /** spawn-error message, or null */
  error: string | null;
}

/**
 * Run `command` in `cwd` under a `timeoutMs` deadline, capturing stdout/stderr
 * text (unlike `runAcceptance`, which discards it). Mirrors coverage-floor.ts's
 * `spawnSyncCapture` exactly.
 */
export function runAcceptanceCapture({ command, cwd, timeoutMs = 60000 }: RunAcceptanceArgs): AcceptanceCaptureResult {
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
    return { output: "", code: null, signal: null, timedOut: true, error: null };
  }
  // Any other spawn error (e.g. bad cwd / unrunnable shell).
  if (r.error) {
    return { output: "", code: null, signal: null, timedOut: false, error: r.error.message };
  }
  // Normal exit: capture combined stdout+stderr.
  return {
    output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`,
    code: r.status,
    signal: r.signal ?? null,
    timedOut: false,
    error: null,
  };
}
