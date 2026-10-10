// @test-group engine
// direct-to-develop-bypass-check.test.mjs — 直接提交 develop 绕过 fan-in 机件的检测器
// (tasks/gap-direct-to-develop-bypasses-fan-in-gates, 11b/C17 写所有权/越权直改面),
// plugin/scripts/direct-to-develop-bypass-check.ts.
//
// 能取假（AC3）：真样本（核心子集 4 条 7d1d5d2e/b389a758/18e7a3be/77174684）必须报红；
// 设计内样本（.gitignore / manager 独占 / init 独占 / 热修 fan-in 机件本身）必须绿。回放走两条路：
// AC1 粒度：7e64a86b（plugin/skills/init/SKILL.md）与 635ec831（plugin/skills/manager/SKILL.md）都转绿
// ——粒度到 init/** 与 manager/**（纯 docs skill 目录），不掩其它 plugin/skills/*（如 manager-tool/）真红。
//   ① 真实 git 读（REPO_ROOT 的 develop 历史含这些样本——它们是 develop 的祖先），喂纯判定；
//   ② 硬编码 fixture（file 清单 + 时刻，取自真提交）——在无该历史的 hermetic clone 里也跑。
// 另覆盖：锁时间窗豁免、设计内/外分离（AC2）、NOT-EVALUATED（reflog 无 / 锁事件不成对，硬规则3b）、
// CLI 集成（temp repo：直接提交代码面 ⇒ RED；直接提交 .gitignore ⇒ GREEN；fan-in ff 不误报）。
// AC65 授权直修 carve-out（gap-ac65-direct-fix-vs-bypass-detector-conflict）：02b2b2fc（AC65 授权直修，
// 消息带验证证据）不再被误标；7d1d5d2e（真直投）仍红——按 sha + 证据豁免，非 plugin/scripts/* 文件名豁免
// （fail-closed：sha 入表但消息无 AC65 标记 ⇒ 仍红）。
// Ruled-historical 豁免（gap-direct-to-develop-ruled-historical-cddc55e2，manager 2026-08-15 裁定 one-off）：
// 8e024f88（outer 直修 fixture 日期时间炸弹，AC65 散文消息非两谓词形态）→ ruledHistorical=true（独立分类，
// 非 bypass、非 ac65Authorized——两类输出可区分 AC65-AUTHORIZED vs RULED-HISTORICAL）；真直投（无豁免无 AC65）
// 仍红；⛔ 判据3（声明∧无验证⇒红）不松动。豁免表有界，非入表 sha 仍红（能取假）。
// ⛔ cddc55e2（原 ruled 样本）现因 init/ 入排除集变全设计内——code-surface 锚失效，改用 8e024f88
// （plugin/test/outer-cron-registry.test.mjs 仍代码面）作 ruled 样本，保持「ruled 豁免仍代码面可见」不变式。
//
// 落地词汇表按结构判定（gap-ac194-reflog-action-vocabulary-incomplete）：旧 `isReflogFanIn` 是**拼法
// 白名单**（`push` | `/Fast-forward/`），生产出现第三种 ref-level 落地拼法 `branch: Reset to` 时它结构上
// 不可能发现 ⇒ 两条 tip 落进 unclassifiable ⇒ 硬规则③b ⇒ AC-194 恒 fail。本文件现钉住：
//   · PURE `classifyReflogAction` 三态（direct = action 以 commit 开头；refMove = 六种实测 ref-level
//     拼法，逐条贴探针原文；unknown = 其余 ⇒ fail-closed）；
//   · PURE `reflogActionForm`（reason 点名用的形）与 `buildRefMoveBrackets`（含「unknown 不产 tip」）；
//   · CLI `branch: Reset to` 落地代码面 ⇒ GREEN 且 `classification.refMoveIntroduced` 逐条可见
//     （sha + code-surface 标记，⛔ 不并入 fan-in 计数）；
//   · CLI 未知 action 形 ⇒ exit 3 且 reason 逐字点名该形（旧版只报 unclassifiable-commits-in-range 计数）；
//   · CLI rewind（P 非 T 祖先）⇒ 不计为「带入 commit 的落地」，单列 `nonForwardRefMoves`（引入集为空）；
//   · CLI `commit:` action 的 code-surface 直投仍 RED（放宽词汇表不得漏掉真直投）。
//
// 钉子（gap-ac194-production-criterion-owner）：上一条目对 fetch 只钉了**一种后缀拼法**（`: storing ref`）
// ⇒ 把 fetch 分支改回拼法白名单**不会有任何测试变红**——「第 6 次拼法变更」没有载体（硬规则 9）。
// 本文件现另钉两类读数：(a) 生产真实形态 `fetch -q . author:develop: fast-forward`（develop 真实 reflog
// 里的逐字条目，见下方「fetch 形的钉子」节的实测引用）；(b) 词表外后缀（`pruned`）仍 ⇒ refMove。
// **变异检验**：把该分支改回 `&& /: storing ref\s*$/.test(s)` ⇒ 这些断言必须变红（否则它只是回声，
// 硬规则④推论三）。
//
// releaseBump 结构分类（gap-ac194-release-bump-classified-as-bypass，本判据第四次变假）：SPEC §4.3/§12
// 的 release-cut step-5「下一版 bump」按设计直落 develop（release-cut.mjs:514-524）——旧判据把它判 bypass
// ⇒ AC-194 恒 fail。本文件钉住谓词式分类（⛔ 非 sha 表）：
//   · PURE `RELEASE_BUMP_SUBJECT_RE`（生成器唯一模板，整串锚定）与 `extractCutParents`（只认 form:"cut"
//     ∧ base 匹配）；
//   · PURE `classifyReleaseBumpCommit` 三谓词合取 + 第三态（来源读不出 ⇒ null，⛔ 不与 false 同形）；
//   · CLI：生产形态（模板 subject + cut-ledger 直接子提交 + 载体集子集）⇒ exit 0 / RELEASE-BUMP 可见；
//     **负控**：同 subject 夹带一个载体外 code-surface 文件（plugin/scripts/x.ts）⇒ 仍 exit 1
//     direct-commit-bypasses-fan-in；ledger 缺席 ⇒ releaseBump 未评估且仍 RED（fail-closed）。
// **变异检验**（AC5）：把谓词改成「只匹配 subject」（丢掉 ②/③）⇒ 上面的负控断言必须变红。
//
// Run:
//   scripts/test.sh plugin/test/direct-to-develop-bypass-check.test.mjs
//   node --test plugin/test/direct-to-develop-bypass-check.test.mjs

import { test as _nodeTest } from "node:test";
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
  extractFanInLandedShas,
  isReflogDirectCommit,
  classifyReflogAction,
  reflogActionForm,
  buildReflogIndex,
  classifyLandingMode,
  buildRefMoveBrackets,
  classifySpineLandingMode,
  classifyPublishedReconcile,
  RELEASE_BUMP_SUBJECT_RE,
  extractCutParents,
  classifyReleaseBumpCommit,
  gitCommitFiles,
  gitCommitEpoch,
  gitCommitParent,
  gitCommitSubject,
  gitCommitMessage,
  gitCommitFilesBatch,
  gitCommitMetaBatch,
} from "../scripts/direct-to-develop-bypass-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "direct-to-develop-bypass-check.ts");

// ── AC1 cost decomposition (gap-direct-to-develop-bypass-check-git-fixture-cost) ──────────────────────
// env-gated, ZERO assertion change: QUAY_TEST_ASSERT_TIMING=1 makes every test print its wall-clock and
// the number of real git / checker subprocess spawns it made — the corpus technique (see
// tasks/gap-slow-test-shared-fixture-and-group-recheck.md AC3 and
// gap-suite-cost-model-is-wrong-optimizations-buy-nothing AC1b). Inert when the env var is unset:
// `test` IS node:test's own `test`, and the counters are never incremented.
const _COST_TIMING = !!process.env.QUAY_TEST_ASSERT_TIMING;
let _gitSpawns = 0;
let _checkerSpawns = 0;
const test = _COST_TIMING
  ? (name, fn) => _nodeTest(name, async (t) => {
      const t0 = Date.now();
      const g0 = _gitSpawns, c0 = _checkerSpawns;
      try { return await fn(t); }
      finally {
        console.error(`[cost] ${Date.now() - t0}ms git=${_gitSpawns - g0} checker=${_checkerSpawns - c0} :: ${name}`);
      }
    })
  : _nodeTest;

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

function gitCmd(cwd, ...args) {
  if (_COST_TIMING) _gitSpawns++;
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `d2d-${prefix ?? ""}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runChecker(args) {
  if (_COST_TIMING) _checkerSpawns++;
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

/** AC3 真样本：4 条必须报红。*/
const REAL_BYPASS_SAMPLES = [
  { sha: "7d1d5d2e", files: ["plugin/test/ready-pool-check.test.mjs"], subject: "test: AC5 负控制 self-touch 样本" },
  { sha: "b389a758", files: ["plugin/scripts/loop-shipping-exclusion-data.mjs"], subject: "mjs: AC1b 排除表加 manager-phase-goal-archive.md" },
  { sha: "18e7a3be", files: ["plugin/scripts/loop-shipping-exclusion-data.mjs"], subject: "mjs: manager-phase-goal 条目加 retainedNote" },
  { sha: "77174684", files: ["plugin/test/manager-tick-core.test.mjs"], subject: "test: AC3 pgrep-idle-watch 谓词加位置感知" },
];

/** 设计内样本：.gitignore / manager 独占 / init 独占 / 热修 fan-in 机件本身，必须绿（AC2）。*/
const DESIGN_INTERNAL_SAMPLES = [
  { sha: "gitignore-f", files: [".gitignore"], subject: "chore: gitignore" },
  { sha: "manager-tick-core", files: [".claude/workflows/manager-tick-core.js"], subject: "manager: tick-core 判准修正" },
  { sha: "orchestration-doc", files: ["orchestration/manager-tick-core.md"], subject: "orchestration: C17 枚举补全" },
  { sha: "claude-md", files: ["CLAUDE.md"], subject: "CLAUDE.md: 硬规则 12 补 12b" },
  { sha: "fan-in-hotfix", files: [".claude/workflows/fan-in-execute.js"], subject: "workflows: fix fan-in-execute meta" },
  { sha: "manager-skill", files: ["plugin/skills/manager/SKILL.md"], subject: "manager: SKILL.md 索引（635ec831 类）" },
  { sha: "init-skill", files: ["plugin/skills/init/SKILL.md"], subject: "init: SKILL.md reference-doc 索引（7e64a86b 类）" },
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

/** Ruled-historical 豁免样本（8e024f88——outer 2026-08-20 裁定 one-off，AC65 散文消息非两谓词形态）。
 *  必须分类为 ruledHistorical（独立分类，非 bypass、非 ac65Authorized）；非入表真直投仍红。
 *  ⛔ 原样本 cddc55e2 因 init/ 入排除集变全设计内（code-surface 锚失效），改用 8e024f88 保持
 *  「ruled 豁免仍代码面可见」不变式。 */
const RULED_HISTORICAL_SAMPLE = {
  sha: "8e024f88",
  files: ["plugin/test/outer-cron-registry.test.mjs"],
  subject: "test: outer-cron-registry fixture 硬编码 08-14 过期 ⇒ 改相对 now（修复 4 条恒红，解锁全管线 fan-in）",
  message: "test: outer-cron-registry fixture 硬编码 08-14 过期 ⇒ 改相对 now\n\nAC65 direct-fix（plugin/test 单命令可验）；非产品代码、非 capability-catalog 验证机件。",
};

// ── PURE: isDesignInternalPath — 设计内排除集（AC2）──────────────────────────────────────────────

test("PURE isDesignInternalPath — 记账/转向/遥测面 + manager/init 独占 + 基础设施 + 热修机件 ⇒ 设计内", () => {
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
    "plugin/skills/init/SKILL.md",
    "plugin/skills/init/sub/deep.md",
    "CLAUDE.md",
    "README.md",
    ".gitignore",
    ".gitattributes",
    ".npmrc",
    ".github/workflows/ci.yml",
    "plugin/scripts/fan-in-ff-merge.sh",
    "plugin/scripts/fan-in-ff-protocol-check.ts",
    "plugin/test/fan-in-ff-protocol-check.test.mjs",
  ];
  for (const p of designInternal) assert.equal(isDesignInternalPath(p), true, `设计内应排除: ${p}`);
});

test("PURE isDesignInternalPath — 代码/断言面（产品交付）不是设计内 ⇒ 报红候选", () => {
  const codeSurface = [
    "plugin/scripts/loop-shipping-exclusion-data.mjs",
    "plugin/test/ready-pool-check.test.mjs",
    "plugin/test/manager-tick-core.test.mjs",
    "plugin/skills/manager-tool/foo.md",
    "plugin/scripts/ready-pool-check.ts",
    "plugin/scripts/outer-cron-registry.ts",
    "packages/quay/src/mcp-server.ts",
    "scripts/test.sh",
    "LICENSE",
    "CHANGELOG.md",
    "AGENTS.md",
  ];
  for (const p of codeSurface) assert.equal(isDesignInternalPath(p), false, `代码面不应排除: ${p}`);
  // 反向：`fan-in-` 前缀只在 plugin/scripts|test 顶层豁免——不要误伤 loop-shipping 等。
  assert.equal(isDesignInternalPath("plugin/scripts/loop-shipping-exclusion-data.mjs"), false);
  assert.equal(isDesignInternalPath("plugin/test/fan-in-ff-merge.test.mjs"), true, "fan-in 机件测试豁免");
  // ⛔ AC3 粒度（gap-cron-registry-global-path-migration）：AC81 注册表收据迁全局 per-layer 路径后，
  // git 版 outer-cron-registry.json 已删除——`outer-cron-registry.json` 不再是设计内（若有人重建 git 版
  // 即代码面，红）；verifier 机件 .ts 仍不是设计内（直改仍红）。
  assert.equal(isDesignInternalPath("plugin/scripts/outer-cron-registry.json"), false, "git 版收据已退役，不再是设计内（重建即代码面，仍红）");
  assert.equal(isDesignInternalPath("plugin/scripts/outer-cron-registry.ts"), false, "verifier 机件 .ts 不是设计内（仍红）");
  // ⛔ AC2 粒度：manager/ 与 init/ 前缀豁免，但必须精确到各自子树（尾斜杠）——`manager-tool/` 是另一个
  // 目录，不得误豁免（同证 init/ 豁免不扩大到其它 plugin/skills/*）。
  assert.equal(isDesignInternalPath("plugin/skills/manager-tool/foo.md"), false, "manager-tool/ 不是 manager/ 或 init/ 子树");
  assert.equal(isDesignInternalPath("plugin/skills/init-tool/foo.md"), false, "init-tool/ 不是 init/ 子树");
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

test("PURE classifyCommit — README.md 设计内（非 bypass）；LICENSE/CHANGELOG.md/AGENTS.md 仍代码面（bypass）", () => {
  const holds = [];
  // AC1：README.md 直接提交 ⇒ 设计内，非 bypass（同 CLAUDE.md 类——纯 prose、仓库根、不被测试/构建解析）。
  const readme = classifyCommit({ sha: "r1", files: ["README.md"], epoch: 200, subject: "docs: README" }, holds);
  assert.equal(readme.designInternal, true, "README.md 设计内（AC1 根修）");
  assert.equal(readme.bypass, false, "README.md 直接提交不再报 bypass（AC1）");
  assert.deepEqual(readme.codeSurfaceFiles, []);

  // AC3：LICENSE / CHANGELOG.md / AGENTS.md 仍代码面 ⇒ 直改仍红（⛔ 不扩范围）。
  for (const f of ["LICENSE", "CHANGELOG.md", "AGENTS.md"]) {
    const c = classifyCommit({ sha: `c-${f}`, files: [f], epoch: 200, subject: "chore" }, holds);
    assert.equal(c.designInternal, false, `${f} 仍代码面（AC3 不扩范围）`);
    assert.equal(c.bypass, true, `${f} 直改仍红（AC3 能取假）`);
  }
});

// ── PURE: checkDirectCommits — 聚合 + denominator 计数（AC3 谓词口径）──────────────────────────

test("PURE checkDirectCommits — 真样本 4 条全红；设计内样本全绿；denominator 计数正确", () => {
  const samples = REAL_BYPASS_SAMPLES.map((s) => ({ ...s, epoch: 1_700_000_000, action: "commit" }));
  const v = checkDirectCommits(samples, []);
  assert.equal(v.violations.length, 4);
  assert.equal(v.codeSurfaceCommits, 4);
  assert.equal(v.designInternalCommits, 0);
  assert.equal(v.totalCommits, 4);
  assert.equal(v.violations.every((x) => x.bypass), true);

  const internal = DESIGN_INTERNAL_SAMPLES.map((s) => ({ ...s, epoch: 1_700_000_000, action: "commit" }));
  const v2 = checkDirectCommits(internal, []);
  assert.equal(v2.violations.length, 0, "设计内样本不得报红");
  assert.equal(v2.codeSurfaceCommits, 0);
  assert.equal(v2.designInternalCommits, 8);

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

const REAL_SHAS = ["7d1d5d2e", "b389a758", "18e7a3be", "77174684", "5e54bb37"];

test("AC3 回放·真实 git — develop 历史中 4 条真样本读自 git 后必须红，5e54bb37（热修机件）必须绿", (t) => {
  const missing = REAL_SHAS.filter((sha) => realCommitData(sha) === null);
  if (missing.length > 0) {
    // hermetic clone 无该历史 ⇒ skip（不把「样本不可得」当红/绿——硬规则 5：来源不完备不判存在）。
    t.skip(`样本 sha 不在本 repo（${missing.join(",")}）——真实 git 回放跳过，fixture 回放仍覆盖`);
    return;
  }
  const bypass = REAL_BYPASS_SAMPLES.map((s) => realCommitData(s.sha)).map((d) => ({ ...d, action: "commit" }));
  const v = checkDirectCommits(bypass, []);
  assert.equal(v.violations.length, 4, `真样本必须红: ${JSON.stringify(v.violations.map((x) => x.sha))}`);
  assert.equal(v.violations.every((x) => x.bypass), true);
  // 设计内真样本：5e54bb37 是热修 fan-in 机件本身（.claude/workflows/fan-in-execute.js）。
  const hotfix = realCommitData("5e54bb37");
  const v2 = checkDirectCommits([{ ...hotfix, action: "commit" }], []);
  assert.equal(v2.violations.length, 0, "热修 fan-in 机件本身必须绿");
  assert.equal(v2.designInternalCommits, 1);
});

test("AC3 回放·真实 git — CLI --commits 对 4 条真样本 exit 1（RED），对设计内 exit 0", (t) => {
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
  assert.equal(out.candidates.length, 4);

  const r2 = runChecker(["--root", REPO_ROOT, "--commits", "5e54bb37"]);
  assert.equal(r2.status, 0, `设计内（热修机件）必须 GREEN(exit 0): ${r2.stdout}${r2.stderr}`);
  assert.equal(jsonOut(r2).ok, true);
});

// ── AC1 粒度（init/** 与 manager/** 均豁免；⛔ 不掩其它 plugin/skills/* 真红）──────────────────

test("AC1 粒度 · 真实 git — 7e64a86b（init/SKILL.md）与 635ec831（manager/SKILL.md）均转绿（docs skill 目录豁免）", (t) => {
  const init = realCommitData("7e64a86b");
  const mgr = realCommitData("635ec831");
  if (!init || !mgr) {
    t.skip(`样本 sha 不在本 repo（${[!init && "7e64a86b", !mgr && "635ec831"].filter(Boolean).join(",")}）——真实 git 回放跳过，fixture 回放仍覆盖`);
    return;
  }
  const vi = checkDirectCommits([{ ...init, action: "commit" }], []);
  assert.equal(vi.violations.length, 0, `init/SKILL.md 直改必须转绿（AC1 豁免）: ${JSON.stringify(vi.classified)}`);
  assert.equal(vi.designInternalCommits, 1);
  const vm = checkDirectCommits([{ ...mgr, action: "commit" }], []);
  assert.equal(vm.violations.length, 0, `manager/SKILL.md 必须转绿（manager 独占 + 无 fan-in 路）: ${JSON.stringify(vm.classified)}`);
  assert.equal(vm.designInternalCommits, 1);
});

test("AC1 粒度 · CLI — 7e64a86b exit 0（GREEN）；635ec831 exit 0（GREEN）", (t) => {
  const init = realCommitData("7e64a86b");
  const mgr = realCommitData("635ec831");
  if (!init || !mgr) {
    t.skip("样本 sha 不在本 repo——CLI 回放跳过");
    return;
  }
  const rInit = runChecker(["--root", REPO_ROOT, "--commits", "7e64a86b"]);
  assert.equal(rInit.status, 0, `init/SKILL.md 必须 GREEN(exit 0): ${rInit.stdout}${rInit.stderr}`);
  const outInit = jsonOut(rInit);
  assert.equal(outInit.ok, true);
  assert.equal(outInit.denominator.designInternalCommits, 1);
  assert.equal(outInit.denominator.codeSurfaceCommits, 0);

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
  const real = classifyCommit({ sha: "7d1d5d2e", files: ["plugin/test/ready-pool-check.test.mjs"], epoch: 200, subject: "s", message: "test: AC5 负控制 self-touch 样本" }, holds);
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
    { sha: "7d1d5d2e", files: ["plugin/test/ready-pool-check.test.mjs"], epoch: 1_700_000_001, subject: "s", message: "test: AC5 负控制", action: "commit" },
  ], []);
  assert.equal(mixed.violations.length, 1);
  assert.equal(mixed.violations[0].sha, "7d1d5d2e");
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

test("AC3 回放·CLI — 02b2b2fc exit 0（AC65 授权直修）；7d1d5d2e exit 1（真直投仍红）；混合只红真直投", (t) => {
  if (!realCommitData("02b2b2fc") || !realCommitData("7d1d5d2e")) {
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

  const rReal = runChecker(["--root", REPO_ROOT, "--commits", "7d1d5d2e"]);
  assert.equal(rReal.status, 1, `真直投必须仍 RED(exit 1): ${rReal.stdout}${rReal.stderr}`);
  assert.equal(jsonOut(rReal).candidates[0].ac65Authorized, false);

  const rMixed = runChecker(["--root", REPO_ROOT, "--commits", "02b2b2fc,7d1d5d2e"]);
  assert.equal(rMixed.status, 1, `混合含真直投 ⇒ 仍 RED(exit 1): ${rMixed.stdout}${rMixed.stderr}`);
  const outMixed = jsonOut(rMixed);
  const bySha = Object.fromEntries(outMixed.candidates.map((c) => [c.sha.slice(0, 8), c]));
  assert.equal(bySha["02b2b2fc"].ac65Authorized, true);
  assert.equal(bySha["02b2b2fc"].confirmedBypass, false);
  assert.equal(bySha["7d1d5d2e"].ac65Authorized, false);
  assert.equal(bySha["7d1d5d2e"].confirmedBypass, true);
});

// ── Ruled-historical 豁免（gap-direct-to-develop-ruled-historical-cddc55e2）──────────────────────────
// manager 2026-08-15 裁定 one-off（先例）：8e024f88（outer 直修 fixture 日期时间炸弹，AC65 散文消息
// 非两谓词形态）→ ruledHistorical（独立分类，非 bypass、非 ac65Authorized——两类输出可区分）。
// ⛔ 豁免表有界；非入表真直投仍红（能取假）；判据3（声明∧无验证⇒红）不松动。
// ⛔ cddc55e2（原 ruled 样本）现因 init/ 入排除集变全设计内——code-surface 锚失效，改用 8e024f88
// （plugin/test/outer-cron-registry.test.mjs 仍代码面）作 ruled 样本，保持「ruled 豁免仍代码面可见」不变式。

test("PURE RULED — findRuledHistoricalEntry 前缀匹配 + 表有界（非入表 sha 返回 undefined）", () => {
  assert.equal(findRuledHistoricalEntry("8e024f88")?.sha, "8e024f88");
  assert.equal(findRuledHistoricalEntry("8e024f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")?.sha, "8e024f88", "全量 sha 前缀匹配");
  assert.equal(findRuledHistoricalEntry("7d1d5d2e"), undefined, "真直投不入豁免表");
  assert.equal(findRuledHistoricalEntry(""), undefined);
  assert.equal(findRuledHistoricalEntry(null), undefined);
  assert.equal(RULED_HISTORICAL_COMMITS.length >= 1, true, "豁免表非空（承载 8e024f88）");
});

test("PURE classifyCommit — 8e024f88 → ruledHistorical（非 bypass 非 ac65Authorized）；真直投（无豁免无 AC65）仍红", () => {
  const holds = [];
  // 8e024f88：代码面（test 文件）∧ AC65 散文消息非两谓词形态（ac65Authorized=false），但命中 ruled 表
  // ⇒ ruledHistorical，非 bypass、非 ac65Authorized。
  const ruled = classifyCommit(RULED_HISTORICAL_SAMPLE, holds);
  assert.equal(ruled.ruledHistorical, true, "8e024f88 命中 ruled 表 ⇒ ruledHistorical");
  assert.equal(ruled.bypass, false, "ruled 豁免 ⇒ 非 bypass");
  assert.equal(ruled.ac65Authorized, false, "ruled 豁免是独立分类，非 ac65Authorized（两类可区分）");
  assert.equal(typeof ruled.ruledReason, "string", "ruledReason（定案理由）可见可审计");
  assert.ok(ruled.ruledReason.includes("裁定"), "定案理由带裁定");
  assert.equal(ruled.codeSurfaceFiles.length, 1, "8e024f88 仍是代码面（denominator 可见，非静默掩盖）");
  assert.equal(ruled.codeSurfaceFiles[0], "plugin/test/outer-cron-registry.test.mjs");

  // 真直投（无 AC65、无 ruled 豁免）⇒ 仍红——表有界，非入表 sha 不被豁免。
  const real = classifyCommit({ sha: "7d1d5d2e", files: ["plugin/test/ready-pool-check.test.mjs"], epoch: 200, subject: "s", message: "test: AC5 负控制 self-touch 样本" }, holds);
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
    { sha: "7d1d5d2e", files: ["plugin/test/ready-pool-check.test.mjs"], epoch: 1_700_000_001, subject: "s", message: "test: AC5 负控制", action: "commit" },
  ], []);
  assert.equal(mixed.violations.length, 1);
  assert.equal(mixed.violations[0].sha, "7d1d5d2e", "非入表真直投仍红（表有界）");
  assert.equal(mixed.ruledHistoricalCommits, 1);
  assert.equal(mixed.codeSurfaceCommits, 2, "ruled 与真直投都是代码面（denominator 都可见）");
});

test("AC3 回放·真实 git — 8e024f88（ruled 豁免）不再被误标；非入表真直投仍红", (t) => {
  const ruled = realCommitData("8e024f88");
  const real = realCommitData("7d1d5d2e");
  if (!ruled || !real) {
    t.skip(`样本 sha 不在本 repo（${[!ruled && "8e024f88", !real && "7d1d5d2e"].filter(Boolean).join(",")}）——真实 git 回放跳过，fixture 回放仍覆盖`);
    return;
  }
  assert.ok(ruled.files.includes("plugin/test/outer-cron-registry.test.mjs"), "8e024f88 真提交触及代码面 test 文件");
  const vr = checkDirectCommits([{ ...ruled, action: "commit" }], []);
  assert.equal(vr.violations.length, 0, `8e024f88（ruled 豁免）必须不再误标: ${JSON.stringify(vr.classified.map((c) => ({ sha: c.sha.slice(0, 8), bypass: c.bypass, ac65: c.ac65Authorized, ruled: c.ruledHistorical })))}`);
  assert.equal(vr.classified[0].ruledHistorical, true);
  assert.equal(vr.classified[0].bypass, false);
  assert.equal(vr.classified[0].ac65Authorized, false);

  const vv = checkDirectCommits([{ ...real, action: "commit" }], []);
  assert.equal(vv.violations.length, 1, "非入表真直投仍红");
  assert.equal(vv.violations[0].bypass, true);
});

test("AC2 回放·真实 git — b67a91cf（manager 委托 outer 写 README）分类 ruledHistorical，非 bypass 非 ac65Authorized", (t) => {
  const d = realCommitData("b67a91cf");
  if (!d) {
    t.skip("样本 sha 不在本 repo（b67a91cf）——真实 git 回放跳过，fixture 回放仍覆盖");
    return;
  }
  assert.ok(d.files.includes("README.md"), "b67a91cf 真提交触及 README.md");
  const v = checkDirectCommits([{ ...d, action: "commit" }], []);
  assert.equal(v.violations.length, 0, `b67a91cf（ruled 豁免）必须不再误标: ${JSON.stringify(v.classified.map((c) => ({ sha: c.sha.slice(0, 8), bypass: c.bypass, ac65: c.ac65Authorized, ruled: c.ruledHistorical })))}`);
  assert.equal(v.classified[0].ruledHistorical, true, "b67a91cf 命中 ruled 表 ⇒ ruledHistorical（AC2 快修）");
  assert.equal(v.classified[0].bypass, false, "b67a91cf 非 bypass（AC2）");
  assert.equal(v.classified[0].ac65Authorized, false, "ruled 豁免是独立分类，非 ac65Authorized（AC2）");
});

test("AC3 回放·CLI — 8e024f88 exit 0（ruledHistorical，非 bypass 非 ac65Authorized）；7d1d5d2e exit 1（真直投仍红）；混合只红真直投", (t) => {
  if (!realCommitData("8e024f88") || !realCommitData("7d1d5d2e")) {
    t.skip("样本 sha 不在本 repo——CLI 回放跳过");
    return;
  }
  const rRuled = runChecker(["--root", REPO_ROOT, "--commits", "8e024f88"]);
  assert.equal(rRuled.status, 0, `8e024f88（ruled 豁免）必须 GREEN(exit 0): ${rRuled.stdout}${rRuled.stderr}`);
  const outRuled = jsonOut(rRuled);
  assert.equal(outRuled.ok, true);
  assert.equal(outRuled.candidates[0].ruledHistorical, true);
  assert.equal(outRuled.candidates[0].confirmedBypass, false);
  assert.equal(outRuled.candidates[0].ac65Authorized, false);
  assert.equal(outRuled.denominator.ruledHistoricalCommits, 1);
  assert.ok(typeof outRuled.candidates[0].ruledReason === "string" && outRuled.candidates[0].ruledReason.length > 0, "ruledReason 可见");

  const rReal = runChecker(["--root", REPO_ROOT, "--commits", "7d1d5d2e"]);
  assert.equal(rReal.status, 1, `非入表真直投必须仍 RED(exit 1): ${rReal.stdout}${rReal.stderr}`);
  assert.equal(jsonOut(rReal).candidates[0].ruledHistorical, false);

  const rMixed = runChecker(["--root", REPO_ROOT, "--commits", "8e024f88,7d1d5d2e"]);
  assert.equal(rMixed.status, 1, `混合含真直投 ⇒ 仍 RED(exit 1): ${rMixed.stdout}${rMixed.stderr}`);
  const outMixed = jsonOut(rMixed);
  const bySha = Object.fromEntries(outMixed.candidates.map((c) => [c.sha.slice(0, 8), c]));
  assert.equal(bySha["8e024f88"].ruledHistorical, true);
  assert.equal(bySha["8e024f88"].confirmedBypass, false);
  assert.equal(bySha["8e024f88"].ac65Authorized, false);
  assert.equal(bySha["7d1d5d2e"].ruledHistorical, false);
  assert.equal(bySha["7d1d5d2e"].confirmedBypass, true);
});

test("AC2 回放·CLI — b67a91cf exit 0（ruledHistorical 可见 + README.md 设计内）", (t) => {
  if (!realCommitData("b67a91cf")) {
    t.skip("样本 sha 不在本 repo——CLI 回放跳过");
    return;
  }
  const r = runChecker(["--root", REPO_ROOT, "--commits", "b67a91cf"]);
  assert.equal(r.status, 0, `b67a91cf（ruled 豁免 + README.md 设计内）必须 GREEN(exit 0): ${r.stdout}${r.stderr}`);
  const out = jsonOut(r);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
  assert.equal(out.denominator.ruledHistoricalCommits, 1, "b67a91cf 计入 ruledHistorical（AC2 快修可见）");
  assert.equal(out.denominator.codeSurfaceCommits, 0, "README.md 设计内 ⇒ 非代码面（AC1 根修）");
});

// ── releaseBump 结构分类（tasks/gap-ac194-release-bump-classified-as-bypass）───────────────────────
// SPEC §4.3/§12 的 release-cut step-5「下一版 bump」**按设计直落 develop**（release-cut.mjs:514-524），
// 而本检测器把任何非 design-internal 直投一律判 bypass ⇒ 每次切版 AC-194 变假（第四次同一形态；前三次靠
// 人手往 ruled 表加一行吸收）。修法 = **谓词式**结构分类（⛔ 非 sha 表）：subject 模板 ∧ cut-ledger 直接
// 子提交 ∧ 版本载体集子集。钉子：生产形态 ⇒ releaseBump（非 bypass）；负控（同 subject 夹带载体外
// code-surface 文件）⇒ 仍 bypass。
// **变异检验**（AC5）：把谓词临时改回「只匹配 subject 字符串」（丢掉 ②/③）⇒ 下面的负控断言必须变红。

const RELEASE_BUMP_SUBJECT =
  "release: bump version to 0.14.0 after v0.13.0 (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)";
const RELEASE_BUMP_CUT_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
/** 载体集 fixture —— 与 `scripts/version-carriers.ts` 的 versionBearingPaths() 同形（10 载体 + 源）。
 *  ⛔ 这里是**测试 fixture**不是生产清单：生产路径由单源表派生（见 CLI releaseBump sources 读数）。 */
const RELEASE_BUMP_CARRIERS = new Set([
  "VERSION",
  "delivery-manifest.json",
  "package-lock.json",
  "packages/quay/package.json",
  "packages/quay-native/package.json",
  "packages/quay-github/package.json",
  "packages/quay-backlog/package.json",
  "plugin/.claude-plugin/plugin.json",
  "plugin/README.md",
  "plugin/VERSION",
  "plugin/vendor/quay/package.json",
]);
const RELEASE_BUMP_CTX = { carrierPaths: RELEASE_BUMP_CARRIERS, cutParents: new Set([RELEASE_BUMP_CUT_SHA]) };

test("PURE RELEASE_BUMP_SUBJECT_RE — 命中生成器唯一模板；近似形不命中（只认字面模板）", () => {
  assert.equal(RELEASE_BUMP_SUBJECT_RE.test(RELEASE_BUMP_SUBJECT), true);
  assert.equal(
    RELEASE_BUMP_SUBJECT_RE.test("release: bump version to 0.14.0-dev after v0.13.0 (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)"),
    true,
    "可选 prerelease 后缀被容忍（生成器未来小改动不绊倒）",
  );
  assert.equal(RELEASE_BUMP_SUBJECT_RE.test("release: bump version"), false);
  assert.equal(RELEASE_BUMP_SUBJECT_RE.test(`${RELEASE_BUMP_SUBJECT} and more`), false, "整串锚定（尾随内容不放过）");
  assert.equal(RELEASE_BUMP_SUBJECT_RE.test("release: bump version to 0.14.0 after 0.13.0 (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)"), false, "tag 缺 v 前缀");
});

test("PURE extractCutParents — 只认 form:'cut' ∧ base 匹配；其余 form / 他 base / 非法 sha 形状都排除", () => {
  const events = [
    { form: "cut", base: "develop", sha: "a71a7b816d32aa8f632dd8eaa189722633ac18b6" },
    { form: "merged", base: "develop", sha: "7d10a1d2d287820fa970c7c4c9a23e0775a44664" },
    { form: "tagged", base: "develop", sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    { form: "cut", base: "master", sha: "cccccccccccccccccccccccccccccccccccccccc" },
    { form: "cut", base: "develop", sha: "not-a-sha" },
    { form: "refused-no-license", base: "develop", sha: "3f470613bfeb9edb65f36251ecf05c95e4b5c165" },
  ];
  const s = extractCutParents(events, "develop");
  assert.deepEqual([...s], ["a71a7b816d32aa8f632dd8eaa189722633ac18b6"], "只有唯一一条合法 cut 记录入选");
  assert.equal(extractCutParents(null, "develop").size, 0);
});

test("PURE classifyReleaseBumpCommit — 三谓词合取；第三态（来源读不出 ⇒ null，⛔ 不与 false 同形）", () => {
  const prod = { subject: RELEASE_BUMP_SUBJECT, files: ["VERSION", "plugin/VERSION"], parent: RELEASE_BUMP_CUT_SHA };
  const r = classifyReleaseBumpCommit(prod, RELEASE_BUMP_CTX);
  assert.equal(r.releaseBump, true);
  assert.equal(r.subjectMatches, true);
  assert.equal(r.cutParentMatches, true);
  assert.equal(r.carrierSubset, true);
  assert.deepEqual(r.offCarrierFiles, []);

  // 谓词③假：同 subject，但夹带一个载体外 code-surface 文件 ⇒ releaseBump=false（负控，仍 bypass）。
  const neg = classifyReleaseBumpCommit(
    { subject: RELEASE_BUMP_SUBJECT, files: ["VERSION", "plugin/scripts/x.ts"], parent: RELEASE_BUMP_CUT_SHA },
    RELEASE_BUMP_CTX,
  );
  assert.equal(neg.releaseBump, false);
  assert.equal(neg.carrierSubset, false);
  assert.deepEqual(neg.offCarrierFiles, ["plugin/scripts/x.ts"]);

  // 谓词①假：subject 不是生成器模板。
  assert.equal(
    classifyReleaseBumpCommit({ subject: "release: bump version to 0.14.0", files: ["VERSION"], parent: RELEASE_BUMP_CUT_SHA }, RELEASE_BUMP_CTX).releaseBump,
    false,
  );
  // 谓词②假：parent 不命中 cut-ledger（含 null）。
  assert.equal(
    classifyReleaseBumpCommit({ subject: RELEASE_BUMP_SUBJECT, files: ["VERSION"], parent: "f".repeat(40) }, RELEASE_BUMP_CTX).releaseBump,
    false,
  );
  assert.equal(
    classifyReleaseBumpCommit({ subject: RELEASE_BUMP_SUBJECT, files: ["VERSION"], parent: null }, RELEASE_BUMP_CTX).releaseBump,
    false,
  );
  // design-internal 文件不需要载体成员资格（谓词③只看 code-surface）。
  assert.equal(
    classifyReleaseBumpCommit({ subject: RELEASE_BUMP_SUBJECT, files: ["VERSION", "tasks/x.md"], parent: RELEASE_BUMP_CUT_SHA }, RELEASE_BUMP_CTX).releaseBump,
    true,
  );

  // 第三态（硬规则 3b）：任一条来源读不出 ⇒ null（⛔ 不与 false 同形）。
  assert.equal(classifyReleaseBumpCommit(prod, { carrierPaths: null, cutParents: new Set([RELEASE_BUMP_CUT_SHA]) }).releaseBump, null);
  assert.equal(classifyReleaseBumpCommit(prod, { carrierPaths: RELEASE_BUMP_CARRIERS, cutParents: null }).releaseBump, null);
  assert.equal(classifyReleaseBumpCommit(prod, undefined).releaseBump, null);
  assert.equal(classifyReleaseBumpCommit(prod, {}).releaseBump, null);
});

test("PURE classifyCommit/checkDirectCommits — releaseBump ⇒ 非 bypass 且计入 releaseBumpCommits；负控仍 bypass", () => {
  const prodCommit = { sha: "rel1", subject: RELEASE_BUMP_SUBJECT, files: ["VERSION", "plugin/VERSION"], epoch: 1, action: "commit", parent: RELEASE_BUMP_CUT_SHA };
  const negCommit = { sha: "neg1", subject: RELEASE_BUMP_SUBJECT, files: ["VERSION", "plugin/scripts/x.ts"], epoch: 1, action: "commit", parent: RELEASE_BUMP_CUT_SHA };

  const prod = classifyCommit(prodCommit, [], RELEASE_BUMP_CTX);
  assert.equal(prod.releaseBump, true);
  assert.equal(prod.bypass, false, "release bump 不再是 bypass");

  const neg = classifyCommit(negCommit, [], RELEASE_BUMP_CTX);
  assert.equal(neg.releaseBump, false);
  assert.equal(neg.bypass, true, "夹带载体外 code-surface 文件 ⇒ 仍 RED");

  const v = checkDirectCommits([prodCommit, negCommit], [], RELEASE_BUMP_CTX);
  assert.equal(v.releaseBumpCommits, 1);
  assert.equal(v.violations.length, 1);
  assert.equal(v.violations[0].sha, "neg1");

  // 未评估：无 ctx（来源读不出）⇒ releaseBump=null，bypass 仍真（fail-closed），独立计数。
  const vNoCtx = checkDirectCommits([{ sha: "rel2", subject: RELEASE_BUMP_SUBJECT, files: ["VERSION"], epoch: 1 }], []);
  assert.equal(vNoCtx.classified[0].releaseBump, null);
  assert.equal(vNoCtx.classified[0].bypass, true, "未评估仍 fail-closed（bypass 真）");
  assert.equal(vNoCtx.releaseBumpCommits, 0);
  assert.equal(vNoCtx.releaseBumpNotEvaluatedCommits, 1);
});

test("CLI releaseBump — 生产形态（subject 模板 + cut-ledger parent + 载体集子集）⇒ exit 0 且 RELEASE-BUMP 可见", () => {
  const dir = makeTmp("relbump");
  try {
    initRepo(dir);
    const parent = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    // cut-ledger：一条 form:"cut" ∧ base:"develop" 记录，sha = bump 的父提交（切版落地 commit）。
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".quay", "release-branch-finish.jsonl"),
      JSON.stringify({
        ts: "2026-10-01T05:33:00Z", branch: "release/v0.13.0", sha: parent, form: "cut", tag: "v0.13.0",
        base: "develop", result: "deleted-local", remote_result: "remote-already-clean", exit: 0,
      }) + "\n",
      "utf8",
    );
    // 下一版 bump：只触及版本载体（源 VERSION + plugin/VERSION）。
    fs.writeFileSync(path.join(dir, "VERSION"), "0.14.0\n", "utf8");
    fs.mkdirSync(path.join(dir, "plugin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "VERSION"), "0.14.0\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCommitFixed(dir, FIXED_PAST, RELEASE_BUMP_SUBJECT);

    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 0, `release bump 必须 GREEN(exit 0): ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.ok, true);
    assert.equal(out.reason, "release-bump-direct-commits-only");
    assert.equal(out.denominator.releaseBumpCommits, 1);
    assert.equal(out.denominator.releaseBumpNotEvaluatedCommits, 0);
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].releaseBump, true);
    assert.equal(out.candidates[0].confirmedBypass, false);
    assert.deepEqual(out.candidates[0].releaseBumpEvidence, {
      subjectMatches: true, cutParentMatches: true, carrierSubset: true, offCarrierFiles: [], notEvaluated: false,
    });
    assert.equal(out.releaseBump.evaluated, true, "两条来源都可读 ⇒ releaseBump 可评估");
    assert.ok(out.releaseBump.carrierPaths >= 10, `载体集由单源表派生（≥10 条）: ${out.releaseBump.carrierPaths}`);
    assert.equal(out.releaseBump.cutParents, 1);
  } finally {
    cleanup(dir);
  }
});

test("CLI releaseBump 负控 — 同 subject 夹带载体外 code-surface 文件 ⇒ 仍 exit 1 direct-commit-bypasses-fan-in", () => {
  const dir = makeTmp("relbumpneg");
  try {
    initRepo(dir);
    const parent = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".quay", "release-branch-finish.jsonl"),
      JSON.stringify({ ts: "2026-10-01T05:33:00Z", branch: "release/v0.13.0", sha: parent, form: "cut", tag: "v0.13.0", base: "develop", result: "deleted-local", remote_result: "remote-already-clean", exit: 0 }) + "\n",
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "VERSION"), "0.14.0\n", "utf8");
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "scripts", "bad.ts"), "export const bad = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCommitFixed(dir, FIXED_PAST, RELEASE_BUMP_SUBJECT);

    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 1, `同 subject 夹带载体外文件必须仍 RED(exit 1): ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.reason, "direct-commit-bypasses-fan-in");
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].releaseBump, false, "谓词③假 ⇒ 不是 releaseBump");
    assert.equal(out.candidates[0].confirmedBypass, true);
    assert.deepEqual(out.candidates[0].releaseBumpEvidence.offCarrierFiles, ["plugin/scripts/bad.ts"]);
  } finally {
    cleanup(dir);
  }
});

test("CLI releaseBump — ledger 缺席 ⇒ releaseBump 未评估（null，独立第三态）且真直投仍 RED", () => {
  const dir = makeTmp("relbumpne");
  try {
    initRepo(dir);
    // ⛔ 不写 cut-ledger：cutParents 读不出 ⇒ releaseBump=null；即使 subject 与文件都像 bump，仍 fail-closed。
    fs.writeFileSync(path.join(dir, "VERSION"), "0.14.0\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCommitFixed(dir, FIXED_PAST, RELEASE_BUMP_SUBJECT);

    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 1, `来源读不出 ⇒ 不得洗成合格: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.reason, "direct-commit-bypasses-fan-in");
    assert.equal(out.candidates[0].releaseBump, null, "第三态：未评估（⛔ 不与 false 同形）");
    assert.equal(out.candidates[0].confirmedBypass, true);
    assert.equal(out.denominator.releaseBumpNotEvaluatedCommits, 1);
  } finally {
    cleanup(dir);
  }
});

test("AC3 回放·CLI — 全量扫描（生产基线 b11ce720）NOT-EVALUATED：reflog 被 gc 剪 ⇒ 不伪装成「未发现 direct」", (t) => {
  // gap-direct-to-develop-check-reflog-to-revlist：reflog 被 gc 全局剪后，基线区间内 ~1600 条 commit
  // 既不在 ledger（fan-in-landed 记录，本任务起才落）也不在 reflog ⇒ unclassifiable ⇒ NOT-EVALUATED。
  // ⛔ 旧行为（ok=true, evaluated=true, "no-code-surface-direct-commits"）正是「伪装成未发现 direct」。
  // gap-bypass-check-unclassifiable-exits-zero：evaluated:false 退出码由 0 改 3（NOT-EVALUATED），
  // ⛔ 不再与 PASS 共用 exit 0——否则只看退出码的 run_checker 把「读不懂」读成「合格」。
  const baseline = "b11ce720";
  const baseExists = gitCmd(REPO_ROOT, "cat-file", "-e", `${baseline}^{commit}`).status === 0;
  if (!baseExists) {
    t.skip("基线 sha 不在本 repo——全量扫描跳过");
    return;
  }
  const r = runChecker(["--root", REPO_ROOT, "--baseline", baseline]);
  assert.equal(r.status, 3, `NOT-EVALUATED 必须 exit 3（⛔ 不再是 exit 0）: ${r.stdout}${r.stderr}`);
  const out = jsonOut(r);
  assert.equal(out.evaluated, false, "reflog 剪后必须 NOT-EVALUATED（⛔ 不伪装成「未发现 direct」）");
  assert.equal(out.ok, true, "NOT-EVALUATED 不是 RED");
  // reason 是**双通道**（gap-ac194-reflog-action-vocabulary-incomplete AC2）：
  //   · 计数形态 `unclassifiable-commits-in-range` —— 不可分类的 commit 在 reflog 里【根本没有条目】（被 gc 剪）；
  //   · 具名形态 `unsupported-reflog-action: <form>` —— 有 reflog 条目但 action 形读不懂；此时计数形态作为
  //     **并列信息**保留在 `reasonSecondary`（检查器逐字承诺「既有 reason 作为并列信息保留」）。
  // ⛔ 两种形态都不得被钉死：本用例扫的是**实时 repo**，reason 取值取决于本 checkout 的 reflog 是否含读不懂的形。
  //    本仓实测已出现（2026-10-10）：`plugin/scripts/integration-batch-merge.ts:1165` 用**裸 `git update-ref`
  //    （无 -m）**做 develop 的 ref-level CAS 落地 ⇒ 该条 reflog 消息为空 ⇒ form = `(empty)` ⇒ 具名形态。
  //    把本行收窄成计数形态会让用例在 reflog 演化时【假红】——正是它挡下了当日所有代码落地（硬规则 4b：
  //    reason 是 reflog 状态的代理量，不是检查器的性质）。两种形态都仍是 NOT-EVALUATED（exit 3 /
  //    evaluated:false，见上），本用例的主张（不伪装成「未发现 direct」）不受影响。
  const NAMED_FORM_RE = /^unsupported-reflog-action: /;
  assert.ok(
    out.reason === "unclassifiable-commits-in-range" || NAMED_FORM_RE.test(out.reason ?? ""),
    `reason 必须是计数形态或具名形态（实际 ${JSON.stringify(out.reason)}）`,
  );
  if (NAMED_FORM_RE.test(out.reason ?? "")) {
    assert.equal(
      out.reasonSecondary,
      "unclassifiable-commits-in-range",
      "具名时计数形态必须在 reasonSecondary 上保留（并列信息，⛔ 不丢）",
    );
    assert.ok(out.classification.unclassifiedActionForms.length > 0, "具名 ⇔ 至少一个 action 形被点名");
  }
  assert.ok(out.unclassifiableCommits > 0, "基线区间内存在 ledger 无记录且 reflog 也查不到的 commit");
  assert.ok(out.denominator.unclassifiableCommits > 0, "denominator 同步暴露 unclassifiable 计数");
  // AC4：分类覆盖率可读数——classified/total/ratio。⚠️ 下界是【检出 reflog 深度】的代理量，不是
  // 检查器的性质（硬规则 4b）：基线区间 ~5376 条 commit 里能分类的条数，取决于本检出的 reflog
  // 是否还记得它们。实测（`git init` + fetch 单 ref + `checkout -B`，即 actions/checkout@v4 的
  // 机制）：区间 5376 条中**恰好 1 条**可分类（ratio 0.019%），而 CI 的 checkout 机制把它压到 0
  // ⇒ 原断言 `ratio > 0` 在全新 checkout 上恒假（Class D 的失败根因：`部分可分类 ⇒ 0 < ratio < 1`）。
  // 本测试的**主张**是「reflog 被剪 ⇒ NOT-EVALUATED，不伪装成『未发现 direct』」，由上方的
  // exit 3 / evaluated:false / reason / unclassifiable>0 / ratio<1 与下面的结构一致性完整覆盖。
  // 故：检出带生产状态（fan-in ledger 在场 ⇒ reflog/ledger 有东西可分类）时保留原强度 `ratio > 0`；
  // 全新 checkout 上只保留真正的判据 `ratio < 1`（= 并非全部可分类 ⇒ NOT-EVALUATED 是真被举起）。
  assert.equal(typeof out.classification, "object", "输出必须带 classification 对象");
  assert.ok(out.classification.total > 0, "total 为 rev-list 命中条数");
  assert.equal(out.classification.classified, out.classification.total - out.unclassifiableCommits, "classified = total − unclassifiable");
  assert.ok(out.classification.ratio < 1, "并非全部可分类 ⇒ NOT-EVALUATED 不是伪装的 PASS");
  const hasProductionState = fs.existsSync(path.join(REPO_ROOT, ".quay", "fan-in-merge-lock-events.jsonl"));
  if (hasProductionState) {
    assert.ok(out.classification.ratio > 0, "生产状态下部分可分类 ⇒ 0 < ratio（检出带 ledger/reflog 材料时才可判）");
  }
  assert.equal(out.denominator.totalScannedCommits, out.classification.total, "denominator 同步 totalScannedCommits");
  assert.equal(out.denominator.classifiedCommits, out.classification.classified, "denominator 同步 classifiedCommits");
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
  if (_COST_TIMING) _gitSpawns++;
  return spawnSync("git", ["-C", cwd, "commit", "-q", "-m", message], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

// AC2 (gap-direct-to-develop-bypass-check-git-fixture-cost): the two small "base repo" builders below
// are identical on every call and are only a PRECONDITION — each test's subject is what the checker
// concludes about commits laid on top of the base, never how the base was built. So the base is built
// ONCE per file run and every test cpSync's a PRIVATE copy (independent .git, no cross-test state, no
// execution-order property), matching the AC2 "before() builds one base; each test forks a variant"
// pattern without touching any assertion. Source: measured — a fresh initRepo is ~20ms of subprocess,
// a cpSync of the 2-commit base ~0.8ms (see the task body's Measured section).
const _BASES = new Map();
function sharedBase(kind, build) {
  let d = _BASES.get(kind);
  if (!d) {
    d = makeTmp(kind);
    build(d);
    // The shared base lives in os.tmpdir(); reap it at process exit (tests only clean their own copies).
    process.on("exit", () => cleanup(d));
    _BASES.set(kind, d);
  }
  return d;
}

function initRepoInto(dir) {
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

function initRepo(dir) {
  fs.cpSync(sharedBase("d2d-initbase", initRepoInto), dir, { recursive: true });
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

test("CLI — 锁事件不成对（release 无 acquire）⇒ NOT-EVALUATED（exit 3，evaluated:false——3b）", () => {
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
    assert.equal(r.status, 3, `锁事件不成对 ⇒ NOT-EVALUATED，必须 exit 3（不得红也不得假装绿）`);
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

// ── 三态判定（gap-direct-to-develop-check-reflog-to-revlist）────────────────────────────────────────
// ledger（fan-in-landed 记录）优先 → reflog 回退 → NOT-EVALUATED。reflog 会被 gc 剪，ledger 不剪。

test("PURE extractFanInLandedShas — 只提取 release 事件的 landedSha hex sha；acquire/null/malformed 跳过", () => {
  const shas = extractFanInLandedShas([
    { event: "acquire", epoch: 1, taskId: "t", pid: 1 },
    { event: "release", epoch: 2, taskId: "t", pid: 1, landedSha: "9a074ff16887416540eab7c99e2dbb4e5767a89f" },
    { event: "release", epoch: 3, taskId: "t2", pid: 2, landedSha: "90329c7d" }, // 短 sha 也认（前缀）
    { event: "release", epoch: 4, taskId: "t3", pid: 3, landedSha: null }, // 失败 ff ⇒ null 跳过
    { event: "release", epoch: 5, taskId: "t4", pid: 4 }, // 无 landedSha（历史 release）⇒ 跳过
    { event: "release", epoch: 6, taskId: "t5", pid: 5, landedSha: "not-a-sha" }, // 非 hex ⇒ 跳过
    { __unparseable: true },
    null,
  ]);
  assert.equal(shas.size, 2, "只认 release 事件的 hex landedSha");
  assert.ok(shas.has("9a074ff16887416540eab7c99e2dbb4e5767a89f"));
  assert.ok(shas.has("90329c7d"));
  assert.equal(extractFanInLandedShas(null).size, 0, "null ⇒ 空集");
  assert.equal(extractFanInLandedShas(undefined).size, 0, "undefined ⇒ 空集");
});

test("PURE isReflogDirectCommit — commit:/commit (amend): 是直接提交；merge … Fast-forward 不是", () => {
  assert.equal(isReflogDirectCommit("commit: tasks: 立案 x"), true);
  assert.equal(isReflogDirectCommit("commit (amend): fixed subject"), true);
  assert.equal(isReflogDirectCommit("commit (merge): merged"), true);
  assert.equal(isReflogDirectCommit("merge task/gap-x: Fast-forward"), false, "fan-in ff 不是直接提交");
  assert.equal(isReflogDirectCommit("reset: moving to HEAD~1"), false);
  assert.equal(isReflogDirectCommit("rebase (finish): returning to refs/heads/develop"), false);
  assert.equal(isReflogDirectCommit(""), false);
  assert.equal(isReflogDirectCommit(null), false);
});

test("PURE buildReflogIndex — direct/seen 分离；commit 优先于 merge 条目", () => {
  const idx = buildReflogIndex([
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tcommit: direct a",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tmerge task/x: Fast-forward",
    "cccccccccccccccccccccccccccccccccccccccc\tcommit: direct c",
  ]);
  assert.ok(idx.direct.has("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.ok(idx.direct.has("cccccccccccccccccccccccccccccccccccccccc"));
  assert.ok(!idx.direct.has("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "merge 条目不是 direct");
  assert.ok(idx.seen.has("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "merge 条目在 seen");
  // 一条 sha 同时有 commit 与 merge 条目 ⇒ direct 优先（reset-reapply 形态）。
  const idx2 = buildReflogIndex([
    "dddddddddddddddddddddddddddddddddddddddd\tmerge task/x: Fast-forward",
    "dddddddddddddddddddddddddddddddddddddddd\tcommit: direct d",
  ]);
  assert.ok(idx2.direct.has("dddddddddddddddddddddddddddddddddddddddd"));
});

test("PURE classifyLandingMode — ledger ⇒ fan-in；reflog direct ⇒ direct；reflog seen ⇒ fan-in；两者皆无 ⇒ unclassifiable", () => {
  const ledger = new Set(["ledgersha1"]);
  const reflog = buildReflogIndex([
    "directsha1\tcommit: direct",
    "ffsha1\tmerge task/x: Fast-forward",
  ]);
  assert.equal(classifyLandingMode("ledgersha1", ledger, reflog), "fan-in", "在 ledger ⇒ fan-in");
  assert.equal(classifyLandingMode("directsha1", ledger, reflog), "direct", "reflog commit ⇒ direct");
  assert.equal(classifyLandingMode("ffsha1", ledger, reflog), "fan-in", "reflog merge … Fast-forward ⇒ fan-in");
  assert.equal(classifyLandingMode("unknownsha1", ledger, reflog), "unclassifiable", "ledger 无且 reflog 无 ⇒ unclassifiable");
  assert.equal(classifyLandingMode("directsha1", ledger, null), "unclassifiable", "reflog 不可读 ⇒ unclassifiable");
  assert.equal(classifyLandingMode("ledgersha1", ledger, null), "fan-in", "ledger 优先于 reflog 不可读");
});

// ── gap-ac194 括注分类（first-parent 扫描 + reflog 括注）──────────────────────────────────────────
// 缺陷（gap-ac194-bypass-check-unclassifiable-window）：ff-merge 只在 reflog 记 tip（`git push .` /
// `git merge --ff-only`），分支上被并入的中间 commit 无独立 reflog 条目 ⇒ 三态分类里大量 spine commit
// 落进 unclassifiable ⇒ AC-194 `expect: exit 0` 结构上不可达。修法：只扫 first-parent spine（off-spine
// 结构上非直投），对 spine 上无 reflog 条目的中间 commit 用 fan-in 括注 [P, T] 判 fan-in delivered。

// ── 落地词汇表按结构判定（gap-ac194-reflog-action-vocabulary-incomplete）───────────────────────────
// 缺陷：旧 `isReflogFanIn` 是**拼法白名单**（`push` | `/Fast-forward/`）。生产出现第三种落地拼法
// `branch: Reset to HEAD`（`git branch -f develop <t>`）⇒ 落在 unclassifiable ⇒ 硬规则③b fail-closed
// ⇒ AC-194 `expect: exit 0` 结构上不可达。旧断言 `isReflogFanIn("reset: moving to HEAD~1")===false`
// 逐字钉住旧词汇——对「生产会写出第三种拼法」结构上不可能发现（硬规则④推论三：只能被 fixture 满足的
// 判据不是测量）。⇒ 改为按结构判定 + 逐条钉住**探针实测原文**（⛔ 无凭记忆字面量）。

test("PURE classifyReflogAction — 结构判定：commit 前缀 ⇒ direct；把 ref 移到已存在 commit 的形 ⇒ refMove；其余 ⇒ unknown", () => {
  // direct：在 develop 上**创建** commit（探针实测原文，git 2.43.0）
  assert.equal(classifyReflogAction("commit: direct"), "direct");
  assert.equal(classifyReflogAction("commit (initial): c1"), "direct");
  assert.equal(classifyReflogAction("commit (amend): x"), "direct");
  assert.equal(classifyReflogAction("commit (merge): Merge made by the 'ort' strategy."), "direct");
  // refMove：把 ref 移到**已存在的** commit —— 六种实测拼法，全部落同一边，⛔ 不是白名单
  assert.equal(classifyReflogAction("push"), "refMove", "git push . <src>:<dst>");
  assert.equal(classifyReflogAction("merge task/gap-x: Fast-forward"), "refMove", "git merge --ff-only <b>");
  assert.equal(classifyReflogAction("merge author: Fast-forward"), "refMove");
  assert.equal(classifyReflogAction("branch: Reset to HEAD"), "refMove", "git branch -f <已存在 b> HEAD（本任务的生产拼法）");
  assert.equal(classifyReflogAction("branch: Reset to 4c789a55dced9a1561115054efc63172a9216fc8"), "refMove", "git branch -f <已存在 b> <sha>（实测原文：git 保留命令行传入的字面量）");
  assert.equal(classifyReflogAction("branch: Created from HEAD"), "refMove", "git branch <新 b> <target> ⇒ 也只是指向已存在 commit");
  assert.equal(classifyReflogAction("reset: moving to 4f731764c5f394f5cc465b3f84053abeda3b7c48"), "refMove", "git reset --hard <sha>（b 已检出）");
  assert.equal(classifyReflogAction("fetch -q . f21c1721852fdd7857dbd7e4e354822d9d56061e:refs/heads/dst2: storing ref"), "refMove", "git fetch . <src>:<dst>");
  // sanctionedRefMove：**本仓自己的落地通道**声明的保留前缀（第五次变假）。⛔ 不是 git 的 action 词——
  // 是本仓生产者写的保留命名空间，负控见下（空 / 任意其它 -m 文本仍 unknown）。
  assert.equal(classifyReflogAction("quay-ref-landing: fast-forward 1111111111111111111111111111111111111111 -> 2222222222222222222222222222222222222222"), "sanctionedRefMove", "integration-batch-merge ff CAS");
  assert.equal(classifyReflogAction("quay-ref-landing: real-merge a -> b"), "sanctionedRefMove", "integration-batch-merge real-merge CAS");
  assert.equal(classifyReflogAction("quay-ref-landing: downsync fast-forward"), "sanctionedRefMove", "sync-lag-check.sh downsync CAS");
  // unknown：读不懂的形 ⇒ fail-closed（⛔ 不与合格同形，硬规则③b）
  assert.equal(classifyReflogAction("rebase (finish): returning to refs/heads/develop"), "unknown");
  assert.equal(classifyReflogAction("checkout: moving from x to develop"), "unknown");
  assert.equal(classifyReflogAction("merge side: Merge made by the 'ort' strategy."), "unknown", "非 ff merge **创建**了 merge commit，但 action 形读不懂 ⇒ unknown（fail-closed，⛔ 不洗成 refMove）");
  assert.equal(classifyReflogAction("bogus-action-form"), "unknown", "任意 update-ref -m 文本（无 `前缀: rest` 形）");
  assert.equal(classifyReflogAction(""), "unknown", "git update-ref 无 -m ⇒ 空 gs");
  // 负控（第五次变假 AC5）：保留前缀**不得**退化成「任何 -m 都放行」——只认那个具体前缀 ∧ 其余非空。
  assert.equal(classifyReflogAction("quay-ref-landing"), "unknown", "只有前缀、无 `:` ⇒ ⛔ 不得放行");
  assert.equal(classifyReflogAction("quay-ref-landing:"), "unknown", "前缀后其余为空 ⇒ ⛔ 不得放行");
  assert.equal(classifyReflogAction("mutation-unknown-form"), "unknown", "任意其它 -m 文本 ⇒ 仍 unknown（负控核心）");
  assert.equal(classifyReflogAction("Quay-Ref-Landing: x"), "unknown", "大小写不同 ⇒ 不认（保留前缀是精确的）");
  assert.equal(classifyReflogAction("xquay-ref-landing: y"), "unknown", "前缀不在整串开头 ⇒ 不认");
  assert.equal(classifyReflogAction(null), "unknown");
  assert.equal(classifyReflogAction(undefined), "unknown");
});

// ── fetch 形的钉子（gap-ac194-production-criterion-owner AC3/AC5）──────────────────────────────────
// 缺口（本任务的**唯一活口**）：上一条测试对 fetch 只有**一条**断言（`: storing ref` 那行，原文在
// gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check 立案时就在），而那是**一种后缀拼法**。
// ⇒ 把 fetch 分支改回 `/^fetch\b/ && /: storing ref\s*$/`（拼法白名单），本文件**没有任何测试变红**——
// 「第 6 次拼法变更」没有载体（硬规则 9：可见性 ≠ 执行，该给它造产物，而不是把规则写得更醒目）。
// 下面两类读数就是那个产物，缺一不可：
//   (a) 【生产真实形态】`fetch -q . author:develop: fast-forward`。⛔ 不是构造的字符串——本仓 develop
//       **真实 reflog** 里逐字有它（本任务实测：`git reflog show develop --format='%gd|%h|%gs'` ⇒
//       `develop@{225}|6de94b9e4|fetch -q . author:develop: fast-forward`；同形另有
//       `fetch -q . memorymax-16g:develop: fast-forward` / `fetch -q . chore/quay-dev-marketplace:develop:
//       fast-forward` / `fetch . spec-ctx-on-develop:develop: fast-forward`——三种 src 名、含非 `-q` 拼法）。
//   (b) 【词表外后缀】`pruned`。实测**不在** git 2.43.0 的 fetch reflog 词表内：`strings $(command -v git)`
//       只有 `storing head` / `storing ref` / `storing tag` / `fast-forward` / `forced-update`，且
//       `git fetch --prune` 删除 ref 时**连同其 reflog 一起消失**（`.git/logs` 下不产生任何 `pruned` 行）
//       ⇒ 它是「判定与词表无关」的干净样本（词表内找一个样本证明不了与词表无关）。
// 后缀词表实测（git 2.43.0，本机探针仓库 `git fetch . <src>:<dst>` 逐条贴 %gs；⛔ 无凭记忆字面量）：
//   git fetch <r> <分支名>:<已存在 ref>（ff）    → `fetch -q <r> <src>:<ref>: fast-forward`   ← 生产形态
//   git fetch --force <r> <src>:<已存在 ref>     → `fetch -q --force <r> <src>:<ref>: forced-update`
//   git fetch <r> <分支名>:<新 ref>              → `fetch -q <r> <src>:refs/heads/<b>: storing head`
//   git fetch <r> <sha>:<新 ref>                 → `fetch -q <r> <sha>:refs/heads/<b>: storing ref`
// 判定按**结构**（action 词是 `fetch` ⇒ git-fetch 在本地从不创建 commit ⇒ 只能把 ref 指向一个已存在的
// 对象），与上表**无关**：表里没有的后缀（b）落同一边。⛔ 本测试**不**逐一枚举后缀（枚举正是在造下一个
// 白名单）；它只钉住「生产形态正确」与「后缀不在表内也正确」。

test("PURE classifyReflogAction — fetch 形按结构判定（钉子）：生产形态 `fetch -q . author:develop: fast-forward` 与词表外后缀 `pruned` 都 ⇒ refMove", () => {
  // (a) 生产真实形态（见上注：develop 真实 reflog 里的逐字条目）
  assert.equal(classifyReflogAction("fetch -q . author:develop: fast-forward"), "refMove",
    "生产形态 ⇒ refMove（旧判据要求 `: storing ref$` ⇒ 这条落 unknown ⇒ NOT-EVALUATED ⇒ AC-194 结构上不可达）");
  assert.equal(classifyReflogAction("fetch -q . chore/quay-dev-marketplace:develop: fast-forward"), "refMove", "同形、另一 src 名");
  assert.equal(classifyReflogAction("fetch . spec-ctx-on-develop:develop: fast-forward"), "refMove", "非 `-q` 拼法同形（⛔ 判定不看 `-q`）");
  // 词表内其余后缀（实测原文）——四种后缀全落同一边
  assert.equal(classifyReflogAction("fetch -q --force . author:develop: forced-update"), "refMove");
  assert.equal(classifyReflogAction("fetch -q . author:refs/heads/newb: storing head"), "refMove");
  assert.equal(classifyReflogAction("fetch -q . 17c89a07ed01e0d9d25074b101cf56d8e279d82a:refs/heads/dst: storing ref"), "refMove");
  // (b) 词表外后缀 ⇒ 仍 refMove（判定与词表无关；`pruned` 见上注：实测不在词表内）
  assert.equal(classifyReflogAction("fetch -q . author:develop: pruned"), "refMove",
    "词表外后缀必须仍 refMove——白名单对下一种后缀结构上不可能发现（这正是 `branch: Reset to HEAD` 破掉 AC-194 的方式）");
  assert.equal(classifyReflogAction("fetch -q . author:develop: suffix-nobody-enumerated"), "refMove", "任意未来后缀同形：判定不看后缀");
  // 负控制①：放宽 fetch **不得**把真直投洗成 refMove
  assert.equal(classifyReflogAction("commit: direct"), "direct", "fetch 分支放宽不得吞掉 `commit:` 形");
  // 负控制②：`\b` 词边界——`fetching` 不是 git 的 action 词，前缀相似不得被吞
  assert.equal(classifyReflogAction("fetching: nope"), "unknown", "前缀相似但不是 action 词 ⇒ 仍 fail-closed");
});

test("PURE reflogActionForm — 点名根因用的 action 形（取前缀；无前缀形取整串；空 ⇒ (empty)）", () => {
  assert.equal(reflogActionForm("reset: moving to HEAD~1"), "reset");
  assert.equal(reflogActionForm("branch: Reset to HEAD"), "branch");
  assert.equal(reflogActionForm("commit (amend): x"), "commit (amend)");
  assert.equal(reflogActionForm("bogus-action-form"), "bogus-action-form");
  assert.equal(reflogActionForm(""), "(empty)");
  assert.equal(reflogActionForm(null), "(empty)");
});

test("PURE isReflogDirectCommit 消费 classifyReflogAction（判定只留一份，⛔ 不再自持拼法谓词）", () => {
  assert.equal(isReflogDirectCommit("commit: direct"), true);
  assert.equal(isReflogDirectCommit("commit (merge): x"), true);
  assert.equal(isReflogDirectCommit("push"), false);
  assert.equal(isReflogDirectCommit("branch: Reset to HEAD"), false, "refMove 不是直投");
  assert.equal(isReflogDirectCommit("bogus-action-form"), false);
  assert.equal(isReflogDirectCommit(""), false);
  assert.equal(isReflogDirectCommit(null), false);
});

test("PURE buildRefMoveBrackets — refMoveTips + 括注对（T=tip, P=前一条更旧）；最老条目无前一条 ⇒ 不产括注", () => {
  const { refMoveTips, brackets } = buildRefMoveBrackets([
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tpush",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tmerge task/gap-x: Fast-forward",
    "cccccccccccccccccccccccccccccccccccccccc\tcommit: direct",
  ]);
  assert.ok(refMoveTips.has("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.ok(refMoveTips.has("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
  assert.ok(!refMoveTips.has("cccccccccccccccccccccccccccccccccccccccc"), "commit 不是 refMove tip");
  assert.equal(brackets.length, 2);
  assert.deepEqual(brackets[0], { T: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", P: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, "newest 括注 P=前一条（更旧）");
  assert.deepEqual(brackets[1], { T: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", P: "cccccccccccccccccccccccccccccccccccccccc" });
  // 第三种拼法（本任务的生产形态）也是 refMove tip——旧白名单在这里失明。
  const br = buildRefMoveBrackets([
    "dddddddddddddddddddddddddddddddddddddddd\tbranch: Reset to HEAD",
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\tpush",
  ]);
  assert.ok(br.refMoveTips.has("dddddddddddddddddddddddddddddddddddddddd"), "branch: Reset to 是 refMove tip（旧 isReflogFanIn 判 false）");
  assert.deepEqual(br.brackets[0], { T: "dddddddddddddddddddddddddddddddddddddddd", P: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" });
  // sanctionedRefMove（`quay-ref-landing: …`）：**分列**于 refMoveTips（⛔ 不并入——独立计数是 AC4 的读数），
  // 但**同样**产括注（带入窗内的中间 commit 也要被覆盖，否则它们落 unclassifiable）。
  const sc = buildRefMoveBrackets([
    "1111111111111111111111111111111111111111\tquay-ref-landing: fast-forward a -> b",
    "2222222222222222222222222222222222222222\tpush",
    "3333333333333333333333333333333333333333\tcommit: direct",
  ]);
  assert.ok(sc.sanctionedRefMoveTips.has("1111111111111111111111111111111111111111"), "保留前缀 ⇒ sanctionedRefMoveTips");
  assert.ok(!sc.refMoveTips.has("1111111111111111111111111111111111111111"), "⛔ sanctioned 不得并入 refMoveTips（分列是 AC4 的核心）");
  assert.ok(sc.refMoveTips.has("2222222222222222222222222222222222222222"), "git 自己的 action 词仍进 refMoveTips");
  assert.ok(!sc.sanctionedRefMoveTips.has("2222222222222222222222222222222222222222"), "⛔ refMove 不得混进 sanctionedRefMoveTips");
  assert.equal(sc.brackets.length, 2, "两类都产括注（覆盖判定同效）");
  assert.deepEqual(sc.brackets[0], { T: "1111111111111111111111111111111111111111", P: "2222222222222222222222222222222222222222" });
  // 负控：空 / 任意其它 -m 文本仍 unknown ⇒ 不产任何 tip（⇒ 其 sha 落 unclassifiable，fail-closed）。
  const scNeg = buildRefMoveBrackets([
    "4444444444444444444444444444444444444444\t",
    "5555555555555555555555555555555555555555\tquay-ref-landing",
    "6666666666666666666666666666666666666666\tmutation-unknown-form",
  ]);
  assert.equal(scNeg.refMoveTips.size, 0, "空 / 只有前缀 / 任意文本都不得成为 refMove tip");
  assert.equal(scNeg.sanctionedRefMoveTips.size, 0, "空 / 只有前缀 / 任意文本都不得成为 sanctionedRefMove tip");
  // 读不懂的形不产 tip（⇒ 其 sha 落进 unclassifiable，fail-closed）；夹在中间的 unknown 形仍然充当
  // 后一条 refMove 的 P（括注 P = 前一条 reflog 条目，不要求它自己是 refMove）。
  const unk = buildRefMoveBrackets([
    "dddddddddddddddddddddddddddddddddddddddd\tpush",
    "ffffffffffffffffffffffffffffffffffffffff\tbogus-action-form",
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\tpush",
  ]);
  assert.ok(!unk.refMoveTips.has("ffffffffffffffffffffffffffffffffffffffff"), "unknown 形不产 refMove tip");
  assert.ok(unk.refMoveTips.has("dddddddddddddddddddddddddddddddddddddddd"));
  assert.ok(unk.refMoveTips.has("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"));
  assert.equal(unk.brackets.length, 1, "只有 dddd 那条产括注（eeee 是最老条目、无前一条）");
  assert.deepEqual(unk.brackets[0], { T: "dddddddddddddddddddddddddddddddddddddddd", P: "ffffffffffffffffffffffffffffffffffffffff" }, "unknown 条目仍可作 P");
  // 最老 refMove 条目（无前一条）⇒ 不产括注（其「之前」超出 reflog 保留，不可分类——硬规则③b）
  const solo = buildRefMoveBrackets(["zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\tpush"]);
  assert.ok(solo.refMoveTips.has("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
  assert.equal(solo.brackets.length, 0, "最老条目无前一条 ⇒ 不产括注");
  assert.equal(buildRefMoveBrackets([]).brackets.length, 0);
  assert.equal(buildRefMoveBrackets(null).refMoveTips.size, 0);
});

test("PURE classifySpineLandingMode — ledger/direct/faninTips/括注覆盖 ⇒ fan-in|direct；否则 unclassifiable", () => {
  const ledger = new Set(["L"]);
  const direct = new Set(["D"]);
  const faninTips = new Set(["T"]);
  const covered = new Set(["M"]); // 中间 commit（括注覆盖）
  assert.equal(classifySpineLandingMode("L", ledger, direct, faninTips, covered), "fan-in", "ledger 优先");
  assert.equal(classifySpineLandingMode("D", ledger, direct, faninTips, covered), "direct", "commit 直投");
  assert.equal(classifySpineLandingMode("T", ledger, direct, faninTips, covered), "fan-in", "fanin tip");
  assert.equal(classifySpineLandingMode("M", ledger, direct, faninTips, covered), "fan-in", "括注覆盖的中间 commit");
  assert.equal(classifySpineLandingMode("X", ledger, direct, faninTips, covered), "unclassifiable", "落不进任何括注、非 commit ⇒ unclassifiable（3b）");
  assert.equal(classifySpineLandingMode("D", ledger, null, faninTips, covered), "unclassifiable", "reflog 不可读 ⇒ unclassifiable");
  assert.equal(classifySpineLandingMode("L", ledger, null, faninTips, covered), "fan-in", "ledger 优先于 reflog 不可读");
});

// ── 第六次变假：publishedReconcile（tasks/gap-ac194-release-preflight-reconcile-unreadable-landing）────────
// release-cut preflight 的 reconcile（`99efed2c`）由散文/agent 通道手搓 `git merge` + 裸 `git update-ref`
// （无 -m ⇒ 空 action）产出——三个 script 站点的保留前缀修复对它是盲的（硬规则 5b）。它与「人手外科式直落
// develop」（`394dbca5d`，同为空 action）在 DAG 上可结构区分：前者是 merge（2 父）且非首父 reachable from
// origin/develop；后者是单亲。⇒ 三谓词结构类（⛔ 非 sha 表、⛔ 非 message 匹配）。
test("PURE classifyPublishedReconcile — 空 action merge 一条【已发布】外部线 ⇒ publishedReconcile；单亲/本地 merge/任意 -m ⇒ unknown；远端读不出 ⇒ null", () => {
  // 生产形（99efed2c）：空 action ∧ merge(≥2 父) ∧ 所有非首父 reachable from origin/develop
  assert.equal(classifyPublishedReconcile("", 2, true), "publishedReconcile");
  assert.equal(classifyPublishedReconcile("", 3, true), "publishedReconcile", "octopus merge 同形（≥2 父、全部非首父发布）");
  // 负控 (a)：单亲（394dbca5d 形真直投）⇒ unknown（⛔ 一律判 publishedReconcile 会 fail-open 掩掉它）
  assert.equal(classifyPublishedReconcile("", 1, true), "unknown");
  assert.equal(classifyPublishedReconcile("", 0, true), "unknown", "root / 无父 ⇒ 不是 merge ⇒ unknown");
  // 负控 (b)：merge 但非首父**不** reachable from origin/develop（本地 merge）⇒ unknown
  assert.equal(classifyPublishedReconcile("", 2, false), "unknown");
  // 负控 (c)：非空 action（保留前缀 / 任意 -m 文本 / commit (merge) 直投）不在本类
  assert.equal(classifyPublishedReconcile("quay-ref-landing: x", 2, true), "unknown", "保留前缀由 classifyReflogAction 处置，不在本类");
  assert.equal(classifyPublishedReconcile("mutation-unknown-form", 2, true), "unknown", "任意 -m 文本 ⇒ 仍 unknown（负控核心）");
  assert.equal(classifyPublishedReconcile("commit (merge): Merge made by the 'ort' strategy.", 2, true), "unknown", "git 自己创建的 merge commit 是 direct，不在本类");
  // 第三态（硬规则 3b）：读不出 ⇒ null（NOT-EVALUATED，⛔ 不与 unknown 同形）
  assert.equal(classifyPublishedReconcile("", 2, null), null, "origin/develop 读不出 ⇒ NOT-EVALUATED");
  assert.equal(classifyPublishedReconcile("", null, true), null, "父数读不出 ⇒ NOT-EVALUATED");
  assert.equal(classifyPublishedReconcile("", undefined, undefined), null);
});

test("AC6 CLI — ff 括注分类：多 commit task 分支 ff 落地 ⇒ 中间 spine commit 判 fan-in delivered、unclassifiable 归零", () => {
  const dir = makeTmp("cli-bracket");
  try {
    initRepo(dir);
    const base = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    // task 分支 3 个 commit——ff 后中间 2 个（a/b）无独立 reflog 条目，只 tip（c）有 merge Fast-forward。
    gitCmd(dir, "checkout", "-q", "-b", "task/gap-bracket");
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    for (const n of ["a", "b", "c"]) {
      fs.writeFileSync(path.join(dir, "plugin", "scripts", `${n}.ts`), `export const ${n} = 1;\n`, "utf8");
      gitCmd(dir, "add", "-A");
      gitCmd(dir, "commit", "-q", "-m", `feat: commit ${n}`);
    }
    gitCmd(dir, "checkout", "-q", "develop");
    const ff = gitCmd(dir, "merge", "--ff-only", "task/gap-bracket");
    assert.equal(ff.status, 0, "ff 应成功");

    const r = runChecker(["--root", dir, "--baseline", base]);
    assert.equal(r.status, 0, `ff 括注分类后中间 commit 不得 unclassifiable ⇒ exit 0: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.ok, true);
    assert.equal(out.unclassifiableCommits, 0, "unclassifiable 归零（中间 commit 被括注判 fan-in delivered）");
    assert.equal(out.denominator.unclassifiableCommits, 0, "denominator 同步归零");
    assert.equal(out.denominator.totalDirectCommits, 0, "ff 落地不产生直投");
    assert.equal(out.classification.ratio, 1, "全部 first-parent 提交可分类");
    assert.equal(out.classification.firstParent, 3, "first-parent spine = 3 条");
    assert.equal(out.classification.offSpine, 0, "线性 temp repo 无 off-spine");
  } finally {
    cleanup(dir);
  }
});

test("AC5 CLI — 括注不越界：reflog 剪掉（expire）后中间 commit 无括注可落 ⇒ 仍 NOT-EVALUATED（不与合格同形）", () => {
  const dir = makeTmp("cli-bracket-gc");
  try {
    initRepo(dir);
    const base = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    gitCmd(dir, "checkout", "-q", "-b", "task/gap-bgc");
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    for (const n of ["a", "b", "c"]) {
      fs.writeFileSync(path.join(dir, "plugin", "scripts", `${n}.ts`), `export const ${n} = 1;\n`, "utf8");
      gitCmd(dir, "add", "-A");
      gitCmd(dir, "commit", "-q", "-m", `feat: commit ${n}`);
    }
    gitCmd(dir, "checkout", "-q", "develop");
    gitCmd(dir, "merge", "--ff-only", "task/gap-bgc");
    // 模拟 gc 全局剪：expire 全部 reflog ⇒ 括注无从建立 ⇒ 中间 commit（及 tip）都落不进括注。
    gitCmd(dir, "reflog", "expire", "--expire=now", "--all");

    const r = runChecker(["--root", dir, "--baseline", base]);
    assert.equal(r.status, 3, `reflog 剪后无括注可落 ⇒ NOT-EVALUATED exit 3（⛔ 不得 exit 0）: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, false, "括注失效 ⇒ NOT-EVALUATED（硬规则③b）");
    assert.equal(out.ok, true);
    assert.equal(out.reason, "unclassifiable-commits-in-range");
    assert.ok(out.unclassifiableCommits > 0, "中间 commit 落不进括注 ⇒ unclassifiable > 0");
  } finally {
    cleanup(dir);
  }
});

// ── 括注准入的第三次「前提变更」（gap-ac194-bracket-filter-drops-offspine-landing-tip）─────────────
// 前两次修的对象与本根**不同**却共用同一个 reason 字符串：① gap-ac194-bypass-check-unclassifiable-window
// 把全 DAG 扫描换成 first-parent spine 扫描；② gap-ac194-reflog-action-vocabulary-incomplete 把 action
// 分类从「拼法白名单」改成结构判定。**本次的根是【括注准入的前提】本身**：旧注释写「一次 ref-level 落地
// 到 develop 必然让 T 成为 develop tip（spine 成员）」——**该前提被实测证伪，且不是边角情形**：任务分支在
// 工作树里 `git merge develop`（把当时的 develop tip 记成**第二父**）、随后该分支被 ff fan-in ⇒ develop 的
// first-parent spine 走的变成**任务分支那条线**，先前的落地 tip 落进第二父位置（可达、离脊）。
// 实测（生产）：reflog 最近 200 条 tip 里只有 4 条在当前 spine 上；6 条已被 fan-in 的提交因此落进
// unclassifiable ⇒ NOT-EVALUATED ⇒ AC-194 `expect: exit 0` 结构上不可达。
// 修法：准入换成「T **不是**窗底 baseline 的祖先」（必要条件：T 是 baseline 祖先 ⇒ T 的祖先全是 baseline
// 的祖先 ⇒ 结构上带入不了窗内 spine 提交）。三条测试钉住三个方向（缺一条就不能取假）：
//   ① 回归：离脊 tip 的括注**覆盖**其 intro 提交 ⇒ unclassifiable 归零、exit 0（改前必红，读数见任务体）；
//   ② 负控制①：同一夹具 reflog 剪掉 ⇒ **未被任何括注解释**的 spine 提交仍 NOT-EVALUATED（fail-closed 保持）；
//   ③ 负控制②：落在**离脊 tip** 括注区间内的**真直投**仍判 direct 并报红（放宽准入不得掩真直投——
//      `classifySpineLandingMode` 里 `directSet` 先于 `refMoveCovered`，本控制把该顺序钉成常驻证据）。

const FIXED_ENV = { ...process.env, GIT_AUTHOR_DATE: FIXED_PAST, GIT_COMMITTER_DATE: FIXED_PAST };

/** 离脊落地 tip 夹具（形态实测自生产，见上注）。拓扑：
 *   · lineA: base → a1 → a2 → a3 → a4        （a4 = 离脊落地 tip T）
 *   · M = merge(firstParent=a2, secondParent=a4)  ⇒ a4 是 develop 祖先但落进第二父位置（离脊）
 *   · lineB: M → b1 → b2 → b3               （develop 的最终 tip）
 *   · reflog: [b3, M, a4, base]，全部 `branch: Reset to`（refMove）⇒ 括注 [b3,M] [M,a4] [a4,base]
 *  关键性质：a1/a2 **只在** 括注 [a4, base] 的 intro 里，而 T=a4 不在窗内 first-parent spine 上
 *  ⇒ 旧准入（`spineSet.has(T)`）跳过该括注 ⇒ a1/a2 unclassifiable（NOT-EVALUATED）。
 *  返回 { base, a4, m, b3, a2 }。 */
function buildOffSpineLandingFixture(dir) {
  initRepo(dir);
  const base = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  gitCmd(dir, "checkout", "-q", "-b", "lineA", base);
  for (const n of ["a1", "a2", "a3", "a4"]) {
    fs.writeFileSync(path.join(dir, `a-${n}.md`), `${n}\n`, "utf8");
    gitCmd(dir, "add", "-A");
    gitCommitFixed(dir, FIXED_PAST, `feat: ${n}`);
  }
  const a4 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  const a2 = gitCmd(dir, "rev-parse", "HEAD~2").stdout.trim();
  // M：first parent = spine 上的 a2、second parent = a4（a4 是 a2 的后代 ⇒ 必须 --no-ff 才产生 merge 提交）。
  gitCmd(dir, "checkout", "-q", "-b", "spine", a2);
  if (_COST_TIMING) _gitSpawns++;
  const mg = spawnSync("git", ["-C", dir, "merge", "-q", "--no-ff", "-m", "Merge lineA into spine", a4], { encoding: "utf8", env: FIXED_ENV });
  assert.equal(mg.status, 0, `merge --no-ff 应成功: ${mg.stdout}${mg.stderr}`);
  const m = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  for (const n of ["b1", "b2", "b3"]) {
    fs.writeFileSync(path.join(dir, `b-${n}.md`), `${n}\n`, "utf8");
    gitCmd(dir, "add", "-A");
    gitCommitFixed(dir, FIXED_PAST, `feat: ${n}`);
  }
  const b3 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  // ⚠️ `git branch -f <b>` 只在 <b> 未被检出时允许 ⇒ 先 detach。
  gitCmd(dir, "checkout", "-q", "--detach");
  for (const sha of [a4, m, b3]) {
    const r = gitCmd(dir, "branch", "-f", "develop", sha);
    assert.equal(r.status, 0, `branch -f develop ${sha.slice(0, 8)} 应成功: ${r.stderr}`);
  }
  return { base, a2, a4, m, b3 };
}

test("AC3 回归 — 离脊落地 tip 的括注覆盖其 intro 提交：tip 是 develop 祖先、但不在窗内 first-parent spine 上", () => {
  const dir = makeTmp("cli-offspine");
  try {
    const { base, a4, b3 } = buildOffSpineLandingFixture(dir);
    // 夹具前提（⛔ 前提不成立则本用例空转——硬规则④：先证明夹具真的踩在缺陷形状上）。
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", a4, "develop").status, 0, "a4 必须是 develop 的祖先（AC 要求「祖先」而非不可达）");
    const spine = gitCmd(dir, "rev-list", "--first-parent", `${base}..develop`).stdout.split("\n").filter(Boolean);
    assert.equal(spine.includes(a4), false, "a4 必须【不在】窗内 first-parent spine 上（离脊落地 tip）");
    assert.equal(spine[0], b3, "develop tip 必须是 b3");

    const r = runChecker(["--root", dir, "--baseline", base]);
    assert.equal(r.status, 0, `离脊 landing tip 的括注须覆盖其 intro 提交 ⇒ exit 0: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.ok, true);
    assert.equal(out.unclassifiableCommits, 0, "a1/a2 必须被判 fan-in delivered（⛔ 不是 unclassifiable）");
    assert.equal(out.denominator.unclassifiableCommits, 0, "denominator 同步归零");
    assert.equal(out.classification.ratio, 1, "全部 first-parent 提交可分类");
    assert.equal(out.classification.firstParent, spine.length, "first-parent spine 条数");
    assert.equal(out.classification.offSpine, 2, "离脊条数 = a3 + a4");
  } finally {
    cleanup(dir);
  }
});

test("AC4 负控制① — 离脊夹具 reflog 剪掉后：无括注可解释的 spine 提交仍 NOT-EVALUATED（放宽准入未削弱 fail-closed）", () => {
  const dir = makeTmp("cli-offspine-gc");
  try {
    const { base } = buildOffSpineLandingFixture(dir);
    gitCmd(dir, "reflog", "expire", "--expire=now", "--all");
    const r = runChecker(["--root", dir, "--baseline", base]);
    assert.equal(r.status, 3, `无括注 ⇒ NOT-EVALUATED exit 3（⛔ 不得 exit 0）: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, false, "无括注 ⇒ NOT-EVALUATED（硬规则③b）");
    assert.equal(out.ok, true);
    assert.equal(out.reason, "unclassifiable-commits-in-range");
    assert.ok(out.unclassifiableCommits > 0, "未被任何括注解释的 spine 提交仍 unclassifiable");
  } finally {
    cleanup(dir);
  }
});

test("AC5 负控制② — 落在【离脊 tip】括注区间内的真直投仍判 direct 并报红（放宽准入不得掩真直投）", () => {
  const dir = makeTmp("cli-offspine-direct");
  try {
    initRepo(dir);
    const base = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    // D1：develop 上的**直接提交** ∧ 代码面（plugin/test/x.test.mjs）⇒ reflog action = `commit:`。
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "x.test.mjs"), "export const x = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCommitFixed(dir, FIXED_PAST, "test: direct code-surface commit");
    const d1 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    // lineA(base) → a1,a2 ⇒ develop = a2（D1 离开可达集）；lineB(D1) → b1,b2 ⇒ develop = b2；
    // lineC(D1) → c1,c2 ⇒ develop = c2（b2 离脊 ⇒ 覆盖 D1 的那条括注 T 正是离脊 tip）。
    gitCmd(dir, "checkout", "-q", "-b", "lineA", base);
    for (const n of ["a1", "a2"]) { fs.writeFileSync(path.join(dir, `a-${n}.md`), `${n}\n`, "utf8"); gitCmd(dir, "add", "-A"); gitCommitFixed(dir, FIXED_PAST, `feat: ${n}`); }
    const a2 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    gitCmd(dir, "checkout", "-q", "-b", "lineB", d1);
    for (const n of ["b1", "b2"]) { fs.writeFileSync(path.join(dir, `b-${n}.md`), `${n}\n`, "utf8"); gitCmd(dir, "add", "-A"); gitCommitFixed(dir, FIXED_PAST, `feat: ${n}`); }
    const b2 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    gitCmd(dir, "checkout", "-q", "-b", "lineC", d1);
    for (const n of ["c1", "c2"]) { fs.writeFileSync(path.join(dir, `c-${n}.md`), `${n}\n`, "utf8"); gitCmd(dir, "add", "-A"); gitCommitFixed(dir, FIXED_PAST, `feat: ${n}`); }
    const c2 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    gitCmd(dir, "checkout", "-q", "--detach");
    for (const sha of [a2, b2, c2]) assert.equal(gitCmd(dir, "branch", "-f", "develop", sha).status, 0);

    // 夹具前提（⛔ 不成立则控制空转）：D1 落在括注 [b2, a2] 的 first-parent intro 内 ∧ b2 离脊。
    const intro = gitCmd(dir, "rev-list", "--first-parent", `${a2}..${b2}`).stdout.split("\n").filter(Boolean);
    assert.ok(intro.includes(d1), "D1 必须落在该括注的 intro 内（否则本控制什么也没验到）");
    const spine = gitCmd(dir, "rev-list", "--first-parent", `${base}..develop`).stdout.split("\n").filter(Boolean);
    assert.equal(spine.includes(b2), false, "b2 必须离脊（覆盖 D1 的括注 tip 是离脊 tip）");
    assert.ok(spine.includes(d1), "D1 must stay on the spine");

    const r = runChecker(["--root", dir, "--baseline", base]);
    assert.equal(r.status, 1, `括注区间内的真直投仍须 RED(exit 1): ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.reason, "direct-commit-bypasses-fan-in");
    const c = out.candidates.find((x) => x.sha === d1);
    assert.ok(c, "D1 必须出现在 code-surface candidates 里");
    assert.equal(c.confirmedBypass, true, "D1 仍判 direct/bypass（⛔ 未被括注覆盖洗成 fan-in）");
    assert.equal(out.unclassifiableCommits, 0, "本夹具无不可分类提交");
  } finally {
    cleanup(dir);
  }
});

// ── CLI 集成：ledger 判定（AC2）与 reflog 剪后退 NOT-EVALUATED（AC3）─────────────────────────────

test("AC2 CLI — rev-list 命中的 code-surface commit 在 ledger 里 ⇒ 判 fan-in 落地不算直投（不报 RED）", () => {
  const dir = makeTmp("cli-ledger");
  const st = makeTmp("cli-ledger-state");
  try {
    initRepo(dir);
    // 一条触及代码面的 commit（若无 ledger，其 reflog `commit:` 会判为直接提交 ⇒ RED）。
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "led.test.mjs"), "export const l = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: code commit recorded as fan-in-landed");
    const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    // ledger fixture：同一 lock-events 文件里，成对的 acquire/release，release 带 landedSha
    // （fan-in 落地的持久化事实——与 fan-in-ff-merge.sh 的写入形态一致）。
    const events = path.join(st, "fan-in-merge-lock-events.jsonl");
    fs.mkdirSync(st, { recursive: true });
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", taskId: "t", ts: "2026-08-23T00:00:00Z", epoch: 1, pid: 1 }),
      JSON.stringify({ event: "release", landedSha: sha, taskId: "t", ts: "2026-08-23T00:00:01Z", epoch: 2, pid: 1 }),
    ].join("\n") + "\n", "utf8");

    const r = runChecker(["--root", dir, "--lock-events", events]);
    assert.equal(r.status, 0, `在 ledger 里 ⇒ 不算直投（不报 RED）: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.ok, true);
    assert.equal(out.denominator.codeSurfaceCommits, 0, "ledger 命中的 code-surface commit 不被收集为直接提交");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC2 CLI — 不在 ledger 且 reflog 有「直接 commit」标签 ⇒ 仍 RED（真直投仍红）", () => {
  const dir = makeTmp("cli-ledger-neg");
  try {
    initRepo(dir);
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "neg.test.mjs"), "export const n = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: direct code commit");
    // 无 ledger 记录（默认 .quay/ 缺失 = 空 ledger）⇒ 真直投仍红。
    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 1, `不在 ledger 且 reflog 有 commit 标签 ⇒ RED: ${r.stdout}${r.stderr}`);
    assert.equal(jsonOut(r).reason, "direct-commit-bypasses-fan-in");
  } finally {
    cleanup(dir);
  }
});

test("exit-3 pin — reflog 被 gc 剪（expire）后：evaluated:false ⇒ exit 3（NOT-EVALUATED，gap-bypass-check-unclassifiable-exits-zero DoD3）", () => {
  const dir = makeTmp("cli-gc");
  try {
    initRepo(dir);
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "gc.test.mjs"), "export const g = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: direct code commit");
    // 模拟 gc 全局剪：expire 全部 reflog。
    gitCmd(dir, "reflog", "expire", "--expire=now", "--all");
    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 3, `reflog 剪后必须 exit 3（NOT-EVALUATED），⛔ 不再与 PASS 共用 exit 0: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, false, "reflog 剪后 ⇒ NOT-EVALUATED（硬规则 3b）");
    assert.equal(out.ok, true);
    assert.equal(out.reason, "unclassifiable-commits-in-range");
    assert.ok(out.unclassifiableCommits > 0, "存在 ledger 无记录且 reflog 也查不到的 commit");
    // AC4：全部不可分类 ⇒ classification.ratio === 0。
    assert.equal(out.classification.classified, 0, "全不可分类 ⇒ classified = 0");
    assert.equal(out.classification.ratio, 0, "全不可分类 ⇒ ratio = 0");
  } finally {
    cleanup(dir);
  }
});

test("exit-3 pin — rev-list 不可读（非 git 根）⇒ evaluated:false ⇒ exit 3（NOT-EVALUATED）", () => {
  // 第二个 evaluated:false 来源（rev-list 不可读，早退分支）也必须 exit 3——与 unclassifiable 降级
  // 分支独立，钉住「evaluated:false 一律 exit 3」而非只钉「unclassifiable ⇒ exit 3」。
  const dir = makeTmp("cli-norepo");
  try {
    fs.writeFileSync(path.join(dir, "not-a-repo.txt"), "x\n", "utf8");
    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 3, `rev-list 不可读 ⇒ exit 3（NOT-EVALUATED），⛔ 不再是 exit 0: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, false, "rev-list 不可读 ⇒ evaluated:false");
    assert.equal(out.ok, true, "NOT-EVALUATED 不是 RED");
    assert.equal(out.reason, "rev-list-unreadable (NOT-EVALUATED)");
  } finally {
    cleanup(dir);
  }
});

// ── PROMOTION REGRESSION (tasks/gap-correctness-checkers-opt-in-not-default-suite-member) ───────────
//
// This checker used to live in run_operational_checks() — the OPT-IN tier whose ONLY invocation is a
// human typing `scripts/test.sh --static-checks-operational`. Measured 2026-09-13: ZERO automatic
// callers anywhere in the repo, while this is the ONLY detector for a direct code-surface commit to
// develop that bypasses fan-in's ff-lock / anti-drift-touches / AC-completion gates (11b / C17).
//
// Two things had to be true for the promotion to be worth anything, and BOTH are pinned here:
//   (1) REGISTRATION — it is in run_static_checks() (the default full-suite gate ⇒ every fan-in) and
//       no longer in the opt-in tier, reading the MAIN checkout via --root main_root (develop reflog
//       + lock events are MAIN-checkout state; with repo_root a worktree round would be vacuous);
//   (2) EVALUABILITY — the registered argv must actually EVALUATE. This is not hypothetical: the
//       wiring's original `--baseline b11ce7202b46406d5d5bc82ef7c030c4aed05b` was a FROZEN sha that
//       develop had run 5147 first-parent commits past while the reflog reached back only 4692, so
//       455 spine commits fell outside every reflog bracket, `unclassifiable-commits-in-range` fired
//       unconditionally, and the checker answered exit 3 NOT-EVALUATED forever — while GOAL AC-194,
//       measuring the SAME invariant through `--baseline develop~100`, said pass. Wiring a
//       permanently-NOT-EVALUATED checker is 硬规则 3b one layer up: a line in every suite log that
//       reads like a verdict and never is one.

const GATE_FILE = path.join(REPO_ROOT, "plugin", "scripts", "runner-static-gate.ts");

/** The flag list of the gate's registered `run_checker "<name>"` line inside `fnName`'s body.
 *  SINGLE SOURCE: the test never restates the flags — it reads what the gate actually runs. */
function registeredCheckerFlags(name, fnName) {
  const text = fs.readFileSync(GATE_FILE, "utf8");
  const start = text.indexOf(`${fnName}() {`);
  assert.ok(start >= 0, `${fnName}() must exist in runner-static-gate.ts`);
  const body = text.slice(start, text.indexOf("\n}\n", start));
  const line = body.split("\n").find((l) => l.includes(`run_checker "${name}"`));
  assert.ok(line, `${name} must be registered in ${fnName}()`);
  const flags = line.replace(/^.*?\.ts"\s*/, "");
  assert.notEqual(flags, line.trim(), "the registered line must name a .ts script");
  return flags.trim();
}

/** Run the checker with the gate's OWN registered flags, redirecting only the root to `dir`
 *  (the gate's root variables are shell paths a test cannot satisfy; every other flag is verbatim
 *  from the gate — so the BASELINE under test is the one production uses). */
function runRegisteredFlags(name, fnName, dir) {
  const flags = registeredCheckerFlags(name, fnName)
    .replaceAll('"${main_root}"', JSON.stringify(dir))
    .replaceAll('"${repo_root}"', JSON.stringify(dir))
    .replaceAll("${main_root}", dir)
    .replaceAll("${repo_root}", dir);
  const argv = flags.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, ""));
  if (_COST_TIMING) _checkerSpawns++;
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...argv], { encoding: "utf8" });
  return r;
}

/** A fixture develop DEEP ENOUGH for the registered `develop~100` window to resolve (a 2-commit
 *  fixture makes `develop~100` unresolvable ⇒ the checker早退 exit 3 on `rev-list-unreadable`, and
 *  the test would then be measuring the WRONG failure — it must measure the window it claims to).
 *  101 design-internal commits (docs/ ⇒ 排除集); the code-surface commit is injected later so ONE
 *  fixture serves baseline → inject → restore (the mutation-case shape, and half the git cost). */
function makeDevelopSpineRepo() {
  const dir = makeTmp("registered-argv");
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "promotion-regression");
  gitCmd(dir, "config", "user.email", "pr@example.com");
  gitCmd(dir, "branch", "-M", "develop");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  for (let i = 0; i <= 100; i++) {
    fs.writeFileSync(path.join(dir, "docs", `note-${i}.md`), `note ${i}\n`, "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", `docs: note ${i}`);
  }
  return dir;
}

/** Inject a direct code-surface commit on develop's spine (the shape fan-in's locks cannot see). */
function injectCodeSurfaceDirectCommit(dir) {
  fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "test", "injected.test.mjs"), "export const x = 1;\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "test: injected direct code-surface commit");
}

test("PROMOTED: registered in run_static_checks() (default gate), NOT in the opt-in tier, --root main_root", () => {
  const text = fs.readFileSync(GATE_FILE, "utf8");
  const bodyOf = (fn) => {
    const start = text.indexOf(`${fn}() {`);
    assert.ok(start >= 0, `${fn}() must exist`);
    return text.slice(start, text.indexOf("\n}\n", start));
  };
  assert.ok(
    bodyOf("run_static_checks").includes('run_checker "direct-to-develop-bypass-check"'),
    "the bypass checker must be registered in run_static_checks (the default full-suite gate)",
  );
  assert.ok(
    !bodyOf("run_operational_checks").includes('run_checker "direct-to-develop-bypass-check"'),
    "it must NOT also sit in run_operational_checks — the opt-in tier has no automatic caller",
  );
  assert.match(
    registeredCheckerFlags("direct-to-develop-bypass-check", "run_static_checks"),
    /--root\s+"?\$\{main_root\}/,
    "the registered --root must be main_root (develop reflog + lock events are MAIN-checkout state)",
  );
});

test("EVALUABILITY: the registered --baseline is a ref-relative window, never a frozen sha that silently expires", () => {
  // The measured defect: a 40-hex enforcement sha that develop outran while the reflog stayed put.
  // Such a value turns the check into a permanent NOT-EVALUATED — indistinguishable in the record
  // from "always passing". 硬规则 4 推论二: a literal whose validity depends on how far the host has
  // moved must be read from the host, not frozen.
  const flags = registeredCheckerFlags("direct-to-develop-bypass-check", "run_static_checks");
  const m = flags.match(/--baseline\s+"?([^\s"]+)"?/);
  assert.ok(m, `the registered argv must pass an explicit --baseline:\n${flags}`);
  const baseline = m[1];
  assert.ok(
    !/^[0-9a-f]{40}$/.test(baseline),
    `the registered --baseline must not be a frozen 40-hex sha (got "${baseline}") — develop outruns it ` +
      `and the reflog horizon does not, so the checker degrades to a permanent NOT-EVALUATED`,
  );
  assert.match(baseline, /~/, `the registered --baseline must be a ref-relative window (got "${baseline}")`);
});

test("NEGATIVE CONTROL on the REGISTERED argv: a code-surface direct commit to develop REDs; its absence is GREEN", () => {
  const dir = makeDevelopSpineRepo();
  try {
    const green = runRegisteredFlags("direct-to-develop-bypass-check", "run_static_checks", dir);
    assert.equal(green.status, 0,
      `GREEN baseline: the registered argv must EVALUATE (not NOT-EVALUATED) on a clean develop spine:\n${green.stdout}${green.stderr}`);
    assert.equal(JSON.parse(green.stdout).evaluated, true, "the registered argv must produce a real verdict, not exit 3");

    injectCodeSurfaceDirectCommit(dir);
    const red = runRegisteredFlags("direct-to-develop-bypass-check", "run_static_checks", dir);
    assert.equal(red.status, 1,
      `the REGISTERED argv must RED on a direct code-surface commit to develop (a wired-but-never-\n` +
        `evaluating check is the defect this promotion cures):\n${red.stdout}${red.stderr}`);
    const out = JSON.parse(red.stdout);
    assert.equal(out.ok, false, "RED must report ok:false");
    assert.equal(out.reason, "direct-commit-bypasses-fan-in", "RED's reason must name the bypass");
    assert.ok(out.denominator.codeSurfaceCommits >= 1, "the injected commit must be counted as code-surface");

    // RESTORE — proves the RED came from the injected commit, not from a checker that is stuck red.
    gitCmd(dir, "reset", "-q", "--hard", "HEAD~1");
    const restored = runRegisteredFlags("direct-to-develop-bypass-check", "run_static_checks", dir);
    assert.equal(restored.status, 0, `RESTORE must return to GREEN:\n${restored.stdout}${restored.stderr}`);
  } finally {
    cleanup(dir);
  }
});

// ── 落地词汇表按结构判定：CLI 级负控制（gap-ac194-reflog-action-vocabulary-incomplete AC2/AC3/AC5/AC6）──
// 探针实测原文（git 2.43.0，逐条在 /tmp 临时仓库跑出，⛔ 无凭记忆字面量）：
//   git branch -f <已存在 b> HEAD   → `branch: Reset to HEAD`        ← 本任务的生产拼法（AC1 的根因）
//   git branch -f <已存在 b> <sha>  → `branch: Reset to <sha>`
//   git branch <新 b> <target>      → `branch: Created from <target>`
//   git update-ref -m <msg> <ref> <sha> → `<msg>`（任意文本 ⇒ unknown，fail-closed）
// ⚠️ `git branch -f <b>` 只在 <b> **未被任何 worktree 检出**时允许 ⇒ 夹具先 `git checkout --detach`。

/** 建一个 base 为 design-internal 提交、且 `develop` **未被检出**的 repo（`git branch -f develop <t>`
 *  只在该分支未被检出时可用——这正是生产上 develop 的落地形态：主检出检的是 author，不是 develop）。 */
function makeForkedDevelopRepoInto(dir) {
  gitCmd(dir, "init", "-q", "-b", "main");
  gitCmd(dir, "config", "user.name", "d2d-test");
  gitCmd(dir, "config", "user.email", "d2d@example.com");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "base.md"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCommitFixed(dir, FIXED_PAST, "tasks: base");
  gitCmd(dir, "branch", "develop");
}

function makeForkedDevelopRepo(prefix) {
  const dir = makeTmp(prefix);
  // AC2: same shared-base treatment as initRepo — the base is a precondition, copied per test.
  fs.cpSync(sharedBase("d2d-forkbase", makeForkedDevelopRepoInto), dir, { recursive: true });
  return { dir, base: gitCmd(dir, "rev-parse", "HEAD").stdout.trim() };
}

/** 在当前分支（main）上提交一个代码面文件，返回其 sha。 */
function commitCodeSurface(dir, name) {
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", name), "export const x = 1;\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", `feat: ${name}`);
  return gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
}

test("AC5 CLI — refMove 形（`branch: Reset to`）落地代码面 ⇒ GREEN 但**可见**：refMoveIntroduced 列出带入窗内的 sha + code-surface 标记", () => {
  const { dir, base } = makeForkedDevelopRepo("cli-refmove");
  try {
    const tip = commitCodeSurface(dir, "x.ts");
    gitCmd(dir, "checkout", "-q", "--detach"); // develop 不再被检出 ⇒ branch -f 可用
    const bf = gitCmd(dir, "branch", "-f", "develop", tip);
    assert.equal(bf.status, 0, `git branch -f develop 应成功: ${bf.stderr}`);
    const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%gs").stdout;
    assert.match(reflog, /^branch: Reset to /, `夹具必须产出 branch: Reset to 形（实测原文）: ${reflog}`);

    const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
    // ref-level 落地不创建 commit ⇒ 不是直投 ⇒ exit 0（与 fan-in 的 push / merge --ff-only 同类）。
    assert.equal(r.status, 0, `refMove 落地不得判为直投: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.ok, true);
    assert.equal(out.unclassifiableCommits, 0, "refMove tip 不再落进 unclassifiable（旧白名单在这里失明 ⇒ AC-194 恒 fail）");
    assert.equal(out.classification.ratio, 1, "全部 first-parent 提交可分类");
    // 可见而非静默豁免（AC5）：带入窗内的 first-parent sha 清单 + code-surface 标记。
    assert.equal(out.classification.refMoveIntroduced.length, 1);
    const rm = out.classification.refMoveIntroduced[0];
    assert.equal(rm.tip, tip);
    assert.deepEqual(rm.introduced.map((i) => i.sha), [tip], "带入窗内的 first-parent sha 清单");
    assert.equal(rm.introduced[0].codeSurface, true, "plugin/scripts/x.ts 是 code-surface（可见）");
    assert.ok(rm.introduced[0].files.includes("plugin/scripts/x.ts"), "code-surface 结论要能看到是哪个文件");
    // ⛔ 不并入 fan-in 计数：直投分母仍为 0（refMove 是读数，不参与 RED/GREEN）。
    assert.equal(out.denominator.totalDirectCommits, 0, "refMove 不得计入直投分母");
    assert.equal(out.denominator.codeSurfaceCommits, 0);
    assert.equal(out.denominator.unclassifiableCommits, 0);
  } finally {
    cleanup(dir);
  }
});

test("AC2 CLI — 未知 action 形 ⇒ exit 3 且 reason **逐字点名**该形（旧版只报 unclassifiable-commits-in-range 计数 ⇒ 需事后反推）", () => {
  const { dir, base } = makeForkedDevelopRepo("cli-unknownform");
  try {
    const tip = commitCodeSurface(dir, "y.ts");
    gitCmd(dir, "checkout", "-q", "--detach");
    const ur = gitCmd(dir, "update-ref", "-m", "bogus-action-form", "refs/heads/develop", tip);
    assert.equal(ur.status, 0, `git update-ref 应成功: ${ur.stderr}`);
    const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%gs").stdout;
    assert.match(reflog, /^bogus-action-form$/m, `夹具必须产出自定义的未知 action 形: ${reflog}`);

    const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
    assert.equal(r.status, 3, `读不懂的 action 形必须 NOT-EVALUATED exit 3（⛔ 不得与合格同形/exit 0）: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, false, "硬规则③b：读不懂 ≠ 合格");
    assert.equal(out.reason, "unsupported-reflog-action: bogus-action-form", "reason 必须逐字点名该 action 形（根因在失败那一刻可见）");
    assert.equal(out.reasonSecondary, "unclassifiable-commits-in-range", "既有 reason 作为并列信息保留");
    assert.equal(out.classification.unclassifiedActionForms.length, 1);
    const uf = out.classification.unclassifiedActionForms[0];
    assert.equal(uf.form, "bogus-action-form");
    assert.equal(uf.count, 1);
    assert.deepEqual(uf.sampleShas, [tip]);
  } finally {
    cleanup(dir);
  }
});

test("AC6 CLI — rewind（`branch: Reset to <older>`，P 非 T 祖先）⇒ 不计为「带入 commit 的落地」，且单独可见", () => {
  const { dir, base } = makeForkedDevelopRepo("cli-rewind");
  try {
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", "c2.md"), "c2\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "tasks: c2");
    const c2 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    fs.writeFileSync(path.join(dir, "tasks", "c3.md"), "c3\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "tasks: c3");
    const c3 = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    gitCmd(dir, "checkout", "-q", "--detach");
    gitCmd(dir, "branch", "-f", "develop", c3); // 前向
    gitCmd(dir, "branch", "-f", "develop", c2); // 回退（rewind）

    const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
    assert.equal(r.status, 0, `rewind 仍是 ref-level 落地（不创建 commit）⇒ 不报直投: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.classification.refMoveIntroduced.length, 0, "rewind 不得计为「带入了 commit 的落地」");
    assert.equal(out.classification.nonForwardRefMoves.length, 1, "rewind 必须单独可见（⛔ 不是静默豁免）");
    const nf = out.classification.nonForwardRefMoves[0];
    assert.equal(nf.tip, c2, "T = 回退后的 tip");
    assert.equal(nf.prev, c3, "P = 回退前的 tip（P 非 T 祖先）");
    assert.deepEqual(nf.introduced, [], "引入集为空（rev-list --first-parent P..T 为空）");
    assert.match(nf.reason, /rewind/);
  } finally {
    cleanup(dir);
  }
});

test("AC3 CLI — `commit:` action 的 code-surface 直投仍 RED（放宽词汇表不得漏掉真直投）", () => {
  const dir = makeTmp("cli-direct-still-red");
  try {
    initRepo(dir);
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "d.test.mjs"), "export const d = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: direct code commit");
    const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%gs").stdout;
    assert.match(reflog, /^commit: test: direct code commit$/m, `夹具必须是 commit: 形: ${reflog}`);

    // ① reflog 扫描路径
    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 1, `commit: 形 code-surface 直投必须仍 RED: ${r.stdout}${r.stderr}`);
    assert.equal(jsonOut(r).reason, "direct-commit-bypasses-fan-in");
    assert.ok(jsonOut(r).denominator.codeSurfaceCommits >= 1);
    // ② --commits 回放路径（同一判定的 fixture seam）
    const r2 = runChecker(["--root", dir, "--commits", sha]);
    assert.equal(r2.status, 1, `--commits 回放同一 commit 也必须 RED: ${r2.stdout}${r2.stderr}`);
    assert.equal(jsonOut(r2).reason, "direct-commit-bypasses-fan-in");
  } finally {
    cleanup(dir);
  }
});

// ── fetch 形的钉子·CLI 级（gap-ac194-production-criterion-owner AC3/AC5）───────────────────────────
// 上面那条 PURE 测试钉的是**函数**；这两条钉的是**整条判定链**（gitDevelopDirectCommits →
// buildRefMoveBrackets → classifySpineLandingMode → 三态退出码）对同一个 fetch 形的行为——
// 白名单化会先在这里把结果从 exit 0 翻成 exit 3（NOT-EVALUATED），而不只是让一个纯函数返回值变。

test("AC3 CLI — 生产形态 `git fetch -q . author:develop` 的**真实 reflog**落地 ⇒ refMove：exit 0、unclassifiable 归零、ratio 1", () => {
  const { dir, base } = makeForkedDevelopRepo("cli-fetch-prod");
  try {
    const tip = commitCodeSurface(dir, "fetchprod.ts");
    gitCmd(dir, "branch", "author", tip);
    gitCmd(dir, "checkout", "-q", "--detach"); // develop 不再被检出 ⇒ fetch 可写 develop ref
    const fr = gitCmd(dir, "fetch", "-q", ".", "author:develop");
    assert.equal(fr.status, 0, `git fetch . author:develop 应成功: ${fr.stderr}`);
    const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%gs").stdout;
    // 夹具前置断言：必须产出**生产形态**——否则本测试测的是另一种形，钉不到 AC3(a)。
    assert.match(reflog, /^fetch -q \. author:develop: fast-forward$/m,
      `夹具必须产出生产形态（本仓 develop reflog 逐字同形 develop@{225}）: ${reflog}`);

    const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
    assert.equal(r.status, 0, `fetch 落地是 ref-level 移动（不创建 commit）⇒ 不得判直投: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.ok, true);
    assert.equal(out.unclassifiableCommits, 0,
      "生产形态若落 unclassifiable ⇒ 判据恒 NOT-EVALUATED ⇒ AC-194 结构上不可达（旧白名单正是在这里失明）");
    assert.equal(out.classification.ratio, 1, "全部 first-parent 提交可分类");
    assert.equal(out.classification.unclassifiedActionForms.length, 0);
    assert.equal(out.denominator.totalDirectCommits, 0, "refMove 不计入直投分母");
    // 可见而非静默豁免：带入窗内的 first-parent sha 清单仍在。
    assert.equal(out.classification.refMoveIntroduced.length, 1);
    assert.equal(out.classification.refMoveIntroduced[0].tip, tip);
    assert.deepEqual(out.classification.refMoveIntroduced[0].introduced.map((i) => i.sha), [tip]);
  } finally {
    cleanup(dir);
  }
});

test("AC5 CLI — 词表外 fetch 后缀（`pruned`）落在**真实 reflog 行** ⇒ 仍 refMove：判定与后缀词表无关", () => {
  const { dir, base } = makeForkedDevelopRepo("cli-fetch-unlisted");
  try {
    const tip = commitCodeSurface(dir, "fetchunlisted.ts");
    gitCmd(dir, "checkout", "-q", "--detach");
    // 把词表外的后缀写进**真实** reflog（同一手法用于既有 unknown 形用例：git 允许 -m 指定任意 reflog 文本）。
    const ur = gitCmd(dir, "update-ref", "-m", "fetch -q . author:develop: pruned", "refs/heads/develop", tip);
    assert.equal(ur.status, 0, `git update-ref 应成功: ${ur.stderr}`);
    const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%gs").stdout;
    assert.match(reflog, /^fetch -q \. author:develop: pruned$/m, `夹具必须产出词表外后缀的真实 reflog 行: ${reflog}`);

    const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
    assert.equal(r.status, 0,
      `词表外 fetch 后缀仍必须 refMove（⛔ 不得落 unknown ⇒ NOT-EVALUATED/exit 3）: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true);
    assert.equal(out.unclassifiableCommits, 0, "词表外后缀不得落 unclassifiable");
    assert.equal(out.classification.unclassifiedActionForms.length, 0, "⛔ 不得被点名为「读不懂的 action 形」");
    assert.equal(out.classification.ratio, 1);
    assert.equal(out.denominator.totalDirectCommits, 0);
  } finally {
    cleanup(dir);
  }
});

// ── 第五次变假：本仓自己通道的裸 `git update-ref`（空 reflog action）─────────────────────────────
// （tasks/gap-ac194-empty-reflog-action-from-message-less-update-ref）
// 缺口：`integration-batch-merge.ts` 的 real-merge/ff CAS 与 `sync-lag-check.sh` 的 downsync 用**裸
// `git update-ref`（无 -m）** 移动 develop ⇒ reflog action 为空 ⇒ `(empty)` ⇒ unknown ⇒ unclassifiable
// ⇒ 判据 NOT-EVALUATED（exit 3）⇒ AC-194 恒 fail。修法 = 生产者补保留前缀 `-m`（AC3）+ checker 给该前缀
// 一个结构分类 sanctionedRefMove（AC4）。⛔ 空 / 任意其它 `-m` 文本仍 fail-closed（AC5 负控）。
// 探针实测原文（git 2.43.0）：`git update-ref <ref> <new> <old>`（无 -m）⇒ `%gs` 为空串。

test("AC4 CLI — 本仓通道声明的 `quay-ref-landing: …` 落地代码面 ⇒ GREEN 且**独立计数**（sanctionedRefMoveCommits / sanctionedRefMoveIntroduced，⛔ 不并入 refMove）", () => {
  const { dir, base } = makeForkedDevelopRepo("cli-sanctioned");
  try {
    const tip = commitCodeSurface(dir, "sanctioned.ts");
    gitCmd(dir, "checkout", "-q", "--detach"); // develop 不再被检出 ⇒ update-ref 可写 develop ref
    const old = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    // 与 integration-batch-merge.ts:1165/:1281 同形的保留前缀（CAS：expected old value 仍在第 4 位置）。
    const ur = gitCmd(dir, "update-ref", "-m", `quay-ref-landing: fast-forward ${old} -> ${tip}`, "refs/heads/develop", tip, old);
    assert.equal(ur.status, 0, `git update-ref -m 应成功: ${ur.stderr}`);
    const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%gs").stdout;
    assert.match(reflog, /^quay-ref-landing: fast-forward /m, `夹具必须产出保留前缀的真实 reflog 行: ${reflog}`);

    const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
    assert.equal(r.status, 0, `sanctioned ref-level 落地不创建 commit ⇒ 不得判直投/NOT-EVALUATED: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.evaluated, true, "保留前缀 ⇒ 可分类（⛔ 不再 unclassifiable）");
    assert.equal(out.ok, true);
    assert.equal(out.unclassifiableCommits, 0, "sanctioned tip 不再落 unclassifiable（裸 update-ref 时恒落——这正是本任务）");
    assert.equal(out.classification.ratio, 1, "全部 first-parent 提交可分类");
    assert.equal(out.classification.unclassifiedActionForms.length, 0, "⛔ 不得被点名为「读不懂的 action 形」");
    // 独立计数（AC4 核心）：sanctioned 与 refMove **分列**。
    assert.equal(out.denominator.sanctionedRefMoveCommits, 1, "窗内 spine 上有 1 条 sanctioned tip（独立计数）");
    assert.equal(out.classification.sanctionedRefMoveIntroducedTotal, 1);
    assert.equal(out.classification.sanctionedRefMoveIntroduced[0].tip, tip);
    assert.deepEqual(out.classification.sanctionedRefMoveIntroduced[0].introduced.map((i) => i.sha), [tip]);
    assert.equal(out.classification.sanctionedRefMoveIntroduced[0].introduced[0].codeSurface, true, "plugin/scripts/sanctioned.ts 是 code-surface（可见）");
    assert.equal(out.classification.refMoveIntroducedTotal, 0, "⛔ sanctioned 不得并入 refMove 读数");
    assert.equal(out.denominator.totalDirectCommits, 0, "⛔ sanctioned 不得计入直投分母/fan-in 计数");
    assert.equal(out.denominator.codeSurfaceCommits, 0);
  } finally {
    cleanup(dir);
  }
});

test("AC5 CLI 负控 — 裸 `git update-ref`（空 action）/ 任意其它 `-m` 文本 ⇒ 仍 NOT-EVALUATED（exit 3，reason 点名该形）", () => {
  // (a) 空 action：git update-ref **无 -m**（本任务要修的失败形态本身）——⛔ 不得被判 sanctionedRefMove。
  {
    const { dir, base } = makeForkedDevelopRepo("cli-emptyform");
    try {
      const tip = commitCodeSurface(dir, "emptyform.ts");
      gitCmd(dir, "checkout", "-q", "--detach");
      const old = gitCmd(dir, "rev-parse", "develop").stdout.trim();
      const ur = gitCmd(dir, "update-ref", "refs/heads/develop", tip, old); // 无 -m ⇒ 空 gs
      assert.equal(ur.status, 0, `裸 git update-ref 应成功: ${ur.stderr}`);
      const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%h [%gs]").stdout;
      assert.match(reflog, /^\S+ \[\](?:\n|$)/m, `夹具必须产出空 action 的真实 reflog 行: ${reflog}`);

      const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
      assert.equal(r.status, 3, `空 action 必须 NOT-EVALUATED exit 3（⛔ 不得 fail-open 成合格）: ${r.stdout}${r.stderr}`);
      const out = jsonOut(r);
      assert.equal(out.evaluated, false, "硬规则③b：读不懂 ≠ 合格");
      assert.equal(out.ok, true);
      assert.equal(out.reason, "unsupported-reflog-action: (empty)", "reason 必须逐字点名 `(empty)`");
      assert.equal(out.reasonSecondary, "unclassifiable-commits-in-range");
      assert.equal(out.denominator.sanctionedRefMoveCommits, 0, "⛔ 空 action 不得被算作 sanctioned 落地");
      assert.equal(out.classification.sanctionedRefMoveIntroducedTotal, 0);
    } finally {
      cleanup(dir);
    }
  }
  // (b) 任意其它 `-m` 文本（不是保留前缀）⇒ 仍 NOT-EVALUATED，reason 逐字点名该形（保留前缀**未**退化成白名单）。
  {
    const { dir, base } = makeForkedDevelopRepo("cli-arbitraryform");
    try {
      const tip = commitCodeSurface(dir, "arbitraryform.ts");
      gitCmd(dir, "checkout", "-q", "--detach");
      const old = gitCmd(dir, "rev-parse", "develop").stdout.trim();
      const ur = gitCmd(dir, "update-ref", "-m", "quay-ref-landing", "refs/heads/develop", tip, old); // 只有前缀、无 `: …`
      assert.equal(ur.status, 0, `git update-ref -m 应成功: ${ur.stderr}`);

      const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
      assert.equal(r.status, 3, `只有保留前缀而无其余部分 ⇒ 仍 NOT-EVALUATED（⛔ 不得放行）: ${r.stdout}${r.stderr}`);
      const out = jsonOut(r);
      assert.equal(out.evaluated, false);
      assert.equal(out.reason, "unsupported-reflog-action: quay-ref-landing", "reason 逐字点名该形");
      assert.equal(out.denominator.sanctionedRefMoveCommits, 0, "⛔ 不得算作 sanctioned 落地");
    } finally {
      cleanup(dir);
    }
  }
});

// ── 第六次变假·CLI（tasks/gap-ac194-release-preflight-reconcile-unreadable-landing）──────────────────
// release-cut preflight 的 reconcile：**空 action** ∧ merge(≥2 父) ∧ 非首父 reachable from origin/develop
// ⇒ 被判 publishedReconcile（GREEN + 独立计数），而不是落 unclassifiable / NOT-EVALUATED。负控（本地 merge、
// 单亲）必须仍 fail-closed。⛔ 判定按结构，⛔ 不是 sha 白名单、⛔ 不是 message 匹配。
test("AC3/AC4 CLI — 第六次变假：空 action merge 一条【已发布】外部线 ⇒ publishedReconcile（GREEN + 独立计数）；本地 merge / 单亲 ⇒ 仍 NOT-EVALUATED", () => {
  // (positive) release-cut preflight reconcile 形。
  {
    const { dir, base } = makeForkedDevelopRepo("cli-pubrec-pos");
    try {
      const published = commitCodeSurface(dir, "published.ts"); // main: base → published
      gitCmd(dir, "update-ref", "refs/remotes/origin/develop", published); // 已发布外部线
      gitCmd(dir, "checkout", "-q", "-b", "recontmp", "develop"); // develop = base
      const mg = gitCmd(dir, "merge", "-q", "--no-ff", "-m", "Merge origin/develop into develop — reconcile the published CI fixes", published);
      assert.equal(mg.status, 0, `fixture merge 应成功: ${mg.stderr}`);
      const mergeSha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
      // 锚：确为 merge（2 父）∧ 非首父 reachable from origin/develop（否则夹具本身没钉住结构判定）。
      const parents = gitCmd(dir, "rev-list", "--parents", "-n1", mergeSha).stdout.trim().split(" ").slice(1);
      assert.equal(parents.length, 2, "夹具必须产出 2 父 merge");
      assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", parents[1], "refs/remotes/origin/develop").status, 0, "非首父必须 reachable from origin/develop");
      gitCmd(dir, "checkout", "-q", "--detach"); // develop 不再被检出 ⇒ update-ref 可写 develop ref
      const ur = gitCmd(dir, "update-ref", "refs/heads/develop", mergeSha, base); // 裸 update-ref ⇒ 空 action
      assert.equal(ur.status, 0, `裸 git update-ref 应成功: ${ur.stderr}`);
      const reflog = gitCmd(dir, "reflog", "show", "develop", "--format=%h [%gs]").stdout;
      assert.match(reflog, /^\S+ \[\](?:\n|$)/m, `夹具必须产出空 action 的真实 reflog 行: ${reflog}`);

      const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
      assert.equal(r.status, 0, `publishedReconcile 落地不得判直投/NOT-EVALUATED: ${r.stdout}${r.stderr}`);
      const out = jsonOut(r);
      assert.equal(out.evaluated, true, "按结构分类 ⇒ 可评估");
      assert.equal(out.ok, true);
      assert.equal(out.unclassifiableCommits, 0, "publishedReconcile tip 不再落 unclassifiable（空 action 时恒落——这正是本任务）");
      assert.equal(out.classification.ratio, 1, "全部 first-parent 提交可分类");
      assert.equal(out.classification.unclassifiedActionForms.length, 0, "⛔ 不得被点名为「读不懂的 action 形」");
      // 独立计数（AC3 核心）：与 refMove / sanctioned 分列。
      assert.equal(out.denominator.publishedReconcileCommits, 1, "窗内 spine 上有 1 条 publishedReconcile tip（独立计数）");
      assert.equal(out.denominator.publishedReconcileNotEvaluatedCommits, 0);
      assert.equal(out.classification.publishedReconcileIntroducedTotal, 1);
      assert.equal(out.classification.publishedReconcileIntroduced[0].tip, mergeSha);
      assert.deepEqual(out.classification.publishedReconcileIntroduced[0].introduced.map((i) => i.sha), [mergeSha], "带入窗内的 first-parent 清单 = merge 自己");
      assert.equal(out.classification.publishedReconcileIntroduced[0].introduced[0].codeSurface, true, "可见：code-surface 标记（不静默豁免）");
      assert.equal(out.classification.refMoveIntroducedTotal, 0, "⛔ publishedReconcile 不得并入 refMove 读数");
      assert.equal(out.denominator.sanctionedRefMoveCommits, 0, "⛔ 不得并入 sanctioned 计数");
      assert.equal(out.denominator.totalDirectCommits, 0, "⛔ 不得计入直投分母 / fan-in 计数");
      assert.equal(out.denominator.codeSurfaceCommits, 0);
    } finally {
      cleanup(dir);
    }
  }
  // (negative b) 空 action ∧ merge ∧ 非首父**不** reachable from origin/develop（本地 merge）⇒ 仍 NOT-EVALUATED。
  {
    const { dir, base } = makeForkedDevelopRepo("cli-pubrec-neg");
    try {
      const published = commitCodeSurface(dir, "published.ts");
      gitCmd(dir, "update-ref", "refs/remotes/origin/develop", published);
      const local = commitCodeSurface(dir, "local-only.ts"); // 本地新 commit（origin/develop 不含它）
      assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", local, "refs/remotes/origin/develop").status, 0, "锚：local 不得 reachable from origin/develop");
      gitCmd(dir, "checkout", "-q", "-b", "localmergetmp", "develop");
      const mg = gitCmd(dir, "merge", "-q", "--no-ff", "-m", "Merge local branch", local);
      assert.equal(mg.status, 0, `fixture merge 应成功: ${mg.stderr}`);
      const mergeSha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
      gitCmd(dir, "checkout", "-q", "--detach");
      const ur = gitCmd(dir, "update-ref", "refs/heads/develop", mergeSha, base);
      assert.equal(ur.status, 0, `裸 git update-ref 应成功: ${ur.stderr}`);

      const r = runChecker(["--root", dir, "--develop", "develop", "--baseline", base]);
      assert.equal(r.status, 3, `本地 merge（非已发布线）⇒ 仍 NOT-EVALUATED exit 3（⛔ 不得 fail-open）: ${r.stdout}${r.stderr}`);
      const out = jsonOut(r);
      assert.equal(out.evaluated, false, "硬规则③b：读不懂 ≠ 合格");
      assert.equal(out.reason, "unsupported-reflog-action: (empty)", "reason 逐字点名 `(empty)`");
      assert.equal(out.denominator.publishedReconcileCommits, 0, "⛔ 本地 merge 不得被分类为 publishedReconcile");
      assert.equal(out.classification.publishedReconcileIntroducedTotal, 0);
    } finally {
      cleanup(dir);
    }
  }
});

// ── 批量取数（gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost）──────────────────
// 逐 commit 的 5 个 git 读取面（:813/:823/:833/:854/:863 = gitCommitFiles/Epoch/Parent/Subject/Message）
// 在一次 `--baseline b11ce720` 扫描里被调用 6913 + 288 次（实测计数），是墙钟 sys≫user 的驱动。改为
// gitCommitFilesBatch/gitCommitMetaBatch 各一次取数后，输出必须【逐字节不变】——下面三条差分测试钉住它，
// 第四条（GIT_TRACE）钉住「批量已接线」：回退到逐 commit ⇒ 变红。

/** 含 root commit + 普通提交 + merge commit 的最小 repo。
 *  merge 是钉子：裸 `git log --name-only` 对 merge 默认不输出改动（diff-merges=off）⇒ 必须
 *  `-m --first-parent` 才与逐条 `git diff <sha>^ <sha>` 一致。root commit 是另一钉子：无父 ⇒ 逐条/批量都 null。 */
function makeMergeRepo(prefix) {
  const dir = makeTmp(prefix);
  gitCmd(dir, "init", "-q", "-b", "develop");
  gitCmd(dir, "config", "user.name", "d2d-test");
  gitCmd(dir, "config", "user.email", "d2d@example.com");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "root.md"), "root\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCommitFixed(dir, FIXED_PAST, "tasks: root"); // root commit（无父）
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCommitFixed(dir, FIXED_PAST, "feat: a"); // 普通提交
  gitCmd(dir, "checkout", "-q", "-b", "side");
  fs.writeFileSync(path.join(dir, "side.txt"), "side\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCommitFixed(dir, FIXED_PAST, "feat: side");
  gitCmd(dir, "checkout", "-q", "develop");
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCommitFixed(dir, FIXED_PAST, "feat: b");
  const merge = gitCmd(dir, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  if (merge.status !== 0) throw new Error(`fixture merge failed: ${merge.stderr}`);
  const shas = gitCmd(dir, "rev-list", "HEAD").stdout.split("\n").filter(Boolean);
  return { dir, shas };
}

test("批量取数 — gitCommitFilesBatch 在 root/普通/merge 三形态上与逐条 gitCommitFiles 逐字节一致", () => {
  const { dir, shas } = makeMergeRepo("batch-files");
  try {
    assert.ok(shas.length >= 4, "夹具至少有 root + a + b + merge");
    const batch = gitCommitFilesBatch(dir, shas);
    for (const sha of shas) {
      const per = gitCommitFiles(dir, sha);
      const got = batch.has(sha) ? batch.get(sha) : null;
      assert.deepEqual(got, per, `${sha.slice(0, 8)} 批量 files 必须与逐条一致`);
    }
    const rootSha = shas[shas.length - 1];
    assert.equal(gitCommitFiles(dir, rootSha), null, "root commit 逐条 ⇒ null（无父可 diff）");
    assert.equal(batch.get(rootSha), null, "root commit 批量 ⇒ null");
    const mergeSha = shas.find(
      (s) => gitCmd(dir, "log", "-1", "--format=%P", s).stdout.trim().split(" ").filter(Boolean).length >= 2,
    );
    assert.ok(mergeSha, "夹具必须含一个 merge commit");
    assert.deepEqual(batch.get(mergeSha), gitCommitFiles(dir, mergeSha), "merge 批量必须与逐条一致");
    assert.ok(
      (batch.get(mergeSha) ?? []).length > 0,
      "merge commit 文件集非空——钉住 `-m --first-parent`（去掉它 merge 退化成空集 ⇒ 本断言变红）",
    );
  } finally {
    cleanup(dir);
  }
});

test("批量取数 — gitCommitMetaBatch 的 epoch/parent/subject/message 与逐条读取面逐字段一致", () => {
  const { dir, shas } = makeMergeRepo("batch-meta");
  try {
    const batch = gitCommitMetaBatch(dir, shas);
    for (const sha of shas) {
      const m = batch.get(sha);
      assert.ok(m, `${sha.slice(0, 8)} 必须在批量结果里`);
      assert.equal(m.epoch, gitCommitEpoch(dir, sha), "epoch");
      assert.equal(m.parent, gitCommitParent(dir, sha), "parent（第一父）");
      assert.equal(m.subject, gitCommitSubject(dir, sha), "subject");
      assert.equal(m.message, gitCommitMessage(dir, sha), "message（%B）");
    }
  } finally {
    cleanup(dir);
  }
});

test("批量取数 — 边界：空输入 ⇒ 空 Map；非法 sha ⇒ null（fail-closed，⛔ 不伪装成空文件集）；不连坐同块", () => {
  const { dir, shas } = makeMergeRepo("batch-edge");
  try {
    assert.equal(gitCommitFilesBatch(dir, []).size, 0, "空输入 ⇒ 空 Map");
    assert.equal(gitCommitMetaBatch(dir, []).size, 0, "空输入 ⇒ 空 Map");
    const bogus = "0".repeat(40);
    assert.equal(gitCommitFilesBatch(dir, [bogus]).get(bogus) ?? null, null, "非法 sha ⇒ null（⛔ 不是空文件集 []）");
    assert.equal(
      (gitCommitMetaBatch(dir, [bogus]).get(bogus) ?? { epoch: null }).epoch,
      null,
      "非法 sha ⇒ epoch null（调用方据此跳过）",
    );
    // 逐条回退：同块含一条非法 sha，不得连坐丢掉合法 sha（旧逐条读面对合法 sha 仍读得出）。
    const mixed = gitCommitFilesBatch(dir, [shas[0], bogus]);
    assert.deepEqual(mixed.get(shas[0]), gitCommitFiles(dir, shas[0]), "同块非法 sha 不得连坐合法 sha");
  } finally {
    cleanup(dir);
  }
});

test("批量取数接线（mutation nail）— checker 子进程不再逐 commit 起 git：GIT_TRACE 计数钉住回退", () => {
  const dir = makeTmp("batch-wiring");
  const savedTrace = process.env.GIT_TRACE;
  const traceFile = path.join(os.tmpdir(), `d2d-trace-${process.pid}-${Date.now()}.log`);
  try {
    initRepo(dir);
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "test", "x.test.mjs"), "export const x = 1;\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "test: direct code commit");
    // GIT_TRACE 指向**文件**（不是 "1"）：checker 的 git() 用 stdio stderr="ignore" ⇒ 写 stderr 会被那层
    // 重定向吞掉，只有文件形态能穿过它被本测试读到。
    process.env.GIT_TRACE = traceFile;
    const r = runChecker(["--root", dir]);
    const raw = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, "utf8") : "";
    const trace = raw.split("\n").filter((l) => l.includes("trace: built-in: git"));
    assert.ok(trace.length > 0, `GIT_TRACE 必须产出子进程轨迹（否则本测试无法判定）: ${r.stderr}`);
    assert.equal(
      trace.filter((l) => l.includes("diff --name-only")).length,
      0,
      "逐 commit `git diff --name-only <sha>^ <sha>` 必须已被批量取数取代（回退 ⇒ 变红）",
    );
    assert.equal(
      trace.filter((l) => l.includes("--format=%ct")).length,
      0,
      "逐 commit `git log -1 --format=%ct` 必须已被批量取数取代（回退 ⇒ 变红）",
    );
    assert.ok(
      trace.some((l) => l.includes("--no-walk")),
      "批量取数（git log --no-walk ...）必须真的被调用（否则本测试空转）",
    );
  } finally {
    if (savedTrace === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = savedTrace;
    try { fs.rmSync(traceFile, { force: true }); } catch { /* best-effort */ }
    cleanup(dir);
  }
});
