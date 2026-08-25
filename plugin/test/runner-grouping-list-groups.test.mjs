// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn (shells out to real scripts/test.sh --group governance)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file shells
// out to the REAL scripts/test.sh including `--group governance` (the grown governance sub-suite,
// >830s isolated) — inherently heavy + fragile under full-suite concurrency (nested node --test
// spawns; the outer reruns this family isolated per the 判绿 rules).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class nested full-suite spawn) so it runs in the concurrency-1 serial phase,
// never competing with the concurrency-8 main body's worker pool. Its D-class AC7 fixture is kept
// in the shared plugin/test dir (that is what makes the undeclared→engine assertion meaningful);
// the collision with test-file-snapshot is fixed on the SNAPSHOT side (test-file-snapshot.sh
// excludes transient zz-* runtime fixtures).
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original runner-grouping.test.mjs (204s serial floor) by test concern — this file holds the
// --list-groups/--list-files RELATIONSHIP tests (the deduped partition invariants; the governance
// --list-files membership test moved to runner-grouping-governance.test.mjs so no runner-grouping
// file exceeds the 60s serial band). The nested `@load-sensitive nested-spawn` annotation is
// preserved so the family membership + serial routing stay byte-identical.
// gap-test-suite-has-no-layer-grouping — tests for the layer-grouping mechanics in
// scripts/test.sh: extended glob (AC2), realpath dedup (AC3), default groups product,engine
// with governance self-skipping (AC4/AC6), and --list-groups (AC10). These shell out to the REAL
// scripts/test.sh (the single source of truth), not a copy of its logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
  const r = spawnSync("bash", [testSh, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120000, env: cleanEnv });
  assert.equal(r.status, 0, `scripts/test.sh ${args.join(" ")} exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r.stdout;
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

// Ground truth is COMPUTED at runtime, never snapshotted. A hardcoded `EXPECTED_ENGINE = 58`
// goes stale the moment anyone adds a test file — B3-2 red on fan-in for exactly this reason
// (B3-1 merged a new engine test 13 min after B3-2's worktree snapshot). Per the fast-mode tick
// rule "测试不得硬编码全局计数", all assertions here are RELATIONSHIPS over the live glob:
//   product + engine + governance + serial + lowconc == total (the deduped realpath partition),
//   and --list-files count + serial == --list-groups total (the default --list-files EXCLUDES the
//   serial group, routed to the concurrency-1 phase —
//   gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests — and INCLUDES the
//   lowconc phase — gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive). New files change
//   the numbers, not the invariants.
function parseGroups(out) {
  const parse = (label) => {
    const m = out.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"));
    assert.ok(m, `--list-groups missing ${label}: ${out}`);
    return Number(m[1]);
  };
  return { product: parse("product"), engine: parse("engine"), governance: parse("governance"), serial: parse("serial"), lowconc: parse("lowconc"), total: parse("total") };
}

test("AC10/AC2/AC3: --list-groups reports per-group counts of the deduped glob", () => {
  const out = runTestShCached("--list-groups");
  const g = parseGroups(out);
  // Relationship, not snapshot: the FIVE groups partition the deduped realpath total (serial is
  // the load-sensitive family's group — gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests;
  // lowconc is the hermetic-but-load-sensitive concurrency-3 phase —
  // gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive).
  assert.equal(g.product + g.engine + g.governance + g.serial + g.lowconc, g.total);
  // Structural sanity independent of absolute counts.
  assert.ok(g.product > 0 && g.engine > 0 && g.governance > 0 && g.serial > 0 && g.lowconc > 0);
});

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

test("AC3: realpath dedup — --list-files count + serial equals --list-groups total (12 symlinks not double-run)", () => {
  const { files, g } = readStable(
    (refresh) => {
      // --list-groups reuses AC10's cached result (文件内去重); --list-files is the cache source
      // for AC6. On refresh (a transient-fixture retry) both re-query the live tree.
      const query = refresh ? runTestShRefresh : runTestShCached;
      const files = query("--list-files").trim().split("\n").filter(Boolean);
      const g = parseGroups(query("--list-groups"));
      // The default --list-files EXCLUDES the serial group (routed to the concurrency-1 phase) and
      // INCLUDES the lowconc phase files (routed to the concurrency-3 phase), so the dedup
      // relationship is files + serial == total.
      return { files, g };
    },
    ({ files, g }) => files.length + g.serial === g.total,
  );
  assert.equal(files.length + g.serial, g.total);
  // all paths are already realpaths (no duplicates by construction)
  assert.equal(new Set(files).size, files.length);
});

test("AC6: --group product,engine ∪ --group lowconc selects the same files as no-args", () => {
  // The default run = the product,engine body (with governance self-skip passthrough) PLUS the
  // lowconc phase (concurrency-3 hermetic-but-load-sensitive files). The governance passthrough
  // only applies to exactly `product,engine` (is_default_set), so the no-args selection is the
  // concatenation of `--group product,engine --list-files` and `--group lowconc --list-files`
  // (same build_deduped_files order). gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive.
  // THREE non-atomic glob reads here (wider exposure than AC3's two), and the assertion is
  // byte-exact concatenation equality — serial-anti-stomp landing in ANY window makes it unequal.
  // Bounded re-read until the concatenation holds stably, same as AC3 (readStable above).
  const { noArgs, body, low } = readStable(
    (refresh) => {
      // noArgs reuses AC3's cached --list-files (文件内去重); on refresh it re-queries live.
      // body/low are unique to this test (no redundant twin), so they always query fresh.
      const query = refresh ? runTestShRefresh : runTestShCached;
      const noArgs = query("--list-files");
      const body = runTestSh("--group", "product,engine", "--list-files");
      const low = runTestSh("--group", "lowconc", "--list-files");
      // body ends with a trailing newline after its last file; splice body's trailing newline and
      // append low directly so the concatenation is byte-identical to no-args.
      return { noArgs, body, low };
    },
    ({ noArgs, body, low }) => body.replace(/\n$/, "") + "\n" + low === noArgs,
  );
  assert.equal(body.replace(/\n$/, "") + "\n" + low, noArgs);
});
