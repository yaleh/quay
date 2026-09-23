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
import type { GateVerdictKind } from "./types.ts";

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
  /** DIR-046-C's knob DISCOVERABILITY, per caller path: the text appended to a timeout `reason`
   *  naming what to raise. ⛔ The default (gates.yml / `--timeout`) is the TASK-gate wording; a
   *  GOAL caller must pass its own, because the goal paths read neither of those — the
   *  2026-09-23 defect was exactly a reason telling a goal reader to raise a gates.yml key that
   *  path never consults (hard rule 5b: the advice, not just the mapping, is per-path). */
  timeoutKnob?: string;
  /** DIR-103-C: per-provider `acceptance_env` file path (resolved absolute).
   *  When set, the runner dot-sources this file before the acceptance command;
   *  missing file fails closed pre-execution. Undefined means no env file. */
  envFile?: string;
  /** Optional gate label for the cost ledger (`name`); default: the command's
   *  first script basename, else "acceptance" (see gateCostName). */
  name?: string;
}

// ── the SINGLE verdict mapping (gap-goal-gate-verdict-single-mapping-not-evaluated) ──────────────
//
// Every GateEvent verdict in packages/quay/src and packages/quay-native/src is produced by ONE of
// the two functions below — ⛔ no write point hand-rolls `ok ? "pass" : "fail"` any more. That is
// the mechanism, not a style preference: an inline binary ternary at a write site DROPS the
// not-evaluated signal wherever a caller has one, and it does so silently (the event looks exactly
// like a real "false"). The live evidence that this matters was 61 timeouts + ~370 exit-127 events
// recorded as `fail` on one workspace's ledger.

/** Why a criterion was NOT evaluated. Enumerated so a reader can act: `timeout` names a knob to
 *  turn, `not-runnable` a broken criterion, `spawn` a broken instrument. */
export type NotEvaluatedCause =
  /** the criterion itself exited 3 — this repo's "I cannot evaluate this HERE" convention */
  | "declared"
  /** killed at the deadline (raise the knob named in `reason`) */
  | "timeout"
  /** the runner could not spawn a shell at all */
  | "spawn"
  /** exit 126 / 127 — the criterion's own command could not be run (not found / not executable) */
  | "not-runnable";

/** The default criterion deadline when neither the record nor the environment names one. */
export const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 60_000;

/** exit 126 (found, not executable) / 127 (not found): the criterion never got to state anything. */
const NOT_RUNNABLE_EXIT_CODES = new Set([126, 127]);

export interface AcceptanceVerdict {
  verdict: GateVerdictKind;
  /** the cause — non-null exactly when `verdict === "not-evaluated"` */
  cause: NotEvaluatedCause | null;
  /** The reason to RECORD. For a not-evaluated verdict it is PREFIXED with the cause token
   *  (`not-evaluated (timeout): …`) so the cause travels with the reason a reader greps for —
   *  ⛔ not only in a sibling field a `grep not-runnable .quay/gate-events.jsonl` would miss. */
  reason: string;
}

/**
 * Map a REAL child-process outcome to a 3-valued verdict. THE single mapping — the goal sweep,
 * `quay goal gate`, the MCP `goal_gate` tool and the task acceptance gate all call this (or
 * `verdictFromGateCheck`) rather than re-deriving a verdict from `ok`.
 *
 * ⛔ Order matters. `timedOut` is checked before `code === null`, because a timeout ALSO reports
 * `code === null` (SIGKILL) — reading it as a spawn failure would misname the knob to turn.
 */
export function verdictFromAcceptance(r: AcceptanceResult): AcceptanceVerdict {
  if (r.ok) return { verdict: "pass", cause: null, reason: r.reason };
  const cause: NotEvaluatedCause | null = r.timedOut
    ? "timeout"
    : r.code === null
      ? "spawn"
      : NOT_RUNNABLE_EXIT_CODES.has(r.code)
        ? "not-runnable"
        : r.code === 3
          ? "declared"
          : null;
  if (cause === null) return { verdict: "fail", cause: null, reason: r.reason };
  return {
    verdict: "not-evaluated",
    cause,
    reason: `not-evaluated (${cause}): ${r.reason}`.slice(0, FAILURE_REASON_MAX_CHARS),
  };
}

/**
 * The mapping for a gate CHECK's result: either the check already resolved its 3-valued verdict
 * (`kind` — the acceptance gate does, via `verdictFromAcceptance`) or it is a boolean-only check
 * (`taskCheck`-shaped: "are all ACs ticked?" has no third answer to give, so `ok → pass/fail` is
 * the COMPLETE mapping for it, ⛔ not a conflation).
 */
export function verdictFromGateCheck(r: { ok: boolean; kind?: GateVerdictKind }): GateVerdictKind {
  if (r.kind !== undefined) return r.kind;
  return r.ok ? "pass" : "fail";
}

/** The env knob a caller with no record-level declaration can turn. Named once so the reason text
 *  and the resolver cannot drift apart. */
export const ACCEPTANCE_TIMEOUT_ENV = "QUAY_ACCEPTANCE_TIMEOUT_MS";

/** A resolved deadline AND where it came from — the source is what makes the timeout `reason`
 *  name a knob that actually exists on the caller's path. */
export interface AcceptanceTimeout {
  timeoutMs: number;
  source: "record" | "env" | "default";
}

/**
 * Resolve a GOAL criterion's deadline: the record's own `timeoutMs` > `QUAY_ACCEPTANCE_TIMEOUT_MS`
 * > the default.
 *
 * ⛔ A record value that is not a finite positive number is IGNORED, never coerced: `spawnSync`
 * treats `timeout: NaN` as "no deadline", so a typo in a record would silently DISABLE the guard
 * rather than fall back to it (hard rule 3b — a value nobody can read must not become a value that
 * means something else).
 */
export function resolveAcceptanceTimeout(
  recordTimeoutMs?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): AcceptanceTimeout {
  if (typeof recordTimeoutMs === "number" && Number.isFinite(recordTimeoutMs) && recordTimeoutMs > 0) {
    return { timeoutMs: recordTimeoutMs, source: "record" };
  }
  const raw = env[ACCEPTANCE_TIMEOUT_ENV];
  const n = raw === undefined ? NaN : Number(String(raw).trim());
  if (Number.isFinite(n) && n > 0) return { timeoutMs: n, source: "env" };
  return { timeoutMs: DEFAULT_ACCEPTANCE_TIMEOUT_MS, source: "default" };
}

/** The hint appended to a TIMEOUT reason for a resolved deadline — ⛔ names only knobs THIS path
 *  reads (see `RunAcceptanceArgs.timeoutKnob`). */
export function timeoutKnobHint(t: AcceptanceTimeout): string {
  switch (t.source) {
    case "record":
      return "raise this record's `timeoutMs` (the deadline in force)";
    case "env":
      return `raise ${ACCEPTANCE_TIMEOUT_ENV}`;
    default:
      return `set the record's \`timeoutMs\` or ${ACCEPTANCE_TIMEOUT_ENV}`;
  }
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
export function runAcceptance({ command, cwd, timeoutMs = 60000, envFile, name, timeoutKnob }: RunAcceptanceArgs): AcceptanceResult {
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
      // ⛔ `timeoutKnob` is per-CALLER-PATH: the default wording is the task
      // gate's, and a goal caller passes its own (see the field's doc comment).
      reason: `acceptance timed out after ${timeoutMs}ms (killed) — ${timeoutKnob ?? "raise gates.yml timeoutMs / --timeout"}`,
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
