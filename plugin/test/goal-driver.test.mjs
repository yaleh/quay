// @test-group serial
// goal-driver.test.mjs — 立案节流（per-AC 冷却 + 每日上限）的单测，tasks/gap-goal-driver-filing-throttle。
//
// ⚠️ 关于本文件名（⛔ 不要读成「被拆掉的 goal-driver.test.mjs 又回来了」）：原文件已由
// gap-suite-split-15-over-30s-test-files 拆成 goal-driver-s01..s14，共享夹具在
// ./helpers/goal-driver-harness.mjs。本文件是**新增的一个小 shard**，沿用原路径的唯一理由是
// 本任务的 AC 逐字要求 `node --test plugin/test/goal-driver.test.mjs` 可跑。
// ⛔ 本文件**不得** import 那些 shard —— 那会让同一批用例在整套 suite 里跑两遍。
//
// 覆盖：
//   ① 冷却边界（含边界取值与 `nextEligibleAt`）；② 一次立案（意图行 + 终态行）只计一次；
//   ③ 每日上限（尾随 24h 窗口）+ 负控；④ 配置的缺省回落 / 两种拼写 / 非法值 fail-closed；
//   ⑤ 负控：冷却已过且未超日上限 ⇒ **仍可立案**（真跑 runGapSpawnPass）；
//   ⑥ 与 `spawn_cap` 的叠加：**先节流、后切名额**（被节流的 AC ⛔ 不得占名额再空转）；
//   ⑦ 负控：节流**不改变** `goal-gaps` 的状态取值；⑧ 轮 fact 里出现 `filing-throttled` 行。
//   ⑨ (tasks/gap-goal-next-projection) 轮 fact 里出现 `goal-next` 行 —— 每 active GOAL 恰好一行，
//      与 `goal-ring.value.next` 逐字等价，owner / action.kind 在枚举内。
//   ⑩ (tasks/gap-goal-driver-blocked-taxonomy) 轮 fact 里 blocked 三态各自出现（带 blocker + owner），
//      该轮 ⛔ 不再 emit `stalled`。
//
// Run: node --test plugin/test/goal-driver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  GOAL_FILING_DAY_MS,
  appendGoalFilingRow,
  goalFilingLedgerPath,
  goalFilingThrottle,
  readGoalFilingLedger,
  runGapSpawnPass,
  runGoalRound,
  throttleSummary,
  gapViewEntries,
} from "../scripts/goal-driver.ts";
import {
  DRIVERS_CONFIG_REL,
  DEFAULT_GOAL_FILING_COOLDOWN_MS,
  DEFAULT_GOAL_FILING_PER_AC_PER_DAY,
  DEFAULT_ROUTINE_QUOTA_K,
  loadDriverConfig,
  mergeGoalFilingConfig,
  defaultGoalFilingConfig,
} from "../scripts/driver-config.ts";
import { repoRoot, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";
// The request queue's SUBMIT half (tasks/gap-goal-request-queue / AC-936). The consume half is what
// this shard judges; seeding through the production submit function rather than by hand-writing JSON
// keeps the two halves on ONE definition of the row shape and the requestId derivation (硬规则 5b).
import {
  goalRequestId,
  goalRequestLedgerPath,
  readGoalRequestLedger,
  submitGoalRequest,
} from "../../packages/quay/src/core/goal-request.ts";
// The projection's vocabulary lives in ONE Core module (tasks/gap-goal-next-projection) — the driver
// reaches it through `driver-runtime.ts`; the test asserts the round fact against the same enums.
import { GAP_STATES, BLOCKED_GAP_STATES, GOAL_NEXT_OWNERS, GOAL_NEXT_ACTION_KINDS } from "../../packages/quay/src/core/goal-analysis.ts";

const HOUR = 60 * 60 * 1000;

/** 台账里的一条 `spawned`（意图）行——经**被测代码自己的** appendGoalFilingRow 写，⛔ 不手拼 JSON。 */
function seededSpawn(ledgerPath, { requestId, ac, goal = "GOAL-001", atMs }) {
  const w = appendGoalFilingRow(ledgerPath, {
    state: "spawned",
    requestId,
    ac,
    goal,
    at: new Date(atMs).toISOString(),
    promptSha: "0000000000000000",
    round: "R-seed",
    taskCount: 0,
  });
  assert.equal(w.ok, true, `种子台账行必须真的写进去（${w.error}）`);
}

/** 读回台账（节流判定面的输入就是它，⛔ 不在测试里另造一份 rows）。 */
function ledgerAt(ledgerPath) {
  const r = readGoalFilingLedger(ledgerPath);
  assert.equal(r.readable, true, "种子台账必须可读");
  return r;
}

/** 一次可立案的缺口集（`isFilingGapState` 四态之一：`gap`）。 */
function gapOf(acs) {
  return acs.map((ac) => ({ goal: "GOAL-001", ac, state: "gap", taskCount: 0 }));
}

/** 跑一次 spawn pass（`gapWorkerCmd: "true"` = 真子进程但零成本）。 */
function spawnPass(root, gaps, opts = {}) {
  return runGapSpawnPass(gaps, [{ id: "GOAL-001", title: "g", status: "active" }, ...gaps.map((g) => ({
    id: g.ac, goal: g.goal, title: g.ac, expect: "e", status: "active",
  }))], root, {
    gapWorkerCmd: "true",
    resourceGateArgv: ["true"],
    spawnCap: 5,
    filingRound: "R1",
    ...opts,
  });
}

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `goal-filing-throttle-${tag}-`));
}

const T0 = Date.parse("2026-11-06T07:49:45.867Z");
const CFG = { perAcCooldownMs: 6 * HOUR, perAcPerDay: 3 };

// ── ① 冷却边界 ────────────────────────────────────────────────────────────────

test("① 冷却：未到期 ⇒ 节流并给出 nextEligibleAt；恰好到期 ⇒ 可立案（边界取「到期即可」）", () => {
  const tmp = tmpdir("cooldown");
  try {
    const ledgerPath = goalFilingLedgerPath(tmp);
    seededSpawn(ledgerPath, { requestId: "r1", ac: "AC-1", atMs: T0 });
    const read = ledgerAt(ledgerPath);
    const candidates = [{ ac: "AC-1", goal: "GOAL-001" }];

    // 冷却内 1 秒 ⇒ 节流，且 nextEligibleAt 逐字 = 最近一次立案 + 冷却
    const inside = goalFilingThrottle(candidates, read, CFG, T0 + 1000);
    assert.equal(inside.eligible.length, 0, "冷却内不得可立案");
    assert.equal(inside.reading.throttled.length, 1, "逐条可读（⛔ 只给计数）");
    const e = inside.reading.throttled[0];
    assert.equal(e.reason, "cooldown");
    assert.equal(e.ac, "AC-1");
    assert.equal(e.lastFiledAt, new Date(T0).toISOString(), "lastFiledAt 逐字取自台账");
    assert.equal(e.nextEligibleAt, new Date(T0 + CFG.perAcCooldownMs).toISOString(), "nextEligibleAt = 最近一次 + 冷却");
    assert.equal(e.filingsInWindow, 1);
    assert.equal(throttleSummary(inside.reading), "cooldown=1", "摘要按态名计数");

    // 恰好到期（差 0ms）⇒ 可立案：冷却期的定义是 `now - last < cooldown`（闭区间的另一半）
    const boundary = goalFilingThrottle(candidates, read, CFG, T0 + CFG.perAcCooldownMs);
    assert.equal(boundary.eligible.length, 1, "恰好到期即可立案（⛔ 不得多等一轮）");
    assert.deepEqual(boundary.reading.throttled, [], "到期后不再有节流行");
    assert.equal(boundary.reading.evaluated, true);
    assert.equal(boundary.reading.cause, null);

    // 到期前 1ms ⇒ 仍节流（边界的两侧各测一次 —— 只测一侧的边界等于没测）
    const justBefore = goalFilingThrottle(candidates, read, CFG, T0 + CFG.perAcCooldownMs - 1);
    assert.equal(justBefore.eligible.length, 0, "差 1ms 仍在冷却内");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② 一次立案只计一次 ────────────────────────────────────────────────────────

test("② 同一次立案的「意图行 + 终态行」只计一次（按 requestId 去重，⛔ 数成两次）", () => {
  const tmp = tmpdir("dedupe");
  try {
    const ledgerPath = goalFilingLedgerPath(tmp);
    seededSpawn(ledgerPath, { requestId: "r1", ac: "AC-1", atMs: T0 });
    appendGoalFilingRow(ledgerPath, {
      state: "filed", requestId: "r1", ac: "AC-1", goal: "GOAL-001",
      at: new Date(T0 + 8 * 60 * 1000).toISOString(),
      spawnedAt: new Date(T0).toISOString(), taskId: "t1", reason: null,
    });
    const read = ledgerAt(ledgerPath);
    assert.equal(read.rows.length, 2, "台账里确实是两行（意图 + 结论）");

    // 冷却关闭、日上限 **2** ⇒ 这是有区分力的夹具：两行若被数成两次立案，`2 >= 2` 会误判 daily-cap；
    // 按 requestId 去重后只有 1 次 ⇒ `1 < 2` ⇒ 可立案。
    const r = goalFilingThrottle([{ ac: "AC-1", goal: "GOAL-001" }], read, { perAcCooldownMs: 0, perAcPerDay: 2 }, T0 + 10 * 60 * 1000);
    assert.equal(r.eligible.length, 1, "一次立案只占一个配额（意图行 + 结论行是同一件事）");
    assert.deepEqual(r.reading.throttled, []);

    // 反过来：真的第二次立案 ⇒ 同一份上限下必须 daily-cap（证明上一句不是恒真）
    seededSpawn(ledgerPath, { requestId: "r2", ac: "AC-1", atMs: T0 + 20 * 60 * 1000 });
    const r2 = goalFilingThrottle([{ ac: "AC-1", goal: "GOAL-001" }], ledgerAt(ledgerPath), { perAcCooldownMs: 0, perAcPerDay: 2 }, T0 + 30 * 60 * 1000);
    assert.equal(r2.eligible.length, 0, "第二次真立案后日上限生效");
    assert.equal(r2.reading.throttled[0].reason, "daily-cap");
    assert.equal(r2.reading.throttled[0].filingsInWindow, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ③ 每日上限（尾随 24h 窗口） ───────────────────────────────────────────────

test("③ 日上限：尾随 24h 内达到上限 ⇒ daily-cap，nextEligibleAt = 窗口内最早那次 + 24h", () => {
  const tmp = tmpdir("daily");
  try {
    const ledgerPath = goalFilingLedgerPath(tmp);
    const times = [T0, T0 + 5 * HOUR, T0 + 10 * HOUR]; // 三次都在 24h 内
    times.forEach((t, i) => seededSpawn(ledgerPath, { requestId: `r${i}`, ac: "AC-1", atMs: t }));
    const cfg = { perAcCooldownMs: 0, perAcPerDay: 3 };
    const now = T0 + 12 * HOUR;

    const r = goalFilingThrottle([{ ac: "AC-1", goal: "GOAL-001" }], ledgerAt(ledgerPath), cfg, now);
    assert.equal(r.eligible.length, 0);
    const e = r.reading.throttled[0];
    assert.equal(e.reason, "daily-cap");
    assert.equal(e.filingsInWindow, 3, "窗口内计数逐条带出（⛔ 只有布尔）");
    assert.equal(e.nextEligibleAt, new Date(times[0] + GOAL_FILING_DAY_MS).toISOString(), "最早那次滑出窗口的时刻");

    // 负控（同一份台账、只把日上限抬到 4）⇒ 不再节流：证明上面的红来自上限而不是别的原因
    const looser = goalFilingThrottle([{ ac: "AC-1", goal: "GOAL-001" }], ledgerAt(ledgerPath), { ...cfg, perAcPerDay: 4 }, now);
    assert.equal(looser.eligible.length, 1, "上限抬到 4 ⇒ 可立案（负控）");

    // 负控（窗口）⇒ 把现在推到最早那次 + 24h + 1ms：窗口内只剩 2 次 ⇒ 低于上限 3 ⇒ 可立案
    const later = goalFilingThrottle([{ ac: "AC-1", goal: "GOAL-001" }], ledgerAt(ledgerPath), cfg, times[0] + GOAL_FILING_DAY_MS + 1);
    assert.equal(later.eligible.length, 1, "最早的立案滑出窗口后计数回落");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("③b 台账读不动 ⇒ 全部候选 ledger-unreadable（fail-closed，⛔ 不冒充「没立过案」）", () => {
  const candidates = [{ ac: "AC-1", goal: "GOAL-001" }, { ac: "AC-2", goal: "GOAL-001" }];
  const r = goalFilingThrottle(candidates, { readable: false, rows: [], cause: "EACCES: permission denied" }, CFG, T0);
  assert.equal(r.eligible.length, 0, "读数不可用时不得 spawn（方向 = 宁可少派，不可重复立）");
  assert.equal(r.reading.evaluated, false, "⛔ 与「判过且零条」同形");
  assert.equal(r.reading.cause, "EACCES: permission denied");
  assert.deepEqual(r.reading.throttled.map((t) => t.reason), ["ledger-unreadable", "ledger-unreadable"]);
  assert.deepEqual(r.reading.throttled.map((t) => t.nextEligibleAt), [null, null], "「不知道」⛔ 不得长得像「已排定」");
  assert.deepEqual(r.reading.throttled.map((t) => t.filingsInWindow), [null, null], "⛔ 折成 0");

  // 第四态的另一半：台账可读但某行时间戳读不懂 ⇒ ledger-time-unreadable（与上面不同形）
  const bad = goalFilingThrottle([{ ac: "AC-1", goal: "GOAL-001" }], {
    readable: true, cause: null,
    rows: [{ state: "spawned", requestId: "r1", ac: "AC-1", goal: "GOAL-001", at: "not-a-date", promptSha: "x", round: "R", taskCount: 0 }],
  }, CFG, T0);
  assert.equal(bad.eligible.length, 0, "时钟读不懂 ⇒ fail-closed（丢掉最晚一行会让节流变松）");
  assert.equal(bad.reading.evaluated, true, "台账本身读得到 ⇒ evaluated:true（仪器故障在条目上，不在整体上）");
  assert.equal(bad.reading.throttled[0].reason, "ledger-time-unreadable");
  assert.notEqual(bad.reading.throttled[0].reason, "ledger-unreadable", "两个仪器故障不同形（硬规则 3b）");
});

// ── ④ 配置：缺省回落 / 两种拼写 / 非法值 fail-closed ────────────────────────────

test("④ drivers.yml kinds.goal.filing：缺失取缺省、两种拼写都认、非法值 fail-closed 并留痕", () => {
  const tmp = tmpdir("cfg");
  try {
    const yml = path.join(tmp, DRIVERS_CONFIG_REL);
    // (a) 文件缺失 ⇒ 缺省，且**无留痕**（「没写这一段」不是一个异常）
    let f = loadDriverConfig(tmp).goal.filing;
    assert.equal(f.perAcCooldownMs, DEFAULT_GOAL_FILING_COOLDOWN_MS);
    assert.equal(f.perAcPerDay, DEFAULT_GOAL_FILING_PER_AC_PER_DAY);
    assert.deepEqual(f.warnings, [], "读不到 ⇒ 无留痕");
    assert.equal(DEFAULT_GOAL_FILING_PER_AC_PER_DAY, DEFAULT_ROUTINE_QUOTA_K, "日上限缺省与 routine 配额缺省同值（同一处取值）");

    fs.mkdirSync(path.dirname(yml), { recursive: true });
    // (b) 段在场、两字段都写（snake_case，本文件的既定拼写）⇒ 读到
    fs.writeFileSync(yml, "kinds:\n  goal:\n    filing:\n      per_ac_cooldown_ms: 3600000\n      per_ac_per_day: 1\n");
    f = loadDriverConfig(tmp).goal.filing;
    assert.equal(f.perAcCooldownMs, 3_600_000);
    assert.equal(f.perAcPerDay, 1);
    assert.deepEqual(f.warnings, []);

    // (c) camelCase 拼写（**任务的 AC 逐字用的就是这两个名字**）⇒ 同样读到
    fs.writeFileSync(yml, "kinds:\n  goal:\n    filing:\n      perAcCooldownMs: 7200000\n      perAcPerDay: 2\n");
    f = loadDriverConfig(tmp).goal.filing;
    assert.equal(f.perAcCooldownMs, 7_200_000);
    assert.equal(f.perAcPerDay, 2);

    // (d) 两种拼写同时给出 ⇒ snake 胜出（确定、可测；⛔ 不猜「哪个更晚」）
    fs.writeFileSync(yml, "kinds:\n  goal:\n    filing:\n      per_ac_cooldown_ms: 1000\n      perAcCooldownMs: 9999\n");
    assert.equal(loadDriverConfig(tmp).goal.filing.perAcCooldownMs, 1000, "snake 优先");

    // (e) 段在场但字段缺席 ⇒ 取缺省且**无留痕**（与「读到但荒谬」不同形）
    fs.writeFileSync(yml, "kinds:\n  goal:\n    filing:\n      per_ac_per_day: 2\n");
    f = loadDriverConfig(tmp).goal.filing;
    assert.equal(f.perAcCooldownMs, DEFAULT_GOAL_FILING_COOLDOWN_MS);
    assert.equal(f.perAcPerDay, 2);
    assert.deepEqual(f.warnings, [], "字段缺席不是异常");

    // (f) 非法值 ⇒ 回退缺省 **并留痕**（fail-closed：读到荒谬值⛔ 不得让节流变松）
    const bad = mergeGoalFilingConfig(
      { per_ac_cooldown_ms: -5, per_ac_per_day: 0, per_ac_per_day_typo: 9 },
      defaultGoalFilingConfig(),
    );
    assert.equal(bad.perAcCooldownMs, DEFAULT_GOAL_FILING_COOLDOWN_MS, "负冷却 ⇒ 缺省");
    assert.equal(bad.perAcPerDay, DEFAULT_GOAL_FILING_PER_AC_PER_DAY, "日上限 0 ⇒ 缺省（⛔ 让整轮永远不 spawn）");
    assert.equal(bad.warnings.length, 2, `两项各一条留痕（实测：${JSON.stringify(bad.warnings)}）`);
    assert.ok(bad.warnings.every((w) => w.startsWith("kinds.goal.filing.")), "留痕点名到字段");

    // (g) 冷却 0 是**合法值**（显式关闭节流），不算荒谬
    const off = mergeGoalFilingConfig({ per_ac_cooldown_ms: 0 }, defaultGoalFilingConfig());
    assert.equal(off.perAcCooldownMs, 0);
    assert.deepEqual(off.warnings, [], "0 是合法取值（⛔ 与非法值同形）");

    // (h) `filing` 段不是映射 ⇒ 缺省、无留痕（同「没写」）
    const notMap = mergeGoalFilingConfig("nope", defaultGoalFilingConfig());
    assert.deepEqual(notMap, { ...defaultGoalFilingConfig(), warnings: [] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑤ 负控：冷却已过 ⇒ 仍可立案（真跑 spawn pass） ─────────────────────────────

test("⑤ 负控：冷却已过且未超日上限 ⇒ **仍可立案**（spawn pass 真跑，台账真的多一行意图行）", () => {
  const tmp = tmpdir("negative");
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    const ledgerPath = goalFilingLedgerPath(tmp);
    const nowMs = T0 + 7 * HOUR; // > 6h 冷却
    seededSpawn(ledgerPath, { requestId: "old", ac: "AC-1", atMs: T0 });

    const r = spawnPass(tmp, gapOf(["AC-1"]), {
      filingLedgerPath: ledgerPath,
      filingThrottle: CFG,
      now: () => new Date(nowMs),
    });
    assert.equal(r.spawned, 1, "冷却已过 ⇒ 必须真的立案（⛔ 节流把一切都挡住）");
    assert.deepEqual(r.throttle.throttled, [], "本轮零条被节流");
    assert.equal(r.throttle.evaluated, true);
    assert.equal(r.throttle.candidates, 1);
    const after = readGoalFilingLedger(ledgerPath);
    assert.equal(after.rows.filter((x) => x.state === "spawned").length, 2, "台账真的多了第二行意图（可核）");

    // 同一 fixture、只把时钟拨回冷却内 ⇒ 本次必须被挡住（同一份数据的两个方向）
    const blocked = spawnPass(tmp, gapOf(["AC-1"]), {
      filingLedgerPath: ledgerPath,
      filingThrottle: CFG,
      now: () => new Date(nowMs + 60 * 1000),
    });
    assert.equal(blocked.spawned, 0, "刚立过案 ⇒ 本轮不立案");
    assert.equal(blocked.throttle.throttled[0].reason, "cooldown");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑥ 与 spawn_cap 的叠加：先节流、后切名额 ───────────────────────────────────

test("⑥ 与 spawn_cap 叠加：被节流的 AC ⛔ 不占名额（先节流、后切名额）", () => {
  const tmp = tmpdir("cap");
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    const ledgerPath = goalFilingLedgerPath(tmp);
    const nowMs = T0 + 60 * 1000;
    seededSpawn(ledgerPath, { requestId: "r1", ac: "AC-1", atMs: T0 }); // 冷却内
    const gaps = gapOf(["AC-1", "AC-2", "AC-3"]); // AC-1 排在第一位

    const r = spawnPass(tmp, gaps, {
      filingLedgerPath: ledgerPath,
      filingThrottle: CFG,
      now: () => new Date(nowMs),
      spawnCap: 1,
    });
    assert.equal(r.spawned, 1, "名额 1 ⇒ 只派一条");
    assert.deepEqual(r.outcomes.map((o) => o.ac), ["AC-2"], "派的是**第一条可立案的**（AC-1 在冷却里，⛔ 不占名额）");
    assert.deepEqual(r.throttle.throttled.map((t) => t.ac), ["AC-1"], "被节流的只有 AC-1");
    assert.equal(r.throttle.eligible, 2);

    // 名额 0 ⇒ 一条都不派，但**节流读数照常产出**（读数不依赖名额：读数与「能不能派」是两件事）
    const zero = spawnPass(tmp, gaps, {
      filingLedgerPath: ledgerPath, filingThrottle: CFG, now: () => new Date(nowMs), spawnCap: 0,
    });
    assert.equal(zero.spawned, 0);
    assert.equal(zero.throttle.candidates, 3, "候选数照常报（⛔ 被名额挡住 ≠ 没有候选）");
    // AC-2 也被节流了 —— 因为上面那次真 spawn **自己写进台账**了一行意图（这正是「节流读的是台账、
    // ⛔ 不是进程内存」的直接量：上一轮自己立的案，下一轮自己就被它挡住）。
    assert.deepEqual(zero.throttle.throttled.map((t) => t.ac), ["AC-1", "AC-2"], "读数与名额无关，且来自台账本身");
    assert.ok(zero.throttle.throttled.every((t) => t.reason === "cooldown"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑦ 负控：节流不改变 goal-gaps 的状态取值 ───────────────────────────────────

test("⑦ 负控：节流只改变「本轮是否立案」，**不改变任何缺口态取值**（入参逐字节不变）", () => {
  const tmp = tmpdir("nogapschange");
  try {
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    const ledgerPath = goalFilingLedgerPath(tmp);
    seededSpawn(ledgerPath, { requestId: "r1", ac: "AC-1", atMs: T0 });
    const gaps = [...gapOf(["AC-1"]), { goal: "GOAL-001", ac: "AC-9", state: "world-gated", taskCount: 2 }];
    const before = JSON.stringify(gaps);
    const viewBefore = JSON.stringify(gapViewEntries(gaps));

    const r = spawnPass(tmp, gaps, {
      filingLedgerPath: ledgerPath, filingThrottle: CFG, now: () => new Date(T0 + 60 * 1000),
    });
    assert.equal(r.spawned, 0, "AC-1 被节流");
    assert.equal(JSON.stringify(gaps), before, "缺口数组逐字节不变（⛔ 原地改态）");
    assert.equal(JSON.stringify(gapViewEntries(gaps)), viewBefore, "派生视图也不变");
    assert.equal(gaps[0].state, "gap", "被节流的 AC 仍是 gap —— 节流不是「缺口消失」");

    // 对照：同一份 gaps、台账换成一个「没有该 AC 的历史」的台账 ⇒ 本轮会立案，而缺口态仍然一样
    const fresh = goalFilingLedgerPath(tmpdir("nogapschange2"));
    const r2 = spawnPass(tmp, gaps, {
      filingLedgerPath: fresh, filingThrottle: CFG, now: () => new Date(T0 + 60 * 1000),
    });
    assert.equal(r2.spawned, 1, "对照臂：没有历史的台账 ⇒ 立案");
    assert.equal(JSON.stringify(gaps), before, "对照臂同样不改缺口态");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑧ 轮 fact：filing-throttled 行（含 nextEligibleAt） ────────────────────────

test("⑧ 轮 fact 出现 `filing-throttled` 行（含 nextEligibleAt），且该轮的 goal-gaps 仍报原态", async () => {
  const tmp = tmpdir("round");
  try {
    fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    writeStandingGoalFile(tmp, { id: "GOAL-001", status: "active", kind: "goal" });
    // 判据恒假 + 零关联任务 ⇒ GapState = `gap`（可立案）
    writeStandingGoalFile(tmp, { id: "AC-002", status: "active", kind: "criterion", goal: "GOAL-001", criterion: "exit 1" });
    const ledgerPath = goalFilingLedgerPath(tmp);
    const nowMs = Date.parse("2026-11-06T07:50:45.867Z");
    seededSpawn(ledgerPath, { requestId: "r1", ac: "AC-002", atMs: T0 }); // 1 分钟前立过案

    const r = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: "true",
      resourceGateArgv: ["true"],
      now: () => new Date(nowMs),
    });
    const v = r.fact.value;
    assert.equal(v.spawned, 0, "冷却内的 AC ⇒ 本轮零 spawn");
    assert.equal(v.filing_throttled.evaluated, true);
    assert.equal(v.filing_throttled.candidates, 1, "一条缺口候选");
    assert.equal(v.filing_throttled.throttled.length, 1, "轮 fact 里逐条可读（⛔ 只给计数）");
    const entry = v.filing_throttled.throttled[0];
    assert.equal(entry.ac, "AC-002");
    assert.equal(entry.reason, "cooldown");
    assert.equal(entry.nextEligibleAt, new Date(T0 + DEFAULT_GOAL_FILING_COOLDOWN_MS).toISOString(), "nextEligibleAt 由台账时刻 + 配置冷却算出");
    assert.ok(r.fact.reason.includes("filing-throttled=1/1"), `reason 里逐字带出（实测：${r.fact.reason}）`);

    // 负控（AC4 的另一半）：节流**没有**改变缺口读数 —— goal-gaps fact 照常报 AC-002 = gap
    const gf = r.gapFacts[0];
    const g = gf.value.gaps.find((x) => x.ac === "AC-002");
    assert.equal(g?.state, "gap", "被节流的 AC 在缺口视图里仍是 gap（⛔ 被节流 ≠ 缺口消失）");
    assert.equal(v.gaps.find((x) => x.ac === "AC-002")?.state, "gap", "goal-ring 的原读数同样不变");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑨ 轮 fact：`goal-next` 下一步投影（tasks/gap-goal-next-projection, AC-935）──────────────

test("⑨ 轮 fact 出现 `goal-next` 行：每 active GOAL 一行，且与 `value.next` 逐字等价", async () => {
  const tmp = tmpdir("goal-next");
  try {
    fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    writeStandingGoalFile(tmp, { id: "GOAL-001", status: "active", kind: "goal" });
    // 判据恒假 + 零关联任务 ⇒ GapState = `gap` ⇒ 投影 owner=driver / action=file-task
    writeStandingGoalFile(tmp, { id: "AC-002", status: "active", kind: "criterion", goal: "GOAL-001", criterion: "exit 1" });
    // 一条**非** active 的 GOAL：⛔ 不得出现在投影里（「恰好每个 active GOAL 一行」的另一半）
    writeStandingGoalFile(tmp, { id: "GOAL-000", status: "achieved", kind: "goal" });
    writeStandingGoalFile(tmp, { id: "AC-001", status: "achieved", kind: "criterion", goal: "GOAL-000", criterion: "true" });

    const r = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: "true",
      resourceGateArgv: ["true"],
      spawnCap: 0, // ⛔ 本用例只读投影，不 spawn（`spawnCap: 0` = 名额为零，不是「读不到名额」）
      now: () => new Date(T0),
    });

    // ① fact 本身：name 是 `goal-next`，恰好一条，state=verified（读数取到了）
    assert.equal(r.nextFacts.length, 1, "恰好一条 goal-next fact");
    const fact = r.nextFacts[0];
    assert.equal(fact.name, "goal-next");
    assert.equal(fact.state, "verified", "读数取到了 ⇒ verified（⛔ 不是 failed）");
    assert.equal(fact.value.evaluated, true);
    assert.equal(fact.value.cause, null);

    // ② 每个 active GOAL 恰好一行；非 active 的 GOAL 没有行
    const rows = fact.value.rows;
    assert.equal(rows.length, 1, `只有 GOAL-001 是 active（实测：${JSON.stringify(rows.map((x) => x.goal))}）`);
    assert.equal(rows[0].goal, "GOAL-001");
    assert.equal(rows[0].ac, "AC-002");
    assert.equal(rows[0].gapState, "gap", "缺口读数原样带出（⛔ 投影不是第二套缺口读数）");
    assert.equal(rows[0].rank, "gap");
    assert.equal(rows[0].owner, "driver");
    assert.equal(rows[0].action.kind, "file-task");

    // ③ 枚举：owner ∈ 四个、action.kind ∈ 六个、gapState ∈ GapState 词表（硬规则 3：不布尔）
    assert.ok(GOAL_NEXT_OWNERS.includes(rows[0].owner), "owner 在枚举内");
    assert.ok(GOAL_NEXT_ACTION_KINDS.includes(rows[0].action.kind), "action.kind 在枚举内");
    assert.ok(GAP_STATES.includes(rows[0].gapState), "gapState 在枚举内");

    // ④ 等价性（AC5）：轮 fact 的 goal-next 与 `value.next` 是**同一份来源**的两处落痕 ⇒ 逐字相等。
    // ⛔ 这不是「自证」：两处分别是 `goal-next` fact 的 value.rows 与 `goal-ring` fact 的 value.next，
    // 由同一个数组分别落进两条 fact（不同写入点）——相等说明两处没有各自重算/截断。
    assert.deepEqual(fact.value.rows, r.fact.value.next, "fact.value.rows ≡ goal-ring.value.next");
    assert.match(fact.reason, /active goal 1 个 ⇒ 1 行/, `reason 里带出分母（实测：${fact.reason}）`);

    // ⑤ 负控：投影是**读面**，不改变任何既有判定 —— spawn 仍然只由 gaps 决定（spawnCap=0 ⇒ 0 次）
    assert.equal(r.fact.value.spawned, 0, "投影存在与否都不改变 spawn");
    assert.equal(r.fact.value.gaps.find((x) => x.ac === "AC-002")?.state, "gap", "原缺口读数不变");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑩ 轮 fact：blocked 三态（tasks/gap-goal-driver-blocked-taxonomy）──────────────────────────
//
// 一个 `stalled` 同时表示三件处置完全不同的事（请人 / 修四件套 / 查依赖与 worktree）。本用例在
// **真的一轮** runGoalRound 上钉住：三态各自出现、各自带 blocker（哪条任务、哪种成因）与 owner，
// 且该轮 **不再 emit `stalled`**（它只作为迁移期输入字面量留在词表里）。
// 三条负控：①能自行前进的关联任务 ⇒ in-progress（⛔ 不被「有 stuck」布尔化误判）；
//          ②needs-human 的 AC 不被判成 promotion/dispatch，反之亦然；
//          ③非阻断行不装 blocker（⛔ 不补空对象——空对象会与「查过且无阻断」同形）。

test("⑩ 轮 fact：blocked 三态各自出现（带 blocker + owner），且该轮 ⛔ 不再 emit stalled", async () => {
  const tmp = tmpdir("blocked");
  try {
    fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    // 四个 active GOAL，各自一条 active AC —— `goal-next` 是「每 active GOAL 恰好一行」，故一条 AC
    // 一个 GOAL 才能把三态同时投影出来（同 GOAL 下只会选优先级最高的那条）。
    const ACs = [
      { goal: "GOAL-001", ac: "AC-010", task: "t-needs-human", status: "needs-human" },
      { goal: "GOAL-002", ac: "AC-011", task: "t-bad-todo", status: "todo" },
      { goal: "GOAL-003", ac: "AC-012", task: "t-excluded-ready", status: "ready" },
      { goal: "GOAL-004", ac: "AC-013", task: "t-fine-ready", status: "ready" }, // 负控：可自行前进
    ];
    for (const { goal, ac, task, status } of ACs) {
      writeStandingGoalFile(tmp, { id: goal, status: "active", kind: "goal" });
      writeStandingGoalFile(tmp, { id: ac, status: "active", kind: "criterion", goal, criterion: "exit 1" });
      fs.writeFileSync(
        path.join(tmp, "tasks", `${task}.md`),
        `---\nid: ${task}\nstatus: ${status}\ngoal_ac: ${ac}\n---\n## Proposal\n\n一笔真实任务载体（本用例的唯一控制量是 ready-pool 的判定面）。\n`,
      );
    }
    // ready-pool-check 的测试缝：`t-bad-todo` 不合格（缺四件套）、`t-excluded-ready` 被排除（派不出去）。
    const rp = path.join(tmp, "ready-pool.sh");
    fs.writeFileSync(
      rp,
      `#!/bin/bash\ncat <<'JSON'\n{"candidates":[{"id":"t-bad-todo","eligible":false}],"excluded":[{"id":"t-excluded-ready","reason":"dep-unmet"}]}\nJSON\n`,
    );

    const r = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: "true",
      resourceGateArgv: ["true"],
      readyPoolCmd: ["bash", rp],
      spawnCap: 0, // 本用例只读读数，⛔ 不 spawn
      now: () => new Date(T0),
    });

    // ① goal-gaps fact（缺口视图）：三态各一条，blocker 与 state 一致
    const gaps = r.gapFacts[0].value.gaps;
    const gapOf_ = (ac) => gaps.find((g) => g.ac === ac);
    assert.equal(gapOf_("AC-010")?.state, "blocked-needs-human");
    assert.equal(gapOf_("AC-011")?.state, "blocked-promotion");
    assert.equal(gapOf_("AC-012")?.state, "blocked-dispatch");
    assert.deepEqual(gapOf_("AC-010").blocker, { cause: "blocked-needs-human", tasks: [{ id: "t-needs-human", cause: "blocked-needs-human" }] }, "哪些任务要人处理，逐条可读");
    assert.deepEqual(gapOf_("AC-011").blocker, { cause: "blocked-promotion", tasks: [{ id: "t-bad-todo", cause: "blocked-promotion" }] });
    assert.deepEqual(gapOf_("AC-012").blocker, { cause: "blocked-dispatch", tasks: [{ id: "t-excluded-ready", cause: "blocked-dispatch" }] });
    assert.equal(gapOf_("AC-013"), undefined, "负控：可自行前进的 ready ⇒ in-progress（安静态，不进视图）");

    // ② goal-next fact：每 active GOAL 一行，三态的 owner / action 按成因映射
    const next = r.nextFacts[0];
    assert.equal(next.state, "verified");
    const byAc = new Map(next.value.rows.map((row) => [row.ac, row]));
    assert.equal(byAc.size, 4, "四个 active GOAL ⇒ 四行");
    const nh = byAc.get("AC-010");
    const promo = byAc.get("AC-011");
    const disp = byAc.get("AC-012");
    const fine = byAc.get("AC-013");
    assert.equal(nh.owner, "human");
    assert.equal(nh.action.kind, "ask-human");
    assert.equal(promo.owner, "worker");
    assert.equal(promo.action.kind, "fix-artifacts");
    assert.equal(disp.owner, "worker");
    assert.equal(disp.action.kind, "fix-dispatch", "dispatch 成因有自己的 action（⛔ 不与 promotion 共用 fix-artifacts）");
    assert.equal(fine.gapState, "in-progress");
    assert.equal(fine.action.kind, "resume-task");
    assert.equal(fine.blocker, null, "负控：非阻断行不装 blocker（⛔ 空对象会与「查过且无阻断」同形）");

    // ③ 每个 blocked 行都带 blocker 与 owner，且 blocker.cause 与 gapState 一致
    for (const row of [nh, promo, disp]) {
      assert.ok(BLOCKED_GAP_STATES.includes(row.gapState), `gapState ${row.gapState} 是 blocked-*`);
      assert.ok(GOAL_NEXT_OWNERS.includes(row.owner), "owner 在枚举内");
      assert.ok(GOAL_NEXT_ACTION_KINDS.includes(row.action.kind), "action.kind 在枚举内");
      assert.equal(row.blocker.cause, row.gapState, "blocker.cause ≡ gapState（⛔ 两处口径不一致即漂移）");
      assert.ok(Array.isArray(row.blocker.tasks) && row.blocker.tasks.length > 0, "blocker.tasks 枚举非空");
    }
    // ④ 排序：needs-human 在最前（宣告的优先级序）
    assert.equal(next.value.rows[0].ac, "AC-010", `排序按 GOAL_NEXT_PRIORITY（实测：${next.value.rows.map((x) => x.ac)}）`);

    // ⑤ AC2 的另一半：该轮 ⛔ 不再 emit `stalled`（既不在决议值里，也不在行文的 reason 里）
    for (const g of gaps) assert.notEqual(g.state, "stalled", "缺口视图不再出现 stalled");
    for (const row of next.value.rows) assert.notEqual(row.gapState, "stalled", "投影行不再出现 stalled");
    assert.doesNotMatch(JSON.stringify(next.value), /"stalled"/, "goal-next fact 的序列化里没有 stalled 取值");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑪ 请求队列消费（tasks/gap-goal-request-queue / GOAL-914 AC-936）──────────────────────────
//
// 被判定的是 `runGoalRequestPass` ——**每轮**消费 `.quay/goal-requests.jsonl` 里仍 open 的 `submitted`
// 行、用既有 `gateCriterion` 重跑该 AC、写一条终态行的那一半。本 shard 走**真轮**（`runGoalRound`
// 真跑 goal-store CLI，`spawnCap: 0` 只挡立案 spawn，⛔ 不挡判据），⛔ 不注入 verdict。
//
// 四件事逐条钉住：①三种终态各自出现且**互不同形**（尤其 `not-evaluated` ⛔ 不是 `refused`）；
// ②终态行带 `consumedAt`，且同一个 requestId 在**整个载体**上只有一条终态（AC-936 的判据原文）；
// ③反复跑轮次不产生第二条终态（幂等）；④台账读不动 ⇒ `evaluated:false` + cause，⛔ 不与「零条待办」
// 同形，且不把整轮判失败。

const REQ_REASON = "re-evaluate after the landing criterion changed";

/** 在夹具 root 上提交一条请求（走生产 submit 函数；`goals/` 的真存在性在本 shard 不是被测对象）。 */
function seedRequest(root, goal, ac, reason = REQ_REASON) {
  const r = submitGoalRequest({
    root,
    goal,
    ac,
    reason,
    probe: () => "exists",
    now: () => new Date(T0),
  });
  assert.equal(r.ok, true, `种子请求必须真的写进去（${JSON.stringify(r.refusal)}）`);
  return r.requestId;
}

/** 夹具：一个 active GOAL + 给定 criterion 的 active AC（真跑判据，⛔ 不注入 verdict）。 */
function seedGoalFixture(tag, criterion) {
  const tmp = tmpdir(tag);
  fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
  writeStandingGoalFile(tmp, { id: "GOAL-001", status: "active", kind: "goal" });
  writeStandingGoalFile(tmp, { id: "AC-002", status: "active", kind: "criterion", goal: "GOAL-001", criterion });
  return tmp;
}

const roundOpts = (nowMs) => ({
  scriptRoot: repoRoot,
  gapWorkerCmd: "true",
  resourceGateArgv: ["true"],
  spawnCap: 0, // ⛔ 本 shard 只读请求消费，不立案
  now: () => new Date(nowMs),
});

test("⑪ a PASSING criterion settles the request as `accepted` (real round, real carrier)", async () => {
  const tmp = seedGoalFixture("req-accepted", "true");
  try {
    const ledger = goalRequestLedgerPath(tmp);
    const requestId = seedRequest(tmp, "GOAL-001", "AC-002");
    const nowMs = T0 + 60 * 1000;
    const r = await runGoalRound(tmp, roundOpts(nowMs));

    const requests = r.fact.value.requests;
    assert.equal(requests.evaluated, true, `台账可读 ⇒ evaluated:true (cause: ${requests.cause})`);
    assert.equal(requests.openBefore, 1, "本轮开始时一条待办");
    assert.equal(requests.appended, 1, "本轮写了一条终态");
    assert.equal(requests.openAfter, 0, "写完之后不再有 open 行");
    assert.equal(requests.settled.length, 1, "逐条可读（⛔ 只给计数）");
    const s = requests.settled[0];
    assert.equal(s.requestId, requestId);
    assert.equal(s.ac, "AC-002");
    assert.equal(s.state, "accepted", `判据 pass ⇒ accepted（实测 verdict=${s.verdict}）`);
    assert.equal(s.verdict, "pass", "原始 verdict 一并保留（⛔ 折进 state 就分不清『跑了且失败』与『没跑成』）");

    // 载体本身：submitted + 一条终态，终态带 consumedAt。
    const rows = readGoalRequestLedger(ledger).rows;
    assert.equal(rows.length, 2, "一行提交 + 一行终态");
    const terminal = rows.find((x) => x.requestId === requestId && x.state !== "submitted");
    assert.equal(terminal.state, "accepted");
    assert.equal(terminal.consumedAt, new Date(nowMs).toISOString(), "consumedAt = 消费那一刻");
    assert.equal(terminal.reason, REQ_REASON, "理由随终态一起留在载体里");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("⑪ a FAILING criterion settles it as `refused` — a different terminal state, not a boolean", async () => {
  const tmp = seedGoalFixture("req-refused", "exit 1");
  try {
    const requestId = seedRequest(tmp, "GOAL-001", "AC-002");
    const r = await runGoalRound(tmp, roundOpts(T0 + 60 * 1000));
    const s = r.fact.value.requests.settled[0];
    assert.equal(s.requestId, requestId);
    assert.equal(s.state, "refused", `判据 fail ⇒ refused（实测 verdict=${s.verdict}）`);
    assert.equal(s.verdict, "fail");
    assert.notEqual(s.state, "not-evaluated", "「跑了且失败」与「没跑成」⛔ 不同形");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("⑪ a request for an AC that is NOT in the round's snapshot settles as `not-evaluated` (no criterion run)", async () => {
  const tmp = seedGoalFixture("req-missing-ac", "true");
  try {
    // AC-999 不存在于这份 goals/ —— 请求本身合法（提交时 AC 还在），消费时已不在。
    const requestId = seedRequest(tmp, "GOAL-001", "AC-999");
    const r = await runGoalRound(tmp, roundOpts(T0 + 60 * 1000));
    const s = r.fact.value.requests.settled[0];
    assert.equal(s.requestId, requestId);
    assert.equal(s.state, "not-evaluated", "找不到 AC ⇒ 无法评估（⛔ 不是 refused）");
    assert.equal(s.verdict, null, "判据根本没跑 ⇒ verdict 为 null，⛔ 不伪装成 fail");
    assert.match(s.detail, /ac-not-found-under-goal/, `成因具名（实测：${s.detail}）`);

    // 负控的另一半：这条请求 ⛔ 没有牵动 AC-002 的判据（载体里那条终态仍只有一条，且是 AC-999 的）。
    const rows = readGoalRequestLedger(goalRequestLedgerPath(tmp)).rows;
    assert.equal(rows.filter((x) => x.state !== "submitted").length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("⑪ idempotency: three consecutive rounds leave exactly ONE terminal row (AC-936's uniqueness clause)", async () => {
  const tmp = seedGoalFixture("req-idempotent", "true");
  try {
    const ledger = goalRequestLedgerPath(tmp);
    const requestId = seedRequest(tmp, "GOAL-001", "AC-002");

    const first = await runGoalRound(tmp, roundOpts(T0 + 60 * 1000));
    assert.equal(first.fact.value.requests.appended, 1);

    for (const offset of [120_000, 180_000]) {
      const again = await runGoalRound(tmp, roundOpts(T0 + offset));
      assert.equal(again.fact.value.requests.openBefore, 0, "已落定的请求不再 open");
      assert.equal(again.fact.value.requests.appended, 0, "⛔ 不再写第二条终态");
      assert.deepEqual(again.fact.value.requests.settled, [], "本轮零条落定");
    }

    // AC-936 的判据原文逐条重算一遍（⛔ 不复述它的实现，只断言它的三个条件在本载体上成立）：
    //   ≥1 条终态；每个终态的 requestId 唯一；每个终态都带非空 consumedAt。
    const rows = readGoalRequestLedger(ledger).rows;
    const done = rows.filter((x) => x.state === "accepted" || x.state === "refused" || x.state === "not-evaluated");
    assert.ok(done.length >= 1, "至少一条终态");
    const ids = done.map((x) => x.requestId);
    assert.equal(new Set(ids).size, ids.length, "同一 requestId 只有一条终态");
    assert.deepEqual(ids, [requestId], "就那一条请求");
    for (const row of done) {
      assert.equal(typeof row.consumedAt, "string");
      assert.ok(row.consumedAt.length > 0, "每条终态都带 consumedAt");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("⑪ an UNREADABLE request ledger is reported as evaluated:false + cause, and does NOT fail the round", async () => {
  const tmp = seedGoalFixture("req-unreadable", "true");
  try {
    // 载体位置被一个目录占住 ⇒ readFileSync EISDIR。⛔ 这不是「零条待办」，也不是整轮失败。
    fs.mkdirSync(goalRequestLedgerPath(tmp), { recursive: true });
    const r = await runGoalRound(tmp, roundOpts(T0 + 60 * 1000));
    const requests = r.fact.value.requests;
    assert.equal(requests.evaluated, false, "没查成 ⇒ evaluated:false（⛔ 与『查过且零条』同形）");
    assert.equal(typeof requests.cause, "string");
    assert.ok(requests.cause.length > 0, `成因具名（实测：${requests.cause}）`);
    assert.equal(r.fact.state, "verified", "旁路读数坏掉 ⛔ 不得把整轮判失败（它不参与任何 flip 判定）");
    assert.equal(r.fact.value.requests.openBefore, 0, "读不动时 openBefore 是 0，但 evaluated:false 把它与真空区分开");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑫ 持久度：`goal-next` 行带 unchangedRounds，连续 ≥8 轮的 wait 行升级为人动作 ────────────────
// (tasks/gap-goal-next-unchanged-rounds-escalation / AC-943)
//
// 单轮快照里没有「持续多久」这一维——`world-gated` 的映射是固定的 `world`/`wait`，于是第 1 轮与第
// 53 轮的行逐字相同（生产 2026-11-06 实测：GOAL-914/AC-936 的等待行连续 6 轮不变）。本用例在**真轮**
// 上钉三件事：①每一行都带持久度三字段；②载体读不到时是 0 + evaluated:false（⛔ 不是 1）；
// ③连续 8 轮相同的等待行，本轮（第 9 轮）升级成 `stuck-wait`/`human`/`ask-human`，而 `gapState` 仍
// 诚实地说 `world-gated`。⛔ 不是 fixture 直接喂投影函数——那已经由 goal-analysis.test.mjs 覆盖；
// 这里走的是 driver 的真实读载体 → 投影 → fact 的整条链路。

/** 造一轮：carrier 是投给 driver 的轮载体路径（它同时是 history 的读面）。 */
async function persistenceRound(tmp, carrier) {
  return runGoalRound(tmp, {
    scriptRoot: repoRoot,
    gapWorkerCmd: "true",
    resourceGateArgv: ["true"],
    spawnCap: 0, // ⛔ 只读投影，不 spawn
    goalRoundCarrierPath: carrier,
    now: () => new Date(T0),
  });
}

/** 把 `row` 原样写进 `n` 个历史轮（每轮一条 goal-next fact，信封与 computeRoundRecord 一致）。 */
function seedHistoryRounds(carrier, row, n, { firstRound = 1 } = {}) {
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(JSON.stringify({
      round: firstRound + i,
      run_id: "fixture",
      ts: "2026-11-06T00:00:00.000Z",
      halted: false,
      facts: [{ name: "goal-next", value: { rows: [row], evaluated: true, cause: null }, state: "verified", reason: "fixture" }],
      stopped_mid_round: false,
      skipped_routines: [],
    }));
  }
  fs.writeFileSync(carrier, `${lines.join("\n")}\n`, "utf8");
}

test("⑫ goal-next 每行带持久度三字段；载体读不到 ⇒ 0 + evaluated:false；连续 8 轮未变 ⇒ 升级", async () => {
  const tmp = tmpdir("persistence");
  try {
    fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    writeStandingGoalFile(tmp, { id: "GOAL-001", status: "active", kind: "goal" });
    // 判据读生产载体（`.quay/<file>`）⇒ 关联任务全非牵引时按 `classifyCriterionKind` 判 `world-gated`
    // ⇒ 投影 owner=world / action.kind=wait——正是「等世界」那一类。
    writeStandingGoalFile(tmp, {
      id: "AC-002", status: "active", kind: "criterion", goal: "GOAL-001",
      criterion: `node -e 'require("fs").readFileSync(".quay/ci-runs.jsonl");process.exit(1)'`,
    });
    fs.writeFileSync(
      path.join(tmp, "tasks", "t-done.md"),
      "---\nid: t-done\nstatus: done\ngoal_ac: AC-002\n---\n## Proposal\n\n已完成的关联任务（非牵引 ⇒ 判据仍红时按载体三分）。\n",
    );
    const carrier = path.join(tmp, ".quay", "goal-round.jsonl");

    // ① 载体不存在 ⇒ history 读不到 ⇒ 每行 0 / evaluated:false（⛔ 不是 1，也不是「没这字段」）
    const r1 = await persistenceRound(tmp, carrier);
    const rows1 = r1.nextFacts[0].value.rows;
    assert.equal(rows1.length, 1);
    assert.equal(rows1[0].gapState, "world-gated", `fixture 前提：判据读生产载体 ⇒ world-gated（实测 ${rows1[0].gapState}）`);
    for (const row of rows1) {
      assert.equal(typeof row.streakKey, "string", "streakKey 落在 fact 里");
      assert.ok(row.streakKey.length > 0);
      assert.equal(typeof row.unchangedRounds, "number");
      assert.equal(typeof row.unchangedRoundsEvaluated, "boolean");
      assert.equal(row.unchangedRounds, 0, "读不到历史 ⇒ 0（⛔ 不冒充「第一轮」）");
      assert.equal(row.unchangedRoundsEvaluated, false);
      assert.equal(row.escalated, false, "历史读不到时 ⛔ 不升级（不制造假卡死）");
    }

    // ② 载体存在但空 ⇒ 读到了、零历史轮 ⇒ 1 / evaluated:true
    // （`runGoalRound` 自己**不写**轮记录——写轮记录的是常驻循环——故这里显式造一个空载体，
    //   这正是「读到了、但还没有历史轮」这一态的入口。）
    fs.writeFileSync(carrier, "", "utf8");
    const r2 = await persistenceRound(tmp, carrier);
    const rows2 = r2.nextFacts[0].value.rows;
    assert.equal(rows2[0].unchangedRounds, 1);
    assert.equal(rows2[0].unchangedRoundsEvaluated, true);
    assert.equal(rows2[0].escalated, false);
    assert.equal(rows2[0].owner, "world");
    assert.equal(rows2[0].action.kind, "wait");

    // ③ 把该行原样写进 8 个历史轮 ⇒ 本轮（第 9 轮）必须升级
    seedHistoryRounds(carrier, rows2[0], 8);
    const r3 = await persistenceRound(tmp, carrier);
    const row3 = r3.nextFacts[0].value.rows[0];
    assert.equal(row3.unchangedRounds, 9, "8 个历史轮 + 本轮");
    assert.equal(row3.escalated, true);
    assert.equal(row3.rank, "stuck-wait");
    assert.equal(row3.owner, "human", "「等世界」等够了就不再是等，而是需要人裁决");
    assert.equal(row3.action.kind, "ask-human");
    assert.equal(row3.gapState, "world-gated", "⛔ reading 仍然是诚实的：升级只改 rank/owner/action");
    assert.equal(row3.streakKey, rows2[0].streakKey, "streakKey 是升级前的签名，升级前后逐字相同");
    // 升级行数落进 fact 的 reason（⛔ 不只在 value 里让人自己数）
    assert.match(r3.nextFacts[0].reason, /升级 1 行/, `实测：${r3.nextFacts[0].reason}`);

    // ④ 负控制：把已有载体换成「只有 1 轮历史」⇒ 同一条判据下 ⛔ 不升级（升级是量出来的，不是写死的）
    seedHistoryRounds(carrier, rows2[0], 1);
    const r4 = await persistenceRound(tmp, carrier);
    const row4 = r4.nextFacts[0].value.rows[0];
    assert.equal(row4.unchangedRounds, 2);
    assert.equal(row4.escalated, false);
    assert.equal(row4.owner, "world");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
