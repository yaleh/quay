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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("GREEN: a full valid suite: section returns all 7 typed values", () => {
  const ws = tmpWs();
  writeConfig(
    ws,
    [
      "suite:",
      "  suite_scheduler: 1",
      "  phase_overlap: 1",
      "  serial_concurrency: 4",
      "  lowconc_concurrency: 3",
      "  max_concurrent_suites: 2",
      "  max_oversubscription: 1.5",
      "  main_tail_stall_pct: 6",
      "",
    ].join("\n"),
  );
  assert.deepEqual(readSuiteParams(ws), {
    suite_scheduler: 1,
    phase_overlap: 1,
    serial_concurrency: 4,
    lowconc_concurrency: 3,
    max_concurrent_suites: 2,
    max_oversubscription: 1.5,
    main_tail_stall_pct: 6,
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

test("RED: an out-of-range stall threshold (main_tail_stall_pct: 150) throws FAIL-CLOSED", () => {
  const ws = tmpWs();
  writeConfig(ws, "suite:\n  main_tail_stall_pct: 150\n");
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

test("SUITE_KNOBS declares exactly the closed set of config→env mappings", () => {
  assert.deepEqual(SUITE_KNOBS, {
    suite_scheduler: "QUAY_SUITE_SCHEDULER",
    phase_overlap: "QUAY_PHASE_OVERLAP",
    serial_concurrency: "QUAY_SERIAL_CONCURRENCY",
    lowconc_concurrency: "QUAY_LOWCONC_CONCURRENCY",
    max_concurrent_suites: "QUAY_MAX_CONCURRENT_SUITES",
    max_oversubscription: "QUAY_MAX_OVERSUBSCRIPTION",
    main_tail_stall_pct: "QUAY_MAIN_TAIL_STALL_PCT",
    // gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc — the suite
    // cgroup's MemoryMax becomes a DECLARED knob (a size string, not a count). Its absence from the
    // shipped config is deliberate: a machine-spec-dependent literal must not live in a tracked file.
    memory_max: "QUAY_SUITE_MEMORY_MAX",
    // gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison — the
    // memory-aware SCHEDULING declaration (MEASURED per-file high-water → bounded heavy bucket).
    // Deliberately no default in code: an undeclared threshold would be a machine-spec-dependent
    // literal, and with neither knob declared the mechanism is OFF.
    heavy_threshold_mb: "QUAY_SUITE_HEAVY_THRESHOLD_MB",
    heavy_max_concurrent: "QUAY_SUITE_HEAVY_MAX_CONCURRENT",
  });
});

test("heavy knobs — a declared threshold/bound is read + promoted; a bad one is FAIL-CLOSED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-heavy-"));
  try {
    const write = (body) => fs.writeFileSync(path.join(dir, ".quay", "config.yml"), body);
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    write("provider: native\nsuite:\n  heavy_threshold_mb: 300\n  heavy_max_concurrent: 1\n");
    assert.deepEqual(
      readSuiteParams(dir),
      { heavy_threshold_mb: 300, heavy_max_concurrent: 1 },
      "both halves of the declaration are read",
    );
    assert.deepEqual(
      suiteParamsToEnv({ heavy_threshold_mb: 300, heavy_max_concurrent: 1 }),
      { QUAY_SUITE_HEAVY_THRESHOLD_MB: "300", QUAY_SUITE_HEAVY_MAX_CONCURRENT: "1" },
      "…and promote into their env vars (the host-override surface)",
    );
    // A threshold is a MiB READING and may be fractional (a measured high-water is not a round number
    // of MiB); the BOUND, by contrast, is a count and must be whole — the two validators differ on
    // purpose, so "300.5 ok / 1.5 not ok" is the pair that pins both.
    write("provider: native\nsuite:\n  heavy_threshold_mb: 300.5\n  heavy_max_concurrent: 2\n");
    assert.deepEqual(readSuiteParams(dir), { heavy_threshold_mb: 300.5, heavy_max_concurrent: 2 });
    write("provider: native\nsuite:\n  heavy_threshold_mb: 0\n");
    assert.throws(() => readSuiteParams(dir), /FAIL-CLOSED: \.quay\/config\.yml 'suite:heavy_threshold_mb'/, "0/negative is not a threshold");
    write("provider: native\nsuite:\n  heavy_max_concurrent: 0\n");
    assert.throws(() => readSuiteParams(dir), /FAIL-CLOSED: \.quay\/config\.yml 'suite:heavy_max_concurrent'/, "a bound of 0 heavy files is not a schedule");
    write("provider: native\nsuite:\n  heavy_max_concurrent: 1.5\n");
    assert.throws(() => readSuiteParams(dir), /FAIL-CLOSED: \.quay\/config\.yml 'suite:heavy_max_concurrent'/, "a fractional co-run count is not a count");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_max — a size string is the one non-numeric knob, and a malformed one is FAIL-CLOSED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-memmax-"));
  try {
    const write = (body) => fs.writeFileSync(path.join(dir, ".quay", "config.yml"), body);
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    write("provider: native\nsuite:\n  memory_max: \"16G\"\n");
    assert.deepEqual(readSuiteParams(dir), { memory_max: "16G" }, "a declared size string is read verbatim");
    assert.deepEqual(suiteParamsToEnv({ memory_max: "16G" }), { QUAY_SUITE_MEMORY_MAX: "16G" }, "…and promotes into its env var");
    write("provider: native\nsuite:\n  memory_max: 17179869184\n");
    assert.throws(() => readSuiteParams(dir), /FAIL-CLOSED: \.quay\/config\.yml 'suite:memory_max' value 17179869184 is invalid/, "a NUMBER is not a size string (⛔ no silent unit guessing)");
    write("provider: native\nsuite:\n  memory_max: \"16 gigabytes\"\n");
    assert.throws(() => readSuiteParams(dir), /FAIL-CLOSED: \.quay\/config\.yml 'suite:memory_max'/, "an unparseable size is rejected, not forwarded to systemd-run");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --shell must EXPORT — gap-suite-config-knobs-not-exported-on-direct-test-sh-path
//
// THE DEFECT: `--shell` used to print bare `VAR="${VAR:-config}"` assignments. scripts/test.sh
// evaluates that text under `set -euo pipefail` and NO `set -a`, so the values became SHELL-LOCAL:
// the eval'ing shell read `QUAY_MAX_OVERSUBSCRIPTION=0.1875` while every child the suite spawned
// read `undefined` — config read, printed, and invisible to the object under test (hard rule 3b).
// The consequence was not cosmetic: the direct `bash scripts/test.sh` path (including the scoped
// `--for-task` gate) still derived nproc lanes (128) instead of the configured 24.
//
// These two tests run the emitter through the EXACT shell mode test.sh uses and read the value from
// a CHILD process — the same vantage point as a suite's `node --test` child.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SUITE_PARAMS_TS = path.join(REPO_ROOT, "plugin", "scripts", "suite-params.ts");

/** Run `suite-params.ts --shell` through a shell configured exactly like scripts/test.sh
 *  (`set -euo pipefail`, NO `set -a`), then read a knob from a CHILD process of that shell.
 *  Returns the child's raw stdout, or the literal string "undefined" when the child cannot see it. */
function readKnobFromChild(ws, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  // Ambient knobs would mask the promotion under test — clear every one of them except the
  // deliberately-provided override (that is what the negative control supplies).
  for (const envKey of Object.values(SUITE_KNOBS)) if (!(envKey in envOverrides)) delete env[envKey];
  // The suite's per-file CPU/memory preload collects into a dir; irrelevant here and it can
  // interleave with stdout — drop it so the reading is the reading.
  delete env.NODE_OPTIONS;
  delete env.QUAY_PERFILE_CPU_DIR;
  const script = [
    "set -euo pipefail",
    'suite_cfg="$(node --no-warnings --experimental-strip-types "$SUITE_PARAMS" --shell --root "$WS")"',
    'eval "${suite_cfg}"',
    // A CHILD of the eval'ing shell — process.env only, never the shell's own view.
    `node -e 'process.stdout.write(String(process.env.QUAY_MAX_OVERSUBSCRIPTION))'`,
  ].join("\n");
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...env, SUITE_PARAMS: SUITE_PARAMS_TS, WS: ws },
  });
}

test("--shell POSITIVE control: a config-ONLY value reaches a child of the eval'ing shell", () => {
  const ws = tmpWs();
  writeConfig(ws, "provider: native\nsuite:\n  max_oversubscription: 0.1875\n");
  assert.equal(
    readKnobFromChild(ws),
    "0.1875",
    "the emitted line must be an EXPORT: a bare assignment is shell-local and the child reads `undefined`",
  );
});

test("--shell NEGATIVE control: an already-set env value still wins over the config", () => {
  const ws = tmpWs();
  writeConfig(ws, "provider: native\nsuite:\n  max_oversubscription: 0.1875\n");
  assert.equal(
    readKnobFromChild(ws, { QUAY_MAX_OVERSUBSCRIPTION: "3.5" }),
    "3.5",
    "the fix must not be an unconditional overwrite — env beats config",
  );
});

test("direct path: `bash scripts/test.sh` exports every config-declared knob to the suite's children", (t) => {
  const cfg = readSuiteParams(REPO_ROOT);
  const declared = Object.entries(SUITE_KNOBS).filter(([key]) => cfg[key] !== undefined);
  if (declared.length === 0) return t.skip("this workspace declares no suite: knobs — nothing to promote");
  // This assertion measures scripts/test.sh's promotion, and THIS process is one of its children.
  // Under a bare `node --test plugin/test/suite-params.test.mjs` there is no promotion to observe,
  // so skip rather than red. test.sh pins TZ=UTC + LANG=C.UTF-8 for every child (scripts/test.sh:312).
  if (!(process.env.TZ === "UTC" && process.env.LANG === "C.UTF-8")) {
    return t.skip("not spawned by scripts/test.sh — ambient env carries no promotion to observe");
  }
  const missing = declared
    .filter(([, envKey]) => !process.env[envKey])
    .map(([key, envKey]) => `${key} → ${envKey} (config ${JSON.stringify(cfg[key])})`);
  assert.deepEqual(
    missing,
    [],
    `suite knobs declared in .quay/config.yml must be visible to a process spawned by scripts/test.sh; unset/empty: ${missing.join(", ")}`,
  );
});
