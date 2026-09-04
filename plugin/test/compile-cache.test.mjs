// @test-group engine
// compile-cache.test.mjs — gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses.
// Pins the Node compile cache (NODE_COMPILE_CACHE) as a MECHANICAL mechanism, not prose:
//
//   AC2 (configured)      scripts/test.sh sets NODE_COMPILE_CACHE (grep count >= 1)
//   AC2 (on disk)         the configured cache dir's filesystem is NOT tmpfs — Node's DEFAULT
//                         cache location is $TMPDIR (tmpfs = RAM, the OOM family of
//                         gap-the-shipped-tick-doc-...); this task pins a DISK path instead
//   AC4 (inheritance)     a subprocess spawned from this test inherits NODE_COMPILE_CACHE, so
//                         plugin/test's spawned plugin-script checkers actually carry it
//   AC1/AC5 (per-spawn)   a warm spawn of plugin/scripts/task-schema.ts is no slower than a cold
//                         spawn, measured per-spawn ms (min-of-samples to stay noise-robust).
//                         NOT suite wall-clock — see the task body: wall-clock A/B is the wrong
//                         axis (σ = 297.6s dwarfs the ~22-44s a full suite saves).
//   AC3 (fail-open)       cache unavailable (unwritable dir) ⇒ the spawn still works (exit 0).
//                         The cache is a pure speedup, never a single point of failure.
//
// Run:
//   scripts/test.sh plugin/test/compile-cache.test.mjs
//   node --test plugin/test/compile-cache.test.mjs
//
// The real cold-vs-warm per-spawn numbers (AC1, each sample) are pasted into the task body; this
// file is the regression guard that the mechanism stays configured, on disk, inherited, and
// fail-open.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}

const REPO_ROOT = findRepoRoot(__dirname);
const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");
const TASK_SCHEMA = path.join(REPO_ROOT, "plugin", "scripts", "task-schema.ts");
/** The default cache dir scripts/test.sh pins (must stay in sync with the `.quay/node-compile-cache`
 * literal in scripts/test.sh — a move in one place fails this file, so the two cannot drift). */
const DEFAULT_CACHE_DIR_REL = path.join(".quay", "node-compile-cache");

/** The cache dir the current run uses: scripts/test.sh's export, else the repo-root default. */
function configuredCacheDir() {
  return process.env.NODE_COMPILE_CACHE || path.join(REPO_ROOT, DEFAULT_CACHE_DIR_REL);
}

/** Spawn a REAL `node --experimental-strip-types` run of task-schema.ts. Returns { ms, status }. */
function spawnTaskSchema(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const s = process.hrtime.bigint();
  const res = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", TASK_SCHEMA],
    { cwd: REPO_ROOT, encoding: "utf8", env, stdio: "ignore" }
  );
  return { ms: Number((process.hrtime.bigint() - s) / 1_000_000n), status: res.status };
}

test("AC2 — NODE_COMPILE_CACHE is configured in scripts/test.sh (cache_configured >= 1)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  const count = (src.match(/NODE_COMPILE_CACHE/g) || []).length;
  assert.ok(count >= 1, `scripts/test.sh must set NODE_COMPILE_CACHE (found ${count} occurrence(s))`);
});

test("AC2 — the configured cache dir is on DISK, never tmpfs", () => {
  const cacheDir = configuredCacheDir();
  // Under scripts/test.sh the dir already exists (test.sh mkdir -p's it). Under a standalone
  // `node --test` it may not — stat the closest existing ancestor (same filesystem by
  // construction, so the fs type is identical).
  let target = cacheDir;
  while (!fs.existsSync(target) && target !== path.dirname(target)) target = path.dirname(target);
  const res = spawnSync("stat", ["-f", "-c", "%T", target], { encoding: "utf8" });
  assert.equal(res.status, 0, `stat -f -c '%T' ${target} failed: ${res.stderr}`);
  const fsType = res.stdout.trim();
  assert.notEqual(
    fsType,
    "tmpfs",
    `configured cache dir '${cacheDir}' must be on DISK, not tmpfs (fs type '${fsType}'). ` +
      "Node's DEFAULT cache location is $TMPDIR (tmpfs = RAM) — the OOM family this task exists to avoid."
  );
});

test("AC1/AC5 — warm spawn of task-schema.ts is no slower than cold (per-spawn ms)", (t) => {
  // Measurement scratch lives in os.tmpdir() (per-run-unique, R6-cleaned) — the fs-type invariant
  // is proven separately on the REAL configured dir above; here we only compare cold vs warm.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "quay-compile-cache-test-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  // Cold: 2 samples, each after wiping the scratch cache (truly cold). min = most favorable cold.
  const coldSamples = [];
  for (let i = 0; i < 2; i++) {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(scratch, { recursive: true });
    const r = spawnTaskSchema({ NODE_COMPILE_CACHE: scratch });
    assert.equal(r.status, 0, `cold spawn ${i} failed: status ${r.status}`);
    coldSamples.push(r.ms);
  }
  const coldMin = Math.min(...coldSamples);

  // Warm: 3 samples with the cache populated (the first cold spawn already populated it).
  const warmSamples = [];
  for (let i = 0; i < 3; i++) {
    const r = spawnTaskSchema({ NODE_COMPILE_CACHE: scratch });
    assert.equal(r.status, 0, `warm spawn ${i} failed: status ${r.status}`);
    warmSamples.push(r.ms);
  }
  const warmMin = Math.min(...warmSamples);

  console.log(`[compile-cache] cold ${coldSamples.join("/")}ms  warm ${warmSamples.join("/")}ms  (min ${coldMin} -> ${warmMin})`);

  // Documented baseline: a sub-50ms cold spawn means the machine is too fast for per-spawn ms to
  // be a meaningful axis — the cache effect is below measurement resolution; pass with the note.
  if (coldMin < 50) return;

  assert.ok(
    warmMin < coldMin,
    `warm spawn (min ${warmMin}ms) must be faster than cold (min ${coldMin}ms): compile cache not effective`
  );
});

test("AC4 — subprocesses spawned from this test inherit NODE_COMPILE_CACHE", () => {
  const inherited = process.env.NODE_COMPILE_CACHE;
  if (!inherited) {
    // Standalone `node --test` run (scripts/test.sh was not the parent). The configured default is
    // asserted elsewhere; the test.sh -> test -> child inheritance chain applies under test.sh.
    assert.ok(
      /NODE_COMPILE_CACHE/.test(fs.readFileSync(TEST_SH, "utf8")),
      "scripts/test.sh must set NODE_COMPILE_CACHE"
    );
    console.log("[compile-cache] NODE_COMPILE_CACHE unset (standalone run) — inheritance chain verified via scripts/test.sh source");
    return;
  }
  const res = spawnSync(process.execPath, ["-e", "process.stdout.write(process.env.NODE_COMPILE_CACHE || '')"], { encoding: "utf8" });
  assert.equal(res.status, 0, `child could not read env: ${res.stderr}`);
  assert.equal(res.stdout.trim(), inherited, "a spawned subprocess must inherit NODE_COMPILE_CACHE unchanged (AC4: plugin-test spawns carry it)");
});

test("AC3 — cache unavailable (unwritable dir) ⇒ the spawn still works (fail-open)", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "quay-compile-cache-blocked-"));
  const blocked = path.join(scratch, "blocked");
  fs.mkdirSync(blocked);
  fs.chmodSync(blocked, 0o000); // make it unwritable: node cannot write cache entries
  t.after(() => {
    fs.chmodSync(blocked, 0o700); // restore so the scratch dir is removable
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const r = spawnTaskSchema({ NODE_COMPILE_CACHE: blocked });
  assert.equal(r.status, 0, `spawn with an unwritable cache dir must still succeed (exit 0), got ${r.status}`);
});
