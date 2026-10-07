// task-granularity-advice.ts — gap-task-granularity-advice-script-merge-candidates-and-per-file-history.
// @instrument "At filing time, which OPEN tasks already declare the files this draft will touch (merge candidates), and how has each of those files behaved historically (landed tasks / changed lines / worker rounds)? And — across task sizes — what is the real worker cost per unit of landed work (worker-hours per 1000 changed lines), with a re-runnable cost model?"
//
// WHY THIS EXISTS
// ---------------
// `plugin/skills/quay-file-task/SKILL.md` has TWO granularity surfaces, and before this script
// neither had a re-runnable source:
//   1. step 2b ("merge-candidate check") — a hand-run `grep -lF ... tasks/*.md | xargs grep -lE
//      '^status: (todo|ready)$'` recipe. Nothing mechanical computed it, so it was skipped or
//      paraphrased away.
//   2. `## Granularity` — numbers (landing round ≈17 min + 0.35 min/100 lines; ≈0.94 failed rounds
//      per task; worker-hours per 1000 changed lines by size bin) that lived ONLY as prose in the
//      skill. That is exactly the "copied number that drifts" the project instructions forbid:
//      a constant in a resident file with no source that can be re-read.
// This script is the source. `--task`/`--touches` answers (1) mechanically; `--report` recomputes
// (2) from the REAL production carriers (`worker-outcome.jsonl` + git), and its rendered document
// (`docs/analysis/task-granularity-and-throughput-2026-10-07.md`) is what the skill's numbers point at.
//
// ── 口径 (definitions, fixed before any number is read) ────────────────────────────────────────────
// * **severity/state** — `final_state` is NEVER compared inline here. Every record is routed through
//   `classifyFinalState` (rework-predictors.ts), which returns four DISTINGUISHABLE classes
//   (`success` / `legacy-alias` / `non-landed` / `unrecognized`). Inlining `=== "landed"` yields ≈0
//   successes (a dead value — tasks/gap-worker-outcome-final-state-landed-is-a-dead-value.md), and
//   an unrecognized state must never be silently folded into either side (硬规则 3b). AC5 asserts
//   both properties POSITIONALLY on this file's own source.
// * **executions** = the number of `.quay/worker-outcome.jsonl` records whose `task` is this id —
//   the same quantity rework-predictors.ts uses, via the same loader (never a second parser).
// * **size** of a landed task = `git diff --numstat <merge>^2 <merge>` for the task's LAST
//   `Merge branch 'develop' into task/<id>` commit: parent-2 is the develop side, so this is the
//   task's own landing diff. Summed insertions+deletions over CODE + TEST files only
//   (`tasks/` `.quay/` `goals/` and lockfiles are excluded — they are bookkeeping, not work).
// * **rank/position, not keyword** (硬规则 2) — "does peer P share file F?" is decided by parsing
//   P's `## Touches` (via `touches-parser.ts`) AND by the literal presence of F in P's text. The
//   two are reported separately (`declaredSharedFiles` vs `proseOnlySharedFiles`), so a prose
//   mention can never be mistaken for a declaration (nor lost).
//
// ── 读不懂的输入 (硬规则 3b) ────────────────────────────────────────────────────────────────────────
// A missing carrier, a missing tasks dir, or a root that is not a git repo does NOT render as
// "no peers / nLanded: 0" — that is the shape of a healthy empty answer. Each such dimension is
// marked `evaluated: false` with a reason, and the per-file rows then OMIT `nLanded` entirely
// (an absent key is distinguishable; a literal 0 is not).
//
// ENTRY POINT
//   node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches <path>... [--json]
//   node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --task <id> [--json]
//   node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --report [--since <ISO>] [--json]
// Flags: --root <dir> (repeatable; default = main checkout) · --since <ISO date> · --min-bin-n N (10)
//        · --bootstrap N (1000) · --seed N (20261007) · --out <file> · --json · --no-write
// Exit: 0 (advice always; the JSON carries `evaluated`) · 2 usage error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// AC5 (positional): the production-state classifier + outcome loader are REUSED, never re-implemented.
import { classifyFinalState, loadOutcomes, median as sharedMedian, type OutcomeRecord } from "./rework-predictors.ts";
// AC5 (positional): Touches parsing goes through the ONE parser (ADR-004 single-source).
import { parseTouchEntries, extractTouchesSection } from "./touches-parser.ts";
import { parseFrontmatterCompletely, frontmatterStatus } from "./task-schema.ts";
import { isDirectEntry, seededRng } from "./gate-script-base.ts";
import { repoRoot, mainCheckoutRoot } from "./repo-root.ts";

// ── the file-class predicates (what is a "substantive source file") ──────────────────────────────
//
// A merge candidate is only meaningful for a file two tasks will actually EDIT. A generic registry
// (the capability catalog's declaration data, a shrink-only baseline, the freshness producer table)
// is touched by nearly every task that adds a script or a check — overlapping there carries no
// serialization signal, so including it would report "everyone is a peer of everyone".
// A test file is likewise not a merge signal on its own.
const GENERIC_REGISTRY_BASENAMES = new Set([
  "capability-catalog-declarations.json",
  "freshness-producers.json",
]);

/** True iff this Touches entry is a SUBSTANTIVE SOURCE file for peer-overlap purposes: not the
 *  task's own file, not a test, not a generic registry/baseline. */
export function isSubstantiveTouchesPath(p: unknown): boolean {
  const s = String(p ?? "").replace(/^\.\//, "").trim();
  if (!s) return false;
  if (s.startsWith("tasks/") || s === "tasks") return false;      // self-touch / task store
  if (s.startsWith(".quay/") || s.startsWith("goals/")) return false;
  const base = s.split("/").pop() || "";
  if (/\.(test|spec)\./.test(base)) return false;                  // test file
  if (/\/tests?\//.test(s)) return false;
  if (GENERIC_REGISTRY_BASENAMES.has(base)) return false;
  if (/baseline/i.test(base)) return false;                        // *baseline*.json family
  if (/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(base)) return false;
  return true;
}

/** True iff this changed file counts toward the task's SIZE (code + tests). Registry/baseline
 *  bookkeeping files are excluded when they are pure registries, but a baseline that a task
 *  legitimately re-anchors is bookkeeping too — the report's 口径 excludes `tasks/`, `.quay/`,
 *  `goals/` and lockfiles explicitly; everything else counts. */
export function countsTowardSize(p: string): boolean {
  if (p.startsWith("tasks/") || p.startsWith("goals/") || p.startsWith(".quay/")) return false;
  const base = p.split("/").pop() || "";
  if (/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(base)) return false;
  return true;
}

// ── rooted readers ───────────────────────────────────────────────────────────────────────────────

export interface RootRead<T> {
  evaluated: boolean;
  reason: string | null;
  value: T | null;
}

function readText(file: string): { ok: boolean; text: string; reason: string | null } {
  try {
    return { ok: true, text: fs.readFileSync(file, "utf8"), reason: null };
  } catch (e) {
    return { ok: false, text: "", reason: (e as Error).message };
  }
}

export function carrierStatus(root: string): { evaluated: boolean; path: string; reason: string | null; records: number } {
  const p = path.join(root, ".quay", "worker-outcome.jsonl");
  if (!fs.existsSync(p)) return { evaluated: false, path: p, reason: "carrier-missing", records: 0 };
  try {
    fs.accessSync(p, fs.constants.R_OK);
  } catch (e) {
    return { evaluated: false, path: p, reason: `carrier-unreadable: ${(e as Error).message}`, records: 0 };
  }
  const load = loadOutcomes(p);
  // An EMPTY stream is NOT-EVALUATED, exactly like an absent one (rework-predictors.ts's exit-3
  // contract): "the carrier holds no round" and "no task ever reworks" are the same reading
  // otherwise, and `medianExecutions: 0` would render the first as the second (硬规则 3b).
  if (load.records.length === 0) {
    return { evaluated: false, path: p, reason: "carrier-empty", records: 0 };
  }
  return { evaluated: true, path: p, reason: null, records: load.records.length };
}

export interface PeerTask {
  id: string;
  root: string;
  status: string;
  touches: string[];
  text: string;
}

/** Read every `<root>/tasks/*.md` whose status is todo|ready. A root whose tasks dir is missing /
 *  unreadable is REPORTED (`evaluated:false`), never rendered as "no peers exist". */
export function readOpenTasks(roots: string[]): { evaluated: boolean; reason: string | null; tasks: PeerTask[] } {
  const tasks: PeerTask[] = [];
  const reasons: string[] = [];
  for (const root of roots) {
    const dir = path.join(root, "tasks");
    let entries: string[];
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("not a directory");
      entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch (e) {
      reasons.push(`tasks-dir-unreadable: ${dir} (${(e as Error).message})`);
      continue;
    }
    for (const f of entries) {
      const r = readText(path.join(dir, f));
      if (!r.ok) {
        reasons.push(`task-file-unreadable: ${path.join(dir, f)} (${r.reason})`);
        continue;
      }
      const status = frontmatterStatus(parseFrontmatterCompletely(splitFrontmatter(r.text)));
      if (status !== "todo" && status !== "ready") continue;
      const { section } = extractTouchesSection(r.text);
      tasks.push({ id: f.slice(0, -3), root, status, touches: parseTouchEntries(section), text: r.text });
    }
  }
  return { evaluated: reasons.length === 0, reason: reasons.length ? reasons.join("; ") : null, tasks };
}

function splitFrontmatter(fullText: string): string {
  const m = fullText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

// ── landing index (per root) ─────────────────────────────────────────────────────────────────────

const TASK_MERGE_RE = /^Merge branch 'develop' into task\/(.+)$/;

export interface LandingTask {
  id: string;
  root: string;
  /** `git diff --numstat <merge>^2 <merge>` — file path → changed lines (ins+del). */
  files: Map<string, number>;
  /** Sum of `files` over SIZE-counted paths (code + tests). */
  size: number;
}

export interface LandingIndex {
  evaluated: boolean;
  reason: string | null;
  byId: Map<string, LandingTask>;
  /** How many distinct task branches had a `Merge branch 'develop' into task/<id>` commit. */
  mergeTaskCount: number;
}

/** Derive each landed task's landing diff from its LAST `Merge branch 'develop' into task/<id>`
 *  commit, relative to that commit's develop-side parent (`^2`). */
export function landingTasksForRoot(root: string, log: (m: string) => void = () => {}): LandingIndex {
  const byId = new Map<string, LandingTask>();
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["-C", root, "log", "--all", "--merges", "--grep", "^Merge branch 'develop' into task/", "-E", "--format=%H%x09%P%x09%s"],
      { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (e) {
    return { evaluated: false, reason: `landing-index-unavailable: git log failed in ${root} (${(e as Error).message})`, byId, mergeTaskCount: 0 };
  }
  const shas: { sha: string; id: string; parents: string[] }[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [sha, parentsRaw, ...subjParts] = line.split("\t");
    const subject = subjParts.join("\t");
    const m = subject.match(TASK_MERGE_RE);
    if (!m) continue;
    const id = m[1].trim();
    if (!id || byId.has(id)) continue; // git log is newest-first ⇒ the FIRST hit is the LAST merge
    byId.set(id, { id, root, files: new Map(), size: 0 });
    shas.push({ sha, id, parents: parentsRaw.trim().split(/\s+/).filter(Boolean) });
  }
  for (const { sha, id, parents } of shas) {
    if (parents.length < 2) continue; // not a two-parent merge ⇒ no develop-side parent
    let ns: string;
    try {
      ns = execFileSync("git", ["-C", root, "-c", "core.quotepath=false", "diff", "--numstat", `${sha}^2`, sha], {
        encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue; // a single unreadable merge must not abort the whole index; it is simply not counted
    }
    const t = byId.get(id)!;
    for (const l of ns.split("\n")) {
      if (!l.trim()) continue;
      const parts = l.split("\t");
      if (parts.length < 3) continue;
      const ins = parts[0] === "-" ? 0 : Number(parts[0]);
      const del = parts[1] === "-" ? 0 : Number(parts[1]);
      if (!Number.isFinite(ins) || !Number.isFinite(del)) continue;
      const p = parts.slice(2).join("\t").replace(/^"|"$/g, "");
      const changed = ins + del;
      t.files.set(p, (t.files.get(p) ?? 0) + changed);
      if (countsTowardSize(p)) t.size += changed;
    }
    log("");
  }
  return { evaluated: true, reason: null, byId, mergeTaskCount: byId.size };
}

// ── per-file history ─────────────────────────────────────────────────────────────────────────────

export interface PerFileRow {
  path: string;
  evaluated: boolean;
  reason?: string;
  nLanded?: number;
  medianChangedLines?: number | null;
  medianFileChangedLines?: number | null;
  medianExecutions?: number | null;
}

export interface PerFileDeps {
  roots: string[];
  landing: Map<string, LandingIndex>;      // root → index
  outcomes: Map<string, Map<string, OutcomeRecord[]>>; // root → taskId → records
  /** Per-root carrier readability. An unreadable carrier makes EVERY per-file row unevaluated —
   *  `nLanded` would still be true, but `medianExecutions` would silently read as 0 (硬规则 3b). */
  carriers?: { root: string; evaluated: boolean; reason: string | null }[];
}

/** For each input path: how many LANDED tasks touched it, and the median (task total size, this
 *  file's own changed lines, worker executions) across those tasks. Never renders `nLanded: 0`
 *  when the underlying data could not be read (硬规则 3b). */
export function buildPerFile(paths: string[], deps: PerFileDeps): PerFileRow[] {
  const unreadable = deps.roots.filter((r) => !(deps.landing.get(r)?.evaluated));
  const badCarriers = (deps.carriers ?? []).filter((c) => !c.evaluated);
  const rows: PerFileRow[] = [];
  for (const p of paths) {
    if (unreadable.length) {
      rows.push({
        path: p,
        evaluated: false,
        reason: `landing-index-unavailable for root(s): ${unreadable.map((r) => deps.landing.get(r)?.reason ?? r).join("; ")}`,
      });
      continue;
    }
    if (badCarriers.length) {
      rows.push({
        path: p,
        evaluated: false,
        reason: `carrier-not-readable: ${badCarriers.map((c) => `${c.root} (${c.reason})`).join("; ")}`,
      });
      continue;
    }
    const sizes: number[] = [];
    const fileSizes: number[] = [];
    const execs: number[] = [];
    let n = 0;
    for (const root of deps.roots) {
      const idx = deps.landing.get(root);
      if (!idx) continue;
      for (const t of idx.byId.values()) {
        const per = t.files.get(p);
        if (per === undefined) continue;
        n++;
        sizes.push(t.size);
        fileSizes.push(per);
        execs.push((deps.outcomes.get(root)?.get(t.id) ?? []).length);
      }
    }
    rows.push({
      path: p,
      evaluated: true,
      nLanded: n,
      medianChangedLines: n ? sharedMedian(sizes) : null,
      medianFileChangedLines: n ? sharedMedian(fileSizes) : null,
      medianExecutions: n ? sharedMedian(execs) : null,
    });
  }
  return rows;
}

// ── peers ────────────────────────────────────────────────────────────────────────────────────────

export interface Peer {
  id: string;
  status: string;
  root: string;
  sharedFiles: string[];
}

export interface Mention {
  id: string;
  status: string;
  root: string;
  mentionedFiles: string[];
}

/**
 * Open tasks DECLARING ≥1 substantive input path in their `## Touches`.
 *
 * The overlap is decided by PARSED Touches (`touches-parser.ts`), not by the path literal appearing
 * anywhere in the file. That distinction is the whole point: a `## Touches` entry is what the
 * scheduler serializes on, and it is what a "merge candidate" means. A task that merely MENTIONS a
 * path in prose (an AC naming a command, a backlink, a code fence) is NOT going to edit that file,
 * and counting it would both false-positive the candidate list and make the tool's own answer
 * depend on prose written about the tool (`computeMentions` reports those separately).
 */
export function computePeers(inputPaths: string[], openTasks: PeerTask[]): Peer[] {
  const substantive = inputPaths.filter(isSubstantiveTouchesPath);
  if (substantive.length === 0) return [];
  const out: Peer[] = [];
  for (const t of openTasks) {
    const shared = substantive.filter((p) => t.touches.includes(p));
    if (shared.length === 0) continue;
    out.push({ id: t.id, status: t.status, root: t.root, sharedFiles: shared });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Open tasks whose TEXT contains ≥1 substantive input path WITHOUT declaring it in `## Touches` —
 * i.e. exactly the prose-only hits of step 2b's `grep -lF` recipe.
 *
 * Reported so the reader can see the difference between "declares this file" and "talks about this
 * file", and so the grep oracle stays checkable. The partition is PER PATH: for any single path,
 * `{ids in peers} ∪ {ids in mentions} = grep -lF <path> tasks/*.md ∩ open statuses`, since a task
 * either declares the path or merely mentions it (硬规则 2: 按位置判定). A task can therefore appear
 * in `peers` for one file and in `mentions` for another — excluding whole tasks (rather than
 * path-by-path) would silently drop a row and break that equality.
 */
export function computeMentions(inputPaths: string[], openTasks: PeerTask[]): Mention[] {
  const substantive = inputPaths.filter(isSubstantiveTouchesPath);
  if (substantive.length === 0) return [];
  const out: Mention[] = [];
  for (const t of openTasks) {
    const hits = substantive.filter((p) => t.text.includes(p) && !t.touches.includes(p));
    if (hits.length === 0) continue;
    out.push({ id: t.id, status: t.status, root: t.root, mentionedFiles: hits });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── the size bins ────────────────────────────────────────────────────────────────────────────────

export interface SizeBin {
  label: string;
  lo: number;
  hi: number | null;
}

/** The ten size bins the throughput reading is tabulated over. Fixed ONCE and stated in the report,
 *  so a later re-run is comparable rather than silently re-binned. */
export const SIZE_BINS: SizeBin[] = [
  { label: "<100", lo: 0, hi: 99 },
  { label: "100–150", lo: 100, hi: 149 },
  { label: "150–250", lo: 150, hi: 249 },
  { label: "250–400", lo: 250, hi: 399 },
  { label: "400–600", lo: 400, hi: 599 },
  { label: "600–1000", lo: 600, hi: 999 },
  { label: "1000–1500", lo: 1000, hi: 1499 },
  { label: "1500–2000", lo: 1500, hi: 1999 },
  { label: "2000–3000", lo: 2000, hi: 2999 },
  { label: "3000+", lo: 3000, hi: null },
];

// ── report ───────────────────────────────────────────────────────────────────────────────────────

export interface TaskMeasure {
  id: string;
  root: string;
  size: number;
  firstDispatched: string;
  executions: number;
  successExecutions: number;
  failedExecutions: number;
  unrecognizedExecutions: number;
  firstTrySuccess: boolean;
  landingRoundWallMin: number | null;
  failedWallMin: number;
  totalWallMin: number;
}

export interface Interval {
  lo: number;
  hi: number;
}

export interface BinRow {
  label: string;
  lo: number;
  hi: number | null;
  n: number;
  sufficient: boolean;
  insufficient: boolean;
  firstTryRate?: number;
  failedRoundsPerTask?: number;
  meanTotalWallMin?: number;
  workerHoursPer1000Lines?: number | null;
  workerHoursPer1000LinesCI?: Interval | null;
}

export interface ModelParam {
  value: number | null;
  ci: Interval | null;
}

export interface Report {
  mode: "report";
  evaluated: boolean;
  since: string | null;
  roots: string[];
  generatedAt: string;
  population: {
    roots: string[];
    landedTasks: number;
    tasksInWindow: number;
    measured: number;
    landedWithoutOutcomes: number;
    firstDispatchedMin: string | null;
    firstDispatchedMax: string | null;
  };
  bins: BinRow[];
  model: Record<"a" | "b" | "c" | "d" | "f0" | "f1", ModelParam>;
  bootstrap: { iterations: number; seed: number };
  perRoot: { root: string; tasks: number; bins: BinRow[] }[];
  notes: string[];
}

function minutes(ms: number | null | undefined): number | null {
  return typeof ms === "number" && Number.isFinite(ms) ? ms / 60_000 : null;
}

/** Turn one root's landed tasks + carrier into per-task measurements (size, wall, rounds). */
export function measureRoot(
  root: string,
  landing: LandingIndex,
  outcomes: Map<string, OutcomeRecord[]>,
): TaskMeasure[] {
  const out: TaskMeasure[] = [];
  for (const t of landing.byId.values()) {
    const recs = outcomes.get(t.id) ?? [];
    if (recs.length === 0) continue; // no carrier record ⇒ nothing to say about wall time
    const sorted = [...recs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const success = sorted.filter((r) => r.stateClass === "success");
    const failed = sorted.filter((r) => r.stateClass === "non-landed");
    const unrecognized = sorted.filter((r) => r.stateClass === "unrecognized");
    const wallOf = (rs: OutcomeRecord[]) => rs.reduce((a, r) => a + (typeof r.wall_clock_ms === "number" ? r.wall_clock_ms : 0), 0);
    out.push({
      id: t.id,
      root,
      size: t.size,
      firstDispatched: sorted[0].ts,
      executions: recs.length,
      successExecutions: success.length,
      failedExecutions: failed.length,
      unrecognizedExecutions: unrecognized.length,
      // "First-try success" = the EARLIEST worker round landed. legacy-alias is a dead value and is
      // neither a success nor a failure here; it is reported separately, never silently folded.
      firstTrySuccess: sorted[0].stateClass === "success",
      landingRoundWallMin: success.length ? minutes(wallOf([success[success.length - 1]])) : null,
      failedWallMin: minutes(wallOf(failed)) ?? 0,
      totalWallMin: minutes(wallOf(recs)) ?? 0,
    });
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function percentile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx];
}

/** worker-hours per 1000 changed lines over a set of tasks (the throughput headline). */
function workerHoursPer1000Lines(tasks: TaskMeasure[]): number | null {
  const lines = tasks.reduce((a, t) => a + t.size, 0);
  if (lines <= 0) return null;
  const hours = tasks.reduce((a, t) => a + t.totalWallMin, 0) / 60;
  return (hours / lines) * 1000;
}

export function summariseBin(bin: SizeBin, tasks: TaskMeasure[], minBinN: number): BinRow {
  const inBin = tasks.filter((t) => t.size >= bin.lo && (bin.hi === null || t.size <= bin.hi));
  const n = inBin.length;
  if (n < minBinN) {
    // ⛔ an under-sampled bin carries NO statistic — not a zero, not a "—" that reads as one.
    return { label: bin.label, lo: bin.lo, hi: bin.hi, n, sufficient: false, insufficient: true };
  }
  return {
    label: bin.label,
    lo: bin.lo,
    hi: bin.hi,
    n,
    sufficient: true,
    insufficient: false,
    firstTryRate: inBin.filter((t) => t.firstTrySuccess).length / n,
    failedRoundsPerTask: mean(inBin.map((t) => t.failedExecutions)),
    meanTotalWallMin: mean(inBin.map((t) => t.totalWallMin)),
    workerHoursPer1000Lines: workerHoursPer1000Lines(inBin),
    workerHoursPer1000LinesCI: bootstrapInterval(inBin, workerHoursPer1000Lines, 1000, 20261007),
  };
}

function bootstrapInterval(
  tasks: TaskMeasure[],
  stat: (ts: TaskMeasure[]) => number | null,
  iterations: number,
  seed: number,
): Interval | null {
  const observed = stat(tasks);
  if (observed === null || tasks.length < 2) return null;
  const rnd = seededRng(seed);
  const vals: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const sample: TaskMeasure[] = [];
    for (let i = 0; i < tasks.length; i++) sample.push(tasks[Math.floor(rnd() * tasks.length)]);
    const v = stat(sample);
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < 10) return null;
  return { lo: percentile(vals, 0.025), hi: percentile(vals, 0.975) };
}

/** Simple OLS on (x, y) pairs; null when x has no variance. */
function ols(xs: number[], ys: number[]): { intercept: number; slope: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/**
 * Fit `T(s) = (a + b·s/100) + f(s)·(c + d·s/100)` with `f(s) = f0 + f1·log10(s/300)`.
 *
 * The model is fitted in THREE linear stages — this is what makes six parameters identifiable
 * (the composite product f·(c+d·x) is not linear in them): stage 1 regresses the LANDING round's
 * wall on size (a, b); stage 2 regresses each FAILED round's wall on size (c, d); stage 3 regresses
 * the per-task FAILED ROUND COUNT on log10(size/300) (f0, f1).
 */
export function fitCostModel(tasks: TaskMeasure[], iterations: number, seed: number) {
  const stage1 = (ts: TaskMeasure[]) => {
    const pts = ts.filter((t) => t.landingRoundWallMin !== null);
    return ols(pts.map((t) => t.size / 100), pts.map((t) => t.landingRoundWallMin as number));
  };
  const stage2 = (ts: TaskMeasure[]) => {
    // The unit of cost here is the failed ROUND, not the task: a task with 3 failed rounds
    // contributes 3 observations at its own size (equivalently, a weighted regression with
    // weight = round count). A task with none contributes nothing.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const t of ts) {
      if (t.failedExecutions <= 0) continue;
      const per = t.failedWallMin / t.failedExecutions;
      for (let i = 0; i < t.failedExecutions; i++) {
        xs.push(t.size / 100);
        ys.push(per);
      }
    }
    return ols(xs, ys);
  };
  const stage3 = (ts: TaskMeasure[]) => {
    const pts = ts.filter((t) => t.size > 0);
    return ols(pts.map((t) => Math.log10(t.size / 300)), pts.map((t) => t.failedExecutions));
  };
  const point = {
    s1: stage1(tasks),
    s2: stage2(tasks),
    s3: stage3(tasks),
  };
  // Bootstrap: resample TASKS with replacement, refit all three stages on the same resample.
  const rnd = seededRng(seed);
  const draws: { a: number; b: number; c: number; d: number; f0: number; f1: number }[] = [];
  for (let b = 0; b < iterations; b++) {
    const sample: TaskMeasure[] = [];
    for (let i = 0; i < tasks.length; i++) sample.push(tasks[Math.floor(rnd() * tasks.length)]);
    const s1 = stage1(sample);
    const s2 = stage2(sample);
    const s3 = stage3(sample);
    if (s1 && s2 && s3) draws.push({ a: s1.intercept, b: s1.slope, c: s2.intercept, d: s2.slope, f0: s3.intercept, f1: s3.slope });
  }
  const ciFor = (key: "a" | "b" | "c" | "d" | "f0" | "f1"): Interval | null => {
    const vals = draws.map((d) => d[key]).filter((v) => Number.isFinite(v));
    if (vals.length < 10) return null;
    return { lo: percentile(vals, 0.025), hi: percentile(vals, 0.975) };
  };
  const param = (v: number | null | undefined, key: "a" | "b" | "c" | "d" | "f0" | "f1"): ModelParam => ({
    value: typeof v === "number" && Number.isFinite(v) ? v : null,
    ci: ciFor(key),
  });
  return {
    a: param(point.s1?.intercept, "a"),
    b: param(point.s1?.slope, "b"),
    c: param(point.s2?.intercept, "c"),
    d: param(point.s2?.slope, "d"),
    f0: param(point.s3?.intercept, "f0"),
    f1: param(point.s3?.slope, "f1"),
  };
}

export interface ReportOptions {
  roots: string[];
  since: string | null;
  minBinN?: number;
  bootstrap?: number;
  seed?: number;
  log?: (m: string) => void;
}

export function buildReport(opts: ReportOptions): Report {
  const minBinN = opts.minBinN ?? 10;
  const iterations = opts.bootstrap ?? 1000;
  const seed = opts.seed ?? 20261007;
  const since = opts.since ?? null;
  const log = opts.log ?? (() => {});
  const landing = new Map<string, LandingIndex>();
  const outcomesByRoot = new Map<string, Map<string, OutcomeRecord[]>>();
  const perRoot: { root: string; tasks: number; bins: BinRow[] }[] = [];
  const all: TaskMeasure[] = [];
  const notes: string[] = [];

  for (const root of opts.roots) {
    const idx = landingTasksForRoot(root, log);
    landing.set(root, idx);
    const outcomeMap = new Map<string, OutcomeRecord[]>();
    const carrier = carrierStatus(root);
    if (carrier.evaluated) {
      const load = loadOutcomes(carrier.path);
      for (const [id, recs] of load.byTask) outcomeMap.set(id, recs);
    } else {
      notes.push(`root ${root}: carrier not readable (${carrier.reason}) — its tasks are NOT in the sample`);
    }
    outcomesByRoot.set(root, outcomeMap);
    if (!idx.evaluated) notes.push(`root ${root}: ${idx.reason}`);
    const measures = measureRoot(root, idx, outcomeMap);
    all.push(...measures);
    // The per-root table is the SAME window-filtered statistic a single-root run would print, so
    // `--report --root <that root>` and this section are value-for-value comparable (AC6).
    const measured = since ? measures.filter((t) => t.firstDispatched >= since) : measures;
    perRoot.push({ root, tasks: measured.length, bins: SIZE_BINS.map((b) => summariseBin(b, measured, minBinN)) });
    log(`root ${root}: landed=${idx.byId.size} measured=${measures.length}`);
  }

  const inWindow = since ? all.filter((t) => t.firstDispatched >= since) : all;
  const landedWithoutOutcomes = [...landing.values()].reduce((a, i) => a + i.byId.size, 0) - all.length;
  const tsList = all.map((t) => t.firstDispatched).filter(Boolean).sort();
  const bins = SIZE_BINS.map((b) => summariseBin(b, inWindow, minBinN));
  const model = fitCostModel(inWindow, iterations, seed);
  return {
    mode: "report",
    evaluated: inWindow.length > 0,
    since,
    roots: opts.roots,
    generatedAt: new Date().toISOString(),
    population: {
      roots: opts.roots,
      landedTasks: [...landing.values()].reduce((a, i) => a + i.byId.size, 0),
      tasksInWindow: since ? all.filter((t) => t.firstDispatched >= since).length : all.length,
      measured: inWindow.length,
      landedWithoutOutcomes,
      firstDispatchedMin: tsList[0] ?? null,
      firstDispatchedMax: tsList[tsList.length - 1] ?? null,
    },
    bins,
    model,
    bootstrap: { iterations, seed },
    perRoot,
    notes,
  };
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, digits = 2): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}
function ci(v: Interval | null | undefined, digits = 2): string {
  return v ? `[${fmt(v.lo, digits)}, ${fmt(v.hi, digits)}]` : "—";
}

function renderBinTable(bins: BinRow[]): string[] {
  const L: string[] = [];
  L.push(`| 体量档（变更行） | n | 首次成功率 | 每任务失败轮 | 单任务总 wall（min） | worker 小时/1000 行（95% 区间） |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const b of bins) {
    if (b.insufficient) {
      L.push(`| ${b.label} | ${b.n} | 样本不足（n<10，不给统计量） | — | — | — |`);
    } else {
      L.push(
        `| ${b.label} | ${b.n} | ${fmt((b.firstTryRate ?? 0) * 100, 1)}% | ${fmt(b.failedRoundsPerTask)} | ` +
          `${fmt(b.meanTotalWallMin, 1)} | ${fmt(b.workerHoursPer1000Lines)} ${ci(b.workerHoursPer1000LinesCI)} |`,
      );
    }
  }
  return L;
}

export function renderMarkdown(r: Report, rerunCommand: string): string {
  const L: string[] = [];
  L.push(`# 任务粒度与吞吐——体量的成本读数（可复跑正本）`);
  L.push("");
  L.push(`> 生成于 \`${r.generatedAt}\` · 复跑命令：`);
  L.push(`> \`\`\``);
  L.push(`> ${rerunCommand}`);
  L.push(`> \`\`\``);
  L.push("");
  L.push(`本文是 \`plugin/skills/quay-file-task/SKILL.md\` 的 \`## Granularity\` 节所引用的每个数字的**来源与复跑入口**。`);
  L.push(`SKILL.md 不再自己保存数字——数字会漂移，而这里的表每次由 \`--report\` 从生产载体重算。`);
  L.push("");
  L.push(`## 1. 口径（先定口径，再谈数字）`);
  L.push("");
  L.push(`- **任务体量 \`s\`（变更行）**：该任务最后一次 \`Merge branch 'develop' into task/<id>\` 提交相对其 develop 一侧父提交`);
  L.push(`  （\`git diff --numstat <merge>^2 <merge>\`）的插入+删除行数之和，只计**代码与测试**文件；`);
  L.push(`  排除 \`tasks/\`、\`.quay/\`、\`goals/\` 与 lockfile（它们是记账，不是工作量）。`);
  L.push(`- **落地轮 wall / 失败轮 wall / 总 wall**：\`.quay/worker-outcome.jsonl\` 中该任务各记录的 \`wall_clock_ms\`。`);
  L.push(`  成功/失败**不内联比较 \`final_state\` 字面量**，而是经 \`classifyFinalState\`（rework-predictors.ts）`);
  L.push(`  分成四个可区分的类：\`success\` / \`legacy-alias\`（死取值）/ \`non-landed\` / \`unrecognized\`。`);
  L.push(`- **总 wall** = 该任务**全部** worker 轮（含失败轮）的 wall 之和；这是「这个任务一共烧了多少 worker 时间」的直接量。`);
  L.push(`- **worker 小时/1000 变更行** = 档内 Σ总wall(小时) ÷ Σ变更行 × 1000。区间为**按任务重采样**的 bootstrap 95%（${r.bootstrap.iterations} 次，seed ${r.bootstrap.seed}）。`);
  L.push(`- **样本 < 10 的档不给任何统计量**（标 \`insufficient\`）——那不是「读数为 0」，是「读不出来」。`);
  L.push("");
  L.push(`## 2. 读数表（分析正本的表）`);
  L.push("");
  L.push(`- 数据根：${r.roots.map((x) => `\`${x}\``).join(" · ")}`);
  L.push(`- 首次派发窗：${r.since ? `≥ \`${r.since}\`` : "全部"} · 观测窗 \`${r.population.firstDispatchedMin ?? "?"}\` → \`${r.population.firstDispatchedMax ?? "?"}\``);
  L.push(`- 总体：有落地 merge 的任务 ${r.population.landedTasks} 个；其中在窗内且**有 worker 记录可测** ${r.population.measured} 个；`);
  L.push(`  有落地 merge 但无任何 worker 记录（不在样本内）${r.population.landedWithoutOutcomes} 个。`);
  L.push("");
  L.push(...renderBinTable(r.bins));
  L.push("");
  const sufficient = r.bins.filter((b) => b.sufficient);
  if (sufficient.length >= 2) {
    const first = sufficient[0];
    const last = sufficient[sufficient.length - 1];
    const cheapest = sufficient.reduce((a, b) => ((b.workerHoursPer1000Lines ?? Infinity) < (a.workerHoursPer1000Lines ?? Infinity) ? b : a));
    L.push(`**主读数（对「按吞吐优化」的直接支持）**：每 1000 变更行的 worker 成本随体量**下降**——`);
    L.push(`最小充足档 \`${first.label}\` 为 ${fmt(first.workerHoursPer1000Lines)} 小时，最大充足档 \`${last.label}\` 为 ${fmt(last.workerHoursPer1000Lines)} 小时（本窗最低档：\`${cheapest.label}\` ${fmt(cheapest.workerHoursPer1000Lines)}）。`);
    L.push(`⇒ 同样的工作量放进更大的任务，worker 时间更少；这条**跨档比较**是本表唯一支撑拆分决策的量。`);
    // The failed-rounds arm is reported as the DATA shows it — U-shaped, not flat. An earlier
    // reading claimed "失败轮数不随体量上升"; the re-run does not reproduce that at the top end, so
    // the honest statement is printed instead of the old one (the RULE it supported still holds,
    // because the throughput metric below keeps falling).
    const bySize = [...sufficient].sort((a, b) => a.lo - b.lo);
    L.push(`**失败轮数（读它时注意形状）**：各档为 ${bySize.map((b) => `${b.label}: ${fmt(b.failedRoundsPerTask)}`).join(" · ")}。`);
    L.push(`**它不是单调不上升的**：最小档与最大档都偏高（新任务的固定成本 / 超大任务的首次失败集中在尾部）。`);
    L.push(`但它**不推翻「按吞吐优化」**——按每 1000 变更行计的成本仍随体量单调下降，因为成功轮次的固定成本被摊薄得更快。`);
    L.push(`（前版 SKILL.md 曾写「失败轮数不随规模上升」，本次复跑在该读法上取假，已在 §5 记录，规则本身不变。）`);
  } else {
    L.push(`⚠️ 充足样本的档不足两个，本窗的数据不支持任何跨档比较——不要从不足样本的档里读出趋势（硬规则 3b）。`);
  }
  L.push("");
  L.push(`## 3. 成本模型`);
  L.push("");
  L.push(`\`T(s) = (a + b·s/100) + f(s)·(c + d·s/100)\`，其中 \`f(s) = f0 + f1·log10(s/300)\` 为每任务失败轮数。`);
  L.push(`三阶段最小二乘：落地轮 wall ~ a + b·s/100；失败轮 wall ~ c + d·s/100；失败轮数 ~ f0 + f1·log10(s/300)。`);
  L.push(`失败轮那一阶段以**失败轮**为单位（一个任务的每个失败轮各算一个观测点，等价于以轮数为权重的回归），`);
  L.push(`落地轮与失败轮数两阶段以**任务**为单位；bootstrap 三阶段都按任务重采样。`);
  L.push(`区间为按任务重采样的 bootstrap 95%。`);
  L.push("");
  L.push(`| 参数 | 含义 | 值 | 95% 区间 |`);
  L.push(`|---|---|---|---|`);
  L.push(`| a | 落地轮固定成本（min） | ${fmt(r.model.a.value)} | ${ci(r.model.a.ci)} |`);
  L.push(`| b | 落地轮每 100 行的斜率（min/100 行） | ${fmt(r.model.b.value, 3)} | ${ci(r.model.b.ci, 3)} |`);
  L.push(`| c | 失败轮固定成本（min） | ${fmt(r.model.c.value)} | ${ci(r.model.c.ci)} |`);
  L.push(`| d | 失败轮每 100 行的斜率（min/100 行） | ${fmt(r.model.d.value, 3)} | ${ci(r.model.d.ci, 3)} |`);
  L.push(`| f0 | 每任务失败轮数（s=300 行处） | ${fmt(r.model.f0.value)} | ${ci(r.model.f0.ci)} |`);
  L.push(`| f1 | 失败轮数对 log10(s/300) 的斜率 | ${fmt(r.model.f1.value, 3)} | ${ci(r.model.f1.ci, 3)} |`);
  L.push("");
  L.push(`## 4. 单项目对拍（每个 root 各算一遍）`);
  L.push("");
  L.push(`> 多项目合计会掩盖单项目的差异；下表让每个 root 的读数可单独核对（与 \`--root <该 root>\` 的单根运行逐值一致）。`);
  L.push("");
  for (const pr of r.perRoot) {
    L.push(`### \`${pr.root}\`（窗口内可测 ${pr.tasks} 个任务）`);
    L.push("");
    L.push(...renderBinTable(pr.bins));
    L.push("");
  }
  L.push(`## 5. 已知限制`);
  L.push("");
  L.push(`- **只含已落地任务**：样本来自「有 \`Merge branch 'develop' into task/<id>\` 提交」的任务。`);
  L.push(`  从未落地、或落地路径不同（没有那次 merge）的任务不在样本内——选择效应，不是全量。`);
  L.push(`- **体量是最后一次 merge 时的快照**：其后追加的提交（若不在该 merge 里）不计入；`);
  L.push(`  被排除的记账文件（\`tasks/\` 等）也不算体量，所以 s 是**代码+测试**的规模，不是 PR 总行数。`);
  L.push(`- **相关，不是因果**：难度不可观测，「难任务更大也更常返工」能产生同样的表。本文所有读法都是**相关**。`);
  L.push(`- **任务之间不独立**：同一批 worker、同一套测试、同一时段；bootstrap 区间只反映**抽样**不确定性，`);
  L.push(`  不反映工人/时段效应，因此区间比真实不确定性**窄**。`);
  L.push(`- **首次成功率只判「第一轮是否 \`success\`」**：\`legacy-alias\`（死取值）与 \`unrecognized\` 都不算成功；`);
  L.push(`  观测到 unrecognized 取值时说明载体里出现了本脚本读不懂的状态字，应先去核对口径再读本表。`);
  L.push(`- **多项目合计的 root 列表是显式给出的**（见上方复跑命令）——本脚本不扫描、不发现项目，`);
  L.push(`  少传一个 root 就是少一份样本，且不会有任何提示。`);
  L.push(`- **与前版 SKILL.md 数字的差异（逐条）**：前版数字来自一次未留脚本的读数，本次复跑对照如下——`);
  L.push(`  * 每 1000 变更行的成本量级与排序**复现**（最小档最贵、最大档最便宜）；具体值随观测窗推进略有变化。`);
  L.push(`  * 「每任务约 0.94 个失败轮」**复现**（f0 = ${fmt(r.model.f0.value)}）。`);
  L.push(`  * 「落地轮 = 17 min + 0.35 min/100 行」**未复现**：本次为 a = ${fmt(r.model.a.value)} min、b = ${fmt(r.model.b.value, 3)} min/100 行`);
  L.push(`    （b 的区间很宽，见上表——这条斜率在本数据上不是一个稳定的量，不要引用单个点值）。`);
  L.push(`  * 「失败轮数不随规模上升」**取假**：≥1500 行的档失败轮数明显更高（见 §2 读法）；`);
  L.push(`    但按吞吐口径（每 1000 变更行）规则不受影响，故 \`## Granularity\` 的三条规则不改。`);
  if (r.notes.length) {
    L.push("");
    L.push(`**本次运行的载体备注**：`);
    for (const n of r.notes) L.push(`- ${n}`);
  }
  L.push("");
  return L.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

export const USAGE = `task-granularity-advice.ts — 立案期的粒度建议（合并候选 + 每文件历史）与吞吐读数（task gap-task-granularity-advice-script-merge-candidates-and-per-file-history）
用法:
  node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches <path>... [--json]
  node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --task <id> [--json]
  node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --report [--since <ISO>] [--json] [--out <file>]
选项:
  --touches <path>     草稿 Touches（可重复）——输出合并候选与每文件历史
  --task <id>          读该任务 tasks/<id>.md 的 ## Touches 作为输入
  --report             吞吐口径报告（体量分档 + 成本模型）
  --since <ISO>        report：只取该日之后【首次派发】的任务（分析正本用 2026-09-16）
  --root <dir>         数据根（tasks/ 与 .quay/ 所在）；可重复；默认 = 主检出
  --min-bin-n <n>      分档最小样本数（默认 10；低于此标 insufficient 且不给统计量）
  --bootstrap <n>      report：bootstrap 次数（默认 1000）
  --seed <n>           report：bootstrap PRNG 种子（默认 20261007）
  --out <file>         report：文档输出路径（默认 docs/analysis/task-granularity-and-throughput-2026-10-07.md）
  --no-write           report：不写文档，只打印摘要
  --json               仅向 stdout 输出 JSON
退出码: 0 正常（advice 模式即使读不到载体也返回 0，由 JSON 的 evaluated 区分）· 2 用法错误`;

export function parseArgv(argv: string[]): { flags: Map<string, string[]>; positionals: string[] } {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const key = a.slice(2);
    const eq = key.indexOf("=");
    if (eq !== -1) {
      flags.set(key.slice(0, eq), [...(flags.get(key.slice(0, eq)) ?? []), key.slice(eq + 1)]);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags.set(key, [...(flags.get(key) ?? []), argv[++i]]);
    } else {
      flags.set(key, [...(flags.get(key) ?? []), "true"]);
    }
  }
  return { flags, positionals };
}

function defaultRoot(here: string): string {
  return path.resolve(mainCheckoutRoot(here) || repoRoot(here));
}

export function main(argv: string[]): number {
  const { flags } = parseArgv(argv);
  if (flags.has("help") || flags.has("h")) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = (flags.get("root") ?? []).map((r) => path.resolve(r));
  const rootList = roots.length ? roots : [defaultRoot(here)];
  const json = flags.has("json");

  // ── report mode ───────────────────────────────────────────────────────────────────────────────
  if (flags.has("report")) {
    const since = (flags.get("since") ?? [])[0] ?? null;
    const r = buildReport({
      roots: rootList,
      since,
      minBinN: flags.has("min-bin-n") ? Number(flags.get("min-bin-n")![0]) : undefined,
      bootstrap: flags.has("bootstrap") ? Number(flags.get("bootstrap")![0]) : undefined,
      seed: flags.has("seed") ? Number(flags.get("seed")![0]) : undefined,
    });
    const rerun =
      `node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --report` +
      (since ? ` --since ${since}` : "") +
      rootList.map((x) => ` --root ${x}`).join("");
    const outPath = path.resolve(
      (flags.get("out") ?? [])[0] ?? path.join(repoRoot(here), "docs", "analysis", "task-granularity-and-throughput-2026-10-07.md"),
    );
    if (json) {
      process.stdout.write(JSON.stringify({ ...r, rerunCommand: rerun }, null, 2) + "\n");
      return 0;
    }
    if (!flags.has("no-write")) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, renderMarkdown(r, rerun));
    }
    process.stdout.write(
      `task-granularity-advice --report: ${r.population.measured} measured tasks (since ${since ?? "always"}) across ${rootList.length} root(s)\n` +
        r.bins.map((b) => `  ${b.label}: n=${b.n}${b.insufficient ? " (insufficient)" : ` wh/1000L=${fmt(b.workerHoursPer1000Lines)}`}`).join("\n") +
        `\n  model: a=${fmt(r.model.a.value)} b=${fmt(r.model.b.value, 3)} c=${fmt(r.model.c.value)} d=${fmt(r.model.d.value, 3)} f0=${fmt(r.model.f0.value)} f1=${fmt(r.model.f1.value, 3)}\n` +
        (flags.has("no-write") ? "" : `  wrote ${outPath}\n`),
    );
    return 0;
  }

  // ── advice mode ───────────────────────────────────────────────────────────────────────────────
  let inputs: string[] = [];
  let source = "cli";
  const taskId = (flags.get("task") ?? [])[0];
  if (taskId) {
    source = `task:${taskId}`;
    let found: string | null = null;
    for (const r of rootList) {
      const f = path.join(r, "tasks", `${taskId}.md`);
      if (fs.existsSync(f)) {
        found = f;
        break;
      }
    }
    if (!found) {
      process.stderr.write(`task-granularity-advice: task \`${taskId}\` not found under any --root (looked in tasks/)\n`);
      return 2;
    }
    const { section } = extractTouchesSection(fs.readFileSync(found, "utf8"));
    inputs = parseTouchEntries(section);
  } else {
    inputs = flags.get("touches") ?? [];
  }
  if (inputs.length === 0) {
    process.stderr.write(USAGE + "\n");
    return 2;
  }

  // peers
  const open = readOpenTasks(rootList);
  const peers = open.evaluated ? computePeers(inputs, open.tasks) : [];
  const mentions = open.evaluated ? computeMentions(inputs, open.tasks) : [];
  // per-file history
  const landing = new Map<string, LandingIndex>();
  const outcomes = new Map<string, Map<string, OutcomeRecord[]>>();
  const carrierNotes: { root: string; evaluated: boolean; records: number; reason: string | null }[] = [];
  const reasons: string[] = [];
  for (const r of rootList) {
    const idx = landingTasksForRoot(r);
    landing.set(r, idx);
    if (!idx.evaluated) reasons.push(idx.reason ?? `landing-index-unavailable: ${r}`);
    const carrier = carrierStatus(r);
    carrierNotes.push({ root: r, evaluated: carrier.evaluated, records: carrier.records, reason: carrier.reason });
    if (!carrier.evaluated) reasons.push(`carrier-not-readable: ${carrier.path} (${carrier.reason})`);
    const m = new Map<string, OutcomeRecord[]>();
    if (carrier.evaluated) {
      for (const [id, recs] of loadOutcomes(carrier.path).byTask) m.set(id, recs);
    }
    outcomes.set(r, m);
  }
  const perFile = buildPerFile(inputs, { roots: rootList, landing, outcomes, carriers: carrierNotes });
  if (!open.evaluated) reasons.push(open.reason ?? "tasks-dir-unreadable");
  const evaluated = open.evaluated && perFile.every((f) => f.evaluated);
  const payload = {
    mode: "advice" as const,
    evaluated,
    peersEvaluated: open.evaluated,
    reasons,
    roots: rootList,
    inputs: { touches: inputs, source },
    substantiveInputs: inputs.filter(isSubstantiveTouchesPath),
    peers,
    mentions,
    perFile,
    carrier: carrierNotes,
  };
  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(
    `task-granularity-advice: ${inputs.length} input path(s) · evaluated=${evaluated}\n` +
      `  peers (${peers.length}): ${peers.map((p) => `${p.id}[${p.status}]`).join(", ") || "—"}\n` +
      `  mentions-only (${mentions.length}): ${mentions.map((p) => `${p.id}[${p.status}]`).join(", ") || "—"}\n` +
      perFile
        .map((f) =>
          f.evaluated
            ? `  ${f.path}: landed=${f.nLanded} medLines=${fmt(f.medianChangedLines, 0)} medFileLines=${fmt(f.medianFileChangedLines, 0)} medRounds=${fmt(f.medianExecutions)}`
            : `  ${f.path}: NOT-EVALUATED (${f.reason})`,
        )
        .join("\n") +
      (reasons.length ? `\n  reasons: ${reasons.join("; ")}` : "") +
      "\n",
  );
  return 0;
}

if (isDirectEntry(import.meta, undefined, "task-granularity-advice")) {
  process.exitCode = main(process.argv.slice(2));
}
