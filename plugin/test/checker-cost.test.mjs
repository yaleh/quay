// @test-group governance
// checker-cost.test.mjs — the criterion-cost RECORDING mechanism
// (tasks/gap-no-criterion-records-its-own-cost-checker-cost-jsonl).
//
// PROBLEM IT FIXES: no standing criterion records its OWN cost. All 16 static checkers + 14 gates
// persisted ZERO execution time; the ready-pool-check slope 35.8s→91.2s→157.0s in one hour was
// ONLY visible because the manager hand-timed it twice. This test pins the checker-cost.jsonl
// PURE-APPEND record: {name, ms, n, load, at} per criterion exit, across the THREE writers —
//   (1) the bash static-check wrapper (scripts/test.sh run_checker via checker-cost-lib.sh),
//   (2) the TS helper/CLI (plugin/scripts/checker-cost.ts),
//   (3) the gate engine (packages/quay/src/gate/engine.ts recordGateCost).
// `load` = /proc/loadavg 1-min — the field that splits "the criterion got slower" into "n got
// bigger" vs "the machine got busier" (the pool-same 91.2→157.0 attribution case).
//
// AC1 checker-cost.jsonl 纯追加 {name, ms, n, load} (run_static_checks + gate paths) · AC2 trend
//   grows itself — ready-pool-check cost+load dual-dimension readable (n=24 two points differ in
//   load) · AC6 suite-duration sequence appended to verification-round.jsonl (never overwritten) ·
//   AC7 node:test + @test-group governance
//
// Run: scripts/test.sh plugin/test/checker-cost.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  recordCheckerCost,
  readCheckerCost,
  getLoad1,
  checkerCostFile,
} from "../scripts/checker-cost.ts";
import { appendSuiteDurationRecord } from "../scripts/full-suite-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// test-isolation R6: every mkdtemp result must be cleaned up (t.after rmSync) — the shrink-only
// ratchet fails on a NEW mkdtemp-no-cleanup. The helper takes `t` and registers the cleanup.
function tmpdir(t, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `checker-cost-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJsonl(root, recs) {
  const file = checkerCostFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return file;
}

// ── AC1: bash static-check wrapper writes a valid {name, ms, n, load, at} row ──────────────────────

test("AC1 — run_checker (bash wrapper) appends one valid cost row per criterion exit", (t) => {
  const root = tmpdir(t, "bash");
  const costFile = path.join(root, ".quay", "checker-cost.jsonl");
  const lib = path.join(REPO_ROOT, "plugin", "scripts", "checker-cost-lib.sh");
  const script = `
    set -euo pipefail
    export CHECKER_COST_FILE=${JSON.stringify(costFile)}
    export CHECKER_COST_LOAD_OVERRIDE=30.91
    source ${JSON.stringify(lib)}
    run_checker "bash-test-criterion" bash -c "sleep 0.01; exit 0"
  `;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 0, `bash wrapper must exit 0: ${r.stderr}`);
  const rows = readCheckerCost(costFile);
  assert.equal(rows.length, 1, "exactly one row per criterion exit");
  assert.equal(rows[0].name, "bash-test-criterion");
  assert.equal(typeof rows[0].ms, "number");
  assert.ok(rows[0].ms >= 1, `ms must be a real elapsed time: ${rows[0].ms}`);
  assert.equal(rows[0].n, 1, "external wrapper records n=1 by default");
  assert.equal(rows[0].load, 30.91, "load override honored (the attribution seam)");
  assert.ok(typeof rows[0].at === "string" && !Number.isNaN(Date.parse(rows[0].at)), "ISO at");
});

test("AC1 — run_checker propagates a FAILING checker's exit code (set -e abort preserved)", (t) => {
  const root = tmpdir(t, "bashfail");
  const costFile = path.join(root, ".quay", "checker-cost.jsonl");
  const lib = path.join(REPO_ROOT, "plugin", "scripts", "checker-cost-lib.sh");
  const script = `
    export CHECKER_COST_FILE=${JSON.stringify(costFile)}
    source ${JSON.stringify(lib)}
    run_checker "bash-test-failing" bash -c "exit 3"
  `;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 3, "the wrapper must return the criterion's exit code, not swallow it");
  const rows = readCheckerCost(costFile);
  assert.equal(rows.length, 1, "even a failing criterion records its cost on exit");
  assert.equal(rows[0].name, "bash-test-failing");
});

// ── AC1: TS helper/CLI writes the same shape ──────────────────────────────────────────────────────

test("AC1 — recordCheckerCost (TS) appends a parseable {name, ms, n, load, at} row", (t) => {
  const root = tmpdir(t, "ts");
  const file = recordCheckerCost({ root, name: "ts-test-criterion", ms: 42, n: 3, load: 7.5 });
  assert.equal(file, checkerCostFile(root));
  const rows = readCheckerCost(file);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { name: rows[0].name, ms: rows[0].ms, n: rows[0].n, load: rows[0].load },
    { name: "ts-test-criterion", ms: 42, n: 3, load: 7.5 },
  );
});

test("AC1 — checker-cost.ts CLI appends a row (the bash/gate-independent surface)", (t) => {
  const root = tmpdir(t, "cli");
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "checker-cost.ts");
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", cli, "--root", root, "--name", "cli-criterion", "--ms", "123", "--n", "5", "--load", "2.5"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `CLI must exit 0: ${r.stderr}`);
  const rows = readCheckerCost(checkerCostFile(root));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "cli-criterion");
  assert.equal(rows[0].ms, 123);
  assert.equal(rows[0].n, 5);
  assert.equal(rows[0].load, 2.5);
});

test("AC1 — getLoad1 reads /proc/loadavg 1-min (the load axis exists without an override)", () => {
  const load = getLoad1();
  assert.ok(typeof load === "number" && Number.isFinite(load), `load must be a number: ${load}`);
  assert.ok(load >= 0, `load must be non-negative: ${load}`);
});

// ── AC1: the GATE execution path writes a row (packages/quay/src/gate/engine.ts) ──────────────────

test("AC1 — runGate records gate:<gate>:<id> cost on every gate execution", async (t) => {
  const root = tmpdir(t, "gate");
  const { runGate } = await import("../../packages/quay/src/gate/engine.ts");
  const client = {
    taskGet: async (id) => ({
      id,
      status: "ready",
      title: "t",
      labels: [],
      role: "primitive",
      parent: null,
      children: [],
      body: "## Acceptance Criteria\n\n- [x] AC1\n",
      extra: { acceptance: "exit 0" },
    }),
    taskCheck: async () => ({ ok: true, reason: "ok" }),
  };
  const { ok } = await runGate({
    client,
    id: "QX-001",
    gate: "acceptance",
    logPath: path.join(root, ".quay", "gate-events.jsonl"),
    workspaceRoot: root,
  });
  assert.equal(ok, true, "the acceptance gate itself still passes");
  const rows = readCheckerCost(checkerCostFile(root));
  assert.ok(rows.length >= 1, "gate execution must record a cost row");
  const gateRow = rows.find((r) => r.name === "gate:acceptance:QX-001");
  assert.ok(gateRow, `expected a gate:acceptance:QX-001 row, got: ${rows.map((r) => r.name)}`);
  assert.equal(typeof gateRow.ms, "number");
  assert.equal(gateRow.n, 1);
  assert.ok(typeof gateRow.load === "number", "gate row carries the load axis");
});

// ── AC2: the trend grows itself — ready-pool-check cost + load dual-dimension readable ────────────

test("AC2 — the three historical ready-pool-check points are readable from checker-cost.jsonl (no stopwatch)", (t) => {
  const root = tmpdir(t, "trend");
  // The manager's hand-timed three points (06:44Z/07:15Z/07:27Z): ms, n(=pool), load.
  // The two n=24 points differ in COST *and* LOAD — load is the distinguishing variable
  // (91.2s→157.0s while pool stayed 24 — the attribution-correction case).
  writeJsonl(root, [
    { name: "ready-pool-check", ms: 35800, n: 19, load: 5.0, at: "2026-08-05T06:44:00.000Z" },
    { name: "ready-pool-check", ms: 91200, n: 24, load: 20.0, at: "2026-08-05T07:15:00.000Z" },
    { name: "ready-pool-check", ms: 157000, n: 24, load: 30.91, at: "2026-08-05T07:27:00.000Z" },
  ]);
  const rows = readCheckerCost(checkerCostFile(root)).filter((r) => r.name === "ready-pool-check");
  assert.equal(rows.length, 3, "three runs ⇒ three rows (the trend grows itself)");
  rows.sort((a, b) => a.ms - b.ms);
  assert.deepEqual(rows.map((r) => r.ms), [35800, 91200, 157000], "monotone cost sequence");
  const n24 = rows.filter((r) => r.n === 24);
  assert.equal(n24.length, 2, "the pool-same two points");
  assert.notEqual(n24[0].load, n24[1].load, "pool-same, cost-different ⇒ LOAD is the distinguishing field");
  // n grew 19→24 at the same time — the n axis is independently present.
  assert.ok(rows.some((r) => r.n === 19) && rows.every((r) => r.n === 19 || r.n === 24));
});

test("AC2 — ready-pool-check SELF-RECORDS with its real pool as n on a CLI run", (t) => {
  const root = tmpdir(t, "rpcheck");
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  // One ready task ⇒ pool 1 (excluded classes all empty). Minimal four-artifact shape.
  const body = [
    "## Proposal",
    "p",
    "## Plan",
    "1. step",
    "## Acceptance Criteria",
    "- [x] AC1",
    "## Definition of Done",
    "- [x] AC1",
  ].join("\n");
  fs.writeFileSync(
    path.join(root, "tasks", "QX-010.md"),
    `---\nid: QX-010\ntitle: fixture\ntitle2: x\nstatus: ready\nlabels:\n  - gap\n---\n\n${body}\n`,
    "utf8",
  );
  const script = path.join(REPO_ROOT, "plugin", "scripts", "ready-pool-check.ts");
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "3"],
    { encoding: "utf8", env: { ...process.env, CHECKER_COST_LOAD_OVERRIDE: "30.91" } },
  );
  assert.equal(r.status, 0, `ready-pool-check CLI must exit 0: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  const rows = readCheckerCost(checkerCostFile(root)).filter((row) => row.name === "ready-pool-check");
  assert.equal(rows.length, 1, "one CLI run ⇒ one self-recorded row");
  assert.equal(rows[0].n, parsed.pool, "n = the criterion's real input size (the ready pool)");
  assert.equal(rows[0].load, 30.91, "load recorded alongside cost (dual dimension)");
});

// ── AC6: the suite-duration sequence is appended to verification-round.jsonl, never overwritten ────

test("AC6 — appendSuiteDurationRecord appends a 7-field row and increments round", (t) => {
  const root = tmpdir(t, "suite");
  appendSuiteDurationRecord(root, { startedAt: "2026-08-05T07:15:00.000Z", durationMs: 872756, laneCount: 1, green: true });
  appendSuiteDurationRecord(root, { startedAt: "2026-08-05T07:30:00.000Z", durationMs: 91000, laneCount: 8, green: false });
  const file = path.join(root, ".quay", "verification-round.jsonl");
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "two suite runs ⇒ two rows (the sequence no longer dies)");
  const [r1, r2] = lines.map((l) => JSON.parse(l));
  assert.equal(r1.round, 1, "first record round starts at 1");
  assert.equal(r2.round, 2, "second record rounds up from the last");
  assert.equal(r1.durationMs, 872756);
  assert.equal(r1.laneCount, 1);
  assert.equal(r1.pass, 1);
  assert.equal(r1.fail, 0);
  assert.equal(r2.pass, 0, "a red suite records fail=1, pass=0");
  assert.equal(r2.fail, 1);
  assert.ok(typeof r1.load === "number", "suite record carries the load axis");
  assert.ok(typeof r1.startedAt === "string" && !Number.isNaN(Date.parse(r1.startedAt)));
});
