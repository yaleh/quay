#!/usr/bin/env node
// perfile-failure-rate.ts — per-file failure-rate baseline + step-change classification
// (tasks/gap-perfile-failure-rate-baseline-step-change).
//
// THE QUESTION this script makes askable: "is THIS failure consistent with the file's historical
// behavior, or is it a NEW event worth looking at?" — computed by aggregating the file's whole
// perFile history instead of one isolate re-run.
//
// WHY THIS EXISTS (the defect it closes): suite-red triage today has exactly one verdict rule —
// "isolate-rerun green ⇒ environmental ⇒ release". A green re-run only proves the failure is NOT
// deterministically reproducible; it does NOT prove it was load-induced. A real non-deterministic
// defect (a product race / ordering dependency / resource leak / TOCTOU / time boundary) produces
// the SAME evidence as a load artifact, and today's mechanism silently files it under "environmental"
// (hard rule 4 推论四: an explanation standing in for a tested conclusion; hard rule 3: the verdict
// vocabulary has no "unexplained" value).
//
// The per-failure attribution is NOT answerable at a 0.12% event rate (one re-run has no resolving
// power). But "did THIS FILE's failure rate change?" IS answerable — it aggregates hundreds of runs.
// 528/615 ever-run files have NEVER failed once; a first failure on such a file is a high-information
// event that needs no reproduction, only a lookup. This script computes that lookup, and its four-state
// classification is the pure function the fix-scope gate (fan-in-execute.js FIX_SCOPE_GATE) imports so
// that a never-failed file's first red routes to escalation/semantic analysis instead of silent
// defer-retry (AC4).
//
// FOUR-STATE classification (AC2 — a pure function; every state is a DISTINCT value, never a shared
// output — hard rule 3b: "cannot judge" must not look like "passed"):
//   new-event      the file has fails=0 across its whole history (the 528/615 majority) — a first red
//                  is high-information, route to escalation.
//   within-baseline the file has fails>0 AND those failures are NOT concentrated in the recent half
//                  (long-standing jitter behavior, e.g. the known 3-6% sources) — release with evidence.
//   step-change    the file has fails>0 AND its failures are ALL in the recent half of its history
//                  (early half was green) — "一直全绿的文件开始偶尔红", the non-deterministic-bug
//                  signature — route to escalation.
//   insufficient   the file's historical runs < MIN_RUNS (below the judgeable floor) — a DISTINCT
//                  "cannot judge" state, NEVER conflated with within-baseline/new-event (a file with
//                  3 runs and 0 fails must NOT read as "never failed").
//
// STEP-CHANGE RULE (documented, no arbitrary threshold): a file's history is split chronologically at
// its midpoint; step-change iff earlyFails === 0 && recentFails > 0. This is a STRUCTURAL property
// (all failures in the recent half), not a magic rate constant (hard rule 4 推论: no numeric threshold
// before the cost structure is known). Honest residual limit (written into the task body): a file that
// already had a small long-standing rate AND recently doubled it (earlyFails > 0) is classified
// within-baseline — the safe direction (it does NOT escalate a noisy-but-known file; reliably
// detecting a rate-doubling inside an already-noisy file needs more samples than one suite round).
//
// DATA-SOURCE RESOLUTION (AC3: the single shared resolveCarrierRoot defined below — the psi family
// imports it instead of re-writing the convention): the carrier
// .quay/verification-round.jsonl is gitignored — `git worktree add` does not carry it. The carrier
// root resolves `--root` → `process.env.QUAY_MAIN_CHECKOUT` → repoRoot(), and FAILS CLOSED (exit 2)
// when the carrier is absent in the resolved root — a worker in a fresh worktree that forgets --root
// must see "carrier not found", never a silent empty baseline that would classify every failure
// new-event (hard rule 3b / the task's AC3).
//
// NO NEW COLLECTION: perFile records already write {file, passed, startedAtMs, endedAtMs, durationMs}
// every round; this is a READ of the existing carrier (same carrier/join shape as
// gap-perfile-psi-window-join), not a new pipeline.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/perfile-failure-rate.ts [--root <repo-root>]
//       [--file <rel-file>] [--min-runs <N>] [--json] [--help]
//   --root       carrier root (default: QUAY_MAIN_CHECKOUT → repoRoot). FAIL-CLOSED when the carrier
//                is absent in the resolved root.
//   --file       classify ONE repo-relative file: print its {runs, fails, rate, classification}.
//   --min-runs   override MIN_RUNS (default 50) — the judgeable floor below which a file is
//                "insufficient". Exposed for tests; production uses the default.
//   --json       machine-readable output.
//
// Exit codes: 0 = baseline computed (read the summary); 2 = carrier not found (fail-closed) / usage.

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo-root.ts";
import { isDirectEntry, helpExit, parseArgs as baseParseArgs } from "./gate-script-base.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────

/** A single perFile record from the carrier (only the fields this script reads). */
export interface PerFileRec {
  file: string;
  passed: boolean;
  startedAtMs?: number;
}

/** The per-file baseline: run count, fail count, and the failure rate (fails/runs, 0 when 0 runs). */
export interface FileBaseline {
  runs: number;
  fails: number;
  rate: number;
}

/** The four-state classification (see header). Each value is DISTINCT — never a shared output. */
export type Classification = "new-event" | "within-baseline" | "step-change" | "insufficient";

/**
 * The judgeable floor (AC2 "低于可判门槛"): a file with fewer than this many historical runs is
 * "insufficient" — its "never failed" / "rate" claim is not yet trustworthy. 50 is the Proposal's
 * own 运行≥50 次 aperture (the 87 ever-failed files' median rate was measured over runs>=50).
 */
export const MIN_RUNS = 50;

// ── Pure functions (no I/O — the test + the gate import these) ────────────────────────────────────

/** Group perFile records by file, each group sorted chronologically (startedAtMs ascending). */
export function groupByFile(recs: PerFileRec[]): Map<string, PerFileRec[]> {
  const map = new Map<string, PerFileRec[]>();
  for (const r of recs) {
    const f = String(r.file ?? "");
    if (!f) continue;
    let arr = map.get(f);
    if (!arr) {
      arr = [];
      map.set(f, arr);
    }
    arr.push(r);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
  }
  return map;
}

/** The {runs, fails, rate} baseline for one file's (already-grouped) history. */
export function baselineOf(history: PerFileRec[]): FileBaseline {
  const runs = history.length;
  const fails = history.filter((r) => r.passed === false).length;
  return { runs, fails, rate: runs > 0 ? fails / runs : 0 };
}

/**
 * The four-state classification of ONE failure for a file, given that file's full chronological
 * history (AC2 pure function). A current failure is not part of the history argument — the history
 * is everything BEFORE this failure; the call site passes the file's whole carrier history and this
 * function judges whether a new red on that file is consistent with it. Order of checks matters:
 *   runs < minRuns → insufficient (cannot judge, FIRST — a 3-run green file is not "never failed")
 *   fails === 0   → new-event
 *   failures all in the recent half → step-change
 *   else          → within-baseline
 */
export function classifyFailure(history: PerFileRec[], opts?: { minRuns?: number }): Classification {
  const minRuns = opts?.minRuns ?? MIN_RUNS;
  const { runs, fails } = baselineOf(history);
  if (runs < minRuns) return "insufficient";
  if (fails === 0) return "new-event";
  // fails > 0, runs >= minRuns: split chronologically at the midpoint (structural, no rate constant).
  const half = Math.ceil(runs / 2);
  const earlyFails = history.slice(0, half).filter((r) => r.passed === false).length;
  const recentFails = fails - earlyFails;
  if (earlyFails === 0 && recentFails > 0) return "step-change";
  return "within-baseline";
}

// ── Carrier reading (the I/O half, kept separate from the pure functions) ──────────────────────────

/**
 * Resolve the carrier root: --root arg → QUAY_MAIN_CHECKOUT → repoRoot().
 *
 * THE SINGLE DEFINITION of this convention. It was byte-identical in three files (here, plus private
 * copies in psi-failure-correlation-check.ts and psi-window-join.ts) until semantic-dedup-scan
 * finding `resolve-carrier-root-three-byte-identical-silent-zero` (`real-duplication`) merged them:
 * both psi scripts now import this function. Three homes for ONE rule meant a change to the
 * resolution order could land in one copy only, silently, in the other two — psi-window-join.ts's own
 * header documented the intent as "the SAME resolution convention as psi-failure-correlation-check.ts",
 * i.e. consistency by copy. (The drift was not hypothetical: psi-failure-correlation-check.ts's header
 * already said the last fallback was `cwd` while all three bodies fell back to `repoRoot()`.)
 *
 * The `argRoot?: string` signature is a SUPERSET of the two private copies' `argRoot: string` — every
 * former call site passes `args.root`, which is `""` when the flag is absent, and `""` is falsy here,
 * so the observable behavior is unchanged. The ratchet test in plugin/test/perfile-failure-rate.test.mjs
 * fails if a private copy reappears.
 */
export function resolveCarrierRoot(argRoot?: string): string {
  if (argRoot) return argRoot;
  if (process.env.QUAY_MAIN_CHECKOUT) return process.env.QUAY_MAIN_CHECKOUT;
  return repoRoot();
}

/** The absolute carrier path under a resolved root. */
export function carrierPath(root: string): string {
  return path.join(root, ".quay", "verification-round.jsonl");
}

/**
 * Read every perFile record from the carrier. Returns { found:false, path } when the carrier is
 * absent (the caller must fail closed — an absent carrier is NOT an empty-but-valid baseline).
 */
export function readCarrierPerFile(root: string): { found: boolean; path: string; recs: PerFileRec[] } {
  const p = carrierPath(root);
  if (!fs.existsSync(p)) {
    return { found: false, path: p, recs: [] };
  }
  const recs: PerFileRec[] = [];
  let text: string;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return { found: false, path: p, recs: [] };
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    if (typeof obj !== "object" || obj === null) continue;
    const pfRaw = (obj as { perFile?: unknown }).perFile;
    if (!Array.isArray(pfRaw)) continue;
    for (const r of pfRaw as Array<Record<string, unknown>>) {
      if (typeof r !== "object" || r === null) continue;
      const file = r.file;
      if (typeof file !== "string" || !file) continue;
      recs.push({ file, passed: r.passed !== false, startedAtMs: typeof r.startedAtMs === "number" ? r.startedAtMs : undefined });
    }
  }
  return { found: true, path: p, recs };
}

/** The full baseline map for every file in the carrier (groupByFile → baselineOf). */
export function computeBaselines(recs: PerFileRec[]): Map<string, FileBaseline> {
  const out = new Map<string, FileBaseline>();
  for (const [file, history] of groupByFile(recs)) {
    out.set(file, baselineOf(history));
  }
  return out;
}

// ── Report / CLI ───────────────────────────────────────────────────────────────────────────────────

function fmtRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

function fmtBaselineLine(file: string, b: FileBaseline): string {
  return `${file}: ${b.fails}/${b.runs} = ${fmtRate(b.rate)}`;
}

interface Summary {
  totalRecords: number;
  totalFails: number;
  overallRate: number;
  distinctFiles: number;
  everFailed: number;
  neverFailed: number;
  top: { file: string; runs: number; fails: number; rate: number }[];
}

function summarize(recs: PerFileRec[], minRuns: number): Summary {
  const baselines = computeBaselines(recs);
  const totalRecords = recs.length;
  const totalFails = recs.filter((r) => r.passed === false).length;
  const distinctFiles = baselines.size;
  let everFailed = 0;
  const top: Summary["top"] = [];
  for (const [file, b] of baselines) {
    if (b.fails > 0) everFailed++;
    if (b.runs >= minRuns && b.fails > 0) {
      top.push({ file, runs: b.runs, fails: b.fails, rate: b.rate });
    }
  }
  top.sort((a, b) => b.rate - a.rate || b.fails - a.fails || a.file.localeCompare(b.file));
  return {
    totalRecords,
    totalFails,
    overallRate: totalRecords > 0 ? totalFails / totalRecords : 0,
    distinctFiles,
    everFailed,
    neverFailed: distinctFiles - everFailed,
    top,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
// The flag loop is the SHARED spec-driven parser (gate-script-base.ts); this wrapper only maps the
// raw `--flag <value>` strings onto this command's typed shape. It used to be a private if/else loop
// — one of the three byte-shape-identical copies named by semantic-dedup-scan finding
// `parse-args-handrolled-variants` (runId `semantic-dedup-scan-1791536153223`). Those could not fold
// into the shared parser while it `process.exit()`ed on `--help`: this command prints its OWN
// multi-line usage from `main`, so it needs the non-exiting `help: "return"` mode.
function parseArgs(argv: string[]) {
  const { flags, help } = baseParseArgs(argv, {
    minArgs: 0,
    usage: "[--root <repo-root>] [--file <rel-file>] [--min-runs <N>] [--json] [--help]",
    help: "return",
    flags: {
      root: { type: "string" },
      file: { type: "string" },
      "min-runs": { type: "string" },
      json: { type: "boolean" },
    },
  });
  const minRuns = typeof flags["min-runs"] === "string" ? Number(flags["min-runs"]) : Number.NaN;
  return {
    root: typeof flags.root === "string" ? flags.root : "",
    file: typeof flags.file === "string" ? flags.file : "",
    minRuns: Number.isFinite(minRuns) && minRuns >= 1 ? Math.floor(minRuns) : MIN_RUNS,
    json: flags.json === true,
    help: help === true,
  };
}

function printSummaryText(args: ReturnType<typeof parseArgs>, res: ReturnType<typeof readCarrierPerFile>, s: Summary): void {
  console.log(`perfile-failure-rate.ts — per-file failure-rate baseline (carrier: ${res.path})`);
  console.log(`total perFile records: ${s.totalRecords} | fails: ${s.totalFails} | overall rate: ${fmtRate(s.overallRate)}`);
  console.log(`distinct files: ${s.distinctFiles} | ever-failed: ${s.everFailed} | never-failed: ${s.neverFailed}`);
  console.log(`top jitter sources (runs>=${args.minRuns}, rate desc):`);
  for (const t of s.top) {
    console.log(`  ${fmtBaselineLine(t.file, { runs: t.runs, fails: t.fails, rate: t.rate })}`);
  }
}

function printSummaryJson(res: ReturnType<typeof readCarrierPerFile>, s: Summary): void {
  process.stdout.write(JSON.stringify({
    carrier: res.path,
    totalRecords: s.totalRecords,
    totalFails: s.totalFails,
    overallRate: s.overallRate,
    distinctFiles: s.distinctFiles,
    everFailed: s.everFailed,
    neverFailed: s.neverFailed,
    top: s.top,
  }, null, 2) + "\n");
}

function printOneText(file: string, b: FileBaseline, cls: Classification): void {
  console.log(`file: ${file}`);
  console.log(`baseline: runs=${b.runs} fails=${b.fails} rate=${fmtRate(b.rate)}`);
  console.log(`classification: ${cls}`);
}

function printOneJson(file: string, b: FileBaseline, cls: Classification): void {
  process.stdout.write(JSON.stringify({ file, runs: b.runs, fails: b.fails, rate: b.rate, classification: cls }, null, 2) + "\n");
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  const usage = `perfile-failure-rate.ts — per-file failure-rate baseline + step-change classification
Usage:
  node --experimental-strip-types plugin/scripts/perfile-failure-rate.ts [--root <repo-root>] [--file <rel-file>] [--min-runs <N>] [--json]
  --root       carrier root (default: QUAY_MAIN_CHECKOUT → repoRoot); FAIL-CLOSED when the carrier is absent.
  --file       classify ONE repo-relative file (print {runs, fails, rate, classification}).
  --min-runs   judgeable floor (default ${MIN_RUNS}); a file with fewer runs is "insufficient".
  --json       machine-readable output.
Exit: 0 = computed; 2 = carrier not found (fail-closed) / usage.`;
  if (args.help) helpExit(usage);

  const root = resolveCarrierRoot(args.root);
  const res = readCarrierPerFile(root);
  if (!res.found) {
    process.stderr.write(`perfile-failure-rate: 载体未找到: ${res.path} — 在干净 worktree 里不传 --root 就会这样（fail-closed，不是空基线当「全部没失败过」）\n`);
    return 2;
  }

  if (args.file) {
    const byFile = groupByFile(res.recs);
    const history = byFile.get(args.file) ?? [];
    const b = baselineOf(history);
    const cls = classifyFailure(history, { minRuns: args.minRuns });
    if (args.json) printOneJson(args.file, b, cls);
    else printOneText(args.file, b, cls);
    return 0;
  }

  const s = summarize(res.recs, args.minRuns);
  if (args.json) printSummaryJson(res, s);
  else printSummaryText(args, res, s);
  return 0;
}

if (isDirectEntry(import.meta, undefined, "perfile-failure-rate")) {
  process.exitCode = main(process.argv);
}
