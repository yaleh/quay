#!/usr/bin/env node
// suite-state-trigger.ts — 红窗规则的自动执行者（gap-red-window-has-no-automatic-executor）。
//
// 背景（管理者活实况 2026-08-05 ROUND 2）：套件转红且无人处置——`.quay/full-suite-state.json` 是
// state=red（早期 RED 生效，这是 (a) 块设计的行为），但红窗规则要求的 RED 处置一步都没执行，因为
// BOTH 分支（RED → stop-dispatch + 分诊；GREEN/RUNNING → 乐观派发）都只靠 `*/20` cron 或人驱动。
// 「机制写好了但没有执行者」= 存在 ≠ 生效。
//
// 本条 = (a) 块（gap-full-suite-belongs-to-outer-background-above-3-min）的执行者层：把状态变化
// （state=red / state=running）自动转成动作（通知外层 / 驱动 inner 派发）。
//
//   AC1 — RED 自动触发：state 变 red 时立即发 SUITE-RED 事件（外层 Monitor 推送，不等下一次 cron），
//         并确认 stop-dispatch 信号在位（state=red 即信号——见 (a) 块 AC4）。
//   AC3 — RUNNING 乐观派发执行者：state 变 running 时发 SUITE-RUNNING 事件，外层据此按文档驱动 inner
//         照常派发（池有可派即派，不待轮）。
//   AC2/AC4 — 触发者是既有处置逻辑的执行者，不是新决策者：本脚本只做「状态变化 → 事件」的翻译与通知，
//         不做任何分诊/派发决策；分诊 = 外层既有「红窗分诊」（orchestrator-loop-tick.md 步骤 1b），
//         派发 = 内层既有 §4 规则。不引入新调度源——本脚本是 Monitor 事件监测（同 session-liveness），
//         节奏仍唯一（外层 `*/20` cron）。
//
// 状态文件（输入，well-known 位置）：<root>/.quay/full-suite-state.json
//   {state: running|green|red, runner, startedAt, finishedAt, durationMs, laneCount}
//   —— (a) 块的 full-suite-runner.ts 写它；本脚本只读。
//
// 记忆文件（本脚本自己的上次观测）：<root>/.quay/suite-state-last.json  —— 跨重启保持「上一个状态」，
//   使「冷启动即红」（外层 /clear 后重启、套件仍红）也能被检测为一次转变并触发 SUITE-RED。
//
// 事件日志（append-only，measure 钩子）：<root>/.quay/suite-state-events.jsonl
//   {"event":"SUITE-RED"|"SUITE-GREEN"|"SUITE-RUNNING","at":"<ISO>","early":<bool>,"stopSignal":<bool>,
//    "state":{...}} —— Contract measure `red_to_triage_ms` 的起点（SUITE-RED.at → 分诊启动）。
//
// 使用（外层挂 Monitor，冷启动步骤 4b2；或 tick / 排障里跑 --once）：
//   node --no-warnings --experimental-strip-types plugin/scripts/suite-state-trigger.ts \
//     [--once]                      # 跑一轮：读状态、检测转变、记录并打印事件（测试接缝 + tick 排障）
//     [--monitor]                   # Monitor 模式（默认）：每 --interval 秒跑一轮，把事件打到 stdout
//                                   #   （外层 Monitor 事件流 → 立即推送，不等 cron）
//     [--interval <sec>]            # Monitor 轮询间隔（默认 5，目标秒级）
//     [--root <path>]               # 工作区根（测试接缝；默认仓库根）
//
// Exit: 0（正常）；只有不可解析的参数退出 1。状态是 red 不是错误——它就是要触发处置的信号。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type SuiteStateValue = "running" | "green" | "red";

export interface SuiteState {
  state: SuiteStateValue;
  runner?: string;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  laneCount?: number;
}

export type SuiteEventKind = "SUITE-RED" | "SUITE-GREEN" | "SUITE-RUNNING";

export interface SuiteStateEvent {
  event: SuiteEventKind;
  at: string; // ISO 8601 — measure hook for red_to_triage_ms
  early: boolean; // red with finishedAt null = 早期 RED（(a) 块 AC2）
  stopSignal: boolean; // state=red IS the stop-dispatch signal（(a) 块 AC4）— 事件自带确认
  state: SuiteState | null;
}

export interface RunOnceResult {
  status: SuiteStateValue | "absent";
  events: SuiteStateEvent[];
  stopSignal: boolean;
}

/** AC1/AC3 纯转变检测器：上一个状态 → 下一个状态，产出一条套件状态事件（无转变 = null）。 */
export function detectSuiteEvent(
  prev: SuiteStateValue | null,
  next: SuiteStateValue,
): SuiteEventKind | null {
  if (prev === next) return null;
  if (next === "red") return "SUITE-RED";
  if (next === "running") return "SUITE-RUNNING";
  if (next === "green") return "SUITE-GREEN";
  return null;
}

function statePath(root: string): string {
  return path.join(root, ".quay", "full-suite-state.json");
}
function eventsPath(root: string): string {
  return path.join(root, ".quay", "suite-state-events.jsonl");
}
function memoPath(root: string): string {
  return path.join(root, ".quay", "suite-state-last.json");
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 读套件状态文件；缺文件（外层还没跑第一轮）= null，不是错误。 */
export function readSuiteState(root: string): SuiteState | null {
  return readJson<SuiteState>(statePath(root));
}

/**
 * 记录一条转变事件到 append-only 日志（measure 钩子）。无转变 = 不写，返回 null。
 * 写日志不是「决策」——它是状态变化的事实记录，处置决策由外层既有逻辑做（AC2/AC4）。
 * 写失败只回落到「事件仍返回给调用方（可打印）但不落盘」，绝不 crash——触发者是通知者，
 * 不是闸（同 session-liveness `sl_emit_shared` 的 fail-open 原则：调度角色不是安全检查）。
 */
export function recordTransition(
  root: string,
  prev: SuiteStateValue | null,
  nextState: SuiteState | null,
): SuiteStateEvent | null {
  if (!nextState) return null;
  const kind = detectSuiteEvent(prev, nextState.state);
  if (!kind) return null;
  const ev: SuiteStateEvent = {
    event: kind,
    at: new Date().toISOString(),
    early: nextState.state === "red" && nextState.finishedAt === null,
    stopSignal: nextState.state === "red",
    state: nextState,
  };
  try {
    fs.mkdirSync(path.dirname(eventsPath(root)), { recursive: true });
    fs.appendFileSync(eventsPath(root), JSON.stringify(ev) + "\n", "utf8");
  } catch {
    // 日志写失败不阻断触发（事件仍由 stdout 通知）；绝不 crash 调用方（runner/Monitor）。
  }
  return ev;
}

/**
 * 跑一轮：读状态 → 与记忆比较 → 记录转变事件 → 更新记忆。
 * 冷启动即红/即 running（无记忆文件，prev=null）：也记一条——外层 /clear 后重启时套件仍红，
 * 正是 ROUND 2「红着无人处置」要消灭的形态，必须一挂上就触发，而不是等下一次 cron。
 * （第一眼是 green 不记事件——那是平静基线，无转变。）
 */
export function runOnce(root: string): RunOnceResult {
  const memo = readJson<{ state: SuiteStateValue | null }>(memoPath(root));
  const prev: SuiteStateValue | null = memo?.state ?? null;
  const cur = readSuiteState(root);
  const status: SuiteStateValue | "absent" = cur?.state ?? "absent";

  const events: SuiteStateEvent[] = [];
  if (cur) {
    if (prev !== null) {
      // 常规转变路径：上一个已知状态 → 当前状态
      const ev = recordTransition(root, prev, cur);
      if (ev) events.push(ev);
    } else if (cur.state !== "green") {
      // 第一眼（冷启动）即 red/running → 也要触发（红窗无人处置的形态；running 触发乐观执行者）
      const ev = recordTransition(root, null, cur);
      if (ev) events.push(ev);
    }
  }

  try {
    fs.mkdirSync(path.dirname(memoPath(root)), { recursive: true });
    fs.writeFileSync(
      memoPath(root),
      JSON.stringify({ state: status === "absent" ? null : status }, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // 记忆写失败不阻断本轮检测（下次轮询会重新比较——至多多记一条，不会漏掉红）。
  }

  return { status, events, stopSignal: cur?.state === "red" };
}

function formatEventLine(ev: SuiteStateEvent): string {
  return (
    `${ev.event} state=${ev.state?.state ?? "?"} early=${ev.early} ` +
    `stopSignal=${ev.stopSignal} at=${ev.at}`
  );
}

async function runMonitor(root: string, intervalMs: number): Promise<number> {
  // 首轮先跑一次（建立基线/冷启动即红的立即触发），随后按间隔轮询。
  for (;;) {
    const { events } = runOnce(root);
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

  if (argv.includes("--monitor") || !argv.includes("--once")) {
    const intervalMs = Number.isFinite(interval) && interval > 0 ? interval * 1000 : 5000;
    return runMonitor(root, intervalMs);
  }

  // --once：跑一轮（测试接缝 + tick/排障）
  const { status, events, stopSignal } = runOnce(root);
  console.log(`SUITE-STATUS ${status}`);
  for (const ev of events) {
    console.log(formatEventLine(ev));
  }
  console.log(`stopSignal=${stopSignal}`);
  return 0;
}

// 测试辅助：把状态文件写到临时根（fixture 构造用）。
export function writeSuiteState(root: string, state: SuiteState): void {
  fs.mkdirSync(path.dirname(statePath(root)), { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + "\n", "utf8");
}

// 测试辅助：读事件日志。
export function readSuiteEvents(root: string): SuiteStateEvent[] {
  try {
    return fs
      .readFileSync(eventsPath(root), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SuiteStateEvent);
  } catch {
    return [];
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
}
