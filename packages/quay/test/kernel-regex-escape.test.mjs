// @test-group product
// kernel-regex-escape.test.mjs — the kernel leaf `packages/quay/src/kernel/regex-escape.ts` and its
// plugin-side entry `plugin/scripts/regex-escape.ts`.
// (gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre; routine
// semantic-dedup-scan finding `escapere-escaperegex-escaperegexp-fndefre-stemre-escapere`.)
//
// WHAT THIS FILE IS FOR — and why the obvious test would have been the wrong one.
//
// The finding was "twelve byte-identical bodies under three names". The tempting test is therefore
// "the escape function escapes the right characters" — but that test PASSED before the fix too, twelve
// times over, in twelve files. It is the 硬规则 4 推论三 shape: a criterion satisfied by the old
// arrangement measures nothing about the change. A test of the FIX must fail if the duplication
// returns.
//
// So the assertions here are structural first and behavioral second:
//
//   ① SINGLE-SOURCE — the plugin entry and the kernel leaf must expose the SAME function object, and
//      the source tree must contain exactly ONE copy of the body. Re-introducing a local copy in any
//      of the twelve instruments leaves ①'s body-count assertion green only if the copy is a *call* —
//      which is the point: "one implementation" is checked as one BODY, not as one import statement.
//   ② IDENTITY — `store.ts` (product judge) and `ready-pool-check.ts` (methodology judge) reach the
//      same function. Both files used to document the agreement by comment ("Mirrors
//      ready-pool-check.ts's own escapeRegExp (same byte semantics — the single-judge contract)"); a
//      comment cannot go red, this can.
//   ③ BEHAVIOR — the 14 metacharacters, the no-op on plain section names, and the actual motivating
//      regression: an escaped heading must match its own literal line, which is what fails if the
//      parenthesis in `AC (draft)` is read as a capture group.
//   ④ THE FAMILY, re-run (added by gap-routine-semantic-dedup-scan-escaperegexp-sweep-missed-two) —
//      ①–③ were green while FOUR more members of the family were alive: two char-by-char `Set`-loop
//      rewrites, one single-quoted arrow, and one `String(s)`-receiver copy. ① could not see any of
//      them because it searches for one exact byte spelling. ④ judges the family on a declaration
//      predicate and a receiver-/quote-agnostic body predicate instead — see its own block below.
//
// The negative control (硬规则 2's zero-count half): assertion ③'s last case asserts the UNESCAPED
// pattern does NOT match, so the escaped case cannot be passing vacuously.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeRegExp } from "../src/kernel/regex-escape.ts";
import * as kernelNs from "../src/kernel/regex-escape.ts";
import * as pluginNs from "../../../plugin/scripts/regex-escape.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** The exact escaped body, as a fixed string — the thing that must exist ONCE.
 *  Assembled from single-quoted segments joined by a `fromCharCode` backslash ON PURPOSE: written as
 *  one ordinary (or template) literal it is mis-escaped by the source-literal layer — `${}` in the
 *  character class is a template interpolation, and `\\`/`\]` collapse differently per quoting. The
 *  needle is the assertion's own input, so an escaping slip here would silently make the test pass by
 *  searching for something that appears nowhere. */
const BS = String.fromCharCode(92);
const BODY = ["s.replace(/[.*+?^${}()|[", BS, "]", BS, BS, "]/g, \"", BS, BS, "$&\")"].join("");

/** Every production tree the finding's probe scans (archive/** and *test* are excluded by the probe's
 *  own surface rules, so they are excluded here too — this reads the same surface the finding did). */
const SCAN_ROOTS = ["plugin", "packages"];
const SCAN_EXTS = new Set([".ts", ".mjs", ".js"]);
const PROBE_EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "archive", "test", "__tests__", "fixtures"]);

function walkProductionSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PROBE_EXCLUDED_SEGMENTS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkProductionSources(abs, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SCAN_EXTS.has(ext)) continue;
      if (/\.(test|spec)\.[cm]?[jt]s$/.test(entry.name)) continue;
      out.push(abs);
    }
  }
  return out;
}

/** Files whose TEXT contains `needle`, as repo-relative POSIX paths. */
function filesContaining(needle) {
  const hits = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walkProductionSources(path.join(REPO_ROOT, root))) {
      const text = fs.readFileSync(abs, "utf8");
      if (text.includes(needle)) hits.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
    }
  }
  return hits.sort();
}

test("① the body exists exactly ONCE in the production tree, and NOT in the twelve former copies", () => {
  const hits = filesContaining(BODY);

  // The one home. If the body is ever moved, this is the line that says where it went.
  assert.ok(
    hits.includes("packages/quay/src/kernel/regex-escape.ts"),
    `the kernel leaf must carry the body; found it in: ${JSON.stringify(hits)}`,
  );

  // THE FINDING'S OWN PREDICATE, re-run: twelve byte-identical bodies under three names.
  // `> 2` because the kernel file also mentions the body once in its header comment.
  assert.ok(
    hits.length <= 2,
    `expected the body in at most 2 files (the kernel impl + its own doc comment), got ${hits.length}: ${JSON.stringify(hits)}`,
  );

  // And the twelve instruments must NOT carry it — the fix, stated as a failing-if-reverted list.
  const FORMER_COPIES = [
    "plugin/scripts/agent-panel-classify.ts",
    "plugin/scripts/deletion-closure-check.ts",
    "plugin/scripts/enum-surface-parity-check.ts",
    "plugin/scripts/identity-replication-check.ts",
    "plugin/scripts/manager-observation-runtime-check.ts",
    "plugin/scripts/prod-data-audit.ts",
    "plugin/scripts/ready-pool-check.ts",
    "plugin/scripts/repo-root-derivation-check.ts",
    "plugin/scripts/rhythm-consumer-check.ts",
    "plugin/scripts/task-ops.ts",
    "plugin/scripts/worker-driver.ts",
    "packages/quay-native/src/store.ts",
  ];
  const regressed = FORMER_COPIES.filter((f) => hits.includes(f));
  assert.deepEqual(regressed, [], `these files re-introduced a local body: ${JSON.stringify(regressed)}`);
});

test("② the plugin entry and the kernel leaf are the SAME function (not a copy)", () => {
  assert.equal(
    typeof pluginNs.escapeRegExp,
    "function",
    "plugin/scripts/regex-escape.ts must re-export the kernel's escapeRegExp",
  );
  assert.equal(
    pluginNs.escapeRegExp,
    kernelNs.escapeRegExp,
    "the plugin entry must expose the very same function object as the kernel leaf — a re-implementation would be a different object",
  );
});

test("③ behavior: the 14 metacharacters are escaped and plain names are untouched", () => {
  // Each metacharacter individually — the set is the contract, so it is enumerated, not sampled.
  for (const ch of [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]) {
    assert.equal(escapeRegExp(ch), `\\${ch}`, `metacharacter ${JSON.stringify(ch)} must be escaped`);
  }

  // A no-op on the plain section names every registered heading used before the variant suffixes —
  // 硬规则 3: an escape that mangled these would be a silent registry-wide breakage.
  for (const plain of ["AC", "Proposal", "Plan", "Definition of Done", "Finding"]) {
    assert.equal(escapeRegExp(plain), plain, `plain section name ${JSON.stringify(plain)} must pass through unchanged`);
  }

  assert.equal(escapeRegExp(""), "");
});

test("③ (negative control + motivating case) an escaped heading matches its literal line; the raw one does not", () => {
  // The real regression this contract exists for (packages/quay-native/src/store.ts + ready-pool-check.ts):
  // a registered heading with a parenthesized variant must match the literal `## AC (draft)` line.
  const heading = "AC (draft)";
  const line = "## AC (draft)";

  const escaped = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`);
  assert.ok(escaped.test(line), "the ESCAPED heading pattern must match the literal heading line");

  // The negative control: without escaping, `(draft)` is a capture group, so the pattern demands
  // "AC draft". If this ever starts matching, the escaped assertion above proved nothing.
  const raw = new RegExp(`^##\\s+${heading}\\s*$`);
  assert.ok(!raw.test(line), "the UNESCAPED heading pattern must NOT match — otherwise the control is vacuous");
  assert.ok(raw.test("## AC draft"), "the unescaped pattern matches the group-interpreted form, confirming the failure mode");
});

test("③ escaping is total over the metacharacter set (no metacharacter survives unescaped)", () => {
  // A property, not an example: no character in the test string may remain regex-active. Checked by
  // building a pattern that must match the input LITERALLY — if one metacharacter leaked, the match
  // fails or throws.
  const samples = [
    "a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o",
    "gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre",
    "Acceptance Criteria (runnable)",
    "AC（draft）",
    "./relative/path.ts",
  ];
  for (const s of samples) {
    const re = new RegExp(`^${escapeRegExp(s)}$`);
    assert.ok(re.test(s), `escaped pattern must match ${JSON.stringify(s)} literally`);
  }
});

// ── ④ the FAMILY check, re-run properly ────────────────────────────────────────────────────────────
//
// ① is a BYTE-IDENTICAL-body check: it searches for ONE exact spelling. That is why the sweep that
// collapsed the twelve copies could not see the two char-by-char `Set`-loop rewrites — nor the
// `String(s)`-receiver spelling, nor the single-quoted one — so its "12/12, complete" claim was only
// APPARENTLY complete (硬规则 5b). Re-running ① and reading its green would have repeated the mistake.
//
// ④ re-checks the same family on predicates a rewrite cannot evade:
//   (a) DECLARATION — no production file may declare a family member by name. A re-created local
//       helper has to be declared *somehow*; the NAME is what a body rewrite cannot hide.
//   (b) BODY SPELLING — the escape body, taken WITHOUT its receiver and WITHOUT its replacement
//       argument, must occur in no file but the kernel leaf. Stripping the receiver kills the
//       `String(s)` evasion; ending the needle at the comma kills the `'\\$&'`-vs-`"\\$&"` evasion.
//   (c) SET-LOOP SHAPE — the char-by-char rewrite (a metacharacter `Set` consulted per character)
//       must not appear anywhere.
// Zero-count discipline (硬规则 2's zero half): (a)-(c) are dry-run against known-TRUE samples
// BEFORE the tree is judged, so a zero means "looked and found none", never "the predicate matches
// nothing". The import-vs-declaration control is the other half: an `import {…}` of the kernel leaf
// must NOT count, or every already-migrated caller would red.
//
// ⛔ SCOPE, stated so "not covered" cannot read as "covered": the scan surface is ①'s (the probe's
// own rules — `plugin/**` + `packages/*/src/**`, minus node_modules/dist/archive/test/fixtures).
// `experiments/**` and the test trees are OUTSIDE it and do carry inline uses; the kernel leaf's
// header records that remainder by name.

const FAMILY_NAMES = ["escapeRegExp", "escapeRegex", "escapeRe", "escapeGrep"];

/** The escape body minus receiver and minus replacement argument — assembled the way BODY is (a
 *  `fromCharCode` backslash), for the same reason: a hand-spelled needle here would silently make ④
 *  pass by searching for a string that appears nowhere. */
const BODY_PREFIX = ["replace(/[.*+?^${}()|[", BS, "]", BS, BS, "]/g,"].join("");

/** The char-by-char `Set`-loop rewrite's shape. Two tokens, so reformatting does not evade it. */
function isSetLoopEscape(text) {
  return text.includes("new Set([") && text.includes("SPECIAL.has(");
}

/** Which family names `text` DECLARES (function / const-let-var / assignment form). An `import {…}`
 *  is deliberately NOT a declaration. */
function declaredFamilyNames(text) {
  return FAMILY_NAMES.filter((name) =>
    new RegExp(`(?:function|const|let|var)\\s+${name}\\s*[(=]|\\b${name}\\s*=\\s*(?:function|\\()`).test(text),
  );
}

test("④ the FAMILY: one declaration site and one body spelling — anywhere else is RED", () => {
  const KERNEL_REL = "packages/quay/src/kernel/regex-escape.ts";
  const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");

  // (i) controls FIRST — all three predicates must fire on known-true samples.
  assert.deepEqual(
    declaredFamilyNames("function escapeRegExp(s) { return s; }"),
    ["escapeRegExp"],
    "the declaration predicate must fire on the known-true function form",
  );
  for (const name of FAMILY_NAMES) {
    assert.ok(
      declaredFamilyNames(`const ${name} = (s) => s;`).includes(name),
      `the declaration predicate must fire on the const-arrow form of ${name}`,
    );
  }
  assert.deepEqual(
    declaredFamilyNames('import { escapeRegExp as escapeRe } from "./regex-escape.ts";'),
    [],
    "an IMPORT of the kernel leaf is not a declaration — else every migrated caller would red",
  );
  // The two evasions ① could not see, as literal samples: the `String(s)` receiver and the
  // single-quoted replacement. Both must match BODY_PREFIX.
  assert.ok(
    `const f = (s) => String(s).${BODY_PREFIX} '\\\\$&');`.includes(BODY_PREFIX),
    "the body needle must match the `String(s)`-receiver rewrite (① missed it)",
  );
  assert.ok(
    `const g = (s) => s.${BODY_PREFIX} "\\\\$&");`.includes(BODY_PREFIX),
    "the body needle must match the double-quoted form too",
  );
  assert.ok(
    isSetLoopEscape('const SPECIAL = new Set(["."]); out += SPECIAL.has(ch) ? 1 : 0;'),
    "the Set-loop predicate must fire on the known-true rewrite",
  );
  assert.ok(
    !isSetLoopEscape("const s = new Set([1, 2]); s.add(3);"),
    "the Set-loop predicate must NOT fire on an unrelated Set — a predicate that fires on everything measures nothing",
  );

  // (ii) the real judgment — over the production tree, not over the controls.
  const files = SCAN_ROOTS.flatMap((root) => walkProductionSources(path.join(REPO_ROOT, root)));

  const declaring = files.filter((abs) => declaredFamilyNames(fs.readFileSync(abs, "utf8")).length > 0).map(rel).sort();
  assert.deepEqual(
    declaring,
    [KERNEL_REL],
    `exactly one file may DECLARE a family member; found ${JSON.stringify(declaring)}`,
  );

  const spellingBody = files.filter((abs) => fs.readFileSync(abs, "utf8").includes(BODY_PREFIX)).map(rel).sort();
  assert.deepEqual(
    spellingBody,
    [KERNEL_REL],
    `exactly one file may spell the escape body; found ${JSON.stringify(spellingBody)}`,
  );

  const setLoops = files.filter((abs) => isSetLoopEscape(fs.readFileSync(abs, "utf8"))).map(rel).sort();
  assert.deepEqual(setLoops, [], `the Set-loop rewrite must be gone from the production tree; found ${JSON.stringify(setLoops)}`);
});
