// registry-path-literal-check.ts — the AC5 static check for
// gap-registry-path-second-copy-five-checker-sites.
//
// THE INVARIANT: the checker REGISTRY's path has exactly ONE owner — the file-name constant
// `REGISTRY_BASENAME` and the two-layout candidate list `REGISTRY_REL_CANDIDATES` derived from it in
// `plugin/scripts/select-static-checks-for-touches.ts`, whose own header states it verbatim: "the ONE
// path literal in the repo … every layout's location is derived from it, so a second copy can never
// drift from it." Every other site derives the location FROM that declaration.
//
// A site that re-spells the path as three adjacent string literals is the defect re-growing (measured
// 2026-09-22: FIVE such second copies — axis-generator.ts, precommit-guard.ts, rhythm-consumer-check.ts
// ×2, verification-marginal-return.ts — all byte-identical to the declaration at the time, i.e. the
// declaration's enforcement power was ZERO; 硬规则 3b/9: nothing distinguished "obeyed" from
// "ignored"). Renaming the registry file, or moving the primary layout, would have drifted all five
// silently.
//
// THE PREDICATE IS THE AC's OWN GREP, not a paraphrase:
//   grep -rn <DQUOTE>plugin<DQUOTE>, <DQUOTE>scripts<DQUOTE>, <DQUOTE>runner-static-gate.ts<DQUOTE> \
//       plugin/scripts packages/quay/src   →   0 hits
// (the three adjacent double-quoted segments; the AC's exact pattern). NOTE the checker does NOT
// contain that sequence itself — the needle is BUILT from `REGISTRY_REL_CANDIDATES[0]` (each path
// segment JSON.stringify'd, joined into a whitespace-tolerant comma-separated group), so the check and
// the declaration share ONE source and the checker can never be its own false positive. This comment
// spells the quotes as <DQUOTE> for exactly that reason: any real quoted occurrence here would be
// counted by the scan it documents.
//
// THE THRESHOLD IS 0, not ≤1: the declaration derives the path with `path.posix.join(…, REGISTRY_BASENAME)`
// — an IDENTIFIER, not the joined literal — so no site in the repo is entitled to spell all three
// segments. (Contrast worktree-namespace-literal-check, whose allowed count is 1 because there the
// declaration itself holds the literal.)
//
// ADVISORY, NOT FAILING: the registry's bare FILE NAME also appears as DATA or in prose (a `find(1)
// -name` glob in publish-dist-branch.sh, the capability-catalog declaration tables' keys, comments).
// Those are reported with their locations so the sibling set is visible mechanically (硬规则 5b: 修好
// 一个 ≠ 只有一个) — but they are not a hard failure, because each has its own 口径 and its own
// owners, and 硬规则 2 says a mention in a string/data position is not a path copy.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/registry-path-literal-check.ts [--root <dir>] [--json]
// Exit: 0 = invariant holds (0 hits); 1 = at least one second copy is present.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { escapeRegExp } from "./regex-escape.ts";
// The recursive walk over the scan roots lives in fs-walk.ts (was a byte-identical private copy here
// and in serve-binding-literal-check.ts / worktree-namespace-literal-check.ts — finding
// `walkFiles-scan-surface-family`, routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1790995446200`). Only the traversal moved; SCAN_ROOTS and SKIP_DIRS are this
// checker's own.
import { listFilesInRoots } from "./fs-walk.ts";
// The registry's location has ONE owner — this module. The needle below is DERIVED from it, never
// spelled out (硬规则 1 用机件不手搓 / 5b 单源).
import { REGISTRY_BASENAME, REGISTRY_REL_CANDIDATES } from "./select-static-checks-for-touches.ts";

/** The scan roots, relative to the repo root — the AC's own two arguments. */
export const SCAN_ROOTS = ["plugin/scripts", "packages/quay/src"];

const SKIP_DIRS = new Set(["node_modules", ".git"]);

export interface LiteralHit {
  /** Repo-relative path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The trimmed line content. */
  text: string;
}

export interface RegistryLiteralReport {
  ok: boolean;
  /** The pattern actually searched — derived from the declaration, never spelled in a source file. */
  pattern: string;
  /** Sites that spell the registry path as adjacent string literals (the AC's predicate — must be 0). */
  hits: LiteralHit[];
  /** Advisory: the bare file name as data/prose (never a hard failure). */
  advisory: LiteralHit[];
  /** Human-readable verdict. */
  reason: string;
}

/**
 * The AC's predicate as a RegExp, built from the ONE declaration: each segment of the primary layout
 * JSON.stringify'd, joined by a whitespace-tolerant comma. Returns null when the declaration is
 * unreadable/empty — the caller turns that into an explicit not-evaluated verdict rather than a pass
 * (硬规则 3b: 读不懂 ≠ 合格).
 */
export function registryPathPattern(): RegExp | null {
  const primary = REGISTRY_REL_CANDIDATES?.[0];
  if (typeof primary !== "string" || primary.length === 0) return null;
  const segments = primary.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const parts = segments.map((s) => escapeRegExp(JSON.stringify(s)));
  return new RegExp(parts.join("\\s*,\\s*"));
}

/**
 * Scan `root` for a second copy of the registry path. PURE w.r.t. the filesystem reads it performs;
 * never throws (an unreadable file is skipped).
 *
 * Three-state, not boolean (硬规则 3b): a null pattern (the declaration could not be read) returns
 * `ok: false` with an explicit "not evaluated" reason — it is NEVER reported as a pass.
 */
export function checkRegistryPathLiteral(root: string): RegistryLiteralReport {
  const pattern = registryPathPattern();
  if (pattern === null) {
    return {
      ok: false,
      pattern: "",
      hits: [],
      advisory: [],
      reason:
        "NOT EVALUATED — could not derive the registry path pattern from REGISTRY_REL_CANDIDATES[0] in " +
        "plugin/scripts/select-static-checks-for-touches.ts (the single-source declaration is missing or empty)",
    };
  }
  const patternSrc = pattern.source;
  const rootAbs = path.resolve(root);
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
    if (!text.includes(REGISTRY_BASENAME)) continue;
    const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(REGISTRY_BASENAME)) continue;
      const hit: LiteralHit = { file: rel, line: i + 1, text: line.trim() };
      if (pattern.test(line)) hits.push(hit);
      else advisory.push(hit);
    }
  }
  const ok = hits.length === 0;
  const reason = ok
    ? `0 second copies of the registry path in ${SCAN_ROOTS.join(" or ")} (pattern ${patternSrc}) — ` +
      `the only owner is REGISTRY_BASENAME/REGISTRY_REL_CANDIDATES in select-static-checks-for-touches.ts`
    : `${hits.length} second copy/copies of the registry path (must be 0): ` +
      hits.map((h) => `${h.file}:${h.line}`).join(", ");
  return { ok, pattern: patternSrc, hits, advisory, reason };
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
  const report = checkRegistryPathLiteral(root);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    // The advisory set is a whole-repo sibling census (hard rule 5b), so it is long and mostly one
    // DATA file (the capability-catalog declaration table). Print a bounded head, keep it complete in
    // --json: a gate log flooded with 80 informational lines is a gate log nobody reads.
    // ⛔ NOT `*_CAP*`: that name is this repo's structural signal for a CONCURRENCY value
    // (concurrency-literal-check's CONCURRENCY_KEYWORD_RE), and this is a display bound, not one.
    const ADVISORY_PRINT_LIMIT = 8;
    const shown = report.advisory.slice(0, ADVISORY_PRINT_LIMIT);
    const hidden = report.advisory.length - shown.length;
    process.stdout.write(
      `registry-path-literal-check: ${report.ok ? "PASS" : "FAIL"} — ${report.reason}\n` +
        `  advisory (data/prose mentions, non-failing): ${report.advisory.length} occurrence(s)` +
        (shown.length > 0 ? "\n" + shown.map((h) => `    ${h.file}:${h.line}`).join("\n") : "") +
        (hidden > 0 ? `\n    … ${hidden} more (full list via --json)` : "") +
        "\n",
    );
  }
  return report.ok ? 0 : 1;
}

function invokedDirectly(): boolean {
  try {
    return isDirectEntry(import.meta, undefined, "registry-path-literal-check");
  } catch {
    return false;
  }
}
if (invokedDirectly()) process.exit(main(process.argv.slice(2)));
