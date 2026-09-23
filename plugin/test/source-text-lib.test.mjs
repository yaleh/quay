// @test-group engine
// source-text-lib.test.mjs — unit tests for the shared pure source-text primitives
// (plugin/scripts/source-text-lib.ts), extracted from three duplicated pairs found by the
// semantic-dedup-scan routine (.quay/routine-findings.jsonl, finding
// `firstargregion-stripshellcomments`).
//
// The point of this file is not "does it strip a comment" — the four callers' own test files
// already assert that end-to-end. It is the CONTROL that pins what the extraction deliberately
// did NOT unify: the two strippers belong to two DIFFERENT languages, and swapping one for the
// other changes WHICH positions a checker judges. A checker that cannot read its input returns
// the "pass" shape (硬规则 3b), so the control asserts them to be NON-interchangeable in BOTH
// directions:
//
//   stripShellComments("echo a # b")        → shell comment gone
//   stripComments("echo a # b")             → shell comment SURVIVES (it is not a JS comment)
//   stripComments("const a = 1; // c")      → JS comment gone
//   stripShellComments("const a = 1; // c") → JS comment SURVIVES (shell has no `//`)
//
// A SECOND pass of the same routine (.quay/routine-findings.jsonl, finding `lineof-lineat`, runId
// `semantic-dedup-scan-1790028867335`, suggestedAction `extract`) added the position/slice family —
// lineOf / colOf / snippetOf. Their controls are at the bottom:
//   • `snippetOf(src, idx, Infinity)` must equal `snippetOf(src, idx)` — the pin that folding
//     `snippetAt` into `snippetOf` made NO semantic choice (that is why it was allowed here, when
//     the two strippers above had to stay apart).
//   • a POSITION-BASED sweep asserting no `plugin/scripts` file declares its own copy of the family
//     and each carrier imports it — the standing guard that makes the extraction stick. Without it
//     the routine simply re-finds the same twelve copies on its next pass.
//
// Run: scripts/test.sh plugin/test/source-text-lib.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNonCodeMask } from "../scripts/checker-lib.ts";
import { callRegion } from "../scripts/test-isolation-check.ts";
import {
  stripShellComments,
  stripComments,
  firstArgRegion,
  lineOf,
  colOf,
  snippetOf,
} from "../scripts/source-text-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── stripShellComments ────────────────────────────────────────────────────────────────────────

test("stripShellComments: `#` comments stripped, single/double-quoted `#` preserved", () => {
  assert.equal(
    stripShellComments("# full line\necho hi # trailing\necho 'a#b'\necho \"c#d\"\n"),
    "\necho hi \necho 'a#b'\necho \"c#d\"\n",
  );
});

test("stripShellComments: `#` not preceded by whitespace is not a comment start", () => {
  assert.equal(stripShellComments("echo a#b\n"), "echo a#b\n");
});

test("stripShellComments: an escaped quote inside a double-quoted string does not end it", () => {
  // `echo "x\" # y" # real` — the `#` inside the quotes must survive, the trailing one must not.
  assert.equal(stripShellComments('echo "x\\" # y" # real\n'), 'echo "x\\" # y" \n');
});

// ── stripComments ─────────────────────────────────────────────────────────────────────────────

test("stripComments: `//` and slash-star block comments removed", () => {
  assert.equal(stripComments("a // gone\nb " + "/* gone */" + " c\n"), "a \nb  c\n");
});

test("stripComments: NAIVE — not quote-aware, a marker inside a string is treated as a comment", () => {
  // This is the documented, load-bearing weakness (import-specifier pre-filter only). Pinned so
  // that "improving" it into a real lexer is a deliberate act, not a silent drive-by.
  assert.equal(stripComments('const u = "http://x";\n'), 'const u = "http:\n');
});

// ── the cross-language control (the reason this module has three functions, not one) ──────────

test("control: the two strippers are NOT interchangeable in either direction", () => {
  const shell = "echo hi # shell comment\n";
  const ts = "const a = 1; // js comment\n";
  // Each stripper neutralizes only ITS OWN language's comment…
  assert.equal(stripShellComments(shell), "echo hi \n");
  assert.equal(stripComments(ts), "const a = 1; \n");
  // …and leaves the other language's comment fully intact (a "pass" would be a silent false green).
  assert.equal(stripComments(shell), shell);
  assert.equal(stripShellComments(ts), ts);
});

// ── firstArgRegion ────────────────────────────────────────────────────────────────────────────

/** The `firstArgRegion` span for the first call whose callee matches `calleeRe`. `callRegion`
 *  (test-isolation-check.ts) supplies the balanced-paren span — the real companion primitive, not
 *  a re-implementation of it in the fixture. */
function firstArgOf(src, calleeRe) {
  const mask = buildNonCodeMask(src);
  const m = calleeRe.exec(src);
  assert.ok(m, "callee not found in fixture");
  const openIdx = m.index + m[0].length - 1;
  const region = callRegion(src, mask, openIdx);
  assert.ok(region.length > 0, "unbalanced fixture");
  const [start, end] = firstArgRegion(src, mask, openIdx, region);
  return src.slice(start, end);
}

test("firstArgRegion: stops at the first TOP-LEVEL comma", () => {
  assert.equal(firstArgOf('f("a", "b", "c")', /\bf\s*\(/).trim(), '"a"');
});

test("firstArgRegion: a comma nested in brackets/braces/parens is not the separator", () => {
  assert.equal(firstArgOf('f(["a", "b"], "second")', /\bf\s*\(/).trim(), '["a", "b"]');
  assert.equal(firstArgOf('f(g("a", "b"), "second")', /\bf\s*\(/).trim(), 'g("a", "b")');
});

test("firstArgRegion: a comma inside a MASKED string literal is not the separator", () => {
  // Without the mask this returns `"a` — the reason the mask parameter exists.
  assert.equal(firstArgOf('f("a, b", "c")', /\bf\s*\(/).trim(), '"a, b"');
});

test("firstArgRegion: a single-argument call spans to just before the closing paren", () => {
  assert.equal(firstArgOf('f("only")', /\bf\s*\(/).trim(), '"only"');
});

// ── lineOf / colOf (finding `lineof-lineat`) ───────────────────────────────────────────────────

test("lineOf: 1-based, counted by newline, independent of the parameter name", () => {
  const src = "a\nbb\n\nccc\n";
  assert.equal(lineOf(src, 0), 1, "first character is line 1");
  assert.equal(lineOf(src, 1), 1, "the `\\n` itself still belongs to the line it ends");
  assert.equal(lineOf(src, 2), 2, "the character right after `\\n` is the next line");
  assert.equal(lineOf(src, 5), 3, "a blank line is still a line");
  assert.equal(lineOf(src, 9), 4, "last character is on line 4");
});

test("lineOf: an index past the end clamps to the last line (never throws, never counts phantom lines)", () => {
  const src = "a\nb\n";
  assert.equal(lineOf(src, src.length), 3, "one past the final `\\n` is the empty third line");
  assert.equal(lineOf(src, 10_000), 3, "far past the end stays at that same line");
});

test("colOf: 1-based column within the line", () => {
  const src = "abc\ndefg\n";
  assert.equal(colOf(src, 0), 1);
  assert.equal(colOf(src, 2), 3);
  assert.equal(colOf(src, 4), 1, "first character of line 2 is column 1");
  assert.equal(colOf(src, 7), 4);
});

// ── snippetOf (the fold of snippetAt into snippetOf) ───────────────────────────────────────────

test("snippetOf: the whole trimmed line containing `idx`", () => {
  const src = "one\n   two three   \nfour\n";
  assert.equal(snippetOf(src, 0), "one");
  assert.equal(snippetOf(src, 6), "two three", "surrounding whitespace is trimmed");
  assert.equal(snippetOf(src, 20), "four");
});

test("snippetOf: maxLen truncates to EXACTLY maxLen characters, `...` included", () => {
  const src = `${"x".repeat(200)}\n`;
  assert.equal(snippetOf(src, 0), "x".repeat(200), "unbounded by default");
  assert.equal(snippetOf(src, 0, 80).length, 80, "truncated form is exactly maxLen long");
  assert.ok(snippetOf(src, 0, 80).endsWith("..."));
  assert.equal(snippetOf(src, 0, 80), `${"x".repeat(77)}...`);
  assert.equal(snippetOf(src, 0, 300), "x".repeat(200), "a line shorter than maxLen is untouched");
});

test("control: snippetOf(src, idx, Infinity) ≡ snippetOf(src, idx) — the fold made no semantic choice", () => {
  // This is the reason `snippetAt` (an unconditional width bound) could be collapsed into
  // `snippetOf` when the two comment strippers above could NOT be collapsed into each other:
  // the ONLY difference between the two originals was the bound, and removing a bound is not a
  // decision. If a future edit makes the unbounded path differ, this control goes red.
  const src = "short\na much longer line that would definitely be truncated at eighty characters if a bound were applied here\n";
  for (const idx of [0, 6, 40, src.length - 2]) {
    assert.equal(snippetOf(src, idx, Infinity), snippetOf(src, idx), `idx=${idx}`);
  }
});

// ── regression: the family lives in ONE place (the guard that makes the extraction stick) ─────

/** The carriers that each held a private copy of the 1-based newline counter before the
 *  extraction; every one of them must now reach the shared module. */
const CARRIERS = [
  "checker-lib.ts",
  "deletion-closure-check.ts",
  "identity-replication-check.ts",
  "import-graph-check.ts",
  "sh-census-check.ts",
  "test-isolation-check.ts",
  "goal-driver-task-boundary-check.ts",
  "kernel-sibling-resolution-check.ts",
  "registry-bare-filename-scan.ts",
  "target-identity-literal-check.ts",
  "workflow-metadata-conformance.mjs",
];

test("regression: no plugin/scripts file declares its own copy of the position/slice family", () => {
  // 硬规则 2 — by POSITION, not keyword: the predicate runs over the non-code mask, so a comment
  // (like the ones the extraction left behind, which do spell these names) can never satisfy it,
  // and a real declaration always does.
  const scriptsDir = path.join(REPO_ROOT, "plugin", "scripts");
  const decl = /function\s+(lineOf|lineAt|colOf|snippetOf|snippetAt|relOf)\s*\(/g;
  const offenders = [];
  for (const name of fs.readdirSync(scriptsDir)) {
    if (!/\.(ts|mjs|js)$/.test(name)) continue;
    if (name === "source-text-lib.ts") continue; // the one declared home
    const src = fs.readFileSync(path.join(scriptsDir, name), "utf8");
    const mask = buildNonCodeMask(src);
    for (const m of src.matchAll(decl)) {
      if (mask[m.index] === 0) offenders.push(`${name}:${src.slice(0, m.index).split("\n").length} ${m[1]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a private copy of the family reappeared (finding \`lineof-lineat\` is back) — got ${offenders.length}: ${JSON.stringify(offenders)}`,
  );
});

test("regression: every carrier imports the family from source-text-lib", () => {
  for (const name of CARRIERS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", name), "utf8");
    assert.match(src, /from "\.\/source-text-lib\.ts"/, `${name} must import source-text-lib.ts`);
  }
});

test("regression: the two names collapsed to one — `lineAt` no longer exists as an export or a call", () => {
  const lib = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "source-text-lib.ts"), "utf8");
  assert.doesNotMatch(lib, /export function lineAt\b/, "the rename signal: keep ONE name");
  const callers = CARRIERS.filter((n) => n !== "workflow-metadata-conformance.mjs");
  for (const name of callers) {
    const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", name), "utf8");
    const mask = buildNonCodeMask(src);
    for (const m of src.matchAll(/\blineAt\s*\(/g)) {
      if (mask[m.index] === 0) assert.fail(`${name} still CALLS lineAt at offset ${m.index}`);
    }
  }
});
