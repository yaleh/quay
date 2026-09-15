// @test-group product
// gap-git-graph-decoration-labels-as-colored-chips — /git-history 的分支标签从「括号包裹纯文本」改为
// 按列色着色的胶囊 chip：独立拆分（每个 ref 一个 chip）、HEAD 单独高亮、远程追踪分支用幽灵描边样式
// 且不与同名本地分支混淆。
//
//   AC1  服务端 payload 携带远程名列表 remotes（逐项 = git remote 输出，不满足数 = 0）。
//   AC2  每个 decoration 渲染为独立 chip，chip 数 = 拆分后条目数（HEAD 单独计一个），窗口内 chip 总数 > 0。
//   AC3  chip 背景色 = 该行 laneColor(r.col)（不满足数 = 0）。
//   AC4  HEAD 独立拆分与高亮：存在文本严格 = HEAD 的 chip（带 --head class）与文本 = X 的 chip，
//        且不存在内容整体 = HEAD -> X 的单一 chip（不满足数 = 0）。
//   AC5  远程/本地区分不误判：fix/...（本地）无 --ghost class，origin/fix/...（远程）带 --ghost class。
//   AC6  行内顺序与不重叠：subjectX >= 最后 chip 右边界 + gap（全部 decorated 行成立）；相邻行 chip 纵向不重叠。
//   AC7  负控制：旧「整行一个 <text>」渲染 chip 数 = 0（AC2 判据能取假，不是恒真）。
//   AC8  既有测试不回归：decorations 数据层原样（只改渲染，不改数据）；HEAD -> X 仍是单个原始条目。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGitHistory, readGitRemotes } from "../src/observation.ts";
import {
  gitGraphClientScript,
  layoutGitGraph,
  renderGitHistoryPage,
  GIT_GRAPH_ROW_H,
  GIT_GRAPH_PAD_Y,
  GIT_GRAPH_CHIP_GAP,
  GIT_GRAPH_LANE_PALETTE,
} from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIMIT = 500;

// ── minimal DOM + d3 mocks to EXECUTE the emitted client IIFE and capture the rendered SVG ──────
// Same self-returning selection harness as the cross-column test — the REAL client code runs, no
// re-implementation of the geometry. getBBox returns a text-length-proportional width so chip geometry
// is exercised (not a fixed constant).

function makeEl(tag) {
  const el = { tag, attrs: {}, styles: {}, children: [], text: "" };
  el.getBBox = () => ({ x: 0, y: 0, width: Math.max((el.text || "").length * 6, 2), height: 12 });
  return el;
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

/** Execute the emitted client script against a payload { rows, remotes }; return the mount element tree. */
function executeScript(script, payload) {
  const mount = makeEl("div");
  const dataEl = { textContent: JSON.stringify(payload) };
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

function hasClassToken(el, token) {
  return typeof el.attrs.class === "string" && el.attrs.class.split(/\s+/).indexOf(token) !== -1;
}

function collectByClassToken(el, token, acc) {
  acc = acc || [];
  for (const c of el.children) {
    if (hasClassToken(c, token)) acc.push(c);
    collectByClassToken(c, token, acc);
  }
  return acc;
}

function collectByClassExact(el, cls, acc) {
  acc = acc || [];
  for (const c of el.children) {
    if (c.attrs && c.attrs.class === cls) acc.push(c);
    collectByClassExact(c, cls, acc);
  }
  return acc;
}

/** A chip's background rect (the `<rect>` child of the chip `<g>`). */
function chipRect(chip) {
  return chip.children.find((c) => c.tag === "rect") || null;
}

/** A chip's label (the `<text>` child's content). */
function chipText(chip) {
  const t = chip.children.find((c) => c.tag === "text");
  return t ? t.text : null;
}

/** Recover a chip's row index from its rect's vertical centre (y = padY + row * rowH). */
function chipRowIndex(chip) {
  const rect = chipRect(chip);
  const cy = Number(rect.attrs.y) + Number(rect.attrs.height) / 2;
  return Math.round((cy - GIT_GRAPH_PAD_Y) / GIT_GRAPH_ROW_H);
}

function productionHistory() {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  return history;
}

function productionPayload() {
  const layout = layoutGitGraph(productionHistory());
  assert.ok(layout && layout.rows.length > 0, "the window carries commits");
  return { rows: layout.rows, remotes: readGitRemotes(REPO_ROOT) };
}

function renderProduction() {
  const payload = productionPayload();
  const mount = executeScript(gitGraphClientScript(), payload);
  return { rows: payload.rows, remotes: payload.remotes, mount };
}

/** Extract + parse the embedded `#git-graph-data` JSON from a rendered page. */
function payloadFromHtml(html) {
  const m = html.match(/id="git-graph-data"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, "the page embeds the git-graph-data payload");
  return JSON.parse(m[1]);
}

/** The number of chips a row's decorations SHOULD render (HEAD -> X splits into 2). Mirrors the client. */
function expectedChipsForDecorations(decorations) {
  let n = 0;
  for (const d of decorations) {
    n += /^HEAD\s*->\s*(.+)$/.test(d) ? 2 : 1;
  }
  return n;
}

function expectedTotalChips(rows) {
  let n = 0;
  for (const r of rows) n += expectedChipsForDecorations(r.decorations);
  return n;
}

// ── AC1: server payload carries the remote list, item-for-item equal to `git remote` ───────────────

test("AC1: payload remotes equals `git remote` output (origin, vhs); mismatch = 0", () => {
  const realRemotes = readGitRemotes(REPO_ROOT);
  const oracle = execFileSync("git", ["-C", REPO_ROOT, "remote"], { encoding: "utf8" })
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  assert.ok(oracle.length > 0, "the repo has remotes to compare (non-degenerate)");
  assert.deepEqual(realRemotes, oracle, "readGitRemotes returns the real git remote output");

  const html = renderGitHistoryPage(productionHistory(), "git", realRemotes);
  const payload = payloadFromHtml(html);
  assert.ok(Array.isArray(payload.remotes), "the payload carries a remotes array");
  assert.deepEqual(payload.remotes, realRemotes, "payload remotes match git remote item-by-item (mismatch = 0)");
});

// ── AC2: each decoration renders as an independent chip; count = split entry count; total > 0 ───────

test("AC2: every decoration renders as an independent chip; count = split entry count; total > 0", () => {
  const { rows, mount } = renderProduction();
  const chips = collectByClassToken(mount, "git-svg-decor-chip");
  const expected = expectedTotalChips(rows);
  assert.ok(expected > 0, "the window has decoration entries (a non-degenerate judge)");
  assert.ok(chips.length > 0, "chips were rendered (non-degenerate)");
  assert.equal(chips.length, expected, `chip count = split entry count (got ${chips.length}, expected ${expected})`);
});

// ── AC3: every chip's background fill equals its row's laneColor(r.col) ────────────────────────────

test("AC3: every chip's background fill equals its row's laneColor(r.col); mismatch = 0", () => {
  const { rows, mount } = renderProduction();
  const chips = collectByClassToken(mount, "git-svg-decor-chip");
  assert.ok(chips.length > 0, "chips were rendered (non-degenerate)");
  let mismatch = 0;
  const samples = [];
  for (const chip of chips) {
    const rect = chipRect(chip);
    assert.ok(rect, "each chip carries a background rect");
    const i = chipRowIndex(chip);
    assert.ok(i >= 0 && i < rows.length, `chip row index ${i} is in-window`);
    const expected = "var(--color-lane-" + (rows[i].col % GIT_GRAPH_LANE_PALETTE.length) + ")";
    if (rect.styles.fill !== expected) {
      mismatch++;
      if (samples.length < 8) samples.push(`${rect.styles.fill} != ${expected}`);
    }
  }
  assert.equal(mismatch, 0, `every chip bg = its row's laneColor (got ${mismatch}${samples.length ? ": " + samples.join(", ") : ""})`);
});

// ── AC4: HEAD splits into a highlighted HEAD chip + a chip for X; no single HEAD -> X chip ──────────

test("AC4: HEAD splits into a --head chip (text HEAD) + a chip (text X); no single HEAD -> X chip", () => {
  const { rows, mount } = renderProduction();
  const chips = collectByClassToken(mount, "git-svg-decor-chip");
  const headRow = rows.find((r) => r.decorations.some((d) => /^HEAD\s*->\s*(.+)$/.test(d)));
  assert.ok(headRow, "the window has a HEAD -> X row (non-degenerate)");
  const dec = headRow.decorations.find((d) => /^HEAD\s*->\s*(.+)$/.test(d));
  const X = /^HEAD\s*->\s*(.+)$/.exec(dec)[1];

  const headChips = chips.filter((c) => chipText(c) === "HEAD");
  assert.ok(headChips.length >= 1, "a chip with text exactly HEAD exists");
  assert.ok(headChips.every((c) => hasClassToken(c, "git-svg-decor-chip--head")), "every HEAD chip carries --head");

  const xChips = chips.filter((c) => chipText(c) === X);
  assert.ok(xChips.length >= 1, `a chip with text exactly ${JSON.stringify(X)} exists`);

  const unsplit = chips.filter((c) => chipText(c) === dec);
  assert.equal(unsplit.length, 0, "no single chip carries the whole HEAD -> X text (mismatch = 0)");
});

// ── AC5: remote vs local not misclassified — fix/... is solid, origin/fix/... is ghost ─────────────

test("AC5: remote vs local not misclassified — fix/... solid, origin/fix/... ghost (no pollution)", () => {
  const remotes = readGitRemotes(REPO_ROOT);
  assert.ok(remotes.length > 0, "the repo has remotes (non-degenerate)");
  // The repo's real counterexample: a LOCAL branch with a slash, and its remote-tracking twin — rendered
  // side by side so the two classifications cannot pollute each other.
  const rows = [{
    hash: "a".repeat(40),
    t: 1000,
    subject: "goals: decoration chips",
    parents: 0,
    parentHashes: [],
    decorations: ["origin/fix/goal-card-id-flex-squeeze", "fix/goal-card-id-flex-squeeze"],
  }];
  const mount = executeScript(gitGraphClientScript(), { rows, remotes });
  const chips = collectByClassToken(mount, "git-svg-decor-chip");
  const remoteChip = chips.find((c) => chipText(c) === "origin/fix/goal-card-id-flex-squeeze");
  const localChip = chips.find((c) => chipText(c) === "fix/goal-card-id-flex-squeeze");
  assert.ok(remoteChip, "the remote-tracking chip rendered");
  assert.ok(localChip, "the local slash-branch chip rendered");
  assert.ok(hasClassToken(remoteChip, "git-svg-decor-chip--ghost"), "remote chip carries --ghost");
  assert.ok(!hasClassToken(localChip, "git-svg-decor-chip--ghost"), "local slash-branch chip does NOT carry --ghost (not polluted)");
});

// ── AC6: subject clears the last chip; adjacent-row chips never overlap vertically ─────────────────

test("AC6: subject starts clear of the last chip; adjacent-row chips do not overlap vertically", () => {
  const { rows, mount } = renderProduction();
  const chips = collectByClassToken(mount, "git-svg-decor-chip");
  const subjects = collectByClassToken(mount, "git-svg-subject");
  assert.ok(chips.length > 0 && subjects.length > 0, "chips and subject texts both exist (non-degenerate)");

  const byRow = new Map();
  for (const chip of chips) {
    const i = chipRowIndex(chip);
    if (!byRow.has(i)) byRow.set(i, []);
    byRow.get(i).push(chip);
  }
  const subjectXByRow = new Map();
  for (const s of subjects) {
    const cy = Number(s.attrs.y) - 4; // subject text baseline = cy + 4
    const i = Math.round((cy - GIT_GRAPH_PAD_Y) / GIT_GRAPH_ROW_H);
    subjectXByRow.set(i, Number(s.attrs.x));
  }

  // subject x >= last chip right edge + gap, for every decorated row.
  let badOrder = 0;
  for (const [i, rowChips] of byRow) {
    const subjectX = subjectXByRow.get(i);
    if (subjectX === undefined) continue;
    let lastRight = -Infinity;
    for (const chip of rowChips) {
      const rect = chipRect(chip);
      const right = Number(rect.attrs.x) + Number(rect.attrs.width);
      if (right > lastRight) lastRight = right;
    }
    if (subjectX < lastRight + GIT_GRAPH_CHIP_GAP) badOrder++;
  }
  assert.equal(badOrder, 0, `subject x >= last chip right + gap for every decorated row (got ${badOrder})`);

  // Vertical bboxes of adjacent rows' chips never overlap.
  let overlap = 0;
  for (const [i, rowChips] of byRow) {
    const nextChips = byRow.get(i + 1);
    if (!nextChips) continue;
    for (const a of rowChips) {
      const ra = chipRect(a);
      const aTop = Number(ra.attrs.y), aBot = aTop + Number(ra.attrs.height);
      for (const b of nextChips) {
        const rb = chipRect(b);
        const bTop = Number(rb.attrs.y), bBot = bTop + Number(rb.attrs.height);
        if (aTop < bBot && bTop < aBot) overlap++;
      }
    }
  }
  assert.equal(overlap, 0, `adjacent-row chips never overlap vertically (got ${overlap})`);
});

// ── AC7: negative control — the pre-change single-text rendering yields 0 chips ────────────────────

/** The pre-change renderer: hash (decorations) subject concatenated into ONE git-svg-ink <text>. */
function oldSingleTextScript() {
  return `(function () {
    var mount = document.getElementById("git-graph");
    var dataEl = document.getElementById("git-graph-data");
    if (!mount || !dataEl || typeof d3 === "undefined") { return; }
    var data = JSON.parse(dataEl.textContent);
    var g = d3.select(mount).append("svg");
    data.rows.forEach(function (r) {
      var label = r.hash.slice(0, 7);
      if (r.decorations && r.decorations.length) { label += " (" + r.decorations.join(", ") + ")"; }
      label += " " + r.subject;
      g.append("text").attr("class", "git-svg-ink").text(label);
    });
  })();`;
}

test("AC7: negative control — the pre-change single-text rendering yields 0 chips (judge can be false)", () => {
  const payload = productionPayload();
  const mount = executeScript(oldSingleTextScript(), payload);
  const chips = collectByClassToken(mount, "git-svg-decor-chip");
  assert.equal(chips.length, 0, "the old single-text rendering produces zero decoration chips");
  const inks = collectByClassExact(mount, "git-svg-ink");
  assert.ok(inks.length >= payload.rows.length, "the old script still renders commit ink (not an empty page)");
});

// ── AC8: the decorations DATA layer is unchanged (only rendering changed) ─────────────────────────

test("AC8: the decorations data layer is unchanged (adopt/serve-handlers assertions still hold)", () => {
  const layout = layoutGitGraph(productionHistory());
  assert.ok(layout.rows.length > 0, "rows exist");

  // The adopt test's AC3 data assertion: develop decorates exactly one row — still true, we only changed
  // RENDERING, not the decorations array.
  // `%D` renders the CHECKED-OUT branch's own decoration as the COMBINED `HEAD -> <name>` form, never a
  // separate bare `<name>` entry (parseDecorations keeps it as one raw string — AC4 below). A bare
  // `d === "develop"` match therefore under-counts whenever develop is the checked-out branch — the
  // fresh-`actions/checkout@v4` shape in CI, and any contributor with develop checked out. Both forms
  // name the develop label ⇒ still exactly one; the data-layer invariant is unchanged.
  const namesDevelop = (d) => d === "develop" || /^HEAD\s*->\s*develop$/.test(d);
  let developCount = 0;
  for (const r of layout.rows) for (const d of r.decorations) if (namesDevelop(d)) developCount++;
  assert.equal(developCount, 1, "develop label appears on exactly one commit (data layer unchanged)");

  // serve-handlers asserts on `row.decorations.includes(...)` — the array-of-strings shape must survive.
  for (const r of layout.rows) {
    assert.ok(Array.isArray(r.decorations), "row.decorations is an array");
    for (const d of r.decorations) assert.equal(typeof d, "string", "each decoration is a string");
  }

  // HEAD -> X remains ONE raw decoration entry (the %D shape); the HEAD split is the CLIENT renderer's
  // job, not a server-side data mutation (AC4 mechanism).
  const headRow = layout.rows.find((r) => r.decorations.some((d) => /^HEAD\s*->/.test(d)));
  assert.ok(headRow, "the window has a HEAD decoration row");
  assert.ok(headRow.decorations.some((d) => /^HEAD\s*->\s*.+/.test(d)), "HEAD -> X is one raw decoration entry (not pre-split)");
});
