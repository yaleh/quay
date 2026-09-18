// @test-group product
// gap-dashboard-cards-layout-and-livecard-swimlane — 测试卡/Fan-in 卡精简 + 循环脉搏卡补全 + 移动端横向溢出修复:
//   AC1 — renderTestsCard 函数体内的 hover-only「近N轮（新→旧）」色块条移除（grep 命中 0）。
//   AC2 — 近期列表每行的 round 号被一个反色底色 chip 包裹（red → --color-accent-800，green →
//         --color-positive-700），不是仅文字变色。
//   AC3 — testsCard/fan-in 卡的时间段 bar 移到状态行之后、明细列表之前（indexOf 数值比较，非目测）。
//   AC4 — 循环脉搏卡标题元素去掉 white-space:nowrap（>40 字 fixture；负控制 = 同一次渲染里 task-id
//         anchor 仍带 nowrap，证明检测真在测这个属性而非恒真）。
//   AC5 — renderLiveSwimlaneSvg 每个 in-flight 任务一条 lane（<rect> 数 = 任务数，y 两两不同）。
//   AC7 — .dash-grid 移动端媒体查询 grid-template-columns:1fr !important → minmax(0,1fr) !important。
// AC6（移动端 scrollWidth <= 395）需真浏览器，不在此文件内（手工 MCP 浏览器负控制 + 正控制验证）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-cards-layout-and-livecard-swimlane.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import {
  renderTestsCard,
  renderLiveCard,
  renderFanInCardFromRecords,
  renderLiveSwimlaneSvg,
} from "../src/serve-dashboard.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");
const FIXED_NOW_MS = 1_700_000_000_000; // deterministic wall-clock anchor

/** Extract an `export function <name>(…) { … }` body from the source (balanced braces) — the same
 *  idiom the visual-review test's miniListBody helper uses. */
function functionBody(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} declaration found in source`);
  const open = src.indexOf("{", start);
  assert.ok(open >= 0, `${name} body opening brace found`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`${name} body not terminated`);
}

/** The `<div …>` element that directly wraps `text` (lastIndexOf("<div") before the text). */
function elementWrapping(html, text) {
  const i = html.indexOf(text);
  if (i < 0) return null;
  const open = html.lastIndexOf("<div", i);
  const close = html.indexOf("</div>", i);
  if (open < 0 || close < 0) return null;
  return html.slice(open, close);
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

test("AC1: the hover-only 近N轮（新→旧） colour strip is removed from renderTestsCard", () => {
  const body = functionBody(fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8"), "renderTestsCard");
  assert.ok(!/近.*轮（新→旧）/.test(body), "no 近N轮（新→旧） strip heading remains in renderTestsCard");
  assert.ok(!body.includes("recentStrip"), "the recentStrip variable is gone from renderTestsCard");
});

test("AC2: round number is wrapped by an inverse-colour chip (background, not mere text colour)", () => {
  const runs = (state) => ({ status: "ok", reason: null, runs: [{ round: 1322, state, pass: 45, tests: 50, durationMs: 1000 }] });
  const red = renderTestsCard(runs("red"), null, { nowMs: FIXED_NOW_MS });
  assert.match(red, /<span[^>]*background:var\(--color-accent-800\)[^>]*>#1322<\/span>/, "red round number is wrapped by a --color-accent-800 chip");
  const green = renderTestsCard(runs("green"), null, { nowMs: FIXED_NOW_MS });
  assert.match(green, /<span[^>]*background:var\(--color-positive-700\)[^>]*>#1322<\/span>/, "green round number is wrapped by a --color-positive-700 chip");
});

test("AC3: timelineBar/bar render BEFORE recentList/list (indexOf comparison, not eyeballing)", () => {
  const nowMs = FIXED_NOW_MS;

  // ⚠️ gap-webui-dashboard-body-copy-en-zh: the barrier's aria-label is now language-dependent
  // (DASHBOARD_LABELS.timelineAriaPastHours), and the DEFAULT is `en` — so this ordering probe asks
  // for `zh` explicitly. Pinning it to the default would have silently changed what is being
  // located; pinning it to `zh` keeps the probe's own baseline AND makes it a zh regression guard.
  // The shared prefix `aria-label="` is what both arms carry, so the locator is not itself
  // language-bound.
  const testsHtml = renderTestsCard({
    status: "ok",
    reason: null,
    runs: [{ round: 12, state: "green", pass: 45, tests: 50, durationMs: 754_000, startedAt: new Date(nowMs - 10 * 60_000).toISOString() }],
  }, null, { hours: 3, nowMs, lang: "zh" });
  const testsBarIdx = testsHtml.indexOf('aria-label="');
  const testsListIdx = testsHtml.indexOf("#12");
  assert.ok(testsBarIdx >= 0 && testsListIdx >= 0, "both the bar and the recent list render in the testsCard fixture");
  assert.ok(testsBarIdx < testsListIdx, `testsCard bar (${testsBarIdx}) precedes the recent list (${testsListIdx})`);
  // …and the bar's own label really is the zh one, so "found an aria-label" cannot be satisfied by
  // some other labelled element this fixture happens to grow later (硬规则 2: prove the hit).
  assert.ok(testsHtml.includes('aria-label="过去'), "the located aria-label is the timeline bar's zh label");

  const nowSec = Math.floor(nowMs / 1000);
  const fanInHtml = renderFanInCardFromRecords(
    [{ ts: null, task: "t1", mechanical_fan_in: mfi(nowSec - 600, nowSec - 590, "landed") }],
    { hours: 3, nowMs, lang: "zh" },
  );
  const fanInBarIdx = fanInHtml.indexOf('aria-label="');
  const fanInListIdx = fanInHtml.indexOf("t1");
  assert.ok(fanInBarIdx >= 0 && fanInListIdx >= 0, "both the bar and the list render in the fan-in fixture");
  assert.ok(fanInBarIdx < fanInListIdx, `fan-in bar (${fanInBarIdx}) precedes the list (${fanInListIdx})`);
  assert.ok(fanInHtml.includes('aria-label="过去'), "the located aria-label is the timeline bar's zh label");
});

test("AC4: renderLiveCard title wraps (no white-space:nowrap on the title element)", () => {
  const longTitle = "循环脉搏卡标题完整性验证：此标题长度明确超过四十个字符，用于确认标题不会被单行截断而是换行展示全部内容";
  assert.ok(longTitle.length > 40, `fixture title is >40 chars (got ${longTitle.length})`);
  const live = {
    status: "ok",
    liveState: "running",
    concurrency: 1,
    inFlight: [{ taskId: "T-1", phase: "implementing", startedAtMs: FIXED_NOW_MS - 60_000 }],
  };
  const html = renderLiveCard(live, FIXED_NOW_MS, [{ id: "T-1", title: longTitle }]);

  const titleEl = elementWrapping(html, longTitle);
  assert.ok(titleEl, "the title text renders inside a wrapping <div>");
  assert.ok(!titleEl.includes("white-space:nowrap"), "the title element does not carry white-space:nowrap");

  // Negative control: the task-id anchor in the SAME render still carries white-space:nowrap (it is the
  // one element that legitimately keeps it), so this test's "no nowrap" detection is NOT a恒真 assertion
  // that would pass even if renderLiveCard dropped ellipsis handling everywhere.
  const anchor = html.match(/<a [^>]*>T-1<\/a>/);
  assert.ok(anchor, "the task-id anchor renders");
  assert.ok(anchor[0].includes("white-space:nowrap"), "the anchor still carries white-space:nowrap (negative control)");
});

test("AC5: renderLiveSwimlaneSvg renders one <rect> per in-flight task, each on its own lane (distinct y)", () => {
  const inFlight = [
    { taskId: "task-alpha", startedAtMs: FIXED_NOW_MS - 10 * 60_000, phase: "implementing" },
    { taskId: "task-beta", startedAtMs: FIXED_NOW_MS - 5 * 60_000, phase: "fan-in" },
    { taskId: "task-gamma", startedAtMs: FIXED_NOW_MS - 2 * 60_000, phase: "awaiting-land" },
  ];
  const svg = renderLiveSwimlaneSvg(inFlight, 3, FIXED_NOW_MS);
  const rectTags = svg.match(/<rect[^>]*>/g) ?? [];
  assert.equal(rectTags.length, inFlight.length, "one <rect> per in-flight task");
  const ys = rectTags.map((t) => (t.match(/ y="([^"]+)"/) ?? [])[1]);
  assert.ok(ys.every((y) => y != null), "every <rect> carries a y attribute");
  assert.equal(new Set(ys).size, ys.length, "all lane y positions are pairwise distinct (truly separate lanes)");
});

test("AC7: the .dash-grid mobile media query clamps to minmax(0,1fr), never a bare 1fr", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const bare = (src.match(/grid-template-columns:1fr !important/g) || []).length;
  const clamped = (src.match(/grid-template-columns:minmax\(0,1fr\) !important/g) || []).length;
  assert.equal(bare, 0, "no bare 1fr !important remains in the .dash-grid media query");
  assert.equal(clamped, 1, "exactly one minmax(0,1fr) !important (the clamped mobile collapse)");
});
