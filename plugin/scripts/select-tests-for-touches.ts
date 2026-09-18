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
//   5. Cross-cut marker — gap-scoped-selection-blind-to-packaging-state-diff: cross-cut checkers
//                        (packaging-state / check-adr / lint) enter the scoped selection when a touch
//                        triggers them, REGARDLESS of basename pairing. A `packages/*/src` change can
//                        break the packaged artifact (npm-pack-e2e/build-dist/plugin-packaging) or ADR
//                        conformance (check-adr) while every src unit test stays green — basename
//                        pairing never selects those cross-cut tests, so a src-touching task used to
//                        go scoped-green and break packaged (archguard TASK-62/64/65/66, same pattern
//                        in three projects). The registry (CROSSCUT_CHECKS) is the single cross-cut
//                        surface — the same principle as "机制在一处做好、下游配置复用".
//   6. Unresolved      — a Touches entry matching no test is REPORTED, never silently dropped
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
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractSection } from "./task-schema.ts";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, normalizeRel, flagValue } from "./gate-script-base.ts";
// SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): the ONE Touches bullet parser.
import { parseTouchEntries } from "./touches-parser.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

// Directories skipped when scanning the repo for test files (VCS / deps / runtime state).
// `worktrees` is excluded because `milestones/M*/worktrees/` are per-milestone git worktrees
// checked out from the SAME repo — their plugin/test files are byte-identical mirrors of the main
// checkout, so scanning them makes the selector resolve each mirrored test TWICE (observed
// 2026-08-02: an M243 worktree residue made `--for-task gap-test-selection-...` select 2 copies of
// select-tests-for-touches.test.mjs). The main checkout under `milestones/M*/worktrees/` is not a
// distinct test source; skipping it is the mirror-fold rule applied to worktree mirrors.
const SKIP_DIRS = new Set([".git", "node_modules", ".quay", ".workflow-events", "worktrees", "archive"]);
// The two mirror root prefixes (single-source mirror convention: `experiments/…/scripts/X` ↔
// `plugin/scripts/X`). Only these two scripts dirs are mirrors — tests under the experiments test dir
// are NOT folded (they are not in the `scripts/test.sh` default glob).
const EXP_SCRIPTS_PREFIX = "experiments/quay-perpetual-stream/scripts/";
const PLUGIN_SCRIPTS_PREFIX = "plugin/scripts/";
// Thin-coverage threshold: <50% of Touches entries resolving to ≥1 test is treated as under-selection.
export const THIN_COVERAGE_RATIO = 0.5;

// ── Cross-cut registry (gap-scoped-selection-blind-to-packaging-state-diff) ──────────────────────────

/**
 * Cross-cut checks that basename pairing CANNOT see but a change still must satisfy. A task whose
 * touches trigger a cross-cut entry gets that entry's tests ADDED to the scoped selection regardless
 * of basename pairing — the "cross-cut marker" (AC2). The alternative (leaving these to the full-suite
 * gate) is how a src-touching task went scoped-green while breaking the packaged artifact
 * (npm-pack-e2e/build-dist), ADR conformance (check-adr), or lint (the archguard 14-error case —
 * TASK-66). Three projects, three checks, one mechanism — this registry is the single cross-cut
 * surface, reused by whichever project consumes the selector.
 *
 * Each entry: `{ name, trigger(rel) -> boolean, tests: string[] }`.
 *   * `tests` are repo-relative test paths; a path ABSENT from the index is skipped (cross-cut is a
 *     best-effort add-on — the real repo ships them; a minimal test workspace may not).
 *   * `name` is the marker emitted in the default CLI output (`crosscut: <name>…`).
 *   * `trigger` fires on a normalized repo-relative touch.
 */
export const CROSSCUT_CHECKS = [
  {
    // AC3 — a `packages/*/src` change can break the PACKAGED artifact while all src unit tests stay
    // green (basename pairing never matches npm-pack-e2e/build-dist/plugin-packaging to a src file).
    name: "packaging-state",
    trigger: (rel) => /^packages\/[^/]+\/src(\/|$)/.test(rel),
    tests: [
      "packages/quay/test/npm-pack-e2e.test.mjs",
      "packages/quay/test/build-dist.test.mjs",
      "plugin/test/plugin-packaging.test.mjs",
    ],
  },
  {
    // AC4 — a src / new-MCP-tool change must keep ADR conformance (archguard TASK-64/65/66: an MCP
    // tool without a canonical CLI flag passed scoped-green for three recurrences). Same src surface
    // as packaging-state, plus an explicit new-MCP-tool surface (`src/mcp-*.ts`).
    name: "check-adr",
    trigger: (rel) => /^packages\/[^/]+\/src(\/|$)/.test(rel) || /mcp[^/]*\.ts$/.test(rel),
    tests: [
      "packages/quay/test/adr-gate.test.mjs",
      "packages/quay/test/cli-adr.test.mjs",
      "packages/quay/test/mcp-adr.test.mjs",
      "packages/quay/test/adr-store.test.mjs",
    ],
  },
  {
    // AC5 — new code must be lint-clean. quay configures no linter, so `tests` is empty — the
    // cross-cut ENTRY still exists (a downstream project WITH a lint test selects it), and the author
    // SKILL.md template carries `lint-clean` in the cross-cut AC checklist (the in-task leg of AC5).
    name: "lint",
    trigger: (rel) => /\.(ts|js|mjs)$/.test(rel) && !rel.startsWith("tasks/") && !rel.startsWith("docs/"),
    tests: [],
  },
  {
    // gap-github-client-iscompound-sabotaged-uncommitted (AC4): a quay-github src change must run
    // quay-github's OWN gate-correctness tests in scoped mode. Basename pairing never selects them
    // (`github-client.ts` has no `*/test/github-client.test.mjs`), so a task that edits
    // `packages/quay-github/src/*` used to go scoped-green while a checkGate regression went
    // uncaught until the full-suite red window (the 2026-08-09 round-190 sabotage: `isCompound`
    // hardcoded false in an uncommitted working-tree edit). quay-github is the Provider reference
    // implementation; its gate surface (compound-gate / create-mcp / gate / gate-gameability /
    // task-check-passthrough) is the corresponding test set for ANY src change.
    name: "quay-github-src",
    trigger: (rel) => /^packages\/quay-github\/src(\/|$)/.test(rel),
    tests: [
      "packages/quay-github/test/compound-gate.test.mjs",
      "packages/quay-github/test/create-mcp.test.mjs",
      "packages/quay-github/test/gate.test.mjs",
      "packages/quay-github/test/gate-gameability.test.mjs",
      "packages/quay-github/test/task-check-passthrough.test.mjs",
    ],
  },
];

/**
 * Apply the cross-cut registry to a task's touches: return the fired entry names (registry order,
 * deduped) and the union of their EXISTING test files. AC6: a pure plugin/doc task touches no entry
 * surface → fires nothing → adds no cross-cut tests (scoped stays sub-second).
 * @param {string[]} touches
 * @param {{byBasename: Map<string, Set<string>>, allPaths: Set<string>}} index
 * @returns {{names: string[], tests: string[]}}
 */
export function applyCrosscut(touches, index) {
  const names = [];
  const tests = new Set();
  for (const c of CROSSCUT_CHECKS) {
    if (touches.some((t) => c.trigger(normalizeRel(t)))) {
      names.push(c.name);
      for (const t of c.tests) {
        const rel = normalizeRel(t);
        if (index.allPaths.has(rel)) tests.add(rel);
      }
    }
  }
  return { names, tests: [...tests].sort() };
}

// ── Repo-root detection ──────────────────────────────────────────────────────────────────────────────


// ── Path helpers ──────────────────────────────────────────────────────────────────────────────────────

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
 *
 * SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): this is a pure delegate to the ONE
 * shared Touches bullet parser (parseTouchEntries in touches-parser.ts). The naive inline copy
 * stripped backticks only at the line's start/end, so `` `x.ts` (new) `` kept a residual trailing
 * backtick after the annotation strip (the exact bug this task kills). No second copy lives here.
 * @param {string} sectionText
 * @returns {string[]}
 */
export function parseBulletList(sectionText) {
  return parseTouchEntries(sectionText);
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

  // Rule 5 — cross-cut marker (gap-scoped-selection-blind-to-packaging-state-diff): cross-cut
  // checkers (packaging-state / check-adr / lint) enter the scoped selection when a touch triggers
  // them, REGARDLESS of basename pairing. Additive — never counts toward coverageRatio (the ratio
  // stays "touches that resolved to their OWN test"; the cross-cut is the changed surface's
  // cross-cutting coverage, not a per-touch resolution).
  const crosscut = applyCrosscut(touches, index);
  for (const p of crosscut.tests) selected.add(p);

  const touchesTotal = touches.length;
  const coverageRatio = touchesTotal > 0 ? resolvedTouches / touchesTotal : 0;

  return {
    taskId,
    selected: [...selected].sort(),
    unresolved: unresolved.sort((a, b) => a.entry.localeCompare(b.entry)),
    coverageRatio,
    touchesTotal,
    resolvedTouches,
    crosscut: crosscut.names,
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
  5. Cross-cut marker — cross-cut checkers (packaging-state / check-adr / lint) enter the scoped
                        selection when a touch triggers them, regardless of basename pairing
  6. Unresolved     — a Touches entry matching no test is REPORTED, never silently dropped

Exit codes:
  0  selected set emitted (or thin + --allow-thin)
  1  test-selection-thin: <50% of Touches resolved to a test (pass --allow-thin to run anyway)
  2  usage error / task file not found`;

/**
 * CLI main. @param {string[]} argv — process.argv @returns {number} exit code
 */
export function main(argv) {
  const args = argv.slice(2);
  const taskId = flagValue(args, "--task");
  const rootArg = flagValue(args, "--root");
  const asJson = args.includes("--json");
  const pathsOnly = args.includes("--paths-only");
  const allowThin = args.includes("--allow-thin");

  if (!taskId) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const root = path.resolve(rootArg ?? repoRoot());
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
    if (result.crosscut.length > 0) {
      // Cross-cut marker (gap-scoped-selection-blind-to-packaging-state-diff): the fired cross-cut
      // checkers, in registry order — the machine-readable "these tests entered scoped regardless of
      // basename pairing" line (Contract `invoke` greps it for check-adr / lint / crosscut).
      process.stdout.write(`crosscut: ${result.crosscut.join(", ")}\n`);
    }
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

if (isDirectEntry(import.meta, undefined, "select-tests-for-touches")) {
  process.exitCode = main(process.argv);
}
