// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// goal-driver-s11.test.mjs — shard 11, split out of goal-driver-s02 by
// gap-suite-split-15-over-30s-test-files (AC3: every shard of the 15 split files must run <30s;
// s02 was 28.9s). It holds the two 'real ring' end-to-end tests whose measured cost dominated s02:
// Shared fixtures: ./helpers/goal-driver-harness.mjs (single source — ⛔ no fixture is re-declared here).

import { test } from "node:test";
import { GOAL_ROUND_REL, assert, fs, goalAchievedFromRecords, goalDriverRoutines, os, path, repoRoot, runResidentQualityGateLoop, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

// ── 真实机械环端到端（⛔ 不用 fixture 注入 seam，跑真的 goal-store CLI）────────────────────


test('real ring: 载体有 verdict + evidence 不回写 + I2 flip + draft 不动 + 无 tasks 写', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // GOAL-001（active）两条 AC 全 pass ⇒ AC 与 GOAL 都该 flip achieved（I2）。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    // GOAL-003（draft）——负控制：driver 不得自动激活它、也不得跑它的 AC。
    writeGoalFile(tmp, { id: 'GOAL-003', status: 'draft', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-003', status: 'active', kind: 'criterion', goal: 'GOAL-003', criterion: 'true' });

    const roundLog = path.join(tmp, GOAL_ROUND_REL);
    const code = await runResidentQualityGateLoop({
      root: tmp,
      intervalMs: 1,
      once: true,
      maxRounds: null,
      roundLogFile: roundLog,
      runId: 't',
      json: false,
      routines: goalDriverRoutines(tmp, { scriptRoot: repoRoot }),
    });
    assert.equal(code, 0, 'resident loop 一轮应正常退出');

    // AC1 机制：载体（.quay/goal-round.jsonl）含 criterion verdict。
    const carrier = fs.readFileSync(roundLog, 'utf8');
    assert.ok(carrier.includes('"verdict"'), 'round record must carry criterion verdicts');

    // AC3 机制 + I2：AC pass→achieved + GOAL 全达成→achieved；evidence 不回写进文件
    // （gap-goal-evidence-cache-should-not-enter-git——evidence 是 .quay/gate-events.jsonl 派生的）。
    const g1 = fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8');
    const a1 = fs.readFileSync(path.join(tmp, 'goals', 'AC-001-t.md'), 'utf8');
    // AC-212 充分性闸：GOAL 达成判定 = 在域 AC 合取 + 充分性 covered。GOAL-001 body 无 `## 退出条件`
    // ⇒ 充分性 insufficient ⇒ 即便两条 AC 全绿也不 flip GOAL（covered 的语义判定归 AC-213 的 LLM）。
    assert.match(g1, /^status: active$/m, 'AC-212 充分性闸：body 无退出条件 ⇒ insufficient ⇒ 不 flip GOAL');
    assert.match(a1, /^status: achieved$/m, 'AC-001 pass ⇒ flip achieved（裁定 5 确定性推导）');
    assert.doesNotMatch(a1, /evidence:/, 'AC-001 evidence 不回写进文件（gate 只写 GateEvent 到账本）');

    // AC4 负控制：draft 不动、其 AC 也不被跑/翻。
    const g3 = fs.readFileSync(path.join(tmp, 'goals', 'GOAL-003-t.md'), 'utf8');
    const a3 = fs.readFileSync(path.join(tmp, 'goals', 'AC-003-t.md'), 'utf8');
    assert.match(g3, /^status: draft$/m, 'draft GOAL 不被自动激活（裁定 3）');
    assert.match(a3, /^status: active$/m, 'draft GOAL 的 AC 不被跑/不被翻');

    // AC5 负控制：driver 一轮不产生 tasks/*.md 写入。
    assert.equal(fs.existsSync(path.join(tmp, 'tasks')), false, 'driver 一轮内不产生 tasks/ 写入');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── I2 边界 + AC-219（gap-meta-goal-triage-fresh-draft-not-retire）：active GOAL 下的 draft AC
//    不被 I2 翻成 achieved（裁定 3，I2 只翻 active）、不被翻 retired（放弃归人）；无牵引 ⇒ 分诊判
//    activate ⇒ 翻 active（gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics：
//    激活判据 =「判据就绪」而非「有牵引」）。──────────────────


test('real ring: draft AC under active GOAL 无牵引 ⇒ 分诊 activate ⇒ 翻 active（⛔ 不翻 achieved/retired）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-draftac-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // GOAL-001（active）两条 AC：AC-001 active（pass ⇒ flip achieved）、AC-002 draft（无牵引 ⇒ 分诊 activate ⇒ 翻 active）。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'draft', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });

    const roundLog = path.join(tmp, GOAL_ROUND_REL);
    const code = await runResidentQualityGateLoop({
      root: tmp,
      intervalMs: 1,
      once: true,
      maxRounds: null,
      roundLogFile: roundLog,
      runId: 't',
      json: false,
      routines: goalDriverRoutines(tmp, { scriptRoot: repoRoot }),
    });
    assert.equal(code, 0, 'resident loop 一轮应正常退出');

    const a1 = fs.readFileSync(path.join(tmp, 'goals', 'AC-001-t.md'), 'utf8');
    const a2 = fs.readFileSync(path.join(tmp, 'goals', 'AC-002-t.md'), 'utf8');
    const g1 = fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8');
    assert.match(a1, /^status: achieved$/m, 'active AC pass ⇒ flip achieved（裁定 5）');
    // AC-219 + gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics：无牵引 draft AC
    // 分诊判 activate ⇒ 翻 active（⛔ 不翻 achieved/retired——I2 只翻 active、放弃归人）。
    assert.match(a2, /^status: active$/m, 'draft AC 无牵引 ⇒ activate ⇒ 翻 active（激活判据 = 判据就绪，非牵引）');
    assert.doesNotMatch(a2, /^status: achieved$/m, 'draft AC 不得被 I2 翻 achieved（裁定 3：I2 只翻 active）');
    assert.doesNotMatch(a2, /^status: retired$/m, 'draft AC 不得翻 retired（放弃归人，AC-211）');
    // AC-2（行为级）+ AC-212 充分性闸：draft AC 不再阻塞目标达成判定（纯函数层已证，见 goalAchievedFromRecords
    // 单测），但 GOAL 层 flip 还要过充分性闸——GOAL-001 body 无 `## 退出条件` ⇒ insufficient ⇒ 不 flip。
    assert.match(g1, /^status: active$/m, 'draft 不阻塞但充分性 insufficient ⇒ 不 flip GOAL（AC-212）');

    // flips：AC-001 → achieved、AC-002 → active（activate 判决被 ⑧ 消费，⛔ 非只落痕）。
    const lines = fs.readFileSync(roundLog, 'utf8').trim().split('\n');
    const rec = JSON.parse(lines[lines.length - 1]);
    const goalFact = rec.facts.find((f) => f.name === 'goal-ring');
    assert.ok(goalFact, 'round record 含 goal-ring fact');
    const flipsById = new Map((goalFact.value.flips ?? []).map((f) => [f.id, f.to]));
    assert.equal(flipsById.get('AC-001'), 'achieved', 'active AC 在 flips 里 to=achieved（达成翻转）');
    assert.equal(flipsById.get('AC-002'), 'active', 'draft AC 无牵引 ⇒ activate ⇒ flips 里 to=active（⛔ 不翻 needs-human，AC-219）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
