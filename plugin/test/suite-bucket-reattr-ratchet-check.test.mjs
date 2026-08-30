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
//   ③-AC8  the real reattribution file carries NO zombie entries (every file still a suite test).
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
  } finally { cleanup(root); }
});

// ── ③-AC8 — the real reattribution file carries no zombie entries ────────────────────────────────────

test("③-AC8 — the real reattribution file has NO zombie entries (every file is still a suite test)", () => {
  const reattr = loadReattribution(REPO_ROOT);
  assert.ok(reattr.size > 0, "the reattribution file must be present and non-empty");
  const suite = new Set(listSuiteFiles(REPO_ROOT));
  const zombies = [...reattr.keys()].filter((f) => !suite.has(f));
  assert.deepEqual(zombies, [], `a reattribution entry must point to an existing suite test (zombies would be re-added), got ${JSON.stringify(zombies)}`);
});
