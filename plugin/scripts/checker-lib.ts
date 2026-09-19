// checker-lib.ts — gap-crystallization-five-directions ④: 公共判定原语抽库。
// 「按位置不按关键词」与「枚举式存在性」仓库此前各实现过两次却未抽库
// (drive-contract-check.ts / test-framework-policy-check.ts), 写 A16 时又犯第三次。
// 抽成库后, 新检查器必须在 capability-catalog 的 MATCHING 表声明自己用了哪种匹配
// (表在 capability-catalog-declarations.json —— gap-arch-catalog-declarations-leave-bash 把它搬出了 .sh)
// (匹配方式: position | keyword | enumerative | n/a)。
//
// Primitive 1 — matchAtCommandPosition: 在「命令/代码位置」匹配, 绝不在注释/字符串/正则字面量里
//   匹配 (按位置不按关键词, CLAUDE.md 硬规则 2)。两种形态:
//     maskNonCode: true  跳过注释/字符串/正则字面量 (test-framework-policy 风格 — 代码位置判定)
//     maskNonCode: false 全文匹配 (drive-contract 风格 — 结构性签名, 在文档正文里判定)
//   `buildNonCodeMask` 是 maskNonCode:true 的底层状态机, 从 test-framework-policy-check.ts 原样抽出。
//
// Primitive 2 — enumerativeExistence: 枚举式存在性 (CLAUDE.md 硬规则 3)。
//   布尔化的存在性检查会把「对象没了」伪装成「检查失败」; 枚举式返回 present/absent 两个清单,
//   缺席是一个事实 (清单), 不是判决 (boolean)。调用方据此区分「0 个存在」与「检查失败」。
//
// 该文件同时被 capability-catalog 的 QUESTION 表声明为仓库能力 (capability-catalog-declarations.json)
// ("Do shared checker primitives (position-matching / enumerative existence) behave correctly?").

// ── Primitive 1: position-based matching (按位置不按关键词) ─────────────────────────────────────────

/** 关键字之后 `/` 明确开始一个正则字面量 (标准 lexer 启发; `return /re/` 不能被读成除法)。 */
const REGEX_PRECURSOR_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/** `i` 位置的 `/` 是否应被读成正则字面量开始? 实现常见消歧: 语句开始 (空白后)、`=`/`(`/`,`/`{` 等后、
 * `return`-类关键字后是正则; 紧跟操作数 (`a / b`, `) / b`, `5 / 2`, `x++ / 2`) 是除法。 */
export function isRegexStart(prevCode: string, src: string, i: number): boolean {
  if (prevCode === "") return true; // start of file
  if (/\s/.test(prevCode)) return true; // statement start — division never directly follows space
  // postfix ++ / -- : `x++ / 2` and `x-- / 2` are division, not a regex
  if ((prevCode === "+" || prevCode === "-") && src[i - 2] === prevCode) return false;
  if (/[A-Za-z0-9_$]/.test(prevCode)) {
    // an operand — unless the token just before was a regex-precursor keyword
    const m = src.slice(0, i).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    return m ? REGEX_PRECURSOR_KEYWORDS.has(m[1]) : false;
  }
  if (prevCode === ")" || prevCode === "]" || prevCode === '"' || prevCode === "'" || prevCode === "`") return false; // division
  return true; // `( , = [ ! & | ? { } ; : ^ ~` and other punctuation → regex
}

/** 构建标记每个「非代码」位置的掩码: 行注释、块注释、字符串/模板字面量、正则字面量。
 * 线性状态机 — 不像正则, 它不会被注释里的 glob 模式骗到 (REFUTE round-1 回归), 也掩掉正则字面量
 * 使写成正则字面量的 `/import { test } from "node:test"/` 不能满足位置判定 (REFUTE round-2)。 */
export function buildNonCodeMask(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  let prevCode = ""; // last CODE character emitted (for regex-literal disambiguation)
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
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
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      mask[i] = 1; i++;
      while (i < n) {
        mask[i] = 1;
        if (src[i] === "\\") { if (i + 1 < n) { mask[i + 1] = 1; i += 2; } else { i++; } continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      prevCode = q; // the closing quote is what a following `/` sees (division)
      continue;
    }
    if (c === "/" && isRegexStart(prevCode, src, i)) {
      mask[i] = 1; i++;
      let inClass = false;
      while (i < n) {
        mask[i] = 1;
        const cc = src[i];
        if (cc === "\\") { if (i + 1 < n) { mask[i + 1] = 1; i += 2; } else { i++; } continue; }
        if (cc === "[") inClass = true;
        else if (cc === "]") inClass = false;
        else if (cc === "/" && !inClass) { i++; break; }
        else if (cc === "\n") { i++; break; } // unterminated regex — bail out of the literal
        i++;
      }
      continue;
    }
    prevCode = c;
    i++;
  }
  return mask;
}

/** 一个位置判定命中: 行、列、命中的文本。 */
export interface PositionalHit {
  line: number;
  col: number;
  match: string;
}

/** matchAtCommandPosition 的选项。 */
export interface MatchAtCommandPositionOpts {
  /** 跳过注释/字符串/正则字面量位置 (代码位置判定)。默认 false (全文结构签名判定)。 */
  maskNonCode?: boolean;
}

/** 源文本里 `idx` 的 1-based 行号。 */
function lineOf(text: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** 源文本里 `idx` 的 1-based 列号。 */
function colOf(text: string, idx: number): number {
  const nl = text.lastIndexOf("\n", idx);
  return idx - nl;
}

/**
 * matchAtCommandPosition — 「按位置不按关键词」原语。对 `text` 跑 `re` (会被转成全局正则),
 * 返回命中清单。`maskNonCode:true` 时, 命中的【起点】必须落在代码位置 (跳过注释/字符串/正则) — 起点
 * 是命令/结构关键字 (如 `import`), 结构的其余部分 (如模块说明符字符串 `"node:test"`) 天然是字符串,
 * 不能要求整段都是代码。`maskNonCode:false` 时全文匹配 (drive-contract 的结构性签名在文档正文里判定)。
 * 返回命中清单 — 调用方据此判断「有没有」, 空数组 = 无命中。
 */
export function matchAtCommandPosition(text: string, re: RegExp, opts: MatchAtCommandPositionOpts = {}): PositionalHit[] {
  const mask = opts.maskNonCode ? buildNonCodeMask(text) : null;
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const hits: PositionalHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    const start = m.index;
    const atCode = mask === null || mask[start] === 0;
    if (atCode) hits.push({ line: lineOf(text, start), col: colOf(text, start), match: m[0] });
    if (m[0].length === 0) global.lastIndex++; // never loop forever on a zero-width match
  }
  return hits;
}

/** matchAtCommandPosition 的布尔便捷形态 — 有命中即 true。 */
export function hasMatchAtCommandPosition(text: string, re: RegExp, opts: MatchAtCommandPositionOpts = {}): boolean {
  return matchAtCommandPosition(text, re, opts).length > 0;
}

// ── Primitive 2: enumerative existence (枚举式存在性) ───────────────────────────────────────────────

/** 枚举式存在性: 把 `items` 分成 present / absent 两个清单。
 *   present  = 谓词为真的项 (对象「在场」)
 *   absent   = 谓词为假的项 (对象「缺席」) — 缺席是清单里的事实, 不是布尔 false 冒充「检查失败」。
 * 调用方应消费 absent.length (缺席清单), 而不是把整个存在性压缩成一个 boolean。 */
export function enumerativeExistence<T>(items: readonly T[], present: (item: T) => boolean): { present: T[]; absent: T[] } {
  const presentList: T[] = [];
  const absentList: T[] = [];
  for (const it of items) {
    if (present(it)) presentList.push(it);
    else absentList.push(it);
  }
  return { present: presentList, absent: absentList };
}
