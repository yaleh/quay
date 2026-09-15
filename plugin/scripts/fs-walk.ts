// fs-walk.ts — the ONE recursive directory-walk primitive for plugin/scripts checkers.
//
// Why this module exists: a semantic-dedup-scan pass found 22 recursive `readdirSync` walkers
// across 19 checkers that all repeated the same skeleton — `try { readdirSync } catch { return }`
// + a per-entry loop + a skip-set prune + `path.join` + (usually) a sorted return — and differed
// only in their skip-set / roots / extension constants. Several pairs were byte-identical
// (`.quay/routine-findings.jsonl`, finding `fs-walk-family`, routine `semantic-dedup-scan`,
// runId `semantic-dedup-scan-1789322638156`). The skeleton now lives here once.
//
// ⛔ What this module deliberately does NOT do: unify the callers' *semantics*. Two walkers that
// look alike are NOT necessarily interchangeable —
//   • classification: `readdirSync(dir)` + `statSync` follows symlinks; `readdirSync(dir,
//     {withFileTypes:true})` does not. A dangling symlink named `x.ts` is therefore a FILE to the
//     former and a non-file to an `isFile()`-guarded walker.
//   • prune order: some callers test the skip-set BEFORE classifying (so a *file* whose basename
//     collides with a skip-dir name is dropped), others only prune directories.
// Collapsing those differences would silently change WHICH FILES each checker scans — the exact
// failure shape of 硬规则 3b (a checker that cannot read its input returns the "pass" shape).
// So the callers keep their own predicates and constants; only the traversal is shared.
//
// `entryKind` and `prune(name, isDir)` exist to keep those two axes expressible, not to be
// "unified away". See plugin/test/fs-walk.test.mjs for the control that pins this.

import fs from "node:fs";
import path from "node:path";

export interface WalkOptions {
  /**
   * Prune an entry from the walk. Receives the basename and (once known) whether it is a
   * directory. Return true to drop the entry — and, for a directory, its whole subtree.
   *
   * In `entryKind: "dirent"` mode `isDir` is free. In `"stat"` mode the entry is stat'ed first,
   * so a predicate that ignores `isDir` (the shape-A/C callers) still sees — and drops — the same
   * names it always did; the only difference is a wasted stat on a pruned entry.
   */
  prune?: (name: string, isDir: boolean) => boolean;
  /**
   * Record a non-directory entry? Default: every non-directory entry survives.
   * `entry` is the Dirent in `"dirent"` mode and null in `"stat"` mode (a bare `readdirSync`
   * gives names only) — a caller that needs `entry.isFile()` must use `"dirent"`.
   */
  include?: (name: string, ext: string, entry: fs.Dirent | null) => boolean;
  /**
   * How an entry is classified as directory-or-not.
   *   "dirent" (default) — `readdirSync(dir, {withFileTypes:true})`; symlinks are NOT directories.
   *   "stat"            — `readdirSync(dir)` then `statSync`; symlinks ARE followed. An entry whose
   *                       stat throws is skipped, matching the original hand-rolled walkers.
   */
  entryKind?: "dirent" | "stat";
  /**
   * Deepest directory level to descend into. The root itself is depth 1, so `maxDepth: 1` scans
   * the root's own entries and never descends. Default: Infinity.
   */
  maxDepth?: number;
  /** Return absolute paths instead of root-relative POSIX paths. Default false. */
  absolute?: boolean;
  /** Sort the result. Default true — most callers want a stable, diffable order. */
  sort?: boolean;
}

/**
 * Recursively list files under `root`.
 *
 * Returns paths relative to `root` in POSIX form (`/`-separated) unless `absolute` is set.
 * Unreadable directories are skipped, not thrown — matching every walker this replaces.
 */
export function walkFiles(root: string, opts: WalkOptions = {}): string[] {
  const prune = opts.prune;
  const include = opts.include;
  const entryKind = opts.entryKind ?? "dirent";
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
  const absolute = opts.absolute ?? false;
  const wantSort = opts.sort ?? true;

  const out: string[] = [];
  if (!fs.existsSync(root)) return out;

  const record = (abs: string) => {
    out.push(absolute ? abs : path.relative(root, abs).split(path.sep).join("/"));
  };

  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      let isDir: boolean;
      if (entryKind === "dirent") {
        isDir = e.isDirectory();
      } else {
        // stat mode: mirror `readdirSync` + `statSync` semantics (follows symlinks), and skip the
        // entry when the stat throws — exactly what the hand-rolled walkers did.
        try {
          isDir = fs.statSync(path.join(dir, e.name)).isDirectory();
        } catch {
          continue;
        }
      }
      if (prune && prune(e.name, isDir)) continue;
      const abs = path.join(dir, e.name);
      if (isDir) {
        if (depth < maxDepth) walk(abs, depth + 1);
        continue;
      }
      const ext = path.extname(e.name);
      if (!include || include(e.name, ext, entryKind === "dirent" ? e : null)) record(abs);
    }
  };

  walk(root, 1);
  return wantSort ? out.sort() : out;
}

/**
 * One scan root: `dir` is relative to the repo root, `rel` is the prefix the scan surface reports
 * under (they coincide today, but the hand-rolled walkers kept them separate and so does this).
 * `recursive: false` scans `dir`'s own entries and never descends.
 */
export interface ScanRoot {
  dir: string;
  rel: string;
  ext: RegExp;
  recursive?: boolean;
}

/**
 * Enumerate the scan surface described by a `SCAN_ROOTS` table — the walker shared by the four
 * `scanSurface(root)` checkers (kernel-sibling-resolution / target-identity-literal /
 * concurrency-literal / suite-slot-ssot), which differed only in their roots table and skip-set.
 *
 * Reports repo-relative POSIX paths, sorted. `skipDirNames` prunes DIRECTORIES only (a *file* whose
 * basename collides with a skip-dir name is still scanned — that is what the originals did).
 * Classification follows symlinks (`entryKind: "stat"`), as the originals' `fs.statSync` did.
 */
export function scanRoots(
  root: string,
  scanRoots: readonly ScanRoot[],
  skipDirNames: ReadonlySet<string>,
): string[] {
  const out = scanRoots.flatMap(({ dir, rel, ext, recursive }) =>
    walkFiles(path.join(root, dir), {
      entryKind: "stat",
      maxDepth: recursive === false ? 1 : Number.POSITIVE_INFINITY,
      prune: (name, isDir) => isDir && skipDirNames.has(name),
      include: (name) => ext.test(name),
    }).map((p) => path.join(rel, p)),
  );
  return out.sort();
}

/** basename -> first repo-relative POSIX path found; stem -> set of extensions seen. */
export interface FileIndex {
  byBasename: Map<string, string>;
  byStem: Map<string, Set<string>>;
}

/**
 * Walk `root` and index every non-directory entry by basename and by stem.
 *
 * This was `buildFileIndex`, duplicated verbatim in threshold-scope-check.ts and
 * tick-core-static-check.ts (same finding as walkFiles above — the two copies differed only in a
 * comment). `byBasename` is FIRST-WINS, so the traversal order is part of the contract: the walk
 * is unsorted (`sort: false`) and depth-first, exactly as both copies were.
 *
 * Excluded: hidden dirs, `node_modules`, and the test-artifact / worktree dirs `tmp` / `worktrees`
 * / `milestones` — a basename that exists only in a run-identity fixture copy must not resolve a
 * genuinely stale reference in a scanned doc.
 */
export function buildFileIndex(root: string): FileIndex {
  const byBasename = new Map<string, string>();
  const byStem = new Map<string, Set<string>>();
  const skipDir = (name: string) =>
    name.startsWith(".") || name === "node_modules" || name === "tmp"
    || name === "worktrees" || name === "milestones";
  for (const rel of walkFiles(root, { sort: false, prune: (name, isDir) => isDir && skipDir(name) })) {
    const name = path.basename(rel);
    if (!byBasename.has(name)) byBasename.set(name, rel);
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      const stem = name.slice(0, dot);
      if (!byStem.has(stem)) byStem.set(stem, new Set());
      byStem.get(stem)!.add(name.slice(dot + 1));
    }
  }
  return { byBasename, byStem };
}
