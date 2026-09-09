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

  // gap-git-graph-ref-partition-collapses-all-topology-to-one-lane: the merged branch's tip is STILL a
  // live head (task/merged was never deleted), so it is a merged lane (kind live, open:false) — the
  // topology is restored, not folded into the mainline.
  const merged = layout.branches.find((b) => b.ref === "task/merged");
  assert.ok(merged, "the still-checked-out merged branch is a lane (its ref was not deleted)");
  assert.equal(merged.kind, "live", "the merged-but-kept branch is kind live");
  assert.equal(merged.open, false, "it is merged (open:false), not in-flight");
  assert.deepEqual(merged.commits.map((x) => x.hash), ["m100000"], "the lane carries its own commit");
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
  assert.equal(layout.branches.length, 2, "mainline + the merged branch's lane (no open lane)");
});

// ── AC3: the graph names BOTH the open live branch AND the merged-but-kept branch (from heads) ─────
// gap-git-graph-ref-partition-collapses-all-topology-to-one-lane: the graph is no longer a projection
// of the --source ref partition — it restores the second-parent lanes, and a still-checked-out merged
// branch (ref not deleted) is named from heads, not fabricated from a merge subject.

test("AC3: the graph names the open live branch AND the merged-but-kept branch (both from heads)", () => {
  const { commits, heads, head } = mergedAndOpenFixture();
  const layout = layoutGitGraph(hist(commits, head, heads));
  const graphRefs = new Set(layout.branches.map((b) => b.ref));
  assert.ok(graphRefs.has("task/open"), "the graph still names the open live branch");
  assert.ok(graphRefs.has("task/merged"), "the graph names the still-checked-out merged branch (its ref was kept)");
  const merged = layout.branches.find((b) => b.ref === "task/merged");
  assert.equal(merged.open, false, "the merged branch is closed, not in-flight");
});
