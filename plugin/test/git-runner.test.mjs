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
import { ancestry, headExists, showFile } from "../scripts/git-runner.ts";
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

// ── headExists / showFile: the byte-identical pair the two ratchet checkers carried ──────────
//
// Both checkers use `headExists` as a FAIL-CLOSED bootstrap probe (exit 2 when it is not a usable
// git worktree) and `showFile` as "the committed copy of the data file, or none". The cases below
// pin the states the extraction had to preserve, not just the happy path.

test("headExists: a usable git worktree is true", () => {
  const { dir } = makeRepo();
  assert.equal(headExists(dir), true);
});

test("headExists: a directory that is not a repository is false — git ANSWERED no", () => {
  const dir = mkTemp("git-runner-nonrepo-");
  assert.equal(headExists(dir), false);
});

test("headExists: git missing is null — the process never ran (not folded into false)", () => {
  // The arm the two callers fold themselves (`null ⇒ fail closed`). Reaching it needs a git that
  // does not exist: run the helper in a subprocess whose PATH is empty, launched by absolute path.
  const dir = mkTemp("git-runner-nogit-");
  const libPath = JSON.stringify(path.join(SCRIPTS_DIR, "git-runner.ts"));
  const script = `import { headExists } from ${libPath}; process.stdout.write(JSON.stringify(headExists(process.argv[1])));`;
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", "-e", script, dir], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PATH: "" },
  });
  assert.equal(r.status, 0, `subprocess failed: ${r.stderr}`);
  assert.equal(r.stdout, "null", "a missing git binary must NOT read as `false` (hard rule 3b)");
});

test("showFile: returns the committed text of <ref>:<rel>", () => {
  const { dir, first } = makeRepo();
  assert.equal(showFile(dir, first, "a.txt"), "one\n");
});

test("showFile: a path absent at that ref is null", () => {
  const { dir, first } = makeRepo();
  assert.equal(showFile(dir, first, "nope.txt"), null);
});

test("showFile: an unresolvable ref is null", () => {
  const { dir } = makeRepo();
  assert.equal(showFile(dir, "0".repeat(40), "a.txt"), null);
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

// ── regression: headExists / showFile — the `git-showfile-headexists` extraction ──────────────
//
// The pair was byte-identical between the two ratchet checkers (the copy even said it "mirrors"
// the other), so the same guard shape as `ancestry` applies: both carriers must reach the shared
// module, neither may declare the invocation again, and the null arm must survive.

/** The two ratchet checkers that carried the pair — the files the finding named. */
const GIT_READ_CARRIERS = [
  "test-framework-policy-check.ts",
  "test-isolation-check.ts",
];

test("regression: no carrier declares its own HEAD probe or `<ref>:<path>` reader", () => {
  // 硬规则 2 — by POSITION: run over the non-code mask, so the extraction's own comments (which
  // spell these names) cannot satisfy it while a real declaration/invocation always does.
  for (const name of GIT_READ_CARRIERS) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8");
    const mask = buildNonCodeMask(src);
    const offenders = [];
    for (const needle of ["rev-parse", "function gitHeadExists", "function gitShowFile"]) {
      for (const m of src.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))) {
        if (mask[m.index] === 0) offenders.push(src.slice(m.index, m.index + 40).split("\n")[0]);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `${name} still declares/invokes a git probe of its own (finding \`git-showfile-headexists\` is back). ` +
        `Import \`headExists\` / \`showFile\` from ./git-runner.ts instead.`,
    );
  }
});

test("regression: every carrier imports `headExists` and `showFile` from the shared module", () => {
  for (const name of GIT_READ_CARRIERS) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8");
    assert.match(
      src,
      /import \{[^}]*\bheadExists\b[^}]*\bshowFile\b[^}]*\} from "\.\/git-runner\.ts"/,
      `${name} must import both helpers from ./git-runner.ts`,
    );
  }
});

test("regression: the ONE home exports the pair, with `headExists` keeping its null arm", () => {
  const lib = fs.readFileSync(path.join(SCRIPTS_DIR, "git-runner.ts"), "utf8");
  assert.match(lib, /export function headExists\(root: string\): boolean \| null/);
  assert.match(lib, /export function showFile\(root: string, ref: string, rel: string\): string \| null/);
});
