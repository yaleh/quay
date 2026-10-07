// @test-group engine
// driver-runtime-loaded-version-drift.test.mjs — gap-driver-status-loaded-vs-installed-version-drift
//
// 缺陷（2026-09-23 生产实测，claudecodeui）：`driver status` 的新鲜度判定（`supervisor_stale` /
// `source_watch`）求值的是**执行 status 的那个 kernel 自己的目录**，⛔ 不是**正在运行的 anchor 实际
// 加载的目录**。插件 0.11.0 装好后，pid 2166980 仍在跑 `…/cache/quay/quay/0.10.0/scripts/dist/
// driver-anchor.js`（2026-09-20 10:28 起），而 0.11.0 的 status 读出 `supervisor_stale="fresh"`
// ——「落后 3 天的进程」与「一切正常」同形（硬规则 3b）。上游 `caeca6f9c` 因此在 claudecodeui 整整
// 3 天未生效，而没有任何读数能显示这一点。
//
// 本文件钉住新读数：`loaded_version` / `loaded` / `installed` / `config_provider_path`。
// ⛔ 它读的是**运行中进程的**记录（`/proc/<pid>/cmdline`，外部可核的直接量），故 fixture 必须有一个
// **真的在跑**的宿主进程 —— 结构上无法在一个「只看查询者自己目录」的实现上取假（那正是缺陷形态）。
//
// Run: node --test plugin/test/driver-runtime-loaded-version-drift.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = path.resolve(__dirname, "..", "scripts", "driver-runtime.ts");

/** fixture 的 kernel 版本目录：`<cacheRoot>/cache/quay/quay/<version>/scripts/dist/`。
 *  形态照抄真实 cache 布局（`~/.claude/plugins/cache/quay/quay/<x.y.z>/…`），因为 `versionOfKernelScript`
 *  的 ① 分支读的正是 `<…>/<version>/VERSION`、② 分支读的是路径里的版本段——两者都要在这个布局上取真。 */
function writeFixtureKernel(cacheRoot, version) {
  const dir = path.join(cacheRoot, "cache", "quay", "quay", version, "scripts", "dist");
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, "driver-anchor.js");
  // 一个真的会一直活着的「内核」：本文件需要 /proc/<pid>/cmdline 上**真的有**一个内核实参。
  fs.writeFileSync(script, "setTimeout(() => {}, 600000);\n", "utf8");
  fs.writeFileSync(path.join(cacheRoot, "cache", "quay", "quay", version, "VERSION"), `${version}\n`, "utf8");
  return script;
}

/** 起一个真的在跑的「anchor」（加载 <kernelScript>，常驻）。⛔ 必须真跑：判定读的是它自己的
 *  `/proc/<pid>/cmdline`，一个写死在 fixture 里的 pid 结构上取不到假。 */
function spawnFakeAnchor(t, kernelScript) {
  const p = spawn(process.execPath, [kernelScript], { stdio: "ignore" });
  t.after(() => {
    try { p.kill("SIGKILL"); } catch { /* already gone */ }
  });
  // 等到 /proc/<pid>/cmdline 可读（最多 3s）——否则会读到一个尚未 exec 完的进程。
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(`/proc/${p.pid}/cmdline`, "utf8");
      if (raw.includes(kernelScript)) return p.pid;
    } catch { /* not yet */ }
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"]);
  }
  throw new Error(`fake anchor pid ${p.pid} never became readable via /proc`);
}

/** fixture HOME（管已安装版本）：`<home>/.claude/plugins/installed_plugins.json`。
 *  ⛔ 注册表是**已安装版本**的唯一权威来源；把它放进 fixture HOME 而不是读真 HOME，本文件才 hermetic
 *  （真 HOME 上的 quay@quay 版本会随发布漂移 ⇒ 判据会随环境红绿）。 */
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

/** 一个 workspace root：`.quay/` + 可选 anchor 载体。`anchorState` 三态：
 *  · {kind:"live", pid, kernel}  ⇒ 写 anchor.pid + anchor.json（回读面，替 /proc 读不到内核时兜底）
 *  · {kind:"none"}               ⇒ 什么都不写（运行记录缺失 —— AC3 的形态） */
function makeRoot(t, tag, anchorState, configText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `lvdrift-${tag}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  if (configText !== undefined) fs.writeFileSync(path.join(root, ".quay", "config.yml"), configText, "utf8");
  if (anchorState.kind === "live") {
    fs.writeFileSync(path.join(root, ".quay", "anchor.pid"), `${anchorState.pid}\n`, "utf8");
    fs.writeFileSync(
      path.join(root, ".quay", "anchor.json"),
      JSON.stringify({
        pid: anchorState.pid,
        startedAt: "2026-09-20T02:28:51.007Z",
        kinds: ["promotion", "worker", "outer", "goal", "quality", "meta"],
        host: "anchor",
        bundle: {
          state: "not-evaluated",
          kernel: anchorState.kernel ?? null,
          builtAt: null,
          sourceDir: null,
          sourceMtime: null,
          kinds: [],
          rebuild: null,
          at: "2026-09-23T08:43:46.514Z",
        },
      }),
      "utf8",
    );
  }
  return root;
}

function statusJson(root, home) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", KERNEL, "status", "--kind", "worker", "--root", root, "--json"],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, HOME: home } },
  );
  assert.equal(r.status, 0, `status --json failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

function statusText(root, home) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", KERNEL, "status", "--kind", "worker", "--root", root],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, HOME: home } },
  );
  assert.equal(r.status, 0, `status failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

/** 一个 fixture 世界：真在跑的宿主 → 它加载的 0.10.0 内核；注册表说已安装 0.11.0。 */
function driftedWorld(t, tag, { installed = "0.11.0", loadedVersion = "0.10.0", configText } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `lvdrift-home-${tag}-`));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  writeRegistry(home, installed);
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lvdrift-cache-${tag}-`));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const kernelScript = writeFixtureKernel(cacheRoot, loadedVersion);
  const pid = spawnFakeAnchor(t, kernelScript);
  const root = makeRoot(t, tag, { kind: "live", pid, kernel: kernelScript }, configText);
  return { home, root, kernelScript, pid };
}

// ── AC1 ───────────────────────────────────────────────────────────────────────────────────────────
// 运行记录声明 kernel 0.10.0、当前安装 0.11.0 ⇒ loaded_version "behind"，并带 loaded/installed 两个版本号。
// ⛔ 取假形态（本条要挡的正是它）：判定若以**查询者自己的目录**为准（= 本 kernel = 本 worktree 的
// `plugin/VERSION` = 0.12.0-dev），在同一 fixture 上会读出 current 或 not-evaluated，⛔ 不会是 behind。
test("AC1 — running host loaded 0.10.0 while 0.11.0 is installed ⇒ loaded_version=behind (+ both versions)", (t) => {
  const { home, root, kernelScript, pid } = driftedWorld(t, "ac1");

  const st = statusJson(root, home);
  assert.equal(st.loaded_version, "behind", `落后必须报 behind（改前无此字段）: ${JSON.stringify(st)}`);
  assert.equal(st.loaded, "0.10.0", `loaded = 运行中进程实际加载的那份: ${JSON.stringify(st)}`);
  assert.equal(st.installed, "0.11.0", `installed = 注册表里已安装的版本: ${JSON.stringify(st)}`);
  assert.equal(st.installed_at, "2026-09-23T06:43:08.658Z", `附安装时刻: ${JSON.stringify(st)}`);
  assert.equal(st.installed_source, "registry", `版本来源单列: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version_relation, "loaded-older", `方向单列: ${JSON.stringify(st)}`);
  // 直接量：读的是**那个进程**加载的内核路径（/proc/<pid>/cmdline 的 exec 实参）。
  assert.equal(st.loaded_kernel, kernelScript, `loaded_kernel = 宿主进程自己的 cmdline 实参: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_kernel_source, "proc-cmdline", `来源是外部可核的直接量: ${JSON.stringify(st)}`);
  assert.ok(fs.existsSync(st.loaded_kernel), `被点名的内核文件真的在盘上: ${st.loaded_kernel}`);
  // 宿主 pid 就是 fixture 起的那一个（⛔ 不是 fixture 里写死的常量）。
  assert.equal(st.anchor_pid, pid, `宿主 = fixture 里真跑着的那个进程: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version_reason, null, `有结论 ⇒ reason 为空: ${JSON.stringify(st)}`);
});

// ── AC1b（同一条判据的第二来源）──────────────────────────────────────────────────────────────────
// `/proc/<pid>/cmdline` 读不到内核实参时，退回 anchor **每个 reconcile pass 重写**的回读面
// `.quay/anchor.json.bundle.kernel`——但必须单列来源，⛔ 不把「自报」与「直接量」混成同一个读数。
test("AC1b — when cmdline carries no kernel script, the anchor's own read-back面 supplies it (source named)", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lvdrift-home-ac1b-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  writeRegistry(home, "0.11.0");
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lvdrift-cache-ac1b-"));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const kernelScript = writeFixtureKernel(cacheRoot, "0.10.0");
  // 宿主进程的 cmdline 里【没有】内核脚本（一个 plain sleep 形进程）。
  const p = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000);"], { stdio: "ignore" });
  t.after(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } });
  const root = makeRoot(t, "ac1b", { kind: "live", pid: p.pid, kernel: kernelScript });

  const st = statusJson(root, home);
  assert.equal(st.loaded_kernel_source, "anchor-state", `回退来源必须单列: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_kernel, kernelScript, `回读面给出的内核路径: ${JSON.stringify(st)}`);
  assert.equal(st.loaded, "0.10.0", `版本仍从该路径推出: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version, "behind", `兜底路径上的判定同样成立: ${JSON.stringify(st)}`);
});

// ── AC2 ───────────────────────────────────────────────────────────────────────────────────────────
// 同版本 ⇒ current。⛔ 与 AC1 是**同一份 fixture 代码**，只换注册表里的版本号——这样「behind」就不能是
// 一个恒真读数（硬规则 4：结构上不可能取假的量不是测量）。
test("AC2 — loaded version == installed version ⇒ current (same fixture, only the registry differs)", (t) => {
  const { home, root } = driftedWorld(t, "ac2", { installed: "0.10.0", loadedVersion: "0.10.0" });

  const st = statusJson(root, home);
  assert.equal(st.loaded, "0.10.0", `loaded: ${JSON.stringify(st)}`);
  assert.equal(st.installed, "0.10.0", `installed: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version, "current", `一致必须报 current（⛔ 不是 behind）: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version_relation, "equal", `relation: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version_reason, null, `有结论 ⇒ reason 为空: ${JSON.stringify(st)}`);
});

// AC2b —— `ahead` 是**第四个独立取值**：宿主跑的是比注册表更新的一版内核（本仓库自己的开发检出正是这个
// 形态：anchor 跑源树 `<repo>/plugin/scripts/driver-anchor.ts`，而注册表上最新的是已发布的一版）。
// ⛔ 并进 `behind` 会在 quay 自己的工作区上**永久**报一个方向错误的读数（硬规则 3：枚举，不布尔）。
test("AC2b — host running a NEWER kernel than installed ⇒ ahead (⛔ NOT folded into behind)", (t) => {
  const { home, root } = driftedWorld(t, "ac2b", { installed: "0.10.0", loadedVersion: "0.12.0-dev" });

  const st = statusJson(root, home);
  assert.equal(st.loaded, "0.12.0-dev", `loaded: ${JSON.stringify(st)}`);
  assert.equal(st.installed, "0.10.0", `installed: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version, "ahead", `方向相反 ⇒ ahead: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version_relation, "loaded-newer", `relation: ${JSON.stringify(st)}`);
  assert.notEqual(st.loaded_version, "behind", `⛔ 不得报 behind（那是一个方向错误的读数）: ${JSON.stringify(st)}`);
});

// ── AC3 ───────────────────────────────────────────────────────────────────────────────────────────
// 运行记录缺失 ⇒ not-evaluated，且 **⛔ 不与 `current` 同形**（硬规则 3b：「读不到」不得伪装成「合格」）。
test("AC3 — no run record (no live host) ⇒ not-evaluated, explicitly NOT current", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lvdrift-home-ac3-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  writeRegistry(home, "0.11.0");
  const root = makeRoot(t, "ac3", { kind: "none" });

  const st = statusJson(root, home);
  assert.equal(st.loaded_version, "not-evaluated", `无运行记录 ⇒ not-evaluated: ${JSON.stringify(st)}`);
  assert.notEqual(st.loaded_version, "current", `⛔ 必不得与 current 同形: ${JSON.stringify(st)}`);
  assert.equal(st.loaded, null, `无运行记录 ⇒ 没有 loaded 版本: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_kernel, null, `无运行记录 ⇒ 没有内核路径: ${JSON.stringify(st)}`);
  assert.equal(st.loaded_version_relation, "not-evaluated", `relation 同样独立: ${JSON.stringify(st)}`);
  assert.ok(
    typeof st.loaded_version_reason === "string" && st.loaded_version_reason.length > 0,
    `⛔ 「读不到」必须给出原因（空原因与「没问题」同形）: ${JSON.stringify(st)}`,
  );
  // 已安装版本这半边仍然可读（它不依赖运行中的进程）——⛔ 不得因为一半读不到就把另一半也抹成 null。
  assert.equal(st.installed, "0.11.0", `已安装版本仍读出: ${JSON.stringify(st)}`);
});

// AC3b —— 人类可读形态同样不得把「读不到」印成合格（⛔ 不是 absence of output）。
test("AC3b — the text form prints loaded-version-not-evaluated (⛔ never silently current)", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lvdrift-home-ac3b-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  writeRegistry(home, "0.11.0");
  const root = makeRoot(t, "ac3b", { kind: "none" });

  const txt = statusText(root, home);
  assert.match(txt, /loaded-version-not-evaluated:/, `显式报「未评估」: ${txt}`);
  assert.doesNotMatch(txt, /\bloaded-version-current\b/, `⛔ 不得报 current: ${txt}`);
  assert.equal(txt.split("\n")[0].startsWith("loaded-version-"), true, `该读数在行首（第一行）: ${txt}`);
});

// ── AC4 ───────────────────────────────────────────────────────────────────────────────────────────
// 第二个漂移源：`.quay/config.yml` 的 provider `path` 写的是**安装当时**的版本目录，升级后不变。
test("AC4 — config provider path version segment behind the installed version ⇒ config_provider_path=behind", (t) => {
  const { home, root } = driftedWorld(t, "ac4", {
    // claudecodeui 的真实形态（2026-09-23 实测）：provider path 仍指向 0.10.0 的 cache 版本目录。
    configText:
      "providers:\n" +
      "  native:\n" +
      "    enabled: true\n" +
      "    path: \"/data/home/yale/.claude/plugins/cache/quay/quay/0.10.0/vendor/quay-native\"\n" +
      "    tasks_dir: \"./tasks\"\n",
  });

  const st = statusJson(root, home);
  assert.equal(st.config_provider_path, "behind", `配置里的版本段落后 ⇒ behind: ${JSON.stringify(st)}`);
  assert.equal(st.config_provider_path_version, "0.10.0", `附读到的版本段: ${JSON.stringify(st)}`);
});

// AC4b —— 负控制：「没有版本段可比」（源检出形态的 `./packages/quay-native`）⇒ not-evaluated，
// ⛔ 不得报成 current（「没比过」与「比过了、一致」必须不同形，硬规则 3b）。
test("AC4b — a provider path with NO version segment ⇒ not-evaluated (⛔ NOT current)", (t) => {
  const { home, root } = driftedWorld(t, "ac4b", {
    configText: "providers:\n  native:\n    enabled: true\n    path: \"./packages/quay-native\"\n",
  });

  const st = statusJson(root, home);
  assert.equal(st.config_provider_path, "not-evaluated", `无版本段 ⇒ 未评估: ${JSON.stringify(st)}`);
  assert.notEqual(st.config_provider_path, "current", `⛔ 不得与「一致」同形: ${JSON.stringify(st)}`);
  assert.equal(st.config_provider_path_version, null, `没有可报的版本段: ${JSON.stringify(st)}`);
});

// AC4c —— 一致时必须是 current（与 AC4/AC4b 构成三态：behind / not-evaluated / current 各自可区分）。
test("AC4c — config provider path matching the installed version ⇒ current", (t) => {
  const { home, root } = driftedWorld(t, "ac4c", {
    configText:
      "providers:\n  native:\n    path: \"/data/home/yale/.claude/plugins/cache/quay/quay/0.11.0/vendor/quay-native\"\n",
  });

  const st = statusJson(root, home);
  assert.equal(st.config_provider_path, "current", `一致 ⇒ current: ${JSON.stringify(st)}`);
  assert.equal(st.config_provider_path_version, "0.11.0", `附读到的版本段: ${JSON.stringify(st)}`);
});

// AC4d —— 项目内**稳定链接**形态（gap-config-provider-path-frozen-to-versioned-cache-dir 引入）：
// `path: <ws>/.quay/plugin/vendor/quay-native` 的 TEXT 里**没有**版本段，但它是**符号链接** —— 解析后
// 的真实安装目录（`…/cache/quay/quay/0.10.0/…`）里有。判定必须 `readlink -f` 后再取版本段，⛔ 不得因
// 「文本无版本段」就报 not-evaluated：那会把「链接指着一个落后的版本」伪装成「没有版本可比」（硬规则 3b）。
test("AC4d — the project-internal .quay/plugin symlink: version read from the RESOLVED install dir", (t) => {
  const { home, root } = driftedWorld(t, "ac4d"); // no configText — this test writes its own
  // A fixture install directory the project link resolves to (0.10.0), while the registry says 0.11.0.
  const installParent = fs.mkdtempSync(path.join(os.tmpdir(), "lvdrift-link-ac4d-"));
  t.after(() => fs.rmSync(installParent, { recursive: true, force: true }));
  const installDir = path.join(installParent, "cache", "quay", "quay", "0.10.0");
  fs.mkdirSync(path.join(installDir, "vendor", "quay-native"), { recursive: true });
  fs.symlinkSync(installDir, path.join(root, ".quay", "plugin"));
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    "providers:\n" +
      "  native:\n" +
      "    enabled: true\n" +
      `    path: "${root}/.quay/plugin/vendor/quay-native"\n`,
    "utf8",
  );

  const st = statusJson(root, home);
  assert.equal(
    st.config_provider_path,
    "behind",
    `链接解析出的安装目录落后于已安装版本 ⇒ behind（⛔ 不得报 not-evaluated）: ${JSON.stringify(st)}`,
  );
  assert.equal(st.config_provider_path_version, "0.10.0", `附解析后的版本段: ${JSON.stringify(st)}`);
});

// AC4e —— 负控制（与 AC4d 同一份代码，只去掉符号链接）：一个**不存在的**、无版本段的相对路径 ⇒
// not-evaluated。这证明 AC4d 的 behind 来自 readlink，而不是「凡无版本段都报 behind」。
test("AC4e — an unresolvable no-version path stays not-evaluated (negative control for AC4d)", (t) => {
  const { home, root } = driftedWorld(t, "ac4e", {
    configText: "providers:\n  native:\n    enabled: true\n    path: \"./.quay/plugin/vendor/quay-native\"\n",
  });

  const st = statusJson(root, home);
  assert.equal(st.config_provider_path, "not-evaluated", `不可解析 ⇒ 未评估: ${JSON.stringify(st)}`);
  assert.notEqual(st.config_provider_path, "behind", `⛔ 不得凭空报 behind: ${JSON.stringify(st)}`);
});

// ── AC5 ───────────────────────────────────────────────────────────────────────────────────────────
// 人类可读面：行首第一项 + `quay driver restart` 的提示；⛔ 输出仍是一整行（既有判据
// driver-status-carrier-path.test.mjs AC3 钉住「恰好一行正文 + 尾换行」，本任务⛔ 不撞它）。
test("AC5 — text form leads with loaded-version-behind + the restart hint, still ONE line", (t) => {
  const { home, root } = driftedWorld(t, "ac5");

  const txt = statusText(root, home);
  assert.match(txt, /^loaded-version-behind: /, `第一行以它开头（读者在看到 supervisor_stale=fresh 之前先看到它）: ${txt}`);
  assert.match(txt, /loaded=0\.10\.0/, `loaded 版本在行内: ${txt}`);
  assert.match(txt, /installed=0\.11\.0/, `installed 版本在行内: ${txt}`);
  assert.match(txt, /quay driver restart/, `behind 给出动作提示: ${txt}`);
  assert.equal(txt.split("\n").length, 2, `⛔ 仍是一行正文 + 尾换行: ${JSON.stringify(txt)}`);
  assert.equal(txt.at(-1), "\n", `尾换行: ${JSON.stringify(txt.at(-1))}`);
  // ⛔ 只提示、⛔ 不自动重启：本命令是只读的——宿主进程必须还活着（cmdline 仍可读 = 没被杀掉）。
  assert.ok(fs.readFileSync(`/proc/${st_pidOf(root)}/cmdline`, "utf8").length > 0, "宿主未被本命令停掉");
});

/** anchor.pid 里记的宿主 pid（AC5 的负控制：确认 status 没把它停掉）。 */
function st_pidOf(root) {
  return Number(fs.readFileSync(path.join(root, ".quay", "anchor.pid"), "utf8").trim());
}

// ── AC4 (gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it (B)) ──────
// `pointer` = Core's OWN plugin root version vs the project guidance link `.quay/plugin`'s target
// version. Four states, ⛔ `not-evaluated` never shares a shape with `current`. Core ⛔ writes the link
// from no runtime path (only `/quay:init` does) — the readlink-invariance test below is that half.

/** A minimal plugin root carrying a chosen `.claude-plugin/plugin.json` version. */
function fixturePluginRoot(t, tag, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lvdrift-plroot-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "quay", version }, null, 2));
  return dir;
}

/** Point `<root>/.quay/plugin` at a fixture plugin root of the given version; returns the target. */
function linkPlugin(t, root, tag, version, { withManifest = true } = {}) {
  const target = withManifest
    ? fixturePluginRoot(t, tag, version)
    : (() => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `lvdrift-plroot-${tag}-`)); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; })();
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const link = path.join(root, ".quay", "plugin");
  try { fs.rmSync(link, { force: true }); } catch { /* absent */ }
  fs.symlinkSync(target, link);
  return target;
}

function statusJsonEnv(root, home, extraEnv) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", KERNEL, "status", "--kind", "worker", "--root", root, "--json"],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, HOME: home, ...extraEnv } },
  );
  assert.equal(r.status, 0, `status --json failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("AC4-pointer① — Core plugin root 0.15.0 vs link 0.14.0 ⇒ pointer=behind (+ both versions)", (t) => {
  const core = fixturePluginRoot(t, "core15", "0.15.0");
  const { home, root } = driftedWorld(t, "ptr1");
  linkPlugin(t, root, "lk14", "0.14.0");

  const st = statusJsonEnv(root, home, { QUAY_PLUGIN_ROOT: core });
  assert.equal(st.pointer.state, "behind", `链接落后于 Core ⇒ behind: ${JSON.stringify(st.pointer)}`);
  assert.equal(st.pointer.core_version, "0.15.0", `Core 侧版本: ${JSON.stringify(st.pointer)}`);
  assert.equal(st.pointer.link_version, "0.14.0", `链接侧版本: ${JSON.stringify(st.pointer)}`);
  assert.equal(st.pointer.reason, null, `有结论 ⇒ reason 为空: ${JSON.stringify(st.pointer)}`);
});

test("AC4-pointer② — SAME fixture, link at the Core version ⇒ pointer=current (behind cannot be a constant)", (t) => {
  const core = fixturePluginRoot(t, "core15b", "0.15.0");
  const { home, root } = driftedWorld(t, "ptr2");
  linkPlugin(t, root, "lk15", "0.15.0");

  const st = statusJsonEnv(root, home, { QUAY_PLUGIN_ROOT: core });
  assert.equal(st.pointer.state, "current", `同版本 ⇒ current: ${JSON.stringify(st.pointer)}`);
});

test("AC4-pointer③ — no `.quay/plugin` ⇒ pointer=not-evaluated (⛔ never current)", (t) => {
  const core = fixturePluginRoot(t, "core15c", "0.15.0");
  const { home, root } = driftedWorld(t, "ptr3");

  const st = statusJsonEnv(root, home, { QUAY_PLUGIN_ROOT: core });
  assert.equal(st.pointer.state, "not-evaluated", `链接缺失 ⇒ not-evaluated: ${JSON.stringify(st.pointer)}`);
  assert.notEqual(st.pointer.state, "current", "⛔ not-evaluated 不得与 current 同形");
  assert.equal(st.pointer.link_target, null, `无链接 ⇒ link_target 为 null: ${JSON.stringify(st.pointer)}`);
});

test("AC4-pointer④ — link target WITHOUT a plugin.json ⇒ pointer=not-evaluated", (t) => {
  const core = fixturePluginRoot(t, "core15d", "0.15.0");
  const { home, root } = driftedWorld(t, "ptr4");
  linkPlugin(t, root, "lkbare", null, { withManifest: false });

  const st = statusJsonEnv(root, home, { QUAY_PLUGIN_ROOT: core });
  assert.equal(st.pointer.state, "not-evaluated", `目标无 plugin.json ⇒ not-evaluated: ${JSON.stringify(st.pointer)}`);
  assert.equal(st.pointer.link_version, null, `无版本可比: ${JSON.stringify(st.pointer)}`);
});

// AC3 (this task) — Core must not WRITE the link. `driver status` is the Core path this file can run
// cheaply; the static half (`grep` that only refreshProjectPluginLink constructs it) lives in the
// task's AC3 evidence.
test("AC3 — `driver status` leaves the `.quay/plugin` link byte-identical (Core never writes it)", (t) => {
  const core = fixturePluginRoot(t, "core15e", "0.15.0");
  const { home, root } = driftedWorld(t, "ptr5");
  const target = linkPlugin(t, root, "lk14e", "0.14.0");
  const link = path.join(root, ".quay", "plugin");
  const before = fs.readlinkSync(link);

  const st = statusJsonEnv(root, home, { QUAY_PLUGIN_ROOT: core });
  assert.equal(st.pointer.state, "behind");
  assert.equal(fs.readlinkSync(link), before, "the link target must be unchanged after `driver status`");
  assert.equal(fs.readlinkSync(link), target, "and it is still the fixture target");
});

// ── AC3 (this task, second half) — NO Core path writes `.quay/plugin` ───────────────────────────────
// `driver status` is exercised above; the MCP-launch path is exercised by `quay task list` (it spawns
// the provider MCP). `driver start` / `serve` are covered STRUCTURALLY by the static scan below (they
// share the same code path — none of them constructs `.quay/plugin` at all).

test("AC3b — the MCP-launch path (`quay task list`) leaves the `.quay/plugin` link byte-identical", (t) => {
  const REPO_ROOT = path.resolve(__dirname, "..", "..");
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lvdrift-link-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(ws, "tasks", "L-1.md"), "---\nid: L-1\ntitle: link probe\nstatus: todo\n---\n\n## Proposal\n" + "x".repeat(60) + "\n");
  // The native provider carries NO path/mcp_entry (the shape quay-init now writes).
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    tasks_dir: "${ws}/tasks"\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${ws}/tasks"\n`);
  const target = fixturePluginRoot(t, "mcp-path", "0.14.0");
  const link = path.join(ws, ".quay", "plugin");
  fs.symlinkSync(target, link);
  const before = fs.readlinkSync(link);

  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(REPO_ROOT, "packages", "quay", "bin", "quay.ts"), "task", "list", "--root", ws, "--json"],
    { encoding: "utf8", timeout: 90000 },
  );
  assert.equal(r.status, 0, `task list must succeed:\n${r.stdout}\n${r.stderr}`);
  assert.equal(fs.readlinkSync(link), before, "Core must NOT rewrite `.quay/plugin` on the MCP-launch path");
});

test("AC3c — STATIC: the ONLY source that constructs AND writes `.quay/plugin` is init.ts's refreshProjectPluginLink", () => {
  const REPO_ROOT = path.resolve(__dirname, "..", "..");
  const dirs = [path.join(REPO_ROOT, "packages", "quay", "src"), path.join(REPO_ROOT, "plugin", "scripts")];
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "dist" || e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
      const text = fs.readFileSync(p, "utf8");
      if (/symlinkSync/.test(text) && /"\.quay", *"plugin"/.test(text)) offenders.push(path.relative(REPO_ROOT, p));
    }
  };
  for (const d of dirs) walk(d);
  assert.deepEqual(offenders, [path.join("packages", "quay", "src", "init.ts")],
    `the ONLY writer of .quay/plugin must be init.ts (Core runtime paths must never write it); got ${JSON.stringify(offenders)}`);
});

// ══ gap-server-status-six-serial-driver-runtime-cold-spawns ═══════════════════════════════════════
// `quay server status --json`（`packages/quay/src/cli/server.ts`）reads ALL SIX driver kinds, and each
// read is a FULL `driver-runtime.ts` cold start + TS transpile (measured 0.23–1.02s per kind on this
// repo). The old call site was `DRIVER_SERVICE_KINDS.map(kind => driverServiceReport(...))` over a
// **synchronous** `spawnSync` ⇒ six cold starts strictly serialised: 3.92–4.07s wall for a ~3.2KB
// response body. The fix runs the six reads CONCURRENTLY (`Promise.all` over an async spawn).
//
// Concurrency is the kind of change that can silently corrupt a reading (two kinds' outputs swapped,
// one kind's failure cancelling the batch, rows reordered). The tests below pin exactly those three:
//
//   · AC3a — each row is its OWN reading: field-for-field equal to a DIRECT single-kind kernel read,
//            with per-kind-distinct carriers AND declarations so a swap cannot survive.
//   · AC3b — one kind's read failing (no carrier at all) leaves the other five untouched.
//   · AC4  — the six kernel invocations really OVERLAP in time (the property the serial version
//            lacked — this assertion fails on it), and a kind whose SUBPROCESS exits non-zero is
//            reported as an unusable reading without taking the other five down with it.
//
// ⛔ These read REAL fixture state (a really-running anchor process, real carrier files), never an
// injected "the flag was set" seam: 「六个 kind 各自返回自己的读数」 is only a measurement if the six
// readings are actually distinguishable from one another.

const SERVER_CLI = path.resolve(__dirname, "..", "..", "packages", "quay", "bin", "quay.ts");
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SERVER_KINDS = ["promotion", "worker", "outer", "quality", "meta", "goal"];

/** Each kind's **round** heartbeat carrier — the file that actually supplies `last_record_ts`. */
const ROUND_CARRIER = {
  promotion: "promotion-round.jsonl",
  worker: "worker-round.jsonl",
  outer: "outer-round.jsonl",
  quality: "quality-round.jsonl",
  meta: "meta-driver-round.jsonl",
  goal: "goal-round.jsonl",
};
/** The registry-FIRST carrier of the two kinds that carry two. Written with an OLDER ts on purpose:
 *  it is what makes `carrier_path` ("who is on disk") and `last_record_carrier` ("where the ts came
 *  from") DIFFERENT files — the real-workspace shape of gap-driver-status-carrier-path-source-label-
 *  mismatch. A row whose `liveness.source` named one of these would be attributing the ts to a载体
 *  that did not supply it. */
const OUTCOME_CARRIER = { promotion: "promotion-outcome.jsonl", worker: "worker-outcome.jsonl" };

/** Desired state is deliberately NOT "all six": the three declaration values are spread across the
 *  rows (`declared` / `not-declared` / `stopped-explicitly`) so that a swapped pair of rows is visible
 *  in `declaration` alone — a plan where every kind read the same value would make that field blind. */
const DESIRED_KINDS = ["promotion", "quality"];
const STOP_KINDS = ["outer", "goal"];
const EXPECTED_DECLARATION = {
  promotion: "declared",
  worker: "not-declared",
  outer: "stopped-explicitly",
  quality: "declared",
  meta: "not-declared",
  goal: "stopped-explicitly",
};

const jsonl = (obj) => JSON.stringify(obj) + "\n";
const iso = (epochMs) => new Date(epochMs).toISOString().slice(0, 19) + "Z";

/**
 * A workspace where one REAL live process carries all six kinds, each kind has its own carrier file
 * with its own timestamp, and the desired-state file yields a different declaration per kind.
 *
 * @param omitCarriers kinds whose carriers are NOT written — the "this kind never produced a
 *        heartbeat" case (AC3b's failure injection).
 */
function makeDriverWorkspace(t, tag, omitCarriers = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `srvstatus-${tag}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const q = path.join(root, ".quay");
  fs.mkdirSync(q, { recursive: true });
  fs.writeFileSync(
    path.join(q, "config.yml"),
    "providers:\n  native:\n    enabled: true\n    tasks_dir: \"./tasks\"\n",
    "utf8",
  );

  // The reading's direct quantity for "this kind is carried" is /proc liveness of the HOST process,
  // so a pid written into the fixture could not satisfy it — the anchor has to really run.
  const anchor = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000);"], { stdio: "ignore" });
  t.after(() => { try { anchor.kill("SIGKILL"); } catch { /* already gone */ } });
  fs.writeFileSync(path.join(q, "anchor.pid"), `${anchor.pid}\n`, "utf8");
  fs.writeFileSync(
    path.join(q, "anchor.json"),
    JSON.stringify({ pid: anchor.pid, startedAt: "2026-10-01T00:00:00.000Z", kinds: SERVER_KINDS, host: "anchor" }),
    "utf8",
  );

  const now = Date.now();
  // Distinct offsets per kind: the six round carriers differ by name AND by the ts they carry.
  const offsets = { promotion: 3, worker: 5, outer: 7, quality: 9, meta: 11, goal: 13 };
  for (const k of SERVER_KINDS) {
    if (omitCarriers.includes(k)) continue;
    const tsKey = k === "quality" ? "judgedAt" : "ts";
    fs.writeFileSync(
      path.join(q, ROUND_CARRIER[k]),
      jsonl({ [tsKey]: iso(now - offsets[k] * 1000), kind: k, marker: `round-${k}` }),
      "utf8",
    );
  }
  for (const [k, file] of Object.entries(OUTCOME_CARRIER)) {
    if (omitCarriers.includes(k)) continue;
    fs.writeFileSync(path.join(q, file), jsonl({ ts: iso(now - 90 * 60 * 1000), kind: k, marker: `outcome-${k}` }), "utf8");
  }
  fs.writeFileSync(
    path.join(q, "anchor-desired.json"),
    JSON.stringify({ kinds: DESIRED_KINDS, opts: {}, updatedBy: "fixture", updatedAt: "2026-10-01T00:00:00Z" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(q, "anchor-kind-stops.json"),
    JSON.stringify(Object.fromEntries(STOP_KINDS.map((k) => [k, { at: "2026-10-01T00:00:00Z", by: "fixture" }]))),
    "utf8",
  );
  return { root, anchorPid: anchor.pid };
}

/** One `quay server status --json`. The fixture carries no `.quay/server-state.json` ⇒ the documented
 *  NOT-RUNNING outcome (exit 1), which is ASSERTED rather than tolerated: the six driver rows are
 *  computed on that branch too (a dead host is exactly when you want to see which kind stopped
 *  turning), so a change that accidentally skipped them there must not read as a pass. */
function serverStatusJson(root, env = {}) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", SERVER_CLI, "server", "status", "--json", "--root", root],
    // QUAY_PLUGIN_ROOT pins the kernel to THIS checkout — otherwise the resolver would (correctly)
    // relocate a worktree-loaded Core to the main checkout's `plugin/`, and the test would be reading
    // a different tree than the one under test.
    { encoding: "utf8", timeout: 180000, env: { ...process.env, QUAY_PLUGIN_ROOT: PLUGIN_ROOT, ...env } },
  );
  assert.equal(r.status, 1, `no server-state carrier ⇒ NOT-RUNNING (exit 1); got ${r.status}\n${r.stdout}\n${r.stderr}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    assert.fail(`--json must emit a parseable document for EVERY outcome: ${r.stdout}\n${r.stderr}`);
  }
}

/** The reference reading: ONE kind, requested DIRECTLY from the kernel, with no aggregation in
 *  between. "Concurrent aggregation agrees with the direct read" is the falsifiable form of 「并发的
 *  六个读数各自正确、互不污染」 — a swap or a dropped field makes the two disagree. */
function directKindStatus(root, kind) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", KERNEL, "status", "--kind", kind, "--json", "--root", root],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(r.status, 0, `direct kernel status --kind ${kind} failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("AC3a — all six kinds are read concurrently and each row is that kind's OWN reading", (t) => {
  const { root, anchorPid } = makeDriverWorkspace(t, "six");
  const st = serverStatusJson(root);

  // Order is part of the reading (six rows, one per service, in the vocabulary's own order) — a
  // `Promise.all` must not be allowed to reorder them.
  assert.deepEqual(st.drivers.map((d) => d.kind), SERVER_KINDS, `row order must be unchanged: ${JSON.stringify(st.drivers)}`);

  for (const kind of SERVER_KINDS) {
    const row = st.drivers.find((d) => d.kind === kind);
    const direct = directKindStatus(root, kind);
    const label = `driver:${kind}`;

    assert.ok(row, `row for ${label} present: ${JSON.stringify(st.drivers)}`);
    assert.equal(row.name, label);
    assert.equal(row.pid, anchorPid, `${label}: carried by the live anchor: ${JSON.stringify(row)}`);
    // Field-for-field against the direct single-kind read — the 「逐一比对一致」 half of the AC.
    assert.equal(row.pid, direct.driver_pid, `${label}: pid vs direct: ${JSON.stringify([row.pid, direct.driver_pid])}`);
    assert.equal(row.declaration, direct.declaration, `${label}: declaration vs direct`);
    // The named SOURCE must be the file that actually supplied the ts — for promotion/worker that is
    // the ROUND carrier, NOT the registry-first outcome carrier that `carrier_path` reports.
    assert.equal(
      row.liveness.source,
      `carrier:${direct.last_record_carrier} last ts`,
      `${label}: source names the ts's own carrier: ${JSON.stringify(row.liveness)}`,
    );
    assert.equal(
      path.basename(row.liveness.source),
      `${ROUND_CARRIER[kind]} last ts`,
      `${label}: the round carrier, not the outcome carrier: ${row.liveness.source}`,
    );
    assert.equal(row.liveness.evaluated, true, `${label}: a real heartbeat ⇒ evaluated`);
    assert.equal(row.liveness.alive, true, `${label}: fresh heartbeat ⇒ alive: ${JSON.stringify(row.liveness)}`);
    assert.match(row.liveness.detail, /^last round heartbeat \d+s ago$/, `${label}: ${row.liveness.detail}`);
  }

  // Per-kind distinctness — the six rows cannot be six copies of one reading. `source` and
  // `declaration` are the two fields that must differ; if they did not, the loop above would be
  // comparing like with like and a swap would be invisible.
  assert.equal(new Set(st.drivers.map((d) => d.liveness.source)).size, 6, "six distinct carriers");
  assert.deepEqual(
    Object.fromEntries(st.drivers.map((d) => [d.kind, d.declaration])),
    EXPECTED_DECLARATION,
    "each row carries ITS OWN declaration (declared / not-declared / stopped-explicitly spread across the rows)",
  );
});

test("AC3b — one kind producing no heartbeat reads not-evaluated and does NOT touch the other five", (t) => {
  const { root, anchorPid } = makeDriverWorkspace(t, "oneblind", ["goal"]);
  const st = serverStatusJson(root);

  const goal = st.drivers.find((d) => d.kind === "goal");
  assert.equal(goal.liveness.evaluated, false, `no carrier ⇒ not-evaluated, NOT a dead loop: ${JSON.stringify(goal)}`);
  assert.equal(goal.liveness.alive, null, `not-evaluated must not carry an alive verdict: ${JSON.stringify(goal)}`);
  assert.match(goal.liveness.detail, /no round heartbeat carrier record yet/, `原因而非沉默: ${JSON.stringify(goal)}`);
  // The host process IS alive and it IS carrying `goal` — this is 「读不到载体」, which must stay
  // distinguishable from 「这个 kind 停摆了」 (hard rule 3b).
  assert.equal(goal.pid, anchorPid);
  assert.equal(goal.declaration, "stopped-explicitly", `declaration is independent of the carrier read: ${JSON.stringify(goal)}`);

  for (const kind of SERVER_KINDS.filter((k) => k !== "goal")) {
    const row = st.drivers.find((d) => d.kind === kind);
    const direct = directKindStatus(root, kind);
    assert.equal(row.liveness.evaluated, true, `${kind}: unaffected by goal's missing carrier: ${JSON.stringify(row)}`);
    assert.equal(row.liveness.alive, true, `${kind}: still alive: ${JSON.stringify(row)}`);
    assert.equal(row.liveness.source, `carrier:${direct.last_record_carrier} last ts`, `${kind}: own carrier`);
    assert.equal(row.declaration, direct.declaration, `${kind}: own declaration`);
  }
});

// ── AC4: the concurrency itself, and a kind whose SUBPROCESS fails ───────────────────────────────
//
// AC3a/AC3b prove the readings are correct; neither could tell a concurrent implementation from a
// serial one (the serial one produced the same six rows). This test measures the concurrency
// directly, and it is the one that FAILS on the pre-change `spawnSync` chain.
//
// The seam is a fixture kernel rather than the real one, for one reason: only then are the six
// invocations observable from outside. Each stub records its own [t0,t1] window and — the point —
// BLOCKS for a known duration, so the six windows are either disjoint (serial: Σ ≈ 6×D) or share a
// common instant (concurrent: ≈ D). The stub answers with per-kind-distinct values so the six rows
// are still distinguishable from one another, and one kind's stub EXITS NON-ZERO with no JSON — the
// 「子进程失败」 case, which under `Promise.all` is exactly the shape that could reject the whole
// batch and blank all six rows.
const STUB_SLEEP_MS = 2000;

const STUB_KERNEL_SRC = `
import fs from "node:fs";
const argv = process.argv.slice(2);
const kind = argv[argv.indexOf("--kind") + 1];
const t0 = Date.now();
// A real BLOCKING wait (no CPU burn, no async): the window is what the concurrency assertion reads.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.QUAY_STUB_SLEEP_MS));
const t1 = Date.now();
const fail = process.env.QUAY_STUB_FAIL_KIND === kind;
fs.appendFileSync(process.env.QUAY_STUB_PROBE, JSON.stringify({ kind, t0, t1, ok: !fail }) + "\\n");
if (fail) process.exit(3); // dies with no JSON frame — the "subprocess failed" arm
process.stdout.write(JSON.stringify({
  driver_pid: 5150,
  driver_alive: 1,
  carrier_path: "/stub/" + kind + "-first",
  last_record_carrier: "/stub/" + kind + "-round.jsonl",
  last_record_ts: new Date(t1 - 4000).toISOString().slice(0, 19) + "Z",
  declaration: "stub-" + kind,
}) + "\\n");
`;

function makeStubKernelRoot(t) {
  const stubRoot = fs.mkdtempSync(path.join(os.tmpdir(), "srvstatus-kernel-"));
  t.after(() => fs.rmSync(stubRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(stubRoot, "scripts", "dist"), { recursive: true });
  // `type: module` so the bundled-form `.js` is ESM regardless of what lies above os.tmpdir().
  fs.writeFileSync(path.join(stubRoot, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  fs.writeFileSync(path.join(stubRoot, "scripts", "dist", "driver-runtime.js"), STUB_KERNEL_SRC, "utf8");
  return stubRoot;
}

test("AC4 — the six kernel invocations overlap in time (fails on the serial implementation)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "srvstatus-stub-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\n", "utf8");
  const stubRoot = makeStubKernelRoot(t);
  const probe = path.join(stubRoot, "invocations.jsonl");

  const t0 = Date.now();
  const st = serverStatusJson(root, {
    QUAY_PLUGIN_ROOT: stubRoot,
    QUAY_STUB_PROBE: probe,
    QUAY_STUB_SLEEP_MS: String(STUB_SLEEP_MS),
    QUAY_STUB_FAIL_KIND: "meta",
  });
  const wallMs = Date.now() - t0;

  const windows = fs.readFileSync(probe, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(windows.length, 6, `all six kinds must reach the kernel: ${JSON.stringify(windows)}`);
  assert.deepEqual(windows.map((w) => w.kind).sort(), [...SERVER_KINDS].sort());

  // ⟵ THE FALSIFIER. Six disjoint windows ⟺ a common instant exists ⟺ every invocation was in
  // flight at the same moment. Under the old `DRIVER_SERVICE_KINDS.map(spawnSync)` chain these
  // windows cannot overlap by construction: each one begins only after the previous has exited.
  const latestStart = Math.max(...windows.map((w) => w.t0));
  const earliestEnd = Math.min(...windows.map((w) => w.t1));
  assert.ok(
    earliestEnd > latestStart,
    `all six windows must share a common instant (⟺ they ran concurrently); ` +
      `latest start ${latestStart} vs earliest end ${earliestEnd} — windows=${JSON.stringify(windows)}`,
  );
  // Second, independent signal (generous bound: serial is ≥ 6×${STUB_SLEEP_MS}ms by construction).
  assert.ok(wallMs < STUB_SLEEP_MS * 3, `six ${STUB_SLEEP_MS}ms reads must not cost 6× that: ${wallMs}ms`);

  for (const kind of SERVER_KINDS) {
    const row = st.drivers.find((d) => d.kind === kind);
    assert.ok(row, `row for driver:${kind}: ${JSON.stringify(st.drivers)}`);
    if (kind === "meta") {
      // The subprocess exited 3 with no JSON frame ⇒ an unusable reading, NOT a death and NOT a
      // blank row — and, crucially, NOT a rejected `Promise.all` that would have taken the rest out.
      // ⛔ Nothing is invented for it: the row carries no pid, no declaration and no alive verdict.
      assert.equal(row.liveness.evaluated, false, `meta: a failed subprocess is a reading: ${JSON.stringify(row)}`);
      assert.equal(row.liveness.alive, null, `meta: no alive verdict may be invented: ${JSON.stringify(row)}`);
      assert.match(row.liveness.detail, /no JSON frame \(exit 3\)/, `meta: the cause is named: ${JSON.stringify(row)}`);
      assert.equal(row.pid, null, `meta: no pid may be invented either: ${JSON.stringify(row)}`);
      assert.equal(row.declaration, null, `meta: no declaration may be invented either: ${JSON.stringify(row)}`);
    } else {
      assert.equal(row.liveness.evaluated, true, `${kind}: survived meta's failure: ${JSON.stringify(row)}`);
      assert.equal(row.liveness.alive, true, `${kind}: still alive: ${JSON.stringify(row)}`);
      assert.equal(row.pid, 5150, `${kind}: pid from its OWN invocation`);
      assert.equal(row.declaration, `stub-${kind}`, `${kind}: declaration from its OWN invocation`);
      assert.equal(row.liveness.source, `carrier:/stub/${kind}-round.jsonl last ts`, `${kind}: own carrier`);
    }
  }
});
