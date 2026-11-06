// @test-group serial
// goal-driver-s14.test.mjs — 立案台账（.quay/goal-filing.jsonl）与两处读面成本
// （tasks/gap-goal-driver-filing-ledger，GOAL-914 / AC-934）。
//
// 覆盖五件事：
//   ① spawn **之前**写 `spawned` 行（用「spawn 时读台账」的真子进程做正控，⛔ 不是读完文件再猜）；
//   ② 下一轮 `reconcileGoalFiling` 写 `filed` / `not-filed` 终态，且两者是**不同取值**；
//   ③ `not-filed` 的 reason 枚举能区分 `no-task` / `no-goal-ac` / `deduped-by-skill`（⛔ 布尔），
//      并有负控证明「没立案」永远不会被写成 `filed`；
//   ④ 坏行跳过并计数、同一条 open 行重放不会写第二条终态（幂等）；
//   ⑤ pass 1 的 `goal list` 走 `--no-evidence`、pass 2 保留 evidence（**可观测的调用事实**）；
//      `goal list` 的 wall-clock 上限从 drivers.yml `kinds.goal.list_timeout_ms` 派生。
//
// Run: node --test plugin/test/goal-driver-s14.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GOAL_FILING_REL,
  appendGoalFilingRow,
  goalFilingLedgerPath,
  goalFilingRequestId,
  readGoalFilingLedger,
  reconcileGoalFiling,
  runGapSpawnPass,
  runGoalRound,
} from "../scripts/goal-driver.ts";
import { GOAL_LIST_TIMEOUT_MS_DEFAULT, goalListArgv, goalListTimeoutReading } from "../scripts/meta-driver.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 一次可立案的缺口 + 它的 GOAL 记录（runGapSpawnPass 的选取面只认 isFilingGapState 的四态）。 */
function oneGap(ac = "AC-001") {
  return {
    gaps: [{ goal: "GOAL-001", ac, state: "gap", taskCount: 0 }],
    records: [
      { id: "GOAL-001", title: "g", status: "active" },
      { id: ac, goal: "GOAL-001", title: "a1", expect: "e1", status: "active" },
    ],
  };
}

/** 写一条 tasks/<id>.md（只带 readTaskFacts 读的那几个 frontmatter 字段）。 */
function writeTask(root, { id, status = "todo", goalAc = null }) {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const fm = ["---", `id: ${id}`, `title: t`, `status: ${status}`];
  if (goalAc !== null) fm.push(`goal_ac: ${goalAc}`);
  fm.push("---", "", "body", "");
  const file = path.join(root, "tasks", `${id}.md`);
  fs.writeFileSync(file, fm.join("\n"));
  return file;
}

/** 把某个文件的 mtime 钉到指定时刻（mtime 是核对口径「晚于 spawned.at」的唯一输入）。 */
function setMtime(file, ms) {
  fs.utimesSync(file, new Date(ms), new Date(ms));
}

/** 跑一次 spawn pass，拿它写下的 spawned 行（⛔ 不手写台账：正控要证明的是**被测代码**写了它）。 */
function spawnOnce(root, opts = {}) {
  const { gaps, records } = oneGap(opts.ac);
  return runGapSpawnPass(gaps, records, root, {
    gapWorkerCmd: "true",
    resourceGateArgv: ["true"],
    spawnCap: 5,
    filingRound: opts.round ?? "R1",
    ...opts.extra,
  });
}

/** 台账里某 requestId 的终态行（⛔ 按 requestId 取，不按行号——行序不是契约）。 */
function terminalRows(ledgerPath, requestId) {
  return readGoalFilingLedger(ledgerPath).rows.filter(
    (r) => r.requestId === requestId && (r.state === "filed" || r.state === "not-filed"),
  );
}

// ── ① spawned 行在 spawn 之前落盘 ────────────────────────────────────────────────────────────────

test("① spawn **之前**写 spawned 行：spawn 时台账里已经有它（真子进程读盘正控）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-before-"));
  try {
    const ledger = goalFilingLedgerPath(tmp);
    assert.equal(ledger, path.join(tmp, GOAL_FILING_REL), "路径单一构造点（.quay/goal-filing.jsonl）");
    // spawn 的「agent」= 一个在**它自己的运行时刻**读台账的脚本：行不在 ⇒ exit 7。
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-bin-"));
    const probe = path.join(bin, "probe");
    fs.writeFileSync(probe, `#!/bin/sh\ngrep -q '"state":"spawned"' '${ledger}' || exit 7\nexit 0\n`, { mode: 0o755 });
    const { gaps, records } = oneGap();
    const r = runGapSpawnPass(gaps, records, tmp, {
      gapWorkerCmd: probe,
      resourceGateArgv: ["true"],
      spawnCap: 1,
      filingRound: "R1",
    });
    assert.equal(r.spawned, 1);
    assert.equal(r.outcomes[0].exitCode, 0, "spawn 运行时台账里已有 spawned 行（⛔ 不是事后补写）");
    assert.equal(r.filing.appended, 1);
    assert.equal(r.filing.rows[0].requestId, goalFilingRequestId("GOAL-001", "AC-001", "R1", 0));
    const read = readGoalFilingLedger(ledger);
    assert.equal(read.badLines, 0);
    assert.equal(read.rows.length, 1);
    assert.equal(read.rows[0].state, "spawned");
    assert.equal(read.rows[0].ac, "AC-001");
    assert.equal(read.rows[0].goal, "GOAL-001");
    assert.match(read.rows[0].promptSha, /^[0-9a-f]{16}$/, "prompt 指纹落盘（⛔ 只留一个时间戳）");
    fs.rmSync(bin, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② filed ──────────────────────────────────────────────────────────────────────────────────────

test("② 下一轮核对 ⇒ filed：带 goal_ac 的任务在 spawn 之后落盘", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-filed-"));
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    const r = spawnOnce(tmp);
    const spawned = r.filing.rows[0];
    const spawnedAtMs = Date.parse(spawned.at);
    const file = writeTask(tmp, { id: "gap-task-a", goalAc: "AC-001" });
    setMtime(file, spawnedAtMs + 5000);
    const reading = reconcileGoalFiling(tmp, [
      { id: "gap-task-a", status: "todo", goalAc: "AC-001" },
    ]);
    assert.equal(reading.evaluated, true);
    assert.equal(reading.openBefore, 1);
    assert.equal(reading.openAfter, 0, "核对后不再有 open 行");
    assert.equal(reading.appended, 1);
    const entry = reading.reconciled[0];
    assert.equal(entry.state, "filed");
    assert.equal(entry.reason, null, "filed 的 reason 恒 null（⛔ 与 not-filed 共用取值）");
    assert.equal(entry.taskId, "gap-task-a", "证据可追到具体 task id");
    const rows = terminalRows(goalFilingLedgerPath(tmp), spawned.requestId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "filed");
    assert.equal(rows[0].spawnedAt, spawned.at);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ③ not-filed 的三种成因（枚举，⛔ 布尔） ──────────────────────────────────────────────────────

test("③a not-filed/no-task：agent 根本没落盘（负控：⛔ 不得写成 filed）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-notask-"));
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    spawnOnce(tmp);
    const reading = reconcileGoalFiling(tmp, []);
    const entry = reading.reconciled[0];
    assert.equal(entry.state, "not-filed");
    assert.notEqual(entry.state, "filed", "负控：没立案不得与立案同形");
    assert.equal(entry.reason, "no-task");
    assert.equal(entry.taskId, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("③b not-filed/no-goal-ac：落了盘但没写 goal_ac（负控：⛔ 不得写成 filed）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-nogoalac-"));
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    const r = spawnOnce(tmp);
    const spawnedAtMs = Date.parse(r.filing.rows[0].at);
    const file = writeTask(tmp, { id: "unclaimed", goalAc: null });
    setMtime(file, spawnedAtMs + 5000);
    const reading = reconcileGoalFiling(tmp, [{ id: "unclaimed", status: "todo", goalAc: null }]);
    const entry = reading.reconciled[0];
    assert.equal(entry.state, "not-filed");
    assert.equal(entry.reason, "no-goal-ac");
    assert.equal(entry.taskId, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("③c not-filed/deduped-by-skill：零新文件，但已有一条认领该 AC 的任务", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-dedup-"));
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    // 既有认领：mtime 钉在 spawn **之前**（quay-file-task 的去重谓词看的正是「已有一条认领」）。
    const prior = writeTask(tmp, { id: "prior-claim", status: "done", goalAc: "AC-001" });
    const r = spawnOnce(tmp);
    setMtime(prior, Date.parse(r.filing.rows[0].at) - 60_000);
    const reading = reconcileGoalFiling(tmp, [{ id: "prior-claim", status: "done", goalAc: "AC-001" }]);
    const entry = reading.reconciled[0];
    assert.equal(entry.state, "not-filed");
    assert.equal(entry.reason, "deduped-by-skill");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("③d 三成因是**互不相同**的取值（枚举，⛔ 布尔折叠）", () => {
  const reasons = ["no-task", "no-goal-ac", "deduped-by-skill"];
  assert.equal(new Set(reasons).size, 3);
  // 三个 fixture 的判定在上面 ③a/③b/③c 各自断言过；这里钉住「它们不是同一件事」这一点本身。
  assert.notEqual("no-task", "no-goal-ac");
  assert.notEqual("no-goal-ac", "deduped-by-skill");
  assert.notEqual("no-task", "deduped-by-skill");
});

// ── ④ 坏行 + 重放 ────────────────────────────────────────────────────────────────────────────────

test("④ 坏行跳过并计数；重放不写第二条终态（幂等）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-replay-"));
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    const ledger = goalFilingLedgerPath(tmp);
    spawnOnce(tmp);
    // 三行坏数据（非 JSON / 缺 state / 缺 requestId）夹在有效行之间。
    fs.appendFileSync(ledger, "not-json\n");
    fs.appendFileSync(ledger, `${JSON.stringify({ requestId: "x" })}\n`);
    fs.appendFileSync(ledger, `${JSON.stringify({ state: "filed" })}\n`);
    const read = readGoalFilingLedger(ledger);
    assert.equal(read.badLines, 3, "坏行跳过并计数（⛔ 不让一行坏数据拖垮整份台账）");
    assert.equal(read.rows.length, 1, "有效行照常读出");

    const first = reconcileGoalFiling(tmp, []);
    assert.equal(first.badLines, 3, "核对读数把坏行数带出来");
    assert.equal(first.appended, 1);
    assert.equal(first.openAfter, 0);
    const requestId = read.rows[0].requestId;
    assert.equal(terminalRows(ledger, requestId).length, 1);

    // 重放：同一条已 terminate 的行不再被核对 ⇒ 零新行、零 open。
    const second = reconcileGoalFiling(tmp, []);
    assert.equal(second.appended, 0, "重放不产生第二行终态");
    assert.equal(second.openBefore, 0);
    assert.equal(second.openAfter, 0);
    assert.equal(terminalRows(ledger, requestId).length, 1, "同一条 spawned 只有一条终态");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("④b tasks/ 读不到 ⇒ evaluated:false（⛔ 不把「不知道」写成 not-filed）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-unreadable-"));
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    spawnOnce(tmp);
    const reading = reconcileGoalFiling(tmp, null);
    assert.equal(reading.evaluated, false);
    assert.equal(reading.cause, "tasks-unreadable");
    assert.deepEqual(reading.reconciled, []);
    assert.equal(terminalRows(goalFilingLedgerPath(tmp), readGoalFilingLedger(goalFilingLedgerPath(tmp)).rows[0].requestId).length, 0, "读不到输入 ⇒ ⛔ 不写终态");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑤ 读面：pass 1 无 evidence / pass 2 保留 / 超时可配置 ────────────────────────────────────────

test("⑤a pass 1 的 goal list argv 含 --no-evidence；pass 2 不带（可观测的调用事实）", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-listopts-"));
  try {
    fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    // pass 2 只在台账可读时执行 → 造一个空的 gate-events 载体。
    fs.writeFileSync(path.join(tmp, ".quay", "gate-events.jsonl"), "");
    const calls = [];
    const records = [{ id: "GOAL-900", title: "closed", status: "achieved", kind: "goal" }];
    await runGoalRound(tmp, {
      scriptRoot: REPO_ROOT,
      roundTag: "R-list",
      listGoalRecordsFn: async (_sr, _dr, opts) => {
        calls.push(opts);
        return records;
      },
    });
    assert.equal(calls.length, 2, "一轮恰好两次 goal list（pass 1 / pass 2）");
    assert.equal(calls[0].noEvidence, true, "pass 1 ⛔ 不派生 evidence（206MB 台账，实测 14.4s vs 1.4s）");
    assert.equal(calls[1].noEvidence, false, "pass 2 保留 evidence（ledgerTailVerdict 的输入）");
    // argv 层的正控：`--no-evidence` 真的进 argv（不是只进了一个 opts 对象）。
    const withFlag = goalListArgv(REPO_ROOT, tmp, { noEvidence: true });
    const withoutFlag = goalListArgv(REPO_ROOT, tmp, { noEvidence: false });
    assert.ok(withFlag.includes("--no-evidence"), "argv 含 --no-evidence");
    assert.ok(!withoutFlag.includes("--no-evidence"), "对照：不带时 argv 里没有它");
    assert.deepEqual(withoutFlag, goalListArgv(REPO_ROOT, tmp), "缺省 = 保留 evidence（既有调用点行为不变）");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("⑤b goal list 超时从 drivers.yml kinds.goal.list_timeout_ms 派生；非法值回落并记原因", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-filing-timeout-"));
  try {
    const driverCfg = path.join(tmp, "plugin", "scripts", "drivers.yml");
    // (1) 未配置 ⇒ 缺省 180000，source=default，⛔ 无 detail。
    let r = goalListTimeoutReading(tmp);
    assert.equal(r.timeoutMs, GOAL_LIST_TIMEOUT_MS_DEFAULT);
    assert.equal(r.timeoutMs, 180_000);
    assert.equal(r.source, "default");
    assert.equal(r.detail, null);

    // (2) 配置了合法值 ⇒ 用它，source=config。
    fs.mkdirSync(path.dirname(driverCfg), { recursive: true });
    fs.writeFileSync(driverCfg, "kinds:\n  goal:\n    list_timeout_ms: 90000\n");
    r = goalListTimeoutReading(tmp);
    assert.equal(r.timeoutMs, 90_000);
    assert.equal(r.source, "config");
    assert.equal(r.detail, null);

    // (3) 非法值 ⇒ 回落缺省 **并记原因**（⛔ 静默）。
    fs.writeFileSync(driverCfg, "kinds:\n  goal:\n    list_timeout_ms: -5\n");
    r = goalListTimeoutReading(tmp);
    assert.equal(r.timeoutMs, GOAL_LIST_TIMEOUT_MS_DEFAULT);
    assert.equal(r.source, "default");
    assert.ok(r.detail !== null && r.detail.includes("-5"), `detail 必须点名原值，实际 ${JSON.stringify(r.detail)}`);

    // (4) 显式覆盖优先（测试缝 / 调用方）。
    r = goalListTimeoutReading(tmp, 42_000);
    assert.equal(r.timeoutMs, 42_000);
    assert.equal(r.source, "explicit");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
