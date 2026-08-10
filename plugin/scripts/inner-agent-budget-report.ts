#!/usr/bin/env node
// @instrument "What is the inner subagent budget state — .quay/inner-agent-budget.json {spawned, limit, lastSpawnAt, hitLimit} — and is inner dispatch running low or already at the harness spawn ceiling?"
// plugin/scripts/inner-agent-budget-report.ts — inner subagent 预算的可读产物采集器（inner 派发前写 / outer tick 读）
// (tasks/gap-inner-subagent-budget-invisible)
//
// Defect family: the harness per-session subagent spawn hard cap (200/200) is a SILENT ceiling on
// inner dispatch ability — no source-of-truth record existed in the repo and the three-layer
// execution cores wrote nothing about it. Evidence (manager 2026-08-10 third correction): inner
// session 728a4610's tool_result at 2026-08-10T05:13:13 verbatim
// "Subagent spawn limit reached (200 of 200 agents spawned)." — the exact moment of the last Agent
// dispatch (201 total). After the cap, inner can no longer spawn subagents ⇒ 0 in-flight ⇒ no
// <task-notification> ⇒ slot-refill never fires ⇒ empty slots + full ready pool + "no dispatch" —
// morphologically identical to every mechanism defect, and it misdiagnosed for hours that night.
// Per C17 (rules need PRODUCTS, not visibility): "whether the budget is exhausted" needs a
// mechanically-readable product, or a hard ceiling stays invisible.
//
// Fix (the MECHANISM is the fix — NOT raising the env cap, which just postpones the same silent
// failure to 33 days later): inner runs this BEFORE each dispatch decision. It counts Agent
// tool_use dispatches from the session transcript (the "readable API" for the LIMIT is the
// CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION env var, default 200; the SPENT count is measured by Agent
// counting — the documented fallback), detects the harness spawn-limit signal
// ("Subagent spawn limit reached") in the transcript, and writes `<root>/.quay/inner-agent-budget.json`
// ({spawned, limit, lastSpawnAt, hitLimit}). The OUTER tick reads that product and escalates on
// hitLimit / budget-near — turning "silently lost dispatch ability" into "触顶即报".
//
// Two surfaces on one script (mirrors inner-wakeup-heartbeat-check.ts's product-reader role):
//   default (no --read) — INNER pre-dispatch budget check: count + write product + verdict.
//   --read              — OUTER tick reader: read the existing product + judge (escalate on near/hit).
//
// Pure functions exported for hermetic tests; the CLI wires transcript read → product write + verdict.
//
// Usage:
//   node --experimental-strip-types inner-agent-budget-report.ts [--root <dir>] [--session <path>]
//        [--limit <N>] [--near-fraction <F>] [--json]        # inner pre-dispatch: count + write
//   node --experimental-strip-types inner-agent-budget-report.ts --read [--root <dir>]
//        [--near-fraction <F>] [--json]                      # outer tick: read product + judge
//
// Exit: 0 = OK (or MISSING in --read — no data yet, not an escalation)
//       1 = escalate (NEAR budget 将尽 / HIT spawned ≥ limit or spawn-limit signal / MALFORMED)
//       2 = usage error / transcript file missing / session undetected.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { detectSession, findRepoRoot, parseLine } from "./inner-exec-mode-report.ts";

/** Budget product file name under `<root>/.quay/`. */
export const BUDGET_FILE = "inner-agent-budget.json";

/** Harness default per-session subagent spawn cap (v2.1.212, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`). */
export const DEFAULT_SUBAGENT_LIMIT = 200;

/** Near-exhaustion threshold: spawned / limit >= this ⇒ escalate "预算将尽" (Contract band 接近 limit 时升级). */
export const DEFAULT_NEAR_FRACTION = 0.8;

/** Harness spawn-limit signal (verbatim evidence, 2026-08-10T05:13:13 inner session 728a4610). */
export const SPAWN_LIMIT_SIGNAL = "Subagent spawn limit reached";

/** Sentinel for a product file that exists but does not parse / lacks the required shape. */
export const MALFORMED = Object.freeze({ __malformed__: true });

/**
 * Resolve the session subagent cap: env var `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` wins (this is
 * the "readable API" for the limit — task AC2「可读则用」), else the harness default 200. PURE.
 */
export function resolveLimit(env = process.env, explicit = undefined) {
  if (explicit !== undefined) {
    const n = Number(explicit);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  const raw = env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION;
  if (raw !== undefined && raw !== null && /^\d+$/.test(String(raw).trim())) {
    return parseInt(String(raw).trim(), 10);
  }
  return DEFAULT_SUBAGENT_LIMIT;
}

/**
 * Count Agent dispatches + last dispatch time + spawn-limit hit from a transcript record array.
 * PURE — no I/O. Reuses `parseLine` from inner-exec-mode-report.ts for record normalization.
 *
 * @param {Array<object|null>} records
 * @param {{limit: number, rawText?: string}} opts rawText = full transcript text (belt-and-suspenders
 *   signal scan — the spawn-limit tool_result may nest its string at any depth).
 * @returns {{spawned:number, lastSpawnAt:number|null, lastSpawnAtIso:string|null, hitLimit:boolean, limit:number}}
 */
export function analyzeAgentBudget(records, { limit, rawText = "" } = {}) {
  let spawned = 0;
  let lastSpawnAt = null; // epoch ms (last Agent tool_use dispatch timestamp)
  // Agent tool_use ids — a real harness spawn-limit error surfaces as the tool_RESULT of an Agent
  // call. Collect every Agent call's id first, so the signal scan below can match BY POSITION
  // (硬规则 2: 注释/任务体引用/user 消息里的同一串不算命中 — manager 2026-08-10 11:4x 实测:
  // 任务 gap-inner-subagent-budget-invisible 为留证逐字引用了 05:13:13 原文, 该引用进入 inner
  // transcript 后被裸 includes 误判为触顶, 而真实 Agent 计数 18/200).
  const agentCallIds = new Set();
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const tsMs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
    const ts = Number.isFinite(tsMs) ? tsMs : null;
    const content = rec.message && typeof rec.message === "object" ? rec.message.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const blk of content) {
      if (!blk || typeof blk !== "object") continue;
      if (blk.type === "tool_use" && blk.name === "Agent") {
        spawned++;
        if (blk.id) agentCallIds.add(blk.id);
        if (ts !== null && (lastSpawnAt === null || ts > lastSpawnAt)) lastSpawnAt = ts;
      }
    }
  }
  // POSITION-BASED signal scan: the spawn-limit string counts ONLY when it appears in a tool_result
  // whose tool_use_id matches an Agent call (the real harness error return). Task-body quotes /
  // user messages / assistant text that merely mention the string do NOT count (硬规则 2,
  // drive-contract-check "by POSITION, never by keyword"; test-framework-policy-check
  // "strings that merely mention it do not count" — 同一手法).
  let hitBySignal = false;
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const content = rec.message && typeof rec.message === "object" ? rec.message.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const blk of content) {
      if (!blk || typeof blk !== "object" || blk.type !== "tool_result") continue;
      if (!blk.tool_use_id || !agentCallIds.has(blk.tool_use_id)) continue;
      const text = typeof blk.content === "string" ? blk.content : JSON.stringify(blk.content || "");
      if (text.includes(SPAWN_LIMIT_SIGNAL)) { hitBySignal = true; break; }
    }
    if (hitBySignal) break;
  }
  const hitByCount = spawned >= limit;
  return {
    spawned,
    lastSpawnAt: lastSpawnAt !== null ? Math.floor(lastSpawnAt / 1000) : null,
    lastSpawnAtIso: lastSpawnAt !== null ? new Date(lastSpawnAt).toISOString() : null,
    hitLimit: hitBySignal || hitByCount,
    limit,
  };
}

/**
 * Serialize the budget product exactly to the documented schema {spawned, limit, lastSpawnAt, hitLimit}
 * (Contract measure reads d['spawned'] / d['limit'] / d['hitLimit']). PURE.
 */
export function serializeBudget(budget) {
  return JSON.stringify({
    spawned: budget.spawned,
    limit: budget.limit,
    lastSpawnAt: budget.lastSpawnAt,
    hitLimit: budget.hitLimit,
  });
}

/**
 * Parse the budget product text. PURE.
 * @param {string|null|undefined} text
 * @returns {object|null|MALFORMED} parsed object · null when missing/empty · MALFORMED when unparsable/invalid shape.
 */
export function parseBudget(text) {
  if (text == null || String(text).trim() === "") return null;
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return MALFORMED;
  }
  if (
    v && typeof v === "object" &&
    typeof v.spawned === "number" && Number.isFinite(v.spawned) &&
    typeof v.limit === "number" && Number.isFinite(v.limit) &&
    (v.lastSpawnAt === null || (typeof v.lastSpawnAt === "number" && Number.isFinite(v.lastSpawnAt))) &&
    typeof v.hitLimit === "boolean"
  ) {
    return v;
  }
  return MALFORMED;
}

/**
 * Judge the budget. PURE.
 * @param {number} nowSec epoch-seconds "now" (only used for the near/hit read-out; hit is mechanical).
 * @param {object|null|MALFORMED} budget parseBudget output
 * @param {{nearFraction?: number}} [opts]
 * @returns {{ok:boolean, status:"ok"|"near"|"hit"|"missing"|"malformed", remaining:number|null,
 *            reason:string, hitLimit:boolean}}
 */
export function judgeBudget(nowSec, budget, { nearFraction = DEFAULT_NEAR_FRACTION } = {}) {
  if (budget === MALFORMED) {
    return { ok: false, status: "malformed", remaining: null, reason: "inner-agent-budget-malformed", hitLimit: false };
  }
  if (budget == null) {
    // Missing product = inner has not written a budget record yet (no dispatch decision made).
    // Absence is NOT an escalation for the OUTER reader — report as no-data.
    return { ok: true, status: "missing", remaining: null, reason: "inner-agent-budget-missing", hitLimit: false };
  }
  const remaining = budget.limit - budget.spawned;
  if (budget.hitLimit || budget.spawned >= budget.limit) {
    return {
      ok: false,
      status: "hit",
      remaining,
      reason: "inner-agent-budget-hit",
      hitLimit: true,
    };
  }
  if (budget.limit > 0 && budget.spawned / budget.limit >= nearFraction) {
    return {
      ok: false,
      status: "near",
      remaining,
      reason: "inner-agent-budget-near",
      hitLimit: false,
    };
  }
  return { ok: true, status: "ok", remaining, reason: "inner-agent-budget-ok", hitLimit: false };
}

/** Read the budget product text under `<root>/.quay/`. Returns null when missing. */
export function readBudgetText(root) {
  const p = path.join(root || ".", ".quay", BUDGET_FILE);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

/** Write the budget product under `<root>/.quay/` (mkdir -p then write). */
export function writeBudget(root, budget) {
  const dir = path.join(root || ".", ".quay");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, BUDGET_FILE), serializeBudget(budget), "utf8");
}

/** Read a transcript file, tolerating malformed lines (reuses inner-exec-mode-report's loadTranscript pattern). */
export function loadTranscript(sessionPath) {
  const raw = fs.readFileSync(sessionPath, "utf8");
  return raw.split("\n").map(parseLine);
}

function usage() {
  console.error(`inner-agent-budget-report.ts — inner subagent 预算产物（inner 派发前写 / outer tick 读）

Defect (tasks/gap-inner-subagent-budget-invisible): the harness per-session subagent spawn hard cap
(${DEFAULT_SUBAGENT_LIMIT}/${DEFAULT_SUBAGENT_LIMIT}) is a SILENT ceiling — at 200/200 inner can no longer spawn
subagents ⇒ 0 in-flight ⇒ no <task-notification> ⇒ slot-refill never fires ⇒ "empty slots + full ready
pool + no dispatch", morphologically identical to a mechanism defect (empirically misdiagnosed hours
on 2026-08-10). Fix = the MECHANISM (pre-dispatch budget read + escalate on limit), not raising the cap.

Default (inner pre-dispatch): counts Agent tool_use from the session transcript, detects the spawn-limit
signal, writes <root>/.quay/${BUDGET_FILE} ({spawned, limit, lastSpawnAt, hitLimit}), and reports a verdict.
--read (outer tick): reads that product and judges (escalate on NEAR/HIT/MALFORMED).

Usage:
  --root <dir>           workspace root (default: auto-detected) — product lives at <root>/.quay/${BUDGET_FILE}
  --session <path>       transcript JSONL (default: auto-detect current repo session)
  --limit <N>            session subagent cap override (default: env CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION, then ${DEFAULT_SUBAGENT_LIMIT})
  --near-fraction <F>    near-exhaustion threshold spawned/limit (default ${DEFAULT_NEAR_FRACTION})
  --read                 read the existing product and judge (outer tick surface), no transcript I/O
  --json                 JSON output (default human-readable)

Exit: 0 = OK / MISSING(no data) · 1 = escalate (NEAR / HIT / MALFORMED) · 2 = usage / transcript missing`);
}

function emit(out, json, humanLines) {
  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const l of humanLines) console.log(l);
  }
}

export function main(argv = process.argv) {
  const args = argv.slice(2);
  const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const has = (name) => args.includes(name);
  const readMode = has("--read");
  const json = has("--json");

  if (has("--help") || has("-h")) { usage(); return 2; }

  const root = get("--root") ? path.resolve(get("--root")) : findRepoRoot();
  const nearFractionRaw = get("--near-fraction");
  const nearFraction = nearFractionRaw !== undefined ? Number(nearFractionRaw) : DEFAULT_NEAR_FRACTION;
  if (!Number.isFinite(nearFraction) || nearFraction <= 0 || nearFraction > 1) {
    console.error("inner-agent-budget-report: --near-fraction must be in (0, 1]");
    return 2;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const budgetPath = path.join(root, ".quay", BUDGET_FILE);

  if (readMode) {
    const text = readBudgetText(root);
    const budget = parseBudget(text);
    const v = judgeBudget(nowSec, budget, { nearFraction });
    const base = { file: budgetPath, generatedAt: new Date().toISOString(), nowSec, nearFraction };
    if (v.status === "missing") {
      emit(
        { ...base, verdict: "OK", status: "missing", remaining: null, hitLimit: false, reason: v.reason },
        json,
        [`inner-agent-budget: MISSING — ${budgetPath} (inner has not written a budget record yet; no data, no escalation)`],
      );
      return 0;
    }
    if (json) {
      emit({ ...base, verdict: v.ok ? "OK" : "ESCALATE", status: v.status, remaining: v.remaining, hitLimit: v.hitLimit, reason: v.reason, budget }, json, []);
    } else {
      if (v.status === "hit") {
        console.log(`inner-agent-budget: HIT — spawned ≥ limit / spawn-limit signal ⇒ inner subagent 预算触顶，升级 (remaining ${v.remaining})`);
      } else if (v.status === "near") {
        console.log(`inner-agent-budget: NEAR — spawned/limit ≥ ${nearFraction} ⇒ 预算将尽，升级预警 (remaining ${v.remaining})`);
      } else if (v.status === "malformed") {
        console.log(`inner-agent-budget: MALFORMED — ${budgetPath} unreadable ⇒ 升级 (fail-closed)`);
      } else {
        console.log(`inner-agent-budget: OK — spawned ${budget.spawned} < limit ${budget.limit}, remaining ${v.remaining}`);
      }
    }
    return v.ok ? 0 : 1;
  }

  // Inner pre-dispatch surface: count from the transcript + write the product.
  const sessionArg = get("--session");
  let sessionPath = sessionArg ? path.resolve(sessionArg) : undefined;
  if (sessionPath) {
    if (!fs.existsSync(sessionPath)) {
      console.error(`inner-agent-budget-report: --session 文件不存在: ${sessionPath}`);
      return 2;
    }
  } else {
    sessionPath = detectSession(root);
    if (!sessionPath) {
      const out = {
        file: budgetPath,
        generatedAt: new Date().toISOString(),
        status: "error",
        reason: "no session transcript detected",
        error: "no session transcript detected",
      };
      emit(out, json, ["inner-agent-budget: ERROR — no session transcript detected under ~/.claude/projects (pass --session)"]);
      return 2;
    }
  }

  const limit = resolveLimit(process.env, get("--limit"));
  const records = loadTranscript(sessionPath);
  const rawText = fs.readFileSync(sessionPath, "utf8");
  const budget = analyzeAgentBudget(records, { limit, rawText });
  writeBudget(root, budget);

  const v = judgeBudget(nowSec, budget, { nearFraction });
  const base = {
    file: budgetPath,
    session: sessionPath,
    generatedAt: new Date().toISOString(),
    nowSec,
    spawned: budget.spawned,
    limit: budget.limit,
    lastSpawnAt: budget.lastSpawnAt,
    lastSpawnAtIso: budget.lastSpawnAtIso,
    hitLimit: budget.hitLimit,
    remaining: v.remaining,
    status: v.status,
    nearFraction,
  };
  if (json) {
    emit(base, json, []);
  } else {
    if (v.status === "hit") {
      console.log(`inner-agent-budget: HIT — ${budget.spawned}/${budget.limit} (spawn-limit signal: ${budget.hitLimit}) ⇒ 触顶，升级，停止派发`);
    } else if (v.status === "near") {
      console.log(`inner-agent-budget: NEAR — ${budget.spawned}/${budget.limit} ≥ ${nearFraction} ⇒ 预算将尽，升级预警`);
    } else {
      console.log(`inner-agent-budget: OK — ${budget.spawned}/${budget.limit} (remaining ${v.remaining})`);
    }
    if (budget.lastSpawnAtIso) console.log(`lastSpawnAt: ${budget.lastSpawnAtIso}`);
    console.log(`product: ${budgetPath}`);
  }
  return v.ok ? 0 : 1;
}

// 直接运行入口（import 时不执行）。
if (isDirectEntry(import.meta)) {
  process.exitCode = main();
}
