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
import { execFileSync } from "node:child_process";
import { commitStoreWrite, resolveGitRoot } from "../src/store-commit.ts";

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
  const on = commitStoreWrite({ relPath: "goals/AC-1.md", message: "m1", root: dir, propagate: "develop" });
  assert.equal(on.outcome, "committed");
  assert.equal(on.propagated, true);
  assert.ok(refExists(run, "develop", "goals/AC-1.md"), "develop received the propagated write");
  // NEGATIVE ① — propagate omitted (defaults "none"): develop must NOT receive it.
  fs.writeFileSync(path.join(dir, "goals", "AC-2.md"), "v2\n", "utf8");
  const off = commitStoreWrite({ relPath: "goals/AC-2.md", message: "m2", root: dir });
  assert.equal(off.outcome, "committed");
  assert.equal(off.propagated, false);
  assert.ok(refExists(run, "HEAD", "goals/AC-2.md"), "current branch (author) received the write");
  assert.equal(refExists(run, "develop", "goals/AC-2.md"), false, "develop must NOT receive a non-propagated write");
});

test("AC-199 ② propagate none: develop does NOT receive the write", () => {
  const { dir, run } = gitRepo("prop-none");
  fs.writeFileSync(path.join(dir, "goals", "AC-3.md"), "v3\n", "utf8");
  const r = commitStoreWrite({ relPath: "goals/AC-3.md", message: "m3", root: dir, propagate: "none" });
  assert.equal(r.outcome, "committed");
  assert.equal(r.propagated, false);
  assert.ok(refExists(run, "HEAD", "goals/AC-3.md"), "current branch received the write");
  assert.equal(refExists(run, "develop", "goals/AC-3.md"), false, "develop must NOT receive a propagate:none write");
});

test("AC-199 ③ not-in-git: a non-git dir returns not-in-git, NOT failed", () => {
  const dir = tmpDir("nogit");
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  fs.writeFileSync(path.join(dir, "goals", "AC-4.md"), "v4\n", "utf8");
  const r = commitStoreWrite({ relPath: "goals/AC-4.md", message: "m4", root: dir });
  assert.equal(r.outcome, "not-in-git");
  assert.equal(r.propagated, false);
});

test("AC-199 ④ unchanged: byte-identical write restores to HEAD and leaves a clean tree", () => {
  const { dir, run } = gitRepo("unchanged");
  const p = path.join(dir, "goals", "AC-5.md");
  fs.writeFileSync(p, "same content\n", "utf8");
  const first = commitStoreWrite({ relPath: "goals/AC-5.md", message: "m5", root: dir });
  assert.equal(first.outcome, "committed");
  // Rewrite the SAME bytes: the primitive must restore to HEAD and report "unchanged".
  fs.writeFileSync(p, "same content\n", "utf8");
  const second = commitStoreWrite({ relPath: "goals/AC-5.md", message: "m6", root: dir });
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
