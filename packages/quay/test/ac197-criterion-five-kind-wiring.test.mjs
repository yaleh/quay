// @test-group product
//
// ac197-criterion-five-kind-wiring.test.mjs — the fixture for the RE-ANCHORED five-kind-wiring
// predicate of `goals/AC-197-*.md`'s criterion (gap-ac197-criterion-commitstorewrite-identifier-pin-stale).
//
// WHAT THIS FILE IS FOR. The AC-197 criterion asserts that all five store kinds (tasks / goals / meta /
// adr / docs-managed) are wired to the ONE shared store-commit primitive. The ORIGINAL text phrased that
// as `n="$(grep -l commitStoreWrite <the five store files> | wc -l)"; test "$n" -eq 5` — an IDENTIFIER
// key, not a structural one: it read "does this function name appear in these files", never "are the
// five kinds wired". `943ef47f6` (store-commit: one commitKindFile wrapper replaces four per-kind copies)
// folded the four byte-identical per-kind copies into the single shared wrapper at
// `packages/quay/src/store-commit.ts`, deleting the literal from four of the five files. The five-kind
// guarantee was never lost — it is strictly STRONGER today (one primitive + one wrapper) — but the
// criterion went from n=5 to n=1 and could not be true on any tree. The predicate is now structural
// (dependency on the primitive module + a call site in each store); this fixture pins that structure so
// the same identifier-keyed rot cannot silently return (casebook rule: an extraction ratchet must key on
// structure, not identifiers).
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT (hard rule 4). The `five-kind-wiring`
// block is extracted VERBATIM from the goal file's criterion — the same text `quay goal gate AC-197`
// runs — and executed under `sh` against a temp root holding real copies of the store files. A
// reimplementation here would be an echo of the criterion rather than a measurement of it: it would stay
// green while the criterion rotted, which is exactly the failure this task exists to repair.
//
// BOTH DIRECTIONS ARE COVERED (hard rule 4 corollary 3 — a predicate that cannot be false is not a
// measurement). The unmutated positive control is paired with four structurally distinct negatives, each
// asserted BY ITS OWN NAMED `CAUSE=` token so "refused for reason A" can never be read as "refused for
// reason B": a store that merely IMPORTS the primitive without calling it, a `commitKindFile` that no
// longer delegates (a second parallel primitive), a primitive whose export disappeared, and a wrapper
// whose export disappeared. ⛔ Every mutation is applied to a TEMP ROOT copy; no production file is
// touched by this fixture.

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

const MARK_START = ">>> five-kind-wiring";
const MARK_END = "<<< five-kind-wiring";

/** The one goal file this fixture is pinned to. Resolved by id prefix, so a rename that keeps the id
 *  still resolves; a missing file fails loudly rather than skipping. */
function goalFilePath() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-197-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-197-*.md under ${dir}`);
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
    "commitStoreWrite",
    "export function commitKindFile",
    "store-commit\\.ts",
    'test "$n" -eq 5',
  ]) {
    assert.ok(block.includes(needle), `extracted block does not contain ${needle}`);
  }
  return block;
}

/** The one shared primitive module, and the five store files it must be wired into. */
const PRIM = "packages/quay/src/store-commit.ts";
const STORES = [
  "packages/quay/src/goal-store.ts",
  "packages/quay/src/meta-store.ts",
  "packages/quay/src/adr-store.ts",
  "packages/quay/src/document-store.ts",
  "packages/quay-native/src/store.ts",
];

/**
 * A fresh temp root that IS a git root, holding real copies of the primitive + the five stores under
 * their repo-relative paths (the criterion addresses them relatively, so cwd == the root is what makes
 * it addressable). `git init` is not needed by the predicate itself (it is pure grep/awk) but keeps the
 * root shaped like the root the gate runs in.
 */
function mkRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ac197-wiring-")));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  for (const rel of [PRIM, ...STORES]) {
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

/** NEGATIVE ①: drop the call sites, keep the import — "depends on the module but never calls it". */
function stripCallSites(text) {
  return text
    .split("\n")
    .filter((l) => !/commit(StoreWrite|KindFile|StoreBatch)\(/.test(l))
    .join("\n");
}

/** NEGATIVE ②: make `commitKindFile` stop delegating — a SECOND parallel primitive. */
function breakDelegation(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("export function commitKindFile("));
  assert.ok(start >= 0, "store-commit.ts has no `export function commitKindFile(` to mutate");
  const end = lines.findIndex((l, i) => i > start && l === "}");
  assert.ok(end > start, "no top-level `}` closes the commitKindFile body");
  return [...lines.slice(0, start + 1), '  return "unchanged";', ...lines.slice(end)].join("\n");
}

// ── positive control: the shipped block is TRUE on the real, unmutated tree ──────────────────────

test("the shipped predicate block passes on the real store files (positive control)", () => {
  const root = mkRoot();
  try {
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 0, `the re-anchored predicate must be true on the real tree: ${r.stderr}`);
    assert.match(r.stdout, /OK — one shared store-commit primitive/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the whole criterion text (not just the block) also exits 0 on the real store files", () => {
  const root = mkRoot();
  try {
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 0, `the full criterion must exit 0: ${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ①: wired by import only — the call-site half of the conjunction is what catches it ──

test("a store that imports the primitive but never calls it is refused, naming 5->4", () => {
  const root = mkRoot();
  try {
    const victim = "packages/quay/src/meta-store.ts";
    putFile(root, victim, stripCallSites(getFile(root, victim)));
    assert.ok(getFile(root, victim).includes("store-commit.ts"), "the import must survive the mutation");
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1, "an import with no call site must not satisfy the predicate");
    assert.match(r.stderr, /CAUSE=store-commit-call-site-missing-in-all-5\b/);
    assert.match(r.stderr, /n=4 ≠ 5/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ②: a second parallel primitive — a DIFFERENT cause from ① ───────────────────────────

test("a commitKindFile that stops delegating is refused as second-primitive (cause ≠ negative ①)", () => {
  const root = mkRoot();
  try {
    putFile(root, PRIM, breakDelegation(getFile(root, PRIM)));
    // The two export checks above it still hold — the mutation is precisely "the wrapper exists but
    // does not delegate", not "the wrapper is gone".
    const mutated = getFile(root, PRIM);
    assert.ok(mutated.includes("export function commitStoreWrite"));
    assert.ok(mutated.includes("export function commitKindFile"));
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1, "a wrapper that does not delegate must not satisfy the predicate");
    assert.match(r.stderr, /CAUSE=second-primitive\b/);
    // The causes are not interchangeable: ① is about the CALL SITE, ② is about the PRIMITIVE. A
    // predicate that reported one for the other would be unattributable (hard rule 3b).
    assert.doesNotMatch(r.stderr, /CAUSE=store-commit-call-site-missing-in-all-5/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negatives ③/④: the primitive or the wrapper itself disappears ────────────────────────────────

test("a primitive module that no longer exports commitStoreWrite is refused as primitive-missing", () => {
  const root = mkRoot();
  try {
    putFile(root, PRIM, getFile(root, PRIM).replace("export function commitStoreWrite", "function commitStoreWrite"));
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /CAUSE=primitive-missing\b/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a primitive module that no longer exports commitKindFile is refused as wrapper-missing", () => {
  const root = mkRoot();
  try {
    putFile(root, PRIM, getFile(root, PRIM).replace("export function commitKindFile", "function commitKindFile"));
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /CAUSE=wrapper-missing\b/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the regression guard: the predicate must NOT silently return to an identifier key ────────────

test("the block is structural — it does not re-pin on the commitStoreWrite identifier", () => {
  const block = predicateBlock();
  // POSITION, not keyword (hard rule 2): the block's own COMMENT *describes* the old identifier-keyed
  // text as the rationale for the re-anchor — the verbatim predicate lives in the record's `origin`, not
  // in the criterion — so a whole-block substring check would fire on the explanation rather than on an
  // executable line. Only lines the shell would actually RUN are inspected.
  const executable = block
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // The rot shape this task repaired: counting files that merely CONTAIN the literal.
  assert.doesNotMatch(executable, /grep\s+-l\s+commitStoreWrite/);
  assert.doesNotMatch(executable, /grep\s+-rc?\s+commitStoreWrite/);
  // …and the per-store arm must be a conjunction of DEPENDENCY and CALL SITE, not a bare mention.
  assert.match(executable, /grep -q 'store-commit\\\.ts' "\$f" && grep -qE '/);
});
