// @test-group governance
// suite-speed-nested-skip.test.mjs — pins the nested-invocation setup-skip mechanism
// (gap-suite-speed-under-a-297-second-sigma). scripts/test.sh marks its own node --test
// exec boundary with QUAY_TEST_NESTED / QUAY_TEST_NESTED_ROOT (mark_nested), so a test that
// spawns scripts/test.sh inherits the marker and skips the redundant dist rebuild + whole-store
// static checks the OUTER suite already ran at its start. The behavioral wall-clock effect is
// measured by the task's before/after benchmark (SPEC AC4); this file pins the MECHANISM
// structurally so a future edit cannot silently remove the skip.
//
// R3 note (test-isolation contract): this file deliberately does NOT spawn scripts/test.sh —
// that would add a `spawns-test-sh` violation to the test-isolation SHRINK-ONLY ratchet and
// block the whole suite. It pins the mechanism by source, the same pattern as runner-grouping's
// "AC1 (structural)" test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const testSh = join(repoRoot, "scripts", "test.sh");
const src = readFileSync(testSh, "utf8");
// run_static_checks moved out of test.sh (gap-ac128-hub-split-harness-concerns)
const staticGate = join(repoRoot, "plugin", "scripts", "runner-static-gate.ts");
const staticGateSrc = readFileSync(staticGate, "utf8");

// In-file self-skip block (governance pattern, ADR-019 decision #1): in a default product,engine
// run this file reports `skipped`, not absent; with QUAY_TEST_GROUPS including governance the
// real assertions run.
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("suite-speed nested-skip (governance) skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {
  test("mark_nested() is defined and exports QUAY_TEST_NESTED + QUAY_TEST_NESTED_ROOT", () => {
    assert.match(src, /mark_nested\(\)\s*\{/, "mark_nested() function must be defined");
    assert.match(src, /export QUAY_TEST_NESTED=1/, "must export QUAY_TEST_NESTED=1");
    assert.match(src, /export QUAY_TEST_NESTED_ROOT="\$repo_root"/, "must export QUAY_TEST_NESTED_ROOT=$repo_root");
  });

  test("run_static_checks() skips when nested and same-root", () => {
    assert.match(staticGateSrc, /QUAY_TEST_NESTED_ROOT:-}" = "\$\{repo_root\}/, "same-root guard in run_static_checks");
    assert.match(staticGateSrc, /skipping static checks \(nested invocation; outer suite ran them\)/, "static-checks skip echo");
  });

  test("build_dist_once() skips when nested and same-root", () => {
    assert.match(src, /QUAY_TEST_NESTED_ROOT:-}" = "\$\{repo_root\}/, "same-root guard in build_dist_once");
    assert.match(src, /skipping dist rebuild \(nested invocation; outer suite built it\)/, "dist-build skip echo");
  });

  test("mark_nested is called before each of the 5 node --test exec sites", () => {
    // The 5 node --test sites (token-held full-suite, run_selected exec, --group explicit files,
    // --for-task, explicit files no-group) must each be preceded by a mark_nested call. Sites with
    // `set +e` between mark_nested and node --test still export before the child spawn.
    const calls = src.match(/^\s+mark_nested$/gm) || [];
    assert.equal(calls.length, 5, `expected exactly 5 mark_nested call sites, got ${calls.length}`);
  });
}
