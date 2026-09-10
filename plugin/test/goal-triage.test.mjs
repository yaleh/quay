// @test-group engine
// goal-triage.test.mjs — GOAL-010 范围② / AC-210 (tasks/gap-goal-driver-draft-ac-triage):
// draft AC 分诊——active GOAL 名下每条 draft AC 出四态判决之一（activate / re-anchor /
// needs-human / hold）并逐条落痕到轮记录 value.triage。retire 已按 AC-219 移除——
// 「无任务牵引」≠「死信」，刚提案的 draft AC 无牵引分诊为 activate 而非 retire→needs-human。
//
// 覆盖四件事：①四态词表（decision ∈ 四态，且四态各至少一条输入可达——AC2）；②纯函数
// triageDraftAc 的判决语义（goal 锚 / criterion / posture / 无牵引——AC2/AC3；牵引不再是激活判据）；
// ③真实机械环端到端（active GOAL 名下 draft AC 跑一轮后轮记录 facts[].value.triage[] 逐条含该
// AC——AC1，⛔ 不注入 seam，跑真的 goal-store CLI）；④无 draft AC 时 triage 为 [] 且字段仍在
// （与「未跑分诊」按字段存在性区分，硬规则 3b）；⑤AC-210 判据（python 一行）的双向控制
// （无 triage 载体 ⇒ 非零退出——AC5 负控制；有 triage 载体 ⇒ 退出 0——AC4 判据逻辑）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-triage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  triageDraftAc,
  TRIAGE_DECISIONS,
  runGoalRound,
  goalDriverRoutines,
  GOAL_ROUND_REL,
} from '../scripts/goal-driver.ts';
import { runResidentQualityGateLoop } from '../scripts/quality-gate-driver.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

// ── AC2 四态词表 + 纯函数判决语义 ─────────────────────────────────────────────────────────

test('AC2 四态词表：四态各至少一条输入可达（decision ∈ 四态，四态两两不等）', () => {
  assert.equal(new Set(TRIAGE_DECISIONS).size, 4, '四态词表恰好四态、无重复');
  const traction = [{ id: 't', status: 'todo', goalAc: 'AC-900' }];
  const seen = new Set();

  // activate（无牵引）：goal 锚合法 + criterion 非空 + 无 posture ⇒ 建议激活进入判定
  // （gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics：牵引不再是激活判据）。
  seen.add(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, null, null).decision);
  seen.add(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, null, []).decision);
  // re-anchor：goal 锚缺失 / 非法（非 GOAL-NNN）。
  seen.add(triageDraftAc({ id: 'AC-900', goal: '', criterion: 'true' }, null, traction).decision);
  seen.add(triageDraftAc({ id: 'AC-900', goal: 'PHASE-001', criterion: 'true' }, null, traction).decision);
  // needs-human：criterion 缺失/空。
  seen.add(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: '' }, null, traction).decision);
  seen.add(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009' }, null, traction).decision);
  // hold（posture）：goal 声明 posture（AC-215 的读取端本任务只收不读；非空即按住）。
  seen.add(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, 'measure-only', traction).decision);

  assert.deepEqual([...seen].sort(), [...TRIAGE_DECISIONS].sort(), '四态各至少一条输入可达');
});

test('AC2 判决语义：posture 挡住 activate 落在 hold（⛔ 不判 activate）', () => {
  const traction = [{ id: 't', status: 'todo', goalAc: 'AC-900' }];
  // 有牵引但 posture 声明 ⇒ hold（不因牵引而 activate）。
  assert.equal(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, 'measure-only', traction).decision, 'hold');
  // 无牵引但 posture 声明 ⇒ hold（不因无牵引而变态）。
  assert.equal(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, 'measure-only', []).decision, 'hold');
});

test('AC1：结构完备 + 无任务牵引 ⇒ 判 activate（⛔ 不再 hold——激活判据是「判据就绪」而非「有牵引」）', () => {
  const wellFormed = { id: 'AC-900', goal: 'GOAL-009', criterion: 'true' };
  assert.equal(triageDraftAc(wellFormed, null, null).decision, 'activate', 'taskFacts=null（无牵引）⇒ activate');
  assert.equal(triageDraftAc(wellFormed, null, []).decision, 'activate', 'taskFacts=[]（无牵引）⇒ activate');
});

// ── AC3 逐条落痕（纯函数面：ac 唯一、非空，decision 非空）────────────────────────────────

test('AC3 逐条落痕：每条 triage 带非空 ac + 非空 decision + 非空 reason', () => {
  const records = [
    { id: 'AC-900', goal: 'GOAL-009', criterion: 'true' },
    { id: 'AC-901', goal: 'GOAL-009', criterion: '' },
    { id: 'AC-902', goal: '', criterion: 'true' },
  ];
  for (const r of records) {
    const t = triageDraftAc(r, null, null);
    assert.ok(typeof t.ac === 'string' && t.ac.length > 0, `ac 非空: ${t.ac}`);
    assert.ok(TRIAGE_DECISIONS.includes(t.decision), `decision ∈ 四态: ${t.decision}`);
    assert.ok(typeof t.reason === 'string' && t.reason.length > 0, `reason 非空: ${t.reason}`);
  }
});

// ── AC1 真实机械环端到端（⛔ 不注入 seam，跑真 goal-store CLI）───────────────────────────

test('AC1 对象集扩展：active GOAL 名下 draft AC 跑一轮后轮记录 facts[].value.triage[] 逐条含该 AC', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-triage-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // active GOAL-009 名下两条 draft AC（分诊对象集 = draft；criterion `true` 可评估）。
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-900', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });
    writeGoalFile(tmp, { id: 'AC-901', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });
    // 负控制：active AC 不进入 triage 对象集（triage 只数 draft）。
    writeGoalFile(tmp, { id: 'AC-902', status: 'active', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });

    const roundLog = path.join(tmp, GOAL_ROUND_REL);
    const code = await runResidentQualityGateLoop({
      root: tmp,
      intervalMs: 1,
      once: true,
      maxRounds: null,
      roundLogFile: roundLog,
      runId: 't',
      json: false,
      routines: goalDriverRoutines(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] }),
    });
    assert.equal(code, 0, 'resident loop 一轮应正常退出');

    const lines = fs.readFileSync(roundLog, 'utf8').trim().split('\n');
    const rec = JSON.parse(lines[lines.length - 1]);
    const goalFact = rec.facts.find((f) => f.name === 'goal-ring');
    assert.ok(goalFact, '轮记录含 goal-ring fact');
    const triage = goalFact.value.triage;
    assert.ok(Array.isArray(triage), 'value.triage 是数组');
    const acs = triage.map((t) => t.ac).sort();
    assert.deepEqual(acs, ['AC-900', 'AC-901'], '逐条含 draft AC（active AC 不入 triage 对象集）');
    for (const t of triage) {
      assert.ok(TRIAGE_DECISIONS.includes(t.decision), `decision ∈ 四态: ${t.decision}`);
      assert.ok(typeof t.reason === 'string' && t.reason.length > 0, `reason 非空: ${t.reason}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 硬规则 3b：无 draft AC ⇒ triage 为 []，且字段仍在（与「未跑分诊」按字段存在性区分）──────

test('无 draft AC ⇒ value.triage 为 []（字段仍在——「查过且零条」与「未跑分诊」不同形，硬规则 3b）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-triage-empty-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // active GOAL-009 名下只有 active AC（无 draft AC）。
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-902', status: 'active', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const v = fact.value;
    assert.ok('triage' in v, 'value 必须含 triage 键（与「字段缺失」不同形，硬规则 3b）');
    assert.ok(Array.isArray(v.triage), 'value.triage 是数组');
    assert.equal(v.triage.length, 0, '无 draft AC ⇒ 空数组');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC-210 判据（python 一行）双向控制：AC5 负控制 + AC4 判据逻辑 ────────────────────────

// AC-210 判据的 python 代码（= `python3 -c '<code>'` 的 <code>，逐字取自 goals/AC-210-*.md 的 criterion）。
const AC210_CRITERION_CODE = `import json,sys; ok=[t for l in open(".quay/goal-round.jsonl") for f in (json.loads(l).get("facts") or []) for t in ((f.get("value") or {}).get("triage") or []) if t.get("ac") and t.get("decision") in ("activate","re-anchor","retire","needs-human","hold")]; sys.exit(0 if len(ok)>=1 else 1)`;

test('AC5 负控制 + AC4 判据逻辑：无 triage 载体 ⇒ 非零退出；有 triage 载体 ⇒ 退出 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-triage-crit-'));
  try {
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    const carrier = path.join(tmp, '.quay', 'goal-round.jsonl');

    // 负控制（AC5）：载体无 triage（facts[].value 无 triage 键）⇒ 判据退出非 0（⛔ 非恒真）。
    fs.writeFileSync(carrier, JSON.stringify({ facts: [{ name: 'goal-ring', value: { goalCount: 1 }, state: 'verified' }] }) + '\n', 'utf8');
    let r = spawnSync('python3', ['-c', AC210_CRITERION_CODE], { cwd: tmp, encoding: 'utf8' });
    assert.notEqual(r.status, 0, `无 triage 载体 ⇒ 判据非零退出（AC5 负控制）:\n${r.stdout}${r.stderr}`);

    // 正控制（AC4 判据逻辑）：载体含 ≥1 条 triage（带 ac + 五态 decision 之一）⇒ 退出 0。
    fs.writeFileSync(carrier, JSON.stringify({
      facts: [{ name: 'goal-ring', value: { triage: [{ ac: 'AC-900', decision: 'hold', reason: 'r' }] }, state: 'verified' }],
    }) + '\n', 'utf8');
    r = spawnSync('python3', ['-c', AC210_CRITERION_CODE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `有 triage 载体 ⇒ 判据退出 0（AC4 判据逻辑）:\n${r.stdout}${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
