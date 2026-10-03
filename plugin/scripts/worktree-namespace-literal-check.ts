// worktree-namespace-literal-check.ts — the AC3 static check for
// gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root.
//
// THE INVARIANT: exactly ONE site in the product/plugin source may spell the worktree-namespace
// directory literal — the `DEFAULT_WORKTREE_NAMESPACE_NAME` declaration in
// `packages/quay/src/worktree-namespace.ts`, which is the fallback branch of the single resolver
// every reader goes through. A second spelling anywhere else is the defect re-growing: a reader that
// answers "where are this workspace's worktrees" from a hardcoded name instead of the workspace's
// `loop.worktree_root`, which is how a third-party project came to read ANOTHER project's namespace
// (measured 2026-09-13: /home/yale/work/quay-fleet → /home/yale/work/quay-worktrees).
//
// THE PREDICATE IS THE AC's OWN GREP, not a paraphrase:
//   grep -rn <DQUOTE>quay-worktrees<DQUOTE> packages/quay/src plugin/scripts   →   ≤ 1 hit
// (the double-quoted literal; the AC's exact pattern). NOTE the checker does NOT contain that literal
// itself — it searches for `JSON.stringify(DEFAULT_WORKTREE_NAMESPACE_NAME)`, so the check and the
// declaration share ONE source and the checker can never be its own false positive. (This comment
// spells the quotes as <DQUOTE> for exactly that reason: any real quoted occurrence here would be
// counted by the scan it documents.)
//
// ADVISORY, NOT FAILING: the same directory NAME also appears UNQUOTED in path regexes/comments (a
// `^.*\/quay-worktrees\/[^/]+\/` strip, the `driver start`-from-a-worktree rejection, prose). Those
// are reported with their counts so the sibling set is visible mechanically (hard rule 5b: 修好一个
// ≠ 只有一个) — but they are not a hard failure, because each has its own 口径 and its own owners.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/worktree-namespace-literal-check.ts [--root <dir>] [--json]
// Exit: 0 = invariant holds (≤1 hit, and the hit is the resolver's declaration); 1 = violated.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
// The recursive walk over SCAN_ROOTS lives in fs-walk.ts (was a byte-identical private copy here and
// in registry-path-literal-check.ts / serve-binding-literal-check.ts — finding
// `walkFiles-scan-surface-family`, routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1790995446200`). Only the traversal moved; SCAN_ROOTS and SKIP_DIRS are this
// checker's own.
import { listFilesInRoots } from "./fs-walk.ts";
import { DEFAULT_WORKTREE_NAMESPACE_NAME } from "../../packages/quay/src/worktree-namespace.ts";

/** The scan roots, relative to the repo root — the AC's own two arguments. */
export const SCAN_ROOTS = ["packages/quay/src", "plugin/scripts"];

/** The single file allowed to hold the literal. */
export const RESOLVER_REL = "packages/quay/src/worktree-namespace.ts";

/** The declared name the single hit must ride on (the fallback branch's constant). */
export const DECLARATION_MARKER = "DEFAULT_WORKTREE_NAMESPACE_NAME";

const SKIP_DIRS = new Set(["node_modules", ".git"]);

export interface LiteralHit {
  /** Repo-relative path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The trimmed line content. */
  text: string;
}

export interface LiteralCheckReport {
  ok: boolean;
  /** The pattern actually searched — the double-quoted literal, built from the declaration, never spelled here. */
  pattern: string;
  /** Double-quoted-literal hits (the AC's predicate — must be ≤ 1). */
  hits: LiteralHit[];
  /** Advisory: unquoted occurrences of the same directory name (regexes/comments/prose). */
  advisory: LiteralHit[];
  /** Human-readable verdict. */
  reason: string;
}

/**
 * Scan `root` for the worktree-namespace literal. PURE w.r.t. the filesystem reads it performs;
 * never throws (an unreadable file is skipped).
 */
export function checkWorktreeNamespaceLiteral(root: string): LiteralCheckReport {
  const rootAbs = path.resolve(root);
  const name = DEFAULT_WORKTREE_NAMESPACE_NAME;
  const quoted = JSON.stringify(name); // the double-quoted form — the AC's exact pattern
  const hits: LiteralHit[] = [];
  const advisory: LiteralHit[] = [];
  const files = listFilesInRoots(rootAbs, SCAN_ROOTS, SKIP_DIRS);
  for (const abs of files) {
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!text.includes(name)) continue;
    const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(name)) continue;
      const hit: LiteralHit = { file: rel, line: i + 1, text: line.trim() };
      if (line.includes(quoted)) hits.push(hit);
      else advisory.push(hit);
    }
  }

  let ok = hits.length <= 1;
  let reason =
    hits.length === 0
      ? `no double-quoted ${quoted} in ${SCAN_ROOTS.join(" or ")} (≤1 — the resolver's declaration is absent or renamed)`
      : `1 double-quoted ${quoted}, at ${hits[0].file}:${hits[0].line}`;
  if (ok && hits.length === 1) {
    const h = hits[0];
    if (h.file !== RESOLVER_REL || !h.text.includes(DECLARATION_MARKER)) {
      ok = false;
      reason = `the single double-quoted ${quoted} is at ${h.file}:${h.line}, NOT the ${DECLARATION_MARKER} declaration in ${RESOLVER_REL} — a second reader is spelling the namespace name itself`;
    }
  } else if (hits.length > 1) {
    reason = `${hits.length} double-quoted ${quoted} sites (must be ≤1): ` +
      hits.map((h) => `${h.file}:${h.line}`).join(", ");
  }
  return { ok, pattern: quoted, hits, advisory, reason };
}

function main(argv: string[]): number {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i] ?? root;
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (a === "--json") json = true;
  }
  const report = checkWorktreeNamespaceLiteral(root);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(
      `worktree-namespace-literal-check: ${report.ok ? "PASS" : "FAIL"} — ${report.reason}\n` +
        `  advisory (unquoted, non-failing): ${report.advisory.length} occurrence(s)` +
        (report.advisory.length > 0
          ? "\n" + report.advisory.map((h) => `    ${h.file}:${h.line}`).join("\n")
          : "") +
        "\n",
    );
  }
  return report.ok ? 0 : 1;
}

const invokedDirectly = (() => {
  try {
    return isDirectEntry(import.meta, undefined, "worktree-namespace-literal-check");
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
