// @test-group product
// gap-dashboard-minilist-row-layout — dashboard taskCard miniList 单行排版修复（方案B）.
//
// 根因：miniList 每条任务原本是「一个 flex 容器 + 两个子项（id / title）」，title 子项带着
// `flex:none` + `white-space:nowrap` + `text-overflow:ellipsis` —— flex:none 禁止该子项收缩，
// ellipsis 因此从未生效，长标题直接把卡片撑爆；同时已取到 updatedAt 却从未渲染。
//
// 方案B（人 2026-09-02 裁定）：每条任务从「单行两子项」改为「纵向三要素」——id（accent 色链接）、
// title（正文色、允许自然换行、不再依赖失效的 ellipsis）、更新时间（小号灰字 relativeTime()）。
// 省略行内 status（靠分组标题传达）；条目间加一条细分隔线（border-top，只用在第 2 条及以后）。
//
// Tests:
//   AC6 短标题 —— 正常渲染，且同行顺序为 id → title → relativeTime 时间文本（三个独立节点）。
//   AC6 长标题 —— 60+ 字符标题不被截断：输出不含 text-overflow:ellipsis 且标题原文全文出现。
//   AC6 时间 —— 已知 updatedAt 差值（2 天）构造出可预期的 relativeTime 片段「2d ago」。
//   AC4 分隔线 —— 同一状态块 ≥2 条时第 2 条带 border-top（计数=2）；单条时无条目间分隔线（计数=1）；
//                 0 任务状态不渲染该区块。
//   AC3 源级 —— miniList 函数体不再携带 flex:none / overflow:hidden / text-overflow:ellipsis /
//                 white-space:nowrap（对函数体源码断言，防止回归到失效的 ellipsis 截断）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-minilist-row-layout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { renderDashboardPage } from "../src/serve-dashboard.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");

/** Minimal-but-shape-valid dashboard args — the same shape the sibling multistatus-minitable test uses.
 *  `live.inFlight` and `tests.runs` are BOTH empty so the live-card mini list and tests-card recent strip
 *  (the two OTHER places that legitimately use `text-overflow:ellipsis`/`border-top`) are not rendered —
 *  the assertions below then attribute every ellipsis/border token to the taskCard miniList alone. */
function makeDashboardArgs(tasks) {
  return {
    live: { status: "ok", liveState: "running", inFlight: [], concurrency: 0 },
    sys: {
      resourceGate: { status: "ok", verdict: "GO", cpuStallAvg10: null, loadAvg: null },
      processBudget: { status: "ok", verdict: "GO" },
    },
    mgr: { liveness: { sessions: [] }, loopDriver: { verdict: "GO" } },
    tests: { runs: [], reason: null },
    history: { status: "empty", commits: [] },
    tasks,
  };
}

/** A known updatedAt delta: `n` days before now → relativeTime() floors to a deterministic `${n}d ago`. */
function daysAgo(n) {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

/** The per-status mini-list cap is a single constant in serve-dashboard.ts. This file's AC4 "0 tasks →
 *  no block" assertion is an ABSENCE assertion on the block's heading, so it has to name the cap string
 *  the heading actually uses: pinning the literal `3` here (2026-09-14 human ruling raised it to 10)
 *  would leave the assertion green while asserting the absence of a string that can no longer appear —
 *  a tautology, not a check. Read the constant instead; its VALUE is pinned by the owning task's own
 *  test (serve-dashboard.test.mjs: 12 ready ⇒ exactly 10 rows). */
function readMiniListN(src) {
  const m = /const\s+MINI_LIST_N\s*=\s*(\d+)\s*;/.exec(src);
  assert.ok(m, "MINI_LIST_N declaration found in serve-dashboard.ts");
  return Number(m[1]);
}
const MINI_LIST_N = readMiniListN(fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8"));

/** Extract the `const miniList = (…) => { … }` arrow-function body from the source file (balanced braces). */
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

test("AC6: short title renders, and each row orders id → title → relativeTime (three independent nodes)", () => {
  const title = "short title";
  const html = renderDashboardPage(makeDashboardArgs([
    { id: "R-1", title, status: "ready", labels: [], updatedAt: daysAgo(2) },
  ]));

  const iId = html.indexOf("/task/R-1");
  const iTitle = html.indexOf(title);
  const iTime = html.indexOf("2d ago");
  assert.ok(iId >= 0, "id link is present");
  assert.ok(iTitle > iId, "title text follows the id link");
  assert.ok(iTime > iTitle, "relativeTime text follows the title");
});

test("AC6: a 60+ char title is not ellipsized — no text-overflow:ellipsis and the full title appears", () => {
  const longTitle = "this is an intentionally long task title that easily exceeds sixty characters to prove natural wrapping";
  assert.ok(longTitle.length >= 60, `fixture title is ≥60 chars (got ${longTitle.length})`);

  const html = renderDashboardPage(makeDashboardArgs([
    { id: "R-2", title: longTitle, status: "ready", labels: [], updatedAt: daysAgo(2) },
  ]));

  assert.ok(html.includes(longTitle), "full long title appears verbatim (no ellipsis truncation)");
  assert.ok(!html.includes("text-overflow:ellipsis"), "rendered output carries no text-overflow:ellipsis");
  assert.ok(!html.includes("white-space:nowrap"), "rendered output carries no white-space:nowrap on the miniList row");
});

test("AC6: each row renders a relativeTime fragment predictable from a known updatedAt delta", () => {
  const html = renderDashboardPage(makeDashboardArgs([
    { id: "R-3", title: "three", status: "todo", labels: [], updatedAt: daysAgo(2) },
  ]));
  // daysAgo(2) → relativeTime() floors to "2d ago" (deterministic: elapsed ≈ 2d + a few ms).
  assert.ok(html.includes("2d ago"), "row renders the predictable relativeTime text 「2d ago」");
});

test("AC4: entry separator on the 2nd+ row, none on a single row, and 0-task status renders no block", () => {
  // The inter-entry separator is this exact style fragment (trailing `;` after padding-top distinguishes
  // it from the live card's border-top and the global `hr { border-top: … }` CSS, which use spaces/other
  // suffixes). Counting its occurrences isolates "row separators" from all other border-top in the page.
  const SEP = "border-top:1px solid var(--color-divider);padding-top:6px;";

  const two = renderDashboardPage(makeDashboardArgs([
    { id: "R-1", title: "one", status: "ready", labels: [], updatedAt: daysAgo(1) },
    { id: "R-2", title: "two", status: "ready", labels: [], updatedAt: daysAgo(2) },
  ]));
  assert.equal(two.split(SEP).length - 1, 1, "2 ready tasks → exactly the 2nd row carries a separator");

  const three = renderDashboardPage(makeDashboardArgs([
    { id: "R-1", title: "one", status: "ready", labels: [], updatedAt: daysAgo(1) },
    { id: "R-2", title: "two", status: "ready", labels: [], updatedAt: daysAgo(2) },
    { id: "R-3", title: "three", status: "ready", labels: [], updatedAt: daysAgo(3) },
  ]));
  assert.equal(three.split(SEP).length - 1, 2, "3 ready tasks → 2nd and 3rd rows each carry a separator");

  const one = renderDashboardPage(makeDashboardArgs([
    { id: "R-1", title: "one", status: "ready", labels: [], updatedAt: daysAgo(1) },
  ]));
  assert.equal(one.split(SEP).length - 1, 0, "1 ready task → no inter-entry separator");

  const zero = renderDashboardPage(makeDashboardArgs([
    { id: "D-1", title: "done", status: "done", labels: [], updatedAt: daysAgo(1) },
  ]));
  assert.ok(!zero.includes(`ready（最近 ${MINI_LIST_N} 条）`), "0 ready tasks → no ready mini-list block");
});

test("AC3: miniList function body no longer carries the four dead-ellipsis tokens", () => {
  const body = miniListBody(fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8"));
  for (const token of ["flex:none", "overflow:hidden", "text-overflow:ellipsis", "white-space:nowrap"]) {
    assert.ok(!body.includes(token), `miniList body must not contain ${token}`);
  }
});
