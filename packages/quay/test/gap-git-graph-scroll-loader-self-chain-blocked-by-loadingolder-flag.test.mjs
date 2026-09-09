// @test-group product
// gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag — 滚动加载的自链调用写在
// .then() 里而 loadingOlder 复位在 .finally()；Promise 的 .then() 早于 .finally() 执行 ⇒ 自链
// 被函数开头的 if (loadingOlder) return 挡掉、成死代码。实测停在底部连续滚 4 次行数不变，滚离
// 再滚回才各翻一页。修法：把 loadingOlder = false 复位移到 .then() 内、自链调用之前（并删掉
// 恒在自链之后执行的 .finally 复位），保留 olderDone 作为唯一终止信号。
//
//   AC1  执行真实客户端脚本（mock fetch + 恒可见 sentinel），一次 loadOlder() 触发 ≥2 次请求。
//   AC2  负控制：内联重建旧写法（复位在 .finally、自链在 .then），请求数回落到 1 ⇒ 判据能区分新旧。
//   AC3  结构判据：源文件里每一处 loadingOlder = false 的行号都小于自链 loadOlder() 调用点行号。
//   AC4  终止条件：空 rows 响应 ⇒ finishOlder() 被调、sentinel 文案变「已加载到仓库最早提交」、
//        且不再发起后续请求（无无限循环）。
//   AC5  Playwright 生产实测（DoD 证据，非本文件自动化断言——本仓库无 headless-browser 依赖）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitGraphClientScript } from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A minimal row (the shape the client renderer reads: hash/t/subject/parents/col/decorations/edges). */
function commit(hash, t, subject) {
  return { hash, t, ref: "", parents: 0, parentHashes: [], subject, col: 0, decorations: [], edges: [] };
}

/** A minimal ok GitGraphLayout JSON page for /git-history.json?before=…&limit=… (the loadOlder shape). */
function page(rows) {
  return { status: "ok", reason: null, rows };
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

/** Execute gitGraphClientScript() in a fresh vm context; returns the state the tests assert on. */
function runClient({ pages, seedCommits }) {
  const layout = { status: "ok", reason: null, rows: seedCommits, commitCount: seedCommits.length };
  const sentinel = {
    textContent: "",
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    addEventListener() {},
  };
  const elements = {
    "git-graph": {},
    "git-graph-data": { textContent: JSON.stringify(layout) },
    "git-graph-sentinel": sentinel,
    "git-graph-coverage": { textContent: "" },
  };
  const fetchCalls = [];
  const queue = pages.slice();
  const ioCallbacks = [];
  class IntersectionObserver {
    constructor(cb) { ioCallbacks.push(cb); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const sandbox = {
    document: { getElementById: (id) => (id in elements ? elements[id] : null) },
    window: { innerHeight: 1000, scrollBy() {} },
    d3: { select: () => makeSel() },
    IntersectionObserver,
    fetch(url) {
      fetchCalls.push(url);
      const p = queue.length ? queue.shift() : page([]);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(p) });
    },
  };
  new vm.Script(gitGraphClientScript()).runInNewContext(sandbox);
  return { sentinel, fetchCalls, ioCallbacks };
}

/** Drain the microtask queue (each self-chain page is one Promise.resolve hop). */
async function flush() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
}

// ── AC1: one loadOlder() trigger chains ≥2 requests while the sentinel stays visible ────────────

test("AC1: a single loadOlder() trigger chains ≥2 requests when the sentinel stays in view", async () => {
  const seed = [commit("c0", 1000, "base")];
  const pages = [
    page([commit("p2", 999, "older2"), commit("p1", 998, "older1")]),
    page([commit("p3", 997, "older3")]),
    page([]),
  ];
  const { fetchCalls, ioCallbacks } = runClient({ pages, seedCommits: seed });
  assert.equal(ioCallbacks.length, 1, "the client armed an IntersectionObserver");
  ioCallbacks[0]([{ isIntersecting: true }]);
  await flush();
  assert.ok(fetchCalls.length >= 2, `one trigger chains ${fetchCalls.length} requests (the bug stops at 1)`);
  const cursors = fetchCalls.map((u) => Number(u.split("before=")[1].split("&")[0]));
  for (let i = 1; i < cursors.length; i++) {
    assert.ok(cursors[i] < cursors[i - 1], `the before cursor walks back: ${cursors[i - 1]} -> ${cursors[i]}`);
  }
});

// ── AC2: negative control — the OLD ordering makes exactly 1 request ────────────────────────────

test("AC2: the OLD ordering (reset in .finally, self-chain in .then) makes exactly 1 request", async () => {
  // Inline reimplementation of the bug (never imported), so AC1's ≥2 criterion can be false.
  let fetchCount = 0;
  let loadingOlder = false;
  let olderDone = false;
  function loadOlder() {
    if (loadingOlder || olderDone) { return; }
    loadingOlder = true;
    fetchCount += 1;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(page([commit("p1", 999, "older")])) })
      .then(function (res) {
        return res.json().then(function (next) {
          if (!next || next.status !== "ok" || !next.rows || !next.rows.length) { olderDone = true; return; }
          loadOlder(); // self-chain INSIDE .then() — loadingOlder is still true here, so it dead-returns
        });
      })
      .finally(function () { loadingOlder = false; }); // reset AFTER .then() has already run
  }
  loadOlder();
  await flush();
  assert.equal(fetchCount, 1, "the old ordering stops after one page (self-chain is dead code)");
});

// ── AC3: structural — every loadingOlder reset precedes the self-chain call site ────────────────

test("AC3: every loadingOlder = false reset line precedes the self-chain loadOlder() call site", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/serve-git.ts"), "utf8");
  const lines = src.split("\n");
  const resetLines = [];
  lines.forEach((l, i) => { if (l.includes("loadingOlder = false")) { resetLines.push(i + 1); } });
  assert.ok(resetLines.length >= 1, "at least one loadingOlder = false reset exists");
  const selfChain = lines.findIndex((l) => l.includes("window.innerHeight + 600) { loadOlder(); }")) + 1;
  assert.ok(selfChain > 0, "the self-chain call site is present in the source");
  assert.ok(
    Math.max(...resetLines) < selfChain,
    `reset line(s) ${resetLines} must all precede the self-chain call at line ${selfChain} (a .finally() reset would land after it)`,
  );
});

// ── AC4: termination — an empty page calls finishOlder() and stops the chain ────────────────────

test("AC4: an empty page calls finishOlder() and stops the chain (no infinite loop)", async () => {
  const { sentinel, fetchCalls, ioCallbacks } = runClient({
    pages: [page([])],
    seedCommits: [commit("c0", 1000, "base")],
  });
  ioCallbacks[0]([{ isIntersecting: true }]);
  await flush();
  assert.equal(fetchCalls.length, 1, "exactly one request — the chain does not loop forever");
  assert.equal(sentinel.textContent, "已加载到仓库最早提交", "finishOlder() updated the sentinel copy");
});
