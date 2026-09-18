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
import { GOAL_ACCEPTANCE_ACTIVE_ENV, PRE_CHANGE_ENTRY, assert, fs, hasPrefilingEvidence, mkGitFixtureRoot, os, path, readHostHealth, readRecheckRootFreshness, recheckFrozenFailing, repoRoot, runGoalRound, spawn, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

/** 本 shard 新增的夹具根：**真 git 仓库**（复核根的版本半边只有真仓库才读得出）。
 *  goals/ 与 tasks/ 先建好，再 `git init` —— 顺序无关，但要让「工作树里有没有 fix-landed.txt」
 *  这个量与 git 提交状态一一对应，故 fixture 的每个提交都显式 add。 */
function mkLaggingRootFixture(prefix, writeGoals) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
  const git = mkGitFixtureRoot(tmp);
  fs.writeFileSync(path.join(tmp, '.gitignore'), '.quay/\n', 'utf8');
  writeGoals(tmp);
  // base 提交（含 goals/*.md）后 main 与 develop **同点** —— 起始状态即「复核根与 develop 齐平」。
  git(['add', '-A']);
  git(['commit', '-m', 'base']);
  git(['branch', 'develop']);
  return { tmp, git };
}

test('AC1+AC2+AC5：复核根滞后 develop ⇒ 独立取值 checkout-lagging-develop（不立案）；根齐平 ⇒ 照旧 confirmed-failing + 立案', async () => {
  const { tmp, git } = mkLaggingRootFixture('goal-driver-lagging-root-', (root) => {
    writeStandingGoalFile(root, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(root, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: 'test -f fix-landed.txt' });
  });
  try {
    const baseSha = git(['rev-parse', 'HEAD']);

    // ── 第 1 轮 = AC2 臂（⛔ 不得一律放过）：根与 develop **齐平**、判据真为假 ⇒ 照旧立案 ────────────
    const r1 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const e1 = r1.fact.value.frozenRecheck.entries.find((e) => e.ac === 'AC-900');
    assert.ok(e1, `第 1 轮：AC-900 有复核读数（实测 entries=${JSON.stringify(r1.fact.value.frozenRecheck.entries.map((e) => [e.ac, e.outcome]))}）`);
    assert.equal(e1.outcome, 'confirmed-failing', '第 1 轮：根与 develop 齐平 ⇒ 照旧 confirmed-failing（正控制：⛔ 不是一律放过）');
    assert.equal(e1.cause, 'still-false');
    assert.equal(e1.verdict, 'fail');
    assert.equal(e1.behindDevelop, 0, 'AC5：复核根**落后 develop 的提交数**落痕 = 0（齐平，⛔ 与「读不到」不同形）');
    assert.equal(e1.headSha, baseSha, 'AC5：复核执行根的 HEAD sha 落痕 = 夹具此刻的真实 HEAD（独立复核，⛔ 不是自证）');
    const g1 = new Map(r1.fact.value.gaps.map((g) => [g.ac, g.state]));
    assert.equal(g1.get('AC-900'), 'frozen-violated', '第 1 轮：照常产出 frozen-violated');
    assert.deepEqual(r1.fact.value.gap_spawns.map((s) => s.ac), ['AC-900'], '第 1 轮：gap_spawns 含该 AC');

    // 「修复落地在 develop」：一次真提交（⛔ 不动工作树、不动判据文本 ⇒ criterionHash 不变，
    // 台账尾那条 fail 仍描述当前判据）。工作树随后回到 main ⇒ 复核根**滞后 develop**。
    git(['checkout', 'develop']);
    fs.writeFileSync(path.join(tmp, 'fix-landed.txt'), '', 'utf8');
    git(['add', 'fix-landed.txt']);
    git(['commit', '-m', 'fix']);
    git(['checkout', 'main']);

    // ── 第 2 轮 = AC1 臂（本通道被挡住）：根滞后 develop、而 develop 上已有使判据转绿的提交 ──────────
    const r2 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    assert.deepEqual(r2.fact.value.frozenFailing.failing, ['AC-900'],
      '第 2 轮：台账读数**仍然**说此刻为假（轮转尚未轮到它）——这正是缺陷的输入，⛔ 不是被修好了');
    const e2 = r2.fact.value.frozenRecheck.entries.find((e) => e.ac === 'AC-900');
    assert.ok(e2, '第 2 轮：AC-900 有复核读数');
    assert.equal(e2.verdict, 'fail', '第 2 轮：判据在那个根上**确实**非 0 —— 本条读数不等于「复核通过」（⛔ 不与 cleared 同形）');
    assert.equal(e2.outcome, 'not-evaluated', '第 2 轮：独立取值 not-evaluated（⛔ 不是 confirmed-failing）');
    assert.equal(e2.cause, 'checkout-lagging-develop', '第 2 轮：成因 = 复核根滞后 develop');
    assert.equal(e2.behindDevelop, 1, 'AC5：落后 1 个提交（develop 上那条 fix），实测落痕');
    assert.equal(e2.headSha, baseSha, 'AC5：HEAD 仍是 main 的 base（复核量的是这个根，不是 develop）');
    const g2 = new Map(r2.fact.value.gaps.map((g) => [g.ac, g.state]));
    assert.equal(g2.get('AC-900'), undefined,
      '第 2 轮：AC1「不产出该 AC 的 frozen-violated（gaps 无该条）」—— 本轮**该 AC 一条读数都不产出**'
      + '（既不 frozen-violated、也不落别的态：那条 fail 量的是滞后的根 ⇒ 本轮无可立）；'
      + `实测 gaps=${JSON.stringify(r2.fact.value.gaps.map((g) => [g.ac, g.state]))}`);
    assert.deepEqual(r2.fact.value.gap_spawns.map((s) => s.ac), [],
      '第 2 轮：不 spawn（⛔ 不给下游指一个可能不存在的缺陷）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC4：五个取值逐条区分（checkout-lagging-develop / now-true / still-false / guard-refused / unreadable 互为不等）', async () => {
  const { tmp, git } = mkLaggingRootFixture('goal-driver-five-states-', (root) => {
    writeStandingGoalFile(root, { id: 'GOAL-901', status: 'achieved', kind: 'goal' });
    // AC-901 在 develop 的 fix 提交里转绿；AC-902 恒假（两个根上都假）
    writeStandingGoalFile(root, { id: 'AC-901', status: 'achieved', kind: 'criterion', goal: 'GOAL-901', criterion: 'test -f fix-landed.txt' });
    writeStandingGoalFile(root, { id: 'AC-902', status: 'achieved', kind: 'criterion', goal: 'GOAL-901', criterion: 'exit 1' });
  });
  const prevEnv = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
  try {
    const key = (e) => `${e.outcome}/${e.cause}`;
    const violated = { failing: ['AC-901'], judgment: 'violated', cause: null, frozenScope: 1 };

    // (2) 起点：根与 develop **齐平**（fixture 刚建），AC-902 恒假 ⇒ still-false。
    //     ⛔ 这一臂必须在「推进 develop」之前取 —— 否则它量的就不是「根齐平且真为假」那个状态了。
    const still = await recheckFrozenFailing(repoRoot, tmp, { ...violated, failing: ['AC-902'] });
    assert.equal(key(still.entries[0]), 'confirmed-failing/still-false', '根齐平 + 判据真为假 ⇒ 照旧 confirmed-failing');
    assert.equal(still.entries[0].behindDevelop, 0, '这一臂的根确实齐平（⛔ 与滞后臂同夹具、只有这一个量不同）');

    // 「修复落到 develop」：一次真提交（⛔ 不动工作树，⛔ 不动判据文本）⇒ 复核根此后滞后 develop。
    git(['checkout', 'develop']);
    fs.writeFileSync(path.join(tmp, 'fix-landed.txt'), '', 'utf8');
    git(['add', 'fix-landed.txt']);
    git(['commit', '-m', 'fix']);
    git(['checkout', 'main']);

    // (1) 根滞后 develop + AC-901 在 develop 上已转绿 ⇒ 第五个取值
    const lag = await recheckFrozenFailing(repoRoot, tmp, violated);
    assert.equal(key(lag.entries[0]), 'not-evaluated/checkout-lagging-develop', '根滞后 ⇒ 独立取值');
    assert.equal(lag.entries[0].verdict, 'fail', '该根上判据确实非 0（⛔ 这一态不等于「复核通过」）');

    // (3) 复核根**同步到 develop** 后 AC-901 ⇒ now-true（根齐平 ⇒ 判据的真假才是 develop 的实况）
    git(['checkout', 'develop']);
    const cleared = await recheckFrozenFailing(repoRoot, tmp, violated);
    assert.equal(key(cleared.entries[0]), 'cleared/now-true');
    git(['checkout', 'main']);

    // (4) 闸拒绝（本进程已在跑判据）⇒ guard-refused
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = '1';
    let refused;
    try {
      refused = await recheckFrozenFailing(repoRoot, tmp, { ...violated, failing: ['AC-902'] });
    } finally {
      if (prevEnv === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prevEnv;
    }
    assert.equal(key(refused.entries[0]), 'not-evaluated/guard-refused');

    // (5) 判据记录不存在（`goal gate` 退出 2）⇒ unreadable
    const unreadable = await recheckFrozenFailing(repoRoot, tmp, { ...violated, failing: ['AC-999'] });
    assert.equal(key(unreadable.entries[0]), 'not-evaluated/unreadable');

    // ⛔ 互为不等：五个 (outcome, cause) 两两不同 ⇒ 任两者合并（例如把滞后并进 cleared 或并进
    // confirmed-failing）都会让本断言变红。这是硬规则 3b 的可跑形态，⛔ 不是「字段存在」的自证。
    const keys = [key(lag.entries[0]), key(still.entries[0]), key(cleared.entries[0]), key(refused.entries[0]), key(unreadable.entries[0])];
    assert.deepEqual([...new Set(keys)].length, 5, `五个取值必须两两不等，实测=${JSON.stringify(keys)}`);

    // AC5 的第三个问题「查不成 vs 查过」：五个读数里三个带 verdict 与真实落后数（查过/量过），
    // 两个（gate 拒绝 / 记录不存在）的 durationMs 与 behindDevelop 语义不同 —— 后者是**根量**，
    // 闸拒绝时照读（拒绝发生在哪个根上仍是事实），记录不存在时同样照读。分别断言，⛔ 不合并。
    assert.equal(readRecheckRootFreshness(tmp).behindDevelop, 1, '独立重读复核根新鲜度 = 1（与 entry 落痕同源可比）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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
    assert.equal(r1.fact.value.frozenRecheck.entries[0].behindDevelop, null,
      '裸 tmp 根（非 git）⇒ 落后 develop 的提交数**读不出**（null），⛔ 不是 0 —— 「读不到」与「齐平」不同形；'
      + '而读不到时行为与改动前逐字一致（照旧 confirmed-failing ⇒ 立案），这正是上面那条断言在守的');

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
