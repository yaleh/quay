// @test-group engine
// fan-in-execute-paths.test.mjs — gap-fan-in-execute-three-unverified-paths: the three UNVERIFIED
// hot points of plugin/workflows/fan-in-execute.js, exercised through the REAL invocation path
// (判据3 — NOT fixture-only pure-function mocks; the AC78 lesson: "改 workflow 的唯一有效验证=实调").
//
//   REAL-INVOCATION harness: every test first vm-EXECUTES the actual workflow file
//   (fan-in-execute.js) with the workflow-runtime globals (args/phase/log/agent) mocked, so the
//   script's own code runs and PRODUCES the exact subagent prompt it would emit — a parser/runtime
//   break in the file (the AC78 `meta is not defined` class, or a template-literal backtick blowup)
//   fails every test, not just a source read. Then each hot point's bash block is extracted from
//   the REAL emitted prompt and EXECUTED against real git / real filesystem state:
//
//   ① code_delta 正则 (:61-65)  — run the REAL fork/merge-base/diff/code_delta pipeline in a real
//       temp git repo (doc/code/test deltas) and assert the AC75 rerun/skip classification.
//   ② --agent-id 自找 (承重点②) — run the REAL selfloc bash (candidates/count/ls -t) against a fake
//       ~/.claude tree replaying the DIR-127/DIR-128 concurrency (flat trap a017ce6b7fab53eb9),
//       assert it deterministically picks the workflow-run subagent, NOT the flat trap; zero
//       candidates ⇒ fail-closed exit 2.
//   ③ flip sed 失败路径 (承重点③) — run the REAL flip guard against real task files: normal flip,
//       line-shape mismatch (status:Ready) ⇒ exit 2 + FATAL (no silent green), body annotation
//       'status: ready——注解' preserved (anchored $, no corruption).
//   ④ flip AC 完成闸 (gap-fan-in-flip-no-ac-completion-check) — run the REAL flip block against real
//       task files: AC 未全勾（gap-ac72 形态真样本）⇒ exit 2 + FATAL + 不翻 done; AC/DoD 段缺失 ⇒
//       exit 2 NOT-EVALUATED + 不翻 done（无法评估 ≠ 合格）; 剩余未勾均为（待外部）⇒ 翻 done; ③ 行形
//       检查与 AC 闸并列（两检查都过才翻，AC 闸在行形检查之后、sed 之前）。
//   ⑤ anti-drift-touches 守卫 (gap-anti-drift-touches-zero-coverage-fast-mode) — run the REAL step-1
//       anti-drift block from the emitted prompt against a real temp git repo (task worktree after the
//       step-1 merge): a task whose ACTUAL diff touches a file OUTSIDE its declared ## Touches ⇒ the
//       block HARD-FAILs (exit 2 + FATAL + ANTI-DRIFT HARD FAIL — the AC2 负控制: 现真值=不会, 修复后应红);
//       a task whose actual diff is fully within its declared Touches ⇒ the block stays green (AC3).
//
// Run:
//   scripts/test.sh plugin/test/fan-in-execute-paths.test.mjs
//   scripts/test.sh --for-task gap-fan-in-execute-three-unverified-paths --allow-thin
//   node --test plugin/test/fan-in-execute-paths.test.mjs

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/10 (9 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, assert, cleanup, extractBlockFromPrompts, fs, os, path, promptContaining, runBash, runWorkflow, runnerHermeticEnv, spawn, spawnSync, symlinkRuntimeTrees, vm, waitForMarkerOrDeath } from "./helpers/fan-in-execute-paths-harness.mjs";

test("⑧ time-file guard — isolate-rerun (full_suite_ran=false) with a stale .time file leaves cpu_s=null (gap-fan-in-suite-time-file-cross-relaunch-reuse AC1)", async (t) => {
  // AC1 能取假 (negative control): seed the exact cross-relaunch residue (full_suite_ran=false + a stale
  // gnu-time .time file), run the REAL poll block. The fix's full_suite_ran guard must leave cpu_s=null;
  // before the fix the `[ -f ]`-only guard would read the stale file → cpu_s=11313.883 (red).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-timeguard-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-timeguard";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const timeFile = `/tmp/fan-in-suite-${task}.time`;
  const logFile = `/tmp/fan-in-suite-${task}.log`;
  t.after(() => { for (const f of [capture, marker, timeFile, logFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  // Seed an isolate-rerun capture (full_suite_ran=false) + a STALE gnu-time file (the residue this fix
  // targets) + a green exit marker.
  fs.writeFileSync(capture, [
    "full_suite_ran=false",
    "skip_reason=isolate-rerun-load-sensitive",
    "start_iso=2026-08-20T00:00:00.000Z",
    "start_ms=1755652800000",
    "suite_head=" + "0".repeat(40),
    `suite_log_file=${logFile}`,
  ].join("\n") + "\n", "utf8");
  fs.writeFileSync(marker, "exit=0\nend_ms=1755652801000\nend_iso=2026-08-20T00:00:01.000Z\n", "utf8");
  fs.writeFileSync(timeFile, "4414.230 6899.653\n", "utf8");
  fs.writeFileSync(logFile, "ok\n", "utf8");

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-timeguard", mergeTarget: "develop" },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const r = runBash(pollBlock, { cwd: dir });
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${r.stdout}`);

  const out = fs.readFileSync(capture, "utf8");
  assert.match(out, /^cpu_s=null$/m, "isolate-rerun must NOT read the stale .time file — cpu_s stays null (full_suite_ran guard)");
  assert.match(out, /^cpu_source=not-wired$/m, "cpu_source stays not-wired (no CPU captured for an isolate-rerun)");
  assert.match(out, /^cpu_user_s=null$/m, "cpu_user_s stays null (no gnu-time columns read)");
  assert.match(out, /^cpu_sys_s=null$/m, "cpu_sys_s stays null (no gnu-time columns read)");
});


test("⑧ time-file rm REAL — ISOLATE_LAUNCH removes the stale .time file at launch (gap-fan-in-suite-time-file-cross-relaunch-reuse AC2)", async (t) => {
  // AC2 能取假 (REAL mechanism): extract the REAL ISOLATE_LAUNCH block, pre-seed a stale gnu-time .time
  // file (the cross-relaunch residue), run the block — the rm at the top must delete it. Revert the rm
  // ⇒ the stale file survives ⇒ red.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-isorm-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-isorm";
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

  // Extract the REAL ISOLATE_LAUNCH block (a RED sequence drives the fix prompt carrying it).
  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-isorm", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");

  // Pre-seed the cross-relaunch residue: a stale .time file (the gnu-time file a prior full-suite run left).
  const timeFile = `/tmp/fan-in-suite-${task}.time`;
  const captureFile = `/tmp/fan-in-suite-${task}.env`;
  const isolateFiles = `/tmp/fan-in-scope-isolate-${task}.files`;
  const logFile = `/tmp/fan-in-suite-${task}.log`;
  const pidFile = `/tmp/fan-in-suite-${task}.pid`;
  t.after(() => { for (const f of [timeFile, captureFile, isolateFiles, logFile, pidFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  fs.writeFileSync(timeFile, "4414.230 6899.653\n", "utf8");

  // Run the isolate-launch block (async: it launches a detached suite that sleeps 1s).
  const launchProc = spawn("bash", ["-c", isolate], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let launchOut = "";
  launchProc.stdout.on("data", (d) => { launchOut += d; });
  launchProc.stderr.on("data", (d) => { launchOut += d; });
  const launchExit = await new Promise((resolve) => { launchProc.on("exit", (code, sig) => resolve({ code, sig })); });

  assert.equal(launchExit.code, 0, `isolate-launch block failed: ${launchOut}`);
  assert.ok(!fs.existsSync(timeFile), "ISOLATE_LAUNCH must rm the stale .time file at launch (the cross-relaunch residue is gone)");
});



/** Is `pid` a live process? (kill -0 semantics; EPERM counts as alive — someone else's process.) */

/**
 * Wait until `markerPath` EXISTS or the detached suite (`pid`) is GONE — whichever comes first.
 *
 * Event-driven on purpose (gap-suite-not-robust-at-high-derived-concurrency): `fs.watch` on the
 * marker's directory is the completion source, and the suite's own pid is the failure detector. A
 * wall-clock budget takes NO part in the decision — a loaded host legitimately takes ~10x the idle
 * time, and reading that as "the lock is broken" was the defect this replaces.
 *
 * Returns "marker" | "dead" | "guard". `guardMs` is a HANG-GUARD only (explicitly overridable via
 * FANIN_TEST_MARKER_GUARD_MS) so a stuck suite reds this test instead of hanging the runner; it is
 * ~60x the measured idle cost of the fake suite below.
 */

// ── ⑧⑩ 锁等待负控制（gap-single-flight-lock-timeout-double-value AC1/AC2）────────────────────────
// THE DEFECT: test.sh 的 single-flight 锁有两套超时值（FULL_SUITE_LOCK_TIMEOUT 默认 600 + fan-in 的
// suiteLockTimeoutSecs 900 覆盖），且 600s 线已被常态化的 819-1619s full-bucket suite 跨越 ⇒ 活 suite
// 被 fail-closed「not starting」误杀 + 重试放大。
// FIX: test.sh 的锁等待改为【无界排队】（flock crash-autorelease 保证死持有者不泄漏槽），fan-in 不再经
// env 传 FULL_SUITE_LOCK_TIMEOUT（无双值、无 900 字面量）。
// ① 结构负控制（本缺陷的负控制）：launch/isolate 块不得携带 FULL_SUITE_LOCK_TIMEOUT / suite_lock_timeout
//    —— revert 本修复（重新经 env 传 / 重引入 suiteLockTimeoutSecs）⇒ 此断言红。
// ② REAL 机制（wait-and-acquire）：fake test.sh 忠实复现 test.sh 的【无界】锁等待语义（S=2 槽、非阻塞
//    try + 无界等待 + 永不 fail-closed）。两槽全忙时套件【等待】释放而【非】fail-closed。
// ── the event-driven wait's OWN falsification (AC1: it must be able to return non-"marker") ────────

test("⑧⑩ wait AC1 — marker-or-liveness driven, NOT a clock: dead suite ⇒ 'dead' without burning the budget; a marker appearing mid-wait ⇒ 'marker' (fs.watch); alive+no marker ⇒ 'guard'", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-wait-"));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

  // A provably DEAD pid: spawn and reap a real child.
  const child = spawn("bash", ["-c", "exit 0"], { stdio: "ignore" });
  await new Promise((r) => child.on("exit", r));
  const deadPid = child.pid;

  // 1) dead pid + no marker ⇒ "dead" — and it must be detected as an EVENT, not by waiting out a
  //    budget (this is the whole point: no 15s/60s burn, and no false red on a slow host).
  const t0 = Date.now();
  assert.equal(await waitForMarkerOrDeath(path.join(dir, "never.exit"), deadPid, 60_000), "dead");
  assert.ok(Date.now() - t0 < 5_000, `a dead suite must be an event, not a timeout (took ${Date.now() - t0}ms)`);

  // 2) alive pid, marker arrives WHILE waiting ⇒ "marker" via fs.watch (not via the poll).
  const lateMarker = path.join(dir, "late.exit");
  const pending = waitForMarkerOrDeath(lateMarker, process.pid, 60_000);
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(lateMarker, "exit=0\n");
  assert.equal(await pending, "marker");

  // 3) alive pid + no marker ⇒ "guard" (the ONLY place a clock participates, and it is a hang-guard).
  assert.equal(await waitForMarkerOrDeath(path.join(dir, "never2.exit"), process.pid, 700), "guard");
});


test("⑧⑩ 锁等待负控制 — suite-launch 不再携带 FULL_SUITE_LOCK_TIMEOUT (无双值); REAL 槽忙→释放后获取而非 fail-closed", async (t) => {
  // RED 序列驱动 vm 实执行：fix agent prompt 携带 ISOLATE_LAUNCH 块（SUITE_LAUNCH 在 phase-1 prompt）。
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-lockwait", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-lockwait", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                          // stage 2: RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },                       // Fix agent (carries ISOLATE_LAUNCH)
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched
    ],
  });

  // ── ① 结构负控制（无双值）──
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(!launch.includes("FULL_SUITE_LOCK_TIMEOUT"), "suite-launch must NOT pass FULL_SUITE_LOCK_TIMEOUT (single source = test.sh unbounded queue wait)");
  assert.ok(!launch.includes("suite_lock_timeout"), "suite-launch must NOT define a suite_lock_timeout override");
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");
  assert.ok(!isolate.includes("FULL_SUITE_LOCK_TIMEOUT"), "isolate-rerun launch must NOT pass FULL_SUITE_LOCK_TIMEOUT");
  assert.ok(!isolate.includes("suite_lock_timeout"), "isolate-rerun launch must NOT define a suite_lock_timeout override");

  // ── ② REAL wait-and-acquire ──
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-lockwait-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-lockwait-real";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);

  // Fake test.sh: faithful single-flight lock semantics (S=2 slots, non-blocking try, UNBOUNDED wait —
  // never fail-closed). The REAL scripts/test.sh is far too heavy for a unit test.
  const fakeTest = [
    "#!/usr/bin/env bash",
    "set -u",
    'lock_base="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)/full-suite.lock"',
    "fds=()",
    'for i in 0 1; do exec {fd}>"${lock_base}.${i}"; fds+=("$fd"); done',
    'held=""',
    "idx=0",
    'for fd in "${fds[@]}"; do if flock -n "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    'if [ -z "$held" ]; then',
    '  while [ -z "$held" ]; do',
    "    idx=0",
    '    for fd in "${fds[@]}"; do if flock -w 1 "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    "  done",
    "fi",
    'echo "acquired full-suite single-flight slot $held"',
    "sleep 1",
    "exit 0",
    "",
  ].join("\n");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), fakeTest);
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add fake test.sh"]);
  // The detached launch now runs full-suite-runner.ts — symlink the REAL plugin tree so it resolves.
  symlinkRuntimeTrees(dir, {});

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  const tmpFiles = [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, codeDeltaFile];
  t.after(() => { for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts: prompts2 } = await runWorkflow({
    args: { task, worktree: dir, root: dir, runId: "fm-lockwait-real", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts2, "# suite-launch-block-start", "# suite-launch-block-end");

  // Hold BOTH slots in a detached holder; killing it releases the flock (fd close auto-releases).
  const holder = spawn("bash", ["-c",
    `cd ${dir}; exec 8>"${dir}/.git/full-suite.lock.0"; flock -n 8 || exit 8; ` +
    `exec 9>"${dir}/.git/full-suite.lock.1"; flock -n 9 || exit 9; ` +
    `touch ${dir}/slots-held; sleep 30`], { stdio: "ignore" });
  t.after(() => { try { holder.kill("SIGKILL"); } catch (_) {} });
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, "slots-held")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(path.join(dir, "slots-held")), "holder must hold both slots before the suite launch");

  // Launch the REAL SUITE_LAUNCH block (no env seam — the unbounded wait lives in test.sh). Spawn
  // asynchronously (spawnSync would block until the detached suite's inherited stdout pipe closes), verify
  // the suite is STILL WAITING (no exit marker — it did NOT fail-closed), free a slot, then await the
  // block's ~1s confirm. The suite must acquire the freed slot and run to exit 0.
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const launchStartedMs = Date.now();
  const launchProc = spawn("bash", ["-c", launchBlock], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: runnerHermeticEnv() });
  let launchOut = "";
  launchProc.stdout.on("data", (d) => { launchOut += d; });
  launchProc.stderr.on("data", (d) => { launchOut += d; });
  await new Promise((r) => setTimeout(r, 1500)); // let the suite start waiting
  assert.ok(!fs.existsSync(marker), "the suite must WAIT while both slots are held — no exit marker (never fail-closed)");
  holder.kill("SIGKILL");                       // free a slot WHILE the suite is waiting
  const launchExit = await new Promise((resolve) => { launchProc.on("exit", (code, sig) => resolve({ code, sig })); });
  assert.equal(launchExit.code, 0, `launch block failed: ${launchOut}`);

  // ── THE WAIT IS EVENT-DRIVEN, NOT A WALL-CLOCK BUDGET ───────────────────────────────────────────
  // (gap-suite-not-robust-at-high-derived-concurrency, 2026-09-16 — this REPLACES the 15s literal
  // that the previous task bumped to 60s. A bump is the wrong shape: the quantity being waited on is
  // "a real suite, on a real host, under whatever load the host has", which has NO upper bound that
  // a literal can honestly claim. Measured on the self-hosted tokyo-alpha runner at suite concurrency
  // 128: the same healthy suite took 18.2s to reach the marker where an idle 16-core dev box takes
  // ~2s — so every literal is either a false failure on a loaded host or a liveness assumption
  // disguised as a timeout.)
  //
  // The decision variable is now an EVENT or a PROCESS STATE, never a duration:
  //   • the marker appears  ⇒ DONE (fs.watch on its directory is the event source);
  //   • the detached suite's pid is GONE and the marker is still absent ⇒ the suite died without
  //     acquiring — a REAL failure, reported as `dead` (not as a timeout).
  // `FANIN_TEST_MARKER_GUARD_MS` remains as a HANG-GUARD only: it exists so a genuinely stuck suite
  // fails this test rather than hanging the runner, is explicitly configurable, and is ~60x the idle
  // cost / ~6.6x the worst measured loaded cost. While the suite is ALIVE the wait does not stop.
  // The pidfile is a HINT, never a contract (the launch block itself falls back to a pure .exit poll
  // when it cannot be read — SUITE_LAUNCH leaves `suite_pid` empty). It is trusted here ONLY when it
  // is demonstrably FRESH, i.e. written after this launch began: a stale leftover in the same /tmp
  // (measured locally: an unremovable root-owned file made the launch block's own `rm -f` fail, so
  // it held a long-dead pid) would otherwise be read as "the suite died" and the wait would fail a
  // healthy run.
  const pidFile = `/tmp/fan-in-suite-${task}.pid`;
  let suitePid = NaN;
  try {
    if (fs.statSync(pidFile).mtimeMs >= launchStartedMs - 1000) {
      suitePid = Number((fs.readFileSync(pidFile, "utf8").match(/^(\d+)/) ?? [])[1]);
    }
  } catch { /* no pidfile ⇒ marker-only wait (documented fallback) */ }
  const waitOutcome = await waitForMarkerOrDeath(marker, suitePid);
  assert.equal(waitOutcome, "marker",
    `the waiting suite must acquire the freed slot and write its exit marker (wait outcome=${waitOutcome}; "dead" ⇒ the suite process vanished before acquiring, "guard" ⇒ it stayed alive past the hang-guard with no marker)`);
  const markerText = fs.readFileSync(marker, "utf8");
  const log = fs.readFileSync(`/tmp/fan-in-suite-${task}.log`, "utf8");
  assert.match(markerText, /exit=0/, `the suite must run to exit 0 after acquiring the freed slot, got: ${markerText.trim()}`);
  assert.match(log, /acquired full-suite single-flight slot/, "the suite must log its slot acquisition");
  assert.ok(!log.includes("not starting"), "the suite must NOT fail-closed (no 'not starting' lock refusal)");
});

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
