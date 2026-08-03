// task-status-drift-check.ts — reports tasks whose ## Acceptance Criteria symbols already resolve in
// the codebase while the task still carries status todo/ready. The closeout gap in direct execution
// (fast mode): execute-milestone's Land phase writes task status back; direct dispatch has no
// equivalent step, so landed code + stale `todo` status misreports the board — 7 real cases measured
// 2026-08-02 (gap-recursive-guard-only-covers-multi-mechanism … gap-prepare-milestone-no-worktree-isolation).
//
// A DETECTOR, not an enforcer: "is this task done?" is not mechanically decidable (done vs ready
// depends on whether an AC needs a real dispatch, which a script cannot judge), so this reports
// SUSPECT tasks for human review, exits 0 ALWAYS, and never writes to tasks/**.
//
// Run:
//   node --experimental-strip-types experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts [--json]
//   node --experimental-strip-types plugin/scripts/task-status-drift-check.ts [--json]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseTask, extractSection } from "./task-schema.ts";
import { isDirectEntry } from "./gate-script-base.ts";

// Directories searched for AC-declared symbols (repo-root-relative) — the code surface a landed
// implementation would touch. Broad on purpose: a detector should over-match, the human decides.
const CODE_ROOTS = [
  "experiments/quay-perpetual-stream/scripts",
  "plugin/scripts",
  ".claude/workflows",
  "plugin/workflows",
  "packages/quay/src",
  "packages/quay-native/src",
  "packages/quay-github/src",
];

// Reverse-drift symbol bar: a done task is reverse-drift only when FEWER than half of its declared
// distinctive AC symbols resolve in code (the "mostly unresolved" bar, AC5). This comment and the
// constant are the single statement of the threshold — the OLD comment said "NONE resolve" while the
// code used 1/2; the implementation is kept and the comment aligned. Pinned by the 1/4-resolved
// fixture: 1/4 < 1/2 → still flagged; 2/4 = 1/2 → not.
export const REVERSE_SYMBOL_RATIO_MAX = 0.5;

// Roots that hold PIPELINE BOOKKEEPING, not implementation. The prepare/execute-milestone pipeline
// produces these (preparation receipts, plan docs, milestone journals, gate-event logs, the task's
// own file); a fast-mode (direct-dispatch) task NEVER produces them, so their absence proves
// nothing about whether the task's implementation landed. AC3: the code-root/bookkeeping partition
// is this named constant + the two predicate functions, not scattered boolean logic in the judgment.
export const BOOKKEEPING_ROOTS = [
  "milestones/",
  "docs/plans/",
  ".quay/",
  "receipts/",
  "tasks/",
];

// A Touches entry under a bookkeeping root is pipeline accounting, not implementation evidence.
// Everything else (packages/**, plugin/scripts|test|workflows|fixtures, experiments/.../scripts|
// test|fixtures, .claude/workflows, scripts/, orchestration/, docs/ outside docs/plans/) is
// implementation evidence: a code task touches code, and a fast-mode doc/metric task records its
// work in orchestration/ or docs/ — both prove the implementation landed when the file exists.
export function isBookkeepingTouchEntry(entry) {
  return BOOKKEEPING_ROOTS.some((root) => entry.startsWith(root));
}

export function isCodeTouchEntry(entry) {
  return !isBookkeepingTouchEntry(entry);
}

export function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("task-status-drift-check: no '.git' ancestor found starting from " + startDir);
    dir = parent;
  }
}

// Backticked identifiers in an AC section that look like NEW-code symbols. Only DISTINCTIVE names
// count: internal-camelCase / underscore / SCREAMING_SNAKE tokens (e.g. `planCheckNextAction`,
// `_rawSplitTriggers`, `_splitCheck()`). Single generic words (`findings`, `test`, `quay`) and file
// basenames (`loader.ts`) are weak signals — the file existing says nothing about the WORK landing,
// and generic words match everywhere. This selectivity is what keeps genuinely-unlanded tasks from
// being flagged (AC2). Call parens are stripped (`_splitCheck()` → `_splitCheck`).
export function extractSymbolCandidates(acSection) {
  if (!acSection) return [];
  const backticked = acSection.match(/`([^`]+)`/g) ?? [];
  const out = [];
  for (const bt of backticked) {
    const trimmed = bt.slice(1, -1).trim().replace(/\(\)$/, "");
    if (!/^_?[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) continue;
    if (isDistinctiveName(trimmed)) out.push(trimmed);
  }
  return [...new Set(out)];
}

export function isDistinctiveName(id) {
  return /[a-z][A-Z]/.test(id) // camelCase / PascalCase internal boundary
    || /_/.test(id)            // underscore internals (`_splitCheck`, `task_write`)
    || /[A-Z]{2,}/.test(id);   // SCREAMING_SNAKE constants
}

// Word-boundary symbol search across the code roots (grep -w; vendored/milestone/build trees are
// excluded). A symbol "resolves" only if it appears in a SMALL number of files (default ≤ 8) — a
// distinctive landing marker lives in few files, while infrastructure words (`runId`, `task_write`)
// recur across many and are excluded as non-distinctive.
export function resolveSymbol(ident, repoRoot, opts = {}) {
  const maxFiles = opts.maxFiles ?? 8;
  const roots = (opts.roots ?? CODE_ROOTS).map((r) => path.resolve(repoRoot, r)).filter((r) => fs.existsSync(r));
  if (roots.length === 0) return false;
  try {
    const out = execFileSync("grep", [
      "-rlw",
      "--exclude-dir=node_modules", "--exclude-dir=dist", "--exclude-dir=vendor",
      "--exclude-dir=milestones", "--exclude-dir=worktrees", "--exclude-dir=.git",
      "--exclude=*.test.*",
      ident, ...roots,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const fileCount = out.trim().split("\n").filter(Boolean).length;
    return fileCount > 0 && fileCount <= maxFiles;
  } catch {
    return false; // grep exits 1 on zero matches
  }
}

function globHasMatch(glob, repoRoot) {
  const stack = [repoRoot];
  let visited = 0;
  while (stack.length > 0 && visited < 20000) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (["node_modules", "dist", "vendor", "milestones", ".git", "worktrees"].includes(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
      visited++;
      if (ent.isDirectory()) { stack.push(abs); continue; }
      try { if (path.matchesGlob(rel, glob)) return true; } catch { /* malformed glob → not a match */ }
    }
  }
  return false;
}

function entryExists(entry, repoRoot) {
  if (entry.includes("*") || entry.includes("?")) return globHasMatch(entry, repoRoot);
  return fs.existsSync(path.join(repoRoot, entry));
}

// Touches entries commonly carry trailing parenthetical annotations — `(new)`, `(extract from)`,
// `(update imports)`, `(refactor Verify phase)` — that are NOT part of the path. Strip a trailing
// "(…)" suffix so an existing file resolves; without this a landed task's entry is treated as
// missing (a false reverse-drift / a missed forward-drift signal).
function stripTouchAnnotation(entry) {
  return entry.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Parse a task's ## Touches bullet list into bare path/glob strings (backticks/quotes removed,
// trailing "(…)" annotations stripped). Returns [] for a missing section.
//
// The annotation can sit EITHER outside the backticks (`` `path/foo.ts` (extract from) ``) or inside
// them (`` `path/foo.ts (new)` ``), so quotes are stripped before AND after the annotation strip —
// stripping only before leaves the annotation masked by the trailing backtick in the first form;
// stripping only after misses the inside-the-backticks form.
export function parseTouchEntries(touchesSection) {
  if (!touchesSection) return [];
  return touchesSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()) // surrounding quotes/backticks first
    .map(stripTouchAnnotation)                                  // then trailing "(…)"
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()) // then any backtick the annotation masked
    .filter(Boolean);
}

// Parse a task's ## Touches bullet list and check every entry exists on disk (glob entries match at
// least one file). A Touches section that parses to zero entries is treated as not-all-exist
// (conservative — the section claims nothing and therefore proves nothing).
export function touchesAllExist(touchesSection, repoRoot) {
  if (!touchesSection) return true; // no Touches section → vacuous (unchanged, forward direction)
  const entries = parseTouchEntries(touchesSection);
  if (entries.length === 0) return false;
  return entries.every((e) => entryExists(e, repoRoot));
}

// Reverse-drift CODE-LANDING evidence (AC4): does ANY non-bookkeeping (implementation) Touches entry
// exist on disk? The reverse-drift judgment uses THIS, not `touchesAllExist`:
//   - no ## Touches section → no code-landing evidence (the section is absent, so nothing to weigh).
//   - section parses to zero entries, or only bookkeeping entries → false (fail-closed: the task
//     provides ZERO implementation evidence — AC6).
//   - at least one code-root entry exists → true (implementation landed → NOT reverse-drift).
//   - all code-root entries absent → false (implementation never landed → reverse-drift candidate).
export function hasAnyCodeRootTouch(touchesSection, repoRoot) {
  if (!touchesSection) return false;
  const codeEntries = parseTouchEntries(touchesSection).filter((e) => isCodeTouchEntry(e));
  return codeEntries.some((e) => entryExists(e, repoRoot));
}

// A done task whose `children:` are ALL `done` is a parent whose implementation IS the children's
// work (DIR-126 delegates its Touches to `[[DIR-126-A]]`…`[[DIR-126-E]]`). Reverse-drift asks "did
// the implementation land?" — for such a parent the answer is "in its children", so it is not a
// reverse-drift case even when its own Touches are bookkeeping-only. A parent with an un-done child
// is NOT skipped: that is a prematurely-closed parent, which reverse-drift should still surface.
export function hasDoneChildren(rawTask, tasksDir) {
  const m = rawTask.match(/^children:\s*\n((?:\s+- .+\n?)*)/m);
  if (!m) return false;
  const ids = m[1].split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.slice(1).trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  if (ids.length === 0) return false;
  return ids.every((id) => {
    const file = path.join(tasksDir, `${id}.md`);
    if (!fs.existsSync(file)) return false;
    return /^status:\s*done/m.test(fs.readFileSync(file, "utf8"));
  });
}

// Scan the task store for status-drift suspects. ratioFloor is the fraction of AC symbols that must
// resolve before a task is even considered (a lone coincidental match must not flag). `roots`
// overrides the symbol-search roots (repo-root-relative OR absolute) — tests pass synthetic roots.
//
// Two drift directions:
//   status-drift-suspect:  todo/ready but code is in the tree (task should be closed).
//   reverse-drift-suspect: done but the code never landed — AC symbols are mostly UNRESOLVED AND no
//     code-root Touches file exists. The mirror image of the leak above (the RED test for
//     no-size-aware-routing-A was silenced without restoring its status — the exact class this
//     catches). Bookkeeping paths (milestones/**, docs/plans/**, .quay/**, receipts/**, tasks/**)
//     are pipeline artifacts a fast-mode task never produces — their absence is ignored (AC4).
export function scanTasks({ repoRoot, tasksDir = path.join(repoRoot, "tasks"), ratioFloor = 0.6, roots = CODE_ROOTS }) {
  const suspects = [];
  const reverse = [];
  let taskFiles;
  try { taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")); } catch { return { suspects, reverse, scanned: 0 }; }
  for (const f of taskFiles) {
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const statusMatch = raw.match(/^status:\s*(\S+)/m);
    const status = statusMatch ? statusMatch[1] : "unknown";
    const ac = extractSection(raw, "Acceptance Criteria");
    const touchesSection = extractSection(raw, "Touches");
    const candidates = extractSymbolCandidates(ac);
    if (status === "done") {
      // Reverse drift: a done task whose implementation never landed. Signal = distinctive AC
      // symbols are mostly UNRESOLVED (fewer than half resolve — REVERSE_SYMBOL_RATIO_MAX, AC5) AND
      // no code-root Touches entry exists (AC4). The Touches judgment counts only CODE-ROOT entries:
      // a fast-mode task's bookkeeping paths (milestones/**, docs/plans/**, .quay/**, receipts/**)
      // never exist in direct dispatch, so their absence proves nothing about the implementation.
      //
      // Not judgeable → skip (the OLD detector's deliberate rule, preserved): a done task with NO
      // ## Touches section cannot be cross-checked by the symbol signal alone, and pre-convention
      // done tasks predate Touches entirely — flagging them is noise (measured: DIR-044, DIR-073,
      // exp5-DEFECT-*, … all have landed code but no Touches). A Touches section that parses to
      // ZERO entries, or to only bookkeeping entries, IS judged fail-closed (proves nothing — AC6).
      const tAll = touchesAllExist(touchesSection, repoRoot);
      const matched = candidates.filter((c) => resolveSymbol(c, repoRoot, { roots }));
      const codeTouchExists = hasAnyCodeRootTouch(touchesSection, repoRoot);
      const noCode = touchesSection != null
        && !codeTouchExists
        && !hasDoneChildren(raw, tasksDir)
        && candidates.length > 0
        && (matched.length / candidates.length) < REVERSE_SYMBOL_RATIO_MAX;
      if (noCode) {
        reverse.push({
          taskId: f.replace(/\.md$/, ""),
          status,
          matchedSymbols: matched,
          totalSymbols: candidates.length,
          codeTouchExists,
          touchesAllExist: tAll,
        });
      }
      continue;
    }
    if (status !== "todo" && status !== "ready") continue;
    if (candidates.length === 0) continue;
    const matched = candidates.filter((c) => resolveSymbol(c, repoRoot, { roots }));
    const ratio = matched.length / candidates.length;
    const tAll = touchesAllExist(touchesSection, repoRoot);
    if (ratio >= ratioFloor && tAll) {
      suspects.push({
        taskId: f.replace(/\.md$/, ""),
        status,
        matchedSymbols: matched,
        totalSymbols: candidates.length,
        touchesAllExist: tAll,
      });
    }
  }
  return { suspects, reverse, scanned: taskFiles.length };
}

// ── Report formatting (pure — unit-tested) ────────────────────────────────────────────────────────
export function formatJsonReport(suspects, reverse, scanned) {
  return JSON.stringify({
    suspects: suspects.map((s) => ({ taskId: s.taskId, matchedSymbols: s.matchedSymbols, touchesAllExist: s.touchesAllExist })),
    reverse: reverse.map((s) => ({ taskId: s.taskId, matchedSymbols: s.matchedSymbols, codeTouchExists: s.codeTouchExists, touchesAllExist: s.touchesAllExist })),
    scanned,
  }, null, 2) + "\n";
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
export function main(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  let repoRoot;
  try { repoRoot = findRepoRoot(process.cwd()); } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    return 0;
  }
  const { suspects, reverse, scanned } = scanTasks({ repoRoot });
  if (json) {
    process.stdout.write(formatJsonReport(suspects, reverse, scanned));
  } else {
    if (suspects.length === 0 && reverse.length === 0) {
      process.stdout.write(`task-status-drift: no suspects among ${scanned} tasks (todo/ready drift + done-reverse-drift both clean)\n`);
    } else {
      if (suspects.length > 0) {
        process.stdout.write(`task-status-drift: ${suspects.length} SUSPECT task(s) with code already in the tree but status not closed (${scanned} todo/ready scanned)\n`);
        for (const s of suspects) {
          process.stdout.write(`  status-drift-suspect: ${s.taskId} (status ${s.status}, ${s.matchedSymbols.length}/${s.totalSymbols} symbols resolved, touchesAllExist=${s.touchesAllExist})\n`);
        }
        process.stdout.write("  → human review: set status to done (all ACs test-proven) or ready (an AC requires a real dispatch)\n");
      }
      if (reverse.length > 0) {
        process.stdout.write(`task-status-drift: ${reverse.length} REVERSE-drift suspect(s) — status done but the implementation never landed (no code-root Touches file exists, AC symbols mostly unresolved)\n`);
        for (const s of reverse) {
          process.stdout.write(`  reverse-drift-suspect: ${s.taskId} (status ${s.status}, ${s.matchedSymbols.length}/${s.totalSymbols} symbols resolved, codeTouchExists=${s.codeTouchExists}, touchesAllExist=${s.touchesAllExist})\n`);
        }
        process.stdout.write("  → human review: set status back to todo (code never landed) or finish the implementation\n");
      }
    }
  }
  return 0; // ALWAYS 0 — report-only, never a gate
}

if (isDirectEntry(import.meta)) {
  process.exit(main(process.argv));
}
