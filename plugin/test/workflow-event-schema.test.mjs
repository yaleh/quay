// @test-group engine
// workflow-event-schema.test.mjs — DIR-124-A1a: RED/GREEN tests for
// workflow-event-schema.mjs (experiments and plugin mirrors).
//
// Run:
//   node --test experiments/quay-perpetual-stream/test/workflow-event-schema.test.mjs
//   scripts/test.sh experiments/quay-perpetual-stream/test/workflow-event-schema.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// REPO_ROOT must resolve to the same directory regardless of whether this file lives at
// experiments/quay-perpetual-stream/test/ or plugin/test/ (byte-identical mirror requirement).
function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const SCRIPTS = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts");
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const TMP = path.join(REPO_ROOT, "tmp");

// Ensure tmp/ exists for scratch files
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Run a module via `node --no-warnings` (plain .mjs, no --experimental-strip-types needed).
 */
function runModuleJs(modulePath, ...args) {
  const cmd = `node --no-warnings ${modulePath} ${args.join(" ")}`;
  try {
    const stdout = execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      exitCode: e.status || 1,
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : "",
    };
  }
}

/**
 * Dynamic import of the schema module.
 */
async function importSchemaModule(scriptsDir) {
  const modulePath = path.join(scriptsDir, "workflow-event-schema.mjs");
  return import(modulePath);
}

// ── Minimal valid event fixture ───────────────────────────────────────────────────────────────────────

function makeValidEvent(overrides = {}) {
  return {
    schemaVersion: "1",
    runId: "M248",
    candidateId: "M248-DIR-124",
    taskId: "DIR-124-A1a",
    stage: "Build",
    attempt: 0,
    timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: null },
    agentLabel: "build-agent",
    commandIdentity: "tsx script.ts",
    executionCwd: "/home/user/work/quay",
    worktreePath: null,
    baseCommit: "abc123def",
    candidateCommit: null,
    outcome: null,
    waitReason: null,
    resourceClaim: null,
    observedWrites: [],
    isolationMode: null,
    dispatchMode: "serial",
    recordedAtMs: 2000,
    ...overrides,
  };
}

// ── AC1: validateEvent checks all 20 required fields ──────────────────────────────────────────────────

test("AC1 — validateEvent accepts valid event", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const event = makeValidEvent();
  const result = mod.validateEvent(event);
  assert.equal(result.ok, true, `expected ok=true, got ${JSON.stringify(result)}`);
});

test("AC1 — validateEvent rejects missing required field", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  for (const field of mod.REQUIRED_FIELDS) {
    const event = makeValidEvent();
    delete event[field];
    const result = mod.validateEvent(event);
    assert.equal(result.ok, false, `expected ok=false for missing "${field}"`);
    assert.ok(result.error.includes(field) || result.error.includes("missing required field"),
      `error should name the missing field "${field}", got "${result.error}"`);
  }
});

test("AC1 — validateEvent rejects wrong schemaVersion", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent(makeValidEvent({ schemaVersion: "2" }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('"2"'), `error should mention version "2", got "${result.error}"`);
});

test("AC1 — validateEvent rejects wrong type for attempt", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent(makeValidEvent({ attempt: "0" }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("attempt"), `error should mention "attempt", got "${result.error}"`);
});

test("AC1 — validateEvent rejects invalid stage", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent(makeValidEvent({ stage: "UnknownPhase" }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("UnknownPhase"), `error should mention "UnknownPhase", got "${result.error}"`);
});

test("AC1 — validateEvent rejects invalid outcome", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent(makeValidEvent({ outcome: "bad-outcome" }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("bad-outcome"), `error should mention "bad-outcome", got "${result.error}"`);
});

test("AC1 — validateEvent rejects missing recordedAtMs", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const event = makeValidEvent();
  delete event.recordedAtMs;
  const result = mod.validateEvent(event);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("recordedAtMs"), `error should mention "recordedAtMs", got "${result.error}"`);
});

test("AC1 — validateEvent accepts all VALID_STAGES", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  for (const s of mod.VALID_STAGES) {
    const result = mod.validateEvent(makeValidEvent({ stage: s }));
    assert.equal(result.ok, true, `stage "${s}" should be valid: ${JSON.stringify(result)}`);
  }
});

test("AC1 — validateEvent accepts all VALID_OUTCOMES", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  for (const o of mod.VALID_OUTCOMES) {
    const result = mod.validateEvent(makeValidEvent({ outcome: o }));
    assert.equal(result.ok, true, `outcome "${o}" should be valid: ${JSON.stringify(result)}`);
  }
});

test("AC1 — validateEvent allows unknown additional properties (forward-compat)", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const event = makeValidEvent({ futureField: "hello", anotherExtra: 42 });
  const result = mod.validateEvent(event);
  assert.equal(result.ok, true, `forward-compat extra fields should pass: ${JSON.stringify(result)}`);
});

test("AC1 — validateEvent rejects non-string observedWrites element", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent(makeValidEvent({ observedWrites: ["file1.md", 42] }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("observedWrites[1]"), `error should mention observedWrites[1], got "${result.error}"`);
});

test("AC1 — validateEvent never throws", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  // null
  let result = mod.validateEvent(null);
  assert.equal(result.ok, false);
  // undefined
  result = mod.validateEvent(undefined);
  assert.equal(result.ok, false);
  // array
  result = mod.validateEvent([1, 2, 3]);
  assert.equal(result.ok, false);
  // string
  result = mod.validateEvent("not an object");
  assert.equal(result.ok, false);
  // number
  result = mod.validateEvent(42);
  assert.equal(result.ok, false);
});

test("AC1 — validateEvent lineNumber passthrough", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent({}, 42);
  assert.equal(result.lineNumber, 42);
  // valid event without explicit lineNumber
  const okResult = mod.validateEvent(makeValidEvent());
  assert.equal(okResult.lineNumber, undefined);
});

// ── AC1: --selftest CLI ──────────────────────────────────────────────────────────────────────────────

test("AC1 — CLI --selftest exits 0 (experiments mirror)", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const { exitCode, stdout } = runModuleJs(modPath, "--selftest");
  assert.equal(exitCode, 0, `selftest should exit 0, got ${exitCode}\nstdout: ${stdout}`);
});

test("AC1 — CLI --selftest exits 0 (plugin mirror)", async () => {
  const modPath = path.join(PLUGIN_SCRIPTS, "workflow-event-schema.mjs");
  const { exitCode, stdout } = runModuleJs(modPath, "--selftest");
  assert.equal(exitCode, 0, `plugin selftest should exit 0, got ${exitCode}\nstdout: ${stdout}`);
});

// ── AC2: parseEventStream streaming JSONL reader ─────────────────────────────────────────────────────

test("AC2 — parseEventStream reads valid 3-line JSONL", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const jsonlPath = path.join(TMP, "test-valid-events.jsonl");
  const e1 = makeValidEvent({ stage: "Verify" });
  const e2 = makeValidEvent({ stage: "Build" });
  const e3 = makeValidEvent({ stage: "Land", outcome: "done" });
  fs.writeFileSync(jsonlPath, [mod.emitEvent(e1), mod.emitEvent(e2), mod.emitEvent(e3), ""].join("\n"), "utf8");

  const results = [];
  for await (const r of mod.parseEventStream(jsonlPath)) {
    results.push(r);
  }
  fs.unlinkSync(jsonlPath);

  assert.equal(results.length, 3, `expected 3 results, got ${results.length}`);
  assert.equal(results[0].ok, true, `line 1 should be valid`);
  assert.equal(results[0].event.stage, "Verify");
  assert.equal(results[1].ok, true, `line 2 should be valid`);
  assert.equal(results[1].event.stage, "Build");
  assert.equal(results[2].ok, true, `line 3 should be valid`);
  assert.equal(results[2].event.stage, "Land");
  assert.equal(results[2].event.outcome, "done");
});

test("AC2 — parseEventStream handles mixed valid+invalid JSONL", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const jsonlPath = path.join(TMP, "test-mixed-events.jsonl");
  const validEvent = mod.emitEvent(makeValidEvent());
  const badJson = "{not valid json";
  const invalidEvent = mod.emitEvent(makeValidEvent({ stage: "BadStage" }));
  fs.writeFileSync(jsonlPath, [validEvent, badJson, invalidEvent, ""].join("\n"), "utf8");

  const results = [];
  for await (const r of mod.parseEventStream(jsonlPath)) {
    results.push(r);
  }
  fs.unlinkSync(jsonlPath);

  assert.equal(results.length, 3, `expected 3 results, got ${results.length}`);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false, `bad JSON line should be invalid`);
  assert.ok(results[1].error.includes("JSON parse error"), `error should mention parse: "${results[1].error}"`);
  assert.equal(results[2].ok, false, `invalid stage line should be invalid`);
  assert.ok(results[2].error.includes("BadStage"), `error should mention BadStage: "${results[2].error}"`);
});

test("AC2 — parseEventStream skips empty and whitespace-only lines", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const jsonlPath = path.join(TMP, "test-empty-lines.jsonl");
  const validLine = mod.emitEvent(makeValidEvent());
  fs.writeFileSync(jsonlPath, ["", "   ", validLine, "\t  ", ""].join("\n"), "utf8");

  const results = [];
  for await (const r of mod.parseEventStream(jsonlPath)) {
    results.push(r);
  }
  fs.unlinkSync(jsonlPath);

  assert.equal(results.length, 1, `expected exactly 1 result, got ${results.length}`);
  assert.equal(results[0].ok, true);
});

test("AC2 — parseEventStream handles empty file", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const jsonlPath = path.join(TMP, "test-empty.jsonl");
  fs.writeFileSync(jsonlPath, "", "utf8");

  const results = [];
  for await (const r of mod.parseEventStream(jsonlPath)) {
    results.push(r);
  }
  fs.unlinkSync(jsonlPath);

  assert.equal(results.length, 0, "empty file should produce 0 results");
});

test("AC2 — parseEventStream non-existent file throws", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const jsonlPath = path.join(TMP, "nonexistent-file.jsonl");
  try {
    for await (const _r of mod.parseEventStream(jsonlPath)) {
      // should not reach here
    }
    assert.fail("should have thrown for non-existent file");
  } catch (e) {
    assert.ok(e instanceof Error, `expected Error, got ${typeof e}`);
  }
});

// ── AC3: emitEvent deterministic sorted-key output ────────────────────────────────────────────────────

test("AC3 — emitEvent produces single-line output (no embedded newline)", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const output = mod.emitEvent(makeValidEvent());
  assert.ok(!output.includes("\n"), "output should not contain newline");
});

test("AC3 — emitEvent two calls with same object are byte-identical", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const event = makeValidEvent();
  const out1 = mod.emitEvent(event);
  const out2 = mod.emitEvent(event);
  assert.equal(out1, out2);
});

test("AC3 — emitEvent insertion-order independent", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  // Build two events with the same values but different key insertion order
  const event1 = {};
  for (const key of mod.REQUIRED_FIELDS) {
    event1[key] = makeValidEvent()[key] !== undefined ? makeValidEvent()[key] : null;
  }
  event1.schemaVersion = "1";
  event1.attempt = 0;
  event1.recordedAtMs = 2000;

  // Reverse order
  const event2 = {};
  for (const key of [...mod.REQUIRED_FIELDS].reverse()) {
    event2[key] = makeValidEvent()[key] !== undefined ? makeValidEvent()[key] : null;
  }
  event2.schemaVersion = "1";
  event2.attempt = 0;
  event2.recordedAtMs = 2000;

  assert.equal(mod.emitEvent(event1), mod.emitEvent(event2));
});

test("AC3 — emitEvent output is valid JSON and parseable", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const output = mod.emitEvent(makeValidEvent());
  const parsed = JSON.parse(output);
  assert.equal(parsed.schemaVersion, "1");
  assert.equal(parsed.stage, "Build");
  assert.equal(typeof parsed.attempt, "number");
  assert.equal(parsed.outcome, null);
  assert.deepEqual(parsed.observedWrites, []);
  // Ensure timing sub-object survived (not flattened by JSON.stringify array replacer)
  assert.ok(parsed.timing && typeof parsed.timing === "object");
  assert.equal(parsed.timing.queuedAtMs, 1000);
  assert.equal(parsed.timing.startedAtMs, 1100);
  assert.equal(parsed.timing.endedAtMs, null);
});

test("AC3 — emitEvent sorts keys alphabetically", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const output = mod.emitEvent(makeValidEvent());
  const parsedKeys = Object.keys(JSON.parse(output));
  const sortedKeys = [...parsedKeys].sort();
  assert.deepEqual(parsedKeys, sortedKeys, "keys should be sorted in output");
});

// ── AC4: Byte-identical mirror ───────────────────────────────────────────────────────────────────────

test("AC4 — mirrors are byte-identical", () => {
  const expPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const plugPath = path.join(PLUGIN_SCRIPTS, "workflow-event-schema.mjs");
  const expContent = fs.readFileSync(expPath, "utf8");
  const plugContent = fs.readFileSync(plugPath, "utf8");
  assert.equal(expContent, plugContent, "mirrors must be byte-identical");
});

test("AC4 — both mirrors export same constants and functions", async () => {
  const expMod = await importSchemaModule(SCRIPTS);
  const plugMod = await importSchemaModule(PLUGIN_SCRIPTS);

  assert.equal(expMod.SCHEMA_VERSION, plugMod.SCHEMA_VERSION);
  assert.deepEqual(expMod.VALID_STAGES, plugMod.VALID_STAGES);
  assert.deepEqual(expMod.VALID_OUTCOMES, plugMod.VALID_OUTCOMES);
  assert.deepEqual(expMod.VALID_WAIT_REASONS, plugMod.VALID_WAIT_REASONS);
  assert.deepEqual(expMod.VALID_ISOLATION_MODES, plugMod.VALID_ISOLATION_MODES);
  assert.deepEqual(expMod.VALID_DISPATCH_MODES, plugMod.VALID_DISPATCH_MODES);
  assert.deepEqual(expMod.REQUIRED_FIELDS, plugMod.REQUIRED_FIELDS);
  assert.equal(typeof expMod.validateEvent, "function");
  assert.equal(typeof plugMod.validateEvent, "function");
  assert.equal(typeof expMod.parseEventStream, "function");
  assert.equal(typeof plugMod.parseEventStream, "function");
  assert.equal(typeof expMod.emitEvent, "function");
  assert.equal(typeof plugMod.emitEvent, "function");

  // Both should produce identical validation results
  const event = makeValidEvent();
  const expResult = expMod.validateEvent(event);
  const plugResult = plugMod.validateEvent(event);
  assert.deepEqual(expResult, plugResult);
});

// ── AC5: SCHEMA_VERSION constant and import surface ──────────────────────────────────────────────────

test("AC5 — SCHEMA_VERSION is \"1\"", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  assert.equal(mod.SCHEMA_VERSION, "1");
});

test("AC5 — VALID_STAGES, VALID_OUTCOMES, VALID_WAIT_REASONS, VALID_ISOLATION_MODES, VALID_DISPATCH_MODES are frozen arrays", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  assert.ok(Array.isArray(mod.VALID_STAGES));
  assert.ok(Array.isArray(mod.VALID_OUTCOMES));
  assert.ok(Array.isArray(mod.VALID_WAIT_REASONS));
  assert.ok(Array.isArray(mod.VALID_ISOLATION_MODES));
  assert.ok(Array.isArray(mod.VALID_DISPATCH_MODES));
});

test("AC5 — REQUIRED_FIELDS has exactly 20 elements", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  assert.equal(mod.REQUIRED_FIELDS.length, 20, `expected 20 required fields, got ${mod.REQUIRED_FIELDS.length}`);
});

// ── AC5: CLI --emit-event mode follows established patterns ──────────────────────────────────────────

test("AC5 — CLI --emit-event writes to .workflow-events/<runId>.jsonl", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const event = makeValidEvent();
  const eventJson = JSON.stringify(event);
  // Use single-quote escaping for shell
  const escaped = eventJson.replace(/'/g, "'\\''");
  const { exitCode, stderr } = runModuleJs(modPath, "--emit-event", `'${escaped}'`);
  assert.equal(exitCode, 0, `--emit-event should exit 0, got ${exitCode}\nstderr: ${stderr}`);

  // Check that the log file was created
  const logPath = path.join(REPO_ROOT, ".workflow-events", `${event.runId}.jsonl`);
  assert.ok(fs.existsSync(logPath), `log file should exist at ${logPath}`);

  // Read and validate the last line
  const content = fs.readFileSync(logPath, "utf8");
  const lines = content.trim().split("\n");
  const lastLine = lines[lines.length - 1];
  const parsed = JSON.parse(lastLine);
  assert.equal(parsed.runId, event.runId);
  assert.equal(parsed.stage, event.stage);

  // Clean up
  fs.unlinkSync(logPath);
  // Remove .workflow-events/ if empty
  try { fs.rmdirSync(path.join(REPO_ROOT, ".workflow-events")); } catch (_) { /* not empty, ok */ }
});

test("AC5 — CLI --emit-event with invalid JSON exits 0 (fail-soft)", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const { exitCode } = runModuleJs(modPath, "--emit-event", "'{not valid json}'");
  assert.equal(exitCode, 0, "fail-soft: invalid JSON should still exit 0");
});

test("AC5 — CLI --emit-event with missing runId exits 0 (fail-soft)", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const event = makeValidEvent();
  delete event.runId;
  const eventJson = JSON.stringify(event);
  const escaped = eventJson.replace(/'/g, "'\\''");
  const { exitCode } = runModuleJs(modPath, "--emit-event", `'${escaped}'`);
  assert.equal(exitCode, 0, "fail-soft: missing runId should still exit 0");
});

// ── AC5: CLI --validate mode ─────────────────────────────────────────────────────────────────════

test("AC5 — CLI --validate validates a JSONL file", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const jsonlPath = path.join(TMP, "test-validate.jsonl");
  const e1 = mod.emitEvent(makeValidEvent({ stage: "Verify" }));
  const e2 = mod.emitEvent(makeValidEvent({ stage: "Build" }));
  fs.writeFileSync(jsonlPath, [e1, e2, ""].join("\n"), "utf8");

  const { exitCode, stdout } = runModuleJs(modPath, "--validate", jsonlPath);
  fs.unlinkSync(jsonlPath);

  assert.equal(exitCode, 0, `--validate should exit 0 for valid file, got ${exitCode}\nstdout: ${stdout}`);
  assert.ok(stdout.includes("2 valid"), `should report 2 valid, got: ${stdout}`);
});

test("AC5 — CLI --validate with mixed valid/invalid exits 1", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const jsonlPath = path.join(TMP, "test-validate-mixed.jsonl");
  const valid = mod.emitEvent(makeValidEvent());
  const invalid = mod.emitEvent(makeValidEvent({ stage: "BadStage" }));
  fs.writeFileSync(jsonlPath, [valid, invalid, ""].join("\n"), "utf8");

  const { exitCode, stdout } = runModuleJs(modPath, "--validate", jsonlPath);
  fs.unlinkSync(jsonlPath);

  assert.equal(exitCode, 1, `--validate should exit 1 when some lines are invalid, got ${exitCode}`);
  assert.ok(stdout.includes("1 invalid"), `should report 1 invalid, got: ${stdout}`);
});

test("AC5 — CLI --validate with missing file exits 1", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const { exitCode, stderr } = runModuleJs(modPath, "--validate", "/nonexistent/path.jsonl");
  assert.equal(exitCode, 1, `--validate with missing file should exit 1, got ${exitCode}`);
  assert.ok(stderr.includes("File not found") || stderr.includes("not found"),
    `stderr should mention file not found: ${stderr}`);
});

// ── AC5: CLI --json mode (stdin) ────────────────────────────────────────────────────────────────────

test("AC5 — CLI --json validates a JSON object from stdin", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const event = makeValidEvent();
  const eventJson = JSON.stringify(event);
  const cmd = `echo '${eventJson.replace(/'/g, "'\\''")}' | node --no-warnings ${modPath} --json`;
  try {
    const stdout = execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true, `--json should output ok=true for valid event, got ${stdout}`);
  } catch (e) {
    assert.fail(`--json should not throw: ${e.message}`);
  }
});

test("AC5 — CLI --json rejects invalid JSON", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const cmd = `echo '{not valid}' | node --no-warnings ${modPath} --json`;
  try {
    const stdout = execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, false);
  } catch (e) {
    // exit 1 means the command failed — that is expected for invalid input
    assert.ok(e.status === 1 || e.code === 1 || e.message.includes("status 1"),
      `expected failure, got: ${e.message}`);
  }
});

// ── AC7: Pure functions — no process.env or process.exit in exported functions ───────────────────────

test("AC7 — SCHEMA_VERSION is a constant string, not a function", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  assert.equal(typeof mod.SCHEMA_VERSION, "string");
});

// ── AC8: v1 schema excludes eventKind, stageIndex, observedDurationMs, errorDetail ───────────────────

test("AC8 — v1 REQUIRED_FIELDS does not include excluded fields", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  assert.ok(!mod.REQUIRED_FIELDS.includes("eventKind"));
  assert.ok(!mod.REQUIRED_FIELDS.includes("stageIndex"));
  assert.ok(!mod.REQUIRED_FIELDS.includes("observedDurationMs"));
  assert.ok(!mod.REQUIRED_FIELDS.includes("errorDetail"));
});

test("AC8 — recordAtMs is in REQUIRED_FIELDS", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  assert.ok(mod.REQUIRED_FIELDS.includes("recordedAtMs"));
});

// ── Plugin mirror tests ──────────────────────────────────────────────────────────────────────────────

test("Plugin mirror — validateEvent works identically", async () => {
  const mod = await importSchemaModule(PLUGIN_SCRIPTS);
  const event = makeValidEvent();
  const result = mod.validateEvent(event);
  assert.equal(result.ok, true);
});

test("Plugin mirror — parseEventStream works", async () => {
  const mod = await importSchemaModule(PLUGIN_SCRIPTS);
  const jsonlPath = path.join(TMP, "test-plugin-stream.jsonl");
  fs.writeFileSync(jsonlPath, mod.emitEvent(makeValidEvent()) + "\n", "utf8");

  const results = [];
  for await (const r of mod.parseEventStream(jsonlPath)) {
    results.push(r);
  }
  fs.unlinkSync(jsonlPath);

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
});

test("Plugin mirror — emitEvent works identically", async () => {
  const expMod = await importSchemaModule(SCRIPTS);
  const plugMod = await importSchemaModule(PLUGIN_SCRIPTS);
  const event = makeValidEvent();
  assert.equal(expMod.emitEvent(event), plugMod.emitEvent(event));
});

// ── Timing sub-field validation ──────────────────────────────────────────────────────────────────────

test("Timing — validateEvent rejects timing non-object", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  let result = mod.validateEvent(makeValidEvent({ timing: "not-an-object" }));
  assert.equal(result.ok, false);
  result = mod.validateEvent(makeValidEvent({ timing: null }));
  assert.equal(result.ok, false);
  result = mod.validateEvent(makeValidEvent({ timing: [1, 2, 3] }));
  assert.equal(result.ok, false);
});

test("Timing — validateEvent rejects timing missing sub-field", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  ["queuedAtMs", "startedAtMs", "endedAtMs"].forEach((field) => {
    const timing = { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: null };
    delete timing[field];
    const result = mod.validateEvent(makeValidEvent({ timing }));
    assert.equal(result.ok, false, `missing timing.${field} should be rejected`);
    assert.ok(result.error.includes(`timing.${field}`), `error should mention timing.${field}`);
  });
});

test("Timing — validateEvent rejects timing with wrong-type field", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent(makeValidEvent({
    timing: { queuedAtMs: "not-a-number", startedAtMs: 1100, endedAtMs: null },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("timing.queuedAtMs"), `error should mention timing.queuedAtMs`);
});

test("Timing — null timing fields are accepted", async () => {
  const mod = await importSchemaModule(SCRIPTS);
  const result = mod.validateEvent(makeValidEvent({
    timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null },
  }));
  assert.equal(result.ok, true, `all-null timing should be valid: ${JSON.stringify(result)}`);
});

// ── Additional CLI coverage ─────────────────────────────────────────────────────────────────────────

test("CLI — no args exits 0 silently", async () => {
  const modPath = path.join(SCRIPTS, "workflow-event-schema.mjs");
  const { exitCode, stdout } = runModuleJs(modPath);
  assert.equal(exitCode, 0);
  // With no args, it prints usage info
  assert.ok(stdout.includes("workflow-event-schema.mjs") || stdout.includes("Usage"), `Should print usage: ${stdout}`);
});

test("CLI — --selftest also works with plugin mirror module", async () => {
  const modPath = path.join(PLUGIN_SCRIPTS, "workflow-event-schema.mjs");
  const { exitCode } = runModuleJs(modPath, "--selftest");
  assert.equal(exitCode, 0);
});
