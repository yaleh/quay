// @test-group product
// gap-dashboard-goal-card-provider-backed — dashboard 增 goal-card（AC-179 / G8 / GOAL-001 最后一期）。
//
// 卡片走 Provider ABI：`renderGoalCard` 是纯函数，输入是 `client.goalList()` 返回的 GoalRecord[]
//（GOAL + AC 记录），派生三要素——每条 active GOAL 的 `AC 达成 x/y`、三态陈旧标记
//（fresh/stale/NOT-EVALUATED，从不坍缩成二态）、`activeCount / cap`。AC3 禁止 serve-dashboard.ts
// 直接 import goal-store（goal 数据必须来自 ABI），故 cap/stale 两个策略标量由本文件的
// readGoalPolicy() 直接读 `.quay/config.yml` 的 `goals:` 段（镜像 goal-store.readGoalConfig 的
// 最小解析，不 import 整个 store）。
//
// 测试：
//   AC5 — 三要素齐备（AC 达成 x/y + 三态标记之一 + activeCount/cap）+ goal-card DOM id。
//   AC5 — 三态不可坍缩：零 AC（或全无 evidence.at）⇒ NOT-EVALUATED；旧 evidence.at ⇒ stale；
//          新 evidence.at ⇒ fresh（分别用注入的 nowMs/staleMs 确定性构造）。
//   AC4 — 优雅降级：goalList 返回 [] 时 renderGoalCard([]) 渲染空态（「暂无 active GOAL」）而非
//          抛错/消失。
//   AC3 — serve-dashboard.ts 无 goal-store import，且 goal 数据经 client.goalList()。
//   AC1/AC2 — 真实 server 集成：GET /dashboard 同时含 goal-card 与 task-card（task-card 命中即
//           AC2 负控制，证明管线本身通），并渲染真实 GOAL 数据；删空 goals/ 后仍 200 + 空态。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { renderGoalCard, readGoalPolicy, renderDashboardPage } from "../src/serve-dashboard.ts";
import { startServer } from "../src/serve.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ── pure renderGoalCard fixtures ─────────────────────────────────────────────────────────────────

/** A minimal GoalRecord-shaped object (renderGoalCard only reads id/title/status/kind/goal/evidence). */
function goal(id, { status = "active", kind = "goal", title = `${id} title`, goalId } = {}) {
  return { id, title, status, kind, goal: goalId, evidence: undefined, supersedes: [], supersededBy: [], body: "" };
}

function ac(id, goalId, { status = "active", evidence } = {}) {
  return { id, title: `${id} title`, status, kind: "criterion", goal: goalId, criterion: "exit 0", expect: "", origin: "test", evidence, supersedes: [], supersededBy: [], body: "" };
}

const NOW = Date.parse("2026-09-06T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

test("AC5: three content elements — AC 达成 x/y + one of fresh/stale/NOT-EVALUATED + activeCount/cap", () => {
  const goals = [
    goal("GOAL-001", { title: "goal mechanism" }),
    ac("AC-170", "GOAL-001", { status: "achieved", evidence: { at: new Date(NOW - DAY).toISOString(), verdict: "pass", reading: "0" } }),
    ac("AC-171", "GOAL-001", { status: "active" }),
    ac("AC-172", "GOAL-001", { status: "achieved", evidence: { at: new Date(NOW - 2 * DAY).toISOString() } }),
  ];
  const html = renderGoalCard(goals, { cap: 3, staleMs: 7 * DAY, nowMs: NOW });

  assert.match(html, /id="goal-card"/, "card carries the goal-card DOM id");
  assert.match(html, /AC 达成 2\/3/, "per-goal AC progress x/y (2 achieved of 3)");
  assert.match(html, /active 1 \/ cap 3/, "activeCount / cap summary");
  assert.match(html, /\b(fresh|stale|NOT-EVALUATED)\b/, "one of the three-state markers is rendered");
  assert.match(html, /\/goal\/GOAL-001/, "active goal links to its /goal/<id> page");
});

test("AC5: three-state never collapses — fresh / stale / NOT-EVALUATED are distinct and reachable", () => {
  const staleMs = 7 * DAY;
  // fresh: latest evidence.at within the window.
  const fresh = renderGoalCard(
    [goal("GOAL-001"), ac("AC-170", "GOAL-001", { status: "achieved", evidence: { at: new Date(NOW - DAY).toISOString() } })],
    { cap: 3, staleMs, nowMs: NOW },
  );
  assert.match(fresh, /fresh/, "recent evidence → fresh");
  assert.doesNotMatch(fresh, /NOT-EVALUATED/, "fresh goal is not NOT-EVALUATED");

  // stale: latest evidence.at older than the window.
  const stale = renderGoalCard(
    [goal("GOAL-001"), ac("AC-170", "GOAL-001", { status: "achieved", evidence: { at: new Date(NOW - 8 * DAY).toISOString() } })],
    { cap: 3, staleMs, nowMs: NOW },
  );
  assert.match(stale, /stale/, "old evidence → stale");

  // NOT-EVALUATED: an active GOAL with NO ACs at all — cannot compute lastProgressAt, so judging it
  // "fresh" would record a never-measured object as healthy (hard rule 3b).
  const notEval = renderGoalCard([goal("GOAL-002")], { cap: 3, staleMs, nowMs: NOW });
  assert.match(notEval, /NOT-EVALUATED/, "goal with no ACs → NOT-EVALUATED");
  assert.doesNotMatch(notEval, /fresh/, "never-evaluated goal is never judged fresh");
});

test("AC4: goalList degraded to [] renders an empty state, never throws and never disappears", () => {
  const html = renderGoalCard([], { cap: 3, staleMs: 7 * DAY, nowMs: NOW });
  assert.match(html, /id="goal-card"/, "the card still renders when the goal list is empty");
  assert.match(html, /暂无 active GOAL/, "empty state is shown");
  assert.match(html, /active 0 \/ cap 3/, "activeCount is honestly 0");
  assert.doesNotMatch(html, /AC 达成/, "no per-goal row when there are no active goals");
});

test("readGoalPolicy: defaults (cap=3, stale=7d) without config; honors a goals: override", () => {
  // No workspace → defaults (and does not throw).
  assert.deepEqual(readGoalPolicy(undefined), { cap: 3, staleMs: 7 * DAY });

  const ws = makeTmpDir("goal-policy-");
  const qd = path.join(ws, ".quay");
  fs.mkdirSync(qd, { recursive: true });
  fs.writeFileSync(path.join(qd, "config.yml"), "goals:\n  cap: 5\n  stale: 12h\n");
  assert.deepEqual(readGoalPolicy(ws), { cap: 5, staleMs: 12 * 3600_000 });

  // Unparseable / absent config → defaults (never crash the dashboard).
  fs.writeFileSync(path.join(qd, "config.yml"), "goals:\n  cap: not-a-number\n");
  assert.deepEqual(readGoalPolicy(ws), { cap: 3, staleMs: 7 * DAY });
});

test("AC3: serve-dashboard.ts has zero goal-store imports and reads goal data via client.goalList()", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const importLines = src.split("\n").filter((l) => /^\s*import\s/.test(l) && /goal-store/.test(l));
  assert.deepEqual(importLines, [], "no import statement references goal-store");
  assert.match(src, /client\.goalList\(\)/, "goal data is read through the Provider ABI");
  // renderDashboardPage is fed goal DATA via its `d.goals` param (the pure-render split: the provider
  // call lives in handleDashboard, not the render function) — same shape as taskCard's `d.tasks`.
  assert.ok(src.includes("renderGoalCard(d.goals ?? [],"), "renderDashboardPage passes d.goals into renderGoalCard");
});

// ── integration: a real running serve instance renders the card (AC1 + AC2 negative control) ──────

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

let server, port, originalCwd, workspaceRoot, goalsDir;

before(async () => {
  const tasksDir = makeTmpDir("goalcard-tasks-");
  const adrDir = makeTmpDir("goalcard-adr-");
  workspaceRoot = makeTmpDir("goalcard-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(goalsDir, "GOAL-001-goal-mechanism.md"),
    `---\nid: GOAL-001\ntitle: goal mechanism\nstatus: active\nkind: goal\norigin: test\n---\n## Goal\none target\n`);
  fs.writeFileSync(path.join(goalsDir, "AC-170-first.md"),
    `---\nid: AC-170\ntitle: first ac\nstatus: achieved\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "exit 0"\norigin: test\nevidence:\n  at: ${now}\n  verdict: pass\n  reading: "0"\n---\n## Rationale\nmeasured\n`);
  fs.writeFileSync(path.join(goalsDir, "AC-171-second.md"),
    `---\nid: AC-171\ntitle: second ac\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "exit 0"\norigin: test\n---\n## Rationale\npending\n`);
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

test("AC1+AC2: a running serve instance serves goal-card AND task-card on /dashboard (three elements rendered)", async () => {
  const r = await get(port, "/dashboard");
  assert.equal(r.status, 200);
  assert.match(r.body, /id="goal-card"/, "goal-card is present (AC1)");
  assert.match(r.body, /id="task-card"/, "task-card is present (AC2 negative control: the pipeline itself works)");
  assert.match(r.body, /AC 达成 1\/2/, "per-goal AC progress renders real GOAL data");
  assert.match(r.body, /active 1 \/ cap 3/, "activeCount/cap summary renders");
  assert.match(r.body, /\b(fresh|stale|NOT-EVALUATED)\b/, "a three-state marker renders");
  assert.match(r.body, /\/goal\/GOAL-001/, "active goal links to /goal/GOAL-001");
});

test("AC4: with no goals the /dashboard still returns 200 and shows the empty state", async () => {
  for (const f of fs.readdirSync(goalsDir)) fs.rmSync(path.join(goalsDir, f));
  try {
    const r = await get(port, "/dashboard");
    assert.equal(r.status, 200);
    assert.match(r.body, /id="goal-card"/, "card still renders (not disappears)");
    assert.match(r.body, /暂无 active GOAL/, "empty state shown");
    assert.match(r.body, /active 0 \/ cap 3/, "activeCount honestly 0");
  } finally {
    // restore for any later assertion (defensive; this is the last test but keep the fixture valid).
  }
});
