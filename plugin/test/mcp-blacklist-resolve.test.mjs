// @test-group engine
// mcp-blacklist-resolve.test.mjs — tasks/gap-worker-mcp-blacklist-strict-config, AC2/AC3/AC7.
//
// Pins the pure resolver behind `launchArgv`'s MCP blacklist:
//   AC2  three-source merge (user ~/.claude.json · project .mcp.json · plugin .mcp.json via
//        enabledPlugins) with the literal ${CLAUDE_PLUGIN_ROOT} expanded to the DETECTED version dir.
//        Negative control: a plugin whose version dir was renamed DISAPPEARS from the result while
//        every other entry survives (⛔ not an exception, ⛔ not a poisoned whole-run).
//   AC3  a source that EXISTS but cannot be read/parsed ⇒ the WHOLE resolution fails (ok:false) and
//        the caller appends NO mcp flag — 硬规则 3b: "读不懂" must not share the shape of "合格".
//        Negative control the other way: a source that is simply MISSING is NOT an error.
//   AC7  every test drives an injected fixture root; a fs watcher proves the real `~/.claude*` was
//        never touched (the seam is `roots` / `QUAY_MCP_CONFIG_ROOTS`, same shape as
//        worktree-process-reaper.ts's WORKTREE_PROCESS_REAPER_PS_SOURCE).
//
// Run: scripts/test.sh plugin/test/mcp-blacklist-resolve.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveMcpConfig,
  mcpConfigArgvSuffix,
  rootsFromEnv,
  expandPluginRoot,
  pluginServerKey,
  wrappedServerTable,
  serverTable,
  MCP_ROOTS_ENV,
  CLAUDE_PLUGIN_ROOT_VAR,
} from "../scripts/mcp-blacklist-resolve.ts";

// ── fixture（AC7：注入根，⛔ 不读真实 ~/.claude*）──────────────────────────────────────────────

const QUAY_VERSION = "9.9.9";
const ARCHGUARD_VERSION = "1.2.3";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** 三源 fixture：家目录 + 一个项目目录。返回根描述 + 各文件的绝对路径（供断言逐字比对）。 */
function makeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-blacklist-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const homeDir = path.join(dir, "home");
  const projectDirs = [path.join(dir, "project")];

  const quayRoot = path.join(homeDir, ".claude", "plugins", "cache", "quay", "quay", QUAY_VERSION);
  const archRoot = path.join(homeDir, ".claude", "plugins", "cache", "archguard", "archguard", ARCHGUARD_VERSION);

  // ① 用户级：⛔ `~/.claude.json` 顶层还有 `projects`（整部会话史）——夹具里放一个同名对象键，
  //    钉住 wrappedServerTable 的严格读法（按扁平读法会把整部历史当成 server 表）。
  writeJson(path.join(homeDir, ".claude.json"), {
    mcpServers: {
      "chrome-devtools": { command: "npx", args: ["chrome-devtools-mcp@latest"] },
      playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
      "user-extra": { command: "node", args: ["user-extra.js"] },
    },
    projects: { "/some/path": { history: ["x"] } },
  });

  // 插件启用表：quay/archguard 启用，stale 的插件根本不在盘上，off 显式 false（不算启用）。
  writeJson(path.join(homeDir, ".claude", "settings.json"), {
    enabledPlugins: { "quay@quay": true, "archguard@archguard": true, "stale@mp": true, "off@mp": false },
  });

  // ③ 插件级：quay 是【扁平】形，archguard 是 `mcpServers` 包裹形——两种真实形状都要认。
  writeJson(path.join(quayRoot, ".mcp.json"), {
    quay: { command: "node", args: [`${CLAUDE_PLUGIN_ROOT_VAR}/vendor/quay/dist/quay.js`, "mcp"], env: {} },
  });
  writeJson(path.join(archRoot, ".mcp.json"), {
    mcpServers: { archguard: { command: "node", args: [`${CLAUDE_PLUGIN_ROOT_VAR}/mcp-launcher.mjs`], env: {} } },
  });

  // ② 项目级
  writeJson(path.join(projectDirs[0], ".mcp.json"), {
    mcpServers: { "proj-server": { command: "node", args: ["proj.js"] } },
  });

  return { dir, homeDir, projectDirs, quayRoot, archRoot };
}

const BLACKLIST = ["chrome-devtools", "playwright"];

// ── AC7 — 真实 ~/.claude* 不可被读到（机械证明，不是纪律）─────────────────────────────────────

/** 跑 fn，期间记录（并按需拦截）对【真实家目录下 .claude* 路径】的读取。返回被读的真实路径列表。 */
function watchRealHome(fn) {
  const realHome = os.homedir();
  const real = path.join(realHome, ".claude");
  const hits = [];
  const orig = fs.readFileSync;
  fs.readFileSync = function patched(file, ...rest) {
    const p = typeof file === "string" ? file : String(file);
    if (p === path.join(realHome, ".claude.json") || p.startsWith(real + path.sep)) hits.push(p);
    return orig.call(this, file, ...rest);
  };
  try {
    return { value: fn(), hits };
  } finally {
    fs.readFileSync = orig;
  }
}

test("AC7 — resolution over an injected fixture never reads the real ~/.claude*", (t) => {
  const fx = makeFixture(t);
  const { value: res, hits } = watchRealHome(() =>
    resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs }),
  );
  assert.deepEqual(hits, [], "fixture resolution must not touch the real home config");
  assert.equal(res.ok, true);
  // 夹具真的被读了（否则 hits==[] 也可能是「什么都没读」的恒真空转）。
  assert.ok(Object.keys(res.config.mcpServers).length > 0, "fixture was actually enumerated");
});

test("AC7 — rootsFromEnv honors the QUAY_MCP_CONFIG_ROOTS seam (and only it)", () => {
  const fxHome = "/nonexistent/fixture-home";
  const roots = rootsFromEnv(["proj"], { [MCP_ROOTS_ENV]: JSON.stringify({ homeDir: fxHome, projectDirs: ["proj"] }) });
  assert.equal(roots.homeDir, fxHome);
  assert.deepEqual(roots.projectDirs, ["proj"]);
  // 覆盖值存在但读不懂 ⇒ null（⛔ 不静默退回真实 home——那会把一个打错的缝变成对真实 ~/.claude* 的读）。
  assert.equal(rootsFromEnv(["proj"], { [MCP_ROOTS_ENV]: "{not json" }), null);
  assert.equal(rootsFromEnv(["proj"], { [MCP_ROOTS_ENV]: JSON.stringify({ projectDirs: [] }) }), null, "no homeDir");
  // 无覆盖 ⇒ 真实 home + 传入的 projectDirs + 可选 kernel plugin root（由调用方注入）。
  const prod = rootsFromEnv(["proj"], {}, "/kernel/plugin");
  assert.equal(prod.homeDir, os.homedir());
  assert.equal(prod.kernelPluginRoot, "/kernel/plugin");
});

// ── AC2 — 三源合并 + 占位符展开 ────────────────────────────────────────────────────────────────

test("AC2 — three sources merge and the blacklist is subtracted", (t) => {
  const fx = makeFixture(t);
  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs });
  assert.equal(res.ok, true, JSON.stringify(res));
  const table = res.config.mcpServers;
  assert.deepEqual(
    Object.keys(table).sort(),
    [pluginServerKey("quay", "quay"), pluginServerKey("archguard", "archguard"), "proj-server", "user-extra"].sort(),
    "user-level + project-level + plugin-level, blacklist removed",
  );
  assert.equal(table["chrome-devtools"], undefined, "blacklisted user-level server must be gone");
  assert.equal(table["playwright"], undefined, "blacklisted user-level server must be gone");
  // ④~ `projects`（会话史）⛔ 不是 server 表。
  assert.equal(table["projects"], undefined, "~/.claude.json's `projects` history map is NOT a server table");
});

test("AC2 — plugin-level entries expand ${CLAUDE_PLUGIN_ROOT} to the DETECTED version dir (not left literal)", (t) => {
  const fx = makeFixture(t);
  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs });
  const table = res.config.mcpServers;

  const quay = table[pluginServerKey("quay", "quay")];
  assert.ok(quay, "flat-shaped plugin .mcp.json (quay) must be recognized");
  assert.equal(quay.args[0], path.join(fx.quayRoot, "vendor", "quay", "dist", "quay.js"));
  assert.ok(!quay.args[0].includes(CLAUDE_PLUGIN_ROOT_VAR), "placeholder must be EXPANDED, not echoed back");

  const arch = table[pluginServerKey("archguard", "archguard")];
  assert.ok(arch, "mcpServers-wrapped plugin .mcp.json (archguard) must be recognized");
  assert.equal(arch.args[0], path.join(fx.archRoot, "mcp-launcher.mjs"));
  assert.ok(!arch.args[0].includes(CLAUDE_PLUGIN_ROOT_VAR));
});

test("AC2 — the plugin server KEY reproduces the mcp__plugin_<plugin>_<server>__ flattening", () => {
  // 这是 agent allowlist（plugin/agents/quay-task.md 的 tools: 面）能否命中的开关，不是命名品味。
  assert.equal(pluginServerKey("quay", "quay"), "plugin_quay_quay");
});

test("AC2 negative control — an unavailable plugin root DROPS that plugin, leaves the rest intact", (t) => {
  const fx = makeFixture(t);
  const roots = { homeDir: fx.homeDir, projectDirs: fx.projectDirs };
  const before = resolveMcpConfig(BLACKLIST, roots);
  assert.ok(before.config.mcpServers[pluginServerKey("quay", "quay")], "precondition: quay present");

  // 版本目录从 cache 树里移走（实测 2026-09-14：插件安装位置在同一会话内换过一次
  // `cache/meta-cc-marketplace/…/3.8.3` → `~/.local/share/meta-cc`）⇒ 候选根全部落空。
  fs.renameSync(fx.quayRoot, path.join(fx.dir, "relocated-elsewhere"));

  const after = resolveMcpConfig(BLACKLIST, roots);
  assert.equal(after.ok, true, "a missing plugin root is NOT a read failure — it is absence");
  assert.equal(after.config.mcpServers[pluginServerKey("quay", "quay")], undefined, "unlocatable ⇒ disappears");
  assert.ok(after.config.mcpServers[pluginServerKey("archguard", "archguard")], "other plugin unaffected");
  assert.ok(after.config.mcpServers["proj-server"], "other source unaffected");
  assert.ok(after.config.mcpServers["user-extra"], "other source unaffected");

  // 对照（对照组必须能把结论翻过来）：把版本目录放回 ⇒ 该条目立刻回来。
  // ⛔ 没有这一半，「消失」就可能是「从来没接上」的假象（硬规则 4 推论四）。
  fs.renameSync(path.join(fx.dir, "relocated-elsewhere"), fx.quayRoot);
  assert.ok(
    resolveMcpConfig(BLACKLIST, roots).config.mcpServers[pluginServerKey("quay", "quay")],
    "restoring the root restores the entry",
  );
});

test("AC2 — the version dir is GLOBbed, never hardcoded (a differently-named version dir is still found)", (t) => {
  const fx = makeFixture(t);
  const roots = { homeDir: fx.homeDir, projectDirs: fx.projectDirs };
  assert.ok(resolveMcpConfig(BLACKLIST, roots).config.mcpServers[pluginServerKey("quay", "quay")]);
  fs.renameSync(fx.quayRoot, path.join(path.dirname(fx.quayRoot), "9.9.8-renamed"));
  assert.ok(
    resolveMcpConfig(BLACKLIST, roots).config.mcpServers[pluginServerKey("quay", "quay")],
    "any version dir under cache/<marketplace>/<name>/ is a candidate — the version number is not hardcoded",
  );
});

test("AC2 negative control — `enabledPlugins: {x: false}` is not enabled ⇒ not enumerated", (t) => {
  const fx = makeFixture(t);
  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs });
  assert.equal(res.config.mcpServers[pluginServerKey("off", "off")], undefined);
});

test("AC2 negative control — the kernel plugin root is claimed ONLY when its own manifest name matches", (t) => {
  const fx = makeFixture(t);
  const other = path.join(fx.dir, "kernel-plugin");
  writeJson(path.join(other, ".claude-plugin", "plugin.json"), { name: "someone-else" });
  writeJson(path.join(other, ".mcp.json"), { evil: { command: "node", args: ["evil.js"] } });
  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs, kernelPluginRoot: other });
  assert.equal(res.config.mcpServers[pluginServerKey("someone-else", "someone-else")], undefined);
  assert.equal(res.config.mcpServers["evil"], undefined, "a non-matching kernel root must not leak its servers in");
});

test("AC2 — kernel plugin root IS claimed when its manifest name matches the enabled plugin", (t) => {
  const fx = makeFixture(t);
  const other = path.join(fx.dir, "kernel-plugin");
  writeJson(path.join(other, ".claude-plugin", "plugin.json"), { name: "quay" });
  writeJson(path.join(other, ".mcp.json"), { quay: { command: "node", args: [`${CLAUDE_PLUGIN_ROOT_VAR}/x.js`] } });
  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs, kernelPluginRoot: other });
  assert.equal(res.config.mcpServers[pluginServerKey("quay", "quay")].args[0], path.join(other, "x.js"));
});

// ── AC3 — 读不懂 ⇒ 整体 null；缺失 ⇒ 不是错 ─────────────────────────────────────────────────────

test("AC3 — an EXISTING but unparseable source fails the WHOLE resolution (partial must not masquerade as complete)", (t) => {
  const fx = makeFixture(t);
  const userJson = path.join(fx.homeDir, ".claude.json");
  const good = fs.readFileSync(userJson, "utf8");
  fs.writeFileSync(userJson, "{ this is not json");

  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs });
  assert.equal(res.ok, false, "must be ok:false, NOT a partial result");
  assert.match(res.reason, /\.claude\.json/);

  // 调用方契约：失败 ⇒ 一个 mcp flag 都不加（argv 与改动前一致）。
  assert.deepEqual(mcpConfigArgvSuffix(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs }), []);

  // 负控制：修复后同一个根立刻回到 ok:true —— 证明上面那条红来自【内容】而不是夹具路径错了。
  fs.writeFileSync(userJson, good);
  assert.equal(resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs }).ok, true);
});

test("AC3 — a broken PROJECT source also fails the whole resolution (⛔ not silently 'no servers here')", (t) => {
  const fx = makeFixture(t);
  fs.writeFileSync(path.join(fx.projectDirs[0], ".mcp.json"), "nope");
  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs });
  assert.equal(res.ok, false);
  assert.match(res.reason, /\.mcp\.json/);
});

test("AC3 — a broken enabledPlugins block also fails the whole resolution", (t) => {
  const fx = makeFixture(t);
  writeJson(path.join(fx.homeDir, ".claude", "settings.json"), { enabledPlugins: ["not", "an", "object"] });
  const res = resolveMcpConfig(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs });
  assert.equal(res.ok, false);
  assert.match(res.reason, /enabledPlugins/);
});

test("AC3 negative control — a MISSING source is absence, not an error (⛔ the two must be distinguishable)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-blacklist-empty-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 一个什么都没有的家目录 + 一个什么都没有的项目目录：合法状态 ⇒ ok:true、空表。
  const roots = { homeDir: path.join(dir, "home"), projectDirs: [path.join(dir, "project")] };
  const res = resolveMcpConfig(BLACKLIST, roots);
  assert.equal(res.ok, true, "absent files are NOT a read failure");
  assert.deepEqual(res.config.mcpServers, {});
});

// ── argv 后缀：空表 ≠ 不加 flag ────────────────────────────────────────────────────────────────

test("argv suffix — empty blacklist ⇒ no flags at all (outer's argv is bit-for-bit unchanged)", (t) => {
  const fx = makeFixture(t);
  assert.deepEqual(mcpConfigArgvSuffix([], { homeDir: fx.homeDir, projectDirs: fx.projectDirs }), []);
});

test("argv suffix — a blacklist covering EVERY server still emits the flags (⛔ 'exclude' must not become 'connect all')", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-blacklist-all-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const homeDir = path.join(dir, "home");
  writeJson(path.join(homeDir, ".claude.json"), {
    mcpServers: { "chrome-devtools": { command: "npx" }, playwright: { command: "npx" } },
  });
  const argv = mcpConfigArgvSuffix(BLACKLIST, { homeDir, projectDirs: [] });
  assert.deepEqual(argv.slice(0, 2), ["--strict-mcp-config", "--mcp-config"]);
  assert.deepEqual(JSON.parse(argv[2]), { mcpServers: {} }, "empty table, NOT a fallback to 'no flags'");
});

test("argv suffix — unresolvable input ⇒ [] (the caller appends nothing)", (t) => {
  const fx = makeFixture(t);
  fs.writeFileSync(path.join(fx.homeDir, ".claude.json"), "broken");
  assert.deepEqual(mcpConfigArgvSuffix(BLACKLIST, { homeDir: fx.homeDir, projectDirs: fx.projectDirs }), []);
});

// ── 纯函数半边 ────────────────────────────────────────────────────────────────────────────────

test("expandPluginRoot — deep-copies and replaces every occurrence (input untouched)", () => {
  const input = { a: `${CLAUDE_PLUGIN_ROOT_VAR}/x`, b: [`${CLAUDE_PLUGIN_ROOT_VAR}/y`, 1, null], c: { d: `${CLAUDE_PLUGIN_ROOT_VAR}/z` } };
  const out = expandPluginRoot(input, "/root");
  assert.deepEqual(out, { a: "/root/x", b: ["/root/y", 1, null], c: { d: "/root/z" } });
  assert.equal(input.a, `${CLAUDE_PLUGIN_ROOT_VAR}/x`, "input must not be mutated");
  assert.equal(expandPluginRoot(42, "/root"), 42);
});

test("serverTable — accepts both real plugin shapes; wrappedServerTable is strict", () => {
  assert.deepEqual(serverTable({ s: { command: "x" } }), { s: { command: "x" } }, "flat (quay/meta-cc)");
  assert.deepEqual(serverTable({ mcpServers: { s: { command: "x" } } }), { s: { command: "x" } }, "wrapped (archguard)");
  // 严格读法：`~/.claude.json` 的 projects/other-object keys must NOT become servers.
  assert.deepEqual(wrappedServerTable({ projects: { "/p": {} }, mcpServers: { s: {} } }), { s: {} });
  assert.deepEqual(wrappedServerTable({ projects: { "/p": {} } }), {});
});
