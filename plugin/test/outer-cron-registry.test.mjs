// @test-group engine
// outer-cron-registry.test.mjs — AC81 注册表收据 + 每轮四判据核实测试
// (tasks/gap-ac81-registry-receipt-and-four-criteria, AC1-AC6 + DoD;
//  tasks/gap-cron-registry-global-path-migration, AC1-AC5).
//
// 检查器 plugin/scripts/outer-cron-registry.ts 回答：「outer/inner 的 CronCreate 锚是否有注册表收据
// （cron id + cron 表达式 + prompt sha256 + 创建时刻），且每轮四判据核实能取假——并在 CronCreate
// 7 天自动过期硬上限前把锚剩余寿命报出来？」
//
// 注册表位置（2026-08-17 人裁定方案②）：~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt
// （全局 per-layer、不进 git；任何 worktree 读当前真值，非 fork 快照）。
//
// This file pins:
//   (a) pure logic — sha256Hex / parseCronList / cronListExactlyOne / remainingLifetimeMs /
//       loadRegistry / checkVerify (四判据 + 判据5) / repoSlug / canonicalRepoRoot / registryBaseFor /
//       registryFileFor / parseRegistryText / serializeRegistryText / writeRegistryRecord /
//       appendAuditLine / recordLayer。
//   (b) REAL-DATA tests（硬规则 4 推论三 —— 判据4 必须比对真实 prompt，不只 fixture 形）：
//       实际内层 prompt（job ff96ad7e 的指针 prompt，815B→现 828B）与 实际外层 prompt
//       （job 4e88cb1b/a2360e1d 的正本 orchestration/outer-tick-prompt.txt，166B）同时作 正本 与注册表
//       sha256 的对照物，断言四判据全真（exit 0）且剩余寿命正常（判据5 不触发）。
//       REAL 载体 = 全局 per-layer 注册表（AC2：任何 worktree 读当前真值）；缺失则 skip（本机未迁移/
//       CI 无全局状态——不把「来源不完备」当红/绿，硬规则 5）。
//   (c) NEGATIVE CONTROLS（四判据能取假）：
//       (a) 注册表 id ≠ CronList id ⇒ VIOLATED (exit 1)；
//       (b) 注册表 sha256 ≠ 实际 prompt（正本一字符漂移）⇒ VIOLATED (exit 1)；
//       (c) CronList 非恰一条（0 条 / 2 条）⇒ VIOLATED (exit 1)；
//       (d) 剩余寿命 < 24h ⇒ 报 CRITICAL 且 exit 1（判据5 触发）。
//   (d) NOT-EVALUATED（硬规则 3b：无法评估 ≠ 通过）：
//       (1) 未提供 --cron-list ⇒ exit 2；
//       (2) 内层正本缺失（--root 指向无 AC80 段的目录）⇒ exit 2（①-③ 全真但 ④ 无法评估）。
//   (e) AC1/AC2/AC5（gap-cron-registry-global-path-migration）：
//       - 全局 per-layer 路径：slug 分片、registryBaseFor/registryFileFor 路径、--record 写全局文件 + 审计线；
//       - AC2：worktree 路径经 canonicalRepoRoot 归一化解析到与主检出同一基目录 ⇒ 读当前真值；
//       - --record：写收据 + 追加 audit jsonl，随后 --verify 全真（收据可被判据④核实）。
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
  repoSlug,
  canonicalRepoRoot,
  registryBaseFor,
  registryFileFor,
  auditFileFor,
  parseRegistryText,
  serializeRegistryText,
  writeRegistryRecord,
  appendAuditLine,
  recordLayer,
  EXIT_OK,
  EXIT_VIOLATED,
  EXIT_NOT_EVALUATED,
  SEVEN_DAYS_MS,
  CRITICAL_REMAINING_MS,
} from "../scripts/outer-cron-registry.ts";
import { INNER_ANCHOR_BEGIN_MARK, INNER_ANCHOR_END_MARK, extractCanonical } from "../scripts/outer-anchor-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// 本项目主检出（AC2 对照；本 worktree 是该仓库的 fork）。经 canonicalRepoRoot 动态解析——
// 主检出 = worktree 的 --git-common-dir 的父目录（非机器字面量）。
const MAIN_ROOT = canonicalRepoRoot(REPO_ROOT);
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "outer-cron-registry.ts");

// ── 真实数据（判据4 的 canonical 输入）──────────────────────────────────────────────────────────────

// 内层 CronCreate（job ff96ad7e）prompt 原文 —— AC80 任务体给定的权威字符串（与
// outer-anchor-check.test.mjs 的 INNER_PROMPT 逐字一致）。**字面原样，勿改字符。**
const INNER_PROMPT =
  "[inner-tick] 执行内层 tick。不要依赖上下文记忆——本 prompt 只是指针，内容现读：(1) 读 orchestration/fast-mode-tick-core.md 拿本轮步骤（执行核；理由/实测/代价在 $REPO_ROOT/docs/analysis/fast-mode-loop-tick.md，仅需「为什么」时按 src:N 查，不要每轮全读）；(2) `tail -10 .quay/inner-tick-log.jsonl` 拿上一轮状态（只 tail，全读不可行）；(3) 读 orchestration/manager-phase-goal.md 拿当前阶段目标与 AC（当前阶段在文件后段，按节标题定位，勿全读）。执行完必须向 .quay/inner-tick-log.jsonl 追加一行。唤醒锚核实（AC81）：每轮先核实——CronList 恰一条 + 其 id 等于注册表记录 + --verify 报 registry-verified；三条全真则不动，任一为假才清扫重建，绝不靠记住的 ID。";

// 外层 CronCreate（job 4e88cb1b → a2360e1d）prompt 原文 —— orchestration/outer-tick-prompt.txt 内容去
// 尾部换行（develop commit 72b99cda）。**字面原样，勿改字符。**
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

/** 读真实全局注册表（AC2——任何 worktree 读当前真值）。缺失 ⇒ null（CI/未迁移环境 skip REAL 测试）。 */
function realRegistry() {
  return loadRegistry(REPO_ROOT);
}

/** 确定性 fixture 收据（不依赖真实注册表——负控制可机器无关地取假）。sha256 与真实正本一致。 */
const DEFAULT_FIXTURE = {
  inner: {
    cronId: "09fabf33",
    cronExpr: "7,27,47 * * * *",
    promptSha256: sha256Hex(INNER_PROMPT),
    promptBytes: Buffer.byteLength(INNER_PROMPT, "utf8"),
    createdAt: "2026-08-14T15:17:16Z",
    verifiedAt: "2026-08-14T16:00:00Z",
  },
  outer: {
    cronId: "a2360e1d",
    cronExpr: "*/20 * * * *",
    promptSha256: sha256Hex(OUTER_PROMPT),
    promptBytes: Buffer.byteLength(OUTER_PROMPT, "utf8"),
    createdAt: "2026-08-14T15:21:19Z",
    verifiedAt: "2026-08-14T16:00:00Z",
  },
};

/** 把一个 {layer → RegistryRecord} 映射写成 tmp fixture 基目录（含 <layer>/loop-registry.txt）。 */
function writeFixtureBase(layers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac81-global-"));
  for (const [layer, rec] of Object.entries(layers)) {
    if (!rec) continue;
    const p = path.join(dir, layer, "loop-registry.txt");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, serializeRegistryText(rec), "utf8");
  }
  return dir;
}

/** 构造 fixture 注册表基目录：以 DEFAULT_FIXTURE 为基础，按层覆盖字段（负控制/取假测试用）。 */
function makeFixtureBase(overrides = {}) {
  const layers = {
    inner: { ...DEFAULT_FIXTURE.inner },
    outer: { ...DEFAULT_FIXTURE.outer },
  };
  for (const [layer, patch] of Object.entries(overrides)) {
    layers[layer] = { ...(layers[layer] ?? {}), ...patch };
  }
  return writeFixtureBase(layers);
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

// ── 全局 per-layer 路径（gap-cron-registry-global-path-migration AC1/AC2）──────────────────────────

test("repoSlug: 绝对路径的 '/' 全替换成 '-'（抄 session-liveness.sh:1162 分片算法）", () => {
  assert.equal(repoSlug("/home/yale/work/quay"), "-home-yale-work-quay");
  assert.equal(repoSlug("/"), "-");
  assert.equal(repoSlug("quay"), "quay");
});

test("canonicalRepoRoot: worktree 经 --git-common-dir 归一化到主检出根（AC2 非 fork 快照的前提）", () => {
  // REPO_ROOT 是本仓库的一个 git worktree（fork 早于主检出）；主检出由 --git-common-dir 解析。
  assert.notEqual(REPO_ROOT, MAIN_ROOT, "本测试在 worktree 里跑（REPO_ROOT ≠ 主检出）");
  assert.equal(canonicalRepoRoot(REPO_ROOT), MAIN_ROOT);
  assert.equal(canonicalRepoRoot(MAIN_ROOT), MAIN_ROOT);
  // 非 git tmp 目录 ⇒ 回退 path.resolve(root)（测试接缝/ fixture）。
  const { dir } = tmpFile("x");
  try {
    assert.equal(canonicalRepoRoot(dir), path.resolve(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("registryBaseFor / registryFileFor: 全局 per-layer 路径 + slug 分片 + QUAY_GLOBAL_DIR 覆盖", () => {
  const env = "/tmp/fake-global";
  assert.equal(registryBaseFor(MAIN_ROOT, env), path.join(env, "-home-yale-work-quay"));
  assert.equal(registryFileFor(MAIN_ROOT, "inner", path.join(env, "-home-yale-work-quay")), path.join(env, "-home-yale-work-quay", "inner", "loop-registry.txt"));
  assert.equal(auditFileFor(MAIN_ROOT, path.join(env, "-home-yale-work-quay")), path.join(env, "-home-yale-work-quay", "cron-registry-events.jsonl"));
});

test("parseRegistryText / serializeRegistryText: key=value 往返（loop-registry.txt 形态）", () => {
  const rec = {
    cronId: "abc123",
    cronExpr: "7,27,47 * * * *",
    promptSha256: "deadbeef",
    promptBytes: 828,
    createdAt: "2026-08-17T00:00:00Z",
    verifiedAt: "2026-08-17T01:00:00Z",
  };
  const text = serializeRegistryText(rec);
  assert.equal(text, "cronId=abc123\ncronExpr=7,27,47 * * * *\npromptSha256=deadbeef\npromptBytes=828\ncreatedAt=2026-08-17T00:00:00Z\nverifiedAt=2026-08-17T01:00:00Z\n");
  assert.deepEqual(parseRegistryText(text), rec);
  assert.equal(parseRegistryText("no-cron-id\n"), null);
  assert.equal(parseRegistryText(""), null);
});

test("loadRegistry: 全局 per-layer 注册表（AC2——任何 worktree 读当前真值，非 fork 快照）", (t) => {
  const reg = loadRegistry(REPO_ROOT);
  if (!reg) { t.skip("全局注册表缺失（本机未迁移 / CI 无全局状态）——来源不完备不判存在（硬规则 5）"); return; }
  assert.ok(reg.layers.inner, "inner 层存在");
  assert.ok(reg.layers.outer, "outer 层存在");
  // 与当前正本逐字节同权威（判据④ 对账主判据）
  assert.equal(reg.layers.inner.promptSha256, sha256Hex(INNER_PROMPT));
  assert.equal(reg.layers.outer.promptSha256, sha256Hex(OUTER_PROMPT));
});

test("AC2: worktree 路径与主检出解析到同一全局注册表（非 fork 快照、同一 cronId）", (t) => {
  const mainReg = loadRegistry(MAIN_ROOT);
  if (!mainReg) { t.skip("全局注册表缺失"); return; }
  const worktreeReg = loadRegistry(REPO_ROOT); // REPO_ROOT 是 fork 早的 worktree
  assert.ok(worktreeReg, "worktree 读得到注册表（非 fork 快照死值）");
  assert.equal(worktreeReg.layers.inner.cronId, mainReg.layers.inner.cronId, "inner cronId 与主检出一致");
  assert.equal(worktreeReg.layers.outer.cronId, mainReg.layers.outer.cronId, "outer cronId 与主检出一致");
  assert.equal(registryBaseFor(REPO_ROOT), registryBaseFor(MAIN_ROOT), "slug 归一化：同一基目录");
});

test("REAL cross-consistency: live doc AC80 canonical == 全局注册表 inner promptSha256（两检查器同权威）", (t) => {
  const reg = loadRegistry(REPO_ROOT);
  if (!reg) { t.skip("全局注册表缺失"); return; }
  const doc = path.join(REPO_ROOT, "plugin", "loop", "fast-mode-loop-tick.md");
  const canon = extractCanonical(fs.readFileSync(doc, "utf8"), "inner");
  assert.ok(canon !== null, "live doc 必须含 AC80-INNER-ANCHOR 段");
  assert.equal(sha256Hex(canon), reg.layers.inner.promptSha256);
  assert.equal(Buffer.byteLength(canon, "utf8"), reg.layers.inner.promptBytes);
});

// ── --record / 审计线（gap-cron-registry-global-path-migration AC1/AC5）────────────────────────────

test("writeRegistryRecord / appendAuditLine: 写全局 per-layer 文件 + append-only 审计 jsonl", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ac81-record-"));
  try {
    const rec = { cronId: "x1", cronExpr: "*/20 * * * *", promptSha256: "aa", promptBytes: 5, createdAt: "2026-08-17T00:00:00Z", verifiedAt: "2026-08-17T00:00:00Z" };
    const p = writeRegistryRecord(REPO_ROOT, "outer", rec, base);
    assert.equal(p, path.join(base, "outer", "loop-registry.txt"));
    assert.deepEqual(parseRegistryText(fs.readFileSync(p, "utf8")), rec);
    const audit = appendAuditLine(REPO_ROOT, "outer", { event: "anchor-rebuild", cronId: "x1" }, base);
    assert.equal(audit, path.join(base, "cron-registry-events.jsonl"));
    appendAuditLine(REPO_ROOT, "outer", { event: "anchor-rebuild", cronId: "x2" }, base);
    const lines = fs.readFileSync(audit, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2, "append-only：两条都在");
    assert.equal(lines[0].cronId, "x1");
    assert.equal(lines[1].cronId, "x2");
    assert.ok(lines[0].ts && lines[0].layer === "outer", "审计行带 ts + layer");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("recordLayer: 锚重建收据写入 + 审计线；正本缺失拒绝写入", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ac81-recordLayer-"));
  try {
    const r = recordLayer(REPO_ROOT, "inner", { cronId: "n3w", cronExpr: "7,27,47 * * * *", canonicalPrompt: INNER_PROMPT, nowMs: Date.parse("2026-08-17T12:00:00Z") }, base);
    assert.equal(r.ok, true, r.reason);
    assert.ok(r.file.endsWith(path.join("inner", "loop-registry.txt")));
    const reg = loadRegistry(REPO_ROOT, base);
    assert.equal(reg.layers.inner.cronId, "n3w");
    assert.equal(reg.layers.inner.promptSha256, sha256Hex(INNER_PROMPT));
    assert.equal(reg.layers.inner.createdAt, "2026-08-17T12:00:00.000Z");
    // 审计线有一条 anchor-rebuild
    const audit = fs.readFileSync(r.auditFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(audit[0].event, "anchor-rebuild");
    assert.equal(audit[0].cronId, "n3w");
    // 正本缺失 ⇒ 拒绝（收据必须可被判据④核实）
    const bad = recordLayer(REPO_ROOT, "inner", { cronId: "x", cronExpr: "7,27,47 * * * *", canonicalPrompt: null }, base);
    assert.equal(bad.ok, false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("CLI --record: 写全局收据 + 审计线，随后 --verify 全真（收据可被判据④核实）", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ac81-clirecord-"));
  try {
    const r = runReg(["--record", "--layer", "outer", "--cron-id", "r1c2d3", "--cron-expr", "*/20 * * * *", "--registry-base", base, "--json"]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}${r.stderr}`);
    assert.match(JSON.parse(r.stdout).reason, /recorded outer cronId=r1c2d3/);
    // 写出的收据 sha256 = 真实 outer 正本（判据④ 可核实）
    const reg = loadRegistry(REPO_ROOT, base);
    assert.equal(reg.layers.outer.promptSha256, sha256Hex(OUTER_PROMPT));
    // --verify 对该收据全真
    const v = runReg(["--verify", "--layer", "outer", "--cron-list", JSON.stringify([{ id: "r1c2d3", schedule: "*/20 * * * *" }]), "--registry-base", base]);
    assert.equal(v.status, EXIT_OK, `stdout: ${v.stdout}${v.stderr}`);
    assert.match(v.stdout, /PASS/);
    // 审计线存在
    assert.ok(fs.existsSync(path.join(base, "cron-registry-events.jsonl")));
    // --record 缺 cron-expr ⇒ 拒绝 (exit 2)
    const bad = runReg(["--record", "--layer", "outer", "--cron-id", "x", "--registry-base", base]);
    assert.equal(bad.status, 2);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── REAL-DATA（真实锚数据走真实比对路径，硬规则 4 推论三）───────────────────────────────────────────

test("REAL inner anchor: 四判据全真 + 剩余寿命正常 ⇒ PASS (exit 0)", (t) => {
  const real = realRegistry();
  if (!real) { t.skip("全局注册表缺失"); return; }
  const base = makeFixtureBase();
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: real.layers.inner.cronId, schedule: real.layers.inner.cronExpr }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
    assert.match(r.stdout, /判据5 剩余寿命/);
    const res = checkVerify({
      layer: "inner",
      registry: loadRegistry(REPO_ROOT, base),
      cronListRaw: JSON.stringify([{ id: real.layers.inner.cronId }]),
      canonicalPrompt: INNER_PROMPT,
      nowMs: Date.parse("2026-08-17T12:00:00Z"),
    });
    assert.equal(res.remaining.critical, false);
    assert.ok(res.remaining.remainingHours > 24, `remainingHours=${res.remaining.remainingHours}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("REAL outer anchor: 四判据全真 ⇒ PASS (exit 0)", (t) => {
  const real = realRegistry();
  if (!real) { t.skip("全局注册表缺失"); return; }
  const base = makeFixtureBase({ outer: { cronId: real.layers.outer.cronId } });
  const { dir, p } = tmpFile("txt");
  try {
    fs.writeFileSync(p, OUTER_PROMPT + "\n"); // 正本文件带尾部换行；extractCanonical 剥一个
    const r = runReg([
      "--verify", "--layer", "outer",
      "--cron-list", JSON.stringify([{ id: real.layers.outer.cronId, schedule: real.layers.outer.cronExpr }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── NEGATIVE CONTROLS（四判据能取假）─────────────────────────────────────────────────────────────────

test("(a) 判据② 能取假: 注册表 id ≠ CronList id ⇒ VIOLATED (exit 1)", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase();
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "DEADBEEF" }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /id.*≠ 注册表|≠ 注册表/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(b) 判据④ 能取假: 正本一字符漂移 ⇒ 注册表 sha256 ≠ 正本 ⇒ VIOLATED (exit 1)", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase();
  const { dir, p } = tmpFile("md");
  try {
    const drifted = INNER_PROMPT.slice(0, -1) + "。x"; // 一字符漂移
    writeInnerSection(p, drifted);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: real ? real.layers.inner.cronId : "x" }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /判据④|sha256/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(c) 判据① 能取假: CronList 0 条 ⇒ VIOLATED (exit 1)", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase();
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", "[]",
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /判据①|CronList 条数=0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(c) 判据① 能取假: CronList 2 条 ⇒ VIOLATED (exit 1)", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase();
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }, { id: "AAAA" }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /CronList 条数=2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(d) 判据5 能取假: 剩余寿命 < 24h ⇒ CRITICAL 且 VIOLATED (exit 1)", (t) => {
  const sixAndHalfDaysAgo = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000).toISOString();
  const base = makeFixtureBase({ inner: { createdAt: sixAndHalfDaysAgo, verifiedAt: sixAndHalfDaysAgo } });
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /CRITICAL|判据5/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("判据③ 能取假: verifiedAt 过期（>stale）⇒ registry-not-verified ⇒ VIOLATED (exit 1)", (t) => {
  const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 天前 > 7 天窗口
  const base = makeFixtureBase({ inner: { verifiedAt: stale } });
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /registry-not-verified/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cron-expr-mismatch: 真漂移（`*/20`={0,20,40} vs 注册表 inner `7,27,47`）⇒ 仍 VIOLATED (exit 1)", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase();
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: real ? real.layers.inner.cronId : "x", schedule: "*/20 * * * *" }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /cron-expr-mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cron-expr-mismatch: 语义等价 `*/20` ≡ 注册表 outer `0,20,40` ⇒ 不再 VIOLATED (PASS, 无 cron-expr-mismatch)", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase({ outer: { cronId: real ? real.layers.outer.cronId : "x" } });
  const { dir, p } = tmpFile("txt");
  try {
    fs.writeFileSync(p, OUTER_PROMPT + "\n"); // 正本文件带尾部换行；extractCanonical 剥一个
    const r = runReg([
      "--verify", "--layer", "outer",
      "--cron-list", JSON.stringify([{ id: real ? real.layers.outer.cronId : "x", schedule: "*/20 * * * *" }]),
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
    assert.doesNotMatch(r.stdout, /cron-expr-mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── NOT-EVALUATED（硬规则 3b：无法评估 ≠ 通过）──────────────────────────────────────────────────────

test("NOT-EVALUATED: 未提供 --cron-list ⇒ exit 2，非通过", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase();
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--canonical-file", p,
      "--registry-base", base,
    ]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /NOT-EVALUATED/);
    assert.match(r.stdout, /cron-list/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("worktree 上下文默认路径正本查找（round172 回归）：AC80 段在默认 plugin/loop/fast-mode-loop-tick.md ⇒ ④ evaluated（非 NOT-EVALUATED）", (t) => {
  // 默认路径（无 --canonical-file，root=cwd=本 worktree）：2eedf16c 已落地
  // plugin/loop/fast-mode-loop-tick.md 的 AC80-INNER-ANCHOR 段 ⇒ 正本可解析，判据④ 被评估。
  const real = realRegistry();
  if (!real) { t.skip("全局注册表缺失"); return; }
  const base = makeFixtureBase();
  try {
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: real.layers.inner.cronId }]),
      "--registry-base", base,
    ]);
    assert.notEqual(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /判据 anchorMatches/, `stdout: ${r.stdout}`);
    assert.doesNotMatch(r.stdout, /正本缺失/, `stdout: ${r.stdout}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("NOT-EVALUATED: 内层正本缺失（--root 指向无 AC80 段的目录）⇒ exit 2（①-③ 真但 ④ 无法评估）", (t) => {
  const real = realRegistry();
  const base = makeFixtureBase();
  const { dir } = tmpFile("md");
  try {
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: real ? real.layers.inner.cronId : "x" }]),
      "--registry-base", base,
      "--root", dir,
    ]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /NOT-EVALUATED/);
    assert.match(r.stdout, /正本缺失/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("NOT-EVALUATED: 注册表缺失/层缺失 ⇒ exit 2", (t) => {
  const emptyBase = writeFixtureBase({});
  const { dir, p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runReg([
      "--verify", "--layer", "inner",
      "--cron-list", JSON.stringify([{ id: "ff96ad7e" }]),
      "--canonical-file", p,
      "--registry-base", emptyBase,
    ]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /NOT-EVALUATED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(emptyBase, { recursive: true, force: true });
  }
});

// ── checkVerify 纯函数直测（nowMs 可控）─────────────────────────────────────────────────────────────

test("checkVerify: 四判据全真 + 剩余正常 ⇒ ok:true (exit 0)", (t) => {
  const real = realRegistry();
  if (!real) { t.skip("全局注册表缺失"); return; }
  const nowMs = Date.parse("2026-08-18T05:00:00Z");
  const res = checkVerify({
    layer: "inner",
    registry: real,
    cronListRaw: JSON.stringify([{ id: real.layers.inner.cronId }]),
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

test("checkVerify: id 不匹配 ⇒ ok:false (exit 1)，findings 含判据②", (t) => {
  const real = realRegistry();
  if (!real) { t.skip("全局注册表缺失"); return; }
  const res = checkVerify({
    layer: "inner",
    registry: real,
    cronListRaw: JSON.stringify([{ id: "WRONG" }]),
    canonicalPrompt: INNER_PROMPT,
    nowMs: Date.parse("2026-08-14T16:00:00Z"),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, EXIT_VIOLATED);
  assert.ok(res.findings.some((f) => f.includes("判据②")));
});
