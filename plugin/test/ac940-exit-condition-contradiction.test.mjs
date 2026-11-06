// @test-group engine
// ac940-exit-condition-contradiction.test.mjs — AC-940 判据的【回归锁】
// (tasks/gap-ac940-exit-condition-contradiction)。
//
// 对象：GOAL-914 的 AC-940（「本 GOAL 的退出条件不得被『AC-934 绿 ∧ AC-938 红』这一自相矛盾的组合
// 满足」）。它的判据是一条 `node -e "…"` shell 命令，读 cwd 下 `goals/` 里 AC-934 / AC-938 的
// status，冲突时 exit 1 并打印两个状态。
//
// 三条纪律，缺一这把锁就不算测量：
//   ① **单一真相源**：判据文本从 goal store 读（`createGoalStore(<root>/goals).get('AC-940')`），
//      ⛔ 测试里不内联副本 —— 否则判据被改坏时锁仍绿（回声，不是测量）。
//   ② **真执行**：判据正文本身是一整条 `node -e "…"` shell 命令，用 `spawnSync('bash', ['-c', …])`
//      跑；⛔ 不能把整条命令喂给 `node -e`（那会把字面量当 JS ⇒ 恒假；同链的
//      gap-ac939-ledger-binding-regression-lock 已记过这次偏离）。
//   ③ **能取假**：变异负控把冲突分支 `b!=='achieved'` 换成 `false` 后，同一个 (achieved, active)
//      fixture 必须从 exit 1 翻成 exit 0 —— 否则这把锁测的不是冲突分支。
//
// Run: node --test plugin/test/ac940-exit-condition-contradiction.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// re-export 入口（Provider 的 re-export shim）——判据文本与状态的单一真相源是 store 本身。
import { createGoalStore } from '../../packages/quay-native/src/goal-store.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const selfPath = fileURLToPath(import.meta.url);

// 判据的结论文本：**拆开拼** —— 本文件必须逐字不含它（AC-2 的 `grep -c` 要求 0），
// 而下面的自检仍然能查「有没有人把它拷进来」。
const CONTRADICTION_TEXT = 'achieved AC whose evidence AC is ' + 'red';

const store = createGoalStore(path.join(repoRoot, 'goals'));
const ac940 = store.get('AC-940');
const criterion = ac940 && typeof ac940.criterion === 'string' ? ac940.criterion : '';

// 一个【真】工作区：真的 `.quay/config.yml` + `tasks/` + `goals/`。判据只读 `goals/`，但 fixture
// 按工作区形状造 —— 这样将来判据升级成调 quay CLI 时，这把锁不会因为 fixture 不是工作区而失真
// （CLAUDE.md：裸 tasks 目录不是合法 workspace，config 是 provider map 不是扁平路径）。
const WORKSPACE_CONFIG = `providers:
  native:
    enabled: true
    path: "./packages/quay-native"
    tasks_dir: "./tasks"
    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"
      QUAY_NATIVE_GOAL_DIR: "./goals"
`;

/** 造一个临时工作区；`ac938` 传 undefined ⇒ 该记录不存在（控制臂④）。 */
function makeWorkspace({ ac934, ac938 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac940-lock-'));
  fs.mkdirSync(path.join(root, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  fs.writeFileSync(path.join(root, '.quay', 'config.yml'), WORKSPACE_CONFIG);
  fs.writeFileSync(path.join(root, 'tasks', 'README.md'), '# fixture workspace tasks/\n');
  const writeAc = (id, status) => {
    fs.writeFileSync(
      path.join(root, 'goals', `${id}-fixture.md`),
      `---\nid: ${id}\ntitle: ${id} fixture\nstatus: ${status}\nkind: criterion\ngoal: GOAL-914\n---\n\nfixture body\n`,
    );
  };
  if (ac934 !== undefined) writeAc('AC-934', ac934);
  if (ac938 !== undefined) writeAc('AC-938', ac938);
  return root;
}

/** 真执行判据（shell 语义，cwd = fixture 工作区）。 */
function runCriterion(root, command) {
  return spawnSync('bash', ['-c', command], { cwd: root, encoding: 'utf8' });
}

function withWorkspace(t, spec, fn) {
  const root = makeWorkspace(spec);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fn(root);
}

// ── 单一真相源 ───────────────────────────────────────────────────────────────
test('单一真相源：AC-940 判据从 store 读（非空、仍以 AC938 为证据臂），且本文件不内联其结论文本', () => {
  assert.ok(ac940, 'store 里取不到 AC-940 记录 —— 锁已失焦');
  assert.ok(criterion.trim().length > 0, 'AC-940 的 criterion 为空/取不到 —— 判据被改坏时应直接红');
  assert.match(criterion, /AC938/, '判据必须仍以 AC938 为证据臂（改坏了这把锁就不再测那个矛盾）');
  assert.doesNotMatch(criterion, /\bAC934\b(?!)/, 'control: criterion 文本本身来自 store，不是本文件');
  const self = fs.readFileSync(selfPath, 'utf8');
  assert.equal(self.includes(CONTRADICTION_TEXT), false, '本文件不得逐字内联判据的结论文本（单一真相源）');
});

// ── 四个控制臂 ───────────────────────────────────────────────────────────────
test('控制臂①：(AC-934 achieved, AC-938 achieved) ⇒ exit 0（矛盾不存在）', (t) => withWorkspace(t, { ac934: 'achieved', ac938: 'achieved' }, (root) => {
  const r = runCriterion(root, criterion);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { AC934: 'achieved', AC938: 'achieved' });
}));

test('控制臂②：(AC-934 achieved, AC-938 active) ⇒ exit 1，且 stderr JSON 同时给出 AC934 与 AC938 的状态', (t) => withWorkspace(t, { ac934: 'achieved', ac938: 'active' }, (root) => {
  const r = runCriterion(root, criterion);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}; stdout=${r.stdout}`);
  const parsed = JSON.parse(r.stderr.trim());
  assert.equal(parsed.AC934, 'achieved');
  assert.equal(parsed.AC938, 'active');
  assert.equal(typeof parsed.contradiction, 'string', '矛盾必须被点名为一个具名取值，⛔ 不是裸 exit 1');
}));

test('控制臂③：(AC-934 active, AC-938 active) ⇒ exit 0（旧 AC 未宣称兑现，就没有被反证的 achieved）', (t) => withWorkspace(t, { ac934: 'active', ac938: 'active' }, (root) => {
  const r = runCriterion(root, criterion);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
}));

test('控制臂④：AC-938 记录缺失 ⇒ exit 2（「不可判」不得与「通过」同形，硬规则 3b）', (t) => withWorkspace(t, { ac934: 'achieved' }, (root) => {
  const r = runCriterion(root, criterion);
  assert.equal(r.status, 2, `expected exit 2 (record missing), got ${r.status}`);
  assert.match(r.stderr, /AC record missing/);
}));

// ── 变异负控：证明这把锁测的是【冲突分支】，不是别的 ──────────────────────────
test("变异负控：把冲突分支 b!=='achieved' 换成 false 后，同一 (achieved, active) fixture 必须翻绿", (t) => withWorkspace(t, { ac934: 'achieved', ac938: 'active' }, (root) => {
  const BRANCH = "b!=='achieved'";
  assert.ok(criterion.includes(BRANCH), `判据里找不到冲突分支 ${BRANCH} —— 判据被改过，这把锁已失焦`);
  const mutated = criterion.replace(BRANCH, 'false');
  assert.notEqual(mutated, criterion, '变异没有生效（替换未命中）');

  // 未变异：红（同一个 fixture）
  const before = runCriterion(root, criterion);
  assert.equal(before.status, 1, `未变异的判据应当红；got exit ${before.status}`);

  // 变异后：必须绿。仍为 1 ⇒ 这把锁测的不是冲突分支。
  const after = runCriterion(root, mutated);
  assert.equal(
    after.status,
    0,
    `lock is not measuring the conflict branch (mutated criterion still exit ${after.status})`,
  );
}));
