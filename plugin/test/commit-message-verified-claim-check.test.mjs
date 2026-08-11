// @test-group engine
// commit-message-verified-claim-check.test.mjs — the AC11 mechanical gate of
// gap-commit-message-claims-verified-without-verification.
//
// The defect: merge commit 8e2e49b9's message claimed "all syntax verified" while
// carrying real merge corruption (trend-check.ts duplicated 2×, 8 task frontmatters
// unparseable). Commit messages are an AC11 carrier more dangerous than task bodies /
// tick rows — they enter HISTORY and are not re-verified by later readers.
//
// AC1/AC2 require a mechanical check that flags a commit whose message makes a
// "verified"-class ASSERTION without a reproducible verification command/reference.
// This file tests that checker:
//   - the RED shape: "all syntax verified" / "all verified" / "syntax verified" /
//     "验证通过" with NO command/reference is flagged
//   - the GREEN controls: the same claim WITH a command/reference (scripts/test.sh,
//     scoped N/M, verifiedCommit=, tests N/M) is NOT flagged
//   - positional judgment (hard rule 2): a task-id (gap-…-verified-…), a descriptive
//     "re-verify", "unverified" (negation), and a CITED claim ("… claims 'all syntax
//     verified'") are NOT assertions
//   - the real repo scan is clean (strict-zero band on the live window)
//   - the negative control via the real CLI: a temp git repo with a bare-claim commit
//     exits 1; removing it restores exit 0
//
// Run: scripts/test.sh plugin/test/commit-message-verified-claim-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { analyzeMessage, scanRepo, selftest, DEFAULT_DEPTH, CLAIM_RE, EVIDENCE_RE } from "../scripts/commit-message-verified-claim-check.ts";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const CHECKER = path.join(repoRoot, "plugin/scripts/commit-message-verified-claim-check.ts");

function runChecker(root, extra = []) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, ...extra], {
    encoding: "utf8",
  });
}

/** Create a temp git repo with the given commit message at HEAD (plus an initial clean commit). */
function makeGitRepoWithMessage(tag, msg) {
  const dir = makeTmpDir(tag);
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "tester"]);
  fs.writeFileSync(path.join(dir, "f.txt"), "x\n");
  git(["add", "f.txt"]);
  git(["commit", "-q", "-m", "chore: initial commit"]);
  if (msg) git(["commit", "-q", "--allow-empty", "-m", msg]);
  return dir;
}

// ── RED: the defect shapes are flagged ────────────────────────────────────────────────────────────────
test("AC2/RED: the 8e2e49b9 shape — 'all syntax verified' with no command/reference is flagged", () => {
  const v = analyzeMessage("8e2e49b9", "merge: 45 conflicts resolved (…; all syntax verified)");
  assert.ok(v, "a bare 'all syntax verified' claim must be flagged");
  assert.equal(v.claim, "all syntax verified");
  assert.equal(v.hash, "8e2e49b9");
});

test("AC2/RED: bare 'all verified' / 'syntax verified' / Chinese '验证通过' are flagged", () => {
  assert.ok(analyzeMessage("a", "fix: ad-arm1 gate — all verified"));
  assert.ok(analyzeMessage("a", "fix: merge — syntax verified"));
  assert.ok(analyzeMessage("a", "修复：合并冲突 — 验证通过"));
  assert.ok(analyzeMessage("a", "修复：冲突处理 — 已验证"));
});

// ── GREEN: a claim WITH a verification command/reference is supported ─────────────────────────────────
test("AC1/GREEN: the same claim with a verification command/reference is NOT flagged", () => {
  assert.equal(analyzeMessage("a", "fix: x — all syntax verified (scripts/test.sh green)"), null);
  assert.equal(analyzeMessage("a", "outer: closure — all verified, scoped 64/64"), null);
  assert.equal(analyzeMessage("a", "B1 closure — verifiedCommit=214a29c1, all verified"), null);
  assert.equal(analyzeMessage("a", "fix: all tests verified — tests 3084/0"), null);
  assert.equal(analyzeMessage("a", "fix: x — syntax verified, node --check clean"), null);
  assert.equal(analyzeMessage("a", "fix: x — 验证通过（--for-task 门 45/45 绿）"), null);
});

// ── GREEN: positional judgment — non-assertions are NOT claims ────────────────────────────────────────
test("AC1/GREEN: a task-id containing 'verified' is NOT a claim (position, not keyword)", () => {
  assert.equal(
    analyzeMessage("a", "merge: fan-in task/gap-send-keys-verified-leaks-tmux-servers-unincorporated"),
    null,
  );
});

test("AC1/GREEN: descriptive 're-verify', negation 'unverified', and reference-only are NOT claims", () => {
  assert.equal(analyzeMessage("a", "inner: re-verify on develop 2be095ae"), null);
  assert.equal(analyzeMessage("a", "fix: 24 commits unverified — skip batch merge"), null);
  assert.equal(analyzeMessage("a", "outer: flip done (verifiedCommit de7aa6e3)"), null);
});

test("AC1/GREEN: a CITED claim (quoting the finding) is not an assertion", () => {
  assert.equal(
    analyzeMessage("a", 'tasks: file AC11 carrier — 8e2e49b9 claims "all syntax verified"'),
    null,
  );
});

// ── CLAIM/EVidence regex sanity ───────────────────────────────────────────────────────────────────────
test("CLAIM_RE / EVIDENCE_RE: the atomic patterns behave as documented", () => {
  assert.match("all syntax verified", CLAIM_RE);
  assert.match("syntax verified", CLAIM_RE);
  assert.match("all verified", CLAIM_RE);
  assert.match("验证通过", CLAIM_RE);
  assert.doesNotMatch("gap-send-keys-verified-leaks", CLAIM_RE); // task-id
  assert.doesNotMatch("re-verify", CLAIM_RE);
  assert.doesNotMatch("verifiedCommit=214a29c1", CLAIM_RE); // reference, not a bare claim

  assert.match("scoped 64/64", EVIDENCE_RE);
  assert.match("scripts/test.sh green", EVIDENCE_RE);
  assert.match("verifiedCommit=214a29c1", EVIDENCE_RE);
  assert.match("tests 3084/0", EVIDENCE_RE);
});

test("selftest: the checker's own RED/GREEN fixture set passes", () => {
  assert.equal(selftest(), true);
});

// ── Real repo strict-zero band (live window) ──────────────────────────────────────────────────────────
test("AC2: the real repo scan is clean — strict-zero band on the live window (default depth)", () => {
  const vs = scanRepo(repoRoot, DEFAULT_DEPTH);
  assert.equal(vs.length, 0, JSON.stringify(vs.map((v) => `${v.hash} ${v.claim}`)));
  const res = runChecker(repoRoot);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /violations: 0/);
});

// ── Negative control via the real CLI ─────────────────────────────────────────────────────────────────
test("AC2: a temp git repo with a bare 'all syntax verified' commit exits 1; restore exits 0", () => {
  const dir = makeGitRepoWithMessage("cmvcc-neg-", "merge: fix conflicts — all syntax verified");
  const red = runChecker(dir);
  assert.equal(red.status, 1, "a bare verified-claim commit must redden the checker");
  assert.match(red.stdout, /all syntax verified/);

  // Restore: rewrite the bad message to carry a verification command → green.
  const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["commit", "--amend", "-q", "--allow-empty", "-m", "merge: fix conflicts — all syntax verified (scripts/test.sh green)"]);
  const green = runChecker(dir);
  assert.equal(green.status, 0, "restoring the verification command must return the checker to green");
});

test("AC2: a clean temp git repo (no claim) exits 0", () => {
  const dir = makeGitRepoWithMessage("cmvcc-ok-", null);
  const res = runChecker(dir);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /violations: 0/);
});
