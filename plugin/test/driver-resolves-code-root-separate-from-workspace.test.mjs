// @test-group engine
// driver-resolves-code-root-separate-from-workspace.test.mjs
// (tasks/gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root)
//
// 被证明的命题：driver 运行时解析【quay 自己的脚本/模块】时，基准是【本 kernel 自身的安装位置】，
// ⛔ 不是 workspace root。两者在 quay 自己的开发检出里恰好重合（root 就是 repo 根）⇒ 全部自测绿；
// upgrade-channel/vendor 安装下两者分离 ⇒ 2026-09-13 在 /home/yale/work/quay-fleet 实测：
// 四个 driver 进程 alive=1、载体持续在写，而 goal-ring state=failed
// （`Cannot find module '<project>/packages/quay/src/goal-store.ts'`）、outer 的 5 条 fact
// 因 unreadable/unparseable 取不到值。**这是硬规则 4 的实例：在开发检出里跑的测试，结构上无法
// 暴露这个缺陷——所以本文件【显式把两者分开】**（third-party 形 root：无 packages/、无 plugin/）。
//
// 判据（每一条都能取假）：
//   AC1  分离夹具上一轮 goal 机械环 ⇒ goal-ring state==="verified"（改前 = "failed" + Cannot find module）。
//   AC2  同夹具上 outer 的 occupancy / not_yet_flipped / slot_refill / closure_pass / judgment_consumer
//        五条 fact 不因 unreadable/unparseable 而 not-evaluated。
//   AC3  单一入口 resolveQuayCodeRoot() 按布局解析（源树 + shipped 打平 + 两形皆无 ⇒ null），且
//        DRIVER_SCOPE_FILES 七个文件里 root 锚点拼法 0 次——检查器 + 双向控制（红面 / 绿面都在本文件里）。
//
// Run: scripts/test.sh plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveQuayCodeRoot,
  resolveQuaySrcModule,
  kernelSiblingArgv,
  kernelConfigPath,
} from "../scripts/driver-runtime.ts";
import {
  DRIVER_SCOPE_FILES,
  scanDriverRootAnchors,
  runCheck,
  isDriverScopeFile,
} from "../scripts/kernel-sibling-resolution-check.ts";
import { runGoalRound } from "../scripts/goal-driver.ts";
import {
  occupancyRoutine,
  notYetFlippedRoutine,
  slotRefillRoutine,
  closurePassRoutine,
  judgmentConsumerRoutine,
} from "../scripts/outer-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const _created = [];
after(() => {
  for (const d of _created) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function mkTemp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `code-root-${tag}-`));
  _created.push(d);
  return d;
}

/**
 * 第三方形 workspace root：合法 quay workspace（.quay/config.yml + tasks/），但**不含** `packages/`
 * 与 `plugin/` —— 这正是 upgrade-channel/vendor 安装后的形态，而 driver 的旧解析按
 * `<root>/packages|plugin/…` 拼 quay 自己的代码 ⇒ 必然落空。
 */
function makeSeparatedWorkspace(tag) {
  const ws = mkTemp(tag);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: ${path.join(REPO_ROOT, "plugin", "vendor", "quay-native")}`,
      "    tasks_dir: ./tasks",
      "    mcp_entry:",
      "    - node",
      `    - ${path.join(REPO_ROOT, "plugin", "vendor", "quay-native", "dist", "quay-native.js")}`,
      "    - mcp",
      "    env:",
      "      QUAY_NATIVE_TASKS_DIR: ./tasks",
      "      QUAY_NATIVE_ADR_DIR: ./adr",
      "      QUAY_NATIVE_GOAL_DIR: ./goals",
      "      QUAY_NATIVE_META_DIR: ./meta",
      "gates: null",
      "loop:",
      "  board: native",
      `  repo_root: ${ws}`,
      '  test_command: "node --test"',
      "",
    ].join("\n"),
    "utf8",
  );
  // 夹具的【结构性质】本身就是判据的一半：没有这两个目录，旧解析才必然落空。
  assert.equal(fs.existsSync(path.join(ws, "packages")), false, "fixture must have NO packages/");
  assert.equal(fs.existsSync(path.join(ws, "plugin")), false, "fixture must have NO plugin/");
  return ws;
}

/** 跑一个例程并返回它的单条 fact。 */
async function factOfRoutine(fn) {
  const facts = await fn();
  assert.equal(facts.length, 1, `routine must yield exactly one fact, got ${facts.length}`);
  return facts[0];
}

// ── AC3 · 单一入口按布局解析（源树 / shipped 打平 / 两形皆无 ⇒ null） ─────────────────────────────

test("AC3a: resolveQuayCodeRoot 按【kernel 安装位置】的布局解析，与 workspace root 无关", () => {
  // 生产形态（本仓 dev tree / 本机 plugin root）：code root = <pluginRoot>/..，含 packages/quay/src。
  const real = resolveQuayCodeRoot();
  assert.ok(real !== null, "本仓 dev tree 下 resolveQuayCodeRoot() 必须可解析（否则整套 driver 都不工作）");
  assert.ok(
    fs.existsSync(path.join(real, "packages", "quay", "src", "goal-store.ts")),
    `code root 下必须有 packages/quay/src/goal-store.ts，实际 root=${real}`,
  );

  // 分离夹具：workspace root 上【取不到】——证明旧解析（<root>/packages/…）在这里必然落空。
  const ws = makeSeparatedWorkspace("sep");
  assert.equal(
    fs.existsSync(path.join(ws, "packages", "quay", "src", "goal-store.ts")),
    false,
    "分离夹具上 <ws>/packages/quay/src/goal-store.ts 必须不存在（旧解析的落点）",
  );

  // 源树布局（hermetic）：QUAY_PLUGIN_ROOT 指向 <fixture>/plugin ⇒ code root = <fixture>。
  const tree = mkTemp("srctree");
  fs.mkdirSync(path.join(tree, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(tree, "packages", "quay", "src"), { recursive: true });
  fs.writeFileSync(path.join(tree, "packages", "quay", "src", "goal-store.ts"), "// fixture\n", "utf8");
  const prev = process.env.QUAY_PLUGIN_ROOT;
  try {
    process.env.QUAY_PLUGIN_ROOT = path.join(tree, "plugin");
    assert.equal(resolveQuayCodeRoot(), tree, "源树布局 ⇒ code root = pluginRoot 的父目录");
    assert.equal(
      resolveQuaySrcModule("goal-store.ts"),
      path.join(tree, "packages", "quay", "src", "goal-store.ts"),
      "源树布局 ⇒ <codeRoot>/packages/quay/src/<rel>",
    );

    // shipped 打平布局：<pkg>/plugin + <pkg>/src（npm 包把 packages/quay/ 打平到包根）。
    const flat = mkTemp("flat");
    fs.mkdirSync(path.join(flat, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(flat, "src"), { recursive: true });
    fs.writeFileSync(path.join(flat, "src", "goal-store.ts"), "// fixture\n", "utf8");
    process.env.QUAY_PLUGIN_ROOT = path.join(flat, "plugin");
    assert.equal(resolveQuayCodeRoot(), flat, "打平布局 ⇒ code root = pluginRoot 的父目录");
    assert.equal(
      resolveQuaySrcModule("goal-store.ts"),
      path.join(flat, "src", "goal-store.ts"),
      "打平布局 ⇒ <codeRoot>/src/<rel>（⛔ 不是 <codeRoot>/packages/quay/src/<rel>）",
    );

    // 两形皆无 ⇒ null（⛔ 不回退到 workspace root —— 那正是本缺陷的形态）。
    const bare = mkTemp("bare");
    fs.mkdirSync(path.join(bare, "plugin", "scripts"), { recursive: true });
    process.env.QUAY_PLUGIN_ROOT = path.join(bare, "plugin");
    assert.equal(resolveQuayCodeRoot(), null, "两形皆无 ⇒ null（fail-closed，⛔ 不静默回退）");
    assert.equal(resolveQuaySrcModule("goal-store.ts"), null, "code root 为 null ⇒ 模块解析也 null");
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = prev;
  }
});

test("AC3a': kernelSiblingArgv / kernelConfigPath 锚在 kernel 安装位置（⛔ 非 workspace root）", () => {
  const sib = kernelSiblingArgv("slot-refill.ts", ["--root", "/tmp/x"]);
  assert.ok(Array.isArray(sib), "本仓 dev tree 下 slot-refill.ts 必须可解析");
  assert.deepEqual(sib.slice(-2), ["--root", "/tmp/x"], "调用方给的多余参数必须原样附加在末尾");
  const scriptPath = sib.find((a) => a.endsWith("slot-refill.ts") || a.endsWith("slot-refill.js"));
  assert.ok(scriptPath && fs.existsSync(scriptPath), `解析出的脚本必须真实存在：${scriptPath}`);

  // .sh sibling 走 bash + <pluginRoot>/scripts/<name>（shipped 下 .sh 以 loose 形态随包）。
  const sh = kernelSiblingArgv("closure-lag-check.sh");
  assert.ok(Array.isArray(sh), "closure-lag-check.sh 必须可解析");
  assert.equal(sh[0], "bash", "shell sibling 的解释器是 bash");
  assert.ok(fs.existsSync(sh[1]), `解析出的 .sh 必须真实存在：${sh[1]}`);

  // 配置类资源（P2 的正则结构上匹配不到的那一半）同样锚在 kernel。
  const cfgPath = kernelConfigPath(path.join("scripts", "drivers.yml"));
  assert.ok(fs.existsSync(cfgPath), `drivers.yml 必须可解析：${cfgPath}`);
  assert.ok(cfgPath.startsWith(REPO_ROOT), "配置路径必须落在 quay 安装树下（⛔ 非 workspace root）");

  // 解析不出 ⇒ null（⛔ 不回退到 `<root>/plugin/scripts/<name>`：那会把「找不到」伪装成「跑过了、没数据」）。
  assert.equal(kernelSiblingArgv("no-such-sibling-xyz.ts"), null, "找不到 ⇒ null（fail-closed）");
  assert.equal(kernelSiblingArgv("no-such-sibling-xyz.sh"), null, "找不到的 .sh ⇒ null（fail-closed）");
});

// ── AC3 · 静态检查器 + 双向控制（红面 / 绿面都在本文件里，⛔ 不是只跑一遍看它绿） ──────────────────

test("AC3b: 检查器的 driver-scope 规则【能取假】——标记不再豁免、配置类资源也收、单入口才放行", () => {
  const legacyAnchorWithMarker = [
    'import path from "node:path";',
    "export function run(root) {",
    "  // kernel-sibling-dev-tree-only: 误标——本文件在第三方项目里跑，--root 是别人的项目。",
    '  return path.join(root, "plugin", "scripts", "ready-pool-check.ts");',
    "}",
    "",
  ].join("\n");
  const red = scanDriverRootAnchors(legacyAnchorWithMarker, "plugin/scripts/outer-driver.ts");
  assert.ok(red.length >= 1, "红面：带 dev-tree-only 标记的 root 锚点在 driver-scope 文件里必须仍然报红");
  assert.ok(red.every((v) => v.form === "driver-root-anchor"), "形态词必须是 driver-root-anchor");

  // P2 的正则结构上匹配不到的资源形态（drivers.yml 这类非脚本扩展名）也必须被收到。
  const cfgAnchor = [
    'import fs from "node:fs";',
    'import path from "node:path";',
    "export function cfg(root) {",
    '  return JSON.parse(fs.readFileSync(path.join(root, "plugin", "scripts", "drivers.yml"), "utf8"));',
    "}",
    "",
  ].join("\n");
  assert.ok(
    scanDriverRootAnchors(cfgAnchor, "plugin/scripts/goal-driver.ts").length >= 1,
    "红面：`drivers.yml` 这类随包出厂配置的 root 锚点必须报红（P2 的脚本扩展名正则覆盖不到）",
  );

  // 模板字面量半边。
  const tplAnchor = "const p = `${root}/packages/quay/src/goal-store.ts`;\n";
  assert.ok(scanDriverRootAnchors(tplAnchor, "plugin/scripts/goal-driver.ts").length >= 1, "红面：模板字面量形态必须报红");

  // 绿面：修好后的形态 0 条。
  const fixed = [
    'import { kernelSiblingArgv } from "./driver-runtime.ts";',
    "export function read(root) {",
    '  return kernelSiblingArgv("slot-refill.ts", ["--root", root]);',
    "}",
    "",
  ].join("\n");
  assert.deepEqual(scanDriverRootAnchors(fixed, "plugin/scripts/outer-driver.ts"), [], "绿面：经单一入口解析 ⇒ 0 条");

  // 注释里出现不算（按位置判定，硬规则 2）。
  assert.deepEqual(
    scanDriverRootAnchors('// path.join(root, "plugin", "scripts", "x.ts") 是缺陷形\nconst ok = 1;\n', "plugin/scripts/goal-driver.ts"),
    [],
    "注释位置不算命中",
  );

  // 单入口放行：只有 driver-runtime.ts 的那两个函数体内合法；同文件【体外】仍红（⛔ 不是整文件豁免）。
  const inEntry = [
    "export function resolveQuayCodeRoot() {",
    '  const parent = "/x";',
    '  if (fs.existsSync(path.join(parent, "packages", "quay", "src"))) return parent;',
    "  return null;",
    "}",
    "",
  ].join("\n");
  assert.deepEqual(
    scanDriverRootAnchors(inEntry, "plugin/scripts/driver-runtime.ts"),
    [],
    "单入口体内 ⇒ 放行（布局知识必须存在于一个地方）",
  );
  const outOfEntry = [
    "export function resolveQuayCodeRootHelper(root) {",
    '  return path.join(root, "packages", "quay", "src", "goal-store.ts");',
    "}",
    "",
  ].join("\n");
  assert.ok(
    scanDriverRootAnchors(outOfEntry, "plugin/scripts/driver-runtime.ts").length >= 1,
    "红面：同一文件里【体外】的 root 锚点必须报红（放行不得退化成整文件豁免）",
  );

  // 非 driver-scope 文件不进这条规则（作用面是枚举的，不是「所有文件」）。
  assert.equal(isDriverScopeFile("plugin/scripts/rhythm-consumer-check.ts"), false, "自检 checker 不在此覆盖面内");
  assert.ok(DRIVER_SCOPE_FILES.every(isDriverScopeFile), "DRIVER_SCOPE_FILES 的每一项都必须被 isDriverScopeFile 认到");
});

test("AC3c: 生产树上——DRIVER_SCOPE_FILES 七个文件里 root 锚点拼法 0 次（检查器机械枚举）", () => {
  for (const rel of DRIVER_SCOPE_FILES) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `受检文件必须存在：${rel}`);
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    assert.deepEqual(
      scanDriverRootAnchors(src, rel),
      [],
      `${rel} 里不得再有 <root变量>/"packages"|"plugin" 拼法（枚举 0 处）`,
    );
  }
  // 整仓检查器（含 P1–P4）也必须绿——本任务不得引入别处的违规。
  const res = runCheck(REPO_ROOT);
  assert.equal(res.notEvaluated, false, "扫描面不得为空（空面 = 未评估，⛔ 不是合格）");
  assert.deepEqual(res.violations, [], `整仓 kernel-sibling 检查必须 0 违规：${JSON.stringify(res.violations.slice(0, 5))}`);
});

// ── AC1 · goal 机械环在分离 root 上取到值 ────────────────────────────────────────────────────────

test("AC1: 分离 workspace root 上一轮 goal 机械环 ⇒ goal-ring verified（⛔ 非 Cannot find module）", async () => {
  const ws = makeSeparatedWorkspace("goal");
  const r = await runGoalRound(ws, { targetHost: null, targetRoot: null, spawnCap: 0 });
  assert.equal(
    r.fact.state,
    "verified",
    `goal-ring 必须在分离 root 上取到值；实际 state=${r.fact.state} reason=${r.fact.reason}`,
  );
  assert.doesNotMatch(
    String(r.fact.reason ?? ""),
    /Cannot find module/,
    "reason 不得再出现 Cannot find module（旧解析的落点在 <ws>/packages/quay/src/goal-store.ts）",
  );
});

// ── AC2 · outer 五条 fact 不再因 unreadable/unparseable 空转 ────────────────────────────────────

test("AC2: 同夹具上 outer 的 5 条 fact 不因 unreadable/unparseable 而 not-evaluated", async () => {
  const ws = makeSeparatedWorkspace("outer");
  const specs = [
    ["occupancy", occupancyRoutine(ws, null)],
    ["not_yet_flipped", notYetFlippedRoutine(ws, null)],
    ["slot_refill", slotRefillRoutine(ws, null)],
    ["closure_pass", closurePassRoutine(ws, null)],
    ["judgment_consumer", judgmentConsumerRoutine(ws, null)],
  ];
  for (const [name, fn] of specs) {
    const fact = await factOfRoutine(fn);
    assert.equal(fact.name, name, `例程产出的 fact 名应为 ${name}`);
    const reason = String(fact.reason ?? "");
    assert.equal(
      fact.state === "not-evaluated" && /unreadable|unparseable/.test(reason),
      false,
      `${name} 仍因 unreadable/unparseable 空转：state=${fact.state} reason=${reason}`,
    );
    assert.equal(fact.state, "verified", `${name} 在合法 fixture 上应取到值（⛔ 不是 not-evaluated），reason=${reason}`);
  }
});
