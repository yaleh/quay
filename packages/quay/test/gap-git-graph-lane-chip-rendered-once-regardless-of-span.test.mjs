// @test-group product
// gap-git-graph-lane-chip-rendered-once-regardless-of-span — /git-history 每条泳道（含 mainline/trunk）
// 的分支名 chip 只画一次：mainline 画在页面绝对顶端（tMin），展开泳道画在折叠控件那一行（laneTop），
// 于是滚动到非页首任意位置时屏幕上找不到任何分支标签（与「develop 标签和其它分支不一样」同机制，且非
// develop 独有）。修法：加纯函数 computeChipStride —— 同一泳道 id 的行跨度内，起始行必画 chip，此后每
// 满 strideRows 行再画一次；mainline 与侧支泳道共用同一条调用路径（不再有 trunk 专属 chip 调用点）。
//
//   AC1  computeChipStride 对 50 行单泳道 fixture、strideRows=20 返回 3 个 chip 行（0/20/40），不是 1。
//   AC2  负控制：旧逻辑（每泳道只在首行/末行画一次）对同一 fixture 返回 1 ⇒ 判据能区分新旧。
//   AC3  生产读数：readGitHistory(仓库) → layoutGitGraph → computeGitGraphRows → computeChipStride，
//        mainline（develop）对应的 chip 行数 > 1（当前生产值为 1）。
//   AC4  相邻 chip 行行号之差 ≤ strideRows，且 strideRows × ROW_H < 700px（保守视口高度常量）。
//   AC5  chip 渲染路径统一：serve-git.ts 源码不再有 `appendChip(g, trunkX` 调用点。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-lane-chip-rendered-once-regardless-of-span.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  computeChipStride,
  layoutGitGraph,
  computeGitGraphRows,
  gitGraphClientScript,
  mainlineLane,
  GIT_GRAPH_CHIP_STRIDE_ROWS,
  GIT_GRAPH_ROW_H,
} from "../src/serve-git.ts";
import { readGitHistory } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ── AC1 fixture: 50 rows, all belonging to ONE lane id (the shape a tall lane produces) ────────────────

function fiftyRowFixture() {
  const items = [];
  for (let i = 0; i < 50; i++) items.push({ laneId: "L", row: i });
  return items;
}

// ── AC2 negative control: the OLD "one chip per lane" logic, implemented INLINE (deliberately NOT
// imported) so the criterion can be false — it must yield exactly 1 chip on the same fixture. ─────────

function oldOncePerLaneChipCount(items) {
  // Old behaviour: the mainline drew ONE chip at tMin (page top) and an expanded lane drew ONE chip
  // at its fold row (laneTop) — exactly one chip per distinct lane id, regardless of its row span.
  const lanes = new Set(items.map((it) => it.laneId));
  return lanes.size;
}

// ── AC1: computeChipStride returns the stride boundaries (0/20/40), not a single chip ─────────────────

test("AC1: computeChipStride on a 50-row single-lane fixture (strideRows=20) returns 3 chip rows (0,20,40)", () => {
  const chips = computeChipStride(fiftyRowFixture(), GIT_GRAPH_CHIP_STRIDE_ROWS);
  assert.equal(chips.length, 3, "3 chip rows, not 1");
  assert.deepEqual(chips.map((c) => c.row), [0, 20, 40], "chip rows are the stride boundaries 0/20/40");
});

// ── AC2: negative control — the OLD once-per-lane logic yields 1 chip on the same fixture ──────────────

test("AC2: the OLD once-per-lane logic yields 1 chip on the same fixture (the counter can be false)", () => {
  const fx = fiftyRowFixture();
  const oldCount = oldOncePerLaneChipCount(fx);
  assert.equal(oldCount, 1, "the old logic draws exactly one chip per lane (span is ignored)");
  const newCount = computeChipStride(fx, GIT_GRAPH_CHIP_STRIDE_ROWS).length;
  assert.equal(newCount, 3, "the new stride logic draws 3 — the criterion distinguishes old from new");
});

// ── AC3: production reading — the mainline (develop) lane renders more than one chip ───────────────────

test("AC3: production reading — the mainline (develop) chip count is > 1", () => {
  // The /git-history route serves readGitHistory(workspaceRoot) → layoutGitGraph (the same data the
  // client renders), so this git-level reading is the exact production input. The mainline is always
  // expanded (its commits are the spine), so its chip count is independent of lateral expansion state.
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const mainline = mainlineLane(layout);
  const rows = computeGitGraphRows(layout, new Set()); // default: lateral lanes collapsed, mainline expanded
  const commitRows = rows.filter((r) => r.kind === "commit"); // exclude collapsed summary rows
  const mainlineChips = computeChipStride(commitRows, GIT_GRAPH_CHIP_STRIDE_ROWS).filter((c) => c.laneId === null);
  assert.ok(mainlineChips.length > 1, `mainline (${mainline.ref}) renders ${mainlineChips.length} chips (> 1, the old value was 1)`);
});

// ── AC4: adjacent chip rows differ by ≤ strideRows, and strideRows × ROW_H < a 700px viewport ──────────

test("AC4: adjacent chip rows differ by <= strideRows, and strideRows * ROW_H < 700px", () => {
  assert.ok(
    GIT_GRAPH_CHIP_STRIDE_ROWS * GIT_GRAPH_ROW_H < 700,
    `strideRows (${GIT_GRAPH_CHIP_STRIDE_ROWS}) × ROW_H (${GIT_GRAPH_ROW_H}) = ${GIT_GRAPH_CHIP_STRIDE_ROWS * GIT_GRAPH_ROW_H}px < 700px`,
  );
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const commitRows = computeGitGraphRows(layout, new Set()).filter((r) => r.kind === "commit");
  const chips = computeChipStride(commitRows, GIT_GRAPH_CHIP_STRIDE_ROWS);
  const byLane = new Map();
  for (const c of chips) {
    if (!byLane.has(c.laneId)) byLane.set(c.laneId, []);
    byLane.get(c.laneId).push(c.row);
  }
  assert.ok(byLane.size > 0, "there is at least one lane to check");
  for (const [laneId, chipRows] of byLane) {
    chipRows.sort((a, b) => a - b);
    for (let i = 1; i < chipRows.length; i++) {
      assert.ok(
        chipRows[i] - chipRows[i - 1] <= GIT_GRAPH_CHIP_STRIDE_ROWS,
        `lane ${String(laneId)} adjacent chip rows ${chipRows[i - 1]} → ${chipRows[i]} differ by ≤ strideRows`,
      );
    }
  }
});

// ── AC5: chip rendering unified — no trunk-specific appendChip call site remains in the source ─────────

test("AC5: serve-git.ts carries no trunk-specific appendChip(g, trunkX call site", () => {
  const src = readFileSync(path.resolve(__dirname, "../src/serve-git.ts"), "utf8");
  assert.ok(!src.includes("appendChip(g, trunkX"), "no `appendChip(g, trunkX` remains in serve-git.ts");
});

// ── smoke: the generated client script parses and inlines the SAME computeChipStride + stride ──────────

test("the generated client script parses and inlines the shared computeChipStride", () => {
  const script = gitGraphClientScript();
  new Function(script); // the renderer is a self-contained IIFE — it must parse as valid JS
  assert.ok(script.includes("function computeChipStride"), "the client inlines the same computeChipStride");
  assert.ok(script.includes("strideRows = 20"), "the client carries the production strideRows constant");
  assert.ok(!script.includes("appendChip(g, trunkX"), "the client has no trunk-anchored chip call");
});
