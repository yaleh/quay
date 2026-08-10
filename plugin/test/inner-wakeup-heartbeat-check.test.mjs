// @test-group governance
// inner-wakeup-heartbeat-check.test.mjs — inner 兜底心跳产物检查器（外层读）
// (tasks/gap-inner-wakeup-heartbeat-invisible)
//
// The defect: ScheduleWakeup reschedule (inner's FALLBACK heartbeat) lived only inside the inner
// transcript — a 15.3h-dead heartbeat (last 2026-08-09T15:17:27Z) was invisible until a human asked
// a third time and the manager grepped the transcript for ScheduleWakeup tool_use timestamps.
// C17 (rules need PRODUCTS, not visibility): "the last ScheduleWakeup moment" needs a
// mechanically-readable, checkable product. Fix: inner writes `.quay/inner-wakeup-heartbeat.json`
// ({ts, delaySeconds, reason}) every time it reschedules ScheduleWakeup (same shape as
// suite-chain-heartbeat.json, the A2 heartbeat precedent); the OUTER tick reads it and judges
// freshness (age > 3 tick periods ⇒ "inner 兜底心跳断" + escalate).
//
// This file pins BOTH:
//   (a) the checker's LOGIC (plugin/scripts/inner-wakeup-heartbeat-check.ts) — hermetic pure-function
//       tests + CLI exit-code tests (fresh ⇒ 0, stale/missing/malformed ⇒ 1);
//   (b) the DOC-CONTRACT wiring — fast-mode-tick-core.md B3 + fast-mode-loop-tick.md step 6 must carry
//       the WRITE instruction (inner writes the product on every reschedule), and
//       orchestrator-tick-core.md A 段 must carry the READ+judge invocation.
//
// Run:
//   scripts/test.sh plugin/test/inner-wakeup-heartbeat-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  DEFAULT_MAX_AGE_SECS,
  HEARTBEAT_FILE,
  MALFORMED,
  parseHeartbeat,
  judgeHeartbeat,
  readHeartbeatText,
} from "../scripts/inner-wakeup-heartbeat-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "inner-wakeup-heartbeat-check.ts");

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("judgeHeartbeat — fresh heartbeat is ALIVE (AC3: 判新鲜)", () => {
  const v = judgeHeartbeat(1000, { ts: 900 }, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, true);
  assert.equal(v.status, "alive");
  assert.equal(v.ageSecs, 100);
  assert.equal(v.reason, "heartbeat-fresh");
});

test("judgeHeartbeat — exactly at the boundary (age == max) is still ALIVE", () => {
  const v = judgeHeartbeat(5400, { ts: 0 }, 5400);
  assert.equal(v.alive, true, "age == max-age must not trip the dead verdict");
  assert.equal(v.ageSecs, 5400);
});

test("judgeHeartbeat — age > 3 tick periods (5400s) ⇒ DEAD / inner 兜底心跳断 (AC3)", () => {
  const v = judgeHeartbeat(5401, { ts: 0 }, 5400);
  assert.equal(v.alive, false);
  assert.equal(v.status, "stale");
  assert.equal(v.ageSecs, 5401);
  assert.equal(v.reason, "inner-wakeup-heartbeat-dead");
});

test("judgeHeartbeat — future ts (clock skew) clamps to 0 = ALIVE, not a false dead", () => {
  const v = judgeHeartbeat(100, { ts: 200 }, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, true);
  assert.equal(v.ageSecs, 0);
});

test("judgeHeartbeat — missing heartbeat ⇒ DEAD (fail-closed, product absence IS the failure) (AC3)", () => {
  const v = judgeHeartbeat(1000, null, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, false);
  assert.equal(v.status, "missing");
  assert.equal(v.reason, "inner-wakeup-heartbeat-missing");
});

test("judgeHeartbeat — malformed heartbeat (no valid ts) ⇒ DEAD (AC3 fail-closed)", () => {
  assert.equal(judgeHeartbeat(1000, MALFORMED, DEFAULT_MAX_AGE_SECS).alive, false);
  assert.equal(judgeHeartbeat(1000, MALFORMED, DEFAULT_MAX_AGE_SECS).status, "malformed");
  // Direct call with a non-conforming object is treated as malformed too.
  const v = judgeHeartbeat(1000, { delaySeconds: 1500 }, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, false);
  assert.equal(v.status, "malformed");
});

test("parseHeartbeat — parses the documented {ts, delaySeconds, reason} shape (AC2 schema)", () => {
  const v = parseHeartbeat('{"ts":1786349702,"delaySeconds":1500,"reason":"tick heartbeat"}');
  assert.deepEqual(v, { ts: 1786349702, delaySeconds: 1500, reason: "tick heartbeat" });
  assert.equal(parseHeartbeat(null), null, "missing text → null");
  assert.equal(parseHeartbeat(""), null, "empty text → null");
  assert.equal(parseHeartbeat("{ not json"), MALFORMED, "unparsable → MALFORMED");
  assert.equal(parseHeartbeat('{"delaySeconds":1500}'), MALFORMED, "missing ts → MALFORMED");
});

test("DEFAULT_MAX_AGE_SECS = 3 tick periods × 1800s (Contract band `<= 5400`)", () => {
  assert.equal(DEFAULT_MAX_AGE_SECS, 3 * 1800);
});

// ── CLI integration (spawn the real checker against a temp workspace) ───────────────────────────────

function runCli(root, extra = []) {
  const args = ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, ...extra];
  return spawnSync("node", args, { encoding: "utf8" });
}

function makeRootWithHeartbeat(heartbeatObjOrText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-"));
  const quayDir = path.join(tmp, ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  const p = path.join(quayDir, HEARTBEAT_FILE);
  const text = typeof heartbeatObjOrText === "string" ? heartbeatObjOrText : JSON.stringify(heartbeatObjOrText);
  fs.writeFileSync(p, text, "utf8");
  return tmp;
}

test("AC3 CLI — fresh heartbeat exits 0 (ALIVE)", () => {
  const now = Math.floor(Date.now() / 1000);
  const root = makeRootWithHeartbeat({ ts: now, delaySeconds: 1500, reason: "tick heartbeat" });
  try {
    const r = runCli(root);
    assert.equal(r.status, 0, `fresh heartbeat must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /ALIVE/, "stdout must say ALIVE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 CLI — stale heartbeat exits 1 and names 兜底心跳断", () => {
  const root = makeRootWithHeartbeat({ ts: Math.floor(Date.now() / 1000) - 9999, delaySeconds: 1500, reason: "tick heartbeat" });
  try {
    const r = runCli(root);
    assert.equal(r.status, 1, `stale heartbeat must exit 1:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /inner 兜底心跳断/, "the dead verdict must carry the 兜底心跳断 phrase");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 CLI — missing file exits 1 (fail-closed)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-missing-"));
  try {
    const r = runCli(tmp);
    assert.equal(r.status, 1, `missing heartbeat must exit 1:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /MISSING/, "missing verdict must be explicit");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC3 CLI — custom --max-age-secs makes an old heartbeat ALIVE when under the band", () => {
  const now = Math.floor(Date.now() / 1000);
  const root = makeRootWithHeartbeat({ ts: now - 10000, delaySeconds: 1500, reason: "tick heartbeat" });
  try {
    const r = runCli(root, ["--max-age-secs", "20000", "--json"]);
    assert.equal(r.status, 0, `heartbeat under a wider band must exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.maxAgeSecs, 20000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI — --json emits machine-readable verdict", () => {
  const now = Math.floor(Date.now() / 1000);
  const root = makeRootWithHeartbeat({ ts: now - 7000, delaySeconds: 1500, reason: "tick heartbeat" });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, "stale → exit 1 even in --json mode");
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "stale");
    assert.equal(out.maxAgeSecs, DEFAULT_MAX_AGE_SECS);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── doc-contract wiring (AC4: inner B3 + outer A 段必读) ───────────────────────────────────────────

test("AC4 wiring — inner execution core B3 (orchestration/fast-mode-tick-core.md) says every reschedule writes the heartbeat product", () => {
  const core = fs.readFileSync(path.join(repoRoot, "orchestration", "fast-mode-tick-core.md"), "utf8");
  // The B3 重新排程 line must name the product AND the write trigger.
  assert.match(core, /B3\s+重新排程[\s\S]*inner-wakeup-heartbeat\.json/, "B3 must carry the heartbeat product write");
  const b3Section = core.split("\n").filter((l) => l.includes("B3") && l.includes("inner-wakeup-heartbeat"));
  assert.ok(b3Section.length >= 1, "a B3 line must tie ScheduleWakeup reschedule to writing inner-wakeup-heartbeat.json");
  assert.ok(b3Section.some((l) => /每次重排|每次重新排程/.test(l)), "the write must be EVERY reschedule, not optional");
});

test("AC4 wiring — source tick doc step 6 (plugin/loop/fast-mode-loop-tick.md) says every reschedule writes the heartbeat product", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  // Step 6 重新排程 must carry the write instruction with the product name + the ts/delaySeconds/reason schema.
  const lines = doc.split("\n");
  const headingIdx = lines.findIndex((l) => /^### 6\. 重新排程/.test(l));
  assert.ok(headingIdx !== -1, "step 6 heading must exist");
  // The step-6 section runs to the next heading (### / ##) — the heartbeat write must live in it.
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^(###|##) /.test(lines[i])) { end = i; break; }
  }
  const step6Section = lines.slice(headingIdx, end).join("\n");
  assert.match(step6Section, /inner-wakeup-heartbeat\.json/, "step 6 must carry the heartbeat product write");
  assert.match(step6Section, /每次重排/, "the write must be EVERY reschedule, not optional");
  assert.match(step6Section, /delaySeconds|ts|reason/, "the write must name the {ts, delaySeconds, reason} schema");
});

test("AC4 wiring — outer execution core A 段 (orchestration/orchestrator-tick-core.md) must READ+judge the heartbeat product", () => {
  const outer = fs.readFileSync(path.join(repoRoot, "orchestration", "orchestrator-tick-core.md"), "utf8");
  assert.match(outer, /inner-wakeup-heartbeat-check\.ts/, "the outer A 段 must invoke the checker");
  const aSectionLines = outer.split("\n").filter((l) => l.includes("inner-wakeup-heartbeat"));
  assert.ok(aSectionLines.length >= 1, "the outer A 段 must carry the heartbeat product read");
  assert.ok(aSectionLines.some((l) => /3\s*个 tick 周期|3\s*周期|5400/.test(l)), "the freshness band must be 3 tick periods");
  assert.ok(aSectionLines.some((l) => /兜底心跳断/.test(l)), "the escalation phrase 兜底心跳断 must be named");
});

test("AC2/AC4 — cross-reference to the same-family task (gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release)", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  assert.match(doc, /gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release/, "the tick doc must carry the same-family cross-reference");
  const sibling = fs.readFileSync(
    path.join(repoRoot, "tasks", "gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md"),
    "utf8",
  );
  assert.match(sibling, /gap-inner-wakeup-heartbeat-invisible/, "the sibling task must carry the cross-annotation back");
});
