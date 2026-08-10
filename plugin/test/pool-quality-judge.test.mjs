// @test-group governance
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

// ── DOC-CONTRACT wiring (AC2/AC3: 执行核有「调用 workflow」的编号步骤,判词含 should-remove) ─────

test("AC2 — the workflow file carries the four verdicts incl. should-remove (the proof-once-then-lost fix)", () => {
  const wf = path.join(REPO_ROOT, ".claude", "workflows", "pool-quality-judge.js");
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
