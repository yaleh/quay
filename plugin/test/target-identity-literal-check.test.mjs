// @test-group engine
// target-identity-literal-check.test.mjs — RED/GREEN tests for the TARGET 域无 override 裸身份字面量
// 检查器（plugin/scripts/target-identity-literal-check.ts, GOAL-012 B 域 / tasks/gap-ac226-…）。
//
// 判定对象（能取假，硬规则 3/4）：shipped kernel 把逐项目不同的身份（分支名 / test_command /
// tasks_dir）写成无 override 通道的裸字面量、而非从目标项目 config / 运行时 git 状态派生 ——
// 「人工枚举 3 次 3 漏」的机械枚举取代人工枚举的落点。判别标准（写进实现，⛔ 不留给读者意会）：
// 逐项目不同 ∧ 无 override 通道。
//
// 双向断言（AC4 本条重点）：干净夹具 ⇒ 检查器绿；注入「分支名 / test_command / tasks_dir 各一例」
// 无 override 字面量 ⇒ 检查器红（⛔ 三种身份逐条断言，不止一种形态）；移除 ⇒ 绿。负控制：
// develop/integration/master（+ tasks/HEAD）合法默认值不被误报（AC-226 负控制方向）。override 通道
// 形态（getArgValue(...) ?? "develop" / opts.x ?? "develop" / path.join(root, "tasks") /
// readLoopTestCommand(...)）不算「无 override 裸字面量」，不报。
//
// path→content (gap-b5-input-shape-path-to-content): 判定逻辑测试 scanText(src) 纯函数——零 spawn。
// CLI 壳（main）在进程内对着临时 fixture 目录跑（不 spawn 子进程）；目录用 mkdtempSync + t.after
// 清理（tmp-leak-pairing-check 的配对契约）。
//
// Run:
//   scripts/test.sh plugin/test/target-identity-literal-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanText, scanSurface, main, isLegalDefault, classifyIdent, normIdent, runCheck } from "../scripts/target-identity-literal-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Run `fn` in-process, capturing console.log/console.error AND process.stdout/stderr.write (the CLI
 *  shell prints via process.stdout.write / process.stderr.write, never spawning a subprocess).
 *  Returns { result, stdout, stderr }. */
function captureConsole(fn) {
  const origLog = console.log, origErr = console.error;
  const origOutWrite = process.stdout.write, origErrWrite = process.stderr.write;
  const out = [], err = [];
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  try { return { result: fn(), stdout: out.join("\n").replace(/\n$/, ""), stderr: err.join("\n").replace(/\n$/, "") }; }
  finally {
    console.log = origLog; console.error = origErr;
    process.stdout.write = origOutWrite; process.stderr.write = origErrWrite;
  }
}

// ── 判别标准（逐项目不同 ∧ 无 override 通道）写进实现 —— 单元级断言 ───────────────────────────────
test("classifyIdent maps the three identity kinds by identifier semantics", () => {
  assert.equal(classifyIdent(normIdent("DOC_BRANCH")), "branch");
  assert.equal(classifyIdent(normIdent("mergeTarget")), "branch");
  assert.equal(classifyIdent(normIdent("mainlineRef")), "branch");
  assert.equal(classifyIdent(normIdent("test_command")), "test-command");
  assert.equal(classifyIdent(normIdent("TEST_COMMAND")), "test-command");
  assert.equal(classifyIdent(normIdent("tasks_dir")), "tasks-dir");
  assert.equal(classifyIdent(normIdent("tasksDir")), "tasks-dir");
  assert.equal(classifyIdent(normIdent("tasksDirRelative")), "tasks-dir");
  assert.equal(classifyIdent(normIdent("unrelated")), null);
});

test("isLegalDefault exempts protocol-fixed defaults (develop/integration/master/tasks/HEAD)", () => {
  for (const v of ["develop", "integration", "master", "tasks", "HEAD", "./tasks", "develop integration"]) {
    assert.ok(isLegalDefault(v), `${v} must be a legal default`);
  }
  for (const v of ["author", "main", "my-tasks", "npm test", ""]) {
    assert.ok(!isLegalDefault(v), `${v} must NOT be a legal default`);
  }
});

// ── GREEN: 干净 / 合法默认值 / override 通道 / 字符串里的配置模板 ⇒ 检查器绿 ──────────────────────
test("GREEN: a runtime-derived identity (resolveDocBranch / readLoopTestCommand / path.join) has 0 violations", () => {
  const src = [
    'import { resolveDocBranch } from "./driver-filters.ts";',
    'export function docBranch(root) { return resolveDocBranch(root) ?? null; }',
    'export function run(root) { const tasksDir = path.join(root, "tasks"); return tasksDir; }',
  ].join("\n");
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: legal protocol defaults (develop/integration/master/tasks/HEAD) are NOT violations", () => {
  const src = [
    'export const DEV_BRANCH = "develop";',
    'export const INTEGRATION_REF = "integration";',
    'export const MASTER_REF = "master";',
    'export const TASKS_DIR_DEFAULT = "tasks";',
    'export const HEAD_REF = "HEAD";',
  ].join("\n");
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: an override-channel literal (getArgValue(...) ?? \"develop\" / opts.x ?? \"develop\") is NOT bare", () => {
  const src = [
    'export const mergeTarget = getArgValue(args, "--merge-target") ?? "develop";',
    'export function f(opts) { const mt = opts.mergeTarget ?? "develop"; return mt; }',
  ].join("\n");
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: a comment that merely SPELLS the pattern does not report (按位置不按关键词)", () => {
  const src = '// 违例形: export const DOC_BRANCH = "author" is the defect\nexport const x = 1;\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: a string literal carrying the config template text is NOT code", () => {
  const src = 'export const CONFIG_TEMPLATE = "    tasks_dir: \\"./tasks\\"";\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

// ── RED: 三种身份【各一例】⇒ 检查器红（GOAL-012 风险 4：不止一种） ───────────────────────────────
test("RED (branch): `export const DOC_BRANCH = \"author\"` is a violation", () => {
  const src = 'export const DOC_BRANCH = "author";\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].kind, "branch");
  assert.equal(v[0].value, "author");
});

test("RED (test-command): `export const test_command = \"npm test\"` is a violation", () => {
  const src = 'export const test_command = "npm test";\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].kind, "test-command");
  assert.equal(v[0].value, "npm test");
});

test("RED (tasks-dir): `export const tasks_dir = \"my-tasks\"` is a violation", () => {
  const src = 'export const tasks_dir = "my-tasks";\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].kind, "tasks-dir");
  assert.equal(v[0].value, "my-tasks");
});

test("RED (object-key form): `tasks_dir: \"my-tasks\"` and `test_command: \"npm test\"` are violations", () => {
  const src = 'export const cfg = { tasks_dir: "my-tasks", test_command: "npm test" };\n';
  const v = scanText(src);
  assert.equal(v.length, 2, JSON.stringify(v));
  assert.deepEqual(v.map((x) => x.kind).sort(), ["tasks-dir", "test-command"].sort());
});

// ── 移除 ⇒ 绿（双向的另一半） ──────────────────────────────────────────────────────────────────────
test("GREEN: removing the injected literal restores 0 violations (注入⇒红 移除⇒绿)", () => {
  const injected = 'export const DOC_BRANCH = "author";\n';
  assert.equal(scanText(injected).length, 1);
  const removed = injected.replace(/export const DOC_BRANCH = "author";/, "export const DOC_BRANCH = resolveDocBranch(root);");
  assert.deepEqual(scanText(removed), [], JSON.stringify(scanText(removed)));
});

// ── 扫描面（AC1：shipped kernel 面显式枚举 plugin/scripts + packages/quay/src） ────────────────────
test("scanSurface covers the shipped kernel surface (plugin/scripts + packages/quay/src)", () => {
  const surface = scanSurface(REPO_ROOT);
  assert.ok(surface.includes("plugin/scripts/driver-filters.ts"), "the DOC_BRANCH former carrier must be in the surface");
  assert.ok(surface.includes("plugin/scripts/target-identity-literal-check.ts"), "the checker itself must be in the surface");
  assert.ok(surface.includes("packages/quay/src/init.ts"), "the config-template carrier must be in the surface");
  assert.ok(!surface.some((f) => f.includes("/dist/")), "dist bundles excluded");
  assert.ok(!surface.some((f) => f.includes("/checker-mutation-cases/")), "mutation cases excluded");
  assert.ok(!surface.some((f) => f.endsWith(".sh")), "shell scripts excluded (heredoc config-writes are not kernel identity code)");
});

// ── CLI 壳（in-process，无 subprocess）：临时 fixture 目录双向 ──────────────────────────────────────
test("CLI --root over a clean fixture: exit 0, pass, violations [] (in-process)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tid-clean-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "fixture.ts"), 'export const x = 1;\n', "utf8");
  const { result, stdout } = captureConsole(() => main(["--root", dir, "--json"]));
  assert.equal(result, 0, stdout);
  const d = JSON.parse(stdout);
  assert.equal(d.status, "pass");
  assert.ok(Array.isArray(d.violations));
  assert.equal(d.violations.length, 0);
});

test("CLI --root over an injected fixture: exit 1, fail, 1 violation (in-process)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tid-red-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "fixture.ts"), 'export const DOC_BRANCH = "author";\n', "utf8");
  const { result, stdout } = captureConsole(() => main(["--root", dir, "--json"]));
  assert.equal(result, 1, stdout);
  const d = JSON.parse(stdout);
  assert.equal(d.status, "fail");
  assert.equal(d.violations.length, 1);
  assert.equal(d.violations[0].kind, "branch");
});

test("CLI --root over the REAL repo: exit 0 (本仓库枚举归零 — AC2)", () => {
  const { result, stdout } = captureConsole(() => main(["--root", REPO_ROOT, "--json"]));
  assert.equal(result, 0, stdout);
  const d = JSON.parse(stdout);
  assert.equal(d.status, "pass");
  assert.equal(d.violations.length, 0, "本仓库必须枚举归零（DOC_BRANCH 残量已消除）");
});

// ── goal-branch token rule (SPEC-goal-branch-2026-10-03.md §4.8) ──────────────────────────────────
// `goal/<GOAL-NNN>` is a DERIVED branch name, so a literal spelling one is legal ONLY while the GOAL
// it names is a live branch-mode goal (exists ∧ `branch: true` ∧ not superseded/retired). An
// unreadable goal store WITHHOLDS the verdict (exit 3) — ⛔ never admitted as legal (hard rule 3b).

/** A temp root carrying a kernel fixture with a bare `goal/GOAL-901` literal + an optional goal store. */
function goalBranchFixture({ status = "active", branch = "true", withGoals = true, record = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tid-goal-branch-"));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin", "scripts", "fixture.ts"),
    'export const GOAL_BRANCH = "goal/GOAL-901";\n',
    "utf8",
  );
  if (withGoals) {
    fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
    if (record) {
      fs.writeFileSync(
        path.join(dir, "goals", "GOAL-901-fixture.md"),
        `---\nid: GOAL-901\nstatus: ${status}\nkind: goal\nbranch: ${branch}\norigin: fixture\n---\nbody\n`,
        "utf8",
      );
    }
  }
  return dir;
}

test("goal-branch token: LEGAL while the GOAL is a live branch-mode goal (exit 0)", (t) => {
  const dir = goalBranchFixture({ status: "active", branch: "true" });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { result, stdout } = captureConsole(() => main(["--root", dir, "--json"]));
  assert.equal(result, 0, stdout);
  const d = JSON.parse(stdout);
  assert.equal(d.status, "pass");
  assert.equal(d.violations.length, 0);
});

test("goal-branch token: ILLEGAL once the GOAL is retired or superseded (its branch must be gone)", (t) => {
  for (const status of ["retired", "superseded"]) {
    const dir = goalBranchFixture({ status, branch: "true" });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { result, stdout } = captureConsole(() => main(["--root", dir, "--json"]));
    assert.equal(result, 1, `${status}: ${stdout}`);
    const d = JSON.parse(stdout);
    assert.equal(d.status, "fail", status);
    assert.equal(d.violations.length, 1, status);
    assert.equal(d.violations[0].value, "goal/GOAL-901", status);
  }
});

test("goal-branch token: ILLEGAL when the GOAL is absent (readable store, no record) or not branch-mode", (t) => {
  for (const opts of [{ record: false }, { branch: "false" }]) {
    const dir = goalBranchFixture(opts);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { result, stdout } = captureConsole(() => main(["--root", dir, "--json"]));
    assert.equal(result, 1, `${JSON.stringify(opts)}: ${stdout}`);
    assert.equal(JSON.parse(stdout).violations.length, 1, JSON.stringify(opts));
  }
});

test("goal-branch token: an UNREADABLE goal store withholds the verdict (exit 3, never 'legal')", (t) => {
  const dir = goalBranchFixture({ withGoals: false }); // no `goals/` dir at all
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { result, stdout } = captureConsole(() => main(["--root", dir, "--json"]));
  assert.equal(result, 3, stdout);
  assert.equal(JSON.parse(stdout).status, "not-evaluated");
});
