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
import { execFileSync } from "node:child_process";

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

test("AC2/AC3 — the --buckets branch routes load-sensitive files to their own buckets (scheduler classification; legacy --classify split)", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const branch = bucketsBranchSrc(testSh);
  // The DEFAULT bucket path pipes the RAW selected list to suite-scheduler.ts with --groups all four —
  // the scheduler classifies each file (serial → serial bucket, lowconc → lowconc bucket, else main) and
  // runs each bucket at its own concurrency. No bash-side group_of split on the scheduler path.
  assert.match(
    branch,
    /printf '%s\\n' "\$\{files\[@\]\}" \| node --no-warnings --experimental-strip-types "\$\{repo_root\}\/plugin\/scripts\/suite-scheduler\.ts"/,
    "the bucket scheduler path must pipe the raw list to suite-scheduler.ts",
  );
  assert.match(branch, /--groups "product,engine,serial,lowconc"/, "the bucket scheduler must classify all four groups");
  // The RETIRED legacy bucket fallback still splits its list by @test-group — now via the TS
  // runner-grouping.ts --classify (replacing the sourced group_of) — into serial/lowconc/main sub-phases.
  assert.match(branch, /runner-grouping\.ts" --classify/, "the legacy bucket fallback must classify via the TS runner-grouping.ts --classify");
  assert.match(branch, /serial\)\s+bucket_serial_files\+=\("\$bf"\)/, "serial files route to bucket_serial_files");
  assert.match(branch, /lowconc\)\s+bucket_lowconc_files\+=\("\$bf"\)/, "lowconc files route to bucket_lowconc_files");
  assert.match(branch, /\*\)\s+bucket_main_files\+=\("\$bf"\)/, "everything else routes to bucket_main_files");
  // The legacy fallback runs each sub-phase at its own concurrency, order-preserving via
  // suite-lpt-runner.mjs run({files}).
  assert.match(
    branch,
    /node --test-concurrency="\$SERIAL_CONCURRENCY" "\$\{repo_root\}\/plugin\/scripts\/suite-lpt-runner\.mjs" "\$\{bucket_serial_files\[@\]\}"/,
    "serial sub-phase must run at SERIAL_CONCURRENCY",
  );
  assert.match(
    branch,
    /node --test-concurrency="\$LOWCONC_CONCURRENCY" "\$\{repo_root\}\/plugin\/scripts\/suite-lpt-runner\.mjs" "\$\{bucket_lowconc_files\[@\]\}"/,
    "lowconc sub-phase must run at LOWCONC_CONCURRENCY",
  );
  // Take-false: the main runner must NOT be handed the whole files[] list (that is the pre-fix
  // behavior that ran lowconc/serial under the main concurrency).
  assert.doesNotMatch(
    branch,
    /suite-lpt-runner\.mjs" "\$\{rest_args\[@\]\}" "\$\{files\[@\]\}"/,
    "suite-lpt-runner must run bucket_main_files, never the unsplit files[] list",
  );
});

/** Classify a repo-relative test file via the TS classifier (runner-grouping.ts --classify — the SAME
 *  classification suite-scheduler.ts runs over its raw list), returning the group name. This pins the
 *  ACTUAL mechanism, not a re-implemented regex — the regression AC5 guards against is "classification
 *  is referenced but undefined/empty", which silently folds every file into the main phase. */
function classifyGroup(fileRel) {
  const out = execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", path.join(REPO_ROOT, "plugin", "scripts", "runner-grouping.ts"), "--classify"],
    { input: `${path.join(REPO_ROOT, fileRel)}\n`, encoding: "utf8" },
  ).trim();
  return out.split("\t")[1];
}

test("AC5 — the TS classifier returns the correct @test-group for engine/lowconc/serial", () => {
  // engine: this very file (declared @test-group engine at the top).
  assert.equal(classifyGroup("plugin/test/suite-bucket-load-sensitive-isolation.test.mjs"), "engine");
  // lowconc: an SCD file (reclassified by this task, AC1).
  assert.equal(classifyGroup("plugin/test/session-liveness-scd-fire.test.mjs"), "lowconc");
  // serial: the real-install quay-init family.
  assert.equal(classifyGroup("plugin/test/quay-init.test.mjs"), "serial");
  // Take-false: a missing declaration must default to engine (classifyFile's AC7 default), NOT an
  // empty string — an empty group is what the Discovered Issue #1 misdiagnosed as "undefined".
  // (The fixture text must NOT contain the literal "@test-group <word>" — classification FAIL-CLOSES on
  // an unrecognized group, which is itself the guarantee AC5 pins.)
  const tmp = path.join(REPO_ROOT, "plugin", "test", "__no-group-fixture__.test.mjs");
  fs.writeFileSync(tmp, "// no grouping annotation in this fixture\n");
  try {
    assert.equal(classifyGroup("plugin/test/__no-group-fixture__.test.mjs"), "engine");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test("AC6 — the --buckets branch aggregates sub-phase exit codes into bucket_code and exits it", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const branch = bucketsBranchSrc(testSh);
  // Zero-init, then each sub-phase merges a non-zero exit code, then exit "${bucket_code}" —
  // so a green serial+lowconc+main (+ clean leak-scan) exits 0, and any non-zero phase/leak flips
  // the exit (the "suite green but non-zero exit" shape AC6 makes impossible).
  assert.match(branch, /bucket_code=0/, "must zero-init bucket_code");
  assert.match(branch, /\[\s*"\$_bscode"\s+-eq\s+0\s*\]\s*\|\|\s*bucket_code="\$_bscode"/, "serial exit merges into bucket_code");
  assert.match(branch, /\[\s*"\$_blcode"\s+-eq\s+0\s*\]\s*\|\|\s*bucket_code="\$_blcode"/, "lowconc exit merges into bucket_code");
  assert.match(branch, /\[\s*"\$_bmcode"\s+-eq\s+0\s*\]\s*\|\|\s*bucket_code="\$_bmcode"/, "main exit merges into bucket_code");
  assert.match(branch, /exit\s+"\$\{bucket_code\}"/, "the bucket branch must exit ${bucket_code}");
  // Take-false: the pre-fix single-command shape (`node ... suite-lpt-runner ...; bucket_code=$?`)
  // had no per-phase aggregation — that is the regression AC6 guards against.
  assert.doesNotMatch(branch, /suite-lpt-runner\.mjs[^\n]*\n\s*bucket_code=\$\?/, "must not regress to the unsplit single-command exit capture");
});
