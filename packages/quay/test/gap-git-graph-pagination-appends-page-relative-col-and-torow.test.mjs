// @test-group product
// gap-git-graph-pagination-appends-page-relative-col-and-torow — 滚动加载后图崩：分页行携带页内相对的
// col 与 edges[].toRow，合并后布局失效（一次滚动 144 条边脱锚、列线侵入文本）。修法：①分页 payload 只
// 传原始提交（无 col / 无 toRow）；②分页游标从时间戳 `--before` 改为发射序 `--skip`（`git log --skip`
// 连续地接续 `--all --topo-order`，否则 `--before` 会重排/丢提交，合并序列永远不等于 `git log --all
// --topo-order -n <loaded>`）；③客户端对合并后的全序列用注入的 assignGitColumns 重算 col 与边；④render
// 前按最大列号重算 textX，列线结构性永不侵入文本。
//
//   AC1  多轮加载后仍全锚定：≥3 次滚动加载后 .git-svg-edge 两端未锚定数 = 0（当前一次加载即 144）。
//   AC2  对拍扩到分页之后：加载 N 轮后页面每个提交的列号与 git log --graph --all -n <已加载条数>
//        逐条相等，不一致数 = 0；判据以已加载条数为 n，不得写死 500。
//   AC3  列线永不侵入文本区：line.git-svg-column 的最大 x < 提交文本的最小 x；侵入条数 = 0。
//   AC4  负控制：还原「原样 push 分页行」旧写法，断言 AC1 脱锚数 > 0（判据能取假）。
//   AC5  无双份布局实现：export function assignGitColumns = 1，客户端脚本注入 assignGitColumns.toString()
//        且恰一次（单一来源）。
//   AC6  分页 payload 不再携带页内相对量：行对象不含 col 字段、不含 edges（故不含 toRow）。
//   AC7  生产读数：AC1/AC2/AC3 均在真实生产仓库经多轮加载后取值（>500 条、有跨列边），非 fixture。
//
// ── gap-git-graph-pagination-ac2-oracle-races-live-refs: the feed and the oracle read ONE frozen ref window ──
// The feed (`readGitHistory` → `git log --all --topo-order -n 500 --skip=N`) and the oracle
// (`git log --graph --all -n <loaded>`) used to be two INDEPENDENT LIVE reads of `--all`. Any ref that
// advanced between them shifted the window head by K and dropped K off the tail ⇒ exactly K
// mismatches, every one shaped `git=undefined` (the rendered commit is not IN the oracle window) and
// never `git=<number>` — a window SHIFT, not a column bug. Both sides now take the SAME frozen ref
// window; see the block above `snapshotRefWindow()`.
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGitHistory, clearGitHistoryCache, GIT_HISTORY_LIMIT, realGitExec } from "../src/observation.ts";
import {
  gitGraphClientScript,
  assignGitColumns,
  layoutGitGraph,
  gitGraphRawRows,
  gitHistoryJson,
  GIT_GRAPH_TRUNK_X,
  GIT_GRAPH_LANE_GAP,
} from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIMIT = GIT_HISTORY_LIMIT;

// ── minimal DOM + d3 mocks to EXECUTE the emitted client IIFE and capture the rendered SVG ──────
// (same self-returning selection harness as the cross-column test — the real client code runs, no
// re-implementation of the geometry.)

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

function nearNode(centers, x, y, tol) {
  return centers.some((c) => Math.abs(c.x - x) <= tol && Math.abs(c.y - y) <= tol);
}

/** Node centers as RENDERED by the client (circle cx/cy + rotated merge-rect center), not re-derived. */
function renderedNodeCenters(mount) {
  const centers = [];
  for (const c of collectByClass(mount, "git-svg-commit")) {
    centers.push({ x: Number(c.attrs.cx), y: Number(c.attrs.cy) });
  }
  for (const r of collectByClass(mount, "git-svg-merge")) {
    const m = /rotate\(45\s+([-\d.]+)\s+([-\d.]+)\)/.exec(r.attrs.transform || "");
    if (m) centers.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return centers;
}

/** Rendered commit hash → column (read off each node's x position and its <title> hash). */
function renderedColByHash(mount) {
  const map = new Map();
  for (const n of [...collectByClass(mount, "git-svg-commit"), ...collectByClass(mount, "git-svg-merge")]) {
    const title = n.children.find((c) => c.tag === "title");
    if (!title) continue;
    const hash = title.text.split(" · ")[0];
    let cx;
    if (n.tag === "circle") cx = Number(n.attrs.cx);
    else { const m = /rotate\(45\s+([-\d.]+)\s+([-\d.]+)\)/.exec(n.attrs.transform || ""); cx = m ? Number(m[1]) : NaN; }
    const col = Math.round((cx - GIT_GRAPH_TRUNK_X) / GIT_GRAPH_LANE_GAP);
    map.set(hash, col);
  }
  return map;
}

// ── the immutable ref window (gap-git-graph-pagination-ac2-oracle-races-live-refs) ────────────────
//
// RACE (measured 2026-09-14: 1 real fan-in sample + 1 controlled repro, same signature): the FEED
// (`readGitHistory` → `git log --all --topo-order -n 500 --skip=N`) and the ORACLE
// (`git log --graph --all -n <loaded>`) were TWO INDEPENDENT LIVE READS of `--all`, with no snapshot
// between them. Any ref that advances in between shifts the window head by K and drops K off the
// tail ⇒ exactly K mismatches, every one shaped `git=undefined` (the rendered commit is not IN the
// oracle window) and never `git=<number>`. A window SHIFT, not a column bug. This repo's loop keeps
// advancing `develop`/`author` WHILE the suite runs, so `--all`'s stability was an assumption the
// test never held and production never satisfies.
//
// FIX: snapshot the ref set ONCE into immutable object names and hand the SAME list to BOTH sides.
// `git log <sha…>` over a frozen list is a pure function of immutable git objects — no live ref is
// read on either side, so there is no instant at which the two windows can disagree.
// (Verified on this repo, `--skip` 0/500/1000/1500: `git log <all-ref-shas> --topo-order -n 500
// --skip=N` is byte-identical to `git log --all --topo-order -n 500 --skip=N`, and
// `git log --graph <shas>` to `git log --graph --all`.)
//
// LOCATION: snapshotRefWindow() / frozenGitExec() below. The production read path (`observation.ts`)
// is UNCHANGED — the frozen list is fed through its existing `exec` host-read seam (`GitExec`),
// which exists for exactly this ("hand the reader a frozen snapshot of the host instead of racing
// the live repo"). This is NOT a fixture: the real `git` binary reads the real repo; only the
// START-POINT LIST is pinned instead of `--all`.
// TIMING: taken at the top of each reading helper, BEFORE either side reads; both the feed and the
// oracle of that reading are served from it.

/** Negative-control seam (task AC3): with this set both sides go back to reading live `--all`
 *  independently — the pre-fix shape — so the race is re-exposed under concurrent ref churn.
 *  Default (unset) = the frozen window. */
const LIVE_REFS = process.env.QUAY_TEST_GIT_GRAPH_LIVE_REFS === "1";

/** The repo's ref set frozen into immutable object names, plus a provenance record (which refs, when). */
function snapshotRefWindow() {
  const out = execFileSync("git", ["-C", REPO_ROOT, "for-each-ref", "--format=%(objectname)%09%(refname)"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const shas = new Set();
  const heads = [];
  const tags = [];
  for (const line of out.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (!sha || !ref) continue;
    shas.add(sha);
    if (ref.startsWith("refs/heads/")) heads.push(ref);
    else if (ref.startsWith("refs/tags/")) tags.push(ref);
  }
  try {
    const h = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (h) shas.add(h); // `--all` includes HEAD, `for-each-ref refs/` does not
  } catch { /* unborn HEAD — `%D` still marks it when it exists */ }
  return { shas: [...shas].sort(), refCount: shas.size, heads, tags, at: new Date().toISOString() };
}

/** The window for one reading: frozen by default, `null` only under the negative-control seam. */
function resolveRefWindow() {
  return LIVE_REFS ? null : snapshotRefWindow();
}

/** A `GitExec` that pins every `log` invocation to the frozen ref window (no live `--all`). */
function frozenGitExec(shas) {
  return (args, opts = {}) =>
    execFileSync("git", args.includes("log") ? args.flatMap((a) => (a === "--all" ? shas : [a])) : args, {
      encoding: "utf8",
      timeout: opts.timeout ?? 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
}

/** The git oracle: `git log --graph <frozen window> -n <n>` → hash → column (the adopt test's
 *  sentinel parse). `refs = null` is the negative-control live-`--all` arm. */
function gitGraphReferenceColumns(n, refs = null) {
  const out = execFileSync(
    "git",
    ["-C", REPO_ROOT, "log", "--graph", ...(refs ? refs.shas : ["--all"]), "-n", String(n), "--pretty=format:%x01%H"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const map = new Map();
  for (const line of out.split("\n")) {
    const idx = line.indexOf("\x01");
    if (idx === -1) continue;
    const hash = line.slice(idx + 1).trim();
    const star = line.indexOf("*");
    if (star === -1) continue;
    map.set(hash, Math.floor(star / 2));
  }
  return map;
}

/** The column-window judge, with an explicit THIRD state (硬规则 3b: "cannot evaluate" must not
 *  share an output with "passed"). `evaluated` carries a mismatch count that must be 0;
 *  `not-evaluated` means the two windows could not be lined up at all, which is NOT a column
 *  verdict and must never be reported as one. */
function judgeColumnWindow({ renderedCols, oracleCols, loaded }) {
  if (oracleCols.size !== loaded) {
    return {
      state: "not-evaluated",
      mismatch: null,
      samples: [],
      reason: `oracle window size ${oracleCols.size} ≠ loaded ${loaded} — the two windows do not line up, so a mismatch count here would be meaningless`,
    };
  }
  let mismatch = 0;
  const samples = [];
  for (const [hash, col] of renderedCols) {
    if (oracleCols.get(hash) !== col) {
      mismatch++;
      if (samples.length < 8) samples.push(`${hash.slice(0, 7)} rendered=${col} git=${oracleCols.get(hash)}`);
    }
  }
  return { state: "evaluated", mismatch, samples, reason: null };
}

/** Execute the emitted client script with a fetch queue + an IntersectionObserver we can fire by hand.
 *  The sentinel reports a far-off position so the self-chain does NOT auto-fire — each trigger() is
 *  exactly one loadOlder(), giving deterministic "load N times" control. */
function runClientWithLoads({ seedRows, pages, script }) {
  const mount = makeEl("div");
  const dataEl = { textContent: JSON.stringify({ rows: seedRows }) };
  const sentinel = {
    textContent: "",
    getBoundingClientRect: () => ({ top: 10000, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    addEventListener: () => {},
  };
  const elements = {
    "git-graph": mount,
    "git-graph-data": dataEl,
    "git-graph-sentinel": sentinel,
    "git-graph-coverage": { textContent: "" },
  };
  const fetchCalls = [];
  const queue = pages.slice();
  let ioCb = null;
  class IntersectionObserver { constructor(cb) { ioCb = cb; } observe() {} unobserve() {} disconnect() {} }
  const sandbox = {
    document: { getElementById: (id) => (id in elements ? elements[id] : null) },
    window: { innerHeight: 1000 },
    d3: { select: (el) => makeSel(el) },
    IntersectionObserver,
    fetch: (url) => {
      fetchCalls.push(url);
      const p = queue.length ? queue.shift() : { status: "ok", reason: null, rows: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(p) });
    },
  };
  new vm.Script(script).runInNewContext(sandbox);
  return { mount, fetchCalls, trigger: () => ioCb([{ isIntersecting: true }]) };
}

/** Drain the microtask queue (each loadOlder page is several Promise hops). */
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Build the production multi-page feed exactly as the client walks it: initial page + skip=500k pages.
 *  `refs` (the frozen window) is threaded into the production read path via its `exec` seam; `null`
 *  is the negative-control arm that reads live `--all`. */
function productionFeed(pageCount, refs) {
  const exec = refs ? frozenGitExec(refs.shas) : realGitExec;
  const pages = [];
  for (let k = 0; k < pageCount; k++) {
    const h = readGitHistory(REPO_ROOT, { limit: LIMIT, skip: k === 0 ? null : LIMIT * k, exec });
    assert.equal(h.status, "ok", `production page ${k} reads ok`);
    pages.push(h);
  }
  return pages;
}

/** Run the real client over `loads` additional pages (each trigger = one loadOlder); return the mount
 *  and the frozen ref window both sides were served from (so the oracle can use the same one). */
async function renderAfterLoads(loads, script = gitGraphClientScript()) {
  const refs = resolveRefWindow(); // frozen ONCE, before either the feed or the oracle reads
  const feed = productionFeed(loads + 1, refs);
  const seed = layoutGitGraph(feed[0]).rows;
  const pages = feed.slice(1).map((h) => ({ status: "ok", reason: null, rows: gitGraphRawRows(h) }));
  const { mount, fetchCalls, trigger } = runClientWithLoads({ seedRows: seed, pages, script });
  for (let i = 0; i < loads; i++) { trigger(); await flush(); }
  assert.ok(fetchCalls.length >= loads, `≥${loads} scroll loads happened (${fetchCalls.length})`);
  return { mount, refs };
}

// ── AC1: after ≥3 scroll loads every cross-column edge endpoint anchors to a node center ─────────

test("AC1: after ≥3 scroll loads every .git-svg-edge endpoint anchors to a node center (unanchored = 0)", async () => {
  clearGitHistoryCache();
  const { mount } = await renderAfterLoads(3);
  const edges = collectByClass(mount, "git-svg-edge");
  assert.ok(edges.length > 0, "cross-column edges exist after pagination (a non-degenerate judge)");
  const centers = renderedNodeCenters(mount);
  assert.ok(centers.length > 500, `the rendered page has >500 nodes (${centers.length}), i.e. past the first page`);
  let unanchored = 0;
  for (const e of edges) {
    const ep = pathEndpoints(e.attrs.d);
    if (!nearNode(centers, ep.x1, ep.y1, 1)) unanchored++;
    if (!nearNode(centers, ep.x2, ep.y2, 1)) unanchored++;
  }
  assert.equal(unanchored, 0, `every edge endpoint anchored after pagination (got ${unanchored}; the bug was 144 after one load)`);
});

// ── AC2: the rendered column of every loaded commit equals git log --graph --all -n <loaded> ──────

test("AC2: after N pages every rendered commit's column equals git log --graph --all -n <loaded> (mismatch = 0)", async () => {
  clearGitHistoryCache();
  const loads = 3;
  const { mount, refs } = await renderAfterLoads(loads);
  const renderedCols = renderedColByHash(mount);
  const loaded = renderedCols.size;
  assert.ok(loaded > LIMIT, `the judge uses the loaded count (${loaded}), not a hardcoded ${LIMIT}`);
  const oracleCols = gitGraphReferenceColumns(loaded, refs); // SAME frozen window as the feed
  // Reading provenance: which window, and when it was taken (this task's fix / 取值时机).
  console.log(
    `[AC2] oracle window: ${refs ? `FROZEN at ${refs.at} (${refs.refCount} ref object names)` : "LIVE --all (negative-control seam QUAY_TEST_GIT_GRAPH_LIVE_REFS=1)"}; n=${loaded}`,
  );
  const judged = judgeColumnWindow({ renderedCols, oracleCols, loaded });
  assert.equal(
    judged.state,
    "evaluated",
    `NOT-EVALUATED — ${judged.reason} (the oracle must not report a column verdict it could not compute)`,
  );
  assert.equal(
    judged.mismatch,
    0,
    `column mismatch after ${loads} pages = 0 (got ${judged.mismatch} of ${loaded}${judged.samples.length ? ": " + judged.samples.join(", ") : ""})`,
  );
  // The third state is REACHABLE and distinguishable, over a real reading of a real window: an
  // oracle window that does not line up is reported as not-evaluated — never as a mismatch count
  // and never as a pass (硬规则 3b: "读不懂输入" must not share an output with "合格").
  const misaligned = judgeColumnWindow({ renderedCols, oracleCols: gitGraphReferenceColumns(loaded - 1, refs), loaded });
  assert.equal(misaligned.state, "not-evaluated", "an unaligned window is the distinguishable third state, not a pass");
  assert.equal(misaligned.mismatch, null, "the third state carries no mismatch count (it cannot share an output with `passed`)");
});

// ── AC3: every column line's x is strictly left of the commit text's x (intrusions = 0) ──────────

test("AC3: every line.git-svg-column x is strictly left of the commit text's x (intrusions = 0)", async () => {
  clearGitHistoryCache();
  const { mount } = await renderAfterLoads(3);
  const columns = collectByClass(mount, "git-svg-column");
  const texts = collectByClass(mount, "git-svg-ink");
  assert.ok(columns.length > 0 && texts.length > 0, "column lines and commit text both exist (non-degenerate)");
  const minTextX = Math.min(...texts.map((t) => Number(t.attrs.x)));
  let intrusions = 0;
  const bad = [];
  for (const line of columns) {
    const x = Number(line.attrs.x1);
    if (x >= minTextX) { intrusions++; if (bad.length < 8) bad.push(x); }
  }
  assert.equal(intrusions, 0, `column lines never reach the text x (min text x ${minTextX}; got ${intrusions} intrusions${bad.length ? " at x=" + bad.join(",") : ""}; the bug was 7)`);
});

// ── AC4: negative control — the raw-push page rows (page-relative col/toRow, no recompute) dangle ──

test("AC4: restoring the raw-push page rows (page-relative col/toRow, no recompute) leaves unanchored > 0", async () => {
  clearGitHistoryCache();
  const feed = productionFeed(2, resolveRefWindow());
  const page1Rows = layoutGitGraph(feed[0]).rows;
  const page2Rows = layoutGitGraph(feed[1]).rows;
  // The OLD loadOlder: dedup + append page rows VERBATIM — page-relative col/edges/toRow survive to render.
  const have = new Set(page1Rows.map((r) => r.hash));
  const merged = page1Rows.slice();
  for (const r of page2Rows) if (!have.has(r.hash)) { have.add(r.hash); merged.push(r); }
  // The OLD script: recompute stripped, so the page-relative layout quantities are what render() draws.
  const oldScript = gitGraphClientScript().split("recomputeLayout();").join("");
  assert.notEqual(oldScript, gitGraphClientScript(), "stripping recompute actually changed the script");
  const { mount } = runClientWithLoads({ seedRows: merged, pages: [], script: oldScript });
  const edges = collectByClass(mount, "git-svg-edge");
  const centers = renderedNodeCenters(mount);
  let unanchored = 0;
  for (const e of edges) {
    const ep = pathEndpoints(e.attrs.d);
    if (!nearNode(centers, ep.x1, ep.y1, 1)) unanchored++;
    if (!nearNode(centers, ep.x2, ep.y2, 1)) unanchored++;
  }
  assert.ok(unanchored > 0, `the raw-push merge leaves ${unanchored} unanchored endpoints (must be > 0 — the judge can be false)`);
});

// ── AC5: single-source column allocation — one export, injected verbatim once into the client ─────

test("AC5: assignGitColumns is exported once and injected verbatim once (no second column allocation)", () => {
  const src = readFileSync(path.resolve(__dirname, "../src/serve-git.ts"), "utf8");
  const defs = (src.match(/export function assignGitColumns/g) || []).length;
  assert.equal(defs, 1, `serve-git.ts exports assignGitColumns exactly once (got ${defs})`);
  const script = gitGraphClientScript();
  const injected = assignGitColumns.toString();
  const idx = script.indexOf(injected);
  assert.ok(idx !== -1, "the client script injects assignGitColumns.toString() verbatim (single source)");
  assert.equal(script.indexOf(injected, idx + 1), -1, "the injected allocation appears exactly once (no second copy)");
  // The column-allocation core (active-column recycle) appears only inside the injected function — the
  // client's edge rebuild reads cols.get(), it does not re-implement the recycle loop.
  const core = "columns.indexOf(C.hash)";
  const coreIdx = script.indexOf(core);
  assert.ok(coreIdx !== -1, "the allocation core is present in the injected function");
  assert.equal(script.indexOf(core, coreIdx + 1), -1, "no second, independent column-allocation core in the client script");
});

// ── AC6: the pagination payload rows carry no col / no edges (hence no toRow) ────────────────────

test("AC6: the pagination payload rows carry no col and no edges/toRow (raw commits only)", () => {
  clearGitHistoryCache();
  const history = readGitHistory(REPO_ROOT, { limit: 100 });
  assert.equal(history.status, "ok");
  const json = gitHistoryJson(history, "git");
  assert.ok(json.rows.length > 0, "the payload has rows");
  for (const r of json.rows) {
    assert.ok(!("col" in r), "a raw row carries no col field");
    assert.ok(!("edges" in r), "a raw row carries no edges field (hence no edges[].toRow)");
    assert.ok("parentHashes" in r, "a raw row carries parentHashes so the client can recompute the layout");
  }
});

// ── AC7: the multi-load readings come from the real production repo (not a fixture) ──────────────

test("AC7: the AC1/AC2/AC3 readings operate on real production data (>500 rows, cross-column edges)", () => {
  clearGitHistoryCache();
  // AC5: the window IS the real repo's ref set — real branch refs AND real tag refs, i.e. a
  // ref-dense production repo, not a synthetic fixture with a handful of refs. AC7 snapshots
  // unconditionally: it asserts the READING is real, which is orthogonal to the negative-control
  // seam (that seam changes only which window AC2's comparison uses).
  const refs = snapshotRefWindow();
  assert.ok(
    refs.heads.length >= 1 && refs.tags.length >= 1,
    `the window is the real repo's ref set (${refs.heads.length} branch refs, ${refs.tags.length} tag refs)`,
  );
  const exec = frozenGitExec(refs.shas);
  const loaded = [];
  const seen = new Set();
  for (let k = 0; k < 3; k++) {
    const h = readGitHistory(REPO_ROOT, { limit: LIMIT, skip: k === 0 ? null : LIMIT * k, exec });
    assert.equal(h.status, "ok");
    assert.ok(h.commits.length > 0, `production page ${k} is non-empty (real repo, not a fixture)`);
    for (const c of h.commits) if (!seen.has(c.hash)) { seen.add(c.hash); loaded.push({ hash: c.hash, parentHashes: c.parentHashes }); }
  }
  assert.ok(loaded.length > LIMIT, `the merged production window exceeds one page (${loaded.length} > ${LIMIT})`);
  const cols = assignGitColumns(loaded);
  let cross = 0;
  for (const c of loaded) {
    const colC = cols.get(c.hash);
    for (const p of c.parentHashes) {
      const colP = cols.get(p);
      if (colP !== undefined && colP !== colC) cross++;
    }
  }
  assert.ok(cross > 0, `the merged production window has ${cross} cross-column edges (the anchoring judge is non-vacuous)`);
});
