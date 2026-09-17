// @test-group engine
// cap-from-gate-process-budget-path.test.mjs — gap-plugin-root-resolution-remaining-callsites-round2.
// readBudgetFromGate 的 process-budget.sh 路径不再锚在 repoRoot（第三方项目无 plugin/scripts/ ⇒
// `bash <repoRoot>/plugin/scripts/process-budget.sh` 会 No such file ⇒ 静默 fail-open 让跨层预算这个
// 次要约束不生效），改从 kernel 安装位置解析（resolveKernelPluginRoot + env.QUAY_PLUGIN_ROOT 测试缝，
// 同 resolveResourceGateScript 手法）。fail-open 语义不变（脚本缺失 / exit 非 0 ⇒ null）。
//
// Run:
//   node --test plugin/test/cap-from-gate-process-budget-path.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readBudgetFromGate, computeEffectiveCap } from "../scripts/cap-from-gate.ts";

/** 一个临时 plugin root：其 scripts 子目录下按 opts.withScript 决定放不放 process-budget.sh。 */
function makePluginRoot(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cap-budget-"));
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  if (opts.withScript) fs.writeFileSync(path.join(scripts, "process-budget.sh"), opts.withScript, "utf8");
  return root;
}

/** 最小自足的 process-budget.sh 替身：回显固定 budget 三键（readBudgetFromGate 只解析这三键）。 */
const BUDGET_BODY = [
  "#!/bin/sh",
  "echo total_budget=40",
  "echo in_use=2",
  "echo available=38",
].join("\n");

test("readBudgetFromGate — QUAY_PLUGIN_ROOT 指向有 process-budget.sh 的 fake root ⇒ 读该脚本（⛔ 非 repoRoot/plugin/scripts）", () => {
  const pluginRoot = makePluginRoot({ withScript: BUDGET_BODY });
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cap-budget-noplugin-")); // 无 plugin/
  try {
    const snap = readBudgetFromGate(repoRoot, { ...process.env, QUAY_PLUGIN_ROOT: pluginRoot });
    assert.ok(snap, "must resolve the budget script from the kernel install location (⛔ repoRoot/plugin/scripts)");
    assert.equal(snap.total_budget, 40);
    assert.equal(snap.in_use, 2);
    assert.equal(snap.available, 38);
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("readBudgetFromGate — dev tree 缺省（无 override）解析到本仓库 plugin/scripts/process-budget.sh（回归不变）", () => {
  const saved = process.env.QUAY_PLUGIN_ROOT;
  delete process.env.QUAY_PLUGIN_ROOT;
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cap-budget-devtree-"));
  try {
    // 用 process-budget.sh 自己的 test seam 把读数钉死，使「读到真脚本」成为可取假的断言。
    const env = { ...process.env, RESOURCE_GATE_TEST_NPROC: "40", RESOURCE_GATE_TEST_NODE_PROCS: "2" };
    const snap = readBudgetFromGate(repoRoot, env);
    assert.ok(snap, "dev tree 缺省须解析到真实 process-budget.sh 并读到 budget");
    assert.equal(snap.total_budget, 40, "seam 注入 total_budget=40 须流经真实 process-budget.sh");
    assert.equal(snap.in_use, 2);
    assert.equal(snap.available, 38);
  } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = saved;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("readBudgetFromGate — kernel 侧无 process-budget.sh ⇒ null（fail-open，不抛）", () => {
  const pluginRoot = makePluginRoot({}); // scripts/ 存在但无 process-budget.sh
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cap-budget-missing-"));
  try {
    const snap = readBudgetFromGate(repoRoot, { ...process.env, QUAY_PLUGIN_ROOT: pluginRoot });
    assert.equal(snap, null, "kernel 侧无 process-budget.sh ⇒ null（fail-open）");
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// ── gap-ac281-develop-ci-test-job-wallclock-under-30s ────────────────────────────────────────────
// The spawn-count regression. computeEffectiveCap used to obtain its three readings by spawning
// resource-gate.sh TWICE (readCpuStallFromGate + readLoadAvgFromGate) plus process-budget.sh ONCE —
// three subprocess spawns, for three readings that the gate's OWN report already prints side by
// side (resource-gate.sh shells out to process-budget.sh itself and prints
// `total_budget=… budget_in_use=… budget_available=…`).
//
// This is not a micro-optimization: measured 2026-09-17, one computeEffectiveCap cost 4207 ms, of
// which the subprocess spawns were essentially all of it, and
// plugin/test/cap-from-gate-stale.test.mjs calls it 7 times — 24.3 s of CI wall clock for ONE
// `test()`, the largest single-file floor in the main phase after the two >30 s files. After the
// fix the same file measured 11.5 s and one computeEffectiveCap 539 ms.
//
// The counter file is what makes this 能取假: a fake plugin root whose resource-gate.sh APPENDS to
// it on every run. On the pre-fix code this assertion reads 2, so it is exactly the regression the
// change fixes — ⛔ not a test that would have passed before and after alike. The three readings are
// asserted from the SAME invocation, and the fake root deliberately has NO process-budget.sh: if the
// code ever fell back to reading the budget separately, budget_total would come back null and the
// test fails rather than silently re-introducing the extra spawn.
function makeCountingPluginRoot(countFile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cap-gate-count-"));
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(
    path.join(scripts, "resource-gate.sh"),
    [
      "#!/bin/sh",
      `echo x >> ${JSON.stringify(countFile)}`,
      "echo 'cpu_stall(some avg10)=12.50  [limit 60]   ok'",
      "echo 'loadavg=3.25             [limit nproc×2≈32] ok'",
      "echo 'total_budget=40  budget_in_use=2  budget_available=38  [cross-layer budget authority: process-budget.sh]'",
      "exit 0",
    ].join("\n"),
    "utf8",
  );
  return root;
}

test("computeEffectiveCap — ONE resource-gate.sh invocation supplies all three readings（spawn 3 → 1）", () => {
  const countDir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-gate-n-"));
  const countFile = path.join(countDir, "invocations");
  fs.writeFileSync(countFile, "", "utf8");
  const pluginRoot = makeCountingPluginRoot(countFile);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cap-onecall-"));
  try {
    const r = computeEffectiveCap({
      repoRoot,
      stateFile: path.join(repoRoot, "state.json"),
      env: { ...process.env, QUAY_PLUGIN_ROOT: pluginRoot },
      now: Date.now(),
    });
    const calls = fs.readFileSync(countFile, "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(calls, 1, `resource-gate.sh must be invoked exactly ONCE per computeEffectiveCap; got ${calls}`);
    // The single invocation must really be the SOURCE of all three readings.
    assert.equal(r.cpu_stall, 12.5, "cpu_stall must come from the gate report");
    assert.equal(r.load_avg, 3.25, "load_avg must come from the gate report");
    assert.equal(r.budget_total, 40, "budget must come from the SAME gate report (⛔ not a second spawn)");
    assert.equal(r.budget_in_use, 2);
    assert.equal(r.budget_available, 38);
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(countDir, { recursive: true, force: true });
  }
});
