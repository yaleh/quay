// @test-group engine
// ac939-goal-filing-ledger-binding.test.mjs — AC-939 判据的回归锁
// (goals/AC-939-*.md; tasks/gap-ac939-ledger-binding-regression-lock).
//
// 缺陷（本条钉住的）：AC-937 的端到端判据用 `taskFiles.some(...)` 扫描 tasks/ 下【全部】任务，
// 任一文件带 `goal_ac: AC-937` 且 `status: done` 即通过 —— 它从不读 .quay/goal-filing.jsonl
// 里 `filed` 行记下的 taskId。于是「任意一份结论可以是『链路不成立』的审计任务只要被标 done」
// 就能把 AC 翻绿。AC-939 把判据改成【绑定台账 filed 的 taskId】，但那段保证此前只活在一段
// YAML 标量里，没有任何测试执行过它 —— 把判据改回扫全表形态不会有任何检查变红（那正是已经
// 真实发生过的一次回归）。
//
// 本文件的每一条腿都是「判据被改坏时会红」的臂，不是「文件存在」的读数：
//   正控      —— filed{taskId:T} + tasks/T.md(goal_ac:AC-937, done) ⇒ exit 0 且 allDone:true
//   负控①     —— filed 的 taskId 是 todo，另有一份 goal_ac:AC-937 的 done 任务 ⇒ exit 1 且
//                pending 恰为 [T1]。⛔ 判 0 就是 AC-937 回归。
//   负控②     —— filed 行没有 taskId 字段 ⇒ exit 1
//   负控③     —— taskId 指向不存在的 tasks/<id>.md ⇒ exit 1 且 pending 含该 id
//   负控④     —— 台账只有 spawned 行、无 filed 行 ⇒ exit 1
//   变异负控  —— 把判据的绑定段换回 AC-937 的扫全表形态后，负控① 的【同一份】fixture 必须
//                从 exit 1 变为 exit 0。变异后仍红 ⇒ 本文件自己的断言红并说出
//                「lock is not measuring the binding」（硬规则 2/4：谓词要对着已知为真的
//                样本干跑一次；做不到就只是一条恒真断言）。
//
// 判据正文【不从测试里复制一份】：经 goal store（packages/quay-native/src/goal-store.ts 的
// re-export，单一真相源）从 goals/ 读；变异臂的扫全表形态也取自 AC-937 自己的 criterion，
// 不手写第二份。仓库根由 import.meta.url 解析，⛔ 不依赖 process.cwd()。
//
// Run: node --test plugin/test/ac939-goal-filing-ledger-binding.test.mjs
//      scripts/test.sh --for-task gap-ac939-ledger-binding-regression-lock --allow-thin

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createGoalStore } from "../../packages/quay-native/src/goal-store.ts";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SELF_SOURCE = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");

// ── 判据来源：goal store（唯一真相源） ──────────────────────────────────────────────────────────
/**
 * 从真 goal store 取判据正文。⛔ 测试里不得出现判据副本。
 * @param {string} id 形如 "AC-939"
 * @returns {string}
 */
function criterionOf(id) {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const rec = store.get(id);
  assert.ok(rec, `goal store 里取不到 ${id} —— 取不到判据就无法执行它，本文件必须红而不是跳过`);
  assert.equal(typeof rec.criterion, "string", `${id} 的 criterion 必须是字符串（实际 ${typeof rec.criterion}）`);
  assert.ok(rec.criterion.trim() !== "", `${id} 的 criterion 不得为空`);
  return rec.criterion;
}

const CRITERION_939 = criterionOf("AC-939");
// 变异臂的输入：AC-937 的【扫全表】判据本身就是「回归之后长什么样」的正本，取自 store 而非手写。
const CRITERION_937 = criterionOf("AC-937");

// ── 夹具：临时工作区（真 .quay/config.yml + tasks/ + .quay/goal-filing.jsonl） ─────────────────
const CONFIG_YML = [
  "providers:",
  "  native:",
  "    enabled: true",
  '    path: "./packages/quay-native"',
  '    tasks_dir: "./tasks"',
  '    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]',
  "    env:",
  '      QUAY_NATIVE_TASKS_DIR: "./tasks"',
  "",
].join("\n");

/** @param {"spawned"|"filed"} state */
function ledgerRow(state, { taskId } = {}) {
  const row = {
    state,
    requestId: "GOAL-914|AC-937|2026-11-06T00:00:00.000Z|0",
    ac: "AC-937",
    goal: "GOAL-914",
    at: "2026-11-06T00:00:01.000Z",
    promptSha: "fixture0000000000",
    round: "2026-11-06T00:00:00.000Z",
    reason: null,
  };
  // 负控② 要的是【字段缺席】，所以只有显式给了 taskId 才写这个键。
  if (taskId !== undefined) row.taskId = taskId;
  return row;
}

/** 一份任务文件的正文；criterion 只读 frontmatter 的 `goal_ac` / `status` 两行。 */
function taskFile(id, { status, goalAc = "AC-937" }) {
  return [
    "---",
    `id: ${id}`,
    `title: "fixture task ${id}"`,
    `status: ${status}`,
    `goal_ac: ${goalAc}`,
    "---",
    "## Proposal",
    "fixture body — 判据只读 frontmatter 的 goal_ac / status，正文内容不参与判定。",
    "",
  ].join("\n");
}

/**
 * 建一份临时工作区并返回它的根目录（mkdtemp 的清理由 helpers/tmp-workspace.mjs 的文件级
 * after() 承担 —— tmp-leak-pairing-check 的载体数组要求）。
 * @param {{ ledger: object[], tasks: Record<string, {status: string, goalAc?: string}> }} spec
 * @returns {string} fixture 根（判据的 cwd）
 */
function makeFixture({ ledger, tasks }) {
  const root = makeTmpDir("ac939-bind-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), CONFIG_YML, "utf8");
  fs.writeFileSync(
    path.join(root, ".quay", "goal-filing.jsonl"),
    ledger.length === 0 ? "" : ledger.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  for (const [id, t] of Object.entries(tasks)) {
    fs.writeFileSync(path.join(root, "tasks", `${id}.md`), taskFile(id, t), "utf8");
  }
  return root;
}

/**
 * 逐字执行判据。判据正文【本身就是一条 shell 命令】（`node -e "…"`），因此必须交给 shell 执行
 * —— 这正是生产侧的解释器（packages/quay/src/core/acceptance-runner.ts 以 `shell: true` 跑
 * acceptance 命令）。⛔ 不能写成 `execFileSync('node', ['-e', criterion])`：那会把字面量
 * `node -e "…"` 当成 JS 求值 ⇒ SyntaxError，判据退化成恒假，正控永远红。
 * 判据里的路径是相对路径（`tasks/…`、`.quay/…`），所以 cwd 必须是 fixture 根。
 * @param {string} root
 * @param {string} criterion
 */
function runCriterion(root, criterion) {
  const r = spawnSync("bash", ["-c", criterion], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.error, undefined, `判据未能执行（spawn error）：${r.error && r.error.message}`);
  return r;
}

/** 从 stderr/stdout 取最后一行可解析的 JSON；取不到返回 null（⛔ 不把「没有 JSON」当成空对象）。 */
function lastJsonLine(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* 这一行不是判据的 JSON 读数，继续往前找 */
    }
  }
  return null;
}

// ── 判据自身形态（AC2）：单一真相源 + 仍是绑定形态 ─────────────────────────────────────────────
test("判据形态：取自 goal store 且不含判据副本；仍是绑定 filed taskId 的形态（不是扫全表）", () => {
  // 绑定形态的可确认特征：从 filed 行取 taskId 去 tasks/<id>.md 核。
  assert.ok(
    CRITERION_939.includes("r.ac==='AC-937'"),
    `AC-939 的判据必须按 ac==='AC-937' 取 filed 行；实际=${JSON.stringify(CRITERION_939)}`,
  );
  // 扫全表形态的可确认特征：`taskFiles.some(...)`。它一旦重新出现，说明判据被改回了 AC-937 的形态。
  assert.ok(
    !CRITERION_939.includes("taskFiles.some"),
    "AC-939 的判据不得退回 AC-937 的 taskFiles.some 扫全表形态 —— 那是本锁要防的回归",
  );
  // 单一真相源：判据正文不得在测试文件里出现第二份。
  assert.equal(
    SELF_SOURCE.includes(CRITERION_939),
    false,
    "测试文件里出现了判据正文副本 —— 抄一份就是造第二个真相源，改 store 而锁不动",
  );
});

// ── 正控：绑定成立 ⇒ 绿 ────────────────────────────────────────────────────────────────────────
test("正控：filed 记下的 taskId 指向 goal_ac: AC-937 且 status: done 的任务 ⇒ exit 0 且 allDone:true", () => {
  const root = makeFixture({
    ledger: [ledgerRow("spawned"), ledgerRow("filed", { taskId: "T" })],
    tasks: { T: { status: "done" } },
  });

  const r = runCriterion(root, CRITERION_939);
  assert.equal(r.status, 0, `绑定成立时必须读绿；stderr=${JSON.stringify(r.stderr)}`);

  const out = lastJsonLine(r.stdout);
  assert.ok(out, `正控的 stdout 必须是 JSON 读数；实际=${JSON.stringify(r.stdout)}`);
  assert.deepEqual(out.filedTaskIds, ["T"], "读数必须报出台账 filed 行记下的 taskId");
  assert.equal(out.allDone, true, "正控的 allDone 必须是 true");
});

// ── 负控①：替代品（AC-939 原文要求的那一条） ───────────────────────────────────────────────────
test("负控① 替代品：filed 的 taskId 是 todo、另一份 goal_ac: AC-937 的 done 任务顶替 ⇒ exit 1 且 pending 恰为 [T1]", () => {
  const root = makeFixture({
    ledger: [ledgerRow("spawned"), ledgerRow("filed", { taskId: "T1" })],
    tasks: {
      T1: { status: "todo" }, // 台账真的记下的那个 —— 没落地
      T2: { status: "done" }, // 顶替品：带 goal_ac: AC-937 且 done，但台账从没记过它
    },
  });

  const r = runCriterion(root, CRITERION_939);
  assert.equal(
    r.status,
    1,
    `「任意一份带 goal_ac: AC-937 的 done 任务顶替台账 taskId」必须判红；` +
      `判 0 即 AC-939 回归到 AC-937 的扫全表形态。stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`,
  );

  const err = lastJsonLine(r.stderr);
  assert.ok(err, `负控① 的 stderr 必须是 JSON 读数；实际=${JSON.stringify(r.stderr)}`);
  assert.deepEqual(err.pending, ["T1"], "pending 必须恰为台账记下的那个未落地 taskId（⛔ 不得把顶替品 T2 算进去）");
  assert.deepEqual(err.filedTaskIds, ["T1"], "filedTaskIds 必须来自台账的 filed 行");
});

// ── 负控②：filed 行没有 taskId 字段 ───────────────────────────────────────────────────────────
test("负控② 无 taskId：filed 行缺 taskId 字段 ⇒ exit 1（不得被当成空集合通过）", () => {
  const root = makeFixture({
    ledger: [ledgerRow("spawned"), ledgerRow("filed")],
    tasks: {},
  });

  const r = runCriterion(root, CRITERION_939);
  assert.equal(r.status, 1, `filed 行不带 taskId 必须判红；stdout=${JSON.stringify(r.stdout)}`);
  assert.match(
    r.stderr,
    /filed rows carry no taskId/,
    `判据必须具名「filed 行没有 taskId」；stderr=${JSON.stringify(r.stderr)}`,
  );
});

// ── 负控③：taskId 指向不存在的任务文件 ────────────────────────────────────────────────────────
test("负控③ 文件缺席：taskId 指向不存在的 tasks/<id>.md ⇒ exit 1 且 pending 含该 id", () => {
  const root = makeFixture({
    ledger: [ledgerRow("spawned"), ledgerRow("filed", { taskId: "T-gone" })],
    tasks: {},
  });

  const r = runCriterion(root, CRITERION_939);
  assert.equal(r.status, 1, `指向不存在的任务文件必须判红；stdout=${JSON.stringify(r.stdout)}`);

  const err = lastJsonLine(r.stderr);
  assert.ok(err, `负控③ 的 stderr 必须是 JSON 读数；实际=${JSON.stringify(r.stderr)}`);
  assert.ok(
    Array.isArray(err.pending) && err.pending.includes("T-gone"),
    `pending 必须含缺席的 taskId；实际=${JSON.stringify(err.pending)}`,
  );
});

// ── 负控④：台账只有 spawned 行，没有 filed 行 ────────────────────────────────────────────────
test("负控④ 未立案：台账只有 spawned 行、无 filed 行 ⇒ exit 1", () => {
  const root = makeFixture({
    ledger: [ledgerRow("spawned")],
    tasks: {}, // 即便有 done 任务也不该救它 —— 但这份夹具连任务都不给，只测「没有 filed 行」
  });

  const r = runCriterion(root, CRITERION_939);
  assert.equal(r.status, 1, `没有 filed 行必须判红；stdout=${JSON.stringify(r.stdout)}`);
  assert.match(
    r.stderr,
    /no filed row for AC-937/,
    `判据必须具名「没有 AC-937 的 filed 行」；stderr=${JSON.stringify(r.stderr)}`,
  );
});

// ── 变异负控：证明这把锁测的是【绑定】而不是别的 ──────────────────────────────────────────────
const BINDING_ANCHOR = "const ids=[...new Set(";
const SCAN_ALL_ANCHOR = "const fileRe=";

/** @param {string} haystack @param {string} needle */
function assertExactlyOnce(haystack, needle) {
  const count = haystack.split(needle).length - 1;
  assert.equal(count, 1, `变异臂的锚点必须恰好出现一次（实际 ${count} 次）：${JSON.stringify(needle)}`);
}

/**
 * 把 AC-939 判据的【绑定段】（`const ids=[...new Set(` 起，到判据末尾）换成 AC-937 的扫全表段。
 * 扫全表段逐字取自 AC-937 的 criterion（⛔ 不手写第二份形态），只剥掉外层 shell 命令的收尾引号；
 * 它只依赖 `filed` 与 `fs`，而这两者都在被替换掉的前缀里已定义。
 * @param {string} criterion AC-939 的判据正文
 * @returns {string} 变异后的判据正文
 */
function mutateToScanAll(criterion) {
  assertExactlyOnce(criterion, BINDING_ANCHOR);
  const bIdx = criterion.indexOf(BINDING_ANCHOR);
  assert.ok(bIdx > 0, `AC-939 判据里找不到绑定段锚点 ${JSON.stringify(BINDING_ANCHOR)}`);
  // 前缀必须止于语句边界：否则拼出来的不是合法 JS，变异臂会因 SyntaxError 而恒红（假红）。
  assert.ok(
    criterion.slice(0, bIdx).trimEnd().endsWith(";"),
    `绑定段之前的前缀必须止于 ';'（否则变异脚本不是合法 JS）：…${JSON.stringify(criterion.slice(Math.max(0, bIdx - 40), bIdx))}`,
  );

  assertExactlyOnce(CRITERION_937, SCAN_ALL_ANCHOR);
  const sIdx = CRITERION_937.indexOf(SCAN_ALL_ANCHOR);
  assert.ok(sIdx > 0, `AC-937 判据里找不到扫全表段锚点 ${JSON.stringify(SCAN_ALL_ANCHOR)}`);
  const rawTail = CRITERION_937.slice(sIdx);
  assert.ok(
    rawTail.endsWith('"'),
    `AC-937 判据应以闭合的 shell 双引号收尾（实际尾部=${JSON.stringify(rawTail.slice(-20))}）——` +
      "若它的形态变了，请重写本变异臂而不是删掉这条断言",
  );
  const tail = rawTail.slice(0, -1);
  assert.match(
    tail,
    /taskFiles\.some\(/,
    `AC-937 判据的尾部必须仍是 taskFiles.some(...) 扫全表形态；实际=${JSON.stringify(tail.slice(0, 120))}`,
  );
  // 被替换段的【外层收尾】必须保留：判据整体是 `node -e "<js>"`，剥掉 AC-937 自身的收尾引号后
  // 要用 AC-939 自己的那一个补回去，否则变异脚本是一条未闭合的 shell 字符串（假红，不是回归）。
  const closing = criterion.slice(-1);
  assert.equal(
    closing,
    '"',
    `AC-939 判据应以闭合的 shell 双引号收尾（实际尾部=${JSON.stringify(criterion.slice(-20))}）`,
  );
  return criterion.slice(0, bIdx) + tail + closing;
}

test("变异负控：绑定段换回 AC-937 扫全表形态后，负控① 的同一 fixture 从 exit 1 变 exit 0", () => {
  const MUTATED = mutateToScanAll(CRITERION_939);
  assert.notEqual(MUTATED, CRITERION_939, "变异必须真的改动了判据文本（空变异会让本臂静默测真判据）");

  // 与负控① 完全相同的夹具：台账记 T1（todo），另有 T2（goal_ac: AC-937, done）顶替。
  const root = makeFixture({
    ledger: [ledgerRow("spawned"), ledgerRow("filed", { taskId: "T1" })],
    tasks: {
      T1: { status: "todo" },
      T2: { status: "done" },
    },
  });

  // 先确认这份 fixture 对【真】判据确实是红的 —— 变异臂的前后对照必须是同一份输入。
  const before = runCriterion(root, CRITERION_939);
  assert.equal(before.status, 1, "变异臂的前置：同一份 fixture 对真判据必须是 exit 1");

  const after = runCriterion(root, MUTATED);
  assert.equal(
    after.status,
    0,
    "lock is not measuring the binding —— 换成扫全表形态后本应被顶替品顶绿，实际仍红：" +
      "说明负控① 通过的原因与「绑定」无关（这条锁没有测到它自以为测的东西）。" +
      `stderr=${JSON.stringify(after.stderr)}`,
  );

  const out = lastJsonLine(after.stdout);
  assert.ok(out, `变异后的读数应是 JSON；实际=${JSON.stringify(after.stdout)}`);
  assert.equal(out.landed, true, "变异后的判据应报 landed:true（扫全表形态被 T2 顶绿）");
});
