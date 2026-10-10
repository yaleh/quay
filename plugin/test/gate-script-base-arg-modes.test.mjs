// @test-group engine
// gate-script-base-arg-modes.test.mjs — the three `parseArgs` spec keys that absorbed the residual
// hand-rolled flag loops (gate-script-base.ts, tasks/gap-routine-semantic-dedup-scan-parseargs-handrolled-residuals).
//
// THE FINDING (semantic-dedup-scan, runId `semantic-dedup-scan-1791631645924`, finding
// `parseargs-handrolled-residuals`, verdict divergent-implementation, suggestedAction `unify`) named
// FOUR files that still hand-rolled a generic `--flag value` loop although this module owns a
// spec-driven parser: obligation-ledger.ts / checked-in-write-check.ts / start-drivers.ts /
// suite-scheduler.ts. Each was blocked on a capability the spec could not express:
//   • `type: "string[]"`         — a list flag (GREEDY `--files a b c`, or arity-1 REPEATED
//                                  `--test-name-pattern a --test-name-pattern b`);
//   • `unknown: "skip"`          — the ARGV-SINK arm (`strict: boolean` could only say accept/reject);
//   • `errors: "return"`         — hand a usage error BACK instead of `process.exit(2)`ing.
// This file pins each of those, plus the CONTROL that makes each pin able to take a false value: the
// default (`accept`, arity-1, `exit`) is exercised on the SAME argv so "the new arm works" cannot be
// confused with "the old arm happens to agree".
//
// The exit arms are exercised in a CHILD — an in-process assert would take the runner down with it
// (the same split gate-script-base-help-mode.test.mjs uses for `--help`).
//
// Run:
//   scripts/test.sh plugin/test/gate-script-base-arg-modes.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseArgs } from "../scripts/gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(__dirname, "..", "scripts", "gate-script-base.ts");

/** Run a snippet that calls parseArgs against the real module, in a child process. */
function runInChild(body) {
  const code = `const { parseArgs } = await import(${JSON.stringify(BASE)});\n${body}`;
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e", code], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

// ── `type: "string[]"` — the two list flavors ───────────────────────────────────────────────────

test('string[], greedy — `--files a b c` is ONE flag carrying THREE values, and leaks none into args', () => {
  const spec = { minArgs: 0, usage: "[--files <f>…]", flags: { files: { type: "string[]", greedy: true } } };
  const r = parseArgs(["node", "s", "--files", "a", "b", "c"], spec);
  assert.deepEqual(r.lists.files, ["a", "b", "c"]);
  // THE MEASURED DEFECT THIS PIN EXISTS FOR: before `greedy` existed, the spec could only be
  // `{type:"string"}` and this same argv read `flags.files = "a"` with `args = ["b","c"]` — a silent
  // reduction of a 3-file judgement to 1 (the exact shape checked-in-write-check.ts documented in its
  // own comment as the reason it could not fold). `args` MUST stay empty here.
  assert.deepEqual(r.args, [], "the greedy flag's values must not leak into the positionals");
  assert.equal(r.flags.files, undefined, "a list flag is not also a scalar flag");
});

test('string[], greedy — stops at the next `--flag` and keeps the list distinct from scalars', () => {
  const spec = {
    minArgs: 0,
    usage: "[--files <f>…] [--json]",
    flags: { files: { type: "string[]", greedy: true }, json: { type: "boolean" } },
  };
  const r = parseArgs(["node", "s", "--files", "a", "b", "--json"], spec);
  assert.deepEqual(r.lists.files, ["a", "b"], "greed ends at the next flag, not at end-of-argv");
  assert.equal(r.flags.json, true, "the flag after the run is still parsed");
});

test('string[], arity-1 — a REPEATED flag ACCUMULATES (the single-valued map cannot express this)', () => {
  const spec = { minArgs: 0, usage: "[--pat <p>]…", flags: { pat: { type: "string[]" } } };
  const r = parseArgs(["node", "s", "--pat", "a", "--pat", "b", "--pat=c"], spec);
  assert.deepEqual(r.lists.pat, ["a", "b", "c"], "both spellings accumulate, in order");
});

test("string[], arity-1 — takes the next token UNCONDITIONALLY, exactly as a scalar string flag does", () => {
  // Not a claim that this is nice input — it is the rule every caller already had, and the fold must
  // not quietly change it: a scalar string flag in this parser has always read `--flag --other` as
  // `flag = "--other"`, and so did suite-scheduler's private copy (`testNamePatterns.push(argv[++i])`
  // with no `--` guard). The asymmetry with the GREEDY arm (which DOES stop at `--`) is therefore
  // deliberate, not an oversight: each arm preserves the input language of the caller it absorbed.
  const spec = {
    minArgs: 0,
    usage: "[--pat <p>] [--json]",
    flags: { pat: { type: "string[]" }, json: { type: "boolean" } },
  };
  const r = parseArgs(["node", "s", "--pat", "--json"], spec);
  assert.deepEqual(r.lists.pat, ["--json"], "the token after the flag is its value, whatever it looks like");
  assert.equal(r.flags.json, undefined, "…so the flag it consumed is NOT separately parsed");
});

test("lists is THREE-VALUED: absent key = never supplied, present-but-empty = supplied with no value", () => {
  const spec = { minArgs: 0, usage: "[--files <f>…]", flags: { files: { type: "string[]", greedy: true } } };
  const absent = parseArgs(["node", "s"], spec);
  assert.equal(absent.lists, undefined, "no list flag in argv ⇒ no `lists` map at all");
  const empty = parseArgs(["node", "s", "--files"], spec);
  assert.deepEqual(empty.lists.files, [], "supplied with zero values is NOT the same reading as absent");
});

// ── `unknown` — accept (default) / skip / reject ────────────────────────────────────────────────

test('unknown:"skip" — the ARGV SINK drops the flag and consumes NOTHING after it', () => {
  const spec = {
    minArgs: 0,
    usage: "[--json]",
    unknown: "skip",
    flags: { json: { type: "boolean" } },
  };
  const r = parseArgs(["node", "s", "--bogus", "--json"], spec);
  assert.equal(r.flags.json, true, "the flag AFTER the unknown one must still be parsed");
  assert.deepEqual(r.args, [], "skip leaves the following token where it was — as a real flag token");
  // CONTROL on the SAME argv with the DEFAULT: `accept` treats the next token as the unknown flag's
  // VALUE, so `--json` is swallowed and the caller silently loses it. Two arms, one argv — the pin
  // above can fail.
  const defaulted = parseArgs(["node", "s", "--bogus", "--json"], { minArgs: 0, usage: "[--json]", flags: { json: { type: "boolean" } } });
  assert.equal(defaulted.flags.bogus, "--json", "control: the default arm really does swallow it");
  assert.equal(defaulted.flags.json, undefined, "control: …and the declared flag is LOST");
});

test('unknown:"skip" — a bare positional is still a positional (skip is about `--flags` only)', () => {
  const spec = { minArgs: 0, usage: "[<x>]", unknown: "skip", flags: {} };
  const r = parseArgs(["node", "s", "--bogus", "value"], spec);
  assert.deepEqual(r.args, ["value"], "the unknown flag is dropped; its intended value becomes positional");
});

test("strict:true and unknown:'reject' are the same arm (the boolean is the older spelling)", () => {
  for (const spec of [
    { minArgs: 0, usage: "u", strict: true, flags: {}, errors: "return" },
    { minArgs: 0, usage: "u", unknown: "reject", flags: {}, errors: "return" },
  ]) {
    const r = parseArgs(["node", "s", "--nope"], spec);
    assert.equal(r.error, "unknown argument: --nope");
  }
});

// ── `errors` — exit (default) / return ──────────────────────────────────────────────────────────

test("errors:'return' — an unknown flag comes BACK as `error`, and the process survives", () => {
  const r = parseArgs(["node", "s", "--nope"], {
    minArgs: 0,
    usage: "u",
    unknown: "reject",
    errors: "return",
    flags: {},
  });
  assert.equal(r.error, "unknown argument: --nope");
  assert.notEqual(r.error, undefined, "`error === undefined` must mean 'parsed fine', never 'could not tell'");
});

test("errors:'return' — the minArgs failure also returns, and a GOOD parse leaves `error` unset", () => {
  const spec = { minArgs: 2, usage: "<a> <b>", errors: "return", flags: { json: { type: "boolean" } } };
  const short = parseArgs(["node", "s", "one"], spec);
  assert.match(short.error, /^Usage: s <a> <b>$/);
  const ok = parseArgs(["node", "s", "one", "two"], spec);
  assert.equal(ok.error, undefined, "a successful parse must not carry an error value");
  assert.deepEqual(ok.args, ["one", "two"]);
});

test("errors:'exit' (the default) — the same bad invocation still exits 2, in a child", () => {
  const r = runInChild('parseArgs(["node","s","--nope"], { minArgs: 0, usage: "u", unknown: "reject" });\nconsole.log("REACHED-AFTER-REJECT");\n');
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /unknown argument: --nope/, "the message goes to stderr");
  assert.doesNotMatch(r.stdout, /REACHED-AFTER-REJECT/, "the exit arm must not return");
});

test("errors:'exit' — the minArgs failure path still exits 2 (unchanged by the new keys)", () => {
  const r = runInChild('parseArgs(["node","s"], { minArgs: 1, usage: "<x>" });\nconsole.log("REACHED");\n');
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}`);
  assert.match(r.stderr, /Usage: s <x>/);
  assert.doesNotMatch(r.stdout, /REACHED/);
});
