#!/usr/bin/env node
// @instrument "How many temp roots does a suite run create, how many does its exit path remove, and how many survive (leaked) into the next run — and is the surviving set still bounded by a live owner (a process cwd inside the entry) rather than by a name/age guess?"
// plugin/scripts/temp-root-reaper.ts — gap-test-harness-tmp-dir-leak.
//
// THE DEFECT this instrument closes (measured 2026-11-06 on the shared 128-vCPU host):
//   $ find /tmp -maxdepth 1 -name 'quay-*' | wc -l
//   46218            # 15,278 of them older than 7 days
// Every test/suite run mkdtemp()'s fixture dirs under <tmp> and — because nothing on the EXIT path
// owns them — a few percent survive each run. The leak is the 硬规则 3b shape: NOTHING ever turns
// red because /tmp holds 46,218 dirs, so the defect is indistinguishable from "everything is fine".
// A one-off `rm -rf` is not a fix (the next run re-leaks); the fix is (a) the run owning a temp root
// and removing it on the exit path, and (b) this bounded-age sweeper for residue left by runs that
// were SIGKILLed / that predate the fix.
//
// THREE COUNTERS, NOT A BOOLEAN (the task's own criterion): every run prints ONE telemetry line
//   tmp-root-telemetry: root=<dir> created=<n> reaped=<n> leaked=<n> evaluated=true
// `evaluated=false` + the three fields reading NOT-EVALUATED is a DISTINCT output — a run whose
// reaper never ran must not be readable as a run that reaped everything (leaked=0 vs leaked absent).
//
// WHAT `created` MEASURES — stated precisely, because the honest reading is a lower bound:
//   The run's temp root is created FRESH and is private to the run (mkdtemp, never shared), so every
//   entry found in it at exit time was created by this run. Entries the tests removed themselves
//   during the run are already gone and are therefore NOT counted. So `created` = "entries this run
//   created that were still present when the exit path took over", and `reaped`/`leaked` partition
//   exactly that set. The quantity is measured by two independent scans plus a removal pass; it is
//   NOT an identity (`reaped = created - leaked` can break: a removal that throws leaves the entry
//   present ⇒ leaked, never reaped).
//
// SAFETY ENVELOPE — the rule the 2026-08-08 two-layer-blind incident left behind: residue is
// distinguished from IN-USE by OWNER LIVENESS, never by a name/path guess. An entry is spared when
// ANY live process has a cwd at or under it (read from /proc/<pid>/cwd). Consequences:
//   * a fixture a running test is standing in is never removed, even at --max-age 0;
//   * ⛔ when /proc yields no readable cwd AT ALL the reaper does NOT fall back to "no owner ⇒ reap"
//     — that would be 硬规则 3b in its most dangerous form ("I could not evaluate" reported as
//     "there is no owner"). It returns evaluated=false, removes NOTHING, and exits 3.
//
// AGE BOUND: an entry is a candidate only when its own mtime is older than --max-age. A directory's
// mtime is bumped whenever its direct children are added/removed, so an actively-written fixture is
// spared by construction. --max-age 0 (the exit-path form: the root is private to the run and dies
// with it) makes every entry a candidate — liveness is still enforced.
//
// EXCLUSIONS: `quay-real-install-build-cache` is a CROSS-RUN shared build cache (it prunes itself at
// 48h, plugin/test/helpers/real-install-shared-build.mjs). Age alone would call it residue and throw
// away a multi-minute rebuild, so it is excluded by name by default (--exclude adds more; --no-default-excludes drops it).
//
// Usage:
//   temp-root-reaper.ts [--root <dir>] [--prefix <p>] [--max-age <0|90s|30m|24h|7d>]
//                       [--dry-run|--list] [--telemetry] [--json]
//                       [--exclude <name>]... [--exclude-prefix <p>]... [--no-default-excludes]
//                       [--proc-root <dir>] [--help]
//
//   --root      directory whose TOP-LEVEL entries are considered (default: os.tmpdir()).
//   --prefix    entry-name prefix (default: "quay-"). "" = every entry.
//   --max-age   minimum idle age for removal (default: 24h).
//   --dry-run / --list  report the candidates, remove NOTHING (AC5's dry-run mode).
//   --telemetry print the one-line created/reaped/leaked record on stdout (AC4).
//   --json      machine-readable report on stdout.
//
// Exit: 0 = evaluated (removals done or dry-run); 2 = usage/environment error; 3 = NOT-EVALUATED
//       (nothing removed; the caller can tell "could not evaluate" from "evaluated and clean").

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDirectEntry, flagValue, helpExit } from "./gate-script-base.ts";

/** Names never removed by the bounded-age sweep even when they look old (cross-run caches that
 *  prune themselves). Only consulted for the AGE-bound (sweep) form — see `excludesFor`. */
export const DEFAULT_EXCLUDES = ["quay-real-install-build-cache"];

export interface ReapOptions {
  root: string;
  prefix?: string;
  maxAgeMs?: number;
  dryRun?: boolean;
  excludes?: string[];
  /** Name PREFIXES never removed — the `quay-run-<id>` namespace family is swept by
   *  run-namespace-sweep.mjs on an OWNER-LIVENESS criterion (a live tmux server), which an age gate
   *  must not second-guess: deleting a live namespace's dir would orphan its still-running server by
   *  removing the socket it is reachable through. */
  excludePrefixes?: string[];
  /** Alternate proc filesystem (hermetic tests). Default: "/proc". */
  procRoot?: string;
  now?: number;
}

export interface ReapReport {
  root: string;
  evaluated: boolean;
  /** Non-null exactly when evaluated === false: why the reaper refused to judge. */
  reason: string | null;
  prefix: string;
  maxAgeMs: number;
  dryRun: boolean;
  /** Entries present in the root at scan time (= `created`, a lower bound — see the header). */
  created: number;
  candidates: string[];
  reaped: string[];
  failed: { path: string; error: string }[];
  sparedYoung: string[];
  sparedLiveCwd: string[];
  sparedExcluded: string[];
  /** Entries still present AFTER the removal pass — what the next run would inherit. */
  leaked: string[];
  liveCwdsRead: number;
}

/** Parse a human duration: "0", "90s", "30m", "24h", "7d", or a bare number of SECONDS. */
export function parseDurationMs(raw: string): number | null {
  const s = String(raw).trim();
  if (s === "") return null;
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "s";
  const mult = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return Math.round(n * mult);
}

/**
 * Read every live process's cwd from <procRoot>/<pid>/cwd.
 *
 * `readable` is the guard that keeps 硬规则 3b out of the destructive path: it is true only when at
 * least one cwd was actually resolved. A run where NOTHING was readable (wrong --proc-root, /proc
 * hidden in a container, a permissions wall) must not be interpreted as "no process owns anything".
 */
export function readLiveCwds(procRoot = "/proc"): { cwds: Set<string>; readable: boolean; read: number } {
  const cwds = new Set<string>();
  let read = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return { cwds, readable: false, read: 0 };
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    let cwd: string;
    try {
      cwd = fs.readlinkSync(path.join(procRoot, name, "cwd"));
    } catch {
      // EACCES (another user's process) / ESRCH (exited between readdir and readlink): skip — the
      // entry is counted as not-read, never as "has no cwd".
      continue;
    }
    if (cwd.endsWith(" (deleted)")) continue; // a deleted dir owns nothing on disk
    cwds.add(cwd);
    read += 1;
  }
  return { cwds, readable: read > 0, read };
}

/** True when `entryPath` is (or contains) any live process cwd. */
export function isHeldByLiveProcess(entryPath: string, cwds: Iterable<string>): boolean {
  const target = path.resolve(entryPath);
  const withSep = target.endsWith(path.sep) ? target : target + path.sep;
  for (const cwd of cwds) {
    if (cwd === target) return true;
    if (cwd.startsWith(withSep)) return true;
  }
  return false;
}

/**
 * The one telemetry line (AC4). `evaluated=false` renders a DISTINCT token in every field — a
 * consumer can never read "the reaper never ran" as "leaked=0".
 */
export function tempRootTelemetryLine(r: {
  root: string;
  evaluated: boolean;
  reason?: string | null;
  created: number;
  reaped: number;
  leaked: number;
}): string {
  if (!r.evaluated) {
    return (
      `tmp-root-telemetry: root=${r.root} created=NOT-EVALUATED reaped=NOT-EVALUATED ` +
      `leaked=NOT-EVALUATED evaluated=false reason=${r.reason ?? "unknown"}`
    );
  }
  return (
    `tmp-root-telemetry: root=${r.root} created=${r.created} reaped=${r.reaped} ` +
    `leaked=${r.leaked} evaluated=true`
  );
}

/** Reap (or dry-run) the top-level entries of `opts.root` — the whole decision surface is here so a
 *  test can drive every branch without spawning anything. Never throws. */
export function reapTempRoots(opts: ReapOptions): ReapReport {
  const root = path.resolve(opts.root);
  const prefix = opts.prefix ?? "quay-";
  const maxAgeMs = opts.maxAgeMs ?? 24 * 3_600_000;
  const dryRun = opts.dryRun === true;
  // ⛔ `undefined` means "the documented default set"; an explicit `[]` (CLI --no-default-excludes)
  // means "exclude nothing". A single `?? []` would silently drop the shared build cache.
  const excludes = new Set(opts.excludes ?? DEFAULT_EXCLUDES);
  const excludePrefixes = opts.excludePrefixes ?? [];
  const now = opts.now ?? Date.now();
  const report: ReapReport = {
    root,
    evaluated: false,
    reason: null,
    prefix,
    maxAgeMs,
    dryRun,
    created: 0,
    candidates: [],
    reaped: [],
    failed: [],
    sparedYoung: [],
    sparedLiveCwd: [],
    sparedExcluded: [],
    leaked: [],
    liveCwdsRead: 0,
  };
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    report.reason = "root-missing";
    return report;
  }
  const live = readLiveCwds(opts.procRoot ?? "/proc");
  report.liveCwdsRead = live.read;
  if (!live.readable) {
    // 硬规则 3b: "could not read /proc" must NOT share an output with "nothing is in use".
    report.reason = "proc-cwd-unreadable";
    return report;
  }

  const names: string[] = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith(prefix)) continue;
      names.push(name);
    }
  } catch (e) {
    report.reason = `root-unreadable: ${e instanceof Error ? e.message : String(e)}`;
    return report;
  }
  names.sort();
  report.created = names.length;

  for (const name of names) {
    const p = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch (e) {
      report.failed.push({ path: p, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (excludes.has(name) || excludePrefixes.some((p) => p !== "" && name.startsWith(p))) {
      report.sparedExcluded.push(p);
      continue;
    }
    // Age gate first: an entry being written right now is not residue, and the liveness scan is the
    // more expensive test — but liveness must win over a "it looks old" verdict, so it runs for
    // every entry that passed age. mtime only (⛔ not max(mtime, ctime)): ctime cannot be backdated,
    // which would make the age axis untestable, and a directory's mtime already moves with every
    // add/remove of a direct child, so an actively-written fixture is spared by construction.
    const ageMs = now - st.mtimeMs;
    if (ageMs < maxAgeMs) {
      report.sparedYoung.push(p);
      continue;
    }
    if (isHeldByLiveProcess(p, live.cwds)) {
      report.sparedLiveCwd.push(p);
      continue;
    }
    report.candidates.push(p);
  }

  if (!dryRun) {
    for (const p of report.candidates) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
        report.reaped.push(p);
      } catch (e) {
        report.failed.push({ path: p, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Post-pass scan: LEAKED is what is still there (dry-run: everything a real pass would have left,
  // i.e. the spared set — the same reading, so the dry-run cannot over-promise a clean run).
  for (const name of names) {
    const p = path.join(root, name);
    let present = false;
    try {
      fs.lstatSync(p);
      present = true;
    } catch {
      present = false;
    }
    if (present) report.leaked.push(p);
  }

  report.evaluated = true;
  return report;
}

function usage(): string {
  return (
    "usage: node --experimental-strip-types temp-root-reaper.ts [--root <dir>] [--prefix <p>]\n" +
    "         [--max-age <0|90s|30m|24h|7d>] [--dry-run|--list] [--telemetry] [--json]\n" +
    "         [--exclude <name>]... [--exclude-prefix <p>]... [--no-default-excludes]\n" +
    "         [--proc-root <dir>] [--help]\n" +
    "\n" +
    "Bounded-age reaper for leftover <tmp>/quay-* roots. NEVER removes an entry a live process has\n" +
    "as its cwd. Prints `tmp-root-telemetry: root=… created=N reaped=N leaked=N evaluated=true`\n" +
    "(--telemetry), with NOT-EVALUATED in every field when it refused to judge.\n" +
    "\n" +
    "Exit: 0 = evaluated; 2 = usage/env error; 3 = NOT-EVALUATED (nothing removed)."
  );
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage());

  const root = flagValue(args, "--root") ?? os.tmpdir();
  const prefix = flagValue(args, "--prefix") ?? "quay-";
  const rawMaxAge = flagValue(args, "--max-age");
  const maxAgeMs = rawMaxAge === undefined ? 24 * 3_600_000 : parseDurationMs(rawMaxAge);
  if (maxAgeMs === null) {
    process.stderr.write(`temp-root-reaper: cannot parse --max-age '${rawMaxAge}'\n${usage()}\n`);
    return 2;
  }
  const procRoot = flagValue(args, "--proc-root") ?? "/proc";
  const dryRun = args.includes("--dry-run") || args.includes("--list");
  const asJson = args.includes("--json");
  const telemetry = args.includes("--telemetry");

  const excludes: string[] = [];
  if (!args.includes("--no-default-excludes")) excludes.push(...DEFAULT_EXCLUDES);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--exclude" && args[i + 1] && !args[i + 1].startsWith("--")) excludes.push(args[i + 1]);
  }
  const excludePrefixes: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--exclude-prefix" && args[i + 1] && !args[i + 1].startsWith("--")) excludePrefixes.push(args[i + 1]);
  }

  const report = reapTempRoots({ root, prefix, maxAgeMs, dryRun, excludes, excludePrefixes, procRoot });

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else if (telemetry) {
    process.stdout.write(
      tempRootTelemetryLine({
        root: report.root,
        evaluated: report.evaluated,
        reason: report.reason,
        created: report.created,
        reaped: report.reaped.length,
        leaked: report.leaked.length,
      }) + "\n",
    );
  } else {
    const verb = dryRun ? "would remove" : "removed";
    process.stdout.write(
      `temp-root-reaper: root=${report.root} prefix='${report.prefix}' max-age=${report.maxAgeMs}ms ` +
        `dry-run=${dryRun} created=${report.created} ${verb}=${report.candidates.length} ` +
        `leaked=${report.leaked.length}\n`,
    );
    const shown = report.candidates.slice(0, 3);
    for (const p of shown) process.stdout.write(`  ${dryRun ? "would-remove" : "remove"}: ${p}\n`);
    if (report.candidates.length > shown.length) {
      process.stdout.write(`  … (+${report.candidates.length - shown.length} more)\n`);
    }
    if (report.sparedLiveCwd.length > 0) {
      process.stdout.write(`  spared (live process cwd): ${report.sparedLiveCwd.join(", ")}\n`);
    }
    if (report.sparedYoung.length > 0) {
      process.stdout.write(`  spared (younger than max-age): ${report.sparedYoung.length} entr(ies)\n`);
    }
    if (report.failed.length > 0) {
      process.stdout.write(`  FAILED to remove: ${report.failed.map((f) => `${f.path} (${f.error})`).join(", ")}\n`);
    }
  }

  if (!report.evaluated) return 3;
  return 0;
}

if (isDirectEntry(import.meta, process.argv[1], "temp-root-reaper")) {
  process.exit(main(process.argv));
}
