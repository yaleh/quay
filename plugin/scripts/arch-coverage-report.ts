#!/usr/bin/env node
// arch-coverage-report.ts — 分析仪器覆盖面自报 / analyzer-coverage self-report.
// (tasks/gap-arch-coverage-self-report; orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md
//  §1.1 / §2 P6 / §5 Phase 0c)
//
// ── THE QUESTION THIS MAKES ASKABLE ───────────────────────────────────────────────────────────────
// For every language in this repo: WHO analyzed it, and HOW MUCH of it? Before this report the answer
// for most of the tree was unanswerable, and — worse — the unanswerable parts were indistinguishable
// from the clean parts:
//   • archguard's DEFAULT ("global") scope is whatever `.archguard/query/manifest.json` names as
//     `globalScopeKey`. Measured 2026-09-19 it is `packages/quay/src` (446 entities). `plugin/scripts`
//     (254 .ts, 2879 entities) and `experiments/…/scripts` (649 entities) live in SEPARATE scopes, so a
//     direct `archguard_summary` call does not see them at all — and prints nothing about not seeing them.
//   • `plugin/scripts` is modeled as a single `(root)` package, so `detect_cycles` returns `[]` on a tree
//     whose import graph has 3 SCCs. **The tool's output vocabulary has no "not evaluated" state** — so
//     "0 cycles" is read as "no cycles" (CLAUDE.md 硬规则 3b: a judge that cannot read its input must not
//     return a value shaped like the passing one).
//   • ~300 hand-written non-test `.mjs`/`.js` and 144 real `.sh` are not parsed by anything at all.
// This report exists so that "archguard reports 0 cycles" can no longer impersonate "there are no cycles".
//
// ── SIBLING, NOT DUPLICATE ────────────────────────────────────────────────────────────────────────
// `gap-archguard-scope-expand-provider-packages-experiments` (done) widened archguard's SCAN RANGE.
// This script does not repeat that: it reports the COVERAGE SURFACE — which languages/directories no
// scope reaches — and it changes nothing about archguard's configuration.
//
// ── REPORT ONLY, NEVER A GATE ─────────────────────────────────────────────────────────────────────
// exit 0 means "a report was produced", ⛔ NOT "everything is evaluated". This script is deliberately
// NOT wired into `runner-static-gate.ts`; a ratchet over it would be a different task. That is why its
// exit-code contract is its own (below) and does not reuse `gate-script-base`'s verdict→exit mapping
// (which maps not-evaluated→3; here "unevaluated input" is exit 2 per this task's output contract, and
// "report produced while some languages are unevaluated" is exit 0 by design).
//
// ── THREE DISTINGUISHABLE STATES (硬规则 3b) ───────────────────────────────────────────────────────
//   • `analyzed`        — the manifest exists AND the file's directory falls inside a registered scope.
//   • `NOT-EVALUATED`   — either (a) no manifest (`reason:"manifest-missing"`) or (b) no analyzer exists
//                         for that language at all (`reason:"no-analyzer"` for mjs/js/sh/py).
//   • `evaluated:false` — an input could not be READ (manifest present but unparseable, or git absent).
//                         This is NOT the same value as (a): a missing manifest is a reportable fact, an
//                         unreadable one means the report itself cannot be trusted. exit 2 for this one.
// The three never collapse into one another: (a) and (b) are per-row, (c) is top-level + non-zero exit.
//
// ── 口径 (the count caliber) ──────────────────────────────────────────────────────────────────────
// Data source is ALWAYS `git ls-files` — ⛔ never `find`. Measured: one `find` walked into
// `.claude/worktrees/*` and inflated the `.sh` count to 5213. The exclusion rules are declared ONCE in
// `EXCLUSION_RULES` below and echoed into every `--json` output so a reader can re-derive the number
// without reading this file. Note deliberately NO `/test/` rule — see `EXCLUSION_RULES.noteTestDirs`;
// the task's AC2 pins the caliber to its own independent command, which retains `test/`, `plugin/test/`
// and `packages/quay/test/`. Excluding them would drop 4 real `.sh` files and make this report disagree
// with the very command that verifies it.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/arch-coverage-report.ts [<root>] [--json]
//                                        [--archguard-manifest <path>] [--selftest]
//   <root>                    repo root to survey (default: repoRoot() upward walk from this file)
//   --archguard-manifest <p>  read the archguard scope manifest from <p> instead of
//                             <root>/.archguard/query/manifest.json. `.archguard/` is a GENERATED
//                             artifact (gitignored) and is therefore often absent from a task
//                             worktree while present in the main checkout — this flag is how a
//                             worktree reports the main checkout's real scope surface (AC3).
//   --json                    emit the report as JSON (pretty-printed; still one parseable document)
//   --selftest                run the injected fixture cases, print one line per case, exit 0/1
//
// Exit codes: 0 = report produced (some languages may be unevaluated — that is the report's content);
//             1 = --selftest had a failing case;
//             2 = NOT EVALUATED (manifest unparseable, or git unavailable) — ⛔ never conflated with 0;
//             3 = usage error.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { helpExit, isDirectEntry, createSelftest } from "./gate-script-base.ts";
import { repoRoot as findRepoRoot, mainCheckoutRoot } from "./repo-root.ts";

// ── Exit codes (see the header contract) ────────────────────────────────────────────────────────────
export const EXIT_OK = 0;
export const EXIT_SELFTEST_FAILED = 1;
export const EXIT_NOT_EVALUATED = 2;
export const EXIT_USAGE = 3;

export const REPORT_GENERATED_AT_PLACEHOLDER = "<generated-at>";

/** The archguard scope manifest, at its single canonical location under a repo root. */
export const DEFAULT_MANIFEST_REL = path.join(".archguard", "query", "manifest.json");

// ── Languages ───────────────────────────────────────────────────────────────────────────────────────
/** The language rows this report always emits — every one of them, even at 0 files (see AC1: a fixture
 *  with no `.sh` must yield a `sh` row with `trackedFiles:0`, NOT a missing row — an absent row and a
 *  zero row look the same to a reader who is counting rows, and that is the 硬规则 3b failure mode). */
export interface LanguageSpec {
  language: string;
  ext: string;
  /** null ⇒ no analyzer exists for this language today ⇒ every file is NOT-EVALUATED. */
  analyzer: string | null;
}

export const LANGUAGES: readonly LanguageSpec[] = [
  { language: "ts", ext: ".ts", analyzer: "archguard" },
  { language: "mjs", ext: ".mjs", analyzer: null },
  { language: "js", ext: ".js", analyzer: null },
  { language: "sh", ext: ".sh", analyzer: null },
  { language: "py", ext: ".py", analyzer: null },
];

// ── The count caliber, declared once ────────────────────────────────────────────────────────────────
export const EXCLUSION_RULES = {
  /** A file whose BASENAME contains this substring is a test file. */
  basenameContains: ".test.",
  /** A file having any of these as a whole path SEGMENT is excluded. Segment equality — not a
   *  substring test — is load-bearing: a substring test on `vendor` wrongly drops
   *  `plugin/scripts/sync-vendor.sh`, which is a real production script (measured: it is the one file
   *  that made a naive caliber read 139 instead of 144). */
  segments: ["node_modules", "dist", "vendor", "checker-mutation-cases"],
  /** Root-anchored only (mirrors the `grep -v '^archive/'` in the AC's own caliber command). */
  rootPrefixes: ["archive/"],
  /** ⛔ Deliberately NOT a rule. The task's Proposal prose lists `/test/` among the exclusions, but its
   *  AC2 pins `sh.trackedFiles` to the output of
   *  `git ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l`,
   *  a caliber that RETAINS `test/`, `plugin/test/` and `packages/quay/test/`. Applied together they
   *  disagree by exactly 4 files. The runnable AC wins over the prose (and, independently, a coverage
   *  census should count hand-written test-dir sources rather than hide them). Recorded here so the
   *  divergence is a declared decision, not a silent discrepancy. */
  noteTestDirs: "not excluded — AC2's caliber retains test/ dirs (see this field's doc comment)",
} as const;

/** True iff `rel` (a repo-relative, `/`-separated path) is excluded from the language census. */
export function isExcluded(rel: string): boolean {
  const segs = rel.split("/");
  const base = segs[segs.length - 1] ?? "";
  if (base.includes(EXCLUSION_RULES.basenameContains)) return true;
  for (const s of segs) if ((EXCLUSION_RULES.segments as readonly string[]).includes(s)) return true;
  for (const p of EXCLUSION_RULES.rootPrefixes) if (rel.startsWith(p)) return true;
  return false;
}

// ── Input collection ────────────────────────────────────────────────────────────────────────────────
export interface TrackedFilesResult {
  ok: boolean;
  files: string[];
  error?: string;
}

/** List every git-tracked file under `root`, repo-relative, `/`-separated, sorted. ⛔ `git ls-files`,
 *  never `find` (a `find` once walked `.claude/worktrees/*` and reported 5213 `.sh` files). */
export function listTrackedFiles(root: string): TrackedFilesResult {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const files = out
      .split("\0")
      .filter((s) => s !== "")
      .map((s) => s.split(path.sep).join("/"))
      .sort();
    return { ok: true, files };
  } catch (e: any) {
    return { ok: false, files: [], error: String(e?.stderr ?? e?.message ?? e) };
  }
}

/** The census: language → its tracked, non-excluded files (sorted). Every declared language appears,
 *  including at 0 files. */
export function censusFiles(tracked: readonly string[]): Map<string, string[]> {
  const kept = tracked.filter((f) => !isExcluded(f));
  const byLang = new Map<string, string[]>();
  for (const spec of LANGUAGES) byLang.set(spec.language, []);
  for (const f of kept) {
    const spec = LANGUAGES.find((s) => f.endsWith(s.ext));
    if (spec) byLang.get(spec.language)!.push(f);
  }
  return byLang;
}

// ── archguard manifest ──────────────────────────────────────────────────────────────────────────────
export interface RawScope {
  key: string;
  label?: string;
  sources: string[];
  entityCount: number;
}
export interface RawManifest {
  globalScopeKey: string | null;
  scopes: RawScope[];
}

export type ManifestParse =
  | { ok: true; manifest: RawManifest }
  | { ok: false; reason: string };

/** Parse a manifest's text. A parse failure, or a structurally unreadable manifest, is `ok:false` —
 *  never an empty-but-valid manifest (硬规则 3b: "cannot read it" must not look like "read it, found
 *  nothing"). */
export function parseManifestText(text: string): ManifestParse {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, reason: `manifest is not valid JSON: ${e?.message ?? e}` };
  }
  if (raw === null || typeof raw !== "object" || !Array.isArray(raw.scopes)) {
    return { ok: false, reason: "manifest has no `scopes` array" };
  }
  const scopes: RawScope[] = [];
  for (const s of raw.scopes) {
    if (s === null || typeof s !== "object" || typeof s.key !== "string" || !Array.isArray(s.sources)) {
      return { ok: false, reason: `manifest scope entry is malformed (need string key + sources array)` };
    }
    scopes.push({
      key: s.key,
      label: typeof s.label === "string" ? s.label : undefined,
      sources: s.sources.filter((x: unknown) => typeof x === "string"),
      entityCount: typeof s.entityCount === "number" ? s.entityCount : 0,
    });
  }
  return {
    ok: true,
    manifest: { globalScopeKey: typeof raw.globalScopeKey === "string" ? raw.globalScopeKey : null, scopes },
  };
}

/**
 * Canonicalize a path for COMPARISON: resolve symlinks when the path exists, else fall back to
 * `path.resolve` (a source directory that has since been deleted must still compare, not throw).
 *
 * WHY THIS IS NEEDED (gap-suite-ambient-reds-block-all-code-landings, class 3): the same directory
 * is reachable by two spellings on this host — `/data/home/yale/work/quay` (the realpath) and
 * `/home/yale/work/quay` (a symlink created 2026-09-19). The generated `.archguard/query/manifest.json`
 * records `sources` in the SYMLINK spelling (the analyzer was invoked through it), while the report's
 * own root is the REALPATH spelling. `startsWith(base + sep)` then misses, and the two sides are
 * normalized by different rules — so the comparison silently stops measuring path identity and starts
 * measuring path SPELLING (硬规则 4b). Realpathing both sides before comparing makes the reading
 * invariant under the symlink, which is the property the caller actually wants.
 * ⛔ NOT fixed by deleting `.archguard/` and regenerating: the analyzer would write the symlink
 * spelling again (that is the path it is invoked through), so the defect would only move later.
 */
export function canonicalPath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Turn an absolute manifest source into a repo-relative `/`-separated path.
 *
 * WHY THIS IS NEEDED: `.archguard/` is generated at the MAIN CHECKOUT and its `sources` are absolute
 * paths under that checkout. This report is frequently run from a task worktree, whose root is a
 * different directory — a first fix would be to string-compare, which would then report "every .ts
 * file is uncovered" purely because the paths disagree. So a source is relativized against (a) the
 * report root, (b) the main checkout root, and only then (c) by longest-existing-suffix.
 *
 * Both sides go through `canonicalPath` first (class 3): without it, a manifest written through the
 * `/home/yale/...` symlink and a root resolved to `/data/home/yale/...` never match at (a)/(b), and
 * the answer is produced by the (c) suffix fallback alone — correct by luck rather than by rule.
 */
export function relativizeSource(source: string, root: string, mainRoot: string): string {
  const norm = canonicalPath(source);
  const bases = [root, mainRoot].filter((b) => typeof b === "string" && b !== "");
  for (const b of bases) {
    const base = canonicalPath(b);
    if (norm === base) return ""; // the source IS a root ⇒ covers everything under it
    if (norm.startsWith(base + path.sep)) return norm.slice(base.length + 1).split(path.sep).join("/");
  }
  // Fallback: the longest suffix of the source that actually exists under `root`.
  const segs = norm.split(path.sep).filter((s) => s !== "");
  for (let i = 0; i < segs.length; i++) {
    const cand = segs.slice(i).join("/");
    if (cand !== "" && fs.existsSync(path.join(root, cand))) return cand;
  }
  return norm.split(path.sep).join("/"); // unmatcheable — kept verbatim so it is visibly not a repo path
}

/** True iff a directory (repo-relative, "" = repo root) is inside a scope source. */
export function dirInsideSource(dir: string, source: string): boolean {
  if (source === "") return true;
  return dir === source || dir.startsWith(source + "/");
}

/** The directory of a repo-relative file path, or "" for a root-level file. */
export function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}

/** The scope whose source is the LONGEST match for `dir` (most-specific wins), or null. */
export function mostSpecificScope(dir: string, scopes: Array<{ key: string; relSources: string[] }>): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const s of scopes) {
    for (const src of s.relSources) {
      if (dirInsideSource(dir, src) && src.length > bestLen) {
        best = s.key;
        bestLen = src.length;
      }
    }
  }
  return best;
}

// ── Report shape ────────────────────────────────────────────────────────────────────────────────────
export interface LanguageRow {
  language: string;
  /** null ⇒ the file list could not be read (`git` unavailable), so this is NOT a count of zero —
   *  ⛔ `0` here would be the exact 硬规则 3b failure this report exists to kill: "no files of this
   *  language" is a reading, "could not count" is not. Both AC-pinned `trackedFiles` assertions
   *  (`sh` row present at 0 in a `.sh`-free fixture; `trackedFiles>0` on the real repo) are made in
   *  the evaluated case, where this is always a number. */
  trackedFiles: number | null;
  /** The scope key attributed to this language, or null when nothing analyzes it. */
  analyzedBy: string | null;
  status: "analyzed" | "NOT-EVALUATED";
  /** Present whenever there is something to say; the two AC-pinned values are `"manifest-missing"` and
   *  `"no-analyzer"`. */
  reason?: string;
  /** Fraction of this language's truncated files covered by a registered scope (ts only; null elsewhere
   *  or when not evaluable). */
  coverageFraction?: number | null;
  /** Every scope key covering ≥1 file of this language (ts only). */
  analyzedByScopeKeys?: string[];
}

export interface ScopeRow {
  key: string;
  label: string | null;
  /** Sources as repo-relative paths — AC3 pins this to `packages/quay/src` for the global scope. */
  sources: string[];
  /** The manifest's verbatim values, kept so nothing is lost by the relativization. */
  rawSources: string[];
  entityCount: number;
  /** Tracked non-test .ts files attributed to THIS scope (most-specific attribution). */
  tsFiles: number;
}

export interface ArchguardSection {
  manifestFound: boolean;
  manifestPath: string;
  manifestParsed: boolean;
  globalScopeKey: string | null;
  globalScopeResolved: boolean;
  globalScopeSources: string[];
  /** covered-by-global-scope / all tracked non-test .ts — AC3 pins "< 1" as the finding. null when the
   *  manifest (or its global scope) is unavailable, ⛔ never 0 (0 would read as "the global scope
   *  covers nothing", which is a different and much stronger claim). */
  globalScopeCoversTsFraction: number | null;
  scopes: ScopeRow[];
}

export interface Report {
  evaluated: boolean;
  generatedAt: string;
  root: string;
  runner: string;
  exclusionRules: typeof EXCLUSION_RULES;
  languages: LanguageRow[];
  archguard: ArchguardSection;
  /** Directories of tracked non-test .ts files that NO scope covers. See `uncoveredTsDirsEvaluated`. */
  uncoveredTsDirs: string[];
  /** false ⇒ `uncoveredTsDirs` is empty because nothing was evaluable, ⛔ NOT because nothing is
   *  uncovered (硬规则 3b — the two must not share one value). */
  uncoveredTsDirsEvaluated: boolean;
  /** All four are null when the file list could not be read (see `LanguageRow.trackedFiles`). */
  totals: {
    trackedFiles: number | null;
    countedFiles: number | null;
    analyzedFiles: number | null;
    notEvaluatedFiles: number | null;
  };
  /** Set only when `evaluated === false`. */
  error?: string;
  /** Set only when `evaluated === false`. */
  reason?: string;
}

export interface BuildInput {
  root: string;
  tracked: readonly string[];
  manifestFound: boolean;
  manifestPath: string;
  manifest: RawManifest | null;
  manifestError?: string;
  manifestParseFailed?: boolean;
  now?: string;
  gitError?: string;
}

/** The pure core: everything except reading git / the filesystem. Kept pure so the selftest can inject
 *  every state directly rather than through the filesystem. */
export function buildReport(input: BuildInput): Report {
  const root = path.resolve(input.root);
  const byLang = censusFiles(input.tracked);
  const tsFiles = byLang.get("ts") ?? [];

  // ── evaluated? Two independent ways to be unable to read an input. ──────────────────────────────
  const gitOk = input.gitError === undefined;
  const manifestReadable = !input.manifestParseFailed;
  const evaluated = gitOk && manifestReadable;

  // ── archguard scope surface ─────────────────────────────────────────────────────────────────────
  const emptyArchguard: ArchguardSection = {
    manifestFound: input.manifestFound,
    manifestPath: input.manifestPath,
    manifestParsed: false,
    globalScopeKey: null,
    globalScopeResolved: false,
    globalScopeSources: [],
    globalScopeCoversTsFraction: null,
    scopes: [],
  };
  let archguard = emptyArchguard;
  let uncoveredTsDirs: string[] = [];
  let uncoveredTsDirsEvaluated = false;

  if (input.manifest) {
    const mainRoot = safeMainCheckoutRoot(root);
    const scopes: ScopeRow[] = input.manifest.scopes.map((s) => ({
      key: s.key,
      label: s.label ?? null,
      sources: s.sources.map((src) => relativizeSource(src, root, mainRoot)),
      rawSources: [...s.sources],
      entityCount: s.entityCount,
      tsFiles: 0,
    }));
    const scopeRefs = scopes.map((s) => ({ key: s.key, relSources: s.sources }));

    // Per-file attribution: the most specific covering scope.
    const attribution = new Map<string, string | null>();
    for (const f of tsFiles) attribution.set(f, mostSpecificScope(dirOf(f), scopeRefs));
    for (const [f, key] of attribution) {
      if (key === null) continue;
      const row = scopes.find((s) => s.key === key);
      if (row) row.tsFiles++;
    }

    const globalKey = input.manifest.globalScopeKey;
    const globalScope = globalKey === null ? undefined : scopes.find((s) => s.key === globalKey);
    const globalScopeResolved = globalScope !== undefined;
    const globalCovered = globalScope
      ? tsFiles.filter((f) => globalScope.sources.some((src) => dirInsideSource(dirOf(f), src))).length
      : 0;

    const uncovered = [...new Set(tsFiles.filter((f) => attribution.get(f) === null).map(dirOf))].sort();
    uncoveredTsDirs = uncovered;
    uncoveredTsDirsEvaluated = true;

    archguard = {
      manifestFound: true,
      manifestPath: input.manifestPath,
      manifestParsed: true,
      globalScopeKey: globalKey,
      globalScopeResolved,
      globalScopeSources: globalScope ? [...globalScope.sources] : [],
      globalScopeCoversTsFraction: globalScope ? (tsFiles.length === 0 ? 0 : globalCovered / tsFiles.length) : null,
      scopes,
    };
  }

  // ── language rows ───────────────────────────────────────────────────────────────────────────────
  const countable = input.gitError === undefined;
  const languages: LanguageRow[] = LANGUAGES.map((spec) => {
    const files = byLang.get(spec.language) ?? [];
    if (!countable) {
      // No file list ⇒ no count and no analyzer attribution. A row is still emitted so the language
      // set is visible, but every value is null/unreadable rather than a zero that would read clean.
      return {
        language: spec.language,
        trackedFiles: null,
        analyzedBy: null,
        status: "NOT-EVALUATED" as const,
        reason: "git-unavailable",
        coverageFraction: null,
      };
    }
    if (spec.analyzer === null) {
      return {
        language: spec.language,
        trackedFiles: files.length,
        analyzedBy: null,
        status: "NOT-EVALUATED" as const,
        reason: "no-analyzer",
        coverageFraction: null,
      };
    }
    // spec.analyzer === "archguard" (the only analyzer today).
    if (!input.manifestFound) {
      return {
        language: spec.language,
        trackedFiles: files.length,
        analyzedBy: null,
        status: "NOT-EVALUATED" as const,
        reason: "manifest-missing",
        coverageFraction: null,
      };
    }
    if (input.manifestParseFailed) {
      return {
        language: spec.language,
        trackedFiles: files.length,
        analyzedBy: null,
        status: "NOT-EVALUATED" as const,
        reason: "manifest-unreadable",
        coverageFraction: null,
      };
    }
    const covered = files.filter((f) => (archguard.scopes.length > 0 ? mostSpecificScope(dirOf(f), archguard.scopes.map((s) => ({ key: s.key, relSources: s.sources }))) : null) !== null).length;
    // The row's single attributed analyzer: the scope covering the most files of this language
    // (deterministic ties by key), falling back to the resolved global scope key when it covers ≥1 file.
    const counts = new Map<string, number>();
    for (const f of files) {
      const k = mostSpecificScope(dirOf(f), archguard.scopes.map((s) => ({ key: s.key, relSources: s.sources })));
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    const globalCovers = archguard.globalScopeResolved
      ? files.filter((f) => archguard.globalScopeSources.some((src) => dirInsideSource(dirOf(f), src))).length
      : 0;
    const analyzedBy =
      archguard.globalScopeResolved && globalCovers > 0 ? archguard.globalScopeKey : (ranked[0]?.[0] ?? null);
    const fraction = files.length === 0 ? 1 : covered / files.length;
    const reason =
      covered === files.length
        ? `fully-covered: all ${files.length} tracked non-test ${spec.language} file(s) fall inside a registered archguard scope` +
          (archguard.globalScopeResolved
            ? `; the GLOBAL scope ${archguard.globalScopeKey} alone covers ${globalCovers}/${files.length}`
            : "; the manifest declares no resolvable global scope")
        : `partial-coverage: ${covered}/${files.length} tracked non-test ${spec.language} file(s) (${(fraction * 100).toFixed(1)}%) fall inside any registered archguard scope` +
          (archguard.globalScopeResolved
            ? `; the GLOBAL scope ${archguard.globalScopeKey} alone covers ${globalCovers}/${files.length} (${((globalCovers / files.length) * 100).toFixed(1)}%)`
            : "") +
          `; ${uncoveredTsDirs.length} director${uncoveredTsDirs.length === 1 ? "y" : "ies"} uncovered`;
    return {
      language: spec.language,
      trackedFiles: files.length,
      analyzedBy,
      status: "analyzed" as const,
      reason,
      coverageFraction: fraction,
      analyzedByScopeKeys: ranked.map(([k]) => k),
    };
  });

  const countedFiles = countable ? [...byLang.values()].reduce((a, b) => a + b.length, 0) : null;
  const analyzedFiles = countable
    ? languages.filter((l) => l.status === "analyzed").reduce((a, l) => a + (l.trackedFiles ?? 0), 0)
    : null;
  const notEvaluatedFiles = countable ? countedFiles! - analyzedFiles! : null;

  const report: Report = {
    evaluated,
    generatedAt: input.now ?? new Date().toISOString(),
    root,
    runner: "arch-coverage-report.ts",
    exclusionRules: EXCLUSION_RULES,
    languages,
    archguard,
    uncoveredTsDirs,
    uncoveredTsDirsEvaluated,
    totals: {
      trackedFiles: countable ? input.tracked.length : null,
      countedFiles,
      analyzedFiles,
      notEvaluatedFiles,
    },
  };
  if (!evaluated) {
    report.reason = input.gitError !== undefined ? "not-a-git-worktree" : "manifest-unreadable";
    report.error =
      input.gitError !== undefined
        ? `git ls-files failed in ${root}: ${input.gitError.trim().split("\n")[0] ?? ""}`
        : `archguard manifest at ${input.manifestPath} could not be parsed: ${input.manifestError ?? "unknown"}`;
  }
  return report;
}

/** mainCheckoutRoot never throws, but a broken `git` could still surprise us; a report must not die
 *  because an optional relativization aid failed. */
function safeMainCheckoutRoot(startDir: string): string {
  try {
    return mainCheckoutRoot(startDir);
  } catch {
    return "";
  }
}

// ── The impure driver ───────────────────────────────────────────────────────────────────────────────
export interface RunOptions {
  root: string;
  manifestPath?: string;
  now?: string;
}

export interface RunResult {
  report: Report;
  exitCode: number;
}

export function runReport(opts: RunOptions): RunResult {
  const root = path.resolve(opts.root);
  const manifestPath = opts.manifestPath ? path.resolve(opts.manifestPath) : path.join(root, DEFAULT_MANIFEST_REL);

  const listed = listTrackedFiles(root);
  const manifestFound = fs.existsSync(manifestPath);

  let manifest: RawManifest | null = null;
  let manifestError: string | undefined;
  let manifestParseFailed = false;
  if (manifestFound) {
    const parsed = parseManifestText(readFileOrEmpty(manifestPath));
    if (parsed.ok) manifest = parsed.manifest;
    else {
      manifestParseFailed = true;
      manifestError = parsed.reason;
    }
  }

  const report = buildReport({
    root,
    tracked: listed.files,
    manifestFound,
    manifestPath,
    manifest,
    manifestError,
    manifestParseFailed,
    gitError: listed.ok ? undefined : (listed.error ?? "unknown git failure"),
    now: opts.now,
  });

  return { report, exitCode: report.evaluated ? EXIT_OK : EXIT_NOT_EVALUATED };
}

function readFileOrEmpty(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// ── Human-readable rendering ────────────────────────────────────────────────────────────────────────
export function renderHuman(report: Report): string {
  const lines: string[] = [];
  lines.push(`arch-coverage-report — ${report.root}`);
  lines.push(`evaluated: ${report.evaluated}${report.reason ? `  (reason: ${report.reason})` : ""}`);
  lines.push("");
  lines.push("language   tracked  status         analyzedBy  reason");
  for (const l of report.languages) {
    lines.push(
      `${l.language.padEnd(10)} ${(l.trackedFiles === null ? "-" : String(l.trackedFiles)).padStart(7)}  ${l.status.padEnd(13)}  ${(l.analyzedBy ?? "-").padEnd(10)}  ${l.reason ?? ""}`,
    );
  }
  lines.push("");
  const a = report.archguard;
  lines.push(`archguard manifest: ${a.manifestFound ? a.manifestPath : "NOT FOUND"}`);
  lines.push(`  global scope key:  ${a.globalScopeKey ?? "-"}  resolved=${a.globalScopeResolved}`);
  lines.push(`  global sources:    ${a.globalScopeSources.length > 0 ? a.globalScopeSources.join(", ") : "-"}`);
  lines.push(
    `  global covers ts:  ${a.globalScopeCoversTsFraction === null ? "not evaluable" : `${(a.globalScopeCoversTsFraction * 100).toFixed(1)}%`}`,
  );
  lines.push(`  scopes (${a.scopes.length}):`);
  for (const s of a.scopes) {
    lines.push(`    ${s.key}  entities=${String(s.entityCount).padStart(6)}  tsFiles=${String(s.tsFiles).padStart(4)}  ${s.sources.join(", ")}`);
  }
  lines.push("");
  lines.push(
    `uncovered .ts dirs (${report.uncoveredTsDirsEvaluated ? report.uncoveredTsDirs.length : "NOT EVALUATED"}): ${
      report.uncoveredTsDirsEvaluated ? (report.uncoveredTsDirs.length > 0 ? report.uncoveredTsDirs.join(", ") : "(none)") : "-"
    }`,
  );
  lines.push(
    `totals: tracked=${report.totals.trackedFiles} counted=${report.totals.countedFiles} analyzed=${report.totals.analyzedFiles} notEvaluated=${report.totals.notEvaluatedFiles}`,
  );
  if (!report.evaluated) lines.push(`ERROR: ${report.error}`);
  return lines.join("\n");
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────────────
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "arch-coverage-report fixture",
  GIT_AUTHOR_EMAIL: "arch-coverage-report@example.invalid",
  GIT_COMMITTER_NAME: "arch-coverage-report fixture",
  GIT_COMMITTER_EMAIL: "arch-coverage-report@example.invalid",
};

function gitFixtureInit(dir: string): void {
  execFileSync("git", ["-C", dir, "init", "-q"], { env: GIT_ENV, stdio: "ignore" });
}
function gitFixtureCommitAll(dir: string): void {
  execFileSync("git", ["-C", dir, "add", "-A"], { env: GIT_ENV, stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "fixture"], { env: GIT_ENV, stdio: "ignore" });
}
function writeFixture(dir: string, rel: string, body = "// fixture\n"): void {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

/**
 * The injected-case harness for `--selftest`. Every case injects a state and asserts the DISTINGUISHING
 * value — most importantly that the "cannot judge" states never collapse into the "judged clean" one.
 * Returns true when every case passed.
 */
export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-coverage-selftest-"));

  // ── Fixture A: a real git repo carrying ts in two dirs, an mjs, and NO .sh at all. ───────────────
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  writeFixture(repo, "packages/quay/src/a.ts");
  writeFixture(repo, "packages/quay/src/b.ts");
  writeFixture(repo, "plugin/scripts/c.ts");
  writeFixture(repo, "src/x.mjs");
  writeFixture(repo, "README.md");
  gitFixtureInit(repo);
  gitFixtureCommitAll(repo);

  const partialManifest = JSON.stringify({
    version: "1.0",
    globalScopeKey: "SCOPE_GLOBAL",
    scopes: [
      { key: "SCOPE_GLOBAL", label: "src (typescript)", sources: [path.join(repo, "packages/quay/src")], entityCount: 2 },
    ],
  });
  const manifestPath = path.join(tmp, "manifest.json");
  const badManifestPath = path.join(tmp, "manifest-bad.json");

  // case 1 — manifest missing ⇒ the ts row is NOT-EVALUATED with reason manifest-missing, NOT analyzed.
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const ts = r.report.languages.find((l) => l.language === "ts")!;
    check(
      "manifest-missing-ts-is-not-evaluated",
      ts.status === "NOT-EVALUATED" && ts.reason === "manifest-missing" && ts.analyzedBy === null,
      `status=${ts.status} reason=${ts.reason} analyzedBy=${ts.analyzedBy}`,
    );
    check("manifest-missing-still-evaluated-and-exit-0", r.report.evaluated === true && r.exitCode === 0, `evaluated=${r.report.evaluated} exit=${r.exitCode}`);
  }

  // case 2 — a manifest whose only scope is packages/quay/src, while plugin/scripts/*.ts exists
  //          ⇒ uncoveredTsDirs names plugin/scripts.
  {
    fs.writeFileSync(manifestPath, partialManifest);
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const ts = r.report.languages.find((l) => l.language === "ts")!;
    check(
      "scope-covers-only-quay-src-leaves-plugin-scripts-uncovered",
      r.report.uncoveredTsDirs.includes("plugin/scripts") && r.report.uncoveredTsDirsEvaluated === true,
      `uncoveredTsDirs=${JSON.stringify(r.report.uncoveredTsDirs)}`,
    );
    check(
      "partial-coverage-ts-row-analyzed-with-reason",
      ts.status === "analyzed" && ts.analyzedBy === "SCOPE_GLOBAL" && (ts.coverageFraction ?? 1) < 1 && /partial-coverage/.test(ts.reason ?? ""),
      `status=${ts.status} analyzedBy=${ts.analyzedBy} frac=${ts.coverageFraction}`,
    );
    check(
      "partial-coverage-drops-out-of-uncovered-when-scope-widened",
      (() => {
        const wide = JSON.stringify({
          version: "1.0",
          globalScopeKey: "SCOPE_GLOBAL",
          scopes: [
            { key: "SCOPE_GLOBAL", label: "all", sources: [repo], entityCount: 3 },
          ],
        });
        const widePath = path.join(tmp, "manifest-wide.json");
        fs.writeFileSync(widePath, wide);
        const rr = runReport({ root: repo, manifestPath: widePath, now: "T" });
        return rr.report.uncoveredTsDirs.length === 0 && rr.report.uncoveredTsDirsEvaluated === true;
      })(),
      "a scope rooted at the repo root must leave nothing uncovered",
    );
  }

  // case 3 — a repo with no .sh at all ⇒ the sh row is PRESENT with trackedFiles 0 (not absent).
  {
    const sh = (() => {
      const r = runReport({ root: repo, manifestPath, now: "T" });
      return r.report.languages.find((l) => l.language === "sh");
    })();
    check(
      "no-sh-files-yields-a-zero-row-not-a-missing-row",
      sh !== undefined && sh.trackedFiles === 0,
      `shRow=${JSON.stringify(sh)}`,
    );
  }

  // case 4 — an .mjs exists ⇒ its row is NOT-EVALUATED with reason no-analyzer, and trackedFiles > 0.
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const mjs = r.report.languages.find((l) => l.language === "mjs")!;
    check(
      "mjs-present-is-not-evaluated-no-analyzer",
      mjs.status === "NOT-EVALUATED" && mjs.reason === "no-analyzer" && mjs.trackedFiles > 0 && mjs.analyzedBy === null,
      `trackedFiles=${mjs.trackedFiles} status=${mjs.status} reason=${mjs.reason}`,
    );
  }

  // case 5 — a manifest that is BAD JSON ⇒ evaluated:false and exit 2 (NOT 0, NOT 3, NOT a silent 0-file
  //          reading of the scopes).
  {
    fs.writeFileSync(badManifestPath, "{ this is not json");
    const r = runReport({ root: repo, manifestPath: badManifestPath, now: "T" });
    const ts = r.report.languages.find((l) => l.language === "ts")!;
    check(
      "bad-json-manifest-is-not-evaluated-with-exit-2",
      r.report.evaluated === false && r.exitCode === 2 && r.report.reason === "manifest-unreadable",
      `evaluated=${r.report.evaluated} exit=${r.exitCode} reason=${r.report.reason}`,
    );
    check(
      "bad-json-manifest-does-not-look-like-an-empty-scope-list",
      ts.status === "NOT-EVALUATED" && ts.reason === "manifest-unreadable" && r.report.uncoveredTsDirsEvaluated === false,
      `tsReason=${ts.reason} uncoveredEvaluated=${r.report.uncoveredTsDirsEvaluated}`,
    );
  }

  // case 6 — a directory that is not a git worktree ⇒ exit 2.
  {
    const nonGit = path.join(tmp, "not-git");
    fs.mkdirSync(nonGit, { recursive: true });
    writeFixture(nonGit, "packages/quay/src/a.ts");
    const r = runReport({ root: nonGit, manifestPath, now: "T" });
    check(
      "non-git-directory-is-not-evaluated-with-exit-2",
      r.report.evaluated === false && r.exitCode === 2 && r.report.reason === "not-a-git-worktree",
      `evaluated=${r.report.evaluated} exit=${r.exitCode} reason=${r.report.reason}`,
    );
    // The rows must not read as "zero files of every language" — an uncountable row carries null.
    check(
      "non-git-directory-rows-are-null-not-zero",
      r.report.languages.length === LANGUAGES.length &&
        r.report.languages.every((l) => l.trackedFiles === null && l.status === "NOT-EVALUATED" && l.reason === "git-unavailable") &&
        r.report.totals.countedFiles === null,
      `rows=${JSON.stringify(r.report.languages.map((l) => [l.language, l.trackedFiles]))}`,
    );
  }

  // case 7 — the count caliber: an excluded-named path does not enter the census, and a
  //          segment-substring false positive (`sync-vendor.sh`) does NOT get excluded.
  {
    check(
      "exclusion-caliber-is-segment-based-not-substring",
      isExcluded("plugin/scripts/sync-vendor.sh") === false &&
        isExcluded("plugin/scripts/checker-mutation-cases/x.sh") === true &&
        isExcluded("a/b/node_modules/c.ts") === true &&
        isExcluded("packages/quay/src/a.test.ts") === true &&
        isExcluded("archive/old/plugin/scripts/y.sh") === true &&
        isExcluded("plugin/test/delivery.sh") === false &&
        isExcluded("test/e2e.sh") === false,
      "sync-vendor.sh must survive a `vendor` segment rule; test/ dirs are retained by the AC2 caliber",
    );
  }

  // case 8 — a source given as an ABSOLUTE path under a DIFFERENT root (the worktree case) is still
  //          relativized to a repo-relative path, so coverage is not falsely reported as zero.
  {
    check(
      "absolute-foreign-root-source-is-relativized",
      relativizeSource("/somewhere/else/packages/quay/src", repo, "/somewhere/else") === "packages/quay/src",
      `got=${relativizeSource("/somewhere/else/packages/quay/src", repo, "/somewhere/else")}`,
    );
    check(
      "relativized-source-is-a-repo-relative-path",
      (() => {
        const m = JSON.parse(partialManifest);
        const r = runReport({ root: repo, manifestPath, now: "T" });
        void m;
        return r.report.archguard.globalScopeSources.length === 1 && r.report.archguard.globalScopeSources[0] === "packages/quay/src";
      })(),
      JSON.stringify(runReport({ root: repo, manifestPath, now: "T" }).report.archguard.globalScopeSources),
    );
  }

  // case 9 — the global-scope fraction is a real reading: a partial global scope gives < 1, and an
  //          unresolvable globalScopeKey gives null (⛔ never 0, which would read as "covers nothing").
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const unresolved = (() => {
      const p = path.join(tmp, "manifest-no-global.json");
      fs.writeFileSync(p, JSON.stringify({ version: "1.0", globalScopeKey: "NOPE", scopes: [{ key: "K", sources: [repo], entityCount: 1 }] }));
      return runReport({ root: repo, manifestPath: p, now: "T" }).report.archguard;
    })();
    check(
      "global-scope-fraction-is-less-than-one-and-null-when-unresolvable",
      (r.report.archguard.globalScopeCoversTsFraction ?? 1) < 1 &&
        r.report.archguard.globalScopeResolved === true &&
        unresolved.globalScopeCoversTsFraction === null &&
        unresolved.globalScopeResolved === false,
      `partial=${r.report.archguard.globalScopeCoversTsFraction} unresolved=${unresolved.globalScopeCoversTsFraction}`,
    );
  }

  // case 10 — the report is REPORT-ONLY: an all-unevaluated-language report still exits 0.
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const anyNotEvaluated = r.report.languages.some((l) => l.status === "NOT-EVALUATED");
    check(
      "report-only-unevaluated-language-still-exits-0",
      anyNotEvaluated && r.exitCode === 0,
      `anyNotEvaluated=${anyNotEvaluated} exit=${r.exitCode}`,
    );
  }

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* fixture cleanup is best-effort */
  }
  return st.report();
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
const USAGE = `arch-coverage-report.ts — who analyzed which language, and how much of it
usage: arch-coverage-report.ts [<root>] [--json] [--archguard-manifest <path>] [--selftest]
  exit 0 = report produced (⚠️ NOT "everything is evaluated" — read the rows)
  exit 1 = a --selftest case failed | 2 = NOT EVALUATED (manifest unparseable / git unavailable) | 3 = usage`;

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) helpExit(USAGE);
  if (argv.includes("--selftest")) return selftest() ? EXIT_OK : EXIT_SELFTEST_FAILED;

  let root: string | undefined;
  let manifestPath: string | undefined;
  const json = argv.includes("--json");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") continue;
    if (a === "--archguard-manifest") {
      manifestPath = argv[++i];
      if (manifestPath === undefined) {
        process.stderr.write("arch-coverage-report: --archguard-manifest requires a path\n");
        return EXIT_USAGE;
      }
      continue;
    }
    if (a.startsWith("--")) {
      process.stderr.write(`arch-coverage-report: unknown flag ${a}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    if (root !== undefined) {
      process.stderr.write(`arch-coverage-report: unexpected extra argument ${a}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    root = a;
  }

  const { report, exitCode } = runReport({ root: root ?? findRepoRoot(), manifestPath });
  process.stdout.write(json ? JSON.stringify(report, null, 2) + "\n" : renderHuman(report) + "\n");
  return exitCode;
}

if (isDirectEntry(import.meta, process.argv[1], "arch-coverage-report")) {
  process.exit(main());
}
