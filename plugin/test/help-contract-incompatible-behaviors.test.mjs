// @test-group serial
// @load-sensitive child-spawn
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
//         — as measure-trend-check did — fails this);
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

/** Map of rel-path → `${mtimeMs}:${size}` for every FILE under `dir` (symlinks not followed). */
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
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const st = fs.statSync(p);
        out.set(path.relative(dir, p), `${st.mtimeMs}:${st.size}`);
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
