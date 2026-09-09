// @test-group product
// gap-git-graph-pagination-mainline-lane-empty-before-page — /git-history.json 的 before= 分页页
// branches[0].commits（mainline 泳道）恒为 0。根因（serve-git.ts layoutGitGraph）：脊柱从
// heads[develop]（develop 的 tip，来自 for-each-ref，不受 before 过滤）起走首父链，而 before 页的
// mainline batch 严格老于游标 ⇒ tip 不在 byHash ⇒ 脊柱循环体一次都不执行 ⇒ 脊柱空。叠加客户端
// loadOlder 对空 branches[0] 直接 finishOlder ⇒ 滚动加载第一页即停。
//
// 修法（两层）：
//   ① readGitHistory 主链 batch 改 --first-parent（脊柱 = develop 首父链，分页与非分页同路径），并加
//     一条 full/uncapped mainline 走（--since=页内最老脊柱时间）重新取回被 --first-parent 排除的侧枝
//     （第二父链）提交；结果新增 mainlineHead 字段 = batch 内最新主链提交（分页页的脊柱根）。
//   ② layoutGitGraph 脊柱根：heads[develop] 不在 byHash 时回退到 mainlineHead（batch 内最新主链提交）。
//
//   AC1  before 页非空：before=<首屏最老 t> 直调 readGitHistory + layoutGitGraph，branches[0].commits
//        .length > 0（修复前 = 0）；fixture 负控制验证脊柱根回退（旧逻辑 tip 不在 batch ⇒ 空脊柱）。
//   AC2  连续三页单调增长：cursor 逐页回退连取三页，合并 mainline 提交数单调增长且第三页非空。
//   AC3  侧枝不丢：页内每个「在窗第二父」（合并提交的第二父，且落在 `git log develop -n <limit>` 的
//        计数窗口内）都已被取回（missing = 0）并被某条泳道认领（孤儿数 = 0），且「在窗第二父」数 > 0
//        （判据能取假）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutGitGraph, mainlineLane } from "../src/serve-git.ts";
import { readGitHistory } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
// A page size well under the repo's spine length (9886 commits), so three pages always fit and the
// third page is non-empty — the bug is limit-independent (any before= page was empty).
const LIMIT = 200;

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** Every hash claimed by ANY lane (mainline included — a second parent on the spine is claimed too). */
function claimedHashes(layout) {
  const set = new Set();
  for (const b of layout.branches) for (const cm of b.commits) set.add(cm.hash);
  return set;
}

// ── AC1 (fixture): the spine root falls back to mainlineHead when the tip is outside the batch ────────
// A before= page's history: the mainline tip is STRICTLY newer than the cursor, so it is NOT in
// `commits`; `mainlineHead` (the newest commit the --first-parent batch fetched) is. The OLD logic
// walked from heads[develop] (absent from byHash) and produced an EMPTY spine — the bug.

test("AC1 (fixture): the spine root falls back to mainlineHead when the tip is outside the batch", () => {
  const history = {
    status: "ok",
    reason: null,
    commits: [
      c("a000000", 100, "develop", [], "base"),
      c("b000000", 200, "develop", ["a000000"], "trunk"),
    ],
    head: "c000000",
    heads: { develop: "c000000" },
    mainlineHead: "b000000", // the newest spine commit actually fetched (c000000 is the absent tip)
  };
  const layout = layoutGitGraph(history);
  assert.ok(layout, "the fixture yields a layout");
  assert.ok(mainlineLane(layout).commits.length > 0, "the mainline falls back to mainlineHead (non-empty)");

  // Negative control: the OLD spine root (heads[develop], outside the batch) yields an empty spine.
  const byHash = new Map(history.commits.map((x) => [x.hash, x]));
  const oldSpine = [];
  let cur = history.heads.develop;
  while (cur && byHash.has(cur) && !oldSpine.includes(cur)) {
    oldSpine.push(cur);
    cur = byHash.get(cur).parentHashes[0] ?? null;
  }
  assert.equal(oldSpine.length, 0, "the OLD spine root (tip outside the batch) yields an empty spine — the bug");
});

// ── AC1 (production): a before= page has a non-empty mainline lane ─────────────────────────────────────

test("AC1: a before= page has a non-empty mainline lane (branches[0].commits > 0)", () => {
  const page1 = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(page1.status, "ok", "the checkout under test is a readable git repo");
  const mainline1 = mainlineLane(layoutGitGraph(page1)).commits;
  assert.ok(mainline1.length > 0, "the first page has a non-empty mainline lane");
  const cursor = Math.min(...mainline1.map((cm) => cm.t));
  const page2 = readGitHistory(REPO_ROOT, { limit: LIMIT, before: cursor });
  assert.equal(page2.status, "ok", "the before= page reads ok");
  const mainline2 = mainlineLane(layoutGitGraph(page2)).commits;
  assert.ok(mainline2.length > 0, "the before= page mainline lane is non-empty (the bug returns 0)");
});

// ── AC2: three consecutive pages grow the merged mainline monotonically ────────────────────────────────

test("AC2: three consecutive pages grow the merged mainline monotonically and page 3 is non-empty", () => {
  const seen = new Set();
  let cursor = null;
  let prevSize = 0;
  for (let i = 1; i <= 3; i++) {
    const h = readGitHistory(REPO_ROOT, { limit: LIMIT, before: cursor });
    assert.equal(h.status, "ok", `page ${i} reads ok`);
    const ml = mainlineLane(layoutGitGraph(h)).commits;
    assert.ok(ml.length > 0, `page ${i} mainline is non-empty`);
    for (const cm of ml) seen.add(cm.hash);
    assert.ok(seen.size > prevSize, `merged mainline grows after page ${i} (${prevSize} -> ${seen.size})`);
    prevSize = seen.size;
    cursor = Math.min(...ml.map((cm) => cm.t));
  }
});

// ── AC3: the --first-parent mainline separation does not drop side branches ────────────────────────────

test("AC3: every in-window second parent is fetched and claimed (no side branch lost)", () => {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  assert.ok(mainlineLane(layout).commits.length > 0, "the page has a non-empty mainline");
  const timeByHash = new Map(history.commits.map((cm) => [cm.hash, cm.t]));
  const claimed = claimedHashes(layout);
  // The lateral batch is `git log develop -n <limit>` (count-capped — the pre-fix mainline batch), so
  // a merge's second parent is "in the page window" iff it is among those <limit> newest
  // develop-reachable commits. That git oracle is the "not lost" universe: a second parent inside it
  // must be fetched and claimed; one outside it is legitimately deferred to an older page.
  const windowHashes = new Set(
    execFileSync("git", ["-C", REPO_ROOT, "log", "develop", "-n", String(LIMIT), "--format=%H"], { encoding: "utf8" })
      .trim().split(/\r?\n/).filter(Boolean),
  );
  let inWindowSecondParents = 0;
  let missing = 0;
  let orphans = 0;
  for (const cm of history.commits) {
    if (cm.parentHashes.length < 2) continue;
    for (const p of cm.parentHashes.slice(1)) {
      if (!windowHashes.has(p)) continue; // below the count window — deferred to an older page
      inWindowSecondParents++;
      if (!timeByHash.has(p)) missing++;
      else if (!claimed.has(p)) orphans++;
    }
  }
  assert.ok(inWindowSecondParents > 0, "the window contains merge second parents to verify (non-vacuous)");
  assert.equal(missing, 0, `every in-window second parent is fetched (${missing} missing — --first-parent dropped them)`);
  assert.equal(orphans, 0, `every fetched second parent is claimed by a lane (${orphans} orphans)`);
});
