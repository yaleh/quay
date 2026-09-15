#!/usr/bin/env node
// @instrument "Which plugin/scripts scripts are referenced by a BARE FILENAME in a registry/manifest carrier
//   (quay-deliver.ts MEMBERS `file:` fields, `*.json` manifests, registry-named code files) — the reference form
//   the §12e transitive closure misses — and what is the dead set after re-running the §12d closure WITH that edge?"
// plugin/scripts/registry-bare-filename-scan.ts — AC156 裸文件名引用扫描 + 死集重算
// (tasks/gap-dead-set-registry-bare-filename-scan, SPEC-plugin-lifecycle-single-bundle-2026-09-02 §12f).
//
// §12e 的传递闭包只识别两种引用形式：import 说明符、`node|bash|sh|tsx … plugin/scripts/<name>` 调用行。
// 它漏掉了第三种：注册表/清单载体里以裸文件名登记的引用——`quay-deliver.ts:19` 的
// `{ name:"supervisor-bus-identity", file:"supervisor-bus-identity.sh", … }`、`*.json` 清单里的
// 裸文件名键/值。漏掉 ⇒ 死集里混进仍被清单引用的脚本 ⇒ archive 它们留悬空引用或弄红检查。
// 本扫描器按【位置】补上这第三种形式（字符串字面量/JSON 字符串值恰等于 plugin/scripts 裸文件名），
// 并把该形式作为一条新边接进 §12d 死集闭包，产出重算后的死集清单。
//
// ⛔ 唯一不算引用的登记处是 capability-catalog.sh——它是对种群的【描述】不是使用；把 catalog 条目
//   当引用会让所有脚本永远活着（硬规则 4「结构上不可能取假的量」）。故本扫描器【显式排除】它。
//
// 三种模式：
//   --scan                      扫描裸文件名引用（默认）。人读输出，含真样本命中前 3 条实际内容。
//   --scan --json               机器可读 JSON（{refs:[{script,carriers:[{file,line,snippet}]}]}）。
//   --dead-set [--write <path>] 按 §12d 重算死集：报 before/after 两个数字 + 被摘出对象清单，
//                               写机器可读结果文件（默认 docs/analysis/dead-set-recomputed.json）。
//   --check                     套件门（生产调用点）：真样本 canary + 死集一致性；exit 0/1/3。
//
// 执行读数（AC4 手工实测法）：--dead-set 的「三天零执行」侧由本脚本【自含】三层 transcript 普查
//   （顶层 <sessionsDir>/*.jsonl + <session>/subagents/*.jsonl + <session>/subagents/workflows/<run>/agent-*.jsonl，
//   mtime 预筛 + 时间窗过滤），不依赖 runtime-usage-inventory.ts（其 readTranscripts 不枚举 workflows 层，
//   读数系统性偏低，SPEC §11b）。窗口默认 --since = 72h 前、--until = now，用 --since/--until 覆盖。
//
// Run:
//   node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts [--scan|--dead-set|--check] \
//       [--root <dir>] [--sessions-dir <dir>] [--since <iso>] [--until <iso>] [--json] [--write <path>]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 默认受检面 = quay 仓库根（本脚本位于 <repo>/plugin/scripts/）。 */
export const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
export const SCRIPTS_DIR_REL = "plugin/scripts";
/** 脚本全域 = plugin/scripts 顶层 .ts/.sh/.mjs（SPEC §12e 的 309 = 218+78+13）。 */
export const SCRIPT_EXTENSIONS = new Set([".ts", ".sh", ".mjs"]);
/** 死集重算结果文件（AC158 直接消费）。 */
export const DEAD_SET_RESULT_REL = "docs/analysis/dead-set-recomputed.json";
/** 已知真样本（AC2/DoD 负控制的锚）——必须命中 quay-deliver.ts 的裸文件名清单项。 */
export const KNOWN_SAMPLE = "supervisor-bus-identity.sh";
/** 该真样本所在的清单载体。 */
export const KNOWN_SAMPLE_CARRIER = "plugin/scripts/quay-deliver.ts";

/** 显式排除的登记处：capability-catalog.sh 是种群描述不是使用（硬规则 4）；本扫描器自身不是载体
 *  （其源码含 KNOWN_SAMPLE / EXCLUDED_CARRIER_BASENAMES 字符串，扫自己会把常量误判成引用）。 */
const SELF_BASENAME = path.basename(fileURLToPath(import.meta.url));
const EXCLUDED_CARRIER_BASENAMES = new Set(["capability-catalog.sh", SELF_BASENAME]);
const TEST_FILE_RE = /\.test\.(mjs|ts|cjs|js)$/;
const SKIP_DIR_NAMES = new Set([
  ".git", "node_modules", ".quay", ".archguard", "worktrees", "dist", "vendor", "archive",
  "docs", "measurements", "experiments", "packages", "tasks", ".claude", "fixtures",
]);
/** 注册表/清单形代码载体的文件名信号（§12f：quay-deliver.ts 这类清单、其它以数组/映射登记脚本处）。 */
const REGISTRY_NAME_RE = /registry|manifest|deliver|allowlist|exempt|catalog|members|inventory/i;
const CODE_CARRIER_EXTENSIONS = new Set([".ts", ".mjs", ".js", ".sh"]);

export interface BareRefCarrier {
  file: string;   // repo-relative carrier path
  line: number;   // 1-based line of the matched literal
  snippet: string; // the trimmed source line carrying the literal
}

export interface BareRef {
  script: string;             // bare filename (plugin/scripts/<script>)
  carriers: BareRefCarrier[];
}

export interface BareScanResult {
  generatedAt: string;
  root: string;
  scriptCount: number;
  carrierCount: number;
  refs: BareRef[];
  referencedScripts: string[];
  /** 四类引用（source/. 内建、测试存在性钉、config gate 注册、wrapper→委托模块）。 */
  extraRefs: ExtraRef[];
  /** 裸文件名引用 ∪ 四类引用的脚本名并集（:888 闸对 after.dead 求交的对象）。 */
  allReferencedScripts: string[];
}

// ── 注释屏蔽 + 字符串字面量提取（按位置判定，硬规则 2）──────────────────────────────────────────────
// 与 outer-retirement-precondition-check.ts 的 maskComments 同语义：屏蔽 `//` `/* */` 与 bash `#` 行注释，
// 【不】屏蔽字符串——import 说明符 `from "./x.ts"` 与 `file: "x.sh"` 里的文件名是真实调用面，必须命中。
export function maskComments(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
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
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "#") {
      // bash `#` 行注释（字符串内的 `#` 已被上面的字符串分支跳过）。
      mask[i] = 1; i++;
      while (i < n && src[i] !== "\n") { mask[i] = 1; i++; }
      continue;
    }
    i++;
  }
  return mask;
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

/**
 * 从源码（code 载体）提取「值恰等于某已知裸文件名」的字符串字面量。按位置：先屏蔽注释，
 * 再在未屏蔽处读引号字面量；值 ∈ knownNames ⇒ 命中（带行号 + 该行 snippet）。
 */
export function extractBareFilenameLiterals(
  src: string,
  knownNames: Set<string>,
): { value: string; line: number; snippet: string }[] {
  const mask = maskComments(src);
  const out: { value: string; line: number; snippet: string }[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "`") {
      // 反引号模板：跳过整个模板（含 ${} 插值），不当作裸文件名字面量。此前用 isTemplateInterp break
      //  会让扫描停在模板内部、后续的单/双引号字面量失读（kind ② 扫测试文件时暴露）。
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "`") { i++; break; }
        i++;
      }
      continue;
    }
    if ((c === '"' || c === "'") && mask[i] !== 1) {
      const q = c;
      const start = i;
      i++;
      let value = "";
      let closed = false;
      while (i < n) {
        if (src[i] === "\\") { value += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        if (src[i] === q) { closed = true; i++; break; }
        value += src[i];
        i++;
      }
      if (closed && knownNames.has(value)) {
        out.push({ value, line: lineOf(src, start), snippet: snippetOf(src, start) });
      }
      continue;
    }
    i++;
  }
  return out;
}

/** 从 JSON 清单提取「值/键恰等于某已知裸文件名」的字符串。JSON 无注释，直接读引号字面量。 */
export function extractJsonBareFilenames(
  text: string,
  knownNames: Set<string>,
): { value: string; line: number; snippet: string }[] {
  const out: { value: string; line: number; snippet: string }[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] === '"') {
      const start = i;
      i++;
      let value = "";
      let closed = false;
      while (i < n) {
        if (text[i] === "\\") { value += text[i] + (text[i + 1] ?? ""); i += 2; continue; }
        if (text[i] === '"') { closed = true; i++; break; }
        value += text[i];
        i++;
      }
      if (closed && knownNames.has(value)) {
        out.push({ value, line: lineOf(text, start), snippet: snippetOf(text, start) });
      }
      continue;
    }
    i++;
  }
  return out;
}

// ── 枚举 ─────────────────────────────────────────────────────────────────────────────────────────────

/** 枚举 plugin/scripts 顶层脚本（.ts/.sh/.mjs，非递归）。 */
export function listScriptBasenames(root: string): string[] {
  const dir = path.join(root, SCRIPTS_DIR_REL);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SCRIPT_EXTENSIONS.has(path.extname(e.name)))
    .map((e) => e.name)
    .sort();
}

function dirContainsSkip(fullDir: string): boolean {
  return fullDir.split(path.sep).some((seg) => SKIP_DIR_NAMES.has(seg));
}

/** 递归列出 root 下的普通文件（绝对路径，排序），跳过 skip 目录与符号链接。 */
function listFiles(root: string, exts: Set<string>): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(e.name) && !dirContainsSkip(full)) stack.push(full);
      } else if (e.isFile() && exts.has(path.extname(e.name))) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * 枚举注册表/清单载体（§12f）：
 *   (a) 所有 *.json（排除数据输出目录 docs/measurements/experiments/packages/tasks/.claude 等 + 锁文件）；
 *   (b) 文件名带 registry|manifest|deliver|allowlist|exempt|catalog|members|inventory 信号的 *.ts/mjs/js/sh；
 * 显式排除 capability-catalog.sh 与测试文件。
 */
export function listCarrierFiles(root: string): string[] {
  const jsonFiles = listFiles(root, new Set([".json"])).filter((f) => {
    const rel = path.relative(root, f).split(path.sep).join("/");
    const base = path.basename(f);
    if (rel === "package.json" || rel === "package-lock.json" || rel === "tsconfig.json") return false;
    return true;
  });
  const codeFiles = listFiles(root, CODE_CARRIER_EXTENSIONS).filter((f) => {
    const base = path.basename(f);
    if (EXCLUDED_CARRIER_BASENAMES.has(base)) return false;
    if (TEST_FILE_RE.test(base)) return false;
    return REGISTRY_NAME_RE.test(base);
  });
  return [...jsonFiles, ...codeFiles].sort();
}

// ── 扫描 ─────────────────────────────────────────────────────────────────────────────────────────────

/** 纯核心：给定载体文本 + 已知裸文件名，返回命中的裸文件名（去重，带载体行/snippet）。 */
export function scanCarrier(
  relFile: string,
  text: string,
  knownNames: Set<string>,
): { script: string; carrier: BareRefCarrier }[] {
  const isJson = relFile.endsWith(".json");
  const hits = isJson
    ? extractJsonBareFilenames(text, knownNames)
    : extractBareFilenameLiterals(text, knownNames);
  const out: { script: string; carrier: BareRefCarrier }[] = [];
  for (const h of hits) {
    out.push({
      script: h.value,
      carrier: { file: relFile, line: h.line, snippet: h.snippet },
    });
  }
  return out;
}

/** 主扫描：枚举载体 + 裸文件名，逐载体按位置匹配，聚合为 script → carriers。 */
export function scanBareFilenameRefs(root: string): BareScanResult {
  const basenames = listScriptBasenames(root);
  const known = new Set(basenames);
  const carriers = listCarrierFiles(root);
  const byScript = new Map<string, BareRefCarrier[]>();
  for (const abs of carriers) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const hit of scanCarrier(rel, text, known)) {
      // 自引用（脚本判自己是不是主入口：process.argv[1].endsWith("<name>")）不算引用——与
      // buildReferenceMap 的 carrierAbs !== scriptAbsPath 同一语义，避免它出现在 referencedScripts。
      if (rel === `${SCRIPTS_DIR_REL}/${hit.script}`) continue;
      const list = byScript.get(hit.script) ?? [];
      list.push(hit.carrier);
      byScript.set(hit.script, list);
    }
  }
  const refs: BareRef[] = [...byScript.entries()]
    .map(([script, carriers]) => ({ script, carriers }))
    .sort((a, b) => a.script.localeCompare(b.script));
  const referencedScripts = refs.map((r) => r.script).sort();
  const extraRefs = collectExtraRefs(root, basenames);
  const allReferencedScripts = [...new Set([...referencedScripts, ...extraRefs.map((r) => r.script)])].sort();
  return {
    generatedAt: new Date().toISOString(),
    root,
    scriptCount: basenames.length,
    carrierCount: carriers.length,
    refs,
    referencedScripts,
    extraRefs,
    allReferencedScripts,
  };
}

// ── 执行普查（AC4 手工实测法：自含三层 transcript 枚举，不依赖 runtime-usage-inventory.ts）──────────

function stripQuotedContent(command: string): string {
  // 去掉引号字符但保留内容（与 runtime-usage-inventory.ts 同语义），再压缩空白。
  let out = "";
  let i = 0;
  const n = command.length;
  while (i < n) {
    const c = command[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n && command[i] !== q) { out += command[i]; i++; }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/\s+/g, " ");
}

const EXECUTORS = new Set([
  "node", "nodejs", "bun", "deno", "python", "python3", "ruby", "perl", "php",
  "bash", "sh", "dash", "zsh", "ksh", "fish", "tsx", "ts-node", "source",
]);
const WRAPPERS = new Set(["env", "timeout", "sudo", "command", "exec", "nice", "nohup", "setsid", "stdbuf"]);
const INLINE_CODE_FLAGS: Record<string, Set<string>> = {
  node: new Set(["-e", "--eval", "-p", "--print", "--input-type"]),
  nodejs: new Set(["-e", "--eval", "-p", "--print", "--input-type"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  bash: new Set(["-c", "--command"]),
  sh: new Set(["-c"]),
  dash: new Set(["-c"]),
  zsh: new Set(["-c"]),
};

function basenameOf(token: string): string {
  const t = token.replace(/^\.\//, "");
  return t.split("/").pop() ?? t;
}

/** 一条 Bash 命令是否在【执行位置】出现脚本 basename（program 或 executor 实参）。 */
export function commandExecutesScript(command: string, script: string): boolean {
  const cleaned = stripQuotedContent(command);
  for (const raw of cleaned.split(/(?:;|&&|\|\||\||\(|\)|\n)/)) {
    const argv = raw.trim().split(/\s+/).filter(Boolean);
    if (!argv.length) continue;
    let i = 0;
    while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
    let prog = argv[i] ?? "";
    let rest = argv.slice(i + 1);
    if (WRAPPERS.has(prog)) {
      let j = 0;
      while (j < rest.length) {
        const t = rest[j];
        if (t.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || /^\d+(\.\d+)?$/.test(t)) { j++; continue; }
        break;
      }
      prog = rest[j] ?? "";
      rest = rest.slice(j + 1);
    }
    if (prog && basenameOf(prog) === script) return true;
    if (EXECUTORS.has(prog)) {
      const flags = INLINE_CODE_FLAGS[prog];
      if (flags && rest.some((a) => flags.has(a))) continue; // -e/-c：内联代码，非脚本文件
      for (const a of rest) if (basenameOf(a) === script) return true;
    }
  }
  return false;
}

/** 枚举三层 transcript .jsonl（顶层 + 直属 subagents + subagents/workflows/<run>/）。 */
export function enumerateTranscriptFiles(sessionsDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(sessionsDir)) return out;
  for (const f of fs.readdirSync(sessionsDir)) {
    if (f.endsWith(".jsonl")) out.push(path.join(sessionsDir, f));
  }
  for (const d of fs.readdirSync(sessionsDir)) {
    const sub = path.join(sessionsDir, d, "subagents");
    let st: fs.Stats;
    try {
      st = fs.statSync(sub);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    // 直属 subagents
    try {
      for (const f of fs.readdirSync(sub)) {
        if (f.endsWith(".jsonl")) out.push(path.join(sub, f));
      }
    } catch { /* skip */ }
    // workflows/<run>/agent-*.jsonl（runtime-usage-inventory.ts 漏掉的一层）
    const wf = path.join(sub, "workflows");
    try {
      if (!fs.statSync(wf).isDirectory()) continue;
      for (const run of fs.readdirSync(wf)) {
        const runDir = path.join(wf, run);
        let runSt: fs.Stats;
        try {
          runSt = fs.statSync(runDir);
        } catch {
          continue;
        }
        if (!runSt.isDirectory()) continue;
        try {
          for (const f of fs.readdirSync(runDir)) {
            if (f.endsWith(".jsonl")) out.push(path.join(runDir, f));
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return out.sort();
}

/** 普查：三层 transcript 中每个脚本的执行次数（窗口过滤 + mtime 预筛）。 */
export function countExecutions(
  sessionsDir: string,
  since: string,
  until: string,
  scripts: string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of scripts) counts.set(s, 0);
  if (!fs.existsSync(sessionsDir)) return counts;
  const sinceMs = Date.parse(since);
  for (const f of enumerateTranscriptFiles(sessionsDir)) {
    try {
      if (fs.statSync(f).mtimeMs < sinceMs) continue; // 预筛：mtime 早于窗口的 transcript 不含窗口内记录
    } catch {
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec: any;
      try {
        rec = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const ts: string | undefined = rec?.timestamp;
      if (!ts || ts < since || ts >= until) continue;
      if (rec?.type !== "assistant") continue;
      const blocks = rec?.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const blk of blocks) {
        if (blk?.type !== "tool_use") continue;
        if (blk.name === "Bash" && typeof blk?.input?.command === "string") {
          for (const s of scripts) {
            if (commandExecutesScript(blk.input.command, s)) counts.set(s, (counts.get(s) ?? 0) + 1);
          }
        }
      }
    }
  }
  return counts;
}

// ── §12d/§12e 死集闭包（含 §12f 裸文件名新边）────────────────────────────────────────────────────────

function walkSourceFiles(root: string): string[] {
  return listFiles(root, new Set([".ts", ".mjs", ".js", ".sh", ".md", ".yml", ".yaml"]));
}

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/** 屏蔽注释（行注释、块注释、bash 井号注释）但保留字符串字面量与代码，返回注释处替换为空格、其余
 *  原样的字符串。`stripComments` 只认行注释与块注释：对 bash 语法的 `.ts`（如 runner-static-gate.ts，
 *  被 scripts/test.sh `source`）里的 `# @static-object …` 注释行，其中的星号斜杠 glob 会被误当块注释
 *  起点，吞掉 run_checker 行 ⇒ `${repo_root}/plugin/scripts/<name>` 调用行读不到（AC158 负控制发现的
 *  14 个活 checker 假死的根因）。复用 maskComments（已含井号注释且跳过字符串，硬规则 2）。 */
function stripCommentsIncludingHash(src: string): string {
  const mask = maskComments(src);
  let out = "";
  for (let i = 0; i < src.length; i++) out += mask[i] === 1 ? " " : src[i];
  return out;
}

const IMPORT_SPEC_RE = /(?:import\s*\(\s*|require\s*\(\s*|from\s*|import\s*)(['"])([^'"]+)\1/g;

/** 从（去注释）源码提取 import/require 模块说明符。 */
function extractModuleSpecifiers(cleaned: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_SPEC_RE.lastIndex = 0;
  while ((m = IMPORT_SPEC_RE.exec(cleaned)) !== null) out.push(m[2]);
  return out;
}

const scriptAbsCache = new Map<string, string>();

function scriptAbsPath(root: string, script: string): string {
  const key = root + ":" + script;
  let v = scriptAbsCache.get(key);
  if (v === undefined) {
    v = path.join(root, SCRIPTS_DIR_REL, script);
    scriptAbsCache.set(key, v);
  }
  return v;
}

/** 预建：脚本绝对路径 → basename（供 import 解析 O(1) 查表，避免 O(scripts) 内层循环）。 */
function buildAbsToScript(root: string, scripts: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of scripts) m.set(path.resolve(root, SCRIPTS_DIR_REL, s), s);
  return m;
}

const PATH_REF_RE = /plugin\/scripts\/([A-Za-z0-9._-]+)/g;
/** `path.join(__dirname, "<name>")` —— 执行核在同一 plugin/scripts/ 目录内以 __dirname 相对引用脚本
 *  （runner-tree-state.ts:50 的 assert-clean-tree.sh、full-suite-runner.ts 的 provision-verify-worktree.sh）。
 *  仅当载体文件本身就在 plugin/scripts/ 顶层时 __dirname 才解析为该目录，故匹配侧再做目录限定。 */
const DIRNAME_JOIN_RE = /path\.join\(\s*__dirname\s*,\s*(['"])([A-Za-z0-9._-]+)\1\s*\)/g;
/** `$SCRIPT_DIR/<name>` / `${SCRIPT_DIR}/<name>` —— bash 包装器以自身所在目录相对引用 sibling（与
 *  quay-init.sh:1219 的 laydown 闭包同形；cap-from-gate.sh:24、send-keys-reliable.sh:57）。仅当载体
 *  在 plugin/scripts/ 顶层时 `$SCRIPT_DIR` 才解析为该目录。 */
const SCRIPT_DIR_REF_RE = /(?:\$\{SCRIPT_DIR\}\/|\$SCRIPT_DIR\/)([A-Za-z0-9][A-Za-z0-9._-]*)/g;
/** `resolveKernelSibling("<name>")` —— 执行核经 driver-runtime.ts 的 kernel 安装位置解析 sibling 脚本
 *  （gap-ac225 迁移后的新锚点：suite-state-trigger.ts 的 full-suite-runner.ts、full-suite-runner.ts 的
 *  worktree-process-reaper.ts / suite-load-sampler.ts、promotion-driver.ts 的 ready-pool-check.ts）。
 *  name 是脚本 basename（.ts/.sh/.mjs）。与 __dirname/$SCRIPT_DIR 同为「目录相对执行形式」，仅在载体
 *  处于 plugin/scripts/ 顶层时才算生产调用者（同一目录限定，见 (2b)）。 */
const KERNEL_SIBLING_RE = /resolveKernelSibling\(\s*(['"])([A-Za-z0-9._-]+)\1\s*\)/g;
/** `path.join(resolveKernelPluginRoot(), "scripts", "<name>")` —— 同上，但直接拼 scripts 目录
 *  （gap-ac225：runner-tree-state.ts 的 assert-clean-tree.sh、full-suite-runner.ts 的
 *  provision-verify-worktree.sh / resource-gate.sh、runner-concurrency.ts 的 process-budget.sh、
 *  worker-driver.ts 的 dispatch-worktree-setup.sh / suite-slot-lib.sh）。 */
const KERNEL_PLUGIN_SCRIPTS_RE = /resolveKernelPluginRoot\(\s*\)\s*,\s*(['"])scripts\1\s*,\s*(['"])([A-Za-z0-9._-]+)\2/g;

// ── 四类引用（gap-dead-set-closure-misses-four-reference-kinds）──────────────────────────────────
// §12e 传递闭包只认「调用形式」（import 说明符、node|bash|sh|tsx <path>、${repo_root}/ 插值、
// path.join(__dirname,…)、$SCRIPT_DIR/…）。漏认四类引用 ⇒ 死集混入仍在生产使用的活脚本。
// 本节把四类补进【收集器】，既有 :888 闸自动覆盖（⛔ 不新造第二个闸，双判据必然漂移）。
// ① bash `source`/`.` 内建（执行）② plugin/test 存在性钉 ③ .quay/config.yml gate 注册
// ④ wrapper→委托模块（同名 .sh/.ts 对称对）。

export type ExtraRefKind = "source-builtin" | "test-pin" | "config-gate" | "wrapper-delegate";

export interface ExtraRef {
  script: string;          // plugin/scripts/<script> 裸文件名
  carrier: BareRefCarrier; // 引用它的载体（file=repo-relative, line, snippet）
  kind: ExtraRefKind;
}

/** 每类各钉一个已知为真样本（硬规则 2 的零计数配套动作）：样本 0 命中 ⇒ 谓词写错，报红，
 *  ⛔ 不得判「无此类引用」。 */
export const EXTRA_KIND_SAMPLES: { script: string; carrier: string; kind: ExtraRefKind }[] = [
  { script: "suite-slot-lib.sh", carrier: "scripts/test.sh", kind: "source-builtin" },
  { script: "loadbearing-test-gate.ts", carrier: "plugin/test/plugin-packaging.test.mjs", kind: "test-pin" },
  { script: "anti-gaming-guard.sh", carrier: ".quay/config.yml", kind: "config-gate" },
  { script: "drivable-workspace-check.sh", carrier: "plugin/scripts/drivable-workspace-check.ts", kind: "wrapper-delegate" },
];

/** ① bash `source` / `.` 内建 —— `source <path>` / `. <path>`，path 含 plugin/scripts/<name>
 *  （含 "${repo_root}/plugin/scripts/<name>" 插值形态与引号形态）。source/. 是执行（加载脚本），
 *  不是「散文提及」，故被 source 的脚本直接判活（硬规则 4b：执行是直接量）。 */
const SOURCE_BUILTIN_RE = /(?:^|[;&|()\s])(?:source|\.)\s+(?:["'])?[^"'\s;&|()]*plugin\/scripts\/([A-Za-z0-9._-]+)/g;
/** ③ .quay/config.yml 里 gate 的 script:/command: 路径（`./plugin/scripts/<name>` 或
 *  `node plugin/scripts/<name>`）。.quay/ 被 walk 跳过，故单独读文件。 */
const CONFIG_GATE_RE = /(?:script|command):\s*"[^"\n]*plugin\/scripts\/([A-Za-z0-9._-]+)/g;

/**
 * 收集 §12e 闭包漏认的四类引用。返回的每个 ExtraRef 带载体行号/snippet，供 --check 逐条打印样本
 * 命中（AC1）与 --dead-set 重算（AC3）。
 */
export function collectExtraRefs(root: string, scripts: string[]): ExtraRef[] {
  const out: ExtraRef[] = [];
  const scriptSet = new Set(scripts);
  const add = (script: string, carrierFile: string, line: number, snippet: string, kind: ExtraRefKind) => {
    if (!scriptSet.has(script)) return;
    out.push({ script, carrier: { file: carrierFile, line, snippet }, kind });
  };

  // ① source-builtin：`source <path>` / `. <path>`。
  for (const abs of walkSourceFiles(root)) {
    const base = path.basename(abs);
    if (base === "capability-catalog.sh") continue;
    if (TEST_FILE_RE.test(base)) continue;
    const ext = path.extname(abs);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const cleaned = ext === ".md" || ext === ".yml" || ext === ".yaml" ? text : stripCommentsIncludingHash(text);
    SOURCE_BUILTIN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SOURCE_BUILTIN_RE.exec(cleaned)) !== null) {
      // m.index 落在前导边界（如行首 \n）上，line/snippet 会指向上一行；改用脚本名实参的位置定位。
      const nameIdx = cleaned.indexOf(m[1], m.index);
      add(m[1], rel, lineOf(cleaned, nameIdx), snippetOf(cleaned, nameIdx), "source-builtin");
    }
  }

  // ② test-pin：plugin/test/**/*.{mjs,ts,cjs,js} 里的裸文件名（存在性钉）。
  const testDir = path.join(root, "plugin", "test");
  if (fs.existsSync(testDir)) {
    for (const abs of listFiles(testDir, new Set([".mjs", ".ts", ".cjs", ".js"]))) {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      let text: string;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      for (const hit of extractBareFilenameLiterals(text, scriptSet)) {
        add(hit.value, rel, hit.line, hit.snippet, "test-pin");
      }
    }
  }

  // ③ config-gate：.quay/config.yml 里 gate 的 script:/command: 路径。
  const cfgPath = path.join(root, ".quay", "config.yml");
  if (fs.existsSync(cfgPath)) {
    let cfg = "";
    try {
      cfg = fs.readFileSync(cfgPath, "utf8");
    } catch { /* ignore */ }
    const cleanedCfg = cfg.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l)).join("\n");
    CONFIG_GATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CONFIG_GATE_RE.exec(cleanedCfg)) !== null) {
      add(m[1], ".quay/config.yml", lineOf(cleanedCfg, m.index), snippetOf(cleanedCfg, m.index), "config-gate");
    }
  }

  // ④ wrapper-delegate：同名 .sh/.ts 对，其中 .sh 在非注释位置委托给 .ts（node "$(dirname "$0")/<name>.ts"、
  //    exec … "$SCRIPT_DIR/<name>.ts"、gate_delegate_ts "<name>.ts" 等）⇒ 加对称引用（.sh⇄.ts 成对保持，
  //    避免「wrapper 被裁而 delegate 活着没了入口」/「delegate 被裁而 wrapper 活着没了模块」）。
  const byBase = new Map<string, { sh?: string; ts?: string }>();
  for (const s of scripts) {
    const ext = path.extname(s);
    if (ext !== ".sh" && ext !== ".ts") continue;
    const base = s.slice(0, -ext.length);
    const e = byBase.get(base) ?? {};
    if (ext === ".sh") e.sh = s; else e.ts = s;
    byBase.set(base, e);
  }
  for (const pair of byBase.values()) {
    if (!pair.sh || !pair.ts) continue;
    const shRel = path.relative(root, scriptAbsPath(root, pair.sh)).split(path.sep).join("/");
    const tsRel = path.relative(root, scriptAbsPath(root, pair.ts)).split(path.sep).join("/");
    let shText = "";
    try {
      shText = fs.readFileSync(scriptAbsPath(root, pair.sh), "utf8");
    } catch {
      continue;
    }
    const shCleaned = stripCommentsIncludingHash(shText);
    if (!shCleaned.includes(pair.ts)) continue; // 非委托对（checker-cost / repo-root 等不引用同名 .ts）
    const idx = shCleaned.indexOf(pair.ts);
    const line = lineOf(shCleaned, idx);
    const snippet = snippetOf(shCleaned, idx);
    add(pair.ts, shRel, line, snippet, "wrapper-delegate");
    add(pair.sh, tsRel, 1, `wrapper-delegate pair: ${pair.sh} ⇄ ${pair.ts}`, "wrapper-delegate");
  }

  // 按 (script, carrier, kind) 去重后排序，稳定输出。
  const seen = new Set<string>();
  return out
    .filter((r) => {
      const k = `${r.script}|${r.carrier.file}|${r.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.script.localeCompare(b.script) || a.kind.localeCompare(b.kind) || a.carrier.file.localeCompare(b.carrier.file));
}

export interface ReferenceMap {
  /** script → 引用它的文件（绝对路径）集合。 */
  referrers: Map<string, Set<string>>;
}

/**
 * 建立反向引用表：对每个脚本，收集「以代码位置引用它」的文件（import 说明符 / plugin/scripts/<name>
 * 调用行（含 `${repo_root}/plugin/scripts/<name>` 插值形式）/ path.join(__dirname, "<name>") 相对执行形式
 * / 裸文件名清单项）。`bareRefs` 为扫描结果（调用方已算一次，勿重扫）；`includeBare` 控制是否
 * 计入 §12f 裸文件名边（before/after 对照）。载体排除：脚本自身、测试文件、capability-catalog.sh。
 * `.md` 引用只认 `plugin/scripts/<name>` 命令行（散文提及不算，SPEC §12d）；`.json` 只认裸文件名。
 */
export function buildReferenceMap(
  root: string,
  scripts: string[],
  bareRefs: BareRef[],
  includeBare: boolean,
  extraRefs: ExtraRef[] = [],
): ReferenceMap {
  const referrers = new Map<string, Set<string>>();
  const scriptSet = new Set(scripts);
  for (const s of scripts) referrers.set(s, new Set());
  const absToScript = buildAbsToScript(root, scripts);
  for (const abs of walkSourceFiles(root)) {
    const base = path.basename(abs);
    if (base === "capability-catalog.sh") continue;
    if (TEST_FILE_RE.test(base)) continue;
    const ext = path.extname(abs);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    // (1) import 说明符（仅代码扩展名）
    if (ext === ".ts" || ext === ".mjs" || ext === ".js") {
      const cleaned = stripComments(text);
      for (const spec of extractModuleSpecifiers(cleaned)) {
        if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
        const base2 = spec.startsWith("/") ? path.join(root, spec.slice(1)) : path.resolve(path.dirname(abs), spec);
        for (const cand of [base2, `${base2}.ts`, `${base2}.tsx`, `${base2}.mjs`, `${base2}.js`, `${base2}.cjs`]) {
          const s = absToScript.get(path.resolve(cand));
          if (s !== undefined) {
            if (path.resolve(abs) !== scriptAbsPath(root, s)) referrers.get(s)!.add(abs);
            break;
          }
        }
      }
    }
    // (2) plugin/scripts/<name> 调用行（代码与 .md/.yml 交付面都认）。代码侧改用含 bash `#` 的屏蔽
    //     （stripCommentsIncludingHash）：runner-static-gate.ts 这类 bash `.ts` 的 `# @static-object` glob
    //     会把 `/*` 误判成块注释、吞掉 `${repo_root}/plugin/scripts/<name>` 调用行。
    const cleanedCode = ext === ".md" || ext === ".yml" || ext === ".yaml" ? text : stripCommentsIncludingHash(text);
    let m: RegExpExecArray | null;
    PATH_REF_RE.lastIndex = 0;
    while ((m = PATH_REF_RE.exec(cleanedCode)) !== null) {
      const s = m[1];
      if (scriptSet.has(s) && path.resolve(abs) !== scriptAbsPath(root, s)) referrers.get(s)!.add(abs);
    }
    // (2b) 目录相对执行形式：载体在 plugin/scripts/ 顶层时，__dirname（TS/JS）、$SCRIPT_DIR（bash）与
    //      kernel 安装位置（resolveKernelSibling / resolveKernelPluginRoot）都解析为 plugin/scripts/。
    //      四种写法都算生产调用者：
    //        - path.join(__dirname, "<name>")           （legacy；gap-ac225 已迁移掉活样本）
    //        - $SCRIPT_DIR/<name> / ${SCRIPT_DIR}/<name>（bash 包装器：cap-from-gate.sh:24 cap-from-gate.ts、
    //          send-keys-reliable.sh:57 transcript-delivery-check.ts）
    //        - resolveKernelSibling("<name>")           （gap-ac225：suite-state-trigger.ts full-suite-runner.ts）
    //        - path.join(resolveKernelPluginRoot(), "scripts", "<name>")（gap-ac225：runner-tree-state.ts
    //          assert-clean-tree.sh、full-suite-runner.ts provision-verify-worktree.sh）
    //      仅当载体文件本身在 plugin/scripts/ 顶层时才解析为该目录（packages/*/bin 的 __dirname 不在此列）。
    const isCode = ext === ".ts" || ext === ".mjs" || ext === ".js" || ext === ".sh";
    if (isCode && path.dirname(path.relative(root, abs)).split(path.sep).join("/") === SCRIPTS_DIR_REL) {
      let dm: RegExpExecArray | null;
      DIRNAME_JOIN_RE.lastIndex = 0;
      while ((dm = DIRNAME_JOIN_RE.exec(cleanedCode)) !== null) {
        const s = dm[2];
        if (scriptSet.has(s) && path.resolve(abs) !== scriptAbsPath(root, s)) referrers.get(s)!.add(abs);
      }
      SCRIPT_DIR_REF_RE.lastIndex = 0;
      while ((dm = SCRIPT_DIR_REF_RE.exec(cleanedCode)) !== null) {
        const s = dm[1];
        if (scriptSet.has(s) && path.resolve(abs) !== scriptAbsPath(root, s)) referrers.get(s)!.add(abs);
      }
      KERNEL_SIBLING_RE.lastIndex = 0;
      while ((dm = KERNEL_SIBLING_RE.exec(cleanedCode)) !== null) {
        const s = dm[2];
        if (scriptSet.has(s) && path.resolve(abs) !== scriptAbsPath(root, s)) referrers.get(s)!.add(abs);
      }
      KERNEL_PLUGIN_SCRIPTS_RE.lastIndex = 0;
      while ((dm = KERNEL_PLUGIN_SCRIPTS_RE.exec(cleanedCode)) !== null) {
        const s = dm[3];
        if (scriptSet.has(s) && path.resolve(abs) !== scriptAbsPath(root, s)) referrers.get(s)!.add(abs);
      }
    }
  }
  // (3) 裸文件名边：直接从扫描结果加入（载体可能是 .ts 清单也可能是 .json 清单——walkSourceFiles
  //     不含 .json，故不能在 walk 内按 abs 匹配，否则 mirror-pair-drift-allowlist.json 这类 JSON 载体
  //     的裸文件名引用会被漏掉）。O(边数)。
  if (includeBare) {
    for (const ref of bareRefs) {
      for (const c of ref.carriers) {
        const carrierAbs = path.resolve(root, c.file);
        if (carrierAbs !== scriptAbsPath(root, ref.script)) referrers.get(ref.script)!.add(carrierAbs);
      }
    }
  }
  // (4) 四类引用边（source/. 内建、测试存在性钉、config gate 注册、wrapper→委托模块）——与 (3) 同理由
  //     直接按载体路径加入（config.yml 在 .quay/、测试文件被 walk 排除、wrapper-delegate 载体是 sibling）。
  //     ④ wrapper-delegate 的对称边在此处进入 referrers，由 computeKept 的不动点做「条件保持」（不无条件判活）。
  for (const r of extraRefs) {
    const carrierAbs = path.resolve(root, r.carrier.file);
    if (carrierAbs !== scriptAbsPath(root, r.script)) referrers.get(r.script)!.add(carrierAbs);
  }
  return { referrers };
}

/** 交付面（非脚本）文件的判定：SPEC §12e 严格口径 = shipped skills/workflows + 三个活执行核 + CI + 产品代码。
 *  ⛔ 不含 orchestration/ 的 SPEC 文档、日志（manager-loop-tick.md）、archive——那些是「散文提及」不算
 *  生产调用者（§12d）。三个活执行核 = manager/orchestrator/fast-mode-tick-core.md（含 plugin/loop/ 镜像）。 */
function isDeliverySurfaceFile(root: string, abs: string): boolean {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  return (
    rel.startsWith("plugin/skills/") ||
    rel.startsWith("plugin/workflows/") ||
    rel.startsWith(".claude/workflows/") ||
    rel.startsWith(".github/workflows/") ||
    rel.startsWith("packages/") ||
    rel === "orchestration/manager-tick-core.md" ||
    rel === "orchestration/orchestrator-tick-core.md" ||
    rel === "orchestration/fast-mode-tick-core.md" ||
    rel.startsWith("plugin/loop/") ||
    rel.endsWith(".json") // JSON 清单本身是交付面（非脚本）
  );
}

/**
 * §12e 闭包不动点：KEEP = 执行根 ∪ 被交付面引用 ∪（被 KEEP 的脚本引用）。
 * `includeBare` 决定是否把 §12f 裸文件名边计入（before/after 对照）。
 */
export function computeKept(
  root: string,
  scripts: string[],
  executed: Map<string, number>,
  bareRefs: BareRef[],
  includeBare: boolean,
  extraRefs: ExtraRef[] = [],
): Set<string> {
  const { referrers } = buildReferenceMap(root, scripts, bareRefs, includeBare, extraRefs);
  const scriptSet = new Set(scripts);
  const kept = new Set<string>();
  // 根 1：执行（三天内有执行）
  for (const s of scripts) if ((executed.get(s) ?? 0) > 0) kept.add(s);
  // 根 1b（新增）：被四类【直接】引用（source/. 执行、测试存在性钉、config.yml gate 注册）——都是明确的
  //   「被使用」，不依赖载体是否交付面（硬规则 4b：执行/注册是直接量）。④ wrapper-delegate 不在此列，
  //   由 referrers 对称边 + 不动点做条件保持（wrapper 被引用时才拉入 delegate，反之亦然）。
  for (const r of extraRefs) if (r.kind !== "wrapper-delegate") kept.add(r.script);
  // 根 2：被非脚本交付面引用
  for (const s of scripts) {
    for (const f of referrers.get(s) ?? []) {
      if (!scriptSet.has(path.basename(f)) && isDeliverySurfaceFile(root, f)) {
        kept.add(s);
        break;
      }
    }
  }
  // 不动点：被 KEEP 的脚本引用 ⇒ 留存
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of scripts) {
      if (kept.has(s)) continue;
      for (const f of referrers.get(s) ?? []) {
        const fb = path.basename(f);
        if (scriptSet.has(fb) && kept.has(fb)) {
          kept.add(s);
          changed = true;
          break;
        }
      }
    }
  }
  return kept;
}

export interface DeadSetRecompute {
  generatedAt: string;
  root: string;
  sessionsDir: string;
  method: string;
  executionDataSource: string;
  window: { since: string; until: string; hours: number };
  universe: number;
  before: { deadCount: number; dead: string[] };
  after: { deadCount: number; dead: string[] };
  extractedByBareFilenameScan: { script: string; carriers: BareRefCarrier[] }[];
}

/** §12d 死集重算：before（不含裸文件名边）→ after（含裸文件名边），报被摘出对象。 */
export function recomputeDeadSet(
  root: string,
  sessionsDir: string,
  since: string,
  until: string,
  bareRefs: BareRef[],
  extraRefs: ExtraRef[] = [],
): DeadSetRecompute {
  const scripts = listScriptBasenames(root);
  const executed = countExecutions(sessionsDir, since, until, scripts);
  const keptBefore = computeKept(root, scripts, executed, bareRefs, false, extraRefs);
  const keptAfter = computeKept(root, scripts, executed, bareRefs, true, extraRefs);
  const deadBefore = scripts.filter((s) => !keptBefore.has(s)).sort();
  const deadAfter = scripts.filter((s) => !keptAfter.has(s)).sort();
  const bareByScript = new Map<string, BareRef>();
  for (const ref of bareRefs) bareByScript.set(ref.script, ref);
  const extracted = deadBefore
    .filter((s) => bareByScript.has(s))
    .map((s) => bareByScript.get(s)!);
  return {
    generatedAt: new Date().toISOString(),
    root,
    sessionsDir,
    method: "SPEC §12d (三天零执行 ∧ 无生产调用者) + §12e 传递闭包（补 source/./测试存在性钉/config gate 注册/wrapper-delegate 四类引用）+ §12f 裸文件名边",
    executionDataSource: "manual 3-layer transcript census (AC4 method b; not runtime-usage-inventory.ts)",
    window: {
      since,
      until,
      hours: Math.round((Date.parse(until) - Date.parse(since)) / 3600000),
    },
    universe: scripts.length,
    before: { deadCount: deadBefore.length, dead: deadBefore },
    after: { deadCount: deadAfter.length, dead: deadAfter },
    extractedByBareFilenameScan: extracted,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

function usage(): string {
  return `registry-bare-filename-scan.ts — AC156 裸文件名引用扫描 + 死集重算
usage:
  node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts [--scan] [--root <dir>] [--json]
  node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --dead-set [--root <dir>] [--sessions-dir <dir>] [--since <iso>] [--until <iso>] [--write <path>] [--json]
  node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --check [--root <dir>]
`;
}

function printScan(result: BareScanResult): string {
  const lines: string[] = [];
  lines.push(`registry-bare-filename-scan: ${result.refs.length} script(s) referenced by bare filename in ${result.carrierCount} carrier(s) (universe ${result.scriptCount})`);
  for (const ref of result.refs) {
    lines.push(`  ${ref.script}  ← ${ref.carriers.length} carrier(s)`);
    for (const c of ref.carriers.slice(0, 3)) {
      lines.push(`      ${c.file}:${c.line}  ${c.snippet}`);
    }
    if (ref.carriers.length > 3) lines.push(`      … (+${ref.carriers.length - 3} more)`);
  }
  // AC2：真样本命中前 3 条实际内容（命中数为 0 = 谓词写错，不是「无此类引用」）
  const sample = result.refs.find((r) => r.script === KNOWN_SAMPLE);
  if (sample) {
    lines.push(`known-sample ${KNOWN_SAMPLE}: ${sample.carriers.length} hit(s)`);
    for (const c of sample.carriers.slice(0, 3)) lines.push(`  ${c.file}:${c.line}  ${c.snippet}`);
  } else {
    lines.push(`known-sample ${KNOWN_SAMPLE}: 0 hits — 判谓词写错，⛔ 不判「无此类引用」`);
  }
  return lines.join("\n");
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }
  const root = path.resolve(parseArg(argv, "--root") ?? DEFAULT_ROOT);
  const json = argv.includes("--json");
  const mode = argv.includes("--check") ? "check" : argv.includes("--dead-set") ? "dead-set" : "scan";

  if (mode === "scan") {
    const result = scanBareFilenameRefs(root);
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(printScan(result) + "\n");
    return 0;
  }

  if (mode === "dead-set") {
    const scan = scanBareFilenameRefs(root);
    const bareRefs = scan.refs;
    const extraRefs = scan.extraRefs;
    const now = new Date();
    const until = parseArg(argv, "--until") ?? now.toISOString();
    const since = parseArg(argv, "--since") ?? new Date(now.getTime() - 72 * 3600000).toISOString();
    const sessionsDir = path.resolve(
      parseArg(argv, "--sessions-dir") ?? path.join(os.homedir(), ".claude", "projects", "-home-yale-work-quay"),
    );
    const result = recomputeDeadSet(root, sessionsDir, since, until, bareRefs, extraRefs);
    if (!json) {
      const extractedNames = result.extractedByBareFilenameScan.map((e) => e.script);
      process.stdout.write(
        `dead-set recompute: before=${result.before.deadCount} → after=${result.after.deadCount} ` +
        `(extracted ${extractedNames.length}: ${extractedNames.join(", ") || "∅"})\n` +
        `window ${result.window.since} → ${result.window.until} (${result.window.hours}h); universe ${result.universe}\n`,
      );
    }
    const writePath = path.resolve(parseArg(argv, "--write") ?? path.join(root, DEAD_SET_RESULT_REL));
    fs.mkdirSync(path.dirname(writePath), { recursive: true });
    fs.writeFileSync(writePath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`wrote ${path.relative(root, writePath)}\n`);
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  // --check：套件门（生产调用点）。canary + 死集一致性。
  const result = scanBareFilenameRefs(root);
  const sample = result.refs.find((r) => r.script === KNOWN_SAMPLE);
  const resultPath = path.join(root, DEAD_SET_RESULT_REL);
  if (!sample) {
    process.stderr.write(
      `RED: known-sample ${KNOWN_SAMPLE} not found by scan (carrier ${KNOWN_SAMPLE_CARRIER} drifted or scanner broken)\n`,
    );
    return 1;
  }
  const fromKnownCarrier = sample.carriers.some((c) => c.file === KNOWN_SAMPLE_CARRIER);
  if (!fromKnownCarrier) {
    process.stderr.write(
      `RED: ${KNOWN_SAMPLE} referenced but not by ${KNOWN_SAMPLE_CARRIER} (sample carrier drifted)\n`,
    );
    return 1;
  }
  if (!fs.existsSync(resultPath)) {
    process.stderr.write(`NOT-EVALUATED: ${DEAD_SET_RESULT_REL} absent (dead-set not yet recomputed)\n`);
    return 3;
  }
  let deadSet: DeadSetRecompute;
  try {
    deadSet = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch {
    process.stderr.write(`NOT-EVALUATED: ${DEAD_SET_RESULT_REL} unparseable\n`);
    return 3;
  }
  const afterDead = new Set(deadSet.after?.dead ?? []);
  // AC1：四类样本全部命中——任一样本 0 命中 ⇒ 报红（谓词写错），⛔ 不得判「无此类引用」（硬规则 2）。
  // ⚠️ 2026-09-15 真机实测（GitHub CI 一个干净 checkout，非本仓长期存活的 checkout）：`.quay/config.yml`
  // 是 gitignored（永不进 git 树），任何全新 `git clone`（含 CI 的 actions/checkout@v4）结构上就没有
  // 这个文件——这与「文件在、但 collector 扫不到样本（predicate 真坏了）」是两个不同的态，此前共用同一条
  // `RED: ... predicate broken` 输出 ⇒ 把「读不到输入」判成了「输入不对」（硬规则 3b：缺值≠为假）。
  // 后果是本检查器在**每一个**从未手工 bootstrap 过 `.quay/config.yml` 的环境里（任何 CI 跑、任何第三方
  // 新 clone）恒红，而所有长期存活的本地 checkout 因为很久以前手工建过这个 gitignored 文件而恒绿 ⇒ 这一
  // 分支实际上从未在「真正干净的 checkout」这个唯一要紧的环境里被验证过。
  // 修法：样本自己声明的载体路径在磁盘上不存在时，报可区分的 NOT-EVALUATED（exit 3，与上面
  // `resultPath` 缺失同一处置），不当作「predicate broken」判 RED——载体真的在但样本扫不到，才是 RED。
  for (const s of EXTRA_KIND_SAMPLES) {
    const carrierAbsPath = path.join(root, s.carrier);
    if (!fs.existsSync(carrierAbsPath)) {
      process.stderr.write(
        `NOT-EVALUATED: ${s.kind} known-sample carrier ${s.carrier} absent from this checkout (e.g. gitignored, never bootstrapped here) — cannot exercise this collector, not a predicate failure\n`,
      );
      return 3;
    }
    const hit = result.extraRefs.find((r) => r.script === s.script && r.kind === s.kind && r.carrier.file === s.carrier);
    if (!hit) {
      process.stderr.write(
        `RED: ${s.kind} known-sample ${s.script} not found by collector (expected carrier ${s.carrier}; predicate broken, not "no such ref")\n`,
      );
      return 1;
    }
    process.stdout.write(
      `known-sample[${s.kind}] ${s.script} ← ${hit.carrier.file}:${hit.carrier.line}  ${hit.carrier.snippet}\n`,
    );
  }
  const violations = result.allReferencedScripts.filter((s) => afterDead.has(s));
  if (violations.length > 0) {
    process.stderr.write(`RED: referenced script(s) still in dead set: ${violations.join(", ")}\n`);
    return 1;
  }
  process.stdout.write(
    `PASS: bare-filename scan found ${result.refs.length} referenced script(s) + ${result.extraRefs.length} extra-kind ref(s); ` +
    `${KNOWN_SAMPLE} hits ${KNOWN_SAMPLE_CARRIER}; none in dead set (after=${deadSet.after?.deadCount})\n`,
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
