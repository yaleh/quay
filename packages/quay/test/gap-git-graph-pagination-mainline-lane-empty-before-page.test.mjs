// @test-group product
// gap-git-graph-pagination-mainline-lane-empty-before-page — 泳道模型取消后，「脊柱为空」的不变式换成
// 新模型的等价断言：/git-history.json?before= 的分页页必须返回非空 rows，且连续多页单调增长。旧的
// bug 是 before 页 branches[0].commits 恒为 0（脊柱从不在 batch 里的 tip 起走）；新模型下同形的失效
// 是「分页页 rows 为空 ⇒ 滚动加载第一页即停」。
//
//   AC1  before 页非空：before=<首屏最老 t> 直调 readGitHistory + layoutGitGraph，rows.length > 0。
//   AC2  连续三页单调增长：cursor 逐页回退连取三页，合并提交数单调增长且第三页非空。
//   AC3  侧枝不丢：页内每个在窗第二父都已被取回（missing = 0）——git log --all 的完整遍历不丢侧枝。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutGitGraph } from "../src/serve-git.ts";
import { readGitHistory } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIMIT = 200;

test("AC1: a before= page has non-empty rows (the pagination spine is not empty)", () => {
  const page1 = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(page1.status, "ok", "the checkout under test is a readable git repo");
  const rows1 = layoutGitGraph(page1).rows;
  assert.ok(rows1.length > 0, "the first page has rows");
  const cursor = Math.min(...rows1.map((r) => r.t));
  const page2 = readGitHistory(REPO_ROOT, { limit: LIMIT, before: cursor });
  assert.equal(page2.status, "ok", "the before= page reads ok");
  assert.ok(layoutGitGraph(page2).rows.length > 0, "the before= page has non-empty rows (the bug returns 0)");
});

test("AC2: three consecutive pages grow the merged commit set monotonically and page 3 is non-empty", () => {
  const seen = new Set();
  let cursor = null;
  let prevSize = 0;
  for (let i = 1; i <= 3; i++) {
    const h = readGitHistory(REPO_ROOT, { limit: LIMIT, before: cursor });
    assert.equal(h.status, "ok", `page ${i} reads ok`);
    const rows = layoutGitGraph(h).rows;
    assert.ok(rows.length > 0, `page ${i} has rows`);
    for (const r of rows) seen.add(r.hash);
    assert.ok(seen.size > prevSize, `merged commit set grows after page ${i} (${prevSize} -> ${seen.size})`);
    prevSize = seen.size;
    cursor = Math.min(...rows.map((r) => r.t));
  }
});

test("AC3: every in-window second parent is fetched (no side branch lost by the --all traversal)", () => {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const inWindow = new Set(history.commits.map((c) => c.hash));
  const windowHashes = new Set(
    execFileSync("git", ["-C", REPO_ROOT, "log", "develop", "-n", String(LIMIT), "--format=%H"], { encoding: "utf8" })
      .trim().split(/\r?\n/).filter(Boolean),
  );
  let inWindowSecondParents = 0;
  let missing = 0;
  for (const cm of history.commits) {
    if (cm.parentHashes.length < 2) continue;
    for (const p of cm.parentHashes.slice(1)) {
      if (!windowHashes.has(p)) continue;
      inWindowSecondParents++;
      if (!inWindow.has(p)) missing++;
    }
  }
  assert.ok(inWindowSecondParents > 0, "the window contains merge second parents to verify (non-vacuous)");
  assert.equal(missing, 0, `every in-window second parent is fetched (${missing} missing)`);
});
