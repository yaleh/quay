// runner-tree-state.ts — the tested-tree STATE family, extracted from full-suite-runner.ts
// (gap-ac128-hub-split-harness-concerns).
//
// WHY A SEPARATE FILE: full-suite-runner.ts is a HUB file (any change forces the full suite). The
// tree-state family (readVerifiedCommit / readTreeState / TreeState / contentHash /
// AssertionSurfaceSnapshot / snapshotAssertionSurface) is HARNESS-CRITICAL — it anchors the tested
// commit + detects mid-round assertion-surface edits — so this file is ALSO a hub (listed in
// suite-bucket-hub-list.ts HUB_FILES). Extracting it out of the monolith shrinks that monolith WITHOUT
// weakening the hub rule (a change here still forces the full suite).
//
// Moved verbatim from full-suite-runner.ts. `__dirname` is re-derived here (same value: this file
// lives in the same plugin/scripts/ directory, so `path.join(__dirname, "assert-clean-tree.sh")`
// resolves identically). Re-exported from full-suite-runner.ts so its public API surface is unchanged.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolveAssertionSurface } from "./precommit-guard.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * gap-merge-green-snapshot-verified-commit-livelock AC2 — the TESTED COMMIT: `git rev-parse HEAD` in
 * the tested checkout at suite start. In the main repo this IS the integration tip the green measures
 * (the batch-merge helper merges exactly this commit, not the moving integration HEAD). Not a git
 * checkout (a hermetic test root) ⇒ undefined ⇒ the field is omitted (graceful — the AC1 exact-shape
 * test on a non-git temp root stays byte-stable).
 */
export function readVerifiedCommit(root: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    return /^[0-9a-f]{40,}$/i.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}
/**
 * gap-verifiedcommit-dirty-tree-false-certificate AC1/AC2 — the TESTED root's tree state at round
 * START: the dirty flag (via plugin/scripts/assert-clean-tree.sh — its FIRST runner caller; the
 * absolute mode exits 0 on a clean tree, 1 on a dirty one, and its output names WHAT is dirty) plus
 * the tested-content tree hash (tracked part — `git stash create`'s commit tree = working-tree
 * tracked content, staged+unstaged; HEAD tree when nothing to stash). A non-git hermetic root yields
 * undefined (never fabricates a tree — same contract as verifiedCommit).
 */
export function readTreeState(root: string): TreeState | undefined {
  let treeDirty: boolean;
  try {
    const assertClean = path.join(__dirname, "assert-clean-tree.sh");
    try {
      // Exit 0 = clean; exit 1 = dirty (the FAIL branch); exit 2 = usage / not a git work tree —
      // any status OTHER than 1 degrades to undefined (fail open: no detection, never a verdict).
      execFileSync("bash", [assertClean, root], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      treeDirty = false;
    } catch (e) {
      const status = (e as { status?: unknown }).status;
      if (status !== 1) return undefined;
      treeDirty = true;
    }
    const stashCreate = execFileSync("git", ["stash", "create"], { cwd: root, encoding: "utf8" }).trim();
    const tree = /^[0-9a-f]{40,}$/i.test(stashCreate)
      ? execFileSync("git", ["rev-parse", `${stashCreate}^{tree}`], { cwd: root, encoding: "utf8" }).trim()
      : execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
    return { treeDirty, tree };
  } catch {
    return undefined;
  }
}
export interface TreeState {
  /** True when the tested working tree has ANY change vs HEAD — INCLUDING untracked files. */
  treeDirty: boolean;
  /** Tested-content tree hash (tracked part) — `git stash create`'s tree (working-tree tracked
   *  content) when dirty, else `HEAD^{tree}`. */
  tree: string;
}
/** Content identity (SHA-1 hex) for an assertion-surface file's text. */
export function contentHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}
export interface AssertionSurfaceSnapshot {
  /** Repo-relative assertion-surface files, sorted (the files the running round reads). */
  files: string[];
  /** file -> content hash at snapshot time ("<unreadable>" when the file could not be read). */
  hashes: Record<string, string>;
}
/**
 * Snapshot the TESTED checkout's assertion-surface files at round start (content hashes). The surface
 * is `resolveAssertionSurface` (precommit-guard.ts — the SAME judged-object registry the pre-commit
 * guard reads; AC51 doc-class `.md` files already excluded, so doc edits are NOT assertion-surface
 * edits). Best-effort: an unreadable file records "<unreadable>"; a resolution failure (non-git
 * hermetic root / registry error) degrades to an EMPTY snapshot (no detection possible ⇒ no
 * annotation — the runner must never fail a round because the snapshot could not be taken).
 */
export function snapshotAssertionSurface(root: string): AssertionSurfaceSnapshot {
  let files: string[];
  try {
    files = [...resolveAssertionSurface(root).files].sort();
  } catch {
    return { files: [], hashes: {} };
  }
  const hashes: Record<string, string> = {};
  for (const f of files) {
    try {
      hashes[f] = contentHash(fs.readFileSync(path.join(root, f), "utf8"));
    } catch {
      hashes[f] = "<unreadable>";
    }
  }
  return { files, hashes };
}
