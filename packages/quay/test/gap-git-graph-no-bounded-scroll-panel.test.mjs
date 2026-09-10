// @test-group product
// gap-git-graph-no-bounded-scroll-panel — 提交纵向时间轴整页滚动触发无限加载：滚到底一次连锁加载两页，
// 页面高度从 12,383px 涨到 24,359px，导航/标题/说明全被卷走，且越滚越长永远看不到头。根因是 `#git-graph`
// 只是 `<main>` 里的普通块级 div（无真实纵向溢出，滚的是整份 `<html>`），且 IntersectionObserver 默认以
// viewport 为 root（判断的是「整页是否滚到底」而非「图表内部是否滚到底」）。修法（方案 A）：给 `#git-graph`
// 套一层固定高度 + overflow-y:auto 的容器（横向/纵向滚动共容一层），sentinel 挪进容器内部；IO 显式传
// root=container；客户端按头部实际高度动态算 max-height（resize 重算）；自动加载累计行数越过保险丝阈值后
// 停 IO 观察、把 sentinel 降级为可点击「加载更早提交」按钮。
//
//   AC1  容器结构：scroll 容器同时具备高度约束（内联 max-height 或客户端 style.maxHeight）与 overflow-y。
//   AC2  sentinel 归属：git-graph-sentinel 是 scroll 容器的子孙，不再是 <main> 下与 #git-graph 平级的兄弟。
//   AC3  IO root：vm 沙箱执行真实 gitGraphClientScript()，用记录参数的 IntersectionObserver 桩断言
//        opts.root 是具体元素（scroll 容器），不是 undefined。
//   AC4  负控制：同一沙箱把 opts.root 参数抹掉（模拟未修复实现），断言 root 变回 undefined ⇒ 判据能区分新旧。
//   AC5  保险丝：连续 mock 足量非空翻页使累计行数越过阈值，断言越过后不再自动 fetch、sentinel 变为可点击，
//        且此后点击仍能继续加载直至 finishOlder()。
//   AC6/AC7  生产实测（DoD 证据，Playwright/chrome-devtools，本文件不自动化）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-no-bounded-scroll-panel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gitGraphClientScript, renderGitHistoryPage, GIT_GRAPH_AUTO_LOAD_ROW_LIMIT } from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
 * AC4 negative control) in a fresh vm context. Records every IntersectionObserver construction's
 * (cb, opts) so the tests can assert the observed root; the sentinel records click listeners so AC5
 * can drive the manual path after the fuse trips.
 */
function runClient({ pages, seedCommits }, script = gitGraphClientScript()) {
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
    getBoundingClientRect: () => ({ top: 200, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  };
  const elements = {
    "git-graph": {},
    "git-graph-scroll": scrollEl,
    "git-graph-data": { textContent: JSON.stringify(layout) },
    "git-graph-sentinel": sentinel,
    "git-graph-coverage": { textContent: "" },
  };
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
  return { sentinel, scrollEl, elements, fetchCalls, ioCallbacks, observerRecords };
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

// ── AC1: the scroll container carries both a height constraint and overflow-y ───────────────────

test("AC1: the scroll container has a height constraint AND overflow-y:auto", () => {
  const html = renderGitHistoryPage(okHistory([historyCommit("a", 1000, "base")]), "git");
  const open = html.indexOf('<div id="git-graph-scroll"');
  assert.ok(open !== -1, "the scroll container exists in the rendered page");
  const styleStart = html.indexOf("style=", open);
  const styleStr = html.slice(styleStart, html.indexOf(">", styleStart));
  // (b) vertical overflow on the container
  assert.match(styleStr, /overflow-y:\s*(auto|scroll)/, "container has overflow-y:auto/scroll");
  // (a) height constraint — inline max-height, or the client runtime style.maxHeight (both present)
  assert.match(styleStr, /max-height:/, "container has an inline max-height fallback");
  assert.match(gitGraphClientScript(), /style\.maxHeight\s*=/, "client script sets style.maxHeight at runtime");
  // Plan step 6: horizontal + vertical overflow share the SAME container (not nested layers)
  assert.match(styleStr, /overflow-x:\s*auto/, "container also carries overflow-x:auto");
});

// ── AC2: the sentinel is a descendant of the scroll container, not a sibling of #git-graph ───────

test("AC2: git-graph-sentinel is inside the scroll container (not a sibling of #git-graph under <main>)", () => {
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

// ── AC3: IntersectionObserver is constructed with root = the scroll container element ────────────

test("AC3: IntersectionObserver opts.root is the scroll container element (not undefined)", () => {
  const { elements, observerRecords } = runClient({ pages: [], seedCommits: [commit("c0", 1000, "base")] });
  assert.equal(observerRecords.length, 1, "exactly one IntersectionObserver is constructed");
  const { opts } = observerRecords[0];
  assert.ok(opts && typeof opts === "object", "the observer received an options object");
  assert.notEqual(opts.root, undefined, "opts.root is not undefined (the old code always omitted it)");
  assert.equal(opts.root, elements["git-graph-scroll"], "opts.root is the concrete scroll container element");
});

// ── AC4: negative control — stripping the root arg reverts to undefined (criterion can be false) ──

test("AC4: without the root arg (pre-fix form), opts.root reverts to undefined", () => {
  const src = gitGraphClientScript();
  assert.match(src, /root:\s*scrollEl/, "the real script passes root: scrollEl");
  const stripped = src.replace("root: scrollEl, ", ""); // simulate the un-fixed implementation
  assert.notEqual(stripped, src, "the negative control actually removed the root key");
  const { observerRecords } = runClient({ pages: [], seedCommits: [commit("c0", 1000, "base")] }, stripped);
  assert.equal(observerRecords.length, 1, "an IntersectionObserver is constructed");
  assert.equal(observerRecords[0].opts.root, undefined, "opts.root is undefined — AC3's assertion is not vacuously true");
});

// ── AC5: the auto-load fuse stops auto-fetching and degrades the sentinel to a clickable button ──

test("AC5: past the fuse threshold, auto-load stops and the sentinel becomes a clickable button", async () => {
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
