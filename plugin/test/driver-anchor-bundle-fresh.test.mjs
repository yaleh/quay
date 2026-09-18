// @test-group engine

// driver-anchor-bundle-fresh.test.mjs — the 'NO remediation happened' half of the stale-bundle contract,

// split out of driver-anchor-bundle.test.mjs by FUNCTIONAL BOUNDARY

// (gap-ac281-develop-ci-test-job-wallclock-under-30s).

//

// WHY SPLIT: `node --test` parallelises only ACROSS files — inside one file every test() is serial, so a

// file is the smallest schedulable unit and therefore the suite's floor. The parent file measured 20.9 s on

// the real CI run (35290919973 `__PERFILE__`). Raising concurrency cannot help (LPT simulation: makespan ==

// longest file at 64/128/256/512 alike).

//

// ⛔ SPLIT BY BOUNDARY, NOT BY HALVING A TEST: every test here is a path on which the kernel must NOT

// rebuild — the remediation seam is off, the source tree is NOT stale (the counter-example control), or

// there is no source tree at all (fail-closed). The kept file holds the source-tree state judgments plus

// the two outcomes where a rebuild IS attempted (rebuilt / rebuild-failed). The two share NO mutable state

// (each builds its own tmp fixture), so parallel and serial runs give byte-identical verdicts.

//

// Run:

//   node --test plugin/test/driver-anchor-bundle-fresh.test.mjs

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
