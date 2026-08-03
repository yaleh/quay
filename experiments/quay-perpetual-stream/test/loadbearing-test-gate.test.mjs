// @test-group engine
// Unit tests for loadbearing-test-gate.mjs — the mechanical enforcement of ADR-001 Decision clause 2
// (load-bearing method-infra must be fixture-first + covered). Written RED-first (ADR-001 / DIR-019
// discipline): this gate must EXEMPLARILY follow the very policy it enforces. The fix for any failing
// case belongs in the MODULE, never in the fixtures. Run:
//   node --test experiments/quay-perpetual-stream/test/loadbearing-test-gate.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/loadbearing-test-gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  enumerateScripts,
  basenameOf,
  detectImported,
  detectRegistered,
  detectCounterGate,
  splitBulletBlocks,
  hasSiblingTest,
  classifyScript,
  checkTree,
} from "../scripts/loadbearing-test-gate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "fixtures", "loadbearing");
const SCRIPTS = path.join(ROOT, "scripts");
const TESTDIR = path.join(ROOT, "test");
const REGISTRY = path.join(ROOT, "fake-registry.js");
const OUTERLOOP = path.join(ROOT, "fake-outer-loop.md");

const cfg = () => ({
  scriptsDir: SCRIPTS,
  testDir: TESTDIR,
  importSearchRoots: [SCRIPTS],
  registryFile: REGISTRY,
  outerLoopFile: OUTERLOOP,
});

// ── enumerateScripts ──────────────────────────────────────────────────────────────────────────
test("enumerateScripts: lists *.mjs in the scripts dir, absolute paths", () => {
  const files = enumerateScripts(SCRIPTS);
  const names = files.map(basenameOf).sort();
  assert.deepEqual(names, [
    "fixture-counter-gate.mjs",
    "fixture-imported.mjs",
    "fixture-importer.mjs",
    "fixture-registered.mjs",
    "fixture-standalone.mjs",
  ]);
  for (const f of files) assert.ok(path.isAbsolute(f), `expected absolute path: ${f}`);
});
test("enumerateScripts: missing dir → empty array (no throw)", () => {
  assert.deepEqual(enumerateScripts(path.join(ROOT, "nope")), []);
});

// ── basenameOf ────────────────────────────────────────────────────────────────────────────────
test("basenameOf: strips directory", () => {
  assert.equal(basenameOf("/a/b/c.mjs"), "c.mjs");
});

// ── detectImported (criterion a) ────────────────────────────────────────────────────────────────
test("detectImported: fixture-imported IS imported by a sibling; fixture-registered is NOT", () => {
  assert.equal(detectImported("fixture-imported.mjs", [SCRIPTS]), true);
  assert.equal(detectImported("fixture-registered.mjs", [SCRIPTS]), false);
});
test("detectImported: a module does not count as importing itself", () => {
  // fixture-importer.mjs contains the import LINE but is not imported by anyone.
  assert.equal(detectImported("fixture-importer.mjs", [SCRIPTS]), false);
});

// ── detectRegistered (criterion b) ──────────────────────────────────────────────────────────────
test("detectRegistered: fixture-registered named in the registry file", () => {
  assert.equal(detectRegistered("fixture-registered.mjs", REGISTRY), true);
  assert.equal(detectRegistered("fixture-imported.mjs", REGISTRY), false);
});
test("detectRegistered: missing registry file → false (no throw)", () => {
  assert.equal(detectRegistered("fixture-registered.mjs", path.join(ROOT, "nope.js")), false);
});

// ── splitBulletBlocks ───────────────────────────────────────────────────────────────────────────
test("splitBulletBlocks: each `- ` bullet (with its wrapped continuation lines) is one block", () => {
  const md = "intro\n- first\n  wrapped\n- second\ntop-level ends it\n- third\n";
  const blocks = splitBulletBlocks(md);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0], /first/);
  assert.match(blocks[0], /wrapped/);   // continuation stays in the block
  assert.doesNotMatch(blocks[0], /second/);
});

// ── detectCounterGate (criterion c) ─────────────────────────────────────────────────────────────
test("detectCounterGate: counter-gate ref + token in ONE bullet block (wrapped across lines) → true", () => {
  assert.equal(detectCounterGate("fixture-counter-gate.mjs", OUTERLOOP), true);
});
test("detectCounterGate: standalone mentioned only in a plain paragraph (not a bullet) → false", () => {
  assert.equal(detectCounterGate("fixture-standalone.mjs", OUTERLOOP), false);
});
test("detectCounterGate: missing outer-loop file → false (no throw)", () => {
  assert.equal(detectCounterGate("fixture-counter-gate.mjs", path.join(ROOT, "nope.md")), false);
});

// ── hasSiblingTest ──────────────────────────────────────────────────────────────────────────────
test("hasSiblingTest: fixture-imported has one; fixture-registered does not", () => {
  assert.equal(hasSiblingTest("fixture-imported.mjs", TESTDIR), true);
  assert.equal(hasSiblingTest("fixture-registered.mjs", TESTDIR), false);
});

// ── classifyScript (the per-script verdict) ─────────────────────────────────────────────────────
test("classifyScript: load-bearing (a) WITH sibling test → PASS", () => {
  const r = classifyScript(path.join(SCRIPTS, "fixture-imported.mjs"), cfg());
  assert.equal(r.loadBearing, true);
  assert.equal(r.verdict, "PASS");
  assert.ok(r.reasons.includes("imported"));
});
test("classifyScript: load-bearing (b) WITHOUT sibling test → FAIL", () => {
  const r = classifyScript(path.join(SCRIPTS, "fixture-registered.mjs"), cfg());
  assert.equal(r.loadBearing, true);
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.reasons.includes("registered"));
});
test("classifyScript: load-bearing (c) WITHOUT sibling test → FAIL", () => {
  const r = classifyScript(path.join(SCRIPTS, "fixture-counter-gate.mjs"), cfg());
  assert.equal(r.loadBearing, true);
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.reasons.includes("counter-gate"));
});
test("classifyScript: NOT load-bearing → N/A (explicit, never silent)", () => {
  const r = classifyScript(path.join(SCRIPTS, "fixture-standalone.mjs"), cfg());
  assert.equal(r.loadBearing, false);
  assert.equal(r.verdict, "N/A");
});
test("classifyScript: the importer is N/A (has the import line but nobody imports it)", () => {
  const r = classifyScript(path.join(SCRIPTS, "fixture-importer.mjs"), cfg());
  assert.equal(r.loadBearing, false);
  assert.equal(r.verdict, "N/A");
});

// ── checkTree (single entry point) ──────────────────────────────────────────────────────────────
test("checkTree: overall verdict FAIL (>=1 load-bearing lacks a test); counts are exhaustive", () => {
  const rep = checkTree(cfg());
  assert.equal(rep.verdict, "FAIL");
  // every enumerated script gets exactly one disposition
  assert.equal(rep.results.length, 5);
  assert.equal(rep.pass, 1);      // fixture-imported
  assert.equal(rep.fail, 2);      // fixture-registered + fixture-counter-gate
  assert.equal(rep.na, 2);        // fixture-standalone + fixture-importer
  assert.equal(rep.pass + rep.fail + rep.na, rep.results.length);
});
test("checkTree: the two FAILs are exactly the untested load-bearing fixtures", () => {
  const rep = checkTree(cfg());
  const failed = rep.results.filter((r) => r.verdict === "FAIL").map((r) => basenameOf(r.file)).sort();
  assert.deepEqual(failed, ["fixture-counter-gate.mjs", "fixture-registered.mjs"]);
});

// ── CLI (main) end-to-end ─────────────────────────────────────────────────────────────────────
const CLI = path.join(__dirname, "..", "scripts", "loadbearing-test-gate.ts");
const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("CLI: fixture tree → exit 1 (a load-bearing script lacks a test), prints FAIL", () => {
  const r = runCli([
    "--scripts", SCRIPTS,
    "--tests", TESTDIR,
    "--import-root", SCRIPTS,
    "--registry", REGISTRY,
    "--outer-loop", OUTERLOOP,
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL:/m);
  assert.match(r.stdout, /fixture-registered\.mjs/);
});
test("CLI: passing subtree (point tests dir at a tree that covers the load-bearing script) → exit 0", () => {
  // Build an all-PASS scratch tree: only fixture-imported.mjs (load-bearing + tested).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loadbearing-test-gate-"));
  try {
    fs.mkdirSync(path.join(tmp, "scripts"));
    fs.mkdirSync(path.join(tmp, "test"));
    fs.copyFileSync(path.join(SCRIPTS, "fixture-imported.mjs"), path.join(tmp, "scripts", "fixture-imported.mjs"));
    fs.copyFileSync(path.join(SCRIPTS, "fixture-importer.mjs"), path.join(tmp, "scripts", "fixture-importer.mjs"));
    fs.copyFileSync(path.join(TESTDIR, "fixture-imported.test.mjs"), path.join(tmp, "test", "fixture-imported.test.mjs"));
    const r = runCli([
      "--scripts", path.join(tmp, "scripts"),
      "--tests", path.join(tmp, "test"),
      "--import-root", path.join(tmp, "scripts"),
      "--registry", path.join(ROOT, "nope.js"),
      "--outer-loop", path.join(ROOT, "nope.md"),
    ]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^PASS:/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
test("CLI: no --scripts arg → usage error exit 2", () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
});

// ── EMPTY-SET fail-closed (gap-checks-that-verify-an-empty-set-must-fail-closed) ────────────────
test("CLI: EMPTY scripts dir → exit 1 (empty-set fail-closed); --allow-empty → exit 0", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loadbearing-empty-"));
  try {
    fs.mkdirSync(path.join(tmp, "scripts"));
    fs.mkdirSync(path.join(tmp, "test"));
    const hard = runCli(["--scripts", path.join(tmp, "scripts"), "--tests", path.join(tmp, "test")]);
    assert.equal(hard.status, 1, "an empty scripts dir must fail-closed ('0 scripts to gate' is indistinguishable from 'never looked')");
    assert.match(hard.stdout, /0 scripts|empty|fail-closed/i);
    const waived = runCli(["--scripts", path.join(tmp, "scripts"), "--tests", path.join(tmp, "test"), "--allow-empty"]);
    assert.equal(waived.status, 0, "--allow-empty waives the empty-set guard (default deny)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
