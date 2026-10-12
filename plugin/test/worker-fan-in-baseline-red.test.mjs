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
