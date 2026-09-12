// @test-group engine
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
//         — as measure-trend-check did — fails this); resident-process runtime files (driver + the
//         full-suite runner itself + the cap-observation chain + the session-liveness observer registry +
//         the suite-harness selection/gate caches)
//         are excluded from the snapshot (gap-suite-help-contract-mtime-race +
//         gap-concurrency-cap-state-help-contract-mtime-race: they tick independently, not on `--help`);
//         the mtime check retries a bounded number of times
//         (③ fallback) — a deterministic side effect reproduces every attempt, a transient tick does not;
//   AC2 — `ready-pool-check --help` no longer self-contradicts ("unknown flag: --help (run with
//         --help)") — it prints normal usage and exits 0;
//   AC3 — `measure-trend-check --help` does NOT append to .quay/measure-history.jsonl (hermetic:
//         a real __PERFILE__ log fixture is pointed at a temp --history/--log; the file must not
//         be created).
//
// Runs in the `engine` group (@test-group above — the authoritative declaration; this line used to
// claim "serial phase, concurrency 1" and was NOT updated by fabe76d82, the 2026-09-05
// reclassification that moved it serial → engine). It spawns ~160 child processes and compares an
// mtime SET across the sweep, so a CONCURRENT writer to the shared worktree's `.quay/` is the one
// thing it cannot tolerate — under concurrency 1 that premise held by construction, under the
// concurrent group it holds only because the exclusion set above is COMPLETE. That gap is what
// produced the 2026-09-11 false red (see SUITE_HARNESS_CACHE_FILES): a reclassification must carry
// its exclusion-set audit with it, or this control's red stops meaning "a checker has a side effect".
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

// Resident-process runtime files (gap-suite-help-contract-mtime-race) — written independently of any
// checker's `--help`, so the AC1 negative control must not count their mtime movement (else driver/
// suite active ⇒ stable false red, killing every fan-in). Two writers:
//   (a) the resident promotion/worker drivers — round/outcome heartbeats, the per-checker cost ledger,
//       control files, plus supervisor/driver/liveness logs and pid files (driver-runtime.ts DRIVER_KINDS
//       `prefix`/`carriers`/`controlFile`);
//   (b) the full-suite runner itself — its state file is MIRRORED into the tested checkout's own
//       `.quay/full-suite-state.json` on every state transition (full-suite-runner.ts writeSuiteState),
//       and its log/load-sampler/verification-round carriers land in the gate `.quay/`.
// ⛔ measure-history.jsonl is deliberately NOT excluded — measure-trend-check appending it on `--help`
// is the EXACT side effect this test exists to catch (AC3 must not degrade).
const RESIDENT_DRIVER_FILES = new Set([
  "checker-cost.jsonl",       // per-checker/gate cost ledger (checker-cost.ts, appended by driver ticks)
  "promotion-round.jsonl",    // promotion-driver unconditional round heartbeat
  "promotion-outcome.jsonl",  // promotion-driver outcome ledger
  "worker-round.jsonl",       // worker-driver unconditional round heartbeat
  "worker-outcome.jsonl",     // worker-driver outcome ledger
  "promotion-control.json",   // promotion-driver drain/resume control state
  "worker-control.json",      // worker-driver drain/resume control state
]);

/** Suite-runner runtime files — written by full-suite-runner.ts, never by a checker `--help`. */
const SUITE_RUNNER_FILES = new Set([
  "full-suite-state.json",    // runner state, MIRRORED into the tested checkout on every transition
  "full-suite.log",           // runner stdout/stderr tee
  "verification-round.jsonl", // round duration ledger, appended on suite completion
]);

// Cap-observation runtime file (gap-concurrency-cap-state-help-contract-mtime-race): the layer-tick
// cap-observation chain (accounting-emit.ts autoOccupancy → cap-from-gate.sh → cap-from-gate.ts
// computeEffectiveCap → saveState) writes .quay/concurrency-cap-state.json on every invocation — a
// resident-process runtime carrier, NOT a checker `--help` side effect (no -check.ts imports or
// spawns cap-from-gate; verified by per-checker bisect). refresh-worktree-quay.sh copies it into the
// worktree at suite startup, and a concurrent layer tick / test spawning accounting-emit against the
// worktree bumps its mtime mid-sweep (the observed false red). Excluded like the driver + suite-runner
// carriers above; the mtime-race AC3 negative control below still pins that a REAL `--help` side effect
// (measure-history.jsonl) is caught.
const CAP_OBSERVATION_FILES = new Set([
  "concurrency-cap-state.json", // cap-from-gate.ts STATE_FILE_NAME, written by computeEffectiveCap
]);

// Suite-harness selection/gate caches (fan-in suite 实测暴露 2026-09-11, task
// gap-ac161-user-scope-enable-repolluted-by-cli-materialization): rewritten by the SUITE HARNESS's
// OWN selection machinery in the tested worktree — never by a checker `--help`. The writer chain
// (verified by reading it, then reproduced directly):
//   a concurrent/nested `scripts/test.sh` (cwd = the tested worktree)
//     → run_static_checks → run_operational_checks
//     → runner-static-gate.ts:705 `suite-bucket-drift-check.ts --gate --root <worktree>`
//     → checkStaticVsTruth() / checkTruthSelection() → selectBucketsForTouches([...], root)
//     → writeBucketAttribution() → rewrites `<worktree>/.quay/suite-bucket-effective.jsonl`
// The rewrite is byte-identical (sha256 unchanged across the call; only mtime moves — 直接复现:
// 前后 sha256 同为 bc813d3f…, mtime 1789138260.9 → 1789138278.1), i.e. a pure cache churn tick.
// WHY EXCLUDED rather than "the checker writes it": an instrumented per-checker sweep (all 93
// `-check.ts` spawned `--help` one at a time, artifact mtime read before/after EACH spawn) recorded
// ZERO hits, and the only `-check.ts` that reaches the writer (suite-bucket-drift-check.ts) returns
// from `--help` before the call — so no checker `--help` can produce this tick. Same class as
// CAP_OBSERVATION_FILES above: an externally-driven runtime carrier, not a `--help` side effect.
// The mtime-race AC3 negative control below still pins that a REAL `--help` side effect
// (measure-history.jsonl) is caught.
const SUITE_HARNESS_CACHE_FILES = new Set([
  "suite-bucket-effective.jsonl", // suite-bucket-select.ts writeBucketAttribution (the observed tick)
  // Same call graph, same worktree: scripts/test.sh's suite-AFTER tail (:1654/:1701) runs
  // `suite-fs-trace.ts --update --limit 8` in the tested worktree, so a nested suite finishing
  // mid-sweep can append newly-traced files to this incremental cache. Not yet observed ticking
  // (its content-hash cache skips unchanged files), but the writer is the same harness path ⇒
  // excluded on the same rationale rather than left as a latent member of this same race.
  "suite-fs-trace.jsonl",
]);

/** True when `relPath` is a resident-process runtime file (never a checker `--help` side effect). */
function isNonCheckerRuntimeFile(relPath) {
  const base = path.basename(relPath);
  if (
    RESIDENT_DRIVER_FILES.has(base) ||
    SUITE_RUNNER_FILES.has(base) ||
    CAP_OBSERVATION_FILES.has(base) ||
    SUITE_HARNESS_CACHE_FILES.has(base)
  ) {
    return true;
  }
  // (a) driver supervisor/driver/liveness log + pid files (driver-runtime.ts prefix ∈ {promotion-driver,
  // worker-driver}): <prefix>.(log|pid), <prefix>-supervisor.(log|pid), <prefix>-liveness.log,
  // <prefix>-inflight.pid.
  // (b) suite load sampler: suite-load-<runId>.jsonl (full-suite-runner.ts startLoadSampler).
  // (c) session-liveness observer registry: session-liveness.<pid>.json — session-liveness.sh writes it on
  //     STARTUP (unless SL_NO_REGISTER=1) and removes it on EXIT; a resident monitor / manager / OS anchor
  //     that (re)starts mid-sweep CREATES a new file, a resident-process carrier — never a checker `--help`
  //     side effect (fan-in suite 实测暴露, gap-concurrency-cap-state-help-contract-mtime-race).
  return (
    /^(promotion|worker)-driver(-(supervisor|liveness|inflight))?\.(log|pid)$/.test(base) ||
    /^suite-load-.*\.jsonl$/.test(base) ||
    /^session-liveness\.[0-9]+\.json$/.test(base)
  );
}

/** Map of rel-path → `${mtimeMs}:${size}` for every FILE under `dir` (symlinks not followed),
 *  excluding resident-process runtime files (which move independently of any checker `--help`). */
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
        if (isNonCheckerRuntimeFile(rel)) continue; // resident-process bookkeeping, not a checker side effect
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

/** One sweep: snapshot `.quay`, run every checker `--help`, diff the mtime set. Returns the
 *  checker exit/usage violations (deterministic) and the mtime diff (flaky — resident-process
 *  runtime files tick independently of any checker `--help`, and the exclusion set is
 *  best-effort). */
function sweepMtime(checkers, quay) {
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
  return { failures, changed: diffMtimeSet(before, after) };
}

test("AC1: every -check.ts exits 0 + prints usage on --help, with zero .quay mtime change", () => {
  const checkers = listCheckers();
  // NB: coverage is defined by the directory scan itself, NOT a hardcoded count — the count drifts
  // as checkers are retired/added (the "77" this task was filed against is already 75). Guard only
  // against a broken scan that silently returns nothing (a structurally-true no-op, hard rule 4).
  assert.ok(checkers.length > 0, `expected a non-empty -check.ts set, found ${checkers.length}`);

  const quay = path.join(repoRoot, ".quay");
  const first = sweepMtime(checkers, quay);
  const failures = first.failures;

  // The mtime negative control is flaky (gap-suite-help-contract-mtime-race): a transient
  // resident-process tick can slip a single mtime change into the diff even though the exclusion
  // set covers every KNOWN runtime file. Retry the sweep a bounded number of times before failing
  // (③ from the task's 补充处置: ① 除根 + ③ 兜底). A DETERMINISTIC checker `--help` side effect
  // reproduces on every attempt, a transient tick does not — so retrying cannot mask a real side
  // effect (the mtime-race AC3 test below pins that a real side effect is still caught in one pass).
  const MAX_MTIME_ATTEMPTS = 3;
  let changed = first.changed;
  for (let attempt = 1; changed.length > 0 && attempt < MAX_MTIME_ATTEMPTS; attempt++) {
    changed = sweepMtime(checkers, quay).changed;
  }

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

test("mtime-race AC3 (negative control not degraded): resident-process file exclusion still catches a real side effect", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "help-contract-mtime-"));
  try {
    // A .quay/-shaped dir holding resident-process files (driver + suite runner) AND a business file.
    // The business file is what a real checker `--help` side effect would touch (e.g. measure-history.jsonl
    // — deliberately NOT excluded).
    fs.writeFileSync(path.join(tmp, "checker-cost.jsonl"), "x\n");
    fs.writeFileSync(path.join(tmp, "promotion-round.jsonl"), "x\n");
    fs.writeFileSync(path.join(tmp, "worker-driver-liveness.log"), "x\n");
    fs.writeFileSync(path.join(tmp, "full-suite-state.json"), "x\n");
    fs.writeFileSync(path.join(tmp, "suite-load-mfi-x-123-abc.jsonl"), "x\n");
    fs.writeFileSync(path.join(tmp, "concurrency-cap-state.json"), "x\n");
    fs.writeFileSync(path.join(tmp, "session-liveness.305362.json"), "x\n");
    // Suite-harness selection/gate caches (SUITE_HARNESS_CACHE_FILES) — same control as the rest:
    // a tick on them must be invisible, and (below) a tick on the business file must still show.
    fs.writeFileSync(path.join(tmp, "suite-bucket-effective.jsonl"), "x\n");
    fs.writeFileSync(path.join(tmp, "suite-fs-trace.jsonl"), "x\n");
    fs.writeFileSync(path.join(tmp, "measure-history.jsonl"), "x\n");
    const before = snapshotMtimeSet(tmp);

    // A resident-process tick appends to its own files — must be invisible to the diff (excluded).
    fs.appendFileSync(path.join(tmp, "checker-cost.jsonl"), "y\n");
    fs.appendFileSync(path.join(tmp, "promotion-round.jsonl"), "y\n");
    fs.appendFileSync(path.join(tmp, "worker-driver-liveness.log"), "y\n");
    fs.appendFileSync(path.join(tmp, "full-suite-state.json"), "y\n");
    fs.appendFileSync(path.join(tmp, "suite-load-mfi-x-123-abc.jsonl"), "y\n");
    fs.appendFileSync(path.join(tmp, "concurrency-cap-state.json"), "y\n");
    fs.appendFileSync(path.join(tmp, "session-liveness.305362.json"), "y\n");
    fs.appendFileSync(path.join(tmp, "suite-bucket-effective.jsonl"), "y\n");
    fs.appendFileSync(path.join(tmp, "suite-fs-trace.jsonl"), "y\n");
    assert.deepEqual(diffMtimeSet(before, snapshotMtimeSet(tmp)), [], "resident-process tick mtime changes must be excluded");

    // A real `--help` side effect (a non-runtime file) must still be caught — exclusion is not over-broad.
    fs.appendFileSync(path.join(tmp, "measure-history.jsonl"), "y\n");
    const changed = diffMtimeSet(before, snapshotMtimeSet(tmp));
    assert.ok(changed.some((c) => c.startsWith("measure-history.jsonl")), "checker side effect must still be caught");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
