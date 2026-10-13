// @test-group engine
// gate-script-base-adoption.test.mjs — the SIX residual hand-rolled CLI token loops now route through
// gate-script-base.ts's `parseArgs` (tasks/gap-routine-semantic-dedup-scan-parse-args-adoption-split).
//
// THE FINDING (semantic-dedup-scan, runId `semantic-dedup-scan-1791908616513`, findingId
// `parse-args-adoption-split`, verdict `divergent-implementation`, suggestedAction "migrate the six
// hand-rolled parsers onto gate-script-base parseArgs") counted this family as eight adopters PLUS six
// hand-rolled loops owning four mutually incompatible error models (throw / `process.exit(2)` / an
// error-return field / silent accept of unknown flags).
//
// WHAT THIS FILE PINS — the ADOPTION, not the parser. The shared parser's own spec keys are pinned by
// gate-script-base.test.mjs / -arg-modes.test.mjs / -help-mode.test.mjs; each of the six carriers'
// END-TO-END CLI behavior is pinned by its own test file (accounting-emit / discovery-path-classify /
// guard-lineage-check / instrument-decay-check / outer-cron-registry / phase-declare), which this
// migration leaves passing unchanged. What no existing test can see is the property that CLOSES the
// finding: that the six no longer carry a private token loop. That is the reading here.
//
// ⛔ WHY THE NEGATIVE HALF MATTERS (硬规则 2 / 3b): "the shared parser is called" is trivially true of
// a file that calls it AND still keeps its own loop for some flags — a reading that only ever says
// "delegated" is an echo, not a measurement. So the predicate is TWO-sided and BOTH directions are
// exercised on fixtures below: a source that hand-rolls a loop must read `handrolled: true`, and one
// that delegates must read `handrolled: false`. Neither arm is asserted only against the real files,
// because a predicate that cannot take a false value proves nothing about them.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, "..", "scripts");

/** The six files the finding named as still hand-rolling (the other eight already wrapped the base). */
const CARRIERS = [
  "accounting-emit.ts",
  "discovery-path-classify.ts",
  "guard-lineage-check.ts",
  "instrument-decay-check.ts",
  "outer-cron-registry.ts",
  "phase-declare.ts",
];

// A hand-rolled CLI parser is recognized STRUCTURALLY — by comparing a token against a `--`-prefixed
// string literal (`a === "--json"` / `case "--root"` / `v.startsWith("--")`) — NOT by a function name
// or a loop spelling, both of which are trivia a legitimate refactor may change. Measured on this
// tree: 125 of 301 plugin/scripts sources carry at least one such comparison; the six below carry none.
const HANDROLLED_TOKEN_COMPARISON = /(?:===|!==|==|!=|case|startsWith\()\s*\(?\s*["']--/;
/** Delegation to the ONE canonical parser: a CALL, not merely an import (`import` alone is inert). */
const DELEGATED_CALL = /\bbaseParseArgs\s*\(/;
/** The module must take its parser from the shared base (the import SPECIFIER only — the binding list
 *  is left free so a rename inside the braces does not red this). */
const SHARED_IMPORT = /from\s*["']\.\/gate-script-base\.ts["']/;

function readCarrier(name) {
  return fs.readFileSync(path.join(SCRIPTS, name), "utf8");
}

function reads(source) {
  return {
    handrolled: HANDROLLED_TOKEN_COMPARISON.test(source),
    delegated: DELEGATED_CALL.test(source),
  };
}

test("the predicate can take BOTH values — retired loop vs adopted adapter (硬规则 2 negative control)", () => {
  // Verbatim shape of what was removed (phase-declare's retired `parseArgs` error-model arm).
  const retired = `function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => argv[++i];
    if (a === "--to") out.to = need();
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.error = "help";
    else return { ...out, error: \`unknown argument: \${a}\` };
  }
  return out;
}`;
  // What replaced it: the shared parser is CALLED and no token is compared here.
  const adopted = `function parseArgs(argv) {
  const parsed = baseParseArgs(["node", "phase-declare", ...argv], {
    minArgs: 0,
    usage: "--to <phase> --reason <sentence>",
    help: "return",
    errors: "return",
  });
  if (parsed.help) return { ...out, error: "help" };
  return out;
}`;
  assert.deepEqual(
    reads(retired),
    { handrolled: true, delegated: false },
    "the retired token loop must read as hand-rolled and NOT delegated",
  );
  assert.deepEqual(
    reads(adopted),
    { handrolled: false, delegated: true },
    "the adapter must read as delegated and NOT hand-rolled",
  );
});

for (const carrier of CARRIERS) {
  test(`${carrier} — parses through gate-script-base.parseArgs, with no private token loop`, () => {
    const src = readCarrier(carrier);
    assert.match(src, SHARED_IMPORT, `${carrier} must import its parser from ./gate-script-base.ts`);
    assert.equal(reads(src).delegated, true, `${carrier} must CALL the shared parser`);
    assert.equal(
      reads(src).handrolled,
      false,
      `${carrier} must not compare a token against a "--" literal — that is the hand-rolled loop the finding closed`,
    );
  });
}
