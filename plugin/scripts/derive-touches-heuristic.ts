#!/usr/bin/env node --experimental-strip-types
// derive-touches-heuristic.ts — DIR-113 item 1: mechanical/heuristic `## Touches` extraction.
// When a milestone-candidate task body lacks a `## Touches` section, the cheap scheduling-time
// orthogonality check (checkTouchesPair, near-zero-cost) has nothing to work with UNTIL an
// expensive charter-authoring fork writes one. This module closes that gap: it scans a task
// body's prose for file-path-shaped tokens and generates a `## Touches` block explicitly labeled
// "auto-derived, unverified" — a SCHEDULING-TIME HINT ONLY.
//
// It is NEVER a substitute for `anti-drift-touches-check.ts`'s PRE-MERGE hard gate (DIR-113 item
// 5 — that gate is untouched by this module and by DIR-113 as a whole). A wrong/optimistic
// auto-derived guess can, at worst, make the scheduler batch something it shouldn't have (caught
// by anti-drift at fan-in) or fail to batch something it could have (conservative, safe) — it can
// never let a bad write land, because anti-drift checks ACTUAL `git diff --numstat` files, not
// any declaration.
//
// Pipeline:
//   1. extractPathTokens — pull every backtick-quoted token out of the body; split each span on
//      whitespace (task/charter prose sometimes crams multiple paths into one code span, e.g.
//      "packages/*/test/*.test.mjs plugin/test/*.test.mjs"); keep tokens that look like a path
//      (contain "/" OR end in a recognized file extension); drop overbroad glob noise via
//      isOverbroadDeclaration (single-source, ADR-004, imported from touches-orthogonality-check).
//   2. resolveBareFilenames — a token with no "/" (e.g. "serve-github.test.mjs", "CLAUDE.md") is
//      resolved against the REAL repo tree: exactly one file with that basename → expand to its
//      repo-relative path; zero or >1 matches → dropped (ambiguous/unresolvable — a wrong guess is
//      worse than an omission for a hint that must stay conservative).
//   3. deriveTouches — orchestrates 1+2, dedupes, sorts.
//   4. renderTouchesSection — formats the result as a `## Touches` markdown block.
//
// Pure functions exported + unit-tested; sibling test:
// derive-touches-heuristic-selfcheck.sh (execs `node --experimental-strip-types --test
// derive-touches-heuristic.test.ts`, following this directory's `<name>-selfcheck.sh` convention
// while the actual assertions live in a real node:test file for coverage measurability).

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOverbroadDeclaration, normalizePath } from "./touches-orthogonality-check.ts";
import { isDirectEntry } from "./gate-script-base.ts";
import { walkFiles, gitIgnoredPaths } from "./fs-walk.ts";

// Recognized file extensions for a BARE token (no "/") to be considered path-shaped at all.
const EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|md|yml|yaml|sh|json|py|txt|sql|css|html)$/i;

// Directory names skipped when walking the repo tree to resolve bare filenames. "worktrees" closes
// off the ephemeral `.claude/worktrees/*/CLAUDE.md` copies that would otherwise make "CLAUDE.md"
// resolve ambiguously (0/1 exactly-one-match rule would drop it as unresolvable).
const SKIP_DIR_NAMES = new Set([".git", "node_modules", ".quay", "worktrees", "dist", "coverage", ".cache"]);

// ── looksLikePath ────────────────────────────────────────────────────────────────────────────────
// A single (already-split, no whitespace) token is path-shaped iff it contains "/" (any depth) or
// ends in a recognized extension. Rejects tokens with shell/HTML-ish characters that indicate the
// backtick span was a command or tag, not a path.
export function looksLikePath(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false;
  if (/[<>|$"']/.test(t)) return false;
  if (t.includes("/")) return true;
  return EXT_RE.test(t);
}

// ── extractPathTokens ────────────────────────────────────────────────────────────────────────────
// Scan `text` (the full task body, or any subset of it a caller wants to restrict to) for
// backtick-quoted spans, split each on whitespace, and keep the path-shaped, non-overbroad tokens.
// Dedupes in encounter order.
export function extractPathTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const backtickRe = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(String(text)))) {
    for (const raw of m[1].split(/\s+/)) {
      let tok = raw.replace(/^\.\//, "").replace(/[,;:.]+$/, "");
      if (!looksLikePath(tok)) continue;
      if (isOverbroadDeclaration(tok)) continue; // drop glob noise, e.g. "packages/*/test/*.test.mjs"
      if (seen.has(tok)) continue;
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

// ── walkRepo ─────────────────────────────────────────────────────────────────────────────────────
// Repo-relative POSIX paths of every regular file under `root`, skipping SKIP_DIR_NAMES and
// whatever git reports ignored (see `gitIgnoredPaths` in fs-walk.ts — the skip-set names the
// traversal-specific dirs; `.gitignore` covers the project's own artifact roots, which no
// hardcoded list can enumerate).
export function walkRepo(root: string): string[] {
  // Unsorted on purpose (callers index this list); traversal is fs-walk.ts, the skip-set local.
  const ignored = gitIgnoredPaths(root);
  return walkFiles(root, {
    sort: false,
    prune: (name, isDir, rel) =>
      (isDir && SKIP_DIR_NAMES.has(name)) || ignored.has(rel) || ignored.has(`${rel}/`),
    include: (_name, _ext, entry) => entry!.isFile(),
  });
}

// ── resolveBareFilenames ─────────────────────────────────────────────────────────────────────────
// Tokens already containing "/" pass through unchanged. A bare token (no "/") resolves to its
// repo-relative path IFF exactly one file in `repoFiles` has that basename; 0 or >1 matches are
// reported as `unresolved` (dropped, not guessed).
export function resolveBareFilenames(
  tokens: string[],
  repoFiles: string[],
): { resolved: string[]; unresolved: string[] } {
  const byBasename = new Map<string, string[]>();
  for (const f of repoFiles) {
    const b = path.posix.basename(f);
    if (!byBasename.has(b)) byBasename.set(b, []);
    byBasename.get(b)!.push(f);
  }
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const t of tokens) {
    if (t.includes("/")) {
      resolved.push(t);
      continue;
    }
    const matches = byBasename.get(t) || [];
    if (matches.length === 1) resolved.push(matches[0]);
    else unresolved.push(t);
  }
  return { resolved, unresolved };
}

// ── deriveTouches ────────────────────────────────────────────────────────────────────────────────
// Full pipeline: extract tokens from `bodyText`, resolve bare filenames against `repoRoot`'s real
// tree, dedupe + sort. Returns the derived globs plus the unresolved bare tokens (for diagnostics —
// NOT silently swallowed).
export function deriveTouches(bodyText: string, repoRoot: string): { globs: string[]; unresolved: string[] } {
  const tokens = extractPathTokens(bodyText);
  const repoFiles = walkRepo(repoRoot);
  const { resolved, unresolved } = resolveBareFilenames(tokens, repoFiles);
  const globs = Array.from(new Set(resolved.map(normalizePath))).sort();
  return { globs, unresolved };
}

// ── renderTouchesSection ─────────────────────────────────────────────────────────────────────────
export function renderTouchesSection(globs: string[]): string {
  const lines = ["## Touches", "", "(auto-derived, unverified — mechanical extraction; review before relying on it)", ""];
  for (const g of globs) lines.push(`- \`${g}\``);
  return lines.join("\n") + "\n";
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("Usage: node --experimental-strip-types derive-touches-heuristic.ts <task-file.md> [--root <repoRoot>]");
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  let root: string | null = null;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && i + 1 < args.length) root = path.resolve(args[++i]);
    else if (args[i] === "--help" || args[i] === "-h") usage();
    else files.push(args[i]);
  }
  if (files.length !== 1) usage();
  let text: string;
  try {
    text = fs.readFileSync(files[0], "utf8");
  } catch (e: any) {
    console.error(`ERROR: cannot read ${files[0]}: ${e.message}`);
    return 2;
  }
  const resolvedRoot = root || repoRoot(path.resolve(path.dirname(files[0])));
  const { globs, unresolved } = deriveTouches(text, resolvedRoot);
  process.stdout.write(renderTouchesSection(globs));
  if (unresolved.length > 0) {
    console.error(`UNRESOLVED (dropped, ambiguous or not found on disk): ${unresolved.join(", ")}`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "derive-touches-heuristic")) {
  process.exit(main(process.argv));
}
