// touches-one-entry-one-path-check.ts — Touches「一条目一路径」形态检查器
// (tasks/gap-touches-one-entry-one-path, 判据1/判据3).
//
// THE DEFECT (from the task title): a `## Touches` bullet may declare TWO OR MORE paths joined by a
// path-separating delimiter — " / " (e.g. `orchestration/A.md / orchestration/B.md / C.md（说明）`),
// or the full-width "、" (顿号) / "，" (comma), or half-width "," (the AC76 fan-in case:
// `plugin/scripts/slot-refill.ts、plugin/scripts/fast-mode-telemetry.ts`), or " + " (space-plus-space,
// the AC93/ac86/AC91 fan-in case: `plugin/scripts/a.ts + plugin/scripts/b.ts`). The ONE Touches parser
// (touches-parser.ts, ADR-004) is deliberately line-oriented: `parseTouchEntriesWithTags` takes the
// WHOLE line as ONE entry (`^[-*]\s+(.+)$`), so a multi-path bullet parses to a single
// COMPOSITE entry — the string "A / B / C" (or "A、B"). That composite:
//   (a) matches NO file on disk (touches-resolve treats it as a missing path), and
//   (b) HIDES every real path inside it from `checkTouchesPair`'s file-set expansion — the
//       dispatch pre-flight never sees that the task touches `orchestration/C.md`, so a sibling
//       task that declares `orchestration/C.md` is judged safe-to-batch (or serialize for the wrong
//       reason) instead of the TRUE overlap on that file.
//   Measured real sample (2026-08-14): AC66's first bullet `orchestration/orchestrator-tick-core.md
//   / orchestration/manager-tick-core.md / orchestration/fast-mode-tick-core.md` parsed to ONE
//   composite entry; the overlap with AC78 (which touches `orchestration/fast-mode-tick-core.md`)
//   on that exact file was invisible to the machine (判据3).
//
// THIS checker makes 判据1 mechanical: a Touches bullet that, after removing parenthetical
// annotations (which repo paths never contain — the ONE parser's own invariant), still contains a
// path-separating delimiter (" / " / "、" / "，" / ",") has declared ≥2 paths in one bullet ⇒ RED.
// 判据3 (能取假): the AC66 real 3-path bullet replays RED; after splitting it replays GREEN.
//
// SINGLE-SOURCE: the per-line bullet extraction is the SAME idiom the ONE parser uses
// (`^[-*]\s+(.+)$`, exactly as flagBareDirUncertainTouches in touches-parser.ts does it) — this
// module adds NO second Touches parser. It only ADDS the multi-path judgment on top. The task's
// 不覆盖 clause holds: the parser body is NOT modified (no " / " splitting is introduced), and the
// disjoint criterion itself is untouched.
//
// Legacy debt: the shrink-only grandfather baseline (docs/analysis/touches-one-entry-one-path-
// baseline.md) lists done/superseded task files that legitimately still carry a multi-path bullet
// (pre-rule historical records, out of this task's scope). A task file NOT on the list whose
// Touches carries the pattern is a NEW occurrence ⇒ violation. The list can only get SHORTER.
//
// NOT-EVALUATED semantics (硬规则 3b): a task with NO `## Touches` section is not a violation — it
// carries no shape claims to judge. The scan reports it as NOT-EVALUATED, never as a violation, and
// never conflates "no section" with "clean".

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// The ONE Touches parser — extract the `## Touches` section the same way every other consumer does.
import { extractTouchesSection } from "./touches-parser.ts";

/** Repo-root-relative path of the shrink-only grandfather baseline (bare-dir-touches precedent). */
export const ONE_ENTRY_BASELINE_REL = "docs/analysis/touches-one-entry-one-path-baseline.md";

/**
 * Remove ALL parenthetical annotations (full-width `（…）` AND ASCII `(…)`) from a Touches bullet.
 * Repo paths never contain parentheses (the ONE parser's own invariant), so ANY (…) is an annotation
 * — including a NON-trailing one followed by "——" text, which the parser's trailing-annotation strip
 * (`stripTouchAnnotation`) cannot reach (e.g. `plugin/test/ 真安装族 12 文件（a / b）——夹具复用改造`:
 * the `（…）` is not at the line end, so the trailing strip misses it and a naive " / " test would
 * false-positive on the annotation's slashes). Removing every parenthetical first makes the " / "
 * test see ONLY the path tokens. This is a judgement-time normalization on the RAW bullet — it does
 * NOT change what parseTouchEntriesWithTags produces (the parser keeps its trailing-strip contract).
 */
export function stripAllTouchAnnotations(entry) {
  return String(entry)
    .replace(/（[^）]*）/g, "") // full-width （…） anywhere
    .replace(/\([^)]*\)/g, "")  // ASCII (…) anywhere
    .replace(/^[`"'']+|[`"'']+$/g, "") // surrounding quotes/backticks (same strip the parser applies)
    .trim();
}

/**
 * Path-separating delimiters that make a single Touches bullet multi-path. A bullet is multi-path
 * when it declares ≥2 REAL paths in ONE line — the delimiters between them are:
 *   " / "  — space-slash-space (the separator the original multi-path bullets used, e.g. AC66);
 *   " + "  — space-plus-space (the AC93/ac86/AC91 fan-in case, e.g.
 *             `plugin/scripts/it0-split-or-commit-check.ts + experiments/.../it0-split-or-commit-check.ts`);
 *   "、"    — full-width 顿号 (dunhao / enumeration comma), the AC76 fan-in case
 *             (`plugin/scripts/slot-refill.ts、plugin/scripts/fast-mode-telemetry.ts`);
 *   "，"    — full-width comma;
 *   ","    — half-width comma.
 * Presence of a delimiter is NOT enough on its own (prose bullets carry ，/、/,-separated text); we
 * also require that ≥2 of the resulting tokens are path-like (see PATH_TOKEN_RE below), so a
 * single-path bullet with prose, timestamps, or a glob brace-expansion group is never a false
 * positive. Delimiters inside a （…） annotation or a {a,b,c} brace group are stripped first.
 */
export const MULTI_PATH_SEPARATOR_RE = / \/ | \+ |、|，|,/;

/** Glob brace-expansion groups ({a,b} — ONE glob entry; the commas inside are NOT path separators). */
export const BRACE_GROUP_RE = /\{[^}]*\}/g;

/**
 * A token counts toward the ≥2-paths judgment when it is a REAL repo path:
 *   * dir/file.ext          — contains a path separator AND a dotted filename (e.g. a.ts, a.md);
 *   * barefilename.ext      — no separator, but a known repo extension (e.g. slot-refill.ts);
 *   * dir/glob*             — contains a path separator AND a glob wildcard (* or ?), e.g.
 *                             `plugin/scripts/*` (the AC86 fan-in shape, joined by " + ") — a
 *                             glob is a real Touches path pattern even without a dotted filename.
 * Prose tokens (Chinese text, `12:22:04/07/10` timestamps, `2026-07-28` dates, `{a,b}` brace items
 * that survived stripping, prose like `加排除项修复`) are NOT path-like and never count. A token
 * with `/` but neither a dotted segment nor a wildcard (a bare-dir prose fragment like
 * `plugin/test/ 真安装族`) is NOT path-like — the dir itself is judged by the bare-dir rules, not here.
 */
export const PATH_TOKEN_RE = /(?:[\/\\][^\/\\]*\.[^\/\\]+)|(?:^[\w@.+()-]+\.(?:ts|js|mjs|md|sh|json|ya?ml|tsx|jsx|css|html|svg|png|txt|toml|go|py|rb|c|h|cc|cpp)$)|(?:[\/\\][^\/\\]*[*?][^\/\\]*)/;

/**
 * Flag multi-path Touches bullets. Returns [{ raw, path }]:
 *   raw  — the bullet text after the `- ` marker (with its annotation, for reporting);
 *   path — the annotation-stripped content (the composite, when multi-path).
 * A bullet is multi-path when, after stripAllTouchAnnotations + brace-strip, splitting on
 * MULTI_PATH_SEPARATOR_RE yields ≥2 path-like tokens (PATH_TOKEN_RE). Single-path bullets, prose-only
 * bullets, glob brace-expansion entries, and bullets whose separator lives inside a （…） annotation
 * are NOT flagged.
 */
export function flagMultiPathTouchEntries(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/); // the ONE parser's per-line extraction idiom
    if (!m) continue;
    const entry = m[1].trim();
    const cleaned = stripAllTouchAnnotations(entry).replace(BRACE_GROUP_RE, "");
    const pathTokens = cleaned
      .split(MULTI_PATH_SEPARATOR_RE)
      .map((t) => t.trim())
      .filter((t) => PATH_TOKEN_RE.test(t));
    if (pathTokens.length >= 2) out.push({ raw: entry, path: cleaned });
  }
  return out;
}

// ── AC3 DIRECTORY-LEVEL tasks glob HINT (tasks/gap-directory-level-tasks-touch-global-lock) ─────────
// A `## Touches` entry that declares a DIRECTORY-LEVEL tasks glob — `tasks/*.md`, `tasks/*`,
// `tasks/**`, `tasks/**/*.md`, `tasks/` — expands (in the dispatch disjointness check) to EVERY task
// file. Because C8 forces every task to self-touch its OWN `tasks/<id>.md`, such a glob overlaps every
// OTHER task's MANDATORY self-file while its declarer is in flight ⇒ a GLOBAL dispatch lock (measured:
// doc-lint held it 3h40m; occurrence rate 45). This is the WRITING-SIDE 防复发 prompt (AC3): NOT a
// hard ban (⛔ 目录级不禁止 — the author may legitimately need to touch many task files, and the
// dispatch-side semantics of slot-refill's checkTouchesPairInFlight already make the intersection
// non-blocking). The checker flags a directory-level tasks glob UNLESS the bullet carries an explicit
// acknowledgment — 「要么枚举具体文件，要么明确『我知道这是全局锁』」. Single-path entries (`tasks/foo.md`)
// and targeted file-name globs (`tasks/gap-*-cleanup.md`) are NOT directory-level and are never
// flagged (别误伤正常单路径条目).

/** A directory-level tasks glob: after stripping annotations, the path is `tasks/*`, `tasks/**`,
 *  a `tasks/**`-with-subpath glob (e.g. `tasks/**` + `/*.md`), or `tasks/` (trailing-slash dir glob).
 *  The leading `*`/`?` (or `**`) directly after `tasks/` is what makes it DIRECTORY-level — it covers
 *  every entry under tasks/ rather than one concrete task file. A targeted file-name glob
 *  (`tasks/gap-*-cleanup.md` — a concrete prefix before the wildcard) is NOT directory-level and is
 *  not flagged. */
export const DIRECTORY_LEVEL_TASKS_GLOB_RE = /^tasks\/[*?]|^tasks\/\*\*|^tasks\/$/;

/** The explicit acknowledgment that suppresses the directory-level-tasks-glob hint: the author states
 *  they KNOW the entry is a global lock (task AC3 — 「要么枚举要么明确『我知道这是全局锁』」). A bullet
 *  whose RAW text carries 全局锁 / global lock is acknowledged and left alone (the hint is a prompt,
 *  not a ban — an acknowledged directory glob is a deliberate choice). */
export const DIRECTORY_GLOB_ACK_RE = /全局锁|global\s*lock/i;

/** Flag Touches entries that declare a DIRECTORY-LEVEL tasks glob WITHOUT an explicit acknowledgment.
 *  Returns [{raw, path}]: raw is the bullet text after the `- ` marker (with its annotation, for
 *  reporting); path is the annotation-stripped entry. A bullet whose raw text acknowledges the global
 *  lock (DIRECTORY_GLOB_ACK_RE) is skipped. Single-path and targeted-file-glob entries never flag. */
export function flagDirectoryLevelTasksGlobs(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/); // the ONE parser's per-line extraction idiom
    if (!m) continue;
    const entry = m[1].trim();
    if (DIRECTORY_GLOB_ACK_RE.test(entry)) continue; // explicitly acknowledged → tolerated
    const cleaned = stripAllTouchAnnotations(entry);
    if (DIRECTORY_LEVEL_TASKS_GLOB_RE.test(cleaned)) out.push({ raw: entry, path: cleaned });
  }
  return out;
}

/** AC3 whole-store HINT scan: task files whose `## Touches` carries a directory-level tasks glob
 *  without an explicit acknowledgment. Returns [{file, what}] sorted by file. HINTS ONLY — never a
 *  violation, never affects the exit code (⛔ 目录级不禁止; the multi-path shape rule above is the hard
 *  gate, this is the 防复发 prompt). A task with no `## Touches` section is NOT-EVALUATED (硬规则 3b). */
export function scanTasksDirectoryGlobHints(tasksDir) {
  const hints = [];
  if (!fs.existsSync(tasksDir)) return hints;
  for (const f of fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))) {
    const body = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const { hasSection, section } = extractTouchesSection(body);
    if (!hasSection) continue;
    const flagged = flagDirectoryLevelTasksGlobs(section);
    if (flagged.length === 0) continue;
    for (const fl of flagged) {
      hints.push({
        file: path.join("tasks", f),
        what: `## Touches 含目录级 tasks glob（gap-directory-level-tasks-touch-global-lock AC3 提示）：${fl.path} —— 目录级条目在在飞期间与任何任务的 self-touch（C8 强制 tasks/<id>.md）相交 ⇒ 全局派发锁（实证 doc-lint 3h40m，发生率 45）。请枚举具体文件清单，或显式标注（已知全局锁）确认知晓。`,
      });
    }
  }
  hints.sort((a, b) => a.file.localeCompare(b.file));
  return hints;
}

/** Read the shrink-only grandfather list. Absent file ⇒ empty set (nothing grandfathered). */
export function readOneEntryBaseline(root) {
  const p = path.join(root, ONE_ENTRY_BASELINE_REL);
  if (!fs.existsSync(p)) return { baseline: new Set(), baselineCount: null };
  const text = fs.readFileSync(p, "utf8");
  const countMatch = text.match(/^# baseline-count:\s*(\d+)/m);
  const baseline = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    baseline.add(t);
  }
  return { baseline, baselineCount: countMatch ? Number(countMatch[1]) : null };
}

/**
 * Judge ONE task body (判据1). Returns [] when the task is grandfathered, has no `## Touches`
 * section, or every Touches bullet is single-path; returns [{code, what}] for each multi-path bullet.
 * `taskFileRel` is the repo-root-relative path (e.g. "tasks/gap-ac66-….md") — the baseline keys on it.
 */
export function checkTaskOneEntryOnePath(body, taskFileRel, grandfathered) {
  if (grandfathered.has(taskFileRel)) return [];
  const { hasSection, section } = extractTouchesSection(body);
  if (!hasSection) return [];
  const flagged = flagMultiPathTouchEntries(section);
  if (flagged.length === 0) return [];
  const entries = flagged.map((f) => `\`${f.path}\``).join(" · ");
  return [{
    code: "touches-multi-path-bullet",
    what:
      `## Touches 含多路径 bullet（tasks/gap-touches-one-entry-one-path 判据1：Touches bullet 只允许一个` +
      `路径/glob 条目，含多路径分隔（" / " / " + " / "、" / "，" / ","）的多路径 bullet ⇒ 红——parseTouchEntriesWithTags 把整行当一个 entry，` +
      `组合串匹配不到任何文件、且把每个真实路径藏起来使 checkTouchesPair 判不到重叠）：${entries}`,
  }];
}

/**
 * Scan a tasks directory. Returns [{ file, code, what }] — one row per task file with a multi-path
 * bullet, sorted by file. Grandfathered files are skipped (documented pre-rule debt). A task with no
 * Touches section is NOT a violation (NOT-EVALUATED, 硬规则 3b — never conflated with clean).
 */
export function scanTasksOneEntryOnePath(tasksDir, root) {
  const { baseline } = readOneEntryBaseline(root);
  const violations = [];
  if (!fs.existsSync(tasksDir)) return violations;
  for (const f of fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))) {
    const rel = path.join("tasks", f);
    const body = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const v = checkTaskOneEntryOnePath(body, rel, baseline);
    for (const x of v) violations.push({ file: rel, ...x });
  }
  violations.sort((a, b) => a.file.localeCompare(b.file));
  return violations;
}

function usage() {
  process.stderr.write("Usage: touches-one-entry-one-path-check.ts --root <repo-root>\n");
  process.stderr.write("       Scans tasks/*.md ## Touches for multi-path bullets (判据1) and exits 1 on any non-grandfathered occurrence.\n");
}

export function main(argv) {
  const args = argv.slice(2);
  let root = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i]; continue; }
    if (args[i] === "--strict-subset") {
      // The scoped static-check tier appends `--strict-subset <touched task files>` (subset-touched
      // scoped-mode, gap-scoped-runs-pay-full-static-check-overhead). The check is a WHOLE-STORE
      // scan — a multi-path Touches bullet anywhere is a shape violation, not just on the touched
      // file — so the subset arg is consumed and the scan is not narrowed (the malformed-task-check
      // idiom: a defect anywhere must not be masked by a per-file subset).
      i = args.length; // consume the rest as the subset (ignored)
      continue;
    }
    usage();
    return 2;
  }
  if (!root) { usage(); return 2; }
  const rootDir = path.resolve(root);
  const tasksDir = path.join(rootDir, "tasks");
  const violations = scanTasksOneEntryOnePath(tasksDir, rootDir);
  for (const v of violations) {
    process.stdout.write(`  ${v.file}: ${v.what}\n`);
  }
  process.stdout.write(
    `TOUCHES-ONE-ENTRY-ONE-PATH: ${violations.length} multi-path bullet(s) — ` +
    (violations.length === 0 ? "every Touches bullet is single-path" : "multi-path bullets present (split each into one entry per line)") + "\n",
  );
  // AC3 (tasks/gap-directory-level-tasks-touch-global-lock): the directory-level tasks glob HINT.
  // HINTS ONLY — never a violation, never affects the exit code (⛔ 目录级不禁止). Printed for the
  // author / gate reviewer as a 防复发 prompt: either enumerate concrete files or add（已知全局锁）.
  const dirGlobHints = scanTasksDirectoryGlobHints(tasksDir);
  for (const h of dirGlobHints) {
    process.stdout.write(`  [HINT] ${h.file}: ${h.what}\n`);
  }
  process.stdout.write(
    `TOUCHES-DIR-GLOB-HINT: ${dirGlobHints.length} directory-level tasks/*.md glob(s) — ` +
    (dirGlobHints.length === 0
      ? "none (every Touches entry enumerates concrete paths or acknowledges)"
      : "enumerate concrete files or add（已知全局锁）(hint only, not a violation)") + "\n",
  );
  return violations.length === 0 ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "touches-one-entry-one-path-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
