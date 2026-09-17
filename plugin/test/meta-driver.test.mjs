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
  attachDivergenceHandlers,
  handlerStateFor,
  computeDivergenceRecurrence,
  extractJudgeRounds,
  readMetaCarrier,
  divergenceKey,
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
  taskFileStatus,
  nextCollisionId,
  snapshotTrackedChanges,
  probeWriteViolations,
  fileDecisions,
  nextGoalId,
  renderDecisionOrigin,
  renderDecisionBody,
  decisionGoalWriteArgv,
  decisionAcWriteArgv,
  decisionAcCriterion,
  decisionQuality,
  collectDriverReadings,
  collectInertCheckers,
  shouldJudge,
  readFocusFile,
  META_FOCUS_FILE_REL,
  readState,
  writeState,
  quoteIsVerbatim,
  carrierGate,
  collectMetaRecords,
  resolveMetaRecordOpinions,
  metaReplyText,
  writeMetaReplies,
  existingPaths,
  renderHumanCallBody,
  unchangedStreak,
  absentStreak,
  deriveGoalCarrierSignals,
  goalRingValue,
  readRoundCarrier,
  GOAL_ROUND_CARRIER_REL,
  SPAWN_ZERO_OUTPUT_THRESHOLD,
  VERDICT_UNCHANGED_THRESHOLD,
  aggregateActionFailures,
  errorSignature,
  extractActionFailureRecords,
  describeResultShape,
  readingsDigestPartsForActionFailures,
  parseDurationMs,
  readActionRecordConfig,
  readActionRecordScan,
  collectActionRecordFailures,
  locateMetaCcMcp,
  ACTION_RECORD_SCAN_REL,
  goalStoreArgv,
} from '../scripts/meta-driver.ts';
import { createMetaStore } from '../../packages/quay/src/meta-store.ts';
// 读回 supersedes 用 store 自己的投影（⛔ 不 grep 落盘文本：字段名在 YAML 里的排版是序列化细节，
// 断言它会把「字段没写进去」与「排版变了」混为一谈）。
import { createGoalStore } from '../../packages/quay/src/goal-store.ts';

// 脚本根（goal 动词的 quay CLI 入口从这里解析）——数据根在各测试里另给临时目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── AC5：goal 动词 argv 的形态（gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache）──
//
// 缺陷原样：本函数曾返回 `<codeRoot>/packages/quay/src/goal-store.ts` 作为**子进程入口**。那个文件在
// 出厂布局（plugin marketplace cache / npm-pack / 第三方 vendored 副本）里【不存在】——goal-store 的库
// 已被内联进 driver bundle，只有它的 CLI 入口不可达。⇒ driver 每轮都 spawn 一个不存在的文件。
test('AC5: goal 动词 argv 不含 packages/quay/src（源码树入口已消失），且非空转', () => {
  const dataRoot = '/tmp/ac262-data-root';
  const argv = goalStoreArgv(repoRoot, ['gate', 'AC-001'], dataRoot);
  const line = argv.join(' ');

  // ① 判据本体。⛔ 负控制：把 argv 构造改回旧形（spawn packages/quay/src/goal-store.ts）⇒ 本行必红。
  assert.doesNotMatch(line, /packages\/quay\/src/, `argv 仍指向源码树：${line}`);
  // ② 空转防线（硬规则 3b）：一个空 argv、或一个缺动词的 argv，同样「不含 packages/quay/src」——
  //    不钉住形态，本条就与「什么也没验」同形。故逐项断言它是一条真命令。
  assert.ok(argv.length >= 5, `argv 太短，没构造出真命令：${line}`);
  assert.ok(argv.includes('goal'), `argv 缺 goal 动词：${line}`);
  assert.ok(argv.includes('gate') && argv.includes('AC-001'), `argv 缺子命令/位置参数：${line}`);
  assert.ok(argv.includes('--store'), `argv 缺 --store（driver 跑的是无 config 的裸 root，见 cli/goal.ts）：${line}`);
  assert.ok(argv.includes('--root') && argv.includes(dataRoot), `argv 缺 --root <dataRoot>：${line}`);
  // ③ 入口必须真的【存在】：一个不存在的路径在负控制里也「不含 packages/quay/src」，却跑不动。
  //    ⚠️ 入口段按【前缀】定位（它解析不出时叫 `quay-cli-unresolved`、没有扩展名 —— 用 `.ts/.js`
  //    后缀找会在负控制上恒找不着，把判据写成恒假）。
  const entry = argv.find((a) => a.startsWith(repoRoot));
  assert.ok(entry && fs.existsSync(entry), `argv 的 quay CLI 入口不存在：${entry}`);
});

test('AC5 负控制（契约另一半）: 解析不出的代码根 ⇒ 一个【不存在】的路径，⛔ 不抛、不回退 PATH 上的 quay', (t) => {
  const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'ac262-no-quay-cli-'));
  // ⚠️ mkdtemp 必须与清理配对（tmp-leak-pairing-check / test-isolation-check R3 按位置扫）——
  // 用 `after` 载体登记，而不是只写在测试体末尾（断言抛错就没有末尾了）。
  t.after(() => fs.rmSync(bogus, { recursive: true, force: true }));
  // 前置：夹具根【存在】但是没有 quay CLI —— 这样 ENOENT 归因于「解析不出」，而不是「根本身不存在」。
  assert.equal(fs.existsSync(bogus), true, '前置：夹具根必须存在');
  assert.equal(fs.existsSync(path.join(bogus, 'packages', 'quay', 'bin', 'quay.ts')), false, '前置：夹具里没有源码 CLI');
  const argv = goalStoreArgv(bogus, ['check', '--staleness'], '/tmp/ac262-data-root');
  // 入口段 = 以该代码根开头的那个 argv 元素（解析不出时它是 `<bogus>/quay-cli-unresolved`）。
  const entry = argv.find((a) => a.startsWith(bogus));
  assert.ok(entry, `argv 缺入口段：${argv.join(' ')}`);
  assert.equal(fs.existsSync(entry), false, `解析不出时必须给出不存在的路径（调用方按 unreadable 处理）：${entry}`);
  assert.doesNotMatch(argv.join(' '), /packages\/quay\/src/, '⛔ 解析不出也不得回落到源码树形');
});

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

// 真实回归（2026-09-06）：AC-181 被写成活性监控项、退役后判据仍 pass，status=retired ≠ achieved
// ⇒ 旧实现（只跳 draft）立刻把它报成 pass-but-unflipped，制造一条【每轮都在、永远无法消解】的
// 假偏离——退役的东西没有「该翻 achieved」可言。用当时的真实取值作输入，⛔ 不用自造样例。
test('computeDivergences: 非承诺态（retired/superseded/draft）一律不报偏离', () => {
  const mk = (id, status) => ({ id, title: null, goal: 'GOAL-001', status, criterion: 'true', verdict: 'pass', reason: 'ok' });
  assert.deepEqual(computeDivergences([mk('AC-181', 'retired')]), [], 'retired + pass 必须无偏离（真实回归）');
  assert.deepEqual(computeDivergences([mk('AC-900', 'superseded')]), [], 'superseded 同理');
  assert.deepEqual(computeDivergences([mk('AC-901', 'draft')]), [], 'draft 同理（既有行为不得回退）');
  // 无判据的非承诺态也不得报 no-criterion——「撤回的东西缺判据」不是偏离
  assert.deepEqual(computeDivergences([{ ...mk('AC-902', 'retired'), criterion: '', verdict: 'fail' }]), []);
  // 取假的一侧：承诺态仍照报，⛔ 不得因放宽而把两类真偏离一起吞掉
  assert.equal(computeDivergences([mk('AC-903', 'active')])[0]?.kind, 'pass-but-unflipped');
  assert.equal(computeDivergences([{ ...mk('AC-904', 'achieved'), verdict: 'fail' }])[0]?.kind, 'achieved-but-failing');
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

// ── supersedes：新提案携带「我取代哪条旧 AC」的声明（gap-meta-driver-proposal-lacks-supersedes-field）
// 这一组判据守的是【声明可写】与【旧 AC 不被机械翻转】两件事——后者由 store 的 isGoalRecord
// 闸结构性保证（goal-store.ts:2322），下面第三条负控制钉的就是它。
const supersedesProposalJson = (supersedes) => JSON.stringify({
  divergences: [], decisions: [], autoDrive: [],
  proposals: [{
    goal: 'GOAL-001',
    title: '把 GOAL-001 的交付面判据从旧口径换成新口径',
    criterion: 'node packages/quay/src/goal-store.ts gate AC-007',
    expect: 'exit 0 表示新口径确实可跑',
    origin: '.quay/gate-events.jsonl 中 AC-007 的 gate 计数为 0，且 goals/AC-007-t.md 的 criterion 与 GOAL-001 现行业务目标不一致',
    ...(supersedes === undefined ? {} : { supersedes }),
  }],
});

test('parseProbeOutput: 缺省 supersedes ⇒ 解析结果与改动前逐字一致（零变化路径）', () => {
  const out = parseProbeOutput(supersedesProposalJson(undefined));
  // 逐字一致 = 【键集也一致】：写成 `supersedes: undefined` 会让键多出来，deepEqual 就红了。
  assert.deepEqual(out.proposals[0], {
    goal: 'GOAL-001',
    title: '把 GOAL-001 的交付面判据从旧口径换成新口径',
    criterion: 'node packages/quay/src/goal-store.ts gate AC-007',
    expect: 'exit 0 表示新口径确实可跑',
    origin: '.quay/gate-events.jsonl 中 AC-007 的 gate 计数为 0，且 goals/AC-007-t.md 的 criterion 与 GOAL-001 现行业务目标不一致',
  });
  assert.deepEqual(Object.keys(out.proposals[0]), ['goal', 'title', 'criterion', 'expect', 'origin']);
});

test('parseProbeOutput: 带 supersedes ⇒ 解析出该字段，且首尾空白被去掉', () => {
  const out = parseProbeOutput(supersedesProposalJson('  AC-007  '));
  assert.equal(out.proposals[0].supersedes, 'AC-007');
});

// 负控制（硬规则 3b）：空白串/非字符串不是 id。⛔ 不得把它凑成一条「看起来合格」的声明——
// 否则 frontmatter 里会出现一个指向空白的 supersedes，与真实的替代关系同形。
test('parseProbeOutput: supersedes 为空白串或非字符串 ⇒ 【不产生该键】（⛔ 不凑成一条声明）', () => {
  for (const bad of ['', '   ', 7, ['AC-007'], null, { id: 'AC-007' }]) {
    const out = parseProbeOutput(supersedesProposalJson(bad));
    assert.equal(out.proposals.length, 1, `${JSON.stringify(bad)}: 提案本身仍应被接受（supersedes 只是可选字段）`);
    assert.equal('supersedes' in out.proposals[0], false, `${JSON.stringify(bad)}: 不得产生 supersedes 键`);
  }
});

// AC4 端到端（真 execve、真落盘）：LLM 输出的 JSON 带 supersedes ⇒ 新 draft AC 的 frontmatter
// 读回得到 supersedes。⛔ 不走 dry-run、不注入 seam——这条路径必须真的跑过（硬规则 4 推论三：
// 只能被 fixture/dry-run 满足的判据不是测量）。
test('端到端：proposal JSON 带 supersedes ⇒ 新 draft AC 读回含 supersedes（真跑 goal-store CLI）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-supersedes-'));
  try {
    const goals = path.join(tmp, 'goals');
    fs.mkdirSync(goals, { recursive: true });
    fs.writeFileSync(path.join(goals, 'GOAL-001-t.md'),
      '---\nid: GOAL-001\ntitle: t\nstatus: active\nkind: goal\norigin: test fixture\n---\n## Goal\nx\n');
    fs.writeFileSync(path.join(goals, 'AC-007-old.md'),
      '---\nid: AC-007\ntitle: old\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: "true"\nexpect: e\norigin: test fixture\n---\nold body\n');

    const parsed = parseProbeOutput(supersedesProposalJson('AC-007'));
    const r = await fileProposals(repoRoot, parsed.proposals, [], {
      k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: false, dataRoot: tmp,
    });
    assert.equal(r[0].accepted, true, `写入应成功，实际: ${r[0].reason}`);

    // 读回用 store 自己的投影（AC2 的「等价读法」），⛔ 不 grep 落盘文本。
    const rec = createGoalStore(goals).get(r[0].id);
    assert.ok(rec, '新 AC 应可读回');
    assert.deepEqual(rec.supersedes, ['AC-007'], '新 AC 的 frontmatter 必须带上 supersedes 声明');
    assert.equal(rec.status, 'draft', '提案仍必须落为 draft');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// AC3 负控制：本任务的⛔设计边界——声明是声明，处置是处置。被指认的旧 AC 必须【逐字不动】。
// 断言的是「不变」而不是「变成了 superseded」：这条测试的存在本身就在守「不得机械翻转旧 AC
// 状态」这条边界，所以它红了意味着有人加了一条自动翻转路径，而不是意味着功能没做完。
test('负控制：带 supersedes 的提案落地后，被指认的旧 AC 文件逐字未变（status 仍是 active）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-supersedes-noflip-'));
  try {
    const goals = path.join(tmp, 'goals');
    fs.mkdirSync(goals, { recursive: true });
    fs.writeFileSync(path.join(goals, 'GOAL-001-t.md'),
      '---\nid: GOAL-001\ntitle: t\nstatus: active\nkind: goal\norigin: test fixture\n---\n## Goal\nx\n');
    const oldPath = path.join(goals, 'AC-007-old.md');
    fs.writeFileSync(oldPath,
      '---\nid: AC-007\ntitle: old\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: "true"\nexpect: e\norigin: test fixture\n---\nold body\n');

    // 逐字基线的取法：字节 + 解析出的 status，两者都要对得上——只比 status 字面量的话，一条
    // 顺带改写（例如自动补 statusLog/superseded-by）会漏过去。
    const beforeBytes = fs.readFileSync(oldPath, 'utf8');
    const beforeStatus = createGoalStore(goals).get('AC-007').status;
    assert.equal(beforeStatus, 'active', '夹具前提：旧 AC 起始是 active');

    const parsed = parseProbeOutput(supersedesProposalJson('AC-007'));
    const r = await fileProposals(repoRoot, parsed.proposals, [], {
      k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: false, dataRoot: tmp,
    });
    assert.equal(r[0].accepted, true, `写入应成功，实际: ${r[0].reason}`);

    assert.equal(fs.readFileSync(oldPath, 'utf8'), beforeBytes,
      '旧 AC 文件必须逐字未变——声明 supersedes 不得触发任何对旧 AC 的机械写入');
    assert.equal(createGoalStore(goals).get('AC-007').status, beforeStatus,
      '旧 AC 的 status 必须保持不变；翻转它仍然是人的动作');
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

// 第七类读数（动作记录失败聚合）的测试夹具：**未评估**态——⛔ 绝不把它当「无越阈项」的默认值，
// 否则测试会在「这一维没读到」时静默走到合格侧（硬规则 3b）。
const MK_AFR_NONE = {
  state: 'not-evaluated', aggregates: null, reason: 'test-default',
  scannedAt: null, scanMs: null, since: null, recordsScanned: null, thresholdSessions: null,
};

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
  metaRecords: [],
  inertCheckers: [],
  focus: null,
  timeSeries: [],
  actionRecordFailures: MK_AFR_NONE,
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

// ── 人工转向通道（orchestration/meta-driver-focus.md 覆盖段）────────────────────
// AC2: 每轮读、非启动时读——collectReadings 的 focus 派生 = `cliFocus ?? readFocusFile(root)`，
// readFocusFile 每次调用都重新读盘（无进程常量缓存）⇒ 改文件即刻生效、无需重启。判据穿过读文件
// 这一层（⛔ 不用「传 --focus 参数」冒充，硬规则 4c）。

test('readFocusFile: 覆盖段内容改变后下一次调用取到的 focus 随之改变（每轮读，非启动时读）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-focus-'));
  try {
    fs.mkdirSync(path.join(tmp, 'orchestration'), { recursive: true });
    const file = path.join(tmp, META_FOCUS_FILE_REL);
    const makeFile = (override) => [
      '# t',
      '## 默认段',
      '默认行为：逐个审 divergence 与 metaRecords。',
      '## 覆盖段',
      override,
      '## 维护者字段',
      '维护者：人（负责更新覆盖段）。',
    ].join('\n');
    fs.writeFileSync(file, makeFile('方向 A：优先关注 syncHealth 失败'), 'utf8');
    const a = readFocusFile(tmp);
    assert.equal(a, '方向 A：优先关注 syncHealth 失败');
    // 不重启、不传任何参数——只改盘上的覆盖段。
    fs.writeFileSync(file, makeFile('方向 B：优先关注 driver 停摆'), 'utf8');
    const b = readFocusFile(tmp);
    assert.equal(b, '方向 B：优先关注 driver 停摆');
    assert.notEqual(a, b, '覆盖段内容变了，focus 必须变');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readFocusFile: 文件缺失 ⇒ null（= 人没给方向，⛔ 不抛、不当"给了空方向"）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-focus-none-'));
  try {
    assert.equal(readFocusFile(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readFocusFile: 覆盖段标题缺失 ⇒ null（⛔ 解析不出不得当"给了方向"）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-focus-nosec-'));
  try {
    fs.mkdirSync(path.join(tmp, 'orchestration'), { recursive: true });
    fs.writeFileSync(path.join(tmp, META_FOCUS_FILE_REL), '# t\n## 默认段\n默认行为。\n## 维护者字段\n维护者：人。\n', 'utf8');
    assert.equal(readFocusFile(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// AC3: 触发条件是「变了」而非「非空」——focus 进摘要：①内容不变摘要不变（⇒ 不判读）；
// ②内容变摘要变（⇒ 判读一次）。两条都要，缺一即无法区分「每轮强制判读」与「按变化判读」。

test('readingsDigest: focus（覆盖段内容）进摘要——内容不变摘要不变，内容变摘要变', () => {
  const base = { ...mkReadings('pass'), focus: '方向 A' };
  const same = { ...mkReadings('pass'), focus: '方向 A' };
  const changed = { ...mkReadings('pass'), focus: '方向 B' };
  assert.equal(readingsDigest(base), readingsDigest(same), 'focus 不变摘要必须不变（否则变化检测恒为真）');
  assert.notEqual(readingsDigest(base), readingsDigest(changed), 'focus 变摘要必须变（否则人改方向不触发判读）');
});

// AC4: :505 的每轮强制判读不再对文件形态生效——覆盖段非空且未变化 ⇒ shouldJudge 不判读（成本护栏，
// 必须能取假）。focus 参数是 CLI --focus（常驻恒 null），文件覆盖段已经编码进 digest。
test('shouldJudge: 覆盖段非空且未变化 ⇒ 不判读（文件形态不每轮强制判读）', () => {
  const now = Date.now();
  const readings = { ...mkReadings('pass'), focus: '方向 A（非空覆盖段）' };
  const digest = readingsDigest(readings);  // focus 已编码进摘要
  const r = shouldJudge({
    digest,
    state: { digest, lastJudgedAt: new Date(now - 60_000).toISOString() },
    focus: null,  // CLI --focus（常驻为 null），⛔ 不是 readings.focus
    now,
    floorMs: 10 ** 9,
  });
  assert.equal(r.judge, false, '覆盖段非空但摘要未变 ⇒ 不判读（若把 readings.focus 塞进 focus 参数，此断言会翻真）');
});

// ── 自动驱动通道的机械前置 ───────────────────────────────────────────────────
const ecoReadings = {
  goals: [], criteria: [], divergences: [], metaRecords: [], focus: null,
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

// gap-meta-autodrive-id-collides-with-done-owner：派生 id 是 mechanismKeyword 的确定性 slug、不带
// 唯一化 ⇒ 会撞上既有任务。撞 done 必须 refile（⛔ 不覆盖既有任务体、reason 取「refiled」独立态）；
// 撞未完成必须拒（⛔ 覆盖 = 静默吞掉在办任务）。三态可区分（硬规则 3b），⛔ 不得与 filed as 同形。
test('driveItems: done-owner 派生 id 碰撞 ⇒ refile 为新 id（区分后缀，reason 取 refiled 独立态）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-refile-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    // goodItem.mechanismKeyword = zzz-no-such-mechanism-keyword ⇒ 派生 id 就是这个 slug。
    // 撞上的既有任务 id 字段含关键词 ⇒ findOwningTasks 抓到 done、不拦（假完成该被驱动），
    // 再由 id 存在性判定 refile 为带后缀的新 id（⛔ 不复用旧 id 去覆盖）——即本次缺陷的真实现场。
    const baseId = 'gap-meta-zzz-no-such-mechanism-keyword';
    const file = path.join(tmp, 'tasks', `${baseId}.md`);
    fs.writeFileSync(file, `---\nid: ${baseId}\nstatus: done\n---\n旧发现，正文不含关键词\n`);
    const before = fs.readFileSync(file, 'utf8');
    const r = await driveItems(tmp, [goodItem], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, true, r[0].reason);
    assert.equal(r[0].id, `${baseId}-2`, '撞 done 必须 refile 为带后缀的新 id，⛔ 不得复用旧 id');
    assert.match(r[0].reason, /refile as/, 'refile 必须有独立取值，⛔ 不得与 filed as 同形（硬规则 3b）');
    assert.match(r[0].reason, /已 done/, 'refile 的理由必须点名既有任务已 done，⛔ 不含就退回 filed 同形');
    assert.equal(fs.readFileSync(file, 'utf8'), before, '既有 done 任务体不得被覆盖');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('driveItems: 非 done-owner 派生 id 碰撞（ready）⇒ 拒（⛔ 不覆盖在办任务）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-collide-ready-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    const baseId = 'gap-meta-zzz-no-such-mechanism-keyword';
    // 文件名撞派生 id，但 id 字段/正文都不含关键词 ⇒ findOwningTasks 抓不到，纯靠 id 存在性拦。
    // （若 id 字段也含关键词，findOwningTasks 会先在 blocking 分支拒掉，走不到本分支——两者都正确。）
    fs.writeFileSync(path.join(tmp, 'tasks', `${baseId}.md`), `---\nid: some-other-task\nstatus: ready\n---\n在办任务，正文不含关键词\n`);
    const r = await driveItems(tmp, [goodItem], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, false);
    assert.match(r[0].reason, /rejected/, '占着派生 id 的未完成任务必须被拒，⛔ 不得覆盖');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('taskFileStatus: 文件不存在 ⇒ null；存在则读 status（⛔ 不存在与读不出可区分）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-tfs-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    assert.equal(taskFileStatus(tmp, 'gap-nope'), null, '不存在必须返回 null，⛔ 不当「读不出」');
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-x.md'), '---\nid: gap-x\nstatus: done\n---\n');
    assert.equal(taskFileStatus(tmp, 'gap-x'), 'done');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nextCollisionId: -2 已存在 ⇒ -3（确定性幂等，找第一个不撞的后缀）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-ncid-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-meta-x-2.md'), '---\nid: gap-meta-x-2\n---\n');
    assert.equal(nextCollisionId(tmp, 'gap-meta-x'), 'gap-meta-x-3');
    assert.equal(nextCollisionId(tmp, 'gap-meta-y'), 'gap-meta-y-2', '无碰撞时从 -2 起');
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

// ── decision 通道的 goal 载体 body（gap-meta-filedecisions-goal-write-omits-body）────────────
// 缺陷：fileDecisions 的 carrier=goal 分支只传 --title/--origin，而 goal-store 对 goal kind 的
// create 要求 body ≥40 非空白 ⇒ 每条 carrier=goal 决策都 exit 2。修法：补 --body，正文（三段）与
// 出处（origin）分离。四条：argv 断言 / 三段单测 / 真 goal-store 端到端 / 突变负控制。

test('decisionGoalWriteArgv: goal 分支 argv 含 --body 且值 ≥40 非空白（⛔ 直接断言 argv，非反推）', () => {
  const origin = renderDecisionOrigin(goodDecision, 41, 'now');
  const body = renderDecisionBody(goodDecision);
  const argv = decisionGoalWriteArgv(repoRoot, 'GOAL-004', goodDecision, origin, body);
  const i = argv.indexOf('--body');
  assert.ok(i !== -1, 'argv 必须含 --body');
  assert.ok(typeof argv[i + 1] === 'string', '--body 后必须跟一个值');
  assert.ok(argv[i + 1].replace(/\s/g, '').length >= 40, '--body 值 ≥40 非空白字符');
});

test('renderDecisionBody: 三段各非空、合计 ≥40 非空白、且 ≠ origin（防把 origin 复制进 body）', () => {
  const b = renderDecisionBody(goodDecision);
  const o = renderDecisionOrigin(goodDecision, 41, 'now');
  const sections = b.split(/^## /m);
  assert.equal(sections.length, 4, '应有 背景/范围与非目标/退出条件 三段');
  for (let i = 1; i < 4; i++) {
    assert.ok(sections[i].replace(/\s/g, '').length > 0, `第 ${i} 段必须非空`);
  }
  assert.ok(b.replace(/\s/g, '').length >= 40, 'body 非空白字符合计 ≥40');
  assert.notEqual(b, o, 'body 与 origin 必须不同——否则就是把 origin 复制进 body 的伪修复');
});

test('fileDecisions: carrier=goal 经真 goal-store 落地（非 mock、非 dry-run）——文件出现、body ≥40', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-dec-e2e-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    const dec = { ...goodDecision, scope: 'plugin/scripts, packages/quay/src, tasks' };
    const r = await fileDecisions(repoRoot, [dec], ecoReadings, [{ id: 'GOAL-003' }],
      { cap: 2, dryRun: false, at: 'now', dataRoot: tmp });
    assert.equal(r[0].accepted, true, `写入应成功，实际: ${r[0].reason}`);
    assert.equal(r[0].id, 'GOAL-004');
    const files = fs.readdirSync(path.join(tmp, 'goals'));
    const written = files.find((f) => f.startsWith('GOAL-004'));
    assert.ok(written, `应写出 GOAL-004 文件，实际目录: ${files.join(', ')}`);
    const text = fs.readFileSync(path.join(tmp, 'goals', written), 'utf8');
    assert.match(text, /^status: draft$/m, '决策必须落为 draft，⛔ 绝不能是 active');
    const segs = text.split(/^---\s*$/m);
    const body = segs.length >= 3 ? segs.slice(2).join('---') : '';
    assert.ok(body.replace(/\s/g, '').length >= 40, `落盘的 body 非空白字符 ≥40，实得 ${body.replace(/\s/g, '').length}`);
    assert.ok(body.includes('## 背景') && body.includes('## 范围与非目标') && body.includes('## 退出条件'), 'body 必须含三段');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 决策通道的【写序】：AC 先、GOAL 后（gap-goal-born-draft-zero-ac-escapes-standing-invariant）──
// 缺陷：决策 GOAL 按设计出生即 `draft`，而写面【现在】拒绝「出生即 {draft, active} 而名下零 AC」——
// 那正是不变式 AC-217 自己的作用域。旧写法只写 GOAL ⇒ 落进被禁态；闸一扩到 draft 半边，每次决策
// 路由都会 exit 2。这三条把新写序钉住，并让「AC 那一步”被删掉”立刻报红（⛔ 不是恒绿）。
test('fileDecisions: carrier=goal 先落退出条件 AC、再落 draft GOAL（AC-first，两条载体都出现）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-dec-acfirst-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    const dec = { ...goodDecision, scope: 'plugin/scripts, packages/quay/src, tasks' };
    const r = await fileDecisions(repoRoot, [dec], ecoReadings, [{ id: 'GOAL-003' }],
      { cap: 2, dryRun: false, at: 'now', dataRoot: tmp });
    assert.equal(r[0].accepted, true, `写入应成功，实际: ${r[0].reason}`);
    assert.equal(r[0].id, 'GOAL-004');
    const files = fs.readdirSync(path.join(tmp, 'goals')).sort();
    const acFile = files.find((f) => f.startsWith('AC-'));
    const goalFile = files.find((f) => f.startsWith('GOAL-004'));
    assert.ok(acFile, `退出条件必须先作为 AC 载体落盘，实际目录: ${files.join(', ')}`);
    assert.ok(goalFile, `应写出 GOAL-004 文件，实际目录: ${files.join(', ')}`);
    const acText = fs.readFileSync(path.join(tmp, 'goals', acFile), 'utf8');
    assert.match(acText, /^goal: GOAL-004$/m, '该 AC 必须指名它守护的决策 GOAL');
    assert.match(acText, /^criterion: /m, '该 AC 必须带判据（退出条件可判定，⛔ 不是空白载体）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', goalFile), 'utf8'), /^status: draft$/m,
      '决策 GOAL 仍落为 draft（AC 先落 ⛔ 不改这条语义）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('决策 AC 的判据能取假：draft 期间 exit 1（写出成因），裁定后 exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-dec-crit-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    const origin = renderDecisionOrigin(goodDecision, 41, 'now');
    const body = renderDecisionBody(goodDecision);
    const run = (argv) => execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', stdio: 'pipe' });
    run(decisionAcWriteArgv(repoRoot, 'AC-001', 'GOAL-004', goodDecision, origin, tmp));
    run(decisionGoalWriteArgv(repoRoot, 'GOAL-004', goodDecision, origin, body, tmp)); // draft
    const criterion = decisionAcCriterion(repoRoot, 'GOAL-004', tmp);
    // 方向①：GOAL 仍是 draft ⇒ 判据为假（1），且成因在 stderr（可归因 —— 否则写面自己就会拒这条 AC）。
    let draftRc = 0, draftErr = '';
    try { execFileSync('bash', ['-c', criterion], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }); }
    catch (err) { draftRc = err.status; draftErr = String(err.stderr ?? ''); }
    assert.equal(draftRc, 1, `draft 期间判据必须为假，实得 rc=${draftRc}`);
    assert.match(draftErr, /GOAL-004/, '失败路径必须点名该 GOAL');
    // 方向②：裁定（激活）后 ⇒ 判据为真（0）。同一命令、同一对象，只改状态。
    const goalArgv = decisionGoalWriteArgv(repoRoot, 'GOAL-004', goodDecision, origin, body, tmp);
    assert.ok(goalArgv.includes('--body'), '前置：GOAL argv 是完整的一条写');
    // `--status active` appended (the argv carries no other --status): the ONLY difference from the
    // draft write above is the state, so the two readings below isolate it.
    run([...goalArgv, '--status', 'active']);
    assert.equal(execFileSync('bash', ['-c', criterion], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('突变负控制：只写 GOAL 不写 AC（旧写序）⇒ 写面必须拒（exit 2），决策不会被静默落进被禁态', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-dec-noac-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    const origin = renderDecisionOrigin(goodDecision, 41, 'now');
    const body = renderDecisionBody(goodDecision);
    const argv = decisionGoalWriteArgv(repoRoot, 'GOAL-004', goodDecision, origin, body, tmp);
    assert.throws(
      () => execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', stdio: 'pipe' }),
      (err) => err.status === 2 && /ACs naming GOAL-004: 0/.test(String(err.stderr ?? '')),
      '缺 AC 的 draft GOAL 必须 exit 2 且枚举「ACs naming GOAL-004: 0」',
    );
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'goals')), [], '被拒的写不得留下任何载体');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('突变负控制：去掉 --body 后 goal-store write 必须 fail exit 2（⛔ 判据能取假，非恒绿）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-dec-mut-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    const origin = renderDecisionOrigin(goodDecision, 41, 'now');
    const body = renderDecisionBody(goodDecision);
    const full = decisionGoalWriteArgv(repoRoot, 'GOAL-004', goodDecision, origin, body, tmp);
    const i = full.indexOf('--body');
    assert.ok(i !== -1, '前置：完整 argv 含 --body');
    const mutated = [...full.slice(0, i), ...full.slice(i + 2)]; // 去掉 --body 与其值
    assert.throws(
      () => execFileSync(mutated[0], mutated.slice(1), { encoding: 'utf8', stdio: 'pipe' }),
      (err) => err.status === 2,
      '去掉 --body 后必须 exit 2（goal-store 对 goal kind 的 create 要求 body ≥40）',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

// gap-develop-sync-reset-hard-destroys-third-party-project-tree：终局解新增了一个【终止态——拒绝】
// （被丢弃的提交不可弃 ⇒ 不 reset）。它必须进聚合面：拒绝事件后面还跟着一条双向同步汇总事件 ⇒
// lastEvent 读到的是汇总而不是拒绝 ⇒ ⛔ 不单独计数则该状态在读数里【既不入桶也不是最后事件】，
// 与「一切正常」同形（硬规则 3b；同 collectSyncHealth 上方 semanticConflict 已记过一次的错）。
test('collectSyncHealth: take-develop-refused 必须单独计数（⛔ 不入桶 ⇒ 该终止态在读数里不可见）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-sync-refused-'));
  try {
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    const lines = [
      { ts: '2026-09-11T06:00:00Z', event: 'doc-develop-sync-semantic-take-develop-refused', reason: 'non-doc-paths' },
      // 双向同步汇总事件【在拒绝之后】写 ⇒ lastEvent 读不到拒绝态（这正是必须单独计数的原因）。
      { ts: '2026-09-11T06:00:01Z', event: 'doc-develop-sync-bidirectional' },
    ].map((x) => JSON.stringify(x)).join('\n');
    fs.writeFileSync(path.join(tmp, '.quay', 'doc-develop-sync.jsonl'), lines + '\n');

    const h = collectSyncHealth(tmp);
    assert.equal(h.semanticTakeDevelopRefused, 1, '拒绝态必须入桶');
    assert.equal(h.lastEvent, 'doc-develop-sync-bidirectional', '最后事件被汇总事件占据（故 lastEvent 不足以观测拒绝）');
    // 取假：没有该事件时计数为 0（⛔ 恒 1 的计数器不是测量）。
    fs.writeFileSync(path.join(tmp, '.quay', 'doc-develop-sync.jsonl'),
      JSON.stringify({ ts: '2026-09-11T06:00:02Z', event: 'doc-develop-sync-ff-synced' }) + '\n');
    assert.equal(collectSyncHealth(tmp).semanticTakeDevelopRefused, 0, '无拒绝事件 ⇒ 0（⛔ 硬编码 ⇒ 假）');
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
    goals: [], criteria: [], divergences: [], metaRecords: [], inertCheckers: inert, focus: null,
    timeSeries: [],
    actionRecordFailures: MK_AFR_NONE,
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
    goals: [], criteria: [], divergences: [], metaRecords: [], inertCheckers: [], focus: null,
    timeSeries: [],
    actionRecordFailures: MK_AFR_NONE,
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

test('collectMetaRecords: 只收 proposed 的 META 记录（第五种 store kind），body 完整进读数', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-meta-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createMetaStore(path.join(root, 'meta'));
  store.write('META-001', { title: 'a', body: '正文 body 完整内容 001' });
  store.write('META-002', { title: 'b', body: '正文 002' });
  store.write('META-002', { status: 'answered', reply: '已答复' }); // 翻 answered ⇒ 不收
  store.write('META-003', { title: 'c', handler: 'someone-else', body: '别的 handler' }); // 仍 proposed ⇒ 收
  const got = collectMetaRecords(root).map((x) => `${x.id}:${x.status}`).sort();
  assert.deepEqual(got, ['META-001:proposed', 'META-003:proposed'], '只收 proposed；answered 不收');
  const one = collectMetaRecords(root).find((x) => x.id === 'META-001');
  assert.equal(one.body, '正文 body 完整内容 001', '正文【完整】进读数，⛔ 不存在标题截断');
  assert.equal(one.handler, 'meta-driver', 'handler 缺省 = meta-driver');
});

test('collectMetaRecords: meta 目录不存在 ⇒ 空数组（⛔ 不抛、不当"没有消息"与"读失败"混淆）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-nometa-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(collectMetaRecords(root), []);
});

// ── metaRecordOpinions：把逐条三态判定与 metaRecords 对齐（measurement）──
const addrMsg = (id) => ({ id, status: 'proposed', title: `t-${id}`, handler: 'meta-driver', reply: null, body: 'b' });

test('resolveMetaRecordOpinions: 逐条可枚举——每一条 meta 记录各得 metaId+三态，⛔ 不是总数/布尔', () => {
  const msgs = [addrMsg('META-001'), addrMsg('META-002'), addrMsg('META-003')];
  const got = resolveMetaRecordOpinions(msgs, [
    { metaId: 'META-001', hasOpinion: true, note: 'x' },
    { metaId: 'META-002', hasOpinion: false },
  ]);
  assert.equal(got.length, 3, '判定条数必须 == metaRecords 条数');
  assert.deepEqual(got.map((g) => [g.metaId, g.opinion]), [
    ['META-001', 'has-opinion'],
    ['META-002', 'no-opinion'],
    ['META-003', 'not-evaluated'],
  ], '少答的那条必须落「未评估」，⛔ 不是被静默丢弃，也不是「无意见」');
});

test('resolveMetaRecordOpinions: 三态可区分且能取假——三个样本缺一不可', () => {
  const msgs = [addrMsg('META-001')];
  assert.equal(resolveMetaRecordOpinions(msgs, [{ metaId: 'META-001', hasOpinion: true, note: 'n' }])[0].opinion, 'has-opinion');
  assert.equal(resolveMetaRecordOpinions(msgs, [{ metaId: 'META-001', hasOpinion: false }])[0].opinion, 'no-opinion');
  assert.equal(resolveMetaRecordOpinions(msgs, [])[0].opinion, 'not-evaluated');
  assert.equal(resolveMetaRecordOpinions(msgs, [{ metaId: 'META-001', hasOpinion: 'yes' }])[0].opinion, 'not-evaluated');
});

test('resolveMetaRecordOpinions: 覆盖完整性——判定条数恒等于 metaRecords 条数（负控制：probe 只答部分）', () => {
  const msgs = [addrMsg('META-001'), addrMsg('META-002'), addrMsg('META-003')];
  const got = resolveMetaRecordOpinions(msgs, [{ metaId: 'META-001', hasOpinion: false }]);
  assert.equal(got.length, msgs.length);
  assert.deepEqual(got.map((g) => g.opinion), ['no-opinion', 'not-evaluated', 'not-evaluated']);
  const extra = resolveMetaRecordOpinions(msgs, [{ metaId: 'META-999', hasOpinion: true, note: 'x' }]);
  assert.ok(extra.every((g) => g.opinion === 'not-evaluated'));
  const dup = resolveMetaRecordOpinions([addrMsg('META-001')], [
    { metaId: 'META-001', hasOpinion: true, note: 'first' },
    { metaId: 'META-001', hasOpinion: false },
  ]);
  assert.equal(dup[0].opinion, 'has-opinion');
  assert.equal(dup[0].note, 'first');
});

test('metaReplyText: 三态 → 答复文本（⛔ 未评估 ⇒ null 不答复）', () => {
  assert.equal(metaReplyText({ metaId: 'META-001', opinion: 'has-opinion', note: 'n' }), 'n');
  assert.equal(metaReplyText({ metaId: 'META-001', opinion: 'has-opinion', note: null }), '(meta-driver 有意见，未附注)');
  assert.equal(metaReplyText({ metaId: 'META-001', opinion: 'no-opinion', note: null }), '(meta-driver 无意见)');
  assert.equal(metaReplyText({ metaId: 'META-001', opinion: 'not-evaluated', note: null }), null);
});

test('writeMetaReplies: 答复内嵌到同一条记录上、翻 answered；未评估留 proposed（真 store）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-reply-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createMetaStore(path.join(root, 'meta'));
  store.write('META-001', { title: 'a', body: '正文' });
  store.write('META-002', { title: 'b', body: '正文' });
  const judgments = [
    { metaId: 'META-001', opinion: 'has-opinion', note: '答复 A' },
    { metaId: 'META-002', opinion: 'not-evaluated', note: null },
  ];
  const out = writeMetaReplies(root, judgments);
  assert.deepEqual(out.map((o) => [o.metaId, o.ok]), [['META-001', true], ['META-002', false]]);
  const answered = store.get('META-001');
  assert.equal(answered.status, 'answered', '有意见 ⇒ 翻 answered');
  assert.equal(answered.reply, '答复 A', '答复内嵌在同一条记录');
  const still = store.get('META-002');
  assert.equal(still.status, 'proposed', '未评估 ⇒ 留 proposed 不答复');
  assert.equal(still.reply, null);
});

test('parseProbeOutput: metaRecordOpinions 被解析；缺字段/形状不对的条目被丢弃（⛔ 不凑成合格）', () => {
  const out = parseProbeOutput(JSON.stringify({
    divergences: [], proposals: [], autoDrive: [], decisions: [],
    metaRecordOpinions: [
      { metaId: 'META-001', hasOpinion: true, note: 'x' },
      { metaId: 'META-002', hasOpinion: false },
      { metaId: '' },                          // metaId 空 ⇒ 丢
      { hasOpinion: true },                    // 缺 metaId ⇒ 丢
      { metaId: 'META-003', hasOpinion: 'yes' }, // hasOpinion 非布尔 ⇒ 丢
      'not-an-object',                          // 形状不对 ⇒ 丢
    ],
  }));
  assert.equal(out.metaRecordOpinions.length, 2, '只留形状合格的条目');
  assert.deepEqual(out.metaRecordOpinions.map((o) => o.metaId), ['META-001', 'META-002']);
});

// 负控制：判定不进 readingsDigest——它由 probe 输出派生、每轮可变，进摘要会让变化检测闸恒为真。
test('readingsDigest: metaRecordOpinions 不进摘要——仅判定变化时摘要不变', () => {
  const base = mkReadings('pass', 'n1');
  const a = readingsDigest(base);
  const withOpinion = { ...base, metaRecordOpinions: [{ metaId: 'META-001', opinion: 'has-opinion', note: null }] };
  const b = readingsDigest(withOpinion);
  assert.equal(a, b, '仅判定变化不得改变摘要');
});

// 消息进摘要：新 META 记录出现 ⇒ 摘要变 ⇒ 触发判读（入口在定时轮里必须有效）。
test('readingsDigest: metaRecords 进摘要——新消息改变摘要', () => {
  const base = mkReadings('pass', 'n1');
  const a = readingsDigest(base);
  const withMsg = { ...base, metaRecords: [addrMsg('META-001')] };
  const b = readingsDigest(withMsg);
  assert.notEqual(a, b, '新消息必须改变摘要');
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

// ── 重复计数（divergences 是四条输出通道里唯一没有执行器的一条）────────────────────────
// gap-meta-divergence-recommendation-recurrence-invisible：meta-driver 每轮全新上下文 ⇒ 结构上
// 无法发现自己已把同一建议重复 N 轮。修法不是塞历史进 prompt（破坏 profiles.yml:77 的
// 「每轮全新上下文」抗漂移设计），而是把一个机械可算的量（repeatCount + lastRecommendation）
// 作为读数交给它。判据喂【真载体文件】（⛔ 不是直接喂 judgeRounds 数组）——要穿过
// readMetaCarrier 那层读文件，才能证明生产路径真的取得到。

// 一条 judge round 载体记录（有 fact 的 value.interpretations 数组 = 语义半真跑过）。
function mkJudgeRecord(interps) {
  return JSON.stringify({
    round: 0, run_id: 'r', pid: 1, ts: '2026-09-06T00:00:00Z', halted: false,
    facts: [{ name: 'meta-driver', value: { interpretations: interps }, state: 'verified', reason: null }],
  });
}
// 写载体到临时根（路径与 ROUND_CARRIER_REL 一致）。
function writeCarrier(root, lines) {
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  fs.writeFileSync(path.join(root, '.quay', 'meta-driver-round.jsonl'), lines.join('\n') + '\n', 'utf8');
}
// 一条当前轮的机械 divergence（不含 repeatCount——由 computeDivergenceRecurrence 补上）。
const recurDiv = (id, kind) => ({ id, kind, status: 'active', verdict: 'pass', reason: 'x' });

test('重复计数: 同一 (id,kind) 连续 5 轮 ⇒ 计数 5，且 lastRecommendation 取最近一次', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-recur-'));
  try {
    const interp = (rec) => [{ id: 'AC-177', kind: 'pass-but-unflipped', interpretation: 'x', recommendation: rec }];
    writeCarrier(tmp, ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5'].map((r) => mkJudgeRecord(interp(r))));
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaCarrier(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
    const got = recurrence.get(divergenceKey('AC-177', 'pass-but-unflipped'));
    assert.equal(got.repeatCount, 5, '连续 5 轮 ⇒ 计数 5');
    assert.equal(got.lastRecommendation, 'rec-5', 'lastRecommendation 必须是最近（最晚）一轮的原文');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('重复计数: 空载体 ⇒ 计数 0、lastRecommendation null（能取假的一侧）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-recur-empty-'));
  try {
    writeCarrier(tmp, []);
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaCarrier(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
    const got = recurrence.get(divergenceKey('AC-177', 'pass-but-unflipped'));
    assert.equal(got.repeatCount, 0, '空载体 ⇒ 0，⛔ 不冒充「读失败」');
    assert.equal(got.lastRecommendation, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('重复计数: 连续 = 直到遇到一个不含该 (id,kind) 的判读轮为止（⛔ 不是全载体累计）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-recur-break-'));
  try {
    const a = (id) => [{ id, kind: 'pass-but-unflipped', interpretation: 'x', recommendation: `r-${id}` }];
    // 时间序（旧→新）：177 / 178（判读但无 177）/ 177 / 177 / 177
    writeCarrier(tmp, [
      mkJudgeRecord(a('AC-177')),
      mkJudgeRecord(a('AC-178')),
      mkJudgeRecord(a('AC-177')),
      mkJudgeRecord(a('AC-177')),
      mkJudgeRecord(a('AC-177')),
    ]);
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaCarrier(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
    const got = recurrence.get(divergenceKey('AC-177', 'pass-but-unflipped'));
    assert.equal(got.repeatCount, 3, '中间一轮判读未提 177 ⇒ 连续被打破，只数 3');
    assert.equal(got.lastRecommendation, 'r-AC-177');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('重复计数: 空心跳（facts=[]）与 skipped 轮不打断连续（它们不产生建议）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-recur-skip-'));
  try {
    const heartbeat = JSON.stringify({ round: 0, run_id: 'r', pid: 1, ts: 't', halted: false, facts: [] });
    const skipped = JSON.stringify({ round: 0, run_id: 'r', pid: 1, ts: 't', halted: false, facts: [{ name: 'meta-driver', value: { semantic: 'skipped-unchanged' }, state: 'verified', reason: null }] });
    const judge = mkJudgeRecord([{ id: 'AC-177', kind: 'pass-but-unflipped', interpretation: 'x', recommendation: 'r-177' }]);
    // 旧→新：判读(177) / 心跳 / skipped / 判读(177)
    writeCarrier(tmp, [judge, heartbeat, skipped, judge]);
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaCarrier(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
    const got = recurrence.get(divergenceKey('AC-177', 'pass-but-unflipped'));
    assert.equal(got.repeatCount, 2, '心跳/skipped 不产生建议 ⇒ 不打断连续，两轮判读都算');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 成本护栏（AC3）：重复计数每轮都可能 +1 ⇒ ⛔ 不得进摘要，否则变化检测闸恒为真。
test('readingsDigest: repeatCount/lastRecommendation 变化不改变摘要（⛔ 否则变化检测恒为真）', () => {
  const base = mkReadings('pass', 'n1');
  const a = { ...base, divergences: [{ ...base.divergences[0], repeatCount: 1, lastRecommendation: 'rec-A' }] };
  const b = { ...base, divergences: [{ ...base.divergences[0], repeatCount: 999, lastRecommendation: 'rec-B' }] };
  assert.equal(readingsDigest(a), readingsDigest(b), '只有重复计数变化 ⇒ 摘要不变');
  assert.equal(readingsDigest(base), readingsDigest(a), '无 repeatCount 与有 repeatCount 也同摘要');
  // 能取假的一侧：verdict 变了摘要必须变（⛔ 不得因「摘要稳定」把真变化也吞掉）。
  assert.notEqual(readingsDigest(a), readingsDigest(mkReadings('fail')), 'verdict 变仍须改变摘要');
});

// ── 处理者路由（gap-meta-divergences-not-routed-by-handler-existence）────────────────────────────
// 三条 kind 输出同形而处理者存在性截然不同：pass-but-unflipped → goal-driver 全自动翻；no-criterion →
// task→worker 但需显式触发；achieved-but-failing → 无。同形导致 259 次把「goal-driver 没在跑」报成
// 259 条 AC 症状。修法：给每条偏离附 handler 三态（由 drivers 读数派生），probe 据此路由。

// 一条当前轮的机械 divergence（handler 由 attachDivergenceHandlers 补上）。
const hDiv = (id, kind) => ({ id, kind, status: 'active', verdict: 'pass', reason: 'x' });
// 一条 driver 读数（running 可显式给 null = aliveness 读不出）。
const drv = (running) => ({ kind: 'goal', running, supervisorAlive: false, driverAlive: false, carrierRecords: 1, carrierLastTs: null, staleSecs: 5 });

// AC1：三态是可枚举的四值（healthy/stalled/absent/unreadable），⛔ 不是布尔/总数；absent ≠ unreadable。
test('handlerStateFor: 四值枚举且 absent≠unreadable（⛔ 读不懂不得与「不存在」同形，硬规则 3b）', () => {
  assert.equal(handlerStateFor('goal', [drv(true)]), 'healthy', 'present + running ⇒ healthy');
  assert.equal(handlerStateFor('goal', [drv(false)]), 'stalled', 'present + !running ⇒ stalled');
  assert.equal(handlerStateFor('goal', [{ ...drv(true), kind: 'promotion' }]), 'absent', 'goal 不在读数 ⇒ absent');
  assert.equal(handlerStateFor('goal', [drv(null)]), 'unreadable', 'aliveness 读不出 ⇒ unreadable');
  assert.equal(handlerStateFor('goal', null), 'unreadable', '读数整体缺失 ⇒ unreadable');
  assert.equal(handlerStateFor('none', [drv(true)]), 'absent', '无处理者是结构事实 ⇒ absent');
  assert.equal(handlerStateFor('none', null), 'absent', '无处理者 ≠ 读不出（none 恒 absent）');
  // absent 与 unreadable 必须不同取值（硬规则 3b：读不懂不得与「不存在」同形）。
  assert.notEqual(handlerStateFor('goal', [{ ...drv(true), kind: 'promotion' }]), handlerStateFor('goal', null), 'absent ≠ unreadable');
});

// AC2：三态双向能取假——三个断言缺一不可。
test('attachDivergenceHandlers: 三态双向能取假；achieved-but-failing 恒 absent（处理者与 goal 无关）', () => {
  const pb = hDiv('AC-170', 'pass-but-unflipped');
  // ① goal 健康 ⇒ healthy。
  assert.deepEqual(attachDivergenceHandlers([pb], [drv(true)])[0].handler, { kind: 'goal', state: 'healthy' });
  // ② 同一读数改成 goal 缺席 ⇒ absent；改成 goal 停摆 ⇒ stalled。
  assert.deepEqual(attachDivergenceHandlers([pb], [{ ...drv(true), kind: 'promotion' }])[0].handler, { kind: 'goal', state: 'absent' });
  assert.deepEqual(attachDivergenceHandlers([pb], [drv(false)])[0].handler, { kind: 'goal', state: 'stalled' });
  // ③ achieved-but-failing 在两种读数下都标 absent（它的处理者与 goal-driver 无关）。
  const af = hDiv('AC-172', 'achieved-but-failing');
  assert.deepEqual(attachDivergenceHandlers([af], [drv(true)])[0].handler, { kind: 'none', state: 'absent' });
  assert.deepEqual(attachDivergenceHandlers([af], [])[0].handler, { kind: 'none', state: 'absent' });
  // no-criterion 处理者标识 = worker（task→worker 流水线）。
  assert.equal(attachDivergenceHandlers([hDiv('AC-143', 'no-criterion')], [drv(true)])[0].handler.kind, 'worker');
});

// DoD3 回放：09-06T14:25–19:04 那段的读数形态（goal-driver 缺席/停摆）⇒ 7 条 pass-but-unflipped
// 全部归为「处理者停摆/不存在」，⛔ 不是逐条针对 AC 的症状。
test('回放：goal-driver 缺席时 7 条 pass-but-unflipped 归为处理者停摆（⛔ 非逐条 AC 症状）', () => {
  const ids = ['AC-170', 'AC-171', 'AC-172', 'AC-173', 'AC-174', 'AC-175', 'AC-176'];
  const divs = ids.map((id) => hDiv(id, 'pass-but-unflipped'));
  for (const d of attachDivergenceHandlers(divs, [drv(false)])) {
    assert.equal(d.handler.state, 'stalled', `${d.id} 应归为「处理者停摆」，⛔ 不是健康`);
  }
  for (const d of attachDivergenceHandlers(divs, [{ ...drv(true), kind: 'promotion' }])) {
    assert.equal(d.handler.state, 'absent', `${d.id} 在 goal 缺席时应归为「处理者不存在」`);
  }
  // 取假的一侧：goal 健康时同 7 条归为 healthy（对照，证明分类轴随处理者状态翻转）。
  for (const d of attachDivergenceHandlers(divs, [drv(true)])) {
    assert.equal(d.handler.state, 'healthy', `${d.id} 在 goal 健康时归为 healthy`);
  }
});

// AC3（成本护栏）：handler 三态进摘要；仅 staleSecs 数值变化（三态不变）⇒ 摘要不变。
test('readingsDigest: handler 三态进摘要；仅 staleSecs 变而三态不变 ⇒ 摘要不变（两个方向都断言）', () => {
  const base = mkReadings('pass', 'n1');
  const withHandler = (state) => ({ ...base, divergences: [{ ...base.divergences[0], handler: { kind: 'goal', state } }] });
  // 方向一：仅 staleSecs 数值变化、三态不变 ⇒ 摘要不变（staleSecs 不得进摘要）。
  const a = withHandler('healthy'); a.drivers[0].staleSecs = 5;
  const b = withHandler('healthy'); b.drivers[0].staleSecs = 9999;
  assert.equal(readingsDigest(a), readingsDigest(b), '仅 staleSecs 变、三态不变 ⇒ 摘要不变');
  // 方向二：三态变化 ⇒ 摘要改变（handler 三态必须进摘要，⛔ 不得恒不变）。
  assert.notEqual(readingsDigest(withHandler('healthy')), readingsDigest(withHandler('stalled')), '三态 healthy→stalled ⇒ 摘要改变');
  assert.notEqual(readingsDigest(withHandler('healthy')), readingsDigest(withHandler('absent')), '三态 healthy→absent ⇒ 摘要改变');
});

// ── 时序派生层（gap-meta-readings-no-timeseries-derivation）────────────────────────
// 通用时序层：对已在读的载体派生两类 streak——(a) 取值不变；(b) 应发生而未发生（spawn 了但零产出）。
// AC1 判据喂【真生产记录】（⛔ 不是构造数据——硬规则 4 推论三：只能被构造数据满足的判据不是测量）。

// 真生产记录（.quay/goal-round.jsonl，2026-09-09T14:51→15:28，rounds 49–56，逐字取自生产文件；
// 每条只保留派生层读的字段，gap_spawns 的 stdout/stderr 大段已 elide）。8 轮每轮都 spawn 了 AC-214
// 一个 gap 立案 agent（gap_spawns.ac==="AC-214"）而 gaps 里它仍是 state==="gap"/taskCount===0 ⇒
// 零产出连续 8 轮。round/ts/verdict/state 均为生产原值。
const AC214_ROUNDS = [
  [49, '2026-09-09T14:51:46.771Z'],
  [50, '2026-09-09T14:56:15.796Z'],
  [51, '2026-09-09T15:00:17.349Z'],
  [52, '2026-09-09T15:04:48.108Z'],
  [53, '2026-09-09T15:09:50.088Z'],
  [54, '2026-09-09T15:14:30.911Z'],
  [55, '2026-09-09T15:23:29.752Z'],
  [56, '2026-09-09T15:28:22.562Z'],
];
const mkGoalRound = (round, ts) => ({
  round, ts,
  facts: [{
    name: 'goal-ring',
    value: {
      criteria: [{ id: 'AC-214', goal: 'GOAL-009', status: 'active', verdict: 'fail', reason: 'acceptance failed (exit 1)' }],
      gaps: [{ goal: 'GOAL-009', ac: 'AC-214', state: 'gap', taskCount: 0 }],
      gap_spawns: [{ ac: 'AC-214', goal: 'GOAL-009', exitCode: 0 }],
    },
    state: 'verified',
  }],
});
const AC214_WINDOW = AC214_ROUNDS.map(([r, t]) => mkGoalRound(r, t));

test('AC1 派生层: 真生产记录（AC-214 连续 8 轮 spawn 零产出）⇒ spawn-zero-output streak ≥ 8', () => {
  const signals = deriveGoalCarrierSignals(AC214_WINDOW, ['AC-214']);
  const spawn = signals.find((s) => s.key === 'goal:AC-214:spawn-zero-output');
  assert.equal(spawn.mode, 'expected-absent');
  assert.equal(spawn.evaluated, true);
  assert.ok(spawn.count >= 8, `零产出 streak 应 ≥ 8，实得 ${spawn.count}`);
  assert.equal(spawn.crossed, true, 'count ≥ 阈值 8 ⇒ crossed 必须 true');
  // 第二类量（取值不变）：8 轮 verdict 都是 fail ⇒ verdict streak 也 ≥ 8。
  const verdict = signals.find((s) => s.key === 'goal:AC-214:verdict');
  assert.equal(verdict.mode, 'unchanged');
  assert.equal(verdict.evaluated, true);
  assert.ok(verdict.count >= 8, `verdict 连续不变 streak 应 ≥ 8，实得 ${verdict.count}`);
});

test('AC1 负控制: 打断「零产出」连续后 streak 变短（判据能取假，⛔ 非恒真）', () => {
  // 最后一轮改成「spawn 了且产出了任务」（gaps 里不再 gap）⇒ 零产出连续被打破。
  const last = AC214_WINDOW[AC214_WINDOW.length - 1];
  const broken = [
    ...AC214_WINDOW.slice(0, -1),
    { ...last, facts: [{ ...last.facts[0], value: { ...last.facts[0].value, gaps: [{ goal: 'GOAL-009', ac: 'AC-214', state: 'in-progress', taskCount: 1 }] } }] },
  ];
  const s = deriveGoalCarrierSignals(broken, ['AC-214']).find((x) => x.key === 'goal:AC-214:spawn-zero-output');
  assert.equal(s.evaluated, true);
  assert.ok(s.count < 8, '最后一轮产出任务 ⇒ 零产出 streak 必须被打断');
  assert.equal(s.crossed, false, '未越阈 ⇒ crossed=false');
});

// AC2: digest 只取 crossed 位，⛔ 不进 count——count 递增但未越阈 ⇒ 摘要相同；越阈 ⇒ 摘要改变。
const tsReadings = (count, crossed, evaluated = true, key = 'goal:AC-214:spawn-zero-output') => ({
  ...mkReadings('pass', 'n1'),
  timeSeries: [{ key, mode: 'expected-absent', count, crossed, evaluated, threshold: 8 }],
});

test('AC2 digest: streak 递增但未越阈 ⇒ 摘要相同；越阈 ⇒ 摘要改变（两个方向）', () => {
  const below1 = tsReadings(3, false);
  const below2 = tsReadings(7, false);
  assert.equal(readingsDigest(below1), readingsDigest(below2), 'count 3→7 都未越阈 ⇒ 摘要必须相同（否则变化检测恒为真）');
  const crossed = tsReadings(8, true);
  assert.notEqual(readingsDigest(below2), readingsDigest(crossed), '越阈（crossed false→true）⇒ 摘要必须改变');
});

// AC3: 读不出 ⇒ evaluated:false，⛔ 不与 streak=0/crossed=false 同形（硬规则 3b）。
test('AC3: 载体无历史 / 该 AC 无观测 ⇒ evaluated:false（⛔ 不与 crossed=false 同形）', () => {
  const none = deriveGoalCarrierSignals([], ['AC-214']);
  const spawn = none.find((s) => s.key === 'goal:AC-214:spawn-zero-output');
  assert.equal(spawn.evaluated, false, '无历史 ⇒ evaluated:false');
  assert.equal(spawn.count, 0);
  assert.equal(spawn.crossed, false);
  // 有历史但该 AC 从未出现（spawn 序列全是 null）⇒ 尾值 null ⇒ evaluated:false。
  const never = deriveGoalCarrierSignals([mkGoalRound(1, '2026-09-09T00:00:00.000Z')], ['AC-999']);
  const s2 = never.find((s) => s.key === 'goal:AC-999:spawn-zero-output');
  assert.equal(s2.evaluated, false, '该 AC 无任何观测 ⇒ evaluated:false，⛔ 不冒充 streak=0');
  // digest 里 evaluated:false（u）与 crossed:false（0）必须不同 token——否则读不懂与合格同形。
  const unread = { ...mkReadings('pass', 'n1'), timeSeries: [{ key: 'k', mode: 'expected-absent', count: 0, crossed: false, evaluated: false, threshold: 8 }] };
  const readOk = { ...mkReadings('pass', 'n1'), timeSeries: [{ key: 'k', mode: 'expected-absent', count: 0, crossed: false, evaluated: true, threshold: 8 }] };
  assert.notEqual(readingsDigest(unread), readingsDigest(readOk), 'evaluated:false（u）与 crossed:false（0）必须改变摘要');
});

// 纯函数边界：空 / 尾值 null ⇒ evaluated:false；尾值 false（发生了）⇒ count=0 而非未评估。
test('unchangedStreak/absentStreak: 空与尾值 null ⇒ evaluated:false；absent 尾 false ⇒ count=0', () => {
  assert.deepEqual(unchangedStreak([]), { evaluated: false, count: 0 });
  assert.deepEqual(unchangedStreak([null]), { evaluated: false, count: 0 });
  assert.deepEqual(unchangedStreak(['a', 'a', 'b']), { evaluated: true, count: 1 }, '尾值 b 只连续 1 轮');
  assert.deepEqual(unchangedStreak(['a', 'a', 'a']), { evaluated: true, count: 3 });
  assert.deepEqual(absentStreak([]), { evaluated: false, count: 0 });
  assert.deepEqual(absentStreak([null]), { evaluated: false, count: 0 });
  assert.deepEqual(absentStreak([true, true, false]), { evaluated: true, count: 0 }, '尾值 false = 发生了 ⇒ count 0，⛔ 不是未评估');
  assert.deepEqual(absentStreak([true, true, true]), { evaluated: true, count: 3 });
});

// 派生层只读传入记录、不碰磁盘；goalRingValue 读不出 ⇒ null。
test('goalRingValue: 读不出 facts/name 不符 ⇒ null（⛔ 不抛）', () => {
  assert.equal(goalRingValue({}), null);
  assert.equal(goalRingValue({ facts: [] }), null);
  assert.equal(goalRingValue({ facts: [{ name: 'meta-driver', value: {} }] }), null);
  assert.deepEqual(goalRingValue({ facts: [{ name: 'goal-ring', value: { criteria: [] } }] }), { criteria: [] });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 第七类读数：动作记录失败聚合（GOAL-014 选项① / 本任务 AC2–AC6）
// ═══════════════════════════════════════════════════════════════════════════════════════════

// 造一段 meta-cc `query_session_signals type=errors` 的**真实结果形状**（实测 2026-09-12：
// result.content[0].text 是一段 JSON 字符串，形如 {"data":[{…sessionId…, message:{content:[
// {type:"tool_result", is_error:true, content:"<tool_use_error>…"}]}}]}）。
const mkMetaCcResult = (rows) => ({
  content: [{ type: 'text', text: JSON.stringify({ data: rows }) }],
});
const mkErrRow = (sessionId, text, ts = '2026-09-12T00:00:00.000Z') => ({
  sessionId, timestamp: ts, type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: text, tool_use_id: 't1' }] },
});

// AC2：聚合器输出是【清单】（含签名 / 命中会话数 / 总次数），⛔ 不是布尔。
test('AC2: 聚合器按「同错误 × 跨会话」出清单（签名 + 命中会话数 + 总次数）', () => {
  const rows = [
    mkErrRow('s1', 'Unknown skill: quay-file-task'),
    mkErrRow('s2', 'Unknown skill: quay-file-task'),
    mkErrRow('s1', 'Unknown skill: quay-file-task'), // 同一会话内第二次 ⇒ 计数 +1、会话数不变
    mkErrRow('s3', 'Exit code 127'),
  ];
  const r = aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult(rows)), { minSessions: 2 });
  assert.equal(r.state, 'crossed');
  assert.ok(Array.isArray(r.aggregates), '⛔ 必须是清单，不是布尔');
  const top = r.aggregates[0];
  assert.equal(top.signature, 'Unknown skill: quay-file-task');
  assert.equal(top.sessions, 2, '命中【会话】数去重后为 2（⛔ 不是总次数 3）');
  assert.equal(top.count, 3, '总次数含同会话内重复 = 3');
  assert.equal(top.crossed, true);
  assert.ok(top.example.includes('Unknown skill'), '清单项带原始样例（SPEC §5.3：枚举对象、给指引）');
});

// AC3：三态互不同形，且「读不到」不与「无越阈项」共用取值（硬规则 3b）。
test('AC3: 三态互不同形——crossed / none / not-evaluated 各一条实跑读数', () => {
  const corpus = (rows, min) => aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult(rows)), { minSessions: min });
  // ① 有越阈项
  const crossed = corpus([mkErrRow('a', 'alpha failed'), mkErrRow('b', 'alpha failed')], 2);
  // ② 无越阈项（查过了，没有跨会话重复）——两条文本必须真的不同形（⛔ 不能用只差数字的样例：
  //    `errorSignature` 会故意把数字归一到 <n>，那正好会聚成一项、把本用例的前提弄假）。
  const none = corpus([mkErrRow('a', 'alpha failed'), mkErrRow('b', 'beta failed')], 2);
  // ③ 语料读不到（形状不认识）
  const unreadable = aggregateActionFailures(extractActionFailureRecords({ nonsense: true }), { minSessions: 2 });
  assert.equal(crossed.state, 'crossed');
  assert.equal(none.state, 'none');
  assert.equal(unreadable.state, 'not-evaluated');
  // 「读不到」必须与「无越阈项」不同形：一个是 null，一个是 []。
  assert.equal(unreadable.aggregates, null, '读不到 ⇒ aggregates 为 null');
  assert.deepEqual(none.aggregates, [{ signature: 'alpha failed', sessions: 1, count: 1, crossed: false, example: 'alpha failed' },
    { signature: 'beta failed', sessions: 1, count: 1, crossed: false, example: 'beta failed' }],
    '查到了、无越阈 ⇒ 清单非 null（即使是空清单也必须是清单）');
  assert.notEqual(unreadable.aggregates, none.aggregates);
  // 空语料（查过、零错误）⇒ none + 空清单，⛔ 不是 not-evaluated。
  const empty = corpus([], 2);
  assert.equal(empty.state, 'none');
  assert.deepEqual(empty.aggregates, [], '零错误 = 查过且无命中 ⇒ []（⛔ 不与「读不到」的 null 同形）');
  // 第四态 unthresholded（未定阈值——见 ActionFailureReading 注释）也必须在四态里唯一。
  const unthr = aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult([mkErrRow('a', 'alpha failed'), mkErrRow('b', 'alpha failed')])), { minSessions: null });
  assert.equal(unthr.state, 'unthresholded');
  assert.equal(unthr.aggregates[0].crossed, null, '未定阈值 ⇒ crossed=null（⛔ 不与 false 同形）');
  assert.equal(unthr.aggregates[0].sessions, 2, '清单照出（「看见了什么」与「判没判越阈」解耦）');
  // digest 四态 token 两两不同。
  const toks = [crossed, none, unreadable, unthr].map((r) => readingsDigestPartsForActionFailures(r)[0]);
  assert.equal(new Set(toks).size, 4, `四态 token 必须两两不同，实得 ${JSON.stringify(toks)}`);
});

// 抽取出错 ≠ 没有错误：null（读不懂）与 []（读懂了、里面没有）必须可分。
test('extractActionFailureRecords: 读不懂 ⇒ null（⛔ 不与「读懂了、零命中」的 [] 同形）', () => {
  assert.equal(extractActionFailureRecords({ content: [{ type: 'text', text: 'not json at all' }] }), null);
  assert.equal(extractActionFailureRecords({}), null);
  assert.deepEqual(extractActionFailureRecords(mkMetaCcResult([])), [], '读懂了、零记录 ⇒ []');
});

// AC4：取假控制，**双向**。只跑一次「报出来了」不算——必须证明把量降到阈值以下结论会翻。
test('AC4: 双向取假控制——跨会话重复 ⇒ 报出；降到阈值以下 ⇒ 不报（两次结果必须不同）', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => mkErrRow(`s${i}`, 'Unknown skill: quay-file-task'));
  const above = aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult(rows(3))), { minSessions: 3 });
  const below = aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult(rows(2))), { minSessions: 3 });
  assert.equal(above.state, 'crossed', '3 个会话 ≥ 阈值 3 ⇒ 报出');
  assert.equal(below.state, 'none', '2 个会话 < 阈值 3 ⇒ 不报');
  assert.notEqual(above.state, below.state, '两次结果必须不同（否则不构成取假）');
  // 反向对照：同一份语料，只把【阈值】改掉，结论也翻 ⇒ 证明结论确实由阈值驱动，而非别的因素。
  const sameCorpus = extractActionFailureRecords(mkMetaCcResult(rows(2)));
  assert.equal(aggregateActionFailures(sameCorpus, { minSessions: 3 }).state, 'none');
  assert.equal(aggregateActionFailures(sameCorpus, { minSessions: 2 }).state, 'crossed');
});

// AC5：digest 稳定性——同一份语料连续两轮逐字节相同；新增一条越阈项后必须改变。
// ⛔ 这正是不让原始计数进 digest 的那条纪律要挡住的：计数从 3→4 不得改变摘要。
test('AC5: 同一语料两轮 digest 逐字节相同；计数变不变、新增越阈项才变', () => {
  const mk = (afr) => ({ ...mkReadings('pass', 'n1'), actionRecordFailures: afr });
  const base = [
    mkErrRow('s1', 'Unknown skill: quay-file-task'), mkErrRow('s2', 'Unknown skill: quay-file-task'),
    mkErrRow('s3', 'Exit code 127'),
  ];
  const round1 = aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult(base)), { minSessions: 2, scannedAt: '2026-09-12T00:00:00Z', scanMs: 100, since: null });
  // 第二轮：同一份错误、但 (a) 时间戳/耗时/扫描时刻都变了 (b) 某签名又多命中一次（3→4，仍越阈）。
  const round2raw = [...base, mkErrRow('s3', 'Unknown skill: quay-file-task')];
  const round2 = aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult(round2raw)), { minSessions: 2, scannedAt: '2026-09-12T01:00:00Z', scanMs: 999, since: null });
  assert.equal(round1.aggregates[0].count, 2, '前提：首轮该签名计 2 次');
  assert.equal(round2.aggregates[0].count, 3, '前提：计数确实从 2 变成了 3（同一错误集、仍越阈）');
  assert.notEqual(round1.scanMs, round2.scanMs, '前提：scanMs 确实不同');
  assert.equal(readingsDigest(mk(round1)), readingsDigest(mk(round2)),
    '同一份错误集 + 计数变化 ⇒ digest 必须逐字节相同（原始计数 ⛔ 不进摘要）');
  // 新增一条【越阈】项（一个新签名、跨 2 个会话）⇒ digest 必须变。
  // ⚠️ 前提要说清：给**已越阈**的那一项再多记几次【不会】改变摘要（上面 round1→round2 已证），
  //    这里加的是**新的**越阈签名。
  const withNew = aggregateActionFailures(
    extractActionFailureRecords(mkMetaCcResult([...base, mkErrRow('s9', 'gamma exploded'), mkErrRow('s10', 'gamma exploded')])),
    { minSessions: 2 });
  assert.notEqual(readingsDigest(mk(round1)), readingsDigest(mk(withNew)), '新增越阈项必须改变摘要');
  // 反向：只多了一条【未越阈】的孤例 ⇒ 清单变了但摘要不变（否则每来一个新错就烧一轮 LLM）。
  const withSolo = aggregateActionFailures(
    extractActionFailureRecords(mkMetaCcResult([...base, mkErrRow('s9', 'brand new one-off error')])),
    { minSessions: 2 });
  assert.equal(readingsDigest(mk(round1)), readingsDigest(mk(withSolo)),
    '未越阈的孤例不得改变摘要（否则摘要每轮都变、变化检测闸失效）');
});

// AC6：阈值不写死——配置读取在未配置时返回 null（⛔ 不落回任何数值默认）。
test('AC6: readActionRecordConfig 未配置 ⇒ 全 null（⛔ 不写字面量默认值）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-afr-cfg-'));
  try {
    // 没有 config.yml
    assert.deepEqual(readActionRecordConfig(tmp), { minSessions: null, windowMs: null, scanTtlMs: null, scanTimeoutMs: null });
    // 有 config.yml 但没有该段
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.quay', 'config.yml'), 'providers:\n  native:\n    enabled: true\n', 'utf8');
    assert.deepEqual(readActionRecordConfig(tmp), { minSessions: null, windowMs: null, scanTtlMs: null, scanTimeoutMs: null },
      '段缺失 ⇒ null（⛔ 不是某个「恰好合理」的默认值）');
    // 段存在、键取配置值
    fs.writeFileSync(path.join(tmp, '.quay', 'config.yml'),
      'action_record_failures:\n  min_sessions: 4\n  window: 24h\n  scan_ttl: 30m\n  scan_timeout: 10m\n', 'utf8');
    assert.deepEqual(readActionRecordConfig(tmp), { minSessions: 4, windowMs: 86400000, scanTtlMs: 1800000, scanTimeoutMs: 600000 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseDurationMs: 带单位的时长 / 裸数字（毫秒）/ 不可解析 ⇒ null', () => {
  assert.equal(parseDurationMs('24h'), 86400000);
  assert.equal(parseDurationMs('30m'), 1800000);
  assert.equal(parseDurationMs('90s'), 90000);
  assert.equal(parseDurationMs('7d'), 604800000);
  assert.equal(parseDurationMs(1500), 1500);
  assert.equal(parseDurationMs('soon'), null);
  assert.equal(parseDurationMs(undefined), null);
});

// meta-cc hybrid output（internal/mcp/response/adapter.go）：结果超过 inline 阈值时走 file_ref
// 模式——记录本体在 JSONL 临时文件里。实测 2026-09-12：不处理这一支时【全量】扫描永远解析不出，
// 而它看起来像「语料读不到」（not-evaluated），不像「解析器少了一支」——正是硬规则 3b 的那类伪装。
test('extractActionFailureRecords: file_ref 模式（记录在临时 JSONL 里）必须能读；缺 path ⇒ null', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-afr-fr-'));
  try {
    const jl = path.join(tmp, 'errors.jsonl');
    fs.writeFileSync(jl, [
      JSON.stringify(mkErrRow('s1', 'Unknown skill: quay-file-task')),
      JSON.stringify(mkErrRow('s2', 'Unknown skill: quay-file-task')),
      '',
    ].join('\n'), 'utf8');
    const env = { content: [{ type: 'text', text: JSON.stringify({ mode: 'file_ref', file_ref: { path: jl, line_count: 2 } }) }] };
    const recs = extractActionFailureRecords(env);
    assert.equal(recs.length, 2, 'file_ref 的记录必须被读出来');
    assert.equal(recs[0].sessionId, 's1');
    assert.equal(recs[0].signature, 'Unknown skill: quay-file-task');
    // 指向不存在的文件 ⇒ null（读不懂），⛔ 不是 []（「读懂了、零命中」）。
    const bad = { content: [{ type: 'text', text: JSON.stringify({ mode: 'file_ref', file_ref: { path: path.join(tmp, 'nope.jsonl') } }) }] };
    assert.equal(extractActionFailureRecords(bad), null);
    // 没有 file_ref / data ⇒ null，且 describeResultShape 给出可诊断的形状提示。
    const weird = { content: [{ type: 'text', text: JSON.stringify({ mode: 'inline', warnings: ['x'] }) }] };
    assert.equal(extractActionFailureRecords(weird), null);
    assert.ok(describeResultShape(weird).includes('mode=inline'), describeResultShape(weird));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// errorSignature：归一化是「同错误可聚合」的前提——同形异值必须归到同一个键，异形必须不同键。
test('errorSignature: 抹掉一次性的数字/路径/sha；不同错误不得并成一个签名', () => {
  assert.equal(
    errorSignature('ENOENT: no such file, open /home/yale/work/quay/a.ts line 42'),
    errorSignature('ENOENT: no such file, open /tmp/b.ts line 99'),
    '同形异值（路径/行号）必须归一到同一个签名');
  assert.notEqual(errorSignature('Unknown skill: quay-file-task'), errorSignature('Exit code 127'));
  // 反向对照：不归一化就会各自成键 ⇒ 聚合面恒为「每个错误 1 个会话」，本读数就没意义。
  const rows = [
    mkErrRow('s1', 'ENOENT: open /p/a.ts line 1'), mkErrRow('s2', 'ENOENT: open /p/b.ts line 2'),
  ];
  const r = aggregateActionFailures(extractActionFailureRecords(mkMetaCcResult(rows)), { minSessions: 2 });
  assert.equal(r.state, 'crossed', '归一化后两条应聚成一项、命中 2 个会话');
  // 「a–f 组成的普通英文词」不得被当成 sha 抹掉（否则不同错误会被并成一个签名）。
  assert.ok(errorSignature('the process defaced its output').includes('defaced'));
});

// collectActionRecordFailures：扫描（成本旋钮）与越阈判定（判断旋钮）解耦——
// 「不定阈值」不得等于「不看语料」（否则 AC7 落空），也⛔不得等于「替人定一个数」。
test('collectActionRecordFailures: 未定阈值 ⇒ unthresholded（清单照出、crossed 为 null，不触扫描）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-afr-col-'));
  try {
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    // ① 未配置 min_sessions **且无载体** ⇒ not-evaluated（语料读不到）。
    const r0 = await collectActionRecordFailures(tmp, { now: Date.parse('2026-09-12T02:00:00Z'), binary: null });
    assert.equal(r0.state, 'not-evaluated');
    assert.equal(r0.aggregates, null, '读不到 ⇒ null，⛔ 不是 []');
    // ② 未配置 min_sessions 但【有真实载体】⇒ unthresholded：清单照出、crossed 全为 null。
    fs.writeFileSync(path.join(tmp, ACTION_RECORD_SCAN_REL), JSON.stringify({
      scannedAt: '2026-09-12T01:59:00Z', scanMs: 1234, since: null,
      records: [
        { sessionId: 's1', signature: 'Unknown skill: quay-file-task', example: 'x', ts: null },
        { sessionId: 's2', signature: 'Unknown skill: quay-file-task', example: 'x', ts: null },
      ],
    }), 'utf8');
    const r1 = await collectActionRecordFailures(tmp, { now: Date.parse('2026-09-12T02:00:00Z'), binary: null });
    assert.equal(r1.state, 'unthresholded', '未定阈值 ⇒ 独立取值（⛔ 不与 none/crossed 同形）');
    assert.equal(r1.aggregates.length, 1, '清单照出——「我看见了什么」不因「还没定阈值」而丢掉');
    assert.equal(r1.aggregates[0].crossed, null, 'crossed=null（⛔ 不与 false 同形）');
    assert.equal(r1.aggregates[0].sessions, 2);
    assert.equal(r1.thresholdSessions, null);
    assert.equal(r1.scanMs, 1234, '走向载体、不重扫（scanMs 来自载体）');
    assert.equal(readActionRecordScan(tmp).records.length, 2);
    // ③ 配好阈值 + `scan_ttl` 未配置 ⇒ 仍然【从不自动扫】（⛔ 不写字面量 TTL），走同一份载体。
    fs.writeFileSync(path.join(tmp, '.quay', 'config.yml'), 'action_record_failures:\n  min_sessions: 2\n', 'utf8');
    const r2 = await collectActionRecordFailures(tmp, { now: Date.parse('2026-09-12T02:00:00Z'), binary: null });
    assert.equal(r2.state, 'crossed', '阈值 2 + 两会话 ⇒ 越阈');
    assert.equal(r2.scanMs, 1234, 'scan_ttl 未配置 ⇒ 不重扫');
    assert.equal(r2.thresholdSessions, 2);
    // ④ 配了 scan_ttl 且载体过期、binary:null（无 meta-cc）⇒ 扫描失败但有旧载体 ⇒ 落回旧载体
    //    （值仍来自**真实**扫描，age 由 scannedAt 暴露），⛔ 不能冒充「无越阈项」。
    fs.writeFileSync(path.join(tmp, '.quay', 'config.yml'), 'action_record_failures:\n  min_sessions: 2\n  scan_ttl: 1h\n', 'utf8');
    const r3 = await collectActionRecordFailures(tmp, { now: Date.parse('2026-09-12T05:00:00Z'), binary: null });
    assert.equal(r3.state, 'crossed');
    assert.equal(r3.scannedAt, '2026-09-12T01:59:00Z', '旧载体的时刻暴露年龄');
    // ⑤ 无载体 + 扫描失败 ⇒ not-evaluated（⛔ 不是 none、⛔ 不是 unthresholded）。
    fs.rmSync(path.join(tmp, ACTION_RECORD_SCAN_REL));
    const r4 = await collectActionRecordFailures(tmp, { now: Date.parse('2026-09-12T05:00:00Z'), binary: null });
    assert.equal(r4.state, 'not-evaluated');
    assert.ok(r4.reason.startsWith('scan-failed') || r4.reason.startsWith('corpus-unreadable'), r4.reason);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 否定用例：扫描器定位不到 meta-cc ⇒ null（⛔ 不是「这台机器没有重复失败」）。
test('locateMetaCcMcp: 无候选 ⇒ null；QUAY_META_CC_MCP 指向不存在 ⇒ 不采信', () => {
  assert.equal(locateMetaCcMcp({ QUAY_META_CC_MCP: '/nonexistent/meta-cc-mcp' }, '/nonexistent-home'), null);
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-afr-home-'));
  try {
    assert.equal(locateMetaCcMcp({}, fakeHome), null, '没有 cache 也没有 ~/.local/bin ⇒ null，⛔ 不抛');
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
