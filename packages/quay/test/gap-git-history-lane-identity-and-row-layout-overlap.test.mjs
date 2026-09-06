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

// ── AC1: two lanes re-labelled to the same display string get distinct structural ids ──────────────

test("AC1: layoutGitGraph assigns distinct internal ids to two same-named lanes (re-label + deleted branch)", () => {
  const t0 = 1_700_000_000;
  // Both branch tips (b000000 / b100000) carry ref "develop" — the mainline re-attribution a deleted
  // task branch gets — while heads only knows the mainline tip. branchNameOf() therefore collapses
  // BOTH lanes to "develop", but their fork::merge points differ.
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("b000000", t0 + 2, "develop", ["t100000"], "branch A tip"),
    c("m000000", t0 + 3, "develop", ["t100000", "b000000"], "merge A"),
    c("b100000", t0 + 4, "develop", ["m000000"], "branch B tip"),
    c("m100000", t0 + 5, "develop", ["m000000", "b100000"], "merge B"),
  ];
  const layout = layoutGitGraph(hist(commits, "m100000", { develop: "m100000" }));
  assert.equal(layout.branches.length, 2, "two branch lanes");
  const refs = layout.branches.map((b) => b.ref);
  assert.ok(refs.every((r) => r === "develop"), `both lanes display the collapsed mainline ref (got ${refs})`);
  const [a, b] = layout.branches;
  assert.notEqual(a.id, b.id, "structural ids differ despite the identical display string");
});

// ── AC2: expanding one summary only flips that lane (same-name sibling stays collapsed) ─────────────

test("AC2: expanding one summary flips only the clicked lane, the same-name sibling stays collapsed", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
    c("b000000", t0 + 2, "develop", ["t100000"], "branch A tip"),
    c("m000000", t0 + 3, "develop", ["t100000", "b000000"], "merge A"),
    c("b100000", t0 + 4, "develop", ["m000000"], "branch B tip"),
    c("m100000", t0 + 5, "develop", ["m000000", "b100000"], "merge B"),
  ];
  const layout = layoutGitGraph(hist(commits, "m100000", { develop: "m100000" }));
  const [a, b] = layout.branches;
  assert.equal(a.ref, b.ref, "precondition: the two lanes share one display string");
  // Simulate the client's click handler: `expanded` is keyed by the STRUCTURAL id, so clicking lane A
  // can never flip lane B even though they render the same label.
  const expanded = {};
  const clickExpand = (lane) => { expanded[lane.id] = true; };
  clickExpand(a);
  assert.equal(expanded[a.id], true, "the clicked lane flips to expanded");
  assert.notEqual(expanded[b.id], true, "the same-name sibling stays collapsed (distinct id key)");

  // The client renderer must key on the id, never the collapsed display ref string.
  const script = gitGraphClientScript();
  assert.ok(script.includes("expanded[b.id]"), "client keys expansion state by structural id");
  assert.ok(!script.includes("expanded[b.ref]"), "client never keys expansion state by the display ref");
});

// ── AC3: collapsed branches occupy one summary row each ────────────────────────────────────────────

test("AC3: visible rows = trunk rows + N collapsed summaries (not trunk + all branch commits)", () => {
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
  const trunkRows = layout.trunk.commits.length;
  const totalCommits = layout.branches.reduce((n, b) => n + b.commits.length, 0);
  assert.equal(layout.branches.length, 2, "two branch lanes (2 and 3 commits)");
  assert.equal(totalCommits, 5, "branches hide 5 commits when collapsed");

  const collapsedRows = computeGitGraphRows(layout, new Set()); // nothing expanded
  assert.equal(collapsedRows.length, trunkRows + layout.branches.length, "rows = trunk + one summary per collapsed branch");
  assert.ok(collapsedRows.length < trunkRows + totalCommits, "collapsed branches do NOT reserve rows for their hidden commits");
  assert.equal(collapsedRows.filter((r) => r.kind === "summary").length, layout.branches.length, "exactly one summary row per collapsed branch");
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

  const expected = layout.trunk.commits.length + layout.branches.reduce((n, b) => n + b.commits.length, 0);
  assert.equal(rows.length, expected, "fully expanded rows = trunk + every branch commit");
  const rowIndices = rows.map((r) => r.row);
  assert.equal(new Set(rowIndices).size, rowIndices.length, "no two rows share a row index (⇒ distinct y)");
  assert.deepEqual(rowIndices, rowIndices.map((_, i) => i), "rows are a contiguous 0..n-1 run (one row each)");
  const hashes = rows.filter((r) => r.kind === "commit").map((r) => r.hash);
  assert.equal(new Set(hashes).size, hashes.length, "every commit hash maps to exactly one row");
});

// ── AC5: every text element starts at the fixed text column ────────────────────────────────────────

test("AC5: all ink/muted text starts at one fixed x (textX), distinct from the lane node cx", () => {
  const script = gitGraphClientScript();
  // Every `.git-svg-ink` / `.git-svg-muted` text element's x attribute must be the single textX constant.
  const re = /\.attr\("class", "git-svg-(?:ink|muted)"\)\s*\.attr\("x",\s*([^)]*)\)/g;
  const xs = [...script.matchAll(re)].map((m) => m[1].trim());
  assert.ok(xs.length >= 5, `found the text elements (got ${xs.length})`);
  assert.ok(xs.every((x) => x === "textX"), `every ink/muted text x is textX (got: ${[...new Set(xs)].join(", ")})`);
  // The node cx is a DIFFERENT coordinate (trunk spine / lane slot), never the text column.
  assert.ok(script.includes('.attr("cx", trunkX)'), "trunk node cx is the trunk spine x");
  assert.ok(script.includes('.attr("cx", laneX)'), "branch node cx is the lane slot x");
  // Geometry invariant: the text column clears the bounded track's right edge.
  assert.ok(GIT_GRAPH_TEXT_X > GIT_GRAPH_TRUNK_X + GIT_GRAPH_MAX_LANES * GIT_GRAPH_LANE_GAP,
    "text column sits to the right of the widest possible track");
});

// ── AC6: bounded track — slot reuse + overflow hint (never an unbounded left/right counter) ────────

test("AC6: sequential lanes reuse a freed slot; >=8 concurrent lanes stay within the slot limit + hint", () => {
  // (a) slot reuse: branch A merges at m0 (t0+2), branch B forks from m0 (t0+2) — B reuses A's slot.
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
  assert.equal(seqLayout.branches.length, 2);
  assert.equal(seqLayout.branches[0].slot, seqLayout.branches[1].slot, "B reuses the slot A released on merge");

  // (b) overflow: 10 lanes all forking from t1 (all overlapping) — only 8 slots exist, 2 overflow.
  const conc = [
    c("t000000", t0, "develop", [], "base"),
    c("t100000", t0 + 1, "develop", ["t000000"], "trunk"),
  ];
  let prevTrunk = "t100000";
  for (let i = 0; i < 10; i++) {
    const bi = `b${String(i).padStart(6, "0")}`;
    const mi = `m${String(i).padStart(6, "0")}`;
    conc.push(c(bi, t0 + 2, "develop", ["t100000"], `branch ${i}`));
    conc.push(c(mi, t0 + 3 + i, "develop", [prevTrunk, bi], `merge ${i}`));
    prevTrunk = mi;
  }
  const head = "m" + "9".padStart(6, "0");
  const concLayout = layoutGitGraph(hist(conc, head, { develop: head }));
  assert.equal(concLayout.branches.length, 10, "10 concurrent lanes");
  for (const b of concLayout.branches) {
    assert.ok(b.slot >= 0 && b.slot < GIT_GRAPH_MAX_LANES, `every lane slot is bounded (< ${GIT_GRAPH_MAX_LANES})`);
  }
  assert.equal(concLayout.overflowCount, 2, "10 concurrent lanes − 8 slots = 2 overflow");
  assert.equal(concLayout.branches.filter((b) => b.overflow).length, 2, "two lanes are flagged overflow");

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
