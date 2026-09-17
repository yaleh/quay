// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/5 (9 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { EXITED_NOT_LANDED_EXIT, WORKER_OUTCOME_REL, after, assert, branchHeadSubject, buildContinueWorkerPrompt, buildWorkerPrompt, continueStateForTask, countBranchCommits, fs, isFfNotFastForwardFailure, lastExitedNotLandedReason, makeGitRoot, path, readAcCheckState, rmSafe, runDriver, runGit, runMechanicalFanIn, worktreePresentForTask } from "./helpers/worker-driver-resident-harness.mjs";

test("gap-fan-in-continue-prompt-not-migrated-to-mechanical — AC1: buildContinueWorkerPrompt is mechanical too (worker exits, driver takes over; ⛔ no fan-in-execute.js / generateRunId / scriptPath)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "worker exited 0 but task did not land",
  });
  // 续做 prompt 与创建 prompt 同源 driverFanInNote：worker 实现后退出、driver 接手机械跑 fan-in，
  // ⛔ 不再写旧 workflow 兜底签名（fan-in-execute.js / generateRunId / scriptPath）。
  assert.match(p, /exit — the worker-driver takes over/, "AC1: continue prompt also lets the driver take over fan-in");
  assert.match(p, /mechanically runs fan-in/, "AC1: names the mechanical fan-in");
  assert.match(p, /do NOT call the fan-in workflow/, "AC1: worker never calls the workflow (driver decision)");
  assert.doesNotMatch(p, /fan-in-execute\.js/, "⛔ no fan-in-execute.js path (workflow retired from the worker prompt)");
  assert.doesNotMatch(p, /generateRunId/, "⛔ no generateRunId (worker no longer dispatches the workflow)");
  assert.doesNotMatch(p, /scriptPath/, "⛔ no scriptPath placeholder");
  assert.match(p, /\/wt/, "continue prompt still embeds the concrete worktree path (reuse, not a placeholder)");
});


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


test("AC1/AC2/AC3 (能取假) — buildContinueWorkerPrompt encodes the merge-conflict resolution protocol (outline take-develop / code semantic-union / commit --no-edit)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at merge develop (CONFLICT in docs/proposals/quay-product-outline.md)",
  });
  // AC1 (指令存在): prompt names the conflict state (unmerged paths / CONFLICT) and the resolve action.
  assert.match(p, /(unmerged|CONFLICT)/, "AC1: prompt names the merge-conflict state (unmerged paths / CONFLICT)");
  assert.match(p, /resolve/, "AC1: prompt instructs the worker to resolve the conflict");
  assert.match(p, /never exit while unmerged paths remain/, "AC1: prompt forbids exiting with unmerged paths (next fan-in merge step would fail again)");
  // AC2 (outline 冲突取 develop 版): outline inventory conflict ⇒ take the develop version (git checkout develop), ⛔ no --write-inventory.
  assert.match(p, /git checkout develop/, "AC2: outline-doc conflict ⇒ take the develop version (git checkout develop)");
  assert.match(p, /take the develop version/, "AC2: outline-doc conflict ⇒ take the develop version (⛔ no recompute)");
  assert.doesNotMatch(p, /write-inventory/, "AC2: ⛔ no longer re-run the retired --write-inventory");
  assert.match(p, /do NOT hand-merge the counts/, "AC2: outline-doc conflict ⇒ ⛔ hand-merge the counts");
  // AC3 (code 并集 + commit): code conflict ⇒ semantic union + git commit --no-edit.
  assert.match(p, /semantic union/, "AC3: code-file conflict ⇒ take the semantic union of both sides");
  assert.match(p, /git commit --no-edit/, "AC3: complete the merge with git commit --no-edit");
});

// ── gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward ──────────────────────────────
// 冲突消解协议（gap-continue-prompt-conflict-resolution-protocol）只教 outline/code 两型；三型新暴露
// （硬规则 5b：修好一个 ≠ 没有别的）——dual-copy 文件冲突（.claude/workflows/* ↔ plugin/workflows/*
// 须字节一致，⛔ 语义并集会发散两副本）、ff-not-fast-forward（suite 长跑期间 develop 又进新落地 ⇒
// 任务分支落后 develop）、modify/delete（一侧删一侧改）。AC1/AC2/AC4 钉住 prompt 里三型消解指令，
// 删掉任一条 ⇒ 测试红（AC3 能取假）。


test("gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward — AC1/AC2/AC3/AC4 (能取假): buildContinueWorkerPrompt teaches dual-copy byte-identical sync / ff re-merge / modify-delete deletion-side", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at step=ff: CONFLICT (content): Merge conflict in .claude/workflows/fan-in-execute.js",
  });
  // AC1 (dual-copy): 冲突时两副本同步字节一致，⛔ 不语义并集（并集让两副本发散）。
  assert.match(p, /dual-copy/, "AC1: prompt names the dual-copy file type (.claude/workflows/* ↔ plugin/workflows/*)");
  assert.match(p, /byte-identical/, "AC1: dual-copy conflict ⇒ re-sync BOTH copies byte-identical");
  assert.match(p, /do NOT take a semantic union/, "AC1: dual-copy conflict ⇒ ⛔ not semantic union (would diverge the two copies)");
  // AC2 (ff): ff-not-fast-forward 时先 merge develop 再 ff，⛔ 不重实现。
  assert.match(p, /not fast-forward/, "AC2: prompt names the ff-not-fast-forward failure");
  assert.match(p, /merge develop again/, "AC2: ff-not-fast-forward ⇒ merge develop again before the driver re-runs ff");
  assert.match(p, /do NOT re-implement/, "AC2: ff-not-fast-forward ⇒ ⛔ no re-implementation (branch-lag, not a code defect)");
  // AC4 (modify/delete): 判删除侧——分支删（有替代实现）⇒ 接受删除 git rm；develop 删 ⇒ 接受删除 git rm。
  assert.match(p, /modify\/delete/, "AC4: prompt names the modify/delete conflict type");
  assert.match(p, /judge WHICH side deleted/, "AC4: modify/delete ⇒ judge which side deleted");
  assert.match(p, /git rm/, "AC4: modify/delete ⇒ accept the deletion with git rm");
  assert.match(p, /never silently restore the deleted file/, "AC4: ⛔ never revive the deleted file");
});
