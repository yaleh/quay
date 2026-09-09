// @test-group product
// gap-git-graph-task-view-aggregate-commits-by-task-id — /git-history 缺任务视图。git ref 层面的分支
// 在本仓库是短命的（fan-in 后 ref 即删：27 条 ref 中 7 天内有独有提交的仅 4 条），而开发单元是 quay
// 任务；按 commit subject 里的 task id 聚合才是用户想看的分组。定位是项目特定启发式（依赖 driver 提交
// 文案约定），不是 git 语义 ⇒ 必须是可切换视图，默认仍是 git 拓扑（AC5 逐字节一致，启发式不冒充默认真值）。
//
//   AC1  taskIdFromSubject 对四种文案形态各返回正确 task id，对无关 subject 返回 null。
//   AC2  负控制：`Merge branch 'develop' into develop` 返回 null 而不是把 develop 当 task id ⇒ 判据能取假。
//   AC3  跨模型成立：取一个真实 task id，其提交在 git 视图占 ≥2 个列号、在任务视图属同一组。
//   AC4  未归属显式化：输出含 unattributedCount，恒等式 总提交数 − Σ各任务分组提交数 = unattributedCount
//        （差 0），且生产数据上该值 > 0。
//   AC5  默认视图不变：不带 ?view= 时返回的 #git-graph-data 与 ?view=git 逐字节一致。
//   AC6  与 git 对账：任取一个近期完成的任务分组，其提交条数与 subject 提到该 task-id 的提交条数一致
//        （subject-only，不是 git log --grep 的全消息匹配——body 提到 id 的提交不该计入）。
//   AC7  任务视图输出不依赖泳道字段：layoutTaskGraph 及其调用链无 fork/merge/open/overflow 引用；
//        负控制显式引用任一字段命中 > 0（判据能取假）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readGitHistory, clearGitHistoryCache } from "../src/observation.ts";
import { taskIdFromSubject, layoutTaskGraph, layoutGitGraph, gitHistoryJson, renderGitHistoryPage, gitHistoryViewOf } from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ── AC1: taskIdFromSubject covers the four commit-message shapes, fails-visible on unrelated ─────

test("AC1: taskIdFromSubject extracts the task id from the four subject shapes; null for unrelated", () => {
  // Form 1 — dev-merge (ff-carried): `Merge branch 'develop' into task/<id>`.
  assert.equal(taskIdFromSubject("Merge branch 'develop' into task/gap-123"), "gap-123");
  // Form 1 variant — `Merge branch 'task/<id>' into develop` (a --no-ff fan-in merge).
  assert.equal(taskIdFromSubject("Merge branch 'task/gap-123' into develop"), "gap-123");
  // Form 2 — fan-in landing: `tasks: 翻 <id> done（driver 机械 fan-in）`.
  assert.equal(taskIdFromSubject("tasks: 翻 gap-123 done（driver 机械 fan-in）"), "gap-123");
  // Form 3 — filing/promotion: `tasks: <id> task_write` / `tasks: <id> todo→ready`.
  assert.equal(taskIdFromSubject("tasks: gap-123 task_write"), "gap-123");
  assert.equal(taskIdFromSubject("tasks: gap-123 todo→ready（promotion-driver 机械晋升）"), "gap-123");
  // Form 3 variant — `tasks: reset <id> done→ready` (fan-in 收敛中间态).
  assert.equal(taskIdFromSubject("tasks: reset gap-123 done→ready（fan-in 收敛「done 未落地」中间态）"), "gap-123");
  // Form 4 — implementation commit: `<id>: <实现说明>`.
  assert.equal(taskIdFromSubject("gap-123: implement the fix"), "gap-123");

  // Form 5 — `<type|scope>: <id> <说明>`: a conventional type OR a worker scope prefix, then a
  // known-prefix task id (the AC6 reconciliation form — real commits like `test: gap-… 独立闭合确认` /
  // `fix: gap-… — …` / `webui: gap-… 实现（…）`). The id's known prefix is the guard, not the type.
  assert.equal(taskIdFromSubject("test: gap-123 独立闭合确认"), "gap-123");
  assert.equal(taskIdFromSubject("fix: gap-123 — address the review finding"), "gap-123");
  assert.equal(taskIdFromSubject("webui: gap-dashboard-status-tag-badges 实现（补 --color-positive-100 + .tag-positive，goal/fan-in 状态词改徽章）"), "gap-dashboard-status-tag-badges");

  // Form 6 — trailing-parens id: `<说明> (gap-…)` (the AC6 reconciliation form for subjects whose id
  // sits in a trailing parenthetical, not the colon position — real commit `dashboard: 顶部行改 …
  // (gap-dashboard-top-row-asymmetric-columns)`).
  assert.equal(taskIdFromSubject("dashboard: 顶部行改 3:2 非对称分栏，sys+mgr 堆叠右列 (gap-dashboard-top-row-asymmetric-columns)"), "gap-dashboard-top-row-asymmetric-columns");

  // Form 4 known-prefix guard: a component/page-name prefix (`git-history:`) must NOT be taken as a
  // task id — the subject falls through to Form 6 and extracts the trailing-parens id (gap-taskid-
  // from-subject-form4-prefix-guard — the real `git-history: … (gap-…)` implementation commit).
  assert.equal(taskIdFromSubject("git-history: full-width opaque sticky legend + stale comment fix (gap-git-graph-no-bounded-scroll-panel)"), "gap-git-graph-no-bounded-scroll-panel");

  // Fail-visible: an unrelated conventional-commit subject returns null (never a guess).
  assert.equal(taskIdFromSubject("chore: re-anchor quay-init-closure-ratchet baseline"), null);
  assert.equal(taskIdFromSubject("fix: git-history 分页页 mainline 泳道恒空"), null);
  assert.equal(taskIdFromSubject("docs: touch up the README (v2)"), null); // bare parenthetical, not a known prefix
  assert.equal(taskIdFromSubject("init"), null);
  assert.equal(taskIdFromSubject(""), null);
});

// ── AC2: negative control — develop must not be mistaken for a task id ────────────────────────────

test("AC2: Merge branch 'develop' into develop yields null (the criterion can be false)", () => {
  assert.equal(taskIdFromSubject("Merge branch 'develop' into develop"), null);
});

// ── AC3: the task view sees what the git view scatters — one group, ≥2 git columns ─────────────────

test("AC3: a real task id spans ≥2 git columns but is exactly one task group", () => {
  clearGitHistoryCache();
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const gitLayout = layoutGitGraph(history);
  const taskLayout = layoutTaskGraph(history);
  assert.ok(gitLayout, "git view lays out");
  assert.ok(taskLayout, "task view lays out");

  // The git view scatters a task's commits across the columns its ref/merge topology opened; the task
  // view groups them back under one id. Pick a real task id that the git view scatters (≥2 columns).
  const colsById = new Map();
  for (const r of gitLayout.rows) {
    const id = taskIdFromSubject(r.subject);
    if (!id) continue;
    if (!colsById.has(id)) colsById.set(id, new Set());
    colsById.get(id).add(r.col);
  }
  const id = taskLayout.groups.find((g) => (colsById.get(g.id)?.size ?? 0) >= 2)?.id;
  assert.ok(id, "some real task id spans ≥2 git columns in this window");
  const gitCols = colsById.get(id);
  assert.ok(gitCols.size >= 2, `task ${id} spans ≥2 git columns (got ${[...gitCols].sort().join(",")})`);

  const groups = taskLayout.groups.filter((g) => g.id === id);
  assert.equal(groups.length, 1, `task ${id} is exactly ONE task group`);
  const groupHashes = new Set(groups[0].commits.map((c) => c.hash));
  for (const r of gitLayout.rows.filter((r) => taskIdFromSubject(r.subject) === id)) {
    assert.ok(groupHashes.has(r.hash), `every git-view commit of ${id} belongs to the single task group`);
  }
});

// ── AC4: unattributed count is explicit, identity holds, and is > 0 on production data ─────────────

test("AC4: the task view output carries unattributedCount; identity 总 − Σ任务分组 = unattributed holds", () => {
  clearGitHistoryCache();
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok");
  const layout = layoutTaskGraph(history);
  assert.ok(layout);
  const taskGroupSum = layout.groups.reduce((s, g) => s + g.commits.length, 0);
  assert.equal(layout.commitCount - taskGroupSum, layout.unattributedCount, "总提交数 − Σ各任务分组提交数 = unattributedCount (diff 0)");

  // The explicit count rides the task-view JSON payload (the git view's payload is unchanged).
  const json = gitHistoryJson(history, "task");
  assert.equal(typeof json.unattributedCount, "number", "the task-view JSON carries unattributedCount");
  assert.equal(json.unattributedCount, layout.unattributedCount);
  assert.equal("unattributedCount" in gitHistoryJson(history, "git"), false, "the git-view JSON does NOT carry unattributedCount (view payloads differ)");

  // Production reading (硬规则 4 推论三): the value is genuinely non-zero on the real repo, not only
  // in a fixture.
  assert.ok(layout.unattributedCount > 0, `production unattributedCount (${layout.unattributedCount}) > 0`);
});

// ── AC5: default view is byte-identical to ?view=git (the heuristic never becomes the default) ────

test("AC5: the default (no ?view=) page is byte-identical to ?view=git; task view is a distinct opt-in", () => {
  const T0 = 1_700_000_000;
  const commits = [
    { hash: "a000000", t: T0, ref: "develop", parents: 0, parentHashes: [], subject: "base", decorations: [] },
    { hash: "b000000", t: T0 + 60, ref: "develop", parents: 1, parentHashes: ["a000000"], subject: "gap-1: implement", decorations: [] },
    { hash: "c000000", t: T0 + 120, ref: "develop", parents: 1, parentHashes: ["b000000"], subject: "tasks: 翻 gap-1 done（driver 机械 fan-in）", decorations: ["develop"] },
  ];
  const h = { status: "ok", reason: null, commits, head: "c000000", heads: { develop: "c000000" }, mainlineHead: "c000000" };
  const def = renderGitHistoryPage(h);
  const git = renderGitHistoryPage(h, "git");
  assert.equal(def, git, "default and ?view=git render byte-identical HTML (so #git-graph-data is byte-identical)");
  // The default IS the git view — the heuristic is an opt-in, never the default truth.
  assert.ok(def.includes("git-graph-data"), "the default page embeds the git-view data script");
  assert.ok(!def.includes("任务分组（按 task id 聚合）"), "the default page does NOT render the task grouping");
  const task = renderGitHistoryPage(h, "task");
  assert.notEqual(task, git, "the task view renders a distinct page");
  assert.ok(task.includes("任务分组（按 task id 聚合）"), "the task view renders the task grouping");
  assert.ok(!task.includes("git-graph-data"), "the task view does NOT embed the git graph data script");
  assert.equal(gitHistoryViewOf(undefined), "git", "no ?view= param defaults to git");
  assert.equal(gitHistoryViewOf(new URL("http://x/?view=git")), "git");
  assert.equal(gitHistoryViewOf(new URL("http://x/?view=task")), "task");
  assert.equal(gitHistoryViewOf(new URL("http://x/?view=bogus")), "git", "an unknown ?view= fails closed to git");
});

// ── AC6: a recent completed task group reconciles with the subject-mention count ──────────────────

test("AC6: the most recent completed task group count equals the subject-mention count", () => {
  clearGitHistoryCache();
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok");
  const done = history.commits.filter((c) => /^tasks: 翻 /.test(c.subject));
  assert.ok(done.length > 0, "the window has at least one completed task");
  const newest = done.reduce((a, b) => (a.t > b.t ? a : b));
  const id = taskIdFromSubject(newest.subject);
  assert.ok(id, `the newest completed subject yields a task id (${newest.subject})`);

  const layout = layoutTaskGraph(history);
  assert.ok(layout);
  const group = layout.groups.find((g) => g.id === id);
  assert.ok(group, `the task ${id} has a group`);

  // Subject-only reconciliation, over the SAME 500-commit window readGitHistory reads (`--all
  // --topo-order -n 500`): the task view attributes by SUBJECT (`taskIdFromSubject`), so the
  // independent measure is the number of commits in that window whose SUBJECT mentions the id —
  // NOT `git log --grep=<id>`, which searches the full message AND all history: a commit whose body
  // merely references the id miscounts, and the unbounded walk blows the execFileSync pipe buffer.
  const out = execFileSync("git", ["-C", REPO_ROOT, "log", "--all", "--topo-order", "-n", "500", "--format=%s"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  const gitCount = out.split(/\r?\n/).filter((l) => l.includes(id)).length;
  assert.equal(group.commits.length, gitCount, `group count (${group.commits.length}) == subject-mention count (${gitCount}) (diff 0)`);
});

// ── AC7: the task view's output path references no swimlane field (survives the git-column rewrite) ─

test("AC7: layoutTaskGraph and its call chain reference no fork/merge/open/overflow field", () => {
  const src = `${layoutTaskGraph.toString()}\n${taskIdFromSubject.toString()}`;
  const hits = src.match(/\.(fork|merge|open|overflow)\b/g) || [];
  assert.equal(hits.length, 0, `the task view path must not reference fork/merge/open/overflow (got ${hits.join(", ")})`);
  // Negative control: an explicit reference to one of those fields DOES match — the criterion can be false.
  const bad = "lane.open".match(/\.(fork|merge|open|overflow)\b/g) || [];
  assert.ok(bad.length > 0, "the negative control matches — the criterion can be false");
});
