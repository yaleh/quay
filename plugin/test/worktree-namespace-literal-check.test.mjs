// @test-group engine
// worktree-namespace-literal-check.test.mjs — AC3 of
// gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root, WITH its two-way control.
//
// AC3's predicate is the task's own grep: `grep -rn '"quay-worktrees"' packages/quay/src plugin/scripts`
// ≤ 1 hit, the single hit being the resolver's fallback declaration. A check that can only ever print
// PASS is not a check (hard rule ③b: a structurally-always-green check is more expensive than no
// check) — so every fixture below is a REAL tree on disk, and the two RED fixtures prove the checker
// BITES: put the literal back in a second file and it must FAIL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkWorktreeNamespaceLiteral,
  SCAN_ROOTS,
  RESOLVER_REL,
} from "../scripts/worktree-namespace-literal-check.ts";
import { DEFAULT_WORKTREE_NAMESPACE_NAME } from "../../packages/quay/src/worktree-namespace.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAME = DEFAULT_WORKTREE_NAMESPACE_NAME;

/** Materialize a fixture tree: `files` is { relPath: content }. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wtns-literal-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

const DECLARATION = `export const DEFAULT_WORKTREE_NAMESPACE_NAME = "${NAME}";\n`;

test("GREEN: the real repo holds exactly ONE double-quoted literal, and it is the resolver's declaration", () => {
  const report = checkWorktreeNamespaceLiteral(REPO_ROOT);
  assert.equal(report.ok, true, report.reason);
  assert.equal(report.hits.length, 1, `AC3: ≤1 hit, got ${report.hits.length}`);
  assert.equal(report.hits[0].file, RESOLVER_REL);
  assert.match(report.hits[0].text, /DEFAULT_WORKTREE_NAMESPACE_NAME/,
    "the single hit is the fallback declaration — not some other reader spelling the name");
  // The advisory half is REPORTED (硬规则 5b sibling visibility), never silently dropped.
  assert.ok(Array.isArray(report.advisory));
  for (const a of report.advisory) {
    assert.equal(a.text.includes(JSON.stringify(NAME)), false,
      `advisory entries must be the UNQUOTED occurrences only (${a.file}:${a.line})`);
  }
});

test("RED (control 1): a second double-quoted literal anywhere in the scan roots FAILS", () => {
  const root = fixture({
    [RESOLVER_REL]: DECLARATION,
    "packages/quay/src/some-reader.ts": `const ns = path.join(root, "${NAME}");\n`,
  });
  try {
    const report = checkWorktreeNamespaceLiteral(root);
    assert.equal(report.ok, false, "a re-grown literal must be caught");
    assert.equal(report.hits.length, 2);
    assert.ok(report.hits.some((h) => h.file === "packages/quay/src/some-reader.ts"),
      "the offending site is named");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RED (control 2): the literal in a plugin script FAILS too (both scan roots are covered)", () => {
  const root = fixture({
    [RESOLVER_REL]: DECLARATION,
    "plugin/scripts/some-driver.ts": `const dir = path.join(path.dirname(mainRoot), "${NAME}");\n`,
  });
  try {
    assert.equal(checkWorktreeNamespaceLiteral(root).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RED (control 3): the ONLY hit outside the resolver declaration FAILS (the name must live on the single entry)", () => {
  const root = fixture({
    "packages/quay/src/elsewhere.ts": `export const X = "${NAME}";\n`,
  });
  try {
    const report = checkWorktreeNamespaceLiteral(root);
    assert.equal(report.ok, false, "a lone literal in a non-resolver file is exactly the drift the invariant forbids");
    assert.match(report.reason, /NOT the DEFAULT_WORKTREE_NAMESPACE_NAME declaration/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GREEN: zero hits passes (≤1) — and unquoted occurrences are advisory only", () => {
  const root = fixture({
    "packages/quay/src/reader.ts": `const re = /^.*\\/${NAME}\\/[^/]+\\/(.+)$/;\n// mentions ${NAME} in prose\n`,
  });
  try {
    const report = checkWorktreeNamespaceLiteral(root);
    assert.equal(report.ok, true, "the AC's predicate is the QUOTED literal; unquoted regex/comment uses are advisory");
    assert.equal(report.hits.length, 0);
    assert.equal(report.advisory.length, 2, "both unquoted lines are reported, not hidden");
    assert.deepEqual(SCAN_ROOTS, ["packages/quay/src", "plugin/scripts"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
