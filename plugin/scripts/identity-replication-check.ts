#!/usr/bin/env node
// identity-replication-check.ts — P2 身份复制检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P2).
// 同一个运行时实体被【独立命名 / 独立判定】的次数, 两个子度量:
//   (a) 字面量复制度: 含 X 路径/basename/env 名/CLI flag 的【代码】文件数, 且未经由单一访问器
//       (import/require/source)。按位置区分代码 / 注释 / 文档 — 注释与 .md 文档不算, 字符串字面量
//       (路径常量、spawn 参数、注册表条目) 是代码级引用, 算。
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

// ── 位置掩码 (comment-only: 只标注释为非代码, 字符串/模板字面量保持代码) ─────────────────────
// 与 checker-lib.ts 的 buildNonCodeMask 不同: 那个把字符串也标为非代码 (用于「命令位置」判定);
// 本任务要测的是【字面量】复制度 — 字符串字面量正是被测对象, 必须算代码。注释与文档才剔除。

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
    i++;
  }
  return mask;
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

/** 递归枚举 root 下 plugin/packages/experiments/scripts 的代码文件 (跳过 vendor/dist/fixture/node_modules)。
 *  遍历用 fs-walk.ts；skip 集与扩展名集仍是本检查器自己的。 */
export function walkCodeFiles(root: string): string[] {
  const roots = ["plugin", "packages", "experiments", "scripts"].map((d) => path.join(root, d));
  const out = roots.flatMap((r) =>
    walkFiles(r, {
      absolute: true,
      prune: (name) => SKIP_DIRS.has(name),
      include: (name, ext) => CODE_EXTS.has(ext),
    }),
  );
  return out.sort();
}

function relOf(root: string, f: string): string {
  return path.relative(root, f);
}

function lineOf(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        file: relOf(root, f),
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
}

/** 判定指纹 F: 一个代码文件【读 /proc/<pid>/cmdline】(外部事实 A) 且【对读到的内容做名字/特征比较】
 *  (外部事实 B: grep -q / .includes / .indexOf / .match / basename / .split / argv[0] / comm)。 */
export function findJudgmentRewrites(root: string, files: string[]): JudgmentRewrite[] {
  // 外部事实 A: 读 /proc/<pid>/cmdline — 必须出现在【读】上下文 (readFile* / shell `<` 重定向 / cat /
  // python open), 而非仅仅在描述字符串里提及该路径 (capability-catalog 的 QUESTION 描述不算实现)。
  // 两种实现形态都要抓 (文档 §2.8 方法(e) 的教训: 单位选错聚不出靶子): ①字面量 `/proc/${pid}/cmdline`;
  // ②构造形 `path.join(procRoot/procDir, pid, "cmdline")` (manager-tick-readings.ts:364 / worker-driver.ts)。
  const procPath = /\/proc\/[^'"\s\n]*\/cmdline/;
  const constructed = /(?:procRoot|procDir)[^'"\n]{0,60}["']cmdline["']/;
  const readPrim = /readFile|<|cat\s+|open\s*\(/;
  const compRe = /grep\s+-q|\.includes\(|\.indexOf\(|\.match\(|basename\(|\.split\(|\.startsWith\(|\.endsWith\(|argv\[0\]/;
  const out: JudgmentRewrite[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const mask = maskFor(f)(src);
    // 外部事实 B: 名字/特征比较原语 (识别进程的另一半)。
    if (codeMatch(src, mask, compRe).length === 0) continue;
    // 外部事实 A: 路径 (字面量或构造形) 落在代码位置, 且其【同行的前缀】含读原语。
    let found = false;
    let hitLine = 0;
    const scan = (re: RegExp) => {
      const g = new RegExp(re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = g.exec(src)) !== null) {
        if (mask[m.index] !== 0) continue;
        const prefix = src.slice(src.lastIndexOf("\n", m.index) + 1, m.index);
        if (readPrim.test(prefix)) { hitLine = lineOf(src, m.index); found = true; return; }
      }
    };
    scan(procPath);
    if (!found) scan(constructed);
    if (found) out.push({ file: relOf(root, f), line: hitLine });
  }
  return out;
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
        pairs.push({ plugin: `plugin/scripts/${name}`, experiment: relOf(root, cand), lines });
        totalLines += lines;
      }
    }
  }
  return { pairs, totalLines, symlinksSkipped };
}

// ── (a) 字面量复制度 (AC5: full vs code 分列; 单一访问器 vs 硬编码) ───────────────────────────

export interface LiteralReplication {
  entity: string;
  full: number;       // 含该 basename 的代码文件数 (全文)
  code: number;       // 其中 basename 落在【代码位置】(剔除注释/文档) 的文件数
  accessor: number;   // 经 import/require/source 单一访问器引用的文件数
  hardcoded: number;  // 代码位置硬编码字面量 (非 import/source) 的文件数
  codeFiles: string[];
}

export function literalReplication(root: string, files: string[], entity: string): LiteralReplication {
  const stem = entity.replace(/\.(ts|sh|mjs|js)$/, "");
  const codeFiles: string[] = [];
  let full = 0;
  let code = 0;
  let accessor = 0;
  let hardcoded = 0;
  const importRe = new RegExp(
    `(?:import\\s+[^'"\\n]*?from\\s*["'][^"']*?${escapeRegex(stem)}(?:\\.(?:ts|mjs|js))?["']|` +
      `import\\s*\\(\\s*["'][^"']*?${escapeRegex(stem)}(?:\\.(?:ts|mjs|js))?["']|` +
      `require\\s*\\(\\s*["'][^"']*?${escapeRegex(stem)}(?:\\.(?:ts|mjs|js))?["']|` +
      `(?:^|[;&|\\n])\\s*(?:\\.|source)\\s+["']?[^"'\\n]*?${escapeRegex(stem)}(?:\\.sh)?["']?)`,
  );
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (!src.includes(entity)) continue;
    full++;
    const mask = maskFor(f)(src);
    let codeHit = false;
    let idx = 0;
    while ((idx = src.indexOf(entity, idx)) !== -1) {
      if (mask[idx] === 0) { codeHit = true; break; }
      idx += entity.length;
    }
    if (codeHit) {
      code++;
      codeFiles.push(relOf(root, f));
      if (codeMatch(src, mask, importRe).length > 0) accessor++;
      else hardcoded++;
    }
  }
  return { entity, full, code, accessor, hardcoded, codeFiles };
}

/** 全量字面量复制度表: 对每个 plugin 脚本 basename 一次性算 full/code (单趟扫描所有文件)。 */
export function replicationTable(
  root: string,
  files: string[],
  entities: string[],
): LiteralReplication[] {
  const scriptsDir = path.join(root, "plugin", "scripts");
  const rows = entities.map((e) => ({
    entity: e,
    full: 0,
    code: 0,
    accessor: 0,
    hardcoded: 0,
    codeFiles: [] as string[],
  }));
  const stems = rows.map((r) => r.entity.replace(/\.(ts|sh|mjs|js)$/, ""));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = relOf(root, f);
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (!src.includes(row.entity)) continue;
      row.full++;
      const mask = maskFor(f)(src);
      let idx = 0;
      let codeHit = false;
      while ((idx = src.indexOf(row.entity, idx)) !== -1) {
        if (mask[idx] === 0) { codeHit = true; break; }
        idx += row.entity.length;
      }
      if (!codeHit) continue;
      row.code++;
      row.codeFiles.push(rel);
      const stem = stems[ri];
      const importRe = new RegExp(
        `(?:import\\s+[^'"\\n]*?from\\s*["'][^"']*?${escapeRegex(stem)}(?:\\.(?:ts|mjs|js))?["']|` +
          `import\\s*\\(\\s*["'][^"']*?${escapeRegex(stem)}(?:\\.(?:ts|mjs|js))?["']|` +
          `require\\s*\\(\\s*["'][^"']*?${escapeRegex(stem)}(?:\\.(?:ts|mjs|js))?["']|` +
          `(?:^|[;&|\\n])\\s*(?:\\.|source)\\s+["']?[^"'\\n]*?${escapeRegex(stem)}(?:\\.sh)?["']?)`,
      );
      if (codeMatch(src, mask, importRe).length > 0) row.accessor++;
      else row.hardcoded++;
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

export function sharedModuleControl(
  root: string,
  files: string[],
  entity: string,
  threshold = 5,
): SharedModuleControl {
  const r = literalReplication(root, files, entity);
  const flagged = r.hardcoded >= threshold && r.hardcoded > r.accessor;
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
  judgmentRewrites: JudgmentRewrite[];
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

export function run(root: string, limit: number): Report {
  // 排除检测器自身 + 其单测: 这两个文件含 /proc/<pid>/cmdline 指纹正则、"session-liveness.sh"
  // 被测实体字面量、以及 *_REL 合成 fixture 字符串 (检测器定义/测试输入, 不是被测对象) — 计入会
  // 把检测器自指与测试 fixture 误报成判定重写/复制度 (grep 自匹配, instrument-failure FAMILY-3 同形)。
  const files = walkCodeFiles(root).filter(
    (f) => !f.endsWith("/identity-replication-check.ts") && !f.endsWith("/identity-replication-check.test.mjs"),
  );

  const pathConstants = findPathConstants(root, files);

  const judgmentRewrites = findJudgmentRewrites(root, files);

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
      "  --root <dir>   repo to scan (default: repo-root.ts resolution)\n" +
      "  --limit <n>    max rows in the human literal-replication table (default 25)\n" +
      "  --json         emit the full report as JSON\n" +
      "Exit: 0 = report produced (observer, not a pass/fail gate); 2 = usage/environment error.",
  );
  process.exit(0);
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

  console.log(`\n== 判定重写 (AC2) — 读 /proc/<pid>/cmdline ∧ 比较名字 (识别进程) — ${report.judgmentRewrites.length} 处 ==`);
  for (const j of report.judgmentRewrites) console.log(`  ${j.file}:${j.line}`);

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
    console.log(`  ${r.entity.padEnd(44)} code=${String(r.code).padStart(3)}  full=${String(r.full).padStart(3)}  accessor=${r.accessor}  hardcoded=${r.hardcoded}`);
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
  const report = run(root, limit);
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
