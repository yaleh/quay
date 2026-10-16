// @test-group engine
// list-script-basenames-single-source.test.mjs — `listScriptBasenames` has exactly ONE definition
// (fs-walk.ts's), imported and re-exported by BOTH of its consumers
// (outer-retirement-precondition-check.ts and registry-bare-filename-scan.ts). That makes "the script
// set the retirement checker enumerates" and "the script set the dead-set scanner enumerates" the
// same set BY CONSTRUCTION.
//
// Regression guard for gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name
// (2nd round of the finding: an earlier round reported the same divergence under
// `list-script-basenames-divergence`, runId semantic-dedup-scan-1791238550062). The two copies were
// byte-identical under ONE name and differed only in the extension predicate — EXEC_EXTENSIONS
// (.ts .sh .mjs .js .cjs .bash) vs a local SCRIPT_EXTENSIONS (.ts .sh .mjs) — so on this repo they
// enumerated 384 and 381 basenames, and a consumer moved from one to the other silently lost the
// `.cjs` scripts. The docstring of the retirement checker's copy meanwhile claimed `.ts/.sh/.mjs`
// while its code filtered on six extensions: a comment asserting an identity is not the identity.
//
// Why the surviving predicate is the WIDER one (measured, not preferred — the same shape as the
// sibling concurrency-parse disposition):
//   • the two sets differed by exactly three files, all `.cjs`;
//   • widening is INERT for the retirement checker — the execution core references the same 28
//     scripts under either set, so no verdict of that checker moves;
//   • widening is inert-to-CORRECT for the dead-set scanner — all three `.cjs` carry referrers, so
//     the wider universe adds 3 KEPT scripts and 0 new dead ones.
// The narrower set therefore bought nothing and kept a script class this repo really has out of a
// completeness instrument's universe.
//
// Run:
//   scripts/test.sh plugin/test/list-script-basenames-single-source.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listScriptBasenames, SCRIPTS_DIR_REL } from "../scripts/fs-walk.ts";
import {
  listScriptBasenames as viaOuter,
  SCRIPTS_DIR_REL as outerScriptsDirRel,
} from "../scripts/outer-retirement-precondition-check.ts";
import {
  listScriptBasenames as viaScan,
  SCRIPTS_DIR_REL as scanScriptsDirRel,
} from "../scripts/registry-bare-filename-scan.ts";
import { codeOnlyText } from "../scripts/source-text-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(repoRoot, "plugin", "scripts");
const SCAN_CLI = path.join(SCRIPTS_DIR, "registry-bare-filename-scan.ts");
const OUTER_CLI = path.join(SCRIPTS_DIR, "outer-retirement-precondition-check.ts");

/** The three scripts whose enumeration the two predicates disagreed about. */
const CJS_CLASS = ["checked-in-write-guard.cjs", "checked-in-write-run.cjs", "suite-fs-trace-preload.cjs"];

/** Make a throwaway repo root and clean it up with the test. */
function fixture(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lsb-${tag}-`));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  return dir;
}

/** Spawn a checker CLI the way scripts/test.sh / runner-static-gate.ts does, and parse its JSON. */
function runCli(cli, args) {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", cli, ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return r;
}

// ── ① One definition ────────────────────────────────────────────────────────────────────────────────

test("one definition: both consumers' listScriptBasenames IS fs-walk's (a second copy is how the predicates drifted)", () => {
  assert.equal(
    viaOuter,
    listScriptBasenames,
    "outer-retirement-precondition-check.ts must RE-EXPORT fs-walk.ts's listScriptBasenames, not carry its own copy",
  );
  assert.equal(
    viaScan,
    listScriptBasenames,
    "registry-bare-filename-scan.ts must RE-EXPORT fs-walk.ts's listScriptBasenames, not carry its own copy",
  );
  assert.equal(viaOuter, viaScan, "the two consumers must enumerate with the SAME function");
  assert.equal(outerScriptsDirRel, SCRIPTS_DIR_REL, "the script dir constant has one definition too");
  assert.equal(scanScriptsDirRel, SCRIPTS_DIR_REL, "the script dir constant has one definition too");
});

// ── ② No second definition, by POSITION (a comment mentioning the name is not a copy) ───────────────

test("no second definition: exactly one plugin/scripts file DEFINES listScriptBasenames", () => {
  const DEFINITION_RE = /(?:export\s+)?function\s+listScriptBasenames\s*\(/;

  // 硬规则 2, both halves. The predicate must FIRE on a known-true definition and must NOT fire when
  // the same text sits in a comment — otherwise "one definition site" below would be
  // indistinguishable from a regex that matches nothing (or matches comments).
  const sample = "export function listScriptBasenames(root: string): string[] { return []; }";
  assert.ok(DEFINITION_RE.test(codeOnlyText(sample)), "the predicate must fire on a real definition");
  assert.ok(!DEFINITION_RE.test(codeOnlyText(`// ${sample}`)), "…and be blind to it inside a line comment");
  assert.ok(!DEFINITION_RE.test(codeOnlyText(`/* ${sample} */`)), "…and inside a block comment");

  const defining = [];
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (!name.endsWith(".ts")) continue;
    // 硬规则 2: judge by POSITION — the name inside a comment is not a definition.
    if (DEFINITION_RE.test(codeOnlyText(fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8")))) {
      defining.push(name);
    }
  }
  assert.deepEqual(
    defining,
    ["fs-walk.ts"],
    `listScriptBasenames must have exactly one definition site (got ${defining.join(", ") || "∅"}) — ` +
      `a second copy is exactly how the two predicates diverged`,
  );
});

// ── ③ The real repo: the `.cjs` class the narrow predicate dropped is IN the universe ───────────────

test("real repo: the `.cjs` script class is enumerated (0 hits ⇒ predicate broken, not 'no such script')", () => {
  const names = listScriptBasenames(repoRoot);
  for (const f of CJS_CLASS) {
    assert.ok(
      names.includes(f),
      `${f} must be in the universe — it is one of the three files the two predicates disagreed about ` +
        `(0 hits = the predicate is wrong, NOT that the file is absent)`,
    );
  }
  // Controls: the class the narrow predicate already kept, and the exclusion both copies agreed on.
  assert.ok(names.includes("fs-walk.ts"), "control: a `.ts` script is enumerated too");
  assert.ok(names.includes("runner-static-gate.ts"), "control: a checker named by the execution core is enumerated");
  assert.ok(!names.some((n) => n.endsWith(".md")), "`.md` stays absent — a doc mention is not a call surface");
  assert.ok(!names.includes("checker-mutation-cases"), "enumeration is top-level only, never recursive");
});

// ── ④ The predicate is a real filter: it can also come back empty ───────────────────────────────────

test("predicate control: the extension set filters, the walk is non-recursive, and an empty dir stays empty", () => {
  const dir = fixture("pred");
  const scripts = path.join(dir, "plugin", "scripts");
  for (const n of ["foo.cjs", "bar.ts", "baz.sh", "qux.mjs", "README.md", "data.json"]) {
    fs.writeFileSync(path.join(scripts, n), "// fixture\n");
  }
  fs.mkdirSync(path.join(scripts, "subdir"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "subdir", "nested.ts"), "// nested\n");

  assert.deepEqual(
    listScriptBasenames(dir),
    ["bar.ts", "baz.sh", "foo.cjs", "qux.mjs"],
    "scripts in, non-scripts out, subdirectories never descended",
  );

  // Negative control (the other direction): with no script at all the SAME call returns ∅. Without
  // this, `assert.ok(names.includes(...))` above could be satisfied by a predicate that matches
  // everything.
  const empty = fixture("empty");
  fs.writeFileSync(path.join(empty, "plugin", "scripts", "notes.md"), "// not a script\n");
  assert.deepEqual(listScriptBasenames(empty), [], "a directory with no script returns ∅");
});

// ── ⑤ The runtime arm: BOTH production entry points see the `.cjs` class ────────────────────────────
// ①–④ are satisfiable by importing the re-export; they cannot see whether each checker's own module
// scope (and its CLI wiring) enumerates the same set. This arm drives the two actual CLIs on a
// fixture whose ONLY script is a `.cjs` — i.e. a carrier on which the withdrawn narrow predicate
// reads 0 — so the readings below CAN take false. ⛔ Do not replace this with another import-based
// check, and do not drop the empty fixture: the pair is what shows the reading tracks the input.

test("runtime arm: both PRODUCTION CLIs enumerate a `.cjs`-only fixture (the withdrawn predicate reads 0 there)", () => {
  const dir = fixture("runtime");
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "foo.cjs"), "// the only script\n");
  fs.writeFileSync(
    path.join(dir, "orchestration", "orchestrator-tick-core.md"),
    "run: plugin/scripts/foo.cjs\n",
  );

  const scanRes = runCli(SCAN_CLI, ["--scan", "--json", "--root", dir]);
  assert.equal(scanRes.status, 0, `registry-bare-filename-scan --scan must exit 0:\n${scanRes.stderr}`);
  const scanJson = JSON.parse(scanRes.stdout);
  assert.equal(
    scanJson.scriptCount,
    1,
    "the dead-set scanner's universe must contain the fixture's only script (foo.cjs) — " +
      "under the withdrawn `.ts/.sh/.mjs` predicate this reads 0",
  );

  const outerRes = runCli(OUTER_CLI, ["--root", dir, "--json"]);
  assert.equal(
    outerRes.status,
    0,
    `outer-retirement-precondition-check must evaluate the fixture (exit 3 = it enumerated nothing):\n${outerRes.stderr}`,
  );
  const outerJson = JSON.parse(outerRes.stdout);
  assert.equal(
    outerJson.referencedCount,
    1,
    "the retirement checker must see the `.cjs` script its fixture execution core names",
  );
  assert.deepEqual(
    outerJson.orphanNonCheckers,
    ["foo.cjs"],
    "and it must name it — the enumeration surface, not just a count",
  );

  // Negative control, same two CLIs, same code path, no script at all: the readings go to the OTHER
  // values, so neither assertion above is structurally guaranteed.
  const bare = fixture("runtime-empty");
  fs.mkdirSync(path.join(bare, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(bare, "plugin", "scripts", "foo.md"), "// a doc, not a script\n");
  fs.writeFileSync(path.join(bare, "orchestration", "orchestrator-tick-core.md"), "run: plugin/scripts/foo.md\n");

  const bareScan = runCli(SCAN_CLI, ["--scan", "--json", "--root", bare]);
  assert.equal(JSON.parse(bareScan.stdout).scriptCount, 0, "no script ⇒ an empty universe");
  const bareOuter = runCli(OUTER_CLI, ["--root", bare, "--json"]);
  assert.equal(
    bareOuter.status,
    3,
    "no enumerable script under the execution core ⇒ NOT-EVALUATED, a state distinct from PASS",
  );
});
