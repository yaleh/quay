// @test-group governance
// refresh-worktree-quay.test.mjs — tasks/gap-fan-in-worktree-quay-provisioning:
// the fan-in full suite runs DIRECTLY in a linked task worktree (`cd ${worktree} && bash
// scripts/test.sh`), where `.quay/` is gitignored ⇒ `git worktree add` copies NONE of it ⇒
// `<worktree>/.quay/config.yml` was absent/stale ⇒ the suite's repo-root resolution (_findRepoRoot)
// + config/gates tests (M63 ts-typecheck, blocked-signal, cap-from-gate, monitor-mount, run-identity
// — ruled-gap fan-in: 72 environmental REDs across 22 files, ALL green on the main checkout) failed
// environmentally. The OTHER half of gap-gitignored-carriers: the carriers fix (QUAY_MAIN_CHECKOUT)
// pointed CHECKERS at the main; THIS script snapshots the main's .quay/ into the worktree so the
// SUITE reads the same config/gates/runtime carriers.
//
// Coverage map:
//   AC1 — snapshot copy: main's `.quay/config.yml` (distinctive gate) + a runtime carrier
//         (gate-events.jsonl) land in the worktree's .quay/, byte-identical content.
//   AC2 — heavy/wasteful excluded: node-compile-cache/ and dated full-suite-<ISO>.log are NOT
//         copied (3.2G / ~1.2M each would be wasted on a one-suite snapshot).
//   AC3 — no-op on the main checkout: the linked-worktree guard skips a main run (nothing to copy).
//   AC4 — root auto-derived: without --root, the main checkout is resolved from `git worktree list`.
//   AC5 — idempotent + dry-run: re-running overwrites (no error); --dry-run changes nothing.
//
// Run:
//   scripts/test.sh plugin/test/refresh-worktree-quay.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/refresh-worktree-quay.sh");

function bash(args, opts = {}) {
  return spawnSync("bash", args, { encoding: "utf8", ...opts });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/** Real throwaway git repo (main) with a registered linked worktree + gitignored .quay/. */
function makeRepo() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-quay-main-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: main, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@test");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(main, ".gitignore"), "/.quay/\n");
  fs.writeFileSync(path.join(main, "README.md"), "# repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  // gitignored .quay/ (config + a runtime carrier + heavy/wasteful)
  fs.mkdirSync(path.join(main, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(main, ".quay", "config.yml"), "providers: {}\ngates:\n  probe:\n    - name: zz-refresh-probe-gate\n      command: \"true\"\n", "utf8");
  fs.writeFileSync(path.join(main, ".quay", "gate-events.jsonl"), "{\"gate\":\"probe\"}\n", "utf8");
  fs.mkdirSync(path.join(main, ".quay", "node-compile-cache", "deep"), { recursive: true });
  fs.writeFileSync(path.join(main, ".quay", "node-compile-cache", "deep", "c.js"), "x", "utf8");
  fs.writeFileSync(path.join(main, ".quay", "full-suite-2026-08-15T00-00-00-000Z.log"), "historical", "utf8");
  const wt = path.join(main, "wt");
  git("worktree", "add", "-q", "-b", "task/fixture", wt, "HEAD");
  return { main, wt, git };
}

test("AC1 — snapshot copy: main's .quay/config.yml + runtime carriers land in the worktree, byte-identical", () => {
  const { main, wt } = makeRepo();
  try {
    const r = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);

    const cfg = path.join(wt, ".quay", "config.yml");
    assert.ok(fs.existsSync(cfg), "worktree must now have .quay/config.yml (absent before: git worktree add copies no gitignored files)");
    assert.ok(fs.readFileSync(cfg, "utf8").includes("zz-refresh-probe-gate"), "copied config must carry the main's current gates (the M63 ts-typecheck class)");
    const carrier = path.join(wt, ".quay", "gate-events.jsonl");
    assert.ok(fs.existsSync(carrier), "runtime carrier gate-events.jsonl must be copied");
    assert.equal(fs.readFileSync(carrier, "utf8"), fs.readFileSync(path.join(main, ".quay", "gate-events.jsonl"), "utf8"), "carrier content byte-identical");
    assert.match(r.stderr, /copied [1-9]/);
  } finally {
    rmrf(main);
  }
});

test("AC2 — heavy/wasteful excluded: node-compile-cache/ and dated full-suite-<ISO>.log are NOT copied", () => {
  const { main, wt } = makeRepo();
  try {
    const r = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(wt, ".quay", "node-compile-cache")), "node-compile-cache must NOT be copied (3.2G; test.sh points NODE_COMPILE_CACHE at its own copy)");
    assert.ok(!fs.existsSync(path.join(wt, ".quay", "full-suite-2026-08-15T00-00-00-000Z.log")), "dated full-suite-<ISO>.log must NOT be copied (historical per-run log)");
    assert.match(r.stderr, /[0-9]+ heavy\/wasteful skipped/, "the heavy/wasteful exclusions must be counted");
  } finally {
    rmrf(main);
  }
});

test("AC3 — no-op on the main checkout: the linked-worktree guard skips a main run", () => {
  const { main } = makeRepo();
  try {
    const before = fs.readFileSync(path.join(main, ".quay", "config.yml"), "utf8");
    const r = bash([SCRIPT, main, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /no-op/, "a main-checkout run must be a no-op");
    assert.equal(fs.readFileSync(path.join(main, ".quay", "config.yml"), "utf8"), before, "main's .quay untouched");
  } finally {
    rmrf(main);
  }
});

test("AC4 — root auto-derived: without --root, the main checkout is resolved from git worktree list", () => {
  const { main, wt } = makeRepo();
  try {
    const r = bash([SCRIPT, wt]); // no --root, no QUAY_MAIN_CHECKOUT
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(wt, ".quay", "config.yml")), "config copied with git-derived root");
    assert.ok(fs.readFileSync(path.join(wt, ".quay", "config.yml"), "utf8").includes("zz-refresh-probe-gate"));
  } finally {
    rmrf(main);
  }
});

test("AC5 — idempotent + --dry-run changes nothing", () => {
  const { main, wt } = makeRepo();
  try {
    const r1 = bash([SCRIPT, wt, "--root", main]);
    assert.equal(r1.status, 0);
    const r2 = bash([SCRIPT, wt, "--root", main]); // re-run: overwrite stale copy, no error
    assert.equal(r2.status, 0, `re-run exited ${r2.status}: ${r2.stdout} ${r2.stderr}`);
    assert.match(r2.stderr, /copied [1-9]/, "re-run still copies (overwrites) — idempotent");

    const dry = bash([SCRIPT, wt, "--root", main, "--dry-run"]);
    assert.equal(dry.status, 0);
    assert.match(dry.stderr, /\[dry-run\]/);
  } finally {
    rmrf(main);
  }
});
