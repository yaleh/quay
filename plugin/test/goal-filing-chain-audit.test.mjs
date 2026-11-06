// @test-group engine
// goal-filing-chain-audit.test.mjs — tasks/gap-goal-filing-chain-audit（AC-937 的读面）
//
// 被测：plugin/scripts/goal-filing-chain-audit.ts —— 把 .quay/goal-filing.jsonl 里每条
// `state:"filed"` 行的 taskId 拿回 tasks/<taskId>.md 交叉核对（goal_ac / status），并把
// 「有 done 任务认领该 AC、却没有任何 filed 行指向它」报成 unfiled-claim。
//
// 本文件的每一条腿都是「审计器判错时会红」的臂，不是「文件存在」的读数：
//   正控          landed                    ⇒ exit 0，verdict chain-landed
//   负控①         task-missing              ⇒ exit 1，verdict task-missing
//   负控②         goal-ac-mismatch          ⇒ exit 1，verdict goal-ac-mismatch
//   负控③         not-done                  ⇒ exit 1，verdict not-done
//   负控④         unfiled-claim（独立驱动）  ⇒ 一条 landed 行 + 另一份 done 任务认领同一 AC ⇒ exit 1
//   负控④b        AC-939 的替代品形态        ⇒ filed 指向 todo、另有一份 done 认领 ⇒ exit 1 且
//                                              verdict=not-done（⛔ 判 0 就是本任务要消灭的那次回归）
//   负控⑤         no-task-id                ⇒ exit 1，verdict no-task-id
//   未评估三态    空台账 / 只有 spawned / --ac 从未立案 ⇒ 都 exit 2（不是 0），
//                 --json 带 evaluated:false + cause（硬规则 3b）
//   未评估 · tasks/ 读不到 ⇒ exit 2 cause=tasks-unreadable（读不懂输入不得伪装成「零任务」）
//   预置探针       --ac 点名一个台账从未立案、但已有 done 任务认领的 AC ⇒ exit 1 + unfiled-claim
//
// Run: node --test plugin/test/goal-filing-chain-audit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "goal-filing-chain-audit.ts");

/** 一份任务文件；审计器只读 frontmatter 的 status / goal_ac，正文不参与判定。 */
function taskFile(id, { status, goalAc }) {
  const lines = ["---", `id: ${id}`, `title: "fixture ${id}"`, `status: ${status}`];
  if (goalAc !== undefined) lines.push(`goal_ac: ${goalAc}`);
  lines.push("---", "## Proposal", "fixture body", "");
  return lines.join("\n");
}

/** 一条台账行（spawned / filed 两种）。`taskId` 只在显式给了才写这个键（缺键是一个独立负控）。 */
function ledgerRow(state, { requestId = "r1", ac = "AC-1", goal = "GOAL-1", taskId } = {}) {
  const base = {
    state,
    requestId,
    ac,
    goal,
    at: "2026-11-06T00:00:01.000Z",
    promptSha: "fixture0000000000",
    round: "2026-11-06T00:00:00.000Z",
  };
  if (state === "spawned") return base;
  const row = { ...base, spawnedAt: "2026-11-06T00:00:00.000Z", reason: null };
  if (taskId !== undefined) row.taskId = taskId;
  return row;
}

/**
 * 建一份 fixture 工作区。`ledger` 里的字符串条目按【原始行】写入（用来造坏行），对象条目按一行 JSON 写入。
 * @param {{ ledger: object[] | string, tasks?: Record<string, {status: string, goalAc?: string}>, noTasksDir?: boolean }} spec
 */
function makeFixture({ ledger, tasks = {}, noTasksDir = false }) {
  const root = makeTmpDir("gfca-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  if (!noTasksDir) fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const text =
    typeof ledger === "string"
      ? ledger
      : ledger.map((r) => (typeof r === "string" ? r : `${JSON.stringify(r)}\n`)).join("");
  fs.writeFileSync(path.join(root, ".quay", "goal-filing.jsonl"), text, "utf8");
  for (const [id, t] of Object.entries(tasks)) {
    fs.writeFileSync(path.join(root, "tasks", `${id}.md`), taskFile(id, t), "utf8");
  }
  return root;
}

/** 跑审计器（真 CLI —— 退出码本身是被测面）。 */
function runAudit(root, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", root, "--json", ...extraArgs],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(r.error, undefined, `审计器未能执行（spawn error）：${r.error && r.error.message}`);
  let reading = null;
  try {
    reading = JSON.parse(r.stdout);
  } catch {
    reading = null;
  }
  assert.ok(
    reading,
    `--json 必须产出可解析的 JSON 读数，否则「未评估」与「跑挂了」不可分。stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`,
  );
  return { status: r.status, reading, stderr: r.stderr };
}

// ── 正控：filed 的 taskId 真的落地成了那份认领同一 AC 的 done 任务 ─────────────────────────────
test("正控 · landed：filed{taskId:t1} + tasks/t1.md(goal_ac: AC-1, done) ⇒ exit 0 且 verdict=landed", () => {
  const root = makeFixture({
    ledger: [ledgerRow("spawned"), ledgerRow("filed", { taskId: "t1" })],
    tasks: { t1: { status: "done", goalAc: "AC-1" } },
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 0, `全链成立必须读绿；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.evaluated, true);
  assert.equal(reading.verdict, "chain-landed");
  assert.equal(reading.summary.filedRows, 1);
  assert.equal(reading.summary.landed, 1);
  assert.deepEqual(reading.unfiledClaims, []);
  assert.equal(reading.rows[0].verdict, "landed");
});

// ── 负控①：taskId 指向不存在的任务文件 ──────────────────────────────────────────────────────
test("负控 · task-missing：filed 指向 tasks/ 里没有的 taskId ⇒ exit 1 且 verdict=task-missing", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "gone" })],
    tasks: { other: { status: "done", goalAc: "AC-1" } },
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 1, `文件缺失必须判红；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.evaluated, true);
  assert.equal(reading.verdict, "chain-broken");
  assert.equal(reading.rows[0].verdict, "task-missing");
  assert.equal(reading.summary.taskMissing, 1);
});

// ── 负控②：文件在，但认领的是别的 AC ────────────────────────────────────────────────────────
test("负控 · goal-ac-mismatch：filed{ac:AC-1} 的任务文件写 goal_ac: AC-2 ⇒ exit 1 且 verdict=goal-ac-mismatch", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "t1" })],
    tasks: { t1: { status: "done", goalAc: "AC-2" } },
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 1, `AC 不认领必须判红；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.rows[0].verdict, "goal-ac-mismatch");
  assert.equal(reading.summary.goalAcMismatch, 1);
});

// ── 负控③：AC2 前半 —— filed 指向 todo 任务 ────────────────────────────────────────────────
test("负控 · not-done：filed 行指向 status: todo 的任务 ⇒ exit 1 且 verdict=not-done", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "t1" })],
    tasks: { t1: { status: "todo", goalAc: "AC-1" } },
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 1, `未落地必须判红；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.rows[0].verdict, "not-done");
  assert.equal(reading.summary.notDone, 1);
  assert.equal(reading.rows[0].status, "todo");
});

// ── 负控④：unfiled-claim 单独驱动 exit 1（filed 行本身是 landed） ────────────────────────────
test("负控 · unfiled-claim（独立驱动）：唯一 filed 行 landed，另一份 done 任务认领同一 AC 却无人指向 ⇒ exit 1", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "t1" })],
    tasks: {
      t1: { status: "done", goalAc: "AC-1" }, // 台账记下的那份 —— 已落地
      t2: { status: "done", goalAc: "AC-1" }, // 预置认领：认领同一 AC，但没有任何 filed 行指向它
    },
  });
  const { status, reading } = runAudit(root);
  assert.equal(
    status,
    1,
    `「另有 done 任务认领同一 AC 而台账没记它」必须判红——这正是 AC-937 的 (a) 预置认领形态；reading=${JSON.stringify(reading)}`,
  );
  assert.equal(reading.summary.landed, 1, "前置：台账记下的那份确实 landed（红只能来自 unfiled-claim）");
  assert.deepEqual(reading.unfiledClaims, [{ ac: "AC-1", taskId: "t2" }]);
  assert.equal(reading.summary.unfiledClaims, 1);
});

// ── 负控④b：AC-939 替代品形态 —— 另一份 done 任务不得把「filed 指向 todo」判成 0 ─────────────
test("负控 · 替代品：filed 指向 todo 的 T1、另有 done 的 T2 认领同一 AC ⇒ exit 1（⛔ 不得判 0）", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "T1" })],
    tasks: {
      T1: { status: "todo", goalAc: "AC-1" },
      T2: { status: "done", goalAc: "AC-1" },
    },
  });
  const { status, reading } = runAudit(root);
  assert.equal(
    status,
    1,
    `顶替品把判据翻绿正是本任务要消灭的形态；reading=${JSON.stringify(reading)}`,
  );
  assert.equal(reading.rows[0].verdict, "not-done");
  assert.deepEqual(reading.unfiledClaims, [{ ac: "AC-1", taskId: "T2" }]);
});

// ── 负控⑤：filed 行没有 taskId 字段（⛔ 与「文件没了」不同形） ───────────────────────────────
test("负控 · no-task-id：filed 行缺 taskId ⇒ exit 1 且 verdict=no-task-id（不是 task-missing）", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed")],
    tasks: { t1: { status: "done", goalAc: "AC-1" } },
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 1);
  assert.equal(reading.rows[0].verdict, "no-task-id");
  assert.equal(reading.summary.noTaskId, 1);
  assert.equal(reading.summary.taskMissing, 0, "「行上没 id」不得被记成「文件没了」");
});

// ── 未评估三态：三种输入都 exit 2 且 evaluated:false + cause ─────────────────────────────────
test("未评估 · 空台账 ⇒ exit 2、evaluated:false、cause=no-filed-rows（⛔ 不是 0）", () => {
  const root = makeFixture({ ledger: "" });
  const { status, reading } = runAudit(root);
  assert.equal(status, 2, `空台账是一个测量，不是「全链成立」；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.evaluated, false);
  assert.equal(reading.verdict, "not-evaluated");
  assert.equal(reading.cause, "no-filed-rows");
});

test("未评估 · 只有 spawned 行 ⇒ exit 2、cause=no-filed-rows", () => {
  const root = makeFixture({
    ledger: [ledgerRow("spawned")],
    tasks: { t1: { status: "done", goalAc: "AC-1" } },
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 2, `没有终态 filed 行就无从核对；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.evaluated, false);
  assert.equal(reading.cause, "no-filed-rows");
});

test("未评估 · --ac 指向从未立案的 AC ⇒ exit 2、cause=no-filed-rows-and-no-done-claim", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "t1" })],
    tasks: { t1: { status: "done", goalAc: "AC-1" } },
  });
  const { status, reading } = runAudit(root, ["--ac", "AC-999"]);
  assert.equal(status, 2, `点名的 AC 没有任何可判对象；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.evaluated, false);
  assert.equal(reading.cause, "no-filed-rows-and-no-done-claim");
});

test("未评估 · tasks/ 读不到 ⇒ exit 2、cause=tasks-unreadable（⛔ 不当成「零任务」）", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "t1" })],
    noTasksDir: true,
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 2, `读不懂 tasks/ 不得返回与「链断」或「全链成立」同形的值；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.evaluated, false);
  assert.equal(reading.cause, "tasks-unreadable");
});

// ── 预置认领探针（--ac 显式范围）：台账从未立案，但已有 done 任务认领该 AC ────────────────────
test("预置探针 · --ac 点名从未立案的 AC 而台账外已有 done 任务认领它 ⇒ exit 1 + unfiled-claim", () => {
  const root = makeFixture({
    ledger: [ledgerRow("filed", { taskId: "t1", ac: "AC-1" })],
    tasks: {
      t1: { status: "done", goalAc: "AC-1" },
      preset: { status: "done", goalAc: "AC-777" }, // 事先写好、从不经 driver 立案
    },
  });
  const { status, reading } = runAudit(root, ["--ac", "AC-777"]);
  assert.equal(status, 1, `预置认领必须判红；reading=${JSON.stringify(reading)}`);
  assert.equal(reading.evaluated, true);
  assert.deepEqual(reading.unfiledClaims, [{ ac: "AC-777", taskId: "preset" }]);
  assert.equal(reading.summary.filedRows, 0, "该 AC 没有 filed 行——红只来自 unfiled-claim");
});

// ── 五种 verdict 同处一个枚举，且 badLines 不吞掉整份台账 ────────────────────────────────────
test("枚举完整性：五条臂产出的 verdict 恰覆盖 landed / task-missing / goal-ac-mismatch / not-done / no-task-id，且坏行被计数不拖垮整份台账", () => {
  const root = makeFixture({
    ledger: [
      ledgerRow("filed", { requestId: "r-landed", taskId: "a" }),
      ledgerRow("filed", { requestId: "r-missing", taskId: "gone" }),
      ledgerRow("filed", { requestId: "r-mismatch", taskId: "b" }),
      ledgerRow("filed", { requestId: "r-notdone", taskId: "c" }),
      ledgerRow("filed", { requestId: "r-noid" }),
      "not json at all\n",
    ],
    tasks: {
      a: { status: "done", goalAc: "AC-1" },
      b: { status: "done", goalAc: "AC-2" },
      c: { status: "todo", goalAc: "AC-1" },
    },
  });
  const { status, reading } = runAudit(root);
  assert.equal(status, 1);
  assert.equal(reading.badLines, 1, "坏行必须被计数——跳过不等于没发生");
  assert.deepEqual(
    reading.rows.map((r) => r.verdict).sort(),
    ["goal-ac-mismatch", "landed", "no-task-id", "not-done", "task-missing"],
    `五条 arm 必须各产出自己的 verdict（枚举，不许合并）；rows=${JSON.stringify(reading.rows)}`,
  );
  assert.equal(reading.summary.filedRows, 5);
  assert.equal(reading.summary.landed, 1);
});

test("--help 是纯帮助（exit 0、无业务副作用），未知参数是 exit 2", () => {
  const help = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", SCRIPT, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, `--help 必须 exit 0；stderr=${JSON.stringify(help.stderr)}`);
  assert.match(help.stdout, /usage: goal-filing-chain-audit/);

  const bogus = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", SCRIPT, "--ac", "AC-1", "--nope"],
    { encoding: "utf8" },
  );
  assert.equal(bogus.status, 2, "未知参数是用法错误（2），不是「链断」（1）");
});
