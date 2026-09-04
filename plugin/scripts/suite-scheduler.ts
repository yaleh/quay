#!/usr/bin/env node
// suite-scheduler.ts — the unified suite scheduler (gap-suite-dynamic-waterline-scheduler).
//
// Replaces the static phase-splitting (static → serial → lowconc → main, + PHASE_OVERLAP + the A
// main-tail-overlap watcher) with ONE event-driven loop: every test file keeps its group
// (serial / lowconc / main), each group has its own concurrency budget (host-derived, reused from
// the existing formulas), and the scheduler dispatches greedily per group with a MONOTONIC WATERLINE.
//
// THE WATERLINE (the semantic this task exists to establish — 水位语义, NOT a global min lock):
//   - serial  files run at ≤ serial_budget,  independently of every other group.
//   - lowconc files run at ≤ lowconc_budget, independently of every other group.
//   - main    files run at ≤ main_budget − (ACTIVE serial + ACTIVE lowconc)  — "main uses the
//     remaining capacity". As the finite low groups complete, active serial/lowconc only DEcrease
//     (they are dispatched greedily up-front), so main's capacity rises MONOTONICALLY toward the
//     main budget. There is NO CPU-load detection — the waterline is a STRUCTURAL guarantee that
//     replaces the A watcher's stall-polling.
//
// A global min lock (cap EVERYTHING at min(S,L,M)) is the REJECTED alternative: it forces the whole
// suite to the lowest group's concurrency whenever a single low-conc file is present, discarding the
// serial∥lowconc overlap parallelism the current phased schedule already has (the proposal's
// simulation measured min-lock 706s vs waterline 515s, i.e. min-lock is +8% SLOWER).
//
// This module is TWO layers:
//   1. PURE scheduling core (mainCapacity / nextDispatch / simulateSchedule / simulateMinLock) — no
//      process spawning, unit-tested by plugin/test/suite-scheduler.test.mjs for the waterline
//      semantics, monotonicity, pass/fail-neutrality, and the min-lock control.
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
//   3. SCHEDULES via the waterline (runScheduler below).
//
// The only forwarded node --test flag is --test-name-pattern[=X] (mapped to run()'s testNamePatterns,
// the same parse as suite-lpt-runner.mjs); any --test-concurrency[=N] flag is STRIPPED (the scheduler
// owns concurrency — one source, no drift).

import { run } from "node:test";
import { spec } from "node:test/reporters";
import { Transform } from "node:stream";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { classifyFile, type DeclaredGroup } from "./runner-grouping.ts";
import { loadDurationAverages, orderByLpt } from "./suite-lpt-order.ts";

export type SuiteGroup = "serial" | "lowconc" | "main";
export const SUITE_GROUPS: SuiteGroup[] = ["serial", "lowconc", "main"];

/** The per-group concurrency budgets. serial/lowconc are INDEPENDENT (each capped only by its own
 *  budget); main is the total pool that the low groups borrow from (see mainCapacity). */
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

/** THE waterline: main runs in the leftover capacity after the low groups take their independent
 *  budgets — `main_budget − (active serial + active lowconc)`, clamped ≥ 0. NOT a global min lock
 *  (that would be `min(S,L,M) − active_any`). Clamped so a low-group budget exceeding the main
 *  budget simply blocks main until enough low files drain (monotonic rise, never negative). */
export function mainCapacity(budgets: SchedulerBudgets, active: ActiveCounts): number {
  return Math.max(0, budgets.main - active.serial - active.lowconc);
}

/** Start as many queued files as each group's budget allows. serial and lowconc are INDEPENDENT
 *  (each bounded only by its own budget, running in PARALLEL — the overlap never degrades); main
 *  fills the remaining capacity (mainCapacity) LAST, so the low groups always grab their budget
 *  first (preserving the "serial/lowconc judged red at the boundary" start-order property).
 *  MUTATES queues (shift) and active (increment); returns the started {file, group} pairs. */
export function nextDispatch(
  budgets: SchedulerBudgets,
  queues: GroupQueues,
  active: ActiveCounts,
): Array<{ file: string; group: SuiteGroup }> {
  const started: Array<{ file: string; group: SuiteGroup }> = [];
  while (active.serial < budgets.serial && queues.serial.length > 0) {
    started.push({ file: queues.serial.shift() as string, group: "serial" });
    active.serial++;
  }
  while (active.lowconc < budgets.lowconc && queues.lowconc.length > 0) {
    started.push({ file: queues.lowconc.shift() as string, group: "lowconc" });
    active.lowconc++;
  }
  const cap = mainCapacity(budgets, active);
  while (active.main < cap && queues.main.length > 0) {
    started.push({ file: queues.main.shift() as string, group: "main" });
    active.main++;
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
  /** The main capacity sampled at each completion event, in time order — asserts monotonic rise. */
  mainCapacityTrace: number[];
}

/** A deterministic event-driven simulation of the dispatch loop given per-file durations — the SAME
 *  nextDispatch loop the real runner executes, so the test can prove the waterline/monotonicity/
 *  pass/fail-neutrality properties WITHOUT spawning processes. Durations are wall units (any scale);
 *  a file with no recorded duration is treated as 0. The low groups are dispatched greedily up-front
 *  (nextDispatch fills serial then lowconc then main), so after the first tick active serial/lowconc
 *  only DEcrease ⇒ main capacity only rises (the monotonic waterline trace). */
export function simulateSchedule(
  budgets: SchedulerBudgets,
  groups: GroupQueues,
  durations: Map<string, number>,
): SimulationResult {
  const queues: GroupQueues = { serial: [...groups.serial], lowconc: [...groups.lowconc], main: [...groups.main] };
  const active: ActiveCounts = { serial: 0, lowconc: 0, main: 0 };
  const running = new Map<string, { group: SuiteGroup; end: number }>();
  const events: SimEvent[] = [];
  const trace: number[] = [];
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
    trace.push(mainCapacity(budgets, active));
  }
  return { makespan: t, events, mainCapacityTrace: trace };
}

/** The REJECTED alternative — a GLOBAL min lock: every file (all groups) shares ONE pool at
 *  concurrency min(S,L,M). Kept here ONLY as the AC2 control: the test asserts the waterline
 *  makespan ≤ the min-lock makespan on a workload where serial∥lowconc overlap parallelism matters
 *  (reproducing the proposal's 706s min-lock vs 515s waterline direction). */
export function simulateMinLock(budgets: SchedulerBudgets, groups: GroupQueues, durations: Map<string, number>): number {
  const cap = Math.min(budgets.serial, budgets.lowconc, budgets.main);
  const all: Array<{ file: string; dur: number }> = [];
  for (const g of SUITE_GROUPS) for (const f of groups[g]) all.push({ file: f, dur: durations.get(f) ?? 0 });
  all.sort((a, b) => b.dur - a.dur); // LPT across ALL groups (single queue)
  const queue = all.map((x) => x.file);
  const running = new Map<string, number>(); // file → end
  let t = 0;
  for (;;) {
    while (running.size < cap && queue.length > 0) {
      const f = queue.shift()!;
      running.set(f, t + (durations.get(f) ?? 0));
    }
    if (running.size === 0) break;
    let earliestEnd = Infinity;
    for (const end of running.values()) if (end < earliestEnd) earliestEnd = end;
    t = earliestEnd;
    for (const [f, end] of [...running]) if (end === t) running.delete(f);
  }
  return t;
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
   *  key-normalization root for orderByLpt. */
  root: string;
  rounds: number;
  lptEnabled: boolean;
  /** Optional `--groups` csv; undefined = all four groups (product,engine,serial,lowconc). */
  groups?: string;
}

/** classify + filter + LPT-order the raw file list into the three per-bucket queues. Scheduling-only:
 *  every retained file appears in exactly one bucket exactly once — a bug here can drop a file only by
 *  the explicit --groups filter (which is the SELECTION, not a scheduling accident). LPT FAIL-OPEN: an
 *  absent/unreadable carrier yields an empty average map and orderByLpt returns the input unchanged. */
export function classifyAndOrder(files: string[], opts: ClassifyOptions): GroupQueues {
  const queues: GroupQueues = { serial: [], lowconc: [], main: [] };
  const include = opts.groups ? groupsArgToSuiteGroups(opts.groups) : undefined;
  for (const f of files) {
    const sg = toSuiteGroup(classifyFile(f));
    if (include && !include.has(sg)) continue;
    queues[sg].push(f);
  }
  if (opts.lptEnabled) {
    const carrier = path.join(opts.root, ".quay", "verification-round.jsonl");
    const avg = loadDurationAverages(carrier, opts.root, opts.rounds);
    queues.serial = orderByLpt(queues.serial, avg, opts.root);
    queues.lowconc = orderByLpt(queues.lowconc, avg, opts.root);
    queues.main = orderByLpt(queues.main, avg, opts.root);
  }
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

/** A stream.Transform that drops `test:stdout` / `test:stderr` events before the spec reporter —
 *  the SAME raw-diagnostic filter suite-lpt-runner.mjs wires (its dropRawDiagnostics): a test file
 *  that leaks a literal `not ok` / `✖` line from one of its OWN subprocesses (stdio inherited) must
 *  not pollute the stream the outer runner greps for 判绿/红. Red/green is carried entirely by the
 *  structured events (test:fail / test:summary) the spec reporter renders as `✖ <name> (Nms)` /
 *  `ℹ fail N`; the raw child streams are diagnostics only. */
function dropRawDiagnostics() {
  return new Transform({
    objectMode: true,
    transform(chunk, _encoding, callback) {
      let obj = chunk;
      if (Buffer.isBuffer(obj)) obj = JSON.parse(obj.toString());
      if (typeof obj === "string") obj = JSON.parse(obj);
      if (obj && typeof obj === "object" && (obj.type === "test:stdout" || obj.type === "test:stderr")) {
        return callback(); // drop the raw child output
      }
      callback(null, chunk);
    },
  });
}

/**
 * Run the suite through the event-driven scheduler. Each dispatched file runs through node:test's
 * `run({files:[file], isolation:"process"})` (the SAME in-process runner suite-lpt-runner.mjs uses)
 * with `dropRawDiagnostics → spec → stdout` composed (spec: the outer runner's 判绿 markers, raw
 * diagnostics dropped) and the per-file verdict read from the ROOT test:summary counts (single
 * source, no driftable exit-code counter). Emits:
 *   __PERFILE__ duration_ms=<d> <path> passed=<bool> end_ms=<epoch>   per file (the LPT input carrier)
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
}): Promise<RunResult> {
  const { budgets, groups, testNamePatterns } = opts;
  const queues: GroupQueues = { serial: [...groups.serial], lowconc: [...groups.lowconc], main: [...groups.main] };
  const active: ActiveCounts = { serial: 0, lowconc: 0, main: 0 };
  const stats: Record<SuiteGroup, GroupStats> = {
    serial: { durs: [], failed: 0, startMs: null, endMs: null },
    lowconc: { durs: [], failed: 0, startMs: null, endMs: null },
    main: { durs: [], failed: 0, startMs: null, endMs: null },
  };
  let nextId = 1;
  const running = new Map<number, { file: string; group: SuiteGroup; startMs: number }>();
  const failedFiles: string[] = [];
  const schedulerStartMs = Date.now();

  return new Promise<RunResult>((resolve) => {
    const finishFile = (id: number, failedCount: number) => {
      const rec = running.get(id);
      if (!rec) return;
      running.delete(id);
      active[rec.group]--;
      const dur = Math.max(0, Date.now() - rec.startMs);
      const st = stats[rec.group];
      const passed = failedCount === 0;
      st.durs.push(dur);
      if (!passed) {
        st.failed++;
        failedFiles.push(rec.file);
      }
      st.endMs = Date.now();
      process.stderr.write(`__PERFILE__ duration_ms=${dur} ${rec.file} passed=${passed} end_ms=${st.endMs}\n`);
      // A group closes when its queue is drained AND nothing of it is still running — emit its
      // __GROUP__ + __OVERHEAD__ <group>_phase_ms once, at close (the downstream accounting reads
      // one __GROUP__ per group, same shape as measure-suite-reporter's per-phase line).
      if (queues[rec.group].length === 0 && active[rec.group] === 0) {
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
      const started = nextDispatch(budgets, queues, active);
      for (const s of started) {
        const st = stats[s.group];
        if (st.startMs === null) st.startMs = Date.now();
        const id = nextId++;
        running.set(id, { file: s.file, group: s.group, startMs: Date.now() });
        driveFile(s.file).then((failedCount) => finishFile(id, failedCount));
      }
      if (running.size === 0 && queues.serial.length === 0 && queues.lowconc.length === 0 && queues.main.length === 0) {
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
function emitGroup(group: SuiteGroup, concurrency: number, st: GroupStats): void {
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

function parseArgs(argv: string[]): {
  budgets: SchedulerBudgets;
  testNamePatterns: string[];
  root: string;
  mainRoot: string;
  groups?: string;
  rounds: number;
} {
  const budgets: SchedulerBudgets = { serial: 1, lowconc: 1, main: 1 };
  const testNamePatterns: string[] = [];
  let root = process.cwd();
  let mainRoot = "";
  let groups: string | undefined;
  let rounds = Number(process.env.QUAY_TEST_LPT_ROUNDS);
  if (!Number.isInteger(rounds) || rounds < 1) rounds = 3;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--serial-concurrency" && i + 1 < argv.length) {
      budgets.serial = Math.max(1, Number(argv[++i]) || 1);
    } else if (a === "--lowconc-concurrency" && i + 1 < argv.length) {
      budgets.lowconc = Math.max(1, Number(argv[++i]) || 1);
    } else if (a === "--main-concurrency" && i + 1 < argv.length) {
      budgets.main = Math.max(1, Number(argv[++i]) || 1);
    } else if (a === "--root" && i + 1 < argv.length) {
      root = argv[++i];
    } else if (a.startsWith("--root=")) {
      root = a.slice("--root=".length);
    } else if (a === "--main-root" && i + 1 < argv.length) {
      mainRoot = argv[++i]; // the LPT carrier root (main checkout's .quay/verification-round.jsonl)
    } else if (a.startsWith("--main-root=")) {
      mainRoot = a.slice("--main-root=".length);
    } else if (a === "--groups" && i + 1 < argv.length) {
      groups = argv[++i];
    } else if (a.startsWith("--groups=")) {
      groups = a.slice("--groups=".length);
    } else if (a === "--rounds" && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n >= 1) rounds = n;
    } else if (a.startsWith("--rounds=")) {
      const n = Number(a.slice("--rounds=".length));
      if (Number.isInteger(n) && n >= 1) rounds = n;
    } else if (a === "--test-concurrency") {
      if (i + 1 < argv.length) i++; // strip the space-spelling value (the scheduler owns concurrency)
    } else if (a.startsWith("--test-concurrency=")) {
      // strip — the scheduler owns concurrency (one source, no drift)
    } else if (a === "--test-name-pattern" && i + 1 < argv.length) {
      testNamePatterns.push(argv[++i]); // map to run()'s testNamePatterns (same parse as suite-lpt-runner.mjs)
    } else if (a.startsWith("--test-name-pattern=")) {
      testNamePatterns.push(a.slice("--test-name-pattern=".length));
    } else if (a.startsWith("-")) {
      // unknown pass-through flag — skip (no run() equivalent), same as suite-lpt-runner.mjs parseRunnerArgs
    }
  }
  return { budgets, testNamePatterns, root, mainRoot: mainRoot || root, groups, rounds };
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
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stderr.write(
      "suite-scheduler.ts — unified group-budget suite scheduler (gap-suite-dynamic-waterline-scheduler)\n" +
        "usage: <raw file paths on stdin, one per line> | node suite-scheduler.ts \\\n" +
        "         --root <repo> --main-root <main-checkout> \\\n" +
        "         --serial-concurrency <S> --lowconc-concurrency <L> --main-concurrency <M> \\\n" +
        "         [--groups <csv>] [--rounds <N>] [<node --test flags...>]\n",
    );
    return 0;
  }
  const { budgets, testNamePatterns, mainRoot, groups: groupsArg, rounds } = parseArgs(argv);
  const files = await readFiles();
  if (files.length === 0) {
    process.stderr.write("suite-scheduler: no test files on stdin\n");
    return 2;
  }
  const groups = classifyAndOrder(files, {
    root: mainRoot,
    rounds,
    lptEnabled: process.env.QUAY_TEST_LPT_ORDER !== "0",
    groups: groupsArg,
  });
  const total = groups.serial.length + groups.lowconc.length + groups.main.length;
  if (total === 0) {
    process.stderr.write(`suite-scheduler: no test files matched --groups '${groupsArg ?? "all"}' on stdin\n`);
    return 2;
  }
  process.stderr.write(
    `scheduler: serial=${groups.serial.length}≤${budgets.serial} lowconc=${groups.lowconc.length}≤${budgets.lowconc} main=${groups.main.length}≤${budgets.main} (waterline: main uses remaining capacity)\n`,
  );
  const result = await runScheduler({ budgets, groups, testNamePatterns });
  return result.failed > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "suite-scheduler")) {
  main(process.argv).then((code) => process.exit(code));
}
