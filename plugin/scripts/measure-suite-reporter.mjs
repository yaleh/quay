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
//   __PERFILE__ duration_ms=<dur> <full-path> passed=<bool> end_ms=<epoch-ms>
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
//   __PERFILE__ duration_ms=<dur> <path> passed=<bool> end_ms=<epoch-ms>   one per file, streamed live
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

/** Read `--test-concurrency=N` from process.execArgv (both = and space spellings). */
function readConcurrency() {
  const argv = process.execArgv ?? [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--test-concurrency=")) {
      const n = Number(a.slice("--test-concurrency=".length));
      if (Number.isFinite(n) && n >= 1) return n;
    }
    if (a === "--test-concurrency" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 1) return n;
    }
  }
  return 1; // default: serial semantics (cc=1) — safest when unknown
}

// gap-perfile-cpu-cost-collection — per-file CPU (cost_f) via route (a) 子进程自报.
// The preload seam (plugin/scripts/per-file-cpu-report.mjs, loaded via NODE_OPTIONS=--require) writes
// each isolated test-file child's OWN process.cpuUsage() to `<QUAY_PERFILE_CPU_DIR>/<sha256(abs)> .cpu`
// on the child's exit. This reporter reads that file back at the file's `test:complete` event — the
// child's exit handler runs BEFORE the parent emits test:complete, so the write is on disk and there is
// no race. The key (sha256(path.resolve(file))[:16]) MUST match the preload's key byte-for-byte.
// Returns the CPU milliseconds, or undefined when the dir is unset / the file was never written — the
// caller then OMITS `cpu_ms` from the line (absent = "not measured", never a fabricated 0; 硬规则 3b).
function readPerFileCpuMs(file) {
  const dir = process.env.QUAY_PERFILE_CPU_DIR;
  if (!dir) return undefined;
  try {
    const key = crypto.createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 16);
    const raw = readFileSync(path.join(dir, `${key}.cpu`), "utf8").trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  } catch {
    return undefined; // no report for this file (dir missing / write failed / not wired)
  }
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
      console.error(`__PERFILE__ duration_ms=${dur} ${d.file} passed=${passed} end_ms=${endedAtMs}${cpuPart}`);
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
