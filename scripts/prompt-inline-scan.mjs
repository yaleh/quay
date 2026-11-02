#!/usr/bin/env node
// prompt-inline-scan.mjs — read-only scan of prompt-assembly points in plugin/scripts/**.
//
// 只读、可复跑、不改任何 prompt 内容。回答「还有别处也把数据整段内联进 prompt 吗」——
// 按【机制】（组装点是否插值大结构）而不是按【体积】判定。体积大 ≠ 内联数据：固定指令
// 逐字在场是必要的，只有「数据结构整段内联、本该落盘给路径指针」这一类才是可改项。
//
// 判定是枚举不是布尔（硬规则 3）：每个组装点落在互斥的 5 类之一：
//   inline-data   插值了大结构（JSON.stringify(…) 进模板/join，或 .map(…).join(…) 渲染集合）
//   fixed-prose   只拼静态文本 + 标量插值（task/root/objective/name 这类逐字必要的量）
//   pointer       落盘 + 路径指针（prompt 只带 file: 路径，不内联数据体）
//   not-a-prompt  命中了 prompt 关键词但实际不是 prompt（日志/响应/度量）
//   not-evaluated 读不懂/无法解析——独立取值，⛔ 不与「干净/fixed-prose」共用输出（硬规则 3b）
//
// 枚举来源（三条，都按位置判定，注释/字符串正文里提到不算命中）：
//   ① 名字含 prompt/brief/readings/preamble/objective/instructions 的函数声明，且函数体
//     含一个「字符串组装标记」（模板串 / .join( / JSON.stringify(）——纯度量/读取类同名
//     函数（computePromptToCodeRatio、afterPromptContent…）因无组装标记不进入候选。
//   ② 把字符串直接喂给 spawn/stdin 的行（stdinData:/stdin.write/…）且该行内联了组装
//     （含模板串或 JSON.stringify 或 ${…}）。
//   ③ prompt 名命中的模板字面量赋值（`const prompt = \`…\${data}…\`` / `…Template = …`）。
//
// inline-data 的第三信号是「数据变量名」启发式（${evidencePack}/${plan}/… 判 inline-data，
// ${task}/${root}/${objective}/… 判 fixed-prose）——边界写在 DATA_NAME_SET，误报由报告逐条人工复核。
//
// 输出：默认 markdown 报告（可直接落盘 docs/analysis/），--json 输出机器可核 JSON。
//       --classify-stdin 读一段代码并按 classifySnippet 判定（AC2 的已知真样本干跑）。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// ── 常量 ─────────────────────────────────────────────────────────────────────
const CLASS_KINDS = ["inline-data", "fixed-prose", "pointer", "not-a-prompt", "not-evaluated"];

const HELP = `prompt-inline-scan — read-only prompt-assembly scan of plugin/scripts/**

usage: node scripts/prompt-inline-scan.mjs [flags]

只读扫描：枚举 prompt 组装点并按【机制】分类，不改任何 prompt 内容。分类互斥五值。

flags:
  --root <dir>        主检出根（plugin/scripts 的上级）。缺省：从本脚本位置解析 git 顶层。
  --plugin-dir <dir>  被扫目录。缺省 <root>/plugin/scripts。
  --json              输出机器可核 JSON（AC3 计数与命中清单）。
  --classify-stdin    读 stdin 作为一段代码，用 classifySnippet 判定并打印 JSON，exit 0。
                      （AC2：把 git 历史中改造前的 buildProbePrompt 干跑一遍。）
  --help              本帮助，exit 0。

分类规则（classifySnippet，顺序命中，先到先得）：
  stripComments 只去注释（保留字符串与模板串——插值标记住在模板串里，不能按字符串剥掉）。
  1. not-a-prompt  代码含 console.log/error、process.stdout/stderr、res.end(、{ ok: 的
                    JSON 响应且无模板串 ⇒ 不是 prompt。
  2. pointer       含写盘标记（writeFileSync/writeJsonAtomic/appendFileSync/writeOwnedFile/
                   writeFile/fs.writeFile）且含路径指针（file:/path.join/on disk/readings file）
                   且无 JSON.stringify 进模板/join 的插值 ⇒ 落盘+路径。
  3. inline-data   JSON.stringify( 且（模板串或 .join(）⇒ 插值大结构；
                   或 .map(…).join(…) 渲染集合 ⇒ 插值大结构；
                   或模板串插值「数据变量名」（\${evidencePack}/\${plan}/…，见 DATA_NAME_SET）。
  4. fixed-prose   含组装标记（模板串/join/引号字面量）但无上述任何数据插值 ⇒ 只拼静态文本。
  5. not-evaluated 其余（无组装形状/读不懂）——独立取值，不与「干净」共用输出。
`;

// ── 注释剥离（位置保持：注释替换成等长空格，行号不变；字符串/模板串原样保留）──────────
export function stripComments(code) {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const nc = code[i + 1];
    // 字符串字面量：复制整段（模板串/引号内可能是插值标记，不能剥）。
    if (c === '"' || c === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === c) { i++; break; }
        i++;
      }
      out += code.slice(start, i);
      continue;
    }
    if (c === "`") {
      const start = i;
      i++;
      while (i < n) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === "`") { i++; break; }
        i++;
      }
      out += code.slice(start, i);
      continue;
    }
    // 行注释
    if (c === "/" && nc === "/") {
      while (i < n && code[i] !== "\n") { out += " "; i++; }
      continue;
    }
    // 块注释
    if (c === "/" && nc === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        out += code[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ── 组装标记 ────────────────────────────────────────────────────────────────
const HAS_TEMPLATE = (s) => s.includes("`");
const HAS_JOIN = (s) => /\.join\s*\(/.test(s);
const HAS_JSON_STRINGIFY = (s) => /JSON\.stringify\s*\(/.test(s);
const HAS_MAP_JOIN = (s) => /\.map\s*\([\s\S]*?\)\s*\.join\s*\(/.test(s);
const HAS_WRITE = (s) => /(writeFileSync|writeJsonAtomic|appendFileSync|writeOwnedFile|writeFile|fs\.writeFile)/.test(s);
const HAS_PATH_PTR = (s) => /(file:\s|path\.join|on disk|readings file|\.json`|\.md`|\.json'|\.md')/.test(s);
const HAS_INTERP = (s) => /\$\{/.test(s);
const HAS_LITERAL = (s) => /["'`]/.test(s);
const NOT_PROMPT = (s) => /(console\.(log|error)|process\.(stdout|stderr)|res\.end\s*\(|\{\s*ok\s*:)/.test(s);

// 数据变量名（模板串里 `${dataVar}` 的根标识符——本仓库 prompt 组装点里明确表示「渲染出的数据集」，
// ⛔ 不含标量/路径/散文：task/root/name/objective/summary/prior/digest/scope/readingsPath/basePrompt…）。
// 这是启发式（按位置判定里「位置」= 变量名类型），README/报告会写明其边界；误报由人工逐条复核兜底。
const DATA_NAME_SET = new Set([
  "evidencePack", "evidenceIndex", "evidence", "findings", "facts", "records", "snapshot",
  "clusters", "candidates", "broad", "drift", "conclusions", "priorFindings", "pool",
  "readings", "payload", "plan", "tasks", "selection", "inventory", "lookup",
  "acLines", "exitText", "scopeLines",
]);
function hasDataInterp(code) {
  const re = /\$\{\s*([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(code)) !== null) if (DATA_NAME_SET.has(m[1])) return true;
  return false;
}

/** classifySnippet —— 对一段【单个组装点】的代码判类。枚举式输出：kind + 命中信号。 */
export function classifySnippet(code) {
  const src = typeof code === "string" ? code : String(code ?? "");
  const codeOnly = stripComments(src);
  const c = codeOnly.trim();
  const hasTemplate = HAS_TEMPLATE(c);
  const hasJoin = HAS_JOIN(c);
  const hasJson = HAS_JSON_STRINGIFY(c);
  const hasMapJoin = HAS_MAP_JOIN(c);
  const hasWrite = HAS_WRITE(c);
  const hasPathPtr = HAS_PATH_PTR(c);
  const hasInterp = HAS_INTERP(c);
  const hasLiteral = HAS_LITERAL(c);

  const signals = {
    template: hasTemplate,
    join: hasJoin,
    jsonStringify: hasJson,
    mapJoin: hasMapJoin,
    writeMarker: hasWrite,
    pathPointer: hasPathPtr,
    interpolation: hasInterp,
    literal: hasLiteral,
  };

  // 1. 无任何组装形状 ⇒ 读不懂，独立取值（⛔ 不与 fixed-prose/干净共用输出）。
  if (!hasTemplate && !hasJoin && !hasJson && !hasLiteral) {
    return { kind: "not-evaluated", reason: "no prompt-assembly shape (no template/join/string literal/JSON.stringify)", signals };
  }

  // 2. 明确不是 prompt 的输出（日志/响应/度量）——NOT_PROMPT 标记（console.log/process.stdout/
  //    res.end/{ok:）且无模板串（真 prompt 用模板/join 拼 prose；日志/响应直接 JSON.stringify）。
  if (NOT_PROMPT(c) && !hasTemplate) {
    return { kind: "not-a-prompt", reason: "sink/log/response output, not a model prompt", signals };
  }

  // 3. 落盘 + 路径指针（数据写盘、prompt 只带 file: 路径）——先于 inline-data 判，因为
  //    同一函数体里可能有 writeJsonAtomic 而没有 JSON.stringify 进模板。
  if (hasWrite && hasPathPtr && !(hasJson && (hasTemplate || hasJoin)) && !hasMapJoin) {
    return { kind: "pointer", reason: "writes data to disk and carries a path pointer in the prompt", signals };
  }

  // 4. 插值大结构：JSON.stringify(…) 进模板/join，或 .map(…).join(…) 渲染集合，
  //    或模板串里插值了一个「数据变量名」（渲染好的数据集被整段塞进 prompt）。
  if ((hasJson && (hasTemplate || hasJoin)) || hasMapJoin || (hasTemplate && hasInterp && hasDataInterp(c))) {
    const reason = hasMapJoin ? ".map(…).join(…) renders a collection inline"
      : (hasJson ? "JSON.stringify(…) interpolated into the prompt"
        : "template interpolates a rendered data variable (data-name heuristic)");
    return { kind: "inline-data", reason, signals };
  }

  // 5. 只拼静态文本 + 标量插值 ⇒ fixed-prose。
  if (hasTemplate || hasJoin || hasLiteral) {
    return { kind: "fixed-prose", reason: "only static prose + scalar interpolation (no data structure inlined)", signals };
  }

  // 6. 其余读不懂。
  return { kind: "not-evaluated", reason: "assembly shape recognized but classification unresolved", signals };
}

// ── 枚举：prompt 组装函数 + 内联 sink 行 ───────────────────────────────────
const PROMPT_NAME_RE = /(prompt|brief|readings|preamble|objective|instructions)/i;
const FN_DECL_RE = /(?:export\s+)?(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([\s\S]*?\)\s*=>)/;
const SINK_RE = /(stdinData\s*:|stdin\s*[.?]?\s*write\s*\(|stdin\s*[.?]?\s*end\s*\(|stdin\s*[.?]?\s*write\s*\(|launchArgv\s*\()/;

/** 声明行是否为函数形 const（`const NAME = (` / `= async (` / `= (…) =>`），避免把 `const NAME = <标量>` 当函数。 */
function isConstFnDecl(line) {
  return /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\(/.test(line) || /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\([^)]*\)\s*=>/.test(line);
}

/** 跳过字符串/模板串/注释；返回下一个未跳过的字符下标。 */
function skipLiteralOrComment(text, i) {
  const n = text.length;
  const ch = text[i];
  if (ch === '"' || ch === "'" || ch === "`") {
    const quote = ch;
    i++;
    while (i < n) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === quote) { i++; break; }
      i++;
    }
    return i;
  }
  if (ch === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; return i; }
  if (ch === "/" && text[i + 1] === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; return i < n ? i + 2 : n; }
  return i;
}

/** 从 openOffset 处的开括号匹配到闭括号之后的下标（字符串/模板/注释感知）。找不到返回 -1。 */
function matchDelim(text, openOffset, openCh, closeCh) {
  let depth = 0;
  const n = text.length;
  for (let i = openOffset; i < n; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`" || (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*"))) {
      i = skipLiteralOrComment(text, i) - 1;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** 从 from 起（字符串/模板/注释感知）找第一个 ch 的下标。找不到返回 -1。 */
function findNextChar(text, from, ch) {
  const n = text.length;
  for (let i = from; i < n; i++) {
    const c = text[i];
    if (c === ch) return i;
    if (c === '"' || c === "'" || c === "`" || (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*"))) {
      i = skipLiteralOrComment(text, i) - 1;
    }
  }
  return -1;
}

/** 在文本中找出函数声明名命中的函数体区间（返回 {name, declLine, endLine}，1-based）。
 *  函数体 = 参数表闭括号之后的第一个 `{`（参数表内的对象类型 `{…}` 由括号匹配天然跳过）。 */
function findFunctionRanges(content) {
  const lines = content.split("\n");
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = /(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    const cm = fm ? null : /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    const name = fm ? fm[1] : (cm ? cm[1] : null);
    if (!name || !PROMPT_NAME_RE.test(name)) continue;
    if (!fm && !isConstFnDecl(line)) continue;

    const rest = lines.slice(i).join("\n");
    // 参数表开括号：function NAME( 的 `(`，或 const NAME = 之后的第一个 `(`。
    let openParen;
    if (fm) {
      openParen = rest.indexOf("(", rest.indexOf("function"));
    } else {
      const eq = rest.indexOf("=");
      openParen = findNextChar(rest, eq, "(");
    }
    if (openParen < 0) continue;
    const parenClose = matchDelim(rest, openParen, "(", ")");
    if (parenClose < 0) continue;
    // 函数声明的 body `{` 紧跟参数表 `)`（跳过 `: 返回类型`）；const 箭头的 `{` 在 `=>` 之后。
    // ⛔ 只对 const/箭头在签名区找 `=>`——`function NAME` 的 body 里可能到处都是箭头函数，
    //    若在整段 body 里搜 `=>` 会把「body 深处第一个箭头函数」误当签名箭头。
    const arrowRel = fm ? -1 : rest.indexOf("=>", parenClose);
    const bodyOpen = findNextChar(rest, arrowRel > 0 ? arrowRel : parenClose, "{");
    if (bodyOpen < 0) continue;
    const bodyEnd = matchDelim(rest, bodyOpen, "{", "}");
    if (bodyEnd < 0) continue;
    const endLine = i + rest.slice(0, bodyEnd).split("\n").length;
    ranges.push({ name, declLine: i + 1, endLine });
  }
  return ranges;
}

/** 对一份源码做扫描：返回站点数组（按行号稳定排序）。 */
export function scanSource(file, content) {
  const sites = [];
  const lines = content.split("\n");
  const ranges = findFunctionRanges(content);

  // ① 命名 prompt 组装函数。
  for (const r of ranges) {
    const body = lines.slice(r.declLine - 1, r.endLine).join("\n");
    const codeOnly = stripComments(body);
    const isAssembly = HAS_TEMPLATE(codeOnly) || HAS_JOIN(codeOnly) || HAS_JSON_STRINGIFY(codeOnly);
    if (!isAssembly) continue; // 纯度量/读取类同名函数不进入候选
    const cls = classifySnippet(body);
    sites.push({ file, line: r.declLine, name: r.name, kind: cls.kind, reason: cls.reason, signals: cls.signals });
  }

  // ② 内联 sink 行（把组装直接喂给 spawn/stdin）。
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SINK_RE.test(line)) continue;
    const codeOnly = stripComments(line);
    if (!(HAS_TEMPLATE(codeOnly) || HAS_JSON_STRINGIFY(codeOnly) || HAS_INTERP(codeOnly))) continue;
    const cls = classifySnippet(line);
    // 只报有实际组装的行（transport-only 的 stdinData: payload.prompt 不进清单）。
    if (cls.kind === "not-a-prompt" && !HAS_JSON_STRINGIFY(codeOnly)) continue;
    sites.push({ file, line: i + 1, name: null, kind: cls.kind, reason: cls.reason, signals: cls.signals });
  }

  // ③ prompt 名命中的模板字面量赋值（`const prompt = \`…\${data}…\`` / `const fooTemplate = …`）——
  //    这类组装点不是函数、不在 ① 的枚举里，但它是把数据插进 prompt 的同一机制。
  const TEMPLATE_ASSIGN_RE = /(?:const|let|var)\s+(prompt|[A-Za-z_$][\w$]*(?:Prompt|Template|Preamble|Brief))\s*=\s*`/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!TEMPLATE_ASSIGN_RE.test(line)) continue;
    if (!HAS_INTERP(line)) continue; // 纯静态常量不是组装点
    const cls = classifySnippet(line);
    sites.push({ file, line: i + 1, name: (TEMPLATE_ASSIGN_RE.exec(line) || [])[1] ?? null, kind: cls.kind, reason: cls.reason, signals: cls.signals });
  }

  return sites;
}

/** 递归列出目录下所有 .ts/.mjs 文件（相对路径）。 */
function listScriptFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      const p = join(d, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|mjs)$/.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** 扫描整个 plugin 目录，聚合分类计数。 */
export function scanDir(pluginDir) {
  const sites = [];
  const files = listScriptFiles(pluginDir);
  for (const abs of files) {
    const rel = abs.slice(pluginDir.length + 1);
    let content;
    try { content = readFileSync(abs, "utf8"); } catch { continue; }
    sites.push(...scanSource(rel, content));
  }
  const counts = Object.fromEntries(CLASS_KINDS.map((k) => [k, 0]));
  for (const s of sites) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  return { filesScanned: files.length, sites, counts };
}

// ── 主检出根解析 ───────────────────────────────────────────────────────────
function resolveRoot() {
  const here = dirname(new URL(import.meta.url).pathname);
  const r = spawnSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return resolve(here, "..");
}

function parseArgs(argv) {
  const a = { root: null, pluginDir: null, json: false, classifyStdin: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--help" || x === "-h") a.help = true;
    else if (x === "--json") a.json = true;
    else if (x === "--classify-stdin") a.classifyStdin = true;
    else if (x === "--root") a.root = argv[++i];
    else if (x === "--plugin-dir") a.pluginDir = argv[++i];
  }
  return a;
}

function renderMarkdown(root, pluginDir, res) {
  const L = [];
  const p = (...xs) => L.push(xs.join(""));
  const gitHead = (() => {
    const r = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim().slice(0, 12) : "n/a";
  })();
  p("# prompt 组装点扫描（按机制，非按体积）\n\n");
  p("> 只读、可复跑。本文件由 `scripts/prompt-inline-scan.mjs` 生成；分类互斥五值：\n");
  p("> `inline-data` / `fixed-prose` / `pointer` / `not-a-prompt` / `not-evaluated`（缺值=未查，独立取值）。\n\n");
  p("## 复跑命令\n\n```bash\n");
  p("node scripts/prompt-inline-scan.mjs --root ", root, " --plugin-dir ", pluginDir, "\n");
  p("```\n\n");
  p("扫描对象：`", pluginDir, "`（", String(res.filesScanned), " 个 .ts/.mjs 文件）。git HEAD=`", gitHead, "`。\n\n");

  p("## 分类计数\n\n| 分类 | 计数 |\n|---|---|\n");
  for (const k of CLASS_KINDS) p("| ", k, " | ", String(res.counts[k]), " |\n");

  p("\n## 完整命中清单\n\n| file:line | 分类 | 组装点 | 判定理由 |\n|---|---|---|---|\n");
  for (const s of res.sites) {
    const loc = `${s.file}:${s.line}`;
    const name = s.name ?? "(inline sink)";
    p("| ", loc, " | ", s.kind, " | ", name, " | ", s.reason, " |\n");
  }
  p("\n> ⛔ 判定按位置（代码里的插值标记），注释/字符串正文里提到不算命中——扫描前先 stripComments。\n");
  return L.join("");
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }

  if (args.classifyStdin) {
    const code = readFileSync(0, "utf8");
    process.stdout.write(JSON.stringify({ kind: classifySnippet(code).kind, reason: classifySnippet(code).reason, signals: classifySnippet(code).signals }, null, 2) + "\n");
    return 0;
  }

  const root = args.root || resolveRoot();
  const pluginDir = args.pluginDir || join(root, "plugin", "scripts");
  const res = scanDir(pluginDir);
  if (args.json) process.stdout.write(JSON.stringify({ root, pluginDir, ...res }, null, 2) + "\n");
  else process.stdout.write(renderMarkdown(root, pluginDir, res));
  return 0;
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));

export { listScriptFiles };
