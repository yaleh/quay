// @test-group engine
// gap-test-suite-has-no-layer-grouping — tests for the layer-grouping mechanics in
// scripts/test.sh: extended glob (AC2), realpath dedup (AC3), default groups product,engine
// with governance self-skipping (AC4/AC6), --group (AC5), undeclared→engine (AC7), and
// --list-groups (AC10). These shell out to the REAL scripts/test.sh (the single source of
// truth), not a copy of its logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const testSh = join(repoRoot, "scripts", "test.sh");
const fixture = join(__dirname, "runner-fixtures", "gov.test.mjs");
const prodFixture = join(__dirname, "runner-fixtures", "prod.test.mjs");
const nodeclFixture = join(__dirname, "runner-fixtures", "nodecl.test.mjs");

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

// Ground truth is COMPUTED at runtime, never snapshotted. A hardcoded `EXPECTED_ENGINE = 58`
// goes stale the moment anyone adds a test file — B3-2 red on fan-in for exactly this reason
// (B3-1 merged a new engine test 13 min after B3-2's worktree snapshot). Per the fast-mode tick
// rule "测试不得硬编码全局计数", all assertions here are RELATIONSHIPS over the live glob:
//   product + engine + governance == total (the deduped realpath partition), and
//   --list-files count == --list-groups total. New files change the numbers, not the invariants.
function parseGroups(out) {
  const parse = (label) => {
    const m = out.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"));
    assert.ok(m, `--list-groups missing ${label}: ${out}`);
    return Number(m[1]);
  };
  return { product: parse("product"), engine: parse("engine"), governance: parse("governance"), total: parse("total") };
}

test("AC10/AC2/AC3: --list-groups reports per-group counts of the deduped glob", () => {
  const out = runTestSh("--list-groups");
  const g = parseGroups(out);
  // Relationship, not snapshot: the three groups partition the deduped realpath total.
  assert.equal(g.product + g.engine + g.governance, g.total);
  // Structural sanity independent of absolute counts.
  assert.ok(g.product > 0 && g.engine > 0 && g.governance > 0);
});

test("AC3: realpath dedup — --list-files count equals --list-groups total (12 symlinks not double-run)", () => {
  const files = runTestSh("--list-files").trim().split("\n").filter(Boolean);
  const g = parseGroups(runTestSh("--list-groups"));
  assert.equal(files.length, g.total);
  // all paths are already realpaths (no duplicates by construction)
  assert.equal(new Set(files).size, g.total);
});

test("AC6: --group product,engine selects the same files as no-args", () => {
  const noArgs = runTestSh("--list-files");
  const withGroup = runTestSh("--group", "product,engine", "--list-files");
  assert.equal(withGroup, noArgs);
});

test("AC5/AC8: --group governance runs a governance fixture's real tests; --group product self-skips it", () => {
  // governance mode: real test runs
  const runOut = runTestSh("--group", "governance", fixture);
  assert.match(runOut, /REAL GOV TEST RAN/);
  // product mode: in-file skip fires (visible as skipped, real test absent)
  const skipOut = runTestSh("--group", "product", fixture);
  assert.match(skipOut, /governance group skipped/);
  assert.doesNotMatch(skipOut, /REAL GOV TEST RAN/);
});

test("--group product runs a product fixture; product has no skip block", () => {
  const out = runTestSh("--group", "product", prodFixture);
  assert.match(out, /REAL PROD TEST RAN/);
});

test("AC7: an undeclared file defaults to engine in --list-groups", () => {
  const tempFile = join(repoRoot, "plugin", "test", "zz-runner-grouping-undeclared.test.mjs");
  const before = parseGroups(runTestSh("--list-groups"));
  try {
    writeFileSync(tempFile, 'import { test } from "node:test";\ntest("und", () => {});\n');
    const after = parseGroups(runTestSh("--list-groups"));
    // Relationship: one undeclared file → exactly +1 engine and +1 total. No absolute count.
    assert.equal(after.engine, before.engine + 1, "undeclared file should count as engine");
    assert.equal(after.total, before.total + 1);
    assert.equal(after.product, before.product, "undeclared file must not touch product");
  } finally {
    if (existsSync(tempFile)) rmSync(tempFile);
  }
});

test("--group governance --list-files lists exactly the governance files", () => {
  const out = runTestSh("--group", "governance", "--list-files").trim().split("\n").filter(Boolean);
  const g = parseGroups(runTestSh("--list-groups"));
  // Relationship: --group governance's file list has exactly governance's count.
  assert.equal(out.length, g.governance);
  for (const f of out) assert.match(f, /experiments\/quay-perpetual-stream\/test\//);
});
