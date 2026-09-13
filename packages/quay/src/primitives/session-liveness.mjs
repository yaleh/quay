// Liveness measurement (AC-002): every field here must come from something
// external and directly checkable — the process table, a transcript file's
// own mtime, git's own commit log — never from a session's self-reported
// `status`/`statusUpdatedAt`. Design rationale:
// docs/design/quay-fleet-design.md §3.3 — a real session was observed with
// statusUpdatedAt 289475s (3.3 days) stale while still reading `status=idle`,
// same shape as "everything is fine."
//
// Existence alone (`kill(pid, 0)`) is not enough either: pids get reused, so
// a dead session's old pid can belong to a live, unrelated process right
// now — same shape as "still alive." Where the registry has a `procStart`
// (the kernel's own process start-time counter, /proc/<pid>/stat field 22),
// pidAlive cross-checks it; existence and a matching procStart together are
// what "the same process is still running" actually means.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Parse /proc/<pid>/stat. Field 2 (comm) is parenthesized and may itself
 * contain spaces/parens/newlines, so fields are counted from the LAST ')'
 * rather than by naive whitespace-splitting the whole line.
 * Field 22 (starttime) is the field this AC uses to distinguish "the same
 * process" from "a different process now holding this pid number."
 */
export function readProcStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeIdx = raw.lastIndexOf(")");
    if (closeIdx === -1) return null;
    const rest = raw.slice(closeIdx + 2).trim().split(/\s+/);
    const starttime = rest[19]; // field 22: 3 (state) + 19 = 22
    return starttime !== undefined ? { starttime } : null;
  } catch {
    return null; // no /proc, or pid gone between existence check and stat read
  }
}

/** This process's own PID-namespace fingerprint, e.g. "pid:[4026531836]". */
export function localPidNamespace() {
  try {
    return fs.readlinkSync("/proc/self/ns/pid");
  } catch {
    return null; // not Linux, or /proc unavailable
  }
}

/**
 * A session's `pidDomain` (e.g. "linux:<hostfp>:pid:[4026531836]") names a
 * PID namespace. A pid number is only meaningful to compare against our own
 * /proc when it was recorded in the SAME namespace we're running in —
 * otherwise the number can coincidentally match an unrelated local process.
 * Returns null (not true/false) when we cannot tell (non-Linux, no /proc).
 */
export function isSamePidNamespace(pidDomain) {
  if (typeof pidDomain !== "string" || pidDomain === "") return false;
  const local = localPidNamespace();
  if (!local) return null;
  return pidDomain.endsWith(local);
}

/**
 * Is `pid` an actually-running process — and, whenever a `procStart` from
 * the registry is supplied, the SAME process instance (not a reused pid)?
 *
 * - no `expectedProcStart` given: existence is the only signal available
 *   (documented limitation — prefer passing procStart whenever the caller
 *   has one).
 * - `expectedProcStart` given: pid must exist AND /proc's own starttime for
 *   that pid must match it.
 * - `pidDomain` given and resolvably different from ours: the pid number
 *   was recorded in a different PID namespace, so it cannot be checked
 *   against our /proc at all -> false, not a guess.
 */
export function isPidAlive(pid, { expectedProcStart, pidDomain } = {}) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;

  if (pidDomain !== undefined && isSamePidNamespace(pidDomain) === false) {
    return false;
  }

  let exists;
  try {
    process.kill(pid, 0);
    exists = true;
  } catch (err) {
    if (err && err.code === "ESRCH") exists = false;
    else if (err && err.code === "EPERM") exists = true; // exists, just not ours to signal
    else exists = false;
  }
  if (!exists) return false;

  if (expectedProcStart === undefined || expectedProcStart === null) {
    return true;
  }
  const stat = readProcStat(pid);
  if (!stat) return false; // process table didn't back up what kill(0) just said
  return String(stat.starttime) === String(expectedProcStart);
}

/** The transcript jsonl path convention under ~/.claude/projects/<slug>/. */
export function slugifyCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function transcriptPathFor(sessionId, cwd, { claudeHome = path.join(os.homedir(), ".claude") } = {}) {
  return path.join(claudeHome, "projects", slugifyCwd(cwd), `${sessionId}.jsonl`);
}

/** The transcript file's own mtime — never a self-reported field. */
export function readTranscriptMtime(transcriptPath) {
  try {
    return fs.statSync(transcriptPath).mtimeMs;
  } catch {
    return null;
  }
}

/** git's own last-commit timestamp for `cwd` — never a self-reported field. */
export function readLastCommitAt(cwd) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI"], { cwd, encoding: "utf8" }).trim();
    if (!out) return null;
    const ms = Date.parse(out);
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null; // not a git repo, or no commits yet
  }
}

/**
 * Compute the three liveness fields for one session. Every field traces to
 * an external, directly-checkable source — this function's signature does
 * not even accept a `status`/`statusUpdatedAt` input, so it is structurally
 * unable to fall back to self-report.
 */
export function computeLiveness({ pid, procStart, pidDomain, sessionId, cwd } = {}) {
  const transcriptPath = sessionId && cwd ? transcriptPathFor(sessionId, cwd) : null;
  return {
    pidAlive: isPidAlive(pid, { expectedProcStart: procStart, pidDomain }),
    lastTranscriptWriteAt: transcriptPath ? readTranscriptMtime(transcriptPath) : null,
    lastCommitAt: cwd ? readLastCommitAt(cwd) : null,
  };
}
