#!/usr/bin/env node
// repo-root-derivation-check.ts — 棘轮：脚本目录常量不得手搓「向上两级」当仓根
// (tasks/gap-repo-root-derivation-bypasses-shared-accessor；架构复核 round 2019 的 P2-identity-repo-root.ts).
//
// ── THE DEFECT (copy-instead-of-call) ────────────────────────────────────────────────────────────
// plugin/scripts/repo-root.ts 的 repoRoot() 是这一层唯一的根解析器（bundle → consumer → plain-git
// 三种形状向上走查 + `git rev-parse --show-toplevel` + `process.cwd()` 兜底），已被 60+ 文件 import。
// 立案时仍有 29 个 plugin/scripts 文件一次都不引用它，各自把「脚本所在目录向上数两级」当成仓根的
// 【定义】。本棘轮是那一轮迁移的防复发件：修完不许再长回来。
//
// 两种写法实测【不等价】（立案读数，见任务体 §三）：从 <repo>/plugin/scripts 出发两者同值；但从
// packages/quay/plugin/scripts（插件落盘副本）出发，裸常量得 <repo>/packages/quay，而 repoRoot()
// 得 <repo>。差别不在性能或整洁：裸常量回答的是「向上恰好两级」，repoRoot() 回答的是「这里是不是
// 仓根」——前者换一个布局就换了答案，且静默。
//
// ── WHAT IT ASSERTS (by POSITION, never by keyword — 硬规则 2) ────────────────────────────────────
// 判据不是「文本里有那串字符」，而是【本文件的一个脚本目录常量 + 连续两级上溯】两件事同时成立：
//   ① 先在同一文件里【真声明】出脚本目录常量集合：`__dirname`（语言保证它就是脚本目录）以及一切
//      传递地由 `path.dirname(<本模块自身路径>)` 派生出来的标识符（SCRIPT_DIR / HERE / here /
//      scriptDir / …）。⛔ 不写死标识符白名单——白名单是可绕的（改个名字就躲过），传递闭包不是。
//   ② 再在【代码位置】（注释/字符串/正则里拼写不算，复用 checker-lib 的 buildNonCodeMask，shell
//      文件额外涂掉 `#` 行注释）找以该集合成员为第一实参、紧跟两级上溯段的调用。允许其后还有更多
//      实参：`<repo>/experiments/…` 那种同样是从脚本目录数两级，属同一缺陷簇（硬规则 5b）。
// 因此「一个临时目录向上两级」不会被计入——降噪靠的是【第一实参是不是本文件的脚本目录常量】，
// 这条位置判据，不是靠一份会过期的关键词表。
//
// ── 本文件为什么一个实例都不写出来（自指陷阱）────────────────────────────────────────────────────
// 本文件自己就在 plugin/scripts/ 扫描面内。它要抓的那串字面量若在本文件里出现一次，本文件就自己命中
// 自己 ⇒ 一个连自己都过不去的检查器没人能跑。所以判据由片段拼装（`path` + `.` + `resolve` + `(`，
// 上溯段用 String.fromCharCode(46,46)），且连头注释里也不复写那串字面量——真实例只存在于
// plugin/test/repo-root-derivation-check.test.mjs 的夹具里与任务体里（那两处都不在本扫描面内）。
//
// ── THREE-STATE (硬规则 3b —— 读不懂不得与「合格」同形) ───────────────────────────────────────────
// 扫描面不存在 / 枚举到 0 个文件 ⇒ exit 3 NOT-EVALUATED，绝不 exit 0。一个空扫描面与一个干净载体在
// 任何只看退出码的地方同形，而它们的含义相反。
//
// Exit codes: 0 = PASS (扫描面非空且 0 命中);
//             1 = RED (≥1 处命中);
//             2 = usage/environment error;
//             3 = NOT-EVALUATED (扫描面读不到 / 枚举为空).
//
// Usage:
//   node --experimental-strip-types repo-root-derivation-check.ts [--root <dir>] [--json]
//   node --experimental-strip-types repo-root-derivation-check.ts --scan <file-or-dir> [--scan …]
//       （--scan 覆盖默认扫描面 = <root>/plugin/scripts；给一次可只判一个文件，夹具与 AC5 干跑用）
//   node --experimental-strip-types repo-root-derivation-check.ts --help

import fs from "node:fs";
import path from "node:path";
// 本文件的仓根来自【唯一访问器】，不是又一次向上两级——本检查器是它自己的第一个使用者。
import { repoRoot } from "./repo-root.ts";
// shell 文件的 `#` 行注释涂白 + JS/TS 的注释/字符串/正则掩码，都是 concurrency-literal-check 已抽出
// 的同一件 buildMask（本仓既有手法，不复写第二份）。
import { buildMask } from "./concurrency-literal-check.ts";
import { walkFiles } from "./fs-walk.ts";
// The single regex-literal escaper (kernel leaf reached via the plugin shim); `escapeRe` is the name
// this file's call sites already use. Own copy was one of the twelve byte-identical bodies extracted
// by gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.
import { escapeRegExp as escapeRe } from "./regex-escape.ts";
import { helpExit, isDirectEntry, emitPass, emitFail, emitNotEvaluated } from "./gate-script-base.ts";

// ── 判据片段（拼装，故意不写出完整字面量——见头注释「自指陷阱」）────────────────────────────────
/** `path.resolve` 的调用前缀。分片拼装，使本文件不含被判定形态的完整字面量。 */
const RESOLVE_CALL = ["path", "resolve"].join(".") + "(";
/** 上溯一段：`..`（46 = `.`）。 */
const UP_ONE = String.fromCharCode(46, 46);
/** 上溯一段的带引号形态，即判定里出现在实参位置的那两个字符串字面量。 */
const QUOTED_UP_ONE = `"${UP_ONE}"`;

/** 扫描面：本检查器只判【生产】plugin/scripts。`dist/` 是 gitignored 构建产物（源码改完下次 build
 *  自然带上，判它只会把陈旧副本的噪声当成缺陷）；`checker-mutation-cases/` 是夹具语料——其他检查器
 *  的 mutation 夹具里【故意】含有它们各自要抓的字面量，把它们算进来就是让本棘轮去替别人判夹具。 */
export const SKIP_DIR_NAMES: ReadonlySet<string> = new Set(["dist", "checker-mutation-cases", "node_modules"]);
/** 可判载体：本仓的 plugin/scripts 是 .ts/.sh/.mjs 三种（.sh 里不会有 path.resolve，但它在面内才能
 *  把「shell 注释里提到」这一类的分类结果如实报出来，而不是靠「不在面内」把它藏掉）。 */
export const SCAN_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".sh", ".mjs"]);

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

// ── 判据 ① 的载体：脚本目录常量的【传递闭包】 ────────────────────────────────────────────────────
/**
 * 涂掉非代码位置但保留换行与列位的文本（掩码后的等价文本）。
 * 与 concurrency-literal-check 同款：`#` 行注释（shell，词首 `#` 到行尾）先涂白，再交给
 * buildNonCodeMask 涂掉 JS/TS 的注释/字符串/正则——两步都做，才不会被注释里的引号骗开一个假字面量。
 */
export function maskedText(src: string, isShell: boolean): string {
  return maskToText(src, buildMask(src, isShell));
}

/** Same, from an ALREADY-BUILT mask (callers that need the mask itself should not pay for it twice). */
export function maskToText(src: string, mask: Uint8Array): string {
  // Built through an array and joined once — a `+=` accumulator here is O(n²) in the file size.
  const out = new Array<string>(src.length);
  for (let i = 0; i < src.length; i++) out[i] = mask[i] === 1 && src[i] !== "\n" ? " " : src[i];
  return out.join("");
}

/**
 * 本文件绑定出来的脚本目录常量集合（传递闭包，读【真声明】不读名字）。
 * 种子：`__dirname`（语言保证 = 脚本目录）。规则，迭代到不动点：
 *   - `const X = path.dirname(<Y>)`，Y ∈ SELF ∪ SCRIPT_DIR   ⇒ X 是脚本目录常量
 *   - `const X = <任意含 import.meta.url 的表达式>`          ⇒ X 是本模块自身路径（SELF）
 *   - `const X = <Y>`，Y ∈ SELF                              ⇒ X ∈ SELF（别名）
 *   - `const X = <Y>`，Y ∈ SCRIPT_DIR                        ⇒ X ∈ SCRIPT_DIR（别名）
 * 只认 `= <表达式>;` 整行形态——一条被拆行的声明读不到是【漏报】（棘轮偏保守的一侧），不会变成误报。
 */
export function scriptDirBindings(codeText: string): Set<string> {
  const scriptDir = new Set<string>(["__dirname"]);
  const selfPath = new Set<string>(["__filename"]);
  const lines = codeText.split("\n");
  const DECL_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);\s*$/;
  let changed = true;
  while (changed) {
    changed = false;
    for (const line of lines) {
      const m = DECL_RE.exec(line);
      if (!m) continue;
      const name = m[1];
      const rhs = m[2].trim();
      // dirname 规则先于 import.meta.url 规则：`path.dirname(fileURLToPath(import.meta.url))` 的实参
      // 里也含 `import.meta.url`，若让后者先跑，整个表达式会被整条读成「自身路径」而不是「取它的目录」。
      const dirnameCall = /^(?:path\.)?dirname\s*\(\s*(.+?)\s*\)$/.exec(rhs);
      if (dirnameCall) {
        const arg = dirnameCall[1].trim();
        const argIsSelfPath =
          (IDENT_RE.test(arg) && selfPath.has(arg)) || arg === "__filename" || arg.includes("import.meta.url");
        const argIsScriptDir = IDENT_RE.test(arg) && scriptDir.has(arg);
        if ((argIsSelfPath || argIsScriptDir) && !scriptDir.has(name)) {
          scriptDir.add(name);
          changed = true;
        }
        continue;
      }
      if (rhs.includes("import.meta.url")) {
        if (!selfPath.has(name)) {
          selfPath.add(name);
          changed = true;
        }
        continue;
      }
      if (IDENT_RE.test(rhs)) {
        if (selfPath.has(rhs) && !selfPath.has(name)) {
          selfPath.add(name);
          changed = true;
          continue;
        }
        if (scriptDir.has(rhs) && !scriptDir.has(name)) {
          scriptDir.add(name);
          changed = true;
          continue;
        }
      }
    }
  }
  return scriptDir;
}

/** 判据 ② 的正则：`path.resolve(<本文件的脚本目录常量>, <上溯>, <上溯>)`，其后可以是 `,`（还有更多
 *  实参，属同一缺陷簇）或 `)`（调用到此为止）。 */
export function derivationRe(names: readonly string[]): RegExp | null {
  const valid = names.filter((n) => IDENT_RE.test(n));
  if (valid.length === 0) return null;
  // 长的优先，免得 `here` 抢在 `hereDir` 前面把第二段留给 `Dir`。
  valid.sort((a, b) => b.length - a.length);
  return new RegExp(
    `${escapeRe(RESOLVE_CALL)}\\s*(${valid.join("|")})\\s*,\\s*${escapeRe(QUOTED_UP_ONE)}\\s*,\\s*${escapeRe(QUOTED_UP_ONE)}\\s*[,)]`,
    "g",
  );
}

// ── 逐文件判定（导出给单测） ──────────────────────────────────────────────────────────────────────
export interface Hit {
  file: string;
  line: number;
  col: number;
  text: string;
}

/**
 * 判一个文件的源码。返回命中清单（空数组 = 干净）。`isShell` 决定 `#` 行注释是否被计入非代码。
 *
 * ⛔ 判定跑在【原文本】上，只把【命中起点】拿去掩码上验位置——不能跑在涂白后的文本上：涂白会把
 * 判据自己依赖的那两段引号实参一并抹成空格，判据于是永远匹配不上（空转，与「验过了」同形）。
 * 起点位置判定正是本仓 matchAtCommandPosition 的手法，也是这里正确的粒度：`path` 落在字符串/
 * 注释里 ⇒ 起点被掩 ⇒ 不报；起点是代码、其后实参是字符串 ⇒ 正常报（实参本来就该是字符串）。
 */
export function scanSource(relFile: string, src: string, isShell: boolean): Hit[] {
  // Cheap NECESSARY conditions first. A hit must (a) contain the call prefix and (b) contain the
  // up-one token at least twice (both its arguments are that token). Both are plain `includes`/`split`
  // — O(n) with no backtracking — and they let the expensive mask build skip the ~9 MB of
  // plugin/scripts that cannot possibly match. Necessary, never sufficient: the verdict still comes
  // from the pattern + position check below, so a prefilter cannot manufacture or suppress a hit it
  // should not (a file skipped here provably has zero matches).
  if (!src.includes(RESOLVE_CALL)) return [];
  if (src.split(QUOTED_UP_ONE).length - 1 < 2) return [];

  const mask = buildMask(src, isShell);
  const names = [...scriptDirBindings(maskToText(src, mask))];
  const re = derivationRe(names);
  if (re === null) return [];
  const lines = src.split("\n");
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const idx = m.index;
    if (mask[idx] !== 0) continue; // 起点在注释/字符串/正则里 —— 只是「拼写出来」，不是「这么做」
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < idx; i++) {
      if (src[i] === "\n") {
        line++;
        lineStart = i + 1;
      }
    }
    hits.push({ file: relFile, line, col: idx - lineStart + 1, text: (lines[line - 1] ?? "").trim() });
  }
  return hits;
}

export interface ScanResult {
  scanned: string[];
  hits: Hit[];
}

/** 收集扫描目标：`--scan` 给的路径（文件或目录，目录递归且跳过 SKIP_DIR_NAMES），否则默认
 *  `<root>/plugin/scripts`。 */
export function collectTargets(root: string, scans: readonly string[]): string[] {
  const out: string[] = [];
  const addFile = (abs: string) => {
    if (SCAN_EXTENSIONS.has(path.extname(abs)) && fs.existsSync(abs) && fs.statSync(abs).isFile()) out.push(abs);
  };
  if (scans.length > 0) {
    for (const s of scans) {
      const abs = path.resolve(root, s);
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).isDirectory()) {
        for (const f of walkFiles(abs, { absolute: true, prune: (name) => SKIP_DIR_NAMES.has(name) })) addFile(f);
      } else {
        addFile(abs);
      }
    }
  } else {
    const dir = path.join(root, "plugin", "scripts");
    if (fs.existsSync(dir)) {
      for (const f of walkFiles(dir, { absolute: true, prune: (name) => SKIP_DIR_NAMES.has(name) })) addFile(f);
    }
  }
  return [...new Set(out)].sort();
}

export interface RunResult {
  root: string;
  evaluated: boolean;
  scanned: string[];
  hits: Hit[];
}

/** 读不到扫描面（枚举为 0）⇒ evaluated:false，调用方必须据此出 NOT-EVALUATED，不得当成 PASS。 */
export function runCheck(root: string, scans: readonly string[]): RunResult {
  const targets = collectTargets(root, scans);
  if (targets.length === 0) return { root, evaluated: false, scanned: [], hits: [] };
  const hits: Hit[] = [];
  const scanned: string[] = [];
  for (const abs of targets) {
    let src: string;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue; // 读不到的文件不进 scanned、也不进 hits——它既没被判干净也没被判脏
    }
    const rel = path.relative(root, abs).split(path.sep).join("/");
    scanned.push(rel);
    hits.push(...scanSource(rel, src, abs.endsWith(".sh")));
  }
  if (scanned.length === 0) return { root, evaluated: false, scanned: [], hits: [] };
  return { root, evaluated: true, scanned, hits };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
export const USAGE =
  "usage: node --experimental-strip-types repo-root-derivation-check.ts [--root <dir>] [--json] [--scan <file-or-dir>]…\n" +
  "  棘轮：plugin/scripts 里不得再用「脚本目录常量向上两级」手搓仓根（用 repo-root.ts 的 repoRoot()）。\n" +
  "  默认扫描面 = <root>/plugin/scripts（跳过 dist/ 与 checker-mutation-cases/）。\n" +
  "  exit 0 = PASS，1 = RED（≥1 处命中），2 = usage/env error，3 = NOT-EVALUATED（扫描面读不到/为空）。";

/** 重复出现的 `--scan` 要全部收下（flagValue 只返回第一次），故本检查器自己收这一个旗标。 */
export function collectScans(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--scan" && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);

  let root = repoRoot();
  const ri = args.indexOf("--root");
  if (ri !== -1 && args[ri + 1]) root = path.resolve(args[ri + 1]);
  const asJson = args.includes("--json");
  const scans = collectScans(args);

  const res = runCheck(root, scans);

  if (!res.evaluated) {
    return emitNotEvaluated(
      `扫描面为空或读不到（root: ${res.root}${scans.length > 0 ? `, --scan ${scans.join(" ")}` : ", plugin/scripts"}）——「没评估」不是「干净」。`,
      { root: res.root, scans, scanned: 0, hits: 0 },
      { json: asJson },
    );
  }

  if (res.hits.length > 0) {
    const detail = {
      root: res.root,
      scanned: res.scanned.length,
      hits: res.hits.length,
      violations: res.hits.map((h) => `${h.file}:${h.line}:${h.col}  ${h.text}`),
    };
    return emitFail(
      `${res.hits.length} 处「脚本目录常量向上两级」手搓仓根（扫了 ${res.scanned.length} 个文件）：` +
        res.hits.map((h) => `${h.file}:${h.line}`).join(", ") +
        " — 改用 `import { repoRoot } from \"./repo-root.ts\"` + `repoRoot()`（--root 覆盖通道不动）。",
      detail,
      { json: asJson },
    );
  }

  return emitPass(`无手搓「向上两级」仓根（扫了 ${res.scanned.length} 个文件，均用 repoRoot() 或另有显式根通道）。`, {
    root: res.root,
    scanned: res.scanned.length,
    hits: 0,
  }, { json: asJson });
}

if (isDirectEntry(import.meta, undefined, "repo-root-derivation-check")) {
  process.exit(main(process.argv));
}
