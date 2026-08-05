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
import { parseTouchEntries, parseTouchEntriesWithTags, extractTouchesSection } from "./touches-parser.ts";

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

// ── touchExists / checkTouchesResolve ────────────────────────────────────────────────────────────
// gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files: a dispatch-eligibility
// resolve check COMPLEMENTING checkTouchesPair. checkTouchesPair answers "do these two tasks'
// declared file-sets overlap?"; it does NOT answer "do the declared files even exist?" — so 8 of 9
// `status: ready` tasks pointing at files ADR-022 physically deleted sailed through eligibility.
// touchExists answers that for ONE entry. The task's AC2 wording ("verify every entry in
// `## Touches` that is NOT tagged `(new)`/`(delete)` actually exists") exempts BOTH structural tags
// from the existence requirement:
//   - `(new)`   — the task will CREATE this file; it need not exist yet → never "missing".
//   - `(delete)`— the task will DELETE this file; if it is already gone the delete is a no-op, so a
//                 nonexistent target cannot make the task undispatchable → never "missing" either.
// A path with a wildcard (`*`/`?`) or a trailing `/` is resolved as a GLOB (a trailing `/` is a
// directory glob → `**` appended, matching parseTouches's DIR-106 Fix 3). A glob that matches
// nothing resolves to "missing". An exact path resolves via fs.existsSync.
export function touchExists(p, root) {
  const hasWildcard = /[*?]/.test(p);
  const glob = p.endsWith("/") && !hasWildcard ? `${p}**` : p;
  if (hasWildcard || glob !== p) {
    return expandGlobs([glob], root).size > 0;
  }
  return fs.existsSync(path.join(root, glob));
}

// Given parsed [{path, tag}] entries and a repo root, resolve each against the real tree. Returns:
//   results:        [{path, tag, exists}] — exists is null for `(new)`/`(delete)` (skipped), true/false otherwise
//   mustExist:      count of entries that must resolve (no tag, i.e. not `(new)`/`(delete)`)
//   missing:        count of those that did NOT resolve
//   majorityMissing:true iff more than half of the must-exist entries are missing → the task's
//                   Touches majority-resolve to nonexistent files and it must not be dispatched.
// A task with no must-exist entries (all `(new)`/`(delete)`, or empty) is never majorityMissing.
export function checkTouchesResolve(entries, root) {
  const results = [];
  let mustExist = 0;
  let missing = 0;
  for (const e of entries) {
    if (e.tag === "new" || e.tag === "delete") {
      results.push({ path: e.path, tag: e.tag, exists: null });
      continue;
    }
    mustExist++;
    const ok = touchExists(e.path, root);
    results.push({ path: e.path, tag: e.tag, exists: ok });
    if (!ok) missing++;
  }
  const majorityMissing = mustExist > 0 && missing > mustExist / 2;
  return { results, mustExist, missing, majorityMissing };
}

// Convenience: run checkTouchesResolve over a full task/charter BODY (extracts its `## Touches`
// section via the single-source extractTouchesSection, then tag-parses via parseTouchEntriesWithTags).
export function checkTaskTouchesResolve(taskBody, root) {
  const { hasSection, section } = extractTouchesSection(taskBody);
  const entries = hasSection ? parseTouchEntriesWithTags(section) : [];
  return { hasSection, ...checkTouchesResolve(entries, root) };
}

// ── self-touch check (gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence) ──
// (c) block of the three-block batch elimination: every task's `## Touches` MUST include its own
// task file `tasks/<id>.md` — WITHOUT the `(new)` annotation. The self-file grants the executing
// agent permission to edit its own task file at completion (tick AC checkboxes + paste its invoke
// real-run evidence) — the AC/evidence delegation that shrinks outer closure to one DoD line per
// task. The `(new)` ban is load-bearing: `hasAnyLandedNewTouch` fires on a `(new)`-marked entry
// whose file exists, so a `(new)` self-file would misjudge every task as "work already landed",
// emptying the ready pool (gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks).
// checkTouchesPair is UNAFFECTED: the self-file is unique per task (tasks/A.md ≠ tasks/B.md), so two
// tasks touching only their own files stay disjoint (filesDisjoint: overlaps.length === 0).
export function selfTouchEntry(taskBody, taskId) {
  const { hasSection, section } = extractTouchesSection(taskBody);
  if (!hasSection) return null;
  const expected = `tasks/${taskId}.md`;
  return parseTouchEntriesWithTags(section).find((e) => e.path === expected) ?? null;
}

/** { ok, expected, entry } — ok: true iff the task's Touches contains `tasks/<id>.md` and that
 *  entry carries no `(new)` tag (a `(delete)` self-file is likewise not a grant). */
export function selfTouchCheck(taskBody, taskId) {
  const expected = `tasks/${taskId}.md`;
  const entry = selfTouchEntry(taskBody, taskId);
  const ok = entry !== null && entry.tag !== "new";
  return { ok, expected, entry };
}

// True when the task frontmatter declares the `fixture` label (block list `labels:\n  - fixture` or
// flow list `labels: [..., fixture]`). Fixtures are gate demo tasks — never real work, never
// dispatchable — so the ready-pool scan skips them (matching ready-pool-check.ts's isFixture).
export function isFixtureTask(raw) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  const flow = fm[1].match(/^labels:\s*\[([^\]]*)\]\s*$/m);
  if (flow) return flow[1].split(",").some((v) => v.trim().replace(/^["']|["']$/g, "") === "fixture");
  const lines = fm[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^labels:\s*$/.test(l));
  if (idx < 0) return false;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+?)\s*$/);
    if (m) {
      if (m[1].replace(/^["']|["']$/g, "") === "fixture") return true;
    } else if (/^\S/.test(lines[i])) break; // next top-level key ends the list
  }
  return false;
}

// Scan a tasks directory for `status: ready` tasks and return each one's self-touch status. This is
// the AC1 static check over the READY pool: a ready task whose Touches lacks its own file is not
// dispatchable (the dispatch gate's `--self-touch` per-candidate check blocks it). Fixture tasks are
// skipped (not dispatchable by definition — ready-pool-check.ts excludes them as `fixture`).
export function scanReadyTasksSelfTouch(tasksDir) {
  const out = [];
  if (!fs.existsSync(tasksDir)) return out;
  for (const f of fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))) {
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    if (!/^status:\s*["']?ready["']?\s*$/m.test(raw)) continue;
    if (isFixtureTask(raw)) continue;
    const { ok, expected, entry } = selfTouchCheck(raw, id);
    out.push({ id, ok, expected, entry });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
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
  process.stderr.write("       touches-orthogonality-check.mjs --resolve [--root <dir>] <task.md>\n");
  process.stderr.write("       touches-orthogonality-check.mjs --self-touch [--root <dir>] <task.md>\n");
  process.stderr.write("       touches-orthogonality-check.mjs --self-touch-scan [--root <dir>]\n");
}

// --resolve mode: run the dispatch-eligibility resolve check over ONE task/charter file. Prints a
// per-entry resolution table and exits 1 iff the task's Touches are MAJORITY-missing (not eligible
// to dispatch). This is the mechanical hook fast-mode-loop-tick.md step 4 invokes before dispatching
// a `status:ready` candidate (gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files).
function mainResolve(args) {
  let root = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--resolve") continue;
    if (args[i] === "--root") { root = args[++i]; continue; }
    files.push(args[i]);
  }
  if (files.length !== 1) { usage(); return 2; }
  const file = files[0];
  if (!fs.existsSync(file)) { process.stderr.write(`ERROR: task not found: ${file}\n`); return 2; }
  const rootDir = root ? path.resolve(root) : findRepoRoot(path.resolve(path.dirname(file)));
  const r = checkTaskTouchesResolve(fs.readFileSync(file, "utf8"), rootDir);
  if (!r.hasSection) {
    process.stdout.write(`RESOLVE ${file}: no ## Touches section — no existence claims to verify\n`);
    return 0;
  }
  for (const res of r.results) {
    if (res.exists === null) process.stdout.write(`  skip (${res.tag}): ${res.path}\n`);
    else if (res.exists) process.stdout.write(`  ok:          ${res.path}\n`);
    else process.stdout.write(`  MISSING:     ${res.path}\n`);
  }
  process.stdout.write(
    `RESOLVE ${file}: ${r.missing}/${r.mustExist} non-tagged touches missing — ` +
    (r.majorityMissing ? "MAJORITY-MISSING (NOT dispatchable)" : "resolves (dispatchable)") + "\n",
  );
  return r.majorityMissing ? 1 : 0;
}

// --self-touch mode: verify ONE task's `## Touches` includes its own `tasks/<id>.md` WITHOUT the
// `(new)` annotation. This is the dispatch-gate eligibility check (fast-mode-loop-tick.md step 4,
// AC1 of gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence): a ready
// candidate whose Touches does not grant its own file is NOT dispatchable — the executing agent has
// no authorization to tick its AC boxes / paste its invoke evidence at completion.
function mainSelfTouch(args) {
  let root = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--self-touch") continue;
    if (args[i] === "--root") { root = args[++i]; continue; }
    files.push(args[i]);
  }
  if (files.length !== 1) { usage(); return 2; }
  const file = files[0];
  if (!fs.existsSync(file)) { process.stderr.write(`ERROR: task not found: ${file}\n`); return 2; }
  const body = fs.readFileSync(file, "utf8");
  const id = path.basename(file, ".md");
  const { ok, expected } = selfTouchCheck(body, id);
  if (ok) {
    process.stdout.write(`SELF-TOUCH ${file}: ok (Touches includes ${expected} without (new))\n`);
    return 0;
  }
  process.stdout.write(`SELF-TOUCH ${file}: MISSING ${expected} (without (new)) in ## Touches — not dispatchable\n`);
  return 1;
}

// --self-touch-scan mode: the AC1 static check over the READY pool — every `status: ready` task in
// `<root>/tasks/` must have its own file in Touches. Exits 1 when any ready task is missing it.
function mainSelfTouchScan(args) {
  let root = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--self-touch-scan") continue;
    if (args[i] === "--root") { root = args[++i]; continue; }
  }
  const rootDir = root ? path.resolve(root) : findRepoRoot(process.cwd());
  const rows = scanReadyTasksSelfTouch(path.join(rootDir, "tasks"));
  const missing = rows.filter((r) => !r.ok);
  for (const r of rows) {
    if (r.ok) process.stdout.write(`  ok:      ${r.id} (touches ${r.expected})\n`);
    else process.stdout.write(`  MISSING: ${r.id} (expected ${r.expected} in ## Touches without (new))\n`);
  }
  process.stdout.write(
    `SELF-TOUCH-SCAN: ${rows.length} ready task(s), ${missing.length} missing self-file entry — ` +
    (missing.length === 0 ? "all dispatchable" : "NOT all dispatchable (add tasks/<id>.md to each ## Touches)") + "\n",
  );
  return missing.length === 0 ? 0 : 1;
}

export async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--self-touch-scan")) return mainSelfTouchScan(args);
  if (args.includes("--self-touch")) return mainSelfTouch(args);
  if (args.includes("--resolve")) return mainResolve(args);
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
