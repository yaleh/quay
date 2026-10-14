// @test-group lowconc
// duration-report.test.mjs — 可复用只读窗口查询（gap-attempt-task-phase-timing-fields-incomplete-lock-wait-field-broken AC3）。
//
// 这一组钉住三件事，每一件都是「判据要能取假」的形状：
//   ① **三态**：载体缺失 / 字段缺失 ⇒ NOT-EVALUATED，⛔ 绝不折成 0（硬规则 3b/6）；
//   ② **右删失是一等输出**：有尝试、无终态 ⇒ `terminal:false` + 年龄，⛔ 不靠「记录缺席」让读者去猜；
//   ③ **归属键是尝试窗口**：旧 (task,runId) 口径的对照读数随记录落盘、可在报告里计数（负控制）。
// 全部用合成 root（纯 fs 读，不需要 .quay/config.yml —— 本模块不碰 provider）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  NOT_EVALUATED,
  percentile,
  dist,
  deltaMs,
  readJsonl,
  toAttemptRecord,
  readInFlightAttempts,
  isTerminalStatus,
  buildDurationReport,
  renderReport,
  parseWindow,
} from "../scripts/duration-report.ts";

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dur-rep-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  return root;
}
function writeTask(root, id, status) {
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `---\nid: ${id}\ntitle: t\nstatus: ${status}\n---\n## Proposal\n\nx\n`, "utf8");
}

test("三态：空输入 ⇒ NOT-EVALUATED（⛔ 不与 0 共用取值）", () => {
  assert.equal(percentile([], 0.5), NOT_EVALUATED);
  const d = dist([]);
  assert.equal(d.n, 0);
  assert.equal(d.median, NOT_EVALUATED);
  assert.equal(d.min, NOT_EVALUATED);
  // 正值臂：一个**真的量出来**的 0 是 0，不是 NOT-EVALUATED —— 两者必须可区分。
  assert.equal(dist([0]).median, 0);
  assert.equal(deltaMs(null, 1), NOT_EVALUATED);
  assert.equal(deltaMs(1, null), NOT_EVALUATED);
  assert.equal(deltaMs(5, 2), 3);
  assert.equal(deltaMs(2, 2), 0, "真的相等 ⇒ 0（不是未评估）");
});

test("readJsonl — 「文件不在」与「文件在但一条都读不出」不同形", () => {
  const root = mkRoot();
  assert.deepEqual(readJsonl(path.join(root, ".quay", "nope.jsonl")), { present: false, records: [] });
  const f = path.join(root, ".quay", "x.jsonl");
  fs.writeFileSync(f, "{ bad\n\n", "utf8");
  const r = readJsonl(f);
  assert.equal(r.present, true, "文件在 ⇒ present:true（哪怕一条都解析不出）");
  assert.equal(r.records.length, 0);
});

test("toAttemptRecord — 新阶段字段读取；旧记录 ⇒ 缺值(null) 且标记回退源", () => {
  const t0 = Date.parse("2026-10-14T10:00:00.000Z");
  const modern = toAttemptRecord({
    task: "T", ts: new Date(t0 + 900_000).toISOString(), run_id: "R", final_state: "completed",
    wall_clock_ms: 900_000,
    dispatched_at: new Date(t0).toISOString(),
    worker_exited_at: new Date(t0 + 600_000).toISOString(),
    fanin_ended_at: new Date(t0 + 880_000).toISOString(),
    lock_requested_at: new Date(t0 + 600_000).toISOString(),
    lock_acquired_at: new Date(t0 + 605_000).toISOString(),
    fan_in_lock_wait_ms: 5000,
    suite_started_at: new Date(t0 + 610_000).toISOString(),
    suite_ended_at: new Date(t0 + 870_000).toISOString(),
    legacy_lock_join: { lock_acquire_epoch_ms: 1, lock_release_epoch_ms: 2, lock_hold_secs: 0.001, mismatch: true },
  });
  assert.equal(modern.dispatchedAtFromLegacyStart, false);
  assert.equal(modern.workerExitedAtMs, t0 + 600_000);
  assert.equal(modern.lockWaitMs, 5000);
  assert.equal(modern.legacyLockJoinMismatch, true);

  // 旧记录（无新字段）：**任务级**回退读 started_at（同一个量），但**尝试级**相位全部 null（未评估）。
  const legacy = toAttemptRecord({ task: "T", ts: new Date(t0).toISOString(), run_id: "R", started_at: new Date(t0 - 60_000).toISOString(), wall_clock_ms: 1000 });
  assert.equal(legacy.dispatchedAtFromLegacyStart, true);
  assert.equal(legacy.dispatchedAtMs, t0 - 60_000, "任务级首次派发要有值（started_at 是 dispatched_at 的旧名）");
  assert.equal(legacy.workerExitedAtMs, null, "⛔ 尝试级分段不回退——缺 worker_exited_at 就没有实现段");
  assert.equal(legacy.legacyLockJoinMismatch, null, "没有对照记录 ⇒ 未评估");

  assert.equal(toAttemptRecord({ ts: "x" }), null, "读不出 task/ts ⇒ null（不产出一个半成品记录）");
});

test("readInFlightAttempts — terminal:false + 年龄取自派发记录（直接量）", () => {
  const root = mkRoot();
  fs.writeFileSync(
    path.join(root, ".quay", "worker-dispatch.json"),
    JSON.stringify({ "T-live": { taskId: "T-live", runId: "wk-prod-anchor", workerPid: 123, startedAtMs: 1_000_000 } }),
    "utf8",
  );
  const rows = readInFlightAttempts(root, 1_600_000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].terminal, false, "in-flight 尝试**必须**带显式 terminal:false");
  assert.equal(rows[0].ageMs, 600_000);
  assert.equal(rows[0].workerPid, 123);
  // 载体缺失 ⇒ 空集（**不是**「没有在飞」这句结论——报告层用 sources.present 把它与「读到了、确是空」
  // 分开，见 buildDurationReport 的 sources 段）。
  assert.deepEqual(readInFlightAttempts(mkRoot(), 1), [], "无 .quay/worker-dispatch.json ⇒ 空集");
});

test("buildDurationReport — 分段 + 右删失 + 未评估段并列，且载体缺席以 NOT-EVALUATED 呈现（AC3）", () => {
  const root = mkRoot();
  const nowMs = Date.parse("2026-10-14T12:00:00.000Z");
  const t0 = Date.parse("2026-10-14T10:00:00.000Z");
  // ① 一条**已完成**的尝试（带全部新阶段字段）。
  fs.writeFileSync(
    path.join(root, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({
      task: "T-done", ts: new Date(t0 + 900_000).toISOString(), run_id: "R1", final_state: "completed",
      wall_clock_ms: 900_000, started_at: new Date(t0).toISOString(), dispatched_at: new Date(t0).toISOString(),
      worker_exited_at: new Date(t0 + 600_000).toISOString(), fanin_ended_at: new Date(t0 + 880_000).toISOString(),
      lock_requested_at: new Date(t0 + 600_000).toISOString(), lock_acquired_at: new Date(t0 + 603_000).toISOString(),
      fan_in_lock_wait_ms: 3000, suite_started_at: new Date(t0 + 610_000).toISOString(), suite_ended_at: new Date(t0 + 870_000).toISOString(),
      legacy_lock_join: { lock_acquire_epoch_ms: t0 + 999_999_000, lock_release_epoch_ms: 0, lock_hold_secs: 1, mismatch: true },
    }) + "\n",
    "utf8",
  );
  // ② 一条**在飞**尝试（只有派发记录）——右删失。
  fs.writeFileSync(
    path.join(root, ".quay", "worker-dispatch.json"),
    JSON.stringify({ "T-live": { runId: "wk-prod-anchor", workerPid: 9, startedAtMs: Date.parse("2026-10-14T11:00:00.000Z") } }),
    "utf8",
  );
  // ③ 任务状态事件 + 任务文件。
  fs.writeFileSync(
    path.join(root, ".quay", "task-status-events.jsonl"),
    JSON.stringify({ schema: "task-status-event/v1", taskId: "T-live", from: null, to: "ready", at: new Date(t0 + 3_600_000).toISOString() }) + "\n",
    "utf8",
  );
  writeTask(root, "T-live", "ready");
  writeTask(root, "T-done", "done");

  const rep = buildDurationReport({ root, sinceMs: Date.parse("2026-10-14T00:00:00.000Z"), untilMs: nowMs, nowMs });
  assert.equal(rep.attempts.finished, 1);
  assert.equal(rep.attempts.implementationMs.n, 1);
  assert.equal(rep.attempts.implementationMs.median, 600_000, "实现段 = worker_exited_at − dispatched_at（⛔ 不是整段 900s）");
  assert.equal(rep.attempts.faninMs.median, 280_000, "fan-in 段 = fanin_ended_at − worker_exited_at");
  assert.equal(rep.attempts.lockWaitMs.median, 3000);
  assert.equal(rep.attempts.suiteMs.median, 260_000);
  assert.equal(rep.attempts.legacyLockJoinComparable, 1);
  assert.equal(rep.attempts.legacyLockJoinMismatches, 1, "负控制：旧归属口径与窗口口径不一致的条数被报出");

  // 右删失：在飞尝试带 terminal:false。
  assert.equal(rep.inFlightAttempts.count, 1);
  assert.equal(rep.inFlightAttempts.rows[0].terminal, false);
  assert.equal(rep.inFlightAttempts.rows[0].ageMs, 3_600_000);
  assert.equal(rep.inFlightAttempts.agesMs.median, 3_600_000);

  // 右删失（任务级）：有尝试、无终态。
  assert.equal(rep.inFlightTasks.count, 1, "T-live：有在飞尝试 ∧ status=ready ⇒ terminal:false");
  assert.equal(rep.inFlightTasks.rows[0].terminal, false);
  assert.equal(rep.inFlightTasks.rows[0].ageMs, 3_600_000, "年龄自 ready_at 起算");

  // 载体存在性如实报出（缺载体 ⇒ 那一段 NOT-EVALUATED，而不是 0）。
  assert.equal(rep.sources["worker-outcome.jsonl"].present, true);
  // 文本渲染不崩，且把 NOT-EVALUATED 与 terminal=false 都印出来。
  const text = renderReport(rep);
  assert.match(text, /terminal=false\s+T-live/);
  assert.match(text, /legacy lock join: comparable=1 mismatched=1/);
});

test("buildDurationReport — 载体整体缺席 ⇒ 全部 NOT-EVALUATED，且 sources 明说 ABSENT", () => {
  const root = mkRoot();
  const nowMs = Date.parse("2026-10-14T12:00:00.000Z");
  const rep = buildDurationReport({ root, sinceMs: nowMs - 86_400_000, untilMs: nowMs, nowMs });
  assert.equal(rep.attempts.finished, 0);
  assert.equal(rep.attempts.attemptMs.median, NOT_EVALUATED);
  assert.equal(rep.attempts.legacyLockJoinComparable, NOT_EVALUATED);
  assert.equal(rep.inFlightAttempts.count, 0);
  assert.equal(rep.inFlightAttempts.agesMs.median, NOT_EVALUATED);
  assert.equal(rep.sources["worker-outcome.jsonl"].present, false);
  assert.equal(rep.sources["worker-outcome.jsonl"].records, NOT_EVALUATED, "载体不在 ⇒ 条数是未评估（⛔ 不是 0 条）");
});

test("isTerminalStatus — 三态：终态 / 非终态 / 读不出(未评估)", () => {
  assert.equal(isTerminalStatus("done"), true);
  assert.equal(isTerminalStatus("needs-human"), true);
  assert.equal(isTerminalStatus("superseded"), true);
  assert.equal(isTerminalStatus("ready"), false);
  assert.equal(isTerminalStatus("todo"), false);
  assert.equal(isTerminalStatus(null), null, "读不出 ⇒ null（未评估，⛔ 不与 false=在飞 同形）");
});

test("parseWindow — 坏参数 ⇒ null（CLI 据此 exit 1），缺省 = 最近 7 天", () => {
  const now = Date.parse("2026-10-14T12:00:00.000Z");
  assert.deepEqual(parseWindow([], now), { sinceMs: now - 7 * 86_400_000, untilMs: now });
  assert.deepEqual(parseWindow(["--since", "2026-10-07", "--until", "2026-10-14"], now), {
    sinceMs: Date.parse("2026-10-07"),
    untilMs: Date.parse("2026-10-14"),
  });
  assert.equal(parseWindow(["--since", "not-a-date"], now), null);
  assert.equal(parseWindow(["--since"], now), null);
  assert.equal(parseWindow(["--since", "2026-10-14", "--until", "2026-10-07"], now), null, "since > until ⇒ 拒绝");
});
