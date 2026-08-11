// @test-group engine
// gitignore.test.mjs — gap-runtime-state-files-not-gitignored (AC2) + the same-class artifact
// added by gap-quay-last-pane-txt-untracked-dirties-tree: the 6 runtime-state files under .quay/
// must be gitignored so they never appear in `git status --short` (dirty-tree false alarms from
// restart-readiness-check.sh / clean-tree assertions). The repo's .gitignore matches .quay/*
// PER-FILE (there is no `**/.quay/*` wildcard — a new runtime file silently falls through until
// someone adds its line), so this test is the executable guard for the exact recurrence: if a
// future edit drops one of the per-file lines, `git check-ignore` returns fewer than 6 and this
// FAILs. Pattern form mirrors the existing `**/.quay/session-liveness.*.json` lines.
//
// Run:
//   scripts/test.sh plugin/test/gitignore.test.mjs
//   node --test plugin/test/gitignore.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
const REPO_ROOT = findRepoRoot(__dirname);

// The 6 runtime-state files .gitignore carries per-file entries for (git check-ignore must hit
// ALL of them). These are the three-layer execution products — last-pane + last-outer-pane
// (capture-pane pane-state products, pane-state-classify + the manager→outer AC5 watch path),
// suite-fix chain (cgroup-evidence / chain-heartbeat / health-last-run), B2 closure accounting
// (closure-pass-last-run). None belongs in git.
const RUNTIME_STATE_FILES = [
  ".quay/last-pane.txt",
  ".quay/last-outer-pane.txt",
  ".quay/suite-cgroup-evidence.txt",
  ".quay/suite-chain-heartbeat.json",
  ".quay/suite-health-last-run.json",
  ".quay/closure-pass-last-run.json",
];

test("AC2 — all 6 runtime-state files are gitignored (git check-ignore full hit)", () => {
  const out = execFileSync("git", ["check-ignore", ...RUNTIME_STATE_FILES], {
    cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  const ignored = out.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(ignored.length, RUNTIME_STATE_FILES.length,
    `expected ${RUNTIME_STATE_FILES.length} runtime-state files to be gitignored, got ${ignored.length}: [${ignored.join(", ")}]`);
  assert.deepEqual(new Set(ignored), new Set(RUNTIME_STATE_FILES));
});
