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
//   __PERFILE__ duration_ms=<dur> <full-path> passed=<bool>
//
// on the reporter destination (stderr). The `duration_ms` BEFORE the path makes each
// per-file line match the suite-cost contract measure
// `grep -cE "duration_ms.*test\.mjs|file.*duration"` (> 34 files after a real run).
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
//   __PERFILE__ duration_ms=<dur> <path> passed=<bool>     one per file, streamed live
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

export default async function* perFileReporter(source) {
  const cc = readConcurrency();
  /** full path -> { dur, passed } */
  const files = new Map();

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
      files.set(d.file, { dur, passed });
      // Emit the FULL path (not basename) so duplicate basenames across packages
      // (cli.test.mjs in packages/quay|quay-github/test, etc.) cannot collide.
      // `duration_ms=` BEFORE the path matches the contract measure regex
      // (`duration_ms.*test\.mjs`), so the real full-suite log's per-file lines are
      // greppable by the suite-cost gate.
      console.error(`__PERFILE__ duration_ms=${dur} ${d.file} passed=${passed}`);
    }
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
