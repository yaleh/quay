// @test-group product
// gap-git-graph-trunk-ref-resolves-to-head-not-mainline — /git-history 的主干泳道名取自 HEAD 所在分支
// 名（恒为 author）而非 mainline。本仓库主检出常驻 author，且 author 常与 develop 指向同一提交，于是
// 主干被命名为 author，而底部「分支汇总」表与页面导语都说 develop —— 同一页三处口径矛盾。修法：主干
// 名按语义优先级 develop > master > HEAD 分支名解析（resolveTrunkRef），并让同提交多 ref 时 --source
// 归因优先 mainline（observation.ts）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-trunk-ref-resolves-to-head-not-mainline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTrunkRef, layoutGitGraph, mainlineLane } from "../src/serve-git.ts";

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

// ── AC2: negative control — the OLD logic (take the HEAD branch name) must disagree ─────────────────
// Implemented INLINE here (deliberately NOT imported) so the criterion can be false: the old logic
// returns `author` for AC1's first two cases, proving resolveTrunkRef's `develop`/`master` are a real
// decision, not a tautology that would pass for any input.
function oldHeadBranchName(heads, head) {
  for (const [name, tip] of Object.entries(heads)) {
    if (tip === head) return name;
  }
  return "";
}

test("AC2: the old HEAD-branch-name logic returns author where resolveTrunkRef returns a mainline", () => {
  const X = "x000000";
  const Y = "y000000";
  assert.equal(oldHeadBranchName({ author: X, develop: X, master: Y }, X), "author", "old logic: author (case 1)");
  assert.equal(oldHeadBranchName({ author: X, master: X }, X), "author", "old logic: author (case 2)");
  // Precondition: the new resolver disagrees — the whole point of the fix.
  assert.equal(resolveTrunkRef({ author: X, develop: X, master: Y }, X), "develop", "new logic diverges (case 1)");
  assert.equal(resolveTrunkRef({ author: X, master: X }, X), "master", "new logic diverges (case 2)");
});

// ── AC1: resolveTrunkRef is a directly-importable pure function with mainline priority ───────────────

test("AC1: resolveTrunkRef resolves develop > master > HEAD branch name", () => {
  const X = "x000000";
  const Y = "y000000";
  // author + develop + master all present; head is on X (author == develop). develop wins.
  assert.equal(resolveTrunkRef({ author: X, develop: X, master: Y }, X), "develop", "develop beats author");
  // No develop; author + master both at X. master wins.
  assert.equal(resolveTrunkRef({ author: X, master: X }, X), "master", "master beats author");
  // Neither mainline ref; the HEAD branch name is the only candidate.
  assert.equal(resolveTrunkRef({ feature: X }, X), "feature", "falls back to the HEAD branch name");
});

test("resolveTrunkRef is wired into layoutGitGraph (not a dead function)", () => {
  const t0 = 1_700_000_000;
  const X = "x000000";
  // HEAD is on `author`, which points at the same commit as `develop` — the exact production shape.
  const commits = [c(X, t0, "develop", [], "init")];
  const layout = layoutGitGraph(hist(commits, X, { author: X, develop: X }));
  assert.equal(mainlineLane(layout).ref, "develop", "the mainline lane is named develop, not author");
});
