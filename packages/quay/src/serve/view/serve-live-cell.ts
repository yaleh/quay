// serve-live-cell.ts — the dashboard 循环脉搏 (loop-pulse) live card plus the shared
// past-N-hours segmented timeline (testsCard G / fan-in card H) and fixed-5-lane gantt SVG.
// Extracted from serve-dashboard.ts as a per-cell module (same pattern as serve-fan-in-cell.ts
// and serve-live-format.ts) so the live card's render+binding helpers stop living in a god-file.
//
// gap-routine-architecture-analysis-god-package-serve-view-fanin-516 (runId
// architecture-analysis-1793780643192): the architecture-analysis probe sampled renderLiveCard +
// formatDurationMs and asked to "extract per-cell render/binding modules and narrow the exported
// surface". This module is that first per-cell slice. serve-dashboard.ts keeps the route handlers,
// snapshot store, and the OTHER cards, and re-exports this module's public renderers unchanged so
// the serve/index.ts barrel surface (and every direct importer) keeps resolving the same names.

import type { IncomingMessage } from "node:http";
import type { LiveResult, WorkerOutcomeRecord } from "../../observation.ts";
import { DEFAULT_LANG, type Lang, html, escapeHtml, pad2 } from "./serve-render.ts";
import { dashboardLabelsFor, fillLabel } from "./serve-i18n.ts";
import { awaitingLandMs, formatAwaitingDuration, suiteSuffix } from "./serve-live-format.ts";
import { FIXED_GANTT_LANES, mergeLiveAndHistoryIntervals, packLanes, type LiveGanttInterval } from "../../dashboard-kernel.ts";

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
  lang: Lang = DEFAULT_LANG,
): string {
  const L = dashboardLabelsFor(lang);
  // gap-dashboard-fanin-panel-and-timeline-bars I: join the in-flight taskId to the task summary
  // (already fetched on the same /dashboard + /dashboard/cards requests) so each row can carry its
  // title — reusing the taskCard miniList's "id + body-colour title" vertical idiom.
  const titleById = new Map<string, string>();
  for (const t of tasks ?? []) {
    if (typeof t.id === "string" && typeof t.title === "string" && t.title.length > 0) titleById.set(t.id, t.title);
  }
  const liveStateText = live.status === "error" ? L.readFailed : live.liveState === "running" ? L.liveStateRunning : live.liveState === "running-unwired" ? L.liveStateRunningUnwired : live.liveState === "not-running" ? L.liveStateNotRunning : "—";
  const liveMiniList = live.inFlight.slice(0, 3).map((t) => {
    const tag = t.phase === "awaiting-land"
      ? fillLabel(L.awaitingLandWithDuration, { duration: formatAwaitingDuration(awaitingLandMs(t)) })
      : t.phase === "fan-in"
        ? `fan-in${suiteSuffix(t.suite)}`
        : t.phase === "landed"
          ? L.phaseLanded
          : L.phaseImplementing;
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
    ? html`<a href="/live" style="font-size:0.78rem;color:var(--color-accent);text-decoration:none">${escapeHtml(fillLabel(L.moreWithArrow, { n: live.inFlight.length - 3 }))}</a>`
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
    ? renderLiveGanttSvg(ganttIntervals, windowHours, nowMs, lang)
    : "";
  return html`<div id="live-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">${escapeHtml(L.loopPulse)}</div>
    <div style="font-weight:800">${escapeHtml(liveStateText)}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">${escapeHtml(fillLabel(L.inFlightCap, { inFlight: live.inFlight.length, cap: live.concurrencyCap }))}</p>
    ${gantt}
    ${live.status === "ok" && live.inFlight.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-divider);padding-top:6px">${liveMiniList}${liveMiniListOverflow}</div>` : ""}
    <a href="/live" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewLive)}</a>
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
export function timelineHoursFromRequest(req: IncomingMessage): number {
  try {
    return parseTimelineHours(new URL(req.url ?? "", "http://localhost").searchParams.get("hours"));
  } catch {
    return DEFAULT_TIMELINE_HOURS;
  }
}

/** Test-run state → the shared colour token (green → positive, red → accent, other → neutral). Bare
 *  token name, so the dashboard round-number chip writes `background:var(--color-…)` and the timeline
 *  SVG writes `fill="var(--color-…)"` from ONE source (no drift). EXPORTED because /tests renders the
 *  same state→token mapping over the same `state` domain from the same carrier
 *  (verification-round.jsonl): `serve-tests.ts` imports this instead of re-typing the ternary, so the
 *  three token literals have exactly one definition site (gap-routine-semantic-dedup-scan-statecolortoken-pair
 *  — the prior copy existed only because this function was module-private). */
export function stateColorToken(state: string | null): string {
  return state === "green" ? "--color-positive-700" : state === "red" ? "--color-accent-800" : "--color-neutral-400";
}

/** Mechanical fan-in outcome → colour token (landed → positive, red → accent, unknown → neutral). */
export function fanInOutcomeColorToken(outcome: string | null): string {
  return outcome === "landed" ? "--color-positive-700" : outcome === "red" ? "--color-accent-800" : "--color-neutral-400";
}

/** In-flight execution phase → the liveCard swimlane lane colour. The SAME 4-way phase split
 *  renderLiveCard's tag already discriminates (landed → positive, awaiting-land → accent-800, fan-in →
 *  accent-700, else implementing → neutral), so a lane's colour and its tag's emphasis can never drift
 *  apart. Bare token name — the SVG writes `fill="var(--color-…)"` from ONE source. */
function livePhaseColorToken(phase: string | null): string {
  return phase === "landed" ? "--color-positive-700" : phase === "awaiting-land" ? "--color-accent-800" : phase === "fan-in" ? "--color-accent-700" : "--color-neutral-400";
}

// gap-routine-semantic-dedup-scan-pad2: `pad2` is imported above from ./serve-render.ts (the
// serve-layer re-export of the core leaf) — this module redeclared a byte-equivalent copy. The
// sparklineSvg inner copy at ~:609 stays: its source is serialized via Function#toString().

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
  lang: Lang = DEFAULT_LANG,
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

  const aria = escapeHtml(fillLabel(dashboardLabelsFor(lang).timelineAriaPastHours, { hours: windowHours }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" style="width:100%;height:auto;margin-top:4px;display:block">
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
  lang: Lang = DEFAULT_LANG,
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

  const aria = escapeHtml(dashboardLabelsFor(lang).liveSwimlaneAria);

  const labels = rows
    .map((t, i) => {
      const id = t.taskId.length > 22 ? `${t.taskId.slice(0, 21)}…` : t.taskId;
      return `<text x="${pad}" y="${(top + i * laneH + barH - 1).toFixed(1)}" font-size="9" fill="var(--color-neutral-700)">${escapeHtml(id)}</text>`;
    })
    .join("");

  const axis = `<line x1="${plotL}" y1="${axisY}" x2="${W - pad}" y2="${axisY}" stroke="var(--color-neutral-300)"></line>`;
  const leftLabel = `<text x="${plotL}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)">${hhmm(windowStartMs)}</text>`;
  const rightLabel = `<text x="${W - pad}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)" text-anchor="end">${hhmm(nowMs)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" style="width:100%;height:auto;margin-top:4px;display:block">
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

// The pure packing half — FIXED_GANTT_LANES / LiveGanttInterval / mergeLiveAndHistoryIntervals /
// packLanes — MOVED to ./dashboard-kernel.ts verbatim (same bodies, input shapes declared
// structurally there so the leaf module can stay import-free). Re-exported here so every existing
// importer of THIS module keeps resolving them unchanged: the extraction is a move, not a
// behaviour change (gap-dashboard-kernel-export-for-cross-project-reuse).
export {
  FIXED_GANTT_LANES,
  mergeLiveAndHistoryIntervals,
  packLanes,
  type LiveGanttInterval,
} from "../../dashboard-kernel.ts";

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
function phaseLabel(phase: string | null, lang: Lang = DEFAULT_LANG): string {
  const L = dashboardLabelsFor(lang);
  return phase === "landed" ? L.phaseLanded : phase === "awaiting-land" ? L.phaseAwaitingLand : phase === "fan-in" ? "fan-in" : L.phaseImplementing;
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
  lang: Lang = DEFAULT_LANG,
): string {
  if (intervals.length === 0) return "";
  const L = dashboardLabelsFor(lang);
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
      const state = iv.phase != null ? phaseLabel(iv.phase, lang) : (iv.finalState ?? "unknown");
      const startIso = new Date(iv.startMs).toISOString();
      const endIso = new Date(iv.endMs).toISOString();
      bars.push(`<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" rx="2" fill="var(${ganttIntervalColorVar(iv)})"><title>${escapeHtml(`${iv.taskId} · ${state} · ${duration} · ${startIso} → ${endIso}`)}</title></rect>`);
    }
  }

  const overflowLabel = overflow > 0
    ? `<text x="${W - pad}" y="${top}" font-size="9" font-weight="700" fill="var(--color-accent-800)" text-anchor="end">${escapeHtml(fillLabel(L.moreBadge, { n: overflow }))}</text>`
    : "";

  const axis = `<line x1="${plotL}" y1="${axisY}" x2="${W - pad}" y2="${axisY}" stroke="var(--color-neutral-300)"></line>`;
  const leftLabel = `<text x="${plotL}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)">${hhmm(windowStartMs)}</text>`;
  const rightLabel = `<text x="${W - pad}" y="${H - 1}" font-size="9" fill="var(--color-neutral-700)" text-anchor="end">${hhmm(nowMs)}</text>`;

  const aria = escapeHtml(fillLabel(L.liveGanttAria, { lanes: FIXED_GANTT_LANES }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" style="width:100%;height:auto;margin-top:4px;display:block">
${laneLines.join("\n")}
${bars.join("\n")}
${overflowLabel}
${axis}
${leftLabel}
${rightLabel}
</svg>`;
}

