// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn (shells out to real scripts/test.sh --group governance)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file shells
// out to the REAL scripts/test.sh including `--group governance` (the grown governance sub-suite,
// >830s isolated) — inherently heavy + fragile under full-suite concurrency (nested node --test
// spawns; the outer reruns this family isolated per the 判绿 rules).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class nested full-suite spawn) so it runs in the concurrency-1 serial phase,
// never competing with the concurrency-8 main body's worker pool.
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original runner-grouping.test.mjs (204s serial floor) by test concern — this file holds the
// GOVERNANCE-SURFACE tests: the AC8 product-mode self-skip of the governance fixture (one
// --group product fixture execution) + the --group governance --list-files membership listing.
// The nested `@load-sensitive nested-spawn` annotation is preserved so the family membership +
// serial routing stay byte-identical.
// gap-test-suite-has-no-layer-grouping — the governance SELECTION/SKIP tests: --group product
// self-skips the governance fixture's real tests (AC8, the in-file skip block), and --group
// governance --list-files lists exactly the governance files. These shell out to the REAL
// scripts/test.sh (the single source of truth), not a copy of its logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const testSh = join(repoRoot, "scripts", "test.sh");
const fixture = join(__dirname, "runner-fixtures", "gov.test.mjs");

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

// Ground truth is COMPUTED at runtime, never snapshotted (same invariant as the sibling
// runner-grouping-list-groups.test.mjs — see its header for the relationship rationale).
function parseGroups(out) {
  const parse = (label) => {
    const m = out.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"));
    assert.ok(m, `--list-groups missing ${label}: ${out}`);
    return Number(m[1]);
  };
  return { product: parse("product"), engine: parse("engine"), governance: parse("governance"), serial: parse("serial"), lowconc: parse("lowconc"), total: parse("total") };
}

test("AC8: --group product self-skips a governance fixture's real tests (the in-file skip block)", () => {
  // product mode: in-file skip fires (visible as skipped, real test absent)
  const skipOut = runTestSh("--group", "product", fixture);
  assert.match(skipOut, /governance group skipped/);
  assert.doesNotMatch(skipOut, /REAL GOV TEST RAN/);
});

test("--group governance --list-files lists exactly the governance files", () => {
  const out = runTestSh("--group", "governance", "--list-files").trim().split("\n").filter(Boolean);
  const g = parseGroups(runTestSh("--list-groups"));
  // Relationship: --group governance's file list has exactly governance's count.
  assert.equal(out.length, g.governance);
  // Every governance file is a test file under one of the governance roots. The path is a live
  // membership, not a contract: inventory (2026-08-03) added the first governance test outside
  // experiments/ (plugin/test/runtime-usage-inventory.test.mjs), and message-bus-identity.test.mjs
  // (2026-08-06) declared governance under packages/quay/test/. Allowed roots:
  //   experiments/quay-perpetual-stream/test/  (historic home of governance)
  //   plugin/test/                             (governance tests may live next to plugin tests)
  //   packages/quay/test/                      (a governance-declared product-tree test)
  for (const f of out) assert.match(f, /(experiments\/quay-perpetual-stream\/test\/|plugin\/test\/|packages\/quay\/test\/)/);
});
