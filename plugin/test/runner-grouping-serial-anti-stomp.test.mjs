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
// RESTORE NOTE (gap-suite-serial-lowconc-classification-recheck direction-b revert): the 33-file
// serial/lowconc→engine move (0af893f8) briefly placed this file in engine, exposing its AC0c
// zz-unknown-group-anti-stomp transient fixture to the engine-phase tree sweepers
// test-framework-policy-check ("real repo" AC5) and test-coverage-check (AC5 canonical==--list-files):
// round-572 435!==436, round-573 "NEW test file ... no VALID @test-group" — the fixture-vs-sweeper
// cross-file race the AC1 165-run measurement could NOT see (individual runs have no concurrency).
// Restored to serial so the fixture window stays in the pre-main serial phase, never overlapping
// the main body.
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original runner-grouping.test.mjs (204s serial floor) by test concern — this file holds the
// group-CLASSIFICATION EDGE-CASE tests: the undeclared→engine fixture (AC7), the serial group
// mechanism, and the AC0c anti-stomp guard (group_of must recognize all five groups). The two
// zz-* glob fixtures (AC7 + AC0c) are kept in THIS file so their transient-glob windows never
// compound across sibling split files. The nested `@load-sensitive nested-spawn` annotation is
// preserved so the family membership + serial routing stay byte-identical.
// gap-test-suite-has-no-layer-grouping — tests for the layer-grouping mechanics in
// scripts/test.sh: undeclared→engine (AC7), the serial group mechanism
// (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests AC1), and the AC0c
// anti-stomp guard. These shell out to the REAL scripts/test.sh (the single source of truth),
// not a copy of its logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const testSh = join(repoRoot, "scripts", "test.sh");
// gap-suite-hub-file-responsibility-strip: group_of / list_groups moved from scripts/test.sh into this
// sourced library — the structural pins that assert those BODIES read the new file; the serial-phase
// call-site pins stay on scripts/test.sh.
const runnerGrouping = join(repoRoot, "plugin", "scripts", "runner-grouping.ts");

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

// 文件内去重 (gap-runner-grouping-dedupe-metadata-query): the successful `--list-groups` metadata
// query is issued twice in this file (serial mechanism test + AC0c); each re-spawn of
// scripts/test.sh costs ~20-35s. node --test runs each test FILE in its own process, so this
// module-level memo is strictly per-file — zero cross-process state risk. Only
// PARAMETER-IDENTICAL calls share a result (the AC0c FAIL-CLOSED `--list-groups` at line ~155
// expects a non-zero exit and stays a raw spawnSync, never cached).
const metaCache = new Map();
function runTestShCached(...args) {
  const key = JSON.stringify(args);
  if (!metaCache.has(key)) metaCache.set(key, runTestSh(...args));
  return metaCache.get(key);
}

// Ground truth is COMPUTED at runtime, never snapshotted (same invariant as the sibling
// runner-grouping-list-groups.test.mjs — see its header for the relationship rationale).
function parseGroups(out) {
  const parse = (label) => {
    const m = out.match(new RegExp(`^${label}:\\s+(\\d+)`, "m"));
    assert.ok(m, `--list-groups missing ${label}: ${out}`);
    return Number(m[1]);
  };
  return { product: parse("product"), engine: parse("engine"), serial: parse("serial"), lowconc: parse("lowconc"), total: parse("total") };
}

// groupOfFile — mirror of scripts/test.sh's group_of (read a file's declared `// @test-group`).
function groupOfFile(f) {
  const m = readFileSync(f, "utf8").match(/@test-group[ \t]+([a-z]+)/);
  return m ? m[1] : "engine";
}

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

test("serial group mechanism (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests, AC1)", () => {
  // The load-sensitive family (A/B classes + KNOWN-LOAD-SENSITIVE) is routed OUT of the
  // concurrency-N main body into a `serial` group that runs alone at the serial concurrency.
  // Structural pin:
  //   - group_of recognizes serial as a REAL group (so serial files are EXCLUDED from the default
  //     product,engine selection, not silently re-defaulted to engine).
  //   - the FULL-SUITE_DEFAULT branch runs a serial phase BEFORE the main body (phase-order
  //     reorder, gap-phase-order-serial-lowconc-before-main: serial/lowconc run first so a
  //     serial/lowconc failure is judged red before the whole main phase's cost is paid),
  //     at --test-concurrency="$SERIAL_CONCURRENCY" (default 1 = the isolation invariant; the
  //     env override is the measure-first knob of gap-load-sensitive-serial-phase-unbounded-growth-
  //     measure-first AC2/AC3 — the default is bumped only after the experiment proves 0-cancelled).
  //   - the non-default --group serial path detects the group and forces the same SERIAL_CONCURRENCY,
  //     stripping any explicit --test-concurrency flag (a full-suite-runner splice must not leak
  //     lane N in).
  //   - list_groups counts serial (the 4th group in the partition).
  const src = readFileSync(testSh, "utf8");
  const grouping = readFileSync(runnerGrouping, "utf8");
  assert.match(grouping, /RECOGNIZED_GROUPS: readonly DeclaredGroup\[\] = \["product", "engine", "serial", "lowconc"\]/,
    "classification must route serial AND lowconc as real groups (not fall back to engine)");
  assert.match(src, /local serial_files=\(\) sf serial_code/,
    "the FULL-SUITE-DEFAULT branch must declare a serial phase");
  assert.match(src, /selected \$\{#serial_files\[@\]\} files \(groups=serial\)/,
    "the serial phase must self-report its selection (AC4 self-report invariant)");
  assert.match(src, /node --test-concurrency="\$SERIAL_CONCURRENCY" "\$\{repo_root\}\/plugin\/scripts\/suite-lpt-runner\.mjs" "\$\{serial_files\[@\]\}"/,
    "the serial phase must use the env-driven SERIAL_CONCURRENCY (default 1 = isolation invariant) via the order-preserving suite-lpt-runner.mjs run({files}) (gap-suite-lpt-serial-lowconc-phases-not-lpt-ordered)");
  assert.match(src, /SERIAL_CONCURRENCY="\$\{QUAY_SERIAL_CONCURRENCY:-\$\(serial_lowconc_host_default\)\}"/,
    "the serial concurrency must default to the HOST derivation (H÷S — the AC2 experiment raised 1→2, AC44 read the host, AC74 wired the same derivation into the DIRECT path; gap-ac74-serial-lowconc-literal-direct-path)");
  assert.match(src, /in_group "serial" "\$groups"/,
    "the non-default path must detect the serial group");
  assert.match(grouping, /for \(const g of RECOGNIZED_GROUPS\) counts\.set\(g, 0\)/,
    "listGroups must initialize every recognized group (incl. serial) so it is always counted");
  // Behavioral: --group serial --list-files returns exactly the serial members and nothing else;
  // the default --list-files EXCLUDES them (the concurrency-8 main body no longer pays their load).
  const serialList = runTestSh("--group", "serial", "--list-files").trim().split("\n").filter(Boolean);
  const g = parseGroups(runTestShCached("--list-groups"));
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

test("AC0c (anti-stomp): group_of recognizes ALL FOUR groups in one case arm — a dropped group goes red, not silent", () => {
  // The r10 regression (gap-verify-round-9-failures-from-recent-changes-fix-batch): four commits
  // b209f4fd→174badc0→e92c54d8→c7176a37 each dropped one group from group_of's case, so serial/
  // lowconc silently folded into the concurrency-N engine body and the isolation guarantee was
  // cancelled WITHOUT going red. This pin fails the moment ANY of the four groups is dropped.
  const grouping = readFileSync(runnerGrouping, "utf8");
  assert.match(grouping, /RECOGNIZED_GROUPS: readonly DeclaredGroup\[\] = \["product", "engine", "serial", "lowconc"\]/,
    "classification must recognize ALL FOUR groups (product|engine|serial|lowconc) in one place");
  // Behavioral double-check: all four counts are non-zero, and an unknown-group declaration is
  // FAIL-CLOSED (not silently degraded to engine — AC0b).
  const g = parseGroups(runTestShCached("--list-groups"));
  assert.ok(g.product > 0 && g.engine > 0 && g.serial > 0 && g.lowconc > 0,
    "all four groups must have non-zero membership in --list-groups");
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
