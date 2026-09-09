// @test-group product
// gap-git-graph-task-view-aggregate-commits-by-task-id — /git-history 缺任务视图。git ref 层面的分支
// 在本仓库是短命的（fan-in 后 ref 即删：27 条 ref 中 7 天内有独有提交的仅 4 条），而开发单元是 quay
// 任务；按 commit subject 里的 task id 聚合才是用户想看的分支。定位是项目特定启发式（依赖 driver 提交
// 文案约定），不是 git 语义 ⇒ 必须是可切换视图，默认仍是 git 拓扑（AC5 逐字节一致，启发式不冒充默认真值）。
//
//   AC1  taskIdFromSubject 对四种文案形态各返回正确 task id，对无关 subject 返回 null。
//   AC2  负控制：`Merge branch 'develop' into develop` 返回 null 而不是把 develop 当 task id ⇒ 判据能取假。
//   AC3  真实仓库上 ?view=task 泳道数 > 同窗口 git 视图泳道数（证明看到被 ff 拍平的任务边界）。
//   AC4  未归属显式化：输出含 unattributedCount，恒等式 总提交数 − Σ各任务泳道提交数 = unattributedCount
//        （差 0），且生产数据上该值 > 0。
//   AC5  默认视图不变：不带 ?view= 时返回的 #git-graph-data 与 ?view=git 逐字节一致。
//   AC6  与 git 对账：任取一个近期完成的任务泳道，其提交条数与 git log --oneline --all --grep=<task-id> 一致。
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

  // Fail-visible: an unrelated conventional-commit subject returns null (never a guess).
  assert.equal(taskIdFromSubject("chore: re-anchor quay-init-closure-ratchet baseline"), null);
  assert.equal(taskIdFromSubject("fix: git-history 分页页 mainline 泳道恒空"), null);
  assert.equal(taskIdFromSubject("init"), null);
  assert.equal(taskIdFromSubject(""), null);
});

// ── AC2: negative control — develop must not be mistaken for a task id ────────────────────────────

test("AC2: Merge branch 'develop' into develop yields null (the criterion can be false)", () => {
  assert.equal(taskIdFromSubject("Merge branch 'develop' into develop"), null);
});

// ── AC3: the task view sees more swimlanes than the git view on the real repo ─────────────────────

test("AC3: on the real repo, ?view=task lane count > the same-window git view lane count", () => {
  clearGitHistoryCache();
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const gitLayout = layoutGitGraph(history);
  const taskLayout = layoutTaskGraph(history);
  assert.ok(gitLayout, "git view lays out");
  assert.ok(taskLayout, "task view lays out");
  assert.ok(
    taskLayout.branches.length > gitLayout.branches.length,
    `task view lanes (${taskLayout.branches.length}) exceed git view lanes (${gitLayout.branches.length}) — it sees the ff-flattened task boundaries`,
  );
});

// ── AC4: unattributed count is explicit, identity holds, and is > 0 on production data ─────────────

test("AC4: the task view output carries unattributedCount; identity 总 − Σ任务泳道 = unattributed holds", () => {
  clearGitHistoryCache();
  const history = readGitHistory(REPO_ROOT);
  assert.equal(history.status, "ok");
  const layout = layoutTaskGraph(history);
  assert.ok(layout);
  // The identity sums TASK swimlanes only (the unattributed lane is not a task swimlane).
  const taskLaneSum = layout.branches
    .filter((b) => b.kind === "task")
    .reduce((s, b) => s + b.commits.length, 0);
  assert.equal(layout.commitCount - taskLaneSum, layout.unattributedCount, "总提交数 − Σ各任务泳道提交数 = unattributedCount (diff 0)");

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
    { hash: "a000000", t: T0, ref: "develop", parents: 0, parentHashes: [], subject: "base" },
    { hash: "b000000", t: T0 + 60, ref: "develop", parents: 1, parentHashes: ["a000000"], subject: "gap-1: implement" },
    { hash: "c000000", t: T0 + 120, ref: "develop", parents: 1, parentHashes: ["b000000"], subject: "tasks: 翻 gap-1 done（driver 机械 fan-in）" },
  ];
  const h = { status: "ok", reason: null, commits, head: "c000000", heads: { develop: "c000000" }, mainlineHead: "c000000" };
  const def = renderGitHistoryPage(h);
  const git = renderGitHistoryPage(h, "git");
  assert.equal(def, git, "default and ?view=git render byte-identical HTML");
  // The default IS the git view — the heuristic is an opt-in, never the default truth.
  assert.ok(def.includes("分支汇总"), "the default page renders the git summary table");
  assert.ok(!def.includes("任务泳道汇总"), "the default page does NOT render the task summary");
  const task = renderGitHistoryPage(h, "task");
  assert.notEqual(task, git, "the task view renders a distinct page");
  assert.ok(task.includes("任务泳道汇总"), "the task view renders the task summary table");
  assert.ok(!task.includes("分支汇总"), "the task view does NOT render the git summary table");
  assert.equal(gitHistoryViewOf(undefined), "git", "no ?view= param defaults to git");
  assert.equal(gitHistoryViewOf(new URL("http://x/?view=git")), "git");
  assert.equal(gitHistoryViewOf(new URL("http://x/?view=task")), "task");
});

// ── AC6: a recent completed task swimlane reconciles with git log --grep ──────────────────────────

test("AC6: the most recent completed task swimlane count equals git log --oneline --all --grep=<id>", () => {
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
  const lane = layout.branches.find((b) => b.kind === "task" && b.ref === id);
  assert.ok(lane, `the task ${id} has a swimlane`);

  const out = execFileSync("git", ["-C", REPO_ROOT, "log", "--oneline", "--all", `--grep=${id}`], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  const gitCount = out.split(/\r?\n/).filter(Boolean).length;
  assert.equal(lane.commits.length, gitCount, `swimlane count (${lane.commits.length}) == git log --grep count (${gitCount}) (diff 0)`);
});
