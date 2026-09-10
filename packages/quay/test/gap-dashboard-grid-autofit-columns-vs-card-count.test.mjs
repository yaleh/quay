// @test-group product
// gap-dashboard-grid-autofit-columns-vs-card-count — dashboard 卡片网格的列数必须与卡片数绑定，而不是由
// 容器宽度派生。旧实现 `repeat(auto-fit, minmax(240px, 1fr))` 在 870px 容器下恒为 3 列，与放几张卡毫无
// 关系：「工作进展」行 4 张卡 ⇒ 第 4 张换行、右侧 2 格露出容器 `--color-divider` 底色成大片深灰空洞。
// 修法 = `gridColumns(n)` → `repeat(n, minmax(0, 1fr))`：列数 == 卡片数 ⇒ 任何视口下空槽数恒为 0；
// ≤600px 媒体查询把网格收成单列（保留 auto-fit 曾给移动端的纵向堆叠）。
//
// 本文件机械守卫「结构上可判」的性质（空槽数 == 0 由列数==卡片数推出、divider 底色只透过 2px gap +
// 1px border 露出、宽度无关的模板）；真实浏览器在 1440/1024/768/390 四个视口算 computed grid 的四视口
// 枚举 + 全页截图（DoD）为一次性浏览器验证，记录在提交信息与下方 BROWSER-VERIFICATION 头注释，非本
// 提交测试文件（本仓库无浏览器自动化 npm 依赖，同 web-ui-browser.test.mjs 的 G5 纪律）。
//
// Run (scoped): node --test packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs
//
// BROWSER-VERIFICATION (一次性 chrome-devtools MCP，对 1440 宽的 live /dashboard 算 computed grid):
//   before (旧 repeat(auto-fit,minmax(240px,1fr)))：3 列 3 卡→0 空 / 3 列 4 卡→2 空 / 3 列 2 卡→1 空
//   after  (gridColumns(n)=repeat(n,minmax(0,1fr)))：3 列 3 卡→0 空 / 4 列 4 卡→0 空 / 2 列 2 卡→0 空
//   四视口 (1440/1024/768/390) 空槽数全部 == 0（390px 经 ≤600px 媒体查询收成单列，卡片纵向堆叠）。
//   AC4：每格 exposed divider 面积 3507/18302/2573 px²（仅 2px gap + 1px border；最大单条 gap 线 ≈
//   4142 px²，全部 << 20000 px² 阈值）。前后全页截图并列于提交信息。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderDashboardPage,
  renderCardGrid,
  renderWorkProgressRow,
  gridColumns,
  dashboardGridStyles,
} from "../src/serve-dashboard.ts";

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

/** A bare card string used to feed renderCardGrid with an arbitrary card count. */
function card(i) {
  return `<div style="background:var(--color-surface)">card-${i}</div>`;
}

/** Count top-level <div> children of a fragment (direct children only; nested divs skipped). */
function countDirectDivs(fragment) {
  let count = 0;
  let depth = 0;
  const re = /<\/?div\b[^>]*>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) {
    if (m[0].startsWith("</")) {
      if (depth > 0) depth--;
    } else {
      if (depth === 0) count++;
      depth++;
    }
  }
  return count;
}

/** Extract the three <div class="dash-grid"> rows from a rendered page: { openTag, content }. */
function extractGridRows(htmlStr) {
  const rows = [];
  const startMarker = '<div class="dash-grid"';
  let searchFrom = 0;
  while (true) {
    const start = htmlStr.indexOf(startMarker, searchFrom);
    if (start === -1) break;
    const openEnd = htmlStr.indexOf(">", start);
    const openTag = htmlStr.slice(start, openEnd + 1);
    // Scan from the end of the opening tag, counting div open/close depth to find the matching </div>.
    let depth = 1;
    let contentStart = openEnd + 1;
    let contentEnd = -1;
    const re = /<\/?div\b[^>]*>/g;
    re.lastIndex = contentStart;
    let m;
    while ((m = re.exec(htmlStr)) !== null) {
      if (m[0].startsWith("</")) {
        depth--;
        if (depth === 0) { contentEnd = m.index; break; }
      } else {
        depth++;
      }
    }
    if (contentEnd === -1) break;
    rows.push({ openTag, content: htmlStr.slice(contentStart, contentEnd) });
    searchFrom = contentEnd + 6;
  }
  return rows;
}

/** Column count encoded in a grid row's inline template, or null if it isn't the repeat(N) form. */
function colsOf(openTag) {
  const m = openTag.match(/grid-template-columns:repeat\((\d+),\s*minmax\(0,\s*1fr\)\)/);
  return m ? Number(m[1]) : null;
}

/** Column count encoded in a grid row's inline template — the card-count-bound
 *  repeat(N, minmax(0,1fr)) form (变更记录), the fixed 3fr:2fr asymmetric top row
 *  (gap-dashboard-top-row-asymmetric-columns), and the paired 1fr:1fr 工作进展 row
 *  (gap-dashboard-workprogress-row-paired-columns) all reduce to a plain column count, so the shared
 *  empty-slot invariant (cols × rows − cards == 0) still holds for every row. Null = unrecognized. */
function rowColCount(openTag) {
  const repeat = colsOf(openTag);
  if (repeat !== null) return repeat;
  const asym = openTag.match(/grid-template-columns:minmax\(0,\s*3fr\)\s+minmax\(0,\s*2fr\)/);
  if (asym) return 2;
  const paired = openTag.match(/grid-template-columns:minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  if (paired) return 2;
  return null;
}

test("AC2: gridColumns/renderCardGrid bind column count to card count (3/4/5 → 3/4/5 columns)", () => {
  // The pure helper: n cards → n columns.
  assert.equal(gridColumns(3), "repeat(3, minmax(0, 1fr))", "gridColumns(3) is a 3-column template");
  assert.equal(gridColumns(4), "repeat(4, minmax(0, 1fr))", "gridColumns(4) is a 4-column template");
  assert.equal(gridColumns(5), "repeat(5, minmax(0, 1fr))", "gridColumns(5) is a 5-column template");

  // The render function: passing 3/4/5 cards yields 3/4/5 columns in its inline style. The OLD code
  // (`repeat(auto-fit, minmax(240px,1fr))`) returned the SAME template string for every input, so this
  // is the falsifiable structural check: three distinct inputs must yield three distinct column counts.
  const three = renderCardGrid([card(1), card(2), card(3)]);
  const four = renderCardGrid([card(1), card(2), card(3), card(4)]);
  const five = renderCardGrid([card(1), card(2), card(3), card(4), card(5)]);
  assert.ok(three.includes("grid-template-columns:repeat(3, minmax(0, 1fr))"), "3 cards → repeat(3, …)");
  assert.ok(four.includes("grid-template-columns:repeat(4, minmax(0, 1fr))"), "4 cards → repeat(4, …)");
  assert.ok(five.includes("grid-template-columns:repeat(5, minmax(0, 1fr))"), "5 cards → repeat(5, …)");

  // Negative control: the width-derived template is gone from every output.
  for (const out of [three, four, five]) {
    assert.ok(!out.includes("auto-fit"), "no auto-fit remains (column count is no longer width-derived)");
    assert.ok(!out.includes("minmax(240px"), "no minmax(240px) remains");
  }
});

test("AC1: every grid row has 0 empty slots (columns == cards) in the rendered page", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  const rows = extractGridRows(html);
  assert.equal(rows.length, 3, "the dashboard renders exactly 3 card-grid rows");

  const triplets = [];
  for (const row of rows) {
    const cols = rowColCount(row.openTag);
    const cards = countDirectDivs(row.content);
    assert.ok(cols !== null, "each grid row carries a recognized column template (repeat(N) or 3fr:2fr)");
    const rowCount = Math.ceil(cards / cols);
    const empty = cols * rowCount - cards;
    triplets.push(`(列数=${cols}, 卡片数=${cards}, 空槽数=${empty})`);
    assert.equal(empty, 0, `grid empty slots == 0 (${cols} cols × ${rowCount} rows − ${cards} cards)`);
  }
  // Fail-loud: print the per-grid (列数, 卡片数, 空槽数) triplets, not just a bare boolean.
  console.log("AC1 grid triplets:", triplets.join("  "));
});

test("AC3: the column template is viewport-independent (no auto-fit), with a mobile single-column collapse", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  // The width-derived machinery is gone ⇒ the column count can't change with the viewport.
  assert.ok(!html.includes("auto-fit"), "the page no longer uses auto-fit (width-derived columns)");
  assert.ok(!html.includes("minmax(240px"), "the page no longer uses minmax(240px)");

  // At ≤600px the grid collapses to a single column, so a 4-card row stacks (4 cards × 1 column,
  // 4 rows → 0 empty slots) instead of squeezing to ~90px/card. This is what keeps 390px at 0 empty
  // slots without the desktop 4-column layout overflowing.
  assert.ok(dashboardGridStyles.includes("@media (max-width:600px)"), "grid styles carry the ≤600px media query");
  assert.ok(dashboardGridStyles.includes(".dash-grid"), "grid styles target the .dash-grid class");
  // gap-dashboard-cards-layout-and-livecard-swimlane AC7: the collapse clamps to minmax(0,1fr) — a bare
  // 1fr has an implicit `auto` minimum, so a long unbreakable in-flight row pushed the whole page to ~4×
  // the viewport width on mobile. minmax(0,1fr) clamps that minimum to 0 like the desktop template.
  assert.ok(dashboardGridStyles.includes("grid-template-columns:minmax(0,1fr) !important"), "mobile collapse sets grid-template-columns:minmax(0,1fr) !important");
  assert.ok(!dashboardGridStyles.includes("grid-template-columns:1fr !important"), "no bare 1fr !important remains in the mobile collapse");

  // gridColumns itself carries no width term — the column count depends only on the card count.
  for (const n of [3, 4, 5]) {
    assert.ok(!gridColumns(n).includes("240px"), `gridColumns(${n}) carries no width term`);
    assert.ok(gridColumns(n) === `repeat(${n}, minmax(0, 1fr))`, `gridColumns(${n}) is card-count-bound`);
  }
});

test("AC4: the divider colour can only show through the 2px gap + 1px border (no empty-slot void)", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  const rows = extractGridRows(html);
  assert.equal(rows.length, 3, "three grid rows to check");

  for (const row of rows) {
    // The divider background is on the CONTAINER; it is only visible where a card does not cover it.
    // With 0 empty slots (AC1) the only uncovered surface is the 2px gap and the 1px border — thin
    // lines whose area is far below 20000px², never a large dark rectangle.
    assert.ok(row.openTag.includes("gap:2px"), "the grid keeps the 2px gap (divider shows only through it)");
    assert.ok(row.openTag.includes("border:1px solid var(--color-divider)"), "the grid keeps the 1px divider border");
    const cols = rowColCount(row.openTag);
    const cards = countDirectDivs(row.content);
    const empty = cols * Math.ceil(cards / cols) - cards;
    assert.equal(empty, 0, "no empty slot ⇒ no large --color-divider rectangle (gap/border only)");
  }
});

test("top-row asymmetric: 3fr:2fr two columns, sys+mgr flex-stacked in the right column, equal-width rows untouched", () => {
  const html = renderDashboardPage(makeDashboardArgs());
  const rows = extractGridRows(html);
  assert.equal(rows.length, 3, "the page still renders exactly 3 card-grid rows");

  const top = rows[0];
  // Fixed 3:2 ratio, NOT the card-count-bound repeat(N, minmax(0,1fr)) form.
  assert.ok(top.openTag.includes("grid-template-columns:minmax(0,3fr) minmax(0,2fr)"), "top row carries the 3fr:2fr asymmetric template");
  assert.ok(!top.openTag.includes("repeat("), "top row does not reuse gridColumns()'s repeat() template");
  // Exactly 2 grid items: the live card + one stacked column (sys + mgr wrapped).
  assert.equal(countDirectDivs(top.content), 2, "top row has exactly 2 grid items");

  // The right column stacks sysCard + mgrCard in a flex column; the live card is the left column.
  const wrapIdx = top.content.indexOf('<div style="display:flex;flex-direction:column;gap:2px">');
  const liveIdx = top.content.indexOf('id="live-card"');
  const sysIdx = top.content.indexOf('id="sys-card"');
  const mgrIdx = top.content.indexOf('id="mgr-card"');
  assert.ok(wrapIdx !== -1, "the right column is a flex-column stack");
  assert.ok(liveIdx !== -1 && sysIdx !== -1 && mgrIdx !== -1, "all three cards remain in the top row");
  assert.ok(liveIdx < wrapIdx && wrapIdx < sysIdx && sysIdx < mgrIdx,
    "live card is the left column; sys then mgr stacked top-to-bottom in the right column");

  // 变更记录 stays card-count-bound and equal-width; the 工作进展 row is now paired (checked in its own
  // test below). Neither is affected by the top-row change.
  const rest = rows.slice(1);
  assert.equal(colsOf(rest[1].openTag), 2, "变更记录 row stays repeat(2, minmax(0,1fr)) (2 cards)");
});

test("工作进展 paired: 1fr:1fr two equal-width columns, goal+task flex-stacked left, tests+fanin right", () => {
  // Direct helper unit: the pairing order is structural, so assert it on the pure function.
  const row = renderWorkProgressRow(
    '<div id="goal-card">g</div>',
    '<div id="task-card">t</div>',
    '<div id="tests-card">x</div>',
    '<div id="fanin-card">f</div>',
  );
  assert.ok(row.includes("grid-template-columns:minmax(0,1fr) minmax(0,1fr)"), "paired row is 1fr:1fr equal-width");
  assert.ok(!row.includes("repeat("), "paired row does not reuse gridColumns()'s repeat() template");
  const goalIdx = row.indexOf('id="goal-card"');
  const taskIdx = row.indexOf('id="task-card"');
  const testsIdx = row.indexOf('id="tests-card"');
  const faninIdx = row.indexOf('id="fanin-card"');
  assert.ok(goalIdx < taskIdx && taskIdx < testsIdx && testsIdx < faninIdx,
    "order is goal(上) → task(下) in the left column, tests(上) → fanin(下) in the right column");

  // Integration: the rendered page's 工作进展 row (rows[1]) is exactly 2 grid items, each a flex stack.
  const html = renderDashboardPage(makeDashboardArgs());
  const rows = extractGridRows(html);
  assert.equal(rows.length, 3, "the page still renders exactly 3 card-grid rows");
  const work = rows[1];
  assert.ok(work.openTag.includes("grid-template-columns:minmax(0,1fr) minmax(0,1fr)"), "工作进展 row carries the 1fr:1fr template");
  assert.ok(!work.openTag.includes("repeat("), "工作进展 row does not reuse gridColumns()");
  assert.equal(countDirectDivs(work.content), 2, "工作进展 row has exactly 2 grid items (two flex stacks)");

  // Two flex-column stacks, in order: left = goal above task, right = tests above fanin.
  const goalIdxP = work.content.indexOf('id="goal-card"');
  const taskIdxP = work.content.indexOf('id="task-card"');
  const testsIdxP = work.content.indexOf('id="tests-card"');
  const faninIdxP = work.content.indexOf('id="fanin-card"');
  assert.ok(goalIdxP < taskIdxP && taskIdxP < testsIdxP && testsIdxP < faninIdxP,
    "page order: goal(上)→task(下) left, tests(上)→fanin(下) right");
  assert.equal((work.content.match(/display:flex;flex-direction:column;gap:2px/g) || []).length, 2,
    "both columns are flex-column stacks (one per grid item)");
});
