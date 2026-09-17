// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s10.test.mjs by gap-suite-split-15-over-30s-test-files — shard 11 (1 test). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, fs, makeMechRepo, mechOpts, path, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

// ── gap-verification-round-bound-to-quay-shaped-suite-entry：台账写入与「suite 由谁跑」解耦 ──────────
// 第三方项目（无 scripts/test.sh，suite 由自己的 loop.test_command 跑）不经 full-suite-runner ⇒ 那条
// verification-round 唯一 writer 不在路径上 ⇒ /tests 卡片恒显示「未接入」。本测试是【接线】的证据：
// 跑一轮真 fan-in，绿轮必须产出台账行；本仓库形态（有 scripts/test.sh）必须【不产】（负控制——若判据
// 写反就是双写，正是这次改动唯一的回归风险）。


test("gap-verification-round-bound-to-quay-shaped-suite-entry — 第三方形态 fan-in 真产出台账行（taskId/runId 同轮），quay 形态不产（负控制）", async (t) => {
  const runId = "mfi-vr-tp-1789210598105-e1ddad";
  const m = makeMechRepo("vr-third-party", "gap-vr-tp", { thirdParty: true });
  t.after(() => rmSafe(m.base));
  const ledger = path.join(m.repo, ".quay", "verification-round.jsonl");
  assert.equal(fs.existsSync(ledger), false, "前置：fan-in 前台账载体不存在（正是缺陷现场）");

  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    task: "gap-vr-tp", perSuiteRunId: runId,
    // 项目自己的输出形状（vitest），⛔ 不是 quay 自己的 node:test `ℹ pass N` 形状 —— AC5 要求台账里
    // 由【该输出】派生的字段拿到真实值。
    suiteCommand: ["bash", "-c", "echo '      Tests  0 failed | 345 passed (345)'; exit 0"],
  }));
  assert.equal(r.outcome, "landed", `must land (step=${r.step} reason=${r.reason})`);

  assert.ok(fs.existsSync(ledger), "第三方形态的绿轮必须产出台账行（⛔ 不再「未接入」）");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "一轮一行（⛔ 不双写）");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.taskId, "gap-vr-tp", "台账行的 taskId = 本轮 fan-in 的任务");
  assert.equal(rec.runId, runId, "台账行的 runId = 本轮 fan-in 的 per-suite runId");
  assert.equal(rec.state, "green", "绿轮 state=green");
  assert.equal(rec.preverified, false, "suite 在本轮 fan-in 内真跑（⛔ 非复用 capture）");
  assert.equal(rec.scope, "worktree", "scope=worktree");
  assert.match(String(rec.commit), /^[0-9a-f]{40}$/, "commit 是 suite_head（40-hex sha，非空/非伪造）");
  // AC5 —— 由【项目声明的输出约定】从真实 suite 输出派生的字段（三者对照见 third-party-capability-
  // degradation.test.mjs 的 AC5 正向测；这里是接线证据：声明在真 fan-in 轮上被消费）。
  assert.equal(rec.pass, 345, "pass 由声明的正则从 suite 输出派生（345 passed）");
  assert.equal(rec.fail, 0, "fail 由声明的正则派生（0 failed —— 声明匹配到的真 0，⛔ 非伪造）");
  assert.equal(rec.tests, 345, "tests = pass+fail（同 full-suite-runner 口径）");

  // 负控制：本仓库形态（scripts/test.sh 在场）⇒ 本层不补写（台账由 full-suite-runner 写；此处 suite 是
  // 假命令缝，runner 没跑 ⇒ 台账应当【不存在】——若判据写反，这一行会是 1，正是双写）。
  const mSelf = makeMechRepo("vr-self-shape");
  t.after(() => rmSafe(mSelf.base));
  const rs = await runMechanicalFanIn(mechOpts(mSelf, "mfi-vr-self-shape-1"));
  assert.equal(rs.outcome, "landed", `negative control must land (step=${rs.step} reason=${rs.reason})`);
  assert.equal(
    fs.existsSync(path.join(mSelf.repo, ".quay", "verification-round.jsonl")), false,
    "本仓库形态 ⇒ 新增写入者不在该路径上（⛔ 不双写；runner 才是它的 writer）",
  );

  // 红轮也入账（第二条接线：suite 退出分支的那一处 —— 两条分支各写一份正是硬规则 5b 的形态，故两处
  // 都要有证据）。「跑了且红」必须与「没跑过」可分：红轮的台账行必须真的存在且 state=red。
  const mRed = makeMechRepo("vr-third-party-red", "gap-vr-tp-red", { thirdParty: true });
  t.after(() => rmSafe(mRed.base));
  const rr = await runMechanicalFanIn(mechOpts(mRed, "mfi-vr-tp-red-1", {
    task: "gap-vr-tp-red", perSuiteRunId: "mfi-vr-tp-red-1",
    suiteCommand: ["bash", "-c", "echo 'AssertionError [ERR_ASSERTION]: vr red probe'; exit 1"],
  }));
  assert.equal(rr.outcome, "red", "红 suite ⇒ fan-in red");
  const redLedger = path.join(mRed.repo, ".quay", "verification-round.jsonl");
  assert.ok(fs.existsSync(redLedger), "红轮同样入账（⛔ 不只在绿分支写）");
  const redRec = JSON.parse(fs.readFileSync(redLedger, "utf8").trim().split("\n").filter(Boolean).pop());
  assert.equal(redRec.state, "red", "红轮 state=red");
  assert.equal(redRec.taskId, "gap-vr-tp-red", "红轮行归属本轮任务");
  assert.equal(redRec.runId, "mfi-vr-tp-red-1", "红轮行 runId = 本轮 per-suite runId");
  assert.equal(redRec.reason, "failed", "红轮带 reason（读者可分「跑了且红」与「没跑过」）",
  );
});
