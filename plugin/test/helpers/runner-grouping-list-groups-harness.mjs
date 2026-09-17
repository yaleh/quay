// Shared harness for the runner-grouping-list-groups shards (split of runner-grouping-list-groups.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../runner-grouping-list-groups.test.mjs", import.meta.url).href;

// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn (shells out to real scripts/test.sh --list-files/--list-groups)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file shells
// out to the REAL scripts/test.sh metadata modes (--list-files/--list-groups,
// >830s isolated historically) — inherently heavy + fragile under full-suite concurrency (nested
// node --test spawns; the outer reruns this family isolated per the 判绿 rules).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class nested full-suite spawn) so it runs in the concurrency-1 serial phase,
// never competing with the concurrency-8 main body's worker pool. Its D-class AC7 fixture is kept
// in the shared plugin/test dir (that is what makes the undeclared→engine assertion meaningful);
// the collision with test-file-snapshot is fixed on the SNAPSHOT side (test-file-snapshot.sh
// excludes transient zz-* runtime fixtures).
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of the files split from the
// original runner-grouping.test.mjs (204s serial floor) by test concern — this file holds the
// --list-groups/--list-files RELATIONSHIP tests (the deduped partition invariants). The nested
// `@load-sensitive nested-spawn` annotation is preserved so the family membership + serial routing
// stay byte-identical.
// gap-test-suite-has-no-layer-grouping — tests for the layer-grouping mechanics in
// scripts/test.sh: extended glob (AC2), realpath dedup (AC3), default groups product,engine
// (AC4/AC6), and --list-groups (AC10). These shell out to the REAL
// scripts/test.sh (the single source of truth), not a copy of its logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(SRC_URL));

const repoRoot = join(__dirname, "..", "..");

const testSh = join(repoRoot, "scripts", "test.sh");

function runTestSh(...args) {
  // node --test sets NODE_TEST_CONTEXT=child-v8 on the running file; a child `node --test`
  // (spawned by test.sh for the fixture files) inherits it and suppresses its own output.
  // Strip all NODE_TEST_* vars so the child runs as a normal top-level test runner.
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith("NODE_TEST_")) delete cleanEnv[k];
  }
  // gap-runner-grouping-list-groups-perfile-timeout-flaky — the "perfile-timeout" red was NOT a
  // timeout: `__PERFILE__ passed=false` is a REAL test failure (measure-suite-reporter passes through
  // node's `details.passed`; see perfile-timeout-gate-name-misleads). The real failure is a transient
  // cross-file race: this file runs CONCURRENTLY with runner-grouping-serial-anti-stomp (both serial,
  // host-derived concurrency), whose AC0c briefly writes zz-unknown-group-anti-stomp.test.mjs with
  // `@test-group bogus` in the SHARED plugin/test dir. While that fixture is alive (the sibling's
  // own fail-closed `--list-groups` query — ~1.5s), scripts/test.sh FAIL-CLOSES (exit 3) on the
  // unknown group, so a metadata query (`--list-files`/`--list-groups`) started in that window exits 3.
  // That is a transient-window error, not a partition break:
  // re-read a bounded number of times so a GENUINE fail-closed (a committed bogus declaration) still
  // surfaces (it fails every re-read) while the transient fixture clears. Any OTHER non-zero exit is
  // a real failure and surfaces immediately.
  for (let attempt = 0; ; attempt++) {
    const r = spawnSync("bash", [testSh, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120000, env: cleanEnv });
    if (r.status === 0) return r.stdout;
    if (r.status !== 3 || attempt >= 3) {
      assert.equal(r.status, 0, `scripts/test.sh ${args.join(" ")} exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    }
  }
}

// 文件内去重 (gap-runner-grouping-dedupe-metadata-query): each --list-files/--list-groups re-spawns
// scripts/test.sh (a ~20-35s metadata query on this machine) and this file previously issued the
// parameter-identical pair twice (--list-files in AC3+AC6, --list-groups in AC10+AC3). node --test
// runs each test FILE in its own process, so this module-level memo is strictly per-file — zero
// cross-process state risk. Only PARAMETER-IDENTICAL calls share a result.
const metaCache = new Map();

function runTestShCached(...args) {
  const key = JSON.stringify(args);
  if (!metaCache.has(key)) metaCache.set(key, runTestSh(...args));
  return metaCache.get(key);
}

// Fresh re-read for readStable retries — re-queries the live tree and refreshes the cache entry.
// The anti-flake retry must see the current glob, not a stale snapshot (a transient zz-* fixture
// between two reads is the exact case round-310 hit); the cache serves only the happy path.
function runTestShRefresh(...args) {
  const key = JSON.stringify(args);
  const out = runTestSh(...args);
  metaCache.set(key, out);
  return out;
}

// ── async / PARALLEL metadata queries (gap-suite-split-15-over-30s-test-files, AC3) ──────────────────
// `runTestSh` is `spawnSync` ⇒ BLOCKING, so a test that needs several INDEPENDENT metadata queries pays
// their costs one after another. Shard runner-grouping-list-groups-s03 needs four (no-args + the three
// group lists of the partition relationship); sequentially it measured **31.98s in the full suite**,
// past the 30s per-file ceiling this task enforces, purely from four × ~8s of blocking `--list-files`.
// The four queries do not depend on each other, so running them concurrently is both faster AND
// stricter: they now observe ONE tree state instead of four successive ones.
//
// Same contract as the sync twin: NODE_TEST_* scrubbed from the child env, 120s deadline, and the
// bounded exit-3 retry (exit 3 = a sibling's transient unknown-group fixture; a GENUINE fail-closed
// fails every re-read and still surfaces via the assert).
async function runTestShAsync(...args) {
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith("NODE_TEST_")) delete cleanEnv[k];
  }
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let stdout = "";
    let stderr = "";
    try {
      const r = await execFileAsync("bash", [testSh, ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 120000,
        env: cleanEnv,
        maxBuffer: 64 * 1024 * 1024,
      });
      stdout = r.stdout;
    } catch (e) {
      status = typeof e.code === "number" ? e.code : 1;
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
    }
    if (status === 0) return stdout;
    if (status !== 3 || attempt >= 3) {
      assert.equal(status, 0, `scripts/test.sh ${args.join(" ")} exited ${status}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
  }
}

/** Run several INDEPENDENT metadata queries CONCURRENTLY; outputs come back in the given order.
 *  `queryList` is an array of argv arrays, e.g. [["--list-files"], ["--group","serial","--list-files"]]. */
function runTestShParallelAsync(queryList) {
  return Promise.all(queryList.map((argv) => runTestShAsync(...argv)));
}

/** Async twin of `readStable` — same bounded re-read against a transient sibling fixture, with
 *  `refresh=true` on every retry (there is no cache on the async path: every read is live). */
async function readStableAsync(read, relationship) {
  let values = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    values = await read(attempt > 0);
    if (relationship(values)) break;
  }
  return values;
}

// Ground truth is COMPUTED at runtime, never snapshotted. A hardcoded `EXPECTED_ENGINE = 58`
// goes stale the moment anyone adds a test file — B3-2 red on fan-in for exactly this reason
// (B3-1 merged a new engine test 13 min after B3-2's worktree snapshot). Per the fast-mode tick
// rule "测试不得硬编码全局计数", all assertions here are RELATIONSHIPS over the live glob:
//   product + engine + serial + lowconc == total (the deduped realpath partition),
//   and --list-files count == --list-groups total (no-args --list-files reports the FULL default
//   run = the product,engine body + the serial phase + the lowconc phase, all four groups —
//   gap-test-file-snapshot-worktree-drops-realinstall). New files change the numbers, not the
//   invariants.
function parseGroups(out) {
  const parse = (label) => {
    const m = out.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"));
    assert.ok(m, `--list-groups missing ${label}: ${out}`);
    return Number(m[1]);
  };
  return { product: parse("product"), engine: parse("engine"), serial: parse("serial"), lowconc: parse("lowconc"), total: parse("total") };
}

// Any assertion here that reads the SHARED plugin/test dir with MORE THAN ONE glob read is
// NON-ATOMIC: a sibling serial-family test (serial-anti-stomp, running concurrently at serial
// concurrency=2) briefly creates a zz-* fixture in the SHARED plugin/test dir; if it lands between
// two reads, one count shifts by exactly 1 (AC3) or the byte concatenation differs (AC6) — a
// transient-window false positive (round-310: 346 !== 345 — a transient fixture, not a partition
// break; it passes in isolation and clears on the next read). A GENUINE partition violation is
// deterministic and fails every re-read, so re-read a bounded number of times and require the
// relationship to hold stably — the retry only clears the transient-window false positive, never
// papers over a real break (same philosophy as the AC7 membership fix, gap-runner-grouping-ac7-
// nested-spawn-load-flake).
function readStable(read, relationship) {
  let values = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    // attempt 0 may serve the metadata cache (文件内去重 happy path); retries pass refresh=true so
    // the read re-queries the LIVE tree (runTestShRefresh) — preserving the transient-fixture
    // recovery the bounded re-read exists for.
    values = read(attempt > 0);
    if (relationship(values)) break;
  }
  return values;
}

export { __dirname, assert, dirname, fileURLToPath, join, metaCache, parseGroups, readStable, readStableAsync, repoRoot, runTestSh, runTestShAsync, runTestShCached, runTestShParallelAsync, runTestShRefresh, spawnSync, test, testSh };
