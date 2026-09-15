// target-identity-literal-check.ts — TARGET 域（GOAL-012 B 域）静态检查器：
// shipped kernel 把逐项目不同的「目标身份」写成无 override 通道的裸字面量（分支名 / test_command /
// tasks_dir），而不是从目标项目的 config / 运行时 git 状态派生。
//
// 回答的问题（capability-catalog QUESTION）：
//   shipped kernel 代码（plugin/scripts/*.{ts,mjs,js} + packages/quay/src/**/*.ts）里，是否存在把
//   逐项目不同的身份（分支名 / `test_command` / `tasks_dir`）写成「无 override 通道的裸字面量」的处所？
//   ——即 GOAL-012 退出条件①⑤的 B 域落点（「人工枚举 3 次 3 漏」被机械枚举取代）。
//
// 判别标准（写进实现，⛔ 不留给读者意会——AC-226 正文）：
//   TARGET 域违例 = 该字面量【逐项目不同】∧【无 override 通道】。
//   · 逐项目不同：分支名（非协议固定的 ref）、`test_command`（每个项目跑自己的测试命令）、
//     `tasks_dir`（每个项目可经 QUAY_NATIVE_TASKS_DIR 选不同目录）——三者的字面量都是「这个项目
//     恰好如此」，换一个目标项目就错。
//   · 无 override 通道：RHS 是「裸的字符串字面量」——`IDENT = "value"` / `KEY: "value"` 且 RHS
//     就只是一个引号字面量，⛔ 不是 `getArgValue(...) ?? "x"` / `opts.x ?? "x"` / `process.env.X`
//     / 函数调用 / `path.join(...)` 这类有派生来源的形态。
//
// 合法默认值（逐项目不变，检查器不得误报——AC-226 负控制方向之一）：
//   `develop` / `integration` / `master` 是协议固定的 git ref（有 CLI 覆盖且 quay-init 为每个项目
//   建这些分支）；`HEAD` 是 git 协议符号 ref；`tasks` 是 quay 协议固定的任务目录名（`tasks/*.md`
//   ARE the data）。这些值对每个项目都成立 ⇒ 不是「逐项目不同」⇒ 合法。`"author"` 是本仓库自己的
//   doc 工作分支命名约定（⛔ 非协议固定部分）⇒ 逐项目不同 ⇒ 违例（本条立条时的唯一残量
//   `driver-filters.ts` 的 `DOC_BRANCH = "author"`）。
//
// 判定（能取假，硬规则 3/4）——按位置判定（硬规则 2）：命中的【标识符/键名起点】必须落在代码位置
// （buildNonCodeMask 屏蔽注释/字符串/正则——`"    tasks_dir: \"./tasks\""` 这种写在字符串里的
// 配置模板不算代码，不报；注释里拼写 `const DOC_BRANCH = "author"` 也不报）。
//   位置形态三选一（GOAL-012 风险 4：三种身份各一例，⛔ 不止一种）：
//     branch       — `const/let/var <*branch*> = "<值>"` 或 `<*branch*>: "<值>"`，值非合法 ref。
//     test-command — `const/let/var <*test_command*> = "<值>"` 或 `test_command: "<值>"`。
//     tasks-dir    — `const/let/var <*tasks_dir*> = "<值>"` 或 `tasks_dir: "<值>"`，值非 `tasks`。
//
// 退出码（checker-mechanical-spine-check.ts 词表 {0,1,2,3}）：
//   0 = PASS（violations 0 处；或 --no-block 时 REPORT-ONLY——报告但不红）
//   1 = RED（≥1 处无 override 裸身份字面量）
//   2 = usage/env error（非法参数）
//   3 = NOT-EVALUATED（扫描面缺失 / 不可读——读不到输入 ≠ 无违规，硬规则 3b）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/target-identity-literal-check.ts \
//       [--root <dir>] [--json] [--no-block]
//     --no-block   REPORT-ONLY：仍打印违规清单但 exit 0（接 run_static_checks 的常驻路径，
//                  同 instrument-decay-check.ts 的 --no-block 手法）。默认（不带）fail-closed：
//                  有违规 exit 1。AC-226 criterion / 突变用例 / 单测都以默认 fail-closed 跑——
//                  ⛔ --no-block 只在 full-suite 常驻注册用，不能冒充「会红」的证明。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNonCodeMask } from "./checker-lib.ts";
import { scanKernelSurface } from "./fs-walk.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 默认受检面 = quay 仓库根（本脚本位于 <repo>/plugin/scripts/）。 */
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

/** 合法身份默认值（逐项目不变——协议固定的 git ref + 协议固定的任务目录名）。值规范化后（trim + 去
 *  前导 `./`）逐 token 判定；`tasks` 覆盖 `tasks_dir` 的默认目录名，`develop/integration/master` 覆盖
 *  分支名，`HEAD` 覆盖符号 ref。⛔ `author` 不在此表——它是本仓库的 doc 分支命名约定，逐项目不同。 */
export const LEGAL_IDENTITY_VALUES = new Set(["develop", "integration", "master", "HEAD", "tasks"]);

/** 身份类别（逐项目不同的三种目标身份）。 */
export type IdentityKind = "branch" | "test-command" | "tasks-dir";

export interface IdentityViolation {
  /** 身份类别：分支名 / test_command / tasks_dir。 */
  kind: IdentityKind;
  /** 命中标识符 / 键名。 */
  name: string;
  /** 命中的裸字面量值（已去引号）。 */
  value: string;
  /** 1-based 行号。 */
  line: number;
  /** 命中整行（trimmed）。 */
  snippet: string;
}

export interface IdentityCheckResult {
  ok: boolean;
  notEvaluated: boolean;
  surface: string[];
  violations: IdentityViolation[];
}

/** 规范化标识符/键名：小写 + 去 `_`/`-`——`DOC_BRANCH`→`docbranch`、`test_command`→`testcommand`、
 *  `tasks_dir`→`tasksdir`，让同一身份的不同拼写收敛到同一判据。 */
export function normIdent(id: string): string {
  return id.toLowerCase().replace(/[_-]/g, "");
}

/** 身份类别判定（按标识符/键名的语义信号——位置判定，⛔ 不按值的关键词嗅探）。 */
export function classifyIdent(norm: string): IdentityKind | null {
  if (norm.includes("branch") || norm.includes("mergetarget") || norm.includes("mainline")) return "branch";
  if (norm.includes("testcommand")) return "test-command";
  if (norm.includes("tasksdir")) return "tasks-dir";
  return null;
}

/** 值规范化：trim + 去前导 `./`（`"./tasks"` → `tasks`）。 */
function normalizeValue(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

/** 值是否是合法默认值（逐项目不变）。值按空白/逗号拆 token，每个 token 都必须是合法值——
 *  `"develop integration"` 这种「合法值的列表」不算逐项目不同。 */
export function isLegalDefault(value: string): boolean {
  const tokens = normalizeValue(value)
    .split(/[\s,]+/)
    .filter((t) => t !== "");
  if (tokens.length === 0) return false;
  return tokens.every((t) => LEGAL_IDENTITY_VALUES.has(t));
}

/** 标识符形态：`(export )?(const|let|var) IDENT = "value"`。RHS 必须是裸引号字面量（无 `??`/`||`/
 *  函数调用——那些是 override 通道，⛔ 不是本条的「无 override 裸字面量」）。 */
const ASSIGN_RE = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(["'])([^"']*)\2/g;

/** 对象键形态：`KEY: "value"`（config 键名 `tasks_dir`/`test_command` 的裸字面量写法）。 */
const KEY_RE = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(["'])([^"']*)\2/g;

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

/**
 * 纯判定：给定源文本，返回无 override 裸身份字面量违例清单（空 = 合规）。
 * 按位置判定（硬规则 2）：命中的【标识符/键名起点】必须是代码位置（字符串里的配置模板 / 注释里的拼写
 * 不报）；RHS 是裸引号字面量（override 通道形态不报）；值非合法默认值（develop/integration/master/HEAD/
 * tasks 不报）。
 */
export function scanText(src: string): IdentityViolation[] {
  const mask = buildNonCodeMask(src);
  const lines = src.split("\n");
  const violations: IdentityViolation[] = [];

  const push = (kind: IdentityKind, name: string, value: string, index: number) => {
    if (value.trim() === "") return; // 空默认值不是身份
    if (isLegalDefault(value)) return; // 合法默认值（逐项目不变）不报
    const lineIdx = lineOf(src, index) - 1;
    violations.push({ kind, name, value, line: lineIdx + 1, snippet: lines[lineIdx].trim().slice(0, 120) });
  };

  const classify = (name: string, value: string, index: number) => {
    const kind = classifyIdent(normIdent(name));
    if (kind === null) return; // 非 TARGET 身份键名 → 忽略
    push(kind, name, value, index);
  };

  // 标识符形态：const/let/var IDENT = "value"（命中起点的 const/export 必须是代码位置）。
  let m: RegExpExecArray | null;
  ASSIGN_RE.lastIndex = 0;
  while ((m = ASSIGN_RE.exec(src)) !== null) {
    if (mask[m.index] === 1) continue;
    classify(m[1], m[3], m.index);
  }

  // 对象键形态：KEY: "value"（键名起点必须是代码位置）。
  KEY_RE.lastIndex = 0;
  while ((m = KEY_RE.exec(src)) !== null) {
    if (mask[m.index] === 1) continue;
    classify(m[1], m[3], m.index);
  }

  return violations.sort((a, b) => a.line - b.line);
}

/** 扫描面（可 grep 的枚举清单，非一个 glob 糊过去）：shipped kernel 代码 =
 *  plugin/scripts 顶层 *.ts/*.mjs/*.js（非递归——dist/、test/、checker-mutation-cases/ 子目录不含
 *  手写 shipped 脚本）+ packages/quay/src 递归 *.ts。与 KERNEL 域（kernel-sibling-resolution-check）
 *  同面——域检查器共扫同一 shipped kernel 面，⛔ 不各自 glob。
 *
 *  该面表、skip 集与那三行 body 已移入 fs-walk.ts#KERNEL_SURFACE_SCAN_ROOTS / scanKernelSurface：
 *  两份原本逐字相同（.quay/routine-findings.jsonl finding `shell-scan-surface-family`），
 *  而「同面」若各写一份，正是它们会漂移的形态。 */
export function scanSurface(root: string): string[] {
  return scanKernelSurface(root);
}

/** 组合判定（含扫描面读取）。RED(1) > NOT-EVALUATED(3) > PASS(0)。 */
export function runCheck(root: string): IdentityCheckResult {
  const surface = scanSurface(root);
  if (surface.length === 0) {
    return { ok: true, notEvaluated: true, surface, violations: [] };
  }
  const violations: IdentityViolation[] = [];
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
      `target-identity-literal-check.ts — TARGET 域无 override 裸身份字面量检查器（GOAL-012 B 域）。
usage: node --no-warnings --experimental-strip-types plugin/scripts/target-identity-literal-check.ts [--root <dir>] [--json] [--no-block]\n`,
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
    process.stderr.write(`target-identity-literal-check: NOT-EVALUATED — no scannable surface under ${root}\n`);
  } else if (res.ok) {
    process.stdout.write(`target-identity-literal-check: PASS — ${res.surface.length} kernel file(s) scanned, 0 override-less identity literal(s)\n`);
  } else if (noBlock) {
    process.stderr.write(`target-identity-literal-check: REPORT-ONLY (${res.violations.length} override-less identity literal(s)) — not fail-closed\n`);
    for (const v of res.violations) process.stderr.write(`  - [${v.kind}] ${v.name} = ${JSON.stringify(v.value)} @ ${v.snippet}\n`);
  } else {
    process.stderr.write(`target-identity-literal-check: RED (${res.violations.length} override-less identity literal(s))\n`);
    for (const v of res.violations) process.stderr.write(`  - [${v.kind}] ${v.name} = ${JSON.stringify(v.value)} @ ${v.snippet}\n`);
  }

  if (res.notEvaluated) return 3;
  if (noBlock) return 0; // REPORT-ONLY 常驻路径：打印违规但永不红当前套件（instrument-decay-check --no-block 同手法）
  return res.ok ? 0 : 1;
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// 入口判定 ⇒ 被 import 时就跑一整轮（kernel-sibling-resolution-check.ts 同款注释）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
