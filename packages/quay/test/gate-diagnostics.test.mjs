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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpWs(tag) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `quay-gate-diag-${tag}-`));
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
