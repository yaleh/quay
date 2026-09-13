// @test-group engine
// suite-bucket-reattr-ratchet-check.test.mjs — gap-suite-bucket-dynamic-truth-drift-detector (阶段 C).
//
// THE DEFECT THIS CLOSES: AC121 re-attributed 230 "test.sh-as-shell" tests to a singleton S|M judgment
// (.quay/suite-bucket-reattribution.jsonl), but that coverage was a one-time manual claim ("重扫=0"),
// never a mechanical ratchet. A NEW test whose STATIC attribution is PURE S (its only subject signal a
// scripts/test.sh mention) that is NOT re-attributed silently reopens the AC121 mis-attribution risk
// (bucketed S ⇒ skipped on an M change while its true subject is an M mechanism). This test pins:
//   ③-AC6  a statically pure-S test with no reattribution entry ⇒ layer 1 (blocking) RED.
//           negative control: the same pure-S test WITH a reattribution entry ⇒ no layer 1.
//   ③-AC7  a statically S-signal-multi (S+M) test with no entry ⇒ layer 2 (report, non-blocking) — a
//           count, never a RED (over-selection is the safe direction).
//   ③-AC8  the real reattribution file carries NO zombie entries (every file still a suite test) —
//           judged by the CHECKER's layer 3, not by a re-derivation in this test
//           (gap-suite-bucket-zombie-check-bills-the-next-unrelated-task: the condition used to live
//           ONLY here, i.e. only in a full-suite run; it now lives on the checker's own surface, so
//           the `change`-tier static gate reddens the deleting change at its own scoped run).
//   hard rule 3b — no reattribution file ⇒ NOT-EVALUATED (evaluated=false), never a green "0".
//
// Run:
//   scripts/test.sh plugin/test/suite-bucket-reattr-ratchet-check.test.mjs
//   node --test plugin/test/suite-bucket-reattr-ratchet-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

import { checkReattrRatchet } from "../scripts/suite-bucket-reattr-ratchet-check.ts";
import { listSuiteFiles, loadReattribution } from "../scripts/suite-bucket-select.ts";
import { bucketSetOf } from "../scripts/suite-bucket-attribution.ts";

function makeTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `sbrac-${prefix}-`)); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

/** A fixture root with the minimal suite dirs + files (a test file, an optional reattribution file). */
function makeFixture(files) {
  const root = makeTmp("fix");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

// A statically PURE-S test (only subject signal: the scripts/test.sh spawn arg).
const PURE_S_TEST = [
  `import { test } from "node:test";`,
  `import { spawnSync } from "node:child_process";`,
  `test("pure-s", () => { spawnSync("bash", ["scripts/test.sh", "--help"], { encoding: "utf8" }); });`,
].join("\n");

// ── ③-AC6 — pure-S un-attributed ⇒ layer 1 (blocking) RED ────────────────────────────────────────────

test("③-AC6 — a statically pure-S test with no reattribution entry is layer-1 RED (blocking)", () => {
  const root = makeFixture({
    "plugin/test/pure-s.test.mjs": PURE_S_TEST,
    // the attributed file must EXIST as a suite test, else the fixture carries a layer-3 zombie and
    // this test would pass for a reason other than layer 1.
    "plugin/test/other.test.mjs": PURE_S_TEST,
    ".quay/suite-bucket-reattribution.jsonl": `{"file":"plugin/test/other.test.mjs","judgment":"M","mechanism":"S","signal":[]}\n`,
  });
  try {
    assert.deepEqual([...bucketSetOf("plugin/test/pure-s.test.mjs", root)], ["S"], "fixture static attribution must be pure S (the drift precondition)");
    const rep = checkReattrRatchet(root);
    assert.equal(rep.evaluated, true, "with a reattribution file the check must be evaluated");
    assert.ok(rep.layer1.includes("plugin/test/pure-s.test.mjs"), `the pure-S test must be layer-1, got ${JSON.stringify(rep.layer1)}`);
  } finally { cleanup(root); }
});

test("③-AC6 negative control — the same pure-S test WITH a reattribution entry reports no layer 1", () => {
  const root = makeFixture({
    "plugin/test/pure-s.test.mjs": PURE_S_TEST,
    ".quay/suite-bucket-reattribution.jsonl": `{"file":"plugin/test/pure-s.test.mjs","judgment":"M","mechanism":"S","signal":[]}\n`,
  });
  try {
    const rep = checkReattrRatchet(root);
    assert.equal(rep.evaluated, true);
    assert.deepEqual(rep.zombies, [], "the entry names the fixture's own live file ⇒ no layer-3 zombie here");
    assert.equal(rep.layer1.length, 0, `a re-attributed pure-S test must not be layer-1, got ${JSON.stringify(rep.layer1)}`);
  } finally { cleanup(root); }
});

// ── ③-AC7 — S-signal-multi un-attributed ⇒ layer 2 (report, non-blocking) ────────────────────────────

test("③-AC7 — a statically S+M test with no entry is layer-2 (report) only, never layer-1 (blocking)", () => {
  const root = makeFixture({
    // static S (scripts/test.sh spawn arg) + M (a ../scripts import) ⇒ S+M.
    "plugin/test/s+m.test.mjs": [
      `import { test } from "node:test";`,
      `import { spawnSync } from "node:child_process";`,
      `import { classifyPath } from "../scripts/suite-bucket-attribution.ts";`,
      `test("s+m", () => { spawnSync("bash", ["scripts/test.sh", "--help"]); classifyPath("plugin/scripts/x"); });`,
    ].join("\n"),
    // live, attributed ⇒ contributes neither layer 1 nor layer 3 (isolation for the layer-2 assertion).
    "plugin/test/other.test.mjs": PURE_S_TEST,
    ".quay/suite-bucket-reattribution.jsonl": `{"file":"plugin/test/other.test.mjs","judgment":"M","mechanism":"S","signal":[]}\n`,
  });
  try {
    assert.deepEqual([...bucketSetOf("plugin/test/s+m.test.mjs", root)].sort(), ["M", "S"], "fixture static attribution must be S+M");
    const rep = checkReattrRatchet(root);
    assert.equal(rep.evaluated, true);
    assert.equal(rep.layer1.length, 0, `an S+M test is over-selection (safe) — never layer-1, got ${JSON.stringify(rep.layer1)}`);
    assert.ok(rep.layer2.includes("plugin/test/s+m.test.mjs"), `the S+M test must be layer-2 (report), got ${JSON.stringify(rep.layer2)}`);
  } finally { cleanup(root); }
});

// ── hard rule 3b — no reattribution file ⇒ NOT-EVALUATED ─────────────────────────────────────────────

test("hard rule 3b — NO reattribution file ⇒ NOT-EVALUATED (evaluated=false), never a green '0'", () => {
  const root = makeFixture({ "plugin/test/pure-s.test.mjs": PURE_S_TEST });
  try {
    const rep = checkReattrRatchet(root);
    assert.equal(rep.evaluated, false, "no reattribution file ⇒ evaluated=false");
    assert.equal(rep.layer1.length, 0);
    assert.equal(rep.layer2.length, 0);
    assert.equal(rep.zombies.length, 0, "NOT-EVALUATED reports no zombies — an absent input is not a clean bill of health");
  } finally { cleanup(root); }
});

// ── ③-AC8 — an entry whose file is no longer a suite test is a ZOMBIE (layer 3, blocking) ────────────
//
// AC8(a): the FALSIFIABLE direction — deleting a suite test file WITHOUT dropping its entry must be
// layer-3 RED. Every fixture below is the same shape the production incident had (a test file present
// + a record entry for it, then the file removed), so a checker that reports no zombies here is a
// checker that cannot fail (hard rule 3b) and the assertion says so.

test("③-AC8 — a reattribution entry pointing at a NON-suite file is layer-3 (blocking) RED", () => {
  const root = makeFixture({
    "plugin/test/kept.test.mjs": PURE_S_TEST,
    ".quay/suite-bucket-reattribution.jsonl": [
      `{"file":"plugin/test/kept.test.mjs","judgment":"M","mechanism":"S","signal":[]}`,
      // the deleted file: an entry survives the file it names — the zombie shape.
      `{"file":"plugin/test/deleted.test.mjs","judgment":"M","mechanism":"S","signal":[]}`,
    ].join("\n") + "\n",
  });
  try {
    const rep = checkReattrRatchet(root);
    assert.equal(rep.evaluated, true, "with a reattribution file the check must be evaluated");
    assert.deepEqual(rep.zombies, ["plugin/test/deleted.test.mjs"],
      `the entry whose file is gone must be layer-3, got ${JSON.stringify(rep.zombies)}`);
    assert.equal(rep.layer1.length, 0, "the surviving entry keeps the pure-S test attributed — layer 1 must stay clean");
  } finally { cleanup(root); }
});

test("③-AC8 negative control — an entry whose file IS a suite test yields no zombie", () => {
  const root = makeFixture({
    "plugin/test/kept.test.mjs": PURE_S_TEST,
    ".quay/suite-bucket-reattribution.jsonl": `{"file":"plugin/test/kept.test.mjs","judgment":"M","mechanism":"S","signal":[]}\n`,
  });
  try {
    const rep = checkReattrRatchet(root);
    assert.equal(rep.evaluated, true);
    assert.deepEqual(rep.zombies, [], `a live entry must not be layer-3, got ${JSON.stringify(rep.zombies)}`);
    assert.equal(rep.layer1.length, 0);
  } finally { cleanup(root); }
});

test("③-AC8 — DELETING the file a judged entry names flips layer 3 from clean to RED (the incident shape)", () => {
  const root = makeFixture({
    "plugin/test/kept.test.mjs": PURE_S_TEST,
    ".quay/suite-bucket-reattribution.jsonl": [
      `{"file":"plugin/test/kept.test.mjs","judgment":"M","mechanism":"S","signal":[]}`,
      `{"file":"plugin/test/doomed.test.mjs","judgment":"M","mechanism":"S","signal":[]}`,
    ].join("\n") + "\n",
  });
  try {
    // the doomed test exists as a suite file ⇒ both entries are live ⇒ no zombie.
    fs.writeFileSync(path.join(root, "plugin/test/doomed.test.mjs"), PURE_S_TEST, "utf8");
    assert.deepEqual(checkReattrRatchet(root).zombies, [], "precondition: both entries live ⇒ no zombie");
    // the deletion happens, the record is NOT updated — exactly what the 10 production reds were.
    fs.rmSync(path.join(root, "plugin/test/doomed.test.mjs"));
    const rep = checkReattrRatchet(root);
    assert.deepEqual(rep.zombies, ["plugin/test/doomed.test.mjs"],
      `deleting the file without dropping its entry must be layer-3 RED, got ${JSON.stringify(rep.zombies)}`);
  } finally { cleanup(root); }
});

test("③-AC8 — the REAL reattribution file has NO zombie entries (every file is still a suite test)", () => {
  const rep = checkReattrRatchet(REPO_ROOT);
  assert.equal(rep.evaluated, true, "the real reattribution file must be present (else NOT-EVALUATED, not a pass)");
  assert.ok(loadReattribution(REPO_ROOT).size > 0, "the reattribution file must be non-empty");
  assert.deepEqual(rep.zombies, [], `a reattribution entry must point to an existing suite test, got ${JSON.stringify(rep.zombies)}`);
  // the live suite is non-empty too — a "no zombies" read off an empty suite set would be vacuous.
  assert.ok(new Set(listSuiteFiles(REPO_ROOT)).size > 0, "the suite file set must be non-empty for the zombie judgment to mean anything");
});
