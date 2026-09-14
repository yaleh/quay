// @test-group product
// store-commit.test.mjs — the FOUR bidirectional negative controls for the unified commit
// primitive (SPEC-store-commit-unification-2026-09-08 §7 / GOAL-008 AC-199). Each control must be
// able to take FALSE or it is an echo, not a measurement (hard rule 4 corollary 3):
//   ① propagate "develop" OFF  ⇒ develop does NOT receive the write (the positive control on
//      propagate "develop" proves this is falsifiable);
//   ② propagate "none" ON      ⇒ develop does NOT receive the write;
//   ③ target not in a git tree ⇒ "not-in-git", NOT "failed";
//   ④ byte-identical content   ⇒ "unchanged" AND the working tree is clean (no dirty goals/*.md —
//      a dirty file blocks develop→doc ff-only, gap-meta-commitgoalfile).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { commitStoreWrite, commitStoreBatch, storeCommitMessage, resolveCommitActor, resolveGitRoot } from "../src/store-commit.ts";
import { createGoalStore } from "../src/goal-store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `store-commit-${tag}-`));
  _tmpDirs.push(dir);
  return dir;
}

/** A REAL git repo with `develop` (one seed commit) and a checked-out `author` branch off it. */
function gitRepo(tag) {
  const dir = tmpDir(tag);
  // stderr ignored: the negative controls deliberately probe absent rev:paths, and git prints a
  // "fatal: path ... exists on disk, but not in 'develop'" hint on those (expected, not a failure).
  const run = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  run("init", "-q");
  run("config", "user.email", "t@t");
  run("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  run("checkout", "-q", "-b", "develop");
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n", "utf8");
  run("add", "seed.txt");
  run("commit", "-q", "--no-verify", "-m", "seed");
  run("checkout", "-q", "-b", "author");
  return { dir, run };
}

function refExists(run, ref, rel) {
  try {
    run("cat-file", "-e", `${ref}:${rel}`);
    return true;
  } catch {
    return false;
  }
}

test("AC-199 ① positive+negative: propagate develop reaches develop; propagate OFF does not", () => {
  const { dir, run } = gitRepo("prop-dev");
  // POSITIVE — propagate "develop" must reach develop (makes the negative falsifiable).
  fs.writeFileSync(path.join(dir, "goals", "AC-1.md"), "v1\n", "utf8");
  const on = commitStoreWrite({ relPath: "goals/AC-1.md", kind: "goals", id: "AC-1", action: "create", root: dir, propagate: "develop" });
  assert.equal(on.outcome, "committed");
  assert.equal(on.propagated, true);
  assert.ok(refExists(run, "develop", "goals/AC-1.md"), "develop received the propagated write");
  // NEGATIVE ① — propagate omitted (defaults "none"): develop must NOT receive it.
  fs.writeFileSync(path.join(dir, "goals", "AC-2.md"), "v2\n", "utf8");
  const off = commitStoreWrite({ relPath: "goals/AC-2.md", kind: "goals", id: "AC-2", action: "create", root: dir });
  assert.equal(off.outcome, "committed");
  assert.equal(off.propagated, false);
  assert.ok(refExists(run, "HEAD", "goals/AC-2.md"), "current branch (author) received the write");
  assert.equal(refExists(run, "develop", "goals/AC-2.md"), false, "develop must NOT receive a non-propagated write");
});

test("AC-199 ② propagate none: develop does NOT receive the write", () => {
  const { dir, run } = gitRepo("prop-none");
  fs.writeFileSync(path.join(dir, "goals", "AC-3.md"), "v3\n", "utf8");
  const r = commitStoreWrite({ relPath: "goals/AC-3.md", kind: "goals", id: "AC-3", action: "create", root: dir, propagate: "none" });
  assert.equal(r.outcome, "committed");
  assert.equal(r.propagated, false);
  assert.ok(refExists(run, "HEAD", "goals/AC-3.md"), "current branch received the write");
  assert.equal(refExists(run, "develop", "goals/AC-3.md"), false, "develop must NOT receive a propagate:none write");
});

test("AC-199 ③ not-in-git: a non-git dir returns not-in-git, NOT failed", () => {
  const dir = tmpDir("nogit");
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  fs.writeFileSync(path.join(dir, "goals", "AC-4.md"), "v4\n", "utf8");
  const r = commitStoreWrite({ relPath: "goals/AC-4.md", kind: "goals", id: "AC-4", action: "create", root: dir });
  assert.equal(r.outcome, "not-in-git");
  assert.equal(r.propagated, false);
});

test("AC-199 ④ unchanged: byte-identical write restores to HEAD and leaves a clean tree", () => {
  const { dir, run } = gitRepo("unchanged");
  const p = path.join(dir, "goals", "AC-5.md");
  fs.writeFileSync(p, "same content\n", "utf8");
  const first = commitStoreWrite({ relPath: "goals/AC-5.md", kind: "goals", id: "AC-5", action: "create", root: dir });
  assert.equal(first.outcome, "committed");
  // Rewrite the SAME bytes: the primitive must restore to HEAD and report "unchanged".
  fs.writeFileSync(p, "same content\n", "utf8");
  const second = commitStoreWrite({ relPath: "goals/AC-5.md", kind: "goals", id: "AC-5", action: "update", root: dir });
  assert.equal(second.outcome, "unchanged");
  assert.equal(second.propagated, false);
  // ⛔ no dirty goals/*.md left behind (a dirty file blocks develop→doc ff-only).
  assert.equal(run("status", "--porcelain", "--", "goals").trim(), "", "working tree clean after an unchanged write");
});

test("resolveGitRoot: rev-parse root inside a repo, null outside", () => {
  const { dir } = gitRepo("root");
  assert.equal(resolveGitRoot(dir), dir);
  assert.equal(resolveGitRoot(path.join(dir, "goals")), dir);
  const outside = tmpDir("outside");
  assert.equal(resolveGitRoot(outside), null);
});

// ── gap-store-commit-action-and-actor: action semantics + writer + batch + single constructor ────

test("storeCommitMessage: the `kind: id action [by actor]` grammar is a single pure renderer", () => {
  assert.equal(
    storeCommitMessage({ kind: "goals", id: "AC-1", action: "create", actor: "cli:1" }),
    "goals: AC-1 create by cli:1"
  );
  assert.equal(
    storeCommitMessage({ kind: "goals", id: "AC-1", action: "status draft→active" }),
    "goals: AC-1 status draft→active"
  );
  assert.equal(
    storeCommitMessage({ kind: "tasks", id: "x", action: "task_write", actor: "driver:r" }),
    "tasks: x task_write by driver:r"
  );
});

test("resolveCommitActor: default cli:<pid>, explicit actor and the env seam both win", () => {
  assert.match(resolveCommitActor(), /^cli:\d+$/);
  assert.equal(resolveCommitActor("driver:run-1"), "driver:run-1");
  process.env.QUAY_STORE_COMMIT_ACTOR = "driver:run-2";
  try {
    assert.equal(resolveCommitActor(), "driver:run-2");
  } finally {
    delete process.env.QUAY_STORE_COMMIT_ACTOR;
  }
});

const GOAL_BODY = "goal body: background, scope, non-goals and exit conditions — long enough for the 40-char minimum";

test("AC1 goal-store: a create and a status flip produce distinguishable, subtyped subjects", () => {
  const { dir, run } = gitRepo("ac1");
  const s = createGoalStore(path.join(dir, "goals"));
  // ⚠️ `status: "draft"`: a GOAL born `active` now needs a naming AC first
  // (gap-goal-create-as-active-skips-zero-ac-gate); the subject under test here is the commit
  // SUBJECT SHAPE (create vs status flip), which is independent of which status the create lands.
  s.write("GOAL-001", { title: "g", status: "draft", origin: "o", body: GOAL_BODY }); // create
  s.write("AC-001", { title: "a", status: "draft", goal: "GOAL-001", criterion: "true", expect: "e", origin: "o" }); // create
  s.write("AC-001", { status: "active" }); // status draft→active
  const subs = run("log", "--format=%s", "--", "goals").trim().split("\n");
  const create = subs.find((s) => s.includes(" create by "));
  const flip = subs.find((s) => s.includes(" status draft→active "));
  assert.ok(create, `a create subject exists (subjects: ${subs.join(" | ")})`);
  assert.ok(flip, `a status-flip subject exists (subjects: ${subs.join(" | ")})`);
  assert.notEqual(create, flip, "create and status-flip subjects are different in form");
});

test("AC1 reverse: pre-change fixed-prose history stays readable alongside new subjects", () => {
  const { dir, run } = gitRepo("ac1-old");
  fs.writeFileSync(path.join(dir, "goals", "AC-900.md"), "old\n", "utf8");
  run("add", "--", "goals/AC-900.md");
  run("commit", "-q", "--no-verify", "-m", "goals: AC-900 写盘即提交（store-commit）", "--", "goals/AC-900.md");
  fs.writeFileSync(path.join(dir, "goals", "AC-901.md"), "new\n", "utf8");
  const r = commitStoreWrite({ relPath: "goals/AC-901.md", kind: "goals", id: "AC-901", action: "create", root: dir });
  assert.equal(r.outcome, "committed");
  const subs = run("log", "--format=%s", "--", "goals").trim().split("\n");
  assert.ok(subs.some((s) => s.includes("写盘即提交")), "old fixed-prose subject still readable");
  assert.ok(subs.some((s) => s.includes(" create by ")), "new subject appended alongside old history");
});

test("AC2 writer: 20 goal writes all carry a writer (the literal grep -c 'by ' == 20)", () => {
  const { dir, run } = gitRepo("ac2");
  const s = createGoalStore(path.join(dir, "goals"));
  for (let i = 1; i <= 20; i++) {
    s.write(`AC-${900 + i}`, { goal: "GOAL-001", criterion: "true", expect: "e", origin: "o" });
  }
  const subs = run("log", "--format=%s", "-20", "--", "goals").trim().split("\n");
  assert.equal(subs.length, 20, "exactly 20 goal commits exist");
  for (const subj of subs) {
    assert.match(subj, / by (cli:|driver:)/, `subject carries a writer: "${subj}"`);
  }
  assert.equal(subs.filter((s) => s.includes(" by ")).length, 20, "grep -c 'by ' over the last 20 == 20");
});

test("AC3 batch: writeBatch(3 records) produces exactly ONE commit", () => {
  const { dir, run } = gitRepo("ac3");
  const s = createGoalStore(path.join(dir, "goals"));
  const before = Number(run("rev-list", "--count", "HEAD").trim());
  s.writeBatch([
    { id: "AC-931", goal: "GOAL-001", criterion: "true", expect: "e", origin: "o" },
    { id: "AC-932", goal: "GOAL-001", criterion: "true", expect: "e", origin: "o" },
    { id: "AC-933", goal: "GOAL-001", criterion: "true", expect: "e", origin: "o" },
  ]);
  const after = Number(run("rev-list", "--count", "HEAD").trim());
  assert.equal(after - before, 1, "batch of 3 records ⇒ rev-list count diff == 1");
  assert.match(run("log", "-1", "--format=%s").trim(), / by cli:/);
});

test("commitStoreBatch primitive: stages multiple paths in one commit with a writer", () => {
  const { dir, run } = gitRepo("batch-prim");
  fs.writeFileSync(path.join(dir, "goals", "AC-1.md"), "v1\n", "utf8");
  fs.writeFileSync(path.join(dir, "goals", "AC-2.md"), "v2\n", "utf8");
  fs.writeFileSync(path.join(dir, "goals", "AC-3.md"), "v3\n", "utf8");
  const before = Number(run("rev-list", "--count", "HEAD").trim());
  const out = commitStoreBatch({ relPaths: ["goals/AC-1.md", "goals/AC-2.md", "goals/AC-3.md"], kind: "goals", id: "AC-1 AC-2 AC-3", action: "batch", root: dir });
  assert.equal(out, "committed");
  assert.equal(Number(run("rev-list", "--count", "HEAD").trim()) - before, 1);
  assert.match(run("log", "-1", "--format=%s").trim(), / by cli:/);
});

test("AC4 single constructor: the five store files contain zero fixed-prose assembly", () => {
  const files = [
    path.join(__dirname, "..", "src", "goal-store.ts"),
    path.join(__dirname, "..", "src", "document-store.ts"),
    path.join(__dirname, "..", "src", "adr-store.ts"),
    path.join(__dirname, "..", "src", "meta-store.ts"),
    path.join(__dirname, "..", "..", "quay-native", "src", "store.ts"),
  ];
  let total = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const hits = src.split("写盘即提交").length - 1;
    total += hits;
    assert.equal(hits, 0, `${path.basename(f)} must not hand-assemble the old fixed message (${hits} hit(s))`);
  }
  assert.equal(total, 0, "AC4 grep sum over the five store files == 0");
});
