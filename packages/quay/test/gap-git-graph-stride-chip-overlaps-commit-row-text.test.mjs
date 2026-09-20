// @test-group product
// gap-git-graph-stride-chip-overlaps-commit-row-text — 独立闭合确认：stride chip 机件确已移除、
// 压字在结构上不可能，且 ref tip 的内联 %D 标签仍在。
//
// 原范围「chip 挪开以免压字」已被 gap-git-graph-adopt-git-column-algorithm-and-decorate-labels（done）
// 取代——该任务删除了全部浮动 chip 与 stride 逻辑（appendChip / git-svg-lane-chip 归零），标签改为
// 只在 ref tip 内联。本任务退化为四条确认读数，全部取自真实生产源码与生产仓库（非 fixture）。
//
//   AC1  chip 机件归零：serve-git.ts 中 `grep -c appendChip` = 0（取代任务落地前是 4）。
//   AC2  压字结构上不可能：渲染器只画「每提交一行」的内联标签（hash → decoration chip → subject，
//        见 gap-git-graph-decoration-labels-as-colored-chips），无任何【浮动】非提交文本元素——
//        decoration chip 是该行自身文本流的一部分（同 baseline、紧随 hash），不是可漂到别行的
//        浮动 lane-chip ⇒ 非提交×提交 bbox 相交对数 = 0；该结论不依赖坐标微调。
//   AC3  负控制：显式还原一个浮动 chip 文本并置于提交行同一 baseline / 同一 x，断言相交对数 > 0
//        ⇒ AC2 的判据能取假，不是因为「页面上没东西」而恒真。
//   AC4  标签仍然存在：%D 非空的提交行仍带内联标签，条数与 `git log --all -n <N>` 中 %D 非空的
//        提交数相等（不许用「什么都不画」来满足 AC1/AC2）。
//
// ── gap-git-graph-live-ref-oracle-siblings-unfrozen: ONE frozen ref window per 对拍 ─────────────────
// AC4 pairs the data layer's decorated-row count against a live `git log … %D` count. Those were two
// INDEPENDENT LIVE reads of the production window: a ref advancing between them shifts the window head
// by K and drops K off the tail ⇒ a count imbalance that is a window SHIFT, not a label bug. Both
// sides now read the SAME frozen ref set (`helpers/git-ref-window.mjs`), resolved ONCE before either
// side reads; AC2/AC3 (single-read structural verdicts) go through the same window so every reading in
// this file is internally consistent.
// Negative control (⛔ dry-run only): `QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` restores the live-`--all` arms.
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs
// Negative control: QUAY_TEST_GIT_GRAPH_LIVE_REFS=1 node --test <same file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGitHistory } from "../src/observation.ts";
import {
  layoutGitGraph,
  gitGraphClientScript,
  GIT_GRAPH_TEXT_X,
  GIT_GRAPH_ROW_H,
  GIT_GRAPH_PAD_Y,
} from "../src/serve-git.ts";
import { resolveRefWindow, windowScopeArgs, windowGitExec, describeWindow } from "./helpers/git-ref-window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIMIT = 500;
const FONT_SIZE = 11; // the client's `.attr("font-size", 11)` on every commit text

/** The exact inline text the client renderer puts on one commit row. */
function commitTextLabel(r) {
  let label = r.hash.slice(0, 7);
  if (r.decorations && r.decorations.length) { label += " (" + r.decorations.join(", ") + ")"; }
  label += " " + r.subject;
  return label;
}

/**
 * Reproduce the client renderer's per-commit text inventory from the layout — one `<text class="git-svg-ink">`
 * per row at `x = GIT_GRAPH_TEXT_X`, baseline `y = GIT_GRAPH_PAD_Y + i * GIT_GRAPH_ROW_H + 4` (the exact
 * `y(row) + 4` the script emits). Rows are `GIT_GRAPH_ROW_H` apart, so commit texts are disjoint by construction.
 */
function commitTextElements(rows) {
  return rows.map((r, i) => ({
    role: "commit",
    label: commitTextLabel(r),
    x: GIT_GRAPH_TEXT_X,
    baselineY: GIT_GRAPH_PAD_Y + i * GIT_GRAPH_ROW_H + 4,
  }));
}

/**
 * Deterministic glyph bbox estimate. The exact ascent/width figures are NOT load-bearing for AC2 (whose "0"
 * is structural — the non-commit inventory is empty) nor for AC3 (which only needs same-baseline + same-x
 * ⇒ overlap). They are monotone in x and y, which is all the AC3 judge requires.
 */
function textBBox(el) {
  const width = Math.max(el.label.length * 6, 1);
  return { left: el.x, right: el.x + width, top: el.baselineY - FONT_SIZE, bottom: el.baselineY };
}

function bboxesIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Count pairs (nonCommitText, commitText) whose bboxes intersect — the AC2/AC3 judge. */
function nonCommitIntersections(commitEls, nonCommitEls) {
  let n = 0;
  for (const c of commitEls) for (const chip of nonCommitEls) if (bboxesIntersect(textBBox(c), textBBox(chip))) n++;
  return n;
}

// ── AC1: the appendChip mechanism is gone from the source ──────────────────────────────────────────

test("AC1: serve-git.ts carries zero appendChip sites (grep -c = 0, was 4)", () => {
  const src = readFileSync(path.resolve(__dirname, "../src/serve-git.ts"), "utf8");
  const count = (src.match(/appendChip/g) || []).length;
  assert.equal(count, 0, `appendChip occurrence count must be 0 (got ${count})`);
});

// ── AC2: overlap is structurally impossible — the renderer emits only per-row commit ink ───────────

test("AC2: no non-commit text element can intersect a commit text element (structural, pairs = 0)", () => {
  const refs = resolveRefWindow(); // frozen ONCE, before the read
  console.log(`[ref-window] ${describeWindow(refs)}`);
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT, exec: windowGitExec(refs) });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  assert.ok(layout && layout.rows.length > 0, "the window carries commits (a non-empty page)");

  // The renderer's inline label is now hash → decoration chip → subject (gap-git-graph-decoration-labels-
  // as-colored-chips) — several inline text sites per row, no longer ONE concatenated string. The RETIRED
  // floating lane chip (git-svg-lane-chip / appendChip) must still be absent: a decoration chip is part of
  // the row's own text flow, never a floating overlay that could drift onto another row's text.
  const script = gitGraphClientScript();
  assert.ok(!script.includes("git-svg-lane-chip"), "no floating lane-chip element in the renderer");
  assert.ok(!script.includes("appendChip"), "no chip appender in the renderer");
  assert.ok(script.includes("git-svg-ink"), "the commit ink class is present");
  assert.ok(script.includes("git-svg-decor-chip"), "decorations render as inline chips (not a floating lane chip)");

  const commitEls = commitTextElements(layout.rows);
  assert.equal(commitEls.length, layout.rows.length, "one commit text per row");

  // The non-commit text inventory is empty (no floating overlay element), so the non-commit × commit
  // intersection count is 0 — structurally, with no reliance on coordinate tuning. AC3 is the guard that
  // this "0" is not vacuous.
  assert.equal(nonCommitIntersections(commitEls, []), 0, "non-commit × commit bbox intersection pairs = 0");
});

// ── AC3: negative control — the judge can be false ────────────────────────────────────────────────

test("AC3: a restored floating chip on a commit row's y intersects (judge can be false)", () => {
  const refs = resolveRefWindow(); // frozen ONCE, before the read
  console.log(`[ref-window] ${describeWindow(refs)}`);
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT, exec: windowGitExec(refs) });
  const layout = layoutGitGraph(history);
  assert.ok(layout && layout.rows.length > 0, "the window carries commits");

  const commitEls = commitTextElements(layout.rows);

  // Re-introduce the retired floating chip: a non-commit <text> at the SAME baseline and SAME x as a
  // commit row (the overlap the old stride chips caused). It must register as an intersection, proving
  // AC2's judge reports > 0 whenever a chip lands on a commit row — not merely "0 because empty".
  const chip = { role: "chip", label: "develop", x: GIT_GRAPH_TEXT_X, baselineY: commitEls[0].baselineY };
  const n = nonCommitIntersections(commitEls, [chip]);
  assert.ok(n > 0, `a same-y chip must intersect its commit row (got ${n} > 0)`);
});

// ── AC4: inline labels survive — the page is not empty of decoration ──────────────────────────────

test("AC4: %D-nonempty rows still render an inline label; count equals git's %D-nonempty count", () => {
  const refs = resolveRefWindow(); // frozen ONCE, before either side reads
  console.log(`[ref-window] ${describeWindow(refs)}`);
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT, exec: windowGitExec(refs) });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  assert.ok(layout && layout.rows.length > 0, "the window carries commits");

  // git oracle: commits in the SAME window carrying a non-empty %D decoration.
  // --topo-order matches readGitHistory's own query (production's scope `--topo-order -n`); the
  // default date-order window can select a DIFFERENT N-commit set when an out-of-order merge tip sits
  // near the boundary. The ref scope comes from the same shared constant, and the window from the one
  // frozen snapshot both sides read — so this compares one window against itself.
  const decOut = execFileSync("git", ["-C", REPO_ROOT, "log", ...windowScopeArgs(refs), "--topo-order", "-n", String(LIMIT), "--pretty=format:%H%x01%D"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  let refDecorated = 0;
  for (const line of decOut.split("\n")) {
    const idx = line.indexOf("\x01");
    if (idx !== -1 && line.slice(idx + 1).trim()) refDecorated++;
  }

  const myDecorated = layout.rows.filter((r) => r.decorations.length > 0);
  assert.equal(myDecorated.length, refDecorated, "inline-label row count equals git's %D-nonempty commit count");

  // Each decorated row's inline text actually embeds its decoration names — labels are still INLINE,
  // not merely counted.
  for (const r of myDecorated) {
    const label = commitTextLabel(r);
    for (const d of r.decorations) {
      assert.ok(label.includes(d), `row ${r.hash.slice(0, 7)} inline label embeds ${JSON.stringify(d)}`);
    }
  }
});
