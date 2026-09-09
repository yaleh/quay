// @test-group product
// gap-git-history-lane-identity-and-row-layout-overlap — /git-history 的分支 lane 坍缩成同名导致
// 展开重叠 + 全局行号未按可见态分配 + 文字与节点绑定同一 x 坐标 + dashboard 吞掉 git 读失败原因。
//
// 四个根因 → 四个修法（全部先测纯函数/客户端脚本体，再测 dashboard 渲染）：
//   1. 每条 lane 得到结构性 id（fork::merge 或首 commit hash），与显示字符串 ref 解耦 → AC1/AC2。
//   2. 行号按【当前可见】的行集合每次重算（折叠分支只占 1 行摘要）→ AC3/AC4。
//   3. 图形轨道栏有界（区间调度插槽复用 + 超限 "+N more"）+ 文字统一从固定列起写 → AC5/AC6。
//   4. dashboard「最近提交」卡在「读失败」后追加 reason 截断摘要 → AC7/AC8。
//
// 随 gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge 的两阶段 ref 分区模型更新：layout
// 不再有 `trunk` 顶层字段——mainline 是 `branches[0]`；「同名 lane 分裂」在 ref 分区下结构上不可能
// （每个 .ref 至多一条泳道），AC1 改为断言同一 no-ff 合并名下的提交折叠进单条 mainline。
//
// Run (scoped): node --test packages/quay/test/serve-handlers.test.mjs \
//                    packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import {
  layoutGitGraph,
  computeGitGraphRows,
  gitGraphClientScript,
  gitGraphLegendHtml,
  mainlineLane,
  GIT_GRAPH_MAX_LANES,
  GIT_GRAPH_TEXT_X,
  GIT_GRAPH_TRUNK_X,
  GIT_GRAPH_LANE_GAP,
} from "../src/serve-handlers.ts";
import { renderDashboardPage, gitReadFailureSummary } from "../src/serve-dashboard.ts";
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

/** Lateral (non-mainline) lanes. */
function laterals(layout) {
  return layout.branches.filter((b) => b.kind !== "mainline");
}

// ── AC1: two no-ff "Merge branch task/A into develop" commits produce two DISTINCT unnamed lanes ──
// (gap-git-graph-ref-partition-collapses-all-topology-to-one-lane: the ref partition that folded these
// into ONE mainline lane was the over-correction — the topology is restored, and the deleted branch is
// unnamed (#<hash>), so two same-subject merges can no longer collide on a shared name.)

test("AC1: two 'Merge branch task/A into develop' commits produce two DISTINCT unnamed lanes (no same-name split)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("b000000", t0 + 2, "develop", ["t100000"], "branch A tip"),
    c("m000000", t0 + 3, "develop", ["t100000", "b000000"], "Merge branch 'task/A' into develop"),
    c("b100000", t0 + 4, "develop", ["m000000"], "branch B tip"),
    c("m100000", t0 + 5, "develop", ["m000000", "b100000"], "Merge branch 'task/A' into develop"),
  ];
  const layout = layoutGitGraph(hist(commits, "m100000", { develop: "m100000" }));
  assert.equal(layout.branches.length, 3, "mainline + two reconstructed lanes");
  assert.equal(layout.branches[0].kind, "mainline", "the first lane is the mainline");
  assert.equal(layout.branches[0].commits.length, 4, "the mainline is the first-parent chain (4 commits)");
  const laterals = layout.branches.filter((b) => b.kind !== "mainline");
  assert.equal(laterals.length, 2, "two second-parent lanes, never folded into one");
  assert.notEqual(laterals[0].id, laterals[1].id, "the two lanes carry distinct structural ids");
  assert.ok(laterals.every((b) => b.ref.startsWith("#")), "both lanes are unnamed (#<hash>) — no shared name to split");
});

// ── AC2: expansion state keys on the STRUCTURAL id, never the display ref ──────────────────────────

test("AC2: expanding one lane flips only that lane (structural id key, never the display ref)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("a100000", t0 + 2, "task/A", ["t100000"], "a1"),
    c("a200000", t0 + 3, "task/A", ["a100000"], "a2"),
    c("b100000", t0 + 4, "task/B", ["t100000"], "b1"),
    c("b200000", t0 + 5, "task/B", ["b100000"], "b2"),
  ];
  const layout = layoutGitGraph(hist(commits, "b200000", { develop: "t100000", "task/A": "a200000", "task/B": "b200000" }));
  const [a, b] = laterals(layout);
  assert.notEqual(a.ref, b.ref, "precondition: two distinct live lanes");
  assert.notEqual(a.id, b.id, "structural ids differ");
  // Simulate the client's click handler: `expanded` is keyed by the STRUCTURAL id.
  const expanded = {};
  const clickExpand = (lane) => { expanded[lane.id] = true; };
  clickExpand(a);
  assert.equal(expanded[a.id], true, "the clicked lane flips to expanded");
  assert.notEqual(expanded[b.id], true, "the sibling stays collapsed (distinct id key)");

  const script = gitGraphClientScript();
  assert.ok(script.includes("expanded[b.id]"), "client keys expansion state by structural id");
  assert.ok(!script.includes("expanded[b.ref]"), "client never keys expansion state by the display ref");
});

// ── AC3: collapsed branches occupy one summary row each ────────────────────────────────────────────

test("AC3: visible rows = mainline rows + N collapsed summaries (not mainline + all branch commits)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk1"),
    c("a100000", t0 + 2, "task/A", ["t100000"], "a1"),
    c("t200000", t0 + 3, "develop", ["t100000"], "trunk2"),
    c("b100000", t0 + 4, "task/B", ["t200000"], "b1"),
    c("a200000", t0 + 5, "task/A", ["a100000"], "a2"),
    c("b200000", t0 + 6, "task/B", ["b100000"], "b2"),
    c("mA00000", t0 + 7, "develop", ["t200000", "a200000"], "merge A"),
    c("b300000", t0 + 8, "task/B", ["b200000"], "b3"),
    c("mB00000", t0 + 9, "develop", ["mA00000", "b300000"], "merge B"),
  ];
  const layout = layoutGitGraph(hist(commits, "mB00000", { develop: "mB00000" }));
  const mainlineRows = mainlineLane(layout).commits.length;
  const lats = laterals(layout);
  const totalCommits = lats.reduce((n, b) => n + b.commits.length, 0);
  assert.equal(lats.length, 2, "two lateral lanes (2 and 3 commits)");
  assert.equal(totalCommits, 5, "lateral lanes hide 5 commits when collapsed");

  const collapsedRows = computeGitGraphRows(layout, new Set()); // nothing expanded
  assert.equal(collapsedRows.length, mainlineRows + lats.length, "rows = mainline + one summary per collapsed lateral lane");
  assert.ok(collapsedRows.length < mainlineRows + totalCommits, "collapsed branches do NOT reserve rows for their hidden commits");
  assert.equal(collapsedRows.filter((r) => r.kind === "summary").length, lats.length, "exactly one summary row per collapsed lateral lane");
});

// ── AC4: fully expanded, no two rows share a y ─────────────────────────────────────────────────────

test("AC4: fully expanded, every visible row is distinct (the overlap invariant holds)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk1"),
    c("a100000", t0 + 2, "task/A", ["t100000"], "a1"),
    c("t200000", t0 + 3, "develop", ["t100000"], "trunk2"),
    c("b100000", t0 + 4, "task/B", ["t200000"], "b1"),
    c("a200000", t0 + 5, "task/A", ["a100000"], "a2"),
    c("b200000", t0 + 6, "task/B", ["b100000"], "b2"),
    c("mA00000", t0 + 7, "develop", ["t200000", "a200000"], "merge A"),
    c("b300000", t0 + 8, "task/B", ["b200000"], "b3"),
    c("mB00000", t0 + 9, "develop", ["mA00000", "b300000"], "merge B"),
  ];
  const layout = layoutGitGraph(hist(commits, "mB00000", { develop: "mB00000" }));
  const expanded = new Set(layout.branches.map((b) => b.id));
  const rows = computeGitGraphRows(layout, expanded);

  const expected = layout.branches.reduce((n, b) => n + b.commits.length, 0);
  assert.equal(rows.length, expected, "fully expanded rows = mainline + every branch commit");
  const rowIndices = rows.map((r) => r.row);
  assert.equal(new Set(rowIndices).size, rowIndices.length, "no two rows share a row index (⇒ distinct y)");
  assert.deepEqual(rowIndices, rowIndices.map((_, i) => i), "rows are a contiguous 0..n-1 run (one row each)");
  const hashes = rows.filter((r) => r.kind === "commit").map((r) => r.hash);
  assert.equal(new Set(hashes).size, hashes.length, "every commit hash maps to exactly one row");
});

// ── AC5: every text element starts at (or after) the fixed text column ──────────────────────────────

test("AC5: all ink/muted text starts at or after the fixed x (textX), distinct from the lane node cx", () => {
  const script = gitGraphClientScript();
  // Every `.git-svg-ink` / `.git-svg-muted` text element's x must clear the fixed text column — the
  // single textX constant, OR textX + a chip offset (gap-git-graph-lane-visual-encoding-and-fixed-width:
  // a collapsed summary leads with a lane-colour chip(ref), so its trailing "· N commits…" text starts
  // right after the chip). Either way it never moves LEFT of textX, so text never overlaps a lane line.
  const re = /\.attr\("class", "git-svg-(?:ink|muted)"\)\s*\.attr\("x",\s*([^)]*)\)/g;
  const xs = [...script.matchAll(re)].map((m) => m[1].trim());
  assert.ok(xs.length >= 5, `found the text elements (got ${xs.length})`);
  assert.ok(
    xs.every((x) => x === "textX" || x.startsWith("textX + ")),
    `every ink/muted text x starts at (or after) textX (got: ${[...new Set(xs)].join(", ")})`,
  );
  // The node cx is a DIFFERENT coordinate (trunk spine / lane slot), never the text column.
  assert.ok(script.includes('.attr("cx", trunkX)'), "trunk node cx is the trunk spine x");
  assert.ok(script.includes('.attr("cx", laneX)'), "branch node cx is the lane slot x");
  // Geometry invariant: the text column clears the bounded track's right edge.
  assert.ok(GIT_GRAPH_TEXT_X > GIT_GRAPH_TRUNK_X + GIT_GRAPH_MAX_LANES * GIT_GRAPH_LANE_GAP,
    "text column sits to the right of the widest possible track");
});

// ── AC6: bounded track — slot reuse + overflow hint (never an unbounded left/right counter) ────────

test("AC6: sequential lanes reuse a freed slot; >=8 concurrent lanes stay within the slot limit + hint", () => {
  // (a) slot reuse: two reconstructed branches (deleted, no-ff merged) — A merges at m0, B forks after.
  const t0 = 1_700_000_000;
  const seq = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("a000000", t0 + 2, "task/A", ["t100000"], "a"),
    c("m000000", t0 + 3, "develop", ["t100000", "a000000"], "merge A"),
    c("b000000", t0 + 4, "task/B", ["m000000"], "b"),
    c("m100000", t0 + 5, "develop", ["m000000", "b000000"], "merge B"),
  ];
  const seqLayout = layoutGitGraph(hist(seq, "m100000", { develop: "m100000" }));
  const seqLats = laterals(seqLayout);
  assert.equal(seqLats.length, 2, "two reconstructed lateral lanes");
  assert.equal(seqLats[0].slot, seqLats[1].slot, "B reuses the slot A released on merge");

  // (b) overflow: 10 concurrent reconstructed branches all forking from t1 (all overlapping) — only 8
  // slots exist, 2 overflow.
  const conc = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
  ];
  for (let i = 0; i < 10; i++) {
    const bi = `b${String(i).padStart(6, "0")}`;
    const mi = `m${String(i).padStart(6, "0")}`;
    conc.push(c(bi, t0 + 2, `task/B${i}`, ["t100000"], `branch ${i}`));
    conc.push(c(mi, t0 + 3, "develop", ["t100000", bi], `merge ${i}`));
  }
  const head = "m" + "9".padStart(6, "0");
  const concLayout = layoutGitGraph(hist(conc, head, { develop: head }));
  const concLats = laterals(concLayout);
  assert.equal(concLats.length, 10, "10 concurrent lateral lanes");
  for (const b of concLats) {
    assert.ok(b.slot >= 0 && b.slot < GIT_GRAPH_MAX_LANES, `every lane slot is bounded (< ${GIT_GRAPH_MAX_LANES})`);
  }
  assert.equal(concLayout.overflowCount, 2, "10 concurrent lanes − 8 slots = 2 overflow");
  assert.equal(concLats.filter((b) => b.overflow).length, 2, "two lanes are flagged overflow");

  // The client renderer carries the "+N more" hint and the configurable limit (never widens forever).
  const script = gitGraphClientScript();
  assert.ok(script.includes("maxLanes"), "client carries the configurable slot limit");
  assert.ok(script.includes('" more lanes'), "client renders a +N more hint when lanes overflow");
});

// ── AC7: dashboard 「最近提交」 card surfaces the git read-failure reason ──────────────────────────

test("AC7: dashboard git card renders the readGitHistory reason substring, not a bare 读失败", () => {
  const reason = "git log 失败：fatal: cannot change to '/deleted/worktree/gap-xyz': No such file or directory";
  const html = renderDashboardPage({
    live: { status: "ok", liveState: "running", inFlight: [], concurrency: 0 },
    sys: { resourceGate: { status: "ok", verdict: "GO", cpuStallAvg10: null, loadAvg: null }, processBudget: { status: "ok", verdict: "GO" } },
    mgr: { liveness: { sessions: [] }, loopDriver: { verdict: "GO" } },
    tests: { runs: [], reason: null },
    suiteRun: null,
    history: { status: "error", reason, commits: [], head: null, heads: {} },
    tasks: [],
  });
  assert.ok(html.includes("读失败"), "the recognisable 读失败 prefix is preserved");
  assert.ok(html.includes("/deleted/worktree/gap-xyz"), "the reason substring (the deleted path) appears in the card");
  assert.ok(html.includes("最近提交"), "the commits card is rendered");
});

test("AC7b: gitReadFailureSummary preserves the prefix, truncates, and escapes HTML in the reason", () => {
  assert.equal(gitReadFailureSummary(null), "读失败", "null reason → bare 读失败");
  assert.equal(gitReadFailureSummary(""), "读失败", "empty reason → bare 读失败");
  assert.equal(gitReadFailureSummary("boom"), "读失败 — boom", "short reason is appended verbatim");
  assert.ok(gitReadFailureSummary("x".repeat(400)).length <= 170, "long reason is truncated to a bounded summary");
  assert.equal(gitReadFailureSummary("a <b> & c"), "读失败 — a &lt;b&gt; &amp; c", "reason is HTML-escaped before inlining");
});

// ── AC8: a real git read failure carries the missing path through to the dashboard ─────────────────

test("AC8: a real readGitHistory error on a nonexistent root surfaces that path in the dashboard", () => {
  const missing = path.join(os.tmpdir(), `quay-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const history = readGitHistory(missing);
  assert.equal(history.status, "error", "a nonexistent root is an error (not an empty repo)");
  assert.ok(history.reason.includes(missing), `the reason names the missing path (got: ${history.reason})`);

  const html = renderDashboardPage({
    live: { status: "ok", liveState: "running", inFlight: [], concurrency: 0 },
    sys: { resourceGate: { status: "ok", verdict: "GO", cpuStallAvg10: null, loadAvg: null }, processBudget: { status: "ok", verdict: "GO" } },
    mgr: { liveness: { sessions: [] }, loopDriver: { verdict: "GO" } },
    tests: { runs: [], reason: null },
    suiteRun: null,
    history,
    tasks: [],
  });
  assert.ok(html.includes(missing), "the dashboard body carries the actual missing path (not bare 读失败)");
});

// ── legend: sticky mini-legend decoupled from the header prose ─────────────────────────────────────

test("legend: gitGraphLegendHtml is a sticky glyph key (● commit / ◆ merge / ┃ trunk), not header prose", () => {
  const html = gitGraphLegendHtml();
  assert.ok(html.includes("●"), "commit glyph");
  assert.ok(html.includes("◆"), "merge glyph");
  assert.ok(html.includes("┃"), "trunk glyph");
  assert.ok(html.includes("position:sticky"), "the legend does not scroll away with the graph");
  assert.ok(html.includes("var(--color-accent-600)"), "glyphs are token-coloured (no hex)");
});
