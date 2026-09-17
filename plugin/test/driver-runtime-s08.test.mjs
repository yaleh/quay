// @test-group serial
// driver-runtime.test.mjs — AC151 (tasks/gap-ac151-two-level-driver-layer-landing): the two-level
// layering (Layer 0 driver-runtime + Layer 1a task-processing / Layer 1b routine) + the supervisor
// ported from promotion-driver-launch.sh (bash) into TS.
//
//   AC1 (两级分层落地): Layer 0 (driver-runtime) owns supervisor/loop/stopCondition/heartbeat/
//     controlPlane/notify/profile/ResultVocab; Layer 1a owns source/filters/select/act/verify/outcome;
//     Layer 1b owns routines/schedule/collect/report. promotion/worker inherit 0+1a (identity,
//     ⛔ 非平行副本). Falsifiable: ① manager-kind (1b) 被骨架强制实现空的候选池/选择/verify 三段 ⇒ 假
//     （1b 的 RoutineSpec 不引用 1a 的 source/select/verify）；② 1b 重实现 Layer 0 循环/心跳/判停 ⇒ 假
//     （1b 的 schedule 复用 routine-scheduler isDue 同一函数身份，report 经 Layer 0 notify）。
//   AC2 (supervisor 港进 TS): 8 张 registry 表 → DRIVER_KINDS 单一数据表；run_supervisor → 可单测的
//     runSupervisor；status/liveness/start/stop/drain 变成可直接 import 的纯函数/IO 函数。Falsifiable:
//     supervisor 逻辑仍在 bash .sh 里 ⇒ 假。
//
// Run: scripts/test.sh plugin/test/driver-runtime.test.mjs

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 8/10 (5 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT_DR, assert, fs, kernelLayoutFixture, kernelSiblingArgv, launchArgv, mcpFixture, path, promotion, resolveKernelSibling, spawn, withKernelRoot, worker } from "./helpers/driver-runtime-harness.mjs";

test("AC1/AC6 — an EMPTY blacklist adds no mcp flag and the argv does not depend on MCP config at all", (t) => {
  const fx = mcpFixture(t);
  for (const role of ["outer", "manager", "pool-judge", "meta-driver"]) {
    const plain = launchArgv(role, "P", REPO_ROOT_DR);
    const withRoots = launchArgv(role, "P", REPO_ROOT_DR, { mcpRoots: fx.roots });
    assert.deepEqual(plain, withRoots, `${role}: argv must be INDEPENDENT of the MCP configuration`);
    assert.ok(!plain.includes("--strict-mcp-config"), `${role}: no --strict-mcp-config`);
    assert.ok(!plain.includes("--mcp-config"), `${role}: no --mcp-config`);
    assert.equal(plain.at(-2), "-p", `${role}: the -n <name> -p <prompt> tail is intact`);
    assert.equal(plain[plain.indexOf("-n") + 1], `quay-${role}`, `${role}: name resolved from the role`);
    assert.equal(plain.at(-1), "P", `${role}: prompt stays the last payload`);
  }
});


test("AC1 wiring — the three code-writing roles carry --strict-mcp-config --mcp-config, blacklist subtracted", (t) => {
  const fx = mcpFixture(t);
  for (const role of ["task-worker", "selector", "fix-worker"]) {
    const argv = launchArgv(role, "P", REPO_ROOT_DR, { mcpRoots: fx.roots });
    const i = argv.indexOf("--strict-mcp-config");
    assert.ok(i >= 0, `${role}: must carry --strict-mcp-config`);
    assert.equal(argv[i + 1], "--mcp-config");
    const table = JSON.parse(argv[i + 2]).mcpServers;
    assert.equal(table["chrome-devtools"], undefined, `${role}: chrome-devtools dropped`);
    assert.equal(table["playwright"], undefined, `${role}: playwright dropped`);
    // ⛔ 负控制：黑名单不得连坐掉 worker 自己要用 quay 工具（AC4）。
    assert.ok(table["plugin_quay_quay"], `${role}: the quay MCP server must SURVIVE`);
    assert.ok(table["user-extra"] && table["proj-server"], `${role}: unrelated servers survive`);
    assert.equal(argv.at(-1), "P", `${role}: prompt stays the last payload`);
  }
});


test("AC5 precondition — the emitted plugin entry points at a REAL on-disk command (not a dead path)", (t) => {
  const fx = mcpFixture(t);
  const argv = launchArgv("task-worker", "P", REPO_ROOT_DR, { mcpRoots: fx.roots });
  const table = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers;
  const spec = table["plugin_quay_quay"];
  assert.ok(spec, "precondition: quay entry present");
  const cmdPath = spec.args[0];
  assert.ok(!cmdPath.includes("${CLAUDE_PLUGIN_ROOT}"), "placeholder expanded");
  assert.ok(fs.existsSync(cmdPath), `the emitted MCP command must exist on disk: ${cmdPath}`);
});


test("AC3 caller — an unresolvable MCP configuration ⇒ ZERO mcp flags (dispatch is never blocked)", (t) => {
  const argv = launchArgv("task-worker", "P", REPO_ROOT_DR, { mcpRoots: null });
  assert.ok(!argv.includes("--strict-mcp-config"), "no flag when the config cannot be evaluated");
  assert.ok(!argv.includes("--mcp-config"));
  assert.equal(argv.at(-1), "P");
  // 负控制（对照必须能把结论翻过来）：同一个调用给了可解析的根 ⇒ flag 立刻出现。
  const fx = mcpFixture(t);
  assert.ok(launchArgv("task-worker", "P", REPO_ROOT_DR, { mcpRoots: fx.roots }).includes("--strict-mcp-config"));
});

// ── resolveKernelSibling: raw .ts vs the shipped dist bundle ─────────────────────────────────────────
// gap-dist-plugin-missing-node-modules-task-schema-yaml (kernel half — mirror of Core
// `plugin-root.ts::isPluginSourceCheckout`). `runSupervisor` resolves EVERY kind's driver through
// `resolveKernelSibling(spec.driver)`, and the driver scripts' import closure needs `yaml` /
// `@modelcontextprotocol/sdk/*` / `zod`, none of which an installed plugin tree carries — so a raw
// pick there means all six kinds die at spawn with ERR_MODULE_NOT_FOUND, exactly as measured on the
// real plugin cache. The dist bundle is self-contained and runs without --experimental-strip-types.

/** `<dir>/plugin/scripts/<name>.ts` (+ `dist/<name>.js`) and — when `withCoreSrc` — the
 *  `<dir>/packages/quay/src` marker that makes `<dir>/plugin` a SOURCE checkout. */



test("resolveKernelSibling() — shipped install (raw .ts + dist coexist): the BUNDLE wins, stripTypes false", () => {
  const fx = kernelLayoutFixture(false);
  try {
    const r = withKernelRoot(fx.pluginRoot, () => resolveKernelSibling("promotion-driver.ts"));
    assert.ok(r, "must resolve");
    assert.equal(r.stripTypes, false, "no --experimental-strip-types in a shipped install");
    assert.ok(r.path.endsWith(path.join("scripts", "dist", "promotion-driver.js")), `bundle path: ${r.path}`);
    // The kernel spawns via this argv, so assert the ARGV too (the flag is what would be wrong).
    process.env.QUAY_PLUGIN_ROOT = fx.pluginRoot;
    const argv = kernelSiblingArgv("promotion-driver.ts", ["--root", "/tmp/x"]);
    delete process.env.QUAY_PLUGIN_ROOT;
    assert.deepEqual(argv.slice(0, 3), ["node", "--no-warnings", r.path], `argv: ${JSON.stringify(argv)}`);
  } finally {
    delete process.env.QUAY_PLUGIN_ROOT;
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});
