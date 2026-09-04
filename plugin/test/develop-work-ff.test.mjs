// @test-group engine
// develop-work-ff.test.mjs — gap-fan-in-ff-ref-update-detach-develop AC2: the doc-only work branch's
// landing onto develop is a pure ref update (git push .) gated by a MECHANICAL doc-only enforcement
// (`--classify-delta` non-empty ⇒ refuse). The main checkout sits on the doc-only work branch
// (manager/outer's .md edits), and develop is DETACHED from any checkout.
//
// Run:
//   scripts/test.sh plugin/test/develop-work-ff.test.mjs
//   node --test plugin/test/develop-work-ff.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "develop-work-ff.sh");
const WORK_BRANCH = "develop-work";

function git(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `developworkff-${prefix ?? ""}-`));
}

function initRepo(dir) {
  git(dir, "init", "-q");
  git(dir, "config", "user.name", "dwff-test");
  git(dir, "config", "user.email", "dwff@example.com");
  git(dir, "branch", "-M", "develop");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
}

function runScript(args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

test("AC2 — a doc-only work branch ff's to develop (empty --classify-delta ⇒ land)", () => {
  const dir = makeTmp("doc");
  try {
    initRepo(dir);
    git(dir, "checkout", "-q", "-b", WORK_BRANCH); // main checkout on the work branch; develop detached
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", "some-task.md"), "doc\n", "utf8");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "doc-only edit");
    const before = git(dir, "rev-parse", "develop").stdout.trim();

    const r = runScript(["--branch", WORK_BRANCH, "--root", dir]);
    assert.equal(r.status, 0, `doc-only work branch must land:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /OK — develop fast-forwarded/);
    assert.equal(git(dir, "rev-parse", "develop").stdout.trim(), git(dir, "rev-parse", WORK_BRANCH).stdout.trim(), "develop fast-forwarded to the work branch tip");
    assert.notEqual(git(dir, "rev-parse", "develop").stdout.trim(), before, "develop advanced");
    // The ref update never touches the working tree — the checkout stays on the work branch.
    assert.equal(git(dir, "branch", "--show-current").stdout.trim(), WORK_BRANCH, "main checkout stays on the work branch");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 negative control — a work branch with a CODE change ⇒ exit 2 (doc-only 机械强制拒绝)", () => {
  const dir = makeTmp("code");
  try {
    initRepo(dir);
    git(dir, "checkout", "-q", "-b", WORK_BRANCH);
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "scripts", "foo.ts"), "export const x = 1\n", "utf8");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "code edit (must be refused)");
    const before = git(dir, "rev-parse", "develop").stdout.trim();

    const r = runScript(["--branch", WORK_BRANCH, "--root", dir]);
    assert.equal(r.status, 2, `a code delta must be refused (exit 2):\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /CODE changes/, "the refusal names the code delta");
    assert.match(r.stderr, /plugin\/scripts\/foo\.ts/, "the refusal lists the offending file");
    assert.equal(git(dir, "rev-parse", "develop").stdout.trim(), before, "develop unchanged (refused)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("merge target still checked out ⇒ exit 2 (ref update refused by receive.denyCurrentBranch)", () => {
  const dir = makeTmp("detached");
  try {
    initRepo(dir);
    git(dir, "checkout", "-q", "-b", WORK_BRANCH);
    git(dir, "checkout", "-q", "develop"); // re-checkout the merge target (develop NOT detached)

    const r = runScript(["--branch", WORK_BRANCH, "--root", dir]);
    assert.equal(r.status, 2, `a checked-out merge target must refuse exit 2:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /still checked out/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("non-fast-forward — develop advanced since the work branch forked ⇒ exit 1", () => {
  const dir = makeTmp("nff");
  try {
    initRepo(dir);
    git(dir, "checkout", "-q", "-b", WORK_BRANCH);
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", "some-task.md"), "doc\n", "utf8");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "doc-only edit");
    // develop advances (a task fan-in lands) AFTER the work branch forked.
    git(dir, "checkout", "-q", "develop");
    fs.writeFileSync(path.join(dir, "landed.txt"), "task landed\n", "utf8");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "a task fan-in landed on develop");
    git(dir, "checkout", "-q", WORK_BRANCH);
    const before = git(dir, "rev-parse", "develop").stdout.trim();

    const r = runScript(["--branch", WORK_BRANCH, "--root", dir]);
    assert.equal(r.status, 1, `non-ff must exit 1:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /non-fast-forward/);
    assert.equal(git(dir, "rev-parse", "develop").stdout.trim(), before, "develop unchanged (non-ff refused)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits 0 with usage on stdout (gap-scripts-sprawl convention)", () => {
  const r = runScript(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /develop-work-ff/);
});
