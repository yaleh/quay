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
// Run: scripts/test.sh plugin/test/source-text-lib.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNonCodeMask } from "../scripts/checker-lib.ts";
import { callRegion } from "../scripts/test-isolation-check.ts";
import { stripShellComments, stripComments, firstArgRegion } from "../scripts/source-text-lib.ts";

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
