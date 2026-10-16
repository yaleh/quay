// @test-group engine
// touches-relax-ledger.test.mjs — 放宽派发账本与成本连接报告（GOAL-037 / AC-363）。
//
// 这一组钉住四件事，每一件都是「判据要能取假」的形状：
//   ① **账本是载体，不是内存对象**：真实 `appendRelaxedDispatch` 写进 mkdtemp 出的 fixture root，
//      断言读的是从 `.quay/relaxed-dispatch.jsonl` **文件回读并 JSON.parse** 出来的内容（AC2）；
//   ② **拒写不落一个字节**：五键任一非法 ⇒ ok:false + 文件字节哈希不变（AC3，硬规则 3b/6）；
//   ③ **连接键是任务 id，不是位置**：夹具刻意让账本行序 ≠ outcome 行序，并在测试内**独立算出按位置
//      连接的投影**，显式断言它与正确读数**不同**——否则「按 id 连接」的注入可能是空转的
//      （空转的负控制与「验过了」同形，硬规则 3b）；
//   ④ **样本不足 ⇒ NOT-EVALUATED，不是 0**：三组 fixture 各断言一次，并 `!== 0`（AC7）。
//
// 纯 fs、无子进程、无 wall-clock 等待 ⇒ `// @test-group engine`。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  RELAXED_DISPATCH_REL,
  MIN_COMPARABLE_TASKS,
  validateRelaxedDispatchRecord,
  appendRelaxedDispatch,
  readRelaxedDispatchLedger,
  buildRelaxedDispatchReport,
  parseCliArgs,
} from "../scripts/relaxed-dispatch-ledger.ts";
import { NOT_EVALUATED, toAttemptRecord } from "../scripts/duration-report.ts";

// 每个临时 root 登记在案，模块收尾统一删——`tmp-leak-pairing-check` 要求每个 mkdtemp 结果都有配对清理。
const TMP_ROOTS = [];
after(() => {
  for (const root of TMP_ROOTS) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort：清理失败不该把一次绿的测试变红 */
    }
  }
});

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relax-ledger-"));
  TMP_ROOTS.push(root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  return root;
}

const ledgerFile = (root) => path.join(root, RELAXED_DISPATCH_REL);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse("2026-10-17T00:00:00.000Z");

/** 一条账本记录（合法形态）。 */
function ledgerRecord(task, dispatchedAtMs, extra = {}) {
  return {
    task,
    blockers: [`blocker-of-${task}`],
    overlapFiles: [`plugin/scripts/${task}.ts`],
    waitedMinutes: 42,
    dispatchedAt: iso(dispatchedAtMs),
    ...extra,
  };
}

/** 一条 `worker-outcome.jsonl` 行（按生产字段写盘）。
 *  · `minutes === null` ⇒ **不写** `worker_exited_at`（运行段不可测）；
 *  · `mfi === undefined` ⇒ **不写** `mechanical_fan_in`（失败但产不出 step 的那种）；
 *  · `mfi` 给对象 ⇒ 原样落盘（可给 `{ step: "suite" }` 或 `{}` = 有 mfi 但无 step）。 */
function outcomeLine({ task, tsMs, dispatchMs, minutes, finalState = "completed", wallMinutes, mfi }) {
  const rec = { task, ts: iso(tsMs), final_state: finalState };
  if (dispatchMs !== undefined && dispatchMs !== null) rec.dispatched_at = iso(dispatchMs);
  if (dispatchMs !== undefined && dispatchMs !== null && minutes !== undefined && minutes !== null) {
    rec.worker_exited_at = iso(dispatchMs + minutes * 60_000);
  }
  if (wallMinutes !== undefined) rec.wall_clock_ms = wallMinutes * 60_000;
  if (mfi !== undefined) rec.mechanical_fan_in = mfi;
  return JSON.stringify(rec);
}

function writeOutcome(root, lines) {
  fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), lines.join("\n") + "\n", "utf8");
}

/** 按位置连接（`ledger[i] ↔ outcome 第 i 行`）的投影——测试**独立**算出的「错误读法」。
 *  它与正确读数必须不同，否则本文件关于「按 id 连接」的断言是空转的。 */
function projectByPosition(ledgerRecords, outcomeRawLines) {
  const out = {};
  ledgerRecords.forEach((rec, i) => {
    const line = outcomeRawLines[i];
    if (line === undefined) {
      out[rec.task] = { attempts: 0, workerMinutes: null, step: null };
      return;
    }
    const parsed = JSON.parse(line);
    const ar = toAttemptRecord(parsed);
    const workerMinutes =
      ar !== null && ar.workerExitedAtMs !== null && ar.dispatchedAtMs !== null
        ? (ar.workerExitedAtMs - ar.dispatchedAtMs) / 60_000
        : null;
    out[rec.task] = { attempts: 1, workerMinutes, step: parsed.mechanical_fan_in?.step ?? null };
  });
  return out;
}

// ── AC2 — 账本形状与追加语义 ─────────────────────────────────────────────────────────────────

test("AC2 — 追加两行：从载体文件回读，恰五键、类型正确，且第二行写入后第一行逐字节不变", () => {
  const root = mkRoot();
  const a = { task: "T-a", blockers: ["T-x", "T-y"], overlapFiles: ["plugin/scripts/a.ts"], waitedMinutes: 12.5, dispatchedAt: iso(T0) };
  const b = { task: "T-b", blockers: ["T-z"], overlapFiles: [], waitedMinutes: 0, dispatchedAt: iso(T0 + 60_000) };

  assert.equal(appendRelaxedDispatch(root, a).ok, true);
  const bytesAfterFirst = fs.readFileSync(ledgerFile(root));

  assert.equal(appendRelaxedDispatch(root, b).ok, true);
  const bytesAfterSecond = fs.readFileSync(ledgerFile(root));

  // 第一次写入的字节是第二次写入内容的**逐字节前缀** ⇒ 第一行一个字节都没动（⛔ 不是读改写/重排）。
  assert.ok(
    bytesAfterSecond.subarray(0, bytesAfterFirst.length).equals(bytesAfterFirst),
    "第二行写入后，第一行必须逐字节不变（appendFileSync 追加，⛔ 不读改写）",
  );

  // 从**载体文件**回读并 JSON.parse（⛔ 不是内存对象）。
  const back = readRelaxedDispatchLedger(root);
  assert.equal(back.present, true);
  assert.deepEqual(back.malformed, [], "两行都是合法记录 ⇒ 零坏行");
  assert.equal(back.records.length, 2, "回读的行数必须是 2");

  const rawLines = fs.readFileSync(ledgerFile(root), "utf8").split("\n").filter((l) => l.trim() !== "");
  assert.equal(rawLines.length, 2);
  for (const line of rawLines) {
    const obj = JSON.parse(line);
    assert.deepEqual(
      Object.keys(obj).sort(),
      ["blockers", "dispatchedAt", "overlapFiles", "task", "waitedMinutes"],
      "每行**恰含** AC-363 点名的五键（⛔ 没有第二个时间字段）",
    );
  }
  const first = JSON.parse(rawLines[0]);
  assert.equal(typeof first.task, "string");
  assert.ok(Array.isArray(first.blockers) && Array.isArray(first.overlapFiles), "两个键必须是数组");
  assert.equal(typeof first.waitedMinutes, "number");
  assert.equal(typeof first.dispatchedAt, "string");
  assert.ok(Number.isFinite(Date.parse(first.dispatchedAt)), "dispatchedAt 必须可 Date.parse");
  assert.deepEqual(back.records[0], a);
  assert.deepEqual(back.records[1], b);
});

test("AC2 — 末尾无换行的旧记录：逐字保留、新记录独立成行、malformed 不因粘行而增加", () => {
  const root = mkRoot();
  const alien = '{"note":"external writer, not a relaxed-dispatch record"}';
  const preExistingNoNewline = JSON.stringify(ledgerRecord("T-pre", T0 - 3_600_000));
  fs.writeFileSync(ledgerFile(root), `${alien}\n${preExistingNoNewline}`, "utf8"); // 末行**无换行**

  const beforeBytes = fs.readFileSync(ledgerFile(root));
  const before = readRelaxedDispatchLedger(root);
  assert.equal(before.present, true);
  assert.equal(before.records.length, 1, "外来行之外的既有记录可读");
  assert.equal(before.malformed.length, 1, "外来行是坏行（校验不过）——它必须被**计数**，不是被静默跳过");

  assert.equal(appendRelaxedDispatch(root, ledgerRecord("T-new", T0)).ok, true);
  const afterBytes = fs.readFileSync(ledgerFile(root));

  // 既有字节逐字保留（前缀相等），紧随其后的那个字节必须是**补上的换行**。
  assert.ok(afterBytes.subarray(0, beforeBytes.length).equals(beforeBytes), "既有内容逐字保留");
  assert.equal(afterBytes[beforeBytes.length], 0x0a, "末尾无换行 ⇒ 写入器必须先补一个换行再写");

  const after = readRelaxedDispatchLedger(root);
  assert.equal(after.malformed.length, before.malformed.length, "粘行会让 malformed +1；它必须不变");
  assert.equal(after.records.length, 2, "新记录独立成行");

  // **判别力**：把同一批内容按「不补换行」粘起来，malformed 确实会 +1 ⇒ 上面的断言不是空转的。
  const gluedRoot = mkRoot();
  fs.writeFileSync(ledgerFile(gluedRoot), `${alien}\n${preExistingNoNewline}${JSON.stringify(ledgerRecord("T-new", T0))}\n`, "utf8");
  assert.equal(
    readRelaxedDispatchLedger(gluedRoot).malformed.length,
    before.malformed.length + 1,
    "不补换行的粘行形态确实多一行坏行（证明上面的断言有判别力）",
  );
});

// ── AC3 — 写入器 fail-closed（⛔ 缺值不写成 0）──────────────────────────────────────────────

test("AC3 — 五类非法输入各拒写一次，reason 指名该字段，且文件字节哈希不变（一个字节都没写）", () => {
  const root = mkRoot();
  assert.equal(appendRelaxedDispatch(root, ledgerRecord("T-seed", T0)).ok, true, "先写一行合法记录，使「不变」有一个非空基线");
  const before = sha256(fs.readFileSync(ledgerFile(root)));

  const cases = [
    { name: "task 缺失", rec: { blockers: ["b"], overlapFiles: [], waitedMinutes: 1, dispatchedAt: iso(T0) }, field: "task" },
    { name: "task 空串", rec: ledgerRecord("T-ok", T0, { task: "   " }), field: "task" },
    { name: "blockers 空数组", rec: ledgerRecord("T-ok", T0, { blockers: [] }), field: "blockers" },
    { name: "overlapFiles 非数组", rec: ledgerRecord("T-ok", T0, { overlapFiles: "plugin/scripts/a.ts" }), field: "overlapFiles" },
    { name: "waitedMinutes null", rec: ledgerRecord("T-ok", T0, { waitedMinutes: null }), field: "waitedMinutes" },
    { name: "waitedMinutes NaN", rec: ledgerRecord("T-ok", T0, { waitedMinutes: Number.NaN }), field: "waitedMinutes" },
    { name: "waitedMinutes 负数", rec: ledgerRecord("T-ok", T0, { waitedMinutes: -3 }), field: "waitedMinutes" },
    { name: "dispatchedAt 不可 parse", rec: ledgerRecord("T-ok", T0, { dispatchedAt: "not-a-timestamp" }), field: "dispatchedAt" },
  ];

  const evidence = [];
  for (const c of cases) {
    const res = appendRelaxedDispatch(root, c.rec);
    assert.equal(res.ok, false, `${c.name} ⇒ 必须拒写`);
    assert.equal(res.record, null, `${c.name} ⇒ ⛔ 不得返回一个「看起来写成了」的记录`);
    assert.ok(
      typeof res.reason === "string" && res.reason.includes(c.field),
      `${c.name} ⇒ reason 必须指名字段 ${c.field}（实际：${res.reason}）`,
    );
    const now = sha256(fs.readFileSync(ledgerFile(root)));
    assert.equal(now, before, `${c.name} ⇒ 文件字节哈希必须与调用前相同（一个字节都没写）`);
    evidence.push(`${c.name} → ok=${res.ok} reason=${res.reason}`);
  }
  assert.equal(readRelaxedDispatchLedger(root).records.length, 1, "只有最初那一行合法记录落盘");

  // 缺值**不折成 0**：把 `waitedMinutes` 读不到的记录拒掉，而不是写成「等了 0 分钟」。
  assert.equal(validateRelaxedDispatchRecord(ledgerRecord("T-ok", T0, { waitedMinutes: null })).ok, false);
  assert.ok(
    appendRelaxedDispatch(root, ledgerRecord("T-ok", T0, { waitedMinutes: null })).reason.includes("waitedMinutes"),
    "缺 waitedMinutes ⇒ 拒写并指名（⛔ 不写成 0）",
  );
  // 负控制：把同一行的 waitedMinutes 换成**真的量出来的 0** ⇒ 必须接受（0 与「缺值」不同形）。
  assert.equal(appendRelaxedDispatch(root, ledgerRecord("T-zero-wait", T0, { waitedMinutes: 0 })).ok, true);
});

// ── AC4 — 连接键是 task id，不是位置 ────────────────────────────────────────────────────────

test("AC4 — 账本行序 ≠ outcome 行序：连接按任务 id；按位置连接的投影必须与正确读数不同", () => {
  const root = mkRoot();
  const ledger = [ledgerRecord("T-A", T0), ledgerRecord("T-B", T0 + 120 * 60_000)];
  for (const rec of ledger) assert.equal(appendRelaxedDispatch(root, rec).ok, true);

  // outcome 行序：C(对照) → A-run1 → A-run2 → B-run1 —— 与账本行序 [A, B] 刻意错开。
  const outcomeLines = [
    outcomeLine({ task: "T-C", tsMs: T0 + 60 * 60_000, dispatchMs: T0 + 50 * 60_000, minutes: 8 }),
    outcomeLine({ task: "T-A", tsMs: T0 + 20 * 60_000, dispatchMs: T0, minutes: 10 }),
    outcomeLine({
      task: "T-A", tsMs: T0 + 40 * 60_000, dispatchMs: T0 + 15 * 60_000, minutes: 20,
      finalState: "exited-not-landed", mfi: { outcome: "red", step: "merge-develop", reason: "x" },
    }),
    outcomeLine({
      task: "T-B", tsMs: T0 + 140 * 60_000, dispatchMs: T0 + 120 * 60_000, minutes: 15,
      finalState: "exited-not-landed", mfi: { outcome: "red", step: "suite", reason: "y" },
    }),
  ];
  writeOutcome(root, outcomeLines);

  const report = buildRelaxedDispatchReport(root, { nowMs: T0 + 24 * 3_600_000 });
  const backLedger = readRelaxedDispatchLedger(root).records;
  assert.deepEqual(backLedger.map((r) => r.task), ["T-A", "T-B"], "账本回读的行序就是写入序");

  const rowA = report.relaxed.rows.find((r) => r.task === "T-A");
  const rowB = report.relaxed.rows.find((r) => r.task === "T-B");

  // 正确读数（按任务 id 连接该任务在 outcome 里的**全部**运行）。
  assert.equal(rowA.attempts, 2, "T-A 在 outcome 里有 2 条运行");
  assert.equal(rowA.workerMinutes, 30, "T-A = 10 + 20 分钟");
  assert.deepEqual(rowA.fanInFailureSteps, ["merge-develop"]);
  assert.equal(rowB.attempts, 1);
  assert.equal(rowB.workerMinutes, 15, "T-B = 15 分钟");
  assert.deepEqual(rowB.fanInFailureSteps, ["suite"]);
  assert.ok(report.controlTaskIds.includes("T-C"), "T-C：窗口内、未放宽、含 completed 运行 ⇒ 对照组");

  // **判别力**：按位置连接（ledger[i] ↔ outcome 第 i 行）的投影，必须与正确读数不同。
  const position = projectByPosition(backLedger, outcomeLines);
  assert.deepEqual(
    { A: position["T-A"], B: position["T-B"] },
    { A: { attempts: 1, workerMinutes: 8, step: null }, B: { attempts: 1, workerMinutes: 10, step: null } },
    "按位置投影：A ← outcome[0]（T-C 的 8 分钟那条）、B ← outcome[1]（T-A 的 10 分钟那条）",
  );
  assert.notEqual(position["T-A"].workerMinutes, rowA.workerMinutes, "按位置 ≠ 按 id（T-A 的分钟）");
  assert.notEqual(position["T-B"].workerMinutes, rowB.workerMinutes, "按位置 ≠ 按 id（T-B 的分钟）");
  assert.notEqual(position["T-A"].attempts, rowA.attempts, "按位置 ≠ 按 id（T-A 的尝试次数）");
  assert.notDeepEqual(position["T-A"].step, rowA.fanInFailureSteps[0], "按位置投影连失败步都对不上");
});

// ── AC5 — extraWorkerMinutes 口径与对照组 ──────────────────────────────────────────────────

test("AC5 — 放宽组 30 分钟 vs 对照组 10/20/30 ⇒ 中位 20 ⇒ extra = 10；且读数 ≠ wall_clock_ms 口径", () => {
  const root = mkRoot();
  assert.equal(appendRelaxedDispatch(root, ledgerRecord("T-relax-A", T0)).ok, true);
  assert.equal(appendRelaxedDispatch(root, ledgerRecord("T-relax-B", T0 + 30 * 60_000)).ok, true);

  const outcomeLines = [
    // 放宽任务 A：运行段 = 30 分钟，但 **wall_clock_ms = 90 分钟**（含 fan-in）——两者必须被读成不同的量。
    outcomeLine({ task: "T-relax-A", tsMs: T0 + 30 * 60_000, dispatchMs: T0, minutes: 30, wallMinutes: 90 }),
    outcomeLine({ task: "T-relax-B", tsMs: T0 + 60 * 60_000, dispatchMs: T0 + 30 * 60_000, minutes: 30, wallMinutes: 45 }),
    // 对照组：窗口 [T0, T0+30min] 内的、未放宽的、含 completed 运行的任务。
    outcomeLine({ task: "T-ctl-10", tsMs: T0, dispatchMs: T0 - 60 * 60_000, minutes: 10 }),
    outcomeLine({ task: "T-ctl-20", tsMs: T0, dispatchMs: T0 - 60 * 60_000, minutes: 20 }),
    outcomeLine({ task: "T-ctl-30", tsMs: T0, dispatchMs: T0 - 60 * 60_000, minutes: 30 }),
  ];
  writeOutcome(root, outcomeLines);

  const report = buildRelaxedDispatchReport(root, { nowMs: T0 + 24 * 3_600_000 });
  assert.equal(report.evaluated, true, `evaluated=true 时 reason 必须为 null（实际：${report.reason}）`);
  assert.equal(report.reason, null);

  assert.equal(report.window.sinceMs, T0);
  assert.equal(report.window.untilMs, T0 + 30 * 60_000, "窗口 = 账本 dispatchedAt 的最早 → 最晚");

  assert.deepEqual(report.controlTaskIds, ["T-ctl-10", "T-ctl-20", "T-ctl-30"], "对照组任务清单逐字");
  assert.equal(report.control.tasks, 3);
  assert.equal(report.control.workerMinutesMedian, 20, "10/20/30 的中位数 = 20");
  assert.equal(report.relaxed.workerMinutesMedian, 30, "30/30 的中位数 = 30");

  const rowA = report.relaxed.rows.find((r) => r.task === "T-relax-A");
  assert.equal(rowA.workerMinutes, 30, "worker 运行段 = worker_exited_at − dispatched_at");
  assert.equal(rowA.extraWorkerMinutes, 10, "30 − 20 = 10");
  assert.equal(report.extraWorkerMinutes, 10, "放宽组中位数 − 对照组中位数 = 30 − 20 = 10");

  // **口径真的换了**，不是巧合相等：独立算出 wall_clock_ms 口径的同一条运行 = 90 分钟。
  const wallClockMinutes = JSON.parse(outcomeLines[0]).wall_clock_ms / 60_000;
  assert.equal(wallClockMinutes, 90);
  assert.notEqual(wallClockMinutes, rowA.workerMinutes, "wall_clock_ms 口径（含 fan-in）= 90 ≠ 本读数 30");

  // 「同一个 toAttemptRecord 归一化」：独立用 toAttemptRecord 复算对照组的分钟，必须与报告一致。
  const independentControl = outcomeLines
    .slice(2)
    .map((l) => toAttemptRecord(JSON.parse(l)))
    .map((ar) => (ar.workerExitedAtMs - ar.dispatchedAtMs) / 60_000)
    .sort((a, b) => a - b);
  assert.deepEqual(independentControl, [10, 20, 30]);
  assert.deepEqual(
    report.control.rows.map((r) => r.workerMinutes),
    [10, 20, 30],
    "对照组逐任务分钟与独立复算一致（同一个归一化函数 ⇒ 口径相同是结构性质）",
  );
});

// ── AC6 — fanInFailureSteps 的来处与词表隔离 ───────────────────────────────────────────────

test("AC6 — fanInFailureSteps 逐字取自 mechanical_fan_in.step；与 final_state 是两个字段两个词表", () => {
  const root = mkRoot();
  assert.equal(appendRelaxedDispatch(root, ledgerRecord("T-mix", T0)).ok, true);

  const outcomeLines = [
    outcomeLine({ task: "T-mix", tsMs: T0, dispatchMs: T0, minutes: 1, finalState: "exited-not-landed", mfi: { outcome: "red", step: "merge-develop", reason: "x" } }),
    outcomeLine({ task: "T-mix", tsMs: T0 + 60_000, dispatchMs: T0, minutes: 2, finalState: "completed" }),
    outcomeLine({ task: "T-mix", tsMs: T0 + 120_000, dispatchMs: T0, minutes: 3, finalState: "exited-not-landed", mfi: { outcome: "red", step: "suite", reason: "y" } }),
    // 失败但**没有 mechanical_fan_in** ⇒ 不产出 step 值（⛔ 不写 "unknown"、⛔ 不折成 0）。
    outcomeLine({ task: "T-mix", tsMs: T0 + 180_000, dispatchMs: T0, minutes: 4, finalState: "killed" }),
    // 有 mechanical_fan_in 但**没有 step** ⇒ 同样产不出 step 值，同样单独计入。
    outcomeLine({ task: "T-mix", tsMs: T0 + 240_000, dispatchMs: T0, minutes: 5, finalState: "exited-not-landed", mfi: { outcome: "red", reason: "z" } }),
  ];
  writeOutcome(root, outcomeLines);

  const report = buildRelaxedDispatchReport(root, { nowMs: T0 + 24 * 3_600_000 });
  const row = report.relaxed.rows.find((r) => r.task === "T-mix");

  assert.deepEqual(row.fanInFailureSteps, ["merge-develop", "suite"], "逐字取自 step，按出现序去重");
  assert.equal(row.attempts, 5);
  assert.equal(row.completedRuns, 1);
  assert.equal(row.failedRuns, 4);
  assert.equal(row.failuresWithoutStep, 2, "无 mechanical_fan_in 的一条 + 有它但无 step 的一条");

  // 词表隔离：step 取值不得与 final_state 词表互串。
  for (const forbidden of ["exited-not-landed", "completed", "landed", "unknown"]) {
    assert.ok(!row.fanInFailureSteps.includes(forbidden), `fanInFailureSteps 不得含 ${forbidden}`);
  }
  // 两个字段是两个不同的投影（final_state 面里根本没有 step 的取值，反之亦然）。
  assert.deepEqual(row.finalStates, { "exited-not-landed": 3, completed: 1, killed: 1 });
  assert.notDeepEqual([...row.fanInFailureSteps].sort(), Object.keys(row.finalStates).sort(), "两个词表不得同形");
});

// ── AC7 — 样本不足 ⇒ evaluated:false，且不伪装成 0 ──────────────────────────────────────────

/** 造一个可参数化的场景：`relaxedCount` 个**可测**放宽任务 + `controlCount` 个对照任务。
 *  `relaxedCount === 0` 时仍写一条账本记录（其任务运行段不可测）——它是**窗口**的来源，
 *  同时让「放宽侧可测任务数 = 0」这一侧真的存在。 */
function scenario(relaxedCount, controlCount) {
  const root = mkRoot();
  const lines = [];
  const relaxedTimes = [];
  for (let i = 0; i < relaxedCount; i++) {
    const t = T0 + i * 30 * 60_000;
    relaxedTimes.push(t);
    assert.equal(appendRelaxedDispatch(root, ledgerRecord(`T-relax-${i}`, t)).ok, true);
    lines.push(outcomeLine({ task: `T-relax-${i}`, tsMs: t + 60_000, dispatchMs: t, minutes: 30 }));
  }
  if (relaxedCount === 0) {
    relaxedTimes.push(T0);
    assert.equal(appendRelaxedDispatch(root, ledgerRecord("T-relax-unmeasurable", T0)).ok, true);
    // 运行段不可测（无 worker_exited_at）⇒ 该任务不计入可测任务数。
    lines.push(outcomeLine({ task: "T-relax-unmeasurable", tsMs: T0, dispatchMs: T0, minutes: null }));
  }
  const windowStart = Math.min(...relaxedTimes);
  for (let i = 0; i < controlCount; i++) {
    lines.push(outcomeLine({ task: `T-ctl-${i}`, tsMs: windowStart, dispatchMs: windowStart - 3_600_000, minutes: 10 + i }));
  }
  writeOutcome(root, lines);
  return buildRelaxedDispatchReport(root, { nowMs: T0 + 24 * 3_600_000 });
}

test("AC7 — 三组样本不足的 fixture：evaluated:false + reason 指名不足的一侧 + 数值取 NOT_EVALUATED(≠0)", () => {
  // (a) 账本空
  const emptyRoot = mkRoot();
  writeOutcome(emptyRoot, [outcomeLine({ task: "T-only", tsMs: T0, dispatchMs: T0 - 60_000, minutes: 10 })]);
  const a = buildRelaxedDispatchReport(emptyRoot, { nowMs: T0 + 3_600_000 });
  assert.equal(a.evaluated, false);
  assert.match(a.reason, /relaxed side/, "reason 必须指名放宽侧");
  assert.match(a.reason, new RegExp(`relaxed=0, control=0`), "reason 必须带两侧计数");
  assert.equal(a.extraWorkerMinutes, NOT_EVALUATED);
  assert.notEqual(a.extraWorkerMinutes, 0, "⛔ 不得输出 0 伪装成「无额外成本」");
  assert.equal(a.control.workerMinutesMedian, NOT_EVALUATED);
  assert.notEqual(a.control.workerMinutesMedian, 0);
  assert.equal(a.ledger.present, false, "载体缺席与 records:[] 不同形");

  // (b) 有放宽、无对照
  const b = scenario(2, 0);
  assert.equal(b.evaluated, false);
  assert.match(b.reason, /control side/, "reason 必须指名对照侧");
  assert.match(b.reason, /relaxed=2, control=0/);
  assert.equal(b.extraWorkerMinutes, NOT_EVALUATED);
  assert.notEqual(b.extraWorkerMinutes, 0);
  assert.equal(b.control.workerMinutesMedian, NOT_EVALUATED);
  assert.notEqual(b.control.workerMinutesMedian, 0);

  // (c) 有对照、放宽侧测不出
  const c = scenario(0, 3);
  assert.equal(c.evaluated, false);
  assert.match(c.reason, /relaxed side/, "reason 必须指名放宽侧");
  assert.match(c.reason, /relaxed=0, control=3/, "两侧计数都在");
  assert.equal(c.extraWorkerMinutes, NOT_EVALUATED);
  assert.notEqual(c.extraWorkerMinutes, 0);
  assert.equal(c.relaxed.measurableTasks, 0);
  assert.equal(c.control.measurableTasks, 3);

  // 两向断言，用模块导出的下限常量造样本数（⛔ 测试内不写这个数字的字面量）。
  assert.ok(MIN_COMPARABLE_TASKS >= 1, "下限常量必须是 ≥1 的具名导出");
  const below = scenario(MIN_COMPARABLE_TASKS - 1, MIN_COMPARABLE_TASKS);
  assert.equal(below.evaluated, false, `可测任务数 = 下限−1 = ${MIN_COMPARABLE_TASKS - 1} ⇒ evaluated:false`);
  const at = scenario(MIN_COMPARABLE_TASKS, MIN_COMPARABLE_TASKS);
  assert.equal(at.evaluated, true, `可测任务数 = 下限 = ${MIN_COMPARABLE_TASKS} ⇒ evaluated:true`);
  assert.notEqual(at.extraWorkerMinutes, NOT_EVALUATED, "达标时 extra 是真读数（此处两组同为 30/10 ⇒ 20）");
  assert.equal(at.relaxed.workerMinutesMedian, 30);
  assert.equal(at.control.workerMinutesMedian, 10);
  assert.equal(at.extraWorkerMinutes, 20);
});

// ── CLI 表层 ───────────────────────────────────────────────────────────────────────────────

test("CLI 参数解析：--report 必需、未知参数与缺值的 --root ⇒ 用法错误（exit 2 的判据）", () => {
  assert.deepEqual(parseCliArgs(["--report"]), { ok: true, reason: null, root: process.cwd(), json: false, report: true });
  assert.equal(parseCliArgs(["--report", "--json"]).json, true);
  assert.equal(parseCliArgs(["--report", "--root", "/tmp/x"]).root, "/tmp/x");
  assert.equal(parseCliArgs([]).ok, false, "缺 --report ⇒ 用法错误");
  assert.equal(parseCliArgs(["--report", "--nope"]).ok, false, "未知参数 ⇒ 用法错误");
  assert.equal(parseCliArgs(["--report", "--root"]).ok, false, "--root 缺值 ⇒ 用法错误");
  assert.match(parseCliArgs(["--report", "--root"]).reason, /--root/);
});
