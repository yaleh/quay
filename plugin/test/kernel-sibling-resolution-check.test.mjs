// @test-group engine
// kernel-sibling-resolution-check.test.mjs — RED/GREEN tests for the KERNEL 域 naive sibling 解析
// 检查器（plugin/scripts/kernel-sibling-resolution-check.ts, GOAL-012 A 域 / tasks/gap-ac224-…）。
//
// 判定对象（能取假，硬规则 3/4）：shipped kernel 把自己的 sibling 脚本锚在 target root / naive
// `__dirname` / 模板字符串形态、而非经 `resolveKernelSibling`/`resolveKernelPluginRoot` ——
// 「立条实测 9 处 naive __dirname」的机械枚举取代人工枚举的落点（AC-203 前例：
// cli/driver.ts 锚 workspace root，quay-init 取消 plugin/ 拷贝后第三方项目死于 kernel not found）。
//
// 双向断言（AC3 本条重点）：干净夹具 ⇒ 检查器绿；注入三种拼接形态【各一例】⇒ 检查器红
// （⛔ 三种形态逐条断言，不止一种——GOAL-012 风险 4）。DEV-TREE-ONLY 豁免（风险 2）也逐条钉住：
// 带 `kernel-sibling-dev-tree-only:` 标记（带理由）的 naive 锚点 ⇒ 绿（豁免带理由、可复核）。
//
// path→content (gap-b5-input-shape-path-to-content): 判定逻辑测试 scanText(src) 纯函数——零 spawn。
// CLI 壳（main）在进程内对着临时 fixture 目录跑（不 spawn 子进程）；目录用 mkdtempSync + t.after
// 清理（tmp-leak-pairing-check 的配对契约）。
//
// Run:
//   scripts/test.sh plugin/test/kernel-sibling-resolution-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanText, scanSurface, main } from "../scripts/kernel-sibling-resolution-check.ts";

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

// ── GREEN: 干净夹具 ⇒ 检查器绿 ────────────────────────────────────────────────────────────────────
test("GREEN: a clean kernel file (resolveKernelSibling form) has 0 violations", () => {
  const src = 'import { resolveKernelSibling } from "./driver-runtime.ts";\nexport const s = resolveKernelSibling("ready-pool-check.ts");\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: the repo-root idiom path.resolve(__dirname, \"..\", \"..\") is NOT a naive sibling", () => {
  const src = 'const __dirname = path.dirname(fileURLToPath(import.meta.url));\nexport const ROOT = path.resolve(__dirname, "..", "..");\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: a comment that merely SPELLS the pattern does not report (按位置不按关键词)", () => {
  const src = '// naive form: path.join(__dirname, "x.sh") is the defect\n// and path.join(root, "plugin", "scripts", "x.sh") too\nexport const x = 1;\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

// ── RED: 三种拼接形态【各一例】⇒ 检查器红（GOAL-012 风险 4：不止一种） ────────────────────────────
test("RED (P1): naive-__dirname — path.join(__dirname, \"x.sh\") is a violation", () => {
  const src = 'const __dirname = path.dirname(fileURLToPath(import.meta.url));\nexport const gate = path.join(__dirname, "resource-gate.sh");\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "naive-__dirname");
  assert.equal(v[0].script, "resource-gate.sh");
});

test("RED (P2): target-root — path.join(root, \"plugin\", \"scripts\", \"x.ts\") is a violation", () => {
  const src = 'export function run(root) { return path.join(root, "plugin", "scripts", "ready-pool-check.ts"); }\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "target-root");
  assert.equal(v[0].script, "ready-pool-check.ts");
});

test("RED (P3): template-string — `${__dirname}/x.sh` interpolation is a violation", () => {
  const src = 'const __dirname = path.dirname(fileURLToPath(import.meta.url));\nexport const gate = `${__dirname}/resource-gate.sh`;\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "template-string");
  assert.equal(v[0].script, "resource-gate.sh");
});

// ── RED: 跨包源码锚点（P4）三种写法【各一例】⇒ 检查器红（GOAL-012 风险 4 扩面；gap-kernel-sibling-check-blind-…）──
test("RED (P4 join): path.join(repoRoot(), \"packages\", …) cross-package source anchor is a violation", () => {
  const src =
    'import { repoRoot } from "./repo-root.ts";\n' +
    'const mod = await import(pathToFileURL(path.join(repoRoot(), "packages", "quay", "src", "gate", "gate-event-store.ts")).href);\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "cross-package");
  assert.equal(v[0].script, "gate-event-store.ts");
});

test("RED (P4 join): path.join(<var>, \"packages\", …) cross-package source anchor is a violation", () => {
  const src = 'export function run(root: string) { return path.join(root, "packages", "quay", "src", "fan-in", "ff-merge.ts"); }\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "cross-package");
  assert.equal(v[0].script, "ff-merge.ts");
});

test("RED (P4 template): `${root}/packages/…/src/…` cross-package source anchor is a violation", () => {
  const src = 'export function run(root: string) { return `${root}/packages/quay/src/goal-store.ts`; }\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "cross-package");
  assert.equal(v[0].script, "goal-store.ts");
});

// ── 不误伤（P4 边界）：相对 import / bin 布局 / 非 packages 前缀不命中 ───────────────────────────────────
test("GREEN: a RELATIVE import of a packages/** source module is NOT a cross-package violation", () => {
  const src = 'const mod = await import("../../packages/quay/src/serve-send.ts");\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: a packages/<pkg>/bin anchor is NOT a cross-package SOURCE violation (src 面之外)", () => {
  const src = 'export const bin = path.join(root, "packages", "quay", "bin", "quay.ts");\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("GREEN: a non-packages path.join does NOT report as cross-package", () => {
  const src = 'export const x = path.join(root, "src", "config.ts");\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

// ── DEV-TREE-ONLY 豁免（GOAL-012 风险 2：豁免带理由、可复核，⛔ 不是恒绿） ──────────────────────────
test("GREEN: a naive anchor WITH the kernel-sibling-dev-tree-only marker is exempted", () => {
  const src =
    'const __dirname = path.dirname(fileURLToPath(import.meta.url));\n' +
    "// kernel-sibling-dev-tree-only: 本仓库自检工具读自己的 plugin/ 树做检查，锚 root 是正确行为。\n" +
    'export const catalog = path.join(__dirname, "capability-catalog.sh");\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("RED: the SAME anchor WITHOUT the marker is a violation (豁免不是恒绿)", () => {
  const src = 'const __dirname = path.dirname(fileURLToPath(import.meta.url));\nexport const catalog = path.join(__dirname, "capability-catalog.sh");\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "naive-__dirname");
});

test("GREEN: a cross-package anchor WITH the kernel-sibling-dev-tree-only marker is exempted (AC3 豁免可复核)", () => {
  const src =
    'import path from "node:path";\n' +
    "// kernel-sibling-dev-tree-only: 本仓库自检工具只在 dev tree 内跑，读自己的 packages/ 树做检查（源树直跑、不经 bundle），锚 root 是正确行为。\n" +
    'export const store = path.join(scriptRoot, "packages", "quay", "src", "goal-store.ts");\n';
  assert.deepEqual(scanText(src), [], JSON.stringify(scanText(src)));
});

test("RED: the SAME cross-package anchor WITHOUT the marker is a violation (豁免不是恒绿)", () => {
  const src = 'import path from "node:path";\nexport const store = path.join(scriptRoot, "packages", "quay", "src", "goal-store.ts");\n';
  const v = scanText(src);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].form, "cross-package");
  assert.equal(v[0].script, "goal-store.ts");
});

// ── 扫描面（AC1：shipped kernel 面显式枚举 plugin/scripts + packages/quay/src） ────────────────────
test("scanSurface covers the shipped kernel surface (plugin/scripts + packages/quay/src)", () => {
  const surface = scanSurface(REPO_ROOT);
  assert.ok(surface.includes("plugin/scripts/full-suite-runner.ts"), "the naive __dirname carrier must be in the surface");
  assert.ok(surface.includes("packages/quay/src/plugin-root.ts"), "the Core resolver must be in the surface");
  assert.ok(surface.includes("packages/quay/src/cli/driver.ts"), "the AC-203 pre-fix callsite must be in the surface");
  assert.ok(!surface.some((f) => f.includes("/dist/")), "dist bundles excluded");
  assert.ok(!surface.some((f) => f.includes("/checker-mutation-cases/")), "mutation cases excluded");
});

// ── CLI 壳（in-process，无 subprocess）：临时 fixture 目录双向 ──────────────────────────────────────
test("CLI --root over a clean fixture: exit 0, pass, violations [] (in-process)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kern-sib-clean-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "fixture.ts"),
    'import { resolveKernelSibling } from "./driver-runtime.ts";\nexport const s = resolveKernelSibling("ready-pool-check.ts");\n');
  const { result, stdout } = captureConsole(() => main(["node", "kernel-sibling-resolution-check.ts", "--root", dir, "--json"]));
  assert.equal(result, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.status, "pass");
  assert.deepEqual(out.violations, []);
});

test("CLI --root over an injected fixture (naive __dirname): exit 1, fail, 1 violation (in-process)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kern-sib-inj-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "fixture.ts"),
    'const __dirname = path.dirname(fileURLToPath(import.meta.url));\nexport const gate = path.join(__dirname, "resource-gate.sh");\n');
  const { result, stdout } = captureConsole(() => main(["node", "kernel-sibling-resolution-check.ts", "--root", dir, "--json"]));
  assert.equal(result, 1, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.status, "fail");
  assert.equal(out.violations.length, 1);
  assert.equal(out.violations[0].form, "naive-__dirname");
});

test("CLI --no-block over an injected fixture: exit 0 but reports the violation (report-only, not fail-closed)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kern-sib-noblock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "fixture.ts"),
    'const __dirname = path.dirname(fileURLToPath(import.meta.url));\nexport const gate = path.join(__dirname, "resource-gate.sh");\n');
  const { result, stdout } = captureConsole(() => main(["node", "kernel-sibling-resolution-check.ts", "--root", dir, "--json", "--no-block"]));
  assert.equal(result, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.status, "fail");
  assert.equal(out.violations.length, 1);
  assert.equal(out.violations[0].form, "naive-__dirname");
});

test("CLI --root over a missing surface: exit 3, not-evaluated (硬规则 3b — 读不到 ≠ 无违规)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kern-sib-empty-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { result, stdout } = captureConsole(() => main(["node", "kernel-sibling-resolution-check.ts", "--root", dir, "--json"]));
  assert.equal(result, 3, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.status, "not-evaluated");
});
