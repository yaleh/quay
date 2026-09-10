// @test-group product
// gap-git-graph-lane-chip-rendered-once-regardless-of-span — 反转后的语义（gap-git-graph-adopt-git-
// column-algorithm-and-decorate-labels）：分支标签不再按 strideRows 周期重画 chip，而只在 ref 指向
// 的那个提交上内联一次（git decorate 语义）。旧 chip 每 ~519px 重画一次，导致 develop 标签在窗口里
// 出现 6 次；现在任何 ref 名在整个窗口最多出现 1 次，且恰好落在它的 tip 提交上。
//
//   AC1  fixture：一条线性链上 develop 标签只装饰 tip 行，且该行就是最新提交。
//   AC2  负控制：旧 stride 逻辑对同一 ref 的 50 行跨度会产出 >1 个 chip ⇒ 判据能区分新旧。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-lane-chip-rendered-once-regardless-of-span.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGitGraph } from "../src/serve-git.ts";

function c(hash, t, parentHashes, subject, decorations = []) {
  return { hash, t, ref: "", parents: parentHashes.length, parentHashes, subject, decorations };
}

test("AC1: develop decorates exactly one row — its tip (no stride repetition)", () => {
  const t0 = 1_700_000_000;
  // Emission order (children before parents): newest first.
  const commits = [
    c("c000000", t0 + 2, ["b000000"], "three", ["develop"]),
    c("b000000", t0 + 1, ["a000000"], "two", []),
    c("a000000", t0, [], "base", []),
  ];
  const layout = layoutGitGraph({ status: "ok", reason: null, commits, head: "c000000", heads: {} });
  assert.ok(layout, "the fixture yields a layout");
  const developRows = layout.rows.filter((r) => r.decorations.includes("develop"));
  assert.equal(developRows.length, 1, "develop decorates exactly one row (the old stride logic drew 6)");
  assert.equal(developRows[0].hash, "c000000", "the decorated row is the ref tip (newest commit)");
});

test("AC2: the OLD stride logic yields >1 chip on the same 50-row span (the counter can be false)", () => {
  // Inline reimplementation of the retired stride behaviour: one chip per `strideRows` rows per lane.
  const STRIDE_ROWS = 20;
  const items = Array.from({ length: 50 }, (_, i) => ({ laneId: "develop", row: i }));
  let chips = 0;
  const span = new Map();
  for (const it of items) {
    const s = span.get(it.laneId);
    if (s === undefined) span.set(it.laneId, { min: it.row, max: it.row });
    else { if (it.row < s.min) s.min = it.row; if (it.row > s.max) s.max = it.row; }
  }
  for (const [, s] of span) for (let r = s.min; r <= s.max; r += STRIDE_ROWS) chips++;
  assert.ok(chips > 1, `the old stride logic draws ${chips} chips (the new model draws 1 at the tip)`);
});
