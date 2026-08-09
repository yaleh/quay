// @test-group engine
// inner-exec-mode-report.test.mjs — RED/GREEN fixture tests for inner-exec-mode-report.ts
// (tasks/gap-inner-serial-main-thread-not-dispatch, AC2/AC3/AC5).
//
// The helper turns "inner 是主线程串行做实现、还是派 subagent 并行做实现" into two mechanically
// countable numbers: main-thread Edit-product-file count : Agent-dispatch count. These fixtures pin:
//   AC2 — the two-number report is mechanical: main_thread_edits counts only tool_use name="Edit"
//         whose input.file_path is a PRODUCT file (plugin/scripts/|plugin/test/|packages/), NOT
//         tasks/ or docs; agent_dispatches counts tool_use name="Agent". --since windows the count.
//   AC3 — red-window white-list (documented in the tick docs) is not mis-fired by the helper: a
//         main-thread Edit of a task file (立案) or a doc (红窗快修分诊) does NOT count toward
//         main_thread_edits — the white-listed classes are structurally excluded at the source.
//   AC5 — no regression: the module is importable, the CLI emits --json with the two numbers, the
//         auto-detect prefers the repo-slug session dir (hermetic via the INNER_EXEC_MODE_PROJECTS_DIR
//         seam).
//
// Hermetic: fixtures are written to mkdtemp dirs under os.tmpdir(); nothing touches the real
// ~/.claude/projects. The auto-detect test overrides the projects dir via the env seam.
//
// Run:
//   scripts/test.sh plugin/test/inner-exec-mode-report.test.mjs
//   node --test plugin/test/inner-exec-mode-report.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(__dirname, "..", "scripts", "inner-exec-mode-report.ts");

let mod;
try {
  mod = await import(MODULE);
} catch (e) {
  throw new Error(`cannot import ${MODULE}: ${e.message}`);
}

// ── fixture helpers ────────────────────────────────────────────────────────────────────────────────

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(tmp) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}
function toolUse(name, input, ts = "2026-08-09T12:00:00.000Z", type = "assistant") {
  return { type, timestamp: ts, message: { content: [{ type: "tool_use", name, input }] } };
}
function writeSession(dir, name, records, { appendBroken = false } = {}) {
  const p = path.join(dir, name);
  const lines = records.map((r) => JSON.stringify(r));
  if (appendBroken) lines.push("{ this is not valid json");
  fs.writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

// ── AC2: 计数定义 —— 产品文件 Edit 才计 main_thread_edits；tasks/docs 不计；Agent 单列 ─────────────

test("AC2 — 产品文件 Edit 计入 main_thread_edits；tasks/ 与 docs/ 不算；Agent 单列", () => {
  const tmp = mkTmp("ier-ac2a-");
  try {
    const repoRoot = path.join(tmp, "repo");
    const records = [
      // 产品文件 Edit（plugin/scripts/）→ 计 main_thread_edits
      toolUse("Edit", { file_path: path.join(repoRoot, "plugin/scripts/ready-pool-check.ts") }, "2026-08-09T12:00:00Z"),
      // 产品文件 Edit（packages/）→ 计
      toolUse("Edit", { file_path: "packages/quay/src/gate/engine.ts" }, "2026-08-09T12:00:01Z"),
      // 产品文件 Edit（plugin/test/）→ 计
      toolUse("Edit", { file_path: "plugin/test/x.test.mjs" }, "2026-08-09T12:00:02Z"),
      // 任务文件 Edit（tasks/）→ 不计（立案/自勾 AC 是白名单内，不判违，AC3）
      toolUse("Edit", { file_path: path.join(repoRoot, "tasks/gap-foo.md") }, "2026-08-09T12:00:03Z"),
      // 文档 Edit（docs/ + orchestration/ + plugin/loop/ 的 .md）→ 不计（红窗分诊/编排）
      toolUse("Edit", { file_path: "docs/proposals/exp5.md" }, "2026-08-09T12:00:04Z"),
      toolUse("Edit", { file_path: "orchestration/manager-loop-tick.md" }, "2026-08-09T12:00:05Z"),
      toolUse("Edit", { file_path: "plugin/loop/fast-mode-loop-tick.md" }, "2026-08-09T12:00:06Z"),
      // 仓库外绝对路径（worktree 产物）→ 不算产品文件
      toolUse("Edit", { file_path: "/home/yale/work/quay-worktrees/gap-x/plugin/scripts/other.ts" }, "2026-08-09T12:00:07Z"),
      // Agent 派发 → 单独计数
      toolUse("Agent", { run_in_background: true }, "2026-08-09T12:00:08Z"),
      toolUse("Agent", { description: "x" }, "2026-08-09T12:00:09Z"),
      // 非 Edit/Agent 工具 → 不计
      toolUse("Bash", { command: "echo hi" }, "2026-08-09T12:00:10Z"),
      toolUse("Read", { file_path: "plugin/scripts/foo.ts" }, "2026-08-09T12:00:11Z"),
    ];
    const res = mod.analyzeRecords(records, { repoRoot });
    assert.equal(res.main_thread_edits, 3, "恰好 3 次产品文件 Edit（plugin/scripts + packages + plugin/test）");
    assert.equal(res.agent_dispatches, 2, "恰好 2 次 Agent 派发");
    assert.equal(res.total_edits, 8, "8 次 Edit 工具调用（含 task/doc/outside）");
    assert.equal(res.edits_no_file_path, 0, "本 fixture 无缺 file_path 的 Edit");
  } finally { cleanup(tmp); }
});

test("AC2 — Edit 无 input.file_path 单列 edits_no_file_path，不计入 main_thread_edits（不跳过、不静默少报）", () => {
  const tmp = mkTmp("ier-ac2b-");
  try {
    const repoRoot = path.join(tmp, "repo");
    const records = [
      toolUse("Edit", { some_other_field: 1 }),
      toolUse("Edit", { file_path: "plugin/scripts/a.ts" }),
    ];
    const res = mod.analyzeRecords(records, { repoRoot });
    assert.equal(res.total_edits, 2);
    assert.equal(res.main_thread_edits, 1, "有 file_path 的产品 Edit 照常计入");
    assert.equal(res.edits_no_file_path, 1, "无 file_path 的 Edit 单列，不计入 main_thread_edits");
  } finally { cleanup(tmp); }
});

test("AC2 — 畸形行被容忍跳过；--since 窗口只数该时刻之后的调用", () => {
  const tmp = mkTmp("ier-ac2c-");
  try {
    const repoRoot = path.join(tmp, "repo");
    const p = writeSession(tmp, "inner.jsonl", [
      toolUse("Edit", { file_path: "plugin/scripts/early.ts" }, "2026-08-09T11:00:00Z"),
      toolUse("Edit", { file_path: "plugin/scripts/after.ts" }, "2026-08-09T12:30:00Z"),
      toolUse("Agent", { run_in_background: true }, "2026-08-09T12:31:00Z"),
    ], { appendBroken: true });
    // 全量：2 产品 Edit + 1 Agent
    const all = mod.analyzeRecords(mod.loadTranscript(p), { repoRoot });
    assert.equal(all.main_thread_edits, 2);
    assert.equal(all.agent_dispatches, 1);
    assert.equal(all.total_edits, 2, "畸形行不产生假 Edit");
    // --since 12:00Z：只剩 after.ts + Agent
    const since = mod.analyzeRecords(mod.loadTranscript(p), { repoRoot, since: "2026-08-09T12:00:00Z" });
    assert.equal(since.main_thread_edits, 1);
    assert.equal(since.agent_dispatches, 1);
  } finally { cleanup(tmp); }
});

// ── 分类函数直接钉 ────────────────────────────────────────────────────────────────────────────────────

test("isProductFile / classifyEditInput — 路径判定与白名单边界", () => {
  const repoRoot = "/home/yale/work/quay";
  assert.equal(mod.isProductFile("plugin/scripts/x.ts", repoRoot), true);
  assert.equal(mod.isProductFile("/home/yale/work/quay/plugin/scripts/x.ts", repoRoot), true);
  assert.equal(mod.isProductFile("plugin/test/x.test.mjs", repoRoot), true);
  assert.equal(mod.isProductFile("packages/quay/src/x.ts", repoRoot), true);
  assert.equal(mod.isProductFile("tasks/gap-foo.md", repoRoot), false, "任务文件白名单");
  assert.equal(mod.isProductFile("docs/proposals/x.md", repoRoot), false, "docs 白名单");
  assert.equal(mod.isProductFile("orchestration/manager-loop-tick.md", repoRoot), false, "orchestration 文档白名单");
  assert.equal(mod.isProductFile("plugin/loop/fast-mode-loop-tick.md", repoRoot), false, "tick 文档白名单");
  assert.equal(mod.isProductFile("/tmp/other.ts", repoRoot), false, "仓库外不算");
  assert.equal(mod.classifyEditInput({ file_path: "plugin/scripts/x.ts" }, repoRoot), "product");
  assert.equal(mod.classifyEditInput({ file_path: "tasks/gap-foo.md" }, repoRoot), "not-product");
  assert.equal(mod.classifyEditInput({}, repoRoot), "no-file-path");
  assert.equal(mod.classifyEditInput(null, repoRoot), "no-file-path");
});

// ── CLI：--json 输出两数 + --session/--repo-root/--since 接线 ─────────────────────────────────────

test("CLI — --json 输出 main_thread_edits / agent_dispatches / session；缺文件退出 2", () => {
  const tmp = mkTmp("ier-cli-");
  try {
    const repoRoot = path.join(tmp, "repo");
    const p = writeSession(tmp, "inner.jsonl", [
      toolUse("Edit", { file_path: path.join(repoRoot, "plugin/scripts/a.ts") }),
      toolUse("Edit", { file_path: "tasks/gap-b.md" }),
      toolUse("Agent", { run_in_background: true }),
    ]);
    const res = spawnSync("node", [
      "--no-warnings", "--experimental-strip-types", MODULE,
      "--session", p, "--repo-root", repoRoot, "--json",
    ], { encoding: "utf8" });
    assert.equal(res.status, 0, `CLI exit ${res.status}\nstderr: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.main_thread_edits, 1);
    assert.equal(out.agent_dispatches, 1);
    assert.equal(out.total_edits, 2);
    assert.equal(out.session, p);
    assert.equal(out.repo_root, repoRoot);

    // 缺文件 → 退出 2
    const missing = spawnSync("node", [
      "--no-warnings", "--experimental-strip-types", MODULE,
      "--session", path.join(tmp, "nope.jsonl"), "--repo-root", repoRoot,
    ], { encoding: "utf8" });
    assert.equal(missing.status, 2, "--session 指向不存在的文件必须退出 2");
  } finally { cleanup(tmp); }
});

test("CLI — --since 窗口化输出；人类可读格式包含两数", () => {
  const tmp = mkTmp("ier-cli2-");
  try {
    const repoRoot = path.join(tmp, "repo");
    const p = writeSession(tmp, "inner.jsonl", [
      toolUse("Edit", { file_path: "plugin/scripts/early.ts" }, "2026-08-09T11:00:00Z"),
      toolUse("Edit", { file_path: "plugin/scripts/late.ts" }, "2026-08-09T12:30:00Z"),
      toolUse("Agent", { run_in_background: true }, "2026-08-09T12:31:00Z"),
    ]);
    const res = spawnSync("node", [
      "--no-warnings", "--experimental-strip-types", MODULE,
      "--session", p, "--repo-root", repoRoot,
      "--since", "2026-08-09T12:00:00Z", "--json",
    ], { encoding: "utf8" });
    assert.equal(res.status, 0, `CLI exit ${res.status}\nstderr: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.main_thread_edits, 1);
    assert.equal(out.agent_dispatches, 1);
    assert.equal(out.since, "2026-08-09T12:00:00Z");

    const human = spawnSync("node", [
      "--no-warnings", "--experimental-strip-types", MODULE,
      "--session", p, "--repo-root", repoRoot,
    ], { encoding: "utf8" });
    assert.equal(human.status, 0);
    assert.match(human.stdout, /main_thread_edits: 2/);
    assert.match(human.stdout, /agent_dispatches: 1/);
  } finally { cleanup(tmp); }
});

// ── AC5: 自动检测 —— 优先仓库 slug 会话目录（hermetic 接缝）───────────────────────────────────────

test("detectSession — 优先仓库 slug 匹配的会话目录（同分取最新），无匹配退回最新整体", () => {
  const tmp = mkTmp("ier-detect-");
  try {
    const repoRoot = path.join(tmp, "repo");
    const slug = mod.repoSlug(repoRoot);
    // 仓库专属目录（slug 名）下放两个会话：旧 + 新
    const repoDir = path.join(tmp, "projects", slug);
    fs.mkdirSync(repoDir, { recursive: true });
    const oldSess = writeSession(repoDir, "old.jsonl", [toolUse("Edit", { file_path: "plugin/scripts/old.ts" })]);
    const newSess = writeSession(repoDir, "new.jsonl", [toolUse("Agent", { run_in_background: true })]);
    const oldSt = fs.statSync(oldSess);
    fs.utimesSync(oldSess, new Date(oldSt.atimeMs - 60000), new Date(oldSt.mtimeMs - 60000));

    // 非仓库目录（不同 slug）
    const otherDir = path.join(tmp, "projects", "-some-other-project");
    fs.mkdirSync(otherDir, { recursive: true });
    const otherSess = writeSession(otherDir, "other.jsonl", [toolUse("Edit", { file_path: "x.ts" })]);
    const otherSt = fs.statSync(otherSess);
    fs.utimesSync(otherSess, new Date(otherSt.atimeMs - 30000), new Date(otherSt.mtimeMs - 30000));

    // slug 目录存在 ⇒ 优先仓库会话（即使 other 更新）
    const projectsDir = path.join(tmp, "projects");
    const picked = mod.detectSession(repoRoot, projectsDir);
    assert.equal(picked, newSess, "仓库 slug 目录内最新会话被选中，而不是全局最新");

    // 无仓库 slug 目录 ⇒ 退回全局最新（这里 otherSess 是被改成更新的那个）
    const projectsDir2 = path.join(tmp, "projects2");
    fs.mkdirSync(projectsDir2, { recursive: true });
    const a = writeSession(projectsDir2, "a.jsonl", [toolUse("Edit", { file_path: "plugin/scripts/a.ts" })]);
    const b = writeSession(projectsDir2, "b.jsonl", [toolUse("Edit", { file_path: "plugin/scripts/b.ts" })]);
    const aSt = fs.statSync(a);
    fs.utimesSync(a, new Date(aSt.atimeMs - 60000), new Date(aSt.mtimeMs - 60000));
    const picked2 = mod.detectSession(repoRoot, projectsDir2);
    assert.equal(picked2, b, "无 slug 匹配时取 mtime 最新");
  } finally { cleanup(tmp); }
});

// ── AC5: @test-group 声明 ───────────────────────────────────────────────────────────────────────────

test("AC5 — 本测试文件声明 // @test-group engine", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /@test-group\s+engine/, "new test file must declare @test-group engine");
});
