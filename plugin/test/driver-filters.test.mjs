// @test-group engine
// driver-filters.test.mjs — AC152 (tasks/gap-ac152-filter-composable-predicate-list): the dispatch-pre-
// filter is a COMPOSABLE PREDICATE LIST shared by the two task-processing drivers (worker / promotion),
// not a per-kind private branch. The five predicates (notInFlight / depsSatisfied / touchesDisjoint /
// retryCapNotExhausted / notNeedsHuman) are elements of ONE list (TASK_FILTERS); both drivers consume it
// via applyTaskFilters. AC1 falsifiable: adding a new predicate to BOTH drivers must be a ONE-place change
// (append to TASK_FILTERS); if it required editing both driver files ⇒ false.
//
// Run: scripts/test.sh plugin/test/driver-filters.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  TASK_FILTERS,
  applyTaskFilters,
  makeFilterContext,
  allDepsDone,
  readTaskStatus,
  markNeedsHuman,
  WORKER_OUTCOME_REL,
  propagateDocBranchToDevelop,
  resolveStatusPriority,
  DOC_DEVELOP_SYNC_EVENT_REL,
  STATUS_PRIORITY,
} from "../scripts/driver-filters.ts";
import { readTaskStatus as workerReadTaskStatus } from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `driver-filters-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return dir;
}

/** 写一个任务文件（fm = frontmatter 文本，body 可选，缺省给一个带【每任务唯一】## Touches 的合法 body）。 */
function writeTask(root, id, fm, body) {
  const b = body ?? `## Proposal\n\nprose\n\n## Touches\n\n- plugin/scripts/own-${id}.ts\n`;
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${b}`, "utf8");
}

const ctx = (root, overrides = {}) => makeFilterContext(root, overrides);

/** 跑一条 git 命令（cwd=root，编码 utf8，非零退出抛错）。 */
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** 建一个可提交的 git 临时仓库（git init + user 身份 + tasks/ 目录）。 */
function makeGitRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `driver-filters-git-${tag}-`));
  execFileSync("git", ["init", "-q", dir]);
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "driver-filters-test");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return dir;
}

// ── AC1：五个谓词是一个列表里的元素 ──────────────────────────────────────────────────────────────

test("AC1 — TASK_FILTERS is the single list of the five composable predicates", () => {
  assert.deepEqual(
    TASK_FILTERS.map((f) => f.name),
    ["notInFlight", "depsSatisfied", "touchesDisjoint", "retryCapNotExhausted", "notNeedsHuman"],
    "五个谓词是一个列表里的元素（顺序固定，取假：缺任一名或散落他处 ⇒ 假）",
  );
  assert.equal(new Set(TASK_FILTERS.map((f) => f.name)).size, TASK_FILTERS.length, "names are unique");
});

test("AC1 — worker-driver re-exports the SAME readTaskStatus（两 driver 共用单一实现，非平行副本）", async () => {
  assert.equal(workerReadTaskStatus, readTaskStatus, "worker re-export is the driver-filters function (identity)");
});

// ── allDepsDone ──────────────────────────────────────────────────────────────────────────────────

test("allDepsDone — empty deps ⇒ true; all done ⇒ true; any not-done/missing ⇒ false", () => {
  assert.equal(allDepsDone([], () => null), true, "empty deps = 真无依赖 (not 读不懂)");
  assert.equal(allDepsDone(["a"], (id) => "done"), true);
  assert.equal(allDepsDone(["a", "b"], (id) => (id === "a" ? "done" : "ready")), false, "not-done dep blocks");
  assert.equal(allDepsDone(["a"], () => null), false, "missing dep (statusOf → null) ⇒ fail-closed");
});

// ── notInFlight ─────────────────────────────────────────────────────────────────────────────────

test("notInFlight — filters the in-flight ids, keeps the rest", () => {
  const p = TASK_FILTERS[0].predicate(ctx("/none", { inFlight: ["gap-a", "gap-b"] }));
  assert.equal(p("gap-a"), false);
  assert.equal(p("gap-b"), false);
  assert.equal(p("gap-c"), true);
});

// ── depsSatisfied ───────────────────────────────────────────────────────────────────────────────

test("depsSatisfied — no deps ⇒ true; all done ⇒ true; not-done ⇒ false; missing dep ⇒ false; unreadable ⇒ false", (t) => {
  const root = makeRoot("deps");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pred = TASK_FILTERS[1].predicate(ctx(root));
  const write = (id, fm) => fs.writeFileSync(path.join(root, "tasks", `${id}.md`), fm);

  write("gap-none", "---\nid: gap-none\nstatus: ready\n---\n\nbody\n");
  assert.equal(pred("gap-none"), true, "no depends_on ⇒ true (真无依赖)");

  write("gap-prereq", "---\nid: gap-prereq\nstatus: done\n---\n\nbody\n");
  write("gap-ok", "---\nid: gap-ok\nstatus: ready\ndepends_on:\n  - gap-prereq\n---\n\nbody\n");
  assert.equal(pred("gap-ok"), true, "dep done ⇒ true");

  write("gap-prereq2", "---\nid: gap-prereq2\nstatus: ready\n---\n\nbody\n");
  write("gap-blocked", "---\nid: gap-blocked\nstatus: ready\ndepends_on:\n  - gap-prereq2\n---\n\nbody\n");
  assert.equal(pred("gap-blocked"), false, "dep not done ⇒ false");

  write("gap-missing-dep", "---\nid: gap-missing-dep\nstatus: ready\ndepends_on:\n  - gap-no-such\n---\n\nbody\n");
  assert.equal(pred("gap-missing-dep"), false, "dep file missing ⇒ false");

  assert.equal(pred("gap-no-such-candidate"), false, "candidate file missing ⇒ fail-closed");

  write("gap-flow", "---\nid: gap-flow\nstatus: ready\ndepends_on: [gap-prereq, gap-prereq2]\n---\n\nbody\n");
  assert.equal(pred("gap-flow"), false, "flow form: any not-done dep blocks");
});

// ── touchesDisjoint ─────────────────────────────────────────────────────────────────────────────

test("touchesDisjoint — overlapping candidate filtered vs in-flight; disjoint kept; unreadable ⇒ conservative", (t) => {
  const root = makeRoot("touches");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (id, touchesLine) => fs.writeFileSync(
    path.join(root, "tasks", `${id}.md`),
    `---\nid: ${id}\nstatus: ready\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n- ${touchesLine}\n`,
    "utf8",
  );
  write("gap-a", "plugin/scripts/foo.ts");
  write("gap-b", "plugin/scripts/foo.ts"); // overlaps gap-a
  write("gap-c", "plugin/scripts/bar.ts"); // disjoint from both

  const noInFlight = TASK_FILTERS[2].predicate(ctx(root, { inFlight: [] }));
  assert.equal(noInFlight("gap-b"), true, "no in-flight ⇒ no conflict ⇒ pass");

  const pred = TASK_FILTERS[2].predicate(ctx(root, { inFlight: ["gap-a"] }));
  assert.equal(pred("gap-b"), false, "overlapping gap-b filtered");
  assert.equal(pred("gap-c"), true, "disjoint gap-c kept");
  assert.equal(pred("gap-zzz"), false, "unreadable candidate ⇒ conservative serialize");
});

// ── retryCapNotExhausted ────────────────────────────────────────────────────────────────────────

test("retryCapNotExhausted — filters the retry-exhausted ids", () => {
  const pred = TASK_FILTERS[3].predicate(ctx("/none", { retryExhausted: new Set(["gap-a"]) }));
  assert.equal(pred("gap-a"), false);
  assert.equal(pred("gap-b"), true);
});

// ── notNeedsHuman ───────────────────────────────────────────────────────────────────────────────

test("notNeedsHuman — filters needs-human status; unreadable ⇒ fail-closed", (t) => {
  const root = makeRoot("nh");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pred = TASK_FILTERS[4].predicate(ctx(root));
  writeTask(root, "gap-ready", "---\nid: gap-ready\nstatus: ready\n---");
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: needs-human\n---");
  assert.equal(pred("gap-ready"), true, "ready status ⇒ not needs-human");
  assert.equal(pred("gap-nh"), false, "needs-human status ⇒ filtered");
  assert.equal(pred("gap-missing"), false, "unreadable ⇒ fail-closed (读不懂 ≠ 合格)");
});

// ── applyTaskFilters ────────────────────────────────────────────────────────────────────────────

test("applyTaskFilters — full list: a candidate failing ANY predicate is filtered; passing all is kept", (t) => {
  const root = makeRoot("apply");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 六个候选，各命中一个谓词（唯 gap-ok 全过）：
  writeTask(root, "gap-ok", "---\nid: gap-ok\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/ok.ts\n");
  writeTask(root, "gap-inflight", "---\nid: gap-inflight\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/inflight.ts\n");
  writeTask(root, "gap-overlap", "---\nid: gap-overlap\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/inflight.ts\n"); // touchesDisjoint fails
  writeTask(root, "gap-dep", "---\nid: gap-dep\nstatus: ready\ndepends_on:\n  - gap-blocker\n---", "## Touches\n\n- plugin/scripts/dep.ts\n"); // depsSatisfied fails
  writeTask(root, "gap-blocker", "---\nid: gap-blocker\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/blocker.ts\n");
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: needs-human\n---", "## Touches\n\n- plugin/scripts/nh.ts\n"); // notNeedsHuman fails
  writeTask(root, "gap-exhausted", "---\nid: gap-exhausted\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/exhausted.ts\n"); // retryCapNotExhausted fails

  const c = ctx(root, { inFlight: ["gap-inflight"], retryExhausted: new Set(["gap-exhausted"]) });
  assert.deepEqual(
    applyTaskFilters(["gap-ok", "gap-inflight", "gap-overlap", "gap-dep", "gap-nh", "gap-exhausted"], c),
    ["gap-ok"],
    "only the candidate passing all five predicates is kept",
  );
});

test("applyTaskFilters — named subset: promotion fix-pass applies only retryCap/needs-human (deps/touches NOT re-filtered)", (t) => {
  const root = makeRoot("subset");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A dep-blocked (deps-not-ready) candidate: the promotion fix-pass must NOT drop it via depsSatisfied —
  // it stays for the AC134 skip ledger (ready-pool-check already classified depsReady=false as unfixable).
  writeTask(root, "gap-dep", "---\nid: gap-dep\nstatus: todo\ndepends_on:\n  - gap-missing\n---");
  writeTask(root, "gap-exhausted", "---\nid: gap-exhausted\nstatus: todo\n---");

  const c = ctx(root, { retryExhausted: new Set(["gap-exhausted"]) });
  const names = ["retryCapNotExhausted", "notNeedsHuman"];
  assert.deepEqual(
    applyTaskFilters(["gap-dep", "gap-exhausted"], c, names),
    ["gap-dep"],
    "deps-not-ready NOT re-filtered (kept for skip ledger); retry-exhausted filtered",
  );
});

test("applyTaskFilters — empty candidates ⇒ empty; empty list ⇒ all kept (identity on names=[])", () => {
  assert.deepEqual(applyTaskFilters([], ctx("/none")), []);
  assert.deepEqual(applyTaskFilters(["gap-a", "gap-b"], ctx("/none"), []), ["gap-a", "gap-b"]);
});

// ── readTaskStatus ──────────────────────────────────────────────────────────────────────────────

test("readTaskStatus — reads status; missing/unreadable ⇒ null", (t) => {
  const root = makeRoot("status");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-done", "---\nid: gap-done\nstatus: done\n---");
  assert.equal(readTaskStatus(root, "gap-done"), "done");
  assert.equal(readTaskStatus(root, "gap-missing"), null);
});

// ── markNeedsHuman commit-after-write（gap-mark-needs-human-commit-after-write）────────────────────

test("AC4 — markNeedsHuman in a repo-less temp dir is a commit no-op (committed:false, no throw)", (t) => {
  const root = makeRoot("nh-norepo");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: todo\n---");
  const res = markNeedsHuman(root, "gap-nh", "test reason");
  assert.equal(res.ok, true, "status flip still lands on disk");
  assert.equal(res.committed, false, "repo-less ⇒ commit no-op (not a throw)");
  assert.ok(
    fs.readFileSync(path.join(root, "tasks", "gap-nh.md"), "utf8").includes("status: needs-human"),
    "the flip itself is written even though the commit is a no-op",
  );
});

test("AC1 — markNeedsHuman commits the flipped task file (⛔ 翻转后 git status 仍 M ⇒ 假)", (t) => {
  const root = makeGitRoot("ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: ready\n---");
  git(root, "add", "--", "tasks/gap-nh.md");
  git(root, "commit", "-q", "-m", "baseline");

  const res = markNeedsHuman(root, "gap-nh", "reason");
  assert.equal(res.ok, true);
  assert.equal(res.committed, true, "commit landed");
  const status = git(root, "status", "--porcelain");
  assert.equal(status.trim(), "", `tree clean after flip: ${JSON.stringify(status)}`);
  assert.match(git(root, "log", "--oneline", "-1"), /needs-human/, "the flip is a commit in the log");
});

test("AC2 — commit is pathspec-limited: a pre-staged unrelated file stays staged (⛔ 裸 commit 扫共享索引 ⇒ 假)", (t) => {
  const root = makeGitRoot("ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: ready\n---");
  git(root, "add", "--", "tasks/gap-nh.md");
  git(root, "commit", "-q", "-m", "baseline");
  // 模拟另一层已 stage 进共享索引的文件（git add 不 commit）。
  fs.writeFileSync(path.join(root, "other.md"), "other\n", "utf8");
  git(root, "add", "--", "other.md");

  const res = markNeedsHuman(root, "gap-nh", "reason");
  assert.equal(res.committed, true);
  const status = git(root, "status", "--porcelain");
  assert.match(status, /^A  other\.md$/m, `other.md still staged (not swept by the commit): ${JSON.stringify(status)}`);
  assert.doesNotMatch(status, /tasks\/gap-nh\.md/, "task file is committed, not left dirty");
});

test("AC3 — propagateDocBranchToDevelop: a flip on the doc branch reaches develop (⛔ 只提交 doc 分支不 ff ⇒ 假)", (t) => {
  const root = makeGitRoot("ac3");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: ready\n---");
  git(root, "add", "--", "tasks/gap-nh.md");
  git(root, "commit", "-q", "-m", "baseline");
  // develop 停在 baseline；主检出在 doc 分支 main/manager-doc 上翻转。
  git(root, "branch", "develop");
  git(root, "checkout", "-q", "-b", "main/manager-doc");

  const res = markNeedsHuman(root, "gap-nh", "reason");
  assert.equal(res.committed, true);
  assert.match(
    git(root, "show", "develop:tasks/gap-nh.md"),
    /^status: needs-human$/m,
    "develop sees the flipped status (propagateDocBranchToDevelop ran)",
  );
});

// ── needs-human 注记携带实际失败步（gap-needs-human-note-carries-step-verdict）─────────────────────

test("AC2 (能取假) — needs-human 注记含 step+verdict 非纯模板（⛔ 仍只有模板句 ⇒ 假）", (t) => {
  const root = makeRoot("nh-step");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: ready\n---");
  // 最近一条 exited-not-landed 记录带 mechanical_fan_in.step + reason（= verdict.summary）。
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, WORKER_OUTCOME_REL), JSON.stringify({
    ts: new Date().toISOString(), task: "gap-nh", final_state: "exited-not-landed",
    failure_reason: "task status=ready not done",
    mechanical_fan_in: { outcome: "red", step: "suite", reason: "full-suite-runner.test.mjs:4889 ENOTEMPTY" },
  }) + "\n", "utf8");

  const res = markNeedsHuman(root, "gap-nh", "worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）");
  assert.equal(res.ok, true);
  const body = fs.readFileSync(path.join(root, "tasks", "gap-nh.md"), "utf8");
  assert.match(body, /失败步\/判词：step=suite/, "AC2: 注记带失败步名 step=suite（⛔ 仍只有模板句 ⇒ 假）");
  assert.match(body, /full-suite-runner\.test\.mjs:4889 ENOTEMPTY/, "AC2: 注记带判词/summary（改掉任一 ⇒ 红）");
});

test("AC2 (负控制) — 无 exited-not-landed 记录 ⇒ 不追加「失败步/判词」行（与旧行为同形，⛔ 不伪造成有失败步）", (t) => {
  const root = makeRoot("nh-nostep");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: ready\n---");
  const res = markNeedsHuman(root, "gap-nh", "worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）");
  assert.equal(res.ok, true);
  const body = fs.readFileSync(path.join(root, "tasks", "gap-nh.md"), "utf8");
  assert.doesNotMatch(body, /失败步\/判词/, "AC2 负控制: no step line when no outcome record");
});

// ── doc↔develop 同步（gap-doc-develop-sync-semantic-conflict-resolution）──────────────────────────

test("AC2 — resolveStatusPriority: 分叉状态取确定性优先级 done>needs-human>ready>todo（无 LLM）", () => {
  assert.equal(resolveStatusPriority("done", "todo"), "done", "develop done / doc todo → done");
  assert.equal(resolveStatusPriority("todo", "done"), "done", "doc done / develop todo → done（对称，取更前进）");
  assert.equal(resolveStatusPriority("ready", "needs-human"), "needs-human", "needs-human > ready");
  assert.equal(resolveStatusPriority("todo", "ready"), "ready", "ready > todo");
  assert.equal(resolveStatusPriority("done", "needs-human"), "done", "done > needs-human");
  assert.equal(resolveStatusPriority(null, "done"), "done", "一侧读不懂 ⇒ 用另一侧");
  assert.equal(resolveStatusPriority("garbage", "todo"), "todo", "非四态 ⇒ 忽略");
  assert.equal(resolveStatusPriority(null, "garbage"), null, "都读不懂 ⇒ null");
});

test("AC2 — resolveStatusPriority 是确定性纯函数 + STATUS_PRIORITY 序固定", () => {
  assert.equal(STATUS_PRIORITY.join(","), "todo,ready,needs-human,done", "优先级序固定（done 最高）");
  assert.equal(resolveStatusPriority("ready", "todo"), resolveStatusPriority("ready", "todo"), "deterministic");
});

test("AC1 — propagateDocBranchToDevelop 返回 boolean（ff-only 成功 ⇒ true，⛔ 非 void）", (t) => {
  const root = makeGitRoot("prop-ff");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: ready\n---");
  git(root, "add", "--", "tasks/gap-a.md");
  git(root, "commit", "-q", "-m", "baseline");
  git(root, "branch", "develop");
  git(root, "checkout", "-q", "-b", "main/manager-doc");

  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: done\n---");
  git(root, "add", "--", "tasks/gap-a.md");
  git(root, "commit", "-q", "-m", "doc flip gap-a done");

  const ok = propagateDocBranchToDevelop(root);
  assert.equal(typeof ok, "boolean", "返回 boolean（非 void）");
  assert.equal(ok, true, "ff-only 成功 ⇒ true");
  assert.match(git(root, "show", "develop:tasks/gap-a.md"), /^status: done$/m, "develop 看到翻转");
});

test("AC3/AC4 — 语义兜底：分叉（develop 前进 + doc 翻转）→ merge + ff + 事件，develop-only 提交不丢", (t) => {
  const root = makeGitRoot("semantic");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: ready\n---");
  writeTask(root, "gap-b", "---\nid: gap-b\nstatus: ready\n---");
  git(root, "add", "--", "tasks/gap-a.md", "tasks/gap-b.md");
  git(root, "commit", "-q", "-m", "baseline");
  git(root, "branch", "develop");
  git(root, "checkout", "-q", "-b", "main/manager-doc");

  // develop 前进：gap-b → done（develop-only 提交）。
  git(root, "checkout", "-q", "develop");
  writeTask(root, "gap-b", "---\nid: gap-b\nstatus: done\n---");
  git(root, "add", "--", "tasks/gap-b.md");
  git(root, "commit", "-q", "-m", "develop-only: gap-b done");

  // doc 前进：gap-a → done（doc-only 翻转，ff 不成立）。
  git(root, "checkout", "-q", "main/manager-doc");
  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: done\n---");
  git(root, "add", "--", "tasks/gap-a.md");
  git(root, "commit", "-q", "-m", "doc-only: gap-a done");

  const ok = propagateDocBranchToDevelop(root);
  assert.equal(ok, true, "语义兜底成功（clean 分叉 → merge + ff）");

  // AC4：develop-only 提交仍在 develop（⛔ doc 覆盖 develop 独有 ⇒ 假）。
  assert.match(git(root, "show", "develop:tasks/gap-b.md"), /^status: done$/m, "develop-only gap-b done 不丢");
  // doc 翻转也到达 develop。
  assert.match(git(root, "show", "develop:tasks/gap-a.md"), /^status: done$/m, "doc flip gap-a done reaches develop");

  // AC3：事件落痕（ff 失败非静默）。
  const events = fs.readFileSync(path.join(root, DOC_DEVELOP_SYNC_EVENT_REL), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "doc-develop-sync-semantic"), "ff 失败已落痕 begin（非静默）");
  assert.ok(events.some((e) => e.event === "doc-develop-sync-semantic-resolved"), "语义兜底完成落痕 resolved");

  // 双向计数归 0（develop 与 doc 同步后无分叉）。
  assert.equal(git(root, "rev-list", "--count", "develop..main/manager-doc").trim(), "0", "doc 无 develop 未含提交");
  assert.equal(git(root, "rev-list", "--count", "main/manager-doc..develop").trim(), "0", "develop 无 doc 未含提交");
});

test("AC1 — 机械 ff 失败 + 语义合并冲突 ⇒ 返回 false + 冲突落痕（⛔ 静默 catch ⇒ 假）", (t) => {
  const root = makeGitRoot("prop-conflict");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code.ts"), "const x = 1;\n", "utf8");
  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: ready\n---");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "baseline");
  git(root, "branch", "develop");
  git(root, "checkout", "-q", "-b", "main/manager-doc");

  // develop 删除 code.ts；doc 修改 code.ts → modify/delete 冲突（-X theirs 不能自动消解 ⇒ merge 失败）。
  git(root, "checkout", "-q", "develop");
  git(root, "rm", "-q", "--", "code.ts");
  git(root, "commit", "-q", "-m", "develop-only: delete code.ts");
  git(root, "checkout", "-q", "main/manager-doc");
  fs.appendFileSync(path.join(root, "code.ts"), "const y = 2;\n", "utf8");
  git(root, "add", "--", "code.ts");
  git(root, "commit", "-q", "-m", "doc-only: modify code.ts");

  const ok = propagateDocBranchToDevelop(root);
  assert.equal(ok, false, "语义合并冲突 ⇒ propagate 返回 false（非静默）");
  const events = fs.readFileSync(path.join(root, DOC_DEVELOP_SYNC_EVENT_REL), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "doc-develop-sync-semantic"), "ff 失败落痕 begin");
  assert.ok(events.some((e) => e.event === "doc-develop-sync-semantic-conflict"), "冲突落痕（升级 Claude Code 语义合并）");
  // merge --abort 已把树恢复到无冲突残留态（⛔ 留 UD/冲突路径 ⇒ 假；.quay/ 事件文件是运行时落痕，非冲突残留）。
  assert.equal(git(root, "ls-files", "-u").trim(), "", "merge --abort 无 unmerged 路径残留");
});

test("AC2 — 同一任务状态冲突（develop=needs-human / doc=done）⇒ 确定性优先级回写 done（⛔ 交 LLM / 取 develop 侧 ⇒ 假）", (t) => {
  const root = makeGitRoot("status-conflict");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: ready\n---");
  git(root, "add", "--", "tasks/gap-a.md");
  git(root, "commit", "-q", "-m", "baseline");
  git(root, "branch", "develop");
  git(root, "checkout", "-q", "-b", "main/manager-doc");

  // develop 侧把 gap-a 标 needs-human（develop 权威但优先级更低）。
  git(root, "checkout", "-q", "develop");
  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: needs-human\n---");
  git(root, "add", "--", "tasks/gap-a.md");
  git(root, "commit", "-q", "-m", "develop: gap-a needs-human");

  // doc 侧把 gap-a 标 done（更前进）；两者改同一 status 行 ⇒ merge 冲突，-X theirs 会取 develop 侧。
  git(root, "checkout", "-q", "main/manager-doc");
  writeTask(root, "gap-a", "---\nid: gap-a\nstatus: done\n---");
  git(root, "add", "--", "tasks/gap-a.md");
  git(root, "commit", "-q", "-m", "doc: gap-a done");

  const ok = propagateDocBranchToDevelop(root);
  assert.equal(ok, true, "语义兜底成功（状态冲突经确定性优先级消解）");
  // done > needs-human：优先级胜者 done 落地 develop（⛔ 取 develop 侧 needs-human ⇒ 假）。
  assert.match(git(root, "show", "develop:tasks/gap-a.md"), /^status: done$/m, "确定性优先级胜者 done 落地 develop");
  const events = fs.readFileSync(path.join(root, DOC_DEVELOP_SYNC_EVENT_REL), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "doc-develop-sync-semantic-resolved"), "语义兜底完成落痕 resolved");
});
