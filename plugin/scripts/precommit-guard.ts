#!/usr/bin/env node
// precommit-guard.ts — 拒绝「轮 running 且触及断言面」的提交（覆盖全部写入者）。
//
// 实证（2026-08-12，三独立支撑，manager 判定）：「round 期间零提交」约定守不住：
//   ① 约定无产物（C17）——round 60 约定后 26s 即破（外层 47023142）；
//   ② 连事后都难区分——要靠人拿 startedAt 逐笔比对 commit 时刻；
//   ③ 参与方不完整且名单无人维护（最硬）——inner 从不在约定里，round 63 窗口内
//      以 30-40s 一次提交 4 笔任务体更新，无人告诉它有一轮在跑。
//   ①②可靠「更小心」缓解，③结构上不可能靠小心解决。守卫必须覆盖名单之外的写入者，
//   因此机制 = 共享 pre-commit 钩子（--install-hook 写入 <git-dir>/hooks/pre-commit）——
//   不是各层各自记得调的 commit 包装。约定参与方名单不可维护，钩子天然覆盖所有提交者。
//
// 判定（读 .quay/full-suite-state.json）：
//   state == "running" 且 本次提交触及断言面文件 ⇒ 拒提交（exit 1）+ 打印预检清单
//   state 文件缺失 / state 字段 null ⇒ 拒（fail-loud——参照系缺失时谓词必须崩，
//     不给看似合理的值；AC2）
//   断言面集合 = plugin/scripts/judged-object-registry.json 的 patterns（A0b③ 生成，
//     非手工维护；守卫只读它）。缺失/空/不可解析 ⇒ 回退到全 tracked 文件
//     （git ls-files）——fail-closed，宁严勿松（round 60/63 形态全挡；A0b③ 是精化不是前置）。
//   --allow-dirty-round（CLI 参数或 QUAY_ALLOW_DIRTY_ROUND=1 环境变量）显式覆盖——
//     有记录可追责，不静默绕过。
//
// 使用（本仓库路径）：
//   node --no-warnings --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
//       [--allow-dirty-round] [--install-hook] [--uninstall-hook] [--json] [--help]
//   --install-hook     把 <git-dir>/hooks/pre-commit 写成调用本守卫的 shim（幂等）
//   --uninstall-hook   移除 <git-dir>/hooks/pre-commit 中的本守卫 shim（幂等）
//   --json             机器可读输出（{verdict, reason, state, assertionSurface, staged}）
//   --allow-dirty-round / QUAY_ALLOW_DIRTY_ROUND=1  显式覆盖（记录可追责）
//
// 退出码：0 = 放行；1 = 拒（running+断言面 / fail-loud 缺失/null）；2 = 用法/环境错。
//
// 作为 pre-commit 钩子运行时 git 不传参数，--allow-dirty-round 只能经
// QUAY_ALLOW_DIRTY_ROUND=1 环境变量显式给出（git commit 前设置）。
//
// <!-- enforcement: plugin/scripts/precommit-guard.ts -->

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 常量 ─────────────────────────────────────────────────────────────────────────────────────────────

/** state 文件 well-known 位置（相对 --root）。full-suite-runner.ts 写它。 */
const STATE_FILE_REL = path.join(".quay", "full-suite-state.json");
/** 断言面注册表（A0b③ 生成；守卫只读，缺失/空回退全 tracked——fail-closed）。 */
const REGISTRY_REL = path.join("plugin", "scripts", "judged-object-registry.json");
/** 钩子 shim 里的固定指纹（--uninstall-hook 据此识别、移除本守卫的 shim）。 */
const HOOK_FINGERPRINT = "precommit-guard.ts";

export const RUNNING = "running";

export interface Verdict {
  verdict: "allow" | "reject" | "error";
  reason: string;
  message: string;
  state: Record<string, unknown> | null;
  stateFile: string | null;
  assertionSurface: string[];
  staged: string[];
  touchedAssertion: string[];
  override: boolean;
  registryMode: "registry" | "fallback-all-tracked" | "error";
}

// ── 小工具 ───────────────────────────────────────────────────────────────────────────────────────────

function repoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

function gitDir(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("not a git repository (git rev-parse --git-dir failed)");
  }
}

/** 已暂存（即将提交）的文件列表，repo-相对路径。pre-commit 钩子与包装脚本同一读取面。 */
export function stagedFiles(root: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) return [];
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** 全 tracked 文件列表（fail-closed 回退面）。 */
export function allTrackedFiles(root: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) return [];
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function escapeRegExp(s: string): string {
  const SPECIAL = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  let out = "";
  for (const ch of String(s)) out += SPECIAL.has(ch) ? `\\${ch}` : ch;
  return out;
}

/** glob 匹配：`**` 跨目录任意；`*` 单段任意；字面路径前缀/精确匹配。 */
export function matchesGlob(pattern: string, rel: string): boolean {
  const p = String(pattern).replace(/\\/g, "/");
  const t = String(rel).replace(/\\/g, "/");
  if (!p || !t) return false;
  if (p === "**") return true;
  if (p.startsWith("**/")) {
    const rest = p.slice(3);
    if (rest.includes("*")) {
      return new RegExp(`${rest.split("*").map(escapeRegExp).join(".*")}$`).test(t);
    }
    return t === rest || t.endsWith(`/${rest}`);
  }
  if (p.includes("**")) {
    const [head, ...tail] = p.split("**");
    const re = new RegExp(
      `^${head.split("*").map(escapeRegExp).join("[^/]*")}.*${tail.join("**").split("*").map(escapeRegExp).join("[^/]*")}$`,
    );
    return re.test(t);
  }
  if (p.includes("*")) {
    return new RegExp(`^${p.split("*").map(escapeRegExp).join("[^/]*")}$`).test(t);
  }
  return t === p || t.startsWith(`${p}/`);
}

// ── 断言面集合 ───────────────────────────────────────────────────────────────────────────────────────

export interface RegistryShape {
  version?: number;
  patterns?: string[];
  [k: string]: unknown;
}

/**
 * 从测试自声明的判定对象聚合的断言面（A0b③ 生成，非手工维护）。守卫只读它：
 *   - 注册表存在、可解析、patterns 为非空数组 ⇒ 用其 patterns 对全 tracked 文件求交；
 *   - 缺失 / 空 / 不可解析 ⇒ 回退全 tracked 文件（fail-closed，宁严勿松）。
 */
export function resolveAssertionSurface(root: string): {
  mode: "registry" | "fallback-all-tracked";
  patterns: string[];
  files: string[];
} {
  const tracked = allTrackedFiles(root);
  const regPath = path.join(root, REGISTRY_REL);
  let patterns: string[] = [];
  if (fs.existsSync(regPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(regPath, "utf8")) as RegistryShape;
      if (Array.isArray(raw.patterns) && raw.patterns.length > 0) {
        patterns = raw.patterns.map(String);
      }
    } catch {
      patterns = []; // 不可解析 ⇒ 回退（fail-closed）
    }
  }
  if (patterns.length === 0) {
    return { mode: "fallback-all-tracked", patterns: [], files: tracked };
  }
  const files = tracked.filter((f) => patterns.some((p) => matchesGlob(p, f)));
  return { mode: "registry", patterns, files };
}

// ── 状态读取（fail-loud）─────────────────────────────────────────────────────────────────────────────

/**
 * 读 .quay/full-suite-state.json。
 * 缺失 / 不可解析 ⇒ 返回 { stateFile: null }（调用方必须 fail-loud 拒绝——参照系缺失时谓词必须崩）。
 */
export function readSuiteState(root: string): { stateFile: string | null; data: Record<string, unknown> | null } {
  const p = path.join(root, STATE_FILE_REL);
  if (!fs.existsSync(p)) return { stateFile: null, data: null };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    return { stateFile: p, data };
  } catch {
    return { stateFile: null, data: null };
  }
}

// ── 主判定 ───────────────────────────────────────────────────────────────────────────────────────────

export function judge(
  root: string,
  opts: { allowDirtyRound: boolean; staged?: string[] } = { allowDirtyRound: false },
): Verdict {
  const allowOverride = opts.allowDirtyRound;

  const { stateFile, data } = readSuiteState(root);
  const surface = resolveAssertionSurface(root);
  const staged = opts.staged ?? stagedFiles(root);

  // 显式覆盖（AC6，有记录可追责，不静默绕过）——最先检查：作者显式接受一切不确定性
  // （含 state 缺失/fail-loud 情形）。reason 恒定 allow-dirty-round-override，可追责。
  if (allowOverride) {
    return {
      verdict: "allow",
      reason: "allow-dirty-round-override",
      message: "pre-commit 守卫：--allow-dirty-round 显式覆盖——本次提交进入 running 轮窗口，已记录可追责。",
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: true,
      registryMode: surface.mode,
    };
  }

  // fail-loud（AC2）：state 文件缺失 / 不可解析 ⇒ 拒。不给看似合理的值（"无文件=没在跑" 是假装有参照系）。
  if (stateFile === null || data === null) {
    return {
      verdict: "reject",
      reason: "state-file-missing",
      message:
        "pre-commit 守卫：.quay/full-suite-state.json 缺失或不可解析——参照系缺失，谓词必须崩（fail-loud）。\n" +
        "无法证明当前没有轮在跑；拒绝提交。若你确认这是刻意维护的缺口，用 --allow-dirty-round 显式覆盖。",
      state: null,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: false,
      registryMode: surface.mode,
    };
  }

  // fail-loud（AC2）：state 字段缺失 / null ⇒ 拒。
  const state = data.state;
  if (typeof state !== "string" || state.length === 0) {
    return {
      verdict: "reject",
      reason: "state-null",
      message:
        "pre-commit 守卫：state 文件存在但 state 字段缺失/null——参照系缺失，谓词必须崩（fail-loud）。\n" +
        "无法证明当前没有轮在跑；拒绝提交。",
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: false,
      registryMode: surface.mode,
    };
  }

  // 终态（green/red/…）⇒ 放行。只有 running 触发守卫。
  if (state !== RUNNING) {
    return {
      verdict: "allow",
      reason: "not-running",
      message: `pre-commit 守卫：state=${state}，无运行中的轮，放行。`,
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion: [],
      override: false,
      registryMode: surface.mode,
    };
  }

  const touchedAssertion = staged.filter((f) => surface.files.includes(f));

  if (touchedAssertion.length > 0) {
    const startedAt = data.startedAt ?? "unknown";
    const runId = data.runId ?? "unknown";
    return {
      verdict: "reject",
      reason: "running-round-assertion-surface",
      message:
        `pre-commit 守卫：一轮正在跑（state=running, runId=${runId}, startedAt=${startedAt}），` +
        `本次提交触及断言面文件（${touchedAssertion.length} 个），会使该轮结论不可用。\n` +
        "用 --allow-dirty-round 显式覆盖，或等终态（green/red）后再提交。\n" +
        "拒绝文件：" + touchedAssertion.slice(0, 10).join(", ") +
        (touchedAssertion.length > 10 ? ` …(+${touchedAssertion.length - 10})` : "") + "\n" +
        preflightChecklist(),
      state: data,
      stateFile,
      assertionSurface: surface.files,
      staged,
      touchedAssertion,
      override: false,
      registryMode: surface.mode,
    };
  }

  return {
    verdict: "allow",
    reason: "no-assertion-surface-touched",
    message: "pre-commit 守卫：轮在跑，但本次提交不触及断言面文件，放行。",
    state: data,
    stateFile,
    assertionSurface: surface.files,
    staged,
    touchedAssertion: [],
    override: false,
    registryMode: surface.mode,
  };
}

/** 守卫拒绝后给作者的预检清单（等待期可做、只读、可反复）——强制等待让预检可做。 */
export function preflightChecklist(): string {
  return (
    "预检清单（等待期可做，只读，可反复）：\n" +
    "  1. 等该轮终态：state 文件转 green/red 后再提交（最安全）。\n" +
    "  2. 看进度：tail -f .quay/full-suite.log（该轮 stdout 日志）。\n" +
    "  3. 只读复核：读任务/读 diff/审阅已落地的 commit（git log）。\n" +
    "  4. 若确需立即提交且确认无害：显式 QUAY_ALLOW_DIRTY_ROUND=1 git commit …（有记录可追责）。"
  );
}

// ── 钩子安装/卸载 ────────────────────────────────────────────────────────────────────────────────────

function hookShim(root: string): string {
  return [
    "#!/usr/bin/env bash",
    `# ${HOOK_FINGERPRINT} — installed by plugin/scripts/precommit-guard.ts --install-hook`,
    "# pre-commit guard: reject commits while a suite round is running AND the commit touches",
    "# assertion-surface files (covers ALL writers — the shared hook, not an agreed participant list).",
    "# Override (recorded, not silent): QUAY_ALLOW_DIRTY_ROUND=1 git commit …",
    'ROOT="$(git rev-parse --show-toplevel)"',
    `exec node --no-warnings --experimental-strip-types "$ROOT/plugin/scripts/${HOOK_FINGERPRINT}" --root "$ROOT"`,
    "",
  ].join("\n");
}

export function installHook(root: string): string {
  const gd = gitDir(root);
  const hooksDir = path.join(gd, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, "pre-commit");
  const shim = hookShim(root);
  if (fs.existsSync(hookPath) && !fs.readFileSync(hookPath, "utf8").includes(HOOK_FINGERPRINT)) {
    throw new Error(
      `pre-existing pre-commit hook at ${hookPath} does not carry the ${HOOK_FINGERPRINT} fingerprint; ` +
        "refusing to overwrite. Merge manually.",
    );
  }
  fs.writeFileSync(hookPath, shim, { mode: 0o755 });
  return hookPath;
}

export function uninstallHook(root: string): { removed: boolean; hookPath: string } {
  const gd = gitDir(root);
  const hookPath = path.join(gd, "hooks", "pre-commit");
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, "utf8");
    if (content.includes(HOOK_FINGERPRINT)) {
      fs.rmSync(hookPath, { force: true });
      return { removed: true, hookPath };
    }
  }
  return { removed: false, hookPath };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `precommit-guard.ts — 拒绝「轮 running 且触及断言面」的提交（覆盖全部写入者）

用法:
  node --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
       [--allow-dirty-round] [--install-hook] [--uninstall-hook] [--json] [--help]

参数:
  --install-hook      把 <git-dir>/hooks/pre-commit 写成调用本守卫的 shim（幂等）
  --uninstall-hook    移除 <git-dir>/hooks/pre-commit 中的本守卫 shim（幂等）
  --allow-dirty-round 显式覆盖（等价 QUAY_ALLOW_DIRTY_ROUND=1；有记录可追责）
  --json              机器可读输出（{verdict, reason, message, ...}）
  --help              本帮助

退出码: 0=放行 1=拒（running+断言面 / fail-loud 缺失/null） 2=用法/环境错`;

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let root: string | null = null;
  let allowDirtyRound = false;
  let json = false;
  let install = false;
  let uninstall = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") {
      root = args[++i] ?? null;
    } else if (a === "--allow-dirty-round") {
      allowDirtyRound = true;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--install-hook") {
      install = true;
    } else if (a === "--uninstall-hook") {
      uninstall = true;
    } else {
      console.error(`unknown arg: ${a}\n\n${USAGE}`);
      return 2;
    }
  }
  if (!root) {
    try {
      root = repoRoot(process.cwd());
    } catch {
      root = process.cwd();
    }
  }
  root = path.resolve(root);

  // 环境变量显式覆盖（pre-commit 钩子不传参数，只能经 env 给出）。
  if (process.env.QUAY_ALLOW_DIRTY_ROUND === "1" || process.env.QUAY_ALLOW_DIRTY_ROUND === "true") {
    allowDirtyRound = true;
  }

  try {
    if (install) {
      const hp = installHook(root);
      console.log(`precommit-guard: installed pre-commit hook at ${hp}`);
      return 0;
    }
    if (uninstall) {
      const { removed, hookPath } = uninstallHook(root);
      console.log(removed ? `precommit-guard: removed hook at ${hookPath}` : `precommit-guard: no guard hook at ${hookPath}`);
      return 0;
    }
  } catch (e) {
    console.error(`precommit-guard: ${(e as Error).message}`);
    return 2;
  }

  let verdict: Verdict;
  try {
    verdict = judge(root, { allowDirtyRound });
  } catch (e) {
    console.error(`precommit-guard: internal error: ${(e as Error).message}`);
    return 2;
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          verdict: verdict.verdict,
          reason: verdict.reason,
          message: verdict.message,
          state: verdict.state,
          assertionSurfaceCount: verdict.assertionSurface.length,
          staged: verdict.staged,
          touchedAssertion: verdict.touchedAssertion,
          override: verdict.override,
          registryMode: verdict.registryMode,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(verdict.message);
  }
  return verdict.verdict === "reject" ? 1 : 0;
}

/** 直跑判定（import 测试时不执行 main）：realpath(process.argv[1]) === 本文件自身。 */
function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  process.exit(main());
}

export { repoRoot, gitDir, hookShim };
