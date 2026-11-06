// @test-group engine
// temp-root-reaper.test.mjs — RED/GREEN tests for plugin/scripts/temp-root-reaper.ts
// (gap-test-harness-tmp-dir-leak).
//
// WHAT IS BEING PINNED. The defect is the 硬规则 3b shape — no reading ever turns red because /tmp
// holds 46,218 `quay-*` dirs, so the leak looks exactly like "everything is fine". The reaper is the
// instrument that makes it countable, and this file pins each of its decision branches in BOTH
// directions (a criterion that only tests one direction is not a criterion):
//
//   age        — an entry older than --max-age is removed; one younger than it survives.
//   liveness   — an entry a LIVE process stands in (cwd) survives even at --max-age 0; the SAME entry
//                is removed once that process is gone (so the survivor is not "everything survives").
//   dry-run    — candidates are reported and NOTHING is removed (AC5).
//   telemetry  — created/reaped/leaked are three numbers on one line, and `leaked=0` is
//                DISTINGUISHABLE from `leaked=NOT-EVALUATED` (the run whose reaper never ran).
//   instrument — a /proc that cannot be read ⇒ evaluated=false + nothing removed. This is the
//                negative control that keeps "I could not evaluate" from being printed as "no owner".
//   scope      — the name prefix and the cross-run-cache exclusion bound what may be touched.
//
// Run:
//   scripts/test.sh plugin/test/temp-root-reaper.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  reapTempRoots,
  tempRootTelemetryLine,
  parseDurationMs,
  readLiveCwds,
  isHeldByLiveProcess,
  DEFAULT_EXCLUDES,
} from "../scripts/temp-root-reaper.ts";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAPER = path.join(__dirname, "..", "scripts", "temp-root-reaper.ts");

const HOUR = 3_600_000;

/** mkdir + backdate the mtime so the age axis is drivable (ctime cannot be backdated, which is why
 *  the reaper's age gate reads mtime — see its header). */
function mkOldDir(root, name, ageMs) {
  const p = path.join(root, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "payload.txt"), "x");
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(p, t, t);
  return p;
}

function mkDir(root, name) {
  const p = path.join(root, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "payload.txt"), "x");
  return p;
}

async function waitFor(predicate, { timeoutMs = 10_000, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// ── age axis: BOTH directions ─────────────────────────────────────────────────────────────────────
test("age: an entry older than --max-age is reaped; a younger one is spared", () => {
  const root = makeTmpDir("reaper-age-");
  const oldDir = mkOldDir(root, "quay-old", 10 * HOUR);
  const youngDir = mkDir(root, "quay-young");

  const r = reapTempRoots({ root, maxAgeMs: HOUR });

  assert.deepEqual(r.reaped, [oldDir], "the 10h-old entry must be the one removed");
  assert.deepEqual(r.sparedYoung, [youngDir], "the just-created entry must be spared");
  assert.equal(fs.existsSync(oldDir), false, "old entry is gone from disk");
  assert.equal(fs.existsSync(youngDir), true, "young entry survives");
  assert.equal(r.evaluated, true);
  assert.equal(r.created, 2, "created counts both entries present at scan time");
  assert.deepEqual(r.leaked, [youngDir], "leaked = what the next run would inherit");
});

// ── liveness axis: BOTH directions (spared while held, reaped once released) ──────────────────────
test("liveness: a dir held as a live process cwd survives, and is reaped after that process exits", async () => {
  const root = makeTmpDir("reaper-live-");
  const held = mkDir(root, "quay-held");
  const free = mkDir(root, "quay-free");

  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    cwd: held,
    stdio: "ignore",
  });
  try {
    assert.ok(
      await waitFor(() => {
        try {
          return fs.realpathSync(`/proc/${child.pid}/cwd`) === fs.realpathSync(held);
        } catch {
          return false;
        }
      }),
      "the probe child must actually be standing in the fixture before the assertion means anything",
    );

    const r1 = reapTempRoots({ root, maxAgeMs: 0 });
    assert.deepEqual(r1.sparedLiveCwd, [held], "the held dir is spared BECAUSE it has a live owner");
    assert.equal(fs.existsSync(held), true, "held dir survives the reap");
    assert.deepEqual(r1.reaped, [free], "the unheld dir is still reaped in the same pass (not everything survives)");
    assert.equal(fs.existsSync(free), false);
  } finally {
    child.kill("SIGKILL");
  }
  await new Promise((resolve) => child.once("exit", resolve));

  const r2 = reapTempRoots({ root, maxAgeMs: 0 });
  assert.deepEqual(r2.reaped, [held], "once the owner is gone the SAME dir is residue and is removed");
  assert.equal(fs.existsSync(held), false);
  assert.deepEqual(r2.leaked, []);
});

// ── dry-run (AC5): candidates reported, nothing removed ───────────────────────────────────────────
test("dry-run: reports the candidates and removes nothing", () => {
  const root = makeTmpDir("reaper-dry-");
  const a = mkOldDir(root, "quay-a", 5 * HOUR);
  const b = mkOldDir(root, "quay-b", 5 * HOUR);

  const r = reapTempRoots({ root, maxAgeMs: HOUR, dryRun: true });

  assert.deepEqual(r.candidates, [a, b], "both old entries are candidates");
  assert.deepEqual(r.reaped, [], "dry-run performs no removal");
  assert.equal(fs.existsSync(a), true, "candidate #1 still on disk");
  assert.equal(fs.existsSync(b), true, "candidate #2 still on disk");
  assert.deepEqual(r.leaked, [a, b], "dry-run's leaked equals what a real pass would leave");
});

// ── telemetry (AC4): three counts, zero distinguishable from never-measured ───────────────────────
test("telemetry: created/reaped/leaked are reported, and leaked=0 differs from NOT-EVALUATED", () => {
  const measured = tempRootTelemetryLine({ root: "/tmp/x", evaluated: true, created: 4, reaped: 4, leaked: 0 });
  assert.match(measured, /created=4/);
  assert.match(measured, /reaped=4/);
  assert.match(measured, /leaked=0/);
  assert.match(measured, /evaluated=true/);

  const notMeasured = tempRootTelemetryLine({
    root: "/tmp/x",
    evaluated: false,
    reason: "proc-cwd-unreadable",
    created: 0,
    reaped: 0,
    leaked: 0,
  });
  assert.doesNotMatch(notMeasured, /leaked=0/, "a run that never measured must NOT print leaked=0");
  assert.match(notMeasured, /leaked=NOT-EVALUATED/);
  assert.match(notMeasured, /evaluated=false/);
  assert.match(notMeasured, /reason=proc-cwd-unreadable/);
  assert.notEqual(measured, notMeasured, "the two states must not share an output");
});

// ── instrument guard (硬规则 3b negative control): unreadable /proc ⇒ remove NOTHING ─────────────
test("instrument guard: an unreadable proc root yields evaluated=false and removes nothing", () => {
  const root = makeTmpDir("reaper-noproc-");
  const victim = mkOldDir(root, "quay-victim", 30 * HOUR);

  const r = reapTempRoots({ root, maxAgeMs: 0, procRoot: path.join(root, "no-such-proc") });

  assert.equal(r.evaluated, false, "cannot read /proc ⇒ cannot judge");
  assert.equal(r.reason, "proc-cwd-unreadable");
  assert.deepEqual(r.reaped, [], "★ nothing is removed when liveness could not be evaluated");
  assert.equal(fs.existsSync(victim), true, "the entry survives the failed evaluation");
  assert.equal(
    tempRootTelemetryLine({ ...r, created: r.created, reaped: 0, leaked: r.leaked.length }),
    `tmp-root-telemetry: root=${root} created=NOT-EVALUATED reaped=NOT-EVALUATED ` +
      `leaked=NOT-EVALUATED evaluated=false reason=proc-cwd-unreadable`,
  );
});

test("instrument: a MISSING root is also not-evaluated (not 'clean')", () => {
  const r = reapTempRoots({ root: path.join(makeTmpDir("reaper-missing-"), "nope"), maxAgeMs: 0 });
  assert.equal(r.evaluated, false);
  assert.equal(r.reason, "root-missing");
});

// ── scope: prefix bounds what may be touched ─────────────────────────────────────────────────────
test("scope: only entries carrying the prefix are considered; unrelated entries are invisible", () => {
  const root = makeTmpDir("reaper-prefix-");
  const quay = mkOldDir(root, "quay-match", 5 * HOUR);
  const other = mkOldDir(root, "unrelated-match", 5 * HOUR);

  const r = reapTempRoots({ root, maxAgeMs: HOUR });

  assert.deepEqual(r.reaped, [quay]);
  assert.equal(fs.existsSync(other), true, "a non-prefixed entry is never a candidate");
  assert.equal(r.created, 1, "created counts only the prefix-matching entries");
});

test("scope: the cross-run shared build cache is excluded by name", () => {
  const root = makeTmpDir("reaper-exclude-");
  const cache = mkOldDir(root, DEFAULT_EXCLUDES[0], 100 * HOUR);

  const r = reapTempRoots({ root, maxAgeMs: HOUR });

  assert.deepEqual(r.sparedExcluded, [cache], "the shared build cache is spared even though it looks old");
  assert.equal(fs.existsSync(cache), true);
  assert.deepEqual(r.reaped, []);
});

test("scope: an excluded PREFIX spares the quay-run-* namespace family (owner-liveness keeps that one)", () => {
  const root = makeTmpDir("reaper-exclude-prefix-");
  const ns = mkOldDir(root, "quay-run-1a2b3c4d", 100 * HOUR);
  const junk = mkOldDir(root, "quay-init-leak", 100 * HOUR);

  const r = reapTempRoots({ root, maxAgeMs: HOUR, excludePrefixes: ["quay-run-"] });

  assert.deepEqual(r.sparedExcluded, [ns], "the run namespace is spared by prefix");
  assert.deepEqual(r.reaped, [junk], "and the sibling is still reaped in the same pass");
  assert.equal(fs.existsSync(ns), true);
});

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────
test("parseDurationMs accepts the documented forms and rejects garbage", () => {
  assert.equal(parseDurationMs("0"), 0);
  assert.equal(parseDurationMs("90s"), 90_000);
  assert.equal(parseDurationMs("30m"), 1_800_000);
  assert.equal(parseDurationMs("24h"), 86_400_000);
  assert.equal(parseDurationMs("7d"), 604_800_000);
  assert.equal(parseDurationMs(""), null);
  assert.equal(parseDurationMs("soon"), null);
});

test("readLiveCwds reports readable=false for a nonexistent proc root (never 'no owner')", () => {
  const r = readLiveCwds("/nonexistent-proc-root-xyz");
  assert.equal(r.readable, false);
  assert.equal(r.read, 0);
  assert.equal(r.cwds.size, 0);
});

test("isHeldByLiveProcess matches the dir itself and any descendant, but not a sibling", () => {
  const held = new Set(["/tmp/quay-a", "/tmp/quay-b/sub"]);
  assert.equal(isHeldByLiveProcess("/tmp/quay-a", held), true);
  assert.equal(isHeldByLiveProcess("/tmp/quay-b", held), true, "a cwd UNDER the entry owns it");
  assert.equal(isHeldByLiveProcess("/tmp/quay-c", held), false);
  assert.equal(isHeldByLiveProcess("/tmp/quay-ab", held), false, "sibling prefix is not containment");
});

// ── CLI (AC5's dry-run reading is the CLI's, not just the library's) ──────────────────────────────
test("CLI --dry-run --json: candidates listed, exit 0, nothing removed", () => {
  const root = makeTmpDir("reaper-cli-dry-");
  const a = mkOldDir(root, "quay-one", 5 * HOUR);
  const b = mkOldDir(root, "quay-two", 5 * HOUR);

  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", REAPER, "--root", root, "--max-age", "1h", "--dry-run", "--json"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.evaluated, true);
  assert.deepEqual(parsed.candidates, [a, b]);
  assert.deepEqual(parsed.reaped, []);
  assert.equal(fs.existsSync(a) && fs.existsSync(b), true);
});

test("CLI --dry-run text mode prints the candidate count and the first three paths", () => {
  const root = makeTmpDir("reaper-cli-text-");
  const paths = ["quay-p1", "quay-p2", "quay-p3", "quay-p4"].map((n) => mkOldDir(root, n, 5 * HOUR));

  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", REAPER, "--root", root, "--max-age", "1h", "--dry-run"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would remove=4/);
  for (const p of paths.slice(0, 3)) assert.ok(r.stdout.includes(p), `first-3 listing must name ${p}`);
  assert.match(r.stdout, /\+1 more/, "the tail is summarised, not omitted silently");
});

test("CLI --telemetry prints the one-line record, and exit 3 marks a refused evaluation", () => {
  const root = makeTmpDir("reaper-cli-tel-");
  mkOldDir(root, "quay-t", 5 * HOUR);

  const ok = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", REAPER, "--root", root, "--max-age", "1h", "--telemetry"],
    { encoding: "utf8" },
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout.trim(), /^tmp-root-telemetry: root=.+ created=1 reaped=1 leaked=0 evaluated=true$/);

  const refused = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      REAPER,
      "--root",
      root,
      "--max-age",
      "1h",
      "--proc-root",
      path.join(root, "no-proc"),
      "--telemetry",
    ],
    { encoding: "utf8" },
  );
  assert.equal(refused.status, 3, "NOT-EVALUATED has its own exit code, not 0 and not 1");
  assert.match(refused.stdout, /leaked=NOT-EVALUATED/);
});

test("CLI rejects an unparsable --max-age with exit 2", () => {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", REAPER, "--max-age", "banana"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot parse --max-age/);
});
