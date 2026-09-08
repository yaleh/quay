// @test-group product
// gap-git-graph-omits-inflight-branches-and-summary-table-disjoint — /git-history 的泳道一度只由
// 主干合并提交的父链反推 ⇒ 只画已合并分支，遗漏未合并的活分支（在飞 worktree）。修法：layoutGitGraph
// 增开放泳道（活 ref 未合并，open:true / merge:null），汇总表改用同一份 layout.branches。
// 随 gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge 的两阶段 ref 分区模型更新：已合并
// 分支的提交被 readGitHistory 重归因到 develop ⇒ 折叠进 mainline 泳道，不再单独成泳道；只有未合并的
// 活分支仍是独立的 `kind: 'live'` 泳道。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGitGraph, mainlineLane } from "../src/serve-git.ts";

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

// A fixture with BOTH kinds of branch on one graph. The merged branch's commit carries `ref: "develop"`
// to mirror readGitHistory's re-attribution of mainline-reachable commits (gap-git-history-branch-
// summary-wrong-numbers) — so the merged branch folds into the mainline; the unmerged live branch keeps
// its own ref and tip, and stays a `kind: 'live'` lateral lane.
function mergedAndOpenFixture() {
  const t0 = 1_700_000_000;
  const commits = [
    c("a000000", t0, "develop", [], "base"),
    c("b000000", t0 + 1, "develop", ["a000000"], "trunk two"),
    c("m100000", t0 + 2, "develop", ["b000000"], "merged branch commit"),
    c("mm00000", t0 + 3, "develop", ["b000000", "m100000"], "merge task/merged"),
    c("o100000", t0 + 4, "task/open", ["mm00000"], "open branch commit one"),
    c("o200000", t0 + 5, "task/open", ["o100000"], "open branch commit two"),
  ];
  const heads = { develop: "mm00000", "task/merged": "m100000", "task/open": "o200000" };
  return { commits, heads, head: "mm00000" };
}

// ── AC1: layoutGitGraph yields the mainline + the OPEN live branch (merged branches fold in) ──────

test("AC1: layout yields mainline + open lanes; open lanes carry open:true + merge:null", () => {
  const { commits, heads, head } = mergedAndOpenFixture();
  const layout = layoutGitGraph(hist(commits, head, heads));
  assert.ok(layout, "an ok history yields a layout");
  assert.equal(mainlineLane(layout).kind, "mainline", "the leading lane is the mainline");
  assert.equal(mainlineLane(layout).ref, "develop", "the mainline lane is named develop");

  const open = layout.branches.find((b) => b.ref === "task/open");
  assert.ok(open, "the unmerged live branch is ALSO a lane (the defect: it was omitted)");
  assert.equal(open.kind, "live", "the open lane is kind live");
  assert.equal(open.open, true, "unmerged lane is open: true");
  assert.equal(open.merge, null, "unmerged lane has merge === null");
  assert.equal(open.fork, "mm00000", "open lane forks from the trunk commit it diverged from");
  assert.deepEqual(open.commits.map((x) => x.hash), ["o100000", "o200000"], "open lane carries its own commits oldest→newest");

  // The merged branch's commit is re-attributed to develop ⇒ it folds into the mainline, NOT a lane.
  const mainlineHashes = new Set(mainlineLane(layout).commits.map((x) => x.hash));
  assert.ok(mainlineHashes.has("m100000"), "the fully-merged branch's commit lands in the mainline lane");
  assert.equal(layout.branches.find((b) => b.ref === "task/merged"), undefined, "no fabricated task/merged lane (it is folded into mainline)");
});

test("AC1 (negative control): a merged-only fixture produces NO open lane", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("a000000", t0, "develop", [], "base"),
    c("b000000", t0 + 1, "develop", ["a000000"], "trunk two"),
    c("m100000", t0 + 2, "develop", ["b000000"], "merged branch commit"),
    c("mm00000", t0 + 3, "develop", ["b000000", "m100000"], "merge task/merged"),
  ];
  const layout = layoutGitGraph(hist(commits, "mm00000", { develop: "mm00000", "task/merged": "m100000" }));
  assert.equal(layout.branches.filter((b) => b.open).length, 0, "no open lane when every branch is merged");
  assert.equal(layout.branches.length, 1, "only the mainline lane (the merged branch folded in)");
});

// ── AC3: negative control — the OLD --source grouping and the NEW graph agree (差集 empty) ─────────
// Implemented INLINE here (deliberately NOT imported): the old summary table grouped by --source ref,
// which folds a merged branch into "develop". The ref-partition graph now does the SAME fold, so the
// two name sets agree — and the graph no longer fabricates a lane for a re-attributed commit.
function oldGroupCommitsByBranchRefs(commits) {
  const byRef = new Set();
  for (const c of commits) byRef.add(c.ref);
  return [...byRef];
}

test("AC3: the graph ref set equals the --source ref partition (no fabricated merged-branch lane)", () => {
  const { commits, heads, head } = mergedAndOpenFixture();
  const layout = layoutGitGraph(hist(commits, head, heads));
  const sourceRefs = new Set(oldGroupCommitsByBranchRefs(commits));
  const graphRefs = new Set(layout.branches.map((b) => b.ref));
  assert.deepEqual([...graphRefs].sort(), [...sourceRefs].sort(), "graph and --source partition name the SAME ref set");
  assert.ok(!graphRefs.has("task/merged"), "the graph no longer fabricates a task/merged lane");
  assert.ok(graphRefs.has("task/open"), "the graph still names the open live branch");
});
