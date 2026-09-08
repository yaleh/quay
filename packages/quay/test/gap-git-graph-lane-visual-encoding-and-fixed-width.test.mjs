// @test-group product
// gap-git-graph-lane-visual-encoding-and-fixed-width — /git-history 的 lane 视觉编码：①全部 lane 共用
// 一个 .git-svg-grid class（对比度 1.13:1、无分支区分色、三条直线拼直角）；②SVG 宽度写死 720px 与
// 内容无关（37/98 条 subject 被右边界永久截断且滚不出来）。
//
// 修法（A–E 合成一条，Touches 全落在 serve-git.ts 同一个函数体）：
//   A. lane 描边按 slot 取 8 色分类色板（每色对画布 ≥3:1，白色 chip 文字对色板 ≥4.5:1）→ AC1/AC2。
//   B. 三条 <line> 合成一条圆角 <path>（q 段，半径 min(6, laneGap/2)）→ AC3。
//   C. 各 lane 最近节点右侧用反色 chip（背景=lane 色、文字=对比色）标注 ref → AC4。
//   D. width 由最长文本派生（服务端估算 + 客户端 getBBox 回写），不再写死 720px → AC5。
//
// Run (scoped): bash scripts/test.sh --for-task gap-git-graph-lane-visual-encoding-and-fixed-width
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  layoutGitGraph,
  computeGitGraphWidth,
  gitGraphClientScript,
  GIT_GRAPH_LANE_PALETTE,
  GIT_GRAPH_LANE_CHIP_TEXT,
  GIT_GRAPH_SURFACE_HEX,
  GIT_GRAPH_TEXT_X,
} from "../src/serve-handlers.ts";

/** WCAG 2.x relative-luminance + contrast ratio (same function AC1 runs against BOTH the old grid
 *  colour — must FAIL — and the new palette — must PASS). */
function srgbChannel(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

// ── AC1: contrast is computable — every lane colour ≥3:1 on the canvas, the old grid colour fails ──

test("AC1: every lane palette colour holds ≥3:1 on the canvas; the old grid colour must fail", () => {
  // Negative control (硬规则 4): run the SAME contrast function on the old .git-svg-grid stroke
  // (--color-neutral-200 / #eae7e7) on the canvas (--color-neutral-100 / #f8f4f4). It must measure
  // BELOW 3.0 — the exact invisible-axis defect this task removes (task-measured 1.13:1).
  const oldRatio = contrastRatio("#eae7e7", GIT_GRAPH_SURFACE_HEX);
  assert.ok(oldRatio < 3.0, `precondition: old grid colour must fail (< 3.0); got ${oldRatio.toFixed(2)}`);

  const failing = [];
  for (const color of GIT_GRAPH_LANE_PALETTE) {
    const ratio = contrastRatio(color, GIT_GRAPH_SURFACE_HEX);
    if (ratio < 3.0) failing.push(`${color} → ${ratio.toFixed(2)}`);
  }
  assert.equal(
    failing.length,
    0,
    `${failing.length} lane colour(s) fall below 3.0:1 on the canvas: ${failing.join(", ")}`,
  );
});

// ── AC2: branches distinguishable — categorical palette, injective slot→colour over concurrent lanes ─

test("AC2: categorical palette; per-lane colour yields ≥min(6, lane-count) distinct hues (not slot-recycled)", () => {
  const distinct = new Set(GIT_GRAPH_LANE_PALETTE);
  assert.ok(distinct.size >= 6, `palette has ${distinct.size} distinct hues (need ≥6)`);

  // Six CONCURRENT lanes (all forking from one trunk commit) — the "which line is which branch"
  // dimension is now encoded (before: 1 shared colour across every line).
  const t0 = 1_700_000_000;
  const commits = [c("t000000", t0, "develop", [], "base"), c("t100000", t0 + 1, "develop", ["t000000"], "trunk")];
  let prev = "t100000";
  const n = 6;
  for (let i = 0; i < n; i++) {
    const bi = `b${String(i).padStart(6, "0")}`;
    const mi = `m${String(i).padStart(6, "0")}`;
    commits.push(c(bi, t0 + 2, "develop", ["t100000"], `branch ${i}`));
    commits.push(c(mi, t0 + 3 + i, "develop", [prev, bi], `merge ${i}`));
    prev = mi;
  }
  const head = `m${String(n - 1).padStart(6, "0")}`;
  const layout = layoutGitGraph(hist(commits, head, { develop: head }));

  assert.equal(layout.branches.length, n, "six branch lanes");
  // Per-lane cycling: lane i carries palette[i % paletteSize], so six lanes → six distinct hues.
  const colors = new Set(layout.branches.map((_, i) => GIT_GRAPH_LANE_PALETTE[i % GIT_GRAPH_LANE_PALETTE.length]));
  assert.equal(colors.size, n, "six lanes carry six distinct stroke colours");
  assert.ok(colors.size >= Math.min(6, layout.branches.length), "distinct colours ≥ min(6, lane count)");

  // The client must colour by LANE index, not slot — slot reuse (interval scheduling) would collapse
  // the distinct-colour count to the number of concurrent slots (<6 on the live repo).
  const script = gitGraphClientScript();
  assert.ok(script.includes("i % lanePalette.length"), "client cycles the palette by lane index");
  assert.ok(!script.includes("laneColor(b.slot)"), "client must NOT colour by slot (slot reuse collapses hues)");
});

// ── AC102② mirror: lane colours are var(--color-lane-N) tokens, never hardcoded hex in the script ──

test("the client renderer script carries zero hardcoded hex (lane colours are tokens)", () => {
  const script = gitGraphClientScript();
  const hex = script.match(/#[0-9a-fA-F]{6}/g) || [];
  assert.deepEqual(hex, [], `renderer script must carry no hardcoded hex (got ${hex.length}: ${hex.join(", ")})`);
  assert.ok(script.includes("var(--color-lane-0)"), "lane palette entries are token references");
  assert.ok(script.includes("var(--color-lane-chip-text)"), "the chip label is a token reference");
});

// ── AC3: rounded corners are a structural fact — one <path>, no horizontal fork/merge <line> ────────

test("AC3: lane connectors are one rounded <path>; no independent horizontal <line> remains", () => {
  const script = gitGraphClientScript();
  assert.ok(script.includes('append("path")'), "lane connectors are <path> elements");
  assert.ok(script.includes("lanePath("), "the rounded-corner path builder is wired in");
  // The old renderer carried THREE straight <line>s per lane (vertical + fork + merge horizontal),
  // all on the shared .git-svg-grid class. That class is gone from the graph renderer — the only
  // <line> left is the vertical trunk spine (x1 == x2), so no fork/merge horizontal <line> survives.
  assert.ok(!script.includes("git-svg-grid"), "the shared .git-svg-grid line class is removed from the graph");
  assert.ok(script.includes("git-svg-trunk"), "the trunk spine keeps a (vertical) <line>");
  // A rounded turn is a quadratic-bezier (Q) segment — the path is structurally rounded, not two
  // straight segments meeting at a right angle (which is visually identical to two crossing lines).
  assert.ok(script.includes(" Q "), "the path uses quadratic-bezier (Q) rounded corners");
});

// ── AC4: branch-name chip — non-transparent bg, text == ref, text/bg contrast ≥4.5 ───────────────────

test("AC4: every lane gets a branch-name chip (non-transparent bg) with ≥4.5:1 text contrast", () => {
  // Contrast: the chip label (white) on every palette colour must hold ≥4.5:1 (WCAG AA for text).
  const failing = [];
  for (const color of GIT_GRAPH_LANE_PALETTE) {
    const ratio = contrastRatio(GIT_GRAPH_LANE_CHIP_TEXT, color);
    if (ratio < 4.5) failing.push(`${color} → ${ratio.toFixed(2)}`);
  }
  assert.equal(
    failing.length,
    0,
    `${failing.length} lane colour(s) fail ≥4.5:1 against the chip label: ${failing.join(", ")}`,
  );

  const script = gitGraphClientScript();
  // The chip is a <rect> with a non-transparent lane-colour fill + a label whose text IS the ref.
  assert.ok(script.includes("appendChip("), "the chip helper exists");
  assert.ok(script.includes(".text(ref)"), "the chip label text is the lane ref");
  assert.ok(script.includes('.style("fill", color)'), "the chip bg is filled with the lane colour (non-transparent)");
  // Both render states label the branch: collapsed (summary) and expanded (fold control).
  assert.ok(script.includes("appendChip(grp, textX, yy + 3, b.ref"), "collapsed summary leads with a chip(ref)");
  assert.ok(script.includes("appendChip(grp2, textX, y(laneBot) - 6, b.ref"), "expanded fold control leads with a chip(ref)");
});

// ── AC5: width is content-derived — different longest subjects → different widths, never a literal ───

test("AC5: width tracks the longest subject (two fixtures ≥200px apart yield different widths)", () => {
  const t0 = 1_700_000_000;
  const long = [c("t000000", t0, "develop", [], "base"), c("t100000", t0 + 1, "develop", ["t000000"], "x".repeat(60))];
  const short = [c("t000000", t0, "develop", [], "base"), c("t100000", t0 + 1, "develop", ["t000000"], "short")];
  const wLong = computeGitGraphWidth(layoutGitGraph(hist(long, "t100000", { develop: "t100000" })), GIT_GRAPH_TEXT_X);
  const wShort = computeGitGraphWidth(layoutGitGraph(hist(short, "t100000", { develop: "t100000" })), GIT_GRAPH_TEXT_X);
  assert.ok(
    wLong > wShort + 200,
    `width is content-derived (long=${wLong}px, short=${wShort}px; Δ must be ≥200px)`,
  );

  const script = gitGraphClientScript();
  assert.ok(script.includes("data.textWidth"), "client seeds width from the server content estimate");
  assert.ok(script.includes("getBBox"), "client re-measures text and widens the viewBox (no clipping)");
});

// ── smoke: the generated client script must be syntactically valid JS (compiles, not just string-ok) ─

test("the generated client script is syntactically valid JavaScript", () => {
  // vm.Script compiles (parses) the IIFE without executing it, so no d3/document mocks are needed.
  new vm.Script(gitGraphClientScript());
});
