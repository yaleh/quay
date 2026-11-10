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
  supersedeRelations,
  DIVERGENCE_HANDLER_KIND,
  attachDivergenceHandlers,
  handlerStateFor,
  computeDivergenceRecurrence,
  extractJudgeRounds,
  readMetaCarrier,
  divergenceKey,
  proposalCandidateText,
  existingProposalKeys,
  proposalBoardStatus,
  nextAcId,
  nextSequenceId,
  parseProbeOutput,
  fileProposals,
  writeDraftProposal,
  buildProbePrompt,
  readingsDigest,
  META_DRIVER_READINGS_REL,
  META_DRIVER_READINGS_MANIFEST_REL,
  META_DRIVER_READINGS_PARTS_REL,
  READ_TOOL_MAX_BYTES,
  READINGS_PART_BUDGET_BYTES,
  shardReadings,
  packReadingsParts,
  writeReadingsParts,
  collectSyncHealth,
  stripEvidenceTimestamp,
  settleEvidenceWrites,
  resolveEvidence,
  readEvidenceForGate,
  driveItems,
  findOwningTasks,
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
  goalRingRoundAborted,
  readRoundCarrier,
  GOAL_ROUND_CARRIER_REL,
  SPAWN_ZERO_OUTPUT_THRESHOLD,
  VERDICT_UNCHANGED_THRESHOLD,
  aggregateActionFailures,
  errorSignature,
  extractActionFailureRecords,
  describeResultShape,
  readingsDigestPartsForActionFailures,
  collectParkingReadings,
  readingsDigestPartsForParking,
  readingsTopLevelKeys,
  undeclaredReadingsKeys,
  probeKeyBlock,
  declarationDensity,
  META_ROUND_READINGS_INTERFACE,
  parseDurationMs,
  readActionRecordConfig,
  readActionRecordScan,
  collectActionRecordFailures,
  scanActionRecords,
  locateMetaCcMcp,
  ACTION_RECORD_SCAN_REL,
  ACTION_RECORD_EXTRACTOR_ID,
  goalStoreArgv,
} from '../scripts/meta-driver.ts';
import { createMetaStore } from '../../packages/quay/src/meta-store.ts';
// 停放载体的路径单一真相源（⛔ 测试里不重拼字面量：重拼一份就等于允许生产方换路径而测试仍绿）。
import { PARKING_READING_REL, readUnparkDeclaration } from '../scripts/needs-human-parking-recheck.ts';
// 派发池自己的 PARKED 读者（gap-meta-renderhumancallbody）：判「裁定任务会不会进待派池」必须用
// 那个唯一的排除半边本身，⛔ 不在测试里重写一份正则（重写的判据测的是抄写，不是行为）。
import { isParked } from '../scripts/ready-pool-check.ts';
// 全局天花板的单一真相源：载体相对路径（probe-routine.ts）与配置读取面（driver-config.ts）。
import { ROUTINE_FINDINGS_REL } from '../scripts/probe-routine.ts';
import { routineGlobalCeiling, routineWindowMs } from '../scripts/driver-config.ts';
// 读回 supersedes 用 store 自己的投影（⛔ 不 grep 落盘文本：字段名在 YAML 里的排版是序列化细节，
// 断言它会把「字段没写进去」与「排版变了」混为一谈）。
import { createGoalStore } from '../../packages/quay/src/core/goal-store.ts';

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

// gap-meta-goaldriverchildtimeoutms: a COMMITTED AC whose criterion could not be run must be
// ESCALATED, not silently dropped. Before this, `not-evaluated` fell through every branch and
// produced no divergence at all — the 2026-10-21T04:08:39Z AC-911 reading was `not-evaluated` and
// nothing told any handler it could not be measured. ⛔ It is granted its OWN kind, never re-used
// as pass/fail (hard rule 3b).
test('computeDivergences: verdict=not-evaluated ⇒ 独立 kind "not-evaluated"（⛔ 不是 pass/fail 类）', () => {
  const d = computeDivergences([
    { id: 'AC-005', title: null, goal: 'GOAL-001', status: 'active', criterion: 'x', verdict: 'not-evaluated', reason: 'spawn error', cause: 'spawn' },
  ]);
  assert.equal(d.length, 1, '承诺态 + not-evaluated ⇒ 必须产生一条偏离（否则无人知晓它没被测）');
  assert.equal(d[0].kind, 'not-evaluated');
  assert.notEqual(d[0].kind, 'pass-but-unflipped');
  assert.notEqual(d[0].kind, 'achieved-but-failing');
  assert.notEqual(d[0].kind, 'no-criterion');
  // achieved 侧同样报——「已经宣称兑现」的判据测不了，与 active 同样需要处理者。
  const achieved = computeDivergences([
    { id: 'AC-006', title: null, goal: 'GOAL-001', status: 'achieved', criterion: 'x', verdict: 'not-evaluated', reason: 'timeout', cause: 'timeout' },
  ]);
  assert.equal(achieved[0]?.kind, 'not-evaluated');
  // 负控制（防放宽）：非承诺态 + not-evaluated 仍不报——draft/retired 没有「该测却没测」的承诺。
  assert.deepEqual(computeDivergences([
    { id: 'AC-007', title: null, goal: 'GOAL-001', status: 'draft', criterion: 'x', verdict: 'not-evaluated', reason: 'spawn error', cause: 'spawn' },
  ]), []);
  assert.deepEqual(computeDivergences([
    { id: 'AC-008', title: null, goal: 'GOAL-001', status: 'retired', criterion: 'x', verdict: 'not-evaluated', reason: 'spawn error', cause: 'spawn' },
  ]), []);
  // 无判据优先于 not-evaluated（既缺判据又没跑成 ⇒ 报更可操作的 no-criterion）。
  assert.equal(computeDivergences([
    { id: 'AC-009', title: null, goal: 'GOAL-001', status: 'active', criterion: '', verdict: 'not-evaluated', reason: 'x', cause: 'usage' },
  ])[0]?.kind, 'no-criterion');
});

// draft = 提案不是承诺（实测：meta-driver 自己提的 AC-180 曾被报成 pass-but-unflipped）。
test('computeDivergences: draft 记录一律不算偏离（提案 ≠ 未兑现的承诺）', () => {
  const d = computeDivergences([
    { id: 'AC-900', title: null, goal: 'GOAL-001', status: 'draft', criterion: 'true', verdict: 'pass', reason: 'ok' },
    { id: 'AC-901', title: null, goal: 'GOAL-001', status: 'draft', criterion: '', verdict: 'fail', reason: 'no criterion' },
  ]);
  assert.equal(d.length, 0, 'draft 既不报 pass-but-unflipped 也不报 no-criterion');
});

// gap-meta-active-but-failing: an ACTIVE AC whose criterion FAILS is an unmet commitment, and it
// used to fall through EVERY branch — the commitment filter let it in, the `pass` and `achieved`
// branches each keyed on the other status, and `not-evaluated` did not apply ⇒ silent. Measured
// 2026-11-08T10:45:02Z: AC-936 (the only unachieved AC of the only active goal) had held `fail`
// for 290 consecutive `timeSeries` rounds (crossed:true) while `divergences` was `[]`.
// ⛔ Its OWN kind: the record is consistent here (active + failing is not a lie) and the criterion
// WAS measured — so neither `achieved-but-failing` nor `not-evaluated` (hard rule 3b).
test('computeDivergences: active 但 criterion 失败 ⇒ 独立 kind "active-but-failing"（旧实现返回 []）', () => {
  const d = computeDivergences([
    { id: 'AC-T', title: null, goal: 'GOAL-T', status: 'active', criterion: 'false', verdict: 'fail', reason: 'exit 1' },
  ]);
  assert.equal(d.length, 1, 'active + fail ⇒ 必须产生一条偏离（否则「承诺未兑现」在 divergences 里隐形）');
  assert.equal(d[0].kind, 'active-but-failing');
  assert.equal(d[0].id, 'AC-T');
  assert.equal(d[0].status, 'active');
  assert.equal(d[0].verdict, 'fail');
  assert.equal(d[0].reason, 'exit 1', 'reason 必须原样带出判据的执行结果');
  // 负控（防放宽）：
  // ① achieved + pass 一致 ⇒ 仍零条
  assert.deepEqual(computeDivergences([
    { id: 'AC-U', title: null, goal: 'GOAL-T', status: 'achieved', criterion: 'true', verdict: 'pass', reason: 'ok' },
  ]), []);
  // ② active + pass 仍是旧的 pass-but-unflipped（⛔ 不得被新分支抢走）
  assert.equal(computeDivergences([
    { id: 'AC-V', title: null, goal: 'GOAL-T', status: 'active', criterion: 'true', verdict: 'pass', reason: 'ok' },
  ])[0]?.kind, 'pass-but-unflipped');
  // ③ 非承诺态 + fail 仍不报——新 kind 不得成为 draft/retired/superseded 的入口
  for (const status of ['draft', 'retired', 'superseded']) {
    assert.deepEqual(computeDivergences([
      { id: 'AC-W', title: null, goal: 'GOAL-T', status, criterion: 'false', verdict: 'fail', reason: 'exit 1' },
    ]), [], `${status} + fail 不是「承诺未兑现」`);
  }
});

test('DIVERGENCE_HANDLER_KIND: 第六类映射 none（goal 只在 pass 时翻、worker 要已有 task——两者都不成立）', () => {
  assert.equal(DIVERGENCE_HANDLER_KIND['active-but-failing'], 'none');
  const routed = attachDivergenceHandlers(computeDivergences([
    { id: 'AC-T', title: null, goal: 'GOAL-T', status: 'active', criterion: 'false', verdict: 'fail', reason: 'exit 1' },
  ]), [{ kind: 'goal', running: true, carrierRecords: 1, staleSecs: 0, carrierUnreadable: [] }]);
  // ⛔ 不得因为 goal-driver 在跑就报成 healthy：goal-driver 只在判据 pass 时翻 achieved，
  //    对一个 fail 的判据它结构上什么也不做；报 healthy 会让 probe 按瞬时窗口压掉这条读数，
  //    正是那 290 轮沉默的成因。
  assert.deepEqual(routed[0].handler, { kind: 'none', state: 'absent' });
});

// ── computeDivergences: 第五类（跨 AC） ──────────────────────────────────────
// tasks/gap-ac940-exit-condition-contradiction。既有四类逐条只看【单条】AC 的 status×verdict，
// 结构上表达不了「AC-934 achieved ∧ AC-938（声明取代它）active」这种【跨 AC】矛盾——实测
// 2026-11-06 判据 exit 1，而 readings.divergences 为空。本类只声明读数（谁声明取代谁、双方此刻
// 各自状态），是否良性归语义半；确定性逃逸口 = 让替代者达成，或把旧 AC 退役。
const mkCrit = (id, status, extra = {}) => ({
  id, title: null, goal: 'GOAL-914', status, criterion: 'true', verdict: 'fail', reason: 'r',
  supersedes: [], supersededBy: [], ...extra,
});
const supersederKind = (ds) => ds.filter((d) => d.kind === 'achieved-but-superseder-unmet');

test('computeDivergences(a): 旧 AC achieved + 替代者 active ⇒ 恰一条新 kind（id=旧 AC，reason 点名替代者与状态）', () => {
  const d = computeDivergences([
    mkCrit('AC-934', 'achieved'),
    mkCrit('AC-938', 'active', { supersedes: ['AC-934'] }),
    mkCrit('AC-999', 'active'),
  ]);
  const got = supersederKind(d);
  assert.equal(got.length, 1, 'achieved 旧 AC + 未达成的替代者 ⇒ 必须恰一条');
  assert.equal(got[0].id, 'AC-934', '偏离挂在【被反证的旧 AC】上，不是替代者');
  assert.equal(got[0].status, 'achieved');
  assert.match(got[0].reason, /AC-938/, 'reason 必须点名替代者');
  assert.match(got[0].reason, /status=active/, 'reason 必须给出替代者此刻的状态');
});

test('computeDivergences(b): 替代者已 achieved ⇒ 零条（矛盾消解，确定性逃逸口之一）', () => {
  const d = computeDivergences([
    mkCrit('AC-934', 'achieved'),
    mkCrit('AC-938', 'achieved', { supersedes: ['AC-934'] }),
  ]);
  assert.deepEqual(supersederKind(d), []);
});

test('computeDivergences(c): 旧 AC 仍是 active ⇒ 零条（未被宣称兑现，就没有被反证的 achieved）', () => {
  const d = computeDivergences([
    mkCrit('AC-934', 'active'),
    mkCrit('AC-938', 'active', { supersedes: ['AC-934'] }),
  ]);
  assert.deepEqual(supersederKind(d), []);
});

test('computeDivergences(d): 无 supersede 关系 ⇒ 零条（关系本身不是矛盾，但没有关系更没有矛盾）', () => {
  const d = computeDivergences([mkCrit('AC-934', 'achieved'), mkCrit('AC-938', 'active')]);
  assert.deepEqual(supersederKind(d), []);
});

test('computeDivergences(e): 单向 / 双向漂移各一例——两向并集都成立，direction 把漂移显式化', () => {
  // 只写 supersedes 一侧（实测形态：AC-938.supersedes=[AC-934]，AC-934.supersededBy 为空）
  const oneWay = supersederKind(computeDivergences([
    mkCrit('AC-934', 'achieved'),
    mkCrit('AC-938', 'active', { supersedes: ['AC-934'] }),
  ]));
  assert.equal(oneWay.length, 1, '单向声明也必须被看见（⛔ 不得静默当成「没有关系」）');
  assert.match(oneWay[0].reason, /direction:one-way/);
  // 只写 superseded-by 一侧：反方向的单边同样成立
  const reverseOnly = supersederKind(computeDivergences([
    mkCrit('AC-934', 'achieved', { supersededBy: ['AC-938'] }),
    mkCrit('AC-938', 'active'),
  ]));
  assert.equal(reverseOnly.length, 1);
  assert.match(reverseOnly[0].reason, /direction:one-way/);
  // 两向都写 ⇒ 同一条关系，但漂移标记为 two-way
  const twoWay = supersederKind(computeDivergences([
    mkCrit('AC-934', 'achieved', { supersededBy: ['AC-938'] }),
    mkCrit('AC-938', 'active', { supersedes: ['AC-934'] }),
  ]));
  assert.equal(twoWay.length, 1, '两向声明是【同一条】关系，⛔ 不重复计数');
  assert.match(twoWay[0].reason, /direction:two-way/);
});

test('computeDivergences(e2): 关系记录在整批读数里是可见对象（supersedeRelations 可枚举、去重、按 id 稳定排序）', () => {
  const rels = supersedeRelations([
    mkCrit('AC-002', 'achieved', { supersededBy: ['AC-003'] }),
    mkCrit('AC-003', 'active', { supersedes: ['AC-002', 'AC-001'] }),
    mkCrit('AC-001', 'active'),
  ]);
  assert.deepEqual(rels, [
    { oldId: 'AC-001', newId: 'AC-003', twoWay: false },
    { oldId: 'AC-002', newId: 'AC-003', twoWay: true },
  ]);
});

test('computeDivergences(f): 既有四类行为不变——同输入下只多出新增类，旧条目逐条逐字段相同', () => {
  const readings = [
    mkCrit('AC-201', 'active', { criterion: 'true', verdict: 'pass' }),
    mkCrit('AC-202', 'achieved', { criterion: 'true', verdict: 'fail' }),
    mkCrit('AC-203', 'active', { criterion: '' }),
    mkCrit('AC-204', 'achieved', { verdict: 'not-evaluated', cause: 'timeout' }),
    mkCrit('AC-205', 'active', { supersedes: ['AC-204'] }),
  ];
  const d = computeDivergences(readings);
  const old = d.filter((x) => x.kind !== 'achieved-but-superseder-unmet' && x.kind !== 'active-but-failing');
  assert.deepEqual(old, [
    { id: 'AC-201', status: 'active', verdict: 'pass', reason: 'r', kind: 'pass-but-unflipped' },
    { id: 'AC-202', status: 'achieved', verdict: 'fail', reason: 'r', kind: 'achieved-but-failing' },
    { id: 'AC-203', status: 'active', verdict: 'fail', reason: 'r', kind: 'no-criterion' },
    { id: 'AC-204', status: 'achieved', verdict: 'not-evaluated', reason: 'r', kind: 'not-evaluated' },
  ]);
  // 新增类只对 AC-204 触发（它 achieved 且被 AC-205 声明取代、AC-205 未达成）⇒ 追加在末尾
  assert.equal(d.length, 6);
  assert.equal(d[5].kind, 'achieved-but-superseder-unmet');
  assert.equal(d[5].id, 'AC-204');
  // 第六类只对 AC-205 触发（active 且判据 fail——本夹具用的是 mkCrit 的默认 verdict:fail），
  // 且在第一遍里按输入顺序产出，故排在跨 AC 判定之前。
  assert.equal(d[4].kind, 'active-but-failing');
  assert.equal(d[4].id, 'AC-205');
});

test('DIVERGENCE_HANDLER_KIND: 第五类映射 none（落地替代者/人退役旧 AC 都不是 driver 一轮能做）', () => {
  assert.equal(DIVERGENCE_HANDLER_KIND['achieved-but-superseder-unmet'], 'none');
  const routed = attachDivergenceHandlers(
    supersederKind(computeDivergences([
      mkCrit('AC-934', 'achieved'),
      mkCrit('AC-938', 'active', { supersedes: ['AC-934'] }),
    ])),
    [{ kind: 'goal', running: true, carrierRecords: 1, staleSecs: 0, carrierUnreadable: [] }],
  );
  // ⛔ 不得因为 goal-driver 在跑就把它报成 healthy（那会把这条读数当瞬时窗口压掉）
  assert.deepEqual(routed[0].handler, { kind: 'none', state: 'absent' });
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

// ── nextSequenceId / 两个薄包装 ───────────────────────────────────────────────
// 唯一的扫描定义在 nextSequenceId（archguard dup 6e19b6d306d82356）；下面三条一起把它的两侧都钉住：
// ① 两个 id 在 fixture 上不变（等价性），② prefix 是字面量而非正则（转义生效），③ digits 真的参与判定。
test('nextSequenceId: max+1 + digits 补零；prefix 只匹配自己的族', () => {
  const records = [{ id: 'AC-001' }, { id: 'AC-179' }, { id: 'GOAL-042' }];
  assert.equal(nextSequenceId(records, 'AC'), 'AC-180');
  assert.equal(nextSequenceId(records, 'GOAL'), 'GOAL-043');
  // digits 同时是「匹配的最短位数」与「补零位数」（旧正则 `\d{3,}` + padStart(3) 的同款耦合）。
  assert.equal(nextSequenceId([{ id: 'AC-0001' }, { id: 'AC-0179' }], 'AC', 4), 'AC-0180');
  assert.equal(nextSequenceId([{ id: 'AC-179' }], 'AC', 4), 'AC-0001');
  assert.equal(nextSequenceId([], 'AC'), 'AC-001');
  // 位数不足的编号不是本族编号（同旧正则的 \d{3,}）——⛔ 不能被当成 max 的来源。
  assert.equal(nextSequenceId([{ id: 'AC-9' }], 'AC'), 'AC-001');
  // 前缀里的正则元字符按字面处理：'A.C' 不得匹配 'AXC-001'。
  assert.equal(nextSequenceId([{ id: 'AXC-001' }], 'A.C'), 'A.C-001');
});

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
  syncHealth: { window: 200, ffSynced: 1, notFf: 2, ffError: 0, semanticBegin: 0, semanticResolved: 0, semanticConflict: 0, semanticAlignFailed: 0, semanticFfFailed: 0, lastDocToDevelop: 'ok', lastEvent: 'doc-develop-sync-not-ff', lastTs: null },
  metaRecords: [],
  // gap-meta-extractnotevaluatedchecker — 三态读数（⛔ 不是 string[]）：这里给「测得、本轮零个」。
  inertCheckers: { evaluated: true, names: [], cause: null },
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

// gap-meta-goaldriverchildtimeoutms: WHICH not-evaluated it is changes the disposition, so `cause`
// belongs in the digest (it is stable per round — ⛔ not a churn source like reason text).
test('readingsDigest: not-evaluated 的 cause 变 ⇒ 摘要变；同一 cause ⇒ 摘要不变', () => {
  const withCause = (cause) => {
    const r = mkReadings('not-evaluated', 'same');
    r.criteria = [{ ...r.criteria[0], cause }];
    return r;
  };
  assert.notEqual(readingsDigest(withCause('spawn')), readingsDigest(withCause('timeout')),
    'spawn（被外层上限杀掉）与 timeout（criterion 自己超时）需要不同的处置 ⇒ 摘要必须不同');
  assert.equal(readingsDigest(withCause('spawn')), readingsDigest(withCause('spawn')), '同一 cause ⇒ 摘要不变（否则变化检测恒为真）');
  // 负控制：reason 文本带着同一 cause 变化时仍不得改变摘要（避免把「文本噪声」当变化）。
  const a = withCause('spawn'); const b = withCause('spawn'); b.criteria[0].reason = 'different text';
  assert.equal(readingsDigest(a), readingsDigest(b));
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

// ── driveItems 收敛到独立 Policy 函数（gap-routine-quota-consumer-convergence AC2）──────────────
// THE DEFECT: driveItems 的 gateFinding 调用把 `recentCount: filed`（本轮局部计数）同时当 per-routine
// 与全局读数，且天花板恒 Infinity ⇒ 全局维度结构性不可能触发。本任务让它读到 drivers.yml 的真实
// 全局天花板、并把全局窗口合计从载体读出（与 probe-routine.ts 的 ① 同一读法）。
function makeMetaQuotaRoot(globalCeiling) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-quota-'));
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', 'scripts', 'drivers.yml'),
    `routine_quota:\n  default_k: 3\n  global_ceiling: ${globalCeiling}\n`, 'utf8');
  // 载体：两个 routine 各立案 2 条 ⇒ 全局窗口合计 4（⛔ 不含 meta-driver 自身，见 driveItems 注释）。
  const ts = new Date(Date.now() - 3_600_000).toISOString();
  const lines = [
    { routine: 'freshness-refresh', filed: 2 },
    { routine: 'semantic-dedup-scan', filed: 2 },
  ].map((s) => JSON.stringify({
    ts, kind: 'filing-round', routine: s.routine, probe: s.routine, runId: `${s.routine}-seed`, evaluated: true,
    candidates: s.filed, filed: Array.from({ length: s.filed }, (_, i) => `${s.routine}-seed-${i}`),
    escalated: [], rejected: [], errors: [],
  }));
  fs.writeFileSync(path.join(root, ROUTINE_FINDINGS_REL), lines.join('\n') + '\n', 'utf8');
  return root;
}

test('driveItems AC2 (red) — 真实全局天花板生效：全局窗口合计触及 global_ceiling ⇒ 拒 `global-rate:`', async () => {
  const root = makeMetaQuotaRoot(4);
  try {
    assert.equal(routineGlobalCeiling(root), 4, '夹具自检：drivers.yml 的 global_ceiling 真的被读到');
    const r = await driveItems(root, [goodItem], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, false, '全局天花板应拦下本条');
    assert.match(r[0].reason, /global-rate:/, '拒绝理由必须是 global-rate:（独立 Policy 函数产出）');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('driveItems AC2 (green control) — 同一夹具把 global_ceiling 调大到不会被触及 ⇒ 接受（⛔ 红不是闸恒红）', async () => {
  const root = makeMetaQuotaRoot(100);
  try {
    assert.equal(routineGlobalCeiling(root), 100);
    const r = await driveItems(root, [goodItem], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, true, r[0].reason);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── driveItems 的 rate 窗口宽度（gap-routine-quota-window-ms-parsed-but-inert AC1(a) 的 meta-driver 半边）──
// THE DEFECT: driveItems 的全局计数此前把窗口硬写成常量 FILING_WINDOW_MS ⇒ `routine_quota.window_ms`
// 改了没用（声明了却不生效的旋钮）。修后全局窗口从 drivers.yml 读出（routineWindowMs(root)）。
// 同一记录（2h 前）、同一输入，唯一变化是窗宽：窄窗（1h）⇒ 不计数 ⇒ 接受；缺省（24h）⇒ 计数 ⇒ 拒。
function makeMetaWindowRoot({ globalCeiling, windowMs, filedAgoMs = 7_200_000 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-window-'));
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin', 'scripts'), { recursive: true });
  const lines = ['routine_quota:', '  default_k: 3', `  global_ceiling: ${globalCeiling}`];
  if (windowMs !== undefined) lines.push(`  window_ms: ${windowMs}`);
  lines.push('');
  fs.writeFileSync(path.join(root, 'plugin', 'scripts', 'drivers.yml'), lines.join('\n'), 'utf8');
  const ts = new Date(Date.now() - filedAgoMs).toISOString();
  const rec = JSON.stringify({
    ts, kind: 'filing-round', routine: 'freshness-refresh', probe: 'freshness-refresh',
    runId: 'freshness-refresh-seed', evaluated: true, candidates: 1,
    filed: ['freshness-refresh-seed-0'], escalated: [], rejected: [], errors: [],
  });
  fs.writeFileSync(path.join(root, ROUTINE_FINDINGS_REL), rec + '\n', 'utf8');
  return root;
}

test('driveItems AC1(a) — 全局计数尊 `window_ms`：1h 窗下 2h 前的记录不计数（缺省 24h 则计数 ⇒ global-rate:）', async () => {
  const narrow = makeMetaWindowRoot({ globalCeiling: 1, windowMs: 3_600_000 });
  try {
    assert.equal(routineWindowMs(narrow), 3_600_000, '夹具自检：drivers.yml 的 window_ms:3600000 真的被读到');
    const r = await driveItems(narrow, [goodItem], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, true,
      `1h 窗下 2h 前的记录在窗外 ⇒ 全局合计 0 < ceiling 1 ⇒ 应接受（实得：${r[0].reason}）`);
  } finally { fs.rmSync(narrow, { recursive: true, force: true }); }

  const wide = makeMetaWindowRoot({ globalCeiling: 1 }); // 唯一变化：不写 window_ms ⇒ 缺省 24h
  try {
    assert.equal(routineWindowMs(wide), 86_400_000, '缺省 ⇒ 24h（迁移兼容，等于旧常量）');
    const r = await driveItems(wide, [goodItem], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, false, '同一记录 24h 窗内 ⇒ 全局合计 1 ≥ ceiling 1 ⇒ 必须拒绝');
    assert.match(r[0].reason, /global-rate:/, '拒绝理由必须是 global-rate:');
  } finally { fs.rmSync(wide, { recursive: true, force: true }); }
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

// gap-meta-synchealth-doc-to-develop-outcome-invisible — doc→develop 的【结局】必须三态可读：
// 拒绝态藏在 bidirectional 事件的字段里，而 lastEvent 只取事件名 ⇒ 阻塞与健康同形 ⇒ 摘要不变 ⇒
// 语义半永不被唤醒（2026-10-31 冻结 30+ 分钟全程静默）。⛔ 不用布尔：布尔的 false 会把
// 「被拒」与「读不懂」压成同一个值（硬规则 3b/6）。
test('collectSyncHealth: lastDocToDevelop 三态派生 —— ok / refused / unknown（三条同时断言）', () => {
  const mk = (name, rows) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `meta-driver-d2d-${name}-`));
    fs.mkdirSync(path.join(dir, '.quay'), { recursive: true });
    if (rows) {
      fs.writeFileSync(path.join(dir, '.quay', 'doc-develop-sync.jsonl'),
        rows.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n');
    }
    return dir;
  };
  const dirs = [];
  try {
    const dOk = mk('ok', [{ ts: '2026-11-06T05:52:20.312Z', event: 'doc-develop-sync-bidirectional', docToDevelop: 'true' }]);
    const dRefused = mk('refused', [{ ts: '2026-10-31T09:41:12.337Z', event: 'doc-develop-sync-bidirectional', docToDevelop: 'false' }]);
    // 第三个目录【有载体但没有该事件】（⛔ 不是「文件不存在」——那会顺带把 unknown 的来源混掉）。
    const dNone = mk('none', [
      { ts: '2026-11-06T05:52:20.000Z', event: 'doc-develop-sync-ff-synced' },
      { ts: '2026-11-06T05:52:21.000Z', event: 'doc-develop-sync-not-ff', benign: true },
    ]);
    dirs.push(dOk, dRefused, dNone);
    const hOk = collectSyncHealth(dOk);
    const hRefused = collectSyncHealth(dRefused);
    const hNone = collectSyncHealth(dNone);
    assert.equal(hOk.lastDocToDevelop, 'ok', 'docToDevelop:"true" ⇒ ok');
    assert.equal(hRefused.lastDocToDevelop, 'refused', 'docToDevelop:"false" ⇒ refused（阻塞中必须可从读数看出）');
    assert.equal(hNone.lastDocToDevelop, 'unknown', '窗口内无该事件 ⇒ unknown（⛔ 不得与 ok 同形）');
    // 前提：拒绝态的 lastEvent 与健康态的事件名同形——正是这个性质让本字段必须存在。
    assert.equal(hRefused.lastEvent, 'doc-develop-sync-bidirectional');
    // 原生布尔（旧/手工事件）两种形态都认。
    const dBool = mk('bool', [{ ts: '2026-11-06T05:52:22.000Z', event: 'doc-develop-sync-bidirectional', docToDevelop: false }]);
    dirs.push(dBool);
    assert.equal(collectSyncHealth(dBool).lastDocToDevelop, 'refused', '原生布尔 false ⇒ refused');
    // 值非布尔 ⇒ unknown（⛔ 不猜：缺键 / 数字 / 别的串都不是「健康」）。
    for (const v of [undefined, 1, 'yes', null]) {
      const dir = mk(`bad-${String(v)}`, [{ ts: '2026-11-06T05:52:23.000Z', event: 'doc-develop-sync-bidirectional', docToDevelop: v }]);
      dirs.push(dir);
      assert.equal(collectSyncHealth(dir).lastDocToDevelop, 'unknown', `docToDevelop=${JSON.stringify(v)} ⇒ unknown（⛔ 不得当成 ok/refused）`);
    }
    // 坏行【在】最后一条 bidirectional 之后 ⇒ unknown（那条坏行可能就是被吞掉的更新事件）。
    const dBadAfter = mk('bad-after', [
      { ts: '2026-11-06T05:52:24.000Z', event: 'doc-develop-sync-bidirectional', docToDevelop: 'true' },
      'THIS IS NOT JSON',
    ]);
    // 坏行【在】之前 ⇒ 后面的好事件把判定覆盖回来（按位置判定，不按「有没有坏行」判定）。
    const dBadBefore = mk('bad-before', [
      'THIS IS NOT JSON',
      { ts: '2026-11-06T05:52:25.000Z', event: 'doc-develop-sync-bidirectional', docToDevelop: 'true' },
    ]);
    dirs.push(dBadAfter, dBadBefore);
    assert.equal(collectSyncHealth(dBadAfter).lastDocToDevelop, 'unknown', '坏行在其后 ⇒ 结局不可知 ⇒ unknown');
    assert.equal(collectSyncHealth(dBadBefore).lastDocToDevelop, 'ok', '坏行在其前 ⇒ 后一条好事件决定结局');
    // 载体整个不存在 ⇒ unknown（⛔ 不填 "ok"：缺值 = 未查，不是为假/为真）。
    const dMissing = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-d2d-missing-'));
    dirs.push(dMissing);
    assert.equal(collectSyncHealth(dMissing).lastDocToDevelop, 'unknown', '载体缺失 ⇒ unknown');
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

// 正臂：其余读数完全相同、只有 lastDocToDevelop 不同 ⇒ 摘要必须不同（否则阻塞发生/结束不会被判读）。
test('readingsDigest 正臂: lastDocToDevelop ok vs refused ⇒ 摘要不同（阻塞开始/结束各判读一次）', () => {
  const withD2D = (v) => {
    const r = mkReadings('pass', 'same');
    r.syncHealth = { ...r.syncHealth, lastDocToDevelop: v };
    return r;
  };
  const ok = withD2D('ok');
  const refused = withD2D('refused');
  // 前提：除该字段外两轮读数逐字相同（否则「摘要不同」可能来自别的变化，正臂就什么也没证明）。
  assert.deepEqual({ ...ok.syncHealth, lastDocToDevelop: null }, { ...refused.syncHealth, lastDocToDevelop: null },
    '前提：只有 lastDocToDevelop 不同');
  assert.notEqual(readingsDigest(ok), readingsDigest(refused),
    'doc→develop 从 ok 变 refused（阻塞开始）必须改变摘要 ⇒ 语义半被唤醒');
  // 反方向同样成立（阻塞结束也要各判读一次）。
  assert.notEqual(readingsDigest(refused), readingsDigest(ok));
  // 字段结构性缺失（旧构建/手工读数）⇒ 与 unknown 同 token，⛔ 不与 ok 同形（硬规则 3b）。
  const missing = mkReadings('pass', 'same');
  delete missing.syncHealth.lastDocToDevelop;
  assert.equal(readingsDigest(missing), readingsDigest(withD2D('unknown')), '缺字段 ⇒ 与 unknown 同形，不与 ok 同形');
  assert.notEqual(readingsDigest(missing), readingsDigest(ok), '缺字段 ⛔ 不得与 ok 同形');
});

// 负臂（消抖）：阻塞持续期间摘要不得变——否则每轮一条同因拒绝都会把语义半叫醒一次（成本事故）。
test('readingsDigest 负臂（消抖）: 同一 refused 阻塞再采集一轮（只多一条同值事件）⇒ 摘要相同', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-d2d-digest-'));
  try {
    const carrier = path.join(dir, '.quay', 'doc-develop-sync.jsonl');
    fs.mkdirSync(path.join(dir, '.quay'), { recursive: true });
    const refusal = (i) => JSON.stringify({
      ts: `2026-10-31T09:${String(16 + i).padStart(2, '0')}:36.000Z`,
      event: 'doc-develop-sync-bidirectional', phase: 'done', developToDoc: 'error', docToDevelop: 'false',
    });
    const write = (n) => fs.writeFileSync(carrier, Array.from({ length: n }, (_, i) => refusal(i)).join('\n') + '\n');
    const readings = () => ({ ...mkReadings('pass', 'same'), syncHealth: collectSyncHealth(dir) });

    write(3);
    const r1 = readings();
    write(4); // 下一轮：同因拒绝再落一条（窗口内只多一条同值 bidirectional 事件）
    const r2 = readings();
    const lineCount = fs.readFileSync(carrier, 'utf8').trim().split('\n').length;
    assert.equal(lineCount, 4, '前提：载体确实多了一条记录（⛔ 不是同一份输入读两次）');
    assert.equal(r1.syncHealth.lastDocToDevelop, 'refused');
    assert.equal(r2.syncHealth.lastDocToDevelop, 'refused');
    assert.equal(r1.syncHealth.lastEvent, r2.syncHealth.lastEvent, '前提：两轮 lastEvent 相同');
    assert.equal(readingsDigest(r1), readingsDigest(r2), '阻塞持续期间摘要必须不变（否则每轮唤醒语义半一次）');

    // 阻塞结束（下一条 bidirectional 的 docToDevelop 变为 true）⇒ 摘要必须变（正方向对照，证明负臂不是恒真）。
    fs.appendFileSync(carrier, JSON.stringify({
      ts: '2026-10-31T09:45:00.000Z', event: 'doc-develop-sync-bidirectional', phase: 'done', docToDevelop: 'true',
    }) + '\n');
    const r3 = readings();
    assert.equal(r3.syncHealth.lastDocToDevelop, 'ok');
    assert.notEqual(readingsDigest(r3), readingsDigest(r2), '阻塞结束 ⇒ 摘要必须变（语义半再判读一次）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
      // 载体观测跑成了且没有读失败 ⇒ 空数组（⛔ null：null 的含义是「观测本身没跑成」）。
      assert.deepEqual(r.carrierUnreadable, [], `${r.kind}: 空工作区没有任何载体 ⇒ 无读失败`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// gap-meta-collectdriverreadings — 活驱动的载体「读不出」不得折成「0 条」（硬规则 3b）。
test('collectDriverReadings: 载体存在但读不出 ⇒ carrierUnreadable 单列（⛔ 与空载体同形）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-drv-unreadable-'));
  try {
    // 目录冒充载体：open 成功、read 报 EISDIR ⇒ 读失败可稳定复现（⛔ 不依赖 chmod/root）。
    fs.mkdirSync(path.join(tmp, '.quay', 'meta-driver-round.jsonl'), { recursive: true });
    const rows = collectDriverReadings(tmp);
    const meta = rows.find((r) => r.kind === 'meta');
    assert.ok(meta, '前提：meta kind 在读数里');
    assert.equal(meta.carrierRecords, 0, '读不出 ⇒ 已读行数 0');
    assert.deepEqual(meta.carrierUnreadable, ['meta-driver-round.jsonl'],
      '「读不出」必须与「载体为空」可区分——改前两者都只是 carrierRecords=0');
    const others = rows.filter((r) => r.kind !== 'meta');
    for (const r of others) assert.deepEqual(r.carrierUnreadable, [], `${r.kind}: 没有该载体 ≠ 读失败`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readingsDigest: carrierUnreadable 进摘要（读失败出现/消失都必须改变结论）；null 与 [] 不同形', () => {
  const mkReading = (carrierUnreadable) => ({
    goals: [], criteria: [], divergences: [], metaRecords: [], inertCheckers: { evaluated: true, names: [], cause: null }, focus: null,
    timeSeries: [],
    actionRecordFailures: MK_AFR_NONE,
    drivers: [{ kind: 'meta', running: true, supervisorAlive: true, driverAlive: true, carrierRecords: 0, carrierLastTs: null, staleSecs: null, carrierUnreadable }],
    syncHealth: { window: 200, ffSynced: 0, notFf: 0, ffError: 0, semanticBegin: 0, semanticResolved: 0, semanticConflict: 0, semanticAlignFailed: 0, semanticFfFailed: 0, lastEvent: null, lastTs: null },
  });
  assert.equal(readingsDigest(mkReading([])), readingsDigest(mkReading([])), '同一读数 ⇒ 摘要不变');
  assert.notEqual(readingsDigest(mkReading([])), readingsDigest(mkReading(['meta-driver-round.jsonl'])),
    '载体由可读变读不出必须改变摘要（否则结论变了而闸不跑）');
  assert.notEqual(readingsDigest(mkReading([])), readingsDigest(mkReading(null)),
    'null（观测没跑成）⛔ 不与 []（全都读完了）同形（硬规则 3b）');
});

// gap-not-evaluated-checkers-never-persisted + gap-meta-extractnotevaluatedchecker — 惰性守卫读数：
// 从 full-suite-state.json 的 notEvaluatedCheckers 逐条枚举名字（⛔ 不是计数）。**三态**：载体读不到
// ⇒ evaluated:false（cause=carrier-absent-or-unreadable）；载体在但**这一维没被记录**
// ⇒ evaluated:false（cause 分两支，见下）；字段是数组 ⇒ evaluated:true（空数组 = 查过、本轮零个）。
// ⛔ 「未测量」与「测得零」必须不同形——旧实现两者都返回 []，生产上镜像载体让读数恒为 []。
//
// gap-meta-inertcheckersreading — 「这一维没被记录」必须**再分两支**：full-suite-runner 起跑就写
// `{state:"running"}` 且不带这一维（full-suite-runner.ts:3608），所以「suite 在飞」与「终态载体丢了
// 这一维（镜像回归）」此前共用一个 `dimension-missing` ⇒ 本轮该维度暗时无法归因到瞬态还是回归。
test('collectInertCheckers: 三态 {evaluated,names,cause}——未测量 ⛔ 不与「测得零」同形', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-inert-'));
  try {
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    // 读不到 state ⇒ 未测量。
    assert.deepEqual(collectInertCheckers(tmp),
      { evaluated: false, names: [], cause: 'carrier-absent-or-unreadable' },
      '无 state 文件 ⇒ evaluated:false（⛔ 不是 []）');
    // 喂一个含 notEvaluatedCheckers 的 state 文件，断言逐条出现。
    fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'), JSON.stringify({
      state: 'green',
      notEvaluatedCheckers: [
        { name: 'direct-to-develop-bypass-check', line: 'STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check' },
        { name: 'threshold-scope-check', line: 'STATIC_CHECK_NOT_EVALUATED: threshold-scope-check' },
      ],
    }), 'utf8');
    assert.deepEqual(collectInertCheckers(tmp),
      { evaluated: true, names: ['direct-to-develop-bypass-check', 'threshold-scope-check'], cause: null },
      '逐条枚举名字（不是计数），且保序');
    // 字段存在但为空数组 ⇒ **测得零**（这是判定，⛔ 不是未测量）。
    fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'), JSON.stringify({ state: 'green', notEvaluatedCheckers: [] }), 'utf8');
    assert.deepEqual(collectInertCheckers(tmp), { evaluated: true, names: [], cause: null },
      '显式空数组 ⇒ evaluated:true + names:[]（查过、一个都没有）');
    // AC1 前半：**在飞**的载体（runner 起跑就落 state:running + finishedAt:null，维度尚未写）
    // ⇒ 独立成因 "suite-in-flight"，⛔ 与回归同形，也 ⛔ 抛错/当成「零个惰性守卫」。
    fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'),
      JSON.stringify({ state: 'running', finishedAt: null, durationMs: null }), 'utf8');
    const inFlight = collectInertCheckers(tmp);
    assert.deepEqual(inFlight,
      { evaluated: false, names: [], cause: 'suite-in-flight' },
      'running state（无该字段）⇒ evaluated:false + cause=suite-in-flight');
    // AC1 后半：**终态**载体缺这一维（镜像写丢了维度）⇒ 仍是 "dimension-missing"（该追因的那一个）。
    // 红态也是终态——但只在 `finishedAt` 有值时（gap-meta-collectinertcheckers：红套件在飞的早红写是
    // `state:"red"` + `finishedAt:null`，见下一个 test，那不是终态）。
    for (const st of ['green', 'red']) {
      fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'),
        JSON.stringify({ state: st, finishedAt: '2026-11-07T00:00:00Z' }), 'utf8');
      assert.deepEqual(collectInertCheckers(tmp),
        { evaluated: false, names: [], cause: 'dimension-missing' },
        `终态 ${st} 缺该维度 ⇒ cause=dimension-missing（⛔ 不是在飞）`);
    }
    // 负控制：两个未测量成因 **互不相同**——否则本任务要的归因能力等于没加。
    const finished = collectInertCheckers(tmp);
    assert.notEqual(inFlight.cause, finished.cause,
      'suite-in-flight 与 dimension-missing 必须不同 token（否则瞬态与回归同形）');
    // 载体没有 state 键（旧载体/手工载体）⇒ ⛔ 不猜成「在飞」：缺维度就读成回归，宁严不宽。
    fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'), JSON.stringify({ finishedAt: '2026-11-07T00:00:00Z' }), 'utf8');
    assert.equal(collectInertCheckers(tmp).cause, 'dimension-missing',
      '无 state 键 ⇒ ⛔ 不推断为在飞（宁严不宽）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// gap-meta-collectinertcheckers — 「非终态」的判别量 ⛔ 不能只有 `state`：full-suite-runner 的**早红写**
// （full-suite-runner.ts:4585，SUITE-RED 要带文件归因）落的是
// `{state:"red", reason:"failed", finishedAt:null, durationMs:null}`，红套件运行期的**整个窗口** `state`
// 都不是 "running"（实测那一轮 durationMs=451212ms）⇒ 旧实现把「还没测到」读成「写者丢了这一维」，
// 每轮抓人报一个不存在的镜像回归。
// 判别量 = 载体自己的终态写者不变式：在飞写 `finishedAt:null`，终态写 `finishedAt`(epoch 秒)。
test('collectInertCheckers: finishedAt 是终态判别量——在飞的红快照 ⛔ 不报 dimension-missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-inert-red-'));
  const write = (o) => fs.writeFileSync(path.join(tmp, '.quay', 'full-suite-state.json'), JSON.stringify(o), 'utf8');
  try {
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    // ① 在飞的红快照（早红写）⇒ suite-in-flight（本任务要的那一格）。
    write({ state: 'red', reason: 'failed', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: null, durationMs: null, failures: [] });
    const earlyRed = collectInertCheckers(tmp);
    assert.deepEqual(earlyRed, { evaluated: false, names: [], cause: 'suite-in-flight' },
      '红套件在飞（state:"red" + finishedAt:null）⇒ suite-in-flight（⛔ 不是 dimension-missing）');
    // ② 负控制：同一 state:"red"、`finishedAt` 有值 ⇒ 终态缺维度，仍必须报 dimension-missing。
    //    （防止实现把「一切 red」都翻成在飞——那会把真正的镜像回归静音。）
    write({ state: 'red', reason: 'failed', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: 1794129259, durationMs: 451212, failures: [] });
    const terminalRed = collectInertCheckers(tmp);
    assert.deepEqual(terminalRed, { evaluated: false, names: [], cause: 'dimension-missing' },
      '终态红（finishedAt 有值）缺该维度 ⇒ dimension-missing');
    assert.notEqual(earlyRed.cause, terminalRed.cause,
      '同为 state:"red"，在飞与终态必须不同 token（否则本任务只是换了个同形）');
    // ③ 在飞的红快照与在飞的 running 快照是**同一态**（都「还没跑完」）——⛔ 不新增第四个 token。
    write({ state: 'running', finishedAt: null, durationMs: null });
    assert.equal(collectInertCheckers(tmp).cause, earlyRed.cause,
      'running 在飞与 early-red 在飞共享 suite-in-flight（同一件事：还没终态）');
    // ④ 只带 `finishedAt:null`（无 state）⇒ 仍是在飞：终态写者不变式本身即充分信号。
    write({ finishedAt: null });
    assert.equal(collectInertCheckers(tmp).cause, 'suite-in-flight',
      'finishedAt 显式 null ⇒ 在飞（不依赖 state）');
    // ⑤ 旧载体只带 `state:"running"`（无 finishedAt 键）⇒ 保留在飞（gap-meta-inertcheckersreading 的判据）。
    write({ state: 'running' });
    assert.equal(collectInertCheckers(tmp).cause, 'suite-in-flight',
      '只有 state:"running" 的旧载体 ⇒ 仍判在飞（两条信号取并集）');
    // ⑥ 两个信号都没有（`{}` / 只有终态 state 但无 finishedAt 键）⇒ ⛔ 不猜成在飞，按终态缺维度（宁严不宽）。
    write({});
    assert.equal(collectInertCheckers(tmp).cause, 'dimension-missing',
      '空载体 ⇒ 不推断为在飞（宁严不宽）');
    write({ state: 'green' });
    assert.equal(collectInertCheckers(tmp).cause, 'dimension-missing',
      '无 finishedAt 键 ⇒ 不推断为在飞（宁严不宽）');
    // ⑦ 维度在场时状态照常被读（字段优先于 state：数组分支在判别之前）。
    write({ state: 'red', finishedAt: null, notEvaluatedCheckers: [{ name: 'x' }] });
    assert.deepEqual(collectInertCheckers(tmp), { evaluated: true, names: ['x'], cause: null },
      '字段在场 ⇒ evaluated:true（与在飞/终态无关）');
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
  const measured = (names) => ({ evaluated: true, names, cause: null });
  const unmeasured = { evaluated: false, names: [], cause: 'dimension-missing' };
  assert.equal(readingsDigest(mk(measured([]))), readingsDigest(mk(measured([]))), '空 = 空');
  assert.notEqual(readingsDigest(mk(measured([]))), readingsDigest(mk(measured(['direct-to-develop-bypass-check']))),
    '惰性守卫从无到有必须改变摘要');
  assert.notEqual(readingsDigest(mk(measured(['direct-to-develop-bypass-check']))), readingsDigest(mk(measured(['threshold-scope-check']))),
    '不同的惰性守卫必须改变摘要（逐名进，⛔ 只进计数会让换 guard 不改变摘要）');
  // gap-meta-extractnotevaluatedchecker — 「未测量」与「测得零」必须改变摘要：否则从「这一维没测到」
  // 变成「查过、一个都没有」这种结论变更在摘要里不可见 ⇒ 语义半不会被唤醒去读它。
  assert.notEqual(readingsDigest(mk(measured([]))), readingsDigest(mk(unmeasured)),
    '未测量（evaluated:false）⛔ 不与「查过、零个」同形');
  // gap-meta-inertcheckersreading — **两个未测量成因也必须改变摘要**：否则「suite 在飞」→「终态缺维度
  // （镜像回归）」这次归因变更在摘要里不可见 ⇒ 语义半不被唤醒 ⇒ 本任务加的那一支等于到不了消费者。
  const inFlight = { evaluated: false, names: [], cause: 'suite-in-flight' };
  assert.notEqual(readingsDigest(mk(inFlight)), readingsDigest(mk(unmeasured)),
    '「在飞」与「维度缺失（回归）」必须改变摘要');
  assert.equal(readingsDigest(mk(inFlight)), readingsDigest(mk(inFlight)), '同一成因 = 同一摘要（⛔ 恒变）');
});

// 负控制：摘要必须对【每轮都变的量】免疫——staleSecs/记录数每轮都不同，若进摘要则闸失效。
test('readingsDigest: 不随 staleSecs/carrierRecords 变（否则变化检测恒为真）', () => {
  const mk = (stale, records) => ({
    goals: [], criteria: [], divergences: [], metaRecords: [], inertCheckers: { evaluated: true, names: [], cause: null }, focus: null,
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
// 一个字段齐全、且足够大的 MetaRoundReadings 夹具（长 reason 文本模拟生产里 >1MB 的真实读数）。
function largeReadings(n = 1500) {
  const reason = 'criterion failing detail: '.repeat(60); // ~1500 字符/条 ⇒ 合计 ~2.2MB
  const criteria = Array.from({ length: n }, (_, i) => ({
    id: `AC-${String(i).padStart(4, '0')}`,
    title: `criterion ${i}`,
    goal: 'GOAL-001',
    status: 'active',
    criterion: 'true',
    verdict: 'fail',
    reason,
    cause: null,
  }));
  return {
    goals: [{ id: 'GOAL-001', title: 't', status: 'active' }],
    criteria,
    divergences: [],
    drivers: [{
      kind: 'goal', running: true, supervisorAlive: true, driverAlive: true,
      carrierRecords: 1, carrierLastTs: null, staleSecs: 0, carrierUnreadable: [],
    }],
    syncHealth: {
      window: 200, ffSynced: 0, notFf: 0, notFfBenign: 0, notFfBehind: 0, ffError: 0,
      semanticBegin: 0, semanticResolved: 0, semanticConflict: 0, semanticAlignFailed: 0,
      semanticFfFailed: 0, semanticTakeDevelopRefused: 0, lastEvent: null, lastTs: null,
    },
    metaRecords: [],
    inertCheckers: { evaluated: true, names: [], cause: null },
    focus: null,
    timeSeries: [],
    actionRecordFailures: {
      state: 'none', aggregates: [], reason: null, scannedAt: null, scanMs: null, since: null,
      recordsScanned: null, thresholdSessions: null,
    },
  };
}

/** prompt 里被点名、且**真实存在**的读数文件——与 gap-meta-buildprobeprompt 的 AC 同一条提取谓词：
 *  按空白切词、去掉行尾逗号/分号、只保留以 `/` 开头的真实文件（硬规则 2：复用一个谓词，不各写一份）。 */
function namedReadingsFiles(prompt) {
  return [...new Set(prompt.split(/\s+/).map((t) => t.replace(/[,;]+$/, '')).filter((t) => t.startsWith('/')))]
    .filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

/** 按 part 文件自带的 `note` 语义重建 readings：数组切片按 `range[0]` 落位（连续区间即拼接）、
 *  字符串切片按 `range` 升序拼接、`range: null` 即完整值。用例用它证明「切片合起来仍是完整读数」。 */
function rebuildFromParts(partFiles) {
  const shards = partFiles.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).shards);
  const byPath = new Map();
  for (const s of shards) {
    if (s.range === null) { byPath.set(s.path, s.value); continue; }
    const prev = byPath.get(s.path);
    if (s.kind === 'array') {
      const arr = prev ?? new Array(s.total).fill(undefined);
      s.value.forEach((v, i) => { arr[s.range[0] + i] = v; });
      byPath.set(s.path, arr);
    } else {
      byPath.set(s.path, (prev ?? '') + s.value);
    }
  }
  const out = {};
  const depth = (p) => p.split(/[.[]/).filter(Boolean).length;
  // 由浅到深落位：数组切片先建容器，再填 `path[i].field` 这类个体切片。
  for (const [p, value] of [...byPath.entries()].sort((a, b) => depth(a[0]) - depth(b[0]))) {
    const segs = p.replace(/\[(\d+)\]/g, '.$1').split('.');
    let cur = out;
    for (let i = 0; i < segs.length - 1; i += 1) {
      if (cur[segs[i]] === undefined) cur[segs[i]] = /^\d+$/.test(segs[i + 1]) ? [] : {};
      cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = value;
  }
  return out;
}

test('buildProbePrompt: 大 readings 只落盘路径+摘要，prompt 不再内联全量 JSON（AC1/AC3/DoD）', () => {
  const readings = largeReadings();
  const fullJson = JSON.stringify(readings);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-readings-'));
  const p = buildProbePrompt('OBJECTIVE TEXT', readings, { root });
  // AC3：prompt 不再内联全量 JSON——任何一条 criterion / 长 reason 文本都不出现。
  assert.ok(p.startsWith('OBJECTIVE TEXT'));
  assert.ok(!p.includes('"AC-0000"'), 'prompt 不得再内联任何一条 criterion 的 JSON');
  assert.ok(!p.includes(readings.criteria[0].reason.slice(0, 40)), 'prompt 不得再内联长 reason 文本');
  assert.ok(!p.includes('"verdict"'), 'prompt 不得再内联 readings 的 JSON 结构');
  // AC3：prompt 只有路径 + 摘要。
  assert.ok(p.includes('readings manifest:'), 'prompt 必须给出切片清单路径');
  assert.ok(p.includes('readings digest:'), 'prompt 必须给出机械摘要');
  // AC1：较基线（= 旧 prompt 的 readings JSON 部分）下降 ≥80%，且 <50KB（取更严者）。
  const reduction = 1 - p.length / fullJson.length;
  assert.ok(p.length < fullJson.length * 0.2,
    `prompt ${p.length} 字符应 < 基线 20%（基线 readings JSON = ${fullJson.length} 字符；实测下降 ${(reduction * 100).toFixed(1)}%）`);
  assert.ok(p.length < 50_000, `prompt ${p.length} 字符应 < 50KB`);
  // DoD：落盘文件可还原完整读数（与旧内联的是同一份 JSON.stringify 语义）。
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, META_DRIVER_READINGS_REL), 'utf8'));
  assert.deepEqual(onDisk, JSON.parse(fullJson), '落盘文件必须逐结构还原完整 readings');
  fs.rmSync(root, { recursive: true, force: true });
});

// gap-meta-buildprobeprompt —— 缺陷本体：单文件实测 753,799 B > Read 工具的 262,144 B 上限，
// 于是 prompt 里那句「Read that file」在**需要数字的那一轮**机械不可读。修法不是内联、也不是少给
// 读数，而是把它切成一组每片都读得到的文件，合起来仍是同一份 readings。
test('gap-meta-buildprobeprompt AC: prompt 点名的读数文件都存在/都 < 256KB/合起来带全量读数', () => {
  const criteria = Array.from({ length: 1200 }, (_, i) => ({
    id: `AC-${i}`, title: 'SENTINEL-READINGS-MARKER', goal: 'GOAL-000', status: 'achieved',
    criterion: 'true', verdict: 'pass', reason: 'x'.repeat(600), cause: null, supersedes: [], supersededBy: [],
  }));
  const readings = {
    goals: [{ id: 'GOAL-000', title: 't', status: 'active' }], criteria, divergences: [], drivers: [],
    syncHealth: { lastEvent: 'none', lastDocToDevelop: 'ok' }, metaRecords: [], inertCheckers: { evaluated: true, names: [], cause: null },
    timeSeries: [], actionRecordFailures: { state: 'none', aggregates: [] }, parking: {}, focus: null,
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-'));
  const prompt = buildProbePrompt('objective', readings, { root });
  const named = namedReadingsFiles(prompt);
  assert.ok(named.length >= 1, 'prompt 必须点名至少一个真实存在的读数文件');
  assert.ok(named.map((f) => fs.readFileSync(f, 'utf8')).join('\n').includes('SENTINEL-READINGS-MARKER'),
    '被点名的文件必须真的带读数内容（⛔ 不是点了个空壳）');
  const over = named.filter((f) => fs.statSync(f).size >= 262144);
  assert.deepEqual(over.map((f) => `${f} ${fs.statSync(f).size}`), [],
    'prompt ⛔ 不得点名超过 Read 工具 256KB 上限的文件');
  // 点名的文件**合起来仍是完整 readings**（⛔ 不是靠丢字段把文件变小）。
  const manifest = JSON.parse(fs.readFileSync(path.join(root, META_DRIVER_READINGS_MANIFEST_REL), 'utf8'));
  assert.deepEqual(rebuildFromParts(manifest.parts.map((x) => x.file)), readings, '切片必须能重建完整读数');
  fs.rmSync(root, { recursive: true, force: true });
});

// 负控制（DoD「判据本身能取假」）：这个夹具下**单文件本身就超上限** ⇒ 若实现退回「点名单文件」，
// 上面那条 AC 必须红。这里把该臂单独钉住，避免它变成一条永远为真的装饰。
test('gap-meta-buildprobeprompt 负控制: 同一夹具的单文件超上限 ⇒ 退回点名单文件必被判红', () => {
  const readings = largeReadings();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-neg-'));
  try {
    buildProbePrompt('objective', readings, { root });
    const single = path.join(root, META_DRIVER_READINGS_REL);
    assert.ok(fs.statSync(single).size >= READ_TOOL_MAX_BYTES,
      `夹具必须真复现缺陷：单文件 ${fs.statSync(single).size} B 应 ≥ ${READ_TOOL_MAX_BYTES} B`);
    // 把 prompt 指回单文件 ⇒ 同一条谓词的「超限」臂命中（这就是修复前每轮的形状）。
    const regressed = namedReadingsFiles(`readings file: ${single}`);
    assert.equal(regressed.filter((f) => fs.statSync(f).size >= READ_TOOL_MAX_BYTES).length, 1,
      '谓词必须能把「点名超限文件」判红，否则 AC 只是装饰');
    // 而真实 prompt 里那个路径**不得**出现（修复后的形状）。
    const real = buildProbePrompt('objective', readings, { root });
    assert.ok(!namedReadingsFiles(real).includes(single), '修复后 prompt ⛔ 不得再点名单文件');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildProbePrompt: 无 root 时不落盘、prompt 明示未持久化（⛔ 不内联兜底）', () => {
  const readings = largeReadings(3);
  const p = buildProbePrompt('OBJECTIVE TEXT', readings);
  assert.ok(p.startsWith('OBJECTIVE TEXT'));
  assert.ok(!p.includes('"AC-0000"'), '无 root 时也不得内联 readings JSON');
  assert.ok(p.includes('(not persisted this round)'), '未落盘必须明示，而不是伪装成落盘了');
});

// 切片本身的两条性质：①小读数不被无谓地切碎（这条让「切了」与「没必要切」可区分，硬规则 3b）；
// ②单个超长字符串字段按字符切——否则一个 >预算 的字符串会让整个 part 超 Read 上限。
test('shardReadings: 小读数 = 单条完整值切片（⛔ 不无谓切碎）；超长字符串按字符切片且逐字可还原', () => {
  const small = shardReadings({ goals: [{ id: 'GOAL-1' }], focus: null });
  assert.equal(small.length, 1);
  assert.deepEqual(small[0], { path: '', kind: 'value', range: null, total: null, value: { goals: [{ id: 'GOAL-1' }], focus: null } });

  const text = 'z'.repeat(300_000);
  const shards = shardReadings({ focus: text });
  const stringShards = shards.filter((s) => s.kind === 'string');
  assert.ok(stringShards.length >= 2, '超长字符串必须被切成多片');
  assert.equal(stringShards.map((s) => s.value).join(''), text, '按 range 升序拼接必须逐字还原');
  for (const s of stringShards) {
    assert.ok(Buffer.byteLength(JSON.stringify(s), 'utf8') < READINGS_PART_BUDGET_BYTES,
      '单片（含 envelope）必须 < part 预算');
  }
  for (const group of packReadingsParts(shards)) {
    assert.ok(Buffer.byteLength(JSON.stringify({ part: 999, of: 999, note: '', shards: group }, null, 2), 'utf8') < READINGS_PART_BUDGET_BYTES,
      '打包后的每个 part 必须 < 预算（那是 Read 上限的一半）');
  }
});

// 上一轮切出的 part 文件数与本轮不同 ⇒ 必须整目录重建：残留的 part-NNN 会让按 manifest 读的 probe
// 读到过期切片（硬规则 3b：读到的必须是本轮读数，⛔ 不是上一轮的）。
test('writeReadingsParts: 整目录重建，上一轮多出来的 part 不残留', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-parts-'));
  try {
    const big = writeReadingsParts(root, largeReadings());
    assert.ok(big.partCount > 1, '大读数必须切出多片');
    const dir = path.join(root, META_DRIVER_READINGS_PARTS_REL);
    assert.ok(fs.readdirSync(dir).length > 2);
    const small = writeReadingsParts(root, largeReadings(2));
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, [...small.parts.map((p) => path.basename(p.file)), 'manifest.json'].sort(),
      '目录里只允许存在本轮 manifest 与它点名的 part');
    for (const p of small.parts) assert.ok(p.bytes <= READINGS_PART_BUDGET_BYTES);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// AC2：parseProbeOutput 输出形状与改动前同构（parity 测试——probe 瘦身后解析面不受影响）。
test('parseProbeOutput parity: 大 readings 瘦身后，probe 输出解析形状不变（AC2）', () => {
  const out = parseProbeOutput(JSON.stringify({
    divergences: [{ id: 'AC-0001', kind: 'pass-but-unflipped', interpretation: 'x', recommendation: 'y' }],
    proposals: [{ goal: 'GOAL-001', title: 'p', criterion: 'true', expect: 'e', origin: 'AC-0001 fail' }],
    autoDrive: [{
      title: 'a', problem: 'p', evidenceKey: 'drivers.goal.running', mechanismKeyword: 'goal-driver',
      criterion: 'true', expect: 'e', touches: 'plugin/scripts/meta-driver.ts',
    }],
    decisions: [{ title: 'd', question: 'q', options: 'o', evidenceKey: 'syncHealth.notFf', origin: 'o' }],
    metaRecordOpinions: [{ metaId: 'META-001', hasOpinion: true, note: 'n' }],
  }));
  assert.ok(out, '合法输出必须可解析');
  assert.equal(out.divergences.length, 1);
  assert.equal(out.proposals.length, 1);
  assert.equal(out.autoDrive.length, 1);
  assert.equal(out.decisions.length, 1);
  assert.equal(out.metaRecordOpinions.length, 1);
  assert.deepEqual(out.proposals[0], {
    goal: 'GOAL-001', title: 'p', criterion: 'true', expect: 'e', origin: 'AC-0001 fail',
  });
  assert.equal(out.autoDrive[0].evidenceKey, 'drivers.goal.running');
  assert.equal(out.metaRecordOpinions[0].hasOpinion, true);
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

// ── 裁定任务的机械停放（gap-meta-renderhumancallbody）──────────────────────────────────────────
// 缺陷：renderHumanCallBody 产出的任务不带线首 PARKED 标记，而 isParked 是派发池**唯一**的排除
// 半边 ⇒ 只能由人勾 AC 的裁定任务被推成 ready、派给 worker，每轮空烧一个会话（victim:
// gap-meta-call-ac-936-goal-914-103，2026-11-07）。判据喂**真函数**、用派发池**自己的读者**
// （isParked）判行为，⛔ 不判源码布局；并带取假臂（去掉标记 ⇒ 必须放行），否则它只是恒真装饰。
const humanCallItem = () => ({
  ...goodDecision, carrier: 'needs-human-task',
  irreversible: '改写后另一条路径的历史依据被抹掉',
  touches: 'plugin/scripts/meta-driver.ts',
  conflict: [{ source: 'spec.md', quote: '语义判据允许留空' }, { source: 'ac.md', quote: '不存在无判据的活跃验收' }],
});

test('renderHumanCallBody: 产出的任务体被派发池自己的读者 isParked 判为已停放', () => {
  const body = renderHumanCallBody(humanCallItem(), 41, '2026-09-06T00:00:00Z', 'gap-meta-call-probe');
  assert.equal(isParked({ body }), true, '裁定任务必须被 isParked 挡出派发池（它只能由人勾 AC）');

  // 取假臂：同一条判据换个输入必须换值。删掉线首标记行 ⇒ 读者放行 ⇒ 上面那条真的在测标记本身。
  const withoutMarker = body.split('\n').filter((l) => !/^\*\*PARKED\b/.test(l)).join('\n');
  assert.notEqual(withoutMarker, body, '前提：任务体里确实有一行线首 PARKED 标记');
  assert.equal(isParked({ body: withoutMarker }), false, '没有标记时必须回到 false');
});

test('renderHumanCallBody: unpark 检查能被 ARM 2 的读取器读出、能跑、且两个方向都取值', (t) => {
  const body = renderHumanCallBody(humanCallItem(), 41, '2026-09-06T00:00:00Z', 'gap-meta-call-probe');
  const decl = readUnparkDeclaration(body);
  assert.equal(decl.found, true, '停放必须带 unpark 声明（否则 ARM 2 只会报 no-unpark-check）');
  assert.equal(decl.problem, null, `声明必须是可读的：${decl.problem}`);
  assert.match(String(decl.command), /^[\w./~$-]/, '命令必须 command-shaped');
  assert.ok(String(decl.command).includes('tasks/gap-meta-call-probe.md'), '检查必须指向本任务自己的文件');
  assert.equal(decl.expectedOutput, 'ruled');

  // 真跑：在临时根里按「人还没裁定 / 人已裁定」两态各跑一次 —— 一条恒红的检查不是读数。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-human-call-unpark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  const file = path.join(root, 'tasks', 'gap-meta-call-probe.md');
  const run = () => {
    try {
      return { code: 0, out: String(execFileSync('bash', ['-c', decl.command], { cwd: root, encoding: 'utf8' })) };
    } catch (e) {
      return { code: e.status, out: String(e.stdout ?? '') };
    }
  };
  fs.writeFileSync(file, '## Finding\n\nno ruling recorded\n', 'utf8');
  const before = run();
  assert.notEqual(before.code, 0, '人还没裁定 ⇒ 检查必须失败（否则它恒绿，等于没测）');

  fs.writeFileSync(file, '## 人的裁定\n\n选定 (a)。\n', 'utf8');
  const after = run();
  assert.equal(after.code, 0, '裁定写入后检查必须通过');
  assert.ok(after.out.includes('ruled'), `输出必须带声明里的 token：${after.out}`);
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
// 读载体并**断言读全了**（readMetaCarrier 现返回三态结果：ok=false ⇔ 读不懂，⛔ 不与「没有历史」同形）。
// 这里断言 ok 是刻意的：正常的夹具载体必须可读，读不懂就是红——⛔ 不让 `.records` 取到 undefined 后静默跑偏。
function readMetaRecords(root) {
  const r = readMetaCarrier(root);
  assert.equal(r.ok, true, `fixture carrier must be readable (got code=${r.code})`);
  return r.records;
}

test('重复计数: 同一 (id,kind) 连续 5 轮 ⇒ 计数 5，且 lastRecommendation 取最近一次', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-recur-'));
  try {
    const interp = (rec) => [{ id: 'AC-177', kind: 'pass-but-unflipped', interpretation: 'x', recommendation: rec }];
    writeCarrier(tmp, ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5'].map((r) => mkJudgeRecord(interp(r))));
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaRecords(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
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
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaRecords(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
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
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaRecords(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
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
    const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaRecords(tmp)), [recurDiv('AC-177', 'pass-but-unflipped')]);
    const got = recurrence.get(divergenceKey('AC-177', 'pass-but-unflipped'));
    assert.equal(got.repeatCount, 2, '心跳/skipped 不产生建议 ⇒ 不打断连续，两轮判读都算');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 载体超过 V8 最大字符串长度（gap-meta-readmetacarrier）─────────────────────────────────────
// 缺陷现场（2026-11-10）：`.quay/meta-driver-round.jsonl` 实测 2,236,702,877 B（39,320 行）——大于 V8 的
// 最大字符串长度 0x1fffffe8 ⇒ 旧 `readRoundCarrier` 的整文件 `fs.readFileSync(rel,"utf8")` 抛
// ERR_STRING_TOO_LONG，被 `catch { return [] }` 吞成「没有历史」⇒ `computeDivergenceRecurrence` 对每条
// (id,kind) 恒报 repeatCount=0（= 「本轮首次」）⇒ 重复建议的自纠机制整条失效。**读不懂 ≠ 没有历史**。
//
// 夹具是**稀疏**的：`ftruncate` 造洞，st_size 超过 V8 上限而盘上只占几 KB（⛔ 不在测试进程里造 512 MB
// 字符串）。布局：[判读记录]\n[洞（无换行符）][判读记录]\n —— 洞构成一条超预算行，正是「读不动」的形态。
// ⛔ `fs.writeSync(fd, string, ...)` 的 5 参数重载不按 (offset,length,position) 解释：尾部必须传 Buffer。
const V8_MAX_STRING_LENGTH = 0x1fffffe8;
function makeSparseRoundCarrier(root, size = V8_MAX_STRING_LENGTH + 4096) {
  const p = path.join(root, '.quay', 'meta-driver-round.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const head = Buffer.from(mkJudgeRecord([{ id: 'AC-177', kind: 'pass-but-unflipped', interpretation: 'x', recommendation: 'rec-1' }]) + '\n');
  const tail = Buffer.from(mkJudgeRecord([{ id: 'AC-177', kind: 'pass-but-unflipped', interpretation: 'x', recommendation: 'rec-2' }]) + '\n');
  const fd = fs.openSync(p, 'w');
  fs.writeSync(fd, head);
  fs.ftruncateSync(fd, size);
  fs.writeSync(fd, tail, 0, tail.length, size - tail.length);
  fs.closeSync(fd);
  return p;
}

test('oversize carrier: readMetaCarrier streams (or reports a distinguishable not-evaluated), never a silent "no history"', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-oversize-'));
  try {
    const p = makeSparseRoundCarrier(tmp);
    const size = fs.statSync(p).size;
    assert.ok(size > V8_MAX_STRING_LENGTH, `fixture must exceed V8's max string length, got ${size}`);
    assert.ok(fs.statSync(p).blocks * 512 < 1024 * 1024, 'fixture must be SPARSE (a few KB on disk, not 512 MB)');

    // ── 负控制 = 被删掉的那一行本身 ────────────────────────────────────────────────────────────
    // 旧的整文件读必须在这个夹具上真的抛；否则夹具什么也没证明（硬规则②：对已知为真的样本干跑）。
    assert.throws(
      () => fs.readFileSync(p, 'utf8'),
      (e) => e.code === 'ERR_STRING_TOO_LONG',
      'negative control: the removed whole-file read must fail on this fixture',
    );

    // ── 结构性判据：这条路径上一次都不许整文件读载体 ────────────────────────────────────────────
    // 「把 readFileSync 包进 try/catch」不合格——那样它仍会读、仍会抛、只是被吞掉（正是旧缺陷）。
    const realReadFileSync = fs.readFileSync;
    const wholeFileReads = [];
    fs.readFileSync = function (target, ...rest) {
      if (String(target) === p) wholeFileReads.push(String(target));
      return realReadFileSync.apply(this, [target, ...rest]);
    };
    let r;
    try {
      r = readMetaCarrier(tmp);
    } finally {
      fs.readFileSync = realReadFileSync;
    }
    assert.deepEqual(wholeFileReads, [], 'the whole-file read must be GONE from this path, not merely try/caught');

    // ── AC 的析取：要么流式读出真实记录（非空），要么给出可区分的 unreadable/未评估信号 ──────────
    const streamsRealRecords = r && r.ok === true && Array.isArray(r.records) && r.records.length > 0;
    const distinguishableUnreadable = r && r.ok === false && typeof r.code === 'string' && r.code.length > 0;
    assert.ok(
      streamsRealRecords || distinguishableUnreadable,
      `readMetaCarrier must not silently report "no history": got ${JSON.stringify(r)}`,
    );
    // 旧缺陷的形状（裸空数组 = 「没有历史」）必须不再出现——这就是本条要消灭的那个同形。
    assert.ok(!Array.isArray(r), '⛔ must not return a bare [] (the silent "no history" shape)');

    // 稀疏洞 > 单行读取预算（16 MiB）⇒ 这一行读不懂 ⇒ 明确记在 code 上，⛔ 不给偏小的记录集。
    assert.equal(r.ok, false);
    assert.equal(r.code, 'line-too-long');
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
  // not-evaluated 处理者 = none ⇒ 恒 absent ⇒ probe 必须 escalate。
  // ⛔ 映射成 "goal" 会让 goal-driver 健康时 handler.state=healthy，probe 规格要求「transient
  // window ⇒ 沉默」，于是「测不了」这件事又被吞掉——正是本任务要消除的沉默。
  const ne = hDiv('AC-911', 'not-evaluated');
  assert.deepEqual(attachDivergenceHandlers([ne], [drv(true)])[0].handler, { kind: 'none', state: 'absent' },
    'not-evaluated 没有自动处理者：goal-driver 只是【重复】跑它，不是在修它');
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
  // gap-meta-goaldriverchildtimeoutms: the signal must say WHAT was unchanged. `count:13` alone was
  // read as "13 rounds unmeasured" while every one of those rounds actually held a definitive `fail`.
  assert.equal(verdict.value, 'fail', 'unchanged 信号必须携带被重复的取值（否则 "unchanged" 在 unmeasured 与 failing 之间歧义）');
  assert.equal(spawn.value, null, 'expected-absent 计的是「没发生」，没有可重复的取值 ⇒ value=null（⛔ 不是 ""）');
});

test('gap-meta-goaldriverchildtimeoutms AC: unchanged 信号的 value 能把「未评估」与「稳定失败」分开', () => {
  const roundWith = (verdict) => ({
    round: 1, ts: '2026-10-21T04:00:00.000Z',
    facts: [{ name: 'goal-ring', value: { criteria: [{ id: 'AC-911', goal: 'GOAL-907', status: 'active', verdict }] }, state: 'verified' }],
  });
  const unmeasured = deriveGoalCarrierSignals([roundWith('not-evaluated')], ['AC-911']).find((s) => s.key === 'goal:AC-911:verdict');
  const failing = deriveGoalCarrierSignals([roundWith('fail')], ['AC-911']).find((s) => s.key === 'goal:AC-911:verdict');
  assert.equal(unmeasured.value, 'not-evaluated');
  assert.equal(failing.value, 'fail');
  assert.notEqual(unmeasured.value, failing.value, '两种 streak 的 count 可以相同，value 必须不同');
  // 无任何观测 ⇒ 尾值 null ⇒ evaluated:false 且 value=null（⛔ 不冒充某个取值）。
  const never = deriveGoalCarrierSignals([roundWith('fail')], ['AC-999']).find((s) => s.key === 'goal:AC-999:verdict');
  assert.equal(never.evaluated, false);
  assert.equal(never.value, null);
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
// gap-meta-derivegoalcarriersignals —— 被停机打断的一轮不得把 streak 变成「无历史」
// ═══════════════════════════════════════════════════════════════════════════════════════════

// 真生产记录（.quay/goal-round.jsonl，2026-11-06T16:17:09.146Z，round 3）：**逐字**取自生产文件的
// goal-ring fact——`abandonedMidRoundFact`（quality-gate-driver.ts:3938）在停机宽限内没等到例程收尾时
// 写下的形状。生产实测 20625 轮里 73 轮是它，且最近 40 轮里 7 轮是它（最后一条就是）。
const REAL_ABANDONED_ROUND = {
  round: 3,
  ts: '2026-11-06T16:17:09.146Z',
  stopped_mid_round: true,
  skipped_routines: [],
  facts: [{
    name: 'goal-ring',
    value: { stopped_mid_round: true, observed: false, grace_ms: 5000 },
    state: 'not-evaluated',
    reason: 'stopped-mid-round: the routine did not observe the stop within 5000ms — abandoned by the caller-side stop grace. ⛔ This is NOT a completed round: the routine\'s own Facts are not recorded, and any write it still performs after this point may land on disk.',
  }],
};
// 一轮**跑完了**、只是 store 读失败的记录（真生产同窗口的 157 条之一，形状逐字取自 value/state/reason）。
const REAL_LIST_FAILED_ROUND = {
  round: 1,
  ts: '2026-11-06T06:42:20.913Z',
  stopped_mid_round: false,
  skipped_routines: [],
  facts: [{ name: 'goal-ring', value: { phase: 'list' }, state: 'failed', reason: 'list failed: goal-store list failed (exit null): ' }],
};

test('AC gap-meta-derivegoalcarriersignals: 尾轮是被停机打断的记录 ⇒ 信号仍由最近带 criteria 读数的轮派生', () => {
  // 判据即任务 AC 里那条命令的逐字等价物（[ok, ok, 中止]）。
  const v = deriveGoalCarrierSignals([mkGoalRound(1, '2026-09-09T00:00:00.000Z'), mkGoalRound(2, '2026-09-09T00:05:00.000Z'), REAL_ABANDONED_ROUND], ['AC-214'])
    .find((x) => x.key === 'goal:AC-214:verdict');
  assert.equal(v.evaluated, true, '中止轮在尾部不得把信号打成 evaluated:false（旧实现正是如此）');
  assert.ok(v.count >= 2, `应由最近两轮带读数的轮派生（count≥2），实得 ${v.count}`);
  assert.equal(v.value, 'fail', '被重复的取值必须来自【真正的读数】，⛔ 不是 null');
  // 被跳过的轮**独立可见**：⛔ 不折进 count，也⛔ 不伪装成「没有历史」。
  assert.equal(v.skippedAbortedRounds, 1, '被跳过的那一轮必须在信号上留下独立读数');
});

test('gap-meta-derivegoalcarriersignals 负控制①: 跳过 ≠ 把中止轮算成一轮重复（count 不被灌水）', () => {
  // 两轮读数 + 一轮中止：streak 必须是 2，⛔ 不是 3（把中止轮数进去就是自证恒真，硬规则 4）。
  const v = deriveGoalCarrierSignals([mkGoalRound(1, '2026-09-09T00:00:00.000Z'), REAL_ABANDONED_ROUND], ['AC-214'])
    .find((x) => x.key === 'goal:AC-214:verdict');
  assert.equal(v.count, 1, '「读数 + 中止」只有 1 轮读数 ⇒ count=1');
  assert.equal(v.evaluated, true);
  assert.equal(v.skippedAbortedRounds, 1);

  // 方向二：跳过之后，真正改变取值的轮仍能打断 streak（⛔ 不是「跳过一切、什么都不断」）。
  const changed = {
    ...mkGoalRound(3, '2026-09-09T00:10:00.000Z'),
    facts: [{ ...mkGoalRound(3, 'x').facts[0], value: { ...mkGoalRound(3, 'x').facts[0].value, criteria: [{ id: 'AC-214', goal: 'GOAL-009', status: 'active', verdict: 'pass' }] } }],
  };
  const v2 = deriveGoalCarrierSignals([mkGoalRound(1, 'a'), mkGoalRound(2, 'b'), REAL_ABANDONED_ROUND, changed], ['AC-214'])
    .find((x) => x.key === 'goal:AC-214:verdict');
  assert.equal(v2.value, 'pass', '中止轮之后的真读数必须生效');
  assert.equal(v2.count, 1, '取值 fail→pass ⇒ streak 被打断为 1');
});

test('gap-meta-derivegoalcarriersignals 负控制②: 「跑完了但没读到」≠「没跑完」（硬规则 3b）', () => {
  // failed 轮（跑完了、store 读失败）**仍然**记 null 并打断连续——它带的信息是「这一轮查过、没查成」，
  // 与「这一轮根本没跑完」不同形。⛔ 不顺手把整个 null 类都跳过（那会抹掉「查过没查成」这个区别）。
  assert.equal(goalRingRoundAborted(REAL_LIST_FAILED_ROUND), false, 'failed 轮不是中止轮');
  assert.equal(goalRingRoundAborted(REAL_ABANDONED_ROUND), true, '生产中止轮必须被判为中止轮');

  const v = deriveGoalCarrierSignals([mkGoalRound(1, 'a'), mkGoalRound(2, 'b'), REAL_LIST_FAILED_ROUND], ['AC-214'])
    .find((x) => x.key === 'goal:AC-214:verdict');
  assert.equal(v.evaluated, false, '尾轮「查过没查成」⇒ evaluated:false（与中止轮不同形）');
  assert.equal(v.skippedAbortedRounds, 0, 'failed 轮⛔ 不计入被跳过的中止轮数');
});

test('gap-meta-derivegoalcarriersignals 负控制③: 记录级 stopped_mid_round 单独不该丢掉真读数', () => {
  // 记录级旗标只说明「本轮有**某条**例程被打断」；goal-ring 自己已跑完时它的读数必须照用。
  const okRoundWithForeignStop = { ...mkGoalRound(9, '2026-09-09T00:20:00.000Z'), stopped_mid_round: true, skipped_routines: ['reflection'] };
  assert.equal(goalRingRoundAborted(okRoundWithForeignStop), false, '带 criteria 读数 ⇒ 算观测到（数据优先于旗标）');
  const v = deriveGoalCarrierSignals([mkGoalRound(1, 'a'), okRoundWithForeignStop], ['AC-214'])
    .find((x) => x.key === 'goal:AC-214:verdict');
  assert.equal(v.count, 2, '两轮都读到了 ⇒ streak=2');
  assert.equal(v.skippedAbortedRounds, 0);
});

test('gap-meta-derivegoalcarriersignals: 全窗口都是中止轮 ⇒ evaluated:false 但「跳过 N 轮」独立可见', () => {
  const v = deriveGoalCarrierSignals([REAL_ABANDONED_ROUND, REAL_ABANDONED_ROUND], ['AC-214'])
    .find((x) => x.key === 'goal:AC-214:verdict');
  assert.equal(v.evaluated, false, '一次读数都没有 ⇒ 不得冒充有成型的 streak');
  assert.equal(v.skippedAbortedRounds, 2, '但「为什么没有」必须可区分于「载体本来就是空的」');
  // 与「无历史」不同形：空窗口的 skippedAbortedRounds 是 0。
  const empty = deriveGoalCarrierSignals([], ['AC-214']).find((x) => x.key === 'goal:AC-214:verdict');
  assert.equal(empty.skippedAbortedRounds, 0);
  assert.notDeepEqual(
    { e: empty.evaluated, s: empty.skippedAbortedRounds },
    { e: v.evaluated, s: v.skippedAbortedRounds },
    '「没历史」与「全是中止轮」必须不共用同一输出（硬规则 3b）',
  );
});

test('gap-meta-derivegoalcarriersignals: spawn-zero-output 同样跳过中止轮（两类信号同一口径）', () => {
  const s = deriveGoalCarrierSignals([...AC214_WINDOW.slice(0, 2), REAL_ABANDONED_ROUND], ['AC-214'])
    .find((x) => x.key === 'goal:AC-214:spawn-zero-output');
  assert.equal(s.evaluated, true, '中止轮在尾部 ⇒ 零产出 streak 仍由最近 spawn 轮派生');
  assert.equal(s.count, 2);
  assert.equal(s.skippedAbortedRounds, 1);
});

test('gap-meta-derivegoalcarriersignals: 新字段不进 readingsDigest（否则每出现一个中止轮摘要就变）', () => {
  const mk = (sig) => ({ ...mkReadings('pass', 'n1'), timeSeries: [{ key: 'k', mode: 'unchanged', count: 3, crossed: false, evaluated: true, threshold: 8, value: 'fail', ...sig }] });
  assert.equal(
    readingsDigest(mk({ skippedAbortedRounds: 0 })),
    readingsDigest(mk({ skippedAbortedRounds: 7 })),
    'skippedAbortedRounds 每轮都可能 +1 ⇒ 必须留在摘要之外（硬规则 4 推论一）',
  );
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
  // 空语料 ⇒ **not-evaluated**（gap-meta-collectactionrecordfailures-3）：零记录与「抽取器一条
  // 都没认出」不可分（2026-11-06：只认 `is_error` 的那版对投影形态逐条静默跳过，产出 []），
  // 所以它不能报成合格侧。⛔ 不是 none、也不是 []。
  const empty = corpus([], 2);
  assert.equal(empty.state, 'not-evaluated', '零记录 ⛔ 不与「查过、干净」同形（硬规则 3b）');
  assert.equal(empty.aggregates, null, '未评估 ⇒ aggregates 为 null（⛔ 不是空清单）');
  assert.match(empty.reason, /^empty-corpus:/, `未评估必须命名成因，实际: ${empty.reason}`);
  assert.notEqual(empty.reason, unreadable.reason, '「零记录」与「读不懂」同 state 但成因必须可分');
  assert.equal(empty.recordsScanned, 0, '零记录仍如实报出记录数（不藏量）');
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

// 真实交付形态回归（2026-11-06 对活语料实测）：meta-cc `query_session_signals type=errors` 返回的是
// **投影记录** `{category, error_text, session_id, timestamp, tool_name}`——里面**没有**
// `message.content[].is_error`。首版只认 `is_error` ⇒ 每条记录静默跳过 ⇒ 整类读数恒报 `none`，
// 且与「查过、无跨会话重复」同形（硬规则 3b 的镜像：读到了语料、一个字段都没认出、报「检查通过」）。
// ⛔ 这一条固定的是【生产载体上真实出现的形状】（上面 query_session_signals 的返回），不是为解析器
// 量身定做的 fixture——`mkErrRow` 那一支是首版作者记录的「实测」，实际交付的却是投影形态。
const mkProjectedErrRow = (sessionId, text, ts = '2026-11-06T18:41:43.380Z', category = 'bash_exit_code') => ({
  category, error_text: text, session_id: sessionId, timestamp: ts, tool_name: 'Bash',
});
test('真实交付形态：投影记录（error_text / session_id）必须被抽取并聚合（⛔ 不是只看 is_error）', () => {
  const payload = {
    data: [
      mkProjectedErrRow('s1', 'Exit code 1\nls: boom'),
      mkProjectedErrRow('s2', 'Exit code 1\nls: boom'),
      mkProjectedErrRow('s3', 'Exit code 127\nfoo: not found'),
    ],
    mode: 'inline',
  };
  const recs = extractActionFailureRecords(payload);
  assert.ok(Array.isArray(recs), '投影形态必须被读懂（⛔ null——null 会让读数落 not-evaluated）');
  assert.equal(recs.length, 3, `每条投影记录贡献一条（⛔ 静默跳过）；实得 ${JSON.stringify(recs)}`);
  assert.deepEqual(recs.map((r) => r.sessionId), ['s1', 's2', 's3'], 'session_id → sessionId（跨会话维度的承载）');
  assert.equal(recs[0].ts, '2026-11-06T18:41:43.380Z', 'timestamp → ts');
  const agg = aggregateActionFailures(recs, { minSessions: 2 });
  assert.equal(agg.recordsScanned, 3, 'recordsScanned 必须 > 0（缺陷的现场读数正是 0）');
  assert.equal(agg.state, 'crossed');
  assert.equal(agg.aggregates[0].sessions, 2);
  assert.equal(agg.aggregates[0].count, 2);
  assert.match(agg.aggregates[0].signature, /^Exit code 1 /, '退出码类别逐字保留（不归一化成 <n>）');
  // 取假控制：同一份语料抬阈值到 3 ⇒ 结论翻（证明这条测试在测聚合，不是恒真）。
  assert.equal(aggregateActionFailures(extractActionFailureRecords(payload), { minSessions: 3 }).state, 'none');
  // 投影记录没有错误正文 ⇒ 不贡献记录（⛔ 造出一条签名 "" 的假记录）。
  assert.deepEqual(extractActionFailureRecords({ data: [{ category: 'uncategorized', session_id: 's9' }] }), [],
    '读懂了、但该条无错误文本 ⇒ []（⛔ null）');
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

// errorSignature：退出码是失败【类别】而非一次性取值——137(SIGKILL/OOM) / 124(timeout) / 1|2
// 是不同类别。开头的 `Exit code N` 必须逐字保留，否则会把不同失败类别并成一个签名。
test('errorSignature: 保留开头 Exit code N；其余数字照常归一化', () => {
  // (a) 退出码不同 ⇒ 签名必须不同（正文其余部分完全相同）。
  assert.notEqual(
    errorSignature('Exit code 137: killed'),
    errorSignature('Exit code 1: killed'),
    '不同退出码（OOM vs 普通失败）不得并成同一个签名');
  assert.match(errorSignature('Exit code 137: killed'), /^Exit code 137\b/);
  assert.match(errorSignature('Exit code 1: killed'), /^Exit code 1\b/);
  // (b) 退出码相同、其余一次性数字（行号）不同 ⇒ 仍归一到同一个签名。
  assert.equal(
    errorSignature('Exit code 1 boom at line 42'),
    errorSignature('Exit code 1 boom at line 99'),
    '同退出码下，行号等一次性数字仍须归一化');
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
      scannedAt: '2026-09-12T01:59:00Z', scanMs: 1234, since: null, extractor: ACTION_RECORD_EXTRACTOR_ID,
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
    //    （值仍来自**真实**扫描，age 由 scannedAt 暴露），⛔ 不能冒充「无越阈项」；且 reason 必须
    //    命名这次扫描失败（gap-meta-collectactionrecordfailures-2：stale-served 与 fresh 在 reason
    //    上可区分，⛔ 不再静默回退——硬规则 3b）。
    fs.writeFileSync(path.join(tmp, '.quay', 'config.yml'), 'action_record_failures:\n  min_sessions: 2\n  scan_ttl: 1h\n', 'utf8');
    const r3 = await collectActionRecordFailures(tmp, { now: Date.parse('2026-09-12T05:00:00Z'), binary: null });
    assert.equal(r3.state, 'crossed');
    assert.equal(r3.scannedAt, '2026-09-12T01:59:00Z', '旧载体的时刻暴露年龄');
    assert.ok(r3.reason !== null && r3.reason.startsWith('scan-failed'), `stale fallback 必须命名扫描失败，实际: ${r3.reason}`);
    // ⑤ 无载体 + 扫描失败 ⇒ not-evaluated（⛔ 不是 none、⛔ 不是 unthresholded）。
    fs.rmSync(path.join(tmp, ACTION_RECORD_SCAN_REL));
    const r4 = await collectActionRecordFailures(tmp, { now: Date.parse('2026-09-12T05:00:00Z'), binary: null });
    assert.equal(r4.state, 'not-evaluated');
    assert.ok(r4.reason.startsWith('scan-failed') || r4.reason.startsWith('corpus-unreadable'), r4.reason);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// gap-meta-collectactionrecordfailures-3 第二半：载体必须盖【产出它的抽取器身份】。
// 只看 `scannedAt` 判新鲜时，一个**被取代的实现**写下的载体在 TTL 内与本次实现写的同形——
// 2026-11-06 的现场：零记录载体出自 `error_text` 支路修好之前的实现，18.8 h 后被当成新鲜读数。
test('载体抽取器身份：旧实现写的载体在 TTL 内 ⛔ 也不得被当新鲜读数', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-afr-ext-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-afr-bin-'));
  try {
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.quay', 'config.yml'), 'action_record_failures:\n  min_sessions: 2\n  scan_ttl: 1h\n', 'utf8');
    const now = Date.parse('2026-11-06T20:00:00Z');
    const rows = [
      { category: 'bash_exit_code', error_text: 'Exit code 1\nboom', session_id: 's1', timestamp: '2026-11-06T19:00:00Z', tool_name: 'Bash' },
      { category: 'bash_exit_code', error_text: 'Exit code 1\nboom', session_id: 's2', timestamp: '2026-11-06T19:10:00Z', tool_name: 'Bash' },
    ];
    // 一个会说 JSON-RPC 的假 meta-cc：只回 `id:2`（tools/call），载荷是投影形态的记录。
    const fake = path.join(binDir, 'meta-cc-mcp');
    fs.writeFileSync(fake, '#!/usr/bin/env node\n'
      + `const payload = ${JSON.stringify(JSON.stringify({ data: rows }))};\n`
      + "let acc = '';\n"
      + "process.stdin.on('data', (d) => { acc += d; if (acc.includes('\"id\":2')) {"
      + " process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: payload }] } }) + '\\n'); } });\n",
      'utf8');
    fs.chmodSync(fake, 0o755);

    const sc = await scanActionRecords(tmp, readActionRecordConfig(tmp), { now, binary: fake });
    assert.equal(sc.ok, true, `真扫应成功: ${sc.ok ? '' : sc.reason}`);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, ACTION_RECORD_SCAN_REL), 'utf8'));
    assert.equal(onDisk.extractor, ACTION_RECORD_EXTRACTOR_ID, '写侧必须把产出它的抽取器身份落进载体');
    assert.equal(readActionRecordScan(tmp).extractor, ACTION_RECORD_EXTRACTOR_ID, '读侧必须把它读回来');

    // 正臂：同一 TTL 内、身份相符 ⇒ 采信载体（binary 指向不存在的路径也不会触发扫描 ⇒ 证明没重扫）。
    const missing = path.join(binDir, 'does-not-exist');
    const good = await collectActionRecordFailures(tmp, { now: now + 60_000, binary: missing });
    assert.equal(good.state, 'crossed', '当前抽取器写的载体应被采信');
    assert.equal(good.reason, null, '被采信的载体不该带失败 reason');

    // 反臂①：把载体改标成一个【被取代的】抽取器 ⇒ TTL 内也不得采信（扫描失败 ⇒ 未评估）。
    fs.writeFileSync(path.join(tmp, ACTION_RECORD_SCAN_REL), JSON.stringify({ ...onDisk, extractor: 'superseded000000' }), 'utf8');
    const superseded = await collectActionRecordFailures(tmp, { now: now + 60_000, binary: missing });
    assert.equal(superseded.state, 'not-evaluated', '旧实现写的载体 ⛔ 不得冒充当前读数');
    assert.equal(superseded.aggregates, null);
    assert.match(superseded.reason, /^superseded-extractor:/, `必须命名成因，实际: ${superseded.reason}`);
    assert.match(superseded.reason, /superseded000000/, 'reason 要点出载体上的旧身份');

    // 反臂②：早期载体【无】extractor 键 ⇒ 同样不采信（⛔ 缺值不当成「就是我写的」）。
    const { extractor: _drop, ...unstampedCarrier } = onDisk;
    fs.writeFileSync(path.join(tmp, ACTION_RECORD_SCAN_REL), JSON.stringify(unstampedCarrier), 'utf8');
    const unstamped = await collectActionRecordFailures(tmp, { now: now + 60_000, binary: missing });
    assert.equal(unstamped.state, 'not-evaluated');
    assert.match(unstamped.reason, /<unstamped>/);

    // 取假控制：把身份改回当前实现 ⇒ 立刻又采信（结论由身份驱动，不是别的因素）。
    fs.writeFileSync(path.join(tmp, ACTION_RECORD_SCAN_REL), JSON.stringify(onDisk), 'utf8');
    const restored = await collectActionRecordFailures(tmp, { now: now + 60_000, binary: missing });
    assert.equal(restored.state, 'crossed', '只把身份改回当前值，结论必须翻回来');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
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

// 肯定用例：当前安装落点 ~/.local/share/meta-cc/bin/meta-cc-mcp 必须被定位（52 天旧载体的直接成因）。
test('locateMetaCcMcp: ~/.local/share/meta-cc/bin 落点被定位；旧 ~/.local/bin 落点仍被定位', () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-afr-share-'));
  try {
    const shareBin = path.join(fakeHome, '.local', 'share', 'meta-cc', 'bin');
    const localBin = path.join(fakeHome, '.local', 'bin');
    fs.mkdirSync(shareBin, { recursive: true });
    fs.mkdirSync(localBin, { recursive: true });
    fs.writeFileSync(path.join(shareBin, 'meta-cc-mcp'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(localBin, 'meta-cc-mcp'), '#!/bin/sh\n');
    assert.equal(locateMetaCcMcp({}, fakeHome), path.join(shareBin, 'meta-cc-mcp'),
      '~/.local/share/meta-cc/bin 是可执行文件的当前落点，必须命中');
    fs.rmSync(path.join(shareBin, 'meta-cc-mcp'));
    assert.equal(locateMetaCcMcp({}, fakeHome), path.join(localBin, 'meta-cc-mcp'),
      'share 落点缺失时退回旧 ~/.local/bin 落点');
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

// ── gap-meta-driver-admission-gates-pass-when-they-cannot-know ────────────────────────────────────
// 同一缺陷族（硬规则 3b：一个「评估不了」的闸返回了与「评估过且合格」同形的答案）的三个实例，
// 每例一条对照 AC：(a) owner 搜索在状态过滤【之前】被 cap 截断；(b) null 读数被当证据准入；
// (c) 提案 dedup 不看 owner 状态（superseded/achieved 的旧 key 永久压制）。

// (a) cap 必须在【状态过滤之后】——前 5 条 done 不得把板上的第 6 条 live owner 挤出可见集。
test('AC(a) — findOwningTasks 扫全板：前 5 条 done 遮不住第 6 条 ready owner（driveItems 据此拒）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-driver-caporder-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'));
    // 前 5 条（readdir 序）done，第 6 条 ready。命中名按【字典序】与【创建序】都把 ready 排在最后，
    // 故无论 readdir 按哪种序返回，旧实现「攒够 cap 就 break」都必然漏掉它。
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(tmp, 'tasks', `gap-owner-${i}-done.md`),
        `---\nid: gap-owner-${i}-done\nstatus: done\n---\n涉及 syncDevelopToDoc 的修复 ${i}\n`);
    }
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-owner-6-ready.md'),
      '---\nid: gap-owner-6-ready\nstatus: ready\n---\n涉及 syncDevelopToDoc 的修复 6\n');

    // 夹具自检：6 条都命中关键词，且第 6 条确实被找到（否则本用例与「一条都没搜到」同形，硬规则 2）。
    const owners = findOwningTasks(tmp, 'syncDevelopToDoc');
    assert.equal(owners.filter((o) => o.status === 'done').length, 5, `夹具：5 条 done 必须都命中：${JSON.stringify(owners)}`);
    assert.ok(owners.some((o) => o.file === 'gap-owner-6-ready.md'), `第 6 条 ready owner 必须被找到：${JSON.stringify(owners)}`);

    const r = await driveItems(tmp, [{ ...goodItem, mechanismKeyword: 'syncDevelopToDoc' }], ecoReadings,
      { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, false, `板上真有 live owner ⇒ 必须拦，⛔ 不得回报「没有在办的 owner」：${r[0].reason}`);
    assert.match(r[0].reason, /未完成的既有任务已在管/);
    assert.match(r[0].reason, /gap-owner-6-ready\.md\[ready\]/, '拒绝理由必须点名那条 ready 任务（硬规则 3：枚举不布尔）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// (b) null 读数（「没读出来」）不得冒充证据；0/false/"" 是合法读数、仍准入。
test('AC(b) — value 为 null 的 evidenceKey 被拒且理由与「解析不出」不同形；0/false/"" 仍准入', async () => {
  assert.equal(resolveEvidence(ecoReadings, 'drivers.outer.carrierLastTs'), null, '夹具自检：该 key 真的解析得到 null');

  const rNull = await driveItems('/tmp', [{ ...goodItem, evidenceKey: 'drivers.outer.carrierLastTs' }], ecoReadings,
    { cap: 1, dryRun: true, at: 'now' });
  assert.equal(rNull[0].accepted, false, `null 读数必须被拒：${rNull[0].reason}`);
  const rMissing = await driveItems('/tmp', [{ ...goodItem, evidenceKey: 'syncHealth.fabricated' }], ecoReadings,
    { cap: 1, dryRun: true, at: 'now' });
  assert.match(rMissing[0].reason, /解析不出/);
  assert.notEqual(rNull[0].reason, rMissing[0].reason, 'null 与 not-found 必须是两个可区分的拒绝取值（硬规则 3b）');
  assert.doesNotMatch(rNull[0].reason, /解析不出/, 'null 的理由不得读作「解析不出」');

  // 三态直读（同一判定的另一面，纯函数）。
  assert.equal(readEvidenceForGate(ecoReadings, 'drivers.outer.carrierLastTs').state, 'unreadable');
  assert.equal(readEvidenceForGate(ecoReadings, 'syncHealth.fabricated').state, 'missing');
  assert.equal(readEvidenceForGate(ecoReadings, 'syncHealth.semanticConflict').state, 'admitted');

  // 0 / false / "" ⇒ admitted（合法读数，⛔ 不因 null 修复而波及）。
  for (const key of ['syncHealth.semanticAlignFailed', 'drivers.outer.running']) {
    const r = await driveItems('/tmp', [{ ...goodItem, evidenceKey: key }], ecoReadings, { cap: 1, dryRun: true, at: 'now' });
    assert.equal(r[0].accepted, true, `${key} 是合法读数，必须准入：${r[0].reason}`);
  }
  const withEmpty = { ...ecoReadings, syncHealth: { ...ecoReadings.syncHealth, note: '' } };
  const rEmpty = await driveItems('/tmp', [{ ...goodItem, evidenceKey: 'syncHealth.note' }], withEmpty, { cap: 1, dryRun: true, at: 'now' });
  assert.equal(rEmpty[0].accepted, true, `"" 是合法读数，必须准入：${rEmpty[0].reason}`);
});

// (c) 提案 dedup 带 owner 状态：已了结的 AC 不永久压制；未决的 AC 仍拦且理由是「已评估」。
test('AC(c) — 提案 dedup 读 owner 状态：superseded/achieved 不拦；draft/active 仍拒且理由不含 NOT EVALUATED', async () => {
  // 映射本身的对照（纯函数）。
  assert.equal(proposalBoardStatus('superseded'), 'done');
  assert.equal(proposalBoardStatus('achieved'), 'done');
  assert.equal(proposalBoardStatus('retired'), 'done');
  assert.equal(proposalBoardStatus('draft'), 'ready');
  assert.equal(proposalBoardStatus('active'), 'ready');
  assert.equal(proposalBoardStatus(undefined), null, '读不出状态 ⇒ null（第三态，⛔ 不冒充 done）');

  const rec = (id, status) => ({ id, title: goodProposal.title, criterion: goodProposal.criterion, origin: goodProposal.origin, status });
  const opts = { k: 3, activeGoalIds: new Set(['GOAL-001']), dryRun: true };

  for (const status of ['superseded', 'achieved', 'retired']) {
    const r = await fileProposals('/tmp', [goodProposal], [rec('AC-145', status)], opts);
    assert.equal(r[0].accepted, true, `${status} 的等价 AC 不得永久压制后续提案：${r[0].reason}`);
  }

  for (const status of ['draft', 'active', 'needs-human']) {
    const r = await fileProposals('/tmp', [goodProposal], [rec('AC-147', status)], opts);
    assert.equal(r[0].accepted, false, `未决（${status}）的等价 AC 必须仍拦：${r[0].reason}`);
    assert.match(r[0].reason, /dedup/);
    assert.doesNotMatch(r[0].reason, /NOT EVALUATED/, '它【已】被评估过 ⇒ 理由不得读作「未评估」');
    assert.doesNotMatch(r[0].reason, /bare Set/, '理由不得再自述为「裸 Set」');
  }
});

// ── 停放读数（gap-meta-scanparkingboard）─────────────────────────────────────
// 被钉住的缺陷：promotion-driver 每轮把 body-PARKED 的 unpark 结果落进
// `.quay/needs-human-parking-recheck.json`，而 meta-driver 的 collectReadings 从不读它 ⇒
// 「解停条件已成立而任务仍 PARKED」到不了唯一能处置它的层（任务被派发池排除、依赖它的 todo 被饿死）。
// 这些用例钉三件事：①读数**来自生产载体**（不是重跑一遍探测器冒充）；②载体不可用时才回退现扫，
// 且回退是**可见的**；③未评估 ⛔ 不与「四态全 0」或「一条都没有」同形（硬规则 3b/6）。

const PARKING_AT = '2026-11-06T00:00:00.000Z';

const parkedEntry = (id, state = 'unpark-passed') => ({
  id, status: 'ready', command: 'echo landed', expectedOutput: 'landed',
  exitCode: state === 'unpark-passed' ? 0 : 1, output: state === 'unpark-passed' ? 'landed\n' : 'blocked\n',
  state, note: 'fixture',
});

/** 生产载体的夹具（形状逐字对齐 `scanParkingBoard` 的落盘：两臂 + 四态 counts + entries/stale）。 */
function carrierFixture(root, {
  counts = { 'unpark-passed': 1, 'unpark-still-blocked': 0, 'no-unpark-check': 0, 'not-evaluated': 0 },
  entries = null, tasks = null, stale = [], nhTasks = [],
  parkedOverrides = {}, topOverrides = {},
} = {}) {
  const pEntries = entries ?? [parkedEntry('gap-fixture-parked-passed')];
  const pTasks = tasks ?? [...pEntries];
  const nh = {
    at: PARKING_AT, root, evaluated: true, reason: null,
    needs_human_total: nhTasks.length, reported_stale: stale.length,
    counts: {
      'parking-reason-stale': stale.length, 'still-blocked': 0, 'no-registered-judge': 0,
      'not-evaluated': nhTasks.length - stale.length,
    },
    stale, tasks: nhTasks,
  };
  const parked = {
    at: PARKING_AT, root, evaluated: true, reason: null,
    parked_total: pTasks.length, reported_passed: pEntries.length, timeout_ms: 10000,
    counts, entries: pEntries, tasks: pTasks, ...parkedOverrides,
  };
  return { ...nh, parked, ...topOverrides };
}

function writeParkingCarrier(root, obj) {
  const file = path.join(root, PARKING_READING_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof obj === 'string' ? obj : `${JSON.stringify(obj, null, 2)}\n`);
  return file;
}

/** 一个 body-PARKED 的任务体（与 ready-pool-check.isParked / readUnparkDeclaration 的真实形状一致）。 */
function writeParkedTask(root, id, command = 'echo landed') {
  const body =
    `---\nid: ${id}\ntitle: "fixture ${id}"\nstatus: ready\nlabels:\n  - gap\nparent: null\nchildren: []\nextra: {}\n---\n` +
    `**PARKED**（fixture, 2026-11-06 — execution suspended pending the check below）\n\n` +
    `## Proposal\n\nFixture task for the meta-driver parking reading (well over forty non-whitespace characters).\n\n` +
    `## Unpark\n\n- **unpark 检查（只读、可直接跑）**：\`${command}\` —— 输出 \`landed\` 即解除 park。\n`;
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', `${id}.md`), body);
}

test('parking 正臂: 读数取自生产载体（计数与载体逐字一致；⛔ 不重跑探测器冒充读数）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-parking-carrier-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 前提：这个根**没有 tasks/**。现扫必然 evaluated:false（no-tasks-dir）⇒ 若实现自作主张重扫，
  // 下面的 evaluated:true 就不可能成立（负控制内建在夹具里，⛔ 不是另加一条断言就能伪装）。
  assert.equal(fs.existsSync(path.join(root, 'tasks')), false, '前提：夹具根没有 tasks/');
  const counts = { 'unpark-passed': 2, 'unpark-still-blocked': 5, 'no-unpark-check': 0, 'not-evaluated': 0 };
  const entries = [parkedEntry('gap-a'), parkedEntry('gap-b')];
  const tasks = [...entries, parkedEntry('gap-c', 'unpark-still-blocked'), parkedEntry('gap-d', 'unpark-still-blocked')];
  writeParkingCarrier(root, carrierFixture(root, { counts, entries, tasks }));

  const r = collectParkingReadings(root, { now: Date.parse(PARKING_AT) + 1000 });
  assert.equal(r.parked.source, 'carrier');
  assert.equal(r.parked.evaluated, true, `载体可读时必须出判定：${JSON.stringify(r.parked)}`);
  assert.equal(r.parked.counts, undefined === r.parked.counts ? undefined : r.parked.counts);
  assert.deepEqual(r.parked.counts, counts, '四态计数必须与载体逐字一致（AC 的等值判据）');
  assert.deepEqual(r.parked.entries.map((e) => e.id), ['gap-a', 'gap-b']);
  assert.equal(r.parked.ageMs, 1000, '年龄由载体 at 与 now 算出（载体新鲜度对读数是可见的）');
  assert.equal(r.needsHuman.source, 'carrier');
  // 与 AC 判据同一形态的等值比较（JSON 文本级）：读出来的就是盘上那四个数。
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, PARKING_READING_REL), 'utf8'));
  assert.equal(JSON.stringify(onDisk.parked.counts), JSON.stringify(r.parked.counts));
});

test('parking 正臂: 载体缺失 ⇒ 现跑同一个探测器（live-scan），四态齐全且回退可见', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-parking-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeParkedTask(root, 'gap-fixture-live-passed', 'echo landed');
  writeParkedTask(root, 'gap-fixture-live-blocked', 'false');
  // 前提：没有载体（否则这条用例就退化成上一条）。
  assert.equal(fs.existsSync(path.join(root, PARKING_READING_REL)), false, '前提：夹具里没有生产载体');

  const r = collectParkingReadings(root);
  assert.equal(r.parked.source, 'live-scan');
  assert.equal(r.parked.evaluated, true, `任务目录可读 ⇒ 必须出判定：${JSON.stringify(r.parked)}`);
  assert.match(String(r.parked.carrierProblem), /no carrier/, '回退必须留在读数里（⛔ 静默换源）');
  for (const k of ['unpark-passed', 'unpark-still-blocked', 'no-unpark-check', 'not-evaluated']) {
    assert.equal(typeof r.parked.counts[k], 'number', `四态之一缺失：${k} in ${JSON.stringify(r.parked.counts)}`);
  }
  assert.deepEqual(r.parked.entries.map((e) => e.id), ['gap-fixture-live-passed'], '只上报「检查已通过」的那条');
  assert.equal(r.parked.counts['unpark-still-blocked'], 1);
});

test('parking 负臂: 两路都读不成 ⇒ evaluated:false + reason，counts 为 null（⛔ 不与四态全 0 同形）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-parking-none-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 没有载体、也没有 tasks/ ⇒ 现扫同样 evaluated:false。
  const r = collectParkingReadings(root, { allowScan: false });
  assert.equal(r.parked.evaluated, false);
  assert.equal(r.parked.counts, null, '未评估时 counts 必须是 null——全 0 会被读成「查过了，一条都没有」');
  assert.equal(r.parked.entries, null);
  assert.ok(r.parked.reason && r.parked.reason.length > 0, '未评估必须带 reason');
  assert.equal(r.needsHuman.evaluated, false);
  assert.equal(r.needsHuman.counts, null);
});

test('parking 负臂: 载体本身 evaluated:false（生产方落的是全 0 计数）⇒ 消费侧翻成 null，带上它自己的 reason', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-parking-uneval-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zero = { 'unpark-passed': 0, 'unpark-still-blocked': 0, 'no-unpark-check': 0, 'not-evaluated': 0 };
  writeParkingCarrier(root, carrierFixture(root, {
    parkedOverrides: { evaluated: false, reason: 'no-tasks-dir', counts: zero, entries: [], tasks: [], reported_passed: 0 },
  }));

  const r = collectParkingReadings(root, { allowScan: false });
  assert.equal(r.parked.source, 'carrier', '生产方自己没评估成，仍是一个有效读数（不是本层读不懂）');
  assert.equal(r.parked.evaluated, false);
  assert.equal(r.parked.reason, 'no-tasks-dir');
  assert.equal(r.parked.counts, null, '载体里的全 0 计数 ⛔ 不得原样透传（那会把「没查成」读成「全部仍阻塞」）');
});

test('parking 负臂: 载体读不懂/自相矛盾/来自别的工作区 ⇒ 不采用；allowScan:false 时是未评估而非空清单', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-parking-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // (a) 不是 JSON
  writeParkingCarrier(root, '{ this is not json');
  const a = collectParkingReadings(root, { allowScan: false });
  assert.equal(a.parked.evaluated, false);
  assert.match(String(a.parked.carrierProblem), /unreadable/);
  assert.equal(a.parked.counts, null);

  // (b) 自相矛盾：reported_passed 与 entries 长度不一致 ⇒ 载体不是这一版写出来的，整臂不信
  const bad = carrierFixture(root, { parkedOverrides: { reported_passed: 9 } });
  writeParkingCarrier(root, bad);
  const b = collectParkingReadings(root, { allowScan: false });
  assert.equal(b.parked.evaluated, false);
  assert.match(String(b.parked.carrierProblem), /self-inconsistent/);

  // (c) 载体描述的是另一个工作区 ⇒ 不能把别处的板读成这一轮的这块板
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-parking-other-'));
  try {
    writeParkingCarrier(root, carrierFixture(other));
    const c = collectParkingReadings(root, { allowScan: false });
    assert.equal(c.parked.evaluated, false);
    assert.match(String(c.parked.carrierProblem), /different workspace/);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test('parking digest: 点名清单进摘要；计数/年龄不进（⛔ 每轮抖动的量不得唤醒语义半）', () => {
  const withParking = (p) => {
    const r = mkReadings('fail', 'same');
    r.parking = p;
    return r;
  };
  const arm = (over = {}) => ({
    at: PARKING_AT, evaluated: true, reason: null, source: 'carrier', carrierProblem: null, ageMs: 1000,
    counts: { 'unpark-passed': 1, 'unpark-still-blocked': 0, 'no-unpark-check': 4, 'not-evaluated': 0 },
    parkedTotal: 5, reportedPassed: 1, entries: [parkedEntry('gap-goal-driver-filing-ledger')],
    ...over,
  });
  const nhArm = (over = {}) => ({
    at: PARKING_AT, evaluated: true, reason: null, source: 'carrier', carrierProblem: null, ageMs: 1000,
    counts: { 'parking-reason-stale': 0, 'still-blocked': 0, 'no-registered-judge': 0, 'not-evaluated': 0 },
    needsHumanTotal: 0, reportedStale: 0, stale: [], ...over,
  });
  const reading = (parked, needsHuman = nhArm()) => withParking({ parked, needsHuman });

  const base = reading(arm());
  // ①「解停条件已成立」这件事必须改变摘要（否则语义半不被唤醒，读数仍然到不了能处置它的层）
  assert.notEqual(readingsDigest(base), readingsDigest(reading(arm({ entries: [], counts: { ...arm().counts, 'unpark-passed': 0, 'no-unpark-check': 5 }, reportedPassed: 0 }))),
    '点名清单从有到无必须改变摘要');
  assert.notEqual(readingsDigest(base), readingsDigest(reading(arm({ entries: [parkedEntry('gap-other')] }))),
    '被点名的 id 换了必须改变摘要');
  // ②四态里的常态计数与年龄 ⛔ 不进摘要（它们每轮都可能变，进了会让变化检测恒为真）
  assert.equal(readingsDigest(base), readingsDigest(reading(arm({ counts: { ...arm().counts, 'unpark-still-blocked': 3 }, ageMs: 999999, at: '2026-01-01T00:00:00.000Z' }))),
    '计数/年龄变化不得改变摘要');
  // ③未评估与「一条都没有」不同形（硬规则 3b）
  const unevaluated = reading(arm({ evaluated: false, reason: 'no carrier', source: null, counts: null, entries: null }));
  const none = reading(arm({ entries: [], reportedPassed: 0, counts: { ...arm().counts, 'unpark-passed': 0, 'no-unpark-check': 5 } }));
  assert.notEqual(readingsDigest(unevaluated), readingsDigest(none));
  assert.notEqual(readingsDigest(unevaluated), readingsDigest(base));
  // ④读数整维缺失 ⛔ 不得与「查过、没有一条」同形（硬规则 3b 的合格侧伪装）
  const missing = mkReadings('fail', 'same');
  const allUnevaluated = reading(
    arm({ evaluated: false, reason: 'no carrier', source: null, counts: null, entries: null }),
    nhArm({ evaluated: false, reason: 'no carrier', source: null, counts: null, stale: null }),
  );
  assert.notEqual(readingsDigest(missing), readingsDigest(none), '缺这一维 ⛔ 不得落成 parked:none');
  assert.equal(readingsDigest(missing), readingsDigest(allUnevaluated), '缺这一维与两臂皆未评估同 token');
  // ⑤needs-human 臂同一条纪律（兄弟实例，硬规则 5b）
  assert.notEqual(readingsDigest(base), readingsDigest(reading(arm(), nhArm({ stale: [{ id: 'gap-nh', state: 'parking-reason-stale', judge: 'unsatisfiableUnannotatedAc', recordedReason: 'x', currentHits: [], note: 'n' }], reportedStale: 1, counts: { 'parking-reason-stale': 1, 'still-blocked': 0, 'no-registered-judge': 0, 'not-evaluated': 0 } }))),
    'needs-human 停放理由失效也必须改变摘要');
  // ⑥纯函数：⛔ 不改输入、⛔ 不抛（缺字段的旧读数照样能算）
  assert.deepEqual(readingsDigestPartsForParking(undefined).length, 2);
});

// ── gap-meta-readingsdigestpartsforparking：readings 的每一个顶层键都必须在 probe 规格里被声明 ──
//
// 缺陷原样：`plugin/probes/meta-driver.md` 只声明了 readings 的**一部分**顶层键（goals/criteria/
// divergences/drivers/syncHealth/metaRecords/focus），而 `timeSeries` / `inertCheckers` /
// `actionRecordFailures` / `parking` 四个键每轮随 readings 一并送到语义半，却既无释义也无处置口径
// ⇒ 读到了、但没有任何动作由它触发（兄弟实例 gap-meta-addressedtasks-input-without-output-channel）。
//
// ⛔ 键清单【不写死在测试里】：从 `MetaRoundReadings` 的接口体按位置取。写死一份清单会在下一次给
// readings 加键时静默过期，而「静默过期」正是本缺陷的形态（硬规则 5b）。
const META_DRIVER_SRC_PATH = path.join(repoRoot, 'plugin', 'scripts', 'meta-driver.ts');
const META_DRIVER_SPEC_PATH = path.join(repoRoot, 'plugin', 'probes', 'meta-driver.md');
const META_DRIVER_SRC = fs.readFileSync(META_DRIVER_SRC_PATH, 'utf8');
const META_DRIVER_SPEC = fs.readFileSync(META_DRIVER_SPEC_PATH, 'utf8');

/** 本任务点名的四个键——只用于「反空转」断言：证明键清单真的取全了，而不是覆盖判定漏读了它们。 */
const UNDECLARED_READINGS_KEYS = ['timeSeries', 'inertCheckers', 'actionRecordFailures', 'parking'];

/** 处置口径必须落到的输出通道词表（parking 的处置面是「人/manager」，故 manager 也在内）。 */
const DISPOSITION_CHANNELS = ['divergences', 'proposals', 'autoDrive', 'decisions', 'metaRecordOpinions', 'manager'];

/** 负控材料：造一份「从未声明该键」的规格——删掉声明块，并抹掉残留提及。
 *  ⛔ 只删块不抹提及是不够的：`includes` 会被散文里的同名提及满足（`Unparking` 就含 `parking`），
 *  那样负控永远取不到假，等于没做负控。 */
function specWithoutDeclaration(text, key) {
  const block = probeKeyBlock(text, key);
  assert.ok(block, `${key}: 先决条件——当前规格里必须有声明块，否则这个负控测的是别的东西`);
  return text.replace(block, '').split(key).join('〔removed〕');
}

test('AC1: readings 的每一个顶层键都在 probe 规格里被具名（键清单取自接口声明，⛔ 非手写清单）', () => {
  const keys = readingsTopLevelKeys(META_DRIVER_SRC);
  assert.notEqual(keys, null, `接口 ${META_ROUND_READINGS_INTERFACE} 的键清单必须能读出（⛔ 读不出不得当成"没有缺声明"）`);
  assert.ok(keys.length > 0, '键清单不能为空');
  // 反空转：清单里必须真有本任务点名的四个键 + 两个原本就在的老键——否则「零缺声明」可能只是清单没取全
  for (const k of [...UNDECLARED_READINGS_KEYS, 'goals', 'focus']) {
    assert.ok(keys.includes(k), `从接口取出的键清单缺 ${k}：${keys.join(',')}`);
  }
  const missing = undeclaredReadingsKeys(keys, META_DRIVER_SPEC);
  assert.notEqual(missing, null, '键清单与规格都可读 ⇒ 必须给出判定（⛔ 不得停在未评估）');
  assert.deepEqual(missing, [], `probe 规格里缺这些 readings 键的声明：${(missing ?? []).join(',')}`);
});

test('AC1 负控: 少声明一个键 ⇒ 判红并点名它（四个键逐个取假，且原规格必须为绿）', () => {
  const keys = readingsTopLevelKeys(META_DRIVER_SRC);
  for (const key of UNDECLARED_READINGS_KEYS) {
    const damaged = specWithoutDeclaration(META_DRIVER_SPEC, key);
    assert.deepEqual(undeclaredReadingsKeys(keys, damaged), [key],
      `删掉 ${key} 的声明后判据必须点名它（否则这一条与「恒绿」同形）`);
    // 另一个方向：原规格必须判绿——两个方向都断，防「判据恒红」这种同样无信息的形态
    assert.deepEqual(undeclaredReadingsKeys(keys, META_DRIVER_SPEC), []);
  }
});

test('AC1 未评估态: 接口读不出 / 规格为空 ⇒ null（⛔ 不与 [] =「查过、全声明」同形，硬规则 3b）', () => {
  assert.equal(readingsTopLevelKeys('export interface MetaRoundReadings { }'), null, '空接口体 ⇒ 未评估');
  assert.equal(readingsTopLevelKeys('no such interface here'), null, '没有该接口 ⇒ 未评估');
  assert.equal(readingsTopLevelKeys(''), null);
  const keys = readingsTopLevelKeys(META_DRIVER_SRC);
  assert.equal(undeclaredReadingsKeys(null, META_DRIVER_SPEC), null, '键清单读不出 ⇒ 未评估');
  assert.equal(undeclaredReadingsKeys([], META_DRIVER_SPEC), null, '空键清单 ⇒ 未评估（空清单判什么都恒绿）');
  assert.equal(undeclaredReadingsKeys(keys, ''), null, '规格为空 ⇒ 未评估');
  assert.equal(undeclaredReadingsKeys(keys, '   \n'), null);
});

test('AC2: 四个键各自的声明块有释义与处置口径（⛔ 不是只出现一个词）', () => {
  for (const key of UNDECLARED_READINGS_KEYS) {
    const block = probeKeyBlock(META_DRIVER_SPEC, key);
    assert.notEqual(block, null, `${key}: 必须有一个属于它自己的项目符号声明块（⛔ 不是散文里的提及）`);
    assert.ok(block.startsWith(`- \`${key}\``), `${key}: 块首必须点出键名`);
    // 释义：块必须有实质内容，⛔ 不是 `- \`parking\`: see readings`
    assert.ok(declarationDensity(block) >= 200,
      `${key}: 声明块太薄（非空白字符 ${declarationDensity(block)}）——释义与处置口径都要在块里`);
    // 处置口径：块必须把读数落到一条输出通道（或「人/manager」这类人处置面）上
    assert.ok(DISPOSITION_CHANNELS.some((c) => block.includes(c)),
      `${key}: 处置口径缺失——块里没有任何输出通道（${DISPOSITION_CHANNELS.join(' / ')}）`);
  }
  // parking 的处置口径是任务点名的那个具体口径（两条都断，缺任一条即红）
  const parking = probeKeyBlock(META_DRIVER_SPEC, 'parking');
  assert.match(parking, /unpark-passed/, 'parking 必须点名「解停检查已通过」那一群');
  assert.match(parking, /human\/manager|人\/manager|manager/, 'parking 的点名 id 必须路由到人/manager');
  assert.match(parking, /⛔[\s\S]{0,400}PARKED|PARKED[\s\S]{0,400}⛔/,
    '⛔ 机件不自行删标记——这条禁令必须写在 parking 的声明块里');
});

test('AC2 负控: 把声明块削成一句「见 readings」⇒ 释义与处置口径都判红（判据能取假）', () => {
  const thin = META_DRIVER_SPEC.replace(probeKeyBlock(META_DRIVER_SPEC, 'timeSeries'), '- `timeSeries`: see readings.');
  const block = probeKeyBlock(thin, 'timeSeries');
  assert.notEqual(block, null);
  assert.ok(declarationDensity(block) < 200, `负控样本必须低于密度下限，否则这一条测的不是密度：${declarationDensity(block)}`);
  assert.ok(!DISPOSITION_CHANNELS.some((c) => block.includes(c)), '负控样本必须不带任何输出通道');
  // 另一个方向：真规格在同两条断言上必须通过
  const real = probeKeyBlock(META_DRIVER_SPEC, 'timeSeries');
  assert.ok(declarationDensity(real) >= 200);
  assert.ok(DISPOSITION_CHANNELS.some((c) => real.includes(c)));
});

// ── DivergenceKind ↔ probe 规格：每一个 kind 都必须在规格里被具名 ────────────────────────────────
//
// 缺陷形态（与上面的 readings 顶层键同形，只换了一维；tasks/gap-meta-active-but-failing）：
// 给 `DivergenceKind` 加一个成员，而 `plugin/probes/meta-driver.md` 仍在教语义半「五类」「handler.kind
// 只有这三种映射」——新 kind 就以【未声明的取值】抵达读者：读到了，但没有任何处置口径由它触发
// （硬规则 3b 的反面：读者的词表里没有这个取值，它就无法区分「这是新读数」与「这是噪音」）。
// `DIVERGENCE_HANDLER_KIND` 由 `Record<DivergenceKind, string>` 在类型层兜住；规格这一侧没有兜底，
// 所以这里给一个。⛔ 成员清单【不写死】：从 `export type DivergenceKind` 的联合体按位置取
// （写死清单会在下一次加 kind 时静默过期，而静默过期正是本缺陷的形态，硬规则 5b）。
function divergenceKindMembers(src) {
  const text = typeof src === 'string' ? src : '';
  const at = text.indexOf('export type DivergenceKind');
  if (at < 0) return null; // 读不出 ⇒ 未评估（⛔ 不与「没有缺声明」同形）
  const kinds = [];
  let closed = false;
  for (const line of text.slice(at).split('\n').slice(1)) {
    const m = line.match(/^\s*\|\s*"([a-z0-9-]+)"\s*(;?)\s*$/);
    if (!m) continue;
    kinds.push(m[1]);
    if (m[2] === ';') { closed = true; break; }
  }
  // 没读到联合体结尾 / 一个成员都没读到 ⇒ 未评估，⛔ 不是「取全了」
  return closed && kinds.length > 0 ? kinds : null;
}

test('DivergenceKind ↔ probe 规格: 每一个 kind 都在规格里被具名（清单取自类型联合，⛔ 非手写）', () => {
  const kinds = divergenceKindMembers(META_DRIVER_SRC);
  assert.notEqual(kinds, null, 'DivergenceKind 的成员清单必须能读出（⛔ 读不出不得当成「没有缺声明」）');
  // 反空转：本任务新增的 kind 与五个既有 kind 都必须在清单里——否则「零缺声明」可能只是没取全
  for (const k of ['active-but-failing', 'pass-but-unflipped', 'achieved-but-failing',
    'no-criterion', 'not-evaluated', 'achieved-but-superseder-unmet']) {
    assert.ok(kinds.includes(k), `从联合体取出的清单缺 ${k}：${kinds.join(',')}`);
  }
  const missing = kinds.filter((k) => !META_DRIVER_SPEC.includes(k));
  assert.deepEqual(missing, [], `probe 规格里缺这些 divergence kind 的声明：${missing.join(',')}`);
});

test('DivergenceKind ↔ probe 规格 负控: 抹掉某个 kind 的全部提及 ⇒ 判据恰好点名它（判据能取假）', () => {
  const kinds = divergenceKindMembers(META_DRIVER_SRC);
  assert.notEqual(kinds, null);
  for (const kind of kinds) {
    // ⛔ 只删一处是不够的：同名的另一处提及（handler.kind 清单、输出 schema）会满足 `includes`，
    //    那样负控永远取不到假，等于没做负控（同 specWithoutDeclaration 的道理）。
    const damaged = META_DRIVER_SPEC.split(kind).join('〔removed〕');
    assert.deepEqual(kinds.filter((k) => !damaged.includes(k)), [kind],
      `抹掉 ${kind} 的全部提随后判据必须恰好点名它（否则这一条与「恒绿」同形）`);
  }
  // 另一个方向：原规格必须判绿——两个方向都断，防「判据恒红」这种同样无信息的形态
  assert.deepEqual(kinds.filter((k) => !META_DRIVER_SPEC.includes(k)), []);
});

test('DivergenceKind ↔ probe 规格 未评估态: 联合体读不出 / 规格为空 ⇒ null（⛔ 不与「取全了」同形）', () => {
  assert.equal(divergenceKindMembers('no such type here'), null);
  assert.equal(divergenceKindMembers(''), null);
  assert.equal(divergenceKindMembers(null), null);
  // 有开头但没有结尾的 ';'（读了一半）⇒ 未评估，⛔ 不许把半份清单当成「取全了」
  assert.equal(divergenceKindMembers('export type DivergenceKind =\n  | "a"\n  | "b"'), null);
});
