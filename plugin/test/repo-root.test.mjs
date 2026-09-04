// @test-group engine
// repo-root.test.mjs — the mainCheckoutRoot() order-independent main-checkout derivation
// (gap-main-checkout-root-derivation-recurs-three-sites). The main checkout is the PARENT of the
// repo's shared `.git` dir (`git rev-parse --git-common-dir`), NOT the first `git worktree list
// --porcelain` entry — that list's order is NOT guaranteed to place the main working tree first.
//
//   AC2 — mainCheckoutRoot resolves the main checkout from a linked worktree AND from the main
//         checkout itself; a non-git dir returns "" (fail-open, caller applies its fallback).
//   AC1/AC5 — the derivation is order-independent: under a git shim that flips the `worktree list`
//         block order (the honest equivalent — git 2.43's get_worktrees() always lists main first,
//         so the flip cannot be constructed in a real repo), mainCheckoutRoot still returns main.
//   AC3/AC4 — the three former first-line-parsing sites now delegate to the shared implementation
//         (runner-concurrency.ts + driver-runtime.ts import repo-root.ts; dispatch-worktree-setup.sh
//         sources repo-root.sh and its first-line awk is gone).
//
// Run: node --test plugin/test/repo-root.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { mainCheckoutRoot } from "../scripts/repo-root.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");

function git(cwd, args, opts = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    ...opts,
  });
}

/** A real throwaway git repo: main checkout + one linked worktree. */
function makeGitWorktree() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "mcr-main-"));
  const wt = path.join(os.tmpdir(), `mcr-wt-${path.basename(main)}`);
  fs.writeFileSync(path.join(main, "a.txt"), "hi\n");
  git(main, ["init", "-q"]);
  git(main, ["config", "user.email", "t@t"]);
  git(main, ["config", "user.name", "t"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "init"]);
  git(main, ["worktree", "add", "-q", wt, "HEAD"]);
  return { main, wt };
}

// ── AC2 — resolves the main checkout from a linked worktree AND from the main checkout ──────────

test("AC2 — mainCheckoutRoot resolves the MAIN checkout from a linked worktree and from the main checkout", () => {
  const { main, wt } = makeGitWorktree();
  try {
    assert.equal(mainCheckoutRoot(wt), main, "from a linked worktree: parent of shared .git dir = main");
    assert.equal(mainCheckoutRoot(main), main, "from the main checkout: same path");
  } finally {
    git(main, ["worktree", "remove", "--force", wt], { stdio: "ignore" });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test("AC2 — a non-git dir returns \"\" (fail-open, the caller applies its own fallback)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcr-nogit-"));
  try {
    assert.equal(mainCheckoutRoot(dir), "", "non-git start dir must not throw, must return empty");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC1/AC5 — order-independent: a flipped `worktree list` order still resolves to main ──────────

test("AC1/AC5 — mainCheckoutRoot is order-independent (a flipped `worktree list` order still resolves to main)", () => {
  const { main, wt } = makeGitWorktree();
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcr-shim-"));
  const shim = path.join(shimDir, "git");
  fs.writeFileSync(shim, `#!/usr/bin/env bash
prev=""
for a in "$@"; do
  [ "$prev" = "worktree" ] && [ "$a" = "list" ] && { is_wt_list=1; break; }
  prev="$a"
done
if [ "\${is_wt_list:-0}" = "1" ]; then
  ${realGit} "$@" | awk '/^worktree /{n++} {blocks[n]=blocks[n] $0 "\\n"} END{for(i=n;i>=1;i--) printf "%s", blocks[i]}'
  exit $?
fi
exec ${realGit} "$@"
`);
  fs.chmodSync(shim, 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${savedPath}`;
  try {
    // Sanity: the shim actually flips the order (the first entry is now the linked worktree).
    const flipped = spawnSync(shim, ["-C", wt, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout;
    const first = flipped.split("\n").find((l) => l.startsWith("worktree ")).slice("worktree ".length);
    assert.notEqual(first, main, "shim must list the linked worktree before the main checkout");
    // The order-independent derivation still resolves to main under the flipped order.
    assert.equal(mainCheckoutRoot(wt), main, "order-independent main derivation ignores the list order");
  } finally {
    process.env.PATH = savedPath;
    git(main, ["worktree", "remove", "--force", wt], { stdio: "ignore" });
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
});

// ── AC3/AC4 — the three former first-line-parsing sites delegate to the shared implementation ────

test("AC3/AC4 — the three former sites delegate to the shared mainCheckoutRoot (no private first-line parsing)", () => {
  for (const f of ["runner-concurrency.ts", "driver-runtime.ts"]) {
    assert.match(
      fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8"),
      /from ["']\.\/repo-root\.ts["']/,
      `${f} must import the shared repo-root.ts`,
    );
  }
  const setup = fs.readFileSync(path.join(SCRIPTS_DIR, "dispatch-worktree-setup.sh"), "utf8");
  assert.match(setup, /\. "\$\{SCRIPT_DIR\}\/repo-root\.sh"/, "setup must source repo-root.sh");
  assert.match(setup, /mainCheckoutRoot "\$\{worktree\}"/, "setup must call mainCheckoutRoot");
  assert.doesNotMatch(setup, /print \$2; exit/, "the first-line awk is deleted from setup");
});
