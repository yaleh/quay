// @test-group product
// gap-git-graph-omits-inflight-branches-and-summary-table-disjoint — /git-history 的泳道只由
// 主干合并提交的父链反推 ⇒ 只画已合并分支；同页汇总表另按 --source 活 ref 分组 ⇒ 两套分支模型的
// 名字集合交集为空。修法：layoutGitGraph 增开放泳道（活 ref 未合并，open:true / merge:null），
// 汇总表改用同一份 layout.branches + 状态列（已合并 / 在飞）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGitGraph } from "../src/serve-git.ts";

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

// A fixture with BOTH kinds of branch on one graph. The merged branch's commit carries
// `ref: "develop"` to mirror readGitHistory's re-attribution of mainline-reachable commits
// (gap-git-history-branch-summary-wrong-numbers) — its tip still resolves to "task/merged" via
// `heads`, so the merged-lane pass claims it; the unmerged live branch keeps its own ref and tip.
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

// ── AC1: layoutGitGraph returns BOTH merged and unmerged live branches, the latter open ─────────

test("AC1: layoutGitGraph yields merged AND open lanes; open lanes carry open:true + merge:null", () => {
  const { commits, heads, head } = mergedAndOpenFixture();
  const layout = layoutGitGraph(hist(commits, head, heads));
  assert.ok(layout, "an ok history yields a layout");
  assert.equal(layout.branches.length, 2, "exactly two lanes: one merged, one open (no double-count)");

  const merged = layout.branches.find((b) => b.ref === "task/merged");
  assert.ok(merged, "the merged branch is a lane");
  assert.equal(merged.open, false, "merged lane is closed (open: false)");
  assert.ok(merged.merge, "merged lane carries a merge commit");
  assert.equal(merged.merge, "mm00000", "merged lane merges back into the trunk merge commit");

  const open = layout.branches.find((b) => b.ref === "task/open");
  assert.ok(open, "the unmerged live branch is ALSO a lane (the defect: it was omitted)");
  assert.equal(open.open, true, "unmerged lane is open: true");
  assert.equal(open.merge, null, "unmerged lane has merge === null");
  assert.equal(open.fork, "mm00000", "open lane forks from the trunk commit it diverged from");
  assert.deepEqual(open.commits.map((x) => x.hash), ["o100000", "o200000"], "open lane carries its own commits oldest→newest");
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
  assert.equal(layout.branches.length, 1, "one merged lane");
  assert.equal(layout.branches[0].open, false, "the merged lane is not open");
});

// ── AC3: negative control — the OLD summary-table model (groupCommitsByBranch) must disagree ────
// Implemented INLINE here (deliberately NOT imported — the export is removed), so AC2's same-source
// criterion can be false: the old table grouped by --source ref, which re-attribution folds a merged
// branch's commits into "develop", so the old table's name set omits "task/merged" while the graph
// (fork/merge lanes) still contains it.

function oldGroupCommitsByBranchRefs(commits) {
  const byRef = new Map();
  for (const c of commits) {
    if (!byRef.has(c.ref)) byRef.set(c.ref, c.ref);
  }
  return [...byRef.keys()];
}

test("AC3: the OLD summary table disagrees with the graph (AC2's same-source差集 > 0)", () => {
  const { commits, heads, head } = mergedAndOpenFixture();
  const layout = layoutGitGraph(hist(commits, head, heads));
  const oldTableRefs = new Set(oldGroupCommitsByBranchRefs(commits));
  const graphRefs = new Set([layout.trunk.ref, ...layout.branches.map((b) => b.ref)]);
  // The OLD table (--source grouping after re-attribution) names only develop + the open ref; the
  // graph also names task/merged (from the merge's parent chain). The difference is non-empty.
  const diff = [...graphRefs].filter((r) => !oldTableRefs.has(r));
  assert.ok(diff.length > 0, "the old table is NOT same-source with the graph (falsifiable)");
  assert.ok(diff.includes("task/merged"), "the difference is exactly the merged branch the old table folded away");
});
