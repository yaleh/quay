#!/usr/bin/env node
// semantic-observer-judge.ts — inner/outer 语义观测器 judge
// (tasks/gap-semantic-observer-judge-stopped-awaiting)
//
// Defect family (2026-08-10 活体实证): schema 结构化字段只能承载「预先想到的」需求类型；真实需求会
// 溢出到自由文本，而机械读数看不见自由文本。`.quay/inner-wakeup-heartbeat.json` 两次写入：
//   - 结构化字段：`blocked=[]`（转交 merge-conflict 后被清空）+ `budgetHit=true` + `agentDispatches=201/agentLimit=200`
//     ⇒ 机械读者结论「无阻塞、预算触顶」（「预算触顶」不是 `blocked` 想表达的那类阻塞）。
//   - 自由文本 `reason`：逐字「BUDGET HIT (200/200, dispatch stopped, awaiting outer /clear)」
//     ⇒ 真实状态「我完全停了、派发停止、在等 outer /clear」只存在于自由文本。
//   ⇒ 三层执行核（manager A3 / outer A16）都改成了只读结构化字段——下一轮会【再次】判「inner 无需支持」，
//     且这次连怀疑的由头都没有。
//
// THIS JUDGE READS FREE TEXT — heartbeat `reason` + 该层 tick 报告全文 (transcript) — NOT just the
// structured fields. 这是 AC41 判据① 的动作化（读自由文本不得只读结构化字段，否则退化成错误的自动化版本）。
// `contradictsStructured` 是关键字段——它就是本次失效的名字（结构化字段与自由文本矛盾）。
//
// 规格（四项）:
//   1. 源 = 自由文本: 心跳 `reason` + 该层 tick 报告全文（transcript）。不用 pane（今晚三次不可靠）。
//   2. 判断 = schema'd judge: 输出 {stopped, awaiting:{who,what}, needs:[{what,owner,blocking,evidence}],
//      contradictsStructured, confidence}。contradictsStructured 是关键字段。
//   3. 触发 = 不是每轮（成本）: 自由文本内容 hash 变化 或 机械字段与自由文本可能不一致的启发式
//      （如 blocked==[] && agentDispatches>=agentLimit——正是本次形态）。
//   4. 产物须满足 AC41③: judge 输出 stopped:true 而本轮 tick-log 无对应升级记录 ⇒ RED（变红）。
//
// 形态: subagent + schema 即可，不必 workflow（nyf-semantic-judge 一步判断成功先例）。
// 三层对称: --layer inner|outer（manager 侧 manager 自己用）。
//
// Usage:
//   node --experimental-strip-types semantic-observer-judge.ts --layer inner|outer \
//        [--root <dir>] [--heartbeat <path>] [--tick-report <path>] [--tick-log <path>] \
//        [--prev-hash <hash>] [--json]
//
// Exit: 0 = judged (redOnOmission may be true/false, see output) · 1 = red-on-omission (stopped but no
// escalation in tick-log) · 2 = usage error.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDirectEntry } from "./gate-script-base.ts";
// AC3 触发启发式正本在 inner-wakeup-heartbeat-check.ts（该文件读 heartbeat 产物）
import { semanticTriggerHeuristic, freeTextHash, evaluateTrigger } from "./inner-wakeup-heartbeat-check.ts";

// ── Free-text stop/await signals ────────────────────────────────────────────────────────────────────

// 判定「stopped」的自由文本信号。每条都必须在自由文本里真实出现（reason + tick 报告），
// 不是结构化字段的投影。按今晚实证措辞钉死，外加同族通用形态。
const STOP_SIGNALS = [
  /dispatch\s+stopped/i,
  /awaiting\s+(?:the\s+)?outer/i,
  /awaiting[^;]{0,40}\/clear/i,
  /budget\s+hit[^;]{0,40}(?:dispatch\s+stopped|awaiting)/i,
  /stopped\s*[,;]?\s*awaiting/i,
  /cannot\s+dispatch/i,
  /waiting\s+for\s+(?:the\s+)?outer/i,
  /no\s+further\s+dispatch/i,
  /waiting[^;]{0,40}\/clear/i,
];

// 提取 awaiting 的 who/what。返回 {who, what} 或 null。
const AWAIT_RES = [
  /awaiting\s+(?:the\s+)?([a-z]+)\s+([^\s;,\)]+)/i, // "awaiting outer /clear"
  /waiting\s+for\s+(?:the\s+)?([a-z]+)\s+(?:to\s+)?([^\s;,\)]+)/i, // "waiting for outer to /clear"
  /needs\s+(?:the\s+)?([a-z]+)\s+(?:to\s+)?([^\s;,\)]+)/i, // "needs outer to /clear"
];

// 提取 needs 的 owner 短语（一个 need = 一个 await/wait/needs 从句）。
const NEED_OWNER_RES = [
  /awaiting\s+(?:the\s+)?([a-z]+)\s+([^\s;,\)]+)/i,
  /waiting\s+for\s+(?:the\s+)?([a-z]+)\s+(?:to\s+)?([^\s;,\)]+)/i,
  /needs\s+(?:the\s+)?([a-z]+)\s+(?:to\s+)?([^\s;,\)]+)/i,
];

// ── Pure judgment (hermetic, testable) ─────────────────────────────────────────────────────────────

export interface Awaiting {
  who: string | null;
  what: string | null;
}

export interface Need {
  what: string;
  owner: string;
  blocking: boolean;
  evidence: string;
}

export interface Judgment {
  stopped: boolean;
  awaiting: Awaiting;
  needs: Need[];
  contradictsStructured: boolean;
  confidence: number;
  // 诊断辅助（不属 schema，但写出来让「读的是自由文本」可核）
  freeTextSignalsHit: string[];
  readFreeText: boolean;
}

/** 提取 awaiting（who/what）。PURE。 */
export function extractAwaiting(freeText: string): Awaiting | null {
  for (const re of AWAIT_RES) {
    const m = freeText.match(re);
    if (m) return { who: m[1].toLowerCase(), what: m[2].replace(/^["']|["']$/g, "") };
  }
  return null;
}

/** 从 await/wait/needs 从句提取 needs 列表。PURE。 */
export function extractNeeds(freeText: string): Need[] {
  const needs: Need[] = [];
  for (const re of NEED_OWNER_RES) {
    const m = freeText.match(re);
    if (m) {
      const what = m[2].replace(/^["']|["']$/g, "");
      const owner = m[1].toLowerCase();
      const evidence = m[0];
      // 去重：同一 (what,owner) 只留一条
      if (!needs.some((n) => n.what === what && n.owner === owner)) {
        needs.push({ what, owner, blocking: true, evidence });
      }
    }
  }
  // 补充: 显式「blocked by X」(非 await) 形态
  const blockedM = freeText.match(/blocked\s+by\s+([^\s;,\)]+)/i);
  if (blockedM) {
    const what = blockedM[1].trim();
    if (!needs.some((n) => n.what === what)) {
      needs.push({ what, owner: "unknown", blocking: true, evidence: blockedM[0] });
    }
  }
  return needs;
}

/**
 * 判断「结构化字段是否已经表达了 stop/await 状态」。PURE。
 * 若 blocked 非空，或存在显式 stopped/awaiting 字段 ⇒ 结构化已承载该状态（无矛盾）。
 * `budgetHit` 不是 `blocked` 想表达的那类阻塞——它只是资源计数，不表达「停了等 /clear」。
 */
export function structuredCarriesStopState(structured: Record<string, unknown> | null | undefined): boolean {
  if (!structured || typeof structured !== "object") return false;
  const blocked = structured.blocked;
  if (Array.isArray(blocked) && blocked.length > 0) return true;
  if (structured.stopped === true) return true;
  if (structured.awaiting && typeof structured.awaiting === "object") return true;
  return false;
}

/** 计算 confidence: 命中信号加权。PURE。 */
export function computeConfidence(freeText: string, awaiting: Awaiting | null, needs: Need[]): number {
  let hits = 0;
  for (const sig of STOP_SIGNALS) {
    if (sig.test(freeText)) hits++;
  }
  if (awaiting && awaiting.who && awaiting.what) hits += 1.5;
  hits += Math.min(1, needs.length) * 0.5;
  const total = STOP_SIGNALS.length + 2;
  return Math.max(0, Math.min(1, hits / total));
}

/**
 * 核心 judge: 读自由文本 + 结构化字段，输出 schema'd 判定。PURE。
 * @param freeText 自由文本 = heartbeat reason + 该层 tick 报告全文（transcript）
 * @param structured 结构化字段（heartbeat JSON 除 reason 外的字段）；可为 null（源只有自由文本）
 */
export function judge(freeText: string, structured: Record<string, unknown> | null | undefined): Judgment {
  const text = String(freeText ?? "");
  const stopped = STOP_SIGNALS.some((re) => re.test(text));
  const awaiting = extractAwaiting(text);
  const needs = extractNeeds(text);
  const structuredStop = structuredCarriesStopState(structured);
  // contradictsStructured = 自由文本说「停了/在等」而结构化字段没有表达该状态
  const contradictsStructured = stopped && !structuredStop;
  const confidence = computeConfidence(text, awaiting, needs);
  const freeTextSignalsHit = STOP_SIGNALS.filter((re) => re.test(text)).map((re) => re.source);
  return {
    stopped,
    awaiting: awaiting ?? { who: null, what: null },
    needs,
    contradictsStructured,
    confidence,
    freeTextSignalsHit,
    readFreeText: true,
  };
}

// ── Escalation red-on-omission (AC41③ / AC4) ───────────────────────────────────────────────────────

/**
 * 检查 tick-log 是否已有对应升级记录。PURE。
 * 判据：tick-log 中任一行含升级动作标记（escalat/升级/unblock）且提及该层或 stop/await 状态。
 */
export function escalationRecorded(tickLogText: string | null | undefined, layer: string): boolean {
  if (!tickLogText) return false;
  const ESCALATION = /escalat|升级|unblock/i;
  const layerMention = new RegExp(`\\b${layer}\\b`, "i");
  const stopMention = /stopped|awaiting|budget|dispatch\s+stopped|\/clear/i;
  return tickLogText
    .split("\n")
    .some((line) => ESCALATION.test(line) && (layerMention.test(line) || stopMention.test(line)));
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage() {
  console.error(`semantic-observer-judge.ts — inner/outer 语义观测器 judge（读自由文本，不只读结构化字段）

Reads the layer's free text (heartbeat \`reason\` + tick report transcript) and outputs a schema'd
judgment: {stopped, awaiting, needs, contradictsStructured, confidence}. \`contradictsStructured\` is
the key field — it names the failure where structured fields (blocked=[], budgetHit) say "no problem"
while free text says "dispatch stopped, awaiting outer /clear".

Usage:
  --layer <inner|outer>   layer being judged (default: inner)
  --root <dir>            workspace root (default: cwd) — default heartbeat <root>/.quay/<layer>-wakeup-heartbeat.json
  --heartbeat <path>      override heartbeat JSON path
  --tick-report <path>    override/attach the layer's tick report full text (transcript)
  --tick-log <path>       tick-log file for the red-on-omission check (default <root>/orchestration/tick-log.md)
  --prev-hash <hash>      previous free-text hash (AC3 hash-change trigger)
  --json                  JSON output (default human-readable)

Exit: 0 = judged (redOnOmission may be true/false) · 1 = red-on-omission (stopped:true but no
escalation in tick-log) · 2 = usage error`);
}

function readTextMaybe(p: string | undefined): string | null {
  if (!p) return null;
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const flagVal = (name: string, def?: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : def;
  };
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 2;
  }
  const layer = flagVal("--layer", "inner");
  if (layer !== "inner" && layer !== "outer") {
    console.error(`semantic-observer-judge: --layer must be inner or outer (got "${layer}")`);
    return 2;
  }
  const root = path.resolve(flagVal("--root", ".") ?? ".");
  const heartbeatPath = flagVal("--heartbeat") ?? path.join(root, ".quay", `${layer}-wakeup-heartbeat.json`);
  const tickReportPath = flagVal("--tick-report");
  const tickLogPath = flagVal("--tick-log") ?? path.join(root, "orchestration", "tick-log.md");
  const prevHash = flagVal("--prev-hash");
  const jsonOut = args.includes("--json");

  const heartbeatText = readTextMaybe(heartbeatPath);
  let structured: Record<string, unknown> | null = null;
  let reason = "";
  if (heartbeatText != null) {
    try {
      const hb = JSON.parse(heartbeatText);
      if (hb && typeof hb === "object") {
        structured = hb;
        if (typeof hb.reason === "string") reason = hb.reason;
      }
    } catch {
      // malformed heartbeat — judge from tick report free text alone
    }
  }

  const tickReportText = readTextMaybe(tickReportPath);
  const freeText = [reason, tickReportText ?? ""].filter(Boolean).join("\n");

  const j = judge(freeText, structured);
  const trigger = evaluateTrigger(structured, freeText, prevHash);
  const tickLogText = readTextMaybe(tickLogPath);
  const redOnOmission = j.stopped && !escalationRecorded(tickLogText, layer);

  if (jsonOut) {
    const out = {
      layer,
      ...j,
      trigger,
      redOnOmission,
      sources: {
        heartbeat: heartbeatText != null ? heartbeatPath : null,
        tickReport: tickReportText != null ? tickReportPath : null,
        tickLog: tickLogText != null ? tickLogPath : null,
        freeTextLength: freeText.length,
      },
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`layer=${layer} stopped=${j.stopped} awaiting=${j.awaiting.who ?? "-"}/${j.awaiting.what ?? "-"} contradictsStructured=${j.contradictsStructured} confidence=${j.confidence.toFixed(2)}`);
    if (j.needs.length) {
      for (const n of j.needs) console.log(`  need: ${n.what} (owner=${n.owner}, blocking=${n.blocking}) — ${n.evidence}`);
    }
    if (trigger.fired) console.log(`trigger: fired (heuristic=${trigger.heuristic}, hashChanged=${trigger.hashChanged})`);
    if (redOnOmission) console.log(`RED: stopped:true but no escalation in tick-log`);
  }
  return redOnOmission ? 1 : 0;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
