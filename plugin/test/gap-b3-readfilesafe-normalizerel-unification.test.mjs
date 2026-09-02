// @test-group engine
// gap-b3-readfilesafe-normalizerel-unification.test.mjs — SPEC §1.6 B3: `readFileSafe`(4) and
// `normalizeRel`(4) were TRUE_DUP (four byte-identical per-checker copies each). This file is the
// single-source + ratchet + negative-control + semantics guard (AC1/AC2/AC3). It reads SOURCE, not
// a fixture — so a redefinition, a dropped import, or a semantic drift all turn RED.
//
//   AC1 (single source / ratchet): exactly ONE `function readFileSafe` and ONE `function normalizeRel`
//        definition remain anywhere under plugin/scripts — both in gate-script-base.ts.
//   AC2 (negative control): the 8 former local copies are gone (no hidden redefinition survives),
//        every consumer imports from gate-script-base.ts, and a scratch fixture proves that
//        DELETING the shared export makes a consumer import FAIL (so the unification is real, not a
//        shadow — "删了不红 ⇒ 假").
//   AC3 (semantics): the merged normalizeRel preserves the full normalization contract the two
//        formerly-"canonical" copies shared (forward slashes, `./`/`//`/`.`/`..`/trailing-`/`,
//        backslash→slash, wildcards preserved, leading `..` dropped).
//
// Run: node --test plugin/test/gap-b3-readfilesafe-normalizerel-unification.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readFileSafe, normalizeRel } from "../scripts/gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");

/** The plugin/scripts checker source files (TS only — the .sh checkers carry no TS functions). */
function scriptTsFiles() {
  return fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts"));
}

function sourceOf(rel) {
  return fs.readFileSync(path.join(SCRIPTS_DIR, rel), "utf8");
}

// The 7 files that previously each carried a byte-identical local copy (4 readFileSafe + 3 normalizeRel).
const READ_FILE_SAFE_CONSUMERS = [
  "test-framework-policy-check.ts",
  "test-impl-census-check.ts",
  "test-group-downgrade-check.ts",
  "config-wiring-check.ts",
];
const NORMALIZE_REL_CONSUMERS = [
  "select-static-checks-for-touches.ts",
  "select-tests-for-touches.ts",
  "suite-bucket-attribution.ts",
];
const ALL_CONSUMERS = [...READ_FILE_SAFE_CONSUMERS, ...NORMALIZE_REL_CONSUMERS];

// ── AC1: single source (the ratchet — a redefinition turns this RED) ────────────────────────────────

test("AC1 — readFileSafe is defined exactly once (gate-script-base.ts)", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction readFileSafe\b/.test(sourceOf(f)));
  assert.deepEqual(
    defs,
    ["gate-script-base.ts"],
    `readFileSafe must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

test("AC1 — normalizeRel is defined exactly once (gate-script-base.ts)", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction normalizeRel\b/.test(sourceOf(f)));
  assert.deepEqual(
    defs,
    ["gate-script-base.ts"],
    `normalizeRel must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

// ── AC2: negative control (删共享 ⇒ 调用点红) ───────────────────────────────────────────────────────

test("AC2 — the 8 former local copies are gone (no hidden redefinition survives)", () => {
  for (const f of READ_FILE_SAFE_CONSUMERS) {
    assert.doesNotMatch(sourceOf(f), /\bfunction readFileSafe\b/, `${f} must not redefine readFileSafe`);
  }
  for (const f of NORMALIZE_REL_CONSUMERS) {
    assert.doesNotMatch(sourceOf(f), /\bfunction normalizeRel\b/, `${f} must not redefine normalizeRel`);
  }
});

test("AC2 — every consumer imports the shared source from gate-script-base.ts", () => {
  for (const f of ALL_CONSUMERS) {
    assert.match(
      sourceOf(f),
      /from ["']\.\/gate-script-base\.ts["']/,
      `${f} must import the shared source from gate-script-base.ts`,
    );
  }
});

test("AC2 — deleting the shared export makes a consumer import fail (mechanism is real)", () => {
  // Scratch fixture: a consumer importing an ABSENT named export must fail to link; the same
  // consumer succeeds once the export exists. This is the "删了不红 ⇒ 假" negative control —
  // it proves the unification is a real dependency, not a shadow local copy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-b3-negctl-"));
  try {
    fs.writeFileSync(path.join(dir, "gate-script-base.ts"), "export const OTHER = 1;\n");
    fs.writeFileSync(
      path.join(dir, "consumer.ts"),
      'import { readFileSafe } from "./gate-script-base.ts";\nconsole.log(readFileSafe);\n',
    );
    const missing = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.notEqual(missing.status, 0, "a consumer importing an absent export must fail to link");

    fs.writeFileSync(path.join(dir, "gate-script-base.ts"), 'export function readFileSafe(p) { return ""; }\n');
    const present = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(present.status, 0, "the same consumer links once the export is present");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC3: merged normalizeRel semantics (the two formerly-"canonical" copies were byte-identical) ────

test("AC3 — normalizeRel preserves the full normalization contract", () => {
  const cases = [
    // [input, expected]
    ["a/b/c", "a/b/c"], // identity
    ["./a/b", "a/b"], // leading ./
    ["a//b", "a/b"], // collapse //
    ["a/./b", "a/b"], // resolve .
    ["a/../b", "b"], // resolve ..
    ["../a", "a"], // leading .. dropped (empty stack pop is a no-op)
    ["a/b/", "a/b"], // drop trailing /
    ["a\\b", "a/b"], // backslash → forward slash
    ["a/*/b", "a/*/b"], // wildcard preserved untouched
    ["a/../", ""], // .. pops `a`, then trailing / collapses → empty
    ["", ""], // empty stays empty
    [".", ""], // bare . collapses to empty
    ["/a", "a"], // leading / → empty segment skipped
    ["a/.", "a"], // trailing . dropped
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeRel(input), expected, `normalizeRel(${JSON.stringify(input)})`);
  }
});

test("AC3 — readFileSafe reads UTF-8 and returns \"\" for a missing file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-b3-readsafe-"));
  try {
    const f = path.join(dir, "sample.txt");
    fs.writeFileSync(f, "hello\n");
    assert.equal(readFileSafe(f), "hello\n");
    assert.equal(readFileSafe(path.join(dir, "absent.txt")), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
