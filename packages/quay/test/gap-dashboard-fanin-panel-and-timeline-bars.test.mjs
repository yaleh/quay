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
  renderFanInCard,
  renderFanInCardFromRecords,
  renderTimelineBarSvg,
  parseTimelineHours,
  DEFAULT_TIMELINE_HOURS,
} from "../src/serve-dashboard.ts";
import { relativeTime } from "../src/serve-render.ts";
import { readTests, readWorkerOutcomeRecords } from "../src/observation.ts";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");
const FIXED_NOW_MS = 1_700_000_000_000; // deterministic wall-clock anchor for window math

/** The git PRIMARY checkout root — where the drivers write the REAL `.quay/*.jsonl` runtime data.
 *  The worktree's own `.quay/` is a git-tracked snapshot WITHOUT the gitignored runtime carriers
 *  (worker-outcome.jsonl / verification-round.jsonl), so AC7 (production regression) must resolve
 *  the main checkout explicitly rather than read the worktree's stale `.quay`.
 *
 *  gap-dashboard-fanin-timestamp-timeline-anchor AC7 fix: `git rev-parse --git-common-dir` may print
 *  a path RELATIVE to the subprocess cwd (`__dirname`) — e.g. `../../../.git` when this test runs out
 *  of the MAIN checkout's test dir (not a linked worktree, where it prints absolute). So the result
 *  MUST be anchored to `__dirname` (`path.resolve(__dirname, commonDir, "..")`), never to the calling
 *  process's `process.cwd()` — the two differ when the test is invoked from the repo root (the way
 *  scripts/test.sh runs it), and the old `path.resolve(commonDir, "..")` resolved `../../../.git`
 *  against cwd to the WRONG root. Anchoring to `__dirname` makes it absolute-agnostic: a relative
 *  `commonDir` resolves against `__dirname`, an absolute one resets the prefix — both correct. */
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
  assert.ok(html.includes('<span class="tag tag-positive">landed</span>') && html.includes('<span class="tag tag-accent">red</span>'), "each row renders its own outcome as a tag badge");
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
  // Anchor the window to the LATEST event's end (round 1 ends exactly at FIXED_NOW_MS), so the 3h/6h
  // difference is measured from the most recent real event — NOT the wall-clock now. Under the old
  // "window end == now" assumption this fixture landed round 2 exactly on the 3h boundary and changed
  // meaning when the anchor moved (gap-dashboard-fanin-timestamp-timeline-anchor).
  const runs = [
    { round: 1, state: "green", pass: 1, tests: 2, startedAt: new Date(FIXED_NOW_MS - 30_000).toISOString(), durationMs: 30_000 },
    { round: 2, state: "green", pass: 1, tests: 2, startedAt: new Date(FIXED_NOW_MS - 4 * 3_600_000).toISOString(), durationMs: 30_000 },
  ];
  const h3 = renderTestsCard({ status: "ok", reason: null, runs }, null, { hours: 3, nowMs: FIXED_NOW_MS });
  const h6 = renderTestsCard({ status: "ok", reason: null, runs }, null, { hours: 6, nowMs: FIXED_NOW_MS });
  const rect3 = (h3.match(/<rect/g) || []).length;
  const rect6 = (h6.match(/<rect/g) || []).length;
  assert.equal(rect3, 1, "3h window: only the record within 3h of the latest end renders");
  assert.equal(rect6, 2, "6h window: the 4h-older record also renders (window widened from the latest end)");
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

// ── gap-dashboard-fanin-timestamp-timeline-anchor: timestamp + window-end anchor fixes ─────────────

test("AC1 (fan-in timestamp): each row renders relativeTime(key*1000) verbatim", () => {
  const acquireEpoch = 1_600_000_000; // fixed lockAcquireEpoch (seconds) — the row's sort key
  const records = [
    { ts: null, task: "t-recent", mechanical_fan_in: mfi(acquireEpoch, acquireEpoch + 4, "landed") },
    { ts: null, task: "t-older", mechanical_fan_in: mfi(acquireEpoch - 2 * 86_400, acquireEpoch - 2 * 86_400 + 4, "red") },
  ];
  const html = renderFanInCardFromRecords(records, { hours: 3, nowMs: FIXED_NOW_MS });
  // Verbatim compare against relativeTime(fixedEpoch*1000) — NOT a fuzzy /ago|前/ match. The two keys
  // are 2 days apart so each row's expected string is distinct (each assertion proves ITS row's key).
  assert.ok(html.includes(relativeTime(acquireEpoch * 1000)), "recent row renders relativeTime(lockAcquireEpoch*1000) verbatim");
  assert.ok(html.includes(relativeTime((acquireEpoch - 2 * 86_400) * 1000)), "older row renders relativeTime of its OWN key verbatim");
});

test("AC2 (tests bar anchor): windowEnd=latest end → non-empty; windowEnd=now → 0 (counterexample)", () => {
  // All records fall in [nowMs-10h, nowMs-7h] — the loop has been stalled ~7h. A 3h window anchored to
  // wall-clock now is EMPTY; anchored to the latest record's end it is NOT.
  const nowMs = FIXED_NOW_MS;
  const runs = [
    { round: 1, state: "green", pass: 1, tests: 2, startedAt: new Date(nowMs - 8 * 3_600_000).toISOString(), durationMs: 30_000 },
    { round: 2, state: "red", pass: 0, tests: 2, startedAt: new Date(nowMs - 7 * 3_600_000).toISOString(), durationMs: 30_000 },
  ];
  // ① new implementation: windowEnd = latest record end (nowMs - 7h + 30s) → both records intersect.
  const html = renderTestsCard({ status: "ok", reason: null, runs }, null, { hours: 3, nowMs });
  const rects = (html.match(/<rect/g) || []).length;
  assert.ok(rects >= 1, "anchored to the latest end, the 3h bar is non-empty");

  // ② counterexample: force the OLD behaviour (anchor the SAME segments to wall-clock now) → 0 <rect>.
  const segments = runs.map((r) => ({
    startMs: Date.parse(r.startedAt),
    endMs: Date.parse(r.startedAt) + r.durationMs,
    colorVar: "--color-positive-700",
  }));
  const oldSvg = renderTimelineBarSvg(segments, 3, nowMs);
  const oldRects = (oldSvg.match(/<rect/g) || []).length;
  assert.equal(oldRects, 0, "the SAME segments anchored to wall-clock now produce 0 <rect> (proves ① measured the anchor change, not a coincidence)");
});

test("AC3 (fan-in bar anchor): windowEnd=latest release → non-empty; windowEnd=now → 0 (counterexample)", () => {
  const nowSec = FIXED_NOW_MS / 1000;
  // Last fan-in 7h ago — loop stalled. A 3h window anchored to now is empty; to the latest release it
  // is not.
  const records = [
    { ts: null, task: "t-latest", mechanical_fan_in: mfi(nowSec - 7 * 3600, nowSec - 7 * 3600 + 60, "landed") },
    { ts: null, task: "t-older", mechanical_fan_in: mfi(nowSec - 8 * 3600, nowSec - 8 * 3600 + 60, "red") },
  ];
  const html = renderFanInCardFromRecords(records, { hours: 3, nowMs: FIXED_NOW_MS });
  const rects = (html.match(/<rect/g) || []).length;
  assert.ok(rects >= 1, "anchored to the latest release, the 3h fan-in bar is non-empty");

  const segments = records.map((r) => {
    const m = r.mechanical_fan_in;
    return { startMs: m.lockAcquireEpoch * 1000, endMs: m.lockReleaseEpoch * 1000, colorVar: "--color-positive-700" };
  });
  const oldSvg = renderTimelineBarSvg(segments, 3, FIXED_NOW_MS);
  const oldRects = (oldSvg.match(/<rect/g) || []).length;
  assert.equal(oldRects, 0, "the SAME segments anchored to wall-clock now produce 0 <rect> (anchor change, not coincidence)");
});

test("AC4 (windowEndMs naming/role): signature params are segments, windowHours, windowEndMs; ≥3 hits", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const count = src.split("windowEndMs").length - 1;
  assert.ok(count >= 3, `windowEndMs appears ≥3 times (signature + call-site computations), got ${count}`);
  const sigStart = src.indexOf("function renderTimelineBarSvg(");
  const sigEnd = src.indexOf("): string {", sigStart);
  assert.ok(sigStart >= 0 && sigEnd > sigStart, "renderTimelineBarSvg signature found");
  const sig = src.slice(sigStart, sigEnd);
  const iSegments = sig.indexOf("segments");
  const iHours = sig.indexOf("windowHours");
  const iEnd = sig.indexOf("windowEndMs");
  assert.ok(iSegments >= 0 && iHours > iSegments && iEnd > iHours, "signature params are segments, windowHours, windowEndMs (in order)");
  assert.ok(!sig.includes("nowMs"), "the signature no longer names a nowMs param");
});

test("AC5 (copy): the window hint names 结束时刻为终点 / 最近一次运行/fan-in", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  assert.ok(src.includes("结束时刻为终点"), "the window hint states the anchor is the event end time");
  assert.ok(src.includes("最近一次运行/fan-in"), "the window hint names both the tests and fan-in anchors");
});

test("AC7 (production regression): real .quay data renders ≥1 <rect> in BOTH cards", (t) => {
  // Reads the REAL production carriers (no fixture, no injection) via the main checkout root, with
  // nowMs = real Date.now(). Under the OLD "window end == now" behaviour this failed whenever the loop
  // had been stalled longer than the window; the fix anchors to each card's last real event, so the
  // latest record always renders.
  //
  // gap-ci-suite-red-on-fresh-checkout-beyond-config-yml (Class A) 修正：原注释写「deliberately NO
  // skip/bypass path」。该直觉对【绕开关】是对的，但把两件事混成了一件：
  //   (a) 载体在场 ⇒ 必须断言（回归防护，绝不能绕）；
  //   (b) 载体缺席 ⇒ 无被测输入（全新 checkout / CI runner 上 `.quay/*.jsonl` 是 gitignored 运行时产物）。
  // (b) 抛 AssertionError 是硬规则 3b 的形态：「读不懂/没有输入」伪装成「检查失败」。
  // 修法是给「无法评估」独立取值（t.skip），且**逐载体**判定 —— 跳过键在【载体空】上，
  // 不在【断言失败】上，故 (a) 的强度分毫未减：只要某载体有记录，它的断言照跑。
  const root = mainCheckoutRoot();
  const hasFanIn = readWorkerOutcomeRecords(root).some((r) => r.mechanical_fan_in != null);
  const tests = readTests(root);
  const hasTests = (tests.runs ?? []).length > 0;
  if (!hasFanIn && !hasTests) {
    t.skip("NOT-EVALUATED: 两个生产载体（worker-outcome.jsonl / verification-round.jsonl）均缺席或为空——全新 checkout 的正常形态，无输入可判");
    return;
  }
  const fanInHtml = renderFanInCard(root, { hours: 3 });
  const testsHtml = renderTestsCard(tests, null, { hours: 3 });
  if (hasFanIn) {
    assert.ok((fanInHtml.match(/<rect/g) || []).length >= 1, "fan-in bar renders ≥1 <rect> from real worker-outcome.jsonl");
  }
  if (hasTests) {
    assert.ok((testsHtml.match(/<rect/g) || []).length >= 1, "tests bar renders ≥1 <rect> from real verification-round.jsonl");
  }
});

test("AC7 (cwd-independence): mainCheckoutRoot() resolves the SAME main checkout from two cwd", () => {
  // gap-dashboard-fanin-timestamp-timeline-anchor AC7 regression sentinel: the fixed helper must
  // depend only on __dirname (the git subprocess's cwd), never the calling process's process.cwd().
  // Replay the two cwd the test actually runs under — the repo root (scripts/test.sh's way) and the
  // test-file dir — and assert BOTH resolve to the same main checkout (the independent
  // --path-format=absolute oracle, which is absolute regardless of cwd).
  const oracle = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: __dirname, encoding: "utf8" }).trim();
  const expectedRoot = path.dirname(oracle);
  const prev = process.cwd();
  let fromRepoRoot;
  let fromTestDir;
  try {
    process.chdir(expectedRoot);
    fromRepoRoot = mainCheckoutRoot();
    process.chdir(__dirname);
    fromTestDir = mainCheckoutRoot();
  } finally {
    process.chdir(prev);
  }
  assert.equal(fromRepoRoot, expectedRoot, "from the repo-root cwd → the main checkout root");
  assert.equal(fromTestDir, expectedRoot, "from the test-file cwd → the main checkout root");
  assert.equal(fromRepoRoot, fromTestDir, "identical result from two different cwd");
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
      assert.ok(res.body.includes("结束时刻为终点的过去 3h"), `GET ${p} falls back to the default 3h window`);
    }

    const six = await request(port, "/dashboard?hours=6");
    assert.equal(six.status, 200, "GET /dashboard?hours=6 returns 200");
    assert.ok(six.body.includes("结束时刻为终点的过去 6h"), "GET /dashboard?hours=6 reflects the 6h window");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
