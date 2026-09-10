// @test-group engine
// criterion-fidelity-default-wiring.test.mjs — AC-231 (tasks/gap-fidelity-gate-not-wired-on-the-
// dominant-cli-activation-path)：保真性闸在【缺省配置】下确实执行。实测 20/21 次 AC 激活走人/CLI
// 路径、1/21 走 goal-driver ⑧，而闸此前只接在 ⑧ 那条上（goal-driver.ts:211 只在 ⑧ 传
// --fidelity-judge-argv）⇒ CLI 缺省 fails-open 记 "no judge configured"（惰性，非执行）。
//
// 四个断言（AC-231 缺一不可，核心命题：无 env seam 时激活路径【不会跳过】保真性判定）：
//   ①缺省不惰性：resolveFidelityJudgeArgvFromConfig 在缺省配置（无 env）下返回非 null argv
//     ⇒ goal-store 的 `typeof fidelityJudge === "function"` 短路分支在缺省配置下结构上不可达。
//   ②记录取值：缺省配置下激活一条 AC ⇒ 记录 fidelity.verdict ∈ {faithful, vacuous}
//     （⛔ "no judge configured" 不算通过——那是把惰性说出来，不是执行）。
//   ③⛔ 不靠注入 seam：测试全程 delete env.QUAY_GOAL_FIDELITY_JUDGE、不传 --fidelity-judge-argv。
//   ④成本纪律：只用假判定器（shell printf，⛔ 不真调 LLM）；同族两支实测 2.47s / 0.39s，本支同量级。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/criterion-fidelity-default-wiring.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveFidelityJudgeArgvFromConfig } from '../../packages/quay/src/goal-store.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const goalStorePath = path.join(repoRoot, 'packages', 'quay', 'src', 'goal-store.ts');

/** Hermetic temp workspace：goals/ + .quay/ + .claude/（缺省配置的落点）。 */
function makeWorkspace() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'criterion-fidelity-default-wiring-'));
  fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  return tmp;
}

/** 最小缺省 profiles.yml（fix-worker → worker-default）。launcher 由调用方注入（假判定器或真 launcher）。 */
function writeProfiles(tmp, { launcher = '/bin/true' } = {}) {
  const yml = [
    'version: 1',
    'excludeDynamicSystemPromptSections: true',
    'promptSuggestions: false',
    'profiles:',
    '  worker-default:',
    `    launcher: ${launcher}`,
    '    model: deepseek-v4-pro-anthropic',
    '    bare: false',
    '    auth: token',
    '    env:',
    '      ANTHROPIC_DEFAULT_SONNET_MODEL: deepseek-v4-pro-anthropic',
    'roles:',
    '  fix-worker:',
    '    profile: worker-default',
    '    name: quay-fix-worker',
    '    env:',
    '      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(tmp, '.quay', 'profiles.yml'), yml, 'utf8');
}

function writeLaunchSettings(tmp) {
  const s = JSON.stringify({ env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' } });
  fs.writeFileSync(path.join(tmp, '.claude', 'launch.settings.json'), s, 'utf8');
}

/** 落一条 draft AC（criterion=true / expect 无完整性主张 ⇒ 机械半 defer，判定走注入的假判定器）。 */
function writeDraftAc(tmp, { id = 'AC-901', goal = 'GOAL-001' } = {}) {
  const lines = [
    '---', `id: ${id}`, 'title: t', 'status: draft', 'kind: criterion', `goal: ${goal}`,
    'criterion: |', '  true', 'expect: >-', '  the criterion measures X', 'origin: test fixture', '---', '',
  ];
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

function readRecordFile(tmp, id) {
  const f = fs.readdirSync(path.join(tmp, 'goals')).find((n) => n.startsWith(`${id}-`) || n.startsWith(`${id}.md`));
  return f ? fs.readFileSync(path.join(tmp, 'goals', f), 'utf8') : null;
}

/** 落一个只打印 verdict、忽略全部 argv 的假判定器脚本（⛔ 不调 LLM）。 */
function writeFakeJudge(tmp, verdict) {
  const p = path.join(tmp, `judge-${verdict}.sh`);
  fs.writeFileSync(p, `#!/bin/sh\nprintf '{"verdict":"${verdict}"}\\n'\n`, 'utf8');
  fs.chmodSync(p, 0o755);
  return p;
}

/** spawn 真 goal-store CLI 激活一条 AC。⛔ 缺省：不注入 env seam、不传 --fidelity-judge-argv。 */
function activate(tmp, id) {
  const args = ['--no-warnings', '--experimental-strip-types', goalStorePath, 'write', id, '--status', 'active', '--root', tmp];
  const env = { ...process.env };
  delete env.QUAY_GOAL_FIDELITY_JUDGE;
  return spawnSync('node', args, { encoding: 'utf8', env });
}

// ── ① 缺省不惰性（AC-231 ①）：缺省配置 ⇒ 判定器 argv 解析非 null（argv 构造，⛔ 不调用）────────

test('① 缺省配置 ⇒ 判定器 argv 解析非 null（无 env seam，只构造 argv 不调用）', () => {
  const tmp = makeWorkspace();
  try {
    writeProfiles(tmp, { launcher: '/bin/true' });
    writeLaunchSettings(tmp);
    const argv = resolveFidelityJudgeArgvFromConfig(tmp);
    assert.ok(Array.isArray(argv) && argv.length > 0, '缺省配置 ⇒ argv 非 null');
    assert.equal(argv[0], '/bin/true', 'argv[0] = launcher');
    assert.ok(argv.includes('--settings'), 'argv 含 --settings（真 LLM 需 settings env）');
    assert.ok(argv.includes('-n'), 'argv 含 -n name');
    assert.equal(argv[argv.length - 1], '-p', 'argv 以 -p 收尾（prompt 末参数追加点，同 launchArgv.slice(0,-1)）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ①b 配置缺失 ⇒ null（落回可见性分支，⛔ 不回落 faithful）─────────────────────────────

test('①b 配置缺失 ⇒ null（落回 "no judge configured" 可见性，⛔ 不回落 faithful）', () => {
  const tmp = makeWorkspace();
  try {
    assert.equal(resolveFidelityJudgeArgvFromConfig(tmp), null, '无 profiles.yml ⇒ null');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② 记录取值（AC-231 ②）：缺省配置下激活 ⇒ 记录 fidelity.verdict=faithful ──────────────

test('② 缺省配置下激活 ⇒ 记录 fidelity.verdict=faithful（假判定器，⛔ 不真调 LLM）', () => {
  const tmp = makeWorkspace();
  try {
    writeProfiles(tmp, { launcher: writeFakeJudge(tmp, 'faithful') });
    writeLaunchSettings(tmp);
    writeDraftAc(tmp);
    const r = activate(tmp, 'AC-901');
    assert.equal(r.status, 0, `faithful ⇒ exit 0（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: active/m.test(raw), '状态变 active');
    assert.ok(raw.includes('verdict: faithful'), '记录 fidelity.verdict=faithful（⛔ 非 "no judge configured"）');
    assert.ok(!raw.includes('no judge configured'), '⛔ 惰性签名 "no judge configured" 不得出现');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ②b vacuous ⇒ 拒绝（证明闸在缺省路径真的执行，⛔ 非恒放行）──────────────────────────

test('②b 缺省配置下 vacuous 判定器 ⇒ 拒绝激活（非零退出 + stderr 含 vacuous）', () => {
  const tmp = makeWorkspace();
  try {
    writeProfiles(tmp, { launcher: writeFakeJudge(tmp, 'vacuous') });
    writeLaunchSettings(tmp);
    writeDraftAc(tmp);
    const r = activate(tmp, 'AC-901');
    assert.notEqual(r.status, 0, 'vacuous ⇒ 非零退出');
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: draft/m.test(raw), '⛔ 不写状态（仍 draft）');
    assert.ok(String(r.stderr).includes('vacuous'), `stderr 含 "vacuous"：${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
