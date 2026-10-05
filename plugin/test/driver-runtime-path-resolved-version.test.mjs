// @test-group engine
// driver-runtime-path-resolved-version.test.mjs — gap-path-resolved-quay-version-not-in-driver-status
//
// 缺陷（2026-10-05 生产实测）：`driver status` 报了**两个**版本量——常驻 anchor 实际加载的内核版本
// （`loaded_version`，取自 `/proc/<pid>/cmdline`）与注册表里的已安装版本——但缺**第三个**：执行
// `quay` 命令时 **PATH 实际命中的是哪一版**。本机实测 PATH 里冻结着
// `…/cache/quay/quay/0.11.0/bin`，`which -a quay` 第一项是 0.11.0，而注册表已是 0.14.0——人敲
// `quay …` 跑的是 0.11.0，而前两个量都不回答这一点（一个问 anchor 加载了哪版，一个问 config 指向哪版）。
//
// 本文件钉住新读数：`path_quay_version`（state）/ `path_quay`（命中的 realpath）/
// `path_quay_version_resolved`（从该路径读出的版本）。
// ⛔ 版本从**该版本目录的 `VERSION` 文件**读，⛔ 不 exec `quay --version`（它受 bundle 内嵌版本影响，
// 见 gap-release-bundle-embeds-dev-version-after-stamp）——AC2 用「--version 打印一个与 VERSION 不同的值」
// 的夹具钉死这一点。
// ⛔ 三种「读不到」（PATH 无 quay / 推不出版本 / 注册表读不出）一律 `not-evaluated`，⛔ 不与 `current`
// 同形（硬规则 3b）。
//
// Run: node --experimental-strip-types --test plugin/test/driver-runtime-path-resolved-version.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = path.resolve(__dirname, "..", "scripts", "driver-runtime.ts");

/** fixture 注册表（管已安装版本）：`<home>/.claude/plugins/installed_plugins.json` 的 `quay@quay` 条目。
 *  ⛔ 注册表是**已安装版本**的唯一权威来源；写进 fixture HOME 而不是读真 HOME ⇒ 本文件 hermetic
 *  （真 HOME 上的 quay@quay 版本随发布漂移 ⇒ 判据会随环境红绿）。 */
function writeRegistry(home, version) {
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "quay@quay": [
          {
            scope: "local",
            installPath: `/nowhere/cache/quay/quay/${version}`,
            version,
            installedAt: "2026-09-20T02:20:39.600Z",
            lastUpdated: "2026-09-23T06:43:08.658Z",
          },
        ],
      },
    }),
    "utf8",
  );
}

/** 一个「版本目录」：布局照抄真实 cache（`…/cache/quay/quay/<x.y.z>/{bin/quay,VERSION}`）。
 *  `bin/quay` 是**可执行的脚本**，`--version` 时打印 `cliVersion`（缺省 = 该目录 VERSION）。
 *  读版本走的是 `<dir>/VERSION` 文件（`versionOfKernelScript` 从 `bin/quay` 上跳到 `<dir>/`），
 *  ⛔ 不 exec 这个脚本。返回 `{ dir, quay }`。 */
function writeVersionDir(parent, version, cliVersion) {
  const dir = path.join(parent, version);
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "VERSION"), `${version}\n`, "utf8");
  const quay = path.join(dir, "bin", "quay");
  fs.writeFileSync(quay, `#!/bin/sh\necho ${cliVersion ?? version}\n`, "utf8");
  fs.chmodSync(quay, 0o755);
  return { dir, quay };
}

/** 一个 workspace root（`.quay/` 空即可 —— status 不需要 config.yml；同 driver-status-carrier-path.test.mjs）。 */
function makeRoot(t, tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pqver-${tag}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  return root;
}

/** 一个 fixture 世界：一个临时 cache 根 + 若干版本目录 + 一个 fixture HOME。 */
function makeWorld(t, tag, { registryVersion, versions }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `pqver-home-${tag}-`));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  if (registryVersion !== null) writeRegistry(home, registryVersion);
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), `pqver-cache-${tag}-`));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const dirs = {};
  for (const [version, cliVersion] of Object.entries(versions)) {
    dirs[version] = writeVersionDir(cacheRoot, version, cliVersion);
  }
  const root = makeRoot(t, tag);
  return { home, cacheRoot, dirs, root };
}

/** 跑 `driver status --kind worker --json`，PATH 与 HOME 都由 fixture 控制。 */
function statusJson(root, home, pathEnv) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", KERNEL, "status", "--kind", "worker", "--root", root, "--json"],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, HOME: home, PATH: pathEnv } },
  );
  assert.equal(r.status, 0, `status --json failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

function statusText(root, home, pathEnv) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", KERNEL, "status", "--kind", "worker", "--root", root],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, HOME: home, PATH: pathEnv } },
  );
  assert.equal(r.status, 0, `status failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

/** PATH 串：按给定顺序拼若干目录。 */
function pathOf(...dirs) {
  return dirs.join(path.delimiter);
}

// ── AC1a ─────────────────────────────────────────────────────────────────────────────────────────
// PATH 先命中旧版本目录（0.10.0）而注册表选新版（0.11.0）⇒ `path_quay_version` 为 behind，
// 并带命中的 realpath（`path_quay`）与从该路径读出的版本（`path_quay_version_resolved`）。
// ⛔ 取假形态：判定若「总是 current」或「总取 PATH 上最后一个 / 只看注册表」，本条立即红。
test("AC1a — PATH's first quay is OLDER than the installed version ⇒ path_quay_version=behind (+ realpath)", (t) => {
  const { home, dirs, root } = makeWorld(t, "ac1a", {
    registryVersion: "0.11.0",
    versions: { "0.10.0": "0.10.0", "0.11.0": "0.11.0" },
  });
  // PATH 顺序：旧版本目录在前 ⇒ 第一个命中的就是 0.10.0。
  const pathEnv = pathOf(path.join(dirs["0.10.0"].dir, "bin"), path.join(dirs["0.11.0"].dir, "bin"));

  const st = statusJson(root, home, pathEnv);
  assert.equal(st.path_quay_version, "behind", `PATH 命中的旧版本 ⇒ behind: ${JSON.stringify(st)}`);
  assert.notEqual(st.path_quay_version, "current", `⛔ 必不得报 current（这正是缺陷形态）: ${JSON.stringify(st)}`);
  // 命中的 realpath 就是 PATH 上第一个 quay（⛔ 不是第二个、⛔ 不是注册表路径）。
  assert.equal(st.path_quay, fs.realpathSync(dirs["0.10.0"].quay), `path_quay = 命中的 realpath: ${JSON.stringify(st)}`);
  assert.notEqual(st.path_quay, path.join(dirs["0.11.0"].dir, "bin", "quay"), `⛔ 不得命中 PATH 上第二个 quay: ${JSON.stringify(st)}`);
  // 版本从该路径读出（0.10.0，⛔ 不是注册表的 0.11.0）。
  assert.equal(st.path_quay_version_resolved, "0.10.0", `读出的版本: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay_version_relation, "loaded-older", `方向单列: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay_version_reason, null, `有结论 ⇒ reason 为空: ${JSON.stringify(st)}`);
});

// ── AC1b ─────────────────────────────────────────────────────────────────────────────────────────
// PATH 命中的版本与注册表一致 ⇒ current（与 AC1a 是**同一份 fixture 代码**，只改 PATH —— 这样
// 「behind」就不能是一个恒真读数，硬规则 4：结构上不可能取假的量不是测量）。
test("AC1b — PATH's first quay MATCHES the installed version ⇒ current", (t) => {
  const { home, dirs, root } = makeWorld(t, "ac1b", {
    registryVersion: "0.11.0",
    versions: { "0.10.0": "0.10.0", "0.11.0": "0.11.0" },
  });
  // 只把新版本目录放进 PATH ⇒ 命中的是 0.11.0。
  const pathEnv = pathOf(path.join(dirs["0.11.0"].dir, "bin"));

  const st = statusJson(root, home, pathEnv);
  assert.equal(st.path_quay_version, "current", `一致 ⇒ current: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay_version_resolved, "0.11.0", `读出的版本: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay, fs.realpathSync(dirs["0.11.0"].quay), `命中的 realpath: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay_version_relation, "equal", `方向: ${JSON.stringify(st)}`);
});

// ── AC1c ─────────────────────────────────────────────────────────────────────────────────────────
// PATH 上根本没有 quay ⇒ not-evaluated，且 **⛔ 不与 current 同形**（硬规则 3b）。
test("AC1c — no `quay` on PATH ⇒ not-evaluated, explicitly NOT current", (t) => {
  const { home, root } = makeWorld(t, "ac1c", { registryVersion: "0.11.0", versions: {} });
  // 一个存在的、但里面没有 quay 的目录。
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "pqver-empty-ac1c-"));
  t.after(() => fs.rmSync(emptyDir, { recursive: true, force: true }));

  const st = statusJson(root, home, pathOf(emptyDir));
  assert.equal(st.path_quay_version, "not-evaluated", `PATH 无 quay ⇒ not-evaluated: ${JSON.stringify(st)}`);
  assert.notEqual(st.path_quay_version, "current", `⛔ 必不得与 current 同形: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay, null, `没有命中的路径: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay_version_resolved, null, `没有读出的版本: ${JSON.stringify(st)}`);
  assert.ok(
    typeof st.path_quay_version_reason === "string" && st.path_quay_version_reason.length > 0,
    `⛔ 「读不到」必须给出原因（空原因与「没问题」同形）: ${JSON.stringify(st)}`,
  );
});

// ── AC1d ─────────────────────────────────────────────────────────────────────────────────────────
// 注册表读不出（比对的基准缺失）⇒ not-evaluated，⛔ 不与 current 同形。
// 注意：即便 PATH 命中的版本可读（`path_quay_version_resolved` 仍给出），state 也必须是 not-evaluated ——
// 「有一条输入读不到」不得降级成「一致」。
test("AC1d — registry unreadable ⇒ not-evaluated (no baseline), even though the PATH quay resolves", (t) => {
  const { home, dirs, root } = makeWorld(t, "ac1d", {
    registryVersion: null, // ⛔ 不写注册表
    versions: { "0.11.0": "0.11.0" },
  });
  const pathEnv = pathOf(path.join(dirs["0.11.0"].dir, "bin"));

  const st = statusJson(root, home, pathEnv);
  assert.equal(st.path_quay_version, "not-evaluated", `注册表读不出 ⇒ not-evaluated: ${JSON.stringify(st)}`);
  assert.notEqual(st.path_quay_version, "current", `⛔ 必不得与 current 同形: ${JSON.stringify(st)}`);
  // 命中的路径与版本仍如实报出（⛔ 不得因一半读不到就把另一半也抹成 null）。
  assert.equal(st.path_quay, fs.realpathSync(dirs["0.11.0"].quay), `命中的路径仍读出: ${JSON.stringify(st)}`);
  assert.equal(st.path_quay_version_resolved, "0.11.0", `读出的版本仍读出: ${JSON.stringify(st)}`);
  assert.ok(
    typeof st.path_quay_version_reason === "string" && st.path_quay_version_reason.length > 0,
    `⛔ 「读不到基准」必须给出原因: ${JSON.stringify(st)}`,
  );
});

// ── AC2 ──────────────────────────────────────────────────────────────────────────────────────────
// 版本来自该目录的 `VERSION` 文件，**⛔ 不是** `bin/quay --version` 的输出：夹具里让
// `bin/quay --version` 打印一个与 VERSION 不同的值（9.9.9-fake），读数仍取 VERSION（0.10.0）。
test("AC2 — version comes from the version dir's VERSION file, NOT from `quay --version`", (t) => {
  const { home, dirs, root } = makeWorld(t, "ac2", {
    registryVersion: "0.11.0",
    // ⛔ 这个目录的 bin/quay 打印 9.9.9-fake，而它的 VERSION 文件是 0.10.0。
    versions: { "0.10.0": "9.9.9-fake" },
  });
  const pathEnv = pathOf(path.join(dirs["0.10.0"].dir, "bin"));

  // 先证明夹具成立：直接跑 bin/quay --version ⇒ 打印的是 9.9.9-fake（与 VERSION 不同）。
  const cli = spawnSync(dirs["0.10.0"].quay, ["--version"], { encoding: "utf8", timeout: 10000, env: { ...process.env, PATH: pathEnv } });
  assert.equal(cli.status, 0, `fixture bin/quay --version failed: ${cli.stdout}\n${cli.stderr}`);
  assert.equal(cli.stdout.trim(), "9.9.9-fake", `fixture 的 --version 输出与 VERSION 不同: ${JSON.stringify(cli.stdout)}`);
  // 而 VERSION 文件是 0.10.0。
  assert.equal(fs.readFileSync(path.join(dirs["0.10.0"].dir, "VERSION"), "utf8").trim(), "0.10.0", "VERSION 文件");

  // 读数取 VERSION（0.10.0），⛔ 不是 --version 的 9.9.9-fake。
  const st = statusJson(root, home, pathEnv);
  assert.equal(
    st.path_quay_version_resolved,
    "0.10.0",
    `⛔ 必须取 VERSION 文件而非 --version 输出（后者是 9.9.9-fake）: ${JSON.stringify(st)}`,
  );
  assert.notEqual(st.path_quay_version_resolved, "9.9.9-fake", `⛔ 不得取 --version 输出: ${JSON.stringify(st)}`);
  // 且判定用 VERSION（0.10.0 < 0.11.0）⇒ behind（若误用 9.9.9-fake 会得到 ahead）。
  assert.equal(st.path_quay_version, "behind", `判定基于 VERSION 文件: ${JSON.stringify(st)}`);
});

// ── AC2b ─────────────────────────────────────────────────────────────────────────────────────────
// 人类可读形态与 JSON 同态：行内出现 `path_quay_version=` 且携带 realpath；⛔ 仍是一整行（既有判据
// driver-status-carrier-path.test.mjs AC3 钉住「恰好一行正文 + 尾换行」，本任务⛔ 不撞它）。
test("AC2b — the text form carries path_quay_version + the realpath, still ONE line", (t) => {
  const { home, dirs, root } = makeWorld(t, "ac2b", {
    registryVersion: "0.11.0",
    versions: { "0.10.0": "0.10.0", "0.11.0": "0.11.0" },
  });
  const pathEnv = pathOf(path.join(dirs["0.10.0"].dir, "bin"), path.join(dirs["0.11.0"].dir, "bin"));

  const txt = statusText(root, home, pathEnv);
  assert.match(txt, /path_quay_version=behind/, `行内报出 behind: ${txt}`);
  assert.match(txt, new RegExp(`path=${fs.realpathSync(dirs["0.10.0"].quay).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `行内带命中的 realpath: ${txt}`);
  assert.equal(txt.split("\n").length, 2, `⛔ 仍是一行正文 + 尾换行: ${JSON.stringify(txt)}`);
  assert.equal(txt.at(-1), "\n", `尾换行: ${JSON.stringify(txt.at(-1))}`);
});

// ── AC2c（负控制）────────────────────────────────────────────────────────────────────────────────
// PATH 无 quay ⇒ 人类可读形态显式印 `path_quay_version=not-evaluated`，⛔ 不印空值、⛔ 不印 current
// （空串与「没问题」同形，硬规则 3b）。
test("AC2c — text form prints path_quay_version=not-evaluated (⛔ never silently current)", (t) => {
  const { home, root } = makeWorld(t, "ac2c", { registryVersion: "0.11.0", versions: {} });
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "pqver-empty-ac2c-"));
  t.after(() => fs.rmSync(emptyDir, { recursive: true, force: true }));

  const txt = statusText(root, home, pathOf(emptyDir));
  assert.match(txt, /path_quay_version=not-evaluated/, `显式报「未评估」: ${txt}`);
  assert.doesNotMatch(txt, /path_quay_version=current\b/, `⛔ 不得报 current: ${txt}`);
});
