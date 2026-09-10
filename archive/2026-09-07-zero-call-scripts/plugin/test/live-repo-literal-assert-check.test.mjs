// @test-group engine
// live-repo-literal-assert-check.test.mjs — RED/GREEN tests for the live-repo-literal-assert gate
// (plugin/scripts/live-repo-literal-assert-check.ts, the idempotency criterion
// "cwd=REPO_ROOT + git + 字面断言 ⇒ 违规").
//
// The idempotency class (gap-tests-assert-live-repo-state-break-idempotency): a test that reads
// MUTABLE live-repo state (the shared checkout's git history) and hard-codes the observed value as
// an assertion literal drifts as the repo grows — the same test run twice against a mutating live
// repo gives different results. The gate exists so the class stays at zero.
//
// Covered here:
//   - RED  (负控): a live-repo git stdout read asserted against a bare numeric literal reports —
//         inline `spawnSync(...).stdout`, the `const r = spawnSync(...)` + `r.stdout` shape,
//         `["-C", REPO_ROOT]` args, literal-first ordering.
//   - GREEN: hermetic git-init temp repos, relative before/after comparisons, shape/format
//         assertions, synthetic fixtures, exit-status assertions, comment/string mentions — none
//         report (按位置不按关键词).
//   - CLI over the REAL corpus: 0 violations (the class is at zero — AC3 sweep).
//   - selftest: --selftest exits 0 (RED and GREEN both asserted).
//
// Run:
//   scripts/test.sh plugin/test/live-repo-literal-assert-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  scanFile,
  findLiveRepoGitCalls,
  gitVars,
} from "../scripts/live-repo-literal-assert-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "live-repo-literal-assert-check.ts");

// ── RED (负控): the violation class must be DETECTED ──────────────────────────────────────────────
test("RED (负控): inline git stdout + literal count is detected", () => {
  const src =
    'const r = spawnSync("git", ["log", "--all", "--oneline"], { encoding: "utf8", cwd: REPO_ROOT });\n' +
    'assert.equal(r.stdout.trim().split("\\n").length, 47, "commit count");\n';
  const v = scanFile("inline.test.mjs", src);
  assert.equal(v.length, 1, JSON.stringify(v));
});

test("RED: the `const r = spawnSync(...)` + `r.stdout` shape is detected", () => {
  const src =
    'const out = execFileSync("git", ["log", "--all", "--oneline"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();\n' +
    'assert.equal(out.split("\\n").length, 47);\n';
  const v = scanFile("var.test.mjs", src);
  assert.equal(v.length, 1, JSON.stringify(v));
});

test("RED: git -C REPO_ROOT args + literal is detected", () => {
  const src =
    'const r = spawnSync("git", ["-C", REPO_ROOT, "rev-list", "--count", "HEAD"], { encoding: "utf8" });\n' +
    "assert.strictEqual(Number(r.stdout.trim()), 1234);\n";
  const v = scanFile("dashc.test.mjs", src);
  assert.equal(v.length, 1, JSON.stringify(v));
});

test("RED: literal-first ordering is detected", () => {
  const src =
    'const out = spawnSync("git", ["log", "--all"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;\n' +
    'assert.deepEqual(47, out.trim().split("\\n").length);\n';
  const v = scanFile("reversed.test.mjs", src);
  assert.equal(v.length, 1, JSON.stringify(v));
});

// ── GREEN: the tolerated patterns must NOT report ─────────────────────────────────────────────────
test("GREEN: hermetic git-init temp repo literal is fine", () => {
  const src =
    'const tmp = mkdtempSync(path.join(os.tmpdir(), "x-"));\n' +
    'const out = execFileSync("git", ["log", "--all"], { cwd: tmp, encoding: "utf8" }).stdout;\n' +
    'assert.equal(out.trim().split("\\n").length, 47);\n';
  assert.equal(scanFile("hermetic.test.mjs", src).length, 0);
});

test("GREEN: relative before/after comparison on live repo is fine", () => {
  const src =
    'const before = spawnSync("git", ["-C", REPO_ROOT, "status", "--short"], { encoding: "utf8" }).stdout;\n' +
    'const after = spawnSync("git", ["-C", REPO_ROOT, "status", "--short"], { encoding: "utf8" }).stdout;\n' +
    'assert.equal(after, before, "checker must not write");\n';
  assert.equal(scanFile("relative.test.mjs", src).length, 0);
});

test("GREEN: shape/format assertion (no literal count) is fine", () => {
  const src =
    'const out = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim();\n' +
    "assert.match(out, /^[0-9a-f]{40}$/);\n";
  assert.equal(scanFile("shape.test.mjs", src).length, 0);
});

test("GREEN: synthetic fixture (relative to fixture var, no live git) is fine", () => {
  const src =
    "const injected = 47;\n" +
    "const pending = pendingDeclarationList([mk({ callCountAll: injected })], NOW);\n" +
    "assert.equal(pending[0].callCountAll, injected);\n";
  assert.equal(scanFile("fixture.test.mjs", src).length, 0);
});

test("GREEN: exit-status assertion (no stdout literal) is fine", () => {
  const src =
    'const r = spawnSync("git", ["log", "--all"], { cwd: REPO_ROOT, encoding: "utf8" });\n' +
    "assert.equal(r.status, 0);\n";
  assert.equal(scanFile("exit.test.mjs", src).length, 0);
});

test("GREEN: comment/string mention of the pattern is not a violation (按位置不按关键词)", () => {
  const src =
    "// assert.equal(r.stdout, 47) — a comment spelling the pattern must not report\n" +
    'const s = "cwd: REPO_ROOT git 47";\n' +
    'const out = spawnSync("git", ["log"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;\n' +
    "console.log(out);\n";
  assert.equal(scanFile("comment.test.mjs", src).length, 0);
});

// ── internals ────────────────────────────────────────────────────────────────────────────────────
test("internals: gitVars splits result vars (r.stdout) from stdout vars (out = call.stdout)", () => {
  const src =
    'const r = spawnSync("git", ["log"], { cwd: REPO_ROOT, encoding: "utf8" });\n' +
    'const out = spawnSync("git", ["log"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim();\n';
  const calls = findLiveRepoGitCalls(src);
  const { resultVars, stdoutVars } = gitVars(calls);
  assert.equal(calls.length, 2);
  assert.ok(resultVars.has("r"), "whole-call result var recorded");
  assert.ok(stdoutVars.has("out"), "already-extracted stdout var recorded");
});

// ── CLI over the REAL corpus (AC3 sweep: 活仓库字面断言清零) ───────────────────────────────────────
test("CLI over the real repo: 0 live-repo literal assertions (PASS)", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, REPO_ROOT], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `live-repo-literal-assert-check must exit 0 on the real corpus:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /PASS/, "corpus scan reports PASS");
});

test("CLI --selftest is green (RED and GREEN both asserted)", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--selftest"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `selftest must exit 0:\n${r.stdout}${r.stderr}`);
});
