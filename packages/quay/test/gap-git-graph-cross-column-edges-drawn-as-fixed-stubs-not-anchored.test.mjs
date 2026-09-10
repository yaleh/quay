// @test-group product
// gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored — /git-history 的跨列边全部是
// 悬空残桩（终点写成 y(i)+rowH*0.65 的固定短桩而非目标父提交所在行的 y），且列的分配对拍 7/7 全绿却漏验
// 了边的绘制。修法：①边终点锚定到父提交所在行（服务端在 GitGraphEdge 上补 toRow）；②窗口外父提交画成
// 可区分的虚线残桩；③连线从斜线改为圆角正交折线（H/V/Q，无 L）+ 按列分色（恢复 GIT_GRAPH_LANE_PALETTE 与
// --color-lane-N 令牌）；④页面级放宽 main 容器到 1400px（不动全站 900px）。
//
//   AC1  边两端都锚定：遍历所有 .git-svg-edge（不限标签），两端坐标都落在某个节点中心 ±1px 内，不满足数 = 0。
//   AC2  锚到正确的那一行：每条跨列边的终点 y 等于它对应 parentHashes[pi] 所在行的 y(rowIndex)，错配数 = 0。
//   AC3  边数不缩水：.git-svg-edge 元素数 = 数据中 fromCol !== toCol 的边数（防「少画几条边」满足 AC1/AC2）。
//   AC4  负控制：显式还原 y(i)+rowH*0.65 的旧写法，断言 AC1 的不满足数 > 0 ⇒ 判据能取假。
//   AC5  窗口外父提交显式化：父提交不在窗口内的边带可区分标记（独立 class + stroke-dasharray），条数相等。
//   AC6  文本不再截断：页面级 #main 覆盖 ≥ 1320px（1440px 视口下内容宽 ≥ 1288px 的 SVG）。
//   AC7  不动全局样式：serve-render.ts 仍保留裸 main { max-width: 900px }。
//   AC8  正交圆角连线：.git-svg-edge 的 d 只允许 M/H/V/Q/Z（无 L），且带非退化 Q 圆角（半径 > 0）。
//   AC9  按列分色：列线按列号取 var(--color-lane-N)，不同描边色数 = |{列号 mod 8}|，索引相邻两列不同色。
//   AC10 色板逐值一致：恢复的 8 个 hex 与 git show 303a94950^ 的 GIT_GRAPH_LANE_PALETTE 逐项相等。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGitHistory, clearGitHistoryCache } from "../src/observation.ts";
import {
  gitGraphClientScript,
  layoutGitGraph,
  assignGitColumns,
  renderGitHistoryPage,
  gitGraphLaneTokenCss,
  GIT_GRAPH_LANE_PALETTE,
  GIT_GRAPH_ROW_H,
  GIT_GRAPH_TRUNK_X,
  GIT_GRAPH_LANE_GAP,
  GIT_GRAPH_PAD_Y,
} from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIMIT = 500;
const y = (row) => GIT_GRAPH_PAD_Y + row * GIT_GRAPH_ROW_H;

// ── minimal DOM + d3 mocks to EXECUTE the emitted client IIFE and capture the rendered SVG ──────
// The renderer's d3 usage is chainable selections only; a self-returning selection that records each
// appended element (its tag, attrs, children) lets us inspect the actual <path>/<line> geometry the
// browser would paint — no re-implementation of the geometry, the real client code runs.

function makeEl(tag) {
  return { tag, attrs: {}, styles: {}, children: [], text: "", getBBox: () => ({ x: 0, y: 0, width: 24, height: 12 }) };
}

function findDescendants(el, tag, acc) {
  acc = acc || [];
  for (const c of el.children) {
    if (tag === "*" || c.tag === tag) acc.push(c);
    findDescendants(c, tag, acc);
  }
  return acc;
}

function makeSel(el) {
  return {
    empty: () => !el,
    select: (selr) => makeSel(el && el.children.find((c) => c.tag === selr) || null),
    selectAll: (selr) => ({
      remove: () => { el.children = el.children.filter((c) => !(selr === "*" || c.tag === selr)); },
      each: (cb) => { findDescendants(el, selr).forEach((c) => cb.call(c)); },
    }),
    append: (tag) => { const c = makeEl(tag); el.children.push(c); return makeSel(c); },
    attr: (name, value) => {
      if (el) { if (value === undefined) return el.attrs[name]; el.attrs[name] = value; }
      return makeSel(el);
    },
    style: (name, value) => {
      if (el) { if (value === undefined) return el.styles[name]; el.styles[name] = value; }
      return makeSel(el);
    },
    text: (t) => { if (el) el.text = t; return makeSel(el); },
    node: () => el,
  };
}

/** Execute the emitted client script against a rows payload; return the mount element tree. */
function executeScript(script, rows) {
  const mount = makeEl("div");
  const dataEl = { textContent: JSON.stringify({ rows }) };
  const sentinel = {
    textContent: "",
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    addEventListener: () => {},
  };
  const elements = {
    "git-graph": mount,
    "git-graph-data": dataEl,
    "git-graph-sentinel": sentinel,
    "git-graph-coverage": { textContent: "" },
  };
  class IntersectionObserver { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} }
  const sandbox = {
    document: { getElementById: (id) => (id in elements ? elements[id] : null) },
    window: { innerHeight: 1000 },
    d3: { select: (el) => makeSel(el) },
    IntersectionObserver,
    fetch: () => Promise.resolve({ ok: false }),
  };
  new vm.Script(script).runInNewContext(sandbox);
  return mount;
}

/** All descendants with an exact `class` attribute value. */
function collectByClass(el, cls, acc) {
  acc = acc || [];
  for (const c of el.children) {
    if (c.attrs && c.attrs.class === cls) acc.push(c);
    collectByClass(c, cls, acc);
  }
  return acc;
}

/** Parse an absolute <path> `d` into its start (first M) and final drawn point. */
function pathEndpoints(d) {
  const cmds = d.match(/[MHVQZ][^MHVQZ]*/g) || [];
  let curX = 0, curY = 0, start = null;
  for (const cmd of cmds) {
    const c = cmd[0];
    const nums = (cmd.slice(1).trim().match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (c === "M") { curX = nums[0]; curY = nums[1]; if (start === null) start = { x: curX, y: curY }; }
    else if (c === "H") { curX = nums[0]; }
    else if (c === "V") { curY = nums[0]; }
    else if (c === "Q") { curX = nums[2]; curY = nums[3]; }
    else if (c === "Z") { curX = start.x; curY = start.y; }
  }
  return { x1: start.x, y1: start.y, x2: curX, y2: curY };
}

function nodeCenters(rows) {
  return rows.map((r, i) => ({ col: r.col, x: GIT_GRAPH_TRUNK_X + r.col * GIT_GRAPH_LANE_GAP, y: y(i) }));
}

function nearNode(centers, x, yy, tol) {
  return centers.some((c) => Math.abs(c.x - x) <= tol && Math.abs(c.y - yy) <= tol);
}

/** In-window cross-column edges, in the EXACT order the client draws them (row order, edge order). */
function crossEdges(rows) {
  const out = [];
  rows.forEach((r, i) => {
    r.edges.forEach((e, pi) => {
      if (e.outsideWindow) return;
      if (e.fromCol === e.toCol) return;
      out.push({ row: i, pi, fromCol: e.fromCol, toCol: e.toCol, toRow: e.toRow, parentHash: r.parentHashes[pi] });
    });
  });
  return out;
}

function productionHistory() {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  return history;
}

function productionLayout() {
  const layout = layoutGitGraph(productionHistory());
  assert.ok(layout && layout.rows.length > 0, "the window carries commits");
  return layout;
}

/** Render the REAL client script over the production window, returning { rows, edges, columns, outside }. */
function renderProduction() {
  const layout = productionLayout();
  const mount = executeScript(gitGraphClientScript(), layout.rows);
  return {
    rows: layout.rows,
    edges: collectByClass(mount, "git-svg-edge"),
    columns: collectByClass(mount, "git-svg-column"),
    outside: collectByClass(mount, "git-svg-edge-outside"),
  };
}

// ── AC1: both endpoints of every cross-column edge land on a node center (±1px) ──────────────────

test("AC1: every .git-svg-edge endpoint lands on a node center (±1px); unanchored = 0", () => {
  const { rows, edges } = renderProduction();
  const centers = nodeCenters(rows);
  let unanchored = 0;
  assert.ok(edges.length > 0, "cross-column edges exist (a non-degenerate judge)");
  for (const e of edges) {
    const d = e.attrs.d;
    assert.ok(typeof d === "string" && d.length > 0, "every git-svg-edge is a path with a d");
    const ep = pathEndpoints(d);
    if (!nearNode(centers, ep.x1, ep.y1, 1)) unanchored++;
    if (!nearNode(centers, ep.x2, ep.y2, 1)) unanchored++;
  }
  assert.equal(unanchored, 0, `every edge endpoint is anchored (got ${unanchored} unanchored endpoints)`);
});

// ── AC1b: the anchoring judge extends to POST-pagination (merged multi-page window) ──────────────
// gap-git-graph-pagination-appends-page-relative-col-and-torow: the original AC1 only looked at the
// first screen (500 rows); a page-relative col/toRow merge dangles edges after ONE scroll. The judge
// must hold over the merged full sequence too (loaded count > one page).

test("AC1b: after merging N pages every .git-svg-edge endpoint still anchors (unanchored = 0)", () => {
  clearGitHistoryCache();
  const loaded = [];
  const seen = new Set();
  for (let k = 0; k < 3; k++) {
    const h = readGitHistory(REPO_ROOT, { limit: LIMIT, skip: k === 0 ? null : LIMIT * k });
    assert.equal(h.status, "ok");
    for (const c of h.commits) if (!seen.has(c.hash)) { seen.add(c.hash); loaded.push(c); }
  }
  assert.ok(loaded.length > LIMIT, `the merged window exceeds one page (${loaded.length} > ${LIMIT})`);
  const cols = assignGitColumns(loaded);
  const mount = executeScript(gitGraphClientScript(), loaded);
  const edges = collectByClass(mount, "git-svg-edge");
  assert.ok(edges.length > 0, "cross-column edges exist after pagination (a non-degenerate judge)");
  const centers = loaded.map((c, i) => ({ x: GIT_GRAPH_TRUNK_X + cols.get(c.hash) * GIT_GRAPH_LANE_GAP, y: y(i) }));
  let unanchored = 0;
  for (const e of edges) {
    const ep = pathEndpoints(e.attrs.d);
    if (!nearNode(centers, ep.x1, ep.y1, 1)) unanchored++;
    if (!nearNode(centers, ep.x2, ep.y2, 1)) unanchored++;
  }
  assert.equal(unanchored, 0, `every edge endpoint anchored after pagination (got ${unanchored})`);
});

// ── AC2: each edge ends at its PARENT's exact node (not merely "some node") ─────────────────────

test("AC2: each cross-column edge ends at its parent's exact node (endpoint = y(parent row))", () => {
  const { rows, edges } = renderProduction();
  const exp = crossEdges(rows);
  assert.equal(edges.length, exp.length, "rendered edge count equals data cross-column count (AC3 precondition)");
  const rowOf = new Map(rows.map((r, i) => [r.hash, i]));
  let mismatch = 0;
  for (let k = 0; k < edges.length; k++) {
    const ep = pathEndpoints(edges[k].attrs.d);
    const e = exp[k];
    const parentRow = rowOf.get(e.parentHash);
    if (e.toRow !== parentRow) mismatch++;
    if (ep.x2 !== GIT_GRAPH_TRUNK_X + e.toCol * GIT_GRAPH_LANE_GAP) mismatch++;
    if (ep.y2 !== y(parentRow)) mismatch++;
  }
  assert.equal(mismatch, 0, `every edge's endpoint equals its parent's node (got ${mismatch} mismatches)`);
});

// ── AC3: no shrinkage — rendered edge count equals the data's cross-column edge count ────────────

test("AC3: rendered .git-svg-edge count equals the data's cross-column edge count (no shrinkage)", () => {
  const { rows, edges } = renderProduction();
  const exp = crossEdges(rows);
  assert.ok(exp.length > 0, "the production window has cross-column edges (a non-degenerate judge)");
  assert.equal(edges.length, exp.length, `rendered ${edges.length} edges vs data ${exp.length} cross-column edges`);
});

// ── AC4: negative control — the fixed stub re-introduced makes AC1's judge fail ─────────────────

test("AC4: restoring the fixed-stub endpoint makes AC1's unanchored count > 0 (judge can be false)", () => {
  const { rows } = renderProduction();
  assert.ok(crossEdges(rows).length > 0, "cross-column edges exist for the negative control");
  const script = gitGraphClientScript().replace("y(e.toRow)", "(y(i) + rowH * 0.65)");
  assert.notEqual(script, gitGraphClientScript(), "the stub substitution actually changed the script");
  const mount = executeScript(script, rows);
  const edges = collectByClass(mount, "git-svg-edge");
  const centers = nodeCenters(rows);
  let unanchored = 0;
  for (const e of edges) {
    const ep = pathEndpoints(e.attrs.d);
    if (!nearNode(centers, ep.x1, ep.y1, 1)) unanchored++;
    if (!nearNode(centers, ep.x2, ep.y2, 1)) unanchored++;
  }
  assert.ok(unanchored > 0, `the fixed stub leaves ${unanchored} unanchored endpoints (must be > 0)`);
});

// ── AC5: window-outside parents get a distinguishable dashed marker; count matches ───────────────

test("AC5: window-outside parents get a distinguishable dashed marker; count matches", () => {
  const { rows, outside } = renderProduction();
  const inWindow = new Set(rows.map((r) => r.hash));
  let expected = 0;
  rows.forEach((r) => r.parentHashes.forEach((p) => { if (!inWindow.has(p)) expected++; }));
  let marked = 0;
  rows.forEach((r) => r.edges.forEach((e) => { if (e.outsideWindow) marked++; }));
  assert.ok(expected > 0, "the production window has at least one outside-window parent (a non-degenerate judge)");
  assert.equal(marked, expected, "the layout marks exactly the outside-window parents");
  assert.equal(outside.length, expected, "rendered outside markers equal the outside-window parent count");
  for (const e of outside) {
    assert.equal(e.attrs.class, "git-svg-edge-outside", "outside edges use a distinct class (not git-svg-edge)");
    assert.ok(e.attrs["stroke-dasharray"], "each outside edge carries a stroke-dasharray marker (distinct from a normal edge)");
    assert.equal(e.attrs.y2, y(rows.length), "the outside stub ends at the window boundary");
  }
});

// ── AC6: page-scoped width override wide enough for the SVG ─────────────────────────────────────

test("AC6: the git-history page emits a page-scoped #main width override wide enough for the 1288px SVG", () => {
  const html = renderGitHistoryPage(productionHistory());
  const m = html.match(/#main\s*\{\s*max-width:\s*([0-9.]+)px/);
  assert.ok(m, "the git-history page emits a page-scoped #main max-width override");
  const px = Number(m[1]);
  // content width = max-width − 2×1rem(16px) padding; must cover the measured 1288px SVG at 1440px.
  assert.ok(px >= 1320, `override max-width ${px}px yields >= 1288px content width (needs >= 1320px)`);
});

// ── AC7: the global 900px cap in serve-render.ts is untouched ───────────────────────────────────

test("AC7: serve-render.ts keeps the bare `main { max-width: 900px }` rule (global untouched)", () => {
  const src = readFileSync(path.resolve(__dirname, "../src/serve-render.ts"), "utf8");
  assert.ok(/^main\s*\{[^}]*max-width:\s*900px/m.test(src), "the bare main rule's 900px cap survives (global not changed)");
});

// ── AC8: orthogonal rounded geometry — H/V/Q only, no L, non-degenerate corner ──────────────────

function edgePathViolation(d) {
  if (typeof d !== "string" || !d.trim()) return "missing d";
  const s = d.trim();
  if (!/^M\s*-?[\d.]+\s*,\s*-?[\d.]+/.test(s)) return "must start with M x,y";
  const letters = s.match(/[A-Za-z]/g) || [];
  const bad = letters.filter((ch) => !"MHVQZ".includes(ch.toUpperCase()));
  if (bad.length) return "forbidden command(s): " + bad.join(",");
  const q = s.match(/Q\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
  if (!q) return "no rounded Q corner (right-angle)";
  if (Number(q[4]) === Number(q[2]) && Number(q[3]) === Number(q[1])) return "degenerate Q x,y x,y";
  return null;
}

test("AC8: every .git-svg-edge is an orthogonal rounded path (H/V/Q only, no L, radius > 0)", () => {
  const { edges } = renderProduction();
  assert.ok(edges.length > 0, "cross-column edges exist to inspect");
  for (const e of edges) {
    assert.equal(edgePathViolation(e.attrs.d), null, `edge path is orthogonal rounded: ${e.attrs.d}`);
  }
});

test("AC8 negative control: a straight diagonal path is rejected by the orthogonal judge", () => {
  assert.ok(edgePathViolation("M 56,48 L 120,72") !== null, "a diagonal's L command is caught by the AC8 judge");
  assert.ok(edgePathViolation("M 56,48 H 120 V 72") !== null, "a right-angle (no Q) path is caught by the AC8 judge");
});

// ── AC9: per-column hue coding (distinct colours = |{col % 8}|; INDEX-adjacent differ) ──────────
// gap-git-graph-lane-colour-assertion-assumes-contiguous-columns: the renderer's ONLY promised
// invariant is serve-git.ts:445 `laneColor(col) = lanePalette[col % lanePalette.length]` (and :65's
// "two ADJACENT columns differ") — it says NOTHING about the drawn column set being contiguous.
// `readGitHistory` walks `git log --all --topo-order`, so the window's column indices are whatever the
// live branch/worktree graph yields: sparse (e.g. [0,1,2,8,9]) or dense, and `col % 8` collides under
// sparsity. The old `distinct === min(8, cols.length)` (and the old "consecutive DRAWN columns differ"
// loop) assumed contiguity and fired intermittently on unrelated tasks' fan-ins. The judge below
// asserts exactly the renderer's promise: green for BOTH inputs, still red when laneColor is constant.

/** AC9 colour judge (single source — main test / sparse case / negative control all reuse it): map
 *  each drawn column line's x1 back to its column index, then compare the stroke SET against the
 *  renderer's promise. Returns { cols, distinct, expected, adjacentViolations } for caller-side
 *  assertion messages (hard rule 3: enumerate the drawn columns, never a bare boolean). */
function ac9ColourVerdict(columns) {
  const byCol = new Map();
  for (const line of columns) {
    const col = Math.round((Number(line.attrs.x1) - GIT_GRAPH_TRUNK_X) / GIT_GRAPH_LANE_GAP);
    byCol.set(col, line.attrs.stroke);
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const distinct = new Set(cols.map((c) => byCol.get(c)));
  const expected = new Set(cols.map((c) => c % GIT_GRAPH_LANE_PALETTE.length)).size;
  // The renderer promises INDEX-adjacent columns (c and c+1) differ, NOT that consecutive DRAWN
  // columns differ — under a sparse set [0,8] both draw lane-0, so the old loop was itself flaky.
  const adjacentViolations = [];
  for (let k = 1; k < cols.length; k++) {
    if (cols[k] !== cols[k - 1] + 1) continue;
    if (byCol.get(cols[k]) === byCol.get(cols[k - 1])) adjacentViolations.push(`${cols[k - 1]} vs ${cols[k]}`);
  }
  return { cols, distinct, expected, adjacentViolations };
}

/** Deterministic sparse-lane rows (AC2): a fixed commit DAG — a 10-parent merge whose 5 in-window
 *  children land at columns [0,1,2,8,9] (ghost parents g3..g7 hold the gap lanes 3..7, and each lane's
 *  tail parent L*h is out-of-window so the lane never closes) — NO production repo state is read.
 *  `col % 8` collides (0≡8, 1≡9) ⇒ the old min(8, cols.length) assertion is red here, the
 *  renderer-promise assertion is green. */
function sparseLaneRows() {
  return [
    { hash: "M", parents: 10, parentHashes: ["L0", "L1", "L2", "g3", "g4", "g5", "g6", "g7", "L8", "L9"], subject: "sparse merge", decorations: [] },
    { hash: "L0", parents: 1, parentHashes: ["L0h"], subject: "lane 0", decorations: [] },
    { hash: "L1", parents: 1, parentHashes: ["L1h"], subject: "lane 1", decorations: [] },
    { hash: "L2", parents: 1, parentHashes: ["L2h"], subject: "lane 2", decorations: [] },
    { hash: "L8", parents: 1, parentHashes: ["L8h"], subject: "lane 8", decorations: [] },
    { hash: "L9", parents: 1, parentHashes: ["L9h"], subject: "lane 9", decorations: [] },
  ];
}

test("AC9: column lines are per-column hue-coded (distinct colours = |{col % 8}|; index-adjacent differ)", () => {
  const { columns } = renderProduction();
  const v = ac9ColourVerdict(columns);
  assert.ok(v.cols.length > 0, "the production window has at least one column");
  assert.equal(v.distinct.size, v.expected, `distinct column colours = |{col % 8}| = ${v.expected} (got ${v.distinct.size}; drawn cols [${v.cols}])`);
  assert.deepEqual(v.adjacentViolations, [], `index-adjacent drawn columns differ in hue (violations: ${v.adjacentViolations.join(", ") || "none"})`);
  // the token mechanism: gitGraphLaneTokenCss() emits the --color-lane-N sheet the renderer references.
  const css = gitGraphLaneTokenCss();
  assert.ok(css.includes("--color-lane-0:#b71c1c"), "the token sheet defines --color-lane-0 from the palette");
  assert.ok(css.includes("--color-lane-7:#1a237e"), "the token sheet defines --color-lane-7 from the palette");
});

test("AC9 sparse input (deterministic): the |{col % 8}| judge is green on fixed sparse columns [0,1,2,8,9]", () => {
  const rows = sparseLaneRows();
  const colOf = assignGitColumns(rows);
  const drawn = [...new Set(rows.map((r) => colOf.get(r.hash)))].sort((a, b) => a - b);
  // Pin the fixture: non-contiguous AND with a mod-8 collision — exactly the production shape that made
  // the old assertion red, so this case regresses it deterministically (never depends on live refs).
  assert.deepEqual(drawn, [0, 1, 2, 8, 9], `the sparse fixture draws columns [0,1,2,8,9] (got [${drawn}])`);
  const mount = executeScript(gitGraphClientScript(), rows);
  const v = ac9ColourVerdict(collectByClass(mount, "git-svg-column"));
  assert.equal(v.distinct.size, v.expected, `sparse columns keep distinct = |{col % 8}| = ${v.expected} (got ${v.distinct.size})`);
  assert.deepEqual(v.adjacentViolations, [], `index-adjacent sparse columns differ in hue (violations: ${v.adjacentViolations.join(", ") || "none"})`);
});

test("AC9 negative control: a constant laneColor breaks the |{col % 8}| assertion (judge can be false)", () => {
  const script = gitGraphClientScript().replace("lanePalette[col % lanePalette.length]", "lanePalette[0]");
  assert.notEqual(script, gitGraphClientScript(), "the mono substitution changed the script");
  const mount = executeScript(script, sparseLaneRows());
  const v = ac9ColourVerdict(collectByClass(mount, "git-svg-column"));
  assert.ok(v.cols.length > 0, "the mono render has columns to judge");
  assert.equal(v.distinct.size, 1, `a constant laneColor yields exactly 1 colour (got ${v.distinct.size})`);
  assert.ok(v.expected > 1, `the |{col % 8}| promise is ${v.expected} distinct colours (non-vacuous)`);
  assert.notEqual(v.distinct.size, v.expected, `the judge goes false: distinct ${v.distinct.size} ≠ expected ${v.expected}`);
});

// ── AC10: the restored palette matches 303a94950^ item-by-item ─────────────────────────────────

test("AC10: restored GIT_GRAPH_LANE_PALETTE matches 303a94950^ item-by-item", () => {
  const recovered = execFileSync("git", ["-C", REPO_ROOT, "show", "303a94950^:packages/quay/src/serve-git.ts"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const block = recovered.match(/GIT_GRAPH_LANE_PALETTE[^=]*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "the recovered source carries GIT_GRAPH_LANE_PALETTE");
  const refHex = (block[1].match(/#[0-9a-fA-F]{6}/g) || []).map((h) => h.toLowerCase());
  assert.equal(refHex.length, 8, "the recovered palette has 8 entries");
  assert.deepEqual(GIT_GRAPH_LANE_PALETTE.map((h) => h.toLowerCase()), refHex, "restored palette matches item-by-item");
});
