// @test-group product
// gap-git-graph-ref-partition-collapses-all-topology-to-one-lane — 泳道对象取消后，拓扑不再被折叠进
// 一条 mainline 泳道，而是由 git 的活跃列 + 回收算法逐提交保留（每提交一列 + 边集）。本测试断言的是
// 该模型下拓扑仍然完整：一个合并提交的第二父落在自己的列上（不止一列），与 git log --graph 的
// fork/merge 菱形一致，而不是被塌成一列。
//
//   AC1  fixture：一个简单的两父合并产出 ≥2 个不同列（第二父独占一列）。
//   AC2  负控制：把所有提交硬塞进同一列（塌成一列）⇒ 列号对拍不一致 > 0 ⇒ 判据能取假。
//   AC3  生产：真实仓库的列号与 git log --graph --all 逐条一致（不一致数 = 0，拓扑无折叠）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { layoutGitGraph, assignGitColumns } from "../src/serve-git.ts";
import { readGitHistory } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

function c(hash, t, parentHashes, subject, decorations = []) {
  return { hash, t, ref: "", parents: parentHashes.length, parentHashes, subject, decorations };
}

test("AC1: a two-parent merge produces ≥2 distinct columns (the second parent keeps its own column)", () => {
  const t0 = 1_700_000_000;
  // Emission order: merge first, then its two parents (second parent newer than first parent).
  const commits = [
    c("m000000", t0 + 3, ["b000000", "x000000"], "merge task/x"),
    c("x000000", t0 + 2, ["b000000"], "branch"),
    c("b000000", t0 + 1, ["a000000"], "trunk"),
    c("a000000", t0, [], "base"),
  ];
  const layout = layoutGitGraph({ status: "ok", reason: null, commits, head: "m000000", heads: {} });
  assert.ok(layout, "the fixture yields a layout");
  const cols = new Set(layout.rows.map((r) => r.col));
  assert.ok(cols.size >= 2, `the merge's second parent occupies its own column (got ${cols.size} columns, was folded to 1)`);
});

test("AC2: collapsing every commit to one column mismatches git (the judge can be false)", () => {
  const commits = [
    { hash: "m000000", parentHashes: ["b000000", "x000000"] },
    { hash: "x000000", parentHashes: ["b000000"] },
    { hash: "b000000", parentHashes: ["a000000"] },
    { hash: "a000000", parentHashes: [] },
  ];
  const real = assignGitColumns(commits);
  const collapsed = new Map(commits.map((c) => [c.hash, 0]));
  let diff = 0;
  for (const c of commits) if (real.get(c.hash) !== collapsed.get(c.hash)) diff++;
  assert.ok(diff > 0, `collapsing to one column differs from the real allocation on ${diff} commits`);
});

test("AC3: production column numbers match git log --graph --all (topology preserved, not folded)", () => {
  const history = readGitHistory(REPO_ROOT, { limit: 500 });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const out = execFileSync("git", ["-C", REPO_ROOT, "log", "--graph", "--all", "-n", "500", "--pretty=format:%x01%H"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const refCols = new Map();
  for (const line of out.split("\n")) {
    const idx = line.indexOf("\x01");
    if (idx === -1) continue;
    refCols.set(line.slice(idx + 1).trim(), Math.floor(line.indexOf("*") / 2));
  }
  let mismatch = 0;
  for (const r of layout.rows) if (refCols.get(r.hash) !== r.col) mismatch++;
  assert.equal(mismatch, 0, `column mismatch = 0 (got ${mismatch})`);
});
