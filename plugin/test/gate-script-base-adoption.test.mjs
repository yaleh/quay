// @test-group engine
// gate-script-base-adoption.test.mjs — the hand-rolled CLI token loops in plugin/scripts now route
// through gate-script-base.ts's `parseArgs`.
//
// HISTORY (two findings, one ratchet): a semantic-dedup-scan pass (runId
// `semantic-dedup-scan-1791908616513`, findingId `parse-args-adoption-split`) counted the family as
// eight adopters PLUS six hand-rolled loops owning four mutually incompatible error models; this file
// was written for those six. A LATER pass (runId `semantic-dedup-scan-1792752400273`, findingId
// `parseargs-seven-forked-loops`) measured SIXTEEN definitions delegating and SEVEN still hand-rolling
// — the residual set (`ac69-slot-queue-gap-check` / `defect-latency-pair` / `loadbearing-test-gate` /
// `outer-anchor-check` / `peer-identity-probe` / `slice-readings` / `suite-lpt-order`) — and that set
// is converged here. Measured on this tree after the migration: 22 module-level `parseArgs`
// declarations, 21 of them adapters that CALL the shared parser, 1 (gate-script-base.ts itself) the
// canonical export, 0 hand-rolled token loops.
//
// WHAT THIS FILE PINS — the ADOPTION, not the parser. The shared parser's own spec keys are pinned by
// gate-script-base.test.mjs / -arg-modes.test.mjs / -help-mode.test.mjs; each carrier's END-TO-END CLI
// behavior is pinned by its own test file, which this migration leaves passing unchanged. What no
// existing test can see is the property that CLOSES the findings: that no carrier keeps a private
// token loop. That is the reading here — and it is FAMILY-WIDE (`no module-level parseArgs outside the
// base may skip delegation`), so a NEW hand-rolled parser cannot be added without reddening it.
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

/** The canonical owner of the parser — the ONE file allowed to implement it. */
const BASE = "gate-script-base.ts";

/** Every module-level `parseArgs` that must delegate: the six from the first finding plus the seven
 *  residuals named by `parseargs-seven-forked-loops`. Kept as an explicit list (in addition to the
 *  family-wide scan below) so a carrier that LOSES its adapter is named by the failing test rather
 *  than only enumerated by a count. */
const CARRIERS = [
  // finding `parse-args-adoption-split` (runId semantic-dedup-scan-1791908616513)
  "accounting-emit.ts",
  "discovery-path-classify.ts",
  "guard-lineage-check.ts",
  "instrument-decay-check.ts",
  "outer-cron-registry.ts",
  "phase-declare.ts",
  // finding `parseargs-seven-forked-loops` (runId semantic-dedup-scan-1792752400273)
  "ac69-slot-queue-gap-check.ts",
  "defect-latency-pair.ts",
  "loadbearing-test-gate.ts",
  "outer-anchor-check.ts",
  "peer-identity-probe.ts",
  "slice-readings.ts",
  "suite-lpt-order.ts",
];

// A hand-rolled CLI parser is recognized STRUCTURALLY — by comparing a token against a `--`-prefixed
// FLAG literal (`a === "--json"` / `case "--root"` / `v.startsWith("--")`) — NOT by a function name
// or a loop spelling, both of which are trivia a legitimate refactor may change.
//
// The `startsWith` arm requires the literal to be EXACTLY `"--"`: a wider `startsWith("--` would also
// match a diff parser's `raw.startsWith("--- ")` / `startsWith("diff --git ")` (defect-latency-pair's
// `git show` reader), which has nothing to do with argv. That false positive was measured, not
// imagined — it is pinned as a negative control below.
const HANDROLLED_TOKEN_COMPARISON =
  /(?:(?:===|!==|==|!=)\s*\(?\s*["']--|case\s+["']--|startsWith\(\s*["']--["'])/;
/** Delegation to the ONE canonical parser: a CALL, not merely an import (`import` alone is inert). */
const DELEGATED_CALL = /\bbaseParseArgs\s*\(/;
/** The module must take its parser from the shared base (the import SPECIFIER only — the binding list
 *  is left free so a rename inside the braces does not red this). */
const SHARED_IMPORT = /from\s*["']\.\/gate-script-base\.ts["']/;
/** A module-level parser declaration — `function parseArgs(...)` or `const parseArgs = (...)`. */
const PARSER_DECLARATION = /^(?:export\s+)?(?:function|const|let|var)\s+parseArgs\b/m;

function readCarrier(name) {
  return fs.readFileSync(path.join(SCRIPTS, name), "utf8");
}

function reads(source) {
  return {
    handrolled: HANDROLLED_TOKEN_COMPARISON.test(source),
    delegated: DELEGATED_CALL.test(source),
  };
}

/** The body slice a declaration's delegation must be visible in: from the declaration to the next
 *  module-level `function`/`export function` (or 120 lines, whichever is nearer). Cheap and
 *  deliberately generous — a false NEGATIVE here would hide a hand-rolled loop, so the window errs
 *  wide rather than narrow. */
function declarationBody(source) {
  const m = PARSER_DECLARATION.exec(source);
  if (!m) return null;
  const start = m.index;
  const rest = source.slice(start);
  const next = /^((?:export\s+)?(?:function|class)\s+\w+)/m.exec(rest.slice(1));
  const end = next ? start + 1 + next.index : Math.min(source.length, start + 12000);
  return source.slice(start, end);
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

test("the predicate ignores a DIFF parser's `startsWith(\"--- \")` — a flag-token literal, not file text (measured false positive)", () => {
  // defect-latency-pair.ts:206 reads `git show` output; `raw.startsWith("--- ")` is a unified-diff
  // header, not an argv token. The broader `startsWith(\"--` arm this predicate used to carry would
  // have called that file hand-rolled and forced either a false red or a silent exclusion.
  const diffReader = `function parsePatch(raw) {
  if (raw.startsWith("--- ") || raw.startsWith("diff --git ")) return null;
}`;
  const argvLoop = `function parseArgs(argv) {
  for (const a of argv) if (a.startsWith("--")) cur = a.slice(2);
}`;
  assert.equal(reads(diffReader).handrolled, false, "a diff header must NOT read as a hand-rolled argv loop");
  assert.equal(reads(argvLoop).handrolled, true, "an argv `--` prefix test MUST read as hand-rolled");
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

// FAMILY-WIDE, not list-wide: the list above can only fail for files someone remembered to add. This
// scan reads the directory, so a NEW module-level `parseArgs` that bypasses the shared parser reds
// here without anyone updating a list — the property that actually closes a duplication finding.
test("no module-level parseArgs in plugin/scripts bypasses the shared parser (family-wide)", () => {
  const names = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".ts")).sort();
  const offenders = [];
  for (const name of names) {
    if (name === BASE) continue;
    const src = fs.readFileSync(path.join(SCRIPTS, name), "utf8");
    const body = declarationBody(src);
    if (body === null) continue;
    if (!DELEGATED_CALL.test(body)) offenders.push(name);
  }
  // The scan must be able to see the family at all — an empty directory or a broken regex would make
  // this assertion vacuously true (硬规则 4: a structurally-unfalsifiable reading is not a measurement).
  assert.ok(names.length > 100, `expected plugin/scripts to hold many sources, saw ${names.length}`);
  assert.deepEqual(offenders, [], `these modules declare parseArgs without calling the shared parser: ${offenders.join(", ")}`);
});

test("the family-wide scan's negative control — a synthetic bypassing module IS reported", () => {
  const source = `function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--json") out.json = true;
  return out;
}`;
  const body = declarationBody(source);
  assert.ok(body !== null, "the declaration must be found at all");
  assert.equal(DELEGATED_CALL.test(body), false, "a bypassing module must read as NOT delegating");
});
