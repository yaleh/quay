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

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/10. Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).
// ⚠️ 2026-09-17: 本 shard 的 `durationMs` / 有界等待那 5 个 test() 已再拆到
//    `fan-in-execute-paths-s11.test.mjs`（gap-ac281-…：本文件 CI 实测 41.6s，是仅有的两个 >30s 文件之一
//    ⇒ 单文件地板必须低于 30s）。
// ⚠️ 2026-09-18: 剩下的 ⑧⑩ 锁等待族也拆到 `fan-in-execute-paths-s12.test.mjs`
//    （gap-suite-fan-in-execute-paths-s07-long-pole-split）。本文件现在只剩 ⑧ **time-file 残留**族。
//    ⇒ 只看本文件**不再**是这块的完整覆盖：s07 + s11 + s12 三个文件合起来才是。
//
// 本 shard 现在的主题（⑧ 跨 relaunch 的 .time-file 残留，gap-fan-in-suite-time-file-cross-relaunch-reuse）：
//   isolate-rerun capture（full_suite_ran=false）配一个陈旧的 gnu-time .time 文件时，cpu_s 必须保持
//   null（AC1），且 ISOLATE_LAUNCH 起手就要 rm 掉那个陈旧文件（AC2，跨 relaunch 复用的残留）。

import { test } from "node:test";
import { REPO_ROOT, assert, cleanup, extractBlockFromPrompts, fs, os, path, promptContaining, runBash, runWorkflow, spawn, spawnSync } from "./helpers/fan-in-execute-paths-harness.mjs";

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

// ⚠️ 2026-09-18: 本文件的 ⑧⑩ 锁等待族（`waitForMarkerOrDeath` AC1 + 锁等待负控制）已再拆到
//    `fan-in-execute-paths-s12.test.mjs`（gap-suite-fan-in-execute-paths-s07-long-pole-split：本文件
//    CI 实测 32.4s，其中 31.05s 是那**一个** test，而它等的是一个未被释放的锁 —— 详见 s12 里 holder
//    的 `exec sleep 30` 注释）。⚠️ 只看本文件**不再**是这块的完整覆盖：s07 + s11 + s12 合起来才是。
