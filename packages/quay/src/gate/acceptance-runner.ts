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
import path from "node:path";
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
  /** Optional gate label for the cost ledger (`name`); default: the command's
   *  first script basename, else "acceptance" (see gateCostName). */
  name?: string;
}

// ── gate cost ledger (gap-no-criterion-records-its-own-cost-checker-cost-jsonl AC1) ───────────────────
// The GATE execution path of the checker-cost mechanism. `runAcceptance` is the single choke point
// through which EVERY gate (built-in acceptance + the workspace `gates:` it0/fixed/red-green/
// test-pass/coverage-floor factories) executes its command. Recording here covers all 14 gates with
// one hook, exactly like plugin/scripts/checker-cost.sh covers the run_static_checks path.
//
// Env-guard QUAY_COST_LEDGER=1 (set by the outer loop / a production caller): the gate cost ledger is
// written to <cwd>/.quay/checker-cost.jsonl — a gitignored runtime file. Guarded so the existing
// hermetic gate tests (which call runAcceptance directly against temp/process.cwd() roots) never
// write shared state. Best-effort: a ledger write must never fail the gate.

/** First script basename in a command string (`./plugin/scripts/x.sh` → `x.sh`), or null. */
export function gateCostName(command: string, fallback = "acceptance"): string {
  const m = String(command).match(/[\w.-]+\.(?:sh|ts|mjs)\b/);
  return m ? m[0] : fallback;
}

/** /proc/loadavg 1min load, or 0 if unreadable (best-effort; same reading as checker-cost.sh). */
export function gateLoadAvg(): number {
  try {
    const v = Number(String(fs.readFileSync("/proc/loadavg", "utf8")).trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** Append one {name, ms, n, load, exit, ts} line to <cwd>/.quay/checker-cost.jsonl (QUAY_COST_LEDGER=1 only). */
export function recordGateCost(cwd: string, name: string, ms: number, exit: number | null): void {
  if (process.env.QUAY_COST_LEDGER !== "1") return;
  try {
    const ledger = path.join(cwd, ".quay", "checker-cost.jsonl");
    if (!fs.existsSync(path.dirname(ledger))) return; // not a workspace root — skip, never create
    const rec = {
      name,
      ms,
      n: 0,
      load: gateLoadAvg(),
      exit: exit ?? -1,
      ts: new Date().toISOString(),
    };
    fs.appendFileSync(ledger, JSON.stringify(rec) + "\n", "utf8");
  } catch {
    // best-effort — never let the ledger fail the gate
  }
}

// ── failure attribution (gap-acceptance-runner-failure-reason-drops-criterion-stderr) ────────────────
// A criterion that exits nonzero almost always writes its OWN cause to stderr — AC-214's distinguishes
// "no evidence yet: %s" from "stale evidence: %s", and BOTH exit 1. Reporting only
// `acceptance failed (exit 1)` collapses two distinct causes (refresh mechanism never ran vs. evidence
// needs a cross-machine re-run — opposite dispositions) into one value, so the goal-round ledger carried
// 720 consecutive rounds of a red that was structurally un-attributable (hard rule ③: enumerate, don't
// boolean — same family as "a diagnostic field must keep the dimension that distinguishes causes").
//
// Bounded on purpose: a failing criterion can print an entire suite log and `reason` is persisted every
// round (`.quay/goal-round.jsonl`). 500 is not an invented threshold — `goal-driver.ts` `gateCriterion`
// ALREADY slices the reason to 500 chars, so this cap makes the runner's own cut (which MARKS itself)
// the one that takes effect instead of a silent downstream truncation.

/** Upper bound, in characters, of a whole failure `reason` (prefix + the criterion's own output). */
export const FAILURE_REASON_MAX_CHARS = 500;

/** Collapse output to a single line — `reason` is a single-line summary field, and raw control
 *  characters from a child process must not be able to reshape a log entry. */
function flattenOutput(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Bound `text` to `budget` chars, MARKING the cut rather than hiding it. `head` picks which end
 *  survives: a criterion states its cause up front on stderr, but summarises at the tail on stdout. */
function boundedExcerpt(text: string, source: string, budget: number, head: boolean): string {
  if (text.length <= budget) return text;
  const marker = `[truncated, ${text.length} chars of ${source} omitted]`;
  const keep = Math.max(0, budget - marker.length - 3);
  return head ? `${text.slice(0, keep)} … ${marker}` : `… ${marker} ${text.slice(text.length - keep)}`;
}

/**
 * Fold a FAILED criterion's own output into its `reason` so the failure is attributable.
 *
 * stderr is preferred (that is where a criterion that fails writes its cause); stdout is the fallback
 * for criteria that report there. A criterion that wrote nothing says so explicitly — it must never be
 * silently indistinguishable from a reason that was simply never populated (hard rule 3b).
 *
 * The prefix is preserved verbatim: `driver-cli-ac2-regression.test.mjs:24` matches `/FAIL — acceptance failed/`.
 */
export function withFailureOutput(
  prefix: string,
  r: { stdout?: string | null; stderr?: string | null },
): string {
  const errText = flattenOutput(String(r.stderr ?? ""));
  const outText = flattenOutput(String(r.stdout ?? ""));
  const sep = " — ";
  const budget = FAILURE_REASON_MAX_CHARS - prefix.length - sep.length;
  if (budget <= 0) return prefix.slice(0, FAILURE_REASON_MAX_CHARS);
  const body = errText
    ? boundedExcerpt(errText, "stderr", budget, true)
    : outText
      ? boundedExcerpt(outText, "stdout", budget, false)
      : "criterion wrote no output to stderr/stdout";
  return prefix + sep + body;
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
export function runAcceptance({ command, cwd, timeoutMs = 60000, envFile, name }: RunAcceptanceArgs): AcceptanceResult {
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

  const costName = name ?? gateCostName(command);
  const startedMs = Date.now();
  const r = spawnSync(shellCmd, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Gate cost ledger (AC1 — the gate execution path): every gate command records
  // {name, ms, n, load, exit} on exit. Guarded by QUAY_COST_LEDGER=1 + a .quay cwd.
  recordGateCost(cwd, costName, Date.now() - startedMs, r.status);

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
      : withFailureOutput(
          `acceptance failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ""})`,
          r,
        ),
  };
}

// DIR-103-A (M223): dry-run capture sibling — mirrors coverage-floor.ts's
// spawnSyncCapture: runs the acceptance command and captures the FULL
// stdout/stderr text. `runAcceptance` keeps only a bounded excerpt of that
// output (and only on failure, folded into `reason`) — it still does not expose
// the text as a field. A tiny sibling rather than changing `runAcceptance`'s
// return shape (the codebase's explicit choice, per the DIR-103-A task
// Proposal).

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
 * text (unlike `runAcceptance`, which keeps only a bounded failure excerpt).
 * Mirrors coverage-floor.ts's `spawnSyncCapture` exactly.
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
