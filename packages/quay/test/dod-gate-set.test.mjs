// @test-group product
// DIR-042-A (M59) — the generic, runner-agnostic DoD gate SET: `test-pass`,
// `coverage-floor`, `red-green`. All three take their actual command(s) (+
// threshold/pattern) as pure workspace config (`.quay/gates.yml`), same
// factory family as `makeIt0Gate`/`makeAdrGate`/`makeFixedScriptGate`
// (registry.js) — thin wrappers over the shared `runAcceptance` process
// runner, fail-closed on missing config, exit-0-is-pass. RED-first per
// ADR-001: every gate below is exercised against a real fail-closed branch
// (no config) AND a real pass/fail branch (an actual shell command run via
// spawnSync, not a stubbed/asserted outcome).
//
// Run: node --test --experimental-test-coverage packages/quay/test/*.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadWorkspaceGates, listGates } from "../src/gate/registry.ts";

// Every workspace dir is removed once at the end of this file (the carrier-array + after()
// pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-dodgateset-${tag}-`));
  _tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

function writeGatesYml(workspaceRoot, yamlText) {
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "gates.yml"), yamlText);
}

// ===========================================================================
// test-pass
// ===========================================================================

test("test-pass: fails closed when no testPass entries are configured (empty gates.yml)", () => {
  const ws = tmpWorkspace("testpass-empty");
  writeGatesYml(ws, "it0: []\n");
  const gates = loadWorkspaceGates(ws);
  assert.equal(gates["some-test-suite"], undefined);
});

test("test-pass: fails closed when command is an empty string", async () => {
  const ws = tmpWorkspace("testpass-empty-cmd");
  writeGatesYml(ws, "testPass:\n  - name: my-tests\n    command: \"\"\n");
  const gates = loadWorkspaceGates(ws);
  const r = await gates["my-tests"]();
  assert.equal(r.ok, false);
  assert.match(r.reason, /no test command configured/);
});

test("test-pass: RED — real command exiting non-zero maps to ok:false", async () => {
  const ws = tmpWorkspace("testpass-red");
  writeGatesYml(ws, 'testPass:\n  - name: my-tests\n    command: "exit 1"\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["my-tests"]();
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
});

test("test-pass: GREEN — real command exiting zero maps to ok:true", async () => {
  const ws = tmpWorkspace("testpass-green");
  writeGatesYml(ws, 'testPass:\n  - name: my-tests\n    command: "exit 0"\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["my-tests"]();
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("test-pass: listGates() surfaces a configured testPass gate name", () => {
  const ws = tmpWorkspace("testpass-list");
  writeGatesYml(ws, 'testPass:\n  - name: my-listed-tests\n    command: "exit 0"\n');
  assert.ok(listGates(ws).includes("my-listed-tests"));
});

// ===========================================================================
// coverage-floor
// ===========================================================================

test("coverage-floor: fails closed when command is unset", async () => {
  const ws = tmpWorkspace("covfloor-nocmd");
  writeGatesYml(ws, "coverageFloor:\n  - name: cov\n    floor: 80\n");
  const gates = loadWorkspaceGates(ws);
  // no `command` key at all -> entry skipped entirely by loadWorkspaceGates
  assert.equal(gates["cov"], undefined);
});

test("coverage-floor: fails closed when floor is unset (not a number)", async () => {
  const ws = tmpWorkspace("covfloor-nofloor");
  writeGatesYml(ws, 'coverageFloor:\n  - name: cov\n    command: "echo 90%"\n');
  const gates = loadWorkspaceGates(ws);
  // no `floor` key -> entry skipped entirely by loadWorkspaceGates
  assert.equal(gates["cov"], undefined);
});

test("coverage-floor: fails closed when the command's output has no parseable percentage", async () => {
  const ws = tmpWorkspace("covfloor-unparsable");
  writeGatesYml(ws, 'coverageFloor:\n  - name: cov\n    command: "echo no numbers here"\n    floor: 80\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["cov"]();
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not find a coverage percentage/);
});

test("coverage-floor: RED — real command reporting coverage below the floor FAILs", async () => {
  const ws = tmpWorkspace("covfloor-red");
  writeGatesYml(ws, 'coverageFloor:\n  - name: cov\n    command: "echo coverage: 42.0%"\n    floor: 80\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["cov"]();
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
  assert.match(r.reason, /42/);
  assert.match(r.reason, /below floor/);
});

test("coverage-floor: GREEN — real command reporting coverage at/above the floor PASSes", async () => {
  const ws = tmpWorkspace("covfloor-green");
  writeGatesYml(ws, 'coverageFloor:\n  - name: cov\n    command: "echo coverage: 95.5%"\n    floor: 80\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["cov"]();
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
  assert.match(r.reason, /95\.5/);
});

test("coverage-floor: exact-floor boundary (>=) PASSes", async () => {
  const ws = tmpWorkspace("covfloor-boundary");
  writeGatesYml(ws, 'coverageFloor:\n  - name: cov\n    command: "echo coverage: 80%"\n    floor: 80\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["cov"]();
  assert.equal(r.ok, true, `expected pass at exact floor; got reason=${r.reason}`);
});

test("coverage-floor: custom pattern overrides the default %-extraction regex", async () => {
  const ws = tmpWorkspace("covfloor-pattern");
  writeGatesYml(
    ws,
    'coverageFloor:\n  - name: cov\n    command: "echo lines-covered=88/100"\n    floor: 80\n    pattern: "lines-covered=(\\\\d+)/100"\n'
  );
  const gates = loadWorkspaceGates(ws);
  const r = await gates["cov"]();
  assert.equal(r.ok, true, `expected pass via custom pattern; got reason=${r.reason}`);
});

test("coverage-floor: listGates() surfaces a configured coverageFloor gate name", () => {
  const ws = tmpWorkspace("covfloor-list");
  writeGatesYml(ws, 'coverageFloor:\n  - name: my-listed-cov\n    command: "echo 90%"\n    floor: 80\n');
  assert.ok(listGates(ws).includes("my-listed-cov"));
});

// ===========================================================================
// red-green
// ===========================================================================

test("red-green: fails closed when red command is unset", async () => {
  const ws = tmpWorkspace("redgreen-nored");
  writeGatesYml(ws, 'redGreen:\n  - name: rg\n    green: "exit 0"\n');
  const gates = loadWorkspaceGates(ws);
  // no `red` key -> entry skipped entirely by loadWorkspaceGates
  assert.equal(gates["rg"], undefined);
});

test("red-green: fails closed when green command is unset", async () => {
  const ws = tmpWorkspace("redgreen-nogreen");
  writeGatesYml(ws, 'redGreen:\n  - name: rg\n    red: "exit 1"\n');
  const gates = loadWorkspaceGates(ws);
  // no `green` key -> entry skipped entirely by loadWorkspaceGates
  assert.equal(gates["rg"], undefined);
});

test("red-green: fails closed when the red command unexpectedly PASSES", async () => {
  const ws = tmpWorkspace("redgreen-red-passes");
  writeGatesYml(ws, 'redGreen:\n  - name: rg\n    red: "exit 0"\n    green: "exit 0"\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["rg"]();
  assert.equal(r.ok, false);
  assert.match(r.reason, /red command unexpectedly passed/);
});

test("red-green: fails closed when the green command FAILS", async () => {
  const ws = tmpWorkspace("redgreen-green-fails");
  writeGatesYml(ws, 'redGreen:\n  - name: rg\n    red: "exit 1"\n    green: "exit 1"\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["rg"]();
  assert.equal(r.ok, false);
  assert.match(r.reason, /RED->GREEN transition not evidenced/);
});

test("red-green: PASS — real red command fails, real green command passes (genuine RED->GREEN pair)", async () => {
  const ws = tmpWorkspace("redgreen-real-pair");
  writeGatesYml(ws, 'redGreen:\n  - name: rg\n    red: "exit 1"\n    green: "exit 0"\n');
  const gates = loadWorkspaceGates(ws);
  const r = await gates["rg"]();
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("red-green: listGates() surfaces a configured redGreen gate name", () => {
  const ws = tmpWorkspace("redgreen-list");
  writeGatesYml(ws, 'redGreen:\n  - name: my-listed-rg\n    red: "exit 1"\n    green: "exit 0"\n');
  assert.ok(listGates(ws).includes("my-listed-rg"));
});

// ===========================================================================
// Fresh non-research workspace sees none of these by default (AC parity with
// the existing it0/adr/fixed behavior — an empty/absent gates.yml declares
// nothing).
// ===========================================================================

test("a workspace with no gates.yml at all sees none of the three new gate kinds", () => {
  const ws = tmpWorkspace("no-gates-yml");
  const gates = loadWorkspaceGates(ws);
  assert.deepEqual(gates, {});
});
