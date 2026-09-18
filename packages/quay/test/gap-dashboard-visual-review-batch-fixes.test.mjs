// @test-group product
// gap-dashboard-visual-review-batch-fixes — 人工走查产出六项 dashboard 改进的一批落地:
//   AC1 — mgrCard 改读 promotion/worker 两个 resident driver 的存活状态（gap-dashboard-driver-status-card
//         取代退役的 liveness/loop-driver 探针）；读数缺失 ⇒ 渲染「未运行」，绝不渲染 undefined/NaN/空。
//   AC2 — liveCard 每行带在飞耗时（复用 formatSuiteElapsed），固定 startedAtMs/nowMs 可断言字符串。
//   AC3 — taskCard miniList 分组标题 font-weight ≥600 且严格大于任务 id 的 font-weight（源级断言）。
//   AC4 — testsCard 近期列表（非 running 轮）默认可见「#轮次 state · pass X/Y · 耗时」，顺序=新→旧。
//   AC5 — /dashboard/cards 返回 5 张卡片段；/dashboard 页面携带 id=sys-card/mgr-card/task-card。
//   AC6 — /dashboard/cards 载荷含 sysRaw{cpuStallAvg10,loadAvg,ts}；源里 "sys-sparkline" 出现 ≥2 处
//         （渲染占位 + 轮询脚本重绘）；源里 fs.writeFile/appendFile 出现 0 处（服务端零持久化）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { dashboardLabelsFor } from "../src/serve-i18n.ts";
import { renderLiveCard, renderMgrCard, renderTestsCard, renderDashboardPage, sparklineSvg, renderDashboardCardRefreshScript } from "../src/serve-dashboard.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");

/** Minimal-but-shape-valid dashboard args (the same benign shape the sibling dashboard tests use). */
function makeDashboardArgs(tasks = []) {
  return {
    live: { status: "ok", liveState: "running", inFlight: [], concurrency: 0 },
    sys: {
      resourceGate: { status: "ok", verdict: "GO", cpuStallAvg10: null, loadAvg: null },
      processBudget: { status: "ok", verdict: "GO" },
    },
    mgr: { liveness: { status: "empty", sessions: [], reason: "liveness observer retired 2026-09-03" }, loopDriver: { verdict: null } },
    tests: { runs: [], reason: null },
    suiteRun: null,
    history: { status: "empty", commits: [] },
    tasks,
  };
}

test("AC1: mgrCard renders the resident drivers' honest alive status (未运行 when absent, never undefined/NaN)", () => {
  // Absent drivers reading (the dashboard error fallback) → 「未运行」, never undefined/NaN/empty
  // (gap-dashboard-driver-status-card: the retired liveness/loop-driver probe is no longer read).
  const absent = renderMgrCard({}, "zh");
  assert.ok(!/undefined|NaN/.test(absent), "absent drivers never leak undefined/NaN");
  assert.ok(absent.includes("未接入"), "absent drivers render the honest 未接入 phrase");

  // Kinds running → each kind named with the alive text (运行中), the positive control. The reading
  // is now an ARRAY (DriversReading = DriverKindReading[]) — one entry per kind, each carrying its own
  // `kind` field (gap-dashboard-driver-status-card AC6: traverse KNOWN_KINDS, not hardcoded fields).
  const running = renderMgrCard({
    drivers: [
      { kind: "promotion", supervisorPid: 1, driverPid: 2, supervisorAlive: true, driverAlive: true, running: true, records: 3, lastTs: new Date().toISOString() },
      { kind: "worker", supervisorPid: 1, driverPid: 2, supervisorAlive: true, driverAlive: true, running: true, records: 3, lastTs: new Date().toISOString() },
    ],
  }, "zh");
  assert.ok(running.includes("promotion"), "running renders the promotion kind");
  assert.ok(running.includes("worker"), "running renders the worker kind");
  assert.ok(running.includes("运行中"), "running renders the 运行中 alive text");
});

test("AC2: renderLiveCard renders an elapsed duration per in-flight row from fixed startedAtMs/nowMs", () => {
  const nowMs = 1_700_000_000_000;
  const live = {
    status: "ok",
    liveState: "running",
    concurrency: 1,
    inFlight: [{ taskId: "T-1", phase: "implementing", startedAtMs: nowMs - 754_000 }],
  };
  const html = renderLiveCard(live, nowMs, undefined, undefined, undefined, "zh");
  assert.ok(html.includes("12m34s"), "in-flight row carries the 754s → 12m34s elapsed string");
});

/** Extract the `const miniList = (…) => { … }` arrow-function body from the source (balanced braces). */
function miniListBody(src) {
  const start = src.indexOf("const miniList = ");
  assert.ok(start >= 0, "miniList declaration found in source");
  const open = src.indexOf("{", start);
  assert.ok(open >= 0, "miniList body opening brace found");
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("miniList body not terminated");
}

test("AC3: miniList group heading font-weight ≥600 and strictly greater than the task-id anchor's", () => {
  const body = miniListBody(fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8"));
  const weights = [...body.matchAll(/font-weight:(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(weights.length >= 2, `miniList body carries heading + anchor font-weights (got ${weights.length})`);
  const headingW = weights[0];
  const anchorW = weights[1];
  assert.ok(headingW >= 600, `group-heading font-weight ${headingW} is ≥600`);
  assert.ok(anchorW < headingW, `task-id anchor font-weight ${anchorW} is strictly < heading ${headingW}`);
});

test("AC4: renderTestsCard renders a readable recent-run list (round · pass X/Y · duration), new→old", () => {
  const tests = {
    status: "ok",
    reason: null,
    runs: [
      { round: 12, state: "green", pass: 45, tests: 50, durationMs: 754_000 },
      { round: 11, state: "red", pass: 40, tests: 50, durationMs: 123_000 },
    ],
  };
  const html = renderTestsCard(tests, null, { lang: "zh" });
  assert.ok(html.includes("#12") && html.includes("#11"), "round numbers render");
  assert.ok(html.includes("pass 45/50") && html.includes("pass 40/50"), "pass X/Y renders per round");
  assert.ok(html.includes("12m34s"), "round 12 duration renders (754000ms → 12m34s)");
  assert.ok(html.includes("2m3s"), "round 11 duration renders (123000ms → 2m3s)");
  assert.ok(html.indexOf("#12") < html.indexOf("#11"), "rounds ordered new→old (#12 before #11)");
  assert.ok(html.indexOf("12m34s") < html.indexOf("2m3s"), "per-round durations follow the same new→old order");
});

test("AC5: renderDashboardPage carries the three new auto-refresh container ids", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  assert.ok(html.includes('id="sys-card"'), "sysCard carries id=sys-card");
  assert.ok(html.includes('id="mgr-card"'), "mgrCard carries id=mgr-card");
  assert.ok(html.includes('id="task-card"'), "taskCard carries id=task-card");
});

test("AC6②③: sys-sparkline appears ≥2 places (placeholder + script redraw), and no fs write/append", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const spark = src.split("sys-sparkline").length - 1;
  assert.ok(spark >= 2, `sys-sparkline appears ≥2 times (render placeholder + client redraw), got ${spark}`);
  assert.ok(!/fs\.(write|append)File/.test(src), "serve-dashboard.ts carries no fs.writeFile/fs.appendFile");
});

// ── Integration: /dashboard/cards returns the five card fragments + sysRaw ────────────────────────

const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// `freePort()` DELETED — probe-then-bind is a TOCTOU over the shared ephemeral-port space, and its
// loopback probe did not even match startServer's 0.0.0.0 bind. Measured EADDRINUSE + the fix (bind
// port 0, read server.address().port) are recorded in packages/quay/test/serve-board.test.mjs.

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
  fs.writeFileSync(path.join(ws, "README.md"), "visual-review fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}

test("AC5/AC6①: /dashboard/cards returns live/tests/sys/mgr/task fragments + a 3-field sysRaw snapshot", async () => {
  const { ws, tasksDir } = makeWorkspace("gap-visualreview-");
  const cwd0 = process.cwd();
  let server;
  try {
    process.chdir(ws);
    // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const cards = await request(port, "/dashboard/cards");
    assert.equal(cards.status, 200, "GET /dashboard/cards returns 200");
    assert.equal(cards.headers["cache-control"], "no-store", "/dashboard/cards is no-store");
    const payload = JSON.parse(cards.body);
    for (const key of ["liveCard", "testsCard", "sysCard", "mgrCard", "taskCard"]) {
      assert.equal(typeof payload[key], "string", `payload.${key} is a string fragment`);
    }
    assert.ok(typeof payload.sysRaw === "object" && payload.sysRaw !== null, "payload.sysRaw is an object");
    assert.ok("cpuStallAvg10" in payload.sysRaw, "sysRaw carries cpuStallAvg10");
    assert.ok("loadAvg" in payload.sysRaw, "sysRaw carries loadAvg");
    assert.equal(typeof payload.sysRaw.ts, "number", "sysRaw.ts is a server-side epoch-ms number");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── gap-dashboard-syscard-sparkline-legend-labels (legend / min-max-latest / time-span / threshold) ──

/** Local hh:mm mirror of the sparkline's own formatter — the test computes the expected label the
 *  SAME way the renderer does (new Date(ts).getHours/getMinutes), so the assertion is verbatim
 *  regardless of the host timezone. */
function hhmm(ms) {
  const d = new Date(ms);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Fixed 3-point history with unambiguous min/max/latest per series (cpu: 10/50/30, load: 1.5/4.5/2.5)
 *  and two distinct ts values, so every AC asserts EXACT numbers, not a fuzzy "some digit is present". */
const SPARK_HISTORY = [
  { cpu: 10, load: 1.5, ts: 1700000000000 },
  { cpu: 50, load: 4.5, ts: 1700000060000 },
  { cpu: 30, load: 2.5, ts: 1700000120000 },
];

test("AC1: refresh script carries the two legend labels and their exact colour tokens", () => {
  const script = renderDashboardCardRefreshScript();
  for (const lit of ["cpu_stall", "loadavg", "--color-accent-600", "--color-positive-700"]) {
    assert.ok(script.includes(lit), `script string contains ${lit}`);
  }
});

test("AC2: sparklineSvg renders the exact min/max/latest values for a fixed history", () => {
  const svg = sparklineSvg(SPARK_HISTORY, null);
  // cpu_stall: min 10, max 50, latest 30
  assert.ok(svg.includes(">10<"), "cpu min value 10 renders");
  assert.ok(svg.includes(">50<"), "cpu max value 50 renders");
  assert.ok(svg.includes(">30<"), "cpu latest value 30 renders");
  // loadavg: min 1.5, max 4.5, latest 2.5
  assert.ok(svg.includes(">1.5<"), "load min value 1.5 renders");
  assert.ok(svg.includes(">4.5<"), "load max value 4.5 renders");
  assert.ok(svg.includes(">2.5<"), "load latest value 2.5 renders");
});

test("AC3: sysHistory.push records ts and the time-span labels match earliest/latest hh:mm", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  assert.ok(src.includes("ts: d.sysRaw.ts"), "sysHistory.push writes the ts field from sysRaw.ts");
  const svg = sparklineSvg(SPARK_HISTORY, null);
  const earliest = hhmm(1700000000000);
  const latest = hhmm(1700000120000);
  assert.ok(svg.includes(">" + earliest + "<"), `earliest label ${earliest} renders verbatim`);
  assert.ok(svg.includes(">" + latest + "<"), `latest label ${latest} renders verbatim`);
});

test("AC4: threshold reference line drawn only when loadThreshold is present", () => {
  // in-range threshold (load data 1.5..4.5) → line at its true position + value label.
  // gap-webui-dashboard-body-copy-en-zh: the threshold WORD is now a caller-supplied template
  // (sparklineSvg's source is serialized into the client script via Function#toString, so the
  // browser has no dictionary to look one up in — see the parameter's doc). The zh template is
  // passed explicitly here; the module no longer bakes a word into the function.
  const THR = dashboardLabelsFor("zh").sparkThreshold;
  const withThreshold = sparklineSvg(SPARK_HISTORY, 3, THR);
  assert.ok(withThreshold.includes('class="spark-threshold"'), "non-null loadThreshold draws the reference line");
  assert.ok(withThreshold.includes("阈 3"), "the threshold value is labelled");
  // out-of-range threshold still renders (clamped to the plot edge), never dropped.
  const aboveRange = sparklineSvg(SPARK_HISTORY, 8, THR);
  assert.ok(aboveRange.includes('class="spark-threshold"'), "above-range loadThreshold still draws the clamped line");
  const withoutThreshold = sparklineSvg(SPARK_HISTORY, null, THR);
  assert.ok(!withoutThreshold.includes("spark-threshold"), "null loadThreshold draws no reference line");
  assert.ok(!withoutThreshold.includes("阈 "), "no fabricated default threshold label");
  // A caller that supplies NO template degrades to the bare number — ⛔ never to some other
  // language's word chosen on the caller's behalf (硬规则 3b).
  const noTemplate = sparklineSvg(SPARK_HISTORY, 3);
  assert.ok(noTemplate.includes(">3<"), "an absent template still renders the value, wordless");
  assert.ok(!noTemplate.includes("{value}"), "the placeholder itself never reaches the page");
});

test("AC5: no server-side fs write/append path added (zero-persistence contract)", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const writes = src.match(/fs\.(write|append)FileSync?/g) ?? [];
  assert.equal(writes.length, 0, "serve-dashboard.ts carries no fs.writeFile/appendFile call");
});
