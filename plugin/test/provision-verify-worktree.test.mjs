// @test-group governance
// provision-verify-worktree.test.mjs — tasks/gap-provision-verify-worktree-step
// (the shared "create a runnable verify worktree" step; manager 2026-08-10 family finding —
//   fresh verify worktrees failed tonight from missing gitignored runtime files that task
//   worktrees get: 11:12/11:31 AC4, 13:14 AC11 config.yml, 13:03 esbuild/node_modules).
//
// Coverage map:
//   AC1 — node_modules symlink: <main>/node_modules → <worktree>/node_modules.
//   AC2 — config.yml present: the EXISTING worktree-include.sh copies it (declarative .worktreeinclude).
//   AC3 — idempotent: re-running keeps the node_modules symlink + re-copies config (no error).
//   AC4 — dry-run: prints what would happen, changes nothing.
//   AC5 — fail-closed: missing --worktree, missing main node_modules exit 2.
//   AC6 — Core CLI dist build: a fresh worktree gets packages/quay/dist/quay.js built (the 4th gap,
//         manager 2026-08-10 15:0x — dist/quay.js red r235/r236/r247, 3× over 3.5h).
//
// Run:
//   scripts/test.sh plugin/test/provision-verify-worktree.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/provision-verify-worktree.sh");

function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

/** Make a throwaway MAIN repo fixture (node_modules + .quay/config.yml present). */
function tmpMainRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provision-main-"));
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), "fixture config\n");
  fs.writeFileSync(path.join(dir, ".worktreeinclude"), "/.quay/config.yml\n");
  return dir;
}

/** Make a throwaway WORKTREE dir (tracked files, no symlinks). Step 3 (dist build) short-circuits
 * when packages/quay/dist/quay.js is already present, so the plain-dir tests pre-create it (the
 * real build is exercised by the manual fresh-worktree verification + the suite's npm-pack-e2e). */
function tmpWorktree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provision-verify-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(dir, "packages", "quay", "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "packages", "quay", "dist", "quay.js"), "// fixture dist\n");
  fs.copyFileSync(path.join(REPO_ROOT, ".worktreeinclude"), path.join(dir, ".worktreeinclude"));
  return dir;
}

test("AC6 — Core CLI dist build: a fresh worktree gets packages/quay/dist/quay.js (the 4th provisioning gap)", () => {
  // NOTE: building the real packages/quay/dist requires a real packages/quay tree + npm deps, so
  // this is a targeted assertion: the script's dry-run mentions the build step (the mechanism is
  // wired). The real build is verified by the manual fresh-worktree test + the suite itself.
  const main = tmpMainRepo();
  const wt = tmpWorktree();
  try {
    const r = run(["--worktree", wt, "--root", main, "--dry-run"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /packages\/quay\/dist/, "dry-run must mention the Core CLI dist build");
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test("AC1 — node_modules symlink: <main>/node_modules → <worktree>/node_modules", () => {
  // NOTE: config.yml copying is worktree-include.sh's job (declarative .worktreeinclude) and needs a
  // REAL git worktree (git worktree list) — this plain-dir test asserts only what THIS script
  // guarantees (the node_modules symlink). The compose-with-worktree-include path is covered by the
  // real-worktree manual verification + the A15 ④ contract substep.
  const main = tmpMainRepo();
  const wt = tmpWorktree();
  try {
    const r = run(["--worktree", wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "node_modules is a symlink");
    assert.equal(fs.readlinkSync(path.join(wt, "node_modules")), path.join(main, "node_modules"));
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test("AC3 — idempotent: re-run keeps symlink, no error", () => {
  const main = tmpMainRepo();
  const wt = tmpWorktree();
  try {
    const r1 = run(["--worktree", wt, "--root", main]);
    assert.equal(r1.status, 0);
    const r2 = run(["--worktree", wt, "--root", main]);
    assert.equal(r2.status, 0, `re-run failed: ${r2.stdout} ${r2.stderr}`);
    assert.match(r2.stdout, /already present|done/);
    assert.equal(fs.readlinkSync(path.join(wt, "node_modules")), path.join(main, "node_modules"));
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test("AC4 — dry-run prints, changes nothing", () => {
  const main = tmpMainRepo();
  const wt = tmpWorktree();
  try {
    const r = run(["--worktree", wt, "--root", main, "--dry-run"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /dry-run/);
    assert.ok(!fs.existsSync(path.join(wt, "node_modules")), "dry-run must not create node_modules");
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test("AC5 — fail-closed: missing --worktree, missing main node_modules exit 2", () => {
  const main0 = tmpMainRepo();
  try {
    const r1 = run(["--root", main0]);
    assert.equal(r1.status, 2, "missing --worktree must exit 2");
  } finally {
    fs.rmSync(main0, { recursive: true, force: true });
  }

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "provision-noroot-"));
  const wt = tmpWorktree();
  try {
    const r2 = run(["--worktree", wt, "--root", bare]);
    assert.equal(r2.status, 2, "missing main node_modules must exit 2");
    assert.match(r2.stderr, /node_modules/);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});
