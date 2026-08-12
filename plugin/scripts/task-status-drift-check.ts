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
import { stripTouchAnnotation, parseTouchEntries, parseTouchEntriesWithTags } from "./touches-parser.ts";
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

// ── git-history of declared specific Touches — the THIRD landed signal ───────────────────────────
// taskWorkLanded's first two signals depend on the AC section's SYMBOL SHAPE (backticked identifiers
// that resolve, or `(new)`-marked Touches files now existing). A task whose AC is PROSE-HEAVY (few
// resolvable identifiers) AND whose Touches modify EXISTING files (no `(new)`) shows neither signal —
// yet its work may have landed on master (web-board: prose AC, 4 existing-file Touches, merged
// 0950b0b6/fb1fd520 — taskWorkLanded=false, 3rd re-dispatch 2026-08-05;
// gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks). This third signal closes that
// gap: a MAINLINE-reachable commit (integration/develop/master per landingRef — NOT hardcoded master,
// gap-git-history-landed-master-stale-under-two-line-model) whose message references the task AND
// that modified one of the task's SPECIFIC code-root Touches paths ⇒ the declared work landed.
//
// Anchoring — "the commit is about THIS task, not a coincidental touch" (AC4 negative control):
//   - the commit message must reference the task by its FULL id, its id without a leading kind
//     prefix (`gap-`/`DIR-`/…), or a ≥2-hyphen-segment PREFIX of either. LONG prefixes (≥4
//     segments) are distinctive and match on ANY commit. SHORT prefixes (2-3 segments) match on
//     MERGE commits only — the fan-in "merge <short-name>:" convention (web-board → "merge
//     web-board:") — AND only when the prefix is UNIQUE among the store's task ids
//     (ambiguousShortPrefixes): a shared kernel ("cold-start", "red-window") is a sibling reference,
//     so a sibling's merge merely mentioning it must not judge THIS task landed.
//   - the reference must be a DELIMITED word (surrounded by non-[A-Za-z0-9_-]), so "web-board" does
//     not match inside "gap-web-board-…" and "send-keys" does not match inside "send-keys-nbsp".
//   - the commit must have modified a specific code-root Touches path (non-glob, non-(new)/(delete),
//     non-bookkeeping). Bookkeeping paths (tasks/**, milestones/**, docs/plans/**, .quay/**,
//     receipts/**) are pipeline accounting — e.g. the promote-to-ready commit touches ONLY the task's
//     own file, and must NOT count as landing evidence (AC4 negative control).
//   - only MAINLINE-REACHABLE commits count (`git log <landingRef> -- <paths>` — integration/
//     develop/master per landingRef), so a stranded-branch commit or an unmerged worktree commit
//     does not fire the signal (AC3: the "not a stray branch" intent is preserved).
//
// The prior overshoot gap (gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks)
// is NOT re-opened: file EXISTENCE alone never fires this signal — the file must have been MODIFIED
// by a mainline-reachable commit that REFERENCES the task.
const KIND_PREFIX_RE = /^(gap|DIR|QN|exp5|M\d+)[-_]/;

/** The id forms a commit message may use to reference a task: the full id, the id with a leading
 *  kind prefix (`gap-`/`DIR-`/…) stripped, and every ≥2-hyphen-segment prefix of both. The repo's
 *  fan-in abbreviates in two ways: "merge <short-kernel>:" (web-board → "merge web-board:" for
 *  gap-web-board-needs-…) and a long prefix dropping only trailing qualifier segments
 *  (measure-claude-p's commit "task(gap-measure-claude-p-headless-third-party-roundtrip):" for
 *  gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics). */
export function taskIdTokens(taskId) {
  const full = String(taskId);
  const stripped = full.replace(KIND_PREFIX_RE, "");
  const tokens = new Set([full, stripped]);
  const addPrefixes = (id) => {
    const segs = id.split("-").filter(Boolean);
    for (let i = 2; i <= segs.length; i++) tokens.add(segs.slice(0, i).join("-"));
  };
  addPrefixes(full);
  if (stripped && stripped !== full) addPrefixes(stripped);
  return [...tokens].filter(Boolean);
}

/** Does `message` contain `token` as a delimited word (surrounded by non-[A-Za-z0-9_-])? */
export function wordMatch(message, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`).test(message);
}

/** Short (2-3 segment) id prefixes SHARED by ≥2 tasks in the store — ambiguous references that
 *  must NOT fire the git-history signal on their own. gap-cold-start-* and gap-red-window-* all
 *  share "cold-start" / "red-window"; a sibling's merge that merely MENTIONS the shared word (e.g.
 *  gap-full-suite-belongs-to-outer's merge describing the red-window hold) must not judge the
 *  sibling landed (AC4 negative control). Computed from task FILE NAMES only (id = filename). */
// Per-process memo (gap-ready-pool-check-times-out-after-git-history-signal): the pool check calls
// gitHistoryLanded per ready task, and each call recomputes ambiguousShortPrefixes over the whole
// task store. The store does not mutate within one process (ready-pool-check is read-only), so
// caching by tasksDir is safe and cuts ~N readdirs+prefix-scans down to one.
const _ambiguousShortPrefixCache = new Map(); // tasksDir → Set<prefix>
function ambiguousShortPrefixes(repoRoot, tasksDir) {
  const dir = tasksDir || path.join(repoRoot, "tasks");
  const cached = _ambiguousShortPrefixCache.get(dir);
  if (cached) return cached;
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return new Set(); }
  const counts = new Map();
  const addPrefixes = (s) => {
    const segs = s.split("-").filter(Boolean);
    for (let i = 2; i <= 3 && i <= segs.length; i++) {
      const p = segs.slice(0, i).join("-");
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  };
  for (const f of files) {
    const id = f.replace(/\.md$/, "");
    addPrefixes(id);
    const stripped = id.replace(KIND_PREFIX_RE, "");
    if (stripped !== id) addPrefixes(stripped);
  }
  const ambiguous = new Set();
  for (const [p, c] of counts) if (c > 1) ambiguous.add(p);
  _ambiguousShortPrefixCache.set(dir, ambiguous);
  return ambiguous;
}

/** Does a commit message reference `taskId`? Full id / full stripped id match on ANY commit;
 *  LONG id prefixes (≥4 hyphen-segments) are distinctive enough to match on ANY commit; SHORT
 *  prefixes (2-3 segments) match on MERGE commits ONLY — the fan-in "merge <name>:" convention —
 *  AND only when the prefix is UNIQUE among the store's task ids (ambiguousShortPrefixes) — a
 *  shared prefix ("cold-start", "red-window") is not a task-specific reference, so a sibling's
 *  merge mentioning it must not fire (AC4 negative control: a coincidental touch by other work
 *  must not judge an un-landed task landed). */
export function messageReferencesTask(message, taskId, opts = {}) {
  const isMergeCommit = opts.isMerge === true;
  const ambiguous = opts.ambiguousShortPrefixes ?? new Set();
  const full = String(taskId);
  const stripped = full.replace(KIND_PREFIX_RE, "");
  if (wordMatch(message, full) || (stripped && stripped !== full && wordMatch(message, stripped))) return true;
  const considerPrefixes = (id) => {
    const segs = id.split("-").filter(Boolean);
    for (let i = 2; i <= segs.length; i++) {
      const p = segs.slice(0, i).join("-");
      if (!wordMatch(message, p)) continue;
      if (i >= 4) return true;
      if (isMergeCommit && !ambiguous.has(p)) return true;
    }
    return false;
  };
  if (considerPrefixes(full)) return true;
  if (stripped && stripped !== full && considerPrefixes(stripped)) return true;
  return false;
}

/** Fallback taskId source when opts.taskId is absent: the self-touch convention puts
 *  `tasks/<id>.md` in a task's own Touches (tick 4.4), which carries the id. */
export function taskIdFromTouches(touchesSection) {
  for (const entry of parseTouchEntries(touchesSection ?? "")) {
    const m = entry.match(/^tasks\/(.+)\.md$/);
    if (m) return m[1];
  }
  return null;
}

/** The ref whose reachability defines "landed" — the two-line model's working line.
 *  gap-git-history-landed-master-stale-under-two-line-model: the THIRD landed signal used to
 *  hardcode `git log master`, but under the two-line model work lands on integration (develop
 *  advances only via batch-merge) while master stalls (measured 2026-08-11: master stuck at
 *  ea2208cf/08-06, master..integration=2212) — so everything landed after that read as unlanded.
 *  Resolution: an explicit opts.ref wins (ready-pool-check's configured --integration/--develop/
 *  --master, the "配置来源" path); else the first EXISTING ref of integration → develop → master;
 *  else master (single-line repos / git-history test fixtures that only create master).
 *  Reachability FROM the chosen ref is what keeps STRANDED-branch commits out — a commit on an
 *  unmerged task/* branch is not reachable from integration/develop/master, preserving the original
 *  "only MASTER-REACHABLE commits count" intent (AC3 negative control). */
export function landingRef(repoRoot, opts = {}) {
  if (opts.ref) return opts.ref;
  const candidates = opts.candidates ?? ["integration", "develop", "master"];
  for (const ref of candidates) {
    const r = gitTry(repoRoot, ["rev-parse", "--verify", "-q", ref]);
    if (r.ok && r.out.trim().length > 0) return ref;
  }
  return "master";
}

/** The THIRD landed signal: a mainline-reachable commit (integration/develop/master per landingRef,
 *  not hardcoded master) whose message references the task AND that modified one of the task's
 *  SPECIFIC code-root Touches paths (non-glob, non-(new)/(delete), non-bookkeeping). Skips (does
 *  not crash on) Touches paths that do not exist — `git log -- <p>` on a never-existing path is
 *  simply empty. Returns false on any git failure (fail-closed).
 *
 *  Two execution paths, SAME judgment:
 *   - DEFAULT (no opts.gitIndex): one `git log <ref> --full-history -- <paths>` per call — the
 *     original per-task path. Kept for single-task `--check` invocations (Contract invoke), where
 *     the batched index would be strictly more work than one path-limited log.
 *   - BATCHED (opts.gitIndex): ready-pool-check passes a prebuilt buildGitHistoryIndex() so the
 *     pool scan (30-50 tasks) makes ONE git pass and matches in memory —
 *     gap-ready-pool-check-times-out-after-git-history-signal (>150s -> <10s). */
export function gitHistoryLanded(rawTaskText, repoRoot, opts = {}) {
  const touchesSection = extractSection(rawTaskText, "Touches");
  if (!touchesSection) return false;
  const taskId = opts.taskId ?? taskIdFromTouches(touchesSection);
  if (!taskId) return false;
  const paths = parseTouchEntriesWithTags(touchesSection)
    .filter((e) => e.tag === null)
    .map((e) => e.path)
    .filter((p) => p && !p.includes("*") && !p.includes("?"))
    .filter((p) => isCodeTouchEntry(p));
  if (paths.length === 0) return false;
  // Ambiguous short prefixes (shared by sibling tasks) — computed once per call so a shared kernel
  // ("cold-start", "red-window") can never fire the signal on its own.
  const ambiguous = ambiguousShortPrefixes(repoRoot, opts.tasksDir);
  // BATCHED path: match the task's paths against a prebuilt path→commits index in memory.
  if (opts.gitIndex) {
    const { commits, byPath } = opts.gitIndex;
    const seen = new Set();
    for (const p of paths) {
      // git pathspec semantics: a Touches path names EITHER one exact file OR a directory whose
      // contents all match (`git log -- <dir>/` and `git log -- <dir>` both match every file under
      // the dir). The per-task path-limited log honors this; the in-memory index must too —
      // otherwise a task whose Touches declare a DIRECTORY path (e.g. `packages/.../factories/`) is
      // silently under-detected by the batched path while the per-task path fires (whole-store
      // drift: DIR-087/089/091 were landed=true per-task but false via the index).
      const hashes = _indexHashesForPath(byPath, p);
      if (!hashes) continue;
      for (const hash of hashes) {
        if (seen.has(hash)) continue;
        seen.add(hash);
        const rec = commits.get(hash);
        if (!rec) continue;
        const isMerge = rec.parents.split(/\s+/).filter(Boolean).length >= 2;
        if (messageReferencesTask(rec.subject, taskId, { isMerge, ambiguousShortPrefixes: ambiguous })) return true;
      }
    }
    return false;
  }
  // --full-history: git's default path-history SIMPLIFICATION elides merge commits whose file
  // change is identical to one parent's (so the fan-in's "merge <task>: …" commit would never
  // appear — web-board's 0950b0b6 was hidden until --full-history). The signal needs those merges
  // (they carry the task reference), so disable simplification.
  const ref = landingRef(repoRoot, opts);
  const r = gitTry(repoRoot, ["log", ref, "--full-history", "--format=%H%x00%P%x00%s", "--", ...paths]);
  if (!r.ok || !r.out) return false;
  for (const line of r.out.split("\n")) {
    const parts = line.split("\0");
    if (parts.length < 3) continue;
    const parents = parts[1];
    const msg = parts[2];
    const isMerge = parents.split(/\s+/).filter(Boolean).length >= 2;
    if (messageReferencesTask(msg, taskId, { isMerge, ambiguousShortPrefixes: ambiguous })) return true;
  }
  return false;
}

/** BATCHED git-history source (gap-ready-pool-check-times-out-after-git-history-signal): ONE
 *  `git log` pass over ALL of the landing ref (integration/develop/master per landingRef), returning
 *  every commit with the paths it touched. The pool check was aggregating ~30-50 per-task
 *  `git log <ref> --full-history -- <paths>` calls (each O(history)) into >150s; this builds the
 *  same evidence in O(1) git calls, and gitHistoryLanded matches in memory via byPath.
 *
 *  `-m` makes each merge emit one record per parent diff; the per-hash path sets are UNIONED so a
 *  merge's touched set = exactly the set of paths for which path-limited `--full-history -- <p>`
 *  would include it. A merge is "touched" by p when its result differs from ANY parent — the union
 *  of the per-parent `-m` diffs — verified empirically (web-board's fan-in merge differs from
 *  parent 1 only, and the per-task path-limited log DOES return it).
 *
 *  Fail-closed: any git failure returns an empty index (gitHistoryLanded then judges false, the
 *  same fail-closed result the per-task `git log` failure produced). */
export function buildGitHistoryIndex(repoRoot, opts = {}) {
  // Deliberately NOT via gitTry: the full-history `--name-only` dump can exceed execFileSync's
  // default maxBuffer (measured 1.47MB for this repo at ~3.4k commits → ENOBUFS), so a dedicated
  // call raises the cap. Any failure still fails-closed to an empty index.
  const ref = landingRef(repoRoot, opts);
  let raw;
  try {
    raw = execFileSync("git", [
      "log", ref, "--full-history", "-m", "--name-only", "--no-renames",
      "--format=%H%x00%P%x00%s",
    ], { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    const commits = new Map();
    const byPath = new Map();
    return { commits, byPath };
  }
  const commits = new Map(); // hash → { hash, parents, subject, paths: Set<path> }
  const byPath = new Map();  // path → Set<hash>
  if (!raw) return { commits, byPath };
  let cur = null;
  for (const line of raw.split("\n")) {
    // A line containing NUL is a record header `<hash>\0<parents>\0<subject>`; all following
    // non-empty lines until the next header are the paths THAT record touched. `-m` repeats the
    // header per non-empty parent diff, so the per-hash path set is the UNION of those blocks.
    if (line.includes("\0")) {
      const parts = line.split("\0");
      if (parts.length < 3) { cur = null; continue; }
      let rec = commits.get(parts[0]);
      if (!rec) {
        rec = { hash: parts[0], parents: parts[1], subject: parts[2], paths: new Set() };
        commits.set(parts[0], rec);
      }
      cur = rec;
      continue;
    }
    const p = line.trim();
    if (p === "" || !cur) continue;
    if (cur.paths.has(p)) continue;
    cur.paths.add(p);
    let set = byPath.get(p);
    if (!set) { set = new Set(); byPath.set(p, set); }
    set.add(cur.hash);
  }
  return { commits, byPath };
}

/** Git-pathspec-equivalent in-memory lookup for the batched index: a Touches path `p` matches an
 *  indexed FILE whose key is exactly `p`, OR any indexed file under the directory `p` names (with
 *  or without a trailing slash — `plugin/test/` and `plugin/test` both match `plugin/test/foo.ts`)
 *  — the SAME path set `git log --full-history -- <p>` returns (verified: `-- dir` and `-- dir/`
 *  list the same commits). Returns null when nothing matched (fail-closed, identical to an empty
 *  path-limited git log). This closes the directory-Touch under-detection gap where the per-task
 *  path fired on a task declaring `…/scripts/`-style Touches but the index silently did not. */
function _indexHashesForPath(byPath, p) {
  const out = new Set();
  const exact = byPath.get(p);
  if (exact) for (const h of exact) out.add(h);
  const prefix = p.endsWith("/") ? p : `${p}/`;
  for (const [key, hs] of byPath) {
    if (key.startsWith(prefix)) for (const h of hs) out.add(h);
  }
  return out.size ? out : null;
}

// Reusable "the task's declared work has landed on the mainline" predicate — exported for reuse by
// ready-pool-check.ts's notYetFlipped (gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool,
// AC6: reuse the drift-check signal, never a parallel copy). A task's work is judged landed when
// ANY of the drift-check's three landing-evidence signals fires:
//   - symbol: its distinctive backticked AC identifiers resolve in the code roots (the forward
//     status-drift signal — a landed implementation backticks its own identifiers in its ACs); or
//   - touch: a task-CREATED file (`(new)`-marked Touches entry) now exists on disk — the task
//     created it ⇒ landed (hasAnyLandedNewTouch); or
//   - git-history: a mainline-reachable commit whose message references the task modified one of its
//     SPECIFIC code-root Touches paths (gitHistoryLanded — catches prose-heavy AC tasks whose
//     implementation landed but whose AC yields no resolvable symbols and whose Touches modify
//     existing files; gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks). "Mainline"
//     is integration/develop/master per landingRef, not hardcoded master (two-line model —
//     gap-git-history-landed-master-stale-under-two-line-model).
// Existing-file Touches entries are DELIBERATELY NOT landing evidence by file existence alone: a
// task that modifies a file which already exists on the mainline is indistinguishable from an
// un-landed task by file existence — the file is there regardless — so only its own symbols (or the
// git-history of a commit that references it) can prove it landed (the overshoot fix,
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
  const gitHistory = gitHistoryLanded(rawTaskText, repoRoot, opts);
  return symbolResolved || touchLanded || gitHistory;
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

// Find the merge commit on the LANDING ref (integration/develop/master per landingRef — NOT
// hardcoded master, gap-stranded-check-compares-against-master-not-landing-ref) whose SECOND parent
// is branchTip (the worktree Land flow's `git merge --no-ff <branch>` always puts the branch tip as
// the second parent — matching only parts[2] provably selects the branch's own Land merge), then
// return the merge-added files that are missing from the landing ref's CURRENT tree (a `git revert`
// of the merge removes exactly those files).
function _mergeAddedMissing(repoRoot, tipSha, landing = "master") {
  const merges = gitTry(repoRoot, ["log", "--merges", "--format=%H %P", landing]);
  if (!merges.ok) return { error: merges.out };
  let merge = null;
  for (const line of merges.out.split("\n")) {
    const parts = line.split(/\s+/);
    if (parts.length >= 3 && parts[2] === tipSha) { merge = parts[0]; break; }
  }
  if (!merge) return { error: `no merge commit on ${landing} has branch tip ${tipSha} as a parent` };
  const added = gitTry(repoRoot, ["diff", "--name-only", "--diff-filter=A", `${merge}^1..${merge}`]);
  if (!added.ok) return { error: added.out };
  const missing = [];
  for (const f of added.out.split("\n").filter(Boolean)) {
    if (!gitTry(repoRoot, ["cat-file", "-e", `${landing}:${f}`]).ok) missing.push(f);
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

function _shortstatInsertions(repoRoot, branch, landing = "master") {
  const r = gitTry(repoRoot, ["diff", `${landing}...${branch}`, "--shortstat"]);
  if (!r.ok) return null;
  const m = r.out.match(/(\d+)\s+insertions?\(\+\)/);
  return m ? Number(m[1]) : null;
}

function _lastCommitDate(repoRoot, branch) {
  const r = gitTry(repoRoot, ["log", "-1", "--format=%cI", branch]);
  return r.ok ? r.out : null;
}

// Classify one `milestone/*`|`task/*` branch against the LANDING ref (integration/develop/master
// per landingRef — gap-stranded-check-compares-against-master-not-landing-ref: under the two-line
// model work lands on integration (develop advances only via batch-merge) while master stalls, so
// a hardcoded master merge-base misclassifies every integration-merged task/* branch as
// "commits ahead of master" → false stranded). Returns
// { branch, classification, aheadCount, insertions, lastCommitDate, worktreeRel, detail }.
export function classifyBranch(repoRoot, branch, landing = "master") {
  const wt = _worktreeForBranch(repoRoot, branch);
  const base = { branch, worktreeRel: wt };
  const ancestor = gitTry(repoRoot, ["merge-base", "--is-ancestor", branch, landing]);
  if (!ancestor.ok) {
    const cnt = gitTry(repoRoot, ["rev-list", "--count", branch, "--not", landing]);
    const aheadCount = cnt.ok ? Number(cnt.out) : NaN;
    return {
      ...base, classification: "has-commits",
      aheadCount: Number.isFinite(aheadCount) ? aheadCount : null,
      insertions: _shortstatInsertions(repoRoot, branch, landing),
      lastCommitDate: _lastCommitDate(repoRoot, branch),
    };
  }
  // Gate 2 — merged; check revert only for merge-entered branches (tip NOT on landing's first-parent).
  const tip = gitTry(repoRoot, ["rev-parse", branch]);
  const firstParent = gitTry(repoRoot, ["rev-list", "--first-parent", landing]);
  let onFirstParent = false;
  if (tip.ok && firstParent.ok) onFirstParent = firstParent.out.split("\n").includes(tip.out);
  if (!onFirstParent) {
    const m = _mergeAddedMissing(repoRoot, tip.out, landing);
    if (m.error) return { ...base, classification: "error", detail: m.error };
    if (m.missing.length > 0) {
      const shown = m.missing.slice(0, 5).join(", ");
      return {
        ...base, classification: "merged-then-reverted", aheadCount: 0,
        insertions: _shortstatInsertions(repoRoot, branch, landing),
        lastCommitDate: _lastCommitDate(repoRoot, branch),
        detail: `${m.missing.length} merge-added file(s) missing from ${landing}: ${shown}${m.missing.length > 5 ? ` (+${m.missing.length - 5} more)` : ""}`,
      };
    }
  }
  // Gate 3 — worktree clean? (inside the worktree, not the primary checkout)
  if (wt) {
    const st = gitTry(repoRoot, ["status", "--porcelain"], wt);
    if (st.ok && st.out !== "") {
      return {
        ...base, classification: "has-uncommitted", aheadCount: 0,
        insertions: _shortstatInsertions(repoRoot, branch, landing),
        lastCommitDate: _lastCommitDate(repoRoot, branch),
        detail: `worktree has uncommitted/untracked changes:\n${st.out}`,
      };
    }
  }
  return { ...base, classification: "merged-clean", aheadCount: 0 };
}

// The stranded-branch report: every live worktree branch whose work is NOT cleanly on the LANDING
// ref (integration/develop/master per landingRef — NOT hardcoded master, gap-stranded-check-
// compares-against-master-not-landing-ref: under the two-line model work lands on integration while
// master stalls, so a master-based check false-flagged every integration-merged task/* branch).
// (has-commits, merged-then-reverted, has-uncommitted). merged-clean branches are excluded.
export function strandedBranches(repoRoot, opts = {}) {
  const landing = landingRef(repoRoot, opts);
  return listWorkBranches(repoRoot)
    .map((b) => classifyBranch(repoRoot, b, landing))
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
export function entriesInBranchDiff(repoRoot, entries, branch, landing = "master") {
  if (entries.length === 0) return false;
  const r = gitTry(repoRoot, ["diff", "--name-only", `${landing}...${branch}`]);
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
export function scanTasks({ repoRoot, tasksDir = path.join(repoRoot, "tasks"), ratioFloor = 0.6, roots = CODE_ROOTS, strandedBranches: strandedList = [], landing = "master" }) {
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
        const strandedHit = strandedList.find((sb) => entriesInBranchDiff(repoRoot, codeEntries, sb.branch, landing));
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
        const strandedHit = strandedList.find((sb) => entriesInBranchDiff(repoRoot, codeEntries, sb.branch, landing));
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
  const checkIdx = args.indexOf("--check");
  const checkId = checkIdx >= 0 && checkIdx + 1 < args.length ? args[checkIdx + 1] : null;
  let repoRoot;
  try { repoRoot = findRepoRoot(process.cwd()); } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    return 0;
  }
  if (checkId) {
    // `--check <task-id>`: print landed=true/false for ONE task (taskWorkLanded, all three signals).
    // The Contract's landed_signals measure surface (task-status-drift-check.ts --check web-board).
    const file = path.join(repoRoot, "tasks", `${checkId}.md`);
    if (!fs.existsSync(file)) { process.stdout.write("landed=false\n"); return 0; }
    const raw = fs.readFileSync(file, "utf8");
    process.stdout.write(`landed=${taskWorkLanded(raw, repoRoot, { taskId: checkId })}\n`);
    return 0;
  }
  const stranded = strandedBranches(repoRoot);
  const landing = landingRef(repoRoot);
  if (strandedOnly) {
    // Fast branch-only path (restart-readiness-check.sh and the outer tick consume this): no task
    // store scan, just the stranded-branch report. Still exits 0 — report-only, never a gate.
    process.stdout.write(json
      ? JSON.stringify({ stranded: stranded.map(_jsonStranded) }, null, 2) + "\n"
      : formatStrandedText(stranded));
    return 0;
  }
  const { suspects, reverse, closedWithoutWork, strandedTasks, scanned } = scanTasks({ repoRoot, strandedBranches: stranded, landing });
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

if (isDirectEntry(import.meta, undefined, "task-status-drift-check")) {
  process.exit(main(process.argv));
}
