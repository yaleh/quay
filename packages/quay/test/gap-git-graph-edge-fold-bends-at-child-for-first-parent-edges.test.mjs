// @test-group product
// gap-git-graph-edge-fold-bends-at-child-for-first-parent-edges — /git-history 的跨列边折角位置按边
// 的语义类型（GitGraphEdge.kind）分流：kind==="parent"（第一父、分支自身的谱系收口回父分支）的折角应
// 落在【父节点端】（子节点先在自己列里垂直走到父节点高度，再横向拐进父节点列），而现状对所有跨列边
// 一律"先横（子节点高度）再竖（落到父节点）"——对 merge 对、对 parent 反了。修法：edgePath 加一个
// bendAtParent 布尔参数，调用点按 `e.kind === "parent"` 传参；端点、命令集（M/H/V/Q 无 L）、圆角半径
// 全部不变。
//
//   AC1  merge 折角不变（回归防护）：kind==="merge" 的跨列边首绘制命令是 H，不满足数 = 0，且该类边总数 > 0。
//   AC2  parent 折角翻到父节点端（核心）：kind==="parent" 的跨列边首绘制命令是 V，不满足数 = 0，且该类边总数 > 0。
//   AC3  负控制：显式还原"永远 bendAtParent=false"，重跑 AC2 判据，断言不满足数 > 0（判据真能取假）。
//   AC4  端点不变：全部跨列边（含两类）起点/终点与改动前一致（误差 ≤1px），不满足数 = 0。
//   AC5  命令集与圆角约束保持：只允许 M/H/V/Q（无 L），每条边至少一个非退化 Q，不满足数 = 0。
//   AC6  判据基于 e.kind 的通用条件，不硬编码具体 commit hash/行号（AC1-AC5 全部如此）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-edge-fold-bends-at-child-for-first-parent-edges.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGitHistory } from "../src/observation.ts";
import {
  gitGraphClientScript,
  layoutGitGraph,
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
// (same vm+d3-mock手法 as gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs)

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

/** The first drawing command letter (the first command after the leading M). */
function firstDrawingCommand(d) {
  const cmds = d.match(/[MHVQZ][^MHVQZ]*/g) || [];
  for (const cmd of cmds) if (cmd[0] !== "M") return cmd[0];
  return null;
}

/** The AC8-style orthogonal-rounded judge: M/H/V/Q only (no L), non-degenerate Q corner. */
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

/** In-window cross-column edges WITH their kind, in the EXACT order the client draws them. */
function crossEdgesWithKind(rows) {
  const out = [];
  rows.forEach((r, i) => {
    r.edges.forEach((e) => {
      if (e.outsideWindow) return;
      if (e.fromCol === e.toCol) return;
      out.push({
        row: i,
        kind: e.kind,
        fromCol: e.fromCol,
        toCol: e.toCol,
        toRow: e.toRow,
        fromX: GIT_GRAPH_TRUNK_X + e.fromCol * GIT_GRAPH_LANE_GAP,
        fromY: y(i),
        toX: GIT_GRAPH_TRUNK_X + e.toCol * GIT_GRAPH_LANE_GAP,
        toY: y(e.toRow),
      });
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

/** Render the REAL client script over the production window; return { rows, edges } in draw order. */
function renderProduction() {
  const layout = productionLayout();
  const mount = executeScript(gitGraphClientScript(), layout.rows);
  return { rows: layout.rows, edges: collectByClass(mount, "git-svg-edge") };
}

/** The `d` strings for a given edge kind, zipped against the draw order (edges[k] ↔ exp[k]). */
function kindDs(rows, edges, kind) {
  const exp = crossEdgesWithKind(rows);
  assert.equal(edges.length, exp.length, "rendered edge count equals data cross-column count");
  const ds = [];
  for (let k = 0; k < edges.length; k++) if (exp[k].kind === kind) ds.push(edges[k].attrs.d);
  return ds;
}

// ── AC1: merge edges keep their child-end fold (first draw command is H) ────────────────────────

test("AC1: kind==='merge' cross-column edges keep the child-end fold (first draw command is H)", () => {
  const { rows, edges } = renderProduction();
  const ds = kindDs(rows, edges, "merge");
  assert.ok(ds.length > 0, "non-degenerate: the production window has kind==='merge' cross-column edges");
  let violations = 0;
  for (const d of ds) if (firstDrawingCommand(d) !== "H") violations++;
  assert.equal(violations, 0, `every merge edge starts with H (got ${violations} violating)`);
});

// ── AC2: parent edges fold at the parent end (first draw command is V) ─────────────────────────

test("AC2: kind==='parent' cross-column edges fold at the parent end (first draw command is V)", () => {
  const { rows, edges } = renderProduction();
  const ds = kindDs(rows, edges, "parent");
  assert.ok(ds.length > 0, "non-degenerate: the production window has kind==='parent' cross-column edges");
  let violations = 0;
  for (const d of ds) if (firstDrawingCommand(d) !== "V") violations++;
  assert.equal(violations, 0, `every parent edge starts with V (got ${violations} violating)`);
});

// ── AC3: negative control — forcing bendAtParent=false makes AC2's judge fail ───────────────────

test("AC3: forcing bendAtParent=false makes AC2's judge fail (judge can be false)", () => {
  const { rows } = renderProduction();
  const script = gitGraphClientScript().replace('e.kind === "parent"', "false");
  assert.notEqual(script, gitGraphClientScript(), "the substitution actually changed the script");
  const mount = executeScript(script, rows);
  const edges = collectByClass(mount, "git-svg-edge");
  const ds = kindDs(rows, edges, "parent");
  assert.ok(ds.length > 0, "non-degenerate: parent cross-column edges exist for the negative control");
  let violations = 0;
  for (const d of ds) if (firstDrawingCommand(d) !== "V") violations++;
  assert.ok(violations > 0, `forcing bendAtParent=false leaves ${violations} parent edges not starting with V (must be > 0)`);
});

// ── AC4: endpoints unchanged for ALL cross-column edges (±1px) ────────────────────────────────

test("AC4: endpoints of every cross-column edge (both kinds) are unchanged (±1px)", () => {
  const { rows, edges } = renderProduction();
  const exp = crossEdgesWithKind(rows);
  assert.equal(edges.length, exp.length, "rendered edge count equals data cross-column count");
  let violations = 0;
  for (let k = 0; k < edges.length; k++) {
    const ep = pathEndpoints(edges[k].attrs.d);
    const e = exp[k];
    if (Math.abs(ep.x1 - e.fromX) > 1 || Math.abs(ep.y1 - e.fromY) > 1) violations++;
    if (Math.abs(ep.x2 - e.toX) > 1 || Math.abs(ep.y2 - e.toY) > 1) violations++;
  }
  assert.equal(violations, 0, `every edge endpoint unchanged (got ${violations} violating endpoints)`);
});

// ── AC5: command set + rounded corner constraints preserved (M/H/V/Q only, non-degenerate Q) ───

test("AC5: every cross-column edge stays an orthogonal rounded path (M/H/V/Q only, no L, radius > 0)", () => {
  const { edges } = renderProduction();
  assert.ok(edges.length > 0, "cross-column edges exist to inspect");
  for (const e of edges) {
    assert.equal(edgePathViolation(e.attrs.d), null, `edge path is orthogonal rounded: ${e.attrs.d}`);
  }
});
