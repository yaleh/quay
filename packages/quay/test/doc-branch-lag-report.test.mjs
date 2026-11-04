// @test-group product
// doc-branch-lag-report — a doc branch BEHIND the landing baseline must be reported as a lag,
// never as "unchanged/reusable" or "satisfied" (gap-quay-init-doc-branch-behind-baseline-reports-satisfied).
//
// The defect: `ensureDocBranch` classified an existing related doc branch as `reusable` whenever the
// two ancestry directions agreed it was related, and `checkDocBranchInvariant` answered `satisfied`
// the moment the checkout was OFF `develop` — so a main checkout parked on a doc branch 1057 commits
// BEHIND `develop` read exactly like a doc branch carrying the latest work (hard rule 3b: "behind N"
// and "fine" shared one output shape).
//
// Run: node --test packages/quay/test/doc-branch-lag-report.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkDocBranchInvariant,
  ensureDocBranch,
  formatDocBranchInvariantReport,
  formatDocBranchReport,
} from "../src/core/branch-model.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUAY_CLI = path.join(__dirname, "..", "bin", "quay.ts");

const TMP_DIRS = [];
after(() => {
  for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function commit(cwd, msg) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

/**
 * A quay-shaped repo whose doc branch `author` is `N` commits BEHIND the landing baseline `develop`.
 * The main checkout starts on `develop` (the state `ensureDocBranch`'s reusable arm reads).
 */
function behindRepo(tag, N = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-lag-${tag}-`));
  TMP_DIRS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "lag-test"]);
  git(dir, ["config", "user.email", "lag@example.com"]);
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  commit(dir, "base");
  git(dir, ["branch", "develop"]); // develop continues the default branch
  git(dir, ["checkout", "-q", "develop"]);
  for (let i = 1; i <= N + 1; i++) {
    fs.writeFileSync(path.join(dir, `dev${i}.txt`), `${i}\n`);
    commit(dir, `dev ${i}`);
  }
  // `author` forks N commits behind the develop tip ⇒ `git rev-list --count author..develop === N`.
  git(dir, ["branch", "author", `develop~${N}`]);
  git(dir, ["checkout", "-q", "develop"]);
  return dir;
}

function runQuayInit(args, cwd) {
  try {
    return { stdout: execFileSync("node", [QUAY_CLI, ...args], { encoding: "utf8", cwd }), exitCode: 0, stderr: "" };
  } catch (err) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

// ── AC1: the doc-branch bootstrap reports the explicit lag ───────────────────────────────────────

test("AC1: a doc branch behind develop reports behindBaseline === N (and its own state)", () => {
  const dir = behindRepo("ac1", 3);
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);
  const beforeAuthor = git(dir, ["rev-parse", "author"]);

  const r = ensureDocBranch(dir, { name: "author" });

  assert.equal(r.behindBaseline, 3, "the lag is a git-rev-list READ, not a boolean-derived guess");
  assert.equal(r.state, "behind", "behind must not be shaped like the reusable/unchanged case");
  assert.equal(r.action, "switched", "the checkout still switches — this task changes no behavior");
  assert.equal(r.ok, true);
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "author");
  // ⛔ No ref moved: the doc branch and the baseline are byte-identical to before the call.
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop);
  assert.equal(git(dir, ["rev-parse", "author"]), beforeAuthor);
  assert.match(formatDocBranchReport(r), /\[SWITCHED\] doc-branch -> author/);
  assert.match(formatDocBranchReport(r), /3 commit\(s\) BEHIND the landing baseline 'develop'/);
});

// ── AC2: the standing invariant stops saying `satisfied` and carries the same lag ────────────────

test("AC2: on the behind doc branch, the invariant is NOT satisfied and carries the same lag", () => {
  const dir = behindRepo("ac2", 4);
  git(dir, ["checkout", "-q", "author"]);

  const inv = checkDocBranchInvariant(dir, { name: "author" });

  assert.notEqual(inv.state, "satisfied", "a behind doc branch must not read as the invariant holding");
  assert.equal(inv.state, "behind");
  assert.equal(inv.reason, "doc-branch-behind-baseline");
  assert.equal(inv.behindBaseline, 4, "the same read amount AC1 measured");
  assert.equal(inv.ok, false, "parked on an older tree is a failure, not a pass");
  assert.equal(inv.notEvaluated, false);
  assert.match(inv.detail, /4 commit\(s\) BEHIND/);
  assert.match(formatDocBranchInvariantReport(inv), /^doc-branch-invariant: BEHIND \(reason: doc-branch-behind-baseline\)/);
});

test("AC2 (on-baseline arm): the violated reading on a behind doc branch also carries the lag", () => {
  // The checkout is still on `develop` while a behind `author` exists — already a violation, but the
  // report must now NAME the lag so "switch to author" is not silently an older-tree switch.
  const dir = behindRepo("ac2-on-baseline", 2);
  const inv = checkDocBranchInvariant(dir, { name: "author" });
  assert.equal(inv.state, "violated");
  assert.equal(inv.reason, "on-baseline-doc-branch-elsewhere");
  assert.equal(inv.behindBaseline, 2);
  assert.match(inv.detail, /2 commit\(s\) BEHIND/);
});

// ── AC3: the negative control — same tip is STILL satisfied, with a real 0 reading ───────────────

test("AC3: a doc branch AT the develop tip is still satisfied with behindBaseline === 0", () => {
  const dir = behindRepo("ac3", 3);
  // Re-point `author` at the develop tip: same tip, no lag.
  git(dir, ["branch", "-f", "author", "develop"]);
  git(dir, ["checkout", "-q", "author"]);

  const inv = checkDocBranchInvariant(dir, { name: "author" });
  assert.equal(inv.state, "satisfied", "the negative control must NOT turn every off-baseline case red");
  assert.equal(inv.behindBaseline, 0, "0 is a MEASURED 'not behind', not null");
  assert.equal(inv.ok, true);
  assert.match(formatDocBranchInvariantReport(inv), /^doc-branch-invariant: SATISFIED/);
});

// ── AC4: the human-facing line prints the number (non --json) ────────────────────────────────────

test("AC4: `quay init --dry-run` prints the lag number on the doc-branch line", () => {
  const dir = behindRepo("ac4", 5);
  const r = runQuayInit(["init", "--branch-model-only", "--dry-run", "--doc-branch-name", "author", "--root", dir], dir);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /doc-branch -> author/);
  assert.match(r.stdout, /5 commit\(s\) BEHIND the landing baseline 'develop'/);
});

// ── AC5: behavior is unchanged — the behind case still moves HEAD exactly as before ───────────────

test("AC5: the behind checkout still lands on the doc branch, with no ref moved", () => {
  const dir = behindRepo("ac5", 6);
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);
  const beforeAuthor = git(dir, ["rev-parse", "author"]);
  const beforeHead = git(dir, ["rev-parse", "HEAD"]);

  const r = ensureDocBranch(dir, { name: "author" });

  // Same HEAD result the pre-task `reusable` arm produced: the main checkout is now on the doc branch.
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "author");
  assert.notEqual(git(dir, ["rev-parse", "HEAD"]), beforeHead, "HEAD moved onto the doc branch, exactly as before");
  // …and NO other ref moved.
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop);
  assert.equal(git(dir, ["rev-parse", "author"]), beforeAuthor);
  assert.equal(r.action, "switched");
  assert.equal(r.state, "behind");
});
