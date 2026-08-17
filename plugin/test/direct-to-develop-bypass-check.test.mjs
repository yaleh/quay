// @test-group engine
// direct-to-develop-bypass-check.test.mjs — 直接提交 develop 绕过 fan-in 机件的检测器
// (tasks/gap-direct-to-develop-bypasses-fan-in-gates, 11b/C17 写所有权/越权直改面),
// plugin/scripts/direct-to-develop-bypass-check.ts.
//
// 能取假（AC3）：真样本（7e64a86b + 核心子集 4 条 7d1d5d2e/b389a758/18e7a3be/77174684）必须报红；
// 设计内样本（.gitignore / manager 独占 / 热修 fan-in 机件本身）必须绿。回放走两条路：
// AC2 粒度：7e64a86b（plugin/skills/init/SKILL.md）在排除集加 plugin/skills/manager/** 后仍红；
// 635ec831（plugin/skills/manager/SKILL.md）转绿——粒度到 manager/**，不掩 init/ 真红。
//   ① 真实 git 读（REPO_ROOT 的 develop 历史含这些样本——它们是 develop 的祖先），喂纯判定；
//   ② 硬编码 fixture（file 清单 + 时刻，取自真提交）——在无该历史的 hermetic clone 里也跑。
// 另覆盖：锁时间窗豁免、设计内/外分离（AC2）、NOT-EVALUATED（reflog 无 / 锁事件不成对，硬规则3b）、
// CLI 集成（temp repo：直接提交代码面 ⇒ RED；直接提交 .gitignore ⇒ GREEN；fan-in ff 不误报）。
// AC65 授权直修 carve-out（gap-ac65-direct-fix-vs-bypass-detector-conflict）：02b2b2fc（AC65 授权直修，
// 消息带验证证据）不再被误标；7e64a86b（真直投）仍红——按 sha + 证据豁免，非 plugin/scripts/* 文件名豁免
// （fail-closed：sha 入表但消息无 AC65 标记 ⇒ 仍红）。
// Ruled-historical 豁免（gap-direct-to-develop-ruled-historical-cddc55e2，manager 2026-08-15 裁定 one-off）：
// cddc55e2（inner 紧急回退自己的破坏）→ ruledHistorical=true（独立分类，非 bypass、非 ac65Authorized——
// 两类输出可区分 AC65-AUTHORIZED vs RULED-HISTORICAL）；真直投（无豁免无 AC65）仍红；⛔ 判据3
// （声明∧无验证⇒红）不松动。豁免表有界（只覆盖 cddc55e2），非入表 sha 仍红（能取假）。
//
// Run:
//   scripts/test.sh plugin/test/direct-to-develop-bypass-check.test.mjs
//   node --test plugin/test/direct-to-develop-bypass-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  isDesignInternalPath,
  classifyCommit,
  checkDirectCommits,
  DESIGN_INTERNAL_RE,
  AC65_AUTHORIZED_DIRECT_FIXES,
  AC65_DECLARATION_RE,
  AC65_VERIFICATION_RE,
  AC65_LEGACY_RE,
  findAc65Entry,
  commitHasAc65Declaration,
  commitHasAc65Verification,
  extractAc65Evidence,
  RULED_HISTORICAL_COMMITS,
  findRuledHistoricalEntry,
} from "../scripts/direct-to-develop-bypass-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "direct-to-develop-bypass-check.ts");

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

function gitCmd(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `d2d-${prefix ?? ""}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--json", ...args], { encoding: "utf8" });
}

function jsonOut(r) {
  return JSON.parse(r.stdout);
}

/** 从 REPO_ROOT 的真实 git 读一条 commit 的 (files, epoch, message)——回放真样本的「actual git」读面。 */
function realCommitData(sha) {
  const diff = gitCmd(REPO_ROOT, "diff", "--name-only", `${sha}^`, sha);
  if (diff.status !== 0) return null;
  const files = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const epoch = gitCmd(REPO_ROOT, "log", "-1", "--format=%ct", sha).stdout.trim();
  if (!/^\d+$/.test(epoch)) return null;
  const subject = gitCmd(REPO_ROOT, "log", "-1", "--format=%s", sha).stdout.trim();
  const message = gitCmd(REPO_ROOT, "log", "-1", "--format=%B", sha).stdout.trim();
  return { sha, files, epoch: Number(epoch), subject, message };
}

// ── 真样本 fixture（取自真提交——file 清单与 committer epoch 与 develop 历史一致）──────────────

/** AC3 真样本：5 条必须报红。*/
const REAL_BYPASS_SAMPLES = [
  { sha: "7e64a86b", files: ["plugin/skills/init/SKILL.md"], subject: "init/SKILL.md: 声明 reference-doc（AC80-INNER-ANCHOR）" },
  { sha: "7d1d5d2e", files: ["plugin/test/ready-pool-check.test.mjs"], subject: "test: AC5 负控制 self-touch 样本" },
  { sha: "b389a758", files: ["plugin/scripts/loop-shipping-exclusion-data.mjs"], subject: "mjs: AC1b 排除表加 manager-phase-goal-archive.md" },
  { sha: "18e7a3be", files: ["plugin/scripts/loop-shipping-exclusion-data.mjs"], subject: "mjs: manager-phase-goal 条目加 retainedNote" },
  { sha: "77174684", files: ["plugin/test/manager-tick-core.test.mjs"], subject: "test: AC3 pgrep-idle-watch 谓词加位置感知" },
];

/** 设计内样本：.gitignore / manager 独占 / 热修 fan-in 机件本身，必须绿（AC2）。*/
const DESIGN_INTERNAL_SAMPLES = [
  { sha: "gitignore-f", files: [".gitignore"], subject: "chore: gitignore" },
  { sha: "manager-tick-core", files: [".claude/workflows/manager-tick-core.js"], subject: "manager: tick-core 判准修正" },
  { sha: "orchestration-doc", files: ["orchestration/manager-tick-core.md"], subject: "orchestration: C17 枚举补全" },
  { sha: "claude-md", files: ["CLAUDE.md"], subject: "CLAUDE.md: 硬规则 12 补 12b" },
  { sha: "fan-in-hotfix", files: [".claude/workflows/fan-in-execute.js"], subject: "workflows: fix fan-in-execute meta" },
  { sha: "manager-skill", files: ["plugin/skills/manager/SKILL.md"], subject: "manager: SKILL.md 索引（635ec831 类）" },
  { sha: "task-file", files: ["tasks/gap-xxx.md"], subject: "tasks: 立案" },
];

/** AC65 授权直修样本（02b2b2fc——真提交，验证证据在提交消息中）。必须【不再误标】（AC2 能取假）。 */
const AC65_AUTHORIZED_SAMPLE = {
  sha: "02b2b2fc",
  files: ["plugin/scripts/manager-tick-readings.ts", "plugin/test/manager-tick-readings.test.mjs"],
  subject: "manager-tick-readings: A0 outer.ticklog 截断缺陷修复（manager ③ 立案，发生率 3）——full:true 完整行，默认 200 截断向后兼容",
  message:
    "manager-tick-readings: A0 outer.ticklog 截断缺陷修复（manager ③ 立案，发生率 3）——full:true 完整行，默认 200 截断向后兼容\n\n" +
    "缺陷：latestTickLog 默认 maxLen=200 把 outer tick-log 行截到 A11 前 ⇒ 判准⑥′ 无法判 outer tick 完整性。修法：A0 feed 走 full:true 完整行。" +
    "AC65 一条命令验证：A0 outer.ticklog quay 现含 A11+ 内容（full length 676 > 200）。新增测试（full 完整行 + 默认截断向后兼容），24/24 绿。",
};

/** Ruled-historical 豁免样本（cddc55e2——manager 2026-08-15 裁定 one-off）。必须分类为 ruledHistorical
 *  （独立分类，非 bypass、非 ac65Authorized）；非入表真直投仍红。 */
const RULED_HISTORICAL_SAMPLE = {
  sha: "cddc55e2",
  files: ["plugin/loop/fast-mode-tick-core.md", "plugin/skills/init/SKILL.md"],
  subject: "inner: 回退 drift 同步（232e4171 破坏 quay-init referenced⊆landed）+ SKILL.md:71 改正本/副本关系声明（option ②）",
  message: "inner: 回退 drift 同步（232e4171 破坏 quay-init referenced⊆landed）+ SKILL.md:71 改正本/副本关系声明（option ②）",
};

// ── PURE: isDesignInternalPath — 设计内排除集（AC2）──────────────────────────────────────────────

test("PURE isDesignInternalPath — 记账/转向/遥测面 + manager 独占 + 基础设施 + 热修机件 ⇒ 设计内", () => {
  const designInternal = [
    "tasks/gap-x.md",
    "docs/analysis/foo.md",
    "orchestration/manager-tick-core.md",
    "orchestration/archive/AC58-retired-clauses.md",
    "adr/ADR-010-scheduled-milestone-e2e.md",
    ".quay/full-suite-state.json",
    "plugin/loop/fast-mode-loop-tick.md",
    "measurements/m.json",
    "milestones/m1.json",
    ".claude/workflows/manager-tick-core.js",
    ".claude/workflows/fan-in-execute.js",
    ".claude/skills/x/SKILL.md",
    "plugin/skills/manager/SKILL.md",
    "plugin/skills/manager/sub/deep.md",
    "CLAUDE.md",
    ".gitignore",
    ".gitattributes",
    ".npmrc",
    ".github/workflows/ci.yml",
    "plugin/scripts/fan-in-ff-merge.sh",
    "plugin/scripts/fan-in-ff-protocol-check.ts",
    "plugin/test/fan-in-ff-protocol-check.test.mjs",
    "plugin/scripts/outer-cron-registry.json",
  ];
  for (const p of designInternal) assert.equal(isDesignInternalPath(p), true, `设计内应排除: ${p}`);
});

test("PURE isDesignInternalPath — 代码/断言面（产品交付）不是设计内 ⇒ 报红候选", () => {
  const codeSurface = [
    "plugin/scripts/loop-shipping-exclusion-data.mjs",
    "plugin/test/ready-pool-check.test.mjs",
    "plugin/test/manager-tick-core.test.mjs",
    "plugin/skills/init/SKILL.md",
    "plugin/skills/init/sub/x.md",
    "plugin/skills/manager-tool/foo.md",
    "plugin/scripts/ready-pool-check.ts",
    "plugin/scripts/outer-cron-registry.ts",
    "packages/quay/src/mcp-server.ts",
    "scripts/test.sh",
    "README.md",
  ];
  for (const p of codeSurface) assert.equal(isDesignInternalPath(p), false, `代码面不应排除: ${p}`);
  // 反向：`fan-in-` 前缀只在 plugin/scripts|test 顶层豁免——不要误伤 loop-shipping 等。
  assert.equal(isDesignInternalPath("plugin/scripts/loop-shipping-exclusion-data.mjs"), false);
  assert.equal(isDesignInternalPath("plugin/test/fan-in-ff-merge.test.mjs"), true, "fan-in 机件测试豁免");
  // ⛔ AC3 粒度：只豁免 json 收据，不豁免 .ts verifier 机件——outer-cron-registry.ts 直改必须仍红。
  assert.equal(isDesignInternalPath("plugin/scripts/outer-cron-registry.ts"), false, "verifier 机件 .ts 不是设计内（仍红）");
  // ⛔ AC2 粒度：manager/ 前缀豁免，但必须精确到 manager/ 子树——`manager-tool/` 是另一个目录，不得误豁免。
  assert.equal(isDesignInternalPath("plugin/skills/manager-tool/foo.md"), false, "manager-tool/ 不是 manager/ 子树");
});

test("PURE isDesignInternalPath — 非 ASCII 文件名（git quoted-path 形态）恢复排除（AC1/AC2）", () => {
  // 修复前（tasks/gap-direct-bypass-check-quoted-path-false-positive）：git diff --name-only 对含非 ASCII
  // 的路径输出 C-quoted 形态（`"docs/.../Quay\346\224\271\350\277\233\347\211\210WebUI.dc.html"`），
  // 前导引号使 `^docs/` 匹配失败 ⇒ design-internal 被误判为 code-surface（2fdb6e32 false-positive）。
  // 修复后 gitCommitFiles 用 `-c core.quotepath=false` 让谓词收到原始路径字节 ⇒ 非 ASCII docs/ 恢复豁免。
  const designInternalNonAscii = [
    "docs/design/quay-webui-improved-2026-08-16/Quay改进版WebUI.dc.html",
    "docs/设计/方案.md",
    "tasks/缺陷修复任务.md",
  ];
  for (const p of designInternalNonAscii) assert.equal(isDesignInternalPath(p), true, `非 ASCII 设计内应排除: ${p}`);
  const codeSurfaceNonAscii = [
    "plugin/test/测试.test.mjs",
    "plugin/scripts/调度器.ts",
    "packages/quay/src/中文模块.ts",
  ];
  for (const p of codeSurfaceNonAscii) assert.equal(isDesignInternalPath(p), false, `非 ASCII 代码面不应排除: ${p}`);
});

// ── PURE: classifyCommit — 直接提交的分类（AC1 三条件）───────────────────────────────────────────

test("PURE classifyCommit — 代码面 ∧ 不在锁窗 ⇒ bypass；设计内 ⇒ 非 bypass；在锁窗 ⇒ 非 bypass", () => {
  const holds = [{ start: 100, end: 101 }];
  const bypass = classifyCommit({ sha: "a", files: ["plugin/test/x.mjs"], epoch: 200, subject: "s" }, holds);
  assert.equal(bypass.bypass, true);
  assert.equal(bypass.designInternal, false);
  assert.deepEqual(bypass.codeSurfaceFiles, ["plugin/test/x.mjs"]);

  const designInternal = classifyCommit({ sha: "b", files: [".gitignore"], epoch: 200, subject: "s" }, holds);
  assert.equal(designInternal.bypass, false);
  assert.equal(designInternal.designInternal, true);

  const inLock = classifyCommit({ sha: "c", files: ["plugin/test/x.mjs"], epoch: 100, subject: "s" }, holds);
  assert.equal(inLock.bypass, false, "落在锁窗内 ⇒ 豁免（保守口径）");
  assert.equal(inLock.inLockWindow, true);

  // 混合：同一条提交既改代码面又改设计内文件 ⇒ 代码面胜出（bypass）。
  const mixed = classifyCommit({ sha: "d", files: ["plugin/test/x.mjs", "tasks/gap-y.md"], epoch: 200, subject: "s" }, holds);
  assert.equal(mixed.bypass, true);
  assert.equal(mixed.designInternal, false);
});

// ── PURE: checkDirectCommits — 聚合 + denominator 计数（AC3 谓词口径）──────────────────────────

test("PURE checkDirectCommits — 真样本 5 条全红；设计内样本全绿；denominator 计数正确", () => {
  const samples = REAL_BYPASS_SAMPLES.map((s) => ({ ...s, epoch: 1_700_000_000, action: "commit" }));
  const v = checkDirectCommits(samples, []);
  assert.equal(v.violations.length, 5);
  assert.equal(v.codeSurfaceCommits, 5);
  assert.equal(v.designInternalCommits, 0);
  assert.equal(v.totalCommits, 5);
  assert.equal(v.violations.every((x) => x.bypass), true);

  const internal = DESIGN_INTERNAL_SAMPLES.map((s) => ({ ...s, epoch: 1_700_000_000, action: "commit" }));
  const v2 = checkDirectCommits(internal, []);
  assert.equal(v2.violations.length, 0, "设计内样本不得报红");
  assert.equal(v2.codeSurfaceCommits, 0);
  assert.equal(v2.designInternalCommits, 7);

  // 混合一真一设计内 ⇒ 只红真样本。
  const mixed = checkDirectCommits(
    [
      { sha: "s1", files: ["plugin/test/x.mjs"], epoch: 1, subject: "x", action: "commit" },
      { sha: "s2", files: [".gitignore"], epoch: 1, subject: "y", action: "commit" },
    ],
    [],
  );
  assert.equal(mixed.violations.length, 1);
  assert.equal(mixed.violations[0].sha, "s1");
  assert.equal(mixed.codeSurfaceCommits, 1);
  assert.equal(mixed.designInternalCommits, 1);
});

// ── AC3 回放·真实 git：REPO_ROOT 的 develop 历史含这些样本（它们是祖先）───────────────────────

const REAL_SHAS = ["7e64a86b", "7d1d5d2e", "b389a758", "18e7a3be", "77174684", "5e54bb37", "635ec831"];

test("AC3 回放·真实 git — develop 历史中 5 条真样本读自 git 后必须红，5e54bb37（热修机件）必须绿", (t) => {
  const missing = REAL_SHAS.filter((sha) => realCommitData(sha) === null);
  if (missing.length > 0) {
    // hermetic clone 无该历史 ⇒ skip（不把「样本不可得」当红/绿——硬规则 5：来源不完备不判存在）。
    t.skip(`样本 sha 不在本 repo（${missing.join(",")}）——真实 git 回放跳过，fixture 回放仍覆盖`);
    return;
  }
  const bypass = REAL_BYPASS_SAMPLES.map((s) => realCommitData(s.sha)).map((d) => ({ ...d, action: "commit" }));
  const v = checkDirectCommits(bypass, []);
  assert.equal(v.violations.length, 5, `真样本必须红: ${JSON.stringify(v.violations.map((x) => x.sha))}`);
  assert.equal(v.violations.every((x) => x.bypass), true);
  // 设计内真样本：5e54bb37 是热修 fan-in 机件本身（.claude/workflows/fan-in-execute.js）。
  const hotfix = realCommitData("5e54bb37");
  const v2 = checkDirectCommits([{ ...hotfix, action: "commit" }], []);
  assert.equal(v2.violations.length, 0, "热修 fan-in 机件本身必须绿");
  assert.equal(v2.designInternalCommits, 1);
});

test("AC3 回放·真实 git — CLI --commits 对 5 条真样本 exit 1（RED），对设计内 exit 0", (t) => {
  const missing = REAL_SHAS.filter((sha) => realCommitData(sha) === null);
  if (missing.length > 0) {
    t.skip(`样本 sha 不在本 repo（${missing.join(",")}）——CLI 回放跳过`);
    return;
  }
  const r = runChecker(["--root", REPO_ROOT, "--commits", REAL_BYPASS_SAMPLES.map((s) => s.sha).join(",")]);
  assert.equal(r.status, 1, `真样本必须 RED(exit 1): ${r.stdout}${r.stderr}`);
  const out = jsonOut(r);
  assert.equal(out.evaluated, true);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "direct-commit-bypasses-fan-in");
  assert.equal(out.candidates.length, 5);

  const r2 = runChecker(["--root", REPO_ROOT, "--commits", "5e54bb37"]);
  assert.equal(r2.status, 0, `设计内（热修机件）必须 GREEN(exit 0): ${r2.stdout}${r2.stderr}`);
  assert.equal(jsonOut(r2).ok, true);
});

// ── AC2 粒度（⛔ 到 manager/**，不掩 init/ 真红）────────────────────────────────────────────────

test("AC2 粒度 · 真实 git — 7e64a86b（init/SKILL.md）仍红；635ec831（manager/SKILL.md）转绿", (t) => {
  const init = realCommitData("7e64a86b");
  const mgr = realCommitData("635ec831");
  if (!init || !mgr) {
    t.skip(`样本 sha 不在本 repo（${[!init && "7e64a86b", !mgr && "635ec831"].filter(Boolean).join(",")}）——真实 git 回放跳过，fixture 回放仍覆盖`);
    return;
  }
  const vi = checkDirectCommits([{ ...init, action: "commit" }], []);
  assert.equal(vi.violations.length, 1, `init/SKILL.md 直改必须仍红（AC2 粒度——不掩真红）: ${JSON.stringify(vi.classified)}`);
  assert.equal(vi.violations[0].bypass, true);
  const vm = checkDirectCommits([{ ...mgr, action: "commit" }], []);
  assert.equal(vm.violations.length, 0, `manager/SKILL.md 必须转绿（manager 独占 + 无 fan-in 路）: ${JSON.stringify(vm.classified)}`);
  assert.equal(vm.designInternalCommits, 1);
});

test("AC2 粒度 · CLI — 7e64a86b exit 1（RED）；635ec831 exit 0（GREEN）", (t) => {
  const init = realCommitData("7e64a86b");
  const mgr = realCommitData("635ec831");
  if (!init || !mgr) {
    t.skip("样本 sha 不在本 repo——CLI 回放跳过");
    return;
  }
  const rInit = runChecker(["--root", REPO_ROOT, "--commits", "7e64a86b"]);
  assert.equal(rInit.status, 1, `init/SKILL.md 必须 RED(exit 1): ${rInit.stdout}${rInit.stderr}`);
  const outInit = jsonOut(rInit);
  assert.equal(outInit.evaluated, true);
  assert.equal(outInit.ok, false);
  assert.equal(outInit.candidates[0].codeSurfaceFiles[0], "plugin/skills/init/SKILL.md");

  const rMgr = runChecker(["--root", REPO_ROOT, "--commits", "635ec831"]);
  assert.equal(rMgr.status, 0, `manager/SKILL.md 必须 GREEN(exit 0): ${rMgr.stdout}${rMgr.stderr}`);
  const outMgr = jsonOut(rMgr);
  assert.equal(outMgr.ok, true);
  assert.equal(outMgr.denominator.designInternalCommits, 1);
  assert.equal(outMgr.denominator.codeSurfaceCommits, 0);
});

// ── AC65 授权直修 carve-out（gap-ac65-direct-fix-vs-bypass-detector-conflict）─────────────────────
// 两谓词（替换 sha 表——硬规则4：手抄表是回显，不参与判定）：
//   ① 声明谓词 `/^AC65:/m`（outer 声明/范围标记）
//   ② 验证产物谓词 `/AC65-Verified:/m`（`AC65-Verified: <命令> => <输出摘要>`）
// ac65Authorized = ① ∧ ②（两谓词独立——⛔ 声明行含 "AC65" 但不含 "AC65-Verified:"，旧 /AC65/ 会按构造
// 使声明=免检，已弃）。声明 ∧ 无验证产物 ⇒ 红（判据3 执行体）；无声明 code-surface 直投 ⇒ 红。
// ⛔ 02b2b2fc legacy 形态（`AC65 一条命令验证：<实际输出>`——旧声明+验证合一短语）容忍重判 authorized。
// ⛔ 非 plugin/scripts/* 文件名豁免（掩真直投，manager 已拒）。

test("PURE AC65 — findAc65Entry 前缀匹配（纯展示，不参与判定）", () => {
  assert.equal(findAc65Entry("02b2b2fc")?.sha, "02b2b2fc");
  assert.equal(findAc65Entry("02b2b2fcbc0188bd358d1f723d6a80975378afce")?.sha, "02b2b2fc", "全量 sha 前缀匹配");
  assert.equal(findAc65Entry("7e64a86b"), undefined, "真直投不入展示表");
  assert.equal(findAc65Entry(""), undefined);
  assert.equal(findAc65Entry(null), undefined);
});

test("PURE AC65 — 两谓词独立：声明（^AC65:）∧ 验证产物（AC65-Verified:）⇒ authorized；声明字面不满足验证谓词", () => {
  // ⛔ 两谓词独立（旧 /AC65/ 缺陷）：声明行含 "AC65" 但不含 "AC65-Verified:"，不得被验证谓词字面满足。
  assert.equal(AC65_DECLARATION_RE.test("AC65: outer 按 AC65 授权直修（一条命令可验）"), true, "声明谓词匹配 ^AC65: 行");
  assert.equal(AC65_VERIFICATION_RE.test("AC65: outer 按 AC65 授权直修（一条命令可验）"), false, "⛔ 声明行不得满足验证谓词");
  assert.equal(AC65_VERIFICATION_RE.test("AC65-Verified: node test => 24/24 绿"), true, "验证谓词匹配 AC65-Verified: 行");
  assert.equal(AC65_DECLARATION_RE.test("AC65-Verified: node test => 24/24 绿"), false, "验证产物行不是声明（^AC65: 要求行首 AC65:）");

  assert.equal(commitHasAc65Declaration("AC65: outer 按 AC65 授权直修（一条命令可验）"), true);
  assert.equal(commitHasAc65Verification("AC65: outer 按 AC65 授权直修（一条命令可验）"), false);
  assert.equal(commitHasAc65Declaration("init/SKILL.md: 声明 reference-doc"), false);
  assert.equal(commitHasAc65Verification("init/SKILL.md: 声明 reference-doc"), false);
  assert.equal(commitHasAc65Declaration(""), false);
  assert.equal(commitHasAc65Verification(""), false);
  assert.equal(commitHasAc65Declaration(null), false);
  assert.equal(commitHasAc65Verification(null), false);

  // 02b2b2fc legacy 形态（AC65 一条命令验证：<实际输出>）——声明/验证两谓词都容忍（不补写历史、不改历史消息）。
  assert.equal(AC65_LEGACY_RE.test(AC65_AUTHORIZED_SAMPLE.message), true, "legacy 合一短语命中容忍正则");
  assert.equal(commitHasAc65Declaration(AC65_AUTHORIZED_SAMPLE.message), true, "legacy 合一短语满足声明谓词");
  assert.equal(commitHasAc65Verification(AC65_AUTHORIZED_SAMPLE.message), true, "legacy 合一短语满足验证谓词");

  // ac65Evidence 展示面：验证产物行提取。
  assert.equal(extractAc65Evidence(AC65_AUTHORIZED_SAMPLE.message).includes("AC65"), true, "legacy 证据行含 AC65 前缀");
  assert.equal(extractAc65Evidence("AC65-Verified: node test => 24/24 绿").includes("AC65-Verified:"), true, "新形态证据行含 AC65-Verified:");
  assert.equal(extractAc65Evidence("AC65: outer 按 AC65 授权直修（一条命令可验）"), null, "无验证产物 ⇒ 无证据行");
  assert.equal(extractAc65Evidence(""), null);
});

test("PURE classifyCommit — AC65 两谓词：声明∧验证 ⇒ 非 bypass；声明∧无验证 ⇒ 红；无声明直投 ⇒ 红", () => {
  const holds = [];
  // 02b2b2fc legacy 形态（声明+验证合一短语）⇒ authorized。
  const ac65 = classifyCommit(
    { sha: "02b2b2fc", files: ["plugin/scripts/manager-tick-readings.ts", "plugin/test/manager-tick-readings.test.mjs"], epoch: 200, subject: "s", message: AC65_AUTHORIZED_SAMPLE.message },
    holds,
  );
  assert.equal(ac65.ac65Authorized, true, "02b2b2fc legacy 形态重判为 authorized");
  assert.equal(ac65.bypass, false);
  assert.equal(ac65.ac65Evidence.includes("AC65"), true, "证据（命令+输出引用）可见可审计");
  assert.equal(ac65.codeSurfaceFiles.length, 2, "AC65 授权直修仍是代码面（denominator 可见，非静默掩盖）");

  // 新形态：声明（^AC65:）∧ 验证产物（AC65-Verified:）⇒ authorized。
  const newForm = classifyCommit(
    { sha: "x", files: ["plugin/scripts/foo.ts"], epoch: 200, subject: "s",
      message: "AC65: outer 按 AC65 授权直修（一条命令可验）\nAC65-Verified: node --test => 24/24 绿" },
    holds,
  );
  assert.equal(newForm.ac65Authorized, true, "新形态声明∧验证 ⇒ authorized");
  assert.equal(newForm.bypass, false);
  assert.equal(newForm.ac65Evidence.includes("AC65-Verified:"), true);

  // ⛔ 声明 ∧ 无验证产物 ⇒ 红（判据3 执行体——旧 /AC65/ 会按构造免检，已弃）。
  const declOnly = classifyCommit(
    { sha: "y", files: ["plugin/scripts/foo.ts"], epoch: 200, subject: "s", message: "AC65: outer 按 AC65 授权直修（一条命令可验）" },
    holds,
  );
  assert.equal(declOnly.ac65Authorized, false, "声明∧无验证产物 ⇒ 非 authorized");
  assert.equal(declOnly.bypass, true, "声明∧无验证产物 ⇒ 红");

  // 无声明 code-surface 直投 ⇒ 仍红。
  const real = classifyCommit({ sha: "7e64a86b", files: ["plugin/skills/init/SKILL.md"], epoch: 200, subject: "s", message: "init/SKILL.md: 声明 reference-doc" }, holds);
  assert.equal(real.ac65Authorized, false);
  assert.equal(real.bypass, true);
});

test("PURE checkDirectCommits — AC65 授权直修不计入 violations；混合真直投仍红；ac65 计数正确", () => {
  const ac65 = { ...AC65_AUTHORIZED_SAMPLE, epoch: 1_700_000_000, action: "commit" };
  const v = checkDirectCommits([ac65], []);
  assert.equal(v.violations.length, 0, "AC65 授权直修不得报红");
  assert.equal(v.ac65AuthorizedCommits, 1);
  assert.equal(v.codeSurfaceCommits, 1);

  // 混合：AC65 授权 + 真直投 ⇒ 只红真直投。
  const mixed = checkDirectCommits([
    ac65,
    { sha: "7e64a86b", files: ["plugin/skills/init/SKILL.md"], epoch: 1_700_000_001, subject: "s", message: "init/SKILL.md: 声明", action: "commit" },
  ], []);
  assert.equal(mixed.violations.length, 1);
  assert.equal(mixed.violations[0].sha, "7e64a86b");
  assert.equal(mixed.ac65AuthorizedCommits, 1);
  assert.equal(mixed.codeSurfaceCommits, 2, "AC65 授权与真直投都是代码面（denominator 都可见）");
});

test("AC3 回放·真实 git — 02b2b2fc（AC65 授权直修，消息带验证证据）不再被误标", (t) => {
  const d = realCommitData("02b2b2fc");
  if (!d) {
    t.skip(`样本 sha 不在本 repo（02b2b2fc）——真实 git 回放跳过，fixture 回放仍覆盖`);
    return;
  }
  assert.equal(/AC65/.test(d.message ?? ""), true, "真提交消息携带 AC65 验证证据");
  const v = checkDirectCommits([{ ...d, action: "commit" }], []);
  assert.equal(v.violations.length, 0, `AC65 授权直修必须不再误标: ${JSON.stringify(v.classified.map((c) => ({ sha: c.sha, bypass: c.bypass, ac65: c.ac65Authorized })))}`);
  assert.equal(v.ac65AuthorizedCommits, 1);
  assert.equal(v.classified[0].ac65Authorized, true);
});

test("AC3 回放·CLI — 02b2b2fc exit 0（AC65 授权直修）；7e64a86b exit 1（真直投仍红）；混合只红真直投", (t) => {
  if (!realCommitData("02b2b2fc") || !realCommitData("7e64a86b")) {
    t.skip("样本 sha 不在本 repo——CLI 回放跳过");
    return;
  }
  const rAc65 = runChecker(["--root", REPO_ROOT, "--commits", "02b2b2fc"]);
  assert.equal(rAc65.status, 0, `AC65 授权直修必须 GREEN(exit 0): ${rAc65.stdout}${rAc65.stderr}`);
  const outAc65 = jsonOut(rAc65);
  assert.equal(outAc65.ok, true);
  assert.equal(outAc65.reason, "ac65-authorized-direct-fix-only");
  assert.equal(outAc65.candidates[0].ac65Authorized, true);
  assert.equal(outAc65.candidates[0].confirmedBypass, false);
  assert.equal(outAc65.candidates[0].ac65Evidence.includes("AC65"), true);
  assert.equal(outAc65.denominator.ac65AuthorizedCommits, 1);

  const rReal = runChecker(["--root", REPO_ROOT, "--commits", "7e64a86b"]);
  assert.equal(rReal.status, 1, `真直投必须仍 RED(exit 1): ${rReal.stdout}${rReal.stderr}`);
  assert.equal(jsonOut(rReal).candidates[0].ac65Authorized, false);

  const rMixed = runChecker(["--root", REPO_ROOT, "--commits", "02b2b2fc,7e64a86b"]);
  assert.equal(rMixed.status, 1, `混合含真直投 ⇒ 仍 RED(exit 1): ${rMixed.stdout}${rMixed.stderr}`);
  const outMixed = jsonOut(rMixed);
  const bySha = Object.fromEntries(outMixed.candidates.map((c) => [c.sha.slice(0, 8), c]));
  assert.equal(bySha["02b2b2fc"].ac65Authorized, true);
  assert.equal(bySha["02b2b2fc"].confirmedBypass, false);
  assert.equal(bySha["7e64a86b"].ac65Authorized, false);
  assert.equal(bySha["7e64a86b"].confirmedBypass, true);
});

// ── Ruled-historical 豁免（gap-direct-to-develop-ruled-historical-cddc55e2）──────────────────────────
// manager 2026-08-15 裁定 one-off：cddc55e2（inner 紧急回退自己的破坏）→ ruledHistorical（独立分类，
// 非 bypass、非 ac65Authorized——两类输出可区分）。⛔ 豁免表有界（只覆盖 cddc55e2）；非入表真直投仍红
// （能取假）；判据3（声明∧无验证⇒红）不松动。

test("PURE RULED — findRuledHistoricalEntry 前缀匹配 + 表有界（非入表 sha 返回 undefined）", () => {
  assert.equal(findRuledHistoricalEntry("cddc55e2")?.sha, "cddc55e2");
  assert.equal(findRuledHistoricalEntry("cddc55e24e343708426ecbc0bcd7fea33c28697a")?.sha, "cddc55e2", "全量 sha 前缀匹配");
  assert.equal(findRuledHistoricalEntry("7e64a86b"), undefined, "真直投不入豁免表");
  assert.equal(findRuledHistoricalEntry(""), undefined);
  assert.equal(findRuledHistoricalEntry(null), undefined);
  assert.equal(RULED_HISTORICAL_COMMITS.length >= 1, true, "豁免表非空（承载 cddc55e2）");
});

test("PURE classifyCommit — cddc55e2 → ruledHistorical（非 bypass 非 ac65Authorized）；真直投（无豁免无 AC65）仍红", () => {
  const holds = [];
  // cddc55e2：代码面（SKILL.md）∧ 无 AC65 声明，但命中 ruled 表 ⇒ ruledHistorical，非 bypass、非 ac65Authorized。
  const ruled = classifyCommit(RULED_HISTORICAL_SAMPLE, holds);
  assert.equal(ruled.ruledHistorical, true, "cddc55e2 命中 ruled 表 ⇒ ruledHistorical");
  assert.equal(ruled.bypass, false, "ruled 豁免 ⇒ 非 bypass");
  assert.equal(ruled.ac65Authorized, false, "ruled 豁免是独立分类，非 ac65Authorized（两类可区分）");
  assert.equal(typeof ruled.ruledReason, "string", "ruledReason（定案理由）可见可审计");
  assert.ok(ruled.ruledReason.includes("manager 2026-08-15 裁定"), "定案理由带 manager 裁定");
  assert.equal(ruled.codeSurfaceFiles.length, 1, "cddc55e2 仍是代码面（denominator 可见，非静默掩盖）");
  assert.equal(ruled.codeSurfaceFiles[0], "plugin/skills/init/SKILL.md");

  // 真直投（无 AC65、无 ruled 豁免）⇒ 仍红——表有界，非入表 sha 不被豁免。
  const real = classifyCommit({ sha: "7e64a86b", files: ["plugin/skills/init/SKILL.md"], epoch: 200, subject: "s", message: "init/SKILL.md: 声明 reference-doc" }, holds);
  assert.equal(real.ruledHistorical, false, "非入表 sha ⇒ ruledHistorical=false");
  assert.equal(real.ac65Authorized, false);
  assert.equal(real.bypass, true, "真直投（无豁免无 AC65）仍红——豁免表有界（能取假）");

  // ⛔ 判据3 不松动：声明∧无验证产物 ⇒ 红（即使非入表 sha 有 AC65 声明字面，也无验证产物）。
  const declOnly = classifyCommit(
    { sha: "y", files: ["plugin/scripts/foo.ts"], epoch: 200, subject: "s", message: "AC65: outer 按 AC65 授权直修（一条命令可验）" },
    holds,
  );
  assert.equal(declOnly.ruledHistorical, false, "非入表 sha 不因 AC65 声明字面变 ruled");
  assert.equal(declOnly.ac65Authorized, false, "声明∧无验证产物 ⇒ 非 authorized（判据3）");
  assert.equal(declOnly.bypass, true, "声明∧无验证产物 ⇒ 红（判据3 保持）");
});

test("PURE checkDirectCommits — ruled 豁免不计入 violations；ruledHistoricalCommits 计数正确；混合只红真直投", () => {
  const ruled = { ...RULED_HISTORICAL_SAMPLE, epoch: 1_700_000_000, action: "commit" };
  const v = checkDirectCommits([ruled], []);
  assert.equal(v.violations.length, 0, "ruled 豁免不得报红");
  assert.equal(v.ruledHistoricalCommits, 1);
  assert.equal(v.codeSurfaceCommits, 1, "ruled 豁免仍是代码面（denominator 可见）");
  assert.equal(v.ac65AuthorizedCommits, 0, "ruled 豁免不是 AC65 授权（独立分类）");

  // 混合：ruled 豁免 + 真直投 ⇒ 只红真直投。
  const mixed = checkDirectCommits([
    ruled,
    { sha: "7e64a86b", files: ["plugin/skills/init/SKILL.md"], epoch: 1_700_000_001, subject: "s", message: "init/SKILL.md: 声明", action: "commit" },
  ], []);
  assert.equal(mixed.violations.length, 1);
  assert.equal(mixed.violations[0].sha, "7e64a86b", "非入表真直投仍红（表有界）");
  assert.equal(mixed.ruledHistoricalCommits, 1);
  assert.equal(mixed.codeSurfaceCommits, 2, "ruled 与真直投都是代码面（denominator 都可见）");
});

test("AC3 回放·真实 git — cddc55e2（ruled 豁免）不再被误标；非入表真直投仍红", (t) => {
  const ruled = realCommitData("cddc55e2");
  const real = realCommitData("7e64a86b");
  if (!ruled || !real) {
    t.skip(`样本 sha 不在本 repo（${[!ruled && "cddc55e2", !real && "7e64a86b"].filter(Boolean).join(",")}）——真实 git 回放跳过，fixture 回放仍覆盖`);
    return;
  }
  assert.ok(ruled.files.includes("plugin/skills/init/SKILL.md"), "cddc55e2 真提交触及代码面 SKILL.md");
  const vr = checkDirectCommits([{ ...ruled, action: "commit" }], []);
  assert.equal(vr.violations.length, 0, `cddc55e2（ruled 豁免）必须不再误标: ${JSON.stringify(vr.classified.map((c) => ({ sha: c.sha.slice(0, 8), bypass: c.bypass, ac65: c.ac65Authorized, ruled: c.ruledHistorical })))}`);
  assert.equal(vr.classified[0].ruledHistorical, true);
  assert.equal(vr.classified[0].bypass, false);
  assert.equal(vr.classified[0].ac65Authorized, false);

  const vv = checkDirectCommits([{ ...real, action: "commit" }], []);
  assert.equal(vv.violations.length, 1, "非入表真直投仍红");
  assert.equal(vv.violations[0].bypass, true);
});

test("AC3 回放·CLI — cddc55e2 exit 0（ruledHistorical，非 bypass 非 ac65Authorized）；7e64a86b exit 1（真直投仍红）；混合只红真直投", (t) => {
  if (!realCommitData("cddc55e2") || !realCommitData("7e64a86b")) {
    t.skip("样本 sha 不在本 repo——CLI 回放跳过");
    return;
  }
  const rRuled = runChecker(["--root", REPO_ROOT, "--commits", "cddc55e2"]);
  assert.equal(rRuled.status, 0, `cddc55e2（ruled 豁免）必须 GREEN(exit 0): ${rRuled.stdout}${rRuled.stderr}`);
  const outRuled = jsonOut(rRuled);
  assert.equal(outRuled.ok, true);
  assert.equal(outRuled.candidates[0].ruledHistorical, true);
  assert.equal(outRuled.candidates[0].confirmedBypass, false);
  assert.equal(outRuled.candidates[0].ac65Authorized, false);
  assert.equal(outRuled.denominator.ruledHistoricalCommits, 1);
  assert.ok(typeof outRuled.candidates[0].ruledReason === "string" && outRuled.candidates[0].ruledReason.length > 0, "ruledReason 可见");

  const rReal = runChecker(["--root", REPO_ROOT, "--commits", "7e64a86b"]);
  assert.equal(rReal.status, 1, `非入表真直投必须仍 RED(exit 1): ${rReal.stdout}${rReal.stderr}`);
  assert.equal(jsonOut(rReal).candidates[0].ruledHistorical, false);

  const rMixed = runChecker(["--root", REPO_ROOT, "--commits", "cddc55e2,7e64a86b"]);
  assert.equal(rMixed.status, 1, `混合含真直投 ⇒ 仍 RED(exit 1): ${rMixed.stdout}${rMixed.stderr}`);
  const outMixed = jsonOut(rMixed);
  const bySha = Object.fromEntries(outMixed.candidates.map((c) => [c.sha.slice(0, 8), c]));
  assert.equal(bySha["cddc55e2"].ruledHistorical, true);
  assert.equal(bySha["cddc55e2"].confirmedBypass, false);
  assert.equal(bySha["cddc55e2"].ac65Authorized, false);
  assert.equal(bySha["7e64a86b"].ruledHistorical, false);
  assert.equal(bySha["7e64a86b"].confirmedBypass, true);
});

test("AC3 回放·CLI — 全量扫描（生产基线 b11ce720）ok=true：cddc55e2 ruledHistorical，无真直投红", (t) => {
  const baseline = "b11ce720";
  const baseExists = gitCmd(REPO_ROOT, "cat-file", "-e", `${baseline}^{commit}`).status === 0;
  if (!baseExists) {
    t.skip("基线 sha 不在本 repo——全量扫描跳过");
    return;
  }
  const r = runChecker(["--root", REPO_ROOT, "--baseline", baseline]);
  assert.equal(r.status, 0, `全量扫描必须 GREEN(exit 0): ${r.stdout}${r.stderr}`);
  const out = jsonOut(r);
  assert.equal(out.evaluated, true);
  assert.equal(out.ok, true, `基线后无真直投红: ${r.stdout}${r.stderr}`);
  const ruled = out.candidates.find((c) => c.sha.startsWith("cddc55e2"));
  assert.ok(ruled, "cddc55e2 在候选（代码面）中");
  assert.equal(ruled.ruledHistorical, true, "cddc55e2 分类为 ruledHistorical");
  assert.equal(ruled.confirmedBypass, false);
  assert.ok(out.candidates.every((c) => !c.confirmedBypass), "无真直投红");
});

test("AC3 负控制·真实 git — 2fdb6e32（docs/ 非 ASCII 设计正本）CLI --commits 必须 GREEN（AC3）", (t) => {
  if (gitCmd(REPO_ROOT, "cat-file", "-e", "2fdb6e32^{commit}").status !== 0) {
    t.skip("2fdb6e32 不在本 repo——CLI 回放跳过");
    return;
  }
  const r = runChecker(["--root", REPO_ROOT, "--commits", "2fdb6e32"]);
  assert.equal(r.status, 0, `2fdb6e32（docs/ 非 ASCII）必须 GREEN(exit 0): ${r.stdout}${r.stderr}`);
  const out = jsonOut(r);
  assert.equal(out.evaluated, true);
  assert.equal(out.ok, true);
  assert.equal(out.reason, "no-code-surface-direct-commits");
  assert.equal(out.denominator.designInternalCommits, 1, "docs/ 非 ASCII 计入设计内");
  assert.equal(out.denominator.codeSurfaceCommits, 0, "非 ASCII docs/ 不得被误判为 code-surface");
});

// ── CLI 集成（temp repo）：直接提交代码面 RED / .gitignore GREEN / fan-in ff 不误报 ─────────────

/** 固定过去时刻（2026-08-01）——使 init 提交的 committer epoch 永不落入「当前时刻」的锁窗豁免测试窗口。 */
const FIXED_PAST = "2026-08-01T00:00:00Z";

/** 以固定 author+committer 时刻提交（`git commit --date` 只设 author date，committer date 需 env）。 */
function gitCommitFixed(cwd, date, message) {
  return spawnSync("git", ["-C", cwd, "commit", "-q", "-m", message], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

function initRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "d2d-test");
  gitCmd(dir, "config", "user.email", "d2d@example.com");
  gitCmd(dir, "branch", "-M", "develop");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".quay/\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCommitFixed(dir, FIXED_PAST, "chore: gitignore");
  // base 提交必须落在设计内面（tasks/）——否则 init 自身的 base 会被当成代码面直接提交报红。
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "base.md"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCommitFixed(dir, FIXED_PAST, "tasks: base");
}

test("CLI — 直接提交 develop 触及代码面 ⇒ RED(exit 1)；同 repo 直接提交 .gitignore ⇒ 该条不报", () => {
  const dir = makeTmp("cli");
  try {
    initRepo(dir);
    // 直接提交代码面（plugin/test/x.test.mjs）。
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "x.test.mjs"), "export const x = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: direct code commit");
    // 直接提交 .gitignore（设计内）。
    fs.appendFileSync(path.join(dir, ".gitignore"), "*.log\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "chore: gitignore update");

    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 1, `直接提交代码面必须 RED: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.reason, "direct-commit-bypasses-fan-in");
    assert.equal(out.candidates.length, 1, "只有代码面那条是候选");
    assert.equal(out.candidates[0].codeSurfaceFiles[0], "plugin/test/x.test.mjs");
    assert.equal(out.denominator.totalDirectCommits, 3, "root commit 无父可 diff 被跳过：init 算 1 条 + 代码面 + .gitignore = 3");
  } finally {
    cleanup(dir);
  }
});

test("CLI — 只有设计内直接提交（.gitignore）⇒ GREEN(exit 0)，denominator 设计内计数正确", () => {
  const dir = makeTmp("cliint");
  try {
    initRepo(dir);
    fs.appendFileSync(path.join(dir, ".gitignore"), "*.log\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "chore: gitignore update");

    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 0, `设计内直接提交必须 GREEN: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.ok, true);
    assert.equal(out.denominator.designInternalCommits >= 1, true);
    assert.equal(out.denominator.codeSurfaceCommits, 0);
  } finally {
    cleanup(dir);
  }
});

test("CLI — fan-in ff 落地不误报：task 分支 ff 到 develop 不是直接提交", () => {
  const dir = makeTmp("cliff");
  try {
    initRepo(dir);
    const base = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    // 建 task 分支，改代码面文件，再 ff 回 develop（模拟 fan-in）。
    gitCmd(dir, "checkout", "-q", "-b", "task/gap-foo");
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "scripts", "work.ts"), "export const w = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "feat: task work");
    gitCmd(dir, "checkout", "-q", "develop");
    const ff = gitCmd(dir, "merge", "--ff-only", "task/gap-foo");
    assert.equal(ff.status, 0, "ff 应成功");

    const r = runChecker(["--root", dir, "--baseline", base]);
    assert.equal(r.status, 0, `fan-in ff 不是直接提交，不得误报: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.denominator.totalDirectCommits, 0, "ff 落地不应计入直接提交");
  } finally {
    cleanup(dir);
  }
});

test("CLI — 锁窗豁免：直接提交落在锁 acquire→release 区间内 ⇒ 不报（保守口径）", () => {
  const dir = makeTmp("clilock");
  const st = makeTmp("clilockstate");
  try {
    initRepo(dir);
    // 直接提交代码面。
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "y.test.mjs"), "export const y = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: direct code commit");
    // 读提交真实 committer epoch，再把锁窗口精确包住它（acquire=epoch-1, release=epoch+1）。
    const commitEpoch = Number(gitCmd(dir, "log", "-1", "--format=%ct", "HEAD").stdout.trim());
    const events = path.join(st, "fan-in-merge-lock-events.jsonl");
    fs.mkdirSync(path.join(st), { recursive: true });
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", ts: new Date((commitEpoch - 1) * 1000).toISOString(), epoch: commitEpoch - 1, taskId: "t", pid: 1 }),
      JSON.stringify({ event: "release", ts: new Date((commitEpoch + 1) * 1000).toISOString(), epoch: commitEpoch + 1, taskId: "t", pid: 1 }),
    ].join("\n") + "\n", "utf8");

    const r = runChecker(["--root", dir, "--lock-events", events]);
    assert.equal(r.status, 0, `落在锁窗内 ⇒ 豁免（不报）: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.ok, true);
    assert.equal(out.denominator.inLockWindowCommits, 1);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("CLI — 锁事件不成对（release 无 acquire）⇒ NOT-EVALUATED（exit 0，evaluated:false——3b）", () => {
  const dir = makeTmp("climal");
  const st = makeTmp("climalstate");
  try {
    initRepo(dir);
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "z.test.mjs"), "export const z = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: direct code commit");
    const events = path.join(st, "events.jsonl");
    fs.writeFileSync(events, JSON.stringify({ event: "release", epoch: 100, taskId: "t", pid: 1 }) + "\n", "utf8");

    const r = runChecker(["--root", dir, "--lock-events", events]);
    assert.equal(r.status, 0, `锁事件不成对 ⇒ NOT-EVALUATED，不得红也不得假装绿`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, false, "锁窗口读不出 ⇒ 整体 NOT-EVALUATED（3b: 读不懂≠合格）");
    assert.equal(out.ok, true, "NOT-EVALUATED 不是 RED");
    assert.equal(out.reason, "code-surface-direct-commits-but-lock-window-not-evaluated");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("CLI — docs/ 下非 ASCII 文件名直接提交 ⇒ GREEN（quoted-path 豁免，AC1/AC3 负控制）", () => {
  const dir = makeTmp("cliunicode-doc");
  try {
    initRepo(dir);
    // 2fdb6e32 形态：docs/ 下非 ASCII 文件名（git 默认对 --name-only 输出 C-quoted 形态）。
    fs.mkdirSync(path.join(dir, "docs", "design"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "design", "Quay改进版WebUI.dc.html"), "<html>design</html>\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "docs: 落盘设计正本（非 ASCII 文件名）");

    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 0, `docs/ 非 ASCII 必须 GREEN(exit 0): ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.ok, true);
    assert.equal(out.denominator.designInternalCommits >= 1, true, "docs/ 非 ASCII 计入设计内（排除生效）");
    assert.equal(out.denominator.codeSurfaceCommits, 0, "docs/ 非 ASCII 不得被误判为 code-surface");
  } finally {
    cleanup(dir);
  }
});

test("CLI — code-surface 非 ASCII 文件名直接提交 ⇒ RED（AC2 不误放），路径不带引号/转义", () => {
  const dir = makeTmp("cliunicode-code");
  try {
    initRepo(dir);
    // code-surface 非 ASCII 文件名（plugin/test/ 下）⇒ 必须仍报红，且路径是原始字节（非 C-quoted）。
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "测试.test.mjs"), "export const x = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: 非 ASCII 代码文件直投");

    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 1, `code-surface 非 ASCII 必须 RED(exit 1): ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "direct-commit-bypasses-fan-in");
    assert.equal(out.candidates.length, 1, "只有代码面那条是候选");
    assert.equal(out.candidates[0].confirmedBypass, true, "code-surface 非 ASCII 仍红（AC2 不误放）");
    assert.equal(out.candidates[0].codeSurfaceFiles[0], "plugin/test/测试.test.mjs", "路径应为原始字节（不带前导引号/八进制转义）");
  } finally {
    cleanup(dir);
  }
});

test("--help exits 0 with usage on stdout", () => {
  const r = runChecker(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /direct-to-develop-bypass-check/);
});
