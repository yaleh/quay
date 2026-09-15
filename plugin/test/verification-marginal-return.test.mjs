// verification-marginal-return.test.mjs — 「每拦下一个缺陷的验证成本」读数机件的单测。
// Task: gap-cost-per-defect-caught-verification-marginal-return
//
// fixture 构造（临时目录，⛔ 不读生产载体）—— 生产读数由 docs/analysis/cost-per-defect-caught.md
// 的复跑锚点取（任务 DoD：关掉注入 seam 后 AC 仍应成立 ⇒ 生产读数必须在【生产载体】上取一次并留锚点）。
//
// 本文件测的是【判定函数本身】：三种去重口径、成本折回、null≠0 的三态、纯税谓词的两个方向、
// 敏感性判定的稳定/不稳定两侧，以及 CLI 的 exit 码（0=有读数 / 2=usage / 3=NOT-EVALUATED）。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CATCH_STATE,
  NOT_EVALUATED,
  DEDUP_DEFINITIONS,
  normalizeReason,
  countStreaks,
  countDistinct,
  dedupeFails,
  costOwnerOf,
  aggregateCost,
  isRealDefectMissing,
  buildRows,
  isPureTax,
  computeSensitivity,
  buildReport,
  renderHuman,
  loadCarriers,
  readStaticCheckRegistry,
  readMutationCases,
} from "../scripts/verification-marginal-return.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "verification-marginal-return.ts");

function tmpRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `vmr-${name}-`));
}

/** 写一个 `.quay/<file>` 载体（内容为对象数组，逐行 JSON）。 */
function writeCarrier(root, file, rows) {
  const dir = path.join(root, ".quay");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  return p;
}

// ── AC1 的输入口径：规范化失败原因 ──────────────────────────────────────────────────────────

test("normalizeReason 把数字/ID 折叠成 N，空原因给显式占位符（不是空串）", () => {
  assert.equal(
    normalizeReason("AC-143 has no criterion defined (fail-closed — an unenforceable AC must never silently pass)"),
    normalizeReason("AC-999 has no criterion defined (fail-closed — an unenforceable AC must never silently pass)"),
    "同一条理由的两个不同 AC 编号必须折叠成同一个键（否则同一缺陷被拆成多个）",
  );
  assert.match(normalizeReason("acceptance failed (exit 7)"), /exit N/);
  assert.match(normalizeReason("stale evidence: GOAL-12-AC-3:1/2 (margin -4)"), /GOAL-N-AC-N/);
  assert.equal(normalizeReason(""), "(no reason)");
  assert.equal(normalizeReason(undefined), "(no reason)");
  assert.equal(normalizeReason("  a\t\tb  "), "a b", "空白折叠");
});

test("一条真理由经规范化后【确实】变化（负控制：谓词不是恒等函数）", () => {
  const raw = "AC-143 has no criterion defined";
  assert.notEqual(normalizeReason(raw), raw, "若规范化是恒等，D2 会退化成 D3");
});

// ── 三种去重口径，逐条手工可验 ─────────────────────────────────────────────────────────────

const EV = (verdict, reason, ts, item = "T1", gate = "g") => ({
  gate,
  pipeline_id: item,
  verdict,
  timestamp: ts,
  payload: { reason },
});

test("D1 streak：同一 (item,gate) 的连续 fail 段算一次；中间夹一次 pass 就断开", () => {
  // 理由用不含数字的词 —— normalizeReason 会把数字折叠成 N（"r1"/"r2" 都变成 "rN"）
  const events = [
    EV("fail", "alpha", "2026-01-01T00:00:00Z"),
    EV("fail", "alpha", "2026-01-01T00:01:00Z"),
    EV("fail", "beta", "2026-01-01T00:02:00Z"),
    EV("pass", "", "2026-01-01T00:03:00Z"),
    EV("fail", "gamma", "2026-01-01T00:04:00Z"),
    EV("fail", "gamma", "2026-01-01T00:05:00Z"),
  ];
  const fails = events.filter((e) => e.verdict === "fail");
  const c = dedupeFails(events, fails, (e) => e.pipeline_id, (e) => e.payload.reason, (e) => e.timestamp);
  assert.equal(c.D1, 2, "两段连续 fail（前 3 条断开在 pass，后 2 条）");
  assert.equal(c.D2, 3, "三种不同理由 alpha/beta/gamma");
  assert.equal(c.D3, 1, "只有一个 item");
});

test("D2 的数字折叠是【有意】的：只差数字的两个理由折叠成一个键（否则同一缺陷被拆开）", () => {
  const ev = [
    EV("fail", "round 17 red", "2026-01-01T00:00:00Z"),
    EV("fail", "round 21 red", "2026-01-01T00:01:00Z"),
  ];
  const c = dedupeFails(ev, ev, (e) => e.pipeline_id, (e) => e.payload.reason, (e) => e.timestamp);
  assert.equal(c.D2, 1);
});

test("D1 对【时间乱序】的输入仍按 timestamp 排序 —— 否则段数会被输入顺序决定", () => {
  const ev = [
    EV("fail", "r", "2026-01-01T00:02:00Z"),
    EV("pass", "", "2026-01-01T00:01:00Z"),
    EV("fail", "r", "2026-01-01T00:00:00Z"),
  ];
  const fails = ev.filter((e) => e.verdict === "fail");
  const c = dedupeFails(ev, fails, (e) => e.pipeline_id, (e) => e.payload.reason, (e) => e.timestamp);
  assert.equal(c.D1, 2, "按时间排：fail(00:00) → pass(00:01) → fail(00:02) = 2 段");
});

test("D2 用【规范化】后的原因：同理由不同 ID 只算一次", () => {
  const ev = [
    EV("fail", "AC-1 has no criterion defined", "2026-01-01T00:00:00Z", "T1"),
    EV("fail", "AC-2 has no criterion defined", "2026-01-01T00:01:00Z", "T1"),
  ];
  const c = dedupeFails(ev, ev, (e) => e.pipeline_id, (e) => e.payload.reason, (e) => e.timestamp);
  assert.equal(c.D2, 1, "AC-1/AC-2 折叠成 AC-N ⇒ 同一缺陷");
  assert.equal(c.D1, 1);
});

test("D3 item：同一 item 上发生过的所有缺陷压成一个（下界口径）", () => {
  const ev = [
    EV("fail", "a", "2026-01-01T00:00:00Z", "T1"),
    EV("pass", "", "2026-01-01T00:01:00Z", "T1"),
    EV("fail", "b", "2026-01-01T00:02:00Z", "T1"),
    EV("fail", "b", "2026-01-01T00:03:00Z", "T2"),
  ];
  const fails = ev.filter((e) => e.verdict === "fail");
  const c = dedupeFails(ev, fails, (e) => e.pipeline_id, (e) => e.payload.reason, (e) => e.timestamp);
  assert.equal(c.D1, 3, "T1 两段 + T2 一段");
  assert.equal(c.D2, 3, "(T1,a) (T1,b) (T2,b) 三个键 —— 理由相同但 item 不同仍算两个缺陷");
  assert.equal(c.D3, 2, "两个 item");
});

test("countStreaks / countDistinct 在空输入上返回 0（不是 NaN/undefined）", () => {
  assert.equal(countStreaks([], () => "k", () => true, () => ""), 0);
  assert.equal(countDistinct([], () => "k"), 0);
});

// ── 成本折回与聚合 ───────────────────────────────────────────────────────────────────────

test("costOwnerOf：gate:<闸>:<task> 折回闸名；其余原样", () => {
  assert.deepEqual(costOwnerOf("gate:dod:gap-x"), { owner: "dod", isGate: true });
  assert.deepEqual(costOwnerOf("gate:ts-typecheck:exp5-M-TS"), { owner: "ts-typecheck", isGate: true });
  assert.deepEqual(costOwnerOf("ready-pool-check"), { owner: "ready-pool-check", isGate: false });
  assert.deepEqual(costOwnerOf("gate:adr-001:T-ADR001"), { owner: "adr-001", isGate: true });
});

test("aggregateCost：同名多行累加 ms/rows/n，gate: 部分单独计", () => {
  const recs = [
    { name: "gate:dod:T1", ms: 1000, n: 1, load: 1, at: "2026-01-01T00:00:00Z", verdict: "pass" },
    { name: "gate:dod:T2", ms: 3000, n: 1, load: 1, at: "2026-01-01T00:01:00Z", verdict: "fail" },
    { name: "pool", ms: 500, n: 7, load: 1, at: "2026-01-01T00:02:00Z" },
  ];
  const m = aggregateCost(recs);
  const dod = m.get("dod");
  assert.equal(dod.ms, 4000);
  assert.equal(dod.rows, 2);
  assert.equal(dod.gateRows, 2);
  assert.equal(dod.verdicts.fail, 1);
  const pool = m.get("pool");
  assert.equal(pool.ms, 500);
  assert.equal(pool.sumN, 7);
  assert.equal(pool.gateRows, 0);
});

// ── AC4 谓词：两个方向 + 三态排除 ────────────────────────────────────────────────────────

const baseRow = (over = {}) => ({
  name: "x",
  kind: "checker",
  costHours: 5,
  costRows: 10,
  sumN: 10,
  judgments: 10,
  channelRecords: 10,
  fails: 0,
  defects: { D1: 0, D2: 0, D3: 0 },
  costPerDefect: { D1: null, D2: null, D3: null },
  catchChannel: "static-check",
  catchCoverage: "2026-01-01→now",
  catchState: CATCH_STATE.MEASURED_ZERO,
  ...over,
});

test("AC4 谓词 —— 正例：成本 > 阈值 ∧ 通道在 ∧ 拦截=0 ⇒ 纯税", () => {
  assert.equal(isPureTax(baseRow(), 1, "D3"), true);
});

test("AC4 谓词 —— 负控制①：拦截数 > 0 ⇒ 不是纯税（谓词能取假）", () => {
  assert.equal(isPureTax(baseRow({ defects: { D1: 2, D2: 2, D3: 2 }, fails: 2 }), 1, "D3"), false);
});

test("AC4 谓词 —— 负控制②：成本未超阈值 ⇒ 不入围（否则低成本的检查器全被误报）", () => {
  assert.equal(isPureTax(baseRow({ costHours: 0.5 }), 1, "D3"), false);
});

test("AC4 谓词 —— 负控制③：【没有拦截通道】不等于 0 拦截 ⇒ 不入围（硬规则 6/3b）", () => {
  const r = baseRow({
    catchChannel: null,
    catchState: CATCH_STATE.NOT_EVALUATED,
    fails: null,
    defects: null,
  });
  assert.equal(isPureTax(r, 1, "D3"), false, "未查 ≠ 没有");
});

test("AC4 谓词 —— 负控制④：成本为 null（未测）⇒ 不入围", () => {
  assert.equal(isPureTax(baseRow({ costHours: null }), 1, "D3"), false);
});

test("三态取值互不相同（读不懂输入不得返回与合格同形的值）", () => {
  const s = new Set(Object.values(CATCH_STATE));
  assert.equal(s.size, 3);
  assert.notEqual(CATCH_STATE.MEASURED_ZERO, CATCH_STATE.NOT_EVALUATED);
});

// ── 晋升通道的「真实缺陷」判据 ───────────────────────────────────────────────────────────

test("isRealDefectMissing：depsReady 单独不算缺陷，混有别的才算", () => {
  assert.equal(isRealDefectMissing(["depsReady=false"]), false, "依赖未就绪是正确调度，不是坏状态");
  assert.equal(isRealDefectMissing(["depsReady=false", "fourArtifacts=false missing=[ac]"]), true);
  assert.equal(isRealDefectMissing(["selfTouchOk=false"]), true);
  assert.equal(isRealDefectMissing(["touchesNarrow=false wideTouches=[plugin/test/]"]), true);
  assert.equal(isRealDefectMissing(["prosePrereqGap=[gap-x]"]), true);
  assert.equal(isRealDefectMissing([]), false);
});

// ── 端到端：buildRows 在 fixture 上产出正确的行 ───────────────────────────────────────────

function fixtureInput() {
  return {
    cost: [{ name: "ready-pool-check", ms: 3_600_000, n: 5, load: 1, at: "2026-01-01T00:00:00Z" }],
    gates: [
      EV("fail", "boom", "2026-01-01T00:00:00Z", "T1", "goal"),
      EV("fail", "boom", "2026-01-01T00:01:00Z", "T1", "goal"),
      EV("fail", "boom", "2026-01-01T00:02:00Z", "T2", "goal"),
    ],
    promotion: [
      { task_id: "A", gate: { eligible: false, missing: ["depsReady=false"] }, action: "skip", ts: "2026-01-01T00:00:00Z" },
      { task_id: "B", gate: { eligible: false, missing: ["fourArtifacts=false missing=[ac]"] }, action: "skip", ts: "2026-01-01T00:01:00Z" },
      { task_id: "B", gate: { eligible: false, missing: ["fourArtifacts=false missing=[ac]"] }, action: "skip", ts: "2026-01-01T00:02:00Z" },
      { task_id: "C", gate: { eligible: true, missing: [] }, action: "promote", ts: "2026-01-01T00:03:00Z" },
    ],
    staticFlags: [],
    registry: new Set(),
    mutationCases: new Set(),
  };
}

const ALL_PRESENT = { costPresent: true, gatesPresent: true, promotionPresent: true, roundsPresent: true };

test("buildRows：闸行的判定数/fail 数/三口径缺陷数", () => {
  const rows = buildRows(fixtureInput(), ALL_PRESENT);
  const goal = rows.find((r) => r.name === "goal");
  assert.equal(goal.judgments, 3);
  assert.equal(goal.fails, 3);
  assert.equal(goal.defects.D1, 2, "T1 一段 + T2 一段");
  assert.equal(goal.defects.D2, 2, "同一理由 'boom' 但两个 item ⇒ 两个键");
  assert.equal(goal.defects.D3, 2, "两个 item");
  assert.equal(goal.costHours, null, "该 fixture 里 goal 闸没有成本行 ⇒ null（未测），不是 0");
  assert.equal(goal.catchState, CATCH_STATE.MEASURED_N);
});

test("buildRows：ready-pool-check 的拦截数只含【非 depsReady】的拒绝", () => {
  const rows = buildRows(fixtureInput(), ALL_PRESENT);
  const rpc = rows.find((r) => r.name === "ready-pool-check");
  assert.equal(rpc.judgments, 1, "判定次数=成本载体调用条数");
  assert.equal(rpc.channelRecords, 4, "通道内记录数=晋升载体的行数（含被跳过/被晋升的）");
  assert.equal(rpc.fails, 2, "A 的 depsReady-only 不算；B 的两条算");
  assert.equal(rpc.defects.D1, 1, "B 连续两段合成一段");
  assert.equal(rpc.defects.D3, 1, "只有一个 task_id");
  assert.equal(rpc.costHours, 1);
  assert.equal(rpc.costPerDefect.D1, 1);
});

test("buildRows：没有拦截通道的检查器 catchState=NOT_EVALUATED 且 defects=null（不是 0）", () => {
  const input = { ...fixtureInput(), cost: [{ name: "mystery-check", ms: 3_600_000, n: 1, load: 1, at: "2026-01-01T00:00:00Z" }] };
  const rows = buildRows(input, ALL_PRESENT);
  const m = rows.find((r) => r.name === "mystery-check");
  assert.equal(m.catchState, CATCH_STATE.NOT_EVALUATED);
  assert.equal(m.fails, null, "null 而非 0");
  assert.equal(m.defects, null);
  assert.equal(m.costPerDefect.D3, null);
  assert.equal(m.costHours, 1, "成本仍然报出来");
});

test("buildRows：载体缺失 ⇒ catchState=NOT_EVALUATED（未查），不是 MEASURED_ZERO", () => {
  const rows = buildRows(fixtureInput(), { ...ALL_PRESENT, gatesPresent: false, promotionPresent: false });
  const goal = rows.find((r) => r.name === "goal");
  assert.equal(goal.catchState, CATCH_STATE.NOT_EVALUATED);
  assert.equal(goal.fails, null);
  const rpc = rows.find((r) => r.name === "ready-pool-check");
  assert.equal(rpc.catchState, CATCH_STATE.NOT_EVALUATED);
});

// ── 敏感性 ───────────────────────────────────────────────────────────────────────────────

test("computeSensitivity：三口径排序一致 ⇒ stable", () => {
  const rows = [
    baseRow({ name: "a", costHours: 10, costPerDefect: { D1: 5, D2: 5, D3: 5 }, defects: { D1: 2, D2: 2, D3: 2 } }),
    baseRow({ name: "b", costHours: 4, costPerDefect: { D1: 2, D2: 2, D3: 2 }, defects: { D1: 2, D2: 2, D3: 2 } }),
  ];
  const s = computeSensitivity(rows, 2);
  assert.equal(s.stable, true);
  assert.match(s.verdict, /稳定/);
  assert.deepEqual(s.rankings.D1, ["a", "b"]);
});

test("computeSensitivity：口径翻转排序顺序 ⇒ sensitive 且措辞明说不可用于决策", () => {
  const rows = [
    baseRow({ name: "a", costHours: 10, costPerDefect: { D1: 5, D2: 1, D3: null }, defects: { D1: 2, D2: 10, D3: 0 } }),
    baseRow({ name: "b", costHours: 4, costPerDefect: { D1: 1, D2: 4, D3: null }, defects: { D1: 4, D2: 1, D3: 0 } }),
  ];
  const s = computeSensitivity(rows, 2);
  assert.equal(s.stable, false);
  assert.match(s.verdict, /不可用于决策/);
  assert.deepEqual(s.rankings.D1, ["a", "b"]);
  assert.deepEqual(s.rankings.D2, ["b", "a"]);
});

test("computeSensitivity：逐行分歧把 max/min > 1.2 的行列出来", () => {
  const rows = [
    baseRow({ name: "goalish", costHours: 1, defects: { D1: 184, D2: 152, D3: 109 }, costPerDefect: { D1: 0.005, D2: 0.007, D3: 0.009 } }),
    baseRow({ name: "steady", costHours: 1, defects: { D1: 2, D2: 2, D3: 2 }, costPerDefect: { D1: 0.5, D2: 0.5, D3: 0.5 } }),
  ];
  const s = computeSensitivity(rows, 2);
  assert.deepEqual(s.spread.map((x) => x.name), ["goalish"]);
  assert.ok(s.spread[0].ratio > 1.2);
});

// ── 报告与渲染 ───────────────────────────────────────────────────────────────────────────

function fixtureReport(minHours = 1, extraCost = []) {
  return buildReport({
    root: "/tmp/x",
    input: { ...fixtureInput(), cost: [...fixtureInput().cost, ...extraCost] },
    meta: ALL_PRESENT,
    paths: { cost: "c", gates: "g", promotion: "p", rounds: "r" },
    minHours,
    topK: 5,
    now: "2026-01-01T00:00:00.000Z",
  });
}

test("AC1：报告逐字打印三条去重口径的定义（口径不写清楚的排序没有意义）", () => {
  const rep = fixtureReport();
  assert.equal(rep.dedupDefinitions.length, 3);
  const text = renderHuman(rep);
  for (const d of DEDUP_DEFINITIONS) {
    assert.ok(text.includes(d.definition), `${d.id} 的定义必须在输出里逐字出现`);
  }
  assert.match(text, /连续 fail 段/);
});

test("AC4：pureTax 清单带【零计数配套动作】的自证结果", () => {
  const input = fixtureInput();
  // ①「成本>1h ∧ 有通道（注册表成员）∧ 窗口内 0 次红」的检查器 ⇒ 纯税清单非空
  input.registry.add("dead-weight-check");
  input.cost.push({ name: "dead-weight-check", ms: 7_200_000, n: 1, load: 1, at: "2026-01-01T00:00:00Z" });
  // ② 让一个【已知有拦截】的行成本越过阈值 ⇒ 谓词有可干跑的对象（否则自证不了）
  input.cost.push({ name: "ready-pool-check", ms: 10_800_000, n: 5, load: 1, at: "2026-01-01T00:00:00Z" });
  const rep = buildReport({
    root: "/tmp/x",
    input,
    meta: ALL_PRESENT,
    paths: { cost: "c", gates: "g", promotion: "p", rounds: "r" },
    minHours: 1,
    topK: 5,
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(rep.pureTax.rows.map((r) => r.name), ["dead-weight-check"]);
  assert.equal(rep.predicateControl.target, "ready-pool-check", "自证目标必须是一个【已知有拦截】的行");
  assert.equal(rep.predicateControl.ok, true, "谓词对有拦截的行必须返回 false");
  assert.equal(rep.pureTax.rows[0].catchState, CATCH_STATE.MEASURED_ZERO);
  assert.equal(rep.pureTax.rows[0].mutationProven, false, "fixture 里没有 mutation case ⇒ 该行两种成因不可区分");
});

test("mutation 证明列：有 case 的行标 true（0 拦截读作干净而非空转）", () => {
  const input = fixtureInput();
  input.registry.add("dead-weight-check");
  input.mutationCases.add("dead-weight-check");
  input.cost.push({ name: "dead-weight-check", ms: 7_200_000, n: 1, load: 1, at: "2026-01-01T00:00:00Z" });
  const rows = buildRows(input, ALL_PRESENT);
  assert.equal(rows.find((r) => r.name === "dead-weight-check").mutationProven, true);
});

test("readMutationCases：目录里的 <name>.sh 映射成名字；目录不存在 ⇒ 空集（不抛）", () => {
  const root = tmpRoot("mutation");
  try {
    assert.equal(readMutationCases(path.join(root, "nope")).size, 0);
    const d = path.join(root, "cases");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "foo-check.sh"), "");
    fs.writeFileSync(path.join(d, "README.md"), "");
    const s = readMutationCases(d);
    assert.deepEqual([...s], ["foo-check"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4：清单为空时仍产出可判读的零计数声明（不是静默空表）", () => {
  // 让 ready-pool-check 的成本越过阈值（它有拦截）⇒ 谓词能被自证，清单仍为空（因为它有拦截）
  const rep = fixtureReport(1, [{ name: "ready-pool-check", ms: 10_800_000, n: 5, load: 1, at: "2026-01-01T00:00:00Z" }]);
  assert.equal(rep.pureTax.rows.length, 0);
  assert.equal(rep.predicateControl.ok, true);
  const text = renderHuman(rep);
  assert.match(text, /条数: 0/);
  assert.match(text, /谓词有效 ✓/);
});

test("AC4：载体里没有「成本>阈值且有拦截」的行 ⇒ 控制自己报未被自证（不假装零命中可信）", () => {
  // 只有成本 1.0h（不 > 1）的 ready-pool-check ⇒ 谓词没有可干跑的对象
  const rep = fixtureReport(1);
  assert.equal(rep.pureTax.rows.length, 0);
  assert.equal(rep.predicateControl.target, null);
  assert.equal(rep.predicateControl.ok, false);
  assert.match(renderHuman(rep), /谓词未被自证 ✗/);
});

test("覆盖缺口把「未查」与「没有」分开说，并点名 goal 闸无成本行", () => {
  const rep = fixtureReport();
  const text = renderHuman(rep);
  assert.match(text, /未查/);
  assert.match(text, /goal/);
  assert.ok(Array.isArray(rep.coverageGaps) && rep.coverageGaps.length > 0);
});

test("AC3：ready-pool-check 专项单列，且分母口径在输出里说明", () => {
  const text = renderHuman(fixtureReport());
  assert.match(text, /ready-pool-check 专项/);
  assert.match(text, /每拦截成本/);
  assert.match(text, /depsReady=false 是依赖排序/);
});

test("--json 输出是合法 JSON 且带同一批字段", () => {
  const rep = fixtureReport();
  const round = JSON.parse(JSON.stringify(rep));
  assert.equal(round.dedupDefinitions.length, 3);
  assert.ok(Array.isArray(round.rows));
  assert.ok(round.sensitivity);
});

// ── CLI 端到端（fixture 根目录，⛔ 不读生产载体）───────────────────────────────────────────

test("CLI：载体齐备 ⇒ exit 0，stdout 含去重口径与专项读数", () => {
  const root = tmpRoot("ok");
  try {
    writeCarrier(root, "checker-cost.jsonl", [
      { name: "gate:goal:T1", ms: 100, n: 1, load: 1, at: "2026-01-01T00:00:00Z", verdict: "fail" },
      { name: "ready-pool-check", ms: 7_200_000, n: 3, load: 1, at: "2026-01-01T00:00:01Z" },
    ]);
    writeCarrier(root, "gate-events.jsonl", [EV("fail", "boom", "2026-01-01T00:00:00Z", "T1", "goal")]);
    writeCarrier(root, "promotion-outcome.jsonl", [
      { task_id: "B", gate: { eligible: false, missing: ["fourArtifacts=false missing=[ac]"] }, action: "skip", ts: "2026-01-01T00:00:00Z" },
    ]);
    writeCarrier(root, "verification-round.jsonl", []);
    const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", root], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /连续 fail 段/);
    assert.match(r.stdout, /ready-pool-check 专项/);
    assert.match(r.stdout, /每拦截成本/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI：--json ⇒ exit 0 且 stdout 可 JSON.parse", () => {
  const root = tmpRoot("json");
  try {
    writeCarrier(root, "checker-cost.jsonl", [{ name: "x", ms: 1000, n: 1, load: 1, at: "2026-01-01T00:00:00Z" }]);
    writeCarrier(root, "gate-events.jsonl", [EV("fail", "boom", "2026-01-01T00:00:00Z", "T1", "goal")]);
    const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", root, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.dedupDefinitions.length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI：两个主载体都不存在 ⇒ exit 3（NOT-EVALUATED），绝不与「全部合格」同形", () => {
  const root = tmpRoot("empty");
  try {
    const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", root], { encoding: "utf8" });
    assert.equal(r.status, NOT_EVALUATED);
    assert.match(r.stderr, /NOT-EVALUATED/);
    assert.equal(r.stdout.trim(), "", "NOT-EVALUATED 不得产出与合格同形的报告");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI：未知参数 ⇒ exit 2", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, "--nope"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

test("CLI：--min-hours 非数字 ⇒ exit 2", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, "--min-hours", "abc"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

test("loadCarriers：缺失载体 ⇒ meta 报 false 且输入为空数组（不抛）", async () => {
  const root = tmpRoot("missing");
  try {
    const { meta, input } = await loadCarriers(root);
    assert.equal(meta.costPresent, false);
    assert.equal(meta.gatesPresent, false);
    assert.equal(meta.promotionPresent, false);
    assert.equal(meta.roundsPresent, false);
    assert.deepEqual(input.cost, []);
    assert.deepEqual(input.gates, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("坏行 fail-open：解析不了的行被跳过，不影响其余行（载体是 pure-append 的）", () => {
  const root = tmpRoot("badline");
  try {
    const p = writeCarrier(root, "checker-cost.jsonl", [{ name: "good", ms: 100, n: 1, load: 1, at: "2026-01-01T00:00:00Z" }]);
    fs.appendFileSync(p, "{not json\n", "utf8");
    const carriers = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", root, "--json"], { encoding: "utf8" });
    assert.equal(carriers.status, 0, carriers.stderr);
    const parsed = JSON.parse(carriers.stdout);
    assert.equal(parsed.carriers.cost.records, 1, "坏行被跳过、好行仍在");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("DoD：本机件只报数不删检查器 —— 源码里没有任何删除/写载体的动作", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(src, /fs\.unlinkSync|fs\.rmSync|writeFileSync/, "读数机件不得改写任何载体");
});
