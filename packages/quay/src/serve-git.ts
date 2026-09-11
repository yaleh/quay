// serve-git.ts — /git-history route handler + git graph layout, split from serve-handlers.ts.
//
// gap-git-graph-adopt-git-column-algorithm-and-decorate-labels: this file no longer models the graph
// as branch/lane OBJECTS. It adopts git's own layout — `git log --graph --all` — by (1) reading commits
// in git's emission order (observation.readGitHistory uses `--all --topo-order`), (2) assigning each
// commit a column with git graph.c's active-column + recycle algorithm, and (3) drawing one row per
// commit with inline `%D` decoration labels (a branch name appears ONLY on the commit a ref points at).
// The retired lane model's fold/expand, stride chips, hit rects, fork/merge/open classification and
// 「窗口外分叉」 markers are all gone — the page has zero click controls.
//
// gap-git-graph-task-view-aggregate-commits-by-task-id: a SECOND, opt-in view (`?view=task`) groups the
// SAME commits by the task id extracted from their subject (taskIdFromSubject) instead of by git column
// topology. It is a project-specific heuristic over driver commit-text conventions, NOT git semantics,
// so it is an opt-in view — the default stays the git view (AC5 byte-identity). The task view's output
// (TaskGraphLayout) is model-independent: it promises only 「每提交一行 + 分组归属 + unattributedCount」,
// and never references the retired fork/merge/open/overflow swimlane fields (AC7).

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readGitHistory, readGitRemotes, type GitHistoryCommit, type GitHistoryResult, GIT_HISTORY_LIMIT } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, pad2 } from "./serve-render.ts";

// ── Graph-track geometry ────────────────────────────────────────────────────────────────────────────
// One fixed text column on the right; the graph track on the left (the git log --graph / gitk model).

/** x of column 0 — the left anchor of the graph track. */
export const GIT_GRAPH_TRUNK_X = 40;
/** Legacy seed for the commit-text x (the pre-pagination fixed column). The client now recomputes
 *  textX dynamically from the rightmost column so the text always sits PAST the track
 *  (gap-git-graph-pagination-appends-page-relative-col-and-torow); kept for the geometry doc + any
 *  caller that still reads the seed. */
export const GIT_GRAPH_TEXT_X = 220;
/** Horizontal spacing between adjacent columns within the track. */
export const GIT_GRAPH_LANE_GAP = 16;
/** Vertical padding above the first row. */
export const GIT_GRAPH_PAD_Y = 24;
/**
 * Fixed row height — one commit per band. Bumped 24 → 26 when decorations became chip-sized
 * (gap-git-graph-decoration-labels-as-colored-chips): a 16px chip + its padding needs more headroom
 * than the old 11px plain-text baseline did, so adjacent rows' chips never crowd/overlap (AC6).
 */
export const GIT_GRAPH_ROW_H = 26;
/** Decoration-chip geometry (gap-git-graph-decoration-labels-as-colored-chips) — interpolated into the
 *  client renderer as plain numbers; a chip is a rounded `rect` behind an inline `text`, laid out
 *  hash → chips → subject across one commit row. */
export const GIT_GRAPH_CHIP_H = 16;
export const GIT_GRAPH_CHIP_PAD_X = 5;
export const GIT_GRAPH_CHIP_RX = 4;
export const GIT_GRAPH_CHIP_GAP = 5;
export const GIT_GRAPH_DECOR_FONT_SIZE = 10;
/**
 * Auto-load fuse (gap-git-graph-no-bounded-scroll-panel): the client scroll-loader auto-loads AT MOST
 * this many rows beyond the initial window (via IntersectionObserver + the self-chain) before degrading
 * the sentinel to a manual 「点击加载更早提交」 button. 2500 rows ≈ 5 pages × 500 — a small slice of the
 * full repo (~19,520 commits) whose whole-DOM full-repaint cost is the long-term leak this caps; the
 * rest loads one click at a time. Exported so the AC5 test can mock exactly the right number of pages.
 */
export const GIT_GRAPH_AUTO_LOAD_ROW_LIMIT = 2500;

/**
 * Categorical column palette — eight distinct HUES (not shades of one), each dark enough to hold ≥3:1
 * contrast against the light canvas (--color-neutral-100 / #f8f4f4). Slot-indexed by column number:
 * column `c` draws with `var(--color-lane-(c % 8))`, so two ADJACENT columns always differ in hue.
 * Restored verbatim from the retired lane model (gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-
 * not-anchored AC10 pins it to `git show 303a94950^:packages/quay/src/serve-git.ts` item-by-item).
 */
export const GIT_GRAPH_LANE_PALETTE: readonly string[] = [
  "#b71c1c", // red
  "#0d47a1", // blue
  "#1b5e20", // green
  "#4a148c", // purple
  "#004d40", // teal
  "#bf360c", // deep orange
  "#880e4f", // pink
  "#1a237e", // indigo
];

/**
 * The client renderer references column colours as `var(--color-lane-N)` TOKENS, never hex — the hex
 * values stay HERE (one source of truth) and are emitted as a scoped token sheet by
 * gitGraphLaneTokenCss(). Restored alongside GIT_GRAPH_LANE_PALETTE for per-column colouring (AC9).
 */
export function gitGraphLaneTokenCss(): string {
  const laneDefs = GIT_GRAPH_LANE_PALETTE.map((hex, i) => `--color-lane-${i}:${hex};`).join("");
  return `#git-graph{${laneDefs}}`;
}

// ── The per-commit row model (gap-git-graph-adopt-git-column-algorithm-and-decorate-labels) ─────────

export interface GitGraphEdge {
  /** The commit's own column. */
  fromCol: number;
  /** The parent's column (== the parent's final assigned column). */
  toCol: number;
  /** `parent` = first parent (vertical continuation); `merge` = a second-or-later parent (diagonal). */
  kind: "parent" | "merge";
  /**
   * The parent's row index in the window — the y-anchor the client draws this edge's ENDPOINT at
   * (`y(toRow)`). This is the data that fixes gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-
   * not-anchored: the endpoint used to be `y(i) + rowH * 0.65` (a fixed 15.6px stub), leaving every
   * cross-column edge dangling. -1 when `outsideWindow` (the parent has no row in this window).
   */
  toRow: number;
  /**
   * true when the parent is NOT in this window (`git log -n limit` cut it off) — the edge is drawn
   * as a dashed stub from the commit's node down to the window boundary, so "there is more below"
   * is VISIBLE rather than the line silently ending (硬规则 3b: an invisible end is not "no parent").
   */
  outsideWindow: boolean;
}

/** One row = one commit, in git emission order (newest FIRST, so row 0 is the newest commit). */
export interface GitGraphRow {
  hash: string;
  /** git graph.c column number — the SAME number `git log --graph` assigns (AC1 judge). */
  col: number;
  /** Commit timestamp (unix seconds). */
  t: number;
  subject: string;
  /** Number of parents (the commit node is a diamond when > 1). */
  parents: number;
  parentHashes: string[];
  /** `%D` decoration entries — rendered inline; a ref name appears only on the commit it points at. */
  decorations: string[];
  /** Edges from this commit to its (in-window) parents. */
  edges: GitGraphEdge[];
}

export interface GitGraphLayout {
  rows: GitGraphRow[];
  commitCount: number;
  mergeCount: number;
}

/**
 * Assign every commit a column, matching `git log --graph --all` EXACTLY (verified 19175/19175 = 0
 * mismatch on the production repo). This is git graph.c `graph_update_columns` distilled:
 *
 *   - `columns[]` is the set of commits whose branch line is still being drawn (parents seen but not
 *     yet emitted), in column order. A commit's column is its index in this array when IT is emitted.
 *   - Emitting C: remove C and insert C's parents at C's position (first parent inherits C's column;
 *     later parents append), de-duplicating any parent already present in `columns` — that de-dup IS
 *     the column recycling (a shared parent collapses onto its first-parent column instead of opening
 *     a new one), which is what keeps git at ~6 columns where a lane model explodes to 25+.
 *
 * Pure and deterministic on its input; tested against the real git oracle before any SVG is drawn.
 */
export function assignGitColumns(commits: Array<{ hash: string; parentHashes: string[] }>): Map<string, number> {
  let columns: string[] = [];
  const col = new Map<string, number>();
  for (const C of commits) {
    let k = columns.indexOf(C.hash);
    if (k === -1) k = columns.length; // a tip with no child yet — it opens a new column
    col.set(C.hash, k);
    const newColumns: string[] = [];
    const inNew = new Set<string>();
    const add = (h: string): void => {
      if (!inNew.has(h)) { inNew.add(h); newColumns.push(h); }
    };
    for (let i = 0; i < columns.length; i++) {
      if (columns[i] === C.hash) {
        for (const p of C.parentHashes) add(p);
      } else {
        add(columns[i]);
      }
    }
    if (k === columns.length) {
      for (const p of C.parentHashes) add(p);
    }
    columns = newColumns;
  }
  return col;
}

/**
 * Build the per-commit row model. Rows are in git emission order (newest first — AC6's smallest y IS
 * the newest commit). Each commit carries its column, its `%D` decorations, and one edge per in-window
 * parent (the edge's `toCol` is the PARENT's final column, so a shared/merge parent collapses onto its
 * first-parent column exactly as git draws it). Returns null for an empty/error history.
 */
export function layoutGitGraph(history: GitHistoryResult): GitGraphLayout | null {
  if (history.status !== "ok" || history.commits.length === 0) return null;
  const cols = assignGitColumns(history.commits);
  // hash → row index, so an edge can carry the PARENT's row (`toRow`) as its endpoint anchor.
  // gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored: the client previously drew
  // the endpoint at `y(i) + rowH*0.65` (a fixed stub) because it had no way to find the parent's row.
  const rowIndex = new Map<string, number>();
  history.commits.forEach((c, i) => rowIndex.set(c.hash, i));
  const rows: GitGraphRow[] = history.commits.map((c) => {
    const colC = cols.get(c.hash) as number;
    // One edge per parent, in `parentHashes` order — `edges[pi]` always corresponds to `parentHashes[pi]`.
    const edges: GitGraphEdge[] = c.parentHashes.map((p, pi) => {
      const colP = cols.get(p);
      if (colP === undefined) {
        // parent outside the window — keep the edge, MARKED, so "the line continues below" is visible.
        // Its true column is unknown until the older page loads; the dashed stub continues the child's
        // own column straight down to the window boundary.
        return { fromCol: colC, toCol: colC, kind: pi === 0 ? "parent" : "merge", toRow: -1, outsideWindow: true };
      }
      return {
        fromCol: colC,
        toCol: colP,
        kind: pi === 0 ? "parent" : "merge",
        toRow: rowIndex.get(p) as number,
        outsideWindow: false,
      };
    });
    return {
      hash: c.hash,
      col: colC,
      t: c.t,
      subject: c.subject,
      parents: c.parents,
      parentHashes: c.parentHashes,
      decorations: c.decorations,
      edges,
    };
  });
  return { rows, commitCount: rows.length, mergeCount: rows.filter((r) => r.parents > 1).length };
}

/**
 * This repo's task-id prefixes. ONE source for every form below: a form that recovers an id WITHOUT
 * this guard can hand back a verb particle as if it were a task id (硬规则 3b — 读不懂 ⇒ 伪装成合格).
 * The real subject `tasks: carry <id> AC state from author (6/8 ticked)` did exactly that: Form 2/3's
 * closed `翻|reset` particle list did not know `carry`, so the id was never recovered and the commit
 * was filed under the bogus group `carry` — stranding it from its task and making the AC6
 * subject-mention reconciliation come up one short.
 */
const TASK_ID_PREFIXES = "gap|DIR|exp5|QN|QX|QC|QW|QENG|ARCH|cand|SU|PROBE|TEST";
/** A `<prefix>-<slug>` token. */
const TASK_ID_SLUG = `(?:${TASK_ID_PREFIXES})-[A-Za-z0-9][A-Za-z0-9_-]*`;
/** First `<prefix>-<slug>` token in a subject, left-anchored so a longer word never yields a partial. */
const RE_ANY_TASK_ID = new RegExp(`(?:^|[^A-Za-z0-9_-])(${TASK_ID_SLUG})`);
/** Form 4 — `<id>:` at the head of a subject. */
const RE_HEAD_TASK_ID = new RegExp(`^(${TASK_ID_SLUG}):\\s`);
/** Form 5 — `<type|scope>: <id> …`. */
const RE_TYPED_TASK_ID = new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]*:\\s+(${TASK_ID_SLUG})`);
/** Form 6 — `… (<id>)` at end-of-subject. */
const RE_PAREN_TASK_ID = new RegExp(`\\((${TASK_ID_SLUG})\\)\\s*$`);

/**
 * Extract a task id from a commit SUBJECT, covering this repo's four structured commit-message
 * shapes (gap-git-graph-task-view-aggregate-commits-by-task-id):
 *
 *   1. `Merge branch 'develop' into task/<id>`   — the ff-carried dev-merge
 *   2. `tasks: 翻 <id> done（driver 机械 fan-in）`  — the fan-in landing
 *   3. `tasks: <id> task_write` / `tasks: <id> todo→ready（promotion-driver）` / `tasks: reset <id> done→ready`
 *   4. `<id>: <实现说明>`                          — an implementation commit, the id before the colon; its
 *      first segment must be a KNOWN task-id prefix (same guard as Forms 5/6)
 *   5. `<type|scope>: <id> <说明>`                 — a conventional-commit type OR a worker scope prefix
 *      (e.g. `test: gap-… 独立闭合确认` / `fix: gap-… — …` / `webui: gap-… 实现（…）`); the id's first
 *      segment must be a KNOWN task-id prefix so a generic slug (`chore: re-anchor …`) is never
 *      mistaken for one (AC6 reconciliation)
 *
 * Unrecognised subjects (e.g. `chore: re-anchor …`) return `null`, never a guess (fail-visible —
 * 硬规则 3b). EVERY form gates the id's first segment on a KNOWN task-id prefix (this repo's task
 * slugs — `gap-…`, `DIR-…`, `exp5-…`, …), so a conventional type (`chore:`), a component/page name
 * (`git-history: …` / `fix: git-history 分页页 …`), or a driver action verb (`carry` / `revert` /
 * `refresh` — Forms 2/3 lead with one) is never mistaken for a task id (AC1/AC6 reconciliation).
 * Forms 2/3 recover the FIRST known-prefix token rather than the first token outright, precisely
 * because the verb vocabulary is open-ended (one verb per driver action, and every added verb used to
 * strand the id) — the guard lives on the ID, never on a closed verb or type list. This is a
 * project-specific heuristic over driver commit-text conventions, not git semantics — when the
 * convention changes the task view degrades, while the git view is unaffected (硬规则 4b).
 */
export function taskIdFromSubject(subject: string): string | null {
  const s = String(subject).trim();
  if (!s) return null;

  // Form 1 — the task branch is always named `task/<id>` (quoted, or in the unquoted `into` clause).
  const mergeTask = s.match(/\btask\/([A-Za-z0-9][A-Za-z0-9_-]*)/);
  if (mergeTask) return mergeTask[1];

  // Forms 2+3 — `tasks:` prefix. The id may be preceded by an open-ended verb particle (`翻` / `reset`
  // / `carry` / `refresh` / …) that names the action, and may be followed by prose that itself mentions
  // the id — so recover the FIRST known-prefix token, not the first token. No known-prefix token at
  // all ⇒ null (the commit is explicitly unattributed, never filed under a verb).
  if (s.startsWith("tasks:")) {
    const m = s.slice("tasks:".length).match(RE_ANY_TASK_ID);
    return m ? m[1] : null;
  }

  // Form 4 — `<id>: <说明>`, the id a multi-segment slug whose FIRST segment must be a KNOWN task-id
  // prefix (same guard as Forms 5/6), so a component/page name (`git-history: …`) is never mistaken
  // for a task id — it falls through to Form 6 and extracts the trailing-parens id instead.
  const impl = s.match(RE_HEAD_TASK_ID);
  if (impl) return impl[1];

  // Form 5 — `<type|scope>: <id> <说明>`: a conventional-commit type OR a worker scope prefix (this
  // repo's agents emit `webui:`/`inner:`/`archive:` etc. before the id), then a task id. The id's
  // first segment must be a KNOWN task-id prefix, so a generic verb slug after the type (`chore:
  // re-anchor quay-init-closure-ratchet baseline`) or a page/file name (`fix: git-history 分页页 …`)
  // is never mistaken for a task id (AC1) — the guard lives on the ID, not on an ever-drifting closed
  // type list (a one-off `webui:` commit would otherwise strand its task id in AC6 reconciliation).
  const typed = s.match(RE_TYPED_TASK_ID);
  if (typed) return typed[1];

  // Form 6 — trailing-parens id: `<说明> (gap-…)` (e.g. `dashboard: 顶部行改 … (gap-dashboard-top-row-
  // asymmetric-columns)`). Same known-prefix guard as Form 5, anchored to end-of-subject so a bare
  // parenthetical (`… (updated)`) is never mistaken for a task id (AC6 reconciliation).
  const paren = s.match(RE_PAREN_TASK_ID);
  if (paren) return paren[1];

  return null;
}

// ── The task view (gap-git-graph-task-view-aggregate-commits-by-task-id) ───────────────────────────

/** The view selector: `git` = the git DAG topology (default); `task` = task-id grouping. */
export type GitGraphView = "git" | "task";

/** One task-id group — every commit whose subject yields this task id, in git emission order. */
export interface TaskGraphGroup {
  id: string;
  commits: GitHistoryCommit[];
  /** Newest/oldest commit landing time within the group. */
  firstT: number;
  lastT: number;
}

/**
 * The task view's layout. Deliberately model-INDEPENDENT (AC7): it promises only groups + counts,
 * never the retired fork/merge/open/overflow swimlane fields, so it survives the git-column rewrite
 * of gap-git-graph-adopt-git-column-algorithm-and-decorate-labels. The identity
 * `commitCount − Σ group commits = unattributedCount` holds (AC4), and the unattributed count is an
 * explicit field — never conflated with "no unattributed commits" (硬规则 3b).
 */
export interface TaskGraphLayout {
  /** Task-attributed groups, most-recently-active first. The unattributed commits are NOT a group. */
  groups: TaskGraphGroup[];
  commitCount: number;
  unattributedCount: number;
}

/**
 * The task-view grouping function — the ONLY thing that differs from the git view: commits are grouped
 * by `taskIdFromSubject(subject)`, not by git ref/merge topology. Commits no task id could be recovered
 * from are counted in `unattributedCount` (shown explicitly on the page, never "no unattributed"). PURE
 * and deterministic on its input; references no swimlane field (AC7).
 */
export function layoutTaskGraph(history: GitHistoryResult): TaskGraphLayout | null {
  if (history.status !== "ok" || history.commits.length === 0) return null;
  const byTask = new Map<string, GitHistoryCommit[]>();
  let unattributedCount = 0;
  for (const c of history.commits) {
    const id = taskIdFromSubject(c.subject);
    if (id == null) {
      unattributedCount++;
      continue;
    }
    const list = byTask.get(id);
    if (list) list.push(c);
    else byTask.set(id, [c]);
  }
  const groups: TaskGraphGroup[] = [...byTask.entries()].map(([id, commits]) => {
    let firstT = commits[0].t;
    let lastT = commits[0].t;
    for (const c of commits) {
      if (c.t < firstT) firstT = c.t;
      if (c.t > lastT) lastT = c.t;
    }
    return { id, commits, firstT, lastT };
  });
  // Most-recently-active task first — the view answers "which tasks moved recently".
  groups.sort((a, b) => b.lastT - a.lastT || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { groups, commitCount: history.commits.length, unattributedCount };
}

/** Format a coverage span (seconds) as "N 小时" / "N 天". Mirrored verbatim by the client loader. */
export function formatCoverageSpan(sec: number): string {
  if (sec >= 86400) {
    const d = sec / 86400;
    return `${d >= 10 ? Math.round(d) : Math.round(d * 10) / 10} 天`;
  }
  const h = sec / 3600;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} 小时`;
}

/** The loaded window's time span (newest − oldest commit time). Grows as the scroll loader appends. */
export function coverageSpanSeconds(layout: GitGraphLayout): number | null {
  if (layout.rows.length === 0) return null;
  let min = layout.rows[0].t;
  let max = layout.rows[0].t;
  for (const r of layout.rows) {
    if (r.t < min) min = r.t;
    if (r.t > max) max = r.t;
  }
  return max - min;
}

/** `unix seconds` → `YYYY-MM-DD HH:MM:SS` (local). Used by the task view's group summaries. */
function isoTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ── D3 inlining (the third-party library the retired 「零客户端 JS」 invariant now permits) ──

const __webuiD3Global = globalThis as unknown as { __WEBUI_D3_JS__?: string };

/** Resolve d3.min.js's path by walking up from this module (dev-tree fallback; the dist bundle uses
 *  the inlined globalThis.__WEBUI_D3_JS__ and never reaches here). */
function d3MinJsPath(): string | null {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 16; i++) {
      const candidate = path.join(dir, "node_modules", "d3", "dist", "d3.min.js");
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/** The D3 library source to inline into the /git-history page ("" when unavailable). */
function gitGraphLibJs(): string {
  if (__webuiD3Global.__WEBUI_D3_JS__ !== undefined) return __webuiD3Global.__WEBUI_D3_JS__;
  const p = d3MinJsPath();
  if (!p) return "";
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/**
 * The client-side D3 renderer. One row per commit (newest first), a dot/diamond node at the commit's
 * column, a vertical line per active column, a ROUNDED-ORTHOGONAL path per cross-column parent edge
 * (anchored to the parent's row — gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored),
 * and inline `hash (decorations) subject` text. Columns and edges are hue-coded per column number via
 * `var(--color-lane-N)` tokens (AC9). NO interaction (no fold/expand, no chips, no hit rects). The
 * generated JS carries no template literal, `${`, or `</script` so it inlines verbatim — geometry
 * constants are interpolated SERVER-side as plain numbers, and column colours as `var(--color-lane-N)`
 * tokens (the hex stays in GIT_GRAPH_LANE_PALETTE).
 */
export function gitGraphClientScript(): string {
  return `(function () {
  var mount = document.getElementById("git-graph");
  var dataEl = document.getElementById("git-graph-data");
  var scrollEl = document.getElementById("git-graph-scroll");
  if (!mount || !dataEl || typeof d3 === "undefined") { return; }
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data || !data.rows || !data.rows.length) { return; }

  var rowH = ${GIT_GRAPH_ROW_H}, trunkX = ${GIT_GRAPH_TRUNK_X}, laneGap = ${GIT_GRAPH_LANE_GAP}, nodeR = 3.5, mergeR = 5, padY = ${GIT_GRAPH_PAD_Y};
  var chipH = ${GIT_GRAPH_CHIP_H}, chipPadX = ${GIT_GRAPH_CHIP_PAD_X}, chipRx = ${GIT_GRAPH_CHIP_RX}, chipGap = ${GIT_GRAPH_CHIP_GAP}, decorFontSize = ${GIT_GRAPH_DECOR_FONT_SIZE};
  var lanePalette = ${JSON.stringify(GIT_GRAPH_LANE_PALETTE.map((_, i) => `var(--color-lane-${i})`))};
  // Remote names from the server payload ("git remote") — the ONLY authority for "is this a
  // remote-tracking ref". A local branch that merely contains a slash (fix/..., task/...) must NOT be
  // misread as remote (gap-git-graph-decoration-labels-as-colored-chips).
  var remotes = (data.remotes && data.remotes.length) ? data.remotes : [];

  // Single-source column allocation (gap-git-graph-pagination-appends-page-relative-col-and-torow):
  // assignGitColumns is injected VERBATIM from the server module (assignGitColumns.toString()) so the
  // client's column assignment IS the exact function the adopt test cross-checks against git log --graph
  // — there is no second, independent column-allocation implementation in this script.
  var assignGitColumns = ${assignGitColumns.toString()};

  function y(row) { return padY + row * rowH; }
  function laneColor(col) { return lanePalette[col % lanePalette.length]; }

  // A remote-tracking ref starts with "<remoteName>/" for one of the repo's remotes (the authoritative
  // list, not a string-shape guess).
  function isRemoteRef(dec) {
    for (var i = 0; i < remotes.length; i++) {
      if (remotes[i] && dec.slice(0, remotes[i].length + 1) === remotes[i] + "/") { return true; }
    }
    return false;
  }

  // Split one %D decoration into the chips to render: "HEAD -> X" becomes ["HEAD", "X"] (HEAD rendered
  // as its own highlighted chip, X as a normal/ghost chip), anything else (a branch name, "tag: v1.2",
  // a bare detached "HEAD") is a single chip. Mirrors primaryRefFromDecorations' HEAD split. NOTE the
  // doubled backslashes: this regex literal lives inside a template literal, so \\s is what survives to
  // the emitted client JS as \s (a bare \s would be eaten by string-escape processing).
  function decorationChips(dec) {
    var m = /^HEAD\\s*->\\s*(.+)$/.exec(dec);
    if (m) { return ["HEAD", m[1]]; }
    return [dec];
  }

  // Recompute the layout quantities (col + edges) over the WHOLE merged row array. Each pagination page
  // arrives page-relative (or, after the fix, with no col/toRow at all); the only correct assignment is
  // GLOBAL — over every loaded row. Edges' toCol/toRow/outsideWindow are rebuilt from parentHashes too,
  // so an edge whose parent sits in a later-loaded page anchors to that parent's real row (no dangling).
  function recomputeLayout() {
    var cols = assignGitColumns(data.rows);
    var rowIndex = {};
    data.rows.forEach(function (r, i) { rowIndex[r.hash] = i; });
    data.rows.forEach(function (r) {
      var colC = cols.get(r.hash);
      r.col = colC;
      var edges = [];
      r.parentHashes.forEach(function (p, pi) {
        var colP = cols.get(p);
        if (colP === undefined) {
          edges.push({ fromCol: colC, toCol: colC, kind: pi === 0 ? "parent" : "merge", toRow: -1, outsideWindow: true });
        } else {
          edges.push({ fromCol: colC, toCol: colP, kind: pi === 0 ? "parent" : "merge", toRow: rowIndex[p], outsideWindow: false });
        }
      });
      r.edges = edges;
    });
  }

  // A rounded-orthogonal edge, two shapes by the edge's kind (gap-git-graph-edge-fold-bends-at-child-
  // for-first-parent-edges):
  //   · merge (bendAtParent=false) — horizontal out of the child node toward the parent's column, a
  //     rounded quarter-turn DOWN at the CHILD's row, then a vertical drop to the parent's row. The
  //     parent column does not exist above toRow, so the corner belongs at the child end.
  //   · parent (bendAtParent=true) — this branch's own lineage folds back into a column that keeps
  //     running downward: vertical out of the child's node down to the PARENT's row, then a rounded
  //     quarter-turn horizontally into the parent's column. The corner belongs at the PARENT end.
  // Both use only M/H/V/Q (no L), radius min(6, laneGap/2) > 0. Cross-column edges always satisfy
  // |toX - fromX| >= laneGap, so the corner radius never exceeds the horizontal run (AC8).
  function edgePath(fromX, fromY, toX, toY, bendAtParent) {
    var r = Math.min(6, laneGap / 2);
    if (bendAtParent) {
      var hs = toX >= fromX ? r : -r;
      return "M " + fromX + "," + fromY +
        " V " + (toY - r) +
        " Q " + fromX + "," + toY + " " + (fromX + hs) + "," + toY +
        " H " + toX;
    }
    var sign = toX >= fromX ? 1 : -1;
    return "M " + fromX + "," + fromY +
      " H " + (toX - sign * r) +
      " Q " + toX + "," + fromY + " " + toX + "," + (fromY + r) +
      " V " + toY;
  }

  function render() {
    var rows = data.rows;
    // textX follows the rightmost column: the text starts one laneGap PAST the highest column, so every
    // column line's x is strictly < the text's x — structurally the lines can never intrude the commit
    // text (AC3), even as the column count grows past the initial window (the page-relative col bug).
    var maxCol = 0;
    rows.forEach(function (r) { if (r.col > maxCol) { maxCol = r.col; } });
    var textX = trunkX + (maxCol + 1) * laneGap;
    var svg = d3.select(mount).select("svg");
    if (svg.empty()) {
      svg = d3.select(mount).append("svg").attr("class", "git-svg-surface").attr("role", "img")
        .attr("aria-label", "Git commit graph (git log --graph alignment)");
    }
    svg.selectAll("*").remove();
    var width = textX + 600; // seed; re-measured below to the true text right edge
    var height = y(rows.length - 1) + padY;
    svg.attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width).attr("height", height)
      .attr("style", "border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif");
    var g = svg.append("g");

    // column spans → one vertical line per active column
    var colMin = {}, colMax = {};
    rows.forEach(function (r, i) {
      if (colMin[r.col] === undefined) { colMin[r.col] = i; colMax[r.col] = i; }
      if (i < colMin[r.col]) { colMin[r.col] = i; }
      if (i > colMax[r.col]) { colMax[r.col] = i; }
    });
    for (var c in colMin) {
      g.append("line").attr("class", "git-svg-column")
        .attr("x1", trunkX + (+c) * laneGap).attr("x2", trunkX + (+c) * laneGap)
        .attr("y1", y(colMin[c])).attr("y2", y(colMax[c]))
        .attr("stroke", laneColor(+c)).attr("stroke-width", 1.2);
    }

    // cross-column parent edges (rounded-orthogonal paths); same-column parents are the vertical line
    // itself. The path ENDS at the PARENT's node (the edge's toRow), never a fixed stub — so a merge's two
    // connectors both reach their parent commits' nodes. A parent OUTSIDE the window is a dashed stub
    // from the commit's node down to the bottom boundary (a VISIBLE "there is more below", 硬规则 3b).
    // The fold corner is kind-directed: a merge (second+ parent) bends at the CHILD's row, a first-parent
    // lineage fold (kind === "parent") bends at the PARENT's row (gap-git-graph-edge-fold-bends-at-child-
    // for-first-parent-edges).
    rows.forEach(function (r, i) {
      r.edges.forEach(function (e) {
        if (e.outsideWindow) {
          g.append("line").attr("class", "git-svg-edge-outside")
            .attr("x1", trunkX + e.fromCol * laneGap).attr("y1", y(i))
            .attr("x2", trunkX + e.toCol * laneGap).attr("y2", y(rows.length))
            .attr("stroke", laneColor(e.fromCol)).attr("stroke-width", 1.2)
            .attr("stroke-dasharray", "4 3");
          return;
        }
        if (e.fromCol === e.toCol) { return; }
        g.append("path").attr("class", "git-svg-edge")
          .attr("d", edgePath(trunkX + e.fromCol * laneGap, y(i), trunkX + e.toCol * laneGap, y(e.toRow), e.kind === "parent"))
          .attr("fill", "none").attr("stroke", laneColor(e.fromCol)).attr("stroke-width", 1.6);
      });
    });

    // nodes + inline text (hash → decoration chips → subject; gap-git-graph-decoration-labels-as-
    // colored-chips: each %D entry is its own rounded chip, not part of one concatenated string)
    rows.forEach(function (r, i) {
      var cx = trunkX + r.col * laneGap;
      var cy = y(i);
      var node;
      if (r.parents > 1) {
        node = g.append("rect").attr("class", "git-svg-merge")
          .attr("x", cx - mergeR).attr("y", cy - mergeR)
          .attr("width", mergeR * 2).attr("height", mergeR * 2)
          .attr("transform", "rotate(45 " + cx + " " + cy + ")")
          .style("fill", "var(--color-accent-2-500)");
      } else {
        node = g.append("circle").attr("class", "git-svg-commit")
          .attr("cx", cx).attr("cy", cy).attr("r", nodeR)
          .style("fill", "var(--color-accent-600)");
      }
      node.append("title").text(r.hash + " · " + r.subject);

      // The inline label is laid out left→right: hash text, then one chip per decoration entry, then
      // the subject. Each text width is measured with getBBox().width (the same measure technique the
      // viewBox re-measure below uses), so chips hug their ref name and the subject starts clear of
      // the last chip by chipGap.
      var cursorX = textX;
      var hashTxt = g.append("text").attr("class", "git-svg-ink")
        .attr("x", cursorX).attr("y", cy + 4).attr("font-size", 11)
        .text(r.hash.slice(0, 7));
      cursorX += hashTxt.node().getBBox().width + chipGap;

      if (r.decorations && r.decorations.length) {
        r.decorations.forEach(function (dec) {
          decorationChips(dec).forEach(function (c) {
            var isHead = c === "HEAD";
            var ghost = isRemoteRef(c);
            var cls = "git-svg-decor-chip";
            if (isHead) { cls += " git-svg-decor-chip--head"; }
            if (ghost) { cls += " git-svg-decor-chip--ghost"; }
            var chip = g.append("g").attr("class", cls);
            // rect FIRST so the text paints on top; its x/width are filled after the text is measured.
            var bg = chip.append("rect").attr("class", "git-svg-decor-chip-bg")
              .attr("y", cy - chipH / 2).attr("height", chipH).attr("rx", chipRx)
              .style("fill", laneColor(r.col));
            if (isHead) {
              // HEAD highlight = a light keyline around the solid lane-colour chip (token-derived, so
              // AC102②'s "no hardcoded hex in the renderer" holds — --color-bg is the light canvas token).
              bg.style("stroke", "var(--color-bg)").style("stroke-width", 1.5);
            } else if (ghost) {
              // ghost = outline + translucent fill (the ref name reads on the light canvas); the fill
              // token is STILL the row's lane colour so AC3's "every chip bg = laneColor" holds.
              bg.style("fill-opacity", 0.22).style("stroke", laneColor(r.col)).style("stroke-width", 1);
            }
            var txt = chip.append("text").attr("class", "git-svg-decor-chip-text")
              .attr("font-size", decorFontSize).text(c)
              .style("fill", ghost ? laneColor(r.col) : "var(--color-bg)");
            var tw = txt.node().getBBox().width;
            var w = tw + chipPadX * 2;
            bg.attr("x", cursorX).attr("width", w);
            txt.attr("x", cursorX + chipPadX).attr("y", cy + 4);
            cursorX += w + chipGap;
          });
        });
      }

      g.append("text").attr("class", "git-svg-ink git-svg-subject")
        .attr("x", cursorX).attr("y", cy + 4).attr("font-size", 11)
        .text(r.subject);
    });

    // re-measure the real text and widen the viewBox to its true right edge (no clipped subject)
    var maxRight = textX;
    svg.selectAll("text").each(function () {
      var box = this.getBBox();
      var right = box.x + box.width;
      if (right > maxRight) { maxRight = right; }
    });
    var finalWidth = Math.max(width, Math.ceil(maxRight + 12));
    if (finalWidth !== width) {
      svg.attr("viewBox", "0 0 " + finalWidth + " " + height).attr("width", finalWidth);
    }
  }

  // ── scroll container sizing ────────────────────────────────────────────────────────────────
  // The header height is NOT constant (statusNote present/absent, line-wrap at different viewport
  // widths), so the panel's max-height is computed at runtime and re-computed on resize — never a
  // hardcoded CSS value (gap-git-graph-no-bounded-scroll-panel Plan step 3).
  function layoutScrollHeight() {
    if (!scrollEl) { return; }
    var top = scrollEl.getBoundingClientRect().top;
    var h = window.innerHeight - top - 24; // 24px breathing room above the page bottom
    if (h < 160) { h = 160; } // floor: very short / mobile viewports still get a usable panel
    scrollEl.style.maxHeight = h + "px";
  }

  // ── scroll loader: append OLDER commits below the current rows (newest-first axis) ──
  var sentinel = document.getElementById("git-graph-sentinel");
  var coverageEl = document.getElementById("git-graph-coverage");
  var loadingOlder = false;
  var olderDone = false;
  var autoLoadBudget = ${GIT_GRAPH_AUTO_LOAD_ROW_LIMIT};
  var autoLoadedRows = 0;
  var fuseTripped = false;
  var autoObserver = null;

  // Degrade the sentinel from an auto-load target to a manual 「加载更早提交」 button once the
  // auto-load fuse trips (or IntersectionObserver is unavailable). Clicking keeps loading until
  // finishOlder() — the manual path is deliberately NOT counted against the fuse.
  function tripFuse() {
    if (fuseTripped) { return; }
    fuseTripped = true;
    if (autoObserver) { autoObserver.disconnect(); autoObserver = null; }
    if (sentinel) {
      sentinel.textContent = "点击加载更早提交";
      sentinel.style.cursor = "pointer";
      sentinel.addEventListener("click", loadOlder);
    }
  }

  // ── bottom "more below" affordance (gap-git-graph-scroll-panel-no-visual-affordance) ──────────
  // #git-graph-more-hint is a sticky-bottom pill pinned to the container's VISIBLE bottom edge. It
  // stays visible while the container is not yet scrolled to its own bottom and hides once
  // scrollTop + clientHeight reaches scrollHeight — so a first-time visitor can tell at a glance
  // "this is a bounded sub-panel with more content below", not "the page ends here". This is the
  // DISCOVERABILITY half of gap-git-graph-no-bounded-scroll-panel (that task made the container
  // scrollable; this one makes that scrollability visible).
  var moreHint = document.getElementById("git-graph-more-hint");
  function updateScrollHint() {
    if (!scrollEl || !moreHint) { return; }
    var atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2;
    moreHint.style.display = atBottom ? "none" : "flex";
  }
  if (scrollEl) {
    layoutScrollHeight();
    if (moreHint && typeof scrollEl.addEventListener === "function") {
      scrollEl.addEventListener("scroll", updateScrollHint);
    }
    if (typeof window.addEventListener === "function") {
      window.addEventListener("resize", function () { layoutScrollHeight(); updateScrollHint(); });
    }
  }

  function coverageSpan() {
    var min = null, max = null;
    data.rows.forEach(function (r) {
      if (min === null || r.t < min) { min = r.t; }
      if (max === null || r.t > max) { max = r.t; }
    });
    if (min === null || max === null) { return null; }
    return max - min;
  }
  function formatSpan(sec) {
    if (sec >= 86400) { var d = sec / 86400; return (d >= 10 ? Math.round(d) : Math.round(d * 10) / 10) + " 天"; }
    var h = sec / 3600;
    return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + " 小时";
  }
  function updateCoverage() {
    if (!coverageEl) { return; }
    var s = coverageSpan();
    if (s === null) { return; }
    coverageEl.textContent = formatSpan(s);
  }
  function finishOlder() {
    olderDone = true;
    if (sentinel) { sentinel.textContent = "已加载到仓库最早提交"; }
  }
  function loadOlder() {
    if (loadingOlder || olderDone) { return; }
    var wm = null;
    data.rows.forEach(function (r) { if (wm === null || r.t < wm) { wm = r.t; } });
    if (wm === null) { finishOlder(); return; }
    loadingOlder = true;
    // skip is the authoritative emission-order cursor (git log --skip); before is the timestamp
    // watermark the self-chain cursor still walks back through (kept in the URL for cursor observability).
    fetch("/git-history.json?before=" + wm + "&limit=500&skip=" + data.rows.length)
      .then(function (res) {
        if (!res.ok) { finishOlder(); return; }
        return res.json().then(function (next) {
          if (!next || next.status !== "ok" || !next.rows || !next.rows.length) { finishOlder(); return; }
          var have = {};
          data.rows.forEach(function (r) { have[r.hash] = true; });
          var added = 0;
          next.rows.forEach(function (r) { if (!have[r.hash]) { data.rows.push(r); added++; } });
          if (added === 0) { finishOlder(); return; }
          recomputeLayout();
          updateCoverage();
          render();
          updateScrollHint();
          // Reset BEFORE chaining: the self-chain call below must see loadingOlder === false, or the
          // chain dead-stops after one page (gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag).
          loadingOlder = false;
          if (!fuseTripped) {
            autoLoadedRows += added;
            if (autoLoadedRows >= autoLoadBudget) { tripFuse(); }
          }
          if (!fuseTripped && sentinel && sentinel.getBoundingClientRect().top < window.innerHeight + 600) { loadOlder(); }
        });
      })
      .catch(function () { finishOlder(); });
  }
  if (sentinel) {
    if (typeof IntersectionObserver !== "undefined") {
      // root is the scroll CONTAINER, not the default viewport — "should we load more" must judge the
      // container's own bottom, not whether the whole document reached its bottom (gap-git-graph-no-
      // bounded-scroll-panel; the container now owns the vertical scroll the page used to carry).
      autoObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) { if (!fuseTripped && entries[i].isIntersecting) { loadOlder(); } }
      }, { root: scrollEl, rootMargin: "600px 0px" });
      autoObserver.observe(sentinel);
    } else {
      tripFuse();
    }
  }

  recomputeLayout();
  render();
  updateScrollHint();
})();`;
}

/** Mini-legend rendered in the graph corner (● commit / ◆ merge) — how to read the graph key.
 *  A full-width, OPAQUE bar sticky to the container's top (and left, for horizontal scroll): once the
 *  scroll container produces real vertical overflow (gap-git-graph-no-bounded-scroll-panel) the bar
 *  sticks at the top and the commit rows scroll cleanly under it — no narrow floating pill occluding
 *  the first visible row. The opaque `--color-surface` background adapts to dark mode via the CSS var. */
export function gitGraphLegendHtml(): string {
  const glyph = (colorVar: string, ch: string, label: string) =>
    `<span><span style="color:${colorVar}">${ch}</span> ${label}</span>`;
  const parts = [
    glyph("var(--color-accent-600)", "●", "commit"),
    glyph("var(--color-accent-2-500)", "◆", "merge"),
    glyph("var(--color-neutral-700)", "╰", "父提交连线（圆角正交）"),
  ];
  return `<div style="position:sticky;left:0;top:0;z-index:2;display:flex;gap:0.75rem;align-items:center;background:var(--color-surface);padding:0.35rem 0.6rem;border-bottom:1px solid var(--color-neutral-200);font-size:0.72rem;color:var(--color-neutral-700)">${parts.join("")}</div>`;
}

/**
 * Page-level width override for the git-history page (gap-git-graph-cross-column-edges-drawn-as-fixed-
 * stubs-not-anchored AC6/AC7). The shared base sheet caps every `<main>` at 900px (serve-render.ts
 * `main { max-width: 900px }`); the git graph's SVG is ~1288px wide, so the shared cap clips commit
 * text (44/500 rows at 1440px) and horizontal-scrolling the graph scrolls the column context away.
 * This is a PAGE-scoped override — the `#main` id selector (1,0,0) beats the bare `main` type selector
 * (0,0,1), and the style is emitted ONLY on this page's HTML — so the global 900px is untouched (AC7).
 * 1400px yields ~1368px content width at a 1440px viewport (≥ the measured SVG); `#git-graph-scroll`'s
 * own `overflow-x:auto` keeps narrower viewports scrollable rather than clipped (gap-git-graph-no-
 * bounded-scroll-panel moved the x/y overflow onto the new scroll container).
 */
export function gitHistoryPageStyle(): string {
  return html`<style>#main { max-width: 1400px; }</style>`;
}

/**
 * The view switch control rendered on BOTH views. `view` is the active view (its label is bold, not a
 * link); the other view is a link to `?view=<other>`. Default (git) and `?view=git` render this
 * identically, so AC5's byte-identity holds.
 */
export function gitHistoryViewToggle(view: GitGraphView): string {
  const git = view === "git"
    ? html`<strong>git 拓扑</strong>`
    : html`<a href="?view=git">git 拓扑</a>`;
  const task = view === "task"
    ? html`<strong>任务分组</strong>`
    : html`<a href="?view=task">任务分组</a>`;
  return html`<div class="meta" style="margin:0.5rem 0;font-size:0.8rem;color:var(--color-neutral-700)">视图切换：${git} · ${task}（默认 git 拓扑；任务分组是项目特定启发式）</div>`;
}

/**
 * Render the task view's body: one native `<details>` per task group (the summary links the task id to
 * its /task/<id> detail page and shows the commit count + first/last landing time; the body lists the
 * commits in git emission order), plus the explicit unattributed count. Zero client JS — the native
 * `<details>` element is the "点开一个任务分组" interaction, no custom renderer.
 */
function renderTaskGroupsHtml(history: GitHistoryResult): string {
  const layout = layoutTaskGraph(history);
  if (!layout) return "";
  const groupBlocks = layout.groups.map((g) => {
    const name = html`<a href="/task/${encodeURIComponent(g.id)}">${escapeHtml(g.id)}</a>`;
    const commitsHtml = g.commits.map((c) => html`<li><code>${escapeHtml(c.hash.slice(0, 7))}</code> ${escapeHtml(c.subject)}</li>`).join("\n");
    return html`<details class="task-group" style="margin:0.4rem 0">
      <summary style="cursor:pointer">${name} · ${g.commits.length} 条提交 · ${escapeHtml(isoTime(g.firstT))} ~ ${escapeHtml(isoTime(g.lastT))}</summary>
      <ul style="list-style:none;padding-left:1rem;margin:0.3rem 0">${commitsHtml}</ul>
    </details>`;
  }).join("\n");
  const unattributed = html`<details class="task-group" style="margin:0.4rem 0">
    <summary style="cursor:pointer"><span style="color:var(--color-neutral-500)">未归属（无 task id）</span> · ${layout.unattributedCount} 条</summary>
    <ul style="list-style:none;padding-left:1rem;margin:0.3rem 0">${history.commits.filter((c) => taskIdFromSubject(c.subject) === null).map((c) => html`<li><code>${escapeHtml(c.hash.slice(0, 7))}</code> ${escapeHtml(c.subject)}</li>`).join("\n")}</ul>
  </details>`;
  return html`<h2>任务分组（按 task id 聚合）</h2>
    <div class="task-groups">${groupBlocks}${unattributed}</div>`;
}

/**
 * Render the full /git-history HTML page. The git view's graph is CLIENT-rendered from the embedded
 * JSON via the inlined D3 library; the task view (`?view=task`) is a SERVER-rendered task-id grouping.
 * `view` selects the grouping: `"git"` (default — the git DAG topology) or `"task"` (gap-git-graph-
 * task-view-aggregate-commits-by-task-id). The default is byte-identical to `?view=git` (AC5).
 * Exported so the ACs can test the rendered HTML directly on a pure GitHistoryResult.
 * `remotes` (the workspace's `git remote` names) ride along in the embedded `#git-graph-data` payload so
 * the client can tell a remote-tracking ref from a slash-containing LOCAL branch (gap-git-graph-
 * decoration-labels-as-colored-chips AC1); defaults to [] for pure-history callers.
 */
export function renderGitHistoryPage(history: GitHistoryResult, view: GitGraphView = "git", remotes: string[] = []): string {
  if (view === "task") {
    const statusNote = history.status === "error"
      ? html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(history.reason || "")}</p>`
      : history.status === "empty"
        ? html`<p class="meta"><strong>无数据</strong> — ${escapeHtml(history.reason || "")}</p>`
        : "";
    const taskLayout = history.status === "ok" ? layoutTaskGraph(history) : null;
    const nCommits = history.commits.length;
    const mergeCount = history.commits.filter((c) => c.parents > 1).length;
    const unattributedCount = taskLayout ? taskLayout.unattributedCount : 0;
    const groupsHtml = renderTaskGroupsHtml(history);
    const guide = html`<p class="meta"><strong>任务分组 = 按 commit subject 里的 task id 聚合（项目特定启发式，非 git 语义）。</strong> 一组 = 一个任务从立案、晋升、实现到 fan-in 的完整轨迹；无法归属任何 task id 的提交计入「未归属」组（<strong>${unattributedCount}</strong> 条）。当前窗口：最近 ${nCommits} 条提交、${mergeCount} 个合并。默认视图仍是 git 拓扑，切换回来不会丢任何信息。</p>`;
    return html`<!doctype html>
      <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay git history — task-id grouping (project-specific heuristic)">${modernistStyles()}${pageStyles()}<title>Git history — 任务分组</title></head>
      <body>${renderMobileChrome("git", "git history")}${renderSiteNav("git")}<main id="main">
        <h1>Git History — 任务分组时间轴</h1>
        ${gitHistoryViewToggle(view)}
        ${guide}
        ${statusNote}
        ${groupsHtml}
      </main></body></html>`;
  }

  const statusNote = history.status === "error"
    ? html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(history.reason || "")}</p>`
    : history.status === "empty"
      ? html`<p class="meta"><strong>无数据</strong> — ${escapeHtml(history.reason || "")}</p>`
      : "";
  const layout = history.status === "ok" ? layoutGitGraph(history) : null;
  const nCommits = history.commits.length;
  const mergeCount = history.commits.filter((c) => c.parents > 1).length;
  const coverageSpan = layout ? coverageSpanSeconds(layout) : null;
  const coverageText = coverageSpan !== null ? formatCoverageSpan(coverageSpan) : "—";

  // The scroll container owns BOTH horizontal and vertical overflow (Plan step 6 — one container, not
  // nested x/y scroll layers). `#git-graph` loses its own overflow-x:auto; the sentinel moves INSIDE the
  // container so the IntersectionObserver can target it against the container's own scrollport (AC2).
  // max-height is a calc() FALLBACK so the page is usable before JS runs — the client script overwrites
  // it with a precise px value computed from the header's actual height on load + resize (Plan step 3).
  // The container ALSO carries a visible panel boundary (border + shadow + surface background) and a
  // sticky-bottom `#git-graph-more-hint` so the bounded sub-panel is DISCOVERABLE, not just functional
  // (gap-git-graph-scroll-panel-no-visual-affordance — the mechanism was already correct; the visual
  // affordance was missing, so the panel read as "the page ends here").
  const graph = layout
    ? html`<div id="git-graph-scroll" aria-label="Git 纵向时间轴（可滚动）" style="overflow-x:auto;overflow-y:auto;max-height:calc(100vh - 240px);border:1px solid var(--color-divider);border-radius:6px;background:var(--color-surface);box-shadow:var(--shadow-sm)"><div id="git-graph" aria-label="Git 纵向时间轴">${gitGraphLegendHtml()}</div><div id="git-graph-sentinel" class="meta" style="padding:0.6rem 0;color:var(--color-neutral-700);font-size:0.75rem">加载更早提交…</div><div id="git-graph-more-hint" aria-hidden="true" style="position:sticky;bottom:0;display:flex;justify-content:center;align-items:center;gap:0.35rem;padding:0.5rem 0.6rem 0.6rem;background:linear-gradient(to top,var(--color-surface) 55%,transparent);font-size:0.75rem;color:var(--color-neutral-700);pointer-events:none">↓ 更多提交</div></div>`
    : "";
  // The data JSON is embedded with `<` escaped to \u003c so a commit subject can never break out of
  // the <script> element. d3 + the client renderer are emitted only when there is a graph to draw.
  const graphData = layout ? { ...layout, remotes } : null;
  const dataScript = graphData ? html`<script type="application/json" id="git-graph-data">${JSON.stringify(graphData).replace(/</g, "\\u003c")}</script>` : "";
  const libScript = layout ? html`<script>${gitGraphLibJs()}</script>` : "";
  const clientScript = layout ? html`<script>${gitGraphClientScript()}</script>` : "";
  // Scoped --color-lane-N token sheet: the renderer references column colours as tokens, and this
  // sheet (emitted only when there is a graph) defines them on #git-graph — the hex lives once, here.
  const laneTokenStyle = layout ? html`<style>${gitGraphLaneTokenCss()}</style>` : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay git history — vertical commit timeline (client-rendered, git log --graph aligned)">${modernistStyles()}${pageStyles()}${gitHistoryPageStyle()}${laneTokenStyle}<title>Git history — vertical commit timeline</title></head>
    <body>${renderMobileChrome("git", "git history")}${renderSiteNav("git")}<main id="main">
      <h1>Git History — 提交纵向时间轴</h1>
      ${gitHistoryViewToggle(view)}
      <p class="meta"><strong>纵轴 = git 发射顺序（新的在上）。</strong> 每行一个提交；分支标签只在 ref 指向的那个提交上内联显示（git decorate 语义）。菱形 = 合并提交。当前窗口：最近 ${nCommits} 条提交、${mergeCount} 个合并（跨所有本地分支）；已加载窗口覆盖 <span id="git-graph-coverage">${escapeHtml(coverageText)}</span>。在图表容器内滚动到底部自动加载更早的提交（加载较多后改为点击加载）。</p>
      ${statusNote}
      ${graph}
      ${dataScript}
      ${libScript}
      ${clientScript}
    </main></body></html>`;
}

export async function handleGitHistory(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  url: URL,
): Promise<void> {
  let history: GitHistoryResult;
  try {
    history = readGitHistory(cfg.workspaceRoot);
  } catch (err) {
    history = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, commits: [], head: null, heads: {}, mainlineHead: null };
  }
  const remotes = readGitRemotes(cfg.workspaceRoot);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderGitHistoryPage(history, gitHistoryViewOf(url), remotes));
}

function writeJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/**
 * One RAW commit row — the /git-history.json pagination payload carries ONLY the raw commit data
 * (hash / t / subject / parents / parentHashes / decorations). The page-relative layout quantities
 * (`col`, `edges[].toRow`) are ABSENT here: a page computes them against its own row array, so
 * appending pages raw and re-laying-out client-side (gap-git-graph-pagination-appends-page-relative-
 * col-and-torow) is what keeps the graph correct once the window grows past the first page.
 */
export interface GitGraphRawRow {
  hash: string;
  t: number;
  subject: string;
  parents: number;
  parentHashes: string[];
  decorations: string[];
}

/** Strip the layout quantities off a history — the raw commit rows the pagination endpoint returns. */
export function gitGraphRawRows(history: GitHistoryResult): GitGraphRawRow[] {
  if (history.status !== "ok") return [];
  return history.commits.map((c) => ({
    hash: c.hash,
    t: c.t,
    subject: c.subject,
    parents: c.parents,
    parentHashes: c.parentHashes,
    decorations: c.decorations,
  }));
}

/** The JSON payload /git-history.json returns — RAW commit rows (the client re-renders them whole and
 *  recomputes the layout over the merged full sequence, appending OLDER rows on scroll) plus the
 *  window's oldest/newest commit times. The task view (`view="task"`) returns the task grouping
 *  instead: `groups` + the explicit `unattributedCount` (AC4) — the git view's payload carries neither
 *  field. gap-git-graph-pagination-appends-page-relative-col-and-torow: the git-view rows no longer
 *  carry `col` / `edges[].toRow` (page-relative layout quantities). */
export function gitHistoryJson(history: GitHistoryResult, view: GitGraphView = "git"): {
  status: GitHistoryResult["status"];
  reason: string | null;
  commitCount: number;
  oldestT: number | null;
  newestT: number | null;
  rows: GitGraphRawRow[];
  mergeCount: number;
  groups?: TaskGraphGroup[];
  unattributedCount?: number;
} {
  if (history.status !== "ok") {
    return { status: history.status, reason: history.reason, commitCount: 0, oldestT: null, newestT: null, rows: [], mergeCount: 0 };
  }
  let oldestT: number | null = null;
  let newestT: number | null = null;
  for (const c of history.commits) {
    if (oldestT === null || c.t < oldestT) oldestT = c.t;
    if (newestT === null || c.t > newestT) newestT = c.t;
  }
  if (view === "task") {
    const taskLayout = layoutTaskGraph(history);
    if (!taskLayout) {
      return { status: "empty", reason: history.reason ?? "git 仓库无提交记录", commitCount: 0, oldestT: null, newestT: null, rows: [], mergeCount: 0, groups: [], unattributedCount: 0 };
    }
    return {
      status: "ok",
      reason: null,
      commitCount: taskLayout.commitCount,
      oldestT,
      newestT,
      rows: [],
      mergeCount: 0,
      groups: taskLayout.groups,
      unattributedCount: taskLayout.unattributedCount,
    };
  }
  const layout = layoutGitGraph(history);
  if (!layout) {
    return { status: "empty", reason: history.reason ?? "git 仓库无提交记录", commitCount: 0, oldestT: null, newestT: null, rows: [], mergeCount: 0 };
  }
  return {
    status: "ok",
    reason: null,
    commitCount: layout.commitCount,
    oldestT,
    newestT,
    // Raw commits only — no col / edges[].toRow. The client recomputes the layout over the merged
    // full sequence (gap-git-graph-pagination-appends-page-relative-col-and-torow).
    rows: gitGraphRawRows(history),
    mergeCount: layout.mergeCount,
  };
}

/** GET /git-history.json?skip=<n>&limit=<m>[&before=<unixSeconds>] — the on-demand pagination endpoint
 *  the client's scroll loader calls. `skip` = the emission-order cursor (`git log --skip` — the page
 *  that continues `--all --topo-order` contiguously, so the client's merged full sequence is exactly
 *  `git log --all --topo-order -n <loaded>` and its recomputed columns match `git log --graph --all`);
 *  `before` is retained as a backward-compat timestamp watermark (the self-chain cursor still walks
 *  back through time), ignored when `skip` is present. The client appends the returned raw rows below
 *  the current ones and re-renders. */
export async function handleGitHistoryJson(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  url: URL,
): Promise<void> {
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, GIT_HISTORY_LIMIT * 10) : GIT_HISTORY_LIMIT;
  const skipRaw = Number.parseInt(url.searchParams.get("skip") ?? "", 10);
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? skipRaw : null;
  const beforeRaw = Number.parseInt(url.searchParams.get("before") ?? "", 10);
  const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;
  let history: GitHistoryResult;
  try {
    history = readGitHistory(cfg.workspaceRoot, { limit, before, skip });
  } catch (err) {
    history = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, commits: [], head: null, heads: {}, mainlineHead: null };
  }
  writeJson(res, 200, gitHistoryJson(history, gitHistoryViewOf(url)));
}

/** Parse the `?view=` selector into a view. `"task"` → task grouping; anything else (including the
 *  absent param) → the DEFAULT git topology (fail-closed to git — a heuristic never becomes the
 *  default truth, gap-git-graph-task-view-aggregate-commits-by-task-id AC5). */
export function gitHistoryViewOf(url: URL | undefined): GitGraphView {
  return url?.searchParams.get("view") === "task" ? "task" : "git";
}
