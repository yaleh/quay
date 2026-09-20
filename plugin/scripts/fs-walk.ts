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
//
// A LATER finding from the same routine run (`.quay/routine-findings.jsonl`, finding
// `shell-scan-surface-family`) landed the *named* surfaces the checkers kept re-writing on top of
// the traversal: `collectShellScripts` (byte-identical in two checkers), `listExecutableFiles`
// (byte-identical in two more) and the `scanSurface` table + skip-set of the two identity checkers.
// Those live here too — see the sections below. The same non-goal applies: their POLICY parameters
// (the per-caller SKIP_DIRS) stayed with the callers because those genuinely differ.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The paths git considers part of the working tree under `root`: tracked (`ls-files --cached`) ∪
 * untracked-and-not-ignored (`--others --exclude-standard`), POSIX and relative to `root`. This is
 * the ONE gitignore-driven skip face: instead of every caller growing its own hand-written name
 * list, the set of files that *are* the repo comes from git, so gitignored trees (worktree
 * containers, MCP caches, mirror dirs) drop out by construction.
 *
 * ⛔ Returns `null` — deliberately NOT an empty set — when git cannot answer (no work tree at
 * `root`, git missing, non-zero exit). 硬规则 3b: a value that means "could not evaluate" must not
 * share its output shape with a value that means "evaluated, and this is the answer". An empty set
 * would read as "nothing here is ignored"; the caller would then silently scan the ignored trees
 * while believing it had applied a skip face, and no reading could tell the two apart. Callers must
 * branch on `null` explicitly and say which face they used.
 *
 * Non-zero exit covers the overflow/truncation case too (an oversized listing kills the process and
 * leaves `status` null), so a truncated answer is reported as NOT-EVALUATED rather than returned as
 * a plausible-looking smaller set.
 */
export function gitVisiblePaths(root: string): Set<string> | null {
  const res = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string") return null;
  const out = new Set<string>();
  for (const p of res.stdout.split("\0")) if (p) out.add(p);
  return out;
}

/** Every directory that has a visible path beneath it (all proper ancestors, POSIX, root-relative).
 *  The index that lets a walk prune an ignored subtree in O(1): a directory absent from this set
 *  contains no visible file, so descending is guaranteed to yield nothing. */
export function visibleDirPrefixes(paths: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) {
    let i = p.lastIndexOf("/");
    while (i > 0) {
      const d = p.slice(0, i);
      if (dirs.has(d)) break; // its ancestors were recorded when it was
      dirs.add(d);
      i = d.lastIndexOf("/");
    }
  }
  return dirs;
}

/** A gitignore-driven skip face tied to the root its paths are relative to — the pair `walkFiles`
 *  needs to match an entry it discovered on disk against git's own view. `null` = NOT-EVALUATED
 *  (see `gitVisiblePaths`); pass it through, never coerce it to an empty set. */
export interface VisibleSet {
  root: string;
  paths: ReadonlySet<string>;
}

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
  /**
   * Restrict the walk to the paths git considers part of this work tree — the gitignore-driven
   * skip face (`gitVisiblePaths`). Entries are matched by their path relative to `visible.root`
   * (the walk root must lie inside it); a directory with no visible descendant is pruned, so an
   * ignored subtree is never descended into, and a file git does not see is never recorded.
   *
   * `null` is a MEANINGFUL value: it means git could not answer, and the walk then applies only
   * the caller's own `prune`. Never write `visible: gitVisiblePaths(root) ?? {…}` — that erases the
   * NOT-EVALUATED state (硬规则 3b) and makes "no gitignore face was applied" indistinguishable
   * from "the gitignore face was applied and matched nothing".
   */
  visible?: VisibleSet | null;
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
  const visible = opts.visible ?? null;
  const visibleDirs = visible ? visibleDirPrefixes(visible.paths) : null;

  const out: string[] = [];
  if (!fs.existsSync(root)) return out;

  /** Is `abs` part of git's view of the work tree? Directories are kept when they have a visible
   *  descendant (so an ignored tree is pruned, not walked-and-discarded). */
  const isVisible = (abs: string, isDir: boolean): boolean => {
    if (!visible || !visibleDirs) return true;
    const rel = path.relative(visible.root, abs).split(path.sep).join("/");
    return isDir ? visibleDirs.has(rel) : visible.paths.has(rel);
  };

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
      if (!isVisible(abs, isDir)) continue;
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
 * Extensions of the shell scripts the shell-scan checkers read (`.sh`/`.bash`).
 *
 * `.ts` is deliberately NOT in the set (decision record, NOT a silent omission —
 * gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap AC2): `stripShellComments` models
 * only SHELL comments (`#`); a TS file's `//`-comments and string literals would self-match the
 * whole-screen-hash pattern in adr016-screen-use-check.ts, and no EXECUTABLE .ts instance of that
 * flow exists in the repo. If one ever appears, add a TS-aware comment/string stripper FIRST.
 */
export const SHELL_FILE_EXTENSIONS: ReadonlySet<string> = new Set([".sh", ".bash"]);

/**
 * Collect the root-relative `.sh`/`.bash` files under `root`, pruning `skipDirNames`.
 *
 * Was `collectShellScripts`, a whole-function byte-identical copy in adr016-screen-use-check.ts and
 * dead-code-after-return-check.ts (.quay/routine-findings.jsonl, finding `shell-scan-surface-family`,
 * routine `semantic-dedup-scan`). Only the BODY moved here.
 *
 * ⛔ The skip-set is a PARAMETER, not a shared constant, because the two callers' sets genuinely
 * differ: adr016 prunes `dist-sea` but not `vendor`; dead-code prunes `vendor` but not `dist-sea`.
 * Picking either as "the" set would silently change which files the other checker scans — and a
 * checker reading the wrong surface returns the pass shape (硬规则 3b). This is the same axis the
 * module header warns about; do not unify them.
 *
 * `prune` is tested BEFORE classification and ignores `isDir` (the originals' shape), so a *file*
 * whose basename collides with a skip-dir name is dropped along with the directory.
 */
export function collectShellScripts(root: string, skipDirNames: ReadonlySet<string>): string[] {
  return walkFiles(root, {
    entryKind: "stat",
    prune: (name) => skipDirNames.has(name),
    include: (name, ext) => SHELL_FILE_EXTENSIONS.has(ext),
  });
}

/** Extensions of the executable-ish source files the reference-surface walkers scan. */
export const EXEC_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".sh", ".mjs", ".js", ".cjs", ".bash"]);

/** Names never descended into nor recorded by `listExecutableFiles` (files and dirs alike). */
const EXEC_SKIP_NAMES: ReadonlySet<string> = new Set(["node_modules", ".git", ".quay"]);

/**
 * Recursively list the plain executable files under `dir` (ABSOLUTE paths, sorted), skipping
 * `EXEC_SKIP_NAMES` and symlinks.
 *
 * Was a whole-function byte-identical copy in fan-in-workflow-retirement-check.ts and
 * outer-retirement-precondition-check.ts (finding `shell-scan-surface-family`; only the JSDoc
 * wording differed). Expressed on `walkFiles` rather than moved verbatim, because a hand-rolled
 * recursive walker living inside the module whose stated purpose is to replace them would defeat
 * the point of this file.
 *
 * The two axes that had to be preserved explicitly, both pinned by plugin/test/fs-walk.test.mjs:
 *   • `entry.isFile()` — a SYMLINK is not a regular file, so symlinks are dropped entirely
 *     (neither recorded nor descended). A bare "not a directory" test would have recorded
 *     `link.ts`; that is the difference the module header calls out.
 *   • prune is name-only, tested before classification, so a *file* named `.git` is dropped too.
 * Equivalence with both originals is not ASSERTED here — it is pinned by a differential control
 * (the old body vs this one, over four roots incl. a synthetic symlink tree) run as part of the
 * extraction that landed this function.
 */
export function listExecutableFiles(dir: string): string[] {
  return walkFiles(dir, {
    absolute: true,
    prune: (name) => EXEC_SKIP_NAMES.has(name),
    include: (_name, ext, entry) => entry !== null && entry.isFile() && EXEC_EXTENSIONS.has(ext),
  });
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

/**
 * The kernel source surface the two identity checkers scan: `plugin/scripts` top level (checkers are
 * not nested — `checker-mutation-cases/` is a subdirectory) plus `packages/quay/src` recursively.
 *
 * `SCAN_ROOTS`, the skip-set below and the 3-line `scanSurface` body were byte-identical in
 * kernel-sibling-resolution-check.ts and target-identity-literal-check.ts (finding
 * `shell-scan-surface-family` — the two largest members of the 5-member same-named `scanSurface`
 * family). They are one decision — "what does the kernel identity checkers' surface consist of" —
 * so they live here together.
 *
 * ⛔ The OTHER two `scanRoots` callers reach the traversal directly with their own tables
 * (concurrency-literal-check.ts / suite-slot-ssot-check.ts). Their roots genuinely differ, so only
 * the traversal was ever theirs to share. Do not fold them in here.
 *
 * 硬规则 5b sweep (the same-carrier count, measured on the extraction that landed this): before,
 * `plugin/scripts/*.ts` held 3 normalized-identical-body groups — collectShellScripts ×2,
 * listExecutableFiles ×2, and scanSurface ×4 (the kernel pair plus those two). After, ONE remains:
 * concurrency-literal-check.ts + suite-slot-ssot-check.ts, whose whole body is the one-line call
 * `return scanRoots(root, SCAN_ROOTS, SURFACE_SKIP_DIRS);` over two DIFFERENT tables. That is the
 * floor, not an oversight — there is no algorithm left in it to extract; sharing it further would
 * only rename `scanRoots`.
 */
export const KERNEL_SURFACE_SCAN_ROOTS: readonly ScanRoot[] = [
  { dir: "plugin/scripts", rel: "plugin/scripts", ext: /\.(ts|mjs|js)$/, recursive: false },
  { dir: "packages/quay/src", rel: "packages/quay/src", ext: /\.ts$/, recursive: true },
];

/** Directories pruned while walking `KERNEL_SURFACE_SCAN_ROOTS` (see above). */
export const KERNEL_SURFACE_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "test",
  "dist",
  "ts-demo",
]);

/** Enumerate `KERNEL_SURFACE_SCAN_ROOTS` — the shared surface of the two identity checkers. */
export function scanKernelSurface(root: string): string[] {
  return scanRoots(root, KERNEL_SURFACE_SCAN_ROOTS, KERNEL_SURFACE_SKIP_DIRS);
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
