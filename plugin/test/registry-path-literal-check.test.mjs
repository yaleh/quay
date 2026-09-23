// @test-group engine
// registry-path-literal-check.test.mjs — AC5 of gap-registry-path-second-copy-five-checker-sites,
// WITH its two-way control.
//
// AC5's predicate is the task's own grep: the registry path spelled as three adjacent double-quoted
// segments (plugin + scripts + the registry file name) over plugin/scripts + packages/quay/src must be
// 0 hits — and AC1's companion demands the predicate be dry-run against a KNOWN-TRUE sample, so the
// zero is a measurement and not a vacuous one (硬规则 2/4: a structurally-always-zero reading carries
// no information and is indistinguishable from "everything is fine").
//
// So every fixture below is a REAL tree on disk, and the RED fixtures prove the checker BITES: put the
// second copy back and it must FAIL. The predicate is DERIVED here from the same declaration the
// checker derives it from — a test that re-spelled the path would pass for the wrong reason the day
// the registry is renamed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRegistryPathLiteral,
  registryPathPattern,
  SCAN_ROOTS,
} from "../scripts/registry-path-literal-check.ts";
import {
  REGISTRY_BASENAME,
  REGISTRY_REL_CANDIDATES,
} from "../scripts/select-static-checks-for-touches.ts";
// The single regex escaper — the expected pattern is built with the SAME helper the checker uses, so
// this test re-derives the expectation instead of hardcoding a second copy of it (硬规则 5b).
import { escapeRegExp } from "../scripts/regex-escape.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The primary layout, and the SAME path spelled the way the defect spells it (derived, never typed). */
const PRIMARY = REGISTRY_REL_CANDIDATES[0];
const JOINED_LITERAL = PRIMARY.split("/").filter(Boolean).map((s) => JSON.stringify(s)).join(", ");

/** Materialize a fixture tree: `files` is { relPath: content }. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-path-literal-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

/** The defect's exact shape: the path's segments as three adjacent string literals. */
const SECOND_COPY = `const staticGate = path.join(root, ${JOINED_LITERAL});\n`;
/** The ALLOWED shape: the same location, derived from the declaration's own constant. */
const DERIVED_FORM = `const staticGate = path.join(root, REGISTRY_REL_CANDIDATES[0]);\n`;

test("the predicate is DERIVED from the declaration (never a second copy of it)", () => {
  const re = registryPathPattern();
  assert.ok(re instanceof RegExp, "the pattern must build from the declaration");
  // Structural equality against a re-derivation from the declaration: proves both the segment SET and
  // the separators come from REGISTRY_REL_CANDIDATES[0], i.e. nobody could have typed the needle.
  const expected = PRIMARY.split("/").filter(Boolean)
    .map((s) => escapeRegExp(JSON.stringify(s)))
    .join("\\s*,\\s*");
  assert.equal(re.source, expected, "the needle must be exactly the derivation of the declaration");
  // The dry run against a known-true sample (AC1's companion动作): the derived pattern DOES match the
  // joined-literal form. Without this the "0 hits on the repo" reading above proves nothing.
  assert.ok(re.test(SECOND_COPY), "the predicate must match the defect shape it exists to catch");
  assert.ok(!re.test(DERIVED_FORM), "reading REGISTRY_REL_CANDIDATES[0] is the FIX, not a hit");
});

test("GREEN: the real repo holds ZERO second copies of the registry path", () => {
  const report = checkRegistryPathLiteral(REPO_ROOT);
  assert.equal(report.ok, true, report.reason);
  assert.equal(report.hits.length, 0, `AC1: 0 hits, got ${report.hits.length}`);
  // The advisory half (data/prose mentions) is REPORTED, never silently dropped (硬规则 5b).
  assert.ok(Array.isArray(report.advisory));
  for (const a of report.advisory) {
    assert.equal(registryPathPattern().test(a.text), false,
      `advisory entries must be NON-joined occurrences only (${a.file}:${a.line})`);
  }
});

test("RED (control 1): a second copy under plugin/scripts FAILS", () => {
  const root = fixture({
    "plugin/scripts/some-checker.ts": SECOND_COPY,
  });
  try {
    const report = checkRegistryPathLiteral(root);
    assert.equal(report.ok, false, "a re-grown second copy must be caught");
    assert.equal(report.hits.length, 1);
    assert.equal(report.hits[0].file, "plugin/scripts/some-checker.ts");
    assert.equal(report.hits[0].line, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RED (control 2): a second copy under packages/quay/src FAILS too (both scan roots covered)", () => {
  const root = fixture({
    "packages/quay/src/fan-in/ff-merge.ts": `const registry = ${JOINED_LITERAL};\n`,
  });
  try {
    const report = checkRegistryPathLiteral(root);
    assert.equal(report.ok, false, "the second scan root must be covered");
    assert.equal(report.hits.length, 1);
    assert.match(report.reason, /packages\/quay\/src\/fan-in\/ff-merge\.ts:1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RED (control 3): the count is EXACT — two second copies are both named", () => {
  const root = fixture({
    "plugin/scripts/a.ts": SECOND_COPY,
    "plugin/scripts/b.ts": `const x = 1;\n${SECOND_COPY}`,
  });
  try {
    const report = checkRegistryPathLiteral(root);
    assert.equal(report.ok, false);
    assert.equal(report.hits.length, 2);
    assert.deepEqual(report.hits.map((h) => h.line), [1, 2]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GREEN: the DERIVED form and data/prose mentions are advisory-or-absent, never a red (负控制)", () => {
  const root = fixture({
    // The fix shape: reads the declaration's own constant — must NOT be a hit.
    "plugin/scripts/derived.ts": DERIVED_FORM,
    // The declaration itself: it holds only the BASENAME, in the single-source module.
    "plugin/scripts/select-static-checks-for-touches.ts":
      `export const REGISTRY_BASENAME = ${JSON.stringify(REGISTRY_BASENAME)};\n` +
      `export const REGISTRY_REL_CANDIDATES = [path.posix.join("plugin", "scripts", REGISTRY_BASENAME)];\n`,
    // Data/prose: a manifest key and a find(1) glob name the file without composing a path (硬规则 2).
    "plugin/scripts/some-manifest.json": `{"${REGISTRY_BASENAME}": "a description, not a path"}\n`,
    "plugin/scripts/find-uses.sh": `find "\${WORK}" -name '${REGISTRY_BASENAME}' -delete\n`,
  });
  try {
    const report = checkRegistryPathLiteral(root);
    assert.equal(report.ok, true,
      "neither the derived form nor a data/prose mention is a second copy of the path");
    assert.equal(report.hits.length, 0);
    assert.ok(report.advisory.length >= 1, "the sibling mentions are still REPORTED, not hidden");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the scan surface is the AC's own two arguments", () => {
  assert.deepEqual(SCAN_ROOTS, ["plugin/scripts", "packages/quay/src"]);
});
