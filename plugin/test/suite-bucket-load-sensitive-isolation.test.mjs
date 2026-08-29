// @test-group engine
// suite-bucket-load-sensitive-isolation.test.mjs — RED/GREEN structural pins for the --buckets
// path's load-sensitive isolation (tasks/gap-scd-load-sensitive-bucket-isolation, AC1-AC3).
//
// Defect: the SCD family (plugin/test/session-liveness-scd-*.test.mjs, 8 files) is
// KNOWN-LOAD-SENSITIVE (wall-clock tmux probe + session-liveness.sh per-round waits) but was tagged
// `@test-group engine` (the main concurrency-N phase). Worse, the --buckets path
// (`scripts/test.sh --buckets <task>`) handed its WHOLE selected list to suite-lpt-runner.mjs at
// bucket_test_concurrency WITHOUT any @test-group phase split, so lowconc/serial files ran under the
// full concurrent load and flaked/hung (sweep fan-in red on scd-fire AC1; retire-inner-session suite
// hung 15min).
//
// Fix: (1) re-tag the 8 SCD files engine → lowconc; (2) split the --buckets list by @test-group into
// serial (SERIAL_CONCURRENCY) / lowconc (LOWCONC_CONCURRENCY) / main (bucket_test_concurrency)
// sub-phases, mirroring the full-suite default path's phase isolation.
//
// This is a STRUCTURAL pin over scripts/test.sh (same technique as test-phases-order.test.mjs and
// suite-lpt-order.test.mjs): the bucket branch's source must contain the split loop + three
// sub-phase invocations at their OWN concurrency knobs, and the main sub-phase must run
// bucket_main_files (NOT the whole files[] list). Removing or rewiring any one of these flips the
// pin red — the exact regression AC3 guards against.
//
// Run: scripts/test.sh plugin/test/suite-bucket-load-sensitive-isolation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Slice the `--buckets` elif branch out of scripts/test.sh (bounded by the next `elif`). */
function bucketsBranchSrc(testSh) {
  const lines = testSh.split("\n");
  const start = lines.findIndex((l) => l.includes('= "--buckets" ]'));
  assert.ok(start !== -1, "scripts/test.sh must contain the --buckets branch");
  const end = lines.findIndex((l, i) => i > start && /^elif\b/.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

/** The 8 SCD test files, in sorted basename order (the canonical-glob family). */
function scdFiles() {
  const dir = path.join(REPO_ROOT, "plugin", "test");
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("session-liveness-scd-") && f.endsWith(".test.mjs"))
    .sort();
}

test("AC1 — all 8 session-liveness-scd-*.test.mjs files declare @test-group lowconc (none engine)", () => {
  const files = scdFiles();
  assert.equal(files.length, 8, `expected exactly 8 SCD files, got ${files.length}: ${files.join(", ")}`);
  const byGroup = new Map();
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "test", f), "utf8");
    const m = src.match(/@test-group\s+([a-z]+)/);
    const g = m ? m[1] : "engine";
    byGroup.set(f, g);
  }
  for (const [f, g] of byGroup) {
    assert.equal(g, "lowconc", `${f} must be @test-group lowconc (got ${g})`);
  }
  assert.equal(
    [...byGroup.values()].filter((g) => g === "engine").length,
    0,
    "no SCD file may remain @test-group engine (the main concurrency phase)",
  );
});

test("AC2/AC3 — the --buckets branch splits its list by @test-group into serial/lowconc/main sub-phases", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const branch = bucketsBranchSrc(testSh);
  // The split loop classifies each selected file via group_of into three arrays.
  assert.match(branch, /for bf in "\$\{files\[@\]\}"/, "must iterate the selected bucket files");
  assert.match(branch, /case "\$\(group_of "\$bf"\)"/, "must classify each file via group_of");
  assert.match(branch, /serial\)\s+bucket_serial_files\+=\("\$bf"\)/, "serial files route to bucket_serial_files");
  assert.match(branch, /lowconc\)\s+bucket_lowconc_files\+=\("\$bf"\)/, "lowconc files route to bucket_lowconc_files");
  assert.match(branch, /\*\)\s+bucket_main_files\+=\("\$bf"\)/, "everything else routes to bucket_main_files");
  // Serial sub-phase at its own concurrency knob.
  assert.match(
    branch,
    /node --test --test-concurrency="\$SERIAL_CONCURRENCY" \$\(suite_reporter_flags\) "\$\{bucket_serial_files\[@\]\}"/,
    "serial sub-phase must run at SERIAL_CONCURRENCY",
  );
  // Lowconc sub-phase at its own concurrency knob (≤3, not the main body's concurrency).
  assert.match(
    branch,
    /node --test --test-concurrency="\$LOWCONC_CONCURRENCY" \$\(suite_reporter_flags\) "\$\{bucket_lowconc_files\[@\]\}"/,
    "lowconc sub-phase must run at LOWCONC_CONCURRENCY",
  );
  // Main sub-phase = suite-lpt-runner.mjs over bucket_main_files at bucket_test_concurrency.
  assert.match(
    branch,
    /node --test-concurrency="\$\(bucket_test_concurrency "\$\{rest_args\[@\]\}"\)" "\$\{repo_root\}\/plugin\/scripts\/suite-lpt-runner\.mjs" "\$\{rest_args\[@\]\}" "\$\{bucket_main_files\[@\]\}"/,
    "main sub-phase must run suite-lpt-runner.mjs over bucket_main_files at bucket_test_concurrency",
  );
  // Take-false: the main runner must NOT be handed the whole files[] list (that is the pre-fix
  // behavior that ran lowconc/serial under the main concurrency).
  assert.doesNotMatch(
    branch,
    /suite-lpt-runner\.mjs" "\$\{rest_args\[@\]\}" "\$\{files\[@\]\}"/,
    "suite-lpt-runner must run bucket_main_files, never the unsplit files[] list",
  );
});
