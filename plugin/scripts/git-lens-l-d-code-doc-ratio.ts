#!/usr/bin/env node
// git-lens-l-d-code-doc-ratio.ts — L_D (description-length) convergence proxy, ADR-007/exp5-M-CRYST-G1.
//
// Computes a code:doc line-delta ratio over a git commit range (or a synthetic fixture diffstat),
// and FLAGs when the delta is overwhelmingly new prose (the "molten prose > executable" failure
// mode ADR-006/007 name). This module IS the rule: pure functions consumed by the CLI (below) and
// wrappable, unchanged, by a future `quay gate --gate l-d` (M39 registry precedent — a named gate
// WRAPS this, never reimplements the logic). If this header and the code ever disagree, THE CODE
// WINS.
//
// ── The rule ────────────────────────────────────────────────────────────────────────────────────
// A file path is classified DOC if it matches /\.(md|txt)$/i, else CODE (this deliberately treats
// non-.md/.txt as code — .ts/.mjs/.sh/.yml/.json all count as "code" for this ratio, matching the
// spirit of "executable > prose"). Given per-file (added, deleted) line counts from a
// `git diff --numstat`-shaped input:
//   docLines  = sum(added+deleted) over DOC files
//   codeLines = sum(added+deleted) over CODE files
//   ratio     = docLines / codeLines   (Infinity if codeLines === 0 and docLines > 0; NaN if both 0)
// FLAG (prose-heavy) when ratio > FLAG_THRESHOLD (default 3.0 — i.e. more than 3x doc lines vs
// code lines changed) AND docLines > MIN_DOC_LINES (default 20 — avoid flagging trivial diffs).
// A milestone with codeLines === 0 and docLines > MIN_DOC_LINES is trivially FLAGGED (all-prose).
// A milestone with NO changes at all (both zero) reports verdict "N/A" — never a silent PASS.
//
// Usage:
//   git-lens-l-d-code-doc-ratio.ts <base-sha> <head-sha> [--repo-root <path>]
//   git-lens-l-d-code-doc-ratio.ts --numstat-file <file>   (fixture/offline mode — reads a
//     `git diff --numstat`-formatted file directly, added\tdeleted\tpath per line, `-` = binary)
//
// Exit codes: 0 = PASS (not flagged) or N/A (no changes); 1 = FLAGGED (prose-heavy).

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isDirectEntry } from './gate-script-base.ts';

export const FLAG_THRESHOLD = 3.0;
export const MIN_DOC_LINES = 20;

const DOC_RE = /\.(md|txt)$/i;

export interface NumstatRow {
  added: number;
  deleted: number;
  path: string;
}

export interface RatioResult {
  docLines: number;
  codeLines: number;
  ratio: number | null;
  verdict: string;
  flagged: boolean;
}

// ── parseNumstat — parse `git diff --numstat` text into [{added, deleted, path}] ─────────────────
// Binary files report `-\t-\tpath`; treated as 0 lines (not classifiable as doc/code text delta).
export function parseNumstat(text: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const [, addedRaw, deletedRaw, path] = m;
    const added = addedRaw === '-' ? 0 : parseInt(addedRaw, 10);
    const deleted = deletedRaw === '-' ? 0 : parseInt(deletedRaw, 10);
    rows.push({ added, deleted, path });
  }
  return rows;
}

// ── classify — DOC if path ends .md/.txt, else CODE ───────────────────────────────────────────────
export function classify(filePath: string): 'doc' | 'code' {
  return DOC_RE.test(filePath) ? 'doc' : 'code';
}

// ── computeRatio — the pure arithmetic + verdict, given parsed numstat rows ──────────────────────
export function computeRatio(rows: NumstatRow[], { flagThreshold = FLAG_THRESHOLD, minDocLines = MIN_DOC_LINES }: { flagThreshold?: number; minDocLines?: number } = {}): RatioResult {
  let docLines = 0;
  let codeLines = 0;
  for (const r of rows) {
    const total = r.added + r.deleted;
    if (classify(r.path) === 'doc') docLines += total;
    else codeLines += total;
  }
  if (docLines === 0 && codeLines === 0) {
    return { docLines, codeLines, ratio: null, verdict: 'N/A', flagged: false };
  }
  const ratio = codeLines === 0 ? Infinity : docLines / codeLines;
  const flagged = docLines > minDocLines && ratio > flagThreshold;
  return { docLines, codeLines, ratio, verdict: flagged ? 'FLAGGED (prose-heavy)' : 'PASS', flagged };
}

// ── gitNumstat — run `git diff --numstat base..head` for a real range ────────────────────────────
export function gitNumstat(base: string, head: string, repoRoot?: string): NumstatRow[] {
  const out = execFileSync('git', ['diff', '--numstat', `${base}..${head}`], {
    cwd: repoRoot || process.cwd(),
    encoding: 'utf8',
  });
  return parseNumstat(out);
}

function main(): void {
  const args = process.argv.slice(2);
  let rows: NumstatRow[];
  if (args[0] === '--numstat-file') {
    rows = parseNumstat(readFileSync(args[1], 'utf8'));
  } else {
    const [base, head] = args;
    let repoRoot: string | undefined;
    const idx = args.indexOf('--repo-root');
    if (idx !== -1) repoRoot = args[idx + 1];
    if (!base || !head) {
      console.error('Usage: git-lens-l-d-code-doc-ratio.ts <base-sha> <head-sha> [--repo-root <path>]');
      console.error('   or: git-lens-l-d-code-doc-ratio.ts --numstat-file <file>');
      process.exit(2);
    }
    rows = gitNumstat(base, head, repoRoot);
  }
  const result = computeRatio(rows);
  const ratioStr = result.ratio === null ? 'N/A' : result.ratio === Infinity ? 'Infinity' : result.ratio.toFixed(3);
  console.log(`L_D code:doc — docLines=${result.docLines} codeLines=${result.codeLines} ratio=${ratioStr} verdict=${result.verdict}`);
  process.exit(result.flagged ? 1 : 0);
}

if (isDirectEntry(import.meta, undefined, "git-lens-l-d-code-doc-ratio")) {
  main();
}
