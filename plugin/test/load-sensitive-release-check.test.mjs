// @test-group engine
// load-sensitive-release-check.test.mjs — gap-load-sensitive-requires-predeclared-marker: RED/GREEN
// tests for the red-window-release admission gate (plugin/scripts/load-sensitive-release-check.ts).
//
// The manager ruling (2026-08-08): a red window may be released via an isolation-pass ONLY for files
// that carry the predeclared KNOWN-LOAD-SENSITIVE marker. An unmarked file's isolation-pass is ONLY
// grounds to APPLY for the marker (with evidence) — never grounds to release the red window directly.
//
// Coverage:
//   - all-marked  → exit 0, release permitted (Path A)
//   - unmarked    → exit 1, release NOT permitted, lists the unmarked file (Path B)
//   - mixed set   → exit 1, lists only the unmarked files
//   - grep-equivalence: the marker anywhere in the file counts (matches `grep -l "KNOWN-LOAD-SENSITIVE"`)
//   - stdin mode: file paths read from stdin
//   - unreadable file → exit 2 (env error, never a silent release)
//
// Run:
//   scripts/test.sh plugin/test/load-sensitive-release-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { hasMarker, checkMarked, judgeMarkedReport, MARKER } from "../scripts/load-sensitive-release-check.ts";
import { driverResultToExit } from "../scripts/checker-io.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_TS = path.join(REPO_ROOT, "plugin", "scripts", "load-sensitive-release-check.ts");

// R6 (test-isolation-check) carrier-array cleanup: every mkdtemp dir is pushed here and swept in
// after() — the document-store `_createdDirs` + after-loop shape the R6 detector accepts.
const _createdDirs = [];
function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-check-"));
  _createdDirs.push(dir);
  const f = path.join(dir, "sample.test.mjs");
  fs.writeFileSync(f, contents);
  return f;
}
after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const MARKED_SRC = `// @test-group product
// KNOWN-LOAD-SENSITIVE — this file is genuinely load-sensitive (HTTP server on an ephemeral port).
import { test } from "node:test";
test("x", () => {});
`;

const UNMARKED_SRC = `// @test-group product
import { test } from "node:test";
test("x", () => {});
`;

function runCli(args, stdin) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECK_TS, ...args], {
    input: stdin,
    encoding: "utf8",
  });
}

// ── unit: hasMarker / checkMarked ───────────────────────────────────────────────────────────────────
test("unit: hasMarker is grep-equivalent — marker anywhere in the file counts", () => {
  const marked = tmpFile(MARKED_SRC);
  assert.equal(hasMarker(marked), true);
  // grep-equivalence: a marker NOT in the header (mid-file comment) still counts, exactly like
  // `grep -l "KNOWN-LOAD-SENSITIVE"` — the documented batch-run protocol.
  const midFile = tmpFile(
    `import { test } from "node:test";\ntest("x", () => {});\n// KNOWN-LOAD-SENSITIVE at the bottom\n`
  );
  assert.equal(hasMarker(midFile), true);
});

test("unit: hasMarker returns false for an unmarked file and null for an unreadable file", () => {
  const unmarked = tmpFile(UNMARKED_SRC);
  assert.equal(hasMarker(unmarked), false);
  assert.equal(hasMarker(path.join(os.tmpdir(), "definitely-missing-lsr.test.mjs")), null);
});

test("unit: checkMarked splits marked / unmarked / unreadable", () => {
  const marked = tmpFile(MARKED_SRC);
  const unmarked = tmpFile(UNMARKED_SRC);
  const missing = path.join(os.tmpdir(), "missing-lsr.test.mjs");
  const r = checkMarked([marked, unmarked, missing]);
  assert.deepEqual(r.marked, [marked]);
  assert.deepEqual(r.unmarked, [unmarked]);
  assert.deepEqual(r.unreadable, [missing]);
});

// ── CLI: exit codes ────────────────────────────────────────────────────────────────────────────────
test("CLI: all-marked file set exits 0 (release permitted, Path A)", () => {
  const marked = tmpFile(MARKED_SRC);
  const r = runCli([marked]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(marked));
  assert.ok(r.stdout.includes("MARKED"));
});

test("CLI: an unmarked file exits 1 and names the file (release NOT permitted, Path B)", () => {
  const unmarked = tmpFile(UNMARKED_SRC);
  const r = runCli([unmarked]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("UNMARKED"));
  assert.ok(r.stdout.includes(unmarked));
  assert.ok(r.stdout.includes("apply-for-marker"));
});

test("CLI: a mixed set exits 1 and lists ONLY the unmarked file", () => {
  const marked = tmpFile(MARKED_SRC);
  const unmarked = tmpFile(UNMARKED_SRC);
  const r = runCli([marked, unmarked]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(marked));
  assert.ok(r.stdout.includes(unmarked));
  // only one UNMARKED line for the mixed set
  assert.equal(r.stdout.match(/UNMARKED/g).length, 1);
});

test("CLI: stdin mode reads file paths from stdin (one per line)", () => {
  const unmarked = tmpFile(UNMARKED_SRC);
  const r = runCli([], `${unmarked}\n`);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(unmarked));
});

test("CLI: an unreadable file exits 2 (env error — never a silent release)", () => {
  const missing = path.join(os.tmpdir(), "missing-lsr.test.mjs");
  const r = runCli([missing]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("unreadable"));
});

test("CLI: no files at all exits 2 (usage)", () => {
  const r = runCli([]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

// ── real-use evidence (AC1/AC2/AC4): the concrete instance ─────────────────────────────────────────
test("AC4 real-use: serve.test.mjs is now marked (predeclared marker lands the disposition)", () => {
  const serve = path.join(REPO_ROOT, "packages", "quay", "test", "serve.test.mjs");
  const r = runCli([serve]);
  assert.equal(r.status, 0, `serve.test.mjs must carry the marker; got:\n${r.stdout}${r.stderr}`);
  assert.ok(MARKER.length > 0, "MARKER constant is the grep literal");
});

// ── B4 DriverResult（gap-b4-checker-reuse-driver-result：判定收敛到 DriverResult<T> 词表）────────────

test("B4 AC2/AC3: judgeMarkedReport 三态映射 —— all-marked⇒verified / unmarked⇒failed / unreadable⇒not-evaluated", () => {
  const marked = tmpFile(MARKED_SRC);
  const unmarked = tmpFile(UNMARKED_SRC);
  const missing = path.join(os.tmpdir(), "missing-lsr-b4.test.mjs");

  const ok = judgeMarkedReport(checkMarked([marked]));
  assert.equal(ok.state, "verified");
  assert.equal(driverResultToExit(ok), 0);

  const bad = judgeMarkedReport(checkMarked([marked, unmarked]));
  assert.equal(bad.state, "failed");
  assert.equal(driverResultToExit(bad), 1);

  // 读不到输入（unreadable）⇒ not-evaluated（硬规则 3b），⛔ 不伪造成 release（verified）也不伪造成 fail。
  const ne = judgeMarkedReport(checkMarked([missing]));
  assert.equal(ne.state, "not-evaluated");
  assert.equal(driverResultToExit(ne), 2);
});
