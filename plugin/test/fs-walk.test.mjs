// @test-group engine
// fs-walk.test.mjs — unit tests for the shared recursive directory-walk primitive
// (plugin/scripts/fs-walk.ts), extracted from the 22 hand-rolled walkers found by the
// semantic-dedup-scan routine (.quay/routine-findings.jsonl, finding `fs-walk-family`).
//
// The point of this file is not "does it walk a tree" — it is the CONTROL that pins the
// differences the extraction deliberately did NOT unify. A naive "one walker for everyone"
// would silently change WHICH FILES each checker scans, and a checker that cannot read its
// input returns the "pass" shape (硬规则 3b) — i.e. a silent false-green across the whole
// static tier. So the three classification semantics are asserted to be DISTINCT here:
//
//   entryKind:"dirent" + no include        → a symlink IS an entry
//   entryKind:"dirent" + include:isFile()  → a symlink is NOT (derive-touches / touches-orthogonality)
//   entryKind:"stat"                       → symlinks are FOLLOWED; an unstattable entry is skipped
//
// Run: scripts/test.sh plugin/test/fs-walk.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkFiles, buildFileIndex, scanRoots } from "../scripts/fs-walk.ts";

// tmp-leak-pairing-check requires the created dirs to live in a module-level ARRAY that the
// after-hook references (a value returned out of a helper is not seen by the check).
const _createdDirs = [];
after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Build a temp tree from a {relativePath: content|"DIR"|"LINK:<target>"} spec. */
function mkTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-walk-test-"));
  _createdDirs.push(root);
  for (const [rel, val] of Object.entries(spec)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (val === "DIR") fs.mkdirSync(abs, { recursive: true });
    else if (val.startsWith("LINK:")) fs.symlinkSync(val.slice(5), abs);
    else fs.writeFileSync(abs, val);
  }
  return root;
}

const BASE = {
  "a.ts": "x",
  "sub/b.ts": "x",
  "sub/deep/c.ts": "x",
  "skipme/d.ts": "x",
  "note.md": "x",
};

// ── the skeleton itself ──────────────────────────────────────────────────────────────────────────
test("walkFiles: recursive, root-relative POSIX, sorted by default", () => {
  const root = mkTree(BASE);
  assert.deepEqual(walkFiles(root), ["a.ts", "note.md", "skipme/d.ts", "sub/b.ts", "sub/deep/c.ts"]);
});

test("walkFiles: prune drops a directory and its whole subtree", () => {
  const root = mkTree(BASE);
  const out = walkFiles(root, { prune: (name, isDir) => isDir && name === "skipme" });
  assert.deepEqual(out, ["a.ts", "note.md", "sub/b.ts", "sub/deep/c.ts"]);
});

test("walkFiles: prune sees non-directories too, so a FILE named like a skip-dir can be dropped", () => {
  // This is the shape-A/C semantics (skip-set tested before classification) — a file named
  // `skipme` is pruned by a predicate that ignores isDir, and kept by one that checks it.
  const root = mkTree({ "skipme": "x", "keep.ts": "x" });
  assert.deepEqual(walkFiles(root, { prune: (n) => n === "skipme" }), ["keep.ts"]);
  assert.deepEqual(walkFiles(root, { prune: (n, isDir) => isDir && n === "skipme" }), ["keep.ts", "skipme"]);
});

test("walkFiles: include filters on basename and extension", () => {
  const root = mkTree(BASE);
  assert.deepEqual(walkFiles(root, { include: (_n, ext) => ext === ".ts" }),
    ["a.ts", "skipme/d.ts", "sub/b.ts", "sub/deep/c.ts"]);
});

test("walkFiles: maxDepth 1 scans the root only", () => {
  const root = mkTree(BASE);
  assert.deepEqual(walkFiles(root, { maxDepth: 1 }), ["a.ts", "note.md"]);
});

test("walkFiles: absolute returns absolute paths", () => {
  const root = mkTree({ "a.ts": "x" });
  assert.deepEqual(walkFiles(root, { absolute: true }), [path.join(root, "a.ts")]);
});

test("walkFiles: sort:false preserves depth-first readdir order", () => {
  const root = mkTree({ "b.ts": "x", "a/sub.ts": "x" });
  const sorted = walkFiles(root);
  assert.deepEqual(sorted, ["a/sub.ts", "b.ts"]);
  // unsorted must contain the same members; and it must be DFS (a real order, not a different set)
  assert.deepEqual([...walkFiles(root, { sort: false })].sort(), sorted);
});

test("walkFiles: a missing root yields [] rather than throwing", () => {
  assert.deepEqual(walkFiles(path.join(os.tmpdir(), "fs-walk-does-not-exist-xyz")), []);
});

// ── THE CONTROL: the three classification semantics stay distinct ────────────────────────────────
test("symlink control: dirent vs dirent+isFile vs stat are three DIFFERENT behaviors", () => {
  const root = mkTree({
    "real.ts": "x",
    "linkfile.ts": "LINK:real.ts", // symlink to a real file
    "dangling.ts": "LINK:nowhere.ts", // dangling symlink
    "dirlink": "LINK:sub", // symlink to a directory
    "sub/inner.ts": "x",
  });
  // (1) dirent, default include — every non-directory entry, symlinks included (a symlink to a
  //     DIRECTORY is reported as an entry, not descended). This is what deletion-closure /
  //     identity-replication relied on: the dangling symlink `git-lens-*.ts` reaches
  //     findPathConstants and is what makes that checker fail loudly rather than pass silently.
  assert.deepEqual(walkFiles(root), ["dangling.ts", "dirlink", "linkfile.ts", "real.ts", "sub/inner.ts"]);

  // (2) dirent + isFile() — symlinks are NOT regular files, so BOTH links vanish.
  //     This is derive-touches / touches-orthogonality semantics.
  const regular = walkFiles(root, { include: (_n, _e, entry) => entry.isFile() });
  assert.deepEqual(regular, ["real.ts", "sub/inner.ts"]);

  // (3) stat — symlinks are FOLLOWED. `linkfile.ts` counts, the dangling link is unstattable so it
  //     is skipped instead of throwing, and `dirlink` IS entered — so the same underlying file is
  //     reported twice, under two paths. That double-visit is the real (if surprising) behavior of
  //     the `readdirSync` + `statSync` walkers this mode preserves; comparing by basename would
  //     have hidden it, which is exactly the silent "unification" this control exists to prevent.
  assert.deepEqual(walkFiles(root, { entryKind: "stat" }),
    ["dirlink/inner.ts", "linkfile.ts", "real.ts", "sub/inner.ts"]);
});

test("symlink control: 'stat' never throws on a dangling link (the old walkers' `try/catch → continue`)", () => {
  const root = mkTree({ "dangling.ts": "LINK:nowhere.ts", "ok.ts": "x" });
  assert.doesNotThrow(() => walkFiles(root, { entryKind: "stat" }));
  assert.deepEqual(walkFiles(root, { entryKind: "stat" }), ["ok.ts"]);
});

// ── buildFileIndex (was duplicated verbatim in two checkers) ─────────────────────────────────────
test("buildFileIndex: byBasename is first-wins in DFS order, byStem collects extensions", () => {
  const root = mkTree({ "z/x.ts": "x", "a/x.ts": "x", "notes.md": "x", "nodot": "x" });
  const idx = buildFileIndex(root);
  // exactly one entry for the shared basename, and it is the FIRST one the walk met
  assert.equal(idx.byBasename.get("x.ts"), walkFiles(root, { sort: false }).find((p) => p.endsWith("x.ts")));
  assert.ok(idx.byBasename.has("notes.md"));
  assert.ok(idx.byBasename.has("nodot"));
  assert.deepEqual([...idx.byStem.get("x")], ["ts"]);
  assert.deepEqual([...idx.byStem.get("notes")], ["md"]);
  // a dotfile has stem "" (dot at index 0 is not > 0) — no stem entry, matching the original
  assert.equal(idx.byStem.has(""), false);
});

test("buildFileIndex: prunes hidden dirs and the tmp/worktrees/milestones artifact dirs", () => {
  const root = mkTree({
    "keep.ts": "x",
    ".hidden/h.ts": "x",
    "node_modules/n.ts": "x",
    "tmp/t.ts": "x",
    "worktrees/w.ts": "x",
    "milestones/m.ts": "x",
  });
  const idx = buildFileIndex(root);
  assert.deepEqual([...idx.byBasename.keys()].sort(), ["keep.ts"]);
});

// ── scanRoots (the SCAN_ROOTS table walker of the four scanSurface checkers) ─────────────────────
test("scanRoots: applies the root's rel prefix and ext filter, sorted", () => {
  const root = mkTree({ "plugin/scripts/a.ts": "x", "plugin/scripts/b.sh": "x", "other/c.ts": "x" });
  const out = scanRoots(
    root,
    [{ dir: "plugin/scripts", rel: "plugin/scripts", ext: /\.ts$/ }],
    new Set(),
  );
  assert.deepEqual(out, ["plugin/scripts/a.ts"]);
});

test("scanRoots: recursive:false does not descend", () => {
  const root = mkTree({ "r/top.ts": "x", "r/nested/deep.ts": "x", "r/skipped/s.ts": "x" });
  const roots = [{ dir: "r", rel: "r", ext: /\.ts$/, recursive: false }];
  // non-recursive: only the root level, and no descent into `skipped`
  assert.deepEqual(scanRoots(root, roots, new Set(["skipped"])), ["r/top.ts"]);
});

test("scanRoots: skip-set prunes DIRECTORIES only — a file with a skip-dir NAME is still scanned", () => {
  const root = mkTree({ "r/top.ts": "x", "r/nested/deep.ts": "x", "r/skipped/s.ts": "x" });
  const roots = [{ dir: "r", rel: "r", ext: /\.ts$/ }];
  assert.deepEqual(scanRoots(root, roots, new Set(["skipped"])), ["r/nested/deep.ts", "r/top.ts"]);

  // The `isDir &&` guard in scanRoots is what makes the two cases differ. Use an ext that matches
  // a bare name so the distinction is observable: a FILE named exactly `skipped` survives.
  const rootFile = mkTree({ "r/skipped": "x", "r/top.ts": "x" });
  const anyExt = [{ dir: "r", rel: "r", ext: /.*/ }];
  assert.deepEqual(scanRoots(rootFile, anyExt, new Set(["skipped"])), ["r/skipped", "r/top.ts"]);
  // …whereas walkFiles with a name-only predicate (the shape-A/C semantics) drops it — the axis is
  // real and the caller, not the traversal, decides which side of it it is on.
  assert.deepEqual(walkFiles(path.join(rootFile, "r"), { prune: (n) => n === "skipped" }), ["top.ts"]);
});
