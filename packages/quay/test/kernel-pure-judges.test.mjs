// @test-group product
// kernel-pure-judges.test.mjs — the pure judges converged by
// gap-three-pure-judges-kernel-single-def (AC-909 / GOAL-906), plus `stripTouchAnnotation` added by
// gap-routine-semantic-dedup-scan-strip-touch-annotation (a fourth two-copy algorithm the semantic
// dedup scan found: plugin/scripts/touches-parser.ts + packages/quay/src/observation.ts).
//
// WHAT THIS FILE IS FOR. The task's motivating fact is structural: `countAcCheckboxes`,
// `stripTrailingFullWidthAnnotation` and `expandGlob` each existed as TWO byte-identical definitions
// with no import edge between them. A purely behavioral suite would have passed BEFORE the fix too
// (both copies behaved the same) — 硬规则 4 推论三's shape. So the assertions here are:
//
//   ① SINGLE DEFINITION — each name has exactly ONE `function`/`const … = function` declaration on
//      the three trees the AC scans (`packages/quay/src`, `plugin/scripts`, `scripts`), and it is
//      under `packages/quay/src/kernel/`.
//   ② IDENTITY — the product entry (task-parsing.ts), the mechanism entry (task-schema.ts) and the
//      kernel leaf expose the SAME function object. A re-introduced local copy breaks this even if
//      its body is byte-identical.
//   ③ BEHAVIOR — `null` fail-closed shape (countAcCheckboxes), nested full-width paren stripping
//      (stripTrailingFullWidthAnnotation), whole-segment wildcard expansion (expandGlob). These are
//      the three input classes AC5 names; each has a negative-control half so it cannot pass
//      vacuously.
//   ④ stripTouchAnnotation is BOTH single-definition (①) and the same object the plugin parser and
//      Core's observation.ts use — the delegation assertion at the bottom of ②.
//
// Run: node --no-warnings --experimental-strip-types --test packages/quay/test/kernel-pure-judges.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { countAcCheckboxes } from "../src/kernel/ac-checkbox-count.ts";
import { stripTrailingFullWidthAnnotation, stripTouchAnnotation as kernelStripTouchAnnotation } from "../src/kernel/touches-annotation.ts";
import { expandGlob } from "../src/kernel/glob-expand.ts";
import { countAcCheckboxes as fromProductEntry } from "../src/task-parsing.ts";
import { countAcCheckboxes as fromMechanismEntry } from "../../../plugin/scripts/task-schema.ts";
import { stripTouchAnnotation } from "../../../plugin/scripts/touches-parser.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

// ── ① ONE definition, and it lives in kernel/ ────────────────────────────────────────────────────
// Same surfaces the task's AC1/AC2 scan (by position — declaration lines, never prose mentions).
const SCAN_TREES = ["packages/quay/src", "plugin/scripts", "scripts"];
const JUDGES = ["countAcCheckboxes", "stripTrailingFullWidthAnnotation", "stripTouchAnnotation", "expandGlob"];

function walkTs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "archive") continue;
      walkTs(abs, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(abs);
    }
  }
  return out;
}

test("① each pure judge is DECLARED exactly once, under packages/quay/src/kernel/", () => {
  const files = SCAN_TREES.flatMap((rel) => walkTs(path.join(REPO_ROOT, rel)));
  assert.ok(files.length > 100, `scan surface must be real, found ${files.length} .ts files`);

  for (const name of JUDGES) {
    // Declaration position: `function <name>` (the shape the AC's grep counts). A COMMENT mentioning
    // the name does not match because the declaration regex is anchored on the keyword itself.
    const declRe = new RegExp(`\\bfunction\\s+${name}\\b`);
    const hits = files
      .map((abs) => ({ abs: path.relative(REPO_ROOT, abs).split(path.sep).join("/"), src: fs.readFileSync(abs, "utf8") }))
      .filter(({ src }) => declRe.test(src))
      .map(({ abs }) => abs);
    assert.equal(hits.length, 1, `${name} must have exactly 1 definition, found ${hits.length}: ${hits.join(", ")}`);
    assert.ok(
      hits[0].startsWith("packages/quay/src/kernel/"),
      `${name} definition must live under packages/quay/src/kernel/, got ${hits[0]}`,
    );
  }
});

// ── ② the two import surfaces reach the SAME object ──────────────────────────────────────────────
test("② product entry, mechanism entry and kernel leaf expose the SAME countAcCheckboxes object", () => {
  assert.equal(fromProductEntry, countAcCheckboxes, "task-parsing.ts must re-export the kernel definition");
  assert.equal(fromMechanismEntry, countAcCheckboxes, "task-schema.ts must re-export the kernel definition");
});

// The plugin Touches parser re-exports the kernel's stripTouchAnnotation (not a copy). Identity —
// not just equal behavior — is the assertion: a byte-identical re-implementation would fail here.
test("② plugin touches-parser re-exports the KERNEL stripTouchAnnotation object", () => {
  assert.equal(
    stripTouchAnnotation,
    kernelStripTouchAnnotation,
    "touches-parser.ts must import/re-export the kernel stripTouchAnnotation, not carry a copy",
  );
});

// ── ③ behavior: the three input classes AC5 names ────────────────────────────────────────────────
test("③ countAcCheckboxes — null is FAIL-CLOSED, not { unchecked: 0 } (structural NaN)", () => {
  const absent = countAcCheckboxes(null);
  assert.equal(absent.sectionFound, false, "null ⇒ sectionFound:false");
  assert.ok(Number.isNaN(absent.total), "null ⇒ total NaN (old destructuring cannot read a pass)");
  assert.ok(Number.isNaN(absent.checked));
  assert.ok(Number.isNaN(absent.unchecked));

  // Negative control: the SAME assertions must be FALSE for a present-but-empty section, otherwise
  // the case above would be satisfied by a function that always returns the fail-closed shape.
  const empty = countAcCheckboxes("");
  assert.equal(empty.sectionFound, true);
  assert.equal(empty.total, 0);

  // `[~]` counts in total but as unchecked — the semantics all four historical counters disagreed on.
  const mixed = countAcCheckboxes("- [ ] a\n- [x] b\n- [X] c\n- [~] d\n");
  assert.deepEqual(mixed, { total: 4, checked: 2, unchecked: 2, sectionFound: true });
});

test("③ stripTrailingFullWidthAnnotation — NESTED full-width parens strip to the matching opener", () => {
  const nested = "plugin/scripts/（说明（新增…（运行时载体）…）后缀）";
  assert.equal(stripTrailingFullWidthAnnotation(nested), "plugin/scripts/", "nested pairs must be balanced-scanned, not regex-sliced");

  // Negative controls: an unbalanced trailing `）` (no matching opener) is LEFT ALONE, and ASCII `(`
  // inside the annotation is literal text, not the opener.
  assert.equal(stripTrailingFullWidthAnnotation("path/（没有配对"), "path/（没有配对");
  assert.equal(stripTrailingFullWidthAnnotation("path/（$() 命令替换）"), "path/");
  // No trailing annotation ⇒ unchanged (idempotent base case).
  assert.equal(stripTrailingFullWidthAnnotation("path/plain.ts"), "path/plain.ts");

  // The plugin's entry keeps the same reading through its two-part fixed-point wrapper.
  assert.equal(stripTouchAnnotation("x.ts（说明）(new)"), "x.ts");
});

test("③ expandGlob — a whole-segment `*` expands against the root; `*` never crosses `/`", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-glob-expand-"));
  try {
    fs.mkdirSync(path.join(root, "alpha/nested"), { recursive: true });
    fs.mkdirSync(path.join(root, "beta"), { recursive: true });
    fs.writeFileSync(path.join(root, "alpha/one.test.mjs"), "");
    fs.writeFileSync(path.join(root, "alpha/nested/deep.test.mjs"), "");
    fs.writeFileSync(path.join(root, "beta/two.test.mjs"), "");

    const got = expandGlob("*/test-less/*.test.mjs", root); // no match: `.test.mjs` is inside alpha, not a dir
    assert.deepEqual(got, [], "a non-matching pattern must yield [] (not throw)");

    const oneLevel = expandGlob("alpha/*.test.mjs", root);
    assert.deepEqual(
      oneLevel.map((p) => path.relative(root, p).split(path.sep).join("/")),
      ["alpha/one.test.mjs"],
      "`*` is one segment: alpha/nested/deep.test.mjs must NOT match alpha/*.test.mjs",
    );

    const twoLevel = expandGlob("*/*.test.mjs", root);
    assert.deepEqual(
      twoLevel.map((p) => path.relative(root, p).split(path.sep).join("/")).sort(),
      ["alpha/one.test.mjs", "beta/two.test.mjs"],
      "the wildcard segment expands over every matching directory",
    );

    const noWildcard = expandGlob("alpha/one.test.mjs", root);
    assert.deepEqual(noWildcard.map((p) => path.relative(root, p)), ["alpha/one.test.mjs"]);

    const missing = expandGlob("does-not-exist/*.test.mjs", root);
    assert.deepEqual(missing, [], "a missing non-wildcard segment filters out (old behavior preserved)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
