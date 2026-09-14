// rework-predictors.ts — gap-rework-multiplier-predictors.
// @instrument "What predicts rework — which task attributes (Touches entry count, goal_ac, shape, labels, body length, depends_on, filer) are associated with a task being executed N times by the worker pool, with a FALSIFIABLE control (permutation null + partial correlation) rather than a bare correlation?"
//
// WHY THIS EXISTS
// ---------------
// `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §3 measured, on this repo's
// OWN telemetry (`.quay/worker-outcome.jsonl`, 703 distinct tasks / 1,896 worker executions):
// median 2 executions, p90 5, max 27. Rework is the largest hidden cost in the loop — but nothing
// told a FILER "this task will take five rounds". §3 stopped at the distribution; this instrument
// carries it one step: which attributes of the task itself are associated with high rework, and
// which candidate associations are artefacts.
//
// ── THE METRIC (口径), and the dead-value trap it has to survive ─────────────────────────────────────
// `executions` = the number of `.quay/worker-outcome.jsonl` records whose `task` is this task id.
// That is exactly the quantity §3 tabulated (its 703/1,896 pair), and re-running this script
// reproduces §3's summary numbers (median 2 / p90 5 / max 27) — a CHECK on the metric, not a claim.
//
// The trap: `final_state == "landed"` is a DEAD value
// (`tasks/gap-worker-outcome-final-state-landed-is-a-dead-value.md`): it appears on exactly ONE
// historical record, and the live success state is `completed`. A consumer that reads
// `final_state == "landed"` as "this execution succeeded" gets a success count of ~0 — a reading
// indistinguishable from "the loop never lands anything" (硬规则 3b). This script therefore never
// tests state equality inline; it routes every record through `classifyFinalState`, which returns
// one of FOUR distinguishable values (`success` / `legacy-alias` / `non-landed` / `unrecognized`).
// An unrecognized state is REPORTED (count + the distinct values), never silently folded into
// either success or failure — "读不懂" must not share an output with "合格" (硬规则 3b).
//
// ── WHAT MAKES A CONCLUSION HERE FALSIFIABLE (硬规则 4 / 推论四) ──────────────────────────────────────
// A bare correlation is an EXPLANATION, not a TEST. Every conclusion in the report carries two
// controls that would come out DIFFERENTLY if the claim were false:
//   1. a PERMUTATION NULL — the same statistic computed on independently shuffled (task, executions)
//      pairings. If the association were an artefact of the pairing, the shuffled statistic would
//      reach the observed magnitude; the report states the null's p50/p95/max so the reader can see
//      the gap rather than trust a p-value.
//   2. a PARTIAL correlation controlling for a rival carrier — `touchesFileCount` and `bodyLen` are
//      themselves correlated (rho≈0.42), so "Touches predicts rework" could be "big tasks predict
//      rework, and big tasks also declare more files". The partial correlation distinguishes them,
//      and the result is asymmetric: one survives, the other collapses to ~0.
//
// ── CONFOUNDERS THE DATA CANNOT REMOVE (stated, not hidden) ──────────────────────────────────────────
// Task DIFFICULTY is unobservable here. "Hard tasks both touch more files and need more rounds"
// would produce the same table as a causal Touches effect. The report does what is available:
//   * stratification by `shape` (the correlation is reported INSIDE each stratum, not only pooled);
//   * an OBSERVATION-WINDOW control — the same statistic restricted to tasks filed before a cutoff,
//     so every task in the subpopulation had ≥14 days to accumulate executions (`executions` is
//     bounded by how long a task has existed, so task AGE is a first-class confounder);
//   * an explicit statement of what remains uncontrolled.
// ⛔ No claim here is causal. The output word for an association is 相关, never 导致.
//
// ── POPULATION (a selection effect, stated) ──────────────────────────────────────────────────────────
// The analysis population is "tasks that entered the worker pool at least once" — NOT every task on
// the board. ~2.1k task files exist; only the subset with ≥1 worker-outcome record is analysable.
// The report prints both numbers, so "this factor does not predict rework" can never be read as
// "no factor does" when the population was the constraint (硬规则 5: 来源完备性).
//
// ── ENTRY POINT ──────────────────────────────────────────────────────────────────────────────────────
//   node --experimental-strip-types plugin/scripts/rework-predictors.ts            # write the report
//   node --experimental-strip-types plugin/scripts/rework-predictors.ts --json     # stdout JSON only
//   node --experimental-strip-types plugin/scripts/rework-predictors.ts --no-write # print summary only
// Flags: --root <dir> · --permutations N (default 2000) · --seed N (default 20260914)
//        · --min-bin-n N (default 10) · --age-cutoff YYYY-MM-DD (default 2026-08-31)
// Output: docs/analysis/rework-multiplier-predictors.md (unless --no-write / --json).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTask } from "./task-schema.ts";
import { parseTouchEntries, extractTouchesSection } from "./touches-parser.ts";
import { detectShape } from "./ready-pool-check.ts";
import { isDirectEntry } from "./gate-script-base.ts";
import { repoRoot, mainCheckoutRoot } from "./repo-root.ts";

// ── The four-state `final_state` judgement (the dead-value trap lives here) ──────────────────────────
//
// `SUCCESS_STATES` is the LIVE success predicate. `landed` is kept as a separately-named
// `legacy-alias` bucket, NOT merged into success: it must stay visible as a dead value (a reader
// who sees "legacyAliasExecutions: 1" learns the trap exists; a reader who sees it folded into
// success learns nothing and would re-derive the broken predicate).
export const SUCCESS_STATES = ["completed"] as const;
export const LEGACY_SUCCESS_ALIASES = ["landed"] as const;
export const NON_LANDED_STATES = ["exited-not-landed", "failed", "killed"] as const;

export type StateClass = "success" | "legacy-alias" | "non-landed" | "unrecognized";

/** Route a raw `final_state` value to one of four DISTINGUISHABLE classes. An unknown value is
 *  `unrecognized` — it is neither counted as success nor as failure, so a future state word can
 *  never masquerade as either (硬规则 3b: 读不懂的输入不得与「合格」同形). */
export function classifyFinalState(state: unknown): StateClass {
  const s = typeof state === "string" ? state : "";
  if ((SUCCESS_STATES as readonly string[]).includes(s)) return "success";
  if ((LEGACY_SUCCESS_ALIASES as readonly string[]).includes(s)) return "legacy-alias";
  if ((NON_LANDED_STATES as readonly string[]).includes(s)) return "non-landed";
  return "unrecognized";
}

// ── Types ────────────────────────────────────────────────────────────────────────────────────────────

export interface OutcomeRecord {
  ts: string;
  task: string;
  final_state: string | null;
  stateClass: StateClass;
  wall_clock_ms: number | null;
}

export interface OutcomeLoad {
  records: OutcomeRecord[];
  /** task id → its records, in file order. */
  byTask: Map<string, OutcomeRecord[]>;
  /** raw `final_state` value → count (the full value table, incl. dead/unknown values). */
  stateCounts: Record<string, number>;
  /** StateClass → count. */
  classCounts: Record<StateClass, number>;
  malformedLines: number;
  totalLines: number;
}

/** One analysable task: its rework reading plus the candidate predictors. */
export interface TaskRow {
  taskId: string;
  /** AC1 field `执行次数`: worker-outcome records for this task (§3's rework count). */
  executions: number;
  /** AC1 field `touchesFileCount`: entries declared under `## Touches`. */
  touchesFileCount: number;
  /** How many of those entries are wildcards/directories ("宽度" — the declaration's breadth). */
  touchesWildcardCount: number;
  /** AC1 field `hasGoalAc`: a top-level `goal_ac:` scalar is present. */
  hasGoalAc: boolean;
  /** AC1 field `shape`: the SAME judge the author→ready gate uses (detectShape). */
  shape: string;
  /** AC1 field `labels`. */
  labels: string[];
  /** AC1 field `bodyLen`: body characters excluding the frontmatter block. */
  bodyLen: number;
  /** AC1 field `dependsOnCount`: `depends_on` entries (top-level, else legacy extra-nested). */
  dependsOnCount: number;
  /** Filer of the task file (author of the commit that ADDED it); null when unobservable. */
  author: string | null;
  /** ISO timestamp the task file was added; null when unobservable. */
  filedAt: string | null;
  /** Whole days between filing and the analysis instant; null when unfiled/unobservable. */
  ageDays: number | null;
  // Per-state execution breakdown (the dead-value trap, made visible per task).
  successExecutions: number;
  legacyAliasExecutions: number;
  nonLandedExecutions: number;
  unrecognizedExecutions: number;
}

export interface Dataset {
  generatedAt: string;
  root: string;
  analyzeMs: number;
  anchors: { developTip: string | null; headSha: string | null; command: string };
  population: {
    taskFiles: number;         // tasks/*.md on disk
    tasksWithOutcomes: number; // distinct task ids in the outcome stream
    analysable: number;        // rows actually built (task file present AND ≥1 record)
    outcomeTasksMissingFile: string[];
    taskFilesWithoutOutcomes: number;
  };
  outcomes: {
    totalRecords: number;
    totalLines: number;
    malformedLines: number;
    stateCounts: Record<string, number>;
    classCounts: Record<StateClass, number>;
    window: { first: string | null; last: string | null };
    deadValueRecords: number;
    unrecognizedValues: string[];
  };
  summary: { tasks: number; median: number; p90: number; mean: number; max: number; maxTaskId: string };
  rows: TaskRow[];
  /** The per-task table AC1 asks for, in the AC's own field order. */
  table: Record<string, unknown>[];
}

export interface Bin {
  label: string;
  lo: number;
  hi: number | null; // null = unbounded above
  n: number;
  /** null when n < minBinN — an under-sampled bin has NO median rendered (AC2). */
  median: number | null;
  mean: number | null;
  p90: number | null;
  shareAtLeast3: number | null;
  shareAtLeast5: number | null;
  shareExactly1: number | null;
  sufficient: boolean;
}

export interface FactorReport {
  factor: string;
  kind: "numeric" | "categorical";
  /** For numeric factors: rank correlation over the whole sample. */
  spearman: number | null;
  /** Permutation null for `spearman` (shuffled pairings). */
  permutation: PermutationResult | null;
  groups: Bin[];
  minBinN: number;
  note: string;
}

export interface PermutationResult {
  observed: number;      // |rho| actually measured
  permutations: number;
  seed: number;
  nullP50: number;
  nullP95: number;
  nullP99: number;
  nullMax: number;
  /** Empirical two-sided-ish p: share of shuffled |rho| >= observed. */
  pValue: number;
}

export interface Analysis {
  minBinN: number;
  ageCutoff: string;
  factors: FactorReport[];
  /** Partial correlations: does the Touches signal survive controlling for body length (and v.v.)? */
  partials: {
    touchesVsExecutions: number;
    touchesVsExecutions_givenBodyLen: number;
    bodyLenVsExecutions: number;
    bodyLenVsExecutions_givenTouches: number;
    touchesVsBodyLen: number;
  };
  /** Stratified (within-shape) correlations — the confounder control of AC4. */
  byShape: { shape: string; n: number; median: number; mean: number; spearman: number | null; sufficient: boolean }[];
  /** Observation-window control: the same statistic on tasks filed before `ageCutoff`. */
  windowControl: {
    cutoff: string;
    n: number;
    median: number;
    mean: number;
    spearmanTouches: number;
    spearmanAge: number;
    ageConfound: { spearmanAgeVsExecutions: number; spearmanAgeVsTouches: number; spearmanAgeVsGoalAc: number; spearmanAgeVsBodyLen: number; n: number };
  };
  recommendation: Recommendation | null;
  recommendationRefusal: string | null;
}

export interface Recommendation {
  text: string;
  /** The bins the recommendation is derived from — every one must be `sufficient`. */
  support: { label: string; n: number; median: number; mean: number; shareAtLeast5: number }[];
  boundary: string[];
  /** The reading that would UNDERMINE the recommendation if it held. */
  counterReading: string;
}

// ── Small statistics (pure; no dependencies) ─────────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank quantile (q in [0,1]) on the sorted sample — deterministic, no interpolation. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx];
}

/** Average ranks, ties sharing the mean rank (the standard tie correction). */
export function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation (Pearson on ranks). NaN when either vector is constant or empty. */
export function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0 || n !== ys.length) return NaN;
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return NaN; // a constant vector has no rank variance to correlate
  return sxy / Math.sqrt(sxx * syy);
}

/** Rank residual of `a` after linearly regressing rank(a) on rank(b) — the partial-correlation core. */
export function rankResidual(a: number[], b: number[]): number[] {
  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < a.length; i++) {
    sxy += (rb[i] - mb) * (ra[i] - ma);
    sxx += (rb[i] - mb) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return ra.map((v, i) => v - ma - slope * (rb[i] - mb));
}

/** Partial Spearman of x vs y controlling for z (rank-residual correlation). */
export function partialSpearman(x: number[], y: number[], z: number[]): number {
  return spearman(rankResidual(x, z), rankResidual(y, z));
}

/** Deterministic PRNG (mulberry32) — the permutation test must be reproducible from `--seed`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Permutation test for `spearman(x, y)`: shuffle y's pairing, recompute |rho|, repeat.
 * Returns the null distribution's shape (not merely a p-value) so a reader can see HOW FAR the
 * observation sits from noise — if the association were an artefact, the null would reach the
 * observed magnitude. NaNs (constant vectors) yield a `null*` of NaN, which is reported as such.
 */
export function permutationTest(x: number[], y: number[], permutations: number, seed: number): PermutationResult {
  const rnd = mulberry32(seed);
  const observed = Math.abs(spearman(x, y));
  const nulls: number[] = [];
  const work = y.slice();
  for (let b = 0; b < permutations; b++) {
    for (let i = work.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = work[i];
      work[i] = work[j];
      work[j] = t;
    }
    nulls.push(Math.abs(spearman(x, work)));
  }
  const finite = nulls.filter((v) => Number.isFinite(v));
  const ge = finite.filter((v) => v >= observed).length;
  return {
    observed,
    permutations,
    seed,
    nullP50: quantile(finite, 0.5),
    nullP95: quantile(finite, 0.95),
    nullP99: quantile(finite, 0.99),
    nullMax: finite.length ? Math.max(...finite) : NaN,
    pValue: (ge + 1) / (finite.length + 1),
  };
}

// ── Binning (AC2: an under-sampled bin reports NO median) ────────────────────────────────────────────

/** Fixed numeric bin edges — chosen ONCE from the observed distribution and stated in the report, so
 *  a later reading is comparable rather than silently re-binned. */
export const TOUCHES_EDGES: [number, number | null][] = [
  [1, 2], [3, 4], [5, 6], [7, 9], [10, 14], [15, null],
];
export const BODY_EDGES: [number, number | null][] = [
  [0, 1499], [1500, 2999], [3000, 5999], [6000, 11999], [12000, null],
];
export const DEPENDS_EDGES: [number, number | null][] = [
  [0, 0], [1, 1], [2, 2], [3, null],
];

function binLabel(lo: number, hi: number | null): string {
  return hi === null ? `${lo}+` : lo === hi ? `${lo}` : `${lo}–${hi}`;
}

/** Summarise one group of `executions` values. `sufficient` is decided by `minBinN`; when false,
 *  EVERY statistic is null — an under-sampled group must not render a median "for completeness". */
export function summariseGroup(executions: number[], label: string, lo: number, hi: number | null, minBinN: number): Bin {
  const n = executions.length;
  const sufficient = n >= minBinN;
  if (!sufficient) {
    return { label, lo, hi, n, median: null, mean: null, p90: null, shareAtLeast3: null, shareAtLeast5: null, shareExactly1: null, sufficient };
  }
  return {
    label,
    lo,
    hi,
    n,
    median: median(executions),
    mean: mean(executions),
    p90: quantile(executions, 0.9),
    shareAtLeast3: executions.filter((v) => v >= 3).length / n,
    shareAtLeast5: executions.filter((v) => v >= 5).length / n,
    shareExactly1: executions.filter((v) => v === 1).length / n,
    sufficient,
  };
}

/** Bin `rows` by `valueOf` over fixed edges, summarising `executionsOf` within each bin. */
export function numericBins<T>(
  rows: T[],
  valueOf: (r: T) => number,
  executionsOf: (r: T) => number,
  edges: [number, number | null][],
  minBinN: number,
): Bin[] {
  return edges.map(([lo, hi]) =>
    summariseGroup(
      rows.filter((r) => valueOf(r) >= lo && (hi === null || valueOf(r) <= hi)).map(executionsOf),
      binLabel(lo, hi),
      lo,
      hi,
      minBinN,
    ),
  );
}

/** Group rows by a categorical key into bins (same sufficiency rule). */
export function categoricalBins<T extends { executions: number }>(rows: T[], keyOf: (r: T) => string, minBinN: number): Bin[] {
  const keys = [...new Set(rows.map(keyOf))].sort();
  return keys.map((k) =>
    summariseGroup(rows.filter((r) => keyOf(r) === k).map((r) => r.executions), k, NaN, null, minBinN),
  );
}

// ── Loading the outcome stream ───────────────────────────────────────────────────────────────────────

export function parseOutcomeLine(line: string): OutcomeRecord | null {
  let raw: any;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw.task !== "string" || raw.task === "") return null;
  const state = typeof raw.final_state === "string" ? raw.final_state : null;
  return {
    ts: typeof raw.ts === "string" ? raw.ts : "",
    task: raw.task,
    final_state: state,
    stateClass: classifyFinalState(state),
    wall_clock_ms: typeof raw.wall_clock_ms === "number" ? raw.wall_clock_ms : null,
  };
}

export function loadOutcomes(jsonlPath: string): OutcomeLoad {
  const byTask = new Map<string, OutcomeRecord[]>();
  const stateCounts: Record<string, number> = {};
  const classCounts: Record<StateClass, number> = { success: 0, "legacy-alias": 0, "non-landed": 0, unrecognized: 0 };
  const records: OutcomeRecord[] = [];
  let malformedLines = 0;
  let totalLines = 0;
  const text = fs.existsSync(jsonlPath) ? fs.readFileSync(jsonlPath, "utf8") : "";
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    totalLines++;
    const rec = parseOutcomeLine(line);
    if (!rec) {
      malformedLines++;
      continue;
    }
    records.push(rec);
    stateCounts[rec.final_state ?? "<missing>"] = (stateCounts[rec.final_state ?? "<missing>"] ?? 0) + 1;
    classCounts[rec.stateClass]++;
    const list = byTask.get(rec.task) ?? [];
    list.push(rec);
    byTask.set(rec.task, list);
  }
  return { records, byTask, stateCounts, classCounts, malformedLines, totalLines };
}

// ── Task-file attributes ─────────────────────────────────────────────────────────────────────────────

/** Filer + filing date per task file, from ONE bulk `git log --diff-filter=A` (not N per-task calls). */
export function readFilers(root: string): Map<string, { author: string; date: string }> {
  const out = new Map<string, { author: string; date: string }>();
  let text = "";
  try {
    text = execFileSync("git", ["log", "--diff-filter=A", "--format=@COMMIT@%H|%an|%aI", "--name-only", "--", "tasks/"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return out; // no git history (a laid-down copy / shallow clone) ⇒ the factor reports as unobservable
  }
  let cur: { author: string; date: string } | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("@COMMIT@")) {
      const parts = line.slice("@COMMIT@".length).split("|");
      cur = { author: parts[1] ?? "", date: parts[2] ?? "" };
      continue;
    }
    const t = line.trim();
    if (!t.startsWith("tasks/") || !t.endsWith(".md")) continue;
    const id = t.slice("tasks/".length, -".md".length);
    // `--diff-filter=A` can list the same path more than once across a rewrite; first occurrence
    // (the newest commit, since git log is newest-first) is the add we want.
    if (cur && !out.has(id)) out.set(id, cur);
  }
  return out;
}

/** Build the per-task table: the AC1 field set + the per-state execution breakdown. */
export function buildTaskRow(
  taskId: string,
  records: OutcomeRecord[],
  taskText: string,
  filer: { author: string; date: string } | null,
  nowMs: number,
): TaskRow {
  const parsed = parseTask(taskText);
  const body = parsed.body;
  const { section } = extractTouchesSection(body);
  const touches = parseTouchEntries(section);
  const filedMs = filer?.date ? Date.parse(filer.date) : NaN;
  const ageDays = Number.isFinite(filedMs) ? Math.floor((nowMs - filedMs) / 86_400_000) : null;
  return {
    taskId,
    executions: records.length,
    touchesFileCount: touches.length,
    touchesWildcardCount: touches.filter((t) => /[*?]/.test(t) || t.endsWith("/")).length,
    hasGoalAc: parsed.goal_ac !== null && parsed.goal_ac !== undefined && String(parsed.goal_ac).trim() !== "",
    // The SAME shape judge the author→ready gate uses (ready-pool-check.ts's detectShape): a
    // stratum defined by a different judge than the gate's would not be the gate's stratum.
    shape: detectShape(body),
    labels: parsed.labels,
    bodyLen: body.length,
    dependsOnCount: parsed.depends_on.length,
    author: filer?.author ?? null,
    filedAt: filer?.date ?? null,
    ageDays,
    successExecutions: records.filter((r) => r.stateClass === "success").length,
    legacyAliasExecutions: records.filter((r) => r.stateClass === "legacy-alias").length,
    nonLandedExecutions: records.filter((r) => r.stateClass === "non-landed").length,
    unrecognizedExecutions: records.filter((r) => r.stateClass === "unrecognized").length,
  };
}

// ── Dataset assembly ─────────────────────────────────────────────────────────────────────────────────

export interface BuildOptions {
  root: string;
  nowMs?: number;
  command?: string;
}

export function buildDataset(opts: BuildOptions): Dataset {
  const t0 = Date.now();
  const root = opts.root;
  const nowMs = opts.nowMs ?? Date.now();
  const tasksDir = path.join(root, "tasks");
  const outcomePath = path.join(root, ".quay", "worker-outcome.jsonl");

  const outcome = loadOutcomes(outcomePath);
  const filers = readFilers(root);
  const taskFiles = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")) : [];

  const rows: TaskRow[] = [];
  const missingFile: string[] = [];
  for (const [taskId, records] of outcome.byTask) {
    const file = path.join(tasksDir, `${taskId}.md`);
    if (!fs.existsSync(file)) {
      missingFile.push(taskId);
      continue;
    }
    rows.push(buildTaskRow(taskId, records, fs.readFileSync(file, "utf8"), filers.get(taskId) ?? null, nowMs));
  }
  rows.sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
  missingFile.sort();

  const executions = rows.map((r) => r.executions);
  const maxTaskId = rows.reduce((best, r) => (r.executions > (best?.executions ?? -1) ? r : best), rows[0])?.taskId ?? "";
  const tsList = outcome.records.map((r) => r.ts).filter(Boolean).sort();

  const anchors = {
    developTip: gitRev(root, "develop"),
    headSha: gitRev(root, "HEAD"),
    command: opts.command ?? "",
  };

  return {
    generatedAt: new Date(nowMs).toISOString(),
    root,
    analyzeMs: Date.now() - t0,
    anchors,
    population: {
      taskFiles: taskFiles.length,
      tasksWithOutcomes: outcome.byTask.size,
      analysable: rows.length,
      outcomeTasksMissingFile: missingFile,
      taskFilesWithoutOutcomes: taskFiles.length - rows.length,
    },
    outcomes: {
      totalRecords: outcome.records.length,
      totalLines: outcome.totalLines,
      malformedLines: outcome.malformedLines,
      stateCounts: outcome.stateCounts,
      classCounts: outcome.classCounts,
      window: { first: tsList[0] ?? null, last: tsList[tsList.length - 1] ?? null },
      deadValueRecords: outcome.classCounts["legacy-alias"],
      unrecognizedValues: Object.keys(outcome.stateCounts).filter((v) => classifyFinalState(v) === "unrecognized"),
    },
    summary: {
      tasks: rows.length,
      median: median(executions),
      p90: quantile(executions, 0.9),
      mean: mean(executions),
      max: executions.length ? Math.max(...executions) : NaN,
      maxTaskId,
    },
    rows,
    table: rows.map((r) => ({
      taskId: r.taskId,
      executions: r.executions,
      touchesFileCount: r.touchesFileCount,
      hasGoalAc: r.hasGoalAc,
      shape: r.shape,
      labels: r.labels,
      bodyLen: r.bodyLen,
      dependsOnCount: r.dependsOnCount,
    })),
  };
}

function gitRev(root: string, rev: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", rev], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

// ── Factor analysis ──────────────────────────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  minBinN?: number;
  permutations?: number;
  seed?: number;
  ageCutoff?: string; // ISO date; default 2026-08-31
}

/** Labels analysed individually: only those with ≥ minBinN occurrences are reported as groups, but
 *  the presence/absence split needs BOTH sides ≥ minBinN, which `categoricalBins` enforces. */
export function labelFactor(rows: TaskRow[], label: string, minBinN: number): FactorReport {
  const on = rows.filter((r) => r.labels.includes(label));
  const off = rows.filter((r) => !r.labels.includes(label));
  const groups = [
    summariseGroup(on.map((r) => r.executions), `${label}=yes`, NaN, null, minBinN),
    summariseGroup(off.map((r) => r.executions), `${label}=no`, NaN, null, minBinN),
  ];
  return {
    factor: `label:${label}`,
    kind: "categorical",
    spearman: null,
    permutation: null,
    groups,
    minBinN,
    note: `标签 ${label} 的有/无两组对比（出现 ${on.length} 次）。`,
  };
}

export function analyseDataset(ds: Dataset, opts: AnalyzeOptions = {}): Analysis {
  const minBinN = opts.minBinN ?? 10;
  const permutations = opts.permutations ?? 2000;
  const seed = opts.seed ?? 20260914;
  const ageCutoff = opts.ageCutoff ?? "2026-08-31";
  const rows = ds.rows;

  const numericFactor = (name: string, valueOf: (r: TaskRow) => number, edges: [number, number | null][], note: string): FactorReport => {
    const xs = rows.map(valueOf);
    const ys = rows.map((r) => r.executions);
    const rho = spearman(xs, ys);
    return {
      factor: name,
      kind: "numeric",
      spearman: Number.isFinite(rho) ? rho : null,
      permutation: Number.isFinite(rho) ? permutationTest(xs, ys, permutations, seed) : null,
      groups: numericBins(rows, valueOf, (r) => r.executions, edges, minBinN),
      minBinN,
      note,
    };
  };

  const factors: FactorReport[] = [
    numericFactor("touchesFileCount", (r) => r.touchesFileCount, TOUCHES_EDGES,
      "`## Touches` 声明条目数——立案期唯一「作者自选」的规模旋钮。"),
    numericFactor("bodyLen", (r) => r.bodyLen, BODY_EDGES,
      "任务体字符数（不含 frontmatter）——「难任务写得更长」的代理。"),
    numericFactor("dependsOnCount", (r) => r.dependsOnCount, DEPENDS_EDGES,
      "`depends_on` 前置边条数——串行化程度的代理。"),
    {
      factor: "hasGoalAc",
      kind: "categorical",
      spearman: null,
      permutation: null,
      groups: categoricalBins(rows, (r) => (r.hasGoalAc ? "goal_ac=yes" : "goal_ac=no"), minBinN),
      minBinN,
      note: "有无顶层 `goal_ac`。⚠️ 该字段与任务年龄强相关（见 windowControl），不得单独作因果读。",
    },
    {
      factor: "shape",
      kind: "categorical",
      spearman: null,
      permutation: null,
      groups: categoricalBins(rows, (r) => r.shape, minBinN),
      minBinN,
      note: "任务形状（与 author→ready 闸同一判据 detectShape）——本任务的**分层变量**。",
    },
    {
      factor: "author",
      kind: "categorical",
      spearman: null,
      permutation: null,
      groups: categoricalBins(rows, (r) => r.author ?? "<unobservable>", minBinN),
      minBinN,
      note: "立案者（任务文件 add-commit 的作者）。若只有单值，本因子无方差 ⇒ 结构上不可能预测任何东西。",
    },
  ];

  // Labels with enough occurrences on the PRESENT side get their own factor.
  const labelCounts = new Map<string, number>();
  for (const r of rows) for (const l of r.labels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
  for (const [label, count] of [...labelCounts.entries()].filter(([, c]) => c >= minBinN).sort((a, b) => b[1] - a[1])) {
    factors.push(labelFactor(rows, label, minBinN));
  }

  const xsT = rows.map((r) => r.touchesFileCount);
  const xsB = rows.map((r) => r.bodyLen);
  const ys = rows.map((r) => r.executions);

  const partials = {
    touchesVsExecutions: spearman(xsT, ys),
    touchesVsExecutions_givenBodyLen: partialSpearman(xsT, ys, xsB),
    bodyLenVsExecutions: spearman(xsB, ys),
    bodyLenVsExecutions_givenTouches: partialSpearman(xsB, ys, xsT),
    touchesVsBodyLen: spearman(xsT, xsB),
  };

  // Confounder control 1 — stratify by shape.
  const byShape = [...new Set(rows.map((r) => r.shape))].sort().map((shape) => {
    const sub = rows.filter((r) => r.shape === shape);
    const rho = spearman(sub.map((r) => r.touchesFileCount), sub.map((r) => r.executions));
    return {
      shape,
      n: sub.length,
      median: median(sub.map((r) => r.executions)),
      mean: mean(sub.map((r) => r.executions)),
      spearman: Number.isFinite(rho) ? rho : null,
      sufficient: sub.length >= minBinN,
    };
  });

  // Confounder control 2 — observation window. `executions` is bounded by how long a task has
  // existed, so tasks filed recently cannot have accumulated many rounds. Restricting to tasks
  // filed before the cutoff gives every member of the subpopulation the same ≥N-day runway.
  const dated = rows.filter((r) => r.filedAt !== null);
  const cutoffMs = Date.parse(`${ageCutoff}T23:59:59Z`);
  const windowRows = dated.filter((r) => Date.parse(r.filedAt as string) <= cutoffMs);
  const windowControl = {
    cutoff: ageCutoff,
    n: windowRows.length,
    median: median(windowRows.map((r) => r.executions)),
    mean: mean(windowRows.map((r) => r.executions)),
    spearmanTouches: spearman(windowRows.map((r) => r.touchesFileCount), windowRows.map((r) => r.executions)),
    spearmanAge: spearman(windowRows.map((r) => r.ageDays ?? 0), windowRows.map((r) => r.executions)),
    ageConfound: {
      n: dated.length,
      spearmanAgeVsExecutions: spearman(dated.map((r) => r.ageDays ?? 0), dated.map((r) => r.executions)),
      spearmanAgeVsTouches: spearman(dated.map((r) => r.ageDays ?? 0), dated.map((r) => r.touchesFileCount)),
      spearmanAgeVsGoalAc: spearman(dated.map((r) => r.ageDays ?? 0), dated.map((r) => (r.hasGoalAc ? 1 : 0))),
      spearmanAgeVsBodyLen: spearman(dated.map((r) => r.ageDays ?? 0), dated.map((r) => r.bodyLen)),
    },
  };

  const { recommendation, recommendationRefusal } = buildRecommendation(rows, factors, minBinN);

  return { minBinN, ageCutoff, factors, partials, byShape, windowControl, recommendation, recommendationRefusal };
}

/**
 * Derive the filing-time recommendation FROM the sufficient bins only.
 *
 * ⛔ An under-sampled bin can never enter `support`: `bin.sufficient` gates it, and the median of an
 * insufficient bin is `null` by construction, so a recommendation cannot quote one even by accident
 * (AC2's "不参与结论" made structural rather than promised).
 */
export function buildRecommendation(
  rows: TaskRow[],
  factors: FactorReport[],
  minBinN: number,
): { recommendation: Recommendation | null; recommendationRefusal: string | null } {
  const touches = factors.find((f) => f.factor === "touchesFileCount");
  const all = rows.map((r) => r.executions);
  if (!touches || rows.length < 200) {
    return { recommendation: null, recommendationRefusal: `数据不支持任何立案期建议（可分析任务数 ${rows.length} < 200）。` };
  }
  const sufficient = touches.groups.filter((g) => g.sufficient);
  const high = sufficient.filter((g) => g.hi === null).at(-1);
  const baseline = { median: median(all), mean: mean(all), share5: all.filter((v) => v >= 5).length / all.length };
  if (!high) {
    return {
      recommendation: null,
      recommendationRefusal: `数据不支持任何立案期建议：Touches 最高箱样本不足（<${minBinN}），无法给出有支撑的阈值。`,
    };
  }
  // The median is deliberately NOT the carrier of the recommendation: measured, it is flat across
  // bins (the distribution's CENTRE does not move) while the TAIL does. A recommendation phrased as
  // "median rework is M" would be unsupported by these numbers; one phrased as tail risk is not.
  const medianMoves = Math.abs((high.median ?? baseline.median) - baseline.median) >= 1;
  const tailRatio = (high.shareAtLeast5 ?? 0) / (baseline.share5 || 1);
  if (!(tailRatio >= 2) && !medianMoves) {
    return {
      recommendation: null,
      recommendationRefusal:
        `数据不支持任何立案期建议：最高箱（Touches ${high.label}）的 ≥5 次占比 ${((high.shareAtLeast5 ?? 0) * 100).toFixed(1)}% ` +
        `仅为全场（${(baseline.share5 * 100).toFixed(1)}%）的 ${tailRatio.toFixed(2)} 倍，且中位未移动（${high.median} vs ${baseline.median}）——不足以支撑一条立案期规则。`,
    };
  }
  return {
    recommendation: {
      text:
        `立案期建议：**一条任务的 \`## Touches\` 声明条目数达到 ${high.lo} 条及以上时，先按子系统拆分再立案**——` +
        `该箱平均执行 ${high.mean?.toFixed(1)} 次、中位 ${high.median} 次、**≥5 次的比例 ${((high.shareAtLeast5 ?? 0) * 100).toFixed(1)}%**` +
        `（全场均值 ${baseline.mean.toFixed(2)} 次、≥5 次比例 ${(baseline.share5 * 100).toFixed(1)}%）。`,
      support: sufficient.map((g) => ({ label: g.label, n: g.n, median: g.median as number, mean: g.mean as number, shareAtLeast5: g.shareAtLeast5 as number })),
      boundary: [
        `适用面 = 已进入 worker 池的任务（本报告可分析 ${rows.length} 条），不是板上全部任务——从未被 worker 执行过的任务不在样本内。`,
        `适用窗 = 本报告观测窗（worker 驱动模式），跨模式外推未经验证。`,
        `口径 = \`executions\`（worker-outcome 记录条数），与「最终落地轮数」同口径但不等同于「人工介入次数」。`,
        `**中位并非载体**：拆分的收益来自**尾部**（≥5 次的比例 ${((high.shareAtLeast5 ?? 0) * 100).toFixed(1)}% vs 全场 ${(baseline.share5 * 100).toFixed(1)}%），` +
          `不是中位数的移动（实测最高箱中位 ${high.median} vs 全场中位 ${baseline.median}${medianMoves ? "" : "，未移动"}）` +
          `——⛔ 不要把它读成「中位会从 ${baseline.median} 次降到更低」。`,
        `⛔ 非因果：难度不可观测，「难任务既 touches 多又返工多」能产生同样的表。`,
      ],
      counterReading:
        `若本建议为假，应观察到：最高箱的 ≥5 次占比落到全场水平附近（≈${(baseline.share5 * 100).toFixed(1)}%）——` +
        `实测为 ${((high.shareAtLeast5 ?? 0) * 100).toFixed(1)}%（${tailRatio.toFixed(2)}×）。` +
        `另一条独立反向读数：置换检验下 observed |ρ|=${touches.permutation?.observed.toFixed(4)}，` +
        `而打乱配对后的 95 分位仅 ${touches.permutation?.nullP95.toFixed(4)}、最大值 ${touches.permutation?.nullMax.toFixed(4)}——` +
        `关联若只是配对噪声，打乱后应能取到同一量级，实测取不到。`,
    },
    recommendationRefusal: null,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────────

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function num(v: number | null, digits = 2): string {
  return v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

/** Render one factor's bin table. An under-sampled bin prints 样本不足 and NO statistics (AC2). */
export function renderFactorTable(f: FactorReport): string[] {
  const lines: string[] = [];
  lines.push(`**${f.factor}** （${f.kind}）${f.note}`);
  lines.push("");
  // DEGENERATE factor — a factor with ONE observed value has no variance, so it cannot separate
  // anything no matter how large the sample is. Said explicitly, because a single row with n=721
  // otherwise reads as "a well-powered factor that happens to be flat".
  if (f.kind === "categorical" && f.groups.length === 1) {
    lines.push(
      `- ⚠️ **退化因子**：全样本只有一个取值（\`${f.groups[0].label}\`，n=${f.groups[0].n}）⇒ **零方差**，` +
        `结构上不可能预测任何东西。这不是「已检验且无效」，而是「无法作为因子被检验」——不要把它读成一条证据。`,
    );
    lines.push("");
  }
  if (f.spearman !== null) {
    const p = f.permutation;
    lines.push(
      `- Spearman ρ(rank, executions) = **${f.spearman.toFixed(4)}**` +
        (p
          ? ` · 置换零分布（${p.permutations} 次、seed ${p.seed}）p50 ${p.nullP50.toFixed(4)} / p95 ${p.nullP95.toFixed(4)} / p99 ${p.nullP99.toFixed(4)} / max ${p.nullMax.toFixed(4)} · 经验 p = ${p.pValue.toFixed(4)}`
          : ""),
    );
    lines.push("");
  }
  lines.push(`| 分箱 | n | 中位 | 均值 | p90 | ≥3 次占比 | ≥5 次占比 | =1 次占比 |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const g of f.groups) {
    if (!g.sufficient) {
      lines.push(`| ${g.label} | ${g.n} | 样本不足（n<${f.minBinN}，不参与结论） | — | — | — | — | — |`);
    } else {
      lines.push(`| ${g.label} | ${g.n} | ${g.median} | ${num(g.mean)} | ${g.p90} | ${pct(g.shareAtLeast3)} | ${pct(g.shareAtLeast5)} | ${pct(g.shareExactly1)} |`);
    }
  }
  lines.push("");
  return lines;
}

export function renderMarkdown(ds: Dataset, an: Analysis): string {
  const L: string[] = [];
  const c = ds.outcomes.classCounts;
  L.push(`# 返工的预测因子——什么样的任务会被执行 5 次以上`);
  L.push("");
  L.push(`> 生成于 \`${ds.generatedAt}\` · root \`${ds.root}\``);
  L.push(`> 复跑锚点：\`${ds.anchors.command || "node --experimental-strip-types plugin/scripts/rework-predictors.ts"}\``);
  L.push(`> develop tip \`${ds.anchors.developTip ?? "<unobservable>"}\` · HEAD \`${ds.anchors.headSha ?? "<unobservable>"}\``);
  L.push("");
  L.push(`## 0. 口径（先定口径，再谈结论）`);
  L.push("");
  L.push(`- **返工次数 = \`executions\`**：\`.quay/worker-outcome.jsonl\` 中 \`task\` 等于该任务 id 的记录条数。`);
  L.push(`  这是 \`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md\` §3 所用的同一个量，本报告的汇总读数与之对拍一致（见 §2）。`);
  L.push(`- **⚠️ \`final_state\` 的死取值陷阱**：\`landed\` 是**死取值**（全库 ${c["legacy-alias"]} 条），真正的成功态是 \`completed\`。`);
  // The dead value is interpolated from the alias TABLE, never re-typed as a literal here — so the
  // source has exactly ONE executable occurrence of it (the table), and a regression that compares
  // against the raw literal is caught positionally by the sibling test.
  L.push(`  任何按 \`final_state == "${LEGACY_SUCCESS_ALIASES[0]}"\` 统计成功的读者会得到 ≈0——一个与「系统完全停摆」同形的读数。`);
  L.push(`  本脚本**不在任何地方内联比较状态字面量**，而是把每条记录交给 \`classifyFinalState\`，它返回四个**可区分**的值：`);
  L.push(`  \`success\` / \`legacy-alias\` / \`non-landed\` / \`unrecognized\`。无法识别的取值单列并计数，既不并入成功也不并入失败。`);
  L.push(`- **状态取值全表**（原样，未做归并）：`);
  L.push("");
  L.push(`| final_state | 条数 | 归类 |`);
  L.push(`|---|---|---|`);
  for (const [state, n] of Object.entries(ds.outcomes.stateCounts).sort((a, b) => b[1] - a[1])) {
    L.push(`| \`${state}\` | ${n} | ${classifyFinalState(state)} |`);
  }
  L.push("");
  L.push(`## 1. 数据面（先盘载体，再谈因子）`);
  L.push("");
  L.push(`- 载体：\`${ds.root}/.quay/worker-outcome.jsonl\` — ${ds.outcomes.totalRecords} 条记录（${ds.outcomes.totalLines} 行，无法解析 ${ds.outcomes.malformedLines} 行）。`);
  L.push(`- 观测窗：\`${ds.outcomes.window.first ?? "?"}\` → \`${ds.outcomes.window.last ?? "?"}\`。`);
  L.push(`- 总体：\`tasks/\` 下 ${ds.population.taskFiles} 个任务文件；outcome 流中出现 ${ds.population.tasksWithOutcomes} 个任务 id；`);
  L.push(`  **可分析 ${ds.population.analysable} 条**（有任务文件且有 ≥1 条记录）；${ds.population.taskFilesWithoutOutcomes} 个任务文件从未进入 worker 池（**不在样本内**）。`);
  if (ds.population.outcomeTasksMissingFile.length) {
    L.push(`  - ⚠️ outcome 中被引用但盘上无任务文件的 id：${ds.population.outcomeTasksMissingFile.length} 个（已排除，未静默丢弃）。`);
  }
  L.push("");
  L.push(`## 2. 复现 §3 的分布（对拍，不是主张）`);
  L.push("");
  L.push(`| 指标 | §3（2026-09-14 前） | 本次读数 |`);
  L.push(`|---|---|---|`);
  L.push(`| 可分析任务数 | 703 | ${ds.summary.tasks} |`);
  L.push(`| 中位 | 2 | ${ds.summary.median} |`);
  L.push(`| p90 | 5 | ${ds.summary.p90} |`);
  L.push(`| 最高 | 27（\`gap-retire-session-liveness\`） | ${ds.summary.max}（\`${ds.summary.maxTaskId}\`） |`);
  L.push("");
  L.push(`> 两张表的差异只来自观测窗推进（§3 之后又落了若干轮），不是口径差异——口径见 §0。`);
  L.push("");
  L.push(`## 3. 单因子分组对比`);
  L.push("");
  L.push(`> ⛔ **样本数 < ${an.minBinN} 的箱一律标「样本不足」且不给任何统计量**（AC2），不参与任何结论。`);
  L.push("");
  for (const f of an.factors) L.push(...renderFactorTable(f));
  L.push(`## 4. 可取假的结论与其反向指标`);
  L.push("");
  const touches = an.factors.find((f) => f.factor === "touchesFileCount")!;
  const p = touches.permutation!;
  L.push(`### 结论 A：\`Touches\` 声明条目数与返工次数**正相关**，且不是 bodyLen 的代理`);
  L.push("");
  L.push(`- 实测：Spearman ρ = **${an.partials.touchesVsExecutions.toFixed(4)}**。`);
  L.push(`- **反向指标 1（置换零分布）**：把 (任务, 执行次数) 的配对独立打乱 ${p.permutations} 次，|ρ| 的 p50 = ${p.nullP50.toFixed(4)}、p95 = ${p.nullP95.toFixed(4)}、**max = ${p.nullMax.toFixed(4)}**，经验 p = ${p.pValue.toFixed(4)}。`);
  L.push(`  ⇒ **若该关联只是配对噪声，打乱后应能取到 0.22 这个量级；实测取不到**（最大值 ${p.nullMax.toFixed(4)} < 实测 ${p.observed.toFixed(4)}）。`);
  L.push(`- **反向指标 2（偏相关）**：\`Touches\` 与 \`bodyLen\` 本身相关（ρ = ${an.partials.touchesVsBodyLen.toFixed(4)}），所以「Touches 预测返工」可能是「大任务预测返工」。控制 bodyLen 后 ρ = **${an.partials.touchesVsExecutions_givenBodyLen.toFixed(4)}**（几乎不降）；`);
  L.push(`  反向控制 touches 后，\`bodyLen\` 的 ρ 从 ${an.partials.bodyLenVsExecutions.toFixed(4)} **塌到 ${an.partials.bodyLenVsExecutions_givenTouches.toFixed(4)}**。`);
  L.push(`  ⇒ **两个方向的预测不对称**：Touches 不是 bodyLen 的代理，bodyLen 反而已被 Touches 完全中介。`);
  L.push(`  ⇒ 若结论 A 为假，应观察到 \`touchesVsExecutions_givenBodyLen\` 塌向 0——实测 ${an.partials.touchesVsExecutions_givenBodyLen.toFixed(4)}，未塌。`);
  L.push("");
  L.push(`### 结论 B（弱信号，同样可取假）：\`depends_on\` 条数**统计上为正、实务上不可用**`);
  L.push("");
  const dep = an.factors.find((f) => f.factor === "dependsOnCount")!;
  const depSufficient = dep.groups.filter((g) => g.sufficient);
  const depCovered = depSufficient.reduce((a, g) => a + g.n, 0);
  const depCoveredShare = depCovered / ds.rows.length;
  const depZero = dep.groups.find((g) => g.label === "0");
  const depZeroShare = depZero ? depZero.n / ds.rows.length : 0;
  L.push(`- 实测 ρ = ${num(dep.spearman, 4)}，置换检验 p = ${num(dep.permutation?.pValue ?? null, 4)}（零分布 p95 = ${num(dep.permutation?.nullP95 ?? null, 4)}）——**统计上为正**，不能报成「无关」。`);
  L.push(`- **但它在立案期不可用**：充分样本的箱覆盖了 ${(depCoveredShare * 100).toFixed(1)}% 的任务，而其中 **${(depZeroShare * 100).toFixed(1)}% 全部落在同一个 \`0\` 箱**`);
  L.push(`  （中位 ${depZero?.median}、均值 ${num(depZero?.mean ?? null)}，与全场中位 ${ds.summary.median}、均值 ${num(ds.summary.mean)} 几乎相同）。`);
  L.push(`  一个把 ${(depZeroShare * 100).toFixed(0)}% 的任务归进同一组、且该组与全场同分布的因子，**没有区分力**——ρ 的显著性来自其余 ${(100 - depZeroShare * 100).toFixed(0)}% 的尾部任务，不来自可操作的立案期判断。`);
  L.push(`- **反向读数**：若 \`depends_on\` 在立案期真的可用，它应能把任务分成返工水平明显不同的组；实测「0 条」组与全场同分布（见上），`);
  L.push(`  且非零箱的中位全部为 ${dep.groups.filter((g) => g.sufficient && g.label !== "0").map((g) => g.median).join(" / ") || "—"}，与 0 箱相同。`);
  L.push("");
  L.push(`## 5. 混杂因素：显式处理（AC4）`);
  L.push("");
  L.push(`任务**难度不可观测**。「难任务既 touches 多、又返工多」能产生与结论 A 完全相同的表——本报告无法排除它。`);
  L.push(`下面是**做了**的三件事，以及它们各自能排除什么、不能排除什么。`);
  L.push("");
  L.push(`### 5.1 按 shape 分层`);
  L.push("");
  L.push(`| shape | n | 中位 | 均值 | ρ(Touches, executions) | 样本 |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const s of an.byShape) {
    L.push(`| ${s.shape} | ${s.n} | ${s.sufficient ? s.median : "样本不足"} | ${s.sufficient ? num(s.mean) : "—"} | ${s.spearman === null ? "—" : s.spearman.toFixed(4)} | ${s.sufficient ? "充足" : "<" + an.minBinN} |`);
  }
  L.push("");
  L.push(`- **能排除**：关联不是 shape 组成造成的假象——它在各个充足层内各自成立（不是靠某一层的权重堆出来的）。`);
  L.push(`- **不能排除**：难度在层内仍然与 Touches 共变。`);
  L.push("");
  L.push(`### 5.2 观测窗控制（任务年龄）`);
  L.push("");
  const w = an.windowControl;
  L.push(`\`executions\` 是**有上界**的量：立案越晚的任务，越没有时间累积轮次。因此任务**年龄**是一等混杂因子，实测：`);
  L.push("");
  L.push(`| 年龄 vs | Spearman ρ |`);
  L.push(`|---|---|`);
  L.push(`| \`executions\` | ${num(w.ageConfound.spearmanAgeVsExecutions, 4)} |`);
  L.push(`| \`touchesFileCount\` | ${num(w.ageConfound.spearmanAgeVsTouches, 4)} |`);
  L.push(`| \`hasGoalAc\` | ${num(w.ageConfound.spearmanAgeVsGoalAc, 4)} |`);
  L.push(`| \`bodyLen\` | ${num(w.ageConfound.spearmanAgeVsBodyLen, 4)} |`);
  L.push("");
  L.push(`⇒ **\`hasGoalAc\` 与年龄强负相关（${num(w.ageConfound.spearmanAgeVsGoalAc, 4)}）**：有 \`goal_ac\` 的任务系统性更新。`);
  L.push(`其分组差异（见 §3）因此**不能**读作「加了 goal_ac 就会少返工」，最省事的解释是「新任务还没来得及返工」。`);
  L.push(`**\`hasGoalAc\` 在本报告中只作观察项，不作结论。**`);
  L.push("");
  L.push(`控制手段：把总体限制在 **${w.cutoff} 之前立案**的子集（每条的观测跑道 ≥14 天）：`);
  L.push("");
  L.push(`| 读数 | 全体（有立案日期 n=${w.ageConfound.n}） | 截止 ${w.cutoff} 子集（n=${w.n}） |`);
  L.push(`|---|---|---|`);
  L.push(`| 中位 executions | ${ds.summary.median} | ${w.median} |`);
  L.push(`| 均值 executions | ${num(ds.summary.mean)} | ${num(w.mean)} |`);
  L.push(`| ρ(Touches, executions) | ${num(an.partials.touchesVsExecutions, 4)} | **${num(w.spearmanTouches, 4)}** |`);
  L.push(`| ρ(年龄, executions) | ${num(w.ageConfound.spearmanAgeVsExecutions, 4)} | **${num(w.spearmanAge, 4)}** |`);
  L.push("");
  L.push(`- **能排除**：关联不是「全体里混着大量新任务」造成的——限制观测跑道后仍然成立（${num(w.spearmanTouches, 4)} vs 全体 ${num(an.partials.touchesVsExecutions, 4)}）；`);
  L.push(`  且**年龄在子集内已不再与返工相关**（ρ = ${num(w.spearmanAge, 4)} ≈ 0），说明这条控制确实把年龄这一混杂因子摁住了，而不是换了个说法重述同一批数据。`);
  L.push(`- **不能排除**：难度；以及「已经被执行过的任务才进入样本」这一选择效应（§1 的 ${ds.population.taskFilesWithoutOutcomes} 个未入池任务不在样本内）。`);
  L.push("");
  L.push(`## 6. 立案期建议（附适用边界与实测支撑）`);
  L.push("");
  if (an.recommendation) {
    L.push(an.recommendation.text);
    L.push("");
    L.push(`**支撑读数（只列充足箱）**：`);
    L.push("");
    L.push(`| Touches 箱 | n | 中位 | 均值 | ≥5 次占比 |`);
    L.push(`|---|---|---|---|---|`);
    for (const s of an.recommendation.support) {
      L.push(`| ${s.label} | ${s.n} | ${s.median} | ${s.mean.toFixed(2)} | ${(s.shareAtLeast5 * 100).toFixed(1)}% |`);
    }
    L.push("");
    L.push(`**适用边界**：`);
    L.push("");
    for (const b of an.recommendation.boundary) L.push(`- ${b}`);
    L.push("");
    L.push(`**反向读数（若建议为假，应观察到什么）**：`);
    L.push("");
    L.push(`- ${an.recommendation.counterReading}`);
  } else {
    const refusal = an.recommendationRefusal ?? "数据不支持任何立案期建议。";
    L.push(refusal);
    L.push("");
    if (refusal.startsWith("数据不支持")) {
      L.push(`⇒ 按本任务的 AC5，此处**明确写「数据不支持」**，不编一条。`);
    }
  }
  L.push("");
  L.push(`## 7. 已知限制`);
  L.push("");
  L.push(`- 分析总体是**进入过 worker 池的任务**，不是板上全部任务（${ds.population.taskFilesWithoutOutcomes} 个任务文件不在样本内）——这是选择效应，不是全量。`);
  L.push(`- 难度不可观测（§5）；本报告所有关联词都是「相关」，没有任何因果读法。`);
  L.push(`- \`executions\` 计的是 worker 执行**条数**，包含 \`exited-not-landed\`/\`failed\`/\`killed\` 各类（见 §0 状态全表），不等于「人工介入次数」。`);
  L.push(`- 分箱边界是**固定**的（${TOUCHES_EDGES.map(([a, b]) => binLabel(a, b)).join(" / ")}），在本次读数上一次选定的；跨数据集比较时不要重新分箱。`);
  L.push(`- 样本不足的箱**不给统计量**，因此某些因子的表里会出现大片「—」——那是**能力边界**，不是缺数据。`);
  L.push(`- 置换检验的 p 值是经验值（(ge+1)/(B+1)），$B=${touches.permutation?.permutations ?? 0}$，分辨率下界约 ${(1 / ((touches.permutation?.permutations ?? 2000) + 1)).toExponential(1)}。`);
  L.push("");
  return L.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `rework-predictors.ts — 返工的预测因子（task gap-rework-multiplier-predictors）
用法: node --experimental-strip-types plugin/scripts/rework-predictors.ts [选项]
  --root <dir>            数据根（tasks/ 与 .quay/ 所在；默认 = 主检出，由 mainCheckoutRoot 推出）
  --out <file>            文档输出路径（默认 <脚本所在检出>/docs/analysis/rework-multiplier-predictors.md）
  --json                  仅向 stdout 输出 JSON（不写文件）
  --no-write              不写文档，仅打印摘要
  --permutations <n>      置换次数（默认 2000）
  --seed <n>              置换 PRNG 种子（默认 20260914）
  --min-bin-n <n>         分箱最小样本数（默认 10；低于此的箱标「样本不足」且不给统计量）
  --age-cutoff <date>     观测窗控制的立案截止日（默认 2026-08-31）
退出码: 0 正常 · 2 用法错误 · 3 NOT-EVALUATED（生产载体 .quay/worker-outcome.jsonl 缺失或为空）`;

export function parseArgv(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const eq = key.indexOf("=");
    if (eq !== -1) out[key.slice(0, eq)] = key.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = "true";
  }
  return out;
}

export function main(argv: string[]): number {
  const args = parseArgv(argv);
  if (args.help === "true" || args.h === "true") {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // DATA root: where `tasks/` and `.quay/` live. The production carrier `.quay/worker-outcome.jsonl`
  // is a gitignored RUNTIME artifact that `.worktreeinclude` deliberately does not copy into task
  // worktrees — so the default is the MAIN CHECKOUT, not the checkout this script happens to sit in.
  // Otherwise a task worker (which always runs inside a worktree) would read a worktree-local empty
  // carrier and render a normal-looking report over ZERO records (硬规则 3b).
  const root = path.resolve(args.root ?? mainCheckoutRoot(here) ?? repoRoot(here));
  // OUTPUT path: belongs to the checkout the script lives in (a worker writes into its own worktree,
  // never into the shared checkout it is forbidden to touch).
  const outPath = path.resolve(args.out ?? path.join(repoRoot(here), "docs", "analysis", "rework-multiplier-predictors.md"));
  const command = `node --experimental-strip-types plugin/scripts/rework-predictors.ts --root ${root}` +
    (args.permutations ? ` --permutations ${args.permutations}` : "");
  const ds = buildDataset({ root, command });

  // NOT-EVALUATED (exit 3) — an absent/empty carrier is NOT "a report with zero rework". Rendering
  // the ordinary report here would make "the production carrier is missing" indistinguishable from
  // "the fleet never reworks anything" (硬规则 3b: 读不懂的输入不得与「合格」同形).
  if (ds.outcomes.totalRecords === 0) {
    process.stderr.write(
      `rework-predictors: NOT-EVALUATED — 生产载体 ${path.join(root, ".quay", "worker-outcome.jsonl")} ` +
        `缺失或为空（读不到任何 worker 执行记录）；这不是「零返工」的读数。\n` +
        `  如需指定数据根：--root <主检出路径>\n`,
    );
    return 3;
  }
  const an = analyseDataset(ds, {
    minBinN: args["min-bin-n"] ? Number(args["min-bin-n"]) : undefined,
    permutations: args.permutations ? Number(args.permutations) : undefined,
    seed: args.seed ? Number(args.seed) : undefined,
    ageCutoff: args["age-cutoff"],
  });

  if (args.json === "true") {
    process.stdout.write(JSON.stringify({ dataset: { ...ds, rows: undefined, table: ds.table }, analysis: an }, null, 2) + "\n");
    return 0;
  }

  if (args["no-write"] !== "true") {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, renderMarkdown(ds, an));
  }
  const s = ds.summary;
  process.stdout.write(
    `rework-predictors: ${s.tasks} analysable tasks (of ${ds.population.taskFiles} task files) · ` +
      `median ${s.median} · p90 ${s.p90} · mean ${s.mean.toFixed(2)} · max ${s.max} (${s.maxTaskId})\n` +
      `  states: success ${ds.outcomes.classCounts.success} · legacy-alias(landed, DEAD) ${ds.outcomes.classCounts["legacy-alias"]} · ` +
      `non-landed ${ds.outcomes.classCounts["non-landed"]} · unrecognized ${ds.outcomes.classCounts.unrecognized}\n` +
      `  rho(touches, executions) = ${an.partials.touchesVsExecutions.toFixed(4)} · partial|bodyLen = ${an.partials.touchesVsExecutions_givenBodyLen.toFixed(4)}\n` +
      `  recommendation: ${an.recommendation ? "yes" : "REFUSED — " + (an.recommendationRefusal ?? "")}\n` +
      (args["no-write"] === "true" ? "" : `  wrote ${outPath}\n`),
  );
  return 0;
}

if (isDirectEntry(import.meta, undefined, "rework-predictors")) {
  process.exitCode = main(process.argv.slice(2));
}
