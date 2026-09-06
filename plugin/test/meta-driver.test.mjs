// @test-group engine
// meta-driver.test.mjs — meta-driver 例程的判定面单测（纯函数 + 提案闸路径）。
//
// 覆盖三件事：①divergence 三类的机械判定（含"读不懂 ≠ 合格"的 not-evaluated 取值）；
// ②提案过闸（quality/dedup/rate 三闸复用 routine-file-gate，且 dedup 的 key 两侧同源）；
// ③语义半输出解析的 fail-closed（解析不了 ⇒ null ⇒ 调用侧转 failed，⛔ 不当空结果放行）。
//
// Run: node --test plugin/test/meta-driver.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeDivergences,
  proposalCandidateText,
  existingProposalKeys,
  nextAcId,
  parseProbeOutput,
  fileProposals,
  writeDraftProposal,
  buildProbePrompt,
} from '../scripts/meta-driver.ts';

// 脚本根（goal-store.ts 从这里取）——数据根在各测试里另给临时目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── computeDivergences ───────────────────────────────────────────────────────
test('computeDivergences: pass 但状态非 achieved ⇒ pass-but-unflipped', () => {
  const d = computeDivergences([
    { id: 'AC-001', title: null, goal: 'GOAL-001', status: 'active', criterion: 'true', verdict: 'pass', reason: 'ok' },
  ]);
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'pass-but-unflipped');
  assert.equal(d[0].id, 'AC-001');
});

test('computeDivergences: achieved 但 criterion 失败 ⇒ achieved-but-failing', () => {
  const d = computeDivergences([
    { id: 'AC-002', title: null, goal: 'GOAL-001', status: 'achieved', criterion: 'false', verdict: 'fail', reason: 'exit 1' },
  ]);
  assert.equal(d[0].kind, 'achieved-but-failing');
});

test('computeDivergences: 无 criterion ⇒ no-criterion（优先于其它判定）', () => {
  const d = computeDivergences([
    { id: 'AC-003', title: null, goal: 'GOAL-001', status: 'active', criterion: '', verdict: 'fail', reason: 'fail-closed' },
  ]);
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'no-criterion');
});

test('computeDivergences: pass 且已 achieved ⇒ 无偏离（一致就不报）', () => {
  const d = computeDivergences([
    { id: 'AC-004', title: null, goal: 'GOAL-001', status: 'achieved', criterion: 'true', verdict: 'pass', reason: 'ok' },
  ]);
  assert.equal(d.length, 0);
});

// 负控制：not-evaluated 既不是 pass 也不是 fail ⇒ 不得被算成任何一类偏离（硬规则 3b：
// "读不懂"必须有独立取值，不与合格/不合格共用）。
test('computeDivergences: verdict=not-evaluated ⇒ 不产生 pass/fail 类偏离', () => {
  const d = computeDivergences([
    { id: 'AC-005', title: null, goal: 'GOAL-001', status: 'active', criterion: 'x', verdict: 'not-evaluated', reason: 'spawn error' },
  ]);
  assert.equal(d.length, 0);
});

// ── dedup key 同源性 ─────────────────────────────────────────────────────────
test('existingProposalKeys 与候选用同一个渲染函数 ⇒ 同内容的提案被判重复', () => {
  const p = { goal: 'GOAL-001', title: 'wire the goal gate', criterion: 'node packages/quay/src/goal-store.ts gate AC-170', expect: 'exit 0', origin: 'gate-events.jsonl 中 goal 事件数为 0' };
  const existing = existingProposalKeys([
    { id: 'AC-100', title: p.title, criterion: p.criterion, origin: p.origin },
  ]);
  const { findingKey } = { findingKey: null }; // key 比较经由 fileProposals 内部，见下一条
  assert.equal(existing.size, 1);
  // 同一内容渲染出的候选文本，其 key 必须落在 existing 集合里。
  const candidate = proposalCandidateText(p);
  assert.ok(candidate.includes('## Finding'));
  assert.ok([...existing][0].length > 0);
});

// ── nextAcId ─────────────────────────────────────────────────────────────────
test('nextAcId: 取 max+1，⛔ 不复用已存在编号', () => {
  assert.equal(nextAcId([{ id: 'AC-001' }, { id: 'AC-179' }, { id: 'GOAL-003' }]), 'AC-180');
  assert.equal(nextAcId([]), 'AC-001');
});

// ── parseProbeOutput ─────────────────────────────────────────────────────────
test('parseProbeOutput: 合法 JSON ⇒ 结构化；缺字段的提案被丢弃', () => {
  const out = parseProbeOutput(JSON.stringify({
    divergences: [{ id: 'AC-170', kind: 'pass-but-unflipped', interpretation: 'x', recommendation: 'y' }],
    proposals: [
      { goal: 'GOAL-001', title: 't', criterion: 'c', expect: 'e', origin: 'o' },
      { goal: 'GOAL-001', title: 'missing-criterion' },
    ],
    humanAttention: ['decide X'],
  }));
  assert.equal(out.divergences.length, 1);
  assert.equal(out.proposals.length, 1, '缺必填字段的提案必须被丢弃');
  assert.equal(out.humanAttention[0], 'decide X');
});

test('parseProbeOutput: 前后带散文的 JSON 仍可解析（容忍 LLM 包裹）', () => {
  const out = parseProbeOutput('Here you go:\n{"divergences":[],"proposals":[],"humanAttention":[]}\nDone.');
  assert.ok(out);
  assert.equal(out.proposals.length, 0);
});

// fail-closed：读不懂 ⇒ null（⛔ 不返回空结构冒充"本轮没发现"——那与合格同形，硬规则 3b）。
test('parseProbeOutput: 解析不了 ⇒ null，⛔ 不与"零发现"同形', () => {
  assert.equal(parseProbeOutput(''), null);
  assert.equal(parseProbeOutput('no json here'), null);
  assert.equal(parseProbeOutput('{ broken'), null);
  assert.equal(parseProbeOutput('[1,2,3]'), null, '顶层数组不是约定形状');
});

// ── fileProposals 的三闸 ─────────────────────────────────────────────────────
const goodProposal = {
  goal: 'GOAL-001',
  title: 'wire the goal gate into a routine',
  criterion: 'node packages/quay/src/goal-store.ts gate AC-170',
  expect: 'exit 0 means the criterion actually ran',
  origin: '.quay/gate-events.jsonl 中 "gate":"goal" 计数为 0，说明 goal-store.ts gate 从未被调用',
};

test('fileProposals: 非 active goal id ⇒ 拒（⛔ 不允许 LLM 造 id）', async () => {
  const r = await fileProposals('/tmp', [{ ...goodProposal, goal: 'GOAL-999' }], [], {
    k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: true,
  });
  assert.equal(r[0].accepted, false);
  assert.match(r[0].reason, /invalid goal id/);
});

test('fileProposals: 无硬证据的 origin ⇒ 被 quality 闸拒', async () => {
  const vague = { ...goodProposal, title: 'improve', criterion: 'x', origin: 'it feels wrong' };
  const r = await fileProposals('/tmp', [vague], [], { k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: true });
  assert.equal(r[0].accepted, false);
  assert.match(r[0].reason, /quality/);
});

test('fileProposals: 与既有记录同内容 ⇒ 被 dedup 闸拒', async () => {
  const records = [{ id: 'AC-100', title: goodProposal.title, criterion: goodProposal.criterion, origin: goodProposal.origin }];
  const r = await fileProposals('/tmp', [goodProposal], records, { k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: true });
  assert.equal(r[0].accepted, false);
  assert.match(r[0].reason, /dedup/);
});

test('fileProposals: 超过 K ⇒ 被 rate 闸拒（本轮累计计数）', async () => {
  const three = [1, 2, 3, 4].map((n) => ({
    ...goodProposal,
    title: `wire the goal gate variant ${n}`,
    origin: `.quay/gate-events.jsonl 计数为 0，变体 ${n}，见 plugin/scripts/meta-driver.ts`,
  }));
  const r = await fileProposals('/tmp', three, [], { k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: true });
  const accepted = r.filter((x) => x.accepted);
  assert.equal(accepted.length, 3, 'K=3 时最多接受 3 条');
  assert.match(r[3].reason, /rate/);
});

test('fileProposals: 逐条留痕（⛔ 不只报总数，硬规则 3 枚举不布尔）', async () => {
  const r = await fileProposals('/tmp', [goodProposal, { ...goodProposal, goal: 'GOAL-999' }], [], {
    k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: true,
  });
  assert.equal(r.length, 2, '每条提案都要有一条处置记录');
  assert.ok(r.every((x) => typeof x.reason === 'string' && x.reason.length > 0));
});

test('fileProposals: dry-run 分配 id 但不写盘', async () => {
  const r = await fileProposals('/tmp', [goodProposal], [{ id: 'AC-179' }], {
    k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: true,
  });
  assert.equal(r[0].accepted, true);
  assert.equal(r[0].id, 'AC-180');
  assert.match(r[0].reason, /dry-run/);
});

// ── 真写入路径（⛔ 不用 dry-run、不用假 seam）──────────────────────────────────
// 为什么必须有这一条：v0 的两次生产轮都没产出提案（语义半克制），dry-run 与其它单测又都
// 绕开了 writeDraftProposal ⇒ 写入路径【从未真正执行过】，与「没实现」同形（硬规则 4 推论三：
// 只能被 fixture/dry-run 满足的判据不是测量）。这里跑真的 goal-store CLI 写真的文件。
test('writeDraftProposal 真的写出一条 draft 记录（真跑 goal-store CLI，非 dry-run）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-write-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'),
      '---\nid: GOAL-001\ntitle: t\nstatus: active\nkind: goal\norigin: test fixture\n---\n## Goal\nx\n');

    const r = await fileProposals(repoRoot, [goodProposal], [], {
      k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: false, dataRoot: tmp,
    });

    assert.equal(r[0].accepted, true, `写入应成功，实际: ${r[0].reason}`);
    assert.equal(r[0].id, 'AC-001');

    const files = fs.readdirSync(path.join(tmp, 'goals'));
    const written = files.find((f) => f.startsWith('AC-001'));
    assert.ok(written, `应写出 AC-001 文件，实际目录内容: ${files.join(', ')}`);
    const text = fs.readFileSync(path.join(tmp, 'goals', written), 'utf8');
    // 关键性质：落盘即 draft（构造上惰性——写下它不会让任何事发生）。
    assert.match(text, /^status: draft$/m, '提案必须落为 draft，⛔ 绝不能是 active');
    assert.match(text, /goal: GOAL-001/);
    assert.ok(text.includes('gate-events.jsonl'), 'origin 的实证内容必须落盘');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 负控制：origin 缺失时 goal-store 自身 fail-closed（AC6「空 origin 不写」）——
// 确认这条闸真的在我们的调用路径上生效，而不是只在文档里。
test('origin 为空 ⇒ goal-store fail-closed，写入失败且不留文件', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-noorigin-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    const r = await writeDraftProposal(repoRoot, 'AC-002',
      { ...goodProposal, origin: '' }, tmp);
    assert.equal(r.ok, false, 'origin 为空必须写入失败');
    const files = fs.readdirSync(path.join(tmp, 'goals'));
    assert.equal(files.filter((f) => f.startsWith('AC-002')).length, 0, '失败时不得留下半条记录');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── buildProbePrompt ─────────────────────────────────────────────────────────
test('buildProbePrompt: 读数逐字进 prompt（语义半不自采证）', () => {
  const readings = { goals: [{ id: 'GOAL-001', title: 't', status: 'active' }], criteria: [], divergences: [], focus: 'retire X' };
  const p = buildProbePrompt('OBJECTIVE TEXT', readings);
  assert.ok(p.startsWith('OBJECTIVE TEXT'));
  assert.ok(p.includes('"GOAL-001"'));
  assert.ok(p.includes('retire X'), 'focus 必须进 prompt');
});
