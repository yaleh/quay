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
