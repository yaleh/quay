// @test-group engine
// process-budget-liveness.test.mjs — gap-process-budget-in-use-undercounts-real-test-load.
//
// THE DEFECT (measured 2026-11-06 17:00 on a 128-vCPU / 246 GB shared host): while `loadavg` was 158
// and `pgrep -f 'test-isolation=process'` saw 45-66 live workers, `process-budget.sh --json` returned
//   {"total_budget":128,"in_use":12,"available":116,"verdict":"GO", ...}
// with LIVE workers sitting in its `excluded[]` array under `reason:"no_cpu_delta"` — a single 1-second
// CPU-tick window read 0 for a worker that was blocked on I/O (a `node --test` RUNNER waits on its
// children's output) or freshly spawned. Every suite derives its lane count from
// `max(1, floor((nproc − in_use) × oversub / S))`, so the "subtract what is already running" term
// subtracted nothing. The reading looks healthy (12 < 128, verdict GO) — that is the 硬规则 4 推论三 /
// 3b shape: a wrong number wearing the shape of a correct one.
//
// WHAT IS PINNED HERE (one live process per test, no fixtures — a fixture cannot show that the
// INSTRUMENT sees a real process):
//   AC1  positive control — N genuinely RUNNING test-shaped workers ⇒ in_use ≥ N
//   AC2  boundary positive control — a just-spawned, 0-tick, ALIVE worker must NOT be silently
//        excluded as `no_cpu_delta`; it gets its own state (`unknown[]`, `reason:"unknown_cpu_delta"`),
//        is visible OUTSIDE `excluded[]`, and is COUNTED in in_use
//   AC3  negative control — a truly hung process (0 ticks + an age the window cannot excuse) is STILL
//        excluded, with a named reason (the exclusion axis was not deleted to make the count bigger)
//   AC3b a delegating RUNNER (0 ticks itself, its child burns CPU) is counted — the tree-liveness half
//   AC4  `age_s` is a real age derived from /proc/<pid>/stat starttime + /proc/uptime, never the
//        poisoned `ps -o etimes=` (measured: 4123168608 s ≈ 130 years on this host), and an
//        implausible age fails closed
//   AC5  `in_use` and `node_cmdline_procs` are BOTH reported and their difference is a NAMED additive
//        identity — the decomposition, not just a bigger number
//
// Run:
//   node --test plugin/test/process-budget-liveness.test.mjs
//   scripts/test.sh --for-task gap-process-budget-in-use-undercounts-real-test-load --allow-thin

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROCESS_BUDGET = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
const SOURCE = fs.readFileSync(PROCESS_BUDGET, "utf8");

/** The kernel clock-tick rate, read from the HOST (getconf) — never a literal 100 (硬规则 4 推论二). */
const CLK_TCK = (() => {
  try {
    const hz = Number(execSync("getconf CLK_TCK", { encoding: "utf8" }).trim());
    return Number.isFinite(hz) && hz > 0 ? hz : null;
  } catch {
    return null;
  }
})();

/** Block synchronously without spawning anything (no subprocess, no CPU). */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Read one process's CPU ticks + starttime straight from /proc (independent of the script). */
function readProcStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm (field 2) is parenthesised and MAY contain spaces/parens ⇒ split after the LAST ')'.
    const rest = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    // rest[0] = field 3 (state) ⇒ field N is rest[N-3].
    return { ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]), starttime: Number(rest[19]) };
  } catch {
    return null;
  }
}

function uptimeSeconds() {
  return Number(fs.readFileSync("/proc/uptime", "utf8").split(/\s+/)[0]);
}

/** Age in whole seconds from /proc/<pid>/stat starttime + /proc/uptime (the AC4 formula). */
function ageSeconds(pid) {
  const st = readProcStat(pid);
  if (!st || !CLK_TCK) return null;
  return Math.max(0, Math.floor(uptimeSeconds() - st.starttime / CLK_TCK));
}

/** Run the REAL budget script with seams cleared (except those explicitly passed) and parse its JSON. */
function budget(extraEnv = {}) {
  const env = { ...process.env };
  for (const k of [
    "RESOURCE_GATE_TEST_PROC_CMDLINES",
    "RESOURCE_GATE_TEST_PROC_LIVENESS",
    "RESOURCE_GATE_TEST_CMDLINE_COUNT",
    "RESOURCE_GATE_TEST_COMM_COUNT",
    "RESOURCE_GATE_TEST_NODE_PROCS",
  ]) {
    delete env[k];
  }
  Object.assign(env, extraEnv);
  const res = spawnSync("bash", [PROCESS_BUDGET, "--json"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `process-budget.sh --json must exit 0\n${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

/** A test-shaped node process whose cmdline carries `--test-concurrency` (⇒ is_test_cmdline matches).
 *  `body` is the -e program; `readyFile` (when given) is written by the child once it has finished
 *  its startup work, so the caller can wait for "initialised and quiescent" instead of guessing. */
function spawnTestShaped(body, { readyFile } = {}) {
  const args = ["--test-concurrency=1", "-e", body];
  if (readyFile) args.push(readyFile);
  const child = spawn(process.execPath, args, {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
  });
  child.unref();
  return child;
}

function waitForFile(file, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    sleepMs(25);
  }
  return false;
}

/** Kill a detached child AND its process group (a delegating runner must not leave a burning orphan). */
function killTree(child) {
  try {
    child.stdin?.destroy();
  } catch {
    /* best-effort */
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

const READY_BODY =
  'require("fs").writeFileSync(process.argv[1],"ready");process.stdin.resume();process.stdin.on("end",()=>process.exit(0))';
const BUSY_BODY = "const t=Date.now();while(Date.now()-t<60000){Math.sqrt(Math.random())}";
// A RUNNER shape: it spawns a CPU-burning child, then blocks HARD (Atomics.wait — no timer, no
// listener, nothing that wakes it) so its OWN tick delta over the window is exactly 0.
const DELEGATING_BODY = [
  'const {spawn}=require("child_process");',
  `spawn(process.execPath,["-e",${JSON.stringify(BUSY_BODY)}],{stdio:"ignore"});`,
  'require("fs").writeFileSync(process.argv[1],"ready");',
  "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);",
].join("");

// ── AC1 — positive control ───────────────────────────────────────────────────────────────────────────

test("AC1 (positive control) — N genuinely RUNNING node --test-shaped workers are all counted in in_use", () => {
  const N = 3;
  const kids = [];
  try {
    for (let i = 0; i < N; i++) kids.push(spawnTestShaped(BUSY_BODY, {}));
    // Let every child exec so the ps snapshot carries the CHILD's cmdline, not the parent's.
    sleepMs(1200);
    const j = budget({ RESOURCE_GATE_TEST_NPROC: "128" });
    const livePids = new Set([...j.excluded, ...j.unknown].map((e) => e.pid));
    for (const kid of kids) {
      assert.ok(!livePids.has(kid.pid), `running worker ${kid.pid} must NOT be excluded/unknown — it burns CPU every tick`);
    }
    assert.ok(
      j.in_use >= N,
      `a host with ${N} running test workers must read in_use ≥ ${N} (got ${j.in_use}; live_by_self_cpu=${j.live_by_self_cpu})`,
    );
    assert.equal(j.liveness_source, "sampled", "the real-host path must report the SAMPLED axis");
  } finally {
    for (const kid of kids) killTree(kid);
  }
});

// ── AC2 — the boundary the defect actually hit ───────────────────────────────────────────────────────

test("AC2 (boundary positive control) — a just-spawned, 0-tick, ALIVE worker is NOT silently excluded as no_cpu_delta", () => {
  const readyFile = path.join(fs.mkdtempSync(path.join("/tmp", "pb-starting-")), "ready");
  const child = spawnTestShaped(READY_BODY, { readyFile });
  try {
    assert.ok(waitForFile(readyFile), "the worker must finish initialising before the reading");
    // Window ≫ the worker's age at snapshot time: the window has not observed this process long
    // enough for "0 ticks" to mean "it did not run" — that is the whole point of the AC.
    const j = budget({ RESOURCE_GATE_TEST_NPROC: "128", RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS: "2000" });

    assert.ok(
      !j.excluded.some((e) => e.pid === child.pid),
      `the live worker ${child.pid} must NOT appear in excluded[] (found ${JSON.stringify(j.excluded.filter((e) => e.pid === child.pid))})`,
    );
    const rec = j.unknown.find((e) => e.pid === child.pid);
    assert.ok(rec, `the live-but-unobservable worker ${child.pid} must be enumerated in unknown[] — "unobservable" needs its own state, not the hung verdict's shape`);
    assert.equal(rec.reason, "unknown_cpu_delta", "the state must be NAMED and distinguishable from no_cpu_delta");
    assert.equal(rec.cpu_delta_ticks, 0, "the control is real only if the window really read 0 ticks");
    assert.equal(j.unknown_count, j.unknown.length, "unknown_count must equal the enumerable unknown[] length");
    assert.ok(j.unknown_count >= 1, "unknown_count must count the enumerated entries");
    assert.ok(
      j.in_use >= 1,
      `a live-but-unobservable worker must be COUNTED in in_use (conservative direction; got ${j.in_use})`,
    );
  } finally {
    killTree(child);
    fs.rmSync(path.dirname(readyFile), { recursive: true, force: true });
  }
});

// ── AC3 — the negative control: the exclusion axis is still there ────────────────────────────────────

test("AC3 (negative control) — a genuinely HUNG process (0 ticks + old age) is still excluded, with a named reason", () => {
  const readyFile = path.join(fs.mkdtempSync(path.join("/tmp", "pb-hung-")), "ready");
  const child = spawnTestShaped(READY_BODY, { readyFile });
  try {
    assert.ok(waitForFile(readyFile), "the hung-shaped worker must initialise first");
    // Age the process well past the window: 0 ticks over a window the process is OLDER than is the
    // hung verdict's evidence (AC3's "0 tick + 老年龄"), not the "starting" state's.
    sleepMs(2600);
    const j = budget({ RESOURCE_GATE_TEST_NPROC: "128", RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS: "1000" });

    const rec = j.excluded.find((e) => e.pid === child.pid);
    assert.ok(rec, `the hung worker ${child.pid} must still be EXCLUDED (a fix that drops the exclusion axis would let dead suite trees inflate in_use forever)`);
    assert.equal(rec.reason, "no_cpu_delta", "the exclusion reason must be named");
    assert.equal(rec.cpu_delta_ticks, 0, "the hung control must really read 0 ticks");
    assert.ok(Number.isInteger(rec.age_s) && rec.age_s >= 2, `the hung record must carry a REAL age (got ${rec.age_s})`);
    assert.ok(!j.unknown.some((e) => e.pid === child.pid), "a hung process must not be filed under the unknown/starting state");
    assert.equal(j.excluded_count, j.excluded.length, "excluded_count must equal the enumerable excluded[] length");
  } finally {
    killTree(child);
    fs.rmSync(path.dirname(readyFile), { recursive: true, force: true });
  }
});

// ── AC3b — the tree-liveness half (a delegating RUNNER burns no CPU itself) ──────────────────────────

test("AC3b — a RUNNER that delegates (0 ticks itself, its child burns CPU) is counted, not excluded", () => {
  const readyFile = path.join(fs.mkdtempSync(path.join("/tmp", "pb-deleg-")), "ready");
  const parent = spawnTestShaped(DELEGATING_BODY, { readyFile });
  try {
    assert.ok(waitForFile(readyFile), "the runner must finish spawning its child");
    sleepMs(1200); // push the spawn-time CPU out of the window, and make age > window
    const before = readProcStat(parent.pid);
    const j = budget({ RESOURCE_GATE_TEST_NPROC: "128", RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS: "1000" });
    const after = readProcStat(parent.pid);

    assert.ok(
      !j.excluded.some((e) => e.pid === parent.pid),
      `the delegating runner ${parent.pid} must NOT be excluded — its TREE is working even though it is blocked (found ${JSON.stringify(j.excluded.filter((e) => e.pid === parent.pid))})`,
    );
    assert.ok(!j.unknown.some((e) => e.pid === parent.pid), "it is not a fresh spawn either — it must be counted as live");
    // Attribution: the runner's own tick counter did not move across the reading, and its age exceeds
    // the window ⇒ the ONLY way it can have been counted is the descendant axis (AC3b's mechanism).
    assert.ok(before && after, "the runner must still be readable from /proc");
    assert.equal(after.ticks - before.ticks, 0, `the control is real only if the runner itself burned 0 ticks (delta ${after ? after.ticks - before.ticks : "?"})`);
    assert.ok(j.live_by_self_cpu + j.live_by_descendant_cpu >= 1, "at least one live candidate must be attributable");
  } finally {
    killTree(parent); // kills the process GROUP ⇒ the burning grandchild goes too
    fs.rmSync(path.dirname(readyFile), { recursive: true, force: true });
  }
});

// ── AC4 — age_s is a real age, from a kernel quantity, not from `ps -o etimes=` ──────────────────────

test("AC4 — excluded[].age_s matches the /proc stat starttime conversion, and implausible ages fail closed", () => {
  const readyFile = path.join(fs.mkdtempSync(path.join("/tmp", "pb-age-")), "ready");
  const child = spawnTestShaped(READY_BODY, { readyFile });
  try {
    assert.ok(waitForFile(readyFile), "the control process must initialise first");
    sleepMs(2600);
    const ageBefore = ageSeconds(child.pid);
    const j = budget({ RESOURCE_GATE_TEST_NPROC: "128", RESOURCE_GATE_TEST_SAMPLE_WINDOW_MS: "1000" });
    const ageAfter = ageSeconds(child.pid);

    const rec = j.excluded.find((e) => e.pid === child.pid);
    assert.ok(rec, "the hung control must be in excluded[] (the age assertion needs a record)");
    assert.ok(Number.isInteger(rec.age_s), `age_s must be a real integer age for a readable pid (got ${rec.age_s})`);
    // The recorded age was taken somewhere between our two reads of the kernel value.
    assert.ok(
      rec.age_s >= ageBefore - 1 && rec.age_s <= ageAfter,
      `age_s=${rec.age_s} must lie between the /proc-derived ages measured around the reading (${ageBefore}..${ageAfter})`,
    );

    // ⛔ Fail-closed on implausible values: `ps -o etimes=` returned 4123168608 s (~130 years) on this
    // host on 2026-11-06 — a number that LOOKS like an age. Every entry must be null or ≤ host uptime.
    const uptime = uptimeSeconds();
    for (const e of [...j.excluded, ...j.unknown]) {
      assert.ok(
        e.age_s === null || (Number.isInteger(e.age_s) && e.age_s <= uptime + 1),
        `age_s=${e.age_s} for pid ${e.pid} is implausible (host uptime ${Math.floor(uptime)}s) — an unavailable age must be null, never a plausible-looking number`,
      );
    }
    // Source-level: the poisoned probe is GONE from the code (comments may still mention it as a warning).
    const code = SOURCE.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert.doesNotMatch(code, /-o etimes=/, "the age must never come from `ps -o etimes=` (measured 4123168608 s on this host)");
  } finally {
    killTree(child);
    fs.rmSync(path.dirname(readyFile), { recursive: true, force: true });
  }
});

// ── AC5 — the difference between node_cmdline_procs and in_use is NAMED, not implied ────────────────

test("AC5 — in_use and node_cmdline_procs are both reported AND their gap is a checkable additive identity", () => {
  const j = budget({ RESOURCE_GATE_TEST_NPROC: "128" });
  assert.ok(Number.isInteger(j.in_use), "in_use must be reported");
  assert.ok(Number.isInteger(j.node_cmdline_procs), "node_cmdline_procs must be reported alongside it");
  assert.ok(Number.isInteger(j.classified_test_candidates), "the test-candidate slice must be reported");
  assert.ok(Number.isInteger(j.infra_node_procs), "the infrastructure slice must be reported");
  assert.ok(j.infra_node_procs >= 0, "infra_node_procs is a count, never negative");
  assert.ok(j.classified_test_candidates >= j.in_use, "in_use is a SUBSET of the classified candidates");

  assert.equal(
    j.infra_node_procs + j.classified_test_candidates,
    j.node_cmdline_procs,
    "node_cmdline_procs = infra_node_procs + classified_test_candidates (the named gap)",
  );
  assert.equal(
    j.live_by_self_cpu + j.live_by_descendant_cpu + j.unknown_count + j.excluded_count,
    j.classified_test_candidates,
    "classified_test_candidates = live_by_self_cpu + live_by_descendant_cpu + unknown_count + excluded_count",
  );
  assert.equal(
    j.in_use,
    j.live_by_self_cpu + j.live_by_descendant_cpu + j.unknown_count,
    "in_use = self-burning + delegating + live-but-unobservable (each term named)",
  );
  assert.equal(j.count_accounting.evaluated, true, "the identity must actually be EVALUATED on the sampled path");
  assert.equal(j.count_accounting.node_cmdline_procs_equals_infra_plus_candidates, true);
  assert.equal(j.count_accounting.candidates_equal_live_plus_unknown_plus_excluded, true);
});

test("AC5 (3b) — a seam that pins a term makes the identity NOT-EVALUATED, never silently `ok`", () => {
  // 硬规则 3b: "cannot evaluate" must not share the shape of "passed". A pinned in_use cannot satisfy
  // an identity derived from a real sample, so `evaluated` is false and both identities are null.
  const j = budget({ RESOURCE_GATE_TEST_NODE_PROCS: "7" });
  assert.equal(j.in_use, 7, "the pinned seam still wins");
  assert.equal(j.count_accounting.evaluated, false, "a pinned term means the identity was NOT evaluated");
  assert.equal(j.count_accounting.node_cmdline_procs_equals_infra_plus_candidates, null, "un-evaluated is null, not true/false");
  assert.equal(j.count_accounting.candidates_equal_live_plus_unknown_plus_excluded, null, "un-evaluated is null, not true/false");
});

// ── The three-state seam (deterministic twin of AC2/AC3) ─────────────────────────────────────────────

test("AC2/AC3 (seam) — the pinned liveness axis has a THIRD state: `starting` is counted, `hung` is excluded", () => {
  const cmds = ["node --test a.test.mjs", "node --test b.test.mjs", "node --test c.test.mjs"];
  const j = budget({
    RESOURCE_GATE_TEST_NPROC: "128",
    RESOURCE_GATE_TEST_PROC_CMDLINES: cmds.join(";"),
    RESOURCE_GATE_TEST_PROC_LIVENESS: "hung;starting;live",
  });
  assert.equal(j.liveness_source, "seam", "a pinned liveness axis reports its own source");
  assert.equal(j.in_use, 2, "`starting` and `live` are counted; only `hung` is excluded");
  assert.deepEqual(j.excluded.map((e) => e.reason), ["seam:hung"], "the hung token is the only exclusion");
  assert.deepEqual(j.unknown.map((e) => e.reason), ["seam:starting"], "the starting token is enumerated OUTSIDE excluded[]");
  assert.deepEqual(j.unknown.map((e) => e.cmdline), [cmds[1]], "the unknown entry names WHICH process it is");
});
