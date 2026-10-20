#!/usr/bin/env node
// suite-scheduler.ts — the unified suite scheduler (gap-suite-dynamic-waterline-scheduler; the
// waterline semantics REDEFINED as a RELIABILITY cap by gap-suite-scheduler-reliability-cap-not-speed).
//
// Replaces the static phase-splitting (static → serial → lowconc → main, + PHASE_OVERLAP) with ONE
// event-driven loop: every test file keeps its group
// (serial / lowconc / main), each group has its own concurrency budget (host-derived, reused from
// the existing formulas), and the scheduler dispatches greedily per group under ONE TOTAL CAP.
//
// THE WATERLINE (redefined as a RELIABILITY cap, NOT a speed optimization — 水位语义):
//   - At any instant, the TOTAL concurrency across ALL THREE groups (serial + lowconc + main) must
//     not exceed the MINIMUM budget among the groups that currently have ≥1 file running
//     (currentCap). A group that is not running imposes no cap.
//   - This is a MIN-LOCK OVER THE ACTIVE GROUPS (人 2026-09-04 ruling). The goal is RELIABILITY —
//     never run more files than the lowest concurrency tier that is currently loaded can tolerate.
//     The OLD semantic — "main uses the remaining capacity (main_budget − active_serial −
//     active_lowconc)" — let main balloon to its large budget alongside serial/lowconc and saturate
//     every core (round #985: 92% of wall time pinned at 28–29 concurrent), starving the B-class
//     waiting probes (loadavg 22–26 / cpu_stall 37–62%). SPEED WAS NEVER A VALID AC for this
//     mechanism (人 2026-09-04).
//   - HISTORICAL NOTE: the original gap-suite-dynamic-waterline-scheduler chose "main uses
//     remaining" over a min lock on the strength of a ONE-OFF simulation (706s vs 515s). That
//     comparison was NEVER validated against a real full-suite round (its AC4/AC5 sat unchecked,
//     marked 待外部) and is hereby OVERRULED — it must not be cited as a design basis again.
//
// A STATIC global min lock (cap EVERYTHING at min(S,L,M) even when only main is active) is NOT this
// semantic: currentCap locks only over the groups that are CURRENTLY active, so once serial/lowconc
// drain to zero, main recovers its FULL budget (no permanent slow-down from a tier that has already
// finished — the AC3 regression).
//
// This module is TWO layers:
//   1. PURE scheduling core (currentCap / nextDispatch / simulateSchedule) — no process spawning,
//      unit-tested by plugin/test/suite-scheduler.test.mjs for the reliability-cap invariant
//      (total ≤ min active budget at every event), the low-tier-drain → main-recovers regression,
//      and pass/fail-neutrality.
//   2. The execution entry (runScheduler + CLI) — runs each dispatched file through node:test's
//      run({files:[file], isolation:"process"}) with dropRawDiagnostics→spec→stdout (the outer
//      runner's 判绿 markers) and emits the SAME per-file/group markers the downstream accounting
//      reads (`__PERFILE__` / `__GROUP__` / `__OVERHEAD__ <phase>_ms`).
//
// Pass/fail-neutral (AC3): the scheduler changes SCHEDULING ONLY — every input file is run exactly
// once, the same assertions execute, and the exit code is non-zero iff ≥1 file failed/cancelled
// (node:test's own per-file summary tally, accumulated). A scheduling bug can never DROP a test.
//
// Usage (RAW file paths on stdin, one per line — classification + LPT now live IN this module,
// gap-suite-classification-lpt-scheduler-ts-ization; test.sh no longer pre-classifies or pre-LPTs):
//   printf '%s\n' <file>... \
//     | node --experimental-strip-types suite-scheduler.ts \
//         --root <repo> --main-root <main-checkout> \
//         --serial-concurrency <S> --lowconc-concurrency <L> --main-concurrency <M> \
//         [--groups <product,engine,serial,lowconc>] [--rounds <N>] [--test-name-pattern=<pat> ...]
//
// The INPUT CONTRACT is now the raw deduped file list (build_deduped_files' realpaths). This module:
//   1. CLASSIFIES each file (classifyFile from runner-grouping.ts — product+engine → main, serial →
//      serial, lowconc → lowconc), then applies the optional --groups filter (default = all four).
//   2. LPT-ORDERS each group (suite-lpt-order.ts loadDurationAverages + orderByLpt, off
//      --main-root/.quay/verification-round.jsonl — the EXISTING carrier, no new measurer). LPT is
//      scheduling-only (every file emitted exactly once) and FAIL-OPEN (no history ⇒ unchanged);
//      QUAY_TEST_LPT_ORDER=0 is the one-key rollback.
//   3. SCHEDULES via the reliability cap (runScheduler below).
//
// The only forwarded node --test flag is --test-name-pattern[=X] (mapped to run()'s testNamePatterns,
// the same parse as suite-lpt-runner.mjs); any --test-concurrency[=N] flag is STRIPPED (the scheduler
// owns concurrency — one source, no drift).

import { run } from "node:test";
import { spec } from "node:test/reporters";
import path from "node:path";
import { isDirectEntry, parseArgs as baseParseArgs } from "./gate-script-base.ts";
import { classifyFile, type DeclaredGroup } from "./runner-grouping.ts";
import { loadDurationAverages, orderByLpt, loadBaselineDurations, type LptReport } from "./suite-lpt-order.ts";
import { dropRawDiagnostics, readPerFileCpuMs, readPerFileMemPeakKb } from "./measure-suite-reporter.mjs";

export type SuiteGroup = "serial" | "lowconc" | "main";
export const SUITE_GROUPS: SuiteGroup[] = ["serial", "lowconc", "main"];

/** The per-group concurrency budgets. The TOTAL across all three groups is capped at the MINIMUM
 *  budget among the groups that currently have ≥1 file running (see currentCap). */
export interface SchedulerBudgets {
  serial: number;
  lowconc: number;
  main: number;
}

/** The currently-running file count per group. */
export interface ActiveCounts {
  serial: number;
  lowconc: number;
  main: number;
}

export interface GroupQueues {
  serial: string[];
  lowconc: string[];
  main: string[];
}

/** THE reliability cap: the MINIMUM budget among the groups that currently have ≥1 file running
 *  (active[g] > 0). A group with active[g] === 0 imposes NO cap (it does not participate in the
 *  min). When NOTHING is running the cap is +∞ (no total limit — the per-group budgets decide who
 *  starts first). This is a min-lock OVER THE ACTIVE GROUPS (人 2026-09-04), NOT the old
 *  "main uses the remaining capacity" — the three-group total must stay ≤ this cap at every instant. */
export function currentCap(budgets: SchedulerBudgets, active: ActiveCounts): number {
  let cap = Infinity;
  if (active.serial > 0 && budgets.serial < cap) cap = budgets.serial;
  if (active.lowconc > 0 && budgets.lowconc < cap) cap = budgets.lowconc;
  if (active.main > 0 && budgets.main < cap) cap = budgets.main;
  return cap;
}

/** Start queued files under the reliability cap, in serial → lowconc → main priority order.
 *  A FIXED-POINT loop: before starting any file it recomputes currentCap from the would-be active
 *  state (active with that group +1) and refuses the start if the resulting TOTAL concurrency
 *  (serial+lowconc+main) would exceed that cap. The serial→lowconc→main TRY order is preserved (the
 *  low tiers are attempted first, keeping the "low tier starts first / judged red at the boundary"
 *  property). MUTATES queues (shift) and active (increment); returns the started {file, group} pairs. */
export function nextDispatch(
  budgets: SchedulerBudgets,
  queues: GroupQueues,
  active: ActiveCounts,
): Array<{ file: string; group: SuiteGroup }> {
  const started: Array<{ file: string; group: SuiteGroup }> = [];
  const order: SuiteGroup[] = ["serial", "lowconc", "main"];
  for (;;) {
    let startedOne = false;
    for (const g of order) {
      if (active[g] >= budgets[g] || queues[g].length === 0) continue;
      // Would-be state AFTER starting one more file in this group — the invariant must hold at the
      // post-start instant (total ≤ min budget of the groups that are then active), because a low
      // tier becoming active can LOWER the cap below the pre-start total (hard rule: cap at any instant).
      const after: ActiveCounts = { serial: active.serial, lowconc: active.lowconc, main: active.main };
      after[g]++;
      if (after.serial + after.lowconc + after.main > currentCap(budgets, after)) continue;
      started.push({ file: queues[g].shift() as string, group: g });
      active[g]++;
      startedOne = true;
      break; // re-run the fixed-point loop from the updated active state
    }
    if (!startedOne) break;
  }
  return started;
}

export interface SimEvent {
  file: string;
  group: SuiteGroup;
  start: number;
  end: number;
}

export interface SimulationResult {
  makespan: number;
  /** Completion events in time order (every file exactly once — pass/fail-neutral by construction). */
  events: SimEvent[];
  /** Per-completion snapshots of the total concurrency and the reliability cap, in time order —
   *  the AC2 invariant (total ≤ cap at every event). cap is +∞ when nothing is running. */
  trace: Array<{ total: number; cap: number }>;
}

/** A deterministic event-driven simulation of the dispatch loop given per-file durations — the SAME
 *  nextDispatch loop the real runner executes, so the test can prove the reliability-cap invariant
 *  (total ≤ min active budget at every event) and pass/fail-neutrality WITHOUT spawning processes.
 *  Durations are wall units (any scale); a file with no recorded duration is treated as 0. */
export function simulateSchedule(
  budgets: SchedulerBudgets,
  groups: GroupQueues,
  durations: Map<string, number>,
): SimulationResult {
  const queues: GroupQueues = { serial: [...groups.serial], lowconc: [...groups.lowconc], main: [...groups.main] };
  const active: ActiveCounts = { serial: 0, lowconc: 0, main: 0 };
  const running = new Map<string, { group: SuiteGroup; end: number }>();
  const events: SimEvent[] = [];
  const trace: Array<{ total: number; cap: number }> = [];
  let t = 0;

  for (;;) {
    const started = nextDispatch(budgets, queues, active);
    for (const s of started) running.set(s.file, { group: s.group, end: t + (durations.get(s.file) ?? 0) });
    if (running.size === 0) break;
    // Advance to the earliest completion (event-driven — "推进到最早完成").
    let earliest = "";
    let earliestEnd = Infinity;
    for (const [file, ev] of running) {
      if (ev.end < earliestEnd) {
        earliest = file;
        earliestEnd = ev.end;
      }
    }
    t = earliestEnd;
    const ev = running.get(earliest)!;
    running.delete(earliest);
    active[ev.group]--;
    events.push({ file: earliest, group: ev.group, start: t - (durations.get(earliest) ?? 0), end: t });
    trace.push({ total: active.serial + active.lowconc + active.main, cap: currentCap(budgets, active) });
  }
  return { makespan: t, events, trace };
}

// ── classification + LPT layer (gap-suite-classification-lpt-scheduler-ts-ization) ────────────────
// The scheduler's input is now the RAW deduped file list. This layer classifies each file into its
// suite bucket (product+engine → main, serial → serial, lowconc → lowconc), applies the optional
// --groups filter, and LPT-orders each bucket off the EXISTING verification-round carrier. The
// classification semantics are byte-identical to runner-grouping-metadata.mjs (the metadata modes'
// single-pass classifier) — classifyFile here is that same groupOf + binary-detect + fail-closed.

/** Map a declared test group to its three-bucket suite group (product/engine collapse to main). */
export function toSuiteGroup(g: DeclaredGroup): SuiteGroup {
  if (g === "serial") return "serial";
  if (g === "lowconc") return "lowconc";
  return "main";
}

/** Parse a `--groups` csv (product,engine,serial,lowconc) into the set of suite buckets it selects.
 *  product/engine → main; an unrecognized token matches nothing (a bogus --group selects no files —
 *  the same "no test files matched" behavior as the old select_files over an unknown group). */
export function groupsArgToSuiteGroups(csv: string): Set<SuiteGroup> {
  const set = new Set<SuiteGroup>();
  for (const tok of csv.split(",")) {
    const t = tok.trim();
    if (t === "serial") set.add("serial");
    else if (t === "lowconc") set.add("lowconc");
    else if (t === "product" || t === "engine") set.add("main");
  }
  return set;
}

export interface ClassifyOptions {
  /** The LPT carrier root (the MAIN checkout — where .quay/verification-round.jsonl lives) and the
   *  key-normalization root for orderByLpt. ⛔ NOT the root the SELECTED file list lives under: in
   *  production that list is the tested checkout's absolute paths (a task worktree), while `root` is
   *  the MAIN checkout — see `filesRoot`. */
  root: string;
  /** The checkout the SELECTED file list is spelled against (`--root`; the tested worktree). Defaults
   *  to `root`. Declared separately because the two differ in production: the suite runs in a task
   *  worktree while the LPT/memory carriers live in the main checkout. Used ONLY to normalize the
   *  absolute selected paths into the repo-relative spelling the runner's heavy set uses. */
  filesRoot?: string;
  rounds: number;
  lptEnabled: boolean;
  /** Optional `--groups` csv; undefined = all four groups (product,engine,serial,lowconc). */
  groups?: string;
  /** Committed last-resort duration table, consulted ONLY when the live rolling carrier is empty
   *  (a fresh CI checkout has no .quay/verification-round.jsonl — see suite-lpt-order.ts header). */
  baseline?: string;
  /** Receives the LPT provenance + whether the MAIN order actually changed, so the caller can put a
   *  real reading in the log instead of inferring "reordered" from a well-formed output (硬规则 3b). */
  onReport?: (r: LptReport) => void;
  /** The DECLARED heavy set (gap-suite-heavy-files-and-phase-concurrency-under-16g-…): files whose
   *  MEASURED high-water exceeds the project-declared threshold. They are pulled OUT of the three
   *  scheduled buckets (they still run, exactly once, in the heavy tail) — see `onHeavy`. */
  heavyFiles?: ReadonlySet<string>;
  /** Receives the heavy files actually partitioned out of the SELECTED set. ⛔ A callback rather than
   *  a fourth field on `GroupQueues`: the three-group shape IS the reliability-cap core's type, and
   *  widening it would put the heavy tail inside `currentCap`'s min-lock (a heavy file would then
   *  throttle the whole body to the heavy bound — the opposite of a memory bound). */
  onHeavy?: (files: string[]) => void;
}

/** Normalize a file key for set membership. The SAME file reaches this function under TWO spellings
 *  in production, and they must meet:
 *
 *    - the SELECTED file list is `test.sh --list-files`'s output — ABSOLUTE paths
 *      (`/…/<checkout>/plugin/test/x.test.mjs`);
 *    - the DECLARED heavy set is computed by `full-suite-runner.ts` from the round record's
 *      `perFile[].file`, which is REPO-RELATIVE (`plugin/test/x.test.mjs`).
 *
 *  ⛔ 2026-10-16 (measured, this task): with only the `./` strip below, those two never met, so
 *  `classifyAndOrder` partitioned **0** heavy files in EVERY production round while its unit test
 *  (which feeds absolute paths on BOTH sides) stayed green — the fixture-only shape of CLAUDE.md
 *  硬规则 4 推论三. The heavy tail therefore never ran: `scheduler: heavy=0≤1` was printed in every
 *  measured round even where the runner reported `5/1005 planned file(s) exceed it`.
 *
 *  ⇒ Absolute keys are resolved RELATIVE TO `root` (the checkout the suite is running in), which is
 *  the spelling the runner's heavy set already uses. A path outside `root` (or a non-absolute key)
 *  keeps its literal spelling — normalization must never merge two DIFFERENT files. */
export function normFileKey(p: string, root?: string): string {
  const stripped = p.startsWith("./") ? p.slice(2) : p;
  if (root === undefined || root === "" || !path.isAbsolute(stripped)) return stripped;
  const rel = path.relative(root, stripped);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : stripped;
}

/** classify + filter + LPT-order the raw file list into the three per-bucket queues. Scheduling-only:
 *  every retained file appears in exactly one bucket exactly once — a bug here can drop a file only by
 *  the explicit --groups filter (which is the SELECTION, not a scheduling accident). LPT FAIL-OPEN: an
 *  absent/unreadable carrier yields an empty average map and orderByLpt returns the input unchanged —
 *  in which case `onReport` says provenance=none and mainReordered=false, so the caller never mistakes
 *  "no carrier" for "reordered" (the identity list has the same line count either way). */
export function classifyAndOrder(files: string[], opts: ClassifyOptions): GroupQueues {
  const queues: GroupQueues = { serial: [], lowconc: [], main: [] };
  const include = opts.groups ? groupsArgToSuiteGroups(opts.groups) : undefined;
  for (const f of files) {
    const sg = toSuiteGroup(classifyFile(f));
    if (include && !include.has(sg)) continue;
    queues[sg].push(f);
  }
  // Partition the DECLARED heavy files out of the selected set (AFTER the --groups filter, so a
  // filtered run cannot have a heavy file escape the selection). ⛔ They are MOVED, never duplicated:
  // every file still runs exactly once per round — only its bucket changes.
  const heavy: string[] = [];
  if (opts.heavyFiles && opts.heavyFiles.size > 0) {
    const heavyKeys = new Set<string>();
    // ⛔ normalize against the SELECTED list's own root (`filesRoot`), NOT the LPT carrier root:
    // in production the list is the tested worktree's absolute paths while `root` is the main
    // checkout, so anchoring on `root` leaves every absolute key unmatched (measured 2026-10-16).
    const keyRoot = opts.filesRoot ?? opts.root;
    for (const k of opts.heavyFiles) heavyKeys.add(normFileKey(k, keyRoot));
    for (const g of SUITE_GROUPS) {
      queues[g] = queues[g].filter((f) => {
        if (!heavyKeys.has(normFileKey(f, keyRoot))) return true;
        heavy.push(f);
        return false;
      });
    }
  }
  opts.onHeavy?.(heavy);
  if (!opts.lptEnabled) {
    opts.onReport?.({ provenance: "disabled", entries: 0, files: files.length, mainReordered: false });
    return queues;
  }
  let avg = loadDurationAverages(path.join(opts.root, ".quay", "verification-round.jsonl"), opts.root, opts.rounds);
  let provenance: LptReport["provenance"] = avg.size > 0 ? "rolling-carrier" : "none";
  if (avg.size === 0 && opts.baseline) {
    const base = loadBaselineDurations(opts.baseline);
    if (base.size > 0) {
      avg = base;
      provenance = "committed-baseline";
    }
  }
  const mainBefore = [...queues.main];
  queues.serial = orderByLpt(queues.serial, avg, opts.root);
  queues.lowconc = orderByLpt(queues.lowconc, avg, opts.root);
  queues.main = orderByLpt(queues.main, avg, opts.root);
  opts.onReport?.({
    provenance,
    entries: avg.size,
    files: files.length,
    mainReordered: queues.main.some((f, i) => f !== mainBefore[i]),
  });
  return queues;
}

// ── execution layer ──────────────────────────────────────────────────────────────────────────────

interface GroupStats {
  durs: number[];
  failed: number;
  startMs: number | null;
  endMs: number | null;
}

export interface RunResult {
  failed: number;
  /** files that finished with a non-zero exit (or a signal) — the pass/fail-neutral aggregate. */
  failedFiles: string[];
}

// The raw-diagnostic filter (`dropRawDiagnostics`) is IMPORTED from measure-suite-reporter.mjs —
// the same exported function suite-lpt-runner.mjs wires, never a private copy. The two files used
// to carry byte-identical bodies (semantic-dedup-scan finding `suite-lpt-drop-diagnostics`, runId
// `semantic-dedup-scan-1792405443214`, kind `byte-identical-body`, verdict `real-duplication`,
// requested action `extract`); the shared body now lives in the module both already import.

/**
 * Run the suite through the event-driven scheduler. Each dispatched file runs through node:test's
 * `run({files:[file], isolation:"process"})` (the SAME in-process runner suite-lpt-runner.mjs uses)
 * with `dropRawDiagnostics → spec → stdout` composed (spec: the outer runner's 判绿 markers, raw
 * diagnostics dropped) and the per-file verdict read from the ROOT test:summary counts (single
 * source, no driftable exit-code counter). Emits:
 *   __PERFILE__ duration_ms=<d> <path> passed=<bool> end_ms=<epoch> [cpu_ms=] [mem_peak_kb=]   per file (the LPT input carrier)
 *   __GROUP__ concurrency=<budget> files=<n> sum_ms=<sum> floor_ms=<floor> capped=<m>   per group close
 *   __OVERHEAD__ <serial|lowconc|main>_phase_ms=<n>   per group wall  (the AC4/AC5 cost carriers)
 *   __OVERHEAD__ scheduler_ms=<n>                     total wall
 * Returns the failed-file count (exit code = failed>0 ? 1 : 0 — the SAME tally semantics as
 * suite-lpt-runner.mjs's failed+cancelled). The scheduler is ALWAYS a top-level CLI (test.sh's
 * child, never under `node --test`), so `run()`'s isolation children never inherit
 * NODE_TEST_CONTEXT (a nested marker that would make them skip their files and report green).
 */
export function runScheduler(opts: {
  budgets: SchedulerBudgets;
  groups: GroupQueues;
  testNamePatterns: string[];
  /** The DECLARED heavy tail (gap-suite-heavy-files-and-phase-concurrency-under-16g-…): files whose
   *  measured high-water exceeds the project-declared threshold, plus the declared co-run BOUND.
   *  Absent ⇒ no heavy tail (the mechanism is OFF — ⛔ no default bound in code). */
  heavy?: { files: string[]; concurrency: number };
}): Promise<RunResult> {
  const { budgets, groups, testNamePatterns, heavy } = opts;
  const queues: GroupQueues = { serial: [...groups.serial], lowconc: [...groups.lowconc], main: [...groups.main] };
  const active: ActiveCounts = { serial: 0, lowconc: 0, main: 0 };
  const stats: Record<SuiteGroup, GroupStats> = {
    serial: { durs: [], failed: 0, startMs: null, endMs: null },
    lowconc: { durs: [], failed: 0, startMs: null, endMs: null },
    main: { durs: [], failed: 0, startMs: null, endMs: null },
  };
  let nextId = 1;
  const running = new Map<number, { file: string; group: SuiteGroup | "heavy"; startMs: number }>();
  const failedFiles: string[] = [];
  const schedulerStartMs = Date.now();
  // ── the HEAVY tail's own accounting (deliberately OUTSIDE `stats`/`active`) ────────────────────
  // `active` and `stats` are keyed by `SuiteGroup`, i.e. by the reliability-cap core's buckets. The
  // heavy tail must NOT join them: `currentCap` is a min-lock over the ACTIVE groups, so a heavy
  // group with the (small) declared bound would throttle the whole body to that bound whenever a
  // heavy file ran — the bound is a MEMORY ceiling, not a load-tolerance tier, and conflating the
  // two would silently make every round as slow as the heavy bound. So the heavy queue is tracked
  // separately and dispatched only in the tail, when nothing else is running.
  const heavyQueue: string[] = [...(heavy?.files ?? [])];
  // `null` = the bucket was never DECLARED (three-valued, not a 0 that a reader must know to read as
  // "off" — hard rule 3b). It is also what keeps this file free of an undeclared concurrency literal:
  // the bound only ever exists because a project declared it (concurrency-literal-check, gate mode).
  const heavyBound: number | null = heavy ? heavy.concurrency : null;
  let heavyActive = 0;
  const heavyStats: GroupStats = { durs: [], failed: 0, startMs: null, endMs: null };

  return new Promise<RunResult>((resolve) => {
    const finishFile = (id: number, failedCount: number) => {
      const rec = running.get(id);
      if (!rec) return;
      running.delete(id);
      const isHeavy = rec.group === "heavy";
      if (isHeavy) heavyActive--;
      else active[rec.group]--;
      const dur = Math.max(0, Date.now() - rec.startMs);
      const st = isHeavy ? heavyStats : stats[rec.group];
      const passed = failedCount === 0;
      st.durs.push(dur);
      if (!passed) {
        st.failed++;
        failedFiles.push(rec.file);
      }
      st.endMs = Date.now();
      // gap-suite-scheduler-perfile-cpu-emitter-missing — the unified scheduler's __PERFILE__ line
      // must carry the SAME per-file CPU the legacy/LPT path emits. Reuse measure-suite-reporter's
      // single reader (readPerFileCpuMs) — ⛔ NOT a second hand-rolled read: absent = "not measured"
      // (field omitted), never a fabricated 0 (硬规则 3b).
      // gap-perfile-memory-cost-collection-missing — the peak-memory dimension rides the SAME two
      // readers here. This scheduler path is the PRODUCTION DEFAULT since 2026-08-31, so leaving it
      // out would repeat gap-suite-scheduler-perfile-cpu-emitter-missing exactly (field dark in
      // production while the legacy path's tests stay green). ⛔ Both emission points, both fields.
      const cpuMs = readPerFileCpuMs(rec.file);
      const cpuPart = cpuMs !== undefined ? ` cpu_ms=${cpuMs}` : "";
      const memPeakKb = readPerFileMemPeakKb(rec.file);
      const memPart = memPeakKb !== undefined ? ` mem_peak_kb=${memPeakKb}` : "";
      process.stderr.write(`__PERFILE__ duration_ms=${dur} ${rec.file} passed=${passed} end_ms=${st.endMs}${cpuPart}${memPart}\n`);
      // A group closes when its queue is drained AND nothing of it is still running — emit its
      // __GROUP__ + __OVERHEAD__ <group>_phase_ms once, at close (the downstream accounting reads
      // one __GROUP__ per group, same shape as measure-suite-reporter's per-phase line).
      if (isHeavy) {
        if (heavyQueue.length === 0 && heavyActive === 0) emitGroup("heavy", heavyBound, heavyStats);
      } else if (queues[rec.group].length === 0 && active[rec.group] === 0) {
        emitGroup(rec.group, budgets[rec.group], st);
      }
      tick(); // re-dispatch on the freed capacity (event-driven — "推进到最早完成")
    };

    // Run ONE file through node:test run({files:[file]}) and resolve its failed+cancelled tally
    // (read from the ROOT test:summary — data.file === undefined — the single source, same as the
    // legacy runner). A stream "error" (e.g. a missing file) is fail-loud: resolve non-zero so the
    // file is never silently dropped.
    const driveFile = (file: string): Promise<number> =>
      new Promise<number>((resolveFile) => {
        // One file per run() call, so the run-wide `concurrency` knob is irrelevant (node:test's
        // default is host-derived but the queue holds exactly one file) — the GROUP concurrency is
        // owned by nextDispatch above, not by node:test's file-level scheduler.
        const stream = run({
          files: [file],
          isolation: "process",
          ...(testNamePatterns.length > 0 ? { testNamePatterns } : {}),
        });
        stream.compose(dropRawDiagnostics()).compose(spec).pipe(process.stdout);
        let failed = 0;
        stream.on("data", (chunk) => {
          let obj = chunk;
          if (Buffer.isBuffer(obj)) obj = JSON.parse(obj.toString());
          if (typeof obj === "string") obj = JSON.parse(obj);
          if (obj && typeof obj === "object" && obj.type === "test:summary") {
            const data = obj.data;
            if (data && data.file === undefined && data.counts) {
              failed = (data.counts.failed ?? 0) + (data.counts.cancelled ?? 0);
            }
          }
        });
        stream.on("end", () => resolveFile(failed));
        stream.on("error", () => resolveFile(failed + 1));
      });

    const tick = () => {
      // ── the HEAVY tail ────────────────────────────────────────────────────────────────────────
      // Dispatched ONLY when the three scheduled buckets are completely drained (nothing running,
      // every queue empty), up to the DECLARED bound at a time. Two properties fall out of that
      // placement, both load-bearing under a 16 GiB ceiling: (1) "never co-run beyond the declared
      // count" is a property of the SCHEDULE, not of the waterline's arithmetic holding under every
      // group mix; (2) the bucket's peak is (bound × the heaviest file) and can NEVER be additive
      // with the body's — which is the entire reason to bound them separately.
      // ⛔ The gate is "the BODY has fully drained" — nothing running AND all three queues empty —
      // not merely "nothing is running right now": at the very first tick nothing is running yet, so
      // a `running.size === 0` test alone would start the heavy tail BEFORE the body and make the two
      // additive (measured: body1 overlapped heavy1). The three queues empty is what makes this a TAIL.
      if (
        heavyBound !== null &&
        heavyQueue.length > 0 &&
        running.size === 0 &&
        queues.serial.length === 0 &&
        queues.lowconc.length === 0 &&
        queues.main.length === 0
      ) {
        while (heavyActive < heavyBound && heavyQueue.length > 0) {
          const file = heavyQueue.shift() as string;
          heavyActive++;
          heavyStats.startMs ??= Date.now();
          const id = nextId++;
          running.set(id, { file, group: "heavy", startMs: Date.now() });
          driveFile(file).then((failedCount) => finishFile(id, failedCount));
        }
      }
      const started = nextDispatch(budgets, queues, active);
      for (const s of started) {
        const st = stats[s.group];
        if (st.startMs === null) st.startMs = Date.now();
        const id = nextId++;
        running.set(id, { file: s.file, group: s.group, startMs: Date.now() });
        driveFile(s.file).then((failedCount) => finishFile(id, failedCount));
      }
      if (
        running.size === 0 &&
        queues.serial.length === 0 &&
        queues.lowconc.length === 0 &&
        queues.main.length === 0 &&
        heavyQueue.length === 0
      ) {
        process.stderr.write(`__OVERHEAD__ scheduler_ms=${Date.now() - schedulerStartMs}\n`);
        resolve({ failed: failedFiles.length, failedFiles });
      }
    };

    // No custom signal handler: on SIGTERM/SIGINT the default disposition terminates this process
    // (the whole process group — including the isolation children — is killed by the outer runner's
    // tree kill). Matches suite-lpt-runner.mjs, which likewise relies on default signal termination.
    tick();
  });
}

/** Emit the group's __GROUP__ + __OVERHEAD__ <group>_phase_ms lines (measure-suite-reporter's
 *  group-floor shape: floor = max(sum/concurrency, longest) — auto-evaluated, no human arithmetic). */
function emitGroup(group: SuiteGroup | "heavy", concurrency: number, st: GroupStats): void {
  if (st.startMs === null || st.endMs === null || st.durs.length === 0) return; // group never ran
  const sumMs = st.durs.reduce((a, b) => a + b, 0);
  const longestMs = Math.max(...st.durs);
  const floorMs = Math.max(sumMs / Math.max(concurrency, 1), longestMs);
  process.stderr.write(
    `__GROUP__ concurrency=${concurrency} files=${st.durs.length} sum_ms=${sumMs} floor_ms=${floorMs} capped=0\n`,
  );
  process.stderr.write(`__OVERHEAD__ ${group}_phase_ms=${st.endMs - st.startMs}\n`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

// The flag loop is the SHARED spec-driven parser (gate-script-base.ts); this wrapper only maps the
// parsed flags onto this command's typed shape. It used to be a private if/else chain — one of the
// four residual carriers named by semantic-dedup-scan finding `parseargs-handrolled-residuals`
// (runId `semantic-dedup-scan-1791631645924`, suggestedAction `unify`).
//
// THIS ONE IS AN ARGV SINK, and that is what the two unusual spec keys are for: `test.sh` forwards
// its OWN argv straight through to `node --test`, so most tokens here belong to that consumer, not
// to the scheduler. `unknown: "skip"` drops a flag it does not know WITHOUT eating the token after
// it (the base's default, "accept", would consume it as though it were the unknown flag's value);
// `help: "return"` keeps the `--help` TEXT here (the caller owns its multi-line usage) while the
// base owns the detection — the arm below is unchanged in what it writes and what it returns.
// `--test-name-pattern` is the arity-1 `string[]` form: REPEATED, accumulating one value per
// occurrence, which the single-valued `flags` map cannot express (last write would win).
//
// ⛔ `--test-concurrency` is DECLARED but deliberately unread — the scheduler owns concurrency, so
// the value is stripped rather than honored (one source, no drift). An undeclared flag would take
// the `skip` arm and leave its value as a stray positional; declaring it is what makes the stripping
// explicit.
function parseArgs(argv: string[]): {
  budgets: SchedulerBudgets;
  testNamePatterns: string[];
  root: string;
  mainRoot: string;
  baseline: string;
  groups?: string;
  rounds: number;
  help: boolean;
} {
  const { flags, lists, help } = baseParseArgs(argv, {
    minArgs: 0,
    usage: "--root <repo> --main-root <main-checkout> --serial-concurrency <S> --lowconc-concurrency <L> --main-concurrency <M> [--groups <csv>] [--rounds <N>] [--baseline <path>] [<node --test flags...>]",
    help: "return",
    unknown: "skip",
    flags: {
      root: { type: "string" },
      "main-root": { type: "string" },
      baseline: { type: "string" },
      groups: { type: "string" },
      rounds: { type: "string" },
      "serial-concurrency": { type: "string" },
      "lowconc-concurrency": { type: "string" },
      "main-concurrency": { type: "string" },
      "test-concurrency": { type: "string" },
      "test-name-pattern": { type: "string[]" },
    },
  });
  // A flag that carried no value at all reads as "" from the parser (trailing `--flag`, or an
  // explicit `--flag ""`); neither names a value, so both fall back to the default. The old loop
  // distinguished them only by SKIPPING a valueless trailing flag entirely — same net reading.
  const str = (v: string | boolean | undefined): string | undefined =>
    typeof v === "string" && v !== "" ? v : undefined;
  const budget = (v: string | boolean | undefined): number => Math.max(1, Number(str(v) ?? "") || 1);
  let rounds = Number(process.env.QUAY_TEST_LPT_ROUNDS);
  if (!Number.isInteger(rounds) || rounds < 1) rounds = 3;
  const n = Number(str(flags.rounds) ?? "");
  if (Number.isInteger(n) && n >= 1) rounds = n;
  const root = str(flags.root) ?? process.cwd();
  const mainRoot = str(flags["main-root"]) ?? "";
  return {
    budgets: {
      serial: budget(flags["serial-concurrency"]),
      lowconc: budget(flags["lowconc-concurrency"]),
      main: budget(flags["main-concurrency"]),
    },
    testNamePatterns: lists?.["test-name-pattern"] ?? [],
    root,
    mainRoot: mainRoot || root,
    groups: str(flags.groups),
    rounds,
    help: help === true,
  };
}

/** Read the RAW deduped file list from stdin (one path per line — build_deduped_files' realpaths). */
async function readFiles(): Promise<string[]> {
  const raw = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  return raw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
}

async function main(argv: string[]): Promise<number> {
  const { budgets, testNamePatterns, root: filesRoot, mainRoot, baseline, groups: groupsArg, rounds, help } = parseArgs(argv);
  if (help) {
    // `--help` is DETECTED by the shared parser (`help: "return"`) and PRINTED here — the text stays
    // at the command that owns the contract. Unchanged: stderr, exit 0.
    process.stderr.write(
      "suite-scheduler.ts — unified group-budget suite scheduler (gap-suite-dynamic-waterline-scheduler)\n" +
        "usage: <raw file paths on stdin, one per line> | node suite-scheduler.ts \\\n" +
        "         --root <repo> --main-root <main-checkout> \\\n" +
        "         --serial-concurrency <S> --lowconc-concurrency <L> --main-concurrency <M> \\\n" +
        "         [--groups <csv>] [--rounds <N>] [--baseline <path>] [<node --test flags...>]\n",
    );
    return 0;
  }
  const files = await readFiles();
  if (files.length === 0) {
    process.stderr.write("suite-scheduler: no test files on stdin\n");
    return 2;
  }
  // ── the DECLARED heavy bucket (gap-suite-heavy-files-and-phase-concurrency-under-16g-…) ────────
  // Both halves come from the environment, put there by the RUNNER (config → env, so a declared
  // value survives a driver restart and an operator can override it per host). ⛔ The runner OWNS
  // the measurement — this module never re-derives the set from a duration/memory carrier, because
  // two derivations of "which files are heavy" would be two answers free to disagree (硬规则 1).
  //
  // The bucket is ON only when BOTH halves are readable. A file list with no readable bound is
  // reported LOUDLY and those files stay in the normal schedule: running them at an undeclared bound
  // would be a schedule nobody asked for, and dropping them would shrink the suite silently
  // (硬规则 3b). A fresh checkout with no measurement history simply has no list at all.
  let heavyFiles: string[] = [];
  let heavyConcurrencyBudget = 0;
  let partitionedHeavy: string[] = [];
  const heavyListRaw = process.env.QUAY_SUITE_HEAVY_FILES ?? "";
  const heavyList = heavyListRaw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  if (heavyList.length > 0) {
    const bound = Number(process.env.QUAY_SUITE_HEAVY_MAX_CONCURRENT ?? "");
    if (Number.isInteger(bound) && bound >= 1) {
      heavyFiles = heavyList;
      heavyConcurrencyBudget = bound;
    } else {
      process.stderr.write(
        `scheduler: ⚠️ QUAY_SUITE_HEAVY_FILES names ${heavyList.length} file(s) but QUAY_SUITE_HEAVY_MAX_CONCURRENT ` +
          `is '${process.env.QUAY_SUITE_HEAVY_MAX_CONCURRENT ?? ""}' (must be an integer ≥ 1) ⇒ the heavy bucket is NOT applied ` +
          `and those files keep their normal schedule (membership preserved; nothing is dropped)\n`,
      );
    }
  }
  const groups = classifyAndOrder(files, {
    root: mainRoot,
    filesRoot,
    rounds,
    lptEnabled: process.env.QUAY_TEST_LPT_ORDER !== "0",
    groups: groupsArg,
    baseline: baseline || undefined,
    heavyFiles: new Set(heavyFiles),
    onHeavy: (partitioned) => {
      partitionedHeavy = partitioned;
      process.stderr.write(
        `scheduler: heavy=${partitioned.length}≤${heavyConcurrencyBudget} (declared bucket; runs in the tail, alone)\n`,
      );
    },
    onReport: (r) =>
      // The REAL reorder reading — provenance says WHICH carrier supplied durations, so a log reader
      // never has to infer "LPT ran" from the absence of an error (硬规则 3b).
      process.stderr.write(
        `scheduler: lpt provenance=${r.provenance} entries=${r.entries} files=${r.files} main_reordered=${r.mainReordered}\n`,
      ),
  });
  const total = groups.serial.length + groups.lowconc.length + groups.main.length + partitionedHeavy.length;
  if (total === 0) {
    process.stderr.write(`suite-scheduler: no test files matched --groups '${groupsArg ?? "all"}' on stdin\n`);
    return 2;
  }
  process.stderr.write(
    `scheduler: serial=${groups.serial.length}≤${budgets.serial} lowconc=${groups.lowconc.length}≤${budgets.lowconc} main=${groups.main.length}≤${budgets.main} (reliability cap: total ≤ min budget of active groups)\n`,
  );
  const result = await runScheduler({
    budgets,
    groups,
    testNamePatterns,
    ...(partitionedHeavy.length > 0 ? { heavy: { files: partitionedHeavy, concurrency: heavyConcurrencyBudget } } : {}),
  });
  return result.failed > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "suite-scheduler")) {
  main(process.argv).then((code) => process.exit(code));
}
