// @test-group serial
// @load-sensitive nested-spawn
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
  const out = runTestSh("--list-groups");
  const g = parseGroups(out);
  // Relationship, not snapshot: the FIVE groups partition the deduped realpath total (serial is
  // the load-sensitive family's group — gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests;
  // lowconc is the hermetic-but-load-sensitive concurrency-3 phase —
  // gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive).
  assert.equal(g.product + g.engine + g.governance + g.serial + g.lowconc, g.total);
  // Structural sanity independent of absolute counts.
  assert.ok(g.product > 0 && g.engine > 0 && g.governance > 0 && g.serial > 0 && g.lowconc > 0);
});

test("AC3: realpath dedup — --list-files count + serial equals --list-groups total (12 symlinks not double-run)", () => {
  const files = runTestSh("--list-files").trim().split("\n").filter(Boolean);
  const g = parseGroups(runTestSh("--list-groups"));
  // The default --list-files EXCLUDES the serial group (routed to the concurrency-1 phase) and
  // INCLUDES the lowconc phase files (routed to the concurrency-3 phase), so the dedup
  // relationship is files + serial == total.
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
  const noArgs = runTestSh("--list-files");
  const body = runTestSh("--group", "product,engine", "--list-files");
  const low = runTestSh("--group", "lowconc", "--list-files");
  // body ends with a trailing newline after its last file; splice body's trailing newline and
  // append low directly so the concatenation is byte-identical to no-args.
  assert.equal(body.replace(/\n$/, "") + "\n" + low, noArgs);
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
  rmSync(tempFile, { force: true }); // a stale copy leaked by a file-level cancel (finally is skipped) must not skew the membership check or trip the policy checker
  try {
    writeFileSync(tempFile, 'import { test } from "node:test";\ntest("und", () => {});\n');
    // DIRECT membership, not a before/after count delta
    // (gap-runner-grouping-ac7-nested-spawn-load-flake): the OLD form took a `--list-groups`
    // snapshot before + after creating the temp file and asserted engine grew exactly +1. That
    // delta is fragile to a CONCURRENT tree mutation landing between the two snapshots — round-168
    // red: a fan-in merged a new engine test file mid-test, so engine grew +2, not +1 (the test
    // itself was fine; the delta saw someone else's addition). Membership is the real contract:
    // the undeclared temp file is CLASSIFIED engine (listed under --group engine --list-files),
    // and NOT product. A concurrent addition of an unrelated file cannot un-list it.
    const engineFiles = runTestSh("--group", "engine", "--list-files").trim().split("\n").filter(Boolean);
    assert.ok(engineFiles.includes(tempFile), `undeclared file should be classified engine (listed under --group engine --list-files): ${tempFile}\nengine files: ${engineFiles.length}`);
    const productFiles = runTestSh("--group", "product", "--list-files").trim().split("\n").filter(Boolean);
    assert.ok(!productFiles.includes(tempFile), "undeclared file must not be classified product");
  } finally {
    if (existsSync(tempFile)) rmSync(tempFile);
  }
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

// ── AC1/AC2/AC4/AC6: flags-only keeps the selected set (gap-test-sh-flags-only-...) ───────────────

// gap-test-sh-flags-only-form-silently-runs-a-different-suite: `scripts/test.sh --test-concurrency=4`
// (and the documented `--experimental-test-coverage` form) MUST run the SAME test set as the
// equivalent no-flag invocation. Before the fix, "flags + no files" fell through to
// `exec node --test ... "$@"` with an EMPTY file list → node auto-discovered ~3.7x more tests
// (8573 vs 2296, measured 2026-08-02), silently swapping the suite.
//
// SELECTION PARITY IS ASSERTED WITH --list-files LIST COMPARISON, NOT by running the governance
// sub-suite 3× (~296s — 28% of the serial segment, the single largest serial item,
// gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles AC1). `--list-files`
// prints the EXACT file list `run_selected` builds for a group (both call select_files), so a
// list-vs-list comparison proves a flags-only form selects the same set as the group default
// WITHOUT executing a single test. The behavioral pin runs through `--group governance` (the
// smallest NON-RECURSIVE group — its files never spawn test.sh, so this cannot recurse) because
// the full product,engine default is ~2296 tests / ~7min and would recurse through this very file.
//
// The branch that routes extra flags to run_selected — the actual fix for the 8573-vs-2296
// defect — is pinned STRUCTURALLY in the AC1 structural test below: it must exist, route to the
// default glob / group glob, and keep the user's flags after the default concurrency (last-flag-
// wins). AC4's "self-reported N == --list-files count" holds BY CONSTRUCTION: run_selected's
// `selected ${#files[@]} files (groups=…)` echo counts the same select_files output --list-files
// prints, and the structural test pins that echo line too. All counts are RELATIONSHIPS computed
// at runtime, never hardcoded.
test("AC1/AC2/AC6: flags-only forms run the same test count as the group default; AC4 self-report", () => {
  // The group default's selection — exactly what run_selected would execute for --group governance.
  const listed = runTestSh("--group", "governance", "--list-files").trim().split("\n").filter(Boolean);
  assert.ok(listed.length > 0, "governance group must select files");

  // AC1/AC2/AC6: the flags-only forms (a bare --test-concurrency=4, and the documented
  // --experimental-test-coverage form) must NOT change the selected set. `--list-files` builds the
  // SAME select_files output the flags-only branch's run_selected executes, so a list-vs-list
  // comparison proves selection parity WITHOUT running the governance sub-suite. List-vs-list —
  // no hardcoded count (the 2296 literal goes stale the moment a test file is added).
  const flagged = runTestSh("--group", "governance", "--list-files", "--test-concurrency=4")
    .trim().split("\n").filter(Boolean);
  const covered = runTestSh("--group", "governance", "--list-files", "--test-concurrency=8", "--experimental-test-coverage")
    .trim().split("\n").filter(Boolean);
  assert.equal(flagged.length, listed.length,
    "AC1: --test-concurrency=4 must keep the same selected-set size (before the fix it ran ~3.7x more)");
  assert.deepEqual(flagged, listed,
    "AC1: --test-concurrency=4 must select the same files as the group default");
  assert.equal(covered.length, listed.length,
    "AC2: --experimental-test-coverage must keep the same selected-set size");
  assert.deepEqual(covered, listed,
    "AC2: --experimental-test-coverage must select the same files as the group default");

  // AC4/AC6: the selected set IS the governance partition of the deduped realpath glob (the
  // --group governance --list-files count == governance partition relationship is asserted
  // directly by the "--group governance --list-files lists exactly the governance files" test),
  // and run_selected's self-report echo counts this same select_files output (structural pin in
  // the AC1 structural test) — so "self-reported N == --list-files count" holds by construction,
  // no suite run needed.
});

test("AC1 (structural): the DEFAULT-glob flags-only branch exists and routes extra flags to run_selected", () => {
  // The selection-parity pin above uses --list-files list comparison (which shares run_selected's
  // select_files), so the flags-only BRANCH itself — the actual fix for the 8573-vs-2296 defect —
  // is pinned here structurally: it must exist in the no--group (default product,engine) dispatch
  // AND in the --group dispatch, routing extra flags to run_selected (never to node with an empty
  // file list, which is what auto-discovered ~3.7x more tests before the fix). The exec line must
  // keep the default concurrency BEFORE the user's flags → node last-flag-wins honors the user's
  // --test-concurrency=N (AC3 mechanism).
  const src = readFileSync(testSh, "utf8");
  assert.match(src, /elif all_flags "\$@"; then/, "default dispatch must have a flags-only branch");
  assert.match(src, /run_selected "\$\(effective_groups\)" "\$@"/, "flags-only must route to the default glob");
  assert.match(src, /exec node --test --test-concurrency="\$\(default_test_concurrency\)" "\$@" "\$\{files\[@\]\}"/, "user flags must precede the file list (last-flag-wins); the exec line must source concurrency from default_test_concurrency — the VALUE it returns is asserted directly in resource-gate.test.mjs AC5 (this spelling pin only proves the single-source call site, not derivation)");
  // The --group dispatch has the same flags-only branch, routing to the group's glob.
  assert.match(src, /run_selected "\$groups" "\$@"/, "group flags-only must route to the group glob");
  // AC4: every GLOB-SELECTED run self-reports its selection BEFORE executing, and the count is
  // the SAME select_files output --list-files prints — "self-reported N == --list-files count"
  // holds by construction (this is what makes a changed selection impossible to hide).
  assert.match(src, /echo "selected \$\{#files\[@\]\} files \(groups=\$\{groups\}\)"/,
    "run_selected must self-report its selection count (AC4), counted from the same select_files output --list-files prints");
});

test("serial group mechanism (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests, AC1)", () => {
  // The load-sensitive family (A/B classes + KNOWN-LOAD-SENSITIVE) is routed OUT of the
  // concurrency-N main body into a `serial` group that runs alone at concurrency 1. Structural pin:
  //   - group_of recognizes serial as a REAL group (so serial files are EXCLUDED from the default
  //     product,engine selection, not silently re-defaulted to engine).
  //   - the FULL-SUITE_DEFAULT branch runs a serial phase after the main body, hard-coded to
  //     concurrency 1 (the mechanism's invariant, never a user-tunable knob).
  //   - the non-default --group serial path detects the group and forces concurrency 1, stripping
  //     any explicit --test-concurrency flag (a full-suite-runner splice must not leak lane N in).
  //   - list_groups counts serial (the 4th group in the partition).
  const src = readFileSync(testSh, "utf8");
  assert.match(src, /product\|engine\|governance\|serial\|lowconc\) echo "\$g" ;;/,
    "group_of must route serial AND lowconc as real groups (not fall back to engine)");
  assert.match(src, /local serial_files=\(\) sf serial_code/,
    "the FULL-SUITE-DEFAULT branch must declare a serial phase");
  assert.match(src, /selected \$\{#serial_files\[@\]\} files \(groups=serial\)/,
    "the serial phase must self-report its selection (AC4 self-report invariant)");
  assert.match(src, /node --test --test-concurrency=1( \$\(suite_reporter_flags\))? "\$\{serial_files\[@\]\}"/,
    "the serial phase must be HARD-CODED concurrency 1 (serial isolation is the invariant); the optional suite_reporter_flags splice is the gap-install-suite-cost-instrument-reporter-not-wired wiring");
  assert.match(src, /in_group "serial" "\$groups"/,
    "the non-default path must detect the serial group");
  assert.match(src, /printf 'serial:\s+%d\\n' "\$\{counts\[serial\]:-0\}"/,
    "list_groups must count the serial group");
  // Behavioral: --group serial --list-files returns exactly the serial members and nothing else;
  // the default --list-files EXCLUDES them (the concurrency-8 main body no longer pays their load).
  const serialList = runTestSh("--group", "serial", "--list-files").trim().split("\n").filter(Boolean);
  const g = parseGroups(runTestSh("--list-groups"));
  assert.equal(serialList.length, g.serial, "--group serial must list exactly the serial group");
  for (const f of serialList) {
    const grp = groupOfFile(f);
    assert.equal(grp, "serial", `--group serial listed ${f} but its group is ${grp}`);
  }
  const defaultFiles = runTestSh("--list-files").trim().split("\n").filter(Boolean);
  // --list-files returns realpath-deduped paths (build_deduped_files), so a direct set comparison
  // is sound — no re-realpath needed.
  const serialSet = new Set(serialList);
  for (const f of defaultFiles) {
    assert.ok(!serialSet.has(f), `default --list-files must EXCLUDE serial member ${f}`);
  }
});

test("AC0c (anti-stomp): group_of recognizes ALL FIVE groups in one case arm — a dropped group goes red, not silent", () => {
  // The r10 regression (gap-verify-round-9-failures-from-recent-changes-fix-batch): four commits
  // b209f4fd→174badc0→e92c54d8→c7176a37 each dropped one group from group_of's case, so serial/
  // lowconc silently folded into the concurrency-N engine body and the isolation guarantee was
  // cancelled WITHOUT going red. This pin fails the moment ANY of the five groups is dropped.
  const src = readFileSync(testSh, "utf8");
  assert.match(src, /product\|engine\|governance\|serial\|lowconc\) echo "\$g" ;;/,
    "group_of must recognize ALL FIVE groups (product|engine|governance|serial|lowconc) in one case arm");
  // Behavioral double-check: all five counts are non-zero, and an unknown-group declaration is
  // FAIL-CLOSED (not silently degraded to engine — AC0b).
  const g = parseGroups(runTestSh("--list-groups"));
  assert.ok(g.product > 0 && g.engine > 0 && g.governance > 0 && g.serial > 0 && g.lowconc > 0,
    "all five groups must have non-zero membership in --list-groups");
  const unknown = join(repoRoot, "plugin", "test", "zz-unknown-group-anti-stomp.test.mjs");
  rmSync(unknown, { force: true });
  try {
    writeFileSync(unknown, '// @test-group bogus\nimport { test } from "node:test";\ntest("x", () => {});\n');
    const r = spawnSync("bash", [testSh, "--list-groups"], { cwd: repoRoot, encoding: "utf8", timeout: 60000 });
    assert.notEqual(r.status, 0, `an unknown @test-group must fail closed (not silently degrade):\n${r.stdout}`);
    assert.match(r.stderr, /FAIL-CLOSED|unknown @test-group/, "the fail-closed message must name the unknown group");
  } finally {
    if (existsSync(unknown)) rmSync(unknown);
  }
});

// groupOfFile — mirror of scripts/test.sh's group_of (read a file's declared `// @test-group`).
function groupOfFile(f) {
  const m = readFileSync(f, "utf8").match(/@test-group[ \t]+([a-z]+)/);
  return m ? m[1] : "engine";
}
