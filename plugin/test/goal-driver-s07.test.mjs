// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver-s03.test.mjs by gap-suite-split-15-over-30s-test-files — new shard 7 (2 tests): the 关闭闸 closeBlocks pair (blocked-failing-ac 与 clear, 两条互为对照). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { assert, fs, os, path, repoRoot, runGoalRound, spawnSync, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

test('real ring: GOAL 名下 achieved AC 尾事件 fail ⇒ 关闭被拒（closeBlocks 落痕 + flips ok:false），声明 long-term 后恢复可关闭', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-closeblock-'));
  const sufficiencyCmd = ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'];
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // GOAL-001：有退出条件（机械可证部分判 not-evaluated ⇒ 走语义判定 seam ⇒ covered），
    // AC-001 已经是 achieved 而 criterion 恒假 ⇒ 每轮 gate 都往台账写一条 fail 尾事件。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    fs.writeFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'),
      ['---', 'id: GOAL-001', 'title: t', 'status: active', 'kind: goal',
       'origin: test fixture', '---', '', '## 退出条件', '', '1. 条件一', ''].join('\n'), 'utf8');
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });

    const r1 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'], sufficiencyCmd });
    const b1 = r1.fact.value.closeBlocks.find((b) => b.goal === 'GOAL-001');
    assert.ok(b1, 'closeBlocks 含 GOAL-001 一条（⛔ 不是缺席）');
    assert.equal(b1.verdict, 'blocked-failing-ac', 'achieved+尾fail+未声明 long-term ⇒ 关闭被拒');
    assert.deepEqual(b1.acs, ['AC-001'], '被点名的 AC 枚举在 closeBlocks.acs（⛔ 不布尔）');
    assert.equal(b1.cause, null, 'blocked-failing-ac 的 cause 恒 null（与 not-evaluated 不同形）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8'), /^status: active$/m,
      'GOAL 未被关闭（仍在 active）');
    const refused = r1.fact.value.flips.find((f) => f.id === 'GOAL-001' && f.to === 'achieved');
    assert.ok(refused && refused.ok === false, 'flip 记录里有一条 ok:false 的关闭尝试（区别于静默不关）');
    assert.match(refused.reason, /^blocked-failing-ac: AC-001$/, '拒绝理由带独立成因取值与 AC 清单');
    assert.notEqual(r1.sufficiencyFacts[0].value.sufficiency.verdict, 'insufficient',
      '负控制：被拒不是因充分性不足（否则测的是另一条闸）');

    // 逃生口（臂③）：给 AC-001 声明 long-term ⇒ 恢复可关闭。经 goal-store write（机件路径）。
    const w = spawnSync('node', ['--experimental-strip-types', path.join(repoRoot, 'packages/quay/src/goal-store.ts'),
      'write', 'AC-001', '--long-term', 'true', '--root', tmp], { encoding: 'utf8' });
    assert.equal(w.status, 0, 'goal-store write --long-term true 成功:\n' + w.stdout + w.stderr);
    const r2 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'], sufficiencyCmd });
    assert.equal(r2.fact.value.closeBlocks.find((b) => b.goal === 'GOAL-001').verdict, 'clear',
      '声明 long-term ⇒ 恢复 clear（逃生口有效）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8'), /^status: achieved$/m,
      '逃生口打开后 GOAL 确实被关闭');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('real ring: 无 achieved 红 AC 时 closeBlocks 恒有该 GOAL 一条且 verdict=clear（字段存在性，⛔ 不是缺席）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-closeblock-clear-'));
  const sufficiencyCmd = ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'];
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    fs.writeFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'),
      ['---', 'id: GOAL-001', 'title: t', 'status: active', 'kind: goal',
       'origin: test fixture', '---', '', '## 退出条件', '', '1. 条件一', ''].join('\n'), 'utf8');
    // AC 仍 active（判据 true ⇒ 本轮 I2 翻 achieved，尾事件是 pass）⇒ 不阻塞。
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'], sufficiencyCmd });
    const blocks = fact.value.closeBlocks;
    assert.ok(Array.isArray(blocks), 'closeBlocks 是数组（字段存在 ⇒ 「查过且零条」与「未跑该判定」可分）');
    assert.equal(blocks.length, 1, '一条 active GOAL ⇒ 一条 closeBlock');
    assert.deepEqual(blocks[0], { goal: 'GOAL-001', verdict: 'clear', acs: [], cause: null },
      '无 achieved 红 AC ⇒ clear（本条与上一条的 blocked 对照，证明谓词能取假）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8'), /^status: achieved$/m,
      '对照：clear ⇒ GOAL 正常关闭');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
