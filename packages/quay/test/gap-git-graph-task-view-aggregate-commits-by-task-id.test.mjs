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
//   AC6  分组对账：每个分组的提交条数 == 该窗口内【声明】归它管的 subject 条数。⚠️ 窗口是【受控窗
//        （每条 subject 自带 declared 归属）】，不是活仓库——见下方 AC6 的长注释：活窗口上「条数相等」
//        不是代码的性质而是数据的性质，前缀相撞 / 散文提及会让它恒假。
//   AC7  任务视图输出不依赖泳道字段：layoutTaskGraph 及其调用链无 fork/merge/open/overflow 引用；
//        负控制显式引用任一字段命中 > 0（判据能取假）。
//
// ── 宿主读取的 seam（gap-load-sensitive-tests-read-live-host-class-level-seam）────────────────────
// 本文件对活仓库的每一处读取都走【一次冻结快照】（`snapshotExec`），绝不出现「两次独立读活仓库」：
// 两次读之间的窗口会被循环的提交推移，判定于是变成宿主的函数而不是代码的函数。seam 的产物侧是
// `readGitHistory(root, { exec })`（形状对齐 resourceGateArgv），注入时**绕过缓存**——否则 fixture
// 会顶着生产键留在缓存里，与真读数同形（硬规则 3b）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readGitHistory, GIT_HISTORY_LIMIT, GIT_HISTORY_REF_SCOPE } from "../src/observation.ts";
import { taskIdFromSubject, layoutTaskGraph, layoutGitGraph, gitHistoryJson, renderGitHistoryPage, gitHistoryViewOf } from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ── the frozen host snapshot: ONE read, shared by every consumer below ───────────────────────────

/** The raw `%H\x1f%P\x1f%D\x1f%ct\x1f%s` line format `readGitHistory` asks git for. */
const LOG_FORMAT = "--pretty=format:%H%x1f%P%x1f%D%x1f%ct%x1f%s";
let SNAPSHOT = null;

/** One frozen read of the live repo: one `git log` + one `rev-parse HEAD`, captured once per process.
 *  Every consumer of this file then derives from THESE bytes, so a commit landing mid-test can never
 *  make two of this file's measures disagree — the window cannot shift under it. */
function snapshot() {
  if (SNAPSHOT) return SNAPSHOT;
  // The ref scope MUST be the production one (GIT_HISTORY_REF_SCOPE): this snapshot IS the window the
  // seam serves to `readGitHistory`, so spelling `--all` here would make the fixture's window differ
  // from production's (defeating the seam's purpose — it exists to freeze the SAME read, not a wider one).
  const logOut = execFileSync("git", ["-C", REPO_ROOT, "log", ...GIT_HISTORY_REF_SCOPE, "--topo-order", `-n ${GIT_HISTORY_LIMIT}`, LOG_FORMAT], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
  let head = "";
  try {
    head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    head = ""; // unborn HEAD — readGitHistory degrades the same way.
  }
  SNAPSHOT = { logOut: poison(logOut), head };
  return SNAPSHOT;
}

// ⛔ FALSIFIABILITY CONTROL — dry-run only, never set by the suite. `QUAY_DEFLAKE_POISON=unattributed`
// makes the seam serve a HOST WHOSE SUBJECTS ATTRIBUTE TO NOTHING: the file's verdict must then be RED
// (AC3's `assert.ok(id, "some real task id spans ≥2 git columns")` finds no attributed id at all).
// If the test stays GREEN under this injection, the seam turned it into a no-op — strictly worse than
// no test at all (硬规则 3b: 一个恒绿的检查是假的保证，而「没有检查」只是已知的空白).
// Command + output tail are recorded in `.quay/lowconc-deflake-evidence.jsonl` (task AC3).
function poison(logOut) {
  if (process.env.QUAY_DEFLAKE_POISON !== "unattributed") return logOut;
  return `${logOut.split("\n").filter(Boolean).map((l, i) => { const f = l.split("\x1f"); f[4] = `chore: poisoned ${i}`; return f.join("\x1f"); }).join("\n")}\n`;
}

/** The seam handed to `readGitHistory`. ⛔ FAIL-CLOSED: an unrecognised invocation throws instead of
 *  being served the snapshot — a seam that silently answers the wrong question is worse than none
 *  (硬规则 3b: 读不懂 ⇒ 不得与合格同形). No `--format=%s` handle: the only consumer of a subject
 *  listing was AC6's live count reconciliation, which is exactly what could not be made reliable. */
function snapshotExec(args) {
  const s = snapshot();
  if (args.includes("rev-parse")) return `${s.head}\n`;
  if (args.includes(LOG_FORMAT)) return s.logOut;
  throw new Error(`frozen-snapshot seam got an unexpected git invocation: ${args.join(" ")}`);
}

/** `readGitHistory` over the frozen snapshot — the only way this file reads the live repo. */
function frozenHistory() {
  return readGitHistory(REPO_ROOT, { exec: snapshotExec });
}

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
  const history = frozenHistory();
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
  const history = frozenHistory();
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

// ── AC6: the group count reconciles with the subject attributions the window DECLARES ────────────
//
// ⚠️ Read this before "restoring" the previous form. This test used to reconcile over the LIVE window:
// `readGitHistory(REPO_ROOT)` for the group, then a SECOND live `git log --format=%s` over the same
// window, counting subjects for which `subject.includes(id)` was true. That equality is not a
// property of the CODE — it is a property of the DATA, and the production repo violates it whenever
// the newest completed task's id is
//   (a) a PREFIX of another id in the window (`gap-ac242` ⊂ `gap-ac242-derived-…`), or
//   (b) mentioned in PROSE by a subject the rule attributes elsewhere / nowhere
//       (`goal-target-health: 落地 AC1（… DIR-131 AC6 口径澄清）`).
// Measured 2026-09-13 on the production window: 4 of 45 groups diverge that way; landing ONE
// `tasks: 翻 <prefix-colliding-id> done` commit — zero concurrency, zero commits landing during the
// run — reproduces the recorded red exactly (`group count (2) == subject-mention count (7)`); see
// `.quay/lowconc-deflake-evidence.jsonl`. All 10 recorded failures of this file are THIS assertion.
// ⇒ The live window can never be reconciled by a COUNT: any count that agrees with the group must
// re-implement the extraction rule (an echo of the code under test, 硬规则 4), and any count that
// does not (substring, token-boundary, `--grep`) diverges on data. So the count reconciliation runs
// over a window whose attributions are DECLARED by construction — including both divergence shapes as
// explicit negative cases — while the live window keeps its structural checks (AC3/AC4) through ONE
// frozen snapshot read. `attributed` is declared, never computed: that is what makes this a
// reconciliation and not an echo. (The other half of the old claim — "not `git log --grep`", i.e. a
// body-only mention must not count — is structurally untestable here and always was:
// `GitHistoryCommit` carries no body, so attribution *cannot* consult one.)

test("AC6: the completed-task group count reconciles with the subject attributions the window declares", () => {
  const T0 = 1_700_000_000;
  // Every row declares the id the documented rule MUST recover from that SUBJECT (null = unattributed).
  const rows = [
    // the documented driver forms, all attributed to `gap-a`
    { subj: "gap-a: implement the fix", attributed: "gap-a" },
    { subj: "tasks: 翻 gap-a done（driver 机械 fan-in）", attributed: "gap-a" },
    { subj: "Merge branch 'develop' into task/gap-a", attributed: "gap-a" },
    { subj: "tasks: gap-a task_write by cli:1", attributed: "gap-a" },
    { subj: "test: gap-a 独立闭合确认", attributed: "gap-a" },
    { subj: "dashboard: 顶部行改 3:2 非对称分栏 (gap-a)", attributed: "gap-a" },
    // (a) prefix collision — `includes("gap-a")` counts this one; the rule does NOT attribute it to gap-a
    { subj: "tasks: 翻 gap-a-longer done（driver 机械 fan-in）", attributed: "gap-a-longer" },
    // (b) prose mention — `gap-a` is in the parenthetical; the rule recovers no id from this subject
    { subj: "goal-target-health: 落地 AC1（人 2026-09-12 三选一之① gap-a 口径澄清）", attributed: null },
    // unattributed: no known-prefix token / a bare parenthetical / a develop merge
    { subj: "chore: re-anchor quay-init-closure-ratchet baseline", attributed: null },
    { subj: "docs: touch up the README (v2)", attributed: null },
    { subj: "Merge branch 'develop' into develop", attributed: null },
  ];
  const commits = rows.map((r, i) => {
    const hash = String(i).padStart(7, "0");
    const prev = String(i - 1).padStart(7, "0");
    return { hash, t: T0 + i, ref: "develop", parents: i === 0 ? 0 : 1, parentHashes: i === 0 ? [] : [prev], subject: r.subj, decorations: [] };
  });
  const history = { status: "ok", reason: null, commits, head: commits[commits.length - 1].hash, heads: {}, mainlineHead: commits[0].hash };
  const layout = layoutTaskGraph(history);
  assert.ok(layout, "the task view lays out over the controlled window");

  // (1) Every commit lands under the id its subject DECLARES — the two divergence shapes included.
  for (const r of rows) {
    const g = layout.groups.find((x) => x.commits.some((c) => c.subject === r.subj));
    assert.equal(g?.id ?? null, r.attributed, `subject "${r.subj}" attributes to ${r.attributed}`);
  }

  // (2) THE RECONCILIATION: each group's commit count == the number of window subjects DECLARING that
  //     id. Mentions that are not attributions are excluded — that exclusion is the whole point: the
  //     live measure counted them, so its verdict was a function of the host's data, not of the code.
  for (const g of layout.groups) {
    const declared = rows.filter((r) => r.attributed === g.id).length;
    assert.equal(g.commits.length, declared, `group ${g.id}: ${g.commits.length} commits == ${declared} declaring subjects (diff 0)`);
  }
  assert.equal(layout.groups.length, 2, "exactly the two attributed ids form groups");

  // (3) Pin the non-equivalence so the substring measure can never be restored as "the reconciliation":
  //     on this window it over-counts by exactly the two divergence shapes.
  const groupA = layout.groups.find((g) => g.id === "gap-a");
  assert.equal(groupA.commits.length, 6, "gap-a holds exactly its 6 declaring subjects");
  const substringCount = rows.filter((r) => r.subj.includes("gap-a")).length;
  assert.equal(substringCount, 8, "the substring measure counts the prefix collision + the prose mention");
  assert.notEqual(substringCount, groupA.commits.length, "⇒ `includes(id)` is NOT the reconciliation measure");

  // (4) The structural identity still holds over the controlled window (4 unattributed).
  assert.equal(layout.commitCount - layout.groups.reduce((s, g) => s + g.commits.length, 0), layout.unattributedCount);
  assert.equal(layout.unattributedCount, 4);
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
