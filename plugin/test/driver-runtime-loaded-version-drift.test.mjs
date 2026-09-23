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
