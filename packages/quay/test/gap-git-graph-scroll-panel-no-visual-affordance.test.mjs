// @test-group product
// gap-git-graph-scroll-panel-no-visual-affordance — git-history 滚动面板机制正确但零视觉存在感：
// `#git-graph-scroll`（gap-git-graph-no-bounded-scroll-panel 落地的独立滚动容器）贴视口边缘、无边框/
// 背景/滚动条提示，用户误以为「内容到此为止」。机制（容器滚动、IntersectionObserver root、自动加载、
// 保险丝）已正确，缺的是视觉可发现性——不是一个机制缺陷，是它的反方向缺口。修法：给容器加一个可辨识的
// 面板边界（border + box-shadow + surface 背景），并新增一个 sticky-bottom 的「↓ 更多提交」提示条，其
// 可见性随 scrollTop 是否触底而切换。
//
//   AC1  视觉边界：容器计算样式具备 border-width>0 或 box-shadow≠none（不满足数 = 0）。
//   AC2  底部提示：未滚到底时提示可见、滚到底时隐藏（判据能区分两种状态）。
//   AC3  机制不回归：复用 gap-git-graph-no-bounded-scroll-panel 的 vm 沙箱手法重跑其 AC1-AC5。
//   AC4  四视口回归：桌面宽/桌面窄/移动/暗色截图（DoD 证据，Playwright/chrome-devtools，本文件不自动化）。
//   AC5  负控制：把新增的边框/渐隐 CSS 还原为空，断言 AC1/AC2 判据不满足数 > 0（判据能取假）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-scroll-panel-no-visual-affordance.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { gitGraphClientScript, renderGitHistoryPage, GIT_GRAPH_AUTO_LOAD_ROW_LIMIT } from "../src/serve-git.ts";

/** A minimal row (the shape the client renderer reads: hash/t/subject/parents/col/decorations/edges). */
function commit(hash, t, subject) {
  return { hash, t, ref: "", parents: 0, parentHashes: [], subject, col: 0, decorations: [], edges: [] };
}

/** A minimal ok GitGraphLayout JSON page for /git-history.json?before=…&limit=… (the loadOlder shape). */
function page(rows) {
  return { status: "ok", reason: null, rows };
}

/** A minimal GitHistoryCommit for renderGitHistoryPage's server-side layout. */
function historyCommit(hash, t, subject) {
  return { hash, t, subject, parents: 0, parentHashes: [], decorations: [] };
}

/** A minimal ok GitHistoryResult for renderGitHistoryPage. */
function okHistory(commits) {
  return { status: "ok", reason: null, commits };
}

// ── minimal DOM + d3 mocks to EXECUTE the emitted client IIFE (not just compile it) ────────────
// The renderer's d3 usage is chainable selections only, so a self-returning selection with .node()/
// .each() suffices to run the whole IIFE to completion and reach loadOlder's fetch chain.

function makeNode() {
  return { getBBox: () => ({ x: 0, y: 0, width: 24, height: 12 }) };
}
function makeSel() {
  const sel = {
    select: () => makeSel(),
    selectAll: () => makeSel(),
    append: () => makeSel(),
    insert: () => makeSel(),
    attr: () => sel,
    style: () => sel,
    text: () => sel,
    on: () => sel,
    empty: () => false,
    remove: () => sel,
    data: () => sel,
    enter: () => sel,
    node: () => makeNode(),
    each(cb) { cb.call(makeNode()); return sel; },
  };
  return sel;
}

/**
 * Execute the client script (default: the real gitGraphClientScript(); override via `script` for the
 * AC3-4/AC5 negative controls) in a fresh vm context. Records every IntersectionObserver construction's
 * (cb, opts), the sentinel's click listeners (for the fuse test), and the scroll container's scroll
 * listener (for AC2's hint-toggle driving). `omitHint` drops `#git-graph-more-hint` from the DOM to
 * simulate AC5's stripped-negative-control.
 */
function runClient({ pages, seedCommits, omitHint = false }, script = gitGraphClientScript()) {
  const layout = { status: "ok", reason: null, rows: seedCommits, commitCount: seedCommits.length };
  const sentinel = {
    textContent: "",
    style: {},
    listeners: {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  };
  const scrollEl = {
    style: {},
    scrollTop: 0,
    clientHeight: 640,
    scrollHeight: 13000,
    listeners: {},
    getBoundingClientRect: () => ({ top: 200, left: 0, bottom: 840, right: 0, width: 1280, height: 640 }),
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  };
  const moreHint = { style: { display: "flex" } };
  const elements = {
    "git-graph": {},
    "git-graph-scroll": scrollEl,
    "git-graph-data": { textContent: JSON.stringify(layout) },
    "git-graph-sentinel": sentinel,
    "git-graph-coverage": { textContent: "" },
  };
  if (!omitHint) elements["git-graph-more-hint"] = moreHint;
  const fetchCalls = [];
  const queue = pages.slice();
  const ioCallbacks = [];
  const observerRecords = [];
  class IntersectionObserver {
    constructor(cb, opts) { ioCallbacks.push(cb); observerRecords.push({ cb, opts }); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const sandbox = {
    document: { getElementById: (id) => (id in elements ? elements[id] : null) },
    window: { innerHeight: 1000, scrollBy() {}, addEventListener() {} },
    d3: { select: () => makeSel() },
    IntersectionObserver,
    fetch(url) {
      fetchCalls.push(url);
      const p = queue.length ? queue.shift() : page([]);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(p) });
    },
  };
  new vm.Script(script).runInNewContext(sandbox);
  const fireScroll = () => { (scrollEl.listeners["scroll"] || []).forEach((fn) => fn()); };
  return { sentinel, scrollEl, elements, moreHint, fetchCalls, ioCallbacks, observerRecords, fireScroll };
}

/** Drain the microtask queue (each self-chain page is one Promise.resolve hop). */
async function flush() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Walk `<div`/`</div>` balance forward from a `<div` open-tag index; return the index of its close. */
function containerClose(html, fromIdx) {
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = fromIdx;
  let m;
  while ((m = re.exec(html)) !== null) {
    depth += m[0] === "<div" ? 1 : -1;
    if (depth === 0) return m.index;
  }
  return -1;
}

/** Extract the `style="…"` attribute of `#git-graph-scroll` from the rendered page. */
function scrollContainerStyle(html) {
  const open = html.indexOf('<div id="git-graph-scroll"');
  assert.ok(open !== -1, "the scroll container exists in the rendered page");
  const styleStart = html.indexOf("style=", open);
  const styleEnd = html.indexOf(">", styleStart);
  return html.slice(styleStart + 6, styleEnd).replace(/"/g, "");
}

/** AC1 predicate: the container carries a recognizable boundary (border-width>0 OR box-shadow≠none). */
function boundarySatisfied(styleStr) {
  const bw = /border:\s*(\d+(?:\.\d+)?)px/.exec(styleStr);
  const borderWidthGt0 = bw ? parseFloat(bw[1]) > 0 : false;
  const bs = /box-shadow:\s*([^;"]+)/.exec(styleStr);
  const boxShadowNotNone = bs ? bs[1].trim() !== "none" : false;
  return borderWidthGt0 || boxShadowNotNone;
}

/** AC2 predicate: the hint is present AND its display toggles between "not at bottom" and "at bottom". */
function hintToggling(run) {
  const hint = run.elements["git-graph-more-hint"];
  if (!hint) return false;
  const { scrollEl } = run;
  scrollEl.scrollTop = 0; scrollEl.clientHeight = 640; scrollEl.scrollHeight = 13000;
  run.fireScroll();
  const notAtBottom = hint.style.display;
  scrollEl.scrollTop = 12360;
  run.fireScroll();
  const atBottom = hint.style.display;
  return notAtBottom === "flex" && atBottom === "none";
}

/** AC5 negative control: strip the added border/fade CSS back to the pre-change state. */
function stripVisualAffordance(html) {
  return html
    .replace(/;border:1px solid var\(--color-divider\)/, "")
    .replace(/;border-radius:6px/, "")
    .replace(/;background:var\(--color-surface\)/, "")
    .replace(/;box-shadow:var\(--shadow-sm\)/, "")
    .replace(/<div id="git-graph-more-hint"[^>]*>[^<]*<\/div>/, "");
}

// ── AC1: the scroll container has a recognizable panel boundary ─────────────────────────────────

test("AC1: the scroll container has border-width>0 or box-shadow≠none (not-satisfied count = 0)", () => {
  const html = renderGitHistoryPage(okHistory([historyCommit("a", 1000, "base")]), "git");
  const styleStr = scrollContainerStyle(html);
  assert.equal(boundarySatisfied(styleStr), true, "container carries a visible boundary");
});

// ── AC2: the bottom hint toggles with scroll position ───────────────────────────────────────────

test("AC2: the bottom hint is visible when not scrolled to bottom, hidden at bottom", () => {
  const run = runClient({ pages: [], seedCommits: [commit("c0", 1000, "base")] });
  assert.equal(hintToggling(run), true, "hint visibility distinguishes the two scroll states");
});

// ── AC3: the existing scroll/load mechanism is unchanged (re-runs the prior task's AC1-AC5) ─────

test("AC3-1: the scroll container still has a height constraint AND overflow-y:auto", () => {
  const html = renderGitHistoryPage(okHistory([historyCommit("a", 1000, "base")]), "git");
  const styleStr = scrollContainerStyle(html);
  assert.match(styleStr, /overflow-y:\s*(auto|scroll)/, "container has overflow-y:auto/scroll");
  assert.match(styleStr, /max-height:/, "container has an inline max-height fallback");
  assert.match(gitGraphClientScript(), /style\.maxHeight\s*=/, "client script sets style.maxHeight at runtime");
  assert.match(styleStr, /overflow-x:\s*auto/, "container also carries overflow-x:auto");
});

test("AC3-2: git-graph-sentinel is still inside the scroll container", () => {
  const html = renderGitHistoryPage(okHistory([historyCommit("a", 1000, "base")]), "git");
  const scrollOpen = html.indexOf('<div id="git-graph-scroll"');
  const graphOpen = html.indexOf('id="git-graph"');
  const sentinel = html.indexOf('id="git-graph-sentinel"');
  const dataScript = html.indexOf('id="git-graph-data"');
  assert.ok(scrollOpen !== -1 && graphOpen !== -1 && sentinel !== -1, "container, graph, sentinel all present");
  assert.ok(scrollOpen < graphOpen && graphOpen < sentinel, "container wraps #git-graph and the sentinel");
  const close = containerClose(html, scrollOpen);
  assert.ok(close > sentinel, "the sentinel falls inside the container (before its closing </div>)");
  assert.ok(close < dataScript, "the container closes before the data script — nothing escapes it");
});

test("AC3-3: IntersectionObserver opts.root is the scroll container element", () => {
  const { elements, observerRecords } = runClient({ pages: [], seedCommits: [commit("c0", 1000, "base")] });
  assert.equal(observerRecords.length, 1, "exactly one IntersectionObserver is constructed");
  const { opts } = observerRecords[0];
  assert.ok(opts && typeof opts === "object", "the observer received an options object");
  assert.notEqual(opts.root, undefined, "opts.root is not undefined");
  assert.equal(opts.root, elements["git-graph-scroll"], "opts.root is the concrete scroll container element");
});

test("AC3-4: negative control — stripping the root arg reverts to undefined", () => {
  const src = gitGraphClientScript();
  assert.match(src, /root:\s*scrollEl/, "the real script passes root: scrollEl");
  const stripped = src.replace("root: scrollEl, ", "");
  assert.notEqual(stripped, src, "the negative control actually removed the root key");
  const { observerRecords } = runClient({ pages: [], seedCommits: [commit("c0", 1000, "base")] }, stripped);
  assert.equal(observerRecords[0].opts.root, undefined, "opts.root is undefined — AC3-3 is not vacuously true");
});

test("AC3-5: the auto-load fuse still stops auto-fetching and degrades the sentinel to a button", async () => {
  const rowsPerPage = 500;
  const pagesNeeded = Math.ceil(GIT_GRAPH_AUTO_LOAD_ROW_LIMIT / rowsPerPage);
  const seed = [];
  for (let i = 0; i < rowsPerPage; i++) seed.push(commit("s" + i, 100000 - i, "seed " + i));
  const pages = [];
  for (let p = 0; p < pagesNeeded + 1; p++) {
    const rows = [];
    for (let i = 0; i < rowsPerPage; i++) rows.push(commit("p" + p + "-" + i, 99999 - (p * rowsPerPage + i), "older"));
    pages.push(page(rows));
  }
  pages.push(page([])); // terminal empty page, reached by the manual clicks
  const { sentinel, fetchCalls, ioCallbacks } = runClient({ pages, seedCommits: seed });

  ioCallbacks[0]([{ isIntersecting: true }]); // one auto trigger
  await flush();
  assert.equal(fetchCalls.length, pagesNeeded, `auto fetch stops at ${pagesNeeded} pages (the fuse trips, no more auto)`);
  assert.equal(sentinel.textContent, "点击加载更早提交", "the sentinel degraded to a manual button");
  assert.ok(sentinel.listeners.click && sentinel.listeners.click.length >= 1, "the sentinel is clickable");

  sentinel.listeners.click[0]();
  await flush();
  assert.equal(fetchCalls.length, pagesNeeded + 1, "one click loads one more page past the fuse");

  sentinel.listeners.click[0]();
  await flush();
  assert.equal(fetchCalls.length, pagesNeeded + 2, "clicking again loads the terminal empty page");
  assert.equal(sentinel.textContent, "已加载到仓库最早提交", "finishOlder() reached via the manual path");
});

// ── AC5: negative control — the stripped affordance fails AC1 and AC2 ───────────────────────────

test("AC5: negative control — removing the added border/fade makes AC1/AC2 fail", () => {
  const html = renderGitHistoryPage(okHistory([historyCommit("a", 1000, "base")]), "git");
  const stripped = stripVisualAffordance(html);
  assert.notEqual(stripped, html, "the negative control actually removed the affordance");
  // AC1 negative: the boundary predicate is now false (not-satisfied count > 0)
  assert.equal(boundarySatisfied(scrollContainerStyle(stripped)), false, "no boundary after stripping");
  // AC2 negative: no hint in the DOM → the hint-toggle predicate fails (not-satisfied count > 0)
  const run = runClient({ pages: [], seedCommits: [commit("c0", 1000, "base")], omitHint: true });
  assert.equal(hintToggling(run), false, "no hint → AC2 predicate cannot toggle");
});
