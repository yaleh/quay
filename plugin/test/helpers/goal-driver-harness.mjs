// Shared harness for the goal-driver shards (split of goal-driver.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../goal-driver.test.mjs", import.meta.url).href;

// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

import {
  goalAchievedFromRecords,
  computeGoalGaps,
  isTaskStuck,
  readTaskFacts,
  checkStaleness,
  checkAchievedFailing,
  readFrozenFailing,
  recheckFrozenFailing,
  // ②b 常设域内立案前复核（gap-standing-violated-false-spawn-no-prefiling-recheck）
  recheckStandingFailing,
  readHostHealth,
  // 复核执行根的新鲜度（gap-frozen-recheck-lagging-checkout-false-gap-filing）：版本半边读数
  readRecheckRootFreshness,
  parseFrozenFailingReading,
  isFilingGapState,
  // ⑥c 缺口可见性 fact（gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact）
  gapViewEntries,
  gapViewFact,
  GOAL_GAPS_FACT_NAME,
  sweepFrozenAcs,
  goalDriverRoutines,
  runGoalRound,
  runGapSpawnPass,
  buildGapWorkerPrompt,
  readReadyPoolJudgment,
  goalSpawnCap,
  goalGapWorkerTimeoutMs,
  // ⑨ 每轮 CI run 载体采集（tasks/gap-develop-ci-first-decisive-green）
  goalCiRunsCollect,
  goalCiRunsThrottleMs,
  GAP_WORKER_TIMEOUT_MS_DEFAULT,
  GOAL_SPAWN_CAP_DEFAULT,
  GOAL_ROUND_REL,
  GOAL_CONTROL_STATE_REL,
  goalCloseBlockFromRecords,
  probeLedger,
  goalFlipDecision,
  targetHealthFact,
  deriveTargetHealth,
  resolveTargetBinding,
  declaredTargetBinding,
  buildHealthProbeArgv,
  parseHealthProbe,
  readDeliveredPluginVersion,
  TARGET_HEALTH_FACT_NAME,
  HEALTH_REQUIRED_CARRIERS,
  HEALTH_OBSERVED_CARRIERS,
  HEALTH_WINDOW_SEC_DEFAULT,
  // 业务目标层（第二层提问：退出条件 ⊨ 业务目标 —— gap-goal-sufficiency-judges-wrong-layer-and-emits-unverifiable-verdict）
  goalSufficiencyVerdict,
  semanticSufficiencyVerdict,
  collectObjectiveEvidence,
  objectiveEvidenceProfile,
  verifyObjectiveAssertion,
  objectiveAssertionCommand,
  objectiveCacheKey,
  objectiveSufficiencyVerdict,
  objectiveSufficiencyVerdictDetail,
  resetObjectiveCacheForTest,
  resetSufficiencyCacheForTest,
  OBJECTIVE_EVIDENCE_CARRIERS,
  OBJECTIVE_ASSERTION_FIELDS,
} from '../../scripts/goal-driver.ts';
import { readsFrozenPopulation } from '../../../packages/quay/src/goal-store.ts';
import { runResidentQualityGateLoop } from '../../scripts/quality-gate-driver.ts';
import { DRIVER_KINDS, KNOWN_KINDS, GOAL_ACCEPTANCE_ACTIVE_ENV } from '../../scripts/driver-runtime.ts';
// cli/driver.ts 的 KINDS 白名单（AC6 断言对象；已导出）。
import { KINDS } from '../../../packages/quay/src/cli/driver.ts';
// goal 动词 argv 的单一构造点 + 「quay CLI 解析得出吗」的判据（AC5 断言对象）。
import { goalStoreArgv, goalCliResolvable } from '../../scripts/meta-driver.ts';


/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。
 *  body 缺省无 `## 退出条件`（= 充分性机械判 insufficient）；需要语义判定接缝的用例显式给 body。 */

// ── I2 纯推导 ─────────────────────────────────────────────────────────────────

// 代码根（goal 动词的 quay CLI 入口从这里解析，经 goalStoreArgv）；数据根（goals/）在各测试里给临时目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(SRC_URL)), '..', '..');

function writeGoalFile(tmp, { id, status, kind, goal, criterion, body = '## body\nx' }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '');
  for (const line of body.split('\n')) lines.push(line);
  lines.push('');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

const goalStoreAbs = path.join(repoRoot, 'packages', 'quay', 'src', 'goal-store.ts');

function writeStandingGoalFile(tmp, { id, status, kind, goal, criterion, longTerm = false }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  if (longTerm) lines.push('long-term: true');
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

/** 造一个**真 git 仓库**夹具根，返回一个有界 git 运行器（`git(args) => stdout`，非零退出即抛）。
 *
 *  为什么需要真仓库（gap-frozen-recheck-lagging-checkout-false-gap-filing）：立案前复核读数的**版本
 *  半边**（`headSha` / `behindDevelop`）量的是「复核跑在哪个根上」——只有真 git 根才有 `HEAD` 与
 *  `develop` 可比。裸 tmp 根上这两个量恒读不出（⛔ 那条路径的既有行为由 s10 的裸根用例守着，不得
 *  被本夹具取代）。另外：criterion 的执行 cwd 由 goal-store 的 `resolveGitRoot(goalDir)` 决定
 *  （goal-store.ts），仓库根就是它 ⇒ 夹具可以用「某个提交里有没有这个文件」直接控制判据真假。
 *  ⛔ git 身份走**子进程 env**，⛔ 不写 repo config（memory: fixture-git-identity-in-child-env）。 */
function mkGitFixtureRoot(tmp, { branch = 'main' } = {}) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const must = (args) => {
    const r = spawnSync('git', ['-C', tmp, ...args], { encoding: 'utf8', env });
    if (r.error) throw new Error(`git ${args.join(' ')} spawn error: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} exit ${r.status}: ${String(r.stderr || '').trim().slice(0, 300)}`);
    return String(r.stdout ?? '').trim();
  };
  must(['init', '-b', branch]);
  return must;
}

function hasPrefilingEvidence(e) {
  return ['ac', 'outcome', 'verdict', 'durationMs'].every((k) => k in e)
    && (('hostFreeBytes' in e) || ('load1' in e));
}

const PRE_CHANGE_ENTRY = {
  ac: 'AC-259',
  outcome: 'confirmed-failing',
  cause: 'still-false',
  reason: "acceptance failed (exit 1) — AC-259: repo version mismatch (want 0.7.0-dev): [('packages/quay/package.json', '0.7.1'), ('packages/quay-native/package.json', '0.7.1'), ('packages/quay-github/package.json', '0.7.1'), ('packages/quay-backlog/package.json', '0.7.1'), ('.claude-plugin/marketplace.json', '0.7.1'), ('plugin/.claude-plugin/marketplace.json', '0.7.1'), ('plugin/.claude-plugin/plugin.json', '0.7.1'), ('plugin/VERSION', '0.7.1')]",
};

function mkTargetRoot({
  missingCarriers = [], pluginVersion, initStateAbsent = false, roundRecords = [],
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-target-'));
  const q = path.join(dir, '.quay');
  fs.mkdirSync(q, { recursive: true });
  for (const name of [...HEALTH_REQUIRED_CARRIERS, ...HEALTH_OBSERVED_CARRIERS]) {
    if (missingCarriers.includes(name)) continue;
    fs.writeFileSync(path.join(q, name), '{}\n', 'utf8');
  }
  for (const name of roundRecords) fs.writeFileSync(path.join(q, name), '{}\n', 'utf8');
  if (!initStateAbsent && pluginVersion !== undefined) {
    fs.writeFileSync(path.join(q, 'quay-init-state.json'), JSON.stringify({ pluginVersion }), 'utf8');
  }
  return dir;
}

const DELIVERED_VERSION = readDeliveredPluginVersion(repoRoot);

function spawnTargetDriverFixture(targetRoot) {
  return spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)', 'worker-driver.js', '--root', targetRoot], { stdio: 'ignore' });
}

function waitForProcessVisible(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).includes('worker-driver.js')) return true;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},120)']); // 有界小睡（不引入额外依赖）
  }
  return false;
}

function cannedProbePrefix(tmp, reading) {
  const f = path.join(tmp, 'canned-probe.js');
  fs.writeFileSync(f, `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify(${JSON.stringify(reading)})+String.fromCharCode(10)));`, 'utf8');
  return ['bash', '-c', `cat >/dev/null; node ${f}`];
}

function judgeCmd(obj) {
  return ['node', '-e', `process.stdout.write(${JSON.stringify(JSON.stringify(obj))})`];
}

function writeEvidenceCarrier(tmp, rows) {
  fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.quay', 'productization-verification.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );
}

function evRecord(ac, { host = 'hostA', project_root = '/p/one', task_id = 'T-1' } = {}) {
  return { ts: '2026-09-12T00:00:00Z', ac, host, project_root, task_id };
}

const OBJECTIVE_GOAL = {
  id: 'GOAL-001',
  title: 't',
  body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n',
};

const OBJECTIVE_ACS = [
  { id: 'AC-001', title: 't1', expect: 'e1', status: 'achieved' },
  { id: 'AC-002', title: 't2', expect: 'e2', status: 'achieved' },
];

function resetObjectiveTestState() {
  resetSufficiencyCacheForTest();
  resetObjectiveCacheForTest();
}

function derivedCriterionRecords() {
  return [
    { id: 'GOAL-900', title: 'closed goal', status: 'achieved' },
    { id: 'AC-203', title: 'frozen subject', status: 'achieved', goal: 'GOAL-900', expect: 'e', criterion: 'exit 1' },
    { id: 'AC-242', title: 'derived meta', status: 'achieved', goal: 'GOAL-900', longTerm: true, expect: 'e', criterion: 'node goal-store.ts check --stale-pass' },
    { id: 'AC-214', title: 'ordinary standing', status: 'achieved', goal: 'GOAL-900', longTerm: true, expect: 'e', criterion: 'exit 0' },
  ];
}

const derivedByAc = (gaps) => new Map(gaps.map((g) => [g.ac, g]));

const ALL_GAP_STATES = ['gap', 'done-unresolved', 'stalled', 'not-evaluated', 'standing-violated', 'frozen-violated', 'derived-routed', 'in-progress', 'standing-ok'];

const QUIET_GAP_STATES = ['in-progress', 'standing-ok'];

export { ALL_GAP_STATES, DELIVERED_VERSION, DRIVER_KINDS, mkGitFixtureRoot, readRecheckRootFreshness, GAP_WORKER_TIMEOUT_MS_DEFAULT, GOAL_ACCEPTANCE_ACTIVE_ENV, GOAL_CONTROL_STATE_REL, GOAL_GAPS_FACT_NAME, GOAL_ROUND_REL, GOAL_SPAWN_CAP_DEFAULT, HEALTH_OBSERVED_CARRIERS, HEALTH_REQUIRED_CARRIERS, HEALTH_WINDOW_SEC_DEFAULT, KINDS, KNOWN_KINDS, OBJECTIVE_ACS, OBJECTIVE_ASSERTION_FIELDS, OBJECTIVE_EVIDENCE_CARRIERS, OBJECTIVE_GOAL, PRE_CHANGE_ENTRY, QUIET_GAP_STATES, TARGET_HEALTH_FACT_NAME, assert, buildGapWorkerPrompt, buildHealthProbeArgv, cannedProbePrefix, checkAchievedFailing, checkStaleness, collectObjectiveEvidence, computeGoalGaps, declaredTargetBinding, deriveTargetHealth, derivedByAc, derivedCriterionRecords, evRecord, fileURLToPath, fs, gapViewEntries, gapViewFact, goalAchievedFromRecords, goalCiRunsCollect, goalCiRunsThrottleMs, goalCliResolvable, goalCloseBlockFromRecords, goalDriverRoutines, goalFlipDecision, goalGapWorkerTimeoutMs, goalSpawnCap, goalStoreAbs, goalStoreArgv, goalSufficiencyVerdict, hasPrefilingEvidence, isFilingGapState, isTaskStuck, judgeCmd, mkTargetRoot, objectiveAssertionCommand, objectiveCacheKey, objectiveEvidenceProfile, objectiveSufficiencyVerdict, objectiveSufficiencyVerdictDetail, os, parseFrozenFailingReading, parseHealthProbe, path, probeLedger, readDeliveredPluginVersion, readFrozenFailing, readHostHealth, readReadyPoolJudgment, readTaskFacts, readsFrozenPopulation, recheckFrozenFailing, recheckStandingFailing, repoRoot, resetObjectiveCacheForTest, resetObjectiveTestState, resetSufficiencyCacheForTest, resolveTargetBinding, runGapSpawnPass, runGoalRound, runResidentQualityGateLoop, semanticSufficiencyVerdict, spawn, spawnSync, spawnTargetDriverFixture, sweepFrozenAcs, targetHealthFact, test, verifyObjectiveAssertion, waitForProcessVisible, writeEvidenceCarrier, writeGoalFile, writeStandingGoalFile };
