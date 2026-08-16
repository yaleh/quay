// @test-group engine
// outer-cron-registry.test.mjs — AC81 注册表收据 + 每轮四判据核实测试
// (tasks/gap-ac81-registry-receipt-and-four-criteria, AC1-AC6 + DoD).
//
// 检查器 plugin/scripts/outer-cron-registry.ts 回答：「outer/inner 的 CronCreate 锚是否有 git 跟踪
// 注册表收据（cron id + cron 表达式 + prompt sha256 + 创建时刻），且每轮四判据核实能取假——并在
// CronCreate 7 天自动过期硬上限前把锚剩余寿命报出来？」
//
// This file pins:
//   (a) pure logic — sha256Hex / parseCronList / cronListExactlyOne / remainingLifetimeMs /
//       loadRegistry / checkVerify (四判据 + 判据5)。
//   (b) REAL-DATA tests（硬规则 4 推论三 —— 判据4 必须比对真实 prompt，不只 fixture 形）：
//       实际内层 prompt（job ff96ad7e 的指针 prompt，815B）与 实际外层 prompt
//       （job 4e88cb1b 的正本 orchestration/outer-tick-prompt.txt，166B）同时作 正本 与注册表 sha256
//       的对照物，断言四判据全真（exit 0）且剩余寿命 ≈7 天（判据5 不触发）。
//   (c) NEGATIVE CONTROLS（四判据能取假）：
//       (a) 注册表 id ≠ CronList id ⇒ VIOLATED (exit 1)；
//       (b) 注册表 sha256 ≠ 实际 prompt（正本一字符漂移）⇒ VIOLATED (exit 1)；
//       (c) CronList 非恰一条（0 条 / 2 条）⇒ VIOLATED (exit 1)；
//       (d) 剩余寿命 < 24h ⇒ 报 CRITICAL 且 exit 1（判据5 触发）。
//   (d) NOT-EVALUATED（硬规则 3b：无法评估 ≠ 通过）：
//       (1) 未提供 --cron-list ⇒ exit 2；
//       (2) 内层正本缺失（--root 指向无 AC80 段的目录）⇒ exit 2（①-③ 全真但 ④ 无法评估）。
//   (e) worktree 上下文默认路径正本查找（round172 回归）：AC80-INNER-ANCHOR 段在默认
//       plugin/loop/fast-mode-loop-tick.md ⇒ ④ evaluated（非 NOT-EVALUATED）——round172 的旧测试
//       误期「本 worktree 无 AC80 段」（2eedf16c 已落地该段），把「段存在且被评估」读成「正本缺失」而失败。
//
// Run:
//   scripts/test.sh plugin/test/outer-cron-registry.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import {
  sha256Hex,
  parseCronList,
  cronListExactlyOne,
  remainingLifetimeMs,
  loadRegistry,
  checkVerify,
  cronMinuteSet,
  cronExprsEquivalent,
  EXIT_OK,
  EXIT_VIOLATED,
  EXIT_NOT_EVALUATED,
  SEVEN_DAYS_MS,
  CRITICAL_REMAINING_MS,
} from "../scripts/outer-cron-registry.ts";
import { INNER_ANCHOR_BEGIN_MARK, INNER_ANCHOR_END_MARK, extractCanonical } from "../scripts/outer-anchor-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_FILE = path.join(REPO_ROOT, "plugin", "scripts", "outer-cron-registry.json");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "outer-cron-registry.ts");

// ── 真实数据（判据4 的 canonical 输入）──────────────────────────────────────────────────────────────

// 内层 CronCreate（job ff96ad7e）prompt 原文 —— AC80 任务体给定的权威字符串（与
// outer-anchor-check.test.mjs 的 INNER_PROMPT 逐字一致）。**字面原样，勿改字符。**
const INNER_PROMPT =
  "[inner-tick] 执行内层 tick。不要依赖上下文记忆——本 prompt 只是指针，内容现读：(1) 读 orchestration/fast-mode-tick-core.md 拿本轮步骤（执行核；理由/实测/代价在 $REPO_ROOT/docs/analysis/fast-mode-loop-tick.md，仅需「为什么」时按 src:N 查，不要每轮全读）；(2) `tail -10 .quay/inner-tick-log.jsonl` 拿上一轮状态（只 tail，全读不可行）；(3) 读 orchestration/manager-phase-goal.md 拿当前阶段目标与 AC（当前阶段在文件后段，按节标题定位，勿全读）。执行完必须向 .quay/inner-tick-log.jsonl 追加一行。唤醒锚核实（AC81）：每轮先核实——CronList 恰一条 + 其 id 等于注册表记录 + --verify 报 registry-verified；三条全真则不动，任一为假才清扫重建，绝不靠记住的 ID。";

// 外层 CronCreate（job 4e88cb1b）prompt 原文 —— orchestration/outer-tick-prompt.txt 内容去尾部换行
// （develop commit 72b99cda）。**字面原样，勿改字符。**
const OUTER_PROMPT =
  "执行 /home/yale/work/quay/orchestration/orchestrator-tick-core.md 中的 tick 指令（入口直指执行核，1 跳；理由档案按需查 src:N，不要全读）";

function tmpFile(ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac81-"));
  const p = path.join(dir, `f.${ext}`);
  return { dir, p };
}

/** 构造 inner 正本段 fixture（与 AC80 的 AC80-INNER-ANCHOR 提取契约一致）。 */
function writeInnerSection(p, prompt) {
  fs.writeFileSync(
    p,
    `<!-- ${INNER_ANCHOR_BEGIN_MARK}: inner CronCreate prompt 正本（AC80）——勿单边改，改即漂移 -->\n${prompt}\n<!-- ${INNER_ANCHOR_END_MARK} -->\n`,
  );
}

/** 构造一个 fixture 注册表（深拷贝 + 按层覆盖字段）。 */
function makeRegistry(overrides = {}) {
  const base = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  for (const [layer, patch] of Object.entries(overrides)) {
    base.layers[layer] = { ...base.layers[layer], ...patch };
  }
  return base;
}

/** 把一个 fixture 注册表写入独立 tmpdir，返回其目录与文件路径。 */
function writeRegistry(reg) {
  const { dir, p } = tmpFile("json");
  fs.writeFileSync(p, JSON.stringify(reg, null, 2));
  return { dir, p };
}

function runReg(args) {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ── 纯函数 ───────────────────────────────────────────────────────────────────────────────────────────

test("sha256Hex: real inner prompt hashes to the registry value (336ab9…)", () => {
  const h = sha256Hex(INNER_PROMPT);
  assert.equal(h, "336ab98718d1234bde8cd3dcae64230b8f204cfcd9ab5592ad080c3ec3715b61");
});

test("sha256Hex: real outer prompt hashes to the registry value (d520ef…)", () => {
  const h = sha256Hex(OUTER_PROMPT);
  assert.equal(h, "d520ef85537a4a32bdf5c93688e945da091bff846388d80da12a6780b8036ac9");
});

test("parseCronList: array / single-object / id-alias tolerance", () => {
  assert.deepEqual(parseCronList('[{"id":"ff96ad7e"}]'), [{ id: "ff96ad7e" }]);
  assert.deepEqual(parseCronList('{"id":"ff96ad7e"}'), [{ id: "ff96ad7e" }]);
  assert.deepEqual(parseCronList('[{"name":"ff96ad7e"}]'), [{ id: "ff96ad7e" }]);
  assert.deepEqual(parseCronList('[{"cronId":"4e88cb1b"}]'), [{ id: "4e88cb1b" }]);
  assert.deepEqual(parseCronList("[]"), []);
  assert.equal(parseCronList("not-json"), null);
  assert.equal(parseCronList('[{"no-id":1}]'), null);
});

test("cronListExactlyOne: exactly one true, 0/2 false, unparseable false", () => {
  assert.equal(cronListExactlyOne([{ id: "x" }]), true);
  assert.equal(cronListExactlyOne([]), false);
  assert.equal(cronListExactlyOne([{ id: "x" }, { id: "y" }]), false);
  assert.equal(cronListExactlyOne(null), false);
});

test("remainingLifetimeMs: 7-day window from createdAt; unparseable → null", () => {
  const createdMs = Date.parse("2026-08-14T15:17:16Z");
  const nowMs = createdMs + 1000;
  assert.equal(remainingLifetimeMs("2026-08-14T15:17:16Z", nowMs), SEVEN_DAYS_MS - 1000);
  assert.equal(remainingLifetimeMs("not-a-date", nowMs), null);
  // 判据5 能取假：现在（created 当天）剩余 ≈7 天 ⇒ 非 critical；第 6 天（remaining < 24h）⇒ critical。
  assert.equal(SEVEN_DAYS_MS - 1000 > CRITICAL_REMAINING_MS, true);
  assert.equal(remainingLifetimeMs("2026-08-14T15:17:16Z", nowMs) < CRITICAL_REMAINING_MS, false);
});

test("cronMinuteSet: `*/N` 展开成显式分钟集合；`0,20,40`/`7,27,47`/`*` 解析", () => {
  assert.deepEqual(cronMinuteSet("*/20 * * * *"), [0, 20, 40]);
  assert.deepEqual(cronMinuteSet("0,20,40 * * * *"), [0, 20, 40]);
  assert.deepEqual(cronMinuteSet("7,27,47 * * * *"), [7, 27, 47]);
  assert.deepEqual(cronMinuteSet("*/30 * * * *"), [0, 30]);
  assert.deepEqual(cronMinuteSet("* * * * *"), [...Array(60).keys()]);
  assert.deepEqual(cronMinuteSet("10-15 * * * *"), [10, 11, 12, 13, 14, 15]);
  assert.deepEqual(cronMinuteSet("5/20 * * * *"), [5, 25, 45]);
  // 无法归一化 ⇒ null（字段数不足 / 非标准分钟子字段）
  assert.equal(cronMinuteSet("*/20 * * *"), null);
  assert.equal(cronMinuteSet("? * * * *"), null);
});

test("cronExprsEquivalent: 语义等价 `*/20`≡`0,20,40`；真漂移不≡", () => {
  assert.equal(cronExprsEquivalent("*/20 * * * *", "0,20,40 * * * *"), true);
  assert.equal(cronExprsEquivalent("0,20,40 * * * *", "*/20 * * * *"), true);
  assert.equal(cronExprsEquivalent("*/20 * * * *", "*/30 * * * *"), false); // 真漂移（分钟集合不同）
  assert.equal(cronExprsEquivalent("*/20 * * * *", "7,27,47 * * * *"), false); // 真漂移
  assert.equal(cronExprsEquivalent("7,27,47 * * * *", "7,27,47 * * * *"), true); // 字符串等短路
  assert.equal(cronExprsEquivalent("*/20 0 * * *", "0,20,40 * * * *"), false); // 非分钟字段漂移
  assert.equal(cronExprsEquivalent("*/20 * * *", "0,20,40 * * * *"), false); // 字段数不符且字符串不等
});

test("loadRegistry: real git-tracked registry file parses with both layers", () => {
  const reg = loadRegistry(REPO_ROOT);
  assert.ok(reg);
  assert.equal(reg.layers.inner.cronId, "ff96ad7e");
  assert.equal(reg.layers.inner.cronExpr, "7,27,47 * * * *");
  assert.equal(reg.layers.outer.cronId, "4e88cb1b");
  assert.equal(reg.layers.outer.cronExpr, "0,20,40 * * * *");
  assert.equal(reg.layers.inner.promptSha256, sha256Hex(INNER_PROMPT));
  assert.equal(reg.layers.outer.promptSha256, sha256Hex(OUTER_PROMPT));
});

test("REAL cross-consistency: live doc AC80 canonical == 注册表 inner promptSha256（两检查器同权威——gap-ac81 对账一致）", () => {
  // gap-ac81 2026-08-16：outer-anchor-check 判据3 的正本来源（fast-mode-loop-tick.md AC80 段）必须与
  // outer-cron-registry 判据④ 的注册表 promptSha256 逐字节同权威——任一单边改 canonical 而未改注册表，
  // 这条就翻红（registry verify 的 anchorMatches 也会翻假）。钉死「两检查器对判据4 一致」。
  const doc = path.join(REPO_ROOT, "plugin", "loop", "fast-mode-loop-tick.md");
  const canon = extractCanonical(fs.readFileSync(doc, "utf8"), "inner");
  assert.ok(canon !== null, "live doc 必须含 AC80-INNER-ANCHOR 段");
  const reg = loadRegistry(REPO_ROOT);
  assert.equal(sha256Hex(canon), reg.layers.inner.promptSha256);
  assert.equal(Buffer.byteLength(canon, "utf8"), reg.layers.inner.promptBytes);
});

// ── REAL-DATA（真实锚数据走真实比对路径，硬规则 4 推论三）───────────────────────────────────────────

test("REAL inner anchor: 四判据全真 + 剩余寿命≈7天 ⇒ PASS (exit 0)", () => {
  const reg = loadRegistry(REPO_ROOT);
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e", schedule: "7,27,47 * * * *" }]),
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
    assert.match(r.stdout, /判据5 剩余寿命/);
    // 判据5 现在（created 当天）不触发：剩余 ≈7 天 > 24h。
    const res = checkVerify({
      layer: "inner",
      registry: reg,
      cronListRaw: JSON.stringify([{ id: "ff96ad7e" }]),
      canonicalPrompt: INNER_PROMPT,
      nowMs: Date.parse("2026-08-14T16:00:00Z"),
    });
    assert.equal(res.remaining.critical, false);
    assert.ok(res.remaining.remainingHours > 24, `remainingHours=${res.remaining.remainingHours}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL outer anchor: 四判据全真 ⇒ PASS (exit 0)", () => {
  const { dir, p } = tmpFile("txt");
  try {
    fs.writeFileSync(p, OUTER_PROMPT + "\n"); // 正本文件带尾部换行；extractCanonical 剥一个
    const r = runReg([
      "--verify", "--layer", "outer",
      "--cron-list", JSON.stringify([{ id: "4e88cb1b", schedule: "0,20,40 * * * *" }]),
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── NEGATIVE CONTROLS（四判据能取假）─────────────────────────────────────────────────────────────────

test("(a) 判据② 能取假: 注册表 id ≠ CronList id ⇒ VIOLATED (exit 1)", () => {
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "DEADBEEF" }]),
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /id.*≠ 注册表|≠ 注册表/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("(b) 判据④ 能取假: 正本一字符漂移 ⇒ 注册表 sha256 ≠ 正本 ⇒ VIOLATED (exit 1)", () => {
  const { dir, p } = tmpFile("md");
  try {
    const drifted = INNER_PROMPT.slice(0, -1) + "。x"; // 一字符漂移
    writeInnerSection(p, drifted);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /判据④|sha256/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("(c) 判据① 能取假: CronList 0 条 ⇒ VIOLATED (exit 1)", () => {
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", "[]",
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /判据①|CronList 条数=0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("(c) 判据① 能取假: CronList 2 条 ⇒ VIOLATED (exit 1)", () => {
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }, { id: "AAAA" }]),
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /CronList 条数=2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("(d) 判据5 能取假: 剩余寿命 < 24h ⇒ CRITICAL 且 VIOLATED (exit 1)", () => {
  // 注册表 createdAt 设为 6.5 天前 ⇒ 剩余 ≈12h < 24h；四判据仍全真 ⇒ 判据5 单独触发。
  const sixAndHalfDaysAgo = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000).toISOString();
  const reg = makeRegistry({ inner: { createdAt: sixAndHalfDaysAgo, verifiedAt: sixAndHalfDaysAgo } });
  const regTmp = writeRegistry(reg);
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--canonical-file", p,
      "--registry-file", regTmp.p,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /CRITICAL|判据5/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(regTmp.dir, { recursive: true, force: true });
  }
});

test("判据③ 能取假: verifiedAt 过期（>stale）⇒ registry-not-verified ⇒ VIOLATED (exit 1)", () => {
  const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 天前 > 7 天窗口
  const reg = makeRegistry({ inner: { verifiedAt: stale } });
  const regTmp = writeRegistry(reg);
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--canonical-file", p,
      "--registry-file", regTmp.p,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /registry-not-verified/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(regTmp.dir, { recursive: true, force: true });
  }
});

test("cron-expr-mismatch: 真漂移（`*/20`={0,20,40} vs 注册表 inner `7,27,47`）⇒ 仍 VIOLATED (exit 1)", () => {
  // 回归钉（gap-a23-ticklog-verify-and-cron-normalization 判据1）：真漂移（不同分钟集合）必须仍红。
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e", schedule: "*/20 * * * *" }]),
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /cron-expr-mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cron-expr-mismatch: 语义等价 `*/20` ≡ 注册表 outer `0,20,40` ⇒ 不再 VIOLATED (PASS, 无 cron-expr-mismatch)", () => {
  // 恒红翻绿样本（gap-a23-ticklog-verify-and-cron-normalization 判据3）：`*/20` 与 `0,20,40`
  // 都第 0/20/40 分钟——归一化后等价 ⇒ cron-expr-mismatch 不出现 ⇒ 四判据全真 + 剩余正常 ⇒ exit 0。
  const { dir, p } = tmpFile("txt");
  try {
    fs.writeFileSync(p, OUTER_PROMPT + "\n"); // 正本文件带尾部换行；extractCanonical 剥一个
    const r = runReg([
      "--verify", "--layer", "outer",
      "--cron-list", JSON.stringify([{ id: "4e88cb1b", schedule: "*/20 * * * *" }]),
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
    assert.doesNotMatch(r.stdout, /cron-expr-mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── NOT-EVALUATED（硬规则 3b：无法评估 ≠ 通过）──────────────────────────────────────────────────────

test("NOT-EVALUATED: 未提供 --cron-list ⇒ exit 2，非通过", () => {
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--canonical-file", p,
      "--registry-file", REGISTRY_FILE,
    ]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /NOT-EVALUATED/);
    assert.match(r.stdout, /cron-list/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree 上下文默认路径正本查找（round172 回归）：AC80 段在默认 plugin/loop/fast-mode-loop-tick.md ⇒ ④ evaluated（非 NOT-EVALUATED）", () => {
  // 默认路径（无 --canonical-file，root=cwd=本 worktree/主检出）：2eedf16c 已落地
  // plugin/loop/fast-mode-loop-tick.md 的 AC80-INNER-ANCHOR 段 ⇒ 正本可解析，判据④ 被评估
  // （重建/更新注册表前 sha256 或 mismatch → exit 1，更新后 → exit 0；两者都不是 NOT-EVALUATED exit 2）。
  // round172 的旧测试误期「本 worktree 无 AC80 段 ⇒ exit 2」，把「段存在且被评估」读成「正本缺失」。
  const r = runReg([
    "--verify", "--layer", "inner",
    "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
    "--registry-file", REGISTRY_FILE,
  ]);
  assert.notEqual(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
  assert.match(r.stdout, /判据 anchorMatches/, `stdout: ${r.stdout}`);
  assert.doesNotMatch(r.stdout, /正本缺失/, `stdout: ${r.stdout}`);
});

test("NOT-EVALUATED: 内层正本缺失（--root 指向无 AC80 段的目录）⇒ exit 2（①-③ 真但 ④ 无法评估）", () => {
  // 硬规则 3b 独立取值：正本真正缺失时不得伪装成通过。--root 指向空 tmpdir ⇒
  // <root>/plugin/loop/fast-mode-loop-tick.md 不存在 ⇒ 正本缺失 ⇒ ①-③ 全真但 ④ 无法评估。
  const { dir } = tmpFile("md");
  try {
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--registry-file", REGISTRY_FILE,
      "--root", dir,
    ]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /NOT-EVALUATED/);
    assert.match(r.stdout, /正本缺失/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("NOT-EVALUATED: 注册表缺失/层缺失 ⇒ exit 2", () => {
  const regTmp = writeRegistry({});
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--canonical-file", p,
      "--registry-file", regTmp.p,
    ]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /NOT-EVALUATED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(regTmp.dir, { recursive: true, force: true });
  }
});

// ── checkVerify 纯函数直测（nowMs 可控）─────────────────────────────────────────────────────────────

test("checkVerify: 四判据全真 + 剩余正常 ⇒ ok:true (exit 0)", () => {
  const reg = loadRegistry(REPO_ROOT);
  const nowMs = Date.parse("2026-08-15T02:00:00Z");
  const res = checkVerify({
    layer: "inner",
    registry: reg,
    cronListRaw: JSON.stringify([{ id: "ff96ad7e" }]),
    canonicalPrompt: INNER_PROMPT,
    nowMs,
  });
  assert.equal(res.ok, true);
  assert.equal(res.code, EXIT_OK);
  assert.equal(res.criteria.cronListExactlyOne.ok, true);
  assert.equal(res.criteria.idMatches.ok, true);
  assert.equal(res.criteria.registryVerified.ok, true);
  assert.equal(res.criteria.anchorMatches.ok, true);
  assert.equal(res.remaining.critical, false);
});

test("checkVerify: id 不匹配 ⇒ ok:false (exit 1)，findings 含判据②", () => {
  const reg = loadRegistry(REPO_ROOT);
  const res = checkVerify({
    layer: "inner",
    registry: reg,
    cronListRaw: JSON.stringify([{ id: "WRONG" }]),
    canonicalPrompt: INNER_PROMPT,
    nowMs: Date.parse("2026-08-14T16:00:00Z"),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, EXIT_VIOLATED);
  assert.ok(res.findings.some((f) => f.includes("判据②")));
});
