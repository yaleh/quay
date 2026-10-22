// @test-group engine
// ls-mutation-reading.test.mjs — the SELF-TEST of plugin/scripts/ls-mutation-reading.ts
// (tasks/gap-ls-product-code-behavior-variance-first-reading AC1/AC2).
//
// What is pinned, and why each pin exists:
//
//   AC1 — the instrument CAN tell a weak test from a strong one. The SAME fixture target and the
//         SAME operator set are run against two checks: one that asserts the exact answers, one that
//         only asserts "does not throw". If the instrument cannot separate those two, its product
//         reading means nothing (a reading that is the same for any test file is not a measurement).
//         Measured before this test was written: strong killed=11/survived=0, weak killed=0/survived=11.
//
//   AC2 — not-evaluated is its OWN answer (硬规则 3b). A mutant that no longer PARSES must be
//         reported as not-evaluated, never folded into killed; and when EVERY mutant is
//         not-evaluated the score is `null` — not 0 (which would read as "nothing survived") and not
//         1 (which would read as "everything was killed"). Two independent pins:
//           (a) end-to-end through the CLI with a temp fixture whose only operator (`bracket-empty`)
//               turns an index expression into `xs[]`;
//           (b) the classification function itself, called on a test file whose import does not parse.
//
//   body-only mutation — a type annotation in the SIGNATURE is erased by type-stripping, so mutating
//         it produces an equivalent mutant that can only ever show up as a false survivor. The
//         body-brace heuristic must therefore exclude the return-type region; this is pinned
//         directly so a regression cannot hide behind the noise it creates.
//
// Run: scripts/test.sh plugin/test/ls-mutation-reading.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  collectMutantSites,
  findFunctionBody,
  runTestOnce,
} from "../scripts/ls-mutation-reading.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(REPO_ROOT, "plugin", "scripts", "ls-mutation-reading.ts");
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "ls-mutation");

/** Run the CLI against the fixture root and parse its --json record. */
function runFixture(testFile) {
  const carrier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ls-carrier-")), "readings.jsonl");
  const res = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      RUNNER,
      "--root",
      FIXTURE_ROOT,
      "--target",
      "target.mjs",
      "--functions",
      "classify,combine,pick",
      "--test",
      testFile,
      "--carrier",
      carrier,
      "--json",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(res.status, 0, `runner must exit 0 on a taken reading:\n${res.stderr}`);
  const record = JSON.parse(res.stdout.trim());
  assert.ok(fs.existsSync(carrier), "the carrier line is written");
  const lines = fs.readFileSync(carrier, "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "exactly one carrier line per run");
  assert.deepEqual(JSON.parse(lines[0]), record, "the carrier line and the --json record are the same object");
  return record;
}

// ── AC1: a weak test and a strong test must NOT look alike ────────────────────────────────────────

test("AC1 — the same mutants: the weak check survives strictly more than the strong check, and the strong check kills ≥1", () => {
  const strong = runFixture("target-strong-check.mjs");
  const weak = runFixture("target-weak-check.mjs");

  assert.equal(strong.mutants, weak.mutants, "both runs enumerate the SAME mutant set (same target + operators)");
  assert.ok(strong.mutants > 0, "the fixture really produced mutants");
  assert.ok(strong.killed >= 1, `the strong check must kill at least one mutant; got ${JSON.stringify(strong)}`);
  assert.ok(
    weak.survived > strong.survived,
    `a check that only asserts "does not throw" must survive strictly more mutants ` +
      `(weak survived=${weak.survived}, strong survived=${strong.survived})`,
  );
  // And the shape the instrument reports must be honest about the difference it found.
  assert.equal(strong.killed + strong.survived + strong.notEvaluated, strong.mutants);
  assert.equal(weak.killed + weak.survived + weak.notEvaluated, weak.mutants);
});

// ── AC2: not-evaluated never masquerades as killed; an all-not-evaluated run has score null ──────

test("AC2(a) — an unparsable mutant is not-evaluated (not killed), and an all-not-evaluated run scores null", () => {
  // The ONLY operator applied is `bracket-empty`; the fixture has only index expressions
  // (`list[i]`, `list[0]`), which become `list[]` — a parse error, never a behaviour observation.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-ac2-"));
  fs.writeFileSync(
    path.join(dir, "target.mjs"),
    "export function at(list, i) {\n  return list[i];\n}\n\nexport function first(list) {\n  return list[0];\n}\n",
  );
  fs.writeFileSync(
    path.join(dir, "check.mjs"),
    'import { test } from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'import { at, first } from "./target.mjs";\n' +
      'test("at", () => { assert.equal(at([7, 8], 1), 8); });\n' +
      'test("first", () => { assert.equal(first([7, 8]), 7); });\n',
  );
  const carrier = path.join(dir, "readings.jsonl");
  const res = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      RUNNER,
      "--root",
      dir,
      "--target",
      "target.mjs",
      "--functions",
      "at,first",
      "--test",
      "check.mjs",
      "--operators",
      "bracket-empty",
      "--carrier",
      carrier,
      "--json",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(res.status, 0, `runner must exit 0:\n${res.stderr}`);
  const record = JSON.parse(res.stdout.trim());
  assert.equal(record.mutants, 2, "two index expressions ⇒ two mutants");
  assert.equal(record.killed, 0, "an unparsable mutant is NEVER counted as killed");
  assert.equal(record.survived, 0);
  assert.equal(record.notEvaluated, 2);
  assert.equal(record.score, null, "no evaluable mutant ⇒ score is null, NOT 0 and NOT 1");
  assert.deepEqual(record.survivors, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("AC2(b) — runTestOnce classifies a module that does not parse as not-evaluated, never killed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-ac2-unit-"));
  fs.writeFileSync(path.join(dir, "broken.mjs"), "export function f(x) {\n  return x[];\n}\n");
  fs.writeFileSync(
    path.join(dir, "check.mjs"),
    'import { test } from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'import { f } from "./broken.mjs";\n' +
      'test("uses f", () => { assert.equal(f(1), 1); });\n' +
      'test("passes on its own", () => { assert.equal(1, 1); });\n',
  );
  const outcome = runTestOnce(dir, "check.mjs", 60_000);
  assert.equal(outcome.verdict, "not-evaluated", `a load/parse failure must not be a kill: ${JSON.stringify(outcome)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── body-only mutation: type positions are NOT mutants ────────────────────────────────────────────

test("the mutation span is the BODY — a boolean literal in the signature's return type is not a site", () => {
  const src = [
    "export function f(x: boolean): { ok: true } | { ok: false } {",
    "  return { ok: x };",
    "}",
    "",
  ].join("\n");
  const body = findFunctionBody(src, "f");
  assert.ok(body, "the body span is found through a union-of-object-types return annotation");
  assert.equal(
    collectMutantSites(src, ["f"], ["boolean-literal"]).length,
    0,
    "`true`/`false` in the return TYPE are erased by type-stripping; mutating them can only produce " +
      "an equivalent mutant (a false survivor), so they must be outside the mutation span",
  );
  // Negative control: a boolean literal in the BODY *is* a site (the predicate is not vacuously false).
  const withBodyBool = "export function g(): boolean {\n  return false;\n}\n";
  const sites = collectMutantSites(withBodyBool, ["g"], ["boolean-literal"]);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].to, "true");
});
