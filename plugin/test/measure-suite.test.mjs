// @test-group engine
// measure-suite.test.mjs — validate the per-file duration reporter (AC1b/AC8 of
// gap-suite-cost-model-is-wrong-optimizations-buy-nothing).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (B-class real wall-clock wait — spawns node --test subprocesses and waits on their
// real durations) so it runs in the concurrency-1 serial phase, never competing with the
// concurrency-8 main body.
//
// The full-suite measurement (measure-suite.mjs) depends on the custom reporter
// (measure-suite-reporter.mjs) emitting a FILE-LEVEL duration for EVERY test file —
// both node:test files (which get a file-level test:complete with name === basename)
// and custom-harness scripts (which are a single test named by the file). This test
// pins that contract with two tiny fixtures, so a future reporter change cannot
// silently break per-file attribution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const reporterPath = path.join(repoRoot, "plugin", "scripts", "measure-suite-reporter.mjs");

function runWithReporter(files) {
  // node:test refuses to run `node --test` recursively from inside a test file
  // (it warns "node:test run() is being called recursively ... skipping running
  // files"). Clear NODE_TEST_CONTEXT so the child --test actually runs the files.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    "node",
    [
      "--test",
      "--test-concurrency=8",
      `--test-reporter=${reporterPath}`,
      "--test-reporter-destination=stderr",
      ...files,
    ],
    { encoding: "utf8", env }
  );
}

function parsePerFile(stderr) {
  const out = new Map();
  for (const line of stderr.split("\n")) {
    // gap-test-detail-timeline — the line now carries an optional trailing `end_ms=<epoch-ms>`.
    // gap-perfile-cpu-cost-collection — it MAY ALSO carry `cpu_ms=<n>` after end_ms (when the outer
    // suite wired QUAY_PERFILE_CPU_DIR); tolerate it so a pre-existing test running inside the real
    // suite (which sets that env) still parses the record.
    const m = line.match(/^__PERFILE__ duration_ms=([0-9.]+) (\S+) passed=(true|false)(?: end_ms=([0-9]+))?(?: cpu_ms=([0-9.]+))?$/);
    if (m) out.set(m[2], { durationMs: parseFloat(m[1]), passed: m[3] === "true", endedAtMs: m[4] != null ? Number(m[4]) : undefined });
  // key = full path from the reporter
  }
  return out;
}

test("reporter captures file-level duration for node:test AND custom-harness files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-test-"));
  try {
    const nodeTestFile = path.join(dir, "nodetest.test.mjs");
    writeFileSync(
      nodeTestFile,
      `import { test } from "node:test";\n` +
        `import { setTimeout as sleep } from "node:timers/promises";\n` +
        `test("n1", async () => { await sleep(120); });\n`
    );
    const customFile = path.join(dir, "custom-harness.mjs");
    writeFileSync(
      customFile,
      `let failures = 0;\n` +
        `for (let i = 0; i < 3; i++) failures += (true ? 0 : 1);\n` +
        `console.log(failures === 0 ? "custom pass" : "custom fail");\n` +
        `process.exitCode = failures === 0 ? 0 : 1;\n`
    );

    const res = runWithReporter([nodeTestFile, customFile]);
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);
    const perFile = parsePerFile(res.stderr);

    assert.ok(perFile.has(nodeTestFile), "node:test file must get a file-level duration");
    assert.ok(
      perFile.get(nodeTestFile).durationMs >= 100,
      `node:test file duration (${perFile.get(nodeTestFile).durationMs}ms) should cover its 120ms test`
    );
    assert.ok(perFile.has(customFile), "custom-harness file must get a file-level duration");
    assert.ok(perFile.get(customFile).durationMs > 0);
    assert.equal(perFile.get(customFile).passed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reporter records the file END time (end_ms) so the START back-computes as end − duration (gap-test-detail-timeline AC1)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-timeline-"));
  try {
    const f = path.join(dir, "timed.test.mjs");
    writeFileSync(
      f,
      `import { test } from "node:test";\n` +
        `import { setTimeout as sleep } from "node:timers/promises";\n` +
        `test("t1", async () => { await sleep(120); });\n`
    );
    const before = Date.now();
    const res = runWithReporter([f]);
    const after = Date.now();
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);

    const line = res.stderr.split("\n").find((l) => l.startsWith(`__PERFILE__ `));
    assert.ok(line, `a __PERFILE__ line must be emitted:\n${res.stderr}`);
    // gap-perfile-cpu-cost-collection — end_ms is no longer necessarily the LAST field (cpu_ms may
    // follow it when the outer suite wired QUAY_PERFILE_CPU_DIR); assert presence, not end-of-line.
    assert.match(line, / end_ms=\d+/, `the line must carry end_ms epoch-ms:\n${line}`);

    const rec = parsePerFile(res.stderr).get(f);
    assert.ok(rec, "timed file captured");
    assert.ok(rec.endedAtMs > 0, "endedAtMs is a positive epoch ms");
    // The END time is recorded at test:complete — inside [before, after + slack] of this test's own
    // wall clock (the child suite runs synchronously within runWithReporter). The start is back-
    // computed: startedAtMs = endedAtMs − durationMs ⇒ non-negative and ≤ endedAtMs.
    assert.ok(rec.endedAtMs >= before - 500 && rec.endedAtMs <= after + 500, `endedAtMs ${rec.endedAtMs} inside the run window [${before}, ${after}]`);
    const startedAtMs = rec.endedAtMs - rec.durationMs;
    assert.ok(startedAtMs >= 0, `back-computed start (${startedAtMs}) is non-negative`);
    assert.ok(startedAtMs <= rec.endedAtMs, "back-computed start does not exceed the end");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reporter auto-evaluates group floor + ceiling (AC2/AC3 of gap-install-suite-cost-instrument-reporter-not-wired)", () => {
  // AC2: output = per-file wall-clock + group floor (sum÷concurrency) + ceiling
  // determination, auto-evaluated. AC3: a cc>1 group flags any file > floor as
  // 封顶者/该拆; serial (cc=1) is the EXCEPTION — the criterion is NOT applied.
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-ceiling-"));
  try {
    // Three files: one fast (~20ms), one slow (~200ms), one in between (~100ms).
    // runWithReporter uses --test-concurrency=8: sum ≈ 320ms, idealSplit = sum/8 ≈ 40ms,
    // floor = max(40, longest=200) = 200ms. The 200ms file (> idealSplit) is the
    // ceiling → flagged 封顶者/该拆; the others are not.
    const files = [];
    for (const [name, ms] of [
      ["fast.test.mjs", 20],
      ["slow.test.mjs", 200],
      ["mid.test.mjs", 100],
    ]) {
      const p = path.join(dir, name);
      writeFileSync(
        p,
        `import { test } from "node:test";\n` +
          `import { setTimeout as sleep } from "node:timers/promises";\n` +
          `test("x", async () => { await sleep(${ms}); });\n`
      );
      files.push(p);
    }

    const res = runWithReporter(files);
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);
    const perFile = parsePerFile(res.stderr);
    const group = res.stderr.match(/^__GROUP__ concurrency=(\d+) files=(\d+) sum_ms=([0-9.]+) floor_ms=([0-9.]+) capped=(\d+)$/m);
    assert.ok(group, `__GROUP__ line must be emitted:\n${res.stderr}`);
    const [, cc, n, sumMs, floorMs, capped] = group;
    assert.equal(Number(cc), 8, "reporter must read --test-concurrency=8 from execArgv");
    const sum = Number(sumMs);
    assert.equal(Number(n), 3, "3 files captured");
    assert.ok(sum > 0, "sum_ms positive");
    const floor = Number(floorMs);
    // floor = max(sum/8, longest); slow file (200ms) > sum/8, so it is the ceiling.
    assert.ok(floor >= 200 - 10, "floor should be at least the slow file's wall-clock (tail cap)");
    const ceilingLines = res.stderr.match(/^__CEILING__ \S+ duration_ms=([0-9.]+) floor_ms=[0-9.]+ 封顶者\/该拆$/gm);
    assert.ok(ceilingLines, "at least one 封顶者/该拆 line must be emitted for a cc>1 group with a tail");
    assert.equal(Number(capped), ceilingLines.length, "capped count matches ceiling lines");
    // The slow file must be among the ceiling lines.
    const slowPath = path.join(dir, "slow.test.mjs");
    assert.ok(
      ceilingLines.some((l) => l.startsWith(`__CEILING__ ${slowPath} `)),
      "slow file (200ms) must be the ceiling/封顶者"
    );
    assert.ok(perFile.has(slowPath), "slow file captured per-file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serial (cc=1) does NOT apply the split criterion (AC3 exception)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-serial-"));
  try {
    const files = [];
    for (const [name, ms] of [
      ["a.test.mjs", 20],
      ["b.test.mjs", 200],
    ]) {
      const p = path.join(dir, name);
      writeFileSync(
        p,
        `import { test } from "node:test";\n` +
          `import { setTimeout as sleep } from "node:timers/promises";\n` +
          `test("x", async () => { await sleep(${ms}); });\n`
      );
      files.push(p);
    }
    // Serial: --test-concurrency=1 → criterion NOT applied → no __CEILING__ lines.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const res = spawnSync(
      "node",
      [
        "--test",
        "--test-concurrency=1",
        `--test-reporter=${reporterPath}`,
        "--test-reporter-destination=stderr",
        ...files,
      ],
      { encoding: "utf8", env }
    );
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);
    assert.doesNotMatch(res.stderr, /^__CEILING__/m, "serial (cc=1) must NOT emit 封顶者/该拆 — splitting a file does not change total time at cc1");
    assert.match(res.stderr, /^__GROUP__ concurrency=1 /m, "serial group line still emitted (floor computed, criterion skipped)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// gap-reduce-sync-spawn-floor-suite-slowdown: the reporter gained an OPT-IN
// execve/process-spawn counter (QUAY_TEST_EXECVE_COUNT=1) — the suite's
// biggest time cost was spawn count × per-process-start floor, and the
// verification anchor is a before/after suite compared on (execve 总数,
// 各相墙钟). These two tests pin the opt-in contract: the __EXECVE__ line is
// emitted with a real (>= worker + children) count when enabled, and absent
// (zero overhead) when not.
test("reporter counts process spawns when QUAY_TEST_EXECVE_COUNT=1 (execve proxy)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-execve-"));
  try {
    // A test file that spawns two long-lived (2.5s) node children via spawnSync.
    // The children stay alive across many 100ms reporter polls, so the /proc
    // watcher reliably observes them. Count is a lower bound: the file's own
    // worker process + its two spawned children = at least 3 distinct pids.
    const spawnerFile = path.join(dir, "spawner.test.mjs");
    writeFileSync(
      spawnerFile,
      `import { test } from "node:test";\n` +
        `import { spawnSync } from "node:child_process";\n` +
        `test("spawns long-lived children", () => {\n` +
        `  spawnSync(process.execPath, ["-e", "setTimeout(()=>{}, 2500)"], { stdio: "ignore" });\n` +
        `  spawnSync(process.execPath, ["-e", "setTimeout(()=>{}, 2500)"], { stdio: "ignore" });\n` +
        `});\n`
    );
    const env = { ...process.env, QUAY_TEST_EXECVE_COUNT: "1" };
    delete env.NODE_TEST_CONTEXT;
    const res = spawnSync(
      "node",
      ["--test", "--test-concurrency=8", `--test-reporter=${reporterPath}`, "--test-reporter-destination=stderr", spawnerFile],
      { encoding: "utf8", env }
    );
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);
    const m = res.stderr.match(/^__EXECVE__ total=(\d+)$/m);
    assert.ok(m, `__EXECVE__ line must be emitted when QUAY_TEST_EXECVE_COUNT=1:\n${res.stderr}`);
    const total = Number(m[1]);
    assert.ok(total >= 3, `__EXECVE__ total (${total}) should count the worker + its 2 spawned children`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reporter does NOT emit __EXECVE__ when QUAY_TEST_EXECVE_COUNT is unset (opt-in, zero overhead default)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-execve-off-"));
  try {
    const f = path.join(dir, "plain.test.mjs");
    writeFileSync(f, `import { test } from "node:test";\ntest("x", () => {});\n`);
    const res = runWithReporter([f]); // runWithReporter does NOT set the env
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);
    assert.doesNotMatch(res.stderr, /^__EXECVE__/m, "execve line must be absent by default (zero overhead)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reporter appends cpu_ms via route (a) 子进程自报 — a REAL per-file CPU, not derived from durationMs (gap-perfile-cpu-cost-collection AC1/AC5)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-cpu-"));
  const cpuDir = path.join(dir, "cpu");
  try {
    // One CPU-heavy file (burns CPU) + one wait-type file (sleeps) — their cpu_ms/duration_ms ratios
    // must DIFFER, proving cpu_ms is a real process.cpuUsage() measurement, not `durationMs × constant`.
    const heavy = path.join(dir, "heavy.test.mjs");
    writeFileSync(
      heavy,
      `import { test } from "node:test";\n` +
        `test("burn", () => { const s = Date.now(); let x = 0; while (Date.now() - s < 250) { x += Math.sqrt(x + 1); } if (x < 0) throw new Error(); });\n`
    );
    const wait = path.join(dir, "wait.test.mjs");
    writeFileSync(
      wait,
      `import { test } from "node:test";\n` +
        `import { setTimeout as sleep } from "node:timers/promises";\n` +
        `test("w", async () => { await sleep(250); });\n`
    );

    const env = {
      ...process.env,
      QUAY_PERFILE_CPU_DIR: cpuDir,
      NODE_OPTIONS: `--require=${path.join(repoRoot, "plugin", "scripts", "per-file-cpu-report.mjs")}`,
    };
    delete env.NODE_TEST_CONTEXT;
    const res = spawnSync(
      "node",
      ["--test", "--test-concurrency=2", `--test-reporter=${reporterPath}`, "--test-reporter-destination=stderr", heavy, wait],
      { encoding: "utf8", env }
    );
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);

    const lines = res.stderr.split("\n").filter((l) => l.startsWith("__PERFILE__ "));
    assert.equal(lines.length, 2, "two __PERFILE__ lines");
    const cpuByFile = new Map();
    for (const line of lines) {
      // AC1 — the real output line carries cpu_ms=<n>.
      const m = line.match(/__PERFILE__ duration_ms=([0-9.]+) (\S+) passed=(true|false) end_ms=([0-9]+) cpu_ms=([0-9.]+)/);
      assert.ok(m, `__PERFILE__ line must carry cpu_ms (AC1): ${line}`);
      cpuByFile.set(m[2], { durationMs: Number(m[1]), cpuMs: Number(m[5]) });
    }
    const h = cpuByFile.get(heavy);
    const w = cpuByFile.get(wait);
    assert.ok(h && w, "both files captured");
    assert.ok(h.cpuMs > 0 && w.cpuMs > 0, `cpu_ms is a real non-zero reading (heavy=${h.cpuMs} wait=${w.cpuMs})`);
    // AC5 non-derivation negative control: cpu_ms/duration_ms is NOT a constant. A CPU-burning file
    // always has a HIGHER CPU-per-wall ratio than a sleeping file — a constant ratio would prove the
    // value is derived from durationMs (the thing the AC forbids).
    const ratioH = h.cpuMs / h.durationMs;
    const ratioW = w.cpuMs / w.durationMs;
    assert.ok(
      ratioH > ratioW,
      `heavy ratio (${ratioH.toFixed(3)}) must exceed wait ratio (${ratioW.toFixed(3)}) — else cpu_ms is duration-derived`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reporter counts CHILD-process CPU — a spawn-heavy file is not under-reported to look like a waiting file (gap-perfile-cpu-cost-collection)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-cpu-child-"));
  const cpuDir = path.join(dir, "cpu");
  try {
    // A test file whose OWN in-process CPU is negligible (~10ms of execFileSync overhead) but which
    // spawns a child that burns ~500ms CPU and is REAPED by execFileSync. process.cpuUsage() alone
    // would report ~10ms; counting the reaped child (cutime+cstime) must push cpu_ms well past 250ms.
    // This is the exact misclassification the measurement exists to prevent: a spawn-heavy Type-1
    // file (worker-driver-fan-in.test.mjs et al.) must not be low-reported into looking like a
    // Type-2 waiting file.
    const spawner = path.join(dir, "spawner.test.mjs");
    writeFileSync(
      spawner,
      `import { test } from "node:test";\n` +
        `import { execFileSync } from "node:child_process";\n` +
        `test("spawner", () => {\n` +
        `  execFileSync(process.execPath, ["-e", "const e=Date.now()+500; while(Date.now()<e){}"]);\n` +
        `});\n`
    );

    const env = {
      ...process.env,
      QUAY_PERFILE_CPU_DIR: cpuDir,
      NODE_OPTIONS: `--require=${path.join(repoRoot, "plugin", "scripts", "per-file-cpu-report.mjs")}`,
    };
    delete env.NODE_TEST_CONTEXT;
    const res = spawnSync(
      "node",
      ["--test", `--test-reporter=${reporterPath}`, "--test-reporter-destination=stderr", spawner],
      { encoding: "utf8", env }
    );
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);

    const line = res.stderr.split("\n").find((l) => l.startsWith("__PERFILE__ "));
    assert.ok(line, "one __PERFILE__ line");
    const m = line.match(/__PERFILE__ duration_ms=([0-9.]+) (\S+) passed=(true|false) end_ms=([0-9]+) cpu_ms=([0-9.]+)/);
    assert.ok(m, `__PERFILE__ line must carry cpu_ms: ${line}`);
    const cpuMs = Number(m[5]);
    assert.ok(
      cpuMs > 250,
      `cpu_ms (${cpuMs.toFixed(1)}) must include the reaped child's ~500ms CPU — own-CPU-only would report ~10ms`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seam does NOT report for a non-test node -e probe (guard narrowed to --test-isolation; gap-perfile-cpu-cost-collection)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-guard-"));
  const cpuDir = path.join(dir, "cpu");
  try {
    const env = {
      ...process.env,
      QUAY_PERFILE_CPU_DIR: cpuDir,
      NODE_OPTIONS: `--require=${path.join(repoRoot, "plugin", "scripts", "per-file-cpu-report.mjs")}`,
    };
    delete env.NODE_TEST_CONTEXT;
    mkdirSync(cpuDir, { recursive: true }); // pre-create so readdirSync below never ENOENTs
    const res = spawnSync(
      "node",
      ["-e", "setTimeout(()=>{}, 30)", "probe-runid-12345"],
      { encoding: "utf8", env }
    );
    assert.equal(res.status, 0);
    // A `node -e` probe (execArgv = ["-e"], no --test-isolation) must NOT write a per-file CPU
    // report — the seam is for isolated TEST-FILE children only. This is the regression the guard
    // narrowing fixes: an unconditional seam injected an exit-time report into every node process,
    // which delayed non-test subprocess death and flipped serve-board.test.mjs's live-process
    // liveness fixture under suite load (production carrier: 488 green rounds, 1st red).
    assert.equal(
      readdirSync(cpuDir).length,
      0,
      "a node -e probe must NOT write a per-file CPU report (guard is --test-isolation, not unconditional)"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
