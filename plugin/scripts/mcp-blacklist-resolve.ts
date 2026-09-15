// mcp-blacklist-resolve.ts — tasks/gap-worker-mcp-blacklist-strict-config.
//
// WHY THIS EXISTS: a pure code-writing role (task-worker / fix-worker / selector) launched through
// plain `claude -p` connects EVERY configured MCP server regardless of whether the task needs a
// browser. Measured 2026-09-14: 48 × chrome-devtools-mcp + 12 × playwright-mcp + 12 × telemetry
// watchdog ≈ 3.24 GB RSS, the single largest concentration of memory pressure at the time. A pure
// `echo`/`sleep` task dragged the whole process tree up.
//
// WHAT IT DOES: given a role's blacklist (`.quay/profiles.yml` → `roles.<role>.mcpBlacklist`),
// enumerate the ACTUALLY CONFIGURED MCP servers from the three real config sources, drop the
// blacklisted ones, and emit `{"mcpServers": {...}}` — which `launchArgv` turns into
// `--strict-mcp-config --mcp-config <inline json>`.
//
// ⛔ NEVER `claude mcp list` TO ENUMERATE. It does a liveness probe: it would spawn
// chrome-devtools-mcp / playwright-mcp itself just to health-check them, which is exactly the cost
// this module exists to avoid. We read the config FILES.
//
// ── The three sources (and the honest coverage boundary) ──────────────────────────────────────
//   ① user-level     `~/.claude.json` → `.mcpServers`                (absolute commands already)
//   ② project-level  `<dir>/.mcp.json`                              (bare server names)
//   ③ plugin-level   `enabledPlugins` (user + project settings) → the plugin's own `.mcp.json`,
//                    with the literal `${CLAUDE_PLUGIN_ROOT}` expanded to the DETECTED plugin root
//                    (the version dir changes between sessions — measured 2026-09-14: meta-cc moved
//                    from `plugins/cache/meta-cc-marketplace/meta-cc/3.8.3/` to
//                    `~/.local/share/meta-cc/` inside one session ⇒ ⛔ never hardcode a version).
//
// ⚠️ COVERAGE BOUNDARY, stated rather than implied: claude.ai's Gmail/Drive/Calendar connectors are
// NOT in `~/.claude.json`'s `.mcpServers` — they are a separate, natively-hosted population. This
// enumeration cannot see them, and therefore cannot govern them. For a worker that is a benign side
// effect, but this module must NOT be described as "the same set `claude mcp list` shows".
//
// ── Server NAMES decide TOOL names, and tool names are load-bearing ────────────────────────────
// A plugin-provided server surfaces as `mcp__<pluginName>_<serverName>__<tool>` (observed:
// plugin `quay@quay` + server `quay` → `mcp__plugin_quay_quay__task_list`). `--mcp-config` is a FLAT
// name→spec map with no plugin association, so the emitted key must reproduce that flattening
// (`plugin_quay_quay`) or every plugin-prefixed reference breaks — `plugin/agents/quay-task.md`'s
// `tools:` allowlist and `allowed-tools-plugin-prefix-check.ts` both spell those names out.
// Measured 2026-09-14: keys emitted this way reproduce `mcp__plugin_quay_quay__task_list` exactly.
//
// ── Failure semantics (硬规则 3b: 「读不懂」must not look like 「合格」) ──────────────────────────
//   * A config FILE that does not EXIST contributes nothing — absence is a legitimate "not
//     configured", and it is what Claude Code itself concludes.
//   * A config FILE that exists but cannot be read/parsed ⇒ the WHOLE resolution returns `null`.
//     Treating it as "no servers in this category" would let a partial result masquerade as a
//     complete one — `--strict-mcp-config` on a partial list silently DROPS the servers we failed
//     to enumerate.
//   * A single server whose `${CLAUDE_PLUGIN_ROOT}` cannot be expanded, or whose plugin root
//     cannot be located, is SKIPPED — it does not poison the rest, and does not fail the whole run.
//   * `null` from the caller's perspective means "add no mcp flags at all ⇒ argv unchanged".
//     This is a RESOURCE optimisation, not a correctness gate: ⛔ it must never block a dispatch.
//
// ── Test seam (AC7) ────────────────────────────────────────────────────────────────────────────
// `roots` is injected, never read from the real `~/.claude*` by tests — same shape as
// worktree-process-reaper.ts's `WORKTREE_PROCESS_REAPER_PS_SOURCE`. `QUAY_MCP_CONFIG_ROOTS`
// (JSON-encoded McpConfigRoots) is the env seam for callers that cannot pass an argument.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 一个 MCP server 的声明。字段原样透传（⛔ 不发明字段——源声明的形状就是 Claude Code 认的形状）。 */
export interface McpServerSpec {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [k: string]: unknown;
}

/** 枚举的配置根。⛔ 测试必须注入 fixture，不读真实 `~/.claude*`（AC7）。 */
export interface McpConfigRoots {
  /** 「家目录」：`~/.claude.json` / `~/.claude/settings.json` / `~/.claude/plugins/` 的基准。 */
  homeDir: string;
  /** 项目级根：每个贡献 `<dir>/.mcp.json` 与 `<dir>/.claude/settings.json`（enabledPlugins）。 */
  projectDirs: string[];
  /** 本 kernel 自己的 plugin root（`resolveKernelPluginRoot()`）。它【自己的插件】永远可用——
   *  驱动必须把承载自己的那份插件交给子会话，否则 worker 拿不到 quay 工具（见文件头「server names」）。 */
  kernelPluginRoot?: string;
}

/** `roots` 的环境变量缝（JSON 编码的 McpConfigRoots）。 */
export const MCP_ROOTS_ENV = "QUAY_MCP_CONFIG_ROOTS";

export type McpResolution = { ok: true; config: { mcpServers: Record<string, McpServerSpec> } } | { ok: false; reason: string };

// ── 读文件：不存在 ≠ 读不懂（硬规则 3b；两者的取值必须可区分）─────────────────────────────────
type FileRead = { state: "missing" } | { state: "unreadable"; reason: string } | { state: "ok"; json: unknown };

function readJsonIfPresent(file: string): FileRead {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "ENOENT") return { state: "missing" };
    return { state: "unreadable", reason: `${file}: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    return { state: "ok", json: JSON.parse(raw) };
  } catch (e) {
    return { state: "unreadable", reason: `${file}: not valid JSON — ${e instanceof Error ? e.message : String(e)}` };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── `${CLAUDE_PLUGIN_ROOT}` 展开（⛔ `--mcp-config` 不会替我们展开插件专属变量）───────────────
// 实测（任务体）：把 archguard 原始的 `.mcp.json`（带字面量占位符）直接喂给 `--mcp-config`
// ⇒ `CONNECTION_CLOSED: "Connection closed"`。必须由我们展开成【探测到的】插件根目录。
export const CLAUDE_PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";

/** 把一棵 JSON 子树里所有字符串的 `${CLAUDE_PLUGIN_ROOT}` 换成 pluginRoot（深拷贝，⛔ 不改输入）。 */
export function expandPluginRoot(value: unknown, pluginRoot: string): unknown {
  if (typeof value === "string") return value.split(CLAUDE_PLUGIN_ROOT_VAR).join(pluginRoot);
  if (Array.isArray(value)) return value.map((v) => expandPluginRoot(v, pluginRoot));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandPluginRoot(v, pluginRoot);
    return out;
  }
  return value;
}

/** 一个插件级 server 的扁平化 key：`mcp__<pluginName>_<serverName>__<tool>` 的来源。
 *  ⛔ 见文件头「server names decide tool names」——不是装饰，是 allowlist 能不能命中的开关。 */
export function pluginServerKey(pluginName: string, serverName: string): string {
  return `plugin_${pluginName}_${serverName}`;
}

// ── `.mcp.json` 的两种形状（都真实存在，⛔ 不假定其中一种）────────────────────────────────────
//   plugin/.mcp.json          {"quay": {...}}              ← 扁平（插件声明用这个形状）
//   archguard/.mcp.json       {"mcpServers": {"archguard": {...}}}
/** 只取 `mcpServers` 包裹形（Claude Code 的 `~/.claude.json` 与项目 `.mcp.json` 的正式形状）。
 *  ⛔ 这两个来源【必须】用这个严格读法：`~/.claude.json` 顶层还有 `projects`（整部会话史）等
 *  一堆对象键，一旦按「扁平 = 每个对象键都是 server」去读，整部历史会被当成 MCP server 表。 */
export function wrappedServerTable(doc: unknown): Record<string, unknown> {
  if (!isRecord(doc)) return {};
  const wrapped = doc.mcpServers;
  return isRecord(wrapped) ? wrapped : {};
}

/** 取出一个插件 `.mcp.json` 的 server 表：`mcpServers` 包裹形 **或** 扁平形。
 *  插件声明这一种来源实测两种形状都在用（quay/meta-cc 扁平，archguard 包裹）⇒ 必须都认。 */
export function serverTable(doc: unknown): Record<string, unknown> {
  if (!isRecord(doc)) return {};
  const wrapped = doc.mcpServers;
  if (isRecord(wrapped)) return wrapped;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "mcpServers") continue;
    if (isRecord(v)) out[k] = v;
  }
  return out;
}

// ── 插件根目录解析（版本号目录会变 ⇒ 每次现查，⛔ 不写死）────────────────────────────────────
// 四个来源，按「最贴近实际安装」优先，第一个产出可解析 `.mcp.json` 的根获胜：
//   a. kernel plugin root —— 驱动把【承载自己的那份插件】交给子会话（见文件头）
//   b. installed_plugins.json 的 installPath（Claude Code 登记的安装位置；**可能已失效**——
//      实测 meta-cc 的 installPath 指向一个不存在的 cache 目录）
//   c. `plugins/cache/<marketplace>/<name>/<version>/` glob（版本目录，⛔ 不写死版本号）
//   d. known_marketplaces.json 的 installLocation（directory 源；或再经 marketplace.json 的
//      `source` 相对路径下钻）
function pluginCandidateRoots(homeDir: string, kernelPluginRoot: string | undefined, pluginName: string, marketplace: string): string[] {
  const roots: string[] = [];
  const push = (p: string | undefined) => {
    if (p && !roots.includes(p)) roots.push(p);
  };

  // (a) kernel plugin root —— 只有当它自己的 plugin.json.name 就是这个插件名时才认领。
  if (kernelPluginRoot) {
    const manifest = readJsonIfPresent(path.join(kernelPluginRoot, ".claude-plugin", "plugin.json"));
    if (manifest.state === "ok" && isRecord(manifest.json) && manifest.json.name === pluginName) push(kernelPluginRoot);
  }

  // (b) installed_plugins.json（只取磁盘上真的还在的 installPath）。
  const installed = readJsonIfPresent(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"));
  if (installed.state === "ok" && isRecord(installed.json) && isRecord(installed.json.plugins)) {
    const entries = installed.json.plugins[`${pluginName}@${marketplace}`];
    if (Array.isArray(entries)) {
      for (const e of entries) {
        if (isRecord(e) && typeof e.installPath === "string" && fs.existsSync(e.installPath)) push(e.installPath);
      }
    }
  }

  // (c) cache glob：<cache>/<marketplace>/<name>/<version>/（版本目录每次现查）。
  const cacheParent = path.join(homeDir, ".claude", "plugins", "cache", marketplace, pluginName);
  try {
    for (const version of fs.readdirSync(cacheParent)) push(path.join(cacheParent, version));
  } catch {
    /* cache 目录不存在 / 不可读 ⇒ 这一来源贡献空集（其它来源仍覆盖） */
  }

  // (d) known_marketplaces.json → installLocation（directory 源），必要时经 marketplace.json 下钻 source。
  const known = readJsonIfPresent(path.join(homeDir, ".claude", "plugins", "known_marketplaces.json"));
  if (known.state === "ok" && isRecord(known.json)) {
    const entry = known.json[marketplace];
    if (isRecord(entry) && typeof entry.installLocation === "string") {
      const loc = entry.installLocation;
      push(loc);
      const mp = readJsonIfPresent(path.join(loc, ".claude-plugin", "marketplace.json"));
      if (mp.state === "ok" && isRecord(mp.json) && Array.isArray(mp.json.plugins)) {
        for (const p of mp.json.plugins) {
          if (isRecord(p) && p.name === pluginName && typeof p.source === "string") {
            push(path.resolve(loc, p.source));
          }
        }
      }
    }
  }

  return roots;
}

// ── enabledPlugins（用户级 + 项目级合并）─────────────────────────────────────────────────────
/** 合并 user-level 与 project-level 的 `enabledPlugins`，返回 `name@marketplace` 键集（value===true 才算启用）。
 *  读不懂（存在但非法）⇒ 抛错，由调用方转成整体 `null`（硬规则 3b）。 */
function enabledPluginKeys(roots: McpConfigRoots): string[] {
  const files = [path.join(roots.homeDir, ".claude", "settings.json"), ...roots.projectDirs.map((d) => path.join(d, ".claude", "settings.json"))];
  const keys = new Set<string>();
  for (const f of files) {
    const r = readJsonIfPresent(f);
    if (r.state === "missing") continue;
    if (r.state === "unreadable") throw new Error(r.reason);
    if (!isRecord(r.json)) throw new Error(`${f}: settings must be a JSON object`);
    const ep = r.json.enabledPlugins;
    if (ep === undefined) continue;
    if (!isRecord(ep)) throw new Error(`${f}: enabledPlugins must be an object`);
    for (const [k, v] of Object.entries(ep)) if (v === true) keys.add(k);
  }
  return [...keys];
}

// ── 主入口 ────────────────────────────────────────────────────────────────────────────────────
/** 枚举当前实际配置的 MCP server，减去黑名单，返回 `{"mcpServers": {...}}`；无法评估 ⇒ `null`。
 *
 *  返回 `null` 的两种情形必须在调用方同形（都不追加任何 mcp flag），但它们【不】同义：
 *  “真的没有 server 可配” 与 “读不懂输入” 在这里被合并，因为调用方的正确动作相同（别加 flag）。
 *  代价是这里丢了区分度——所以本函数的失败原因由 `ok:false` 的 reason 承载，供测试与排障读取。 */
export function resolveMcpConfig(blacklist: readonly string[], roots: McpConfigRoots): McpResolution {
  const black = new Set(blacklist);
  const out: Record<string, McpServerSpec> = {};

  try {
    // ① user-level：~/.claude.json → .mcpServers（裸名）。
    const user = readJsonIfPresent(path.join(roots.homeDir, ".claude.json"));
    if (user.state === "unreadable") return { ok: false, reason: user.reason };
    if (user.state === "ok") {
      if (!isRecord(user.json)) return { ok: false, reason: `${path.join(roots.homeDir, ".claude.json")}: must be a JSON object` };
      const table = wrappedServerTable(user.json);
      for (const [name, spec] of Object.entries(table)) {
        if (black.has(name) || !isRecord(spec)) continue;
        out[name] = spec as McpServerSpec;
      }
    }

    // ② project-level：<dir>/.mcp.json（裸名，与 Claude Code 的项目级 MCP 配置同名空间）。
    //    ⚠️ 只扫 projectDirs——⛔ 不扫 `<pluginRoot>/.mcp.json`：那是插件【自己的】声明，走 ③
    //    的插件命名空间（`plugin_<plugin>_<server>`）。两条路都走会让同一个 server 起两份进程，
    //    且把工具名从 `mcp__plugin_quay_quay__*` 改成 `mcp__quay__*`（破坏 agent allowlist）。
    for (const dir of roots.projectDirs) {
      const r = readJsonIfPresent(path.join(dir, ".mcp.json"));
      if (r.state === "missing") continue;
      if (r.state === "unreadable") return { ok: false, reason: r.reason };
      for (const [name, spec] of Object.entries(wrappedServerTable(r.json))) {
        if (black.has(name) || !isRecord(spec)) continue;
        out[name] = spec as McpServerSpec;
      }
    }

    // ③ plugin-level：enabledPlugins → 插件根的 .mcp.json（字面量 ${CLAUDE_PLUGIN_ROOT} 展开）。
    let keys: string[];
    try {
      keys = enabledPluginKeys(roots);
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    for (const key of keys) {
      const at = key.lastIndexOf("@");
      if (at <= 0) continue; // 形状不符 ⇒ 跳过该插件（不是整个枚举失败：它不是「读不懂」，是「不认识」）
      const pluginName = key.slice(0, at);
      const marketplace = key.slice(at + 1);

      let declared: { root: string; table: Record<string, unknown> } | null = null;
      for (const root of pluginCandidateRoots(roots.homeDir, roots.kernelPluginRoot, pluginName, marketplace)) {
        const mcp = readJsonIfPresent(path.join(root, ".mcp.json"));
        // 插件根缺 .mcp.json ⇒ 换下一个候选；存在但读不懂 ⇒ 跳过该插件（⛔ 不整体失败：
        // 插件级枚举的失败面已经由 enabledPluginKeys 的严格性承载，这里再 fail-closed 会让
        // 一个坏掉的第三方插件拖垮全部派发——而本模块是资源优化，不是正确性闸）。
        if (mcp.state !== "ok") continue;
        const table = serverTable(mcp.json);
        if (Object.keys(table).length > 0) {
          declared = { root, table };
          break;
        }
      }
      if (!declared) continue; // 版本目录改名 / 插件未落地 ⇒ 该插件从结果中消失（其余条目不受影响）

      for (const [serverName, spec] of Object.entries(declared.table)) {
        if (black.has(serverName) || !isRecord(spec)) continue;
        out[pluginServerKey(pluginName, serverName)] = expandPluginRoot(spec, declared.root) as McpServerSpec;
      }
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  return { ok: true, config: { mcpServers: out } };
}

/** 从环境装出配置根（生产路径）。`QUAY_MCP_CONFIG_ROOTS` 覆盖（测试缝）。
 *  覆盖值存在但读不懂 ⇒ **null**（⛔ 不静默退回真实 home——那会让一个打错的 fixture 缝变成
 *  对真实 `~/.claude*` 的读取，正是 AC7 禁止的形状；也不返回一个空 root 去读 cwd）。
 *  `kernelPluginRoot` 由调用方传（生产 = `resolveKernelPluginRoot()`；本模块 ⛔ 不 import
 *  driver-runtime.ts——那会形成循环 import：driver-runtime 已 import 本模块）。 */
export function rootsFromEnv(
  projectDirs: string[],
  env: NodeJS.ProcessEnv = process.env,
  kernelPluginRoot?: string,
): McpConfigRoots | null {
  const override = env[MCP_ROOTS_ENV];
  if (override !== undefined && override !== "") {
    try {
      const parsed = JSON.parse(override) as McpConfigRoots;
      if (isRecord(parsed) && typeof parsed.homeDir === "string" && Array.isArray(parsed.projectDirs)) return parsed;
    } catch {
      /* fall through to null */
    }
    return null;
  }
  return { homeDir: os.homedir(), projectDirs, ...(kernelPluginRoot ? { kernelPluginRoot } : {}) };
}

/** `launchArgv` 用的后缀：成功 ⇒ `["--strict-mcp-config","--mcp-config",<inline json>]`；无法评估 ⇒ `[]`。
 *
 *  ⚠️ 空 server 表【不是】「不加 flag」：若黑名单恰好覆盖了全部已配置 server，正确结果是
 *  `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`（一个 server 都不连）。回退成 `[]`
 *  会把「排除」变成「全连」——与黑名单的意图正好相反。只有【读不懂输入】才返回 `[]`。
 *
 *  ⛔ inline JSON 而不是临时文件：`--mcp-config` 接受 "JSON files or strings"（本机 claude 2.1.270
 *  `--help`），实测可行。落盘的代价是——写进 `.quay/` 需要 .gitignore 豁免（未豁免的运行时文件曾
 *  让 fan-in-ff-merge 拒绝 ff），写进 /tmp 要管生命周期，而按 role+hash 缓存会在插件版本变化后
 *  指向过期的 `${CLAUDE_PLUGIN_ROOT}`。inline 把这三种失效面一次消掉。 */
export function mcpConfigArgvSuffix(blacklist: readonly string[], roots: McpConfigRoots): string[] {
  if (blacklist.length === 0) return [];
  const res = resolveMcpConfig(blacklist, roots);
  if (!res.ok) return [];
  return ["--strict-mcp-config", "--mcp-config", JSON.stringify(res.config)];
}
