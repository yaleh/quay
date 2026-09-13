#!/usr/bin/env node
// suite-execution-form-counter.ts — 套件执行形态的机械计数器（重写版，tasks/gap-a19-evidence-field-does-not-match-measured-object）。
//
// ⚠️ A19 重写（manager 2026-08-13 规格）：旧计数器读 verification-round.jsonl 的 `runner` 字段数
// 「连续 runner=outer 轮数」，但 full-suite-runner.ts 把 `runner` 硬编码为 "outer"（140/140 零反例，
// 无 --runner 旗标）⇒ `consecutive_outer_rounds` 结构上永不归零 ⇒ signal 测的是轮数不是回落
// （硬规则 4：一个结构上不可能取假的量不是测量）。`runner` 字段已降级为【层身份/展示标注】——
// 它只记录 full-suite-runner 被调用时的名义角色，不知道调用者是主会话回合 / workflow / subagent。
//
// 重写后的执行形态取证（硬规则 4b：取证必须由 harness 产生，不能由被测者自报）：
//   执行形态 = 这一轮套件的 launch Bash tool_use 落在哪一类 transcript 文件里：
//     主会话   <project>/<session>.jsonl
//     subagent <project>/<session>/subagents/agent-*.jsonl
//     workflow <project>/<session>/subagents/workflows/<run>/agent-*.jsonl
//   三类路径互斥（本机实测枚举：主会话 jsonl 26 / agent-*.jsonl 196 / 其中 workflows 下 102）。
//   判据：取含 full-suite-runner.ts 的 Bash tool_use（真 launch：node 以 runner 为脚本路径执行，
//   非 grep/sed/node -e 等检查），其时间戳落在 [round.startedAt ± ε] ⇒ 所在文件类别就是执行形态。
//   三类之外 = unclassified（缺值=未查，不是为假——不把未分类当作任何一类）。
//
//   ⚠️ 生产现实（2026-08-13 实测）：多数轮次由 suite-state-trigger.ts DETACHED 自动 spawn
//   （fire-and-forget，无逐轮 transcript tool_use）⇒ 这些轮如实报 unclassified（触发自动治理），
//   这正是健康态（套件在主会话回合外自动运行）。unclassified ≠ 回落信号。
//   ⚠️ transcript 可变性（2026-08-13 实测）：transcript 文件是活 harness 状态——长会话会被
//   COMPACT（旧 tool_use 折进 summary），历史轮的 launch 证据会随压缩消失（实测 r96/r123 的
//   main-session launch 在数小时后不可见）。近 N 轮窗口用新鲜证据，可靠；全量 forms_by_round
//   只反映【当前可读】的 launch 证据，会随时间收缩。这是读活状态的固有代价，如实标注。
//   判定归 outer：signal 触发后先用 meta-cc 核实「最近是否真有主会话直跑」再决定动作。
//
//   measure   execution_form_counter = 每轮执行形态（main-session/subagent/workflow/unclassified）
//   band      invariant（AC2，可取假）：「近 N 轮已分类形态出现 ≥2 类」。
//             - 已分类 ≥2 且不同 ≥2 ⇒ healthy（invariant 成立）
//             - 已分类 ≥2 且全部同类  ⇒ rollback（invariant 不成立——执行形态回落，主会话直跑越界）
//             - 已分类 <2（多为 unclassified/触发自动治理）⇒ insufficient-evidence（不计 signal，如实报组成）
//   invariant 近 N 轮已分类形态 ≥2 类（替换恒真的 `runner_field_tracked=1`——「字段被记录了」永远为真）
//   control   回落报 signal；主会话越界检测
//
// 展示（非执行面取证）：consecutive_outer_rounds / runner_counts 仍从 runner 字段计算，
// 但只作展示/历史对照，绝不驱动 signal。
//
// 轮次定义：一行 = verification-round.jsonl 一条 JSON 记录。**套件轮次**有 `startedAt`
// （时间匹配锚点）；closure-pass 记录（形如 {round, at, suiteGreen, closed}，无 startedAt）跳过。
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/suite-execution-form-counter.ts \
//        [--root <dir>] [--project-dir <dir>] [--verification-round <path>] \
//        [--epsilon-ms <n>] [--recent-n <n>] [--json] [--help]
//
// Exit: 0 = healthy / insufficient-evidence · 1 = 回落 signal（invariant 不成立）·
//       2 = 用法/环境错误。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

/** 默认 verification-round 相对路径（<root>/.quay/verification-round.jsonl）——外层每轮一行套件记录。 */
export const DEFAULT_VERIFICATION_ROUND_REL = path.join(".quay", "verification-round.jsonl");

/** 默认 ε 匹配窗（ms，90 秒）：launch tool_use 时间戳须落在 [startedAt ± ε]。实测真 launch 与轮次差距 1–90s（命令前缀步骤）；轮间 ≥5min ⇒ 90s 无跨轮歧义，且排除 100s+ 的巧合命令。 */
export const DEFAULT_EPSILON_MS = 90 * 1000;

/** 默认 invariant 窗口 N（近 N 轮）。 */
export const DEFAULT_RECENT_N = 5;

/** 三种执行形态（互斥，来自 transcript 文件类别）+ unclassified（缺值=未查）。 */
export const FORM_MAIN_SESSION = "main-session";
export const FORM_SUBAGENT = "subagent";
export const FORM_WORKFLOW = "workflow";
export const FORM_UNCLASSIFIED = "unclassified";

/** 一条套件轮次记录：有 `runner`（字符串）或 `startedAt`（时间戳）的 verification-round 行（旧语义保留给展示计数）。 */
export function isSuiteRound(rec) {
  return (
    rec !== null &&
    typeof rec === "object" &&
    (typeof rec.runner === "string" || typeof rec.startedAt === "string")
  );
}

/** 解析 ISO 时间戳为 ms；解析失败/缺失返回 null。 */
export function parseIsoMs(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 判定一个 transcript 文件属于哪一类执行形态（按路径位置，不按内容）。PURE。
 * @param {string} filePath 绝对路径
 * @param {string} projectDir 项目 transcript 根（如 ~/.claude/projects/-home-yale-work-quay）
 * @returns {string|null} FORM_MAIN_SESSION / FORM_SUBAGENT / FORM_WORKFLOW / null（非三类）
 */
export function classifyTranscriptFile(filePath, projectDir) {
  const rel = path.relative(projectDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  const leaf = parts[parts.length - 1] ?? "";
  if (!leaf.endsWith(".jsonl")) return null; // 主会话/agent 都是 .jsonl；.meta.json / 其它扩展名拒
  // 主会话 <project>/<session>.jsonl（恰一层）
  if (parts.length === 1) return FORM_MAIN_SESSION;
  // workflow <project>/<session>/subagents/workflows/<run>/agent-*.jsonl（≥4 层）
  if (parts.length >= 4 && parts[1] === "subagents" && parts[2] === "workflows" && leaf.startsWith("agent-")) {
    return FORM_WORKFLOW;
  }
  // subagent <project>/<session>/subagents/agent-*.jsonl（恰 3 层）
  if (parts.length === 3 && parts[1] === "subagents" && leaf.startsWith("agent-")) {
    return FORM_SUBAGENT;
  }
  return null;
}

/**
 * 判定一个 Bash 命令是不是对 full-suite-runner.ts 的【真 launch】——node 以 runner 为脚本路径
 * 执行（非 grep/sed/cat/node -e 等检查/求值）。PURE。
 * @param {string} cmd Bash 命令文本
 * @returns {boolean}
 */
export function isLaunchCommand(cmd) {
  if (typeof cmd !== "string" || !cmd.includes("full-suite-runner.ts")) return false;
  // 找 node 调用段：node 之后（不跨 \n ; | & 边界）到 full-suite-runner.ts
  const re = /\bnode\b/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const tail = cmd.slice(m.index);
    const segMatch = tail.match(/^((?:(?!\n|;|\||&).)*?)full-suite-runner\.ts/);
    if (!segMatch) continue;
    const seg = segMatch[1];
    // node -e / -c / --eval / --check → 求值/语法检查，不是 launch
    // （-e 前无词边界：`node -e` 里 -e 前是空格，\b 不成立 ⇒ 用 -(?:e|c)\b 而不用 \b-(?:e|c)\b；
    //   尾部 \b 保证 --experimental 里的 -e 不误伤——e 后接 x 无词边界）
    if (/-(?:e|c)\b|--(?:eval|check)\b/.test(seg)) continue;
    // node 调用之前的那个命令（按命令分隔符 \n ; | && || 切到最近边界）不能是检查/echo
    // （&& 必须整 token 切，不能拆成单个 &；且要滤掉空段——`&& ` 尾部会留下空串）
    const lastCmd = cmd
      .slice(0, m.index)
      .split(/\n|&&|\|\||;|\|/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() ?? "";
    if (/\b(?:echo|grep|sed|cat|head|tail|jq|pgrep|rg|diff|awk|python3)\b/.test(lastCmd)) return false;
    return true;
  }
  return false;
}

/**
 * 从单个 transcript 文件抽取 launch tool_use：assistant 消息里 name=Bash 且 isLaunchCommand 的
 * tool_use，附时间戳（assistant 记录级 timestamp）。PURE。
 * @param {string} filePath transcript 文件
 * @param {string} projectDir 项目 transcript 根（用于分类）
 * @returns {Array<{tsMs: number|null, form: string, filePath: string}>}
 */
export function extractLaunchesFromFile(filePath, projectDir) {
  const form = classifyTranscriptFile(filePath, projectDir);
  if (form === null) return [];
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || !l.includes('"tool_use"')) continue; // 廉价预筛：无 tool_use 的行跳过
    let rec;
    try {
      rec = JSON.parse(l);
    } catch {
      continue;
    }
    if (rec === null || typeof rec !== "object" || rec.type !== "assistant") continue;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type !== "tool_use" || block.name !== "Bash") continue;
      const cmd = block.input?.command;
      if (!isLaunchCommand(cmd)) continue;
      out.push({ tsMs: parseIsoMs(rec.timestamp), form, filePath });
    }
  }
  return out;
}

/**
 * 递归收集项目 transcript 根下三类文件的 launch tool_use 索引。PURE（只读盘，不突变）。
 * @param {string} projectDir 项目 transcript 根
 * @returns {Array<{tsMs: number|null, form: string, filePath: string}>}
 */
export function collectLaunches(projectDir) {
  const launches = [];
  const stack = [projectDir];
  const seen = new Set();
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // 只下探真实子目录（会话/ subagents/ workflows/<run>/ 三层），不跟随符号链接；
      // 文件由 classifyTranscriptFile 按路径位置归类，非三类路径的 .jsonl 被拒。
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.name.endsWith(".jsonl") || e.name.endsWith(".meta.json")) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      launches.push(...extractLaunchesFromFile(full, projectDir));
    }
  }
  return launches;
}

/**
 * 为一个轮次找 [startedAt ± ε] 窗内最近的 launch，返回其形态。PURE。
 * @param {Array<{tsMs: number|null, form: string}>} launches launch 索引
 * @param {number} startedAtMs 轮次 startedAt（ms）
 * @param {number} epsilonMs 匹配窗（ms）
 * @returns {{form: string, gapMs: number, matchedTsMs: number}|null}
 */
export function findLaunchForm(launches, startedAtMs, epsilonMs) {
  let best = null;
  for (const l of launches) {
    if (l.tsMs === null) continue;
    const d = Math.abs(l.tsMs - startedAtMs);
    if (d <= epsilonMs && (best === null || d < best.gapMs)) {
      best = { form: l.form, gapMs: d, matchedTsMs: l.tsMs };
    }
  }
  return best;
}

/**
 * 分类一批 verification-round 记录为逐轮执行形态。PURE。
 * @param {Array<Record<string, any>>} records 已解析记录（保序，旧→新）
 * @param {Array<{tsMs: number|null, form: string}>} launches launch 索引
 * @param {number} epsilonMs 匹配窗（ms）
 * @returns {Array<{round: number|null, startedAt: string|null, startedAtMs: number|null, form: string, gapMs: number|null, matchedTsMs: number|null}>}
 */
export function classifyRounds(records, launches, epsilonMs) {
  const out = [];
  for (const rec of records) {
    const startedAtMs = parseIsoMs(rec?.startedAt);
    if (startedAtMs === null) continue; // closure-pass / 无时间锚 → 不参与分类（仍计入 display 计数）
    const m = findLaunchForm(launches, startedAtMs, epsilonMs);
    out.push({
      round: typeof rec.round === "number" ? rec.round : null,
      startedAt: rec.startedAt ?? null,
      startedAtMs,
      form: m ? m.form : FORM_UNCLASSIFIED,
      gapMs: m ? m.gapMs : null,
      matchedTsMs: m ? m.matchedTsMs : null,
    });
  }
  return out;
}

/**
 * 数自最近一条非-outer 套件轮（或文件开头）以来连续 `runner==="outer"` 的套件轮数。PURE。
 * 仅展示（非执行面取证）：runner 字段已被 full-suite-runner 硬编码 outer，此值恒等于尾部 outer 段长，
 * 不代表执行形态。保留是为了历史对照与旧读者兼容。
 */
export function countConsecutiveOuterRounds(records) {
  let consecutive = 0;
  const runnerCounts = {};
  for (const rec of records) {
    if (!isSuiteRound(rec)) continue;
    const r = typeof rec.runner === "string" ? rec.runner : "missing";
    runnerCounts[r] = (runnerCounts[r] ?? 0) + 1;
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (!isSuiteRound(rec)) continue;
    const r = typeof rec.runner === "string" ? rec.runner : null;
    if (r === "outer") consecutive++;
    else break;
  }
  return { consecutive, runnerCounts };
}

/**
 * invariant 判定（AC2，可取假）：「近 N 轮已分类形态出现 ≥2 类」。PURE。
 * @param {Array<{form: string}>} roundForms 逐轮执行形态（保序，旧→新）
 * @param {number} n 窗口大小
 */
export function judgeInvariant(roundForms, n) {
  const window = roundForms.slice(-n);
  const classified = window.filter((f) => f.form !== FORM_UNCLASSIFIED);
  const unclassifiedInWindow = window.length - classified.length;
  const distinct = new Set(classified.map((f) => f.form)).size;
  if (classified.length >= 2) {
    const holds = distinct >= 2;
    return {
      band: holds ? "healthy" : "rollback",
      signal: !holds,
      action: holds ? null : "执行形态回落——近 N 轮已分类轮次全部同一形态",
      distinct_forms: distinct,
      classified_in_recent_n: classified.length,
      unclassified_in_recent_n: unclassifiedInWindow,
      message: holds
        ? `近 ${n} 轮已分类执行形态 ${distinct} 类（≥2）——invariant 成立`
        : `近 ${n} 轮已分类执行形态仅 ${distinct} 类（全部 ${classified[0].form}，共 ${classified.length} 轮）——invariant 不成立，执行形态回落`,
    };
  }
  return {
    band: "insufficient-evidence",
    signal: false,
    action: null,
    distinct_forms: distinct,
    classified_in_recent_n: classified.length,
    unclassified_in_recent_n: unclassifiedInWindow,
    message:
      `近 ${n} 轮已分类轮次 ${classified.length}（<2，多为 unclassified/触发自动治理 ${unclassifiedInWindow} 轮）——` +
      `证据不足，不计 signal；这本身不是回落（主会话直跑才越界）`,
  };
}

/** 从 workspace root 推导 Claude Code 项目 transcript 根（路径编码：`/`→`-`，前缀 `-`）。 */
export function deriveProjectDir(root) {
  const abs = path.resolve(root);
  const encoded = "-" + abs.replace(/^\/+/, "").replace(/\//g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

function usage() {
  console.error(`suite-execution-form-counter.ts — 套件执行形态的机械计数器（外层每 tick 跑）

执行形态取证（tasks/gap-a19-evidence-field-does-not-match-measured-object，manager 2026-08-13 重写）：
为每轮 verification-round（有 startedAt）找 [startedAt ± ε] 窗内最近的 launch Bash tool_use
（node 执行 full-suite-runner.ts，非 grep/sed/node -e），其 transcript 文件类别即执行形态：
  主会话 <project>/<session>.jsonl · subagent <project>/<session>/subagents/agent-*.jsonl ·
  workflow <project>/<session>/subagents/workflows/<run>/agent-*.jsonl
无匹配 ⇒ unclassified（缺值=未查，触发自动治理是健康态，不是回落）。

invariant（可取假，替换恒真 runner_field_tracked=1）：「近 N 轮已分类形态出现 ≥2 类」。
  已分类 ≥2 且全同类 ⇒ band=rollback signal=1（exit 1）；否则 healthy / insufficient-evidence（exit 0）。

Usage:
  --root <dir>                 workspace root (default: auto-derived from this script's location)
  --project-dir <dir>          transcript project root override (default: ~/.claude/projects/<encoded-root>)
  --verification-round <path>  override the verification-round.jsonl path (test seam)
  --epsilon-ms <n>             launch match window (default 300000 = 5min)
  --recent-n <n>               invariant window N (default 5)
  --json                       JSON output (measure-only, never mutates)
  --help|-h                    this usage (exit 0)

Exit: 0 healthy / insufficient-evidence · 1 rollback signal (invariant false) · 2 usage/env error`);
}

export function main(argv) {
  const args = argv.slice(2);
  const flagVal = (name, def) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : def;
  };
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  const jsonOut = args.includes("--json");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const autoRoot = path.resolve(scriptDir, "..", "..");
  const root = flagVal("--root", autoRoot);
  const epsilonArg = flagVal("--epsilon-ms", String(DEFAULT_EPSILON_MS));
  const epsilonMs = Number(epsilonArg);
  if (!Number.isInteger(epsilonMs) || epsilonMs <= 0) {
    console.error(`suite-execution-form-counter: 无效 --epsilon-ms '${epsilonArg}'（必须为正整数 ms，默认 ${DEFAULT_EPSILON_MS}）`);
    return 2;
  }
  const nArg = flagVal("--recent-n", String(DEFAULT_RECENT_N));
  const n = Number(nArg);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`suite-execution-form-counter: 无效 --recent-n '${nArg}'（必须为正整数，默认 ${DEFAULT_RECENT_N}）`);
    return 2;
  }

  const verificationRound =
    flagVal("--verification-round", "") || path.join(root, DEFAULT_VERIFICATION_ROUND_REL);
  const projectDir = flagVal("--project-dir", "") || deriveProjectDir(root);

  // ── verification-round 解析 ───────────────────────────────────────────────────────────────────────
  let records = [];
  if (fs.existsSync(verificationRound)) {
    const text = fs.readFileSync(verificationRound, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      try {
        records.push(JSON.parse(l));
      } catch {
        continue;
      }
    }
  }

  // ── 执行形态取证（launch tool_use 的 transcript 文件类别）────────────────────────────────────────
  const projectExists = fs.existsSync(projectDir);
  const launches = projectExists ? collectLaunches(projectDir) : [];
  const roundForms = classifyRounds(records, launches, epsilonMs);
  const verdict = judgeInvariant(roundForms, n);

  // ── 展示字段（非执行面取证）：runner 字段计数，仅作历史对照 ─────────────────────────────────────
  const { consecutive, runnerCounts } = countConsecutiveOuterRounds(records);
  const suiteRounds = Object.values(runnerCounts).reduce((a, b) => a + b, 0);

  const out = {
    signal: verdict.signal,
    band: verdict.band,
    action: verdict.action,
    message: verdict.message,
    invariant_holds: verdict.signal ? false : verdict.band === "healthy",
    distinct_forms_in_recent_n: verdict.distinct_forms,
    classified_in_recent_n: verdict.classified_in_recent_n,
    unclassified_in_recent_n: verdict.unclassified_in_recent_n,
    recent_n: n,
    epsilon_ms: epsilonMs,
    // 逐轮执行形态（近 N 轮完整列出，更早轮仅计数）
    execution_forms: roundForms.slice(-n).map((f) => ({
      round: f.round,
      startedAt: f.startedAt,
      form: f.form,
      ...(f.gapMs !== null ? { gap_ms: Math.round(f.gapMs) } : {}),
      ...(f.matchedTsMs !== null ? { matched_ts: f.matchedTsMs } : {}),
    })),
    forms_by_round: (() => {
      const c = { main_session: 0, subagent: 0, workflow: 0, unclassified: 0 };
      for (const f of roundForms) {
        if (f.form === FORM_MAIN_SESSION) c.main_session++;
        else if (f.form === FORM_SUBAGENT) c.subagent++;
        else if (f.form === FORM_WORKFLOW) c.workflow++;
        else c.unclassified++;
      }
      return c;
    })(),
    // ⚠️ 非执行面取证（A19 重写降级）：consecutive_outer_rounds/runner_counts 恒反映 runner 硬编码 outer，
    // 不代表执行形态，绝不驱动 signal。仅保留展示/历史对照。
    consecutive_outer_rounds: consecutive,
    runner_counts: runnerCounts,
    project_dir: projectDir,
    project_dir_exists: projectExists,
    verification_round: verificationRound,
    total_records: records.length,
    suite_rounds: suiteRounds,
    rounds_classified: roundForms.length,
    _non_execution_surface: "runner 字段已降级为层身份/展示标注——执行形态取证面是 launch tool_use 的 transcript 文件类别",
  };
  if (jsonOut) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(
      `suite-execution-form-counter: ${out.message} [band=${out.band} forms=${JSON.stringify(out.forms_by_round)}]`,
    );
  }
  return out.signal ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "suite-execution-form-counter")) {
  const code = main(process.argv);
  process.exit(code);
}
