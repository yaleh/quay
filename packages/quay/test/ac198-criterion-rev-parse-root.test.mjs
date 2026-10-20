// @test-group product
//
// ac198-criterion-rev-parse-root.test.mjs — the fixture for the RE-ANCHORED rev-parse-root predicate of
// `goals/AC-198-*.md`'s criterion (gap-ac198-criterion-rev-parse-root-carrier-stale).
//
// WHAT THIS FILE IS FOR. The AC-198 criterion asserts that the git root is resolved through
// `git rev-parse --show-toplevel` rather than `path.dirname(<kind>Dir)`, and that the shared store-commit
// primitive derives its DEFAULT root from that resolver. The ORIGINAL text keyed the third arm on a PATH:
// `grep -q 'rev-parse' packages/quay/src/store-commit.ts`. `35dc5da93` (refactor(core): sink the gate
// substrate into src/core to break the ""<->gate directory SCC, 2026-10-18) moved the implementation DOWN
// to `packages/quay/src/core/store-commit.ts` and left the old src-root path as a pure forwarding
// re-export whose own header forbids re-adding implementation. The guarantee was never lost — it got
// strictly stronger (one implementation + one forwarding surface) — but the path-keyed arm went false on
// every tree. This fixture pins the STRUCTURAL re-anchor (hard rule 4c: the quantity the criterion names
// must survive every intermediate layer; the module's location is such a layer, its SYMBOL is not).
//
// THE UNIT UNDER TEST IS THE SHIPPED BLOCK, NOT A COPY OF IT (hard rule 4). The `rev-parse-root` block is
// extracted VERBATIM from the goal file's criterion — the same text `quay goal gate AC-198` runs — and
// executed under `sh` against a temp root holding a real copy of `packages/quay/src`. A reimplementation
// here would be an echo of the criterion rather than a measurement of it: it would stay green while the
// criterion rotted, which is exactly the failure this task exists to repair.
//
// BOTH DIRECTIONS ARE COVERED (hard rule 4 corollary 3 — a predicate that cannot be false is not a
// measurement). The unmutated positive control is paired with five structurally distinct negatives, each
// asserted BY ITS OWN NAMED `CAUSE=` token so "refused for reason A" can never be read as "refused for
// reason B": the resolver stops calling rev-parse, the resolver drops --show-toplevel, the primitive stops
// deriving its default root from the resolver, a banned dirname root is re-introduced, and a SECOND
// module defines the primitive. ⛔ Every mutation is applied to a TEMP ROOT copy; no production file is
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

const MARK_START = ">>> rev-parse-root";
const MARK_END = "<<< rev-parse-root";

/** The one goal file this fixture is pinned to. Resolved by id prefix, so a rename that keeps the id
 *  still resolves; a missing file fails loudly rather than skipping. */
function goalFilePath() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-198-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-198-*.md under ${dir}`);
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
    "resolveGitRoot",
    "rev-parse",
    "--show-toplevel",
    "path.dirname(goalDir)",
  ]) {
    assert.ok(block.includes(needle), `extracted block does not contain ${needle}`);
  }
  return block;
}

/** The carrier module the predicate resolves BY SYMBOL. Used only to apply mutations; the predicate
 *  itself never names this path (that is the whole point of the re-anchor). */
const PRIM = "packages/quay/src/core/store-commit.ts";

/**
 * A fresh temp root that IS a git root, holding a real copy of `packages/quay/src` under its
 * repo-relative path (the criterion addresses it relatively, so cwd == the root is what makes it
 * addressable). `git init` is not needed by the predicate itself (it is pure grep/awk) but keeps the
 * root shaped like the root the gate runs in.
 */
function mkRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ac198-revparse-")));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  fs.cpSync(path.join(REPO, "packages/quay/src"), path.join(dir, "packages/quay/src"), { recursive: true });
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

/**
 * Split `text` into the lines before a top-level function signature's opening line, the BODY lines, and
 * the closing `}` onward. The functions this fixture mutates end at the first line that IS a bare `}`
 * (all nested braces in the file are indented), so the split is exact and mutation-local: a change made
 * here cannot accidentally satisfy or break an arm that reads a DIFFERENT function.
 */
function splitFunction(text, signature) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(signature));
  assert.ok(start >= 0, `no line starts with ${signature}`);
  const end = lines.findIndex((l, i) => i > start && l === "}");
  assert.ok(end > start, `no top-level } closes ${signature}`);
  return { before: lines.slice(0, start + 1), body: lines.slice(start + 1, end), after: lines.slice(end) };
}

/** Apply `mutateBody` to ONE function's body and reassemble the file. */
function spliceFunction(text, signature, mutateBody) {
  const { before, body, after } = splitFunction(text, signature);
  return [...before, ...mutateBody(body), ...after].join("\n");
}

/** Body text of one function inside `text`. */
function functionBody(text, signature) {
  return splitFunction(text, signature).body.join("\n");
}

/** Every `CAUSE=` token the shipped predicate can emit. A negative asserts its own token is present
 *  AND that no sibling's token is — the causes are not interchangeable (hard rule 3b). */
const ALL_CAUSES = [
  "dirname-goaldir-root",
  "dirname-metadir-root",
  "primitive-definition-count-not-1",
  "resolvegitroot-not-rev-parse",
  "resolvegitroot-no-show-toplevel",
  "primitive-root-not-from-resolvegitroot",
];

function assertOnlyCause(r, own) {
  assert.equal(r.code, 1, `expected exit 1 for ${own}; got ${r.code} (stdout: ${r.stdout})`);
  assert.ok(r.stderr.includes(`CAUSE=${own}`), `stderr must name CAUSE=${own}: ${r.stderr}`);
  for (const other of ALL_CAUSES) {
    if (other === own) continue;
    assert.ok(!r.stderr.includes(`CAUSE=${other}`), `stderr must NOT name CAUSE=${other}: ${r.stderr}`);
  }
}

// ── positive control: the shipped block is TRUE on the real, unmutated tree ──────────────────────

test("the shipped predicate block passes on the real src tree (positive control)", () => {
  const root = mkRoot();
  try {
    const r = runSh(predicateBlock(), root);
    assert.equal(r.code, 0, `the re-anchored predicate must be true on the real tree: ${r.stderr}`);
    assert.match(r.stdout, /OK — git root from rev-parse --show-toplevel/);
    // The block resolved the carrier BY SYMBOL, not by a hardcoded path.
    assert.match(r.stdout, /exactly 1 module defines commitStoreWrite \(packages\/quay\/src\/core\/store-commit\.ts\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the whole criterion text (not just the block) also exits 0 on the real src tree", () => {
  const root = mkRoot();
  try {
    const r = runSh(criterionText(), root);
    assert.equal(r.code, 0, `the full criterion must exit 0: ${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ①: the resolver stops calling rev-parse ─────────────────────────────────────────────

test("a resolveGitRoot body without rev-parse is refused, naming resolvegitroot-not-rev-parse", () => {
  const root = mkRoot();
  try {
    const mutated = spliceFunction(getFile(root, PRIM), "export function resolveGitRoot(", (body) => {
      assert.ok(body.some((l) => l.includes('"rev-parse"')), "resolveGitRoot body should carry rev-parse");
      return body.map((l) => l.replace('"rev-parse", ', ""));
    });
    const body = functionBody(mutated, "export function resolveGitRoot(");
    assert.ok(!body.includes("rev-parse"), "the mutation must remove rev-parse from the body");
    assert.ok(body.includes("--show-toplevel"), "--show-toplevel must survive (cause separation)");
    putFile(root, PRIM, mutated);

    const r = runSh(predicateBlock(), root);
    assertOnlyCause(r, "resolvegitroot-not-rev-parse");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ②: the resolver stops asking for --show-toplevel (cause ≠ ①) ────────────────────────

test("a resolveGitRoot body without --show-toplevel is refused, naming resolvegitroot-no-show-toplevel", () => {
  const root = mkRoot();
  try {
    const mutated = spliceFunction(getFile(root, PRIM), "export function resolveGitRoot(", (body) =>
      body.map((l) => l.replace("--show-toplevel", "--show-prefix")),
    );
    const body = functionBody(mutated, "export function resolveGitRoot(");
    assert.ok(!body.includes("--show-toplevel"), "the mutation must remove --show-toplevel from the body");
    assert.ok(body.includes("rev-parse"), "rev-parse must survive (cause separation)");
    putFile(root, PRIM, mutated);

    const r = runSh(predicateBlock(), root);
    assertOnlyCause(r, "resolvegitroot-no-show-toplevel");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ③: the primitive stops deriving its default root from the resolver (cause ≠ ①/②) ──

test("a commitStoreWrite body that no longer calls resolveGitRoot is refused with its own cause", () => {
  const root = mkRoot();
  try {
    const mutated = spliceFunction(getFile(root, PRIM), "export function commitStoreWrite(", (body) =>
      body.map((l) => l.replace("resolveGitRoot(process.cwd())", "process.cwd()")),
    );
    const body = functionBody(mutated, "export function commitStoreWrite(");
    assert.ok(!body.includes("resolveGitRoot("), "the mutation must un-wire the default root");
    putFile(root, PRIM, mutated);

    const r = runSh(predicateBlock(), root);
    assertOnlyCause(r, "primitive-root-not-from-resolvegitroot");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ④: a banned path.dirname(<kind>Dir) root is re-introduced (cause ≠ ①/②/③) ─────────

test("a re-introduced `const root = path.dirname(goalDir)` is refused, naming dirname-goaldir-root", () => {
  const root = mkRoot();
  try {
    const victim = "packages/quay/src/core/goal-store.ts";
    putFile(root, victim, `${getFile(root, victim)}\nconst root = path.dirname(goalDir);\n`);
    assert.ok(getFile(root, victim).includes("const root = path.dirname(goalDir)"));

    const r = runSh(predicateBlock(), root);
    assertOnlyCause(r, "dirname-goaldir-root");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── negative ⑤: a SECOND module defines the primitive (cause ≠ ①/②/③/④) ────────────────────────

test("a second commitStoreWrite definition is refused, naming primitive-definition-count-not-1", () => {
  const root = mkRoot();
  try {
    const victim = "packages/quay/src/core/adr-store.ts";
    putFile(
      root,
      victim,
      `${getFile(root, victim)}\nexport function commitStoreWrite(_x: never): never { throw new Error("duplicate"); }\n`,
    );
    const n = execFileSync("sh", ["-c", "grep -rl 'export function commitStoreWrite' packages/quay/src --include='*.ts' | wc -l"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    assert.equal(n, "2", "the mutation must produce a second definition module");

    const r = runSh(predicateBlock(), root);
    assertOnlyCause(r, "primitive-definition-count-not-1");
    assert.match(r.stderr, /n=2/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the regression guard: the predicate must NOT silently return to a path key ──────────────────

test("the block resolves the carrier by symbol — it does not re-pin rev-parse on the retired path", () => {
  const block = predicateBlock();
  // POSITION, not keyword (hard rule 2): the block's own COMMENT *describes* the old path-keyed text as
  // the rationale for the re-anchor — the verbatim predicate lives in the record's `origin`, not in the
  // criterion — so a whole-block substring check would fire on the explanation rather than on an
  // executable line. Only lines the shell would actually RUN are inspected.
  const executable = block
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // The rot shape this task repaired: pinning `rev-parse` to the pre-refactor src-root carrier path.
  assert.doesNotMatch(executable, /rev-parse[^\n]*packages\/quay\/src\/store-commit\.ts/);
  assert.doesNotMatch(executable, /packages\/quay\/src\/store-commit\.ts[^\n]*rev-parse/);
  // …the carrier is resolved BY SYMBOL instead…
  assert.match(executable, /grep -rl 'export function commitStoreWrite' packages\/quay\/src/);
  // …and both body arms extract a FUNCTION BODY with awk, not "the file contains".
  assert.match(executable, /awk '[^\n]*resolveGitRoot\\\(/);
  assert.match(executable, /awk '[^\n]*commitStoreWrite\\\(/);
});
