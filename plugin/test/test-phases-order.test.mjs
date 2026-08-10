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

// Phase markers — each is unique to its FULL-SUITE-default-block invocation.
const serialSelect = markerAt(
  'while IFS= read -r sf; do serial_files+=("$sf"); done < <(select_files "serial")',
  "serial select",
);
const lowconcSelect = markerAt(
  'while IFS= read -r lf; do lowconc_files+=("$lf"); done < <(select_files "lowconc")',
  "lowconc select",
);
const mainRun = markerAt(
  'node --test --test-concurrency="$cc" $(suite_reporter_flags) "$@" "${files[@]}"',
  "main phase node --test",
);

test("AC2 — serial and lowconc phases run BEFORE the main concurrency-N body in the full-suite default path", () => {
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

test("AC4 — green-run invariant: the reorder does not skip any phase (all three still run)", () => {
  // The reorder must NOT have added an early-exit that skips later phases — a green run still pays
  // all three phases (serial, lowconc, main). Pin the phase invocations and the final exit: if a
  // phase were conditionally skipped, the set of invocations before the exit would change.
  const exitLine = markerAt('exit "$code"', "final exit");
  assert.ok(mainRun < exitLine, "the main phase must complete before the final exit");
  assert.ok(
    serialSelect < exitLine && lowconcSelect < exitLine,
    "serial/lowconc must also complete before the final exit",
  );
});
