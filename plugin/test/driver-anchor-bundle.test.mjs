// driver-anchor-bundle.test.mjs — 从 driver-anchor.test.mjs 按**功能边界**拆出的「内核 bundle / 源树陈旧」
// 半边（gap-ac281-develop-ci-test-job-wallclock-under-30s）。
//
// 为什么拆：GOAL-022 的范围第一条是「main/serial/lowconc 三阶段的**单文件地板**全部压到 30 秒以下」，
// 而 CI 实测 `driver-anchor.test.mjs` 单文件 43.1s（run 35229994657 的 `__PERFILE__` 行）——
// `node --test` **只在文件之间并行**，文件内部串行 ⇒ 拆文件是唯一能压低该地板的杠杆（抬并发无效，
// 实测 LPT 模拟 concur=128/256/384/512 的 makespan 都是 43.1s）。
//
// ⛔ 拆的是**文件**，不是一个 test() 的两半：本文件的 8 个 test() 与原文件留下的 7 个之间**零共享
//    可变状态**（各自造自己的 tmp 夹具、各自 spawn 自己的 anchor 进程），所以两文件并行跑与串行跑的
//    判定结果逐字相同。判据正本仍在原处（AC-255 的 criterion 从 goals/ 读出跑，⛔ 不在此手抄一份）。
//
// 主题（`bundle.state` 的**独立取值**，硬规则 3b：每格与「合格」同形即等于没测）：
//   fresh / stale-rebuilt / stale-no-action / stale-rebuild-failed，以及 mirror / unwatched 的源树态。
//
// ⚠️ 已知边界（如实标注，⛔ 不伪装成全测）：anchor 经 preferredAnchorKernel() **优先主检出**加载内核
//   ⇒ 在 worktree 里跑本文件时，验的是主检出那份内核。这是形态的性质（driver-runtime.ts 已明记
//   「结构上无法自测」），⛔ 不是夹具能绕开的，也不是本次拆分引入的。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  kernelSourceScriptsDir,
  preferredAnchorKernelIn,
  readAnchorBundleReading,
  rebuildKernelBundle,
  resolveQuayKernelBuildScript,
  sourceFilesMaxMtimeMs,
  sourceWatch,
  supervisorStaleness,
  watchedSourceFiles,
} from "../scripts/driver-runtime.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ANCHOR_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "driver-anchor.ts");

// ── 夹具 ───────────────────────────────────────────────────────────────────────────────────────────

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 *  `QUAY_PLUGIN_ROOT=<root>/packages/quay/plugin` ⇒ `resolveKernelScriptsDir()` 指向暂存树的 scripts。 */
function makeStagingFixture(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kernelsrc-${tag}-`));
  fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\n", "utf8");
  const srcScripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(path.join(srcScripts, "dist"), { recursive: true });
  for (const rel of watchedSourceFiles("promotion")) fs.writeFileSync(path.join(srcScripts, rel), "// src\n", "utf8");
  fs.writeFileSync(path.join(srcScripts, "dist", "driver-anchor.js"), "// built\n", "utf8");
  // 源树 mtime 显式落**过去**（臂 (a) 的基线）：否则刚创建的夹具文件的 mtime 本就晚于本测试进程的
  // 启动时刻 ⇒ 臂 (a) 会（正确地）报 stale，把「源树未推进」那一臂变成空转。
  const past = new Date(Date.now() - 600_000);
  for (const rel of watchedSourceFiles("promotion")) fs.utimesSync(path.join(srcScripts, rel), past, past);
  const stagingScripts = path.join(root, "packages", "quay", "plugin", "scripts");
  fs.mkdirSync(path.join(stagingScripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(stagingScripts, "dist", "driver-anchor.js"), "// staging\n", "utf8");
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, `fixture is a git repo (mainCheckoutRoot needs it): ${init.stderr}`);
  return root;
}

/** 在一个临时 QUAY_PLUGIN_ROOT 下跑 fn（`resolveKernelScriptsDir()` 由它决定）。 */
function withPluginRoot(pluginRoot, fn) {
  const saved = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = pluginRoot;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = saved;
  }
}

/** 造一个「本内核是**构建产物**、而它的源树在盘上且更旧/更新」的夹具：
 *    <root>/plugin/scripts/*.ts                     ← **源树**（被监视集齐全；镜像态比较的对象）
 *    <root>/staging/plugin/scripts/                 ← 本内核（QUAY_PLUGIN_ROOT；⛔ 目录里一个 .ts 都没有）
 *    <root>/staging/packages/quay/src/              ← resolveQuayCodeRoot 的判据（本内核的代码根）
 *    <root>/staging/packages/quay/scripts/build-plugin-dist.mjs  ← 假构建脚本（写 marker / 可失败）
 *  这是生产形态的逐字镜像：本内核跑 `<repo>/plugin/scripts/dist/*.js`，源树在 `<repo>/plugin/scripts/`。 */
function makeBundleStaleFixture(tag, { sourceNewerThanKernel = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bundlestale-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\n", "utf8");

  // 源树（镜像态比较的对象）：被监视集齐全。
  const srcScripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(path.join(srcScripts, "dist"), { recursive: true });
  for (const rel of watchedSourceFiles("outer")) fs.writeFileSync(path.join(srcScripts, rel), "// src\n", "utf8");
  // ⚠️ 两臂都必须相对**本内核文件自己的 mtime**（= `kernelBuiltAt` 的直接量，`driver-anchor.ts` 的
  //    `fs.statSync(fileURLToPath(import.meta.url))`）来定，⛔ **不能**相对 `Date.now()`：本夹具的
  //    「本内核」就是 worktree 里那份 `driver-anchor.ts`，它的 mtime 是**检出/最后一次编辑时刻**，
  //    而在套件并行负载下 `Date.now()` 早已推进很多 ⇒ 用「now − 10min」当「更旧」会算出**比内核还新**
  //    的 mtime ⇒ 臂 (b) 静默变成 stale、反例对照空转（实测：单跑绿、scoped 门里 30s 超时）。
  const kernelMtimeMs = fs.statSync(ANCHOR_SCRIPT).mtimeMs;
  const when = new Date(sourceNewerThanKernel ? kernelMtimeMs + 120_000 : kernelMtimeMs - 600_000);
  for (const rel of watchedSourceFiles("outer")) fs.utimesSync(path.join(srcScripts, rel), when, when);

  // 本内核：plugin root 的 basename 与源树同名（`plugin`），才让 kernelSourceScriptsDir 找到源树。
  const kernelScripts = path.join(root, "staging", "plugin", "scripts");
  fs.mkdirSync(path.join(kernelScripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(kernelScripts, "dist", "driver-anchor.js"), "// built\n", "utf8");

  // 本内核的代码根（resolveQuayCodeRoot 的判据）+ 假构建脚本（**真实路径**，⛔ 不注入测试缝路径）。
  const codeRoot = path.join(root, "staging");
  fs.mkdirSync(path.join(codeRoot, "packages", "quay", "src"), { recursive: true });
  const buildScript = path.join(codeRoot, "packages", "quay", "scripts", "build-plugin-dist.mjs");
  fs.mkdirSync(path.dirname(buildScript), { recursive: true });
  fs.writeFileSync(
    buildScript,
    `import fs from "node:fs";\n` +
    `const marker = process.env.QUAY_FAKE_BUILD_MARKER;\n` +
    `if (marker) fs.appendFileSync(marker, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n", "utf8");\n` +
    `process.exit(Number(process.env.QUAY_FAKE_BUILD_EXIT ?? "0"));\n`,
    "utf8",
  );
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, `fixture is a git repo (mainCheckoutRoot needs it): ${init.stderr}`);
  return { root, pluginRoot: path.join(root, "staging", "plugin"), marker: path.join(root, ".quay", "rebuild-marker.txt"), buildScript };
}

/** 直接起一个常驻 anchor（⛔ 不经 `start` CLI 的就绪闸——本组测的是 reconcile 里的判定与动作），
 *  轮询到 `predicate` 成立后停机。
 *
 *  ⚠️ 必须**在它活着的时候**读 `.quay/anchor.json`：正常退出时 anchor 会主动删掉 pid / state 载体
 *  （「已经在跑」与「已经停了」不得同形，硬规则 3b）—— 所以本夹具不能等它退出再读。 */
async function runAnchorUntil(root, pluginRoot, predicate, extraEnv = {}) {
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", ANCHOR_SCRIPT, "__anchor", "--root", root,
      "--kinds", "outer", "--reconcile-ms", "150"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QUAY_PLUGIN_ROOT: pluginRoot,
        QUAY_ANCHOR_SHUTDOWN_GRACE_MS: "3000",
        // 测试缝：只验「重建发生了」，⛔ 不让它 spawn 一个替换 anchor（那会把夹具的假 driver 当真拉起）。
        QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART: "1",
        ...extraEnv,
      },
    },
  );
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += String(d); });
  // ⚠️ 读数必须在**它活着的时候**抓下来：正常退出会删掉 `.quay/anchor.json`（见上）。
  let captured = null;
  try {
    await waitFor(() => { const v = predicate(); if (v) { captured = v; return true; } return false; }, 30_000, "the anchor to publish the expected bundle reading");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } r(); }, 20_000);
      child.on("exit", () => { clearTimeout(t); r(); });
    });
  }
  return { stderr, reading: captured };
}

/** 轮询谓词：`bundle.state` 等于期望值时把**那一份读数**交出来（⛔ 不是事后重读一个已被删的文件）。 */
function bundleStateIs(root, state) {
  return () => {
    const r = readAnchorBundleReading(root);
    return r?.state === state ? r : null;
  };
}

const anchorLogOf = (root) => {
  const p = path.join(root, ".quay", "anchor.log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

// ── 内核源树：态与陈旧判定（两臂对照 + fail-closed） ─────────────────────────────────────────────

test("内核源树两臂对照 — mirror 态比的是【源树】：未推进 ⇒ fresh / 已推进 ⇒ stale（⛔ 只给一臂不算过）", (t) => {
  const root = makeStagingFixture("arms");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kernelDir = path.join(root, "packages", "quay", "plugin", "scripts");
  const srcScripts = path.join(root, "plugin", "scripts");

  withPluginRoot(path.dirname(kernelDir), () => {
    // ⛔ 取假的正控制：旧读法（只看本内核目录）在这个输入上**恒 0** —— 这正是「未变更」与「无源码」
    // 同形的输入（硬规则 3b）。若有人把 sourceFilesMaxMtimeMs 回退成只看本内核目录，下面的臂 (a)
    // 会变成 0、臂 (b) 会变成 fresh ⇒ 本测红。
    let kernelDirOnlyMax = 0;
    for (const rel of watchedSourceFiles("promotion")) {
      try { kernelDirOnlyMax = Math.max(kernelDirOnlyMax, fs.statSync(path.join(kernelDir, rel)).mtimeMs); } catch { /* absent */ }
    }
    assert.equal(kernelDirOnlyMax, 0, "本内核目录里没有被监视 .ts（构建产物形态）—— 旧读法在这个输入上恒 0");

    assert.equal(kernelSourceScriptsDir(), srcScripts, "源树解析到 <repo>/plugin/scripts（本内核 plugin 树的同名树）");

    // ── 臂 (a)：源树 mtime 早于本进程启动 ⇒ mirror + 真读数 + fresh（⛔ 不报陈旧、不自刷新）──
    const a = sourceWatch(root, "promotion");
    assert.equal(a.state, "mirror", "内核是构建产物而源树在 ⇒ mirror（⛔ 不是 unwatched：那会与「无源可推进」同形）");
    assert.equal(a.dir, srcScripts, "mirror 态把 dir 指向**源树**，⛔ 不是本内核目录");
    assert.ok(a.mtimeMs > 0, "mirror 态给的是真读数（⛔ 不是那个恒 0）");
    assert.equal(sourceFilesMaxMtimeMs(root, "promotion"), a.mtimeMs, "sourceFilesMaxMtimeMs 走同一解析");
    const before = supervisorStaleness(root, "promotion", process.pid);
    assert.equal(before.state, "fresh", `臂 (a) 源树未推进到启动时刻之后 ⇒ fresh: ${JSON.stringify(before)}`);
    assert.equal(before.sourceWatch, "mirror", "陈旧判定同时报出它的输入从哪来（可核，⛔ 不是只给一个布尔）");

    // ── 臂 (b)：只改一处 —— 把源树推到本进程启动时刻之后 ⇒ 预测相反：stale ────────────────────
    const future = new Date(Date.now() + 120_000);
    for (const rel of watchedSourceFiles("promotion")) fs.utimesSync(path.join(srcScripts, rel), future, future);
    const after = supervisorStaleness(root, "promotion", process.pid);
    assert.equal(after.state, "stale", `臂 (b) 源树已推进 ⇒ stale（两臂预测相反 ⇒ 判据能取假）: ${JSON.stringify(after)}`);
    assert.ok(after.sourceMtimeMs > before.sourceMtimeMs, "读数确实变了（⛔ 不是同一个常量被读两次）");
    assert.equal(sourceWatch(root, "promotion").state, "mirror", "态没变，变的是它指向的目录的 mtime");
  });
});

test("内核源树 fail-closed — 盘上没有源树（装好的产物）⇒ unwatched（独立取值，⛔ 与「未变更」同形）", (t) => {
  // 一个**没有**同名 plugin 树的 git 仓库：装好的产物（npm 包 / marketplace cache / 第三方 vendored）
  // 就是这一形。⛔ 不能把「没有源树」读成「源码没推进」—— 两者必须有独立取值（硬规则 3b）。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kernelsrc-none-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "packages", "quay", "plugin", "scripts");
  fs.mkdirSync(path.join(scripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "dist", "driver-anchor.js"), "// installed\n", "utf8");
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, init.stderr);

  withPluginRoot(path.dirname(scripts), () => {
    assert.equal(kernelSourceScriptsDir(), null, "没有同名源树 ⇒ null（fail-closed，⛔ 不把 cwd 当仓库根）");
    const w = sourceWatch(root, "promotion");
    assert.equal(w.state, "unwatched", "无可监视源码是**独立取值**，⛔ 不是 0 冒充的「未变更」");
    assert.equal(w.mtimeMs, 0, "unwatched 的 mtime 是 0，但取值含义由 state 区分");
    const s = supervisorStaleness(root, "promotion", process.pid);
    assert.equal(s.sourceWatch, "unwatched", "陈旧读数把「无源可推进」与「源码未推进」分开报出（硬规则 3b）");
  });
});

test("preferredAnchorKernelIn — 构建产物内核只换到**更新的**源树 bundle（⛔ 不换 raw、⛔ 不换更旧的）", (t) => {
  const root = makeStagingFixture("pref");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stagingScripts = path.join(root, "packages", "quay", "plugin", "scripts");
  const srcScripts = path.join(root, "plugin", "scripts");
  const selfJs = path.join(stagingScripts, "dist", "driver-anchor.js");
  const srcJs = path.join(srcScripts, "dist", "driver-anchor.js");
  // 「本内核目录」= `path.dirname(kernelSelfPath())` = 那份 driver-anchor.js 所在目录（生产形态里是
  // `.../scripts/dist` —— 这正是 preferredAnchorKernel 包装传给判定半边的那个值）。
  const me = path.join(stagingScripts, "dist");
  const old = new Date(Date.now() - 600_000);
  const now = new Date(Date.now() - 1_000);

  // (i) 源树 bundle **更新** ⇒ 换过去（同形态：bundle → bundle，⛔ 不换成 raw driver-anchor.ts）。
  fs.utimesSync(selfJs, old, old);
  fs.utimesSync(srcJs, now, now);
  const toNewer = preferredAnchorKernelIn(me, me, srcScripts);
  assert.equal(toNewer?.path, srcJs, `换到源树那份更新的 bundle: ${JSON.stringify(toNewer)}`);
  assert.equal(toNewer?.stripTypes, false, "同形态（bundle → bundle）：⛔ 不把 bundle 内核悄悄降成 raw");

  // (ii) 源树 bundle **更旧** ⇒ 不换（否则每次 reconcile 都换到同一版 = 重启风暴）。
  fs.utimesSync(selfJs, now, now);
  fs.utimesSync(srcJs, old, old);
  const toOlder = preferredAnchorKernelIn(me, me, srcScripts);
  assert.equal(toOlder?.path, selfJs, `更旧的源树 bundle 不被选（⛔ 防重启风暴）: ${JSON.stringify(toOlder)}`);

  // (iii) 没有源树（装好的产物）⇒ 本内核自己（行为与今天逐字相同）。
  const bare = preferredAnchorKernelIn(me, me, null);
  assert.equal(bare?.path, selfJs, "无源树 ⇒ 仍是本内核自己");
});

// ── 陈旧 bundle 的**动作面**（gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation）────────
//
// 缺陷形态（2026-09-17 实测，AC-214 第六次转红的成因）：`bundleStale` 支会**检测**「本内核 bundle 比
// 它的源树旧」并把 `rebuild the bundle to clear this` 写进 anchor 日志（生产 `.quay/anchor.log` 有 ≥3 条
// `fileRoutineTask`）在**源**里、不在**跑的那个产物**里 ⇒ 生产载体
// `.quay/routine-findings.jsonl` 的 `kind:"filing-round"` 记录数 = 0。
//
// 判据（双向 + 独立取值，⛔ 只给一臂不算过）：
//   ① 陈旧 ⇒ **机械重建被调用**（不是只打一行日志），且结果落成 `.quay/anchor.json` 的 `bundle.state`
//      独立取值 `stale-rebuilt` / `stale-rebuild-failed`；
//   ② 补救 seam 关掉（kill switch）⇒ 陈旧**仍被报出**（STALE BUNDLE 行在场、取值 `stale-no-action`），
//      ⛔ 不静默降级成 `fresh`；
//   ③ **不陈旧**（bundle 不早于源树）⇒ **不**触发补救（无 marker、state = `fresh`）—— 用于区分
//      「补救在工作」与「恒有输出」；
//   ④ 没有源树（装好的产物）⇒ `resolveQuayKernelBuildScript()` = null + `attempted=false`
//      （fail-closed，⛔ 不把静态产物写成半成品）。

test("陈旧 bundle ① — 陈旧且换不动 ⇒ **机械重建被调用**，结果落成 bundle.state 的独立取值", async (t) => {
  const f = makeBundleStaleFixture("stale-rebuilt");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  // 正控制：这个夹具确实处在「本内核是产物 + 源树更新」的输入上（否则本测会空转）。
  withPluginRoot(f.pluginRoot, () => {
    assert.equal(sourceWatch(f.root, "outer").state, "mirror", "夹具处在 mirror 态（旧读法在这里恒 0）");
    assert.equal(resolveQuayKernelBuildScript(), f.buildScript, "构建脚本解析到**真实推导出的**那个路径（⛔ 不是测试注入的路径）");
  });

  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "stale-rebuilt"),
    { QUAY_FAKE_BUILD_MARKER: f.marker });
  assert.ok(fs.existsSync(f.marker), `the mechanical rebuild WAS invoked (stderr: ${r.stderr}, log: ${anchorLogOf(f.root)})`);
  const calls = fs.readFileSync(f.marker, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(calls.length, 1, `rebuilt exactly ONCE (冷却生效，⛔ 不是每趟 reconcile 一次): ${JSON.stringify(calls)}`);
  assert.match(calls[0].cwd, /bundlestale-stale-rebuilt-/, "cwd = 源树的仓库根（⛔ 不是 --root 工作区）");

  const log = anchorLogOf(f.root);
  assert.match(log, /bundle rebuild OK in \d+ms/, "重建结果如实落进 anchor 日志");
  assert.match(log, /STALE BUNDLE — source tree is newer than this kernel's build/, "陈旧**仍被报出**（⛔ 检测没有因为有了动作面而消失）");

  const reading = r.reading;
  assert.ok(reading, ".quay/anchor.json 里有结构化的 bundle 读数（⛔ 不再只有一行日志）");
  assert.equal(reading.state, "stale-rebuilt", `陈旧 + 重建成功 = 独立取值 stale-rebuilt: ${JSON.stringify(reading)}`);
  assert.equal(reading.rebuild?.attempted, true, "读数里带着「动作被调用过」");
  assert.equal(reading.rebuild?.ok, true, "读数里带着动作的结果");
  assert.ok(reading.kinds.includes("outer"), "读数点名了参与判定的 kind（⛔ 不是一个笼统的「有陈旧」）");
});

test("陈旧 bundle ② — 补救 seam 关掉 ⇒ 陈旧**仍被报出**（⛔ 不静默降级成 fresh）", async (t) => {
  const f = makeBundleStaleFixture("no-action");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "stale-no-action"),
    { QUAY_ANCHOR_NO_BUNDLE_REBUILD: "1", QUAY_FAKE_BUILD_MARKER: f.marker });
  assert.ok(!fs.existsSync(f.marker), `kill switch ⇒ 构建脚本没有被调用 (stderr: ${r.stderr})`);

  const log = anchorLogOf(f.root);
  assert.match(log, /STALE BUNDLE — source tree is newer than this kernel's build/, "陈旧条件**仍被报出**");
  assert.match(log, /bundle rebuild SKIPPED \(disabled by QUAY_ANCHOR_NO_BUNDLE_REBUILD=1\)/, "跳过原因如实留痕（⛔ 不静默）");

  const reading = r.reading;
  assert.equal(reading?.state, "stale-no-action", `无动作可用是**独立取值**，⛔ 不与 fresh 同形: ${JSON.stringify(reading)}`);
  assert.notEqual(reading?.state, "fresh", "⛔ 补救被关掉**不**等于「不陈旧」");
});

test("陈旧 bundle ③ — 构建失败 ⇒ 独立取值 stale-rebuild-failed（⛔ 不与「无动作」/「新鲜」同形）", async (t) => {
  const f = makeBundleStaleFixture("rebuild-failed");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "stale-rebuild-failed"),
    { QUAY_FAKE_BUILD_MARKER: f.marker, QUAY_FAKE_BUILD_EXIT: "7" });
  assert.ok(fs.existsSync(f.marker), `the rebuild WAS attempted (stderr: ${r.stderr})`);
  const log = anchorLogOf(f.root);
  assert.match(log, /bundle rebuild FAILED in \d+ms .*reason=build script exited 7/, "失败原因（退出码）如实落进日志");
  assert.match(log, /STALE BUNDLE — source tree is newer than this kernel's build/, "失败时陈旧仍被报出");
  const reading = r.reading;
  assert.equal(reading?.state, "stale-rebuild-failed", `试过但失败是**独立取值**: ${JSON.stringify(reading)}`);
});

test("陈旧 bundle ④ — 反例对照：**不陈旧**（源树早于本内核）⇒ 不触发补救，state = fresh", async (t) => {
  const f = makeBundleStaleFixture("fresh", { sourceNewerThanKernel: false });
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "fresh"),
    { QUAY_FAKE_BUILD_MARKER: f.marker });
  assert.ok(!fs.existsSync(f.marker), `源树更旧 ⇒ 构建脚本**没有**被调用 (stderr: ${r.stderr})`);
  const log = anchorLogOf(f.root);
  assert.doesNotMatch(log, /bundle rebuild/, "⛔ 没有任何重建行（用于区分「补救在工作」与「恒有输出」）");
  assert.doesNotMatch(log, /STALE BUNDLE/, "⛔ 不陈旧就不该报陈旧");
  const reading = r.reading;
  assert.equal(reading?.state, "fresh", `不陈旧 ⇒ fresh: ${JSON.stringify(reading)}`);
});

test("陈旧 bundle ⑤ — 没有源树（装好的产物）⇒ fail-closed：解析不到构建脚本且不冒认「可重建」", (t) => {
  // 装好的产物形态（npm-pack / marketplace cache / 第三方 vendored）：盘上**没有**同名源树。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundlestale-nosrc-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "pkg", "plugin", "scripts");
  fs.mkdirSync(path.join(scripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "dist", "driver-anchor.js"), "// installed\n", "utf8");
  fs.mkdirSync(path.join(root, "pkg", "packages", "quay", "src"), { recursive: true });
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, init.stderr);

  withPluginRoot(path.join(root, "pkg", "plugin"), () => {
    assert.equal(kernelSourceScriptsDir(), null, "没有源树 ⇒ null（fail-closed）");
    assert.equal(resolveQuayKernelBuildScript(), null, "没有源树 ⇒ 不给构建脚本（⛔ 不把静态产物当真源树重建）");
    const r = rebuildKernelBundle();
    assert.equal(r.attempted, false, `attempted=false（⛔ 不是 attempted-but-failed）: ${JSON.stringify(r)}`);
    assert.match(r.reason ?? "", /no plugin-dist build script|no source tree/, "失败原因可诊断");
  });
});
