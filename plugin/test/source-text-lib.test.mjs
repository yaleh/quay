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
// A THIRD pass of the same routine (finding `codeonlytext-two-copies`, runId
// `semantic-dedup-scan-1790218481576`, suggestedAction `extract`) added the comment-mask family —
// maskComments / codeOnlyText. Their controls are at the bottom too: the mask is NO MORE
// interchangeable with the three strippers above than they are with each other (it is the only one
// of the four that blanks rather than deletes, and the only one that treats a `#` inside a string as
// code), and the same positional sweep guards its one declared home.
//
// A FOURTH pass, from a DIFFERENT routine (`architecture-analysis`, finding
// `dup-last-suite-start-offset-divergent-regex`, runId `architecture-analysis-1792940968187`,
// suggestedAction `extract`) added the suite-log round slice — lastSuiteStartOffset, which was
// written 3x across 2 carriers with TWO regex spellings. Unlike the families above, the two old
// spellings were NOT semantically equivalent: on a BARE marker line at EOF the `[^\n]*$` spelling
// returns 0 and the `\s` spelling returns -1. The controls at the bottom pin the chosen semantics on
// exactly that input AND assert agreement with both old spellings wherever BOTH accepted the line,
// so neither spelling can quietly come back.
//
// Run: scripts/test.sh plugin/test/source-text-lib.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNonCodeMask } from "../scripts/checker-lib.ts";
import { callRegion } from "../scripts/test-isolation-check.ts";
// The near-neighbour that deliberately stayed OUT of this module — imported under an alias so the
// control below can hold the two masks side by side (they must NOT agree on `this.#p`).
import { maskComments as siblingMask } from "../scripts/kernel-sibling-resolution-check.ts";
import {
  stripShellComments,
  stripComments,
  firstArgRegion,
  lineOf,
  colOf,
  snippetOf,
  maskComments,
  codeOnlyText,
  lastSuiteStartOffset,
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

// ── maskComments / codeOnlyText (finding `codeonlytext-two-copies`) ───────────────────────────

test("maskComments: `//`, slash-star and bash `#` line comments masked; strings are SKIPPED", () => {
  const src = '// line c\n/* block c */ const a = "// in a string";\n# bash c\nconst b = \'# in a string\';\n';
  const mask = maskComments(src);
  assert.equal(mask.length, src.length, "the mask is indexed exactly like src");
  assert.equal(mask[src.indexOf("line c")], 1, "// line comment masked");
  assert.equal(mask[src.indexOf("block c")], 1, "slash-star block comment masked");
  assert.equal(mask[src.indexOf("bash c")], 1, "bash # line comment masked");
  assert.equal(mask[src.indexOf("const a")], 0, "code is not masked");
  // The load-bearing half: a `//` or `#` INSIDE a literal is not a comment, and an import specifier
  // (a string) must land in an unmasked position or the checkers read the wrong surface.
  assert.equal(mask[src.indexOf("// in a string")], 0, "`//` inside a string is NOT a comment");
  assert.equal(mask[src.indexOf("# in a string")], 0, "`#` inside a string is NOT a comment");
});

test("maskComments: an escaped quote does not end the string (a `//` after it is still inside)", () => {
  const src = 'const s = "esc \\" // still in the string";\n';
  assert.equal(maskComments(src)[src.indexOf("// still")], 0);
});

test("codeOnlyText: blanks exactly the masked positions — length and offsets preserved", () => {
  const src = "const a = 1; // gone\n# bash\nrun x\n";
  const code = codeOnlyText(src);
  assert.equal(code.length, src.length, "blanked, not deleted — a later offset stays valid");
  assert.equal(code.split("\n")[0].slice(0, 12), "const a = 1;", "code is untouched");
  assert.ok(!code.includes("gone") && !code.includes("bash"), "comment text is gone");
  // `codeOnlyText` is not a second judgment: it IS the mask, applied position by position.
  const mask = maskComments(src);
  for (let i = 0; i < src.length; i++) assert.equal(code[i], mask[i] === 1 ? " " : src[i], `offset ${i}`);
});

// ── the cross-primitive control for maskComments (same reason as the strippers above) ──────────

test("control: one input, FOUR different answers — none of the four is a stand-in for another", () => {
  // Each primitive neutralizes a different set of positions; if any two were interchangeable the
  // extraction would have been free. It was not (see the module header's non-goal list).
  const src = 'const u = "http://x"; // c\n# b\necho z\n';
  const answers = {
    stripShellComments: stripShellComments(src),
    stripComments: stripComments(src),
    codeOnlyText: codeOnlyText(src),
    buildNonCodeMask: buildNonCodeMask(src).join(""),
  };
  assert.equal(
    new Set(Object.values(answers)).size,
    4,
    `expected 4 distinct answers, got ${JSON.stringify(answers, null, 1)}`,
  );
  // …and the two that matter most for a checker, spelled out:
  const url = 'const u = "http://x";\n';
  assert.equal(stripComments(url), 'const u = "http:\n', "the naive stripper eats a `//` inside a string");
  assert.equal(codeOnlyText(url), url, "the mask is quote-aware — this is why it is not stripComments");
  assert.equal(stripShellComments("# a\n"), "\n", "the shell stripper DELETES a comment");
  assert.equal(codeOnlyText("# a\n"), "   \n", "the mask BLANKS it — offsets survive");
});

test("control: a REGEX literal is code to maskComments and MASKED by buildNonCodeMask", () => {
  // Both are linear state machines over the same skeleton; only buildNonCodeMask models regex
  // literals. A caller judging regex positions (checker-lib's position matching) needs that one.
  const src = 'const r = /import { test } from "node:test"/;\n';
  const i = src.indexOf("import { test }");
  assert.equal(maskComments(src)[i], 0, "maskComments deliberately does NOT model regex literals");
  assert.equal(buildNonCodeMask(src)[i], 1, "buildNonCodeMask does — hence the two live apart");
});

test("control: the `#` branch differs from kernel-sibling-resolution-check.ts's mask, deliberately", () => {
  // That checker scans `.ts` where `#` is the private-field sigil, so it gates `#` on preceding
  // whitespace; this family must mask a column-0 `#` because its corpus includes bash-syntax `.ts`
  // (runner-static-gate.ts, `source`d by scripts/test.sh). Swapping them changes which positions
  // each checker judges — 硬规则 3b's failure shape.
  const priv = "const a = this.#p;\n";
  assert.equal(maskComments(priv)[priv.indexOf("#")], 1, "shared mask: column-0-or-not, `#` is a comment");
  assert.equal(siblingMask(priv)[priv.indexOf("#")], 0, "sibling mask: `#` after `.` is code");
  const hash = "# @static-object x/**/y\nrun_checker\n";
  assert.equal(maskComments(hash)[hash.indexOf("run_checker")], 0, "the line after a `#` comment is code");
});

// ── regression: the comment-mask family lives in ONE place (the guard that makes it stick) ────

/** The carriers that each held a SAME-semantics copy before the extraction — three for the mask
 *  (the finding named two; the 硬规则 5b sweep of `plugin/scripts/*.ts` found the third) and two for
 *  the text. Every one must now reach the shared module. */
const MASK_CARRIERS = [
  "fan-in-workflow-retirement-check.ts",
  "outer-retirement-precondition-check.ts",
  "registry-bare-filename-scan.ts",
];

test("regression: no plugin/scripts file declares its own copy of the comment-mask family", () => {
  // 硬规则 2 — by POSITION, not keyword: the predicate runs over the non-code mask, so a comment
  // (like the ones the extraction left behind, which do spell these names) can never satisfy it,
  // and a real declaration always does.
  const scriptsDir = path.join(REPO_ROOT, "plugin", "scripts");
  const decl = /function\s+(maskComments|codeOnlyText)\s*\(/g;
  const offenders = [];
  for (const name of fs.readdirSync(scriptsDir)) {
    if (!/\.(ts|mjs|js)$/.test(name)) continue;
    if (name === "source-text-lib.ts") continue; // the one declared home
    const src = fs.readFileSync(path.join(scriptsDir, name), "utf8");
    const mask = buildNonCodeMask(src);
    for (const m of src.matchAll(decl)) {
      if (mask[m.index] === 0) offenders.push(`${name} ${m[1]}`);
    }
  }
  // An ENUMERATION, not a boolean (硬规则 3): the residual is named, so a NEW copy anywhere fails
  // this test AND deleting one of the two known-distinct variants fails it too (forcing a
  // deliberate update rather than a silent widening). ⛔ `maskCommentsAndStrings`
  // (goal-driver-task-boundary-check.ts) does not match the predicate: it is a different name with a
  // different body, and the module header records why it stays apart.
  assert.deepEqual(
    offenders.sort(),
    ["kernel-sibling-resolution-check.ts maskComments", "profiles-role-coverage-check.ts maskComments"],
    "the comment-mask family moved, or a copy reappeared (finding `codeonlytext-two-copies` is back). " +
      "If the new declaration has the SAME semantics, import it from source-text-lib.ts instead; if it " +
      "is genuinely different, add it to this list WITH its reason in the module header.",
  );
});

test("regression: every carrier of the comment-mask family imports it from source-text-lib", () => {
  for (const name of MASK_CARRIERS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", name), "utf8");
    assert.match(src, /from "\.\/source-text-lib\.ts"/, `${name} must import source-text-lib.ts`);
  }
});

test("regression: the same-semantics copies are GONE, not aliased — `codeOnlyText` has one home", () => {
  const lib = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "source-text-lib.ts"), "utf8");
  assert.match(lib, /export function maskComments\b/);
  assert.match(lib, /export function codeOnlyText\b/);
  // The rename signal: registry-bare-filename-scan.ts's second name for the same computation
  // (`stripCommentsIncludingHash`) collapsed into the shared one — an alias would leave two names
  // for one quantity, which is what the routine reported in the first place. Checked BY POSITION
  // (硬规则 2): the extraction's own comment spells the old name, and a keyword grep would read
  // that prose as a surviving call.
  const scan = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "registry-bare-filename-scan.ts"), "utf8");
  const scanMask = buildNonCodeMask(scan);
  const codeUses = [...scan.matchAll(/stripCommentsIncludingHash/g)]
    .filter((m) => scanMask[m.index] === 0)
    .map((m) => scan.slice(0, m.index).split("\n").length);
  assert.deepEqual(codeUses, [], `the second name must be gone from CODE, not aliased (lines ${codeUses})`);
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

// ── the suite-log round slice: ONE home, and the divergence is pinned (fourth pass) ──────────
//
// Finding `dup-last-suite-start-offset-divergent-regex` (routine `architecture-analysis`, runId
// `architecture-analysis-1792940968187`): `lastSuiteStartOffset` existed 3x with two spellings —
// /^__FANIN_SUITE_START__[^\n]*$/gm (measure-trend-check.ts + fan-in-execute.js FIX_SCOPE_GATE) and
// /^__FANIN_SUITE_START__\s/gm (pre-verified-round-record.ts). They agree on every line the emitter
// produces today (` iso=…`), so the divergence was invisible — and it is a REAL behavior difference,
// not formatting. These controls hold BOTH sides of it: agreement where both accept, and the chosen
// answer on the one input where they did not.

/** The two PRE-EXTRACTION spellings, kept ONLY as the other side of the equivalence control. The
 *  matcher is the same "last match wins" loop all three carriers used. */
function lastMatchOf(re) {
  return (text) => {
    re.lastIndex = 0; // a regex with /g carries state across calls; the carriers re-created it per call
    let last = -1;
    let m;
    while ((m = re.exec(text)) !== null) last = m.index;
    return last;
  };
}
const oldDollarSpelling = lastMatchOf(/^__FANIN_SUITE_START__[^\n]*$/gm);
const oldWhitespaceSpelling = lastMatchOf(/^__FANIN_SUITE_START__\s/gm);

test("control: lastSuiteStartOffset agrees with BOTH old spellings on lines BOTH accept", () => {
  // A real two-round rotated log: the second marker is the current round.
  const log =
    "__FANIN_SUITE_START__ iso=2026-08-19T00:00:00.000Z ms=100 head=old round=full\n" +
    "__PERFILE__ duration_ms=1.1 /wt/a.test.mjs passed=true\n" +
    "__FANIN_SUITE_START__ iso=2026-08-19T00:10:00.000Z ms=600 head=new round=full\n" +
    "__PERFILE__ duration_ms=2.2 /wt/b.test.mjs passed=false\n";
  const expected = log.indexOf("__FANIN_SUITE_START__ iso=2026-08-19T00:10");
  assert.equal(lastSuiteStartOffset(log), expected, "the LAST marker line wins");
  assert.equal(oldDollarSpelling(log), expected, "old `[^\\n]*$` spelling agrees on emitted markers");
  assert.equal(oldWhitespaceSpelling(log), expected, "old `\\s` spelling agrees on emitted markers");
  assert.equal(lastSuiteStartOffset(log), oldDollarSpelling(log));
  assert.equal(lastSuiteStartOffset(log), oldWhitespaceSpelling(log));
});

test("control: a BARE marker line at EOF IS a marker — the exact input where the old spellings diverged", () => {
  // An emitter change that writes the marker without its trailing fields/newline must not make one
  // reader slice the whole log while another slices nothing (fake checker-misreport).
  const bareAtEof = "__PERFILE__ stale-before-marker passed=true\n__FANIN_SUITE_START__";
  const bareOffset = bareAtEof.indexOf("__FANIN_SUITE_START__");
  assert.equal(lastSuiteStartOffset(bareAtEof), bareOffset, "the shared rule treats a bare marker at EOF as a marker");
  assert.equal(oldDollarSpelling(bareAtEof), bareOffset, "the `[^\\n]*$` spelling already did");
  assert.equal(
    oldWhitespaceSpelling(bareAtEof),
    -1,
    "PIN THE DIVERGENCE: the retired `\\s` spelling does NOT see a bare marker at EOF — this is why the extraction had to choose, not merely dedupe",
  );
  assert.equal(lastSuiteStartOffset("__FANIN_SUITE_START__"), 0, "a lone bare marker is the current round");
});

test("control: a marker line followed by whitespace (the real emitter) still matches — `\\s` keeps its guarantee", () => {
  // The other half of the retired `\s` spelling: the marker TOKEN must end at whitespace or EOF.
  const emitted = "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=1 head=x round=full\n";
  assert.equal(lastSuiteStartOffset(emitted), 0);
  assert.equal(lastSuiteStartOffset("__FANIN_SUITE_START__\n"), 0, "bare marker + newline");
  assert.equal(lastSuiteStartOffset("__FANIN_SUITE_START__EXTRA\n"), -1, "a PREFIX is not the marker (token boundary)");
});

test("control: a MID-LINE mention is not a marker, and the last MARKER LINE still wins", () => {
  // The suite's own test output mentions the marker mid-line; slicing from there would drop the real
  // __PERFILE__ lines before it (gap-measure-trend-check-slice-line-anchor / gap-wiring-B).
  const mentionOnly =
    "__PERFILE__ duration_ms=1 a.test.mjs passed=false\n" +
    "✔ parsePerFileLines slices by the last __FANIN_SUITE_START__ marker (current round only)\n";
  assert.equal(lastSuiteStartOffset(mentionOnly), -1, "a mid-line mention is NOT a marker");
  assert.equal(oldDollarSpelling(mentionOnly), -1, "…and neither old spelling matched it either");

  const mentionAfterMarker =
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=1 head=x round=full\n" +
    "__PERFILE__ duration_ms=1 a.test.mjs passed=false\n" +
    "✔ the last __FANIN_SUITE_START__ marker slices the current round\n";
  assert.equal(
    lastSuiteStartOffset(mentionAfterMarker),
    0,
    "the mention AFTER the real marker must not move the slice point",
  );
});

test("regression: no plugin/scripts file declares its own copy of the suite-log round slice", () => {
  // 硬规则 2 — by POSITION: the predicate runs over the non-code mask, so this test's own prose and
  // the extraction comments can spell the name without satisfying it.
  const scriptsDir = path.join(REPO_ROOT, "plugin", "scripts");
  const decl = /function\s+(lastSuiteStartOffset)\s*\(/g;
  const offenders = [];
  for (const name of fs.readdirSync(scriptsDir)) {
    if (!/\.(ts|mjs|js)$/.test(name)) continue;
    if (name === "source-text-lib.ts") continue; // the one declared home
    const src = fs.readFileSync(path.join(scriptsDir, name), "utf8");
    const mask = buildNonCodeMask(src);
    for (const m of src.matchAll(decl)) {
      if (mask[m.index] === 0) offenders.push(`${name}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a private copy of the round slice reappeared (finding \`dup-last-suite-start-offset-divergent-regex\` is back) — got ${offenders.length}: ${JSON.stringify(offenders)}`,
  );
});

/** The two plugin/scripts carriers that each held a private copy before the extraction. Every one
 *  must now reach the shared module. The THIRD carrier is the fan-in workflow (separate test below —
 *  it lives outside plugin/scripts and its call site is inside a generated inline node script). */
const ROUND_SLICE_CARRIERS = ["measure-trend-check.ts", "pre-verified-round-record.ts"];

test("regression: every plugin/scripts carrier imports the round slice from source-text-lib", () => {
  for (const name of ROUND_SLICE_CARRIERS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", name), "utf8");
    assert.match(
      src,
      /import\s*\{[^}]*\blastSuiteStartOffset\b[^}]*\}\s*from\s*"\.\/source-text-lib\.ts"/,
      `${name} must import lastSuiteStartOffset from source-text-lib.ts`,
    );
    assert.doesNotMatch(src, /const\s+\w*Re\w*\s*=\s*\/\^__FANIN_SUITE_START__/, `${name} must not re-inline the marker regex`);
  }
});

test("regression: the fan-in workflow's FIX_SCOPE_GATE imports the shared helper instead of an inlined regex", () => {
  const wf = fs.readFileSync(path.join(REPO_ROOT, "plugin", "workflows", "fan-in-execute.js"), "utf8");
  assert.ok(
    wf.includes('import { lastSuiteStartOffset } from "${PLUGIN_ROOT}/scripts/source-text-lib.ts";'),
    "the generated FIX_SCOPE_GATE inline script must import the shared helper (same import style as its other four)",
  );
  assert.ok(wf.includes("const _roundMk = lastSuiteStartOffset(logText);"), "it must CALL the helper");
  assert.ok(!wf.includes("_roundMkRe"), "the inlined marker regex must be gone from the workflow");
});

