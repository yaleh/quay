// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 8/8 (5 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, WORKER_OUTCOME_REL, WORKER_ROUND_REL, __dirname, after, assert, branchHeadSubject, buildContinueWorkerPrompt, exitedNotLandedAttempts, fs, lastExitedNotLandedReason, makeRoot, markNeedsHuman, path, readOutcomeLines, readRoundLines, rmSafe, waitFor } from "./helpers/worker-driver-resident-harness.mjs";

test("B (能取假) — lastExitedNotLandedReason reads mechanical_fan_in (step + reason) ⛔ not generic failure_reason", () => {
  const root = makeRoot("mech-reason");
  const mech = { outcome: "red", step: "merge-develop", reason: "CONFLICT (content): Merge conflict in plugin/scripts/worker-driver.ts" };
  fs.appendFileSync(path.join(root, WORKER_OUTCOME_REL), JSON.stringify({
    ts: new Date().toISOString(), task: "gap-dv", final_state: "exited-not-landed",
    failure_reason: "task status=ready not done", mechanical_fan_in: mech,
  }) + "\n", "utf8");
  const reason = lastExitedNotLandedReason(root, "gap-dv");
  assert.match(reason, /step=merge-develop/, "B: reason leads with the mechanical_fan_in step");
  assert.match(reason, /CONFLICT/, "B: reason carries the conflict marker");
  assert.match(reason, /plugin\/scripts\/worker-driver\.ts/, "B: reason carries the specific conflicting file");
  assert.doesNotMatch(reason, /status=ready not done/, "B: ⛔ not the generic failure_reason");
  // fallback：无 mechanical_fan_in ⇒ 回退 failure_reason（旧行为保留）。
  fs.writeFileSync(path.join(root, WORKER_OUTCOME_REL), JSON.stringify({
    ts: new Date().toISOString(), task: "gap-dv", final_state: "exited-not-landed",
    failure_reason: "worker exited 0 but task did not land (status≠done or leftover worktree)",
  }) + "\n", "utf8");
  assert.match(lastExitedNotLandedReason(root, "gap-dv"), /did not land/, "B: no mechanical_fan_in ⇒ fall back to failure_reason");
});


test("B (能取假, 结构面) — reason 读 mechanical_fan_in（已上收 driver-filters.ts）；A 的 derived 重算逻辑无残留", () => {
  // 读法已上收 driver-filters.ts（gap-needs-human-note-carries-step-verdict：markNeedsHuman 注记与 worker
  // 续做 prompt 共用同一读法）。worker-driver.ts 只 re-export，⛔ 不残留第二份实现。
  const src = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "driver-filters.ts"), "utf8");
  assert.match(src, /formatExitedNotLandedReason/, "B: reason formatting reads mechanical_fan_in");
  assert.match(src, /mechanical_fan_in/, "B: lastExitedNotLandedReason reads the mechanical_fan_in field");
  const wsrc = fs.readFileSync(DRIVER, "utf8");
  // A 已退役（superseded by gap-delivery-inventory-check-time-computation）：⛔ 不残留 derived 重算逻辑
  // （OUTLINE_DOC_REL 常量 / resolveDerivedMergeConflict / DERIVED_CONFLICT_FILES 会引用已删除的 §6 快照 + 退役 flag）。
  assert.doesNotMatch(wsrc, /OUTLINE_DOC_REL/, "A retired: no OUTLINE_DOC_REL import");
  assert.doesNotMatch(wsrc, /resolveDerivedMergeConflict/, "A retired: no derived-recompute resolver");
  assert.doesNotMatch(wsrc, /DERIVED_CONFLICT_FILES/, "A retired: no derived file set");
});

// ── gap-worker-execution-history-index-not-reachable-from-task（B：续做历史 + suite 日志路径）──────
// B 缺口的病根：续做 prompt 只带一句 reason（lastExitedNotLandedReason 只取最后一条）⇒ 重跑 worker 看不到
// 前两次栽在哪、也看不到日志路径。修法：exitedNotLandedAttempts 收集全部尝试；buildContinueWorkerPrompt
// 带前 N 次 (ts,step,reason) 清单 + .quay/fan-in-suite- 绝对路径。


test("B (能取假) — exitedNotLandedAttempts 收集全部尝试（⛔ 只取最后一条 ⇒ 假）", () => {
  const root = makeRoot("history-b");
  const suiteLogName = "fan-in-suite-gap-hb-run2.log";
  fs.writeFileSync(path.join(root, ".quay", suiteLogName), "suite true-cause\n", "utf8");
  fs.appendFileSync(path.join(root, WORKER_OUTCOME_REL), [
    JSON.stringify({ ts: "2026-09-01T03:44:00.000Z", task: "gap-hb", final_state: "exited-not-landed", run_id: "wk-prod-1788218643", session_id: "sess-1", mechanical_fan_in: { outcome: "red", step: "anti-drift", reason: "8 violations", fanInLog: "fan-in-gap-hb-run2.log" } }),
    JSON.stringify({ ts: "2026-09-01T04:21:00.000Z", task: "gap-hb", final_state: "exited-not-landed", run_id: "wk-prod-1788218643", session_id: "sess-2", mechanical_fan_in: { outcome: "red", step: "ac-precheck", reason: "0/3 fail-fast", fanInLog: "fan-in-gap-hb-run2.log" } }),
    JSON.stringify({ ts: "2026-09-01T04:57:00.000Z", task: "gap-hb", final_state: "exited-not-landed", run_id: "wk-prod-1788218643", session_id: "sess-3", mechanical_fan_in: { outcome: "red", step: "suite", reason: "suite red", fanInLog: "fan-in-gap-hb-run2.log", suiteLog: suiteLogName } }),
  ].join("\n") + "\n", "utf8");

  const attempts = exitedNotLandedAttempts(root, "gap-hb");
  assert.equal(attempts.length, 3, "全部 3 次 exited-not-landed 都在清单里（⛔ 只取最后一条 ⇒ 假）");
  assert.deepEqual(attempts.map((a) => a.step), ["anti-drift", "ac-precheck", "suite"], "三次的失败步都在");
  assert.equal(attempts[2].suiteLog, path.join(root, ".quay", suiteLogName), "suite 日志还原成绝对路径");
  assert.equal(attempts[2].runId, "wk-prod-1788218643", "run_id 读数");
  assert.equal(attempts[2].sessionId, "sess-3", "session_id 读数");
  assert.ok(attempts.slice(0, 2).every((a) => a.suiteLog === null), "非 suite 步 suiteLog null（⛔ 误设 ⇒ 假）");
  assert.equal(attempts[0].fanInLog, path.join(root, ".quay", "fan-in-gap-hb-run2.log"), "fan-in 日志还原成绝对路径");
});


test("B (能取假) — buildContinueWorkerPrompt 带前 N 次 (ts,step,reason) 清单 + .quay/fan-in-suite- 绝对路径（在盘）", () => {
  const root = makeRoot("history-prompt");
  const suiteLogName = "fan-in-suite-gap-hp-r9.log";
  fs.writeFileSync(path.join(root, ".quay", suiteLogName), "true cause\n", "utf8");
  const suiteAbs = path.join(root, ".quay", suiteLogName);
  const attempts = [
    { ts: "2026-09-01T03:44:00.000Z", runId: "r", sessionId: "s1", step: "anti-drift", reason: "step=anti-drift: 8 violations", fanInLog: null, suiteLog: null },
    { ts: "2026-09-01T04:57:00.000Z", runId: "r", sessionId: "s2", step: "suite", reason: "step=suite: suite red", fanInLog: null, suiteLog: suiteAbs },
  ];
  const p = buildContinueWorkerPrompt("gap-hp", root, {
    worktreePath: "/wt",
    branchCommits: 1,
    branchHeadSubject: null,
    acChecked: 0,
    acTotal: 3,
    failureReason: "step=suite: suite red",
    attempts,
  });
  assert.match(p, /step=anti-drift: 8 violations/, "清单含第 1 次 (step,reason)（剥掉重复 step= 前缀）");
  assert.match(p, /step=suite: suite red/, "清单含第 2 次 (step,reason)");
  assert.doesNotMatch(p, /step=anti-drift: step=anti-drift/, "⛔ 清单不重复 step= 前缀");
  assert.match(p, /\.quay\/fan-in-suite-/, "含 .quay/fan-in-suite- 字面路径");
  assert.ok(p.includes(suiteAbs), `含 suite 日志绝对路径 ${suiteAbs}`);
  assert.ok(fs.existsSync(suiteAbs), "该路径在盘上存在（AC2 判据）");
});

// ── negative control（gap-driver-test-fixture-json-read-before-write-complete-race AC3）────────────
// 故意制造 "文件存在但最后一行只写了一半" 的中间态（常驻 driver 另一进程正在追加写 JSONL）：旧的
// readFileSync→split→JSON.parse 读法会在半行上报错，新的 readRoundLines/readOutcomeLines 把半行当
// "还没写完" 丢弃、只返回完整行；补完后该行出现（调用方的 waitFor 重轮询即读到）。


test("negative control — torn trailing JSONL line is treated as not-yet-written, then read once completed", (t) => {
  const root = makeRoot("nc-torn-jsonl");
  t.after(() => rmSafe(root));
  const line1 = JSON.stringify({ action: "stop", stop_reason: "pool-empty", in_flight: 0, ts: "2026-09-06T00:00:00Z" });
  const line2 = JSON.stringify({ action: "dispatch", task: "gap-a", in_flight: 1, ts: "2026-09-06T00:00:01Z" });
  const roundFile = path.join(root, WORKER_ROUND_REL);
  const outcomeFile = path.join(root, WORKER_OUTCOME_REL);

  // torn：完整一行 + 第二行只写了开头（另一进程正在追加写入）。
  const torn = '{"action":"dispatch","task":"gap-';
  fs.writeFileSync(roundFile, line1 + "\n" + torn, "utf8");
  fs.writeFileSync(outcomeFile, line1 + "\n" + torn, "utf8");

  // (a) 旧逻辑（split→JSON.parse）在半行上报错——先证负控制非空。
  const naive = (f) => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.throws(() => naive(roundFile), "old readRoundLines throws on a torn trailing line");
  assert.throws(() => naive(outcomeFile), "old readOutcomeLines throws on a torn trailing line");

  // (b) 新逻辑把半行当 "还没写完" 丢弃，只返回完整行，不抛错。
  assert.deepEqual(readRoundLines(root).map((r) => r.action), ["stop"], "readRoundLines returns only the complete line");
  assert.deepEqual(readOutcomeLines(root).map((r) => r.action), ["stop"], "readOutcomeLines returns only the complete line");

  // (c) 补完该行后，调用方重轮询即可读到——半行不是被永久吞掉，只是 "还没写完"。
  fs.writeFileSync(roundFile, line1 + "\n" + line2, "utf8");
  assert.deepEqual(readRoundLines(root).map((r) => r.action), ["stop", "dispatch"], "completed line now read");
});
