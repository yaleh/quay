// @test-group engine
// gap-test-suite-has-no-layer-grouping — tests for the layer-grouping mechanics in
// scripts/test.sh: extended glob (AC2), realpath dedup (AC3), default groups product,engine
// with governance self-skipping (AC4/AC6), --group (AC5), undeclared→engine (AC7), and
// --list-groups (AC10). These shell out to the REAL scripts/test.sh (the single source of
// truth), not a copy of its logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
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

// runTestShRaw — like runTestSh but does NOT assert exit 0. The flags-only regression below
// runs `--group governance`, which currently has 3 PRE-EXISTING failures (chart2-s2-... asserts
// cov=0 but the repo's real S2 evidence is cov=1) — the count comparison is the invariant, not
// the exit code. Longer timeout: the governance sub-suite (~205 tests) + coverage takes ~15s.
function runTestShRaw(...args) {
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith("NODE_TEST_")) delete cleanEnv[k];
  }
  return spawnSync("bash", [testSh, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 300000, env: cleanEnv });
}

function parseTestCount(out) {
  // Take the LAST `ℹ tests N` — node's final reporter summary — not the first. A governance test
  // or spawned subprocess could legitimately emit an earlier `ℹ tests N` line of its own; only the
  // final summary is the outer run's total (REFUTE round-1 MINOR).
  const all = [...out.matchAll(/ℹ tests (\d+)\b/g)];
  assert.ok(all.length > 0, `reporter summary missing ℹ tests:\n${out.slice(-500)}`);
  return Number(all[all.length - 1][1]);
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

// ── AC1/AC2/AC4/AC6: flags-only keeps the selected set (gap-test-sh-flags-only-...) ───────────────

// gap-test-sh-flags-only-form-silently-runs-a-different-suite: `scripts/test.sh --test-concurrency=4`
// (and the documented `--experimental-test-coverage` form) MUST run the SAME test set as the
// equivalent no-flag invocation. Before the fix, "flags + no files" fell through to
// `exec node --test ... "$@"` with an EMPTY file list → node auto-discovered ~3.7x more tests
// (8573 vs 2296, measured 2026-08-02), silently swapping the suite.
//
// The behavioral pin runs through `--group governance` (the smallest NON-RECURSIVE group — its
// files never spawn test.sh, so this cannot recurse) because the full product,engine default is
// ~2296 tests / ~7min and would recurse through this very file. The literal default-glob before/
// after counts are recorded in the task DoD, and the structural test below pins the DEFAULT-glob
// branch's existence. All counts are RELATIONSHIPS computed at runtime, never hardcoded.
test("AC1/AC2/AC6: flags-only forms run the same test count as the group default; AC4 self-report", () => {
  const base = runTestShRaw("--group", "governance");
  const baseCount = parseTestCount(`${base.stdout}\n${base.stderr}`);
  // AC4: every run self-reports its selection before executing (this is what makes a changed
  // selection impossible to hide), and N must equal the --list-files count.
  const baseSel = base.stdout.match(/selected (\d+) files \(groups=([^)]+)\)/);
  assert.ok(baseSel, `run must self-report its selection (AC4):\n${base.stdout.slice(-300)}`);
  assert.equal(baseSel[2], "governance");
  const listed = runTestSh("--group", "governance", "--list-files").trim().split("\n").filter(Boolean).length;
  assert.equal(Number(baseSel[1]), listed, "self-reported N must equal the --list-files count (AC4)");

  // AC1/AC6: a bare --test-concurrency=4 must NOT change the selected set (it only changes
  // node's concurrency). Runtime-computed equality — no hardcoded count (the 2296 literal goes
  // stale the moment a test file is added).
  const flagged = runTestShRaw("--group", "governance", "--test-concurrency=4");
  assert.equal(
    parseTestCount(`${flagged.stdout}\n${flagged.stderr}`),
    baseCount,
    "AC1: --test-concurrency=4 must keep the same test set (before the fix it ran ~3.7x more)"
  );
  const flaggedSel = flagged.stdout.match(/selected (\d+) files \(groups=([^)]+)\)/);
  assert.ok(flaggedSel, `flags-only run must self-report its selection (AC4):\n${flagged.stdout.slice(-300)}`);
  assert.equal(Number(flaggedSel[1]), listed, "flags-only self-reported N must equal --list-files count");

  // AC2: the documented coverage form likewise keeps the same selection.
  const covered = runTestShRaw("--group", "governance", "--experimental-test-coverage");
  assert.equal(
    parseTestCount(`${covered.stdout}\n${covered.stderr}`),
    baseCount,
    "AC2: --experimental-test-coverage must keep the same test set"
  );
});

test("AC1 (structural): the DEFAULT-glob flags-only branch exists and routes extra flags to run_selected", () => {
  // The behavioral pin above exercises the branch via --group governance. This structural check
  // pins that the SAME branch also exists in the no--group (default product,engine) dispatch, and
  // that the exec line keeps the default concurrency BEFORE the user's flags → node last-flag-wins
  // honors the user's --test-concurrency=N (AC3 mechanism).
  const src = readFileSync(testSh, "utf8");
  assert.match(src, /elif all_flags "\$@"; then/, "default dispatch must have a flags-only branch");
  assert.match(src, /run_selected "\$\(effective_groups\)" "\$@"/, "flags-only must route to the default glob");
  assert.match(src, /exec node --test --test-concurrency=8 "\$@" "\$\{files\[@\]\}"/, "user flags must precede the file list (last-flag-wins)");
  // The --group dispatch has the same flags-only branch, routing to the group's glob.
  assert.match(src, /run_selected "\$groups" "\$@"/, "group flags-only must route to the group glob");
});
