// @test-group product
// ancestry.ts — the ONE Core predicate behind `git merge-base --is-ancestor`
// (gap-routine-semantic-dedup-scan-is-ancestor-three-semantics, routine `semantic-dedup-scan`,
// runId `semantic-dedup-scan-1793162251891`).
//
// WHY THESE ASSERTIONS: the finding was not "the predicate is copied" but "the same question
// returns three different VALUE SETS" — tri-state (branch-model.ts) vs fold-every-failure-to-false
// (goal-merge.ts, and observation.ts's 10s-timeout catch). So this file pins the VALUE SET itself:
// `true` for a measured yes, `false` for a measured no, `null` for "git could not be ASKED"
// (hard rule 3b). The `null` case is the whole point — an unknown ref must not come back with the
// same value a measured negative does, because each caller folds it deliberately and differently.
//
// FALSIFIABILITY: §3 fails against the pre-consolidation shape (`catch { return false }`, the
// observation.ts body) and against `status === 0` (the goal-merge.ts body); §4 fails if the leaf
// throws instead of reporting NOT-ASKED; §5 fails if the timeout option is dropped or mis-forwarded.
//
// Run: node --test packages/quay/test/ancestry.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnlyText } from "../../../plugin/scripts/source-text-lib.ts";
import { ancestry } from "../src/core/ancestry.ts";

const dirs = [];

/** git with a private identity — the shared host has none configured (shared lesson
 *  `task-worktree-environment`: `empty ident name` otherwise). */
function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=ancestry-test", "-c", "user.email=ancestry-test@example.com", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** A real two-commit repository: `base` -> `tip`, plus a sibling branch forked at `base`. */
function makeRepo() {
  const dir = tmpDir("quay-ancestry-");
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "a");
  const base = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "-b", "side");
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
  git(dir, "add", "b.txt");
  git(dir, "commit", "-q", "-m", "b");
  const tip = git(dir, "rev-parse", "HEAD");
  return { dir, base, tip };
}

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test("§1 measured YES ⇒ true (a real ancestor, and a commit is its own ancestor)", () => {
  const { dir, base, tip } = makeRepo();
  assert.equal(ancestry(dir, base, tip), true);
  assert.equal(ancestry(dir, tip, tip), true, "equal commits count as ancestors (git exit 0)");
});

test("§2 measured NO ⇒ false (the reverse direction is a real negative, not an error)", () => {
  const { dir, base, tip } = makeRepo();
  assert.equal(ancestry(dir, tip, base), false);
});

test("§3 NOT ASKED ⇒ null — an unknown object is distinguishable from a measured false", () => {
  const { dir, tip } = makeRepo();
  const unknown = "0".repeat(40);
  assert.equal(ancestry(dir, unknown, tip), null, "unknown ancestor ⇒ null");
  assert.equal(ancestry(dir, tip, unknown), null, "unknown descendant ⇒ null");
  // The negative control that makes §3 a MEASUREMENT: the SAME repo really does answer `false`
  // for a genuine non-ancestor above, so `null` here is git failing to answer, not the repo
  // having no ancestry relation to report.
  assert.equal(ancestry(dir, tip, tip), true);
});

test("§4 NOT A REPOSITORY ⇒ null, never a throw (the read path must not 500)", () => {
  const notARepo = tmpDir("quay-ancestry-norepo-");
  const { base, tip } = makeRepo();
  assert.equal(ancestry(notARepo, base, tip), null);
});

test("§5 the caller's timeout is forwarded and does not change a decidable answer", () => {
  const { dir, base, tip } = makeRepo();
  assert.equal(ancestry(dir, base, tip, { timeoutMs: 30_000 }), true);
  assert.equal(ancestry(dir, tip, base, { timeoutMs: 30_000 }), false);
});

// ── the RATCHET ───────────────────────────────────────────────────────────────────────────────
// The finding named THREE Core carriers. Merging them once fixes today; this guard is what keeps
// the concept from recurring (the task's Effect Prediction: concept_recurs_after_merge = false).
// Same shape as plugin/test/git-runner.test.mjs's guard over the plugin carriers: the ONE home
// must keep the null arm, no carrier may declare the invocation again, and every carrier must
// reach the shared module.

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** The three Core carriers the finding named, with the specifier each must import the leaf from. */
const CARRIERS = [
  { rel: "core/branch-model.ts", specifier: '"./ancestry.ts"' },
  { rel: "goal-merge.ts", specifier: '"./core/ancestry.ts"' },
  { rel: "observation.ts", specifier: '"./core/ancestry.ts"' },
];

test("§6 the ONE home exports the tri-state predicate (the null arm survives the merge)", () => {
  const leaf = fs.readFileSync(path.join(SRC_DIR, "core", "ancestry.ts"), "utf8");
  assert.match(leaf, /export function ancestry\b/);
  assert.match(leaf, /boolean \| null/, "`ancestry` must keep the null arm — it is not a boolean fold");
});

test("§7 no Core carrier declares the invocation again — checked by POSITION, not by keyword", () => {
  // 硬规则 2: run over `codeOnlyText`, so a comment that SPELLS `merge-base --is-ancestor` (all
  // three carriers now do, explaining the merge) can never satisfy the detector, while a real
  // invocation inside a string literal always does.
  for (const { rel } of CARRIERS) {
    const src = fs.readFileSync(path.join(SRC_DIR, rel), "utf8");
    const code = codeOnlyText(src);
    const at = code.indexOf("merge-base");
    assert.equal(
      at,
      -1,
      `${rel} declares the ancestry invocation again (${JSON.stringify(src.slice(at, at + 40))}) — it must delegate to src/core/ancestry.ts`,
    );
  }
});

test("§8 every Core carrier imports the shared predicate from the leaf", () => {
  for (const { rel, specifier } of CARRIERS) {
    const src = fs.readFileSync(path.join(SRC_DIR, rel), "utf8");
    assert.ok(
      src.includes(`from ${specifier}`),
      `${rel} must import from ${specifier}`,
    );
    assert.match(src, /\bancestry\b/, `${rel} must use the shared \`ancestry\``);
  }
});
