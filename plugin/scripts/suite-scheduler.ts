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
//   2. The execution entry (runScheduler + CLI) — spawns one `node --test <file>` per dispatched file
//      with spec→stdout (the outer runner's 判绿 markers) and emits the SAME per-file/group markers
//      the downstream accounting reads (`__PERFILE__` / `__GROUP__` / `__OVERHEAD__ <phase>_ms`).
//
// Pass/fail-neutral (AC3): the scheduler changes SCHEDULING ONLY — every input file is run exactly
// once, the same assertions execute, and the exit code is non-zero iff ≥1 file failed/cancelled
// (node --test's own per-file exit code, accumulated). A scheduling bug can never DROP a test.
//
// Usage (group\tpath lines on stdin, already LPT-ordered by scripts/test.sh's lpt_reorder_files):
//   { printf 'serial\t%s\n' ...; printf 'lowconc\t%s\n' ...; printf 'main\t%s\n' ...; } \
//     | node --experimental-strip-types suite-scheduler.ts \
//         --root <repo> --serial-concurrency <S> --lowconc-concurrency <L> --main-concurrency <M> \
//         [<extra node --test flags...>]
//
// The extra flags (e.g. --test-name-pattern=X) are forwarded to every per-file `node --test` spawn;
// any --test-concurrency[=N] flag is STRIPPED (the scheduler owns concurrency — one source, no drift).

import { spawn, type ChildProcess } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

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

/**
 * Run the suite through the event-driven scheduler. Spawns one `node --test --test-reporter=spec
 * <flags> <file>` per dispatched file (spec→stdout: the outer runner's 判绿 markers), inheriting
 * stdout/stderr so the per-file spec summaries flow straight to the suite stream. Emits:
 *   __PERFILE__ duration_ms=<d> <path> passed=<bool> end_ms=<epoch>   per file (the LPT input carrier)
 *   __GROUP__ concurrency=<budget> files=<n> sum_ms=<sum> floor_ms=<floor> capped=<m>   per group close
 *   __OVERHEAD__ <serial|lowconc|main>_phase_ms=<n>   per group wall  (the AC4/AC5 cost carriers)
 *   __OVERHEAD__ scheduler_ms=<n>                     total wall
 * Returns the failed-file count (exit code = failed>0 ? 1 : 0 — the SAME tally semantics as
 * suite-lpt-runner.mjs's failed+cancelled).
 */
export function runScheduler(opts: {
  budgets: SchedulerBudgets;
  groups: GroupQueues;
  nodeArgs: string[];
}): Promise<RunResult> {
  const { budgets, groups, nodeArgs } = opts;
  const queues: GroupQueues = { serial: [...groups.serial], lowconc: [...groups.lowconc], main: [...groups.main] };
  const active: ActiveCounts = { serial: 0, lowconc: 0, main: 0 };
  const stats: Record<SuiteGroup, GroupStats> = {
    serial: { durs: [], failed: 0, startMs: null, endMs: null },
    lowconc: { durs: [], failed: 0, startMs: null, endMs: null },
    main: { durs: [], failed: 0, startMs: null, endMs: null },
  };
  let nextId = 1;
  const running = new Map<number, { child: ChildProcess; file: string; group: SuiteGroup; startMs: number }>();
  const failedFiles: string[] = [];
  const schedulerStartMs = Date.now();

  return new Promise<RunResult>((resolve) => {
    const finishFile = (id: number, passed: boolean) => {
      const rec = running.get(id);
      if (!rec) return;
      running.delete(id);
      active[rec.group]--;
      const dur = Math.max(0, Date.now() - rec.startMs);
      const st = stats[rec.group];
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

    const tick = () => {
      const started = nextDispatch(budgets, queues, active);
      for (const s of started) {
        const st = stats[s.group];
        if (st.startMs === null) st.startMs = Date.now();
        // Strip the nested-test-runner markers (NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID): when the
        // scheduler itself runs under `node --test` (a nested suite spawn, or this module's own test),
        // the inherited marker makes a per-file `node --test` child exit 0 EVEN ON FAILURE (the child
        // thinks it is a worker inside the parent run). A top-level child (markers absent) exits
        // non-zero on a red file — the exit-code aggregate this scheduler's pass/fail verdict depends on.
        const childEnv = { ...process.env };
        delete childEnv.NODE_TEST_CONTEXT;
        delete childEnv.NODE_TEST_WORKER_ID;
        const child = spawn(process.execPath, ["--test", "--test-reporter=spec", ...nodeArgs, s.file], {
          stdio: ["ignore", "inherit", "inherit"],
          env: childEnv,
        });
        const id = nextId++;
        running.set(id, { child, file: s.file, group: s.group, startMs: Date.now() });
        child.on("error", () => finishFile(id, false)); // spawn failure ⇒ fail-loud, never a dropped test
        child.on("exit", (code, signal) => finishFile(id, code === 0 && signal === null));
      }
      if (running.size === 0 && queues.serial.length === 0 && queues.lowconc.length === 0 && queues.main.length === 0) {
        process.stderr.write(`__OVERHEAD__ scheduler_ms=${Date.now() - schedulerStartMs}\n`);
        resolve({ failed: failedFiles.length, failedFiles });
      }
    };

    // Fail-open on a termination signal: propagate to the per-file node --test children so a
    // kill-on-red reaches the whole tree (this scheduler is test.sh's child; its children would
    // otherwise orphan). Exit non-zero (the suite was cut, not green).
    const onSignal = () => {
      for (const rec of running.values()) {
        try {
          rec.child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
      resolve({ failed: failedFiles.length + 1, failedFiles });
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);

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

function parseArgs(argv: string[]): { budgets: SchedulerBudgets; nodeArgs: string[] } {
  const budgets: SchedulerBudgets = { serial: 1, lowconc: 1, main: 1 };
  const nodeArgs: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--serial-concurrency" && i + 1 < argv.length) {
      budgets.serial = Math.max(1, Number(argv[++i]) || 1);
    } else if (a === "--lowconc-concurrency" && i + 1 < argv.length) {
      budgets.lowconc = Math.max(1, Number(argv[++i]) || 1);
    } else if (a === "--main-concurrency" && i + 1 < argv.length) {
      budgets.main = Math.max(1, Number(argv[++i]) || 1);
    } else if (a === "--root" && i + 1 < argv.length) {
      i++; // consumed (cwd-independent; the scheduler does not read the carrier)
    } else if (a === "--test-concurrency") {
      if (i + 1 < argv.length) i++; // strip the space-spelling value (the scheduler owns concurrency)
    } else if (a.startsWith("--test-concurrency=")) {
      // strip — the scheduler owns concurrency (one source, no drift)
    } else if (a.startsWith("-")) {
      nodeArgs.push(a); // forward every other node --test flag verbatim
    }
  }
  return { budgets, nodeArgs };
}

/** Read `group\tpath` lines from stdin (already LPT-ordered by scripts/test.sh). */
async function readManifest(): Promise<GroupQueues> {
  const raw = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  const groups: GroupQueues = { serial: [], lowconc: [], main: [] };
  for (const line of raw.split("\n")) {
    const idx = line.indexOf("\t");
    if (idx <= 0) continue;
    const group = line.slice(0, idx) as SuiteGroup;
    const file = line.slice(idx + 1).trim();
    if (!file || !SUITE_GROUPS.includes(group)) continue;
    groups[group].push(file);
  }
  return groups;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stderr.write(
      "suite-scheduler.ts — unified group-budget suite scheduler (gap-suite-dynamic-waterline-scheduler)\n" +
        "usage: <group\\tpath lines on stdin> | node suite-scheduler.ts --root <repo> \\\n" +
        "         --serial-concurrency <S> --lowconc-concurrency <L> --main-concurrency <M> [<node --test flags...>]\n",
    );
    return 0;
  }
  const { budgets, nodeArgs } = parseArgs(argv);
  const groups = await readManifest();
  const total = groups.serial.length + groups.lowconc.length + groups.main.length;
  if (total === 0) {
    process.stderr.write("suite-scheduler: no test files on stdin\n");
    return 2;
  }
  process.stderr.write(
    `scheduler: serial=${groups.serial.length}≤${budgets.serial} lowconc=${groups.lowconc.length}≤${budgets.lowconc} main=${groups.main.length}≤${budgets.main} (waterline: main uses remaining capacity)\n`,
  );
  const result = await runScheduler({ budgets, groups, nodeArgs });
  return result.failed > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "suite-scheduler")) {
  main(process.argv).then((code) => process.exit(code));
}
