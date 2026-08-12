// @test-group product
// gate-list-verbose.test.mjs — RED/GREEN tests for DIR-104
// quay gate --list --verbose (provenance + diagnostics)
//
// Run: scripts/test.sh packages/quay/test/gate-list-verbose.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const quayBin = path.resolve(__dirname, "..", "bin", "quay.ts");

// Every workspace dir is removed once at the end of this file (the carrier-array + after()
// pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpWs(tag) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "quay-glv-" + tag + "-"));
  _tmpDirs.push(ws);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  return ws;
}

function gateList(argv, opts) {
  const args = ["gate", "--list", ...argv];
  return spawnSync("node", [quayBin, ...args], {
    cwd: opts?.cwd || process.cwd(),
    encoding: "utf8",
    ...opts,
  });
}

function gateListFrom(cwd, argv) {
  return gateList(argv || [], { cwd });
}

// ===========================================================================
// Section 1 — loader provenance unit (AC3, AC5, AC9)
// ===========================================================================

test("Section 1: loadWorkspaceGateMetadata returns rows with source file:line and diagnostics for malformed entries", async () => {
  const { loadWorkspaceGateMetadata, loadWorkspaceGates } = await import("../src/gate/config/loader.ts");

  const ws = tmpWs("s1-provenance");
  const cfgYml = path.join(ws, ".quay", "config.yml");
  fs.writeFileSync(cfgYml, [
    "providers:",
    "  native:",
    "    enabled: true",
    "gates:",
    "  it0:",
    "    - name: impl-row",
    "      script: ./scripts/impl-check.sh",
    "      argsKey: impl-row",
    "    - name: bad-row",
  ].join("\n"));

  const meta = loadWorkspaceGateMetadata(ws);

  // AC3: workspace gate shows source as <file>:<line>
  const implRow = meta.rows.find(function(r) { return r.name === "impl-row"; });
  assert.ok(implRow, "impl-row should be in rows");
  assert.match(implRow.source, /config\.yml:\d+/, "source should be config.yml:<line>");
  assert.equal(implRow.type, "it0");
  assert.match(implRow.detail, /script:.*argsKey:.*/);

  // AC5: malformed entry produces a diagnostic
  assert.ok(meta.diagnostics.length >= 1, "should have at least one diagnostic for bad-row");
  const badDiag = meta.diagnostics.find(function(d) { return d.message.includes("bad-row"); });
  assert.ok(badDiag, "should have a diagnostic naming bad-row");
  assert.match(badDiag.message, /missing required field.*script/);
  // DIR-100-C: missing required field ⇒ gate not registered ⇒ ERROR level (not WARNING)
  assert.equal(badDiag.level, "ERROR");

  // AC9: loadWorkspaceGates still works (contract preserved)
  const gates = loadWorkspaceGates(ws);
  assert.ok(gates["impl-row"], "impl-row should be registered as a gate function");
  assert.equal(gates["bad-row"], undefined, "bad-row should NOT be registered");

  // AC9: verify listGatesVerbose rows contain the loader's workspace rows
  const { listGatesVerbose } = await import("../src/gate/registry.ts");
  const verbose = listGatesVerbose(ws);
  // impl-row row in verbose should equal loader's impl-row row
  const verboseImplRow = verbose.rows.find(function(r) { return r.name === "impl-row"; });
  assert.ok(verboseImplRow, "verbose should include impl-row");
  assert.deepEqual(verboseImplRow, implRow, "verbose impl-row should equal loader row (AC9)");
  // built-ins come first (AC2)
  assert.equal(verbose.rows[0].source, "built-in", "first row should be built-in");
  assert.equal(verbose.rows[1].source, "built-in");
  assert.equal(verbose.rows[2].source, "built-in");
  // diagnostics match
  assert.deepEqual(verbose.diagnostics, meta.diagnostics, "verbose diagnostics should equal loader diagnostics (AC9)");
});

// ===========================================================================
// Section 2 — shadowed gates.yml diagnostic (AC4, DoD5)
// ===========================================================================

test("Section 2: shadowed gates.yml gate produces WARNING diagnostic (AC4, DoD5)", async () => {
  const { loadWorkspaceGateMetadata } = await import("../src/gate/config/loader.ts");

  const ws = tmpWs("s2-shadow");
  // config.yml with gates section registering tree-hygiene but NOT vitest
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "gates:",
    "  fixed:",
    "    - name: tree-hygiene",
    "      script: \"./scripts/tree-hygiene.sh\"",
  ].join("\n"));
  // legacy gates.yml declaring vitest (will be shadowed by config.yml)
  fs.writeFileSync(path.join(ws, ".quay", "gates.yml"), [
    "testPass:",
    "  - name: vitest",
    "    command: npx vitest run",
  ].join("\n"));

  const meta = loadWorkspaceGateMetadata(ws);

  // AC4: diagnostic about vitest being shadowed
  const shadowDiag = meta.diagnostics.find(function(d) { return d.message.includes("vitest"); });
  assert.ok(shadowDiag, "should have a shadow diagnostic naming vitest (DoD5)");
  assert.match(shadowDiag.message, /\.quay\/config\.yml/);
  assert.match(shadowDiag.message, /NOT registered/);
  assert.equal(shadowDiag.level, "WARNING");

  // tree-hygiene from config.yml should still be registered
  assert.ok(meta.rows.find(function(r) { return r.name === "tree-hygiene"; }), "tree-hygiene should be in rows");

  // vitest should NOT be in gates (shadowed)
  assert.equal(meta.gates["vitest"], undefined, "vitest should NOT be registered");
});

// ===========================================================================
// Section 3 — CLI verbose table (AC1, AC2, AC3)
// ===========================================================================

test("Section 3: gate --list --verbose outputs table with NAME, SOURCE, TYPE, DETAIL columns (AC1, AC2, AC3)", function() {
  const ws = tmpWs("s3-cli-table");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "gates:",
    "  fixed:",
    "    - name: tree-hygiene",
    "      script: \"./scripts/tree-hygiene.sh\"",
  ].join("\n"));

  const r = gateListFrom(ws, ["--verbose"]);
  assert.equal(r.status, 0, "exit 0");
  const out = r.stdout;

  // AC1: header columns (first row has NAME, SOURCE, TYPE, DETAIL)
  // Built-in gates have source "built-in" (AC2)
  assert.match(out, /dod\s+built-in\s+dod\s+.*delegates/, "dod row with built-in source");
  assert.match(out, /acceptance\s+built-in\s+acceptance\s+.*runs task/, "acceptance row with built-in source");
  assert.match(out, /doc-quay-directive-skill\s+built-in\s+doc/, "doc gate with built-in source");

  // AC3: workspace gate shows <file>:<line>
  assert.match(out, /tree-hygiene\s+.*config\.yml:\d+/, "tree-hygiene row with config.yml:<line> source");
});

// ===========================================================================
// Section 4 — diagnostics section (AC4, AC5)
// ===========================================================================

test("Section 4: gate --list --verbose appends ## Diagnostics section (AC4, AC5)", function() {
  const ws = tmpWs("s4-diag");
  // config.yml with one malformed entry
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "gates:",
    "  it0:",
    "    - name: bad-row",
  ].join("\n"));

  const r = gateListFrom(ws, ["--verbose"]);
  assert.equal(r.status, 0, "exit 0");
  const out = r.stdout;

  // AC5: diagnostics section
  assert.match(out, /## Diagnostics/, "should have diagnostics section");
  assert.match(out, /ERROR.*bad-row/, "should mention bad-row");
  assert.match(out, /missing required field/, "should mention missing required field");
});

test("Section 4b: shadowed gate in verbose output", function() {
  const ws = tmpWs("s4b-shadow");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "gates:",
    "  fixed:",
    "    - name: tree-hygiene",
    "      script: \"./scripts/th.sh\"",
  ].join("\n"));
  fs.writeFileSync(path.join(ws, ".quay", "gates.yml"), [
    "testPass:",
    "  - name: vitest",
    "    command: npx vitest run",
  ].join("\n"));

  const r = gateListFrom(ws, ["--verbose"]);
  assert.equal(r.status, 0, "exit 0");
  const out = r.stdout;

  // AC4: shadowed vitest diagnostic
  assert.match(out, /## Diagnostics/);
  assert.match(out, /WARNING.*vitest/);
  assert.match(out, /NOT registered/);
});

// ===========================================================================
// Section 5 — JSON output + short flag + no-regression (AC6, AC7, AC10)
// ===========================================================================

test("Section 5: gate --list --json --verbose outputs JSON (AC7)", function() {
  const ws = tmpWs("s5-json");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "gates:",
    "  fixed:",
    "    - name: tree-hygiene",
    "      script: \"./scripts/th.sh\"",
  ].join("\n"));

  const r = gateListFrom(ws, ["--json", "--verbose"]);
  assert.equal(r.status, 0, "exit 0");
  const data = JSON.parse(r.stdout);

  // AC7 shape: { gates, diagnostics }
  assert.ok(Array.isArray(data.gates), "gates should be an array");
  assert.ok(Array.isArray(data.diagnostics), "diagnostics should be an array");

  // Each gate has name, source, type, detail
  for (var i = 0; i < data.gates.length; i++) {
    var g = data.gates[i];
    assert.ok(typeof g.name === "string", "gate should have name");
    assert.ok(typeof g.source === "string", "gate should have source");
    assert.ok(typeof g.type === "string", "gate should have type");
    assert.ok(typeof g.detail === "string", "gate should have detail");
  }

  // Built-ins have source "built-in"
  var dodGate = data.gates.find(function(g) { return g.name === "dod"; });
  assert.ok(dodGate, "dod should be in JSON");
  assert.equal(dodGate.source, "built-in");

  // Workspace gate has <file>:<line>
  var treeGate = data.gates.find(function(g) { return g.name === "tree-hygiene"; });
  assert.ok(treeGate, "tree-hygiene should be in JSON");
  assert.match(treeGate.source, /config\.yml:\d+/);
});

test("Section 5: gate --list -v (short flag) same as --verbose (AC1)", function() {
  const ws = tmpWs("s5-short");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
  ].join("\n"));

  var r1 = gateListFrom(ws, ["--verbose"]);
  var r2 = gateListFrom(ws, ["-v"]);
  assert.equal(r1.status, 0);
  assert.equal(r2.status, 0);
  assert.equal(r1.stdout, r2.stdout, "-v should produce same output as --verbose");
});

test("Section 5: --verbose --json == --json --verbose (order-independence, AC7)", function() {
  const ws = tmpWs("s5-order");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
  ].join("\n"));

  var r1 = gateListFrom(ws, ["--verbose", "--json"]);
  var r2 = gateListFrom(ws, ["--json", "--verbose"]);
  assert.equal(r1.status, 0);
  assert.equal(r2.status, 0);
  assert.equal(r1.stdout, r2.stdout, "flag order must not change output");
});

test("Section 5: config-less gate --list --verbose (AC10 null guard)", function() {
  // In a temp dir with NO .quay/config.yml
  const dir = tmpWs("s5-noconfig");
  fs.rmdirSync(path.join(dir, ".quay"));

  var r = gateListFrom(dir, ["--verbose"]);
  assert.equal(r.status, 0, "exit 0 even without config.yml (AC10)");
  var out = r.stdout;

  // Should show exactly the built-in rows
  assert.match(out, /dod\s+built-in/, "dod with built-in source");
  assert.match(out, /acceptance\s+built-in/, "acceptance with built-in source");
  assert.match(out, /doc-quay-directive-skill\s+built-in/, "doc gate with built-in source");

  // NO diagnostics section
  var hasDiag = out.includes("## Diagnostics");
  assert.equal(hasDiag, false, "no diagnostics section when no workspace config (AC10)");
});

test("Section 5: flagless gate --list is byte-identical (AC6 regression)", function() {
  const ws = tmpWs("s5-flagless");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "gates:",
    "  fixed:",
    "    - name: tree-hygiene",
    "      script: \"./scripts/th.sh\"",
  ].join("\n"));

  var r = gateListFrom(ws, []);
  assert.equal(r.status, 0, "exit 0");

  // Flagless output should be flat name list (no padding, no columns, no diagnostics)
  var lines = r.stdout.trim().split("\n");
  // Should have at least the 3 built-ins
  assert.ok(lines.length >= 3);
  assert.ok(lines.includes("dod"));
  assert.ok(lines.includes("acceptance"));
  assert.ok(lines.includes("doc-quay-directive-skill"));

  // No verbose formatting
  var hasTable = r.stdout.includes("built-in");
  assert.equal(hasTable, false, "flagless output should NOT contain built-in column");
  var hasDiag = r.stdout.includes("## Diagnostics");
  assert.equal(hasDiag, false, "flagless output should NOT contain diagnostics");
});
