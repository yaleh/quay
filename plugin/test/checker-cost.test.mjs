// @test-group serial
// @load-sensitive child-spawn
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — AC2 asserts ms
// MONOTONICITY (400→800→1200ms delay seams) across 3 child-process runs; node-startup jitter under
// ANY concurrent load can break the delay-dominates signal. Round-51 (2026-08-10, suite-fix round-2)
// passed=false @7542ms with NO assertion output under lowconc concurrency-3 (solo 8/8 green) — the
// silent-failure child-spawn signature, same family as relation-sync/create-mcp/proposal-convergence/
// branch-model/threshold-scope-check. Escalated lowconc→serial (concurrency 1 = no concurrent load).
// GROUP NOTE (gap-serial-group-recompose-nested-runner-criterion, amended 2026-08-10): was routed to
// `lowconc` (concurrency 3) on "needs LOW LOAD, not serial exclusivity"; round-51 disproved lowconc's
// sufficiency — the delay-dominates signal broke even at concurrency-3. Serial guarantees no
// concurrent node --test sibling, restoring the delay-dominates signal. Also spawns a nested
// full-suite-runner sub-suite (AC6 run()) — a secondary nested-spawn shape.
// checker-cost.test.mjs — tasks/gap-no-criterion-records-its-own-cost-checker-cost-jsonl.
//
// The ENABLING MECHANISM for the whole criterion-cost family: every criterion (static checker /
// gate) records its own execution cost by being wrapped in plugin/scripts/checker-cost.sh, which
// pure-appends one JSON line {name, ms, n, load, exit, ts} to .quay/checker-cost.jsonl on exit.
//
// Coverage map (task ACs):
//   AC1 — pure-append ledger with {name, ms, n, load}; load = /proc/loadavg 1min (the
//         attribution-correction dimension); the run_static_checks path (test.sh wraps every
//         checker) AND the gate execution path (acceptance-runner.ts recordGateCost, the single
//         choke point all 14 gates run through) both record. Zero judgment — no thresholds/labels.
//   AC2 — the trend grows naturally: ready-pool-check run three times against the SAME store (same
//         n) with the 35.8->91.2->157.0 delay seam + distinct load seams produces a readable
//         cost+load dual-dimension sequence, and the same-n two points are distinguished by load
//         (the attribution correction: load is the dominant variable, not pool size).
//   AC6 — full-suite-runner appends {round, startedAt, durationMs, laneCount, pass, fail, load}
//         to .quay/verification-round.jsonl (append-only sequence; the single-state
//         full-suite-state.json is never overwritten away).
//   AC7 — this file uses node:test and declares // @test-group serial (see GROUP NOTE above).
//
// Run:
//   scripts/test.sh --for-task gap-no-criterion-records-its-own-cost-checker-cost-jsonl

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import { run } from "../scripts/full-suite-runner.ts";
import { readLoadAvg, appendVerificationRound } from "../scripts/full-suite-runner.ts";
import { runAcceptance, gateCostName, recordGateCost } from "../../packages/quay/src/gate/acceptance-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER_COST = path.join(REPO_ROOT, "plugin/scripts/checker-cost.sh");
const READY_POOL = path.join(REPO_ROOT, "plugin/scripts/ready-pool-check.ts");

function ledgerPath(root) {
  return path.join(root, ".quay", "checker-cost.jsonl");
}

function readLedgerRows(root) {
  const p = ledgerPath(root);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** Run `cmd...` wrapped in checker-cost.sh with the given seam overrides. Returns the wrapper's exit. */
function wrapCost({ root, name, n = 0, load, delayMs, command }) {
  const env = { ...process.env, CHECKER_COST_TEST_DELAY_MS: String(delayMs) };
  if (load !== undefined) env.CHECKER_COST_TEST_LOAD = String(load);
  // The wrapper (checker-cost.sh) is the recorder under test. If the wrapped command ALSO
  // self-records (ready-pool-check.ts does — its criterion KNOWS n=pool), it would append a
  // SECOND row per run and the "pure append, one per run" assertion would see 2× rows. The
  // ready-pool-check self-record has a hermetic seam (CHECKER_COST_SKIP=1 disables it) — set it
  // so the wrapper's record is the ONLY one (AC2: 3 runs ⇒ exactly 3 rows).
  env.CHECKER_COST_SKIP = "1";
  const args = [CHECKER_COST, name, "--n", String(n), "--root", root, "--"];
  args.push(...command);
  return spawnSync("bash", args, { env, encoding: "utf8" });
}

// A minimal ready-pool fixture store: `count` ready tasks (all four artifacts present so the
// pool-check's shape scan is satisfied). Same store = same n across the three AC2 runs.
function makePoolFixture(tag, count) {
  const root = makeTmpDir(`${tag}-`);
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  for (let i = 0; i < count; i++) {
    const id = `gap-f${i}`;
    const body = [
      "**type:** execution",
      "## Proposal",
      "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
      "## Contract",
      "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
      "band      ready_pool = ≥3",
      "invariant promotion_order = gap-first",
      "invoke    `node plugin/scripts/ready-pool-check.ts`",
      "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
      "resume    分两次提交",
      "## Acceptance Criteria",
      "- [ ] an AC item that is long enough",
      "- [ ] an AC item that is long enough",
      "## Definition of Done",
      "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
    ].join("\n");
    const fm = [
      "---",
      `id: ${id}`,
      `title: fixture ${id}`,
      "status: ready",
      "labels:",
      "  - gap",
      "extra:",
      "  schema: v1",
      "---",
    ].join("\n");
    fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}\n`);
  }
  return root;
}

// ── AC1: the wrapper (run_static_checks path) ───────────────────────────────────────────────────────

test("AC1 — checker-cost.sh pure-appends {name, ms, n, load, exit, ts} and propagates the exit code", () => {
  const root = makeTmpDir("cc-ac1-");
  const r1 = wrapCost({ root, name: "fixture-check", n: 7, command: ["bash", "-c", "exit 3"] });
  assert.equal(r1.status, 3, "wrapper propagates the wrapped command's exit code");

  const rows1 = readLedgerRows(root);
  assert.equal(rows1.length, 1, "one append-only line");
  assert.equal(rows1[0].name, "fixture-check");
  assert.equal(rows1[0].n, 7);
  assert.equal(rows1[0].exit, 3);
  assert.equal(typeof rows1[0].ms, "number");
  assert.ok(rows1[0].ms >= 0);
  assert.equal(typeof rows1[0].load, "number");
  assert.ok(Number.isFinite(rows1[0].load), "load is a finite number (real /proc/loadavg or seam)");
  assert.ok(rows1[0].ts, "timestamp present");

  // Pure append — a second run ADDS a line, never overwrites.
  const r2 = wrapCost({ root, name: "fixture-check", n: 7, command: ["bash", "-c", "exit 0"] });
  assert.equal(r2.status, 0);
  const rows2 = readLedgerRows(root);
  assert.equal(rows2.length, 2, "second run appends (pure append, zero overwrite)");
  assert.equal(rows2[1].exit, 0);
});

test("AC1 — load is the /proc/loadavg 1min value (seam-overridable); name is validated", () => {
  const root = makeTmpDir("cc-load-");
  // Real load path (no seam): a finite positive number is present on this machine.
  wrapCost({ root, name: "real-load-check", command: ["bash", "-c", "exit 0"] });
  const real = readLedgerRows(root)[0];
  assert.ok(real.load > 0, "real /proc/loadavg 1min is positive");

  // Seam path: CHECKER_COST_TEST_LOAD overrides deterministically.
  wrapCost({ root, name: "seam-load-check", load: "30.91", command: ["bash", "-c", "exit 0"] });
  const seam = readLedgerRows(root).find((r) => r.name === "seam-load-check");
  assert.equal(seam.load, 30.91, "CHECKER_COST_TEST_LOAD overrides the load reading");

  // Invalid name fails loud (never writes a corrupt line).
  const bad = spawnSync("bash", [CHECKER_COST, "bad name!", "--root", root, "--", "exit 0"], { encoding: "utf8" });
  assert.notEqual(bad.status, 0, "invalid name rejected");
  assert.equal(readLedgerRows(root).filter((r) => r.name === "bad name!").length, 0);
});

// ── AC1: the gate execution path (acceptance-runner.ts recordGateCost) ──────────────────────────────

test("AC1 — the gate execution path records via runAcceptance when QUAY_COST_LEDGER=1 (hermetic otherwise)", () => {
  const root = makeTmpDir("cc-gate-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });

  // Env unset → no ledger write (existing hermetic gate tests are unaffected).
  const before = process.env.QUAY_COST_LEDGER;
  delete process.env.QUAY_COST_LEDGER;
  try {
    runAcceptance({ command: "exit 0", cwd: root, timeoutMs: 5000 });
  } finally {
    if (before !== undefined) process.env.QUAY_COST_LEDGER = before;
  }
  assert.equal(fs.existsSync(ledgerPath(root)), false, "no ledger write without QUAY_COST_LEDGER=1");

  // QUAY_COST_LEDGER=1 → one append-only {name, ms, n, load, exit, ts} line per gate execution.
  process.env.QUAY_COST_LEDGER = "1";
  try {
    runAcceptance({ command: "exit 0", cwd: root, timeoutMs: 5000, name: "test-gate" });
    runAcceptance({ command: "exit 1", cwd: root, timeoutMs: 5000, name: "test-gate" });
  } finally {
    delete process.env.QUAY_COST_LEDGER;
  }
  const rows = readLedgerRows(root);
  assert.equal(rows.length, 2, "two gate executions → two ledger lines");
  assert.equal(rows[0].name, "test-gate");
  assert.equal(rows[0].exit, 0);
  assert.equal(rows[1].exit, 1);
  assert.equal(rows[1].n, 0);
  assert.ok(Number.isFinite(rows[1].load));
});

test("AC1 — gateCostName extracts the executed script basename (all 14 gate scripts run through this)", () => {
  assert.equal(gateCostName("'./plugin/scripts/it0-impl-row-check.sh' --arg"), "it0-impl-row-check.sh");
  assert.equal(gateCostName("node plugin/scripts/vmeta-lag-check.ts"), "vmeta-lag-check.ts");
  assert.equal(gateCostName("echo hi"), "acceptance", "fallback for a non-script command");
});

// ── AC2: the slope reproduces from the ledger (cost + load dual-dimension sequence) ─────────────────

test("AC2 — ready-pool-check run 3x (35.8→91.2→157.0) yields a readable cost+load sequence; same-n points distinguished by load", () => {
  const POOL = 3;
  const root = makePoolFixture("cc-ac2", POOL);
  // Delays dominate the ready-pool-check command's own run-to-run jitter (~±100ms), so the recorded
  // ms sequence is strictly monotonic (the 35.8->91.2->157.0 shape, scaled down to test time).
  const runs = [
    { delayMs: 400, load: "1.0" },
    { delayMs: 800, load: "5.0" },
    { delayMs: 1200, load: "10.0" },
  ];
  for (const r of runs) {
    const res = wrapCost({
      root,
      name: "ready-pool-check",
      n: POOL, // same store ⇒ same n across all three runs
      load: r.load,
      delayMs: r.delayMs,
      command: ["node", "--no-warnings", "--experimental-strip-types", READY_POOL, "--root", root],
    });
    assert.equal(res.status, 0, `ready-pool-check wrapper run exited 0 (delay ${r.delayMs}ms)`);
  }

  const rows = readLedgerRows(root).filter((r) => r.name === "ready-pool-check");
  assert.equal(rows.length, 3, "three ready-pool-check rows (one per run, pure append)");
  assert.ok(rows.every((r) => r.n === POOL), "all three rows share the same n (same pool)");

  // The dual-dimension sequence is readable WITHOUT hand-timing: ms grows (the 35.8→91.2→157 shape)
  // and load is the distinguishing variable across the same-n points.
  assert.ok(rows[0].ms >= 400, `run1 ms >= 400ms delay (got ${rows[0].ms})`);
  assert.ok(rows[1].ms >= 800, `run2 ms >= 800ms delay (got ${rows[1].ms})`);
  assert.ok(rows[2].ms >= 1200, `run3 ms >= 1200ms delay (got ${rows[2].ms})`);
  assert.ok(rows[2].ms > rows[1].ms && rows[1].ms > rows[0].ms, "ms is monotonically increasing");

  assert.deepEqual(rows.map((r) => r.load), [1.0, 5.0, 10.0], "load differs across same-n points");

  // The attribution-correction lesson (2026-08-05 07:27Z): same-n points with different cost must be
  // distinguishable by LOAD — the dominant variable is machine load, not pool size. The ledger's
  // load field is exactly what makes that separation possible without a human hand-measuring.
  const [a, b] = [rows[0], rows[1]]; // same n=POOL, different ms
  assert.ok(a.ms < b.ms && a.load < b.load, "same-n cost growth is attributable to the load dimension");
});

test("AC2 — the ledger is a passive sequence a trend criterion can read (no overwrite across many runs)", () => {
  const root = makeTmpDir("cc-seq-");
  for (let i = 0; i < 5; i++) {
    wrapCost({ root, name: "sequence-check", n: i, command: ["bash", "-c", "exit 0"] });
  }
  const rows = readLedgerRows(root).filter((r) => r.name === "sequence-check");
  assert.equal(rows.length, 5, "five runs → five rows (the trend grows itself)");
  assert.deepEqual(rows.map((r) => r.n), [0, 1, 2, 3, 4], "sequence order preserved by append");
});

// ── AC6: the suite duration sequence (append-only verification-round.jsonl) ─────────────────────────

test("AC6 — full-suite-runner appends {round, startedAt, durationMs, laneCount, pass, fail, load} to verification-round.jsonl", async () => {
  const root = makeTmpDir("cc-ac6-");
  const fakeSuite = path.join(root, "green-suite.sh");
  fs.writeFileSync(
    fakeSuite,
    '#!/usr/bin/env bash\necho "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n',
    { mode: 0o755 },
  );
  const oldSkip = process.env.QUAY_TEST_SKIP_RESOURCE_GATE;
  process.env.QUAY_TEST_SKIP_RESOURCE_GATE = "1";
  try {
    const code = await run(["--root", root, "--command", `bash ${fakeSuite}`, "--lane-count", "1"]);
    assert.equal(code, 0, "green suite exits 0");
    // second run — the sequence must ACCUMULATE, never overwrite
    await run(["--root", root, "--command", `bash ${fakeSuite}`, "--lane-count", "1"]);
  } finally {
    if (oldSkip !== undefined) process.env.QUAY_TEST_SKIP_RESOURCE_GATE = oldSkip;
    else delete process.env.QUAY_TEST_SKIP_RESOURCE_GATE;
  }

  const vrf = path.join(root, ".quay", "verification-round.jsonl");
  assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
  const lines = fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 2, "two suite rounds → two append-only sequence lines");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.state, "green");
  assert.equal(rec.pass, 5);
  assert.equal(rec.fail, 0);
  assert.equal(rec.laneCount, 1);
  assert.equal(typeof rec.durationMs, "number");
  assert.ok(!Number.isNaN(Date.parse(rec.startedAt)), "startedAt is ISO");
  assert.equal(typeof rec.load, "number");
  assert.equal(JSON.parse(lines[1]).round, 2, "round increments per appended line");
});

test("AC6 — appendVerificationRound/readLoadAvg helpers are deterministic on a hermetic root", () => {
  const root = makeTmpDir("cc-vrf-");
  appendVerificationRound(path.join(root, ".quay"), {
    round: 0,
    startedAt: "2026-08-05T07:00:00Z",
    durationMs: 872756,
    laneCount: 1,
    pass: 28,
    fail: 0,
    cancelled: 0,
    load: 12.5,
    state: "green",
    runner: "outer",
  });
  appendVerificationRound(path.join(root, ".quay"), {
    round: 0,
    startedAt: "2026-08-05T07:16:00Z",
    durationMs: 900000,
    laneCount: 1,
    pass: 30,
    fail: 0,
    cancelled: 0,
    load: 30.91,
    state: "green",
    runner: "outer",
  });
  const lines = fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).round, 1, "first round is 1 (prior line count + 1)");
  assert.equal(JSON.parse(lines[1]).round, 2);
  assert.equal(typeof readLoadAvg(), "number", "readLoadAvg returns a finite number on this machine");
});
