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

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 8/10 (10 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, SUITE_FLOOR_SECS, assert, cleanup, fixScopeGateBlockFor, fs, makeFixScopeDir, os, path, promptContaining, runBash, runWorkflow, spawn, spawnSync, vm } from "./helpers/fan-in-execute-paths-harness.mjs";

test("⑩ REAL 死进程负控制 — suite 进程在写 .exit 前静默死亡 ⇒ poller 快速 emit POLL=suite-pid-dead + 写可区分失败态（gap-suite-wait-bash-stale-pid-poll AC1/AC2）", async (t) => {
  const task = "gap-test-piddead";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  fs.rmSync(marker, { force: true });
  // 真实死亡 pid（非 fixture 数字）：spawn 一个短命进程、等它被 reap，然后断言 kill -0 失败。
  const deadPid = Number(spawnSync("bash", ["-c", "echo $$; sleep 0.1"], { encoding: "utf8" }).stdout.trim());
  assert.ok(Number.isInteger(deadPid) && deadPid > 0, `dead pid precondition: got ${deadPid}`);
  const alive = spawnSync("bash", ["-c", `kill -0 ${deadPid} 2>/dev/null; echo $?`], { encoding: "utf8" }).stdout.trim();
  assert.equal(alive, "1", `test precondition: pid ${deadPid} must be provably dead (kill -0 exit 1), got ${alive}`);
  // capture 模拟已启动 suite（含 suite_pid）但 .exit 从未被写（进程静默死亡）。
  fs.writeFileSync(capture, ["full_suite_ran=true", "skip_reason=", `start_ms=${Date.now()}`, "suite_head=abc", `suite_log_file=/tmp/fan-in-suite-${task}.log`, `suite_pid=${deadPid}`].join("\n") + "\n");
  t.after(() => { for (const f of [capture, marker, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  // 测试用 pollBlockSleep=0.2 + pollBlockSeconds=30：若 poller 仍只查 .exit 存在性，会在 30s 硬边界内
  // 空转（旧谓词）；新谓词在第一次 sleep 间隔就 kill -0 发现 pid 死亡 ⇒ 立即返回。
  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-piddead", mergeTarget: "develop", pollBlockSeconds: 30, pollBlockSleep: 0.2 },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const t0 = Date.now();
  const r = runBash(pollBlock, { cwd: "/tmp", timeout: 15_000 });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=suite-pid-dead/, `must emit the distinguishable suite-pid-dead state, got: ${r.stdout}`);
  assert.ok(elapsed < 10_000, `must fail fast (kill -0 on first sleep interval), NOT spin the ${30}s bound: elapsed ${elapsed}ms`);
  // AC2: 可区分失败态落在生产载体（capture），不是只有 agent stdout 一句。
  const cap = fs.readFileSync(capture, "utf8");
  assert.match(cap, /^suite_pid_dead=1$/m, "capture must carry suite_pid_dead=1 (AC2 distinguishable failure state)");
});

// ── ⑩b 阶段 2 agent 循环等待覆盖（gap-subagent-turn-budget-13min-falsified：取代旧 firstDelayMs/pollIntervalMs）──
// 旧设计的「首轮起轮延迟 firstDelayMs（660s）+ 脚本 setTimeout 循环 + 每轮起一个新短命轮询 agent」已随
// 证伪（无 subagent 回合预算超时）一起删除——阶段 2 agent 在本回合内循环运行【单个有界阻塞等待块】
// （timeout 540 + sleep 15，< 600s 硬顶）直到 exit marker 出现（最多 maxSuitePolls 次）。覆盖判据从
// 「firstDelayMs + pollBlockSeconds ≥ 时长」改为「maxSuitePolls × pollBlockSeconds ≥ 时长」
// （默认 60×540=32400s ≫ 1140s）。


test("⑩b stage-2 wait wiring — the stage-2 prompt carries the bounded-wait block (timeout 540 + sleep 15) AND the maxSuitePolls loop bound (能取假)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-firstdelay", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-firstdelay", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "the stage-2 wait block must carry `timeout <N> bash -c` (the bounded blocking wait)");
  const pollBlockSeconds = Number(m[1]);
  assert.ok(pollBlockSeconds < 600, `the blocking-wait hard bound must be < Bash 600s limit, got ${pollBlockSeconds}s`);
  assert.equal(pollBlockSeconds, 540, "the hard bound must be exactly 540s (AC1: < 600s with safety margin)");
  assert.ok(poll.includes('while [ ! -f "$1" ]; do'), "the bounded wait must loop on the marker existence with sleep");
  assert.ok(poll.includes('kill -0 "$2"'), "the bounded wait must liveness-check suite_pid with kill -0 (gap-suite-wait-bash-stale-pid-poll AC1)");
  // The agent-loop bound (gap-subagent-turn-budget-13min-falsified): the SAME stage-2 agent re-runs the
  // block up to maxSuitePolls times — 取假: 删掉「最多 N 次」循环说明 ⇒ 此断言红。
  const cap = poll.match(/最多 (\d+) 次/);
  assert.ok(cap, "the stage-2 wait instructions must carry the maxSuitePolls loop bound ('最多 N 次')");
  const maxSuitePolls = Number(cap[1]);
  const totalCoverageSecs = maxSuitePolls * pollBlockSeconds;
  assert.ok(totalCoverageSecs >= SUITE_FLOOR_SECS, `stage-2 loop coverage (${maxSuitePolls}×${pollBlockSeconds}s = ${totalCoverageSecs}s) must ≥ suite 时长 ${SUITE_FLOOR_SECS}s`);
});


test("⑩b stage-2 wait args override — pollBlockSeconds / pollBlockSleep / maxSuitePolls are args-overridable and reflected in the prompt (AC1 seam)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-firstdelay0", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-firstdelay0", mergeTarget: "develop", pollBlockSeconds: 123, pollBlockSleep: 0.5, maxSuitePolls: 7 },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  assert.match(poll, /timeout 123 bash -c/, "pollBlockSeconds override must render in the wait block");
  assert.ok(poll.includes('sleep 0.5'), "pollBlockSleep override must render in the wait block");
  assert.ok(poll.includes('kill -0 "$2"'), "the liveness check must render in the wait block");
  assert.match(poll, /最多 7 次/, "maxSuitePolls override must render in the loop bound");
});

// ── ⑩d 单次硬边界 + 循环覆盖 ≥ suite 时长（gap-agent-no-timeout-option AC1/AC3，2026-08-20 外层裁定）────
// THE DEFECT (b187d84a 回退教训): 把 pollBlockSeconds 收到 100（< Bash 工具默认 120s）曾被当成
// 「让等待落在默认时限内 ⇒ 等待即代码保证」——但单次等待的硬边界 × 循环次数必须覆盖 suite 时长（实测
// 19+ min ≈ 1140s）。agent() 无 timeout 旋钮（opts 仅 {label,phase,schema,model,effort,isolation,agentType}）
// ——「加旋钮」是 Claude Code 特性请求、仓库改不了。兜底 = suite detached 运行（setsid+&+disown）：
// 阶段 2 agent 的 Bash 即使被默认 120s kill、提前返回 not-done，suite 继续跑，agent 重跑等待块即可——
// detached 让「agent 内长阻塞」成为纯优化而非正确性要求。



test("⑩d stage-2 loop 覆盖 ≥ suite 时长 — 默认 maxSuitePolls × pollBlockSeconds 覆盖单次 suite（AC1 机械判据，读真实 prompt）", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-poll-boundary", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-boundary", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "the wait block must carry `timeout <N> bash -c` (the bounded blocking wait)");
  const pollBlockSeconds = Number(m[1]);
  const cap = poll.match(/最多 (\d+) 次/);
  assert.ok(cap, "the wait instructions must carry the maxSuitePolls loop bound");
  const maxSuitePolls = Number(cap[1]);
  const totalCoverageSecs = maxSuitePolls * pollBlockSeconds;
  assert.ok(
    totalCoverageSecs >= SUITE_FLOOR_SECS,
    `stage-2 loop 覆盖（maxSuitePolls ${maxSuitePolls} × pollBlockSeconds ${pollBlockSeconds}s = ${totalCoverageSecs}s）必须 ≥ suite 时长 ${SUITE_FLOOR_SECS}s；取假：把 pollBlockSeconds 收到 100 且 maxSuitePolls=1 ⇒ 100 < 1140 ⇒ 本断言红（b187d84a 回退教训）`
  );
});


test("⑩d falsification — 单次覆盖 < suite 时长时判据红（pollBlockSeconds=100 + maxSuitePolls=1 override，AC3 取假）", async (t) => {
  // 取假：同一个「覆盖度 ≥ 地板」谓词喂给一个【已知为坏的】配置（100s 单次 × 1 次循环，b187d84a 回退值）
  // ⇒ 谓词必须判它为不及格（断言通过 = 谓词能红，证明「≥ 地板」不是恒真——硬规则 4）。
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-poll-boundary-bad", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-boundary-bad", mergeTarget: "develop", pollBlockSeconds: 100, maxSuitePolls: 1 },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "the wait block must carry `timeout <N> bash -c`");
  const pollBlockSeconds = Number(m[1]);
  assert.equal(pollBlockSeconds, 100, "sanity: the pollBlockSeconds=100 override must be applied");
  const cap = poll.match(/最多 (\d+) 次/);
  assert.ok(cap, "the wait instructions must carry the maxSuitePolls loop bound");
  const maxSuitePolls = Number(cap[1]);
  assert.equal(maxSuitePolls, 1, "sanity: the maxSuitePolls=1 override must be applied");
  const totalCoverageSecs = maxSuitePolls * pollBlockSeconds;
  assert.ok(
    totalCoverageSecs < SUITE_FLOOR_SECS,
    `取假谓词：${totalCoverageSecs}s < ${SUITE_FLOOR_SECS}s 必须成立（100s × 1 = 100 < 1140，覆盖不到 suite 时长）；若此断言红则「≥ 地板」判据是恒真/错测`
  );
});

// ── ⑩c suite-poller agentType（gap-fan-in-execute-poll-cost-firstdelay-agenttype AC2 + wiring 审计 A）──
// agentType='suite-poller' 的 wiring 已 revert（7b917cd1：.claude/agents 新目录 watcher 不加载、fan-in
// bootstrap 当场 crash）；d1338f95 重写后【没有短命轮询 agent 可挂它】——阶段 2 agent 承担机械步骤
// （per-task-suite 入账 / flip / ff / bracket），套 Bash-only 会砍掉其必需工具 ⇒ 恢复接线架构上不成立。
// 处置：删除零消费者孤儿（gap-wiring-A-fan-in-execute-suite-poller-impl-complete），不留孤儿。


test("⑩c suite-poller orphan removed — .claude/agents/suite-poller.md no longer exists (wiring revoked, no restorable consumer)", () => {
  const agentFile = path.join(REPO_ROOT, ".claude", "agents", "suite-poller.md");
  assert.ok(!fs.existsSync(agentFile), "the suite-poller orphan must be REMOVED (no zero-consumer orphan left)");
  // 没有 live wiring 引用 agentType suite-poller（阶段 2 不是 poll-only agent，套它会砍掉机械步骤工具）。
  const wf = fs.readFileSync(path.join(REPO_ROOT, "plugin", "workflows", "fan-in-execute.js"), "utf8");
  assert.ok(!wf.includes("agentType: 'suite-poller'"), "fan-in-execute must NOT wire agentType suite-poller");
});

// ── fix-scope gate（gap-fix-scope-gate-wired-to-wrong-path）───────────────────────────────────────
// THE DEFECT: 上一版 fix-scope gate（gap-suite-fix-workflow-no-load-sensitive-branch）落在
// execute-suite-fix.js（standalone 死工作流）零效果——生产 suite-fix 是 fan-in-execute.js 的内联
// subagent（suite-fix 阶段 prompt），直接修根因、不经 execute-suite-fix.js。越界修已复发第 8+ 例
// （b0aa31c2 修 quay-init.sh / eb77b17e 修 supervisor-observe.test.mjs / 43153e58 修
// session-liveness-helpers.mjs——全不在各自任务 Touches）。FIX：gate 接线到内联 suite-fix prompt，
// fix 前判红是否本任务 Touches 内回归——inScope 修 / load-sensitive 释放 / 别任务 bug defer。
// 负控制（AC2）用【真实 bash】跑 gate 块（vm 实执行 workflow 发出的 prompt 分类），判越界红被
// defer/release、零越界 fix。判定复用 touches-orthogonality-check.ts（parseTouches/matchGlob）+
// known-load-sensitive.ts（scanFamily/kindForFile），与 execute-suite-fix.js 同源。

/** Drive the RED path so the workflow emits the suite-fix (Fix-agent) prompt, then extract the
 *  fix-scope gate block from that prompt. */

/** A fake worktree: real plugin/ symlinked (the gate imports touches-orthogonality-check.ts /
 *  known-load-sensitive.ts and scanFamily against the real manifest) + a real tasks/<id>.md. */


test("fix-scope wiring — the inline suite-fix prompt carries the gate (判红 Touches 内/越界), NOT execute-suite-fix.js", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-fixscope-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-fixscope-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 1 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: ["x"], note: "" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const fixPrompt = promptContaining(prompts, "suite-fix 阶段");
  assert.ok(fixPrompt.includes("# fix-scope-gate-block-start"), "the fix prompt must carry the fix-scope gate block");
  assert.ok(fixPrompt.includes("FIX_SCOPE_VERDICT"), "the gate must emit a FIX_SCOPE_VERDICT");
  assert.ok(fixPrompt.includes("known-load-sensitive.ts"), "the gate must partition by the load-sensitive manifest");
  assert.ok(fixPrompt.includes("touches-orthogonality-check.ts"), "the gate must reuse parseTouches/matchGlob");
  assert.ok(fixPrompt.includes("只修 inScope"), "the fix instruction must scope to inScope (Touches 内回归)");
  assert.ok(fixPrompt.includes("越界"), "the fix instruction must forbid out-of-scope fixes");
});


test("fix-scope REAL negative control — in-Touches red → inScope(fix); out-of-Touches red → other-task defer; load-sensitive red → release", async (t) => {
  const task = "gap-test-fixscope-real";
  const dir = makeFixScopeDir("fan-in-fixscope-", task, [
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
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/pkg/a/x.test.mjs passed=false`,
    `__PERFILE__ duration_ms=2.3 ${dir}/pkg/OTHER/stray.test.mjs passed=false`,
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, `gate block failed: ${r.stderr}`);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.equal(verdict.scoped, true, "a task with a ## Touches section is scoped");
  assert.deepEqual(verdict.inScope, ["pkg/a/x.test.mjs"], "an in-Touches red must be inScope (fix)");
  const reasons = Object.fromEntries(verdict.outOfScope.map((f) => [f.file, f.reason]));
  assert.equal(reasons["pkg/OTHER/stray.test.mjs"], "other-task", "an out-of-Touches red must defer as other-task");
  assert.equal(reasons["plugin/test/cold-start-skill.test.mjs"], "load-sensitive", "a load-sensitive family red must release (not fix)");
});


test("fix-scope REAL new-event routing — a never-failed file's out-of-Touches red routes to new-event (escalate), NOT other-task (defer); a fails>0 file routes back to other-task", async (t) => {
  const task = "gap-test-fixscope-new-event";
  const dir = makeFixScopeDir("fan-in-fixscope-ne-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));

  // A mock gitignored carrier. The gate reads it via QUAY_PERFILE_RATE_ROOT (the test seam for the
  // same --root/QUAY_MAIN_CHECKOUT resolution the production gate uses) — a fake worktree has no
  // real .quay/verification-round.jsonl.
  const carrierDir = fs.mkdtempSync(path.join(os.tmpdir(), "perfile-rate-mock-"));
  t.after(() => cleanup(carrierDir));
  fs.mkdirSync(path.join(carrierDir, ".quay"), { recursive: true });
  const carrierFile = path.join(carrierDir, ".quay", "verification-round.jsonl");
  const rel = "pkg/OTHER/never-failed.test.mjs";
  const mkPerFile = (runs, failIdxs) => {
    const failSet = new Set(failIdxs);
    return Array.from({ length: runs }, (_, i) => ({
      file: rel, passed: !failSet.has(i), startedAtMs: 1000 + i, endedAtMs: 1100 + i, durationMs: 10,
    }));
  };
  const writeCarrier = (recs) => fs.writeFileSync(carrierFile, JSON.stringify({ round: 1, perFile: recs }) + "\n", "utf8");

  const log = `/tmp/fan-in-suite-${task}.log`;
  fs.writeFileSync(log, `__PERFILE__ duration_ms=1.2 ${dir}/${rel} passed=false\n`, "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const env = { ...process.env, QUAY_PERFILE_RATE_ROOT: carrierDir };

  // Case 1: never-failed (fails=0) ⇒ the gate routes it new-event (escalate), not other-task (defer).
  writeCarrier(mkPerFile(60, []));
  const r1 = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir, env });
  assert.equal(r1.status, 0, r1.stderr);
  const v1 = JSON.parse(r1.stdout.match(/GATE_OUT=\[(.*)\]/s)[1]);
  const o1 = v1.outOfScope.find((f) => f.file === rel);
  assert.ok(o1, "the out-of-Touches red must be in outOfScope");
  assert.equal(o1.reason, "new-event", "a never-failed file must escalate (new-event), not defer (other-task)");
  assert.deepEqual(o1.baseline, { runs: 60, fails: 0, rate: 0, classification: "new-event" }, "baseline carries runs/fails/rate/classification");
  assert.deepEqual(v1.baselines[rel], { runs: 60, fails: 0, rate: 0, classification: "new-event" }, "every failure's baseline is in the verdict baselines map");

  // Case 2: same file now has fails>0 spread across BOTH halves ⇒ within-baseline ⇒ routes back to
  // other-task (defer), NOT new-event (escalate). This is the 能取假 direction: flip the history, the
  // route flips.
  writeCarrier(mkPerFile(60, [10, 45]));
  const r2 = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir, env });
  assert.equal(r2.status, 0, r2.stderr);
  const v2 = JSON.parse(r2.stdout.match(/GATE_OUT=\[(.*)\]/s)[1]);
  const o2 = v2.outOfScope.find((f) => f.file === rel);
  assert.equal(o2.reason, "other-task", "a fails>0 within-baseline file must defer (other-task), not escalate");
  assert.equal(o2.baseline.classification, "within-baseline");
  assert.equal(o2.baseline.fails, 2);
});


test("fix-scope REAL machine-partition — a task WITHOUT a ## Touches section ⇒ scoped=false, load-sensitive still released, rest inScope", async (t) => {
  const task = "gap-test-fixscope-noscope";
  const dir = makeFixScopeDir("fan-in-fixscope-ns-", task, "---\nid: gap-test-fixscope-noscope\nstatus: ready\n---\n## Plan\nno touches section\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
    `__PERFILE__ duration_ms=2.3 ${dir}/pkg/a/x.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.equal(verdict.scoped, false, "no ## Touches section ⇒ scoped=false (machine-partition only)");
  const loadSensitive = verdict.outOfScope.find((f) => f.reason === "load-sensitive");
  assert.equal(loadSensitive.file, "plugin/test/cold-start-skill.test.mjs", "load-sensitive family is released even unscoped");
  assert.ok(verdict.inScope.includes("pkg/a/x.test.mjs"), "unscoped: non-family failures stay inScope (machine-partition only)");
});
