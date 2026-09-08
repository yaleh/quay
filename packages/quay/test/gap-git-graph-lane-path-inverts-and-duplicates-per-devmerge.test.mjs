// @test-group product
// gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge — /git-history 折叠摘要行按 mergeT 排序
// 与自己的合并行同刻、tie-break 靠字典序 ⇒ 10/29 条泳道 botY<topY 倒着画、圆角退化成 Q x,y x,y；同一
// task 的每次 dev-merge 各算一次 fork/merge ⇒ 裂成 4 条同名泳道。
//
// 修法：
//   1. 摘要行排序钉在 commit 之前（kind 序 summary<commit，同一 t 内）⇒ mergeRow > laneTopRow → AC1/AC2。
//   2. lanePath 对 botY<=topY fail-closed（返回 null，不与合法路径同形）→ AC1。
//   3. 同 ref 的多次 dev-merge 聚合成一条泳道 → AC4。
//   4. fork==null 的泳道带「窗口外分叉」显式记号 → AC5。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  layoutGitGraph,
  computeGitGraphRows,
  buildLanePath,
  gitGraphClientScript,
} from "../src/serve-handlers.ts";
import { readGitHistory } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

const T0 = 1_700_000_000;

// ── FIXTURE A: one fork!=null lane + one fork==null lane (the inversion shape) ──────────────────────
// Lane A forks from t100000 and merges at m100000. Lane B's fork is OUTSIDE the window (its first
// commit's parent is not in `commits`), so B has fork==null and its summary row is the lane's top.
function invertedFixture() {
  const commits = [
    c("t000000", T0, "develop", [], "base"),
    c("t100000", T0 + 1, "develop", ["t000000"], "trunk1"),
    c("x100000", T0 + 2, "develop", ["t100000"], "x-work"),
    c("d100000", T0 + 3, "develop", ["t100000"], "dev-side"),
    c("m100000", T0 + 4, "develop", ["x100000", "d100000"], "Merge branch 'develop' into task/gap-a"),
    c("z200000", T0 + 5, "develop", ["outside0"], "z-work"),
    c("m200000", T0 + 6, "develop", ["m100000", "z200000"], "Merge branch 'develop' into task/gap-b"),
  ];
  return { commits, head: "m200000", heads: { develop: "m200000" } };
}

// ── FIXTURE B: task/gap-agg-test dev-merged three times (the split shape) ───────────────────────────
function aggFixture() {
  const commits = [
    c("t000000", T0, "develop", [], "base"),
    c("t100000", T0 + 1, "develop", ["t000000"], "trunk1"),
    c("x100000", T0 + 2, "develop", ["t100000"], "x-work1"),
    c("d100000", T0 + 3, "develop", ["t100000"], "dev-side-1"),
    c("m100000", T0 + 4, "develop", ["x100000", "d100000"], "Merge branch 'develop' into task/gap-agg-test"),
    c("x200000", T0 + 5, "develop", ["m100000"], "x-work2"),
    c("d200000", T0 + 6, "develop", ["d100000"], "dev-side-2"),
    c("m200000", T0 + 7, "develop", ["x200000", "d200000"], "Merge branch 'develop' into task/gap-agg-test"),
    c("x300000", T0 + 8, "develop", ["m200000"], "x-work3"),
    c("d300000", T0 + 9, "develop", ["d200000"], "dev-side-3"),
    c("m300000", T0 + 10, "develop", ["x300000", "d300000"], "Merge branch 'develop' into task/gap-agg-test"),
  ];
  return { commits, head: "m300000", heads: { develop: "m300000" } };
}

// ── Row/geometry helpers (mirror the client renderer's per-lane path inputs) ─────────────────────────

/** The per-lane path inputs the client passes to lanePath, derived from the fixed row model. */
function lanePathInputs(layout, expanded = new Set()) {
  const rows = computeGitGraphRows(layout, expanded);
  const trunkRow = {};
  for (const r of rows) if (r.kind === "commit" && r.laneId === null) trunkRow[r.hash] = r.row;
  const laneTopRow = {};
  const laneBotRow = {};
  for (const r of rows) {
    if (r.laneId === null) continue;
    if (laneTopRow[r.laneId] === undefined) laneTopRow[r.laneId] = r.row;
    laneTopRow[r.laneId] = Math.min(laneTopRow[r.laneId], r.row);
    if (laneBotRow[r.laneId] === undefined) laneBotRow[r.laneId] = r.row;
    laneBotRow[r.laneId] = Math.max(laneBotRow[r.laneId], r.row);
  }
  return layout.branches.map((b) => {
    const forkRow = b.fork ? trunkRow[b.fork] : null;
    const mergeRow = b.merge ? trunkRow[b.merge] : null;
    const laneTop = forkRow != null ? forkRow : laneTopRow[b.id];
    const laneBot = mergeRow != null ? mergeRow : laneBotRow[b.id];
    return { b, forkRow, mergeRow, laneTop, laneBot };
  });
}

/** The OLD row sort (summary t = b.mergeT, tie = b.id; no kind pinning) — the AC2 negative control. */
function oldRows(layout, expanded = new Set()) {
  const items = [];
  for (const c of layout.trunk.commits) items.push({ kind: "commit", hash: c.hash, laneId: null, t: c.t, tie: c.hash });
  for (const b of layout.branches) {
    if (expanded.has(b.id)) {
      for (const c of b.commits) items.push({ kind: "commit", hash: c.hash, laneId: b.id, t: c.t, tie: c.hash });
    } else {
      items.push({ kind: "summary", hash: null, laneId: b.id, t: b.mergeT ?? b.lastT, tie: b.id });
    }
  }
  items.sort((a, b) => a.t - b.t || (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0));
  return items.map((it, row) => ({ ...it, row }));
}

/** Count merged lanes whose summary row sorts at-or-below their merge row (an inverted lane). */
function invertedLaneCount(rowsFn, layout, expanded = new Set()) {
  const rows = rowsFn(layout, expanded);
  let count = 0;
  for (const b of layout.branches) {
    if (b.merge == null) continue; // open lanes have no merge row — not the inversion shape
    const summaryRow = rows.find((r) => r.kind === "summary" && r.laneId === b.id)?.row;
    const mergeRow = rows.find((r) => r.kind === "commit" && r.hash === b.merge)?.row;
    if (summaryRow === undefined || mergeRow === undefined) continue;
    if (mergeRow <= summaryRow) count++;
  }
  return count;
}

// ── AC1: lanePath fails closed on botY <= topY, and mergeRow > laneTopRow on every fixture ───────────

test("AC1: buildLanePath returns null (not a path) when botY <= topY", () => {
  // botY < topY (lane top row below its merge row — the inverted shape).
  assert.equal(buildLanePath({ laneX: 82, forkRow: null, mergeRow: 3, laneTopRow: 5, laneBotRow: 5 }), null);
  // botY === topY.
  assert.equal(buildLanePath({ laneX: 82, forkRow: null, mergeRow: null, laneTopRow: 4, laneBotRow: 4 }), null);
  // botY > topY yields a real path string (distinguishable from null).
  const ok = buildLanePath({ laneX: 82, forkRow: null, mergeRow: 5, laneTopRow: 3, laneBotRow: 3 });
  assert.equal(typeof ok, "string", "a valid lane returns a path string, not null");
  assert.ok(ok.startsWith("M "), `path starts with a moveto (got: ${ok})`);
});

test("AC1: every merged lane has mergeRow > laneTopRow on both fixtures (fixed sort)", () => {
  for (const fx of [invertedFixture(), aggFixture()]) {
    const layout = layoutGitGraph(hist(fx.commits, fx.head, fx.heads));
    assert.ok(layout, "fixture yields a layout");
    const inv = invertedLaneCount(computeGitGraphRows, layout);
    assert.equal(inv, 0, `fixed sort leaves zero inverted lanes (got ${inv})`);
    for (const { b, forkRow, mergeRow } of lanePathInputs(layout)) {
      if (b.merge == null) continue;
      const topRow = forkRow ?? undefined;
      if (topRow !== undefined) {
        assert.ok(mergeRow > topRow, `lane ${b.ref}: mergeRow ${mergeRow} > forkRow ${topRow}`);
      }
    }
  }
});

// ── AC2: negative control — the old sort still inverts the fork==null lane (判据能取假) ─────────────

test("AC2: the old sort (no kind pinning) inverts the fork==null lane on the same fixture", () => {
  const fx = invertedFixture();
  const layout = layoutGitGraph(hist(fx.commits, fx.head, fx.heads));
  const oldInv = invertedLaneCount(oldRows, layout);
  assert.ok(oldInv > 0, `old sort produces ${oldInv} inverted lane(s) — the counter can take a non-zero value`);
  const newInv = invertedLaneCount(computeGitGraphRows, layout);
  assert.equal(newInv, 0, "the fixed sort flips the same fixture back to zero");
});

// ── AC3: no degenerate rounded corner (Q x,y x,y) after the sort fix ────────────────────────────────

test("AC3: no lane path carries a degenerate Q x,y x,y corner", () => {
  const degenerate = /Q (\d+),(\d+) \1,\2/;
  // Negative control: the regex DOES match a hand-built degenerate corner (r = 0) — it is not a
  // pattern that can never match.
  assert.ok(degenerate.test("M 60,50 H 104 Q 104,50 104,50 V 76"), "the degenerate regex matches a real r=0 corner");
  for (const fx of [invertedFixture(), aggFixture()]) {
    const layout = layoutGitGraph(hist(fx.commits, fx.head, fx.heads));
    for (const { b, forkRow, mergeRow, laneTop, laneBot } of lanePathInputs(layout)) {
      const d = buildLanePath({ laneX: b.laneX, forkRow, mergeRow, laneTopRow: laneTop, laneBotRow: laneBot });
      if (d === null) continue; // an inverted lane is skipped, never drawn (no corner at all)
      assert.ok(!degenerate.test(d), `lane ${b.ref} path has no degenerate corner (d=${d})`);
    }
  }
});

// ── AC4: three dev-merges of one task aggregate into a single lane ──────────────────────────────────

test("AC4: task/gap-agg-test dev-merged three times collapses to exactly one lane", () => {
  const fx = aggFixture();
  const layout = layoutGitGraph(hist(fx.commits, fx.head, fx.heads));
  const lanes = layout.branches.filter((b) => b.ref === "task/gap-agg-test");
  assert.equal(lanes.length, 1, `three dev-merges aggregate to one lane (got ${lanes.length})`);
  const lane = lanes[0];
  assert.equal(lane.commits.length, 3, "the aggregated lane unions all three dev-merge chunks (3 commits)");
  assert.equal(lane.fork, "t100000", "the aggregated lane keeps the earliest (non-null) fork");
  assert.equal(lane.merge, "m300000", "the aggregated lane keeps the latest merge");
  // The three dev-merge chunks' commits are all present, deduplicated, in time order.
  assert.deepEqual(
    lane.commits.map((x) => x.hash),
    ["d100000", "d200000", "d300000"],
    "aggregated commits = union of the three dev-merge chunks",
  );
});

// ── AC5: fork==null lanes carry an explicit「窗口外分叉」marker, exactly once each ──────────────────

/** Run the client renderer in a VM with a minimal d3/document mock, capturing path + text elements. */
function renderGitGraphInVM(layout) {
  const recorded = { paths: [], texts: [] }; // paths: {cls,d,dash}, texts: {cls,text}
  const makeNode = () => ({ getBBox: () => ({ x: 0, y: 0, width: 60, height: 10 }) });
  function makeSel(rec) {
    const s = {
      attr(name, val) {
        if (rec && name === "class") rec.cls = val;
        else if (rec && name === "d") rec.d = val;
        else if (rec && name === "stroke-dasharray") rec.dash = val;
        return s;
      },
      style() { return s; },
      text(val) { if (rec) rec.text = val; return s; },
      on() { return s; },
      insert() { return makeSel(); },
      remove() { return s; },
      empty() { return true; },
      node() { return makeNode(); },
      each() { return s; },
      selectAll() { return makeSel(); },
      select() { return makeSel(); },
      append(name) {
        if (name === "path") { const r = {}; recorded.paths.push(r); return makeSel(r); }
        if (name === "text") { const r = {}; recorded.texts.push(r); return makeSel(r); }
        return makeSel();
      },
    };
    return s;
  }
  const d3 = { select: () => makeSel() };
  const document = {
    getElementById(id) {
      if (id === "git-graph-data") return { textContent: JSON.stringify({ ...layout, textWidth: 500 }) };
      if (id === "git-graph") return {};
      return null;
    },
  };
  vm.runInNewContext(gitGraphClientScript(), { document, d3 });
  return recorded;
}

test("AC5: fork==null lanes carry a「窗口外分叉」marker, exactly as many as fork==null lanes", () => {
  const fx = invertedFixture();
  const layout = layoutGitGraph(hist(fx.commits, fx.head, fx.heads));
  const forkNullCount = layout.branches.filter((b) => b.fork == null).length;
  assert.ok(forkNullCount >= 1, `precondition: the fixture has ${forkNullCount} fork==null lane(s)`);

  const recorded = renderGitGraphInVM(layout);
  const markers = recorded.texts.filter((t) => t.cls === "git-svg-fork-dangling");
  assert.equal(markers.length, forkNullCount, `exactly ${forkNullCount} marker(s), not more nor fewer`);
  for (const m of markers) assert.equal(m.text, "窗口外分叉", "the marker text is 窗口外分叉");

  // The marker lives on the lane's TOP row (fork==null ⇒ top = summary row), never below it.
  const script = gitGraphClientScript();
  assert.ok(script.includes('"git-svg-fork-dangling"'), "the client emits the fork-dangling marker class");
  assert.ok(script.includes("b.fork == null"), "the marker is keyed on fork == null");
});

// ── smoke: the generated client script is syntactically valid JS ────────────────────────────────────

test("the generated client script is syntactically valid JavaScript", () => {
  new vm.Script(gitGraphClientScript());
});

// ── production carrier: the real repo has zero dev-merge-split lanes and zero inverted lanes ─────────

test("production carrier: real repo has no duplicate MERGED refs and no inverted merged lane", () => {
  const root = path.resolve(__dirname, "../../..");
  const history = readGitHistory(root);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const merged = layout.branches.filter((b) => !b.open);
  const byRef = new Map();
  for (const b of merged) byRef.set(b.ref, (byRef.get(b.ref) ?? 0) + 1);
  const dupRefs = [...byRef.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(dupRefs, [], `no ref has more than one merged lane (dups: ${JSON.stringify(dupRefs)})`);
  const inv = invertedLaneCount(computeGitGraphRows, layout);
  assert.equal(inv, 0, `zero inverted merged lanes on the real repo (got ${inv})`);
});
