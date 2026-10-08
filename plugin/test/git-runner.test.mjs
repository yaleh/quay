// @test-group engine
// git-runner.test.mjs — unit tests for the shared git primitives (plugin/scripts/git-runner.ts).
//
// The point of the `ancestry` block is not "does is-ancestor work" — the two callers' own test files
// already assert that end-to-end (plugin/test/cross-machine-verify-characterization.test.mjs,
// plugin/test/direct-to-develop-bypass-check.test.mjs). It is the CONTROL on the one thing the
// extraction deliberately did NOT change and must never silently lose: the predicate answers with
// THREE states, and only the callers fold `null` (hard rule 3b — a library that folds "could not
// look" into `false` prints an instrument failure in the same shape as a real "not an ancestor").
//   found     → true / false   (git exited 0 / 1)
//   NOT found → null           (git exited ≥2, or the process never ran)
//
// The regression block is the guard that makes the extraction stick (the same shape
// plugin/test/source-text-lib.test.mjs uses for its family): the routine that reported
// `is-ancestor-pair` re-finds any surviving copy on its next pass, so the two named carriers are
// pinned to reach the shared module AND to declare no `merge-base --is-ancestor` of their own.
//
// Run: scripts/test.sh plugin/test/git-runner.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ancestry } from "../scripts/git-runner.ts";
import { buildNonCodeMask } from "../scripts/checker-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "plugin", "scripts");

/** Every temp dir this file creates — cleaned by the single `after()` below (the carrier-array
 *  pattern, so the mkdtemp results are PAIRED and no fixture leaks into /tmp). */
const _createdDirs = [];
function mkTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** A throwaway git repo with two commits. Identity via `-c` (the runner's own env carries no
 *  user.name/email — the repo-wide convention for tests that must commit). */
function makeRepo() {
  const dir = mkTemp("git-runner-ancestry-");
  const run = (args) =>
    spawnSync("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      encoding: "utf8",
      timeout: 30_000,
    });
  assert.equal(run(["init", "-q"]).status, 0, "git init failed");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  assert.equal(run(["add", "a.txt"]).status, 0, "git add failed");
  assert.equal(run(["commit", "-q", "-m", "one"]).status, 0, "first commit failed");
  const first = run(["rev-parse", "HEAD"]).stdout.trim();
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  assert.equal(run(["commit", "-q", "-am", "two"]).status, 0, "second commit failed");
  const second = run(["rev-parse", "HEAD"]).stdout.trim();
  return { dir, first, second, run };
}

// ── ancestry: the three states ────────────────────────────────────────────────────────────────

test("ancestry: an ancestor of a later commit is true", () => {
  const { dir, first, second } = makeRepo();
  assert.equal(ancestry(dir, first, second), true);
});

test("ancestry: a later commit is NOT an ancestor of an earlier one (false, not null)", () => {
  const { dir, first, second } = makeRepo();
  // The state that matters: git ANSWERED "no". This must be `false`, never folded with the null arm.
  assert.equal(ancestry(dir, second, first), false);
});

test("ancestry: a commit is its own ancestor (the same-commit case the callers rely on)", () => {
  const { dir, second } = makeRepo();
  assert.equal(ancestry(dir, second, second), true);
});

test("ancestry: an unknown object is null — the invocation could not be answered", () => {
  const { dir, second } = makeRepo();
  // `git merge-base --is-ancestor <missing> <ref>` exits ≥2, NOT 1: a library that maps every
  // non-zero exit to `false` would report a real "not an ancestor" here.
  assert.equal(ancestry(dir, "0".repeat(40), second), null);
});

test("ancestry: a directory that is not a repository is null", () => {
  const dir = mkTemp("git-runner-nonrepo-");
  assert.equal(ancestry(dir, "HEAD", "HEAD"), null);
});

// ── regression: the predicate lives in ONE place (the guard that makes the extraction stick) ──

/** The carriers that each held a copy with different plumbing before the extraction — the two the
 *  finding named. Every one must now reach git-runner.ts. */
const ANCESTRY_CARRIERS = [
  "cross-machine-verify.ts",
  "direct-to-develop-bypass-check.ts",
];

test("regression: no carrier declares its own `merge-base --is-ancestor` invocation", () => {
  // 硬规则 2 — by POSITION, not keyword: the predicate runs over the non-code mask, so the comments
  // the extraction left behind (which DO spell `merge-base --is-ancestor`) can never satisfy it,
  // while a real invocation always does.
  for (const name of ANCESTRY_CARRIERS) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8");
    const mask = buildNonCodeMask(src);
    const offenders = [];
    for (const m of src.matchAll(/--is-ancestor/g)) {
      if (mask[m.index] === 0) offenders.push(src.slice(m.index, m.index + 40).split("\n")[0]);
    }
    assert.deepEqual(
      offenders,
      [],
      `${name} still invokes \`merge-base --is-ancestor\` itself (finding \`is-ancestor-pair\` is back). ` +
        `Import \`ancestry\` from ./git-runner.ts instead; if the semantics genuinely differ (e.g. a ` +
        `three-state caller that reads the exit code itself), record why in the module header.`,
    );
  }
});

test("regression: every carrier imports `ancestry` from the shared git-runner module", () => {
  for (const name of ANCESTRY_CARRIERS) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8");
    assert.match(src, /from "\.\/git-runner\.ts"/, `${name} must import ./git-runner.ts`);
    assert.match(src, /\bancestry\b/, `${name} must use the shared \`ancestry\``);
  }
});

test("regression: the ONE home exports the three-state predicate", () => {
  const lib = fs.readFileSync(path.join(SCRIPTS_DIR, "git-runner.ts"), "utf8");
  assert.match(lib, /export function ancestry\b/);
  assert.match(lib, /boolean \| null/, "`ancestry` must keep the null arm — it is not a boolean fold");
});
