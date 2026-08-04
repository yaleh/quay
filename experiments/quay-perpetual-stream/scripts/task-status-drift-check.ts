// task-status-drift-check.ts — the status-drift detector for the task store. It scans the FULL set of
// tasks (todo/ready AND done) for BOTH drift directions:
//   status-drift-suspect (todo/ready): ## Acceptance Criteria symbols resolve in the codebase while
//     the task still carries status todo/ready — the BENIGN direction ("should've been closed but
//     wasn't"; at worst a bookkeeping lag). The closeout gap in direct execution (fast mode):
//     execute-milestone's Land phase writes task status back; direct dispatch has no equivalent step,
//     so landed code + stale `todo` status misreports the board — 7 real cases measured 2026-08-02
//     (gap-recursive-guard-only-covers-multi-mechanism … gap-prepare-milestone-no-worktree-isolation).
//   closed-without-work (done): status `done` but 0 AC checkboxes checked — the DANGEROUS direction
//     ("closed without the work"; status written DIRECTLY, bypassing the gate). The scan surface used
//     to be only todo/ready (the count line claimed so), so a done task could never be verified as
//     having passed the gate. See tasks/gap-drift-check-only-looks-at-the-harmless-direction.
//   reverse-drift-suspect (done): code never landed — AC symbols mostly unresolved AND no code-root
//     Touches file exists (mirror image of the leak; see gap-reverse-drift-check-buries-true-positives-in-noise).
//
// A DETECTOR, not an enforcer: "is this task done?" is not mechanically decidable (done vs ready
// depends on whether an AC needs a real dispatch, which a script cannot judge), so this reports
// SUSPECT tasks for human review, exits 0 ALWAYS, and never writes to tasks/**.
//
// ALSO the stranded-branch alarm channel (gap-stranded-worktree-branches-have-no-alarm-channel):
// `--stranded` enumerates `milestone/*` and `task/*` branches and reports any holding work that is
// NOT cleanly merged into master (commits ahead, or merged-then-reverted). A silent fail-closed
// (Land fails closed and preserves the branch, but nothing ever reports it — 24,989 lines stranded
// 2026-08-01) is exactly the class this closes. restart-readiness-check.sh and the outer tick both
// invoke `--stranded` so a stranded branch shows up mechanically, not by accident.
//
// Run:
//   node --experimental-strip-types experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts [--json] [--stranded]
//   node --experimental-strip-types plugin/scripts/task-status-drift-check.ts [--json] [--stranded]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseTask, extractSection } from "./task-schema.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): the ONE Touches bullet parser.
import { stripTouchAnnotation, parseTouchEntries } from "./touches-parser.ts";
export { stripTouchAnnotation, parseTouchEntries };

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

// Count GFM checkbox boxes in an AC section (`- [ ]`, `- [x]`, `- [X]`, `- [~]`). The acceptance gate
// reads `- [x]` boxes (only a checked box passes), so a `done` task with boxes but ZERO checked could
// NOT have passed the gate as written — status was written directly (the DANGEROUS drift direction,
// gap-drift-check-only-looks-at-the-harmless-direction). `[~]` (partial) counts as unchecked, matching
// the gate semantics. This is the decisive closed-without-work signal: it uses the gate's own language
// (checkboxes), not fragile symbol resolution.
export function countAcCheckboxes(acSection) {
  if (!acSection) return { total: 0, checked: 0, unchecked: 0 };
  const boxes = acSection.match(/^\s*-\s+\[(.)\]/gm) ?? [];
  let checked = 0;
  for (const b of boxes) if (/\[[xX]\]/.test(b)) checked++;
  return { total: boxes.length, checked, unchecked: boxes.length - checked };
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

// ── Touches bullet parsing — SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority) ──────────
// The ONE implementation lives in touches-parser.ts (stripTouchAnnotation + parseTouchEntries),
// imported and re-exported above. The reverse-drift check's parser was the "already-correct" one,
// so it became the canonical shared module; every other parser now delegates to it.

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

/** Does ANY `(new)`-marked Touches file exist on disk? A `(new)` touch declares a file the task
 * will CREATE — its existence on master means the task created it ⇒ the work landed
 * (gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks). Touches that
 * modify EXISTING files are NOT landing evidence: the file exists whether or not this task's
 * work landed, so only the task's own symbols (the other signal) can prove it. */
function hasAnyLandedNewTouch(touchesSection, repoRoot) {
  if (!touchesSection) return false;
  return touchesSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .some((bullet) => {
      if (!/(\(new\)|（新）)/i.test(bullet)) return false;
      return parseTouchEntries(bullet).some((e) => entryExists(e, repoRoot));
    });
}

// Reusable "the task's declared work has landed on master" predicate — exported for reuse by
// ready-pool-check.ts's notYetFlipped (gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool,
// AC6: reuse the drift-check signal, never a parallel copy). A task's work is judged landed when
// EITHER of the drift-check's two landing-evidence signals fires:
//   - symbol: its distinctive backticked AC identifiers resolve in the code roots (the forward
//     status-drift signal — a landed implementation backticks its own identifiers in its ACs); or
//   - touch: a task-CREATED file (`(new)`-marked Touches entry) now exists on disk — the task
//     created it ⇒ landed (hasAnyLandedNewTouch).
// Existing-file Touches entries are DELIBERATELY NOT landing evidence: a task that modifies a file
// which already exists on master is indistinguishable from an un-landed task by file existence —
// the file is there regardless — so only its own symbols can prove it landed (the overshoot fix,
// gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks). OR-composed so a
// merged-not-flipped task is caught by whichever signal it shows. Does NOT depend on AC checkbox
// state — the fan-in merges without ticking boxes, so checkbox state is not the closeout signal.
export function taskWorkLanded(rawTaskText, repoRoot, opts = {}) {
  const ac = extractSection(rawTaskText, "Acceptance Criteria");
  const candidates = extractSymbolCandidates(ac);
  const matched = candidates.filter((c) => resolveSymbol(c, repoRoot, { roots: opts.roots }));
  const ratio = candidates.length === 0 ? 0 : matched.length / candidates.length;
  const symbolResolved = candidates.length > 0 && ratio >= (opts.ratioFloor ?? 0.6);
  const touchesSection = extractSection(rawTaskText, "Touches");
  const touchLanded = hasAnyLandedNewTouch(touchesSection, repoRoot);
  return symbolResolved || touchLanded;
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

// ── Stranded-branch check (gap-stranded-worktree-branches-have-no-alarm-channel) ────────────────
// A worktree branch holds STRANDED WORK when it is not cleanly merged into master. This classification
// REUSES the three-gate criterion validated by gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion
// VERBATIM (deliberately NOT rewritten here — the reclaim task's AC1/AC2 already settled the criterion):
//   Gate 1 (merged?)  `git merge-base --is-ancestor <b> master` — every branch commit in master?
//   Gate 2 (reverted?) Only a --no-ff MERGE can be reverted (`git revert <merge>` keeps the merge
//     commit in master history while deleting its files, so Gate 1 still passes). A branch
//     fast-forwarded onto master's FIRST-PARENT chain has no separate merge commit and cannot be
//     merged-then-reverted — later deletions of its files are ordinary evolution. A merge-entered
//     branch (tip NOT on first-parent) IS merged-then-reverted iff the files ITS merge added
//     (`git diff --name-only --diff-filter=A <merge>^1..<merge>`) are missing from master's CURRENT
//     tree (`git cat-file -e master:<f>`).
//   Gate 3 (clean?)    `git status --porcelain` INSIDE the branch's worktree must be empty.
// Classifications:
//   has-commits          — commits ahead of master (Gate 1 false) → STRANDED (real work preserved)
//   merged-then-reverted — Gate 2 missing files → STRANDED (content reverted away from master)
//   has-uncommitted      — Gate 3 non-empty → worktree holds live work (reported; never deleted)
//   merged-clean         — Gates 1+2+3 safe → NOT reported (a normal --clean-stale target)
function gitTry(repoRoot, args, cwd) {
  try {
    const out = execFileSync("git", args, {
      cwd: cwd || repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message ?? "").trim() };
  }
}

// Branch names that carry live milestone/task work — the ONLY namespaces the stranded alarm scopes
// to. Legacy experiment-*/worktree-wf_*/salvage/* branches are historical, not live worktrees.
export function listWorkBranches(repoRoot) {
  const r = gitTry(repoRoot, ["branch", "--list", "milestone/*", "task/*"]);
  if (!r.ok) return [];
  return r.out.split("\n").map((l) => l.trim().replace(/^[*+]\s*/, "")).filter(Boolean);
}

// Find the merge commit on master whose SECOND parent is branchTip (the worktree Land flow's
// `git merge --no-ff <branch>` always puts the branch tip as the second parent — matching only
// parts[2] provably selects the branch's own Land merge), then return the merge-added files that are
// missing from master's CURRENT tree (a `git revert` of the merge removes exactly those files).
function _mergeAddedMissing(repoRoot, tipSha) {
  const merges = gitTry(repoRoot, ["log", "--merges", "--format=%H %P", "master"]);
  if (!merges.ok) return { error: merges.out };
  let merge = null;
  for (const line of merges.out.split("\n")) {
    const parts = line.split(/\s+/);
    if (parts.length >= 3 && parts[2] === tipSha) { merge = parts[0]; break; }
  }
  if (!merge) return { error: `no merge commit on master has branch tip ${tipSha} as a parent` };
  const added = gitTry(repoRoot, ["diff", "--name-only", "--diff-filter=A", `${merge}^1..${merge}`]);
  if (!added.ok) return { error: added.out };
  const missing = [];
  for (const f of added.out.split("\n").filter(Boolean)) {
    if (!gitTry(repoRoot, ["cat-file", "-e", `master:${f}`]).ok) missing.push(f);
  }
  return { missing };
}

// Map a branch name → its worktree's absolute path (if any), via `git worktree list --porcelain`.
function _worktreeForBranch(repoRoot, branch) {
  const r = gitTry(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return null;
  let cur = null;
  for (const line of r.out.split("\n")) {
    if (line.startsWith("worktree ")) { cur = line.slice("worktree ".length).trim(); continue; }
    if (line.startsWith("branch ") && line.slice("branch ".length).trim() === `refs/heads/${branch}`) return cur;
  }
  return null;
}

function _shortstatInsertions(repoRoot, branch) {
  const r = gitTry(repoRoot, ["diff", `master...${branch}`, "--shortstat"]);
  if (!r.ok) return null;
  const m = r.out.match(/(\d+)\s+insertions?\(\+\)/);
  return m ? Number(m[1]) : null;
}

function _lastCommitDate(repoRoot, branch) {
  const r = gitTry(repoRoot, ["log", "-1", "--format=%cI", branch]);
  return r.ok ? r.out : null;
}

// Classify one `milestone/*`|`task/*` branch against master using the three-gate criterion. Returns
// { branch, classification, aheadCount, insertions, lastCommitDate, worktreeRel, detail }.
export function classifyBranch(repoRoot, branch) {
  const wt = _worktreeForBranch(repoRoot, branch);
  const base = { branch, worktreeRel: wt };
  const ancestor = gitTry(repoRoot, ["merge-base", "--is-ancestor", branch, "master"]);
  if (!ancestor.ok) {
    const cnt = gitTry(repoRoot, ["rev-list", "--count", branch, "--not", "master"]);
    const aheadCount = cnt.ok ? Number(cnt.out) : NaN;
    return {
      ...base, classification: "has-commits",
      aheadCount: Number.isFinite(aheadCount) ? aheadCount : null,
      insertions: _shortstatInsertions(repoRoot, branch),
      lastCommitDate: _lastCommitDate(repoRoot, branch),
    };
  }
  // Gate 2 — merged; check revert only for merge-entered branches (tip NOT on master's first-parent).
  const tip = gitTry(repoRoot, ["rev-parse", branch]);
  const firstParent = gitTry(repoRoot, ["rev-list", "--first-parent", "master"]);
  let onFirstParent = false;
  if (tip.ok && firstParent.ok) onFirstParent = firstParent.out.split("\n").includes(tip.out);
  if (!onFirstParent) {
    const m = _mergeAddedMissing(repoRoot, tip.out);
    if (m.error) return { ...base, classification: "error", detail: m.error };
    if (m.missing.length > 0) {
      const shown = m.missing.slice(0, 5).join(", ");
      return {
        ...base, classification: "merged-then-reverted", aheadCount: 0,
        insertions: _shortstatInsertions(repoRoot, branch),
        lastCommitDate: _lastCommitDate(repoRoot, branch),
        detail: `${m.missing.length} merge-added file(s) missing from master: ${shown}${m.missing.length > 5 ? ` (+${m.missing.length - 5} more)` : ""}`,
      };
    }
  }
  // Gate 3 — worktree clean? (inside the worktree, not the primary checkout)
  if (wt) {
    const st = gitTry(repoRoot, ["status", "--porcelain"], wt);
    if (st.ok && st.out !== "") {
      return {
        ...base, classification: "has-uncommitted", aheadCount: 0,
        insertions: _shortstatInsertions(repoRoot, branch),
        lastCommitDate: _lastCommitDate(repoRoot, branch),
        detail: `worktree has uncommitted/untracked changes:\n${st.out}`,
      };
    }
  }
  return { ...base, classification: "merged-clean", aheadCount: 0 };
}

// The stranded-branch report: every live worktree branch whose work is NOT cleanly on master
// (has-commits, merged-then-reverted, has-uncommitted). merged-clean branches are excluded.
export function strandedBranches(repoRoot) {
  return listWorkBranches(repoRoot)
    .map((b) => classifyBranch(repoRoot, b))
    .filter((c) => c.classification !== "merged-clean");
}

// For AC6: does ANY code-root Touches entry of a done task appear in the branch's DIVERGENT diff —
// `git diff --name-only master...<branch>` (the set of files that differ between master and the
// branch)? A Touches file that is in that set (absent from master but present on the branch, or
// modified by the branch) means the task's code is preserved on the stranded branch — the task is
// STRANDED-not-merged, NOT reverse-drift (the work exists; it needs a MERGE, not a rebuild).
//
// Deliberately NOT `git cat-file -e <branch>:<path>` ("does the path exist in the branch's tree"):
// that false-positives on files the branch merely INHERITED from its base — every file that ever
// existed when the branch forked is in the branch tree, and files deleted from master after the fork
// are still there. Only the divergent-diff set is the branch's OWN work (measured false-positive on
// the real repo: DIR-073's execute-milestone.js is inherited by M239 but NOT in its diff, so DIR-073
// correctly stays reverse-drift while noisy-agent's prepare-milestone.js — absent from master, on
// M239 — correctly reclassifies to stranded-not-merged). Globs are skipped (the exact-path signal is
// the common case).
export function entriesInBranchDiff(repoRoot, entries, branch) {
  if (entries.length === 0) return false;
  const r = gitTry(repoRoot, ["diff", "--name-only", `master...${branch}`]);
  if (!r.ok) return false;
  const diverged = new Set(r.out.split("\n").filter(Boolean));
  return entries.some((e) => !(e.includes("*") || e.includes("?")) && diverged.has(e));
}

// Scan the task store for status-drift suspects. ratioFloor is the fraction of AC symbols that must
// resolve before a task is even considered (a lone coincidental match must not flag). `roots`
// overrides the symbol-search roots (repo-root-relative OR absolute) — tests pass synthetic roots.
//
// Two drift directions plus a stranded third class (gap-stranded-worktree-branches-have-no-alarm-channel):
//   status-drift-suspect:  todo/ready but code is in the tree (task should be closed).
//   reverse-drift-suspect: done but the code never landed — AC symbols are mostly UNRESOLVED AND no
//     code-root Touches file exists. The mirror image of the leak above (the RED test for
//     no-size-aware-routing-A was silenced without restoring its status — the exact class this
//     catches). Bookkeeping paths (milestones/**, docs/plans/**, .quay/**, receipts/**, tasks/**)
//     are pipeline artifacts a fast-mode task never produces — their absence is ignored (AC4).
//   stranded-not-merged:  done but its code-root Touches entries exist on a STRANDED branch (a branch
//     with commits ahead of master, or merged-then-reverted) rather than on master. NOT reverse-drift
//     — the work exists and is preserved on the branch; it needs a MERGE, not a rebuild. The two are
//     the mirror-image false classification (2026-08-02: A2/A5 were reported "done but never landed"
//     when their code sat on unmerged branches — the wrong disposition would have rebuilt landed work).
// `strandedBranches` is the branch-level report list (from strandedBranches()) used to reclassify.
export function scanTasks({ repoRoot, tasksDir = path.join(repoRoot, "tasks"), ratioFloor = 0.6, roots = CODE_ROOTS, strandedBranches: strandedList = [] }) {
  const suspects = [];
  const reverse = [];
  const closedWithoutWork = [];
  const strandedTasks = [];
  let taskFiles;
  try { taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")); } catch { return { suspects, reverse, closedWithoutWork, strandedTasks, scanned: 0 }; }
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
      // ── Closed-without-work — the DANGEROUS direction (gap-drift-check-only-looks-at-the-harmless-
      // direction). The forward scan (todo/ready) only sees "code in the tree but status not closed" —
      // the BENIGN half: at worst a bookkeeping lag. It can NEVER see a task marked `done` WITHOUT the
      // work, because status is written DIRECTLY, bypassing the gate. The decisive signal is the AC
      // checkbox count: a done task with AC boxes but 0 checked could NOT have passed the acceptance
      // gate as written (the gate reads `- [x]` boxes), so `done` was bypassed — the "closed without
      // work" shape. Live specimen: gap-no-e2e-proves-install-is-configuration-driven was once done
      // with 8 ACs all unchecked and its Touches files only on an unmerged branch — the old scan (and
      // the symbol-based reverse-drift bar) reported nothing for it. The evidence state (Touches in
      // tree / branch merged) is reported for actionability (AC5), not required to flag: the unchecked-
      // AC shape alone IS the bypass signal. Done-parents whose implementation IS the children's work
      // (all children done) are skipped, matching reverse-drift.
      const acBoxes = countAcCheckboxes(ac);
      if (acBoxes.total > 0 && acBoxes.checked === 0 && !hasDoneChildren(raw, tasksDir)) {
        const codeEntries = parseTouchEntries(touchesSection).filter((e) => isCodeTouchEntry(e));
        const strandedHit = strandedList.find((sb) => entriesInBranchDiff(repoRoot, codeEntries, sb.branch));
        closedWithoutWork.push({
          taskId: f.replace(/\.md$/, ""),
          status,
          acChecked: acBoxes.checked,
          acTotal: acBoxes.total,
          acUnchecked: acBoxes.unchecked,
          touchesAllExist: tAll,
          codeTouchExists,
          branch: strandedHit ? strandedHit.branch : null,
          branchUnmerged: strandedHit != null,
        });
      }
      const noCode = touchesSection != null
        && !codeTouchExists
        && !hasDoneChildren(raw, tasksDir)
        && candidates.length > 0
        && (matched.length / candidates.length) < REVERSE_SYMBOL_RATIO_MAX;
      if (noCode) {
        // AC6: before calling a done task reverse-drift (never landed), ask whether any of its
        // code-root Touches entries appear in a STRANDED branch's divergent diff (the branch's own
        // work — see entriesInBranchDiff). If so the work IS landed — just not on master — and the
        // correct disposition is to MERGE the branch, never to rebuild. (has-uncommitted branches
        // never match: uncommitted files are not in any diff.)
        const codeEntries = parseTouchEntries(touchesSection).filter((e) => isCodeTouchEntry(e));
        const strandedHit = strandedList.find((sb) => entriesInBranchDiff(repoRoot, codeEntries, sb.branch));
        if (strandedHit) {
          strandedTasks.push({
            taskId: f.replace(/\.md$/, ""),
            status,
            matchedSymbols: matched,
            totalSymbols: candidates.length,
            branch: strandedHit.branch,
            branchClassification: strandedHit.classification,
          });
          continue;
        }
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
  return { suspects, reverse, closedWithoutWork, strandedTasks, scanned: taskFiles.length };
}

// ── Report formatting (pure — unit-tested) ────────────────────────────────────────────────────────
function _jsonStranded(s) {
  return {
    branch: s.branch, classification: s.classification,
    aheadCount: s.aheadCount, insertions: s.insertions, lastCommitDate: s.lastCommitDate,
    detail: s.detail ?? null,
  };
}
function _jsonClosed(s) {
  return {
    taskId: s.taskId,
    acChecked: s.acChecked,
    acTotal: s.acTotal,
    acUnchecked: s.acUnchecked,
    touchesAllExist: s.touchesAllExist,
    codeTouchExists: s.codeTouchExists,
    branch: s.branch,
    branchUnmerged: s.branchUnmerged,
  };
}
export function formatJsonReport(suspects, reverse, scanned, strandedTasks = [], stranded = [], closedWithoutWork = []) {
  return JSON.stringify({
    suspects: suspects.map((s) => ({ taskId: s.taskId, matchedSymbols: s.matchedSymbols, touchesAllExist: s.touchesAllExist })),
    reverse: reverse.map((s) => ({ taskId: s.taskId, matchedSymbols: s.matchedSymbols, codeTouchExists: s.codeTouchExists, touchesAllExist: s.touchesAllExist })),
    closedWithoutWork: closedWithoutWork.map(_jsonClosed),
    strandedTasks: strandedTasks.map((s) => ({ taskId: s.taskId, matchedSymbols: s.matchedSymbols, branch: s.branch, branchClassification: s.branchClassification })),
    stranded: stranded.map(_jsonStranded),
    scanned,
  }, null, 2) + "\n";
}

// Human-readable closed-without-work report (the DANGEROUS direction). Pure — unit-tested. Each line
// names the missing evidence (AC unchecked / Touches file not in tree / branch unmerged) so the human
// knows what to act on, not just which task (AC5).
export function formatClosedText(closed, opts = {}) {
  const prefix = opts.prefix ?? "task-status-drift";
  if (closed.length === 0) {
    return `${prefix}: no CLOSED-without-work suspect(s) — every done task with ACs has ≥1 AC checked (the acceptance gate is the source of done)\n`;
  }
  let out = `${prefix}: ${closed.length} CLOSED-without-work suspect(s) — status done but 0 ACs checked (the acceptance gate could NOT have passed as written; status was written directly, bypassing the gate)\n`;
  for (const s of closed) {
    const missing = [];
    if (s.acUnchecked > 0) missing.push(`AC unchecked (${s.acChecked}/${s.acTotal} checked)`);
    if (!s.touchesAllExist) missing.push("Touches file(s) not in tree");
    if (s.branchUnmerged) missing.push(`branch not merged (${s.branch})`);
    out += `  closed-without-work: ${s.taskId} (status ${s.status}, missing: ${missing.join(", ") || "none"})\n`;
  }
  out += "  → human review: re-open the task and finish+verify the ACs, or confirm the work landed and check the boxes\n";
  return out;
}

// Human-readable stranded-branch report. Pure — unit-tested. Used both by --stranded (branch-only
// fast path) and the full report.
export function formatStrandedText(stranded, opts = {}) {
  const prefix = opts.prefix ?? "stranded-branch-check";
  if (stranded.length === 0) {
    return `${prefix}: no stranded worktree branches (all milestone/* and task/* branches are cleanly merged into master)\n`;
  }
  let out = `${prefix}: ${stranded.length} STRANDED branch(es) — work is preserved on a branch NOT on master (a silent fail-closed: nothing reports these until this check runs)\n`;
  for (const s of stranded) {
    const label = s.classification === "has-commits"
      ? `${s.aheadCount ?? "?"} commit(s) ahead`
      : s.classification === "merged-then-reverted"
        ? "merge reverted away from master"
        : s.classification === "has-uncommitted"
          ? "worktree holds uncommitted work"
          : s.classification === "error"
            ? "classification errored — investigate"
            : s.classification;
    const lines = s.insertions != null ? `+${s.insertions} lines` : "? lines";
    out += `  stranded: ${s.branch} (${s.classification}, ${label}, ${lines}, last commit ${s.lastCommitDate ?? "?"})\n`;
    if (s.detail) out += `    ${s.detail}\n`;
  }
  out += `  → human review: merge or adjudicate the branch; do NOT --clean-stale it (merge decision lives in orchestration/escalations.md)\n`;
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
export function main(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const strandedOnly = args.includes("--stranded");
  const closedOnly = args.includes("--closed-direction");
  let repoRoot;
  try { repoRoot = findRepoRoot(process.cwd()); } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    return 0;
  }
  const stranded = strandedBranches(repoRoot);
  if (strandedOnly) {
    // Fast branch-only path (restart-readiness-check.sh and the outer tick consume this): no task
    // store scan, just the stranded-branch report. Still exits 0 — report-only, never a gate.
    process.stdout.write(json
      ? JSON.stringify({ stranded: stranded.map(_jsonStranded) }, null, 2) + "\n"
      : formatStrandedText(stranded));
    return 0;
  }
  const { suspects, reverse, closedWithoutWork, strandedTasks, scanned } = scanTasks({ repoRoot, strandedBranches: stranded });
  if (json) {
    if (closedOnly) {
      // `--closed-direction --json` emits a bare ARRAY of closed-without-work entries so
      // `| jq length` counts them directly (Contract's closed_without_work measure).
      process.stdout.write(JSON.stringify(closedWithoutWork.map(_jsonClosed), null, 2) + "\n");
      return 0;
    }
    process.stdout.write(formatJsonReport(suspects, reverse, scanned, strandedTasks, stranded, closedWithoutWork));
  } else {
    if (closedOnly) {
      process.stdout.write(formatClosedText(closedWithoutWork));
      return 0;
    }
    if (suspects.length === 0 && reverse.length === 0 && closedWithoutWork.length === 0 && strandedTasks.length === 0 && stranded.length === 0) {
      process.stdout.write(`task-status-drift: no suspects among ${scanned} tasks (todo/ready drift + done closed-without-work + done-reverse-drift + stranded-branch all clean)\n`);
    } else {
      if (suspects.length > 0) {
        process.stdout.write(`task-status-drift: ${suspects.length} SUSPECT task(s) with code already in the tree but status not closed (${scanned} tasks scanned, incl. done)\n`);
        for (const s of suspects) {
          process.stdout.write(`  status-drift-suspect: ${s.taskId} (status ${s.status}, ${s.matchedSymbols.length}/${s.totalSymbols} symbols resolved, touchesAllExist=${s.touchesAllExist})\n`);
        }
        process.stdout.write("  → human review: set status to done (all ACs test-proven) or ready (an AC requires a real dispatch)\n");
      }
      if (closedWithoutWork.length > 0) {
        process.stdout.write(`task-status-drift: ${closedWithoutWork.length} CLOSED-without-work suspect(s) — status done but 0 ACs checked (the acceptance gate could NOT have passed as written; status was written directly, bypassing the gate)\n`);
        for (const s of closedWithoutWork) {
          const missing = [];
          if (s.acUnchecked > 0) missing.push(`AC unchecked (${s.acChecked}/${s.acTotal} checked)`);
          if (!s.touchesAllExist) missing.push("Touches file(s) not in tree");
          if (s.branchUnmerged) missing.push(`branch not merged (${s.branch})`);
          process.stdout.write(`  closed-without-work: ${s.taskId} (status ${s.status}, missing: ${missing.join(", ") || "none"})\n`);
        }
        process.stdout.write("  → human review: re-open the task and finish+verify the ACs, or confirm the work landed and check the boxes\n");
      }
      if (reverse.length > 0) {
        process.stdout.write(`task-status-drift: ${reverse.length} REVERSE-drift suspect(s) — status done but the implementation never landed (no code-root Touches file exists, AC symbols mostly unresolved)\n`);
        for (const s of reverse) {
          process.stdout.write(`  reverse-drift-suspect: ${s.taskId} (status ${s.status}, ${s.matchedSymbols.length}/${s.totalSymbols} symbols resolved, codeTouchExists=${s.codeTouchExists}, touchesAllExist=${s.touchesAllExist})\n`);
        }
        process.stdout.write("  → human review: set status back to todo (code never landed) or finish the implementation\n");
      }
      if (strandedTasks.length > 0) {
        process.stdout.write(`task-status-drift: ${strandedTasks.length} STRANDED-not-merged task(s) — status done but the implementation is on a stranded branch, NOT master (this is NOT reverse-drift: the work exists and is preserved)\n`);
        for (const s of strandedTasks) {
          process.stdout.write(`  stranded-not-merged: ${s.taskId} (code on ${s.branch}, ${s.branchClassification})\n`);
        }
        process.stdout.write("  → human review: MERGE the branch (do NOT rebuild)\n");
      }
      if (stranded.length > 0) {
        process.stdout.write(formatStrandedText(stranded, { prefix: "task-status-drift" }));
      }
    }
  }
  return 0; // ALWAYS 0 — report-only, never a gate
}

if (isDirectEntry(import.meta)) {
  process.exit(main(process.argv));
}
