// @test-group engine
// touches-relax-auto-tighten.test.mjs — GOAL-037 AC-367（tasks/gap-touches-relax-auto-tighten-loop-absent）
//
// WHY THIS EXISTS：放宽派发此前是一个**单向棘轮** —— AC-363 造出了「放宽比不放宽多花多少」的读数、
// AC-366 让 `mode: live` 真的放行，但**没有任何机件在超预算时把它收回来**：`plugin/scripts/` 全文
// grep `relax_halted` / `auto_tighten` 零命中。本文件是那条闭环的判据面：读配置 → 判定 → 写既有
// 控制态 → 留痕，四步都从**载体文件回读**核对。
//
// 判别力从哪来（硬规则 4：结构上不可能取假的量不是测量）——
//   「测试存在且 55s 内绿」**单独不具备判别力**：它区分不了「真收紧」与「恒真断言」。判别力由四处提供：
//   ① AC2 的**三态**：样本不足 / 阈值没配 / 缺 `min_samples` 三个 fixture 各判 not-evaluated 且
//      **载体字节不变**（⛔ 不动作），反方向「阈值与样本齐 ⇒ evaluated:true」；
//   ② AC4 的**分步**：suite 红与 merge-develop 红是两条独立条目、给出**不同**的 reason；且
//      「一条无 `mechanical_fan_in` 的失败」与「一条有它但无 step 的失败」各做一次**差分**读数
//      （前者不改变任何分子/分母，后者只动分母不动分子）；
//   ③ AC3 / AC5 / AC6 的**负控制**：把阈值调到读数之上 ⇒ `relax_halted` 保持 false；把闸清成 false
//      ⇒ 同一候选被放宽；清零后读数仍超阈值 ⇒ 再写回 true；
//   ④ AC9 的**两次注入真红**（见 Evidence，不落在本文件里——注入不得留在落地代码里）。
//
// 全部读数从**载体文件回读**（`.quay/worker-control.json` / `.quay/worker-round.jsonl` /
// `.quay/relaxed-dispatch.jsonl`），⛔ 不把内存对象当成「已落盘」（硬规则 4c）。
//
// Run: timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-auto-tighten.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  applyAutoTighten,
  evaluateAutoTighten,
  toRoundRecord,
  TIGHTEN_VERDICTS,
  NOT_STEP_TOKENS,
} from "../scripts/touches-relax-tighten.ts";
import { runAutoTightenPass, computeWorkerRoundRecord, WORKER_ROUND_REL } from "../scripts/worker-driver.ts";
import {
  appendRelaxedDispatch,
  buildRelaxedDispatchReport,
  RELAXED_DISPATCH_REL,
} from "../scripts/relaxed-dispatch-ledger.ts";
import { applyTaskFilters, makeFilterContext, LIVE_RELAX_CONDITIONS, RELAX_CONDITIONS } from "../scripts/driver-filters.ts";
import { loadTouchesRelaxConfig, parseTouchesRelaxSection, TOUCHES_RELAX_MODES } from "../scripts/touches-relax-config.ts";
import { readControlState, CONTROL_STATE_REL } from "../scripts/driver-shared.ts";
import { appendHeartbeatLine } from "../scripts/driver-runtime.ts";
import { NOT_EVALUATED, readJsonl } from "../scripts/duration-report.ts";

// ── fixture 基座 ──────────────────────────────────────────────────────────────────────────────────

/** 本文件建过的 fixture 根。顶层 `after()` 统一删（`tmp-leak-pairing-check` 要求 mkdtemp 有配对清理）。 */
const TMP_ROOTS = [];
after(() => {
  for (const d of TMP_ROOTS) fs.rmSync(d, { recursive: true, force: true });
});

/** 注入时钟：全部等待/窗口读数都相对它算（⛔ 不用 `Date.now()`——那样的读数不可判）。 */
const NOW_MS = Date.parse("2026-10-17T12:00:00.000Z");
/** 「NOW 之前 m 分钟」的 ISO。 */
const at = (m) => new Date(NOW_MS - m * 60_000).toISOString();

const RELAXED_A = "gap-tighten-a"; // 放宽组①（4 条走到 fan-in 的运行 +（按需）1 条不进 fan-in 的失败）
const RELAXED_B = "gap-tighten-b"; // 放宽组②（让时间窗有跨度、样本数可为 2）
const CTL_1 = "gap-tighten-ctl-1";
const CTL_2 = "gap-tighten-ctl-2";
const CTL_3 = "gap-tighten-ctl-3";
const SHARED = "plugin/scripts/shared.ts";

// ── fixture 装配 ──────────────────────────────────────────────────────────────────────────────────

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `touches-relax-tighten-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  TMP_ROOTS.push(dir);
  return dir;
}

/** 极小 YAML 发射器（只覆盖本文件的 fixture 形状：标量 / 字符串数组 / 两层 mapping、空 mapping）。
 *  ⛔ 不引 YAML 库——fixture 的**字节**要由本文件说了算（AC11③ 读的就是它）。 */
function emitYaml(lines, obj, indent) {
  const pad = " ".repeat(indent);
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      for (const el of v) lines.push(`${pad}  - ${el}`);
    } else if (v !== null && typeof v === "object") {
      if (Object.keys(v).length === 0) lines.push(`${pad}${k}: {}`);
      else {
        lines.push(`${pad}${k}:`);
        emitYaml(lines, v, indent + 2);
      }
    } else {
      lines.push(`${pad}${k}: ${v}`);
    }
  }
}

/** 写 `.quay/config.yml`（真 `loop:` mapping）。`relax === null` ⇒ **不写** touches_relax 块。 */
function writeConfig(root, relax) {
  const lines = ["loop:", "  board: native"];
  if (relax !== null) {
    lines.push("  touches_relax:");
    emitYaml(lines, relax, 4);
  }
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), `${lines.join("\n")}\n`, "utf8");
}

const readFile = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const hashOf = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** 一条真实形状的 `worker-outcome.jsonl` 记录。`mfi`：
 *   · `null`        ⇒ **不带** `mechanical_fan_in`（这条失败不进任何 step 的分子**或**分母）；
 *   · `{step:null}` ⇒ 带 `mechanical_fan_in` 但没有 step（进分母、不进任何分子）；
 *   · `{step:"suite"}` ⇒ 带 step。 */
function outcomeRow(task, { dispatchedMinAgo, exitedMinAgo, finalState, mfi = null }) {
  const rec = {
    task,
    ts: at(exitedMinAgo),
    run_id: `fixture-${task}-${dispatchedMinAgo}`,
    final_state: finalState,
    dispatched_at: at(dispatchedMinAgo),
    worker_exited_at: at(exitedMinAgo),
    // 故意给一个远大于真实运行段的墙钟值：若实现误用 `wall_clock_ms` 当 worker 运行段，读数会明显不同
    // （Plan §2：worker 分钟 = `worker_exited_at − dispatched_at`，⛔ 不用 wall_clock_ms——它含 fan-in）。
    wall_clock_ms: 9_999_999,
  };
  if (mfi !== null) rec.mechanical_fan_in = { outcome: finalState === "completed" ? "landed" : "red", step: mfi.step };
  return rec;
}

function appendOutcome(root, rec) {
  fs.appendFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), `${JSON.stringify(rec)}\n`, "utf8");
}

/** 基线放宽配置。`auto === undefined` ⇒ 子块**不存在**；三个键也可各自省略。 */
function baseRelax(auto, overrides = {}) {
  const relax = { mode: "live", after_minutes: 30, max_relaxed_inflight: 5, shared_files: [], never_relax: [] };
  if (auto !== undefined) relax.auto_tighten = auto;
  return { ...relax, ...overrides };
}

/** 一套「阈值与样本都齐、全部在预算内」的阈值（正控制的起点；各用例再按需压其中一条）。 */
const GENEROUS = { min_samples: 2, max_extra_worker_minutes: 1000, max_fan_in_failure_rate: { suite: 0.99, "merge-develop": 0.99 } };

/**
 * 基线 fixture（放宽组 2 个任务 + 对照 3 个任务）——
 *   放宽组 A：4 条走到 fan-in 的运行（1 landed、suite 红 ×2、merge-develop 红 ×1）+ `extraFailure`
 *             指定的第 5 条失败；worker 分钟 = 20+20+20+10(+10) = 70 或 80。
 *   放宽组 B：1 条 landed 运行，90 分钟。
 *   对照组：3 条 completed 运行（20 / 15 / 10 分钟）⇒ 中位数 15 分钟。
 *   ⇒ 放宽组中位数 = 70 或 80（取排序后第 0 位）⇒ extra = 55 或 **65** 分钟（默认 extraFailure 下）。
 *   ⇒ fanInReached = 4（或 5，见 `extraFailure: "keyless-mfi"`）；suite 率 = 2/4，merge-develop 率 = 1/4。
 * 时间窗 = 账本记录 `dispatchedAt` 的 min..max；对照组的 `ts` 落在其中。
 */
function buildTightenFixture(
  tag,
  { relax = baseRelax(GENEROUS), extraFailure = "no-mfi", ledger = true, controlState = null } = {},
) {
  const root = makeRoot(tag);
  writeConfig(root, relax);

  if (ledger) {
    for (const r of [
      { task: RELAXED_A, blockers: ["gap-tighten-blocker-a"], overlapFiles: [SHARED], waitedMinutes: 45, dispatchedAt: at(200) },
      { task: RELAXED_B, blockers: ["gap-tighten-blocker-b"], overlapFiles: [SHARED], waitedMinutes: 50, dispatchedAt: at(100) },
    ]) {
      const res = appendRelaxedDispatch(root, r);
      assert.equal(res.ok, true, `fixture 账本记录必须写进去（${res.reason}）`);
    }
  }

  const extraRow = {
    // 一条**无** `mechanical_fan_in` 的失败：分子分母都不进（AC4 的负控制）。
    "no-mfi": [outcomeRow(RELAXED_A, { dispatchedMinAgo: 90, exitedMinAgo: 80, finalState: "exited-not-landed", mfi: null })],
    // 一条**有** `mechanical_fan_in` 但没有 step 的失败：进分母、不进任何分子（AC4 的第二个负控制）。
    "keyless-mfi": [outcomeRow(RELAXED_A, { dispatchedMinAgo: 90, exitedMinAgo: 80, finalState: "exited-not-landed", mfi: { step: null } })],
    none: [],
  }[extraFailure];
  assert.ok(extraRow !== undefined, `未知的 extraFailure=${extraFailure}`);

  for (const rec of [
    outcomeRow(RELAXED_A, { dispatchedMinAgo: 200, exitedMinAgo: 180, finalState: "completed", mfi: { step: null } }),
    outcomeRow(RELAXED_A, { dispatchedMinAgo: 170, exitedMinAgo: 150, finalState: "exited-not-landed", mfi: { step: "suite" } }),
    outcomeRow(RELAXED_A, { dispatchedMinAgo: 140, exitedMinAgo: 120, finalState: "exited-not-landed", mfi: { step: "suite" } }),
    outcomeRow(RELAXED_A, { dispatchedMinAgo: 110, exitedMinAgo: 100, finalState: "exited-not-landed", mfi: { step: "merge-develop" } }),
    ...extraRow,
    outcomeRow(RELAXED_B, { dispatchedMinAgo: 100, exitedMinAgo: 10, finalState: "completed", mfi: { step: null } }),
    outcomeRow(CTL_1, { dispatchedMinAgo: 150, exitedMinAgo: 130, finalState: "completed", mfi: { step: null } }),
    outcomeRow(CTL_2, { dispatchedMinAgo: 150, exitedMinAgo: 135, finalState: "completed", mfi: { step: null } }),
    outcomeRow(CTL_3, { dispatchedMinAgo: 120, exitedMinAgo: 110, finalState: "completed", mfi: { step: null } }),
  ]) {
    appendOutcome(root, rec);
  }

  // 控制态载体**恒存在**（这样「写没写」的判据是字节比对，而不是「文件在不在」——后者会把
  // 「本来就没这个文件」与「写了又删」混成一件事）。缺 `relax_halted` 键 = 旧载体。
  writeControlStateRaw(
    root,
    controlState ?? { schemaVersion: 1, halted: false, halted_by: null, halted_at: null, preference: {}, forced: [] },
  );
  return root;
}

/** 直接写控制态**载体的原始 JSON**（⛔ 不经 `writeControlState`——AC7 要比对「那几类字段逐字不变」，
 *  起点必须由本文件说了算，而不是由被测写入器格式化出来的那一份）。 */
function writeControlStateRaw(root, obj) {
  fs.writeFileSync(path.join(root, CONTROL_STATE_REL), `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

/** 从**载体文件**回读控制态（⛔ 不用内存对象冒充「落盘了」）。 */
const readControlStateFile = (root) => JSON.parse(readFile(root, CONTROL_STATE_REL));

/** `.quay/` 下的文件名清单（排序；⛔ 排除 `.tmp-*` 瞬时态——`writeJsonAtomic` 写一半时的中间文件）。 */
const listQuay = (root) =>
  fs.readdirSync(path.join(root, ".quay")).filter((n) => !n.includes(".tmp-")).sort();

/** 跑一次**真实**评估（不经 driver）：读配置 → 建 AC-363 报告 → 判定。⛔ 不 mock 判定。 */
function evaluate(root) {
  const load = loadTouchesRelaxConfig(root);
  const config = load.config ?? { mode: "off", shared_files: [], never_relax: [] };
  return { load, decision: evaluateAutoTighten(root, { nowMs: NOW_MS, config, report: buildReport(root) }) };
}

const buildReport = (root) => buildRelaxedDispatchReport(root, { nowMs: NOW_MS });

/** 一条真实形状的 `to:"ready"` 状态事件（生产载体 `.quay/task-status-events.jsonl`）。 */
function writeReadyEvents(root, pairs) {
  const lines = pairs.map(([taskId, isoAt], i) => {
    const seq = i + 1;
    return JSON.stringify({
      schema: "task-status-event/v1",
      seq,
      eventId: `fixture-evt-${seq}`,
      carrierEpoch: "fixture-epoch",
      taskId,
      from: "todo",
      to: "ready",
      kind: "forward",
      at: isoAt,
      recordedAt: isoAt,
      actor: { kind: "cli", id: "fixture" },
    });
  });
  fs.writeFileSync(path.join(root, ".quay", "task-status-events.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

// ══ AC1 的判据面就是本文件本身（`timeout 55 node --test` exit 0）══════════════════════════════════

// ══ AC2 — (a) 三态可分 + 两向 ═════════════════════════════════════════════════════════════════════

test("AC2(a) — 样本不足 / 阈值未配置 / 缺 min_samples ⇒ not-evaluated 且【不动作】（载体字节不变）；两向：齐备 ⇒ evaluated", (t) => {
  const cases = [
    {
      tag: "ac2-samples",
      // 账本里有 2 条记录，配置要求 5 ⇒ 样本不足（阈值是**读到了的**，缺的是样本）。
      relax: baseRelax({ ...GENEROUS, min_samples: 5 }),
      expectNames: ["样本不足", "samples=2", "min_samples=5"],
    },
    {
      tag: "ac2-noblock",
      // 整块 `auto_tighten:` 都不存在 ⇒ 阈值未配置。
      relax: baseRelax(undefined),
      expectNames: ["thresholds not configured", "auto_tighten (the whole sub-block is absent)"],
    },
    {
      tag: "ac2-nominkey",
      // 子块在、另两个键也在，但 `min_samples` 缺 ⇒ 具名点出缺的是哪一个键（写了的那两个照读）。
      relax: baseRelax({ max_extra_worker_minutes: 1000, max_fan_in_failure_rate: { suite: 0.99 } }),
      expectNames: ["thresholds not configured", "min_samples"],
    },
  ];

  for (const c of cases) {
    const root = buildTightenFixture(c.tag, { relax: c.relax });
    const before = readFile(root, CONTROL_STATE_REL);
    const { decision } = evaluate(root);

    assert.equal(decision.evaluated, false, `${c.tag}: evaluated === false（实得 ${decision.evaluated}）`);
    assert.equal(decision.verdict, "not-evaluated", `${c.tag}: verdict = not-evaluated（实得 ${decision.verdict}）`);
    for (const token of c.expectNames) {
      assert.ok(
        decision.reason.includes(token),
        `${c.tag}: reason 必须逐字点名 ${JSON.stringify(token)}；实得 ${JSON.stringify(decision.reason)}`,
      );
    }
    // 硬规则 3b：读数里「没读到的阈值」/「没读到的额外成本」不得取 0 或空均值。
    assert.notEqual(decision.readings.maxExtraWorkerMinutes, 0, `${c.tag}: 未读到的额外成本阈值 ⛔ 不得是 0`);
    assert.notEqual(decision.readings.minSamples, 0, `${c.tag}: 未读到的 min_samples ⛔ 不得是 0`);
    if (c.tag === "ac2-noblock") {
      assert.equal(decision.readings.minSamples, NOT_EVALUATED, "整块不存在 ⇒ min_samples 取 NOT_EVALUATED");
      assert.equal(decision.readings.maxExtraWorkerMinutes, NOT_EVALUATED, "整块不存在 ⇒ 额外成本阈值取 NOT_EVALUATED");
      assert.equal(decision.readings.fanIn.length, 0, "速率阈值未配置 ⇒ 没有可判的分步条目（⛔ 不用内置阈值造条目）");
      assert.deepEqual(decision.readings.fanIn, [], "⛔ 不得凭空造出一条分步条目");
    }
    if (c.tag === "ac2-nominkey") {
      assert.equal(decision.readings.minSamples, NOT_EVALUATED, "缺的那个键 ⇒ NOT_EVALUATED");
      assert.equal(decision.readings.maxExtraWorkerMinutes, 1000, "**写了**的那个键照读（⛔ 不因另一个键缺失就一起丢）");
      assert.equal(decision.readings.fanIn.length, 0, "阈值未配齐 ⇒ 不判分步（⛔ 不用内置阈值造条目）");
    }
    if (c.tag === "ac2-samples") {
      assert.equal(decision.readings.samples, 2);
      assert.equal(decision.readings.minSamples, 5);
      assert.equal(decision.readings.maxExtraWorkerMinutes, 1000, "阈值真的从配置读到了");
      assert.equal(decision.readings.fanIn.length, 2, "样本不足那一步之前阈值已读到 ⇒ 分步条目已在（缺的是样本）");
    }

    // ── 「不动作」的判据：apply 对非 halt 的 verdict 必须一个字节都不写（这是**结构上**的：
    //    拒绝的理由在 applyAutoTighten 内部，⛔ 不靠调用方记得别调）。
    const applied = applyAutoTighten(root, decision);
    assert.equal(applied.applied, false, `${c.tag}: not-evaluated ⛔ 不得落盘`);
    assert.equal(readFile(root, CONTROL_STATE_REL), before, `${c.tag}: 控制态载体必须逐字节不变`);
    assert.equal(readControlStateFile(root).relax_halted, undefined, `${c.tag}: ⛔ 不得写 relax_halted`);

    console.log(`[AC2] ${c.tag}: verdict=${decision.verdict} reason=${JSON.stringify(decision.reason)}`);
    console.log(`[AC2] ${c.tag}: 载体 sha256=${hashOf(before)}（前后同一份）applied=${applied.applied}`);
  }

  // ── 两向：阈值与样本都齐 ⇒ evaluated === true（证明判据不是恒 false）。
  const okRoot = buildTightenFixture("ac2-positive", { relax: baseRelax(GENEROUS) });
  const { decision: okDecision } = evaluate(okRoot);
  assert.equal(okDecision.evaluated, true, `阈值与样本齐 ⇒ evaluated === true（实得 verdict=${okDecision.verdict}，reason=${okDecision.reason}）`);
  assert.equal(okDecision.verdict, "within-budget", `且未超预算（实得 ${okDecision.verdict}：${okDecision.reason}）`);
  assert.equal(okDecision.thresholdsConfigured, true);
  // 读数真的来自载体：extraWorkerMinutes = 放宽组中位数(80) − 对照组中位数(15) = 65。
  assert.equal(okDecision.readings.extraWorkerMinutes, 65, `extra worker 分钟逐值可算（实得 ${okDecision.readings.extraWorkerMinutes}）`);
  assert.equal(okDecision.readings.maxExtraWorkerMinutes, 1000, "阈值逐字来自配置");
  assert.equal(okDecision.readings.samples, 2);
  assert.equal(okDecision.readings.minSamples, 2);
  assert.equal(okDecision.readings.fanInReached, 5, "分母 = 放宽组走到 fan-in 的运行数（A 的 4 条 + B 的 1 条）");
  console.log(`[AC2] 正控制: verdict=${okDecision.verdict} extra=${okDecision.readings.extraWorkerMinutes}min reason=${JSON.stringify(okDecision.reason)}`);
});

// ══ AC3 — (b) 超阈值 ⇒ 写既有控制态载体（+ 负控制） ═══════════════════════════════════════════════

test("AC3(b) — 额外 worker 分钟超阈值 ⇒ 从载体回读 relax_halted:true、⛔ 不新增文件、round 记录带原因与读数；负控制：阈值抬到读数之上 ⇒ 保持 false", (t) => {
  const rateHigh = { suite: 0.99, "merge-develop": 0.99 };

  // 正方向：extra=65 > 30 ⇒ halt。速率阈值给足，隔离出「额外成本」这一维。
  const over = buildTightenFixture("ac3-over", { relax: baseRelax({ ...GENEROUS, max_extra_worker_minutes: 30, max_fan_in_failure_rate: rateHigh }) });
  const quayBefore = listQuay(over);
  const { decision: overDecision } = evaluate(over);
  assert.equal(overDecision.verdict, "halt", `超阈值 ⇒ halt（实得 ${overDecision.verdict}：${overDecision.reason}）`);
  assert.ok(overDecision.reason.includes("extra worker minutes"), `reason 点名是哪一维：${overDecision.reason}`);

  const overApplied = applyAutoTighten(over, overDecision);
  assert.equal(overApplied.applied, true, "verdict=halt ⇒ 真的落盘");
  // ── 回读（⛔ 不是内存对象）。
  const overState = readControlStateFile(over);
  assert.equal(overState.relax_halted, true, `从载体回读 relax_halted === true（实得 ${JSON.stringify(overState.relax_halted)}）`);
  assert.equal(readControlState(over).state.relax_halted, true, "经既有 readControlState 也读到 true（写面/读面同源）");
  // ── ⛔ 不新造哨兵文件：`.quay/` 下不得新增任何文件（排除 .tmp 瞬时态）。
  const quayAfter = listQuay(over);
  assert.deepEqual(quayAfter, quayBefore, `⛔ 不得新增任何文件（前后：${JSON.stringify(quayBefore)} → ${JSON.stringify(quayAfter)}）`);
  assert.deepEqual(quayAfter, ["config.yml", "relaxed-dispatch.jsonl", "worker-control.json", "worker-outcome.jsonl"], "载体清单逐字（无新哨兵）");

  // ── 写面确实是既有机制：`applyAutoTighten` 的落盘经 kernel 的 writeControlState（读它的实现面）。
  const tightenSource = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "touches-relax-tighten.ts"), "utf8");
  assert.ok(tightenSource.includes("writeControlState(root, next)"), "写路径调用既有 writeControlState");
  assert.ok(!/writeFileSync\s*\(/.test(tightenSource), "⛔ 本模块不直接 writeFileSync（唯一写面 = 既有控制态写入器）");
  assert.ok(tightenSource.includes("CONTROL_STATE_REL"), "落点 = 既有 CONTROL_STATE_REL（⛔ 不新哨兵文件）");

  // ── round 记录带原因与读数（走生产装配：真实 pass + 真实 round 记录构造）。
  const round = runAutoTightenPass(over, NOW_MS);
  assert.notEqual(round, null, "第二轮：本轮确实跑了该步（对象，⛔ 不是 null）");
  assert.equal(round.verdict, "halt");
  assert.equal(round.applied, false, "第二次：已经是 true ⇒ 不重复落盘（applied:false，但读数照记）");
  assert.ok(round.reason.includes("extra worker minutes"), "round 记录带原因");
  assert.equal(round.readings.maxExtraWorkerMinutes, 30, "round 记录带【实际用的】阈值（读到的，⛔ 不是内置的）");
  assert.equal(round.readings.extraWorkerMinutes, 65, "round 记录带读数");

  console.log(`[AC3] 正方向: verdict=${overDecision.verdict} extra=${overDecision.readings.extraWorkerMinutes} > ${overDecision.readings.maxExtraWorkerMinutes}`);
  console.log(`[AC3] 载体回读 = ${JSON.stringify(overState)}`);
  console.log(`[AC3] round.auto_tighten = ${JSON.stringify({ verdict: round.verdict, reason: round.reason, applied: round.applied, maxExtra: round.readings.maxExtraWorkerMinutes })}`);
  console.log(`[AC3] .quay/ 清单 = ${JSON.stringify(quayAfter)}`);

  // ── 负控制：**同一份读数**，只把阈值抬到它之上 ⇒ 同一次评估不得收紧（证明判据真读了读数，不是恒真）。
  const under = buildTightenFixture("ac3-under", { relax: baseRelax({ ...GENEROUS, max_extra_worker_minutes: 120, max_fan_in_failure_rate: rateHigh }) });
  const { decision: underDecision } = evaluate(under);
  assert.equal(underDecision.evaluated, true, "负控制：仍然是一个**评估**（不是 not-evaluated）");
  assert.equal(underDecision.verdict, "within-budget", `阈值 120 > 读数 65 ⇒ within-budget（实得 ${underDecision.verdict}：${underDecision.reason}）`);
  assert.equal(underDecision.readings.extraWorkerMinutes, 65, "同一个读数（两次装配只差阈值）");
  const underApplied = applyAutoTighten(under, underDecision);
  assert.equal(underApplied.applied, false, "within-budget ⛔ 不落盘");
  assert.equal(
    readControlStateFile(under).relax_halted,
    undefined,
    `载体里的 relax_halted 保持「没写过」（实得 ${JSON.stringify(readControlStateFile(under).relax_halted)}）`,
  );
  assert.equal(readControlState(under).state.relax_halted, false, "经读面看就是 false（未收紧）");
  console.log(`[AC3] 负控制: verdict=${underDecision.verdict}（阈值 120 vs 读数 65）relax_halted=${readControlState(under).state.relax_halted}`);
});

// ══ AC4 — (b)(e) 分步失败率 + 无 step 的失败不进任何分子/分母 ══════════════════════════════════════

test("AC4(b)(e) — suite 红与 merge-develop 红是两条独立条目、reason 各点名其一；无 mechanical_fan_in 的失败不进任何分子/分母；step 词表不含 final_state 取值", (t) => {
  // 读数（分母 = **放宽组**走到 fan-in 的运行数 = A 的 4 条 + B 的 1 条 = 5）：suite 2/5=0.4，
  // merge-develop 1/5=0.2。额外成本阈值给足，隔离出速率这一维。
  const isolate = { ...GENEROUS, max_extra_worker_minutes: 1000 };

  const suiteOver = buildTightenFixture("ac4-suite", { relax: baseRelax({ ...isolate, max_fan_in_failure_rate: { suite: 0.3, "merge-develop": 0.9 } }) });
  const { decision: suiteDecision } = evaluate(suiteOver);
  assert.equal(suiteDecision.verdict, "halt", `suite 超阈 ⇒ halt（实得 ${suiteDecision.verdict}：${suiteDecision.reason}）`);
  assert.ok(suiteDecision.reason.includes("'suite'"), `reason 逐字点名 suite：${suiteDecision.reason}`);
  assert.ok(!suiteDecision.reason.includes("'merge-develop'"), `reason ⛔ 不得点名未超阈的 merge-develop：${suiteDecision.reason}`);

  const mergeOver = buildTightenFixture("ac4-merge", { relax: baseRelax({ ...isolate, max_fan_in_failure_rate: { suite: 0.9, "merge-develop": 0.1 } }) });
  const { decision: mergeDecision } = evaluate(mergeOver);
  assert.equal(mergeDecision.verdict, "halt", `merge-develop 超阈 ⇒ halt（实得 ${mergeDecision.verdict}：${mergeDecision.reason}）`);
  assert.ok(mergeDecision.reason.includes("'merge-develop'"), `对称 fixture 点名 merge-develop：${mergeDecision.reason}`);
  assert.ok(!mergeDecision.reason.includes("'suite'"), `⛔ 不得点名未超阈的 suite：${mergeDecision.reason}`);

  // 两条**独立**条目，各自带自己的分子/分母/阈值/率；两个 fixture 给出的 reason **不同**。
  const byStep = Object.fromEntries(suiteDecision.readings.fanIn.map((s) => [s.step, s]));
  assert.deepEqual(Object.keys(byStep), ["merge-develop", "suite"], `两个 step 是两条独立条目（实得 ${JSON.stringify(Object.keys(byStep))}）`);
  assert.equal(byStep.suite.failures, 2);
  assert.equal(byStep.suite.reached, 5);
  assert.equal(byStep.suite.rate, 0.4);
  assert.equal(byStep.suite.threshold, 0.3);
  assert.equal(byStep.suite.overThreshold, true);
  assert.equal(byStep["merge-develop"].failures, 1);
  assert.equal(byStep["merge-develop"].rate, 0.2);
  assert.equal(byStep["merge-develop"].overThreshold, false, "同一次评估里 merge-develop 未超（两维不得合并成一个「失败」数）");
  assert.notEqual(suiteDecision.reason, mergeDecision.reason, "两个 fixture 给出**不同**的 reason（⛔ 不是同一句泛化断言）");
  assert.equal(suiteDecision.readings.fanInReached, 5, "分母 = 放宽组走到 fan-in 的运行数（A 的 1 landed + 3 red，B 的 1 landed）");
  assert.equal(suiteDecision.readings.failuresWithoutStep, 1, "1 条失败没有 mechanical_fan_in —— 单独报出（⛔ 不折成 unknown / 0）");

  // ── 负控制①（差分）：去掉那条「无 mechanical_fan_in」的失败运行 ⇒ 任何 step 的分子与分母**都不变**。
  const removed = buildTightenFixture("ac4-nostep-removed", {
    relax: baseRelax({ ...isolate, max_fan_in_failure_rate: { suite: 0.3, "merge-develop": 0.9 } }),
    extraFailure: "none",
  });
  const { decision: removedDecision } = evaluate(removed);
  const removedByStep = Object.fromEntries(removedDecision.readings.fanIn.map((s) => [s.step, s]));
  assert.equal(removedDecision.readings.fanInReached, suiteDecision.readings.fanInReached, "分母对「有没有那条无 fan-in 的失败」不敏感");
  assert.equal(removedByStep.suite.failures, byStep.suite.failures, "suite 分子不变");
  assert.equal(removedByStep["merge-develop"].failures, byStep["merge-develop"].failures, "merge-develop 分子不变");
  assert.equal(removedDecision.readings.failuresWithoutStep, 0, "去掉它之后该计数归 0（说明差分真的动了那条记录）");
  assert.equal(removedDecision.verdict, "halt", "去掉一条**不计入**的记录不改变判定本身");

  // ── 负控制②（差分）：换成一条**有** `mechanical_fan_in` 但没有 step 的失败 ⇒ 只动**分母**，不动任何分子。
  const keyless = buildTightenFixture("ac4-keyless", {
    relax: baseRelax({ ...isolate, max_fan_in_failure_rate: { suite: 0.3, "merge-develop": 0.9 } }),
    extraFailure: "keyless-mfi",
  });
  const { decision: keylessDecision } = evaluate(keyless);
  const keylessByStep = Object.fromEntries(keylessDecision.readings.fanIn.map((s) => [s.step, s]));
  assert.equal(keylessDecision.readings.fanInReached, suiteDecision.readings.fanInReached + 1, "多一条带 fan-in 但无 step 的运行 ⇒ 分母 +1");
  assert.equal(keylessByStep.suite.failures, byStep.suite.failures, "suite 分子不变（无 step ⇒ 不进任何分子）");
  assert.equal(keylessByStep["merge-develop"].failures, byStep["merge-develop"].failures, "merge-develop 分子不变");
  assert.equal(keylessDecision.readings.failuresWithoutStep, 1, "它仍然只是那条无 fan-in 的失败（有 fan-in 但无 step 的那条不算 failuresWithoutStep）");
  assert.equal(keylessByStep.suite.rate, 2 / 6, "率随分母动（证明率是算出来的，不是常数）");
  assert.notEqual(keylessByStep.suite.rate, byStep.suite.rate, "分母变了 ⇒ 率变了");

  // ── 词表隔离：step 取值全部来自 `mechanical_fan_in.step`，⛔ 不含 `final_state` 的任何取值。
  for (const s of suiteDecision.readings.fanIn) {
    assert.ok(!NOT_STEP_TOKENS.includes(s.step), `step 取值 ${s.step} ⛔ 不得落在 final_state 词表 ${JSON.stringify(NOT_STEP_TOKENS)} 里`);
  }
  assert.ok(!NOT_STEP_TOKENS.includes("unknown"), '⛔ "unknown" 根本不在 step 词表里（无 step 的运行从不合成一个步名）');

  console.log(`[AC4] suite 超阈: ${suiteDecision.reason}`);
  console.log(`[AC4] merge 超阈: ${mergeDecision.reason}`);
  console.log(`[AC4] 分步条目 = ${JSON.stringify(suiteDecision.readings.fanIn)}  failuresWithoutStep=${suiteDecision.readings.failuresWithoutStep}`);
  console.log(`[AC4] 负控制①（去掉无 fan-in 的失败）: fanInReached=${removedDecision.readings.fanInReached} suite=${removedByStep.suite.failures} merge=${removedByStep["merge-develop"].failures} withoutStep=${removedDecision.readings.failuresWithoutStep}`);
  console.log(`[AC4] 负控制②（换成有 fan-in 无 step 的失败）: fanInReached=${keylessDecision.readings.fanInReached} suite=${keylessByStep.suite.failures}（率 ${keylessByStep.suite.rate}）merge=${keylessByStep["merge-develop"].failures}`);
});

// ══ AC5 — (c) relax_halted 为真 ⇒ live 下仍阻塞（+ 负控制） ════════════════════════════════════════

test("AC5(c) — relax_halted:true ⇒ live 下本可放宽的候选被滤掉；负控制：清成 false ⇒ 同一候选被放宽", (t) => {
  const CAND = "gap-live-cand";
  const BLOCKER = "gap-live-blocker";

  const root = makeRoot("ac5-live");
  writeConfig(root, baseRelax(undefined, { mode: "live", after_minutes: 30, max_relaxed_inflight: 5 }));
  // 候选与在飞对手在同一个精确路径上重叠；两者都声明 Touches（⇒ 结构前置全过）。
  for (const [id, extra] of [[BLOCKER, "plugin/scripts/blocker-only.ts"], [CAND, "plugin/scripts/cand-only.ts"]]) {
    fs.writeFileSync(
      path.join(root, "tasks", `${id}.md`),
      `---\nid: ${id}\nstatus: ready\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n- ${SHARED}\n- ${extra}\n`,
      "utf8",
    );
  }
  // 候选 45 分钟前 ready（> after_minutes=30 ⇒ waited-enough 过）；对手 5 分钟前 ready（不参与候选的等待判定）。
  writeReadyEvents(root, [[CAND, at(45)], [BLOCKER, at(5)]]);

  /** 一次真实过滤：真 `applyTaskFilters` + 真谓词 + 注入时钟 + 注入的闸。 */
  const run = (relaxHalted) => {
    const entries = [];
    const kept = applyTaskFilters(
      [CAND],
      makeFilterContext(root, { inFlight: [BLOCKER], nowMs: NOW_MS, relaxHalted }),
      undefined,
      (e) => entries.push(e),
    );
    return { kept, entry: entries.find((e) => e.task === CAND) };
  };

  // 闸关（false）：放宽真的发生 —— 这既是**负控制**（阻塞不是恒阻塞），也是「放宽本可放过它」的证据。
  writeControlStateRaw(root, { schemaVersion: 1, halted: false, halted_by: null, halted_at: null, preference: {}, forced: [], relax_halted: false });
  const openBytes = readFile(root, CONTROL_STATE_REL);
  const open = run(readControlState(root).state.relax_halted);
  assert.deepEqual(open.kept, [CAND], `闸关 ⇒ 同一候选被放宽、保留（实得 kept=${JSON.stringify(open.kept)}，blockedBy=${open.entry?.relaxBlockedBy}）`);
  assert.equal(open.entry.relaxed, true, "条目自报 relaxed:true（真的走的是放行路径）");

  // 闸开（true）：同一个候选被滤掉。
  writeControlStateRaw(root, { schemaVersion: 1, halted: false, halted_by: null, halted_at: null, preference: {}, forced: [], relax_halted: true });
  const haltedBytes = readFile(root, CONTROL_STATE_REL);
  const halted = run(readControlState(root).state.relax_halted);
  assert.deepEqual(halted.kept, [], `闸开 ⇒ 本可放宽的候选被滤掉（实得 kept=${JSON.stringify(halted.kept)}）`);
  assert.equal(halted.entry.wouldRelax, false, "不放宽");
  assert.equal(halted.entry.relaxBlockedBy, "relax-not-halted", `首个不满足者 = relax-not-halted（实得 ${halted.entry.relaxBlockedBy}）`);
  assert.ok(LIVE_RELAX_CONDITIONS.includes("relax-not-halted"), "该条件 id 在 live 词表里");

  // 两次控制态**字节**确实不同（不是同一份读了两遍）。
  assert.notEqual(hashOf(openBytes), hashOf(haltedBytes), "两次的控制态载体不是同一份字节");
  console.log(`[AC5] 闸关: kept=${JSON.stringify(open.kept)} relaxed=${open.entry?.relaxed} 载体 sha256=${hashOf(openBytes)}`);
  console.log(`[AC5] 闸开: kept=${JSON.stringify(halted.kept)} blockedBy=${halted.entry.relaxBlockedBy} 载体 sha256=${hashOf(haltedBytes)}`);
});

// ══ AC6 — (d) 人工清除后恢复 ══════════════════════════════════════════════════════════════════════

test("AC6(d) — 人工清零只改那一份 JSON（⛔ 不改代码/不删文件/不需要新命令）⇒ 下一轮重新按读数判定并再写回 true", (t) => {
  const relax = baseRelax({ ...GENEROUS, max_extra_worker_minutes: 30, max_fan_in_failure_rate: { suite: 0.99, "merge-develop": 0.99 } });
  const root = buildTightenFixture("ac6-recover", { relax });
  const quayBefore = listQuay(root);

  // 第一轮：读数超阈值 ⇒ 写 true。
  const first = runAutoTightenPass(root, NOW_MS);
  assert.equal(first.verdict, "halt");
  assert.equal(first.applied, true, "第一轮真的落盘");
  const afterFirst = readControlStateFile(root);
  assert.equal(afterFirst.relax_halted, true, "第一轮后从载体回读 = true");

  // ── 人工清零：**只**改那一份 JSON 的一个布尔值。
  writeControlStateRaw(root, { ...afterFirst, relax_halted: false });
  assert.equal(readControlStateFile(root).relax_halted, false, "清零后从载体回读 = false");
  assert.deepEqual(listQuay(root), quayBefore, "清零不新增/不删除任何文件（人做的事只有改那一份 JSON）");

  // 第二轮：读数**仍然**超阈值 ⇒ 再写回 true（重新按读数判定，⛔ 不是「记得上一轮判过」）。
  const second = runAutoTightenPass(root, NOW_MS);
  assert.equal(second.verdict, "halt", "第二轮仍按读数判出 halt");
  assert.equal(second.applied, true, `第二轮真的再写回（实得 applied=${second.applied}）`);
  assert.equal(second.readings.relaxHaltedBefore, false, "评估时读到的是【人工清零后的】false —— 证明确实重读了载体");
  const afterSecond = readControlStateFile(root);
  assert.equal(afterSecond.relax_halted, true, "第二轮后从载体回读 = true");
  assert.notEqual(second.readings.relaxHaltedBefore, afterSecond.relax_halted, "一次真实的 false → true 翻转");

  console.log(`[AC6] 第一轮后载体 = ${JSON.stringify(afterFirst)}`);
  console.log(`[AC6] 人工清零后载体 = ${JSON.stringify({ ...afterFirst, relax_halted: false })} —— .quay/ 清单不变 ${JSON.stringify(listQuay(root))}`);
  console.log(`[AC6] 第二轮: verdict=${second.verdict} applied=${second.applied} relaxHaltedBefore=${second.readings.relaxHaltedBefore} 载体 = ${JSON.stringify(afterSecond)}`);
});

// ══ AC7 — (b) 写路径不得抹掉既有控制态；旧载体缺键读作 false ═══════════════════════════════════════

test("AC7(b) — 自动收紧后 relax_halted:true 且 halted/halted_by/halted_at/preference/forced 逐字不变；旧载体无该键 ⇒ 读作 false", (t) => {
  const relax = baseRelax({ ...GENEROUS, max_extra_worker_minutes: 30, max_fan_in_failure_rate: { suite: 0.99, "merge-develop": 0.99 } });
  const preset = {
    schemaVersion: 1,
    halted: true,
    halted_by: "outer",
    halted_at: "2026-10-17T03:04:05.000Z",
    preference: { board: "native", strategy: "oldest-first" },
    forced: [{ task: "gap-some-other-task", reason: "人指定的强制派发", caller: "outer", at: "2026-10-17T03:05:00.000Z" }],
  };
  const root = buildTightenFixture("ac7-preserve", { relax, controlState: preset });

  const before = readControlStateFile(root);
  assert.deepEqual(before, preset, "起点逐字 = 预置（且**没有** relax_halted 键 —— 旧载体）");
  const beforeRead = readControlState(root).state.relax_halted;
  assert.equal(beforeRead, false, "旧载体缺键 ⇒ 读作 false（缺键 ≠ true）");
  const decision = evaluate(root).decision;
  assert.equal(decision.verdict, "halt");
  assert.equal(decision.readings.relaxHaltedBefore, false, "评估读到的是旧载体的缺键 ⇒ false");
  const applied = applyAutoTighten(root, decision);
  assert.equal(applied.applied, true);

  const after = readControlStateFile(root);
  assert.equal(after.relax_halted, true, "自动收紧写入了 relax_halted:true");
  // ── 那几类字段**逐字**不变（⛔ 自动收紧不得抹掉人工 halt / 强制派发）。
  for (const k of ["schemaVersion", "halted", "halted_by", "halted_at", "preference", "forced"]) {
    assert.deepEqual(after[k], preset[k], `${k} 逐字不变（前 ${JSON.stringify(preset[k])} / 后 ${JSON.stringify(after[k])}）`);
  }
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(preset), "relax_halted"].sort(), "只多出 relax_halted 这一个键");

  console.log(`[AC7] 写入前 = ${JSON.stringify(preset)}`);
  console.log(`[AC7] 写入后 = ${JSON.stringify(after)}`);
  console.log(`[AC7] 旧载体读取 relax_halted = ${beforeRead}（缺键 ⇒ false）→ 写入后 = ${after.relax_halted}`);
});

// ══ AC8 — round 记录留痕且两态可分 ═════════════════════════════════════════════════════════════════

test("AC8 — 跑过评估的轮：round 记录带 verdict/reason/分步读数/实际阈值；没跑的轮为 null（两者从载体回读，two-way）", (t) => {
  const root = makeRoot("ac8-round");
  // 轮 A：放宽启用且阈值齐备 ⇒ 该步**跑**。
  writeConfig(root, baseRelax(GENEROUS));
  appendRelaxedDispatch(root, { task: RELAXED_A, blockers: ["gap-tighten-blocker-a"], overlapFiles: [SHARED], waitedMinutes: 45, dispatchedAt: at(200) });
  appendRelaxedDispatch(root, { task: RELAXED_B, blockers: ["gap-tighten-blocker-b"], overlapFiles: [SHARED], waitedMinutes: 50, dispatchedAt: at(100) });
  appendOutcome(root, outcomeRow(RELAXED_A, { dispatchedMinAgo: 200, exitedMinAgo: 180, finalState: "completed", mfi: { step: null } }));
  appendOutcome(root, outcomeRow(RELAXED_B, { dispatchedMinAgo: 100, exitedMinAgo: 80, finalState: "completed", mfi: { step: null } }));
  appendOutcome(root, outcomeRow(CTL_1, { dispatchedMinAgo: 150, exitedMinAgo: 140, finalState: "completed", mfi: { step: null } }));

  const roundFile = path.join(root, WORKER_ROUND_REL);
  const writeRound = (roundNo, autoTighten) => {
    appendHeartbeatLine(
      roundFile,
      computeWorkerRoundRecord({
        round: roundNo,
        runId: "fixture-run",
        pid: 4242,
        at: at(0),
        action: "idle",
        inFlight: 0,
        pool: 0,
        stopReason: null,
        coldStartInflight: [],
        autoTighten,
      }),
    );
  };

  const ran = runAutoTightenPass(root, NOW_MS);
  writeRound(1, ran);

  // 轮 B：`loop.touches_relax` 整个不声明 ⇒ 本步**没跑** ⇒ null（⛔ 不得写成「跑过且未超阈值」）。
  writeConfig(root, null);
  const skipped = runAutoTightenPass(root, NOW_MS);
  writeRound(2, skipped);

  // ── 从**载体文件**回读（⛔ 不用内存对象）。
  const lines = readJsonl(roundFile);
  assert.equal(lines.present, true, "round 载体真的存在");
  assert.equal(lines.records.length, 2, "两条 round 记录");
  const r1 = lines.records[0];
  const r2 = lines.records[1];

  assert.notEqual(r1.auto_tighten, null, "轮 A：跑了该步 ⇒ 对象");
  assert.equal(r1.auto_tighten.verdict, "within-budget", `轮 A verdict 从载体回读（实得 ${r1.auto_tighten?.verdict} —— ${r1.auto_tighten?.reason}）`);
  assert.equal(typeof r1.auto_tighten.reason, "string", "带 reason");
  assert.equal(r1.auto_tighten.readings.maxExtraWorkerMinutes, 1000, "带【实际用的】阈值");
  assert.equal(r1.auto_tighten.readings.minSamples, 2, "带实际用的 min_samples");
  assert.equal(r1.auto_tighten.readings.extraWorkerMinutes, 10, "带额外成本读数（放宽 20 − 对照 10）");
  assert.equal(r1.auto_tighten.readings.fanInReached, 2, "带分步读数的分母");
  assert.deepEqual(
    r1.auto_tighten.readings.fanIn.map((s) => [s.step, s.rate, s.reached]),
    [["merge-develop", 0, 2], ["suite", 0, 2]],
    "带按 step 分步的读数（两条独立条目）",
  );
  assert.equal(r1.auto_tighten.thresholdsConfigured, true);

  assert.strictEqual(r2.auto_tighten, null, `轮 B：没跑该步 ⇒ null（实得 ${JSON.stringify(r2.auto_tighten)}）`);
  // two-way：两个方向各断言一次。
  assert.strictEqual(r1.auto_tighten === null, false, "two-way：跑了的那轮不是 null");
  assert.strictEqual(r2.auto_tighten === null, true, "two-way：没跑的那轮是 null");
  assert.strictEqual(skipped, null, "返回值：没跑 ⇒ null");
  assert.notStrictEqual(ran, null, "返回值：跑了 ⇒ 对象");

  console.log(`[AC8] 轮1（跑过）= ${JSON.stringify(r1.auto_tighten)}`);
  console.log(`[AC8] 轮2（没跑）= ${JSON.stringify(r2.auto_tighten)}  载体行数=${lines.records.length}`);
});

// ══ AC11 — 配置面扩块：只读、无回退、非法值具名拒绝 ═══════════════════════════════════════════════

test("AC11 — auto_tighten 子块逐字读出、非法值具名 issue + CLI 非零退出、缺键为 undefined、config.yml 一字节不写", (t) => {
  const script = path.join(import.meta.dirname, "..", "scripts", "touches-relax-config.ts");

  // ① 逐字读出。
  const ok = makeRoot("ac11-ok");
  writeConfig(ok, baseRelax({ min_samples: 4, max_extra_worker_minutes: 12.5, max_fan_in_failure_rate: { suite: 0.4, "merge-develop": 0.15 } }));
  const okHashBefore = hashOf(readFile(ok, ".quay/config.yml"));
  const okLoad = loadTouchesRelaxConfig(ok);
  assert.equal(okLoad.state, "live");
  assert.deepEqual(okLoad.issues, []);
  assert.equal(okLoad.config.auto_tighten.min_samples, 4, "min_samples 逐字 = YAML 写的值");
  assert.equal(okLoad.config.auto_tighten.max_extra_worker_minutes, 12.5, "max_extra_worker_minutes 逐字 = YAML 写的值");
  assert.deepEqual(okLoad.config.auto_tighten.max_fan_in_failure_rate, { suite: 0.4, "merge-develop": 0.15 }, "逐键逐字");

  // ③ 缺键 ⇒ `undefined`（⛔ 不是 30 / 1 / 0.3 之类字面量）。
  const partial = makeRoot("ac11-partial");
  writeConfig(partial, baseRelax({ min_samples: 4 }));
  const partialAuto = loadTouchesRelaxConfig(partial).config.auto_tighten;
  assert.equal(partialAuto.min_samples, 4);
  assert.equal(partialAuto.max_extra_worker_minutes, undefined, "缺键 ⇒ undefined（⛔ 不是内置默认值）");
  assert.equal(partialAuto.max_fan_in_failure_rate, undefined, "缺键 ⇒ undefined（⛔ 不是内置默认值）");
  assert.deepEqual(Object.keys(partialAuto), ["min_samples"], "读出的对象**只**带文件真的写了的键");

  // 整个子块不写 ⇒ 该键根本不存在（⛔ 不是空对象、不是默认阈值）。
  const none = makeRoot("ac11-none");
  writeConfig(none, baseRelax(undefined));
  assert.equal(loadTouchesRelaxConfig(none).config.auto_tighten, undefined, "没写子块 ⇒ 该键不存在");

  // 纯函数面：四种非法值各给具名 issue（⛔ 不静默丢弃、⛔ 不回退成合法值）。
  const bad = parseTouchesRelaxSection({
    mode: "live",
    after_minutes: 30,
    max_relaxed_inflight: 2,
    auto_tighten: { min_samples: 0, max_extra_worker_minutes: -1, max_fan_in_failure_rate: { suite: 1.5, "merge-develop": "x" } },
  });
  assert.equal(bad.ok, false, "非法子块 ⇒ ok:false");
  const fields = bad.issues.map((i) => i.field);
  for (const f of [
    "loop.touches_relax.auto_tighten.min_samples",
    "loop.touches_relax.auto_tighten.max_extra_worker_minutes",
    "loop.touches_relax.auto_tighten.max_fan_in_failure_rate.suite",
    "loop.touches_relax.auto_tighten.max_fan_in_failure_rate.merge-develop",
  ]) {
    assert.ok(fields.includes(f), `具名 ${f}：${JSON.stringify(fields)}`);
  }
  // 合法值仍读得出（证明上面拒的是值、不是整个字段）。
  const goodRate = parseTouchesRelaxSection({ mode: "off", auto_tighten: { max_fan_in_failure_rate: { suite: 0, "merge-develop": 1 } } });
  assert.equal(goodRate.ok, true, `0 与 1 都在 0..1 闭区间内（实得 ${JSON.stringify(goodRate.ok ? goodRate.config.auto_tighten : goodRate.issues)}）`);

  // ② 模块 CLI 对同一份非法 fixture **非零退出**（真跑子进程，不是断言内存对象）。
  const badRoot = makeRoot("ac11-badroot");
  writeConfig(badRoot, baseRelax({ min_samples: 0, max_extra_worker_minutes: -1 }));
  const badHashBefore = hashOf(readFile(badRoot, ".quay/config.yml"));
  const cli = spawnSync(process.execPath, ["--experimental-strip-types", script, "--validate", "--root", badRoot, "--json"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(cli.status, 1, `非法值 ⇒ CLI exit 1（实得 ${cli.status}；stderr=${String(cli.stderr).slice(0, 400)}）`);
  const payload = JSON.parse(cli.stdout);
  assert.equal(payload.qualified, false);
  assert.ok(payload.issues.some((i) => i.field.endsWith(".min_samples")), `CLI 输出里具名 min_samples：${JSON.stringify(payload.issues)}`);
  const cli2 = spawnSync(process.execPath, ["--experimental-strip-types", script, "--validate", "--root", badRoot], { encoding: "utf8", timeout: 30_000 });
  assert.equal(cli2.status, 1);

  // ③ 三段 fixture 的 `config.yml` 一个字节都没写。
  assert.equal(hashOf(readFile(ok, ".quay/config.yml")), okHashBefore, "合格 fixture 的 config.yml 逐字节不变");
  assert.equal(hashOf(readFile(badRoot, ".quay/config.yml")), badHashBefore, "非法 fixture 的 config.yml 也逐字节不变（跑完 CLI 之后）");

  console.log(`[AC11] 逐字读出 = ${JSON.stringify(okLoad.config.auto_tighten)}（config.yml sha256 前后=${okHashBefore}）`);
  console.log(`[AC11] 缺键读出 = ${JSON.stringify(partialAuto)}`);
  console.log(`[AC11] 非法 issue = ${JSON.stringify(fields)}；CLI exit=${cli.status}；非法 fixture sha256 前后=${badHashBefore}`);
});

// ══ 词表冻结（本条不得改动 AC-365/366 的既有词表） ════════════════════════════════════════════════

test("负控制 — verdict 三态冻结；AC-365 的标注词表未被本条增删；live 词表只多出 relax-not-halted；读不懂的控制态两闸同真", (t) => {
  assert.deepEqual([...TIGHTEN_VERDICTS], ["not-evaluated", "within-budget", "halt"], "判定词表恰三条，三态可分");
  // AC-365 的标注词表被 off-parity 的 AC4 逐字 deepEqual 钉死 —— 本条 ⛔ 不得增删。
  assert.deepEqual(
    [...RELAX_CONDITIONS],
    ["touches-only-blocker", "waited-enough", "quota-available", "not-never-relax", "overlap-shared"],
    "shadow/off 的标注词表仍是那五条",
  );
  for (const id of ["candidate-declares-touches", "no-overbroad-glob", "overlap-known", "relaxed-ledger-readable", "blocker-not-relaxed", "relax-not-halted"]) {
    assert.ok(LIVE_RELAX_CONDITIONS.includes(id), `live 词表含 ${id}`);
  }
  assert.deepEqual([...TOUCHES_RELAX_MODES], ["off", "shadow", "live"], "mode 词表未被本条改动");

  // 两态可分：控制态读不懂 ⇒ 两个闸都取 true（宁可不放宽），⛔ 不伪装成「未 halt / 未收紧」。
  const broken = makeRoot("neg-broken-control");
  fs.writeFileSync(path.join(broken, CONTROL_STATE_REL), "{ not json", "utf8");
  const st = readControlState(broken);
  assert.notEqual(st.parseError, null, "解析失败留痕");
  assert.equal(st.state.halted, true, "读不懂 ⇒ halted:true（既有 fail-closed）");
  assert.equal(st.state.relax_halted, true, "读不懂 ⇒ relax_halted:true（宁可不放宽）");
  console.log(`[负控制] 读不懂的载体 ⇒ halted=${st.state.halted} relax_halted=${st.state.relax_halted} parseError=${st.parseError}`);
});

// 装配自检 —— driver 侧用的就是 `toRoundRecord` + `computeWorkerRoundRecord` 这两件。
test("装配自检 — toRoundRecord 的形状就是 round 记录里 auto_tighten 那一格（键序逐字）", (t) => {
  const root = buildTightenFixture("wiring-roundrecord", { relax: baseRelax(GENEROUS) });
  const decision = evaluate(root).decision;
  const rec = toRoundRecord(decision, applyAutoTighten(root, decision));
  assert.deepEqual(Object.keys(rec), ["evaluated", "verdict", "reason", "thresholdsConfigured", "applied", "readings"]);
  assert.equal(rec.evaluated, true);
  assert.equal(rec.applied, false, "within-budget ⇒ 不落盘（applied 与 verdict 是两件事）");
  const written = computeWorkerRoundRecord({
    round: 1,
    runId: "fixture-run",
    pid: 4242,
    at: at(0),
    action: "idle",
    inFlight: 0,
    pool: 0,
    stopReason: null,
    coldStartInflight: [],
    autoTighten: rec,
  });
  assert.deepEqual(written.auto_tighten, rec, "round 记录的那一格逐字就是它");
  assert.equal(RELAXED_DISPATCH_REL, ".quay/relaxed-dispatch.jsonl", "账本路径仍是 AC-363 的那一个（⛔ 不新载体）");
});
