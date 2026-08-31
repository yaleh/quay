// @test-group lowconc
// gap-global-count-assertions-fragile-relative-baseline — AC2/AC3: the baseline-snapshot helper
// (plugin/scripts/test-file-snapshot.sh) replaces fragile ABSOLUTE global-count assertions
// (EXPECTED_ENGINE = 58 — stale the moment any test file is added, B3-2 red on fan-in) with a
// RELATIVE baseline criterion. These tests reproduce the B3-2 scenario: a worktree snapshot taken
// 13 min before a concurrent merge must NOT go red when the merge adds a test file, while a REAL
// regression (a baseline test file REMOVED) must still be caught.
//
// All assertions here are RELATIONSHIPS over the live glob, never hardcoded counts (tick rule
// "测试不得硬编码全局计数"). The fixture simulates file sets with opaque paths — the helper treats
// paths as strings, so no real tree mutation is needed.
//
// R3 (test-isolation): this file never spawns `scripts/test.sh` directly (the shrink-only
// test-isolation-violations list may not grow). The helper's DEFAULT snapshot mode reads
// `scripts/test.sh --list-files` internally — the single source of truth for the test glob (the
// helper is the thin wrapper; this test never hand-writes a glob). The default-mode test below
// asserts the recorded set is large, sorted, deduped, absolute (realpath) and self-consistent —
// not a re-derivation of the glob.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const helper = join(repoRoot, "plugin", "scripts", "test-file-snapshot.sh");

function runHelper(args) {
  return spawnSync("bash", [helper, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 180000 });
}

const FORK_SET = ["/w/a.test.mjs", "/w/b.test.mjs", "/w/c.test.mjs"];

test("AC2: snapshot default mode records the canonical set — large, sorted, deduped, absolute realpaths, self-consistent", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-snapshot-"));
  try {
    const baseline = join(dir, "baseline.txt");
    // No explicit files → the helper reads `scripts/test.sh --list-files` (single source of truth).
    const r = runHelper(["snapshot", baseline]);
    assert.equal(r.status, 0, `snapshot exited ${r.status}: ${r.stderr}`);
    const lines = readFileSync(baseline, "utf8").trim().split("\n").filter(Boolean);
    assert.ok(lines.length > 100, `snapshot should cover the whole suite, got ${lines.length}`);
    // The canonical glob is deduped by realpath → absolute paths, no duplicates, sorted.
    assert.equal(new Set(lines).size, lines.length, "snapshot must be deduped");
    assert.deepEqual([...lines].sort(), lines, "snapshot must be sorted");
    for (const f of lines) assert.ok(f.startsWith("/"), `expected an absolute realpath, got: ${f}`);
    // Self-consistency: the recorded set compared against itself is green with 0 additions.
    const c = runHelper(["check", baseline]);
    assert.equal(c.status, 0, `self-check must be green: ${c.stdout}${c.stderr}`);
    assert.match(c.stdout, /0 addition/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2: snapshot with explicit files records exactly those files (fixture mode)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-explicit-"));
  try {
    const baseline = join(dir, "baseline.txt");
    const r = runHelper(["snapshot", baseline, ...FORK_SET]);
    assert.equal(r.status, 0, r.stderr);
    const recorded = readFileSync(baseline, "utf8").trim().split("\n").filter(Boolean).sort();
    assert.deepEqual(recorded, [...FORK_SET].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3: B3-2 scenario — a snapshot taken before a concurrent merge does NOT go red when the merge adds a test file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-b32-"));
  try {
    // The file set at B3-2 worktree creation, 13 min before B3-1's merge.
    const baseline = join(dir, "baseline.txt");
    assert.equal(runHelper(["snapshot", baseline, ...FORK_SET]).status, 0);
    // B3-1's concurrent merge adds a new engine test file to the tree the assertion runs against.
    const mergedSet = [...FORK_SET, "/w/d-b3-1-merged.test.mjs"];
    const r = runHelper(["check", baseline, ...mergedSet]);
    // Relative baseline: the addition is ALLOWED — this is exactly the case that used to go red
    // with `EXPECTED_ENGINE = 58` (58 !== 59 after the merge).
    assert.equal(r.status, 0, `B3-2 scenario must stay green: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /d-b3-1-merged/, "the concurrent addition should be reported, not fail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 negative control: a REAL regression (a baseline test file REMOVED) is still caught red", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-neg-"));
  try {
    const baseline = join(dir, "baseline.txt");
    assert.equal(runHelper(["snapshot", baseline, ...FORK_SET]).status, 0);
    // A real count regression: b.test.mjs disappears from the set.
    const shrunk = FORK_SET.filter((f) => !f.endsWith("b.test.mjs"));
    const r = runHelper(["check", baseline, ...shrunk]);
    assert.notEqual(r.status, 0, "a removal must be red (real regression)");
    assert.match(r.stderr, /b\.test\.mjs/, "the removed file must be named");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1: exact worktree check — current == baseline ∪ --expect-added; an unexpected addition is red", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-exact-"));
  try {
    const baseline = join(dir, "baseline.txt");
    assert.equal(runHelper(["snapshot", baseline, ...FORK_SET]).status, 0);
    // This task adds its own test file; the worktree before rebase has exactly baseline + it.
    const expect = join(dir, "expect.txt");
    writeFileSync(expect, "/w/task-own.test.mjs\n");
    const worktreeSet = [...FORK_SET, "/w/task-own.test.mjs"];
    const ok = runHelper(["check", baseline, "--expect-added", expect, ...worktreeSet]);
    assert.equal(ok.status, 0, `exact match must be green: ${ok.stdout}${ok.stderr}`);
    // An unexpected file (a stray leak into the worktree) → the exact check is red.
    const leakSet = [...worktreeSet, "/w/leak.test.mjs"];
    const bad = runHelper(["check", baseline, "--expect-added", expect, ...leakSet]);
    assert.notEqual(bad.status, 0, "an unexpected addition must be red under --expect-added");
    assert.match(bad.stderr, /leak\.test\.mjs/, "the unexpected file must be named");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC1 (gap-test-file-snapshot-no-production-caller): the WIRED production mode ─────────────────────
// The run_static_checks wiring invokes `test-file-snapshot.sh --repo-relative check
// <committed-baseline>`. --repo-relative normalizes the canonical --list-files output (absolute
// realpaths, machine-/worktree-specific) to repo-root-relative so ONE committed baseline is portable
// across worktrees / the main checkout / CI. These tests pin that normalization on a hermetic fake
// repo whose scripts/test.sh --list-files prints absolute paths under ITS root.

function makeFakeRepo(root, fileNames) {
  // fileNames are repo-relative; the fake test.sh prints them as absolute paths under `root`.
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\nif [ "\${1:-}" = "--list-files" ]; then\n  printf '%s\\n' \\\n${fileNames
      .map((f) => `    "${join(root, f)}"`)
      .join(" \\\n")}\nfi\n`,
  );
}

test("AC1 wired mode: --repo-relative snapshot records repo-relative paths (portable baseline)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-rel-"));
  try {
    const fakeRoot = join(dir, "repo");
    const relFiles = ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs", "plugin/test/c.test.mjs"];
    makeFakeRepo(fakeRoot, relFiles);
    const baseline = join(dir, "baseline.txt");
    const r = runHelper(["--repo-relative", "--root", fakeRoot, "snapshot", baseline]);
    assert.equal(r.status, 0, `snapshot exited ${r.status}: ${r.stderr}`);
    const recorded = readFileSync(baseline, "utf8").trim().split("\n").filter(Boolean).sort();
    assert.deepEqual(recorded, [...relFiles].sort(), "baseline must be repo-relative, not absolute");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 wired mode: --repo-relative check is green on an intact set and RED on a removal", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-relcheck-"));
  try {
    const fakeRoot = join(dir, "repo");
    const full = ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs", "plugin/test/c.test.mjs"];
    makeFakeRepo(fakeRoot, full);
    const baseline = join(dir, "baseline.txt");
    assert.equal(runHelper(["--repo-relative", "--root", fakeRoot, "snapshot", baseline]).status, 0);
    // Self-check against the same tree → green, 0 additions.
    const self = runHelper(["--repo-relative", "--root", fakeRoot, "check", baseline]);
    assert.equal(self.status, 0, `self-check must be green: ${self.stdout}${self.stderr}`);
    // Negative control (AC2): delete b.test.mjs from the tree → the check MUST exit non-zero and
    // name the removed file (this is the exact wired shape: 删测试文件必红).
    makeFakeRepo(fakeRoot, [full[0], full[2]]);
    const neg = runHelper(["--repo-relative", "--root", fakeRoot, "check", baseline]);
    assert.notEqual(neg.status, 0, "a removal must be red under the wired --repo-relative check");
    assert.match(neg.stderr, /b\.test\.mjs/, "the removed file must be named");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
