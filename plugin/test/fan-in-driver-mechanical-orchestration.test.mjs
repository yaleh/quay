// @test-group engine
// fan-in-driver-mechanical-orchestration.test.mjs — gap-fan-in-driver-mechanical-orchestration
// (SPEC-fan-in-driver-mechanical-orchestration-2026-08-27): driver 机械驱动 fan-in 的机械部分
// （锁/merge/delta/typecheck/scoped门/suite/ff），suite 不 detach（driver 子进程 + 异步 poll），
// fan-in 锁机械包裹 suite 锁。取代 fan-in-execute.js workflow 子代理串行跑机械步骤（30min 模型延迟）。
//
// Coverage map (task ACs):
//   AC1（锁时长塌缩）— 一次机械 fan-in 的 fan-in 锁持有时长 ≤ 机械时长（⛔ 不再 ~1800s 恒值），
//         显著低于 1800s 且与任务内容相关（fake suite 快 ⇒ 持有时长小）。
//   AC2（锁罩住 suite）— lock release epoch ≥ suite 结束 epoch（⛔ 不再「suite 跑在 release 之后」）。
//   AC3（无 detach）— suite 进程 ppid 指向 driver（⛔ 不是 setsid+&+disown 的孤儿 ppid=1）。
//   AC4（ff-race 归零）— 锁罩住 merge→suite→ff 整段 ⇒ 无 Diverging branches 重试；单次 acquire/release 对。
//   AC5（吞吐恢复）— 生产测量（⛔ 非 hermetic 可测）：AC1 的锁时长塌缩是吞吐恢复的机制前提。
//
// Run:
//   scripts/test.sh plugin/test/fan-in-driver-mechanical-orchestration.test.mjs
//   node --test plugin/test/fan-in-driver-mechanical-orchestration.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runMechanicalFanIn, readFanInLockHold, acquireFanInLock } from "../scripts/worker-driver.ts";
import { spawnSuiteAndWait } from "../scripts/suite-driver.ts";
import { runAsync } from "../scripts/driver-runtime.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "plugin", "scripts");
const SLOT_LIB = path.join(SCRIPTS_DIR, "suite-slot-lib.sh");
const DRIVER_SRC = path.join(SCRIPTS_DIR, "worker-driver.ts");
const RUNTIME_SRC = path.join(SCRIPTS_DIR, "driver-runtime.ts");

const TASK = "gap-mf-mech";
const HOLDER_TASK = "gap-mf-holder";

function git(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mechfanin-${prefix ?? ""}-`));
}

function taskBody() {
  return [
    "---",
    `id: ${TASK}`,
    "title: mechanical fan-in test",
    "status: ready",
    "labels: []",
    "extra: {}",
    "---",
    "## Proposal",
    "test",
    "## Plan",
    "test",
    "## Touches",
    "- docs/feature.md",
    "## Acceptance Criteria",
    "- [x] AC1 landed",
    "## Definition of Done",
    "- [x] landed",
    "",
  ].join("\n");
}

/** 建一个 hermetic 仓库 + task worktree：develop 上有 task 文件（status: ready + Touches + AC 全勾），
 *  worktree 分支 task/<id> 上有一个实现提交（docs/feature.md）。返回 { repo, worktree, slotBase, capture }。 */
function makeRepoWithWorktree() {
  const base = makeTmp("repo");
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "mechfanin-test");
  git(repo, "config", "user.email", "mf@example.com");
  git(repo, "branch", "-M", "develop");
  // scripts/test.sh（classify-delta 读 registry；空 registry ⇒ tasks/、docs/ 判 doc）。
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tasks", `${TASK}.md`), taskBody(), "utf8");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "worktree", "add", worktree, "-b", `task/${TASK}`);
  // develop 脱离主检出（gap-fan-in-ff-ref-update-detach-develop）：主检出改停 doc-only 工作分支，使
  // ff 退化为纯 ref 更新（git push .）——develop 不再被任何检出占用。
  git(repo, "checkout", "-q", "-b", "develop-work");
  // 实现提交：docs/feature.md（非 .ts ⇒ typecheck 闸直放行；doc 面 ⇒ classify 判 doc-only）。
  fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "docs", "feature.md"), "# feature\n", "utf8");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-q", "-m", "implement feature");
  const slotBase = path.join(base, "full-suite.lock");
  const capture = path.join(base, "suite.env");
  return { base, repo, worktree, slotBase, capture };
}

/** 一次干净的机械 fan-in 成功路径（AC1/AC2/AC4 共用）。 */
function runHappyPath(opts = {}) {
  const { base, repo, worktree, slotBase, capture } = makeRepoWithWorktree();
  const runId = opts.runId ?? "mf-run-1";
  const suiteLog = path.join(base, "suite.log");
  return runMechanicalFanIn({
    task: TASK,
    worktree,
    root: repo,
    runId,
    mergeTarget: "develop",
    forceSuite: true,
    scriptsDir: SCRIPTS_DIR,
    slotBase,
    slotLib: SLOT_LIB,
    silenceMs: 5000,
    suiteCapture: capture,
    suiteLogFile: suiteLog,
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
  }).then((r) => ({ r, repo, worktree, base, capture }));
}

// ── AC1 + AC2 + AC4：happy-path 机械 fan-in 落地 + 锁时长塌缩 + 锁罩住 suite + 无 ff 重试 ─────────

test("AC1/AC2/AC4 — 机械 fan-in 落地：锁持有时长 ≤ 机械时长（⛔ 非 ~1800s）、release ≥ suite 结束、无 Diverging branches 重试", async () => {
  const { r, repo, base } = await runHappyPath();
  try {
    assert.equal(r.outcome, "landed", `mechanical fan-in must land (step=${r.step} reason=${r.reason})`);
    assert.equal(r.suiteOutcome, "done", "suite must be done");
    // 落地直接量：develop ff 到 task tip + status done + 无残留 worktree。
    const develop = git(repo, "rev-parse", "develop").stdout.trim();
    assert.equal(develop, r.landedSha, "develop must be at the landed sha");
    // develop 脱离主检出：主检出停在 doc-only 工作分支（⛔ 不是 develop）——ff 是纯 ref 更新，不碰工作树。
    const checkoutBranch = git(repo, "branch", "--show-current").stdout.trim();
    assert.equal(checkoutBranch, "develop-work", "main checkout must be on the doc-only work branch, NOT develop (the ff is a ref update)");
    assert.notEqual(git(repo, "rev-parse", "HEAD").stdout.trim(), develop, "the work branch HEAD is NOT the landed tip (develop moved without touching the checkout)");
    assert.equal(git(repo, "worktree", "list", "--porcelain").stdout.includes(`task/${TASK}`), false, "worktree must be removed after landing");

    // AC1（能取假，锁时长塌缩）：持有时长显著低于 1800s（旧 30min watchdog 恒值），且 > 0（真持锁）。
    assert.ok(r.lockHoldSecs !== null && r.lockHoldSecs > 0, `lock hold must be a positive number, got ${r.lockHoldSecs}`);
    assert.ok(r.lockHoldSecs < 60, `lock hold must collapse to mechanical scale (<60s), got ${r.lockHoldSecs}s (⛔ not ~1800s)`);

    // AC2（能取假，锁罩住 suite）：release epoch ≥ suite 结束 epoch（⛔ 不再「suite 跑在 release 之后」）。
    assert.ok(r.lockReleaseEpoch !== null && r.suiteFinishedEpoch !== null, "release + suite-finish epochs must both be recorded");
    assert.ok(r.lockReleaseEpoch >= r.suiteFinishedEpoch, `lock release ${r.lockReleaseEpoch} must be ≥ suite finish ${r.suiteFinishedEpoch}`);

    // AC4（能取假，ff-race 归零）：无 retry 记录（fan-in-retries.jsonl 无 Diverging branches）。
    const retries = path.join(repo, ".quay", "fan-in-retries.jsonl");
    assert.equal(fs.existsSync(retries), false, "no retry record for a clean mechanical fan-in");

    // 反例判据（SPEC §6）负控制：锁事件恰一对 acquire→release（无二次 acquire / 无 watchdog 强制释放）。
    const lock = readFanInLockHold(repo, TASK, "mf-run-1");
    assert.ok(lock.lockAcquireEpoch !== null && lock.lockReleaseEpoch !== null, "exactly one acquire+release pair must exist");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── AC3：suite 是 driver 子进程（ppid 指向 driver，⛔ 非 setsid+&+disown 孤儿）────────────────────

test("AC3（能取假）— suite 进程 ppid 指向 driver（spawn+wait），⛔ 非孤儿 ppid=1", async () => {
  const base = makeTmp("ac3");
  const slotBase = path.join(base, "full-suite.lock");
  const ppidFile = path.join(base, "suite-ppid.txt");
  try {
    // runMechanicalFanIn 用 spawnSuiteAndWait 跑 suite（spawn+wait，⛔ setsid+&+disown）。fake suite 把自己的
    // $PPID 写进文件——它是 slot-holder bash exec 后的同一进程，其父 = 本测试进程（= driver）。
    const sr = await spawnSuiteAndWait({
      slotBase,
      slotLib: SLOT_LIB,
      suiteCommand: ["bash", "-c", `echo $PPID > "${ppidFile}"; sleep 0.2`],
      logFile: null,
      silenceMs: 3000,
    });
    assert.equal(sr.outcome, "done");
    const ppid = Number(fs.readFileSync(ppidFile, "utf8").trim());
    assert.equal(ppid, process.pid, `suite ppid ${ppid} must be the driver process (this test process pid ${process.pid})`);
    assert.notEqual(ppid, 1, "suite must NOT be a setsid+disown orphan (ppid=1)");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── 失败路径（反例判据的方向）：suite 红 ⇒ 机械 fan-in red（不落地），锁仍被 release ─────────────

test("suite 红 ⇒ 机械 fan-in red（step=suite），不落地、锁仍 release（finally 释放）", async () => {
  const { base, repo, worktree, slotBase, capture } = makeRepoWithWorktree();
  const runId = "mf-run-red";
  const suiteLog = path.join(base, "suite.log");
  try {
    const r = await runMechanicalFanIn({
      task: TASK,
      worktree,
      root: repo,
      runId,
      mergeTarget: "develop",
      forceSuite: true,
      scriptsDir: SCRIPTS_DIR,
      slotBase,
      slotLib: SLOT_LIB,
      silenceMs: 5000,
      suiteCapture: capture,
      suiteLogFile: suiteLog,
      suiteCommand: ["bash", "-c", "echo failing; exit 3"],
      scopedGateCommand: ["true"],
      docCheckCommand: ["true"],
    });
    assert.equal(r.outcome, "red");
    assert.equal(r.step, "suite");
    // 不落地：task 分支仍在、worktree 仍在（red 不清理）。
    assert.equal(git(repo, "worktree", "list", "--porcelain").stdout.includes(`task/${TASK}`), true, "red path must NOT remove the worktree");
    // 锁在任一退出路径都 release（finally）⇒ release 事件已写（干净 acquire→release 对，ADR-034 holder
    // 在 driver 关 stdin 写端后写 release 事件）。读事件文件判据（⛔ 非 re-acquire——re-acquire 若锁未释放
    // 会阻塞在 flock 上把测试挂死）。
    const lock = readFanInLockHold(repo, TASK, runId);
    assert.ok(lock.lockAcquireEpoch !== null && lock.lockReleaseEpoch !== null, "red path must release the lock (finally) — clean acquire+release pair in the events file");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── merge 冲突 ⇒ 机械 fan-in red（step=merge-develop），锁仍 release ────────────────────────────

test("merge develop 冲突 ⇒ 机械 fan-in red（step=merge-develop），锁仍 release", async () => {
  const { base, repo, worktree, slotBase, capture } = makeRepoWithWorktree();
  const runId = "mf-run-conflict";
  try {
    // 让 develop 前进且与 task 分支改同一文件 ⇒ merge 冲突。
    git(repo, "checkout", "-q", "develop");
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs", "feature.md"), "# develop-side conflicting change\n", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "develop advances on the same file");
    git(repo, "checkout", "-q", `task/${TASK}`);

    const r = await runMechanicalFanIn({
      task: TASK,
      worktree,
      root: repo,
      runId,
      mergeTarget: "develop",
      forceSuite: true,
      scriptsDir: SCRIPTS_DIR,
      slotBase,
      slotLib: SLOT_LIB,
      silenceMs: 5000,
      suiteCapture: capture,
      suiteLogFile: path.join(base, "suite.log"),
      suiteCommand: ["bash", "-c", "exit 0"],
      scopedGateCommand: ["true"],
      docCheckCommand: ["true"],
    });
    assert.equal(r.outcome, "red");
    assert.equal(r.step, "merge-develop");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── gap-mech-fan-in-acquire-lock-timeout-queue-semantics：acquire 步 120s 超时去掉（排队语义）─────
// fan-in 锁是正确性锁（fan-in-ff-merge.sh:203 unbounded `flock -x`），排队等待正是它存在的意义；
// 机械 fan-in 首步 acquire 被套 120s kill 会在「排队等待」时误杀（首个生产任务排第 2 位即被杀）。
// 修法 = acquire 步 unbounded（Infinity），死持有者由锁内 1800s watchdog 兜底，不靠 driver 侧 SIGKILL。

// AC1（能取假，结构面）：acquire 步不再传 120_000，改传 Infinity（unbounded）。结构断言是唯一能在
// 不真等 120s 的前提下取假的判据——排队等待时长本身不是可注入的 seam（120s 是硬编码字面量）。
test("AC1 (gap-mech-fan-in-acquire-lock-timeout-queue-semantics, ADR-034 修订) — acquire 步无超时：driver 经非分离 holder 持锁（flock -x 无 -w），⛔ 无 --acquire-fan-in-lock 分离 holder、⛔ 无 120s 短超时", () => {
  const src = fs.readFileSync(DRIVER_SRC, "utf8");
  // ADR-034：acquire 不再经 fan-in-ff-merge.sh --acquire-fan-in-lock（分离 holder + flag 协议已废除）。
  // ⛔ 散文注释可合法提及被废除的 flag 名；本断言查【argv 字符串字面量】形态（`--acquire-fan-in-lock"`，
  // 带闭引号）——只有真调用会带闭引号，注释不会。
  assert.doesNotMatch(src, /--acquire-fan-in-lock"/, "no argv carries the --acquire-fan-in-lock flag (detached-holder protocol abolished)");
  assert.match(src, /acquireFanInLock/, "runMechanicalFanIn must acquire via the driver-side non-detached holder");
  // holder 的 flock 无 -w（unbounded）——fan-in 锁是正确性锁，排队等待正是它存在的意义（⛔ 无超时）。
  assert.match(src, /flock -x "\$fd"/, "holder flock must be unbounded (no -w)");
  assert.doesNotMatch(src, /flock -x -w "\$fd"/, "holder flock must NOT carry a bounded wait");
  // 其余机械步骤仍是有限时长步骤（超时照旧，⛔ 不把「去掉短超时」误扩成「去掉所有超时」）。
  assert.match(src, /mechSh\(\["git", "-C", worktree, "merge", "--no-edit", mergeTarget\], 120_000\)/, "merge-develop step keeps its finite timeout");
  assert.match(src, /mechSh\(\["node", "--experimental-strip-types", typecheck, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget\], 120_000\)/, "typecheck step keeps its finite timeout");
  // runAsync 对 Infinity 显式不设 SIGKILL timer（⛔ setTimeout(…, Infinity) → Node 压到 1ms 立即杀的 footgun）。
  const rt = fs.readFileSync(RUNTIME_SRC, "utf8");
  assert.match(rt, /if \(Number\.isFinite\(timeoutMs\)\)\s*\{\s*\n\s*timer = setTimeout\(/, "runAsync guards the SIGKILL timer behind Number.isFinite(timeoutMs) — Infinity ⇒ no timer");
});

// AC2 机制（排队语义，能取假）：排在持有者之后的机械 fan-in 排队等待、不 red at step 1，持有者释放后落地。
test("AC2 机制 (gap-mech-fan-in-acquire-lock-timeout-queue-semantics) — 排在持有者之后的机械 fan-in 排队等锁、不 red at step 1，释放后落地", async () => {
  const { base, repo, worktree, slotBase, capture } = makeRepoWithWorktree();
  const runId = "mf-run-queued";
  const suiteLog = path.join(base, "suite.log");
  let holderLock = null;
  try {
    // 持有者（position 1）先 acquire fan-in 锁并保持（driver 经非分离 holder 持锁，ADR-034）。
    holderLock = await acquireFanInLock({ root: repo, task: HOLDER_TASK, runId: "holder-run" });

    // 机械 fan-in（position 2）排队：其 holder 在 flock 上排队，等持有者释放后落地。⛔ 若 acquire 步仍是
    // 短超时，这里 1.5s 的排队不会触发它（1.5s ≪ 短超时）——本测试单独不取假，取假靠 AC1 的结构断言；
    // 本测试证明机制端到端通（排队→等→落地，不 red at step 1、不 exit null）。
    const pending = runMechanicalFanIn({
      task: TASK, worktree, root: repo, runId, mergeTarget: "develop", forceSuite: true,
      scriptsDir: SCRIPTS_DIR, slotBase, slotLib: SLOT_LIB, silenceMs: 5000,
      suiteCapture: capture, suiteLogFile: suiteLog,
      suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
      scopedGateCommand: ["true"], docCheckCommand: ["true"],
    });

    // 让机械 fan-in 的 acquire 先进入排队（此刻 blocked 在 flock 上，未落地）。
    await new Promise((r) => setTimeout(r, 1500));

    // 释放持有者 ⇒ 机械 fan-in 的 holder 获得锁，继续 merge→…→ff 并落地。
    await holderLock.release();
    holderLock = null;

    const r = await pending;
    assert.equal(r.outcome, "landed", `queued mechanical fan-in must land after the holder releases (step=${r.step} reason=${r.reason})`);
  } finally {
    // 兜底释放持有者（测试中途失败也不留一个永睡的非分离 holder 进程）。
    if (holderLock) { try { await holderLock.release(); } catch { /* best-effort */ } }
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// runAsync(Infinity) 正向：无超时 ⇒ 子进程正常跑完（⛔ 不是 setTimeout(…, Infinity) → 1ms 立即 SIGKILL）。
test("runAsync(Infinity) — 无超时：子进程正常跑完（⛔ 不是 1ms 立即 SIGKILL 的 footgun）", async () => {
  const r = await runAsync(["sleep", "0.3"], { timeoutMs: Infinity, collectStderr: true });
  assert.equal(r.status, 0, `Infinity must mean no timeout (child completes), got status=${r.status}`);
  assert.equal(r.error, null, `no error for an unbounded completed child, got ${r.error?.message}`);
});

// 短超时负控制：有限超时仍 SIGKILL——证明「去掉 acquire 短超时」不是「全局禁掉超时」，AC1 的
// 结构断言取假所依赖的超时机制本身仍在工作。
test("短超时负控制 — runAsync 有限超时仍 SIGKILL（⛔ 超时机制未整体失效）", async () => {
  const t0 = Date.now();
  const r = await runAsync(["sleep", "5"], { timeoutMs: 150, collectStderr: true });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, null, `SIGKILLed child must have null status, got ${r.status}`);
  assert.ok(r.error && /spawn timeout after 150ms/.test(r.error.message), `finite timeout must SIGKILL with 'spawn timeout', got ${r.error?.message}`);
  assert.ok(elapsed < 4000, `killed well before the 5s sleep would finish (elapsed=${elapsed}ms)`);
});
