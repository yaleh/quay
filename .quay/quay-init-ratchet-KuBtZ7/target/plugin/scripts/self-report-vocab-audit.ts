// plugin/scripts/self-report-vocab-audit.ts — gap-reanchor-must-converge-inner-self-reported-vocabulary.
//
// THE GAP: the re-anchor mechanism (gap-inner-has-no-periodic-anchor-prose-only-drives-drift, done)
// proved "re-anchor happens + deviations corrected" but NOT "the inner's self-reported vocabulary
// converges to factory semantics". Live specimen: the inner reported "Batch of 3 fully merged" for
// three+ rounds after batch-free drives — the batch vocabulary was INTERNALIZED into the inner's
// context history, not prose contamination. Doc-side wording fixes (gap-split-batch-vocabulary,
// todo) cannot reach internalized vocabulary; this task adds the inner-side OBSERVABLE: audit the
// inner's self-reported wording and measure convergence to factory semantics (rolling dispatch /
// verification-round), not "re-anchor happened".
//
// WHAT IT IS (a DETECTOR, not a gate — always exits 0): given a collection of inner self-report
// texts (commit subjects / fan-in notes / closure reports — each line = one self-report), it
//   1. FLAGS batch-style self-reports (Contract `invoke`: `Batch of` / `batch-2/3/4` / `按批`),
//   2. REPORTS the Contract measure `inner_self_report_vocab` = count of flagged reports
//      (grep -c parity: one matching line counts 1, regardless of how many patterns it hits),
//   3. JUDGES CONVERGENCE (AC2): the newest `--window` reports all clean ⇒ `converged: true`.
//      Re-anchor effectiveness IS semantic convergence (`reanchor_effectiveness_is_convergence`),
//      not "a re-anchor was forwarded".
//
// Stopped-state exemption (gap-self-report-vocab-misfires-on-stopped-state, AC1/AC2): the
// convergence criterion used to assume an ACTIVE rolling-dispatch loop — `converged` required
// reports_total >= window (fail-closed). A STOPPED loop ("idle heartbeat, paused awaiting
// manager") emits few self-reports (< window) precisely because it is NOT actively dispatching —
// that is HONEST non-drift, not vocabulary drift. When a window report carries a stopped-state
// marker (`STOPPED_MARKERS`), the window-full requirement is WAIVED; the all-clean requirement is
// unaffected, so a batch-style report in stopped state is still drift (AC2 no regression).
//
// False-alarm discipline (adversarial review, 2026-08-05):
//  * Mechanism real names / task ids containing "batch" are NOT flagged: the batch-num pattern
//    requires a DIGIT after the separator, so "concurrent-batch-scheduler.ts",
//    "gap-closure-sync-is-the-true-batch-boundary", "gap-split-batch-vocabulary", "batch-free
//    drives" all pass clean.
//  * Layer-meta commits that QUOTE the phenomenon (e.g. an "outer:" commit quoting "Batch of 3")
//    are caller-excluded via `--exclude-prefix outer:` — the audit targets the INNER's self-
//    reports, and the outer is already re-anchored every 20 min.
//  * The convergence window is fail-closed for an ACTIVE loop: `converged` requires reports_total
//    >= window (can't claim "N consecutive clean rounds" from fewer than N reports) UNLESS a
//    stopped-state marker is present in the window (a stopped loop is honest, not drifting).
//
// Run:
//   node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts <file>... [opts]
//   node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts --git-log 15 \
//       --exclude-prefix outer: --window 3
// Options:
//   <file>               read self-report texts (one per line) from a file
//   --git-log <N>        pull the N most recent commit subjects via `git log --format=%s -<N>`
//                        (newest-first; reversed to chronological so the convergence window =
//                        the newest N self-reports)
//   --exclude-prefix <p> drop git-log subjects starting with <p> (repeatable; e.g. `outer:`)
//   --window <N>         consecutive clean self-reports required for convergence (default 3)
//   --json               machine-readable output (Contract measure keys read stdout's fields)
//   --count-only         stdout is just the inner_self_report_vocab number (grep -c parity)
//   --root <dir>         repo root for --git-log (default: auto-detect)
//
// The pure audit function is exported and unit-tested; `main()` is a thin CLI over it.

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Vocabulary (single source for what the audit flags / treats as compliant) ──────────────────────

export interface FlagPattern {
  id: string;
  re: RegExp;
  desc: string;
}

/** Batch-style self-report signatures (the Contract `invoke` set, made precise). A report that
 *  matches any of these is FLAGGED as gate-semantics drift. `batch-num` requires a DIGIT after the
 *  separator so mechanism real names / task ids (`concurrent-batch-scheduler.ts`,
 *  `gap-closure-sync-is-the-true-batch-boundary`) are never flagged. */
export const BATCH_FLAG_PATTERNS: FlagPattern[] = [
  { id: "batch-of", re: /\bBatch\s+of\b/i, desc: "「Batch of N fully merged」式门控汇报" },
  { id: "batch-num", re: /\bbatch\s*[-_/]?\s*\d/i, desc: "batch-N 编号（batch-2/3/4 等历史批名）" },
  { id: "an-pi", re: /按批/, desc: "按批组织（收尾/汇报按批）" },
];

/** Factory-semantics markers — evidence the self-report uses the shipped vocabulary (rolling
 *  dispatch / verification-round). Informational; NOT flags. */
export const CONVERGED_MARKERS: { id: string; re: RegExp }[] = [
  { id: "verification-round", re: /verification-round/i },
  { id: "rolling-dispatch", re: /滚动派发|rolling[\s-]?dispatch/i },
];

/** Stopped-state self-report signatures (idle / paused / awaiting manager). A stopped loop is
 *  HONEST non-drift, not vocabulary drift — it emits few self-reports (< `--window`) precisely
 *  because it is not actively dispatching. When a window report carries one of these markers the
 *  convergence criterion waives the window-full requirement (AC1) — but the ALL-CLEAN requirement
 *  is UNAFFECTED: a batch-style report in stopped state is still drift and still fails convergence
 *  (AC2 no regression). Real specimen (archguard 2026-08-06): "idle heartbeat, paused awaiting
 *  manager" — the `paused` word is the same one manager-tick-readings.ts emits for `.halt`. */
export const STOPPED_MARKERS: { id: string; re: RegExp }[] = [
  { id: "idle", re: /\bidle\b/i },
  { id: "paused", re: /\bpaused?\b/i },
  { id: "awaiting", re: /\bawait\w*/i },
  { id: "halted", re: /\bhalt\w*/i },
  { id: "stopped", re: /\bstopped?\b/i },
  { id: "parked", re: /\bparked?\b/i },
  { id: "suspended", re: /\bsuspended?\b/i },
];

export interface FlaggedReport {
  index: number;
  text: string;
  flags: string[];
}

export interface AuditResult {
  inner_self_report_vocab: number;
  total_matches: number;
  reports_total: number;
  window: number;
  converged: boolean;
  recent_clean: number;
  flagged: FlaggedReport[];
  compliant_markers: string[];
  /** Any report inside the convergence window carried a stopped-state marker (idle/paused/…). */
  stopped_in_window: boolean;
  /** Total number of reports (full history) carrying a stopped-state marker. */
  stopped_reports: number;
}

/** Consecutive clean self-reports required for convergence (AC2's "连续 N 轮"). Default 3 —
 *  the task title's own "batch-free drives for 3+ rounds" before the batch self-reports persisted. */
export const DEFAULT_WINDOW = 3;

/** Audit a collection of inner self-report texts (chronological order, oldest first — the newest
 *  `window` entries are the convergence evidence). Returns the Contract measure + convergence
 *  judgment. Pure — no I/O. */
export function auditSelfReports(reports: string[], window = DEFAULT_WINDOW): AuditResult {
  // Harden against non-finite/negative `window` (bad CLI input): fall back to the default.
  const win =
    Number.isFinite(window) && window >= 1 ? Math.floor(window) : DEFAULT_WINDOW;
  const flagged: FlaggedReport[] = [];
  const clean = new Array(reports.length).fill(true);
  const stopped = new Array(reports.length).fill(false);
  let total_matches = 0;
  let stoppedReports = 0;
  const compliantMarkers = new Set<string>();
  reports.forEach((text, i) => {
    const line = String(text);
    const hits: string[] = [];
    for (const p of BATCH_FLAG_PATTERNS) {
      if (p.re.test(line)) {
        hits.push(p.id);
        total_matches++;
      }
    }
    if (hits.length > 0) {
      clean[i] = false;
      flagged.push({ index: i, text: line, flags: hits });
    }
    for (const m of CONVERGED_MARKERS) {
      if (m.re.test(line)) compliantMarkers.add(m.id);
    }
    for (const m of STOPPED_MARKERS) {
      if (m.re.test(line)) {
        stopped[i] = true;
        stoppedReports++;
        break;
      }
    }
  });
  const start = Math.max(0, reports.length - win);
  let recentClean = 0;
  let stoppedInWindow = false;
  for (let i = start; i < reports.length; i++) {
    if (clean[i]) recentClean++;
    if (stopped[i]) stoppedInWindow = true;
  }
  const inWindow = reports.length - start;
  // Fail-closed for an ACTIVE loop: can only claim "N consecutive clean rounds" from >= N reports
  // — with fewer than `window` reports there is no evidence of `window` consecutive clean rounds.
  // A STOPPED loop (idle/paused/awaiting manager) emits few self-reports (< `window`) precisely
  // because it is NOT actively dispatching — that IS honest non-drift evidence, so a stopped-state
  // marker inside the window WAIVES the window-full requirement (gap-self-report-vocab-misfires-
  // on-stopped-state AC1). The all-clean requirement is UNAFFECTED (AC2): a batch-style report in
  // stopped state is still drift and still fails convergence.
  const converged = (stoppedInWindow || reports.length >= win) && recentClean === inWindow;
  return {
    inner_self_report_vocab: flagged.length,
    total_matches,
    reports_total: reports.length,
    window: win,
    converged,
    recent_clean: recentClean,
    flagged,
    compliant_markers: [...compliantMarkers].sort(),
    stopped_in_window: stoppedInWindow,
    stopped_reports: stoppedReports,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  const args = argv.slice(2);
  let window = DEFAULT_WINDOW;
  let json = false;
  let countOnly = false;
  let gitLog = 0;
  let root: string | null = null;
  const excludes: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--window") window = Number(args[++i]);
    else if (a === "--json") json = true;
    else if (a === "--count-only") countOnly = true;
    else if (a === "--git-log") gitLog = Number(args[++i]);
    else if (a === "--root") root = args[++i];
    else if (a === "--exclude-prefix") excludes.push(String(args[++i] ?? ""));
    else files.push(a);
  }

  const reports: string[] = [];
  if (gitLog > 0) {
    const rootDir = root ? path.resolve(root) : repoRoot(process.cwd());
    const subjects = execFileSync("git", ["log", "--format=%s", `-${gitLog}`], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const filtered = subjects.filter((s) => !excludes.some((p) => p && s.startsWith(p)));
    // git log is newest-first; reverse to chronological so the convergence window = newest N.
    reports.push(...filtered.reverse());
  }
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t) reports.push(t);
    }
  }

  const result = auditSelfReports(reports, window);

  if (countOnly) {
    process.stdout.write(`${result.inner_self_report_vocab}\n`);
  } else if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const state = result.converged ? "CONVERGED" : "NOT-CONVERGED";
    const newest = Math.min(result.window, result.reports_total);
    process.stdout.write(
      `inner_self_report_vocab=${result.inner_self_report_vocab} · ${state} ` +
        `(window ${result.window}, recent_clean ${result.recent_clean}/${newest} of newest, ` +
        `stopped_in_window ${result.stopped_in_window ? "yes" : "no"}) · ` +
        `reports_total ${result.reports_total} · stopped_reports ${result.stopped_reports}\n`,
    );
    if (result.flagged.length > 0) {
      process.stdout.write(`  flagged (${result.flagged.length}):\n`);
      for (const f of result.flagged) {
        process.stdout.write(`    [${f.index}] ${f.text}  ← ${f.flags.join(",")}\n`);
      }
    }
    if (result.compliant_markers.length > 0) {
      process.stdout.write(`  compliant markers: ${result.compliant_markers.join(", ")}\n`);
    }
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "self-report-vocab-audit")) {
  process.exitCode = main(process.argv);
}
