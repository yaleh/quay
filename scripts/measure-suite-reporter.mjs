// measure-suite-reporter.mjs — custom node:test reporter for per-file duration capture
// + group floor/ceiling determination (auto-evaluated).
//
// Tasks:
//   gap-suite-cost-model-is-wrong-optimizations-buy-nothing (AC1)
//   gap-install-suite-cost-instrument-reporter-not-wired (AC2/AC3/AC4)
//
// node's --test runs every file (custom-harness scripts AND node:test files) as a
// child process and emits a FILE-LEVEL `test:complete` event whose `name` equals the
// file's basename and whose `details.duration_ms` is the file's wall duration in the
// concurrent run. This reporter forwards exactly those events, one line per file:
//
//   __PERFILE__ duration_ms=<dur> <full-path> passed=<bool> end_ms=<epoch-ms> [cpu_ms=<ms>] [mem_peak_kb=<kb>]
//
// `cpu_ms` (gap-perfile-cpu-cost-collection) and `mem_peak_kb`
// (gap-perfile-memory-cost-collection-missing) are OPTIONAL trailing fields written by the
// per-file preload seam — present only when that dimension was actually measured for the file
// (absent ≠ 0; 硬规则 3b). `mem_peak_kb` is the file's OWN process peak RSS, NOT its subprocesses'.
//
// on the reporter destination (stderr). The `duration_ms` BEFORE the path makes each
// per-file line match the suite-cost contract measure
// `grep -cE "duration_ms.*test\.mjs|file.*duration"` (> 34 files after a real run).
// `end_ms` is the `Date.now()` epoch-ms recorded at the file's `test:complete` event
// (gap-test-detail-timeline AC1) — the file's END time, from which the START is
// back-computed as end − duration (the event callback delay is ms-level, acceptable
// for the timeline approximation).
//
// At the END of the run it also emits the GROUP floor + ceiling determination (the
// split criterion, auto-evaluated — no human arithmetic needed):
//
//   floor = max( 组用例耗时和 ÷ 并发数 ,  最长单文件墙钟 )     [group wall-clock lower bound]
//   idealSplit = 组用例耗时和 ÷ 组并发数                       [the split threshold]
//   a file is 封顶者/该拆  iff  wall-clock > idealSplit  AND  concurrency > 1
//     (serial cc=1 is the EXCEPTION — splitting a file does not change total time at cc1)
//
// Output lines (all to stderr):
//   __PERFILE__ duration_ms=<dur> <path> passed=<bool> end_ms=<epoch-ms> [cpu_ms=] [mem_peak_kb=]   one per file, streamed live
//   __GROUP__ concurrency=<cc> files=<n> sum_ms=<sum> floor_ms=<floor> capped=<m>
//   __CEILING__ <path> duration_ms=<dur> floor_ms=<floor> 封顶者/该拆    per capped file (cc>1)
//
// The concurrency is read from process.execArgv (`--test-concurrency=N`) so the
// reporter is phase-agnostic: the same file works for the main body (cc=derived),
// serial (cc=1), and lowconc (cc=3) phases — whatever node --test was invoked with.
//
// The reporter is a measurement instrument only — it never touches test files or
// assertions.
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { readdirSync, readFileSync } from "node:fs";

// gap-reduce-sync-spawn-floor-suite-slowdown: opt-in EXECVE (process-spawn)
// counting. The suite's biggest time cost was spawn count × per-process-start
// floor (the CLI's eager provider-machinery load). This reporter now counts
// process spawns so a before/after suite can be compared on (execve 总数,
// 各相墙钟) — the task's verification anchor (a). Counting is OFF by default
// (zero overhead in normal runs) and enabled with QUAY_TEST_EXECVE_COUNT=1.
//
// Mechanism: the reporter runs INSIDE the main `node --test` runner process.
// Every test file runs as a child process of that runner, and every child
// subprocess those files spawn (e.g. the quay CLI) is a deeper descendant. A
// low-frequency /proc watcher records every descendant PID it ever observes;
// each distinct PID ≈ one process spawn ≈ one execve (node's child_process
// always fork+exec). The count is a lower bound (a spawn that forks and execs
// entirely between two 100ms polls is missed), but the same instrument applied
// before/after is a consistent relative measure — exactly what the anchor needs.
const EXECVE_COUNT_ENV = "QUAY_TEST_EXECVE_COUNT";

/** Union of a pid's live children across all its threads (/proc/<pid>/task/<tid>/children). */
function childrenOf(pid) {
  const out = new Set();
  let tids;
  try {
    tids = readdirSync(`/proc/${pid}/task`);
  } catch {
    return out; // pid already gone (race) — no children to read
  }
  for (const tid of tids) {
    try {
      const raw = readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").trim();
      if (raw) {
        for (const c of raw.split(/\s+/)) {
          const n = Number(c);
          if (Number.isInteger(n) && n > 0) out.add(n);
        }
      }
    } catch {
      // thread exited mid-scan — skip it
    }
  }
  return out;
}

/**
 * DFS over the live process tree rooted at `rootPid`, adding every descendant
 * PID to `seen` (idempotent across calls — `seen` persists between polls so a
 * process that spawned and later exited is still counted once).
 *
 * `visited` is PER-WALK (fresh each call): it dedups expansion of the SAME pid
 * within one walk but never prunes across walks. `seen` is the persistent
 * accumulator — every observed child is added unconditionally, so a grandchild
 * that spawns after its parent was first observed is still discovered on a
 * later walk (the parent is re-expanded because it is not in `visited`).
 */
function collectDescendants(rootPid, seen) {
  const stack = [rootPid];
  const visited = new Set();
  while (stack.length > 0) {
    const pid = stack.pop();
    if (visited.has(pid)) continue;
    visited.add(pid);
    for (const child of childrenOf(pid)) {
      seen.add(child);
      stack.push(child);
    }
  }
  return seen;
}

// ── dropRawDiagnostics ──────────────────────────────────────────────────────────────────────────────
/** A stream.Transform that drops `test:stdout` / `test:stderr` events before the spec reporter.
 *
 *  In process isolation node:test forwards each test file's raw stdout/stderr as these diagnostic
 *  events, and the spec reporter renders them verbatim into the runner's stdout — so a test file that
 *  leaks a literal `not ok` TAP line from one of its OWN subprocesses (a "fake red TAP"
 *  failure-detection test) would pollute the stdout the outer runner greps for 判绿/红. Red/green is
 *  fully carried by the structured events (test:fail / test:summary) the spec reporter renders as
 *  `✖ <name> (Nms)` / `ℹ fail N` / `ℹ cancelled N`; the raw child streams are diagnostics only and
 *  must not reach the outer grep.
 *
 *  EXPORTED because the filter is wired at BOTH suite execution points — suite-lpt-runner.mjs's
 *  `runOrderedSuite` and suite-scheduler.ts's `runScheduler` — and those two carried byte-identical
 *  private copies (semantic-dedup-scan finding `suite-lpt-drop-diagnostics`, routine
 *  `semantic-dedup-scan`, runId `semantic-dedup-scan-1792405443214`, kind `byte-identical-body`,
 *  verdict `real-duplication`, requested action `extract`; carriers
 *  plugin/scripts/suite-lpt-runner.mjs:43 / plugin/scripts/suite-scheduler.ts:365). This module was
 *  already the shared hub BOTH files import (readConcurrency / readPerFileCpuMs /
 *  readPerFileMemPeakKb), so the extraction adds no new dependency and no new file. ⛔ Do not
 *  re-inline: a second copy is how the two paths drift apart on what counts as a "diagnostic". */
export function dropRawDiagnostics() {
  return new Transform({
    objectMode: true,
    transform(chunk, _encoding, callback) {
      let obj = chunk;
      if (Buffer.isBuffer(chunk)) obj = JSON.parse(chunk.toString());
      if (typeof obj === "string") obj = JSON.parse(obj);
      if (obj && typeof obj === "object" && (obj.type === "test:stdout" || obj.type === "test:stderr")) {
        return callback(); // drop the raw child output
      }
      callback(null, chunk);
    },
  });
}

/** Read `--test-concurrency=N` from process.execArgv (both = and space spellings) — the SINGLE
 *  concurrency parse, EXPORTED because it is shared: this reporter uses it for its
 *  `__GROUP__ concurrency=` line and suite-lpt-runner.mjs re-exports it for its `run({concurrency})`,
 *  so the lane count the runner actually executes and the lane count the reporter prints cannot
 *  disagree by construction.
 *
 *  The predicate is `Number.isInteger`, NOT `Number.isFinite`: node:test's run() REJECTS a
 *  non-integer concurrency (`ERR_OUT_OF_RANGE: options.concurrency ... must be an integer`), so a
 *  fractional `--test-concurrency=1.5` must fall back to the serial default rather than be *reported*
 *  as a lane count the runner never used. Two hand-kept copies of this loop is exactly how the two
 *  predicates drifted apart (gap-routine-semantic-dedup-scan-concurrency-parse-divergence — the
 *  reporter printed `concurrency=1.5` while the runner ran 1); one exported definition removes the
 *  class. */
export function readConcurrency() {
  const argv = process.execArgv ?? [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--test-concurrency=")) {
      const n = Number(a.slice("--test-concurrency=".length));
      if (Number.isInteger(n) && n >= 1) return n;
    }
    if (a === "--test-concurrency" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isInteger(n) && n >= 1) return n;
    }
  }
  return 1; // default: serial semantics (cc=1) — safest when unknown
}

// gap-perfile-cpu-cost-collection — per-file machine cost (cost_f) via route (a) 子进程自报.
// The preload seam (plugin/scripts/per-file-cpu-report.mjs, loaded via NODE_OPTIONS=--require) writes
// each isolated test-file child's OWN readings into
// `<QUAY_PERFILE_CPU_DIR>/<sha256(abs)>.<pid>.<ext>` on that process's exit: `.cpu` =
// process.cpuUsage() (+ reaped children), `.mem` = process.resourceUsage().maxRSS
// (gap-perfile-memory-cost-collection-missing — the memory mirror).
// This reporter reads those files back at the file's `test:complete` event — the child's exit handler
// runs BEFORE the parent emits test:complete, so the writes are on disk and there is no race. The key
// (sha256(path.resolve(file))[:16]) MUST match the preload's key byte-for-byte.
// Each returns its number, or undefined when the dir is unset / the file was never written — the
// caller then OMITS the corresponding field from the line (absent = "not measured", never a
// fabricated 0; 硬规则 3b).
// Exported so the unified scheduler (suite-scheduler.ts) REUSES these single readers — ⛔ the
// __PERFILE__ line has TWO emission points (this reporter's legacy/LPT path + the scheduler's own
// finishFile), and a second hand-rolled read here would be the exact "two writers only one changed"
// drift (gap-suite-scheduler-perfile-cpu-emitter-missing). Shared, never duplicated. BOTH dimensions
// ride every emission point — 禁止只改一边.
export function readPerFileCpuMs(file) {
  return readPerFileMetric(file, "cpu");
}

// gap-perfile-memory-cost-collection-missing — the MEMORY mirror of readPerFileCpuMs, same dir, same
// key, `.mem` extension. The writer (per-file-cpu-report.mjs) records
// `process.resourceUsage().maxRSS` (KB) — the kernel's PEAK RSS for that test-file child, NOT an
// exit-time `memoryUsage().rss` snapshot. COVERAGE BOUNDARY (硬规则 3b — read the writer's header
// before consuming this): the file's isolated child process only; a subprocess the file spawned is
// NOT covered. Returns the peak KB, or undefined when the dir is unset / no report was written — the
// caller then OMITS `mem_peak_kb` from the line (absent = "not measured", never a fabricated 0).
// Exported so the unified scheduler (suite-scheduler.ts) REUSES this single reader — the same
// two-emission-points-one-reader contract readPerFileCpuMs carries.
export function readPerFileMemPeakKb(file) {
  return readPerFileMetric(file, "mem");
}

// The ONE reader both exported dimensions delegate to: enumerate every report for this file's key in
// `<QUAY_PERFILE_CPU_DIR>` and return the MAXIMUM of the valid values (undefined when there is none).
//
// WHY a glob + max rather than the single `<key>.<ext>` read it used to be
// (gap-per-file-cpu-report-mem-key-collides-parent-and-isolated-child): in a process-isolated run TWO
// processes have the same file as argv[1] — node:test's isolated child (the reading we want) and the
// runner that spawned it (whose own RSS is ~50 MB and is NOT the file's cost). With one pid-less
// filename the runner's reading silently overwrote the child's (measured: 52,356 KB reported for a
// file whose child peaked at 1,624,188 KB). The writer now stamps the pid into the filename; THIS side
// takes the max, so a smaller reading can never mask a larger one regardless of write order.
//
// The pid component is OPTIONAL in the pattern, so the pre-fix single-file dialect still reads (older
// report dirs, fixtures) — and every existing reader test that writes `<key>.<ext>` keeps passing
// unchanged. The pattern is fully anchored: `<key>extra.mem`, `<key>.1.mem.bak` and any other lookalike
// can never be mistaken for a report for this file.
//
// MAX, not sum/last: every distinct value here is a candidate reading of the SAME quantity by a
// different process lifetime, and the consumers (heavy-file classification via full-suite-runner's
// memPeakKb, the trend record) must be told the worst the file ever did — a file that once peaked at
// 1.8 GB IS heavy. A sum would double-count a re-run; last-write-wins is the very defect being fixed.
function readPerFileMetric(file, ext) {
  const dir = process.env.QUAY_PERFILE_CPU_DIR;
  if (!dir) return undefined;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return undefined; // no report dir for this run (not wired / already cleaned up)
  }
  const key = crypto.createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 16);
  const reportName = new RegExp(`^${key}(?:\\.\\d+)?\\.${ext}$`);
  let best;
  for (const name of names) {
    if (!reportName.test(name)) continue;
    let raw;
    try {
      raw = readFileSync(path.join(dir, name), "utf8").trim();
    } catch {
      continue; // a report unreadable mid-write must not discard the other readings
    }
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && (best === undefined || n > best)) best = n;
  }
  return best;
}

export default async function* perFileReporter(source) {
  const cc = readConcurrency();
  /** full path -> { dur, passed } */
  const files = new Map();

  // ── opt-in execve/process-spawn counter (see EXECVE_COUNT_ENV above) ──────
  // A 100ms /proc poll adds ~1ms per tick — only paid when explicitly enabled.
  const execveCounting = process.env[EXECVE_COUNT_ENV] === "1";
  const seenPids = new Set();
  let spawnWatcher = null;
  if (execveCounting) {
    collectDescendants(process.pid, seenPids);
    spawnWatcher = setInterval(() => {
      collectDescendants(process.pid, seenPids);
    }, 100);
    // Never keep the test process alive for the watcher's sake.
    if (typeof spawnWatcher.unref === "function") spawnWatcher.unref();
  }

  for await (const e of source) {
    if (e.type !== "test:complete" || !e.data || !e.data.file) continue;
    const d = e.data;
    // File-level complete: node labels it with the path string AS PASSED on the CLI
    // (relative when given relative, absolute when given absolute), so it resolves to
    // the same file as d.file. Individual test() calls carry the file path too but
    // their name is the test title, which never resolves to a real file.
    if (path.resolve(d.name) === d.file) {
      const dur = d.details?.duration_ms ?? 0;
      const passed = d.details?.passed === true;
      // gap-test-detail-timeline AC1 — record the file's END time (the test:complete
      // event fires at file completion); the START is back-computed as end − duration.
      const endedAtMs = Date.now();
      files.set(d.file, { dur, passed, endedAtMs });
      // Emit the FULL path (not basename) so duplicate basenames across packages
      // (cli.test.mjs in packages/quay|quay-github/test, etc.) cannot collide.
      // `duration_ms=` BEFORE the path matches the contract measure regex
      // (`duration_ms.*test\.mjs`), so the real full-suite log's per-file lines are
      // greppable by the suite-cost gate.
      // gap-perfile-cpu-cost-collection — append the per-file CPU (route a 子进程自报) as an optional
      // trailing field, same shape as end_ms: present only when a report was actually written (a file
      // with no report — not wired / never sampled — omits the field, never emits a fabricated 0).
      const cpuMs = readPerFileCpuMs(d.file);
      const cpuPart = cpuMs !== undefined ? ` cpu_ms=${cpuMs}` : "";
      // gap-perfile-memory-cost-collection-missing — the peak-memory dimension, same optional-trailing
      // contract as cpu_ms (present only when the child wrote a .mem report). ⛔ This is ONE of the TWO
      // __PERFILE__ emission points; suite-scheduler.ts's finishFile carries the same two fields.
      const memPeakKb = readPerFileMemPeakKb(d.file);
      const memPart = memPeakKb !== undefined ? ` mem_peak_kb=${memPeakKb}` : "";
      console.error(`__PERFILE__ duration_ms=${dur} ${d.file} passed=${passed} end_ms=${endedAtMs}${cpuPart}${memPart}`);
    }
  }

  // ── execve/process-spawn total (opt-in; skipped in normal runs) ───────────
  // Final sweep after the last test:complete — the file's worker has exited by
  // then, so its spawned children (which the worker waited on) have too, but
  // the sweep catches any still-alive straggler and the persistent `seen` set
  // already holds every earlier-observed pid.
  if (execveCounting) {
    clearInterval(spawnWatcher);
    collectDescendants(process.pid, seenPids);
    // seenPids holds every distinct descendant process ever observed ≈ total
    // process spawns ≈ execve count (a lower bound — see the header note).
    console.error(`__EXECVE__ total=${seenPids.size}`);
  }

  // ── group floor + ceiling determination (auto-evaluated split criterion) ──────────
  const sumMs = [...files.values()].reduce((a, f) => a + f.dur, 0);
  const idealSplit = files.size > 0 ? sumMs / Math.max(cc, 1) : 0;
  const longestMs = files.size > 0 ? Math.max(...[...files.values()].map((f) => f.dur)) : 0;
  const floorMs = Math.max(idealSplit, longestMs);

  // Split criterion: a file is 封顶者/该拆 iff wall-clock > idealSplit AND cc > 1.
  // serial (cc=1) is the EXCEPTION (AC3): splitting a file does not change total time
  // at concurrency 1, so the criterion is NOT applied there.
  const capped = [];
  if (cc > 1) {
    for (const [f, { dur }] of files) {
      if (dur > idealSplit) {
        capped.push([f, dur]);
        console.error(`__CEILING__ ${f} duration_ms=${dur} floor_ms=${floorMs} 封顶者/该拆`);
      }
    }
  }

  console.error(
    `__GROUP__ concurrency=${cc} files=${files.size} sum_ms=${sumMs} floor_ms=${floorMs} capped=${capped.length}`
  );
}
