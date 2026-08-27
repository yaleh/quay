// @test-group engine
// fan-in-driver-mechanical.test.mjs — gap-fan-in-driver-mechanical-orchestration
// (SPEC-fan-in-driver-mechanical-orchestration-2026-08-27): driver 机械驱动 fan-in 的机械部分
// （锁/merge/delta/typecheck/scoped门/suite/ff），suite 不 detach（driver 子进程 + 异步 poll），
// fan-in 锁机械包裹 suite 锁。取代 fan-in-execute.js workflow 子代理串行跑机械步骤（30min 模型延迟）。
//
// Coverage map (task ACs):
//   AC1（锁时长塌缩）— 一次机械 fan-in 的 workflow 锁持有时长 ≤ 机械时长（⛔ 不再 ~1800s 恒值），
//         显著低于 1800s 且与任务内容相关（fake suite 快 ⇒ 持有时长小）。
//   AC2（锁罩住 suite）— lock release epoch ≥ suite 结束 epoch（⛔ 不再「suite 跑在 release 之后」）。
//   AC3（无 detach）— suite 进程 ppid 指向 driver（⛔ 不是 setsid+&+disown 的孤儿 ppid=1）。
//   AC4（ff-race 归零）— 锁罩住 merge→suite→ff 整段 ⇒ 无 Diverging branches 重试；单次 acquire/release 对。
//   AC5（吞吐恢复）— 生产测量（⛔ 非 hermetic 可测）：AC1 的锁时长塌缩是吞吐恢复的机制前提。
//
// Run:
//   scripts/test.sh plugin/test/fan-in-driver-mechanical.test.mjs
//   node --test plugin/test/fan-in-driver-mechanical.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runMechanicalFanIn, readWorkflowLockHold } from "../scripts/worker-driver.ts";
import { spawnSuiteAndWait } from "../scripts/suite-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "plugin", "scripts");
const SLOT_LIB = path.join(SCRIPTS_DIR, "suite-slot-lib.sh");

const TASK = "gap-mf-mech";

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
    const status = git(repo, "rev-parse", "HEAD").stdout.trim();
    assert.equal(develop, status, "develop checkout must be at the landed tip");
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
    const lock = readWorkflowLockHold(repo, TASK, "mf-run-1");
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
    // 锁在任一退出路径都 release（finally）⇒ 后续可再 acquire。
    const re = spawnSync("bash", [path.join(SCRIPTS_DIR, "fan-in-ff-merge.sh"), "--task", TASK, "--root", repo, "--run-id", "mf-run-red-2", "--acquire-workflow-lock"], { encoding: "utf8" });
    assert.equal(re.status, 0, `post-red re-acquire must succeed (lock was released): ${re.stdout}${re.stderr}`);
    spawnSync("bash", [path.join(SCRIPTS_DIR, "fan-in-ff-merge.sh"), "--task", TASK, "--root", repo, "--release-workflow-lock"], { encoding: "utf8" });
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
