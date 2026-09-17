// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver-s06.test.mjs by gap-suite-split-15-over-30s-test-files — new shard 8 (4 tests): the ⑨ 每轮 CI run 载体采集 section. Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { assert, fs, goalCiRunsCollect, goalCiRunsThrottleMs, os, path, repoRoot, runGoalRound, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

// ── ⑨ 每轮 CI run 载体采集的生产调用点（tasks/gap-develop-ci-first-decisive-green）──────────────
//
// 这一节钉的是「采集器有生产消费者」这件事实本身：判据 AC-265 读的是本地载体 `.quay/ci-runs.jsonl`，
// 没有调用点时它只能报 carrier-absent / collection-stalled —— 而那与「CI 真红」在读法上同形（硬规则 3b）。
// ⛔ 同时钉住「没采集」与「采集了零条」不同形：round 记录里的 `ciRuns` **恒存在**，缺省是显式的
// `disabled`，⛔ 不是一个被省略的键。


test('⑨ ciRuns — 开关未置位时轮记录里仍是显式的 disabled（⛔ 不是缺键、不是 ok(0)）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-off-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const { fact } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      ciRunsCollect: false,
    });
    const v = fact.value;
    assert.ok(v.ciRuns && typeof v.ciRuns === 'object', 'value.ciRuns 必须存在（缺键即判假）');
    assert.equal(v.ciRuns.status, 'disabled');
    assert.equal(v.ciRuns.ran, false);
    assert.match(v.ciRuns.reason, /ci_runs_collect/);
    assert.match(fact.reason, /ciRuns=disabled/, '轮记录 reason 带调用痕（人可读的那一半）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('⑨ ciRuns — 置位时注入的采集函数被真调用，读数落进轮记录（这就是「由该路径写入」的证据形态）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-on-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const seen = [];
    const { fact } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      ciRunsCollect: true,
      ciRunsCollectFn: (root, o) => {
        seen.push({ root, throttleMs: o.throttleMs });
        return {
          status: 'ok',
          ran: true,
          reason: '采集 3 条，追加 2 条，补全 1 条',
          carrier: path.join(root, '.quay', 'ci-runs.jsonl'),
          appended: 2,
          skipped: 1,
          attributed: 2,
          enriched: 1,
          logsFetched: 3,
          testFilesDerived: 2,
          warnings: [],
        };
      },
    });
    assert.equal(seen.length, 1, '每轮恰好调一次');
    assert.equal(seen[0].root, tmp, '调用点是本 driver 的 root（载体就落在它的 .quay/ 下）');
    const v = fact.value;
    assert.equal(v.ciRuns.status, 'ok');
    assert.equal(v.ciRuns.appended, 2);
    assert.equal(v.ciRuns.enriched, 1, '补全数也是读数的一部分（它是「回填补上了」的直接量）');
    assert.match(fact.reason, /ciRuns=ok\(appended=2,enriched=1,attributed=2,logs=3\)/, '调用痕逐字进 reason');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('⑨ ciRuns — 采集抛错不掀翻整轮（旁路读数），且折算成可区分的 error 读数', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-err-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const { fact } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      ciRunsCollect: true,
      ciRunsCollectFn: () => {
        throw new Error('boom-gh');
      },
    });
    assert.equal(fact.state, 'verified', '采集坏掉不得把整轮判失败');
    assert.equal(fact.value.ciRuns.status, 'error');
    assert.match(fact.value.ciRuns.reason, /boom-gh/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('⑨ ciRuns — 开关与节流从 drivers.yml 就地读（代码缺省 false / 采集器常量缺省）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-cfg-'));
  try {
    assert.equal(goalCiRunsCollect(tmp), false, 'drivers.yml 不在 ⇒ 代码缺省 false（⛔ 不默认打开网络采集）');
    assert.equal(goalCiRunsCollect(tmp, true), true, '显式 true 压过缺省（测试缝/CLI）');
    fs.mkdirSync(path.join(tmp, 'plugin', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'plugin', 'scripts', 'drivers.yml'),
      'version: 1\nkinds:\n  goal:\n    ci_runs_collect: true\n    ci_runs_collect_throttle_ms: 1234\n',
      'utf8',
    );
    assert.equal(goalCiRunsCollect(tmp), true, '配置真源置位 ⇒ 开');
    assert.equal(goalCiRunsThrottleMs(tmp), 1234, '节流从配置读');
    assert.equal(goalCiRunsThrottleMs(tmp, 0), 0, '0 是合法值（= 不节流），⛔ 不被当成「未指定」');
    // 缺字段 ⇒ 回落到采集器自己的常量（⛔ 不在这里再写一个字面量）
    fs.writeFileSync(path.join(tmp, 'plugin', 'scripts', 'drivers.yml'), 'version: 1\nkinds:\n  goal:\n    cap: 5\n', 'utf8');
    assert.equal(goalCiRunsThrottleMs(tmp), 600000, '回落 DEFAULT_COLLECT_THROTTLE_MS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
