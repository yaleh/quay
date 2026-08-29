// @test-group governance
// outer-driver.test.mjs — AC143 (tasks/gap-ac143-observability-ledger-closing-driver): the outer's
// PURE-MECHANICAL A/B segments absorbed into a routine-type driver (Layer 0 + 1b, ⛔ not 1a).
//
//   AC3 (registry 表驱动): the "outer" kind is registered in DRIVER_KINDS (KIND_* tables → one TS
//     data structure) — grep-able, ⛔ not a separate second implementation.
//   AC1 (生产载体能取假): runResidentOuterLoop writes a round record (with facts) to
//     .quay/outer-round.jsonl every round — the carrier is produced by actually RUNNING the loop,
//     ⛔ not by a fixture.
//   AC153 (Layer 1b form): a routine that cannot read its input produces a not-evaluated Fact
//     (⛔ 与「合格」不同形), not a verified one.
//
// Run: scripts/test.sh plugin/test/outer-driver.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DRIVER_KINDS, KNOWN_KINDS } from "../scripts/driver-runtime.ts";
import {
  ROUND_LOG_REL,
  OUTER_CONTROL_STATE_REL,
  EVERY_ROUND,
  parseMonitorMount,
  parseNotYetFlipped,
  parseSlotRefill,
  parseJudgmentConsumer,
  parseClosureTerminal,
  computeSelfStop,
  computeOuterRoundRecord,
  outerRoutines,
  runResidentOuterLoop,
  monitorMountRoutine,
  notYetFlippedRoutine,
  judgmentConsumerRoutine,
} from "../scripts/outer-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _createdDirs = [];
function makeRoot(tag) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), `outer-${tag}-`));
  _createdDirs.push(created);
  return created;
}

// ── AC3：registry 表驱动（outer kind 经 DRIVER_KINDS 加一行接入） ─────────────────────────────

test("AC3: outer kind is registered in DRIVER_KINDS (single registry table)", () => {
  assert.ok(KNOWN_KINDS.includes("outer"), "KNOWN_KINDS should include outer");
  const spec = DRIVER_KINDS.outer;
  assert.equal(spec.driver, "outer-driver.ts");
  assert.equal(spec.prefix, "outer-driver");
  assert.deepEqual(spec.verbs, ["start", "stop", "drain", "status", "restart", "liveness"]);
  assert.equal(spec.hasInterval, true);
  assert.equal(spec.hasReconcile, false);
  assert.equal(spec.carriers[0], "outer-round.jsonl");
  assert.equal(spec.controlFile, "outer-control.json");
});

// ── 纯函数（可单测） ────────────────────────────────────────────────────────────────────────────

test("parseMonitorMount: parses mounted/targetOk; malformed ⇒ null", () => {
  assert.deepEqual(parseMonitorMount('{"mounted":true,"targetOk":true}'), { mounted: true, targetOk: true });
  assert.equal(parseMonitorMount("not json"), null);
});

test("parseNotYetFlipped: counts excluded[] not-yet-flipped entries", () => {
  const text = JSON.stringify({
    pool: 32,
    excluded: [
      { id: "a", reasons: ["not-yet-flipped"] },
      { id: "b", reasons: ["other"] },
      { id: "c", reasons: ["not-yet-flipped"] },
    ],
  });
  assert.deepEqual(parseNotYetFlipped(text), { nyf: 2, pool: 32 });
  assert.equal(parseNotYetFlipped("nope"), null);
});

test("parseSlotRefill: extracts refill + occupancy fields", () => {
  const text = JSON.stringify({ should_refill: true, recommended: ["x"], slots_free: 2, effective_cap: 5, in_flight_count: 3, occupied_slots: 1 });
  const v = parseSlotRefill(text);
  assert.equal(v.shouldRefill, true);
  assert.deepEqual(v.recommended, ["x"]);
  assert.equal(v.slotsFree, 2);
  assert.equal(v.inFlight, 3);
  assert.equal(parseSlotRefill("nope"), null);
});

test("parseJudgmentConsumer: extracts wired/unfinished/drift", () => {
  const v = parseJudgmentConsumer(JSON.stringify({ wired: 6, unfinished: ["deficit"], drift: false }));
  assert.deepEqual(v, { wired: 6, unfinished: ["deficit"], drift: false });
  assert.equal(parseJudgmentConsumer("nope"), null);
});

test("computeSelfStop: resets on progress, trips at 3 consecutive no-progress rounds", () => {
  assert.deepEqual(computeSelfStop(0, true), { counter: 0, shouldStop: false });
  assert.deepEqual(computeSelfStop(0, false), { counter: 1, shouldStop: false });
  assert.deepEqual(computeSelfStop(1, false), { counter: 2, shouldStop: false });
  assert.deepEqual(computeSelfStop(2, false), { counter: 3, shouldStop: true });
  assert.deepEqual(computeSelfStop(2, true), { counter: 0, shouldStop: false });
});

test("parseClosureTerminal: extracts scanned + closed count", () => {
  assert.deepEqual(parseClosureTerminal('{"scanned":0,"closed":[],"skipped":[]}'), { scanned: 0, closed: 0 });
  assert.deepEqual(
    parseClosureTerminal('{"scanned":3,"closed":[{"taskId":"a"},{"taskId":"b"}],"skipped":[]}'),
    { scanned: 3, closed: 2 },
  );
  assert.equal(parseClosureTerminal("nope"), null);
});

// ── AC153（Layer 1b form）：读不到输入 ⇒ not-evaluated，⛔ 不是 verified ───────────────────────

test("monitorMountRoutine: unreadable command ⇒ not-evaluated (not verified)", () => {
  const routine = monitorMountRoutine(makeRoot("mm"), ["false"]);
  const facts = routine();
  assert.equal(facts.length, 1);
  assert.equal(facts[0].name, "monitor_mount");
  assert.equal(facts[0].state, "not-evaluated");
});

test("judgmentConsumerRoutine: unreadable command ⇒ not-evaluated (not verified)", () => {
  const routine = judgmentConsumerRoutine(makeRoot("jc"), ["false"]);
  const facts = routine();
  assert.equal(facts[0].state, "not-evaluated");
});

test("notYetFlippedRoutine: unreadable ready-pool ⇒ not-evaluated (not verified)", () => {
  const routine = notYetFlippedRoutine(makeRoot("nyf"), ["false"]);
  const facts = routine();
  assert.equal(facts[0].state, "not-evaluated");
});

// ── 例程表 ────────────────────────────────────────────────────────────────────────────────────────

test("outerRoutines: assembles the 10 mechanical routines (each every-round)", () => {
  // 10 routines — the former A3 halt_status routine was retired with gap-retire-halt-file-driver-based
  // (the .halt read moved to the driver control-state; A21 liveness_direct carries the driver-liveness
  // stall read). B12 自身停止条件是跨轮有状态的计数（counter 跨轮），住在循环体里，⛔ 不是无状态例程。
  const routines = outerRoutines(makeRoot("tbl"));
  assert.equal(routines.length, 10);
  const names = routines.map((r) => r.name);
  for (const expected of [
    "monitor_mount", "occupancy", "not_yet_flipped", "closure_lag", "slot_refill",
    "liveness_direct", "closure_pass", "closure_record", "telemetry_snapshot", "judgment_consumer",
  ]) {
    assert.ok(names.includes(expected), `routine table should include ${expected}`);
  }
  for (const r of routines) assert.deepEqual(r.schedule, EVERY_ROUND);
});

// ── AC1：生产载体（跑循环 ⇒ 写 carrier 记录，⛔ fixture 不回显） ─────────────────────────────

test("runResidentOuterLoop --once writes one round record with facts to the carrier", async () => {
  const root = makeRoot("loop");
  const roundLog = path.join(root, ROUND_LOG_REL);
  const routines = [
    { name: "fake_a", schedule: EVERY_ROUND, run: () => [{ name: "fake_a", value: 1, state: "verified", reason: null }] },
    { name: "fake_b", schedule: EVERY_ROUND, run: () => [{ name: "fake_b", value: null, state: "not-evaluated", reason: "unreadable" }] },
  ];
  const code = await runResidentOuterLoop({
    root, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog, runId: "test-run", json: false, routines,
  });
  assert.equal(code, 0);
  const lines = fs.readFileSync(roundLog, "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "one round ⇒ one carrier record");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.round, 1);
  assert.equal(rec.run_id, "test-run");
  assert.equal(rec.action, "facts");
  assert.equal(rec.halted, false);
  const names = rec.facts.map((f) => f.name);
  assert.ok(names.includes("fake_a") && names.includes("fake_b") && names.includes("self_stop"));
});

test("runResidentOuterLoop writes a halted round when control state is halted", async () => {
  const root = makeRoot("halt");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, OUTER_CONTROL_STATE_REL), JSON.stringify({ schemaVersion: 1, halted: true }), "utf8");
  const roundLog = path.join(root, ROUND_LOG_REL);
  const code = await runResidentOuterLoop({
    root, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog, runId: "test-run", json: false, routines: [],
  });
  assert.equal(code, 0);
  const rec = JSON.parse(fs.readFileSync(roundLog, "utf8").trim());
  assert.equal(rec.action, "halted");
  assert.equal(rec.halted, true);
});

test("computeOuterRoundRecord: maps error/halted/facts actions", () => {
  const base = { round: 1, runId: "r", pid: 1, at: "2026-01-01T00:00:00Z", facts: [] };
  assert.equal(computeOuterRoundRecord({ ...base, halted: false, error: null }).action, "facts");
  assert.equal(computeOuterRoundRecord({ ...base, halted: true, error: null }).action, "halted");
  assert.equal(computeOuterRoundRecord({ ...base, halted: false, error: "boom" }).action, "error");
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
