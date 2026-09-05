// @test-group product
// gap-dashboard-fanin-panel-and-timeline-bars — dashboard 四项改进（F/G/H/I）:
//   F   testsCard 近期列表每行补 startedAt（relativeTime）+ buckets（absent → 不渲染子项，非 "—"）。
//   G   testsCard 下方新增「过去 N 小时」分段着色时间轴（服务端渲染 SVG，每段一个 <rect>）。
//   H   新增 Fan-in 卡片（跨任务 mechanical_fan_in 列表，lockAcquireEpoch 倒序，复用 renderFanInCell）
//       + 同款分段 bar（区间 [lockAcquireEpoch, lockReleaseEpoch]，outcome landed/red 配色）。
//   I   liveCard 在飞列表每行补任务 title（join 同请求的 readTaskSummary）。
//   窗口配置：/dashboard + /dashboard/cards 读 ?hours=（默认 3，钳 [1,24]，非法/超界回退默认 3）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
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
  renderTestsCard,
  renderLiveCard,
  renderDashboardPage,
  renderFanInCardFromRecords,
  parseTimelineHours,
  DEFAULT_TIMELINE_HOURS,
} from "../src/serve-dashboard.ts";
import { relativeTime } from "../src/serve-render.ts";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");
const FIXED_NOW_MS = 1_700_000_000_000; // deterministic wall-clock anchor for window math

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

test("AC1 (F): recentRuns row renders a relativeTime string + raw buckets; absent → no sub-item", () => {
  const startedAtMs = Date.now() - 5 * 60_000; // 5m ago → relativeTime is "5m ago"
  const present = renderTestsCard({
    status: "ok",
    reason: null,
    runs: [{ round: 7, state: "green", pass: 40, tests: 44, durationMs: 30_000, startedAt: new Date(startedAtMs).toISOString(), buckets: "full" }],
  }, null);
  assert.ok(present.includes("full"), "the raw buckets value renders verbatim");
  assert.ok(present.includes(relativeTime(startedAtMs)), "a relativeTime-produced time string renders");

  // Both fields null/undefined → NO sub-item for either (absent-field contract, never a "—" placeholder).
  const absent = renderTestsCard({
    status: "ok",
    reason: null,
    runs: [{ round: 8, state: "green", pass: 1, tests: 2, durationMs: 1000, startedAt: null, buckets: undefined }],
  }, null);
  assert.ok(!/ago/.test(absent), "absent startedAt renders no relative-time string");
  assert.ok(!absent.includes("bucket"), "absent buckets renders no bucket sub-item");
});

test("AC2: renderTimelineBarSvg is defined once and called from both G and H", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const defs = src.split("function renderTimelineBarSvg").length - 1;
  assert.equal(defs, 1, "exactly one `function renderTimelineBarSvg` definition");
  const calls = src.split("renderTimelineBarSvg(").length - 1;
  assert.ok(calls >= 3, `renderTimelineBarSvg( appears ≥3 times (1 def + G + H calls), got ${calls}`);
});

test("AC3 (G): testsCard timeline <rect> count == in-window parseable records", () => {
  const runs = [
    // in window, parseable → rect
    { round: 1, state: "green", pass: 1, tests: 2, startedAt: new Date(FIXED_NOW_MS - 10 * 60_000).toISOString(), durationMs: 30_000 },
    // in window, parseable → rect
    { round: 2, state: "red", pass: 0, tests: 2, startedAt: new Date(FIXED_NOW_MS - 2 * 3_600_000).toISOString(), durationMs: 60_000 },
    // out of window (4h ago) → no rect
    { round: 3, state: "green", pass: 1, tests: 2, startedAt: new Date(FIXED_NOW_MS - 4 * 3_600_000).toISOString(), durationMs: 30_000 },
    // unparseable startedAt (null) → no rect
    { round: 4, state: "green", pass: 1, tests: 2, startedAt: null, durationMs: 30_000 },
    // unparseable durationMs (null) → no rect
    { round: 5, state: "green", pass: 1, tests: 2, startedAt: new Date(FIXED_NOW_MS - 20 * 60_000).toISOString(), durationMs: null },
  ];
  const html = renderTestsCard({ status: "ok", reason: null, runs }, null, { hours: 3, nowMs: FIXED_NOW_MS });
  const rects = (html.match(/<rect/g) || []).length;
  assert.equal(rects, 2, "only the 2 in-window parseable records render a <rect> (not merely 'SVG exists')");
});

test("AC4 (H list): sorted by lockAcquireEpoch desc, renders outcome+task, drops null mechanical_fan_in", () => {
  const records = [
    { ts: null, task: "task-low", mechanical_fan_in: mfi(100, 104, "red") },
    { ts: null, task: "task-no-fan", mechanical_fan_in: null },
    { ts: null, task: "task-high", mechanical_fan_in: mfi(300, 305, "landed") },
    { ts: null, task: "task-mid", mechanical_fan_in: mfi(200, 204, "landed") },
  ];
  const html = renderFanInCardFromRecords(records, { hours: 3, nowMs: FIXED_NOW_MS });
  assert.ok(html.includes("task-high") && html.includes("task-mid") && html.includes("task-low"), "each row carries its task id");
  assert.ok(html.indexOf("task-high") < html.indexOf("task-mid"), "desc order: lockAcquireEpoch 300 before 200");
  assert.ok(html.indexOf("task-mid") < html.indexOf("task-low"), "desc order: lockAcquireEpoch 200 before 100");
  assert.ok(html.includes("<strong>landed</strong>") && html.includes("<strong>red</strong>"), "each row renders its own outcome");
  assert.ok(!html.includes("task-no-fan"), "a mechanical_fan_in == null record is filtered out");
});

test("AC5① (H mount): renderDashboardPage HTML carries id=\"fanin-card\"", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  assert.ok(html.includes('id="fanin-card"'), "the fan-in card mounts with id=fanin-card");
});

test("AC5② (H bar): fan-in card SVG <rect> count == in-window parseable lock intervals", () => {
  const nowSec = FIXED_NOW_MS / 1000;
  const records = [
    // in window (10m ago) → rect
    { ts: null, task: "t1", mechanical_fan_in: mfi(nowSec - 600, nowSec - 590, "landed") },
    // in window (2h ago) → rect
    { ts: null, task: "t2", mechanical_fan_in: mfi(nowSec - 7200, nowSec - 7190, "red") },
    // out of window (4h ago) → no rect
    { ts: null, task: "t3", mechanical_fan_in: mfi(nowSec - 14400, nowSec - 14390, "landed") },
    // unparseable (null lock epochs) → no rect
    { ts: null, task: "t4", mechanical_fan_in: mfi(null, null, "landed") },
  ];
  const html = renderFanInCardFromRecords(records, { hours: 3, nowMs: FIXED_NOW_MS });
  const rects = (html.match(/<rect/g) || []).length;
  assert.equal(rects, 2, "only the 2 in-window parseable lock intervals render a <rect>");
});

test("AC6① (I): renderLiveCard renders the in-flight task title in full", () => {
  const title = "Dashboard 四项改进：testsCard 补 startedAt/bucket";
  const live = {
    status: "ok",
    liveState: "running",
    concurrency: 1,
    inFlight: [{ taskId: "T-1", phase: "implementing", startedAtMs: FIXED_NOW_MS - 60_000 }],
  };
  const html = renderLiveCard(live, FIXED_NOW_MS, [{ id: "T-1", title }]);
  assert.ok(html.includes(title), "liveMiniList renders the task title in full");
});

test("AC6② (I): handleDashboardCards also reads readTaskSummary (not only handleDashboard)", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const calls = src.split("readTaskSummary(cfg.workspaceRoot, client)").length - 1;
  assert.ok(calls >= 2, `readTaskSummary(cfg.workspaceRoot, client) appears ≥2 times (handleDashboard + handleDashboardCards), got ${calls}`);
});

test("AC7 (window actually filters): hours=3 vs hours=6 produce different segment counts", () => {
  const runs = [
    { round: 1, state: "green", pass: 1, tests: 2, startedAt: new Date(FIXED_NOW_MS - 1 * 3_600_000).toISOString(), durationMs: 30_000 },
    { round: 2, state: "green", pass: 1, tests: 2, startedAt: new Date(FIXED_NOW_MS - 4 * 3_600_000).toISOString(), durationMs: 30_000 },
  ];
  const h3 = renderTestsCard({ status: "ok", reason: null, runs }, null, { hours: 3, nowMs: FIXED_NOW_MS });
  const h6 = renderTestsCard({ status: "ok", reason: null, runs }, null, { hours: 6, nowMs: FIXED_NOW_MS });
  const rect3 = (h3.match(/<rect/g) || []).length;
  const rect6 = (h6.match(/<rect/g) || []).length;
  assert.equal(rect3, 1, "3h window: only the 1h-ago record renders");
  assert.equal(rect6, 2, "6h window: both records render (the 4h-ago record now lands inside)");
  assert.notEqual(rect3, rect6, "the window parameter is read AND actually filters segments");
});

test("AC7 (default/illegal fallback): parseTimelineHours falls back to 3 without throwing", () => {
  assert.equal(DEFAULT_TIMELINE_HOURS, 3, "default window is 3h");
  assert.equal(parseTimelineHours(null), 3, "missing hours → default 3");
  assert.equal(parseTimelineHours(undefined), 3, "undefined hours → default 3");
  assert.equal(parseTimelineHours(""), 3, "empty hours → default 3");
  assert.equal(parseTimelineHours("abc"), 3, "illegal hours → default 3");
  assert.equal(parseTimelineHours("0"), 3, "out-of-range 0 → default 3");
  assert.equal(parseTimelineHours("999"), 3, "out-of-range 999 → default 3");
  assert.equal(parseTimelineHours("1.5"), 3, "non-integer → default 3");
  assert.equal(parseTimelineHours("6"), 6, "valid 6 → 6");
  assert.equal(parseTimelineHours("1"), 1, "valid 1 → 1");
  assert.equal(parseTimelineHours("24"), 24, "valid 24 → 24");
});

// ── Integration: illegal/missing hours → HTTP 200 (fallback, never an error) ─────────────────────

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
  fs.writeFileSync(path.join(ws, "README.md"), "fanin-timeline fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}

test("AC7 (HTTP): illegal/missing hours → HTTP 200 with the default-3 window; ?hours=6 → 6h window", async () => {
  const { ws, tasksDir } = makeWorkspace("gap-faninbars-");
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    for (const p of ["/dashboard", "/dashboard?hours=abc", "/dashboard?hours=0", "/dashboard?hours=999"]) {
      const res = await request(port, p);
      assert.equal(res.status, 200, `GET ${p} returns 200 (illegal/missing hours never error)`);
      assert.ok(res.body.includes("时间轴窗口（当前 3h）"), `GET ${p} falls back to the default 3h window`);
    }

    const six = await request(port, "/dashboard?hours=6");
    assert.equal(six.status, 200, "GET /dashboard?hours=6 returns 200");
    assert.ok(six.body.includes("时间轴窗口（当前 6h）"), "GET /dashboard?hours=6 reflects the 6h window");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
