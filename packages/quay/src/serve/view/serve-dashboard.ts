// serve-dashboard.ts — /dashboard route handler + task-summary cache, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ProviderClient } from "../../provider-client.ts";
import { readLive, readSystem, readManagerLight, readTests, readTestsNonBlocking, readGitHistory, readCurrentSuiteRun, readWorkerOutcomeRecords, yieldToEventLoop, DEFAULT_DRIVER_CAP, type LiveResult, type SystemResult, type ManagerResult, type TestsResult, type GitHistoryResult, type CurrentSuiteRun, type WorkerOutcomeRecord, type DriverKindReading } from "../../observation.ts";
import { TASK_STATUS, type GoalRecord } from "../../abi.ts";
import { DEFAULT_LANG, type Lang, type Manifest, type ServeIdentity, type ServePageCfg } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, relativeTime, pageTitle, renderIdentityCard, htmlLangTag, pageNameFor } from "./serve-render.ts";
import { renderFanInCell } from "./serve-fan-in-cell.ts";
// gap-webui-dashboard-body-copy-en-zh: the page's BODY copy resolves through serve-i18n.ts's
// DASHBOARD_LABELS (ROW 5~8) — the same ONE-dictionary seam the nav/page chrome already uses.
// `dashboardLabelsFor(lang)` is taken ONCE per render (each card takes its own table), never
// re-read per label.
import { dashboardLabelsFor, fillLabel } from "./serve-i18n.ts";
// The state cluster that used to be seven module-level Maps + a `let` step hook + five free
// `clearXxx()` / `setXxxStepHook()` functions now lives in ONE class instance
// (gap-dashboard-snapshot-store-encapsulate-state). This module is a CONSUMER — it declares no
// module-level mutable state of its own.
import { dashboardSnapshotStore, type DashboardSnapshot, type RebuildPolicy, type TaskSummary } from "../store/snapshot-store.ts";
export { dashboardSnapshotStore };
export type { DashboardSnapshot, TaskSummary } from "../store/snapshot-store.ts";

// ── /dashboard ─────────────────────────────────────────────────────────────────────────────────────

import {
  DEFAULT_TIMELINE_HOURS,
  fanInOutcomeColorToken,
  formatDurationMs,
  formatSuiteElapsed,
  parseTimelineHours,
  renderLiveCard,
  renderTimelineBarSvg,
  stateColorToken,
  timelineHoursFromRequest,
} from "./serve-live-cell.ts";
export {
  DEFAULT_TIMELINE_HOURS,
  FIXED_GANTT_LANES,
  formatDurationMs,
  formatSuiteElapsed,
  mergeLiveAndHistoryIntervals,
  packLanes,
  parseTimelineHours,
  renderLiveCard,
  renderLiveGanttSvg,
  renderLiveSwimlaneSvg,
  renderTimelineBarSvg,
  stateColorToken,
  type LiveGanttInterval,
} from "./serve-live-cell.ts";

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
  opts: { hours?: number; nowMs?: number; lang?: Lang } = {},
): string {
  const L = dashboardLabelsFor(opts.lang);
  const nowMs = opts.nowMs ?? Date.now();
  const hours = opts.hours ?? DEFAULT_TIMELINE_HOURS;
  const latestRun = tests.runs[0] ?? null;
  const suiteRunning = suiteRun && suiteRun.state === "running" ? suiteRun : null;
  const gateBlocked = latestRun != null && latestRun.tests === 0 && latestRun.pass === 0 && (latestRun.reason === "gate-failed" || latestRun.gate != null);
  const statusLine = suiteRunning
    ? html`<span style="color:var(--color-accent-700)">${escapeHtml(L.running)}</span>`
    : escapeHtml(latestRun ? (latestRun.state ?? "—") : L.notWired);
  const elapsed = suiteRunning ? formatSuiteElapsed(suiteRunning.startedAt, Date.now()) : null;
  const detailLine = suiteRunning
    ? `${fillLabel(L.suiteRunningElapsed, { elapsed: elapsed ?? "—" })}${suiteRunning.runner ? ` · runner ${escapeHtml(suiteRunning.runner)}` : ""}${suiteRunning.scope ? ` · scope ${escapeHtml(suiteRunning.scope)}` : ""}`
    : latestRun
      ? (gateBlocked
        ? (latestRun.gate
          ? fillLabel(L.gateNotPassedNamed, { gate: latestRun.gate })
          : L.gateNotPassedUnnamed)
        : `pass ${latestRun.pass ?? "—"}/${latestRun.tests ?? "—"}`)
      : (tests.reason ? escapeHtml(tests.reason) : L.noVerificationRounds);
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
    const rDetail = rGateBlocked ? fillLabel(L.roundGateNotRun, { gate: r.gate ?? "?" }) : `pass ${r.pass ?? "—"}/${r.tests ?? "—"}`;
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
  const timelineBar = renderTimelineBarSvg(timelineSegments, hours, windowEndMs ?? nowMs, opts.lang);
  return html`<div id="tests-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">${escapeHtml(L.tests)}</div>
    <div style="font-weight:800">${statusLine}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">${detailLine}</p>
    ${timelineBar}
    ${recentList.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:2px">${recentList}</div>` : ""}
    <a href="/tests" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewTests)}</a>
  </div>`;
}

// ── liveCard/testsCard auto-refresh (gap-dashboard-testscard-livecard-auto-refresh) ─────────────────
//
// The two cards above are a request-time snapshot; a tab left open shows stale state until a manual
// reload. This adds a light, LOCAL auto-refresh: an inline script polls the /dashboard/cards JSON
// endpoint (which re-renders ONLY those two cards) and swaps each card's own DOM node — never
// location.reload. The period is aligned with TASK_SUMMARY_CACHE_TTL_MS (30s) so the client does not
// poll faster than the backend's own freshness; polling pauses while the tab is hidden.
//
// ── WHY THIS STAYS POLLING (gap-webui-dashboard-cards-poll-cost-eval, 2026-09-17) ──────────────────
// DECISION: keep the 30 s poll; do NOT move to ETag/304 or SSE/WebSocket. Measured, not assumed:
//   • This endpoint was 66–78% of ALL requests in a rolling 7-day window — but that is a SHARE of a
//     tiny denominator (the whole server served only ~6.8k requests in the same window). The rate is what
//     the decision turns on: ~4.5k polls = ~0.007 req/s, ~19 ms of server time each (measured TTFB)
//     ≈ 12 s of CPU per day.
//   • The server's own cost is NOT this endpoint. A 120 s window in which exactly ONE poll arrived
//     still burned 53.8 s CPU (44.9% of a core) — background tick work, not request handling. The 30 s
//     snapshot-rebuild tick (startDashboardSnapshotRefresh) is one measured contributor: its two
//     mechanism shell-outs cost ~1.8 s of SUBPROCESS CPU per rebuild (7.36 s of reaped-child CPU over
//     4 rebuilds). The remaining self-CPU was not attributed per-tick — this decision does not need
//     that breakdown, because the direction is settled by the reverse control below. Optimising the
//     poll would cut REQUESTS without cutting SERVER COST. Corroborated by a controlled burst at
//     ~1.4 req/s — ~190× the observed rate — which did NOT raise self-CPU measurably over an idle
//     window of equal background work (0.347 vs 0.387 s/s; the difference is within noise).
//   • ETag/304 is structurally unavailable here, not merely unimplemented: the payload is
//     non-deterministic between two polls (the liveCard gantt's x/width derive from wall-clock `now`,
//     testsCard carries "55m ago"→"56m ago", sysRaw.ts is a live sample stamp) — verified: two live
//     probes 4 s apart differed, with only 5 of 8 keys (~52% of bytes) byte-stable. A whole-payload
//     validator therefore NEVER matches, so adding one would be a dead mechanism that reads as an
//     optimisation. `Cache-Control: no-store` is also deliberate here (a stale card is exactly what
//     this endpoint exists to fix). Per-card validators would work, but that is a new
//     request/response protocol for a 0.007 req/s load.
//   • SSE/WebSocket would trade that rate for a socket held open per viewer plus heartbeat/reconnect/
//     buffering surface — more mechanism, no measured benefit. /live is NOT a reusable precedent: it
//     has no push at all (serve-live.ts renders a plain page; zero <script>/EventSource in src).
//   • Freshness is already optimal: this period matches the server's own
//     DASHBOARD_SNAPSHOT_REFRESH_MS (30 s), so polling faster cannot yield fresher data, and a hidden
//     tab already skips the poll.
// ⟳ RE-EVALUATE when the resident-viewer count V stops being negligible. The cost is linear per
//   viewer: a tab open 8 h/day makes ~960 polls/day ≈ 31 MB/day at today's 32.6 KB payload, so
//   V≈30 ⇒ ~1 GB/day — the point at which per-card conditional responses (the ~52% byte-stable
//   keys) start to earn their complexity. Re-measure from `.quay/quay-access.log` path frequency
//   plus this endpoint's TTFB.

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
export function sparklineSvg(history, loadThreshold, thresholdLabel) {
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
        // gap-webui-dashboard-body-copy-en-zh: the threshold word comes in as a PARAMETER, not from
        // a module-level dictionary — this function's source is serialized into the client script
        // (Function#toString) and the browser has no dictionary to look one up in. The caller passes
        // an already-resolved template carrying `{value}`; an absent one degrades to the bare number
        // (never to an English word chosen on the client's behalf).
        var thrTpl = (thresholdLabel == null) ? "{value}" : String(thresholdLabel);
        out.push('<text x="' + (W - P) + '" y="' + labelY.toFixed(1) + '" font-size="8" fill="var(--color-neutral-500)" text-anchor="end">' + thrTpl.replace("{value}", num(loadThreshold)) + '</text>');
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
export function renderDashboardCardRefreshScript(lang: Lang = DEFAULT_LANG): string {
  // The sparkline's threshold word is resolved SERVER-side and embedded as a literal: the client
  // re-renders the sparkline from in-memory history (sparklineSvg is serialized into this script),
  // so without this the redraw would drop back to a language it cannot know (gap-webui-dashboard-
  // body-copy-en-zh). JSON.stringify (not a raw `"${…}"`) so a label containing a quote or a
  // backslash cannot break out of the string literal it is being written into.
  return `<script>
(function () {
  var REFRESH_MS = ${DASHBOARD_CARD_REFRESH_MS};
  var SYS_HISTORY_MAX = 60;
  var sysHistory = [];
  var THRESHOLD_LABEL = ${JSON.stringify(dashboardLabelsFor(lang).sparkThreshold)};
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
    svg.innerHTML = sparklineSvg(sysHistory, loadThreshold, THRESHOLD_LABEL);
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
export function renderSysCard(sys: SystemResult, lang: Lang = DEFAULT_LANG): string {
  const L = dashboardLabelsFor(lang);
  const sysGo = sys.resourceGate.status === "ok" && sys.processBudget.status === "ok" &&
    sys.resourceGate.verdict === "GO" && sys.processBudget.verdict === "GO";
  return html`<div id="sys-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">${escapeHtml(L.sysResources)}</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.5">cpu_stall ${sys.resourceGate.cpuStallAvg10 != null ? escapeHtml(String(sys.resourceGate.cpuStallAvg10)) : "—"} · loadavg ${sys.resourceGate.loadAvg != null ? escapeHtml(String(sys.resourceGate.loadAvg)) : "—"}</p>
    <div style="font-weight:800;color:${sysGo ? "var(--color-positive-700)" : "var(--color-accent-800)"}">⇒ ${sysGo ? "GO" : sys.resourceGate.status === "ok" ? "WAIT" : escapeHtml(L.notWired)}</div>
    <svg id="sys-sparkline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" role="img" aria-label="${escapeHtml(L.sysSparklineAria)}" style="width:100%;height:120px;margin-top:4px">${sparklineSvg([], sys.resourceGate.loadThreshold, L.sparkThreshold)}</svg>
    <a href="/system" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewSystem)}</a>
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
export function renderMgrCard(mgr: ManagerResult, lang: Lang = DEFAULT_LANG): string {
  const L = dashboardLabelsFor(lang);
  const rows = mgr.drivers ?? [];
  return html`<div id="mgr-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Driver</div>
    ${rows.length > 0 ? rows.map((d) => renderDriverStatusRow(d, lang)).join("") : html`<div style="margin:0;font-size:0.8rem;line-height:1.5">${escapeHtml(L.driverStatusNotWired)}</div>`}
    <a href="/manager" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewManager)}</a>
  </div>`;
}

/** Render one driver kind's alive-status row: `<kind>: <运行中|未运行> · 末条记录 <relativeTime>`.
 *  A dead reading renders 「未运行」, never `undefined`/`NaN`/empty (absent-field contract, hard rules
 *  3b/4b). */
function renderDriverStatusRow(d: Pick<DriverKindReading, "kind" | "running" | "lastTs">, lang: Lang = DEFAULT_LANG): string {
  const L = dashboardLabelsFor(lang);
  const aliveText = d.running === true ? L.running : L.driverNotRunning;
  const lastMs = d.lastTs ? Date.parse(d.lastTs) : Number.NaN;
  const lastText = Number.isFinite(lastMs) ? relativeTime(lastMs) : "—";
  return html`<div style="margin:0;font-size:0.8rem;line-height:1.5"><b>${escapeHtml(d.kind)}</b>: ${escapeHtml(aliveText)} · ${escapeHtml(fillLabel(L.driverLastRecord, { time: lastText }))}</div>`;
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
  lang: Lang = DEFAULT_LANG,
): string {
  const L = dashboardLabelsFor(lang);
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
      <div style="align-self:flex-start;font-size:0.7rem;font-weight:700;color:var(--color-text);background:var(--color-neutral-200);padding:2px 8px;border-radius:999px">${escapeHtml(fillLabel(L.miniListHeader, { status: s, n: MINI_LIST_N }))}</div>
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
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">${escapeHtml(L.taskLedger)}</div>
    <div style="display:flex;height:14px;width:100%;overflow:hidden">${statuses.map(bar).join("")}</div>
    <div style="display:flex;gap:0.75rem;font-size:0.75rem;flex-wrap:wrap;color:var(--color-neutral-700)">
      ${statuses.map((s) => html`<span><b>${counts.get(s) ?? 0}</b> ${escapeHtml(s)}</span>`).join("")}
    </div>
    ${miniStatuses.map(miniList).join("")}
    <a href="/tasks" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewTaskList)}</a>
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
  opts: { cap?: number; staleMs?: number; nowMs?: number; lang?: Lang } = {},
): string {
  const L = dashboardLabelsFor(opts.lang);
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
      <div style="color:var(--color-neutral-700)">${escapeHtml(fillLabel(L.acAchieved, { achieved, total: acs.length }))}${acBar}</div>
    </div>`;
  }).join("");

  const emptyState = activeGoals.length === 0
    ? html`<p style="margin:0;font-size:0.8rem;opacity:0.8">${escapeHtml(L.noActiveGoal)}</p>`
    : "";

  return html`<div id="goal-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">${escapeHtml(L.stageGoals)}</div>
    <div style="font-weight:800">active ${activeCount} / cap ${cap}</div>
    ${emptyState}
    ${rows}
    <a href="/goal" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewGoals)}</a>
  </div>`;
}

/** The dashboard fan-in card — cross-task mechanical fan-in summary (list + segmented bar), added by
 *  gap-dashboard-fanin-panel-and-timeline-bars H. Unlike /task/<id>'s Runs block (filtered by ONE task),
 *  this aggregates EVERY worker-outcome record carrying a mechanical_fan_in result, sorted by
 *  lock-acquire time (desc), reusing renderFanInCell for each row (no second field-join). */
export function renderFanInCard(
  root: string | undefined,
  opts: { hours?: number; nowMs?: number; lang?: Lang } = {},
): string {
  const records = root != null ? readWorkerOutcomeRecords(root) : [];
  return renderFanInCardFromRecords(records, opts);
}

/** Pure card-body renderer (the AC4/AC5 test seam): list + timeline bar from an already-read records
 *  array, so the sort / null-filter / segment-count logic is unit-testable on a fixed array without a
 *  disk fixture. */
export function renderFanInCardFromRecords(
  records: WorkerOutcomeRecord[],
  opts: { hours?: number; nowMs?: number; lang?: Lang } = {},
): string {
  const L = dashboardLabelsFor(opts.lang);
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
    : html`<p style="margin:0;font-size:0.8rem;opacity:0.8">${escapeHtml(L.noFanInRecords)}</p>`;

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
  const bar = renderTimelineBarSvg(segments, hours, windowEndMs ?? nowMs, opts.lang);

  return html`<div id="fanin-card" style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Fan-in</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">${escapeHtml(fillLabel(L.recentFanIns, { n: rows.length }))}</p>
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
export function gitReadFailureSummary(reason: string | null | undefined, lang: Lang = DEFAULT_LANG): string {
  const L = dashboardLabelsFor(lang);
  const r = String(reason ?? "").replace(/\s+/g, " ").trim();
  const cap = r.length > 160 ? `${r.slice(0, 157)}…` : r;
  return cap ? fillLabel(L.gitReadFailedWithReason, { reason: escapeHtml(cap) }) : L.readFailed;
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
  // gap-webui-dashboard-tasks-display-polish ③: two changes, and BOTH are needed — either alone is a
  // no-op, which is why they are one edit:
  //
  // (a) `align-items:start` — stop the grid from stretching the shorter column's flex stack to the
  //     row height (CSS Grid's default is `stretch`). This is what the reported defect names.
  // (b) the divider colour moves OFF the container and ONTO the two column stacks. With (a) alone
  //     the void would look EXACTLY the same: a grid row is as tall as its TALLEST item whatever
  //     `align-items` says, so the container's own background still paints the whole row box —
  //     including the region the short column no longer covers. It was that full-bleed
  //     `--color-divider` fill showing through the gap that read as "卡片没渲染完/挂了". Painting the
  //     divider on the column stacks instead keeps every intra-column 2px separator (the stacks are
  //     still `gap:2px` over the divider colour) while leaving the container transparent, so the
  //     uncovered area is page background — ordinary empty space, not a dark rectangle.
  //
  // The container keeps `gap:2px` + `border:1px solid var(--color-divider)` unchanged (the row's
  // outer outline and the 2px column gutter), so this stays the same .dash-grid shape the ≤600px
  // single-column media query collapses. The 变更记录 row / renderCardGrid() are untouched: their
  // cards are direct grid items with no stacked-column wrapper, so they have no short-column void to
  // begin with. renderTopRow() is likewise left alone (it is not in this task's scope and its own
  // right-column void is a separate, already-recorded open item), so the two rows differ in this one
  // respect until that one is taken up.
  return html`<div class="dash-grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:2px;background:transparent;border:1px solid var(--color-divider);margin-bottom:1.5rem;"><div style="display:flex;flex-direction:column;gap:2px;background:var(--color-divider)">${goalCard}${taskCard}</div><div style="display:flex;flex-direction:column;gap:2px;background:var(--color-divider)">${testsCard}${fanCard}</div></div>`;
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
  opts: { workspaceRoot?: string; hours?: number; nowMs?: number; identity?: ServeIdentity | null; workerOutcomes?: WorkerOutcomeRecord[]; lang?: Lang } = {},
): string {
  const L = dashboardLabelsFor(opts.lang);
  const nowMs = opts.nowMs ?? Date.now();
  const hours = opts.hours ?? DEFAULT_TIMELINE_HOURS;
  // gap-dashboard-live-swimlane-fixed-lane-gantt-timeline: read the worker-outcome history ONCE and
  // feed it to BOTH the liveCard gantt and the fan-in card (same data source, no second I/O path).
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: a caller holding a snapshot passes the
  // already-read records in, so the request path performs NO reader I/O (the disk read stays on the
  // background rebuild). Absent ⇒ read here, i.e. the legacy in-request behaviour, unchanged.
  const workerOutcomes = opts.workerOutcomes ?? (opts.workspaceRoot != null ? readWorkerOutcomeRecords(opts.workspaceRoot) : []);
  const liveCard = renderLiveCard(d.live, nowMs, d.tasks, workerOutcomes, hours, opts.lang);
  const sysCard = renderSysCard(d.sys, opts.lang);
  const mgrCard = renderMgrCard(d.mgr, opts.lang);
  const taskCard = renderTaskCard(d.tasks, opts.lang);
  const testsCard = renderTestsCard(d.tests, d.suiteRun, { hours, nowMs, lang: opts.lang });
  const fanInCard = renderFanInCardFromRecords(workerOutcomes, { hours, nowMs, lang: opts.lang });
  const { cap, staleMs } = readGoalPolicy(opts.workspaceRoot);
  const goalCard = renderGoalCard(d.goals ?? [], { cap, staleMs, nowMs, lang: opts.lang });

  const recentCommits = d.history.status === "ok"
    ? d.history.commits.slice(0, 3).map((c) => `${c.hash.slice(0, 7)} ${c.subject}`).join("<br>")
    : (d.history.status === "empty" ? escapeHtml(L.noCommits) : gitReadFailureSummary(d.history.reason, opts.lang));
  const commitsCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">${escapeHtml(L.recentCommits)}</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.6;font-family:ui-monospace,monospace">${recentCommits}</p>
    <a href="/journal" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewJournal)}</a>
  </div>`;
  const gitHistoryCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Git History</div>
    <p style="margin:0;font-size:0.8rem">${escapeHtml(L.gitHistoryTimelineBody)}</p>
    <a href="/git-history" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">${escapeHtml(L.viewGitHistory)}</a>
  </div>`;

  // gap-dashboard-fanin-panel-and-timeline-bars (window presets): a small set of page-reload links that
  // set the shared G/H timeline window. The refresh script carries the current ?hours= into its own
  // /dashboard/cards poll, so a preset change survives the 30s auto-refresh without the bars jumping.
  const hourLinks = [1, 3, 6, 12]
    .map((n) => html`<a href="/dashboard?hours=${n}" style="color:var(--color-accent);text-decoration:none;${n === hours ? "font-weight:700" : ""}">${n}h</a>`)
    .join(" · ");

  // gap-ac288-webui-lang-switch-mechanism: the language tag comes from the dispatcher-resolved
  // `opts.lang` (undefined ⇒ DEFAULT_LANG `en`, so the direct-render unit tests that predate this
  // field are unchanged). This is the whole per-page cost of consuming the mechanism — one line.
  return html`<!doctype html>
    ${htmlLangTag(opts.lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(L.metaDescription)}">${modernistStyles()}${pageStyles()}${dashboardGridStyles}<title>${pageTitle("Dashboard", opts.identity, opts.lang)}</title></head>
    <body>${renderMobileChrome("dashboard", "dashboard", opts.lang)}${renderSiteNav("dashboard", opts.lang)}<main id="main">
      <h1>${pageNameFor("Dashboard", opts.lang)}</h1>
      <p class="meta">${escapeHtml(L.subtitle)}</p>
      <p class="meta">${escapeHtml(fillLabel(L.timelineWindow, { hours }))}${hourLinks}</p>
      ${opts.identity ? renderIdentityCard(opts.identity, opts.lang) : ""}
      ${renderTopRow(liveCard, sysCard, mgrCard)}
      <h2>${escapeHtml(L.workProgress)}</h2>
      ${renderWorkProgressRow(goalCard, taskCard, testsCard, fanInCard)}
      <h2>${escapeHtml(L.changeLog)}</h2>
      ${renderCardGrid([commitsCard, gitHistoryCard])}
    </main>${renderDashboardCardRefreshScript(opts.lang)}</body></html>`;
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
  /** The language THIS request resolved to. ⚠️ Not optional-with-a-default at the CALL SITE: the
   *  cards this payload re-renders are swapped over the ALREADY-RENDERED page every 30 s, so a
   *  mixed-up language here would flip a zh page's cards to English a few seconds after load —
   *  a defect no single-response probe can see (the page's own HTML is correct). */
  lang: Lang;
}): Record<string, unknown> {
  const { live, sys, mgr, tests, suiteRun, tasks, goals, workspaceRoot, hours, cap, staleMs, lang } = args;
  // gap-dashboard-live-swimlane-fixed-lane-gantt-timeline: same single-read worker-outcome history fed
  // to both the liveCard gantt and the fan-in card (the /dashboard/cards auto-refresh path).
  const workerOutcomes = args.workerOutcomes ?? (workspaceRoot != null ? readWorkerOutcomeRecords(workspaceRoot) : []);
  return {
    liveCard: renderLiveCard(live, Date.now(), tasks, workerOutcomes, hours, lang),
    testsCard: renderTestsCard(tests, suiteRun, { hours, lang }),
    sysCard: renderSysCard(sys, lang),
    mgrCard: renderMgrCard(mgr, lang),
    taskCard: renderTaskCard(tasks, lang),
    goalCard: renderGoalCard(goals, { cap, staleMs, lang }),
    faninCard: renderFanInCardFromRecords(workerOutcomes, { hours, lang }),
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
  const hit = dashboardSnapshotStore.taskSummary(root, TASK_SUMMARY_CACHE_TTL_MS);
  if (hit != null) return hit;
  const r = await client.taskList({ includeBody: false });
  const tasks = r.tasks ?? [];
  dashboardSnapshotStore.cacheTaskSummary(root, tasks);
  return tasks;
}

// ── Dashboard live snapshot cache (gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks) ──
// The dashboard's liveCard renders taskId / phase / elapsed / title — elapsed is re-derived at render
// time from each in-flight task's FIXED startedAtMs (renderLiveCard passes a fresh nowMs), so caching
// the readLive RESULT for 30s does NOT freeze the displayed elapsed. The cache only skips re-running
// readLive's own expensive I/O (workflow-events read, worker carrier reads, /proc scan, per-task
// develop-ref status reads). computeBlocking is OFF: the liveCard never renders blocks/blockedBy, so
// the full task-store scan (the cost that grows with the store) is skipped entirely. Keyed by root
// (the same per-root bucket discipline as the task-summary cache).
export const DASHBOARD_LIVE_CACHE_TTL_MS = 30_000;

/** The dashboard's readLive: short-TTL-cached, computeBlocking disabled. A cache hit returns the SAME
 *  LiveResult object without re-running readLive's I/O; on a miss it runs readLive once (no task-store
 *  scan) and caches it for the TTL. */
function readDashboardLive(root: string): LiveResult {
  const hit = dashboardSnapshotStore.live(root, DASHBOARD_LIVE_CACHE_TTL_MS);
  if (hit != null) return hit;
  const live = readLive(root, { computeBlocking: false });
  dashboardSnapshotStore.cacheLive(root, live);
  return live;
}

// gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks: readSystem / readManagerLight are the
// dashboard's last two UN-cached probes — they shell out to the resource gate, the process budget and
// the loop-driver check on EVERY render (~2s combined, host-load-dependent), which is what pushes a warm
// dashboard past the 5s budget when a 15s background-refresh tick collides. The dashboard is a display
// snapshot with a 30s auto-refresh (DASHBOARD_CARD_REFRESH_MS), so these two probes get the SAME 30s
// snapshot cache as readLive/taskSummary — a cache hit returns the resolved value with zero subprocess
// spawns. Only SUCCESSFUL reads are cached (a failed probe is re-run next request, same fail-open
// policy as poolMetricsCache). The /system and /manager DETAIL pages keep calling the uncached readers,
// so a human opening those pages still gets a fresh reading.
async function readDashboardSystem(root: string): Promise<SystemResult> {
  const hit = dashboardSnapshotStore.system(root, DASHBOARD_LIVE_CACHE_TTL_MS);
  if (hit != null) return hit;
  const value = await readSystem(root);
  dashboardSnapshotStore.cacheSystem(root, value);
  return value;
}

async function readDashboardManagerLight(root: string): Promise<ManagerResult> {
  const hit = dashboardSnapshotStore.managerLight(root, DASHBOARD_LIVE_CACHE_TTL_MS);
  if (hit != null) return hit;
  const value = await readManagerLight(root);
  dashboardSnapshotStore.cacheManagerLight(root, value);
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

// `DashboardSnapshot` (the shape EVERYTHING below produces/consumes, and the value type of
// `dashboardSnapshotStore`) is declared in snapshot-store.ts and re-exported above — its declaration
// moved with the store that owns it, so the dependency stays one-way.
//
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
  return dashboardSnapshotStore.snapshot(root);
}

/** True while a rebuild for `root` is in flight — the read AC3/AC4's measurement needs (a direct
 *  reading of the mechanism's own state, not an inference from a timestamp). */
export function isDashboardSnapshotRebuilding(root: string): boolean {
  return dashboardSnapshotStore.isRebuilding(root);
}

/** Await the rebuild for `root`, if any (test seam — the request path never does this).
 *
 *  When a follow-up is queued it is preferred over the running build: the follow-up resolves strictly
 *  after the incumbent (it is chained onto it), so awaiting it is the reading that means "the store
 *  is reflected now" rather than "that older build finished". */
export function awaitDashboardSnapshotRebuild(root: string): Promise<void> {
  return dashboardSnapshotStore.awaitRebuild(root);
}

/** True when a follow-up rebuild is queued for `root` (an explicit `rebuildNow()` arrived while a
 *  build was in flight). Distinct from `isDashboardSnapshotRebuilding`, which reports the build that
 *  is RUNNING — together they are the honest reading of the two waits this mechanism can be in. */
export function isDashboardSnapshotFollowUpQueued(root: string): boolean {
  return dashboardSnapshotStore.isFollowUpQueued(root);
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
  await dashboardSnapshotStore.step();
  let tests: TestsResult;
  try { tests = await readTestsNonBlocking(root); } catch { tests = { status: "error", reason: "internal", runs: [] }; }

  await yieldToEventLoop();
  await dashboardSnapshotStore.step();
  let live: LiveResult;
  try { live = readDashboardLive(root); } catch { live = EMPTY_LIVE; }

  await yieldToEventLoop();
  await dashboardSnapshotStore.step();
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

/** Start the background rebuild tick for `root`. Runs one build immediately (the cold build lives
 *  HERE, at startup, not in a request — the same shape as startDevelopRefBackgroundRefresh), then
 *  re-builds every `intervalMs`. The interval is unref'd so it never keeps the process alive.
 *
 *  Rebuilds never stack: while one is in flight the next tick is skipped (a slow store must not
 *  queue up work that all lands at once) and explicit callers coalesce onto a single follow-up (see
 *  `RebuildPolicy`). A FAILED rebuild keeps the previous snapshot rather than blanking the page — a
 *  stale dashboard is honest, an empty one would be a fabricated absence.
 *
 *  Both policies, the follow-up coalescing and the in-flight marker's own `.delete()` are the store's
 *  (`dashboardSnapshotStore.followUp`), so the rebuild lifecycle has ONE owner instead of living
 *  half in a module-level Map and half in this closure. */
export function startDashboardSnapshotRefresh(
  root: string,
  client: ProviderClient,
  { intervalMs = DASHBOARD_SNAPSHOT_REFRESH_MS }: { intervalMs?: number } = {},
): { stop: () => void; rebuildNow: () => Promise<void> } {
  if (dashboardSnapshotDisabled()) return { stop: () => {}, rebuildNow: () => Promise.resolve() };
  // The complete-enough snapshot is installed ONLY when there is nothing to serve yet. On a refresh
  // the incumbent snapshot is strictly better (it already carries the shell-out cards), so an
  // interim would only ever downgrade it.
  const build = (): Promise<DashboardSnapshot> => buildDashboardSnapshot(root, client, {
    onInterim: (snap) => { dashboardSnapshotStore.publishInterim(root, snap); },
  });
  const rebuild = (policy: RebuildPolicy): Promise<void> => dashboardSnapshotStore.followUp(root, policy, build);
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
      { workspaceRoot: cfg.workspaceRoot, hours: timelineHoursFromRequest(req), identity: cfg.identity, workerOutcomes: snapshot.workerOutcomes, lang: cfg.lang },
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
  res.end(renderDashboardPage({ live, sys, mgr, tests, suiteRun, history, tasks, goals }, { workspaceRoot: cfg.workspaceRoot, hours, identity: cfg.identity, lang: cfg.lang }));
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
  // gap-webui-dashboard-body-copy-en-zh: was `{ workspaceRoot: string }` — widened to the dispatcher's
  // per-request cfg so the re-rendered cards carry the SAME resolved language as the page that polls
  // for them (the dispatcher already passes `reqCfg`, i.e. a full ServePageCfg; only this annotation
  // was narrower than what it was handed).
  cfg: ServePageCfg,
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
      workerOutcomes: snapshot.workerOutcomes, lang: cfg.lang,
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
    workspaceRoot: cfg.workspaceRoot, hours, cap, staleMs, lang: cfg.lang,
  }));
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
}
