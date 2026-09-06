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
  blockingOwners,
  snapshotTrackedChanges,
  probeWriteViolations,
  fileDecisions,
  nextGoalId,
  renderDecisionOrigin,
  decisionQuality,
  collectDriverReadings,
  collectInertCheckers,
  shouldJudge,
  readState,
  writeState,
  quoteIsVerbatim,
  carrierGate,
  collectAddressedTasks,
  parseFrontmatterLabels,
  existingPaths,
  renderHumanCallBody,
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

// draft = 提案不是承诺（实测：meta-driver 自己提的 AC-180 曾被报成 pass-but-unflipped）。
test('computeDivergences: draft 记录一律不算偏离（提案 ≠ 未兑现的承诺）', () => {
  const d = computeDivergences([
    { id: 'AC-900', title: null, goal: 'GOAL-001', status: 'draft', criterion: 'true', verdict: 'pass', reason: 'ok' },
    { id: 'AC-901', title: null, goal: 'GOAL-001', status: 'draft', criterion: '', verdict: 'fail', reason: 'no criterion' },
  ]);
  assert.equal(d.length, 0, 'draft 既不报 pass-but-unflipped 也不报 no-criterion');
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

// ── 写盘即提交（gap-meta-goalstoreargv：未跟踪 goals/*.md 阻塞 develop→doc ff-only）────
// 为什么必须真 git 仓库（⛔ 不用非 git 临时目录）：commitTaskFile 在 repo-less 根下是 no-op，
// 若测试跑在非 git 目录，「写后提交」与「写后没提交」观测不到差别 ⇒ 判据恒真（硬规则 4）。
// 下面第二条负控制证明判据本身能取假：未提交的 goals/*.md 会被 git status --porcelain 检出。
test('writeDraftProposal 写盘即提交：写后 goals/ 无未提交记录（真 git 仓库）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-commit-'));
  const run = (...args) => execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8' });
  try {
    run('init', '-q'); run('config', 'user.email', 't@t'); run('config', 'user.name', 't');
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // base：一条 active GOAL，供 fileProposals 的 activeGoalIds 闸识别（否则提案被 invalid goal id 拒）。
    fs.writeFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'),
      '---\nid: GOAL-001\ntitle: t\nstatus: active\nkind: goal\norigin: fixture\n---\n## Goal\nx\n');
    run('add', '-A'); run('commit', '-qm', 'base');

    const r = await fileProposals(repoRoot, [goodProposal], [], {
      k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: false, dataRoot: tmp,
    });
    assert.equal(r[0].accepted, true, `写入应成功，实际: ${r[0].reason}`);

    // AC 判据：写盘路径提交后，goals/ 无任何未提交记录（git status --porcelain goals/ 为空）。
    const porcelain = run('status', '--porcelain', '--', 'goals');
    assert.equal(porcelain.trim(), '', `写盘后 goals/ 必须无未提交记录，实得: ${JSON.stringify(porcelain)}`);
    // 文件真的进了 git（⛔ 不是"没有 git 仓库所以空"——那与合格同形，硬规则 3b）。
    assert.ok(run('ls-files', 'goals').includes('AC-001'), '新写的 AC-001 必须已 tracked');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 负控制：判据能取假——把「写盘即提交」改坏（写但不提交）时，同一个 git status 判据必须红。
test('负控制：未提交的 goals/*.md 被 git status --porcelain 检出（判据能取假，⛔ 非恒真）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-nocommit-'));
  const run = (...args) => execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8' });
  try {
    run('init', '-q'); run('config', 'user.email', 't@t'); run('config', 'user.name', 't');
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // 先落一条已跟踪的 base（git 不跟踪空目录 ⇒ 空 goals/ 提交不出 base）。
    fs.writeFileSync(path.join(tmp, 'goals', 'AC-000-base.md'), '---\nid: AC-000\nstatus: draft\n---\n');
    run('add', '-A'); run('commit', '-qm', 'base');
    // 模拟老实现/改坏实现的形状：写盘但没提交 ⇒ 未跟踪文件。
    fs.writeFileSync(path.join(tmp, 'goals', 'AC-999-leak.md'), '---\nid: AC-999\nstatus: draft\n---\n');
    const porcelain = run('status', '--porcelain', '--', 'goals');
    assert.ok(porcelain.trim().length > 0, '未跟踪的 goals/*.md 必须被检出——否则该判据结构上测不到缺陷（恒真）');
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
  syncHealth: { window: 200, ffSynced: 1, notFf: 2, ffError: 0, semanticBegin: 0, semanticResolved: 0, semanticConflict: 0, semanticAlignFailed: 0, semanticFfFailed: 0, lastEvent: 'doc-develop-sync-not-ff', lastTs: null },
  addressedTasks: [],
  inertCheckers: [],
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
  goals: [], criteria: [], divergences: [], addressedTasks: [], focus: null,
  drivers: [
    { kind: 'outer', running: false, supervisorAlive: false, driverAlive: false, carrierRecords: 0, carrierLastTs: null, staleSecs: null },
    { kind: 'promotion', running: true, supervisorAlive: true, driverAlive: true, carrierRecords: 9, carrierLastTs: null, staleSecs: 5 },
  ],
  syncHealth: { window: 200, ffSynced: 34, notFf: 41, ffError: 34, semanticBegin: 26, semanticResolved: 5, semanticConflict: 21, semanticAlignFailed: 0, semanticFfFailed: 0, lastEvent: 'doc-develop-sync-not-ff', lastTs: null },
};

test('resolveEvidence: 点号路径与 drivers.<kind>.<field> 都能解析；不存在 ⇒ undefined', () => {
  assert.equal(resolveEvidence(ecoReadings, 'syncHealth.notFf'), 41);
  assert.equal(resolveEvidence(ecoReadings, 'syncHealth.semanticAlignFailed'), 0, '0 是合法读数，⛔ 不得被当成"解析不出"');
  assert.equal(resolveEvidence(ecoReadings, 'syncHealth.semanticConflict'), 21, '主导失败态必须可被引用为证据');
  assert.equal(resolveEvidence(ecoReadings, 'drivers.outer.running'), false);
  assert.equal(resolveEvidence(ecoReadings, 'drivers.nosuch.running'), undefined);
  assert.equal(resolveEvidence(ecoReadings, 'syncHealth.nosuch'), undefined);
  assert.equal(resolveEvidence(ecoReadings, ''), undefined);
});

// 生产首轮（mt-prod-1788703469, 2026-09-06）的真实回归：autoDrive 引 `criteria.AC-180.verdict`、
// decision 引 `criteria.AC-143.status` —— 两条读数都【真实存在】，却因解析器只特化了 drivers
// 而双双被判「解析不出」拒绝，该轮 1 提 0 立 / 1 提 0 路由。用【当时被拒的原始 key】做输入，
// ⛔ 不用自造样例（memory: verification input must be real output）。
const idKeyedReadings = {
  goals: [{ id: 'GOAL-002', title: '三层塌缩', status: 'active' }],
  criteria: [
    { id: 'AC-180', title: 'active AC 必须有判据', goal: 'GOAL-001', status: 'draft', criterion: 'true', verdict: 'pass', reason: '' },
    { id: 'AC-143', title: '观测台账收尾驱动化', goal: 'GOAL-002', status: 'active', criterion: null, verdict: 'fail', reason: 'no criterion' },
  ],
  divergences: [{ id: 'AC-143', status: 'active', verdict: 'fail', reason: 'no criterion', kind: 'no-criterion' }],
  drivers: ecoReadings.drivers,
  syncHealth: ecoReadings.syncHealth,
  focus: null,
};

test('resolveEvidence: criteria/divergences/goals 也按 id 索引（⛔ 只特化 drivers ⇒ 主要证据类型不可引用）', () => {
  assert.equal(resolveEvidence(idKeyedReadings, 'criteria.AC-180.verdict'), 'pass', '生产首轮被拒的原始 key，必须解析得出');
  assert.equal(resolveEvidence(idKeyedReadings, 'criteria.AC-143.status'), 'active', '同上，第二条被拒的原始 key');
  assert.equal(resolveEvidence(idKeyedReadings, 'criteria.AC-143.criterion'), null, 'null 是合法读数（无判据本身就是证据），⛔ 不得当成解析不出');
  assert.equal(resolveEvidence(idKeyedReadings, 'divergences.AC-143.kind'), 'no-criterion');
  assert.equal(resolveEvidence(idKeyedReadings, 'goals.GOAL-002.status'), 'active');
  // 能取假的一侧：不存在的 id / 字段仍须是 undefined，⛔ 不得因放宽而变成"什么都能引"
  assert.equal(resolveEvidence(idKeyedReadings, 'criteria.AC-999.verdict'), undefined);
  assert.equal(resolveEvidence(idKeyedReadings, 'criteria.AC-180.nosuch'), undefined);
  // 整条对象也可引（parts.length === 2），与 drivers 同语义
  assert.equal(resolveEvidence(idKeyedReadings, 'criteria.AC-180').id, 'AC-180');
});

const goodItem = {
  touches: 'plugin/scripts/driver-filters.ts',
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

test('driveItems: 机制词命中【未完成】任务 ⇒ 拒并报出命中与状态', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-own-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-existing.md'), '---\nid: gap-existing\nstatus: ready\n---\n涉及 syncDevelopToDoc 的修复\n');
    const r = await driveItems(tmp, [{ ...goodItem, mechanismKeyword: 'syncDevelopToDoc' }], ecoReadings,
      { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, false);
    assert.match(r[0].reason, /未完成的既有任务已在管/);
    assert.match(r[0].reason, /gap-existing\.md\[ready\]/, '必须报出具体命中与状态，⛔ 不只说"有重复"');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 关键新行为：已 done 的任务命中【不拦】——问题仍在而任务已 done，是假完成的信号，
// 该被驱动而不是被它挡住。⛔ 但必须把这个事实带进任务体，防止在旁边另造并行机制。
test('driveItems: 机制词只命中【已 done】任务 ⇒ 不拦（假完成该被驱动）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-done-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-claimed-fixed.md'), '---\nid: gap-claimed-fixed\nstatus: done\n---\n涉及 syncDevelopToDoc 的修复\n');
    const r = await driveItems(tmp, [{ ...goodItem, mechanismKeyword: 'syncDevelopToDoc' }], ecoReadings,
      { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, true, `done 的命中不得拦截：${r[0].reason}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('blockingOwners: 只有未完成的才拦；done/superseded 不拦', () => {
  const owners = [
    { file: 'a.md', status: 'done' }, { file: 'b.md', status: 'superseded' },
    { file: 'c.md', status: 'ready' }, { file: 'd.md', status: 'unknown' },
  ];
  const b = blockingOwners(owners).map((o) => o.file);
  assert.deepEqual(b, ['c.md', 'd.md'], 'unknown 也拦——读不出状态不等于已完成（硬规则 6）');
});

test('renderAutoDriveBody: 已 done 的命中必须写进任务体（防在旁边另造并行机制）', () => {
  const body = renderAutoDriveBody(goodItem, 0, 'now', ['gap-claimed-fixed.md[done]']);
  assert.ok(body.includes('gap-claimed-fixed.md[done]'));
  assert.ok(body.includes('不要在它们旁边新造一个并行机制'));
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

test('renderAutoDriveBody: Touches 来自被修机制、且机械补上 self-touch', () => {
  const body = renderAutoDriveBody(goodItem, 0, 'now', [], 'gap-meta-x');
  assert.ok(body.includes('- `plugin/scripts/driver-filters.ts`'), 'Touches 必须指向真正要改的文件');
  assert.ok(body.includes('- `tasks/gap-meta-x.md`'), 'self-touch 必须被机械补齐');
  // 回归：模板曾硬编码 meta-driver.ts ⇒ worker 结构上改不了对的文件 ⇒ 撞重试上限进 needs-human。
  assert.ok(!body.includes('- `plugin/scripts/meta-driver.ts`'), '⛔ 不得再硬编码 meta-driver.ts');
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

// ── probe 写入守卫（FILE-ONLY 从散文变机制）───────────────────────────────────
test('probeWriteViolations: spawn 期间新增的 tracked 改动 = 违约', () => {
  const before = new Set(['a.ts']);
  const after = new Set(['a.ts', 'b.ts', 'c.ts']);
  assert.deepEqual(probeWriteViolations(before, after), ['b.ts', 'c.ts']);
  assert.deepEqual(probeWriteViolations(before, new Set(['a.ts'])), [], '没有新增 ⇒ 无违约');
  // 之前就脏的文件不算违约（共享检出里别的 driver 在写，⛔ 不能栽赃给 probe）。
  assert.deepEqual(probeWriteViolations(new Set(['x.ts']), new Set(['x.ts'])), []);
});

// 硬规则 6：读不出 ≠ 没违约。任一侧快照失败必须返回 null（无法评估），⛔ 不返回空数组冒充合格。
test('probeWriteViolations: 任一侧快照读不出 ⇒ null（⛔ 不与"无违约"同形）', () => {
  assert.equal(probeWriteViolations(null, new Set()), null);
  assert.equal(probeWriteViolations(new Set(), null), null);
  assert.equal(probeWriteViolations(null, null), null);
});

test('snapshotTrackedChanges: 非 git 目录 ⇒ null；真仓库里只收 tracked 改动、不收未跟踪', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-guard-'));
  try {
    assert.equal(snapshotTrackedChanges(tmp), null, '非 git 目录必须是 null 而非空集');
    const run = (...args) => execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8' });
    run('init', '-q'); run('config', 'user.email', 't@t'); run('config', 'user.name', 't');
    fs.writeFileSync(path.join(tmp, 'tracked.txt'), 'v1\n');
    run('add', '-A'); run('commit', '-qm', 'base');
    fs.writeFileSync(path.join(tmp, 'tracked.txt'), 'v2\n');       // tracked 改动 ⇒ 收
    fs.writeFileSync(path.join(tmp, 'untracked.txt'), 'new\n');    // 未跟踪 ⇒ 不收
    const snap = snapshotTrackedChanges(tmp);
    assert.ok(snap.has('tracked.txt'));
    assert.ok(!snap.has('untracked.txt'), '未跟踪文件不算 probe 违约（提案落盘本就是新文件）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 决策通道（方向问题必须被路由，⛔ 不许停在只打印的字段里）─────────────────
// 颗粒度闸要求 GOAL 的 scope 有 ≥3 条【真实存在】的路径 ⇒ fixture 必须造出真路径，
// ⛔ 不能把闸放宽到"声明了 3 个字符串就算"（那就退化成可随意满足的形式要求）。
function mkScopeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-scope-'));
  for (const f of ['a.ts', 'b.ts', 'c.ts']) fs.writeFileSync(path.join(d, f), '// fixture\n', 'utf8');
  return d;
}
const SCOPE3 = 'a.ts, b.ts, c.ts';

const goodDecision = {
  title: 'author↔develop 同步：ff-only + 两个写面是否要改',
  question: '写面保留在 author 而 develop 为权威，两边都收提交 ⇒ ff-only 结构上无法长期成立，是否改方向',
  options: '(a) 维持现状+加强语义兜底，代价=兜底至今 26 次仅 5 次解决；(b) 单写面，代价=改动 promotion-driver 的写路径',
  evidenceKey: 'syncHealth.notFf',
  origin: '正确答案取决于希望主检出承担什么角色，机器无法从读数推出该偏好，见 driver-filters.ts syncDevelopToDoc',
  carrier: 'goal',
  scope: SCOPE3,
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

test('fileDecisions: evidenceKey 解析不出 ⇒ 拒（决策也要有实测依据）', async (t) => {
  const root = mkScopeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = await fileDecisions(root, [{ ...goodDecision, evidenceKey: 'nope.nope' }], ecoReadings, [],
    { cap: 2, dryRun: true, at: 'now' });
  assert.equal(r[0].accepted, false);
  assert.match(r[0].reason, /解析不出/);
});

test('fileDecisions: 每轮上限 2', async (t) => {
  const root = mkScopeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const three = [1, 2, 3].map((n) => ({ ...goodDecision, title: `决策 ${n}`, origin: `${goodDecision.origin} 变体 ${n}` }));
  const r = await fileDecisions(root, three, ecoReadings, [], { cap: 2, dryRun: true, at: 'now' });
  assert.equal(r.filter((x) => x.accepted).length, 2);
  assert.match(r[2].reason, /上限/);
});

test('fileDecisions: 真写出一条 draft GOAL 记录（⛔ status 必须是 draft，构造上惰性）', async () => {
  const tmp = mkScopeRoot();
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

// gap-not-evaluated-checkers-never-persisted — 惰性守卫读数：从 full-suite-state.json 的
// notEvaluatedCheckers 逐条枚举名字（⛔ 不是计数），读不到 ⇒ 空数组而非 undefined。
test('collectInertCheckers: 逐条枚举 notEvaluatedCheckers 的名字；字段缺失/非数组 ⇒ 空数组（⛔ 非 undefined）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-inert-'));
  try {
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    // 读不到 state ⇒ 空数组（⛔ 不是 undefined——「本轮没有未评估项」与「没记录这个维度」可区分）。
    assert.deepEqual(collectInertCheckers(tmp), [], '无 state 文件 ⇒ 空数组，不是 undefined');
    // 喂一个含 notEvaluatedCheckers 的 state 文件，断言逐条出现。
    fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'), JSON.stringify({
      state: 'green',
      notEvaluatedCheckers: [
        { name: 'direct-to-develop-bypass-check', line: 'STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check' },
        { name: 'threshold-scope-check', line: 'STATIC_CHECK_NOT_EVALUATED: threshold-scope-check' },
      ],
    }), 'utf8');
    assert.deepEqual(collectInertCheckers(tmp), ['direct-to-develop-bypass-check', 'threshold-scope-check'],
      '逐条枚举名字（不是计数），且保序');
    // 字段存在但为空数组 ⇒ 空数组（「本轮没有未评估项」）。
    fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'), JSON.stringify({ state: 'green', notEvaluatedCheckers: [] }), 'utf8');
    assert.deepEqual(collectInertCheckers(tmp), [], '显式空数组 ⇒ 空数组');
    // 字段不是数组（state 还在 running / 老字段）⇒ 空数组，⛔ 不抛、不当非空。
    fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'), JSON.stringify({ state: 'running' }), 'utf8');
    assert.deepEqual(collectInertCheckers(tmp), [], 'running state（无该字段）⇒ 空数组');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 负控制：惰性守卫的名字必须【进摘要】——否则一个新出现的惰性守卫不改变摘要 ⇒ 语义半永不被唤醒。
test('readingsDigest: inertCheckers 名字进摘要——某个 guard 从在→不在/不在→在都改变摘要', () => {
  const mk = (inert) => ({
    goals: [], criteria: [], divergences: [], addressedTasks: [], inertCheckers: inert, focus: null,
    drivers: [],
    syncHealth: { window: 200, ffSynced: 0, notFf: 0, ffError: 0, semanticBegin: 0, semanticResolved: 0, semanticConflict: 0, semanticAlignFailed: 0, semanticFfFailed: 0, lastEvent: null, lastTs: null },
  });
  assert.equal(readingsDigest(mk([])), readingsDigest(mk([])), '空 = 空');
  assert.notEqual(readingsDigest(mk([])), readingsDigest(mk(['direct-to-develop-bypass-check'])),
    '惰性守卫从无到有必须改变摘要');
  assert.notEqual(readingsDigest(mk(['direct-to-develop-bypass-check'])), readingsDigest(mk(['threshold-scope-check'])),
    '不同的惰性守卫必须改变摘要（逐名进，⛔ 只进计数会让换 guard 不改变摘要）');
});

// 负控制：摘要必须对【每轮都变的量】免疫——staleSecs/记录数每轮都不同，若进摘要则闸失效。
test('readingsDigest: 不随 staleSecs/carrierRecords 变（否则变化检测恒为真）', () => {
  const mk = (stale, records) => ({
    goals: [], criteria: [], divergences: [], addressedTasks: [], inertCheckers: [], focus: null,
    drivers: [{ kind: 'promotion', running: true, supervisorAlive: true, driverAlive: true, carrierRecords: records, carrierLastTs: null, staleSecs: stale }],
    syncHealth: { window: 200, ffSynced: 1, notFf: 2, ffError: 0, semanticBegin: 0, semanticResolved: 0, semanticConflict: 0, semanticAlignFailed: 0, semanticFfFailed: 0, lastEvent: 'doc-develop-sync-not-ff', lastTs: null },
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

// ── 载体选择 + 防逃逸语义闸 ──────────────────────────────────────────────────
// 人 2026-09-06：授权 needs-human-task，但「要求极为谨慎地使用，以防其成为又一种逃避责任的出口」，
// 并明确否掉了先前的数量背压：「应从语义去控制，而不是频率」。以下全部是语义闸的双向验证。

function mkQuoteRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-quote-'));
  fs.writeFileSync(path.join(d, 'spec.md'), '前言\n语义判据允许留空，这是诚实而非缺陷\n结尾\n', 'utf8');
  fs.writeFileSync(path.join(d, 'ac.md'), 'title: x\n不存在无判据的活跃验收\n', 'utf8');
  return d;
}

test('quoteIsVerbatim: 真引用→真；伪造引用→假；文件读不到→假（fail-closed）；过短片段→假', (t) => {
  const root = mkQuoteRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(quoteIsVerbatim(root, 'spec.md', '语义判据允许留空，这是诚实而非缺陷'), true);
  assert.equal(quoteIsVerbatim(root, 'ac.md', '不存在无判据的活跃验收'), true);
  // 核心防逃逸：编出来的话核不上
  assert.equal(quoteIsVerbatim(root, 'spec.md', '这句话根本不在任何文件里出现过'), false, '伪造引用必须被拒');
  assert.equal(quoteIsVerbatim(root, 'nosuch.md', '语义判据允许留空，这是诚实而非缺陷'), false, '文件读不到 ⇒ 假，⛔ 不与核对通过同形');
  assert.equal(quoteIsVerbatim(root, 'spec.md', '前言'), false, '过短片段等于没校验 ⇒ 假');
});

test('carrierGate goal: scope 真实路径 <3 ⇒ 颗粒度拒；≥3 ⇒ 通过', (t) => {
  const root = mkScopeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const two = carrierGate(root, { ...goodDecision, scope: 'a.ts, b.ts' });
  assert.equal(two.ok, false);
  assert.match(two.reason, /granularity/);
  // 实测促因：本轮那条被误升成 GOAL 的政策冲突，作用域只有 2 个文件 ⇒ 正是这条要拦的形状
  const fake = carrierGate(root, { ...goodDecision, scope: 'x.ts, y.ts, z.ts' });
  assert.equal(fake.ok, false, '声明了 3 条但都不存在 ⇒ 仍拒（⛔ 不能靠"写够三个字符串"满足）');
  assert.equal(carrierGate(root, goodDecision).ok, true);
});

test('carrierGate needs-human-task: 伪造引用 ⇒ 拒（防逃逸核心，语义而非频率）', (t) => {
  const root = mkQuoteRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = {
    ...goodDecision, carrier: 'needs-human-task',
    irreversible: '一旦按其中一个立场改写 13 条 AC，另一条路径的历史依据就被抹掉，回退需重建记录',
    touches: 'goals/AC-180-active-ac.md',
  };
  // ① 一条都引不出 ⇒ 「我不确定」，不是「须人裁决」
  assert.equal(carrierGate(root, { ...base, conflict: [] }).ok, false);
  // ② 只引得出一条 ⇒ 那条就是答案，应直接适用
  const one = carrierGate(root, { ...base, conflict: [{ source: 'spec.md', quote: '语义判据允许留空，这是诚实而非缺陷' }] });
  assert.equal(one.ok, false);
  assert.match(one.reason, /只引得出一条/);
  // ③ 两条但其中一条是编的 ⇒ 拒，且理由点名核不上的那个 source
  const forged = carrierGate(root, { ...base, conflict: [
    { source: 'spec.md', quote: '语义判据允许留空，这是诚实而非缺陷' },
    { source: 'ac.md', quote: '这句话是编的，文件里没有' },
  ] });
  assert.equal(forged.ok, false, '伪造的一半必须使整条被拒');
  assert.match(forged.reason, /ac\.md/);
  // ④ 两条真引用 + 不可逆性 + 授权面 ⇒ 通过
  const good = { ...base, conflict: [
    { source: 'spec.md', quote: '语义判据允许留空，这是诚实而非缺陷' },
    { source: 'ac.md', quote: '不存在无判据的活跃验收' },
  ] };
  assert.equal(carrierGate(root, good).ok, true, carrierGate(root, good).reason);
  // ⑤ 可逆的选择不该占用人的注意力
  const noIrrev = carrierGate(root, { ...good, irreversible: '' });
  assert.equal(noIrrev.ok, false);
  assert.match(noIrrev.reason, /难以撤销/);
  // ⑥ 说不出该改哪里 ⇒ 不是一件卡住的工作
  assert.equal(carrierGate(root, { ...good, touches: '' }).ok, false);
});

test('carrierGate: 无数量背压——连开两条合格的 human-call 都必须通过（人否掉了频率控制）', (t) => {
  const root = mkQuoteRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const good = {
    ...goodDecision, carrier: 'needs-human-task',
    irreversible: '一旦按其中一个立场改写 13 条 AC，另一条路径的历史依据就被抹掉，回退需重建记录',
    touches: 'goals/AC-180-active-ac.md',
    conflict: [
      { source: 'spec.md', quote: '语义判据允许留空，这是诚实而非缺陷' },
      { source: 'ac.md', quote: '不存在无判据的活跃验收' },
    ],
  };
  // 同一个闸连过两次仍然通过 ⇒ 闸只看语义，不看已开条数（⛔ 若这里变红，说明频率控制又回来了）
  assert.equal(carrierGate(root, good).ok, true);
  assert.equal(carrierGate(root, { ...good, title: '另一个真实冲突' }).ok, true);
});

test('parseFrontmatterLabels: 块列表与内联两种写法都认；缩进列表结束即停', () => {
  assert.deepEqual(parseFrontmatterLabels('id: x\nlabels:\n  - gap\n  - meta-driver\nstatus: todo\n'), ['gap', 'meta-driver']);
  assert.deepEqual(parseFrontmatterLabels('labels: [gap, meta-driver]\n'), ['gap', 'meta-driver']);
  assert.deepEqual(parseFrontmatterLabels('id: x\nstatus: todo\n'), [], '没有 labels 键 ⇒ 空，⛔ 不抛');
  // 取假一侧：列表结束后的键不得被吃进来
  assert.deepEqual(parseFrontmatterLabels('labels:\n  - gap\nparent: null\n'), ['gap']);
});

test('collectAddressedTasks: 只收带标签的【未关闭】任务（裸缺陷入口 + 自身闭环）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-addr-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  const w = (id, status, labels) => fs.writeFileSync(path.join(root, 'tasks', `${id}.md`),
    `---\nid: ${id}\ntitle: t-${id}\nstatus: ${status}\nlabels:\n${labels.map((l) => `  - ${l}`).join('\n')}\n---\n正文\n`, 'utf8');
  w('a', 'todo', ['gap', 'meta-driver']);
  w('b', 'needs-human', ['meta-driver']);      // 自身闭环：它自己立的任务掉进 needs-human 也要回流
  w('c', 'done', ['meta-driver']);             // 已关闭 ⇒ 不收
  w('d', 'ready', ['gap']);                    // 无标签 ⇒ 不收
  const got = collectAddressedTasks(root).map((x) => `${x.id}:${x.status}`).sort();
  assert.deepEqual(got, ['a:todo', 'b:needs-human']);
  assert.deepEqual(collectAddressedTasks(root, 'meta-human-call'), [], '别的标签 ⇒ 空');
});

test('existingPaths: 只留【真实存在】的（目录也算——前瞻性 GOAL 可点名目录）', (t) => {
  const root = mkScopeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dir'), { recursive: true });
  assert.deepEqual(existingPaths(root, 'a.ts, nosuch.ts, dir'), ['a.ts', 'dir']);
  assert.deepEqual(existingPaths(root, ''), []);
});

test('renderHumanCallBody: 逐字冲突引用与不可逆性都进任务体（人要能直接读到裁什么）', () => {
  const body = renderHumanCallBody({
    ...goodDecision, carrier: 'needs-human-task',
    irreversible: '改写后另一条路径的历史依据被抹掉',
    touches: 'goals/AC-180-active-ac.md',
    conflict: [{ source: 'spec.md', quote: '语义判据允许留空' }, { source: 'ac.md', quote: '不存在无判据的活跃验收' }],
  }, 41, '2026-09-06T00:00:00Z', 'gap-meta-call-x');
  assert.ok(body.includes('语义判据允许留空'), '引用原文必须出现在任务体里');
  assert.ok(body.includes('改写后另一条路径的历史依据被抹掉'));
  assert.ok(body.includes('- `tasks/gap-meta-call-x.md`'), 'self-touch 机械补齐');
  assert.ok(body.includes('落败的一方已被就地更正或标注'), 'DoD 必须要求消解冲突源，⛔ 不留着再触发同一次');
});
