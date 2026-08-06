#!/usr/bin/env node
// trend-check.ts — the TREND criterion (gap-quality-criteria-are-point-in-time-no-trend-criteria).
//
// PROBLEM IT FIXES: every standing quality criterion is POINT-IN-TIME — "is the suite green now",
// "does this contract conform". Nothing asks "is it getting WORSE than last time". The per-test-cost
// trend 0.251→0.464→0.321 seconds (net +28%) worsened for a whole day before a human happened to
// ask. This script is the mechanical answer to 「比上次更贵了吗 / 离目标更近了吗」: read the EXISTING
// metric history and FLAG any series whose window trend worsens beyond a configurable threshold.
//
// PASSIVE (AC5): reads existing records ONLY. Never triggers a run, never appends, never mutates.
// Invoked from the daily review (orchestration/REVIEW-cadence.md 3d) or the outer tick.
//
// SERIES READ (all existing records — the trend grows itself, no new scheduling):
//   1. suite per-test cost — <root>/.quay/verification-round.jsonl {round, at, durationMs,
//      tests?, cancelled?, perTestMs?, pass, fail, load} — perTestMs = durationMs/tests (AC1).
//   2. criterion self-cost — <root>/.quay/checker-cost.jsonl       {name, ms, n, load, at} — one
//      series per name (the ready-pool-check 35.8→91.2→157.0s exemplar lives here).
//   3. early-RED detection latency — <root>/.quay/suite-state-events.jsonl — SUITE-RED events:
//      latencyMs = ev.at − Date.parse(ev.state.startedAt) = suite start → red recorded (the
//      early-RED mitigation's health; AC3b of this task).
//
// FLAG RULE (AC2): for the most recent `window` points of a series compute
//   pctChange = (last − first) / first × 100
// and flag when pctChange ≥ thresholdPct (default +10). "worse" = more expensive / slower / later.
// A FLAT sequence (negative control) never flags; the 0.251→0.464→0.321 control (+28%) always does
// (AC3 regression control). The comparison is DETERMINISTIC — a window worsening can never be
// missed (the Contract band "窗口内恶化必打标，无漏报").
//
// Output (Contract measure `trend_flags`): a JSON array of flags on stdout ([] = nothing trending
// worse beyond threshold). Exit 0 ALWAYS — a flag is data, not an error.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/trend-check.ts [--root <dir>]
//     [--window <N>] [--threshold <pct>]
//
// Env/test seams: none needed — every input path is <root>/.quay/<well-known.jsonl>; a hermetic
// test writes fixture rows into a temp root and calls trendCheck()/the CLI with --root <tmp>.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export interface TrendFlag {
  series: string; // e.g. "suite.perTestMs" | "checker:<name>.ms" | "suite.redDetectLatencyMs"
  kind: "cost" | "latency";
  window: number;
  values: number[];
  first: number;
  last: number;
  pctChange: number; // (last − first) / first × 100, rounded to 1 decimal
  thresholdPct: number;
  flagged: boolean;
}

/** Parse every JSON row from a file (skips malformed lines fail-open — readers never break). */
function readJsonl(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  const out: unknown[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // malformed line — skip fail-open (a pure-append store must never break readers)
    }
  }
  return out;
}

export interface VerificationRound {
  round?: number;
  at?: string;
  startedAt?: string;
  durationMs?: number;
  laneCount?: number;
  tests?: number;
  cancelled?: number;
  perTestMs?: number;
  pass?: number;
  fail?: number;
  load?: number;
}

/** Read verification-round.jsonl rows (append order = chronological). */
export function readVerificationRounds(root: string): VerificationRound[] {
  return readJsonl(path.join(root, ".quay", "verification-round.jsonl")) as VerificationRound[];
}

export interface SuiteStateEvent {
  event?: string;
  at?: string;
  state?: { startedAt?: string; finishedAt?: string | null; state?: string };
}

/** Read suite-state-events.jsonl rows. */
export function readSuiteStateEvents(root: string): SuiteStateEvent[] {
  return readJsonl(path.join(root, ".quay", "suite-state-events.jsonl")) as SuiteStateEvent[];
}

/**
 * Window trend over a chronological numeric series: take the most recent `window` points and
 * compare LAST vs FIRST as a percentage. Returns null when the series has < 2 usable points
 * (a trend cannot be established from one measurement). Usable = finite AND > 0 (a zero first
 * would make the percentage undefined).
 */
export function windowTrend(
  values: number[],
  window: number,
  thresholdPct: number,
  series: string,
  kind: "cost" | "latency",
): TrendFlag | null {
  const usable = values.filter((v) => Number.isFinite(v) && v > 0);
  if (usable.length < 2) return null;
  const w = Math.max(2, Math.min(window, usable.length));
  const win = usable.slice(usable.length - w);
  const first = win[0];
  const last = win[win.length - 1];
  const pctChange = Math.round((((last - first) / first) * 100) * 10) / 10;
  // Compare the ROUNDED percentage (the same value reported in the flag) so a float-precision edge
  // at the boundary (e.g. raw 4.99999 → reported 5.0) cannot flip the verdict inconsistently.
  return {
    series,
    kind,
    window: w,
    values: win,
    first,
    last,
    pctChange,
    thresholdPct,
    flagged: pctChange >= thresholdPct,
  };
}

export interface TrendCheckResult {
  flags: TrendFlag[];
  series: string[];
}

/**
 * Assemble ALL trend series from existing records and flag those whose window trend worsens
 * beyond the threshold. PASSIVE (AC5) — reads only, writes nothing.
 */
export function trendCheck(opts: { root: string; window?: number; thresholdPct?: number }): TrendCheckResult {
  const window = Math.max(2, opts.window ?? 3);
  const thresholdPct = opts.thresholdPct ?? 10;
  const flags: TrendFlag[] = [];
  const series: string[] = [];

  // 1. Suite per-test cost (verification-round.jsonl). Prefer the recorded perTestMs (AC1); a
  //    legacy row without it falls back to durationMs/tests.
  const rounds = readVerificationRounds(opts.root);
  const suiteCost: number[] = [];
  for (const r of rounds) {
    const v: number | undefined =
      typeof r.perTestMs === "number" && r.perTestMs > 0
        ? r.perTestMs
        : typeof r.durationMs === "number" && typeof r.tests === "number" && r.tests > 0
          ? r.durationMs / r.tests
          : undefined;
    if (v === undefined) continue;
    suiteCost.push(v);
  }
  series.push("suite.perTestMs");
  const sf = windowTrend(suiteCost, window, thresholdPct, "suite.perTestMs", "cost");
  if (sf) flags.push(sf);

  // 2. Criterion self-cost per name (checker-cost.jsonl) — the criterion's OWN cost trend
  //    (gap-no-criterion-records-its-own-cost-checker-cost-jsonl provides the data; we flag it).
  const checkerRows = readJsonl(path.join(opts.root, ".quay", "checker-cost.jsonl")) as Array<{
    name?: string;
    ms?: number;
  }>;
  const byName = new Map<string, number[]>();
  for (const row of checkerRows) {
    if (typeof row.name !== "string" || typeof row.ms !== "number" || !Number.isFinite(row.ms)) continue;
    const arr = byName.get(row.name) ?? [];
    arr.push(row.ms);
    byName.set(row.name, arr);
  }
  for (const [name, msValues] of byName) {
    const s = `checker:${name}.ms`;
    series.push(s);
    const f = windowTrend(msValues, window, thresholdPct, s, "cost");
    if (f) flags.push(f);
  }

  // 3. Early-RED detection latency (suite-state-events.jsonl) — AC3b. latencyMs = SUITE-RED.at −
  //    state.startedAt (suite start → red recorded). A growing window latency = the early-RED
  //    mitigation (the "first failure reported ~7.5min in, not 15" property) is degrading.
  const events = readSuiteStateEvents(opts.root);
  const latencies: number[] = [];
  for (const e of events) {
    if (e.event !== "SUITE-RED" || !e.state?.startedAt) continue;
    const at = Date.parse(e.at ?? "");
    const startedAt = Date.parse(e.state.startedAt);
    if (Number.isFinite(at) && Number.isFinite(startedAt) && at >= startedAt) {
      latencies.push(at - startedAt);
    }
  }
  series.push("suite.redDetectLatencyMs");
  const lf = windowTrend(latencies, window, thresholdPct, "suite.redDetectLatencyMs", "latency");
  if (lf) flags.push(lf);

  return { flags, series };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

function main(argv: string[]): number {
  const root = path.resolve(parseArg(argv, "--root") ?? REPO_ROOT);
  const windowRaw = Number(parseArg(argv, "--window") ?? "3");
  const thresholdRaw = Number(parseArg(argv, "--threshold") ?? "10");
  const { flags } = trendCheck({
    root,
    window: Number.isFinite(windowRaw) ? windowRaw : 3,
    thresholdPct: Number.isFinite(thresholdRaw) ? thresholdRaw : 10,
  });
  // stdout = the Contract measure `trend_flags` (JSON array). A flag is DATA, not an error.
  process.stdout.write(`${JSON.stringify(flags)}\n`);
  // stderr = human summary (never the measure).
  if (flags.length === 0) {
    process.stderr.write("trend-check: no series trending worse beyond threshold (point-in-time green)\n");
  } else {
    for (const f of flags) {
      process.stderr.write(
        `trend-check FLAG ${f.series}: +${f.pctChange}% over window ${f.window} ` +
          `(${f.first} → ${f.last}); threshold +${f.thresholdPct}%\n`,
      );
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
