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
import { fileURLToPath } from "node:url";

// Globs treated as too broad to reason about safely → conservative overlap.
export const OVERBROAD = new Set(["**", "*", "**/*", "./**", "**/**"]);

// A DECLARATION is overbroad (unsafe to reason about / meaningless as a scope) if it is a bare
// wildcard (OVERBROAD) OR a single top-level segment followed by `/**` (e.g. `packages/**`,
// `tasks/**`) — broad enough to absorb an unrelated stray write. `packages/quay/**` (depth ≥ 2) is
// fine. Single-source: both the pre-flight orthogonality gate AND the after-the-fact anti-drift
// guardrail use THIS predicate (ADR-004) — hardening from the DIR-044 increment-4 adversarial audit
// (finding H3: an overbroad-but-legal directory glob defeated the out-of-declared arm).
export function isOverbroadDeclaration(glob) {
  const g = String(glob).trim().replace(/^\.\//, "");
  if (OVERBROAD.has(g)) return true;
  return /^[^/]+\/\*\*$/.test(g); // one top segment + /**
}

// ── parseTouches ─────────────────────────────────────────────────────────────────────────────────
// Extract the `## Touches` section's path globs. Accepts `- ` and `* ` bullets; strips a leading `./`.
// Returns { hasSection, globs }. hasSection distinguishes "no declaration" (→ conservative) from
// "declared empty".
export function parseTouches(text) {
  const lines = String(text).split(/\r?\n/);
  let inSection = false;
  let hasSection = false;
  const globs = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      inSection = /^touches\b/i.test(heading[1].trim());
      if (inSection) hasSection = true;
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!bullet) continue;
    let g = bullet[1].trim();
    // allow inline code backticks around the path
    g = g.replace(/^`+|`+$/g, "").trim();
    g = g.replace(/^\.\//, "");
    if (g) globs.push(g);
  }
  return { hasSection, globs };
}

// ── matchGlob ────────────────────────────────────────────────────────────────────────────────────
// Minimal glob matcher over a repo-relative POSIX path. `**` crosses separators; `*` does not.
export function matchGlob(glob, filePath) {
  const re = globToRegExp(glob);
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
export function expandGlobs(globs, root) {
  const all = walkFiles(root);
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

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
