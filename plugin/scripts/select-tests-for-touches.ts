// select-tests-for-touches.ts — gap-test-selection-not-scoped-to-touches: mechanical per-task test
// selection. `scripts/test.sh` runs the full suite (~600s measured 2026-08-02) or an explicitly named
// file; nothing in between. Under the ≤1-hour-per-task target the executor was selecting tests BY HAND
// (undocumented judgment: nothing records which tests were chosen, nothing verifies the choice covered
// the changed surface, and a wrong choice produces a green signal over an untested change). This module
// makes the selection mechanical and checkable: given a task id, emit the test files whose subject
// intersects that task's `## Touches`.
//
// Byte-identical mirror: experiments/quay-perpetual-stream/scripts/select-tests-for-touches.ts
// (symlink → ../../../plugin/scripts/select-tests-for-touches.ts).
//
// Resolution, most-specific first — each rule is deterministic and independently checkable:
//   1. Direct          — a Touches entry that is itself a `*.test.mjs` path → that file
//   2. Basename pair   — `<dir>/foo.ts` → any `*/test/foo.test.mjs` (the repo's dominant convention)
//   3. Mirror fold     — `experiments/quay-perpetual-stream/scripts/X.ts` and `plugin/scripts/X.ts`
//                        resolve to the SAME test set (mirrors are byte-identical by construction)
//   4. Declared extra  — an optional `## Test-Files` section in the task body, for coupling a basename
//                        convention cannot see
//   5. Unresolved      — a Touches entry matching no test is REPORTED, never silently dropped
//
// DESIGN NOTES (adversarial-review findings, kept intentional):
//   * Mirror fold (rule 3) is SUBSUMED by basename pairing — both mirror paths share a basename, so
//     `*/test/X.test.mjs` already folds them to the same set. It is kept as an explicit, tested rule
//     because the spec names it (AC4); it is not a behavior fork.
//   * Test files under `experiments/*/test/` ARE selectable by design — rule 2 is the literal
//     `*/test/foo.test.mjs`, which the spec defines, and those tests run fine in the real checkout
//     where dependencies are installed. The `scripts/test.sh` default glob not covering them is a
//     pre-existing suite-glob matter, out of this selector's scope.
//
// Parsing reuses `extractSection` from task-schema.ts (ADR-004 single-source — no second copy of the
// section-parsing regex). No new task-format surface.
//
// FAIL-LOUD on thin coverage: if a task's Touches resolve tests for fewer than half of the entries,
// the CLI exits non-zero with `test-selection-thin` unless `--allow-thin` is passed. Silent
// under-selection is the one failure mode that produces a false green, so it must be the loud one.
//
// Integration: `scripts/test.sh --for-task <id>` delegates to this selector and runs the resulting
// set (see the `--for-task` branch in scripts/test.sh). The full-suite default and the explicit-file
// form are both unchanged — additive.
//
// Run:
//   node --experimental-strip-types select-tests-for-touches.ts --task <id> [--root <dir>] [--json] [--paths-only] [--allow-thin]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractSection } from "./task-schema.ts";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

// Directories skipped when scanning the repo for test files (VCS / deps / runtime state).
// `worktrees` is excluded because `milestones/M*/worktrees/` are per-milestone git worktrees
// checked out from the SAME repo — their plugin/test files are byte-identical mirrors of the main
// checkout, so scanning them makes the selector resolve each mirrored test TWICE (observed
// 2026-08-02: an M243 worktree residue made `--for-task gap-test-selection-...` select 2 copies of
// select-tests-for-touches.test.mjs). The main checkout under `milestones/M*/worktrees/` is not a
// distinct test source; skipping it is the mirror-fold rule applied to worktree mirrors.
const SKIP_DIRS = new Set([".git", "node_modules", ".quay", ".workflow-events", "worktrees"]);
// The two mirror root prefixes (single-source mirror convention: `experiments/…/scripts/X` ↔
// `plugin/scripts/X`). Only these two scripts dirs are mirrors — tests under the experiments test dir
// are NOT folded (they are not in the `scripts/test.sh` default glob).
const EXP_SCRIPTS_PREFIX = "experiments/quay-perpetual-stream/scripts/";
const PLUGIN_SCRIPTS_PREFIX = "plugin/scripts/";
// Thin-coverage threshold: <50% of Touches entries resolving to ≥1 test is treated as under-selection.
export const THIN_COVERAGE_RATIO = 0.5;

// ── Repo-root detection ──────────────────────────────────────────────────────────────────────────────

/**
 * Find the workspace root by walking up from `startDir` (`.quay/config.yml` marker), with a git
 * top-level fallback (mirrors fast-mode-telemetry.ts's findRepoRoot).
 * @param {string} [startDir]
 * @returns {string}
 */
export function findRepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a repo-relative path or glob: forward slashes, strip a leading `./`, collapse `//`,
 * resolve `.`/`..` segments, drop a trailing `/`. Wildcards are preserved untouched. This is the
 * single normalization the resolver uses so path-shape tricks (`./`, `//`, trailing `/`) cannot
 * spoof identity.
 * @param {string} p
 * @returns {string}
 */
export function normalizeRel(p) {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

/**
 * True iff the repo-relative path names a `.test.mjs` file (the runnable-by-`scripts/test.sh` kind).
 * @param {string} rel
 * @returns {boolean}
 */
export function isTestFilePath(rel) {
  return rel.endsWith(".test.mjs");
}

/**
 * Basename-pair rule: `foo.ts` (or `foo.mjs`, `foo.js`, …) → `foo.test.mjs`. Strips ONE trailing
 * extension then appends `.test.mjs`. A `.test.mjs` path is returned unchanged (it IS a test file).
 * @param {string} rel
 * @returns {string}
 */
export function testBasenameFor(rel) {
  const base = path.posix.basename(normalizeRel(rel));
  if (base.endsWith(".test.mjs")) return base;
  // Collapse a `.test.` marker so `foo.test.ts` → `foo.test.mjs` (never `foo.test.test.mjs`).
  const noMarker = base.replace(/\.test\./, ".");
  const noExt = noMarker.replace(/\.[^./]+$/, "");
  return `${noExt}.test.mjs`;
}

/**
 * Mirror-fold sibling: given `experiments/quay-perpetual-stream/scripts/X.ts`, return
 * `plugin/scripts/X.ts` (and vice versa); null for a non-mirror path.
 * @param {string} rel
 * @returns {string | null}
 */
export function siblingMirror(rel) {
  const n = normalizeRel(rel);
  if (n.startsWith(EXP_SCRIPTS_PREFIX)) return PLUGIN_SCRIPTS_PREFIX + n.slice(EXP_SCRIPTS_PREFIX.length);
  if (n.startsWith(PLUGIN_SCRIPTS_PREFIX)) return EXP_SCRIPTS_PREFIX + n.slice(PLUGIN_SCRIPTS_PREFIX.length);
  return null;
}

// ── Test-file index ──────────────────────────────────────────────────────────────────────────────────

/**
 * Scan `root` for every `*.test.mjs` file that lives under a path segment `test` (the repo's
 * `packages/<pkg>/test/`, `plugin/test/`, `experiments/…/test/` convention). Returns:
 *   { byBasename: Map<basename, Set<repoRelPath>>, allPaths: Set<repoRelPath> }
 * `allPaths` powers the DIRECT rule; `byBasename` powers the basename-pair + mirror-fold rules.
 * @param {string} root
 */
export function indexTestFiles(root) {
  const byBasename = new Map();
  const allPaths = new Set();
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
      } else if (e.isFile() && e.name.endsWith(".test.mjs")) {
        const relpath = rel ? `${rel}/${e.name}` : e.name;
        if (!relpath.split("/").includes("test")) continue; // must be under a test/ dir
        allPaths.add(relpath);
        if (!byBasename.has(e.name)) byBasename.set(e.name, new Set());
        byBasename.get(e.name).add(relpath);
      }
    }
  };
  walk(root, "");
  return { byBasename, allPaths };
}

// ── Bullet-section parsing ───────────────────────────────────────────────────────────────────────────

/**
 * Parse the bullet lines of a markdown section body (`## Touches` / `## Test-Files`). Accepts `- `
 * and `* ` bullets; strips inline-code backticks, a leading `./`, and trailing `(… )` annotations
 * (e.g. `packages/x.js (rewrite)` → `packages/x.js` — the annotation is not part of the path).
 * @param {string} sectionText
 * @returns {string[]}
 */
export function parseBulletList(sectionText) {
  const entries = [];
  for (const raw of String(sectionText).split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!m) continue;
    let e = m[1].trim();
    e = e.replace(/^`+|`+$/g, "").trim();
    e = e.replace(/^\.\//, "");
    e = e.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (e) entries.push(e);
  }
  return entries;
}

// ── Single-entry resolution ──────────────────────────────────────────────────────────────────────────

/**
 * Resolve ONE Touches entry against the test index, most-specific rule first:
 *   1. direct `*.test.mjs` path, then
 *   2. basename pair, augmented by
 *   3. mirror fold (the sibling mirror's basename pair — identical set, but explicit).
 * Returns `{ matched: true, selected: string[] }` or `{ matched: false, reason: string }`.
 * @param {string} entry
 * @param {{byBasename: Map<string, Set<string>>, allPaths: Set<string>}} index
 */
export function resolveEntry(entry, index) {
  const rel = normalizeRel(entry);
  if (!rel) return { matched: false, reason: `empty Touches entry "${entry}"` };

  // Rule 1 — direct *.test.mjs path.
  if (isTestFilePath(rel)) {
    if (index.allPaths.has(rel)) {
      return { matched: true, selected: [rel] };
    }
    return { matched: false, reason: `"${rel}" is a *.test.mjs path but no such indexed test file exists` };
  }

  // Rules 2 + 3 — basename pair, with the mirror fold adding the sibling's basename pair.
  const candidates = new Set();
  const tb = testBasenameFor(rel);
  for (const p of index.byBasename.get(tb) || []) candidates.add(p);
  const mirror = siblingMirror(rel);
  if (mirror) {
    const tbMirror = testBasenameFor(mirror);
    for (const p of index.byBasename.get(tbMirror) || []) candidates.add(p);
  }
  if (candidates.size > 0) {
    return { matched: true, selected: [...candidates].sort() };
  }
  return { matched: false, reason: `no */test/${tb} found for "${rel}"` };
}

// ── Task-level selection ─────────────────────────────────────────────────────────────────────────────

/**
 * Select test files for one task body. Returns:
 *   { taskId, selected, unresolved, coverageRatio, touchesTotal, resolvedTouches }
 * `selected` is the sorted, de-duplicated set of repo-relative test paths. `unresolved` is the sorted
 * list of `{ entry, reason }` for Touches entries (and declared-but-missing ## Test-Files) that
 * matched no test. `coverageRatio` = resolvedTouches / touchesTotal (0 when the task has no Touches).
 * @param {string} taskBody
 * @param {string} taskId
 * @param {{byBasename: Map<string, Set<string>>, allPaths: Set<string>}} index
 */
export function selectTestsForTask(taskBody, taskId, index) {
  const touchesSec = extractSection(taskBody, "Touches");
  const touches = touchesSec ? parseBulletList(touchesSec) : [];
  const declaredSec = extractSection(taskBody, "Test-Files");
  const declared = declaredSec ? parseBulletList(declaredSec) : [];

  const selected = new Set();
  const unresolved = [];
  let resolvedTouches = 0;

  for (const entry of touches) {
    const r = resolveEntry(entry, index);
    if (r.matched) {
      resolvedTouches++;
      for (const p of r.selected) selected.add(p);
    } else {
      unresolved.push({ entry, reason: r.reason });
    }
  }

  // Rule 4 — declared ## Test-Files: add each existing test path; report a missing one, never drop it.
  for (const t of declared) {
    const rel = normalizeRel(t);
    if (rel && isTestFilePath(rel) && index.allPaths.has(rel)) {
      selected.add(rel);
    } else {
      unresolved.push({ entry: t, reason: `declared ## Test-Files path "${rel}" not found` });
    }
  }

  const touchesTotal = touches.length;
  const coverageRatio = touchesTotal > 0 ? resolvedTouches / touchesTotal : 0;

  return {
    taskId,
    selected: [...selected].sort(),
    unresolved: unresolved.sort((a, b) => a.entry.localeCompare(b.entry)),
    coverageRatio,
    touchesTotal,
    resolvedTouches,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `select-tests-for-touches.ts — mechanical per-task test selection (gap-test-selection-not-scoped-to-touches)

Usage:
  node --experimental-strip-types select-tests-for-touches.ts --task <id> [--root <dir>] [--json] [--paths-only] [--allow-thin]

Resolution rules (most-specific first):
  1. Direct       — a Touches entry that is itself a *.test.mjs path
  2. Basename pair — <dir>/foo.ts → any */test/foo.test.mjs
  3. Mirror fold   — experiments/quay-perpetual-stream/scripts/X.ts and plugin/scripts/X.ts fold to the same test set
  4. Declared extra — an optional ## Test-Files section in the task body
  5. Unresolved     — a Touches entry matching no test is REPORTED, never silently dropped

Exit codes:
  0  selected set emitted (or thin + --allow-thin)
  1  test-selection-thin: <50% of Touches resolved to a test (pass --allow-thin to run anyway)
  2  usage error / task file not found`;

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/**
 * CLI main. @param {string[]} argv — process.argv @returns {number} exit code
 */
export function main(argv) {
  const args = argv.slice(2);
  const taskId = getArgValue(args, "--task");
  const rootArg = getArgValue(args, "--root");
  const asJson = args.includes("--json");
  const pathsOnly = args.includes("--paths-only");
  const allowThin = args.includes("--allow-thin");

  if (!taskId) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const root = path.resolve(rootArg ?? findRepoRoot());
  const taskFile = path.join(root, "tasks", `${taskId}.md`);
  if (!fs.existsSync(taskFile)) {
    process.stderr.write(`select-tests-for-touches: task file not found: ${taskFile}\n`);
    return 2;
  }

  const taskBody = fs.readFileSync(taskFile, "utf8");
  const index = indexTestFiles(root);
  const result = selectTestsForTask(taskBody, taskId, index);
  const thin = result.coverageRatio < THIN_COVERAGE_RATIO;

  if (asJson) {
    // AC7 contract: exactly {taskId, selected, unresolved, coverageRatio}.
    process.stdout.write(
      JSON.stringify({
        taskId: result.taskId,
        selected: result.selected,
        unresolved: result.unresolved,
        coverageRatio: result.coverageRatio,
      }, null, 2) + "\n",
    );
  } else if (pathsOnly) {
    for (const p of result.selected) process.stdout.write(`${p}\n`);
  } else {
    process.stdout.write(`task ${result.taskId}: ${result.selected.length} test file(s)\n`);
    for (const p of result.selected) process.stdout.write(`  ${p}\n`);
    if (result.unresolved.length > 0) {
      process.stdout.write(`unresolved (${result.unresolved.length}):\n`);
      for (const u of result.unresolved) process.stdout.write(`  ${u.entry} — ${u.reason}\n`);
    }
    process.stdout.write(
      `coverage: ${result.coverageRatio.toFixed(2)} (${result.resolvedTouches}/${result.touchesTotal} Touches resolved)\n`,
    );
  }

  if (thin) {
    const msg = `test-selection-thin: task ${result.taskId} resolved tests for ${result.resolvedTouches}/${result.touchesTotal} Touches entries (${result.coverageRatio.toFixed(2)}) < ${THIN_COVERAGE_RATIO}; pass --allow-thin to run anyway`;
    if (!allowThin) {
      process.stderr.write(`${msg}\n`);
      return 1;
    }
    // --allow-thin: downgrade to a WARNING on stderr, exit 0 (AC9).
    process.stderr.write(`warning: ${msg}\n`);
  }
  return 0;
}

// ── Direct-entry check ──────────────────────────────────────────────────────────────────────────────

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
