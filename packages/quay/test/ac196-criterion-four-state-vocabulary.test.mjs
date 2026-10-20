// @test-group product
//
// ac196-criterion-four-state-vocabulary.test.mjs — the fixture for the RE-ANCHORED four-state-vocabulary
// predicate of `goals/AC-196-*.md`'s criterion (gap-ac196-criterion-four-state-vocabulary-carrier-stale).
//
// WHAT THIS FILE IS FOR. The AC-196 criterion asserts that the store-commit primitive's return
// vocabulary has FOUR states (committed | unchanged | not-in-git | failed) instead of one boolean, and
// that the retired boolean helpers are gone. The ORIGINAL text phrased the vocabulary half as two
// `grep -q` calls against `packages/quay/src/store-commit.ts` — the src-ROOT path. `35dc5da93`
// (refactor(core): sink the gate substrate into src/core …) moved the implementation DOWN to
// `packages/quay/src/core/store-commit.ts` and left the src-root path as a pure forwarding re-export
// ("⛔ Do not re-add implementation here" — a body there would put the src root back into the gate
// cycle the move removed). The guarantee never weakened — it is one implementation plus one forwarding
// surface — but the criterion's carrier went stale and could not be true on any tree. The predicate is
// now STRUCTURAL (forwarding surface / canonical module / declaration block / retired helpers); this
// fixture pins that structure so the same carrier rot cannot silently return.
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT (hard rule 4). The `four-state-vocabulary`
// block is extracted VERBATIM from the goal file's criterion — the same text `quay goal gate AC-196`
// runs — and executed under `sh` against a temp root holding real copies of the two files. A
// reimplementation here would be an echo of the criterion rather than a measurement of it: it would
// stay green while the criterion rotted, which is exactly the failure this task exists to repair.
//
// BOTH DIRECTIONS ARE COVERED (hard rule 4 corollary 3 — a predicate that cannot be false is not a
// measurement). The unmutated positive control is paired with four structurally distinct negatives,
// each asserted BY ITS OWN NAMED `CAUSE=` token so "refused for reason A" can never be read as
// "refused for reason B": a state dropped from the declaration block, a forwarding surface that stops
// forwarding, a restored legacy boolean helper, and — the decisive one against the obvious way to
// weaken this predicate — a state name that survives ONLY in a comment while being absent from the
// declaration. ⛔ Every mutation is applied to a TEMP ROOT copy; no production file is touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch). */
const REPO = path.resolve(HERE, "..", "..", "..");

const MARK_START = ">>> four-state-vocabulary";
const MARK_END = "<<< four-state-vocabulary";

/** The one goal file this fixture is pinned to. Resolved by id prefix, so a rename that keeps the id
 *  still resolves; a missing file fails loudly rather than skipping. */
function goalFilePath() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-196-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-196-*.md under ${dir}`);
  return path.join(dir, name);
}

/** The criterion text AS STORED (frontmatter folded scalar parsed back to a string). */
function criterionText() {
  const raw = fs.readFileSync(goalFilePath(), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(fm, "goal file has no YAML frontmatter");
  const doc = YAML.parse(fm[1]);
  assert.equal(typeof doc.criterion, "string", "goal record has no criterion string");
  return doc.criterion;
}

/** The shipped predicate block, delimited by its own markers inside the criterion. */
function predicateBlock() {
  const lines = criterionText().split("\n");
  const start = lines.findIndex((l) => l.includes(MARK_START));
  const end = lines.findIndex((l) => l.includes(MARK_END));
  assert.ok(start >= 0, `criterion is missing the ${MARK_START} marker`);
  assert.ok(end > start, `criterion is missing a ${MARK_END} marker after ${MARK_START}`);
  const block = lines.slice(start + 1, end).join("\n");
  // The block must actually BE the predicate — a marker left over an emptied block would otherwise make
  // every case below vacuously "pass" on an empty script.
  for (const needle of [
    "export type CommitOutcome",
    "not-in-git",
    "legacy-boolean-commit-functions",
    "store-commit\\.ts",
  ]) {
    assert.ok(block.includes(needle), `extracted block does not contain ${needle}`);
  }
  return block;
}

/** The forwarding surface (src root) and the canonical implementation (core/). */
const SHIM = "packages/quay/src/store-commit.ts";
const PRIM = "packages/quay/src/core/store-commit.ts";

/**
 * A fresh temp root that IS a git root, holding real copies of the two files under their
 * repo-relative paths (the criterion addresses them relatively, so cwd == the root is what makes
 * them addressable). `git init` is not needed by the predicate itself (it is pure file inspection)
 * but keeps the root shaped like the root the gate runs in.
 */
function mkRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ac196-fsv-")));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  for (const rel of [SHIM, PRIM]) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), dst);
  }
  return dir;
}

/** Run `script` in `root` under /bin/sh (the same shell the acceptance runner uses). The timeout is a
 *  harness bound, far above this block's sub-second cost, so a genuinely hung block still fails loudly
 *  instead of wedging the file. */
function runSh(script, root) {
  const r = spawnSync("/bin/sh", ["-c", script], { cwd: root, encoding: "utf8", timeout: 60000 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Overwrite one repo-relative file inside the temp root. */
function putFile(root, rel, text) {
  fs.writeFileSync(path.join(root, rel), text, "utf8");
}

/** Read one repo-relative file inside the temp root. */
function getFile(root, rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** The exact declaration line/block the predicate must read. Asserting it exists BEFORE mutating keeps
 *  a mutation from silently becoming a no-op (which would make the negative pass for the wrong reason:
 *  a fixture that "refuses" because the file no longer says anything at all is not measuring the
 *  named cause). */
const DECL = /^export type CommitOutcome = [^\n]*;[ \t]*$/m;

/** NEGATIVE ①: drop one state from the DECLARATION, leaving the rest of the file untouched. */
function dropState(text, state) {
  return text.replace(` | "${state}"`, "");
}

/** NEGATIVE ②: keep the file importable but stop the forwarding re-export. */
function stopForwarding(text) {
  return text.replace(/^export \* from "\.\/core\/store-commit\.ts";[ \t]*$/m, 'export * from "./core/other.ts";');
}

// ── positive control: the shipped block is TRUE on the real, unmutated tree ──────────────────────

test("the shipped predicate block passes on the real store-commit files (positive control)", () => {
  const root = mkRoot();
  try {
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 0, `the re-anchored predicate must be true on the real tree: ${r.stderr}`);
    assert.match(r.stdout, /OK — CommitOutcome 四态齐备/);
    assert.match(r.stdout, /not-in-git/);
    assert.match(r.stdout, /旧 boolean 提交函数 = 0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the whole criterion text (not just the block) also exits 0 on the real store-commit files", () => {
  const root = mkRoot();
  try {
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 0, `the full criterion must exit 0: ${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ①: a state dropped from the DECLARATION is refused, naming that state ───────────────

test("dropping not-in-git from the CommitOutcome declaration is refused as state-missing:not-in-git", () => {
  const root = mkRoot();
  try {
    const original = getFile(root, PRIM);
    const mutated = dropState(original, "not-in-git");
    assert.notEqual(mutated, original, "the mutation must actually remove the state");
    // The DECLARATION lost it — the file still mentions the state in return statements and comments,
    // which is exactly the reading the predicate must NOT be satisfied by.
    assert.doesNotMatch(mutated.match(DECL)?.[0] ?? "", /not-in-git/);
    assert.ok(mutated.includes('"not-in-git"'), "other occurrences of the state name must survive");
    putFile(root, PRIM, mutated);
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1, "a three-state declaration must not satisfy the predicate");
    assert.match(r.stderr, /CAUSE=state-missing:not-in-git\b/);
    // The causes are not interchangeable: ① is about the VOCABULARY, ② about the FORWARDING SURFACE,
    // ③ about the RETIRED HELPERS. A predicate that reported one for another would be unattributable
    // (hard rule 3b).
    assert.doesNotMatch(r.stderr, /CAUSE=import-surface-not-forwarding/);
    assert.doesNotMatch(r.stderr, /CAUSE=legacy-boolean-commit-functions/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ②: a forwarding surface that stops forwarding — a DIFFERENT cause from ① ──────────

test("a shim that stops forwarding to core is refused as import-surface-not-forwarding", () => {
  const root = mkRoot();
  try {
    const mutated = stopForwarding(getFile(root, SHIM));
    assert.notEqual(mutated, getFile(root, SHIM), "the mutation must actually rewrite the export line");
    putFile(root, SHIM, mutated);
    // The comment headers still MENTION `store-commit.ts` — the mutation is precisely "the export
    // line no longer points at the canonical module", not "the file is gone". A comment match must
    // not be able to satisfy the forwarding half.
    assert.ok(getFile(root, SHIM).includes("store-commit"), "the header comment must survive the mutation");
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1, "a shim that does not forward must not satisfy the predicate");
    assert.match(r.stderr, /CAUSE=import-surface-not-forwarding\b/);
    assert.doesNotMatch(r.stderr, /CAUSE=state-missing:/);
    assert.doesNotMatch(r.stderr, /CAUSE=legacy-boolean-commit-functions/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ③: the retired boolean helper comes back — a THIRD, distinct cause ─────────────────

test("a restored legacy boolean helper is refused as legacy-boolean-commit-functions", () => {
  const root = mkRoot();
  try {
    putFile(
      root,
      PRIM,
      getFile(root, PRIM) + "\nexport function commitMetaFileAfterWrite(): boolean {\n  return false;\n}\n",
    );
    // The four-state half still holds — the mutation is precisely "the old boolean path is back",
    // not "the vocabulary regressed".
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1, "a restored boolean helper must not satisfy the predicate");
    assert.match(r.stderr, /CAUSE=legacy-boolean-commit-functions\b/);
    assert.match(r.stderr, /仍有 1 个文件/);
    assert.doesNotMatch(r.stderr, /CAUSE=state-missing:/);
    assert.doesNotMatch(r.stderr, /CAUSE=import-surface-not-forwarding/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ④: the decisive anti-over-approximation case — a comment is not a member ──────────

test("a state named ONLY in a comment is refused (the predicate reads the declaration, not the file)", () => {
  const root = mkRoot();
  try {
    const original = getFile(root, PRIM);
    const mutated =
      "// STATES: committed | unchanged | not-in-git | failed\n" + dropState(original, "not-in-git");
    assert.ok(mutated.includes("not-in-git"), "the comment mention must survive");
    assert.doesNotMatch(mutated.match(DECL)?.[0] ?? "", /not-in-git/, "the declaration must no longer carry it");
    putFile(root, PRIM, mutated);
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1, "a whole-file grep would pass here; the declaration-block read must not");
    assert.match(r.stderr, /CAUSE=state-missing:not-in-git\b/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ⑤: the declaration itself disappears — a distinct cause, ⛔ not "state-missing" ────

test("a missing CommitOutcome declaration is refused as outcome-declaration-missing", () => {
  const root = mkRoot();
  try {
    const mutated = getFile(root, PRIM).replace(/^export type CommitOutcome =/m, "type CommitOutcomeRenamed =");
    assert.notEqual(mutated, getFile(root, PRIM), "the mutation must actually rename the declaration");
    putFile(root, PRIM, mutated);
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /CAUSE=outcome-declaration-missing\b/);
    // "the declaration is gone" must not wear the shape of "this state is missing from it": the
    // latter asserts something about a declaration that does not exist (hard rule 3b).
    assert.doesNotMatch(r.stderr, /CAUSE=state-missing:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the regression guard: the predicate must NOT silently return to a whole-file state grep ────

test("the block is structural — it reads the declaration block, not the whole file", () => {
  const block = predicateBlock();
  // POSITION, not keyword (hard rule 2): the block's own COMMENT *describes* the retired text as the
  // rationale for the re-anchor, so a whole-block substring check would fire on the explanation rather
  // than on an executable line. Only lines the shell would actually RUN are inspected.
  const executable = block
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // The rot shape this task repaired: grepping the state names in a file with no notion of WHERE in
  // the file they appear.
  assert.doesNotMatch(executable, /grep\s+-q\s+'not-in-git'\s+packages\/quay\/src\/store-commit\.ts/);
  assert.doesNotMatch(executable, /grep\s+-q\s+'unchanged'\s+packages\/quay\/src\/store-commit\.ts/);
  // …and the vocabulary half must be a read of the DECLARATION block, not of the file.
  assert.match(executable, /awk '[^']*export type CommitOutcome/);
  // The forwarding half must name the canonical target, ⛔ not merely "some store-commit file".
  assert.match(executable, /export \\\* from "\\\.\/core\/store-commit\\\.ts"/);
});
