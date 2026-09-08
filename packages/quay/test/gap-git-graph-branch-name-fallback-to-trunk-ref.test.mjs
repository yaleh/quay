// @test-group product
// gap-git-graph-branch-name-fallback-to-trunk-ref — /git-history 的 branchNameOf 在 heads 查不到
// 一个已删除 task 分支的 tip 时，fallback 取该提交自己的 `--source` ref，而那个 ref 已被主线下
// re-attribution 成 develop ⇒ 28 条 lane 100% 同名 develop（{develop:28}，比值 1.0）。根因是
// fallback 的返回值与「查不到」同形（硬规则 3b）：调用方无从区分「这条 lane 真叫 develop」与
// 「没查着，给你个 develop」。
//
// 修法：真名从【合并提交的 subject】解析（`Merge branch 'develop' into task/<id>` /
// `Merge branch 'task/<id>' into develop`），解析不出时返回一个与「解析成功」可区分的
// `{ name: "unnamed@<short-hash>", unresolved: true }`，而不是伪装成 develop。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-branch-name-fallback-to-trunk-ref.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchNameFromMergeSubject,
  resolveBranchName,
  layoutGitGraph,
} from "../src/serve-handlers.ts";

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

// ── subject parser: both fan-in conventions + non-task / unresolvable forms ──────────────────────

test("branchNameFromMergeSubject parses both fan-in and dev-merge forms, prefers task/<id>", () => {
  assert.equal(branchNameFromMergeSubject("Merge branch 'task/A' into develop"), "task/A");
  assert.equal(branchNameFromMergeSubject("Merge branch 'develop' into task/A"), "task/A");
  assert.equal(branchNameFromMergeSubject("Merge branch 'develop' into author"), "author");
  assert.equal(branchNameFromMergeSubject("Merge branch 'develop' into gap-meta-ffpushtodevelop"), "gap-meta-ffpushtodevelop");
  // Only the mainline is named → no branch name to recover.
  assert.equal(branchNameFromMergeSubject("Merge branch 'develop'"), null);
  // No merge-branch form at all → null (the caller marks it unresolved).
  assert.equal(branchNameFromMergeSubject("merge A"), null);
  assert.equal(branchNameFromMergeSubject("tasks: 翻 gap-x done"), null);
});

// ── AC3: unresolved ≠ resolved (硬规则 3b) — a distinguishable marker, never the mainline ref ─────

test("AC3: an unparseable tip resolves to an explicit unresolved marker, not the mainline ref", () => {
  const t0 = 1_700_000_000;
  // heads is empty AND the merge subject has no branch form → the old fallback would return the
  // re-attributed `ref` (develop); the new one must return a distinguishable unresolved value.
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("a000000", t0 + 1, "develop", ["t000000"], "a tip"),
    c("m000000", t0 + 2, "develop", ["t000000", "a000000"], "merge A"),
  ];
  const history = hist(commits, "m000000", {});

  const res = resolveBranchName(history, "a000000");
  assert.equal(res.unresolved, true, "carries a decidable unresolved marker");
  assert.notEqual(res.name, "develop", "unresolved must NOT collapse to the mainline ref");
  assert.ok(!res.name.startsWith("task/"), "unresolved must not equal a real task branch name");
  assert.ok(res.name.includes("@"), "unresolved name is distinguishable (unnamed@<short-hash>)");

  // The OLD :254 fallback on the SAME input returns develop — the exact defect this task removes.
  const oldFallback = history.commits.find((cc) => cc.hash === "a000000")?.ref ?? "a000000".slice(0, 7);
  assert.equal(oldFallback, "develop", "precondition: the old fallback relabels an unreadable tip to develop");
  assert.notEqual(res.name, oldFallback, "new resolution is distinguishable from the old fallback");
});

// ── AC4: negative control — live tip (heads) and deleted branch resolve to the SAME name ──────────

test("AC4: a live tip in heads and a deleted branch (merge commit only) resolve to the same name", () => {
  const t0 = 1_700_000_000;

  // (a) the branch tip is still a live head.
  const commitsA = [
    c("t000000", t0, "develop", [], "base"),
    c("a000000", t0 + 1, "task/A", ["t000000"], "a tip"),
  ];
  const resA = resolveBranchName(hist(commitsA, "a000000", { develop: "t000000", "task/A": "a000000" }), "a000000");
  assert.equal(resA.unresolved, false);
  assert.equal(resA.name, "task/A", "live tip resolves from heads");

  // (b) the branch is deleted — only its merge commit remains, and the tip commit is re-attributed
  //     to the mainline (ref === "develop").
  const commitsB = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("a000000", t0 + 2, "develop", ["t100000"], "a tip"),
    c("m000000", t0 + 3, "develop", ["t100000", "a000000"], "Merge branch 'task/A' into develop"),
  ];
  const resB = resolveBranchName(hist(commitsB, "m000000", { develop: "m000000" }), "a000000");
  assert.equal(resB.unresolved, false);
  assert.equal(resB.name, "task/A", "deleted branch resolves from the merge commit subject");
  assert.equal(resA.name, resB.name, "both fixtures resolve to the same branch name (half-fix would fail here)");
});

// ── ff-fan-in dev-merge shape: the tip commit IS the dev-merge, its own subject names the branch ──

test("a deleted dev-merge tip resolves from its OWN subject (ff-fan-in shape)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("x000000", t0 + 2, "develop", ["t100000"], "older develop"),
    // The deleted branch's last commit is itself a dev-merge; after re-attribution its ref is develop.
    c("a000000", t0 + 3, "develop", ["t100000", "x000000"], "Merge branch 'develop' into task/A"),
    c("m000000", t0 + 4, "develop", ["t100000", "a000000"], "Merge branch 'task/A' into develop"),
  ];
  const res = resolveBranchName(hist(commits, "m000000", { develop: "m000000" }), "a000000");
  assert.equal(res.unresolved, false);
  assert.equal(res.name, "task/A");
});

// ── end-to-end: layoutGitGraph labels deleted branches with their real names, not develop ────────

test("layoutGitGraph folds re-attributed deleted-branch commits into ONE mainline lane (no phantom lanes)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("a000000", t0 + 2, "develop", ["t100000"], "a tip"),
    c("m000000", t0 + 3, "develop", ["t100000", "a000000"], "Merge branch 'task/A' into develop"),
    c("b000000", t0 + 4, "develop", ["m000000"], "b tip"),
    c("m100000", t0 + 5, "develop", ["m000000", "b000000"], "Merge branch 'task/B' into develop"),
  ];
  const layout = layoutGitGraph(hist(commits, "m100000", { develop: "m100000" }));
  assert.equal(layout.branches.length, 1, "one lane — no phantom task/A / task/B lanes");
  assert.equal(layout.branches[0].kind, "mainline", "the single lane is the mainline");
  assert.deepEqual(
    layout.branches[0].commits.map((x) => x.hash),
    ["t000000", "t100000", "a000000", "m000000", "b000000", "m100000"],
    "every commit — including the two dev-merged deleted-branch commits — lives on the mainline",
  );
});
