#!/usr/bin/env node
// sh-census-check.ts — shell 层普查检查器：对每个 tracked `.sh` 给出「是程序还是胶水」的可复核读数，
// 并对两个【会回升】的量设「只降不升」棘轮。
// (tasks/gap-arch-sh-census-check；来源 orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19
//  §1.3 / §2 P2、P4 / §5 Phase 0b —— 本检查器是那份 SPEC 的 Phase 0b 机械载体，与 Phase 0a 的
//  plugin/scripts/import-graph-check.ts 同期落地的姊妹机件。)
//
// THE DEFECT THIS CLOSES（实测，非印象）:
//   archguard 不解析 shell。而仓库里 tracked 的 `.sh` 中有一批「以 bash 为壳、内嵌 python/node/jq 为实」
//   的程序（verify-deliver-coldstart.sh 6293 有效行、develop-deliver-tgz.sh 2346、capability-catalog.sh 2187 …；
//   ⚠️ 末例已于 2026-09-19 数据化 — gap-arch-catalog-declarations-leave-bash 把它的 10 张声明表搬进
//   capability-catalog-declarations.json，该 .sh 现为 14 有效行的薄入口。本节数字保留为立案时的读数，
//   ⛔ 不要把它当现状引用），
//   另有 `experiments/**/scripts/` 与 `plugin/scripts/` 之间字节相同的重复副本。
//   在这之前【没有任何读数在盯它们】⇒ 后续 Phase 1/5 的「收敛了」只能靠断言（SPEC §2 P2/P4）。
//   两个量都是「会回升」的（新增一个内嵌解释器的脚本 / 复制一份副本），所以必须是棘轮而不是一次性读数。
//
// 口径（每条都对应一次已发生的错误；本文件是这些口径的唯一实现，别处不得再复制一份）:
//   · 数据源 = `git ls-files`，⛔ 不用 `find`：一次 `find` 曾扫进 `.claude/worktrees/*` 得到 5213，
//     而真值只有 236 个 tracked `.sh`（SPEC §1.3 / §7 的自我更正）。排除 `plugin/scripts/checker-mutation-cases/`
//     （测试夹具）与 `archive/`。AC2 用一条独立 shell 命令重算同一集合，两者必须逐字相等。
//   · 有效行 = 去空行、去【纯注释行】（首个非空白字符是 `#`，含 shebang）后的行数。
//   · 内嵌解释器按【代码位置】判定（CLAUDE.md 硬规则 2「按位置不按关键词」）：注释 / 字符串 / heredoc 体
//     之外出现的命令词才算。`node` 只在带 `--experimental-strip-types`、`-e`/`--eval`、或直接跑 `.ts` 时算
//     （`node --test` 这类不算 —— 正是这一条把 scripts/test.sh 里满屏【注释里】的 `node --test` 挡在外面）。
//   · 重复副本 = `experiments/**/scripts/` 与 `plugin/scripts/` 下同 basename、**非符号链接**且字节相同的
//     文件对（含 `.sh` 与 `.ts`）；同一对里 experiments 侧是符号链接 ⇒ 不计入重复，计入 `symlinkedCopies`。
//   · 无调用者（orphan）= 对 tracked 的 ts/sh/mjs/js/md/yml/json（排除 `tasks/`、`docs/`、`archive/`）
//     **按 basename 做静态字符串匹配**，无任何调用者。⚠️ 这是静态候选，不是结论 —— 它会漏掉动态拼接的
//     脚本名，输出里因此叫 `orphanCandidates` 并附 `orphanMethod:"static-basename-match"`；删除前必须做
//     动态引用核对（与 SPEC §6-2 同一条纪律）。
//   · 例外清单是数据文件 `plugin/sh-census-exceptions.txt`（每行 `<path>  # <理由>`）。例外文件【单列汇总】
//     （`exceptionLines`）不计入棘轮读数 —— 但也不得从输出里消失（AC5：它必须仍出现在 `files[]` 里）。
//   · 读不懂要说出来（CLAUDE.md 硬规则 3b）：`evaluated:true|false`；git 不可用 / 无 `.sh` / 例外文件不可解析
//     ⇒ `evaluated:false` + exit 2，**不得** exit 0（一个恒绿的检查比没有检查更贵）。
//
// 两个棘轮读数（基线文件 `plugin/sh-census-baseline.json`，形态照 plugin/scripts/quay-init-closure-ratchet.ts
// 与姊妹机件 import-graph-check.ts）：读数 > 基线 ⇒ exit 1；且【工作树基线的值相对 git HEAD 基线只许降不许升】
// （否则「调高基线」就能买过闸）。bootstrap（HEAD 尚无该文件）以当前为基线并注明 `headBaseline:"absent-bootstrap"`。
//
// CLI:
//   node --experimental-strip-types plugin/scripts/sh-census-check.ts [<root>] [--json] [--selftest]
//        [--baseline <file>] [--exceptions <file>]
// exit 0 = 两个读数都不超基线且基线未被调高 · 1 = 有超出/基线被调高 · 2 = 用法或环境错误（含 evaluated:false）
//
// `--json` 顶层至少含:
//   {evaluated, files:[{path,codeLines,embedded,tsTwin,callers:{ts,sh,test,other},exception}],
//    totals:{scripts,codeLines,embeddedInterpreterScripts,embeddedInterpreterLines,exceptionLines,
//            duplicateCopies,symlinkedCopies,orphanCandidates},
//    orphanMethod, orphanCandidates:[{path,callers}], duplicates:[…], symlinked:[…], exceptions:[…],
//    baseline, verdict}

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { helpExit, isDirectEntry, flagValue, createSelftest } from "./gate-script-base.ts";
// `lineAt` was this file's own copy of the 1-based newline counter (semantic-dedup-scan
// `lineof-lineat`); the family lives once in source-text-lib.ts under ONE name.
import { lineOf } from "./source-text-lib.ts";

// ── constants ───────────────────────────────────────────────────────────────────────────────────────

export const BASELINE_FILE_REL = "plugin/sh-census-baseline.json";
export const EXCEPTIONS_FILE_REL = "plugin/sh-census-exceptions.txt";

/** 测试夹具目录（`plugin/scripts/checker-mutation-cases/**`）—— 它们本身就是「故意写坏的检查器」，
 *  不是被测对象；把它们算进普查会让读数随夹具增删漂移。 */
const FIXTURE_MARKER = "checker-mutation-cases/";
/** 只排除【顶层】`archive/`（与 AC2 的独立命令 `grep -v '^archive/'` 逐字一致）。 */
const ARCHIVE_PREFIX = "archive/";
const PLUGIN_SCRIPTS = "plugin/scripts/";
const EXPERIMENTS_PREFIX = "experiments/";

/** 内嵌解释器词表 —— 三个,顺序固定,用于 `embedded` 数组与 `totals`。 */
export const INTERPRETERS = ["node", "python3", "jq"] as const;
export type Interpreter = (typeof INTERPRETERS)[number];

/** 调用者统计的语料扩展名（SPEC §1.3「无调用者」口径：ts/sh/mjs/js/md/yml/json）。 */
const CORPUS_EXTS = [".ts", ".mts", ".cts", ".sh", ".bash", ".mjs", ".cjs", ".js", ".md", ".yml", ".yaml", ".json"];

// ── shell 代码位置掩码（注释 / 字符串 / heredoc 之外才算命令位置）────────────────────────────────────

type ShellState = "code" | "sq" | "dq" | "cmdsub" | "backtick";

interface HeredocSpec {
  delim: string;
  stripTabs: boolean;
}

/** `#` 是否开始一个注释：shell 里 `#` 只在【词的起点】才有注释语义（`a#b` 里的 `#` 是普通字符）。 */
function isCommentStart(src: string, i: number): boolean {
  if (i === 0) return true;
  const prev = src[i - 1];
  return prev === "\n" || /[ \t;&|(){}<>]/.test(prev);
}

/** 解析 `<<` 之后的 heredoc 分隔符（`<<-` 去前导 tab；`<<'X'` / `<<"X"` / `<<\X` / `<<X`）。
 *  返回 null 表示这不是一个 heredoc（例如算术左移 `$((x << 2))` 后面跟的不是词）。 */
export function parseHeredocDelim(src: string, j: number): HeredocSpec | null {
  let k = j;
  let stripTabs = false;
  if (src[k] === "-") {
    stripTabs = true;
    k++;
  }
  while (k < src.length && (src[k] === " " || src[k] === "\t")) k++;
  if (k >= src.length) return null;
  const q = src[k];
  if (q === "'" || q === '"') {
    const end = src.indexOf(q, k + 1);
    if (end === -1) return null;
    return { delim: src.slice(k + 1, end), stripTabs };
  }
  if (q === "\\") {
    const m = /^\\([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(k));
    return m ? { delim: m[1], stripTabs } : null;
  }
  const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(k));
  return m ? { delim: m[1], stripTabs } : null;
}

/**
 * 标记每个「非代码」位置的掩码：行注释、单/双引号字符串、反引号命令、heredoc 体。
 * `mask[i] === 0` ⇔ 该位置在【命令位置】。
 *
 * 三个必须做对的地方（每个都是一次实测的错误形态）:
 *   ① `$( … )` 与反引号【即使在双引号内】也是命令位置 —— `x="$(python3 - <<'PY' …)"` 是本仓库最常见的
 *      内嵌形态（develop-deliver-tgz.sh 是；capability-catalog.sh 在 2026-09-19 数据化之前也是）。把双引号整段掩掉会让
 *      「内嵌解释器」的读数归零，而那正是一个恒零且与「一切正常」同形的读数（硬规则 4）。
 *   ② heredoc 体整段掩掉，但【声明行】不掩 —— `python3 - <<'PY'` 的 `python3` 是命令，`PY` 之后到
 *      分隔符之间的正文不是。
 *   ③ heredoc 体结束后必须【回到它开始时的状态】—— 多行 `$( … <<'PY' … PY … )` 的 `)` 在正文之后，
 *      不恢复 cmdsub 状态就会把 `)` 后面的东西读成顶层代码。
 */
export function maskShellNonCode(src: string): Uint8Array {
  const n = src.length;
  const mask = new Uint8Array(n);
  let state: ShellState = "code";
  const stack: ShellState[] = [];
  let depth = 0; // 最内层 cmdsub 的括号深度
  let pending: HeredocSpec[] = [];
  let i = 0;

  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : "";

    if (state === "sq") {
      mask[i] = 1;
      if (c === "'") state = stack.pop() ?? "code";
      i++;
      continue;
    }
    if (state === "backtick") {
      mask[i] = 1;
      if (c === "\\") {
        if (i + 1 < n) mask[i + 1] = 1;
        i += 2;
        continue;
      }
      if (c === "`") state = stack.pop() ?? "code";
      i++;
      continue;
    }
    if (state === "dq") {
      mask[i] = 1;
      if (c === "\\") {
        if (i + 1 < n) mask[i + 1] = 1;
        i += 2;
        continue;
      }
      if (c === '"') {
        state = stack.pop() ?? "code";
        i++;
        continue;
      }
      if (c === "`") {
        stack.push("dq");
        state = "backtick";
        mask[i] = 0; // 反引号内是命令位置
        i++;
        continue;
      }
      if (c === "$" && d === "(") {
        stack.push("dq");
        state = "cmdsub";
        depth = 0;
        mask[i] = 0;
        mask[i + 1] = 0;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // state === "code" | "cmdsub"
    if (c === "\n") {
      if (pending.length > 0) {
        const resume = state;
        let j = i + 1;
        // 同一逻辑行上可以有多个 `<<`，它们的正文按声明顺序【依次】排在下面。
        while (pending.length > 0) {
          const spec = pending.shift() as HeredocSpec;
          for (;;) {
            if (j >= n) break;
            const eol = src.indexOf("\n", j);
            const end = eol === -1 ? n : eol;
            const line = src.slice(j, end);
            for (let k = j; k < end; k++) mask[k] = 1;
            if (end < n) mask[end] = 1; // the body line's own newline is body, not code
            j = end + 1;
            const cmp = spec.stripTabs ? line.replace(/^\t+/, "") : line;
            if (cmp.replace(/\r$/, "").trimEnd() === spec.delim) break;
          }
        }
        state = resume;
        i = j;
        continue;
      }
      i++;
      continue;
    }

    if (c === "\\") {
      mask[i] = 1;
      if (i + 1 < n) mask[i + 1] = 1;
      i += 2;
      continue;
    }
    if (c === "#" && isCommentStart(src, i)) {
      const eol = src.indexOf("\n", i);
      const end = eol === -1 ? n : eol;
      for (let k = i; k < end; k++) mask[k] = 1;
      i = end;
      continue;
    }
    if (c === "'") {
      stack.push(state);
      state = "sq";
      i++;
      continue;
    }
    if (c === '"') {
      stack.push(state);
      state = "dq";
      i++;
      continue;
    }
    if (c === "`") {
      stack.push(state);
      state = "backtick";
      i++;
      continue;
    }
    if (c === "$" && d === "(") {
      stack.push(state);
      state = "cmdsub";
      depth = 0;
      i += 2;
      continue;
    }
    if (state === "cmdsub") {
      if (c === "(") {
        depth++;
        i++;
        continue;
      }
      if (c === ")") {
        if (depth === 0) state = stack.pop() ?? "code";
        else depth--;
        i++;
        continue;
      }
    }
    if (c === "<" && d === "<") {
      // ⛔ `<<<` is a HERESTRING, not a heredoc. Advancing only past the first two `<` makes the
      // SECOND `<` look like a fresh `<<` start (`src[i+2]` is then `"` or a word, i.e. not `<`),
      // and the herestring's word gets registered as a heredoc DELIMITER — after which every
      // following line is masked as a body that never closes. Measured (that line number is from
      // before capability-catalog.sh was data-ized on 2026-09-19; the heredoc SHAPE it demonstrates
      // is what this branch exists for): capability-catalog.sh:2272 `done <<<"${DOC_REFERENCED_SH}"`
      // masked the whole rest of the file and zeroed its reading.
      if (src[i + 2] === "<") {
        i += 3;
        continue;
      }
      const spec = parseHeredocDelim(src, i + 2);
      if (spec) pending.push(spec);
      i += 2;
      continue;
    }
    i++;
  }
  return mask;
}

/** 该位置的词是否是【命令词】：前一个字符是空白/分隔符/行首，后一个字符不是词字符。
 *  ⛔ 不用裸 `\b`：`node:*`（case 分支模式）里的 `node` 会被 `\b` 判为边界，而它是一个 glob 模式不是命令。 */
function isCommandWord(src: string, start: number, end: number): boolean {
  if (start > 0 && !/[\s;&|(){}<>`]/.test(src[start - 1])) return false;
  const after = src[end] ?? "";
  return after === "" || !/[A-Za-z0-9_-]/.test(after);
}

/** `node` 的限定条件（口径：带 `--experimental-strip-types`、`-e`/`--eval`、或直接跑 `.ts`）。
 *  只看【本物理行的剩余部分】——`node` 词本身已在命令位置，故行内的引号参数（`"…/x.ts"`）也算数，
 *  否则 `node --experimental-strip-types "${SCRIPT_DIR}/x.ts"` 这种仓库里最常见的形态会被漏掉。 */
function nodeQualifies(src: string, end: number): boolean {
  const eol = src.indexOf("\n", end);
  const tail = src.slice(end, eol === -1 ? src.length : eol);
  if (tail.includes("--experimental-strip-types")) return true;
  if (/(^|\s)(-e|--eval)(\s|$)/.test(tail)) return true;
  return /\.ts(["'`)\s;&|]|$)/.test(tail);
}

export interface EmbeddedHit {
  interpreter: Interpreter;
  line: number;
  /** 命中的证据行（前 3 条进 notes/人工核对用）。 */
  evidence: string;
}

/**
 * 抽取一个 shell 源里【在命令位置上】出现过的内嵌解释器（去重到词表，按 INTERPRETERS 顺序）。
 * 返回每个解释器的首个命中（行号 + 证据），调用方只消费 `interpreter` 与计数。
 */
export function extractEmbeddedInterpreters(src: string): EmbeddedHit[] {
  const mask = maskShellNonCode(src);
  const first = new Map<Interpreter, EmbeddedHit>();

  const consider = (name: Interpreter, start: number, end: number): void => {
    if (first.has(name)) return;
    if (mask[start] !== 0) return;
    if (!isCommandWord(src, start, end)) return;
    if (name === "node" && !nodeQualifies(src, end)) return;
    const line = lineOf(src, start);
    const lineStart = src.lastIndexOf("\n", start) + 1;
    const lineEnd = src.indexOf("\n", start);
    first.set(name, { interpreter: name, line, evidence: src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd).trim().slice(0, 160) });
  };

  const pyJq = /\b(python3|jq)\b/g;
  let m: RegExpExecArray | null;
  while ((m = pyJq.exec(src)) !== null) {
    consider(m[1] as Interpreter, m.index, m.index + m[1].length);
  }
  const node = /\bnode\b/g;
  while ((m = node.exec(src)) !== null) {
    consider("node", m.index, m.index + 4);
  }
  return INTERPRETERS.filter((k) => first.has(k)).map((k) => first.get(k) as EmbeddedHit);
}

/** 有效行 = 去空行、去纯注释行（首个非空白字符是 `#`，含 shebang）。 */
export function countCodeLines(src: string): number {
  let n = 0;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (t.startsWith("#")) continue;
    n++;
  }
  return n;
}

// ── 文件枚举 / 引用扫描 / 普查 ───────────────────────────────────────────────────────────────────────

export function gitLsFilesAll(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\0").filter((s) => s.length > 0);
}

/** 普查对象: tracked `*.sh`，排除测试夹具与顶层 archive（与 AC2 的独立命令逐字同集合）。 */
export function isCensusScript(rel: string): boolean {
  if (!rel.endsWith(".sh")) return false;
  if (rel.includes(FIXTURE_MARKER)) return false;
  if (rel.startsWith(ARCHIVE_PREFIX)) return false;
  return true;
}

export interface CallerCounts {
  ts: number;
  sh: number;
  test: number;
  other: number;
}

/** 语料: tracked 的 ts/sh/mjs/js/md/yml/json，排除 tasks/ docs/ archive/。 */
export function isCorpusFile(rel: string): boolean {
  if (!CORPUS_EXTS.some((e) => rel.endsWith(e))) return false;
  if (rel.startsWith("tasks/") || rel.startsWith("docs/") || rel.startsWith(ARCHIVE_PREFIX)) return false;
  return true;
}

function bucketOf(rel: string): keyof CallerCounts {
  if (/(^|\/)test\/|\.test\.[cm]?[jt]sx?$/.test(rel)) return "test";
  if (/\.(ts|mts|cts)$/.test(rel)) return "ts";
  if (/\.(sh|bash)$/.test(rel)) return "sh";
  return "other";
}

/**
 * 一次扫过语料，统计每个目标 basename 被多少个文件【按 basename 字符串】引用。
 * 每 token 一次 Set 查找，内存只保留命中项 —— 语料实测 50MB / 3820 文件。
 * 自引用不计（一个脚本在自己的 usage 文本里出现自己的名字不是「有调用者」）。
 */
export function collectReferences(
  root: string,
  corpus: readonly string[],
  targets: ReadonlySet<string>,
): Map<string, CallerCounts> {
  const counts = new Map<string, CallerCounts>();
  for (const rel of corpus) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue; // 读不到的文件不是「没有引用」的证据，但它也不提供引用 —— 由调用方的 dangling/parse 面报告
    }
    const self = path.posix.basename(rel);
    const bucket = bucketOf(rel);
    const seen = new Set<string>();
    for (const token of text.split(/[^A-Za-z0-9_./-]+/)) {
      if (token.length === 0) continue;
      const slash = token.lastIndexOf("/");
      const base = slash === -1 ? token : token.slice(slash + 1);
      for (const cand of slash === -1 ? [token] : [token, base]) {
        if (!targets.has(cand)) continue;
        if (cand === self) continue;
        if (seen.has(cand)) continue;
        seen.add(cand);
        const c = counts.get(cand) ?? { ts: 0, sh: 0, test: 0, other: 0 };
        c[bucket]++;
        counts.set(cand, c);
      }
    }
  }
  return counts;
}

// ── 重复副本 / 符号链接 ─────────────────────────────────────────────────────────────────────────────

export interface DuplicatePair {
  experimentsPath: string;
  pluginPath: string;
}

export interface SymlinkCopy {
  experimentsPath: string;
  target: string;
}

function isPluginScript(rel: string): boolean {
  if (!rel.startsWith(PLUGIN_SCRIPTS)) return false;
  return !rel.slice(PLUGIN_SCRIPTS.length).includes("/");
}

function isExperimentsScript(rel: string): boolean {
  if (!rel.startsWith(EXPERIMENTS_PREFIX)) return false;
  const dir = rel.slice(0, rel.lastIndexOf("/"));
  return dir.endsWith("/scripts");
}

export interface CopyScan {
  duplicates: DuplicatePair[];
  symlinked: SymlinkCopy[];
  /** 同名但内容不同 —— 单列，⛔ 不得静默并进任一读数（SPEC §7：2 对已实测有差异）。 */
  differingSameName: DuplicatePair[];
}

export function scanCopies(root: string, tracked: readonly string[]): CopyScan {
  const plugin = new Map<string, string>();
  for (const rel of tracked) if (isPluginScript(rel)) plugin.set(path.posix.basename(rel), rel);
  const duplicates: DuplicatePair[] = [];
  const symlinked: SymlinkCopy[] = [];
  const differingSameName: DuplicatePair[] = [];
  for (const rel of tracked) {
    if (!isExperimentsScript(rel)) continue;
    const target = plugin.get(path.posix.basename(rel));
    if (target === undefined) continue;
    const abs = path.join(root, rel);
    let link: string | null = null;
    try {
      link = fs.lstatSync(abs).isSymbolicLink() ? fs.readlinkSync(abs) : null;
    } catch {
      continue;
    }
    if (link !== null) {
      symlinked.push({ experimentsPath: rel, target: link });
      continue;
    }
    try {
      if (fs.readFileSync(abs).equals(fs.readFileSync(path.join(root, target)))) {
        duplicates.push({ experimentsPath: rel, pluginPath: target });
      } else {
        differingSameName.push({ experimentsPath: rel, pluginPath: target });
      }
    } catch {
      /* unreadable — not counted as a duplicate (absent, not silently equal) */
    }
  }
  const byPath = (a: { experimentsPath: string }, b: { experimentsPath: string }): number =>
    a.experimentsPath.localeCompare(b.experimentsPath);
  duplicates.sort(byPath);
  symlinked.sort(byPath);
  differingSameName.sort(byPath);
  return { duplicates, symlinked, differingSameName };
}

// ── 例外清单 ───────────────────────────────────────────────────────────────────────────────────────

export interface ExceptionEntry {
  path: string;
  reason: string;
}

/**
 * 解析例外清单（每行 `<path>  # <理由>`）。可解析 = 非空且非整行注释的行必须同时有【路径】与【`#` 理由】。
 * 任一行不满足 ⇒ 返回 null ⇒ 调用方报 `evaluated:false` + exit 2（硬规则 3b：读不懂不得与合格同形）。
 */
export function parseExceptions(text: string): ExceptionEntry[] | null {
  const entries: ExceptionEntry[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    const hash = line.indexOf("#");
    if (hash === -1) return null;
    const p = line.slice(0, hash).trim();
    const reason = line.slice(hash + 1).trim();
    if (p.length === 0 || reason.length === 0) return null;
    if (seen.has(p)) continue;
    seen.add(p);
    entries.push({ path: p, reason });
  }
  return entries;
}

// ── the reading ─────────────────────────────────────────────────────────────────────────────────────

export interface ShCensusFile {
  path: string;
  codeLines: number;
  embedded: Interpreter[];
  /** 同目录同名的 `.ts` 孪生是否存在（SPEC §1.3 形态 S3 的读数）。 */
  tsTwin: boolean;
  callers: CallerCounts;
  exception: boolean;
}

export interface CensusTotals {
  scripts: number;
  codeLines: number;
  embeddedInterpreterScripts: number;
  embeddedInterpreterLines: number;
  exceptionLines: number;
  duplicateCopies: number;
  symlinkedCopies: number;
  orphanCandidates: number;
}

export interface CensusReading {
  /** false ⇒ 普查读不出来（NOT-EVALUATED）—— ⛔ 绝不与「读数为 0」同形。 */
  evaluated: boolean;
  reason?: string;
  files: ShCensusFile[];
  duplicates: DuplicatePair[];
  symlinked: SymlinkCopy[];
  differingSameName: DuplicatePair[];
  exceptions: ExceptionEntry[];
  /** 例外清单里点名、但不在 census 集合中的路径 —— 单列，不静默消失。 */
  exceptionMissing: string[];
  orphanCandidates: string[];
  orphanMethod: "static-basename-match";
  totals: CensusTotals;
}

const EMPTY_TOTALS: CensusTotals = {
  scripts: 0,
  codeLines: 0,
  embeddedInterpreterScripts: 0,
  embeddedInterpreterLines: 0,
  exceptionLines: 0,
  duplicateCopies: 0,
  symlinkedCopies: 0,
  orphanCandidates: 0,
};

function notEvaluated(reason: string): CensusReading {
  return {
    evaluated: false,
    reason,
    files: [],
    duplicates: [],
    symlinked: [],
    differingSameName: [],
    exceptions: [],
    exceptionMissing: [],
    orphanCandidates: [],
    orphanMethod: "static-basename-match",
    totals: { ...EMPTY_TOTALS },
  };
}

export interface CensusOptions {
  /** 例外清单绝对路径（默认 `<root>/plugin/sh-census-exceptions.txt`）。 */
  exceptionsAbs?: string;
  /** 语料扫描开关 —— 测试里的极小 fixture 也照常扫（默认开）。 */
  scanReferences?: boolean;
}

export function exceptionsFile(root: string): string {
  return path.join(root, ...EXCEPTIONS_FILE_REL.split("/"));
}

export function readCensus(root: string, opts: CensusOptions = {}): CensusReading {
  let tracked: string[];
  try {
    tracked = gitLsFilesAll(root);
  } catch (err) {
    return notEvaluated(`git ls-files failed in ${root}: ${(err as Error).message.split("\n")[0]}`);
  }

  const scripts = tracked.filter(isCensusScript).sort();
  if (scripts.length === 0) {
    return notEvaluated(`no tracked *.sh found under ${root} (excluding ${FIXTURE_MARKER} and ${ARCHIVE_PREFIX}) — nothing to census`);
  }

  const exceptionsAbs = opts.exceptionsAbs ?? exceptionsFile(root);
  let exceptions: ExceptionEntry[];
  try {
    const parsed = parseExceptions(fs.readFileSync(exceptionsAbs, "utf8"));
    if (parsed === null) {
      return notEvaluated(`exception list is unparseable (${exceptionsAbs}) — every line must be \`<path>  # <reason>\``);
    }
    exceptions = parsed;
  } catch (err) {
    return notEvaluated(`exception list unreadable (${exceptionsAbs}): ${(err as Error).message.split("\n")[0]}`);
  }
  const exceptionSet = new Set(exceptions.map((e) => e.path));

  const trackedSet = new Set(tracked);
  const targets = new Set(scripts.map((s) => path.posix.basename(s)));
  const references = opts.scanReferences === false ? new Map<string, CallerCounts>() : collectReferences(root, tracked.filter(isCorpusFile), targets);

  const files: ShCensusFile[] = [];
  const readFailures: string[] = [];
  let codeLines = 0;
  let exceptionLines = 0;
  let embeddedScripts = 0;
  let embeddedLines = 0;

  for (const rel of scripts) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(root, rel), "utf8");
    } catch (err) {
      readFailures.push(`${rel}: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    const lines = countCodeLines(src);
    const embedded = extractEmbeddedInterpreters(src).map((h) => h.interpreter);
    const isException = exceptionSet.has(rel);
    const stem = rel.slice(0, rel.length - 3);
    const tsTwin = trackedSet.has(`${stem}.ts`);
    const callers = references.get(path.posix.basename(rel)) ?? { ts: 0, sh: 0, test: 0, other: 0 };
    files.push({ path: rel, codeLines: lines, embedded, tsTwin, callers, exception: isException });
    codeLines += lines;
    if (isException) exceptionLines += lines;
    else if (embedded.length > 0) {
      embeddedScripts++;
      embeddedLines += lines;
    }
  }

  if (readFailures.length > 0) {
    return notEvaluated(`could not read ${readFailures.length} tracked *.sh: ${readFailures.slice(0, 3).join("; ")}`);
  }

  const copies = scanCopies(root, tracked);
  const orphanCandidates = files
    .filter((f) => {
      const c = f.callers;
      return c.ts + c.sh + c.test + c.other === 0;
    })
    .map((f) => f.path);

  return {
    evaluated: true,
    files,
    duplicates: copies.duplicates,
    symlinked: copies.symlinked,
    differingSameName: copies.differingSameName,
    exceptions,
    exceptionMissing: exceptions.map((e) => e.path).filter((p) => !trackedSet.has(p)).sort(),
    orphanCandidates,
    orphanMethod: "static-basename-match",
    totals: {
      scripts: files.length,
      codeLines,
      embeddedInterpreterScripts: embeddedScripts,
      embeddedInterpreterLines: embeddedLines,
      exceptionLines,
      duplicateCopies: copies.duplicates.length,
      symlinkedCopies: copies.symlinked.length,
      orphanCandidates: orphanCandidates.length,
    },
  };
}

// ── the ratchet ─────────────────────────────────────────────────────────────────────────────────────

export interface Baseline {
  embeddedInterpreterLines: number;
  duplicateCopies: number;
}

export const BASELINE_AXES = ["embeddedInterpreterLines", "duplicateCopies"] as const;

export function measuredOf(r: CensusReading): Baseline {
  return { embeddedInterpreterLines: r.totals.embeddedInterpreterLines, duplicateCopies: r.totals.duplicateCopies };
}

export interface RatchetVerdict {
  ok: boolean;
  over: (keyof Baseline)[];
  baselineRaised: (keyof Baseline)[];
  headBaseline: Baseline | null;
  /** true = HEAD 尚未携带该基线文件（bootstrap）—— 明写，不静默当作「无约束」。 */
  bootstrap: boolean;
}

/** 只降不升判定（对基线文件自身）：工作树基线任一轴高于 git HEAD 基线 ⇒ raised。 */
export function checkBaselineShrinkOnly(
  worktree: Baseline | null,
  head: Baseline | null,
): { raised: (keyof Baseline)[]; bootstrap: boolean } {
  if (head === null) return { raised: [], bootstrap: true };
  if (worktree === null) return { raised: [], bootstrap: false };
  return { raised: BASELINE_AXES.filter((k) => worktree[k] > head[k]), bootstrap: false };
}

export function judge(measured: Baseline, baseline: Baseline, worktree: Baseline | null, head: Baseline | null): RatchetVerdict {
  const over = BASELINE_AXES.filter((k) => measured[k] > baseline[k]);
  const shrink = checkBaselineShrinkOnly(worktree, head);
  return { ok: over.length === 0 && shrink.raised.length === 0, over, baselineRaised: shrink.raised, headBaseline: head, bootstrap: shrink.bootstrap };
}

export function baselineFile(root: string): string {
  return path.join(root, ...BASELINE_FILE_REL.split("/"));
}

export function readBaselineFile(abs: string): Baseline | null {
  try {
    const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as Partial<Baseline>;
    if (typeof raw.embeddedInterpreterLines !== "number" || typeof raw.duplicateCopies !== "number") return null;
    return { embeddedInterpreterLines: raw.embeddedInterpreterLines, duplicateCopies: raw.duplicateCopies };
  } catch {
    return null;
  }
}

/** 读 git HEAD 携带的基线；HEAD 无该文件（或 git 不可用）⇒ null（= bootstrap，由调用方先确认 HEAD 可解析）。 */
export function readHeadBaseline(root: string, relPath: string): Baseline | null {
  try {
    // stderr captured, never inherited: the bootstrap state (HEAD carries no baseline yet) makes git
    // print `fatal: path … exists on disk, but not in 'HEAD'` — leaking it would put a scary line in
    // every scoped-gate log for a state that is explicitly allowed.
    const out = execFileSync("git", ["-C", root, "show", `HEAD:${relPath}`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const raw = JSON.parse(out) as Partial<Baseline>;
    if (typeof raw.embeddedInterpreterLines !== "number" || typeof raw.duplicateCopies !== "number") return null;
    return { embeddedInterpreterLines: raw.embeddedInterpreterLines, duplicateCopies: raw.duplicateCopies };
  } catch {
    return null;
  }
}

export interface Decision {
  reading: CensusReading;
  baseline: Baseline | null;
  verdict: RatchetVerdict | null;
  /** 本 root 的退出码：0 PASS · 1 FAIL · 2 用法/环境错误（含 evaluated:false 与基线不可读）。 */
  code: number;
  relForHead: string;
}

export function decide(root: string, opts: CensusOptions & { baselineAbs?: string } = {}): Decision {
  const reading = readCensus(root, opts);
  if (!reading.evaluated) return { reading, baseline: null, verdict: null, code: 2, relForHead: "" };
  const baselineAbs = opts.baselineAbs ?? baselineFile(root);
  const baseline = readBaselineFile(baselineAbs);
  if (baseline === null) return { reading, baseline: null, verdict: null, code: 2, relForHead: "" };
  const relForHead = path.relative(root, baselineAbs).split(path.sep).join("/");
  const inRepo = relForHead.length > 0 && !relForHead.startsWith("../") && !path.isAbsolute(relForHead);
  let headBaseline: Baseline | null = null;
  if (inRepo) {
    try {
      execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { stdio: "pipe" });
      headBaseline = readHeadBaseline(root, relForHead);
    } catch {
      headBaseline = null; // 无 HEAD（全新 fixture 仓）⇒ bootstrap
    }
  }
  const verdict = judge(measuredOf(reading), baseline, baseline, headBaseline);
  return { reading, baseline, verdict, code: verdict.ok ? 0 : 1, relForHead };
}

// ── self-test（注入用例，AC1/AC6）─────────────────────────────────────────────────────────────────────

interface FixtureResult {
  reading: CensusReading;
  code: number;
}

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const GIT_ID = {
  GIT_AUTHOR_NAME: "shc-selftest",
  GIT_AUTHOR_EMAIL: "shc@example.invalid",
  GIT_COMMITTER_NAME: "shc-selftest",
  GIT_COMMITTER_EMAIL: "shc@example.invalid",
};

/** 建一个 hermetic 的 git fixture 仓（`git add` 过的 —— 数据源是 git ls-files，未跟踪的注入不可见）。 */
export function buildFixture(files: Record<string, string>, opts: { git?: boolean; symlinks?: Record<string, string> } = {}): string {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sh-census-selftest-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  for (const [rel, target] of Object.entries(opts.symlinks ?? {})) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.symlinkSync(target, abs);
  }
  if (opts.git !== false) {
    execFileSync("git", ["-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null", "init", "-q"], { cwd: root, env: GIT_ENV, stdio: "pipe" });
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: root, env: { ...GIT_ENV, ...GIT_ID }, stdio: "pipe" });
  }
  return root;
}

const FIXTURE_EXCEPTIONS = "plugin/sh-census-exceptions.txt";
const FIXTURE_BASELINE = "plugin/sh-census-baseline.json";

function withFixture(
  files: Record<string, string>,
  opts: { git?: boolean; symlinks?: Record<string, string>; baseline?: Baseline; exceptions?: string } = {},
): FixtureResult {
  const base: Record<string, string> = {
    [FIXTURE_EXCEPTIONS]: opts.exceptions ?? "",
    [FIXTURE_BASELINE]: JSON.stringify(opts.baseline ?? { embeddedInterpreterLines: 0, duplicateCopies: 0 }) + "\n",
    ...files,
  };
  const root = buildFixture(base, opts);
  try {
    const d = decide(root);
    return { reading: d.reading, code: d.code };
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/** 内嵌 python3 heredoc 的 sh（`python3 - <<'PY'` 的 `python3` 在命令位置；正文在 heredoc 体内）。 */
const SH_PY_HEREDOC = `#!/usr/bin/env bash
set -u
result="$(python3 - "$1" <<'PY'
print("hello")
PY
)"
echo "$result"
`;
/** 纯 git/进程胶水：没有任何内嵌解释器。 */
const SH_GLUE = `#!/usr/bin/env bash
set -eu
git -C "$1" merge --ff-only develop
kill -TERM "$pid"
`;
/** 只在注释与字符串里提到 python3 —— 按位置判定必须【不】计入（硬规则 2 的负控）。 */
const SH_COMMENT_ONLY = `#!/usr/bin/env bash
# this script does NOT run python3 itself
hint="use python3 to do the job"
echo "$hint"
`;
/** 带 python3 的例外文件 —— 计入 exceptionLines，不计入 embeddedInterpreterLines。 */
const SH_PY_EXCEPTION = `#!/usr/bin/env bash
python3 -c 'print(1)'
`;

interface SelftestOutcome {
  name: string;
  ok: boolean;
  expected: string;
  reading: string;
}

export function runSelftestCases(): SelftestOutcome[] {
  const out: SelftestOutcome[] = [];
  const push = (name: string, ok: boolean, expected: string, reading: string): void => {
    out.push({ name, ok, expected, reading });
  };

  // ① python3 heredoc ⇒ 计入内嵌。
  {
    const { reading } = withFixture({ "plugin/scripts/py.sh": SH_PY_HEREDOC });
    const f = reading.files.find((x) => x.path === "plugin/scripts/py.sh");
    const got = `embedded=${JSON.stringify(f?.embedded ?? null)} embeddedInterpreterScripts=${reading.totals.embeddedInterpreterScripts} embeddedInterpreterLines=${reading.totals.embeddedInterpreterLines}`;
    push("python3-heredoc-counted", f?.embedded.join(",") === "python3" && reading.totals.embeddedInterpreterLines === f?.codeLines, 'embedded=["python3"] and embeddedInterpreterLines == that file\'s codeLines', got);
  }
  // ② 纯 git/进程胶水 ⇒ 不计入。
  {
    const { reading } = withFixture({ "plugin/scripts/glue.sh": SH_GLUE });
    const f = reading.files.find((x) => x.path === "plugin/scripts/glue.sh");
    push("pure-glue-not-counted", f?.embedded.length === 0 && reading.totals.embeddedInterpreterScripts === 0, "embedded=[] and embeddedInterpreterScripts=0", `embedded=${JSON.stringify(f?.embedded ?? null)} embeddedInterpreterScripts=${reading.totals.embeddedInterpreterScripts}`);
  }
  // ③ 只在注释/字符串里提到 python3 ⇒ 不计入。
  {
    const { reading } = withFixture({ "plugin/scripts/comment-only.sh": SH_COMMENT_ONLY });
    const f = reading.files.find((x) => x.path === "plugin/scripts/comment-only.sh");
    push("comment-mention-not-counted", f?.embedded.length === 0, "embedded=[] (注释/字符串里的 python3 不是命令位置)", `embedded=${JSON.stringify(f?.embedded ?? null)}`);
  }
  // ④ 一对字节相同的非链接副本 ⇒ duplicateCopies +1。
  {
    const { reading } = withFixture({
      "plugin/scripts/dup.sh": SH_GLUE,
      "experiments/exp/scripts/dup.sh": SH_GLUE,
    });
    push("duplicate-pair-counted", reading.totals.duplicateCopies === 1 && reading.duplicates[0]?.pluginPath === "plugin/scripts/dup.sh", "duplicateCopies=1 with the pair named", `duplicateCopies=${reading.totals.duplicateCopies} pair=${JSON.stringify(reading.duplicates)}`);
  }
  // ⑤ 同一对里 experiments 侧换成符号链接 ⇒ 不计入重复，symlinkedCopies +1。
  {
    const { reading } = withFixture(
      { "plugin/scripts/dup.sh": SH_GLUE },
      { symlinks: { "experiments/exp/scripts/dup.sh": "../../../plugin/scripts/dup.sh" } },
    );
    push(
      "symlink-not-duplicate",
      reading.totals.duplicateCopies === 0 && reading.totals.symlinkedCopies === 1,
      "duplicateCopies=0 and symlinkedCopies=1",
      `duplicateCopies=${reading.totals.duplicateCopies} symlinkedCopies=${reading.totals.symlinkedCopies} symlinked=${JSON.stringify(reading.symlinked)}`,
    );
  }
  // ⑥ 例外清单内文件 ⇒ 计入 exceptionLines 而不计入 embeddedInterpreterLines。
  {
    const { reading } = withFixture(
      { "plugin/scripts/exc.sh": SH_PY_EXCEPTION },
      { exceptions: "# exceptions\nplugin/scripts/exc.sh  # 人 2026-09-19 裁定：控制面保留 bash 现状\n" },
    );
    const f = reading.files.find((x) => x.path === "plugin/scripts/exc.sh");
    push(
      "exception-excluded-from-ratchet",
      f?.exception === true && reading.totals.exceptionLines === f?.codeLines && reading.totals.embeddedInterpreterLines === 0 && reading.totals.embeddedInterpreterScripts === 0,
      "exception=true, exceptionLines==codeLines, embeddedInterpreterLines=0 (but the file must still appear in files[])",
      `exception=${f?.exception} exceptionLines=${reading.totals.exceptionLines} codeLines=${f?.codeLines} embeddedInterpreterLines=${reading.totals.embeddedInterpreterLines} files=${reading.files.length}`,
    );
  }
  // ⑦ 无 .sh 的仓 ⇒ evaluated:false + exit 2（⛔ 不得 exit 0）。
  {
    const r = withFixture({ "README.md": "# nothing to census\n" });
    push("no-sh-not-evaluated", r.reading.evaluated === false && r.code === 2, "evaluated=false and exit=2", `evaluated=${r.reading.evaluated} exit=${r.code} reason=${r.reading.reason ?? ""}`);
  }
  // ⑧ 非 git 目录 ⇒ evaluated:false + exit 2。
  {
    const r = withFixture({ "plugin/scripts/a.sh": SH_GLUE }, { git: false });
    push("non-git-not-evaluated", r.reading.evaluated === false && r.code === 2, "evaluated=false and exit=2", `evaluated=${r.reading.evaluated} exit=${r.code} reason=${(r.reading.reason ?? "").slice(0, 80)}`);
  }
  // ⑨ 基线任一值相对 git HEAD 调高 ⇒ exit 1（这是 「调高基线」不能买过闸的那条）。
  {
    // HEAD 携带 {embeddedInterpreterLines:0, duplicateCopies:0}，工作树改成 1 而读数仍是 0
    // ⇒ 「读数 ≤ 基线」成立，只有只降不升规则能抓到它。
    const root = buildFixture({
      [FIXTURE_EXCEPTIONS]: "",
      [FIXTURE_BASELINE]: JSON.stringify({ embeddedInterpreterLines: 0, duplicateCopies: 0 }) + "\n",
      "plugin/scripts/glue.sh": SH_GLUE,
    });
    try {
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: root, env: GIT_ENV, stdio: "pipe" });
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=shc", "-c", "user.email=shc@example.invalid", "commit", "-q", "-m", "fixture"], { cwd: root, env: GIT_ENV, stdio: "pipe" });
      const clean = decide(root).code;
      fs.writeFileSync(path.join(root, FIXTURE_BASELINE), JSON.stringify({ embeddedInterpreterLines: 9, duplicateCopies: 0 }) + "\n");
      const raised = decide(root).code;
      push("baseline-raised-above-head", clean === 0 && raised === 1, "clean ⇒ exit 0; working-tree baseline raised past HEAD ⇒ exit 1", `clean exit=${clean} raised exit=${raised}`);
    } finally {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `sh-census-check.ts — shell 层普查：每个 tracked .sh 的「程序 vs 胶水」读数 + 两个只降不升的棘轮。

Usage:
  node --experimental-strip-types sh-census-check.ts [<root>] [--json] [--selftest]
       [--baseline <file>] [--exceptions <file>]

  <root>            要普查的仓库根（默认：本脚本所在仓库的根）。
  --json            机器可读读数（stdout 只出 JSON 对象，人类行一律走 stderr）。
  --selftest        跑注入用例（每个用例是一行「预期 vs 真实读数」）并退出。
  --baseline <f>    基线文件（默认 <root>/plugin/sh-census-baseline.json）。
  --exceptions <f>  例外清单（默认 <root>/plugin/sh-census-exceptions.txt）。

棘轮两轴（读数 > 基线 ⇒ 红；工作树基线相对 git HEAD 调高 ⇒ 红）:
  embeddedInterpreterLines  例外清单【之外】、含内嵌解释器的 .sh 的有效行合计
  duplicateCopies           非符号链接、字节相同的重复副本对数

Exit: 0 = 两轴都不超基线且基线未被调高
      1 = 读数回升 / 基线被调高
      2 = 用法或环境错误，**含** evaluated:false（git 不可用 / 无 .sh / 例外清单不可解析 / 基线不可读）`;

function defaultRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function reportReading(reading: CensusReading, baseline: Baseline | null, verdict: RatchetVerdict | null, asJson: boolean): void {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          evaluated: reading.evaluated,
          reason: reading.reason ?? null,
          files: reading.files,
          duplicates: reading.duplicates,
          symlinked: reading.symlinked,
          differingSameName: reading.differingSameName,
          exceptions: reading.exceptions,
          exceptionMissing: reading.exceptionMissing,
          orphanCandidates: reading.orphanCandidates,
          orphanMethod: reading.orphanMethod,
          totals: reading.totals,
          baseline,
          verdict,
        },
        null,
        2,
      ),
    );
    return;
  }
  const t = reading.totals;
  console.log(
    `sh-census-check: ${t.scripts} tracked .sh · ${t.codeLines} code lines · ${t.embeddedInterpreterScripts} with an embedded interpreter (${t.embeddedInterpreterLines} lines) · ${t.exceptionLines} exception lines`,
  );
  console.log(
    `  duplicateCopies=${t.duplicateCopies} symlinkedCopies=${t.symlinkedCopies} orphanCandidates=${t.orphanCandidates} (${reading.orphanMethod})`,
  );
  for (const f of reading.files.filter((x) => x.embedded.length > 0).sort((a, b) => b.codeLines - a.codeLines).slice(0, 15)) {
    console.log(`  embedded ${f.embedded.join("+")}: ${f.codeLines} lines  ${f.path}${f.exception ? "  [exception]" : ""}`);
  }
  if (reading.duplicates.length > 0) {
    console.log(`  duplicate copies (${reading.duplicates.length}):`);
    for (const d of reading.duplicates) console.log(`    ${d.experimentsPath} == ${d.pluginPath}`);
  }
  if (reading.differingSameName.length > 0) {
    for (const d of reading.differingSameName) console.log(`  same name, DIFFERENT bytes (not a duplicate): ${d.experimentsPath} != ${d.pluginPath}`);
  }
  if (reading.orphanCandidates.length > 0) {
    for (const p of reading.orphanCandidates) console.log(`  orphan candidate (static basename match — verify dynamic references before deleting): ${p}`);
  }
  if (reading.baseline) console.log(`  baseline: ${JSON.stringify(reading.baseline)}`);
  if (baseline) console.log(`  baseline: ${JSON.stringify(baseline)}`);
  if (verdict) {
    console.log(`  headBaseline: ${verdict.bootstrap ? "absent-bootstrap" : JSON.stringify(verdict.headBaseline)}`);
    if (verdict.over.length > 0) console.log(`  OVER baseline on: ${verdict.over.join(", ")}`);
    if (verdict.baselineRaised.length > 0) console.log(`  BASELINE RAISED past HEAD on: ${verdict.baselineRaised.join(", ")}`);
  }
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);
  const asJson = args.includes("--json");

  if (args.includes("--selftest")) {
    const cases = runSelftestCases();
    const st = createSelftest({ flavor: "cases" });
    for (const c of cases) st.check(c.name, c.ok, `expected: ${c.expected} | reading: ${c.reading}`);
    if (!asJson) console.log(`sh-census-check --selftest — ${cases.length} injected case(s), each an expectation vs a real reading`);
    const ok = st.report();
    if (asJson) console.log(JSON.stringify({ ok, cases: cases.map((c) => ({ name: c.name, ok: c.ok, expected: c.expected, reading: c.reading })) }, null, 2));
    return ok ? 0 : 1;
  }

  const positional = args.find((a, i) => !a.startsWith("--") && !(i > 0 && (args[i - 1] === "--baseline" || args[i - 1] === "--exceptions")));
  const root = path.resolve(flagValue(args, "--root") ?? positional ?? defaultRoot());
  const exceptionsAbs = path.resolve(flagValue(args, "--exceptions") ?? exceptionsFile(root));
  const baselineAbs = path.resolve(flagValue(args, "--baseline") ?? baselineFile(root));

  const { reading, baseline, verdict, code, relForHead } = decide(root, { exceptionsAbs, baselineAbs });

  if (!reading.evaluated) {
    reportReading(reading, null, null, asJson);
    process.stderr.write(`sh-census-check: NOT-EVALUATED — ${reading.reason ?? "the shell census could not be read"}\n`);
    return 2;
  }
  if (baseline === null || verdict === null) {
    reportReading(reading, null, null, asJson);
    process.stderr.write(
      `sh-census-check: NOT-EVALUATED — baseline file missing or malformed (${baselineAbs}); a checker that cannot read its baseline is never conflated with "≤ baseline"\n`,
    );
    return 2;
  }

  reportReading(reading, baseline, verdict, asJson);
  const measured = measuredOf(reading);

  if (verdict.over.length > 0) {
    process.stderr.write(
      `sh-census-check: FAIL — ${verdict.over.map((k) => `${k} ${measured[k]} > baseline ${baseline[k]}`).join("; ")}\n`,
    );
    return 1;
  }
  if (verdict.baselineRaised.length > 0) {
    process.stderr.write(
      `sh-census-check: FAIL — the working-tree baseline was RAISED past git HEAD on ${verdict.baselineRaised.join(", ")} (a baseline may only shrink)\n`,
    );
    return 1;
  }
  // ⛔ --json 模式下 stdout 只承载 JSON 对象 —— 追加一行人类文案会让整条流不可解析（`--json | jq` 全断）。
  if (!asJson) {
    const boot = verdict.bootstrap
      ? ` (headBaseline: absent-bootstrap — HEAD carries no ${relForHead}; this reading is the new baseline)`
      : ` (headBaseline ${JSON.stringify(verdict.headBaseline)})`;
    process.stdout.write(
      `PASS — embeddedInterpreterLines=${measured.embeddedInterpreterLines} ≤ ${baseline.embeddedInterpreterLines}, duplicateCopies=${measured.duplicateCopies} ≤ ${baseline.duplicateCopies}${boot}\n`,
    );
  }
  return code;
}

if (isDirectEntry(import.meta, undefined, "sh-census-check")) {
  process.exit(main(process.argv));
}
