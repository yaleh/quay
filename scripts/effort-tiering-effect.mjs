#!/usr/bin/env node
// effort-tiering-effect.mjs — role 层 effort 降档（high→low）的实际效果对照读数。
//
// 只读、可复跑。测量 `gap-role-effort-tiering-selector-pool-judge-meta-driver`（2026-11-01 落地）
// 把 selector / pool-judge / meta-driver 三个 role 的 effort 从 high 降到 low 之后，生产会话里
// 实际的 token 与延迟有没有变化。⛔ 不改任何配置，不改 profiles.yml；只读真实会话遥测，缺失即
// not-evaluated（缺值 = 未查，不与 0/成功共用取值——硬规则 3b）。
//
// 数据来源（全部只读）：
//   <sessions-dir>/*.jsonl    Claude Code 会话（顶层 jsonl，与 E1 同源）。每个会话按【首条 user 消息】
//                             归类到 selector / pool-judge / meta-driver / other；再从 assistant 记录的
//                             顶层 `effort` 字段与 `message.usage` 聚合 fresh / cache_read / output / msgs。
//
// 会话分桶（AC1）：
//   · high / low   —— 会话内所有带 `effort` 字段的 assistant 记录取值【唯一】且为 high / low，
//                     且该会话至少有一条带 `usage` 的 metered assistant 记录。参与聚合。
//   · not-evaluated —— 会话缺 `effort` 字段（任何 assistant 记录都没有），或缺 `usage`（没有任何
//                     metered assistant 记录），或有 assistant 但 0 条可计量。单列计数，不并入 high/low。
//   · mixed        —— 同一会话内出现 ≥2 个不同 `effort` 取值（如同时有 high 与 low）。单列，不并入任一侧。
//
// 指标口径（全部 per-session 比值，再取分位数/均值）：
//   · msgs         = 该会话中带 `message.usage` 且 input/output tokens 均为数字的 assistant 记录数。
//   · output/msg   = Σ output_tokens / msgs
//   · fresh/msg    = Σ input_tokens / msgs（input_tokens 本身即 fresh；cache_* 是额外缓存侧读数，不含在 input_tokens 内）
//   · cache_read/msg = Σ cache_read_input_tokens / msgs
//   · 会话时长      = 会话内所有带 timestamp 记录的最晚 − 最早 timestamp。
//
// 样本是否足够：任一侧（high 或 low）n < 20 即标为「不足」（n 为会话数）。不足的角色不宣称收益/损失。
//
// 输出：默认 markdown（含对照表 + 结论，可直接落盘 docs/analysis/…）；--json 输出机器可核 JSON。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_SESSIONS_DIR = join(homedir(), ".claude", "projects", "-data-home-yale-work-quay");
const ROLES = ["selector", "pool-judge", "meta-driver"];
const MIN_N = 20; // 任一侧 n < 20 ⇒ 样本不足

const HELP = `effort-tiering-effect — role 层 effort 降档（high→low）效果对照读数

usage: node scripts/effort-tiering-effect.mjs [flags]

只读报告：按【首条 user 消息】给会话归类 selector / pool-judge / meta-driver / other，
从 assistant 记录的 effort 字段与 message.usage 聚合 fresh / cache_read / output / msgs，
按 role × effort 输出分位数（p50/p90/均值）与样本数 n。

flags:
  --sessions-dir <dir>  Claude Code 会话目录。缺省 ${DEFAULT_SESSIONS_DIR}
  --root <dir>          主检出根（仅用于记录 git HEAD 指纹）。缺省：从本脚本位置解析。
  --json                输出 JSON（机器可核）。
  --help                本帮助，exit 0。

输入 schema（会话 jsonl 记录）：
  · 首条 type=user 记录：message.content（string 或 [{text}]）用于 role 分类。
  · assistant 记录：顶层 effort 字段（string），message.usage 含 input_tokens /
    output_tokens / cache_creation_input_tokens / cache_read_input_tokens。

role 分类规则（首条 user 消息正文，子串匹配）：
  · selector   —— 含 "You are the resident task selector for the quay worker driver"
  · pool-judge —— 含 "You are the pool-quality gate for the quay task pool"
                  或含 "You are the architecture-review judge for the quay repo"
  · meta-driver—— 含 "You are the meta-driver:"
  · other      —— 以上都不匹配，或没有 user 记录。

缺失语义（独立取值，⛔ 不与 high/low 共用）：
  · not-evaluated —— 会话缺 effort 字段或缺 usage（无法评估）。单列计数，不参与聚合。
  · mixed         —— 同一会话内 effort 取值混用（≥2 个不同值）。单列，不并入任一侧。

样本是否足够：n = 会话数；任一侧 n < ${MIN_N} 标为「不足」，结论不得据此宣称收益或损失。
`;

// ── 小工具 ───────────────────────────────────────────────────────────────────
function readFileSafe(p) {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}
function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function parseIso(s) {
  if (s == null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function median(sorted) {
  if (sorted.length === 0) return null;
  if (sorted.length % 2 === 1) return sorted[Math.floor(sorted.length / 2)];
  const a = sorted[sorted.length / 2 - 1], b = sorted[sorted.length / 2];
  return (a + b) / 2;
}
function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function mean(sorted) {
  if (sorted.length === 0) return null;
  return sorted.reduce((s, v) => s + v, 0) / sorted.length;
}
function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }
function round3(x) { return x == null ? null : Math.round(x * 1000) / 1000; }
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
function fmtMin(ms) {
  if (ms == null) return "not-evaluated";
  return `${(ms / 60000).toFixed(1)} min`;
}

// 解析主检出根：worktree 的 git common dir = <主检出>/.git。
function resolveMainCheckout() {
  const here = dirname(new URL(import.meta.url).pathname);
  const r = spawnSync("git", ["-C", here, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) {
    const cd = resolve(here, r.stdout.trim());
    if (basename(cd) === ".git") return dirname(cd);
    return cd;
  }
  const t = spawnSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (t.status === 0 && t.stdout.trim()) return t.stdout.trim();
  return process.cwd();
}

// ── 参数解析 ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { sessionsDir: null, root: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--json") args.json = true;
    else if (a === "--sessions-dir") { args.sessionsDir = argv[++i] ?? null; }
    else if (a === "--root") { args.root = argv[++i] ?? null; }
  }
  return args;
}

// ── role 分类与首条 user 消息 ──────────────────────────────────────────────
function contentToText(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => (x && typeof x.text === "string" ? x.text : "")).join("");
  return "";
}
function firstUserContentText(records) {
  for (const o of records) {
    if (o && o.type === "user") return contentToText(o.message?.content);
  }
  return null;
}
function classifyRole(text) {
  if (!text) return "other";
  if (text.includes("You are the resident task selector for the quay worker driver")) return "selector";
  if (text.includes("You are the pool-quality gate for the quay task pool")) return "pool-judge";
  if (text.includes("You are the architecture-review judge for the quay repo")) return "pool-judge";
  if (text.includes("You are the meta-driver:")) return "meta-driver";
  return "other";
}

// 从 assistant 记录的 message.usage 取可计量 token；缺 input/output 之一 ⇒ null（不可计量）。
// ⚠️ 语义（按 Claude Code 记录的 message.usage 实测）：`input_tokens` 本身即【非缓存的 fresh input】，
//    cache_read_input_tokens / cache_creation_input_tokens 是【额外】的缓存侧读数，不包含在 input_tokens 里
//    （实测：同一条消息 input_tokens=2164 且 cache_read_input_tokens=74112——若 input_tokens 含缓存则应 ≥74112）。
//    因此 fresh = input_tokens（不再 input − cache_*；那样会得到负数）。
function usageTokens(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  if (input == null || output == null) return null;
  const cacheRead = num(usage.cache_read_input_tokens) ?? 0;
  const cacheCreation = num(usage.cache_creation_input_tokens) ?? 0;
  const fresh = input;
  return { input, output, cacheRead, cacheCreation, fresh };
}

// 解析单个会话（records = 已解析的 jsonl 对象数组）。返回该会话的分桶与聚合。
function analyzeSessionRecords(records) {
  const firstUser = firstUserContentText(records);
  const role = classifyRole(firstUser);

  let minTs = null, maxTs = null;
  const assistants = [];
  for (const o of records) {
    if (o == null) continue;
    const t = parseIso(o.timestamp);
    if (t != null) {
      if (minTs == null || t < minTs) minTs = t;
      if (maxTs == null || t > maxTs) maxTs = t;
    }
    if (o.type === "assistant") assistants.push(o);
  }

  const durationMs = (minTs != null && maxTs != null) ? (maxTs - minTs) : null;

  const distinctEfforts = new Set();
  let hasEffort = false, hasUsage = false;
  let msgs = 0, output = 0, cacheRead = 0, fresh = 0;
  for (const a of assistants) {
    const e = a.effort;
    if (e != null && String(e).trim() !== "") {
      hasEffort = true;
      distinctEfforts.add(String(e).trim());
    }
    const t = usageTokens(a.message?.usage);
    if (t) {
      hasUsage = true;
      msgs += 1;
      output += t.output;
      cacheRead += t.cacheRead;
      fresh += t.fresh;
    }
  }

  let bucket;
  if (!hasEffort || !hasUsage || msgs === 0) bucket = "not-evaluated";
  else if (distinctEfforts.size > 1) bucket = "mixed";
  else bucket = [...distinctEfforts][0];

  return {
    role, bucket, msgs, output, cacheRead, fresh, durationMs,
    distinctEfforts: [...distinctEfforts].sort(), hasEffort, hasUsage, firstUser,
  };
}

// 会话级比值（per-msg），供分位数/均值使用。
function sessionRatios(s) {
  if (s.msgs === 0) return null;
  return {
    outputPerMsg: s.output / s.msgs,
    freshPerMsg: s.fresh / s.msgs,
    cacheReadPerMsg: s.cacheRead / s.msgs,
  };
}

// 一组会话的统计（n、各指标 p50/p90/mean、时长 p50/p90）。
function cellStats(sessions) {
  const n = sessions.length;
  const outP = [], freshP = [], cacheP = [], dur = [];
  for (const s of sessions) {
    const r = sessionRatios(s);
    if (r) { outP.push(r.outputPerMsg); freshP.push(r.freshPerMsg); cacheP.push(r.cacheReadPerMsg); }
    if (s.durationMs != null) dur.push(s.durationMs);
  }
  outP.sort((a, b) => a - b); freshP.sort((a, b) => a - b); cacheP.sort((a, b) => a - b); dur.sort((a, b) => a - b);
  return {
    n,
    outputPerMsg: { p50: median(outP), p90: pct(outP, 90), mean: mean(outP) },
    freshPerMsg: { p50: median(freshP), p90: pct(freshP, 90), mean: mean(freshP) },
    cacheReadPerMsg: { p50: median(cacheP), p90: pct(cacheP, 90), mean: mean(cacheP) },
    durationMs: { p50: median(dur), p90: pct(dur, 90), measurable: dur.length },
  };
}

// 按 role × bucket 聚合（analyses = analyzeSessionRecords 结果数组）。
function aggregate(analyses) {
  const byRole = {};
  for (const role of ROLES) byRole[role] = { high: [], low: [], mixed: [], "not-evaluated": [] };
  byRole.other = { high: [], low: [], mixed: [], "not-evaluated": [] };

  for (const a of analyses) {
    const m = byRole[a.role] ?? byRole.other;
    // 非 high/low 的标准桶全部落 not-evaluated（未知取值不冒充 high/low）。
    if (a.bucket === "high" || a.bucket === "low" || a.bucket === "mixed") m[a.bucket].push(a);
    else m["not-evaluated"].push(a);
  }

  const out = {};
  for (const [role, buckets] of Object.entries(byRole)) {
    const cell = {};
    for (const [b, sessions] of Object.entries(buckets)) {
      if (b === "high" || b === "low" || b === "mixed") cell[b] = cellStats(sessions);
      else cell[b] = { n: sessions.length };
    }
    out[role] = cell;
  }
  return out;
}

// 任一侧样本不足的判定：role 的 high 与 low 任一侧 n < MIN_N ⇒ 不足。
function roleSufficiency(cell) {
  const highN = cell.high?.n ?? 0;
  const lowN = cell.low?.n ?? 0;
  const sufficient = highN >= MIN_N && lowN >= MIN_N;
  return { highN, lowN, sufficient };
}

// ── 结论（机械三选一，与读数一致）──────────────────────────────────────────
// 依据：只有 high/low 双侧 n ≥ MIN_N 的 role 才参与「收益/损失」判断；不足的 role 不宣称。
//   · not-evaluated —— 没有任何 role 双侧样本足够（缺输入：每个 role 的 high 与 low 各 n ≥ MIN_N）。
//   · keep          —— 至少一个 role 双侧足够，且所有足够 role 都【未出现】明显回归
//                     （low 的 output/msg 均值 ≤ high × 1.2，且 low 时长 p50 ≤ high × 1.5）。
//   · revert        —— 至少一个足够 role 出现明显回归（low 的 output/msg 均值 > high × 1.2
//                     或 low 时长 p50 > high × 1.5）。
// ⛔ 这是对照读数的保守解读，不是统计检验；阈值仅作「明显」的保守界，报告正文如实标注。
function conclude(summary) {
  const sufficientRoles = [];
  const insufficientRoles = [];
  for (const role of ROLES) {
    const s = roleSufficiency(summary[role]);
    (s.sufficient ? sufficientRoles : insufficientRoles).push(role);
  }
  if (sufficientRoles.length === 0) {
    return {
      verdict: "not-evaluated",
      reason: "没有任何 role 的 high 与 low 双侧样本都 ≥ " + MIN_N
        + "（" + insufficientRoles.join("/") + " 至少一侧不足），缺输入：更多生产会话样本。",
      missingInput: "每个 role 的 high 与 low 各 n ≥ " + MIN_N + " 的生产会话。",
      retestCondition: "降档后继续累积 low 侧会话，待每个 role 的 low 侧 n ≥ " + MIN_N + " 后重跑本工具即可。",
    };
  }
  let regression = false;
  const regressions = [];
  for (const role of sufficientRoles) {
    const c = summary[role];
    const outHigh = c.high.outputPerMsg.mean, outLow = c.low.outputPerMsg.mean;
    const durHigh = c.high.durationMs.p50, durLow = c.low.durationMs.p50;
    const outUp = outHigh != null && outLow != null && outLow > outHigh * 1.2;
    const durUp = durHigh != null && durLow != null && durLow > durHigh * 1.5;
    if (outUp || durUp) { regression = true; regressions.push(role + (outUp ? "(output↑)" : "(时长↑)")); }
  }
  if (regression) {
    return {
      verdict: "revert",
      reason: "至少一个双侧样本足够的 role 出现明显回归：" + regressions.join(", ")
        + "（output/msg 均值 > high×1.2 或 时长 p50 > high×1.5）。恢复动作另立案执行。",
      missingInput: null,
      retestCondition: null,
    };
  }
  return {
    verdict: "keep",
    reason: "双侧样本足够的 role（" + sufficientRoles.join("/") + "）未出现明显回归（output/msg 均值 ≤ high×1.2 且时长 p50 ≤ high×1.5）"
      + (insufficientRoles.length ? "；" + insufficientRoles.join("/") + " 任一侧 n < " + MIN_N + "，样本不足、不宣称收益或损失" : "")
      + "。因此保留 low（不 revert）。⛔ 这是「未见明显伤害」而不是「已证明降档有效」——详见报告对照表。",
    missingInput: null,
    retestCondition: insufficientRoles.length
      ? "待 " + insufficientRoles.join("/") + " 的 low 侧 n ≥ " + MIN_N + " 后复测以确认。"
      : null,
  };
}

// ── 输入指纹 ───────────────────────────────────────────────────────────────
function fingerprint(src, sessionsScanned, sessionsMatched) {
  const codeSha = sha256(readFileSafe(new URL(import.meta.url).pathname) || "");
  const canon = JSON.stringify({ sessionsDir: src.sessionsDir, sessionsScanned, sessionsMatched });
  return { codeSha256Short: codeSha.slice(0, 12), inputSha256Short: sha256(canon).slice(0, 12) };
}

// ── 来源读取 ───────────────────────────────────────────────────────────────
function readSources(args) {
  const sessionsDir = args.sessionsDir || DEFAULT_SESSIONS_DIR;
  const root = args.root || resolveMainCheckout();
  return { sessionsDir, root, args };
}
function scanSessions(src) {
  const { sessionsDir } = src;
  const files = existsSync(sessionsDir)
    ? readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl")).sort()
    : [];
  const analyses = [];
  let noUser = 0, parseFail = 0;
  for (const f of files) {
    const text = readFileSafe(join(sessionsDir, f));
    if (text == null) continue;
    const records = [];
    let anyBad = false;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { records.push(JSON.parse(t)); } catch { anyBad = true; }
    }
    if (anyBad) parseFail++;
    const a = analyzeSessionRecords(records);
    if (a.firstUser == null) noUser++;
    a.sessionId = f.replace(/\.jsonl$/, "");
    analyses.push(a);
  }
  const matched = analyses.filter((a) => ROLES.includes(a.role));
  return { analyses, filesScanned: files.length, noUser, parseFail, matched: matched.length };
}

// ── 渲染 ───────────────────────────────────────────────────────────────────
function gitHead(root) {
  const r = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim().slice(0, 12) : "n/a";
}
function fmtCell(c) {
  if (c.n === 0) return "（无样本）";
  const d = c.durationMs;
  return `n=${c.n}；output/msg p50=${round1(c.outputPerMsg.p50)}（均值 ${round1(c.outputPerMsg.mean)}）；` +
    `fresh/msg p50=${round1(c.freshPerMsg.p50)}；cache_read/msg p50=${round1(c.cacheReadPerMsg.p50)}；` +
    `时长 p50=${fmtMin(d.p50)} / p90=${fmtMin(d.p90)}`;
}

function renderMarkdown(src, scan, summary, fp) {
  const L = [];
  const p = (...xs) => L.push(xs.join(""));
  const cmd = `node scripts/effort-tiering-effect.mjs --sessions-dir ${src.sessionsDir} --root ${src.root}`;
  const concl = conclude(summary);

  p("# effort 降档效果对照读数（role 层 high→low）\n");
  p("> 只读、可复跑。本文件由 `scripts/effort-tiering-effect.mjs` 生成。\n");
  p("> 测量对象：`gap-role-effort-tiering-selector-pool-judge-meta-driver`（2026-11-01 落地）把\n");
  p("> selector / pool-judge / meta-driver 三个 role 的 effort 从 high 降到 low 之后的生产会话。\n");
  p("\n## 复跑命令（一条）\n");
  p("```bash\n", cmd, "\n```\n");
  p("\n代码/输入指纹：脚本 sha256=`", fp.codeSha256Short, "`，输入 sha256=`", fp.inputSha256Short,
    "`，git HEAD=`", gitHead(src.root), "`。\n");
  p("扫描：", String(scan.filesScanned), " 个会话文件；role 匹配（selector/pool-judge/meta-driver）",
    String(scan.matched), " 个；无 user 记录 ", String(scan.noUser), " 个；含坏行文件 ", String(scan.parseFail), " 个。\n");

  p("\n## 方法\n");
  p("- **role 分类**（首条 user 消息，子串匹配）：selector=`resident task selector`；pool-judge=`pool-quality gate for the quay task pool` 或 `architecture-review judge for the quay repo`；meta-driver=`You are the meta-driver:`；其余 = other。\n");
  p("- **effort 分桶**：会话内所有带 `effort` 字段的 assistant 记录取值唯一 ⇒ high/low；≥2 个不同取值 ⇒ `mixed`；缺 `effort` 字段或缺 `usage` ⇒ `not-evaluated`（独立取值，⛔ 不并入 high/low）。\n");
  p("- **指标**：`msgs` = 带 `message.usage` 且 input/output tokens 均为数字的 assistant 记录数；`output/msg` = Σoutput_tokens/msgs；`fresh/msg` = Σinput_tokens/msgs（`input_tokens` 本身即非缓存 fresh input）；`cache_read/msg` = Σcache_read_input_tokens/msgs；会话时长 = 会话内最晚−最早 timestamp。\n");
  p("- **样本是否足够**：n = 会话数；任一侧（high 或 low）n < ", String(MIN_N), " 标为不足。\n");
  p("- ⛔ `output_tokens` 字段未必包含推理（thinking）token——若推理 token 不在其中，本对照会**低估**降档对推理侧的影响；这是字段局限，不是测量失败。\n");

  p("\n## 对照读数\n");
  for (const role of ROLES) {
    const c = summary[role];
    const suf = roleSufficiency(c);
    p("\n### ", role, "\n");
    p("| effort | 读数 |\n|---|---|\n");
    p("| high | ", fmtCell(c.high), " |\n");
    p("| low  | ", fmtCell(c.low), " |\n");
    p("\n- mixed：n=", String(c.mixed.n), "；not-evaluated：n=", String(c["not-evaluated"].n), "。\n");
    p("- 样本是否足够：high n=", String(suf.highN), "，low n=", String(suf.lowN), " ⇒ ",
      suf.sufficient ? "**足够**（双侧 n ≥ " + MIN_N + "）" : "**不足**（任一侧 n < " + MIN_N + "，不宣称收益或损失）", "。\n");
  }

  p("\n## 方向一览（high → low，均值/中位）\n");
  p("| role | output/msg（均值） | fresh/msg（p50） | 时长（p50） | 样本是否足够 |\n|---|---|---|---|---|\n");
  for (const role of ROLES) {
    const c = summary[role];
    const suf = roleSufficiency(c);
    const o = (h, l) => (h != null && l != null ? `${round1(h)} → ${round1(l)}（${((l - h) / h * 100).toFixed(0)}%）` : "not-evaluated");
    const fmtDur = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(2)}min`);
    const d = (h, l) => (h != null && l != null ? `${fmtDur(h)} → ${fmtDur(l)}（${((l - h) / h * 100).toFixed(0)}%）` : "not-evaluated");
    p("| ", role, " | ", o(c.high.outputPerMsg.mean, c.low.outputPerMsg.mean), " | ",
      o(c.high.freshPerMsg.p50, c.low.freshPerMsg.p50), " | ",
      d(c.high.durationMs.p50, c.low.durationMs.p50), " | ",
      suf.sufficient ? "足够" : "**不足**", " |\n");
  }

  p("\n## 结论\n");
  p("**三选一：`", concl.verdict, "`**\n");
  p("- 理由：", concl.reason, "\n");
  if (concl.missingInput) p("- 所缺输入：", concl.missingInput, "\n");
  if (concl.retestCondition) p("- 可重测条件：", concl.retestCondition, "\n");
  p("\n> 判词口径：只有 high 与 low 双侧 n ≥ ", String(MIN_N), " 的 role 才参与收益/损失判断；",
    "「明显回归」的保守界为 output/msg 均值 > high×1.2 或 时长 p50 > high×1.5。",
    "这**不是统计检验**，只是对照读数的保守解读。",
    "⛔ `keep` 是「未见明显伤害、不 revert」，不是「已证明降档有效」。\n");

  return L.join("");
}

function renderJson(src, scan, summary, fp) {
  return JSON.stringify({
    sessionsDir: src.sessionsDir,
    root: src.root,
    fingerprint: { ...fp, gitHead: gitHead(src.root) },
    scan: { filesScanned: scan.filesScanned, matchedRoles: scan.matched, noUser: scan.noUser, parseFailFiles: scan.parseFail },
    minN: MIN_N,
    roles: summary,
    sufficiency: Object.fromEntries(ROLES.map((r) => [r, roleSufficiency(summary[r])])),
    conclusion: conclude(summary),
  }, null, 2);
}

// ── main ────────────────────────────────────────────────────────────────────
function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }
  const src = readSources(args);
  const scan = scanSessions(src);
  const summary = aggregate(scan.analyses);
  const fp = fingerprint(src, scan.filesScanned, scan.matched);
  if (args.json) process.stdout.write(renderJson(src, scan, summary, fp) + "\n");
  else process.stdout.write(renderMarkdown(src, scan, summary, fp));
  return 0;
}

// 直接执行时跑 main；被 import（单测）时只导出函数，不执行。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));

export {
  parseArgs, classifyRole, contentToText, firstUserContentText, usageTokens,
  analyzeSessionRecords, sessionRatios, cellStats, aggregate, roleSufficiency, conclude,
  readSources, scanSessions, renderMarkdown, renderJson, DEFAULT_SESSIONS_DIR, MIN_N, ROLES,
};
