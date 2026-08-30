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
import { handleTaskList } from "../src/serve-task.ts";
import { readTaskStatusMapAtRef, readTaskStatusAtRef, clearTaskStatusRefCache } from "../src/observation.ts";

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

/** Extract the status cell text of the row whose id link reads `id`. */
function statusCell(body, id) {
  const m = body.match(new RegExp(`${id}<\\/a><\\/td>\\s*<td>([^<]*)<\\/td>`));
  return m ? m[1] : null;
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
