// @test-group engine
// test-phases-order.test.mjs — tasks/gap-phase-order-serial-lowconc-before-main.
//
// AC2 — the full-suite default path runs serial and lowconc phases BEFORE the main concurrency-N
// body. AC3 — a serial/lowconc failure is therefore judged red at the phase boundary, never after
// the entire main phase's cost has been paid (the 16 long-reds were all judged red exactly
// total−30s=RED_GRACE_MS because their failures lived in the LAST phases — serial/lowconc — and
// paid the whole main phase first; 2.37h pure waste).
//
// This is a STRUCTURAL pin over scripts/test.sh (same technique as runner-grouping.test.mjs): the
// phase blocks execute in TEXTUAL order inside the FULL-SUITE default branch, so the source
// positions of the three phase invocations ARE the execution order. If a future edit reorders the
// blocks (main-first again), the positions flip and this test goes red — the exact regression the
// task's AC2/AC3 guard against.
//
// gap-suite-dynamic-waterline-scheduler: the DEFAULT path is now the unified scheduler (a single
// loop that dispatches serial → lowconc → main and exits EARLY, before the legacy phased blocks).
// The phased-order pins below therefore target the RETIRED legacy fallback (QUAY_SUITE_SCHEDULER=0):
// `mainRun` is the legacy suite-lpt-runner.mjs main phase, and the order it preserves must still
// hold against the legacy path's OWN final exit (which sits AFTER the scheduler block's exit).
//
// Run: scripts/test.sh plugin/test/test-phases-order.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const testSh = join(repoRoot, "scripts", "test.sh");

const SRC = fs.readFileSync(testSh, "utf8");

// indexOf with a hard assertion — a missing marker is a REAL failure (the block was renamed/removed).
function markerAt(pattern, label) {
  const i = SRC.indexOf(pattern);
  assert.ok(i >= 0, `scripts/test.sh missing phase marker ${label}: ${pattern}`);
  return i;
}

// Phase markers — each is unique to its FULL-SUITE-default-block invocation. Since
// gap-suite-classification-lpt-scheduler-ts-ization the selection reads the deduped metadata via the TS
// runner-grouping.ts --select (the retired legacy fallback's phase selection; the DEFAULT scheduler
// classifies internally).
const serialSelect = markerAt(
  'while IFS= read -r sf; do serial_files+=("$sf"); done < <(build_deduped_files | node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/runner-grouping.ts" --select "serial")',
  "serial select",
);
const lowconcSelect = markerAt(
  'while IFS= read -r lf; do lowconc_files+=("$lf"); done < <(build_deduped_files | node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/runner-grouping.ts" --select "lowconc")',
  "lowconc select",
);
const mainRun = markerAt(
  'node --test-concurrency="$(bucket_test_concurrency "$@")" "${repo_root}/plugin/scripts/suite-lpt-runner.mjs" "$@" "${files[@]}"',
  "legacy fallback main phase node --test (suite-lpt-runner.mjs)",
);

test("AC2 — serial and lowconc phases run BEFORE the main concurrency-N body in the legacy fallback (QUAY_SUITE_SCHEDULER=0)", () => {
  // The FULL-SUITE default branch executes its blocks in textual order, so the source position of
  // each phase's invocation IS its execution order. serial/lowconc must precede the main body —
  // otherwise a serial/lowconc failure would pay the whole main phase first (the 16 long-reds all
  // judged red exactly total−30s=RED_GRACE_MS).
  assert.ok(
    serialSelect < mainRun,
    "serial phase must be selected before the main phase node --test (serial-before-main)",
  );
  assert.ok(
    lowconcSelect < mainRun,
    "lowconc phase must be selected before the main phase node --test (lowconc-before-main)",
  );
});

test("AC3 — a serial/lowconc failure is judged red before the main phase runs (early-red by construction)", () => {
  // Early detection is BY CONSTRUCTION of the reorder: the serial and lowconc node --test runs
  // appear textually before the main node --test run, so their non-zero exit is captured and
  // merged into `code` (the run's verdict) BEFORE the main body even starts. The runner's RED
  // judgement therefore lands at the phase boundary, not after the full main cost.
  assert.ok(
    serialSelect < mainRun && lowconcSelect < mainRun,
    "serial/lowconc must execute before main — otherwise their failure is invisible until after the whole main phase",
  );
});

test("AC3/AC6 — code aggregation: each phase's exit merges into the run verdict and none is dropped", () => {
  // `code` must be initialized to 0 before any phase and merged by ALL THREE phases — a phase that
  // fails to merge its exit into `code` would let a red phase escape the verdict.
  const codeInit = markerAt("local code=0", "code init");
  const serialMerge = markerAt('[ "$serial_code" -eq 0 ] || code="$serial_code"', "serial merge");
  const lowconcMerge = markerAt('[ "$lcode" -eq 0 ] || code="$lcode"', "lowconc merge");
  const mainMerge = markerAt('[ "$mcode" -eq 0 ] || code="$mcode"', "main merge");
  // Order: code init → serial merge → lowconc merge → main merge → final exit.
  assert.ok(
    codeInit < serialMerge && serialMerge < lowconcMerge && lowconcMerge < mainMerge,
    "code must be initialized first and merged by serial, lowconc, then main, in that order",
  );
  // The serial/lowconc merges must sit before the main phase's node --test (early-red), and the
  // main merge must sit after the main node --test.
  assert.ok(serialMerge < mainRun, "serial's merge must precede the main phase run");
  assert.ok(mainRun < mainMerge, "main's merge must follow the main phase run");
});

test("AC4 — green-run invariant: the scheduler (default) exits before the legacy phased path, and the legacy fallback still runs all three phases", () => {
  // The scheduler is the DEFAULT: its block must sit BEFORE the legacy main phase (main runs IN the
  // scheduler, not in the suite-lpt-runner.mjs main phase), and the legacy fallback must still run
  // all three phases (serial, lowconc, main) before ITS OWN final exit — a fallback edit that skips
  // a phase must still go red.
  const schedulerBlock = markerAt('if [ "${QUAY_SUITE_SCHEDULER:-1}" = "1" ]; then', "scheduler (default) block");
  assert.ok(schedulerBlock < mainRun, "the scheduler block (default) must precede the legacy main phase");
  const legacyExit = SRC.indexOf('exit "$code"', mainRun);
  assert.ok(legacyExit >= 0, "the legacy full-suite path must have a final exit after its main phase");
  assert.ok(mainRun < legacyExit, "the legacy main phase must complete before the legacy final exit");
  assert.ok(
    serialSelect < legacyExit && lowconcSelect < legacyExit,
    "legacy serial/lowconc must also complete before the legacy final exit",
  );
});
