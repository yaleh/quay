// @test-group product
// gap-dashboard-fanin-card-not-in-auto-refresh — 人点名：Dashboard 的 Fan-in 卡（列表 + 锁持有区间
// 时间轴条）只在整页 reload 时更新，30s 轮询对它完全没有效果。`fanin-card` 这个 id 存在于 DOM 里，
// 但 `/dashboard/cards` payload 与刷新脚本的 swap 名单两端都没有它——一个看起来覆盖了的锚点。
// 修法：① payload 加 faninCard；② 刷新脚本加 fanin-card swap；③ 登记完备性判据（防复发）。
// 本测试钉死：
//   AC1 — /dashboard/cards JSON 顶层键包含 faninCard，值非空字符串且内含 id="fanin-card"（端点侧，能取假）。
//   AC2 — /dashboard HTML 的刷新脚本出现 getElementById("fanin-card") 且赋值读 d.faninCard（脚本侧，能取假）。
//   AC3 — 登记完备性：页面 id="*-card" / payload 卡片键 / 脚本 getElementById 三集合互相相等；含负控制。
//   AC4 — renderFanInCardFromRecords 喂 N vs N+1 条记录，列表行数分别为 min(N,5)/min(N+1,5)，首行 task 不同。
//   AC5 — 同一 ?hours= 下，页面 fanin 时间轴分段 == /dashboard/cards 的 faninCard 分段（同一数据同一横轴）。
//   AC6 — 轮询开销（测量，记录进提交信息，非测试断言）。
//   AC7 — scripts/test.sh --for-task（本文件本身即 scoped 门的一部分）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import {
  renderDashboardPage,
  renderDashboardCardRefreshScript,
  renderFanInCard,
  renderFanInCardFromRecords,
  buildCardsPayload,
  checkCardRegistrationCompleteness,
} from "../src/serve-dashboard.ts";
import { renderFanInCell } from "../src/serve-task.ts";
import { readWorkerOutcomeRecords } from "../src/observation.ts";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXED_NOW_MS = 1_700_000_000_000; // deterministic wall-clock anchor for window math

/** The git PRIMARY checkout root — where the drivers write the REAL `.quay/worker-outcome.jsonl`.
 *  The worktree's own `.quay/` is a git-tracked snapshot WITHOUT the gitignored runtime carriers, so
 *  AC5 must resolve the main checkout explicitly rather than read the worktree's stale `.quay`.
 *  Anchored to __dirname (never process.cwd()) — same discipline as the sibling fanin test. */
function mainCheckoutRoot() {
  const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: __dirname, encoding: "utf8" }).trim();
  return path.resolve(__dirname, commonDir, "..");
}

/** Minimal-but-shape-valid dashboard args (the same benign shape the sibling dashboard tests use). */
function makeDashboardArgs(tasks = []) {
  return {
    live: { status: "ok", liveState: "running", inFlight: [], concurrency: 0 },
    sys: {
      resourceGate: { status: "ok", verdict: "GO", cpuStallAvg10: null, loadAvg: null },
      processBudget: { status: "ok", verdict: "GO" },
    },
    mgr: { liveness: { status: "empty", sessions: [] }, loopDriver: { verdict: null } },
    tests: { runs: [], reason: null },
    suiteRun: null,
    history: { status: "empty", commits: [] },
    tasks,
  };
}

/** Benign args for buildCardsPayload (the AC3 check reads only the payload KEYS; values are irrelevant). */
function makeCardsArgs() {
  const base = makeDashboardArgs();
  return {
    live: base.live,
    sys: base.sys,
    mgr: base.mgr,
    tests: base.tests,
    suiteRun: base.suiteRun,
    tasks: base.tasks,
    goals: [],
    workspaceRoot: undefined,
    hours: 3,
    cap: 3,
    staleMs: 0,
  };
}

/** A minimal MechanicalFanInRecord (all other fields null — renderFanInCell reads them null-tolerantly). */
function mfi(acquireEpoch, releaseEpoch, outcome) {
  return {
    outcome,
    step: null,
    reason: null,
    lockHoldSecs: acquireEpoch != null && releaseEpoch != null ? releaseEpoch - acquireEpoch : null,
    lockAcquireEpoch: acquireEpoch,
    lockReleaseEpoch: releaseEpoch,
    suiteFinishedEpoch: null,
    suiteOutcome: null,
    suitePid: null,
    landedSha: null,
    fanInLog: null,
  };
}

/** The fanin-card region of a full dashboard page (from its id= to the next <h2>), so AC5 can read
 *  only the fanin bar's <rect>s — the tests-card bar is earlier in the same grid and must not leak in. */
function faninRegion(html) {
  const start = html.indexOf('id="fanin-card"');
  if (start < 0) return "";
  const end = html.indexOf("<h2>变更记录</h2>", start);
  return end >= 0 ? html.slice(start, end) : html.slice(start);
}

/** The segment sequence of a timeline bar as `x|width` strings — the horizontal-axis conversion of each
 *  segment's [start,end] timestamps (identical x|width ⇔ identical start/end under the same window). */
function rectSeq(html) {
  return [...html.matchAll(/<rect x="([0-9.]+)" y="[0-9.]+" width="([0-9.]+)"/g)].map((m) => `${m[1]}|${m[2]}`);
}

test("AC1 (endpoint): GET /dashboard/cards returns a faninCard key whose value carries id=fanin-card", async () => {
  const { ws, tasksDir } = makeWorkspace("gap-fanin-refresh-");
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const cards = await request(port, "/dashboard/cards");
    assert.equal(cards.status, 200, "GET /dashboard/cards returns 200");
    const payload = JSON.parse(cards.body);
    assert.ok("faninCard" in payload, "payload top-level keys include faninCard (absent before the fix)");
    assert.equal(typeof payload.faninCard, "string", "payload.faninCard is a string");
    assert.ok(payload.faninCard.length > 0, "payload.faninCard is a non-empty string");
    assert.ok(payload.faninCard.includes('id="fanin-card"'), "payload.faninCard carries id=fanin-card");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2 (script): the dashboard HTML's refresh script swaps fanin-card from d.faninCard", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  assert.ok(html.includes('getElementById("fanin-card")'), "the swap script targets fanin-card (grep -c was 0 before the fix)");
  assert.ok(html.includes("d.faninCard"), "the swap reads d.faninCard (not a hardcoded fragment)");
});

test("AC3 (registration completeness): page / payload / script card sets are mutually equal", () => {
  const pageHtml = renderDashboardPage(makeDashboardArgs());
  const script = renderDashboardCardRefreshScript();
  const payload = buildCardsPayload(makeCardsArgs());
  const r = checkCardRegistrationCompleteness(pageHtml, payload, script);
  assert.equal(r.ok, true,
    `card sets must match; pageOnly=${JSON.stringify(r.pageOnly)} payloadOnly=${JSON.stringify(r.payloadOnly)} scriptOnly=${JSON.stringify(r.scriptOnly)}`);
  assert.deepEqual(r.pageCards, r.payloadCards, "page id=*-card set == payload card-key set (kebab-mapped)");
  assert.deepEqual(r.payloadCards, r.scriptCards, "payload card-key set == script getElementById set");
  assert.ok(r.pageCards.includes("fanin-card"), "fanin-card is among the registered cards (the gap this task fixes)");
});

test("AC3 (negative control): a page with one extra card reports red and names the extra card", () => {
  const pageHtml = renderDashboardPage(makeDashboardArgs()) + '<div id="phantom-card"></div>';
  const script = renderDashboardCardRefreshScript();
  const payload = buildCardsPayload(makeCardsArgs());
  const r = checkCardRegistrationCompleteness(pageHtml, payload, script);
  assert.equal(r.ok, false, "the check must FAIL (report red) when the page has a card the payload/script lack");
  assert.ok(r.pageOnly.includes("phantom-card"), `pageOnly must name phantom-card; got ${JSON.stringify(r.pageOnly)}`);
});

test("AC3 (negative control 2): a payload card key the script never swaps reports red", () => {
  const pageHtml = renderDashboardPage(makeDashboardArgs());
  const script = renderDashboardCardRefreshScript();
  const payload = { ...buildCardsPayload(makeCardsArgs()), phantomCard: '<div id="phantom-card"></div>' };
  const r = checkCardRegistrationCompleteness(pageHtml, payload, script);
  assert.equal(r.ok, false, "payload has a card key with no script swap target → red");
  assert.ok(r.payloadOnly.includes("phantom-card"), `payloadOnly must name phantom-card; got ${JSON.stringify(r.payloadOnly)}`);
});

test("AC4: N vs N+1 fan-in records change the list row count AND the first row's task id", () => {
  const nowSec = FIXED_NOW_MS / 1000;
  const base = [
    { ts: null, task: "task-1", mechanical_fan_in: mfi(nowSec - 500, nowSec - 490, "landed") },
    { ts: null, task: "task-2", mechanical_fan_in: mfi(nowSec - 400, nowSec - 390, "red") },
    { ts: null, task: "task-3", mechanical_fan_in: mfi(nowSec - 300, nowSec - 290, "landed") },
  ];
  const plusNew = [
    ...base,
    { ts: null, task: "task-newest", mechanical_fan_in: mfi(nowSec - 100, nowSec - 90, "landed") },
  ];
  const n3 = renderFanInCardFromRecords(base, { hours: 3, nowMs: FIXED_NOW_MS });
  const n4 = renderFanInCardFromRecords(plusNew, { hours: 3, nowMs: FIXED_NOW_MS });

  const rowCount = (html) => (html.match(/href="\/task\//g) || []).length;
  const firstTask = (html) => { const m = html.match(/href="\/task\/([^"]*)"/); return m ? m[1] : null; };

  assert.equal(rowCount(n3), Math.min(3, 5), "N=3 records → 3 list rows (min(3,5))");
  assert.equal(rowCount(n4), Math.min(4, 5), "N+1=4 records → 4 list rows (min(4,5))");
  assert.notEqual(n3, n4, "the two outputs differ — a new landed record actually changes the card");
  assert.equal(firstTask(n4), "task-newest", "the first row is the newest landed task");
  assert.notEqual(firstTask(n3), firstTask(n4), "the first row's task id differs between N and N+1");

  // Cap side: 6 records still cap at 5 list rows (min(6,5)).
  const six = [
    ...base,
    { ts: null, task: "task-4", mechanical_fan_in: mfi(nowSec - 250, nowSec - 240, "landed") },
    { ts: null, task: "task-5", mechanical_fan_in: mfi(nowSec - 150, nowSec - 140, "landed") },
    { ts: null, task: "task-6", mechanical_fan_in: mfi(nowSec - 50, nowSec - 40, "landed") },
  ];
  assert.equal(rowCount(renderFanInCardFromRecords(six, { hours: 3, nowMs: FIXED_NOW_MS })), 5, "6 records → capped at 5 list rows");
});

test("AC5 (window consistency): page fanin timeline segments == cards faninCard segments on real data", (t) => {
  const root = mainCheckoutRoot();
  const hours = 3;
  // 「载体缺席/空」≠「载体在场而谓词为假」（硬规则 3b）：本判据的被测对象是【两条渲染路径是否一致】，
  // 它只有在生产载体真的带 mechanical_fan_in 记录时才有输入。全新 checkout（CI runner / 首次 clone）
  // 上 `.quay/worker-outcome.jsonl` 是 gitignored 运行时产物 ⇒ 根本不存在。
  // 此时 NOT-EVALUATED（t.skip，可区分的第三态），而不是抛 AssertionError ——
  // 后者把「没有输入」伪装成「渲染坏了」。载体在场却渲染不出/两条路径不一致仍须红（回归防护保留）。
  const fanInRecords = readWorkerOutcomeRecords(root).filter((r) => r.mechanical_fan_in != null);
  if (fanInRecords.length === 0) {
    t.skip("NOT-EVALUATED: 生产载体 .quay/worker-outcome.jsonl 缺席或零 mechanical_fan_in 记录（全新 checkout 的正常形态）——无输入可判，不伪装成通过");
    return;
  }
  // Page path: renderDashboardPage passes workspaceRoot + nowMs (opts.nowMs ?? Date.now()).
  const pageHtml = renderDashboardPage(makeDashboardArgs(), { workspaceRoot: root, hours, nowMs: FIXED_NOW_MS });
  // Cards path: buildCardsPayload (→ handleDashboardCards) calls renderFanInCard(workspaceRoot, { hours }).
  const cardsHtml = renderFanInCard(root, { hours });
  const pageSegs = rectSeq(faninRegion(pageHtml));
  const cardsSegs = rectSeq(cardsHtml);

  assert.ok(pageSegs.length >= 1, "real production data renders ≥1 fanin segment in the page");
  assert.ok(cardsSegs.length >= 1, "real production data renders ≥1 fanin segment in the cards payload");

  const mismatches = [];
  const n = Math.max(pageSegs.length, cardsSegs.length);
  for (let i = 0; i < n; i++) {
    if (pageSegs[i] !== cardsSegs[i]) mismatches.push({ i, page: pageSegs[i], cards: cardsSegs[i] });
  }
  assert.equal(mismatches.length, 0,
    `AC5: ${mismatches.length}/${n} segment(s) differ (page=${pageSegs.length}, cards=${cardsSegs.length}); first 3: ` +
    JSON.stringify(mismatches.slice(0, 3)));
});

// gap-dashboard-fanin-card-hide-reason — the dashboard FAN-IN card must NOT render the unbounded
// mfi.reason free text (measured up to 1084 chars), while /task/<id>'s Runs cell keeps the full text.
// The option `showReason` defaults to true (the /task/<id> call site is untouched); the dashboard
// passes false. This test pins the divergence in ONE test (AC3) and that every other field survives
// (AC4), so removing reason never silently breaks the remaining field-join order.
test("hide reason: dashboard card drops long mfi.reason, /task/<id> cell keeps it", () => {
  const longReason = "R".repeat(600) + " UNIQUE-LONG-REASON-MARKER-42";
  assert.ok(longReason.length > 500, "fixture reason exceeds 500 chars");
  const nowSec = FIXED_NOW_MS / 1000;
  const rec = {
    ts: null,
    task: "task-long-reason",
    mechanical_fan_in: {
      ...mfi(nowSec - 500, nowSec - 230, "red"),
      step: "ff",
      reason: longReason,
      suiteOutcome: "suite-red",
      landedSha: "abcdef1234567",
      fanInLog: "fan-in-123.log",
    },
  };

  const cell = renderFanInCell("task-long-reason", rec);
  const dash = renderFanInCardFromRecords([rec], { hours: 3, nowMs: FIXED_NOW_MS });

  // AC3: the two paths diverge on reason, asserted side by side in ONE test.
  assert.ok(cell.includes(longReason), "/task/<id> renderFanInCell STILL renders the reason (default showReason)");
  assert.ok(!dash.includes(longReason), "dashboard renderFanInCardFromRecords does NOT render the reason");

  // AC4: every OTHER field survives the dashboard-path reason removal (join order intact).
  assert.ok(dash.includes("step ff"), "dashboard still renders step");
  assert.ok(dash.includes("lock 270s"), "dashboard still renders lock hold");
  assert.ok(dash.includes("suite suite-red"), "dashboard still renders suite outcome");
  assert.ok(dash.includes("sha <code>abcdef1</code>"), "dashboard still renders landed sha");
  assert.ok(dash.includes(">view</a>"), "dashboard still renders the view link");
  assert.ok(dash.includes(">download</a>"), "dashboard still renders the download link");
});

// ── Integration plumbing (shared with the sibling dashboard tests) ───────────────────────────────

const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

function makeWorkspace(prefix) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}tasks-`));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "fanin auto-refresh fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}
