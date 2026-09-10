// kernel-sibling-resolution-check.ts — KERNEL 域（GOAL-012 A 域）静态检查器：
// shipped kernel 把自己的 sibling 脚本（同住 plugin/scripts/ 的 .sh/.ts/.mjs 机件）锚在
// target root / naive `__dirname` / 模板字符串形态、而非经 driver-runtime.ts 的
// `resolveKernelSibling` / `resolveKernelPluginRoot`（⛔ 不是 packages/quay/src/plugin-root.ts 的
// Core 解析器——那一个解析的是 plugin/ 树，这一个解析的是 kernel 自己的 sibling，两者不同）。
//
// 回答的问题（capability-catalog QUESTION）：
//   shipped kernel 代码（plugin/scripts/*.{ts,mjs,js} + packages/quay/src/**/*.ts）里，是否存在把
//   自己的 sibling 脚本锚在 naive `__dirname` / target root / 模板字符串拼接处、而非经
//   `resolveKernelSibling`/`resolveKernelPluginRoot` 的调用点？——即 GOAL-012 退出条件①的 A 域
//   「手工枚举 3 次 3 漏」被机械枚举取代的落点。AC-203 前例：`cli/driver.ts` 曾用
//   `path.join(<workspace root>, "plugin/scripts/driver-runtime.ts")` 解析 kernel，quay-init 取消
//   plugin/ 拷贝后每个第三方项目都死于 "kernel not found"。
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

/** DEV-TREE-ONLY 豁免标记（命中行或紧邻注释块携带即豁免，⛔ 带理由）。 */
export const DEV_TREE_ONLY_MARKER = "kernel-sibling-dev-tree-only";

export interface SiblingViolation {
  /** 拼接形态：naive-__dirname / target-root / template-string。 */
  form: "naive-__dirname" | "target-root" | "template-string";
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

  return violations.sort((a, b) => a.line - b.line);
}

/** 扫描面（可 grep 的枚举清单，非一个 glob 糊过去）：shipped kernel 代码 =
 *  plugin/scripts 顶层 *.ts/*.mjs/*.js（非递归——dist/、test/、checker-mutation-cases/ 子目录不含
 *  手写 shipped 脚本）+ packages/quay/src 递归 *.ts。 */
const SCAN_ROOTS: Array<{ dir: string; rel: string; ext: RegExp; recursive: boolean }> = [
  { dir: "plugin/scripts", rel: "plugin/scripts", ext: /\.(ts|mjs|js)$/, recursive: false },
  { dir: "packages/quay/src", rel: "packages/quay/src", ext: /\.ts$/, recursive: true },
];

export function scanSurface(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, base: string, ext: RegExp, recursive: boolean) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      const s = fs.statSync(abs);
      if (s.isDirectory()) {
        if (!recursive) continue;
        if (f === "node_modules" || f === ".git" || f === "test" || f === "dist" || f === "ts-demo") continue;
        walk(abs, path.join(base, f), ext, recursive);
      } else if (ext.test(f)) {
        out.push(path.join(base, f));
      }
    }
  };
  for (const { dir, rel, ext, recursive } of SCAN_ROOTS) walk(path.join(root, dir), rel, ext, recursive);
  return out.sort();
}

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
    process.stdout.write(`kernel-sibling-resolution-check: PASS — ${res.surface.length} kernel file(s) scanned, 0 naive sibling resolution(s)\n`);
  } else if (noBlock) {
    process.stderr.write(`kernel-sibling-resolution-check: REPORT-ONLY (${res.violations.length} naive sibling resolution(s)) — not fail-closed\n`);
    for (const v of res.violations) process.stderr.write(`  - [${v.form}] ${v.script} @ ${v.snippet}\n`);
  } else {
    process.stderr.write(`kernel-sibling-resolution-check: RED (${res.violations.length} naive sibling resolution(s))\n`);
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
