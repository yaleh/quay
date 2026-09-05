// per-file-cpu-report.mjs — route (a) 子进程自报 preload seam for per-file CPU (cost_f).
// (gap-perfile-cpu-cost-collection, human 2026-09-04 定向: 默认测量路线必须是子进程自报)
//
// Loaded into a measured suite's node processes via `NODE_OPTIONS=--require=<this-file>` (set by
// full-suite-runner.ts's suiteEnv). node:test runs each test file in an isolated child process
// (`run({isolation:"process"})`); the child inherits NODE_OPTIONS from its parent, so this module
// loads there too. On process exit it reports the file's machine cost into a per-run directory keyed
// by the absolute path of the file this process ran (argv[1]).
//
// The suite's measure-suite-reporter.mjs (running in the node --test runner / LPT runner process)
// reads that file back at the file's `test:complete` event and appends `cpu_ms=<n>` to the
// `__PERFILE__` line. The child's exit handler runs synchronously BEFORE the process dies, so the
// write is on disk before the parent emits `test:complete` — no race, no sampling error.
//
// WHAT cpu_ms MEANS (cost_f = "跑这个文件消耗多少机器"): the sum of
//   (1) THIS process's OWN `process.cpuUsage()` (user+system, µs — the isolated test-file child), and
//   (2) its reaped CHILDREN's CPU (cutime+cstime from /proc/self/stat — the subprocesses the test
//       file spawned, e.g. worker-driver-fan-in.test.mjs spawning `quay task worker`).
// process.cpuUsage() alone does NOT include (2) (measured: a child burning 1.5s CPU reported
// cpuUsage≈133ms while own+children≈1730ms — a ~12x under-report on spawn-heavy files, which is
// exactly the Type-1 files this task must resolve). 口径 limitation, written into the task body:
// cutime/cstime only accumulates children that have been wait()-REAPED by this process before its
// exit; a released/detached orphan's CPU is not counted. HZ is read from the host (getconf CLK_TCK),
// never hardcoded (CLAUDE.md 硬规则 4 推论二).
//
// WHY 子进程自报 rather than sampling /proc (route b): the measurement this task exists to produce
// must RESOLVE Type 2 files (CPU≈0, wall-long, waiting-type). A 5s /proc sample of a 160s-wall /
// 200ms-CPU file would almost certainly sample 0, and 0 is indistinguishable from "not measured"
// (CLAUDE.md 硬规则 3b). process.cpuUsage() is exact — a Type 2 file still reports its few hundred
// real ms, never a fabricated/sampled 0.
//
// GUARD: activate ONLY in node:test's isolated test-file child (`--test-isolation=*` in execArgv —
// the marker node:test itself stamps on the forked child whose argv[1] IS the test file). This is a
// NARROWING of the prior guard (which only excluded the bare `--test` direct runner) so the seam does
// NOT inject into arbitrary `node -e` probes / MCP providers / other subprocesses a test spawns —
// those are not test files, and an exit-time report from them is noise that also delays their death
// (a live-process liveness fixture in serve-board.test.mjs was observed flipping under suite load).
// The direct runner (`node --test <files>`, execArgv has bare `--test`) is excluded too: an
// unguarded write there would collide with that file's own isolated-child report. The LPT runner
// (`suite-lpt-runner.mjs`, run({isolation:"process"})) spawns children carrying `--test-isolation=
// process`, so those children still activate — only the runner itself (argv[1] a non-test path) is
// skipped, which is correct.
//
// The key = sha256(path.resolve(argv[1]))[:16] MUST stay byte-identical to the key
// measure-suite-reporter.mjs computes (sha256(path.resolve(d.file))[:16]) — that is the correlation
// contract between this writer and the reporter reader. 缺一不可, neither may drift.
//
// ⛔ WHY child_process is NOT a top-level named ESM import (`import { execFileSync }`): this preload
// is loaded via NODE_OPTIONS=--require into EVERY node process of a measured suite, INCLUDING the
// suite-fs-trace subprocess (suite-fs-trace.ts traceOne spawns `node --require suite-fs-trace-preload.cjs
// <test>` with `env: {...process.env}` — so NODE_OPTIONS leaks in). suite-fs-trace-preload.cjs patches
// node:child_process's CJS exports so a test file's `import { spawnSync }` resolves against the patched
// function; but a NAMED ESM import (`import { execFileSync } from "node:child_process"`) in ANY earlier
// preload snapshots the namespace bindings BEFORE the patch, so the traced test's spawnSync is the
// ORIGINAL and the trace captures zero reads (gap-perfile-cpu-cost-collection suite-red, measured:
// named-import preload ⇒ suite-bucket-drift-check ②-AC1 reads=[]; default `import fs` / `path` /
// `crypto` / `createRequire` ⇒ unaffected). So child_process is reached lazily via createRequire, only
// inside the armed exit handler (which never runs in the inert trace subprocess).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const cpuDir = process.env.QUAY_PERFILE_CPU_DIR;
// The isolated test-file child carries `--test-isolation=process` (NOT the bare `--test`, which is
// the direct runner). Restricting to this marker keeps the seam off `node -e` probes and other
// non-test subprocesses while still covering every isolated test child (direct + LPT paths).
const isIsolatedTestChild = process.execArgv.some((a) => a.startsWith("--test-isolation"));

// Host clock ticks per second for /proc/<pid>/stat cutime/cstime (in ticks). Read once, cached;
// fall back to USER_HZ=100 (the universal Linux proc value) if getconf is unavailable. Never
// hardcoded without the read (CLAUDE.md 硬规则 4 推论二).
let CLK_TCK = null;
function clockTicksPerSecond() {
  if (CLK_TCK == null) {
    try {
      // Lazy require (NOT a top-level named import — see the ⛔ note above): only runs inside the
      // armed exit handler, never in the inert FS-trace subprocess, so it cannot snapshot the
      // child_process namespace before suite-fs-trace-preload.cjs patches it.
      const out = require("node:child_process").execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8", timeout: 2000 }).trim();
      const v = Number.parseInt(out, 10);
      if (Number.isFinite(v) && v > 0) CLK_TCK = v;
    } catch {
      // fall through to the default below
    }
    if (CLK_TCK == null) CLK_TCK = 100;
  }
  return CLK_TCK;
}

if (cpuDir && isIsolatedTestChild) {
  process.once("exit", () => {
    try {
      const file = process.argv[1];
      if (!file) return;
      const abs = path.resolve(file);
      const own = process.cpuUsage(); // µs integers (user, system) — THIS process only
      let childMs = 0;
      try {
        // /proc/self/stat: field 1 = pid, field 2 = (comm) [may contain spaces/parens — strip
        // through the LAST ")" so it cannot misalign the split]. After the strip, f[0] = field 3
        // (state) ⇒ utime = f[11] (field 14), stime = f[12] (15), cutime = f[13] (16), cstime =
        // f[14] (17). cutime+cstime = this process's REAPED children's CPU (the subprocesses the
        // test file spawned) — the part process.cpuUsage() omits.
        const stat = fs.readFileSync("/proc/self/stat", "utf8");
        const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ").filter(Boolean);
        const cutime = Number(f[13]);
        const cstime = Number(f[14]);
        childMs = ((Number.isFinite(cutime) ? cutime : 0) + (Number.isFinite(cstime) ? cstime : 0)) /
          clockTicksPerSecond() * 1000;
      } catch {
        // stat unreadable (non-Linux / restricted) → children omitted, own-CPU only. Best-effort —
        // never fail the test it is measuring.
      }
      // own (µs → ms, ≤3 decimals) + children (ticks → ms). The raw sum already carries µs
      // granularity on the own term.
      const cpuMs = (own.user + own.system) / 1000 + childMs;
      const key = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 16);
      fs.mkdirSync(cpuDir, { recursive: true });
      fs.writeFileSync(path.join(cpuDir, `${key}.cpu`), String(cpuMs) + "\n", "utf8");
    } catch {
      // best-effort — a report failure must never fail the test it is measuring
    }
  });
}
