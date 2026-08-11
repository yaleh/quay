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
//       tests + CLI exit-code tests (fresh ⇒ 0, stale/missing/malformed/fields-missing ⇒ 1);
//   (b) the DOC-CONTRACT wiring — fast-mode-tick-core.md B3 + fast-mode-loop-tick.md step 6 must carry
//       the WRITE instruction (inner writes the product on every reschedule), and
//       orchestrator-tick-core.md A 段 must carry the READ+judge invocation.
//
// Field-contract extension (tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract): since
// 2026-08-11 the checker ALSO enforces the minimal field contract (AC2) — a FRESH heartbeat must carry
// the structured keys ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds; missing
// key ⇒ "心跳字段缺失" + exit 1. reason prose may supplement but never replace the structured fields
// (AC3). The CLI fixtures therefore use the FULL structured shape (fullHeartbeat) for ALIVE cases, and
// the shrunk 3-key shape is the RED case — it is the exact defect this task fixes.
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
  FIELDS_MISSING_REASON,
  HEARTBEAT_FILE,
  MALFORMED,
  parseHeartbeat,
  judgeHeartbeat,
  readHeartbeatText,
  checkFieldContract,
  REQUIRED_HEARTBEAT_FIELDS,
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

// ── minimal field contract (AC2/AC3 — tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract) ─

test("AC2 — REQUIRED_HEARTBEAT_FIELDS = the Contract's 7 structured keys (heartbeat_field_count >= 7)", () => {
  assert.deepEqual(REQUIRED_HEARTBEAT_FIELDS, [
    "ts", "runIds", "blocked", "budgetHit", "effectiveCap", "agentDispatches", "delaySeconds",
  ]);
  assert.equal(REQUIRED_HEARTBEAT_FIELDS.length, 7);
});

test("AC2 — checkFieldContract passes a full-shape heartbeat (all 7 required keys present)", () => {
  const c = checkFieldContract(fullHeartbeat());
  assert.equal(c.ok, true, `full shape must satisfy the contract:\n${JSON.stringify(c)}`);
  assert.equal(c.requiredPresent, 7);
  assert.deepEqual(c.missing, []);
  assert.deepEqual(c.wrongType, []);
  assert.ok(c.fieldCount >= 7, `fieldCount ${c.fieldCount} must be >= 7`);
});

test("AC2 — checkFieldContract flags a heartbeat missing blocked[] (A3 判卡住的前提)", () => {
  const { blocked, ...withoutBlocked } = fullHeartbeat(); // omit the key entirely (undefined ≠ missing)
  const c = checkFieldContract(withoutBlocked);
  assert.equal(c.ok, false);
  assert.ok(c.missing.includes("blocked"), `blocked must be reported missing:\n${JSON.stringify(c.missing)}`);
  assert.equal(c.requiredPresent, 6);
});

test("AC2 — checkFieldContract flags missing runIds + effectiveCap together", () => {
  const { runIds, effectiveCap, ...without } = fullHeartbeat();
  const c = checkFieldContract(without);
  assert.equal(c.ok, false);
  assert.ok(c.missing.includes("runIds"), "runIds must be reported missing");
  assert.ok(c.missing.includes("effectiveCap"), "effectiveCap must be reported missing");
});

test("AC3 — prose does NOT replace the structured fields: a {ts, delaySeconds, reason} heartbeat is RED", () => {
  // The exact 2026-08-11 05:20 shrink — fresh (ts present) but missing every structured key.
  const c = checkFieldContract({ ts: 1786349702, delaySeconds: 1500, reason: "tick heartbeat" });
  assert.equal(c.ok, false, "reason prose must not substitute for structured fields");
  for (const f of ["runIds", "blocked", "budgetHit", "effectiveCap", "agentDispatches"]) {
    assert.ok(c.missing.includes(f), `${f} must be missing`);
  }
  assert.equal(c.requiredPresent, 2, "only ts + delaySeconds are present");
});

test("AC2 — checkFieldContract flags a wrong-typed blocked (string instead of array)", () => {
  const c = checkFieldContract(fullHeartbeat({ blocked: "not-an-array" }));
  assert.equal(c.ok, false);
  assert.ok(c.wrongType.includes("blocked"), `blocked must be wrongType:\n${JSON.stringify(c.wrongType)}`);
});

test("AC2 — checkFieldContract on null/missing heartbeat reports ALL required fields missing", () => {
  const c = checkFieldContract(null);
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, REQUIRED_HEARTBEAT_FIELDS);
  assert.equal(c.fieldCount, 0);
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

/** Full contract-compliant heartbeat (the shape the writer must produce since 2026-08-11). */
function fullHeartbeat(overrides = {}) {
  return {
    ts: Math.floor(Date.now() / 1000),
    runIds: ["run-1"],
    blocked: [],
    budgetHit: false,
    effectiveCap: 3,
    agentDispatches: 1,
    delaySeconds: 1500,
    reason: "tick heartbeat",
    ...overrides,
  };
}

test("AC3 CLI — fresh full-shape heartbeat exits 0 (ALIVE)", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat());
  try {
    const r = runCli(root);
    assert.equal(r.status, 0, `fresh full-shape heartbeat must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /ALIVE/, "stdout must say ALIVE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 CLI — stale heartbeat exits 1 and names 兜底心跳断", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: Math.floor(Date.now() / 1000) - 9999 }));
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
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: Math.floor(Date.now() / 1000) - 10000 }));
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
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: Math.floor(Date.now() / 1000) - 7000 }));
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

test("AC2 CLI — fresh but field-shrunk (3 keys, the 2026-08-11 05:20 defect) exits 1 with 心跳字段缺失", () => {
  const root = makeRootWithHeartbeat({
    ts: Math.floor(Date.now() / 1000),
    delaySeconds: 1500,
    reason: "tick heartbeat",
  });
  try {
    const r = runCli(root);
    assert.equal(r.status, 1, `field-shrunk fresh heartbeat must exit 1:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /心跳字段缺失/, "the verdict must name 心跳字段缺失");
    assert.match(r.stdout, /blocked\(缺失\)/, "blocked must be named as missing");
    assert.match(r.stdout, /runIds\(缺失\)/, "runIds must be named as missing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI --json — fields-missing carries status + missing list", () => {
  const root = makeRootWithHeartbeat({
    ts: Math.floor(Date.now() / 1000),
    delaySeconds: 1500,
    reason: "tick heartbeat",
  });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, "field-shrunk must exit 1 even in --json mode");
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "fields-missing");
    assert.equal(out.reason, FIELDS_MISSING_REASON);
    assert.ok(out.fieldContract.missing.includes("blocked"), "blocked must be in fieldContract.missing");
    assert.ok(out.fieldContract.missing.includes("runIds"), "runIds must be in fieldContract.missing");
    assert.ok(out.fieldContract.fieldCount <= 3, `fieldCount ${out.fieldContract.fieldCount} must be the shrunk 3`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI --json — a full-shape fresh heartbeat is ALIVE with fieldContract.ok true", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat());
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 0, `full-shape heartbeat must exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.status, "alive");
    assert.equal(out.fieldContract.ok, true);
    assert.ok(out.fieldContract.fieldCount >= 7, `fieldCount ${out.fieldContract.fieldCount} must be >= 7`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI — stale heartbeat stays the stale verdict (freshness precedes field contract)", () => {
  // A stale + shrunk heartbeat reports 兜底心跳断 (the dead verdict), not fields-missing.
  const root = makeRootWithHeartbeat({
    ts: Math.floor(Date.now() / 1000) - 9999,
    delaySeconds: 1500,
    reason: "tick heartbeat",
  });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "stale");
    assert.equal(out.reason, "inner-wakeup-heartbeat-dead");
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

// ── field-contract doc wiring (AC2/AC3 — the writer is now a SCRIPT, not an inline python one-liner) ─

test("AC2 wiring — inner execution core B3 names the writer script inner-wakeup-heartbeat.ts (not hand-rolled python)", () => {
  const core = fs.readFileSync(path.join(repoRoot, "orchestration", "fast-mode-tick-core.md"), "utf8");
  assert.match(core, /B3\s+重新排程[\s\S]*inner-wakeup-heartbeat\.ts/, "B3 must carry the writer script invocation");
  assert.match(core, /不手搓 python/, "B3 must forbid the hand-rolled python one-liner (the drift source)");
});

test("AC2/AC3 wiring — inner execution core B3 carries the minimal field contract (blocked[]/runIds + 心跳字段缺失)", () => {
  const core = fs.readFileSync(path.join(repoRoot, "orchestration", "fast-mode-tick-core.md"), "utf8");
  const b3Section = core.split("\n").filter((l) => l.includes("B3"));
  const b3Text = b3Section.join("\n");
  assert.match(b3Text, /blocked\[\]/, "B3 must name blocked[] (A3 判卡住的前提)");
  assert.match(b3Text, /runIds/, "B3 must name runIds");
  assert.match(b3Text, /心跳字段缺失/, "B3 must name the 心跳字段缺失 red verdict");
  assert.match(b3Text, /reason 散文可补充不可替代/, "B3 must carry the AC3 prose-does-not-replace clause");
});

test("AC2/AC3 wiring — source tick doc step 6 carries the writer script + field contract + prose-does-not-replace", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  const lines = doc.split("\n");
  const headingIdx = lines.findIndex((l) => /^### 6\. 重新排程/.test(l));
  assert.ok(headingIdx !== -1, "step 6 heading must exist");
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^(###|##) /.test(lines[i])) { end = i; break; }
  }
  const step6Section = lines.slice(headingIdx, end).join("\n");
  assert.match(step6Section, /inner-wakeup-heartbeat\.ts/, "step 6 must invoke the writer script");
  assert.match(step6Section, /blocked/, "step 6 must name the blocked[] structured key");
  assert.match(step6Section, /runIds/, "step 6 must name runIds");
  assert.match(step6Section, /心跳字段缺失/, "step 6 must name the 心跳字段缺失 red verdict");
  assert.match(step6Section, /reason 散文可补充但不可替代/, "step 6 must carry the AC3 prose clause");
});
