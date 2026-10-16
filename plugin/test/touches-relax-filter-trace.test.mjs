// @test-group engine
// touches-relax-filter-trace.test.mjs — GOAL-037 AC-362（tasks/gap-worker-round-filter-trace-attribution）
//
// WHY THIS EXISTS：worker-round 的 `filtered-empty` 轮此前**不可归因**——`.quay/worker-round.jsonl`
// 只写 `stop_reason: "filtered-empty (…filtered by predicates)"`，一个 stop_reason 字面量把五种互不
// 相同的成因（notInFlight / depsSatisfied / touchesDisjointOrAged / retryCapNotExhausted / notNeedsHuman）
// 压成同形。GOAL-037 要判「touches 单独把某任务挡了超过阈值 ⇒ 允许放宽」时，阈值/名额/自动收紧三者
// 都无读数可依（硬规则 4 推论三：先要有穿过所有中间层、验收那一刻仍取得到的量）。
//
// 本测试的判别力【不在】「断言全绿」上——恒真断言与真归因同形。判别力由 AC6 的两种取假注入提供
// （① 归因写死成恒 touchesDisjointOrAged；② 恒空 filter_trace，两者各让本测试变红）。
//
// 载体面（DoD 逐字要求）：断言读的是从 fixture 的 `.quay/worker-round.jsonl` **回读并 JSON.parse**
// 出来的那一行记录（生产写入器 = worker-driver 的 appendRoundToFile），⛔ 不是内存里的对象。
//
// Run: timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-filter-trace.test.mjs
//      （scoped 门按 ## Touches 显式选中——本文件名与本任务 id 不同名，⛔ 不改名）

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TASK_FILTERS, applyTaskFilters, makeFilterContext } from "../scripts/driver-filters.ts";
import { computeWorkerRoundRecord, appendRoundToFile } from "../scripts/worker-driver.ts";
import { parseTask } from "../scripts/task-schema.ts";
import { parseTouches } from "../scripts/touches-orthogonality-check.ts";
import { expandDeclaredTouches } from "../scripts/concurrent-batch-scheduler.ts";

const ROUND_REL = ".quay/worker-round.jsonl";
const EVENTS_REL = ".quay/task-status-events.jsonl";

// ── fixture ──────────────────────────────────────────────────────────────────────────────────────

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `touches-relax-filter-trace-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

/** 写一个任务文件（fm = frontmatter 文本，body = 正文）。真写盘 ⇒ 过滤核走真实 fs 读。 */
function writeTask(root, id, fm, body) {
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}\n`, "utf8");
}

/** 一条 v1 task-status-event（`to:"ready"`）追加进生产载体 `.quay/task-status-events.jsonl`。 */
function appendReadyEvent(root, taskId, isoAt, seq) {
  const rec = {
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
  };
  fs.appendFileSync(path.join(root, EVENTS_REL), `${JSON.stringify(rec)}\n`, "utf8");
}

/** 从生产载体回读**最后一条** round 记录（⛔ 不是内存对象——DoD 逐字要求）。 */
function readLastRound(root) {
  const text = fs.readFileSync(path.join(root, ROUND_REL), "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return JSON.parse(lines[lines.length - 1]);
}

/** 装配一条 round 记录并【走生产写入器】落进载体（appendRoundToFile）。 */
function writeRound(root, opts) {
  const record = computeWorkerRoundRecord({
    round: opts.round ?? 1,
    runId: "fixture-run",
    pid: 4242,
    at: new Date().toISOString(),
    action: opts.action ?? "stop",
    inFlight: 2,
    pool: opts.pool ?? 7,
    stopReason: opts.stopReason ?? null,
    coldStartInflight: [],
    filterTrace: opts.filterTrace,
  });
  appendRoundToFile(path.join(root, ROUND_REL), record);
  return record;
}

// fixture 的 task id（全部带 `gap-trace-` 前缀 ⇒ 绝不会与真实任务相撞）。
const OPP = "gap-trace-opp"; // 在飞对手
const SELF_OPP = "gap-trace-self-opp"; // 在飞对手（AC3：它声明的 Touches 含【候选自身的任务文件】）
const CAND = "gap-trace-cand"; // 只被 touchesDisjointOrAged 挡住
const SELF = "gap-trace-self"; // 只被 touchesDisjointOrAged 挡住（AC3：自身任务文件落在交集里，须被排除）
const DEP = "gap-trace-dep"; // 只被 depsSatisfied 挡住
const NH = "gap-trace-nh"; // 只被 notNeedsHuman 挡住
const EXH = "gap-trace-exh"; // 只被 retryCapNotExhausted 挡住
const PASS = "gap-trace-pass"; // 全过（特征化的 kept 序列用）
const PASS2 = "gap-trace-pass2"; // 全过

/** 候选输入顺序（特征化断言读它——顺序本身就是被保护的量）。 */
const CANDIDATE_ORDER = [CAND, PASS, DEP, PASS2, NH, EXH, SELF];

/**
 * 建 fixture：真 `tasks/*.md`（真 `## Touches`）+ 真 `.quay/task-status-events.jsonl`。
 * ready 时刻锚在同一个 `anchor` 上 ⇒ CAND 与 SELF 相差【恰好 30 分钟】（AC8 的 Δ 断言据此成立）。
 */
function buildFixture(tag) {
  const root = makeRoot(tag);
  const anchor = Date.now();
  const T_CAND = anchor - 45 * 60_000;
  const T_SELF = anchor - 75 * 60_000; // 恰好比 CAND 早 30 分钟

  // 在飞对手 1：与 CAND 在 plugin/scripts/trace-shared.ts 上重叠。
  writeTask(root, OPP, `---\nid: ${OPP}\nstatus: ready\n---`, "## Touches\n\n- plugin/scripts/trace-shared.ts\n- plugin/scripts/opp-only.ts\n");
  // 在飞对手 2：与 SELF 重叠，且【同时声明 SELF 自己的任务文件】（AC3 的排除面）。
  writeTask(root, SELF_OPP, `---\nid: ${SELF_OPP}\nstatus: ready\n---`, `## Touches\n\n- tasks/${SELF}.md\n- plugin/scripts/self-shared.ts\n`);
  // 候选：与 OPP 重叠于一个真实文件。
  writeTask(root, CAND, `---\nid: ${CAND}\nstatus: ready\n---`, "## Touches\n\n- plugin/scripts/trace-shared.ts\n- plugin/scripts/cand-only.ts\n");
  // 候选（AC3）：自己声明了自己的任务文件，对手也声明了它 ⇒ 它落在交集里，须被排除。
  writeTask(root, SELF, `---\nid: ${SELF}\nstatus: ready\n---`, `## Touches\n\n- tasks/${SELF}.md\n- plugin/scripts/self-shared.ts\n`);
  // 只被 depsSatisfied 挡住（依赖读不出 ⇒ blocking，fail-closed）。
  writeTask(root, DEP, `---\nid: ${DEP}\nstatus: ready\ndepends_on:\n  - gap-trace-missing\n---`, "## Touches\n\n- plugin/scripts/dep-only.ts\n");
  // 只被 notNeedsHuman 挡住。
  writeTask(root, NH, `---\nid: ${NH}\nstatus: needs-human\n---`, "## Touches\n\n- plugin/scripts/nh-only.ts\n");
  // 只被 retryCapNotExhausted 挡住（集合由 ctx 提供）。
  writeTask(root, EXH, `---\nid: ${EXH}\nstatus: ready\n---`, "## Touches\n\n- plugin/scripts/exh-only.ts\n");
  // 全过。
  writeTask(root, PASS, `---\nid: ${PASS}\nstatus: ready\n---`, "## Touches\n\n- plugin/scripts/pass-only.ts\n");
  writeTask(root, PASS2, `---\nid: ${PASS2}\nstatus: ready\n---`, "## Touches\n\n- plugin/scripts/pass2-only.ts\n");

  // 载体：CAND / SELF 各有一条 `to:"ready"`（Δ = 30 分钟）。DEP/NH/EXH/PASS/PASS2 无 ready 记录。
  appendReadyEvent(root, SELF, new Date(T_SELF).toISOString(), 1);
  appendReadyEvent(root, CAND, new Date(T_CAND).toISOString(), 2);

  const ctx = makeFilterContext(root, { inFlight: [OPP, SELF_OPP], retryExhausted: new Set([EXH]) });
  return { root, ctx, T_CAND, T_SELF, anchor };
}

/** 跑一次【带 trace 的】真过滤，返回 { kept, entries }。 */
function runTraced(fixture, candidates = CANDIDATE_ORDER) {
  const entries = [];
  const kept = applyTaskFilters(candidates, fixture.ctx, undefined, (e) => entries.push(e));
  return { kept, entries };
}

const entriesFor = (entries, task) => entries.filter((e) => e.task === task);

// ── AC2 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC2 — touches 归因：blocker / overlapFiles / waitedMinutes 三键同现，从【载体回读】的记录里取", (t) => {
  const f = buildFixture("ac2");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  const { entries } = runTraced(f);
  writeRound(f.root, { filterTrace: entries });
  const rec = readLastRound(f.root); // ⛔ 生产载体回读，非内存对象

  assert.ok(Array.isArray(rec.filter_trace), "filter_trace 是数组（跑过该步）");
  const mine = rec.filter_trace.filter((e) => e.task === CAND);
  assert.deepEqual(mine.map((e) => e.filter), ["touchesDisjointOrAged"], "CAND **只**被 touchesDisjointOrAged 挡住（一条）");

  const entry = mine[0];
  assert.equal(entry.filter, "touchesDisjointOrAged");
  assert.equal(entry.blocker, OPP, "blocker 逐字等于该在飞对手的 task id");
  assert.deepEqual(entry.overlapFiles, ["plugin/scripts/trace-shared.ts"], "overlapFiles = 实测交集（排序后）");
  assert.equal(typeof entry.waitedMinutes, "number", "waitedMinutes 由载体推出（非 null）");
  assert.ok(Math.abs(entry.waitedMinutes - 45) <= 1, `waitedMinutes ≈ 45（实得 ${entry.waitedMinutes}）`);
  assert.notEqual(entry.waitedMinutes, 0, "⛔ 不是 0（缺值不得伪装成 0）");
  console.log(`[AC2] carrier row filter_trace entry = ${JSON.stringify(entry)}`);
});

// ── AC3 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC3 — overlapFiles 是【交集】：每个路径同在两边的展开集内；候选自身任务文件被排除", (t) => {
  const f = buildFixture("ac3");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  const expandOf = (id) => {
    const raw = fs.readFileSync(path.join(f.root, "tasks", `${id}.md`), "utf8");
    const { body } = parseTask(raw);
    return [...expandDeclaredTouches(parseTouches(body).globs, f.root)].sort();
  };

  const { entries } = runTraced(f);
  writeRound(f.root, { filterTrace: entries });
  const rec = readLastRound(f.root);

  const candEntry = rec.filter_trace.find((e) => e.task === CAND && e.filter === "touchesDisjointOrAged");
  const selfEntry = rec.filter_trace.find((e) => e.task === SELF && e.filter === "touchesDisjointOrAged");
  assert.ok(candEntry && selfEntry, "两条 touchesDisjointOrAged 条目都在载体里");

  const candSet = expandOf(CAND);
  const oppSet = expandOf(OPP);
  const selfSet = expandOf(SELF);
  const selfOppSet = expandOf(SELF_OPP);

  for (const p of candEntry.overlapFiles) {
    assert.ok(candSet.includes(p), `${p} 在【候选】${CAND} 的展开集内`);
    assert.ok(oppSet.includes(p), `${p} 在【对手】${OPP} 的展开集内`);
  }
  assert.deepEqual(candEntry.overlapFiles, candSet.filter((p) => oppSet.includes(p)), "逐字等于两展开集的交集");

  // AC3 的排除面：对手确实声明了 `tasks/<候选 id>.md`，它落在交集里，但必须被排除。
  const selfTaskFile = `tasks/${SELF}.md`;
  assert.ok(selfSet.includes(selfTaskFile), `候选自身声明了它（fixture 事实）`);
  assert.ok(selfOppSet.includes(selfTaskFile), `对手也声明了它 ⇒ 它本会落进交集（fixture 事实）`);
  assert.ok(!selfEntry.overlapFiles.includes(selfTaskFile), `⛔ ${selfTaskFile} 被排除在该条目的 overlapFiles 之外`);
  assert.deepEqual(selfEntry.overlapFiles, ["plugin/scripts/self-shared.ts"], "排除后只剩真实冲突面");
  assert.ok(selfEntry.overlapFiles.length > 0, "排除后 overlapFiles 仍非空（可归因性不受损）");

  console.log(`[AC3] ${CAND} expand=${JSON.stringify(candSet)} opp=${JSON.stringify(oppSet)} → overlapFiles=${JSON.stringify(candEntry.overlapFiles)}`);
  console.log(`[AC3] ${SELF} expand=${JSON.stringify(selfSet)} opp=${JSON.stringify(selfOppSet)} → overlapFiles=${JSON.stringify(selfEntry.overlapFiles)}`);
});

// ── AC4 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC4 — 其它谓词各有其名且 blocker === null；且不得被误归成 touchesDisjointOrAged", (t) => {
  const f = buildFixture("ac4");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  const { entries } = runTraced(f);
  writeRound(f.root, { filterTrace: entries });
  const rec = readLastRound(f.root);

  const expected = [[DEP, "depsSatisfied"], [EXH, "retryCapNotExhausted"], [NH, "notNeedsHuman"]];
  for (const [task, filter] of expected) {
    const mine = entriesFor(rec.filter_trace, task);
    assert.deepEqual(mine.map((e) => e.filter), [filter], `${task} 只被 ${filter} 挡住（且自报其名）`);
    assert.equal(mine[0].blocker, null, `${task} 的条目 blocker === null（非 touches 条目）`);
    assert.deepEqual(mine[0].overlapFiles, [], `${task} 的条目 overlapFiles 为空`);
    assert.equal(mine.filter((e) => e.filter === "touchesDisjointOrAged").length, 0, `${task} 不得有 touchesDisjointOrAged 条目`);
    console.log(`[AC4] ${task} entries = ${JSON.stringify(mine)}`);
  }
});

// ── AC5 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC5 — 特征化：带 trace 的返回值与【基线】逐元素 deepEqual（集合与顺序都不变）", (t) => {
  const f = buildFixture("ac5");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  // 基线：同一输入下，用【真实的】五个谓词独立算出的 kept 序列（不经 applyTaskFilters 的 trace 路径）。
  const basePreds = TASK_FILTERS.map((p) => p.predicate(f.ctx));
  const baseline = CANDIDATE_ORDER.filter((id) => basePreds.every((p) => p(id)));
  const { kept } = runTraced(f);

  assert.deepEqual(baseline, [PASS, PASS2], "基线：只有全过的两个候选留下（非空 ⇒ 顺序断言有内容）");
  assert.deepEqual(kept, baseline, `traced=${JSON.stringify(kept)} baseline=${JSON.stringify(baseline)}`);
  console.log(`[AC5] traced   = ${JSON.stringify(kept)}`);
  console.log(`[AC5] baseline = ${JSON.stringify(baseline)}`);
});

// ── AC7 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC7 — pool-empty ⇒ filter_trace === []；没跑该步 ⇒ null（两向各断言一次）", (t) => {
  const f = buildFixture("ac7");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  // 轮 1：跑过该步、有候选被滤（先往载体里塞一条非空记录 ⇒ 后续轮不得残留它）。
  const { entries } = runTraced(f);
  assert.ok(entries.length > 0, "前置：轮 1 确实有归因条目");
  writeRound(f.root, { round: 1, filterTrace: entries, stopReason: "filtered-empty (all dispatchable candidates filtered by predicates)" });
  assert.ok(readLastRound(f.root).filter_trace.length > 0, "轮 1 的载体行非空");

  // 轮 2：pool-empty（shuffled.length === 0）⇒ 该步仍跑过 ⇒ []，⛔ 不是 null、⛔ 不带上一轮残留。
  const poolEmptySink = [];
  const kept = applyTaskFilters([], f.ctx, undefined, (e) => poolEmptySink.push(e));
  assert.deepEqual(kept, [], "空候选 ⇒ 空返回");
  writeRound(f.root, { round: 2, filterTrace: poolEmptySink, stopReason: "pool-empty (no dispatchable candidate in the ready pool)" });
  const poolEmpty = readLastRound(f.root);
  assert.deepEqual(poolEmpty.filter_trace, [], "跑过该步、无候选被滤 ⇒ []");
  assert.notStrictEqual(poolEmpty.filter_trace, null, "⛔ 不是 null（「跑过且无」与「没跑」必须可分）");

  // 轮 3：本轮【没跑】该步（cap 已满 / stopCondition 提前 break / apply-filters 之前抛错）
  //       ⇒ ⛔ 缺省即 null（这里刻意不传 filterTrace，等价于轮首复位后从未赋值）。
  writeRound(f.root, { round: 3, stopReason: "capacity-full (running === cap)" });
  const noStep = readLastRound(f.root);
  assert.strictEqual(noStep.filter_trace, null, "没跑该步 ⇒ null");

  console.log(`[AC7] pool-empty row filter_trace = ${JSON.stringify(poolEmpty.filter_trace)}; no-step row filter_trace = ${JSON.stringify(noStep.filter_trace)}`);
});

// ── AC8 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC8 — waitedMinutes 取真值（两候选相差 30 分钟）；无 to:ready 记录 ⇒ null 且 !== 0", (t) => {
  const f = buildFixture("ac8");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  const { entries } = runTraced(f);
  writeRound(f.root, { filterTrace: entries });
  const rec = readLastRound(f.root);

  const cand = entriesFor(rec.filter_trace, CAND)[0];
  const self = entriesFor(rec.filter_trace, SELF)[0];

  // 载体事实（构造它的 fixture 事件行）：CAND ready 于 45 分钟前，SELF 于 75 分钟前 ⇒ Δ 恰好 30。
  assert.ok(Math.abs(cand.waitedMinutes - 45) <= 1, `CAND waitedMinutes ≈ 45（实得 ${cand.waitedMinutes}）`);
  assert.ok(Math.abs(self.waitedMinutes - 75) <= 1, `SELF waitedMinutes ≈ 75（实得 ${self.waitedMinutes}）`);
  const delta = self.waitedMinutes - cand.waitedMinutes;
  assert.ok(Math.abs(delta - 30) <= 1, `两条条目相差 ≈ 30 分钟（实得 ${delta}）——杀死硬编码常量`);
  assert.notEqual(delta, 0, "⛔ 两值不得相等（相等 ⇒ 是一个常数，不是真读数）");

  // 无 `to:"ready"` 记录的候选 ⇒ null，且显式断言 !== 0。
  const depEntry = entriesFor(rec.filter_trace, DEP)[0];
  assert.strictEqual(depEntry.waitedMinutes, null, "无 ready 事件 ⇒ null");
  assert.notEqual(depEntry.waitedMinutes, 0, "⛔ 读不到不得写成 0（缺值 = 未查，硬规则 6）");

  console.log(`[AC8] carrier events: CAND to=ready at ${new Date(f.T_CAND).toISOString()}, SELF at ${new Date(f.T_SELF).toISOString()}`);
  console.log(`[AC8] waitedMinutes: CAND=${cand.waitedMinutes}, SELF=${self.waitedMinutes}, Δ=${delta}; DEP(no ready record)=${JSON.stringify(depEntry.waitedMinutes)}`);
});
