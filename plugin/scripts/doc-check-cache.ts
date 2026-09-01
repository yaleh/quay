// doc-check-cache.ts — the doc-class static-check (scripts/test.sh --static-checks-doc) RESULT
// CACHE, keyed by the "docs face" blob hash. (gap-fan-in-doc-check-cache)
//
// What question it makes askable: "has the doc-check INPUT changed since the last green run?" —
// worker-driver.ts's fan-in step 6 runs `bash scripts/test.sh --static-checks-doc` (11.6s × 165/week)
// on EVERY fan-in regardless of the task's delta. When the docs face is unchanged, the previous GREEN
// verdict is reused (~0s, step-trace reason=cache-hit); when it changed, the check reruns.
//
// Correctness contract — the cache key MUST cover every input the doc-class checkers read, else a
// change OUTSIDE the key reuses a stale verdict (the DoD's "无假命中" — no false hit). run_doc_checks
// (scripts/test.sh) reads:
//   - its `# @static-object` judgment objects (the docs, plus a few .ts/.test.mjs), parsed from
//     scripts/test.sh's run_doc_checks() body via precommit-guard.docClassPatterns (SINGLE source,
//     never a hand-list) + matchesGlob over the tracked tree;
//   - the checker/harness sources under plugin/scripts/* — instrument-failure-check --gate scans ALL
//     of plugin/scripts/*.{ts,sh} (its gateSurface), and run_checker lives in runner-static-gate.ts
//     (also under plugin/scripts);
//   - scripts/test.sh itself (the run_doc_checks + run_checker entry);
//   - .gitignore (threshold-scope-check / tick-core-static-check resolve "stale path" exemptions via
//     git check-ignore — a .gitignore edit can flip their verdict);
//   - the repo FILE-STRUCTURE (basename/stem presence) — threshold-scope-check's stale-path layer
//     resolves a referenced basename against the WHOLE tree (buildFileIndex walks root), so an
//     add/delete/rename ANYWHERE (not just a content edit) can flip its verdict.
// Therefore the key hashes (a) the blob hash of each docs-face file's CONTENT, and (b) the full
// tracked path list (structure). A content edit to a NON-face file (e.g. packages/*.ts) leaves the
// key unchanged (HIT); a content edit to a face file, a .gitignore edit, or any add/delete/rename
// changes the key (MISS → rerun).
//
// Only a GREEN verdict is ever cached — a RED is never cached (a transient/env-dependent red must
// not be perpetuated, and a cached red would mask a real pass once the input is fixed). Fail-closed:
// any git/parse failure ⇒ null key ⇒ no cache read/write (the doc-check just runs, un-cached).
//
// This module is a LIBRARY (imported by worker-driver.ts), not a standalone checker — it carries no
// exit-code/--json spine (checker-mechanical-spine-check's *-check.{ts,sh} derivation skips it).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { docClassPatterns, matchesGlob } from "./precommit-guard.ts";

/** One tracked file at HEAD (path + blob hash), parsed from `git ls-tree -r -z HEAD`. */
interface TreeEntry {
  path: string;
  hash: string;
}

/** `git ls-tree -r -z HEAD` in the worktree — one subprocess returns the full tracked tree with blob
 *  hashes (both the content face AND the structure face read it). null on any failure (fail-closed). */
function lsTreeEntries(worktree: string): TreeEntry[] | null {
  try {
    const out = execFileSync("git", ["-C", worktree, "ls-tree", "-r", "-z", "HEAD"], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) return [];
    const entries: TreeEntry[] = [];
    for (const rec of out.split("\0")) {
      if (!rec) continue;
      // rec = "<mode> <type> <hash>\t<path>" (with -z, the path is NOT quoted).
      const tab = rec.indexOf("\t");
      if (tab === -1) continue;
      const meta = rec.slice(0, tab).split(/\s+/);
      const p = rec.slice(tab + 1);
      if (meta.length < 3 || !p) continue;
      entries.push({ path: p, hash: meta[2] });
    }
    // Deterministic byte order (git's own tree order is byte-sorted, but re-sort for insurance).
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return entries;
  } catch {
    return null;
  }
}

/** Whether a tracked path is CONTENT-sensitive for the doc-check verdict (its blob hash goes into
 *  the key). Content-insensitive = only its PATH presence matters (the structure face). */
function isContentFace(p: string, patterns: string[]): boolean {
  if (p === "scripts/test.sh") return true; // run_doc_checks + run_checker entry
  if (p.startsWith("plugin/scripts/")) return true; // checker sources + runner-static-gate + instrument --gate surface
  if (p === ".gitignore" || p.endsWith("/.gitignore")) return true; // git check-ignore input
  return patterns.some((pt) => matchesGlob(pt, p)); // the @static-object judgment objects
}

/**
 * Compute the docs-face cache key for the worktree at HEAD (post-merge-develop). The key is the
 * sha256 over, per tracked file (sorted): `C\t<path>\t<blob-hash>` for CONTENT-sensitive files and
 * `S\t<path>` for every file (structure). null when git/parse fails — callers treat null as
 * "no cache" (run the doc-check normally), never as a hit (fail-closed, 硬规则 3b/6).
 */
export function computeDocCheckFaceKey(worktree: string): string | null {
  const entries = lsTreeEntries(worktree);
  if (entries === null) return null;
  const patterns = docClassPatterns(worktree); // [] when run_doc_checks absent (fail-open: nothing doc-class)
  const h = createHash("sha256");
  for (const e of entries) {
    if (isContentFace(e.path, patterns)) h.update(`C\t${e.path}\t${e.hash}\n`);
    h.update(`S\t${e.path}\n`);
  }
  return h.digest("hex");
}

/** The cached entry shape: the last GREEN verdict, keyed by the docs-face key it was produced under. */
export interface DocCheckCacheEntry {
  key: string;
  ok: true;
  ts: string;
}

/** Read the cached green verdict for `key`. Returns true on a HIT (same key + ok:true), null on
 *  MISS / absent / corrupt / not-green (fail-closed — null is never a hit). */
export function readDocCheckCache(cacheFile: string, key: string): boolean | null {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    const raw: unknown = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as DocCheckCacheEntry;
    if (entry.key !== key) return null;
    if (entry.ok !== true) return null; // only GREEN verdicts are cacheable
    return true;
  } catch {
    return null;
  }
}

/** Write the GREEN verdict under `key` (atomic replace; only green is ever cached — worker-driver
 *  calls this ONLY when the doc-check passed). Best-effort: a write failure ≠ a fan-in failure. */
export function writeDocCheckCache(cacheFile: string, key: string): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const entry: DocCheckCacheEntry = { key, ok: true, ts: new Date().toISOString() };
    const tmp = `${cacheFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry) + "\n", "utf8");
    fs.renameSync(tmp, cacheFile);
  } catch {
    // best-effort runtime cache — never let a cache write fail the fan-in
  }
}
