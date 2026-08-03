// touches-orthogonality-check.mjs — the single-source milestone-`touches` disjointness check
// (DIR-044 increment 1 — the concurrent-scheduler pre-flight; see
// `charters/DIR-044-concurrent-scheduler-D3.md`). Given two milestone charters, each declaring a
// `## Touches` section of repo-relative path globs, decide whether the concrete file-sets they touch
// are DISJOINT (safe to run concurrently in separate worktrees) or OVERLAP (must serialize).
//
// CONSERVATIVE by construction (fail-closed to "serialize"): it returns `disjoint: true` ONLY when it
// can PROVE the two expanded file-sets do not intersect. Absent/empty `## Touches`, an over-broad glob
// (`**`, `*`, `**/*`), or a glob that matches NOTHING (likely a typo) all → `disjoint: false`. A future
// `quay gate --gate touches-orthogonality` WRAPS this module (M39 registry precedent) — it must never
// reimplement the logic; this module is the ONE definition (ADR-004 single-source).
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them (mirrors
// vmeta-lag-check.mjs's shape).

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): the ONE Touches bullet parser.
import { parseTouchEntries, extractTouchesSection } from "./touches-parser.ts";

// Kept for reference / callers; the authoritative test is isOverbroadDeclaration (semantic, below).
export const OVERBROAD = new Set(["**", "*", "**/*", "./**", "**/**"]);

// Canonicalize a repo-relative path or glob: forward slashes, strip a leading `./`, collapse `//`,
// resolve `.`/`..` segments, drop a trailing `/`. Wildcard segments (`*`, `**`) are preserved. This
// is single-source (used by matchGlob callers, isOverbroadDeclaration, and anti-drift) so path-shape
// tricks (`./`, `//`, `a/./b`, `a/../a/b`, trailing `/`, backslashes) cannot spoof identity — closes
// the DIR-044 increment-5 audit's H1 (dot-segment) class and the `.//`→`/a` normalization bug.
export function normalizePath(p) {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

// A DECLARATION is overbroad — too broad to meaningfully constrain a milestone's writes — when, after
// canonicalization, it contains a wildcard reachable with FEWER THAN TWO concrete (wildcard-free)
// leading path segments. So `**`, `*`, `**/*.js`, `packages/**`, `packages/**/*`, `packages/*/**` are
// ALL overbroad (they can absorb an unrelated stray write across a whole top-level tree), while an
// exact path (no wildcard, any depth) and a ≥2-segment-anchored glob (`packages/quay/**`,
// `packages/quay/src/gate/*.js`) are precise enough. This is SEMANTIC (anchoring depth), not a list
// of banned spellings — hardening from the DIR-044 increment-5 adversarial audit, which showed a
// syntactic single-spelling ban (`^[^/]+/\*\*$`) was evaded by `packages/**/*`, `**/*.js`, etc.
// Single-source (ADR-004): the pre-flight orthogonality gate AND the anti-drift guardrail both use it.
export function isOverbroadDeclaration(glob) {
  const g = normalizePath(glob);
  if (g === "" || OVERBROAD.has(g)) return true;
  let concrete = 0;
  for (const seg of g.split("/")) {
    if (/[*?]/.test(seg)) return concrete < 2; // first wildcard segment: need ≥2 concrete before it
    concrete++;
  }
  return false; // no wildcard at all → an exact path, precise at any depth
}

// ── parseTouches ─────────────────────────────────────────────────────────────────────────────────
// Extract the `## Touches` section's path globs. Accepts `- ` and `* ` bullets.
// Returns { hasSection, globs }. hasSection distinguishes "no declaration" (→ conservative) from
// "declared empty".
//
// SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): the bullet→path parsing (backtick/
// quote stripping, trailing "(…)" annotation stripping — both outside-backticks and
// inside-backticks forms — and leading `./` removal) is DELEGATED to the ONE shared implementation,
// parseTouchEntries in ./touches-parser.ts. This module no longer has its own copy — the residual
// trailing backtick on `` - `foo.ts` (new) `` (DIR-106 Fix 1 stripped the annotation but left the
// closing backtick the annotation had masked) is what made the FAST-MODE eligibility path judge an
// annotated task as "matched nothing (likely a typo)". Only the glob-formation step is local:
// trailing-slash directory globs get `**` appended (DIR-106 Fix 3).
export function parseTouches(text) {
  const { hasSection, section } = extractTouchesSection(text);
  const globs = parseTouchEntries(section).map((g) => {
    // DIR-106 Fix 3: normalize trailing-slash directory globs — "milestones/M155/" matches
    // the literal directory string, not files within it. Append ** so the glob expands to
    // all files under that directory. Guard: only when no wildcard is already present.
    if (g && g.endsWith("/") && !/[*?]/.test(g)) g += "**";
    return g;
  });
  return { hasSection, globs };
}

// ── matchGlob ────────────────────────────────────────────────────────────────────────────────────
// Minimal glob matcher over a repo-relative POSIX path. `**` crosses separators; `*` does not.
// gap-select-preflight-json-real-store-too-slow: compiled regexes are memoized per glob. The glob
// → RegExp mapping is pure (same glob always compiles to the same pattern), so a module-level cache
// is behavior-preserving and turns the previous per-(glob,file) recompilation into a single compile
// per distinct glob — the difference between O(files) and O(globs) compilations per expandGlobs call
// over a large tree.
const MATCH_RE_CACHE = new Map();
export function matchGlob(glob, filePath) {
  let re = MATCH_RE_CACHE.get(glob);
  if (re === undefined) {
    re = globToRegExp(glob);
    MATCH_RE_CACHE.set(glob, re);
  }
  return re.test(filePath);
}

function globToRegExp(glob) {
  let re = "";
  const g = String(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        // `**` → any chars including separators; consume an optional trailing slash
        i++;
        if (g[i + 1] === "/") i++;
        re += ".*";
      } else {
        re += "[^/]*"; // `*` → any chars except separator
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// ── walkFiles / expandGlobs ──────────────────────────────────────────────────────────────────────
// Walk `root` returning repo-relative POSIX paths of every regular file, skipping VCS/dep dirs.
const SKIP_DIRS = new Set([".git", "node_modules", ".quay"]);
export function walkFiles(root) {
  const out = [];
  const walk = (abs, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  walk(root, "");
  return out;
}

// Expand globs to the concrete set of repo-relative files under `root` that match any of them.
// `files` is an optional PRE-COMPUTED walkFiles(root) list for walk-once callers
// (gap-select-preflight-json-real-store-too-slow): when the same tree is expanded many times in one
// process (e.g. select-preflight's pairwise orthogonality scan + coupling-graph, ~29 expandGlobs
// calls per run against the real store), passing a shared file list avoids re-walking the whole tree
// per call. When omitted, behavior is unchanged (walks on every call). Callers that MUTATE the tree
// between calls must NOT pass a stale precomputed list.
export function expandGlobs(globs, root, files = null) {
  const all = files ?? walkFiles(root);
  const set = new Set();
  for (const g of globs) {
    for (const f of all) if (matchGlob(g, f)) set.add(f);
  }
  return set;
}

// ── filesDisjoint ────────────────────────────────────────────────────────────────────────────────
export function filesDisjoint(setA, setB) {
  const overlaps = [];
  for (const f of setA) if (setB.has(f)) overlaps.push(f);
  overlaps.sort();
  return { disjoint: overlaps.length === 0, overlaps };
}

// ── checkTouchesPair ─────────────────────────────────────────────────────────────────────────────
// Orchestrator with the conservative defaults. `expand(globs) → Set<path>` is injected for testability
// (the CLI passes an fs-backed expander rooted at the repo).
export function checkTouchesPair(parsedA, parsedB, expand) {
  for (const [p, who] of [[parsedA, "A"], [parsedB, "B"]]) {
    if (!p.hasSection || p.globs.length === 0) {
      return { disjoint: false, overlaps: [], reason: `conservative: side ${who} declares no/empty ## Touches → serialize` };
    }
    const bad = p.globs.find((g) => isOverbroadDeclaration(g));
    if (bad) {
      return { disjoint: false, overlaps: [], reason: `conservative: side ${who} has overbroad glob "${bad}" → serialize` };
    }
  }
  const setA = expand(parsedA.globs);
  const setB = expand(parsedB.globs);
  if (setA.size === 0 || setB.size === 0) {
    const who = setA.size === 0 ? "A" : "B";
    return { disjoint: false, overlaps: [], reason: `conservative: side ${who} globs matched nothing (empty expansion — likely a typo) → serialize` };
  }
  const { disjoint, overlaps } = filesDisjoint(setA, setB);
  return { disjoint, overlaps, reason: disjoint ? "disjoint file-sets" : "overlapping file-sets" };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
export function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function usage() {
  process.stderr.write("Usage: touches-orthogonality-check.mjs [--root <dir>] <charterA.md> <charterB.md>\n");
}

export async function main(argv) {
  const args = argv.slice(2);
  let root = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i]; continue; }
    files.push(args[i]);
  }
  if (files.length !== 2) { usage(); return 2; }
  for (const f of files) {
    if (!fs.existsSync(f)) { process.stderr.write(`ERROR: charter not found: ${f}\n`); return 2; }
  }
  const expandRoot = root ? path.resolve(root) : findRepoRoot(path.resolve(path.dirname(files[0])));
  const A = parseTouches(fs.readFileSync(files[0], "utf8"));
  const B = parseTouches(fs.readFileSync(files[1], "utf8"));
  const expand = (globs) => expandGlobs(globs, expandRoot);
  const r = checkTouchesPair(A, B, expand);
  if (r.disjoint) {
    process.stdout.write(`DISJOINT: ${files[0]} ∥ ${files[1]} — safe to batch (${r.reason})\n`);
    return 0;
  }
  const tail = r.overlaps.length ? ` [overlap: ${r.overlaps.join(", ")}]` : "";
  process.stdout.write(`OVERLAP: ${files[0]} ✗ ${files[1]} — must serialize (${r.reason})${tail}\n`);
  return 1;
}

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
