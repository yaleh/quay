// serve-live.ts — /live + /journal route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readLive, readJournal, DEFAULT_DRIVER_CAP, type LiveResult, type JournalResult, type JournalSection, type InFlightPhase, type SuiteStateView } from "./observation.ts";
import type { ServePageCfg, ServeIdentity } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderMarkdown, relativeTime, renderSiteNav, renderMobileChrome, tableWrap, pageTitle, pageNameFor, htmlLangTag, DEFAULT_LANG, type Lang } from "./serve-render.ts";
import { journalLabelsFor, liveLabelsFor, fillLabel, dashboardLabel, type JournalKey, type LiveKey } from "./serve-i18n.ts";

// ── Loop-observation routes (gap-web-cannot-show-what-the-loop-is-doing-now) ────────────────
// /live + /journal render the loop's live state from workspace observation files. The data
// access is quarantined in observation.ts; these handlers only render what it returns. Each
// handler is wrapped defensively so ANY unexpected throw degrades to a 200 page with an error
// note (never a 500) — the hard degradation contract of this task.

/** AC-306 (gap-webui-journal-body-copy-en-zh): every word this page says comes from
 *  `journalLabelsFor(lang)` (serve-i18n.ts ROW 10) — ⛔ including the empty/error states, which the
 *  red baseline found with the same no-data differential that found the section headings.
 *
 *  ⚠️ `s.staleSource` is re-rendered here into the SAME markdown the reader used to hand over
 *  pre-baked, and the result goes through the SAME `renderMarkdown` — so `lang=zh` bytes are
 *  unchanged by construction, while `lang=en` gets an English sentence. The `### ` stays at this
 *  call site: it is markdown STRUCTURE (the heading level), not copy, and ROW 10's unit is the
 *  rendered sentence. */
function renderSectionBlock(s: JournalSection, title: string, L: Record<JournalKey, string>): string {
  if (s.status === "ok") {
    if (s.markdown && s.markdown.trim()) {
      const md = s.staleSource
        ? `### ${fillLabel(L.staleBanner, { date: s.staleSource.date, days: s.staleSource.days })}\n\n${s.markdown}`
        : s.markdown;
      return html`<h2>${title}</h2><div class="body">${renderMarkdown(md)}</div>`;
    }
    // Source exists and is readable, but has no recent content — distinct from both 「无数据」
    // (source absent) and 「读失败」 (source unreadable).
    return html`<h2>${title}</h2><p class="meta">${L.noContent}</p>`;
  }
  if (s.status === "empty") {
    return html`<h2>${title}</h2><p class="meta"><strong>${L.noData}</strong> — ${escapeHtml(s.reason || "")}</p>`;
  }
  return html`<h2>${title}</h2><p class="meta"><strong>${L.readFailed}</strong> — ${escapeHtml(s.reason || "")}</p>`;
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
 *  hand-built task literal missing the field) degrades to —, never a fabricated phase (hard rule ③b).
 *
 *  ⚠️ AC-291-era follow-up (gap-webui-live-body-copy-en-zh): `lang` is the request's resolved
 *  language, and the three PHASE WORDS resolve through `dashboardLabel` — ⛔ NOT through a second
 *  `LIVE_LABELS` copy. This page and the dashboard's liveCard render the SAME `InFlightPhase` enum
 *  in the same role, so two independent translations of 「实现中」 would be exactly the "改一处漏一处"
 *  drift this series removes (the task's contract names that duplication and forbids a second copy;
 *  the trade-off against ROW 11 ③ is recorded in the task body's 决定记录 and in serve-i18n ROW 19).
 *  ⛔ `fan-in` and `—` stay literals: both are language-NEUTRAL (the dashboard's own phaseLabel does
 *  the same for `fan-in`), so a dictionary row would add a key no reader could ever see translated.
 *
 *  The default is `DEFAULT_LANG`, the same shape as every other accessor in this file — a caller that
 *  forgets `lang` renders the DEFAULT language rather than throwing (⛔ silently-English is the other
 *  half of ROW 3's contract; here the parameter is threaded from the route, which always passes it). */
export function phaseLabel(phase: InFlightPhase | null | undefined, lang: Lang = DEFAULT_LANG): string {
  switch (phase) {
    case "implementing": return dashboardLabel("phaseImplementing", lang);
    case "fan-in": return "fan-in";
    case "awaiting-land": return dashboardLabel("phaseAwaitingLand", lang);
    case "landed": return dashboardLabel("phaseLanded", lang);
    default: return "—";
  }
}

/** fan-in 阶段的套件状态后缀（full-suite-state.json — gap-live-fan-in-execution-phase-two-axis）：
 *  ` · suite green` 之类；无 suite 状态时为 ""（诚实无标注，不伪造「suite 在跑」）。 */
export function suiteSuffix(suite: SuiteStateView | null): string {
  if (suite == null || suite.state == null) return "";
  return ` · suite ${suite.state}`;
}

/** The `{flags}` payload of ROW 19's `nextStepUnwired` sentence — the two lifecycle markers an
 *  unwired loop is missing. ⛔ MARKUP, from a repo literal (never request data), so it is interpolated
 *  into the sentence's hole UNESCAPED on purpose: the dictionary stays copy-only while the `<code>`
 *  ELEMENT stays here at the render site (the same rule as ROW 18's `{code}` payloads). */
const NEXT_STEP_FLAGS = "<code>--task-start</code>/<code>--task-end</code>";

/** AC-291 wired this page's CHROME and this task (gap-webui-live-body-copy-en-zh) wired its BODY:
 *  every word /live says now resolves through `liveLabelsFor(lang)` (serve-i18n.ts ROW 19), except
 *  the three PHASE words, which resolve through `dashboardLabel` (ROW 5) — see `phaseLabel`'s note
 *  for why that one duplication was DELETED rather than duplicated.
 *
 *  `lang` is the request's resolved language (AC-288's mechanism, threaded in by the dispatcher). It
 *  reaches the `<html lang>` attribute, the shared nav bar (`renderSiteNav` — whose `live` entry is in
 *  NAV_LABELS), the MOBILE nav, this page's OWN chrome (`<title>`/`<h1>` tokens via `pageNameFor`
 *  against PAGE_LABELS), and now the whole body.
 *
 *  ⛔ NOT translated, BY MEASUREMENT (the four-state red baseline's residual classification): the
 *  reader's own diagnostics — `live.reason` (the read-failure line) and `live.liveExplanation` (how a
 *  telemetry-empty state was decided) — are rendered verbatim through `escapeHtml` in BOTH languages.
 *  They are observation.ts's strings (that module owns them and its consumers span pages), and they
 *  are this page's NAMED out-of-scope residue — the identical classification /dashboard, /journal,
 *  /board and /architecture made for the same class of string. Under `en` the two banner states
 *  therefore still carry ONE Chinese line each, and the black-box test pins that fact explicitly
 *  (⛔ it is not an oversight, and a test that merely ignored it would let it read as one).
 *
 *  ⛔ `/journal` (renderJournalPage below) is NOT wired by THIS task — AC-296 wired its chrome and
 *  ROW 10 its body copy. /live and /journal share this FILE, so the boundary is asserted by
 *  serve-live-zh-chrome.test.mjs rather than assumed. */
export function renderLivePage(live: LiveResult, identity: ServeIdentity | null = null, lang: Lang = DEFAULT_LANG): string {
  // The whole roster, taken ONCE (the `navLabelsFor` idiom) — the body copy is now as language-aware
  // as the chrome AC-291 already wired.
  const L: Record<LiveKey, string> = liveLabelsFor(lang);

  // gap-webui-cross-task-blocking-visibility: render the cross-task blocking relation (Touches
  // intersection + depends_on chain) computed by observation.computeInFlightBlocking. A task-id list
  // renders as comma-joined links; an empty list renders ROW 19's 「无」/「none」 placeholder so "no
  // relation" is visually DISTINCT from "no data" (hard rule: a missing value must not look like a
  // pass/absence).
  const taskLink = (id: string): string => html`<a href="/task/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`;
  const linkList = (ids: string[]): string =>
    ids.length > 0
      ? ids.map(taskLink).join(", ")
      : html`<span class="meta">${L.cellNone}</span>`;

  // gap-live-fan-in-execution-phase-two-axis (AC4): the 状态 column renders the LIFECYCLE status
  // (todo/ready/done/needs-human, axis 1) and a NEW 阶段 column renders the execution phase enum
  // (axis 2) — the two axes are no longer crammed into one label (the old 「实现中 / 已完工待落地」
  // conflated an execution signal with lifecycle words). The awaiting-land duration renders only for
  // the awaiting-land phase (a placeholder — for every other phase). ⚠️ The six ALREADY-English
  // headers stay literals: they are not copy this task moved, and re-spelling them would change the
  // en baseline the AC-291 test pins.
  const rows = live.inFlight.length > 0 ? tableWrap(html`<table>
    <tr><th>task id</th><th>run id</th><th>pid</th><th>transcript</th><th>started</th><th>elapsed</th><th>${L.colStatus}</th><th>${L.colPhase}</th><th>${L.colAwaitingDuration}</th><th>${L.colBlocks}</th><th>${L.colBlockedBy}</th></tr>
    ${live.inFlight.map((t) => html`<tr>
      <td>${taskLink(t.taskId)}</td>
      <td>${escapeHtml(t.runId)}</td>
      <td>${t.pid != null ? escapeHtml(t.pid) : html`<span class="meta">—</span>`}</td>
      <td>${t.sessionId != null ? html`<a href="/session/${encodeURIComponent(t.sessionId)}">transcript</a>` : html`<span class="meta">—</span>`}</td>
      <td>${escapeHtml(relativeTime(t.startedAtMs))}</td>
      <td>${escapeHtml(fillLabel(L.elapsedMinutes, { minutes: escapeHtml(t.minutes.toFixed(1)) }))}</td>
      <td>${t.status != null ? escapeHtml(t.status) : html`<span class="meta">—</span>`}</td>
      <td>${t.phase === "fan-in" ? html`<strong>${escapeHtml(phaseLabel(t.phase, lang) + suiteSuffix(t.suite))}</strong>` : escapeHtml(phaseLabel(t.phase, lang))}</td>
      <td>${escapeHtml(t.phase === "awaiting-land" ? formatAwaitingDuration(awaitingLandMs(t)) : "—")}</td>
      <td class="clamp">${linkList(t.blocks)}</td>
      <td class="clamp">${linkList(t.blockedBy)}</td>
    </tr>`).join("\n")}
  </table>`) : "";

  // gap-live-cannot-tell-a-dead-loop-from-an-unwired-one: telemetry-empty no longer renders one
  // generic 「无数据」 — it renders one of TWO states decided by activity signals, each with the
  // judgment evidence (which signal present/absent) and a next-step action. The machine key
  // (`live_state=…`) is emitted in-band so `curl /live | grep live_state` is the contract measure.
  // A telemetry READ FAILURE still renders ROW 19's `readFailed` and nothing else (AC4: no regression
  // — the two empty-state texts must never mask an unreadable store). ⚠️ The reader's `liveExplanation`
  // / `reason` half of each banner renders VERBATIM (see this function's header note).
  let statusNote = "";
  if (live.status === "error") {
    statusNote = html`<p class="meta"><strong>${L.readFailed}</strong> — ${escapeHtml(live.reason || "")}</p>`;
  } else if (live.liveState === "running-unwired") {
    statusNote = html`<div class="info-banner" role="status">
      <p><strong>${L.liveStateRunningUnwired}</strong> <code>live_state=running-unwired</code></p>
      <p>${escapeHtml(live.liveExplanation || "")}</p>
      <p>${fillLabel(L.nextStepUnwired, { flags: NEXT_STEP_FLAGS })}</p>
    </div>`;
  } else if (live.liveState === "not-running") {
    statusNote = html`<div class="error-banner" role="alert">
      <p><strong>${L.liveStateNotRunning}</strong> <code>live_state=not-running</code></p>
      <p>${escapeHtml(live.liveExplanation || "")}</p>
      <p>${L.nextStepNotRunning}</p>
    </div>`;
  }

  // ⚠️ The line is `<code>live_state=running</code>` + ROW 19's two summary rows CONCATENATED — each
  // row carries its own leading ` · ` (see the row's note in serve-i18n.ts), so ⛔ no separator is
  // assembled here: a separator written at this call site would sit OUTSIDE both columns and could
  // drift away from the zh baseline without any dictionary test noticing.
  const summary = live.status === "ok"
    ? html`<p class="meta"><code>live_state=running</code>${fillLabel(L.inFlightCap, { inFlight: live.inFlight.length, cap: live.concurrencyCap })}${live.cpuPressure != null
        ? fillLabel(L.cpuPressure, { value: escapeHtml(live.cpuPressure.toFixed(2)) })
        : ""}</p>`
    : "";

  // gap-webui-cross-task-blocking-visibility (AC2): the cross-task blocking relation as ONE sentence
  // per blocking in-flight task (plus the 「被 … 阻塞」 mirror). ⚠️ The sentence is a ROW 19 template
  // and NOT three fragments joined here: the `<a>` links sit mid-sentence and the two columns place
  // their holes by their own word order (the reason ROW 18's `{code}` shape exists). `{task}` and
  // `{ids}` carry ALREADY-`escapeHtml`ed markup. So `curl /live | grep 阻塞` on the **zh** page is
  // still the unambiguous contract measure — the relation no longer lives only in tick-log prose. A
  // task with neither relation contributes no line; the whole section falls back to ROW 19's
  // `noBlockingRelation` when no in-flight task blocks anything.
  const blockingLines = live.inFlight.flatMap((t) => {
    const blocks = t.blocks.length > 0
      ? [html`<li>${fillLabel(L.blockingLine, { task: taskLink(t.taskId), ids: t.blocks.map(taskLink).join(", ") })}</li>`]
      : [];
    const blockedBy = t.blockedBy.length > 0
      ? [html`<li>${fillLabel(L.blockedByLine, { task: taskLink(t.taskId), ids: t.blockedBy.map(taskLink).join(", ") })}</li>`]
      : [];
    return [...blocks, ...blockedBy];
  });
  const blockingSection = blockingLines.length > 0
    ? html`<h2>${L.blockingHeading}</h2><ul>${blockingLines.join("\n")}</ul>`
    : html`<p class="meta">${L.noBlockingRelation}</p>`;

  // ⚠️ The `<meta name="description">` is ALREADY English in both languages and passes through no
  // dictionary — it is this page's NAMED out-of-scope residue, exactly like /architecture's: moving it
  // would change `lang=zh` output, which this task's AC3 forbids.
  return html`<!doctype html>
    ${htmlLangTag(lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay live — what the loop is doing right now">${modernistStyles()}${pageStyles()}<title>${pageTitle("Live — loop activity", identity, lang)}</title></head>
    <body>${renderMobileChrome("live", "live", lang)}${renderSiteNav("live", lang)}<main id="main">
      <h1>${pageNameFor("Live", lang)} — ${L.titleSuffix}</h1>
      ${statusNote}
      ${summary}
      ${blockingSection}
      ${live.status === "ok" && live.inFlight.length === 0 ? html`<p class="meta">${L.noInFlight}</p>` : rows}
    </main></body></html>`;
}

/** AC-296: `lang` is the request's resolved language (AC-288's mechanism, threaded in by the
 *  dispatcher). Same four-point shape as renderLivePage above and for the same reason — the
 *  `<html lang>` attribute, the shared nav bar, the MOBILE nav, and this page's OWN chrome
 *  (`<title>` token + `<h1>` token via `pageNameFor` against serve-i18n.ts's PAGE_LABELS).
 *  The last two are the whole point: a shared nav bar that switches while THIS page's own
 *  `<title>` stays English is precisely what the criterion's `title-unchanged` arm rejects. */
function renderJournalPage(journal: JournalResult, identity: ServeIdentity | null = null, lang: Lang = DEFAULT_LANG): string {
  // AC-306: the whole roster, taken ONCE (the `navLabelsFor` idiom) — the body copy is now as
  // language-aware as the chrome AC-296 already wired. The data sections below are rendered
  // VERBATIM (⛔ never translated, never truncated): the /journal page shows escalations.md and
  // tick-log.md, whose Chinese is the operator's own written record, not this page's copy.
  const L = journalLabelsFor(lang);
  return html`<!doctype html>
    ${htmlLangTag(lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay journal — recent loop record">${modernistStyles()}${pageStyles()}<title>${pageTitle("Journal — recent loop record", identity, lang)}</title></head>
    <body>${renderMobileChrome("journal", "journal", lang)}${renderSiteNav("journal", lang)}<main id="main">
      <h1>${pageNameFor("Journal", lang)} — ${L.titleSuffix}</h1>
      ${renderSectionBlock(journal.escalations, L.sectionEscalations, L)}
      ${renderSectionBlock(journal.tickLog, L.sectionTickLog, L)}
      ${renderSectionBlock(journal.commits, L.sectionCommits, L)}
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
  res.end(renderLivePage(live, cfg.identity, cfg.lang));
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
  res.end(renderJournalPage(journal, cfg.identity, cfg.lang));
}
