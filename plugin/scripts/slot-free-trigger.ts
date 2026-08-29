#!/usr/bin/env node
// slot-free-trigger.ts — 空槽不是事件的执行者（gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace）。
//
// ⛔ 退役（gap-retire-outer-monitors-after-reconciler）：外层 Monitor 挂载（冷启动 4b3）已移除——
// 「空槽出现」由 driver 协调循环接管（定时器地板 + 每趟 pass 现读 ready 池，SPEC §5.5），本脚本从
// 正确性依赖降级为优化。脚本本体保留（判定逻辑与测试仍在），只是不再由外层 Monitor 挂载。
//
// PROBLEM IT FIXES: `in_flight < cap ∧ dispatchable > 0` (a freed dispatch slot + a dispatchable
// candidate) only ever gets evaluated at the three-layer 20-25 min tick boundaries. When the tick
// wakes, there is always something that looks more urgent (red suite / fan-in conflict /
// needs-human), so refilling an empty slot is always LAST — and a missed refill leaves no trace
// (C17 shape: 守与不守在记录上不可区分). fast-mode B3 already says "完成通知就是派发触发器；tick 心跳只是
// 兜底" (the design intent was right), but the ONLY source that never misses a signal is a MONITOR
// event: it is pushed, it does not depend on anyone remembering to read it.
//
// REPRODUCED FIELD READING (AC1, manager 2026-08-11 04:2x + outer 复核 — the fixture): inner 心跳
// effectiveCap=5、runIds 只有 1 条 ⇒ 在飞 1、空槽 4；ready-pool-check --cap 5 报 pool=20
// dispatchable_disjoint=11；budgetHit=False、agentDispatches=18/200 ⇒ 不是 subagent 预算触顶。
// 触发器存在（<task-notification> 是 harness 原生事件）但醒来先 fan-in/写报告、三条必读
// （A11 ready-pool-check --apply / A12 slot-refill / A13 slots 遥测）零读数、不回填 ⇒ 缺的不是触发器，
// 是【醒来后的第一件事】。本触发器的条件 = `slots_free(空槽 4) > 0 ∧ dispatchable(可派 11) > 0`。
//
// THIS TRIGGER IS THE EXECUTOR that turns the slot-free CONDITION into an EVENT, modeled on
// suite-state-trigger.ts (the red-window auto-executor): a Monitor polls (~5s) the SAME state the
// tick docs already read, and when `in_flight < cap ∧ dispatchable > 0` it emits `SLOT-FREE` +
// appends `.quay/slot-free-events.jsonl`. The OUTER receives the event on its Monitor stream and
// immediately drives the inner to refill (not waiting for the 20-min tick); a missed refill is now
// attributable in the event log (C17 closure: 漏了留痕).
//
//   AC2 — slot-free-trigger: `in_flight<cap ∧ dispatchable>0` ⇒ `SLOT-FREE` event (Monitor push +
//         events.jsonl). The two sides of the condition are read from the EXISTING mechanisms (no
//         parallel copy):
//         · `in_flight < cap`  ← fast-mode-telemetry.ts --slots --cap <cap> --json: `slotsRemaining
//           > 0` — the RECONCILE-AWARE slot read (real in-flight + non-task subagents +
//           closed-but-live all occupy slots; brackets ≠ subagents, gap-telemetry-brackets-vs-
//           subagents-no-slot-visibility). This is the "inner 心跳 runIds" view the outer already
//           reads (orchestrator-tick-core A18 family).
//         · `dispatchable > 0` ← ready-pool-check.ts --cap <cap> --json: `dispatchable_disjoint
//           >= 1` — the ready pool's touch-disjoint dispatchable capacity (the SAME "可派 N" the
//           manager's field reading used).
//   AC3 — outer 接事件回填: the OUTER's Monitor stream receives SLOT-FREE and immediately drives the
//         inner to refill (event → drive < 5min, the Contract band); a missed refill stays
//         attributable in `.quay/slot-free-events.jsonl`.
//   AC4 — inner 醒来第一件事: the inner's task-notification wake runs A11/A12/A13 + refill BEFORE
//         fan-in/report (fast-mode-loop-tick.md「事件驱动派发（槽位回填）」).
//
// EXECUTOR, NOT DECISION-MAKER (AC2/AC4): this script only translates a state condition into an
// event — it does NOT decide WHICH task to dispatch (inner's slot-refill / §4 does), does NOT drive
// the inner (the OUTER does, via supervisor-deliver.sh), and introduces NO new scheduling source
// (cadence stays the outer cron; the trigger is Monitor event monitoring, same class as
// session-liveness / suite-state-trigger).
//
// State inputs (well-known positions):
//   · fast-mode-telemetry.ts --slots --cap <cap> --json --root <root>  → { slotsRemaining,
//     realInFlight, subagentsInFlight, closedButLive, slotsTotal }
//   · ready-pool-check.ts --cap <cap> --json --root <root>            → { dispatchable_disjoint,
//     pool, floor }  (run ONLY when slotsRemaining > 0 — the common full-slot poll stays cheap)
//
// Memo file (this script's last observation): <root>/.quay/slot-free-last.json — {free: bool} —
// keeps the transition detector across restarts so a cold-start-into-free fires immediately
// (the "empty slots missed without trace" shape must fire on mount, not at the next cron).
//
// Event log (append-only, measure hook): <root>/.quay/slot-free-events.jsonl
//   {"event":"SLOT-FREE","at":"<ISO>","slots_free":N,"dispatchable_disjoint":M,"effective_cap":C,
//    "in_flight_count":K,"should_refill":true}
//   —— Contract measure `slot_free_event_fired` (tail -1 的 stdout 含 SLOT-FREE) + invoke
//   `tail -3 .quay/slot-free-events.jsonl`.
//
// Usage (outer mounts Monitor in orchestrator-loop-tick.md 4b3; or --once in a tick/troubleshoot):
//   node --no-warnings --experimental-strip-types plugin/scripts/slot-free-trigger.ts \
//     [--once]                      # 跑一轮：读状态、检测转变、记录并打印事件（测试接缝 + tick 排障）
//     [--monitor]                   # Monitor 模式（默认）：每 --interval 秒跑一轮，事件打到 stdout
//     [--interval <sec>]            # Monitor 轮询间隔（默认 5）
//     [--cap <n>]                   # 并发上限（默认 FIXED_DISPATCH_CAP=5——动态 cap 已退休）
//     [--root <path>]               # 工作区根（测试接缝；默认仓库根）
//
// Exit: 0（正常）；只有不可解析的参数退出 1。槽位空闲不是错误——它就是要触发驱动的事件。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { FIXED_DISPATCH_CAP } from "./slot-refill.ts";
import { isDirectEntry } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TELEMETRY_CLI = path.join(__dirname, "fast-mode-telemetry.ts");
const POOL_CLI = path.join(__dirname, "ready-pool-check.ts");

function eventsPath(root: string): string {
  return path.join(root, ".quay", "slot-free-events.jsonl");
}
function memoPath(root: string): string {
  return path.join(root, ".quay", "slot-free-last.json");
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The reconcile-aware slot view — the "in_flight < cap" side of the condition. PURE. */
export interface SlotView {
  slotsRemaining: number;
  realInFlight: number;
  subagentsInFlight: number;
  closedButLive: unknown[];
  slotsTotal: number | null;
}

/** Parse `fast-mode-telemetry.ts --slots --json` stdout into the slot view. PURE. */
export function parseSlotsOutput(text: string): SlotView {
  const d = JSON.parse(text) as Record<string, unknown>;
  return {
    slotsRemaining: Number(d.slotsRemaining ?? 0),
    realInFlight: Number(d.realInFlight ?? 0),
    subagentsInFlight: Number(d.subagentsInFlight ?? 0),
    closedButLive: Array.isArray(d.closedButLive) ? (d.closedButLive as unknown[]) : [],
    slotsTotal: d.slotsTotal == null ? null : Number(d.slotsTotal),
  };
}

/** The ready pool's dispatchable capacity — the "dispatchable > 0" side. PURE. */
export interface PoolView {
  dispatchable_disjoint: number;
  pool: number;
}

/** Parse `ready-pool-check.ts --cap <n> --json` stdout into the pool view. PURE. */
export function parsePoolOutput(text: string): PoolView {
  const d = JSON.parse(text) as Record<string, unknown>;
  return {
    dispatchable_disjoint: Number(d.dispatchable_disjoint ?? 0),
    pool: Number(d.pool ?? 0),
  };
}

/**
 * The SLOT-FREE condition, pure: `in_flight < cap ∧ dispatchable > 0` (the task's AC2 phrasing).
 */
export function evaluateSlotFree(slotsRemaining: number, dispatchableDisjoint: number): boolean {
  return slotsRemaining > 0 && dispatchableDisjoint >= 1;
}

/** Pure transition detector: false→true (or first-seen-true) fires SLOT-FREE. */
export function detectSlotFreeEvent(prevFree: boolean | null, nextFree: boolean): "SLOT-FREE" | null {
  if (prevFree === nextFree) return null; // stays free / stays full — no transition
  if (nextFree) return "SLOT-FREE"; // false→true OR first-seen-true (cold-start-into-free)
  return null; // true→false (slot filled) is calm — no event
}

/** The per-poll state this trigger observes. */
export interface SlotFreeInput {
  slotsRemaining: number;
  dispatchable_disjoint: number;
  effectiveCap: number;
  realInFlight: number;
  subagentsInFlight: number;
  closedButLiveCount: number;
}

/** The SLOT-FREE event payload (events.jsonl line + Monitor stream line). */
export interface SlotFreeEvent {
  event: "SLOT-FREE";
  at: string; // ISO 8601 — measure hook: event.at → outer drive timestamp (Contract band < 5min)
  slots_free: number;
  dispatchable_disjoint: number;
  effective_cap: number;
  in_flight_count: number; // realInFlight + subagentsInFlight — the reconcile-aware in-flight
  should_refill: boolean; // == free — consumers reading slot-refill's vocabulary
}

/**
 * Read the current slot-free state by invoking the EXISTING mechanisms (subprocesses). The
 * ready-pool-check read is DEFERRED until a slot is actually free — the common full-slot poll pays
 * only the cheap `--slots` read (fast-mode-telemetry --slots is sub-second; ready-pool-check is
 * git-heavy and only needed when there is something to report). Any read failure returns null
 * (the poll is skipped — a notifier must never crash the Monitor loop).
 */
export function readSlotState(root: string, cap: number): SlotFreeInput | null {
  const slotsArgs = [
    "--no-warnings", "--experimental-strip-types", TELEMETRY_CLI,
    "--slots", "--cap", String(cap), "--json", "--root", root,
  ];
  const slotsRun = spawnSync(process.execPath, slotsArgs, { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
  if (slotsRun.status !== 0) return null;
  let slots: SlotView;
  try {
    slots = parseSlotsOutput(slotsRun.stdout);
  } catch {
    return null;
  }
  let dispatchable = 0;
  if (slots.slotsRemaining > 0) {
    const poolArgs = [
      "--no-warnings", "--experimental-strip-types", POOL_CLI,
      "--cap", String(cap), "--json", "--root", root,
    ];
    const poolRun = spawnSync(process.execPath, poolArgs, { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
    if (poolRun.status === 0) {
      try {
        dispatchable = parsePoolOutput(poolRun.stdout).dispatchable_disjoint;
      } catch {
        dispatchable = 0;
      }
    }
  }
  return {
    slotsRemaining: slots.slotsRemaining,
    dispatchable_disjoint: dispatchable,
    effectiveCap: cap,
    realInFlight: slots.realInFlight,
    subagentsInFlight: slots.subagentsInFlight,
    closedButLiveCount: slots.closedButLive.length,
  };
}

/**
 * Record one SLOT-FREE event to the append-only log + return it (measure hook). 写日志不是「决策」——
 * 它是「槽位空闲」这个事实的记录，处置（驱动 inner 回填）由外层既有 B9 空槽强制链做。写失败只回落到
 * 「事件仍返回给调用方（可打印）但不落盘」，绝不 crash——触发者是通知者，不是闸（同 suite-state-trigger
 * 的 fail-open 原则）。
 */
export function recordSlotFreeEvent(root: string, input: SlotFreeInput): SlotFreeEvent | null {
  const ev: SlotFreeEvent = {
    event: "SLOT-FREE",
    at: new Date().toISOString(),
    slots_free: input.slotsRemaining,
    dispatchable_disjoint: input.dispatchable_disjoint,
    effective_cap: input.effectiveCap,
    in_flight_count: input.realInFlight + input.subagentsInFlight,
    should_refill: true,
  };
  try {
    fs.mkdirSync(path.dirname(eventsPath(root)), { recursive: true });
    fs.appendFileSync(eventsPath(root), JSON.stringify(ev) + "\n", "utf8");
  } catch {
    // log write failure does not block the event (still notified via stdout); never crash the Monitor.
  }
  return ev;
}

export interface RunOnceResult {
  free: boolean;
  events: SlotFreeEvent[];
  state: SlotFreeInput | null;
}

/**
 * 跑一轮：读槽位状态 → 与记忆比较 → 记录转变事件 → 更新记忆。
 * 冷启动即空闲（无记忆文件，prev=null）：也记一条——外层 /clear 后重启时空槽仍在，正是
 * 「空槽漏回填不留痕」要消灭的形态，必须一挂上就触发，而不是等下一次 cron。
 * opts.state 可注入（测试接缝——hermetic 单测不跑真 subprocess）；缺省则 readSlotState。
 */
export function runOnce(root: string, opts?: { state?: SlotFreeInput; cap?: number }): RunOnceResult {
  const memo = readJson<{ free: boolean }>(memoPath(root));
  const prev: boolean | null = memo?.free ?? null;
  const state = opts?.state ?? readSlotState(root, opts?.cap ?? FIXED_DISPATCH_CAP);
  if (!state) return { free: false, events: [], state: null }; // read failure — skip this poll
  const free = evaluateSlotFree(state.slotsRemaining, state.dispatchable_disjoint);

  const events: SlotFreeEvent[] = [];
  if (detectSlotFreeEvent(prev, free)) {
    const ev = recordSlotFreeEvent(root, state);
    if (ev) events.push(ev);
  }

  try {
    fs.mkdirSync(path.dirname(memoPath(root)), { recursive: true });
    fs.writeFileSync(memoPath(root), JSON.stringify({ free }, null, 2) + "\n", "utf8");
  } catch {
    // memo write failure does not block this poll (next poll re-compares — at worst one extra event).
  }

  return { free, events, state };
}

function formatEventLine(ev: SlotFreeEvent): string {
  return (
    `${ev.event} slots_free=${ev.slots_free} dispatchable_disjoint=${ev.dispatchable_disjoint} ` +
    `effective_cap=${ev.effective_cap} in_flight_count=${ev.in_flight_count} at=${ev.at}`
  );
}

async function runMonitor(root: string, intervalMs: number, cap: number): Promise<number> {
  // 首轮先跑一次（建立基线/冷启动即空闲的立即触发），随后按间隔轮询。
  for (;;) {
    const { events } = runOnce(root, { cap });
    for (const ev of events) {
      // stdout 是外层 Monitor 的事件流 → 立即推送（不等 20 分钟 cron）
      console.log(formatEventLine(ev));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export async function run(argv: string[]): Promise<number> {
  const root = path.resolve(parseArg(argv, "--root") ?? REPO_ROOT);
  const interval = Number(parseArg(argv, "--interval") ?? "5");
  const capArg = parseArg(argv, "--cap");
  const cap = capArg !== undefined && Number.isFinite(Number(capArg)) && Number(capArg) > 0 ? Number(capArg) : FIXED_DISPATCH_CAP;

  if (argv.includes("--monitor") || !argv.includes("--once")) {
    const intervalMs = Number.isFinite(interval) && interval > 0 ? interval * 1000 : 5000;
    return runMonitor(root, intervalMs, cap);
  }

  // --once：跑一轮（测试接缝 + tick/排障）
  const { free, events, state } = runOnce(root, { cap });
  console.log(`SLOT-STATUS free=${free}`);
  for (const ev of events) {
    console.log(formatEventLine(ev));
  }
  if (state) {
    console.log(`slots_free=${state.slotsRemaining} dispatchable_disjoint=${state.dispatchable_disjoint} effective_cap=${state.effectiveCap}`);
  }
  return 0;
}

// 测试辅助：读事件日志。
export function readSlotFreeEvents(root: string): SlotFreeEvent[] {
  try {
    return fs
      .readFileSync(eventsPath(root), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SlotFreeEvent);
  } catch {
    return [];
  }
}

if (isDirectEntry(import.meta)) {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
}
