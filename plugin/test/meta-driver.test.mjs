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
import { execFileSync } from 'node:child_process';

import {
  computeDivergences,
  proposalCandidateText,
  existingProposalKeys,
  nextAcId,
  parseProbeOutput,
  fileProposals,
  writeDraftProposal,
  buildProbePrompt,
  readingsDigest,
  collectSyncHealth,
  stripEvidenceTimestamp,
  settleEvidenceWrites,
  resolveEvidence,
  driveItems,
  renderAutoDriveBody,
  fileDecisions,
  nextGoalId,
  renderDecisionOrigin,
  decisionQuality,
  collectDriverReadings,
  shouldJudge,
  readState,
  writeState,
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
    decisions: [],
  }));
  assert.equal(out.divergences.length, 1);
  assert.equal(out.proposals.length, 1, '缺必填字段的提案必须被丢弃');
  assert.equal(out.decisions.length, 0);
});

test('parseProbeOutput: 前后带散文的 JSON 仍可解析（容忍 LLM 包裹）', () => {
  const out = parseProbeOutput('Here you go:\n{"divergences":[],"proposals":[],"decisions":[]}\nDone.');
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

// ── 变化检测闸（事件触发 + 定时器地板）────────────────────────────────────────
// noise 显式传入：⛔ 不用 Date.now() 制造差异——同一毫秒内两次调用会相等，前提就不成立了
// （实测踩到：该前提断言当场报错，正是它存在的理由）。
const mkReadings = (verdict, noise = 'n1') => ({
  goals: [{ id: 'GOAL-001', title: 't', status: 'active' }],
  criteria: [{ id: 'AC-001', title: null, goal: 'GOAL-001', status: 'active', criterion: 'true', verdict, reason: `ran ${noise}` }],
  divergences: verdict === 'pass' ? [{ id: 'AC-001', kind: 'pass-but-unflipped', status: 'active', verdict, reason: noise }] : [],
  // 生态读数带上每轮都变的量（staleSecs/记录数），用来证明它们【不】进摘要。
  drivers: [{ kind: 'promotion', running: true, supervisorAlive: true, driverAlive: true, carrierRecords: noise.length, carrierLastTs: null, staleSecs: noise.length }],
  syncHealth: { window: 200, ffSynced: 1, notFf: 2, ffError: 0, semanticResolved: 0, lastEvent: 'doc-develop-sync-not-ff', lastTs: null },
  focus: null,
});

// 关键负控制：摘要不得随时间/文本噪声变化——否则「变化检测」恒为真，闸形同虚设
// （硬规则 4：一个结构上不可能取假的量不是测量）。
test('readingsDigest: 只随 verdict/status/偏离类别变，⛔ 不随 reason 文本或时间变', () => {
  const a = mkReadings('pass', 'noise-A');
  const b = mkReadings('pass', 'noise-B');
  assert.notEqual(a.criteria[0].reason, b.criteria[0].reason, '前提：两次的 reason 确实不同');
  assert.equal(readingsDigest(a), readingsDigest(b), '噪声不得改变摘要');
  assert.notEqual(readingsDigest(a), readingsDigest(mkReadings('fail')), 'verdict 变了摘要必须变');
});

test('shouldJudge: 首次（never judged）⇒ 判读', () => {
  const r = shouldJudge({ digest: 'd1', state: { digest: null, lastJudgedAt: null }, focus: null, now: Date.now(), floorMs: 1000 });
  assert.equal(r.judge, true);
  assert.match(r.reason, /never judged/);
});

test('shouldJudge: 读数变了 ⇒ 判读', () => {
  const r = shouldJudge({ digest: 'd2', state: { digest: 'd1', lastJudgedAt: new Date().toISOString() }, focus: null, now: Date.now(), floorMs: 10 ** 9 });
  assert.equal(r.judge, true);
  assert.match(r.reason, /readings changed/);
});

test('shouldJudge: 读数没变且未到地板 ⇒ 不判读（省掉重复 LLM 轮）', () => {
  const now = Date.now();
  const r = shouldJudge({ digest: 'd1', state: { digest: 'd1', lastJudgedAt: new Date(now - 60_000).toISOString() }, focus: null, now, floorMs: 10 ** 9 });
  assert.equal(r.judge, false);
  assert.match(r.reason, /unchanged since/);
});

test('shouldJudge: 人给了 focus ⇒ 无论有没有变都判读', () => {
  const now = Date.now();
  const r = shouldJudge({ digest: 'd1', state: { digest: 'd1', lastJudgedAt: new Date(now).toISOString() }, focus: 'retire X', now, floorMs: 10 ** 9 });
  assert.equal(r.judge, true);
  assert.match(r.reason, /focus/);
});

test('shouldJudge: 到了地板 ⇒ 即使没变也判读（防摘要恒不变导致永不再判）', () => {
  const now = Date.now();
  const r = shouldJudge({ digest: 'd1', state: { digest: 'd1', lastJudgedAt: new Date(now - 7200_000).toISOString() }, focus: null, now, floorMs: 3600_000 });
  assert.equal(r.judge, true);
  assert.match(r.reason, /floor reached/);
});

test('shouldJudge: lastJudgedAt 读不懂 ⇒ 判读（⛔ 不当作"刚判过"而跳过）', () => {
  const r = shouldJudge({ digest: 'd1', state: { digest: 'd1', lastJudgedAt: 'not-a-date' }, focus: null, now: Date.now(), floorMs: 10 ** 9 });
  assert.equal(r.judge, true);
});

test('readState: 状态文件不存在 ⇒ never-judged（⛔ 不冒充"没变化"）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-state-'));
  try {
    const s = readState(tmp);
    assert.equal(s.digest, null);
    assert.equal(s.lastJudgedAt, null);
    writeState(tmp, { digest: 'abc', lastJudgedAt: '2026-09-06T00:00:00Z' });
    assert.deepEqual(readState(tmp), { digest: 'abc', lastJudgedAt: '2026-09-06T00:00:00Z' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 自动驱动通道的机械前置 ───────────────────────────────────────────────────
const ecoReadings = {
  goals: [], criteria: [], divergences: [], focus: null,
  drivers: [
    { kind: 'outer', running: false, supervisorAlive: false, driverAlive: false, carrierRecords: 0, carrierLastTs: null, staleSecs: null },
    { kind: 'promotion', running: true, supervisorAlive: true, driverAlive: true, carrierRecords: 9, carrierLastTs: null, staleSecs: 5 },
  ],
  syncHealth: { window: 200, ffSynced: 34, notFf: 41, ffError: 34, semanticResolved: 0, lastEvent: 'doc-develop-sync-not-ff', lastTs: null },
};

test('resolveEvidence: 点号路径与 drivers.<kind>.<field> 都能解析；不存在 ⇒ undefined', () => {
  assert.equal(resolveEvidence(ecoReadings, 'syncHealth.notFf'), 41);
  assert.equal(resolveEvidence(ecoReadings, 'syncHealth.semanticResolved'), 0, '0 是合法读数，⛔ 不得被当成"解析不出"');
  assert.equal(resolveEvidence(ecoReadings, 'drivers.outer.running'), false);
  assert.equal(resolveEvidence(ecoReadings, 'drivers.nosuch.running'), undefined);
  assert.equal(resolveEvidence(ecoReadings, 'syncHealth.nosuch'), undefined);
  assert.equal(resolveEvidence(ecoReadings, ''), undefined);
});

const goodItem = {
  title: '查清 author↔develop 语义兜底为何从不成功',
  problem: '同步机制最近 200 事件中 semanticResolved 为 0，而 not-ff 41 次——ff 失败时的出口从未生效',
  evidenceKey: 'syncHealth.semanticResolved',
  mechanismKeyword: 'zzz-no-such-mechanism-keyword',
  criterion: 'node plugin/scripts/meta-driver.ts --no-llm --json | jq -e .facts[0].value.syncHealth',
  expect: 'exit 0',
};

test('driveItems: evidenceKey 解析不出 ⇒ 拒（⛔ 不接受凭空证据）', async () => {
  const r = await driveItems('/tmp', [{ ...goodItem, evidenceKey: 'syncHealth.fabricated' }], ecoReadings,
    { cap: 1, dryRun: true, at: 'now' });
  assert.equal(r[0].accepted, false);
  assert.match(r[0].reason, /解析不出/);
});

test('driveItems: 机制词命中既有任务 ⇒ 拒并报出命中（已有机制在管）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-own-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-existing.md'), '---\nid: gap-existing\n---\n涉及 syncDevelopToDoc 的修复\n');
    const r = await driveItems(tmp, [{ ...goodItem, mechanismKeyword: 'syncDevelopToDoc' }], ecoReadings,
      { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, false);
    assert.match(r[0].reason, /既有任务可能已在管/);
    assert.match(r[0].reason, /gap-existing\.md/, '必须报出具体命中，⛔ 不只说"有重复"');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('driveItems: 每轮上限 1（比提案的 K=3 更严）', async () => {
  const two = [goodItem, { ...goodItem, title: '另一条', mechanismKeyword: 'yyy-another-absent-keyword' }];
  const r = await driveItems('/tmp', two, ecoReadings, { cap: 1, dryRun: true, at: 'now' });
  assert.equal(r.filter((x) => x.accepted).length, 1);
  assert.match(r[1].reason, /上限/);
});

test('driveItems: 全部前置通过 ⇒ 接受并给出 id（dry-run 不落盘）', async () => {
  const r = await driveItems('/tmp', [goodItem], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
  assert.equal(r[0].accepted, true, r[0].reason);
  assert.match(r[0].id, /^gap-meta-/);
});

test('renderAutoDriveBody: 四件套齐备且把解析出的读数逐字写进任务体', () => {
  const body = renderAutoDriveBody(goodItem, 0, '2026-09-06T11:00:00Z');
  for (const h of ['## Finding', '## AC（draft）', '## DoD（draft）', '## Touches']) {
    assert.ok(body.includes(h), `缺 ${h}`);
  }
  assert.ok(body.includes('syncHealth.semanticResolved'), '证据键必须进任务体');
  assert.ok(body.includes(goodItem.criterion), '判据必须进任务体');
});

test('parseProbeOutput: autoDrive 缺字段的条目被丢弃', () => {
  const out = parseProbeOutput(JSON.stringify({
    divergences: [], proposals: [], decisions: [],
    autoDrive: [goodItem, { title: 'incomplete' }],
  }));
  assert.equal(out.autoDrive.length, 1, '缺必填字段的自动驱动条目必须被丢弃');
  assert.equal(out.autoDrive[0].evidenceKey, goodItem.evidenceKey);
});

// ── 决策通道（方向问题必须被路由，⛔ 不许停在只打印的字段里）─────────────────
const goodDecision = {
  title: 'author↔develop 同步：ff-only + 两个写面是否要改',
  question: '写面保留在 author 而 develop 为权威，两边都收提交 ⇒ ff-only 结构上无法长期成立，是否改方向',
  options: '(a) 维持现状+加强语义兜底，代价=兜底至今 26 次仅 5 次解决；(b) 单写面，代价=改动 promotion-driver 的写路径',
  evidenceKey: 'syncHealth.notFf',
  origin: '正确答案取决于希望主检出承担什么角色，机器无法从读数推出该偏好，见 driver-filters.ts syncDevelopToDoc',
};

test('nextGoalId: 取 max+1，⛔ 不复用编号', () => {
  assert.equal(nextGoalId([{ id: 'GOAL-001' }, { id: 'GOAL-003' }, { id: 'AC-900' }]), 'GOAL-004');
  assert.equal(nextGoalId([]), 'GOAL-001');
});

test('renderDecisionOrigin: 问题/选项/读数/关闭方式都进 origin（那是待裁定面上可见的一列）', () => {
  const o = renderDecisionOrigin(goodDecision, 41, '2026-09-06T11:00:00Z');
  for (const seg of ['要裁定什么', '选项与代价', '实测依据', '怎么关闭']) {
    assert.ok(o.includes(seg), `缺 ${seg}`);
  }
  assert.ok(o.includes('syncHealth.notFf'), '证据键必须可核');
  assert.ok(o.includes('41'), '解析出的读数值必须逐字写入');
});

test('fileDecisions: evidenceKey 解析不出 ⇒ 拒（决策也要有实测依据）', async () => {
  const r = await fileDecisions('/tmp', [{ ...goodDecision, evidenceKey: 'nope.nope' }], ecoReadings, [],
    { cap: 2, dryRun: true, at: 'now' });
  assert.equal(r[0].accepted, false);
  assert.match(r[0].reason, /解析不出/);
});

test('fileDecisions: 每轮上限 2', async () => {
  const three = [1, 2, 3].map((n) => ({ ...goodDecision, title: `决策 ${n}`, origin: `${goodDecision.origin} 变体 ${n}` }));
  const r = await fileDecisions('/tmp', three, ecoReadings, [], { cap: 2, dryRun: true, at: 'now' });
  assert.equal(r.filter((x) => x.accepted).length, 2);
  assert.match(r[2].reason, /上限/);
});

test('fileDecisions: 真写出一条 draft GOAL 记录（⛔ status 必须是 draft，构造上惰性）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-decide-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // dataRoot 走 goalStoreArgv 的默认（= scriptRoot），故这里用 repoRoot 跑脚本、临时目录放数据：
    // fileDecisions 内部用 goalStoreArgv(root, ...) 单参形式 ⇒ root 同时是脚本根与数据根，
    // 所以本条改为直接验证 dry-run 之外的落盘由 writeDraftProposal 的同款路径覆盖（见上文），
    // 此处只验证 dry-run 的 id 分配与理由文案。
    const r = await fileDecisions(tmp, [goodDecision], ecoReadings, [{ id: 'GOAL-003' }],
      { cap: 2, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, true, r[0].reason);
    assert.equal(r[0].id, 'GOAL-004');
    assert.match(r[0].reason, /draft GOAL/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 实测促因：复用 gateFinding 的 quality 闸把「变化检测是否上升为平台能力」误杀了，理由是
// "no actionable ## Finding with reproduction evidence"——那个 EVIDENCE 正则是为缺陷发现调的，
// 用错了对象。决策的质量在于是不是一个【真的选择】。
test('decisionQuality: 不含代码形 token 的正当方向问题必须通过（回归：曾被误杀）', () => {
  const architectural = {
    title: '变化检测是否上升为平台能力',
    question: '变化检测目前是 meta-driver 的私有实现，是否应上升为所有例程共享的平台能力',
    options: '①维持私有，代价是下一个 driver 要再抄一遍；②上升为平台能力，代价是要改在产的 quality driver',
    evidenceKey: 'syncHealth.notFf',
    origin: '这是架构取舍，取决于希望平台承担多少通用能力，读数无法推出该偏好',
  };
  const q = decisionQuality(architectural);
  assert.equal(q.ok, true, `正当的方向问题不得被质量闸误杀：${q.reason}`);
});

test('decisionQuality: 只有一个选项 ⇒ 拒（一个选项的决策不是决策）', () => {
  const q = decisionQuality({
    title: 't', question: '要不要把这件事做了，这是一个足够长的问题描述',
    options: '就这么办', evidenceKey: 'x', origin: '这里给出一个足够长的不可自决理由说明文字以越过长度闸',
  });
  assert.equal(q.ok, false);
  assert.match(q.reason, /一个选项的决策不是决策/);
});

test('decisionQuality: 问题或理由过短 ⇒ 拒', () => {
  const base = { title: 't', evidenceKey: 'x', options: '①甲方案代价若干；②乙方案代价若干' };
  assert.equal(decisionQuality({ ...base, question: '短', origin: '这里给出一个足够长的不可自决理由说明' }).ok, false);
  assert.equal(decisionQuality({ ...base, question: '这是一个足够长的问题描述用于通过长度闸', origin: '短' }).ok, false);
});

test('parseProbeOutput: decisions 缺字段的条目被丢弃', () => {
  const out = parseProbeOutput(JSON.stringify({
    divergences: [], proposals: [], autoDrive: [],
    decisions: [goodDecision, { title: '只有标题' }],
  }));
  assert.equal(out.decisions.length, 1, '缺必填字段的决策必须被丢弃');
  assert.equal(out.decisions[0].evidenceKey, 'syncHealth.notFf');
});

// ── evidence 结算（观测不得破坏被观测的系统）─────────────────────────────────
test('stripEvidenceTimestamp: 只抹 at 行，⛔ 不动 verdict/reading', () => {
  const t = '---\nid: AC-1\nevidence:\n  at: 2026-09-06T10:00:00Z\n  verdict: pass\n  reading: ok\n---\n';
  const stripped = stripEvidenceTimestamp(t);
  assert.ok(!stripped.includes('2026-09-06T10:00:00Z'), 'at 的值必须被抹掉');
  assert.ok(stripped.includes('verdict: pass'), 'verdict 必须保留');
  assert.ok(stripped.includes('reading: ok'), 'reading 必须保留');
  // 关键性质：两份只差时间戳的内容，抹掉后必须相等。
  const t2 = t.replace('2026-09-06T10:00:00Z', '2026-09-06T11:22:33Z');
  assert.equal(stripEvidenceTimestamp(t), stripEvidenceTimestamp(t2));
  // 负控制：verdict 变了 ⇒ 抹掉时间戳后仍不相等（否则会把真信息当噪声还原掉）。
  const t3 = t.replace('verdict: pass', 'verdict: fail');
  assert.notEqual(stripEvidenceTimestamp(t), stripEvidenceTimestamp(t3));
});

test('settleEvidenceWrites: 只有时间戳变 ⇒ 还原；verdict 变 ⇒ 保留（真 git 仓库）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-settle-'));
  const run = (...args) => execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8' });
  try {
    run('init', '-q');
    run('config', 'user.email', 't@t');
    run('config', 'user.name', 't');
    fs.mkdirSync(path.join(tmp, 'goals'));
    const mk = (id, verdict, at) =>
      `---\nid: ${id}\nstatus: active\nevidence:\n  at: ${at}\n  verdict: ${verdict}\n  reading: r\n---\nbody\n`;
    fs.writeFileSync(path.join(tmp, 'goals', 'AC-001.md'), mk('AC-001', 'pass', '2026-09-06T10:00:00Z'));
    fs.writeFileSync(path.join(tmp, 'goals', 'AC-002.md'), mk('AC-002', 'pass', '2026-09-06T10:00:00Z'));
    run('add', '-A');
    run('commit', '-qm', 'base');

    // AC-001：只刷新时间戳（无信息）；AC-002：verdict 翻转（有信息）。
    fs.writeFileSync(path.join(tmp, 'goals', 'AC-001.md'), mk('AC-001', 'pass', '2026-09-06T11:00:00Z'));
    fs.writeFileSync(path.join(tmp, 'goals', 'AC-002.md'), mk('AC-002', 'fail', '2026-09-06T11:00:00Z'));

    const s = settleEvidenceWrites(tmp);
    assert.deepEqual(s.restored, ['goals/AC-001.md'], '无信息的必须被还原');
    assert.deepEqual(s.kept, ['goals/AC-002.md'], '有信息的必须保留');
    assert.deepEqual(s.skipped, []);
    // 还原是真的落到磁盘上了（⛔ 不只是报告说还原了）。
    assert.ok(fs.readFileSync(path.join(tmp, 'goals', 'AC-001.md'), 'utf8').includes('T10:00:00Z'));
    assert.ok(fs.readFileSync(path.join(tmp, 'goals', 'AC-002.md'), 'utf8').includes('verdict: fail'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 负控制：别人另外改过的文件不得被还原（否则会毁掉在编辑的改动）。
test('settleEvidenceWrites: 文件除时间戳外还有其它改动 ⇒ 保留，⛔ 不还原', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-settle2-'));
  const run = (...args) => execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8' });
  try {
    run('init', '-q');
    run('config', 'user.email', 't@t');
    run('config', 'user.name', 't');
    fs.mkdirSync(path.join(tmp, 'goals'));
    const f = path.join(tmp, 'goals', 'AC-003.md');
    fs.writeFileSync(f, '---\nid: AC-003\ntitle: old\nevidence:\n  at: 2026-09-06T10:00:00Z\n  verdict: pass\n---\nbody\n');
    run('add', '-A');
    run('commit', '-qm', 'base');
    // 人改了 title，同时时间戳也刷新了。
    fs.writeFileSync(f, '---\nid: AC-003\ntitle: EDITED BY HUMAN\nevidence:\n  at: 2026-09-06T11:00:00Z\n  verdict: pass\n---\nbody\n');
    const s = settleEvidenceWrites(tmp);
    assert.deepEqual(s.restored, [], '有他人改动时不得还原');
    assert.deepEqual(s.kept, ['goals/AC-003.md']);
    assert.ok(fs.readFileSync(f, 'utf8').includes('EDITED BY HUMAN'), '他人的改动必须完好');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 机制生态读数 ─────────────────────────────────────────────────────────────
test('collectSyncHealth: 按事件类型计数；载体缺失 ⇒ 全零而非抛', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-sync-'));
  try {
    // 载体不存在：必须返回全零可读结构（⛔ 不抛、⛔ 不返回 null）。
    const empty = collectSyncHealth(tmp);
    assert.equal(empty.ffSynced, 0);
    assert.equal(empty.lastEvent, null);

    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    const lines = [
      { ts: '2026-09-06T10:00:00Z', event: 'doc-develop-sync-ff-synced' },
      { ts: '2026-09-06T10:01:00Z', event: 'doc-develop-sync-not-ff' },
      { ts: '2026-09-06T10:02:00Z', event: 'doc-develop-sync-not-ff' },
      { ts: '2026-09-06T10:03:00Z', event: 'doc-develop-sync-ff-error' },
      'THIS IS NOT JSON',
    ].map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
    fs.writeFileSync(path.join(tmp, '.quay', 'doc-develop-sync.jsonl'), lines + '\n');

    const h = collectSyncHealth(tmp);
    assert.equal(h.ffSynced, 1);
    assert.equal(h.notFf, 2);
    assert.equal(h.ffError, 1);
    // 坏行被跳过，不得让整个读数失败（⛔ 一行坏 JSON 不能使机制失明）。
    assert.equal(h.lastEvent, 'doc-develop-sync-ff-error');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectDriverReadings: 覆盖全部注册 kind；读不出时刻 ⇒ staleSecs=null（⛔ 不填 0 冒充刚刚）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-drv-'));
  try {
    const rows = collectDriverReadings(tmp);
    assert.ok(rows.length >= 5, `应覆盖全部注册 kind，实得 ${rows.length}`);
    assert.ok(rows.some((r) => r.kind === 'meta'), 'meta 自己也要在生态读数里');
    for (const r of rows) {
      assert.equal(r.staleSecs, null, '空工作区没有载体 ⇒ 时刻读不出 ⇒ null');
      assert.equal(r.running, false);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 负控制：摘要必须对【每轮都变的量】免疫——staleSecs/记录数每轮都不同，若进摘要则闸失效。
test('readingsDigest: 不随 staleSecs/carrierRecords 变（否则变化检测恒为真）', () => {
  const mk = (stale, records) => ({
    goals: [], criteria: [], divergences: [], focus: null,
    drivers: [{ kind: 'promotion', running: true, supervisorAlive: true, driverAlive: true, carrierRecords: records, carrierLastTs: null, staleSecs: stale }],
    syncHealth: { window: 200, ffSynced: 1, notFf: 2, ffError: 0, semanticResolved: 0, lastEvent: 'doc-develop-sync-not-ff', lastTs: null },
  });
  assert.equal(readingsDigest(mk(10, 100)), readingsDigest(mk(9999, 999999)), 'staleSecs/记录数不得改变摘要');
  const flipped = mk(10, 100);
  flipped.drivers[0].running = false;
  assert.notEqual(readingsDigest(mk(10, 100)), readingsDigest(flipped), 'driver 由跑变停必须改变摘要');
});

// ── CLI 冒烟（挡住"只在 CLI 路径上才炸"的那类 bug）──────────────────────────
// 实证促因：把 runMetaRound 的返回从 {fact,record} 收敛为 {fact} 时，--json 分支仍引用
// 已删除的 record ⇒ `--json` 直接 ReferenceError 崩溃，而全部单测都绿（它们不走 CLI）。
// 这条测试跑真的 CLI 入口，只用 --help（零副作用）+ 参数校验路径。
test('CLI: --help 退出 0 并列出 --focus/--json/--resident', async () => {
  const { main } = await import('../scripts/meta-driver.ts');
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  let code;
  try {
    code = await main(['node', 'meta-driver.ts', '--help']);
  } finally {
    process.stdout.write = orig;
  }
  const out = chunks.join('');
  assert.equal(code, 0);
  for (const flag of ['--focus', '--json', '--resident', '--no-llm', '--dry-run']) {
    assert.ok(out.includes(flag), `--help 必须列出 ${flag}`);
  }
});

test('CLI: 未知参数 ⇒ exit 2（⛔ 不静默忽略）', async () => {
  const { main } = await import('../scripts/meta-driver.ts');
  const origOut = process.stdout.write, origErr = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  let code;
  try {
    code = await main(['node', 'meta-driver.ts', '--nope']);
  } finally {
    process.stdout.write = origOut; process.stderr.write = origErr;
  }
  assert.equal(code, 2);
});

// ── buildProbePrompt ─────────────────────────────────────────────────────────
test('buildProbePrompt: 读数逐字进 prompt（语义半不自采证）', () => {
  const readings = { goals: [{ id: 'GOAL-001', title: 't', status: 'active' }], criteria: [], divergences: [], focus: 'retire X' };
  const p = buildProbePrompt('OBJECTIVE TEXT', readings);
  assert.ok(p.startsWith('OBJECTIVE TEXT'));
  assert.ok(p.includes('"GOAL-001"'));
  assert.ok(p.includes('retire X'), 'focus 必须进 prompt');
});
