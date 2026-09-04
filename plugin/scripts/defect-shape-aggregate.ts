// plugin/scripts/defect-shape-aggregate.ts — the CROSS-TASK defect-shape aggregator
// (tasks/gap-no-cross-task-defect-shape-aggregation).
//
// PROBLEM IT FIXES: the loop's input is a SINGLE defect (every task family is `gap-*`, triggered
// by "observed one failure"). Architectural debt NEVER appears as one failure — it appears as
// "N failures sharing one root". No mechanism aggregates across tasks today, so a root that
// manifests as N sibling defects stays invisible inside any one task's record; the aggregation
// only happens when a human happens to ask. Concretely (this session's three findings, each
// only visible cross-task):
//   1. `readTaskStatusAtRef` was verbatim-copied 3× (+ ≥10 files hand-rolling status parsing) —
//      the "same judgment" was acknowledged in a comment but never unified.
//   2. AC checkbox counting had 4 independent implementations, and two of them had already
//      DIVERGED on `- [~]` (partial) handling.
//   3. The main-checkout root-derivation bug (first `git worktree list --porcelain` entry ≠ main)
//      was fixed in ONE script, then kept recurring in 3 more sites.
//
// WHAT IT DOES (a PASSIVE reader — invariant shapeAggregateIsPassive = 1, AC4): it reads the
// append-only data that already exists — the `tasks/*.md` store (frontmatter + body + `## Touches`)
// and git history (only for landing recency, read-only) — and clusters recently-LANDED (`status:
// done`) `gap-*` defects by "shared shape". A shape is the mechanism vocabulary of a defect
// (identifiers / flags / paths named in its title + body + Touches), so two defects that name the
// same distinctive token (`readTaskStatusAtRef`, `countAcCheckboxes`, `--git-common-dir`) are the
// SAME root manifesting again. When a window holds ≥N defects in one cluster, it emits a
// "these N share this root" candidate report.
//
// It NEVER writes the task store, NEVER files a task (AC4 — first version is report-only, an
// INPUT channel for a human/manager, not a writer that floods the pool), NEVER triggers any run.
//
// Clustering (the ONE rule, so the AC2 known-cluster rediscovery and the AC3 negative control are
// both testable):
//   - tokens are lowercased identifiers/flags/paths from the WHOLE task file (frontmatter + body),
//     plus the `## Touches` paths;
//   - document frequency (df) is counted over all done `gap-*` tasks;
//   - a token is DISTINCTIVE iff 2 ≤ df ≤ --max-df (default 8): shared by ≥2 tasks (so it can
//     bind a cluster) but not so common it is background noise (`worker-driver.ts` is touched by
//     126 tasks → df 126 ≫ 8 → never binds a cluster — the AC3 negative control);
//   - one candidate cluster per distinctive token = {tasks naming that token}; candidate clusters
//     whose member sets overlap ≥ 50% (Jaccard) are merged (near-duplicate tokens);
//   - clusters are ranked by size, then by recency (newest landed member first).
//
// Run:
//   node --experimental-strip-types plugin/scripts/defect-shape-aggregate.ts [--root <dir>]
//       [--max-df <n>] [--top <n>] [--min-cluster-size <n>] [--since <iso-date>] [--recent <n>]
//       [--json | --human]
//   --root             repo/workspace root (default: auto-derived from cwd).
//   --max-df           the df ceiling for a "distinctive" token (default 8).
//   --top              how many clusters to print (default 5).
//   --min-cluster-size drop clusters smaller than this (default 3 — the "≥N（如 3）" recurrence floor).
//   --since <iso>      only cluster tasks landed at/after this date (default: no filter).
//   --recent <n>       only cluster the N most-recently-landed done tasks (the "最近 N 条已落地缺陷" query).
//   --json             pretty JSON with meta (tests / introspection).
//   --human            human-readable lines.
//   Default output is the JSON array of clusters ([] when none).
//
// Exit codes: 0 = report produced (may be empty); 2 = usage/env error. A report is DATA, not a
// verdict — it never gates anything and never turns red (AC4).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";
import { extractTouchesSection, parseTouchEntries } from "./touches-parser.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface TaskRecord {
  id: string;
  status: string;
  /** Distinctive mechanism tokens from the whole file (frontmatter + body), deduped. */
  tokens: string[];
  /** `## Touches` paths (normalized, annotations stripped via the single touches-parser). */
  touchedFiles: string[];
  /** Last git commit touching the task file, seconds since epoch (0 = unknown). */
  landedAt: number;
}

export interface DefectCluster {
  /** Number of landed defects in this cluster. */
  size: number;
  /** Member task ids, sorted. */
  members: string[];
  /** The distinctive tokens that bind this cluster (rarest first). */
  tokens: string[];
  /** `## Touches` files shared by ≥2 members (report context, NOT a clustering input). */
  sharedFiles: string[];
  /** Best single-word "root" label = the rarest binding token. */
  rootLabel: string;
  /** Newest landing time among members (seconds since epoch, 0 = unknown). */
  newestLandedAt: number;
}

// ── Token extraction (pure) ────────────────────────────────────────────────────────────────────────

// A defect's SHAPE is its mechanism VOCABULARY — the code identifiers and CLI flags its title + body
// name. We deliberately do NOT extract bare prose words, hyphenated English phrases, or dotted paths
// as cluster binders: those are the noise that AC3 shows merges unrelated tasks (a test filename or a
// prose word like "recovering" is not a root signature). Touched files are read separately
// (`parseTouchedFiles`) and reported as corroborating context, never as a cluster binder.
//
// Extracted on the ORIGINAL case (so camelCase boundaries are preserved — `readTaskStatusAtRef` is
// ONE identifier, not "read"/"task"/"status"), then lowercased for case-insensitive dedup:
//   - camelCase       readTaskStatusAtRef → readtaskstatusatref
//   - snake_case      read_task_status    → read_task_status
//   - SCREAMING_SNAKE QUAY_MAIN_CHECKOUT  → quay_main_checkout
//   - CLI flag        --git-common-dir    → --git-common-dir
const CAMEL_RE = /[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+/g;
const SNAKE_RE = /[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g;
const SCREAMING_RE = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g;
const FLAG_RE = /--[a-zA-Z][a-zA-Z0-9-]*/g;

/** Generic stdlib/API identifiers (lowercased) that appear in code snippets across UNRELATED tasks —
 *  a defect's ROOT is never "the task used startsWith/readFileSync". Analogous to prose stopwords:
 *  they would otherwise bind spurious clusters of tasks that merely share a code idiom. Repo-specific
 *  helpers (e.g. mechSh) are deliberately NOT here — a repo helper CAN be a root signature. */
const GENERIC_APIS = new Set(
  "startswith endswith tostring tolowercase touppercase substring substr charcodeat indexof lastindexof includes trim readfilesync writefilesync execfilesync spawnsync execsync readdirsync realpathsync existssync statsync mkdirsync rmdirsync unlinksync readfile writefile stringify parseint parsefloat isnan isfinite gettime settimeout setinterval cleartimeout".split(
    " ",
  ),
);

/** Skip a token that is a git SHA artifact (never a mechanism). */
function isNoiseToken(t: string): boolean {
  if (/^[0-9a-f]{7,40}$/.test(t)) return true;
  return false;
}

/** Extract the mechanism-token multiset of a task file's raw text (deduped, noise-free). */
export function extractMechanismTokens(text: string): string[] {
  const set = new Set<string>();
  for (const re of [CAMEL_RE, SNAKE_RE, SCREAMING_RE, FLAG_RE]) {
    const m = String(text).match(re);
    if (m) for (const t of m) set.add(t.toLowerCase());
  }
  const out: string[] = [];
  for (const t of set) {
    if (t.length < 2) continue;
    if (isNoiseToken(t)) continue;
    if (GENERIC_APIS.has(t)) continue;
    out.push(t);
  }
  return out;
}

// ── Frontmatter + file reading (passive — read-only) ──────────────────────────────────────────────

/** Read the single-line `status:` / `id:` fields without depending on full YAML folding. */
function frontmatterField(raw: string, key: string): string {
  const m = raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : "";
}

/** A task file's `## Touches` paths (the ONE parser: touches-parser.ts). */
export function parseTouchedFiles(raw: string): string[] {
  const { hasSection, section } = extractTouchesSection(raw);
  if (!hasSection) return [];
  return parseTouchEntries(section);
}

/**
 * Landing time (last git commit touching each task file), batched into ONE `git log` over the
 * whole tasks/ tree, read-only. Returns a map `tasks/<id>.md` basename → seconds-since-epoch;
 * missing entries = 0. Fail-open: if git is unavailable the map is empty and ranking falls back
 * to size-only (a passive reader never aborts on a missing history).
 */
export function landingTimes(root: string): Map<string, number> {
  const out = new Map<string, number>();
  let text = "";
  try {
    text = execFileSync("git", ["-C", root, "log", "--format=%ct", "--name-only", "--no-renames", "--", "tasks/"], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return out;
  }
  // git log is newest-first: the FIRST timestamp seen for a file is its newest touch. Skip the
  // commit-entry timestamp lines (`%ct` outputs one bare digit line per commit) and the blank
  // separators; only `tasks/*.md` name lines are mapped.
  let currentTime = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (/^\d{5,}$/.test(trimmed)) {
      currentTime = Number(trimmed);
      continue;
    }
    const base = trimmed.replace(/^tasks\//, "");
    if (!base.endsWith(".md")) continue;
    if (!out.has(base)) out.set(base, currentTime);
  }
  // The map is keyed by `tasks/<id>.md` basename; task ids ARE the basenames, so look up directly.
  return out;
}

/**
 * Enumerate the landed (`status: done`) `gap-*` task files under `<root>/tasks`, extracting each
 * task's id, status, mechanism tokens, and Touches. Returns [] on a missing tasks dir (fail-open,
 * hard rule 6: an absent store is "nothing to read", not a crash).
 */
export function readDoneGapTasks(root: string, landMap?: Map<string, number>): TaskRecord[] {
  const dir = path.join(root, "tasks");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.startsWith("gap-") && n.endsWith(".md"));
  } catch {
    return [];
  }
  const records: TaskRecord[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let raw = "";
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const status = frontmatterField(raw, "status");
    if (status !== "done") continue;
    const id = frontmatterField(raw, "id") || name.replace(/\.md$/, "");
    records.push({
      id,
      status,
      tokens: extractMechanismTokens(raw),
      touchedFiles: parseTouchedFiles(raw),
      landedAt: landMap ? landMap.get(name) ?? 0 : 0,
    });
  }
  return records;
}

// ── Clustering (pure) ─────────────────────────────────────────────────────────────────────────────

/** Document frequency: token → number of tasks whose file names it. */
export function computeDocFreq(tasks: TaskRecord[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of tasks) {
    for (const tok of t.tokens) df.set(tok, (df.get(tok) ?? 0) + 1);
  }
  return df;
}

/** One candidate cluster = the set of tasks naming a distinctive token (df ∈ [minDf, maxDf]). */
export function buildDistinctiveClusters(
  tasks: TaskRecord[],
  df: Map<string, number>,
  maxDf: number,
): { token: string; members: string[] }[] {
  const byToken = new Map<string, string[]>();
  for (const tok of df.keys()) {
    const d = df.get(tok)!;
    if (d < 2 || d > maxDf) continue;
    byToken.set(tok, []);
  }
  for (const t of tasks) {
    for (const tok of t.tokens) {
      if (byToken.has(tok)) byToken.get(tok)!.push(t.id);
    }
  }
  const out: { token: string; members: string[] }[] = [];
  for (const [token, members] of byToken) {
    out.push({ token, members: [...new Set(members)].sort() });
  }
  // Rarest token first (best "root" signature) so the merge and ranking are deterministic.
  return out.sort((a, b) => (df.get(a.token)! - df.get(b.token)!) || (b.members.length - a.members.length));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Greedy single-pass merge of token clusters whose member sets overlap ≥ `jaccardFloor` (default
 * 0.5). Near-duplicate tokens (`readTaskStatusAtRef` / `fetchTaskStatusAtRef`) merge into one
 * cluster; genuinely distinct roots that merely co-occur in one hub task stay separate (their
 * Jaccard is small).
 */
export function mergeClusters(
  tokenClusters: { token: string; members: string[] }[],
  jaccardFloor = 0.5,
): DefectCluster[] {
  const merged: DefectCluster[] = [];
  for (const tc of tokenClusters) {
    const set = new Set(tc.members);
    let target: DefectCluster | null = null;
    for (const m of merged) {
      if (jaccard(set, new Set(m.members)) >= jaccardFloor) {
        target = m;
        break;
      }
    }
    if (target) {
      target.members = [...new Set([...target.members, ...tc.members])].sort();
      target.tokens = [...new Set([...target.tokens, tc.token])];
    } else {
      merged.push({ size: 0, members: [...tc.members], tokens: [tc.token], sharedFiles: [], rootLabel: tc.token, newestLandedAt: 0 });
    }
  }
  return merged;
}

/**
 * The whole aggregation over one workspace root (the end-to-end entry used by the CLI and tests):
 * enumerate landed gap-* defects → extract shapes → cluster by distinctive shared tokens →
 * merge near-duplicates → rank by size then recency. Returns clusters in ranked order (no `--top`
 * cut here, so tests can assert the full ranked list).
 */
export function aggregateDefectClusters(
  root: string,
  opts: { maxDf?: number; minClusterSize?: number; since?: string; recent?: number } = {},
): DefectCluster[] {
  const maxDf = opts.maxDf ?? 8;
  const minClusterSize = opts.minClusterSize ?? 3;
  const since = opts.since ? Date.parse(opts.since) : null;

  const landMap = landingTimes(root);
  const tasks0 = readDoneGapTasks(root, landMap);
  let tasks = since && Number.isFinite(since) ? tasks0.filter((t) => t.landedAt === 0 || t.landedAt >= since / 1000) : tasks0;
  // "最近 N 条已落地缺陷" — restrict to the N most-recently-landed done tasks (by git landing time).
  if (opts.recent && Number.isFinite(opts.recent) && opts.recent > 0) {
    tasks = [...tasks].sort((a, b) => b.landedAt - a.landedAt).slice(0, opts.recent);
  }

  const df = computeDocFreq(tasks);
  const tokenClusters = buildDistinctiveClusters(tasks, df, maxDf);
  const clusters = mergeClusters(tokenClusters, 0.5);

  // Recompute per-cluster metadata: size, shared Touches files, recency, root label (rarest token).
  const byId = new Map<string, TaskRecord>(tasks.map((t) => [t.id, t]));
  for (const c of clusters) {
    c.size = c.members.length;
    const memberRecords = c.members.map((id) => byId.get(id)).filter((r): r is TaskRecord => !!r);
    const newest = Math.max(0, ...memberRecords.map((r) => r.landedAt));
    c.newestLandedAt = newest;
    const fileCount = new Map<string, number>();
    for (const r of memberRecords) for (const f of r.touchedFiles) fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
    c.sharedFiles = [...fileCount.entries()].filter(([, n]) => n >= 2).map(([f]) => f).sort();
    // Rarest (lowest df) binding token is the best root label.
    c.tokens = c.tokens.sort((a, b) => (df.get(a) ?? 999) - (df.get(b) ?? 999));
    c.rootLabel = c.tokens[0] ?? "";
  }

  const ranked = clusters
    .filter((c) => c.size >= minClusterSize)
    .sort((a, b) => b.size - a.size || b.newestLandedAt - a.newestLandedAt);
  return ranked;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  let root: string | null = null;
  let maxDf = 8;
  let top = 5;
  let minClusterSize = 3;
  let since = "";
  let recent = 0;
  let json = false;
  let human = false;
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    helpExit(
      "usage: node defect-shape-aggregate.ts [--root <dir>] [--max-df <n>] [--top <n>] [--min-cluster-size <n>] [--since <iso-date>] [--recent <n>] [--json | --human]",
    );
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--max-df") maxDf = Number(args[++i]);
    else if (args[i] === "--top") top = Number(args[++i]);
    else if (args[i] === "--min-cluster-size") minClusterSize = Number(args[++i]);
    else if (args[i] === "--since") since = args[++i];
    else if (args[i] === "--recent") recent = Number(args[++i]);
    else if (args[i] === "--json") json = true;
    else if (args[i] === "--human") human = true;
  }
  if (!Number.isFinite(maxDf) || maxDf < 2) maxDf = 8;
  if (!Number.isFinite(top) || top < 1) top = 5;
  if (!Number.isFinite(minClusterSize) || minClusterSize < 1) minClusterSize = 3;
  if (!Number.isFinite(recent) || recent < 1) recent = 0;

  const rootDir = root ? path.resolve(root) : repoRoot(process.cwd());
  const clusters = aggregateDefectClusters(rootDir, { maxDf, minClusterSize, since: since || undefined, recent: recent || undefined });
  const shown = clusters.slice(0, top);

  if (human) {
    if (shown.length === 0) process.stdout.write("defect-shape-aggregate: no cross-task defect clusters found (clean)\n");
    for (const c of shown) {
      process.stdout.write(
        `CLUSTER root="${c.rootLabel}" size=${c.size} members=[${c.members.join(", ")}]\n`,
      );
    }
    process.stdout.write(`defect-shape-aggregate: ${clusters.length} cluster(s) (showing ${shown.length}), maxDf=${maxDf}\n`);
  } else if (json) {
    const meta = {
      root: rootDir,
      maxDf,
      top,
      minClusterSize,
      since: since || null,
      doneGapTasksRead: readDoneGapTasks(rootDir).length,
      clusterCount: clusters.length,
      shapeAggregateIsPassive: 1, // invariant shapeAggregateIsPassive — reads only, never writes/triggers
    };
    process.stdout.write(`${JSON.stringify({ clusters: shown, meta }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(shown)}\n`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "defect-shape-aggregate")) {
  process.exitCode = main(process.argv);
}
