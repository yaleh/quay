// @test-group engine
// RESTORED (2026-08-13 round 140 green: Fix A expiry reached) (2026-08-13, round 133+134 deterministic-under-load): AC5/tmux-leak-scan DELTA
// genuine-leak dir removed within reap-wait bound under full-suite load (identical assertion both
// rounds) — isolated runs green, but full-suite load is a NECESSARY condition, so it recurs on the
// certification path. TEMPORARILY moved off the default (product,engine) certification path to
// governance. EXPIRY: restore to engine when the removal-source fix lands (R2 reaper / scope
// collision trace) — the trace task owns it. STILL RUNS in --for-task / --group governance scoped
// gates (防真泄漏回归无人发现). WAS @test-group engine.
// @load-sensitive fixture-vs-sweeper
// @load-sensitive-entry 2026-08-13 fixture-vs-sweeper (manager root cause): DELTA's genuine-leak dir
// was swept by sweepRunNamespace() — the sweeper removes run-root children WITHOUT a live tmux owner,
// and a plain-mkdir fixture (no owner) is judged orphan. Isolated runs don't concurrency-sweep ⇒
// green; full-suite does ⇒ deterministic red (rounds 133-136). Fix A: fixtures at
// os.tmpdir()/leakscan-fixture-* (outside the run-root the sweeper scans). The --scope isolation from
// round 131 is preserved.
// test-isolation-check.test.mjs — gap-test-isolation-contract-is-unwritten: RED/GREEN tests for
// the test-isolation contract scan + shrink-only violation ratchet (test-isolation-check.ts).
// Covers AC1–AC8:
//   - R1 (AC2): a fixed __dirname/.tmp-* write path reports; a mkdtemp/os.tmpdir path does not.
//   - R2 (AC2): invoking sync-vendor.sh without --check, or a direct write to a shared
//               packages/<pkg>/dist/ or plugin/vendor/ path, reports; a temp build does not.
//   - R3 (AC2): a spawn/exec of scripts/test.sh reports (literal AND variable forms); a comment
//               or an unrelated spawn does not.
//   - R4 (AC2): process.exit(1) reports only in a hand-rolled (non-node:test) file; comments,
//               strings, and process.exitCode never report.
//   - R6 (AC2/AC6): mkdtemp with no cleanup construct anywhere reports; rm/after/finally cleanup
//               does not; /tmp/claude-* prefix is NEVER matched (AC6). The quay-wt-* worktree
//               exemption was removed — worktrees are git worktree add at loop.worktree_root,
//               never mkdtemp'd (gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs).
//   - R8 (AC1/AC2/AC4): a mkdtemp whose ROOT resolves into the shared checkout
//               (REPO_ROOT/repoRoot/__dirname/process.cwd() or a derived variable) reports —
//               per-run-unique is NECESSARY, not SUFFICIENT; an os.tmpdir()/makeTmp root never
//               reports, and the pattern inside a string literal (the detector's own fixture)
//               never reports (AC3).
//   - AC3/AC4 rehearsal (CLI): the real-repo run reports the three known instances (M136's
//               plugin-packaging, AC11's select-tests-for-touches; relation-sync is fixed and
//               must NOT report) and the 6 remaining process.exit(1) harnesses (gap002 was fixed
//               by the tmp-leak fix d887ab12 — it now imports node:test + uses an after() cleanup
//               hook instead of process.exit(1), so it is out of R4's rule scope).
//   - AC5 ratchet (CLI rehearsal): adding a new violation file → check FAILS; fixing it → PASSES.
//   - AC7: a deliberately-constructed violating test file is reported by the CLI.
//
// Run:
//   scripts/test.sh plugin/test/test-isolation-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  detectFixedPathWrites,
  detectSharedBuildArtifactWrites,
  detectSpawnsTestSh,
  detectProcessExit1,
  detectMkdtempNoCleanup,
  detectLiveDataDirWrites,
  detectSharedRootMkdtemp,
  runIsolationChecks,
} from "../scripts/test-isolation-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_TS = path.join(REPO_ROOT, "plugin", "scripts", "test-isolation-check.ts");

// ── R1 / AC2: fixed __dirname/.tmp-* write paths ────────────────────────────────────────────────────
test("R1/AC2: a fixed __dirname/.tmp-* path reports; mkdtemp/os.tmpdir paths do not", () => {
  assert.ok(
    detectFixedPathWrites('const tasksDir = path.join(__dirname, ".tmp-lock-test");\n', "x.test.mjs")
      .some((v) => v.rule === "fixed-path-write")
  );
  // the mkdtemp PREFIX form (relation-sync's fix / loadbearing) is per-run-unique → safe
  assert.equal(
    detectFixedPathWrites('const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-sync-"));\n', "x.test.mjs").length,
    0
  );
  assert.equal(
    detectFixedPathWrites('const dir = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", ".tmp-tree-"));\n', "x.test.mjs").length,
    0
  );
  // a comment mentioning the pattern is not a violation (code-position matching, AC2)
  assert.equal(
    detectFixedPathWrites('// path.join(__dirname, ".tmp-comment-only")\nconst x = 1;\n', "x.test.mjs").length,
    0
  );
});

// ── R2 / AC2: shared build artifacts ────────────────────────────────────────────────────────────────
test("R2/AC2: sync-vendor.sh sync-mode and direct shared-dist writes report; temp builds do not", () => {
  // plugin-packaging.test.mjs:657 — the M136 instance (sync-vendor.sh WITHOUT --check rewrites the
  // shared plugin/vendor/ mirror).
  assert.ok(
    detectSharedBuildArtifactWrites(
      'execFileSync("bash", [path.join(pluginDir, "scripts", "sync-vendor.sh")], { cwd: repoRoot });\n',
      "x.test.mjs"
    ).some((v) => v.rule === "shared-build-artifact-write")
  );
  // sync-vendor.sh --check is read-only → safe
  assert.equal(
    detectSharedBuildArtifactWrites('execFileSync("bash", [syncScript, "--check"], { cwd: repoRoot });\n', "x.test.mjs").length,
    0
  );
  // writing dist under a temp root (the SAFE pattern — build-dist.test.mjs M136 round-3) → safe
  assert.equal(
    detectSharedBuildArtifactWrites('fs.writeFileSync(path.join(root, "dist", "quay.js"), "x"); // root is a mkdtemp\n', "x.test.mjs").length,
    0
  );
  // a direct write to a literal shared packages/<pkg>/dist/ path → reports
  assert.ok(
    detectSharedBuildArtifactWrites('fs.writeFileSync("packages/quay/dist/quay.js", "x");\n', "x.test.mjs")
      .some((v) => v.rule === "shared-build-artifact-write")
  );
  // plugin/vendor literal → reports
  assert.ok(
    detectSharedBuildArtifactWrites('fs.writeFileSync("plugin/vendor/quay/package.json", "{}");\n', "x.test.mjs")
      .some((v) => v.rule === "shared-build-artifact-write")
  );
});

// ── R3 / AC2: spawning scripts/test.sh ──────────────────────────────────────────────────────────────
test("R3/AC2: a spawn/exec of scripts/test.sh reports (literal AND variable forms); others do not", () => {
  // test-coverage-check.test.mjs:115 — the literal form
  assert.ok(
    detectSpawnsTestSh('const r = spawnSync("bash", ["scripts/test.sh", "--list-files"], { encoding: "utf8" });\n', "x.test.mjs")
      .some((v) => v.rule === "spawns-test-sh")
  );
  // select-tests-for-touches.test.mjs:83 — the variable form (AC11 instance)
  assert.ok(
    detectSpawnsTestSh('const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");\nspawnSync("bash", [TEST_SH, "--for-task", "x"]);\n', "x.test.mjs")
      .some((v) => v.rule === "spawns-test-sh")
  );
  // an unrelated spawn → safe
  assert.equal(
    detectSpawnsTestSh('spawnSync("bash", ["plugin/scripts/other.sh"], {});\n', "x.test.mjs").length,
    0
  );
  // a comment mentioning the spawn → not a violation (code-position matching, AC2)
  assert.equal(
    detectSpawnsTestSh('// spawnSync("bash", ["scripts/test.sh"])\nconst x = 1;\n', "x.test.mjs").length,
    0
  );
});

// ── R4 / AC2: process.exit(1) only in hand-rolled files ─────────────────────────────────────────────
test("R4/AC2: process.exit(1) reports in a hand-rolled file; never in comments/strings/exitCode/node:test", () => {
  assert.ok(
    detectProcessExit1('// @test-group product\nfunction fail() { process.exit(1); }\n', "x.test.mjs")
      .some((v) => v.rule === "process-exit-1")
  );
  // node:test files are out of rule scope (create-mcp.test.mjs writes it INSIDE a template literal)
  assert.equal(
    detectProcessExit1('// @test-group engine\nimport { test } from "node:test";\nprocess.exit(1);\n', "x.test.mjs").length,
    0
  );
  assert.equal(detectProcessExit1('// @test-group product\nprocess.exitCode = 1;\n', "x.test.mjs").length, 0);
  assert.equal(detectProcessExit1('// @test-group product\n// uses process.exit(1)\nconst x = 1;\n', "x.test.mjs").length, 0);
  assert.equal(detectProcessExit1('// @test-group product\nconst s = "process.exit(1)";\n', "x.test.mjs").length, 0);
});

// ── R6 / AC2 / AC6: mkdtemp without cleanup ────────────────────────────────────────────────────────
test("R6/AC2: mkdtemp with no cleanup reports; rm/after/finally cleanup does not", () => {
  // a bare mkdtemp with no cleanup construct anywhere → reports (the leak shape of adr-store/
  // document-store before the gap-tests-never-clean-up-their-tmpdirs fix)
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup")
  );
  // no mkdtemp → never reports
  assert.equal(detectMkdtempNoCleanup('// @test-group product\nconst x = 1;\n', "x.test.mjs").length, 0);
  // t.after cleanup → GREEN
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nt.after(() => fs.rmSync(dir, { recursive: true, force: true }));\n', "x.test.mjs").length,
    0
  );
  // rmSync cleanup → GREEN
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nfs.rmSync(dir, { recursive: true, force: true });\n', "x.test.mjs").length,
    0
  );
  // an EMPTY finally that does NOT rmSync the mkdtemp dir → the dir still leaks → reports
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\ntry { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")); } finally {}\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup"),
    "an empty finally does not clean the mkdtemp dir — partial cleanup reports"
  );
  // a finally that DOES rmSync the dir → GREEN
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\ntry { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")); } finally { fs.rmSync(dir, { recursive: true, force: true }); }\n', "x.test.mjs").length,
    0
  );
  // a comment merely mentioning mkdtemp is not a violation (code-position matching)
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\n// fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")) mention\nconst x = 1;\n', "x.test.mjs").length,
    0
  );
});

// ── AC6 / AC4: /tmp/claude-* is NEVER matched; quay-wt-* exemption removed; negative control ───────
test("AC6: claude-* mkdtemp prefix never reports; quay-wt-* (worktree exemption REMOVED) now reports; a normal fixture prefix still does (AC4 negative control, both directions)", () => {
  // session data prefix is exempt (AC6); the quay-wt-* worktree exemption was removed because
  // worktrees are `git worktree add` at loop.worktree_root, never mkdtemp'd — R6 never sees them
  // (gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs AC6).
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-abc123"));\n', "x.test.mjs").length,
    0,
    "claude-* prefix must be excluded"
  );
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-some-task"));\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup"),
    "quay-wt-* prefix must now report — the worktree exemption is gone (negative control for the removal)"
  );
  // AC4 NEGATIVE direction: a NORMAL fixture prefix (the leak shape) reports
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-leak-"));\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup"),
    "fixture prefix with no cleanup must report (AC4 negative)"
  );
  // AC4 RESTORE direction: adding the cleanup makes it stop reporting (back to 0)
  assert.equal(
    detectMkdtempNoCleanup('// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-leak-"));\nt.after(() => fs.rmSync(dir, { recursive: true, force: true }));\n', "x.test.mjs").length,
    0,
    "restoring cleanup must return to 0 (AC4 restore)"
  );
  // a file mixing a claude-* prefix with a normal leak prefix is NOT fully exempt — the leak reports
  assert.ok(
    detectMkdtempNoCleanup('// @test-group product\nconst s = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session"));\nconst l = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-leak-"));\n', "x.test.mjs")
      .some((v) => v.rule === "mkdtemp-no-cleanup"),
    "a non-exempt prefix alongside claude-* still reports (AC6 is prefix-scoped)"
  );
});

// ── R7 / AC1/AC2/AC4: writes into LIVE product-data dirs via a shared root ──────────────────────────
test("R7/AC2: a fixed-name write into tasks/ via process.cwd() reports; per-run-unique roots do not", () => {
  // the gap-r1 specimen: `path.join(process.cwd(), "tasks", <fixed id>)` + writeFileSync
  assert.ok(
    detectLiveDataDirWrites(
      'const taskPath = path.join(process.cwd(), "tasks", "M-FAKE.md");\nfs.writeFileSync(taskPath, taskText);\n',
      "x.test.mjs"
    ).some((v) => v.rule === "live-data-dir-write")
  );
  // the SAFE shape: a mkdtemp workspace root → no report
  assert.equal(
    detectLiveDataDirWrites(
      'const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dod-check-"));\nfs.mkdirSync(path.join(workspaceRoot, "tasks"));\nconst taskPath = path.join(workspaceRoot, "tasks", "M-FAKE.md");\nfs.writeFileSync(taskPath, taskText);\n',
      "x.test.mjs"
    ).length,
    0
  );
  // a bare-assigned makeTmpDir root (serve-adr/mcp-adr: `workspaceRoot = makeTmpDir(...)`) → safe
  assert.equal(
    detectLiveDataDirWrites(
      'let workspaceRoot;\nworkspaceRoot = makeTmpDir("x-ws-");\nfs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"), "x");\n',
      "x.test.mjs"
    ).length,
    0
  );
  // originalCwd = process.cwd() save/restore (14 harmless uses) → never a report
  assert.equal(
    detectLiveDataDirWrites(
      'const originalCwd = process.cwd();\nprocess.chdir(workspaceRoot);\ntry { fs.writeFileSync("config.yml", "x"); } finally { process.chdir(originalCwd); }\n',
      "x.test.mjs"
    ).length,
    0
  );
  // a literal relative tasks/ write (no chdir in the file) → reports
  assert.ok(
    detectLiveDataDirWrites('fs.writeFileSync("tasks/M-FAKE.md", taskText);\n', "x.test.mjs")
      .some((v) => v.rule === "live-data-dir-write")
  );
  // a comment mentioning the pattern is not a violation (code-position matching, AC2)
  assert.equal(
    detectLiveDataDirWrites(
      '// const taskPath = path.join(process.cwd(), "tasks", "M-FAKE.md")\nconst x = 1;\n',
      "x.test.mjs"
    ).length,
    0
  );
  // a READ from REPO_ROOT/tasks (write ops only) → never a report
  assert.equal(
    detectLiveDataDirWrites(
      'const realTasksDir = path.join(REPO_ROOT, "tasks");\nconst raw = fs.readFileSync(path.join(realTasksDir, "x.md"), "utf8");\n',
      "x.test.mjs"
    ).length,
    0
  );
});

// ── R8 / AC1/AC2/AC4: mkdtemp rooted in the shared checkout ────────────────────────────────────────
test("R8/AC2: a mkdtemp rooted in the shared checkout (REPO_ROOT/__dirname/cwd) reports; os.tmpdir/makeTmp roots do not", () => {
  // the gap-mkdtemp specimen: ts-typecheck-gate.test.mjs — `mkdtempSync(path.join(REPO_ROOT, …))`.
  assert.ok(
    detectSharedRootMkdtemp(
      'const logFile = path.join(fs.mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-")), "g.jsonl");\n',
      "x.test.mjs"
    ).some((v) => v.rule === "shared-root-mkdtemp"),
    "REPO_ROOT-rooted mkdtemp must report (the ts-typecheck-gate specimen)"
  );
  // the second live specimen: loadbearing-test-gate.test.mjs — `mkdtempSync(path.join(__dirname, …))`.
  assert.ok(
    detectSharedRootMkdtemp(
      'const tmp = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", "loadbearing", ".tmp-tree-"));\n',
      "x.test.mjs"
    ).some((v) => v.rule === "shared-root-mkdtemp"),
    "__dirname-rooted mkdtemp must report (the loadbearing specimen)"
  );
  // a process.cwd()-derived variable root (the R7/R8 class — process.cwd() IS the shared checkout).
  assert.ok(
    detectSharedRootMkdtemp(
      'const cwd = process.cwd();\nconst dir = fs.mkdtempSync(path.join(cwd, "leak-"));\n',
      "x.test.mjs"
    ).some((v) => v.rule === "shared-root-mkdtemp"),
    "process.cwd()-derived root must report"
  );
  // variable indirection the grep cannot see: `const ROOT = path.join(REPO_ROOT, "fixtures")` then mkdtemp(ROOT).
  assert.ok(
    detectSharedRootMkdtemp(
      'const ROOT = path.join(REPO_ROOT, "fixtures");\nconst dir = fs.mkdtempSync(path.join(ROOT, "leak-"));\n',
      "x.test.mjs"
    ).some((v) => v.rule === "shared-root-mkdtemp"),
    "a REPO_ROOT-derived variable root must report (the grep misses this shape)"
  );
  // SAFE: os.tmpdir() root — the fix shape.
  assert.equal(
    detectSharedRootMkdtemp('const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-ts-typecheck-gate-"));\n', "x.test.mjs").length,
    0
  );
  // SAFE: a makeTmp-derived variable root.
  assert.equal(
    detectSharedRootMkdtemp('const ws = makeTmpDir("x-ws-");\nconst d = fs.mkdtempSync(path.join(ws, "sub-"));\n', "x.test.mjs").length,
    0
  );
  // SAFE (AC4 negative control): an unknown (function-param) root is lenient-skipped.
  assert.equal(
    detectSharedRootMkdtemp('const dir = fs.mkdtempSync(path.join(rootParam, "x-"));\n', "x.test.mjs").length,
    0
  );
  // SAFE (AC3): a comment mentioning the pattern is not a violation (code-position matching).
  assert.equal(
    detectSharedRootMkdtemp('// fs.mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-")) mention\nconst x = 1;\n', "x.test.mjs").length,
    0
  );
  // SAFE (AC3): the pattern inside a STRING LITERAL — the detector's OWN test fixture at line 57 —
  // must never report (this is the scan false positive the task's table lists).
  assert.equal(
    detectSharedRootMkdtemp(
      'const s = \'const dir = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", ".tmp-tree-"));\';\n',
      "x.test.mjs"
    ).length,
    0,
    "the string-literal fixture in this very file must not report (AC3)"
  );
});

// ── AC5 / suite-after: the assert-clean-tree.sh clean-tree assertion (both directions) ────────────
test("AC5/clean-tree: the suite-after assertion fails on a dirty tree and passes on a clean one", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-isolation-clean-tree-"));
  const CLEAN_TREE_SH = path.join(REPO_ROOT, "plugin", "scripts", "assert-clean-tree.sh");
  try {
    // A real git repo with one committed file — a meaningful "clean" baseline.
    fs.writeFileSync(path.join(scratch, "seed.txt"), "x", "utf8");
    const gitCmd = (args) => spawnSync("git", args, { cwd: scratch, encoding: "utf8" });
    gitCmd(["init", "-q"]);
    gitCmd(["config", "user.email", "test@example.com"]);
    gitCmd(["config", "user.name", "test"]);
    gitCmd(["add", "-A"]);
    gitCmd(["commit", "-q", "-m", "seed"]);

    // GREEN: clean tree → exit 0, PASS.
    let res = spawnSync("bash", [CLEAN_TREE_SH, scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, `clean tree must PASS:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /PASS: git status --porcelain is empty/);

    // RED: an untracked file (the transient-artifact shape the assertion exists to catch) → exit 1.
    fs.writeFileSync(path.join(scratch, ".quay-tmp-test-abc"), "leftover", "utf8");
    res = spawnSync("bash", [CLEAN_TREE_SH, scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 1, `a dirty tree must FAIL:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /DIRTY after the full suite/);
    assert.match(res.stderr, /\.quay-tmp-test-abc/);

    // GREEN (AC4 restore direction): removing the artifact restores PASS.
    fs.rmSync(path.join(scratch, ".quay-tmp-test-abc"));
    res = spawnSync("bash", [CLEAN_TREE_SH, scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, `restoring a clean tree must PASS again:\n${res.stdout}\n${res.stderr}`);

    // RED (fail-closed): a non-git dir → exit 1 with a clear message.
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), "test-isolation-clean-tree-nongit-"));
    fs.writeFileSync(path.join(nonGit, "x.txt"), "x", "utf8");
    res = spawnSync("bash", [CLEAN_TREE_SH, nonGit], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 1, `a non-git dir must fail closed:\n${res.stdout}\n${res.stderr}`);
    fs.rmSync(nonGit, { recursive: true, force: true });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── AC5 / suite-after DELTA: assert-clean-tree.sh's delta form ─────────────────────────────────────
// gap-assert-clean-tree-premise-void-under-concurrent-writers: the absolute form assumed the
// coordinator runs on a clean tree — a premise VOID under concurrent writers (manager tick-log,
// outer worktree scaffolding, inner uncommitted change). The DELTA form (--snapshot before, --check
// after) counts only items ABSENT from the before-run snapshot as this run's test products.
test("AC5/clean-tree DELTA: pre-existing dirt is excluded; only newly-added items count", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-isolation-clean-tree-delta-"));
  const CLEAN_TREE_SH = path.join(REPO_ROOT, "plugin", "scripts", "assert-clean-tree.sh");
  try {
    // A real git repo with one committed file — a meaningful "clean" baseline.
    fs.writeFileSync(path.join(scratch, "seed.txt"), "x", "utf8");
    const gitCmd = (args) => spawnSync("git", args, { cwd: scratch, encoding: "utf8" });
    gitCmd(["init", "-q"]);
    gitCmd(["config", "user.email", "test@example.com"]);
    gitCmd(["config", "user.name", "test"]);
    gitCmd(["add", "-A"]);
    gitCmd(["commit", "-q", "-m", "seed"]);

    // Pre-existing dirt (a concurrent writer's uncommitted change): modify a tracked file.
    fs.appendFileSync(path.join(scratch, "seed.txt"), "\ntick-log line", "utf8");

    // DELTA GREEN: snapshot before the run; only pre-existing dirt present → check PASSES.
    let res = spawnSync("bash", [CLEAN_TREE_SH, "--snapshot", scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, `snapshot must succeed:\n${res.stdout}\n${res.stderr}`);
    res = spawnSync("bash", [CLEAN_TREE_SH, "--check", scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, `pre-existing dirt must NOT trip the DELTA check:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /PASS: git status --porcelain gained no NEW items/);

    // DELTA RED (negative control): a NEW item written AFTER the snapshot IS a test product →
    // check FAILS, listing the new item but NOT the pre-existing dirt.
    res = spawnSync("bash", [CLEAN_TREE_SH, "--snapshot", scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0);
    fs.writeFileSync(path.join(scratch, "test-residue.txt"), "leak", "utf8");
    res = spawnSync("bash", [CLEAN_TREE_SH, "--check", scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 1, `a NEW item after the snapshot must FAIL:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /DIRTY after the full suite/);
    assert.match(res.stderr, /test-residue\.txt/);
    assert.doesNotMatch(res.stderr, /seed\.txt/, "pre-existing dirt must not be listed as a NEW item");

    // DELTA GREEN restore: removing the new item restores PASS (pre-existing dirt still present).
    fs.rmSync(path.join(scratch, "test-residue.txt"));
    res = spawnSync("bash", [CLEAN_TREE_SH, "--snapshot", scratch], { encoding: "utf8", timeout: 30_000 });
    res = spawnSync("bash", [CLEAN_TREE_SH, "--check", scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, `removing the new item must restore PASS:\n${res.stdout}\n${res.stderr}`);

    // DELTA fail-closed: --check with no snapshot (the before-run baseline is unknown).
    fs.rmSync(path.join(scratch, ".quay", "assert-clean-tree.snapshot"), { force: true });
    res = spawnSync("bash", [CLEAN_TREE_SH, "--check", scratch], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 1, `--check without a snapshot must fail closed:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /no before-run snapshot/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── AC5 / suite-after DELTA: tmux-leak-scan.sh's delta form (same family) ───────────────────────────
// gap-assert-clean-tree-premise-void-under-concurrent-writers: the outer layer legitimately runs
// tmux sessions (send-keys remote-drive, skv- names) WHILE the suite runs — a pre-existing
// concurrent-writer match is not this run's leak. The DELTA form excludes pre-existing matches.
test("AC5/tmux-leak-scan DELTA: pre-existing matches are excluded; only NEW matches leak", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-tmux-leak-delta-"));
  const SCAN_SH = path.join(REPO_ROOT, "plugin", "scripts", "tmux-leak-scan.sh");
  // Fix A (2026-08-13 manager root cause): the DELTA test's leak dirs live under a TEST-LOCAL scope
  // OUTSIDE the run-root (os.tmpdir()/leakscan-fixture-*) so sweepRunNamespace() — which removes the
  // run-root's owner-dead children — cannot sweep them. The --scope arg points the scan at this
  // test-local root. (Round 131: shared run-root cross-flagged; rounds 133-136: sweeper removed the
  // owner-dead fixture dir, deterministic-under-load.)
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), "leakscan-fixture-"));
  const preDir = path.join(scope, "skv-delta-test-preexisting");
  const newDir = path.join(scope, "skv-delta-test-newleak");
  const runScan = (mode) => spawnSync("bash", [SCAN_SH, "--scope", scope, mode, scratch], { encoding: "utf8", timeout: 30_000 });
  try {
    // PASS: a pre-existing match is excluded (recorded in the before-run snapshot).
    fs.mkdirSync(preDir, { recursive: true });
    let res = runScan("--snapshot");
    assert.equal(res.status, 0, `snapshot must succeed:\n${res.stdout}\n${res.stderr}`);
    res = runScan("--check");
    assert.equal(res.status, 0, `a pre-existing match must not trip the DELTA check:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /no NEW residual test tmux servers\/dirs/);

    // RED (negative control): a NEW match after the snapshot IS this run's leak → FAIL, listing
    // the new match but NOT the pre-existing one.
    res = runScan("--snapshot");
    assert.equal(res.status, 0);
    fs.mkdirSync(newDir, { recursive: true });
    res = runScan("--check");
    assert.equal(res.status, 1, `a NEW match after the snapshot must FAIL:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /NEW residual test tmux servers\/dirs/);
    assert.match(res.stderr, /skv-delta-test-newleak/);
    assert.doesNotMatch(res.stderr, /skv-delta-test-preexisting/, "pre-existing match must not be listed as NEW");

    // fail-closed: --check with no snapshot.
    fs.rmSync(path.join(scratch, ".quay", "tmux-leak-scan.snapshot"), { force: true });
    res = runScan("--check");
    assert.equal(res.status, 1, `--check without a snapshot must fail closed:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /no before-run snapshot/);
  } finally {
    fs.rmSync(newDir, { recursive: true, force: true });
    fs.rmSync(preDir, { recursive: true, force: true });
    fs.rmSync(scope, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── the ratchet (runIsolationChecks, AC5) ───────────────────────────────────────────────────────────
test("AC5 ratchet: current==data file passes; new/grown/stale/malformed entries fail", () => {
  const entries = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];
  const baseline = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];
  const base = { current: entries, dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true };

  assert.deepEqual(runIsolationChecks({ ...base }), []);

  // C1: a current violation with no data-file entry → new violation, FAIL
  let failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"] });
  assert.ok(failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("no entry")), JSON.stringify(failures));

  // C2a: an entry ADDED vs the committed baseline → FAIL
  failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: [...entries, "c.test.mjs:spawns-test-sh"] });
  assert.ok(failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("ADDED")), JSON.stringify(failures));

  // C2c: a STALE entry (violation fixed, entry kept) → FAIL (the list only shrinks)
  failures = runIsolationChecks({ ...base, current: entries.slice(0, 1) });
  assert.ok(failures.some((f) => f.includes("STALE")), JSON.stringify(failures));

  // C0a: over the ceiling at a clean commit (git blind) → FAIL
  failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineCount: 2 });
  assert.ok(failures.some((f) => f.includes("over the ratchet ceiling")), JSON.stringify(failures));

  // C0b: raising the ceiling in the working tree → FAIL
  failures = runIsolationChecks({ ...base, current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineEntries: [...entries, "c.test.mjs:spawns-test-sh"], baselineCount: 3, baselineCountHead: 2 });
  assert.ok(failures.some((f) => f.includes("ceiling was RAISED")), JSON.stringify(failures));

  // C2d: a malformed entry → FAIL
  failures = runIsolationChecks({ current: [], dataEntries: ["not-a-valid-entry"], baselineEntries: [], baselineCount: null, baselineCountHead: null, fileExists: () => true });
  assert.ok(failures.some((f) => f.includes("malformed")), JSON.stringify(failures));
});

// ── AC3/AC4 real-repo rehearsal: the known instances appear, relation-sync is quiet ─────────────────
test("AC3/AC4 rehearsal: real repo reports the three known instances + the 6 remaining process.exit(1)s", () => {
  const res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, "--list"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split("\n").filter(Boolean);
  const byRule = (rule) => lines.filter((l) => l.endsWith(`:${rule}`));

  // AC3: M136-related (plugin-packaging, shared build artifact) must appear
  assert.ok(lines.includes("plugin/test/plugin-packaging.test.mjs:shared-build-artifact-write"), `missing M136 instance:\n${res.stdout}`);
  // AC3: AC11-related (select-tests-for-touches, spawns the runner) must appear
  assert.ok(lines.includes("plugin/test/select-tests-for-touches.test.mjs:spawns-test-sh"), `missing AC11 instance:\n${res.stdout}`);
  // AC3: relation-sync was FIXED — it must NOT appear under any rule
  assert.ok(!lines.some((l) => l.startsWith("packages/quay-native/test/relation-sync.test.mjs")), `relation-sync must not report:\n${res.stdout}`);
  // AC3 (gap-r1-cannot-see-tests-writing-into-the-live-task-store): the two R7 live-data-dir-write
  // instances were FIXED — neither may report live-data-dir-write
  assert.ok(!lines.some((l) => l.startsWith("experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs:live-data-dir-write")), `it0-dod-check R7 must not report:\n${res.stdout}`);
  assert.ok(!lines.some((l) => l.startsWith("plugin/test/workflow-event-schema.test.mjs:live-data-dir-write")), `workflow-event-schema R7 must not report:\n${res.stdout}`);
  // AC2/AC5 (gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree): the THREE R8
  // shared-root-mkdtemp instances (the 2 the grep found + run-identity's REPO_ROOT/tmp root) were
  // FIXED to os.tmpdir() — none may report shared-root-mkdtemp
  for (const f of [
    "experiments/quay-perpetual-stream/test/loadbearing-test-gate.test.mjs",
    "packages/quay/test/ts-typecheck-gate.test.mjs",
    "plugin/test/run-identity.test.mjs",
  ]) {
    assert.ok(!lines.some((l) => l.startsWith(`${f}:shared-root-mkdtemp`)), `${f} R8 must not report (fixed to os.tmpdir):\n${res.stdout}`);
  }
  // AC4: the 6 remaining known process.exit(1) harnesses (AC7 list, minus the fixed relation-sync
  // and gap002 — the tmp-leak fix d887ab12 made gap002 import node:test + use an after() cleanup
  // hook, so R4's hand-rolled-only scope no longer applies to it).
  for (const f of [
    "packages/quay-native/test/adversarial-eval.test.mjs",
    "packages/quay-native/test/cas-write.test.mjs",
    "packages/quay-native/test/create-validation.test.mjs",
    "packages/quay-native/test/edit-validation.test.mjs",
    "packages/quay-native/test/lock.test.mjs",
    "packages/quay-native/test/yaml-frontmatter-colon.test.mjs",
  ]) {
    assert.ok(lines.includes(`${f}:process-exit-1`), `missing AC4 process.exit(1) file ${f}:\n${res.stdout}`);
  }
  assert.equal(byRule("process-exit-1").length, 6, `expected exactly 6 process-exit-1 entries:\n${res.stdout}`);
});

// ── AC7: a deliberately-constructed violating test file is reported by the CLI ──────────────────────
test("AC7: a manually constructed violating test file is reported by the CLI (not just on the live repo)", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-isolation-ac7-"));
  try {
    // A minimal canonical root whose glob picks up ONE deliberately-broken test file.
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "scripts", "test.sh"), 'glob=(packages/*/test/*.test.mjs)\n');
    const testDir = path.join(scratch, "packages", "quay", "test");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "deliberately-violating.test.mjs"),
      '// @test-group product\nconst tasksDir = path.join(__dirname, ".tmp-constructed-bad");\nfunction fail() { process.exit(1); }\nconst d = fs.mkdtempSync(path.join(REPO_ROOT, "constructed-"));\nt.after(() => fs.rmSync(d, { recursive: true, force: true }));\n'
    );
    const dataFile = path.join(scratch, "plugin", "test-isolation-violations.txt");
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "# baseline-count: 3\npackages/quay/test/deliberately-violating.test.mjs:fixed-path-write\npackages/quay/test/deliberately-violating.test.mjs:process-exit-1\npackages/quay/test/deliberately-violating.test.mjs:shared-root-mkdtemp\n");
    const baselineFile = path.join(scratch, "baseline-violations.txt");
    fs.writeFileSync(baselineFile, "# baseline-count: 3\npackages/quay/test/deliberately-violating.test.mjs:fixed-path-write\npackages/quay/test/deliberately-violating.test.mjs:process-exit-1\npackages/quay/test/deliberately-violating.test.mjs:shared-root-mkdtemp\n");

    // All three rules fire on the constructed file and the check passes because they are baselined.
    let res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, scratch, "--data-file", dataFile, "--baseline-file", baselineFile], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, `expected PASS (baselined) on the constructed file:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /deliberately-violating\.test\.mjs:fixed-path-write/);
    assert.match(res.stdout, /deliberately-violating\.test\.mjs:process-exit-1/);
    assert.match(res.stdout, /deliberately-violating\.test\.mjs:shared-root-mkdtemp/);

    // Now demonstrate the RATCHET (AC5) on the constructed file: a NEW violation (a spawn) with no
    // data-file entry fails.
    fs.writeFileSync(
      path.join(testDir, "deliberately-violating.test.mjs"),
      '// @test-group product\nimport { spawnSync } from "node:child_process";\nspawnSync("bash", ["scripts/test.sh", "--for-task", "x"]);\n'
    );
    res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, scratch, "--data-file", dataFile, "--baseline-file", baselineFile], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 1, `expected FAIL (new spawns-test-sh violation):\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /spawns-test-sh.*no entry|no entry.*spawns-test-sh/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── CLI rehearsal against the REAL repo: the wired check exits 0 (all 23 baselined) ─────────────────
test("CLI rehearsal: the real repo's check passes (all violations baselined, no drift)", () => {
  const res = spawnSync("node", ["--experimental-strip-types", CHECK_TS, REPO_ROOT], { encoding: "utf8", timeout: 60_000 });
  assert.equal(res.status, 0, `expected PASS against the real repo:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /PASS: all \d+ violation\(s\) are baselined/);
});
