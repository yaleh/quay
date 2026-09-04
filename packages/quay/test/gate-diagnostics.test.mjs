// @test-group product
// gate-diagnostics.test.mjs — RED/GREEN tests for per-entry required-field
// diagnostics emitted by loadWorkspaceGates() (DIR-100-B, M227).
//
// DIR-100-B: second child of the DIR-100 split. Validates that malformed gate
// entries (missing required fields) emit error-severity diagnostics to stderr
// before being skipped, rather than dropping silently.
//
// Contract under test: loadWorkspaceGates(workspaceRoot) → Record<string, GateFn>.
//   - A malformed entry emits an error diagnostic to stderr and is skipped.
//   - A well-formed entry emits NOTHING and is registered.
//   - The set of registered gates is byte-identical to the base silent-skip
//     behavior — only the skip is now loud.
//
// Run: node --test packages/quay/test/gate-diagnostics.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadWorkspaceGates } from "../src/gate/config/loader.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpWs(tag) {
  const ws = makeTmpDir(`quay-gate-diag-${tag}-`);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  return ws;
}

/**
 * Monkeypatch process.stderr.write around fn() to capture diagnostic output.
 * Returns { result: <fn return value>, stderr: <captured string> }.
 */
function captureStderr(fn) {
  const chunks = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk, encoding, cb) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof cb === "function") cb();
    return true;
  };
  try {
    const result = fn();
    return { result, stderr: chunks.join("") };
  } finally {
    process.stderr.write = orig;
  }
}

function writeConfig(ws, gatesYaml) {
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\ngates:\n${gatesYaml}`
  );
}

// ---------------------------------------------------------------------------
// AC1–AC3: it0 required-field diagnostics (name, script, argsKey)
// ---------------------------------------------------------------------------

test("AC1: it0 entry missing name emits a diagnostic naming the missing field", () => {
  const ws = tmpWs("ac1");
  writeConfig(ws, `  it0:\n    - script: "./s.sh"\n      argsKey: "k"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("it0 gate '<unnamed>' missing required field 'name'"),
    `stderr must contain name-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("AC2: it0 entry missing script emits a diagnostic (the original AC2 case)", () => {
  const ws = tmpWs("ac2");
  writeConfig(ws, `  it0:\n    - name: "g"\n      argsKey: "k"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("it0 gate 'g' missing required field 'script'"),
    `stderr must contain script-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("AC3: it0 entry missing argsKey emits a diagnostic (the previously-unwired case)", () => {
  const ws = tmpWs("ac3");
  writeConfig(ws, `  it0:\n    - name: "g"\n      script: "./s.sh"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("it0 gate 'g' missing required field 'argsKey'"),
    `stderr must contain argsKey-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

// ---------------------------------------------------------------------------
// AC4: non-it0 type required-field diagnostics
// ---------------------------------------------------------------------------

test("AC4a: testPass entry missing command emits a diagnostic", () => {
  const ws = tmpWs("ac4a");
  writeConfig(ws, `  testPass:\n    - name: "tp"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("testPass gate 'tp' missing required field 'command'"),
    `stderr must contain command-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("AC4b: fixed entry missing script emits a diagnostic", () => {
  const ws = tmpWs("ac4b");
  writeConfig(ws, `  fixed:\n    - name: "fx"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("fixed gate 'fx' missing required field 'script'"),
    `stderr must contain script-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("AC4c: coverageFloor entry missing command emits a diagnostic", () => {
  const ws = tmpWs("ac4c");
  writeConfig(ws, `  coverageFloor:\n    - name: "cf"\n      floor: 80`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("coverageFloor gate 'cf' missing required field 'command'"),
    `stderr must contain command-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("AC4d: coverageFloor entry missing floor emits a diagnostic", () => {
  const ws = tmpWs("ac4d");
  writeConfig(ws, `  coverageFloor:\n    - name: "cf"\n      command: "npm run coverage"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("coverageFloor gate 'cf' missing required field 'floor'"),
    `stderr must contain floor-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("AC4e: redGreen entry missing red emits a diagnostic", () => {
  const ws = tmpWs("ac4e");
  writeConfig(ws, `  redGreen:\n    - name: "rg"\n      green: "green.sh"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("redGreen gate 'rg' missing required field 'red'"),
    `stderr must contain red-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("AC4f: redGreen entry missing green emits a diagnostic", () => {
  const ws = tmpWs("ac4f");
  writeConfig(ws, `  redGreen:\n    - name: "rg"\n      red: "red.sh"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("redGreen gate 'rg' missing required field 'green'"),
    `stderr must contain green-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

// ---------------------------------------------------------------------------
// Proposal-driven name cases: every type whose required fields include `name`
// should emit a diagnostic when name is missing.
// ---------------------------------------------------------------------------

test("testPass entry missing name emits a diagnostic", () => {
  const ws = tmpWs("tp-no-name");
  writeConfig(ws, `  testPass:\n    - command: "./run-tests.sh"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("testPass gate '<unnamed>' missing required field 'name'"),
    `stderr must contain name-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("fixed entry missing name emits a diagnostic", () => {
  const ws = tmpWs("fx-no-name");
  writeConfig(ws, `  fixed:\n    - script: "./s.sh"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("fixed gate '<unnamed>' missing required field 'name'"),
    `stderr must contain name-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("coverageFloor entry missing name emits a diagnostic", () => {
  const ws = tmpWs("cf-no-name");
  writeConfig(ws, `  coverageFloor:\n    - command: "npm run coverage"\n      floor: 80`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("coverageFloor gate '<unnamed>' missing required field 'name'"),
    `stderr must contain name-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

test("redGreen entry missing name emits a diagnostic", () => {
  const ws = tmpWs("rg-no-name");
  writeConfig(ws, `  redGreen:\n    - red: "red.sh"\n      green: "green.sh"`);
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.ok(stderr.includes("redGreen gate '<unnamed>' missing required field 'name'"),
    `stderr must contain name-missing diagnostic, got: ${stderr}`);
  assert.equal(Object.keys(gates).length, 0, "no gates registered for malformed entry");
});

// ---------------------------------------------------------------------------
// AC5: correctly-configured entries emit zero diagnostics (no false positives)
// ---------------------------------------------------------------------------

test("AC5: correctly-configured entries emit zero diagnostics (no false positives)", () => {
  const ws = tmpWs("ac5");
  writeConfig(ws, [
    "  it0:",
    "    - name: \"ok-it0\"",
    "      script: \"./s.sh\"",
    "      argsKey: \"k\"",
    "  testPass:",
    "    - name: \"ok-tp\"",
    "      command: \"npm test\"",
    "  fixed:",
    "    - name: \"ok-fx\"",
    "      script: \"./s.sh\"",
    "  coverageFloor:",
    "    - name: \"ok-cf\"",
    "      command: \"npm run coverage\"",
    "      floor: 80",
    "  redGreen:",
    "    - name: \"ok-rg\"",
    "      red: \"red.sh\"",
    "      green: \"green.sh\"",
  ].join("\n"));
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));
  assert.equal(stderr, "", `well-formed entries must emit zero diagnostics, got: ${stderr}`);
  assert.ok(gates["ok-it0"], "well-formed it0 gate must be registered");
  assert.ok(gates["ok-tp"], "well-formed testPass gate must be registered");
  assert.ok(gates["ok-fx"], "well-formed fixed gate must be registered");
  assert.ok(gates["ok-cf"], "well-formed coverageFloor gate must be registered");
  assert.ok(gates["ok-rg"], "well-formed redGreen gate must be registered");
});

// ---------------------------------------------------------------------------
// Behavior preservation: mixed workspace (malformed + well-formed per type)
// ---------------------------------------------------------------------------

test("behavior preservation: well-formed gates registered, malformed skipped (mixed workspace)", () => {
  const ws = tmpWs("mixed");
  writeConfig(ws, [
    "  it0:",
    "    - name: \"ok-it0\"",
    "      script: \"./s.sh\"",
    "      argsKey: \"k\"",
    "    - name: \"bad-it0\"",
    "      argsKey: \"k\"",
    "  testPass:",
    "    - name: \"ok-tp\"",
    "      command: \"npm test\"",
    "    - name: \"bad-tp\"",
    "  fixed:",
    "    - name: \"ok-fx\"",
    "      script: \"./s.sh\"",
    "    - name: \"bad-fx\"",
    "  coverageFloor:",
    "    - name: \"ok-cf\"",
    "      command: \"npm run coverage\"",
    "      floor: 80",
    "    - name: \"bad-cf\"",
    "      floor: 80",
    "  redGreen:",
    "    - name: \"ok-rg\"",
    "      red: \"red.sh\"",
    "      green: \"green.sh\"",
    "    - name: \"bad-rg\"",
    "      green: \"green.sh\"",
  ].join("\n"));
  const { result: gates, stderr } = captureStderr(() => loadWorkspaceGates(ws));

  // Well-formed gates must be registered.
  assert.ok(gates["ok-it0"], "well-formed it0 gate must be registered");
  assert.ok(gates["ok-tp"], "well-formed testPass gate must be registered");
  assert.ok(gates["ok-fx"], "well-formed fixed gate must be registered");
  assert.ok(gates["ok-cf"], "well-formed coverageFloor gate must be registered");
  assert.ok(gates["ok-rg"], "well-formed redGreen gate must be registered");

  // Malformed gates must NOT be registered (skip-set unchanged — only the skip is now loud).
  assert.equal(gates["bad-it0"], undefined, "malformed it0 must be skipped");
  assert.equal(gates["bad-tp"], undefined, "malformed testPass must be skipped");
  assert.equal(gates["bad-fx"], undefined, "malformed fixed must be skipped");
  assert.equal(gates["bad-cf"], undefined, "malformed coverageFloor must be skipped");
  assert.equal(gates["bad-rg"], undefined, "malformed redGreen must be skipped");

  // Diagnostics must be emitted for each malformed entry.
  assert.ok(stderr.includes("it0 gate 'bad-it0' missing required field 'script'"),
    `stderr must contain bad-it0-script diagnostic, got: ${stderr}`);
  assert.ok(stderr.includes("testPass gate 'bad-tp' missing required field 'command'"),
    `stderr must contain bad-tp-command diagnostic, got: ${stderr}`);
  assert.ok(stderr.includes("fixed gate 'bad-fx' missing required field 'script'"),
    `stderr must contain bad-fx-script diagnostic, got: ${stderr}`);
  assert.ok(stderr.includes("coverageFloor gate 'bad-cf' missing required field 'command'"),
    `stderr must contain bad-cf-command diagnostic, got: ${stderr}`);
  assert.ok(stderr.includes("redGreen gate 'bad-rg' missing required field 'red'"),
    `stderr must contain bad-rg-red diagnostic, got: ${stderr}`);
});

// ===========================================================================
// DIR-100-C: diagnostic output channel tests
// (QUAY_GATE_DIAGNOSTICS: stderr/quiet/file + severity taxonomy + stderr routing)
// ===========================================================================

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import {
  resolveGateDiagnosticsSink,
  emitDiagnostic,
  SEVERITY_LABEL,
} from "../src/gate/config/loader.ts";

const __diagDirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__diagDirname, "..", "..", "quay-native", "bin");

function makeCliWorkspace(tag, gatesBlock) {
  const tasksDir = makeTmpDir("quay-diagc-" + tag + "-tasks-");
  const workspaceRoot = makeTmpDir("quay-diagc-" + tag + "-ws-");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  const lines = [
    "providers:",
    "  native:",
    "    enabled: true",
    "    path: \"" + nativeProviderDir.replaceAll("\\", "\\\\") + "\"",
    "    tasks_dir: \"" + tasksDir.replaceAll("\\", "\\\\") + "\"",
    "    mcp_entry: [\"node\", \"" + nativeBin.replaceAll("\\", "\\\\") + "\", \"mcp\"]",
    "    env:",
    "      QUAY_NATIVE_TASKS_DIR: \"" + tasksDir.replaceAll("\\", "\\\\") + "\"",
  ];
  if (gatesBlock) {
    lines.push("");
    lines.push("gates:");
    lines.push(...gatesBlock.split("\n").map(function(l) { return "  " + l; }));
  }
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"), lines.join("\n") + "\n");
  return { workspaceRoot: workspaceRoot, tasksDir: tasksDir };
}

function runCliQuay(args, cwd, extraEnv) {
  var env = extraEnv ? Object.assign({}, process.env, extraEnv) : process.env;
  var r = spawnSync("node", [quayBin].concat(args), { encoding: "utf8", cwd: cwd, env: env });
  return { status: r.status || 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// T1a/T4: in-process default-stderr mode + severity labels
test("C-T1a [AC1]: default stderr mode — emitDiagnostic writes [error] to process.stderr", function() {
  var chunks = [];
  var origWrite = process.stderr.write;
  process.stderr.write = function(chunk) { chunks.push(String(chunk)); return true; };
  try {
    emitDiagnostic("error", "test error message");
    emitDiagnostic("warn", "test warn message");
  } finally {
    process.stderr.write = origWrite;
  }
  var joined = chunks.join("");
  assert.ok(joined.includes("[error] test error message"), "expected [error] line; got: \"" + joined + "\"");
  assert.ok(joined.includes("[warn] test warn message"), "expected [warn] line; got: \"" + joined + "\"");
});

test("C-T4 [AC4]: severity label constants are data (grep-confirmable)", function() {
  assert.equal(SEVERITY_LABEL.error, "[error]");
  assert.equal(SEVERITY_LABEL.warn, "[warn]");
  assert.deepEqual(Object.keys(SEVERITY_LABEL).sort(), ["error", "warn"]);
});

// T1: QUAY_GATE_DIAGNOSTICS unset/empty/whitespace/stderr — all route to stderr
test("C-T1b [AC1]: QUAY_GATE_DIAGNOSTICS unset → diagnostic on stderr", function() {
  var ws = makeCliWorkspace("t1-unset", "  unknown_section:\n    - name: foo\n      command: bar");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[error]"), "expected [error] on stderr; got: \"" + r.stderr + "\"");
  assert.ok(r.stderr.includes("unrecognized gate section"), "expected unrecognized-section msg; got: \"" + r.stderr + "\"");
  assert.ok(r.stdout.includes("dod"), "expected dod in stdout");
  assert.ok(!r.stdout.includes("unknown_section"), "unexpected unknown_section in stdout");
});

test("C-T1c [AC1]: QUAY_GATE_DIAGNOSTICS=\"\" (empty) → stderr", function() {
  var ws = makeCliWorkspace("t1-empty", "  unknown_section:\n    - name: foo\n      command: bar");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot, { QUAY_GATE_DIAGNOSTICS: "" });
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[error]"), "expected [error] with empty env; got: \"" + r.stderr + "\"");
});

test("C-T1d [AC1]: QUAY_GATE_DIAGNOSTICS=\"   \" (whitespace-only) → stderr", function() {
  var ws = makeCliWorkspace("t1-ws", "  unknown_section:\n    - name: foo\n      command: bar");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot, { QUAY_GATE_DIAGNOSTICS: "   " });
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[error]"), "expected [error] with whitespace env; got: \"" + r.stderr + "\"");
});

test("C-T1e [AC1]: QUAY_GATE_DIAGNOSTICS=stderr → diagnostic on stderr", function() {
  var ws = makeCliWorkspace("t1-explicit", "  unknown_section:\n    - name: foo\n      command: bar");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot, { QUAY_GATE_DIAGNOSTICS: "stderr" });
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[error]"), "expected [error] with explicit stderr; got: \"" + r.stderr + "\"");
});

// T2: quiet suppression
test("C-T2 [AC2]: QUAY_GATE_DIAGNOSTICS=quiet suppresses all diagnostics", function() {
  var ws = makeCliWorkspace("t2-quiet", "  unknown_section:\n    - name: foo\n      command: bar");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot, { QUAY_GATE_DIAGNOSTICS: "quiet" });
  assert.equal(r.status, 0);
  assert.ok(!r.stderr.includes("[error]"), "expected NO [error] with quiet; got: \"" + r.stderr + "\"");
  assert.ok(!r.stderr.includes("[warn]"), "expected NO [warn] with quiet; got: \"" + r.stderr + "\"");
});

// T3: file output
test("C-T3a [AC3]: QUAY_GATE_DIAGNOSTICS=<tmpfile> appends diagnostics to file", function() {
  var ws = makeCliWorkspace("t3-file", "  unknown_section:\n    - name: foo\n      command: bar");
  var tmpFile = path.join(os.tmpdir(), "quay-diagc-t3-" + Date.now() + ".log");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot, { QUAY_GATE_DIAGNOSTICS: tmpFile });
  assert.equal(r.status, 0);
  assert.ok(!r.stderr.includes("[error]"), "expected NO [error] on stderr in file mode; got: \"" + r.stderr + "\"");
  assert.ok(fs.existsSync(tmpFile), "expected diagnostic file to exist");
  var content = fs.readFileSync(tmpFile, "utf8");
  assert.ok(content.includes("[error]"), "expected [error] in file; got: \"" + content + "\"");
  assert.ok(content.includes("unrecognized gate section"), "expected section name in file");
  try { fs.unlinkSync(tmpFile); } catch (e) { /* ok */ }
});

test("C-T3b [AC3]: QUAY_GATE_DIAGNOSTICS=<bad-path> → error listener fallback to stderr, exit 0", function() {
  var ws = makeCliWorkspace("t3-badpath", "  unknown_section:\n    - name: foo\n      command: bar");
  var badPath = path.join(os.tmpdir(), "quay-diagc-nonexist-" + Date.now(), "sub", "log");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot, { QUAY_GATE_DIAGNOSTICS: badPath });
  assert.equal(r.status, 0, "expected exit 0 (no crash); got " + r.status);
  assert.ok(r.stderr.includes("[error]") || r.stderr.includes("cannot write"),
    "expected error fallback diagnostic on stderr; got: \"" + r.stderr + "\"");
});

// T4b-f: severity taxonomy
test("C-T4b [AC4]: unrecognized gate section emits [error]", function() {
  var ws = makeCliWorkspace("t4-unrec", "  bogus_section:\n    - name: x\n      command: y");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[error]"), "expected [error] for unrecognized section; got: \"" + r.stderr + "\"");
  assert.ok(r.stderr.includes("bogus_section"), "expected section name; got: \"" + r.stderr + "\"");
});

test("C-T4c [AC4]: known section with non-array value emits [error]", function() {
  var ws = makeCliWorkspace("t4-nonarray", "  testPass: \"not-a-list\"");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[error]"), "expected [error] for non-array; got: \"" + r.stderr + "\"");
  assert.ok(r.stderr.includes("testPass"), "expected section name; got: \"" + r.stderr + "\"");
});

test("C-T4d [AC4]: missing required field emits [error]", function() {
  var ws = makeCliWorkspace("t4-missing", "  testPass:\n    - name: missing-cmd");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[error]"), "expected [error] for missing field; got: \"" + r.stderr + "\"");
  assert.ok(r.stderr.includes("missing required field"), "expected 'missing required field'; got: \"" + r.stderr + "\"");
  assert.ok(!r.stdout.includes("missing-cmd"), "gate missing-cmd must NOT be registered");
});

test("C-T4e [AC4]: valid entry with extra fields emits [warn] (gate still registered)", function() {
  var ws = makeCliWorkspace("t4-extra", "  testPass:\n    - name: extra-gate\n      command: echo hi\n      foobar: true");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes("[warn]"), "expected [warn] for extra field; got: \"" + r.stderr + "\"");
  assert.ok(r.stderr.includes("extra-gate"), "expected gate name in warn; got: \"" + r.stderr + "\"");
  assert.ok(r.stdout.includes("extra-gate"), "gate extra-gate must be registered");
});

test("C-T4f [AC4]: valid entry with cwd/timeoutMs does NOT emit warn", function() {
  var ws = makeCliWorkspace("t4-known", "  testPass:\n    - name: cwd-gate\n      command: echo hi\n      cwd: /tmp\n      timeoutMs: 30000");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(!r.stderr.includes("[warn]"), "expected NO [warn] for cwd/timeoutMs; got: \"" + r.stderr + "\"");
  assert.ok(!r.stderr.includes("[error]"), "expected NO [error] for valid entry; got: \"" + r.stderr + "\"");
  assert.ok(r.stdout.includes("cwd-gate"), "gate cwd-gate must be registered");
});

// Clean workspace
test("C-T4g: clean workspace emits zero diagnostics", function() {
  var ws = makeCliWorkspace("t4-clean", "  testPass:\n    - name: clean-gate\n      command: echo hi");
  var r = runCliQuay(["gate", "--list"], ws.workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(!r.stderr.includes("[error]"), "expected NO [error] for clean ws; got: \"" + r.stderr + "\"");
  assert.ok(!r.stderr.includes("[warn]"), "expected NO [warn] for clean ws; got: \"" + r.stderr + "\"");
  assert.ok(r.stdout.includes("clean-gate"), "gate clean-gate must be registered");
});

// stdout invariance
test("C-T1f [AC1]: gate --list stdout byte-identical whether or not diagnostics fire", function() {
  var wsClean = makeCliWorkspace("t1-clean2", "testPass:\n  - name: shared-gate\n    command: echo hi");
  var wsDirty = makeCliWorkspace("t1-dirty2", "testPass:\n  - name: shared-gate\n    command: echo hi\nbogus:\n  - name: ignored");
  var clean = runCliQuay(["gate", "--list"], wsClean.workspaceRoot);
  var dirty = runCliQuay(["gate", "--list"], wsDirty.workspaceRoot);
  assert.equal(clean.status, 0);
  assert.equal(dirty.status, 0);
  assert.ok(dirty.stderr.includes("[error]"), "expected [error] on dirty stderr");
  assert.equal(dirty.stdout, clean.stdout, "stdout must be byte-identical");
});

// Null gates
test("C-T4h: null gates: value emits zero diagnostics", function() {
  var tasksDir = makeTmpDir("quay-diagc-t4h-tasks-");
  var ws = makeTmpDir("quay-diagc-t4h-ws-");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\ngates: null\n");
  var r = runCliQuay(["gate", "--list"], ws);
  assert.equal(r.status, 0);
  assert.ok(!r.stderr.includes("[error]"), "expected NO [error] for null gates; got: \"" + r.stderr + "\"");
});

// Array gates — silent (F2)
test("C-T4i: array gates: value emits zero false diagnostics (F2)", function() {
  var tasksDir = makeTmpDir("quay-diagc-t4i-tasks-");
  var ws = makeTmpDir("quay-diagc-t4i-ws-");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\ngates:\n  - name: inline-array\n");
  var r = runCliQuay(["gate", "--list"], ws);
  assert.equal(r.status, 0);
  assert.ok(!r.stderr.includes("[error]"), "expected NO [error] for array gates; got: \"" + r.stderr + "\"");
});
