// serve-dashboard.ts — /dashboard route handler + task-summary cache, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { readLive, readSystem, readManagerLight, readTests, readGitHistory, readCurrentSuiteRun, readWorkerOutcomeRecords, type LiveResult, type SystemResult, type ManagerResult, type TestsResult, type GitHistoryResult, type CurrentSuiteRun, type WorkerOutcomeRecord } from "./observation.ts";
import { TASK_STATUS } from "./abi.ts";
import type { Manifest } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, relativeTime } from "./serve-render.ts";
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
        <a href="/task/${encodeURIComponent(t.taskId)}" style="color:var(--color-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.taskId)}</a>
        <span style="flex:none;${emphasis ? "color:var(--color-accent-700);font-weight:700" : "color:var(--color-neutral-700)"}">${escapeHtml(tag)}${elapsed ? ` · ${escapeHtml(elapsed)}` : ""}</span>
      </div>
      ${title != null ? html`<div style="color:var(--color-text);font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(title)}</div>` : ""}
    </div>`;
  }).join("");
  return html`<div id="live-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">循环脉搏</div>
    <div style="font-weight:800">${escapeHtml(liveStateText)}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">在飞 ${live.inFlight.length} · 并发 ${live.concurrency}</p>
    ${live.status === "ok" && live.inFlight.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-divider);padding-top:6px">${liveMiniList}</div>` : ""}
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

/** Test-run state → the dashboard card's own colour token (the same ternary the recentStrip already
 *  uses: green → positive, red → accent, other → neutral). Bare token name, so the strip writes
 *  `background:var(--color-…)` and the SVG writes `fill="var(--color-…)"` from ONE source (no drift). */
function stateColorToken(state: string | null): string {
  return state === "green" ? "--color-positive-700" : state === "red" ? "--color-accent-800" : "--color-neutral-400";
}

/** Mechanical fan-in outcome → colour token (landed → positive, red → accent, unknown → neutral). */
function fanInOutcomeColorToken(outcome: string | null): string {
  return outcome === "landed" ? "--color-positive-700" : outcome === "red" ? "--color-accent-800" : "--color-neutral-400";
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

// gap-webui-dashboard-tests-card-latest-round-no-live-signal: the card prefers the LIVE running signal
// (full-suite-state.json state=running, no ledger row yet) over tests.runs[0] (the latest COMPLETED
// round); labels a gate-blocked round (pass=0/tests=0 by construction) for what it is instead of a bare
// "pass 0/0"; and adds a 近N轮 strip so the single latest row is never the only signal (硬规则4b: a
// single point is a proxy, not the actual health picture).

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
  const recentStrip = recentRuns.length > 0
    ? html`<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-divider);padding-top:6px">
        <div style="font-size:0.7rem;color:var(--color-neutral-700)">近${recentRuns.length}轮（新→旧）</div>
        <div style="display:flex;gap:3px">${recentRuns.map((r) => {
          const color = `var(${stateColorToken(r.state)})`;
          const rGateBlocked = r.tests === 0 && r.pass === 0 && (r.reason === "gate-failed" || r.gate != null);
          const title = `#${r.round ?? "?"} ${r.state ?? "—"}${rGateBlocked ? `（gate:${r.gate ?? "?"} 未执行测试）` : ` pass ${r.pass ?? "—"}/${r.tests ?? "—"}`}`;
          return html`<span title="${escapeHtml(title)}" style="width:11px;height:11px;border-radius:2px;background:${color};display:inline-block"></span>`;
        }).join("")}</div>
      </div>`
    : "";
  // gap-dashboard-visual-review-batch-fixes AC4: a default-visible, readable per-round list (round · state
  // · pass X/Y · duration) below the hover-only colour strip, so a recent result is legible without hover.
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
        <span style="flex:none;color:var(--color-neutral-700)">#${r.round ?? "?"} ${escapeHtml(r.state ?? "—")}</span>
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
    ${recentStrip}
    ${recentList.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:2px">${recentList}</div>` : ""}
    ${timelineBar}
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

/** The dashboard mgrCard — a self-contained render of the Manager/Outer/Inner probe (id="mgr-card").
 *  gap-dashboard-visual-review-batch-fixes AC1: the liveness count is only shown when
 *  `liveness.status === "ok"`; otherwise (the current constant `"empty"` "observer retired" state) the
 *  clause reads 「会话数未接入」 — never a bare number that a retired/never-measured metric would render
 *  indistinguishable from a genuine "0 sessions alive" (CLAUDE.md 硬规则 3b/4b). */
export function renderMgrCard(mgr: ManagerResult): string {
  const mgrAlive = mgr.liveness.sessions.filter((s) => s.alive).length;
  const livenessText = mgr.liveness.status === "ok" ? `${mgrAlive} 会话 LIVE` : "会话数未接入";
  return html`<div id="mgr-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Manager / Outer / Inner</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.5">loop-driver: ${escapeHtml(mgr.loopDriver.verdict ?? "未接入")} · ${livenessText}</p>
    <a href="/manager" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看三层状态 →</a>
  </div>`;
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
  tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>,
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
  const MINI_LIST_N = 3;
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
        <a href="/task/${encodeURIComponent(r.task ?? "")}" style="color:var(--color-text);text-decoration:none;font-weight:600">${escapeHtml(r.task ?? "?")}</a>
        <div style="color:var(--color-neutral-700)">${renderFanInCell(r.task ?? "", r)}</div>
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
    ${list}
    ${bar}
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

export function renderDashboardPage(
  d: {
    live: LiveResult;
    sys: SystemResult;
    mgr: ManagerResult;
    tests: TestsResult;
    suiteRun: CurrentSuiteRun | null;
    history: GitHistoryResult;
    tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>;
  },
  opts: { workspaceRoot?: string; hours?: number; nowMs?: number } = {},
): string {
  const nowMs = opts.nowMs ?? Date.now();
  const hours = opts.hours ?? DEFAULT_TIMELINE_HOURS;
  const liveCard = renderLiveCard(d.live, nowMs, d.tasks);
  const sysCard = renderSysCard(d.sys);
  const mgrCard = renderMgrCard(d.mgr);
  const taskCard = renderTaskCard(d.tasks);
  const testsCard = renderTestsCard(d.tests, d.suiteRun, { hours, nowMs });
  const fanInCard = renderFanInCard(opts.workspaceRoot, { hours, nowMs });

  const recentCommits = d.history.status === "ok"
    ? d.history.commits.slice(0, 3).map((c) => `${c.hash.slice(0, 7)} ${c.subject}`).join("<br>")
    : (d.history.status === "empty" ? "无提交" : gitReadFailureSummary(d.history.reason));
  const commitsCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">最近提交</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.6;font-family:ui-monospace,monospace">${recentCommits}</p>
    <a href="/journal" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Journal →</a>
  </div>`;

  // gap-dashboard-fanin-panel-and-timeline-bars (window presets): a small set of page-reload links that
  // set the shared G/H timeline window. The refresh script carries the current ?hours= into its own
  // /dashboard/cards poll, so a preset change survives the 30s auto-refresh without the bars jumping.
  const hourLinks = [1, 3, 6, 12]
    .map((n) => html`<a href="/dashboard?hours=${n}" style="color:var(--color-accent);text-decoration:none;${n === hours ? "font-weight:700" : ""}">${n}h</a>`)
    .join(" · ");

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay dashboard — 循环脉搏、任务台账、系统资源与三层状态总览">${modernistStyles()}${pageStyles()}<title>Dashboard</title></head>
    <body>${renderMobileChrome("dashboard", "dashboard")}${renderSiteNav("dashboard")}<main>
      <h1>Dashboard</h1>
      <p class="meta">循环脉搏、任务台账、系统资源与三层调度状态的总览 — 每张卡片指向对应完整页面。</p>
      <p class="meta">时间轴窗口（以各自最近一次运行/fan-in 结束时刻为终点的过去 ${hours}h）：${hourLinks}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem">${liveCard}${sysCard}${mgrCard}</div>
      <h2>工作进展</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem">${taskCard}${testsCard}${fanInCard}</div>
      <h2>变更记录</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider)">${commitsCard}${html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Git History</div>
        <p style="margin:0;font-size:0.8rem">提交纵向时间轴（develop 主干 + task 分支，第三方库客户端渲染）。</p>
        <a href="/git-history" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Git History →</a>
      </div>`}</div>
    </main>${renderDashboardCardRefreshScript()}</body></html>`;
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
const taskSummaryCache = new Map<string, { at: number; tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }> }>();

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
): Promise<Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>> {
  const hit = taskSummaryCache.get(root);
  if (hit && Date.now() - hit.at < TASK_SUMMARY_CACHE_TTL_MS) return hit.tasks;
  const r = await client.taskList({ includeBody: false });
  const tasks = r.tasks ?? [];
  taskSummaryCache.set(root, { at: Date.now(), tasks });
  return tasks;
}

export async function handleDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let live: LiveResult;
  try { live = readLive(cfg.workspaceRoot); } catch {
    live = { status: "error", reason: "internal", inFlight: [], concurrency: 0, cpuPressure: null, liveState: null, liveExplanation: null, activity: null };
  }
  // AC1 + AC2 (gap-webui-dashboard-load-time-optimization): the dashboard manager probe is now
  // readManagerLight — loop-driver + liveness ONLY, NO pool probe (the pool metrics are not shown on
  // the dashboard card; /manager still runs the full readManager).
  // readSystem + the light manager probe + the (cached) task summary are independent — run them
  // CONCURRENTLY (Promise.all); client.taskList is no longer serialized AFTER the sys/mgr group
  // (the prior gap-webui-dashboard-manager-slow-parallelize shape awaited it later).
  const [sys, mgr, tasks] = await Promise.all([
    readSystem(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", resourceGate: { status: "error" as const, reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }, processBudget: { status: "error" as const, reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    })),
    readManagerLight(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", loopDriver: { status: "error" as const, reason: null, verdict: null, exitCode: null, detail: null }, liveness: { status: "error" as const, reason: null, sessions: [] }, observers: { status: "error" as const, reason: null, rows: [] }, pool: { status: "error" as const, reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] }, version: null, developLead: null,
    })),
    readTaskSummary(cfg.workspaceRoot, client).catch(() => [] as Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>),
  ]);
  let tests: TestsResult;
  try { tests = readTests(cfg.workspaceRoot); } catch {
    tests = { status: "error", reason: "internal", runs: [] };
  }
  let suiteRun: CurrentSuiteRun | null;
  try { suiteRun = readCurrentSuiteRun(cfg.workspaceRoot); } catch { suiteRun = null; }
  let history: GitHistoryResult;
  try { history = readGitHistory(cfg.workspaceRoot); } catch {
    history = { status: "error", reason: "internal", commits: [], head: null, heads: {} };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  const hours = timelineHoursFromRequest(req);
  res.end(renderDashboardPage({ live, sys, mgr, tests, suiteRun, history, tasks }, { workspaceRoot: cfg.workspaceRoot, hours }));
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
  let live: LiveResult;
  try { live = readLive(cfg.workspaceRoot); } catch {
    live = { status: "error", reason: "internal", inFlight: [], concurrency: 0, cpuPressure: null, liveState: null, liveExplanation: null, activity: null };
  }
  const [sys, mgr, tasks] = await Promise.all([
    readSystem(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", resourceGate: { status: "error" as const, reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }, processBudget: { status: "error" as const, reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    })),
    readManagerLight(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", loopDriver: { status: "error" as const, reason: null, verdict: null, exitCode: null, detail: null }, liveness: { status: "error" as const, reason: null, sessions: [] }, observers: { status: "error" as const, reason: null, rows: [] }, pool: { status: "error" as const, reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] }, version: null, developLead: null,
    })),
    readTaskSummary(cfg.workspaceRoot, client).catch(() => [] as Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>),
  ]);
  let tests: TestsResult;
  try { tests = readTests(cfg.workspaceRoot); } catch {
    tests = { status: "error", reason: "internal", runs: [] };
  }
  let suiteRun: CurrentSuiteRun | null;
  try { suiteRun = readCurrentSuiteRun(cfg.workspaceRoot); } catch { suiteRun = null; }
  const hours = timelineHoursFromRequest(req);
  const payload = JSON.stringify({
    liveCard: renderLiveCard(live, Date.now(), tasks),
    testsCard: renderTestsCard(tests, suiteRun, { hours }),
    sysCard: renderSysCard(sys),
    mgrCard: renderMgrCard(mgr),
    taskCard: renderTaskCard(tasks),
    sysRaw: {
      cpuStallAvg10: sys.resourceGate.cpuStallAvg10,
      loadAvg: sys.resourceGate.loadAvg,
      loadThreshold: sys.resourceGate.loadThreshold,
      ts: Date.now(),
    },
  });
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
}
