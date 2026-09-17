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

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 9/10 (9 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, assert, cleanup, fixScopeGateBlockFor, fs, makeFixScopeDir, path, promptContaining, runBash, runWorkflow } from "./helpers/fan-in-execute-paths-harness.mjs";

test("fix-scope REAL leak-residual — a tmux-leak-scan: FAIL on a LATER line of the multi-line log (with no per-file failure) ⇒ outOfScope leak-residual (never fixed as a Touches regression)", async (t) => {
  const task = "gap-test-fixscope-leak";
  const dir = makeFixScopeDir("fan-in-fixscope-leak-", task, "---\nid: gap-test-fixscope-leak\nstatus: ready\n---\n## Touches\n- tasks/gap-test-fixscope-leak.md\n- pkg/a/**\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  // gap-fan-in-leak-fail-regex-missing-m-flag (AC1/AC2): the gate tests TMUX_LEAK_FAIL_RE against
  // the WHOLE multi-line logText, not one line. Put the FAIL on a LATER line — without the `m`
  // flag `^` anchors only to string start and this would be misclassified (leak-residual dead
  // code). A normal passing line above it keeps this a real multi-line-log reproduction.
  fs.writeFileSync(log, "✔ some passing test (1.2ms)\ntmux-leak-scan: FAIL\nresidual tmux server skv-1234\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  const verdict = JSON.parse(m[1]);
  assert.deepEqual(verdict.inScope, [], "no per-file failure ⇒ no inScope fix");
  assert.ok(verdict.outOfScope.some((f) => f.reason === "leak-residual"), "tmux-leak residual must be outOfScope (env residual, not a Touches regression)");
});


test("fix-scope NEGATIVE control — a PASSING '✔'-prefixed test whose NAME quotes `tmux-leak-scan: FAIL` must NOT be classified leak-residual (^ anchor; gap-fan-in-execute-tmux-leak-scan-unanchored AC2)", async (t) => {
  const task = "gap-test-fixscope-leak-neg";
  const dir = makeFixScopeDir("fan-in-fixscope-leakneg-", task, "---\nid: gap-test-fixscope-leak-neg\nstatus: ready\n---\n## Touches\n- tasks/gap-test-fixscope-leak-neg.md\n- pkg/a/**\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  // The runner's own AC5 e2e NAME quotes the `tmux-leak-scan: FAIL` shape; as a PASSING line it is
  // `✔`-prefixed, so the unanchored `/tmux-leak-scan: FAIL/` used to match it and trigger a phantom
  // leak-residual on every suite-fix relaunch. Only a column-0 REAL residual is leak-residual.
  fs.writeFileSync(log, "✔ AC5 e2e — a 'tmux-leak-scan: FAIL' residual line flips red\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.ok(!verdict.outOfScope.some((f) => f.reason === "leak-residual"), "a PASSING '✔'-prefixed test whose NAME quotes `tmux-leak-scan: FAIL` must NOT be leak-residual (only a column-0 REAL residual is)");
});

// ── fix-scope gate release persistence（gap-fix-scope-gate-release-not-persistent）───────────────────
// THE DEFECT: 上一版 gate 的 load-sensitive release 是一次性 relaunch——relaunch 后仍红，第二轮
// suite-fix 不再走 release、直接越界修（a76959c8 session-liveness teardown 第 9+ 例）。release 无跨
// 轮持久状态 ⇒ 第二轮 agent 无记忆、把「隔离重跑确认」读成「重跑后仍红就该修」。FIX：gate 把每个
// load-sensitive 红的连续 release 轮数 releasedRounds 持久化到 fix_scope_release ledger，第二轮读到
// 递增；内联 prompt 显式写「releasedRounds ≥ 1 的 load-sensitive 红一律继续 release，⛔ 不得转 fix」。
// 负控制（AC2/AC3）：同一 load-sensitive 红 run 两轮 gate（relaunch-fail 路径）⇒ 两轮都 release、
// 零越界 fix。取假：把「第二轮仍 release」改成「第二轮转 fix」（删 ledger 读 / 把 load-sensitive
// 挪进 inScope / releasedRounds 不递增）⇒ 测试红。


test("fix-scope release persistence wiring — relaunch-fail 2nd suite-fix prompt still carries the idempotent-release instruction", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-fixscope-persist-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-fixscope-persist-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 3 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },                 // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                           // stage 2: RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive 释放（第1轮）" },              // fix round 1: release
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                           // stage 2 re-dispatched: STILL RED (relaunch-fail)
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive 释放（第2轮，幂等持久）" },      // fix round 2: STILL release
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched: green
    ],
  });
  const fixPrompts = prompts.filter((p) => p.includes("suite-fix 阶段"));
  assert.equal(fixPrompts.length, 2, "relaunch-fail must emit TWO suite-fix prompts (round 1 + round 2)");
  const round2 = fixPrompts[1];
  assert.ok(round2.includes("# fix-scope-gate-block-start"), "round-2 fix prompt must still carry the gate");
  assert.ok(round2.includes("幂等持久"), "round-2 fix prompt must carry the idempotent-persistent instruction");
  assert.ok(round2.includes("不得转 fix"), "round-2 fix prompt must forbid converting release → fix");
  assert.ok(round2.includes("releasedRounds"), "round-2 fix prompt must carry the releasedRounds counter");
});


test("fix-scope release persistence — relaunch-fail path: same load-sensitive red releases on BOTH rounds (releasedRounds increments, zero越界 fix)", async (t) => {
  const task = "gap-test-fixscope-persist";
  const dir = makeFixScopeDir("fan-in-fixscope-persist-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const release = `/tmp/fan-in-scope-release-${task}.json`;
  // 同一 load-sensitive 红 + 一个本任务 Touches 内回归（inScope 修，证 gate 不是一律 release）：
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/pkg/a/x.test.mjs passed=false`,
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(release, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const script = block + '\necho "GATE_OUT=[$fix_scope_out]"';
  const r1 = runBash(script, { cwd: dir }); // round 1: release（relaunch, 无 fix）
  const r2 = runBash(script, { cwd: dir }); // round 2: relaunch-fail → 仍 release、零越界 fix
  assert.equal(r1.status, 0, `round-1 gate failed: ${r1.stderr}`);
  assert.equal(r2.status, 0, `round-2 gate failed: ${r2.stderr}`);
  const v1 = JSON.parse(r1.stdout.match(/GATE_OUT=\[(.*)\]/s)[1]);
  const v2 = JSON.parse(r2.stdout.match(/GATE_OUT=\[(.*)\]/s)[1]);

  const ls1 = v1.outOfScope.find((f) => f.reason === "load-sensitive" && f.file === "plugin/test/cold-start-skill.test.mjs");
  const ls2 = v2.outOfScope.find((f) => f.reason === "load-sensitive" && f.file === "plugin/test/cold-start-skill.test.mjs");
  assert.ok(ls1, "round 1: the load-sensitive red must be outOfScope release");
  assert.equal(ls1.releasedRounds, 1, "round 1: first release ⇒ releasedRounds=1");
  assert.ok(ls2, "round 2 (relaunch-fail): the SAME load-sensitive red must STILL be outOfScope release");
  assert.equal(ls2.releasedRounds, 2, "round 2: ledger persisted ⇒ releasedRounds increments to 2 (NOT reset to 1)");
  // 零越界 fix：两轮的 inScope 都不得含 load-sensitive 文件；inScope 只含本任务 Touches 内回归。
  assert.ok(!v1.inScope.includes("plugin/test/cold-start-skill.test.mjs"), "round 1: load-sensitive red never inScope (零越界 fix)");
  assert.ok(!v2.inScope.includes("plugin/test/cold-start-skill.test.mjs"), "round 2: load-sensitive red never inScope (零越界 fix)");
  assert.deepEqual(v2.inScope, ["pkg/a/x.test.mjs"], "in-Touches regression still inScope (gate is not release-everything)");
});

// ── release 隔离重跑 + anti-livelock（gap-gate-release-no-isolate-rerun-no-livelock）────────────────
// THE DEFECT: load-sensitive release 此前是【全量 relaunch】——高 load 常驻下全量 relaunch 不减 load，
// load-sensitive 族反复红 ⇒ 收敛失败（2026-08-19 ac101 实证 3 RED + 3 全量 relaunch，靠低 load 单飞
// 侥幸收敛）；release 侧无 anti-livelock 兜底（attempt≥3）⇒ out-of-scope → release → 全量 relaunch
// 循环无界（ac101 曾 ~2h）。FIX（AC1/AC2）：release 接 C11 隔离重跑（只重跑失败家族文件、低并发，
// 非全量 relaunch）+ anti-livelock 兜底（同一 load-sensitive 红 releasedRounds ≥ 3 ⇒ escalate、不再
// relaunch）。负控制（真实 bash，非 fixture）：① 纯 load-sensitive 释放的 gate verdict 携带
// isolateRerun + livelock=false，且隔离文件列表被 gate 机械写入 /tmp/fan-in-scope-isolate-<task>.files；
// ② 同一 load-sensitive 红连跑 3 轮 gate ⇒ 第 3 轮 livelock=true（attempt≥3 escalate）；③ 内联 fix
// prompt 携带 ISOLATE_LAUNCH 块与三态 release 决策（有 inScope ⇒ 全量 relaunch / 纯释放 ⇒ 隔离重跑 /
// livelock ⇒ escalate 不 relaunch）；④ workflow 层：fix agent 返回 relaunched:false（livelock escalate）
// ⇒ 工作流立即 red 停止，不再进入第 2 个 fix round（无界循环被打破）。


test("release isolation wiring — the fix prompt carries ISOLATE_LAUNCH + the three-state release decision (isolate-rerun ≠ full relaunch; livelock ⇒ escalate)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-release-iso-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-release-iso-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive 释放（第1轮）" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const fixPrompt = promptContaining(prompts, "suite-fix 阶段");
  assert.ok(fixPrompt.includes("# isolate-launch-block-start"), "the fix prompt must carry the ISOLATE_LAUNCH block (C11 隔离重跑)");
  assert.ok(fixPrompt.includes("隔离重跑"), "the fix prompt must instruct the C11 isolated-rerun path");
  assert.ok(fixPrompt.includes("非全量 relaunch"), "the release must be isolation rerun, NOT full relaunch (AC1)");
  assert.ok(fixPrompt.includes("livelock"), "the fix prompt must carry the anti-livelock flag");
  assert.ok(fixPrompt.includes("anti-livelock") || fixPrompt.includes("不再 relaunch"), "the fix prompt must instruct the anti-livelock escalation (AC2)");
  assert.ok(fixPrompt.includes("relaunched: false"), "the anti-livelock escalation must return relaunched:false (no relaunch)");
  assert.ok(fixPrompt.includes("rerunMode"), "the fix prompt must return rerunMode (full|isolated|null) for production evidence");
  assert.ok(fixPrompt.includes("bash scripts/test.sh"), "the full relaunch block is still carried (inScope-fix case)");
});


test("release isolation REAL — pure load-sensitive red ⇒ verdict carries isolateRerun (family files, low-conc) + livelock=false; gate writes the isolate files list", async (t) => {
  const task = "gap-test-release-iso-real";
  const dir = makeFixScopeDir("fan-in-release-iso-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const release = `/tmp/fan-in-scope-release-${task}.json`;
  const isolate = `/tmp/fan-in-scope-isolate-${task}.files`;
  // 纯 load-sensitive 红（无 inScope 回归）：两个家族成员同时红。
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
    `__PERFILE__ duration_ms=4.5 ${dir}/plugin/test/runner-grouping-flags-only.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(release, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(isolate, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, `gate block failed: ${r.stderr}`);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.equal(verdict.livelock, false, "round 1: releasedRounds=1 < 3 ⇒ no livelock");
  assert.ok(verdict.isolateRerun, "pure load-sensitive release must carry the isolateRerun command (AC1)");
  assert.ok(verdict.isolateRerun.includes("bash scripts/test.sh"), "isolateRerun is a low-concurrency test.sh command (only family files)");
  assert.ok(verdict.isolateRerun.includes("plugin/test/cold-start-skill.test.mjs"), "isolateRerun includes the family failing file");
  // 隔离文件列表被 gate 机械写入（每行一个 worktree 相对路径）——机制，不是靠 agent 记性：
  const files = fs.existsSync(isolate) ? fs.readFileSync(isolate, "utf8").trim().split("\n").filter(Boolean) : [];
  assert.ok(files.includes("plugin/test/cold-start-skill.test.mjs"), "gate wrote the isolate files list (mechanism)");
  assert.ok(files.includes("plugin/test/runner-grouping-flags-only.test.mjs"), "gate wrote BOTH family files to the isolate list");
  // 零越界 fix：load-sensitive 文件不在 inScope：
  assert.ok(!verdict.inScope.includes("plugin/test/cold-start-skill.test.mjs"), "load-sensitive red never inScope (零越界 fix)");
});


test("release anti-livelock REAL — same load-sensitive red 3 rounds ⇒ round-3 verdict livelock=true (attempt≥3 escalate)", async (t) => {
  const task = "gap-test-release-ll-real";
  const dir = makeFixScopeDir("fan-in-release-ll-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const release = `/tmp/fan-in-scope-release-${task}.json`;
  const isolate = `/tmp/fan-in-scope-isolate-${task}.files`;
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(release, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(isolate, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const gate = (round) => {
    const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
    assert.equal(r.status, 0, `round ${round} gate failed: ${r.stderr}`);
    const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
    assert.ok(m, `round ${round} gate JSON echo missing:\n${r.stdout}`);
    return JSON.parse(m[1]);
  };
  const v1 = gate(1);
  const v2 = gate(2);
  const v3 = gate(3);
  assert.equal(v1.livelock, false, "round 1: releasedRounds=1 < 3 ⇒ no livelock");
  assert.equal(v2.livelock, false, "round 2: releasedRounds=2 < 3 ⇒ no livelock");
  assert.equal(v3.livelock, true, "round 3: releasedRounds=3 ≥ 3 ⇒ livelock=true (attempt≥3 escalate, AC2)");
  const ls3 = v3.outOfScope.find((f) => f.reason === "load-sensitive" && f.file === "plugin/test/cold-start-skill.test.mjs");
  assert.ok(ls3, "round 3 still releases (幂等持久, never转 fix)");
  assert.equal(ls3.releasedRounds, 3, "round 3 releasedRounds=3");
  assert.equal(ls3.livelock, true, "round 3 item carries the per-item livelock flag");
});


test("release anti-livelock — fix agent escalation (relaunched:false) ⇒ workflow stops red with the anti-livelock message (no infinite relaunch)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-release-ll-wf", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-release-ll-wf", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 4 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                                                 // stage 2: RED
      { relaunched: false, rerunMode: null, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive anti-livelock（releasedRounds≥3）：停止无界 relaunch，escalate → quiet-window / needs-human" },  // Fix agent: livelock escalate
    ],
  });
  const fixPrompts = prompts.filter((p) => p.includes("suite-fix 阶段"));
  assert.equal(fixPrompts.length, 1, "livelock escalation emits ONE fix prompt, then stops (no round-2 relaunch)");
  assert.equal(result.outcome, "red", "escalation must be terminal (red), not another relaunch round");
  assert.ok(result.message.includes("anti-livelock"), `the workflow message names the anti-livelock escalation, got: ${result.message}`);
  assert.equal(result.ffOk, false, "no ff on livelock escalation");
});

// ── defer 侧 anti-livelock（gap-fan-in-relaunch-retry-cap）──────────────────────────────────────────
// THE DEFECT: 非 load-sensitive「other-task defer → 全量 relaunch」无上限——hub-strip 因 PHASE_OVERLAP
// flake（非 load-sensitive、非本任务 Touches）每轮都判 other-task defer ⇒ 「照旧全量 relaunch」循环无界
// （06:12→08:00 ~2h，占 suite 锁阻塞 3 个在飞任务）。releaseLivelockRounds 只覆盖 load-sensitive，不覆盖
// 确定性失败。FIX（AC1/AC2）：defer 侧 anti-livelock——连续纯 defer 轮（inScope 空 + 无 load-sensitive +
// 只有 other-task/leak/checker）≥ maxDeferRelaunches ⇒ deferLivelock=true ⇒ fix agent escalate
// （relaunched:false, escalate='defer-livelock'）⇒ workflow 返回 needs-human（retreat，交 outer），不再
// 无界 relaunch。与 releaseLivelockRounds（load-sensitive）互补不冲突（AC3）。负控制（真实 bash，非
// fixture）：① 同一确定性 other-task 红连跑 3 轮 gate ⇒ 第 3 轮 deferLivelock=true；② 有 inScope 修复
// 或 load-sensitive 释放 ⇒ defer 计数归零；③ 内联 fix prompt 携带 defer escalation 指令；④ workflow 层
// fix agent 返回 escalate='defer-livelock' ⇒ needs-human 停止，不进入第 2 个 fix round。


test("defer anti-livelock wiring — the fix prompt carries the defer escalation state (deferLivelock ⇒ escalate='defer-livelock' → needs-human)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-defer-ll-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-defer-ll-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const fixPrompt = promptContaining(prompts, "suite-fix 阶段");
  assert.ok(fixPrompt.includes("deferLivelock"), "the fix prompt must carry the defer anti-livelock flag");
  assert.ok(fixPrompt.includes("defer anti-livelock"), "the fix prompt must instruct the defer anti-livelock escalation");
  assert.ok(fixPrompt.includes("escalate: 'defer-livelock'"), "the defer escalation must return escalate='defer-livelock' (mechanism, not note-string)");
  assert.ok(fixPrompt.includes("needs-human"), "the defer escalation must retreat to needs-human / hand to outer");
});
