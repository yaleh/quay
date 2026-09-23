#!/usr/bin/env node
// identity-replication-check.ts — P2 身份复制检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P2).
// 同一个运行时实体被【独立命名 / 独立判定】的次数, 两个子度量:
//   (a) 字面量复制度: 含 X 路径/basename/env 名/CLI flag 的【代码】文件数, 且未经由单一访问器
//       (import/require/source)。位置分两层: ①代码 / 注释 / 文档 —— 注释与 .md 文档不算;
//       ②**出现角色** (gap-identity-hardcoded-needs-occurrence-role-filter) —— 代码位置里还要再分
//       「命名点」与「叙述」: 字符串字面量是代码级引用, 但**把一个实体的名字写进一段叙述文本、
//       断言消息、test 标题或错误消息, 不是独立命名它**。判据 = 该出现处所在字面量的内容是否
//       **恰为实体名**(身份值) 而非嵌在更长的文本里; 未被引号包裹的裸名则只在**名字清单**
//       (邻词也是脚本名) 或赋值右侧才算。⛔ 反向边界: `NEVER_LAYDOWN="quay-init.sh"` 这类
//       **把裸 basename 赋成身份值**的位点仍是证据 —— 收窄不得把检测器砍空。
//       单一访问器认【三族】形态, 全在 accessorRegexSource() 一处: ①import/require ②source <内联路径
//       (引号可嵌套): source "$(dirname "$0")/x.sh" ③先赋值路径到变量、再 source 该变量 (本仓 .sh
//       的主流形态: _lib="$(dirname "${BASH_SOURCE[0]}")/x.sh"; … . "$_lib")。②③ 缺席曾使
//       gate-script-lib.sh 的 67 个正当引用被逐个计成 hardcoded=82/accessor=0
//       (gap-identity-accessor-regex-source-computed-path)。
//   (b) 判定重写数: 按「读取的外部事实集合」给代码块建指纹 (例: 读 /proc/<pid>/cmdline ∧ 比较名字
//       = 识别某进程), 同指纹的多处独立实现计数为判定重写。
// 另报: 路径字面量常量 (产品源码硬编码 ../../../plugin/scripts/* 的 *_REL 常量, import 图上不可见)、
//   plugin/scripts ↔ experiments/*/scripts 字节完全相同文件对 (只计【两侧都是常规文件】的同名对——
//   任一侧是软链就是单一来源引用/同一 inode, 逐字节比对等于文件和自己比, 不是「复制替代抽象」的证据;
//   规则与 mirror-pair-drift-check.ts 取同一判定)、以及共享模块负控制 (gate-script-base.ts
//   经单一 import 访问器被引用, 不得报高复制度)。
//
// 每个计数都内建「打印命中样本」纪律 (docs 附录 A): 报一个计数时同时报出它匹配到的前若干条实际内容,
// 计数为 0 时把谓词对着已知为真的样本干跑一次 (脚本自身对 session-liveness.sh 已退休这一事实给负控制)。
//
// Usage:
//   node --experimental-strip-types identity-replication-check.ts [--root <dir>] [--json] [--limit <n>]
//   --root <dir>    repo to scan (default: repo-root.ts resolution)
//   --limit <n>     max rows in the human literal-replication table (default 25)
//   --json          emit the full report as JSON
//   --help          usage, exit 0
// Exit: 0 = report produced (this is an observer, not a pass/fail gate); 2 = usage/environment error.

import fs from "node:fs";
import path from "node:path";
// argValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";
import { walkFiles } from "./fs-walk.ts";
// The single regex-literal escaper (kernel leaf reached via the plugin shim); `escapeRegex` is the
// name this file's call sites already use. Own copy was one of the twelve byte-identical bodies
// extracted by gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.
import { escapeRegExp as escapeRegex } from "./regex-escape.ts";
// lineOf 上收到 source-text-lib.ts (semantic-dedup-scan `lineof-lineat`); 本地 `relOf` 包装
// (body 恰为 `path.relative(root, f)`) 已就地内联 —— 一行 stdlib 委托没有可抽的算法。
import { lineOf } from "./source-text-lib.ts";

// ── 位置掩码 (comment-only: 只标注释为非代码, 字符串/模板字面量保持代码) ─────────────────────
// 与 checker-lib.ts 的 buildNonCodeMask 不同: 那个把字符串也标为非代码 (用于「命令位置」判定);
// 本任务要测的是【字面量】复制度 — 字符串字面量正是被测对象, 必须算代码。注释与文档才剔除。

/** `/` 处是否可能是【正则字面量】的开头 —— ECMAScript 的除法/正则歧义。
 *  只回看前一个【有效】字符 (跳过空格与 tab, ⛔ **不跳换行**: 换行意味着上一语句已结束, 行首的
 *  `/` 是新表达式而非除法的延续): 标识符字符 / 数字 / `)` / `]` / `}` / 引号 / 反引号 ⇒ 是除法;
 *  其余 (`(`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `+`, `-`, `*`, `%`, `~`, `^`, `<`, `>`, `;`, `{`, `,`) ⇒ 可能是正则。
 *  关键字例外补上 `return /re/.test(x)` 一族。 */
function maybeRegexStart(src: string, i: number): boolean {
  let p = i - 1;
  while (p >= 0 && (src[p] === " " || src[p] === "\t")) p--;
  const prev = p < 0 ? "\n" : src[p];
  if (!/[A-Za-z0-9_$)\]}"'`]/.test(prev)) return true;
  return /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/.test(
    src.slice(0, i),
  );
}

/** 正则字面量的闭合位置 (闭合 `/` 之后的下标), 或 -1 = **不是**正则字面量。
 *  ⛔ 同行护栏是本函数的关键: ECMAScript 的正则字面量**不含行终止符**, 所以「同一行找不到未转义、
 *  不在 `[…]` 字符类内的 `/`」就说明判错了 ⇒ 退回普通字符。没有这条护栏, 一次误判会跨行吞掉后面的代码。
 *
 *  这段存在的理由 (本任务 AC3 的实测根因): 旧掩码不认识正则字面量, 于是
 *  `list.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))` 里的引号被当成**字符串起点**,
 *  打开一个跨行的「幻影字符串」; 后面的块注释 (斜杠星号 … 星号斜杠) 与 `//` 行注释因此全部落在
 *  字符串态里, 位置掩码把它们标成【代码】—— `plugin/scripts/task-ops.ts:158` 的 `ready-pool-check.ts`
 *  (块注释内) 就是这样被计进 `codeFiles` 的。四个 AC3 实例文件的首次掩码分叉点**逐一无例外**落在
 *  一个含引号的正则字面量上 (task-ops.ts:97、strategic-doc-staleness-check.ts、
 *  touches-orthogonality-check.ts 的 `match(/^role:\s*["']?…/)`、build-plugin-dist.mjs 的
 *  `dirname \"\$0\"` 正则), 不是「疑似反引号让词法器失步」那类假说。 */
function regexLiteralEnd(src: string, i: number): number {
  if (!maybeRegexStart(src, i)) return -1;
  let j = i + 1;
  let inClass = false;
  while (j < src.length && src[j] !== "\n") {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "[") { inClass = true; j++; continue; }
    if (c === "]") { inClass = false; j++; continue; }
    if (c === "/" && !inClass) return j + 1;
    j++;
  }
  return -1;
}

// .ts/.mjs/.js 注释掩码: 标 // 行注释与 /* */ 块注释为非代码; 字符串/模板/正则保持代码。
export function tsCommentMask(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && d === "/") {
      mask[i] = 1; mask[i + 1] = 1; i += 2;
      while (i < n && src[i] !== "\n") { mask[i] = 1; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      mask[i] = 1; mask[i + 1] = 1; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { mask[i] = 1; i++; }
      if (i < n) { mask[i] = 1; mask[i + 1] = 1; i += 2; }
      continue;
    }
    if (c === "/") {
      // 正则字面量: 其**内部**的引号不是字符串起点 (旧实现漏了一步 ⇒ 幻影字符串, 见 regexLiteralEnd)。
      const end = regexLiteralEnd(src, i);
      if (end !== -1) { i = end; continue; }
    }
    i++;
  }
  return mask;
}

/** 注释位置替换为**空格**、其余原样 —— 长度、行号、其余每个字符都与 `src` 逐位一致。
 *
 *  用途: 让**结构性关系**的判定正则跑在「注释已被抹平」的视图上。理由是把注释语法从正则里拿掉:
 *  旧 import 分支写成 `import\s+[^'"\n]*?from\s*["']` —— `[^'"\n]` 既**排除换行**(多行命名导入读不进去)
 *  又**排除引号**(为了不跨字符串)。两条约束一叠加, 它连"注释里有撇号"的多行导入块都跨不过去
 *  (本仓主流形态, `plugin/scripts/slot-refill.ts` 的 30+ 行导入块)。抹平注释后,**唯一**还需要在正则里
 *  表达的约束只剩「不跨字符串」(`"`/`'`) 与「不跨语句边界」(`;`) —— 这是真结构, 不是行内锚点。
 *  ⛔ 字符串**不**抹平: 抹平它等于让正则读不到 specifier, 也就把 accessor 判定关掉了。 */
export function blankComments(src: string, mask: Uint8Array): string {
  if (!mask.some((m) => m === 1)) return src; // 无注释 ⇒ 原样返回, 不复制
  const parts: string[] = [];
  let i = 0;
  while (i < src.length) {
    let j = i;
    if (mask[i] === 1) {
      while (j < src.length && mask[j] === 1) j++;
      parts.push(" ".repeat(j - i));
    } else {
      while (j < src.length && mask[j] !== 1) j++;
      parts.push(src.slice(i, j));
    }
    i = j;
  }
  return parts.join("");
}

// .sh 注释掩码: 标 # 行注释为非代码 (单/双引号字符串保持代码; # 在字符串内不误标)。
export function shCommentMask(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'") {
      i++;
      while (i < n) { if (src[i] === "'") { i++; break; } i++; }
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "#") {
      while (i < n && src[i] !== "\n") { mask[i] = 1; i++; }
      continue;
    }
    i++;
  }
  return mask;
}

function maskFor(f: string): (src: string) => Uint8Array {
  return f.endsWith(".sh") ? shCommentMask : tsCommentMask;
}

// ── 枚举 ─────────────────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", "vendor", "fixture", ".git", ".quay", "dist", "coverage"]);
const CODE_EXTS = new Set([".ts", ".sh", ".mjs", ".js"]);

/** 跳过的【构建产物树】——点名的不是 basename 而是【仓内相对路径前缀】。
 *  `packages/quay/plugin/` 是 `package.sh` 在 `npm pack` 前把仓根 `plugin/` 整体**暂存**出来的快照
 *  (`.gitignore:26`；`git ls-files packages/quay/plugin` = 0 条，411 个常规文件 / 0 个软链)：它与
 *  `plugin/` 是同一批文件的**第二份拷贝**，枚举它等于把每个实体数两遍，直接抬高 `code`/`hardcoded`
 *  (实测：`table[].codeFiles` 并集 729 个里有 **82** 个落在此前缀下)。
 *  ⛔ 为什么不写进 SKIP_DIRS：`walkFiles` 的 `prune` 只拿到 **basename**，而 `plugin` 同时是四个扫描根
 *  之一（prune 对根本身不生效，但一个**全局**裸名 `plugin` 会连带剪掉**任何**叫 plugin 的目录）；
 *  名字面比要表达的面宽 ⇒ 静默过度剪枝，正是硬规则 3b 的形态。按路径前缀表达才是这个谓词本身
 *  (gap-arch-review-cluster-ignores-detector-flag-predicate 成因二)。 */
const SKIP_REL_PREFIXES = ["packages/quay/plugin/"];

/** 递归枚举 root 下 plugin/packages/experiments/scripts 的代码文件 (跳过 vendor/dist/fixture/node_modules
 *  与构建产物树 SKIP_REL_PREFIXES)。遍历用 fs-walk.ts；skip 集与扩展名集仍是本检查器自己的。 */
export function walkCodeFiles(root: string): string[] {
  const roots = ["plugin", "packages", "experiments", "scripts"].map((d) => path.join(root, d));
  const out = roots.flatMap((r) =>
    walkFiles(r, {
      absolute: true,
      prune: (name) => SKIP_DIRS.has(name),
      include: (name, ext) => CODE_EXTS.has(ext),
    }),
  );
  return out
    .filter((f) => {
      const rel = path.relative(root, f).split(path.sep).join("/");
      return !SKIP_REL_PREFIXES.some((p) => rel.startsWith(p));
    })
    .sort();
}

/** 正则命中且命中【起点】落在代码位置 (mask[start] === 0)。 */
function codeMatch(src: string, mask: Uint8Array, re: RegExp): { line: number; match: string }[] {
  const g = new RegExp(re.source, "g");
  const hits: { line: number; match: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(src)) !== null) {
    if (mask[m.index] === 0) hits.push({ line: lineOf(src, m.index), match: m[0] });
    if (m[0].length === 0) g.lastIndex++;
  }
  return hits;
}

// ── 单一访问器正则 ───────────────────────────────────────────────────────────────────────────
// 【一处定义, 两处使用】literalReplication() 与 replicationTable() 曾经各持这份正则的一份【逐字副本】
// (gap-identity-accessor-regex-source-computed-path): 两份副本既让同一缺陷要修两遍, 又允许两条路径
// 悄悄分叉。现在只有 accessorRegexSource() 这一份, 分叉在结构上不可能 (AC4)。

/** shell 路径表达式片段 —— 允许内部出现【成对引号】, 但【不跨注释】。
 *  `source "$(dirname "$0")/gate-script-lib.sh"` 的引号是嵌套的: 旧的 `[^"'\n]*?` 在内层第一个 `"`
 *  处必然失败 ⇒ 本仓 6 个直接引用文件被逐个计成 hardcoded。
 *  ⛔ 两个方向都不能过: 简单放宽成 `[^\n]*?` 会让 `. "$CONF" # loads x.sh` 这种【行尾注释里的提及】
 *  也算成 accessor (匹配起点是行首的 `.`, 落在代码位置, 位置掩码拦不住) —— 等于把
 *  `isFlagged` 的评判 (硬编码数须达到阈值且多于访问器数) 架空, 即把检测器关掉。
 *  ⛔ 此处刻意不逐字写出谓词: 本文件上「阈值谓词有几个实现」的机械读数是一条裸 grep (AC6),
 *  注释里再写一遍会让它把**文档**算成第二个实现 (硬规则 2: 按位置判定, 注释不是代码位置)。
 *  仅要求引号成对【也】不够: 那样 `. "$CONF" # loads x.sh` 会被读成「引号段 "$CONF" + 后面的路径」。
 *  故未加引号的片段额外排除 `#` (shell 里词首的 `#` 开注释; 引号段内的 `#` 不受影响)。
 *  两条合起来才同时做到「读得懂嵌套引号」与「不吞掉行尾注释」。 */
const PATH_EXPR = `(?:[^\\n"'#]|"[^"\\n]*"|'[^'\\n]*')*?`;

/** source / `.` 的【命令位置】前缀: 行首, 或紧跟 `;` `&` `|` `{` 换行; 之后再可选一个 shell 关键字。
 *  关键字必须在真命令位【之后】—— 61 个 idiom-B 文件的实际形态是 `]; then . "$_gap_help_lib"` 一行,
 *  所以关键字是不可省的一半; 而 `#` 不是命令位锚点, 纯注释行因此不会被误判成 accessor。 */
const SOURCE_CMD = `(?:^|[;&|{\\n])\\s*(?:then\\s+|do\\s+|else\\s+)?(?:\\.|source)\\s+`;

/** 变量赋值锚点 (行首 / 命令位之后)。 */
const ASSIGN_ANCHOR = `(?:^|[;&|{\\n])\\s*`;

/** 赋值语句与随后的 `source <变量>` 之间允许的最大距离 (字符)。 */
const ACCESSOR_VAR_WINDOW = 2000;

/** 命名导入 / 再导出**子句**的字符集 —— 子句里只可能出现 标识符 / 空白 / 花括号 / 逗号 / `*`
 *  (`import defaultExport, { a as b } from …` 是它的上界, 见 accessorRegexSource 的注释)。
 *  ⛔ 引号与 `;` **不在**其中 —— 这两条排除正是「不跨字符串 ∧ 不跨语句边界」两条真结构约束的载体。 */
const CLAUSE = `[\\w$\\s{}*,]*?`;

/** 单一访问器正则【源】—— 三个族:
 *  ① `import … from "…"` / `export … from "…"` / `import "…"` / `import("…")` / `require("…")`  (TS/JS 模块访问器)
 *  ② `source <.路径表达式>` / `. <.路径表达式>`        (shell 内联路径, 引号可嵌套)
 *  ③ `VAR="<.路径表达式>"` … `. "$VAR"` / `source "${VAR}"`  (shell 先赋值路径、后 source 变量,
 *     本仓 61 个 .sh 的主流形态 —— 单份正则做不到, 故用 \\1 反向引用把两半绑在同一个变量名上)
 *  调用方统一 `new RegExp(accessorRegexSource(stem))`; 两条读数路径共用它 ⇒ 不可能分叉。
 *
 *  ⛔ ① 的子句**允许跨行**, 但「跨到哪里为止」由 CLAUSE 这个**结构字符集**表达, 不是行内锚点:
 *    · 旧写法 `import\s+[^'"\n]*?from\s*["']` 里的 `[^'"\n]` 把换行也排除了, 于是本仓**主流**的
 *      多行命名导入 (`import {\n  a,\n  b,\n} from "./x.ts"`, 以及 `plugin/scripts/slot-refill.ts`
 *      那种 30+ 行、内部夹注释的导入块) 整族读成 hardcoded —— 与「没有复制」同形 (硬规则 3b)。
 *    · CLAUSE 读得进换行、花括号与注释(调用方已用 `blankComments()` 抹平注释), 但**读不进引号**:
 *      每个 import 语句里都至少有一个带引号的 specifier 挡在中间 ⇒ 它绝不吞掉【另一个】import 的
 *      specifier (惰性匹配在那里必然失败并回溯)。
 *    · `(?<![\w$.])from` 是最后一道: 子句惰性截断在词中间时 (`trans|from`), 这个 `from` 不算数。
 *  ⛔ 仍不接 `export function … {}` 这种形态: `from` 只认【re-export】(`export {…} from` /
 *    `export * [as ns] from` / `export type {…} from`), 否则一个普通 export 声明会一路扫到下一个
 *    真 import 的 `from` (那里没有引号拦着)。 */
export function accessorRegexSource(stem: string): string {
  const s = escapeRegex(stem);
  const ext = `(?:\\.(?:ts|mjs|js))?`;
  const spec = `\\s*["'][^"']*?${s}${ext}["']`;
  return (
    `(?:import\\s+${CLAUSE}(?<![\\w$.])from${spec}|` +
    `export\\s+(?:type\\s+)?(?:\\{${CLAUSE}\\}|\\*(?:\\s+as\\s+[\\w$]+)?)\\s*(?<![\\w$.])from${spec}|` +
    `import${spec}|` +
    `import\\s*\\(${spec}|` +
    `require\\s*\\(${spec}|` +
    `${SOURCE_CMD}["']?${PATH_EXPR}${s}(?:\\.sh)?["']?|` +
    `${ASSIGN_ANCHOR}([A-Za-z_][A-Za-z0-9_]*)=(["'])${PATH_EXPR}${s}(?:\\.sh)?\\2` +
    `[\\s\\S]{0,${ACCESSOR_VAR_WINDOW}}?${SOURCE_CMD}["']?\\$\\{?\\1\\}?["']?)`
  );
}

// ── (a) 路径字面量常量 (AC1: 产品源码硬编码 plugin 脚本相对路径的 *_REL 常量) ─────────────────

export interface PathConstant {
  file: string;
  line: number;
  name: string;
  script: string;
  targetExists: boolean;
}

export function findPathConstants(root: string, files: string[]): PathConstant[] {
  const re = /([A-Za-z0-9_]+)\s*=\s*(["'])(\.\.\/\.\.\/\.\.\/plugin\/scripts\/([A-Za-z0-9._-]+))\2/g;
  const out: PathConstant[] = [];
  for (const f of files) {
    if (!f.endsWith(".ts") && !f.endsWith(".js") && !f.endsWith(".mjs")) continue;
    const src = fs.readFileSync(f, "utf8");
    const mask = tsCommentMask(src);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (mask[m.index] !== 0) continue;
      const script = m[4];
      out.push({
        file: path.relative(root, f),
        line: lineOf(src, m.index),
        name: m[1],
        script,
        targetExists: fs.existsSync(path.join(root, "plugin", "scripts", script)),
      });
    }
  }
  return out;
}

// ── (b) 判定重写 (AC2: 读 /proc/<pid>/cmdline ∧ 比较名字 ⇒ 识别某进程) ────────────────────────

export interface JudgmentRewrite {
  file: string;
  line: number;
  /** true ⇔ 该站点**可合并到 kernel leaf** ⇒ 计入 `judgmentRewrites` (见 classifyRewriteSite)。 */
  mergeable: boolean;
  /** `mergeable === false` 时的 carve-out 类别，true 时为 null —— 枚举取值，⛔ 不是布尔：
   *  「被排除」必须能说出是被【哪一条】规则排除的 (硬规则 3)。 */
  carveOut: RewriteCarveOutKind | null;
  /** 一行结构性理由；`mergeable === true` 时为 null。 */
  carveOutReason: string | null;
}

/** 读取原语 —— 「这一行是在【读】」那一半。 */
const READ_PRIM = /readFile|<|cat\s+|open\s*\(/;

/** 比较/识别原语【词表】—— 与收窄前同一份（含 `argv[0]` 与 shell 的 `grep -q`）。
 *  ⛔ 收窄改的是「原语必须作用在【读取结果】上」，**不是**「什么算原语」：砍词表会把判据砍空，
 *  而判据砍空与「没有判定重写」同形（硬规则 2/3b）。 */
const COMPARE_PRIM = /grep\s+-q|\.includes\(|\.indexOf\(|\.match\(|basename\(|\.split\(|\.startsWith\(|\.endsWith\(|argv\[0\]/;

/** 可作用在【具名主体】/链式读表达式上的方法形比较原语。 */
const COMPARE_METHOD = /\.(?:includes|indexOf|match|split|startsWith|endsWith)\(/;

/** shell 比较记号：管道里的 `grep -q`、`case … in`、字符串/数值比较。 */
const SHELL_CMP = /\bgrep\s+-q|\bcase\b[^\n]*\bin\b|=~|==|!=/;

/** 链式绑定的最大间隔（字符）：读表达式之后多近接上比较原语才算「链在同一次读上」。 */
const CHAIN_GAP = 40;
/** 具名绑定的搜索窗口（字符）：主体被比较的位置离读多远还算同一次判定。 */
const SUBJECT_WINDOW = 400;

/** 同一行、读之前的最近一个 `IDENT =`（带或不带 const/let/var）：读结果的【具名主体】。
 *  null ⇒ 这次读没有被绑定到任何名字 —— 正是纯快照收集器的形态（`arr.push(read…)`，结果被搬走、
 *  比较发生在【别处】）。 */
function readSubject(prefix: string): string | null {
  const m =
    /(?:^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^=]*$/.exec(prefix) ??
    /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=\s*[^=]*$/.exec(prefix);
  return m ? m[1] : null;
}

/** 具名主体是否在窗口内【作为比较原语的操作数】被比较（= 「比较」作用在读取结果上）。 */
function subjectCompared(src: string, from: number, subj: string, isShell: boolean): boolean {
  const win = src.slice(from, from + SUBJECT_WINDOW);
  const e = escapeRegex(subj);
  if (new RegExp(`(?:^|[^\\w$.])${e}\\s*${COMPARE_METHOD.source}`).test(win)) return true;
  if (new RegExp(`basename\\(\\s*${e}\\b`).test(win)) return true;
  if (isShell) {
    // 管道/`case` 把结果交给下一个进程或模式表而不是变量名，所以 shell 侧的绑定是
    // 「$subj 与比较记号【同行】」—— 同一行即这一族的邻域约束。
    const ref = new RegExp(`\\$\\{?${e}[\\}\\s"']`);
    for (const line of win.split("\n")) if (ref.test(line) && SHELL_CMP.test(line)) return true;
  }
  return false;
}

/** 收窄的核心（AC4）：把「比较原语」绑到【这一次读的结果】上，三条绑法任一成立即算绑定：
 *   A 链式 —— 读表达式之后（≤ CHAIN_GAP 字符）直接链上比较原语（`…readFileSync(p).split("\0")…`）；
 *   B 具名 —— 同一行把读结果赋给 IDENT，且 IDENT 在窗口内是比较原语的操作数
 *             （`IDENT.includes(…)` / `basename(IDENT)` / shell 的 `case "$IDENT" in …`）；
 *   C 管道 ——（.sh）读的那一行本身含 shell 比较记号。
 *  ⛔ 三条全不成立 ⇒ 这是【收集器】不是判定：`fast-mode-telemetry.ts:215` 的 `snapshotProcCmdlines`
 *  把全部 cmdline 收进数组、比较发生在另一个函数里，收窄前只因同文件有一处 `.includes(` 就上榜。 */
function boundToRead(src: string, at: number, prefix: string, suffix: string, isShell: boolean): boolean {
  if (new RegExp(`^[^;\\n]{0,${CHAIN_GAP}}${COMPARE_METHOD.source}`).test(suffix)) return true;
  if (isShell && SHELL_CMP.test(suffix)) return true;
  const subj = readSubject(prefix);
  return subj !== null && subjectCompared(src, at, subj, isShell);
}

// ── 判定重写的【可合并性】分类（本任务：把非可合并的站点类从计数里排除）──────────────────────
//
// 计数语义（收窄后）：`judgmentRewrites` = **可合并到 kernel leaf 的**判定重写 —— 即该站点所在的
// 载体能把 `packages/quay/src/kernel/proc-identity.ts` 当作单一实现来用。不含该条件的站点**不是**
// 「没有判定重写」，而是**结构上不可能合并**：它们的载体有真实理由各自实现判据。
//
// ⛔ 按【类】排除，⛔ 不按文件名白名单：按文件名硬编码等于把下一条同类站点漏掉 —— 缺陷是成簇的，
// 兄弟实例常在同一目录甚至同一文件（硬规则 5b）。下面四条规则问的都是载体的**结构性属性**。
//
// ⛔ 排除不得静默（硬规则 3b + 3 枚举）：被排除的站点与理由以**独立取值**出现在 report 里
// （`judgmentRewriteCarveOuts`，每条带 `carveOut` 类别 + `carveOutReason`），人类可读面也打印它们。
// **它们没有被删掉** —— 「作为 carve-out 排除」与「没扫到」必须可区分。
//
// 已知残余（如实记，⛔ 不假装规则 (d) 无代价）：一条**真的可合并**的重复判定若落在 repo-import-free
// 的 `.mjs` 里，会被规则 (d) 排除而不上报。这不是恒定盲区 —— `--no-carve-out import-free-mjs` 关掉
// 该规则后它就回到可合并列表（AC3 的两态对照钉的就是这一点），所以该盲区是**可检的**，不是静默的。

/** carve-out 的四个类别。 */
export const REWRITE_CARVE_OUT_KINDS = ["test", "shell", "imports-leaf", "import-free-mjs"] as const;
export type RewriteCarveOutKind = (typeof REWRITE_CARVE_OUT_KINDS)[number];

/** 分类结果 —— 枚举取值而非布尔（硬规则 3）。 */
export interface RewriteSiteClass {
  /** true ⇔ 该站点可合并到 kernel leaf ⇒ 计入 `judgmentRewrites`。 */
  mergeable: boolean;
  /** `mergeable === false` 时的类别；true 时为 null。 */
  carveOut: RewriteCarveOutKind | null;
  /** 一行结构性理由；`mergeable === true` 时为 null。 */
  carveOutReason: string | null;
}

/** kernel leaf 的 specifier 词干 —— 供 `accessorRegexSource()` 复用**本文件唯一那套** accessor 正则。 */
const KERNEL_LEAF_STEM = "kernel/proc-identity";

/** 载体是否是**测试**：路径段里有 `test|tests|__tests__|__test__`，或 basename 形如 `*.test.mjs` /
 *  `*.spec.ts`。理由：判据与被判对象必须**独立实现**（G3 —— judge 不得共享被判实现）；测试若 import
 *  生产侧的判定叶子，它验的就是那条叶子自己，测不出叶子错在哪。
 *  按**路径/命名约定**判定，⛔ 不列文件名（硬规则 5b）。 */
function isTestCarrier(relFile: string): boolean {
  const segs = relFile.split("/");
  const base = segs[segs.length - 1] ?? "";
  if (segs.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "__tests__" || s === "__test__")) {
    return true;
  }
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(base);
}

/** 载体是否已**经结构性关系到达 kernel leaf**。复用本文件**唯一**那套 accessor 正则
 *  (`accessorRegexSource`) 并跑在 `blankComments()` 的视图上，⛔ 不另写一份 specifier 匹配 ——
 *  两份副本正是本仓反复出现的成因形态（硬规则 5b）。
 *  理由：已 import 叶子的载体里残余的 /proc 读取是**没有被迁移判定的那部分**（例如只取 argv[0] 的
 *  第三个谓词），不是对同一判定的独立重写。 */
function importsKernelLeaf(src: string, relFile: string): boolean {
  const mask = maskFor(relFile)(src);
  const re = new RegExp(accessorRegexSource(KERNEL_LEAF_STEM));
  re.lastIndex = 0;
  return re.test(blankComments(src, mask));
}

/** 仓内相对 specifier 的四种形态（静态 `import … from` / re-export / 动态 `import()` / `require()`）。
 *  跑在 `blankComments()` 的视图上：注释里写的 `"./x"` 不是 specifier（硬规则 2：按位置判定 ——
 *  注释不是代码位置）。`[^;]*?` 读得进换行，故多行导入块不会被漏掉。 */
const REPO_INTERNAL_SPECIFIER =
  /(?:^|[^\w$.])(?:import|export)\b[^;]*?\bfrom\s*["']\.{1,2}\/|(?:^|[^\w$.])import\s*\(\s*["']\.{1,2}\/|(?:^|[^\w$.])require\s*\(\s*["']\.{1,2}\/|(?:^|[^\w$.])import\s+["']\.{1,2}\//;

/** 载体是否是**仓内 import-free 的 `.mjs` 运行时助手**：模块 specifier 全部是 `node:` 内建或裸包名，
 *  没有一条相对路径。理由：这类载体**刻意不 import 仓内 TS 内部件** —— 它们要能以 `node <file>` 单独
 *  跑、并进 npm-pack 包体，把 kernel leaf 拉进来会破坏它们的存在理由。 */
function isImportFreeMjs(src: string, relFile: string): boolean {
  if (!relFile.endsWith(".mjs")) return false;
  const mask = maskFor(relFile)(src);
  return !REPO_INTERNAL_SPECIFIER.test(blankComments(src, mask));
}

/** 命中的 carve-out 规则 + 一行理由；未命中任何规则 ⇒ null（= 真可合并站点）。 */
function carveOutFor(src: string, relFile: string): { kind: RewriteCarveOutKind; reason: string } | null {
  if (isTestCarrier(relFile)) {
    return { kind: "test", reason: "test carrier — 判据与被判对象必须独立实现 (G3), 不得共享被判叶子" };
  }
  if (relFile.endsWith(".sh")) {
    return { kind: "shell", reason: "shell carrier — .sh 不能 import TS kernel leaf (文档化 carve-out)" };
  }
  if (importsKernelLeaf(src, relFile)) {
    return {
      kind: "imports-leaf",
      reason: "already imports kernel/proc-identity.ts — 残余 /proc 读取不是被迁移判定的独立重写",
    };
  }
  if (isImportFreeMjs(src, relFile)) {
    return {
      kind: "import-free-mjs",
      reason: "repo-import-free .mjs runtime helper — 刻意不 import 仓内 TS 内部件 (独立运行 + 进包体)",
    };
  }
  return null;
}

/** **唯一**的可合并性判定（AC2：`grep -n` 只有这一处定义，`architecture-review-cluster.ts` 不另写
 *  一份 —— 那里只消费 `judgmentRewrites`）。
 *
 *  `src` 省略时按 `root/relFile` 从盘上读 —— 便于对一批真实路径逐一求值。
 *  `disabled` 关掉若干规则（AC3 的两态对照：关掉某条 ⇒ 该条下的站点回到可合并列表）。⛔ 它能取假是
 *  本条判据的价值所在：一条只会在「全部规则都生效」的世界里取真的谓词是与「没有站点」同形的回声。
 *  PURE（只读 `src`/盘上文件）。 */
export function classifyRewriteSite(
  root: string,
  relFile: string,
  src?: string,
  disabled: readonly RewriteCarveOutKind[] = [],
): RewriteSiteClass {
  const text = src ?? fs.readFileSync(path.join(root, relFile), "utf8");
  const hit = carveOutFor(text, relFile);
  if (hit === null || disabled.includes(hit.kind)) {
    return { mergeable: true, carveOut: null, carveOutReason: null };
  }
  return { mergeable: false, carveOut: hit.kind, carveOutReason: hit.reason };
}

/** 便捷布尔视图（AC2 点名的谓词）。⛔ 判定本体是 `classifyRewriteSite` —— 这里只是一层委托，
 *  两份实现会分叉，故不复制逻辑（硬规则 5b）。 */
export function isMergeableRewriteSite(
  root: string,
  relFile: string,
  src?: string,
  disabled: readonly RewriteCarveOutKind[] = [],
): boolean {
  return classifyRewriteSite(root, relFile, src, disabled).mergeable;
}

/** 判定指纹 F: 一个代码文件【读 /proc/<pid>/cmdline】(外部事实 A) 且【对读到的内容做名字/特征比较】
 *  (外部事实 B: grep -q / .includes / .indexOf / .match / basename / .split / argv[0] / comm)。
 *  ⛔ B 不是【文件级】读数（收窄，AC4）：比较原语必须绑到这次读的结果上（见 boundToRead）。
 *
 *  ⛔ 本函数返回**全部**检测到的站点（含 carve-out），每条自带 `mergeable`/`carveOut` 分类 ——
 *  「检测到了什么」与「哪些可合并」是两件事，前者的已知真样本（含 `.sh`）必须继续被报出，否则
 *  收窄会把检测器本身砍空（硬规则 2 的零计数半边，见本文件单测的收窄双向 fixture）。 */
export function findJudgmentRewrites(
  root: string,
  files: string[],
  opts: { disabledCarveOuts?: readonly RewriteCarveOutKind[] } = {},
): JudgmentRewrite[] {
  // 外部事实 A: 读 /proc/<pid>/cmdline — 必须出现在【读】上下文 (readFile* / shell `<` 重定向 / cat /
  // python open), 而非仅仅在描述字符串里提及该路径 (capability-catalog 的 QUESTION 描述不算实现)。
  // 两种实现形态都要抓 (文档 §2.8 方法(e) 的教训: 单位选错聚不出靶子): ①字面量 `/proc/${pid}/cmdline`;
  // ②构造形 `path.join(procRoot/procDir, pid, "cmdline")`。
  const procPath = /\/proc\/[^'"\s\n]*\/cmdline/;
  const constructed = /(?:procRoot|procDir)[^'"\n]{0,60}["']cmdline["']/;
  const out: JudgmentRewrite[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const mask = maskFor(f)(src);
    const isShell = f.endsWith(".sh");
    // 廉价【必要】预筛: 整文件没有任何比较原语 ⇒ 不可能是「读 ∧ 比」。
    // ⛔ 它【不再】是充分条件 —— 收窄前它独自决定判定，于是收集器只要同文件里恰好有一处
    // `.includes(` 就被计成「识别进程」；决定权已移到 boundToRead（必须绑到这次读上）。
    if (codeMatch(src, mask, COMPARE_PRIM).length === 0) continue;
    // 外部事实 A: 路径 (字面量或构造形) 落在代码位置, 且其【同行的前缀】含读原语。
    let found = false;
    let hitLine = 0;
    const scan = (re: RegExp) => {
      const g = new RegExp(re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = g.exec(src)) !== null) {
        if (mask[m.index] !== 0) continue;
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        let lineEnd = src.indexOf("\n", m.index);
        if (lineEnd === -1) lineEnd = src.length;
        const prefix = src.slice(lineStart, m.index);
        if (!READ_PRIM.test(prefix)) continue;
        if (!boundToRead(src, m.index, prefix, src.slice(m.index, lineEnd), isShell)) continue;
        hitLine = lineOf(src, m.index); found = true; return;
      }
    };
    scan(procPath);
    if (!found) scan(constructed);
    if (found) {
      const rel = path.relative(root, f);
      const cls = classifyRewriteSite(root, rel, src, opts.disabledCarveOuts ?? []);
      out.push({
        file: rel,
        line: hitLine,
        mergeable: cls.mergeable,
        carveOut: cls.carveOut,
        carveOutReason: cls.carveOutReason,
      });
    }
  }
  return out;
}

/** **可合并**的判定重写 —— `run()` 的 `judgmentRewrites` 就是这个集合，与 `judgmentRewriteCarveOuts`
 *  互补、不重叠，并集 = `findJudgmentRewrites()` 的全部检测结果（枚举：没有第三条去路）。 */
export function findMergeableJudgmentRewrites(
  root: string,
  files: string[],
  opts: { disabledCarveOuts?: readonly RewriteCarveOutKind[] } = {},
): JudgmentRewrite[] {
  return findJudgmentRewrites(root, files, opts).filter((j) => j.mergeable);
}

// ── (a-side) 字节完全相同文件对 (AC3: plugin/scripts ↔ experiments/*/scripts) ────────────────

export interface ByteIdenticalPair {
  plugin: string;
  experiment: string;
  lines: number;
}

/** 直接子条目的名字, 按【常规文件】与【全部条目】两个集合返回。
 *  常规文件判定用 `Dirent.isFile()` —— 它是 lstat/d_type 级的 (符号链接报 isFile() === false),
 *  不是跟随软链后的 stat, 因此【不依赖链接指向哪里】(悬空链与指向本目录的链一律排除)。
 *  目录不可读 ⇒ 两个空集 (没有名字, 不是崩溃; 由调用方按「无候选」处理, 不与「扫过且无命中」混淆)。 */
function mirrorDirNames(dir: string): { regular: Set<string>; all: Set<string> } {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return {
      regular: new Set(entries.filter((d) => d.isFile()).map((d) => d.name)),
      all: new Set(entries.map((d) => d.name)),
    };
  } catch {
    return { regular: new Set(), all: new Set() };
  }
}

export function findByteIdenticalPairs(
  root: string,
): { pairs: ByteIdenticalPair[]; totalLines: number; symlinksSkipped: number } {
  const scriptsDir = path.join(root, "plugin", "scripts");
  // 任一侧是【软链】的条目不是 pair —— 它是单一来源引用 (同一 inode), 逐字节比对等于文件和自己比,
  // 会把「单源」读成「复制替代抽象」的最强证据。规则正本 = mirror-pair-drift-check.ts 头注释:
  // "a SYMLINK on either side is NOT a pair — it is a single-source reference (the same file), so it
  // cannot drift; the checker excludes it rather than comparing a file against itself." 本处用同一
  // lstat 级谓词 (`Dirent.isFile()`) 取同一判定, 但【不共享代码】—— 该检查器把镜像目录写死为
  // quay-perpetual-stream, 本检查器扫 experiments/*/scripts 全部镜像目录, 遍历面不同。
  const exps: { dir: string; regular: Set<string>; all: Set<string> }[] = [];
  const expRoot = path.join(root, "experiments");
  if (fs.existsSync(expRoot)) {
    for (const e of fs.readdirSync(expRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const s = path.join(expRoot, e.name, "scripts");
      if (fs.existsSync(s)) exps.push({ dir: s, ...mirrorDirNames(s) });
    }
  }
  const pairs: ByteIdenticalPair[] = [];
  let totalLines = 0;
  let symlinksSkipped = 0;
  let names: string[] = [];
  try {
    // 左侧同样只取常规文件 (对称: "a SYMLINK on EITHER side is NOT a pair")。
    names = fs
      .readdirSync(scriptsDir, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|sh|mjs)$/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return { pairs, totalLines, symlinksSkipped };
  }
  for (const name of names) {
    const pluginFile = path.join(scriptsDir, name);
    const pluginBuf = fs.readFileSync(pluginFile);
    for (const { dir, regular, all } of exps) {
      if (!regular.has(name)) {
        // 同名但非常规文件 (软链/目录) ⇒ 按规则跳过, 且【计数】而不是静默丢弃:
        // 报告里 "0 对" 与 "镜像目录不存在" 必须可区分 (hard rule 3b)。
        if (all.has(name)) symlinksSkipped++;
        continue;
      }
      const cand = path.join(dir, name);
      const candBuf = fs.readFileSync(cand);
      if (pluginBuf.equals(candBuf)) {
        const lines = pluginBuf.toString("utf8").split("\n").length - 1;
        pairs.push({ plugin: `plugin/scripts/${name}`, experiment: path.relative(root, cand), lines });
        totalLines += lines;
      }
    }
  }
  return { pairs, totalLines, symlinksSkipped };
}

// ── (a) 字面量复制度 (AC5: full vs code 分列; 单一访问器 vs 硬编码) ───────────────────────────

/** 命中点是不是「**按路径调用**」该实体 (而非**命名**它) —— 本任务 §三明列的非证据类。
 *
 *  为什么它【非证据】: 一个实体被**调用**时必然要写出它住在哪 —— 那是位置知识, 正是单一访问器
 *  (import / source) 要收敛掉的那一半; 而「身份复制」问的是这个实体被**独立命名/独立判定**了几次。
 *  两个形态 (判词 §三 逐字点名的两类):
 *    A 路径尾 —— 实体名是更长路径串的最后一段 (`"…/scripts/ready-pool-check.ts"`、
 *      `path.join(__dirname, "../scripts/ready-pool-check.ts")`) ⇒ 前一个字符是路径分隔符;
 *    B 实参位 —— 实体名**整段**是一个字符串字面量, 且该字面量在实参/数组元素位 (紧邻的前一个非空白
 *      字符是 `(` / `,` / `[`) ⇒ 它被**交给**某个调用, 而不是被**写进**某段文本:
 *      `path.join(root, "plugin", "scripts", "ready-pool-check.ts")`、
 *      `resolveKernelSibling("ready-pool-check.ts")`、spawn 的 argv 数组、`runHelp("ready-pool-check.ts")`。
 *
 *  ⛔ 边界随本任务收窄 (gap-identity-hardcoded-needs-occurrence-role-filter): 本谓词**只**判
 *  「按路径调用」这一维。散文/标题/断言消息里的提及 (`<h2>resource-gate.sh</h2>`、
 *  `"Usage: node workflow-event-schema.mjs --validate <file>"`) 的前一个非空白字符是标识符或
 *  运算符 ⇒ **本谓词仍然返回 false** (它们不是实参位), 但它们**不再是证据** —— 把它们降为非证据
 *  的是**另一个**判据 (`occurrenceRole` 的 `text` 角色: 字面量内容不等于实体名), 不是这里。
 *  旧版本注释曾把这一族写成「仍是证据」(旧边界「文本里的裸 basename 是身份」), 该边界已在本任务
 *  重新裁定; `plugin/test/identity-replication-check.test.mjs` 的负控制已随之改写。 */
export function isPathInvocationMention(src: string, idx: number, entity: string): boolean {
  const prev = idx > 0 ? src[idx - 1] : "";
  if (prev === "/" || prev === "\\") return true; // A 路径尾
  if (prev !== '"' && prev !== "'") return false; // B 只对「整段是实体名」的引号串成立
  if (src[idx + entity.length] !== prev) return false;
  let p = idx - 2;
  while (p >= 0 && (src[p] === " " || src[p] === "\t" || src[p] === "\n" || src[p] === "\r")) p--;
  const before = p >= 0 ? src[p] : "";
  return before === "(" || before === "," || before === "[";
}

// ── 出现角色过滤器 (gap-identity-hardcoded-needs-occurrence-role-filter) ────────────────────
//
// 缺口: 旧判据的第 2 步只问「代码位置 ∧ 非按路径」, 于是 `test("…resource-gate.sh…")` 的**标题**、
// `assert.equal(x, "resource-gate.sh")` 的**期望值**、错误消息串, 与 `NEVER_LAYDOWN="quay-init.sh"`
// 这类**真把实体名当身份使用**的位点同形计入。硬规则 2 要的「按位置判定」在**出现角色**这一维上
// 还没有落地: 位置只分到代码/注释/文档, 而代码位置里叙述串与身份值是两种东西。
//
// ⛔ 反向边界同时钉住 (否则等价于把检测器关掉): 身份值位点仍是证据。'name-value' 就是它。
// ⛔ 角色是**枚举取值**不是布尔 (硬规则 3): 「非证据」必须能说出被【哪一类】排除的, 否则
//    「读不懂这段文本」会与「查过且非证据」同形 (硬规则 3b)。

/** 出现角色。`name-value` = 在该位置**把这个名字当作值**(独立命名点, 证据);
 *  `text` = 嵌在叙述/标题/消息/散文里 (非证据); `by-path` = 按路径调用 (位置知识, 非证据);
 *  `comment` = 注释 (非证据, 由位置掩码给出)。 */
export const OCCURRENCE_ROLES = ["name-value", "text", "by-path", "comment"] as const;
export type OccurrenceRole = (typeof OCCURRENCE_ROLES)[number];

/** 字符串 / 模板字面量的跨度。`[start, end)` 覆盖两个定界引号**本身**。 */
interface StringSpan {
  start: number;
  end: number;
}

/** 字面量跨度表 —— 与 tsCommentMask / shCommentMask **同一套扫描骨架**, 但只记录字面量跨度,
 *  且**跳过注释区段**: 注释里的撇号不得打开「幻影字符串」(那是本文件已经踩过一次的坑 —— 见
 *  regexLiteralEnd 的头注释: 一次误判会跨行吞掉后面的代码)。
 *
 *  ⛔ 刻意**不**按扩展名分 TS / shell 两套: `matchEntity()` 拿到的只有 src/mask, 拿不到文件名
 *  (AC1 的探针正以这个签名调用它) ⇒ 规则必须在两种模式下同形, 否则探针里的 .sh 用例会走错分支。
 *  两种模式在**本判据关心的范围**内差别只有一个 —— 注释记号 (`#` vs `//`), 而注释已由调用方给的
 *  mask 表达 ⇒ 这里不需要知道文件名。
 *
 *  ⛔ 换行护栏 (同 regexLiteralEnd 的教训): `"` 与 `'` 字面量**不含未转义的行终止符**, 所以同行
 *  找不到闭合引号就说明判错了 (heredoc 散文里一个撇号足以让朴素词法器跨行吞掉后面的真代码) ⇒
 *  不产出该跨度。反引号 (模板字面量) 合法跨行, 保留。
 *
 *  已知残余: 模板字面量的 `${…}` 内嵌表达式不单独解析 (整段算一个字面量跨度)。*/
function stringSpans(src: string, mask: Uint8Array): StringSpan[] {
  const spans: StringSpan[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (mask[i] === 1) { i++; continue; }
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== "`") { i++; continue; }
    const start = i;
    i++;
    let closed = false;
    while (i < n) {
      if (mask[i] === 1) { i++; continue; }
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "\n" && q !== "`") break; // 换行护栏: 未闭合的 ' / " 不是字面量
      if (src[i] === q) { i++; closed = true; break; }
      i++;
    }
    if (closed) spans.push({ start, end: i });
  }
  return spans;
}

/** 跨度表按 (mask 对象, src) 记忆 —— 每个文件只词法分析一次 (调用方对同一文件复用它算出的 mask)。 */
const _spanCache = new WeakMap<Uint8Array, { src: string; spans: StringSpan[] }>();
function stringSpansOf(src: string, mask: Uint8Array): StringSpan[] {
  const hit = _spanCache.get(mask);
  if (hit !== undefined && hit.src === src) return hit.spans;
  const spans = stringSpans(src, mask);
  _spanCache.set(mask, { src, spans });
  return spans;
}

/** 脚本名形状的词 (`foo.sh` / `bar.ts` / `baz.mjs`), 去掉包裹的括号/逗号/分号再看。
 *  用途见 bareWordRole: 名字清单的判据。 */
const SCRIPT_NAME_WORD = /^[\w./-]+\.(?:sh|ts|mjs|js)$/;

/** 去掉词首的 `([{` 与词尾的 `)]},;:` —— `case "$x" in quay-init.sh)` 这类词形。 */
function stripWordPunct(w: string): string {
  return w.replace(/^[([{]+/, "").replace(/[)\]},;:]+$/, "");
}

/** 同一【逻辑行】上的词 (行连续符 `\` 把多行接成一行 —— 名字清单常被折成多行)。 */
function logicalLineWords(blanked: string, idx: number): { words: string[]; at: number } {
  let ls = blanked.lastIndexOf("\n", idx) + 1;
  // 向左并上以 `\` 结尾的续行 (最多 200 行, 防病态输入)
  for (let guard = 0; guard < 200 && ls > 0; guard++) {
    const prevStart = blanked.lastIndexOf("\n", ls - 2) + 1;
    if (!/\\\s*$/.test(blanked.slice(prevStart, ls - 1))) break;
    ls = prevStart;
  }
  let le = blanked.indexOf("\n", idx);
  if (le === -1) le = blanked.length;
  for (let guard = 0; guard < 200 && /\\\s*$/.test(blanked.slice(ls, le)); guard++) {
    const next = blanked.indexOf("\n", le + 1);
    if (next === -1) { le = blanked.length; break; }
    le = next;
  }
  const words: string[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  const text = blanked.slice(ls, le);
  while ((m = re.exec(text)) !== null) words.push(m[0]);
  return { words, at: idx - ls };
}

/** 裸词 (未被引号包裹) 出现的角色。
 *
 *  ⛔ 这是本任务最窄的一条判据, 只说一件事: **在名字清单里登记的裸名是命名点, 其余不是**。
 *  为什么用邻词 (硬规则 2 的位置判定在无引号时的唯一载体): 裸名没有引号替它说话, 只能看它**周围
 *  是什么词**。邻词也是脚本名形状 ⇒ 这一行在**登记一批名字** (`quay-init.sh` 的 laydown
 *  `printf '%s\n' a.ts b.ts … >> "$out"` 清单); 邻词是 `--flag` / 散文词 ⇒ 这一行是命令行调用
 *  或叙述 (`checker-mutation-cases/red-on-omission-audit.sh` 的 heredoc fixture 正文
 *  `C3 resource-gate.sh --for full-suite。`) —— 两者都不是**独立命名**。
 *
 *  ⛔ 赋值的右侧 (`NEVER_LAYDOWN=<entity>`) 是身份值, 由下面的 `NAME=` 预判接住 (带引号的版本
 *  走字面量分支; **裸 basename 被赋成身份值**正是本任务的反向边界)。
 *
 *  已知残余 (如实记): 名字清单若**整行只有一个名字**(清单首行 `printf '%s\n' a.ts \` 里那个
 *  a.ts), 它的邻词是命令词 ⇒ 被判为非证据。这是本规则唯一的假阴性方向, 且它**可检**:
 *  实体在别处的身份值位点仍会被报出。 */
function bareWordRole(blanked: string, idx: number, entity: string): OccurrenceRole {
  const before = blanked.slice(blanked.lastIndexOf("\n", idx) + 1, idx);
  if (/[A-Za-z_][A-Za-z0-9_]*=["']?$/.test(before)) return "name-value"; // NAME=<entity> (裸或已开引号)
  const { words, at } = logicalLineWords(blanked, idx);
  let mine = -1;
  let offset = 0;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (at >= offset && at < offset + w.length) { mine = k; break; }
    offset += w.length + 1; // 词之间至少一个空白
  }
  if (mine === -1) return "text";
  if (stripWordPunct(words[mine]) !== entity) return "text"; // 实体不是一个完整的词 ⇒ 不是命名点
  for (const nb of [words[mine - 1], words[mine + 1]]) {
    if (nb !== undefined && SCRIPT_NAME_WORD.test(stripWordPunct(nb))) return "name-value";
  }
  return "text";
}

/** 一个出现处的角色 —— **唯一**一份判定 (literalReplication / replicationTable / 探针共用
 *  `matchEntity()`, 而 `matchEntity()` 只调它)。PURE。 */
export function occurrenceRole(
  src: string,
  mask: Uint8Array,
  blanked: string,
  idx: number,
  entity: string,
): OccurrenceRole {
  if (mask[idx] !== 0) return "comment";
  if (isPathInvocationMention(src, idx, entity)) return "by-path";
  const sp = stringSpansOf(src, mask).find((s) => idx > s.start && idx < s.end);
  if (sp !== undefined) {
    // 字面量内容 (去掉定界引号、trim) **恰为**实体名 ⇒ 一处独立命名 (身份值);
    // 否则实体是嵌在更长的文本里 —— 标题 / 断言消息 / 错误消息 / 叙述串 ⇒ 非证据。
    return src.slice(sp.start + 1, sp.end - 1).trim() === entity ? "name-value" : "text";
  }
  return bareWordRole(blanked, idx, entity);
}

/** 单文件 × 单实体的分类结果。 */
export interface EntityMatch {
  /** 该文件在**代码位置**提到它 (任意出现角色, 只要不是按路径调用), 或经结构性关系引用它
   *  ⇒ 计入 `code`。⛔ 这是**提及级**读数, 定义与收窄前逐字一致 ⇒ 读数面 (哪一行进表、
   *  行怎么排序) 不因本任务而变, 五个簇的修前/修后对照可以在**同一面**上读。 */
  code: boolean;
  /** 该文件**独立命名**了它 (出现角色 = name-value) ⇒ 与 `accessor` 一起构成 `codeFiles`
   *  (本任务把 `codeFiles` 从「代码位置提及」重锚到「独立命名」, 见 LiteralReplication.codeFiles)。 */
  naming: boolean;
  /** 经 import / re-export / require / source 单一访问器引用。 */
  accessor: boolean;
  /** 角色为 `name-value` 的命中 —— `hardcoded` 的样本来源 (行号 + 该行原文)。
   *  ⛔ 不是「代码位置 ∧ 非按路径」: 出现角色为 `text` 的位点 (标题/断言消息/错误消息/叙述串)
   *  已在这一步被排除, 见 occurrenceRole。 */
  evidenceLines: { line: number; text: string }[];
}

/** `literalReplication()` 与 `replicationTable()` 共用的**唯一**一份逐文件判定。
 *  (两份逐字副本正是本文件那个缺陷的成因形态: 同一判据在两个消费点各写一遍, 修了一处漏另一处。)
 *
 *  判定顺序是判据的一半, 不能颠倒:
 *    1. **先**问「这个文件是否经结构性关系到达该实体」(`accessorRe` 跑在 `blankComments()` 的视图上)
 *       —— 有即 `accessor`, 与它的命中点长什么样无关。⛔ 先按位置筛会把 accessor 全筛掉:
 *       import 的 specifier 本身就是 `"./ready-pool-check.ts"`, 天然是「路径尾」。
 *    2. **再**问「有没有【出现角色 = name-value】的命中」—— 有即 `hardcoded`。
 *    3. 两条都不成立 ⇒ 不计数 (只被路径引用 / 只在注释与文档里提到 / 只在叙述串里出现)。
 *
 *  这与旧实现的差别正是本任务判据的两处产地: 旧的第 2 步只问 `mask[idx] === 0`(注释与文档),
 *  不看「按路径引用」, 也没有把 accessor 判定前置, 更不看**出现角色** (叙述串与身份值同形)。 */
export function matchEntity(
  src: string,
  mask: Uint8Array,
  blanked: string,
  accessorRe: RegExp,
  entity: string,
): EntityMatch {
  // ⛔ 这里**不**用 `codeMatch()` 的「命中起点必须落在代码位置」那一半判据 —— 它在抹平后的视图上
  // 会取假(假阴性): 起点可以落在**已被抹成空格**的注释里 (`^` + `\s*` 恰好跨过整行注释), 于是
  // 一条真正的 `source "$(dirname "$0")/shared-lib.sh"` 被丢掉 —— 实测: 该处起点是注释的第 0 列。
  // 位置过滤本身没有缺席, 只是换了载体: `blankComments()` 已经把注释**内容**整个抹成空格, 所以
  // 正则根本读不到注释里的任何实体 (`. "$CONF"  # loads x.sh` 的 `x.sh` 已不存在 ⇒ 不可能命中),
  // 而命中里留下的实体一定在代码位置 (实体名不含空格 ⇒ 它对不上任何被抹平的区段)。
  accessorRe.lastIndex = 0; // 调用方传非 global 的正则; 若将来带了 `g`, 这一行让它仍然无状态。
  const accessor = accessorRe.test(blanked);
  const evidenceLines: { line: number; text: string }[] = [];
  let anyMention = false;  // 代码位置 ∧ 非按路径 (任意出现角色) ⇒ 提及级 `code`
  let anyNaming = false;   // 出现角色 = name-value ⇒ 命名级 `naming`(⇒ `hardcoded`)
  let idx = 0;
  while ((idx = src.indexOf(entity, idx)) !== -1) {
    // 出现角色过滤 (缺口②): 代码位置里只有 'name-value' 是**独立命名**; 注释 / 按路径调用 /
    // 叙述串 (标题/断言消息/错误消息/散文) 都不是证据。判定只此一处 (occurrenceRole)。
    const role = occurrenceRole(src, mask, blanked, idx, entity);
    if (role === "name-value" || role === "text") anyMention = true;
    if (role === "name-value") {
      anyNaming = true;
      if (evidenceLines.length < HARDCODED_SAMPLE_LIMIT) {
        const lineStart = src.lastIndexOf("\n", idx) + 1;
        let lineEnd = src.indexOf("\n", idx);
        if (lineEnd === -1) lineEnd = src.length;
        evidenceLines.push({ line: lineOf(src, idx), text: src.slice(lineStart, lineEnd).trim().slice(0, 120) });
      }
    }
    // 样本收满 ⇒ 两个布尔都已定型 (name-value ⇒ 也是 mention) ⇒ 不必扫完剩下的命中
    // (大文件的完整扫描是这条检查器的热点)。
    if (evidenceLines.length >= HARDCODED_SAMPLE_LIMIT) break;
    idx += entity.length;
  }
  return { code: accessor || anyMention, naming: anyNaming, accessor, evidenceLines };
}

/** 每个命中文件取样上限 —— 「报一个计数时同时报出它匹配到的前几条实际内容」(docs 附录 A)。 */
export const HARDCODED_SAMPLE_LIMIT = 3;

export interface LiteralReplication {
  entity: string;
  full: number;       // 含该 basename 的代码文件数 (全文)
  /** **提及级**: basename 落在【代码位置】(任意出现角色, 但非按路径调用) 或经结构性关系引用的
   *  文件数。⛔ 定义与收窄前逐字一致 —— 本任务的读数面因此**不动**, 五个簇的修前/修后对照能在
   *  同一面上读 (「不得换读数面」)。 */
  code: number;
  accessor: number;   // 经 import/re-export/require/source 单一访问器引用的文件数
  /** **命名级**: 代码位置**独立命名**该实体 (出现角色 = name-value, 且无结构性关系) 的文件数。 */
  hardcoded: number;
  /** **命名级名单**: 经结构性关系到达该实体、或**独立命名**它的文件。
   *
   *  ⛔ 本任务把它**重锚**了 (原语义 = `code` 的名单, 即「代码位置提及」)。为什么必须重锚而不能
   *  两处并存: 一个文件「只经断言消息 / test 标题 / 错误消息 / 路径」到达该实体时, 它**不再**是
   *  一处独立命名 —— 若 `codeFiles` 仍按提及级收录, 那么「N 个文件独立命名了它」与「N 个文件里
   *  恰好有个同名串」在**下游读得见的读数**上仍然同形 (硬规则 2/3b), 而 `hardcoded` 的样本面
   *  (`hardcodedSamples`) 是判红行才打印的、不是每个消费者的输入面。
   *  ⇒ 不变式: `codeFiles.length === accessor + hardcoded`。 */
  codeFiles: string[];
  /** 硬编码文件的实测样本 (前 `HARDCODED_SAMPLE_LIMIT` 条, 每条含文件:行 + 该行原文)。
   *  ⛔ 不是装饰: 计数为 N 的判红行必须能在**同一读数**里给出它命中的是什么 —— 否则「N 个文件
   *  独立命名了它」与「N 个文件里恰好有个同名串」在报告上同形 (硬规则 2/3b)。 */
  hardcodedSamples: string[];
}

export function literalReplication(root: string, files: string[], entity: string): LiteralReplication {
  const stem = entity.replace(/\.(ts|sh|mjs|js)$/, "");
  const codeFiles: string[] = [];
  const hardcodedSamples: string[] = [];
  let full = 0;
  let code = 0;
  let accessor = 0;
  let hardcoded = 0;
  const accessorRe = new RegExp(accessorRegexSource(stem));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (!src.includes(entity)) continue;
    full++;
    const mask = maskFor(f)(src);
    const m = matchEntity(src, mask, blankComments(src, mask), accessorRe, entity);
    if (m.code) code++; // 提及级
    // 命名级: 只有「经结构性关系到达」或「独立命名」的文件进 codeFiles / accessor / hardcoded。
    if (m.accessor) {
      accessor++;
      codeFiles.push(path.relative(root, f));
    } else if (m.naming) {
      hardcoded++;
      codeFiles.push(path.relative(root, f));
      for (const e of m.evidenceLines.slice(0, HARDCODED_SAMPLE_LIMIT)) {
        if (hardcodedSamples.length < HARDCODED_SAMPLE_LIMIT) {
          hardcodedSamples.push(`${path.relative(root, f)}:${e.line}  ${e.text}`);
        }
      }
    }
  }
  return { entity, full, code, accessor, hardcoded, codeFiles, hardcodedSamples };
}

/** 全量字面量复制度表: 对每个 plugin 脚本 basename 一次性算 full/code (单趟扫描所有文件)。 */
export function replicationTable(
  root: string,
  files: string[],
  entities: string[],
): LiteralReplication[] {
  const rows = entities.map((e) => ({
    entity: e,
    full: 0,
    code: 0,
    accessor: 0,
    hardcoded: 0,
    codeFiles: [] as string[],
    hardcodedSamples: [] as string[],
  }));
  const stems = rows.map((r) => r.entity.replace(/\.(ts|sh|mjs|js)$/, ""));
  // 每个实体只编译一次访问器正则 (原来是每个 (文件 × 实体) 编译一次)。共享同一份 accessorRegexSource,
  // 与 literalReplication() 是【同一个判定】而不是两份逐字副本 —— 分叉在结构上不可能 (AC4)。
  const accessorRes = stems.map((s) => new RegExp(accessorRegexSource(s)));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(root, f);
    // 掩码与「注释抹平」视图按文件算一次, 与实体数无关 (原来每个实体重算一遍掩码)。
    const mask = maskFor(f)(src);
    const blanked = blankComments(src, mask);
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (!src.includes(row.entity)) continue;
      row.full++;
      const m = matchEntity(src, mask, blanked, accessorRes[ri], row.entity);
      if (m.code) row.code++; // 提及级
      // 命名级 (与 literalReplication 同一判定、同一不变式 codeFiles.length === accessor + hardcoded)
      if (m.accessor) {
        row.accessor++;
        row.codeFiles.push(rel);
      } else if (m.naming) {
        row.hardcoded++;
        row.codeFiles.push(rel);
        for (const e of m.evidenceLines.slice(0, HARDCODED_SAMPLE_LIMIT)) {
          if (row.hardcodedSamples.length < HARDCODED_SAMPLE_LIMIT) {
            row.hardcodedSamples.push(`${rel}:${e.line}  ${e.text}`);
          }
        }
      }
    }
  }
  return rows;
}

// ── 共享模块负控制 (AC4: gate-script-base.ts 经单一 import 访问器, 不得报高复制度) ──────────

export interface SharedModuleControl {
  entity: string;
  importAccessor: number;  // 经 import/require 单一访问器引用的文件数
  hardcoded: number;       // 代码位置硬编码字面量 (非 import) 的文件数
  flagged: boolean;        // 是否被误判为高复制度
  sampleFiles: string[];
}

/** 高复制度的**阈值谓词 —— 单一实现**（两处消费者：`sharedModuleControl` 与下游的
 *  `architecture-review-cluster.ts#clusterIdentityReport`）。
 *
 *  为什么必须收成一处：判据有两半，「字面量重复出现 ≥ threshold 次」只是其一；另一半（硬编码数须
 *  **多于**访问器数）才是把「**大量文件走单一访问器引用、少数硬编码**」（= 共享模块的正常形态，
 *  `gate-script-base.ts` 就是它）与真正的复制区分开的那一半。下游曾只读裸计数 `hardcoded > 0`，
 *  阈值判定整个缺席 ⇒ 25 个逐实体簇里 8 个是检测器**已经判过清白**的假簇
 *  (gap-arch-review-cluster-ignores-detector-flag-predicate：上游判过、下游不读 ⇒ 输出与
 *  「查过且合格」同形，硬规则 3b)。两份副本正是本缺陷的成因形态，故只此一份。
 *
 *  `accessor`/`hardcoded` 缺席按 0 计：缺值不等于「未判」——行上两者都在（`LiteralReplication`），
 *  缺省只出现在手写 fixture 里。PURE。 */
export function isFlagged(row: { hardcoded?: number; accessor?: number }, threshold = 5): boolean {
  const hardcoded = row.hardcoded ?? 0;
  const accessor = row.accessor ?? 0;
  return hardcoded >= threshold && hardcoded > accessor;
}

export function sharedModuleControl(
  root: string,
  files: string[],
  entity: string,
  threshold = 5,
): SharedModuleControl {
  const r = literalReplication(root, files, entity);
  const flagged = isFlagged(r, threshold);
  return {
    entity,
    importAccessor: r.accessor,
    hardcoded: r.hardcoded,
    flagged,
    sampleFiles: r.codeFiles.slice(0, 5),
  };
}

// ── 汇总 report ──────────────────────────────────────────────────────────────────────────────

export interface Report {
  root: string;
  pathConstants: PathConstant[];
  /** **可合并到 kernel leaf 的**判定重写（收窄后的计数语义，见 classifyRewriteSite）。 */
  judgmentRewrites: JudgmentRewrite[];
  /** 检测到但**结构上不可合并**的站点 —— 以独立取值在场并各带一行理由。
   *  ⛔ 不是被删掉的读数：`judgmentRewrites.length + judgmentRewriteCarveOuts.length` =
   *  检测到的全部站点数，「作为 carve-out 排除」与「没扫到」因此可区分 (硬规则 3b)。 */
  judgmentRewriteCarveOuts: JudgmentRewrite[];
  byteIdentical: {
    count: number;
    totalLines: number;
    pairs: ByteIdenticalPair[];
    // 同名但 experiments 侧是软链/目录而跳过的条目数 —— 使 "0 对" 与 "镜像不存在" 可区分 (hard rule 3b)。
    symlinksSkipped: number;
  };
  literalReplication: { sessionLiveness: LiteralReplication; gateScriptBase: LiteralReplication };
  sharedModuleControl: SharedModuleControl;
  table: LiteralReplication[];
}

export function run(
  root: string,
  limit: number,
  opts: { disabledCarveOuts?: readonly RewriteCarveOutKind[] } = {},
): Report {
  // 排除检测器自身 + 其单测: 这两个文件含 /proc/<pid>/cmdline 指纹正则、"session-liveness.sh"
  // 被测实体字面量、以及 *_REL 合成 fixture 字符串 (检测器定义/测试输入, 不是被测对象) — 计入会
  // 把检测器自指与测试 fixture 误报成判定重写/复制度 (grep 自匹配, instrument-failure FAMILY-3 同形)。
  const files = walkCodeFiles(root).filter(
    (f) => !f.endsWith("/identity-replication-check.ts") && !f.endsWith("/identity-replication-check.test.mjs"),
  );

  const pathConstants = findPathConstants(root, files);

  // 判定重写: 一次检测, 两个互补列表 (可合并 / carve-out)。⛔ 不在这里过滤第二遍 —— 分类判定
  // 只有一个老家 (classifyRewriteSite), 消费者 import 结果。
  const detectedRewrites = findJudgmentRewrites(root, files, opts);
  const judgmentRewrites = detectedRewrites.filter((j) => j.mergeable);
  const judgmentRewriteCarveOuts = detectedRewrites.filter((j) => !j.mergeable);

  const byteIdenticalRaw = findByteIdenticalPairs(root);

  const sessionLiveness = literalReplication(root, files, "session-liveness.sh");
  const gateScriptBase = literalReplication(root, files, "gate-script-base.ts");
  const sharedModule = sharedModuleControl(root, files, "gate-script-base.ts");

  // 全量表: 全部 plugin/scripts basename。
  let entities: string[] = [];
  try {
    entities = fs
      .readdirSync(path.join(root, "plugin", "scripts"))
      .filter((n) => /\.(ts|sh|mjs)$/.test(n))
      .sort();
  } catch {
    entities = [];
  }
  const table = replicationTable(root, files, entities)
    .filter((r) => r.code > 0)
    .sort((a, b) => b.code - a.code || b.full - a.full)
    .slice(0, limit);

  return {
    root,
    pathConstants,
    judgmentRewrites,
    judgmentRewriteCarveOuts,
    byteIdentical: {
      count: byteIdenticalRaw.pairs.length,
      totalLines: byteIdenticalRaw.totalLines,
      pairs: byteIdenticalRaw.pairs,
      symlinksSkipped: byteIdenticalRaw.symlinksSkipped,
    },
    literalReplication: { sessionLiveness, gateScriptBase },
    sharedModuleControl: sharedModule,
    table,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

function usage(): never {
  console.error(
    "usage: node --experimental-strip-types identity-replication-check.ts [--root <dir>] [--json] [--limit <n>]\n" +
      "                                        [--no-carve-out <kind>[,<kind>…]]\n" +
      "  --root <dir>   repo to scan (default: repo-root.ts resolution)\n" +
      "  --limit <n>    max rows in the human literal-replication table (default 25)\n" +
      "  --json         emit the full report as JSON\n" +
      `  --no-carve-out disable one non-mergeable-site rule (repeatable). kinds: ${REWRITE_CARVE_OUT_KINDS.join(", ")}\n` +
      "                 (disabling a rule moves its sites back into `judgmentRewrites` — the two-state check)\n" +
      "Exit: 0 = report produced (observer, not a pass/fail gate); 2 = usage/environment error.",
  );
  process.exit(0);
}

/** 解析 `--no-carve-out <kind>`（可重复、可逗号分隔）。未知 kind ⇒ exit 2，⛔ 不静默忽略：
 *  一条读不懂的规则名若被吞掉，输出就与「该规则已生效」同形（硬规则 3b）。 */
function collectDisabledCarveOuts(args: string[]): RewriteCarveOutKind[] {
  const out: RewriteCarveOutKind[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--no-carve-out") continue;
    const raw = args[i + 1];
    if (raw === undefined || raw.startsWith("--")) {
      console.error("ERROR: --no-carve-out needs a kind");
      process.exit(2);
    }
    for (const part of raw.split(",")) {
      const kind = part.trim();
      if (!(REWRITE_CARVE_OUT_KINDS as readonly string[]).includes(kind)) {
        console.error(`ERROR: unknown carve-out kind "${kind}" — one of: ${REWRITE_CARVE_OUT_KINDS.join(", ")}`);
        process.exit(2);
      }
      out.push(kind as RewriteCarveOutKind);
    }
  }
  return out;
}

function printHuman(report: Report): void {
  console.log("identity-replication-check — P2 身份复制检测器 (docs/proposals/archguard-generation-era-primitives.md §3)");
  console.log("root:", report.root);

  console.log(`\n== 路径字面量常量 (AC1) — ${report.pathConstants.length} 个 *_REL 常量硬编码 plugin 脚本相对路径 ==`);
  for (const c of report.pathConstants) {
    const mark = c.targetExists ? "" : "  [target MISSING]";
    console.log(`  ${c.file}:${c.line}  ${c.name} = ".../plugin/scripts/${c.script}"${mark}`);
  }
  if (report.pathConstants.length === 0) console.log("  (none)");

  console.log(
    `\n== 判定重写 (AC2) — 读 /proc/<pid>/cmdline ∧ 比较名字 (识别进程) — ` +
      `**可合并到 kernel leaf** ${report.judgmentRewrites.length} 处 ==`,
  );
  for (const j of report.judgmentRewrites) console.log(`  ${j.file}:${j.line}`);
  if (report.judgmentRewrites.length === 0) {
    console.log("  (none — 检测到的站点全部落在 carve-out 里; 见下一节, 它们没有被删掉)");
  }

  // carve-out 面与上面并列在场: 「被排除」与「没扫到」必须在同一份报告里可区分 (硬规则 3b)。
  console.log(
    `\n== 判定重写的 carve-out (检测到但结构上不可合并, 带理由) — ` +
      `${report.judgmentRewriteCarveOuts.length} 处 ==`,
  );
  for (const j of report.judgmentRewriteCarveOuts) {
    console.log(`  ${j.file}:${j.line}  [${j.carveOut}] ${j.carveOutReason}`);
  }
  if (report.judgmentRewriteCarveOuts.length === 0) console.log("  (none)");

  console.log(
    `\n== 字节完全相同文件对 (AC3) — ${report.byteIdentical.count} 对 / ${report.byteIdentical.totalLines} 行 ` +
      `(跳过 ${report.byteIdentical.symlinksSkipped} 个软链条目: 单一来源引用, 非 pair) ==`,
  );
  for (const p of report.byteIdentical.pairs.slice(0, 5)) console.log(`  ${p.plugin}  ==  ${p.experiment}  (${p.lines} 行)`);
  if (report.byteIdentical.count > 5) console.log(`  … 及另外 ${report.byteIdentical.count - 5} 对`);

  console.log(`\n== 字面量复制度 (AC5) — 全文 vs 代码位置分列 (剔除注释/文档) ==`);
  const sl = report.literalReplication.sessionLiveness;
  console.log(`  session-liveness.sh: full=${sl.full}  code=${sl.code}  (accessor=${sl.accessor}  hardcoded=${sl.hardcoded})`);
  console.log(`    code 命中样本: ${sl.codeFiles.slice(0, 5).join(", ") || "(none — 实体已退休, 残留引用均在注释/文档/退休断言内)"}`);

  console.log(`\n== 共享模块负控制 (AC4) — gate-script-base.ts ==`);
  const sm = report.sharedModuleControl;
  console.log(`  import 单一访问器=${sm.importAccessor}  硬编码=${sm.hardcoded}  flagged=${sm.flagged}`);

  console.log(`\n== 全量字面量复制度表 (code 位置计数 > 0, top ${report.table.length}) ==`);
  for (const r of report.table) {
    const flagged = isFlagged(r);
    console.log(
      `  ${r.entity.padEnd(44)} code=${String(r.code).padStart(3)}  full=${String(r.full).padStart(3)}  ` +
        `accessor=${r.accessor}  hardcoded=${r.hardcoded}${flagged ? "  <<FLAGGED" : ""}`,
    );
    // 判红行必须**就地**给出它命中的实际内容 (硬规则 2): 一个只报数字的判红行, 与「同名串恰好
    // 出现在别处」在报告上同形 —— 读的人无法判断这是真复制还是判据又错了。
    if (flagged) {
      for (const s of r.hardcodedSamples) console.log(`        sample: ${s}`);
      if (r.hardcodedSamples.length === 0) {
        console.log("        sample: (none — 判红却取不出样本 ⇒ 判据故障, 不是「没有复制」)");
      }
    }
  }
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const asJson = args.includes("--json");
  const rootArg = flagValue(args, "--root");
  const limitArg = flagValue(args, "--limit");
  const limit = limitArg ? Number(limitArg) : 25;
  if (limitArg && (!Number.isInteger(limit) || limit < 1)) {
    console.error("ERROR: --limit must be a positive integer");
    process.exit(2);
  }
  const root = rootArg ? path.resolve(rootArg) : repoRoot();
  if (!fs.existsSync(path.join(root, "plugin", "scripts"))) {
    console.error(`ERROR: plugin/scripts not found under ${root} — is --root correct?`);
    process.exit(2);
  }
  const report = run(root, limit, { disabledCarveOuts: collectDisabledCarveOuts(args) });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  return 0;
}

// Bundler-safe entry guard — see gate-script-base.isDirectEntry
// (gap-drivers-yml-interval-not-honored-for-routine-kinds): a hand-rolled file-identity comparison is
// true for EVERY inlined module of a dist bundle, so it hijacks any bundle that inlines this module.
if (isDirectEntry(import.meta, undefined, "identity-replication-check")) {
  process.exitCode = main(process.argv);
}
