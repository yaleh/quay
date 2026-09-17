// @test-group engine
// fan-in-execute-paths-s11.test.mjs — the `durationMs` / bounded-wait cluster of
// fan-in-execute-paths-s07.test.mjs, split out by gap-ac281-develop-ci-test-job-wallclock-under-30s.
//
// Why: GOAL-022 scope item 1 is "main/serial/lowconc 三阶段的**单文件地板**全部压到 30 秒以下", and
// `__PERFILE__` on a real develop run (35229994657) measured this stem's s07 file at 41.6s — the second
// of only TWO CI files above 30s (the other being driver-anchor.test.mjs, 43.1s). `node --test` only
// parallelises ACROSS files, so the file split is the only lever on that floor (raising concurrency is
// provably useless: LPT simulation gives the same 43.1s makespan at 128/256/384/512).
//
// ⛔ Split by functional boundary, not "half a test": the five tests here and the four left in s07 share
//    NO mutable state beyond the read-only harness module (each makes its own mkdtemp fixtures and spawns
//    its own processes) ⇒ running the two files CONCURRENTLY is equivalent to running them sequentially.
//    Shared fixtures stay single-source in ./helpers/fan-in-execute-paths-harness.mjs.
//
// Topic (the `wall_ms = end_ms − start_ms` defect, gap-fan-in-suite-duration-poll-granularity-inflation):
//   wheel trueness of durationMs — the TRUE end must come from the marker the suite writes at exit, not
//   from when a poll agent first noticed it; plus the bounded (非无界) wait that waits for that marker.
import { test } from "node:test";
import { REPO_ROOT, assert, cleanup, extractBlockFromPrompts, fs, os, path, promptContaining, runBash, runWorkflow, runnerHermeticEnv, spawn, spawnSync, symlinkRuntimeTrees, vm, waitForMarkerOrDeath } from "./helpers/fan-in-execute-paths-harness.mjs";

// ── ⑧ durationMs 真墙钟一致性（gap-fan-in-suite-duration-poll-granularity-inflation）─────────────────
// THE DEFECT: wall_ms = end_ms − start_ms where end_ms was captured at POLL-DISCOVERY time (when the
// poll agent first sees the exit marker). Under a 60s poll interval the suite's true end lands between
// polls ⇒ durationMs systematically inflated 0-60s (round232: marker mtime 23:07:41.89, true 609.1s,
// ledger recorded 674.2s — +65.1s, straddling the AC101 600s gate). FIX: the detached suite writes its
// TRUE end (end_ms/end_iso) into the exit marker at the moment it exits; the poll only READS it.


test("⑧ duration-wiring — the poll block reads end_ms/end_iso from the marker (the suite TRUE end), falling back to poll-discovery only for an old-format marker", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-poll", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-poll", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  // The fix: the poll reads the suite's TRUE end from the exit marker (written by the detached suite).
  assert.ok(poll.includes("marker_end_ms=$(sed -n 's/^end_ms=//p'"), "poll must read end_ms from the exit marker (the suite's TRUE end, not poll-discovery)");
  assert.ok(poll.includes("marker_end_iso=$(sed -n 's/^end_iso=//p'"), "poll must read end_iso from the exit marker");
  // ...and falls back to poll-discovery ONLY when the marker has no end_ms (old-format marker).
  assert.match(poll, /end_ms=\$\{marker_end_ms:-/, "end_ms must default to marker_end_ms (fallback = poll-discovery)");
  assert.match(poll, /end_iso=\$\{marker_end_iso:-/, "end_iso must default to marker_end_iso");
  // The OLD buggy form (end_ms = date +%s%3N unconditionally at poll time) must NOT be the assignment.
  assert.ok(!/^end_ms=\$\(date \+%s%3N\)$/m.test(poll), "end_ms must NOT be taken unconditionally from poll-discovery time");
  // The capture write must still record end_ms/end_iso/wall_ms.
  assert.ok(poll.includes("end_ms=%s"), "poll must still write end_ms into the capture");
  assert.ok(poll.includes("wall_ms"), "poll must still compute wall_ms");
});


test("⑧ duration REAL — wall_ms equals the suite TRUE wall clock (marker end_ms − start_ms), NOT inflated by poll-discovery latency (AC1 取假)", async (t) => {
  // THE FALSIFICATION: a real detached suite (sleep 1s → exit 0); AFTER its marker already exists we
  // deliberately delay the poll ~5s (a poll interval gap). The OLD code's poll-time `date +%s%3N` would
  // fold that whole 5s gap into wall_ms (the 0-60s inflation). The FIX must yield wall_ms ≈ the suite's
  // true duration, not the poll-discovery time.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-duration-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-tb-duration";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nsleep 1\nexit 0\n");
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);
  // The detached launch now runs full-suite-runner.ts — symlink the REAL plugin tree so it resolves.
  symlinkRuntimeTrees(dir, {});

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, `/tmp/fan-in-suite-${task}.pid`, codeDeltaFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: dir, runId: "fm-tb-duration", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const launchRun = runBash(launchBlock, { cwd: dir, timeout: 30_000, env: runnerHermeticEnv() });
  assert.equal(launchRun.status, 0, `launch block failed: ${launchRun.stderr}`);
  assert.match(launchRun.stdout, /SUITE_OUTCOME=started/, `code_delta non-empty must start the full suite, got: ${launchRun.stdout}`);

  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const capture = `/tmp/fan-in-suite-${task}.env`;
  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) { if (fs.existsSync(marker)) seen = true; else await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(seen, "the detached suite must write its exit marker");

  // Read the TRUE end the detached suite recorded in the marker + the start from the capture.
  const markerText = fs.readFileSync(marker, "utf8");
  const markerEndMs = Number((markerText.match(/^end_ms=(\d+)/m) || [])[1]);
  const markerEndIso = (markerText.match(/^end_iso=(.+)$/m) || [])[1];
  assert.ok(Number.isFinite(markerEndMs), `marker must carry the suite's TRUE end_ms (the fix's source of truth), got:\n${markerText}`);
  assert.ok(markerEndIso, `marker must carry the suite's TRUE end_iso, got:\n${markerText}`);
  const captureText = fs.readFileSync(capture, "utf8");
  const startMs = Number((captureText.match(/^start_ms=(\d+)/m) || [])[1]);
  assert.ok(Number.isFinite(startMs), "capture must carry start_ms");
  const trueDurationMs = markerEndMs - startMs;
  assert.ok(trueDurationMs > 0, `true suite duration must be positive, got ${trueDurationMs}`);

  // ⛔ THE FALSIFICATION: deliberately delay the poll ~5s AFTER the suite already ended. The OLD poll
  // would add this whole gap to wall_ms (the recorded +65.1s class of inflation).
  await new Promise((r) => setTimeout(r, 5000));

  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const pollRun = runBash(pollBlock, { cwd: dir, timeout: 15_000 });
  assert.equal(pollRun.status, 0, `poll block failed: ${pollRun.stderr}`);
  assert.match(pollRun.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${pollRun.stdout}`);

  const after = fs.readFileSync(capture, "utf8");
  const wallMs = Number((after.match(/^wall_ms=(\d+)/m) || [])[1]);
  const recordedEndIso = (after.match(/^end_iso=(.+)$/m) || [])[1];
  assert.ok(Number.isFinite(wallMs), "capture must carry wall_ms");
  assert.equal(wallMs, trueDurationMs, `wall_ms must equal the suite's TRUE duration (marker end_ms − start_ms); the ~5s deliberate poll delay must NOT inflate it (old code would record ≈ ${trueDurationMs + 5000})`);
  assert.equal(recordedEndIso, markerEndIso, `end_iso must be the suite's TRUE end (marker), not the poll time`);
  // Sanity: the true 1s-sleep suite's wall_ms must sit in the seconds-range, NOT the ~6s inflated range.
  assert.ok(wallMs < trueDurationMs + 2000, `wall_ms ${wallMs} must not exceed the true duration ${trueDurationMs} by more than a small margin (no poll-latency inflation)`);
});


test("⑧ AC3 记录面真实化 REAL — the poll reads lane_count from the suite log's __GROUP__ concurrency= (真实 lane, NOT nproc)", async (t) => {
  // gap-suite-concurrency-ff-gate-and-slot-ssot AC3: lane_count 取 suite 日志的 __GROUP__ concurrency=
  // (measure-suite-reporter 每 phase 一行; 主 phase 跑最后 ⇒ 取最后一行 = 套件真实 lane)。旧实现记
  // nproc（实跑 concurrency=8 记成 16 — 记录面伪造）。This runs the REAL poll block against a capture
  // + exit marker + a log carrying serial(2) + main(8) __GROUP__ lines ⇒ lane_count must be 8.
  const task = "gap-test-lane-real";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const exitMarker = `/tmp/fan-in-suite-${task}.exit`;
  const log = `/tmp/fan-in-suite-${task}.log`;
  const nowMs = Date.now();
  fs.writeFileSync(log, [
    "selected 3 files (groups=serial)",
    "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0",
    "selected 17 files (groups=product,engine)",
    "__GROUP__ concurrency=8 files=17 sum_ms=3000 floor_ms=1200 capped=0",
  ].join("\n") + "\n");
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    `start_ms=${nowMs}`,
    `suite_log_file=${log}`,
    "suite_head=abc123",
  ].join("\n") + "\n");
  fs.writeFileSync(exitMarker, `exit=0\nend_ms=${nowMs + 1500}\nend_iso=2026-08-18T00:00:01.500Z\n`);
  t.after(() => { for (const f of [capture, exitMarker, log]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-lane-real", mergeTarget: "develop" },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const pollRun = runBash(pollBlock, { timeout: 15_000 });
  assert.equal(pollRun.status, 0, `poll block failed: ${pollRun.stderr}`);
  assert.match(pollRun.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${pollRun.stdout}`);

  const after = fs.readFileSync(capture, "utf8");
  const lane = (after.match(/^lane_count=(\d+)$/m) || [])[1];
  assert.equal(lane, "8", `lane_count must be the MAIN phase's real concurrency (the last __GROUP__ line), got: ${after.match(/^lane_count=.*$/m)?.[0]}`);
});

// ── ⑩ 阶段 2 agent 内单次有界阻塞等待（gap-fan-in-execute-poll-bounded-blocking-wait）────────────
// THE DEFECT: 旧「每轮起一个新短命轮询 agent + 脚本 setTimeout 60s」下每次 agent 只看一眼 marker 就返回
// not-done ⇒ suite 11-19min ⇒ 头 11-15 次结构上必然 not-done 纯空转。修复（在 stage-2 单 agent 内）：
// 等待块带【有界阻塞等待】（timeout 540 + sleep 15）——单次 Bash 最多阻塞 540s（硬边界 < Bash 600s
// 上限），每 15s 看一眼 marker，把 ~21 次空转压到 ~3 次。决策权在固定命令（timeout 540 是脚本给的硬
// 边界、maxSuitePolls 是循环上限），agent 不自决「等多久」（ab380c5e 是 agent 自决等待，这里是固定命令
// 的有界等待，agent 只是重跑它；gap-subagent-turn-budget-13min-falsified）。


test("⑩ 有界阻塞等待 wiring — 阶段 2 等待块带 timeout 540（< Bash 600s 上限）+ sleep 15 循环（能取假）", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-poll-bounded", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-bounded", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  // 有界阻塞等待必须存在（能取假：把 timeout 去掉 ⇒ 此断言红）。
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "poll must carry `timeout <N> bash -c` (the bounded blocking wait)");
  const timeoutSecs = Number(m[1]);
  // 硬边界 < Bash 600s 上限（能取假：放宽 >600s ⇒ 此断言红）。
  assert.ok(timeoutSecs < 600, `the blocking-wait hard bound must be < Bash 600s limit, got ${timeoutSecs}s`);
  assert.equal(timeoutSecs, 540, "the hard bound must be exactly 540s (AC1: < 600s with safety margin)");
  // sleep 15 检查粒度 + 循环等 marker 而非 agent 自决时长。
  assert.ok(poll.includes('while [ ! -f "$1" ]; do'), "the bounded wait must loop on the marker existence with sleep, not an agent-decided duration");
  assert.ok(poll.includes('sleep 15'), "the bounded wait must carry the sleep 15 poll granularity");
  // 存活核验（gap-suite-wait-bash-stale-pid-poll AC1）：内层循环必须 kill -0 核验 suite_pid，不纯靠 .exit 存在性。
  assert.ok(poll.includes('kill -0 "$2"'), "the bounded wait must liveness-check suite_pid with kill -0");
  // 决策权在固定命令（不是 agent 自决等待）——阶段 2 prompt 明示「不要做任何等待决策」。
  assert.ok(poll.includes("不要做任何等待决策"), "the wait block must refuse to make any waiting decision (fixed command, ab380c5e 反面)");
});


test("⑩ REAL 有界阻塞等待 — marker 中途出现时，轮询在【一次】阻塞内等到它（阻塞等待生效，非 N 次空转）", async (t) => {
  const task = "gap-test-poll-bounded-real";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  fs.rmSync(marker, { force: true });
  fs.writeFileSync(capture, ["full_suite_ran=true", "skip_reason=", `start_ms=${Date.now()}`, "suite_head=abc", `suite_log_file=/tmp/fan-in-suite-${task}.log`].join("\n") + "\n");
  t.after(() => { for (const f of [capture, marker, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  // marker 在 ~1s 后由【后台进程】写入（spawnSync 阻塞 Node 事件循环，Node setTimeout 不会在期间触发）。
  // 测试用 pollBlockSleep=0.2 覆盖生产 sleep 15，证明阻塞等待本身会等——不是 fixture，是真实 bash 执行。
  spawn("bash", ["-c", `sleep 1; echo exit=0 > "${marker}"; echo "end_ms=$(date +%s%3N)" >> "${marker}"; echo end_iso=2026-08-18T00:00:01.000Z >> "${marker}"`], { detached: true, stdio: "ignore" }).unref();

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-bounded-real", mergeTarget: "develop", pollBlockSeconds: 10, pollBlockSleep: 0.2 },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const t0 = Date.now();
  const r = runBash(pollBlock, { cwd: "/tmp", timeout: 15_000 });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=done SUITE_EXIT=0/, `poll must find the marker mid-block (bounded wait), got: ${r.stdout}`);
  assert.ok(elapsed >= 800, `the poll must have BLOCKED waiting (elapsed ${elapsed}ms); an instant not-done return is the N-empty-poll shape this fixes`);
});
