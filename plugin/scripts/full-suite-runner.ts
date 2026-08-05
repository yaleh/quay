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
//     [--lane-count <n>]             # default: 8 (canonical full-suite concurrency)
//     [--root <path>]                # workspace root (test-hermetic; default repo root)
//     [--sync]                       # wait for the suite to finish before exiting
//
// Exit: 0 if the suite is green, 1 if red. The durable signal the inner reads is the
// state file, not the exit code.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { runOnce } from "./suite-state-trigger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type SuiteStateValue = "running" | "green" | "red";

export interface SuiteState {
  state: SuiteStateValue;
  runner: "outer" | "inner";
  startedAt: string; // ISO 8601
  finishedAt: string | null; // ISO 8601; null while running
  durationMs: number | null; // finishedAt - startedAt; null while running
  laneCount: number;
}

// AC2 — failure markers that flip state to red the MOMENT they appear on the suite's
// stdout/stderr stream, never waiting for the run to finish. These are the concrete
// node:test/TAP markers plus the repo's own FULL-SUITE-EXIT marker. A generic
// non-zero exit code is the catch-all for failures no line matched (applied at exit).
const FAILURE_PATTERNS: RegExp[] = [
  /^not ok\b/, // node:test / TAP per-test failure
  /✖/, // node:test failure glyph
  /^#\s*fail\s+[1-9]/, // TAP summary: # fail 1+
  /^#\s*cancelled\s+[1-9]/, // TAP summary: # cancelled 1+ (cancelled is a failure even when fail 0)
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

export async function run(argv: string[]): Promise<number> {
  const root = path.resolve(parseArg(argv, "--root") ?? REPO_ROOT);
  const command = parseArg(argv, "--command") ?? "bash scripts/test.sh";
  const stateFile = path.resolve(root, parseArg(argv, "--state-file") ?? ".quay/full-suite-state.json");
  const logFile = path.resolve(root, parseArg(argv, "--log-file") ?? ".quay/full-suite.log");
  const laneCount = Number(parseArg(argv, "--lane-count") ?? "8");

  const startedAt = new Date().toISOString();
  const base = { runner: "outer" as const, startedAt, laneCount };

  // AC1 — write `running` the moment the runner starts (inner sees running => proceed).
  writeState(stateFile, { state: "running", ...base, finishedAt: null, durationMs: null });

  const child = spawn("bash", ["-c", command], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Tee the suite output to the log (the outer's verification gate greps it for the
  // 判绿 markers), and flip red the instant a failure line appears (AC2).
  const logStream = fs.createWriteStream(logFile, { flags: "w" });
  let redDetected = false;

  const onLine = (line: string) => {
    logStream.write(line + "\n");
    if (!redDetected && isFailureLine(line)) {
      redDetected = true;
      // AC2 — mark RED immediately, while the run is still in progress.
      writeState(stateFile, { state: "red", ...base, finishedAt: null, durationMs: null });
      process.stderr.write(
        `full-suite-runner: FAILURE detected on stream -> state=red (run still in progress)\n  ${line}\n`
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
    writeState(stateFile, { state: "red", ...base, finishedAt: null, durationMs: null });
    process.stderr.write(`full-suite-runner: spawn error -> state=red\n  ${String(err)}\n`);
  });

  const exitCode: number | null = await new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
  });

  // Flush the log stream before writing the final verdict.
  await new Promise<void>((resolve) => logStream.end(resolve));

  const finishedAt = new Date().toISOString();
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);

  // AC1/判绿 — green ONLY if no failure line was detected AND the suite exited 0.
  const green = !redDetected && spawnError === null && exitCode === 0;
  const finalState: SuiteState = {
    state: green ? "green" : "red",
    ...base,
    finishedAt,
    durationMs,
  };
  writeState(stateFile, finalState);
  process.stderr.write(
    `full-suite-runner: FINAL state=${finalState.state} durationMs=${durationMs} exit=${exitCode}\n`
  );
  return green ? 0 : 1;
}

/**
 * --fail-fast-check（gap-red-window-has-no-automatic-executor Contract invoke）：
 * 构造一次失败 suite ⇒ 验证 RED 自动触发链端到端：
 *   runner 写 state=red（早期或终态）→ suite-state-trigger 的 runOnce 检测到转变 →
 *   记 SUITE-RED 事件 → stopSignal 在位（state=red 即信号，AC1(b)）。
 * 用临时根（hermetic），不触碰真实 `.quay/full-suite-state.json`。退出 0 = 链验证通过；
 * 退出非 0 = 链某环断裂（触发者坏了，外层据此知道机制失效，而不是红着无人处置）。
 */
async function failFastCheck(): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ffc-"));
  try {
    const fakeCommand = 'echo "not ok 1 - fail-fast-check (RED auto-trigger control)"; exit 1';
    const code = await run(["--root", tmp, "--command", fakeCommand]);
    const { status, events, stopSignal } = runOnce(tmp);
    const redEv = events.find((e) => e.event === "SUITE-RED") ?? null;
    console.log(
      `fail-fast-check: suite exit=${code} state=${status} stopSignal=${stopSignal} ` +
        `suiteRedEvent=${redEv ? `recorded early=${redEv.early}` : "MISSING"} events=${events.length}`,
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
      console.error("fail-fast-check FAIL: expected stopSignal (state=red IS the stop-dispatch signal)");
      return 1;
    }
    if (!redEv) {
      console.error("fail-fast-check FAIL: expected a SUITE-RED event recorded by suite-state-trigger");
      return 1;
    }
    console.log("fail-fast-check OK: runner wrote state=red → trigger recorded SUITE-RED → stopSignal in place");
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
