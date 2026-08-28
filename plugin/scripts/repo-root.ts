// repo-root.ts — single source of truth for resolving the quay repo/workspace root in the
// methodology layer (SPEC §2.4 B2: `findRepoRoot`(14)+`findWorkspaceRoot`(4) unified to one).
//
// Recognized root shapes, walking upward from `startDir` (checked at each level, in order):
//   - BUNDLE root   (quay's own repo or a task worktree): `package.json` + `plugin/` + `scripts/test.sh`
//   - CONSUMER root (a quay-init --loop target):          `package.json` + `.quay/config.yml`
//   - plain git root (any repo without quay's layout):    `.git` (directory OR worktree file)
// Fallbacks (in order): `git rev-parse --show-toplevel`, then `process.cwd()`.
//
// Why one function: `findRepoRoot`/`findWorkspaceRoot` were the same upward walk under two names
// with three coexisting strategies (`.git` walk / `.quay/config.yml` walk / bundle+consumer shape).
// Under a task worktree `plugin/` is a REAL directory (not a symlink), so
// `path.resolve(__dirname, "..", "..")` already reaches the worktree root — this is a
// maintainability problem (one concept, three strategies), not a correctness defect.
//
// Usage:
//   import { repoRoot } from "./repo-root.ts";
//   const root = repoRoot();                       // from this file's directory
//   const root = repoRoot(process.cwd());          // from an arbitrary start dir

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Max upward steps before falling back (matches the deepest prior walker, prod-data-audit's 16). */
const MAX_DEPTH = 16;

/**
 * Resolve the quay repo/workspace root by walking upward from `startDir` (default: this file's
 * directory). Returns the first ancestor that is a recognized root shape (bundle → consumer →
 * plain-git), else `git rev-parse --show-toplevel`, else `process.cwd()`.
 */
export function repoRoot(startDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}
