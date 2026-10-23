// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn (shells out to real scripts/test.sh --group lowconc)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file shells
// out to the REAL scripts/test.sh including `--group lowconc` (the grown lowconc sub-suite,
// >830s isolated) — inherently heavy + fragile under full-suite concurrency (nested node --test
// spawns; the outer reruns this family isolated per the 判绿 rules).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class nested full-suite spawn) so it runs in the concurrency-1 serial phase,
// never competing with the concurrency-8 main body's worker pool.
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original runner-grouping.test.mjs (204s serial floor) by test concern — this file holds the
// flags-only selection-parity tests (gap-test-sh-flags-only-form-silently-runs-a-different-suite)
// + the product fixture RUN sanity. The nested `@load-sensitive nested-spawn` annotation is
// preserved so the family membership + serial routing stay byte-identical.
// ── AC1/AC2/AC4/AC6: flags-only keeps the selected set (gap-test-sh-flags-only-...) ───────────────

// gap-test-sh-flags-only-form-silently-runs-a-different-suite: `scripts/test.sh --test-concurrency=4`
// (and the documented `--experimental-test-coverage` form) MUST run the SAME test set as the
// equivalent no-flag invocation. Before the fix, "flags + no files" fell through to
// `exec node --test ... "$@"` with an EMPTY file list → node auto-discovered ~3.7x more tests
// (8573 vs 2296, measured 2026-08-02), silently swapping the suite.
//
// SELECTION PARITY IS ASSERTED WITH --list-files LIST COMPARISON, NOT by running the lowconc
// sub-suite 3× (~296s — 28% of the serial segment, the single largest serial item,
// gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles AC1). `--list-files`
// prints the EXACT file list `run_selected` builds for a group (both call select_files), so a
// list-vs-list comparison proves a flags-only form selects the same set as the group default
// WITHOUT executing a single test. The behavioral pin runs through `--group lowconc` (the
// smallest NON-RECURSIVE group — its files never spawn test.sh, so this cannot recurse) because
// the full product,engine default is ~2296 tests / ~7min and would recurse through this very file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { touchesHub } from "../scripts/suite-bucket-hub-list.ts";
import { extractTouchesSection, parseTouchEntries } from "../scripts/touches-parser.ts";
import { defaultTestConcurrency } from "../scripts/runner-concurrency.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const testSh = join(repoRoot, "scripts", "test.sh");
const prodFixture = join(__dirname, "runner-fixtures", "prod.test.mjs");

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

test("--group product runs a product fixture; product has no skip block", () => {
  const out = runTestSh("--group", "product", prodFixture);
  assert.match(out, /REAL PROD TEST RAN/);
});

test("AC1/AC2/AC6: flags-only forms run the same test count as the group default; AC4 self-report", () => {
  // The group default's selection — exactly what run_selected would execute for --group lowconc.
  const listed = runTestSh("--group", "lowconc", "--list-files").trim().split("\n").filter(Boolean);
  assert.ok(listed.length > 0, "lowconc group must select files");

  // AC1/AC2/AC6: the flags-only forms (a bare --test-concurrency=4, and the documented
  // --experimental-test-coverage form) must NOT change the selected set. `--list-files` builds the
  // SAME select_files output the flags-only branch's run_selected executes, so a list-vs-list
  // comparison proves selection parity WITHOUT running the lowconc sub-suite. List-vs-list —
  // no hardcoded count (the 2296 literal goes stale the moment a test file is added).
  const flagged = runTestSh("--group", "lowconc", "--list-files", "--test-concurrency=4")
    .trim().split("\n").filter(Boolean);
  const covered = runTestSh("--group", "lowconc", "--list-files", "--test-concurrency=8", "--experimental-test-coverage")
    .trim().split("\n").filter(Boolean);
  assert.equal(flagged.length, listed.length,
    "AC1: --test-concurrency=4 must keep the same selected-set size (before the fix it ran ~3.7x more)");
  assert.deepEqual(flagged, listed,
    "AC1: --test-concurrency=4 must select the same files as the group default");
  assert.equal(covered.length, listed.length,
    "AC2: --experimental-test-coverage must keep the same selected-set size");
  assert.deepEqual(covered, listed,
    "AC2: --experimental-test-coverage must select the same files as the group default");

  // AC4/AC6: the selected set IS the lowconc partition of the deduped realpath glob (the
  // --group lowconc --list-files count == lowconc partition relationship is asserted
  // directly by the "--group lowconc --list-files lists exactly the lowconc files" test),
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

// ── gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency AC5 ─────────────────────
// AC16 in full-suite-runner-phases.test.mjs pins a PROXY: the runner splices --test-concurrency=N
// into the spawned argv. The defect this task fixes sat DOWNSTREAM of that assertion — the runner
// spliced N correctly and test.sh's bucket-full fallback then DROPPED the flag, so the recovery
// ladder's rungs (64/48/32) all ran at the nproc-derived default (`scheduler: … main≤127/128`) and
// OOM'd identically while reading as declared step-downs (硬规则 4b: a proxy量 that stopped
// reflecting the actual).
//
// This assertion reads the DIRECT quantity: the `scheduler:` header the REAL test.sh hands the
// scheduler, via QUAY_TEST_PLAN_ONLY=1 (test.sh prints the header and exits before the
// lock/gate/build/static phases; the header comes from the SAME `bucket_test_concurrency` expression
// the real invocation uses, so it cannot drift from what the scheduler receives).
//
// HOME: this file is one of the four already-baselined spawners of the real scripts/test.sh
// (plugin/test-isolation-violations.txt R3 `spawns-test-sh` — a SHRINK-ONLY ratchet). A dedicated new
// test file that spawns test.sh would be a NEW violation the ratchet correctly refuses, so the
// downstream assertion lives with the existing argv→behavior family instead.
//
// The hub task is DERIVED from the store (sorted scan + touchesHub), never hard-coded: a live task id
// leaves the store, and a hard-coded one would silently stop probing the branch.
test("bucket-full fallback: --test-concurrency reaches the SCHEDULER (scheduler: main≤N), not just argv", () => {
  const taskDir = join(repoRoot, "tasks");
  const hubTask = readdirSync(taskDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .find((f) => {
      const { section } = extractTouchesSection(readFileSync(join(taskDir, f), "utf8"));
      const entries = parseTouchEntries(section);
      return entries.length > 0 && touchesHub(entries);
    });
  assert.ok(
    hubTask,
    "the task store must contain at least one task whose ## Touches hit a hub file (scripts/test.sh, full-suite-runner.ts, …) — the hub/FAIL-OPEN fallback is otherwise untestable",
  );
  const taskId = hubTask.replace(/\.md$/, "");

  // The probe N must differ from the host-derived default, otherwise "the flag was forwarded" and
  // "the default happened to equal N" are indistinguishable (硬规则 4c: the predicate must be able to
  // take false — dry-run it against a known-different value first).
  const derivedDefault = defaultTestConcurrency();
  const probeN = derivedDefault === 7 ? 9 : 7;

  const env = { ...process.env, QUAY_TEST_PLAN_ONLY: "1", QUAY_TEST_SKIP_QUAY_REFRESH: "1", QUAY_TEST_SKIP_RESOURCE_GATE: "1" };
  for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
  const r = spawnSync("bash", [testSh, "--buckets", taskId, `--test-concurrency=${probeN}`], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
  assert.equal(r.status, 0, `plan-only probe must exit 0; got ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(
    r.stdout,
    /__BUCKETS__ .*full=1/,
    `the derived task must exercise the hub/FAIL-OPEN full-suite fallback (the branch that dropped the flag); task=${taskId}, output:\n${r.stdout}`,
  );
  const mains = [...r.stdout.matchAll(/scheduler: .*main≤(\d+)\)/g)].map((m) => Number(m[1]));
  assert.ok(mains.length > 0, `the run must print a scheduler: header; output:\n${r.stdout}`);
  assert.ok(
    mains.includes(probeN),
    `test.sh's bucket fallback must hand --test-concurrency=${probeN} to the scheduler (host default is ${derivedDefault}); got main≤${mains.join(" / ")} — the flag was dropped between argv and the scheduler:\n${r.stdout}`,
  );
});
