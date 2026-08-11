#!/usr/bin/env node
// inner-wakeup-heartbeat.ts — inner 兜底心跳写入方（结构化字段）
// (tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract)
//
// Defect family: 2026-08-11 05:20 the heartbeat writer (an inline python one-liner in the tick-core
// docs) silently shrank to {ts, delaySeconds, reason} — runIds/blocked/budgetHit/effectiveCap/
// agentDispatches all vanished. Manager A3's premise is that `.quay/inner-wakeup-heartbeat.json` is
// the ONLY product answering "what does inner need"; without blocked[] the outer cannot tell whether
// inner is stuck (hard rule 6: absent key = not-checked, ≠ no-block). The shrink was a silent
// regression of the structured shape into a one-line prose blob.
//
// Fix: a REAL writer script (the docs now invoke THIS instead of an inline python one-liner — single
// source of truth for the write shape). It writes the FULL structured field set, FAIL-CLOSED: it
// refuses to write a heartbeat that misses the checker's required fields (the writer runs the same
// checkFieldContract the checker uses, so a shrunk write is impossible by construction).
//
// Fields written:
//   required (Contract band heartbeat_field_count >= 7): ts / runIds / blocked / budgetHit /
//     effectiveCap / agentDispatches / delaySeconds
//   supplemental: agentLimit (semantic-observer-judge heuristic), budgetCritical (manager A3),
//     reason (free-text prose — may SUPPLEMENT but never REPLACE the structured fields, AC3)
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-wakeup-heartbeat.ts \
//     --blocked '<json array>' --run-ids '<json array>' \
//     --effective-cap <n> --agent-dispatches <n> --budget-hit <true|false> \
//     [--agent-limit <n>] [--budget-critical <true|false>] [--delay-seconds <n>] \
//     [--reason <text>] [--root <dir>] [--json]
//
// Exit: 0 = written · 1 = refused (missing/wrong-type required field — fail-closed, nothing written) · 2 = usage error.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// Single source of truth for the minimal field contract: the checker defines it, the writer enforces it.
import { HEARTBEAT_FILE, REQUIRED_HEARTBEAT_FIELDS, checkFieldContract } from "./inner-wakeup-heartbeat-check.ts";

/** Serialize a JSON arg (array / number / boolean) — arrays must be JSON-parseable. PURE. */
export function parseJsonArg(value, flagName) {
  if (value == null || value === "") throw new Error(`${flagName} requires a value`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${flagName} must be valid JSON (got: ${JSON.stringify(value)})`);
  }
}

/**
 * Build the heartbeat object from the provided structured fields. PURE.
 * ts is computed from nowSec (epoch-seconds). Required fields with no value are left ABSENT so
 * checkFieldContract can flag them (the writer then refuses to write — fail-closed).
 */
export function buildHeartbeat({
  nowSec,
  blocked,
  runIds,
  effectiveCap,
  agentDispatches,
  budgetHit,
  delaySeconds = 1500,
  agentLimit,
  budgetCritical,
  reason = "tick heartbeat",
}) {
  const hb = { ts: nowSec };
  if (runIds !== undefined) hb.runIds = runIds;
  if (blocked !== undefined) hb.blocked = blocked;
  if (budgetHit !== undefined) hb.budgetHit = budgetHit;
  if (effectiveCap !== undefined) hb.effectiveCap = effectiveCap;
  if (agentDispatches !== undefined) hb.agentDispatches = agentDispatches;
  if (delaySeconds !== undefined) hb.delaySeconds = delaySeconds;
  if (agentLimit !== undefined) hb.agentLimit = agentLimit;
  if (budgetCritical !== undefined) hb.budgetCritical = budgetCritical;
  if (reason !== undefined) hb.reason = reason;
  return hb;
}

/** Atomic write: temp file in the same dir then rename. Returns the final path. */
export function writeHeartbeat(root, heartbeat) {
  const quayDir = path.join(root || ".", ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  const finalPath = path.join(quayDir, HEARTBEAT_FILE);
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(heartbeat, null, 2), "utf8");
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

function usage() {
  console.error(`inner-wakeup-heartbeat.ts — inner 兜底心跳写入方（结构化字段）

Writes <root>/.quay/${HEARTBEAT_FILE} with the FULL structured field set required by the minimal field
contract (${REQUIRED_HEARTBEAT_FIELDS.join("/")} — Contract band heartbeat_field_count >= 7).
FAIL-CLOSED: if a required field is missing/wrong-typed, the writer refuses and exits 1 — it can never
produce the 3-key shrunk heartbeat that broke manager A3. reason prose supplements, never replaces
(AC3).

Usage:
  --blocked '<json array>'       inner 阻塞信号列表（A3 判卡住的前提）— REQUIRED
  --run-ids '<json array>'       本轮派发/在飞 run id 列表 — REQUIRED
  --effective-cap <n>            inner 有效并发上限 — REQUIRED
  --agent-dispatches <n>         本轮派发计数 — REQUIRED
  --budget-hit <true|false>      预算是否触顶 — REQUIRED
  --delay-seconds <n>            ScheduleWakeup 重排间隔秒（default 1500）
  --agent-limit <n>              subagent 上限（semantic-observer-judge 启发式用）
  --budget-critical <true|false> 预算危急（manager A3 读）
  --reason <text>                free-text prose（可补充不可替代）
  --root <dir>                   workspace root（default: cwd）— writes <root>/.quay/${HEARTBEAT_FILE}
  --json                         print the written heartbeat as JSON

Exit: 0 written · 1 refused (missing/wrong-type required field, nothing written) · 2 usage error`);
}

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { usage(); return 2; }
  const flagVal = (name, def) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : def;
  };
  const root = flagVal("--root", ".");
  const jsonOut = args.includes("--json");

  let heartbeat;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    heartbeat = buildHeartbeat({
      nowSec,
      blocked: flagVal("--blocked") !== undefined ? parseJsonArg(flagVal("--blocked"), "--blocked") : undefined,
      runIds: flagVal("--run-ids") !== undefined ? parseJsonArg(flagVal("--run-ids"), "--run-ids") : undefined,
      effectiveCap: flagVal("--effective-cap") !== undefined ? Number(flagVal("--effective-cap")) : undefined,
      agentDispatches: flagVal("--agent-dispatches") !== undefined ? Number(flagVal("--agent-dispatches")) : undefined,
      budgetHit: flagVal("--budget-hit") !== undefined ? flagVal("--budget-hit") === "true" : undefined,
      delaySeconds: flagVal("--delay-seconds") !== undefined ? Number(flagVal("--delay-seconds")) : undefined,
      agentLimit: flagVal("--agent-limit") !== undefined ? Number(flagVal("--agent-limit")) : undefined,
      budgetCritical: flagVal("--budget-critical") !== undefined ? flagVal("--budget-critical") === "true" : undefined,
      reason: flagVal("--reason"),
    });
  } catch (e) {
    console.error(`inner-wakeup-heartbeat: ${e.message}`);
    return 2;
  }

  // Fail-closed: run the checker's own contract check BEFORE writing. A shrunk heartbeat is refused.
  const contract = checkFieldContract(heartbeat);
  if (!contract.ok) {
    const miss = [...contract.missing.map((f) => `${f}(缺失)`), ...contract.wrongType.map((f) => `${f}(类型错)`)]
      .join(" / ");
    console.error(`inner-wakeup-heartbeat: REFUSED — 心跳字段缺失，不写入（缺 ${miss}）`);
    return 1;
  }

  const finalPath = writeHeartbeat(root, heartbeat);
  if (jsonOut) {
    console.log(JSON.stringify({ file: finalPath, written: true, fieldCount: contract.fieldCount, heartbeat }, null, 2));
  } else {
    console.log(`inner-wakeup-heartbeat: written ${finalPath} (${contract.fieldCount} fields)`);
  }
  return 0;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
