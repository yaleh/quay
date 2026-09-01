// @test-group serial
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-28 child-spawn (spawns every *-check.ts --help subprocess to verify the help contract; load-race-prone under full-suite concurrency)
// help-contract-incompatible-behaviors.test.mjs — 全部 plugin/scripts/*-check.ts 的 `--help` 契约
// (tasks/gap-help-contract-incompatible-behaviors, AC1/AC2/AC3 + DoD).
//
// THE DEFECT: 14+ checkers had four mutually-incompatible `--help` behaviors — usage+exit 0 (OK),
// usage but exit 2 (harness reads a failure), reject ("unknown flag: --help" / "manifest not
// found"), and silent-full-run (measure-trend-check even APPENDED a round to
// .quay/measure-history.jsonl — a real business side effect from a flag that must be side-effect-free).
//
// THE CONTRACT (gap-scripts-sprawl): `--help` ⇒ usage FIRST, exit 0, NO business side effect.
// This file pins three things, each able to take a false value:
//   AC1 — every `-check.ts` exits 0 AND prints usage on `--help`; NEGATIVE CONTROL: running `--help`
//         over all of them leaves the `.quay/` mtime set unchanged (a checker that writes on `--help`
//         — as measure-trend-check did — fails this); resident-driver runtime files are excluded from
//         the snapshot (gap-suite-help-contract-mtime-race: they tick independently, not on `--help`);
//   AC2 — `ready-pool-check --help` no longer self-contradicts ("unknown flag: --help (run with
//         --help)") — it prints normal usage and exits 0;
//   AC3 — `measure-trend-check --help` does NOT append to .quay/measure-history.jsonl (hermetic:
//         a real __PERFILE__ log fixture is pointed at a temp --history/--log; the file must not
//         be created).
//
// Runs in the `serial` phase (concurrency 1): it spawns ~160 child processes and compares an mtime
// SET across the sweep, so it must not race another test writing to the shared worktree.
//
// Run:
//   scripts/test.sh plugin/test/help-contract-incompatible-behaviors.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(repoRoot, "plugin", "scripts");

/** Every plugin/scripts/*-check.ts, sorted (the 77-checker contract surface). */
function listCheckers() {
  return fs.readdirSync(SCRIPTS).filter((f) => f.endsWith("-check.ts")).sort();
}

/** Run one checker with `--help` (plus optional extra args), capturing exit code + output. */
function runHelp(checkerRel, extraArgs = []) {
  const abs = path.join(SCRIPTS, checkerRel);
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", abs, "--help", ...extraArgs],
    { encoding: "utf8", timeout: 60_000 },
  );
}

// Resident-driver runtime files (gap-suite-help-contract-mtime-race): promotion-driver / worker-driver
// write these every tick — round/outcome heartbeats, the per-checker cost ledger, and control files —
// plus supervisor/driver/liveness logs and pid files (driver-runtime.ts DRIVER_KINDS `prefix`/`carriers`/
// `controlFile`). Their mtime moving during the sweep is resident-driver bookkeeping, NOT a checker's
// `--help` side effect, so the AC1 negative control must not count it (driver active ⇒ stable false red,
// killing every fan-in). ⛔ measure-history.jsonl is deliberately NOT excluded — measure-trend-check
// appending it on `--help` is the EXACT side effect this test exists to catch (AC3 must not degrade).
const RESIDENT_DRIVER_FILES = new Set([
  "checker-cost.jsonl",       // per-checker/gate cost ledger (checker-cost.ts, appended by driver ticks)
  "promotion-round.jsonl",    // promotion-driver unconditional round heartbeat
  "promotion-outcome.jsonl",  // promotion-driver outcome ledger
  "worker-round.jsonl",       // worker-driver unconditional round heartbeat
  "worker-outcome.jsonl",     // worker-driver outcome ledger
  "promotion-control.json",   // promotion-driver drain/resume control state
  "worker-control.json",      // worker-driver drain/resume control state
]);

/** True when `relPath` is a resident-driver runtime file (never a checker `--help` side effect). */
function isResidentDriverFile(relPath) {
  const base = path.basename(relPath);
  if (RESIDENT_DRIVER_FILES.has(base)) return true;
  // supervisor/driver/liveness log + pid files (driver-runtime.ts prefix ∈ {promotion-driver,
  // worker-driver}): <prefix>.(log|pid), <prefix>-supervisor.(log|pid), <prefix>-liveness.log,
  // <prefix>-inflight.pid.
  return /^(promotion|worker)-driver(-(supervisor|liveness|inflight))?\.(log|pid)$/.test(base);
}

/** Map of rel-path → `${mtimeMs}:${size}` for every FILE under `dir` (symlinks not followed),
 *  excluding resident-driver runtime files (which move independently of any checker `--help`). */
function snapshotMtimeSet(dir) {
  const out = new Map();
  const walk = (d) => {
    let es;
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        // `scripts/test.sh` sets NODE_COMPILE_CACHE=<root>/.quay/node-compile-cache (gap-node-compile-
        // cache-is-never-enabled…), so every `--experimental-strip-types` spawn here legitimately writes
        // there — a Node build artifact, not a business side effect (same exclusion rationale as
        // task-status-drift-check.ts listRepoFiles: "bookkeeping, never implementation evidence").
        if (e.name === "node-compile-cache") continue;
        walk(p);
      } else if (e.isFile()) {
        const rel = path.relative(dir, p);
        if (isResidentDriverFile(rel)) continue; // resident-driver bookkeeping, not a checker side effect
        const st = fs.statSync(p);
        out.set(rel, `${st.mtimeMs}:${st.size}`);
      }
    }
  };
  walk(dir);
  return out;
}

function diffMtimeSet(before, after) {
  const changed = [];
  for (const [k, v] of before) if (after.get(k) !== v) changed.push(`${k}: ${v} -> ${after.get(k)}`);
  for (const [k, v] of after) if (!before.has(k)) changed.push(`${k}: (created) ${v}`);
  return changed;
}

test("AC1: every -check.ts exits 0 + prints usage on --help, with zero .quay mtime change", () => {
  const checkers = listCheckers();
  // NB: coverage is defined by the directory scan itself, NOT a hardcoded count — the count drifts
  // as checkers are retired/added (the "77" this task was filed against is already 75). Guard only
  // against a broken scan that silently returns nothing (a structurally-true no-op, hard rule 4).
  assert.ok(checkers.length > 0, `expected a non-empty -check.ts set, found ${checkers.length}`);

  const quay = path.join(repoRoot, ".quay");
  const before = snapshotMtimeSet(quay);

  const failures = [];
  for (const c of checkers) {
    const res = runHelp(c);
    const text = `${res.stdout}${res.stderr}`.trim();
    if (res.status !== 0) {
      failures.push(`${c}: exit ${res.status}${res.signal ? ` (${res.signal})` : ""} — ${text.slice(0, 140)}`);
    } else if (!text) {
      failures.push(`${c}: exit 0 but printed no usage`);
    }
  }

  const after = snapshotMtimeSet(quay);
  const changed = diffMtimeSet(before, after);

  assert.deepEqual(failures, [], "checkers violating exit-0 + prints-usage:");
  assert.deepEqual(changed, [], "checkers with a --help side effect (.quay mtime changed):");
});

test("AC2: ready-pool-check --help prints usage (not 'unknown flag: --help') and exits 0", () => {
  const res = runHelp("ready-pool-check.ts");
  const text = `${res.stdout}${res.stderr}`;
  assert.equal(res.status, 0, `ready-pool-check --help exit ${res.status}: ${text.slice(0, 140)}`);
  assert.ok(!/unknown flag: --help/.test(text), "self-contradictory 'unknown flag: --help' must be gone");
  assert.match(text, /usage/i, "must print normal usage");
});

test("AC3: measure-trend-check --help does not append to measure-history.jsonl", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "help-contract-mt-"));
  const log = path.join(tmp, "full-suite.log");
  const hist = path.join(tmp, "measure-history.jsonl");
  // A real __PERFILE__ log so that, WITHOUT the fix, landMeasureHistory would append a round.
  fs.writeFileSync(log, "__PERFILE__ duration_ms=100 plugin/test/x.test.mjs passed=true\n");
  const res = runHelp("measure-trend-check.ts", ["--history", hist, "--log", log]);
  assert.equal(res.status, 0, `measure-trend-check --help exit ${res.status}`);
  assert.ok(!fs.existsSync(hist), "measure-trend-check --help must not create measure-history.jsonl");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("mtime-race AC3 (negative control not degraded): driver-file exclusion still catches a real side effect", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "help-contract-mtime-"));
  try {
    // A .quay/-shaped dir holding resident-driver files AND a business file. The business file is what a
    // real checker `--help` side effect would touch (e.g. measure-history.jsonl — deliberately NOT excluded).
    fs.writeFileSync(path.join(tmp, "checker-cost.jsonl"), "x\n");
    fs.writeFileSync(path.join(tmp, "promotion-round.jsonl"), "x\n");
    fs.writeFileSync(path.join(tmp, "worker-driver-liveness.log"), "x\n");
    fs.writeFileSync(path.join(tmp, "measure-history.jsonl"), "x\n");
    const before = snapshotMtimeSet(tmp);

    // A resident-driver tick appends to its own files — must be invisible to the diff (excluded).
    fs.appendFileSync(path.join(tmp, "checker-cost.jsonl"), "y\n");
    fs.appendFileSync(path.join(tmp, "promotion-round.jsonl"), "y\n");
    fs.appendFileSync(path.join(tmp, "worker-driver-liveness.log"), "y\n");
    assert.deepEqual(diffMtimeSet(before, snapshotMtimeSet(tmp)), [], "driver-tick mtime changes must be excluded");

    // A real `--help` side effect (a non-driver file) must still be caught — exclusion is not over-broad.
    fs.appendFileSync(path.join(tmp, "measure-history.jsonl"), "y\n");
    const changed = diffMtimeSet(before, snapshotMtimeSet(tmp));
    assert.ok(changed.some((c) => c.startsWith("measure-history.jsonl")), "checker side effect must still be caught");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
