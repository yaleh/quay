#!/usr/bin/env node
// deletion-closure-check.ts — P1 删除闭包检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P1).
// 对构件 X, DC(X) = 为使 X 不再存在、且不留下悬空引用或永久变红的检查, 必须修改的文件集合。
// 核心指标剖面比 R(X) = |DC(X)| / |CallGraph(X)| — 封装良好 ⇒ R ≈ 1。
//
// 依赖 P2 (identity-replication-check.ts) 的别名索引基础设施: 复用其按位置注释掩码
// (tsCommentMask / shCommentMask — 注释剔除, 字符串字面量保持代码)。本任务不重新实现别名索引 —
// 文档 §4 实施顺序图标注 "P2 产出的身份边就是 P1 的闭包边"。
//
// 闭包口径 (与文档 §2.4 session-liveness 的 DC=150 一致): DC = 引用 X 的【全部文件】, 按位置分三类
//   code    — 代码位置 (6 类结构边: import/require / shell-out / 字符串字面量 / 输出解析 / 测试夹具 / Touches)
//   comment — 注释位置 (悬空注释引用, 删除 X 时同样必须清理)
//   doc     — .md 文档提及 (叙述性引用, 删除 X 时须同步)
// 三者取并集 = 闭包。CallGraph = 只有 code 位置的结构调用 (import/source/bash/exec/spawn)。
//   — 反向判据 (AC2): 若对封装良好的共享库报 R > 2, 说明把叙述性引用 (comment/doc) 当成了结构边 (call)。
//     本实现把 comment/doc 与 call 严格分开, 叙述性引用永不进 CallGraph。
//
// 一次退役可能删除多个构件 (message-bus.ts + inbox-reader.sh; prepare/execute 集群)。CLI 接受多个
// <component> 位置参数, 闭包 = 各构件闭包的并集 (refs 按文件合并)。
//
// 扫描面 (skip 面) = **gitignore 驱动** ∪ SKIP_DIRS。正本是 `git ls-files --cached --others
// --exclude-standard`(fs-walk.ts `gitVisiblePaths`): 只有 git 认为属于本 work tree 的路径才进闭包,
// 于是 `.claude/worktrees/`(worktree 容器)、`.archguard/`(MCP 缓存)、`packages/quay/plugin/`(镜像)
// 这些 gitignored 树按构造排除 —— 不再靠往手工名单里加名字 (那是本缺陷的成因：
// gap-deletion-closure-walker-respects-gitignore, 立案时 12010 条闭包里 11054 条落在 gitignored 前缀下,
// 前 15 条读的是【另一个 worktree 的整份 repo 副本】)。SKIP_DIRS 的残余职责见其定义处。
// ⛔ 报告永远带 `ignoreSource`：git 回答不了时走 SKIP_DIRS 兜底并在输出里报警，**不得静默降级**
//   (硬规则 3b —— 否则"没生效"与"生效且没命中"同形)。
// ⛔ 不得顺手排除 `tasks/` 与 `experiments/` —— 它们是 tracked 的真实引用面，gitignore 不覆盖它们，
//   本修法也不会碰到它们 (AC3 的负控制钉这一点)。
//
// ⚠️ 参照系更正 (文档 §3 P1, 必须遵守): 真值 = 「实际改动集 ∪ 事后仍能命中的残留引用集」, 不是
//   「删除提交实际改动的文件集」— DC 与真值的分歧应先当残留发现处理, 再当方法误差。
//
// 每个计数内建「打印命中样本」纪律 (docs 附录 A): 报一个计数同时报出它匹配到的前若干条实际内容。
//
// Usage:
//   node --experimental-strip-types deletion-closure-check.ts <component> [<component> ...] [--root <dir>] [--json]
//   <component>     basename (session-liveness.sh) 或相对路径 (plugin/scripts/session-liveness.sh); 可多个
//   --root <dir>    repo to scan (default: repo-root.ts resolution)
//   --json          emit the full report as JSON
//   --help          usage, exit 0
// Exit: 0 = report produced (observer, not a pass/fail gate); 2 = usage/environment error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./repo-root.ts";
import { tsCommentMask, shCommentMask } from "./identity-replication-check.ts";
import { walkFiles, gitVisiblePaths, type VisibleSet } from "./fs-walk.ts";
// The single regex-literal escaper (kernel leaf reached via the plugin shim); `escapeRegex` is the
// name this file's six call sites already use. Own copy was one of the twelve byte-identical bodies
// extracted by gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.
import { escapeRegExp as escapeRegex } from "./regex-escape.ts";
// argValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { flagValue } from "./gate-script-base.ts";
import { lineOf } from "./source-text-lib.ts";

// ── 别名索引 ───────────────────────────────────────────────────────────────────────────────────

export interface Aliases {
  component: string;
  basename: string; // session-liveness.sh
  stem: string;     // session-liveness
  spaceStem: string; // "session liveness" — 连字符名的散文/叙述形态 (docs 附录 A message-bus 案例)
  relPath: string;  // plugin/scripts/session-liveness.sh (component 本身或推得)
}

export function aliasesOf(component: string): Aliases {
  const norm = component.replace(/\\/g, "/").replace(/^\.\//, "");
  const basename = norm.split("/").pop()!;
  const stem = basename.replace(/\.(ts|sh|mjs|js)$/, "");
  return {
    component: norm,
    basename,
    stem,
    spaceStem: stem.replace(/-/g, " "),
    relPath: norm.includes("/") ? norm : `plugin/scripts/${basename}`,
  };
}

function maskFor(f: string): (src: string) => Uint8Array {
  return f.endsWith(".sh") ? shCommentMask : tsCommentMask;
}

/** stem 的整词匹配 (session-liveness 不得命中 session-liveness-mount / session-liveness2)。 */
function stemRe(stem: string): RegExp {
  return new RegExp(`${escapeRegex(stem)}(?![A-Za-z0-9_-])`);
}

/** 文本是否命中构件 (basename 全串, 或 stem 整词, 或连字符名的空格散文形态)。 */
function mentions(src: string, a: Aliases): boolean {
  if (src.includes(a.basename)) return true;
  if (stemRe(a.stem).test(src)) return true;
  if (a.spaceStem !== a.stem) {
    // "message bus" / "Message bus" — 散文叙述形态 (大小写不敏感), 只在 doc/comment 位置计入闭包。
    return new RegExp(`\\b${escapeRegex(a.spaceStem)}\\b`, "i").test(src);
  }
  return false;
}

// ── 枚举 ─────────────────────────────────────────────────────────────────────────────────────

// ⛔ 手动名单**不是** skip 面的正本 —— gitignore 才是 (见下面的 scanVisible)。这份名单是本缺陷
// (gap-deletion-closure-walker-respects-gitignore) 的**成因**：它手工列举"哪些名字属于本仓"，
// 而漏了三个 gitignored 前缀 (.claude/worktrees/ 10962 条 / packages/quay/plugin/ 90 条 /
// .archguard/ 2 条)，于是把别的 worktree 的整份 repo 副本读成了"引用 X 的文件"。
// ⛔ 因此**再往这里加名字是禁止的修法** (那只是把下一次同族缺陷推后)。
//
// 名单保留下来只做两件事，都不是"列举 gitignored 名字"：
//   ① 非 git 根 (测试夹具 mktmp 的临时目录) 的兜底 —— 那里 git 无法回答，只能退回名单；
//   ② 一条 gitignore **表达不了**的策略：`.quay` 是**部分 tracked** 的运行时状态目录
//      (101 个 tracked 文件 + 大量未跟踪证据)，gitignore 不覆盖它，但它不是删除债的引用面。
//      `vendor`/`coverage`/`fixture` 同理属于构建/夹具策略；`node_modules`/`dist`/`.git` 虽也
//      被 gitignore 覆盖，留在这里是无害的冗余 (先剪枝省一次 stat)。
const SKIP_DIRS = new Set(["node_modules", "vendor", "fixture", ".git", ".quay", "dist", "coverage"]);
const CODE_EXTS = new Set([".ts", ".sh", ".mjs", ".js"]);
const MD_EXTS = new Set([".md"]);

/**
 * 本次扫描的 skip 面来源 —— **三取值里没有"沉默"那一档** (硬规则 3b)：git 能回答时是
 * `git-worktree`，回答不了时是 `manual-skip-only` 并且**在输出里显式报出**。两种形态不同形，
 * 所以"gitignore 面没生效"不会伪装成"gitignore 面生效且恰好没命中"。
 */
export interface IgnoreSource {
  kind: "git-worktree" | "manual-skip-only";
  visiblePaths: number; // |gitVisiblePaths(root)|；NOT-EVALUATED 时为 0
  detail: string;
}

/** `gitVisiblePaths(root)` 包成 walker 要的 `{root, paths}` 形态；git 回答不了 ⇒ `null`
 *  (NOT-EVALUATED，**不是空集** —— 空集会读成"这里没有东西被忽略")。 */
export function scanVisible(root: string): VisibleSet | null {
  const paths = gitVisiblePaths(root);
  if (!paths) return null;
  return { root, paths };
}

export function ignoreSourceOf(root: string, visible: VisibleSet | null): IgnoreSource {
  if (visible) {
    return {
      kind: "git-worktree",
      visiblePaths: visible.paths.size,
      detail: `git ls-files --cached --others --exclude-standard (${visible.paths.size} 条可见路径)`,
    };
  }
  return {
    kind: "manual-skip-only",
    visiblePaths: 0,
    detail: "git 无法在 --root 下回答 (非 work tree / 无 git / 非零退出) ⇒ 仅按 SKIP_DIRS 剪枝；gitignored 树可能重新进入闭包",
  };
}

export function walkDcCodeFiles(root: string, visible: VisibleSet | null = scanVisible(root)): string[] {
  const roots = ["plugin", "packages", "experiments", "scripts", ".claude/workflows"].map((d) => path.join(root, d));
  const out = roots.flatMap((r) =>
    walkFiles(r, {
      absolute: true,
      visible,
      prune: (name) => SKIP_DIRS.has(name),
      include: (name, ext) => CODE_EXTS.has(ext),
    }),
  );
  return out.sort();
}

/** .md 文档文件 (doc 位置引用的载体)。全仓枚举, 排除 skip 目录 + gitignored 树。 */
export function walkDocFiles(root: string, visible: VisibleSet | null = scanVisible(root)): string[] {
  return walkFiles(root, {
    absolute: true,
    visible,
    prune: (name) => SKIP_DIRS.has(name),
    include: (name, ext) => MD_EXTS.has(ext),
  });
}

// lineOf 上收到 source-text-lib.ts (semantic-dedup-scan `lineof-lineat`); 本地 `relOf` 包装
// (body 恰为 `path.relative(root, f)`) 已就地内联 —— 一行 stdlib 委托没有可抽的算法, 两个私有
// 同名包装才是被报出的那份重复。

// ── 引用抽取 (按位置: code / comment / doc) ──────────────────────────────────────────────────

// ⚠️ 不含 `sh` — `\bsh\b` 会命中 "session-liveness.sh" 的 .sh 扩展名 (任何 .sh 文件名都变「调用」)。
// 与文档附录 A 的 CallGraph 谓词一致: (bash|exec|source|spawnSync|execFileSync)。
const SHELL_OUT_PRIM = /\b(?:bash|exec|source|spawn|spawnSync|execFileSync|execSync|execFile|fork)\b/;
const SCHEMA_PRIM = /JSON\.parse\s*\(|--once|--json|\.parse\s*\(|readFileSync|execFileSync/;

export interface FileRef {
  file: string;
  code: boolean;
  comment: boolean;
  doc: boolean;
  call: boolean;
  directCall: boolean;
  literal: boolean;
  schema: boolean;
  fixture: boolean;
  touches: boolean;
  sample: string;
}

function emptyRef(file: string): FileRef {
  return { file, code: false, comment: false, doc: false, call: false, directCall: false, literal: false, schema: false, fixture: false, touches: false, sample: "" };
}

function mergeRef(dst: FileRef, src: FileRef): FileRef {
  dst.code ||= src.code;
  dst.comment ||= src.comment;
  dst.doc ||= src.doc;
  dst.call ||= src.call;
  dst.directCall ||= src.directCall;
  dst.literal ||= src.literal;
  dst.schema ||= src.schema;
  dst.fixture ||= src.fixture;
  dst.touches ||= src.touches;
  if (!dst.sample) dst.sample = src.sample;
  return dst;
}

function positionHits(src: string, mask: Uint8Array, a: Aliases): { line: number; match: string; code: boolean }[] {
  const hits: { line: number; match: string; code: boolean }[] = [];
  const seen = new Set<number>();
  const push = (idx: number, m: string) => {
    const line = lineOf(src, idx);
    const key = line * 100000 + idx;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ line, match: m, code: mask[idx] === 0 });
  };
  let i = 0;
  while ((i = src.indexOf(a.basename, i)) !== -1) { push(i, a.basename); i += a.basename.length; }
  const sre = new RegExp(stemRe(a.stem).source, "g");
  let m: RegExpExecArray | null;
  while ((m = sre.exec(src)) !== null) { push(m.index, m[0]); if (m[0].length === 0) sre.lastIndex++; }
  if (a.spaceStem !== a.stem) {
    const wre = new RegExp(`\\b${escapeRegex(a.spaceStem)}\\b`, "gi");
    while ((m = wre.exec(src)) !== null) { push(m.index, m[0]); if (m[0].length === 0) wre.lastIndex++; }
  }
  return hits.sort((x, y) => x.line - y.line);
}

function hasDirectCall(src: string, mask: Uint8Array, a: Aliases): boolean {
  const base = escapeRegex(a.basename);
  const stem = escapeRegex(a.stem);
  const re = new RegExp(
    `(?:import\\s*\\(?\\s*["'][^"']*?(?:${stem}|${base})|` +
      `import\\s+[^;]*?\\bfrom\\s*["'][^"']*?(?:${stem}|${base})|` +
      `require\\s*\\(\\s*["'][^"']*?(?:${stem}|${base})|` +
      `\\b(?:bash|exec|source)\\b[^\\n]*?(?:${stem}|${base})|` +
      `\\b(?:spawn|spawnSync|execFileSync|execSync|execFile|fork)\\b\\s*\\(?\\s*["'][^"']*?(?:${stem}|${base}))`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (mask[m.index] === 0) return true;
    if (m[0].length === 0) re.lastIndex++;
  }
  return false;
}

function hasConstructedCall(src: string, mask: Uint8Array): boolean {
  const sre = new RegExp(SHELL_OUT_PRIM.source, "g");
  let m: RegExpExecArray | null;
  while ((m = sre.exec(src)) !== null) {
    if (mask[m.index] === 0) return true;
    if (m[0].length === 0) sre.lastIndex++;
  }
  return false;
}

function isTestFile(rel: string): boolean {
  return /\.(test|spec)\.(ts|mjs|js)$/.test(rel);
}

export function classifyCodeFile(rel: string, src: string, a: Aliases): FileRef {
  const mask = maskFor(rel)(src);
  const hits = positionHits(src, mask, a);
  if (hits.length === 0) return emptyRef(rel);
  const code = hits.some((h) => h.code);
  const comment = hits.some((h) => !h.code);
  const sample = `${rel}:${hits[0].line} ${hits[0].match} (${hits[0].code ? "code" : "comment"})`;
  const direct = code && hasDirectCall(src, mask, a);
  const constructed = code && !direct && hasConstructedCall(src, mask);
  const call = direct || constructed;
  let schema = false;
  if (code) {
    const pre = new RegExp(SCHEMA_PRIM.source, "g");
    let m: RegExpExecArray | null;
    while ((m = pre.exec(src)) !== null) {
      if (mask[m.index] === 0) { schema = true; break; }
      if (m[0].length === 0) pre.lastIndex++;
    }
  }
  const literal = code && !call;
  const fixture = code && isTestFile(rel);
  return { file: rel, code, comment, doc: false, call, directCall: direct, literal, schema, fixture, touches: false, sample };
}

export function classifyDocFile(rel: string, src: string, a: Aliases): FileRef | null {
  if (!mentions(src, a)) return null;
  const touches = rel.startsWith("tasks/") && /^## Touches\s*$/m.test(src) && (() => {
    const m = /^## Touches\s*$/m.exec(src)!;
    const rest = src.slice(m.index);
    const end = rest.indexOf("\n## ");
    const section = end === -1 ? rest : rest.slice(0, end);
    return section.includes(a.basename) || stemRe(a.stem).test(section);
  })();
  const bi = src.indexOf(a.basename);
  const stemIdx = bi !== -1 ? bi : stemRe(a.stem).exec(src)?.index ?? 0;
  const sample = `${rel}:${lineOf(src, stemIdx)} (doc${touches ? ", touches" : ""})`;
  return { file: rel, code: false, comment: false, doc: true, call: false, directCall: false, literal: false, schema: false, fixture: false, touches, sample };
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────────────────────

export interface Report {
  root: string;
  components: string[];
  component: string; // 首构件 (向后兼容)
  aliases: Aliases[];
  ignoreSource: IgnoreSource;
  callGraph: string[];
  dc: string[];
  refs: FileRef[];
  counts: {
    code: number;
    comment: number;
    doc: number;
    call: number;
    literal: number;
    schema: number;
    fixture: number;
    touches: number;
    dcTotal: number;
    callGraphTotal: number;
    ratio: number | null;
  };
}

function isSelfToolFile(f: string): boolean {
  return (
    f.endsWith("/deletion-closure-check.ts") ||
    f.endsWith("/deletion-closure-check.test.mjs") ||
    f.endsWith("/identity-replication-check.ts") ||
    f.endsWith("/identity-replication-check.test.mjs")
  );
}

export function deletionClosure(root: string, components: string[], visible: VisibleSet | null = scanVisible(root)): Report {
  const aliases = components.map(aliasesOf);
  const selfBases = new Set(aliases.map((a) => a.basename));
  const codeFiles = walkDcCodeFiles(root, visible).filter((f) => !isSelfToolFile(f) && !selfBases.has(path.basename(f)));

  const byFile = new Map<string, FileRef>();
  const bump = (r: FileRef) => {
    if (byFile.has(r.file)) mergeRef(byFile.get(r.file)!, r);
    else byFile.set(r.file, r);
  };

  for (const f of codeFiles) {
    let src: string;
    try {
      src = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, f);
    for (const a of aliases) {
      if (!mentions(src, a)) continue;
      const r = classifyCodeFile(rel, src, a);
      if (r.code || r.comment) bump(r);
      break;
    }
  }
  for (const f of walkDocFiles(root, visible)) {
    let src: string;
    try {
      src = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, f);
    for (const a of aliases) {
      const r = classifyDocFile(rel, src, a);
      if (r) bump(r);
    }
  }

  const refs = [...byFile.values()].sort((x, y) => x.file.localeCompare(y.file));
  const callGraph = refs.filter((r) => r.call).map((r) => r.file).sort();
  const dc = refs.map((r) => r.file).sort();

  const counts = {
    code: refs.filter((r) => r.code).length,
    comment: refs.filter((r) => r.comment).length,
    doc: refs.filter((r) => r.doc).length,
    call: refs.filter((r) => r.call).length,
    literal: refs.filter((r) => r.literal).length,
    schema: refs.filter((r) => r.schema).length,
    fixture: refs.filter((r) => r.fixture).length,
    touches: refs.filter((r) => r.touches).length,
    dcTotal: dc.length,
    callGraphTotal: callGraph.length,
    ratio: callGraph.length > 0 ? dc.length / callGraph.length : null,
  };

  return { root, components, component: components[0], aliases, ignoreSource: ignoreSourceOf(root, visible), callGraph, dc, refs, counts };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

function usage(): never {
  console.error(
    "usage: node --experimental-strip-types deletion-closure-check.ts <component> [<component> ...] [--root <dir>] [--json]\n" +
      "  <component>     basename (session-liveness.sh) or rel path (plugin/scripts/session-liveness.sh); may repeat\n" +
      "  --root <dir>    repo to scan (default: repo-root.ts resolution)\n" +
      "  --json          emit the full report as JSON\n" +
      "Exit: 0 = report produced (observer, not a pass/fail gate); 2 = usage/environment error.",
  );
  process.exit(0);
}

function printHuman(r: Report): void {
  console.log("deletion-closure-check — P1 删除闭包检测器 (docs/proposals/archguard-generation-era-primitives.md §3)");
  console.log(`component(s): ${r.components.join(", ")}`);
  console.log(`root: ${r.root}`);
  // skip 面来源必须每次打印 (硬规则 3b)：否则"gitignore 面没生效"与"生效且没命中"在输出上同形，
  // 而前者会让 gitignored 树 (别的 worktree 的整份副本) 静默重新进入闭包 —— 正是本缺陷的形态。
  if (r.ignoreSource.kind === "git-worktree") {
    console.log(`skip 面: gitignore 驱动 — ${r.ignoreSource.detail} ∪ SKIP_DIRS(${SKIP_DIRS.size} 条策略名)`);
  } else {
    console.log(`⚠️  skip 面: 仅 SKIP_DIRS — ${r.ignoreSource.detail}`);
  }
  console.log(`CallGraph (真调用) = ${r.counts.callGraphTotal} 文件`);
  console.log(`DC (删除闭包, code∪comment∪doc) = ${r.counts.dcTotal} 文件`);
  console.log(`R = |DC|/|CallGraph| = ${r.counts.ratio === null ? "n/a (CallGraph=0)" : r.counts.ratio.toFixed(2)}`);

  console.log(`\n按位置分类 (并集 = DC, 重叠允许):`);
  console.log(`  code    (6 类结构边): ${r.counts.code}`);
  console.log(`  comment (注释引用):    ${r.counts.comment}`);
  console.log(`  doc     (.md 文档提及): ${r.counts.doc}`);

  console.log(`\n结构边细分 (code 位置):`);
  console.log(`  import/source/bash/exec/spawn (call): ${r.counts.call}`);
  console.log(`  string literal (字面量, 非调用):      ${r.counts.literal}`);
  console.log(`  output-schema (输出解析):             ${r.counts.schema}`);
  console.log(`  test fixture (测试夹具):              ${r.counts.fixture}`);
  console.log(`  Touches (任务体声明):                 ${r.counts.touches}`);

  console.log(`\nCallGraph 清单 (前 8 条, 共 ${r.callGraph.length}):`);
  for (const f of r.callGraph.slice(0, 8)) console.log(`  ${f}`);
  if (r.callGraph.length > 8) console.log(`  … 及另外 ${r.callGraph.length - 8} 条`);

  console.log(`\nDC 清单 (前 15 条, 共 ${r.dc.length}):`);
  for (const f of r.dc.slice(0, 15)) {
    const ref = r.refs.find((x) => x.file === f);
    const tag = ref ? (ref.call ? "call" : ref.schema ? "schema" : ref.fixture ? "fixture" : ref.doc ? "doc" : ref.comment ? "comment" : "literal") : "?";
    console.log(`  [${tag}] ${f}`);
  }
  if (r.dc.length > 15) console.log(`  … 及另外 ${r.dc.length - 15} 条`);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const asJson = args.includes("--json");
  const rootArg = flagValue(args, "--root");
  const components = args.filter((x) => !x.startsWith("--") && x !== rootArg);
  if (components.length < 1) {
    console.error("ERROR: missing <component> argument");
    usage();
  }
  const root = rootArg ? path.resolve(rootArg) : repoRoot();
  if (!fs.existsSync(path.join(root, "plugin", "scripts"))) {
    console.error(`ERROR: plugin/scripts not found under ${root} — is --root correct?`);
    process.exit(2);
  }
  const report = deletionClosure(root, components);
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv);
}
