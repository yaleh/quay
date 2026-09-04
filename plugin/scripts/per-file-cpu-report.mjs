// per-file-cpu-report.mjs — route (a) 子进程自报 preload seam for per-file CPU (cost_f).
// (gap-perfile-cpu-cost-collection, human 2026-09-04 定向: 默认测量路线必须是子进程自报)
//
// Loaded into EVERY node process of a measured suite via `NODE_OPTIONS=--require=<this-file>`
// (set by full-suite-runner.ts's suiteEnv). node:test runs each test file in an isolated child
// process (`run({isolation:"process"})`); the child inherits NODE_OPTIONS from its parent, so this
// module loads there too. On process exit it reports THIS process's OWN `process.cpuUsage()`
// (user+system, microseconds) — the file's unambiguous, uncensored machine cost — into a per-run
// directory keyed by the absolute path of the file this process ran (argv[1]).
//
// The suite's measure-suite-reporter.mjs (running in the node --test runner / LPT runner process)
// reads that file back at the file's `test:complete` event and appends `cpu_ms=<n>` to the
// `__PERFILE__` line. The child's exit handler runs synchronously BEFORE the process dies, so the
// write is on disk before the parent emits `test:complete` — no race, no sampling error.
//
// WHY 子进程自报 rather than sampling /proc (route b): the measurement this task exists to produce
// must RESOLVE Type 2 files (CPU≈0, wall-long, waiting-type). A 5s /proc sample of a 160s-wall /
// 200ms-CPU file would almost certainly sample 0, and 0 is indistinguishable from "not measured"
// (CLAUDE.md 硬规则 3b). process.cpuUsage() is exact — a Type 2 file still reports its few hundred
// real ms, never a fabricated/sampled 0.
//
// Guard: skip when `--test` is the exact execArgv entry — that is the DIRECT `node --test <files>`
// runner, whose argv[1] IS a test file (relative). An unguarded write there would collide with (and
// overwrite) that file's own isolated-child report. The isolated children carry `--test-isolation=
// process` (NOT the bare `--test`), so the guard never skips a worker; the LPT runner
// (`suite-lpt-runner.mjs`) also lacks bare `--test` and its argv[1] is a non-test path, so its
// write is harmless noise the reporter never reads.
//
// The key = sha256(path.resolve(argv[1]))[:16] MUST stay byte-identical to the key
// measure-suite-reporter.mjs computes (sha256(path.resolve(d.file))[:16]) — that is the correlation
// contract between this writer and the reporter reader. 缺一不可, neither may drift.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const cpuDir = process.env.QUAY_PERFILE_CPU_DIR;
const isDirectTestRunner = process.execArgv.includes("--test");

if (cpuDir && !isDirectTestRunner) {
  process.once("exit", () => {
    try {
      const file = process.argv[1];
      if (!file) return;
      const abs = path.resolve(file);
      const cpu = process.cpuUsage(); // µs integers (user, system)
      // µs → ms; the raw sum already carries ≤3 decimals (µs granularity = 0.001 ms).
      const cpuMs = (cpu.user + cpu.system) / 1000;
      const key = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 16);
      fs.mkdirSync(cpuDir, { recursive: true });
      fs.writeFileSync(path.join(cpuDir, `${key}.cpu`), String(cpuMs) + "\n", "utf8");
    } catch {
      // best-effort — a report failure must never fail the test it is measuring
    }
  });
}
