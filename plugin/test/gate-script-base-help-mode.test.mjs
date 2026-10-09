// @test-group engine
// gate-script-base-help-mode.test.mjs — the shared `parseArgs` NON-EXITING help mode
// (plugin/scripts/gate-script-base.ts, tasks/gap-routine-semantic-dedup-scan-parse-args-handrolled-variants).
//
// THE FINDING (semantic-dedup-scan, runId `semantic-dedup-scan-1791536153223`, finding
// `parse-args-handrolled-variants`, suggestedAction "merge — give the shared parser a non-exiting
// help mode"): six hand-rolled flag loops could not converge onto the spec-driven shared parser
// because it `process.exit()`ed on `--help`, while those callers print their OWN usage and return.
// `spec.help: "return"` removes that blocker.
//
// This file pins BOTH arms so they stay distinguishable (硬规则 3b — "returned without exiting" must
// never be confusable with "exited normally"):
//   • the RETURN arm is exercised IN PROCESS (it does not kill the runner);
//   • the EXIT arm (the default, unchanged) is exercised in a CHILD — an in-process assert would take
//     the whole runner down with it, and the `REACHED-AFTER-HELP` marker is the negative control
//     proving the exit arm truly does not return.
//
// Run:
//   scripts/test.sh plugin/test/gate-script-base-help-mode.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseArgs } from "../scripts/gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(__dirname, "..", "scripts", "gate-script-base.ts");

/** Run a code snippet that calls parseArgs against the real module, in a child process. */
function runInChild(body) {
  const code = `const { parseArgs } = await import(${JSON.stringify(BASE)});\n${body}`;
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e", code], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

// ── return arm (the mode this task adds) ────────────────────────────────────────────────────────
test("help:'return' — --help/-h sets help:true and does NOT exit, even with minArgs unmet", () => {
  const spec = { minArgs: 2, usage: "<a> <b> [--json]", help: "return", flags: { json: { type: "boolean" } } };
  for (const flag of ["--help", "-h"]) {
    const r = parseArgs(["node", "s", flag], spec);
    assert.equal(r.help, true, `${flag} must set help:true`);
    assert.deepEqual(r.args, [], "the help arm returns before any positional is collected");
    assert.deepEqual(r.flags, {}, "the help arm returns before any flag is collected");
  }
});

test("help:'return' — --help is NOT a missing-arg error (minArgs:2, zero positionals, no exit)", () => {
  // On the minArgs path this spec would exit 2; the help arm returns first, so the process survives.
  const r = parseArgs(["node", "s", "--help"], { minArgs: 2, usage: "<a> <b>", help: "return" });
  assert.equal(r.help, true);
});

test("help:'return' — a normal run leaves `help` unset and parses flags/positionals", () => {
  const spec = { minArgs: 1, usage: "<x> [--json]", help: "return", flags: { json: { type: "boolean" } } };
  const r = parseArgs(["node", "s", "--json", "pos"], spec);
  assert.notEqual(r.help, true, "help must not be truthy on a normal run");
  assert.deepEqual(r.args, ["pos"]);
  assert.equal(r.flags.json, true);
});

// ── exit arm (the default, unchanged) — child-process negative controls ─────────────────────────
test("default mode — --help prints usage to stdout and exits 0, never returning", () => {
  const r = runInChild(
    'parseArgs(["node","s","--help"], { minArgs: 1, usage: "<x>" });\nconsole.log("REACHED-AFTER-HELP");\n',
  );
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /usage: s <x>/, "usage must be printed to stdout");
  assert.doesNotMatch(r.stdout, /REACHED-AFTER-HELP/, "the exit arm must not return — it must exit");
});

test("default mode — an absent required positional still exits 2 (the new arm left this untouched)", () => {
  const r = runInChild('parseArgs(["node","s"], { minArgs: 1, usage: "<x>" });\n');
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}`);
  assert.match(r.stderr, /Usage: s <x>/);
});
