// @test-group engine
// suite-params.test.mjs — fixture tests for plugin/scripts/suite-params.ts (the `.quay/config.yml`
// `suite:` section reader, gap-suite-knobs-config-file-priority).
//
// Contract: readSuiteParams(workspaceRoot) → SuiteParams | throws Error("FAIL-CLOSED: ...")
//   - no config.yml / no suite: key → {} (the section is OPTIONAL — AC4 pass/fail-neutral).
//   - a malformed suite: section (unknown key / wrong type / out-of-range) → FAIL-CLOSED (AC5).
//   - a valid suite: section → typed values, only the present keys.
//
// Run: node --test plugin/test/suite-params.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readSuiteParams, suiteParamsToEnv, SUITE_KNOBS } from "../scripts/suite-params.ts";

const _createdDirs = [];
function tmpWs() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "quay-suite-params-"));
  _createdDirs.push(ws);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  return ws;
}
after(() => {
  for (const ws of _createdDirs) fs.rmSync(ws, { recursive: true, force: true });
});

function writeConfig(ws, content) {
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), content, "utf8");
}

// ---------------------------------------------------------------------------
// GREEN — the optional section is neutral when absent
// ---------------------------------------------------------------------------

test("GREEN: no .quay/config.yml → {} (suite: section is optional)", () => {
  const ws = tmpWs(); // no config.yml written
  assert.deepEqual(readSuiteParams(ws), {});
});

test("GREEN: config.yml without a suite: key → {} (providers/loop only)", () => {
  const ws = tmpWs();
  writeConfig(ws, "providers:\n  native:\n    enabled: true\nloop:\n  board: native\n  gates: [acceptance]\n");
  assert.deepEqual(readSuiteParams(ws), {});
});

test("GREEN: a full valid suite: section returns all 6 typed values", () => {
  const ws = tmpWs();
  writeConfig(
    ws,
    [
      "suite:",
      "  phase_overlap: 1",
      "  serial_concurrency: 4",
      "  lowconc_concurrency: 3",
      "  max_concurrent_suites: 2",
      "  max_oversubscription: 1.5",
      "  main_tail_overlap_lanes: 0",
      "",
    ].join("\n"),
  );
  assert.deepEqual(readSuiteParams(ws), {
    phase_overlap: 1,
    serial_concurrency: 4,
    lowconc_concurrency: 3,
    max_concurrent_suites: 2,
    max_oversubscription: 1.5,
    main_tail_overlap_lanes: 0,
  });
});

test("GREEN: a partial suite: section returns only the present keys", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  max_oversubscription: 2\n  phase_overlap: 0\n");
  assert.deepEqual(readSuiteParams(ws), { phase_overlap: 0, max_oversubscription: 2 });
});

test("GREEN: max_oversubscription accepts a fractional positive number", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  max_oversubscription: 0.5\n");
  assert.deepEqual(readSuiteParams(ws), { max_oversubscription: 0.5 });
});

// ---------------------------------------------------------------------------
// RED — a malformed suite: section fails closed
// ---------------------------------------------------------------------------

test("RED: an unknown suite: key throws FAIL-CLOSED (closed schema)", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  phase_overlap: 1\n  bogus_knob: 3\n");
  assert.throws(
    () => readSuiteParams(ws),
    (err) => err instanceof Error && err.message.includes("FAIL-CLOSED") && err.message.includes("bogus_knob"),
  );
});

test("RED: a wrong-typed knob (string) throws FAIL-CLOSED", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  serial_concurrency: \"4\"\n");
  assert.throws(
    () => readSuiteParams(ws),
    (err) => err instanceof Error && err.message.includes("FAIL-CLOSED") && err.message.includes("serial_concurrency"),
  );
});

test("RED: an out-of-range knob (max_concurrent_suites: 0) throws FAIL-CLOSED", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  max_concurrent_suites: 0\n");
  assert.throws(() => readSuiteParams(ws), /FAIL-CLOSED/);
});

test("RED: a negative knob (main_tail_overlap_lanes: -1) throws FAIL-CLOSED", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  main_tail_overlap_lanes: -1\n");
  assert.throws(() => readSuiteParams(ws), /FAIL-CLOSED/);
});

test("RED: phase_overlap: 2 throws FAIL-CLOSED (must be 0 or 1)", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  phase_overlap: 2\n");
  assert.throws(() => readSuiteParams(ws), /FAIL-CLOSED/);
});

test("RED: a non-mapping suite: section (array) throws FAIL-CLOSED", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  - phase_overlap\n");
  assert.throws(() => readSuiteParams(ws), /FAIL-CLOSED/);
});

test("RED: malformed YAML in config.yml throws FAIL-CLOSED", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  phase_overlap: [unclosed\n");
  assert.throws(() => readSuiteParams(ws), /FAIL-CLOSED/);
});

// ---------------------------------------------------------------------------
// suiteParamsToEnv — the promotion map
// ---------------------------------------------------------------------------

test("suiteParamsToEnv maps present knobs to their env vars (absent → omitted)", () => {
  assert.deepEqual(
    suiteParamsToEnv({ phase_overlap: 1, max_oversubscription: 1.5 }),
    { QUAY_PHASE_OVERLAP: "1", QUAY_MAX_OVERSUBSCRIPTION: "1.5" },
  );
});

test("SUITE_KNOBS declares exactly the 6 config→env mappings from the Proposal", () => {
  assert.deepEqual(SUITE_KNOBS, {
    phase_overlap: "QUAY_PHASE_OVERLAP",
    serial_concurrency: "QUAY_SERIAL_CONCURRENCY",
    lowconc_concurrency: "QUAY_LOWCONC_CONCURRENCY",
    max_concurrent_suites: "QUAY_MAX_CONCURRENT_SUITES",
    max_oversubscription: "QUAY_MAX_OVERSUBSCRIPTION",
    main_tail_overlap_lanes: "QUERY_MAIN_TAIL_OVERLAP",
  });
});
