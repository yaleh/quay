// @test-group serial
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-10 child-spawn delay-dominates signal broke under lowconc c3 (round-51 silent passed=false @7542ms)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — AC2 asserts the
// DETERMINISTIC LOWER BOUND ms >= delayMs (500→1500→3000ms delay seams), NOT cross-subprocess ms
// monotonicity. checker-cost.sh re-reads the clock AFTER `sleep delayMs`, so ms = command_time +
// sleep >= delayMs (command_time >= 0, sleep >= requested) — a physically reliable lower bound.
// The old MONOTONICITY assertion (ms[2] > ms[1] > ms[0]) broke under load: node --experimental-
// strip-types startup jitter (~1.6s) exceeds the 1000/1500ms delay gaps across 3 independent
// child-process spawns, so wall-clock ordering is not an invariant. Round-51 (2026-08-10, suite-fix
// round-2) passed=false @7542ms with NO assertion output under lowconc concurrency-3 (solo 8/8
// green) — the silent-failure child-spawn signature, same family as relation-sync/create-mcp/
// proposal-convergence/branch-model/threshold-scope-check. Escalated lowconc→serial (concurrency 1
// = no concurrent load) masked the jitter; the lower bound needs no such crutch.
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
import { recordCheckerCost, readCheckerCost } from "../scripts/checker-cost.ts";
import { runGate } from "../../packages/quay/src/gate/engine.ts";

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
  // Each run's recorded ms is a DETERMINISTIC LOWER BOUND: checker-cost.sh sleeps delayMs AFTER the
  // command and then re-reads the clock, so ms = command_time + sleep >= delayMs (command_time >= 0,
  // sleep >= requested). We assert ms >= delayMs, never cross-subprocess ordering — node
  // --experimental-strip-types startup jitter (~1.6s under full-suite load) exceeds the 1000/1500ms
  // delay gaps, so "ms is monotonically increasing" across 3 independent spawns is NOT a physical
  // invariant (r285 failed once under load). The 500/1500/3000 seams preserve the 35.8->91.2->157.0
  // readable shape, scaled down to test time.
  const runs = [
    { delayMs: 500, load: "1.0" },
    { delayMs: 1500, load: "5.0" },
    { delayMs: 3000, load: "10.0" },
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

  // The dual-dimension sequence is readable WITHOUT hand-timing: each run's ms meets its delay lower
  // bound (the 35.8→91.2→157 shape, scaled) and load is the distinguishing variable across same-n
  // points. No cross-subprocess ms ordering is asserted — that is jitter, not an invariant.
  assert.ok(rows[0].ms >= 500, `run1 ms >= 500ms delay (got ${rows[0].ms})`);
  assert.ok(rows[1].ms >= 1500, `run2 ms >= 1500ms delay (got ${rows[1].ms})`);
  assert.ok(rows[2].ms >= 3000, `run3 ms >= 3000ms delay (got ${rows[2].ms})`);

  assert.deepEqual(rows.map((r) => r.load), [1.0, 5.0, 10.0], "load differs across same-n points");

  // The attribution-correction lesson (2026-08-05 07:27Z): same-n points with different cost must be
  // distinguishable by LOAD — the dominant variable is machine load, not pool size. The ledger's
  // load field is exactly what makes that separation possible without a human hand-measuring. The
  // load comparison is seam-deterministic; the ms comparison is deliberately NOT asserted (the same
  // cross-subprocess jitter as the monotonic assertion above — run1's 500ms seam vs run2's 1500ms
  // seam is a 1000ms gap that startup jitter can reverse under load).
  const [a, b] = [rows[0], rows[1]]; // same n=POOL, different load seams
  assert.ok(a.load < b.load, "same-n points are distinguishable by the load dimension");
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

// ── Parallel-mode run_checker (gap-run-static-checks-zero-concurrency-can-parallelize) ─────────────
// The run_static_checks path in scripts/test.sh sources checker-cost-lib.sh (NOT the standalone
// checker-cost.sh wrapper) and wraps every checker in run_checker. With RUN_CHECKER_PARALLEL=1
// run_checker backgrounds each timed+recorded run bounded to STATIC_CHECK_CONCURRENCY, and
// run_checker_parallel_wait waits for all, fails closed on any failure, and keeps EVERY cost row.
// These tests exercise the LIB directly (source checker-cost-lib.sh in a hermetic bash subprocess).
const CHECKER_COST_LIB = path.join(REPO_ROOT, "plugin/scripts/checker-cost-lib.sh");

function runLibScript(root, script, env = {}) {
  return spawnSync("bash", ["-c", script], {
    env: {
      ...process.env,
      CHECKER_COST_FILE: path.join(root, ".quay", "checker-cost.jsonl"),
      ...env,
    },
    encoding: "utf8",
  });
}

test("AC2/AC3/AC4 — parallel run_checker fails closed with the failing name visible and EVERY cost row appended", () => {
  const root = makeTmpDir("cc-par-fail-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    RUN_CHECKER_PARALLEL=1
    STATIC_CHECK_CONCURRENCY=2
    run_checker "par-ok-1" bash -c "sleep 0.1; exit 0"
    run_checker "par-fail" bash -c "exit 1"
    run_checker "par-ok-2" bash -c "sleep 0.1; exit 0"
    run_checker_parallel_wait
  `);
  // AC3: fail-closed with the FIRST failing checker's exit code; the failing name is on stderr,
  // never masked by its siblings' (parallel) output. (exit 1 is a RED here — exit 3 is now reserved
  // for NOT-EVALUATED, gap-not-evaluated-harness-third-state.)
  assert.equal(res.status, 1, `parallel wait returns the first failing checker's exit code (got ${res.status}): ${res.stderr}`);
  assert.match(res.stderr, /par-fail/, `the failing checker's name is reported (AC3, not masked): ${res.stderr}`);
  // gap-static-check-red-failures-capture-only-task-contract-shape — the fail-closed line must be
  // MACHINE-PARSEABLE (`STATIC_CHECK_FAILED: <name> exit=<rc>`, one line per failing checker) so
  // full-suite-runner can record the 真因 into failures[] (a checker that fail-closed emits no
  // task-contract VIOLATION line — round-84's capture saw zero of them).
  assert.match(
    res.stderr,
    /^STATIC_CHECK_FAILED: par-fail exit=1$/m,
    `a machine-parseable STATIC_CHECK_FAILED line is emitted with the name + exit code: ${res.stderr}`,
  );
  assert.doesNotMatch(res.stderr, /^STATIC_CHECK_FAILED: par-ok-1/, "passing checkers never emit a fail-closed line");
  // AC4: every checker's cost row is appended — the failure must not lose sibling rows.
  const rows = readLedgerRows(root);
  assert.equal(rows.length, 3, `all three cost rows appended despite the failure (AC4): ${res.stderr}`);
  assert.deepEqual(rows.map((r) => r.name).sort(), ["par-fail", "par-ok-1", "par-ok-2"]);
});

test("AC2 — parallel run_checker runs checkers concurrently (a sibling observes the other mid-run)", () => {
  const root = makeTmpDir("cc-par-overlap-");
  const mark = path.join(root, "a-started");
  const saw = path.join(root, "b-saw-a");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    RUN_CHECKER_PARALLEL=1
    STATIC_CHECK_CONCURRENCY=4
    run_checker "par-a" bash -c "touch '${mark}'; sleep 0.5; rm -f '${mark}'"
    run_checker "par-b" bash -c "for i in \\$(seq 1 300); do [ -f '${mark}' ] && { touch '${saw}'; break; }; sleep 0.01; done; true"
    run_checker_parallel_wait
  `);
  assert.equal(res.status, 0, `two clean parallel checkers: ${res.stderr}`);
  // par-a holds the marker for 0.5s then removes it; par-b polls for it. If the two ran
  // SEQUENTIALLY, par-b would start after par-a removed the marker and never see it. Seeing it
  // proves overlap (concurrent execution). The marker removal is what makes this a true
  // concurrency detector rather than a false positive.
  assert.ok(fs.existsSync(saw), "checker B observed checker A's transient marker while A was mid-run — the two executed concurrently");
});

test("AC2 — STATIC_CHECK_CONCURRENCY bounds concurrency (a 3rd checker waits for a slot to free)", () => {
  const root = makeTmpDir("cc-par-bound-");
  const done = path.join(root, "a-done");
  const saw = path.join(root, "c-saw-a-done");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    RUN_CHECKER_PARALLEL=1
    STATIC_CHECK_CONCURRENCY=1
    run_checker "par-a" bash -c "sleep 0.3; touch '${done}'"
    run_checker "par-c" bash -c "[ -f '${done}' ] && touch '${saw}'; true"
    run_checker_parallel_wait
  `);
  assert.equal(res.status, 0, `bounded-pool run: ${res.stderr}`);
  // With a pool of 1, par-c must NOT start until par-a finished (0.3s → done exists). If the pool
  // were unbounded, par-c would start immediately and the done marker would NOT exist yet.
  assert.ok(fs.existsSync(saw), "checker C ran only AFTER checker A finished — concurrency bounded to STATIC_CHECK_CONCURRENCY");
});

test("AC3 — non-parallel run_checker (the scoped tier) runs synchronously and propagates exit code unchanged", () => {
  const root = makeTmpDir("cc-par-sync-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    run_checker "sync-fail" bash -c "exit 2"
  `);
  // RUN_CHECKER_PARALLEL is unset here — the scoped tier's single evals must stay synchronous and
  // propagate the wrapped exit code exactly as before the parallelization.
  assert.equal(res.status, 2, "synchronous run_checker propagates the wrapped command's exit code");
  assert.equal(readLedgerRows(root).length, 1, "one append-only cost row");
  // gap-scoped-static-check-red-no-fail-machine-line — a usage error (exit 2) is ALSO a non-zero
  // non-NOT-EVALUATED exit, so it must emit the same machine line as a RED (identity on the carrier,
  // not a benign preamble).
  assert.match(res.stderr, /^STATIC_CHECK_FAILED: sync-fail exit=2$/m, `a usage error emits STATIC_CHECK_FAILED: ${res.stderr}`);
});

// ── Synchronous fail-closed machine line (gap-scoped-static-check-red-no-fail-machine-line) ─────────
// The synchronous run_checker path (RUN_CHECKER_PARALLEL unset) is what the scoped tier
// (run_scoped_static_checks_sel in scripts/test.sh) and the doc checks use. Before this gap it
// returned the non-zero exit code with NO machine line, so a scoped-gate red carried only a benign
// preamble (worker-driver's extractFailureSummary had no FAIL line to grab). AC2 pins the emit; AC3
// pins the two negative controls (exit 3 stays NOT_EVALUATED, exit 0 emits nothing).

test("AC2 — synchronous run_checker (scoped tier) emits STATIC_CHECK_FAILED with name + exit code on a RED (exit 1)", () => {
  const root = makeTmpDir("cc-sync-red-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    run_checker "sync-red" bash -c "exit 1"
  `);
  // RUN_CHECKER_PARALLEL is unset — the synchronous scoped tier. A RED (exit 1) must emit the SAME
  // machine-parseable STATIC_CHECK_FAILED line the parallel wait emits, so a scoped-gate red carries
  // the failing checker's identity (name + exit code), not a benign preamble. ⛔ delete the emit ⇒ red.
  assert.equal(res.status, 1, `synchronous run_checker propagates the RED exit code (got ${res.status}): ${res.stderr}`);
  assert.match(res.stderr, /^STATIC_CHECK_FAILED: sync-red exit=1$/m, `a machine-parseable STATIC_CHECK_FAILED line on stderr: ${res.stderr}`);
  assert.doesNotMatch(res.stderr, /STATIC_CHECK_NOT_EVALUATED/, "a RED is never conflated with NOT-EVALUATED");
  assert.equal(readLedgerRows(root).length, 1, "one append-only cost row");
});

test("AC3 — synchronous run_checker exit 0 emits no STATIC_CHECK_* line (a pass is never a failure)", () => {
  const root = makeTmpDir("cc-sync-ok-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    run_checker "sync-ok" bash -c "exit 0"
    echo "after-run-checker"
  `);
  assert.equal(res.status, 0, `a passing checker exits 0 (got ${res.status}): ${res.stderr}`);
  assert.doesNotMatch(res.stderr, /STATIC_CHECK_/, `exit 0 emits no STATIC_CHECK_* line (neither FAILED nor NOT_EVALUATED): ${res.stderr}`);
  assert.match(res.stdout, /after-run-checker/, "the script continues past the passing checker");
});

// ── NOT-EVALUATED third state (gap-not-evaluated-harness-third-state) ───────────────────────────────
// run_checker recognizes exit 3 as a THIRD state — neither RED (fail-closed) nor PASS — and counts it
// separately (surfaced as `STATIC_CHECK_NOT_EVALUATED: <name>`). AC1 pins the third-state branch; AC2
// pins the negative control (a checker that cannot read its input is recorded as not-evaluated, never
// conflated with a real failure or a real pass).

test("AC1 (three-state) — parallel run_checker recognizes exit 3 as NOT-EVALUATED: not RED, not PASS, counted separately", () => {
  const root = makeTmpDir("cc-par-ne-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    RUN_CHECKER_PARALLEL=1
    STATIC_CHECK_CONCURRENCY=2
    run_checker "par-ne" bash -c "exit 3"
    run_checker "par-ok" bash -c "exit 0"
    run_checker_parallel_wait
  `);
  // A NOT-EVALUATED checker is NOT fail-closed: the wait returns 0 and emits no STATIC_CHECK_FAILED.
  assert.equal(res.status, 0, `a NOT-EVALUATED checker must not fail the wait (got ${res.status}): ${res.stderr}`);
  assert.doesNotMatch(res.stderr, /^STATIC_CHECK_FAILED:/m, "NOT-EVALUATED never emits the fail-closed line");
  assert.match(res.stderr, /^STATIC_CHECK_NOT_EVALUATED: par-ne$/m, "the NOT-EVALUATED checker is surfaced (counted separately)");
  assert.match(res.stderr, /1 checker\(s\) NOT-EVALUATED/, "the third-state count is reported");
  // Every cost row still appended (AC4 unchanged by the third state).
  assert.deepEqual(readLedgerRows(root).map((r) => r.name).sort(), ["par-ne", "par-ok"]);
});

test("AC2 (negative control) — a checker that cannot read input (exit 3) is not conflated with a real RED (exit 1)", () => {
  const root = makeTmpDir("cc-par-mixed-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    RUN_CHECKER_PARALLEL=1
    STATIC_CHECK_CONCURRENCY=2
    run_checker "par-ne" bash -c "exit 3"
    run_checker "par-fail" bash -c "exit 1"
    run_checker_parallel_wait
  `);
  // The real RED (exit 1) is still fail-closed with name + exit code; the NOT-EVALUATED (exit 3) is
  // separated and NEVER reported as a failure.
  assert.equal(res.status, 1, `a real RED must still fail the wait (got ${res.status}): ${res.stderr}`);
  assert.match(res.stderr, /^STATIC_CHECK_FAILED: par-fail exit=1$/m, "the real RED emits its fail-closed line");
  assert.doesNotMatch(res.stderr, /STATIC_CHECK_FAILED: par-ne/, "NOT-EVALUATED is never conflated with a failure");
  assert.match(res.stderr, /^STATIC_CHECK_NOT_EVALUATED: par-ne$/m, "the NOT-EVALUATED checker is counted separately");
});

test("AC2 (negative control) — synchronous run_checker maps exit 3 to a non-failing return (set -e safe), surfaced not hidden", () => {
  const root = makeTmpDir("cc-sync-ne-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    run_checker "sync-ne" bash -c "exit 3"
    echo "after-run-checker"
  `);
  // A NOT-EVALUATED checker must NOT abort the script under `set -e` (before the fix, exit 3 — like any
  // non-zero — would abort it). The marker line proves the script continued past run_checker.
  assert.equal(res.status, 0, `NOT-EVALUATED must not abort a set -e script (got ${res.status}): ${res.stderr}`);
  assert.match(res.stdout, /after-run-checker/, "the script continues past the NOT-EVALUATED checker");
  assert.match(res.stderr, /^STATIC_CHECK_NOT_EVALUATED: sync-ne$/m, "the NOT-EVALUATED checker is surfaced");
  // gap-scoped-static-check-red-no-fail-machine-line AC3 — exit 3 emits NOT_EVALUATED, NEVER the
  // fail-closed line (the third state must not be conflated with a RED).
  assert.doesNotMatch(res.stderr, /STATIC_CHECK_FAILED/, "NOT-EVALUATED never emits STATIC_CHECK_FAILED");
});

// ── verdict field (gap-checker-cost-jsonl-add-verdict-field) ───────────────────────────────────────
// The three writers (checker-cost-lib.sh, checker-cost.ts, engine.ts) now append a `verdict` field
// derived from the ALREADY-computed exit code (bash: 0→pass, 3→not-evaluated, other non-zero→fail;
// gate: ok→pass/fail) — the axis P4 guard-lineage needs to compute "曾变红比例". AC1 pins the bash
// mapping; AC2 pins the ts + engine writers; AC3 pins all three verdict values; AC4 pins that
// old-format (verdict-less) rows still parse.

test("AC1/AC3 — bash checker-cost-lib maps the already-computed exit code to verdict (pass/fail/not-evaluated)", () => {
  const root = makeTmpDir("cc-verdict-bash-");
  const res = runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    run_checker "vd-pass" bash -c "exit 0"
    run_checker "vd-not-eval" bash -c "exit 3"
    run_checker "vd-fail" bash -c "exit 1" || true
  `);
  assert.equal(res.status, 0, `three sync checkers recorded their rows (got ${res.status}): ${res.stderr}`);
  const byName = Object.fromEntries(readLedgerRows(root).map((r) => [r.name, r]));
  assert.equal(byName["vd-pass"].verdict, "pass");
  assert.equal(byName["vd-not-eval"].verdict, "not-evaluated");
  assert.equal(byName["vd-fail"].verdict, "fail");
});

test("AC1 — the parallel path also records verdict (same _run_checker_one mapping site)", () => {
  const root = makeTmpDir("cc-verdict-bash-par-");
  runLibScript(root, `
    set -euo pipefail
    source "${CHECKER_COST_LIB}"
    RUN_CHECKER_PARALLEL=1
    STATIC_CHECK_CONCURRENCY=2
    run_checker "par-vd-pass" bash -c "exit 0"
    run_checker "par-vd-fail" bash -c "exit 1"
    run_checker_parallel_wait || true
  `);
  const byName = Object.fromEntries(readLedgerRows(root).map((r) => [r.name, r]));
  assert.equal(byName["par-vd-pass"].verdict, "pass");
  assert.equal(byName["par-vd-fail"].verdict, "fail");
});

test("AC2/AC3 — checker-cost.ts recordCheckerCost writes the verdict field (pass/fail/not-evaluated)", () => {
  const root = makeTmpDir("cc-verdict-ts-");
  recordCheckerCost({ root, name: "ts-pass", ms: 1, verdict: "pass" });
  recordCheckerCost({ root, name: "ts-fail", ms: 2, verdict: "fail" });
  recordCheckerCost({ root, name: "ts-not-eval", ms: 3, verdict: "not-evaluated" });
  const file = path.join(root, ".quay", "checker-cost.jsonl");
  const byName = Object.fromEntries(readCheckerCost(file).map((r) => [r.name, r]));
  assert.equal(byName["ts-pass"].verdict, "pass");
  assert.equal(byName["ts-fail"].verdict, "fail");
  assert.equal(byName["ts-not-eval"].verdict, "not-evaluated");
});

test("AC2 — engine.ts gate recorder writes the verdict field (pass/fail)", async () => {
  const root = makeTmpDir("cc-verdict-gate-");
  const mkClient = (ok) => ({
    taskGet: async (id) => ({ id, status: "todo" }),
    taskCheck: async (id) => ({ id, ok, reason: ok ? "eligible" : "missing artifacts" }),
  });
  await runGate({ client: mkClient(true), id: "T-1", gate: "dod", logPath: path.join(root, "gate-events.jsonl"), workspaceRoot: root });
  await runGate({ client: mkClient(false), id: "T-9", gate: "dod", logPath: path.join(root, "gate-events.jsonl"), workspaceRoot: root });
  const rows = readLedgerRows(root);
  assert.equal(rows.length, 2, "two gate executions → two cost rows (workspaceRoot set)");
  assert.equal(rows[0].verdict, "pass");
  assert.equal(rows[1].verdict, "fail");
  assert.match(rows[0].name, /^gate:dod:T-1$/);
});

test("AC4 — old-format rows (no verdict) still parse via readCheckerCost (backward compatible, no migration)", () => {
  const root = makeTmpDir("cc-verdict-backcompat-");
  const file = path.join(root, ".quay", "checker-cost.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"name":"old-check","ms":5,"n":1,"load":0.5,"at":"2026-01-01T00:00:00Z"}\n');
  const rows = readCheckerCost(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "old-check");
  assert.equal(rows[0].verdict, undefined, "verdict is simply absent on an old row — not a parse failure");
});
