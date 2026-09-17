// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// goal-driver-s10.test.mjs — shard 10, split out of goal-driver-s04 by
// gap-suite-split-15-over-30s-test-files (AC3: every shard of the 15 split files must run <30s;
// s04 was 34.5s). It holds the two self-contained tests whose measured cost dominated s04:
// Shared fixtures: ./helpers/goal-driver-harness.mjs (single source — ⛔ no fixture is re-declared here).

import { test } from "node:test";
import { PRE_CHANGE_ENTRY, assert, fs, hasPrefilingEvidence, os, path, readHostHealth, repoRoot, runGoalRound, spawn, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

test('立案前复核 ④（生产形态端到端）：修复已落地而台账尾尚未轮转 ⇒ 下一轮不再产生 gap 立案', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-recheck-e2e-'));
  const marker = path.join(tmp, 'fix-landed');
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true }); // 空 tasks ⇒ taskFacts=[]（⛔ 不是 null）
    writeStandingGoalFile(tmp, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: `test -f ${marker}` });

    // 第 1 轮：判据为假（marker 不在）⇒ 复核 confirmed-failing ⇒ 立案（既有行为不许被削弱）。
    const r1 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const g1 = new Map(r1.fact.value.gaps.map((g) => [g.ac, g.state]));
    assert.equal(g1.get('AC-900'), 'frozen-violated', '第 1 轮：真为假 ⇒ 照旧立案');
    assert.deepEqual(r1.fact.value.gap_spawns.map((s) => s.ac), ['AC-900'], '第 1 轮：进 spawn 立案路径');
    assert.deepEqual(r1.fact.value.frozenRecheck.entries.map((e) => [e.ac, e.outcome]), [['AC-900', 'confirmed-failing']],
      '第 1 轮：复核读数落进轮记录（产物可查）');

    // 「修复落地」：marker 出现。⛔ 不动判据文本 ⇒ criterionHash 不变 ⇒ 台账尾的那条 fail 仍描述当前判据。
    fs.writeFileSync(marker, '', 'utf8');

    // 第 2 轮：台账尾**仍然**是 fail（轮转 verdict 在 4h 内、且 fail 的再查窗口 10 min 未到）⇒ 缺陷形态
    // 必须仍在读数里，而复核必须把它按下去 ⇒ 不立案。
    const r2 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    assert.deepEqual(r2.fact.value.frozenFailing.failing, ['AC-900'],
      '第 2 轮：台账读数**仍然**说此刻为假（轮转尚未轮到它）——这正是缺陷的输入，⛔ 不是被修好了');
    const g2 = new Map(r2.fact.value.gaps.map((g) => [g.ac, g.state]));
    assert.notEqual(g2.get('AC-900'), 'frozen-violated', '第 2 轮：复核 cleared ⇒ 不产 frozen-violated');
    assert.equal(g2.get('AC-900'), undefined, '第 2 轮：也不产任何读数（此刻确无工作可立）');
    assert.deepEqual(r2.fact.value.gap_spawns.map((s) => s.ac), [], '第 2 轮：不 spawn（不烧 spawn 名额，也不给下游指一个不存在的缺陷）');
    assert.deepEqual(r2.fact.value.frozenRecheck.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-900', 'cleared', 'now-true']],
      '第 2 轮：复核读数「cleared/now-true」落进轮记录（这就是「修复已落地」的直接量证据）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC2：轮记录里出现立案前复核读数（含宿主健康量）；负控制 = 改动前的真实旧对象上谓词为假', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-standing-recheck-ac2-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1', longTerm: true });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const v = fact.value;
    assert.equal(v.standingRecheck.entries.length, 1, '本轮有一条复核读数（AC-001 命中 I5）');
    const e = v.standingRecheck.entries[0];
    assert.ok(hasPrefilingEvidence(e), `复核读数带齐 {ac,outcome,verdict,durationMs,hostFreeBytes|load1}，实测键=${Object.keys(e).join(',')}`);
    assert.equal(e.ac, 'AC-001');
    assert.equal(e.outcome, 'confirmed-failing');
    assert.equal(e.verdict, 'fail');
    assert.ok(typeof e.durationMs === 'number' && e.durationMs >= 0, 'durationMs 实测（⛔ 不是占位常量）');
    // 宿主健康量必须是**当时**的读数：与此刻独立重读一次同量级（⛔ 不与 0 同形、⛔ 不是写死的字面量）。
    const now = readHostHealth();
    if (now.hostFreeBytes !== null && e.hostFreeBytes !== null) {
      assert.ok(e.hostFreeBytes > 0, 'hostFreeBytes > 0（⛔ 0 = 盘满，null = 没读到，两者与「盘不紧张」不同形）');
      assert.ok(e.hostFreeBytes <= now.hostFreeBytes * 4, `复核那一刻的可用字节应与此刻同量级（读数=${e.hostFreeBytes} 此刻=${now.hostFreeBytes}）`);
    }

    // ⛔ 负控制：同一个谓词在**改动前的真实读数**上必须为假 —— 否则本判据只是「字段存在」的自证。
    assert.equal(hasPrefilingEvidence(PRE_CHANGE_ENTRY), false,
      '负控制：改动前的真实读数不含 verdict/durationMs/宿主量 ⇒ 新旧可区分（⛔ 不靠「字段存在」自证）');
    assert.ok(!('durationMs' in PRE_CHANGE_ENTRY) && !('hostFreeBytes' in PRE_CHANGE_ENTRY),
      '负控制的成因可核：旧对象缺的正是「这次跑在什么环境下」那一半');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
