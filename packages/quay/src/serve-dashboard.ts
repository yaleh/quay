// serve-dashboard.ts — /dashboard route handler + task-summary cache, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ProviderClient } from "./provider-client.ts";
import { readLive, readSystem, readManagerLight, readTests, readTestsNonBlocking, readGitHistory, readCurrentSuiteRun, readWorkerOutcomeRecords, yieldToEventLoop, DEFAULT_DRIVER_CAP, type LiveResult, type SystemResult, type ManagerResult, type TestsResult, type GitHistoryResult, type CurrentSuiteRun, type WorkerOutcomeRecord, type DriverKindReading, type InFlightTask } from "./observation.ts";
import { TASK_STATUS, type GoalRecord } from "./abi.ts";
import type { Manifest, ServeIdentity, ServePageCfg } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, relativeTime, pageTitle, renderIdentityCard } from "./serve-render.ts";
import { awaitingLandMs, formatAwaitingDuration, suiteSuffix } from "./serve-live.ts";
import { renderFanInCell } from "./serve-task.ts";

// ── /dashboard ─────────────────────────────────────────────────────────────────────────────────────

// gap-webui-dashboard-tests-card-latest-round-no-live-signal: elapsed-time formatter for a suite
// that is currently running (startedAt ISO → nowMs), pulled out as a pure function so it is testable
// without a live clock. null input/unparseable ISO → null (never a fabricated "0s").
/** Shared h/m/s split — the single place a wall-clock second count is turned into a "12m34s" string.
 *  Both `formatSuiteElapsed` (running suite) and `formatDurationMs` (a completed round's wall ms) route
 *  through it, so the modulo math is written exactly once (gap-dashboard-visual-review-batch-fixes AC4). */
function formatSeconds(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

export function formatSuiteElapsed(startedAt: string | null, nowMs: number): string | null {
  if (startedAt == null) return null;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return null;
  const totalSec = Math.max(0, Math.round((nowMs - t) / 1000));
  return formatSeconds(totalSec);
}

/** Wall-clock ms → "12m34s" (a completed test round's duration). Shares `formatSeconds`'s h/m/s split
 *  with `formatSuiteElapsed` rather than re-deriving the same modulo math. */
export function formatDurationMs(ms: number): string {
  return formatSeconds(Math.round(ms / 1000));
}

// ── liveCard / testsCard (extracted so the auto-refresh endpoint re-renders just these two) ──────
//
// gap-webui-live-implcomplete-state-render: the liveCard is no longer a bare count line — it renders
// a mini list of the first 3 in-flight tasks with a per-task state tag (待落地 + duration in the
// warning colour), so a task stuck awaiting-land is visible at a glance.
// gap-live-fan-in-execution-phase-two-axis: the per-task tag keys on the execution PHASE (not the
// impl-complete boundary), so a fan-in task reads 「fan-in · suite <state>」 not a misleading 「实现中」.

/** The dashboard liveCard — a self-contained render of the loop pulse (state + in-flight mini list),
 *  factored out so the auto-refresh JSON endpoint can re-render this ONE card without the rest of the
 *  dashboard. `id="live-card"` is the DOM node the auto-refresh script swaps. */
export function renderLiveCard(
  live: LiveResult,
  nowMs: number = Date.now(),
  tasks?: Array<{ id?: unknown; title?: unknown }>,
  records?: WorkerOutcomeRecord[],
  hours?: number,
): string {
  // gap-dashboard-fanin-panel-and-timeline-bars I: join the in-flight taskId to the task summary
  // (already fetched on the same /dashboard + /dashboard/cards requests) so each row can carry its
  // title — reusing the taskCard miniList's "id + body-colour title" vertical idiom.
  const titleById = new Map<string, string>();
  for (const t of tasks ?? []) {
    if (typeof t.id === "string" && typeof t.title === "string" && t.title.length > 0) titleById.set(t.id, t.title);
  }
  const liveStateText = live.status === "error" ? "读失败" : live.liveState === "running" ? "running" : live.liveState === "running-unwired" ? "在跑但未接遥测" : live.liveState === "not-running" ? "未在运行" : "—";
  const liveMiniList = live.inFlight.slice(0, 3).map((t) => {
    const tag = t.phase === "awaiting-land"
      ? `待落地 ${formatAwaitingDuration(awaitingLandMs(t))}`
      : t.phase === "fan-in"
        ? `fan-in${suiteSuffix(t.suite)}`
        : t.phase === "landed"
          ? "已落地"
          : "实现中";
    const emphasis = t.phase === "awaiting-land" || t.phase === "fan-in" || t.phase === "landed";
    // gap-dashboard-visual-review-batch-fixes AC2: every in-flight row carries its elapsed since
    // startedAtMs (the same formatSuiteElapsed formatter the testsCard uses, via an ISO round-trip).
    const elapsed = formatSuiteElapsed(new Date(t.startedAtMs).toISOString(), nowMs);
    const title = titleById.get(t.taskId);
    return html`<div style="display:flex;flex-direction:column;gap:2px;font-size:0.78rem;line-height:1.4">
      <div style="display:flex;justify-content:space-between;gap:0.5rem">
        <a href="/task/${encodeURIComponent(t.taskId)}" style="color:var(--color-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${escapeHtml(t.taskId)}</a>
        <span style="flex:none;${emphasis ? "color:var(--color-accent-700);font-weight:700" : "color:var(--color-neutral-700)"}">${escapeHtml(tag)}${elapsed ? ` · ${escapeHtml(elapsed)}` : ""}</span>
      </div>
      ${title != null ? html`<div style="color:var(--color-text);font-size:0.75rem">${escapeHtml(title)}</div>` : ""}
    </div>`;
  }).join("");
  // gap-dashboard-livecard-minilist-overflow-indicator: the mini-list is capped at 3 rows, but the card
  // header shows the TRUE in-flight count — when more than 3 are in flight, append the same "+N 更多"
  // idiom the gantt overflow badge uses (renderLiveGanttSvg) so the truncation reads as intentional, not
  // as missing data. Link to /live, which lists every in-flight task. (The slice(0, 3) cap itself stays:
  // concurrencyCap can be higher in other workspaces, and a hint scales better than widening the cap.)
  const liveMiniListOverflow = live.inFlight.length > 3
    ? html`<a href="/live" style="font-size:0.78rem;color:var(--color-accent);text-decoration:none">+${live.inFlight.length - 3} 更多 →</a>`
    : "";
  // gap-dashboard-live-swimlane-fixed-lane-gantt-timeline: the once in-flight-only swimlane is now a
  // fixed-5-lane gantt that ALSO renders history (worker-outcome.jsonl) — merge the two sources and
  // greedily pack them onto FIXED_GANTT_LANES lanes, so throughput / idle gaps / long-tail blocking
  // are readable, not just the current in-flight set. (The superseded one-lane-per-task swimlane —
  // gap-dashboard-cards-layout-and-livecard-swimlane AC5 — lives on as renderLiveSwimlaneSvg.)
  const windowHours = hours ?? DEFAULT_TIMELINE_HOURS;
  const ganttIntervals = live.status === "ok"
    ? mergeLiveAndHistoryIntervals(live.inFlight, records ?? [], nowMs - windowHours * 3_600_000, nowMs)
    : [];
  const gantt = ganttIntervals.length > 0
    ? renderLiveGanttSvg(ganttIntervals, windowHours, nowMs)
    : "";
  return html`<div id="live-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">循环脉搏</div>
    <div style="font-weight:800">${escapeHtml(liveStateText)}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">在飞 ${live.inFlight.length} / 上限 ${live.concurrencyCap}</p>
    ${gantt}
    ${live.status === "ok" && live.inFlight.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-divider);padding-top:6px">${liveMiniList}${liveMiniListOverflow}</div>` : ""}
    <a href="/live" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Live →</a>
  </div>`;
}

// ── 过去 N 小时分段着色时间轴（G/H 共用）───────────────────────────────────────────────────────────
//
// gap-dashboard-fanin-panel-and-timeline-bars G/H: G（测试卡）与 H（fan-in 卡）两条时间轴的数据源
// （verification-round.jsonl / worker-outcome.jsonl）本就是持久化的真实历史，因此做成和 serve-tests.ts
// 的 per-file gantt / load-curve 一样的【服务端渲染 SVG】（零客户端 JS、刷新页面历史不丢），不复用
// sysCard 那套客户端内存攒数组的手法。两份 bar 共用同一份横轴换算，不写两遍。

/** Default timeline window (hours) for the tests/fan-in segmented bars. */
export const DEFAULT_TIMELINE_HOURS = 3;

/** Parse `?hours=` into the timeline window: a valid integer in [1,24] → that value; missing / illegal
 *  / out-of-range ("abc", 0, 999, 1.5, …) → DEFAULT_TIMELINE_HOURS (never throws, never clamps an
 *  out-of-range value into 24 — AC7). */
export function parseTimelineHours(raw: string | null | undefined): number {
  if (raw == null || raw === "") return DEFAULT_TIMELINE_HOURS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 24) return DEFAULT_TIMELINE_HOURS;
  return n;
}

/** Read the timeline window off an incoming dashboard request's `?hours=` query (degrade → default). */
function timelineHoursFromRequest(req: IncomingMessage): number {
  try {
    return parseTimelineHours(new URL(req.url ?? "", "http://localhost").searchParams.get("hours"));
  } catch {
    return DEFAULT_TIMELINE_HOURS;
  }
}

/** Test-run state → the dashboard card's own colour token (green → positive, red → accent, other →
 *  neutral). Bare token name, so the round-number chip writes `background:var(--color-…)` and the
 *  timeline SVG writes `fill="var(--color-…)"` from ONE source (no drift). */
function stateColorToken(state: string | null): string {
  return state === "green" ? "--color-positive-700" : state === "red" ? "--color-accent-800" : "--color-neutral-400";
}

/** Mechanical fan-in outcome → colour token (landed → positive, red → accent, unknown → neutral). */
function fanInOutcomeColorToken(outcome: string | null): string {
  return outcome === "landed" ? "--color-positive-700" : outcome === "red" ? "--color-accent-800" : "--color-neutral-400";
}

/** In-flight execution phase → the liveCard swimlane lane colour. The SAME 4-way phase split
 *  renderLiveCard's tag already discriminates (landed → positive, awaiting-land → accent-800, fan-in →
 *  accent-700, else implementing → neutral), so a lane's colour and its tag's emphasis can never drift
 *  apart. Bare token name — the SVG writes `fill="var(--color-…)"` from ONE source. */
function livePhaseColorToken(phase: string | null): string {
  return phase === "landed" ? "--color-positive-700" : phase === "awaiting-land" ? "--color-accent-800" : phase === "fan-in" ? "--color-accent-700" : "--color-neutral-400";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** A segmented absolute-wall-clock timeline bar (G and H share this ONE horizontal-axis conversion).
 *  Each segment is `[startMs, endMs]` on an axis spanning the past `windowHours` ending at
 *  `windowEndMs` — the CARD's own window end (its latest event's end time), NOT necessarily the
 *  wall-clock now. gap-dashboard-fanin-timestamp-timeline-anchor: anchoring to "now" emptied the bar
 *  entirely once the loop stalled longer than the window; the axis must instead reference the most
 *  recent real event. Each segment is filled with `colorVar` (a bare CSS token). Segments with
 *  non-finite / inverted bounds, or that do not intersect the window at all, are skipped (never
 *  extrapolated, never positioned by assumption). Returns "" when no segment survives. Each surviving
 *  segment renders exactly ONE `<rect>` (AC3/AC5 count `<rect` occurrences); the axis/labels use
 *  `<line>`/`<text>` so that count stays exact. */
export function renderTimelineBarSvg(
  segments: Array<{ startMs: number; endMs: number; colorVar: string }>,
  windowHours: number,
  windowEndMs: number,
): string {
  const windowStartMs = windowEndMs - windowHours * 3_600_000;
  const spanMs = windowHours * 3_600_000;
  const rows = segments.filter(
    (s) =>
      Number.isFinite(s.startMs) &&
      Number.isFinite(s.endMs) &&
      s.endMs >= s.startMs &&
      s.endMs >= windowStartMs &&
      s.startMs <= windowEndMs,
  );
  if (rows.length === 0) return "";

  const W = 600;
  const H = 44;
  const pad = 4;
  const barY = 8;
  const barH = 14;
  const axisY = H - 10;
  const plotW = W - 2 * pad;
  const X = (t: number): number => pad + ((t - windowStartMs) / spanMs) * plotW;

  const bars = rows
    .map((s) => {
      const x0 = X(Math.max(s.startMs, windowStartMs));
      const x1 = X(Math.min(s.endMs, windowEndMs));
      const w = Math.max(x1 - x0, 1.5);
      return `<rect x="${x0.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" rx="2" fill="var(${s.colorVar})"></rect>`;
    })
    .join("");

  const hhmm = (t: number): string => {
    const d = new Date(t);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const axis = `<line x1="${pad}" y1="${axisY}" x2="${W - pad}" y2="${axisY}" stroke="var(--color-neutral-300)"></line>`;
  const leftLabel = `<text x="${pad}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)">${hhmm(windowStartMs)}</text>`;
  const rightLabel = `<text x="${W - pad}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)" text-anchor="end">${hhmm(windowEndMs)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="过去 ${windowHours} 小时时间轴" style="width:100%;height:auto;margin-top:4px;display:block">
${axis}
${bars}
${leftLabel}
${rightLabel}
</svg>`;
}

/** Multi-lane SVG timeline for the liveCard (gap-dashboard-cards-layout-and-livecard-swimlane AC5):
 *  ONE lane per in-flight task, each segment `[startedAtMs, nowMs]` — an OPEN interval to the
 *  observation instant, because an in-flight task has no end time. Colour by execution phase (reusing
 *  livePhaseColorToken). Reuses renderTimelineBarSvg's horizontal-axis conversion but adds a vertical
 *  lane offset + a left-side task-id label. Each surviving task renders exactly ONE `<rect>` (AC5
 *  counts `<rect`); the axis/labels use `<line>`/`<text>` so the count stays exact. Returns "" when no
 *  task carries a usable startedAtMs. */
export function renderLiveSwimlaneSvg(
  inFlight: Array<{ taskId: string; startedAtMs: number; phase: string }>,
  windowHours: number,
  nowMs: number,
): string {
  const rows = inFlight.filter((t) => Number.isFinite(t.startedAtMs) && t.startedAtMs <= nowMs);
  if (rows.length === 0) return "";

  const windowStartMs = nowMs - windowHours * 3_600_000;
  const spanMs = windowHours * 3_600_000;
  const W = 600;
  const pad = 4;
  const labelW = 150;
  const plotL = pad + labelW;
  const plotW = W - 2 * pad - labelW;
  const laneH = 16;
  const barH = 10;
  const top = 8;
  const axisY = top + rows.length * laneH + 6;
  const H = axisY + 12;
  const X = (t: number): number => plotL + ((t - windowStartMs) / spanMs) * plotW;
  const hhmm = (t: number): string => {
    const d = new Date(t);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const bars = rows
    .map((t, i) => {
      const y = top + i * laneH;
      const x0 = X(Math.max(t.startedAtMs, windowStartMs));
      const x1 = X(nowMs);
      const w = Math.max(x1 - x0, 1.5);
      return `<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" rx="2" fill="var(${livePhaseColorToken(t.phase)})"></rect>`;
    })
    .join("");

  const labels = rows
    .map((t, i) => {
      const id = t.taskId.length > 22 ? `${t.taskId.slice(0, 21)}…` : t.taskId;
      return `<text x="${pad}" y="${(top + i * laneH + barH - 1).toFixed(1)}" font-size="9" fill="var(--color-neutral-700)">${escapeHtml(id)}</text>`;
    })
    .join("");

  const axis = `<line x1="${plotL}" y1="${axisY}" x2="${W - pad}" y2="${axisY}" stroke="var(--color-neutral-300)"></line>`;
  const leftLabel = `<text x="${plotL}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)">${hhmm(windowStartMs)}</text>`;
  const rightLabel = `<text x="${W - pad}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)" text-anchor="end">${hhmm(nowMs)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="在飞任务泳道时间轴" style="width:100%;height:auto;margin-top:4px;display:block">
${axis}
${bars}
${labels}
${leftLabel}
${rightLabel}
</svg>`;
}

// ── 固定 5 泳道甘特图（循环脉搏卡，gap-dashboard-live-swimlane-fixed-lane-gantt-timeline）───────
// The old swimlane (renderLiveSwimlaneSvg above, still exported + tested) drew ONE lane per in-flight
// task with an open [startedAtMs, now] segment — history (already-ended tasks) was invisible, so
// throughput / idle gaps / long-tail blocking (a 41-min fan-in) could not be read. The gantt below
// merges in-flight (readLive) + history (worker-outcome.jsonl) into ONE interval list, greedily packs
// it onto FIXED_GANTT_LANES lanes (== the dispatch concurrency cap), and renders every block with a
// native `<title>` hover (task id · phase/final-state · duration · start→end). No new colour-token
// system: colours come from livePhaseColorToken (in-flight) / fanInOutcomeColorToken + final_state
// (history), the SAME three token functions the rest of the dashboard already uses.

/** The dispatch concurrency cap — also the fixed Y-axis lane count ("this is the concurrency cap").
 *  Matches the driver's FIXED_DISPATCH_CAP so the two can never drift apart. */
export const FIXED_GANTT_LANES = 5;

/** A merged in-flight-or-historical run interval for the liveCard gantt. `phase` (in-flight) and
 *  `finalState`/`fanInOutcome` (historical) are mutually exclusive: exactly one side is non-null. */
export interface LiveGanttInterval {
  taskId: string;
  runId: string;
  startMs: number;
  endMs: number;
  phase: string | null;
  finalState: string | null;
  fanInOutcome: string | null;
}

/** Merge readLive's in-flight runs (open interval to `now`) with worker-outcome history (closed
 *  interval, filtered to `[windowStartMs, nowMs]`) into ONE interval list. Pure — no I/O.
 *  A run that is both in-flight AND already on the outcome carrier appears once: in-flight wins
 *  (added first). The dedup key is (taskId, startMs) — NOT `run_id`, which is the driver-process
 *  round id shared by EVERY task dispatched in that driver lifetime (⛔ gap-dashboard-gantt-
 *  runid-dedup-collapses-driver-round-shared-id: deduping on run_id collapsed dozens of distinct
 *  historical tasks per driver round into one). (taskId, startMs) is unique per dispatch and, for
 *  the same run, `Date.parse(started_at)` round-trips to the exact `startedAtMs` the in-flight
 *  side carries, so the cross-source dedup still fires for a genuinely-shared run. */
export function mergeLiveAndHistoryIntervals(
  inFlight: InFlightTask[],
  records: WorkerOutcomeRecord[],
  windowStartMs: number,
  nowMs: number,
): LiveGanttInterval[] {
  const seen = new Set<string>();
  const out: LiveGanttInterval[] = [];
  const add = (iv: LiveGanttInterval): void => {
    // startMs is always finite here (both callers guard it), so the key is always well-defined even
    // when taskId is "" (an unknown task — the key still distinguishes by start time).
    const key = `${iv.taskId}|${iv.startMs}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(iv);
  };
  for (const t of inFlight) {
    if (!Number.isFinite(t.startedAtMs) || t.startedAtMs > nowMs) continue;
    add({ taskId: t.taskId, runId: t.runId, startMs: t.startedAtMs, endMs: nowMs, phase: t.phase, finalState: null, fanInOutcome: null });
  }
  for (const r of records) {
    const startMs = r.started_at != null ? Date.parse(r.started_at) : NaN;
    const endMs = r.ended_at != null ? Date.parse(r.ended_at) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) continue;
    if (endMs < windowStartMs || startMs > nowMs) continue;
    add({ taskId: r.task ?? "", runId: r.run_id ?? "", startMs, endMs, phase: null, finalState: r.final_state, fanInOutcome: r.mechanical_fan_in?.outcome ?? null });
  }
  return out;
}

/** Greedy "meeting-room" packing of intervals onto ≤ maxLanes lanes (sorted by start, assigned to the
 *  earliest lane whose last interval has ended). Returns the packed lanes PLUS an explicit `overflow`
 *  count: when a moment has > maxLanes overlapping intervals (e.g. a fan-in phase not counted against
 *  the driver's worker cap), the excess is NEVER silently dropped or index-clipped — it surfaces as a
 *  visible "+N 更多" badge, not a swallowed interval. (The bounded-overlap ⇒ ≤5-lane convergence claim
 *  holds only when the window's true concurrency never exceeds the cap; the overflow arm is the honest
 *  degradation when that assumption breaks.) */
export function packLanes(
  intervals: LiveGanttInterval[],
  maxLanes: number = FIXED_GANTT_LANES,
): { lanes: LiveGanttInterval[][]; overflow: number } {
  const sorted = [...intervals].sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));
  const lanes: LiveGanttInterval[][] = [];
  const laneEnds: number[] = [];
  let overflow = 0;
  for (const iv of sorted) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (laneEnds[i] <= iv.startMs) { lane = i; break; }
    }
    if (lane >= 0) {
      lanes[lane].push(iv);
      laneEnds[lane] = iv.endMs;
    } else if (lanes.length < maxLanes) {
      lanes.push([iv]);
      laneEnds.push(iv.endMs);
    } else {
      overflow++;
    }
  }
  return { lanes, overflow };
}

/** A merged interval → the card's colour token. In-flight by phase (livePhaseColorToken); history by
 *  fan-in outcome first (fanInOutcomeColorToken), then final_state (completed → positive; failed/
 *  killed/timed-out → accent-800; exited-not-landed → accent-700; else neutral). Bare token name so
 *  the SVG writes `fill="var(--color-…)"` from ONE source, exactly like the existing helpers. */
function ganttIntervalColorVar(iv: LiveGanttInterval): string {
  if (iv.phase != null) return livePhaseColorToken(iv.phase);
  const byFanIn = fanInOutcomeColorToken(iv.fanInOutcome);
  if (byFanIn !== "--color-neutral-400") return byFanIn;
  if (iv.finalState === "completed") return "--color-positive-700";
  if (iv.finalState === "failed" || iv.finalState === "killed" || iv.finalState === "timed-out") return "--color-accent-800";
  if (iv.finalState === "exited-not-landed") return "--color-accent-700";
  return "--color-neutral-400";
}

/** In-flight execution phase → the short label a block's `<title>` carries (mirrors renderLiveCard's
 *  tag wording, so hover text and the mini-list tag never drift apart). */
function phaseLabel(phase: string | null): string {
  return phase === "landed" ? "已落地" : phase === "awaiting-land" ? "待落地" : phase === "fan-in" ? "fan-in" : "实现中";
}

/** Fixed-5-lane gantt SVG for the liveCard (replaces renderLiveSwimlaneSvg as the card's swimlane):
 *  `intervals` are the ALREADY-merged in-flight + history list (see mergeLiveAndHistoryIntervals);
 *  greedily packs onto FIXED_GANTT_LANES lanes and renders all 5 lane guide lines even when some are
 *  empty (the "this is the concurrency cap" visual semantic). Each surviving interval renders exactly
 *  ONE `<rect>` carrying a native `<title>` hover (task id · phase/final-state · duration · start→end);
 *  the axis/guide-lines/labels use `<line>`/`<text>` so the `<rect` count stays exact. Returns "" when
 *  no interval survives (mirrors renderLiveSwimlaneSvg's no-rows contract). */
export function renderLiveGanttSvg(
  intervals: LiveGanttInterval[],
  windowHours: number,
  nowMs: number,
): string {
  if (intervals.length === 0) return "";
  const { lanes, overflow } = packLanes(intervals, FIXED_GANTT_LANES);

  const windowStartMs = nowMs - windowHours * 3_600_000;
  const spanMs = windowHours * 3_600_000;
  const W = 600;
  const pad = 4;
  const plotL = pad;
  const plotW = W - 2 * pad;
  const laneH = 16;
  const barH = 10;
  const top = 8;
  const axisY = top + FIXED_GANTT_LANES * laneH + 6;
  const H = axisY + 12;
  const X = (t: number): number => plotL + ((t - windowStartMs) / spanMs) * plotW;
  const hhmm = (t: number): string => {
    const d = new Date(t);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const laneLines: string[] = [];
  for (let i = 0; i < FIXED_GANTT_LANES; i++) {
    const gy = (top + i * laneH + laneH - 4).toFixed(1);
    laneLines.push(`<line class="lane-line" x1="${plotL}" y1="${gy}" x2="${W - pad}" y2="${gy}" stroke="var(--color-neutral-300)" stroke-dasharray="2 2"></line>`);
  }

  const bars: string[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const y = top + i * laneH;
    for (const iv of lanes[i]) {
      const x0 = X(Math.max(iv.startMs, windowStartMs));
      const x1 = X(Math.min(iv.endMs, nowMs));
      const w = Math.max(x1 - x0, 1.5);
      const duration = formatDurationMs(Math.max(0, iv.endMs - iv.startMs));
      const state = iv.phase != null ? phaseLabel(iv.phase) : (iv.finalState ?? "unknown");
      const startIso = new Date(iv.startMs).toISOString();
      const endIso = new Date(iv.endMs).toISOString();
      bars.push(`<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" rx="2" fill="var(${ganttIntervalColorVar(iv)})"><title>${escapeHtml(`${iv.taskId} · ${state} · ${duration} · ${startIso} → ${endIso}`)}</title></rect>`);
    }
  }

  const overflowLabel = overflow > 0
    ? `<text x="${W - pad}" y="${top}" font-size="9" font-weight="700" fill="var(--color-accent-800)" text-anchor="end">+${overflow} 更多</text>`
    : "";

  const axis = `<line x1="${plotL}" y1="${axisY}" x2="${W - pad}" y2="${axisY}" stroke="var(--color-neutral-300)"></line>`;
  const leftLabel = `<text x="${plotL}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)">${hhmm(windowStartMs)}</text>`;
  const rightLabel = `<text x="${W - pad}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)" text-anchor="end">${hhmm(nowMs)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="循环脉搏甘特图（固定 ${FIXED_GANTT_LANES} 泳道）" style="width:100%;height:auto;margin-top:4px;display:block">
${laneLines.join("\n")}
${bars.join("\n")}
${overflowLabel}
${axis}
${leftLabel}
${rightLabel}
</svg>`;
}

// gap-webui-dashboard-tests-card-latest-round-no-live-signal: the card prefers the LIVE running signal
// (full-suite-state.json state=running, no ledger row yet) over tests.runs[0] (the latest COMPLETED
// round); labels a gate-blocked round (pass=0/tests=0 by construction) for what it is instead of a bare
// "pass 0/0". gap-dashboard-cards-layout-and-livecard-swimlane removed the once-added 近N轮 strip; the
// per-round colour + hover info now lives on the round-number chip in the recent-run list below.

/** The dashboard testsCard — a self-contained render of the suite state (live-running signal / latest
 *  completed round / recent-rounds strip), factored out for the auto-refresh endpoint. `id="tests-card"`
 *  is the DOM node the auto-refresh script swaps. */
export function renderTestsCard(
  tests: TestsResult,
  suiteRun: CurrentSuiteRun | null,
  opts: { hours?: number; nowMs?: number } = {},
): string {
  const nowMs = opts.nowMs ?? Date.now();
  const hours = opts.hours ?? DEFAULT_TIMELINE_HOURS;
  const latestRun = tests.runs[0] ?? null;
  const suiteRunning = suiteRun && suiteRun.state === "running" ? suiteRun : null;
  const gateBlocked = latestRun != null && latestRun.tests === 0 && latestRun.pass === 0 && (latestRun.reason === "gate-failed" || latestRun.gate != null);
  const statusLine = suiteRunning
    ? html`<span style="color:var(--color-accent-700)">运行中</span>`
    : escapeHtml(latestRun ? (latestRun.state ?? "—") : "未接入");
  const elapsed = suiteRunning ? formatSuiteElapsed(suiteRunning.startedAt, Date.now()) : null;
  const detailLine = suiteRunning
    ? `已运行 ${elapsed ?? "—"}${suiteRunning.runner ? ` · runner ${escapeHtml(suiteRunning.runner)}` : ""}${suiteRunning.scope ? ` · scope ${escapeHtml(suiteRunning.scope)}` : ""}`
    : latestRun
      ? (gateBlocked
        ? `gate 未过${latestRun.gate ? `（${escapeHtml(latestRun.gate)}）` : ""}，未执行测试`
        : `pass ${latestRun.pass ?? "—"}/${latestRun.tests ?? "—"}`)
      : (tests.reason ? escapeHtml(tests.reason) : "无验证轮记录");
  const recentRuns = tests.runs.slice(0, 5);
  // gap-dashboard-cards-layout-and-livecard-swimlane AC1: the hover-only colour strip is gone — the
  // default-visible list below already renders the same recentRuns, so the strip was zero information
  // without a hover. Its per-round colour + hover info now lives on the round-number chip.
  // gap-dashboard-visual-review-batch-fixes AC4: a default-visible, readable per-round list (round · state
  // · pass X/Y · duration) below, so a recent result is legible without hover.
  // gap-dashboard-fanin-panel-and-timeline-bars F: each row ALSO appends its startedAt (via relativeTime)
  // and buckets — absent fields render NO sub-item (the absent-field contract, never a "—").
  const recentList = recentRuns.filter((r) => r.state !== "running").map((r) => {
    const rGateBlocked = r.tests === 0 && r.pass === 0 && (r.reason === "gate-failed" || r.gate != null);
    const rDetail = rGateBlocked ? `gate:${r.gate ?? "?"} 未执行测试` : `pass ${r.pass ?? "—"}/${r.tests ?? "—"}`;
    const rDur = r.durationMs != null ? formatDurationMs(r.durationMs) : "—";
    const startedMs = r.startedAt != null ? Date.parse(r.startedAt) : NaN;
    const startedLine = Number.isFinite(startedMs)
      ? html`<div style="color:var(--color-neutral-700)">${relativeTime(startedMs)}</div>`
      : "";
    const bucketsLine = r.buckets != null && r.buckets !== ""
      ? html`<div style="color:var(--color-neutral-700)">bucket ${escapeHtml(r.buckets)}</div>`
      : "";
    return html`<div style="display:flex;flex-direction:column;gap:2px;font-size:0.72rem;line-height:1.4">
      <div style="display:flex;justify-content:space-between;gap:0.5rem">
        <span style="flex:none;display:flex;align-items:center;gap:0.35rem">
          <span title="${escapeHtml(`#${r.round ?? "?"} ${r.state ?? "—"} · ${rDetail}`)}" style="background:var(${stateColorToken(r.state)});color:#fff;padding:1px 6px;border-radius:3px;font-weight:700">#${r.round ?? "?"}</span>
          <span style="color:var(--color-neutral-700)">${escapeHtml(r.state ?? "—")}</span>
        </span>
        <span style="color:var(--color-neutral-700)">${rDetail} · ${rDur}</span>
      </div>
      ${startedLine}
      ${bucketsLine}
    </div>`;
  }).join("");
  // gap-dashboard-fanin-panel-and-timeline-bars G: past-N-hours segmented timeline below the list —
  // input is the FULL `tests.runs` history (not just the 5-row strip), one segment per round whose
  // [startedAt, startedAt+durationMs] both parse; colour by state (the card's own ternary).
  const timelineSegments = tests.runs.map((r) => {
    const startMs = r.startedAt != null ? Date.parse(r.startedAt) : NaN;
    const endMs = Number.isFinite(startMs) && r.durationMs != null ? startMs + r.durationMs : NaN;
    return { startMs, endMs, colorVar: stateColorToken(r.state) };
  });
  // gap-dashboard-fanin-timestamp-timeline-anchor 缺陷2 (G): the bar's window end is the card's OWN
  // last test end time (startedAt + durationMs of the latest round with BOTH parseable), NOT the
  // wall-clock now — a stalled loop still renders the bar anchored to the most recent real event.
  // No usable round → fall back to nowMs (never NaN).
  let windowEndMs: number | null = null;
  for (const r of tests.runs) {
    const startMs = r.startedAt != null ? Date.parse(r.startedAt) : NaN;
    if (!Number.isFinite(startMs) || r.durationMs == null) continue;
    const endMs = startMs + r.durationMs;
    if (windowEndMs == null || endMs > windowEndMs) windowEndMs = endMs;
  }
  const timelineBar = renderTimelineBarSvg(timelineSegments, hours, windowEndMs ?? nowMs);
  return html`<div id="tests-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">测试</div>
    <div style="font-weight:800">${statusLine}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">${detailLine}</p>
    ${timelineBar}
    ${recentList.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:2px">${recentList}</div>` : ""}
    <a href="/tests" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Tests →</a>
  </div>`;
}

// ── liveCard/testsCard auto-refresh (gap-dashboard-testscard-livecard-auto-refresh) ─────────────────
//
// The two cards above are a request-time snapshot; a tab left open shows stale state until a manual
// reload. This adds a light, LOCAL auto-refresh: an inline script polls the /dashboard/cards JSON
// endpoint (which re-renders ONLY those two cards) and swaps each card's own DOM node — never
// location.reload. The period is aligned with TASK_SUMMARY_CACHE_TTL_MS (30s) so the client does not
// poll faster than the backend's own freshness; polling pauses while the tab is hidden.

/** Auto-refresh period for the dashboard liveCard/testsCard (ms). Configurable here; the test pins the
 *  value domain [30s, 60s] (AC2). Aligned with TASK_SUMMARY_CACHE_TTL_MS so the client never polls
 *  faster than the backend refresh. */
export const DASHBOARD_CARD_REFRESH_MS = 30_000;

/** Pure, self-contained renderer for the `#sys-sparkline` SVG inner markup — legend (two colour
 *  swatches + names) + two polylines (cpu_stall / loadavg) + min/max/latest value labels + an optional
 *  loadavg threshold reference line + earliest/latest sample-time (hh:mm) labels.
 *  gap-dashboard-syscard-sparkline-legend-labels: Tufte's sparkline minimum is "pair with the most
 *  recent value, endpoints (min/max) marked" — the prior render was a bare min-max stretch with no
 *  numbers at all, which is why the card read as 「很难观察」.
 *
 *  ⚠️ This function's source is serialized via `Function.prototype.toString()` into the client-side
 *  inline script (see renderDashboardCardRefreshScript). KEEP IT UNTYPED AND SELF-CONTAINED: no
 *  TypeScript type annotations (strip-types would blank them into whitespace) and no closure over
 *  module-level helpers (the browser has none) — pad2/escapeHtml/etc. must NOT be referenced here.
 *  It returns only SVG markup whose text content is hard-coded literals or `String(number)` output,
 *  so no HTML escaping is required. */
export function sparklineSvg(history, loadThreshold) {
  var W = 300, H = 120, P = 4;
  var plotTop = 24, plotBottom = 100;

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function num(v) { return String(v); }
  function finite(v) { return typeof v === "number" && isFinite(v); }
  function xAt(i, n) { return P + (i / (n - 1)) * (W - 2 * P); }
  function yAt(v, min, max) { return plotBottom - ((v - min) / (max - min)) * (plotBottom - plotTop); }

  // Per-series min/max over the FINITE values only (a null probe draws nothing, never a fake 0).
  function stats(vals) {
    var min = Infinity, max = -Infinity, minIdx = -1, maxIdx = -1, latestIdx = -1, j, v;
    for (j = 0; j < vals.length; j++) {
      v = vals[j];
      if (!finite(v)) continue;
      latestIdx = j;
      if (v < min) { min = v; minIdx = j; }
      if (v > max) { max = v; maxIdx = j; }
    }
    if (!isFinite(min)) return null;
    return { min: min, max: max, minIdx: minIdx, maxIdx: maxIdx, latestIdx: latestIdx };
  }
  function polyline(vals, scaleMin, scaleMax) {
    var pts = [], j, v;
    for (j = 0; j < vals.length; j++) {
      v = vals[j];
      if (!finite(v)) continue;
      pts.push(xAt(j, vals.length).toFixed(1) + "," + yAt(v, scaleMin, scaleMax).toFixed(1));
    }
    return pts.join(" ");
  }
  function seriesMarkup(vals, s, scaleMin, scaleMax, color, labelOffset) {
    var m = [];
    var lx = xAt(s.latestIdx, vals.length);
    var ly = yAt(vals[s.latestIdx], scaleMin, scaleMax);
    var minx = xAt(s.minIdx, vals.length), miny = yAt(s.min, scaleMin, scaleMax);
    var maxx = xAt(s.maxIdx, vals.length), maxy = yAt(s.max, scaleMin, scaleMax);
    m.push('<polyline class="load-svg-line" style="stroke:var(' + color + ')" points="' + polyline(vals, scaleMin, scaleMax) + '"></polyline>');
    // latest value — the right-end circle + value text Tufte requires.
    m.push('<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="2.5" fill="var(' + color + ')"></circle>');
    m.push('<text x="' + (lx - 5).toFixed(1) + '" y="' + (ly - 5 + labelOffset).toFixed(1) + '" font-size="8" fill="var(--color-neutral-600)" text-anchor="end">' + num(vals[s.latestIdx]) + '</text>');
    // min/max marks — the endpoints/extremes Tufte calls out.
    m.push('<circle cx="' + minx.toFixed(1) + '" cy="' + miny.toFixed(1) + '" r="1.5" fill="var(' + color + ')"></circle>');
    m.push('<text x="' + minx.toFixed(1) + '" y="' + (miny - 5 + labelOffset).toFixed(1) + '" font-size="8" fill="var(--color-neutral-600)" text-anchor="middle">' + num(s.min) + '</text>');
    m.push('<circle cx="' + maxx.toFixed(1) + '" cy="' + maxy.toFixed(1) + '" r="1.5" fill="var(' + color + ')"></circle>');
    m.push('<text x="' + maxx.toFixed(1) + '" y="' + (maxy - 5 + labelOffset).toFixed(1) + '" font-size="8" fill="var(--color-neutral-600)" text-anchor="middle">' + num(s.max) + '</text>');
    return m.join("");
  }

  // Legend — static, rendered even before the first poll so the two series are identifiable at once.
  // Colors reuse the SAME tokens the two polylines already use (cpu_stall = .load-svg-line default
  // --color-accent-600, loadavg = --color-positive-700), not a new palette.
  var out = [];
  out.push('<rect x="' + P + '" y="7" width="12" height="3" fill="var(--color-accent-600)"></rect>');
  out.push('<text x="' + (P + 17) + '" y="13" font-size="9" fill="var(--color-neutral-700)">cpu_stall</text>');
  out.push('<rect x="' + (P + 82) + '" y="7" width="12" height="3" fill="var(--color-positive-700)"></rect>');
  out.push('<text x="' + (P + 99) + '" y="13" font-size="9" fill="var(--color-neutral-700)">loadavg</text>');

  if (history.length >= 2) {
    var cpus = [], loads = [], i;
    for (i = 0; i < history.length; i++) {
      cpus.push(history[i].cpu);
      loads.push(history[i].load);
    }
    var cpu = stats(cpus);
    var load = stats(loads);

    if (cpu) {
      var cpuMin = cpu.min, cpuMax = cpu.max;
      if (cpuMax === cpuMin) cpuMax = cpuMin + 1;
      out.push(seriesMarkup(cpus, cpu, cpuMin, cpuMax, "--color-accent-600", 0));
    }
    if (load) {
      // Loadavg keeps its own pure min-max scale — the trend must stay readable even when the overload
      // threshold (nproc × loadOverFactor, e.g. 32) sits far above the observed loadavg (e.g. ~3).
      var loadMin = load.min, loadMax = load.max;
      if (loadMax === loadMin) loadMax = loadMin + 1;
      out.push(seriesMarkup(loads, load, loadMin, loadMax, "--color-positive-700", 10));
      // Threshold reference line (loadavg only) — drawn only when loadThreshold is present AND load
      // data exists (a null threshold draws nothing, never a fabricated default). Clamped to the plot
      // so a threshold far outside the observed range shows as an edge line rather than crushing the
      // data into a sliver.
      if (finite(loadThreshold)) {
        var ty = yAt(loadThreshold, loadMin, loadMax);
        var lineY = Math.min(plotBottom, Math.max(plotTop, ty));
        var labelY = lineY - 3;
        if (labelY < plotTop + 8) labelY = lineY + 9;
        out.push('<line class="spark-threshold" x1="' + P + '" x2="' + (W - P) + '" y1="' + lineY.toFixed(1) + '" y2="' + lineY.toFixed(1) + '" stroke="var(--color-neutral-400)" stroke-dasharray="3 3"></line>');
        out.push('<text x="' + (W - P) + '" y="' + labelY.toFixed(1) + '" font-size="8" fill="var(--color-neutral-500)" text-anchor="end">阈 ' + num(loadThreshold) + '</text>');
      }
    }

    // Earliest/latest sample time (hh:mm) — history now records ts (sysRaw.ts, the server epoch-ms).
    var firstTs = null, lastTs = null;
    for (i = 0; i < history.length; i++) {
      if (finite(history[i].ts)) { if (firstTs === null) firstTs = history[i].ts; lastTs = history[i].ts; }
    }
    if (firstTs !== null && lastTs !== null) {
      out.push('<text x="' + P + '" y="' + (H - 6) + '" font-size="8" fill="var(--color-neutral-500)">' + hhmm(firstTs) + '</text>');
      out.push('<text x="' + (W - P) + '" y="' + (H - 6) + '" font-size="8" fill="var(--color-neutral-500)" text-anchor="end">' + hhmm(lastTs) + '</text>');
    }
  }

  return out.join("");
}

/** The inline auto-refresh <script> injected into the dashboard page. Pure — returns a string, so a
 *  unit test can grep it for setInterval/fetch/visibilityState and prove no location.reload (AC1/AC3). */
export function renderDashboardCardRefreshScript(): string {
  return `<script>
(function () {
  var REFRESH_MS = ${DASHBOARD_CARD_REFRESH_MS};
  var SYS_HISTORY_MAX = 60;
  var sysHistory = [];
  var loadThreshold = null;

  // The sparkline renderer (legend + two polylines + min/max/latest labels + optional threshold
  // reference line + time-span labels) is embedded from the shared pure function in serve-dashboard.ts
  // via Function#toString — the browser runs the SAME code the unit tests exercise (no drift).
  var sparklineSvg = ${sparklineSvg.toString()};

  // Redraw the in-memory history into #sys-sparkline. The history lives ONLY in this closure — a
  // page reload / tab close clears it (the known trade-off of the zero-persistence simplification).
  function redrawSparkline() {
    var svg = document.getElementById("sys-sparkline");
    if (!svg) { return; }
    svg.innerHTML = sparklineSvg(sysHistory, loadThreshold);
  }

  var refresh = function () {
    if (document.visibilityState !== "visible") { return; }
    var qs = new URLSearchParams(window.location.search).get("hours");
    fetch("/dashboard/cards" + (qs != null ? "?hours=" + encodeURIComponent(qs) : ""), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var live = document.getElementById("live-card");
        if (live && typeof d.liveCard === "string") { live.innerHTML = d.liveCard; }
        var tests = document.getElementById("tests-card");
        if (tests && typeof d.testsCard === "string") { tests.innerHTML = d.testsCard; }
        var sys = document.getElementById("sys-card");
        if (sys && typeof d.sysCard === "string") { sys.innerHTML = d.sysCard; }
        var mgr = document.getElementById("mgr-card");
        if (mgr && typeof d.mgrCard === "string") { mgr.innerHTML = d.mgrCard; }
        var task = document.getElementById("task-card");
        if (task && typeof d.taskCard === "string") { task.innerHTML = d.taskCard; }
        var goal = document.getElementById("goal-card");
        if (goal && typeof d.goalCard === "string") { goal.innerHTML = d.goalCard; }
        var fanin = document.getElementById("fanin-card");
        if (fanin && typeof d.faninCard === "string") { fanin.innerHTML = d.faninCard; }
        if (d.sysRaw && typeof d.sysRaw === "object") {
          var cpu = typeof d.sysRaw.cpuStallAvg10 === "number" ? d.sysRaw.cpuStallAvg10 : null;
          var load = typeof d.sysRaw.loadAvg === "number" ? d.sysRaw.loadAvg : null;
          loadThreshold = typeof d.sysRaw.loadThreshold === "number" ? d.sysRaw.loadThreshold : null;
          if (cpu != null || load != null) {
            sysHistory.push({ cpu: cpu, load: load, ts: d.sysRaw.ts });
            if (sysHistory.length > SYS_HISTORY_MAX) { sysHistory = sysHistory.slice(sysHistory.length - SYS_HISTORY_MAX); }
            redrawSparkline();
          }
        }
      })
      .catch(function () { /* fetch failed — skip this round, retry next */ });
  };
  setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { refresh(); }
  });
})();
</script>`;
}

/** The dashboard sysCard — a self-contained render of the system-resource snapshot, extracted so the
 *  auto-refresh JSON endpoint can re-render it (id="sys-card") without the rest of the dashboard.
 *  Carries a `#sys-sparkline` SVG pre-populated with the legend (sparklineSvg([])); the client-side
 *  poll then fills the history lines + labels in-memory (gap-dashboard-visual-review-batch-fixes AC6 —
 *  the SERVER persists nothing). */
export function renderSysCard(sys: SystemResult): string {
  const sysGo = sys.resourceGate.status === "ok" && sys.processBudget.status === "ok" &&
    sys.resourceGate.verdict === "GO" && sys.processBudget.verdict === "GO";
  return html`<div id="sys-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">系统资源</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.5">cpu_stall ${sys.resourceGate.cpuStallAvg10 != null ? escapeHtml(String(sys.resourceGate.cpuStallAvg10)) : "—"} · loadavg ${sys.resourceGate.loadAvg != null ? escapeHtml(String(sys.resourceGate.loadAvg)) : "—"}</p>
    <div style="font-weight:800;color:${sysGo ? "var(--color-positive-700)" : "var(--color-accent-800)"}">⇒ ${sysGo ? "GO" : sys.resourceGate.status === "ok" ? "WAIT" : "未接入"}</div>
    <svg id="sys-sparkline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" role="img" aria-label="系统负载历史（页面停留期间）" style="width:100%;height:120px;margin-top:4px">${sparklineSvg([], sys.resourceGate.loadThreshold)}</svg>
    <a href="/system" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看系统状态 →</a>
  </div>`;
}

/** The dashboard mgrCard — a self-contained render of every resident driver kind's alive status
 *  (id="mgr-card"). gap-dashboard-driver-status-card: the retired Manager/Outer/Inner probe is no
 *  longer read here; the card renders all KNOWN_KINDS driver alive status + last-record relative
 *  time from the in-process driver-status reading (readDriverStatus in observation.ts — the kind list
 *  arrives INSIDE the reading array, so this card never needs to know the kind list itself). When a
 *  pid file is absent the row reads 「未运行」 — never a bare undefined/NaN/empty (CLAUDE.md 硬规则
 *  3b/4b). A retired kind (outer) renders 「未运行」 rather than being silently omitted — honest
 *  absence, not a hidden hole (AC7). When the whole reading is absent/empty (dashboard error
 *  fallback / product install without the driver kernel), the card reads 「Driver 状态未接入」 — the
 *  honest empty state, not a fabricated per-kind row. */
export function renderMgrCard(mgr: ManagerResult): string {
  const rows = mgr.drivers ?? [];
  return html`<div id="mgr-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Driver</div>
    ${rows.length > 0 ? rows.map(renderDriverStatusRow).join("") : html`<div style="margin:0;font-size:0.8rem;line-height:1.5">Driver 状态未接入</div>`}
    <a href="/manager" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看三层状态 →</a>
  </div>`;
}

/** Render one driver kind's alive-status row: `<kind>: <运行中|未运行> · 末条记录 <relativeTime>`.
 *  A dead reading renders 「未运行」, never `undefined`/`NaN`/empty (absent-field contract, hard rules
 *  3b/4b). */
function renderDriverStatusRow(d: Pick<DriverKindReading, "kind" | "running" | "lastTs">): string {
  const aliveText = d.running === true ? "运行中" : "未运行";
  const lastMs = d.lastTs ? Date.parse(d.lastTs) : Number.NaN;
  const lastText = Number.isFinite(lastMs) ? relativeTime(lastMs) : "—";
  return html`<div style="margin:0;font-size:0.8rem;line-height:1.5"><b>${escapeHtml(d.kind)}</b>: ${aliveText} · 末条记录 ${lastText}</div>`;
}

/** The dashboard taskCard — a self-contained render of the task-ledger summary (id="task-card"):
 *  status-count bar + per-status mini lists for the three NON-terminal states (ready/todo/needs-human);
 *  done/superseded stay pure counts. Extracted so the auto-refresh endpoint can re-render it.
 *
 *  gap-dashboard-taskcard-multistatus-minitable: the taskCard's single mixed "最近更新（非 done）" list
 *  could not answer "what is currently needs-human?" without a full /tasks?status=… round-trip (48h
 *  access log: 78 cross-status /tasks hits in one hour). Replace it with per-status mini lists for the
 *  three NON-terminal states; N=3, updatedAt descending, still /task/<id> links — grouped in-memory from
 *  the already-fetched task-summary array (no new provider read, no new network round-trip).
 *
 *  gap-dashboard-visual-review-batch-fixes AC3: the per-status group heading is a background pill with
 *  font-weight 700, while each row's task id is font-weight 500 (accent colour dropped) — so the grouping
 *  dimension (which used to be the weakest line) reads stronger than the id. */
export function renderTaskCard(
  tasks: TaskSummary[],
): string {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const s = typeof t.status === "string" ? t.status : "unknown";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const statuses = [TASK_STATUS.DONE, TASK_STATUS.READY, TASK_STATUS.TODO, TASK_STATUS.NEEDS_HUMAN, TASK_STATUS.SUPERSEDED];
  const total = tasks.length;
  const bar = (s: string): string => {
    const c = counts.get(s) ?? 0;
    const pct = total > 0 ? (c / total) * 100 : 0;
    return html`<div style="width:${pct.toFixed(1)}%;background:${s === TASK_STATUS.DONE ? "var(--color-text)" : s === TASK_STATUS.NEEDS_HUMAN ? "var(--color-accent)" : "var(--color-neutral-400)"}" title="${escapeHtml(s)} ${c}"></div>`;
  };
  // 人裁定 2026-09-14：3 → 10。三个非终态（ready/todo/needs-human）各自的「最近更新」预览列表原先
  // 截断在 3 条，对小任务量项目（三态合计常年在个位数）经常静默截断本该完整可见的任务。
  // 范围明确限定为这一个常量：不引入自适应阈值、不新增「+N 更多」提示——`renderLiveCard` 的
  // `live.inFlight.slice(0, 3)` 已有该溢出徽标（gap-dashboard-livecard-minilist-overflow-indicator），
  // 这处不一致是真的、已记录在案，留待以后单独立案，不在本任务内顺带处理。
  const MINI_LIST_N = 10;
  const miniStatuses: readonly string[] = [TASK_STATUS.READY, TASK_STATUS.TODO, TASK_STATUS.NEEDS_HUMAN];
  const miniList = (s: string): string => {
    const rows = tasks
      .filter((t) => t.status === s && typeof (t as { updatedAt?: unknown }).updatedAt === "number")
      .sort((a, b) => ((b as { updatedAt?: unknown }).updatedAt as number) - ((a as { updatedAt?: unknown }).updatedAt as number))
      .slice(0, MINI_LIST_N);
    if (rows.length === 0) return "";
    return html`<div style="border-top:1px solid var(--color-divider);margin-top:2px;padding-top:8px;display:flex;flex-direction:column;gap:6px">
      <div style="align-self:flex-start;font-size:0.7rem;font-weight:700;color:var(--color-text);background:var(--color-neutral-200);padding:2px 8px;border-radius:999px">${escapeHtml(s)}（最近 ${MINI_LIST_N} 条）</div>
      ${rows.map((t, i) => {
        const sep = i > 0 ? "border-top:1px solid var(--color-divider);padding-top:6px;" : "";
        const updatedAt = (t as { updatedAt?: unknown }).updatedAt as number;
        return html`<div style="${sep}display:flex;flex-direction:column;gap:2px">
        <a href="/task/${encodeURIComponent(String(t.id))}" style="color:var(--color-neutral-700);text-decoration:none;font-size:0.75rem;font-weight:500">${escapeHtml(String(t.id))}</a>
        <div style="color:var(--color-text);font-size:0.75rem">${escapeHtml(String(t.title ?? ""))}</div>
        <div style="color:var(--color-neutral-700);font-size:0.7rem">${relativeTime(updatedAt)}</div>
      </div>`;
      }).join("")}
    </div>`;
  };

  return html`<div id="task-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">任务台账速览</div>
    <div style="display:flex;height:14px;width:100%;overflow:hidden">${statuses.map(bar).join("")}</div>
    <div style="display:flex;gap:0.75rem;font-size:0.75rem;flex-wrap:wrap;color:var(--color-neutral-700)">
      ${statuses.map((s) => html`<span><b>${counts.get(s) ?? 0}</b> ${escapeHtml(s)}</span>`).join("")}
    </div>
    ${miniStatuses.map(miniList).join("")}
    <a href="/tasks" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看任务列表 →</a>
  </div>`;
}

// ── goal card (G8 / AC-179 / gap-dashboard-goal-card-provider-backed) ────────────────────────────
// The dashboard goalCard — a self-contained render of the ACTIVE GOAL set: per-goal AC progress
// (AC 达成 x/y), the three-state staleness marker (fresh/stale/NOT-EVALUATED), and the I1′ summary
// (activeCount / cap). Goal DATA comes through the Provider ABI (`client.goalList()` — see
// handleDashboard), NEVER a direct goal-store import (AC3): the card derives everything it shows from
// the `GoalRecord[]` the provider returned, mirroring goal-store's own derived quantities
// (isGoalAchieved / checkStaleness) without touching the store.
//
// The two policy scalars (cap, staleMs) are NOT goal data — they are workspace policy from
// `.quay/config.yml`'s `goals:` section. readGoalPolicy() reads them DIRECTLY here (a small mirror of
// goal-store.readGoalConfig) because AC3 forbids importing goal-store: importing the whole store into
// the hot dashboard path for two scalars is exactly the coupling the ABI exists to remove. Defaults
// mirror the store (cap=3, stale=7d) so a bare workspace renders identically.

const DEFAULT_GOAL_CAP = 3;
const DEFAULT_GOAL_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Parse a `goals.stale` duration ("7d" / "12h" / "90m", or bare number = days) → ms. Null when
 *  unparseable (caller falls back to the default). Mirrors goal-store.parseStaleMs. */
function parseGoalStaleMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value * 86400_000;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(d|h|m)$/i);
    if (m) {
      const n = Number(m[1]);
      const mult = m[2].toLowerCase() === "d" ? 86400_000 : m[2].toLowerCase() === "h" ? 3600_000 : 60_000;
      return n * mult;
    }
  }
  return null;
}

/** Read the goal mechanism's two policy scalars (I1′ cap, I3 stale window) from `.quay/config.yml`'s
 *  `goals:` section, falling back to the store's defaults. Never throws (an absent/unparseable config
 *  yields the defaults — the dashboard must render in a bare checkout with no config.yml). */
export function readGoalPolicy(workspaceRoot: string | undefined): { cap: number; staleMs: number } {
  let cap = DEFAULT_GOAL_CAP;
  let staleMs = DEFAULT_GOAL_STALE_MS;
  if (workspaceRoot != null) {
    try {
      const cfgPath = path.join(workspaceRoot, ".quay", "config.yml");
      if (fs.existsSync(cfgPath)) {
        const parsed = YAML.parse(fs.readFileSync(cfgPath, "utf8"));
        const goals = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).goals : undefined;
        if (goals && typeof goals === "object") {
          const g = goals as Record<string, unknown>;
          if (typeof g.cap === "number" && Number.isFinite(g.cap) && g.cap >= 1) cap = g.cap;
          const sd = parseGoalStaleMs(g.stale);
          if (sd !== null) staleMs = sd;
        }
      }
    } catch { /* unparseable config.yml → defaults (never crash the dashboard) */ }
  }
  return { cap, staleMs };
}

/** I3 staleness for ONE active GOAL, DERIVED from its ACs' `evidence.at` max — the SAME derivation
 *  goal-store.checkStaleness uses. Three named states, never a fresh/stale binary: zero ACs (or no
 *  evidence.at anywhere) ⇒ "NOT-EVALUATED" — judging an unevaluated goal "fresh" would record a
 *  never-measured object as healthy (hard rule 3b). */
function goalStaleness(goalId: string, goals: GoalRecord[], staleMs: number, nowMs: number): "fresh" | "stale" | "NOT-EVALUATED" {
  let lastProgressAt: number | undefined;
  for (const ac of goals) {
    if (String(ac.goal ?? "") !== goalId) continue;
    const ev = ac.evidence as { at?: unknown } | undefined;
    if (ev && typeof ev.at === "string") {
      const t = Date.parse(ev.at);
      if (!Number.isNaN(t) && (lastProgressAt === undefined || t > lastProgressAt)) lastProgressAt = t;
    }
  }
  if (lastProgressAt === undefined) return "NOT-EVALUATED";
  return nowMs - lastProgressAt > staleMs ? "stale" : "fresh";
}

/** gap-dashboard-goal-card-ac-denominator-includes-superseded-retired: which AC records still hang on
 *  their goal's accounting, i.e. belong in the 「AC 达成 x/y」 denominator.
 *
 *  Measured cost (2026-09-16): GOAL-020 carries 10 attached criteria, 3 of them `superseded` ⇒ the
 *  card read 「6/10」 and the reader concluded "4 ACs left" (10−6), when only AC-274 was genuinely
 *  open — the 3 superseded ones were already ruled done-with. The true reading is 「6/7」.
 *
 *  ⛔ NOT a `!== "superseded"` check. `retired` is equally real in this store (7 criterion records at
 *  the time of writing) with the SAME "已退场" semantics; excluding only the status that happened to
 *  trigger the report would leave the identical misreading on every goal carrying a retired AC.
 *
 *  ⛔ This deliberately REPLICATES an existing 口径 rather than inventing one. The canonical in-domain
 *  set is `plugin/scripts/goal-driver.ts` `inScopeAcsOf` = `{active, achieved, needs-human}`, and for
 *  good reasons this display surface must not diverge from:
 *   - `draft` is OUT. A draft AC is a written-down proposal awaiting a HUMAN activation (裁定 3:
 *     激活是人的动作) — it is not yet in force, so it is not outstanding work the goal is judged by.
 *     It is also the ordinary state of a goal's ACs right after birth (the store's own birth path is
 *     `file the AC(s) as draft → create GOAL as draft → flip the GOAL to active` — AC-FIRST since
 *     2026-09-17: the write face refuses a GOAL born into {draft, active} with zero ACs, the full
 *     scope of the invariant AC-217, so the AC that names a not-yet-existing GOAL is what makes the
 *     first write legal). Consequence, accepted
 *     and recorded here rather than left to be discovered: a goal whose ACs are all still draft
 *     renders 「0/0」, the same as a goal with no criteria — telling "3 proposals await a ruling" apart
 *     from "nothing here" is a separate concern with its own carrier (the /goal draft banner), not
 *     something to solve by re-defining the denominator.
 *   - `needs-human` is IN — 人 2026-09-09 裁定 2, precisely because a needs-human AC that is not
 *     counted becomes indistinguishable from a draft one ("既不挡 GOAL 达成、也不计缺口，等于白加一个
 *     状态").
 *  ⚠️ 口径分叉会重演「draft 三头不占」 — the driver's own comment's warning. The card's X/Y must agree
 *  with the mechanism's achievement judgment, otherwise a goal can read 「2/3」 on the dashboard while
 *  the loop already considers it achieved.
 *
 *  An unrecognised/absent status is OUT (positive membership, matching `inScopeAcsOf`'s own
 *  `status === "active" || ...` shape). ⚠️ That means a NEW status added to `GOAL_STATUSES` would
 *  silently default to out-of-domain — the same shape this task exists to fix. The guard is the
 *  exhaustiveness test in `gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs`:
 *  every ABI status must be classified explicitly, so adding a 7th forces a decision here. */
export const AC_ROLLUP_IN_DOMAIN_STATUSES: ReadonlySet<string> = new Set(["active", "achieved", "needs-human"]);

/** Is this record in its goal's AC-达成 accounting (⇒ belongs in the denominator)?
 *  The single source for the rule: the dashboard goal card AND the /goal Goals-tab rollup column both
 *  call it, so the two surfaces cannot drift into different 口径. */
export function isAcRollupCounted(status: unknown): boolean {
  return AC_ROLLUP_IN_DOMAIN_STATUSES.has(typeof status === "string" ? status : "");
}

/** The dashboard goalCard. Pure render over the already-read `goals` array (GOAL + AC records as
 *  returned by `client.goalList()`); `cap`/`staleMs`/`nowMs` are injectable for deterministic tests.
 *  Renders an explicit empty state when there are no ACTIVE goals (AC4: the card shows 空态 rather
 *  than disappearing when a goal-less provider degrades goalList to []). */
export function renderGoalCard(
  goals: GoalRecord[],
  opts: { cap?: number; staleMs?: number; nowMs?: number } = {},
): string {
  const nowMs = opts.nowMs ?? Date.now();
  const cap = opts.cap ?? DEFAULT_GOAL_CAP;
  const staleMs = opts.staleMs ?? DEFAULT_GOAL_STALE_MS;
  const activeGoals = goals.filter((g) => g.kind === "goal" && g.status === "active");
  const activeCount = activeGoals.length;

  // gap-dashboard-status-tag-badges: the three-state marker was bare inline color text
  // (color:var(--color-*);font-weight:700) with no background/border, so it blended into the body
  // copy on scan. The existing .tag soft-badge components (never consumed before) give it a
  // background + padding. The per-state colors are the SAME calibrated tokens the inline style used
  // (gap-webui-a11y-focus-ring-and-token-contrast-unvalidated: fresh → positive-700, stale →
  // accent-800, NOT-EVALUATED → neutral-700 at 5.83:1) — now carried by .tag-positive/.tag-accent/
  // .tag-neutral rather than inline.
  const stalenessClass = (s: "fresh" | "stale" | "NOT-EVALUATED"): string =>
    s === "fresh" ? "tag-positive" : s === "stale" ? "tag-accent" : "tag-neutral";

  const rows = activeGoals.map((g) => {
    const gid = String(g.id);
    // Denominator = the goal's ACs that are still IN its accounting, via `isAcRollupCounted`
    // (`{active, achieved, needs-human}` — the same in-domain 口径 goal-driver's `inScopeAcsOf` uses;
    // see the predicate's doc for the measured GOAL-020 「6/10」 misreading and for why `draft`
    // `superseded`/`retired` are out). Both the plain text AND the bar percentage below read this ONE
    // value, so the 口径 cannot split between them.
    const acs = goals.filter((r) => String(r.goal ?? "") === gid && isAcRollupCounted(r.status));
    const achieved = acs.filter((r) => r.status === "achieved").length;
    const state = goalStaleness(gid, goals, staleMs, nowMs);
    // gap-dashboard-goal-card-ac-progress-bar: 「AC 达成 x/y」旁加一条 mini 进度条——复用
    // renderTaskCard bar() 的 `width:{pct}%` 分段条手法，不引入新组件/新依赖。acs.length === 0
    // 时不渲染进度条（只保留纯文本），避免除零产生 NaN/Infinity 宽度；纯文本读者/无障碍场景仍可读。
    // 填充色复用既有 token --color-positive-700（同 staleness 的 fresh 态），不引入新十六进制色值。
    const acBar = acs.length > 0
      ? html`<div style="height:4px;width:100%;background:var(--color-neutral-200);border-radius:999px;overflow:hidden;margin-top:3px"><div style="width:${((achieved / acs.length) * 100).toFixed(1)}%;height:100%;background:var(--color-positive-700)"></div></div>`
      : "";
    return html`<div style="display:flex;flex-direction:column;gap:2px;font-size:0.78rem;line-height:1.4">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;flex-wrap:wrap">
        <a href="/goal/${encodeURIComponent(gid)}" style="color:var(--color-text);text-decoration:none;flex:none">${escapeHtml(gid)}</a>
        <span class="tag ${stalenessClass(state)}" style="flex:none">${escapeHtml(state)}</span>
      </div>
      <div style="color:var(--color-text);font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(String(g.title ?? ""))}</div>
      <div style="color:var(--color-neutral-700)">AC 达成 ${achieved}/${acs.length}${acBar}</div>
    </div>`;
  }).join("");

  const emptyState = activeGoals.length === 0
    ? html`<p style="margin:0;font-size:0.8rem;opacity:0.8">暂无 active GOAL</p>`
    : "";

  return html`<div id="goal-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">阶段目标</div>
    <div style="font-weight:800">active ${activeCount} / cap ${cap}</div>
    ${emptyState}
    ${rows}
    <a href="/goal" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Goals →</a>
  </div>`;
}

/** The dashboard fan-in card — cross-task mechanical fan-in summary (list + segmented bar), added by
 *  gap-dashboard-fanin-panel-and-timeline-bars H. Unlike /task/<id>'s Runs block (filtered by ONE task),
 *  this aggregates EVERY worker-outcome record carrying a mechanical_fan_in result, sorted by
 *  lock-acquire time (desc), reusing renderFanInCell for each row (no second field-join). */
export function renderFanInCard(
  root: string | undefined,
  opts: { hours?: number; nowMs?: number } = {},
): string {
  const records = root != null ? readWorkerOutcomeRecords(root) : [];
  return renderFanInCardFromRecords(records, opts);
}

/** Pure card-body renderer (the AC4/AC5 test seam): list + timeline bar from an already-read records
 *  array, so the sort / null-filter / segment-count logic is unit-testable on a fixed array without a
 *  disk fixture. */
export function renderFanInCardFromRecords(
  records: WorkerOutcomeRecord[],
  opts: { hours?: number; nowMs?: number } = {},
): string {
  const nowMs = opts.nowMs ?? Date.now();
  const hours = opts.hours ?? DEFAULT_TIMELINE_HOURS;
  const fanIns = records.filter((r) => r.mechanical_fan_in != null);

  // Sort key (seconds): lockAcquireEpoch, falling back to the carrier's ts. Shared by the list sort
  // AND the window-end anchor below so both read the SAME "latest" ordering (single source, no drift).
  const keySec = (r: WorkerOutcomeRecord): number => {
    const mfi = r.mechanical_fan_in!;
    return mfi.lockAcquireEpoch != null
      ? mfi.lockAcquireEpoch
      : r.ts != null
        ? Date.parse(r.ts) / 1000
        : NaN;
  };

  const rows = fanIns
    .map((r) => ({ r, key: keySec(r) }))
    .sort((a, b) => {
      const an = Number.isFinite(a.key) ? a.key : -Infinity;
      const bn = Number.isFinite(b.key) ? b.key : -Infinity;
      return bn - an;
    })
    .slice(0, 5)
    .map(({ r, key }, i) => {
      // gap-dashboard-fanin-timestamp-timeline-anchor 缺陷1: each row ALSO renders its acquire time
      // (relativeTime over the sort key, seconds → ms) — the same F-fix idiom testsCard uses.
      // renderFanInCell never carries a timestamp (it is a /task/<id> cell; that page has its own
      // time column), so the card adds the sub-row itself. Absent key → no sub-row (absent-field
      // contract, never a "—").
      const tsLine = Number.isFinite(key)
        ? html`<div style="color:var(--color-neutral-700)">${relativeTime(key * 1000)}</div>`
        : "";
      return html`<div style="${i > 0 ? "border-top:1px solid var(--color-divider);padding-top:6px;" : ""}display:flex;flex-direction:column;gap:2px;font-size:0.75rem;line-height:1.4">
        <a href="/task/${encodeURIComponent(r.task ?? "")}" title="${escapeHtml(r.task ?? "")}" style="color:var(--color-text);text-decoration:none;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.task ?? "?")}</a>
        <div style="color:var(--color-neutral-700)">${renderFanInCell(r.task ?? "", r, { showReason: false, layout: "inline" })}</div>
        ${tsLine}
      </div>`;
    });
  const list = rows.length > 0
    ? html`<div style="display:flex;flex-direction:column;gap:4px">${rows.join("")}</div>`
    : html`<p style="margin:0;font-size:0.8rem;opacity:0.8">暂无 fan-in 记录</p>`;

  const segments = fanIns.map((r) => {
    const mfi = r.mechanical_fan_in!;
    return {
      startMs: mfi.lockAcquireEpoch != null ? mfi.lockAcquireEpoch * 1000 : NaN,
      endMs: mfi.lockReleaseEpoch != null ? mfi.lockReleaseEpoch * 1000 : NaN,
      colorVar: fanInOutcomeColorToken(mfi.outcome),
    };
  });
  // gap-dashboard-fanin-timestamp-timeline-anchor 缺陷2 (H): window end = the latest fan-in's own end
  // (lockReleaseEpoch, falling back to the same record's lockAcquireEpoch), NOT the wall-clock now.
  // Same "latest" ordering as the list (keySec). No usable record → fall back to nowMs (never NaN).
  let windowEndMs: number | null = null;
  let latestKey = -Infinity;
  for (const r of fanIns) {
    const k = keySec(r);
    if (!Number.isFinite(k) || k <= latestKey) continue;
    latestKey = k;
    const mfi = r.mechanical_fan_in!;
    const endSec = mfi.lockReleaseEpoch ?? mfi.lockAcquireEpoch;
    if (endSec != null && Number.isFinite(endSec)) windowEndMs = endSec * 1000;
  }
  const bar = renderTimelineBarSvg(segments, hours, windowEndMs ?? nowMs);

  return html`<div id="fanin-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Fan-in</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">最近 ${rows.length} 次机械 fan-in（landed/red · 锁持有区间）</p>
    ${bar}
    ${list}
  </div>`;
}

/**
 * Truncated reason summary for the dashboard's 「最近提交」 git card. Keeps the recognisable
 * 「读失败」 prefix (a fixed literal other subsystems treat as the unreadable-vs-empty discriminator)
 * and appends a bounded, HTML-escaped reason so the specific cause (e.g. a deleted worktree path)
 * is visible rather than collapsed to three characters. gap-git-history-lane-identity-and-row-layout-overlap.
 */
export function gitReadFailureSummary(reason: string | null | undefined): string {
  const r = String(reason ?? "").replace(/\s+/g, " ").trim();
  const cap = r.length > 160 ? `${r.slice(0, 157)}…` : r;
  return cap ? `读失败 — ${escapeHtml(cap)}` : "读失败";
}

// ── Dashboard card grid (gap-dashboard-grid-autofit-columns-vs-card-count) ───────────────────────
// The three dashboard grids used to inline `repeat(auto-fit, minmax(240px, 1fr))`: the column count
// was derived from the CONTAINER WIDTH, with no constraint linking it to the card count. At the
// production <main> width (870px) floor(870/240) = 3 columns, so the 4-card 「工作进展」 row wrapped
// its 4th card onto a 2nd row and left 2 empty slots that showed the container's --color-divider
// background as a large dark void — the divider colour is meant to show only through the 2px gaps,
// never as an empty-slot fill. Binding the column count to the CARD count (gridColumns(n) →
// repeat(n, minmax(0,1fr))) makes columns == cards at every width, so a row can never have an empty
// slot. The ≤600px media query in dashboardGridStyles collapses the grid to a single column to
// preserve the vertical stacking auto-fit used to give mobile (a 4-card row must not squeeze to
// ~90px/card at 390px).

/** Column template bound to the card count: n cards → n columns. `minmax(0,1fr)` lets each column
 *  shrink below its content min-width (grid items default to min-width:auto, which would overflow
 *  with long unbreakable content like the monospace 最近提交 card). */
export function gridColumns(cardCount: number): string {
  return `repeat(${cardCount}, minmax(0, 1fr))`;
}

/** Render one dashboard card-grid row: column count bound to cards.length (0 empty slots at any
 *  viewport) — the falsifiable inverse of the old always-3-column auto-fit template. */
export function renderCardGrid(cards: string[], opts: { marginBottom?: boolean } = {}): string {
  const margin = opts.marginBottom ? "margin-bottom:1.5rem;" : "";
  return html`<div class="dash-grid" style="display:grid;grid-template-columns:${gridColumns(cards.length)};gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);${margin}">${cards.join("")}</div>`;
}

/** The dashboard's top row is asymmetric BY DESIGN (gap-dashboard-top-row-asymmetric-columns) and
 *  does NOT reuse gridColumns()/renderCardGrid() — those stay card-count-bound and equal-width for
 *  the 工作进展 / 变更记录 rows. The 循环脉搏 card is by far the tallest of the three (a long in-flight
 *  task description wraps to ~8 lines at the old 287px column width, driving the row height), while
 *  系统资源 and DRIVER are short and were ~45%/~48% blank when stretch-aligned to the live card's
 *  height. A fixed 3fr:2fr two-column split widens the live card (fewer wrapped lines) and stacks the
 *  two short cards in the right column, collapsing two large voids into one smaller one. It keeps the
 *  .dash-grid class so the ≤600px single-column media query still collapses it (both grid items become
 *  full-width rows; the right column's flex stack is unaffected). */
export function renderTopRow(liveCard: string, sysCard: string, mgrCard: string): string {
  return html`<div class="dash-grid" style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem;">${liveCard}<div style="display:flex;flex-direction:column;gap:2px">${sysCard}${mgrCard}</div></div>`;
}

/** The 工作进展 row is paired into two equal-width columns BY DESIGN (gap-dashboard-workprogress-row-paired-columns)
 *  and does NOT reuse gridColumns()/renderCardGrid() — those stay card-count-bound for the 变更记录 row
 *  (and the pure helpers), while this row now carries exactly 2 grid items (two flex stacks) instead of
 *  4 cards. The four cards are all unbounded dynamic lists whose natural heights drift with content (the
 *  task ledger alone was measured at 966–1684px), so stretch-aligning four equal-width columns to the
 *  tallest card left the 阶段目标 card ~88% and the tests card ~71% blank. Exhaustive pairing measured the
 *  (任务台账速览 + 阶段目标 | 测试 + FAN-IN) split at 1232px vs 1261px at 433px half-width — 2.3% apart, the
 *  most balanced of the four pairings, and semantically coherent (left = progress board, right =
 *  verification pipeline). Left column stacks goalCard above taskCard (阶段目标 上, 任务台账速览 下 — per the
 *  human's specified order), right column stacks testsCard above fanCard (测试 上, FAN-IN 下 — the original
 *  left-to-right 阶段目标→测试→FAN-IN order with 测试 moved above FAN-IN). This pairing is the most
 *  imbalance-resistant of the four, NOT a guarantee of permanent zero-whitespace. Keeps the .dash-grid
 *  class so the ≤600px single-column media query still collapses it (each column becomes a full-width
 *  row; the inner flex stacks are unaffected). */
export function renderWorkProgressRow(goalCard: string, taskCard: string, testsCard: string, fanCard: string): string {
  return html`<div class="dash-grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem;"><div style="display:flex;flex-direction:column;gap:2px">${goalCard}${taskCard}</div><div style="display:flex;flex-direction:column;gap:2px">${testsCard}${fanCard}</div></div>`;
}

/** The .dash-grid sheet: the ≤600px single-column collapse. Split from the inline style because a
 *  media query cannot live in a style attribute. The `!important` is required to beat the inline
 *  `grid-template-columns` (inline styles outrank class selectors — this is the standard override
 *  for an inline-style + media-query combination). gap-dashboard-cards-layout-and-livecard-swimlane
 *  AC7: the column is `minmax(0,1fr)` — a bare `1fr` has an implicit `auto` minimum (the content's
 *  min-content width), so a single long unbreakable in-flight row pushed the whole page to
 *  `scrollWidth ≈ 4× the viewport` on mobile. `minmax(0,1fr)` clamps that minimum to 0 exactly like
 *  the desktop `gridColumns()` template. */
export const dashboardGridStyles = `<style>
  @media (max-width:600px) {
    .dash-grid { grid-template-columns:minmax(0,1fr) !important; }
  }
</style>`;

export function renderDashboardPage(
  d: {
    live: LiveResult;
    sys: SystemResult;
    mgr: ManagerResult;
    tests: TestsResult;
    suiteRun: CurrentSuiteRun | null;
    history: GitHistoryResult;
    tasks: TaskSummary[];
    goals?: GoalRecord[];
  },
  opts: { workspaceRoot?: string; hours?: number; nowMs?: number; identity?: ServeIdentity | null; workerOutcomes?: WorkerOutcomeRecord[] } = {},
): string {
  const nowMs = opts.nowMs ?? Date.now();
  const hours = opts.hours ?? DEFAULT_TIMELINE_HOURS;
  // gap-dashboard-live-swimlane-fixed-lane-gantt-timeline: read the worker-outcome history ONCE and
  // feed it to BOTH the liveCard gantt and the fan-in card (same data source, no second I/O path).
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: a caller holding a snapshot passes the
  // already-read records in, so the request path performs NO reader I/O (the disk read stays on the
  // background rebuild). Absent ⇒ read here, i.e. the legacy in-request behaviour, unchanged.
  const workerOutcomes = opts.workerOutcomes ?? (opts.workspaceRoot != null ? readWorkerOutcomeRecords(opts.workspaceRoot) : []);
  const liveCard = renderLiveCard(d.live, nowMs, d.tasks, workerOutcomes, hours);
  const sysCard = renderSysCard(d.sys);
  const mgrCard = renderMgrCard(d.mgr);
  const taskCard = renderTaskCard(d.tasks);
  const testsCard = renderTestsCard(d.tests, d.suiteRun, { hours, nowMs });
  const fanInCard = renderFanInCardFromRecords(workerOutcomes, { hours, nowMs });
  const { cap, staleMs } = readGoalPolicy(opts.workspaceRoot);
  const goalCard = renderGoalCard(d.goals ?? [], { cap, staleMs, nowMs });

  const recentCommits = d.history.status === "ok"
    ? d.history.commits.slice(0, 3).map((c) => `${c.hash.slice(0, 7)} ${c.subject}`).join("<br>")
    : (d.history.status === "empty" ? "无提交" : gitReadFailureSummary(d.history.reason));
  const commitsCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">最近提交</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.6;font-family:ui-monospace,monospace">${recentCommits}</p>
    <a href="/journal" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Journal →</a>
  </div>`;
  const gitHistoryCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Git History</div>
    <p style="margin:0;font-size:0.8rem">提交纵向时间轴（develop 主干 + task 分支，第三方库客户端渲染）。</p>
    <a href="/git-history" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Git History →</a>
  </div>`;

  // gap-dashboard-fanin-panel-and-timeline-bars (window presets): a small set of page-reload links that
  // set the shared G/H timeline window. The refresh script carries the current ?hours= into its own
  // /dashboard/cards poll, so a preset change survives the 30s auto-refresh without the bars jumping.
  const hourLinks = [1, 3, 6, 12]
    .map((n) => html`<a href="/dashboard?hours=${n}" style="color:var(--color-accent);text-decoration:none;${n === hours ? "font-weight:700" : ""}">${n}h</a>`)
    .join(" · ");

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay dashboard — 循环脉搏、任务台账、系统资源与三层状态总览">${modernistStyles()}${pageStyles()}${dashboardGridStyles}<title>${pageTitle("Dashboard", opts.identity)}</title></head>
    <body>${renderMobileChrome("dashboard", "dashboard")}${renderSiteNav("dashboard")}<main id="main">
      <h1>Dashboard</h1>
      <p class="meta">循环脉搏、任务台账、系统资源与三层调度状态的总览 — 每张卡片指向对应完整页面。</p>
      <p class="meta">时间轴窗口（以各自最近一次运行/fan-in 结束时刻为终点的过去 ${hours}h）：${hourLinks}</p>
      ${opts.identity ? renderIdentityCard(opts.identity) : ""}
      ${renderTopRow(liveCard, sysCard, mgrCard)}
      <h2>工作进展</h2>
      ${renderWorkProgressRow(goalCard, taskCard, testsCard, fanInCard)}
      <h2>变更记录</h2>
      ${renderCardGrid([commitsCard, gitHistoryCard])}
    </main>${renderDashboardCardRefreshScript()}</body></html>`;
}

/** Build the `/dashboard/cards` JSON payload object (before `JSON.stringify`), extracted so the AC3
 *  registration-completeness check can read the REAL payload keys rather than a hand-copied list — a
 *  card added here but missing from the page render or the swap script is caught by comparing the
 *  three sets (gap-dashboard-fanin-card-not-in-auto-refresh), never by remembering to update a fixture. */
export function buildCardsPayload(args: {
  live: LiveResult;
  sys: SystemResult;
  mgr: ManagerResult;
  tests: TestsResult;
  suiteRun: CurrentSuiteRun | null;
  tasks: TaskSummary[];
  goals: GoalRecord[];
  workspaceRoot: string;
  hours: number;
  cap: number;
  staleMs: number;
  /** Pre-read worker-outcome history (a snapshot caller passes it in so this path does no reader
   *  I/O). Absent ⇒ read from disk here — the legacy in-request behaviour, unchanged. */
  workerOutcomes?: WorkerOutcomeRecord[];
}): Record<string, unknown> {
  const { live, sys, mgr, tests, suiteRun, tasks, goals, workspaceRoot, hours, cap, staleMs } = args;
  // gap-dashboard-live-swimlane-fixed-lane-gantt-timeline: same single-read worker-outcome history fed
  // to both the liveCard gantt and the fan-in card (the /dashboard/cards auto-refresh path).
  const workerOutcomes = args.workerOutcomes ?? (workspaceRoot != null ? readWorkerOutcomeRecords(workspaceRoot) : []);
  return {
    liveCard: renderLiveCard(live, Date.now(), tasks, workerOutcomes, hours),
    testsCard: renderTestsCard(tests, suiteRun, { hours }),
    sysCard: renderSysCard(sys),
    mgrCard: renderMgrCard(mgr),
    taskCard: renderTaskCard(tasks),
    goalCard: renderGoalCard(goals, { cap, staleMs }),
    faninCard: renderFanInCardFromRecords(workerOutcomes, { hours }),
    sysRaw: {
      cpuStallAvg10: sys.resourceGate.cpuStallAvg10,
      loadAvg: sys.resourceGate.loadAvg,
      loadThreshold: sys.resourceGate.loadThreshold,
      ts: Date.now(),
    },
  };
}

/** Registration-completeness check (gap-dashboard-fanin-card-not-in-auto-refresh AC3 — 防复发):
 *  every card the page renders as `id="*-card"` must ALSO appear as a `/dashboard/cards` payload key
 *  (mapped `xxxCard` → `xxx-card`) AND as a `getElementById("*-card")` swap target in the auto-refresh
 *  script. A card on only one side is a wiring gap (renders but never refreshes, or a swap target with
 *  no payload). Pure — returns a result object instead of throwing, so a unit test can assert `ok` AND
 *  inspect the per-side diff. The negative control (a page with one extra card ⇒ ok:false) is what
 *  makes this a measurement rather than a恒真恒等式 (hard rule 4). */
export interface CardRegistrationDiff {
  ok: boolean;
  pageCards: string[];
  payloadCards: string[];
  scriptCards: string[];
  pageOnly: string[];
  payloadOnly: string[];
  scriptOnly: string[];
}

export function checkCardRegistrationCompleteness(
  pageHtml: string,
  payload: Record<string, unknown>,
  refreshScript: string,
): CardRegistrationDiff {
  const uniq = (xs: string[]): string[] => Array.from(new Set(xs)).sort();
  const pageCards = uniq(Array.from(pageHtml.matchAll(/id="([a-z-]+-card)"/g), (m) => m[1]));
  // Drop non-card keys (sysRaw) by requiring the `xxxCard` suffix, then map camelCase → kebab-case.
  const payloadCards = uniq(
    Object.keys(payload)
      .filter((k) => k.endsWith("Card"))
      .map((k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
  );
  const scriptCards = uniq(Array.from(refreshScript.matchAll(/getElementById\("([a-z-]+-card)"\)/g), (m) => m[1]));
  // "Unique to a side" = present there but missing from at least one of the other two. The OR form
  // (not the intersection) guarantees a non-empty diff whenever ok is false — the AND form would
  // return empty lists on a partial mismatch and masquerade a gap as "everything accounted for"
  // (hard rule 3b).
  const pageOnly = pageCards.filter((c) => !payloadCards.includes(c) || !scriptCards.includes(c));
  const payloadOnly = payloadCards.filter((c) => !pageCards.includes(c) || !scriptCards.includes(c));
  const scriptOnly = scriptCards.filter((c) => !pageCards.includes(c) || !payloadCards.includes(c));
  const eq = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  return {
    ok: eq(pageCards, payloadCards) && eq(payloadCards, scriptCards),
    pageCards,
    payloadCards,
    scriptCards,
    pageOnly,
    payloadOnly,
    scriptOnly,
  };
}

// ── Task-summary short-TTL cache (dashboard display surface only) ────────────────────────────────
// gap-webui-dashboard-load-time-optimization AC3: the dashboard's taskCard shows only STATUS COUNTS
// + the 5 most-recently-updated non-done tasks, yet the pre-cache path called
// client.taskList({includeBody:false}) on EVERY /dashboard load — a full walkTasks() over the task
// store (listIds() → get() per id = readFileSync + statSync + YAML.parse). Measured ~89ms warm /
// ~640ms cold on the live store, plus the MCP subprocess round-trip. This cache (the poolMetricsCache
// 范式 in observation.ts: 30s TTL, keyed by workspaceRoot so two served workspaces never share a
// board) holds the whole frontmatter-only array the summary is derived from — on a hit,
// client.taskList is never called, so the provider's walkTasks never executes (the AC3 mechanical
// check). A 30s TTL bounds staleness: the dashboard is a display snapshot; the task store itself
// (which the promotion-driver writes on todo→ready) is always read fresh, never through this cache.
export const TASK_SUMMARY_CACHE_TTL_MS = 30_000;

/** A frontmatter-only task summary (the `includeBody:false` shape `readTaskSummary` returns). The
 *  `goal_ac` field (task→AC linkage, G7) joined the shape via gap-webui-goal-task-rollup-via-shared-
 *  summary-cache so the /goal rollup can consume the structured relationship WITHOUT a second read
 *  — it rides the SAME cached array the dashboard taskCard already uses. */
export interface TaskSummary {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  labels?: unknown;
  updatedAt?: unknown;
  goal_ac?: unknown;
}

const taskSummaryCache = new Map<string, { at: number; tasks: TaskSummary[] }>();

/** Test-hygiene handle: drop all cached task-summary readings. */
export function clearTaskSummaryCache(): void {
  taskSummaryCache.clear();
}

/** Dashboard task-summary source: client.taskList({includeBody:false}), short-TTL-cached per
 *  workspace root. On a hit the provider is not contacted, so its walkTasks() does not run (the AC3
 *  mechanical check). A failed read is NOT cached — the next load retries instead of pinning the
 *  error for the whole TTL (same fail-open policy as poolMetricsCache).
 *
 *  AC136 (gap-ac136-web-truth-source-follows-driver): the task ledger's truth source is the task
 *  store itself (tasks/*.md frontmatter) — the SAME store the promotion-driver writes on todo→ready.
 *  So a driver-completed promotion is reflected here (status count + 最近更新) within the 30s TTL,
 *  with no separate carrier read needed: reading client.taskList IS reading the driver's write
 *  target (口径一致). */
export async function readTaskSummary(
  root: string,
  client: ProviderClient,
): Promise<TaskSummary[]> {
  const hit = taskSummaryCache.get(root);
  if (hit && Date.now() - hit.at < TASK_SUMMARY_CACHE_TTL_MS) return hit.tasks;
  const r = await client.taskList({ includeBody: false });
  const tasks = r.tasks ?? [];
  taskSummaryCache.set(root, { at: Date.now(), tasks });
  return tasks;
}

// ── Dashboard live snapshot cache (gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks) ──
// The dashboard's liveCard renders taskId / phase / elapsed / title — elapsed is re-derived at render
// time from each in-flight task's FIXED startedAtMs (renderLiveCard passes a fresh nowMs), so caching
// the readLive RESULT for 30s does NOT freeze the displayed elapsed. The cache only skips re-running
// readLive's own expensive I/O (workflow-events read, worker carrier reads, /proc scan, per-task
// develop-ref status reads). computeBlocking is OFF: the liveCard never renders blocks/blockedBy, so
// the full task-store scan (the cost that grows with the store) is skipped entirely. Keyed by root
// (the same bucket discipline as taskSummaryCache).
export const DASHBOARD_LIVE_CACHE_TTL_MS = 30_000;
const dashboardLiveCache = new Map<string, { at: number; live: LiveResult }>();

/** Test-hygiene handle: drop all cached dashboard live snapshots. */
export function clearDashboardLiveCache(): void {
  dashboardLiveCache.clear();
}

/** The dashboard's readLive: short-TTL-cached, computeBlocking disabled. A cache hit returns the SAME
 *  LiveResult object without re-running readLive's I/O; on a miss it runs readLive once (no task-store
 *  scan) and caches it for the TTL. */
function readDashboardLive(root: string): LiveResult {
  const hit = dashboardLiveCache.get(root);
  if (hit && Date.now() - hit.at < DASHBOARD_LIVE_CACHE_TTL_MS) return hit.live;
  const live = readLive(root, { computeBlocking: false });
  dashboardLiveCache.set(root, { at: Date.now(), live });
  return live;
}

// gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks: readSystem / readManagerLight are the
// dashboard's last two UN-cached probes — they shell out to resource-gate.sh / process-budget.sh /
// loop-driver-check.sh on EVERY render (~2s combined, host-load-dependent), which is what pushes a warm
// dashboard past the 5s budget when a 15s background-refresh tick collides. The dashboard is a display
// snapshot with a 30s auto-refresh (DASHBOARD_CARD_REFRESH_MS), so these two probes get the SAME 30s
// snapshot cache as readLive/taskSummary — a cache hit returns the resolved value with zero subprocess
// spawns. Only SUCCESSFUL reads are cached (a failed probe is re-run next request, same fail-open
// policy as poolMetricsCache). The /system and /manager DETAIL pages keep calling the uncached readers,
// so a human opening those pages still gets a fresh reading.
const dashboardSysCache = new Map<string, { at: number; value: SystemResult }>();
const dashboardMgrLightCache = new Map<string, { at: number; value: ManagerResult }>();

/** Test-hygiene handle: drop all cached dashboard system/manager snapshots. */
export function clearDashboardProbeCache(): void {
  dashboardSysCache.clear();
  dashboardMgrLightCache.clear();
}

async function readDashboardSystem(root: string): Promise<SystemResult> {
  const hit = dashboardSysCache.get(root);
  if (hit && Date.now() - hit.at < DASHBOARD_LIVE_CACHE_TTL_MS) return hit.value;
  const value = await readSystem(root);
  dashboardSysCache.set(root, { at: Date.now(), value });
  return value;
}

async function readDashboardManagerLight(root: string): Promise<ManagerResult> {
  const hit = dashboardMgrLightCache.get(root);
  if (hit && Date.now() - hit.at < DASHBOARD_LIVE_CACHE_TTL_MS) return hit.value;
  const value = await readManagerLight(root);
  dashboardMgrLightCache.set(root, { at: Date.now(), value });
  return value;
}

// ── Dashboard SNAPSHOT + background rebuild (gap-ac179-criterion-cold-miss-30s-ttl-always-expired) ─
//
// WHY THIS EXISTS. Every reader `/dashboard` needs is 30s-TTL cached, and the dashboard's own browser
// auto-refresh polls at 30s — so on the *steady* path the caches look warm. The AC-179 goal criterion
// is not on that path: it is a goal-sweep that re-runs **once per hour**. Two requests an hour is
// structurally outside EVERY 30s TTL, so each re-run is a guaranteed COLD miss and pays the full build
// inside the request: measured on the live store, 19.17 s cold vs 1.61 s warm, against the criterion's
// fixed `curl --max-time 10`. The failure is intermittent (660 passes then one fail), which is the
// worst shape — an intermittent fail is indistinguishable from a real defect in the ledger.
//
// ⊢ The fix cannot be "a longer TTL" (the first request is always cold) and cannot be a bigger
// `--max-time` (a constant that depends on the host load will always flip back — hard rule 4
// corollary 2). The required property is ONE: **the request path must not carry the build cost.**
// So the build moves to a background tick and requests read a snapshot.
//
// ⊢ Why a snapshot and not merely "warm the caches": with warm caches a request is still coupled to
// the TTL — one expired reader and the request pays that reader. A snapshot is a value the request
// path reads unconditionally, so the request cost no longer depends on when the last refresh ran.
//
// ⊢ Why the rebuild is COOPERATIVE (awaits `yieldToEventLoop` between readers, and parses the 70 MB
// verification ledger through `readTestsNonBlocking`): the sync readers block the event loop
// (`readLive` alone spends ~0.6 s in `spawnSync`; a sync parse of the ledger is ~1.6 s). A single
// blocking rebuild would stall every concurrent request — `/health` included — which is exactly what
// AC4 forbids. Each blocking reader therefore gets its OWN macrotask, so the longest a concurrent
// request can wait is ONE reader, never their sum.

/** Snapshot refresh period (ms). Matches the readers' own 30s TTL and the dashboard's 30s client
 *  auto-refresh, so the snapshot is never staler than the page's existing freshness contract. */
export const DASHBOARD_SNAPSHOT_REFRESH_MS = 30_000;

/** Kill switch for the whole mechanism. Setting it to "1" makes BOTH the tick and the request-path
 *  snapshot lookup inert, so `/dashboard` falls back to the legacy in-request build — the negative
 *  control that proves the fix (and not the host) is what makes the criterion's first request fast. */
export const DASHBOARD_SNAPSHOT_DISABLED_ENV = "QUAY_DASHBOARD_SNAPSHOT_DISABLED";

/** Everything `/dashboard` renders from root-only + client reads, captured at one instant. Holding
 *  the VALUES (not a rendered page) keeps the page render pure and lets the request path choose
 *  `?hours=` per request without rebuilding. */
export interface DashboardSnapshot {
  builtAt: number;
  live: LiveResult;
  sys: SystemResult;
  mgr: ManagerResult;
  tests: TestsResult;
  suiteRun: CurrentSuiteRun | null;
  history: GitHistoryResult;
  tasks: TaskSummary[];
  goals: GoalRecord[];
  workerOutcomes: WorkerOutcomeRecord[];
}
// ⊢ `goals` IS snapshotted, and the reason is a MEASUREMENT that contradicts the plan's estimate. The
// plan budgeted `client.goalList()` at ~6 ms (a direct-import reading) and therefore allowed it to
// stay on the request path. Through the real Provider ABI it is an MCP round-trip over the live goal
// store: measured 987 ms on this workspace, and on a loaded host the whole `/dashboard` request
// reached 7.3 s — i.e. the residual was itself a host-dependent constant of exactly the kind this
// task exists to remove (hard rule 4 corollary 2). Rendering, by contrast, measured 36 ms for the
// whole page (`renderDashboardPage`, 1686 rounds + 1909 outcomes + 2138 tasks).
//
// ⊢ `goals` was also the ONLY field with no TTL cache on the request path, so snapshotting it is the
// one place this change *adds* staleness (bounded by DASHBOARD_SNAPSHOT_REFRESH_MS, the same bound
// every other card already had). The card still renders REAL data — an active GOAL's achieved/total
// AC count and its fresh/stale/NOT-EVALUATED marker — just up to one tick old, which is exactly the
// contract the dashboard's other cards have always had.

const dashboardSnapshots = new Map<string, DashboardSnapshot>();
const dashboardSnapshotRebuilds = new Map<string, Promise<void>>();
/** Per root, the ONE follow-up rebuild coalescing every `rebuildNow()` caller that arrived while a
 *  build was already in flight (see RebuildPolicy). Distinct from `dashboardSnapshotRebuilds`, which
 *  tracks the build that is actually running. */
const dashboardSnapshotFollowUps = new Map<string, Promise<void>>();

/** True when the snapshot mechanism is switched off (see DASHBOARD_SNAPSHOT_DISABLED_ENV). Read at
 *  CALL time, not at module load, so a test can flip it per test. */
export function dashboardSnapshotDisabled(): boolean {
  return process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV] === "1";
}

/** The snapshot for `root`, or null when none has been built yet. **Sync and non-building** — this is
 *  the request path's whole lookup, and it never awaits, so a request can never be made to wait for a
 *  rebuild (AC3). */
export function peekDashboardSnapshot(root: string): DashboardSnapshot | null {
  if (dashboardSnapshotDisabled()) return null;
  return dashboardSnapshots.get(root) ?? null;
}

/** Test seam: an optional hook awaited BETWEEN the rebuild's cooperative steps. Production never sets
 *  it. It lets a test hold a rebuild open and observe what concurrent requests see WHILE it runs —
 *  rather than racing a fixture rebuild that finishes in microseconds. */
let dashboardSnapshotStepHook: (() => Promise<void>) | null = null;
export function setDashboardSnapshotStepHook(hook: (() => Promise<void>) | null): void {
  dashboardSnapshotStepHook = hook;
}

/** Test-hygiene handle: drop every snapshot, in-flight rebuild marker and refresh registration. */
export function clearDashboardSnapshots(): void {
  dashboardSnapshots.clear();
  dashboardSnapshotRebuilds.clear();
  dashboardSnapshotFollowUps.clear();
  dashboardSnapshotStepHook = null;
}

/** True while a rebuild for `root` is in flight — the read AC3/AC4's measurement needs (a direct
 *  reading of the mechanism's own state, not an inference from a timestamp). */
export function isDashboardSnapshotRebuilding(root: string): boolean {
  return dashboardSnapshotRebuilds.has(root);
}

/** Await the rebuild for `root`, if any (test seam — the request path never does this).
 *
 *  When a follow-up is queued it is preferred over the running build: the follow-up resolves strictly
 *  after the incumbent (it is chained onto it), so awaiting it is the reading that means "the store
 *  is reflected now" rather than "that older build finished". */
export function awaitDashboardSnapshotRebuild(root: string): Promise<void> {
  return dashboardSnapshotFollowUps.get(root) ?? dashboardSnapshotRebuilds.get(root) ?? Promise.resolve();
}

/** True when a follow-up rebuild is queued for `root` (an explicit `rebuildNow()` arrived while a
 *  build was in flight). Distinct from `isDashboardSnapshotRebuilding`, which reports the build that
 *  is RUNNING — together they are the honest reading of the two waits this mechanism can be in. */
export function isDashboardSnapshotFollowUpQueued(root: string): boolean {
  return dashboardSnapshotFollowUps.has(root);
}

const EMPTY_LIVE: LiveResult = { status: "error", reason: "internal", inFlight: [], concurrencyCap: DEFAULT_DRIVER_CAP, cpuPressure: null, liveState: null, liveExplanation: null, activity: null };
const EMPTY_SYS: SystemResult = { status: "error", reason: "internal", resourceGate: { status: "error", reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }, processBudget: { status: "error", reason: null, totalBudget: null, inUse: null, available: null, verdict: null } };
const EMPTY_MGR: ManagerResult = { status: "error", reason: "internal", loopDriver: { status: "error", reason: null, verdict: null, exitCode: null, detail: null }, liveness: { status: "error", reason: null, sessions: [] }, observers: { status: "error", reason: null, rows: [] }, pool: { status: "error", reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] }, version: null, developLead: null };
const EMPTY_HISTORY: GitHistoryResult = { status: "error", reason: "internal", commits: [], head: null, heads: {}, mainlineHead: null };

/** Build one snapshot. Cooperative by construction: the async probes are started FIRST (their
 *  shell-outs run in the OS while the sync steps below yield), each blocking reader gets its own
 *  macrotask, and the 70 MB ledger goes through the sliced/yielding reader. Never throws — a reader
 *  that fails yields the same honest error shape the request path already used.
 *
 *  `onInterim` is called with a COMPLETE-ENOUGH snapshot BEFORE waiting on the two shell-out probes
 *  (readDashboardSystem / readDashboardManagerLight — the long pole: measured 7 s + 1.9 s idle, and
 *  tens of seconds under host load). Without it, a process that was just started has NO snapshot for
 *  as long as that pole takes, and every request in that window falls back to the legacy in-request
 *  build — measured: on a loaded host the very first criterion-shaped request after a restart hit
 *  the 10 s cap. Which is the same intermittent failure this task exists to remove, just moved to
 *  the restart window. With it, the cold window costs the cheap readers only. */
export async function buildDashboardSnapshot(
  root: string,
  client: ProviderClient,
  { onInterim, previous }: { onInterim?: (snap: DashboardSnapshot) => void; previous?: DashboardSnapshot | null } = {},
): Promise<DashboardSnapshot> {
  // The long pole: two mechanism shell-outs. Started first so they run in the OS while everything
  // below yields between its blocking readers.
  const slowProbes = Promise.all([
    readDashboardSystem(root).catch(() => EMPTY_SYS),
    readDashboardManagerLight(root).catch(() => EMPTY_MGR),
  ]);
  // Provider round-trips (~1.5 s combined through the real ABI) — also started up front.
  const fastProbes = Promise.all([
    readTaskSummary(root, client).catch(() => [] as TaskSummary[]),
    client.goalList().catch(() => [] as GoalRecord[]),
  ]);

  await yieldToEventLoop();
  if (dashboardSnapshotStepHook) await dashboardSnapshotStepHook();
  let tests: TestsResult;
  try { tests = await readTestsNonBlocking(root); } catch { tests = { status: "error", reason: "internal", runs: [] }; }

  await yieldToEventLoop();
  if (dashboardSnapshotStepHook) await dashboardSnapshotStepHook();
  let live: LiveResult;
  try { live = readDashboardLive(root); } catch { live = EMPTY_LIVE; }

  await yieldToEventLoop();
  if (dashboardSnapshotStepHook) await dashboardSnapshotStepHook();
  // These three are cheap (measured ~0.11 s / ~0.05 s / ~0.001 s) — one macrotask each would add
  // scheduling overhead for no blocking win, so they share one.
  let history: GitHistoryResult;
  try { history = readGitHistory(root); } catch { history = EMPTY_HISTORY; }
  let suiteRun: CurrentSuiteRun | null;
  try { suiteRun = readCurrentSuiteRun(root); } catch { suiteRun = null; }
  let workerOutcomes: WorkerOutcomeRecord[] = [];
  try { workerOutcomes = readWorkerOutcomeRecords(root); } catch { workerOutcomes = []; }

  const [tasks, goals] = await fastProbes;
  // Complete-enough: every card except the two shell-out ones is renderable. Their readings are
  // carried over from `previous` when there is one (a refresh must never regress a card that is
  // already populated); on a true cold start they are the honest "not read yet" shapes, which is
  // transient — the same build replaces this snapshot a few seconds later.
  onInterim?.({
    builtAt: Date.now(),
    live,
    sys: previous?.sys ?? EMPTY_SYS,
    mgr: previous?.mgr ?? EMPTY_MGR,
    tests, suiteRun, history, tasks, goals, workerOutcomes,
  });

  const [sys, mgr] = await slowProbes;
  return { builtAt: Date.now(), live, sys, mgr, tests, suiteRun, history, tasks, goals, workerOutcomes };
}

/** What to do when a rebuild is requested while one is already in flight for the same root.
 *
 *  - `skip`  — the PERIODIC TICK's policy: return the incumbent and start nothing. A slow store must
 *              not queue up work that all lands at once.
 *  - `after` — an explicit `rebuildNow()` caller's policy, and the whole point of this type. Such a
 *              caller made its change BEFORE the call, while the incumbent build issued its provider
 *              round-trips (`client.goalList()` is the first thing `buildDashboardSnapshot` does)
 *              before that — so the incumbent is structurally incapable of reflecting the change
 *              (gap-dashboard-snapshot-rebuild-returns-inflight-cold-build: this is where the goal
 *              card served a store state from before the caller's fixture mutation). Every such
 *              caller is COALESCED onto ONE follow-up build started when the incumbent settles, so
 *              `after` adds at most one build per in-flight build — it cannot stack unboundedly. */
type RebuildPolicy = "skip" | "after";

/** Start the background rebuild tick for `root`. Runs one build immediately (the cold build lives
 *  HERE, at startup, not in a request — the same shape as startDevelopRefBackgroundRefresh), then
 *  re-builds every `intervalMs`. The interval is unref'd so it never keeps the process alive.
 *
 *  Rebuilds never stack: while one is in flight the next tick is skipped (a slow store must not
 *  queue up work that all lands at once) and explicit callers coalesce onto a single follow-up (see
 *  RebuildPolicy). A FAILED rebuild keeps the previous snapshot rather than blanking the page — a
 *  stale dashboard is honest, an empty one would be a fabricated absence. */
export function startDashboardSnapshotRefresh(
  root: string,
  client: ProviderClient,
  { intervalMs = DASHBOARD_SNAPSHOT_REFRESH_MS }: { intervalMs?: number } = {},
): { stop: () => void; rebuildNow: () => Promise<void> } {
  if (dashboardSnapshotDisabled()) return { stop: () => {}, rebuildNow: () => Promise.resolve() };
  // Run one build unconditionally and register it as the in-flight one. Only ever called when nothing
  // is in flight for `root` (the `if (map.get(root) === p)` in its own `finally` keeps a stale build
  // from deleting a newer build's marker).
  const start = (): Promise<void> => {
    const p = buildDashboardSnapshot(root, client, {
      // Install the complete-enough snapshot ONLY when there is nothing to serve yet. On a refresh
      // the incumbent snapshot is strictly better (it already carries the shell-out cards), so an
      // interim would only ever downgrade it.
      onInterim: (snap) => { if (!dashboardSnapshots.has(root)) dashboardSnapshots.set(root, snap); },
    })
      .then((snap) => { dashboardSnapshots.set(root, snap); })
      .catch(() => { /* keep the previous snapshot — see the contract above */ })
      .finally(() => { if (dashboardSnapshotRebuilds.get(root) === p) dashboardSnapshotRebuilds.delete(root); });
    dashboardSnapshotRebuilds.set(root, p);
    return p;
  };
  const rebuild = (policy: RebuildPolicy): Promise<void> => {
    const inFlight = dashboardSnapshotRebuilds.get(root);
    if (!inFlight) return start();
    if (policy === "skip") return inFlight; // the tick: never stack rebuilds on one root
    // `after`: this caller's change predates the incumbent's provider round-trips, so the incumbent
    // can never show it. Coalesce onto the ONE queued follow-up (a second `rebuildNow()` arriving
    // during the same wait must join it, not add a second build).
    const queued = dashboardSnapshotFollowUps.get(root);
    if (queued) return queued;
    // Re-enter `rebuild` (not `start`) once the incumbent settles: its `finally` has already dropped
    // the marker, so this normally starts a build; if a tick won that microtask gap the `skip` branch
    // returns THAT build, which also began after this caller's change and is therefore a valid answer.
    let followUp: Promise<void>;
    const beginFollowUp = (): Promise<void> => {
      // Retire the queue entry as the follow-up STARTS, not as it settles. Otherwise a `rebuildNow()`
      // arriving while the follow-up build itself runs would be handed this same, already-started
      // promise — which began before its call and so cannot reflect its change, i.e. the exact defect
      // this policy exists to remove, one level deeper.
      if (dashboardSnapshotFollowUps.get(root) === followUp) dashboardSnapshotFollowUps.delete(root);
      return rebuild("skip");
    };
    followUp = inFlight.then(beginFollowUp, beginFollowUp);
    dashboardSnapshotFollowUps.set(root, followUp);
    return followUp;
  };
  // `stop()` retires the INTERVAL only — `rebuildNow()` stays live, because an on-demand rebuild is
  // exactly what a caller (or a test that has retired the tick to make its fixture deterministic)
  // wants and it is never implicit.
  void rebuild("skip"); // the cold build — at startup, off the request path
  let handle: ReturnType<typeof setInterval> | null = setInterval(() => { void rebuild("skip"); }, intervalMs);
  (handle as unknown as { unref?: () => void }).unref?.();
  return {
    stop: () => { if (handle != null) { clearInterval(handle); handle = null; } },
    rebuildNow: () => rebuild("after"),
  };
}

export async function handleDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: ServePageCfg,
): Promise<void> {
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: the SNAPSHOT is the request path. It is a
  // sync map lookup — no reader runs here, so the response cost is bounded by the render alone and
  // is independent of every reader's TTL and of the host's load. A rebuild in flight does not touch
  // this path at all: the previous snapshot is served (AC3), and when the mechanism is switched off
  // (DASHBOARD_SNAPSHOT_DISABLED_ENV) `peekDashboardSnapshot` returns null and the legacy in-request
  // build below runs unchanged — the negative control.
  const snapshot = peekDashboardSnapshot(cfg.workspaceRoot);
  if (snapshot != null) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderDashboardPage(
      { live: snapshot.live, sys: snapshot.sys, mgr: snapshot.mgr, tests: snapshot.tests, suiteRun: snapshot.suiteRun, history: snapshot.history, tasks: snapshot.tasks, goals: snapshot.goals },
      { workspaceRoot: cfg.workspaceRoot, hours: timelineHoursFromRequest(req), identity: cfg.identity, workerOutcomes: snapshot.workerOutcomes },
    ));
    return;
  }
  // gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks: the async probe group is started
  // FIRST — its shell-script subprocesses (resource-gate / process-budget / loop-driver-check) run in
  // the OS while the three sync readers below do their (now cached / bounded) work on the main thread.
  // readLive runs with computeBlocking:false (see readDashboardLive): the liveCard never renders
  // blocks/blockedBy, so the full task-store scan (computeInFlightBlocking) is skipped — the one cost
  // that grows monotonically with the task store, and the recurrence root this task fixes.
  const asyncProbes = Promise.all([
    readDashboardSystem(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", resourceGate: { status: "error" as const, reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }, processBudget: { status: "error" as const, reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    })),
    readDashboardManagerLight(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", loopDriver: { status: "error" as const, reason: null, verdict: null, exitCode: null, detail: null }, liveness: { status: "error" as const, reason: null, sessions: [] }, observers: { status: "error" as const, reason: null, rows: [] }, pool: { status: "error" as const, reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] }, version: null, developLead: null,
    })),
    readTaskSummary(cfg.workspaceRoot, client).catch(() => [] as TaskSummary[]),
    client.goalList().catch(() => [] as GoalRecord[]),
  ]);
  let live: LiveResult;
  try { live = readDashboardLive(cfg.workspaceRoot); } catch {
    live = { status: "error", reason: "internal", inFlight: [], concurrencyCap: DEFAULT_DRIVER_CAP, cpuPressure: null, liveState: null, liveExplanation: null, activity: null };
  }
  let tests: TestsResult;
  try { tests = readTests(cfg.workspaceRoot); } catch {
    tests = { status: "error", reason: "internal", runs: [] };
  }
  let suiteRun: CurrentSuiteRun | null;
  try { suiteRun = readCurrentSuiteRun(cfg.workspaceRoot); } catch { suiteRun = null; }
  let history: GitHistoryResult;
  try { history = readGitHistory(cfg.workspaceRoot); } catch {
    history = { status: "error", reason: "internal", commits: [], head: null, heads: {}, mainlineHead: null };
  }
  const [sys, mgr, tasks, goals] = await asyncProbes;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  const hours = timelineHoursFromRequest(req);
  res.end(renderDashboardPage({ live, sys, mgr, tests, suiteRun, history, tasks, goals }, { workspaceRoot: cfg.workspaceRoot, hours, identity: cfg.identity }));
}

/** /dashboard/cards — the JSON data endpoint the dashboard auto-refresh script polls
 *  (gap-dashboard-testscard-livecard-auto-refresh, extended by gap-dashboard-visual-review-batch-fixes
 *  AC5/AC6). Re-renders the five live cards (live/tests/sys/mgr/task) as HTML fragments and returns
 *  them plus a `sysRaw` snapshot (cpu_stall/loadavg + server ts) for the client-side sparkline; the
 *  client swaps each card's own DOM node (never the whole page). `no-store` so the browser never serves
 *  a cached snapshot — a stale card is exactly what this endpoint exists to fix. Reads the same
 *  observation sources the dashboard page reads (but skips the git-history probe, which only the
 *  commits card needs). */
export async function handleDashboardCards(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  cfg: { workspaceRoot: string },
): Promise<void> {
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: this endpoint is polled by every open tab
  // every 30s, so it is the OTHER hot reader of the same build. It shares the snapshot with
  // /dashboard — one build, two faces — and therefore blocks the event loop no more than a map
  // lookup does. Absent (or the mechanism switched off) ⇒ the legacy in-request build below.
  const snapshot = peekDashboardSnapshot(cfg.workspaceRoot);
  if (snapshot != null) {
    const hours = timelineHoursFromRequest(req);
    const { cap, staleMs } = readGoalPolicy(cfg.workspaceRoot);
    const payload = JSON.stringify(buildCardsPayload({
      live: snapshot.live, sys: snapshot.sys, mgr: snapshot.mgr, tests: snapshot.tests, suiteRun: snapshot.suiteRun,
      tasks: snapshot.tasks, goals: snapshot.goals, workspaceRoot: cfg.workspaceRoot, hours, cap, staleMs,
      workerOutcomes: snapshot.workerOutcomes,
    }));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(payload);
    return;
  }

  // gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks: same async-first + cached readLive
  // (computeBlocking:false) structure as handleDashboard — this endpoint is the 30s auto-refresh
  // poll, so it must NOT re-run the full task-store scan or the sync readers on every poll.
  const asyncProbes = Promise.all([
    readDashboardSystem(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", resourceGate: { status: "error" as const, reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }, processBudget: { status: "error" as const, reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    })),
    readDashboardManagerLight(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", loopDriver: { status: "error" as const, reason: null, verdict: null, exitCode: null, detail: null }, liveness: { status: "error" as const, reason: null, sessions: [] }, observers: { status: "error" as const, reason: null, rows: [] }, pool: { status: "error" as const, reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] }, version: null, developLead: null,
    })),
    readTaskSummary(cfg.workspaceRoot, client).catch(() => [] as TaskSummary[]),
    client.goalList().catch(() => [] as GoalRecord[]),
  ]);
  let live: LiveResult;
  try { live = readDashboardLive(cfg.workspaceRoot); } catch {
    live = { status: "error", reason: "internal", inFlight: [], concurrencyCap: DEFAULT_DRIVER_CAP, cpuPressure: null, liveState: null, liveExplanation: null, activity: null };
  }
  let tests: TestsResult;
  try { tests = readTests(cfg.workspaceRoot); } catch {
    tests = { status: "error", reason: "internal", runs: [] };
  }
  let suiteRun: CurrentSuiteRun | null;
  try { suiteRun = readCurrentSuiteRun(cfg.workspaceRoot); } catch { suiteRun = null; }
  const [sys, mgr, tasks, goals] = await asyncProbes;
  const hours = timelineHoursFromRequest(req);
  const { cap, staleMs } = readGoalPolicy(cfg.workspaceRoot);
  const payload = JSON.stringify(buildCardsPayload({
    live, sys, mgr, tests, suiteRun, tasks, goals,
    workspaceRoot: cfg.workspaceRoot, hours, cap, staleMs,
  }));
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
}
