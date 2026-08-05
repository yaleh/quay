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
//   AC1 — the default laneCount is NPROC-DERIVED (max(1, floor(nproc / 2.1)) — the SAME
//         derivation as test.sh's AC5), NOT the hardcoded 8. On this box nproc=4 ⇒ 1.
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
//     [--state-file <path>]          # default: .quay/full-suite-state.json
//     [--log-file <path>]            # default: .quay/full-suite.log
//     [--lane-count <n>]             # default: max(1, floor(nproc/2.1)) (nproc-derived, AC1)
//     [--root <path>]                # workspace root (test-hermetic; default repo root)
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type SuiteStateValue = "running" | "green" | "red";
export type SuiteStateReason = "failed" | "aborted";

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
}

export interface SuiteState {
  state: SuiteStateValue;
  runner: "outer" | "inner";
  startedAt: string; // ISO 8601
  finishedAt: string | null; // ISO 8601; null while running
  durationMs: number | null; // finishedAt - startedAt; null while running
  laneCount: number;
  /**
   * Present only on red (AC5 reason axis). "failed" = a real failure was detected (the
   * stop-dispatch signal). "aborted" = the run produced NO correctness conclusion (spawn
   * error / signal kill) and MUST NOT trigger stop-dispatch (gap-full-suite-runner-
   * concurrency-default-and-gate AC5). Legacy red states without `reason` are treated as
   * "failed" (fail-closed toward stopping) by shouldStopDispatch.
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

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

function writeState(file: string, state: SuiteState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
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

// ── AC1/AC2: nproc-derived default laneCount + REPLACE splice ───────────────────────────────────────

/**
 * AC1 — the DEFAULT laneCount is nproc-derived, using the SAME formula as test.sh's AC5
 * derivation: max(1, floor(nproc / 2.1)). The old hardcoded 8 was a 4.25× oversubscription on a
 * 4-core box (8 workers + spawned subprocesses = 17 processes, PSI 88 — the crash family behind
 * ABORT #1/#3/#4/#5). RESOURCE_GATE_NPROC / RESOURCE_GATE_AMPLIFICATION are the deterministic test
 * seams (the same env test.sh's default_concurrency_formula reads).
 */
export function defaultLaneCount(): number {
  const ncpuRaw = process.env.RESOURCE_GATE_NPROC ?? String(
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
  );
  const ncpu = Number(ncpuRaw);
  const ampRaw = Number(process.env.RESOURCE_GATE_AMPLIFICATION ?? "2.1");
  const amp = Number.isFinite(ampRaw) && ampRaw > 0 ? ampRaw : 2.1;
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
 * AC3 — consult the shared resource gate BEFORE starting the full suite. WAIT (non-zero exit) ⇒
 * the runner must NOT start; the state file is left untouched (still running/green), and the runner
 * exits non-zero so the caller re-ticks. The gate is the REAL plugin/scripts/resource-gate.sh (its
 * RESOURCE_GATE_TEST_* env seams flow through for deterministic tests). QUAY_TEST_SKIP_RESOURCE_GATE=1
 * is the test escape hatch (same env test.sh honors).
 */
export function checkResourceGate(root: string): { ok: boolean; output: string } {
  const gate = path.join(__dirname, "resource-gate.sh");
  try {
    const output = execFileSync("bash", [gate, "--for", "full-suite"], {
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

  const stateFile = path.resolve(root, parseArg(argv, "--state-file") ?? ".quay/full-suite-state.json");
  const logFile = path.resolve(root, parseArg(argv, "--log-file") ?? ".quay/full-suite.log");

  // AC3 — the resource gate MUST be consulted BEFORE the suite starts (state=running is written
  // AFTER the gate, so a WAIT leaves the previous state — running/green — untouched). --fail-fast-check
  // is a lightweight hermetic control, not a heavy op — it skips the gate.
  const skipGate = process.env.QUAY_TEST_SKIP_RESOURCE_GATE === "1" || argv.includes("--fail-fast-check");
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
  const base = { runner: "outer" as const, startedAt, laneCount };

  // AC1 — write `running` the moment the runner starts (inner sees running => proceed).
  writeState(stateFile, { state: "running", ...base, finishedAt: null, durationMs: null });

  const child = spawn("bash", ["-c", command], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // AC5 (reason axis) — a signal-kill ⇒ red + reason=aborted (NO correctness conclusion), so the
  // inner's stop-dispatch does NOT fire on an abort. A previously-detected real failure (redDetected)
  // is never downgraded — the failure conclusion stands.
  let redDetected = false;
  let runDone = false;
  // failure-location capture: the FIRST failure line + its detail-block file context
  // (gap-red-window-dispatch-stop-should-be-shared-gate-conditional).
  const redFailures: SuiteFailure[] = [];
  let pendingFailure: SuiteFailure | null = null;
  let detailRemaining = 0;
  const onSignal = (sig: string) => {
    if (runDone || redDetected) return;
    const at = new Date().toISOString();
    writeState(stateFile, {
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

  const onLine = (line: string) => {
    logStream.write(line + "\n");
    // Enrich a pending failure with its file context (TAP detail block / stack frames follow the
    // `not ok` line; the file is NOT on the failure line itself). Best-effort, bounded lookahead.
    if (pendingFailure && detailRemaining > 0) {
      detailRemaining--;
      if (!pendingFailure.file) {
        const f = extractFailureFile(line, root);
        if (f) {
          pendingFailure.file = f;
          // file found — re-write state so the SUITE-RED event carries it (idempotent).
          writeState(stateFile, { state: "red", reason: "failed", ...base, finishedAt: null, durationMs: null, failures: redFailures });
        }
      }
      if (detailRemaining <= 0) pendingFailure = null;
    }
    if (!redDetected && isFailureLine(line)) {
      redDetected = true;
      // AC2 — mark RED immediately, while the run is still in progress. reason=failed (AC5: this
      // IS a real failure — the stop-dispatch signal). Record the failure LINE (the 判定信息 —
      // which test failed is already known) + open a short detail lookahead for the file context.
      // A file on the failure line itself (vitest `❯ <file>` / `test at <file>`) is captured now;
      // TAP detail-block files are captured by the lookahead.
      const failure: SuiteFailure = { line, file: extractFailureFile(line, root) };
      redFailures.push(failure);
      pendingFailure = failure;
      detailRemaining = 15;
      writeState(stateFile, {
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
    writeState(stateFile, {
      state: "red",
      reason: "aborted",
      ...base,
      finishedAt: null,
      durationMs: null,
    });
    process.stderr.write(`full-suite-runner: spawn error -> state=red reason=aborted\n  ${String(err)}\n`);
  });

  const exitCode: number | null = await new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
  });

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

  // AC1/判绿 — green ONLY if no failure line was detected AND the suite exited 0. Red carries the
  // reason axis (AC5): a spawn error (never started) is aborted; anything else with a red verdict
  // (detected failure line or non-zero exit) is failed.
  const green = !redDetected && spawnError === null && exitCode === 0;
  const finalState: SuiteState = green
    ? { state: "green", ...base, finishedAt, durationMs }
    : {
        state: "red",
        reason: spawnError !== null ? "aborted" : "failed",
        ...base,
        finishedAt,
        durationMs,
        // carry the failure location(s) — the SUITE-RED event's failureLocation source
        ...(spawnError === null ? { failures: redFailures } : {}),
      };
  writeState(stateFile, finalState);
  process.stderr.write(
    `full-suite-runner: FINAL state=${finalState.state}${finalState.reason ? ` reason=${finalState.reason}` : ""} durationMs=${durationMs} exit=${exitCode}\n`
  );
  return green ? 0 : 1;
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

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const argv = process.argv.slice(2);
  const exitCode = argv.includes("--fail-fast-check") ? await failFastCheck() : await run(argv);
  process.exit(exitCode);
}
