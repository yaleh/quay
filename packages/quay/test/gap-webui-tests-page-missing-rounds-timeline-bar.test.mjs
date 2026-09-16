// @test-group product
// gap-webui-tests-page-missing-rounds-timeline-bar — 人点名：dashboard 的最近测试记录 bar chart 也应在
// /tests 显示。renderTimelineBarSvg 早已 export 却只被 dashboard 消费，测试的正主页面反而看不到它
// （页面上只有 loadavg curve 与 per-file gantt 两个 svg）。本任务在 /tests 顶部复用该 export（import，
// 不复制渲染逻辑），数据取 verification-round.jsonl 的 round 记录，分段颜色按 state red/green，窗口
// 档位与 dashboard 一致（1h·3h·6h·12h，parseTimelineHours 另允许 1..24 的更长档）。
//
//   AC1  生产载体读数：GET /tests 有 aria-label="过去 3 小时时间轴" 的 svg，且内部 <rect> 分段数 > 0。
//   AC2  复用而非复制：serve-tests.ts 有 `import { renderTimelineBarSvg`，且 0 个 function 定义。
//   AC3  分段数据驱动：全 green N 轮 → 0 红段；N 轮含 M 条 red → M 红段；两次输出不同。
//   AC4  同源同窗口：同一 runs + hours + nowMs，/tests 与 /dashboard 的起止时间戳序列逐条相等、
//        且渲染出的 <rect> 序列逐字节相等；不等时打印差异条数与前 3 条。
//
// Run (scoped): node --test packages/quay/test/gap-webui-tests-page-missing-rounds-timeline-bar.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { renderTestsCard } from "../src/serve-dashboard.ts";
import { renderTestsTimelineBar, buildTestsTimelineSegments } from "../src/serve-tests.ts";
import { startServer } from "../src/serve.ts";
import { clearVerificationRoundCache } from "../src/observation.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_TESTS_SRC = path.join(__dirname, "..", "src", "serve-tests.ts");
const FIXED_NOW_MS = 1_700_000_000_000; // deterministic wall-clock anchor for window math
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// `freePort()` DELETED — probe-then-bind is a TOCTOU over the shared ephemeral-port space, and its
// loopback probe did not even match startServer's 0.0.0.0 bind. Measured EADDRINUSE + the fix (bind
// port 0, read server.address().port) are recorded in packages/quay/test/serve-board.test.mjs.

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** The same fixture-workspace shape as the sibling /tests tests: a bare tasks dir is not a legal
 *  workspace; config is a provider map. Returns { ws, tasksDir }. */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "timeline-bar fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}

/** Seed `.quay/verification-round.jsonl` with `count` parseable rounds (oldest-first). Each round
 *  carries startedAt + durationMs (so the timeline bar has real segments) and a green/red state every
 *  5th round, matching the production ledger's shape. Returns the number of rounds written. */
function seedRounds(ws, count) {
  const t0 = 1_724_374_800_000; // a fixed epoch — the bar anchors to the DATA's latest end, not now
  const lines = [];
  for (let i = 1; i <= count; i++) {
    lines.push(JSON.stringify({
      round: i,
      startedAt: new Date(t0 + i * 60_000).toISOString(),
      durationMs: 30_000 + (i % 7) * 1000,
      state: i % 5 === 0 ? "red" : "green",
      pass: i % 5 === 0 ? 0 : 40,
      fail: i % 5 === 0 ? 3 : 0,
      cancelled: 0,
      tests: 43,
    }));
  }
  fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), lines.join("\n") + "\n");
  return count;
}

/** Extract the `<svg ...aria-label="X"...>...</svg>` block whose aria-label equals `label`. */
function extractSvg(body, label) {
  const m = body.match(new RegExp(`<svg[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?<\\/svg>`));
  return m ? m[0] : null;
}

/** All `<rect ...>` tags in a rendered fragment, in document order. */
const rectSeq = (html) => html.match(/<rect[^>]*>/g) ?? [];

// ── AC1 ──────────────────────────────────────────────────────────────────────────────────────────────

test("AC1: GET /tests renders a svg with aria-label=\"过去 3 小时时间轴\" and >0 <rect> segments", async () => {
  const { ws } = makeWorkspace("gap-timeline-ac1-");
  const cwd0 = process.cwd();
  let server;
  try {
    seedRounds(ws, 60);
    clearVerificationRoundCache();
    process.chdir(ws);
    // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const res = await get(port, "/tests");
    assert.equal(res.status, 200, "GET /tests returns 200");
    // The same aria-label the dashboard's timeline bar carries (both via the shared renderTimelineBarSvg).
    const svg = extractSvg(res.body, "过去 3 小时时间轴");
    assert.ok(svg, "the /tests page has an svg whose aria-label matches the dashboard timeline bar name");
    const rects = (svg.match(/<rect/g) || []).length;
    assert.ok(rects > 0, `the timeline svg has >0 <rect> segments (got ${rects})`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC2 ──────────────────────────────────────────────────────────────────────────────────────────────

test("AC2: serve-tests.ts imports renderTimelineBarSvg (reuse) and defines 0 copies of it", () => {
  const src = fs.readFileSync(SERVE_TESTS_SRC, "utf8");
  assert.ok(src.includes("import { renderTimelineBarSvg"), "serve-tests.ts imports renderTimelineBarSvg (reuse, not copy)");
  const defs = src.split("function renderTimelineBarSvg").length - 1;
  assert.equal(defs, 0, "serve-tests.ts defines 0 `function renderTimelineBarSvg` (no duplicated render logic)");
});

// ── AC3 ──────────────────────────────────────────────────────────────────────────────────────────────

test("AC3: red segment count is data-driven (all-green → 0 red; N-with-M-red → M red; outputs differ)", () => {
  const N = 8;
  const M = 3;
  const mk = (redIndexes) => Array.from({ length: N }, (_, i) => ({
    round: i + 1,
    state: redIndexes.includes(i) ? "red" : "green",
    pass: redIndexes.includes(i) ? 0 : 10,
    tests: 10,
    startedAt: new Date(FIXED_NOW_MS - (N - i) * 60_000).toISOString(),
    durationMs: 30_000,
  }));
  const allGreen = mk([]);
  const withRed = mk([1, 3, 6]); // exactly M = 3 red rounds
  const redCount = (html) => (html.match(/fill="var\(--color-accent-800\)"/g) || []).length;
  const greenSvg = renderTestsTimelineBar(allGreen, 3, FIXED_NOW_MS);
  const mixedSvg = renderTestsTimelineBar(withRed, 3, FIXED_NOW_MS);
  assert.equal(redCount(greenSvg), 0, "all-green input renders 0 red segments");
  assert.equal(redCount(mixedSvg), M, `N rounds with ${M} reds render exactly ${M} red segments`);
  assert.notEqual(greenSvg, mixedSvg, "the two outputs differ (0-red vs M-red cannot be identical)");
});

// ── AC4 ──────────────────────────────────────────────────────────────────────────────────────────────

test("AC4: /tests and /dashboard derive identical segment timestamps and render identical rects", () => {
  const runs = [
    { round: 1, state: "green", pass: 10, tests: 12, startedAt: new Date(FIXED_NOW_MS - 10 * 60_000).toISOString(), durationMs: 30_000 },
    { round: 2, state: "red", pass: 0, tests: 12, startedAt: new Date(FIXED_NOW_MS - 2 * 3_600_000).toISOString(), durationMs: 60_000 },
    { round: 3, state: "green", pass: 11, tests: 12, startedAt: new Date(FIXED_NOW_MS - 5 * 3_600_000).toISOString(), durationMs: 30_000 },
    { round: 4, state: "green", pass: 10, tests: 12, startedAt: null, durationMs: 30_000 }, // unparseable start → skipped
    { round: 5, state: "red", pass: 0, tests: 12, startedAt: new Date(FIXED_NOW_MS - 6 * 3_600_000).toISOString(), durationMs: null }, // no duration → skipped
  ];
  const hours = 6;

  // (a) 起止时间戳序列逐条相等：/tests 的 buildTestsTimelineSegments vs dashboard renderTestsCard 的
  //     同款 map（同源 verification-round.jsonl、同一套 start/end 换算）。不等时打印差异条数与前 3 条。
  const testsSegs = buildTestsTimelineSegments(runs).map((s) => [s.startMs, s.endMs]);
  const dashSegs = runs.map((r) => {
    const startMs = r.startedAt != null ? Date.parse(r.startedAt) : NaN;
    const endMs = Number.isFinite(startMs) && r.durationMs != null ? startMs + r.durationMs : NaN;
    return [startMs, endMs];
  });
  let diff = 0;
  const firstDiffs = [];
  for (let i = 0; i < Math.max(testsSegs.length, dashSegs.length); i++) {
    if (JSON.stringify(testsSegs[i]) !== JSON.stringify(dashSegs[i])) {
      diff++;
      if (firstDiffs.length < 3) firstDiffs.push({ i, tests: testsSegs[i], dash: dashSegs[i] });
    }
  }
  if (diff > 0) console.error(`AC4 timestamp-sequence mismatch: ${diff} differing entries; first 3: ${JSON.stringify(firstDiffs)}`);
  assert.equal(diff, 0, "identical segment start/end timestamp sequences between /tests and /dashboard");

  // (b) 同一套横轴换算 + 同一窗口：两者渲染出的 <rect> 逐字节相等（rect 的 x/width 由共享的
  //     renderTimelineBarSvg 从同一 (start,end) 换算而来——不是各算各的）。
  const dashHtml = renderTestsCard({ status: "ok", reason: null, runs }, null, { hours, nowMs: FIXED_NOW_MS });
  const testsSvg = renderTestsTimelineBar(runs, hours, FIXED_NOW_MS);
  const dashRects = rectSeq(dashHtml);
  const testsRects = rectSeq(testsSvg);
  assert.deepEqual(testsRects, dashRects, "identical rendered <rect> sequences (same data + same axis + same window)");
});
