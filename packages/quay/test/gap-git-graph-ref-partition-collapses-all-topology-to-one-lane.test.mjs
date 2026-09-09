// @test-group product
// gap-git-graph-ref-partition-collapses-all-topology-to-one-lane — /git-history 的 ref 分区模型在
// ff fan-in 下把全部 develop 可达提交（= 本仓库全部提交，fan-in 是 ff）归到一个 mainline 泳道 ⇒
// 结构上只产出 1 条泳道，丢掉 git log --graph 同窗口的全部拓扑（36 条并发轨道、441 条侧线提交）。
// 根因两层：①布局层——阶段二只重建「未被认领」的提交，而 ff 下没有未被认领的 ⇒ 恒不产出侧线泳道；
// ②取数层——live 分支的 --since 下界绑在主线下界（≈15h），7 天内有独有提交的活跃 ref 全被滤掉。
// 修法：恢复第二父轨道（泳道 = 每个合并提交第二父的 first-parent 链，走到与 spine 交汇处），命名按
// 可证性分级（活 ref → live；合并 subject 带引号名且仍为活 ref → reconstructed；否则 #<hash> 未命名）。
//
//   AC1  拓扑完备性（结构不变式，非阈值）：窗口内每个合并提交的第二父都出现在某条泳道的 commits 中
//        （孤儿数 = 0），且非 mainline 泳道数 > 0 —— fixture 与真实仓库各跑一遍。
//   AC2  命名取反已修（负控制）：`Merge branch 'develop' into task/X` 的第二父轨道命名为 develop
//        而非 task/X；同一测试显式跑旧规则（挑非 mainline 名）断言它给出 task/X ⇒ 判据能区分新旧。
//   AC3  不再贴错名字（全称判据）：生产里每一条 kind==='reconstructed' 泳道的任一提交都是其 ref 的
//        祖先（git merge-base --is-ancestor 退出码 0）；不满足者已是 #<hash> 未命名 ⇒ 错标计数 = 0。
//   AC5  与 git 对账（点名清单）：4 条已知活跃 ref（若仍存在且仍有独有提交）全部出现在泳道 ref 集合；
//        且非 mainline 泳道数 ≤ 窗口内合并提交数（上界，防重复裂分）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  layoutGitGraph,
  mainlineLane,
  quotedBranchNameFromMergeSubject,
  branchNameFromMergeSubject,
} from "../src/serve-git.ts";
import { readGitHistory } from "../src/observation.ts";

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

/** Every merge commit's second-parent commit hash that is ALSO in the window (the AC1 orphan universe).
 *  A merge at the window edge may have a second parent OUTSIDE the window — that is not an orphan, it is
 *  the 「窗口外分叉」 case (the fork predates the window, drawn with a dangling marker, no lane commits). */
function secondParentHashes(history) {
  const inWindow = new Set(history.commits.map((c) => c.hash));
  const out = [];
  for (const commit of history.commits) {
    if (commit.parentHashes.length < 2) continue;
    for (const p of commit.parentHashes.slice(1)) {
      if (inWindow.has(p)) out.push(p);
    }
  }
  return out;
}

/** All hashes claimed by a layout's lanes. */
function claimedHashes(layout) {
  const set = new Set();
  for (const b of layout.branches) for (const commit of b.commits) set.add(commit.hash);
  return set;
}

// ── FIXTURE: ff dev-merge heavy (this repo's real shape) ────────────────────────────────────────────
// Every commit carries `ref: "develop"` (readGitHistory's mainline re-attribution), and each dev-merge's
// second parent is a develop "side" commit NOT on the first-parent chain — the shape the ref partition
// folded into ONE lane and the second-parent walk must unfold back into N lateral lanes.
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

// ── AC1: topology completeness — fixture + production ────────────────────────────────────────────────

test("AC1: every merge's second parent lands in a lane; non-mainline lanes > 0 (fixture)", () => {
  const fx = ffDevMergeFixture(4);
  const layout = layoutGitGraph(fx);
  assert.ok(layout, "the fixture yields a layout");
  const mainline = mainlineLane(layout);
  assert.equal(mainline.kind, "mainline", "branches[0] is the mainline");
  const laterals = layout.branches.filter((b) => b.kind !== "mainline");
  assert.ok(laterals.length > 0, "the topology is restored: non-mainline lanes > 0 (was 0)");
  assert.ok(laterals.length <= fx.commits.filter((x) => x.parents > 1).length, "lane count ≤ merge count (no duplicate split)");

  const claimed = claimedHashes(layout);
  const orphans = secondParentHashes(fx).filter((h) => !claimed.has(h));
  assert.equal(orphans.length, 0, `every second parent is claimed (orphans: ${orphans.map((h) => h.slice(0, 7)).join(", ")})`);
  // The second-parent lanes are the develop side commits (the mainline's OWN history) — UNNAMED
  // (gap-git-graph-reconstructed-lanes-all-named-mainline-ref): never develop, never a fabricated
  // task/gap-N name.
  assert.ok(laterals.every((b) => b.ref == null && b.unnamed === true), "every lateral lane is unnamed (ref null), not develop and not task/gap-N");
});

test("AC1 (production): every merge's second parent is claimed; non-mainline lanes > 0", () => {
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const laterals = layout.branches.filter((b) => b.kind !== "mainline");
  assert.ok(laterals.length > 0, "the production repo produces non-mainline lanes (was 1 vs 36)");
  const claimed = claimedHashes(layout);
  const orphans = secondParentHashes(history).filter((h) => !claimed.has(h));
  assert.equal(orphans.length, 0, `production orphans = 0 (got ${orphans.length})`);
  assert.ok(laterals.length <= layout.mergeCount, `non-mainline lanes (${laterals.length}) ≤ merge count (${layout.mergeCount})`);
});

// ── AC2: naming inversion fixed (negative control) ───────────────────────────────────────────────────

test("AC2: the second-parent lane of `Merge branch 'develop' into task/X` is unnamed, not develop/task/X", () => {
  const fx = ffDevMergeFixture(1);
  const layout = layoutGitGraph(fx);
  const lane = layout.branches.find((b) => b.kind !== "mainline");
  assert.ok(lane, "the fixture yields one lateral lane");
  assert.equal(lane.ref, null, "the second-parent lane is unnamed (ref null), not develop and not task/gap-0");
  assert.equal(lane.unnamed, true, "the lane carries the explicit unnamed flag");

  // The parser itself: the new quoted rule vs the OLD non-mainline rule — the criterion can be false.
  const subject = "Merge branch 'develop' into task/gap-0";
  assert.equal(quotedBranchNameFromMergeSubject(subject), "develop", "quoted rule names the second parent develop");
  assert.equal(branchNameFromMergeSubject(subject), "task/gap-0", "the OLD non-mainline rule would give task/gap-0 (the bug)");
});

// ── AC3: never mislabel (universal criterion, production) ────────────────────────────────────────────

test("AC3: every reconstructed lane's commits are ancestors of its ref (mislabel count = 0, production)", () => {
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const reconstructed = layout.branches.filter((b) => b.kind === "reconstructed");
  assert.ok(reconstructed.length > 0, "the production repo has reconstructed lanes to verify");
  let mislabels = 0;
  for (const b of reconstructed) {
    assert.ok(b.commits.length > 0, `lane ${b.ref ?? "unnamed"} carries at least one commit`);
    if (b.ref == null) continue; // unnamed — not a mislabel (no name to be wrong about)
    const sample = b.commits[0].hash;
    try {
      execFileSync("git", ["-C", REPO_ROOT, "merge-base", "--is-ancestor", sample, b.ref], { stdio: "ignore" });
    } catch {
      mislabels++;
    }
  }
  assert.equal(mislabels, 0, `every named reconstructed lane is a genuine ancestor of its ref (mislabels: ${mislabels})`);
});

// ── AC5: named active refs + lane-count upper bound ──────────────────────────────────────────────────

test("AC5: the 4 known active refs (if still present with unique commits) appear as lanes; lanes ≤ merges", () => {
  const KNOWN = [
    "task/gap-session-liveness-signals-perfile-timeout-flaky",
    "worktree-archguard-primitives-doc",
    "worktree-dispatch-pref-priority-goal-evidence",
    "worktree-slow-tests-analysis",
  ];
  // A ref still "active with unique commits" only if it exists AND has commits not reachable from develop.
  const stillActive = KNOWN.filter((r) => {
    try {
      const n = Number(execFileSync("git", ["-C", REPO_ROOT, "rev-list", "--count", r, "--not", "develop"], { encoding: "utf8" }).trim());
      return Number.isFinite(n) && n > 0;
    } catch {
      return false;
    }
  });
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  const refs = new Set(layout.branches.map((b) => b.ref));
  if (stillActive.length > 0) {
    for (const r of stillActive) {
      assert.ok(refs.has(r), `active ref ${r} appears in the lane ref set`);
    }
  }
  const laterals = layout.branches.filter((b) => b.kind !== "mainline");
  assert.ok(laterals.length <= layout.mergeCount, `non-mainline lanes (${laterals.length}) ≤ merge count (${layout.mergeCount})`);
});
