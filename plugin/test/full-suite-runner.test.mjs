// @test-group governance
// full-suite-runner.test.mjs — tasks/gap-full-suite-belongs-to-outer-background-above-3-min.
//
// The (a) suite block of the three blocks that together eliminate "batch": the full suite
// (5-8 min magnitude, measured 11-12 min) belongs to the OUTER as background async — NOT
// blocking inner tasks. The runner (plugin/scripts/full-suite-runner.ts) spawns the suite,
// writes `.quay/full-suite-state.json`, and marks RED the moment a failure is detected.
//
// Coverage map (task ACs):
//   AC1 — result writes `.quay/full-suite-state.json` with the exact shape
//         {state: running|green|red, runner: outer|inner, startedAt, finishedAt, durationMs,
//          laneCount}; while running, finishedAt/durationMs are null.
//   AC2 — RED is marked on FIRST failure detection, not after the full run (marker-file
//         proof: red appears before the suite's post-failure step completes).
//   AC3 — the inner loop doc (fast-mode-loop-tick.md) reads the outer suite-state, and
//         carries ZERO `scripts/test.sh` literal (no full-suite self-run — the DoD grep).
//   AC4 — the red-window ruling is explicit: RED => inner stops dispatch AND holds fan-in.
//   AC5 — the >=3min/<3min threshold rule + durationMs measurement hook are in both loop docs.
//   AC7 — the three batch-eliminating blocks (a/b/c) are cross-annotated in the closure-sync
//         task file and the loop docs reference the (c) closure-decomposition task id.
//   AC8 — this file uses node:test and declares // @test-group governance.
//
// Task: gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red
//   AC1 — FAILURE_PATTERNS no longer matches the bare ✖ glyph; a vitest-style suite whose
//         PASSING test logs `✖ ...` console output stays GREEN (unit negative control +
//         e2e fake-suite proof). Structured vitest shapes (`❯ <file> (N tests | M failed)`,
//         `Test Files <N> failed`) DO flag.
//   AC2 — node:test/TAP true failures still flip red (`not ok` / `# fail` / `# cancelled`),
//         and a vitest structured failure line flips red EARLY (before the run completes).
//
// Run:
//   scripts/test.sh plugin/test/full-suite-runner.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isFailureLine, isAbortLine } from "../scripts/full-suite-runner.ts";
import { runOnce } from "../scripts/suite-state-trigger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const RUNNER = path.join(REPO_ROOT, "plugin/scripts/full-suite-runner.ts");
const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const INNER_TICK = path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md");
const CLOSURE_TASK = path.join(
  REPO_ROOT,
  "tasks/gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async.md",
);
const CLOSURE_DECOMP_TASK_ID = "gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function statePath(root) {
  return path.join(root, ".quay", "full-suite-state.json");
}

function readState(root) {
  const p = statePath(root);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

/** Write a fake "test suite" bash script; returns { dir, f }. */
function fakeSuite(scriptBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-fake-"));
  const f = path.join(dir, "fake-suite.sh");
  fs.writeFileSync(f, "#!/usr/bin/env bash\n" + scriptBody + "\n", { mode: 0o755 });
  return { dir, f };
}

/** Spawn the runner against a temp root with a fake command. */
function runRunner({ root, command, laneCount, stateDir, env = {} }) {
  const args = ["--no-warnings", "--experimental-strip-types", RUNNER, "--root", root];
  if (stateDir) args.push("--state-dir", stateDir);
  if (command) args.push("--command", command);
  if (laneCount !== undefined && laneCount !== null) args.push("--lane-count", String(laneCount));
  const mergedEnv = { ...process.env, ...env };
  // AC3 seam — hermetic tests skip the REAL resource gate by default; the AC3 tests override it
  // (QUAY_TEST_SKIP_RESOURCE_GATE != "1") and force GO/WAIT via the gate's RESOURCE_GATE_TEST_* seams.
  if (!("QUAY_TEST_SKIP_RESOURCE_GATE" in mergedEnv)) mergedEnv.QUAY_TEST_SKIP_RESOURCE_GATE = "1";
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: mergedEnv });
  // Drain pipes so a chatty fake suite cannot block the child.
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

/**
 * A fake `<root>/scripts/test.sh` that records its args to `argsLog` and prints a green TAP summary.
 * Used to observe the runner's spliced --test-concurrency (the real test.sh's static checks / dist
 * build are irrelevant to the runner's splice).
 */
function fakeTestShRecordingArgs(root) {
  const argsLog = path.join(root, "args.txt");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\necho "$*" > '${argsLog}'\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n`,
    { mode: 0o755 },
  );
  return { argsLog };
}

function waitExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function poll(fn, { timeoutMs = 5000, intervalMs = 30 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const v = fn();
        if (v) return resolve(v);
      } catch {
        // file may be mid-write; retry
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`poll timeout after ${timeoutMs}ms`));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const GREEN_SUITE = 'echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0';

test("AC1 — a green run writes the exact suite-state shape to .quay/full-suite-state.json", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);

    const s = readState(root);
    assert.ok(s, "state file written");
    assert.deepEqual(
      Object.keys(s).sort(),
      ["durationMs", "finishedAt", "laneCount", "runner", "startedAt", "state"],
      "exact suite-state shape (AC1)",
    );
    assert.equal(s.state, "green");
    assert.equal(s.runner, "outer");
    assert.equal(s.laneCount, 8);
    assert.ok(!Number.isNaN(Date.parse(s.startedAt)), "startedAt is ISO");
    assert.ok(!Number.isNaN(Date.parse(s.finishedAt)), "finishedAt is ISO");
    assert.equal(typeof s.durationMs, "number", "durationMs is the AC5 measurement hook");
    assert.ok(s.durationMs >= 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-suite-state-split-across-worktree-and-gate: AC1/AC2/AC3 (--state-dir split) ────────────────

test("AC1/AC2 — --state-dir decouples the state/log write location from --root (the tested checkout)", async () => {
  // A worktree full-suite run passes `--root <worktree> --state-dir <main-repo>/.quay` so the gate
  // (inner stop conditions + suite-state-trigger, which read ONLY the main repo's relative
  // .quay/full-suite-state.json) sees the runner's REAL result instead of the stale main-repo red
  // the split left behind (the 123-minute blind window).
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-split-"));
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-main-"));
  const gateDir = path.join(mainRoot, ".quay");
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root: worktree, command: `bash ${f}`, laneCount: 8, stateDir: gateDir });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);

    const s = readState(mainRoot);
    assert.ok(s, "the main-repo (gate) state file was written");
    assert.equal(s.state, "green", "the gate-dir state reflects the real green result (AC1)");
    assert.equal(s.laneCount, 8);
    // the sync bridge: the worktree's OWN state is mirrored to the same bytes — the Contract band
    // `cmp -s <worktree-state> <main-repo-state>` = same after a worktree run
    const wt = readState(worktree);
    assert.ok(wt, "the worktree's own state is mirrored");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(worktree, ".quay", "full-suite-state.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.join(mainRoot, ".quay", "full-suite-state.json"), "utf8")),
      "worktree state byte-identical to the main-repo (gate) state (state_synced = same)",
    );
    // the suite log + verification-round ledger land in the gate dir too (same split)
    assert.ok(fs.existsSync(path.join(gateDir, "full-suite.log")), "log written to --state-dir");
    assert.ok(fs.existsSync(path.join(gateDir, "verification-round.jsonl")), "verification-round written to --state-dir");
    // AC2 — the gate read (suite-state-trigger against the MAIN repo) sees green, no stop signal
    const res = runOnce(mainRoot);
    assert.equal(res.status, "green", "the gate reads the same green result (AC2)");
    assert.equal(res.stopSignal, false, "green must not stop dispatch");
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(mainRoot, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — negative control: a red worktree run writes red to --state-dir (no false green in the gate)", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-splitred-"));
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-mainred-"));
  const gateDir = path.join(mainRoot, ".quay");
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"\nexit 1');
  try {
    const child = runRunner({ root: worktree, command: `bash ${f}`, stateDir: gateDir });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(mainRoot);
    assert.ok(s, "the main-repo (gate) state file was written");
    assert.equal(s.state, "red", "the gate-dir state reflects the real red result (AC3)");
    assert.equal(s.reason, "failed", "a real failure is reason=failed (stop-dispatch signal)");
    // the sync bridge mirrors red to the worktree too — both red, no false green anywhere
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(worktree, ".quay", "full-suite-state.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.join(mainRoot, ".quay", "full-suite-state.json"), "utf8")),
      "worktree state byte-identical to the main-repo (gate) state on red too",
    );
    const res = runOnce(mainRoot);
    assert.equal(res.status, "red");
    assert.equal(res.stopSignal, true, "red+failed must stop dispatch (batch merge only on true green)");
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(mainRoot, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC16 — --lane-count N propagates --test-concurrency=N into the spawned test.sh command", async () => {
  // Regression for outer 2026-08-05 ABORT #2: the command was static `bash scripts/test.sh`,
  // so --lane-count only wrote the state field while the suite still ran the default
  // concurrency (measured 9 processes at concurrency 8, PSI 94 — the crash). Now an explicit
  // --lane-count MUST splice --test-concurrency=<N> into the spawned command.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac16-"));
  const argsLog = path.join(root, "args.txt");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\necho "$*" > '${argsLog}'\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n`,
    { mode: 0o755 },
  );
  try {
    const child = runRunner({ root, laneCount: 2 }); // NO --command → default path with splice
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.equal(s.state, "green");
    assert.equal(s.laneCount, 2);
    await poll(() => fs.existsSync(argsLog));
    const args = fs.readFileSync(argsLog, "utf8").trim();
    assert.ok(args.includes("--test-concurrency=2"), `--lane-count must splice --test-concurrency=N, got: ${args}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-full-suite-runner-concurrency-default-and-gate: AC1/AC2/AC3/AC4 ─────────────────────────────

test("AC1 — default laneCount is NPROC-derived (nproc=4 → 4); spawned command carries ONE --test-concurrency=4", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    // NO --lane-count, NO --command → default path; RESOURCE_GATE_NPROC=4 forces the derivation.
    // AMPLIFICATION = 1.0 (AC5 cost-side-verified 2026-08-08 — zero cancelled at c4/c8, nproc is
    // the wall-clock sweet spot), so 4 cores → 4 lanes.
    const child = runRunner({ root, env: { RESOURCE_GATE_NPROC: "4" } });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.equal(s.laneCount, 4, "derived default laneCount = max(1, floor(4/1.0)) = 4 (cost-side-verified, was 1 under the 2.1 guard)");
    await poll(() => fs.existsSync(argsLog));
    const args = fs.readFileSync(argsLog, "utf8").trim();
    assert.equal(args, "--test-concurrency=4", `exactly ONE --test-concurrency=<derived> spliced, got: ${args}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — the splice is REPLACE: an existing --test-concurrency=8 (= and space spellings) is stripped and replaced by the derived value", async () => {
  for (const existing of ["--test-concurrency=8", "--test-concurrency 8"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2-"));
    const { argsLog } = fakeTestShRecordingArgs(root);
    try {
      const child = runRunner({
        root,
        command: `bash scripts/test.sh ${existing}`,
        env: { RESOURCE_GATE_NPROC: "4" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 on green (existing '${existing}'), got ${code}`);
      await poll(() => fs.existsSync(argsLog));
      const args = fs.readFileSync(argsLog, "utf8").trim();
      assert.equal(
        args,
        "--test-concurrency=4",
        `existing '${existing}' must be REPLACED by the derived value (single flag), got: ${args}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("AC3 — resource gate WAIT ⇒ the runner does NOT start and leaves the state file untouched", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  // A prior GREEN suite verdict that MUST survive a WAIT byte-untouched (AC3: state stays running/green).
  const prior = {
    state: "green",
    runner: "outer",
    startedAt: "2026-08-05T06:00:00.000Z",
    finishedAt: "2026-08-05T06:05:00.000Z",
    durationMs: 300000,
    laneCount: 1,
  };
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(prior, null, 2) + "\n", "utf8");
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0", // force the REAL gate path, with seams
        RESOURCE_GATE_TEST_CPU_AVG10: "84.77", // WAIT (cpu stalled)
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      },
    });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "WAIT ⇒ the runner exits non-zero (did not run)");
    const s = readState(root);
    assert.equal(s.state, "green", "state stays green (untouched) on WAIT");
    assert.equal(s.durationMs, 300000, "the prior state object is byte-untouched");
    assert.ok(!fs.existsSync(argsLog), "the suite was NEVER spawned on WAIT");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — resource gate GO ⇒ the runner starts (state=running then green)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3go-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "10", // GO (cpu calm)
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "GO ⇒ the runner runs and exits 0 on green");
    assert.equal(readState(root).state, "green");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned on GO");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — negative control: explicit --lane-count 8 + command already has =8 ⇒ exactly ONE =8 (replace, not two)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac4-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    const child = runRunner({ root, command: "bash scripts/test.sh --test-concurrency=8", laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    await poll(() => fs.existsSync(argsLog));
    const args = fs.readFileSync(argsLog, "utf8").trim();
    assert.equal(
      args,
      "--test-concurrency=8",
      `existing =8 stripped + explicit 8 spliced ⇒ ONE =8 total (ABORT #5 was two 8s), got: ${args}`,
    );
    assert.equal(readState(root).laneCount, 8, "explicit --lane-count 8 wins and is recorded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5 — a signal-killed run writes state=red reason=aborted, which must NOT trigger stop-dispatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac5-"));
  // Flake fix (fan-in reland 2026-08-05): the external `child.kill("SIGTERM")` was delivered to the
  // runner only intermittently in the node --test harness (state stayed "running" after exit ~30-70%
  // of runs). Instead, the fake suite SIGNALS THE RUNNER ITSELF — after sleep 1, it walks its own
  // ancestor chain up to the nearest node process (the runner, which spawned the suite AFTER
  // registering its SIGTERM handler, so the handler is guaranteed registered) and SIGTERMs it.
  // Deterministic: the signal comes from inside the runner's own process tree, no external delivery.
  const { f, dir } = fakeSuite(
    'sleep 1\n' +
    'runner_pid=$PPID\n' +
    'while [ -n "$runner_pid" ] && [ "$runner_pid" != "1" ]; do\n' +
    '  # detect the node runner via /proc/<pid>/exe, not `ps -o comm` — node\n' +
    '  # processes report comm=`MainThread` on this machine, so a `node*` match\n' +
    '  # silently misses the runner and the self-signal is never delivered.\n' +
    '  exe=$(readlink "/proc/$runner_pid/exe" 2>/dev/null || true)\n' +
    '  case "$exe" in */node|*/nodejs) kill -TERM "$runner_pid"; break ;; esac\n' +
    '  runner_pid=$(ps -o ppid= -p "$runner_pid" 2>/dev/null | tr -d " ")\n' +
    'done\n' +
    'sleep 5\n' +
    'echo "# fail 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    await poll(() => {
      const s = readState(root);
      return s && s.state === "running" ? s : null;
    }, { timeoutMs: 10000 });
    // The fake suite signals the runner at ~t+1s; the runner exits when the handler runs.
    await waitExit(child);
    // The runner's signal handler writes red+aborted (no correctness conclusion).
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "aborted" ? cur : null;
    }, { timeoutMs: 10000 });
    assert.equal(s.reason, "aborted", "a kill produces reason=aborted, not failed");
    // And the stop-dispatch consumer (runOnce) reports NO stop signal for aborted-red (AC5).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "aborted-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6 — this task cross-annotates the shared stop-dispatch family (gap-red-window-dispatch-stop-should-be-shared-gate-conditional)", () => {
  const task = read(path.join(REPO_ROOT, "tasks/gap-full-suite-runner-concurrency-default-and-gate.md"));
  assert.match(
    task,
    /gap-red-window-dispatch-stop-should-be-shared-gate-conditional/,
    "this task must cross-annotate the shared-gate stop-dispatch task (AC6)",
  );
  const shared = read(path.join(REPO_ROOT, "tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md"));
  assert.match(
    shared,
    /gap-full-suite-runner-concurrency-default-and-gate/,
    "the shared-gate task must cross-annotate THIS task (AC6)",
  );
});

test("AC1 — while the suite runs, state=running with finishedAt/durationMs null", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  const { f, dir } = fakeSuite('echo "started"\nsleep 2\necho "# fail 0"\nexit 0');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const running = await poll(() => {
      const s = readState(root);
      return s && s.state === "running" ? s : null;
    }, { timeoutMs: 1500 });
    assert.equal(running.runner, "outer");
    assert.equal(running.finishedAt, null, "finishedAt null while running");
    assert.equal(running.durationMs, null, "durationMs null while running");
    const { code } = await waitExit(child);
    assert.equal(code, 0);
    assert.equal(readState(root).state, "green");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — RED is marked on first failure detection, before the run completes (marker-file proof)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  const marker = path.join(root, "post-failure-marker");
  const { f, dir } = fakeSuite(`echo "not ok 1 - boom"\nsleep 2\necho done > "${marker}"\nexit 1`);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // The failure line is printed immediately; the suite's post-failure step (writing the
    // marker) happens only after `sleep 2`. If state=red is observed BEFORE the marker
    // exists, red was written on detection, not after the run completed (AC2).
    const redObserved = await poll(() => {
      const s = readState(root);
      return s && s.state === "red" ? s : null;
    }, { timeoutMs: 5000 });
    assert.equal(redObserved.finishedAt, null, "red written while the run is still in progress");
    assert.equal(redObserved.state, "red");
    assert.ok(!fs.existsSync(marker), "red appeared before the suite's post-failure step completed");

    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    assert.ok(fs.existsSync(marker), "suite finished its post-failure step after red was marked");

    const final = readState(root);
    assert.equal(final.state, "red");
    assert.ok(final.finishedAt, "final red has finishedAt");
    assert.equal(typeof final.durationMs, "number", "durationMs recorded even on red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 unit — the failure markers match STRUCTURED failure lines, never bare glyphs or passing lines", () => {
  for (const line of [
    "not ok 1 - something failed",
    "# fail 2",
    "# cancelled 1",
    "FULL-SUITE-EXIT=1",
    // vitest structured failures (gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red AC1)
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
    " ❯ test/foo.test.ts (3 tests | 1 failed | 2 skipped) 12ms",
    "Test Files  1 failed | 10 passed (11)",
  ]) {
    assert.equal(isFailureLine(line), true, `should flag: ${line}`);
  }
  for (const line of [
    "# tests 2239",
    "# pass 2239",
    "# fail 0",
    "# cancelled 0",
    "FULL-SUITE-EXIT=0",
    "ok 1 - passing test",
    // bare ✖ console noise must NOT flag (AC1 negative control: a passing vitest negative-control
    // test logs `✖ Diagram test failed` — the old /✖/ pattern produced a FALSE early-red)
    "✖ Diagram test failed",
    // vitest passing lines must NOT flag (structured shapes only, not bare glyphs)
    " ✓ test/foo.test.ts (3 tests) 12ms",
    " ❯ test/foo.test.ts (3 tests) 12ms",
    "Test Files  10 passed (11)",
    "   × some individual test name",
  ]) {
    assert.equal(isFailureLine(line), false, `should not flag: ${line}`);
  }
});

// ── gap-suite-state-has-no-reason-axis-failed-aborted-infra: AC1/AC2/AC3 (reason axis) ─────────────

test("AC5 unit — isAbortLine matches the early-EXIT gate-WAIT shape, never a failure line", () => {
  for (const line of [
    "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO.",
    "resource gate says WAIT",
    "not running the full suite",
  ]) {
    assert.equal(isAbortLine(line), true, `should flag as abort: ${line}`);
  }
  for (const line of [
    "not ok 1 - boom",
    "# fail 2",
    "# cancelled 1",
    "FULL-SUITE-EXIT=1",
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
  ]) {
    assert.equal(isAbortLine(line), false, `a real failure line is NOT an abort line: ${line}`);
  }
});

test("AC1/AC3 — an early-EXIT red (test.sh internal resource-gate WAIT fail-closed) is reason=aborted, NOT failed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-abort-"));
  // The concrete shape from today's FALSE-RED incidents: test.sh's INTERNAL resource-gate fail-closed
  // prints `resource gate says WAIT — not running the full suite ...` to stderr and exits 1 in ~6s
  // WITHOUT running a single test. The runner must classify this as reason=aborted (NO correctness
  // conclusion), never reason=failed — a failed label would stop dispatch on code risk with zero
  // evidence (the coincidence gap the task exists to close).
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO." >&2\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "gate-WAIT early-exit is red (not green)");
    assert.equal(s.reason, "aborted", "early gate-WAIT exit is reason=aborted, NOT failed (AC1/AC3)");
    assert.ok(s.finishedAt, "final aborted-red has finishedAt");
    assert.equal(typeof s.durationMs, "number", "durationMs recorded even on the aborted run");
    // The stop-dispatch consumer must NOT stop on this aborted-red (AC2: aborted routes to the
    // resource-gate, NOT to code-risk stop).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "aborted-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a REAL failure after an abort marker is NOT downgraded: reason stays failed (failure conclusion stands)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-dom-"));
  // Defensive: even if an abort marker appears first, a later real failure line is the stronger
  // conclusion — redDetected must dominate abortDetected (AC5: the failure conclusion stands).
  const { f, dir } = fakeSuite('echo "resource gate says WAIT" >&2\necho "not ok 1 - boom"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "a real failure after an abort marker stays failed, never downgraded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a child killed by a signal (SIGKILL) writes reason=aborted (no correctness conclusion)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sigkill-"));
  // A SIGKILL'd suite exits with code=null + signal=SIGKILL: the runner cannot read a verdict, so it
  // is an abort (no correctness conclusion), NOT a failure. Previously this fell into the fail-closed
  // catch-all and was mislabelled failed (the early-EXIT-red-as-failed bug).
  const { f, dir } = fakeSuite('echo "about to die"\nkill -9 $$\necho "unreachable"');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a killed suite");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "aborted" ? cur : null;
    }, { timeoutMs: 5000 });
    assert.ok(s, "signal-killed child is final state=red reason=aborted");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a SIGKILL'd node --test reported by bash as exit 137 is reason=aborted, NOT failed (the 07:08→07:21 shape)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-137-"));
  // gap-suite-cutoff-what-tears-test-process-at-session-topology (confirmed 2026-08-07): in the real
  // full-suite path test.sh runs `node --test` as a CHILD and bash reports a SIGKILL'd child as its
  // OWN exit code 128+N (137 for SIGKILL). The runner's child is `bash -c <test.sh>`, so it sees
  // exit.code=137, exit.signal=null — the pre-fix childKilledBySignal (`exitCode === null`) missed
  // this and mislabelled it reason=failed (a stop-dispatch signal). Reproduce the bash shape:
  //   bash runs a child, the child is SIGKILL'd externally, bash `wait`s it (→137) and exits 137.
  const { f, dir } = fakeSuite(
    'echo "simulating a SIGKILL\'d node --test child"\n' +
      "sleep 30 &\n" +
      "child=$!\n" +
      "kill -9 \"$child\"\n" +
      "wait \"$child\" 2>/dev/null\n" +
      "code=$?\n" +
      'echo "bash observed child killed, exiting $code"\n' +
      "exit \"$code\"",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on an aborted suite");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "aborted" ? cur : null;
    }, { timeoutMs: 5000 });
    assert.ok(s, `bash-exits-137 signal-kill is final state=red reason=aborted (got ${JSON.stringify(readState(root))})`);
    // And the stop-dispatch consumer (runOnce) reports NO stop signal for aborted-red (AC5).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "bash-137 aborted-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a generic non-zero exit with NO failure/abort marker stays reason=failed (fail-closed catch-all)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-catch-"));
  // The reason-axis boundary: an unmatched non-zero exit could be a real failure no structured line
  // matched. Failing CLOSED (reason=failed) preserves the stop-dispatch signal for that class; only a
  // recognised NO-conclusion shape (abort marker / signal kill / spawn error) is relaxed to aborted.
  const { f, dir } = fakeSuite('echo "something went wrong"\nexit 3');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "an unmatched non-zero exit stays fail-closed failed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — a passing vitest-style suite logging a bare-X console line stays GREEN (no false early-red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1x-"));
  // archguard TASK-67 shape: a PASSING negative-control test logs `✖ Diagram test failed` to
  // console.error; the vitest summary is 0 failed / exit 0. The old bare-✖ FAILURE_PATTERN turned
  // this GREEN suite red. With structured matching it must stay green (AC1).
  const { f, dir } = fakeSuite(
    'echo "✖ Diagram test failed" >&2\n' +
      'echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.equal(s.state, "green", "bare ✖ console noise must NOT flip state to red (AC1)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — a vitest structured failure line flips red EARLY, before the run completes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vit-"));
  const marker = path.join(root, "post-failure-marker");
  // A real failing vitest run prints the structured per-file line (`❯ <file> (N tests | M failed)`)
  // BEFORE its summary and exit. Red must be marked on that line, not at exit — the same early-red
  // property node:test/TAP gets from `not ok` (AC2 preserved for vitest projects).
  const { f, dir } = fakeSuite(
    'echo " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms"\nsleep 2\necho done > "' +
      marker +
      '"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const redObserved = await poll(() => {
      const s = readState(root);
      return s && s.state === "red" ? s : null;
    }, { timeoutMs: 5000 });
    assert.equal(redObserved.state, "red");
    assert.equal(redObserved.reason, "failed", "a structured vitest failure is a REAL failure (stop-dispatch signal)");
    assert.equal(redObserved.finishedAt, null, "red written while the run is still in progress (AC2 early-red)");
    assert.ok(!fs.existsSync(marker), "red appeared before the suite's post-failure step completed");
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — the inner stop-condition reads the outer suite-state; the inner doc has ZERO scripts/test.sh self-run literal", () => {
  const inner = read(INNER_TICK);
  // Inner reads the suite-state file and its `state` field (running/green => proceed, red => stop).
  assert.ok(inner.includes(".quay/full-suite-state.json"), "inner doc reads .quay/full-suite-state.json");
  assert.ok(inner.includes("`state`"), "inner doc reads the `state` field");
  assert.ok(inner.includes("running"), "inner doc handles running");
  assert.ok(inner.includes("green"), "inner doc handles green");
  assert.ok(inner.includes("red"), "inner doc handles red");
  // DoD grep: inner side has NO full-suite self-run literal.
  assert.ok(
    !inner.includes("scripts/test.sh"),
    "inner doc has NO scripts/test.sh literal (inner 零全量套件自跑 — DoD grep proof)",
  );
});

test("AC4 — the red-window ruling is explicit in the loop docs: RED => stop dispatch + hold fan-in", () => {
  const outer = read(OUTER_TICK);
  const inner = read(INNER_TICK);
  // The red state IS the stop-dispatch signal (outer writes it via the runner; inner reads it).
  assert.ok(outer.includes("stop-dispatch 信号"), "outer doc names the stop-dispatch signal (AC4)");
  assert.ok(outer.includes("红窗分诊"), "outer doc has the red-window triage section (AC4)");
  // GREEN/RUNNING => optimistic merge/dispatch (the point of eliminating the sync point).
  assert.ok(inner.includes("RUNNING 不等套件"), "inner doc proceeds on RUNNING (optimistic, AC4)");
  // RED => stop new dispatch AND hold completed-agent fan-in.
  assert.ok(
    inner.includes("暂缓已完成 agent 的 fan-in"),
    "inner doc holds fan-in on red (AC4) — only stopping dispatch lets a red tree keep accumulating",
  );
});

test("AC5 — the >=3min/<3min threshold rule + durationMs measurement hook are in both loop docs", () => {
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(doc.includes("3 分钟"), `${name} doc has the 3-minute threshold`);
    assert.ok(doc.includes("durationMs"), `${name} doc names durationMs as the measurement hook`);
  }
});

test("AC7 — the three batch-eliminating blocks (a/b/c) are cross-annotated in the closure-sync task and loop docs", () => {
  const closure = read(CLOSURE_TASK);
  assert.ok(
    closure.includes("gap-full-suite-belongs-to-outer-background-above-3-min"),
    "closure-sync task names the (a) suite block (cross-annotation)",
  );
  assert.ok(
    closure.includes(CLOSURE_DECOMP_TASK_ID),
    "closure-sync task names the (c) AC/evidence block",
  );
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(
      doc.includes(CLOSURE_DECOMP_TASK_ID),
      `${name} loop doc references the (c) closure-decomposition task id (AC7)`,
    );
  }
});

// ── Contract invoke (gap-full-suite-runner-marks-test-sh-gate-wait-as-failed) ──────────
// --wait-check is the ABORT-side twin of --fail-fast-check: it proves the gate-WAIT ⇒ aborted ⇒
// NO-stop-dispatch chain end-to-end via a runnable CLI control (the Contract's `measure` surface).

function runCli(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, out, err }));
  });
}

test("AC1 Contract invoke — `full-suite-runner.ts --wait-check` proves: test.sh gate-WAIT => red reason=aborted => NO stopSignal", async () => {
  const { code, out, err } = await runCli(RUNNER, ["--wait-check"]);
  assert.equal(code, 0, `--wait-check exits 0 when the ABORT chain works; got ${code}\n${out}\n${err}`);
  assert.match(out, /wait-check OK/, "verification line present");
  assert.match(out, /reason=aborted/, "gate-WAIT is reason=aborted (no correctness conclusion)");
  assert.match(out, /stopSignal=false/, "aborted-red must NOT stop dispatch (AC1)");
  assert.match(out, /SUITE-RED/, "SUITE-RED event still recorded (red noticed, routed by reason)");
});
