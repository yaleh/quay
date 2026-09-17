// @test-group engine
// goal-create-as-active-requires-ac.test.mjs — tasks/gap-goal-create-as-active-skips-zero-ac-gate:
// P6-goal 的「活跃 GOAL 名下至少一条 AC」闸必须同样覆盖【出生路径】（create-as-active），不是只覆盖
// draft→active 转换。
//
// ⚠️ 2026-09-17（tasks/gap-goal-born-draft-zero-ac-escapes-standing-invariant）——闸的作用域被扩到
// 【不变式自己的作用域】。此前谓词逐字 `nextStatus === "active"`：只关了 active 那一半，而 AC-217
// 声明的作用域逐字是 `status ∈ {draft, active}`。draft 那一半原样敞着——GOAL-022 于 2026-09-17T00:41:26Z
// 以 draft 出生、名下 0 条 AC，该状态流通 ≥101 秒，其间 AC-217 判据为假、goal-driver 起了一次
// 「无物可修」的 gap-filing agent；而 active 半边的拒绝讯息当时逐字教调用方走 `--status draft`
// （= 用拒绝讯息把调用方指进另一半边仍然开着的门）。谓词现为 `nextStatus ∈ {draft, active}`，
// ⛔ 因此本文件里凡以「先建 draft GOAL、再补 AC」为序的断言都必须翻转为「AC 先、GOAL 后」——
// 那条序的第一步现在是禁态。这不是把闸关得更宽：`achieved` / `superseded` / `retired` 出生
// 仍放行（把零 AC 的 GOAL 以 `--status superseded` 写出 ⇒ exit 0，本回合实测）。
//
// 缺陷（本任务修复的）：goal-store 的 `activating` 逐字 `prevStatus !== undefined`。create 时
// `prevStatus === undefined` ⇒ 该布尔恒假 ⇒ 挂在同一个布尔上的 P6-goal 闸（`goal-store.ts` 的
// `if (activating && isGoalRecord)`）在「出生即 active」这条路径上一次都不执行。GOAL-018 于
// 2026-09-14T04:01:57Z 就此出生为 active（commit 1a83bfe7a，frontmatter 无 `statusLog` ⇒ 从未转换过），
// 携带 0 条 AC 流通了 60 秒（AC-257/258/259 分别落于 04:02:57Z / 04:03:20Z / 04:03:21Z），其间 AC-217
// 的常设判据为假 ⇒ goal-driver 起了一次「无物可修」的 gap-filing agent。
//
// ⛔ 注意与同族测试的分工（两条都保留，⛔ 不互相冒充）：
//   · `plugin/test/goal-activation-requires-ac.test.mjs`（gap-meta-goal-store-activation-gate）
//     测的是【转换】路径（draft→active 等），它全部用先落盘 draft 文件再转换的形态；
//   · 本文件测的是【出生】路径（新记录直接以 active 写入）+ 出生路径的结构性伴随物
//     （「新 GOAL 不得出生即 active」现在是一条写面约束）。
//
// 断言的是【写面行为】（真 spawn goal-store CLI，读退出码 / stderr / 落盘状态），⛔ 不读源码版式：
//   ① 新 GOAL 以 --status active 写入 ⇒ fail-closed 拒绝：非 0 退出 + stderr 枚举名下 AC 数 = 0
//      + 【盘上无该记录】（拒绝即不落盘，⛔ 不是「落了又改回来」）+ stderr 指路可行写序
//   ② 自然撰写顺序（AC 先、GOAL 后）仍可用：先写一条 `goal:` 指向它的 AC → GOAL 以 draft 出生
//      → 转 active ⇒ 放行落盘 active（⚠️ 2026-09-17 起这是唯一的生产形态，理由见文件头）
//   ③ 名下已有 ≥1 AC 的 GOAL 仍可正常转 active（取假控制：⛔ 实现不得把转换路径一并关掉）
//   ④ 取假控制：闸不是「一律拒绝创建」——它拒的是零 AC 这个【量】，不是 draft 这个【状态】：
//      零 AC 的 draft 出生被拒（枚举条数 = 0、盘上无记录），补上一条点名它的 AC 后同一命令行放行
//   ⑤ 取假控制：新 GOAL 出生时若【已有】一条 AC 点名它 ⇒ 放行（⛔ 闸不是「凡 create-as-active 必拒」，
//      它测的是 AC 条数这个【量】，不是 create 这个【事件】）
//   ⑥ 边界控制：闸仍被【记录种类】守卫（`goalInAcScope && isGoalRecord`）。⚠️ 它取假的形态是唯一的：
//      摘掉 `isGoalRecord` 守卫（把射程扩大到所有记录）。⛔ 它【不】验「AC 的 create-as-active 语义」——
//      那由 create 完整性契约回答，本任务不扩大 P6/P6b 的射程。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-create-as-active-requires-ac.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const goalStorePath = path.join(repoRoot, 'packages', 'quay', 'src', 'goal-store.ts');

/** 合法的 GOAL body（≥ MIN_GOAL_BODY_CHARS=40 非空白字符——创建路径的完整性契约）。 */
const GOAL_BODY = 'background / scope & non-goals / exit conditions —— 本 fixture 的 body 足够长。';

/** Hermetic temp workspace：goals/ + .quay/（⛔ 不碰真仓库的 goals/）。 */
function makeWorkspace() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-create-as-active-'));
  fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
  return tmp;
}

/** 直接落一条 GOAL/AC 记录文件（真 frontmatter，⛔ 不经 seam）——用于布置「出生前就已存在」的前置。 */
function writeGoalFile(tmp, { id, status, kind = 'goal', goal }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (kind === 'criterion') {
    lines.push('criterion: |', '  true', 'expect: >-', '  the criterion measures X');
  } else {
    lines.push('body: >-', `  ${GOAL_BODY}`);
  }
  lines.push('origin: test fixture', '---', '', '## body', GOAL_BODY, '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

/** 该 id 的记录文件内容，不存在 ⇒ null（「拒绝即不落盘」的判据读的是这个）。 */
function readRecordFile(tmp, id) {
  const f = fs.readdirSync(path.join(tmp, 'goals')).find((n) => n.startsWith(`${id}-`) || n === `${id}.md`);
  return f ? fs.readFileSync(path.join(tmp, 'goals', f), 'utf8') : null;
}

/** spawn 真 goal-store CLI（写面），返回 { status, stdout, stderr }。 */
function goalStoreWrite(tmp, args) {
  const argv = ['--no-warnings', '--experimental-strip-types', goalStorePath, 'write', ...args, '--root', tmp];
  const env = { ...process.env };
  delete env.QUAY_GOAL_FIDELITY_JUDGE;
  return spawnSync('node', argv, { encoding: 'utf8', env });
}

/** 一条新 GOAL 以 active 出生的完整参数（除状态外都合法 ⇒ 唯一可能被拒的原因就是「零 AC」）。 */
function createArgs(id, status) {
  return [id, '--status', status, '--title', 'new goal', '--origin', 'test fixture', '--body', GOAL_BODY];
}

// ── ① 新 GOAL 出生即 active ⇒ fail-closed 拒绝（本任务的核心判据）───────────────────────────

test('① 新 GOAL 以 --status active 写入 ⇒ 非 0 退出 + stderr 枚举名下 AC 数 = 0 + 盘上无该记录', () => {
  const tmp = makeWorkspace();
  try {
    const r = goalStoreWrite(tmp, createArgs('GOAL-001', 'active'));
    assert.notEqual(r.status, 0, `出生即 active 必须被拒（fail-closed），实际退出码 ${r.status}（stderr: ${r.stderr}）`);
    assert.ok(
      String(r.stderr).includes('0 AC records name it'),
      `stderr 必须枚举名下 AC 条数 = 0（硬规则 3：枚举不布尔），实际：${r.stderr}`,
    );
    assert.ok(
      /ACs naming GOAL-001: 0/.test(String(r.stderr)),
      `stderr 必须把「名下 AC 条数 = 0」写成可核的读数（不是一句形容词），实际：${r.stderr}`,
    );
    assert.ok(String(r.stderr).includes('GOAL-001'), `stderr 必须点名是哪条 GOAL，实际：${r.stderr}`);
    assert.equal(readRecordFile(tmp, 'GOAL-001'), null, '拒绝即不落盘：goals/ 下不得出现该记录');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② 自然撰写顺序（AC 先、GOAL 后）仍可用（「出生即 active」被关掉后唯一的生产形态）──────────

test('② 三步路径（AC 先）：写点名它的 AC → GOAL 以 draft 出生 → 转 active ⇒ 放行且盘上 active', () => {
  const tmp = makeWorkspace();
  try {
    // ⚠️ 写序于 2026-09-17 翻转（文件头 ⚠️ 注）：旧形态「先建 draft GOAL、再补 AC」的【第一步】
    // 现在本身就是禁态（AC-217 的作用域含 draft），故它不再可用。AC-first 合法且在任何时刻都不违
    // 反不变式——AC 可以点名一条尚不存在的 GOAL（store 的完整性契约只要求 `goal:` 是非空字符串，
    // ⛔ 不要求被指向的 GOAL 已存在），所以这仍是一条【一条记录一条记录】的自然撰写顺序。
    const a = goalStoreWrite(tmp, [
      'AC-902', '--goal', 'GOAL-002', '--status', 'draft', '--title', 'exit condition',
      '--criterion', 'exit 0', '--expect', 'the criterion measures X', '--origin', 'test fixture',
    ]);
    assert.equal(a.status, 0, `AC 可以点名一条尚不存在的 GOAL ⇒ 先写 AC 必须放行（stderr: ${a.stderr}）`);

    const c = goalStoreWrite(tmp, createArgs('GOAL-002', 'draft'));
    assert.equal(c.status, 0, `出生时名下已有 1 条 AC ⇒ draft 创建放行（stderr: ${c.stderr}）`);
    assert.ok(/^status: draft$/m.test(readRecordFile(tmp, 'GOAL-002')), '创建落成 draft');

    const act = goalStoreWrite(tmp, ['GOAL-002', '--status', 'active']);
    assert.equal(act.status, 0, `名下已有 1 条 AC ⇒ 激活放行（stderr: ${act.stderr}）`);
    assert.ok(/^status: active$/m.test(readRecordFile(tmp, 'GOAL-002')), '状态确实落成 active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ③ 名下已有 ≥1 AC 的 GOAL 转 active ⇒ 正常放行（取假控制：转换路径不得被一并关掉）──────────

test('③ 名下已有 ≥1 AC 的 GOAL 转 active ⇒ 放行（⛔ 本任务不得把转换路径也关掉）', () => {
  const tmp = makeWorkspace();
  try {
    writeGoalFile(tmp, { id: 'GOAL-003', status: 'draft' });
    writeGoalFile(tmp, { id: 'AC-903', status: 'draft', kind: 'criterion', goal: 'GOAL-003' });
    const r = goalStoreWrite(tmp, ['GOAL-003', '--status', 'active']);
    assert.equal(r.status, 0, `有 AC ⇒ 放行（stderr: ${r.stderr}）`);
    assert.ok(/^status: active$/m.test(readRecordFile(tmp, 'GOAL-003')), '状态确实落成 active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ④ 取假控制：闸拒的是零 AC 这个【量】，⛔ 不是 draft 这个【状态】────────────────────────────

test('④ 零 AC 的 draft 出生被拒（枚举 0、盘上无记录）；补一条点名它的 AC 后同一命令行放行', () => {
  const tmp = makeWorkspace();
  try {
    // (a) 零 AC 的 draft 出生 = AC-217 作用域内的禁态。
    //     ⚠️ 本条曾断言相反的一侧（「新 GOAL 以 --status draft 创建仍放行」）——那是谓词只读
    //     `nextStatus === "active"` 时的读数。作用域扩到不变式自己的 {draft, active} 之后，
    //     该断言的前提消失，故一并翻转（这是【语义反转】，⛔ 不是把测试改软）。
    const bad = goalStoreWrite(tmp, createArgs('GOAL-004', 'draft'));
    assert.notEqual(bad.status, 0, `零 AC 的 draft 出生必须被拒（stderr: ${bad.stderr}）`);
    assert.ok(
      /ACs naming GOAL-004: 0/.test(String(bad.stderr)),
      `stderr 必须把「名下 AC 条数 = 0」写成可核的读数，实际：${bad.stderr}`,
    );
    assert.equal(readRecordFile(tmp, 'GOAL-004'), null, '拒绝即不落盘：goals/ 下不得出现该记录');

    // (b) 同一状态、同一命令行，唯一差别是「出生前已有一条 AC 点名它」⇒ 放行。
    //     ⇒ 两格合起来才是完整的取假控制：闸不是「draft 一律不许创建」。
    writeGoalFile(tmp, { id: 'AC-904', status: 'draft', kind: 'criterion', goal: 'GOAL-005' });
    const ok = goalStoreWrite(tmp, createArgs('GOAL-005', 'draft'));
    assert.equal(ok.status, 0, `出生时名下已有 1 条 AC ⇒ draft 创建放行（stderr: ${ok.stderr}）`);
    assert.ok(/^status: draft$/m.test(readRecordFile(tmp, 'GOAL-005')), '创建落成 draft');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑤ 取假控制：闸测的是「AC 条数」这个量，不是「create」这个事件 ─────────────────────────────

test('⑤ 出生时【已有】一条 AC 点名它的新 GOAL 以 active 写入 ⇒ 放行（测的是量，不是事件）', () => {
  const tmp = makeWorkspace();
  try {
    // AC 先于其 GOAL 存在（本 store 不在写 AC 时校验被指向的 GOAL 已存在）⇒ 出生时点名它的 AC 已在盘上。
    writeGoalFile(tmp, { id: 'AC-905', status: 'draft', kind: 'criterion', goal: 'GOAL-005' });
    const r = goalStoreWrite(tmp, createArgs('GOAL-005', 'active'));
    assert.equal(r.status, 0, `出生时名下有 1 条 AC ⇒ 放行（stderr: ${r.stderr}）`);
    assert.ok(/^status: active$/m.test(readRecordFile(tmp, 'GOAL-005')), '状态落成 active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑥ 边界控制：`activating` 本身未被加宽 —— CRITERION 的 create-as-active 行为不变 ──────────

test('⑥ CRITERION 记录以 --status active 出生 ⇒ 行为不变（本任务 ⛔ 不扩大 P6/P6b 的射程）', () => {
  const tmp = makeWorkspace();
  try {
    writeGoalFile(tmp, { id: 'GOAL-006', status: 'active' });
    writeGoalFile(tmp, { id: 'AC-906', status: 'draft', kind: 'criterion', goal: 'GOAL-006' });
    // 这条断言钉的是【记录种类守卫】(`goalInAcScope && isGoalRecord`)，⛔ 不是「空 criterion」：
    // 空 criterion 在 create 路径上由 create 完整性契约拒绝（实测 exit 2，另一道闸、另一句话），
    // 故它无法区分本闸有没有覆盖 create。真正能取假的是：若有人把 `isGoalRecord` 守卫摘掉
    // （= 把这道闸的射程扩大到所有记录），本条记录自己的 id 是 `AC-907`，枚举 `goal: AC-907` 的 AC
    // 恒为 0 ⇒ 会被拒 ⇒ 本断言红。⛔ 别把它读成「AC 的 create-as-active 语义被验过了」。
    const r = goalStoreWrite(tmp, [
      'AC-907', '--goal', 'GOAL-006', '--status', 'active', '--title', 'born active',
      '--criterion', 'exit 0', '--expect', 'the criterion measures X', '--origin', 'test fixture',
    ]);
    assert.equal(r.status, 0, `AC 的 create-as-active 仍走 create 完整性契约（stderr: ${r.stderr}）`);
    assert.ok(/^status: active$/m.test(readRecordFile(tmp, 'AC-907')), 'AC 落成 active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
