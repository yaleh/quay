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
//   required AC53 dispatch-state (gap-inner-self-wake-sleep-empty-slots-not-dispatch AC1): slots_free /
//     dispatchable_disjoint / pool / should_refill / no_refill_reason — recorded at the moment
//     delaySeconds is chosen so the record distinguishes "nothing dispatchable" from "dispatchable
//     but didn't dispatch" (the AC2 end-invariant judges on these; absent = 未查 ≠ 无货).
//   supplemental: agentLimit (semantic-observer-judge heuristic), budgetCritical (manager A3),
//     reason (free-text prose — may SUPPLEMENT but never REPLACE the structured fields, AC3)
// AC3 (追加式 jsonl): the write APPENDS one JSON record per line to HEARTBEAT_FILE (reviewable
//   history) and mirrors the last record to LEGACY_HEARTBEAT_FILE (pre-AC53 readers keep working).
// END-INVARIANT GATE (gap-ac53-end-invariant-gate AC1/AC2): before an END-of-tick write the writer
//   re-runs slot-refill with DIRECT measurements (--in-flight = this session's in-flight set, from
//   disk/worktree — NOT the heartbeat's self-report) and REFUSES the write (exit non-zero,
//   reason=end-invariant-violated) when the DIRECT result says `should_refill ∧ slots_free>0 ∧
//   dispatchable_disjoint>0 ∧ no_refill_reason 空`. The 7th same-shape proved recording a reason does
//   not stop the sleep — only a structural refusal does: there is NO LEGAL EXIT to sleep while
//   dispatchable work waits. The DIRECT measurement's five dispatch-state keys are what gets written.
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-wakeup-heartbeat.ts \
//     --blocked '<json array>' --run-ids '<json array>' \
//     --effective-cap <n> --agent-dispatches <n> --budget-hit <true|false> \
//     --in-flight '<id1,id2>' [--agent-limit <n>] [--budget-critical <true|false>] [--delay-seconds <n>] \
//     [--reason <text>] [--root <dir>] [--json]
//
// Exit: 0 = written · 1 = refused (missing/wrong-type required field, or END-INVARIANT violation —
//   the tick must NOT sleep while dispatchable work waits; nothing written) · 2 = usage error.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// Single source of truth for the minimal field contract + the AC53 dispatch-state contract: the
// checker defines them, the writer enforces both.
import {
  HEARTBEAT_FILE,
  LEGACY_HEARTBEAT_FILE,
  REQUIRED_HEARTBEAT_FIELDS,
  REQUIRED_DISPATCH_STATE_FIELDS,
  checkFieldContract,
  checkDispatchStateContract,
  judgeEndInvariant,
  INVARIANT_VIOLATED_REASON,
} from "./inner-wakeup-heartbeat-check.ts";
// AC53 AC1 (gap-ac53-end-invariant-gate): the writer re-runs slot-refill with DIRECT measurements
// (--in-flight = this session's in-flight set) before an END-of-tick heartbeat write — the DIRECT
// result is the end-invariant judge, never the heartbeat's self-report.
import { analyzeSlotRefill, FIXED_DISPATCH_CAP } from "./slot-refill.ts";

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
  // AC53 (gap-inner-self-wake-sleep-empty-slots-not-dispatch) AC1: the five dispatch-state keys
  // recorded at the moment delaySeconds is chosen. Optional here so pure construction stays explicit;
  // the writer's fail-closed gate REFUSES a heartbeat missing them (a record that cannot distinguish
  // "nothing dispatchable" from "dispatchable but didn't dispatch" is the exact defect this task
  // fixes).
  slotsFree,
  dispatchableDisjoint,
  pool,
  shouldRefill,
  noRefillReason,
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
  if (slotsFree !== undefined) hb.slots_free = slotsFree;
  if (dispatchableDisjoint !== undefined) hb.dispatchable_disjoint = dispatchableDisjoint;
  if (pool !== undefined) hb.pool = pool;
  if (shouldRefill !== undefined) hb.should_refill = shouldRefill;
  if (noRefillReason !== undefined) hb.no_refill_reason = noRefillReason;
  return hb;
}

/** AC53 AC3: append-only write — one JSON record per line to the jsonl, plus a mirror of the LAST
 *  record to the legacy `.json` snapshot (kept so pre-AC53 readers — e.g. the semantic-observer
 *  judge, whose default path is `<root>/.quay/<layer>-wakeup-heartbeat.json` — keep working).
 *  Returns the jsonl path. */
export function writeHeartbeat(root, heartbeat) {
  const quayDir = path.join(root || ".", ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  const jsonlPath = path.join(quayDir, HEARTBEAT_FILE);
  // Append one compact JSON line (append-only history is the reviewable record).
  fs.appendFileSync(jsonlPath, `${JSON.stringify(heartbeat)}\n`, "utf8");
  // Mirror the last record to the legacy snapshot (last-write-wins, atomic temp+rename).
  const legacyPath = path.join(quayDir, LEGACY_HEARTBEAT_FILE);
  const tmpPath = `${legacyPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(heartbeat, null, 2), "utf8");
  fs.renameSync(tmpPath, legacyPath);
  return jsonlPath;
}

/**
 * AC53 AC1 (gap-ac53-end-invariant-gate): re-run slot-refill with DIRECT measurements before an
 * END-of-tick heartbeat write. `--in-flight` is this session's in-flight set (the tick's own
 * maintained set — from disk/worktree, NOT the heartbeat's self-report). The DIRECT result is the
 * judge: if it says `should_refill=true` (free slots + a step-4-dispatchable candidate + no
 * mechanism reason not to refill), the tick has NO LEGAL EXIT — refusing to write forces the caller
 * back to dispatch (gap-ac53-end-invariant-gate: the 7th same-shape proved recording a reason does
 * not stop the sleep; only a structural refusal does).
 * Fail-closed: a slot-refill error ⇒ { ok:false } (cannot verify ⇒ cannot write). PURE-reader reuse
 * of analyzeSlotRefill (never writes, never dispatches, never advances a counter).
 * @param {object} o
 * @param {string} o.root workspace root (the <root>/tasks store)
 * @param {string[]} o.inFlightIds the session's in-flight task ids (comma-separated --in-flight)
 * @param {number} [o.cap] dispatch cap — default FIXED_DISPATCH_CAP (5), the tick's effective cap
 * @returns {{ok:true, refill:object}|{ok:false, error:string}}
 */
export function runDirectSlotRefill({ root, inFlightIds, cap = FIXED_DISPATCH_CAP }) {
  const rootDir = root || ".";
  const tasksDir = path.join(rootDir, "tasks");
  const readTasks = (ids) => {
    const out = [];
    for (const id of ids) {
      const file = path.join(tasksDir, `${id}.md`);
      if (!fs.existsSync(file)) continue; // advisory — a vanished id is not a failure
      out.push({ id, body: fs.readFileSync(file, "utf8") });
    }
    return out;
  };
  try {
    const refill = analyzeSlotRefill({
      tasksDir,
      root: rootDir,
      cap,
      inFlight: readTasks(inFlightIds),
      measurementSource: "explicit-input",
    });
    return { ok: true, refill };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function usage() {
  console.error(`inner-wakeup-heartbeat.ts — inner 兜底心跳写入方（结构化字段）

Appends one record per line to <root>/.quay/${HEARTBEAT_FILE} (AC53 AC3: 追加式 jsonl — 可回看) and
mirrors the last record to <root>/.quay/${LEGACY_HEARTBEAT_FILE} (kept for pre-AC53 readers, e.g. the
semantic-observer judge). Writes the FULL structured field set required by the minimal field contract
(${REQUIRED_HEARTBEAT_FIELDS.join("/")} — Contract band heartbeat_field_count >= 7) PLUS the AC53
dispatch-state five keys (${REQUIRED_DISPATCH_STATE_FIELDS.join("/")}).
FAIL-CLOSED: if a required field is missing/wrong-typed, the writer refuses and exits 1 — it can never
produce the 3-key shrunk heartbeat that broke manager A3, nor a heartbeat that cannot distinguish
"nothing dispatchable" from "dispatchable but didn't dispatch" (AC53 AC1). reason prose supplements,
never replaces (AC3).
END-INVARIANT GATE (gap-ac53-end-invariant-gate AC1/AC2): before an END-of-tick write the writer
re-runs slot-refill with DIRECT measurements (--in-flight = this session's in-flight set, from
disk/worktree — NOT the heartbeat's self-report). If the DIRECT result says
should_refill ∧ slots_free>0 ∧ dispatchable_disjoint>0 ∧ no_refill_reason 空, the write is REFUSED
(exit 1, reason=end-invariant-violated) and the caller must return to dispatch — there is NO LEGAL
EXIT to sleep while dispatchable work waits. The DIRECT measurement's five dispatch-state keys are
what gets written (authoritative over the args' self-report), so the record is always
mechanism-consistent. --in-flight is REQUIRED (omitted ⇒ fail-closed refuse).

Usage:
  --blocked '<json array>'       inner 阻塞信号列表（A3 判卡住的前提）— REQUIRED
  --run-ids '<json array>'       本轮派发/在飞 run id 列表 — REQUIRED
  --effective-cap <n>            inner 有效并发上限 — REQUIRED
  --agent-dispatches <n>         本轮派发计数 — REQUIRED
  --budget-hit <true|false>      预算是否触顶 — REQUIRED
  --in-flight '<id1,id2>'        AC53: 本会话在飞集合（结束心跳直接量判据用）— REQUIRED
  --delay-seconds <n>            ScheduleWakeup 重排间隔秒（default 1500）
  --slots-free <n>               AC53: 空槽数（slot-refill 输出）— REQUIRED
  --dispatchable-disjoint <n>    AC53: 池内最大互不冲突子集 — REQUIRED
  --pool <n>                     AC53: 就绪池数 — REQUIRED
  --should-refill <true|false>   AC53: 事件驱动 go/no-go（slot-refill 输出）— REQUIRED
  --no-refill-reason '<text>'    AC53: 不派发理由（null/空 = 有货不派，结束不变式判红）— REQUIRED
  --agent-limit <n>              subagent 上限（semantic-observer-judge 启发式用）
  --budget-critical <true|false> 预算危急（manager A3 读）
  --reason <text>                free-text prose（可补充不可替代）
  --root <dir>                   workspace root（default: cwd）— writes <root>/.quay/${HEARTBEAT_FILE}
  --json                         print the written heartbeat as JSON

Exit: 0 written · 1 refused (missing/wrong-type required field, or END-INVARIANT violation — the
tick must NOT sleep while dispatchable work waits; nothing written) · 2 usage error`);
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
  let inFlightIds; // AC53 AC1 (gap-ac53-end-invariant-gate): the session's in-flight set
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
      // AC53 AC1: the five dispatch-state keys — REQUIRED at write time (fail-closed below).
      slotsFree: flagVal("--slots-free") !== undefined ? Number(flagVal("--slots-free")) : undefined,
      dispatchableDisjoint: flagVal("--dispatchable-disjoint") !== undefined ? Number(flagVal("--dispatchable-disjoint")) : undefined,
      pool: flagVal("--pool") !== undefined ? Number(flagVal("--pool")) : undefined,
      shouldRefill: flagVal("--should-refill") !== undefined ? flagVal("--should-refill") === "true" : undefined,
      // AC53: `--no-refill-reason null` / `--no-refill-reason ''` means "no reason written" ⇒ JS null
      // (the exact 有货不派 shape the AC2 end-invariant flags); any other text is the written reason.
      noRefillReason: flagVal("--no-refill-reason") !== undefined
        ? (flagVal("--no-refill-reason") === "null" || flagVal("--no-refill-reason") === "" ? null : flagVal("--no-refill-reason"))
        : undefined,
    });
    // AC53 AC1 (gap-ac53-end-invariant-gate): the session's in-flight set — REQUIRED so the writer
    // can re-run slot-refill with DIRECT measurements (from disk/worktree, not the heartbeat's
    // self-report). `--in-flight ''` = empty set (nothing in flight). Omitted ⇒ fail-closed refuse.
    const inFlightFlag = flagVal("--in-flight");
    inFlightIds = inFlightFlag !== undefined
      ? String(inFlightFlag).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
  } catch (e) {
    console.error(`inner-wakeup-heartbeat: ${e.message}`);
    return 2;
  }

  // Fail-closed: run the checker's own contract checks BEFORE writing. A shrunk heartbeat (missing
  // minimal keys) OR a heartbeat that cannot distinguish "nothing dispatchable" from "dispatchable
  // but didn't dispatch" (missing the AC53 five dispatch-state keys) is refused.
  const contract = checkFieldContract(heartbeat);
  if (!contract.ok) {
    const miss = [...contract.missing.map((f) => `${f}(缺失)`), ...contract.wrongType.map((f) => `${f}(类型错)`)]
      .join(" / ");
    console.error(`inner-wakeup-heartbeat: REFUSED — 心跳字段缺失，不写入（缺 ${miss}）`);
    return 1;
  }
  const dsContract = checkDispatchStateContract(heartbeat);
  if (!dsContract.ok) {
    const miss = [...dsContract.missing.map((f) => `${f}(缺失)`), ...dsContract.wrongType.map((f) => `${f}(类型错)`)]
      .join(" / ");
    console.error(`inner-wakeup-heartbeat: REFUSED — 派发状态五键缺失，不写入（缺 ${miss}）——记录必须能分清「没货可派」与「有货不派」（AC53 AC1）`);
    return 1;
  }

  // AC53 AC1 (gap-ac53-end-invariant-gate): before writing an END-of-tick heartbeat, re-run
  // slot-refill with DIRECT measurements (--in-flight = this session's in-flight set, from
  // disk/worktree — NOT the heartbeat's self-report). The DIRECT result is the end-invariant judge:
  // if it says `should_refill=true` (free slots + a step-4-dispatchable candidate + no mechanism
  // reason not to refill), the tick has NO LEGAL EXIT — the write is refused (exit non-zero) and the
  // caller must return to dispatch (fast-mode-tick-core.md B3). Recording a reason never suffices —
  // the 7th same-shape proved only a structural refusal stops the sleep.
  if (inFlightIds === undefined) {
    console.error(`inner-wakeup-heartbeat: REFUSED — --in-flight 必填（结束心跳的直接量判据需要本会话在飞集合），不写入（reason=end-invariant-gate-requires-in-flight）`);
    return 1;
  }
  // The direct re-run uses the SAME cap the tick recorded (--effective-cap; production default the
  // fixed 5, A10) so slots_free/dispatch verdicts are computed against the same cap the dispatch
  // decision used — never a second, inconsistent cap.
  const direct = runDirectSlotRefill({ root, inFlightIds, cap: heartbeat.effectiveCap ?? FIXED_DISPATCH_CAP });
  if (!direct.ok) {
    console.error(`inner-wakeup-heartbeat: REFUSED — slot-refill 直接量重跑失败，无法验证结束不变式，不写入（reason=end-invariant-gate-unverifiable; error=${direct.error}）`);
    return 1;
  }
  const directInv = judgeEndInvariant(direct.refill);
  if (directInv.violated) {
    const e = directInv.evidence;
    console.error(
      `inner-wakeup-heartbeat: REFUSED — 结束不变式违例，不写入（reason=${INVARIANT_VIOLATED_REASON}; ` +
      `should_refill=${e.should_refill} slots_free=${e.slots_free} dispatchable_disjoint=${e.dispatchable_disjoint} ` +
      `no_refill_reason=${JSON.stringify(e.no_refill_reason)}）——有货可派却要结束本轮，调度层必须回派发（无合法退出路径）`,
    );
    return 1;
  }
  // The DIRECT measurement is authoritative for the record: write ITS five dispatch-state keys (not
  // the args' self-report), so the written heartbeat is always consistent with the mechanism's
  // judgment and the outer checker never false-REDs a legitimate end.
  heartbeat.slots_free = direct.refill.slots_free;
  heartbeat.dispatchable_disjoint = direct.refill.dispatchable_disjoint;
  heartbeat.pool = direct.refill.pool;
  heartbeat.should_refill = direct.refill.should_refill;
  heartbeat.no_refill_reason = direct.refill.no_refill_reason;

  const finalPath = writeHeartbeat(root, heartbeat);
  if (jsonOut) {
    console.log(JSON.stringify({ file: finalPath, written: true, fieldCount: contract.fieldCount, heartbeat }, null, 2));
  } else {
    console.log(`inner-wakeup-heartbeat: written ${finalPath} (${contract.fieldCount} + ${REQUIRED_DISPATCH_STATE_FIELDS.length} dispatch-state fields)`);
  }
  return 0;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
