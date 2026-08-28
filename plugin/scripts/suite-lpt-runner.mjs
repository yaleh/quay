// suite-lpt-runner.mjs — run an EXPLICIT file list through node:test's run({files}) so the
// M-bucket LPT order survives (gap-m-bucket-long-tail-lpt-scheduling).
//
// `node --test <file1> <file2> ...` treats positional args as globPatterns → createTestFileList()
// → ArrayPrototypeSort ⇒ the argv order is DISCARDED (alphabetical). run({files}) passes the array
// straight through (`let testFiles = files ?? createTestFileList(...)`) ⇒ ORDER IS PRESERVED — the
// whole mechanism of this task. scripts/test.sh --buckets LPT-orders the selected list (via
// suite-lpt-order.ts) and hands it here, so the longest-KNOWN files spawn FIRST and overlap the
// short tail instead of serializing at the end (measured round 474/476/478: last 5% of files =
// 27%+ of wall clock). run() is a shared work queue with dynamic list scheduling — a lane that
// frees up pulls the next queued file, so it is naturally immune to per-file duration drift.
//
// Concurrency is read from process.execArgv `--test-concurrency=N` (test.sh invokes
// `node --test-concurrency=N suite-lpt-runner.mjs ...`), NOT from an argv flag, so the
// measure-suite-reporter.mjs composed below reads the SAME value for its __GROUP__ floor/ceiling —
// one source, no reporter change, no drift.
//
// Reporters are wired with stream.compose (NOT --test-reporter CLI flags, which run() ignores):
//   spec → stdout          (the outer runner greps it for 判绿 markers)
//   perFileReporter → stderr (__PERFILE__ duration_ms=<d> <path> passed=<bool> — the fix-scope
//     gate's per-file attribution AND the LPT ordering's own input carrier; if this breaks the
//     per-file duration data goes dark and LPT has no input ⇒ self-defeating)
//
// Exit code: non-zero iff any test failed (tracked via the stream's test:fail events).
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { basename } from "node:path";
import perFileReporter from "./measure-suite-reporter.mjs";

/** Read `--test-concurrency=N` from process.execArgv (both = and space spellings) — the SAME
 *  parse as measure-suite-reporter.mjs's readConcurrency(), so the runner's run() concurrency and
 *  the reporter's __GROUP__ concurrency can never disagree. */
export function readConcurrencyFromExecArgv() {
  const argv = process.execArgv ?? [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--test-concurrency=")) {
      const n = Number(a.slice("--test-concurrency=".length));
      if (Number.isInteger(n) && n >= 1) return n;
    }
    if (a === "--test-concurrency" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isInteger(n) && n >= 1) return n;
    }
  }
  return 1; // default: serial semantics — safest when unknown
}

/** Parse the runner's argv: positional args are test files; --test-name-pattern[=]<pat> maps to
 *  run()'s testNamePatterns; --test-concurrency[=]<n> is IGNORED (it rides in execArgv, the single
 *  source); any other --flag has no run() equivalent and is skipped rather than misread as a file. */
export function parseRunnerArgs(argv) {
  const files = [];
  const testNamePatterns = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--test-concurrency" || a.startsWith("--test-concurrency=")) {
      if (a === "--test-concurrency" && i + 1 < argv.length) i++; // consume the space-spelling value
      continue;
    }
    if (a === "--test-name-pattern" && i + 1 < argv.length) {
      testNamePatterns.push(argv[++i]);
      continue;
    }
    if (a.startsWith("--test-name-pattern=")) {
      testNamePatterns.push(a.slice("--test-name-pattern=".length));
      continue;
    }
    if (a.startsWith("--")) continue; // unknown pass-through flag — skip
    files.push(a);
  }
  return { files, testNamePatterns };
}

/** Run the given files through node:test run({files}) with BOTH reporters composed, returning the
 *  number of failed tests (0 ⇒ green). Exported so the AC1/AC2/AC5 synthetic-probe tests can drive
 *  the real runner programmatically. */
export async function runOrderedSuite({ files, concurrency, testNamePatterns = [] }) {
  const opts = { files, concurrency, isolation: "process" };
  if (testNamePatterns.length > 0) opts.testNamePatterns = testNamePatterns;
  const stream = run(opts);
  stream.compose(spec).pipe(process.stdout);
  stream.compose(perFileReporter).pipe(process.stderr);
  let failed = 0;
  stream.on("test:fail", () => {
    failed += 1;
  });
  await new Promise((resolve) => stream.on("end", resolve));
  return failed;
}

async function main() {
  const concurrency = readConcurrencyFromExecArgv();
  const { files, testNamePatterns } = parseRunnerArgs(process.argv);
  if (files.length === 0) {
    process.stderr.write("suite-lpt-runner: no test files given (invoke via scripts/test.sh --buckets <task>)\n");
    process.exitCode = 2;
    return;
  }
  const failed = await runOrderedSuite({ files, concurrency, testNamePatterns });
  process.exitCode = failed > 0 ? 1 : 0;
}

// Direct-entry guard (same shape as gate-script-base.ts isDirectEntry's expectedBase branch).
const entry = process.argv[1];
const isDirect = entry != null && basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === "suite-lpt-runner";
if (isDirect) main();
