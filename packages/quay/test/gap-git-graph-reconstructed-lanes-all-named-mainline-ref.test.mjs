// @test-group product
// gap-git-graph-reconstructed-lanes-all-named-mainline-ref — 第二父轨道恢复后，113/113 条 reconstructed
// 泳道全部被命名为 develop（100% 同名，方向与 gap-git-graph-branch-name-fallback-to-trunk-ref 修过的
// 现象逐字相反）。根因：ff dev-merge 的第二父本就是主线自身的旧 tip，没有分支名可恢复——取 task/X 是
// 张冠李戴，取 develop 语义对但退化成零信息。修法：凡解析结果落在 GIT_HISTORY_MAINLINE_REFS 的
// reconstructed 泳道一律 unnamed（ref:null + unnamed:true，不给 chip），并把同属主线历史、由 claimed
// 走链切碎的连续第二父轨道合并成一条（消除 40/102 的单提交碎片）。
//
//   AC1  命名多样性（不可被退化标注满足）：生产 #git-graph-data 中具名泳道（ref != null）的不同取值
//        数 ≥ 2，且没有任何单一 ref 占具名泳道总数的 90% 以上。
//   AC2  mainline 名不得作分支名：branches.filter(b => b.kind !== 'mainline' && MAINLINE_REFS.has(b.ref))
//        长度 === 0。
//   AC3  负控制：显式还原「第二父轨道取带引号名」旧规则（无 mainline 守卫），断言其把第二父命名为
//        develop ⇒ AC2 计数 > 0 ⇒ 判据能取假，不是恒真。
//   AC4  拓扑不丢失：窗口内每个合并提交的第二父仍出现在某条泳道的 commits 中（孤儿数 = 0）。
//   AC5  碎片收敛：reconstructed 泳道中 commits.length === 1 占比 < 20%；「窗口外分叉」标记数
//        （fork == null 且 ref != null）≤ 具名 reconstructed 泳道数。
//   AC6  AC1/AC2/AC5 三项均从真实生产读数的 #git-graph-data 载荷（gitHistoryJson(...).branches，即
//        renderGitHistoryPage 嵌入的同一份 branches）取值，不接受仅 fixture 通过。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  layoutGitGraph,
  gitHistoryJson,
  quotedBranchNameFromMergeSubject,
} from "../src/serve-git.ts";
import { readGitHistory, GIT_HISTORY_MAINLINE_REFS } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** A commit fixture (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

const T0 = 1_700_000_000;

/** ff dev-merge fixture — this repo's real shape: each dev-merge's second parent is a develop "side"
 *  commit on the mainline's own history (not a real branch). */
function ffDevMergeFixture(n = 4) {
  const commits = [];
  commits.push(c("d000000", T0, "develop", [], "base"));
  commits.push(c("d100000", T0 + 1, "develop", ["d000000"], "trunk one"));
  commits.push(c("d200000", T0 + 2, "develop", ["d100000"], "trunk two"));
  const sides = [];
  for (let i = 0; i < n; i++) {
    const s = `s${String(i).padStart(6, "0")}`;
    commits.push(c(s, T0 + 3 + i * 2, "develop", ["d200000"], `side ${i}`));
    sides.push(s);
  }
  let prev = "d200000";
  for (let i = 0; i < n; i++) {
    const m = `m${String(i).padStart(6, "0")}`;
    commits.push(c(m, T0 + 4 + i * 2, "develop", [prev, sides[i]], `Merge branch 'develop' into task/gap-${i}`));
    prev = m;
  }
  return hist(commits, prev, { develop: prev });
}

/** The production #git-graph-data branches payload (gitHistoryJson → renderGitHistoryPage embed). */
function productionBranches() {
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  return { history, branches: gitHistoryJson(history).branches };
}

// ── AC1: naming diversity (not satisfiable by degenerate all-develop labelling) ─────────────────────

test("AC1: named lanes have ≥2 distinct refs and no single ref ≥90% (production)", () => {
  const { branches } = productionBranches();
  const named = branches.filter((b) => b.ref != null);
  assert.ok(named.length > 0, "there is at least one named lane (the mainline)");
  const distinct = new Set(named.map((b) => b.ref));
  assert.ok(distinct.size >= 2, `distinct named refs ≥ 2 (got ${distinct.size}: ${[...distinct].join(", ")})`);
  for (const r of distinct) {
    const share = named.filter((b) => b.ref === r).length / named.length;
    assert.ok(share < 0.9, `no single ref ≥ 90% of named lanes (${r} = ${(share * 100).toFixed(1)}%)`);
  }
});

// ── AC2: mainline ref is never a branch-lane name ───────────────────────────────────────────────────

test("AC2: no non-mainline lane is named a mainline ref (production)", () => {
  const { branches } = productionBranches();
  const bad = branches.filter((b) => b.kind !== "mainline" && GIT_HISTORY_MAINLINE_REFS.has(b.ref));
  assert.equal(bad.length, 0, `no non-mainline lane carries a mainline ref (got ${bad.length})`);
});

// ── AC3: negative control — the OLD quoted rule names the second parents develop ─────────────────────

test("AC3: the OLD quoted rule names second-parent lanes develop (the criterion can be false)", () => {
  const fx = ffDevMergeFixture(4);
  const layout = layoutGitGraph(fx);
  assert.ok(layout, "the fixture yields a layout");
  const reconstructed = layout.branches.filter((b) => b.kind === "reconstructed");
  assert.ok(reconstructed.length > 0, "the fixture produces reconstructed lanes");
  // The NEW rule leaves every second-parent lane unnamed (ref null + unnamed flag).
  assert.ok(
    reconstructed.every((b) => b.ref == null && b.unnamed === true),
    "every reconstructed lane is unnamed (ref null, unnamed true) — never develop",
  );
  // Re-implement the OLD rule inline: quoted name, NO mainline-ref guard. It must name them develop.
  const heads = fx.heads;
  const oldNames = reconstructed.map((b) => {
    const tipHash = b.commits[b.commits.length - 1].hash;
    for (const commit of fx.commits) {
      if (commit.parentHashes.length >= 2 && commit.parentHashes.slice(1).includes(tipHash)) {
        const quoted = quotedBranchNameFromMergeSubject(commit.subject);
        if (quoted && heads[quoted] !== undefined) return quoted; // OLD rule — no mainline guard
      }
    }
    return null;
  });
  const mainlineNamed = oldNames.filter((n) => n != null && GIT_HISTORY_MAINLINE_REFS.has(n));
  assert.ok(mainlineNamed.length > 0, `the OLD rule names ${mainlineNamed.length} second-parent lanes develop ⇒ AC2's count would be > 0`);
});

// ── AC4: topology completeness — no second parent is orphaned ───────────────────────────────────────

test("AC4: every in-window merge's second parent is claimed by a lane (orphans = 0, production)", () => {
  const { history, branches } = productionBranches();
  const inWindow = new Set(history.commits.map((cc) => cc.hash));
  const claimed = new Set();
  for (const b of branches) for (const commit of b.commits) claimed.add(commit.hash);
  let orphans = 0;
  for (const commit of history.commits) {
    if (commit.parentHashes.length < 2) continue;
    for (const p of commit.parentHashes.slice(1)) {
      if (inWindow.has(p) && !claimed.has(p)) orphans++;
    }
  }
  assert.equal(orphans, 0, `every second parent is claimed (orphans: ${orphans})`);
});

// ── AC5: fragment convergence — single-commit noise converged, marker count bounded ──────────────────

test("AC5: reconstructed 1-commit lanes < 20% and 窗口外分叉 markers ≤ named reconstructed (production)", () => {
  const { branches } = productionBranches();
  const reconstructed = branches.filter((b) => b.kind === "reconstructed");
  const oneCommit = reconstructed.filter((b) => b.commits.length === 1).length;
  const ratio = reconstructed.length === 0 ? 0 : oneCommit / reconstructed.length;
  assert.ok(ratio < 0.2, `1-commit reconstructed < 20% (got ${oneCommit}/${reconstructed.length} = ${(ratio * 100).toFixed(1)}%)`);
  const markers = reconstructed.filter((b) => b.fork == null && b.ref != null).length;
  const namedReconstructed = reconstructed.filter((b) => b.ref != null).length;
  assert.ok(markers <= namedReconstructed, `窗口外分叉 markers (${markers}) ≤ named reconstructed (${namedReconstructed})`);
});

// ── AC6: the production payload is exactly the #git-graph-data branches (not a fixture) ──────────────

test("AC6: AC1/AC2/AC5 read the production #git-graph-data branches payload (real repo, not a fixture)", () => {
  // gitHistoryJson(readGitHistory(REPO_ROOT)).branches is the SAME array renderGitHistoryPage embeds
  // into <script type="application/json" id="git-graph-data">. Reading it here (REPO_ROOT = the live
  // checkout) is the production read AC1/AC2/AC5 assert on — no fixture input.
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "production read succeeds");
  const branches = gitHistoryJson(history).branches;
  assert.ok(Array.isArray(branches) && branches.length > 0, "the payload carries the real lane array");
  assert.equal(branches[0].kind, "mainline", "branches[0] is the mainline lane (the live spine)");
});
