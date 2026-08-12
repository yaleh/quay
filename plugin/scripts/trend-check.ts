// plugin/scripts/trend-check.ts — the TREND-criteria checker
// (tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria).
//
// PROBLEM IT FIXES: every existing quality criterion is point-in-time ("was it green this
// time" / "does this contract conform") — NONE is a trend criterion ("is it more expensive
// than last time" / "closer to the goal"). The per-test-cost trend 0.251→0.464→0.321
// (net +28%) worsened for a whole day before anyone asked — and a single green/red
// point-in-time reading can never distinguish "improving" from "deteriorating" (each of
// those three points could pass a point-in-time band while the window as a whole regressed).
//
// WHAT IT DOES (a PASSIVE reader — invariant trend_is_passive = 1, AC5): it reads the
// append-only ledgers that already exist and computes TREND criteria (slope over a window),
// flagging deterioration even while each point is individually green:
//
//   - <root>/.quay/verification-round.jsonl   — one line per full-suite run, appended by
//     full-suite-runner.ts (gap-no-criterion-records-its-own-cost AC6; this task extends it
//     with `tests` / `per_test_ms` / `redAt`, AC1/AC3b). Axis 1 = suite per-test cost
//     (per_test_ms), Axis 2 = early-RED detection latency (redAt − startedAt).
//   - <root>/.quay/checker-cost.jsonl         — one line per checker/gate execution,
//     appended by checker-cost.sh. Axis 3 = per-checker cost (ms over that checker's recent
//     executions), so the ready-pool-check 35.8→91.2→157.0 slope is visible WITHOUT a human
//     hand-timing (task instance #10).
//
// It NEVER triggers a new run (no scheduling), NEVER writes any file — pure read + report.
//
// Trend math (per axis, over the last `--window` points):
//   netChange   = (last − first) / |first|     — "比上次更贵了吗" (the window as a whole)
//   normSlope   = leastSquaresSlope / |first|  — 斜率 (regression slope per round, relative)
//   flag iff    netChange > threshold OR normSlope > threshold   (threshold default +10%/window)
//
// The AC3 regression control — 0.251→0.464→0.321, net +28% — MUST flag: netChange +27.9% and
// normSlope +13.9%/round both exceed +10%. The negative control — a flat sequence — must NOT.
//
// Run:
//   node --experimental-strip-types plugin/scripts/trend-check.ts [--root <dir>]
//       [--window <N>] [--threshold <frac>] [--json] [--human]
//   --window     how many recent points per axis (default 5).
//   --threshold  worsening threshold as a fraction, default 0.10 (+10%/window).
//   --json       wrap output in {flags, meta} (tests / introspection use this).
//   --human      human-readable lines instead of the JSON array.
//   Default output is the JSON array of flags (the Contract measure's "打标数组").
//
// Exit codes: 0 = no deterioration flagged; 1 = one or more trend flags (band
// `trend_flags = 0` — a green state has no flags; a real deterioration must never be missed).

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Trend math (pure, unit-tested) ────────────────────────────────────────────────────────────────────

/** Least-squares slope of a value series (per index step); 0 for <2 points or a flat x-axis. */
export function leastSquaresSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  if (den === 0) return 0;
  return num / den;
}

/** Net window change (last − first) / |first|; 0 for <2 points; +Infinity when rising from 0. */
export function netChange(values: number[]): number {
  if (values.length < 2) return 0;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return last > 0 ? Number.POSITIVE_INFINITY : 0;
  return (last - first) / Math.abs(first);
}

/** Normalized slope: regression slope per round as a fraction of the window's first value. */
export function normalizedSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const denom = Math.abs(values[0]) || Number.EPSILON;
  return leastSquaresSlope(values) / denom;
}

/**
 * The trend flagging rule (the ONE rule every axis uses):
 *   netChange > threshold  OR  normalizedSlope > threshold.
 * A window with <2 points is never flagged (no trend exists yet).
 * This is what makes the AC3 control (net +28%) flag while a flat sequence (net 0, slope 0)
 * stays silent.
 */
export function shouldFlag(values: number[], threshold: number): boolean {
  if (values.length < 2) return false;
  return netChange(values) > threshold || normalizedSlope(values) > threshold;
}

// ── Reading the ledgers (passive — read-only, never writes) ──────────────────────────────────────────

/** Parse a JSONL file into objects, skipping blank lines and unparseable rows (best-effort). */
export function readJsonLines(file: string): Record<string, unknown>[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return []; // absent ledger = no history = no trend
  }
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip a corrupt line — never let one bad row hide the rest of the history
    }
  }
  return rows;
}

export interface SuiteRoundRow {
  round?: number;
  startedAt?: string;
  durationMs?: number;
  laneCount?: number;
  pass?: number;
  fail?: number;
  cancelled?: number;
  tests?: number;
  per_test_ms?: number;
  redAt?: string;
  load?: number;
  state?: string;
  reason?: string;
  runner?: string;
}

/**
 * Per-test cost series from verification-round rows (AC1: `tests` = pass+fail+cancelled,
 * `per_test_ms` = durationMs/tests; the recorded per_test_ms field, when present, wins). A row
 * with no runnable tests (tests == 0) or no finite duration is skipped — a suite that ran no
 * tests says nothing about per-test cost.
 */
export function suitePerTestSeries(rows: SuiteRoundRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const tests = Number(r.tests ?? ((r.pass ?? 0) + (r.fail ?? 0) + (r.cancelled ?? 0)));
    const duration = Number(r.durationMs);
    if (!Number.isFinite(tests) || tests <= 0) continue;
    if (!Number.isFinite(duration) || duration < 0) continue;
    const perTest =
      r.per_test_ms !== undefined && Number.isFinite(Number(r.per_test_ms))
        ? Number(r.per_test_ms)
        : duration / tests;
    if (Number.isFinite(perTest) && perTest >= 0) out.push(perTest);
  }
  return out;
}

/**
 * Early-RED detection latency series (AC3b): for each red+failed round, (redAt − startedAt) —
 * how far into the run the first REAL failure flipped state to red. The early-RED mitigation
 * shrinks the blast radius (实测 ~7.5min to first failure, not waiting for the 15min suite); a
 * growing latency means the mitigation is degrading. Only rows that actually went red are
 * observations of this axis.
 */
export function redLatencySeries(rows: SuiteRoundRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (r.state !== "red") continue;
    // aborted/infra/timeout/hung/crashed = no correctness conclusion; failed AND gate-failed are
    // real reds (the round did not go green) — a gate/scan red (fail=0 + reason='gate-failed') still
    // carries a redAt (the moment the gate/scan line flipped red), so it IS an early-RED observation.
    if (r.reason !== undefined && r.reason !== "failed" && r.reason !== "gate-failed") continue;
    if (!r.redAt || !r.startedAt) continue;
    const latency = Date.parse(String(r.redAt)) - Date.parse(String(r.startedAt));
    if (Number.isFinite(latency) && latency >= 0) out.push(latency);
  }
  return out;
}

export interface CheckerCostRow {
  name?: string;
  ms?: number;
  n?: number;
  load?: number;
  exit?: number;
  ts?: string;
}

/** Group checker-cost rows by checker name, preserving file (chronological) order. */
export function groupCheckerRows(rows: CheckerCostRow[]): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  for (const r of rows) {
    const name = r.name;
    const ms = Number(r.ms);
    if (!name || !Number.isFinite(ms) || ms < 0) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(ms);
  }
  return byName;
}

// ── Trend flag construction ───────────────────────────────────────────────────────────────────────────

export type TrendAxis = "suite_per_test_cost" | "early_red_latency" | "per_checker_cost";

export interface TrendFlag {
  axis: TrendAxis;
  name: string;
  values: number[];
  first: number;
  last: number;
  netChange: number;
  normSlope: number;
  threshold: number;
  message: string;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function makeFlag(axis: TrendAxis, name: string, values: number[], threshold: number): TrendFlag {
  const net = netChange(values);
  const norm = normalizedSlope(values);
  return {
    axis,
    name,
    values,
    first: values[0],
    last: values[values.length - 1],
    netChange: Number(net.toFixed(4)),
    normSlope: Number(norm.toFixed(4)),
    threshold,
    message: `${axis}: ${name} trending up over ${values.length} points — ${values[0]} → ${
      values[values.length - 1]
    } (net ${pct(net)}, slope ${pct(norm)}/point, threshold ${pct(threshold)})`,
  };
}

/**
 * The whole trend analysis over one workspace root (pure function, unit-tested):
 *   1. suite_per_test_cost — per-test cost over the last `window` green/any rounds (AC2/AC3)
 *   2. early_red_latency   — red-detection latency over the last `window` red rounds (AC3b)
 *   3. per_checker_cost    — per-checker ms over the last `window` executions of each name (§10)
 */
export function analyzeTrends(root: string, window: number, threshold: number): TrendFlag[] {
  const flags: TrendFlag[] = [];

  const rounds = readJsonLines(path.join(root, ".quay", "verification-round.jsonl")) as SuiteRoundRow[];

  const costSeries = suitePerTestSeries(rounds);
  if (costSeries.length >= 2) {
    const values = costSeries.slice(-window);
    if (shouldFlag(values, threshold)) flags.push(makeFlag("suite_per_test_cost", "full-suite", values, threshold));
  }

  const latencySeries = redLatencySeries(rounds);
  if (latencySeries.length >= 2) {
    const values = latencySeries.slice(-window);
    if (shouldFlag(values, threshold)) flags.push(makeFlag("early_red_latency", "early-red", values, threshold));
  }

  const ledger = readJsonLines(path.join(root, ".quay", "checker-cost.jsonl")) as CheckerCostRow[];
  const byName = groupCheckerRows(ledger);
  for (const [name, msSeries] of byName) {
    if (msSeries.length < 2) continue;
    const values = msSeries.slice(-window);
    if (shouldFlag(values, threshold)) flags.push(makeFlag("per_checker_cost", name, values, threshold));
  }

  return flags;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function main(argv: string[]): number {
  let root: string | null = null;
  let window = 5;
  let threshold = 0.1;
  let json = false;
  let human = false;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--window") window = Number(args[++i]);
    else if (args[i] === "--threshold") threshold = Number(args[++i]);
    else if (args[i] === "--json") json = true;
    else if (args[i] === "--human") human = true;
  }
  if (!Number.isFinite(window) || window < 2) window = 5;
  if (!Number.isFinite(threshold)) threshold = 0.1;

  const rootDir = root ? path.resolve(root) : findRepoRoot(process.cwd());
  const flags = analyzeTrends(rootDir, window, threshold);

  if (json) {
    const meta = {
      root: rootDir,
      window,
      threshold,
      roundsRead: readJsonLines(path.join(rootDir, ".quay", "verification-round.jsonl")).length,
      checkerRowsRead: readJsonLines(path.join(rootDir, ".quay", "checker-cost.jsonl")).length,
      trendIsPassive: 1, // invariant trend_is_passive — this checker only reads, never runs
    };
    process.stdout.write(`${JSON.stringify({ flags, meta }, null, 2)}\n`);
  } else if (human) {
    if (flags.length === 0) process.stdout.write("trend-check: no deterioration flagged (clean)\n");
    for (const f of flags) process.stdout.write(`FLAG ${f.message}\n`);
    process.stdout.write(`trend-check: ${flags.length} flag(s), window=${window} threshold=${pct(threshold)}\n`);
  } else {
    // Default = the Contract measure's "打标数组" — a JSON array of flags ([] when clean).
    process.stdout.write(`${JSON.stringify(flags)}\n`);
  }
  return flags.length > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "trend-check")) {
  process.exitCode = main(process.argv);
}
