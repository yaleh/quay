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
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isFailureLine,
  isAbortLine,
  isStaticCheckFailureLine,
  extractStaticCheckDetail,
  isGitWorktree,
  readStateRunId,
  writeStateGuarded,
  buildSystemdRunArgv,
  DEFAULT_SYSTEMD_RUN_LIMITS,
  parseSystemdRunLimits,
  systemdRunAvailable,
} from "../scripts/full-suite-runner.ts";
import { runOnce, classifyFailure, routeRed, shouldStopDispatch } from "../scripts/suite-state-trigger.ts";

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
  // gap-systemd-run-limits-for-suite-and-heavy-ops seam — hermetic tests skip the REAL systemd-run
  // cgroup-scope wrapper by default (a temp-root fake suite needs no user systemd session); the
  // AC1-AC6 tests below opt in via QUAY_TEST_SYSTEMD_RUN_AVAILABLE=1 / QUAY_TEST_SKIP_SYSTEMD_RUN=0.
  if (!("QUAY_TEST_SKIP_SYSTEMD_RUN" in mergedEnv)) mergedEnv.QUAY_TEST_SKIP_SYSTEMD_RUN = "1";
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
      [
        "durationMs",
        "finishedAt",
        "laneCount",
        "pid",
        "runId",
        "runner",
        "scope",
        "startedAt",
        "state",
      ],
      "exact suite-state shape (AC1 + gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1 scope + gap-full-suite-state-race-last-write-wins-no-generation-guard runId + gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 pid)",
    );
    assert.equal(s.state, "green");
    assert.equal(s.runner, "outer");
    assert.equal(s.laneCount, 8);
    assert.ok(s.runId && typeof s.runId === "string", "every state write carries a runId generation token");
    assert.ok(!Number.isNaN(Date.parse(s.startedAt)), "startedAt is ISO");
    // gap-batch-merge-gate-reads-stale-green: finishedAt is EPOCH SECONDS (the batch-merge freshness
    // gate's Contract measure `int(time.time() - finishedAt)` needs epoch, not ISO).
    assert.equal(typeof s.finishedAt, "number", "finishedAt is epoch seconds (suite_freshness measure)");
    assert.ok(s.finishedAt > 0, "finishedAt epoch seconds is positive");
    assert.equal(typeof s.durationMs, "number", "durationMs is the AC5 measurement hook");
    assert.ok(s.durationMs >= 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-merge-green-snapshot-verified-commit-livelock: AC2 (verifiedCommit / commit) ────────────────

test("AC2 — a git-repo run records verifiedCommit (the integration tip at suite start) in the state AND the round record", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vc-"));
  // A REAL git repo (not a hermetic non-git temp root) so `git rev-parse HEAD` resolves — the hermetic
  // AC1 exact-shape test above stays byte-stable because a non-git root omits the field.
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.ok(s, "state file written");
    assert.equal(s.verifiedCommit, head, "state carries the tested commit (the integration tip at suite start)");
    // The verification-round record carries the same verified commit (AC2, second half).
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.commit, head, "round record carries the verified commit");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — the worktree state mirror carries the SAME verifiedCommit (SYNC BRIDGE byte-identical)", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vc-wt-"));
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vc-main-"));
  execSync("git init -q", { cwd: worktree });
  execSync("git config user.name fsr-test", { cwd: worktree });
  execSync("git config user.email fsr@example.com", { cwd: worktree });
  fs.writeFileSync(path.join(worktree, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: worktree });
  const gateDir = path.join(mainRoot, ".quay");
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root: worktree, command: `bash ${f}`, laneCount: 8, stateDir: gateDir });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const wt = readState(worktree);
    const main = readState(mainRoot);
    assert.ok(wt && main, "both states written");
    assert.ok(wt.verifiedCommit, "worktree state carries verifiedCommit");
    assert.equal(wt.verifiedCommit, main.verifiedCommit, "mirror carries the SAME verifiedCommit");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(worktree, ".quay", "full-suite-state.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.join(mainRoot, ".quay", "full-suite-state.json"), "utf8")),
      "worktree state byte-identical to the main-repo (gate) state (state_synced = same)",
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(mainRoot, { recursive: true, force: true });
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

// ── gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed: AC2 (reporter glyph forms) ──────
// The round-149 real failure emitted `ℹ fail 1` (info-glyph summary), `✖ <testname> (Nms)`
// (spec-reporter per-test failure) and `__PERFILE__ ... passed=false` (measure-suite-reporter
// per-file failure) — NONE of which the old FAILURE_PATTERNS recognized (it only knew `not ok` /
// `# fail` / `# cancelled` / vitest `❯`), so redDetected stayed false and the red carried
// failures=[] / redAt=null. These pin the fix (AC2): the reporter forms flag; the passing forms
// and the bare-✖ negative control (TASK-67) still do NOT.

test("AC2 unit — FAILURE_PATTERNS recognize the reporter info-glyph + per-file + leak-scan failure forms", () => {
  for (const line of [
    "ℹ fail 1", // measure-suite-reporter / spec-reporter info-glyph summary
    "ℹ cancelled 1", // info-glyph cancelled summary
    "✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0) (3.411515ms)", // spec-reporter per-test failure
    "✖ some test name (12ms)", // short spec-reporter failure line
    "✖ failing tests:", // spec-reporter failure-block header (only emitted when tests failed)
    "__PERFILE__ duration_ms=3580.991183 /home/yale/work/quay/packages/quay/test/verify-delivery-surface.test.mjs passed=false", // per-file failure
    "__PERFILE__ duration_ms=100 packages/quay/test/foo.test.mjs passed=false", // per-file failure, relative path
    "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot)", // candidate C leak-scan residual
  ]) {
    assert.equal(isFailureLine(line), true, `should flag: ${line}`);
  }
  // negative controls — a PASSING run never emits these, and the bare-✖ console-noise guard holds:
  for (const line of [
    "✖ Diagram test failed", // TASK-67 negative control: passing vitest test logging a bare ✖ line
    "ℹ pass 5",
    "ℹ fail 0",
    "ℹ cancelled 0",
    "__PERFILE__ duration_ms=100 /home/yale/work/quay/packages/quay/test/foo.test.mjs passed=true", // passed=true is NOT a failure
    // gap-runner-perfile-pattern-unnchored-self-match-phantom-red AC3: the round-163 phantom-red —
    // a PASSING test whose NAME quotes the `__PERFILE__ ... passed=false` shape (the runner's own
    // e2e name) is `✔`-prefixed, so the ^-anchored + full-shape pattern must NOT flag it:
    "✔ AC2/AC3 e2e — a `__PERFILE__ duration_ms=336 /home/yale/work/quay/plugin/test/foo.test.mjs passed=false` per-file line flips red and carries the failed file in failures[] (336.35913ms)",
    // gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red AC3: the round-167 phantom-red —
    // the same family, `✔`-prefixed passing test NAME quoting the `tmux-leak-scan: FAIL` shape —
    // must NOT flag with the ^-anchored pattern:
    "✔ AC5 e2e — a `tmux-leak-scan: FAIL` residual line (candidate C) flips red with failures non-empty (leak is a real residual) (396.686255ms)",
    // ... and the OTHER newly-^ anchored shapes must equally resist a `✔`-prefixed passing NAME
    // quoting them (family #4/#5 prevention — the full-table audit, gap-tmux-leak-scan ... AC4):
    "✔ AC1 e2e — a `❯ test/foo.test.ts (3 tests | 1 failed)` vitest line flips red early (12ms)",
    "✔ AC2 e2e — a `Test Files 1 failed | 10 passed` summary line flips red (3.4ms)",
    "✔ AC3 e2e — a `FULL-SUITE-EXIT=1` marker flips red (2.1ms)",
    "# fail 0",
    "# cancelled 0",
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
    // gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC4: a PRIOR run's single-flight flock
    // blocked this test.sh → 0 test output → NO correctness conclusion → must be aborted, not failed.
    "another full suite holds .git/full-suite.lock — not starting (single-flight lock; waited 600s). Re-run when it finishes.",
    "single-flight lock; waited 600s",
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

// ── gap-full-suite-state-red-no-failure-detail-static-check-invisible: AC1-AC5 ─────────────────────
// When run_static_checks fails (task-contract-check ratchet growth / test-framework-policy /
// test-isolation violations / a ceiling breach), test.sh aborts under `set -e` BEFORE the node --test
// phase: the stream shows the checker's violation output and a non-zero exit, but NONE of the
// FAILURE_PATTERNS. The pre-fix runner labelled this reason=failed with failures=[] empty — the
// 20:48Z readability gap (state=red + reason=failed + failures=[] looks like an interrupted run, the
// real cause only in the log). These tests pin the fix: reason="static-check" + machine-readable
// counts + violations fill failures[].

test("AC2 unit — isStaticCheckFailureLine matches static-check failure markers, never a passing summary or a test-failure line", () => {
  // FAILURE markers (a PASSING run never emits them):
  for (const line of [
    "ratchet ceiling: 6; new since baseline: 6 (tasks/a.md: V1, tasks/b.md: V2)", // the 20:48Z 真因 — K>0 = growth
    "ratchet ceiling: 6; new since baseline: 1",
    "task-contract-check: current violations (11) exceed the ratchet ceiling (6) — the list can only get SHORTER",
    "task-contract-check: DOD-SUITE-LINE BASELINE CEILING BREACH — grandfather list can only get SHORTER",
    "test-framework-policy-check: FAIL: 2 violation(s):",
    "test-isolation-check: FAIL: 3 ratchet violation(s):",
  ]) {
    assert.equal(isStaticCheckFailureLine(line), true, `should flag static-check failure: ${line}`);
  }
  // Passing-run / test-failure lines must NOT flag:
  for (const line of [
    "violations: 0 unique across 0 task(s); info findings ...", // passing summary (N=0)
    "violations: 11 unique across 9 task(s); info findings ...", // violations listed but K=0 below — passing
    "ratchet ceiling: 6; new since baseline: 0; resolved: 0", // K=0 — no growth, passing
    "VIOLATION: tasks/baselined.md — V1: what", // baselined violation on a passing run
    "not ok 1 - boom", // test failure
    "# fail 2",
    "FULL-SUITE-EXIT=1",
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
    "FAIL: some legacy assertion message", // legacy harness console noise
  ]) {
    assert.equal(isStaticCheckFailureLine(line), false, `should NOT flag: ${line}`);
  }
});

test("AC2 unit — extractStaticCheckDetail parses the VIOLATION/summary/ratchet lines into machine-readable fields", () => {
  const v = extractStaticCheckDetail(
    "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line",
  );
  assert.deepEqual(v, {
    violation: {
      file: "tasks/gap-foo.md",
      code: "V1",
      what: "Contract block missing invariant line",
      line: "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line",
    },
  });
  const s = extractStaticCheckDetail("violations: 11 unique across 9 task(s); info findings ...");
  assert.equal(s.violations, 11);
  assert.equal(s.taskCount, 9);
  const r = extractStaticCheckDetail("ratchet ceiling: 6; new since baseline: 6 (tasks/a.md: V1)");
  assert.equal(r.ceiling, 6);
  assert.equal(r.newSinceBaseline, 6);
  assert.equal(extractStaticCheckDetail("not ok 1 - boom"), null);
  assert.equal(extractStaticCheckDetail("# tests 2239"), null);
});

test("AC2/AC3/AC4 — a static-check-red run writes reason=static-check + machine-readable counts; violations fill failures[]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-scre-"));
  // The 2026-08-08 20:48Z shape: task-contract-check ratchet violations — the suite aborts
  // (set -e) before tests, so the stream shows VIOLATION/summary/ratchet lines + exit 1, no TAP.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "VIOLATION: tasks/gap-bar.md — V2: band value out of range"\n' +
      'echo "violations: 11 unique across 9 task(s); info findings (non-ratchet, pre-opt-in baseline): 0 — see --json for details"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6 (tasks/gap-foo.md: V1, tasks/gap-bar.md: V2); resolved: 0"\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "static-check red is reason=static-check, NOT failed (AC3)");
    assert.ok(s.staticCheck, "machine-readable staticCheck field present (AC2)");
    assert.equal(s.staticCheck.violations, 11, "violation count (AC2)");
    assert.equal(s.staticCheck.taskCount, 9, "task count");
    assert.equal(s.staticCheck.ceiling, 6, "ratchet ceiling (AC2)");
    assert.equal(s.staticCheck.newSinceBaseline, 6, "new-since-baseline (AC2)");
    assert.ok(
      Array.isArray(s.staticCheck.details) && s.staticCheck.details.length === 2,
      "both VIOLATION details captured",
    );
    assert.equal(s.staticCheck.details[0].file, "tasks/gap-foo.md", "detail carries the violated task file");
    assert.ok(s.failures && s.failures.length === 2, "failures[] carries the static-check violation details (AC4 candidate B)");
    assert.equal(s.failures[0].staticCheck, true, "failures entries are marked static-check");
    assert.equal(s.failures[0].file, "tasks/gap-foo.md", "failure file = the violated task file");
    // Consumers can distinguish + route correctly (AC3):
    assert.equal(shouldStopDispatch(s), true, "static-check red stops dispatch (shared-gate failure)");
    assert.equal(routeRed(s), "red-window-triage", "routeRed routes static-check red to red-window-triage (a real failure)");
    const loc = classifyFailure(s.failures[0]);
    assert.equal(loc.kind, "shared-gate", "classifyFailure classifies the static-check failure as shared-gate");
    const res = runOnce(root);
    assert.equal(res.stopSignal, true, "runOnce reports stopSignal for static-check red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2b — the static-check phase gate: test-phase output (selected N files) stops static-check patterns firing on test fixtures (round-6 2026-08-09 false-red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pgate-"));
  // The round-6 false-red shape: a passing test (candidate-contracts.test.mjs) prints
  // "ANTI-DRIFT HARD FAIL: N violation(s)" fixture lines DURING its run — after test.sh's
  // "selected N files (groups=…)" test-phase marker, before any "# tests" summary. The static-check
  // patterns must NOT fire on those (the suite is genuinely green), but MUST still fire BEFORE the
  // test phase begins (covered by the AC2/AC3/AC4 test above, whose fake suite has no "selected").
  const { f, dir } = fakeSuite(
    'echo "selected 252 files (groups=product,engine)"\n' +
      'echo "ANTI-DRIFT HARD FAIL: 1 violation(s)"\n' +
      'echo "  cross-build-overlap: builds A & B both touched shared/s.js"\n' +
      'echo "# tests 42"\n' +
      'echo "# pass 42"\n' +
      'echo "# fail 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 (the suite is genuinely green — the ANTI-DRIFT lines are test fixtures)");
    const s = readState(root);
    assert.equal(s.state, "green", "no false static-check red once the test phase has started");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — both testsSeen summary forms (`# tests N` AND the reporter's `ℹ tests N`) arm the static-check phase gate on their own (round-6 regex root cause)", async () => {
  // Round-6 root cause (gap-static-check-false-positive-testsseen-regex-does-not-match-reporter-format):
  // the testsSeen parser only accepted the TAP `# tests N` form, but measure-suite-reporter emits the
  // info-glyph `ℹ tests N` — so testsSeen stayed 0 and the `testsSeen === 0` static-check guard was
  // INERT, letting STATIC_CHECK_FAILURE_PATTERNS fire on test-fixture output (candidate-contracts'
  // "ANTI-DRIFT HARD FAIL" lines). 42aad5fe accepts both prefixes; the Contract measure is
  // `tests_seen_after_test_phase > 0`. This test proves EACH summary form ALONE (no "selected N files"
  // marker) increments testsSeen ⇒ testPhaseStarted, so an ANTI-DRIFT fixture line printed after the
  // summary no longer false-triggers static-check red and the suite stays green.
  for (const summary of ['echo "# tests 5"', 'echo "ℹ tests 5"']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-glyph-"));
    const { f, dir } = fakeSuite(
      summary +
        '\necho "ANTI-DRIFT HARD FAIL: 1 violation(s)"\n' +
        'echo "  cross-build-overlap: builds A & B both touched shared/s.js"\n' +
        'echo "# pass 5"\n' +
        'echo "# fail 0"\n' +
        "exit 0",
    );
    try {
      const child = runRunner({ root, command: `bash ${f}` });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 (genuinely green) for summary form: ${summary.trim()}`);
      const s = readState(root);
      assert.equal(
        s.state,
        "green",
        `summary form ${summary.trim()} ⇒ testsSeen>0 ⇒ phase gate armed ⇒ ANTI-DRIFT fixture line does NOT false-red (AC2/AC3/AC4)`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("AC5 — a real test failure dominates a static-check marker: reason stays failed, failures[] carries the test failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sc-dom-"));
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: something"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6"\n' +
      'echo "not ok 1 - boom"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "a real test failure is reason=failed, never downgraded to static-check (AC5)");
    assert.ok(s.failures && s.failures.length >= 1, "failures[] carries failures");
    assert.equal(s.failures[0].staticCheck, undefined, "failures[] carries the REAL test failure (not a static-check entry)");
    assert.ok(s.staticCheck, "the staticCheck field is still recorded alongside (both facts present)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — routeRed/shouldStopDispatch distinguish static-check red (stops) from aborted/infra-error red (does not stop)", () => {
  assert.equal(routeRed({ state: "red", reason: "static-check" }), "red-window-triage", "static-check red → red-window-triage");
  assert.equal(shouldStopDispatch({ state: "red", reason: "static-check" }), true, "static-check red stops dispatch");
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true, "test-failure red stops dispatch (unchanged, AC5)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "aborted" }), false, "aborted red does NOT stop (unchanged)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "infra-error" }), false, "infra-error red does NOT stop (unchanged)");
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

// ── gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed: AC2/AC3/AC5 e2e ────────────────
// The round-149 defect (state=red reason=failed but failures=[] / redAt=null): the runner's
// FAILURE_PATTERNS missed the reporter's info-glyph / per-file failure forms. Each e2e below
// constructs the real reporter shape and asserts red + a non-empty failures[] (the AC3 "red with
// detail" property) — the measure `failures_nonempty_on_info_red >= 1` band.

test("AC2/AC3 e2e — an `ℹ fail 1` (info-glyph summary) suite flips red with a non-empty failures[] and a non-null redAt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-infofail-"));
  const { f, dir } = fakeSuite('echo "ℹ tests 1"\necho "ℹ pass 0"\necho "ℹ fail 1"\necho "ℹ cancelled 0"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "ℹ fail 1 flips state to red (AC2 — the reporter glyph form is recognized)");
    assert.equal(s.reason, "failed", "ℹ fail 1 is a REAL test failure (stop-dispatch signal)");
    assert.ok(s.failures && s.failures.length >= 1, `failures[] must be non-empty (measure failures_nonempty_on_info_red >= 1); got ${JSON.stringify(s.failures)}`);
    // redAt is carried on the verification-round record (the early-RED detection-latency axis) —
    // the round-149 record had redAt=null; a recognized failure line must timestamp it.
    const roundFile = path.join(root, ".quay", "verification-round.jsonl");
    const rounds = fs.existsSync(roundFile)
      ? fs.readFileSync(roundFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.ok(rounds.length >= 1, "a verification-round record is appended");
    assert.ok(rounds[rounds.length - 1].redAt, `redAt must have a value (round-149 had null); got ${rounds[rounds.length - 1].redAt}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-suite-round-record-missing-failures-field: AC2 (round record carries failures on red) ────────
// The round-210 attribution hole: verification-round.jsonl round records lacked a `failures` field
// (209 rounds measured without it), so the red-window reverse-lookup "failed file → task Touches"
// could only read the single-round full-suite-state.json. AC2: a RED round's record carries the SAME
// SuiteFailure array the suite-state write carries; a GREEN round's record omits it (绿轮可无).

test("AC2 — a RED run's verification-round record carries the failures[] array mirroring the suite-state (gap-suite-round-record-missing-failures-field)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-roundfail-"));
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"\necho "ℹ tests 1"\necho "ℹ pass 0"\necho "ℹ fail 1"\necho "ℹ cancelled 0"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "not ok 1 flips state to red");
    assert.ok(s.failures && s.failures.length >= 1, `suite-state carries failures[]; got ${JSON.stringify(s.failures)}`);
    const roundFile = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(roundFile), "verification-round.jsonl written");
    const rounds = fs.readFileSync(roundFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(rounds.length >= 1, "a verification-round record is appended");
    const rec = rounds[rounds.length - 1];
    assert.equal(rec.state, "red", "round record state is red");
    assert.ok("failures" in rec, "red round record carries the failures field (Contract: red_round_failures_recorded = 1)");
    assert.ok(Array.isArray(rec.failures), "red round record failures is an array");
    assert.equal(rec.failures.length, s.failures.length, "round-record failures mirror the suite-state failures (same array)");
    assert.equal(rec.failures[0].line, s.failures[0].line, "round-record failure line equals the state failure line");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — a GREEN run's verification-round record omits failures (绿轮可无; non-red fields byte-identical)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-roundgreen-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const roundFile = path.join(root, ".quay", "verification-round.jsonl");
    const rec = JSON.parse(fs.readFileSync(roundFile, "utf8").trim().split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.state, "green");
    assert.ok(!("failures" in rec), "green round record omits the failures field");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2/AC3 e2e — a `✖ <testname> (Nms)` spec-reporter failure line flips red with failures non-empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-specx-"));
  const { f, dir } = fakeSuite(
    'echo "✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0) (3.411515ms)"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "✖ <name> (Nms) flips state to red (AC2)");
    assert.equal(s.reason, "failed");
    assert.ok(s.failures && s.failures.length >= 1, `failures[] carries the spec-reporter failure (AC3); got ${JSON.stringify(s.failures)}`);
    assert.match(s.failures[0].line, /✖ AC1\/AC2 — the real bundle inventory/, "the failure line records the failing test name");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC2/AC3 ─────────────────────────────────
// The runner previously waited for a HUNG suite child forever (round-164 leaked 20+ min holding the
// single-flight flock). The max-runtime / silence / red-grace guards kill the child TREE and produce
// reason=timeout / reason=hung / a prompt red exit. Tests use the env seams to make the guards fire fast.

test("AC3 e2e — a HANGING suite is killed at the max-runtime seam (reason=timeout, no indefinite leak)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-timeout-"));
  const { f, dir } = fakeSuite('sleep 30'); // hangs far beyond the 800ms seam
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_SUITE_MAX_RUNTIME_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "a max-runtime kill is a red (no correctness conclusion)");
    assert.equal(s.reason, "timeout", `max-runtime kill must be reason=timeout, got ${s.reason}`);
    assert.ok(code !== 0, "runner exits non-zero on a timeout kill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 e2e — a SILENT suite is killed at the silence seam (reason=hung)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-hung-"));
  const { f, dir } = fakeSuite('echo "start"; sleep 30'); // one line, then silence far beyond the seam
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_SUITE_SILENCE_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "a silence kill is a red (no correctness conclusion)");
    assert.equal(s.reason, "hung", `silence kill must be reason=hung, got ${s.reason}`);
    assert.ok(code !== 0, "runner exits non-zero on a hung kill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — a RED suite whose test.sh hangs is killed after the red-grace seam (prompt exit, red conclusion stands)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-killonred-"));
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"; sleep 30'); // red detected, then hangs
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "the red conclusion stands");
    assert.equal(s.reason, "failed", `a REAL failure (not ok) is never downgraded to timeout/hung: got ${s.reason}`);
    assert.ok(s.failures && s.failures.length >= 1, `the not-ok failure must be recorded; got ${JSON.stringify(s.failures)}`);
    assert.ok(code !== 0, "runner exits non-zero on the red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — a RED suite STILL PRODUCING OUTPUT is NOT killed on red-grace; it runs to completion (report-all-failures, manager 2026-08-10 15:1x)", async () => {
  // round-95 AC3 principle: phases run EVEN IF a later phase fails. The runner's kill-on-red must
  // only kill a HUNG child (silent for RED_GRACE_MS), not one still emitting results — otherwise a
  // serial/lowconc red (which runs FIRST per test.sh phase order) kills the whole tree before the
  // main phase (281 files, 89%) ever runs. This fake suite reds early, then keeps producing output
  // (simulating main still running) and exits on its own — the runner must NOT escalate the kill.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-stillprod-"));
  const { f, dir } = fakeSuite(
    'echo "not ok 1 - boom"; for i in $(seq 1 30); do echo "line $i - still running"; sleep 0.1; done; exit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "the red conclusion stands");
    assert.equal(s.reason, "failed", `a real failure is never downgraded to timeout/hung: got ${s.reason}`);
    assert.ok(s.failures && s.failures.length >= 1, `the not-ok failure must be recorded; got ${JSON.stringify(s.failures)}`);
    // The suite ran its full body (all 30 'still running' lines) and exited itself — the runner did
    // NOT kill it at the red-grace seam (a kill would cut the output short).
    assert.ok(code !== 0, "runner exits non-zero on the red");
    // Assert the suite body completed: the last 'still running' line reached the log (not killed mid-way).
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    assert.match(log, /line 30 - still running/, "the suite's final line must appear — NOT killed at red-grace");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — MULTIPLE failure lines each push into failures[] (manager 2026-08-10 15:2x: structurally capped at 1 before; now every failure records)", async () => {
  // r240 TAP reported fail=7 but failures[] held only the FIRST failure's name — the push sat inside
  // the !redDetected guard that flips true on line 1. This fake suite emits THREE not-ok lines; all
  // three must be recorded (capped at MAX_RECORDED_FAILURES only for pathological rounds).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-multifail-"));
  const { f, dir } = fakeSuite(
    'echo "not ok 1 - alpha"; echo "not ok 2 - beta"; echo "not ok 3 - gamma"; exit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed");
    assert.ok(s.failures.length >= 3, `all 3 failure lines must be recorded; got ${JSON.stringify(s.failures)}`);
    const names = s.failures.map((x) => x.line).join(" ");
    assert.match(names, /alpha/, "first failure recorded");
    assert.match(names, /beta/, "second failure recorded (was dropped by the !redDetected cap)");
    assert.match(names, /gamma/, "third failure recorded");
    assert.ok(code !== 0, "runner exits non-zero on the red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2/AC3 e2e — a `__PERFILE__ ... passed=false` per-file line flips red and carries the failed file in failures[]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pf-"));
  const { f, dir } = fakeSuite(
    'echo "__PERFILE__ duration_ms=3580.991183 packages/quay/test/verify-delivery-surface.test.mjs passed=false"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "__PERFILE__ passed=false flips state to red (AC2)");
    assert.equal(s.reason, "failed");
    assert.ok(s.failures && s.failures.length >= 1, `failures[] carries the per-file failure (AC3); got ${JSON.stringify(s.failures)}`);
    assert.equal(
      s.failures[0].file,
      "packages/quay/test/verify-delivery-surface.test.mjs",
      "the per-file line's path is the failure's file (AC3 — red with detail, no more failures=[])",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 e2e — a `tmux-leak-scan: FAIL` residual line (candidate C) flips red with failures non-empty (leak is a real residual)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-leak-"));
  // Candidate C merge semantics: the suite-tail leak scan reports a residual to the stream
  // (unconditional, no `&&` short-circuit in test.sh); the runner must recognize that FAIL line
  // as a REAL failure (not swallow it into the failures=[] catch-all).
  const { f, dir } = fakeSuite(
    'echo "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot; prefixes: skv-|session-liveness-|ol-tok-|enter-repro-):" >&2\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "tmux-leak-scan FAIL flips state to red (candidate C — leak is a real residual)");
    assert.equal(s.reason, "failed");
    assert.ok(s.failures && s.failures.length >= 1, `failures[] carries the leak-scan residual (AC5); got ${JSON.stringify(s.failures)}`);
    assert.match(s.failures[0].line, /tmux-leak-scan: FAIL/, "the leak-scan FAIL line is the recorded failure");
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

// ── gap-full-suite-state-red-no-failure-detail-static-check-invisible Contract invoke ───────────────
// --static-check-check is the STATIC-CHECK-side twin of --fail-fast-check (test-failure chain) and
// --wait-check (abort chain): it proves the 20:48Z shape (task-contract-check ratchet violations ⇒
// the suite aborts before tests with violations=N / ceiling=C / newSinceBaseline=K in the log) now
// lands in the state file as machine-readable fields consumers read WITHOUT hand-digging the log.

test("AC2 Contract invoke — `full-suite-runner.ts --static-check-check` proves: static-check violations => red reason=static-check => machine-readable counts + failures[] => stopSignal", async () => {
  const { code, out, err } = await runCli(RUNNER, ["--static-check-check"]);
  assert.equal(code, 0, `--static-check-check exits 0 when the static-check chain works; got ${code}\n${out}\n${err}`);
  assert.match(out, /static-check-check OK/, "verification line present");
  assert.match(out, /reason=static-check/, "reason is static-check (AC3, distinguishable from failed)");
  assert.match(out, /violations=11/, "violation count recorded (AC2)");
  assert.match(out, /ceiling=6/, "ceiling recorded (AC2)");
  assert.match(out, /newSinceBaseline=6/, "new-since-baseline recorded (AC2)");
  assert.match(out, /failures=2/, "failures[] carries the two violation details (AC4 candidate B)");
  assert.match(out, /stopSignal=true/, "static-check red stops dispatch (shared-gate failure)");
});

// ── gap-worktree-scoped-runs-consume-resources-but-produce-no-signal: AC1 scope + AC2 priority ──────

test("AC1 unit — isGitWorktree distinguishes the main repo (false) from a linked worktree (true)", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wtrepo-u-"));
  const worktree = path.join(os.tmpdir(), `fsr-wt-u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    assert.equal(isGitWorktree(repo), false, "the primary checkout is NOT a worktree");
    assert.equal(isGitWorktree(path.join(repo, "does-not-exist")), false, "a non-git dir is NOT a worktree");
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });
    assert.equal(isGitWorktree(worktree), true, "a linked worktree IS a worktree");
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("AC1 — a real git-worktree run writes scope=worktree to its OWN .quay/full-suite-state.json (the observable signal)", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wtrepo-"));
  const worktree = path.join(os.tmpdir(), `fsr-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });

    const child = runRunner({ root: worktree, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green in a worktree, got ${code}`);
    const s = readState(worktree);
    assert.ok(s, "the worktree's own state file is written (AC1 signal — waiters can read it)");
    assert.equal(s.scope, "worktree", "scope tags the worktree-origin suite (deferrable, not the main signal)");
    assert.equal(s.state, "green");
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — for a MAIN-scope root the runner passes --main-repo-priority: the gate lets the main-repo suite proceed over worktree load (cpu=70 would normally WAIT)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2p-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    // cpu=70 is above the base limit (60) ⇒ WAIT normally. caller_scope=main + worktree_node_tests=6
    // ⇒ the AC2 priority override fires ONLY IF the runner passed --main-repo-priority (it does for a
    // non-worktree root). If the flag were absent the gate would WAIT and the suite would never spawn.
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "70",
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
        RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `AC2 priority: main-repo suite proceeds over worktree load; got ${code}`);
    assert.equal(readState(root).state, "green");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned (priority override let it through)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 negative control — a WORKTREE-scope caller is NOT let through the WAIT even when the runner passes the flag (worktree full-suite is deferrable)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2n-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    // Same seams but caller_scope=worktree ⇒ the override requires caller_scope=main ⇒ WAIT stands.
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "70",
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_CALLER_SCOPE: "worktree",
        RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      },
    });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "worktree-scope caller stays WAIT (deferrable — no priority override)");
    assert.ok(!fs.existsSync(argsLog), "the suite was NOT spawned (worktree full-suite yields to the machine)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── GENERATION GUARD (gap-full-suite-state-race-last-write-wins-no-generation-guard) ───────────────
// writeState() was last-write-wins with NO generation check: if two runners overlap briefly (even a
// superseded runner still finishing its cleanup), the older runner's red terminal state could land
// AFTER the newer runner's running write and silently clobber it — the 2026-08-06 06:27 v5 / 06:28 v6
// double-launch incident (stale red from the prior runner overwrote the current running state). The
// fix: every state write carries a per-run `runId`; the initial `running` write ESTABLISHES the
// generation, every later write is GUARDED and dropped if a different run now owns the file. These
// tests construct the race (AC1), prove the read side can distinguish the current round (AC2), and
// prove a single runner's normal writes are unaffected (AC4, negative control).

test("AC1 unit — the generation guard rejects a stale runner's write (stale runId ≠ current runId)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-guard-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  const mk = (state, runId, extra = {}) => ({
    state,
    runId,
    runner: "outer",
    startedAt: iso(),
    finishedAt: null,
    durationMs: null,
    laneCount: 4,
    scope: "main",
    ...extra,
  });
  try {
    // Runner A establishes the generation (its running write).
    fs.writeFileSync(file, JSON.stringify(mk("running", "run-A"), null, 2) + "\n", "utf8");
    // Runner B takes over (its running write is the NEW generation).
    fs.writeFileSync(file, JSON.stringify(mk("running", "run-B"), null, 2) + "\n", "utf8");
    // A's stale terminal write is REFUSED — it must not clobber B's current state.
    writeStateGuarded(file, { ...mk("red", "run-A", { reason: "failed" }) });
    let cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "running", "stale red did NOT overwrite the current running state (AC1)");
    assert.equal(cur.runId, "run-B", "the state still belongs to B's generation");
    // B's own terminal write SUCCEEDS — its generation is still current.
    writeStateGuarded(file, { ...mk("green", "run-B", { finishedAt: iso(), durationMs: 1 }) });
    cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "green", "the current runner's write lands");
    assert.equal(cur.runId, "run-B");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — real two-runner race: a stale runner finishing red does NOT overwrite the newer runner's green", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-race-"));
  const staleStarted = path.join(root, "stale-started");
  // Runner A is the one that will be SUPERSEDED: it runs a slow suite that turns red at the end.
  const { f: staleF, dir: staleDir } = fakeSuite(
    `touch "${staleStarted}"; sleep 3; echo "not ok 1 - stale red (superseded runner)"; exit 1`,
  );
  // Runner B is the CURRENT runner: a fast green suite.
  const { f: freshF, dir: freshDir } = fakeSuite(GREEN_SUITE);
  try {
    // A starts first and establishes the generation.
    const childA = runRunner({ root, command: `bash ${staleF}`, laneCount: 4 });
    await poll(() => fs.existsSync(staleStarted), { timeoutMs: 8000 });
    await poll(() => readState(root)?.state === "running", { timeoutMs: 8000 });
    const runIdA = readState(root).runId;
    assert.ok(runIdA, "runner A's running state carries a runId");

    // B starts LATER and takes over (its running write is the new generation).
    const childB = runRunner({ root, command: `bash ${freshF}`, laneCount: 4 });
    const { code: codeB } = await waitExit(childB);
    assert.equal(codeB, 0, "the fresh runner exits 0 (green)");
    const afterB = readState(root);
    assert.equal(afterB.state, "green", "B's green is the current state");
    assert.ok(afterB.runId && afterB.runId !== runIdA, "B is a NEW generation (different runId)");
    const runIdB = afterB.runId;

    // A finishes RED — its stale red write must be dropped by the guard.
    const { code: codeA } = await waitExit(childA);
    assert.equal(codeA, 1, "the stale runner exits 1 (its suite was red)");

    const finalState = readState(root);
    assert.equal(finalState.state, "green", "the stale red did NOT overwrite the newer runner's green (AC1 two-runner race)");
    assert.equal(finalState.runId, runIdB, "the state still belongs to B's generation");
    assert.notEqual(finalState.runId, runIdA, "A's stale runId is gone from the state");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(staleDir, { recursive: true, force: true });
    fs.rmSync(freshDir, { recursive: true, force: true });
  }
});

test("AC2 — the read side can tell 'is this red/green the current round' by its runId", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  const mk = (state, runId, extra = {}) => ({
    state,
    runId,
    runner: "outer",
    startedAt: iso(),
    finishedAt: null,
    durationMs: null,
    laneCount: 4,
    scope: "main",
    ...extra,
  });
  try {
    // The CURRENT round is round-B (the newest runner established it).
    fs.writeFileSync(file, JSON.stringify(mk("running", "round-B"), null, 2) + "\n", "utf8");
    // A stale runner (round-A) attempts its red — the guard drops it.
    writeStateGuarded(file, { ...mk("red", "round-A", { reason: "failed" }) });
    // A reader can verify the state on disk is CURRENT: its runId == the round it is waiting on.
    const waitingOnRound = "round-B"; // what the dispatch site observed at round start
    assert.equal(
      readStateRunId(file),
      waitingOnRound,
      "the state on disk carries the CURRENT round's runId — a reader can distinguish current vs stale (AC2)",
    );
    assert.notEqual(readStateRunId(file), "round-A", "the stale round's write never landed");
    // The current round's own terminal write still lands and reads back as the current round.
    writeStateGuarded(file, { ...mk("green", "round-B", { finishedAt: iso(), durationMs: 1 }) });
    assert.equal(readStateRunId(file), "round-B");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).state, "green");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — negative control: a single runner's normal writes are unaffected by the guard", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac4-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "single runner still exits 0 on green");
    const s = readState(root);
    assert.equal(s.state, "green", "single-runner terminal write lands normally (AC4)");
    const runId = s.runId;
    assert.ok(runId, "runId present on the single-runner state");
    // read-side consistency: the state's runId matches the current round (nothing was rejected)
    assert.equal(readStateRunId(statePath(root)), runId, "read-side sees the same single generation");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — a write over a legacy state (no runId on disk) is NOT blocked (fail-open, no conflict)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac4l-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  try {
    // legacy state written before the generation guard existed: no runId field.
    fs.writeFileSync(
      file,
      JSON.stringify(
        { state: "green", runner: "outer", startedAt: iso(), finishedAt: iso(), durationMs: 1, laneCount: 8, scope: "main" },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    // A new run's terminal write is not blocked — a legacy file has no generation to protect.
    writeStateGuarded(file, {
      state: "red",
      reason: "failed",
      runId: "run-1",
      runner: "outer",
      startedAt: iso(),
      finishedAt: iso(),
      durationMs: 1,
      laneCount: 4,
      scope: "main",
    });
    const cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "red", "a run writing over a legacy state is not blocked (fail-open, AC4)");
    assert.equal(cur.runId, "run-1", "the new run's generation is established");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-systemd-run-limits-for-suite-and-heavy-ops: AC1-AC6 ────────────────────────────────────────
// The suite + heavy ops run WITHOUT cgroup limits today: a PID explosion (tmux leak, 217 procs) or a
// memory blowout (ugrep 8.8GB regex catastrophe) can take down the WHOLE MACHINE. The resource gate
// was bypassed (ABORT #5) because "a limit that only works when someone remembers to call it is no
// limit at all" (SPEC-isolation-and-resource-governance-2026-08-05.md §2). This task wraps the suite
// in a systemd-run --user --scope cgroup scope (MemoryMax/CPUQuota/TasksMax) — kernel-enforced,
// impossible to "forget to call", and bounded to ONE process group (the negative controls AC2/AC3
// prove the rest of the machine is untouched).

/** Spawn an arbitrary command, collect stdout/stderr, resolve on exit. */
function spawnCmd(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, out, err }));
  });
}

/** Machine-wide process count (the "other processes unaffected" baseline). */
function machineProcCount() {
  return Number(execSync("ps -e --no-headers | wc -l", { encoding: "utf8" }).trim());
}

/** Machine available memory in MB (the "no whole-machine swap" baseline). */
function memAvailMb() {
  return Number(execSync("free -m | awk 'NR==2{print $7}'", { encoding: "utf8" }).trim());
}

test("AC1 unit — buildSystemdRunArgv wraps a command in systemd-run --user --scope with the exact limit properties", () => {
  const argv = buildSystemdRunArgv("bash scripts/test.sh", DEFAULT_SYSTEMD_RUN_LIMITS);
  assert.deepEqual(argv, [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
    "-p",
    "MemoryMax=4G",
    "-p",
    "CPUQuota=200%",
    "-p",
    "TasksMax=200",
    "bash",
    "-c",
    "bash scripts/test.sh",
  ]);
  // a custom limit set flows through
  const custom = buildSystemdRunArgv("true", { memoryMax: "64M", cpuQuota: "100%", tasksMax: "20" });
  assert.ok(custom.includes("-p") && custom.includes("MemoryMax=64M"));
  assert.ok(custom.includes("CPUQuota=100%") && custom.includes("TasksMax=20"));
});

test("AC1 unit — parseSystemdRunLimits merges a seam override over the defaults; unknown keys fall back", () => {
  const l = parseSystemdRunLimits("MemoryMax=64M TasksMax=20");
  assert.equal(l.memoryMax, "64M");
  assert.equal(l.tasksMax, "20");
  assert.equal(l.cpuQuota, "200%", "an unchanged key keeps the default");
  assert.deepEqual(parseSystemdRunLimits(undefined), DEFAULT_SYSTEMD_RUN_LIMITS);
  // an unknown key is ignored (fail-safe — never produce an unparseable scope property)
  assert.deepEqual(parseSystemdRunLimits("MemoryMax=64M Bogus=1"), { ...DEFAULT_SYSTEMD_RUN_LIMITS, memoryMax: "64M" });
});

test(
  "AC1 — the runner wraps the suite in a systemd-run cgroup scope; the applied limits are visible as durable evidence (real systemd)",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sd1-"));
    // The suite must outlive the evidence capture (the scope is queryable only while it runs).
    const { f, dir } = fakeSuite(
      'echo "# tests 3"\nsleep 3\necho "# pass 3"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
    );
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        laneCount: 2,
        env: { QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "0" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 on green inside the cgroup scope, got ${code}`);
      const s = readState(root);
      assert.equal(s.state, "green");
      assert.ok(s.systemdRun, "the state carries the systemdRun limits (suite ran inside a cgroup scope)");
      assert.equal(s.systemdRun.memoryMax, "4G");
      assert.equal(s.systemdRun.cpuQuota, "200%");
      assert.equal(s.systemdRun.tasksMax, "200");
      // AC1 observable — the applied cgroup attributes (systemctl --user show) land in the state dir
      const evidence = path.join(root, ".quay", "suite-cgroup-evidence.txt");
      await poll(() => fs.existsSync(evidence), { timeoutMs: 10_000 });
      const txt = fs.readFileSync(evidence, "utf8");
      assert.match(txt, /scope_unit=run-p\d+-/, "the transient scope unit name is recorded");
      assert.match(txt, /MemoryMax=4294967296/, "MemoryMax=4G applied (bytes)");
      assert.match(txt, /EffectiveTasksMax=200/, "TasksMax=200 applied (effective)");
      assert.match(txt, /CPUQuotaPerSecUSec=2s/, "CPUQuota=200% applied");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "AC2 — negative control: TasksMax blocks a PID blowout (simulated tmux leak) inside the scope; the rest of the machine is untouched",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const before = machineProcCount();
    // Simulate the tmux leak: fork long-lived children until the cgroup's TasksMax blocks us.
    // Python's os.fork() surfaces EAGAIN directly (bash retries and obscures the count).
    const py = `
import os, time, sys
children = []
count = 0
for i in range(200):
    try:
        pid = os.fork()
        if pid == 0:
            time.sleep(60)
            os._exit(0)
        children.append(pid)
        count += 1
    except OSError as e:
        sys.stderr.write('fork blocked at i=%d: %s\\n' % (i, e))
        break
sys.stdout.write('successful_forks=%d\\n' % count)
sys.stdout.flush()
for pid in children:
    try: os.kill(pid, 9)
    except OSError: pass
`;
    const { code, out, err } = await spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet", "-p", "TasksMax=20", "python3", "-c", py,
    ]);
    const m = /successful_forks=(\d+)/.exec(out);
    assert.ok(m, `the scope reported its fork count (got stdout: ${out} stderr: ${err})`);
    const spawned = Number(m[1]);
    assert.ok(spawned < 200, `the PID blowout was blocked — not all 200 forked (got ${spawned})`);
    assert.ok(spawned <= 20, `TasksMax=20 bounded the concurrent process count (got ${spawned})`);
    assert.match(err, /fork blocked at i=/, "the cgroup TasksMax produced a fork EAGAIN (Resource temporarily unavailable)");
    const after = machineProcCount();
    assert.ok(after - before < 100, `other processes unaffected: machine proc count before=${before} after=${after} (blowout did NOT add ~200)`);
    // the negative control's other half: a fresh fork OUTSIDE the scope still works
    const { code: ctl } = await spawnCmd(["python3", "-c", "import os; p=os.fork(); (os._exit(0) if p==0 else os.waitpid(p,0)); print('outside-fork-ok')"]);
    assert.equal(ctl, 0, "a process outside the scope still forks normally");
    assert.equal(code, 0, "the scoped script itself exits 0 (it cleaned up; the BLOCK happened inside the cgroup)");
  },
);

test(
  "AC3 — negative control: MemoryMax OOM-kills a single memory hog (simulated ugrep catastrophe); no whole-machine swap",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const freeBefore = memAvailMb();
    // Simulate the ugrep 8.8GB regex-backtracking blowout: allocate committed memory until the
    // cgroup's MemoryMax kills the process. MemorySwapMax=0 prevents the scope from escaping into
    // swap (the whole-machine swap collapse is exactly what AC3 must prove does NOT happen).
    const py = `
bufs = []
for i in range(4000):
    bufs.append(bytearray(1024 * 1024))
print('SURVIVED all allocations', flush=True)
`;
    const { code, out, err } = await spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet",
      "-p", "MemoryMax=64M", "-p", "MemorySwapMax=0", "python3", "-c", py,
    ]);
    const freeAfter = memAvailMb();
    assert.ok(!out.includes("SURVIVED"), `the memory hog was killed before completing (got: ${out}${err})`);
    assert.notEqual(code, 0, `the scoped hog exited non-zero (killed by the cgroup), got ${code}`);
    assert.ok(
      freeAfter >= freeBefore - 2048,
      `no whole-machine swap collapse — machine available memory before=${freeBefore}MB after=${freeAfter}MB`,
    );
  },
);

test(
  "AC4 — the cgroup scope is a process boundary, not a comm-channel change: the suite's stdout/stderr still stream to the same log (file delivery unchanged)",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sd4-"));
    const { f, dir } = fakeSuite('echo "comm-channel-marker"\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0');
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        env: { QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "0" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `suite exits 0 under the cgroup scope, got ${code}`);
      // the suite's output reached the SAME full-suite.log the un-limited path writes — the
      // observation/file-delivery channel is unchanged (only the child's cgroup boundary moved).
      const log = read(path.join(root, ".quay", "full-suite.log"));
      assert.match(log, /comm-channel-marker/, "the suite's stdout still reaches the shared log under the cgroup scope");
      assert.equal(readState(root).state, "green");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("AC5 — cross-annotation: the SPEC + no-resource-awareness task reference THIS task, and this task references both", () => {
  const spec = read(path.join(REPO_ROOT, "orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md"));
  assert.match(
    spec,
    /gap-systemd-run-limits-for-suite-and-heavy-ops/,
    "the SPEC must name this task as the concrete systemd-run limits integration (AC5)",
  );
  const noRes = read(path.join(REPO_ROOT, "tasks/gap-no-resource-awareness-heavy-ops-run-blind.md"));
  assert.match(
    noRes,
    /gap-systemd-run-limits-for-suite-and-heavy-ops/,
    "gap-no-resource-awareness-heavy-ops-run-blind must cross-annotate this task (AC5)",
  );
  const self = read(path.join(REPO_ROOT, "tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md"));
  assert.match(self, /gap-no-resource-awareness-heavy-ops-run-blind/, "this task cross-annotates the no-resource-awareness task");
  assert.match(self, /SPEC-isolation-and-resource-governance-2026-08-05/, "this task cross-annotates the SPEC");
});

test(
  "AC6 — cross-project isolation: a suite inside its own cgroup scope completes while another scope burns CPU (the machine-wide gate would WAIT)",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    // Scope A = "another project" (e.g. archguard) burning a core inside its OWN cgroup quota.
    // Scope B = the quay suite inside its own cgroup quota. The machine-wide resource gate reads
    // /proc/pressure/cpu without project boundaries — under A's load it would say WAIT — but B does
    // not need the whole machine: it runs inside its own scope. This is the SPEC §4 cross-project
    // isolation claim, exercised for real with two concurrent scopes.
    const burner = spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet", "-p", "CPUQuota=100%",
      "timeout", "3", "bash", "-c", "while :; do :; done",
    ]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sd6-"));
    const { f, dir } = fakeSuite('echo "# tests 3"\necho "# pass 3"\necho "# fail 0"\necho "# cancelled 0"\nexit 0');
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        env: { QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "0" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `the suite completes inside its own cgroup scope despite the other-scope CPU burner, got ${code}`);
      const s = readState(root);
      assert.equal(s.state, "green");
      assert.ok(s.systemdRun, "the suite ran in its own cgroup scope (isolation), not the burner's");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
      await burner; // let the CPU burner finish its 3s budget
    }
  },
);

// ── AC6: runner-died terminal state (gap-full-suite-state-red-no-failure-detail-static-check-invisible) ──

test("AC6 — every state write carries the runner PID (the crash-watchdog's liveness anchor)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pid-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const s = readState(root);
    assert.equal(s.state, "green");
    assert.equal(typeof s.pid, "number", "the state carries the runner PID (AC6)");
    assert.ok(Number.isInteger(s.pid) && s.pid > 0, "pid is a positive integer");
    assert.equal(s.pid, child.pid, "pid is the RUNNER process's pid — the watchdog's liveness anchor");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6 — a runner that dies mid-run from an uncaughtException writes state=red reason=crashed (never stuck at running)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-crash-"));
  // The fake suite BLOCKS (sleep 3) so the child CANNOT close before the crash seam fires — a fast
  // suite would let the runner reach its green verdict and remove the crash handlers first (the
  // flake: under load the child's close raced the 30ms seam and the runner exited 0/green).
  const { f, dir } = fakeSuite('echo "running"; sleep 3; exit 0');
  try {
    // QUAY_TEST_CRASH_AFTER_RUNNING is a hermetic test seam: it throws an uncaught exception ~30ms
    // after the `running` write, exercising the AC6 in-process crash-terminal path deterministically.
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      env: { QUAY_TEST_CRASH_AFTER_RUNNING: "1" },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "a crashed runner exits 1");
    const s = readState(root);
    assert.equal(s.state, "red", "the runner died -> the state is terminal red, NOT running (AC6)");
    assert.equal(s.reason, "crashed", "the terminal reason is crashed (AC6) — distinguishable from aborted/failed");
    assert.equal(typeof s.pid, "number", "the crashed state still carries the runner pid");
    assert.ok(s.finishedAt !== null && s.finishedAt !== undefined, "crashed state has a finishedAt (terminal, not early)");
    assert.equal(typeof s.durationMs, "number", "crashed state has a durationMs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6 — routeRed/shouldStopDispatch treat crashed like aborted (no code-risk stop) but keep the reason distinguishable", () => {
  // crashed = the runner died mid-run without a correctness conclusion — same no-stop family as
  // aborted/infra-error, but the reason value stays distinct so a consumer can tell "deliberately
  // stopped" from "died silently (re-launch the suite)".
  assert.equal(routeRed({ state: "red", reason: "crashed" }), "resource-gate", "crashed red → resource-gate (NOT a code-failure conclusion)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "crashed" }), false, "crashed red does NOT stop dispatch (no correctness conclusion)");
  assert.notEqual("crashed", "aborted", "crashed is a DISTINCT reason value from aborted (consumer can distinguish)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true, "test-failure red still stops (unchanged, AC5)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "static-check" }), true, "static-check red still stops (unchanged, AC3)");
});
