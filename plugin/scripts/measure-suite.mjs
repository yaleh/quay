#!/usr/bin/env node
// measure-suite.mjs — capture per-file duration_ms + wall-clock for the FULL suite.
//
// Task: gap-suite-cost-model-is-wrong-optimizations-buy-nothing (AC1/AC2/AC3)
// Usage:  node plugin/scripts/measure-suite.mjs [--json]
//
// Runs the canonical test.sh file list (same glob/dedup/group logic, via
// `scripts/test.sh --list-files`) under `node --test --test-concurrency=8` with a
// custom reporter (measure-suite-reporter.mjs) that emits the FILE-LEVEL duration of
// every test file as measured IN the concurrent run, then prints:
//   - wall-clock (real elapsed time of the node --test invocation)
//   - per-file duration_ms (descending) — from the reporter
//   - sum of duration_ms (total CPU-seconds) and ratio sum/wall-clock (≈ concurrency
//     if throughput-bound, <<8 if a serial section dominates)
//
// This is a MEASUREMENT script: it never modifies test files or assertions. It does
// NOT run the build_dist_once step or the split-or-commit scan (scripts/test.sh
// responsibilities); run `node packages/quay/scripts/build-dist.mjs` (and the native
// bundle) first so cli-entry.mjs routes through the fresh bundle.
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const reporterPath = path.join(repoRoot, "plugin", "scripts", "measure-suite-reporter.mjs");

const listOut = execFileSync("bash", ["scripts/test.sh", "--list-files"], {
  cwd: repoRoot,
  encoding: "utf8",
});
const files = listOut.split("\n").filter((l) => l.trim().length > 0);

const started = Date.now();
const res = spawnSync(
  "node",
  [
    "--test",
    "--test-concurrency=8",
    `--test-reporter=${reporterPath}`,
    "--test-reporter-destination=stderr",
    ...files,
  ],
  { cwd: repoRoot, encoding: "utf8", timeout: 25 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 }
);
const wallMs = Date.now() - started;

// ── Parse reporter lines: `__PERFILE__ duration_ms=<duration_ms> <full-path> <passed>`.
// (gap-install-suite-cost-instrument-reporter-not-wired AC2 — the reporter now emits
// `duration_ms=` BEFORE the path so every per-file line matches the contract measure
// `grep -cE "duration_ms.*test\.mjs|file.*duration"` in the real full-suite log.)
const durations = new Map(); // full path -> duration_ms
const passedMap = new Map(); // full path -> passed bool
const fileSet = new Set(files);
for (const line of String(res.stderr ?? "").split("\n")) {
  const m = line.match(/^__PERFILE__ duration_ms=([0-9.]+) (\S+) passed=(true|false)(?: end_ms=([0-9]+))?$/);
  if (m) {
    const full = m[2];
    const dur = parseFloat(m[1]);
    if (fileSet.has(full)) {
      durations.set(full, dur);
      passedMap.set(full, m[3] === "true");
    }
  }
}

const wallS = wallMs / 1000;
const sumMs = [...durations.values()].reduce((a, b) => a + b, 0);
const ratio = sumMs / Math.max(wallMs, 1);
const sorted = [...durations.entries()].sort((a, b) => b[1] - a[1]);

const summary = {
  filesTotal: files.length,
  filesCaptured: durations.size,
  wallClockMs: wallMs,
  sumDurationMs: sumMs,
  ratioSumOverWall: ratio,
  exitStatus: res.status,
  runAt: new Date().toISOString(),
  slowest: sorted.slice(0, 20).map(([f, d]) => ({ file: f, durationMs: Math.round(d) })),
};

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} else {
  console.log(`\n=== suite measurement (${summary.runAt}) ===`);
  console.log(`files: ${files.length} (per-file duration captured for ${durations.size})`);
  console.log(`wall-clock (node --test): ${wallS.toFixed(1)} s`);
  console.log(`sum per-file duration_ms (total CPU): ${(sumMs / 1000).toFixed(1)} s`);
  console.log(`ratio Σ/wall: ${ratio.toFixed(2)}   (concurrency=8 → throughput-bound if ≈8)`);
  console.log(`node --test exit status: ${res.status}`);
  console.log(`\n--- slowest 20 files ---`);
  for (const [f, d] of sorted.slice(0, 20)) {
    console.log(`${d.toFixed(1).padStart(8)} ms  ${f}`);
  }
  if (sorted.length > 20) {
    console.log(`  ... (${sorted.length - 20} more)`);
  }
}
