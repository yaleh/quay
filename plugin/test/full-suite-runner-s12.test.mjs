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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 12/12 (6 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { GREEN_SUITE, REPO_ROOT, RUNNER, SUITE_NOT_RUN, SUITE_RUN_START, after, assert, fakeSuite, fakeTestShRecordingArgs, fs, os, path, runCli, runRunner, spawn, statePath, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

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
