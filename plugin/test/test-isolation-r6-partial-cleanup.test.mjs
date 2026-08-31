// @test-group engine
// test-isolation-r6-partial-cleanup.test.mjs — gap-tmp-leak-is-live-r6-absolves-a-file-for-one-
// cleanup-call: RED/GREEN controls for the tightened R6 (mkdtemp-no-cleanup) partial-cleanup rule.
//
// The old rule was FILE-LEVEL EXISTENCE: any cleanup construct anywhere in a file cleared the whole
// file, so a "7 mkdtemp / 2 unrelated cleanup" file was indistinguishable from a fully-cleaned one
// (gate-diagnostics leaked ~136 dirs/hour precisely because its two `finally` blocks only restored
// process.stderr.write, never removed the fixture dirs). The tightened rule requires every
// variable-assigned mkdtemp result to be COVERED by a cleanup path — directly, via a carrier array,
// or via a helper return captured into a cleaned variable.
//
// AC5 positive control: 3 mkdtemp / 1 cleaned must report.
// AC6 negative control: the low-false-positive shapes (carrier array, caller-cleaned helper return)
// must NOT report; a genuinely-uncleaned helper return MUST report.
// AC7 live specimen: gate-diagnostics' "helper returns a dir no caller removes" shape reports.
//
// Run: scripts/test.sh plugin/test/test-isolation-r6-partial-cleanup.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectMkdtempNoCleanup } from "../scripts/test-isolation-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("AC5: 3 mkdtemp / 1 cleaned reports; 3 / 3 cleaned does not (partial-cleanup control)", () => {
  // the "7 builds, 2 cleans" shape in miniature: some dirs cleaned, some not → report
  const partial = '// @test-group engine\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-"));\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-"));\nconst c = fs.mkdtempSync(path.join(os.tmpdir(), "adr-c-"));\nt.after(() => fs.rmSync(a, { recursive: true, force: true }));\n';
  assert.ok(
    detectMkdtempNoCleanup(partial, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"),
    "3 mkdtemp / 1 cleaned must report (partial cleanup)"
  );
  // all three cleaned → GREEN
  const all = '// @test-group engine\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-"));\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-"));\nconst c = fs.mkdtempSync(path.join(os.tmpdir(), "adr-c-"));\nt.after(() => { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); fs.rmSync(c, { recursive: true, force: true }); });\n';
  assert.equal(detectMkdtempNoCleanup(all, "x.test.mjs").length, 0, "3 mkdtemp / 3 cleaned must NOT report");
});

test("AC6: the carrier-array and caller-cleaned helper-return patterns do NOT report (zero false positives)", () => {
  // document-store/adr-store `_createdDirs.push(dir)` + after-loop — cleaned
  const carrier = '// @test-group engine\nconst _createdDirs = [];\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-")); _createdDirs.push(a);\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-")); _createdDirs.push(b);\nafter(() => { for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true }); });\n';
  assert.equal(detectMkdtempNoCleanup(carrier, "x.test.mjs").length, 0, "carrier-array cleanup must NOT report");
  // helper returns mkdtemp, caller captures into a cleaned variable → covered
  const callerCleaned = '// @test-group engine\nfunction makeFakeGhBin() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-fake-")); return dir; }\nconst fakeBinDir = makeFakeGhBin();\nt.after(() => fs.rmSync(fakeBinDir, { recursive: true, force: true }));\n';
  assert.equal(detectMkdtempNoCleanup(callerCleaned, "x.test.mjs").length, 0, "caller-cleaned helper return must NOT report");
});

test("AC7: the gate-diagnostics shape — a helper returning a dir no caller removes — reports", () => {
  // gate-diagnostics' tmpWs()/makeCliWorkspace() return mkdtemp dirs that NO caller cleans; the only
  // "cleanup" constructs in the file are two finally blocks that restore process.stderr.write and an
  // unlinkSync of a log file — none touch the fixture dirs.
  const gateDiagShape = '// @test-group engine\nfunction makeWs(tag) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-leak-")); return dir; }\nconst ws = makeWs("ac1");\n// the two cleanup constructs are unrelated: they restore stderr, not the fixture dirs\nfunction restoreStderr() { try { const x = 1; } finally { process.stderr.write = orig; } }\n';
  assert.ok(
    detectMkdtempNoCleanup(gateDiagShape, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"),
    "helper return never cleaned must report (the gate-diagnostics live specimen)"
  );
});
