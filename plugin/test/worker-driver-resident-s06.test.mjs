// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/8 (6 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { EXITED_NOT_LANDED_EXIT, WORKER_OUTCOME_REL, after, assert, branchHeadSubject, buildContinueWorkerPrompt, buildWorkerPrompt, continueStateForTask, countBranchCommits, fs, isFfNotFastForwardFailure, lastExitedNotLandedReason, makeGitRoot, path, readAcCheckState, rmSafe, runDriver, runGit, runMechanicalFanIn, worktreePresentForTask } from "./helpers/worker-driver-resident-harness.mjs";

test("gap-fan-in-continue-prompt-not-migrated-to-mechanical — AC2: cold-start orphan (worktree present, no mechanical_fan_in record) routes to mechanical fan-in, ⛔ not the workflow", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 0,
    branchHeadSubject: null,
    acChecked: null,
    acTotal: null,
    failureReason: null, // 冷启动孤儿：worker-outcome 对该 task 无 exited-not-landed 记录 ⇒ 无 mechanical_fan_in
  });
  assert.match(p, /\(unknown\)/, "cold-start orphan: no prior failure record ⇒ (unknown)");
  assert.match(p, /exit — the worker-driver takes over/, "AC2: still mechanical (driver re-runs fan-in), ⛔ not the workflow");
  assert.doesNotMatch(p, /fan-in-execute\.js/, "AC2: no workflow mis-routing");
});


test("gap-fan-in-continue-prompt-not-migrated-to-mechanical — AC3: workflow fallback is the driver's decision, never written into the worker prompt (both create and continue)", () => {
  // 语义兜底归 driver（runMechanicalFanIn 返回 red 时按 step 唤起语义会话），⛔ 不把「调 workflow」
  // 写进 worker prompt——创建与续做两条 prompt 都不含调 workflow 的指令。
  const create = buildWorkerPrompt("gap-x", "/r");
  const cont = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at typecheck",
  });
  for (const [label, p] of [["create", create], ["continue", cont]]) {
    assert.doesNotMatch(p, /Workflow tool/, `AC3: ${label} prompt never says to call the Workflow tool`);
    assert.doesNotMatch(p, /fan-in-execute\.js/, `AC3: ${label} prompt has no workflow script path`);
    assert.match(p, /do NOT call the fan-in workflow/, `AC3: ${label} prompt explicitly forbids calling the workflow`);
  }
});


test("AC1 (能取假) — buildContinueWorkerPrompt wires dispatch-worktree-setup.sh on the reused worktree (idempotent re-provision)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "worker exited 0 but task did not land",
  });
  assert.match(p, /dispatch-worktree-setup\.sh/, "AC1: continue prompt names the setup script");
  assert.match(p, /dispatch-worktree-setup\.sh \/wt/, "AC1: continue prompt re-provisions the concrete worktree path");
  assert.doesNotMatch(p, /create an isolated git worktree/, "AC1: continue prompt never says create");
});


test("AC2 — continueStateForTask gathers real state (own branch commits / AC checkboxes / last exited-not-landed reason)", (t) => {
  const root = makeGitRoot("continue-state");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-cs2"]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });

  // task file with an AC section: 2 checked / 3 total.
  const body = `---\nid: gap-cs2\nstatus: ready\n---\n\n## Proposal\n\nbody\n\n## Acceptance Criteria\n\n- [x] AC1 done\n- [ ] AC2 todo\n- [x] AC3 done\n`;
  fs.writeFileSync(path.join(root, "tasks", "gap-cs2.md"), body);
  runGit(root, ["add", "tasks/gap-cs2.md"]);
  runGit(root, ["commit", "-q", "-m", "task gap-cs2"]);

  // prior round's own commit on the task branch (HEAD..task/<id> must count exactly this, not the whole history).
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs2", wtPath]);
  fs.writeFileSync(path.join(wtPath, "impl.txt"), "implemented");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "implement gap-cs2"]);

  // prior round's outcome record (exited-not-landed with a reason).
  fs.appendFileSync(
    path.join(root, WORKER_OUTCOME_REL),
    JSON.stringify({ ts: new Date().toISOString(), task: "gap-cs2", final_state: "exited-not-landed", failure_reason: "worker exited 0 but task did not land (status≠done or leftover worktree)" }) + "\n",
    "utf8",
  );

  assert.equal(readAcCheckState(root, "gap-cs2").checked, 2, "AC checkboxes: 2 checked");
  assert.equal(readAcCheckState(root, "gap-cs2").total, 3, "AC checkboxes: 3 total");
  assert.equal(countBranchCommits(root, "gap-cs2"), 1, "own commits only (HEAD..task/<id> = 1, ⛔ not whole history)");
  assert.equal(branchHeadSubject(root, "gap-cs2"), "implement gap-cs2", "branch head subject = the prior round's own commit");
  assert.match(lastExitedNotLandedReason(root, "gap-cs2"), /did not land/, "last exited-not-landed reason read from outcome");

  const st = continueStateForTask(root, "gap-cs2");
  assert.ok(st != null, "continue state gathered for preserved worktree");
  assert.equal(st.worktreePath, wtPath, "state carries the worktree path");
  assert.equal(st.branchCommits, 1, "state carries own commit count");
  assert.equal(st.acChecked, 2, "state carries AC checked");
  assert.equal(st.acTotal, 3, "state carries AC total");
  assert.match(st.failureReason, /did not land/, "state carries failure reason");
});

// ── gap-continue-cycle-misses-ff-not-fast-forward-redispatch ─────────────────────────────────────
// 机械 fan-in 的 ff 步「not a fast-forward」= develop 前进、分支滞后（⛔ 非代码缺陷）——continue-cycle
// 须把它识别为 transient 续做态（不计重试上限、继续 CONTINUE 重派），而非与真缺陷同形计上限误标
// needs-human（3 次含 2 次 ff 滞后 ⇒ 静置不派，2026-08-30 实况需人手动救回）。


test("AC2 (能取假) — isFfNotFastForwardFailure: step=ff + 'not a fast-forward' ⇒ transient continue（不计重试上限）；改 step 或 reason 任一 ⇒ 红", () => {
  const ffOutcome = {
    final_state: "exited-not-landed",
    mechanical_fan_in: {
      outcome: "red",
      step: "ff",
      reason: "fan-in-ff-merge: FF FAILED — To .; not a fast-forward. Retry record written (attempt 1).",
    },
  };
  assert.equal(
    isFfNotFastForwardFailure(ffOutcome),
    true,
    "step=ff + 'not a fast-forward' ⇒ transient（识别为续做，⛔ 不计重试上限）",
  );

  // 改 step（suite red）⇒ 不再是 transient（真缺陷，计上限）。
  assert.equal(
    isFfNotFastForwardFailure({ final_state: "exited-not-landed", mechanical_fan_in: { outcome: "red", step: "suite", reason: "suite red" } }),
    false,
    "step=suite ⇒ 真缺陷（计上限）",
  );

  // 改 reason（ff 步但防活锁 escalation）⇒ 不再是 transient（真缺陷，计上限）。
  assert.equal(
    isFfNotFastForwardFailure({ final_state: "exited-not-landed", mechanical_fan_in: { outcome: "red", step: "ff", reason: "fan-in-ff-merge: FF FAILED (attempt 3 >= 3) — ANTI-LIVELOCK … Do NOT auto-retry" } }),
    false,
    "step=ff + 防活锁 escalation ⇒ 真缺陷（计上限）",
  );

  // 无 mechanical_fan_in（非机械 fan-in 失败）/ 读不懂 ⇒ fail-closed false（计上限，⛔ 不漏判真缺陷）。
  assert.equal(
    isFfNotFastForwardFailure({ final_state: "exited-not-landed", failure_reason: "worker exited 0 but task did not land" }),
    false,
    "无 mechanical_fan_in ⇒ fail-closed 计上限",
  );
  assert.equal(isFfNotFastForwardFailure(null), false, "null ⇒ false");
});


test("AC1 (integration, 复现) — re-dispatch of an exited-not-landed task passes the CONTINUE prompt to the worker (reuse, ⛔ create)", (t) => {
  const root = makeGitRoot("continue-e2e");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  const capOut = path.join(root, "..", `captured-prompt-${path.basename(root)}.txt`);
  const capScript = path.join(root, "..", `capture-prompt-${path.basename(root)}.sh`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-ce"]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
    rmSafe(capOut);
    rmSafe(capScript);
  });

  // task file with an AC section (1 checked / 2 total).
  const body = `---\nid: gap-ce\nstatus: ready\n---\n\n## Proposal\n\nbody\n\n## Acceptance Criteria\n\n- [x] AC1 done\n- [ ] AC2 todo\n`;
  fs.writeFileSync(path.join(root, "tasks", "gap-ce.md"), body);
  runGit(root, ["add", "tasks/gap-ce.md"]);
  runGit(root, ["commit", "-q", "-m", "task gap-ce"]);

  // prior exited-not-landed round: worktree + branch + one own commit + an outcome record.
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-ce", wtPath]);
  fs.writeFileSync(path.join(wtPath, "impl.txt"), "implemented");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "implement gap-ce"]);
  fs.appendFileSync(
    path.join(root, WORKER_OUTCOME_REL),
    JSON.stringify({ ts: new Date().toISOString(), task: "gap-ce", final_state: "exited-not-landed", failure_reason: "worker exited 0 but task did not land (status≠done or leftover worktree)" }) + "\n",
    "utf8",
  );

  // capture the prompt the driver actually passes to the worker (--worker-cmd prefix appends it as the last arg).
  fs.writeFileSync(capScript, `#!/bin/sh\nprintf '%s' "$1" > "${capOut}"\nexit 0\n`);
  fs.chmodSync(capScript, 0o755);

  let code = 0;
  try {
    runDriver(root, ["--task", "gap-ce", "--worker-cmd", `bash ${capScript}`]);
  } catch (e) {
    code = e.status;
  }

  // worker exit 0 + status≠done ⇒ exited-not-landed (the exact re-dispatch scenario; worktree preserved).
  assert.equal(code, EXITED_NOT_LANDED_EXIT, "exit 0 + status≠done ⇒ driver exit 3 (exited-not-landed, worktree preserved)");

  const prompt = fs.readFileSync(capOut, "utf8");
  assert.match(prompt, /CONTINUE \(reuse/, "AC1: the re-dispatched worker got the CONTINUE prompt");
  assert.doesNotMatch(prompt, /create an isolated git worktree/, "AC1: ⛔ continue prompt must not say create (create ⇒ git worktree add fatal)");
  assert.match(prompt, /1 commits/, "AC2: carries branch commit count");
  assert.match(prompt, /checked 1\/2/, "AC2: carries AC check state");
  assert.match(prompt, /exited-not-landed because: worker exited 0 but task did not land/, "AC2: carries failure reason");
  assert.equal(worktreePresentForTask(root, "gap-ce"), true, "worktree still preserved after re-dispatch (⛔ not cleaned)");
});

// ── gap-continue-prompt-conflict-resolution-protocol ────────────────────────────────────────────────
// 机械 fan-in 的 merge develop 步在 CONTINUE 轮撞冲突时，旧 prompt 只带失败原因、不含消解指令 ⇒
// 消冲突靠 worker 自行发挥（运气）。AC1（指令存在）/ AC2（outline 冲突取 develop 版）/ AC3（code 语义
// 并集 + git commit --no-edit）钉住 prompt 里三类消解指令，删掉任一条 ⇒ 测试红（AC4 能取假）。
