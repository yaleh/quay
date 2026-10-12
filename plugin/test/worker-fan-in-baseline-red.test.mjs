// @test-group serial
// worker-fan-in-baseline-red.test.mjs — gap-fanin-suite-gate-no-baseline-equivalent-exception
//
// WHAT IS UNDER TEST: the **baseline-equivalence exemption** of fan-in's suite step
// (`plugin/scripts/worker-fan-in.ts`) plus its circuit breaker (consumed by `worker-driver.ts`).
//
// THE DEFECT (quay-fleet, 2026-10-12): fan-in's suite step had exactly two outcomes — all-green / red.
// There was no third档 "this red set is verbatim-equal to the develop baseline red set ⇒ pre-existing,
// not introduced by this task, allowed to continue". Three tasks each fixed one of three pre-existing
// reds on the same develop, each independently verified with zero regression — and none could make its
// own `node --test` exit 0, because the other two reds were still there. They were mutually landing
// gates: whoever landed first was blocked by the other two.
//
// THE MECHANISM: on a red suite, fan-in starts a detached worktree @ mergeTarget, reruns the SAME
// failing test files there, and compares the two failure-signature sets verbatim:
//   task ⊆ baseline            ⇒ exempt (continue to typecheck/ff);
//   task-only red / changed text ⇒ hard red (⛔ no gate relaxed).
//
// FALSIFIABILITY: the negative controls below are the "能取假" halves — a task-introduced red and a
// changed assertion text must BOTH stay hard-red; if the exemption were a blanket "ignore reds" they
// would pass. The e2e tests drive the REAL `runMechanicalFanIn` against a real temp git repo (worktree
// creation, merge, anti-drift, ac-gate, flip, ff all run for real) — only the suite/rerun commands are
// stubbed, because those are the seam the mechanism reads.
//
// Run:
//   node --test plugin/test/worker-fan-in-baseline-red.test.mjs
//   bash scripts/test.sh --for-task gap-fanin-suite-gate-no-baseline-equivalent-exception --allow-thin

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  runMechanicalFanIn,
  parseFailureSignatures,
  compareFailureSignatures,
  failureSignatureSetKey,
  decideBaselineRedCircuitBreaker,
  readBaselineRedRounds,
  baselineRedDeadlockReading,
  BASELINE_RED_ROUNDS_REL,
} from "../scripts/worker-fan-in.ts";
import {
  judgeRetryExemption,
  decideExitedNotLandedAction,
  exitedNotLandedStopNote,
} from "../scripts/worker-driver.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FF_MERGE_MODULE = path.join(REPO, "packages", "quay", "src", "fan-in", "ff-merge.ts");
const SLOT_LIB = path.join(REPO, "plugin", "scripts", "suite-slot-lib.sh");

const CODE_FILE = "src/feature.js";

// ── 失败日志夹具的构造（与生产 `__PERFILE__ … passed=false` + 紧随其后的 AssertionError 同形）───────
/** A suite-log body for one failing file: `__PERFILE__ … passed=false` + an AssertionError line. */
function redLog(file, assertion) {
  return `__PERFILE__ duration_ms=1 ${file} passed=false end_ms=1\n  AssertionError [ERR_ASSERTION]: ${assertion}\n`;
}
/** A `bash -c` argv that prints `log` (each line verbatim, real newlines) on stdout and exits `code`. */
function emit(log, code) {
  const args = log.split("\n").map((l) => `'${l.replace(/'/g, `'\\''`)}'`).join(" ");
  return ["bash", "-c", `printf '%s\\n' ${args}; exit ${code}`];
}

// ── 单元：签名解析（绝对路径按各自 root 归一 ⇒ 两棵树上的同一红点逐字相同）─────────────────────────
test("unit — parseFailureSignatures normalizes absolute paths by their own root (the same red point on two trees)", () => {
  const onTask = parseFailureSignatures(redLog("/wt/repo/plugin/test/a.test.mjs", "a is broken"), "/wt/repo");
  const onBase = parseFailureSignatures(redLog("/base/worktrees/x/plugin/test/a.test.mjs", "a is broken"), "/base/worktrees/x");
  assert.equal(onTask.evaluated, true);
  assert.equal(onBase.evaluated, true);
  assert.deepEqual(onTask.signatures, [{ file: "plugin/test/a.test.mjs", text: "a is broken" }]);
  assert.deepEqual(onBase.signatures, onTask.signatures);
});

test("unit — parseFailureSignatures is three-valued: a failure line with no resolvable identity is NOT 'evaluated, zero signatures'", () => {
  const empty = parseFailureSignatures("", "/wt");
  assert.equal(empty.evaluated, false);
  assert.equal(empty.reason, "empty-suite-log");
  const noFailure = parseFailureSignatures("all good\n# fail 0\n", "/wt");
  assert.equal(noFailure.evaluated, false);
  assert.equal(noFailure.reason, "no-failure-signature-lines");
  // A __PERFILE__ passed=false whose absolute path is NOT under the given root ⇒ identity unresolvable
  // ⇒ the WHOLE parse is not-evaluated (a partially-resolved set would silently drop that red point and
  // produce a false exemption).
  const unresolvable = parseFailureSignatures(redLog("/somewhere/else/a.test.mjs", "x"), "/wt/repo");
  assert.equal(unresolvable.evaluated, false);
  assert.match(unresolvable.reason, /identity unresolvable/);
  // …and the strictness is whole-parse: one unresolvable line next to a resolvable one is still not-evaluated.
  const mixed = parseFailureSignatures(
    redLog("plugin/test/ok.test.mjs", "fine") + redLog("/somewhere/else/a.test.mjs", "x"), "/wt/repo",
  );
  assert.equal(mixed.evaluated, false, "a mixed log must not silently drop the unresolvable red point");
});

// ── AC1 正控：两个任务分支各修一个既存红 ⇒ 两者都判 exempt（既存红点集合逐字不变）──────────────────
test("AC1 (positive control) — two task branches each fixing ONE pre-existing red both read exempt: each task's red set is a subset of the develop baseline red set", () => {
  // develop's red set (the same baseline for both):
  const baseline = parseFailureSignatures(
    redLog("plugin/test/r1.test.mjs", "r1 is broken") + redLog("plugin/test/r2.test.mjs", "r2 is broken"),
    "/wt/repo",
  );
  assert.equal(baseline.evaluated, true);
  // task A fixed R1 ⇒ its merged tree still shows R2 red. Rerunning R2's file on develop reproduces R2.
  const taskA = parseFailureSignatures(redLog("plugin/test/r2.test.mjs", "r2 is broken"), "/wt/repo");
  const vA = compareFailureSignatures(taskA.signatures, baseline.signatures);
  assert.equal(vA.kind, "exempt", `task A must be exempt, got ${JSON.stringify(vA)}`);
  // task B fixed R2 ⇒ its merged tree still shows R1 red.
  const taskB = parseFailureSignatures(redLog("plugin/test/r1.test.mjs", "r1 is broken"), "/wt/repo");
  const vB = compareFailureSignatures(taskB.signatures, baseline.signatures);
  assert.equal(vB.kind, "exempt", `task B must be exempt, got ${JSON.stringify(vB)}`);
  // The A/B is verbatim: a changed number inside the text changes the signature.
  const taskB2 = parseFailureSignatures(redLog("plugin/test/r1.test.mjs", "r1 is broken in 3 places"), "/wt/repo");
  assert.equal(compareFailureSignatures(taskB2.signatures, baseline.signatures).kind, "hard-red");
});

// ── AC2 负控：任务分支自己新增了一个不在既存红点集合里的失败 ⇒ 不得被豁免 ─────────────────────────
test("AC2 (negative control) — a failure the task branch itself introduced is NOT exempt (task-introduced-red)", () => {
  const baseline = parseFailureSignatures(redLog("plugin/test/r2.test.mjs", "r2 is broken"), "/wt/repo");
  const task = parseFailureSignatures(
    redLog("plugin/test/r2.test.mjs", "r2 is broken") + redLog("plugin/test/mine.test.mjs", "my new test fails"),
    "/wt/repo",
  );
  const v = compareFailureSignatures(task.signatures, baseline.signatures);
  assert.equal(v.kind, "hard-red");
  assert.equal(v.reason, "task-introduced-red");
  assert.deepEqual(v.added.map((a) => a.file), ["plugin/test/mine.test.mjs"]);
  assert.deepEqual(v.changed, []);
});

// ── AC3 负控：既存红点的断言文本变化（测试 id 相同）⇒ 不得被当成「同一个」──────────────────────────
test("AC3 (negative control) — the SAME test id with a CHANGED assertion text is NOT the same red point (changed-assertion)", () => {
  const baseline = parseFailureSignatures(redLog("plugin/test/r2.test.mjs", "r2 is broken"), "/wt/repo");
  const task = parseFailureSignatures(redLog("plugin/test/r2.test.mjs", "r2 is broken — now with detail"), "/wt/repo");
  const v = compareFailureSignatures(task.signatures, baseline.signatures);
  assert.equal(v.kind, "hard-red");
  assert.equal(v.reason, "changed-assertion");
  assert.deepEqual(v.changed, [{ file: "plugin/test/r2.test.mjs", baselineText: "r2 is broken", taskText: "r2 is broken — now with detail" }]);
  assert.deepEqual(v.added, [], "a changed text must be reported as `changed`, NOT folded into `added`");
});

// ── AC4 正控：连续 N 轮同一签名 ⇒ 停止自动重派 + 可读的「循环死锁」诊断 ─────────────────────────────
test("AC4 (circuit breaker) — N consecutive rounds with the SAME signature stop the redispatch and produce a readable loop-deadlock diagnostic naming the peer tasks", () => {
  const sig = failureSignatureSetKey([{ file: "plugin/test/r2.test.mjs", text: "r2 is broken" }]);
  const prior = [
    { task: "T", signature: sig, ts: 100, blocked: ["plugin/test/r2.test.mjs"] },
    { task: "T", signature: sig, ts: 200, blocked: ["plugin/test/r2.test.mjs"] },
  ];
  const current = { task: "T", signature: sig, ts: 300, blocked: ["plugin/test/r2.test.mjs"] };
  const peers = [{ task: "U", signature: sig, ts: 250, blocked: ["plugin/test/r2.test.mjs"] }];
  // cap 3: three consecutive identical-signature rounds ⇒ stop.
  const stop = decideBaselineRedCircuitBreaker(prior, current, 3, peers);
  assert.equal(stop.kind, "stop-terminal");
  assert.equal(stop.consecutive, 3);
  assert.deepEqual(stop.peers, ["U"]);
  assert.match(stop.diagnostic, /LOOP DEADLOCK/);
  assert.match(stop.diagnostic, /task T/);
  assert.match(stop.diagnostic, /\bU\b/, "the diagnostic must name the peer task sharing the signature");
  assert.match(stop.diagnostic, /Suggested resolution/, "a suggested landing order must be present");
  assert.match(stop.diagnostic, /NOT relaxed/, "the diagnostic must state the gates were not relaxed");
  // Below the cap ⇒ continue (a DIFFERENT signature also resets the streak).
  assert.equal(decideBaselineRedCircuitBreaker([prior[1]], current, 3, []).kind, "continue");
  const otherSig = failureSignatureSetKey([{ file: "plugin/test/other.test.mjs", text: "x" }]);
  const reset = decideBaselineRedCircuitBreaker(
    [{ task: "T", signature: otherSig, ts: 250, blocked: [] }],
    current, 2, [],
  );
  assert.equal(reset.kind, "continue", "a changed signature is a different wall — the streak must reset");
});

// ── e2e 夹具：真实 git 仓库（worktree/merge/anti-drift/ac-gate/flip/ff 全真跑）───────────────────────
function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(cwd, rel, body) {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}

function taskBody(task) {
  return [
    "---",
    `id: ${task}`,
    "title: baseline-red fixture",
    "status: ready",
    "labels: []",
    "extra: {}",
    "---",
    "## Proposal",
    "fixture",
    "## Plan",
    "fixture",
    "## Touches",
    `- ${CODE_FILE}`,
    `- tasks/${task}.md`,
    "## Acceptance Criteria",
    "- [x] AC1 fixture",
    "## Definition of Done",
    "- [x] landed",
    "",
  ].join("\n");
}

/** A real repo with `develop` + an `author` main checkout + one task branch that committed a code file. */
function makeFixture(tag, task) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `baselinered-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "baseline-red-test"]);
  git(repo, ["config", "user.email", "baseline-red@example.com"]);
  git(repo, ["branch", "-M", "develop"]);
  write(repo, "scripts/test.sh", "#!/usr/bin/env bash\nexit 0\n");
  write(repo, "plugin/scripts/runner-static-gate.ts", "// hermetic registry stub — empty registry\n");
  write(repo, `tasks/${task}.md`, taskBody(task));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["checkout", "-q", "-b", "author"]);
  git(repo, ["worktree", "add", "-q", worktree, "-b", `task/${task}`, "develop"]);
  write(worktree, CODE_FILE, "export const feature = 1;\n");
  git(worktree, ["add", "-A"]);
  git(worktree, ["commit", "-q", "-m", "implement feature"]);
  return { base, repo, worktree, task, slotBase: path.join(base, "full-suite.lock"), capture: path.join(base, "suite.env") };
}

function fanInOpts(fx, runId, { suiteLog, rerunLog }) {
  return {
    task: fx.task,
    worktree: fx.worktree,
    root: fx.repo,
    runId,
    mergeTarget: "develop",
    forceSuite: true,
    scriptsDir: path.join(REPO, "plugin", "scripts"),
    slotBase: fx.slotBase,
    slotLib: SLOT_LIB,
    silenceMs: 500,
    ffMergeModule: FF_MERGE_MODULE,
    suiteCapture: fx.capture,
    suiteLogFile: path.join(fx.base, "suite.log"),
    suiteCommand: emit(suiteLog, 1),
    rerunCommand: emit(rerunLog, 1),
    // hermetic: the baseline worktree inherits the fixture's own scripts/test.sh ⇒ no node_modules copy.
    baselineProvisionCommand: null,
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
  };
}

function traceSteps(fx, runId) {
  const f = path.join(fx.repo, ".quay", `fan-in-${fx.task}-${runId}.log`);
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => r.step);
}
function cleanup(fx) {
  try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── AC5 真实验证：双任务死锁形态 —— 两个任务各修一个既存红，各自都能被解放 ──────────────────────────
test("AC5 (real reproduction) — two tasks, each fixing ONE pre-existing red, are BOTH released: real fan-in lands each on develop while the other's red remains", async (t) => {
  // Task A fixes R1 ⇒ after merging develop its tree still shows R2 red; rerunning R2 on develop shows R2 red.
  const fixA = makeFixture("fixA", "gap-baselinered-fixture-a");
  const fixB = makeFixture("fixB", "gap-baselinered-fixture-b");
  t.after(() => { cleanup(fixA); cleanup(fixB); });

  const rA = await runMechanicalFanIn(fanInOpts(fixA, "baselinered-a", {
    suiteLog: redLog("plugin/test/r2.test.mjs", "r2 is broken"),
    rerunLog: redLog("plugin/test/r2.test.mjs", "r2 is broken"),
  }));
  assert.equal(rA.outcome, "landed", `task A must be released by the exemption (step=${rA.step} reason=${rA.reason})`);
  assert.equal(rA.baselineEquivalence?.verdict?.kind, "exempt", `task A must report an exempt A/B, got ${JSON.stringify(rA.baselineEquivalence)}`);
  assert.ok(traceSteps(fixA, "baselinered-a").includes("baseline-red-exempt"), "the fan-in trace must carry baseline-red-exempt");
  // It really landed on develop: the task's own code commit is an ancestor of develop, and the
  // exemption did not skip any downstream gate (anti-drift / ac-gate / flip all ran and passed).
  const codeCommitA = git(fixA.repo, ["log", "--format=%H", "--grep=implement feature", "develop"]).split("\n")[0];
  assert.notEqual(codeCommitA, "", "task A's implementation commit must be reachable from develop");
  assert.doesNotThrow(() => git(fixA.repo, ["merge-base", "--is-ancestor", codeCommitA, "develop"]));
  assert.ok(traceSteps(fixA, "baselinered-a").includes("anti-drift-land"), "the anti-drift gate must still run on the exemption path");
  assert.ok(traceSteps(fixA, "baselinered-a").includes("ac-gate"), "the AC-completion gate must still run on the exemption path");
  assert.ok(traceSteps(fixA, "baselinered-a").includes("ff"), "the ff step must still run on the exemption path");

  const rB = await runMechanicalFanIn(fanInOpts(fixB, "baselinered-b", {
    suiteLog: redLog("plugin/test/r1.test.mjs", "r1 is broken"),
    rerunLog: redLog("plugin/test/r1.test.mjs", "r1 is broken"),
  }));
  assert.equal(rB.outcome, "landed", `task B must ALSO be released (step=${rB.step} reason=${rB.reason})`);
  assert.equal(rB.baselineEquivalence?.verdict?.kind, "exempt");
  assert.ok(traceSteps(fixB, "baselinered-b").includes("baseline-red-exempt"));
});

// ── AC2 e2e 负控：任务自己新增的红 —— 真实 fan-in 仍然红，且不写 exempt ─────────────────────────────
test("AC2 (e2e negative control) — a task-introduced red is NOT exempt: the real fan-in stays red and the trace carries no baseline-red-exempt", async (t) => {
  const fx = makeFixture("neg", "gap-baselinered-fixture-neg");
  t.after(() => cleanup(fx));
  const r = await runMechanicalFanIn(fanInOpts(fx, "baselinered-neg", {
    // The merged tree shows R2 (pre-existing) AND a red the task itself introduced (mine.test.mjs).
    suiteLog: redLog("plugin/test/r2.test.mjs", "r2 is broken") + redLog("plugin/test/mine.test.mjs", "my new test fails"),
    // Rerunning those files on develop reproduces ONLY the pre-existing R2 — mine.test.mjs is green there.
    rerunLog: redLog("plugin/test/r2.test.mjs", "r2 is broken"),
  }));
  assert.equal(r.outcome, "red", `a task-introduced red must stay red (got ${r.outcome})`);
  assert.equal(r.step, "suite");
  assert.equal(r.baselineEquivalence?.verdict?.kind, "hard-red");
  assert.equal(r.baselineEquivalence?.verdict?.reason, "task-introduced-red");
  assert.match(String(r.reason), /task-introduced-red/, "the red reason must name WHY the exemption was refused");
  const steps = traceSteps(fx, "baselinered-neg");
  assert.ok(!steps.includes("baseline-red-exempt"), "the exemption step must NOT be traced");
  assert.ok(steps.includes("baseline-red"), "the A/B itself must be traced (as hard-red)");
  // The blocked round is recorded on the durable carrier — the circuit breaker's input.
  const rounds = readBaselineRedRounds(fx.repo);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].task, fx.task);
  assert.deepEqual(rounds[0].blocked, ["plugin/test/mine.test.mjs"]);
  // …and the driver-side reader turns three consecutive identical-signature rounds into stop-terminal.
  const now = Date.now();
  fs.appendFileSync(path.join(fx.repo, BASELINE_RED_ROUNDS_REL), [
    JSON.stringify({ task: fx.task, signature: rounds[0].signature, ts: now + 1, blocked: rounds[0].blocked }),
    JSON.stringify({ task: fx.task, signature: rounds[0].signature, ts: now + 2, blocked: rounds[0].blocked }),
  ].join("\n") + "\n", "utf8");
  const breaker = baselineRedDeadlockReading(fx.repo, fx.task, 3);
  assert.equal(breaker.kind, "stop-terminal");
  assert.match(breaker.diagnostic, /LOOP DEADLOCK/);
});

// ── 未评估面：Rerun 命令读不懂 / 基线跑不起来 ⇒ 维持硬红（⛔ 任何 A/B 失败都退回改动前行为）──────────
test("fail-closed — an unevaluable A/B is not-evaluated and the suite stays red (the exemption never fires on 'could not check')", async (t) => {
  const fx = makeFixture("notcl", "gap-baselinered-fixture-notcl");
  t.after(() => cleanup(fx));
  // The baseline rerun produces NO parsable failure signature (empty output, exit 1).
  const r = await runMechanicalFanIn(fanInOpts(fx, "baselinered-notcl", {
    suiteLog: redLog("plugin/test/r2.test.mjs", "r2 is broken"),
    rerunLog: "",
  }));
  assert.equal(r.outcome, "red");
  assert.equal(r.baselineEquivalence?.verdict?.kind, "not-evaluated");
  assert.ok(!traceSteps(fx, "baselinered-notcl").includes("baseline-red-exempt"));
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red
//
// 缺陷：真实 suite 日志是 node **spec reporter**（`✖ <test name> (<ms>)` + `test at <file>:<line>:<col>`），
// 一个 `^not ok` 都没有 ⇒ 旧解析器在【基线侧】恒 `no-failure-signature-lines` ⇒ A/B `not-evaluated`
// ⇒ 一份 develop 本来就红的日志被当「归因不出的基建之谜」，健康的任务被停派（2026-10-13 生产读数）。
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** 生产日志（`.quay/fan-in-suite-gap-discovery-…~wk-prod-anchor~1791828953643-00613d.log` 6005-6056 行）
 *  里 `✖ failing tests:` 块的**逐字**摘录：两条 `test at …prod-data-audit.test.mjs:N:1` + `✖` 配对。
 *  ⛔ 只把 `:line` 之外的内容原样保留——栈帧里的 worktree 绝对路径与耗时都是【易变量】，正是要证明
 *  「不靠它们也能在两棵树之间对齐」的那部分。 */
const PROD_SPEC_BLOCK = [
  "✖ failing tests:",
  "",
  "test at plugin/test/prod-data-audit.test.mjs:227:1",
  "✖ AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks (15439.958259ms)",
  "  Error: Cannot create a string longer than 0x1fffffe8 characters",
  "      at Object.readFileSync (node:fs:483:20)",
  "      at classifyCarrier (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/scripts/prod-data-audit.ts:426:18)",
  "      at buildAudit (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/scripts/prod-data-audit.ts:658:17)",
  "      at getAudit (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/test/prod-data-audit.test.mjs:50:35)",
  "      at TestContext.<anonymous> (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/test/prod-data-audit.test.mjs:228:17)",
  "      at Test.runInAsyncScope (node:async_hooks:227:14)",
  "      at Test.run (node:internal/test_runner/test:1402:25)",
  "      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)",
  "      at Test.postRun (node:internal/test_runner/test:1542:19)",
  "      at Test.run (node:internal/test_runner/test:1467:12) {",
  "    code: 'ERR_STRING_TOO_LONG'",
  "  }",
  "",
  "test at plugin/test/prod-data-audit.test.mjs:309:1",
  "✖ AC1 explicit carriers are always reported even at zero position-based refs (17136.819347ms)",
  "  Error: Cannot create a string longer than 0x1fffffe8 characters",
  "      at Object.readFileSync (node:fs:483:20)",
  "      at classifyCarrier (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/scripts/prod-data-audit.ts:426:18)",
  "      at buildAudit (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/scripts/prod-data-audit.ts:658:17)",
  "      at getAudit (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/test/prod-data-audit.test.mjs:50:35)",
  "      at TestContext.<anonymous> (file:///data/home/yale/work/quay-worktrees/gap-discovery-method-per-round-quota-verify-reserve-deep-reflection/plugin/test/prod-data-audit.test.mjs:311:17)",
  "      at Test.runInAsyncScope (node:async_hooks:227:14)",
  "      at Test.run (node:internal/test_runner/test:1402:25)",
  "      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)",
  "      at Test.postRun (node:internal/test_runner/test:1542:19)",
  "      at Test.run (node:internal/test_runner/test:1467:12) {",
  "    code: 'ERR_STRING_TOO_LONG'",
  "  }",
  "",
].join("\n");
/** 该摘录在【任务树】上的完整形态：整份 suite 日志还带文件级 `__PERFILE__ … passed=false`（基线侧那份
 *  重跑日志没有——这是**记录粒度差**，不是红点集合差）。 */
const PROD_TASK_LOG = `__PERFILE__ duration_ms=32924 plugin/test/prod-data-audit.test.mjs passed=false end_ms=1 cpu_ms=1 mem_peak_kb=1\n${PROD_SPEC_BLOCK}__PERFILE__ duration_ms=32924 plugin/test/prod-data-audit.test.mjs passed=false end_ms=2 cpu_ms=1 mem_peak_kb=1\n`;

/** AC1 的正控：生产 spec 块（两对 `test at` + `✖`）⇒ evaluated:true 且【两条】签名；同一摘录在两侧
 *  ⇒ 判为 develop-wide（逐字相同 ⇒ exempt，⛔ 不是「读不懂」）。 */
test("AC1 (spec positive control) — the verbatim production spec-reporter block parses to 2 signatures, and the SAME block on both sides reads develop-wide (exempt)", () => {
  const task = parseFailureSignatures(PROD_SPEC_BLOCK, "/wt/repo");
  assert.equal(task.evaluated, true, `spec block must be evaluable, got ${JSON.stringify(task)}`);
  assert.equal(task.signatures.length, 2, `exactly 2 signatures, got ${JSON.stringify(task.signatures)}`);
  // 身份 = (file, test name)；`:line` 与耗时都【不】入身份（行号跨分支漂移、耗时每次不同）。
  assert.deepEqual(task.signatures.map((s) => s.file), [
    "plugin/test/prod-data-audit.test.mjs",
    "plugin/test/prod-data-audit.test.mjs",
  ]);
  assert.match(task.signatures[0].text, /^AC1\/AC2\/AC3\/AC5\/AC6 REAL-CARRIER — audit against production reproduces manager re-checks \[code: ERR_STRING_TOO_LONG\]$/);
  assert.match(task.signatures[1].text, /^AC1 explicit carriers are always reported even at zero position-based refs \[code: ERR_STRING_TOO_LONG\]$/);
  assert.doesNotMatch(task.signatures[0].text, /15439/, "the duration must be stripped (it differs run to run)");
  assert.doesNotMatch(task.signatures[0].text, /:227/, "the :line must not enter the identity (it drifts between branches)");

  // 同一摘录、两侧各自的 root（绝对路径按各自 root 归一）⇒ 逐字相同 ⇒ develop-wide。
  const base = parseFailureSignatures(PROD_SPEC_BLOCK, "/wt/base");
  const v = compareFailureSignatures(task.signatures, base.signatures);
  assert.equal(v.kind, "exempt", `identical on both sides ⇒ develop-wide, got ${JSON.stringify(v)}`);
  assert.equal(v.unchanged, 2);

  // 真实形态：任务侧是整份 suite 日志（多一条文件级 `__PERFILE__`），基线侧是失败文件重跑（没有它）
  // ⇒ 文件级标记被 [相同文件的] 测试级签名**吸收**，两棵树仍判据相同（⛔ 记录粒度差不得读成新红）。
  const realTask = parseFailureSignatures(PROD_TASK_LOG, "/wt/repo");
  assert.equal(realTask.evaluated, true);
  assert.deepEqual(realTask.signatures, task.signatures, "the file-level __PERFILE__ marker is subsumed by the file's test-level spec signatures");
  assert.equal(compareFailureSignatures(realTask.signatures, base.signatures).kind, "exempt");
});

/** AC2(a)：spec 形态的日志里【没有】**✖** 也没有 `test at` ⇒ 仍然 not-evaluated（⛔ 一个「没有信号」的
 *  日志绝不能被读成「两侧相同」——那正是本缺陷的反方向：把「没读到」伪装成「一致」）。 */
test("AC2(a) (negative control) — a spec-shaped log with no ✖ and no `test at` stays not-evaluated (an absent signal is never read as 'identical')", () => {
  const clean = parseFailureSignatures("ℹ tests 10\nℹ pass 10\nℹ fail 0\nℹ duration_ms 100\n", "/wt/repo");
  assert.equal(clean.evaluated, false);
  assert.equal(clean.reason, "no-failure-signature-lines");
  // 连汇总行 `✖ <name>`（没有 `test at` 配对）也不得被当成失败点——它不带文件身份。
  const unpaired = parseFailureSignatures("✖ failing tests:\n\n✖ some failing name (12.5ms)\n", "/wt/repo");
  assert.equal(unpaired.evaluated, false, "an unpaired ✖ line carries no file identity ⇒ not a signature");
  assert.equal(unpaired.reason, "no-failure-signature-lines");
});

/** AC2(b)：分支侧独有的一条 spec 失败 ⇒ ⛔ 不得被豁免（豁免只覆盖「不变差」的方向）。 */
test("AC2(b) (negative control) — a branch-side spec failure the baseline lacks is NOT exempt (task-introduced-red)", () => {
  const branchOnly = `${PROD_SPEC_BLOCK}test at plugin/test/mine.test.mjs:12:1\n✖ my brand new test fails (3.5ms)\n\n      at x (x.js:1:1) {\n    code: 'ERR_ASSERTION'\n  }\n`;
  const task = parseFailureSignatures(branchOnly, "/wt/repo");
  const base = parseFailureSignatures(PROD_SPEC_BLOCK, "/wt/repo");
  assert.equal(task.evaluated, true);
  const v = compareFailureSignatures(task.signatures, base.signatures);
  assert.equal(v.kind, "hard-red");
  assert.equal(v.reason, "task-introduced-red");
  assert.deepEqual(v.added.map((a) => a.file), ["plugin/test/mine.test.mjs"]);
  // 同一 spec id 但错误码变了 ⇒ changed-assertion（⛔ 不折成新 id）。
  const changedCode = PROD_SPEC_BLOCK.replace(/ERR_STRING_TOO_LONG/g, "ERR_OUT_OF_MEMORY");
  const vc = compareFailureSignatures(parseFailureSignatures(changedCode, "/wt/repo").signatures, base.signatures);
  assert.equal(vc.kind, "hard-red");
  assert.equal(vc.reason, "changed-assertion");
  assert.deepEqual(vc.changed.map((c) => c.file), ["plugin/test/prod-data-audit.test.mjs", "plugin/test/prod-data-audit.test.mjs"]);
});

/** AC2(c)：既有 TAP / `__PERFILE__` 夹具的解析结果**逐字不变**（spec 分支只是并列的第三条通路）。
 *  ⛔ 本用例【不】依赖 spec 分支：把 spec 识别整体删掉，它仍须全绿——这正是「TAP 面没被动过」的判据。 */
test("AC2(c) (negative control) — the existing TAP/__PERFILE__ fixtures give byte-identical results (independent of the spec branch)", () => {
  assert.deepEqual(parseFailureSignatures(redLog("/wt/repo/plugin/test/a.test.mjs", "a is broken"), "/wt/repo").signatures,
    [{ file: "plugin/test/a.test.mjs", text: "a is broken" }]);
  const tap = "not ok 1 - plugin/test/b.test.mjs: b is broken\nnot ok 2 - plugin/test/c.test.mjs: c is broken\n";
  assert.deepEqual(parseFailureSignatures(tap, "/wt/repo").signatures, [
    { file: "plugin/test/b.test.mjs", text: "b is broken" },
    { file: "plugin/test/c.test.mjs", text: "c is broken" },
  ]);
  // 行序不变（`failureSignatureSetKey` 会排序，但 signatures 数组本身是行序——夹具/诊断都读它）。
  const mixed = redLog("plugin/test/a.test.mjs", "a is broken") + tap;
  assert.deepEqual(parseFailureSignatures(mixed, "/wt/repo").signatures.map((s) => s.file),
    ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs", "plugin/test/c.test.mjs"]);
  // 三态取值也不变。
  assert.equal(parseFailureSignatures("", "/wt").reason, "empty-suite-log");
  assert.equal(parseFailureSignatures("all good\n# fail 0\n", "/wt").reason, "no-failure-signature-lines");
});

/** Plan 第 2 条：混合输出（TAP + spec）取**并集**，按 (file, text) 去重。 */
test("Plan-2 (mixed output) — a TAP + spec log yields the deduplicated union of both extractors", () => {
  const tap = "not ok 1 - plugin/test/b.test.mjs: b is broken\nnot ok 2 - plugin/test/c.test.mjs: c is broken\n";
  const union = parseFailureSignatures(tap + PROD_SPEC_BLOCK, "/wt/repo");
  assert.equal(union.evaluated, true);
  assert.deepEqual(union.signatures.map((s) => s.file), [
    "plugin/test/b.test.mjs", "plugin/test/c.test.mjs",
    "plugin/test/prod-data-audit.test.mjs", "plugin/test/prod-data-audit.test.mjs",
  ], "union, in line order");
  // 逐字重复的一行 ⇒ 不产生第二条签名（去重身份 = (file, text)）。
  const twice = parseFailureSignatures(PROD_SPEC_BLOCK + PROD_SPEC_BLOCK, "/wt/repo");
  assert.equal(twice.signatures.length, 2, "the same red point twice is still ONE signature");
});

/** AC4：判词不得在解析器**已归因到 ≥1 个失败文件**时说「无法归因」。生产读数（2026-10-12T18:21Z 那条
 *  needs-human）里同一句话一边写「失败无法归因」、一边在括号里写 `parser attributed 1 failing file(s)`
 *  ——本用例用【同一形状】的夹具把渲染文本取出来，并给出 files 为空的反向控制臂。 */
test("AC4 — the needs-human/stop wording never says 「无法归因」 while the parser attributed ≥1 failing file", (t) => {
  const NOW = Date.parse("2026-10-13T02:21:00.000Z");
  const FILE = "plugin/test/prod-data-audit.test.mjs";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-ac4-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
  fs.writeFileSync(path.join(root, FILE), "", "utf8");
  // ⛔ 不写 tasks/gap-a.md ⇒ delta 读不懂 ⇒ insufficient-data-fallback（生产形状），但 failingTestFiles 非空。
  const twoRoundsApart = (ms) => `__PERFILE__ duration_ms=${ms} ${FILE} passed=false end_ms=1\n${PROD_SPEC_BLOCK}`;
  fs.writeFileSync(path.join(root, ".quay", "fan-in-suite-gap-a-1.log"), twoRoundsApart(32924), "utf8");
  fs.writeFileSync(path.join(root, ".quay", "fan-in-suite-gap-a-2.log"), twoRoundsApart(32925), "utf8");
  fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({
      ts: new Date(NOW - 3600_000).toISOString(), task: "gap-a", final_state: "exited-not-landed",
      mechanical_fan_in: { outcome: "red", step: "suite", suiteLog: "fan-in-suite-gap-a-1.log" },
    }) + "\n", "utf8");
  // 生产那条 outcome 的逐字读数：基线比较 not-evaluated（本缺陷之前，spec 日志在基线侧恒读不懂）。
  const outcome = {
    ts: new Date(NOW).toISOString(), final_state: "exited-not-landed",
    mechanical_fan_in: {
      outcome: "red", step: "suite", suiteLog: "fan-in-suite-gap-a-2.log",
      baselineEquivalence: {
        verdict: { kind: "not-evaluated", reason: "baseline-side signatures unevaluable: no-failure-signature-lines" },
        baselineWorktree: null, log: null,
      },
    },
  };
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  assert.equal(j.verdict, "insufficient-data-fallback", `夹具必须落在归因不出的路径上：${j.reason}`);
  assert.deepEqual(j.failingTestFiles, [FILE], "判定器【读到了】失败文件——这正是旧判词说反话的那条路径");
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  assert.equal(d.kind, "stop-terminal", "两次归因不出 ⇒ 停（动作语义逐字不变）");
  assert.doesNotMatch(d.reason, /could not be attributed to any failing test file/, "⛔ 判词不得与判定器自己的读数相反");
  assert.match(d.reason, /baseline comparison not evaluated: baseline-side signatures unevaluable/, "判词必须点名【真态】：基线比较未评估");

  const note = exitedNotLandedStopNote(d, j);
  assert.doesNotMatch(note, /无法归因/, `归因到 ≥1 个文件时不得说「无法归因」：${note}`);
  assert.match(note, /suite 红已归因到 1 个失败文件/, "如实报出已归因的条数");
  assert.match(note, new RegExp(FILE.replace(/[.]/g, "\\.")), "点名那个文件");
  // 两臂输出必须不同（否则该读数与字段无关 ⇒ 恒真量，硬规则 4）。对照臂给【确实一个也没归因出】的形状：
  // 判词与判据同源复算，故对照臂自己那条 reason 也取旧措辞（⛔ 不把非空臂的 reason 拼到空臂上）。
  const noteEmpty = exitedNotLandedStopNote(
    { ...d, reason: "suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect; stopping instead of spending another worker session" },
    { ...j, failingTestFiles: [] },
  );
  assert.match(noteEmpty, /无法归因/, `files 为空 ⇒ 如实说「无法归因」：${noteEmpty}`);
  assert.doesNotMatch(noteEmpty, /已归因到/, "对照臂不得凭空报出归因条数");
  assert.notEqual(note, noteEmpty, "两臂输出必须可区分");
  // AC4 要求「贴渲染文本」——入测试输出（证据取自真实运行，⛔ 不是手抄）。
  console.log(`AC4 arm A (failingTestFiles 非空): ${note}`);
  console.log(`AC4 arm B (failingTestFiles 为空): ${noteEmpty}`);
});
