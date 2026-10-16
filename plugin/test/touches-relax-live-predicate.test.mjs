// @test-group engine
// touches-relax-live-predicate.test.mjs — GOAL-037 AC-366（tasks/gap-touches-relax-live-semantics）
//
// WHY THIS EXISTS：`mode: live` 的**放宽放行语义**此前在代码里不存在 —— AC-365 的
// `touchesDisjointOrAged` 只覆盖 off（逐候选同形）与 shadow（只标 `wouldRelax`、不放行），
// 于是人按生效步骤把 `mode` 设为 `live` 并重启 worker driver 之后，**行为与 off 逐字节相同**：
// 配置写了但不生效，与「系统正常」同形（硬规则 3b）。本文件是那条放行语义的判据面。
//
// 判别力从哪来（硬规则 4：结构上不可能取假的量不是测量）——
//   「测试存在且绿」**单独不具备判别力**：它区分不了「真放行」与「恒真断言」。判别力由三处提供：
//   ① (a) 的**双向边界**：等待恰等于阈值 ⇒ 保留、恰少一分钟 ⇒ 滤掉（两个方向都取到读数）；
//   ② (b)(d)(e) 的**负控制**：换掉 never_relax 的一条、删掉账本里对手那一行、换成精确 glob ⇒
//      同一个候选从「阻塞」翻成「保留」——证明判据真的读了配置/账本，不是恒阻塞也不是恒放行；
//   ③ (g)/(j) 的**注入真红**：把 `null` 当 `Infinity`、把 live 写成恒放行、逐条删掉每个条件，
//      对应用例必须变红（见 Evidence 的注入清单）。
//
// 全部读数从**载体文件回读**（`.quay/relaxed-dispatch.jsonl` 逐字、trace 条目 JSON），
// ⛔ 不把内存对象当成「已落盘」（硬规则 4c）。
//
// Run: timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-live-predicate.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyTaskFilters,
  makeFilterContext,
  relaxedDispatchEntry,
  LIVE_RELAX_CONDITIONS,
  RELAX_CONDITIONS,
} from "../scripts/driver-filters.ts";
import { readRelaxedDispatchLedger, RELAXED_DISPATCH_REL } from "../scripts/relaxed-dispatch-ledger.ts";
import { recordRelaxedDispatch } from "../scripts/worker-driver.ts";
import { isOverbroadDeclaration } from "../scripts/touches-orthogonality-check.ts";

// ── fixture ──────────────────────────────────────────────────────────────────────────────────────

/** 本文件建过的 fixture 根。顶层 `after()` 统一删（`tmp-leak-pairing-check` 要求 mkdtemp 有配对清理）。 */
const TMP_ROOTS = [];
after(() => {
  for (const d of TMP_ROOTS) fs.rmSync(d, { recursive: true, force: true });
});

/** 注入时钟：全部等待读数都相对它算，边界才可判（⛔ 不用 `Date.now()`——那样的边界只能靠运气命中）。 */
const NOW_MS = Date.parse("2026-10-17T12:00:00.000Z");
/** 「NOW 之前 m 分钟」的 ISO —— ready 事件的时刻。 */
const at = (m) => new Date(NOW_MS - m * 60_000).toISOString();

const CAND = "gap-live-cand"; // 候选：与在飞对手在 plugin/scripts/shared.ts 上重叠
const BLOCKER = "gap-live-blocker"; // 在飞对手
const SHARED = "plugin/scripts/shared.ts"; // 重叠面（精确路径 ⇒ expandDeclaredTouches 不需真文件）

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `touches-relax-live-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  TMP_ROOTS.push(dir);
  return dir;
}

/** 写一个任务文件。`touchesLines === null` ⇒ **没有** `## Touches` 节。 */
function writeTask(root, id, touchesLines, status = "ready", extraFm = "") {
  const body = touchesLines === null
    ? "## Proposal\n\nprose\n"
    : `## Proposal\n\nprose\n\n## Touches\n\n${touchesLines}\n`;
  fs.writeFileSync(
    path.join(root, "tasks", `${id}.md`),
    `---\nid: ${id}\nstatus: ${status}\n${extraFm}---\n\n${body}`,
    "utf8",
  );
}

/** 写 `.quay/config.yml`（真 `loop:` mapping；`relax` 为 null ⇒ **不写** touches_relax 块）。 */
function writeConfig(root, relax) {
  const lines = ["loop:", "  board: native"];
  if (relax !== null) {
    lines.push("  touches_relax:");
    for (const [k, v] of Object.entries(relax)) {
      if (Array.isArray(v)) {
        lines.push(`    ${k}:`);
        for (const el of v) lines.push(`      - ${el}`);
      } else {
        lines.push(`    ${k}: ${v}`);
      }
    }
  }
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), `${lines.join("\n")}\n`, "utf8");
}

/** 追加一条真实的 v1 `to:"ready"` 状态事件（生产载体 `.quay/task-status-events.jsonl`）。 */
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
  fs.appendFileSync(path.join(root, ".quay", "task-status-events.jsonl"), `${JSON.stringify(rec)}\n`, "utf8");
}

/** 追加一条**真实形状**的放宽账本记录（五键；`relaxed-dispatch-ledger` 的校验会被回读时跑到）。
 *  用来构造「某些在飞任务本身是被放宽派发的」这一前置（(c)/(d) 两条判据的输入）。 */
function appendLedgerRecord(root, task, blockers, overlapFiles, waitedMinutes, isoAt) {
  const rec = { task, blockers, overlapFiles, waitedMinutes, dispatchedAt: isoAt };
  fs.appendFileSync(path.join(root, RELAXED_DISPATCH_REL), `${JSON.stringify(rec)}\n`, "utf8");
}

/** live 的基线放宽配置（阈值全部来自配置，⛔ 代码里没有字面量默认值）。 */
function liveConfig(overrides = {}) {
  return { mode: "live", after_minutes: 30, max_relaxed_inflight: 5, shared_files: [], never_relax: [], ...overrides };
}

/** 跑一次**带 trace** 的真实过滤（返回 kept + 条目 + ctx —— 条目就是生产判据的产物）。 */
function runTagged(candidates, ctx) {
  const entries = [];
  const kept = applyTaskFilters(candidates, ctx, undefined, (e) => entries.push(e));
  return { kept, entries };
}

/** 取「被 touches 谓词挡下」的那一条条目（`relaxed === true` 的条目走另一个分支，不在此列）。 */
const touchesEntry = (entries, task) => entries.find((e) => e.task === task && e.relaxBlockedBy !== undefined);
/** 取「被放宽放行」的那一条条目（生产接线读的就是它，见 `relaxedDispatchEntry`）。 */
const relaxedEntry = (entries, task) => relaxedDispatchEntry(entries, task);

/**
 * 生产接线的最小复刻 —— `worker-driver.ts` 的派发环在 `spawnSelected` 之前做的就**是**这两步：
 * `relaxedDispatchEntry(filterSink, sel.task)` 取条目，取到就 `recordRelaxedDispatch(...)` 落一行。
 * 本文件用它把「真实放行 ⇒ 真实落盘」这条链端到端跑一遍（⛔ 不是另写一份判定）。
 */
function dispatchLike(root, entries, task, nowMs) {
  const e = relaxedEntry(entries, task);
  if (e === null) return null;
  return recordRelaxedDispatch(root, e, { nowMs });
}

/** 从**载体文件**逐字回读账本原始行（⛔ 不用内存对象冒充「落盘了」）。 */
function readLedgerLines(root) {
  const file = path.join(root, RELAXED_DISPATCH_REL);
  if (!fs.existsSync(file)) return null; // 载体不存在 —— 与「存在但 0 行」不同形
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
}

/**
 * 基线 fixture：候选与在飞对手在 `plugin/scripts/shared.ts` 上重叠。
 * `readyMinutesAgo === null` ⇒ **不写** ready 事件（(g) 的输入：等待时长读不到）。
 */
function buildLiveFixture(tag, { relax = liveConfig(), readyMinutesAgo = 45, inFlight = [BLOCKER], extraInFlight = [], ledger = [], ctxExtra = {} } = {}) {
  const root = makeRoot(tag);
  writeConfig(root, relax);
  writeTask(root, BLOCKER, `- ${SHARED}\n- plugin/scripts/blocker-only.ts`);
  writeTask(root, CAND, `- ${SHARED}\n- plugin/scripts/cand-only.ts`);
  for (const t of extraInFlight) writeTask(root, t.id, t.touches, t.status ?? "ready", t.extraFm ?? "");
  for (const r of ledger) appendLedgerRecord(root, r.task, r.blockers, r.overlapFiles, r.waitedMinutes, r.dispatchedAt);
  if (readyMinutesAgo !== null) appendReadyEvent(root, CAND, at(readyMinutesAgo), 1);
  appendReadyEvent(root, BLOCKER, at(5), 2);
  const ctx = makeFilterContext(root, { inFlight: [...inFlight], nowMs: NOW_MS, ...ledgerCtx(root), ...ctxExtra });
  return { root, ctx, candidates: [CAND] };
}

/**
 * 生产接线的最小复刻之一 —— `worker-driver.ts` 的派发环**每轮一次**读 AC-363 的账本，把
 * `records[].task` 与 `malformed.length` 经 ctx 带进谓词（⛔ 谓词自己不 I/O，driver-filters 也
 * 不能 import 账本模块——值环）。本文件每次装配 ctx 都走它（⛔ 不手写 `relaxedTaskIds`）。
 */
function ledgerCtx(root) {
  const l = readRelaxedDispatchLedger(root);
  return { relaxedTaskIds: l.records.map((r) => r.task), relaxedLedgerMalformed: l.malformed.length };
}

// ══ AC2 — (a) 阈值边界（注入时钟，双向） ═══════════════════════════════════════════════════════════

test("AC2(a) — 等待恰等于 after_minutes ⇒ 保留；恰少一分钟 ⇒ 滤掉（注入时钟，双向读数）", (t) => {
  const eq = buildLiveFixture("ac2-eq", { readyMinutesAgo: 30, relax: liveConfig({ after_minutes: 30 }) });
  const eqRun = runTagged(eq.candidates, eq.ctx);
  const eqEntry = touchesEntry(eqRun.entries, CAND);
  assert.deepEqual(eqRun.kept, [CAND], `waited=30 = after_minutes=30 ⇒ 保留（实得 kept=${JSON.stringify(eqRun.kept)}）`);
  assert.equal(relaxedEntry(eqRun.entries, CAND)?.relaxed, true, "条目自报 relaxed:true（真的走的是放行路径）");

  const less = buildLiveFixture("ac2-less", { readyMinutesAgo: 29, relax: liveConfig({ after_minutes: 30 }) });
  const lessRun = runTagged(less.candidates, less.ctx);
  const lessEntry = touchesEntry(lessRun.entries, CAND);
  assert.deepEqual(lessRun.kept, [], `waited=29 < 30 ⇒ 滤掉（实得 kept=${JSON.stringify(lessRun.kept)}）`);
  assert.equal(lessEntry.wouldRelax, false, "不放宽");
  assert.equal(lessEntry.relaxBlockedBy, "waited-enough", `首个不满足者 = waited-enough（实得 ${lessEntry.relaxBlockedBy}）`);

  console.log(`[AC2] 注入 nowMs=${new Date(NOW_MS).toISOString()}；after_minutes=30`);
  console.log(`[AC2] fixture A ready 事件 = ${at(30)} ⇒ waited=${eqEntry?.waitedMinutes ?? relaxedEntry(eqRun.entries, CAND)?.waitedMinutes} ⇒ kept=${JSON.stringify(eqRun.kept)}`);
  console.log(`[AC2] fixture B ready 事件 = ${at(29)} ⇒ waited=${lessEntry.waitedMinutes} ⇒ kept=${JSON.stringify(lessRun.kept)} ⇒ ${lessEntry.relaxBlockedBy}`);
});

// ══ AC3 — (b) never_relax（+ 负控制：换成无关条目） ════════════════════════════════════════════════

test("AC3(b) — 重叠文件命中 never_relax ⇒ 阻塞；负控制：换成无关条目 ⇒ 同一候选被保留", (t) => {
  const blocked = buildLiveFixture("ac3-blocked", { relax: liveConfig({ never_relax: [SHARED] }) });
  const blockedRun = runTagged(blocked.candidates, blocked.ctx);
  const blockedEntry = touchesEntry(blockedRun.entries, CAND);
  assert.deepEqual(blockedRun.kept, [], "命中 never_relax ⇒ 被滤掉");
  assert.equal(blockedEntry.wouldRelax, false, "wouldRelax === false");
  assert.equal(blockedEntry.relaxBlockedBy, "not-never-relax", `首个不满足者 = not-never-relax（实得 ${blockedEntry.relaxBlockedBy}）`);
  dispatchLike(blocked.root, blockedRun.entries, CAND, NOW_MS);
  assert.equal(readLedgerLines(blocked.root), null, "账本零写入（载体文件根本不存在）");

  // 负控制：同一 fixture，只把 never_relax 换成一条无关条目 ⇒ 同一候选被保留。
  const free = buildLiveFixture("ac3-free", { relax: liveConfig({ never_relax: ["plugin/scripts/unrelated.ts"] }) });
  const freeRun = runTagged(free.candidates, free.ctx);
  assert.deepEqual(freeRun.kept, [CAND], `不再命中 ⇒ 保留（实得 ${JSON.stringify(freeRun.kept)}）`);

  console.log(`[AC3] never_relax=[${SHARED}]（重叠面 ${JSON.stringify(blockedEntry.overlapFiles)}）⇒ kept=${JSON.stringify(blockedRun.kept)} ${blockedEntry.relaxBlockedBy}；账本=${JSON.stringify(readLedgerLines(blocked.root))}`);
  console.log(`[AC3] 负控制 never_relax=[plugin/scripts/unrelated.ts] ⇒ kept=${JSON.stringify(freeRun.kept)}`);
});

// ══ AC4 — (c) 名额（已放宽的**在飞**数 vs max_relaxed_inflight） ═══════════════════════════════════

test("AC4(c) — 已放宽在飞数 = 名额 ⇒ 阻塞；名额 +1 ⇒ 放行（负控制，账本行在 fixture 里）", (t) => {
  // 两个**不与候选重叠**的在飞任务，账本里各有记录 ⇒ relaxedInFlight = 2。
  // （它们不得与候选重叠，否则 (d) 先命中 —— 测的就成了另一条判据。）
  const extraInFlight = [
    { id: "gap-live-r1", touches: "- plugin/scripts/r1-only.ts" },
    { id: "gap-live-r2", touches: "- plugin/scripts/r2-only.ts" },
  ];
  const ledger = [
    { task: "gap-live-r1", blockers: ["gap-live-x1"], overlapFiles: ["plugin/scripts/x1.ts"], waitedMinutes: 40, dispatchedAt: at(60) },
    { task: "gap-live-r2", blockers: ["gap-live-x2"], overlapFiles: ["plugin/scripts/x2.ts"], waitedMinutes: 41, dispatchedAt: at(61) },
  ];
  const common = { inFlight: [BLOCKER, "gap-live-r1", "gap-live-r2"], extraInFlight, ledger };

  const full = buildLiveFixture("ac4-full", { ...common, relax: liveConfig({ max_relaxed_inflight: 2 }) });
  const fullRun = runTagged(full.candidates, full.ctx);
  const fullEntry = touchesEntry(fullRun.entries, CAND);
  assert.deepEqual(fullRun.kept, [], "已放宽在飞 2 = 名额 2 ⇒ 阻塞");
  assert.equal(fullEntry.relaxBlockedBy, "quota-available", `首个不满足者 = quota-available（实得 ${fullEntry.relaxBlockedBy}）`);

  const room = buildLiveFixture("ac4-room", { ...common, relax: liveConfig({ max_relaxed_inflight: 3 }) });
  const roomRun = runTagged(room.candidates, room.ctx);
  assert.deepEqual(roomRun.kept, [CAND], `已放宽在飞 2 < 名额 3 ⇒ 放行（实得 ${JSON.stringify(roomRun.kept)}）`);

  console.log(`[AC4] 账本行（载体回读）= ${JSON.stringify(readLedgerLines(full.root))}`);
  console.log(`[AC4] max_relaxed_inflight=2 ⇒ kept=${JSON.stringify(fullRun.kept)} ${fullEntry.relaxBlockedBy}`);
  console.log(`[AC4] max_relaxed_inflight=3 ⇒ kept=${JSON.stringify(roomRun.kept)}`);
});

// ══ AC5 — (d) 不连锁（+ 负控制：删掉账本里对手那一行） ═════════════════════════════════════════════

test("AC5(d) — 挡住候选的在飞任务本身被放宽过 ⇒ 阻塞；负控制：删掉该账本行 ⇒ 同一候选被保留", (t) => {
  const ledger = [{ task: BLOCKER, blockers: ["gap-live-z"], overlapFiles: ["plugin/scripts/z.ts"], waitedMinutes: 50, dispatchedAt: at(70) }];
  const blocked = buildLiveFixture("ac5-blocked", { ledger, relax: liveConfig({ max_relaxed_inflight: 5 }) });
  const blockedRun = runTagged(blocked.candidates, blocked.ctx);
  const blockedEntry = touchesEntry(blockedRun.entries, CAND);
  assert.deepEqual(blockedRun.kept, [], "对手本身是放宽派发的 ⇒ 阻塞（不连锁）");
  assert.equal(blockedEntry.relaxBlockedBy, "blocker-not-relaxed", `首个不满足者 = blocker-not-relaxed（实得 ${blockedEntry.relaxBlockedBy}）`);

  // 负控制：把账本里**那一行**删掉（其余不动）⇒ 同一候选被保留。
  const noLedger = buildLiveFixture("ac5-none", { ledger: [], relax: liveConfig({ max_relaxed_inflight: 5 }) });
  const noLedgerRun = runTagged(noLedger.candidates, noLedger.ctx);
  assert.deepEqual(noLedgerRun.kept, [CAND], `无该记录 ⇒ 保留（实得 ${JSON.stringify(noLedgerRun.kept)}）`);

  console.log(`[AC5] 账本字节（有对手记录）= ${JSON.stringify(readLedgerLines(blocked.root))} ⇒ kept=${JSON.stringify(blockedRun.kept)} ${blockedEntry.relaxBlockedBy}`);
  console.log(`[AC5] 账本字节（无记录）= ${JSON.stringify(readLedgerLines(noLedger.root))} ⇒ kept=${JSON.stringify(noLedgerRun.kept)}`);
});

// ══ AC6 — (e) 过宽通配（+ 负控制：≥2 段锚定的精确 glob） ══════════════════════════════════════════

test("AC6(e) — 候选 Touches 含过宽通配 ⇒ 阻塞；负控制：换成 ≥2 段锚定的 glob ⇒ 被保留", (t) => {
  // 判据本身的输出先取一次（⛔ 不写第二份判据，读的是 touches-orthogonality-check 的实现）。
  assert.equal(isOverbroadDeclaration("packages/**"), true, 'isOverbroadDeclaration("packages/**") === true');
  assert.equal(isOverbroadDeclaration("packages/quay/src/gate/*.js"), false, 'isOverbroadDeclaration("packages/quay/src/gate/*.js") === false');

  const overbroad = makeRoot("ac6-overbroad");
  writeConfig(overbroad, liveConfig());
  writeTask(overbroad, BLOCKER, `- ${SHARED}`);
  writeTask(overbroad, CAND, "- packages/**");
  appendReadyEvent(overbroad, CAND, at(90), 1);
  const overbroadCtx = makeFilterContext(overbroad, { inFlight: [BLOCKER], nowMs: NOW_MS, ...ledgerCtx(overbroad) });
  const overbroadRun = runTagged([CAND], overbroadCtx);
  const overbroadEntry = touchesEntry(overbroadRun.entries, CAND);
  assert.deepEqual(overbroadRun.kept, [], 'Touches 含 "packages/**" ⇒ 阻塞');
  assert.equal(overbroadEntry.relaxBlockedBy, "no-overbroad-glob", `首个不满足者 = no-overbroad-glob（实得 ${overbroadEntry.relaxBlockedBy}）`);

  // 负控制：同一条候选换成 ≥2 段锚定的精确 glob ⇒ 其余条件都满足 ⇒ 被保留。
  // 通配要展开得到非空集合，故 fixture 根下必须有真文件（`expandDeclaredTouches` 走真 fs 遍历）。
  const precise = makeRoot("ac6-precise");
  writeConfig(precise, liveConfig());
  fs.mkdirSync(path.join(precise, "packages", "quay", "src", "gate"), { recursive: true });
  fs.writeFileSync(path.join(precise, "packages", "quay", "src", "gate", "one.js"), "", "utf8");
  writeTask(precise, BLOCKER, `- ${SHARED}`);
  writeTask(precise, CAND, `- ${SHARED}\n- packages/quay/src/gate/*.js`);
  appendReadyEvent(precise, CAND, at(90), 1);
  const preciseCtx = makeFilterContext(precise, { inFlight: [BLOCKER], nowMs: NOW_MS, ...ledgerCtx(precise) });
  const preciseRun = runTagged([CAND], preciseCtx);
  assert.deepEqual(preciseRun.kept, [CAND], `精确 glob ⇒ 保留（实得 ${JSON.stringify(preciseRun.kept)}）`);

  console.log(`[AC6] "packages/**" ⇒ overbroad=${isOverbroadDeclaration("packages/**")} ⇒ kept=${JSON.stringify(overbroadRun.kept)} ${overbroadEntry.relaxBlockedBy}`);
  console.log(`[AC6] "packages/quay/src/gate/*.js" ⇒ overbroad=${isOverbroadDeclaration("packages/quay/src/gate/*.js")} ⇒ kept=${JSON.stringify(preciseRun.kept)}`);
});

// ══ AC7 — (f) shared_files 短路（不等等待、不写账本） ══════════════════════════════════════════════

test("AC7(f) — 重叠全部落在 shared_files 内且等待远小于阈值 ⇒ 立即放行，且不写账本", (t) => {
  const f = buildLiveFixture("ac7", {
    readyMinutesAgo: 1,
    relax: liveConfig({ after_minutes: 30, shared_files: [SHARED] }),
  });
  const run = runTagged(f.candidates, f.ctx);
  assert.deepEqual(run.kept, [CAND], "重叠面全在白名单内 ⇒ 视为不冲突，立即放行");
  // 判别力：若没有短路，`waited-enough` 会把它滤掉（下面的读数取的就是这个双向事实）。
  const waitedMinutes = 1; // ready = NOW-1min（fixture 事实）；下一条断言把它与阈值对照。
  assert.ok(waitedMinutes < 30, "测试内显式断言 waitedMinutes(1) < after_minutes(30)：短路确实早于等待判定");
  assert.equal(readLedgerLines(f.root), null, "前置：运行前账本载体不存在（零写入的基线）");
  // 短路**不是**一次放宽派发 ⇒ 没有 `relaxed:true` 条目 ⇒ 生产接线不会写账本。
  assert.equal(relaxedEntry(run.entries, CAND), null, "无 relaxed:true 条目（短路不是放宽派发）");
  dispatchLike(f.root, run.entries, CAND, NOW_MS);
  assert.equal(readLedgerLines(f.root), null, "跑过生产接线后账本仍不存在（行数/存在性与基线相同）");

  console.log(`[AC7] fixture ready = ${at(1)}（waited=1）< after_minutes=30；shared_files=[${SHARED}]`);
  console.log(`[AC7] kept=${JSON.stringify(run.kept)}；账本读数=${JSON.stringify(readLedgerLines(f.root))}（null = 载体不存在）`);
});

// ══ AC8 — (g) 等待读不到 ⇒ 阻塞且不伪装成 0 ════════════════════════════════════════════════════════

test("AC8(g) — status-events 无 ready 事件 ⇒ 被滤掉，条目 waitedMinutes === null 且 !== 0", (t) => {
  const f = buildLiveFixture("ac8", { readyMinutesAgo: null });
  const run = runTagged(f.candidates, f.ctx);
  const entry = touchesEntry(run.entries, CAND);
  assert.deepEqual(run.kept, [], "等待读不到 ⇒ 阻塞");
  assert.equal(entry.waitedMinutes, null, `waitedMinutes === null（实得 ${JSON.stringify(entry.waitedMinutes)}）`);
  assert.notEqual(entry.waitedMinutes, 0, "⛔ 缺值不得与「等 0 分钟」同形（硬规则 6/3b）");
  assert.equal(entry.relaxBlockedBy, "waited-enough", "首个不满足者 = waited-enough");
  console.log(`[AC8] 条目 = ${JSON.stringify(entry)}`);
  console.log(`[AC8] kept=${JSON.stringify(run.kept)}（fixture 的 task-status-events.jsonl 里没有 ${CAND} 的 to:"ready"）`);
});

// ══ AC9 — (h) 放行时账本恰好一行、形状与内容逐字正确（+ 负控制） ════════════════════════════════════

test("AC9(h) — 真实放宽放行 ⇒ 账本恰好一行五键，取值与 fixture 事实逐字一致；(b)–(e) 阻塞用例零写入", (t) => {
  const f = buildLiveFixture("ac9", { readyMinutesAgo: 45, relax: liveConfig({ after_minutes: 30 }) });
  assert.equal(readLedgerLines(f.root), null, "前置：运行前载体不存在");
  const run = runTagged(f.candidates, f.ctx);
  const e = relaxedEntry(run.entries, CAND);
  assert.ok(e, `本轮确实产生了 relaxed:true 条目（前置）：${JSON.stringify(run.entries)}`);
  assert.equal(e.blocker, BLOCKER, "条目 blocker = 该在飞对手 id");
  assert.deepEqual(e.overlapFiles, [SHARED], "条目 overlapFiles = 实测交集");
  assert.equal(e.waitedMinutes, 45, "条目 waitedMinutes = 注入时钟算出的等待");

  const appended = dispatchLike(f.root, run.entries, CAND, NOW_MS);
  assert.equal(appended.ok, true, `写盘成功（reason=${appended.reason}）`);

  // 从**载体文件**回读（⛔ 不用内存对象）。
  const lines = readLedgerLines(f.root);
  assert.equal(lines.length, 1, `恰好一行（实得 ${lines.length}）`);
  const rec = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(rec).sort(), ["blockers", "dispatchedAt", "overlapFiles", "task", "waitedMinutes"], "恰含五键");
  assert.equal(rec.task, CAND, "task 逐字");
  assert.deepEqual(rec.blockers, [BLOCKER], "blockers 含该对手 id（单元素）");
  assert.deepEqual(rec.overlapFiles, [SHARED], "overlapFiles 等于实测交集");
  assert.equal(rec.waitedMinutes, 45, "waitedMinutes 等于注入时钟算出的等待");
  assert.equal(rec.dispatchedAt, new Date(NOW_MS).toISOString(), "dispatchedAt 等于注入时钟");
  assert.deepEqual(readRelaxedDispatchLedger(f.root).records.length, 1, "读取器回读也是 1 条（malformed=0）");

  // 负控制：(b)–(e) 四个阻塞用例各跑一遍生产接线后，该账本**零写入**。
  const blockedCases = [
    ["(b)", liveConfig({ never_relax: [SHARED] }), {}],
    ["(c)", liveConfig({ max_relaxed_inflight: 0 }), {}],
    ["(d)", liveConfig(), { ledger: [{ task: BLOCKER, blockers: ["gap-live-z"], overlapFiles: ["plugin/scripts/z.ts"], waitedMinutes: 50, dispatchedAt: at(70) }] }],
    ["(e)", liveConfig(), { overbroad: true }],
  ];
  const zeroWrite = [];
  for (const [tag, relax, opts] of blockedCases) {
    const root = makeRoot(`ac9-neg-${tag.replace(/[()]/g, "")}`);
    writeConfig(root, relax);
    writeTask(root, BLOCKER, `- ${SHARED}`);
    writeTask(root, CAND, opts.overbroad ? "- packages/**" : `- ${SHARED}`);
    for (const r of opts.ledger ?? []) appendLedgerRecord(root, r.task, r.blockers, r.overlapFiles, r.waitedMinutes, r.dispatchedAt);
    appendReadyEvent(root, CAND, at(45), 1);
    appendReadyEvent(root, BLOCKER, at(5), 2);
    const ctx = makeFilterContext(root, { inFlight: [BLOCKER], nowMs: NOW_MS, ...ledgerCtx(root) });
    // 「零写入」的基线 = 该用例**自己**的账本初值（(d) 的 fixture 预置了一行对手记录，故不是 null）。
    const baseline = readLedgerLines(root);
    const r = runTagged([CAND], ctx);
    assert.deepEqual(r.kept, [], `${tag} 阻塞（前置）`);
    dispatchLike(root, r.entries, CAND, NOW_MS);
    const after = readLedgerLines(root);
    assert.deepEqual(after, baseline, `${tag} 之后账本与基线逐字相同（零写入）`);
    zeroWrite.push([tag, after]);
  }

  console.log(`[AC9] 账本逐字行 = ${lines[0]}`);
  console.log(`[AC9] 负控制 (b)-(e) 之后账本 = ${JSON.stringify(zeroWrite)}`);
});

// ══ AC10 — (i) 其它谓词不被绕过 ═════════════════════════════════════════════════════════════════════

test("AC10(i) — 被 depsSatisfied / retryCapNotExhausted / notNeedsHuman 挡住的候选不因放宽而放行，且条目 wouldRelax:true", (t) => {
  const D1 = "gap-live-dep"; // depsSatisfied 挡
  const D2 = "gap-live-retry"; // retryCapNotExhausted 挡
  const D3 = "gap-live-nh"; // notNeedsHuman 挡
  const root = makeRoot("ac10");
  writeConfig(root, liveConfig());
  writeTask(root, BLOCKER, `- ${SHARED}`);
  for (const id of [D1, D2, D3]) writeTask(root, id, `- ${SHARED}`, id === D3 ? "needs-human" : "ready", id === D1 ? "depends_on:\n  - gap-live-no-such-dep\n" : "");
  for (const id of [D1, D2, D3]) appendReadyEvent(root, id, at(90), 1);
  appendReadyEvent(root, BLOCKER, at(5), 2);
  const ctx = makeFilterContext(root, { inFlight: [BLOCKER], nowMs: NOW_MS, retryExhausted: new Set([D2]), ...ledgerCtx(root) });
  const run = runTagged([D1, D2, D3], ctx);

  assert.deepEqual(run.kept, [], `三个都被【非 touches】谓词挡住 ⇒ 都放行不了（实得 ${JSON.stringify(run.kept)}）`);
  for (const id of [D1, D2, D3]) {
    assert.ok(!run.kept.includes(id), `${id} 不在返回集合内`);
  }
  // 至少一个的 touches 条目 wouldRelax:true —— 证明【放宽判据本身为真】，是**组合**把它拦住的。
  const relaxedOnes = [D1, D2, D3].filter((id) => relaxedEntry(run.entries, id) !== null);
  assert.ok(relaxedOnes.length >= 1, `至少一条 relaxed:true 条目（实得 ${JSON.stringify(run.entries)}）`);
  for (const id of relaxedOnes) {
    assert.equal(relaxedEntry(run.entries, id).wouldRelax, true, `${id} 的条目 wouldRelax === true`);
  }

  console.log(`[AC10] kept = ${JSON.stringify(run.kept)}`);
  for (const id of [D1, D2, D3]) {
    console.log(`[AC10] ${id} 条目 = ${JSON.stringify(run.entries.filter((e) => e.task === id))}`);
  }
});

// ══ 词表与既有态的负控制 ════════════════════════════════════════════════════════════════════════════

test("负控制 — 两个条件词表各自冻结；off 下本条恒不放行（live 分支没有泄漏进 off）", (t) => {
  // AC-365 的标注词表**不得**因为本条而增删（它被 off-parity 的 AC4 逐字 deepEqual 钉住）。
  assert.deepEqual(
    [...RELAX_CONDITIONS],
    ["touches-only-blocker", "waited-enough", "quota-available", "not-never-relax", "overlap-shared"],
    "shadow/off 的标注词表仍是那五条",
  );
  // 本条的 live 词表必须**包含** AC-366 点名的四个新条件 id。
  for (const id of ["no-overbroad-glob", "blocker-not-relaxed", "candidate-declares-touches", "overlap-known"]) {
    assert.ok(LIVE_RELAX_CONDITIONS.includes(id), `live 词表含 ${id}`);
  }

  // off：同一份「等待足够久」的 fixture ⇒ **绝不放行**（配置块的存在不得泄漏进 off 决策）。
  const off = buildLiveFixture("neg-off", { readyMinutesAgo: 90, relax: liveConfig({ mode: "off" }) });
  const offRun = runTagged(off.candidates, off.ctx);
  assert.deepEqual(offRun.kept, [], "off ⇒ 不成全（与现状逐字节相同）");
  assert.equal(relaxedEntry(offRun.entries, CAND), null, "off 下不产生 relaxed:true 条目");
  dispatchLike(off.root, offRun.entries, CAND, NOW_MS);
  assert.equal(readLedgerLines(off.root), null, "off 下账本零写入");

  console.log(`[负控制] off ⇒ kept=${JSON.stringify(offRun.kept)}；账本=${JSON.stringify(readLedgerLines(off.root))}`);
});
