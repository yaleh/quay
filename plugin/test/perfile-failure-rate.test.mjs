// @test-group engine
// perfile-failure-rate.test.mjs — gap-perfile-failure-rate-baseline-step-change
// AC2 (four-state classification pure function, fixture coverage) + AC3 (fail-closed carrier
// resolution). The classification is a PURE function — every state is a DISTINCT value (hard rule
// 3b: "insufficient" must never share an output with "within-baseline"/"new-event").
//
// Coverage:
//   - baselineOf / groupByFile: runs/fails/rate aggregation and chronological grouping.
//   - classifyFailure four states, one fixture each:
//       new-event        fails=0 (the 528/615 majority) — a first red is high-information.
//       within-baseline  fails spread across BOTH halves (long-standing jitter).
//       step-change      fails ALL in the recent half (early half green) — 一直全绿开始红.
//       insufficient     runs < MIN_RUNS — a distinct "cannot judge", NOT new-event.
//   - boundary: runs === MIN_RUNS is judgeable (new-event), runs === MIN_RUNS - 1 is insufficient.
//   - fail-closed CLI: --root → a clean dir with no carrier ⇒ 「载体未找到」 + exit 2 (never an
//     empty baseline that reads "all files never failed").
//
// Run:
//   node --test plugin/test/perfile-failure-rate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  classifyFailure,
  baselineOf,
  groupByFile,
  MIN_RUNS,
} from "../scripts/perfile-failure-rate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TS = path.join(REPO_ROOT, "plugin", "scripts", "perfile-failure-rate.ts");

function runCli(args, opts = {}) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", TS, ...args], {
    encoding: "utf8",
    ...opts,
  });
}

/** Build a synthetic single-file history: `runs` records, `passed=false` at the given indices. */
function mkHistory(runs, failIdxs = []) {
  const failSet = new Set(failIdxs);
  return Array.from({ length: runs }, (_, i) => ({
    file: "pkg/x.test.mjs",
    passed: !failSet.has(i),
    startedAtMs: 1_000 + i, // strictly increasing ⇒ chronological
  }));
}

// ── baseline aggregation (AC1/AC2 helpers) ──────────────────────────────────────────────────────────
test("baselineOf aggregates {runs, fails, rate} from a file history", () => {
  const b = baselineOf(mkHistory(100, [1, 2, 3]));
  assert.equal(b.runs, 100);
  assert.equal(b.fails, 3);
  assert.ok(Math.abs(b.rate - 0.03) < 1e-9, `rate should be 0.03, got ${b.rate}`);
  assert.deepEqual(baselineOf([]), { runs: 0, fails: 0, rate: 0 });
});

test("groupByFile groups by file and sorts each group chronologically", () => {
  const byFile = groupByFile([
    { file: "b.test.mjs", passed: true, startedAtMs: 3000 },
    { file: "a.test.mjs", passed: false, startedAtMs: 2000 },
    { file: "b.test.mjs", passed: false, startedAtMs: 1000 },
  ]);
  assert.deepEqual([...byFile.keys()].sort(), ["a.test.mjs", "b.test.mjs"]);
  const b = byFile.get("b.test.mjs");
  assert.deepEqual(b.map((r) => r.startedAtMs), [1000, 3000], "chronological order");
});

// ── four-state classification (AC2 — one fixture per state, all distinct) ──────────────────────────
test("AC2 new-event — a file with fails=0 across a judgeable history is a first red (escalate)", () => {
  assert.equal(classifyFailure(mkHistory(60, [])), "new-event");
  // A current failure on such a file is the high-information event — never "within-baseline".
  assert.notEqual(classifyFailure(mkHistory(60, [])), "within-baseline");
});

test("AC2 within-baseline — failures spread across BOTH halves are long-standing jitter (release)", () => {
  // half = ceil(60/2) = 30; fail at 10 (early) and 45 (recent) ⇒ earlyFails>0 and recentFails>0.
  assert.equal(classifyFailure(mkHistory(60, [10, 45])), "within-baseline");
});

test("AC2 step-change — failures ALL in the recent half (early half green) is a 阶跃 (escalate)", () => {
  // half = 30; fails at 40 and 55 are both recent ⇒ earlyFails=0, recentFails=2.
  assert.equal(classifyFailure(mkHistory(60, [40, 55])), "step-change");
});

test("AC2 insufficient — a file below MIN_RUNS cannot be judged (distinct, not new-event)", () => {
  const cls = classifyFailure(mkHistory(10, []));
  assert.equal(cls, "insufficient");
  // 硬规则 3b: insufficient MUST NOT share an output with new-event/within-baseline.
  assert.notEqual(cls, "new-event");
  assert.notEqual(cls, "within-baseline");
  assert.notEqual(cls, "step-change");
});

test("AC2 boundary — runs === MIN_RUNS is judgeable; runs === MIN_RUNS - 1 is insufficient", () => {
  assert.equal(classifyFailure(mkHistory(MIN_RUNS, [])), "new-event", "exactly MIN_RUNS green runs is judgeable");
  assert.equal(classifyFailure(mkHistory(MIN_RUNS - 1, [])), "insufficient", "one run short is not judgeable");
});

test("AC2 minRuns override — the judgeable floor is a parameter, not a hardcoded constant", () => {
  assert.equal(classifyFailure(mkHistory(5, []), { minRuns: 5 }), "new-event", "override raises/lowers the floor");
  assert.equal(classifyFailure(mkHistory(4, []), { minRuns: 5 }), "insufficient");
});

// ── fail-closed carrier resolution (AC3) ─────────────────────────────────────────────────────────────
test("AC3 fail-closed — --root → a clean dir with no carrier exits non-zero with 载体未找到", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perfile-rate-empty-"));
  try {
    const r = runCli(["--root", dir]);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstdout: ${r.stdout}`);
    assert.match(r.stderr, /载体未找到/, "must report carrier-not-found, never an empty baseline");
    assert.doesNotMatch(r.stdout, /never-failed/, "must NOT print a baseline summary that reads 'all green'");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 fail-closed — a carrier dir that exists but has NO verification-round.jsonl still fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perfile-rate-noquay-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  try {
    const r = runCli(["--root", dir]);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}`);
    assert.match(r.stderr, /载体未找到/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
