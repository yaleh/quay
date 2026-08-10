// @test-group governance
// inner-agent-budget-report.test.mjs — inner subagent 预算的可读产物（inner 派发前写 / outer tick 读）
// (tasks/gap-inner-subagent-budget-invisible)
//
// The defect: the harness per-session subagent spawn hard cap (200/200) is a SILENT ceiling on
// inner dispatch ability — no source-of-truth record existed in the repo and the three-layer
// execution cores wrote nothing about it. Empirical (manager 2026-08-10 third correction): inner
// session 728a4610's tool_result at 2026-08-10T05:13:13 verbatim "Subagent spawn limit reached
// (200 of 200 agents spawned)." — the exact moment of the last Agent dispatch (201 total). After
// the cap, inner can no longer spawn subagents ⇒ 0 in-flight ⇒ no <task-notification> ⇒ slot-refill
// never fires ⇒ empty slots + full ready pool + "no dispatch" — morphologically identical to every
// mechanism defect. C17 (rules need PRODUCTS, not visibility): "whether the budget is exhausted"
// needs a mechanically-readable product. Fix: inner runs inner-agent-budget-report.ts BEFORE each
// dispatch decision — counts Agent dispatches from the transcript, detects the spawn-limit signal,
// writes `.quay/inner-agent-budget.json` ({spawned, limit, lastSpawnAt, hitLimit}); the OUTER tick
// reads it and escalates on near/hit. The fix is the MECHANISM, not raising the env cap.
//
// This file pins BOTH:
//   (a) the checker's LOGIC (plugin/scripts/inner-agent-budget-report.ts) — hermetic pure-function
//       tests + CLI exit-code tests (OK ⇒ 0, NEAR/HIT/MALFORMED ⇒ 1, missing transcript ⇒ 2, --read
//       MISSING ⇒ 0);
//   (b) the DOC-CONTRACT wiring — fast-mode-loop-tick.md must carry the pre-dispatch budget check +
//       escalate-on-hit instruction (inner-agent-budget-report.ts invocation), and
//       orchestrator-tick-core.md A 段 must carry the READ of inner-agent-budget.json + escalation
//       on hitLimit/near.
//
// Run:
//   scripts/test.sh plugin/test/inner-agent-budget-report.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  BUDGET_FILE,
  DEFAULT_NEAR_FRACTION,
  DEFAULT_SUBAGENT_LIMIT,
  MALFORMED,
  SPAWN_LIMIT_SIGNAL,
  analyzeAgentBudget,
  judgeBudget,
  parseBudget,
  readBudgetText,
  resolveLimit,
  serializeBudget,
  writeBudget,
} from "../scripts/inner-agent-budget-report.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "inner-agent-budget-report.ts");

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("resolveLimit — env CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION wins, else default 200 (AC2 可读则用)", () => {
  assert.equal(resolveLimit({ CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "2000" }), 2000);
  assert.equal(resolveLimit({ CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "5000" }), 5000);
  assert.equal(resolveLimit({}), DEFAULT_SUBAGENT_LIMIT);
  assert.equal(resolveLimit({ CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "not-a-number" }), DEFAULT_SUBAGENT_LIMIT);
  // explicit --limit overrides env
  assert.equal(resolveLimit({ CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "2000" }, "300"), 300);
});

test("analyzeAgentBudget — counts Agent tool_use, not Edit, and tracks lastSpawnAt (AC2 Agent 计数)", () => {
  const records = [
    { type: "assistant", timestamp: "2026-08-10T04:00:00.000Z", message: { content: [{ type: "tool_use", name: "Agent", input: {} }] } },
    { type: "assistant", timestamp: "2026-08-10T05:00:00.000Z", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "tasks/a.md" } }] } },
    { type: "assistant", timestamp: "2026-08-10T05:13:13.000Z", message: { content: [{ type: "tool_use", name: "Agent", input: {} }] } },
  ];
  const r = analyzeAgentBudget(records, { limit: 200, rawText: "" });
  assert.equal(r.spawned, 2, "two Agent tool_use blocks, Edit is not counted");
  assert.equal(r.limit, 200);
  assert.equal(r.hitLimit, false);
  // lastSpawnAt = the LAST Agent dispatch epoch-second (2026-08-10T05:13:13Z).
  assert.equal(r.lastSpawnAt, Math.floor(Date.parse("2026-08-10T05:13:13.000Z") / 1000));
  assert.equal(r.lastSpawnAtIso, "2026-08-10T05:13:13.000Z");
});

test("analyzeAgentBudget — spawn-limit in an Agent tool_RESULT ⇒ hitLimit=true (AC3 触顶信号, POSITION-BASED)", () => {
  // Positive control: a REAL harness spawn-limit error is the tool_result RETURN of an Agent call —
  // its tool_use_id matches the Agent tool_use's id. Only this position counts (硬规则 2).
  const records = [
    { type: "assistant", timestamp: "2026-08-10T04:00:00.000Z", message: { content: [{ type: "tool_use", name: "Agent", id: "call_00_agent1", input: {} }] } },
    { type: "user", timestamp: "2026-08-10T05:13:14.000Z", message: { content: [{ type: "tool_result", tool_use_id: "call_00_agent1", content: `${SPAWN_LIMIT_SIGNAL} (200 of 200 agents spawned).` }] } },
  ];
  const raw = records.map((r) => JSON.stringify(r)).join("\n");
  const r = analyzeAgentBudget(records, { limit: 200, rawText: raw });
  assert.equal(r.spawned, 1, "only one Agent dispatch counted");
  assert.equal(r.hitLimit, true, "the harness spawn-limit tool_result RETURN must trip hitLimit");
});

test("analyzeAgentBudget — task-body quote / user message mentioning the string does NOT trip (硬规则 2 POSITION negative control)", () => {
  // Negative control (manager 2026-08-10 11:4x): the task gap-inner-subagent-budget-invisible quotes
  // the 05:13:13 verbatim for evidence; that quote enters inner's transcript (as a Read tool_result
  // or user message) and a bare includes() matched it. A tool_result WITHOUT a matching Agent id, or
  // a user message, must NOT trip hitLimit.
  const records = [
    { type: "assistant", timestamp: "2026-08-10T04:00:00.000Z", message: { content: [{ type: "tool_use", name: "Agent", id: "call_00_real", input: {} }] } },
    // A Read tool_result whose CONTENT is the task body quoting the signal — no Agent tool_use_id.
    { type: "user", timestamp: "2026-08-10T05:13:14.000Z", message: { content: [{ type: "tool_result", tool_use_id: "call_00_read_task", content: `原始记录(非自述): inner 会话 728a4610 的 tool_result, 2026-08-10T05:13:13 逐字写着 "${SPAWN_LIMIT_SIGNAL} (200 of 200 agents spawned)"…` }] } },
    // A user message merely mentioning the string.
    { type: "user", timestamp: "2026-08-10T05:13:15.000Z", message: { content: `外层说该会话出现过 "${SPAWN_LIMIT_SIGNAL}"` } },
  ];
  const raw = records.map((r) => JSON.stringify(r)).join("\n");
  const r = analyzeAgentBudget(records, { limit: 200, rawText: raw });
  assert.equal(r.spawned, 1, "one real Agent dispatch counted");
  assert.equal(r.hitLimit, false, "task-body quote / user message mentioning the signal must NOT trip (硬规则 2)");
});

test("analyzeAgentBudget — spawned reaching limit also trips hitLimit (count fallback)", () => {
  const records = [];
  for (let i = 0; i < 3; i++) {
    records.push({ type: "assistant", timestamp: `2026-08-10T0${i}:00:00.000Z`, message: { content: [{ type: "tool_use", name: "Agent", input: {} }] } });
  }
  const r = analyzeAgentBudget(records, { limit: 3, rawText: "" });
  assert.equal(r.spawned, 3);
  assert.equal(r.hitLimit, true, "spawned >= limit ⇒ hitLimit via the count fallback");
});

test("serializeBudget — writes exactly the documented {spawned, limit, lastSpawnAt, hitLimit} schema (AC4)", () => {
  const s = serializeBudget({ spawned: 5, limit: 200, lastSpawnAt: 1786338793, hitLimit: false });
  const parsed = JSON.parse(s);
  assert.deepEqual(Object.keys(parsed).sort(), ["hitLimit", "lastSpawnAt", "limit", "spawned"]);
  assert.equal(parsed.spawned, 5);
  assert.equal(parsed.limit, 200);
  assert.equal(parsed.lastSpawnAt, 1786338793);
  assert.equal(parsed.hitLimit, false);
});

test("parseBudget — parses the documented schema; null on missing/empty; MALFORMED otherwise", () => {
  assert.deepEqual(parseBudget('{"spawned":5,"limit":200,"lastSpawnAt":1786338793,"hitLimit":false}'), {
    spawned: 5, limit: 200, lastSpawnAt: 1786338793, hitLimit: false,
  });
  assert.equal(parseBudget(null), null);
  assert.equal(parseBudget(""), null);
  assert.equal(parseBudget("{ not json"), MALFORMED);
  assert.equal(parseBudget('{"spawned":5}'), MALFORMED, "missing required keys ⇒ MALFORMED");
  assert.equal(parseBudget('{"spawned":"five","limit":200,"lastSpawnAt":null,"hitLimit":false}'), MALFORMED, "wrong types ⇒ MALFORMED");
});

test("judgeBudget — OK when spawned < limit, not near, not hit", () => {
  const v = judgeBudget(1000, { spawned: 100, limit: 200, lastSpawnAt: 100, hitLimit: false }, { nearFraction: 0.8 });
  assert.equal(v.ok, true);
  assert.equal(v.status, "ok");
  assert.equal(v.remaining, 100);
});

test("judgeBudget — exactly at the near boundary (spawned/limit == nearFraction) is NEAR", () => {
  const v = judgeBudget(1000, { spawned: 160, limit: 200, lastSpawnAt: 100, hitLimit: false }, { nearFraction: 0.8 });
  assert.equal(v.ok, false);
  assert.equal(v.status, "near");
  assert.equal(v.remaining, 40);
});

test("judgeBudget — HIT when spawned >= limit (AC3 触顶即升级)", () => {
  const v = judgeBudget(1000, { spawned: 200, limit: 200, lastSpawnAt: 100, hitLimit: false }, { nearFraction: 0.8 });
  assert.equal(v.ok, false);
  assert.equal(v.status, "hit");
  assert.equal(v.hitLimit, true);
});

test("judgeBudget — HIT when the hitLimit flag is set even if spawned < limit (signal beats count)", () => {
  const v = judgeBudget(1000, { spawned: 2, limit: 200, lastSpawnAt: 100, hitLimit: true }, { nearFraction: 0.8 });
  assert.equal(v.ok, false);
  assert.equal(v.status, "hit");
  assert.equal(v.hitLimit, true);
});

test("judgeBudget — MISSING product is OK (no data, no escalation) for the outer reader (AC4 外层可读)", () => {
  const v = judgeBudget(1000, null, { nearFraction: 0.8 });
  assert.equal(v.ok, true);
  assert.equal(v.status, "missing");
});

test("judgeBudget — MALFORMED product is fail-closed escalation", () => {
  const v = judgeBudget(1000, MALFORMED, { nearFraction: 0.8 });
  assert.equal(v.ok, false);
  assert.equal(v.status, "malformed");
});

test("writeBudget/readBudgetText — round-trips the product under <root>/.quay/ (AC4)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iab-write-"));
  try {
    const budget = { spawned: 3, limit: 200, lastSpawnAt: 1786338793, hitLimit: false };
    writeBudget(tmp, budget);
    const text = readBudgetText(tmp);
    assert.equal(text, serializeBudget(budget));
    assert.deepEqual(parseBudget(text), budget);
    // readBudgetText returns null when the file is absent.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "iab-missing-"));
    try { assert.equal(readBudgetText(empty), null); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── CLI integration (spawn the real script against a temp workspace) ───────────────────────────────

function runCli(root, extra = []) {
  const args = ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, ...extra];
  return spawnSync("node", args, { encoding: "utf8" });
}

function makeTranscript(recordsLines) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iab-cli-"));
  const quayDir = path.join(tmp, ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  fs.writeFileSync(path.join(tmp, "sess.jsonl"), recordsLines.join("\n") + "\n", "utf8");
  return tmp;
}

const agentRec = (ts, name = "Agent", id = `call_${ts.replace(/\D/g, "")}`) =>
  JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", name, id, input: {} }] } });

test("AC2/AC4 CLI — inner surface counts + writes the product and exits 0 on OK", () => {
  const root = makeTranscript([
    agentRec("2026-08-10T04:00:00.000Z"),
    agentRec("2026-08-10T05:00:00.000Z"),
  ]);
  try {
    const r = runCli(root, ["--session", path.join(root, "sess.jsonl"), "--json"]);
    assert.equal(r.status, 0, `OK budget must exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.spawned, 2);
    assert.equal(out.limit, DEFAULT_SUBAGENT_LIMIT);
    assert.equal(out.status, "ok");
    // Product written with the documented schema.
    const product = JSON.parse(fs.readFileSync(path.join(root, ".quay", BUDGET_FILE), "utf8"));
    assert.equal(product.spawned, 2);
    assert.equal(product.limit, DEFAULT_SUBAGENT_LIMIT);
    assert.equal(product.hitLimit, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 CLI — spawn-limit signal ⇒ HIT, exits 1 (escalate, not silent serial)", () => {
  const agentId = `call_${"2026-08-10T05:13:13.000Z".replace(/\D/g, "")}`;
  const root = makeTranscript([
    agentRec("2026-08-10T04:00:00.000Z"),
    agentRec("2026-08-10T05:13:13.000Z"),
    JSON.stringify({ type: "user", timestamp: "2026-08-10T05:13:14.000Z", message: { content: [{ type: "tool_result", tool_use_id: agentId, content: `${SPAWN_LIMIT_SIGNAL} (200 of 200 agents spawned).` }] } }),
  ]);
  try {
    const r = runCli(root, ["--session", path.join(root, "sess.jsonl"), "--limit", "5", "--json"]);
    assert.equal(r.status, 1, `HIT budget must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hitLimit, true);
    assert.equal(out.status, "hit");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI — near budget (spawned/limit >= nearFraction) exits 1 with status near", () => {
  const root = makeTranscript([]);
  try {
    fs.writeFileSync(path.join(root, ".quay", BUDGET_FILE), JSON.stringify({ spawned: 180, limit: 200, lastSpawnAt: 1786338793, hitLimit: false }), "utf8");
    const r = runCli(root, ["--read", "--json"]);
    assert.equal(r.status, 1, `NEAR budget must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "near");
    assert.equal(out.remaining, 20);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 CLI --read — MISSING product exits 0 (no data yet, not an escalation)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iab-missing-"));
  try {
    const r = runCli(root, ["--read", "--json"]);
    assert.equal(r.status, 0, `MISSING must exit 0 (no data):\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "missing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 CLI --read — MALFORMED product exits 1 (fail-closed escalation)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iab-malformed-"));
  try {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", BUDGET_FILE), "{ not json", "utf8");
    const r = runCli(root, ["--read", "--json"]);
    assert.equal(r.status, 1, `MALFORMED must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "malformed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI — missing --session transcript exits 2 (usage/fatal, not a budget verdict)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iab-nosess-"));
  try {
    const r = runCli(root, ["--session", path.join(root, "nope.jsonl")]);
    assert.equal(r.status, 2, `missing transcript must exit 2:\n${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── doc-contract wiring (AC2/AC3 inner pre-dispatch + AC4 outer A 段必读) ───────────────────────────

test("AC2/AC3 wiring — fast-mode-loop-tick.md carries the pre-dispatch budget check + escalate-on-hit", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  assert.match(doc, /inner-agent-budget-report\.ts/, "the tick doc must invoke the budget report script");
  assert.match(doc, /inner-agent-budget\.json/, "the tick doc must name the product file");
  // The pre-dispatch budget check must be in the DISPATCH flow (step 4 / slot-refill region), not a
  // one-off mention — assert it sits before the 重新排程 step (step 6).
  const dispatchIdx = doc.indexOf("## Tick 步骤");
  const reschedIdx = doc.indexOf("### 6. 重新排程");
  assert.ok(dispatchIdx !== -1 && reschedIdx !== -1 && reschedIdx > dispatchIdx, "tick doc must have dispatch then reschedule");
  const dispatchRegion = doc.slice(dispatchIdx, reschedIdx);
  assert.match(dispatchRegion, /inner-agent-budget-report\.ts/, "the budget check must live in the dispatch flow");
  // Escalate-on-hit, never silently fall back to main-thread serial.
  assert.match(dispatchRegion, /触顶|spawn-limit|预算/, "the dispatch flow must name the budget/ceiling");
});

test("AC4 wiring — orchestrator-tick-core.md A 段 must READ+judge inner-agent-budget.json", () => {
  const outer = fs.readFileSync(path.join(repoRoot, "orchestration", "orchestrator-tick-core.md"), "utf8");
  assert.match(outer, /inner-agent-budget\.json/, "the outer A 段 must read the budget product");
  assert.match(outer, /inner-agent-budget-report\.ts/, "the outer A 段 must invoke the budget report script");
  const aLines = outer.split("\n").filter((l) => l.includes("inner-agent-budget"));
  assert.ok(aLines.length >= 1, "the outer A 段 must carry the budget read");
  assert.ok(aLines.some((l) => /hitLimit|触顶|预算将尽|spawned/.test(l)), "the outer escalation must name hitLimit/near");
});

test("AC1/AC4 — cross-annotation to the same-family sibling tasks", () => {
  const wakeup = fs.readFileSync(path.join(repoRoot, "tasks", "gap-inner-wakeup-heartbeat-invisible.md"), "utf8");
  assert.match(wakeup, /gap-inner-subagent-budget-invisible/, "the wakeup sibling must carry the cross-annotation back");
  const dispatch = fs.readFileSync(path.join(repoRoot, "tasks", "gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md"), "utf8");
  assert.match(dispatch, /gap-inner-subagent-budget-invisible/, "the dispatch sibling must carry the cross-annotation back");
  const self = fs.readFileSync(path.join(repoRoot, "tasks", "gap-inner-subagent-budget-invisible.md"), "utf8");
  assert.match(self, /gap-inner-subagent-budget-invisible/, "self task file");
});

test("AC1 — the reproduction is fixed in the task body (05:13:13 spawn-limit original record + cause chain)", () => {
  const self = fs.readFileSync(path.join(repoRoot, "tasks", "gap-inner-subagent-budget-invisible.md"), "utf8");
  assert.match(self, /05:13:13/, "the task body must record the 05:13:13 spawn-limit original record");
  assert.match(self, /Subagent spawn limit reached/, "the verbatim harness signal must be recorded");
});
