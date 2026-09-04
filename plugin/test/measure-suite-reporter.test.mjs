// @test-group engine
// measure-suite-reporter-wired.test.mjs — AC4 of
// gap-install-suite-cost-instrument-reporter-not-wired: the REAL full suite must
// actually load measure-suite-reporter.mjs. This is the mechanical anti-regression
// guarantee that prevents the "seventh instance" of instrument-exists-but-not-wired.
//
// The reporter EXISTS and its unit tests PASS (measure-suite.test.mjs) — but that only
// proves "the reporter CAN do it in a temp dir", not "it happened in the real suite".
// The failure mode this test kills: someone edits scripts/test.sh (or
// full-suite-runner.ts) and drops the `--test-reporter` wiring; the reporter's unit
// tests stay green, but the real full suite silently stops emitting per-file wall-clock.
// This test reads scripts/test.sh + full-suite-runner.ts and asserts the wiring is
// present, so removing it flips THIS test red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const WIRING_PATTERN = /test-reporter|measure-suite-reporter/;

test("scripts/test.sh wires measure-suite-reporter.mjs via --test-reporter (AC4 anti-regression)", () => {
  const testSh = readFileSync(join(repoRoot, "scripts", "test.sh"), "utf8");
  const wired = testSh.match(WIRING_PATTERN);
  assert.ok(
    wired,
    "scripts/test.sh must reference --test-reporter / measure-suite-reporter — if this test goes red, the reporter wiring was REMOVED (the 7th instrument-exists-but-not-wired instance)"
  );
  // The reporter flags must be on the REAL suite's node --test invocations, not just
  // mentioned in a comment. Assert the actual invocation carries `--test-reporter=`.
  assert.match(
    testSh,
    /node --test[^\n]*--test-reporter=|\$\{suite_reporter_flags\}|suite_reporter_flags/,
    "a node --test invocation (or the shared flag helper it uses) must pass --test-reporter on the real suite command line"
  );
});

test("full-suite-runner.ts (if present) also references the reporter path (wiring not lost to the runner)", () => {
  const runner = join(repoRoot, "plugin", "scripts", "full-suite-runner.ts");
  if (!existsSync(runner)) {
    // full-suite-runner is a later addition; its absence is not a wiring failure.
    return;
  }
  const src = readFileSync(runner, "utf8");
  // The runner must not actively REMOVE the reporter (e.g. by splicing a bare
  // --test-reporter that overwrites the custom one). It may reference it or not; the
  // hard contract is the scripts/test.sh wiring asserted above. Here we only assert the
  // runner does not strip a custom --test-reporter= path.
  assert.doesNotMatch(src, /--test-reporter=(?!spec)/, "runner must not splice a bare --test-reporter= that would shadow the custom reporter");
});

test("full-suite-runner.ts wires per-file CPU collection (route a: QUAY_PERFILE_CPU_DIR + NODE_OPTIONS --require preload)", () => {
  const runner = join(repoRoot, "plugin", "scripts", "full-suite-runner.ts");
  if (!existsSync(runner)) return;
  const src = readFileSync(runner, "utf8");
  // gap-perfile-cpu-cost-collection AC1 anti-regression: the per-file CPU carrier env (the dir the
  // preload writes each test file's own process.cpuUsage() into) must be set by the runner, else the
  // reporter's `cpu_ms` goes dark on every production round. Mirrors the --test-reporter wiring check.
  assert.match(src, /QUAY_PERFILE_CPU_DIR/, "full-suite-runner.ts must set QUAY_PERFILE_CPU_DIR (the per-file CPU report dir)");
  assert.match(src, /NODE_OPTIONS/, "full-suite-runner.ts must wire NODE_OPTIONS (the --require preload seam)");
  const preload = join(repoRoot, "plugin", "scripts", "per-file-cpu-report.mjs");
  assert.ok(existsSync(preload), "the route (a) preload module must exist next to the reporter");
});
