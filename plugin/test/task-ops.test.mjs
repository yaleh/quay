// @test-group engine
// task-ops.test.mjs — gap-task-ops-consolidate-driver-frontmatter-writers: the loop/driver layer's
// single library owning "parse task frontmatter, mutate a field, commit it". The three real call sites
// (driver-filters.ts / worker-driver.ts / ready-pool-check.ts) import this surface instead of each
// carrying its own regex parse + git add/commit. This test pins the SURFACE directly (the behavior-
// preserving migration of the call sites is pinned by driver-filters.test.mjs / worker-driver*.test.mjs
// / ready-pool-check.test.mjs, which run unmodified).
//
// Run: scripts/test.sh plugin/test/task-ops.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  splitTaskFile,
  statusFromFrontmatter,
  patchStatusField,
  ensureDeliveryCriticalLabel,
  isInsideGitWorkTree,
  commitTaskFile,
  hasPriorCommit,
} from "../scripts/task-ops.ts";

const FRONTMATTER = (status) => `id: gap-x\ntitle: x\nstatus: ${status}\nlabels:\n  - gap\nparent: null\n`;
const FULL = (status, body = "## Proposal\n\nprose\n") => `---\n${FRONTMATTER(status)}\n---\n${body}`;

// ── splitTaskFile ────────────────────────────────────────────────────────────────────────────────

test("splitTaskFile — splits frontmatter/body preserving the exact fences (byte-for-byte recombine)", () => {
  const text = FULL("todo");
  const s = splitTaskFile(text);
  assert.ok(s, "has frontmatter fence");
  assert.equal(s.open, "---\n");
  assert.equal(s.close, "\n---");
  assert.match(s.frontmatterRaw, /^id: gap-x$/m, "frontmatterRaw is the block between fences");
  assert.match(s.body, /^## Proposal/m, "body is everything after the fence");
  assert.equal(`${s.open}${s.frontmatterRaw}${s.close}${s.body}`, text, "recombines byte-identically");
});

test("splitTaskFile — CRLF fences and no-fence ⇒ null", () => {
  const crlf = `---\r\nid: a\r\nstatus: todo\r\n---\r\n\r\nbody`;
  const s = splitTaskFile(crlf);
  assert.ok(s);
  assert.equal(s.open, "---\r\n");
  assert.equal(s.close, "\r\n---");
  assert.equal(splitTaskFile("no frontmatter here\n## body\n"), null, "no fence ⇒ null");
});

// ── statusFromFrontmatter ────────────────────────────────────────────────────────────────────────

test("statusFromFrontmatter — reads the status scalar via the single parser; absent ⇒ null", () => {
  assert.equal(statusFromFrontmatter(FRONTMATTER("ready")), "ready");
  assert.equal(statusFromFrontmatter(FRONTMATTER("done")), "done");
  assert.equal(statusFromFrontmatter("id: a\ntitle: b\n"), null, "no status ⇒ null (缺值 = 未查)");
});

// ── patchStatusField ─────────────────────────────────────────────────────────────────────────────

test("patchStatusField — replaces the status value, preserving every other byte", () => {
  const fm = FRONTMATTER("todo");
  const r = patchStatusField(fm, "ready");
  assert.equal(r.ok, true);
  assert.equal(r.from, "todo");
  assert.equal(r.replaced, true);
  assert.match(r.fm, /^status: ready$/m, "status line rewritten");
  assert.match(r.fm, /^id: gap-x$/m, "id preserved");
  assert.match(r.fm, /^labels:$/m, "labels block preserved");
  assert.match(r.fm, /^parent: null$/m, "parent preserved");
  assert.equal((r.fm.match(/status:/g) || []).length, 1, "exactly one status line (no body clobber)");
});

test("patchStatusField — fromStatus mismatch ⇒ no-op (replaced:false, unchanged bytes)", () => {
  const fm = FRONTMATTER("ready");
  const r = patchStatusField(fm, "ready", "todo");
  assert.equal(r.ok, true);
  assert.equal(r.replaced, false, "not todo ⇒ no-op (setTaskStatus stale-ready reconcile)");
  assert.equal(r.fm, fm, "byte-unchanged");
  assert.equal(r.from, "ready");
});

test("patchStatusField — no status line ⇒ fail-closed (ok:false)", () => {
  const r = patchStatusField("id: a\ntitle: b\n", "done");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-status-line");
});

// ── ensureDeliveryCriticalLabel (moved from ready-pool-check.ts; behavior pinned there) ───────────

test("ensureDeliveryCriticalLabel — adds the label to a block list (smoke)", () => {
  const r = ensureDeliveryCriticalLabel("id: x\nlabels:\n  - gap\nparent: null\n");
  assert.equal(r.added, true);
  assert.equal(r.deliveryCritical, true);
  assert.match(r.fm, /labels:\n  - gap\n  - delivery-critical/);
});

test("ensureDeliveryCriticalLabel — idempotent when already present", () => {
  const fm = "id: x\nlabels:\n  - gap\n  - delivery-critical\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.added, false);
  assert.equal(r.fm, fm, "byte-unchanged");
});

// ── commit primitive (commitTaskFile / hasPriorCommit / isInsideGitWorkTree) ─────────────────────

function makeGitRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `task-ops-git-${tag}-`));
  execFileSync("git", ["init", "-q", dir]);
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "task-ops-test");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return { dir, git };
}

test("commitTaskFile — repo-less dir ⇒ no-op false (not a throw)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-ops-norepo-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(commitTaskFile(dir, "tasks/x.md", "m"), false, "repo-less ⇒ false");
  assert.equal(isInsideGitWorkTree(dir), false);
});

test("commitTaskFile — commits the single task file pathspec-limited (⛔ 裸 commit 扫共享索引)", (t) => {
  const { dir, git } = makeGitRoot("commit");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "tasks", "gap-a.md"), FULL("ready"), "utf8");
  git("add", "--", "tasks/gap-a.md");
  git("commit", "-q", "-m", "baseline");
  // Another layer staged an unrelated file into the shared index.
  fs.writeFileSync(path.join(dir, "other.md"), "other\n", "utf8");
  git("add", "--", "other.md");
  // A real status flip on the task file (so there is something to commit).
  fs.writeFileSync(path.join(dir, "tasks", "gap-a.md"), FULL("done"), "utf8");

  assert.equal(commitTaskFile(dir, path.join("tasks", "gap-a.md"), "tasks: gap-a flip"), true);
  assert.match(git("log", "-1", "--format=%s").trim(), /flip/);
  assert.match(git("status", "--porcelain"), /^A  other\.md$/m, "other.md still staged (not swept)");
  assert.doesNotMatch(git("status", "--porcelain"), /tasks\/gap-a\.md/, "task file committed, not dirty");
});

test("hasPriorCommit — false for a never-committed file, true after commit (首次登记 judgment)", (t) => {
  const { dir, git } = makeGitRoot("prior");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "tasks", "gap-a.md"), FULL("todo"), "utf8");
  assert.equal(hasPriorCommit(dir, path.join("tasks", "gap-a.md")), false, "never committed ⇒ false");
  git("add", "--", "tasks/gap-a.md");
  git("commit", "-q", "-m", "baseline");
  assert.equal(hasPriorCommit(dir, path.join("tasks", "gap-a.md")), true, "committed ⇒ true");
});
