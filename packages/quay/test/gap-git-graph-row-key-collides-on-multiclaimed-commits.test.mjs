// @test-group product
// gap-git-graph-row-key-collides-on-multiclaimed-commits — /git-history 的行号以裸 hash / laneId 为键，
// 同一提交被多条 lane 重复认领时后写覆盖先写（61 对文字叠印、成片空行）。根因是两处：
//   1. layoutGitGraph 的 lane 抽取不排他——一条提交会被多条 lane 认领（生产实测 455 重复哈希 / 12 重复 id）；
//   2. 客户端 visibleRows() 用 `rowOf[hash]` / `summaryRow[laneId]` 查表，重复键上后写覆盖先写 ⇒ 同一 y。
// 修法（缺一不可）：行号成为 item 属性（渲染遍历 items 用下标作 y）；lane 抽取排他（claimed 集 +
// 最老 merge 先走）+ lane id 去重。旧任务 gap-git-history-lane-identity-and-row-layout-overlap 的
// fixture 没有「一条提交被两条 lane 认领」的形状，其 AC4 判据结构上不可能取假——本文件补上那个形状。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-row-key-collides-on-multiclaimed-commits.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  layoutGitGraph,
  computeGitGraphRows,
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

/** All hashes claimed by the layout's lanes (with duplicates, as laid out). */
function laneHashes(layout) {
  const out = [];
  for (const b of layout.branches) for (const commit of b.commits) out.push(commit.hash);
  return out;
}

// ── AC2: exclusive lanes — no commit is claimed by two lanes (branch-of-a-branch shape) ───────────

test("AC2: a branch forked from another branch keeps only its own commits (no cross-lane duplicate)", () => {
  const t0 = 1_700_000_000;
  // A forked from trunk t1 (a1→a2), merged at t3. B forked from a1 (not the trunk), merged at t4.
  // The OLD walker re-claimed a1 for B's lane; the new walker stops at A's already-claimed a1.
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk1"),
    c("t200000", t0 + 2, "develop", ["t100000"], "trunk2"),
    c("a100000", t0 + 3, "task/A", ["t100000"], "a1"),
    c("a200000", t0 + 4, "task/A", ["a100000"], "a2"),
    c("t300000", t0 + 5, "develop", ["t200000", "a200000"], "merge A"),
    c("b100000", t0 + 6, "task/B", ["a100000"], "b1"),
    c("t400000", t0 + 7, "develop", ["t300000", "b100000"], "merge B"),
  ];
  const layout = layoutGitGraph(hist(commits, "t400000", { develop: "t400000" }));
  const hashes = laneHashes(layout);
  assert.equal(new Set(hashes).size, hashes.length,
    `every lane commit is claimed exactly once (got ${hashes.length} entries, ${new Set(hashes).size} unique)`);
  // B's lane must NOT re-claim a1 — it holds only its own b1.
  const laneB = layout.branches.find((b) => b.commits.some((x) => x.hash === "b100000"));
  assert.ok(laneB, "branch B lane exists");
  assert.deepEqual(laneB.commits.map((x) => x.hash), ["b100000"],
    "B's lane claims only b1, never A's a1");
});

// ── AC3: unique lane ids — fork::merge octopus collision is disambiguated ─────────────────────────

test("AC3: two parents of one merge forking from the same trunk commit get distinct ids", () => {
  const t0 = 1_700_000_000;
  // Octopus merge t3 merges p1 and p2, both forked directly from t1 — the OLD id `${fork}::${merge}`
  // (= t1::t3) collided. The new code appends a #N disambiguator.
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk1"),
    c("t200000", t0 + 2, "develop", ["t100000"], "trunk2"),
    c("p100000", t0 + 3, "task/P1", ["t100000"], "p1"),
    c("p200000", t0 + 4, "task/P2", ["t100000"], "p2"),
    c("t300000", t0 + 5, "develop", ["t200000", "p100000", "p200000"], "octopus merge"),
  ];
  const layout = layoutGitGraph(hist(commits, "t300000", { develop: "t300000" }));
  assert.equal(layout.branches.length, 2, "two lanes from the octopus merge");
  const ids = layout.branches.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `lane ids are unique (got: ${ids.join(", ")})`);
});

test("AC3b: fork=null lanes sharing the same first commit no longer collide (exclusive claim)", () => {
  const t0 = 1_700_000_000;
  // Two branches whose walks both pass through the same window-edge commit "shared" — the OLD code
  // gave both lanes id = lane[0].hash = shared. Exclusive claiming leaves "shared" to the first lane.
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk1"),
    c("t200000", t0 + 2, "develop", ["t100000"], "trunk2"),
    c("shared00", t0 + 3, "task/X", ["t100000"], "shared"),
    c("x100000", t0 + 4, "task/X", ["shared00"], "x1"),
    c("t300000", t0 + 5, "develop", ["t200000", "x100000"], "merge X"),
    c("y100000", t0 + 6, "task/Y", ["shared00"], "y1"),
    c("t400000", t0 + 7, "develop", ["t300000", "y100000"], "merge Y"),
  ];
  const layout = layoutGitGraph(hist(commits, "t400000", { develop: "t400000" }));
  const ids = layout.branches.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `fork=null lane ids are unique (got: ${ids.join(", ")})`);
});

// ── AC4: negative control — the cross-lane-duplicate shape the old fixture never carried ──────────

/** A layout whose two lanes both claim commit "dup1" (the production shape the old fixture lacked). */
function dupHashLayout() {
  const mk = (hash, t, subject) => ({ hash, t, parents: 0, subject });
  return {
    trunk: { ref: "develop", commits: [mk("t000000", 1, "base"), mk("t100000", 2, "trunk")] },
    branches: [
      { id: "lane-A", ref: "develop", slot: 0, laneX: 82, overflow: false,
        commits: [mk("dup1000", 3, "shared"), mk("a100000", 4, "A only")],
        fork: "t100000", merge: null, mergeT: null, firstT: 3, lastT: 4, collapsed: true },
      { id: "lane-B", ref: "develop", slot: 1, laneX: 104, overflow: false,
        commits: [mk("dup1000", 3, "shared"), mk("b100000", 5, "B only")],
        fork: "t100000", merge: null, mergeT: null, firstT: 3, lastT: 5, collapsed: true },
    ],
    commitCount: 6, mergeCount: 0, overflowCount: 0,
  };
}

test("AC4: old rowOf[hash] collapses a cross-lane-duplicate layout; the item.row model does not", () => {
  const layout = dupHashLayout();
  const expanded = new Set(["lane-A", "lane-B"]);
  const items = computeGitGraphRows(layout, expanded);
  const commitItems = items.filter((it) => it.kind === "commit");
  assert.equal(commitItems.length, 6, "two trunk + two lane-A + two lane-B commits, one hash claimed twice");

  // NEW approach: each item carries its own row — distinct by construction.
  const newRows = items.map((it) => it.row);
  assert.equal(new Set(newRows).size, newRows.length, "new model assigns every item a distinct row");

  // OLD approach: rowOf[hash] is last-write-wins, so the two "dup1" items collapse onto one row.
  const rowOf = {};
  for (const it of commitItems) rowOf[it.hash] = it.row;
  const oldDistinctRows = new Set(Object.values(rowOf)).size;
  assert.ok(oldDistinctRows < commitItems.length,
    `old rowOf[hash] maps ${commitItems.length} commits onto ${oldDistinctRows} rows (collapse)`);
});

// ── AC5: contiguous rows, no empty rows ───────────────────────────────────────────────────────────

test("AC5: new model yields contiguous [0,n) rows with no empty row; old model leaves a gap", () => {
  const layout = dupHashLayout();
  const items = computeGitGraphRows(layout, new Set(["lane-A", "lane-B"]));

  // New: every row in [0, items.length) is occupied by exactly one item.
  const occupied = new Set(items.map((it) => it.row));
  const empty = [];
  for (let i = 0; i < items.length; i++) if (!occupied.has(i)) empty.push(i);
  assert.deepEqual(empty, [], `new model leaves no empty rows (empty: ${empty.join(",") || "none"})`);
  assert.deepEqual(
    [...occupied].sort((a, b) => a - b),
    items.map((_, i) => i),
    "rows are the contiguous 0..n-1 run",
  );

  // Old: the collapse leaves one row unoccupied — assert by NAME, not a bare boolean (print the list).
  const commitItems = items.filter((it) => it.kind === "commit");
  const rowOf = {};
  for (const it of commitItems) rowOf[it.hash] = it.row;
  const oldOccupied = new Set(commitItems.map((it) => rowOf[it.hash]));
  const oldEmpty = [];
  for (let i = 0; i < items.length; i++) if (!oldOccupied.has(i)) oldEmpty.push(i);
  assert.ok(oldEmpty.length > 0, `old rowOf[hash] leaves an empty row (empty rows: ${oldEmpty.join(",")})`);
});

// ── client renderer: row is an item attribute, never a lossy hash/laneId-keyed lookup ─────────────

test("client renderer assigns item.row and never collapses a bare-hash lookup", () => {
  const script = gitGraphClientScript();
  assert.ok(script.includes("it.row = i"), "client assigns the row as an intrinsic item attribute");
  assert.ok(!script.includes("rowOf[it.hash]"), "client no longer builds the lossy rowOf[hash] map");
  assert.ok(!script.includes("summaryRow[it.laneId]"), "client no longer builds the lossy summaryRow[laneId] map");
  assert.ok(!script.includes("rowOf[c.hash]"), "client no longer looks up a commit row via bare hash");
  assert.ok(!script.includes("rowOf[b.fork]"), "client no longer looks up the fork row via bare hash");
  assert.ok(!script.includes("summaryRow[b.id]"), "client no longer looks up a summary row via bare laneId");
});

// ── production carrier: the real repo's layout is duplicate-free (AC2/AC3 against live git data) ──

test("production carrier: the real repo layout has no duplicate lane hashes and no duplicate ids", () => {
  const root = path.resolve(__dirname, "../../..");
  const history = readGitHistory(root);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const hashes = laneHashes(layout);
  assert.equal(new Set(hashes).size, hashes.length,
    `no commit is claimed by two lanes (${hashes.length} entries, ${new Set(hashes).size} unique)`);
  const ids = layout.branches.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `lane ids are unique (${ids.length} lanes)`);
});
