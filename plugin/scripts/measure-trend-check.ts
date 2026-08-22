#!/usr/bin/env node
// measure-trend-check.ts — land per-file test durations into an append-only history
// (.quay/measure-history.jsonl) after each full suite, and compare the latest round
// against the previous one to report single-file duration GROWTH.
//
// Task: gap-single-file-test-duration-trend-unwatched
//   AC1 — after the full suite, land one {file, duration_ms} record per test file to
//         .quay/measure-history.jsonl (append-only), REUSING measure-suite-reporter.mjs's
//         __PERFILE__ output (AC3 — no new measurer is built). scripts/test.sh already
//         loads measure-suite-reporter.mjs into every real-suite node --test run, and
//         full-suite-runner.ts tees the suite output to .quay/full-suite.log, so the
//         __PERFILE__ lines are already in the log; this script only PARSES them.
//   AC2 — the next run compares against the last: a single-file duration growing past the
//         baseline (relative ≥2× OR absolute >+30s — the outer ruling thresholds; the
//         Contract control "单文件耗时翻倍 ⇒ 报出" refines the written ">2×" to "≥2×" so an
//         exact doubling is caught) is reported with the file AND the growth amount.
//   AC4 — same cost-data direction as gap-suite-cost-model-is-wrong-optimizations-buy-nothing
//         (done): that task measured the one-shot per-file duration DISTRIBUTION; this task
//         adds the TREND dimension (a per-file duration history that is watched round over
//         round instead of only measured once).
//
// Usage (from the repo root):
//   node --experimental-strip-types plugin/scripts/measure-trend-check.ts \
//     [--history .quay/measure-history.jsonl] [--log .quay/full-suite.log] \
//     [--relative-factor 2] [--absolute-ms 30000] [--json] [--no-land]
//
// Default behavior: land a round from the default full-suite log (idempotent via a log
// digest — a second run over the SAME log is a no-op), then compare the last two rounds
// and print one `growth` line per file whose duration grew past the threshold. In --json
// mode each growth report is one JSONL line (so `grep -c 'growth'` over the output counts
// the slow files), and the summary line deliberately AVOIDS the literal 'growth' so the
// count is exact.
//
// The comparison is a REPORT, never a gate: a growing file is surfaced to the loop, it does
// not fail anything (the suite-cost model measured ±17–63 s run-to-run wall noise, so a
// single observation is informational — the trend becomes a signal over multiple rounds).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const DEFAULT_HISTORY_FILE = path.join(REPO_ROOT, ".quay", "measure-history.jsonl");
export const DEFAULT_LOG_FILE = path.join(REPO_ROOT, ".quay", "full-suite.log");

/** Default outer-ruling thresholds (task body): relative >2× OR absolute >+30 s. */
export const DEFAULT_RELATIVE_FACTOR = 2.0;
export const DEFAULT_ABSOLUTE_MS = 30_000;
/** Small-test exemption (gap-measure-trend-load-noise-false-positive): a file whose BASELINE
 * duration is below this (default 5s) must NOT flag on relative ≥2× — a 300ms test doubling to
 * 800ms under load is noise, not regression (round-172: 13 files flagged, all load-noise, sprawl
 * untouched, 0 tests ran before the static gate red). Small tests flag ONLY on absolute growth
 * past `absoluteMs` (e.g. +30s on a 4s test is a real regression; +0.5s on a 300ms test is not). */
export const DEFAULT_SMALL_TEST_MS = 5_000;

export interface PerFileRecord {
  file: string;
  durationMs: number;
  passed: boolean;
}

export interface HistoryLine extends PerFileRecord {
  round: number;
  runAt: string;
  laneCount: number;
  logDigest: string;
}

export interface GrowthReport {
  file: string;
  prevMs: number;
  currMs: number;
  growthMs: number;
  ratio: number;
  /** Which threshold tripped — "relative" (prev>0 && curr/prev>factor) | "absolute". */
  reason: "relative" | "absolute";
}

export interface LandResult {
  landed: boolean;
  round: number;
  files: number;
  reason?: string;
}

/**
 * Normalize a `__PERFILE__` path to a stable identity across verify-round worktree roots
 * (gap-phase-overlap-two-phase-parallel-exploration constraint 6 — `__PERFILE__` 按 basename 归一).
 * A full suite runs inside a per-task worktree (`<root>/quay-worktrees/gap-<task>-<hash>/...`), so the
 * SAME physical test file carries a DIFFERENT full path every round. Keying measure-history on the
 * full path over-counts files (1179 "files" vs ~360 real) and breaks round-to-round comparison
 * (`compareLastTwoRounds` can't match a file whose path changed between rounds). Stripping the
 * worktree-root prefix yields a REPO-ROOT-RELATIVE key: it dedups across worktree variants AND keeps
 * package context — unlike a bare basename, which would collide (measure-suite-reporter.mjs:156
 * deliberately emits full paths because `cli.test.mjs` exists in multiple packages). Paths already
 * outside any worktree (dev runs on a shared checkout) are returned unchanged.
 */
export function normalizePerFileKey(file: string): string {
  const m = file.match(/^.*\/quay-worktrees\/[^/]+\/(.+)$/);
  return m ? m[1] : file;
}

/** Byte offset of the LAST `__FANIN_SUITE_START__` LINE (anchored at line start), or -1.
 *  gap-measure-trend-check-slice-line-anchor (hard rule 5b sibling — same shape as
 *  fan-in-execute.js / pre-verified-round-record.ts): a bare
 *  `lastIndexOf("__FANIN_SUITE_START__")` ALSO matches a test-output line that merely MENTIONS the
 *  marker MID-LINE (e.g. the suite's own test description "…slices by the last __FANIN_SUITE_START__
 *  marker…"), slicing from inside the test run and DROPPING the real `__PERFILE__` lines that precede
 *  it (fake checker-misreport). The emitted marker is always at line START
 *  (`__FANIN_SUITE_START__ iso=…`), so anchoring on `^…$` excludes mid-line mentions. */
function lastSuiteStartOffset(text: string): number {
  const re = /^__FANIN_SUITE_START__[^\n]*$/gm;
  let last = -1;
  let m;
  while ((m = re.exec(text)) !== null) last = m.index;
  return last;
}

/** Parse `__PERFILE__ duration_ms=<dur> <full-path> passed=<bool>` lines (measure-suite-reporter).
 *  gap-fan-in-suite-log-cross-relaunch-reuse: fan-in relaunch 轮转日志并打 `__FANIN_SUITE_START__`
 * 起始标记——按最后一个标记切片，只解析当前轮（最后一个 `__FANIN_SUITE_START__` 之后）的内容，不整份
 * 线性读旧轮。无标记（full-suite-runner 直写 / 测试手写日志 / 旧版 fan-in）⇒ 整份读取（向后兼容）。 */
export function parsePerFileLines(text: string): PerFileRecord[] {
  const out: PerFileRecord[] = [];
  const mk = lastSuiteStartOffset(text);
  const body = mk === -1 ? text : text.slice(mk);
  for (const line of body.split("\n")) {
    const m = line.match(/^__PERFILE__ duration_ms=([0-9.]+) (\S+) passed=(true|false)$/);
    if (m) {
      const dur = parseFloat(m[1]);
      if (Number.isFinite(dur) && dur > 0) {
        out.push({ file: normalizePerFileKey(m[2]), durationMs: dur, passed: m[3] === "true" });
      }
    }
  }
  return out;
}

/** Deterministic digest of a round's records — same set of (file,duration,passed) ⇒ same digest. */
export function computeLogDigest(records: PerFileRecord[]): string {
  const canonical = records
    .map((r) => `${r.file}:${r.durationMs}:${r.passed}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Read every history line into per-round buckets. Returns an array ordered by ascending
 * round, each with `records: Map<file, HistoryLine>`.
 */
export function readHistoryRounds(historyFile: string): Array<{ round: number; runAt: string; records: Map<string, HistoryLine> }> {
  const rounds: Array<{ round: number; runAt: string; records: Map<string, HistoryLine> }> = [];
  if (!fs.existsSync(historyFile)) return rounds;
  for (const line of fs.readFileSync(historyFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as HistoryLine;
      if (typeof parsed?.round !== "number" || typeof parsed?.file !== "string") continue;
      let bucket = rounds.find((r) => r.round === parsed.round);
      if (!bucket) {
        bucket = { round: parsed.round, runAt: parsed.runAt ?? "", records: new Map() };
        rounds.push(bucket);
      }
      bucket.records.set(parsed.file, parsed);
    } catch {
      // malformed line — skip (append-only file, a bad line is a reader-side tolerance)
    }
  }
  rounds.sort((a, b) => a.round - b.round);
  return rounds;
}

/**
 * AC1 — parse the suite log's `__PERFILE__` lines and append one per-file record per test
 * file to the history, as a NEW round. Idempotent: if the last landed round already carries
 * the SAME log digest, the land is a no-op (so re-running the trend-check / the runner's
 * post-suite hook over the same log never duplicates a round). Best-effort at the call site:
 * a land failure must never fail the suite verdict.
 *
 * SHARED writer (gap-measure-history-detached-suite-mirror-write AC1/AC3): this function is ALSO
 * called by plugin/scripts/mirror-measure-history.ts — the fan-in detached-suite path
 * (`setsid bash scripts/test.sh`, which never goes through full-suite-runner.ts) parses its REAL
 * suite log through landMeasureHistory so the appended round's {round,runAt,file,durationMs,passed,
 * laneCount,logDigest} shape is IDENTICAL to the runner's direct writes — this consumer (and
 * compareLastTwoRounds) reads the mirror-write round without any format difference.
 */
export function landMeasureHistory(opts: {
  historyFile?: string;
  logFile?: string;
  laneCount?: number;
  runAt?: string;
  repoRoot?: string;
}): LandResult {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const historyFile = opts.historyFile ?? path.join(repoRoot, ".quay", "measure-history.jsonl");
  const logFile = opts.logFile ?? path.join(repoRoot, ".quay", "full-suite.log");
  if (!fs.existsSync(logFile)) return { landed: false, round: lastRound(historyFile), files: 0, reason: "no-log" };
  const records = parsePerFileLines(fs.readFileSync(logFile, "utf8"));
  if (records.length === 0) return { landed: false, round: lastRound(historyFile), files: 0, reason: "no-perfile-lines" };

  const digest = computeLogDigest(records);
  const prior = readHistoryRounds(historyFile);
  const last = prior.length > 0 ? prior[prior.length - 1] : null;
  if (last) {
    const lastDigest = last.records.get(last.records.keys().next().value)?.logDigest;
    // The first record of the round carries the round's digest; fall back to scanning.
    let lastRoundDigest: string | undefined = lastDigest;
    if (!lastRoundDigest) {
      for (const r of last.records.values()) {
        if (r.logDigest) {
          lastRoundDigest = r.logDigest;
          break;
        }
      }
    }
    if (lastRoundDigest && lastRoundDigest === digest) {
      return { landed: false, round: last.round, files: records.length, reason: "duplicate-log" };
    }
  }

  const round = (last?.round ?? 0) + 1;
  const runAt = opts.runAt ?? new Date().toISOString();
  const laneCount = opts.laneCount ?? 0;
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  const lines = records
    .map(
      (r) =>
        JSON.stringify({
          round,
          runAt,
          file: r.file,
          durationMs: Math.round(r.durationMs * 1000) / 1000,
          passed: r.passed,
          laneCount,
          logDigest: digest,
        }) + "\n",
    )
    .join("");
  fs.appendFileSync(historyFile, lines, "utf8");
  return { landed: true, round, files: records.length };
}

/** The highest round number present in the history (0 when empty). */
export function lastRound(historyFile: string): number {
  const rounds = readHistoryRounds(historyFile);
  return rounds.length > 0 ? rounds[rounds.length - 1].round : 0;
}

/**
 * AC2 — compare the LAST two rounds of the history. A file whose latest duration grew past
 * the baseline is reported: relative growth ≥ `relativeFactor` (default 2×, only when
 * prev>0) OR absolute growth > `absoluteMs` (default +30 s). A file that shrank or stayed
 * flat is NEVER reported (no-growth ⇒ no false positive). Returns GrowthReport[].
 */
export function compareLastTwoRounds(
  historyFile: string,
  opts?: { relativeFactor?: number; absoluteMs?: number; smallTestMs?: number; histVariance?: boolean },
): GrowthReport[] {
  const relativeFactor = opts?.relativeFactor ?? DEFAULT_RELATIVE_FACTOR;
  const absoluteMs = opts?.absoluteMs ?? DEFAULT_ABSOLUTE_MS;
  const smallTestMs = opts?.smallTestMs ?? DEFAULT_SMALL_TEST_MS;
  const useHistVariance = opts?.histVariance ?? true; // gap-measure-trend-large-test-load-noise AC2
  const rounds = readHistoryRounds(historyFile);
  if (rounds.length < 2) return [];
  const prev = rounds[rounds.length - 2].records;
  const curr = rounds[rounds.length - 1].records;

  // Historical variance band (candidate A, gap-measure-trend-large-test-load-noise): for each file,
  // the max duration it reached across ALL rounds BEFORE the current one. A large test (it0-dod-check
  // 71s) that historically swings 35-104s under load is at its natural max at 104s — flagging it on a
  // +33s absolute excursion past +30s is a false positive (round-173b). Suppress the ABSOLUTE trigger
  // when currMs is within the file's own historical max (a single excursion within history = noise).
  // A genuine regression that EXCEEDS the historical max still flags. BOTH triggers are guarded
  // (gap-measure-trend-relative-trigger-lacks-hist-variance-exemption): the relative ≥2× trigger
  // also exempts an in-band excursion (high-variance large test returning to its own normal band
  // after a low point was flagged as "doubling" — round-199 task-check-passthrough 9575→21293 ≤
  // histMax 23183, acceptance-env 10304→20974 ≤ histMax 21445).
  const histMax = new Map<string, number>();
  if (useHistVariance) {
    for (const r of rounds.slice(0, rounds.length - 1)) {
      for (const [file, rec] of r.records) {
        if (rec.durationMs > (histMax.get(file) ?? 0)) histMax.set(file, rec.durationMs);
      }
    }
  }

  const reports: GrowthReport[] = [];
  for (const [file, currRec] of curr) {
    if (currRec.durationMs <= 0) continue;
    const prevRec = prev.get(file);
    if (!prevRec || prevRec.durationMs <= 0) continue;
    const prevMs = prevRec.durationMs;
    const currMs = currRec.durationMs;
    const growthMs = currMs - prevMs;
    if (growthMs <= 0) continue; // no growth ⇒ never a false positive
    const ratio = prevMs > 0 ? currMs / prevMs : Number.POSITIVE_INFINITY;
    // Relative trigger uses >= (not strict >): the Contract control "单文件耗时翻倍 ⇒ 报出"
    // means an EXACT doubling (ratio == 2×) must be caught, not only a strictly-greater one.
    // SMALL-TEST EXEMPTION (gap-measure-trend-load-noise-false-positive AC2): a file whose
    // BASELINE (prev) is below `smallTestMs` (default 5s) does NOT flag on relative growth —
    // a 300ms test at 800ms under load is noise (round-172: gate-blocks the suite before 0
    // tests run). Small tests flag ONLY on absolute growth past `absoluteMs`. Large tests keep
    // both thresholds (a real 2× on a 10s file is still a regression signal).
    const isSmallTest = prevMs < smallTestMs;
    // HIST-VARIANCE EXEMPTION (gap-measure-trend-large-test-load-noise AC2): for LARGE tests, an
    // excursion that stays within the file's own historical max is load noise, not trend. The
    // guard is isomorphic across BOTH triggers — `rel` (gap-measure-trend-relative-trigger-lacks-
    // hist-variance-exemption) and `abs` — so a high-variance large test returning to its own
    // normal band after a low point is not misreported as "doubling" (round-199).
    const withinHistMax = useHistVariance && (histMax.get(file) ?? 0) > 0 && currMs <= histMax.get(file)!;
    const rel = !isSmallTest && prevMs > 0 && ratio >= relativeFactor && !withinHistMax;
    const abs = growthMs > absoluteMs && !withinHistMax;
    if (rel || abs) {
      reports.push({ file, prevMs, currMs, growthMs, ratio, reason: rel ? "relative" : "absolute" });
    }
  }
  reports.sort((a, b) => b.growthMs - a.growthMs);
  return reports;
}

/** Human-readable line for one growth report (contains the literal 'growth'). */
export function formatGrowthReport(g: GrowthReport): string {
  return (
    `growth: ${g.file} ${g.prevMs} -> ${g.currMs} ms (+${g.growthMs} ms, ` +
    `${g.ratio.toFixed(2)}x, ${g.reason})`
  );
}

/** JSONL line for one growth report (contains the literal "growth" for the contract grep). */
export function formatGrowthJson(g: GrowthReport): string {
  return JSON.stringify({
    type: "growth",
    file: g.file,
    prevMs: g.prevMs,
    currMs: g.currMs,
    growthMs: g.growthMs,
    ratio: Math.round(g.ratio * 100) / 100,
    reason: g.reason,
  });
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

const isDirect = process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "measure-trend-check";
if (isDirect) {
  const argv = process.argv.slice(2);
  const historyFile = parseArg(argv, "--history") ?? DEFAULT_HISTORY_FILE;
  const logFile = parseArg(argv, "--log") ?? DEFAULT_LOG_FILE;
  const relativeFactorRaw = Number(parseArg(argv, "--relative-factor") ?? String(DEFAULT_RELATIVE_FACTOR));
  const absoluteMsRaw = Number(parseArg(argv, "--absolute-ms") ?? String(DEFAULT_ABSOLUTE_MS));
  const smallTestMsRaw = Number(parseArg(argv, "--small-test-ms") ?? String(DEFAULT_SMALL_TEST_MS));
  const relativeFactor = Number.isFinite(relativeFactorRaw) && relativeFactorRaw > 1 ? relativeFactorRaw : DEFAULT_RELATIVE_FACTOR;
  const absoluteMs = Number.isFinite(absoluteMsRaw) && absoluteMsRaw > 0 ? absoluteMsRaw : DEFAULT_ABSOLUTE_MS;
  const smallTestMs = Number.isFinite(smallTestMsRaw) && smallTestMsRaw > 0 ? smallTestMsRaw : DEFAULT_SMALL_TEST_MS;
  const json = argv.includes("--json");
  const noLand = argv.includes("--no-land");

  let land: LandResult | null = null;
  if (!noLand) {
    land = landMeasureHistory({ historyFile, logFile, repoRoot: REPO_ROOT });
  }

  const growth = compareLastTwoRounds(historyFile, { relativeFactor, absoluteMs, smallTestMs });

  if (json) {
    // JSONL: one line per growth report (each contains "growth"); the summary line AVOIDS
    // the literal 'growth' so `grep -c 'growth'` counts exactly the slow files.
    for (const g of growth) process.stdout.write(formatGrowthJson(g) + "\n");
    process.stdout.write(
      JSON.stringify({
        type: "summary",
        history: historyFile,
        landed: land?.landed ?? false,
        round: land?.round ?? lastRound(historyFile),
        files: land?.files ?? 0,
        comparedRounds: growth.length > 0 ? (land?.round ?? lastRound(historyFile)) - 1 : lastRound(historyFile) - 1,
        slowFiles: growth.length,
        relativeFactor,
        absoluteMs,
      }) + "\n",
    );
  } else {
    if (land) {
      if (land.landed) process.stdout.write(`measure-trend: landed round ${land.round} (${land.files} files) to ${historyFile}\n`);
      else if (land.reason === "duplicate-log") process.stdout.write(`measure-trend: log already landed as round ${land.round} — no-op\n`);
    }
    process.stdout.write(`measure-trend: comparing last two rounds of ${historyFile}\n`);
    for (const g of growth) process.stdout.write(formatGrowthReport(g) + "\n");
    if (growth.length === 0) process.stdout.write("measure-trend: no single-file duration growth past baseline\n");
  }
}
