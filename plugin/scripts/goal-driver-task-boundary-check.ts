// goal-driver-task-boundary-check.ts — DIR-131 执行落点 (tasks/gap-goal-driver-task-boundary-check):
// goal 机制与 task 机制的职责边界防回归。人 2026-09-07 裁定：「创建 task 后到 task 落地的过程应当
// 由 task 相关机制（promotion-driver / worker-driver）驱动；goal 机制应当负责 task 以外的 goal
// 相关生命周期。」这条边界此前只有散文载体（goal-driver.ts 头注释），守与不守在记录上无法区分
// （硬规则 9）——本检查把它变成可跑的产物：按位置断言 goal-driver.ts 中不存在 task 写路径的调用点。
//
// 回答的问题（@instrument）：「goal-driver.ts 是否在【代码位置】（排除注释与字符串字面量）出现
//   task 写路径调用点——task_write / lifecycle_promote / lifecycle_retreat / lifecycle_complete
//   这些 task 机制动词，或以 tasks/ 为目标的 fs.write* / writeFileSync——即 goal 机制越界替 task
//   机制落地任务状态？以及（DIR-131 AC6）是否在【非注释位置】引用**本仓自身**的 fan-in / 落地率类
//   载体（fan-in / full-suite-state / 落地率）——即 goal 机制以本仓 task 落地指标为输入（错误归因
//   反例）。」
//
// **2026-09-12 补充裁定（AC6 口径澄清，人三选一之①）**：「读外部被驱动系统」与「读本仓自身落地率」
// 是两件事——前者不构成 AC6 的反例形态（它不驱动/佐证本仓任何 task 的判定）。据此新增一个**结构性**
// 豁免（`exemptSpans`）：仅当 fan-in/落地率 token 同时落在源码里精确配对的
// `DIR-131-TARGET-PROBE-BEGIN`/`-END` 标记之间**且**落在字符串/模板字面量内部时豁免——标记不配对
// （缺失/多于一对/顺序颠倒）⇒ 不豁免任何位置（fail-closed，回退到澄清前的行为）。
//
// 判定（能取假，硬规则 3/4）：
//   - task 机制动词（task_write / lifecycle_*）在代码位置出现 ⇒ RED（goal 机制越界写 task 状态）。
//   - 写家族调用（fs.write* / writeFileSync / appendFile* / createWriteStream）在代码位置出现且其
//     语句窗口内引用 tasks/ 路径 ⇒ RED（goal 机制直接写 tasks/*.md）。
//   - fan-in / full-suite-state / 落地率 在非注释位置（含字符串字面量——读载体必写路径）出现，且不在
//     上述目标探针豁免区内 ⇒ RED（goal 机制读**本仓自身**落地指标）。
//   - 头注释 / DIR-131 正文里逐字出现这些词不算（屏蔽注释与字符串字面量——硬规则 2，裸 grep 假阳性）。
//
// 退出码（checker-mechanical-spine-check.ts 词表 {0,1,2,3}）：
//   0 = PASS（goal-driver.ts 无 task 写路径调用点，也不在豁免区外读 fan-in / 落地率类载体）
//   1 = RED（≥1 个 task 写路径调用点 / 豁免区外的 fan-in 载体引用）
//   2 = usage/env error（非法参数）
//   3 = NOT-EVALUATED（目标文件缺失 / 不可读——读不到输入 ≠ 无违规，硬规则 3b）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts \
//       [--root <dir>] [--goal-driver <path>] [--json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 默认受检面 = quay 仓库根（本脚本位于 <repo>/plugin/scripts/）。 */
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
/** 受检目标（repo-root-relative）。 */
const GOAL_DRIVER_REL = "plugin/scripts/goal-driver.ts";

/** task 机制的写动词（MCP / lifecycle 动词）——goal 机制越界替 task 机制写状态的词表。 */
export const TASK_VERB_RE = /\b(task_write|lifecycle_promote|lifecycle_retreat|lifecycle_complete)\b/g;

/** 写家族函数名（以 tasks/ 为目标即为越界写任务文件）。`fs.write*` 覆盖
 *  fs.writeFileSync/writeFile/writeSync/write；裸 writeFileSync/writeFile 覆盖 import 解构后的调用形态。 */
export const WRITE_FAMILY_RE =
  /\b(fs\.writeFileSync|fs\.writeFile|fs\.appendFileSync|fs\.appendFile|fs\.writeSync|fs\.write|fs\.createWriteStream|writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\b/g;

/** tasks 路径引用：`tasks` 后紧跟引号 / 斜杠 / 反斜杠（`"tasks"`、`tasks/`、`` `tasks/${id}.md` ``）。 */
export const TASKS_PATH_RE = /tasks(?=["'`/\\])/;

/** fan-in / 落地率类载体 token（DIR-131 AC6 归因反例机械化）：goal 侧不以**本仓自身**的 task 落地
 *  指标为输入。与「Human verification」第 4 点的 grep 词表一致——fan-in / full-suite-state / 落地率
 *  应无非注释命中，**除非**落在 `exemptSpans` 认定的目标探针豁免区（见下）。
 *  读载体文件必然把路径写成字符串，故检测范围 = 非注释位置（含字符串字面量），不含 bash `#`。 */
export const FANIN_CARRIER_RE = /(fan-in|full-suite-state|落地率)/g;

/** 目标探针豁免区标记（人 2026-09-12 DIR-131 AC6 口径补充裁定，三选一之①）：「读外部被驱动系统」
 *  与「读本仓自身落地率」是两件事——前者不构成 AC6 的反例形态（它不驱动/佐证本仓任何 task 的判定），
 *  故给它一个**结构性**豁免，而不是放宽/删除 Detector 3 本身（后者会重新打开真正的反例形态）。 */
export const TARGET_PROBE_EXEMPT_BEGIN = "DIR-131-TARGET-PROBE-BEGIN";
export const TARGET_PROBE_EXEMPT_END = "DIR-131-TARGET-PROBE-END";

/** 标记必须是【独占一行】的 `//` 行注释（锚定整行，⛔ 不是子串搜索）——散文里提及这两个词
 *  （本文件、goal-driver.ts 的头注释都会提及）因此不会被误认成标记，无需额外转义/回避。 */
const TARGET_PROBE_BEGIN_RE = new RegExp(`^[ \\t]*//[ \\t]*${TARGET_PROBE_EXEMPT_BEGIN}[ \\t]*$`, "gm");
const TARGET_PROBE_END_RE = new RegExp(`^[ \\t]*//[ \\t]*${TARGET_PROBE_EXEMPT_END}[ \\t]*$`, "gm");

/** 求豁免区间（字符位置，闭区间）。⛔ fail-closed：必须**恰好一对**、且 BEGIN 在 END 之前，
 *  否则（未标记 / 标记数不对 / 顺序颠倒）返回空——不豁免任何位置，退回 Detector 3 的原始行为。 */
export function exemptSpans(src: string): Array<[number, number]> {
  const begins: number[] = [];
  const ends: number[] = [];
  let m: RegExpExecArray | null;
  TARGET_PROBE_BEGIN_RE.lastIndex = 0;
  while ((m = TARGET_PROBE_BEGIN_RE.exec(src)) !== null) begins.push(m.index);
  TARGET_PROBE_END_RE.lastIndex = 0;
  while ((m = TARGET_PROBE_END_RE.exec(src)) !== null) ends.push(m.index);
  if (begins.length !== 1 || ends.length !== 1) return [];
  if (!(begins[0] < ends[0])) return [];
  return [[begins[0], ends[0]]];
}

function inAnySpan(i: number, spans: Array<[number, number]>): boolean {
  for (const [s, e] of spans) if (i >= s && i <= e) return true;
  return false;
}

export interface BoundaryViolation {
  /** task-verb = task 机制动词；task-write = 写家族调用指向 tasks/；fanin-read = 非注释位置引用 fan-in / 落地率类载体。 */
  kind: "task-verb" | "task-write" | "fanin-read";
  /** 命中的动词 / 写家族函数名 / 载体 token。 */
  token: string;
  /** 命中所在 1-based 行号。 */
  line: number;
  /** 命中所在整行（trimmed）。 */
  snippet: string;
}

export interface BoundaryCheckResult {
  ok: boolean;
  notEvaluated: boolean;
  target: string;
  violations: BoundaryViolation[];
}

/**
 * 标记每个字符的类别（单趟线性状态机，`maskComments` 手法——fan-in-workflow-retirement-check.ts /
 * registry-bare-filename-scan.ts 同语义——扩展为【同时】标记字符串字面量内部）：
 *   comment[i]=1 ⇒ 行注释 `//` / 块注释 `/* *​/` 内部；⛔ 不含 bash `#`——本检查只扫 .ts，`#` 是
 *   私有字段（`this.#x`），当注释会误屏蔽真代码（硬规则 2 的位置判定不允许这种假阴性）。
 *   str[i]=1    ⇒ 字符串 / 模板字面量内部（'…' / "…" / `…`）。
 * 两个掩码都保留长度，索引与原源一一对应。字符串分支先于注释分支，故字符串内的 `//` 不被当注释。
 */
export function maskCommentsAndStrings(src: string): { comment: Uint8Array; str: Uint8Array } {
  const comment = new Uint8Array(src.length);
  const str = new Uint8Array(src.length);
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
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          str[i] = 1;
          if (i + 1 < n) str[i + 1] = 1;
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        str[i] = 1;
        i++;
      }
      continue;
    }
    i++;
  }
  return { comment, str };
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

/** 把满足 `keep(i)` 的位置保留原字符、其余替换为空格（保留长度，索引与原源对齐）。 */
function keepOnly(src: string, keep: (i: number) => boolean): string {
  const chars: string[] = [];
  for (let i = 0; i < src.length; i++) chars.push(keep(i) ? src[i] : " ");
  return chars.join("");
}

/** 写家族调用后扫描的语句窗口上界：下一个 `;`（或 +400 字符封顶，防病态长行）。 */
function statementWindowEnd(src: string, start: number): number {
  const cap = Math.min(src.length, start + 400);
  const semi = src.indexOf(";", start);
  if (semi === -1) return cap;
  return Math.min(semi + 1, cap);
}

/**
 * 纯判定：给定 goal-driver.ts 源文本，返回 task 写路径调用点清单（空 = 合规）。
 * 按位置判定（硬规则 2）——屏蔽注释与字符串字面量后再找动词；写家族调用另查其语句窗口是否引用
 * tasks/ 路径（路径参数本身是字符串，故窗口扫描只在「仅屏蔽注释」的文本上进行）。
 */
export function checkGoalDriverBoundary(src: string): BoundaryViolation[] {
  const { comment, str } = maskCommentsAndStrings(src);
  const isCode = (i: number) => comment[i] !== 1 && str[i] !== 1;
  const violations: BoundaryViolation[] = [];

  // Detector 1 — task 机制动词：代码位置（注释 + 字符串都屏蔽）出现即越界。
  const codeText = keepOnly(src, isCode);
  let m: RegExpExecArray | null;
  TASK_VERB_RE.lastIndex = 0;
  while ((m = TASK_VERB_RE.exec(codeText)) !== null) {
    violations.push({
      kind: "task-verb",
      token: m[1],
      line: lineOf(src, m.index),
      snippet: snippetOf(src, m.index),
    });
  }

  // Detector 2 — 写家族调用指向 tasks/：写函数在代码位置，且其语句窗口内引用 tasks 路径。
  // 在「仅屏蔽注释」的文本上匹配写函数（字符串保留，故能看见路径参数），再用 str 掩码跳过
  // 落在字符串内部的写函数名（那只是文案提及，不是调用）。
  const commentMaskedText = keepOnly(src, (i) => comment[i] !== 1);
  WRITE_FAMILY_RE.lastIndex = 0;
  while ((m = WRITE_FAMILY_RE.exec(commentMaskedText)) !== null) {
    if (str[m.index] === 1) continue; // 写函数名落在字符串内部——不是调用
    const window = commentMaskedText.slice(m.index, statementWindowEnd(commentMaskedText, m.index));
    if (TASKS_PATH_RE.test(window)) {
      violations.push({
        kind: "task-write",
        token: m[1],
        line: lineOf(src, m.index),
        snippet: snippetOf(src, m.index),
      });
    }
  }

  // Detector 3 — fan-in / 落地率类载体（DIR-131 AC6 归因反例机械化）：goal 侧不以**本仓自身**的
  // task 落地指标为输入。在「仅屏蔽注释」的文本上匹配（字符串保留——读载体文件必然把路径写成字符串），
  // 非注释位置引用即越界；⛔ 除非同时落在 `exemptSpans` 认定的目标探针豁免区**且**在字符串字面量内部
  // （人 2026-09-12 DIR-131 AC6 口径补充裁定：「读外部被驱动系统」≠「读本仓自身落地率」，前者不是
  // AC6 的反例形态）——两个条件缺一都仍判红，标记不配对时豁免区为空集，行为与澄清前完全一致。
  const exempt = exemptSpans(src);
  FANIN_CARRIER_RE.lastIndex = 0;
  while ((m = FANIN_CARRIER_RE.exec(commentMaskedText)) !== null) {
    if (str[m.index] === 1 && inAnySpan(m.index, exempt)) continue; // 目标探针载荷字符串内 ⇒ 豁免
    violations.push({
      kind: "fanin-read",
      token: m[1],
      line: lineOf(src, m.index),
      snippet: snippetOf(src, m.index),
    });
  }

  return violations;
}

/** 组合判定（含目标文件读取）。RED(1) > NOT-EVALUATED(3) > PASS(0)。 */
export function runCheck(target: string): BoundaryCheckResult {
  let src: string;
  try {
    src = fs.readFileSync(target, "utf8");
  } catch {
    return { ok: true, notEvaluated: true, target, violations: [] };
  }
  const violations = checkGoalDriverBoundary(src);
  return { ok: violations.length === 0, notEvaluated: false, target, violations };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      `goal-driver-task-boundary-check.ts — goal/task 职责边界防回归（DIR-131）：goal-driver.ts 无 task 写路径调用点。
usage: node --no-warnings --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts [--root <dir>] [--goal-driver <path>] [--json]\n`,
    );
    return 0;
  }
  const root = path.resolve(parseArg(argv, "--root") ?? DEFAULT_ROOT);
  const goalDriverArg = parseArg(argv, "--goal-driver");
  const target = goalDriverArg ? path.resolve(goalDriverArg) : path.join(root, GOAL_DRIVER_REL);
  const json = argv.includes("--json");

  const res = runCheck(target);

  if (json) {
    process.stdout.write(`${JSON.stringify(res)}\n`);
  } else if (res.notEvaluated) {
    process.stderr.write(`goal-driver-task-boundary-check: NOT-EVALUATED — target file missing or unreadable: ${res.target}\n`);
  } else if (res.ok) {
    process.stdout.write(
      "goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads outside the target-probe exempt span\n",
    );
  } else {
    process.stderr.write(`goal-driver-task-boundary-check: RED (${res.violations.length} violation(s))\n`);
    for (const v of res.violations) {
      process.stderr.write(`  - [${v.kind}] ${v.token} @ line ${v.line}: ${v.snippet}\n`);
    }
  }

  if (res.notEvaluated) return 3;
  return res.ok ? 0 : 1;
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// expectedBase ⇒ 恒为真 ⇒ 被 import 时就跑一整轮（goal-driver.ts 同款注释）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
