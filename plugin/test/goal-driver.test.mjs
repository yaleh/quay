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
// The projection's vocabulary lives in ONE Core module (tasks/gap-goal-next-projection) — the driver
// reaches it through `driver-runtime.ts`; the test asserts the round fact against the same enums.
import { GAP_STATES, GOAL_NEXT_OWNERS, GOAL_NEXT_ACTION_KINDS } from "../../packages/quay/src/core/goal-analysis.ts";

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

    // ③ 枚举：owner ∈ 四个、action.kind ∈ 五个、gapState ∈ GapState 词表（硬规则 3：不布尔）
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
