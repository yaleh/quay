// @test-group engine
// pool-quality-judge.test.mjs — pool 任务质量语义闸的确定性部分（ADR-033）
// (tasks/gap-pool-quality-semantic-gate)
//
// The defect: pool 质量是「需要语义才能产生的值」——机械脚本只能辅助，真正判定要 schema'd agent
// （ADR-033 accepted）。nyf-semantic-judge workflow 证明过一次然后丢失（49c0be86 flip 4 done，
// 24min）——三层执行核只有「检测 workflow 没被调用」的仪器，没有一层有「调用 workflow」的步骤。
// 处方 = 泛化为 pool-quality-judge（判词加 should-remove 档：前提证伪 → 撤出/重定范围）+ 执行核
// 带机械触发条件的编号步骤。
//
// This file pins BOTH:
//   (a) the deterministic part's LOGIC (plugin/scripts/pool-quality-judge.ts) — hermetic pure-function
//       tests (mechanical triggers, AC counting, verdict aggregation incl. should-remove routing) +
//       CLI tests (--plan / --demo / --aggregate);
//   (b) the DOC-CONTRACT wiring — orchestrator-tick-core.md B 段 must carry the numbered
//       "调用 pool-quality-judge workflow" step with the three mechanical trigger conditions
//       (pool>25 / 最久未复核>48h / 每 10 轮), and the workflow file must carry the four verdicts
//       incl. should-remove (AC2/AC3).
//
// Run:
//   scripts/test.sh plugin/test/pool-quality-judge.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  POOL_SIZE_TRIGGER,
  OLDEST_UNREVIEWED_TRIGGER_MS,
  ROUNDS_SINCE_LAST_JUDGE_TRIGGER,
  VERDICTS,
  computeTriggers,
  taskMechanicalInput,
  actionFor,
  aggregateVerdicts,
  countKeyFor,
  readCurrentRound,
  readLastJudgeRound,
  readLastJudgeRoundState,
  writeLastJudgeRound,
  recordLastJudgeRound,
  qualityRoundPath,
  buildQualityRoundRecord,
  qualityRoundVerdicts,
  appendQualityRound,
} from "../scripts/pool-quality-judge.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TS = path.join(REPO_ROOT, "plugin", "scripts", "pool-quality-judge.ts");

function runCli(args, root = REPO_ROOT) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", TS, "--root", root, ...args], {
    encoding: "utf8",
  });
}

// ── AC3 — mechanical triggers (trigger_is_mechanical) ─────────────────────────────────────────────

test("AC3 — pool > 25 fires the pool-size trigger", () => {
  const r = computeTriggers({ poolCount: 26, oldestUnreviewedAgeMs: 0, roundsSinceLastJudge: 0 });
  assert.equal(r.fired, true);
  assert.ok(r.reasons.includes(`pool>${POOL_SIZE_TRIGGER}`));
});

test("AC3 — oldest-unreviewed > 48h fires the age trigger", () => {
  const r = computeTriggers({
    poolCount: 1,
    oldestUnreviewedAgeMs: OLDEST_UNREVIEWED_TRIGGER_MS + 1,
    roundsSinceLastJudge: 0,
  });
  assert.equal(r.fired, true);
  assert.ok(r.reasons.includes("oldest-unreviewed>48h"));
});

test("AC3 — every 10 verification rounds fires the round trigger", () => {
  const r = computeTriggers({ poolCount: 1, oldestUnreviewedAgeMs: 0, roundsSinceLastJudge: ROUNDS_SINCE_LAST_JUDGE_TRIGGER });
  assert.equal(r.fired, true);
  assert.ok(r.reasons.includes("every-10-rounds"));
});

test("AC3 — boundary: pool == 25 does NOT fire (strictly greater)", () => {
  const r = computeTriggers({ poolCount: POOL_SIZE_TRIGGER, oldestUnreviewedAgeMs: 0, roundsSinceLastJudge: 0 });
  assert.equal(r.fired, false);
  assert.deepEqual(r.reasons, []);
});

test("AC3 — all three conditions false ⇒ not fired, no reasons", () => {
  const r = computeTriggers({ poolCount: 3, oldestUnreviewedAgeMs: 1000, roundsSinceLastJudge: 3 });
  assert.equal(r.fired, false);
  assert.deepEqual(r.reasons, []);
});

test("AC3 — multiple conditions fire accumulates multiple reasons", () => {
  const r = computeTriggers({ poolCount: 30, oldestUnreviewedAgeMs: OLDEST_UNREVIEWED_TRIGGER_MS * 2, roundsSinceLastJudge: 12 });
  assert.equal(r.fired, true);
  assert.equal(r.reasons.length, 3);
});

// ── mechanical AC counting (input to the schema agent — script does arithmetic, not judgment) ─────

test("AC2 — taskMechanicalInput counts AC boxes and classifies all-checked/partial/none", () => {
  const all = taskMechanicalInput("t1", "## Acceptance Criteria\n- [x] a\n- [x] b\n", 0);
  assert.equal(all.acChecked, 2);
  assert.equal(all.acTotal, 2);
  assert.equal(all.acCompleteness, "all-checked");
  const partial = taskMechanicalInput("t2", "## Acceptance Criteria\n- [x] a\n- [ ] b\n", 0);
  assert.equal(partial.acCompleteness, "partial");
  const none = taskMechanicalInput("t3", "## Proposal\nprose only, no AC checklist\n", 0);
  assert.equal(none.acTotal, 0);
  assert.equal(none.acCompleteness, "none");
});

test("AC2 — taskMechanicalInput enumerates the sections present", () => {
  const body = "## Proposal\np\n## Plan\npl\n## Acceptance Criteria\n- [ ] a\n## Definition of Done\n- [ ] d\n";
  const m = taskMechanicalInput("t1", body, 123);
  assert.deepEqual(m.sections.sort(), ["Acceptance Criteria", "Definition of Done", "Plan", "Proposal"]);
  assert.equal(m.fileAgeMs, 123);
});

// ── verdict → action routing (should-remove 生效:前提证伪 → 撤出/重定范围,不是进 pool) ──────────

test("AC4 — actionFor routes should-remove to remove-or-rescope, others to their actions", () => {
  assert.equal(actionFor("ready"), "dispatchable");
  assert.equal(actionFor("needs-work"), "back-to-todo");
  assert.equal(actionFor("should-remove"), "remove-or-rescope");
  assert.equal(actionFor("uncertain"), "needs-human");
});

test("AC4 — aggregateVerdicts counts the distribution and maps should-remove to removal (not pool)", () => {
  const verdicts = [
    { id: "a", verdict: "should-remove", acCompleteness: "partial", premiseSound: false, evidence: "premise falsified" },
    { id: "b", verdict: "ready", acCompleteness: "all-checked", premiseSound: true, evidence: "landed" },
    { id: "c", verdict: "needs-work", acCompleteness: "partial", premiseSound: true, evidence: "AC2 open" },
    { id: "d", verdict: "uncertain", acCompleteness: "all-checked", premiseSound: true, evidence: "verification-window" },
  ];
  const out = aggregateVerdicts(verdicts);
  assert.deepEqual(out.distribution, { ready: 1, "needs-work": 1, "should-remove": 1, uncertain: 1 });
  assert.deepEqual(out.counts, { ready: 1, needsWork: 1, shouldRemove: 1, uncertain: 1, total: 4 });
  assert.deepEqual(out.shouldRemoveIds, ["a"]);
  const a = out.actions.find((x) => x.id === "a");
  assert.equal(a.action, "remove-or-rescope");
  assert.match(a.reason, /premise-falsified/);
});

test("AC4 — countKeyFor maps each verdict string to its camelCase count key", () => {
  assert.equal(countKeyFor("ready"), "ready");
  assert.equal(countKeyFor("needs-work"), "needsWork");
  assert.equal(countKeyFor("should-remove"), "shouldRemove");
  assert.equal(countKeyFor("uncertain"), "uncertain");
});

// ── CLI (node-runnable mechanical surface — the Contract invoke path) ────────────────────────────

test("CLI — --plan emits triggers + pool on the real repo (mechanical quantities in档)", () => {
  const r = runCli(["--plan"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.pool));
  assert.equal(typeof out.triggers.poolCount, "number");
  assert.equal(typeof out.triggers.oldestUnreviewedAgeMs, "number");
  assert.equal(typeof out.triggers.roundsSinceLastJudge, "number");
  assert.ok(Array.isArray(out.tasks));
  // every pool member gets a mechanical input record
  assert.equal(out.tasks.length, out.poolCount);
});

test("CLI — --demo aggregates a verdict distribution including a should-remove case", () => {
  const r = runCli(["--demo"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, "demo");
  assert.equal(out.distribution["should-remove"], 1);
  assert.ok(out.shouldRemoveIds.length >= 1);
  const sr = out.actions.find((a) => a.verdict === "should-remove");
  assert.equal(sr.action, "remove-or-rescope");
});

test("CLI — --aggregate does JS arithmetic over a verdicts JSON file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-"));
  try {
    const file = path.join(tmp, "verdicts.json");
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: "x", verdict: "ready", acCompleteness: "all-checked", premiseSound: true, evidence: "e" },
        { id: "y", verdict: "should-remove", acCompleteness: "none", premiseSound: false, evidence: "premise gone" },
      ]),
    );
    const r = runCli(["--aggregate", file]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.distribution, { ready: 1, "needs-work": 0, "should-remove": 1, uncertain: 0 });
    assert.deepEqual(out.shouldRemoveIds, ["y"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI — --rounds-since overrides the every-10-rounds reading (for tests/manual evaluation)", () => {
  const r = runCli(["--plan", "--rounds-since", "12"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.triggers.roundsSinceLastJudge, 12);
  assert.ok(out.triggers.reasons.includes("every-10-rounds"));
});

// ── round/state readers (fail-open on missing gitignored files) ──────────────────────────────────

test("AC3 — readCurrentRound/readLastJudgeRound are 0 when the gitignored files are absent", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-rd-"));
  try {
    assert.equal(readCurrentRound(tmp), 0);
    assert.equal(readLastJudgeRound(tmp), 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── B15 — 写端补齐 + fail-open 三态（gap-b15-pool-quality-judge-state-persist）──────────────────

test("B15 — readLastJudgeRoundState: missing ⇒ status missing (fail-open), ok ⇒ ok, corrupt ⇒ NOT-EVALUATED (硬规则 3b)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-b15-"));
  try {
    // missing:状态文件不存在 ⇒ fail-open fire 的显式标注,不是静默默认 0。
    const m = readLastJudgeRoundState(tmp);
    assert.equal(m.status, "missing");
    assert.equal(m.lastRound, null);
    assert.match(m.reason, /state-file-absent/);
    // ok:写入后读到有效 lastRound。
    writeLastJudgeRound(tmp, 42);
    const ok = readLastJudgeRoundState(tmp);
    assert.equal(ok.status, "ok");
    assert.equal(ok.lastRound, 42);
    // corrupt:JSON 解析失败 ⇒ NOT-EVALUATED(独立取值,lastRound=null 不可信)。
    fs.writeFileSync(path.join(tmp, ".quay", "pool-quality-judge-state.json"), "{not json");
    const c = readLastJudgeRoundState(tmp);
    assert.equal(c.status, "corrupt");
    assert.equal(c.lastRound, null);
    assert.match(c.reason, /JSON parse failed/);
    // corrupt:lastRound 非法类型 ⇒ 同样 NOT-EVALUATED,不得当作 lastRound=0。
    fs.writeFileSync(path.join(tmp, ".quay", "pool-quality-judge-state.json"), JSON.stringify({ lastRound: "167" }));
    const c2 = readLastJudgeRoundState(tmp);
    assert.equal(c2.status, "corrupt");
    assert.match(c2.reason, /lastRound is not a non-negative number/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("B15 — recordLastJudgeRound persists current round; writeLastJudgeRound persists explicit lastRound", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-b15-wr-"));
  try {
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".quay", "verification-round.jsonl"), '{"round":1}\n{"round":2}\n{"round":3}\n');
    const written = recordLastJudgeRound(tmp);
    assert.equal(written, 3);
    const st = readLastJudgeRoundState(tmp);
    assert.equal(st.status, "ok");
    assert.equal(st.lastRound, 3);
    writeLastJudgeRound(tmp, 166);
    assert.equal(readLastJudgeRound(tmp), 166);
    assert.equal(readLastJudgeRoundState(tmp).lastRound, 166);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 判据3 真样本回放（D2 不构造）:05:07 判过一次后,05:22 的 --plan 报 roundsSinceLastJudge=167、fired=true。
// 写端补齐前回放必须红(lastJudgeRound=0 ⇒ roundsSince=167 ⇒ fire);补齐后同回放必须绿(lastRound 在 ⇒ 10 轮内不 fire)。
test("B15 — 真样本回放(05:07 判过→05:22 仍 fire):写端缺 ⇒ 红,写端在 ⇒ 绿", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-b15-replay-"));
  try {
    // 05:22 的 verification-round 文件:167 行(round 1..167),正是症状里的 currentRound=167。
    const q = path.join(tmp, ".quay", "verification-round.jsonl");
    fs.mkdirSync(path.dirname(q), { recursive: true });
    const lines = [];
    for (let i = 1; i <= 167; i++) lines.push(JSON.stringify({ round: i }));
    fs.writeFileSync(q, lines.join("\n") + "\n");
    // 负控制(写端前):无 judge 状态文件 ⇒ lastJudgeRound=0 ⇒ roundsSince=167,every-10-rounds fire。
    const before = JSON.parse(runCli(["--plan"], tmp).stdout);
    assert.equal(before.currentRound, 167);
    assert.equal(before.lastJudgeState.status, "missing");
    assert.equal(before.roundsSinceLastJudge, 167);
    assert.equal(before.triggers.roundsSinceLastJudge, 167);
    assert.equal(before.triggers.fired, true);
    assert.ok(before.triggers.reasons.includes("every-10-rounds"), "写端缺时必须 fire");
    // 写端(judge 完成持久化):05:07 判的那轮 = 166 ⇒ 距 05:22(167) = 1,10 轮内不 fire。
    writeLastJudgeRound(tmp, 166);
    const after = JSON.parse(runCli(["--plan"], tmp).stdout);
    assert.equal(after.lastJudgeState.status, "ok");
    assert.equal(after.lastJudgeRound, 166);
    assert.equal(after.roundsSinceLastJudge, 1);
    assert.equal(after.triggers.roundsSinceLastJudge, 1);
    assert.equal(after.triggers.fired, false);
    assert.ok(!after.triggers.reasons.includes("every-10-rounds"), "写端在时 10 轮内不得 fire");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 判据2:corrupt(损坏)⇒ NOT-EVALUATED,roundsSinceLastJudge=null,every-10-rounds 不作数——与 fire 不同形。
test("B15 — corrupt judge state ⇒ --plan lastJudgeState=corrupt, roundsSinceLastJudge=null, every-10-rounds NOT fired (NOT-EVALUATED ≠ fire)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-b15-corrupt-"));
  try {
    // currentRound=20(>10),但 judge 状态损坏 ⇒ NOT-EVALUATED,不得伪装成 fire。
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    const lines = [];
    for (let i = 1; i <= 20; i++) lines.push(JSON.stringify({ round: i }));
    fs.writeFileSync(path.join(tmp, ".quay", "verification-round.jsonl"), lines.join("\n") + "\n");
    fs.writeFileSync(path.join(tmp, ".quay", "pool-quality-judge-state.json"), "{broken");
    const r = runCli(["--plan"], tmp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.currentRound, 20);
    assert.equal(out.lastJudgeState.status, "corrupt");
    assert.equal(out.lastJudgeState.lastRound, null);
    assert.equal(out.roundsSinceLastJudge, null);
    // NOT-EVALUATED 不得伪装成 fire:currentRound=20 也不进 every-10-rounds。
    assert.ok(!out.triggers.reasons.includes("every-10-rounds"));
    assert.equal(out.triggers.fired, false);
    // --rounds-since 是显式覆盖:corrupt 时 override 优先(操作者明确指定轮距,不算 NOT-EVALUATED)。
    const r2 = runCli(["--plan", "--rounds-since", "12"], tmp);
    const out2 = JSON.parse(r2.stdout);
    assert.equal(out2.roundsSinceLastJudge, 12);
    assert.ok(out2.triggers.reasons.includes("every-10-rounds"), "override 显式请求 ⇒ every-10-rounds 作数");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// B15 写端接线（doc-contract）:workflow 完成路径必须调确定性写端,否则 lastRound 永远不落盘。
test("B15 — the workflow completion path invokes --record-last-round (single writer, write end)", () => {
  const wf = path.join(REPO_ROOT, "plugin", "workflows", "pool-quality-judge.js");
  const src = fs.readFileSync(wf, "utf8");
  assert.ok(src.includes("--record-last-round"), "workflow 完成路径必须调确定性写端 --record-last-round");
  assert.ok(src.includes("lastJudgeRecorded"), "workflow 返回必须携带 lastJudgeRecorded");
});

// ── DOC-CONTRACT wiring (AC2/AC3: 执行核有「调用 workflow」的编号步骤,判词含 should-remove) ─────

test("AC2 — the workflow file carries the four verdicts incl. should-remove (the proof-once-then-lost fix)", () => {
  const wf = path.join(REPO_ROOT, "plugin", "workflows", "pool-quality-judge.js");
  assert.ok(fs.existsSync(wf), "pool-quality-judge workflow must exist");
  const src = fs.readFileSync(wf, "utf8");
  for (const v of VERDICTS) {
    assert.ok(src.includes(`'${v}'`), `workflow must reference verdict '${v}'`);
  }
  assert.ok(src.includes("should-remove"), "workflow must carry the should-remove tier");
  assert.match(src, /premise-falsified/, "should-remove reason must name premise-falsified → remove-or-rescope");
});

test("AC3 — orchestrator-tick-core.md carries the numbered 调用 pool-quality-judge step + mechanical triggers", () => {
  const core = path.join(REPO_ROOT, "orchestration", "orchestrator-tick-core.md");
  const src = fs.readFileSync(core, "utf8");
  // Contract measure: `grep -c "pool-quality-judge" orchestration/orchestrator-tick-core.md` >= 1
  assert.ok((src.match(/pool-quality-judge/g) || []).length >= 1, "B 段必须有 pool-quality-judge 命中");
  // mechanical triggers must be named in the step (AC3)
  for (const t of ["pool > 25", "48h", "10 轮"]) {
    assert.ok(src.includes(t), `执行核触发条件必须含「${t}」`);
  }
});

// ── 判词载体（gap-pool-quality-verdicts-never-persisted：.quay/quality-round.jsonl 写端）────────────

test("qualityRound — buildQualityRoundRecord three-state (judged/failed/not-triggered) 取值不同（硬规则 3b）", () => {
  const judgedAt = "2026-09-02T00:00:00.000Z";
  const judged = buildQualityRoundRecord({
    round: 5, judgedAt, state: "judged", triggerReasons: ["every-10-rounds"],
    distribution: { ready: 1, "needs-work": 0, "should-remove": 0, uncertain: 0 },
    shouldRemoveIds: [],
    verdicts: [{ taskId: "a", verdict: "ready", action: "dispatchable", evidence: "e", judgedAt, round: 5 }],
  });
  assert.equal(judged.state, "judged");
  assert.equal(judged.verdicts.length, 1);
  const failed = buildQualityRoundRecord({
    round: 5, judgedAt, state: "failed", triggerReasons: [], distribution: null, shouldRemoveIds: [], verdicts: [],
    reason: "judge output not a JSON array",
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.verdicts.length, 0);
  assert.match(failed.reason, /not a JSON array/);
  const notTriggered = buildQualityRoundRecord({
    round: 5, judgedAt, state: "not-triggered", triggerReasons: [], distribution: null, shouldRemoveIds: [], verdicts: [],
  });
  assert.equal(notTriggered.state, "not-triggered");
  // 三态取值不同（读不懂 failed ≠ 没问题 judged ≠ 未触发 not-triggered）。
  assert.notEqual(judged.state, failed.state);
  assert.notEqual(judged.state, notTriggered.state);
  assert.notEqual(failed.state, notTriggered.state);
});

test("qualityRound — qualityRoundVerdicts maps each verdict to {taskId, verdict, action, evidence, judgedAt, round}", () => {
  const verdicts = [
    { id: "gap-a", verdict: "should-remove", acCompleteness: "partial", premiseSound: false, evidence: "premise falsified" },
    { id: "gap-b", verdict: "ready", acCompleteness: "all-checked", premiseSound: true, evidence: "landed" },
  ];
  const agg = aggregateVerdicts(verdicts);
  const out = qualityRoundVerdicts(verdicts, agg.actions, "2026-09-02T00:00:00.000Z", 7);
  assert.equal(out.length, 2);
  const a = out.find((v) => v.taskId === "gap-a");
  assert.equal(a.verdict, "should-remove");
  assert.equal(a.action, "remove-or-rescope");
  assert.equal(a.evidence, "premise falsified");
  assert.equal(a.judgedAt, "2026-09-02T00:00:00.000Z");
  assert.equal(a.round, 7);
});

test("qualityRound — appendQualityRound appends one line to .quay/quality-round.jsonl; refuses empty judged (AC1)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-qr-"));
  try {
    const judgedAt = new Date().toISOString();
    const rec = buildQualityRoundRecord({
      round: 1, judgedAt, state: "judged", triggerReasons: ["pool>25"],
      distribution: { ready: 1, "needs-work": 0, "should-remove": 0, uncertain: 0 },
      shouldRemoveIds: [],
      verdicts: [{ taskId: "gap-a", verdict: "ready", action: "dispatchable", evidence: "e", judgedAt, round: 1 }],
    });
    const p = appendQualityRound(tmp, rec);
    assert.equal(p, path.join(tmp, ".quay", "quality-round.jsonl"));
    assert.equal(qualityRoundPath(tmp), p);
    const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
    assert.equal(lines.length, 1);
    const got = JSON.parse(lines[0]);
    assert.equal(got.state, "judged");
    assert.equal(got.verdicts[0].taskId, "gap-a");
    // 空 judged 记录拒写（AC1：判词为空不写空记录）。
    assert.throws(() => appendQualityRound(tmp, buildQualityRoundRecord({
      round: 1, judgedAt, state: "judged", triggerReasons: [], distribution: null, shouldRemoveIds: [], verdicts: [],
    })), /empty judged/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI — --record-round writes a judged record to .quay/quality-round.jsonl; empty refused", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pqj-rr-"));
  try {
    const file = path.join(tmp, "verdicts.json");
    fs.writeFileSync(file, JSON.stringify([
      { id: "gap-x", verdict: "should-remove", acCompleteness: "none", premiseSound: false, evidence: "premise gone" },
      { id: "gap-y", verdict: "ready", acCompleteness: "all-checked", premiseSound: true, evidence: "landed" },
    ]));
    const r = runCli(["--record-round", file], tmp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.recorded, true);
    assert.equal(out.state, "judged");
    const carrier = path.join(tmp, ".quay", "quality-round.jsonl");
    assert.ok(fs.existsSync(carrier), "carrier must exist after --record-round");
    const rec = JSON.parse(fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.state, "judged");
    assert.equal(rec.verdicts.length, 2);
    assert.ok(rec.verdicts.some((v) => v.verdict === "should-remove" && v.action === "remove-or-rescope"));
    for (const v of rec.verdicts) {
      for (const k of ["taskId", "verdict", "action", "evidence", "judgedAt", "round"]) {
        assert.ok(k in v, `verdict entry must carry key ${k} (AC1 五键以上)`);
      }
    }
    // 空判词文件拒写（AC1）。
    const empty = path.join(tmp, "empty.json");
    fs.writeFileSync(empty, "[]");
    const r2 = runCli(["--record-round", empty], tmp);
    assert.equal(r2.status, 2, "empty verdicts must refuse (exit 2)");
    assert.match(r2.stderr, /empty judged record/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
