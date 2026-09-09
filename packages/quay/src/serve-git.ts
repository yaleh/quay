// serve-git.ts — /git-history route handler + git graph layout, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readGitHistory, type GitHistoryCommit, type GitHistoryResult, GIT_HISTORY_MAINLINE_REFS, GIT_HISTORY_LIMIT } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, pad2 } from "./serve-render.ts";

// gap-git-graph-omits-inflight-branches-and-summary-table-disjoint: groupCommitsByBranch (the old
// summary-table branch model, grouped by --source ref) is REMOVED — it and the graph's fork/merge
// lanes were two disjoint branch models (the table showed live refs, the graph showed merged
// branches; their name-set intersection was empty). The summary table now renders layout.branches
// (the SAME model the graph draws). It is not kept as an unused export: a dead function is drift.

/**
 * A `task/<id>` branch ref maps to task id `<id>` (the /task/<id> detail page already exists);
 * a non-task ref (develop / master / integration / verify/…) has no task id and stays plain text.
 * gap-git-history-clickable-branches-window: branch names on the chart + summary link out to the
 * task that produced them.
 */
export function taskIdFromBranchRef(ref: string | null): string | null {
  if (ref == null || !ref.startsWith("task/")) return null;
  const id = ref.slice("task/".length);
  return id.length > 0 ? id : null;
}

function isoTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}


export type GitGraphLaneKind = "mainline" | "live" | "reconstructed";

export interface GitGraphBranchLane {
  /** The lane's display name. `null` when no real branch name can be attributed (an UNNAMED lane —
   *  a ff dev-merge's second parent is the mainline's own old tip, so there is no branch to name,
   *  and `git log --graph` draws such side-lines without decoration). `unnamed` below is the explicit
   *  flag so a null ref is never confused with a failed read (硬规则 3b). */
  ref: string | null;
  /** Which partition produced this lane (gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge):
   *  `mainline` — the ref-partition primary (every mainline-reachable commit, drawn as the vertical
   *  spine); `live` — a still-checked-out branch's exclusive commits (`.ref` is a live `heads` ref);
   *  `reconstructed` — a no-ff merged + deleted branch whose second-parent chain is not attributable to
   *  any live/mainline ref (the historical-reconstruction fallback). `branches[0]` is always mainline. */
  kind: GitGraphLaneKind;
  /** True when `ref === null` — the lane carries no name (no chip, no 「窗口外分叉」 marker). The
   *  explicit flag keeps "unnamed" distinguishable from "a named lane whose ref read failed". */
  unnamed: boolean;
  /** Structural lane id (fork::merge hashes, or the first commit hash when fork is null). It is the
   *  `expanded` state key and the lane→x key — decoupled from `ref`, which can collapse to one string
   *  when several deleted task branches are all re-labelled to the mainline ref. */
  id: string;
  /** 0-based slot within the bounded graph track (interval-scheduled so a slot is reused once its
   *  lane merges back into the trunk). Clamped to [0, GIT_GRAPH_MAX_LANES-1] when the track overflows. */
  slot: number;
  /** x of this lane's vertical line within the track (derived from `slot`). */
  laneX: number;
  /** True when this lane needed a slot beyond GIT_GRAPH_MAX_LANES (narrowed to the track edge). */
  overflow: boolean;
  commits: Array<{ hash: string; t: number; parents: number; subject: string }>;
  /** Trunk commit hash the branch forked from (null = fork predates the active window). */
  fork: string | null;
  /** Trunk commit hash the branch merged back into (null = not yet merged within the window). */
  merge: string | null;
  /** Landing time of the merge commit (null when merge is null) — the collapsed summary row's anchor. */
  mergeT: number | null;
  /** True when this lane is an UNMERGED live ref (still checked out, never merged back into the
   *  trunk) — drawn as an open (dashed) lane ending at its newest commit, and rendered as 「在飞」
   *  in the summary table's status column. Merged lanes are `open: false` (`merge` non-null). */
  open: boolean;
  firstT: number;
  lastT: number;
  /** AC2: lateral branches are collapsed by default — the client shows count + span until expanded.
   *  The mainline lane is `collapsed: false` (it is always drawn as the expanded spine). */
  collapsed: boolean;
}

export interface GitGraphLayout {
  /** ALL lanes, mainline FIRST (`branches[0].kind === "mainline"`). The mainline lane holds every
   *  mainline-reachable commit; each other lane holds one branch's exclusive commits. There is no
   *  separate `trunk` field — the trunk IS the mainline lane (gap-git-graph-lane-path-inverts-and-
   *  duplicates-per-devmerge: trunk is not a special type, just the first lane). */
  branches: GitGraphBranchLane[];
  commitCount: number;
  mergeCount: number;
  /** Number of lanes that exceeded GIT_GRAPH_MAX_LANES (the client renders a "+N more" hint). */
  overflowCount: number;
}

/** The mainline lane — always `branches[0]` (the ref-partition primary, drawn as the vertical spine). */
export function mainlineLane(layout: GitGraphLayout): GitGraphBranchLane {
  return layout.branches[0];
}

// ── Graph-track geometry (gap-git-history-lane-identity-and-row-layout-overlap) ────────────────────
// The retired left/right lane counters are replaced by a BOUNDED graph track on the left + a single
// fixed text column on the right (the git log --graph / gitk / vscode-git-graph model). The client
// script inlines these values via interpolation, so there is ONE source of truth per constant.

/** x of the trunk vertical spine — the left anchor of the bounded graph track. */
export const GIT_GRAPH_TRUNK_X = 60;
/** x where ALL commit/summary text starts — one fixed column to the right of the track. Must clear
 *  the track's right edge (trunkX + MAX_LANES × LANE_GAP) so text never overlaps a lane line. */
export const GIT_GRAPH_TEXT_X = 260;
/** Horizontal spacing between adjacent lane slots within the track. */
export const GIT_GRAPH_LANE_GAP = 22;
/** Configurable max concurrent lane slots; beyond this lanes are narrowed + counted as "+N more". */
export const GIT_GRAPH_MAX_LANES = 8;
/** Vertical padding above the first row (the graph's top margin, row 0's y). */
export const GIT_GRAPH_PAD_Y = 24;
/** Fixed row height — one visible commit/summary per 26px band. */
export const GIT_GRAPH_ROW_H = 26;
/** gap-git-graph-lane-chip-rendered-once-regardless-of-span AC4: repeat a lane's name chip every this
 *  many rows so any scroll position lands within `strideRows × GIT_GRAPH_ROW_H` px of a chip
 *  (20 rows × 26px = 520px < a 700px conservative viewport height). */
export const GIT_GRAPH_CHIP_STRIDE_ROWS = 20;

// ── Lane colour encoding (gap-git-graph-lane-visual-encoding-and-fixed-width) ──────────────────────
// The retired single `.git-svg-grid` stroke (--color-neutral-200 / #eae7e7) measured 1.13:1 against the
// canvas (--color-neutral-100 / #f8f4f4) — invisible — and gave every branch the SAME colour, so the
// "which line is which branch" dimension had no visual channel at all. Lane identity is now encoded
// HUE-wise: one categorical colour per concurrent slot (0..GIT_GRAPH_MAX_LANES-1). The hex values live
// HERE, not in the CSS token sheet, because AC1 unit-tests each colour's WCAG contrast — a categorical
// palette is data, not a theme token (the "no hex" rule was for single-source theme tokens).

/** AC1: categorical lane palette — eight distinct HUES (not shades of one), each dark enough to hold
 *  ≥3:1 contrast against the light canvas (--color-neutral-100 / #f8f4f4) AND ≥4.5:1 against the white
 *  chip label drawn on top of it. Slot-indexed: the interval scheduler never gives two overlapping
 *  lanes the same slot, so two concurrent lanes always differ in hue. */
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

/** AC4: chip label colour drawn on top of a lane colour (reverse/inverse). White holds ≥4.5:1 on every
 *  palette entry (worst case 5.60:1). */
export const GIT_GRAPH_LANE_CHIP_TEXT = "#ffffff";

/** The canvas the graph draws on — mirrors `--color-neutral-100` in webui-modernist.css. Exported so
 *  the AC1/AC4 contrast tests compute against the SAME value the CSS renders (no second source). */
export const GIT_GRAPH_SURFACE_HEX = "#f8f4f4";

/**
 * A visible graph row (the client's per-render row model, mirrored here so the row-count/overlap
 * invariants are unit-testable without a browser). One row per VISIBLE item: trunk commits, expanded
 * branches' commits, and exactly one summary per collapsed branch — never the hidden commits of a
 * collapsed branch (gap-git-history-lane-identity-and-row-layout-overlap root cause 2).
 */
export interface GitGraphRowItem {
  kind: "commit" | "summary";
  hash: string | null;
  laneId: string | null;
  t: number;
  row: number;
}

/**
 * Compute the ordered visible rows for a given expansion state. Rows are (re)assigned from scratch
 * every call — a collapsed branch occupies ONE row regardless of how many commits it hides, and
 * expanding only substitutes that summary row with the branch's commits at their own landing times.
 * Mirrored verbatim by the client renderer's `visibleRows()` — keep the two in lock-step.
 */
export function computeGitGraphRows(layout: GitGraphLayout, expandedLaneIds: ReadonlySet<string>): GitGraphRowItem[] {
  type Raw = { kind: "commit" | "summary"; hash: string | null; laneId: string | null; t: number; tie: string };
  const items: Raw[] = [];
  for (const b of layout.branches) {
    if (b.kind === "mainline") {
      // The mainline lane is always expanded (its commits are the vertical spine, laneId null).
      for (const c of b.commits) items.push({ kind: "commit", hash: c.hash, laneId: null, t: c.t, tie: c.hash });
    } else if (expandedLaneIds.has(b.id)) {
      for (const c of b.commits) items.push({ kind: "commit", hash: c.hash, laneId: b.id, t: c.t, tie: c.hash });
    } else {
      items.push({ kind: "summary", hash: null, laneId: b.id, t: b.mergeT ?? b.lastT, tie: b.id });
    }
  }
  // gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge: a collapsed summary row's `t` equals
  // its own merge commit's `t` (both = b.mergeT), so the OLD tie-break (summary id vs merge hash,
  // lexicographic) could land the summary BELOW its merge row — inverting the lane (botY < topY) and
  // degenerating the rounded corner (r = max(0, vert/2) = 0). Pin the summary BEFORE any commit at the
  // same `t` (kind order: summary=0, commit=1), so a lane's top row is always above its merge row.
  const kindOrder = (k: "commit" | "summary") => (k === "summary" ? 0 : 1);
  items.sort((a, b) => a.t - b.t || (kindOrder(a.kind) - kindOrder(b.kind)) || (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0));
  return items.map((it, row) => ({ kind: it.kind, hash: it.hash, laneId: it.laneId, t: it.t, row }));
}

/**
 * gap-git-graph-lane-chip-rendered-once-regardless-of-span AC1/AC4 — pure: given visible rows (each
 * carrying `row` and its lane id, `null` = the mainline/trunk), return the rows that need a name chip
 * so any scroll position sits within `strideRows` of one. Within each lane's contiguous row span the
 * FIRST row always gets a chip and every `strideRows`-th row after it does too, until the span ends.
 * The mainline and every lateral lane share this ONE call path (no trunk-specific chip site).
 *
 * Written WITHOUT TypeScript annotations so it can be injected into the client renderer verbatim via
 * `computeChipStride.toString()` (single source of truth — the client runs the same function the test
 * imports). Its body carries no template literal, `${`, or `</script`, so it inlines safely.
 */
export function computeChipStride(items, strideRows) {
  const chips = [];
  const span = new Map();
  for (const it of items) {
    const id = it.laneId;
    const r = it.row;
    const s = span.get(id);
    if (s === undefined) { span.set(id, { min: r, max: r }); }
    else { if (r < s.min) s.min = r; if (r > s.max) s.max = r; }
  }
  for (const entry of span) {
    const laneId = entry[0];
    const s = entry[1];
    for (let r = s.min; r <= s.max; r += strideRows) chips.push({ laneId, row: r });
  }
  return chips;
}

/**
 * Build the SVG path `d` for one branch lane. This is the SERVER-side mirror of the client
 * renderer's `lanePath()` (keep the two in lock-step) — extracted so the fail-closed behaviour
 * is unit-testable without a browser. The four row arguments mirror the client call site:
 * `lanePath(laneX, forkRow, mergeRow, laneTop, laneBot)`, where `laneTop`/`laneBot` fall back to
 * the lane's first/last visible rows when there is no fork/merge.
 *
 * FAIL-CLOSED (gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge AC1): returns `null`
 * when `botY <= topY` — an inverted lane — instead of emitting a path that draws the line UPWARD
 * and degenerates its rounded corner to `Q x,y x,y` (the old `r = Math.max(0, vert/2)` collapses
 * to 0 for a non-positive `vert`). `null` is distinguishable from a legal path string, so a caller
 * skips the lane rather than silently drawing it upside down.
 */
export function buildLanePath(args: {
  laneX: number;
  forkRow: number | null;
  mergeRow: number | null;
  laneTopRow: number | null;
  laneBotRow: number | null;
  trunkX?: number;
  laneGap?: number;
  padY?: number;
  rowH?: number;
}): string | null {
  const trunkX = args.trunkX ?? GIT_GRAPH_TRUNK_X;
  const laneGap = args.laneGap ?? GIT_GRAPH_LANE_GAP;
  const padY = args.padY ?? GIT_GRAPH_PAD_Y;
  const rowH = args.rowH ?? GIT_GRAPH_ROW_H;
  const y = (row: number) => padY + row * rowH;
  const hasFork = args.forkRow != null;
  const hasMerge = args.mergeRow != null;
  const topY = hasFork ? y(args.forkRow as number) : y(args.laneTopRow as number);
  const botY = hasMerge ? y(args.mergeRow as number) : y(args.laneBotRow as number);
  if (botY <= topY) return null; // inverted lane — fail closed, never draw it
  const vert = botY - topY;
  let r = Math.min(6, laneGap / 2);
  if (vert < 2 * r) r = Math.max(0, vert / 2);
  if (hasFork && hasMerge) {
    return `M ${trunkX},${topY} H ${args.laneX - r} Q ${args.laneX},${topY} ${args.laneX},${topY + r} V ${botY - r} Q ${args.laneX},${botY} ${args.laneX - r},${botY} H ${trunkX}`;
  }
  if (hasFork) {
    return `M ${trunkX},${topY} H ${args.laneX - r} Q ${args.laneX},${topY} ${args.laneX},${topY + r} V ${botY}`;
  }
  if (hasMerge) {
    return `M ${args.laneX},${topY} V ${botY - r} Q ${args.laneX},${botY} ${args.laneX - r},${botY} H ${trunkX}`;
  }
  return `M ${args.laneX},${topY} V ${botY}`;
}

/**
 * A transparent hit rect: one per branch (lane), spanning the branch's INTERACTIVE row — the
 * summary row when collapsed, the top commit row (the fold control) when expanded. Its width covers
 * trunkX → the graph's right edge so the WHOLE row is clickable (gap-git-graph-fold-control-lands-
 * offscreen-and-row-hit-zone-dead: the old summary group only hit-tested the node circle + chip +
 * glyphs, leaving a ~450px dead zone in between).
 */
export interface GitGraphHitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the per-branch hit rects. `width` is the graph's right edge (the client's finalWidth);
 * the rect width is clamped to ≥ textX − trunkX, so the hit rect always spans from the trunk into
 * the text column (the minimum the dead-zone fix needs). `opts.includeHitRects === false` models
 * "render a version WITHOUT hit rects" — the AC3 negative control (the counter can take 0).
 */
export function computeGitGraphHitRects(
  layout: GitGraphLayout,
  expanded: ReadonlySet<string>,
  width: number,
  opts?: { includeHitRects?: boolean },
): GitGraphHitRect[] {
  if (opts?.includeHitRects === false) return [];
  const rows = computeGitGraphRows(layout, expanded);
  const topRowByLane = new Map<string, number>();
  for (const r of rows) {
    if (r.laneId === null) continue;
    if (!topRowByLane.has(r.laneId)) topRowByLane.set(r.laneId, r.row);
  }
  const rects: GitGraphHitRect[] = [];
  for (const b of layout.branches) {
    const row = topRowByLane.get(b.id);
    if (row === undefined) continue;
    rects.push({
      x: GIT_GRAPH_TRUNK_X,
      y: GIT_GRAPH_PAD_Y + row * GIT_GRAPH_ROW_H - GIT_GRAPH_ROW_H / 2,
      width: Math.max(width - GIT_GRAPH_TRUNK_X, GIT_GRAPH_TEXT_X - GIT_GRAPH_TRUNK_X),
      height: GIT_GRAPH_ROW_H - 2,
    });
  }
  return rects;
}

/**
 * Compute the vertical graph structure (gap-git-graph-ref-partition-collapses-all-topology-to-one-
 * lane). The ref-partition model this replaces folded EVERY develop-reachable commit into one mainline
 * lane — in this ff-fan-in repo that is ALL commits (fan-in is ff, so every landed task-branch commit
 * is develop-reachable), structurally yielding exactly ONE lane and losing the whole topology that
 * `git log --graph --all` shows (36 concurrent tracks). The fix restores the second-parent walk:
 *
 *   Mainline lane — the first-parent chain from HEAD (the vertical spine `git log --graph` draws as the
 *   `*` column), named develop/master (resolveTrunkRef). In ff-fan-in this chain IS the last landed
 *   task's own history, not a stable "trunk" — that is fine: the spine is a drawing choice, not a claim.
 *
 *   Lateral lanes — one per merge commit's second parent (the side-line `git log --graph` draws), walked
 *   along the second parent's first-parent chain until it meets the spine, a commit already claimed by a
 *   deeper lane (a branch-of-a-branch keeps only its exclusive commits — gap-git-graph-row-key-collides-
 *   on-multiclaimed-commits), or the window edge. A live branch whose tip is not reachable from the
 *   mainline (its exclusive commits keep their own `.ref`) becomes an OPEN lane.
 *
 * Naming is provability-tiered (fail-visible, never a wrong name): a lane whose tip is a live `heads`
 * ref → that ref name (`kind: 'live'`); otherwise the merge subject's QUOTED branch name — git quotes
 * only the merged branch, so `Merge branch 'develop' into task/X` names the second parent `develop` —
 * when that name is still a live ref (`kind: 'reconstructed'`); otherwise `#<short-hash>` unnamed.
 * PURE and deterministic on its input — tested on this output, before any SVG is drawn.
 */
export function layoutGitGraph(history: GitHistoryResult): GitGraphLayout | null {
  if (history.status !== "ok" || history.commits.length === 0) return null;
  const byHash = new Map(history.commits.map((c) => [c.hash, c]));
  const head = history.head ?? pickHead(history);
  const heads = history.heads ?? {};
  // The mainline lane's display name is the mainline ref (develop > master > HEAD branch), never the
  // HEAD branch name — the main checkout is usually on `author` (gap-git-graph-trunk-ref-resolves-to-
  // head-not-mainline). Merge-subject resolution is only the fallback when no mainline ref exists.
  const mainlineRef = resolveTrunkRef(heads, head) || (head ? branchNameOf(history, head) : "");
  // The spine is the MAINLINE ref's first-parent chain (the mainline batch is fetched from it), not
  // rev-parse HEAD — in a worktree HEAD is the task branch and lags the shared develop ref, so walking
  // from HEAD would drop commits that landed on develop after the branch point (gap-git-graph-ref-
  // partition-collapses-all-topology-to-one-lane: the spine must span the data actually fetched).
  const spineRoot = mainlineRef && heads[mainlineRef] !== undefined ? heads[mainlineRef] : head;

  const laneCommitOf = (c: GitHistoryCommit): { hash: string; t: number; parents: number; subject: string } => ({
    hash: c.hash,
    t: c.t,
    parents: c.parents,
    subject: c.subject,
  });

  const byT = (a: GitHistoryCommit, b: GitHistoryCommit) => a.t - b.t || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);

  // ── Mainline spine: the first-parent chain from the mainline ref's tip (the `*` column). Walk
  // newest → oldest, then reverse so the lane's commit array is canonical oldest → newest.
  const spineHashes: string[] = [];
  {
    let cur: string | null = spineRoot;
    const seen = new Set<string>();
    while (cur && byHash.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      spineHashes.push(cur);
      cur = byHash.get(cur)!.parentHashes[0] ?? null;
    }
  }
  spineHashes.reverse(); // oldest → newest
  const spineSet = new Set(spineHashes);
  const mainlineCommits = spineHashes.map((h) => byHash.get(h)!);

  // Lateral-lane extraction. `claimed` gives each commit to EXACTLY ONE lane: a branch forked from
  // another branch stops at the parent lane's already-claimed commit instead of re-claiming shared
  // history (gap-git-graph-row-key-collides-on-multiclaimed-commits).
  const claimed = new Set<string>();
  const usedIds = new Set<string>();
  const uniqueId = (base: string): string => {
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}#${n}`;
      n++;
    }
    usedIds.add(id);
    return id;
  };

  // Walk a lane's first-parent chain from `start`, collecting commits until the spine, a claimed
  // commit, the window edge (unknown parent), or a cycle. Returns the collected commits (newest →
  // oldest) and the fork (the spine commit reached, or null when the fork predates the window).
  const walkLane = (start: string): { commits: GitHistoryCommit[]; fork: string | null } => {
    const collected: GitHistoryCommit[] = [];
    let cur: string | null = start;
    let fork: string | null = null;
    const visited = new Set<string>();
    while (cur && byHash.has(cur) && !spineSet.has(cur) && !claimed.has(cur) && !visited.has(cur)) {
      visited.add(cur);
      const pc = byHash.get(cur)!;
      collected.push(pc);
      cur = pc.parentHashes[0] ?? null;
    }
    if (cur && spineSet.has(cur)) fork = cur;
    return { commits: collected, fork };
  };

  // Build a lateral lane from a walked chain (oldest→newest) + fork/merge metadata.
  const buildLateral = (
    ref: string | null,
    kind: GitGraphLaneKind,
    collected: GitHistoryCommit[],
    fork: string | null,
    merge: { hash: string; t: number } | null,
  ): GitGraphBranchLane => {
    collected.sort(byT);
    const laneCommits = collected.map(laneCommitOf);
    const ts = collected.map((c) => c.t);
    const tip = collected[collected.length - 1].hash;
    const id = uniqueId(fork != null ? `${fork}::${tip}` : `${collected[0].hash}::${kind}`);
    return {
      ref,
      kind,
      unnamed: ref == null,
      id,
      slot: 0,
      laneX: GIT_GRAPH_TRUNK_X + GIT_GRAPH_LANE_GAP,
      overflow: false,
      commits: laneCommits,
      fork,
      merge: merge?.hash ?? null,
      mergeT: merge?.t ?? null,
      open: merge == null,
      firstT: Math.min(...ts),
      lastT: Math.max(...ts),
      collapsed: true,
    };
  };

  const laterals: GitGraphBranchLane[] = [];

  // Merged second-parent lanes: for EVERY merge commit (oldest → newest so a deeper lane claims its
  // shared history first), walk each non-first parent into a lane.
  const merges = history.commits.filter((c) => c.parentHashes.length >= 2).sort(byT);
  const mainlineArtifacts = new Set<GitGraphBranchLane>();
  for (const merge of merges) {
    for (const p of merge.parentHashes.slice(1)) {
      const { commits, fork } = walkLane(p);
      if (commits.length === 0) continue;
      for (const c of commits) claimed.add(c.hash);
      const { ref, kind, mainlineArtifact } = secondParentLaneName(history, p);
      const lane = buildLateral(ref, kind, commits, fork, { hash: merge.hash, t: merge.t });
      if (mainlineArtifact) mainlineArtifacts.add(lane);
      laterals.push(lane);
    }
  }

  // Open live lanes: a live non-mainline ref whose tip is still on its OWN ref (not re-attributed to
  // the mainline) is genuinely unmerged (gap-git-graph-omits-inflight-branches-and-summary-table-
  // disjoint) — draw it open (merge: null, dashed).
  for (const [name, tip] of Object.entries(heads)) {
    if (GIT_HISTORY_MAINLINE_REFS.has(name)) continue;
    const tipCommit = byHash.get(tip);
    if (!tipCommit || tipCommit.ref !== name) continue; // re-attributed ⇒ already merged
    if (claimed.has(tip) || spineSet.has(tip)) continue;
    const { commits, fork } = walkLane(tip);
    if (commits.length === 0) continue;
    for (const c of commits) claimed.add(c.hash);
    laterals.push(buildLateral(name, "live", commits, fork, null));
  }

  // ── Fragment convergence (gap-git-graph-reconstructed-lanes-all-named-mainline-ref) ───────────────
  // The `claimed` walk breaks the mainline's OWN second-parent history into one lane per dev-merge —
  // 102 reconstructed lanes, 40 of them single-commit, all unnamed (a ff dev-merge's second parent IS
  // the mainline's old tip, so no branch name exists to recover). Those fragments are one continuous
  // first-parent chain: each lane's OLDEST commit's first parent is the TIP of the next-older lane.
  // Merge each MAINLINE-ARTIFACT lane into the mainline-artifact lane that claims that parent (oldest-
  // first, so the absorb target is already final) — the chain collapses into one lane per connected
  // region, eliminating the single-commit noise (AC5) without dropping any commit (AC4).
  // RESTRICTED to mainlineArtifact lanes: a genuinely-deleted branch that forked off another branch
  // (branch-of-a-branch) is ALSO unnamed but is NOT the mainline's own history — its exclusive commits
  // must stay their own lane (gap-git-graph-row-key-collides-on-multiclaimed-commits AC2).
  const laneByCommit = new Map<string, GitGraphBranchLane>();
  for (const b of laterals) for (const c of b.commits) laneByCommit.set(c.hash, b);
  const absorbOrder = laterals
    .filter((b) => mainlineArtifacts.has(b))
    .sort((a, b) => a.firstT - b.firstT);
  const absorbed = new Set<GitGraphBranchLane>();
  for (const b of absorbOrder) {
    if (absorbed.has(b)) continue;
    const oldest = byHash.get(b.commits[0].hash);
    const parent = oldest ? oldest.parentHashes[0] : null;
    if (parent == null) continue;
    const target = laneByCommit.get(parent);
    if (!target || target === b) continue;
    if (!mainlineArtifacts.has(target)) continue;
    // b (newer) continues target (older): extend target's chain with b's commits.
    target.commits = [...target.commits, ...b.commits].sort(byT);
    target.firstT = Math.min(target.firstT, b.firstT);
    target.lastT = Math.max(target.lastT, b.lastT);
    // The combined chain merges back at the NEWEST dev-merge (b's merge), not target's older one.
    if (b.mergeT != null) {
      target.merge = b.merge;
      target.mergeT = b.mergeT;
      target.open = false;
    }
    const newTip = target.commits[target.commits.length - 1].hash;
    target.id = uniqueId(target.fork != null ? `${target.fork}::${newTip}` : `${target.commits[0].hash}::${target.kind}`);
    for (const c of b.commits) laneByCommit.set(c.hash, target);
    absorbed.add(b);
  }
  if (absorbed.size > 0) {
    for (let i = laterals.length - 1; i >= 0; i--) {
      if (absorbed.has(laterals[i])) laterals.splice(i, 1);
    }
  }

  // The mainline lane is branches[0] — always the spine, always expanded, never forked/merged.
  const mainlineLaneObj: GitGraphBranchLane = {
    ref: mainlineRef || (mainlineCommits[0] ? mainlineCommits[0].ref : ""),
    kind: "mainline",
    unnamed: false,
    id: "__mainline__",
    slot: -1,
    laneX: GIT_GRAPH_TRUNK_X,
    overflow: false,
    commits: mainlineCommits.map(laneCommitOf),
    fork: null,
    merge: null,
    mergeT: null,
    open: false,
    firstT: mainlineCommits.length ? Math.min(...mainlineCommits.map((c) => c.t)) : 0,
    lastT: mainlineCommits.length ? Math.max(...mainlineCommits.map((c) => c.t)) : 0,
    collapsed: false,
  };

  // Lateral lanes sorted by fork time for a stable display order, mainline pinned FIRST.
  laterals.sort((a, b) => (a.fork != null ? byHash.get(a.fork)!.t : a.firstT) - (b.fork != null ? byHash.get(b.fork)!.t : b.firstT) || (a.ref == null ? "" : a.ref).localeCompare(b.ref == null ? "" : b.ref));
  const branches: GitGraphBranchLane[] = [mainlineLaneObj, ...laterals];

  // Interval-scheduled lane slots (lateral lanes only — the mainline is the spine at trunkX): sort by
  // fork time and greedily assign each the lowest free slot. A slot is freed once the lane occupying
  // it has merged (its merge time passes), so a later lane forking after that point REUSES the slot.
  // Lanes beyond GIT_GRAPH_MAX_LANES are narrowed onto the track edge and counted as overflow.
  let overflowCount = 0;
  const slotEndT: number[] = [];
  const byStartT = [...laterals].sort((a, b) => (a.fork != null ? byHash.get(a.fork)!.t : a.firstT) - (b.fork != null ? byHash.get(b.fork)!.t : b.firstT));
  for (const b of byStartT) {
    const startT = b.fork != null ? byHash.get(b.fork)!.t : b.firstT;
    const endT = b.mergeT ?? b.lastT;
    let slot = -1;
    for (let s = 0; s < GIT_GRAPH_MAX_LANES; s++) {
      if (slotEndT[s] === undefined || slotEndT[s] <= startT) {
        slot = s;
        break;
      }
    }
    if (slot === -1) {
      slot = GIT_GRAPH_MAX_LANES - 1;
      b.overflow = true;
      overflowCount++;
    }
    b.slot = slot;
    b.laneX = GIT_GRAPH_TRUNK_X + (slot + 1) * GIT_GRAPH_LANE_GAP;
    slotEndT[slot] = Math.max(slotEndT[slot] ?? 0, endT);
  }

  const mergeCount = history.commits.filter((c) => c.parents > 1).length;
  return { branches, commitCount: history.commits.length, mergeCount, overflowCount };
}

/** Fallback trunk root when HEAD is unresolvable: the newest commit in the window. */
function pickHead(history: GitHistoryResult): string | null {
  let best: GitHistoryCommit | null = null;
  for (const c of history.commits) if (!best || c.t > best.t) best = c;
  return best ? best.hash : null;
}

/** A resolved branch display name. `unresolved` distinguishes "no name could be determined" from a
 *  resolved name (硬规则 3b: a read that cannot parse its input must not return a value shaped like
 *  success). The display string for an unresolved tip is `unnamed@<short-hash>` — never a real ref
 *  (git forbids `@` in the `head`/`tag` lookup a real name would come from, and no task branch name
 *  contains it), so the renderer can tell the two apart and show it as plain, unlinkable text. */
export interface BranchNameResolution {
  name: string;
  /** true when no real branch name was determined (not in heads, no merge-subject match). */
  unresolved: boolean;
}

/** Parse the branch name git QUOTED in a merge subject — the SECOND parent's name (gap-git-graph-ref-
 *  partition-collapses-all-topology-to-one-lane). git's merge-message convention is `Merge branch 'A'
 *  into B`: the quoted 'A' is the branch being merged in (the merge commit's second parent), while the
 *  `into B` clause (unquoted) is the first parent. So `Merge branch 'develop' into task/X` names its
 *  second-parent lane `develop`, NOT `task/X` — the inverse of branchNameFromMergeSubject, which
 *  deliberately picks the non-mainline name. null when the subject has no merge-branch form. */
export function quotedBranchNameFromMergeSubject(subject: string): string | null {
  const quoted = [...String(subject).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return quoted[0] ?? null;
}

/** Name a second-parent lane by provability — fail-visible, never a wrong name. Three tiers:
 *  1. the tip IS a live `heads` ref → that ref name, `kind: 'live'`;
 *  2. the tip was merged in by a merge commit whose QUOTED branch name is a live NON-mainline ref →
 *     that name, `kind: 'reconstructed'` (the quoted name is the second parent, so its commits are its
 *     ancestors — AC3's `git merge-base --is-ancestor` oracle holds);
 *  3. neither → unnamed (`ref: null`, `unnamed: true`, `kind: 'reconstructed'`).
 *  gap-git-graph-reconstructed-lanes-all-named-mainline-ref: a ff dev-merge `Merge branch 'develop'
 *  into task/X` names its second parent `develop` — the mainline's OWN old tip, which is not a branch
 *  at all (git log --graph draws it as an undecorated side-line). Naming it `develop` collapses all
 *  reconstructed lanes to one name (113/113 → 100% 同名, zero information). A mainline ref is therefore
 *  NEVER used as a branch name: tier 2 requires the quoted name to be a live ref AND not a mainline ref,
 *  and tier 3 returns `ref: null` (a distinguishable "no name", 硬规则 3b — never a fabricated branch).
 *  `mainlineArtifact` distinguishes the TWO ways tier 3 is reached: true when the merge subject's quoted
 *  name IS a mainline ref (a ff dev-merge's mainline-history ghost — the fragment the convergence merges),
 *  false when there is no recoverable name at all (a genuinely deleted branch, e.g. branch-of-a-branch —
 *  its exclusive commits must stay their own lane). */
export function secondParentLaneName(history: GitHistoryResult, tipHash: string): { ref: string | null; kind: "live" | "reconstructed"; unnamed: boolean; mainlineArtifact: boolean } {
  const heads = history.heads ?? {};
  for (const [name, tip] of Object.entries(heads)) {
    if (tip === tipHash) return { ref: name, kind: "live", unnamed: false, mainlineArtifact: false };
  }
  for (const c of history.commits) {
    if (c.parentHashes.length >= 2 && c.parentHashes.slice(1).includes(tipHash)) {
      const quoted = quotedBranchNameFromMergeSubject(c.subject);
      if (quoted && !GIT_HISTORY_MAINLINE_REFS.has(quoted) && heads[quoted] !== undefined) {
        return { ref: quoted, kind: "reconstructed", unnamed: false, mainlineArtifact: false };
      }
      if (quoted && GIT_HISTORY_MAINLINE_REFS.has(quoted)) {
        return { ref: null, kind: "reconstructed", unnamed: true, mainlineArtifact: true };
      }
    }
  }
  return { ref: null, kind: "reconstructed", unnamed: true, mainlineArtifact: false };
}

/** Parse the branch name out of a fan-in / dev-merge commit subject. Both conventions name the task
 *  branch as one of the two quoted refs and the mainline as the other:
 *    `Merge branch 'develop' into task/<id>`  (step-1 dev-merge, ff-carried onto develop)
 *    `Merge branch 'task/<id>' into develop`  (a --no-ff fan-in merge)
 *  A `task/<id>` name is preferred (it links to the task page); otherwise the first non-mainline
 *  quoted name (author / doc/… / worktree-…). null when the subject has no merge-branch form or only
 *  names mainline refs. */
export function branchNameFromMergeSubject(subject: string): string | null {
  const s = String(subject);
  // git quotes ONLY the merged branch (`'X'`); the `into <target>` clause is UNQUOTED. Both conventions
  // put the task branch in one slot and the mainline in the other, so collect both slots and pick the
  // non-mainline name (task/<id> preferred for the task-page link).
  const quoted = [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const into = s.match(/\binto\s+([^\s]+)/)?.[1] ?? null;
  const names = [...quoted, ...(into ? [into] : [])];
  const task = names.find((n) => n.startsWith("task/"));
  if (task) return task;
  const nonMainline = names.find((n) => !GIT_HISTORY_MAINLINE_REFS.has(n));
  return nonMainline ?? null;
}

/** Resolve a tip commit's branch display name. The three sources, in order:
 *  1. a live branch whose tip IS `hash` (`heads` — but fan-in deletes the task branch, so this only
 *     helps branches still checked out);
 *  2. `hash`'s own subject, when `hash` is itself a dev-merge (`Merge branch 'develop' into task/<id>`
 *     — the ff-fan-in shape: that merge commit IS the branch's last commit, and after the mainline
 *     re-attribution its `--source` ref is `develop`, so the subject is the only real name left);
 *  3. the fan-in merge that merged `hash` in (`hash` is one of its non-first parents) — its subject
 *     names the branch being merged, which survives `git branch -d`.
 *  A tip that resolves from none of these is `unresolved` — never silently relabelled to the mainline
 *  ref (the old `:254` fallback returned `develop` for an unreadable tip, indistinguishable from a
 *  lane genuinely named develop). */
export function resolveBranchName(history: GitHistoryResult, hash: string): BranchNameResolution {
  for (const [name, tip] of Object.entries(history.heads ?? {})) {
    if (tip === hash) return { name, unresolved: false };
  }
  const tip = history.commits.find((c) => c.hash === hash);
  const own = tip ? branchNameFromMergeSubject(tip.subject) : null;
  if (own) return { name: own, unresolved: false };
  for (const c of history.commits) {
    if (c.parentHashes.length >= 2 && c.parentHashes.slice(1).includes(hash)) {
      const name = branchNameFromMergeSubject(c.subject);
      if (name) return { name, unresolved: false };
    }
  }
  return { name: `unnamed@${hash.slice(0, 7)}`, unresolved: true };
}

/** Branch name for a tip commit (the display string the graph renders). */
function branchNameOf(history: GitHistoryResult, hash: string): string {
  return resolveBranchName(history, hash).name;
}

/**
 * Resolve the vertical trunk's display name with SEMANTIC mainline priority
 * (gap-git-graph-trunk-ref-resolves-to-head-not-mainline): `develop > master > the HEAD branch
 * name`. The mainline priority matters because this repo's main checkout is usually on `author`,
 * and `author` often points at the same commit as `develop` — taking the HEAD branch name then
 * names the trunk `author`, contradicting the summary table + guide prose that both say `develop`
 * (three contradictory口径 on one page). develop/master are checked for PRESENCE (not tip
 * equality): a mainline ref names the trunk line even when HEAD has temporarily diverged past it.
 *
 * Returns "" only when no mainline ref exists AND no head matches a tip — the caller then falls
 * back to merge-subject resolution (branchNameOf), preserving the pre-existing behaviour for a
 * repo with neither develop nor master. Pure and directly importable (no git, no I/O).
 */
export function resolveTrunkRef(heads: Record<string, string>, head: string | null): string {
  if (heads["develop"] !== undefined) return "develop";
  if (heads["master"] !== undefined) return "master";
  if (head !== null) {
    for (const [name, tip] of Object.entries(heads)) {
      if (tip === head) return name;
    }
  }
  return "";
}

// ── D3 inlining (the third-party library the retired 「零客户端 JS」 invariant now permits) ──
// d3.min.js is inlined the SAME way as the Modernist CSS (webui-modernist.css): the dist bundle
// carries it on globalThis.__WEBUI_D3_JS__ (build-dist.mjs), and the dev tree reads it from
// node_modules. d3.min.js is a trusted, audited vendor asset that contains no "</script" sequence,
// so inlining it verbatim into a <script> element is safe.

const __webuiD3Global = globalThis as unknown as { __WEBUI_D3_JS__?: string };

/** Resolve d3.min.js's path by walking up from this module (dev-tree fallback; the dist bundle uses
 *  the inlined globalThis.__WEBUI_D3_JS__ and never reaches here). No `createRequire` — the dist
 *  banner already imports it, and a second import would be a duplicate-identifier SyntaxError. */
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

/** True when a code point renders at full glyph width (~1em): CJK ideographs, kana, hangul, CJK
 *  punctuation and full-width forms. Everything else is treated as a proportional Latin glyph. */
function isFullWidthChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals + punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana/Katakana + CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xff00 && cp <= 0xffef)    // full-width forms
  );
}

/** Estimated rendered width of a string at a given px font-size. Full-width glyphs count ~1em;
 *  proportional Latin glyphs ~0.62em (system-ui average). This is the server-side FLOOR the client
 *  seeds the viewBox with — the client then re-measures the real text with getBBox and widens if
 *  needed, so an estimate error can never re-introduce clipping (AC5). */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    w += isFullWidthChar(cp) ? fontSize : fontSize * 0.62;
  }
  return w;
}

/** AC5: content-derived SVG width — textX + the longest drawn label's estimated width + right padding.
 *  Never a literal constant: two layouts whose longest subject differs in rendered width yield
 *  DIFFERENT widths, so the viewBox always tracks content (硬规则 4 推论二: a literal that happens to
 *  match today's data becomes a silent hard limit on the next batch). */
export function computeGitGraphWidth(layout: GitGraphLayout, textX: number): number {
  const pad = 24;
  let longest = 0;
  const consider = (text: string, size: number) => {
    const w = estimateTextWidth(text, size);
    if (w > longest) longest = w;
  };
  for (const b of layout.branches) {
    const size = b.kind === "mainline" ? 11 : 10;
    for (const c of b.commits) consider(`${c.hash.slice(0, 7)} ${c.subject}`, size);
    if (b.kind !== "mainline" && b.ref != null) consider(`${b.ref} · ${b.commits.length} commits ·（点击展开）`, 11);
  }
  return Math.ceil(textX + longest + pad);
}

/** gap-git-graph-drops-commits-while-overflowcount-reports-zero AC5: the coverage duration is the
 *  actual time span of the MAINLINE window (branches[0].commits: newest − oldest commit time), never
 *  a hardcoded constant. It is mainline-scoped BY DESIGN: the pagination pages MAINLINE commits only
 *  (lateral live branches are fetched in full on every page, so their span — up to the 7-day active
 *  window — is fixed and must not define the "how far back can I see" number). As the mainline window
 *  grows via scroll-loading, this span only ever grows. Pure and directly importable (no I/O). */
export function coverageSpanSeconds(layout: GitGraphLayout): number | null {
  const mainline = layout.branches[0];
  if (!mainline || mainline.commits.length === 0) return null;
  let min: number | null = null;
  let max: number | null = null;
  for (const c of mainline.commits) {
    if (min === null || c.t < min) min = c.t;
    if (max === null || c.t > max) max = c.t;
  }
  if (min === null || max === null) return null;
  return max - min;
}

/** Format a coverage span (seconds) as "N 小时" / "N 天" — the guide prose's 「当前已加载窗口覆盖
 *  N 小时/天」. Mirrored VERBATIM by the client loader (gitGraphClientScript's formatSpan) — keep the
 *  two in lock-step (same drift discipline as the lanePath / visibleRows mirrors). */
export function formatCoverageSpan(sec: number): string {
  if (sec >= 86400) {
    const d = sec / 86400;
    return `${d >= 10 ? Math.round(d) : Math.round(d * 10) / 10} 天`;
  }
  const h = sec / 3600;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} 小时`;
}

/** AC102②: the client renderer references lane colours as `var(--color-lane-N)` TOKENS, never hex.
 *  The palette's hex values stay HERE (AC1/AC4 unit-test their WCAG contrast), and are emitted as a
 *  scoped token sheet by gitGraphLaneTokenCss() — one source of truth, no second copy to drift. */
export function gitGraphLaneTokenCss(): string {
  const laneDefs = GIT_GRAPH_LANE_PALETTE.map((hex, i) => `--color-lane-${i}:${hex};`).join("");
  return `#git-graph{${laneDefs}--color-lane-chip-text:${GIT_GRAPH_LANE_CHIP_TEXT};}`;
}

/** The client-side D3 renderer. Collapse/expand is toggled client-side; branches start COLLAPSED
 *  (AC2). The generated JS carries no template literal, `${`, or `</script` so it inlines verbatim —
 *  geometry constants are interpolated SERVER-side as plain numbers, and lane colours are referenced
 *  as `var(--color-lane-N)` tokens (AC102②: the renderer script carries ZERO hardcoded hex). */
export function gitGraphClientScript(): string {
  return `(function () {
  var mount = document.getElementById("git-graph");
  var dataEl = document.getElementById("git-graph-data");
  if (!mount || !dataEl || typeof d3 === "undefined") { return; }
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data || !data.branches || !data.branches.length) { return; }

  var rowH = ${GIT_GRAPH_ROW_H}, trunkX = ${GIT_GRAPH_TRUNK_X}, textX = ${GIT_GRAPH_TEXT_X}, laneGap = ${GIT_GRAPH_LANE_GAP}, maxLanes = ${GIT_GRAPH_MAX_LANES}, nodeR = 4, mergeR = 5, padY = ${GIT_GRAPH_PAD_Y}, strideRows = ${GIT_GRAPH_CHIP_STRIDE_ROWS};
  var lanePalette = ${JSON.stringify(GIT_GRAPH_LANE_PALETTE.map((_, i) => `var(--color-lane-${i})`))};
  var chipText = "var(--color-lane-chip-text)";
  var allBranches = data.branches || [];
  var mainline = allBranches[0];
  var branches = allBranches.filter(function (b) { return b.kind !== "mainline"; });
  var overflow = typeof data.overflowCount === "number" ? data.overflowCount : 0;

  // gap-git-graph-lane-chip-rendered-once-regardless-of-span: the SAME computeChipStride the test
  // imports (injected verbatim via .toString()) — one source of truth, no hand-mirrored copy to drift.
  ${computeChipStride.toString()}

  // gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead: 移动端「适应宽度」开关 — 只显
  // chip + 提交数（隐藏 subject），把内容宽度压回视口内（scrollWidth <= clientWidth * 1.2）。
  var fitWidthEl = document.getElementById("git-graph-fit-width");
  var fitWidth = !!(fitWidthEl && fitWidthEl.checked);
  if (fitWidthEl) {
    fitWidthEl.addEventListener("change", function () { fitWidth = fitWidthEl.checked; render(); });
  }

  function y(row) { return padY + row * rowH; }

  // AC1/AC2: one categorical hue per LANE (cycled by lane index), NOT per slot. Slot reuse (interval
  // scheduling) must NOT recycle a hue onto a DIFFERENT lane — colouring by slot would collapse the
  // distinct-colour count to the number of concurrent slots (4 on the live repo, <6), failing AC2's
  // ≥min(6, lane-count). Per-lane cycling yields min(paletteSize, laneCount) distinct hues (8 ≥ 6).
  var laneColorById = {};
  branches.forEach(function (b, i) { laneColorById[b.id] = lanePalette[i % lanePalette.length]; });

  function spanText(b) {
    var s = b.lastT - b.firstT;
    if (s <= 0) { return "0m"; }
    if (s >= 86400) { return Math.round(s / 86400) + "d"; }
    if (s >= 3600) { return Math.round(s / 3600) + "h"; }
    return Math.round(s / 60) + "m";
  }

  // AC3: a branch lane's fork/merge connectors are ONE rounded-corner <path>, not three independent
  // straight <line>s. Rounded turns (radius min(6, laneGap/2), clamped to the vertical run) make a
  // merge visually distinct from two unrelated lines crossing at a right angle.
  function lanePath(laneX, forkRow, mergeRow, laneTopRow, laneBotRow) {
    var hasFork = forkRow != null;
    var hasMerge = mergeRow != null;
    var topY = hasFork ? y(forkRow) : y(laneTopRow);
    var botY = hasMerge ? y(mergeRow) : y(laneBotRow);
    // gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge: fail-closed — an inverted lane
    // (summary row sorted below its own merge row) must not draw a line upward. Return null so the
    // caller skips it instead of emitting a degenerate Q x,y x,y corner (r = max(0, vert/2) = 0).
    if (botY <= topY) { return null; }
    var vert = botY - topY;
    var r = Math.min(6, laneGap / 2);
    if (vert < 2 * r) { r = Math.max(0, vert / 2); }
    if (hasFork && hasMerge) {
      return "M " + trunkX + "," + topY +
        " H " + (laneX - r) +
        " Q " + laneX + "," + topY + " " + laneX + "," + (topY + r) +
        " V " + (botY - r) +
        " Q " + laneX + "," + botY + " " + (laneX - r) + "," + botY +
        " H " + trunkX;
    }
    if (hasFork) {
      return "M " + trunkX + "," + topY +
        " H " + (laneX - r) +
        " Q " + laneX + "," + topY + " " + laneX + "," + (topY + r) +
        " V " + botY;
    }
    if (hasMerge) {
      return "M " + laneX + "," + topY +
        " V " + (botY - r) +
        " Q " + laneX + "," + botY + " " + (laneX - r) + "," + botY +
        " H " + trunkX;
    }
    return "M " + laneX + "," + topY + " V " + botY;
  }

  // AC4: append a branch-name chip (lane-colour pill + high-contrast label) at (x, y = text baseline).
  // Returns the pill width so the caller can place trailing text right after it.
  function appendChip(parent, x, y, ref, color) {
    var chip = parent.append("g").attr("class", "git-svg-lane-chip");
    var label = chip.append("text")
      .attr("x", x + 6).attr("y", y).attr("font-size", 10)
      .style("fill", chipText).text(ref);
    var box = label.node().getBBox();
    chip.insert("rect", ":first-child")
      .attr("x", x).attr("y", y - 9)
      .attr("width", box.width + 12).attr("height", 15)
      .attr("rx", 4).attr("ry", 4)
      .style("fill", color);
    return box.width + 12;
  }

  // Expand state keys on the STRUCTURAL lane id (fork::merge), never the display ref string — two
  // lanes whose deleted merge-tip was re-labelled to the same name toggle independently.
  var expanded = {};
  branches.forEach(function (b) { if (b.collapsed !== true) { expanded[b.id] = true; } });

  // Row model (mirrors computeGitGraphRows): rows are reassigned from the CURRENTLY VISIBLE items on
  // every render — trunk commits + expanded branches' commits + ONE summary row per collapsed branch.
  // A collapsed branch occupies exactly one row no matter how many commits it hides, so a lane can
  // never reallocate rows that other lanes already use when it expands.
  function visibleRows() {
    var items = [];
    mainline.commits.forEach(function (c) { items.push({ kind: "commit", laneId: null, commit: c, x: trunkX, t: c.t, tie: c.hash }); });
    branches.forEach(function (b) {
      if (expanded[b.id] === true) {
        b.commits.forEach(function (c) { items.push({ kind: "commit", laneId: b.id, commit: c, x: b.laneX, t: c.t, tie: c.hash }); });
      } else {
        items.push({ kind: "summary", laneId: b.id, branch: b, x: b.laneX, t: b.mergeT != null ? b.mergeT : b.lastT, tie: b.id });
      }
    });
    items.sort(function (a, b) {
      if (a.t !== b.t) { return a.t - b.t; }
      // gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge: pin a summary row BEFORE any
      // commit at the same t (the summary's t == its own merge commit's t), so a collapsed lane's
      // top row is always above its merge row (no inverted lane, no degenerate Q x,y x,y corner).
      if (a.kind !== b.kind) { return a.kind === "summary" ? -1 : 1; }
      return a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0;
    });
    // Row is an INTRINSIC attribute of each item (its sorted index), never a hash/laneId-keyed
    // lookup — a bare-hash key collapses two distinct items onto one y when a commit is claimed by
    // two lanes (the overlap + blank-row root cause, made structurally impossible here).
    items.forEach(function (it, i) { it.row = i; });
    return items;
  }

  function render() {
    var items = visibleRows();
    var svg = d3.select(mount).select("svg");
    if (svg.empty()) {
      svg = d3.select(mount).append("svg").attr("class", "git-svg-surface").attr("role", "img")
        .attr("aria-label", "Git commit vertical timeline: trunk + branch fork/merge lanes");
    }
    svg.selectAll("*").remove();
    // AC5: width is CONTENT-derived — the server seeds the longest-label estimate (data.textWidth),
    // and a getBBox re-measure below widens the viewBox to the true text right edge, so no subject is
    // ever clipped by a literal width (硬规则 4 推论二: the old textX+460 = 720px clipped 37/98
    // subjects with no scrollbar to reach them).
    var width = fitWidth ? textX : (typeof data.textWidth === "number" ? data.textWidth : textX + 460);
    var height = y(items.length - 1) + padY;
    // gap-webui-git-history-svg-unreadable: draw the viewBox at its NATIVE width/height (1:1) so the
    // text stays readable — the old width=100% + max-height:75vh + default preserveAspectRatio meet
    // squashed a tall viewBox (924x15570) to ~91px wide (meet scales to the shortest edge). The
    // #git-graph container scrolls horizontally when the native width exceeds the viewport.
    svg.attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width).attr("height", height)
      .attr("style", "border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif");
    var g = svg.append("g");

    // Trunk row lookup — trunk commit hashes are unique by construction, so this map never collapses.
    var trunkRow = {};
    items.forEach(function (it) { if (it.kind === "commit" && it.laneId === null) { trunkRow[it.commit.hash] = it.row; } });

    // trunk vertical spine (a visible dark neutral — the old grid neutral-200 measured 1.13:1)
    var trunkRows = mainline.commits.map(function (c) { return trunkRow[c.hash]; });
    var tMin = Math.min.apply(null, trunkRows);
    var tMax = Math.max.apply(null, trunkRows);
    g.append("line").attr("class", "git-svg-trunk")
      .attr("x1", trunkX).attr("x2", trunkX).attr("y1", y(tMin)).attr("y2", y(tMax));

    // Per-lane first/last rows, derived from the items themselves (never a lossy key lookup).
    var laneTopRow = {}, laneBotRow = {};
    items.forEach(function (it) {
      if (it.laneId === null) { return; }
      if (laneTopRow[it.laneId] === undefined) { laneTopRow[it.laneId] = it.row; }
      laneTopRow[it.laneId] = Math.min(laneTopRow[it.laneId], it.row);
      if (laneBotRow[it.laneId] === undefined) { laneBotRow[it.laneId] = it.row; }
      laneBotRow[it.laneId] = Math.max(laneBotRow[it.laneId], it.row);
    });

    // gap-git-graph-lane-chip-rendered-once-regardless-of-span AC1/AC4: every lane whose commits are
    // VISIBLE (the mainline + expanded lateral lanes) repeats its name chip every strideRows rows
    // through its row span — ONE call path via computeChipStride, no trunk-specific chip site. The
    // FIRST row of an expanded lateral lane is skipped here: the fold control below draws that lane's
    // own chip (inside its clickable group, so the whole chip + "▲ 折叠" affordance toggles the lane),
    // keeping the fold row labelled exactly once at the same y as before. A collapsed lane's summary
    // row already leads with its own chip (once per lane, span = 1 row), so summary items are excluded
    // here. The mainline chip also labels the spine with its resolved ref
    // (gap-git-graph-trunk-ref-resolves-to-head-not-mainline): develop/master, so graph, summary table
    // and guide prose all name the same ref.
    var chipRefColor = {};
    chipRefColor[null] = { ref: mainline.ref, color: "var(--color-neutral-700)" };
    // gap-git-graph-reconstructed-lanes-all-named-mainline-ref: an unnamed lane (ref == null — a ff
    // dev-merge's mainline-history second parent, which has no branch name to recover) gets NO chip,
    // mirroring git log --graph's undecorated side-lines. Store null so the stride loop skips it.
    branches.forEach(function (b) { chipRefColor[b.id] = b.ref != null ? { ref: b.ref, color: laneColorById[b.id] } : null; });
    computeChipStride(items.filter(function (it) { return it.kind === "commit"; }), strideRows)
      .forEach(function (cr) {
        // The fold control owns its lane's first chip row — skip it here so the fold row is labelled
        // exactly once, by the clickable fold group below.
        if (cr.laneId !== null && expanded[cr.laneId] === true && cr.row === laneTopRow[cr.laneId]) { return; }
        var info = chipRefColor[cr.laneId];
        if (info != null) { appendChip(g, textX, y(cr.row) - 6, info.ref, info.color); }
      });

    // branch lanes: ONE rounded-corner <path> per lane, hue-coded per lane (AC1/AC2/AC3). Nodes + text
    // are drawn from the items below, so every element paints at its OWN row — two elements can never
    // share a y.
    branches.forEach(function (b) {
      var laneX = b.laneX;
      var color = laneColorById[b.id];
      var forkRow = b.fork ? trunkRow[b.fork] : null;
      var mergeRow = b.merge ? trunkRow[b.merge] : null;
      var laneTop = forkRow != null ? forkRow : laneTopRow[b.id];
      var laneBot = mergeRow != null ? mergeRow : laneBotRow[b.id];

      var d = lanePath(laneX, forkRow, mergeRow, laneTop, laneBot);
      // gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge: fail-closed — skip the lane
      // when lanePath returned null (an inverted lane) instead of drawing it upside down.
      if (d !== null) {
        g.append("path").attr("class", "git-svg-lane")
          .attr("d", d)
          .attr("fill", "none").style("stroke", color).attr("stroke-width", 1.6)
          // gap-git-graph-omits-inflight-branches-and-summary-table-disjoint: an OPEN lane (unmerged
          // live ref) is drawn dashed so it reads at a glance as still-in-flight, distinct from a
          // merged lane's solid line (null removes the attribute → the SVG solid default).
          .attr("stroke-dasharray", b.open ? "6,4" : null);
      }

      // gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge AC5: a lane whose fork predates
      // the window (fork == null) gets an explicit "窗口外分叉" marker at its top, so a dangling top
      // reads as "fork outside the window", not a broken/disconnected line.
      // gap-git-graph-reconstructed-lanes-all-named-mainline-ref: the marker is drawn ONLY for a NAMED
      // lane (ref != null) — an unnamed lane is mainline-history structure with no recoverable branch,
      // so a marker would be noise (marker count stays ≤ named-reconstructed count, AC5).
      if (b.fork == null && b.ref != null) {
        g.append("text").attr("class", "git-svg-fork-dangling")
          .attr("x", laneX).attr("y", y(laneTop) - 5).attr("font-size", 9)
          .attr("text-anchor", "middle")
          .style("fill", "var(--color-neutral-600)")
          .text("窗口外分叉");
      }

      if (expanded[b.id] === true) {
        // gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead: the fold control is a
        // chip(ref) + "▲ 折叠" drawn on the branch's TOP row (first own commit, laneTopRow[b.id]) —
        // NOT the bottom merge row (laneBot), which landed off-screen after expanding a tall branch
        // AND sat on the trunk merge text. The chip is the lane's FIRST chip, drawn HERE inside the
        // clickable group so the whole control toggles the lane; the unified computeChipStride loop
        // above skips this row and fills in the remaining stride rows
        // (gap-git-graph-lane-chip-rendered-once-regardless-of-span). The first commit's own subject
        // is skipped below (the fold control replaces it), so the control never overlaps text on its row.
        var foldRow = laneTopRow[b.id];
        var grp2 = g.append("g").style("cursor", "pointer")
          .on("click", function () { expanded[b.id] = false; render(); });
        var foldChipW = 0;
        if (b.ref != null) { foldChipW = appendChip(grp2, textX, y(foldRow) - 6, b.ref, color); }
        grp2.append("text").attr("class", "git-svg-ink").attr("x", textX + foldChipW + 6).attr("y", y(foldRow) - 6).attr("font-size", 10)
          .text("▲ 折叠");
        grp2.append("title").text(b.ref != null ? ("点击折叠 " + b.ref) : "点击折叠");
      }
    });

    // Nodes + text: iterate the items directly; each item paints at its own row and x.
    items.forEach(function (it) {
      var yy = y(it.row);
      var laneX = it.x;
      if (it.kind === "commit") {
        var c = it.commit;
        var node;
        if (it.laneId === null) {
          if (c.parents > 1) {
            node = g.append("rect").attr("class", "git-svg-merge")
              .attr("x", trunkX - mergeR).attr("y", yy - mergeR)
              .attr("width", mergeR * 2).attr("height", mergeR * 2)
              .attr("transform", "rotate(45 " + trunkX + " " + yy + ")");
          } else {
            node = g.append("circle").attr("class", "git-svg-commit")
              .attr("cx", trunkX).attr("cy", yy).attr("r", nodeR);
          }
        } else {
          node = g.append("circle").attr("class", "git-svg-commit")
            .attr("cx", laneX).attr("cy", yy).attr("r", nodeR)
            .style("fill", laneColorById[it.laneId]);
        }
        node.append("title").text(c.hash + " · " + c.subject);
        if (it.laneId === null) {
          g.append("text").attr("class", "git-svg-ink").attr("x", textX).attr("y", yy + 4).attr("font-size", 11)
            .text(fitWidth ? c.hash.slice(0, 7) : (c.hash.slice(0, 7) + " " + c.subject));
        } else {
          // The fold control replaces the expanded branch's first commit subject (its own row),
          // so the control never overlaps text on the top row.
          var isFoldRow = expanded[it.laneId] === true && it.row === laneTopRow[it.laneId];
          if (!isFoldRow) {
            g.append("text").attr("class", "git-svg-muted").attr("x", textX).attr("y", yy + 4).attr("font-size", 10)
              .text(fitWidth ? c.hash.slice(0, 7) : (c.hash.slice(0, 7) + " " + c.subject));
          }
        }
      } else {
        // AC4: a collapsed branch's summary row leads with a chip(ref) — the branch name is prominent
        // (lane-colour pill + high-contrast label) instead of a bare text prefix. An unnamed lane
        // (ref == null) gets no chip — just the commit circle + count/span text.
        var b = it.branch;
        var grp = g.append("g").style("cursor", "pointer")
          .on("click", function () { expanded[b.id] = true; render(); });
        grp.append("circle").attr("class", "git-svg-commit").attr("cx", laneX).attr("cy", yy).attr("r", nodeR)
          .style("fill", laneColorById[b.id]);
        var chipW = 0;
        if (b.ref != null) { chipW = appendChip(grp, textX, yy + 3, b.ref, laneColorById[b.id]); }
        grp.append("text").attr("class", "git-svg-ink").attr("x", textX + chipW + 6).attr("y", yy + 4).attr("font-size", 11)
          .text(fitWidth ? ("· " + b.commits.length + " commits") : ("· " + b.commits.length + " commits · " + spanText(b) + "（点击展开）"));
        grp.append("title").text(b.ref != null ? ("点击展开 " + b.ref + " 的 " + b.commits.length + " 条提交") : ("点击展开 " + b.commits.length + " 条提交"));
      }
    });

    // "+N more" hint when lanes exceeded the configurable slot limit (track stays bounded).
    if (overflow > 0) {
      g.append("text").attr("class", "git-svg-muted")
        .attr("x", textX).attr("y", padY - 8).attr("font-size", 10)
        .text("+" + overflow + " more lanes 收窄");
    }

    // AC5: re-measure the rendered text and widen the viewBox to the TRUE right edge, so no subject
    // is ever clipped by the viewBox (content-derived width — never a literal, and never a guess).
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

    // gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead AC2: one transparent hit rect
    // per branch, spanning trunkX → the graph's right edge, on the branch's interactive row (summary
    // when collapsed, fold control when expanded — both are the branch's TOP visible row). This makes
    // the WHOLE row clickable: the old summary group only hit-tested the node circle + chip + glyphs,
    // leaving a ~450px dead zone in between. Drawn last (on top) so it captures the click uniformly.
    var hitWidth = finalWidth - trunkX;
    branches.forEach(function (b) {
      var hr = laneTopRow[b.id];
      if (hr === undefined) { return; }
      g.append("rect").attr("class", "git-svg-hit")
        .attr("x", trunkX).attr("y", y(hr) - rowH / 2)
        .attr("width", hitWidth).attr("height", rowH - 2)
        .attr("fill", "transparent").attr("pointer-events", "all")
        .style("cursor", "pointer")
        .on("click", function () { expanded[b.id] = !expanded[b.id]; render(); });
    });
  }

  // gap-git-graph-drops-commits-while-overflowcount-reports-zero: scroll loader. The sentinel sits
  // BELOW the SVG; when it scrolls into view (rootMargin 600px) fetch the OLDER page and PREPEND its
  // mainline commits to the current mainline lane, then re-render. Live branches come back in FULL on
  // every page (readGitHistory fetches them uncapped via --not <mainline>), so only the mainline lane
  // carries genuinely-new commits — prepending is lossless and needs no client-side re-layout (rows
  // are reassigned from scratch by visibleRows, and lateral lanes' fork/merge hashes still resolve
  // against the grown trunkRow map). The older page's layout was still computed SERVER-side by
  // layoutGitGraph; the client only grafts its mainline lane, which is all-mainline and fork/merge-free.
  var sentinel = document.getElementById("git-graph-sentinel");
  var coverageEl = document.getElementById("git-graph-coverage");
  var loadingOlder = false;
  var olderDone = false;

  function mainlineWatermark() {
    var min = null;
    mainline.commits.forEach(function (c) { if (min === null || c.t < min) { min = c.t; } });
    return min;
  }
  function coverageSpan() {
    // MAINLINE-scoped (mirrors coverageSpanSeconds): the pagination pages mainline commits only, so
    // the "how far back" number tracks mainline.commits — not the always-fully-loaded lateral lanes.
    var min = null, max = null;
    mainline.commits.forEach(function (c) {
      if (min === null || c.t < min) { min = c.t; }
      if (max === null || c.t > max) { max = c.t; }
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
    var wm = mainlineWatermark();
    if (wm === null) { finishOlder(); return; }
    loadingOlder = true;
    fetch("/git-history.json?before=" + wm + "&limit=500")
      .then(function (res) {
        if (!res.ok) { finishOlder(); return; }
        return res.json().then(function (next) {
          if (!next || next.status !== "ok" || !next.branches || !next.branches.length) { finishOlder(); return; }
          var older = (next.branches[0].commits) || [];
          if (older.length === 0) { finishOlder(); return; }
          var have = {};
          mainline.commits.forEach(function (c) { have[c.hash] = true; });
          var added = 0;
          older.forEach(function (c) { if (!have[c.hash]) { mainline.commits.unshift(c); added++; } });
          if (added === 0) { finishOlder(); return; }
          // Keep the lane's commit array canonical (oldest→newest) like layoutGitGraph's mainline.sort.
          mainline.commits.sort(function (a, b) { return a.t - b.t || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0); });
          data.commitCount += added;
          updateCoverage();
          render();
          // The prepended rows are exactly "added" mainline rows ABOVE the current viewport, so the
          // same content (the scroll anchor commit) is restored by scrolling down by added × rowH —
          // the scroll-position preservation the DoD requires, without a hash→pixel re-walk.
          window.scrollBy(0, added * rowH);
          // Reset the guard BEFORE chaining. The self-chain call below runs inside .then(), which
          // precedes any .finally() on the promise chain — a .finally()-based reset would still leave
          // loadingOlder === true when the chained loadOlder() re-enters, so the guard would dead-return
          // and the chain would stop after one page (gap-git-graph-scroll-loader-self-chain-blocked-by-
          // loadingolder-flag). olderDone (set by finishOlder on the empty / added===0 paths) remains the
          // sole termination signal, so a continuously-visible sentinel still stops at the oldest page.
          loadingOlder = false;
          // If the grown graph still leaves the sentinel in view, chain the next page.
          if (sentinel && sentinel.getBoundingClientRect().top < window.innerHeight + 600) { loadOlder(); }
        });
      })
      .catch(function () { finishOlder(); });
  }
  if (sentinel) {
    if (typeof IntersectionObserver !== "undefined") {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) { if (entries[i].isIntersecting) { loadOlder(); } }
      }, { rootMargin: "600px 0px" });
      io.observe(sentinel);
    } else {
      sentinel.addEventListener("click", loadOlder);
    }
  }

  render();
})();`;
}

/**
 * Sticky mini-legend rendered in the graph corner (●=commit / ◆=merge / ┃=trunk), decoupled from the
 * page's header prose. The "+N more lanes" overflow hint is drawn by the client renderer next to the
 * track itself (plan point 3), so this legend stays a pure "how to read the graph" key.
 */
export function gitGraphLegendHtml(): string {
  const glyph = (colorVar: string, ch: string, label: string) =>
    `<span><span style="color:${colorVar}">${ch}</span> ${label}</span>`;
  const parts = [
    glyph("var(--color-accent-600)", "●", "commit"),
    glyph("var(--color-accent-2-500)", "◆", "merge"),
    glyph("var(--color-neutral-700)", "┃", "trunk"),
    glyph("var(--color-neutral-700)", "╌", "在飞（未合并）"),
  ];
  return `<div style="position:sticky;left:0;top:0;z-index:2;display:inline-flex;gap:0.75rem;align-items:center;background:var(--color-surface);padding:0.25rem 0.6rem;border:1px solid var(--color-neutral-200);border-radius:6px;font-size:0.72rem;color:var(--color-neutral-700)">${parts.join("")}</div>`;
}

/**
 * Render the full /git-history HTML page. The graph is CLIENT-rendered from the embedded JSON via
 * the inlined D3 library (the retired 「零客户端 JS」 invariant — see docs/webui-guide.md). The page
 * still carries a server-rendered summary table (an accessible, JS-free view of branch count/span).
 * Exported so the same-source / status-column ACs (gap-git-graph-omits-inflight-branches-and-
 * summary-table-disjoint AC2/AC4) can test the rendered HTML directly on a pure GitHistoryResult.
 */
export function renderGitHistoryPage(history: GitHistoryResult): string {
  const statusNote = history.status === "error"
    ? html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(history.reason || "")}</p>`
    : history.status === "empty"
      ? html`<p class="meta"><strong>无数据</strong> — ${escapeHtml(history.reason || "")}</p>`
      : "";
  const layout = history.status === "ok" ? layoutGitGraph(history) : null;
  const nCommits = history.commits.length;
  const mergeCount = history.commits.filter((c) => c.parents > 1).length;
  // gap-git-graph-trunk-ref-resolves-to-head-not-mainline: the guide prose must name the SAME ref
  // the mainline lane + summary table name (develop/master), never a hardcoded "develop" that could
  // disagree with an author-named trunk. Falls back to "develop" only when there is no graph.
  const trunkRef = layout ? mainlineLane(layout).ref || "develop" : "develop";
  // gap-git-graph-drops-commits-while-overflowcount-reports-zero AC5: the guide prose's 「覆盖时长」
  // is computed from the LOADED commits' actual time span (never a hardcoded constant); the client
  // loader re-computes it after every scroll-load and writes the fresh number into #git-graph-coverage.
  const coverageSpan = layout ? coverageSpanSeconds(layout) : null;
  const coverageText = coverageSpan !== null ? formatCoverageSpan(coverageSpan) : "—";

  const graph = layout
    ? html`<div id="git-graph" aria-label="Git 纵向时间轴" style="overflow-x:auto">${gitGraphLegendHtml()}</div>`
    : "";
  // gap-git-graph-drops-commits-while-overflowcount-reports-zero: the scroll sentinel sits BELOW the
  // SVG; when it scrolls into view the client fetches the older page (/git-history.json?before=…).
  const sentinel = layout
    ? html`<div id="git-graph-sentinel" class="meta" style="padding:0.6rem 0;color:var(--color-neutral-700);font-size:0.75rem">加载更早提交…</div>`
    : "";
  // gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead: 移动端「适应宽度」开关 — the
  // client reads this checkbox and, when checked, hides commit subjects (only chip + commit count),
  // shrinking the content-derived SVG width to fit a narrow viewport.
  const fitWidthToggle = layout
    ? html`<div style="margin:0.5rem 0;font-size:0.8rem;color:var(--color-neutral-700)"><label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer"><input type="checkbox" id="git-graph-fit-width"> 适应宽度（仅 chip + 提交数，隐藏 subject，移动端）</label></div>`
    : "";
  // The data JSON is embedded with `<` escaped to \u003c so a commit subject can never break out of
  // the <script> element. d3 + the client renderer are emitted only when there is a graph to draw.
  // AC5: textWidth (the content-derived viewBox width seed) rides in the same JSON as the layout.
  const graphData = layout ? { ...layout, textWidth: computeGitGraphWidth(layout, GIT_GRAPH_TEXT_X) } : null;
  const laneTokenStyles = layout ? html`<style>${gitGraphLaneTokenCss()}</style>` : "";
  const dataScript = graphData ? html`<script type="application/json" id="git-graph-data">${JSON.stringify(graphData).replace(/</g, "\\u003c")}</script>` : "";
  const libScript = layout ? html`<script>${gitGraphLibJs()}</script>` : "";
  const clientScript = layout ? html`<script>${gitGraphClientScript()}</script>` : "";

  // gap-git-graph-omits-inflight-branches-and-summary-table-disjoint: the summary table used to be
  // built from groupCommitsByBranch (a --source-ref grouping) — a SECOND branch model whose name set
  // was disjoint from the graph's fork/merge lanes. It now renders the SAME layout.branches the
  // graph draws, plus a 状态 column (已合并 / 在飞), so the table and the graph point at one set of
  // objects. The mainline lane is branches[0] (status 已合并 — the closed mainline, never 在飞).
  const summaryRows = layout
    ? layout.branches.map((b) => ({
        ref: b.ref,
        status: b.kind === "mainline" ? "已合并" : b.open ? "在飞" : "已合并",
        firstT: b.firstT,
        lastT: b.lastT,
        count: b.commits.length,
        merges: b.commits.filter((c) => c.parents > 1).length,
      }))
    : [];
  const summaryRowsHtml = summaryRows.map((b) => {
    const taskId = taskIdFromBranchRef(b.ref);
    const name = taskId
      ? html`<a href="/task/${encodeURIComponent(taskId)}">${escapeHtml(b.ref!)}</a>`
      : b.ref == null
        ? html`<span style="color:var(--color-neutral-500)">未命名</span>`
        : escapeHtml(b.ref);
    return html`<tr>
      <td>${name}</td>
      <td>${escapeHtml(b.status)}</td>
      <td>${b.firstT == null ? "—" : escapeHtml(isoTime(b.firstT))}</td>
      <td>${b.lastT == null ? "—" : escapeHtml(isoTime(b.lastT))}</td>
      <td>${b.count}</td>
      <td>${b.merges}</td>
    </tr>`;
  }).join("\n");
  const summaryTable = summaryRows.length > 0 ? html`<h2>分支汇总（git 可证的事实，非工时）</h2>
    <table>
      <tr><th>分支</th><th>状态</th><th>首提交落地</th><th>末提交落地</th><th>提交数</th><th>合并数</th></tr>
      ${summaryRowsHtml}
    </table>` : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay git history — vertical commit timeline (third-party library, client-rendered)">${modernistStyles()}${pageStyles()}<title>Git history — vertical commit timeline</title></head>
    <body>${renderMobileChrome("git", "git history")}${renderSiteNav("git")}<main id="main">
      <h1>Git History — 提交纵向时间轴</h1>
      <p class="meta"><strong>纵轴 = 提交落地顺序（git commit time），不是工时/持续时间。</strong> ${escapeHtml(trunkRef)} 竖直主干 + task 分支从主干分出（fork）/合入（merge）的连线；task 分支默认折叠（只显提交数与时间跨度，点击展开逐条）。菱形 = 合并提交（fan-in 落地事件）。当前窗口：最近 ${nCommits} 条提交、${mergeCount} 个合并（跨所有本地分支）；已加载窗口覆盖 <span id="git-graph-coverage">${escapeHtml(coverageText)}</span>。滚动到图表底部自动加载更早的提交。</p>
      ${statusNote}
      ${fitWidthToggle}
      ${graph}
      ${sentinel}
      ${laneTokenStyles}
      ${dataScript}
      ${libScript}
      ${clientScript}
      ${summaryTable}
    </main></body></html>`;
}

export async function handleGitHistory(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let history: GitHistoryResult;
  try {
    history = readGitHistory(cfg.workspaceRoot);
  } catch (err) {
    history = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, commits: [], head: null, heads: {} };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderGitHistoryPage(history));
}

function writeJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/** The JSON payload /git-history.json returns — a COMPLETE GitGraphLayout (the client re-renders it
 *  as a whole, never an appended fragment) plus the window's oldest/newest commit times (AC3 reads
 *  `oldestT`; the client's scroll restoration is driven by the prepend growth, not these fields).
 *  Pure and directly importable (no I/O) — AC1/AC3 test it on a pure GitHistoryResult. */
export function gitHistoryJson(history: GitHistoryResult): {
  status: GitHistoryResult["status"];
  reason: string | null;
  commitCount: number;
  oldestT: number | null;
  newestT: number | null;
  branches: GitGraphBranchLane[];
  mergeCount: number;
  overflowCount: number;
  textWidth: number;
} {
  if (history.status !== "ok") {
    return { status: history.status, reason: history.reason, commitCount: 0, oldestT: null, newestT: null, branches: [], mergeCount: 0, overflowCount: 0, textWidth: 0 };
  }
  const layout = layoutGitGraph(history);
  if (!layout) {
    return { status: "empty", reason: history.reason ?? "git 仓库无提交记录", commitCount: 0, oldestT: null, newestT: null, branches: [], mergeCount: 0, overflowCount: 0, textWidth: 0 };
  }
  let oldestT: number | null = null;
  let newestT: number | null = null;
  for (const c of history.commits) {
    if (oldestT === null || c.t < oldestT) oldestT = c.t;
    if (newestT === null || c.t > newestT) newestT = c.t;
  }
  return {
    status: "ok",
    reason: null,
    commitCount: layout.commitCount,
    oldestT,
    newestT,
    branches: layout.branches,
    mergeCount: layout.mergeCount,
    overflowCount: layout.overflowCount,
    textWidth: computeGitGraphWidth(layout, GIT_GRAPH_TEXT_X),
  };
}

/** GET /git-history.json?before=<unixSeconds>&limit=<n> — the on-demand pagination endpoint the
 *  client's scroll loader calls. `before` = the cursor (returns mainline commits STRICTLY older than
 *  it); `limit` = the mainline page size (clamped to a sane ceiling). Reuses readGitHistory's per-ref
 *  fetch + layoutGitGraph (the SAME layout the HTML page embeds), never a second build path. */
export async function handleGitHistoryJson(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  url: URL,
): Promise<void> {
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, GIT_HISTORY_LIMIT * 10) : GIT_HISTORY_LIMIT;
  const beforeRaw = Number.parseInt(url.searchParams.get("before") ?? "", 10);
  const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;
  let history: GitHistoryResult;
  try {
    history = readGitHistory(cfg.workspaceRoot, { limit, before });
  } catch (err) {
    history = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, commits: [], head: null, heads: {} };
  }
  writeJson(res, 200, gitHistoryJson(history));
}
