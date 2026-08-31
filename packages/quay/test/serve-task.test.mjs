// @test-group product
// gap-web-task-status-reads-stale-main-checkout — the web display layer (/tasks, /board, /live) must
// read task STATUS from the develop git ref, not the manager working branch's stale disk (硬规则 4b:
// the disk is a STALE agent-proxy). A task landed on develop as `done` whose main-checkout disk still
// says `ready` must render done (AC1); a task whose status is identical in both, or absent from
// develop, must render unchanged (AC2); the develop read must be an object-store read (git show /
// ls-tree / cat-file), never a `git checkout develop` / `git worktree add` (AC3); the many-task list
// must use the batched reader + TTL cache, not per-task git show (AC4).
//
// Run (scoped): node --test packages/quay/test/serve-task.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { handleTaskList, handleTaskDetail } from "../src/serve-task.ts";
import { readTaskStatusMapAtRef, readTaskStatusAtRef, readTaskTitleMapAtRef, readTaskCommitTimesAtRef, clearTaskStatusRefCache } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, "..", "src");

/** Build a repo where the develop ref and the working tree DISAGREE on `gap-stale`'s status:
 *  develop = done (landed + flip-done), working tree = ready (stale manager branch). `gap-fresh`
 *  is `ready` in BOTH (the AC2 negative control). */
function makeStaleRepo(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const writeTask = (id, status) => fs.writeFileSync(
    path.join(tasksDir, `${id}.md`),
    `---\nid: ${id}\nstatus: ${status}\n---\n## Proposal\nproposal body for ${id}\n`,
  );
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeTask("gap-stale", "done");
  writeTask("gap-fresh", "ready");
  git("add", ".");
  git("commit", "-q", "-m", "develop: gap-stale done, gap-fresh ready");
  git("checkout", "-q", "-b", "manager-stale");
  writeTask("gap-stale", "ready"); // the stale branch rewrites it back to ready
  git("add", ".");
  git("commit", "-q", "-m", "manager-stale: reset gap-stale to ready");
  return { root, tasksDir };
}

/** A task in the Provider ABI view-model shape the list route consumes. */
function task(id, status) {
  return { id, title: `title ${id}`, status, role: "primitive", labels: [], parent: null, children: [], body: `## Proposal\nbody for ${id}\n`, extra: {} };
}

/** Drive handleTaskList with a mock Provider client (returning the DISK view — the stale status) and
 *  a capture `res`; the develop override is what the assertions check. */
async function renderList(root, tasks) {
  const client = { taskList: async () => ({ tasks, malformed: [] }) };
  let body = "";
  const res = { writeHead: () => {}, end: (chunk) => { body = chunk; } };
  const url = new URL("http://localhost/tasks");
  const manifest = { name: "test", id: "native" };
  await handleTaskList({}, res, url, client, manifest, { workspaceRoot: root });
  return body;
}

/** Extract the status cell text of the row whose id link reads `id`. The capture stops at the first
 *  `<` so a divergence marker (`done<span …> ⚠ disk:ready</span>`) still reads as its leading
 *  displayed status (`done`), the value this helper's assertions are about. */
function statusCell(body, id) {
  const m = body.match(new RegExp(`${id}<\\/a><\\/td>\\s*<td>([^<]*)`));
  return m ? m[1] : null;
}

/** Extract the first `<td class="col-updated">` cell text (the list's updated column). */
function updatedCell(body) {
  const m = body.match(/<td class="col-updated">([^<]*)<\/td>/);
  return m ? m[1] : null;
}

/** Drive handleTaskDetail with a mock Provider client returning the DISK view (`diskTask`); the
 *  develop-first override is what the assertions check. */
async function renderDetail(root, taskId, diskTask) {
  const client = { taskGet: async () => diskTask };
  let body = "";
  const res = { writeHead: () => {}, end: (chunk) => { body = chunk; } };
  const url = new URL(`http://localhost/task/${taskId}`);
  await handleTaskDetail({}, res, url, taskId, client, { workspaceRoot: root });
  return body;
}

test("AC1 — /tasks renders the develop status (done), not the stale disk status (ready)", async () => {
  const { root } = makeStaleRepo("stale-list-");
  try {
    clearTaskStatusRefCache();
    // Prove the fixture is falsifiable: develop=done, the working tree=ready.
    assert.equal(readTaskStatusAtRef(root, "develop", "gap-stale"), "done", "develop ref carries done");
    assert.match(fs.readFileSync(path.join(root, "tasks", "gap-stale.md"), "utf8"), /^status:\s*ready/m, "working tree carries ready");
    const body = await renderList(root, [task("gap-stale", "ready"), task("gap-fresh", "ready")]);
    assert.equal(statusCell(body, "gap-stale"), "done", "AC1: gap-stale renders done (⛔ 仍 ready ⇒ 假)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — a task whose status is identical in develop and disk (or absent from develop) renders unchanged", async () => {
  const { root, tasksDir } = makeStaleRepo("stale-fresh-");
  try {
    clearTaskStatusRefCache();
    // gap-disk-only lives only on disk (never committed to develop) — the fail-open fallback must
    // keep its disk-read status rather than drop or fabricate one.
    fs.writeFileSync(path.join(tasksDir, "gap-disk-only.md"), "---\nid: gap-disk-only\nstatus: ready\n---\n## Proposal\nbody\n");
    const body = await renderList(root, [task("gap-fresh", "ready"), task("gap-stale", "ready"), task("gap-disk-only", "ready")]);
    assert.equal(statusCell(body, "gap-fresh"), "ready", "AC2: gap-fresh (ready in both) renders ready unchanged");
    assert.equal(statusCell(body, "gap-disk-only"), "ready", "AC2: a disk-only task keeps its disk status (fail-open, not dropped)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — the develop read is object-store only (no `git checkout` / `git worktree add` in the changed modules)", () => {
  for (const f of ["serve-task.ts", "serve-board.ts", "observation.ts"]) {
    const src = fs.readFileSync(path.join(SRC_DIR, f), "utf8");
    assert.doesNotMatch(src, /git\s+checkout/, `${f}: must not git checkout (the develop read is object-store only, never blocks fan-in)`);
    assert.doesNotMatch(src, /git\s+worktree\s+add/, `${f}: must not git worktree add`);
  }
});

test("AC4 — the many-task read is batched (one map) and TTL-cached, not per-task git show", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stale-batch-"));
  try {
    const tasksDir = path.join(root, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-b", "develop", "-q", ".");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    const N = 400;
    for (let i = 0; i < N; i++) {
      const id = `gap-batch-${i}`;
      const status = i % 2 === 0 ? "done" : "ready";
      fs.writeFileSync(path.join(tasksDir, `${id}.md`), `---\nid: ${id}\nstatus: ${status}\n---\n## Proposal\nbody ${i}\n`);
    }
    git("add", ".");
    git("commit", "-q", "-m", "batch fixture");
    clearTaskStatusRefCache();
    const m1 = readTaskStatusMapAtRef(root, "develop");
    assert.equal(m1.size, N, "batched read returns all N statuses in one map");
    assert.equal(m1.get("gap-batch-0"), "done");
    assert.equal(m1.get("gap-batch-1"), "ready");
    // Cache: a second read within the TTL returns the SAME map instance (no re-read).
    assert.equal(readTaskStatusMapAtRef(root, "develop"), m1, "TTL cache returns the same map instance (no re-read)");
    // force bypasses the cache — proving the cache is real, not a no-op.
    const m3 = readTaskStatusMapAtRef(root, "develop", { force: true });
    assert.notEqual(m3, m1, "force re-reads (the cache is real)");
    assert.equal(m3.size, N);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-dispatch-reads-stale-main-checkout-task-status (AC1/AC2/AC3) — the read-face unification
// beyond the status-only fix: the /task/<id> DETAIL page reads develop first (kills list=done/
// detail=ready), the `updated` column reads the develop last-commit time (not the disk mtime), and a
// disk≠develop divergence renders a visible marker on BOTH the list and the detail page.

test("AC1 — /task/<id> detail renders the develop status, not the stale disk status (list & detail agree)", async () => {
  const { root } = makeStaleRepo("stale-detail-");
  try {
    clearTaskStatusRefCache();
    const body = await renderDetail(root, "gap-stale", task("gap-stale", "ready"));
    // The h1 status bracket opens with the develop value `done`; the stale disk `ready` only appears
    // as the divergence marker (`⚠ disk:ready`), never as the displayed status (the marker sits
    // between the status and the closing bracket, so the displayed value is `[done`, not `[done]`).
    assert.match(body, /\[done/, "AC1: detail h1 shows develop done (⛔ 仍 [ready ⇒ 假)");
    assert.doesNotMatch(body, /\[ready/, "AC1: the stale disk ready must not be the displayed status");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — the updated column renders the develop last-commit time, not the disk mtime (a disk write after the flip does not move it)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stale-updated-"));
  try {
    const tasksDir = path.join(root, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const writeTask = (id, status) => fs.writeFileSync(path.join(tasksDir, `${id}.md`), `---\nid: ${id}\nstatus: ${status}\n---\n## Proposal\nbody\n`);
    git("init", "-b", "develop", "-q", ".");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeTask("gap-stale", "done");
    // Pin the develop commit 25h ago — so its relative time is "1d ago", stable against ±seconds
    // drift. Whole-second: git `%cI` is second-precision, so the pinned ISO must be too (a
    // millisecond fraction would make `Date.parse(pinned)` ≠ `Date.parse(%cI)`).
    const pinnedMs = Math.floor(Date.now() / 1000) * 1000 - 25 * 3600 * 1000;
    const pinned = new Date(pinnedMs).toISOString();
    execFileSync("git", ["add", "-A"], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: pinned, GIT_COMMITTER_DATE: pinned } });
    execFileSync("git", ["commit", "-q", "-m", "flip done"], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: pinned, GIT_COMMITTER_DATE: pinned } });
    // A post-flip disk write (bump mtime + stale ready) must NOT move the displayed updated.
    writeTask("gap-stale", "ready");
    clearTaskStatusRefCache();

    // Falsifiability: develop carries the pinned time; the disk mtime is "now" (≈0s ago), far later.
    assert.equal(readTaskCommitTimesAtRef(root, "develop").get("gap-stale"), Date.parse(pinned), "develop last-commit time = pinned");
    assert.ok(fs.statSync(path.join(tasksDir, "gap-stale.md")).mtimeMs > Date.parse(pinned), "disk mtime is after the develop commit");

    const body = await renderList(root, [task("gap-stale", "ready")]);
    const cell = updatedCell(body);
    assert.equal(cell, "1d ago", "AC2: updated renders the develop time (⛔ 0s ago ⇒ 跟 disk mtime 假)");

    // The detail page's `last updated` reads the SAME develop time (list & detail agree).
    const detailBody = await renderDetail(root, "gap-stale", task("gap-stale", "ready"));
    assert.match(detailBody, /last updated: 1d ago/, "AC2: detail last updated renders the develop time, not the bumped disk mtime");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — divergence marker renders when disk ≠ develop (status or title), absent when they agree", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stale-diverge-"));
  try {
    const tasksDir = path.join(root, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const writeTask = (id, status, title) => fs.writeFileSync(path.join(tasksDir, `${id}.md`), `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n---\n## Proposal\nbody\n`);
    git("init", "-b", "develop", "-q", ".");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeTask("gap-a", "done", "develop title a");
    writeTask("gap-same", "ready", "same title");
    git("add", ".");
    git("commit", "-q", "-m", "develop state");
    // Uncommitted disk divergence: status ready (≠ done) + title "disk title a" (≠ "develop title a").
    // gap-same is left untouched — disk == develop ⇒ no marker (negative control).
    writeTask("gap-a", "ready", "disk title a");
    clearTaskStatusRefCache();

    const diskA = { id: "gap-a", title: "disk title a", status: "ready", role: "primitive", labels: [], parent: null, children: [], body: "## Proposal\nbody\n", extra: {} };
    const diskSame = { id: "gap-same", title: "same title", status: "ready", role: "primitive", labels: [], parent: null, children: [], body: "## Proposal\nbody\n", extra: {} };

    // List: both markers present on the diverged row; the converged row carries none.
    const list = await renderList(root, [diskA, diskSame]);
    assert.match(list, /data-divergence="status"> ⚠ disk:ready/, "AC3: list status marker names the disk value");
    assert.match(list, /data-divergence="title"> ⚠ develop:develop title a/, "AC3: list title marker names the develop value");
    // Precise negative control: the converged row renders NO divergence marker at all.
    const sameRow = list.match(/gap-same<\/a>[\s\S]*?<\/tr>/);
    assert.ok(sameRow, "gap-same row present");
    assert.doesNotMatch(sameRow[0], /data-divergence/, "AC3: converged row has no divergence marker");

    // Detail: the same markers appear on the diverged task's detail page.
    const detail = await renderDetail(root, "gap-a", diskA);
    assert.match(detail, /data-divergence="status"> ⚠ disk:ready/, "AC3: detail status marker names the disk value");
    assert.match(detail, /data-divergence="title"> ⚠ develop:develop title a/, "AC3: detail title marker names the develop value");
    assert.doesNotMatch(detail, /\[ready\]/, "AC3: detail displayed status is develop done, the stale ready is only the marker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
