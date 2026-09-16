// @test-group engine
// dead-code-after-return-check.test.mjs — the AC6 anti-recurrence gate of
// gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived.
//
// The defect: scripts/test.sh's default_test_concurrency had `echo "8"; return 0;
// default_concurrency_formula` — a statement AFTER a top-level return (dead code), while docs/ACs/
// tests all reported the derived form. AC6 requires a mechanical check that bans this shape so it
// cannot be reintroduced. This file tests that checker:
//   - the detection is by code position (the exact pin shape is caught; comment mentions are not)
//   - a return as the last statement of a function, or inside an if/case block, is NOT dead code
//   - the real repo scan is clean (0 instances on the current tree — strict-zero band)
//   - the negative control (mutating the function to return a constant) reddens the AC1/AC3
//     assertion in resource-gate.test.mjs and the checker's RED path
//
// Run: scripts/test.sh plugin/test/dead-code-after-return-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn, execFileSync } from "node:child_process";

import { detectFileViolations, scanTree, stripShellComments, judgeScan } from "../scripts/dead-code-after-return-check.ts";
import { driverResultToExit } from "../scripts/checker-io.ts";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const CHECKER = path.join(repoRoot, "plugin/scripts/dead-code-after-return-check.ts");

function runChecker(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root], {
    encoding: "utf8",
  });
}

// ── RED: the exact defect shapes ────────────────────────────────────────────────────────────────────
test("AC6: the 2026-08-03 pin shape (statement after a top-level return) is detected", () => {
  const vs = detectFileViolations(
    "test.sh",
    'default_test_concurrency() {\n  echo "8"\n  return 0\n  default_concurrency_formula\n}\n',
  );
  assert.equal(vs.length, 1);
  assert.equal(vs[0].fn, "default_test_concurrency");
  assert.equal(vs[0].line, 3); // the RETURN line is reported (where the dead code begins)
  assert.equal(vs[0].after, "default_concurrency_formula");
});

test("AC6: the Contract control shape — changing the function to return a constant (echo 3) — is detected", () => {
  const vs = detectFileViolations("x.sh", 'f() {\n  echo "3"\n  return 0\n  default_concurrency_formula\n}\n');
  assert.equal(vs.length, 1);
});

// ── GREEN: legitimate returns are NOT dead code ─────────────────────────────────────────────────────
test("AC6: a top-level return as the LAST statement is not dead code", () => {
  const vs = detectFileViolations("ok.sh", 'f() {\n  echo "a"\n  return 0\n}\n');
  assert.equal(vs.length, 0);
});

test("AC6: a return inside an if block (code after fi runs on the else path) is not dead code", () => {
  const vs = detectFileViolations(
    "ok.sh",
    'f() {\n  if x; then\n    return 0\n  fi\n  echo "after"\n}\n',
  );
  assert.equal(vs.length, 0);
});

test("AC6: a return inside a case branch followed by its terminator is not dead code", () => {
  const vs = detectFileViolations(
    "ok.sh",
    'f() {\n  case "$x" in\n    a)\n      return 0\n      ;;\n  esac\n}\n',
  );
  assert.equal(vs.length, 0);
});

test("AC6: a comment mentioning the pattern is NOT a violation (comment-vs-code)", () => {
  const vs = detectFileViolations("c.sh", "# never write: return 0\ndefault_concurrency_formula\n");
  assert.equal(vs.length, 0);
});

// ── AC1 (gap-suite-not-robust-at-high-derived-concurrency): the walk→read race ──────────────────────
//
// THE DEFECT (this file's own `AC6: the real repo scan is clean` was the CI red): `scanTree` WALKS
// (collectShellScripts) and then READS each listed path. A file that disappears in between made the
// read throw an uncaught ENOENT ⇒ the CLI exits 1 — which is the SAME exit code as "at least one
// instance found", so a race was indistinguishable from a violation (硬规则 3b). The tree really does
// move under the scan: the npm-pack / delivery-smoke path stages a MIRROR of `plugin/` into the
// SOURCE tree and `rm -rf`s it again (`packages/quay/test/delivery-standalone-smoke.sh`
// STAGED_PLUGIN="$ROOT/packages/quay/plugin"), which is not in SKIP_DIRS. Measured while the suite
// ran at concurrency 24: 186 ENOENT reads under `packages/quay/plugin/`, 0 elsewhere.
//
// This test places the deletion INSIDE that window DETERMINISTICALLY (no sleep, no load, no flake):
// `aa.sh` is a FIFO, so the checker's read of it BLOCKS until a writer opens it; the writer's
// non-blocking open only succeeds once the checker is parked there ⇒ the walk is provably over and
// `zz.sh` is provably on its list when we delete it. (collectShellScripts returns SORTED paths, so
// `aa.sh` is always read before `zz.sh`.)
test("AC1 — a .sh that vanishes between the walk and the read is SKIPPED and REPORTED (exit 0), never a crash (exit 1 == 'violation found')", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcar-vanish-"));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });
  const fifo = path.join(dir, "aa.sh");
  const victim = path.join(dir, "zz.sh");
  fs.writeFileSync(victim, 'f() {\n  echo a\n  return 0\n}\n'); // a CLEAN script — the only reason
  try { execFileSync("mkfifo", [fifo]); } catch { return t.skip("mkfifo unavailable on this host"); }

  const proc = spawn("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", dir, "--json"]);
  // If this test fails BEFORE releasing the parked read, the child is still blocked in the FIFO open
  // and would keep the file's process alive forever (a hung suite file, not a red one). The teardown
  // hook is the release valve; killing an already-exited child is a no-op.
  t.after(() => { try { proc.kill("SIGKILL"); } catch { /* already gone */ } });
  let out = "";
  let err = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (err += d));

  // Park point: O_WRONLY|O_NONBLOCK on a FIFO with NO reader fails ENXIO; it can only succeed once
  // the checker is blocked in its own (blocking) open ⇒ the walk has finished.
  const O = fs.constants;
  let wfd = null;
  for (let i = 0; i < 1000 && wfd === null; i++) {
    try { wfd = fs.openSync(fifo, O.O_WRONLY | O.O_NONBLOCK); }
    catch { await new Promise((r) => setTimeout(r, 20)); }
  }
  assert.ok(wfd !== null, "the checker never reached the FIFO read (the walk did not complete) — this test proved nothing");

  fs.rmSync(victim);   // ← the vanish, provably inside the walk→read window
  fs.closeSync(wfd);   // release the parked read (EOF); `zz.sh` is read next and is gone

  const code = await new Promise((r) => proc.on("exit", r));
  const parsed = JSON.parse(out);
  assert.equal(code, 0, `a vanished file must be skipped, not fatal — exit ${code}; stderr=${err}`);
  assert.deepEqual(parsed.active, [], "the vanished file had no violation to report");
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.unreadable.map((u) => u.rel), ["zz.sh"],
    `the skip must be REPORTED (0 violations over a partly-read input must stay distinguishable): ${out}`);
});

// ── CLI + real-repo strict-zero band ────────────────────────────────────────────────────────────────
test("AC6: the real repo scan is clean — strict-zero band on the current tree", () => {
  const { violations, files } = scanTree(repoRoot);
  assert.equal(violations.length, 0, JSON.stringify(violations.map((v) => `${v.rel}:${v.line}`)));
  assert.ok(files.length > 50, `expected a broad shell-script scan, got ${files.length} files`);
  const res = runChecker(repoRoot);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /violations: 0/);
});

test("AC6: a fixture with the injected shape exits 1 (negative control via the real CLI)", () => {
  const dir = makeTmpDir("dcar-neg-");
  fs.writeFileSync(dir + "/evil.sh", 'f() {\n  return 0\n  echo "never"\n}\n');
  const res = runChecker(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /evil\.sh:2/);
});

test("stripShellComments: comments stripped, string literals preserved (quote-aware)", () => {
  assert.equal(
    stripShellComments("# full line\necho hi # trailing\necho 'a#b'\necho \"c#d\"\n"),
    "\necho hi \necho 'a#b'\necho \"c#d\"\n",
  );
});

// ── B4 DriverResult（gap-b4-checker-reuse-driver-result：判定收敛到 DriverResult<T> 词表）────────────

test("B4 AC3: judgeScan maps clean⇒verified / violations⇒failed (DriverResult, exit 0/1)", () => {
  const clean = judgeScan({ violations: [], files: ["a.sh", "b.sh"], unreadable: [] });
  assert.equal(clean.state, "verified");
  assert.equal(driverResultToExit(clean), 0);

  const dirty = judgeScan({
    violations: [{ rel: "evil.sh", line: 2, fn: "f", returnStmt: "return 0", after: "echo never" }],
    files: ["evil.sh"],
    unreadable: [],
  });
  assert.equal(dirty.state, "failed");
  assert.equal(driverResultToExit(dirty), 1);
});

test("AC1 — judgeScan: a vanished file is NOT a violation, but the verdict SAYS it happened (0-violations ≠ fully-read)", () => {
  const partial = judgeScan({ violations: [], files: ["a.sh", "gone.sh"], unreadable: [{ rel: "gone.sh", reason: "ENOENT" }] });
  assert.equal(partial.state, "verified", "a vanished file is not a violation (it is not in the tree)");
  assert.match(partial.verifiedBy ?? "", /1 个文件/,
    "the verdict must name the skip — '0 violations' over a partly-read input must not read as a clean full scan");
});
