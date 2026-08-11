#!/usr/bin/env node
// a15-ruling5-counter.ts — A15 裁定5 的机械计数器（tasks/gap-a15-ruling5-counter-missing）。
//
// Defect family (C17: rules need PRODUCTS, not visibility): A15 裁定5 — "连续 3 轮 A15 心跳缺失
// (Agent 无新 ts) ⇒ `.halt`;再 3 轮 ⇒ `/clear`" — 写在 git 跟踪的执行核（orchestrator-tick-core.md
// A15,80 行,每轮必读）,仍连续 9 轮未执行;`capability-catalog.sh | grep -ci suite-health` = 0,没有
// 任何脚本在数那个「连续 3 轮」。规则的「守」与「不守」在记录上不可区分 —— 正是 C17 判死刑的形状
// (规则可见到不能再可见,缺的纯粹是产物)。
//
// Fix: 一个机械计数器。每 tick 外层跑本脚本;它读两个源:
//   1. **outer 会话 transcript**(~/.claude/projects/<slug>/<outer>.jsonl)—— 最后一次 `Agent`
//      tool_use 记录的 timestamp("Agent 无新 ts" 的 ts;与 A15 ③ 心跳 `tool_name=Agent` 同源)。
//   2. **outer tick-log**(<root>/orchestration/tick-log.md)—— 时间戳晚于那个 Agent ts 的 tick 行数
//      (一轮 = 一条 tick 行;task Contract 明确「以 tick 行数为准」)。
//   报告 `ticks_since_agent`。分档(task Contract band):
//     ticks_since_agent < 3  → 健康(静默,exit 0)
//     ticks_since_agent >= 3 → 「应 .halt」(A15 心跳缺失 3 轮,exit 1)
//     ticks_since_agent >= 6 → 「应 /clear」(再 3 轮,exit 1)
//   如果 transcript 里从未有过 `Agent` tool_use,则所有 tick 行都算「Agent 之后」——fail-closed
//   (与 A15 的文件缺失=没做同形):一个跑了 tick 却从未派发 subagent 的 outer 正是裁定5 要抓的。
//   刚起步的会话 tick 行数=0 → ticks=0 健康,不会误报。
//
// outer 会话按身份解析(manager 纪律:「会话 id 必须每轮按身份重解析,禁止沿用记忆里的 id」——
// /clear 会把进程寿命与文件寿命解耦):外层 transcript 头部带一条
// `{"type":"custom-title","customTitle":"quay-outer",...}`,扫 ~/.claude/projects/<slug>/*.jsonl,
// 取 customTitle 含 "outer" 且 mtime 最新者。`--transcript <path>`(或 $QUAY_OUTER_TRANSCRIPT)显式
// 覆盖自动发现(也是测试接缝);auto-discovery 是启发式,按 session-liveness.sh 纪律明标。
//
// 轮次定义(实现时写死进注释,避免数法漂移):一轮 = 一条外层 tick-log 行,时间戳形如
// `| YYYY-MM-DD HH:MMZ` 或 `## YYYY-MM-DD HH:MMZ`。占位行(分钟位是 `x`/`${TS}` 等非数字)不数。
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/a15-ruling5-counter.ts \
//        [--root <dir>] [--transcript <path>] [--tick-log <path>] [--json] [--help]
//
// Exit: 0 = 健康(ticks < 3)· 1 = 信号(>=3 应 .halt / >=6 应 /clear)· 2 = 用法/环境错误。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

/** 默认 tick-log 相对路径(<root>/orchestration/tick-log.md)——外层 tick 日志。 */
export const DEFAULT_TICK_LOG_REL = path.join("orchestration", "tick-log.md");

/** 一条 tick 行 = 行首(可带缩进)`| ` 或 `## ` 后跟 `YYYY-MM-DD HH:MMZ`(分钟必须是两位数字)。 */
export const TICK_ROW_RE =
  /^\s*(?:\||##)\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})Z/;

/**
 * 从 transcript 行里找最后一次 `Agent` tool_use 的 epoch-ms。PURE。
 * 便宜预过滤(`"name":"Agent"` 在原始行里出现)跳过绝大多数行,再 JSON.parse 按位置确认
 * 是 assistant 消息 content 里的 tool_use 块(不是 tool_result、不是正文引述)——「按位置判定,不按关键词」。
 * @param {string[]} lines transcript 的每一行(JSONL)
 * @returns {number|null} 最后一次 Agent tool_use 的 epoch-ms;从未有过则 null。
 */
export function lastAgentTsMs(lines) {
  let last = null;
  for (const line of lines) {
    if (!line.includes('"name":"Agent"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 非 JSON 行 / 半写行——跳过,不因单行坏档炸整个计数
    }
    if (o?.type !== "assistant") continue;
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    if (!content.some((c) => c && c.type === "tool_use" && c.name === "Agent")) continue;
    if (typeof o.timestamp !== "string") continue;
    const ms = Date.parse(o.timestamp);
    if (!Number.isFinite(ms)) continue;
    if (last == null || ms > last) last = ms;
  }
  return last;
}

/**
 * 数 tick-log 里时间戳严格晚于 afterMs 的 tick 行数。PURE。
 * 一轮 = 一条 tick 行;占位行(分钟位非数字,如 `00:3xZ`/`${TS}`)不数。
 * @param {string[]} lines tick-log 的每一行
 * @param {number} afterMs epoch-ms 下界(严格大于才计)
 * @returns {number}
 */
export function countTickRowsAfter(lines, afterMs) {
  let n = 0;
  for (const line of lines) {
    const m = TICK_ROW_RE.exec(line);
    if (!m) continue;
    const epochMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (epochMs > afterMs) n++;
  }
  return n;
}

/**
 * 分档判定。PURE。Contract band:
 *   < 3 健康;>=3 报「应 .halt」;>=6 报「应 /clear」。
 * @param {number} ticks ticks_since_agent
 */
export function judgeTicks(ticks) {
  if (ticks >= 6) {
    return {
      band: "clear",
      signal: true,
      action: "应 /clear",
      message: `A15 心跳缺失 ${ticks} 轮 (>=6) ⇒ 应 /clear`,
    };
  }
  if (ticks >= 3) {
    return {
      band: "halt",
      signal: true,
      action: "应 .halt",
      message: `A15 心跳缺失 ${ticks} 轮 (>=3) ⇒ 应 .halt`,
    };
  }
  return {
    band: "healthy",
    signal: false,
    action: null,
    message: `A15 心跳 ${ticks} 轮 (<3) 健康`,
  };
}

/**
 * 按身份解析 outer 会话 transcript:扫 ~/.claude/projects/<slug>/*.jsonl,
 * 取 customTitle 含 "outer"(不区分大小写)且 mtime 最新者。启发式(session-liveness.sh 纪律明标)。
 * @param {string} root 工作区根(推导 project slug)
 * @returns {string|null} outer transcript 路径;找不到则 null。
 */
export function discoverOuterTranscript(root) {
  const home = os.homedir();
  const slug = path.resolve(root).replace(/[\\/]+/g, "-");
  const dir = path.join(home, ".claude", "projects", slug);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null; // 无 projects 目录——不存在可发现的 outer
  }
  let best = null; // { path, mtimeMs }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const p = path.join(dir, f);
    let head = "";
    try {
      head = fs.readFileSync(p, { encoding: "utf8" }).slice(0, 8192);
    } catch {
      continue;
    }
    // custom-title 记录在会话文件头部(`"customTitle":"quay-outer"` 值含 outer 才是外层身份,inner/manager 不含)
    if (!/"customTitle"\s*:\s*"[^"]*outer[^"]*"/i.test(head)) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(p).mtimeMs;
    } catch {
      continue;
    }
    if (best == null || mtimeMs > best.mtimeMs) best = { path: p, mtimeMs };
  }
  return best?.path ?? null;
}

/** 读文件为行数组(换行归一化)。 */
function readLines(p) {
  return fs.readFileSync(p, "utf8").split(/\r?\n/);
}

function usage() {
  console.error(`a15-ruling5-counter.ts — A15 裁定5 的机械计数器(外层每 tick 跑)

Reads the OUTER session transcript's last Agent tool_use timestamp + the outer tick-log's rows,
reports ticks_since_agent (one round = one tick-log row). Band:
  <3 healthy (exit 0) · >=3 「应 .halt」(exit 1) · >=6 「应 /clear」(exit 1)

Usage:
  --root <dir>         workspace root (default: auto-derived from this script's location)
  --transcript <path>  outer session transcript JSONL (default: $QUAY_OUTER_TRANSCRIPT, else
                       auto-discovery by custom-title "outer" + newest mtime — heuristic)
  --tick-log <path>    outer tick-log (default <root>/orchestration/tick-log.md)
  --json               JSON output (machine-readable; measure-only, never mutates)
  --help|-h            this usage (exit 0)

Exit: 0 healthy · 1 signal (>=3 halt / >=6 clear) · 2 usage/environment error`);
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

  // ── transcript 解析:显式(--transcript / $QUAY_OUTER_TRANSCRIPT)优先,否则按身份自动发现 ─────
  let transcript = flagVal("--transcript", "") || process.env.QUAY_OUTER_TRANSCRIPT || "";
  if (!transcript) {
    transcript = discoverOuterTranscript(root) ?? "";
  }
  if (!transcript || !fs.existsSync(transcript)) {
    console.error(
      "a15-ruling5-counter: 无法解析 outer 会话 transcript(传 --transcript <path> 或在 quay 主仓根跑;auto-discovery 需要 custom-title=quay-outer 的会话)",
    );
    return 2;
  }

  // ── tick-log 解析 ────────────────────────────────────────────────────────────────────────────────
  const tickLog = flagVal("--tick-log", path.join(root, DEFAULT_TICK_LOG_REL));
  if (!fs.existsSync(tickLog)) {
    console.error(`a15-ruling5-counter: tick-log 不存在: ${tickLog}`);
    return 2;
  }

  // ── 计数 ──────────────────────────────────────────────────────────────────────────────────────────
  let lastAgentMs;
  try {
    lastAgentMs = lastAgentTsMs(readLines(transcript));
  } catch (e) {
    console.error(`a15-ruling5-counter: 读 transcript 失败: ${e.message}`);
    return 2;
  }
  let ticks;
  try {
    ticks = countTickRowsAfter(readLines(tickLog), lastAgentMs ?? 0);
  } catch (e) {
    console.error(`a15-ruling5-counter: 读 tick-log 失败: ${e.message}`);
    return 2;
  }
  const verdict = judgeTicks(ticks);

  const out = {
    ticks_since_agent: ticks,
    last_agent_ts: lastAgentMs != null ? new Date(lastAgentMs).toISOString() : null,
    last_agent_epoch_ms: lastAgentMs,
    band: verdict.band,
    signal: verdict.signal,
    action: verdict.action,
    message: verdict.message,
    transcript,
    tick_log: tickLog,
  };
  if (jsonOut) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`a15-ruling5-counter: ${verdict.message}`);
  }
  return verdict.signal ? 1 : 0;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
