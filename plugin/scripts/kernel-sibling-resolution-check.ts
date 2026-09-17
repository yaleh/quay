// kernel-sibling-resolution-check.ts — KERNEL 域（GOAL-012 A 域）静态检查器：
// shipped kernel 把自己的 sibling 脚本（同住 plugin/scripts/ 的 .sh/.ts/.mjs 机件）锚在
// target root / naive `__dirname` / 模板字符串形态、而非经 driver-runtime.ts 的
// `resolveKernelSibling` / `resolveKernelPluginRoot`（⛔ 不是 packages/quay/src/plugin-root.ts 的
// Core 解析器——那一个解析的是 plugin/ 树，这一个解析的是 kernel 自己的 sibling，两者不同）。
//
// 回答的问题（capability-catalog QUESTION）：
//   shipped kernel 代码（plugin/scripts/*.{ts,mjs,js} + packages/quay/src/**/*.ts）里，是否存在把
//   自己的 sibling 脚本（P1/P2/P3）或跨包源码模块（P4，`packages/*/src/**`）锚在 naive `__dirname` /
//   target root / 模板字符串拼接处、而非经 `resolveKernelSibling`/`resolveKernelPluginRoot`（及
//   Core 的 dist/shipped 感知解析器）的调用点？——即 GOAL-012 退出条件①的 A 域「手工枚举 3 次 3 漏」
//   被机械枚举取代的落点。AC-203 前例：`cli/driver.ts` 曾用
//   `path.join(<workspace root>, "plugin/scripts/driver-runtime.ts")` 解析 kernel，quay-init 取消
//   plugin/ 拷贝后每个第三方项目都死于 "kernel not found"。P4 同族前例（2026-09-10 生产复现）：
//   `worker-driver.ts` 用 `path.join(repoRoot(), "packages", "quay", "src", …)` 锚 gate-event-store
//   模块，shipped 包把 packages/quay/ 打平到包根 ⇒ MODULE_NOT_FOUND 被吞 ⇒ gate-events.jsonl 永不写。
//
// 判定（能取假，硬规则 3/4）——按位置判定（硬规则 2），只屏蔽注释、不屏蔽字符串字面量：
//   P1 naive-__dirname — `path.join(__dirname, "<name>.<ext>")` / `path.resolve(__dirname,
//     "<name>.<ext>")`，第二参是字面量脚本文件名。这是「立条实测 9 处 naive __dirname」的主信号；
//     自检工具的 repo-root 惯用法（`path.resolve(__dirname, "..", "..")`）第二参是 `".."`，不命中。
//   P2 target-root    — `path.join(<rootVar>, "plugin", "scripts", "<name>.<ext>")`，脚本文件名是
//     字面量。AC-203 缺陷形：把 kernel sibling 锚在 target root（第三方项目无 plugin/）。
//   P3 template-string — 模板字面量 body 内 `${__dirname}/<name>.<ext>` 或
//     `${<var>}/plugin/scripts/<name>.<ext>`（插值后【紧邻】脚本路径，⛔ 中间夹 prose 不算——
//     `` `${HOOK_FINGERPRINT} — installed by plugin/scripts/…` `` 不是路径拼接）。GOAL-012 风险 4：
//     三种拼接形态各一例，⛔ 不止一种。
//   P4 cross-package — `path.join(<rootExpr>, "packages", "<pkg>", "src", …)` / 模板字面量
//     `` `${<rootExpr>}/packages/<pkg>/src/…` ``，把【另一个包的源码模块】(`packages/*/src/**`)
//     锚在一个 root 上。判据是「该路径指向的东西随包出厂、其在 shipped 布局下的位置与源树不同」：
//     shipped npm 包把 packages/<pkg>/ 打平到包根 ⇒ 源树里的 `packages/<pkg>/src/x.ts` 在 shipped
//     布局下是 `src/x.ts`、`packages/` 段不存在 ⇒ 运行时 MODULE_NOT_FOUND。这是 P2(target-root) 的
//     跨包镜像：P2 锚的是 plugin/scripts 兄弟脚本（第三方项目无 plugin/），P4 锚的是另一个包的 src
//     模块（第三方项目无 packages/）。<rootExpr> 接受裸标识符（`root`/`worktree`/`scriptRoot`）或
//     调用形（`repoRoot()`）。⛔ 不匹配相对 import（`import("../../packages/quay/src/…")`——那经
//     esbuild bundle 在构建期解析，非运行时 root 拼接）；⛔ 不匹配 `packages/<pkg>/bin/…`（bin 是
//     另一布局锚点类别，不在本条 src 面内）。
//
// ⛔ 为什么不屏蔽字符串（对 P1/P2）：`buildNonCodeMask` 的线性状态机在嵌套模板字面量
// （`` `${foo(`inner`)}` ``）处会把一大段真代码误当字符串，从而漏报 full-suite-runner.ts 里 4 处
// naive `__dirname`（实测 1495/1509/1535/1977 被 mask 成 str=1 而 2164 幸免）——那正是「3 次 3 漏」
// 的第四次。P1/P2 的模式（`path.join(__dirname, "…"` / `path.join(<var>, "plugin", "scripts", …)）
// 是代码构造，本仓库的字符串字面量里只拼写 `pluginDir`/`REPO_ROOT`/`"scripts"` 形（test-isolation-
// check.ts 自测夹具），不拼写 P1/P2 的完整形 ⇒ 只屏蔽注释不屏蔽字符串，既不漏报、也不误报。
// P3 仍需背板字面量意识（`${…}` 插值是模板字面量特性），故经 templateLiteralBodies 只在反引号
// 跨度内匹配，⛔ 不把 runner-static-gate.ts（bash，`"${repo_root}/plugin/scripts/…"` 双引号形）当命中。
//
// DEV-TREE-ONLY 豁免（GOAL-012 风险 2：本仓库自检工具锚 root 是正确行为，不得误伤）：命中行或
//   其紧邻注释块携带标记 `kernel-sibling-dev-tree-only:`（带理由）即豁免——⛔ 不是无理由 allowlist，
//   理由与命中同处、可复核。本仓库读自己的 plugin/ 树做自检的 checker（fs.readFileSync /
//   existsSync / readdirSync 形态）与 dev-tree-only 编排 driver 用本标记声明归属。
//
// 退出码（checker-mechanical-spine-check.ts 词表 {0,1,2,3}）：
//   0 = PASS（violations 0 处；或 --no-block 时 REPORT-ONLY——报告但不红）
//   1 = RED（≥1 处 naive sibling 解析）
//   2 = usage/env error（非法参数）
//   3 = NOT-EVALUATED（扫描面缺失 / 不可读——读不到输入 ≠ 无违规，硬规则 3b）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts \
//       [--root <dir>] [--json] [--no-block]
//     --no-block   REPORT-ONLY：仍打印违规清单但 exit 0（接 run_static_checks 的常驻路径，
//                  同 instrument-decay-check.ts 的 --no-block 手法）。默认（不带）fail-closed：
//                  有违规 exit 1。AC-225 criterion / 突变用例 / 单测都以默认 fail-closed 跑——
//                  ⛔ --no-block 只在 full-suite 常驻注册用，不能冒充「会红」的证明（AC-224 正文）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanKernelSurface as scanSurface } from "./fs-walk.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 默认受检面 = quay 仓库根（本脚本位于 <repo>/plugin/scripts/）。 */
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

/** 脚本文件扩展名（sibling 脚本的可运行形态）。 */
const SCRIPT_EXT = "(?:sh|ts|js|mjs|cjs)";

/** P1 — naive `__dirname`：`path.join(__dirname, "<name>.<ext>")` / `path.resolve(__dirname, "<name>.<ext>")`。
 *  第二参必须是字面量脚本文件名（`".."` 不是脚本名，自检工具的 repo-root 惯用法不命中）。 */
export const P1_NAIVE_DIRNAME_RE = new RegExp(
  `path\\.(join|resolve)\\(\\s*__dirname\\s*,\\s*["']([A-Za-z0-9_.-]+\\.${SCRIPT_EXT})["']`,
  "g",
);

/** P2 — target root：`path.join(<rootVar>, "plugin", "scripts", "<name>.<ext>")`。
 *  第一参是标识符（root/opts.root/REPO_ROOT/rootDir…），随后是字面量 "plugin"/"scripts"/脚本文件名。
 *  ⛔ 不匹配 `path.join("scripts", "x.sh")`（第一参是 "scripts"——那是 Core 解析器的 rel 形态，正确）。 */
export const P2_TARGET_ROOT_RE = new RegExp(
  `path\\.(join|resolve)\\(\\s*[A-Za-z_$][A-Za-z0-9_$]*\\s*,\\s*["']plugin["']\\s*,\\s*["']scripts["']\\s*,\\s*["']([A-Za-z0-9_.-]+\\.${SCRIPT_EXT})["']`,
  "g",
);

/** P3 — 模板字符串（插值后【紧邻】脚本路径；中间夹 prose 不算）。 */
export const P3_TEMPLATE_DIRNAME_RE = new RegExp(`\\$\\{__dirname\\}/[A-Za-z0-9_.-]+\\.${SCRIPT_EXT}`);
export const P3_TEMPLATE_ROOT_RE = new RegExp(
  `\\$\\{[A-Za-z_$][A-Za-z0-9_$]*\\}/plugin/scripts/[A-Za-z0-9_.-]+\\.${SCRIPT_EXT}`,
);

/** P4 — cross-package source anchor：`path.join(<rootExpr>, "packages", "<pkg>", "src", …)` 的多参
 *  形态。第一参是根表达式（裸标识符或调用形 `repoRoot()`），随后字面量 "packages"/包名/"src"，
 *  其后 ≥1 个字符串字面量段、末段是 `.ts` 模块名（组 2 = 末段文件名）。⛔ 只匹配 `.ts`（src 面），
 *  bin/ 布局锚点不在本条面内。⛔ 第一参只收单层调用（`foo()`），不收 `a.b.c()` 复合调用——
 *  缺陷实测形态是 `repoRoot()`/裸 root 变量，多段成员表达式另类。 */
export const P4_CROSS_PACKAGE_JOIN_RE = new RegExp(
  `path\\.(join|resolve)\\(\\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\\s*\\([^)]*\\))?\\s*,\\s*["']packages["']\\s*,\\s*["'][A-Za-z0-9_.-]+["']\\s*,\\s*["']src["']\\s*,\\s*(?:["'][^"']*["']\\s*,\\s*)*["']([A-Za-z0-9_.-]+\\.ts)["']`,
  "g",
);

/** P4 — cross-package source anchor：模板字面量 `` `${<rootExpr>}/packages/<pkg>/src/<…>.ts` ``。
 *  组 1 = `src/` 之后的 `.ts` 相对路径（可含子目录，末段即模块文件名）。 */
export const P4_TEMPLATE_CROSS_PACKAGE_RE = new RegExp(
  `\\$\\{[A-Za-z_$][A-Za-z0-9_$]*\\}/packages/[A-Za-z0-9_.-]+/src/((?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\\.ts)`,
);

/** DEV-TREE-ONLY 豁免标记（命中行或紧邻注释块携带即豁免，⛔ 带理由）。 */
export const DEV_TREE_ONLY_MARKER = "kernel-sibling-dev-tree-only";

// ── DRIVER-SCOPE 规则（gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root）─────────
// 为什么需要【第二条】规则，而不是把上面 P1–P4 的豁免收紧：P1–P4 判的是「naive sibling 解析」，
// 而 2026-09-13 在真实第三方项目 /home/yale/work/quay-fleet 上暴露的缺陷，是 driver 运行时把
// 【quay 自己的资源】（脚本 + 随包出厂的配置）锚在 `<workspaceRoot>/plugin|packages/…`——
// 其中 `plugin/scripts/drivers.yml`、`plugin/.claude-plugin/plugin.json` 这类**非脚本扩展名**的资源
// P2 的正则（要求末段是 `.<sh|ts|js|mjs|cjs>`）**结构上匹配不到**。
//
// 更要紧的是【豁免标记被误用】这一步（AC-225 的残差）：上面 P2/P4 允许 `kernel-sibling-dev-tree-only`
// 豁免，其前提是「本仓库自检工具读自己的 plugin/ 树」——**对第三方工作区常驻的 driver 不成立**
// （它们的 `--root` 是别人的项目）。于是一批生产 driver 的锚点被标记豁免，检查器恒绿，
// 而第三方项目上 driver 层实质不工作、且失效形态静默（进程 alive=1、载体持续在写）。
// ⇒ 本规则：DRIVER_SCOPE_FILES 内 **豁免标记无效**（⛔ 不是无理由收紧——是那个标记的成立前提在这些
//   文件上为假），且命中面扩到 P2 覆盖不到的配置类资源。
//
// 唯一合法落点 = 单一入口（driver-runtime.ts 的 resolveQuayCodeRoot / resolveQuaySrcModule）：
// 那里必须按布局拼出 `packages/quay/src` 或 `src`，否则就没有「一个地方知道布局」可言。

/** 第三方工作区【常驻 driver】及其共享 kernel 模块（`start-drivers.ts` 的 DRIVER_KINDS =
 *  promotion/worker/outer/goal——这些在 `quay-init` 后的第三方项目里跑，`--root` 是别人的项目）。
 *  ⛔ 不含 quality-gate-driver.ts / meta-driver.ts：它们不经 start-drivers 在第三方项目启动，
 *  且 meta-driver 头部自述 dev-tree-only（源树直跑、不经 bundle）。**它们是同族的已知残差，
 *  不在本规则覆盖面内——⛔ 不得据本规则为绿而认为该族已闭合**（硬规则 5b）。 */
export const DRIVER_SCOPE_FILES: readonly string[] = [
  "plugin/scripts/promotion-driver.ts",
  "plugin/scripts/worker-driver.ts",
  "plugin/scripts/outer-driver.ts",
  "plugin/scripts/goal-driver.ts",
  "plugin/scripts/driver-runtime.ts",
  "plugin/scripts/driver-filters.ts",
  "plugin/scripts/driver-shared.ts",
];

/** 单一入口所在的文件与函数名（⛔ 只有这几个函数体内允许出现 root 锚点拼法——布局知识必须存在于
 *  一个地方，而不是散在各个 driver 里）。`quaySrcModuleLegacyShape` 是同一个入口的 miss 半边
 *  （保证调用方的「读不懂 ⇒ not-evaluated」契约不变）。 */
export const DRIVER_ANCHOR_SINGLE_ENTRY = {
  file: "plugin/scripts/driver-runtime.ts",
  // ⚠️ 这是一个**枚举**，不是一个白名单：每加一条 = 「这个函数体内拼 `packages/…` 是**该布局的唯一落点**」。
  // gap-ac214-sixth-crossing-…（2026-09-17）加了 `resolveQuayKernelBuildScript`：内核 bundle 陈旧时
  // 要**机械重建**（跑源树自己的 `packages/quay/scripts/build-plugin-dist.mjs`），而这条布局知识必须
  // 与 `resolveQuayCodeRoot` 同处一文件——⛔ 不是在 driver-anchor.ts 里再拼一次（那会让「谁知道布局」
  // 变成两处，正是 DRIVER-SCOPE 规则存在的理由）。
  fns: ["resolveQuayCodeRoot", "resolveQuaySrcModule", "quaySrcModuleLegacyShape", "resolveQuayKernelBuildScript"],
} as const;

/** 检测面：`path.(join|resolve)(<rootExpr>, "plugin"|"packages", …)` —— 第一参是标识符或单层调用。
 *  收的是**任意**后续段（⛔ 不限脚本扩展名）：`drivers.yml` / `.claude-plugin` 这类随包出厂资源
 *  正是 P2 漏掉的那一半。 */
export const DRIVER_ROOT_ANCHOR_JOIN_RE = new RegExp(
  `path\\.(join|resolve)\\(\\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\\s*\\([^)]*\\))?\\s*,\\s*["'](plugin|packages)["']`,
  "g",
);

/** 检测面（模板字面量半边）：`` `${<rootExpr>}/plugin/` `` / `` `${<rootExpr>}/packages/` ``。 */
export const DRIVER_ROOT_ANCHOR_TEMPLATE_RE = /\$\{[A-Za-z_$][A-Za-z0-9_$]*\}\/(?:plugin|packages)\//;

/** 取第 index 个字符【所在的最内层顶层函数名】（最近一个列 0 的 `export function X` / `function X`）。
 *  单一入口放行靠它（⛔ 不靠行号白名单——行号会随无关编辑漂移）。 */
export function enclosingFunctionName(src: string, index: number): string | null {
  const head = src.slice(0, index);
  const re = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let name: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) name = m[1];
  return name;
}

export interface SiblingViolation {
  /** 拼接形态：naive-__dirname / target-root / template-string / cross-package / driver-root-anchor。 */
  form: "naive-__dirname" | "target-root" | "template-string" | "cross-package" | "driver-root-anchor";
  /** 命中的脚本文件名。 */
  script: string;
  /** 1-based 行号。 */
  line: number;
  /** 命中整行（trimmed）。 */
  snippet: string;
}

export interface SiblingCheckResult {
  ok: boolean;
  notEvaluated: boolean;
  surface: string[];
  violations: SiblingViolation[];
}

/**
 * 标记注释位置（单趟线性状态机）：行注释 `//`、块注释 `/* *​/`、以及 `#` 行注释（行首或空白后——
 * 与 concurrency-literal-check.ts buildMask 的 shell `#` 判据同语义，用于 runner-static-gate.ts 这个
 * bash 面披 .ts 名的 hub 文件；`this.#private` 前是 `.` 非空白，不会被误当注释）。
 * ⛔ 不标记字符串字面量——P1/P2 需要字符串可见（见头注释「为什么不屏蔽字符串」）。
 */
export function maskComments(src: string): Uint8Array {
  const comment = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      comment[i] = 1;
      comment[i + 1] = 1;
      i += 2;
      while (i < n && src[i] !== "\n") {
        comment[i] = 1;
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      comment[i] = 1;
      comment[i + 1] = 1;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        comment[i] = 1;
        i++;
      }
      if (i < n) {
        comment[i] = 1;
        comment[i + 1] = 1;
        i += 2;
      }
      continue;
    }
    if (c === "#") {
      const prev = i === 0 ? "\n" : src[i - 1];
      if (/\s/.test(prev)) {
        comment[i] = 1;
        i++;
        while (i < n && src[i] !== "\n") {
          comment[i] = 1;
          i++;
        }
        continue;
      }
    }
    i++;
  }
  return comment;
}

/** 取第 index 个字符所在的行号（1-based）。 */
function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** 取第 index 个字符所在整行的 trimmed 文本。 */
function snippetOf(src: string, index: number): string {
  let start = index;
  while (start > 0 && src[start - 1] !== "\n") start--;
  let end = index;
  while (end < src.length && src[end] !== "\n") end++;
  return src.slice(start, end).trim();
}

/** 模板字面量（backtick-delimited）的 body 及其起始 index。处理 `\\`` 转义；嵌套反引号按外层
 *  截断（线性状态机的已知上限——对 P3 足够，P3 的紧邻路径模式不会在截断后的碎片上命中）。 */
export function templateLiteralBodies(src: string): Array<{ start: number; body: string }> {
  const out: Array<{ start: number; body: string }> = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] !== "`") {
      i++;
      continue;
    }
    const start = i;
    i++;
    let body = "";
    while (i < n) {
      if (src[i] === "\\") {
        body += src[i];
        if (i + 1 < n) body += src[i + 1];
        i += 2;
        continue;
      }
      if (src[i] === "`") {
        i++;
        break;
      }
      body += src[i];
      i++;
    }
    out.push({ start, body });
  }
  return out;
}

/** 取命中行及其紧邻的注释块（跳过空行；遇代码行终止），用于 DEV-TREE-ONLY 豁免标记查找。 */
function declarationBlockLines(srcLines: string[], hitLineIdx: number): string[] {
  const block: string[] = [srcLines[hitLineIdx]];
  for (let i = hitLineIdx - 1; i >= 0; i--) {
    const t = srcLines[i].trim();
    if (t === "") continue;
    if (/^(\/\/|\*|#)/.test(t)) {
      block.push(srcLines[i]);
      continue;
    }
    break;
  }
  return block;
}

/** 从 P3 命中文本里取脚本文件名。 */
function scriptFromMatch(text: string): string {
  const m = text.match(new RegExp(`[A-Za-z0-9_.-]+\\.${SCRIPT_EXT}`));
  return m ? m[0] : "";
}

/**
 * 纯判定：给定源文本，返回 naive sibling 解析违例清单（空 = 合规）。
 * 按位置判定（硬规则 2）——只屏蔽注释；命中行/紧邻注释块带 DEV-TREE-ONLY 标记即豁免（带理由）。
 */
export function scanText(src: string): SiblingViolation[] {
  const comment = maskComments(src);
  const lines = src.split("\n");
  const violations: SiblingViolation[] = [];
  const isExempt = (lineIdx: number) => declarationBlockLines(lines, lineIdx).some((l) => l.includes(DEV_TREE_ONLY_MARKER));

  const push = (form: SiblingViolation["form"], script: string, index: number) => {
    if (!script) return;
    const lineIdx = lineOf(src, index) - 1;
    if (isExempt(lineIdx)) return;
    violations.push({ form, script, line: lineIdx + 1, snippet: snippetOf(src, index) });
  };

  // P1 — naive `__dirname`（在原始源上匹配，字符串可见；命中起点的 `path.` 必须是代码位置）。
  let m: RegExpExecArray | null;
  P1_NAIVE_DIRNAME_RE.lastIndex = 0;
  while ((m = P1_NAIVE_DIRNAME_RE.exec(src)) !== null) {
    if (comment[m.index] === 1) continue;
    push("naive-__dirname", m[2], m.index);
  }

  // P2 — target root（同：命中起点的 `path.` 必须是代码位置）。
  P2_TARGET_ROOT_RE.lastIndex = 0;
  while ((m = P2_TARGET_ROOT_RE.exec(src)) !== null) {
    if (comment[m.index] === 1) continue;
    push("target-root", m[2], m.index);
  }

  // P4 — cross-package join（`path.join(<root>, "packages", <pkg>, "src", …)`；同 P1/P2：命中起点的
  //  `path.` 必须是代码位置；组 2 = 末段 .ts 模块文件名）。
  P4_CROSS_PACKAGE_JOIN_RE.lastIndex = 0;
  while ((m = P4_CROSS_PACKAGE_JOIN_RE.exec(src)) !== null) {
    if (comment[m.index] === 1) continue;
    push("cross-package", m[2], m.index);
  }

  // P3 — 模板字符串（只在反引号跨度内匹配；开反引号须不是注释位置）。
  for (const { start, body } of templateLiteralBodies(src)) {
    if (comment[start] === 1) continue;
    const dm = body.match(P3_TEMPLATE_DIRNAME_RE);
    if (dm) {
      push("template-string", scriptFromMatch(dm[0]), start);
      continue;
    }
    const rm = body.match(P3_TEMPLATE_ROOT_RE);
    if (rm) push("template-string", scriptFromMatch(rm[0]), start);
  }

  // P4 — cross-package template（`${<root>}/packages/<pkg>/src/<…>.ts`；组 1 = src 之后的 .ts 相对路径，
  //  末段即模块文件名）。
  for (const { start, body } of templateLiteralBodies(src)) {
    if (comment[start] === 1) continue;
    const pm = body.match(P4_TEMPLATE_CROSS_PACKAGE_RE);
    if (pm) {
      const seg = pm[1].split("/");
      push("cross-package", seg[seg.length - 1], start);
    }
  }

  return violations.sort((a, b) => a.line - b.line);
}

/**
 * 纯判定（DRIVER-SCOPE）：给定【第三方常驻 driver 文件】的源文本，返回把 quay 自己的资源锚在
 * target root 上的违例。与 scanText 的三点差异（都写在头注释的 DRIVER-SCOPE 段）：
 *   ① 收任意后续段（含 drivers.yml / .claude-plugin 这类 P2 匹配不到的资源）；
 *   ② **不认 `kernel-sibling-dev-tree-only` 豁免**（该标记的成立前提在这些文件上为假）；
 *   ③ 唯一合法落点 = driver-runtime.ts 的 resolveQuayCodeRoot / resolveQuaySrcModule 函数体内。
 * 按位置判定（硬规则 2）：只屏蔽注释，⛔ 不屏蔽字符串。
 */
export function scanDriverRootAnchors(src: string, rel: string): SiblingViolation[] {
  const comment = maskComments(src);
  const allowed =
    rel === DRIVER_ANCHOR_SINGLE_ENTRY.file
      ? (index: number) => {
          const fn = enclosingFunctionName(src, index);
          return fn !== null && (DRIVER_ANCHOR_SINGLE_ENTRY.fns as readonly string[]).includes(fn);
        }
      : () => false;

  const out: SiblingViolation[] = [];
  const push = (index: number, snippet: string) => {
    if (comment[index] === 1) return;
    if (allowed(index)) return;
    out.push({ form: "driver-root-anchor", script: "(root anchor)", line: lineOf(src, index), snippet: snippetOf(src, index) });
  };

  let m: RegExpExecArray | null;
  DRIVER_ROOT_ANCHOR_JOIN_RE.lastIndex = 0;
  while ((m = DRIVER_ROOT_ANCHOR_JOIN_RE.exec(src)) !== null) push(m.index, m[0]);
  for (const { start, body } of templateLiteralBodies(src)) {
    if (DRIVER_ROOT_ANCHOR_TEMPLATE_RE.test(body)) push(start, body.trim().slice(0, 160));
  }
  return out.sort((a, b) => a.line - b.line);
}

/** rel 是否在 DRIVER-SCOPE 覆盖面内。 */
export function isDriverScopeFile(rel: string): boolean {
  return DRIVER_SCOPE_FILES.includes(rel);
}

/** 扫描面（可 grep 的枚举清单，非一个 glob 糊过去）：shipped kernel 代码 =
 *  plugin/scripts 顶层 *.ts/*.mjs/*.js（非递归——dist/、test/、checker-mutation-cases/ 子目录不含
 *  手写 shipped 脚本）+ packages/quay/src 递归 *.ts。
 *
 *  面表、skip 集与那三行 body 已移入 fs-walk.ts#KERNEL_SURFACE_SCAN_ROOTS / scanKernelSurface——
 *  本 checker 与 target-identity-literal-check.ts 的这两份是逐字相同的（.quay/routine-findings.jsonl
 *  finding `shell-scan-surface-family`）。面本身是一条决定，不是一个 checker 的私有细节。
 *  此处只保留 `scanSurface` 之名（re-export），本 checker 的公开面不变，⛔ 不再留一份可漂移的 body。 */
export { scanSurface };

/** 组合判定（含扫描面读取）。RED(1) > NOT-EVALUATED(3) > PASS(0)。 */
export function runCheck(root: string): SiblingCheckResult {
  const surface = scanSurface(root);
  if (surface.length === 0) {
    return { ok: true, notEvaluated: true, surface, violations: [] };
  }
  const violations: SiblingViolation[] = [];
  for (const rel of surface) {
    const abs = path.join(root, rel);
    let src: string;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue; // 并发删除（硬规则 6 缺值=未查，不崩溃整轮）
    }
    for (const v of scanText(src)) {
      violations.push({ ...v, snippet: `${rel}:${v.line} ${v.snippet}` });
    }
    // DRIVER-SCOPE：P2/P4 之外的第二条规则（收配置类资源 + 不认 dev-tree-only 豁免）。
    if (isDriverScopeFile(rel)) {
      for (const v of scanDriverRootAnchors(src, rel)) {
        violations.push({ ...v, snippet: `${rel}:${v.line} ${v.snippet}` });
      }
    }
  }
  return { ok: violations.length === 0, notEvaluated: false, surface, violations };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      `kernel-sibling-resolution-check.ts — KERNEL 域 naive sibling 解析检查器（GOAL-012 A 域）。
usage: node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts [--root <dir>] [--json] [--no-block]\n`,
    );
    return 0;
  }
  const root = path.resolve(parseArg(argv, "--root") ?? DEFAULT_ROOT);
  const json = argv.includes("--json");
  const noBlock = argv.includes("--no-block");
  const res = runCheck(root);

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ status: res.notEvaluated ? "not-evaluated" : res.ok ? "pass" : "fail", ok: res.ok, surface: res.surface, violations: res.violations, total: res.violations.length })}\n`,
    );
  } else if (res.notEvaluated) {
    process.stderr.write(`kernel-sibling-resolution-check: NOT-EVALUATED — no scannable surface under ${root}\n`);
  } else if (res.ok) {
    process.stdout.write(`kernel-sibling-resolution-check: PASS — ${res.surface.length} kernel file(s) scanned, 0 naive kernel resource resolution(s)\n`);
  } else if (noBlock) {
    process.stderr.write(`kernel-sibling-resolution-check: REPORT-ONLY (${res.violations.length} naive kernel resource resolution(s)) — not fail-closed\n`);
    for (const v of res.violations) process.stderr.write(`  - [${v.form}] ${v.script} @ ${v.snippet}\n`);
  } else {
    process.stderr.write(`kernel-sibling-resolution-check: RED (${res.violations.length} naive kernel resource resolution(s))\n`);
    for (const v of res.violations) process.stderr.write(`  - [${v.form}] ${v.script} @ ${v.snippet}\n`);
  }

  if (res.notEvaluated) return 3;
  if (noBlock) return 0; // REPORT-ONLY 常驻路径：打印违规但永不红当前套件（instrument-decay-check --no-block 同手法）
  return res.ok ? 0 : 1;
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// 入口判定 ⇒ 被 import 时就跑一整轮（goal-driver-task-boundary-check.ts 同款注释）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
