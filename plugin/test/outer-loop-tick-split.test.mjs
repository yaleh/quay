// @test-group engine
// outer-loop-tick-split.test.mjs — tasks/gap-ac38-outer-doc-split
// (AC2-AC4 切分一致性：外层双份文档按 manager 先例同形切分后，plugin=产品行为正本 / orchestration=本层实例状态)
//
// Coverage map (task ACs):
//   AC2 — 同形切分：plugin 副本是通用产品模板（标题带「通用模板」），orchestration 副本是本层实例状态
//         （标题/声明带「本层实例状态」）；两份都有切分声明。
//   AC3 — 独有内容可解释：plugin 副本不含 quay 实例字面量（quay-0: / archguard / meta-cc / /home/yale/ /
//         `develop integration` 字面分支模型），orchestration 副本含这些实例字面量——各自的独有内容
//         主题单一（产品行为 vs 本层实例状态）。
//   AC4 — 切分声明在场：两份 loop-tick 文档 + 两个 tick 核（plugin/loop/fast-mode-tick-core.md、
//         orchestration/orchestrator-tick-core.md）都带切分声明。
//
// Every assertion is relative to the live repo's actual files — nothing hardcoded to a global count.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const PLUGIN_DOC = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const ORCH_DOC = path.join(REPO_ROOT, "orchestration/orchestrator-loop-tick.md");
const PLUGIN_CORE = path.join(REPO_ROOT, "plugin/loop/fast-mode-tick-core.md");
const ORCH_CORE = path.join(REPO_ROOT, "orchestration/orchestrator-tick-core.md");

function read(p) {
  return fs.readFileSync(p, "utf8");
}

test("AC4 切分声明在场：两份 loop-tick 文档 + 两个 tick 核都带切分声明", () => {
  for (const [name, p] of [
    ["plugin loop-tick", PLUGIN_DOC],
    ["orchestration loop-tick", ORCH_DOC],
    ["plugin fast-mode-tick-core", PLUGIN_CORE],
    ["orchestration orchestrator-tick-core", ORCH_CORE],
  ]) {
    const text = read(p);
    assert.ok(text.includes("切分声明"), `${name} (${p}) 缺切分声明`);
    assert.ok(text.includes("AC38"), `${name} (${p}) 切分声明缺 AC38 标注`);
  }
});

test("AC2 同形切分：plugin=产品模板 / orchestration=本层实例状态", () => {
  const plugin = read(PLUGIN_DOC);
  const orch = read(ORCH_DOC);
  assert.ok(plugin.includes("通用模板"), "plugin 副本标题应带「通用模板」（产品模板形态）");
  assert.ok(plugin.includes("产品行为正本"), "plugin 副本声明应自称「产品行为正本」");
  assert.ok(orch.includes("本层实例状态"), "orchestration 副本声明应自称「本层实例状态」");
});

test("AC3 plugin 独有内容 = 产品行为：不含 quay 实例字面量", () => {
  const plugin = read(PLUGIN_DOC);
  const banned = [
    "quay-0:",        // tmux 会话名（实例）
    "archguard",      // 具体下游项目（实例）
    "meta-cc",        // 具体下游项目（实例）
    "/home/yale/",    // 具体机器路径（实例）
    "merge-base --is-ancestor develop", // 字面分支模型（实例）
  ];
  for (const b of banned) {
    assert.ok(!plugin.includes(b), `plugin 产品模板不应含实例字面量「${b}」`);
  }
  // 正向：产品模板用变量引用分支模型，不写死
  assert.ok(plugin.includes("$FORK_BASELINE"), "plugin 产品模板应通过 $FORK_BASELINE 引用分支模型");
  assert.ok(plugin.includes("$MERGE_TARGET"), "plugin 产品模板应通过 $MERGE_TARGET 引用分支模型");
});

test("AC3 orchestration 独有内容 = 本层实例状态：含 quay 实例字面量", () => {
  const orch = read(ORCH_DOC);
  const expected = [
    "quay-0:inner",   // tmux 会话名（实例）
    "archguard",      // 具体下游项目（实例）
    "meta-cc",        // 具体下游项目（实例）
    "is-ancestor develop integration", // 字面分支模型（实例）
  ];
  for (const e of expected) {
    assert.ok(orch.includes(e), `orchestration 实例副本应含实例字面量「${e}」`);
  }
});

test("plugin 产品模板保留关键脚本引用（laydown set 覆盖不塌缩）", () => {
  const plugin = read(PLUGIN_DOC);
  // 只在外层文档引用、不在内层/manager 文档引用的脚本（gap-ac38 切分不能把铺设集抽空）
  const outerOnlyCritical = [
    "plugin/scripts/full-suite-runner.ts",
    "plugin/scripts/suite-state-trigger.ts",
    "plugin/scripts/outer-session-check.sh",
    "plugin/scripts/loop-driver-check.sh",
    "plugin/scripts/session-liveness-mount.sh",
    "plugin/scripts/laydown-set-check.sh",
    "plugin/scripts/session-bootstrap.sh",
    "plugin/scripts/real-target-verify.sh",
    "plugin/scripts/external-dogfooding-check.ts",
  ];
  for (const s of outerOnlyCritical) {
    assert.ok(plugin.includes(s), `plugin 产品模板应保留脚本引用「${s}」（laydown set 覆盖）`);
  }
});
