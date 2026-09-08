// @test-group product
// gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead — /git-history 折叠控件画在分支
// 底部（合并行）⇒ 展开 25 提交后落到视口外；摘要行包围盒跨 450px 而中间无命中元素 ⇒ 行内点击死区。
//
// 五个修法（全部先测纯函数/客户端脚本体，再测路由）：
//   1. 折叠控件从 laneBot（合并行）改画到 laneTopRow[b.id]（分支顶端行）→ AC1/AC4。
//   2. 每泳道一个透明命中矩形 rect.git-svg-hit，宽度 ≥ textX − trunkX → AC2。
//   3. 负控制：显式渲染一版不含命中矩形 ⇒ 计数为 0 → AC3。
//   4. 折叠控件与同行主干文字 bbox 交集为空（顶端行是分支提交行，无主干文字）→ AC4。
//   5. /git 302 → /git-history（原 /git 404）→ AC5（见 serve-nav-inconsistent-routes.test.mjs）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  layoutGitGraph,
  computeGitGraphRows,
  computeGitGraphHitRects,
  gitGraphClientScript,
  renderGitHistoryPage,
  GIT_GRAPH_PAD_Y,
  GIT_GRAPH_ROW_H,
  GIT_GRAPH_TEXT_X,
  GIT_GRAPH_TRUNK_X,
} from "../src/serve-handlers.ts";

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

// Two merged branches: A (2 commits, fork t100000) + B (3 commits, fork t200000). The merge rows
// (mA00000 / mB00000) are trunk commits — the exact place the old fold control overlapped trunk text.
const T0 = 1_700_000_000;
const FIXTURE = [
  c("t000000", T0, "develop", [], "base"),
  c("t100000", T0 + 1, "develop", ["t000000"], "trunk1"),
  c("a100000", T0 + 2, "task/A", ["t100000"], "a1"),
  c("t200000", T0 + 3, "develop", ["t100000"], "trunk2"),
  c("b100000", T0 + 4, "task/B", ["t200000"], "b1"),
  c("a200000", T0 + 5, "task/A", ["a100000"], "a2"),
  c("b200000", T0 + 6, "task/B", ["b100000"], "b2"),
  c("mA00000", T0 + 7, "develop", ["t200000", "a200000"], "merge A"),
  c("b300000", T0 + 8, "task/B", ["b200000"], "b3"),
  c("mB00000", T0 + 9, "develop", ["mA00000", "b300000"], "merge B"),
];
const HEAD = "mB00000";

function fixtureLayout() {
  const layout = layoutGitGraph(hist(FIXTURE, HEAD, { develop: HEAD }));
  assert.ok(layout, "fixture yields a layout");
  assert.equal(layout.branches.length, 2, "precondition: two branch lanes");
  return layout;
}

/** The longest branch (B, 3 commits) — a multi-commit lane whose top/bottom rows are distinct. */
function longestBranch(layout) {
  return layout.branches.reduce((m, b) => (b.commits.length > m.commits.length ? b : m));
}

// ── AC1: the fold control lands on the branch's TOP row, within ±8px (not the bottom merge row) ───

test("AC1: the fold control y sits within ±8px of the branch's top-row y, far from the bottom", () => {
  const layout = fixtureLayout();
  const branch = longestBranch(layout);
  assert.ok(branch.commits.length >= 2, "precondition: multi-commit branch");
  const expanded = new Set([branch.id]);
  const rows = computeGitGraphRows(layout, expanded);
  const branchRows = rows.filter((r) => r.laneId === branch.id).map((r) => r.row);
  const topRow = Math.min(...branchRows);
  const botRow = Math.max(...branchRows);
  assert.ok(botRow - topRow >= 1, "the branch spans ≥2 rows (top vs bottom placement is distinguishable)");

  const laneTopY = GIT_GRAPH_PAD_Y + topRow * GIT_GRAPH_ROW_H;
  const laneBotY = GIT_GRAPH_PAD_Y + botRow * GIT_GRAPH_ROW_H;

  const script = gitGraphClientScript();
  assert.ok(script.includes("var foldRow = laneTopRow[b.id]"), "the fold control anchors on laneTopRow (top row)");
  assert.ok(script.includes("y(foldRow) - 6"), "fold control y = y(foldRow) - 6 (a small baseline offset)");
  assert.ok(!script.includes("y(laneBot) - 6"), "fold control no longer sits at the bottom merge row");

  // AC1 bound: y(foldRow) - 6 = laneTopY - 6 — within [laneTopY-8, laneTopY+8] …
  const foldY = laneTopY - 6;
  assert.ok(Math.abs(foldY - laneTopY) <= 8, `fold control y=${foldY} is within ±8px of laneTopY=${laneTopY}`);
  // … and FAR from the bottom-row y (the old off-screen position).
  assert.ok(Math.abs(foldY - laneBotY) > 8, `fold control y=${foldY} is not near the bottom y=${laneBotY}`);
});

// ── AC2: one transparent hit rect per lane, each width ≥ (textX − trunkX) ─────────────────────────

test("AC2: hit rect count == lane count, and every rect spans ≥ (textX − trunkX)", () => {
  const layout = fixtureLayout();
  const rects = computeGitGraphHitRects(layout, new Set(), GIT_GRAPH_TEXT_X);
  assert.equal(rects.length, layout.branches.length, "one hit rect per lane");
  for (const r of rects) {
    assert.ok(
      r.width >= GIT_GRAPH_TEXT_X - GIT_GRAPH_TRUNK_X,
      `hit rect width ${r.width} >= textX−trunkX=${GIT_GRAPH_TEXT_X - GIT_GRAPH_TRUNK_X}`,
    );
  }
  // The client structurally emits the same per-branch rect (mirrors the pure function).
  const script = gitGraphClientScript();
  assert.ok(script.includes('attr("class", "git-svg-hit")'), "client emits .git-svg-hit rects");
  assert.ok(script.includes("finalWidth - trunkX"), "hit rect width spans trunkX → the graph's right edge");
});

// ── AC3 (negative control): the counter can take 0 — disabling hit rects yields zero ──────────────

test("AC3: rendering a version WITHOUT hit rects yields a count of 0 (判据能取假)", () => {
  const layout = fixtureLayout();
  assert.ok(layout.branches.length >= 2, "precondition: the layout HAS lanes");
  const withRects = computeGitGraphHitRects(layout, new Set(), GIT_GRAPH_TEXT_X);
  assert.ok(withRects.length >= 2, "precondition: hit rects enabled produces > 0 rects");
  const withoutRects = computeGitGraphHitRects(layout, new Set(), GIT_GRAPH_TEXT_X, { includeHitRects: false });
  assert.equal(withoutRects.length, 0, "rendering without hit rects → count 0 (the counter is not hardcoded)");
});

// ── AC4: the fold control's row carries no trunk text (bbox intersection with 主干文字 is empty) ───

test("AC4: the fold control sits on a branch row (no trunk text); the old merge row is a trunk row", () => {
  const layout = fixtureLayout();
  const branch = longestBranch(layout);
  const expanded = new Set([branch.id]);
  const rows = computeGitGraphRows(layout, expanded);
  const branchRows = rows.filter((r) => r.laneId === branch.id).map((r) => r.row);
  const topRow = Math.min(...branchRows);
  const trunkRows = new Set(rows.filter((r) => r.laneId === null).map((r) => r.row));

  // The fold control row (topRow) has no trunk commit/text → the two bboxes cannot intersect.
  assert.ok(!trunkRows.has(topRow), "the fold control's row carries no trunk text (bbox intersection empty)");

  // The OLD position — the branch's merge row — IS a trunk commit row (the branch merges into the
  // trunk there), which is exactly where the trunk text lived and the old fold control overlapped it.
  const mergeRow = rows.find((r) => r.kind === "commit" && r.laneId === null && r.hash === branch.merge)?.row;
  assert.ok(mergeRow !== undefined && trunkRows.has(mergeRow), "the merge row is a trunk commit row (where trunk text lives)");
  assert.notEqual(mergeRow, topRow, "the fold control moved off the merge row onto the branch's top row");
});

// ── fit-width: the mobile「适应宽度」toggle is wired into the page and the client ──────────────────

test("fit-width: the page emits the 适应宽度 toggle and the client reads it", () => {
  const html = renderGitHistoryPage(hist(FIXTURE, HEAD, { develop: HEAD }));
  assert.ok(html.includes('id="git-graph-fit-width"'), "the page emits the 适应宽度 checkbox");
  assert.ok(html.includes("适应宽度"), "the toggle is labelled 适应宽度");
  const script = gitGraphClientScript();
  assert.ok(script.includes('getElementById("git-graph-fit-width")'), "the client reads the fit-width toggle");
  assert.ok(script.includes("fitWidth"), "the renderer branches on the fit-width state");
  assert.ok(script.includes("fitWidth ? c.hash.slice(0, 7)"), "fit-width hides the commit subject (short hash only)");
});

// ── smoke: the generated client script must be syntactically valid JS ─────────────────────────────

test("the generated client script is syntactically valid JavaScript", () => {
  new vm.Script(gitGraphClientScript());
});
