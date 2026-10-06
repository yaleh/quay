// loaded-version.ts — 「跑着的那个宿主**实际加载**的是哪一版 vs **已安装**的是哪一版」的**唯一**一份
// 实现，由 driver 的常驻内核（`plugin/scripts/driver-runtime.ts`）与 serve 宿主
// （`packages/quay/src/cli/server.ts`）共用。
// (task gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only)
//
// ── 为什么在 Core 而不是内核里（两条否决理由，都不是风格问题）────────────────────────────────────
//   ① 内核走 `resolvePluginScriptExec` 解析，而 `plugin-root.ts` 的约束 ① 规定**从 linked worktree
//      加载的模块要重定位到主检出**（那是为了不让常驻内核吊在一个短命 worktree 上）。⇒ 在任务
//      worktree 里跑 `quay server status`，若读数来自内核，读到的会是**主检出**的行为而不是被测代码
//      的行为 —— 判据会在 worktree 上对、在别处错（或反之），且没有任何读数显示这一点。
//   ② Core 不得**静态** import `plugin/**`（`plugin/scripts/import-graph-check.ts` 的 reverseEdges
//      棘轮），而运行时 `import()` 内核会把整个内核闭包拖进一条 status 命令。
//   ⇒ 纯读数落在 Core；内核**静态 import 本模块**（`plugin/` → `packages/` 是受认可的方向）并把
//     它历来导出的名字原样再导出（⛔ 不是复制一份，硬规则 5b）。
//
// ── 两个分量（硬规则 4b：用**外部可核**的直接量，⛔ 不用被测对象自报的心跳/派生计数）──────────────
//   · loaded    — 运行中宿主进程**实际加载的脚本**：`/proc/<pid>/cmdline` 的 exec 实参。读本身只有
//                 一份实现（下面的 `loadedScriptFromCmdline`，它又复用 kernel leaf `readProcCmdline`）；
//                 「cmdline 里哪一段算脚本」按宿主种类分（内核脚本 vs serve bundle）——这是两种宿主
//                 **唯一**的差异。
//   · installed — `~/.claude/plugins/installed_plugins.json` 里 `quay@quay` 的**最高**版本；注册表读不出
//                 时退回**宿主自己**的 `VERSION` 文件（第二来源，由调用方给 resolver）。
//   两个都拿到才判；任一读不到 ⇒ `not-evaluated` + 非空 `reason`（硬规则 3b：读不到**不得**与 `current`
//   同形）。⛔ 只报，⛔ 不自动重启（重启时机由人或 manager 决定）。
//
// ⚠️ 与 `server-state.ts` 的 `supervisorStaleness` / `sourceWatch` **不是同一条判据的两种写法**：
//   后者比的是【源目录 mtime vs 宿主进程启动时刻】，对**装好的产物**恒报 fresh（盘上没有源可推进）——
//   这正是本缺陷静默的形态；本模块比的是【宿主**实际加载的**产物版本 vs 已安装版本】，装好的产物上
//   只有它能取假。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readProcCmdline } from "./kernel/proc-identity.ts";
import { pidAlive } from "./server-state.ts";
import { isQuayServe } from "./kernel/proc-identity.ts";
import { resolvePluginRoot } from "./plugin-root.ts";

/** 版本四态（`ahead` 是第四个取值：loaded ≠ installed 但**方向相反**——源树检出里宿主跑的是比
 *  注册表更新的一版（如本仓库 `plugin/VERSION` = `0.17.0-dev` vs 注册表 `0.16.0`）。
 *  ⛔ 不把它并进 `behind`：那会在 quay 自己的开发检出上**永久**报一个方向错误的读数（硬规则 3）。 */
export type LoadedVersionState = "current" | "behind" | "ahead" | "not-evaluated";

/** 两个版本串的方向（`not-evaluated` = 至少一个读不出/不可排序）。⛔ 与 `state` 分开：state 回答
 *  「要不要动作」（behind/ahead 都要人看一眼），relation 回答「往哪个方向偏」。 */
export type VersionRelation = "equal" | "loaded-older" | "loaded-newer" | "not-evaluated";

/** `loadedKernel` 的来源。`proc-cmdline` = 外部可核直接量；`anchor-state` = anchor 自报的回读面
 *  （second-best，只有 cmdline 读不出内核实参时才采信，且只认同一个 pid 的回读面）。 */
export type LoadedScriptSource = "proc-cmdline" | "anchor-state";

/** 「已加载版本 vs 已安装版本」的完整读数。⛔ 读不到的每一格都有独立取值（`null` /
 *  `not-evaluated` / `reason`），⛔ 不与「同版本」同形。 */
export interface LoadedVersionReading {
  state: LoadedVersionState;
  /** 运行中宿主进程所加载产物的版本（读不出 ⇒ null）。 */
  loaded: string | null;
  /** 当前已安装版本（读不出 ⇒ null）。 */
  installed: string | null;
  /** 上述版本的安装时刻（ISO；注册表条目里读不出 ⇒ null）。 */
  installedAt: string | null;
  /** `installed` 的来源（⛔ 两个来源不同形：注册表 vs 宿主自己的 VERSION 文件）。 */
  installedSource: "registry" | "kernel-version-file" | null;
  /** 宿主进程实际加载的脚本绝对路径（读不出 ⇒ null）。 */
  loadedKernel: string | null;
  /** `loadedKernel` 的来源。 */
  loadedKernelSource: LoadedScriptSource | null;
  relation: VersionRelation;
  /** `.quay/config.yml` 里 provider `path` 的版本段 vs 已安装版本（第二个漂移源，独立取值）。 */
  configProviderPath: LoadedVersionState;
  /** 参与上面那个判定的版本段（无版本段可比 ⇒ null）。 */
  configProviderPathVersion: string | null;
  /** `not-evaluated` 的原因（⛔ 读不出时必须给，⛔ 不得为空——空读不出与「没问题」同形）。 */
  reason: string | null;
}

/** 解析 `x.y.z[-suffix]` 形的版本串为可排序的秩；形状不符 ⇒ null（⛔ 不猜）。 */
function versionRank(v: string): [number, number, number, string] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""];
}

/** 两个版本串的方向：`<0` a 更旧 / `0` 相等 / `>0` a 更新 / `null` 不可排序（形状不符）。
 *  同 `x.y.z` 时**无后缀 > 有后缀**（`1.0.0` > `1.0.0-dev`），两者都有后缀按字典序。 */
export function compareVersions(a: string, b: string): number | null {
  const ra = versionRank(a);
  const rb = versionRank(b);
  if (!ra || !rb) return null;
  for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
  const sa = ra[3] as string;
  const sb = rb[3] as string;
  if (sa === sb) return 0;
  if (sa === "") return 1;
  if (sb === "") return -1;
  return sa < sb ? -1 : 1;
}

/** 一个目录的 `VERSION` 文件（首行去空白；缺失/空/读失败 ⇒ null，⛔ 不猜版本）。 */
export function readVersionFile(dir: string): string | null {
  try {
    const first = fs.readFileSync(path.join(dir, "VERSION"), "utf8").split("\n")[0].trim();
    return first === "" ? null : first;
  } catch {
    return null;
  }
}

/** 一个**产物目录**声明的版本：`VERSION` 文件优先，其次 `.claude-plugin/plugin.json` / `plugin.json`
 *  的 `version` 字段（装好的插件产物两形态都有；`VERSION` 被裁掉时 plugin.json 仍在）。
 *  ⛔ 都读不出 ⇒ null —— ⛔ 绝不 exec 该产物自己的 `--version`：那个输出受 bundle 内嵌版本影响
 *  （gap-release-bundle-embeds-dev-version-after-stamp），是**被测对象自报**而不是盘上的版本记录。 */
export function readVersionOfDirectory(dir: string): string | null {
  const fromFile = readVersionFile(dir);
  if (fromFile) return fromFile;
  for (const rel of [path.join(".claude-plugin", "plugin.json"), "plugin.json"]) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"))?.version;
      if (typeof v === "string" && v.trim() !== "") return v.trim();
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** 一个被加载脚本路径的 **plugin root** —— 与 `driver-runtime.ts::resolveKernelPluginRoot()`（以及
 *  Core 的 `plugin-root.ts`）同一套上跳规则：内核既可能住在 `<root>/scripts/` 也可能住在
 *  `<root>/scripts/dist/`。少了 `dist` 那一级会得到 `<root>/scripts` 自己（实测：本仓库的 anchor
 *  因此报 not-evaluated）。 */
function pluginRootOfScript(scriptPath: string): string {
  const dir = path.dirname(scriptPath);
  return path.basename(dir) === "dist" ? path.dirname(path.dirname(dir)) : path.dirname(dir);
}

/** 路径里的版本段（`…/cache/<mkt>/<plugin>/<x.y.z>[-suffix]/…`）。 */
const VERSION_SEGMENT_RE = /(?:^|\/)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?:\/|$)/;

/** 一个**被加载脚本**路径所加载的那份产物的版本。三级（⛔ 都不 exec 该产物）：
 *  ① 它自己 plugin root 的版本记录（源检出 `<repo>/plugin/VERSION` 与 cache 目录
 *     `<…>/cache/quay/quay/<x.y.z>/VERSION` 两形态都有）——基准是**路径推导**，⛔ 与路径字面量无关；
 *  ② **版本目录**形态（serve 的 vendor bundle：`…/cache/<mkt>/<plugin>/<x.y.z>/vendor/<pkg>/dist/quay.js`
 *     —— ① 的上跳落在 `…/<x.y.z>/vendor`，那里没有版本记录）。用路径里的版本段**锚定**版本目录，
 *     再从它的 `VERSION`/`plugin.json` 读；
 *  ③ ①② 都读不出 ⇒ 退回路径里的版本段（装好的产物可能被裁掉 `VERSION`）。
 *  三级都读不出 ⇒ null（⛔ 不从路径里随便挑一个数字当版本）。 */
export function versionOfLoadedScript(scriptPath: string): string | null {
  const fromPluginRoot = readVersionOfDirectory(pluginRootOfScript(scriptPath));
  if (fromPluginRoot) return fromPluginRoot;
  const m = VERSION_SEGMENT_RE.exec(scriptPath);
  if (!m) return null;
  const prefix = scriptPath.slice(0, m.index);
  const versionDir = path.join(prefix === "" ? path.sep : prefix, m[1]);
  const fromVersionDir = readVersionOfDirectory(versionDir);
  if (fromVersionDir) return fromVersionDir;
  return m[1];
}

/** **唯一**一份「读 `/proc/<pid>/cmdline` 取宿主实际加载的脚本」的实现（anchor 与 serve 共用）。
 *  读本身复用 kernel leaf 的 `readProcCmdline`（⛔ 不再手搓一份 /proc 读 + NUL 解析，
 *  `identity-replication-check.ts` 的 AC2 判的正是这种复制）。
 *  `pick` = 「argv 里哪一段算脚本」——按宿主种类给（内核 vs serve bundle），这是两种宿主唯一的差异。
 *  ⛔ 读不到 / 认不出 ⇒ null（⛔ 不退回猜测；调用方必须把它报成 `not-evaluated`）。 */
export function loadedScriptFromCmdline(pid: number, pick: (argv: string[]) => string | null): string | null {
  const argv = readProcCmdline(pid);
  if (argv === null) return null;
  return pick(argv);
}

/** 内核脚本的 basename 形状（判定 `/proc/<pid>/cmdline` 里**哪一段**是内核）。
 *  ⛔ 必须按名字认：cmdline 里还有 `--root <path>` 之类的路径实参，误取会报一个假的「已加载」。 */
const KERNEL_SCRIPT_RE = /\/driver-(?:runtime|anchor)\.(?:ts|js)$/;

/** 从 argv 里认出息主内核脚本（见 `KERNEL_SCRIPT_RE`）。 */
export function pickKernelScript(argv: string[]): string | null {
  for (const a of argv) if (KERNEL_SCRIPT_RE.test(a)) return a;
  return null;
}

/** serve 宿主的入口脚本 basename：`quay.js`（出厂 dist 产物，`plugin/bin/quay` 的 `cd -P` 真实路径）
 *  与 `quay.ts`（源检出入口）。 */
const SERVE_SCRIPT_BASENAMES = new Set(["quay.js", "quay.ts"]);

/** 从 argv 里认出息主 serve 脚本。身份判定复用 kernel leaf 的 `isQuayServe`（`quay … serve`），
 *  ⛔ 不在这里再写一遍「哪个实参像 serve 入口」的判据（两份 = 漂移）。 */
export function pickServeScript(argv: string[]): string | null {
  if (!isQuayServe(argv)) return null;
  return argv.find((a) => SERVE_SCRIPT_BASENAMES.has(path.basename(a))) ?? null;
}

/** 宿主「实际加载了哪个脚本」的解析策略：**读法**一份（`loadedScriptFromCmdline`），
 *  **认哪个实参算脚本**按宿主种类分。 */
export interface LoadedHostProbe {
  /** 宿主称谓，写进 `reason`（"anchor/supervisor" / "serve host"）。 */
  noun: string;
  /** 从 argv 里认出息主脚本的实参（认不出 ⇒ null）。 */
  pick(argv: string[]): string | null;
  /** cmdline 认不出脚本时的**第二来源**（anchor 的回读面）。没有第二来源 ⇒ 省略（serve 就没有）。 */
  fallback?(root: string, hostPid: number): { script: string; source: LoadedScriptSource } | null;
}

/** 已安装版本的**注册表**读数（`~/.claude/plugins/installed_plugins.json` 的 `quay@quay` 条目）。
 *  取**最高**版本那条（同一 host 上同一插件可有多个 scope/多个项目条目；「已安装的是什么版本」的答案
 *  是其中最高的那个），并带回它的安装时刻与 scope 供排障。
 *  ⛔ 文件缺失/不可解析/无 `quay@quay` 条目/条目都没有合法版本 ⇒ null（调用方 fail-closed）。 */
export interface InstalledRegistryReading {
  version: string;
  installedAt: string | null;
  scope: string | null;
  installPath: string | null;
}

export function installedVersionFromRegistry(homeDir: string): InstalledRegistryReading | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw) as { plugins?: Record<string, unknown> };
    const entries = j?.plugins?.["quay@quay"];
    if (!Array.isArray(entries)) return null;
    let best: InstalledRegistryReading | null = null;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      const version = typeof o.version === "string" && o.version.trim() !== "" ? o.version.trim() : null;
      if (version === null) continue;
      const installedAt =
        typeof o.lastUpdated === "string" ? o.lastUpdated : typeof o.installedAt === "string" ? o.installedAt : null;
      const cand: InstalledRegistryReading = {
        version,
        installedAt,
        scope: typeof o.scope === "string" ? o.scope : null,
        installPath: typeof o.installPath === "string" ? o.installPath : null,
      };
      if (best === null) {
        best = cand;
        continue;
      }
      const c = compareVersions(cand.version, best.version);
      // 不可排序 ⇒ 字典序兜底：保证「取最高」在任意版本串上都给一个**确定**答案（⛔ 不返回第一个）。
      if (c === null ? cand.version > best.version : c > 0) best = cand;
    }
    return best;
  } catch {
    return null;
  }
}

/** `.quay/config.yml` 的 `providers:` 块里每个 `path:` 带出的版本段。⛔ 只扫 `providers:` 块
 *  （顶层键起始、下一个顶层键结束）：`gates:`/`loop:` 里也有 `path:` 形的键，扫全文件会读到无关的值。
 *  没有版本段的 path（`./packages/quay-native` 这种源检出形态）被**跳过**，⛔ 不记成空串。
 *
 *  ⚠️ 自 gap-config-provider-path-frozen-to-versioned-cache-dir 起，正常装机的 `path` 是
 *  `<ws>/.quay/plugin/vendor/quay-native` —— 一个**项目内符号链接**，TEXT 里没有版本段。这不代表
 *  「没有版本可比」：`readlink -f` 该路径即得到**真实安装目录**（`…/cache/quay/quay/<x.y.z>/…`），版本段
 *  在**解析后的路径**里。⇒ 文本里读不到时对路径做一次 realpath 再取版本段；realpath 失败（路径不存在 /
 *  非源检出形态）才真的算「无版本段可比」⇒ not-evaluated（硬规则 3b：读不到 ≠ 没漂移）。 */
export function providerPathVersions(root: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, ".quay", "config.yml"), "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  let inProviders = false;
  for (const line of text.split("\n")) {
    if (/^[A-Za-z_]/.test(line)) {
      inProviders = /^providers:\s*(#.*)?$/.test(line);
      continue;
    }
    if (!inProviders) continue;
    const m = /^\s+path:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[1].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
    let v = VERSION_SEGMENT_RE.exec(value);
    if (!v) {
      // No version segment in the TEXT ⇒ the stable project link (or a dev path). Resolve symlinks and
      // read the version off the REAL install directory. A path that does not resolve stays absent.
      const abs = path.isAbsolute(value) ? value : path.resolve(root, value);
      try {
        v = VERSION_SEGMENT_RE.exec(fs.realpathSync(abs));
      } catch {
        v = null;
      }
    }
    if (v) out.push(v[1]!);
  }
  return out;
}

/** `.quay/config.yml` provider `path` vs 已安装版本（第二个漂移源）。
 *  ⛔ 「一个带版本段的 path 都没有」（源检出）与「比过了、一致」**必须不同形**（硬规则 3b）：
 *  前者 ⇒ `not-evaluated`，后者 ⇒ `current`。 */
export function configProviderPathReading(
  root: string,
  installed: string | null,
): { configProviderPath: LoadedVersionState; configProviderPathVersion: string | null } {
  const versions = providerPathVersions(root);
  if (versions.length === 0) return { configProviderPath: "not-evaluated", configProviderPathVersion: null };
  if (installed === null) return { configProviderPath: "not-evaluated", configProviderPathVersion: versions[0] };
  // 多 provider 时取「最坏」的那一条（behind > ahead > current）：任一条落后 ⇒ 这个工作区有漂移。
  let rank = 0; // 0=current 1=ahead 2=behind
  for (const v of versions) {
    const c = compareVersions(v, installed);
    const r = c === null ? (v === installed ? 0 : 2) : c === 0 ? 0 : c < 0 ? 2 : 1;
    if (r > rank) rank = r;
  }
  return {
    configProviderPath: rank === 2 ? "behind" : rank === 1 ? "ahead" : "current",
    configProviderPathVersion: versions[0],
  };
}

/** 「宿主实际加载的版本 vs 已安装版本」的判定 —— **anchor 与 serve 共用的那一份**。
 *
 *  `hostPid` = 承载该工作区那个循环/服务的**宿主进程**（driver 收敛形态 = anchor；serve = `.quay/
 *  server.json` 里的宿主 pid）。宿主缺失/已死 ⇒ `not-evaluated`（⛔ 不是 `current`：没有运行中的进程
 *  ≠ 跑的是最新版）。`probe` 给出「哪个实参算脚本」与（可选）第二来源。
 *
 *  `opts.homeDir` / `opts.selfVersion` / `opts.selfVersionResolver` 是 hermetic 测试缝与「注册表读不出时
 *  的第二来源」——⛔ 生产调用方不传 `homeDir`。`selfVersionResolver` **惰性求值**：只有注册表读不出时
 *  才调用（内核/插件根的解析可能要 spawn `git`，⛔ 不让每条 status 命令都付这个钱）。 */
export function loadedVersionReadingForHost(
  root: string,
  hostPid: number | null,
  probe: LoadedHostProbe,
  opts: { homeDir?: string; selfVersion?: string | null; selfVersionResolver?: () => string | null } = {},
): LoadedVersionReading {
  const homeDir = opts.homeDir ?? process.env.HOME ?? os.homedir();
  const reg = installedVersionFromRegistry(homeDir);
  // ⛔ 惰性：`selfVersionResolver` 只在注册表读不出时才跑（见上面的 doc）。
  const selfVersion =
    reg !== null ? null : opts.selfVersion !== undefined ? opts.selfVersion : (opts.selfVersionResolver?.() ?? null);
  const installed = reg?.version ?? selfVersion ?? null;
  const installedAt = reg?.installedAt ?? null;
  const installedSource: LoadedVersionReading["installedSource"] = reg
    ? "registry"
    : selfVersion
      ? "kernel-version-file"
      : null;
  const cfg = configProviderPathReading(root, installed);
  const base = { installed, installedAt, installedSource, ...cfg };

  const degraded = (
    reason: string,
    extra: Partial<LoadedVersionReading> = {},
  ): LoadedVersionReading => ({
    state: "not-evaluated",
    loaded: null,
    loadedKernel: null,
    loadedKernelSource: null,
    relation: "not-evaluated",
    reason,
    ...base,
    ...extra,
  });

  if (hostPid === null || !pidAlive(hostPid)) {
    return degraded(
      hostPid === null
        ? `no ${probe.noun} process for this workspace (no pid) — nothing to read the loaded script from`
        : `${probe.noun} pid ${hostPid} is not alive — nothing to read the loaded script from`,
    );
  }

  // ① 直接量：进程自己的 exec 实参。② second-best：probe 给的第二来源（anchor 每个 reconcile pass
  //    重写的回读面；⛔ 只在 ① 读不出时采信，且由 probe 自己保证只认**同一个 pid** 的回读面）。
  let loadedKernel = loadedScriptFromCmdline(hostPid, probe.pick);
  let loadedKernelSource: LoadedVersionReading["loadedKernelSource"] = loadedKernel ? "proc-cmdline" : null;
  if (loadedKernel === null && probe.fallback) {
    const fb = probe.fallback(root, hostPid);
    if (fb) {
      loadedKernel = fb.script;
      loadedKernelSource = fb.source;
    }
  }
  if (loadedKernel === null) {
    return degraded(
      `cannot read the loaded script for ${probe.noun} pid ${hostPid} (/proc/${hostPid}/cmdline carries no ` +
        `${probe.noun} script${probe.fallback ? " and the second source carries none either" : ""})`,
    );
  }

  const loaded = versionOfLoadedScript(loadedKernel);
  if (loaded === null) {
    return degraded(`cannot derive a version from the loaded script path (${loadedKernel})`, {
      loadedKernel,
      loadedKernelSource,
    });
  }
  if (installed === null) {
    return degraded(
      "cannot determine the installed version (installed_plugins.json unreadable AND the host has no VERSION file)",
      { loaded, loadedKernel, loadedKernelSource },
    );
  }

  const c = compareVersions(loaded, installed);
  const relation: VersionRelation =
    c === null ? (loaded === installed ? "equal" : "not-evaluated") : c === 0 ? "equal" : c < 0 ? "loaded-older" : "loaded-newer";
  const state: LoadedVersionState =
    relation === "equal" ? "current" : relation === "loaded-older" ? "behind" : relation === "loaded-newer" ? "ahead" : "behind";
  return { state, loaded, loadedKernel, loadedKernelSource, relation, reason: null, ...base };
}

/** anchor / supervisor 宿主的 probe：cmdline 里认内核脚本，认不出时退回 `.quay/anchor.json` 的回读面。
 *  ⛔ 回读面是 anchor 对**自己**内核路径的自报 = second-best，故由 `source` 单列（不混进 `proc-cmdline`）。 */
export const DRIVER_HOST_NOUN = "anchor/supervisor";

/** serve 宿主的 probe：cmdline 里认 `quay … serve` 的入口脚本。⛔ 没有第二来源 —— serve 宿主不写
 *  「我加载了哪个脚本」的回读面，所以读不出就是 `not-evaluated`（⛔ 不退回去猜一个版本）。 */
export const SERVE_HOST_PROBE: LoadedHostProbe = {
  noun: "serve host",
  pick: pickServeScript,
};

/** `quay server status` 用的读数：对象是 `.quay/server.json` 载体里的**宿主 pid**。
 *  注册表读不出时的第二来源 = **本 Core 自己的插件根**（`resolvePluginRoot()`，与内核同样从
 *  `import.meta.url` 上跳，⛔ 不读 `.quay/plugin` 指引链接——那会让指针成为自己 resolver 的输入）。 */
export function serveHostLoadedVersionReading(
  root: string,
  hostPid: number | null,
  opts: { homeDir?: string; selfVersion?: string | null } = {},
): LoadedVersionReading {
  return loadedVersionReadingForHost(root, hostPid, SERVE_HOST_PROBE, {
    ...opts,
    selfVersionResolver: () => {
      const pluginRoot = resolvePluginRoot();
      return pluginRoot === null ? null : readVersionOfDirectory(pluginRoot);
    },
  });
}
