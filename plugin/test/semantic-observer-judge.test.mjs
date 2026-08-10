// @test-group governance
// semantic-observer-judge.test.mjs — inner/outer 语义观测器 judge
// (tasks/gap-semantic-observer-judge-stopped-awaiting)
//
// The defect (2026-08-10 活体实证): schema 结构化字段只能承载「预先想到的」需求类型；真实需求溢出到
// 自由文本，机械读数看不见。`.quay/inner-wakeup-heartbeat.json` 两次写入：
//   - 结构化字段: blocked=[] + budgetHit=true + agentDispatches=201/agentLimit=200 ⇒ 「无阻塞、预算触顶」
//   - 自由文本 reason: 逐字「BUDGET HIT (200/200, dispatch stopped, awaiting outer /clear)」
//     ⇒ 「我完全停了、派发停止、在等 outer /clear」只存在于自由文本。
// This judge reads FREE TEXT (heartbeat reason + tick report transcript) and outputs
// {stopped, awaiting, needs, contradictsStructured, confidence}. contradictsStructured is the KEY field
// — it names the failure where structured fields say "no problem" but free text says "stopped awaiting".
//
// This file pins AC1-AC5:
//   AC1: reproduction — tonight's heartbeat contradiction is the FIRST negative-control sample
//   AC2: judge implementation — reads free text (reason + tick report), not just structured fields
//   AC3: trigger — free-text hash change OR blocked==[] && agentDispatches>=agentLimit (not every round)
//   AC4: red-on-omission (AC41③) — stopped:true but no escalation in tick-log ⇒ RED
//   AC5: three-layer symmetric — --layer inner|outer both usable
//
// Run:
//   scripts/test.sh plugin/test/semantic-observer-judge.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  judge,
  extractAwaiting,
  extractNeeds,
  structuredCarriesStopState,
  computeConfidence,
  escalationRecorded,
} from "../scripts/semantic-observer-judge.ts";
import {
  semanticTriggerHeuristic,
  freeTextHash,
  evaluateTrigger,
  parseHeartbeat,
} from "../scripts/inner-wakeup-heartbeat-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "semantic-observer-judge.ts");

// ── Tonight's heartbeat (2026-08-10, 11:28 版 — the motivating evidence) ───────────────────────────

const TONIGHT_HEARTBEAT = {
  ts: 1786361878,
  tsIso: "2026-08-10T11:37:58.915Z",
  delaySeconds: 1500,
  reason:
    "tick heartbeat — BUDGET HIT (200/200, dispatch stopped, awaiting outer /clear); conflicts handed to outer suite-fix (blocked cleared); AC41-③ queued post-budget-reset",
  runIds: {},
  effectiveCap: 5,
  suiteState: "running (round-237)",
  blocked: [],
  budgetHit: true,
  agentDispatches: 201,
  agentLimit: 200,
};

// ── AC1: 复现固化 — tonight's heartbeat is the FIRST negative-control sample ──────────────────────

test("AC1 — judge on tonight's heartbeat outputs stopped:true, awaiting:{who:outer,what:/clear}, contradictsStructured:true", () => {
  const { reason, ...structured } = TONIGHT_HEARTBEAT;
  const j = judge(reason, structured);
  assert.equal(j.stopped, true, "free text 'dispatch stopped, awaiting outer /clear' must read as stopped");
  assert.equal(j.awaiting.who, "outer");
  assert.equal(j.awaiting.what, "/clear");
  assert.equal(j.contradictsStructured, true, "blocked=[] says 'no block' while reason says 'stopped awaiting /clear'");
  assert.ok(j.readFreeText, "judge must declare it read free text (not only structured fields)");
  assert.ok(j.confidence > 0.5, `confidence should be non-trivial, got ${j.confidence}`);
});

test("AC1 — the structured fields ALONE would NOT say stopped (this is why free text matters)", () => {
  const { reason, ...structured } = TONIGHT_HEARTBEAT;
  // If we judged ONLY the structured fields (no free text), there is no stop signal:
  assert.equal(structuredCarriesStopState(structured), false, "blocked=[] + budgetHit must NOT carry a stop state");
  // And the stop state only appears when free text is read:
  const j = judge("", structured);
  assert.equal(j.stopped, false, "no free text ⇒ no stop judged (proves the signal lives in free text)");
});

// ── AC2: judge reads FREE TEXT (reason + tick report), not just structured fields ─────────────────

test("AC2 — judge reads tick report free text, not just heartbeat reason", () => {
  const { reason, ...structured } = TONIGHT_HEARTBEAT;
  // A heartbeat whose reason is benign, but the tick report carries the stop:
  const benignReason = "tick heartbeat — suite running";
  const tickReport =
    "fast-mode tick: BUDGET HIT (200/200, dispatch stopped, awaiting outer /clear); no further dispatch this round";
  const j = judge([benignReason, tickReport].join("\n"), structured);
  assert.equal(j.stopped, true, "stop signal in the tick report must be read even when reason is benign");
  assert.equal(j.awaiting.who, "outer");
  assert.equal(j.awaiting.what, "/clear");
});

test("AC2 — a benign heartbeat with the same structured fields does NOT judge stopped (reads free text, not structured)", () => {
  const { reason: _r, ...structured } = TONIGHT_HEARTBEAT;
  const benign = "tick heartbeat — suite green, dispatching normally, no budget issue";
  const j = judge(benign, structured);
  assert.equal(j.stopped, false, "structured fields say budgetHit but free text says normal ⇒ NOT stopped");
  assert.equal(j.contradictsStructured, false, "no stop in free text ⇒ no contradiction");
});

test("AC2 — needs extraction from free text", () => {
  const j = judge(TONIGHT_HEARTBEAT.reason, {});
  assert.ok(Array.isArray(j.needs) && j.needs.length >= 1, "needs must extract at least the /clear need");
  const clearNeed = j.needs.find((n) => n.what.includes("/clear") || n.what.toLowerCase().includes("clear"));
  assert.ok(clearNeed, "needs must include the /clear need");
  assert.equal(clearNeed.owner, "outer");
  assert.equal(clearNeed.blocking, true);
  assert.match(clearNeed.evidence, /awaiting outer \/clear|awaiting.*\/clear/i);
});

test("AC2 — contradictsStructured is false when structured DOES carry a block", () => {
  const structured = { blocked: ["merge-conflict"], budgetHit: false };
  const j = judge("dispatch stopped, awaiting outer to resolve conflicts", structured);
  assert.equal(j.stopped, true);
  assert.equal(j.contradictsStructured, false, "blocked non-empty ⇒ structured already expressed the state");
});

test("AC2 — extractAwaiting / extractNeeds / computeConfidence are pure and hermetic", () => {
  const text = "awaiting outer /clear; waiting for inner to finish suite";
  assert.deepEqual(extractAwaiting(text), { who: "outer", what: "/clear" });
  const needs = extractNeeds(text);
  assert.ok(needs.some((n) => n.owner === "outer" && n.what === "/clear"));
  assert.ok(needs.some((n) => n.owner === "inner"));
  const c = computeConfidence("dispatch stopped, awaiting outer /clear", { who: "outer", what: "/clear" }, needs);
  assert.ok(c > 0, "confidence must be > 0 when signals hit");
});

// ── AC3: trigger — hash change OR heuristic, NOT every round ──────────────────────────────────────

test("AC3 — semanticTriggerHeuristic: blocked==[] && agentDispatches>=agentLimit (tonight's exact shape)", () => {
  assert.equal(semanticTriggerHeuristic(TONIGHT_HEARTBEAT), true, "blocked=[] + 201/200 must trigger");
  assert.equal(semanticTriggerHeuristic({ blocked: [], agentDispatches: 10, agentLimit: 200 }), false);
  assert.equal(semanticTriggerHeuristic({ blocked: ["merge-conflict"], agentDispatches: 201, agentLimit: 200 }), false);
  assert.equal(semanticTriggerHeuristic(null), false);
});

test("AC3 — evaluateTrigger: heuristic fires without any hash baseline (trigger is not 'every round')", () => {
  const t = evaluateTrigger(TONIGHT_HEARTBEAT, TONIGHT_HEARTBEAT.reason, null);
  assert.equal(t.fired, true);
  assert.equal(t.heuristic, true);
  assert.equal(t.hashChanged, false, "no prev-hash ⇒ hashChanged must be false");
});

test("AC3 — evaluateTrigger: free-text hash change fires even when heuristic is false", () => {
  const heartbeat = { blocked: ["merge-conflict"], agentDispatches: 10, agentLimit: 200 };
  const text = "BUDGET HIT (200/200, dispatch stopped, awaiting outer /clear)";
  const h1 = freeTextHash(text);
  const t = evaluateTrigger(heartbeat, text, "0000000000000000");
  assert.equal(t.hashChanged, true, "hash differs from prev ⇒ hashChanged");
  assert.equal(t.fired, true);
  assert.equal(t.heuristic, false);
  assert.equal(t.hash, h1);
});

test("AC3 — evaluateTrigger: unchanged hash + no heuristic ⇒ NOT triggered (not every round)", () => {
  const heartbeat = { blocked: ["merge-conflict"], agentDispatches: 10, agentLimit: 200 };
  const text = "tick heartbeat — suite running";
  const h = freeTextHash(text);
  const t = evaluateTrigger(heartbeat, text, h);
  assert.equal(t.fired, false, "same hash + no heuristic ⇒ no trigger");
  assert.equal(t.hashChanged, false);
  assert.equal(t.heuristic, false);
});

test("AC3 — freeTextHash is deterministic", () => {
  assert.equal(freeTextHash("abc"), freeTextHash("abc"));
  assert.notEqual(freeTextHash("abc"), freeTextHash("abd"));
});

// ── AC4: red-on-omission (AC41③) — stopped:true but no escalation in tick-log ⇒ RED ──────────────

test("AC4 — escalationRecorded: an escalation line naming the layer or stop state counts", () => {
  const tickLog = [
    "| 2026-08-10 11:3xZ | `escalate` | inner stopped awaiting outer /clear — budget hit |",
  ].join("\n");
  assert.equal(escalationRecorded(tickLog, "inner"), true);
});

test("AC4 — escalationRecorded: tick-log WITHOUT escalation ⇒ false (this is the RED condition)", () => {
  const tickLog = [
    "| 2026-08-10 11:2xZ | `no-action` | inner reporting normally, nothing to do |",
  ].join("\n");
  assert.equal(escalationRecorded(tickLog, "inner"), false);
  assert.equal(escalationRecorded(null, "inner"), false);
  assert.equal(escalationRecorded("", "inner"), false);
});

test("AC4 CLI — stopped:true + tick-log without escalation ⇒ exit 1 (RED)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "soj-red-"));
  try {
    const quay = path.join(tmp, ".quay");
    fs.mkdirSync(quay, { recursive: true });
    fs.writeFileSync(
      path.join(quay, "inner-wakeup-heartbeat.json"),
      JSON.stringify(TONIGHT_HEARTBEAT, null, 2),
      "utf8",
    );
    // tick-log without escalation:
    const orch = path.join(tmp, "orchestration");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(
      path.join(orch, "tick-log.md"),
      "| 2026-08-10 11:2xZ | `no-action` | inner reporting normally |\n",
      "utf8",
    );
    const r = spawnSync(
      "node",
      ["--no-warnings", "--experimental-strip-types", CLI, "--layer", "inner", "--root", tmp, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1, `stopped without escalation must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.stopped, true);
    assert.equal(out.redOnOmission, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4 CLI — stopped:true + tick-log WITH escalation ⇒ exit 0 (not RED)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "soj-ok-"));
  try {
    const quay = path.join(tmp, ".quay");
    fs.mkdirSync(quay, { recursive: true });
    fs.writeFileSync(
      path.join(quay, "inner-wakeup-heartbeat.json"),
      JSON.stringify(TONIGHT_HEARTBEAT, null, 2),
      "utf8",
    );
    const orch = path.join(tmp, "orchestration");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(
      path.join(orch, "tick-log.md"),
      "| 2026-08-10 11:3xZ | `escalate` | inner stopped awaiting outer /clear — budget hit |\n",
      "utf8",
    );
    const r = spawnSync(
      "node",
      ["--no-warnings", "--experimental-strip-types", CLI, "--layer", "inner", "--root", tmp, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, `stopped WITH escalation must exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.redOnOmission, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC5: three-layer symmetric — --layer inner|outer both usable ──────────────────────────────────

test("AC5 CLI — --layer inner and --layer outer both produce the schema'd judgment (symmetric)", () => {
  for (const layer of ["inner", "outer"]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `soj-layer-${layer}-`));
    try {
      const quay = path.join(tmp, ".quay");
      fs.mkdirSync(quay, { recursive: true });
      fs.writeFileSync(
        path.join(quay, `${layer}-wakeup-heartbeat.json`),
        JSON.stringify(TONIGHT_HEARTBEAT, null, 2),
        "utf8",
      );
      const orch = path.join(tmp, "orchestration");
      fs.mkdirSync(orch, { recursive: true });
      // Escalation present ⇒ no RED, exit 0 — proves the schema path, not the red-on-omission exit.
      fs.writeFileSync(
        path.join(orch, "tick-log.md"),
        `| 2026-08-10 11:3xZ | \`escalate\` | ${layer} stopped awaiting outer /clear — budget hit |\n`,
        "utf8",
      );
      const r = spawnSync(
        "node",
        ["--no-warnings", "--experimental-strip-types", CLI, "--layer", layer, "--root", tmp, "--json"],
        { encoding: "utf8" },
      );
      assert.equal(r.status, 0, `--layer ${layer} must run (exit 0):\n${r.stdout}\n${r.stderr}`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.layer, layer);
      assert.equal(typeof out.stopped, "boolean");
      assert.ok(out.awaiting && typeof out.awaiting === "object", "schema must include awaiting");
      assert.ok(Array.isArray(out.needs), "schema must include needs[]");
      assert.equal(typeof out.contradictsStructured, "boolean");
      assert.equal(typeof out.confidence, "number");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test("AC5 CLI — parseHeartbeat accepts tonight's heartbeat shape (AC2 schema round-trip)", () => {
  const parsed = parseHeartbeat(JSON.stringify(TONIGHT_HEARTBEAT));
  assert.equal(parsed.reason, TONIGHT_HEARTBEAT.reason);
  assert.deepEqual(parsed.blocked, []);
  assert.equal(parsed.budgetHit, true);
  assert.equal(parsed.agentDispatches, 201);
});

// ── doc-contract wiring: the judge + trigger live in the tick cores (AC5 既有不回归) ───────────────

test("AC5 wiring — outer tick core A 段 carries the semantic judge + red-on-omission", () => {
  const outer = fs.readFileSync(path.join(repoRoot, "orchestration", "orchestrator-tick-core.md"), "utf8");
  assert.match(outer, /semantic-observer-judge\.ts/, "the outer A 段 must invoke the semantic judge");
  assert.match(outer, /redOnOmission|stopped[^|]*升级|stopped[^|]*escalat/i, "the outer A 段 must record the red-on-omission verdict");
});

test("AC5 wiring — inner heartbeat trigger functions are wired into the heartbeat-check", () => {
  const checker = fs.readFileSync(path.join(repoRoot, "plugin", "scripts", "inner-wakeup-heartbeat-check.ts"), "utf8");
  assert.match(checker, /semanticTriggerHeuristic/, "the heartbeat checker must carry the AC3 heuristic");
  assert.match(checker, /evaluateTrigger/, "the heartbeat checker must carry the AC3 trigger evaluation");
});

test("AC5 wiring — manager-phase-goal carries the AC40/AC41③ cross-annotation", () => {
  const mgr = fs.readFileSync(path.join(repoRoot, "orchestration", "manager-phase-goal.md"), "utf8");
  assert.match(mgr, /gap-semantic-observer-judge-stopped-awaiting/, "manager-phase-goal must cross-annotate this task");
});

test("AC5 wiring — gap-ac41-red-on-omission-artifact carries the cross-annotation back", () => {
  const sibling = fs.readFileSync(
    path.join(repoRoot, "tasks", "gap-ac41-red-on-omission-artifact.md"),
    "utf8",
  );
  assert.match(sibling, /gap-semantic-observer-judge-stopped-awaiting/, "the red-on-omission task must cross-annotate this task");
});
