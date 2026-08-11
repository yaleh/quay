// @test-group governance
// inner-wakeup-heartbeat.test.mjs — inner 兜底心跳写入方（结构化字段）
// (tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract)
//
// The defect: 2026-08-11 05:20 the heartbeat shrank to 3 keys ({ts, delaySeconds, reason}) because the
// writer was an inline python one-liner in the tick-core docs that silently drifted. Manager A3's
// premise is that `.quay/inner-wakeup-heartbeat.json` is the ONLY product answering "what does inner
// need" — without blocked[] the outer cannot tell whether inner is stuck (hard rule 6: absent key =
// not-checked, ≠ no-block). This task replaces the prose writer with a REAL SCRIPT
// (plugin/scripts/inner-wakeup-heartbeat.ts) that writes the FULL structured field set, FAIL-CLOSED:
// it refuses to write a heartbeat missing the checker's required fields, so a shrunk write is
// impossible by construction.
//
// This file pins the WRITER's logic:
//   (a) buildHeartbeat — pure object construction from structured fields;
//   (b) fail-closed write — missing blocked[]/runIds/etc ⇒ exit 1, NOTHING written;
//   (c) write→check round-trip — a file the writer writes satisfies the CHECKER's minimal field
//       contract (inner-wakeup-heartbeat-check.ts) and exits 0.
//
// Run:
//   scripts/test.sh plugin/test/inner-wakeup-heartbeat.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { REQUIRED_HEARTBEAT_FIELDS } from "../scripts/inner-wakeup-heartbeat-check.ts";
import { buildHeartbeat, parseJsonArg } from "../scripts/inner-wakeup-heartbeat.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const WRITER = path.join(repoRoot, "plugin", "scripts", "inner-wakeup-heartbeat.ts");
const CHECKER = path.join(repoRoot, "plugin", "scripts", "inner-wakeup-heartbeat-check.ts");

// ── pure: buildHeartbeat ──────────────────────────────────────────────────────────────────────────────

test("buildHeartbeat — builds the full structured shape with ts = nowSec", () => {
  const hb = buildHeartbeat({
    nowSec: 1000,
    blocked: [],
    runIds: ["run-1"],
    effectiveCap: 3,
    agentDispatches: 1,
    budgetHit: false,
  });
  assert.equal(hb.ts, 1000);
  assert.deepEqual(hb.blocked, []);
  assert.deepEqual(hb.runIds, ["run-1"]);
  assert.equal(hb.effectiveCap, 3);
  assert.equal(hb.agentDispatches, 1);
  assert.equal(hb.budgetHit, false);
  assert.equal(hb.delaySeconds, 1500, "delaySeconds defaults to 1500");
  assert.equal(hb.reason, "tick heartbeat", "reason defaults");
  for (const f of REQUIRED_HEARTBEAT_FIELDS) {
    assert.ok(f in hb, `required field ${f} must be present`);
  }
});

test("buildHeartbeat — carries supplemental fields (agentLimit/budgetCritical/reason) when provided", () => {
  const hb = buildHeartbeat({
    nowSec: 1,
    blocked: [],
    runIds: [],
    effectiveCap: 3,
    agentDispatches: 0,
    budgetHit: false,
    agentLimit: 200,
    budgetCritical: true,
    reason: "BUDGET HIT — awaiting outer /clear",
  });
  assert.equal(hb.agentLimit, 200);
  assert.equal(hb.budgetCritical, true);
  assert.equal(hb.reason, "BUDGET HIT — awaiting outer /clear");
});

test("buildHeartbeat — omitting a required field leaves it ABSENT (so the contract check can flag it)", () => {
  const hb = buildHeartbeat({
    nowSec: 1,
    blocked: undefined,
    runIds: [],
    effectiveCap: 3,
    agentDispatches: 0,
    budgetHit: false,
  });
  assert.ok(!("blocked" in hb), "blocked must be absent when not provided");
});

// ── pure: parseJsonArg ───────────────────────────────────────────────────────────────────────────────

test("parseJsonArg — parses JSON arrays/numbers/booleans", () => {
  assert.deepEqual(parseJsonArg("[]", "--blocked"), []);
  assert.deepEqual(parseJsonArg('["a","b"]', "--run-ids"), ["a", "b"]);
  assert.equal(parseJsonArg("3", "--effective-cap"), 3);
  assert.equal(parseJsonArg("true", "--budget-hit"), true);
});

test("parseJsonArg — rejects malformed JSON", () => {
  assert.throws(() => parseJsonArg("not-json", "--blocked"), /must be valid JSON/);
  assert.throws(() => parseJsonArg("", "--blocked"), /requires a value/);
});

// ── CLI: write + fail-closed ─────────────────────────────────────────────────────────────────────────

function runWriter(root, args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", WRITER, "--root", root, ...args], { encoding: "utf8" });
}

function runChecker(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json"], { encoding: "utf8" });
}

const FULL_ARGS = [
  "--blocked", "[]",
  "--run-ids", '["run-1"]',
  "--effective-cap", "3",
  "--agent-dispatches", "1",
  "--budget-hit", "false",
  "--delay-seconds", "1500",
  "--reason", "tick heartbeat",
];

test("AC2 CLI — writer writes a full-shape heartbeat (>= 7 keys) and exits 0", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-w-"));
  try {
    const r = runWriter(tmp, FULL_ARGS);
    assert.equal(r.status, 0, `writer must exit 0:\n${r.stdout}\n${r.stderr}`);
    const hb = JSON.parse(fs.readFileSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.json"), "utf8"));
    assert.ok(Object.keys(hb).length >= 7, `field count ${Object.keys(hb).length} must be >= 7`);
    for (const f of REQUIRED_HEARTBEAT_FIELDS) assert.ok(f in hb, `required field ${f} must be written`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 round-trip — a heartbeat the WRITER writes passes the CHECKER (exit 0 ALIVE)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-rt-"));
  try {
    const w = runWriter(tmp, FULL_ARGS);
    assert.equal(w.status, 0, `writer must exit 0:\n${w.stdout}\n${w.stderr}`);
    const c = runChecker(tmp);
    assert.equal(c.status, 0, `checker must accept the writer's output:\n${c.stdout}\n${c.stderr}`);
    const out = JSON.parse(c.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.status, "alive");
    assert.equal(out.fieldContract.ok, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 fail-closed — writer REFUSES (exit 1) a heartbeat missing blocked[], writes NOTHING", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-fc-"));
  try {
    // Drop "--blocked" AND its value (FULL_ARGS[0] / FULL_ARGS[1]).
    const args = FULL_ARGS.filter((_, i) => i !== 0 && i !== 1);
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `missing blocked must be refused:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /心跳字段缺失/, "the refusal must name 心跳字段缺失");
    assert.match(r.stderr, /blocked\(缺失\)/, "blocked must be named as missing");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.json")), "nothing must be written on refusal");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 fail-closed — writer REFUSES a wrong-typed blocked (string), writes NOTHING", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-fc2-"));
  try {
    const args = [...FULL_ARGS];
    args[1] = '"not-an-array"'; // JSON string literal → parseJsonArg yields the string "not-an-array"
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `wrong-typed blocked must be refused:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /blocked\(类型错\)/, "blocked must be named as wrong-type");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.json")), "nothing must be written on refusal");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
