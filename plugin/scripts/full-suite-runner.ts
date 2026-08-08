#!/usr/bin/env node
// full-suite-runner.ts — run the FULL suite as OUTER background async, writing
// .quay/full-suite-state.json with the canonical suite-state shape.
//
// Task: gap-full-suite-belongs-to-outer-background-above-3-min
//   AC1 — result writes `.quay/full-suite-state.json` (well-known location):
//         {state: running|green|red, runner: outer|inner, startedAt, finishedAt,
//          durationMs, laneCount}
//   AC2 — the runner marks state=red the MOMENT a failure line is detected on the
//         suite's stream — NOT after the full run finishes — shrinking the
//         "went red → discovered red" window.
//   AC5 — every run records durationMs (finishedAt - startedAt) = the measurement
//         hook for the threshold rule (suite_duration >= 3 min => outer centralized
//         background; < 3 min => delegate to inner per-task and eliminate "batch").
//   AC6(i) — outer background run while inner keeps dispatching/merging: this script
//         spawns the suite, writes state, and exits; it does not block the outer
//         tick and does not block the inner layer.
//   AC4 — state=red IS the stop-dispatch signal the inner layer reads
//         (fast-mode-loop-tick.md step 3): red => inner stops new dispatch AND holds
//         completed-agent fan-in until the outer re-greens.
//
// Task: gap-full-suite-runner-concurrency-default-and-gate (2026-08-05, ABORT #5)
//   AC1 — the default laneCount is NPROC-DERIVED (max(1, floor(nproc / AMPLIFICATION)),
//         AMPLIFICATION = 1.0 since the AC5 cost-side experiment ran
//         (gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible, 2026-08-08:
//         zero cancelled at concurrency 4 AND 8 on the same selected set; nproc is the wall-clock
//         sweet spot) — the SAME derivation as test.sh's AC5, NOT the hardcoded 8. On this box
//         nproc=4 ⇒ 4.
//   AC2 — the --test-concurrency splice is a REPLACE, not an append: any existing
//         --test-concurrency=* (both `=` and space spellings) is stripped from the command
//         before the effective value is spliced, so the spawned process shows EXACTLY ONE
//         --test-concurrency=<effective>. ABORT #5 was `--test-concurrency=8 =8` (two 8s) —
//         the outer's explicit 8 and test.sh's own default 8 coexisted, and last-flag-wins
//         silently reverted to 8 with no criterion catching it.
//   AC3 — the shared resource gate (plugin/scripts/resource-gate.sh --for full-suite) is
//         consulted BEFORE the suite starts; on WAIT the runner does NOT start and leaves the
//         state file untouched (still running/green).
//   AC5 (reason axis) — red states carry a `reason` field: "failed" (a real failure was
//         detected — the stop-dispatch signal) or "aborted" (the run produced NO correctness
//         conclusion — spawn error / signal kill; MUST NOT stop dispatch).
//
// It also tees the suite's stdout+stderr to a log file (default .quay/full-suite.log)
// so the outer's verification gate can grep the 判绿 markers (cancelled 0 /
// FULL-SUITE-EXIT=0 / tests N = reference).
//
// Usage (from the workspace root; the outer starts this with a background subagent /
// run_in_background:true so the tick is not blocked):
//   node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts \
//     [--command "<test command>"]   # default: bash scripts/test.sh (canonical full suite)
//     [--root <path>]                # the TESTED CHECKOUT (spawn cwd + git HEAD anchor; default repo root)
//     [--state-dir <path>]           # the .quay STATE/LOG directory (gate write location);
//                                    #   default: <root>/.quay (backward compatible single-location)
//                                    #   gap-suite-state-split-across-worktree-and-gate: when --root is
//                                    #   a WORKTREE, pass --state-dir <main-repo>/.quay so the gate
//                                    #   (inner stop conditions + suite-state-trigger, which read ONLY
//                                    #   the main repo's relative .quay/full-suite-state.json) sees the
//                                    #   SAME result — full-suite-state.json, full-suite.log and
//                                    #   verification-round.jsonl all land in <state-dir>.
//     [scope]                        # gap-worktree-scoped-runs-consume-resources-but-produce-no-signal:
//                                    #   every state carries `scope: main|worktree` (which checkout
//                                    #   produced it), and the resource gate is asked with
//                                    #   --main-repo-priority ONLY when --root is the MAIN repo — so the
//                                    #   main-repo full suite (the signal subagents wait for) is not
//                                    #   PERMANENTLY blocked by worktree scoped load (deferrable). A
//                                    #   worktree's own full-suite run gets NO priority (it is itself
//                                    #   deferrable).
//     [--state-file <path>]          # default: <state-dir>/full-suite-state.json
//     [--log-file <path>]            # default: <state-dir>/full-suite.log
//     [--lane-count <n>]             # default: max(1, floor(nproc/1.0)) = nproc (AC1, cost-side-verified)
//     [--sync]                       # wait for the suite to finish before exiting
//
// Concurrency knob FORK (gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red AC3):
// the --lane-count splice only applies to node:test/test.sh projects (--test-concurrency=N).
// For a vitest project pass --command "npx vitest run --maxWorkers=<n>" — vitest's real
// file-level parallel flag is --maxWorkers (archguard ran the full suite with --maxWorkers=8,
// 4902 passed); the runner leaves non-test.sh commands untouched.
//
// Exit: 0 if the suite is green, 1 if red OR the resource gate said WAIT (not started).
// The durable signal the inner reads is the state file, not the exit code.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { runOnce } from "./suite-state-trigger.ts";
import { getLoad1 } from "./checker-cost.ts";
import { scanFamily, kindForFile } from "./known-load-sensitive.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type SuiteStateValue = "running" | "green" | "red";
export type SuiteStateReason = "failed" | "aborted" | "infra-error";

/**
 * One detected suite failure — the FAILURE LOCATION for the red-window dispatch decision
 * (gap-red-window-dispatch-stop-should-be-shared-gate-conditional). `line` is the raw failure
 * line that flipped state to red (the 判定信息 — the runner already knew which test failed);
 * `file` is the best-effort test-file context (from the TAP detail block / vitest per-file line /
 * stack frame) used to classify "shared gate vs specific test" for dispatch.
 */
export interface SuiteFailure {
  line: string;
  file?: string;
  /**
   * The KNOWN-LOAD-SENSITIVE partition (gap-known-load-sensitive-rule-is-doc-only-no-mechanical-
   * triage AC3): true when the failing file is a family member (machine-readable manifest from
   * known-load-sensitive.ts). Written by the runner at red time so the red-window triage can
   * auto-partition WITHOUT re-deriving it — the state carries the partition, not the triaging
   * human/agent's memory.
   */
  in_family?: boolean;
  /** The family kind (wall-clock | nested-spawn | heavy | ...) — one root cause = one kind. */
  kind?: string;
}

export interface SuiteState {
  state: SuiteStateValue;
  runner: "outer" | "inner";
  /**
   * gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1: which checkout produced this
   * state — "main" (the primary repo; the signal subagents wait for) or "worktree" (a linked worktree;
   * deferrable). Waiters reading a worktree's own `.quay/full-suite-state.json` can tell a worktree-
   * origin run from the main-repo suite at a glance, and the resource gate's main-repo-vs-worktree
   * priority rule keys on the same distinction. Absent (legacy states) ⇒ treat as main (fail-open).
   */
  scope?: "main" | "worktree";
  startedAt: string; // ISO 8601
  finishedAt: string | null; // ISO 8601; null while running
  durationMs: number | null; // finishedAt - startedAt; null while running
  laneCount: number;
  /**
   * Present only on red (AC5 reason axis — gap-full-suite-runner-concurrency-default-and-gate AC5;
   * gap-suite-state-has-no-reason-axis-failed-aborted-infra AC1). Three-value reason enum:
   *   - "failed"     = a real failure was detected (the stop-dispatch signal).
   *   - "aborted"    = the run produced NO correctness conclusion (spawn error / signal kill /
   *                    early gate-WAIT exit) and MUST NOT trigger stop-dispatch.
   *   - "infra-error" = an environment problem (neither a code failure nor a deliberate abort) —
   *                    ALSO not a code-failure conclusion, so it does NOT stop dispatch on code risk.
   * Legacy red states without `reason` are treated as "failed" (fail-closed toward stopping).
   */
  reason?: SuiteStateReason;
  /**
   * Present on red+failed — the failure line(s) that flipped red, with best-effort file context.
   * This is what the SUITE-RED event carries (failureLocation) so the inner dispatch decision can
   * distinguish a SHARED-GATE failure (run_static_checks — every scoped run pays it ⇒ stop dispatch)
   * from a SPECIFIC-TEST failure unrelated to a candidate's touch-set (⇒ dispatch continues).
   * Absent (legacy red) ⇒ fail-closed toward stopping (the dispatch rule cannot confirm it is an
   * unrelated specific test).
   */
  failures?: SuiteFailure[];
}

// AC2 — failure markers that flip state to red the MOMENT they appear on the suite's
// stdout/stderr stream, never waiting for the run to finish. These are STRUCTURED
// failure shapes, NOT bare glyphs (gap-full-suite-runner-red-pattern-matches-bare-x-
// vitest-false-red, AC1): a bare `✖` in a vitest suite can be the test's OWN console
// output — archguard TASK-67 proved a PASSING negative-control test logging `✖ Diagram
// test failed` triggered a FALSE early-red while vitest reported 0 failed / exit 0. Under
// a pipe node:test emits TAP, so `not ok` / `# fail 1+` / `# cancelled 1+` cover node:test
// failures (AC2, no regression); vitest failures are covered by their structured lines:
// `❯ <file> (N tests | M failed)` (per-file) and `Test Files <N> failed` (summary).
// FULL-SUITE-EXIT is the repo's own marker. A generic non-zero exit code is the catch-all
// for failures no line matched (applied at exit).
const FAILURE_PATTERNS: RegExp[] = [
  /^not ok\b/, // node:test / TAP per-test failure
  /^#\s*fail\s+[1-9]/, // TAP summary: # fail 1+
  /^#\s*cancelled\s+[1-9]/, // TAP summary: # cancelled 1+ (cancelled is a failure even when fail 0)
  /❯\s+\S+\s+\(\d+\s+tests?\s*\|\s*[1-9]\d*\s+failed(?:[^)]*)\)/, // vitest per-file: ❯ <file> (N tests | M failed [| K skipped])
  /Test Files\s+[1-9]\d*\s+failed/, // vitest summary: Test Files <N> failed
  /FULL-SUITE-EXIT=[^0]/, // the repo's own full-suite exit marker, non-zero
];

// AC5 reason axis (gap-suite-state-has-no-reason-axis-failed-aborted-infra AC1/AC3) — ABORT markers
// that flip state to red + reason=aborted: the suite emitted NO correctness conclusion. The concrete
// shape today is test.sh's INTERNAL resource-gate fail-closed: when the gate says WAIT, test.sh
// prints `resource gate says WAIT — not running the full suite ...` and exits 1 in ~6s WITHOUT
// running a single test. A real failure line (FAILURE_PATTERNS) still wins over an abort marker
// (a failure conclusion is never downgraded); an abort marker is only applied when no failure line
// has been seen. A generic non-zero exit with NEITHER marker stays failed (fail-closed catch-all).
const ABORT_PATTERNS: RegExp[] = [
  /resource gate says WAIT/, // test.sh internal gate fail-closed — the suite never ran tests
  /not running the full suite/, // same gate-WAIT message (both halves of the canonical line)
];

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

function writeState(file: string, state: SuiteState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ── AC6: append-only suite-duration sequence (gap-no-criterion-records-its-own-cost) ──────────────────
// `.quay/full-suite-state.json` is a SINGLE-STATE file overwritten every round — the previous
// round's durationMs is destroyed. The fix (same shape as the checker-cost ledger): append one line
// {round, startedAt, durationMs, laneCount, pass, fail, load} to `.quay/verification-round.jsonl`
// per run, NEVER overwriting the single-state file. After dozens of rounds the queryable sequence
// survives, so "what did the suite cost last hour" is answerable without hand-digging panes/commits.
//
// load = /proc/loadavg 1min field — the attribution-correction dimension (a same-n round that cost
// more is distinguishable as machine-busy rather than n-growth). Best-effort: a ledger write must
// never fail the run (mirrors checker-cost.sh's fail-open).

/** /proc/loadavg 1min load, or 0 if unreadable (best-effort). */
export function readLoadAvg(): number {
  try {
    const v = Number(String(fs.readFileSync("/proc/loadavg", "utf8")).trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export interface SuiteRoundRecord {
  round: number;
  startedAt: string;
  durationMs: number;
  laneCount: number;
  pass: number;
  fail: number;
  cancelled: number;
  load: number;
  state: string;
  runner: string;
  // gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1: main|worktree — which
  // checkout produced this round (the same `scope` the state file carries). Absent on legacy rows.
  scope?: "main" | "worktree";
  // trend-criteria extension (gap-quality-criteria-are-point-in-time-no-trend-criteria AC1/AC3b):
  //   tests       = pass + fail + cancelled (the suite's total test count, so per_test_ms is
  //                 comparable across rounds of different sizes)
  //   per_test_ms = durationMs / tests (the per-test cost — the AC2 trend axis; in milliseconds)
  //   redAt       = ISO time the run first flipped state=red on a REAL failure line (the
  //                 early-RED detection-latency axis, AC3b: redAt − startedAt is how far into
  //                 the run the first failure was reported; the mitigation shrinks the blast
  //                 radius, and a growing latency means the mitigation is degrading)
  // Optional for backward compatibility with earlier appended lines (a reader must tolerate
  // their absence — trend-check.ts derives tests from pass/fail/cancelled when tests is missing).
  tests?: number;
  per_test_ms?: number;
  redAt?: string | null;
  // reason axis (gap-suite-state-has-no-reason-axis-failed-aborted-infra) carried into the
  // sequence so the trend reader can tell a real-failure red from an abort without re-deriving it.
  reason?: SuiteStateReason | null;
}

/**
 * Append one suite-round record to <stateDir>/verification-round.jsonl (round = prior lines + 1).
 * `stateDir` is the .quay STATE directory — the state/log/ledger write location, decoupled from the
 * TESTED CHECKOUT by --state-dir (gap-suite-state-split-across-worktree-and-gate). Pre-split callers
 * passed a workspace root; the equivalent stateDir is `<root>/.quay`.
 */
export function appendVerificationRound(stateDir: string, rec: SuiteRoundRecord): void {
  try {
    const file = path.join(stateDir, "verification-round.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let prior = 0;
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8");
      for (const l of text.split("\n")) if (l.trim()) prior++;
    }
    fs.appendFileSync(file, JSON.stringify({ ...rec, round: rec.round > 0 ? rec.round : prior + 1 }) + "\n", "utf8");
  } catch {
    // best-effort — never let the ledger fail the run
  }
}

/** Does a stream line match any AC2 failure marker? */
export function isFailureLine(line: string): boolean {
  return FAILURE_PATTERNS.some((re) => re.test(line));
}

// ── failure-location capture (gap-red-window-dispatch-stop-should-be-shared-gate-conditional) ──────
// The SUITE-RED event must carry WHERE the red landed (state.failures) so the inner dispatch rule can
// distinguish a SHARED-GATE failure (run_static_checks — every scoped run pays it ⇒ stop dispatch)
// from a SPECIFIC-TEST failure unrelated to a candidate's touch-set (⇒ dispatch continues). The
// failure LINE is what flipped red (AC2 already knew which test failed); the best-effort FILE context
// comes from the failure's detail block (node:test TAP `location:`/stack frames, vitest `❯ <file>`).

const FILE_PATH_TOKEN_RE = /[^\s'`",()]+\.(?:(?:test|spec)\.)?(?:mjs|ts|js|tsx|jsx|cjs|mts|sh)\b/g;

/** Normalize a path token from a failure line into a repo-relative file (best-effort). */
export function normalizeFailureFile(raw: string, root: string): string | undefined {
  let p = String(raw).trim().replace(/^file:\/\//, "");
  // strip a trailing `:line:col` suffix (TAP location / stack frames)
  p = p.replace(/:\d+(?::\d+)?$/, "");
  // strip surrounding punctuation the regex may have dragged in
  p = p.replace(/['"`,()\]]+$/, "");
  if (!p) return undefined;
  if (path.isAbsolute(p)) {
    const rel = path.relative(root, p);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
    return undefined; // outside the repo — won't match repo-relative touches, treat as unknown
  }
  return p;
}

/** First file-path token in a stream line, normalized repo-relative (best-effort). */
export function extractFailureFile(line: string, root: string): string | undefined {
  for (const m of line.matchAll(FILE_PATH_TOKEN_RE)) {
    const f = normalizeFailureFile(m[0], root);
    if (f) return f;
  }
  return undefined;
}

/** Does a stream line match an AC5 reason-axis ABORT marker (no correctness conclusion)? */
export function isAbortLine(line: string): boolean {
  return ABORT_PATTERNS.some((re) => re.test(line));
}

// ── AC1/AC2: nproc-derived default laneCount + REPLACE splice ───────────────────────────────────────

/**
 * AC1 — the DEFAULT laneCount is nproc-derived, using the SAME formula as test.sh's AC5
 * derivation: max(1, floor(nproc / AMPLIFICATION)), AMPLIFICATION = 1.0. The 2.1 value (measured
 * process amplification 17/8 ≈ 2.125) was an unproven-conservative guard against oversubscription:
 * the AC5 cost-side experiment (gap-dod-two-green-runs-and-over90-budget-are-mathematically-
 * incompatible, 2026-08-08) ran the same selected set at concurrency 1/4/8 — ZERO cancelled at
 * every level, and nproc was the wall-clock sweet spot (24s vs 57.5s at 1, 27.3s at 8 on a 4-core
 * box). The outer's own full-suite verification rounds at laneCount 8 (13+ runs, all cancelled 0)
 * corroborate that the oversubscription cost side never materialized. RESOURCE_GATE_NPROC /
 * RESOURCE_GATE_AMPLIFICATION are the deterministic test seams (the same env test.sh's
 * default_concurrency_formula reads).
 */
export function defaultLaneCount(): number {
  const ncpuRaw = process.env.RESOURCE_GATE_NPROC ?? String(
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
  );
  const ncpu = Number(ncpuRaw);
  const ampRaw = Number(process.env.RESOURCE_GATE_AMPLIFICATION ?? "1.0");
  const amp = Number.isFinite(ampRaw) && ampRaw > 0 ? ampRaw : 1.0;
  return Math.max(1, Math.floor((Number.isFinite(ncpu) && ncpu >= 1 ? ncpu : 1) / amp));
}

/**
 * AC2 — strip any existing `--test-concurrency=*` from a command string, both the `=` spelling
 * (`--test-concurrency=8`) and the SPACE spelling (`--test-concurrency 8`). The splice is a
 * REPLACE so the spawned process carries exactly ONE --test-concurrency (the effective value).
 */
export function stripConcurrencyFlags(cmd: string): string {
  let out = cmd.replace(/\s+--test-concurrency=\d+/g, "");
  out = out.replace(/\s+--test-concurrency\s+\d+/g, "");
  return out.trim();
}

/**
 * Whether a command is concurrency-relevant — the default full suite (`bash scripts/test.sh`),
 * or any command that references a test.sh / already carries a --test-concurrency flag. Arbitrary
 * commands (a fake suite in tests, the --fail-fast-check control) are NOT spliced — the runner
 * cannot control their concurrency, and appending a node flag would corrupt them.
 */
export function isConcurrencyRelevantCommand(cmd: string): boolean {
  return /\btest\.sh\b/.test(cmd) || cmd.includes("--test-concurrency");
}

/** Build the spawned command with the effective laneCount spliced as the ONLY --test-concurrency. */
export function spliceConcurrency(cmd: string, laneCount: number): string {
  const stripped = stripConcurrencyFlags(cmd);
  return `${stripped} --test-concurrency=${laneCount}`;
}

// ── AC3: resource-gate consultation before starting ──────────────────────────────────────────────────

/**
 * gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1/AC2 — whether a checkout is a
 * LINKED git worktree (git-dir != git-common-dir). The main repo is NOT a worktree; a temp non-git
 * dir (a hermetic test root) is NOT a worktree. Used to (a) tag the suite state with `scope` so
 * waiters can tell a worktree-origin suite from the main-repo suite (AC1), and (b) pass
 * --main-repo-priority to the resource gate only when the tested checkout is the main repo (AC2).
 */
export function isGitWorktree(root: string): boolean {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" }).trim();
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
    const abs = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(root, p));
    return abs(gitDir) !== abs(commonDir);
  } catch {
    return false;
  }
}

/**
 * AC3 — consult the shared resource gate BEFORE starting the full suite. WAIT (non-zero exit) ⇒
 * the runner must NOT start; the state file is left untouched (still running/green), and the runner
 * exits non-zero so the caller re-ticks. The gate is the REAL plugin/scripts/resource-gate.sh (its
 * RESOURCE_GATE_TEST_* env seams flow through for deterministic tests). QUAY_TEST_SKIP_RESOURCE_GATE=1
 * is the test escape hatch (same env test.sh honors).
 *
 * AC2 (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal): when the TESTED CHECKOUT is
 * the MAIN repo, pass --main-repo-priority so the gate lets the main-repo full suite proceed even over
 * worktree scoped load (deferrable — its completion updates nothing anyone waits on). When --root is a
 * linked worktree, NO priority flag: a worktree full-suite caller is itself deferrable and must yield
 * to the machine.
 */
export function checkResourceGate(root: string): { ok: boolean; output: string } {
  const gate = path.join(__dirname, "resource-gate.sh");
  const gateArgs = ["--for", "full-suite"];
  if (!isGitWorktree(root)) gateArgs.push("--main-repo-priority");
  try {
    const output = execFileSync("bash", [gate, ...gateArgs], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number };
    return {
      ok: false,
      output: `${String(err.stdout ?? "")}${String(err.stderr ?? "")}`,
    };
  }
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────

export async function run(argv: string[]): Promise<number> {
  const root = path.resolve(parseArg(argv, "--root") ?? REPO_ROOT);
  const explicitCommand = parseArg(argv, "--command");
  const laneCountArg = parseArg(argv, "--lane-count");
  // AC1 — effective laneCount = explicit --lane-count if given, else the nproc-derived default.
  const laneCount = laneCountArg !== undefined ? Number(laneCountArg) : defaultLaneCount();
  if (!Number.isFinite(laneCount) || laneCount < 1) {
    process.stderr.write(`full-suite-runner: invalid --lane-count '${laneCountArg}' (must be a positive integer)\n`);
    return 1;
  }

  const baseCommand = explicitCommand ?? "bash scripts/test.sh";
  // AC2 — REPLACE splice: strip any existing --test-concurrency (both spellings) and splice the
  // effective laneCount as the ONLY concurrency flag. Arbitrary non-concurrency commands (a fake
  // suite, --fail-fast-check) are left untouched — their concurrency is their own business.
  const command =
    explicitCommand === undefined || isConcurrencyRelevantCommand(baseCommand)
      ? spliceConcurrency(baseCommand, laneCount)
      : baseCommand;

  // gap-suite-state-split-across-worktree-and-gate: the STATE/LOG write location is decoupled from
  // --root (the TESTED CHECKOUT). --state-dir is the .quay state directory the gate reads; when a
  // worktree full-suite run passes `--root <worktree> --state-dir <main-repo>/.quay`, the runner
  // writes full-suite-state.json + full-suite.log + verification-round.jsonl into the MAIN repo, so
  // the inner stop conditions + suite-state-trigger (which read only the main repo's relative
  // .quay/full-suite-state.json) see the SAME result the runner produced. Default <root>/.quay is
  // the historical single-location behavior (fully backward compatible).
  const stateDir = path.resolve(parseArg(argv, "--state-dir") ?? path.join(root, ".quay"));
  const stateFile = path.resolve(parseArg(argv, "--state-file") ?? path.join(stateDir, "full-suite-state.json"));
  const logFile = path.resolve(parseArg(argv, "--log-file") ?? path.join(stateDir, "full-suite.log"));

  // AC3 — the resource gate MUST be consulted BEFORE the suite starts (state=running is written
  // AFTER the gate, so a WAIT leaves the previous state — running/green — untouched). --fail-fast-check
  // / --wait-check are lightweight hermetic controls, not heavy ops — they skip the gate.
  const skipGate =
    process.env.QUAY_TEST_SKIP_RESOURCE_GATE === "1" ||
    argv.includes("--fail-fast-check") ||
    argv.includes("--wait-check");
  if (!skipGate) {
    const gate = checkResourceGate(root);
    if (!gate.ok) {
      process.stderr.write(
        `full-suite-runner: resource gate says WAIT — NOT starting (state untouched; re-tick when the gate reports GO)\n${gate.output}\n`
      );
      return 1;
    }
    process.stderr.write("full-suite-runner: resource gate says GO — starting\n");
  }

  const startedAt = new Date().toISOString();
  // gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1: tag every state with the
  // producing checkout's scope so waiters can distinguish a worktree-origin suite (deferrable — its
  // completion updates nothing anyone waits on) from the main-repo suite (the signal being waited for).
  const scope = isGitWorktree(root) ? ("worktree" as const) : ("main" as const);
  const base = { runner: "outer" as const, startedAt, laneCount, scope };

  // KNOWN-LOAD-SENSITIVE family manifest (gap-known-load-sensitive-rule-is-doc-only-no-mechanical-
  // triage AC3): scanned ONCE at run start against the repo root so red-time failures can carry the
  // in-family/kind partition into full-suite-state.json — the triage reads it, never re-derives it.
  const family = scanFamily(REPO_ROOT);
  /** Enrich a failure with its family partition (in_family + kind) — no-op when not a member. */
  const enrichFailure = (f: SuiteFailure): SuiteFailure => {
    if (!f.file) return f;
    const kind = kindForFile(family, f.file);
    if (kind === undefined) return f;
    return { ...f, in_family: true, kind };
  };

  // gap-suite-state-split-across-worktree-and-gate — SYNC BRIDGE: every state transition is written
  // to the gate location (--state-dir, the main repo) AND mirrored to the tested checkout's own
  // `<root>/.quay/full-suite-state.json`. The gate (inner + suite-state-trigger) reads the main repo;
  // the mirror keeps the worktree's own state byte-identical so the two never diverge (the Contract
  // band: cmp -s <worktree-state> <main-repo-state> = same). When --state-dir defaults to <root>/.quay
  // the two paths coincide and the mirror is a no-op (single write, backward compatible).
  const mirrorStateFile = path.resolve(root, ".quay", "full-suite-state.json");
  const writeSuiteState = (state: SuiteState): void => {
    writeState(stateFile, state);
    if (mirrorStateFile !== stateFile) writeState(mirrorStateFile, state);
  };

  // AC1 — write `running` the moment the runner starts (inner sees running => proceed).
  writeSuiteState({ state: "running", ...base, finishedAt: null, durationMs: null });

  // gap-resource-gate-no-single-flight-lock-two-suite-overlap: the SINGLE-FLIGHT mutual exclusion is
  // enforced inside scripts/test.sh's full-suite default path (`full_suite_lock_acquire` on a flock
  // over <git-common-dir>/full-suite.lock, held for the whole run) — a second concurrent full suite
  // WAITs/queues instead of both-GO. The runner does NOT take its own lock: it spawns test.sh, which
  // serializes the actual node --test workers. This runner's gate check (above) prevents "starting
  // into a busy machine"; the spawned test.sh's flock prevents "a second suite joining".
  const child = spawn("bash", ["-c", command], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // AC5 (reason axis) — a signal-kill ⇒ red + reason=aborted (NO correctness conclusion), so the
  // inner's stop-dispatch does NOT fire on an abort. A previously-detected real failure (redDetected)
  // is never downgraded — the failure conclusion stands. abortDetected is the reason-axis marker for
  // an early-EXIT red (gap-suite-state-has-no-reason-axis-failed-aborted-infra): the suite emitted
  // an abort marker (e.g. test.sh's internal resource-gate WAIT) and never reached a correctness
  // conclusion — red + reason=aborted, NOT failed.
  let redDetected = false;
  let abortDetected = false;
  let runDone = false;
  // AC3b (gap-quality-criteria-are-point-in-time-no-trend-criteria): the ISO time the FIRST real
  // failure line flipped state to red — carried into the verification-round record so the early-RED
  // detection-latency trend (redAt − startedAt) is queryable without hand-digging logs. Null when
  // the run never went red on a real failure.
  let redAtIso: string | null = null;
  // failure-location capture: the FIRST failure line + its detail-block file context
  // (gap-red-window-dispatch-stop-should-be-shared-gate-conditional).
  const redFailures: SuiteFailure[] = [];
  let pendingFailure: SuiteFailure | null = null;
  let detailRemaining = 0;
  // AC1 (gap-quality-criteria-are-point-in-time-no-trend-criteria) — per-run metric recording.
  // Parsed from the suite's TAP summary (`# tests N`, `# cancelled N`) so the verification-round
  // record carries tests/cancelled/perTestMs — the input of the trend criterion (trend-check.ts).
  let testsSeen = 0;
  let cancelledSeen = 0;
  const onSignal = (sig: string) => {
    if (runDone || redDetected) return;
    const at = new Date().toISOString();
    writeSuiteState({
      state: "red",
      reason: "aborted",
      ...base,
      finishedAt: at,
      durationMs: Date.parse(at) - Date.parse(startedAt),
    });
    process.stderr.write(
      `full-suite-runner: ${sig} received -> state=red reason=aborted (no correctness conclusion)\n`
    );
    process.exit(1);
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  // Tee the suite output to the log (the outer's verification gate greps it for the
  // 判绿 markers), and flip red the instant a failure line appears (AC2).
  const logStream = fs.createWriteStream(logFile, { flags: "w" });

  // AC6 (gap-no-criterion-records-its-own-cost-checker-cost-jsonl) — per-run pass/fail/cancelled
  // tallies from the TAP summary lines (`# pass N` / `# fail N` / `# cancelled N`), carried into the
  // append-only verification-round record so the suite's duration sequence is queryable by pass/fail.
  let tapPass = 0;
  let tapFail = 0;
  let tapCancelled = 0;

  const onLine = (line: string) => {
    logStream.write(line + "\n");
    const passM = line.match(/^#\s*pass\s+(\d+)/);
    if (passM) tapPass = Number(passM[1]);
    const failM = line.match(/^#\s*fail\s+(\d+)/);
    if (failM) tapFail = Number(failM[1]);
    const cancelledM = line.match(/^#\s*cancelled\s+(\d+)/);
    if (cancelledM) tapCancelled = Number(cancelledM[1]);
    // Enrich a pending failure with its file context (TAP detail block / stack frames follow the
    // `not ok` line; the file is NOT on the failure line itself). Best-effort, bounded lookahead.
    if (pendingFailure && detailRemaining > 0) {
      detailRemaining--;
      if (!pendingFailure.file) {
        const f = extractFailureFile(line, root);
        if (f) {
          // Enrich with the KNOWN-LOAD-SENSITIVE partition once the file context resolves, and
          // update the failure in redFailures in place so the state carries it (AC3).
          const enriched = enrichFailure({ ...pendingFailure, file: f });
          pendingFailure.file = f;
          const idx = redFailures.indexOf(pendingFailure);
          if (idx !== -1) redFailures[idx] = enriched;
          // file found — re-write state so the SUITE-RED event carries it (idempotent).
          writeSuiteState({ state: "red", reason: "failed", ...base, finishedAt: null, durationMs: null, failures: redFailures });
        }
      }
      if (detailRemaining <= 0) pendingFailure = null;
    }
    // AC1 — TAP summary parsing: `# tests N` / `# cancelled N` (node:test emits these on the
    // stream regardless of pass/fail). Fires on every line; a later summary overwrites an earlier
    // one (TAP prints exactly one summary, but a failing worker may print its own before the root).
    const testsMatch = /^#\s*tests\s+(\d+)/.exec(line);
    if (testsMatch) testsSeen = Number(testsMatch[1]);
    const cancelledMatch = /^#\s*cancelled\s+(\d+)/.exec(line);
    if (cancelledMatch) cancelledSeen = Number(cancelledMatch[1]);
    if (!redDetected && isFailureLine(line)) {
      redDetected = true;
      // AC3b — timestamp the red flip (the early-RED detection-latency observation point).
      redAtIso = new Date().toISOString();
      // AC2 — mark RED immediately, while the run is still in progress. reason=failed (AC5: this
      // IS a real failure — the stop-dispatch signal). Record the failure LINE (the 判定信息 —
      // which test failed is already known) + open a short detail lookahead for the file context.
      // A file on the failure line itself (vitest `❯ <file>` / `test at <file>`) is captured now;
      // TAP detail-block files are captured by the lookahead.
      const failure: SuiteFailure = enrichFailure({ line, file: extractFailureFile(line, root) });
      redFailures.push(failure);
      pendingFailure = failure;
      detailRemaining = 15;
      writeSuiteState({
        state: "red",
        reason: "failed",
        ...base,
        finishedAt: null,
        durationMs: null,
        failures: redFailures,
      });
      process.stderr.write(
        `full-suite-runner: FAILURE detected on stream -> state=red reason=failed (run still in progress)\n  ${line}\n`
      );
    } else if (!redDetected && !abortDetected && isAbortLine(line)) {
      // AC5 reason axis (gap-suite-state-has-no-reason-axis-failed-aborted-infra AC1/AC3): an ABORT
      // marker on the stream (e.g. test.sh's internal resource-gate WAIT fail-closed — the suite
      // exited in seconds WITHOUT running tests) means NO correctness conclusion: red + reason=aborted,
      // NOT failed. A real failure line is never downgraded (the `!redDetected` guard). A later real
      // failure line still upgrades to failed (the first branch checks redDetected, not abortDetected).
      abortDetected = true;
      writeSuiteState({ state: "red", reason: "aborted", ...base, finishedAt: null, durationMs: null });
      process.stderr.write(
        `full-suite-runner: ABORT marker detected on stream -> state=red reason=aborted (no correctness conclusion)\n  ${line}\n`
      );
    }
  };

  const outRl = readline.createInterface({ input: child.stdout });
  const errRl = readline.createInterface({ input: child.stderr });
  outRl.on("line", onLine);
  errRl.on("line", onLine);

  let spawnError: Error | null = null;
  child.on("error", (err) => {
    spawnError = err;
    redDetected = true;
    // AC5 (reason axis) — a spawn error means the suite never ran: NO correctness conclusion.
    writeSuiteState({
      state: "red",
      reason: "aborted",
      ...base,
      finishedAt: null,
      durationMs: null,
    });
    process.stderr.write(`full-suite-runner: spawn error -> state=red reason=aborted\n  ${String(err)}\n`);
  });

  const exit: { code: number | null; signal: NodeJS.Signals | null } = await new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const exitCode = exit.code;

  runDone = true;
  // Fan-in race fix (2026-08-05): do NOT remove the signal listeners here. The `if (runDone ||
  // redDetected) return` guard in onSignal already makes a late signal a no-op, so keeping the
  // listeners registered is safe AND closes the unhandled-signal window: previously a SIGTERM
  // landing between this removal and the final state write hit the DEFAULT handler, killing the
  // runner with state=running still on disk (AC5 intermittent failure).

  // Flush the log stream before writing the final verdict.
  await new Promise<void>((resolve) => logStream.end(resolve));

  const finishedAt = new Date().toISOString();
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);

  // AC1/判绿 — green ONLY if no failure/abort marker was detected, no spawn error, and the suite
  // exited 0. Red carries the three-value reason axis (AC5, gap-suite-state-has-no-reason-axis-
  // failed-aborted-infra AC1/AC3):
  //   - redDetected (a real failure line)      ⇒ reason=failed   (stop-dispatch signal).
  //   - abortDetected / spawnError / the child killed by a signal (code null) ⇒ reason=aborted
  //     (NO correctness conclusion — early-EXIT red is an abort, not a failure).
  //   - a generic non-zero exit with NEITHER marker ⇒ reason=failed (fail-closed catch-all: a
  //     failure we could not match a structured line for is still a failure conclusion).
  // AC5 reason-axis (gap-suite-cutoff-what-tears-test-process-at-session-topology, confirmed
  // 2026-08-07): a signal-kill is an ABORT (NO correctness conclusion), never a failure — but the
  // runner's child is `bash -c <test.sh>`, and when test.sh's own node --test CHILD is SIGKILL'd
  // (07:08→07:21 suite: `scripts/test.sh: line 576: 720326 Killed node --test`), bash reports it as
  // ITS OWN exit code 128+N (137 for SIGKILL, 143 for SIGTERM), so exit.code !== null AND
  // exit.signal === null while still being a signal-kill. Detect all three shapes:
  //   1. direct signal-kill: node reports code=null + signal=<sig>;           (pre-existing path)
  //   2. the close event carried a signal (exit.signal captured at :539, never classified before);
  //   3. shell 128+N convention (128+1..128+64, the signal range) — the bash-exits-137 case.
  const childKilledBySignal =
    (exitCode === null && spawnError === null) ||
    exit.signal !== null ||
    (exitCode !== null && exitCode > 128 && exitCode <= 192);
  const green = !redDetected && !abortDetected && spawnError === null && exitCode === 0;
  // No correctness conclusion (abort) iff: an abort marker was seen, OR the child was killed by a
  // signal (code null), OR it never spawned. A REAL failure conclusion (redDetected) is never
  // downgraded by an earlier abort marker — redDetected dominates (AC5: failure conclusion stands).
  const noCorrectnessConclusion =
    !redDetected && (abortDetected || childKilledBySignal || spawnError !== null);
  const finalState: SuiteState = green
    ? { state: "green", ...base, finishedAt, durationMs }
    : {
        state: "red",
        reason: noCorrectnessConclusion ? "aborted" : "failed",
        ...base,
        finishedAt,
        durationMs,
        // carry the failure location(s) — the SUITE-RED event's failureLocation source
        ...(spawnError === null ? { failures: redFailures } : {}),
      };
  writeSuiteState(finalState);
  // AC6 — append the run to the suite-duration SEQUENCE (never overwrite the single-state file).
  // The full-suite-state.json's durationMs is this run's point value; verification-round.jsonl keeps
  // the history so the sequence survives rounds (gap-no-criterion-records-its-own-cost AC6).
  // AC1 (gap-quality-criteria-are-point-in-time-no-trend-criteria) — extend the sequence record
  // with the suite's total test count and per-test cost so the AC2 trend axis (per_test_ms) is
  // comparable across rounds of different sizes. `tests` = pass+fail+cancelled; per_test_ms =
  // durationMs/tests (0 when no tests ran — a no-test run says nothing about per-test cost).
  const tapTests = tapPass + tapFail + tapCancelled;
  appendVerificationRound(stateDir, {
    round: 0, // computed from prior line count inside appendVerificationRound
    startedAt,
    durationMs,
    laneCount,
    pass: tapPass,
    fail: tapFail,
    cancelled: tapCancelled,
    tests: tapTests,
    per_test_ms: tapTests > 0 ? Number((durationMs / tapTests).toFixed(3)) : 0,
    redAt: redAtIso,
    load: readLoadAvg(),
    state: finalState.state,
    reason: finalState.reason ?? null,
    runner: base.runner,
    scope,
  });
  // NOTE: appendVerificationRound above is the ONE suite-duration append per run (the
  // checker-cost.test.mjs AC6 contract: two runs ⇒ exactly two verification-round.jsonl lines).
  // The now-removed appendSuiteDurationRecord call wrote a SECOND record to the SAME file every
  // run — 2 runs produced 4 lines and AC6's "pure append, one per run" assertion failed. The
  // appendVerificationRound record is the canonical shape (state/pass/fail/round); the other
  // function is retained as an exported helper only (no live callers).
  process.stderr.write(
    `full-suite-runner: FINAL state=${finalState.state}${finalState.reason ? ` reason=${finalState.reason}` : ""} durationMs=${durationMs} exit=${exitCode}\n`
  );
  return green ? 0 : 1;
}

/**
 * AC6 (gap-no-criterion-records-its-own-cost-checker-cost-jsonl) — append ONE suite-duration row
 * to .quay/verification-round.jsonl on EVERY suite completion (pure append; NEVER overwrites the
 * single-state full-suite-state.json). This closes the "sequence stopped at 05:03" defect: the
 * outer's closure pass could be blocked by a red window and skip its write, but the runner is a
 * separate process that ALWAYS finishes, so the duration history can no longer die mid-sequence.
 * Row shape: {round, startedAt, durationMs, laneCount, pass, fail, load, at, tests?, cancelled?,
 * perTestMs?} — round = last-round+1 (same rule the outer closure pass uses), load = /proc/loadavg
 * 1-min at finish. tests/cancelled/perTestMs are AC1 (gap-quality-criteria-are-point-in-time-no-trend-
 * criteria): the per-run metrics that feed the trend criterion (trend-check.ts).
 */
export function appendSuiteDurationRecord(
  root: string,
  opts: {
    startedAt: string;
    durationMs: number;
    laneCount: number;
    green: boolean;
    tests?: number;
    cancelled?: number;
  },
): void {
  const file = path.resolve(root, ".quay", "verification-round.jsonl");
  let round = 1;
  try {
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const r = JSON.parse(lines[i]);
          if (typeof r?.round === "number") {
            round = r.round + 1;
            break;
          }
        } catch {
          // malformed line — keep scanning backwards for the last valid round
        }
      }
    }
  } catch {
    // fail-open: never break the suite verdict on a round-record write
  }
  // AC1 (gap-quality-criteria-are-point-in-time-no-trend-criteria): extend the round record with
  // tests/cancelled/perTestMs — the per-run metrics that make the TREND criterion (trend-check.ts)
  // possible. perTestMs = durationMs / tests (ms per test); omitted when tests is absent/0 so a
  // legacy-format row without counts stays parseable. Optional fields are included only when
  // present — existing readers that assert exact fields (checker-cost.test.mjs AC6) keep passing.
  const perTestMs =
    opts.tests !== undefined && opts.tests > 0 && opts.durationMs > 0
      ? Math.round((opts.durationMs / opts.tests) * 1000) / 1000
      : undefined;
  const rec: Record<string, unknown> = {
    round,
    startedAt: opts.startedAt,
    durationMs: opts.durationMs,
    laneCount: opts.laneCount,
    pass: opts.green ? 1 : 0,
    fail: opts.green ? 0 : 1,
    load: getLoad1(),
    at: new Date().toISOString(),
  };
  if (opts.tests !== undefined) rec.tests = opts.tests;
  if (opts.cancelled !== undefined) rec.cancelled = opts.cancelled;
  if (perTestMs !== undefined) rec.perTestMs = perTestMs;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
  } catch {
    // fail-open
  }
}

/**
 * --fail-fast-check（gap-red-window-has-no-automatic-executor Contract invoke）：
 * 构造一次失败 suite ⇒ 验证 RED 自动触发链端到端：
 *   runner 写 state=red → suite-state-trigger 的 runOnce 检测到转变 →
 *   记 SUITE-RED 事件 → stopSignal 在位（state=red + reason=failed 即信号，AC1(b)/AC5）。
 * 用临时根（hermetic），不触碰真实 `.quay/full-suite-state.json`。退出 0 = 链验证通过；
 * 退出非 0 = 链某环断裂（触发者坏了，外层据此知道机制失效，而不是红着无人处置）。
 */
async function failFastCheck(): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ffc-"));
  try {
    const fakeCommand = 'echo "not ok 1 - fail-fast-check (RED auto-trigger control)"; exit 1';
    // --fail-fast-check is a lightweight hermetic control (NOT a heavy full-suite op) — it must skip
    // the resource gate (run() checks argv for the marker), so a loaded machine cannot make the
    // Contract self-check flake on a WAIT.
    const code = await run(["--root", tmp, "--command", fakeCommand, "--fail-fast-check"]);
    const { status, events, stopSignal } = runOnce(tmp);
    const redEv = events.find((e) => e.event === "SUITE-RED") ?? null;
    const failures = redEv?.state?.failures ?? redEv?.failureLocation ?? [];
    console.log(
      `fail-fast-check: suite exit=${code} state=${status} reason=${redEv?.state?.reason ?? "?"} stopSignal=${stopSignal} ` +
        `failures=${failures.length} suiteRedEvent=${redEv ? `recorded early=${redEv.early}` : "MISSING"} events=${events.length}`,
    );
    if (code !== 1) {
      console.error("fail-fast-check FAIL: expected the fake suite to exit 1 (red)");
      return 1;
    }
    if (status !== "red") {
      console.error(`fail-fast-check FAIL: expected state=red, got ${status}`);
      return 1;
    }
    if (!stopSignal) {
      console.error("fail-fast-check FAIL: expected stopSignal (state=red + reason=failed IS the stop-dispatch signal)");
      return 1;
    }
    if (!redEv) {
      console.error("fail-fast-check FAIL: expected a SUITE-RED event recorded by suite-state-trigger");
      return 1;
    }
    if (redEv.state?.reason !== "failed") {
      console.error(`fail-fast-check FAIL: expected reason=failed on the red state, got ${redEv.state?.reason}`);
      return 1;
    }
    if (failures.length === 0) {
      console.error(
        "fail-fast-check FAIL: expected the SUITE-RED event to carry the failure location (state.failures / failureLocation) — the red-window dispatch decision needs it",
      );
      return 1;
    }
    console.log("fail-fast-check OK: runner wrote state=red reason=failed → trigger recorded SUITE-RED → stopSignal in place + failureLocation carried");
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * --wait-check（gap-full-suite-runner-marks-test-sh-gate-wait-as-failed Contract measure）：
 * 构造一次 test.sh INTERNAL gate-WAIT 场景（WAIT 标记 + exit 1，一行测试都没跑）⇒ 验证 ABORT 链
 * 端到端：
 *   runner 写 state=red reason=aborted → suite-state-trigger 的 runOnce 检测到转变 →
 *   记 SUITE-RED 事件 → stopSignal 缺位（aborted ≠ 代码风险信号，不设 stop-dispatch）。
 * 用临时根（hermetic），不触碰真实 `.quay/full-suite-state.json`。退出 0 = ABORT 链验证通过；
 * 退出非 0 = 链某环断裂（gate-WAIT 假红再现——reason-axis 的残余缺口）。这是 --fail-fast-check
 * （FAILED 链）的 ABORT 侧孪生控制。
 */
async function waitCheck(): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wc-"));
  try {
    // The concrete 17:46Z FALSE-RED shape: test.sh's INTERNAL resource-gate fail-closed prints the
    // WAIT marker to stderr and exits 1 in ~6s WITHOUT running a single test. The runner must classify
    // this as reason=aborted (NO correctness conclusion), never failed — a failed label would stop
    // dispatch on code risk with zero evidence.
    const fakeCommand =
      'echo "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO." >&2; exit 1';
    // --wait-check is a lightweight hermetic control (NOT a heavy full-suite op) — it must skip the
    // resource gate (run() checks argv for the marker), so a loaded machine cannot make the Contract
    // self-check flake on a WAIT.
    const code = await run(["--root", tmp, "--command", fakeCommand, "--wait-check"]);
    const { status, events, stopSignal } = runOnce(tmp);
    const redEv = events.find((e) => e.event === "SUITE-RED") ?? null;
    console.log(
      `wait-check: suite exit=${code} state=${status} reason=${redEv?.state?.reason ?? "?"} stopSignal=${stopSignal} ` +
        `suiteRedEvent=${redEv ? `recorded early=${redEv.early}` : "MISSING"} events=${events.length}`,
    );
    if (code !== 1) {
      console.error("wait-check FAIL: expected the fake gate-WAIT suite to exit 1 (red)");
      return 1;
    }
    if (status !== "red") {
      console.error(`wait-check FAIL: expected state=red, got ${status}`);
      return 1;
    }
    if (!redEv) {
      console.error("wait-check FAIL: expected a SUITE-RED event recorded by suite-state-trigger (red still noticed, routed by reason)");
      return 1;
    }
    if (redEv.state?.reason !== "aborted") {
      console.error(
        `wait-check FAIL: expected reason=aborted on the red state (gate-WAIT = NO correctness conclusion), got ${redEv.state?.reason}`,
      );
      return 1;
    }
    if (stopSignal) {
      console.error("wait-check FAIL: expected NO stopSignal (aborted must NOT stop dispatch on code risk)");
      return 1;
    }
    console.log("wait-check OK: runner wrote state=red reason=aborted → trigger recorded SUITE-RED → stopSignal absent (no stop-dispatch)");
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const argv = process.argv.slice(2);
  const exitCode = argv.includes("--fail-fast-check")
    ? await failFastCheck()
    : argv.includes("--wait-check")
      ? await waitCheck()
      : await run(argv);
  process.exit(exitCode);
}
