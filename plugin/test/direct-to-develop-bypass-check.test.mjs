// @test-group engine
// direct-to-develop-bypass-check.test.mjs — 直接提交 develop 绕过 fan-in 机件的检测器
// (tasks/gap-direct-to-develop-bypasses-fan-in-gates, 11b/C17 写所有权/越权直改面),
// plugin/scripts/direct-to-develop-bypass-check.ts.
//
// 能取假（AC3）：真样本（7e64a86b + 核心子集 4 条 7d1d5d2e/b389a758/18e7a3be/77174684）必须报红；
// 设计内样本（.gitignore / manager 独占 / 热修 fan-in 机件本身）必须绿。回放走两条路：
//   ① 真实 git 读（REPO_ROOT 的 develop 历史含这些样本——它们是 develop 的祖先），喂纯判定；
//   ② 硬编码 fixture（file 清单 + 时刻，取自真提交）——在无该历史的 hermetic clone 里也跑。
// 另覆盖：锁时间窗豁免、设计内/外分离（AC2）、NOT-EVALUATED（reflog 无 / 锁事件不成对，硬规则3b）、
// CLI 集成（temp repo：直接提交代码面 ⇒ RED；直接提交 .gitignore ⇒ GREEN；fan-in ff 不误报）。
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

/** 从 REPO_ROOT 的真实 git 读一条 commit 的 (files, epoch)——回放真样本的「actual git」读面。 */
function realCommitData(sha) {
  const diff = gitCmd(REPO_ROOT, "diff", "--name-only", `${sha}^`, sha);
  if (diff.status !== 0) return null;
  const files = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const epoch = gitCmd(REPO_ROOT, "log", "-1", "--format=%ct", sha).stdout.trim();
  if (!/^\d+$/.test(epoch)) return null;
  const subject = gitCmd(REPO_ROOT, "log", "-1", "--format=%s", sha).stdout.trim();
  return { sha, files, epoch: Number(epoch), subject };
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
  { sha: "task-file", files: ["tasks/gap-xxx.md"], subject: "tasks: 立案" },
];

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
    "CLAUDE.md",
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
    "plugin/skills/init/SKILL.md",
    "plugin/skills/manager/SKILL.md",
    "plugin/scripts/ready-pool-check.ts",
    "packages/quay/src/mcp-server.ts",
    "scripts/test.sh",
    "README.md",
  ];
  for (const p of codeSurface) assert.equal(isDesignInternalPath(p), false, `代码面不应排除: ${p}`);
  // 反向：`fan-in-` 前缀只在 plugin/scripts|test 顶层豁免——不要误伤 loop-shipping 等。
  assert.equal(isDesignInternalPath("plugin/scripts/loop-shipping-exclusion-data.mjs"), false);
  assert.equal(isDesignInternalPath("plugin/test/fan-in-ff-merge.test.mjs"), true, "fan-in 机件测试豁免");
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
  assert.equal(v2.designInternalCommits, 6);

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

const REAL_SHAS = ["7e64a86b", "7d1d5d2e", "b389a758", "18e7a3be", "77174684", "5e54bb37"];

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

test("--help exits 0 with usage on stdout", () => {
  const r = runChecker(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /direct-to-develop-bypass-check/);
});
