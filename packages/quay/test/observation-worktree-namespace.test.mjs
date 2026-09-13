// @test-group engine
// observation-worktree-namespace.test.mjs —
// gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root.
//
// The defect: `taskWorktreeOpen` (and its two sibling readers) derived the worktree namespace IN
// PLACE as `<parent-of-root>/quay-worktrees`, ignoring the per-workspace `loop.worktree_root` that
// the WRITE side (dispatch / `git worktree add`) obeys. Two projects sharing a parent directory then
// read EACH OTHER's namespaces — measured 2026-09-13 on the real third-party project
// /home/yale/work/quay-fleet, whose `/live` reported five of the quay checkout's tasks as its own.
//
// AC1 is a NEGATIVE CONTROL: the fixture is built so the OLD derivation provably answers `true` for
// project B using project A's directory, and the new one answers `false`. That assertion is stated
// explicitly (`改前红`) rather than implied, so the test can never pass vacuously.
//
// AC2: a config without `loop.worktree_root` still falls back to the convention, but the fallback is
// OBSERVABLE — the resolver returns `source`/`diagnostic`, and `taskWorktreeOpen` writes it to stderr
// once per namespace (never silent).
//
// Also covers the sibling instance that actually produced the observed symptom: the /proc worker scan
// is HOST-GLOBAL, so `workerDriverActive(root)` alone let a co-resident project with an active driver
// claim another project's worker processes. `readLiveWorkerProcesses(..., { root })` scopes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  taskWorktreeOpen,
  resetWorktreeFallbackWarnings,
  readLiveWorkerProcesses,
  workerRepoRootFromCmdline,
  workerTaskIdFromCmdline,
  WORKER_PROCESS_NAME,
} from "../src/observation.ts";
import { resolveWorktreeNamespace, DEFAULT_WORKTREE_NAMESPACE_NAME } from "../src/worktree-namespace.ts";

/** Write `<dir>/.quay/config.yml` carrying `loop.worktree_root` (omitted when `worktreeRoot` is null). */
function writeConfig(dir, worktreeRoot) {
  const q = path.join(dir, ".quay");
  fs.mkdirSync(q, { recursive: true });
  const body =
    worktreeRoot == null
      ? "providers:\n  native:\n    enabled: true\nloop:\n  board: native\n"
      : `providers:\n  native:\n    enabled: true\nloop:\n  board: native\n  worktree_root: ${worktreeRoot}\n`;
  fs.writeFileSync(path.join(q, "config.yml"), body, "utf8");
}

test("AC1 (negative control): project B's own namespace answers, NOT the co-resident project A's", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wtns-adjacent-"));
  try {
    // A's namespace deliberately uses the HISTORICAL name, so the pre-fix derivation for B
    // (`dirname(B)/quay-worktrees`) lands inside A's namespace — the defect's exact shape.
    const aDir = path.join(parent, "projectA");
    const bDir = path.join(parent, "projectB");
    const aNs = path.join(parent, DEFAULT_WORKTREE_NAMESPACE_NAME); // <parent>/quay-worktrees
    const bNs = path.join(parent, "projectB-worktrees");
    fs.mkdirSync(path.join(aNs, "TASK-A"), { recursive: true });
    fs.mkdirSync(bNs, { recursive: true }); // B's namespace EXISTS and is empty (zero dispatches)
    writeConfig(aDir, aNs);
    writeConfig(bDir, bNs);

    // 改前红: the old in-place derivation reads A's directory and would answer `true` for B.
    assert.equal(
      fs.existsSync(path.join(path.dirname(path.resolve(bDir)), DEFAULT_WORKTREE_NAMESPACE_NAME, "TASK-A")),
      true,
      "改前红: <parent-of-B>/quay-worktrees/TASK-A exists — the hardcoded derivation answers `true` from A's namespace (this is the defect the fix removes)",
    );
    assert.equal(
      taskWorktreeOpen(bDir, "TASK-A"),
      false,
      "改后: B's config namespace (projectB-worktrees) is observable and does NOT hold TASK-A ⇒ a positive 'released' reading, never A's `true`",
    );

    // Non-vacuous: A still resolves through its OWN namespace, and B's own task reads true.
    assert.equal(taskWorktreeOpen(aDir, "TASK-A"), true, "A reads its own namespace (the fix did not break the owning project)");
    fs.mkdirSync(path.join(bNs, "TASK-B"), { recursive: true });
    assert.equal(taskWorktreeOpen(bDir, "TASK-B"), true, "B reads its own namespace once its own worktree exists");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC1 (fail-closed preserved): B's namespace absent ⇒ null, never a positive 'released'", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wtns-absent-"));
  try {
    const bDir = path.join(parent, "projectB");
    writeConfig(bDir, path.join(parent, "projectB-worktrees")); // configured but never created
    assert.equal(taskWorktreeOpen(bDir, "TASK-A"), null,
      "an absent namespace is 'unknown' — the fail-closed tri-state is unchanged by the fix");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC1: loop.worktree_root is normalized — a config value carrying `..` resolves to the real dir", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wtns-dotdot-"));
  try {
    const proj = path.join(parent, "proj");
    const real = path.join(parent, "proj-worktrees");
    fs.mkdirSync(path.join(real, "T-1"), { recursive: true });
    // quay-init's own shape: <parent>/../<name> (see .quay/config.yml of the real quay checkout).
    writeConfig(proj, `${proj}/../proj-worktrees`);
    const ns = resolveWorktreeNamespace(proj);
    assert.equal(ns.source, "config");
    assert.equal(ns.diagnostic, null);
    assert.equal(ns.dir, real, "the `..` segment is normalized to the directory the write side creates");
    assert.equal(taskWorktreeOpen(proj, "T-1"), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC2: a config lacking loop.worktree_root falls back — and the fallback is reported, not silent", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wtns-fallback-"));
  try {
    const proj = path.join(parent, "proj");
    writeConfig(proj, null); // config EXISTS, but has no loop.worktree_root

    const ns = resolveWorktreeNamespace(proj);
    assert.equal(ns.source, "fallback", "the convention fallback is taken when the key is absent");
    assert.equal(ns.dir, path.join(parent, DEFAULT_WORKTREE_NAMESPACE_NAME));
    assert.ok(typeof ns.diagnostic === "string" && ns.diagnostic.length > 0,
      "AC2: the fallback carries a diagnostic — never silent");
    assert.match(ns.diagnostic, /worktree_root/, "the diagnostic names the missing key");

    // The second, in-band channel: taskWorktreeOpen writes it to stderr, ONCE per namespace.
    const chunks = [];
    const orig = process.stderr.write;
    process.stderr.write = (c) => { chunks.push(String(c)); return true; };
    try {
      resetWorktreeFallbackWarnings();
      taskWorktreeOpen(proj, "NOBODY");
      taskWorktreeOpen(proj, "NOBODY-2");
    } finally {
      process.stderr.write = orig;
    }
    const emitted = chunks.join("");
    assert.match(emitted, /worktree namespace fallback/, "AC2: the fallback reaches stderr");
    assert.equal(chunks.length, 1, "the warning is one-shot per namespace, not one line per render");

    // No config file at all is ALSO a fallback — and says so, with its own reason.
    const bare = path.join(parent, "no-config");
    fs.mkdirSync(bare, { recursive: true });
    const bareNs = resolveWorktreeNamespace(bare);
    assert.equal(bareNs.source, "fallback");
    assert.match(bareNs.diagnostic, /config\.yml/, "the diagnostic distinguishes 'no config file' from 'no key'");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── The co-resident-worker leak that produced the observed symptom ────────────────────────────────

test("workerRepoRootFromCmdline: extracts the workspace root a worker process declares (pure)", () => {
  const cmd = `claude -n ${WORKER_PROCESS_NAME} -p Task: gap-x. Repo root: /home/yale/work/quay. Run the implementation chain: …`;
  assert.equal(workerRepoRootFromCmdline(cmd), "/home/yale/work/quay");
  assert.equal(workerRepoRootFromCmdline(`claude -n ${WORKER_PROCESS_NAME} -p Task: gap-x. no marker`), null);
  assert.equal(workerRepoRootFromCmdline("some other process --flag"), null);
  // A path containing dots must not be truncated at the first one.
  assert.equal(
    workerRepoRootFromCmdline(`claude -n ${WORKER_PROCESS_NAME} -p Task: t. Repo root: /srv/my.repo.d/ws. tail`),
    "/srv/my.repo.d/ws",
  );
});

test("readLiveWorkerProcesses({root}) scopes the HOST-GLOBAL /proc scan to this workspace", () => {
  const procDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-proc-scoped-"));
  try {
    fs.writeFileSync(path.join(procDir, "stat"), "cpu  0 0 0\nbtime 1724486400\n");
    const statPid = (pid) => `${pid} (claude) S 1 ${pid} ${pid} 0 -1 4194560 10 0 0 0 0 0 0 0 20 0 1 0 10000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
    const put = (pid, task, repoRoot) => {
      fs.mkdirSync(path.join(procDir, pid));
      fs.writeFileSync(
        path.join(procDir, pid, "cmdline"),
        `claude\x00-n\x00${WORKER_PROCESS_NAME}\x00-p\x00Task: ${task}. Repo root: ${repoRoot}. rest\x00`,
      );
      fs.writeFileSync(path.join(procDir, pid, "stat"), statPid(pid));
    };
    put("100", "TASK-MINE", "/home/yale/work/quay");
    put("101", "TASK-FOREIGN", "/home/yale/work/quay-fleet");
    fs.mkdirSync(path.join(procDir, "102"));
    fs.writeFileSync(path.join(procDir, "102", "cmdline"), `claude\x00-n\x00${WORKER_PROCESS_NAME}\x00-p\x00Task: TASK-NOMARKER. x\x00`);
    fs.writeFileSync(path.join(procDir, "102", "stat"), statPid("102"));

    const unscoped = readLiveWorkerProcesses(procDir);
    assert.equal(unscoped.length, 3, "unscoped (no root) keeps the raw host-wide set — the pre-fix behavior");

    const mine = readLiveWorkerProcesses(procDir, { root: "/home/yale/work/quay" });
    assert.deepEqual(mine.map((w) => w.taskId), ["TASK-MINE"],
      "scoped: a co-resident project's worker (101) and an unattributable one (102) are EXCLUDED");

    const foreign = readLiveWorkerProcesses(procDir, { root: "/home/yale/work/quay-fleet" });
    assert.deepEqual(foreign.map((w) => w.taskId), ["TASK-FOREIGN"],
      "the same /proc answers differently per workspace — this is the reading quay-fleet was missing");
    assert.equal(foreign[0].repoRoot, "/home/yale/work/quay-fleet", "the declared repo root is carried on the entry");
    assert.equal(workerTaskIdFromCmdline(`claude -n ${WORKER_PROCESS_NAME} -p Task: TASK-NOMARKER. x`), "TASK-NOMARKER",
      "baseline: the task id parser is untouched by the scoping");
  } finally {
    fs.rmSync(procDir, { recursive: true, force: true });
  }
});
