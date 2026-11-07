// @test-group engine
// touches-parser-rules-a.test.mjs — task gap-touches-parser-a-self-describing (AC2 / AC3).
//
// THE GAP THIS TEST CLOSES: the three `## Touches` rules already had ONE implementation
// (`plugin/scripts/touches-parser.ts` delegating to `packages/quay/src/kernel/touches-annotation.ts`),
// but they had NO NAME and NO agent-visible code, so a rejection could not say WHICH rule fired —
// "the annotation was treated as literal text" and "that label spelling is not recognized" were the
// same untyped failure. `diagnoseTouches` names them; the two kernel tables are the naming point.
//
//   AC2  DISCRIMINATION MATRIX — for every problem code X, an input that violates rule X produces
//        the code set EXACTLY {X}: no sibling code rides along. A matrix that only asserted
//        "X is present" would pass for a diagnostic that screams every code at every input.
//   AC3  POSITIVE ARM on the REAL registry + the REAL `--help` rendering (the code is present and
//        its rendered meaning is the table's), and NEGATIVE ARM on an INJECTED registry with rule X
//        removed (X vanishes AND the reading on the SAME input changes: section heading / entry
//        paths / tags). ⛔ The negative arm alone is not a measurement (硬规则 4 推论三) — an
//        injected-registry-only assertion proves the comparator works, not that the real registry
//        is wired. Both arms run, and the positive one reads the shipped CLI's stdout, not the table.
//
// Run:
//   node --test plugin/test/touches-parser-rules-a.test.mjs
//   scripts/test.sh plugin/test/touches-parser-rules-a.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { diagnoseTouches } from "../scripts/touches-parser.ts";
import {
  TOUCHES_PROBLEM_CODES,
  TOUCHES_READING_CODES,
  TOUCHES_RULE_IDS,
} from "../../packages/quay/src/kernel/touches-annotation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_SHIM = path.join(REPO_ROOT, "packages", "quay", "bin", "quay.js");

const body = (...lines) => ["## Touches", "", ...lines].join("\n");
const codes = (d) => d.problems.map((p) => p.code);
const codeSet = (d) => [...new Set(codes(d))].sort();

// ── the table itself ─────────────────────────────────────────────────────────────────────────────
test("tables: 4 problem codes + 3 reading codes, all unique, every rule covered", () => {
  assert.equal(TOUCHES_PROBLEM_CODES.length, 4);
  assert.equal(TOUCHES_READING_CODES.length, 3);

  const all = [...TOUCHES_PROBLEM_CODES, ...TOUCHES_READING_CODES];
  const ids = all.map((r) => r.code);
  assert.equal(new Set(ids).size, ids.length, "codes must be unique — a reused code makes an absence look like a presence (硬规则 8)");
  for (const row of all) {
    assert.match(row.code, /^touches-[a-z-]+$/, `${row.code} must be a code-shaped id the help surface can be parsed for`);
    assert.ok(row.atom && row.meaning, `${row.code} must carry an atom and a meaning`);
    assert.ok(TOUCHES_RULE_IDS.includes(row.rule), `${row.code} names rule ${row.rule}, which is not one of ${TOUCHES_RULE_IDS.join(", ")}`);
  }
  // Every rule is named by at least one code — otherwise a rule exists with no surface at all.
  for (const rule of TOUCHES_RULE_IDS) {
    assert.ok(all.some((r) => r.rule === rule), `rule ${rule} has no code — it would be unnameable`);
  }
});

// ── AC2: the discrimination matrix ───────────────────────────────────────────────────────────────
// One POSITIVE fixture per problem code: the input violates EXACTLY that rule. One NEGATIVE
// fixture: the same shape, compliant — the code must be absent.
const PROBLEM_ARMS = [
  {
    code: "touches-annotation-halfwidth-literal",
    positive: body("- plugin/scripts/foo(bar).ts"),           // half-width paren is LITERAL — ".ts" follows it
    negative: body("- plugin/scripts/foo.ts (new)"),          // a trailing half-width (…) IS an annotation
    // The defect is real, not hypothetical: the shipped strip cuts at the paren and loses the tail.
    observed: () => diagnoseTouches(body("- plugin/scripts/foo(bar).ts")).tags[0].path,
    observedExpected: "plugin/scripts/foo",
  },
  {
    code: "touches-section-ambiguous",
    positive: ["## Touches 声明（说明段，非清单）", "", "本段是说明。", "", "## Touches", "", "- a.ts"].join("\n"),
    negative: body("- a.ts"),
    observed: () => diagnoseTouches(["## Touches 声明（说明段）", "", "本段是说明。", "", "## Touches", "", "- a.ts"].join("\n")).section.heading,
    observedExpected: "Touches",
  },
  {
    code: "touches-label-unrecognized",
    positive: body("- plugin/scripts/foo.ts (add)"),          // label-family spelling, not a recognized tag
    negative: body("- plugin/scripts/foo.ts (refactor Verify phase)"), // free prose is NOT a label
    observed: () => diagnoseTouches(body("- plugin/scripts/foo.ts (add)")).tags[0].tag,
    observedExpected: null,
  },
  {
    code: "touches-label-fullwidth",
    positive: body("- plugin/scripts/foo.ts（new）"),         // the tag spelled in FULL-WIDTH parens
    negative: body("- plugin/scripts/foo.ts（说明文字）"),    // a full-width PROSE annotation is fine
    observed: () => diagnoseTouches(body("- plugin/scripts/foo.ts（new）")).tags[0].tag,
    observedExpected: null,
  },
];

for (const arm of PROBLEM_ARMS) {
  test(`AC2 matrix: ${arm.code} — the positive fixture yields EXACTLY this code, no sibling`, () => {
    const d = diagnoseTouches(arm.positive);
    assert.deepEqual(codeSet(d), [arm.code], `expected exactly {${arm.code}}, got ${JSON.stringify(codeSet(d))}`);
    // The same code twice is still a set of one, but say so explicitly: the matrix is about the
    // CODE SET, and a duplicate entry in `problems` would be a different (also wrong) reading.
    assert.equal(codes(d).length, 1, `the violation must be reported once, got ${JSON.stringify(codes(d))}`);
    assert.equal(arm.observed(), arm.observedExpected, `${arm.code} must have a REAL observable effect (not just a message)`);
  });

  test(`AC2 matrix: ${arm.code} — the compliant fixture does not produce it`, () => {
    const d = diagnoseTouches(arm.negative);
    assert.ok(!codeSet(d).includes(arm.code), `${arm.code} fired on a compliant input: ${JSON.stringify(codeSet(d))}`);
  });
}

test("AC2 matrix: a fully clean declaration produces NO problem codes at all", () => {
  const d = diagnoseTouches(body("- plugin/scripts/foo.ts (new)", "- plugin/scripts/old.ts (delete)", "- plugin/test/x.test.mjs"));
  assert.deepEqual(d.problems, [], "a clean declaration must report nothing — otherwise 'clean' and 'broken' share a shape");
});

// ── AC2: the three READING codes, each with its positive arm ─────────────────────────────────────
test("AC2 reading arm: touches-section-canonical reads the selection path (exact / fallback)", () => {
  const reading = (d) => d.readings.find((r) => r.code === "touches-section-canonical").value;
  assert.equal(reading(diagnoseTouches(body("- a.ts"))), "exact", "an exact `## Touches` heading is the canonical selection");
  assert.equal(
    reading(diagnoseTouches(["## Plan", "", "### Touches 最终清单", "", "- a.ts"].join("\n"))),
    "fallback",
    "with no exact heading the highest-level ^touches heading wins — and that is a DIFFERENT reading, not the same one",
  );
  assert.equal(reading(diagnoseTouches("## Plan\n\n- a.ts")), "absent", "'no declaration' is its own value (硬规则 3b)");
});

test("AC2 reading arm: touches-label-new / touches-label-delete count the structural tags", () => {
  const d = diagnoseTouches(body("- a.ts (new)", "- b.ts (new)", "- c.ts (delete)", "- d.ts (deleted)", "- e.ts"));
  const value = (c) => d.readings.find((r) => r.code === c).value;
  assert.equal(value("touches-label-new"), 2, "(new) entries counted");
  assert.equal(value("touches-label-delete"), 2, "(delete) and (deleted) are the SAME tag");
  assert.equal(d.tags.length, 5, "every bullet is read, tagged or not");
});

// ── AC3 POSITIVE ARM — the REAL registry + the REAL `--help` rendering ───────────────────────────
test("AC3 positive arm: the real registry reports the code AND the real `task create --help` renders it with the table's meaning", () => {
  const help = spawnSync(process.execPath, [CLI_SHIM, "task", "create", "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(help.status, 0, `quay task create --help must exit 0 (stderr: ${help.stderr})`);
  const stdout = help.stdout;

  // One code per PROBLEM_ARMS entry, plus its input producing it under the REAL (default) registry.
  for (const arm of PROBLEM_ARMS) {
    const row = TOUCHES_PROBLEM_CODES.find((r) => r.code === arm.code);
    assert.ok(row, `${arm.code} must be in TOUCHES_PROBLEM_CODES`);
    // (a) the real registry — no injected rules — reports the code for the violating input.
    assert.deepEqual(codeSet(diagnoseTouches(arm.positive)), [arm.code], `the real registry must report ${arm.code}`);
    // (b) the real --help renders the code as [problem] WITH the same meaning (the two surfaces
    //     agree because one is derived from the other; this asserts the derivation is intact).
    const line = stdout.split("\n").find((l) => l.includes(arm.code));
    assert.ok(line, `${arm.code} is missing from the real \`quay task create --help\` stdout`);
    assert.match(line, /\[problem\]/, `${arm.code} must render with the [problem] marker`);
    assert.ok(line.includes(row.meaning), `${arm.code}'s rendered line must carry the table's meaning verbatim (drifted rendering?)`);
    assert.ok(line.includes(`rule ${row.rule}`), `${arm.code}'s rendered line must name rule ${row.rule}`);
    assert.ok(stdout.includes(row.meaning), `${arm.code}'s meaning must be in the help output`);
  }
  for (const row of TOUCHES_READING_CODES) {
    const line = stdout.split("\n").find((l) => l.includes(row.code));
    assert.ok(line, `${row.code} is missing from the real \`quay task create --help\` stdout`);
    assert.match(line, /\[reading\]/, `${row.code} must render with the [reading] marker`);
    assert.ok(line.includes(row.meaning), `${row.code}'s rendered line must carry the table's meaning verbatim`);
  }
});

// ── AC3 NEGATIVE ARM — an INJECTED registry with rule X removed ──────────────────────────────────
// Each case asserts the SAME two halves: (i) X disappears from `problems` AND reappears in
// `notEvaluated` (an independent value — "the rule was off" must not read as "checked and clean"),
// and (ii) the READING on the same input changes, so the rule is load-bearing rather than a label.
const NEGATIVE_ARMS = [
  {
    rule: "s3-7",
    code: "touches-annotation-halfwidth-literal",
    input: body("- plugin/scripts/foo.ts (new)"),
    readingChanges: (on, off) => {
      assert.deepEqual(on.tags.map((t) => t.path), ["plugin/scripts/foo.ts"]);
      assert.deepEqual(off.tags.map((t) => t.path), ["plugin/scripts/foo.ts (new)"], "with the strip rule off the ANNOTATION stays in the path reading");
    },
  },
  {
    rule: "sa5b-3",
    code: "touches-section-ambiguous",
    input: ["## Touches 声明（说明段）", "", "本段是说明。", "", "## Touches", "", "- a.ts"].join("\n"),
    readingChanges: (on, off) => {
      assert.equal(on.section.selection, "exact");
      assert.equal(on.section.heading, "Touches");
      assert.equal(off.section.selection, "latch", "with the selection rule off the FIRST ^touches heading latches");
      assert.equal(off.section.heading, "Touches 声明（说明段）", "the SECTION reading must change, not just the message");
      assert.notDeepEqual(on.readings.map((r) => r.code), off.readings.map((r) => r.code), "the section reading code must disappear from `readings`");
    },
  },
  {
    rule: "sa5b-4",
    code: "touches-label-fullwidth",
    input: body("- plugin/scripts/foo.ts（new）", "- plugin/scripts/old.ts (delete)"),
    readingChanges: (on, off) => {
      assert.deepEqual(on.tags.map((t) => t.tag), [null, "delete"]);
      assert.deepEqual(off.tags.map((t) => t.tag), [null, null], "with the label rule off NO spelling is recognized");
    },
  },
];

for (const arm of NEGATIVE_ARMS) {
  test(`AC3 negative arm: removing rule ${arm.rule} drops ${arm.code} AND changes the reading`, () => {
    const enabledRules = TOUCHES_RULE_IDS.filter((r) => r !== arm.rule);
    const off = diagnoseTouches(arm.input, { rules: enabledRules });
    const on = diagnoseTouches(arm.input);

    // (i) the code vanishes from `problems` — and is NOT reported as clean: it is not-evaluated.
    assert.ok(!codeSet(off).includes(arm.code), `${arm.code} must disappear when rule ${arm.rule} is not in the registry`);
    const notEval = off.notEvaluated.map((n) => n.code);
    assert.ok(notEval.includes(arm.code), `${arm.code} must be NOT-EVALUATED, not silently absent (硬规则 3b)`);
    assert.ok(!on.notEvaluated.some((n) => n.code === arm.code), "the real registry evaluates every code");

    // (ii) the READING on the same input changes — the rule is load-bearing.
    arm.readingChanges(on, off);
  });
}
