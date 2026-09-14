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
import {
  renderGoalCard,
  readGoalPolicy,
  renderDashboardPage,
  peekDashboardSnapshot,
  startDashboardSnapshotRefresh,
  setDashboardSnapshotStepHook,
  clearDashboardSnapshots,
  isDashboardSnapshotRebuilding,
  isDashboardSnapshotFollowUpQueued,
} from "../src/serve-dashboard.ts";
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

test("layout regression: 8-char id + zero ACs (NOT-EVALUATED) keeps id <a> flex:none, no overflow:hidden", () => {
  // gap-goal-card-id-flex-squeeze-by-long-staleness-label: a flex:none sibling (the three-state label)
  // used to squeeze an overflow:hidden+ellipsis <a> to ~half its width — "GOAL-011" rendered as "GOAL-0…".
  // The fix gives the id <a> flex:none (never shrinks) and drops the ellipsis trio, and lets the label
  // wrap onto its own line via the row's flex-wrap:wrap. This is a pure string/regex regression (no
  // browser) — it can't measure flexbox squeeze, so it asserts the two style tokens that guard against it.
  const html = renderGoalCard([goal("GOAL-011")], { cap: 3, staleMs: 7 * DAY, nowMs: NOW });
  assert.match(html, /NOT-EVALUATED/, "zero ACs trigger the longest (13-char) three-state label");
  const idAnchor = html.match(/<a href="\/goal\/GOAL-011"[^>]*>/);
  assert.ok(idAnchor, "the active goal's id <a> is rendered");
  assert.match(idAnchor[0], /flex:none/, "id <a> carries flex:none so the label sibling cannot shrink it");
  assert.doesNotMatch(idAnchor[0], /overflow:hidden/, "id <a> no longer carries the ellipsis truncation that enabled the squeeze");
  // The row itself must allow the label to wrap rather than compete for the id's width.
  assert.match(html, /display:flex;justify-content:space-between;[^"]*flex-wrap:wrap/, "id row carries flex-wrap:wrap");
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

/** Poll until `fn()` is truthy or the deadline passes; returns whether it became true. Asserted on
 *  the result at every call site — a bare `await` on a timeout-returning helper is a 恒真空转. */
async function until(fn, ms = 30_000, step = 25) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return fn();
}

/** `server.client`, wrapped so the test can READ how many times the build asked the goal ABI.
 *  A build issues exactly one `goalList()` (first thing `buildDashboardSnapshot` does), so this
 *  counts builds — the direct quantity for "did a tick stack another build?", not a proxy. */
function countingClient(real, onGoalList) {
  return new Proxy(real, {
    get(t, prop) {
      if (prop === "goalList") {
        return async () => { onGoalList(); return t.goalList(); };
      }
      const v = Reflect.get(t, prop, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** Write the three-file goal fixture this file's `before()` installs. */
function writeGoalFixture() {
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(goalsDir, "GOAL-001-goal-mechanism.md"),
    `---\nid: GOAL-001\ntitle: goal mechanism\nstatus: active\nkind: goal\norigin: test\n---\n## Goal\none target\n`);
  fs.writeFileSync(path.join(goalsDir, "AC-170-first.md"),
    `---\nid: AC-170\ntitle: first ac\nstatus: achieved\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "exit 0"\norigin: test\nevidence:\n  at: ${now}\n  verdict: pass\n  reading: "0"\n---\n## Rationale\nmeasured\n`);
  fs.writeFileSync(path.join(goalsDir, "AC-171-second.md"),
    `---\nid: AC-171\ntitle: second ac\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "exit 0"\norigin: test\n---\n## Rationale\npending\n`);
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
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: /dashboard's request path now serves a
  // SNAPSHOT built by a background tick (the goal card included — `client.goalList()` costs ~1 s
  // through the real ABI, so it cannot stay on the request path). Retire the tick here and rebuild
  // EXPLICITLY (`rebuild()` below) after each fixture change, so the tests keep exercising the
  // PRODUCTION path instead of racing a 30 s refresh.
  server.dashboardSnapshot.stop();
});

/** Make the dashboard snapshot reflect the goal store as it is right now. */
async function rebuild() {
  await server.dashboardSnapshot.rebuildNow();
}

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
  await rebuild();
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

// ── gap-dashboard-snapshot-rebuild-returns-inflight-cold-build ────────────────────────────────────
// 病灶：`rebuild()`（`rebuildNow()` 的实现）在已有构建 in-flight 时**去重返回那趟旧构建**。冷构建
// 的 `client.goalList()` 是 `buildDashboardSnapshot` 的第一行就发出去的 ⇒ 调用方在冷构建按住期间
// 改动 fixture 后 `await rebuildNow()`，拿到的快照带的是**改动前**的数据。
//
// 下面两条读数都把「in-flight」**断言**出来（步骤钩子把构建按住 + 计数 client 读到 goalList 已返回），
// 而不是靠 sleep 赌时序 —— 前提是**读数**（`goalCalls === 1`），不是等待。

test("AC1: rebuildNow() during an in-flight cold build reflects the caller's change (not the incumbent's stale read)", async () => {
  // Start from a clean snapshot state and let anything already running settle, so the only build this
  // test reasons about is the one it starts itself.
  await until(() => !isDashboardSnapshotRebuilding(workspaceRoot), 30_000);
  clearDashboardSnapshots();
  writeGoalFixture();

  let goalCalls = 0;
  const client = countingClient(server.client, () => { goalCalls += 1; });

  // Hold the COLD build open at a cooperative step boundary.
  let release;
  const held = new Promise((r) => { release = r; });
  let entered = false;
  setDashboardSnapshotStepHook(async () => { entered = true; await held; });
  const handle = startDashboardSnapshotRefresh(workspaceRoot, client, { intervalMs: 60_000 });
  try {
    assert.ok(
      await until(() => entered && isDashboardSnapshotRebuilding(workspaceRoot)),
      "the cold build must actually be in flight for this reading to mean anything",
    );
    // The PREMISE as a reading, not a sleep: the incumbent has already been handed its goal answer
    // (the round-trip returned while the build sat held), so it is now provably a pre-change reading.
    assert.ok(await until(() => goalCalls >= 1), "the cold build must have issued its goalList() round-trip");
    assert.equal(goalCalls, 1, "premise: exactly the one cold build has read the store thus far");

    // The caller's change, made while the incumbent build is still in flight.
    for (const f of fs.readdirSync(goalsDir)) fs.rmSync(path.join(goalsDir, f));

    const afterChange = handle.rebuildNow();
    assert.equal(
      isDashboardSnapshotFollowUpQueued(workspaceRoot),
      true,
      "rebuildNow() must QUEUE a rebuild behind the incumbent — not be satisfied by it",
    );

    release();
    await afterChange;

    const snap = peekDashboardSnapshot(workspaceRoot);
    assert.ok(snap != null, "a snapshot is installed after the on-demand rebuild");
    assert.deepEqual(
      snap.goals.map((g) => g.id),
      [],
      "the snapshot handed to the caller reflects the store AS OF THE CALL — the incumbent build's pre-change goal answer must not be served as the result of rebuildNow()",
    );

    // …and the same reading on the real HTTP surface (the path the suite red took).
    const r = await get(port, "/dashboard");
    assert.equal(r.status, 200);
    assert.match(r.body, /暂无 active GOAL/, "empty state shown — the dashboard reads the caller's store, not the stale incumbent");
  } finally {
    release();
    setDashboardSnapshotStepHook(null);
    handle.stop();
  }
});

test("AC3 property: the periodic tick still never stacks — ticks during an in-flight build start no build", async () => {
  await until(() => !isDashboardSnapshotRebuilding(workspaceRoot), 30_000);
  clearDashboardSnapshots();
  writeGoalFixture();

  let goalCalls = 0;
  const client = countingClient(server.client, () => { goalCalls += 1; });

  let release;
  const held = new Promise((r) => { release = r; });
  let entered = 0;
  setDashboardSnapshotStepHook(async () => { entered += 1; await held; });
  // A 5 ms tick: many tick opportunities per build, i.e. the "连发" the contract is about.
  const handle = startDashboardSnapshotRefresh(workspaceRoot, client, { intervalMs: 5 });
  try {
    assert.ok(
      await until(() => entered > 0 && isDashboardSnapshotRebuilding(workspaceRoot)),
      "the cold build must be in flight for this reading to mean anything",
    );
    const atHold = goalCalls;
    assert.equal(atHold, 1, "only the cold build has run so far");
    // The stimulus: let the tick fire repeatedly (≈40 opportunities) while the build stays in flight.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(
      goalCalls,
      atHold,
      `a tick landing on an in-flight rebuild must start NO build (goalList calls ${atHold} -> ${goalCalls}); rebuilds must not queue up and land at once`,
    );
    assert.equal(isDashboardSnapshotFollowUpQueued(workspaceRoot), false, "and the tick must not queue a follow-up either");
  } finally {
    handle.stop(); // retire the interval BEFORE releasing, so no tick starts a build after the hold
    release();
    setDashboardSnapshotStepHook(null);
  }
  await until(() => !isDashboardSnapshotRebuilding(workspaceRoot), 30_000);
});
