// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s10.test.mjs by gap-suite-split-15-over-30s-test-files — shard 12 (1 test). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, fs, makeMechRepo, mechOpts, path, rmSafe, runMechanicalFanIn, waitFor } from "./helpers/worker-driver-fan-in-harness.mjs";

// ── gap-watchdog-killed-round-writes-no-verification-round-record ──────────────────────────────────
// 病根（AC2 的真实设计判据）：静默看门狗 SIGKILL 的是【整个进程组】——而「预定的 round 台账 writer」
// 恰在那一组里（quay 形态的 suite 走 full-suite-runner.ts，它是 verification-round.jsonl 的唯一 writer）
// ⇒ runner 与它的 suite 一起死 ⇒ 这一轮【一行都不写】⇒ 任何以该载体为输入的判定器把「没评估」读成
// 「没问题」。既有 recordDelegatedRound 的 `if (!suiteRunsOutsideRunner(worktree)) return` 提前返回正是
// 没能覆盖本子类的根因：它把「谁预定写」当成了「谁写得到」。
// 本测试的两面控制（同一夹具、只换 suite 命令）：
//   ① 绿轮（quay 形态）⇒ 台账必须【不存在】—— runner 是它的 writer，本层补写就是双写（既有负控制）；
//   ② 看门狗杀（quay 形态）⇒ 台账必须【存在】—— 预定 writer 已死，活着的写者只剩 driver 进程。
// ⛔ 可失败控制：把 hung 分支的那次写入去掉 ⇒ ② 立刻红（台账不存在）；把 force 去掉 ⇒ 同样红。
//    把写入改成无条件（去掉 force 的判据）⇒ ① 红。两个方向都被这一条测钉住。

test("AC1/AC2 (gap-watchdog-killed-round-writes-no-verification-round-record) — 看门狗 SIGKILL【整组】后台账仍出现 NOT-EVALUATED 记录；绿轮（quay 形态）仍不补写（双向控制）", async (t) => {
  // ① 负控制：quay 形态的绿轮 —— 预定 writer（runner）在路径上，台账不该由本层补写。
  const mGreen = makeMechRepo("wdk-green", "gap-wdk-green");
  t.after(() => rmSafe(mGreen.base));
  const greenLedger = path.join(mGreen.repo, ".quay", "verification-round.jsonl");
  const rg = await runMechanicalFanIn(mechOpts(mGreen, "mfi-wdk-green-1", {
    task: "gap-wdk-green", perSuiteRunId: "mfi-wdk-green-1",
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
  }));
  assert.equal(rg.outcome, "landed", `绿轮必须落地 (step=${rg.step} reason=${rg.reason})`);
  assert.equal(fs.existsSync(greenLedger), false, "⛔ 绿轮不该由本层补写（runner 才是它的 writer；写了就是双写）");

  // ② 真实证据：quay 形态 + 看门狗 SIGKILL 整组 ⇒ 台账必须出现，且形状是 NOT-EVALUATED。
  const m = makeMechRepo("wdk-hung", "gap-wdk-hung");
  t.after(() => rmSafe(m.base));
  const ledger = path.join(m.repo, ".quay", "verification-round.jsonl");
  assert.equal(fs.existsSync(ledger), false, "前置：fan-in 前台账载体不存在（正是缺陷现场）");
  // suite 命令：起一个【孙进程】并落它的 pid（证「整组被杀」而非只杀直接子进程），随后静默不输出。
  // ⚠️ 经脚本文件而不是内联 `bash -c '<含 $! 的脚本>'`：suiteCommand 的每个元素会被 slotHolderArgv 用
  // JSON.stringify 包成【双引号】串拼进外层 bash，`$!` 会在外层的双引号里先被展开成空 ⇒ 内层收到
  // `echo  > file`（写个空行）——症状是「pid 文件存在但内容不是 pid」，与「孙进程没起来」同形。
  const gpFile = path.join(m.base, "grandchild.pid");
  const probeScript = path.join(m.base, "suite-probe.sh");
  fs.writeFileSync(probeScript, 'sleep 100 &\necho $! > "$1"\necho started\nwait\n', "utf8");
  const suiteCmd = ["bash", probeScript, gpFile];
  const t0 = Date.now();
  const r = await runMechanicalFanIn(mechOpts(m, "mfi-wdk-hung-1", {
    task: "gap-wdk-hung", perSuiteRunId: "mfi-wdk-hung-1",
    suiteCommand: suiteCmd, silenceMs: 400,
  }));
  assert.ok(Date.now() - t0 < 30_000, `watchdog 必须有限时间返回（⛔ 15min 挂死）took ${Date.now() - t0}ms`);
  assert.equal(r.outcome, "red", `看门狗杀 ⇒ fan-in red（不是落地）`);
  assert.equal(r.step, "suite", "失败步 = suite");

  // 台账存在（AC2 的核心：被杀的 writer 写不成，记录仍出现 ⇒ 写入点在活着的一侧）。
  assert.ok(fs.existsSync(ledger), "看门狗杀死的这一轮【必须】留下台账行（⛔ 一行都不写 = 本任务的病根）");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "一轮一行（⛔ 不双写：runner 已被杀，不可能也写一条）");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.evaluated, false, "NOT-EVALUATED：⛔ 不与「合格」同形（硬规则 3b）");
  assert.equal(rec.reason, "watchdog-killed", "reason 取独立值");
  assert.notEqual(rec.reason, "failed", "⛔ 「被杀」不是「跑了且红」的结论");
  assert.equal(rec.state, "red", "不是通过");
  assert.equal(rec.failures, undefined, "无失败信号可解析 ⇒ ⛔ 不写空 failures[]");
  assert.equal(rec.taskId, "gap-wdk-hung", "归属本轮任务");
  assert.equal(rec.runId, "mfi-wdk-hung-1", "runId = 本轮 per-suite runId");
  assert.match(String(rec.commit), /^[0-9a-f]{40}$/, "commit = 本轮 suite_head（40-hex）");

  // 「整组杀」这一前提的取证：孙进程必须也死了（⛔ 只杀直接子进程会留孙进程持管道/泄漏）。
  const gp = Number(fs.readFileSync(gpFile, "utf8").trim());
  assert.ok(Number.isInteger(gp) && gp > 0, "孙进程 pid 已落盘");
  await waitFor(() => { try { process.kill(gp, 0); return false; } catch { return true; } }, 15000);
  assert.ok(true, "孙进程被组 kill 收掉 ⇒ 被杀的是整组，而台账仍由【组外】的 driver 写下");
});
