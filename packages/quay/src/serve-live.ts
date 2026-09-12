// serve-live.ts — /live + /journal route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readLive, readJournal, DEFAULT_DRIVER_CAP, type LiveResult, type JournalResult, type JournalSection, type InFlightPhase, type SuiteStateView } from "./observation.ts";
import type { ServePageCfg, ServeIdentity } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderMarkdown, relativeTime, renderSiteNav, renderMobileChrome, tableWrap, pageTitle, LIVE_STATE_RUNNING_UNWIRED_LABEL, LIVE_STATE_NOT_RUNNING_LABEL } from "./serve-render.ts";

// ── Loop-observation routes (gap-web-cannot-show-what-the-loop-is-doing-now) ────────────────
// /live + /journal render the loop's live state from workspace observation files. The data
// access is quarantined in observation.ts; these handlers only render what it returns. Each
// handler is wrapped defensively so ANY unexpected throw degrades to a 200 page with an error
// note (never a 500) — the hard degradation contract of this task.

function renderSectionBlock(s: JournalSection, title: string): string {
  if (s.status === "ok") {
    if (s.markdown && s.markdown.trim()) {
      return html`<h2>${title}</h2><div class="body">${renderMarkdown(s.markdown)}</div>`;
    }
    // Source exists and is readable, but has no recent content — distinct from both 无数据
    // (source absent) and 读失败 (source unreadable).
    return html`<h2>${title}</h2><p class="meta">暂无内容。</p>`;
  }
  if (s.status === "empty") {
    return html`<h2>${title}</h2><p class="meta"><strong>无数据</strong> — ${escapeHtml(s.reason || "")}</p>`;
  }
  return html`<h2>${title}</h2><p class="meta"><strong>读失败</strong> — ${escapeHtml(s.reason || "")}</p>`;
}

// gap-webui-live-implcomplete-state-render: the impl-complete boundary (implCompletedAtMs) splits an
// in-flight run into implementing (null) vs awaiting-land (non-null). The awaiting-land duration is
// now − implCompletedAtMs, where "now" is the observation instant ALREADY embedded in the snapshot
// (minutes = (now − startedAtMs)/60000) — so the render stays a pure function of LiveResult, with no
// Date.now() inside it (deterministic and testable against a fixed nowMs).
export function awaitingLandMs(t: { startedAtMs: number; minutes: number; implCompletedAtMs: number | null }): number | null {
  if (t.implCompletedAtMs == null) return null;
  const nowMs = t.startedAtMs + t.minutes * 60_000;
  return Math.max(0, nowMs - t.implCompletedAtMs);
}

export function formatAwaitingDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "<1m";
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/** The execution-phase label for the /live 阶段 column (gap-live-fan-in-execution-phase-two-axis
 *  AC4). The phase enum is the machine key; the label is human-readable. A null/undefined phase (a
 *  hand-built task literal missing the field) degrades to —, never a fabricated phase (hard rule ③b). */
export function phaseLabel(phase: InFlightPhase | null | undefined): string {
  switch (phase) {
    case "implementing": return "实现中";
    case "fan-in": return "fan-in";
    case "awaiting-land": return "待落地";
    case "landed": return "已落地";
    default: return "—";
  }
}

/** fan-in 阶段的套件状态后缀（full-suite-state.json — gap-live-fan-in-execution-phase-two-axis）：
 *  ` · suite green` 之类；无 suite 状态时为 ""（诚实无标注，不伪造「suite 在跑」）。 */
export function suiteSuffix(suite: SuiteStateView | null): string {
  if (suite == null || suite.state == null) return "";
  return ` · suite ${suite.state}`;
}

export function renderLivePage(live: LiveResult, identity: ServeIdentity | null = null): string {
  // gap-webui-cross-task-blocking-visibility: render the cross-task blocking relation (Touches
  // intersection + depends_on chain) computed by observation.computeInFlightBlocking. A task-id list
  // renders as comma-joined links; an empty list renders the 「无」 placeholder so "no relation" is
  // visually DISTINCT from "no data" (hard rule: a missing value must not look like a pass/absence).
  const linkList = (ids: string[]): string =>
    ids.length > 0
      ? ids.map((id) => html`<a href="/task/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`).join(", ")
      : html`<span class="meta">无</span>`;

  // gap-live-fan-in-execution-phase-two-axis (AC4): the 状态 column renders the LIFECYCLE status
  // (todo/ready/done/needs-human, axis 1) and a NEW 阶段 column renders the execution phase enum
  // (axis 2) — the two axes are no longer crammed into one label (the old 「实现中 / 已完工待落地」
  // conflated an execution signal with lifecycle words). 待落地时长 renders only for the
  // awaiting-land phase (a placeholder — for every other phase).
  const rows = live.inFlight.length > 0 ? tableWrap(html`<table>
    <tr><th>task id</th><th>run id</th><th>pid</th><th>transcript</th><th>started</th><th>elapsed</th><th>状态</th><th>阶段</th><th>待落地时长</th><th>阻塞 (blocks)</th><th>被阻塞 (blockedBy)</th></tr>
    ${live.inFlight.map((t) => html`<tr>
      <td><a href="/task/${encodeURIComponent(t.taskId)}">${escapeHtml(t.taskId)}</a></td>
      <td>${escapeHtml(t.runId)}</td>
      <td>${t.pid != null ? escapeHtml(t.pid) : html`<span class="meta">—</span>`}</td>
      <td>${t.sessionId != null ? html`<a href="/session/${encodeURIComponent(t.sessionId)}">transcript</a>` : html`<span class="meta">—</span>`}</td>
      <td>${escapeHtml(relativeTime(t.startedAtMs))}</td>
      <td>${escapeHtml(t.minutes.toFixed(1))} 分钟</td>
      <td>${t.status != null ? escapeHtml(t.status) : html`<span class="meta">—</span>`}</td>
      <td>${t.phase === "fan-in" ? html`<strong>${escapeHtml(phaseLabel(t.phase) + suiteSuffix(t.suite))}</strong>` : escapeHtml(phaseLabel(t.phase))}</td>
      <td>${escapeHtml(t.phase === "awaiting-land" ? formatAwaitingDuration(awaitingLandMs(t)) : "—")}</td>
      <td class="clamp">${linkList(t.blocks)}</td>
      <td class="clamp">${linkList(t.blockedBy)}</td>
    </tr>`).join("\n")}
  </table>`) : "";

  // gap-live-cannot-tell-a-dead-loop-from-an-unwired-one: telemetry-empty no longer renders one
  // generic 「无数据」 — it renders one of TWO states decided by activity signals, each with the
  // judgment evidence (which signal present/absent) and a next-step action. The machine key
  // (`live_state=…`) is emitted in-band so `curl /live | grep live_state` is the contract measure.
  // A telemetry READ FAILURE still renders 「读失败」 and nothing else (AC4: no regression — the
  // two empty-state texts must never mask an unreadable store).
  let statusNote = "";
  if (live.status === "error") {
    statusNote = html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(live.reason || "")}</p>`;
  } else if (live.liveState === "running-unwired") {
    statusNote = html`<div class="info-banner" role="status">
      <p><strong>${LIVE_STATE_RUNNING_UNWIRED_LABEL}</strong> <code>live_state=running-unwired</code></p>
      <p>${escapeHtml(live.liveExplanation || "")}</p>
      <p>下一步：检查目标项目的循环是否调用 <code>--task-start</code>/<code>--task-end</code>。</p>
    </div>`;
  } else if (live.liveState === "not-running") {
    statusNote = html`<div class="error-banner" role="alert">
      <p><strong>${LIVE_STATE_NOT_RUNNING_LABEL}</strong> <code>live_state=not-running</code></p>
      <p>${escapeHtml(live.liveExplanation || "")}</p>
      <p>下一步：检查会话/cron 是否启动。</p>
    </div>`;
  }

  const summary = live.status === "ok"
    ? html`<p class="meta"><code>live_state=running</code> · 在飞: ${live.inFlight.length} / 上限: ${live.concurrencyCap}${live.cpuPressure != null
        ? html` · CPU 压力 (some avg10): ${escapeHtml(live.cpuPressure.toFixed(2))}`
        : ""}</p>`
    : "";

  // gap-webui-cross-task-blocking-visibility (AC2): the cross-task blocking relation as a literal
  // 「任务 X 正在阻塞 [Y, Z]」 sentence per blocking in-flight task (plus the 「被 … 阻塞」 mirror), so
  // `curl /live | grep 阻塞` is the unambiguous contract measure — the relation no longer lives only
  // in tick-log prose. A task with neither relation contributes no line; the whole section falls back
  // to 「无跨任务阻塞关系」 when no in-flight task blocks anything.
  const blockingLines = live.inFlight.flatMap((t) => {
    const blocks = t.blocks.length > 0
      ? [html`<li>任务 <a href="/task/${encodeURIComponent(t.taskId)}">${escapeHtml(t.taskId)}</a> 正在阻塞 [${t.blocks.map((id) => html`<a href="/task/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`).join(", ")}]</li>`]
      : [];
    const blockedBy = t.blockedBy.length > 0
      ? [html`<li>任务 <a href="/task/${encodeURIComponent(t.taskId)}">${escapeHtml(t.taskId)}</a> 被 [${t.blockedBy.map((id) => html`<a href="/task/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`).join(", ")}] 阻塞</li>`]
      : [];
    return [...blocks, ...blockedBy];
  });
  const blockingSection = blockingLines.length > 0
    ? html`<h2>跨任务阻塞关系</h2><ul>${blockingLines.join("\n")}</ul>`
    : html`<p class="meta">无跨任务阻塞关系。</p>`;

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay live — what the loop is doing right now">${modernistStyles()}${pageStyles()}<title>${pageTitle("Live — loop activity", identity)}</title></head>
    <body>${renderMobileChrome("live", "live")}${renderSiteNav("live")}<main id="main">
      <h1>Live — 循环此刻在做什么</h1>
      ${statusNote}
      ${summary}
      ${blockingSection}
      ${live.status === "ok" && live.inFlight.length === 0 ? html`<p class="meta">当前无在飞任务。</p>` : rows}
    </main></body></html>`;
}

function renderJournalPage(journal: JournalResult, identity: ServeIdentity | null = null): string {
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay journal — recent loop record">${modernistStyles()}${pageStyles()}<title>${pageTitle("Journal — recent loop record", identity)}</title></head>
    <body>${renderMobileChrome("journal", "journal")}${renderSiteNav("journal")}<main id="main">
      <h1>Journal — 循环最近记录</h1>
      ${renderSectionBlock(journal.escalations, "升级项 (escalations.md)")}
      ${renderSectionBlock(journal.tickLog, "Tick 记录 (tick-log.md)")}
      ${renderSectionBlock(journal.commits, "最近提交 (git log)")}
    </main></body></html>`;
}

export async function handleLive(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: ServePageCfg,
): Promise<void> {
  let live: LiveResult;
  try {
    live = readLive(cfg.workspaceRoot);
  } catch (err) {
    live = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      inFlight: [],
      concurrencyCap: DEFAULT_DRIVER_CAP,
      cpuPressure: null,
      liveState: null,
      liveExplanation: null,
      activity: null,
    };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderLivePage(live, cfg.identity));
}

export async function handleJournal(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: ServePageCfg,
): Promise<void> {
  let journal: JournalResult;
  try {
    journal = readJournal(cfg.workspaceRoot);
  } catch (err) {
    const degraded: JournalSection = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      markdown: null,
    };
    journal = { escalations: degraded, tickLog: degraded, commits: degraded };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderJournalPage(journal, cfg.identity));
}
