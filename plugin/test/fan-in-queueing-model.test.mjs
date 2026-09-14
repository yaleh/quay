import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  NOT_EVALUATED,
  pairLockHolds,
  parseFanInAttempts,
  listFanInAttemptFiles,
  splitFanInLogName,
  busySecsInWindow,
  hourlyRho,
  dist,
  percentile,
  isoToMs,
  waitVsRho,
  concurrencVsThroughput,
  computeModel,
  buildReport,
  readLandingsByDay,
} from "../scripts/fan-in-queueing-model.ts";

// ── fixture 构造（临时目录，⛔ 不读生产载体；生产读数由任务文档的复跑锚点取）─────────
function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-queueing-model-"));
}

/** 造一个 per-run 过程日志：一次 acquire → 若干步骤 → release。 */
function attemptLog({ task = "t1", runId = "wk-prod-1", waitMs = 50, suiteMs = 1000, otherMs = 200 } = {}) {
  const t0 = Date.parse("2026-09-01T00:00:00.000Z");
  let t = t0;
  const at = (ms) => new Date((t += ms)).toISOString();
  const lines = [
    { step: "acquire-fan-in-lock", ts: at(waitMs), wall_ms: waitMs, ok: true },
    { step: "merge-develop", ts: at(10), wall_ms: 10, ok: true },
    { step: "scoped-gate", ts: at(otherMs - 10), wall_ms: otherMs - 10, ok: true },
    { step: "suite-start", ts: at(0), wall_ms: 0, ok: true },
    { step: "suite-end", ts: at(suiteMs), wall_ms: suiteMs, ok: true },
    { step: "release-fan-in-lock", ts: at(0), wall_ms: 0, ok: true },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

// ── AC1：六个必需量 ────────────────────────────────────────────────────────────
test("AC1 六个必需量在真载体形状上全部产出，且没有一个是 undefined", () => {
  const holds = [1, 2, 3, 4, 5].map((i) => ({
    taskId: `t${i}`,
    runId: "r",
    acquire: i * 100,
    release: i * 100 + 40,
    holdSecs: 40,
  }));
  const m = computeModel(holds, [1, 2, 3, 4, 5], [41, 42, 43, 44, 45]);
  for (const [k, v] of Object.entries({
    waitMedian: m.waitSecs.median,
    waitP90: m.waitSecs.p90,
    waitMax: m.waitSecs.max,
    holdMedian: m.holdSecs.median,
    holdP90: m.holdSecs.p90,
    holdMax: m.holdSecs.max,
    rho: m.rho,
    lambda: m.lambdaPerDay,
    L: m.L_byLittle,
  })) {
    assert.notEqual(v, undefined, `${k} 缺失`);
    assert.notEqual(v, NOT_EVALUATED, `${k} 不该是 NOT-EVALUATED（载体齐备时）`);
  }
  // 窗口 = [100, 540] = 440s；持有 5×40s = 200s ⇒ ρ = 200/440（算术写在断言里，⛔ 不写「应接近 0.5」）
  assert.equal(m.rho, 200 / 440);
});

test("AC1 锁事件载体为空 ⇒ 模型整体 NOT-EVALUATED，⛔ 不是 ρ=0", () => {
  const m = computeModel([], [], []);
  assert.equal(m.rho, NOT_EVALUATED);
  assert.equal(m.lambdaPerDay, NOT_EVALUATED);
  assert.equal(m.L_byLittle, NOT_EVALUATED);
  assert.equal(m.holdSecs.median, NOT_EVALUATED);
  // 负控制：NOT-EVALUATED 不得与数值共用类型——若这里变成 0，下游无法区分「没锁」与「锁没用过」
  assert.notEqual(m.rho, 0);
});

test("AC1 未配对的 acquire / release 都计数，⛔ 不静默丢弃", () => {
  const ev = [
    { event: "acquire", epoch: 100, taskId: "a", runId: "r", pid: 1 },
    { event: "release", epoch: 140, taskId: "a", runId: "r", pid: 1 },
    { event: "acquire", epoch: 200, taskId: "b", runId: "r", pid: 2 },
    { event: "release", epoch: 300, taskId: "zzz", runId: "nope", pid: 9 },
    { event: "acquire", epoch: 400, taskId: "c", runId: "r", pid: 3 },
  ];
  const p = pairLockHolds(ev);
  assert.equal(p.holds.length, 1);
  assert.equal(p.holds[0].holdSecs, 40);
  assert.equal(p.unpairedAcquires, 2);
  assert.equal(p.unpairedReleases, 1);
});

test("AC1 epoch 是【秒】不是毫秒——持有 40 秒的区间必须读成 40 而不是 0.04", () => {
  const p = pairLockHolds([
    { event: "acquire", epoch: 1000, taskId: "a", runId: "r", pid: 1 },
    { event: "release", epoch: 1040, taskId: "a", runId: "r", pid: 1 },
  ]);
  assert.equal(p.holds[0].holdSecs, 40);
});

// ── AC2：三段拆分 ──────────────────────────────────────────────────────────────
test("AC2 一次 fan-in 的三段之和与实测端到端残差 <15%", () => {
  const a = parseFanInAttempts(attemptLog({ waitMs: 50, suiteMs: 1000, otherMs: 200 }), "/x/fan-in-t1-wk-prod-1.log");
  assert.equal(a.length, 1);
  const r = a[0];
  // total = release_ts − arrival = (waitMs + 10 + (otherMs-10) + 0 + suiteMs) 秒
  assert.ok(Math.abs(r.totalSecs - (50 + 200 + 1000) / 1000) < 0.001, `total=${r.totalSecs}`);
  const sum = (r.waitSecs + r.suiteSecs + r.otherSecs);
  assert.ok(Math.abs(sum - r.totalSecs) / r.totalSecs < 0.15);
  assert.ok(r.residual < 0.15);
});

test("AC2 suite 未跑（fail 在 suite 之前）⇒ suiteSecs = NOT-EVALUATED，⛔ 不是 0", () => {
  const text = [
    { step: "acquire-fan-in-lock", ts: "2026-09-01T00:00:00.000Z", wall_ms: 10, ok: true },
    { step: "scoped-gate", ts: "2026-09-01T00:00:05.000Z", wall_ms: 5000, ok: false },
    { step: "release-fan-in-lock", ts: "2026-09-01T00:00:06.000Z", wall_ms: 0, ok: true },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");
  const a = parseFanInAttempts(text, "/x/fan-in-t1-wk-prod-1.log");
  assert.equal(a.length, 1);
  assert.equal(a[0].suiteSecs, NOT_EVALUATED);
  assert.notEqual(a[0].suiteSecs, 0);
});

test("AC2 一个文件里的多次 fan-in 尝试被切开，⛔ 不跨尝试聚合成一段", () => {
  const two = attemptLog({ waitMs: 10, suiteMs: 100, otherMs: 100 }) + attemptLog({ waitMs: 20, suiteMs: 200, otherMs: 100 });
  const a = parseFanInAttempts(two, "/x/fan-in-t1-wk-prod-1.log");
  assert.equal(a.length, 2, "红了的 fan-in 重试会重拿锁 ⇒ 同一文件两条 attempt");
  assert.equal(a[0].waitSecs, 0.01);
  assert.equal(a[1].waitSecs, 0.02);
});

test("AC2 残差是【当场取的真实读数】，不是落笔即恒真的断言", () => {
  // 负控制：一个时间戳与 wall_ms 矛盾的日志必须给出【大】残差，⛔ 不得照样报 0
  const text = [
    { step: "acquire-fan-in-lock", ts: "2026-09-01T00:00:00.000Z", wall_ms: 0, ok: true },
    { step: "suite-end", ts: "2026-09-01T00:00:01.000Z", wall_ms: 1000, ok: true },
    { step: "release-fan-in-lock", ts: "2026-09-01T00:10:00.000Z", wall_ms: 0, ok: true },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");
  const a = parseFanInAttempts(text, "/x/fan-in-t1-wk-prod-1.log");
  assert.ok(a[0].residual > 0.15, `残差应暴露缺口，实测 ${a[0].residual}`);
});

// ── 利用率：按区间求交，⛔ 不按起始小时整段归账 ─────────────────────────────────
test("busySecsInWindow 按区间求交——跨小时的长持有不得整段记给起始小时", () => {
  // 持有跨小时边界 h9 的最后一分钟 → h10 的前 50 分钟，共 3600s
  const holds = [{ taskId: "a", runId: "r", acquire: 3600 * 10 - 600, release: 3600 * 10 + 3000, holdSecs: 3600 }];
  // 归账形状是负控制本身：若按 acquire 所在小时【整段】归账，h10 会得到 3600s（ρ=1）而不是 3000s
  assert.equal(busySecsInWindow(holds, 3600 * 10, 3600 * 11), 3000);
  assert.equal(busySecsInWindow(holds, 3600 * 9, 3600 * 10), 600);
  // 两个桶之和 = 整段持有（求交的正确性：不重不漏）
  assert.equal(
    busySecsInWindow(holds, 3600 * 9, 3600 * 10) + busySecsInWindow(holds, 3600 * 10, 3600 * 11),
    holds[0].holdSecs,
  );
});

test("hourlyRho 的 ρ 结构上不可能 >1（mutex 的持有区间互不重叠）", () => {
  const holds = [
    { taskId: "a", runId: "r", acquire: 100, release: 2000, holdSecs: 1900 },
    { taskId: "b", runId: "r", acquire: 2000, release: 3500, holdSecs: 1500 },
  ];
  for (const h of hourlyRho(holds, 0, 3600)) assert.ok(h.rho <= 1.0001, `hour ${h.hour} ρ=${h.rho}`);
});

// ── AC3：并发度 vs 吞吐 ────────────────────────────────────────────────────────
test("AC3 按 in_flight_count 分档，报出每档样本天数；⛔ 缺落地数的日不按 0 计", () => {
  const outcomes = [
    { day: "d1", inFlight: 5, wallMs: 3600000 },
    { day: "d1", inFlight: 5, wallMs: 3600000 },
    { day: "d2", inFlight: 2, wallMs: 3600000 },
    { day: "d3", inFlight: 5, wallMs: 3600000 }, // d3 没有落地数 ⇒ 必须被排除而不是记 0
  ];
  const landings = new Map([
    ["d1", 10],
    ["d2", 3],
  ]);
  const t = concurrencVsThroughput(outcomes, landings, null);
  const byCap = new Map(t.levels.map((l) => [l.maxInFlight, l]));
  assert.equal(byCap.get(2).days, 1);
  assert.equal(byCap.get(2).meanLandings, 3);
  assert.equal(byCap.get(5).days, 1, "d3 无落地数 ⇒ 不进任何档");
  assert.equal(byCap.get(5).meanLandings, 10);
});

test("AC3 落地数读取失败必须显式带出，⛔ 不得与「0 天」同形", () => {
  const t = concurrencVsThroughput([{ day: "d1", inFlight: 5, wallMs: 1 }], new Map(), "spawnSync: git ENOBUFS");
  assert.equal(t.levels.length, 0);
  assert.match(t.landingsReadError, /ENOBUFS/);
});

test("AC3 readLandingsByDay 在非 git 目录返回显式错误，⛔ 不返回一个空的成功", () => {
  const dir = tmpRoot();
  const r = readLandingsByDay(dir);
  assert.equal(r.landings.size, 0);
  assert.ok(r.error, "必须在 error 里说明，否则调用方会把「读不到」读成「没有」");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── AC4：可取假 ────────────────────────────────────────────────────────────────
test("AC4 反向指标（低 ρ 档等待中位）被实测报出，并给出 knee", () => {
  const hrs = [
    { hour: 0, rho: 0.1, arrivals: 1 },
    { hour: 3600, rho: 0.95, arrivals: 1 },
  ];
  const w = waitVsRho(
    [
      { tsMs: 1000, waitSecs: 0.05 },
      { tsMs: 3600 * 1000 + 1000, waitSecs: 500 },
    ],
    hrs,
  );
  assert.equal(w.length, 5, "固定五个 ρ 档");
  assert.equal(w[0].n, 1);
  assert.equal(w[0].medianWaitSecs, 0.05);
  assert.equal(w[4].n, 1);
  assert.equal(w[4].medianWaitSecs, 500);
  assert.equal(w[1].medianWaitSecs, NOT_EVALUATED, "空档 = NOT-EVALUATED，⛔ 不是 0");
});

test("AC4 报告带 falsifier 段且取值可取假（实测值随载体变）", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "fan-in-lock-events.jsonl"),
    [
      { event: "acquire", epoch: 1000, taskId: "t", runId: "r", pid: 1 },
      { event: "release", epoch: 1100, taskId: "t", runId: "r", pid: 1 },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
  fs.writeFileSync(path.join(root, ".quay", "fan-in-t-wk-prod-1.log"), attemptLog({ waitMs: 30 }));
  const rep = buildReport(root);
  assert.match(rep.falsifier.claim, /计算/);
  assert.ok("reverseIndicatorMeasured" in rep.falsifier);
  assert.notEqual(rep.falsifier.reverseIndicatorMeasured, undefined);
  // 载体存在 ⇒ 不是 NOT-EVALUATED；同时 ρ 由 [1000,1100] 窗口算出 = 1.0（持有占满窗口）
  assert.notEqual(rep.model.rho, NOT_EVALUATED);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 载体口径 ───────────────────────────────────────────────────────────────────
test("per-run 日志的枚举排除 fan-in-suite-*.log（那是 suite 裸输出，不是过程日志）", () => {
  const root = tmpRoot();
  const q = path.join(root, ".quay");
  fs.mkdirSync(q, { recursive: true });
  fs.writeFileSync(path.join(q, "fan-in-a-wk-prod-1.log"), "");
  fs.writeFileSync(path.join(q, "fan-in-suite-a~wk-prod-1~0.log"), "");
  const got = listFanInAttemptFiles(root).map((f) => path.basename(f));
  assert.deepEqual(got, ["fan-in-a-wk-prod-1.log"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("splitFanInLogName 把 task 与 runId 拆开（task 里可以带连字符）", () => {
  assert.deepEqual(splitFanInLogName("fan-in-gap-a-b-c-wk-prod-1788168250.log"), {
    task: "gap-a-b-c",
    runId: "wk-prod-1788168250",
  });
});

test("isoToMs 只认严格 ISO-Z；⛔ 不用 Date.parse 的宽松接受（杂串静默变 NaN 是硬规则 6 的坑）", () => {
  assert.equal(isoToMs("2026-09-01T00:00:00.000Z"), Date.UTC(2026, 8, 1, 0, 0, 0, 0));
  assert.equal(isoToMs("2026-09-01T00:00:00Z"), Date.UTC(2026, 8, 1, 0, 0, 0, 0));
  assert.equal(isoToMs("Sep 1 2026"), null);
  assert.equal(isoToMs(""), null);
});

test("percentile/dist 对空输入给 NOT-EVALUATED（硬规则 6：缺值 = 未查）", () => {
  assert.equal(percentile([], 0.5), NOT_EVALUATED);
  const d = dist([]);
  assert.equal(d.n, 0);
  assert.equal(d.median, NOT_EVALUATED);
  assert.equal(d.max, NOT_EVALUATED);
});

test("dist 的中位/p90 按 p 分位取，样本量为 1 时三者相等", () => {
  const d = dist([7]);
  assert.equal(d.n, 1);
  assert.equal(d.min, 7);
  assert.equal(d.median, 7);
  assert.equal(d.p90, 7);
  assert.equal(d.max, 7);
});

// ── 端到端：缺载体 ⇒ 退出码语义分明 ─────────────────────────────────────────────
test("载体全缺 ⇒ 报告整体 NOT-EVALUATED（calling 方据此给退出码 1，不是报一个 ρ=0 的合格）", () => {
  const root = tmpRoot();
  const rep = buildReport(root);
  assert.equal(rep.model.rho, NOT_EVALUATED);
  assert.equal(rep.decomposition.n, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
