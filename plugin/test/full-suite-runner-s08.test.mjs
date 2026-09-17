// @test-group lowconc
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-27 child-spawn (spawns real full-suite-runner.ts + fake-suite child; triage 判 other-task defer 而非 isolate-rerun — gap-full-suite-runner-test-poll-timeout-load-flake)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — every test spawns a
//   real node runner (full-suite-runner.ts) + a real bash fake-suite child; under full-suite concurrency
//   the runner bootstrap + child spawn is start/schedule-delayed and the wall-clock polls flaked
//   (gap-full-suite-runner-test-poll-timeout-load-flake: "poll timeout" under load 11.81 / 16 lanes).
//   The 5s polls were already raised to 20s (gap-suite-load-sampler-orphan-process); this annotation
//   closes the triage half — a failure must be classified load-sensitive (isolate-rerun), not
//   other-task (defer anti-livelock).

// full-suite-runner.test.mjs — runner verdict / state machine / red detection / reason axis / kill-hang / control. Split from gap-suite-file-split-two-longest; harness shared via ./helpers/full-suite-runner-harness.mjs.
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 8/8 (10 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { GREEN_SUITE, REPO_ROOT, RUNNER, SUITE_NOT_RUN, SUITE_RUN_START, after, assert, fakeSuite, fakeTestShRecordingArgs, fs, lastRoundRecord, os, path, read, readState, releaseGate, runCli, runRunner, sharedGreenShape, spawn, statePath, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

test("AC6 — every state write carries the runner PID (the crash-watchdog's liveness anchor)", async () => {
  // gap-shape-assert-share-round: shares ONE runner round with the state-shape / green-log /
  // generation-guard shape tests (4 spawns → 1). It asserts only the pid field (and pid === the
  // shared round's runner child), so the shared green round satisfies it identically.
  const { s, child } = await sharedGreenShape();
  assert.equal(s.state, "green");
  assert.equal(typeof s.pid, "number", "the state carries the runner PID (AC6)");
  assert.ok(Number.isInteger(s.pid) && s.pid > 0, "pid is a positive integer");
  assert.equal(s.pid, child.pid, "pid is the RUNNER process's pid — the watchdog's liveness anchor");
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
    // gap-full-suite-runner-crash-test-rmSync-enotempty-flaky — the runner spawns a DETACHED
    // suite-load-sampler that writes <root>/.quay/suite-load-<runId>.jsonl.pid at startup and is never
    // reaped on the crash path (process.exit). Under load the sampler's delayed .pid write lands
    // DURING this teardown rmSync — it mkdirs `.quay` back into `root` after rmSync already rmdir'd it,
    // so `rmdir(root)` fails ENOTEMPTY. (A detached child's cwd does NOT block rmdir; the cause is the
    // .pid write, not the orphan suite child — leftover evidence: /tmp/fsr-crash-* each hold exactly
    // one suite-load-*.jsonl.pid.) maxRetries/retryDelay re-list and delete the recreated `.quay` + .pid;
    // the sampler exits on its first state check (state=red), so the .pid write is one-shot.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});



test("gap-test-detail-load-timeseries — the runner spawns a load sampler that writes a per-run timeseries and stops when the suite ends", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-"));
  // gap-fake-suite-release-gate-sleep-zero — the fixed 1.5s sampler window is a release gate: the
  // suite blocks until the test has observed the sampler's first sample, then the test releases it.
  const gate = releaseGate(root, "loadsampler");
  const { f, dir } = fakeSuite(
    gate.wait +
      '\n' +
      'echo "# tests 1"\n' +
      'echo "# pass 1"\n' +
      'echo "# fail 0"\n' +
      'echo "# cancelled 0"\n' +
      "exit 0",
  );
  const loadDir = path.join(root, ".quay");
  const loadFiles = () => {
    try {
      return fs.readdirSync(loadDir).filter((n) => n.startsWith("suite-load-") && n.endsWith(".jsonl"));
    } catch {
      return [];
    }
  };
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2, env: { QUAY_SUITE_LOAD_SAMPLER_INTERVAL: "0.2" } });

    // Wait (bounded) for the sampler to write its first sample while the run is in flight.
    let name = null;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const files = loadFiles();
      if (files.length > 0) {
        name = files[0];
        lines = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean);
        if (lines.length >= 1) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(name, "the sampler wrote .quay/suite-load-<runId>.jsonl during the run");
    assert.ok(lines.length >= 1, `the timeseries has >=1 sample (got ${lines.length})`);

    for (const line of lines) {
      const o = JSON.parse(line);
      assert.equal(typeof o.t, "number", "every sample carries a numeric timestamp");
      assert.ok("loadavg" in o, "every sample carries loadavg");
      assert.ok("cpu_stall" in o, "every sample carries cpu_stall");
      assert.ok("mem_avail" in o, "every sample carries mem_avail");
    }

    // The file is keyed by the runner's runId (read from the state the runner wrote).
    const s = readState(root);
    assert.ok(s && typeof s.runId === "string" && s.runId, "state carries the run's runId");
    assert.equal(name, `suite-load-${s.runId}.jsonl`, "timeseries file name = suite-load-<runId>.jsonl");

    // Suite ends → the runner writes a terminal state → the detached sampler stops (never resident).
    fs.writeFileSync(gate.release, "go", "utf8"); // release — the sampler has already logged its first sample
    await waitExit(child);
    const pidFile = path.join(loadDir, `${name}.pid`);
    assert.ok(fs.existsSync(pidFile), "sampler wrote its pid sidecar");
    const samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    assert.ok(Number.isInteger(samplerPid) && samplerPid > 0, "pid sidecar holds a real pid");

    let gone = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try {
        process.kill(samplerPid, 0);
      } catch {
        gone = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, "the sampler exited after the suite ended (never a resident idle process)");

    // The timeseries stops growing once sampling stops.
    const countAfter = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once sampling stops");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("gap-mechanical-fan-in-per-suite-runid-unified AC3 — --run-id is honored verbatim; default falls back to a fresh randomUUID", async () => {
  // OVERRIDE: an explicit --run-id (the mechanical fan-in per-suite id) becomes the canonical runId
  // in BOTH the state and the round record (the record ↔ suite-load-<runId>.jsonl join key). The fake
  // suite also captures the QUAY_RUN_ID env the runner delivers, to pin the shortRunId truncation
  // (a LONG --run-id must still deliver a ≤8-char short id — the tmux socket sun_path length constraint).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runid-override-"));
  const { f, dir } = fakeSuite(
    'printf "%s" "$QUAY_RUN_ID" > quay-run-id.txt\n' +
      'echo "# tests 1"\n' +
      'echo "# pass 1"\n' +
      'echo "# fail 0"\n' +
      'echo "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2, runId: "mfi-gap-test-1788022868-abc123" });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on a green suite");
    const s = readState(root);
    assert.equal(s.runId, "mfi-gap-test-1788022868-abc123", "--run-id is used verbatim as the state runId (not a fresh randomUUID)");
    const rec = lastRoundRecord(root);
    assert.equal(rec.runId, "mfi-gap-test-1788022868-abc123", "the round record carries the SAME canonical runId (record ↔ telemetry join key)");
    // shortRunId length constraint: the runner derives its per-run namespace id by truncating the runId
    // to 8 chars — a LONG --run-id must not leak a long id into QUAY_RUN_ID (tmux socket sun_path bound).
    const delivered = fs.readFileSync(path.join(root, "quay-run-id.txt"), "utf8");
    assert.equal(delivered, "mfigapte", `the child received the 8-char truncated short id (got ${JSON.stringify(delivered)})`);
    assert.ok(delivered.length <= 8, "the delivered QUAY_RUN_ID is ≤8 chars (tmux socket sun_path length constraint)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // DEFAULT: no --run-id ⇒ a fresh randomUUID (an independent run stays self-naming — no regression).
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runid-default-"));
  const faked = fakeSuite(
    'echo "# tests 1"\n' +
      'echo "# pass 1"\n' +
      'echo "# fail 0"\n' +
      'echo "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root: root2, command: `bash ${faked.f}`, laneCount: 2 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on a green suite");
    const s = readState(root2);
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.runId), `default runId is a randomUUID (got ${s.runId})`);
  } finally {
    fs.rmSync(root2, { recursive: true, force: true });
    fs.rmSync(faked.dir, { recursive: true, force: true });
  }
});


test("gap-suite-load-sampler-orphan-process AC2 — an UNCLEAN host exit (SIGKILL, no terminal state) reaps the sampler via host-death detection", async () => {
  // The state-driven stop only fires when SOMEONE writes a terminal state / removes the state file.
  // A host that dies UNCLEANLY (SIGKILL — uncatchable; worker mid-exit exception; fan-in wrapper
  // killed before its `rm -f`) leaves the state file stuck at "running" and the sampler must still
  // stop. This test drives that branch directly: the host backgrounds the sampler then never writes
  // a terminal state — the host is SIGKILLed, and the sampler must detect the host's death (its
  // ppid changes when the kernel reparents the orphan) and exit on its own.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-orphan-"));
  const stateFile = path.join(root, "sampler.state.json");
  const outFile = path.join(root, "suite-load-orphan.jsonl");
  const samplerPath = path.join(REPO_ROOT, "plugin", "scripts", "suite-load-sampler.ts");
  fs.writeFileSync(stateFile, JSON.stringify({ state: "running" }), "utf8");
  // Host = a bash wrapper that backgrounds the sampler then sleeps, modeling the suite host the
  // sampler must follow. It has NO terminal-state / rm -f step — the unclean-exit branch.
  const host = spawn(
    "bash",
    [
      "-c",
      `node --no-warnings --experimental-strip-types "${samplerPath}" --state-file "${stateFile}" --out-file "${outFile}" --run-id "orphan-test" --interval 0.2 & sleep 60`,
    ],
    { stdio: "ignore", detached: true },
  );
  host.unref();
  const pidFile = `${outFile}.pid`;
  try {
    // Wait (bounded) for the sampler to write its first sample + pid sidecar while the host is alive.
    let samplerPid = 0;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try { lines = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean); } catch { lines = []; }
      try { samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim()); } catch { samplerPid = 0; }
      if (lines.length >= 1 && samplerPid > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(lines.length >= 1, "the sampler wrote >=1 sample while its host was alive");
    assert.ok(samplerPid > 0, "the sampler wrote its pid sidecar");

    // Unclean host death: SIGKILL the host wrapper (no terminal state, no rm -f). The sampler must
    // detect the host's death (ppid change) and exit on its own — the AC2 orphan-reaping invariant.
    process.kill(host.pid, "SIGKILL");

    let gone = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try { process.kill(samplerPid, 0); } catch { gone = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, "the sampler exited after its host was SIGKILLed (host-death reaping, never an orphan)");

    // The timeseries stops growing once the host is dead (no post-mortem pollution).
    const countAfter = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once the host is dead");
  } finally {
    try { process.kill(host.pid, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("gap-suite-load-sampler-early-red-truncates-load-curve AC2/AC3 — the sampler keeps sampling through an EARLY-RED state (finishedAt null) and stops only once finishedAt is written", async () => {
  // The finishedAt-driven stop (gap-suite-load-sampler-early-red-truncates-load-curve): the runner
  // writes state="red" + finishedAt:null on the FIRST failure line while the suite keeps running to
  // its natural end. The old state-driven stop (`state !== "running"`) truncated a red round's load
  // curve at first-failure. This test drives that branch directly: a state file stuck at early-red
  // (state="red", finishedAt:null) must NOT stop the sampler — it keeps sampling (AC2, the fix) —
  // and stops cleanly once finishedAt is written (AC3, 结束即停 / no idle-spin, green-round parity).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-earlyred-"));
  const stateFile = path.join(root, "sampler.state.json");
  const outFile = path.join(root, "suite-load-earlyred.jsonl");
  const samplerPath = path.join(REPO_ROOT, "plugin", "scripts", "suite-load-sampler.ts");
  // Early-red: state=red but finishedAt=null — the suite is still running to its natural end.
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ state: "red", reason: "failed", runId: "early-red-test", finishedAt: null }),
    "utf8",
  );
  // Host = a bash wrapper that backgrounds the sampler then sleeps, modeling the suite host.
  const host = spawn(
    "bash",
    [
      "-c",
      `node --no-warnings --experimental-strip-types "${samplerPath}" --state-file "${stateFile}" --out-file "${outFile}" --run-id "early-red-test" --interval 0.2 & sleep 60`,
    ],
    { stdio: "ignore", detached: true },
  );
  host.unref();
  const pidFile = `${outFile}.pid`;
  try {
    // AC2 — the sampler must KEEP sampling while finishedAt is null even though state=red (the
    // early-red continuation). Wait (bounded) for >=2 samples: the old state-driven stop would exit
    // on first sight of the red state and write ZERO samples, so this assertion is the regression
    // fence (it fails on the pre-fix code, passes on the fix).
    let samplerPid = 0;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try { lines = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean); } catch { lines = []; }
      try { samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim()); } catch { samplerPid = 0; }
      if (lines.length >= 2 && samplerPid > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(samplerPid > 0, "the sampler wrote its pid sidecar");
    assert.ok(lines.length >= 2, "the sampler kept sampling through the early-red state (finishedAt null, state=red)");

    // AC3 — the terminal write sets finishedAt; the sampler must then stop (结束即停 / no idle-spin).
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ state: "red", reason: "failed", runId: "early-red-test", finishedAt: Date.now() / 1000 }),
      "utf8",
    );

    let stopped = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try { process.kill(samplerPid, 0); } catch { stopped = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(stopped, "the sampler exited after finishedAt was written (terminal stop, no idle-spin)");

    // No post-terminal samples: the timeseries stops growing once finishedAt is set.
    const countAfter = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once finishedAt is set");
  } finally {
    try { process.kill(host.pid, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-fan-in-suite-refusal-reports-as-suite-red（AC1 可观测性 / AC3 结构量替代代理量）─────────────
// 病（2026-09-13 08:14:57Z 实测）：fan-in suite log 0 字节 + `suite-end reason:"suite red"` —— runner
// 的「未跑就返回」分支只写 stderr，而 suite-driver 只 tee stdout ⇒ 「没跑」与「跑了且失败」同形。
// 修法：每条未跑就返回的分支在 suite log 写一行 SUITE-NOT-RUN（含 branch 名与原因）；进了执行段则写
// SUITE-RUN-START（AC3）⇒ 0 字节从此只表示「runner 连写入点都没到」。
// ⛔ 本组测试只走【真实的 runner 进程】（runCli/runRunner 真 spawn），断言发生在【盘上的 suite log】上。



test("AC1 — 单飞拒绝在 suite log 留【非空、含分支名与原因】的一行（⛔ 0 字节日志 = 与「跑了且红」同形）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1-notrun-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  // 在飞 runner：live pid（本测试进程自身）+ 非 terminal state。suite log 走 fan-in 的真实命名形状。
  fs.writeFileSync(
    statePath(root),
    JSON.stringify({ state: "running", pid: process.pid, finishedAt: null, runId: "inflight" }, null, 2),
  );
  const logFile = path.join(root, ".quay", "fan-in-suite-probe~run~1.log");
  try {
    const res = await runCli(RUNNER, ["--root", root, "--state-dir", path.join(root, ".quay"), "--log-file", logFile]);
    assert.notEqual(res.code, 0, "拒绝 ⇒ 非零退出（本轮没跑）");
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    assert.notEqual(log.trim(), "", "suite log 非空（⛔ 0 字节 ⇒ 与「跑了且失败」同形，硬规则 3b）");
    assert.ok(log.includes(SUITE_NOT_RUN), `suite log 含 SUITE-NOT-RUN 标记行:\n${log}`);
    assert.match(log, /branch=single-flight-refusal/, "标记行指名【哪条分支】（可归因，⛔ 不是「不知道」）");
    assert.match(log, /reason=/, "标记行携带原因");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("AC1 — 资源闸 WAIT 同样留标记（第二条「未跑就返回」分支），且标记行有界（⛔ 不是 4KB 单行）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1-gatewait-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    statePath(root),
    JSON.stringify({ state: "green", pid: 999999999, finishedAt: Date.now(), runId: "old" }, null, 2) + "\n",
    "utf8",
  );
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "84.77", // WAIT（cpu 饥饿）
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1",
      },
    });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "WAIT ⇒ 本轮没跑");
    assert.ok(!fs.existsSync(argsLog), "suite 从未被 spawn");
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    const line = log.split("\n").find((l) => l.includes(SUITE_NOT_RUN));
    assert.ok(line, `WAIT ⇒ suite log 有 SUITE-NOT-RUN 行:\n${log}`);
    assert.match(line, /branch=resource-gate-wait/, "WAIT 分支名可辨（⛔ 与单飞拒绝同形）");
    assert.ok(line.length <= 500, `标记行有界（实测 ${line.length} 字符）——可读性正是这条标记的存在理由`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("AC1 负控制 — 闸 GO 且无在飞 runner ⇒ suite log 里【没有】SUITE-NOT-RUN（标记可取假）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1-neg-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "10", // GO
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "GO ⇒ 真跑");
    assert.ok(fs.existsSync(argsLog), "suite 被 spawn（负控制的前提：这一轮是真的跑了）");
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    assert.ok(!log.includes(SUITE_NOT_RUN), `跑了的那一轮 ⛔ 不得出现拒绝标记:\n${log}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("AC3 — 两个标记在两态间可取假：非拒绝轮有 RUN-START 无 NOT-RUN，拒绝轮反之", async () => {
  // 非拒绝轮（真跑）。
  const goRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3-go-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  let goLog = "";
  try {
    const child = runRunner({ root: goRoot, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "非拒绝轮退出 0");
    goLog = fs.readFileSync(path.join(goRoot, ".quay", "full-suite.log"), "utf8");
  } finally {
    fs.rmSync(goRoot, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(goLog.includes(SUITE_RUN_START), "非拒绝轮：suite log 有 RUN-START（本轮确实进了执行段）");
  assert.ok(!goLog.includes(SUITE_NOT_RUN), "非拒绝轮：⛔ 无 NOT-RUN");

  // 拒绝轮。
  const rejRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3-rej-"));
  fs.mkdirSync(path.join(rejRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    statePath(rejRoot),
    JSON.stringify({ state: "running", pid: process.pid, finishedAt: null, runId: "inflight" }, null, 2),
  );
  let rejLog = "";
  try {
    const res = await runCli(RUNNER, ["--root", rejRoot, "--state-dir", path.join(rejRoot, ".quay")]);
    assert.notEqual(res.code, 0, "拒绝轮退出非零");
    rejLog = fs.readFileSync(path.join(rejRoot, ".quay", "full-suite.log"), "utf8");
  } finally {
    fs.rmSync(rejRoot, { recursive: true, force: true });
  }
  assert.ok(rejLog.includes(SUITE_NOT_RUN), "拒绝轮：有 NOT-RUN");
  assert.ok(!rejLog.includes(SUITE_RUN_START), "拒绝轮：⛔ 无 RUN-START（它没进执行段——这正是 0 字节的旧歧义所在）");
});
