// serve-board.ts — /board route handler, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { readBoardLanding, readBoardExecution, readTaskStatusMapAtRef, yieldToEventLoop, type BoardLanding, type BoardExecution } from "./observation.ts";
import type { Manifest, ServePageCfg, ServeIdentity } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, DEFAULT_PAGE_SIZE, buildHref, renderSiteNav, renderMobileChrome, tableWrap, pageTitle, pageNameFor, htmlLangTag, DEFAULT_LANG, type Lang } from "./serve-render.ts";
// gap-webui-board-body-copy-en-zh: this page's BODY copy resolves through serve-i18n.ts's ROW 11
// dictionary (`boardLabelsFor` / `fillLabel` / `boardLabel`) instead of hard-coded Chinese literals —
// the same pattern gap-webui-dashboard-body-copy-en-zh established (ROW 5) and the rest of the series
// copies. (ROW 10 is /journal's, which landed into develop first.)
import { boardLabelsFor, boardLabel, fillLabel } from "./serve-i18n.ts";

// ── /board — 三源 join 看板 (gap-web-board-needs-an-inconsistency-verdict-it-does-not-have) ──
// The board joins 意图 (task store) + 执行 (telemetry) + 落地 (git code existence). The LANDING
// judgment is REUSED from plugin/scripts/task-status-drift-check.ts via observation.readBoardLanding
// (AC1: reuse, not reimplement — the drift checker is the single authority). The board emits one
// `data-flag` attribute per task matching the checker's suspects/reverse, so the Contract's band
// (board_flags == suspects + reverse, per-task) holds BY CONSTRUCTION (AC2/AC3). Execution flags
// (在飞超时/孤儿) use a separate `data-exec-flag` attribute so they never pollute the data-flag count.
//
// gap-webui-board-no-pagination: the board renders 1257 rows with no pagination and no filters.
// This adds server-side pagination (?page=N, ?pageSize=N) and status/label filtering
// (?status=<s>, ?label=<l> repeated for AND-logic), all evaluated in handleBoard against the
// joined board view and rendered server-side — no client JS (AC3). The page nav mirrors the
// /tasks handler's QW-007 pagination pattern.

// ── gap-webui-board-transient-columns-drowned-by-history: the transient default view ──────────────
// 「执行」(.workflow-events/) and 「落地」 (task-status-drift-check.ts) are TRANSIENT signals: a row is
// non-empty only while its task is actually in flight, awaiting fan-in, or carrying a drift flag.
// Painted across the WHOLE store (production: 2248 rows, 2171 of them done and mostly 57+ days idle)
// the default view is near-necessarily a wall of 「—」 whatever the sampling luck — the page's own
// counters said 「0 实现中 · 0 待落地」 while it paged 113 pages of dashes. The default view (no
// status/label filter, no ?all=1) therefore shows ONLY the rows where either transient column is
// non-empty; the full store stays one click away (?all=1, or any explicit status/label filter).
//
// The filter is applied ONLY when BOTH transient sources actually READ (`status === "ok"`). A source
// that is absent (`empty`) or unreadable (`error`) is NOT a source that says "nothing": hiding rows
// on its authority would assert ABSENCE from an INCOMPLETE source (硬规则 5 来源完备性), turning
// 「无法判定哪些任务在飞」 into 「没有任务在飞」 — a false claim rendered as a confident one
// (硬规则 3b: a judge that cannot read its input must not return a value shaped like "passed").
// The off-state is therefore its own rendered text, never silent.
export type BoardTransientView = "applied" | "off-source-incomplete" | "off-explicit-all";

/** True when a joined row carries a live transient signal in either column. */
export function isTransientRow(r: {
  landingFlag: string | null;
  execFlags: string[];
  inFlightMinutes: number | null;
}): boolean {
  return r.landingFlag != null || r.execFlags.length > 0 || r.inFlightMinutes != null;
}

// Build /board query links preserving active status/label filters and page size while changing
// the page. Mirrors buildHref (/tasks) scoped to the board's params. Zero client JS — the links
// are plain server-rendered <a href>.
function buildBoardHref(
  status: string | null,
  label: string[],
  pg: number | null,
  pageSizeOverride: number,
  showAll = false,
): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  for (const l of label) params.append("label", l);
  if (showAll) params.set("all", "1");
  if (pg && pg > 1) params.set("page", String(pg));
  if (pageSizeOverride !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSizeOverride));
  const qs = params.toString();
  return qs ? `/board?${qs}` : "/board";
}

/** AC-292: `lang` is this request's resolved language (AC-288's mechanism, threaded in by the
 *  dispatcher via `handleBoard`'s `cfg.lang`). It reaches FOUR things on this page and nothing else:
 *  the `<html lang>` attribute, the shared nav bar (`renderSiteNav`) and mobile chrome
 *  (`renderMobileChrome`) — whose `board` entry already exists in NAV_LABELS (ROW 1) — the page's
 *  own `<title>` (through `pageTitle`), and the `<h1>`'s page-name token (through `pageNameFor`
 *  against serve-i18n.ts's PAGE_LABELS). The last two are the whole point: wiring only the SHARED
 *  nav bar would leave the `<title>` at its English token, which is the difference between "the nav
 *  switched" and "THIS page switched" — and AC-292's third arm fails the page on exactly that
 *  (CAUSE=title-unchanged).
 *
 *  `lang` DEFAULTS to `DEFAULT_LANG` on purpose: the direct `renderBoardPage()` callers that predate
 *  it (unit tests, the load-120s AC3 fail-open test) keep rendering byte-for-byte what they rendered
 *  before, and `pageNameFor`'s en column is the identity for every token — so the en baseline the
 *  goal criterion reads off the live page cannot move as this page is wired. */
export function renderBoardPage(board: {
  landing: BoardLanding;
  execution: BoardExecution;
  intentStatus: "ok" | "error";
  intentReason: string | null;
  rows: Array<{
    id: string;
    title: string;
    status: string;
    labels: string[];
    landingFlag: string | null;
    execFlags: string[];
    inFlightMinutes: number | null;
    /** True when the run has an impl-complete event (awaiting-land segment — 排队待落地). */
    awaitingLand: boolean;
  }>;
  // gap-webui-board-no-pagination: server-side pagination + status/label filter metadata.
  // Optional — a board built without it (e.g. direct renderBoardPage unit-test callers) renders
  // as a single unfiltered page (defaults applied inside the render, never a crash).
  page?: number;
  totalPages?: number;
  totalRows?: number;
  statusFilter?: string | null;
  labelFilters?: string[];
  pageSize?: number;
  pageSizeInvalid?: boolean;
  /** Default-view transient filter state (gap-webui-board-transient-columns-drowned-by-history).
   *  OMITTED (direct renderBoardPage callers) = legacy rendering: no filter, the whole joined set. */
  transientView?: BoardTransientView;
  /** Joined rows BEFORE the transient filter — the N in 「显示全部 N 行」. Defaults to totalRows. */
  joinedTotal?: number;
  /** Human labels of the transient sources that are not `ok` (rendered by "off-source-incomplete"). */
  incompleteSources?: string[];
}, identity: ServeIdentity | null = null, lang: Lang = DEFAULT_LANG): string {
  // The page's whole body-copy roster, taken ONCE (ROW 5's `navLabelsFor` idiom) instead of
  // re-reading BOARD_LABELS at each of ~30 call sites.
  const L = boardLabelsFor(lang);
  const landingNote = board.landing.status === "ok"
    ? html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · ${fillLabel(L.scanTasks, { n: board.landing.scanned })}</span>`
    : board.landing.status === "empty"
      ? html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · <strong>${L.noData}</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
      : board.landing.timedOut
        // gap-webui-board-load-120s AC3 — fail-open: a subprocess that exceeded LANDING_TIMEOUT_MS
        // renders 「读取超时」 (distinct from a generic 读失败) instead of empty-waiting to the old
        // 120s hard cap.
        ? html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · <strong>${L.readTimeout}</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
        : html`<span>${L.landingSource} <code>task-status-drift-check.ts</code> · <strong>${L.readFailed}</strong> — ${escapeHtml(board.landing.reason || "")}</span>`;
  // gap-inflight-states-missing-impl-complete-event: the in-flight view splits into TWO independent
  // counts — implementing (start, no impl-complete: 真正在实现) vs awaiting-land (impl-complete, no
  // end: 排队待落地). Build dispatch reads the former; the land single-flight gate reads the latter.
  const implementingCount = board.execution.inFlight.filter((t) => t.implCompletedAtMs == null).length;
  const awaitingLandCount = board.execution.inFlight.length - implementingCount;
  const execNote = board.execution.status === "ok"
    ? html`<span>${L.execSource} <code>.workflow-events/</code> · ${fillLabel(L.inFlightBreakdown, { implementing: implementingCount, awaiting: awaitingLandCount })}</span>`
    : board.execution.status === "empty"
      ? html`<span>${L.execSource} <code>.workflow-events/</code> · <strong>${L.noData}</strong> — ${escapeHtml(board.execution.reason || "")}</span>`
      : html`<span>${L.execSource} <code>.workflow-events/</code> · <strong>${L.readFailed}</strong> — ${escapeHtml(board.execution.reason || "")}</span>`;
  const intentNote = board.intentStatus === "ok"
    ? html`<span>${L.intentSource}</span>`
    : html`<span>${L.intentSource} · <strong>${L.readFailed}</strong> — ${escapeHtml(board.intentReason || "")}</span>`;

  const rows = board.rows.map((r) => {
    const flagAttr = r.landingFlag ? ` data-flag="${escapeHtml(r.landingFlag)}"` : "";
    const execAttr = r.execFlags.length > 0 ? ` data-exec-flag="${escapeHtml(r.execFlags.join(","))}"` : "";
    const execCell = r.inFlightMinutes != null
      ? html`${fillLabel(L.inFlightMinutes, { minutes: r.inFlightMinutes.toFixed(1) })}${r.awaitingLand ? html` · <strong>${L.awaitingLandTag}</strong>` : ""}${r.execFlags.map((f) => html` · <strong>${f === "in-flight-timeout" ? L.inFlightTimeout : L.orphan}</strong>`).join("")}`
      : (r.execFlags.length > 0 ? r.execFlags.map((f) => html`<strong>${f === "in-flight-timeout" ? L.inFlightTimeout : L.orphan}</strong>`).join(" · ") : "—");
    const landingCell = r.landingFlag === "done-unlanded"
      ? html`<strong>${L.doneUnlanded}</strong>`
      : r.landingFlag === "landed-not-closed"
        ? html`<strong>${L.landedNotClosed}</strong>`
        : "—";
    return html`<tr${flagAttr}${execAttr}>
      <td><a href="/task/${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a></td>
      <td>${escapeHtml(r.status)}${(r.labels.length > 0 ? ` · ${escapeHtml(r.labels.join(", "))}` : "")}</td>
      <td>${execCell}</td>
      <td>${landingCell}</td>
    </tr>`;
  }).join("\n");

  // ── gap-webui-board-no-pagination: filter summary + page-size selector + page nav ──
  // All server-rendered: plain <a href> links and one GET form — no <script> anywhere (AC3).
  // The metadata is optional on the input board: a board object built without pagination/filter
  // fields (direct renderBoardPage callers, e.g. the load-120s AC3 fail-open unit test) renders
  // as a single unfiltered page at the default page size — never a crash.
  const page = board.page ?? 1;
  const totalPages = board.totalPages ?? 1;
  const totalRows = board.totalRows ?? board.rows.length;
  const statusFilter = board.statusFilter ?? null;
  const labelFilters = board.labelFilters ?? [];
  const pageSize = board.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSizeInvalid = board.pageSizeInvalid ?? false;
  const filterParts: string[] = [];
  if (statusFilter) {
    filterParts.push(html`status=${escapeHtml(statusFilter)} (<a href="${buildBoardHref(null, labelFilters, null, pageSize)}">clear</a>)`);
  }
  for (const l of labelFilters) {
    filterParts.push(html`label=${escapeHtml(l)} (<a href="${buildBoardHref(statusFilter, labelFilters.filter((x) => x !== l), null, pageSize)}">clear</a>)`);
  }
  const filterNav = filterParts.length > 0
    ? html`<p class="meta list-nav">Filter: ${filterParts.join(" · ")}</p>`
    : "";
  // ── the transient default view's own explanation block ────────────────────────────────────────
  // FOUR DISTINCT states, each with its own text — 「判定过且为空」 and 「无法判定」 must never share
  // wording (硬规则 3b: the un-evaluated state needs its own value, or the page cannot be told apart
  // from a passing one). `transientView == null` is the legacy direct-caller path: no note at all.
  const transientView = board.transientView;
  const joinedTotal = board.joinedTotal ?? totalRows;
  const showAllHref = buildBoardHref(statusFilter, labelFilters, null, pageSize, true);
  const hasRows = board.rows.length > 0;
  const allRowsHref = html`<a href="${showAllHref}">${fillLabel(L.showAllRows, { n: joinedTotal })}</a>`;
  let viewNote = "";
  if (transientView === "applied" && !hasRows) {
    // AC1's explicit empty state: NOT an empty table, NOT a dash wall — the page says why it is empty
    // and how to get the full list back.
    viewNote = html`<div class="info-banner" role="status">
      <p><strong>${L.emptyTitle}</strong> <code>board_default_view=transient-empty</code></p>
      <p>${fillLabel(L.emptyBody, { total: joinedTotal })}</p>
      <p>${allRowsHref}${L.emptyHint}</p>
    </div>`;
  } else if (transientView === "applied") {
    viewNote = html`<p class="meta list-nav" role="status">${fillLabel(L.defaultViewNote, { shown: totalRows, total: joinedTotal })}${allRowsHref}</p>`;
  } else if (transientView === "off-source-incomplete") {
    // The filter could NOT be applied: at least one transient source did not read. Say so, and show
    // everything — an unread source is not evidence of absence (硬规则 5).
    const why = (board.incompleteSources ?? []).join(" · ");
    viewNote = html`<div class="info-banner" role="status">
      <p><strong>${L.defaultFilterNotApplied}</strong> <code>board_default_view=unfiltered-source-incomplete</code></p>
      <p>${fillLabel(L.defaultFilterNotAppliedBody, { why: escapeHtml(why), total: joinedTotal })}</p>
    </div>`;
  } else if (transientView === "off-explicit-all") {
    viewNote = html`<p class="meta list-nav" role="status">${fillLabel(L.allRowsShown, { n: joinedTotal })}<a href="${buildBoardHref(statusFilter, labelFilters, null, pageSize, false)}">${L.onlyTransient}</a></p>`;
  }
  // An "applied" view whose filtered set is empty renders the note INSTEAD of an empty table (AC1 /
  // DoD: 「而非空表格/空横杠墙」); the legacy direct-caller path (transientView omitted) always renders
  // its table, so no existing single-purpose caller changes shape.
  const showTable = hasRows || transientView == null;
  const filterForm = html`<form method="GET" style="margin:0.5rem 0 0.75rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
    <input name="status" type="text" placeholder="status (e.g. done)" value="${escapeHtml(statusFilter || "")}" style="padding:0.4rem 0.6rem;border:1px solid var(--color-divider);border-radius:4px;font-size:0.9rem;min-width:120px">
    <input name="label" type="text" placeholder="label (e.g. gap)" value="${escapeHtml(labelFilters[0] || "")}" style="padding:0.4rem 0.6rem;border:1px solid var(--color-divider);border-radius:4px;font-size:0.9rem;min-width:120px">
    <button type="submit" style="padding:0.4rem 0.8rem">Filter</button>
    ${filterParts.length > 0 ? html`<a href="/board" style="margin-left:0.25rem">clear all</a>` : ""}
  </form>`;
  const pageSizeOptions = [20, 50, 100, 250];
  const pageSizeNav = html`<p class="meta">Page size:
    ${pageSizeOptions.map((sz) =>
      sz === pageSize
        ? html`<strong>${sz}</strong>`
        : html`<a href="${buildBoardHref(statusFilter, labelFilters, null, sz)}">${sz}</a>`
    ).join(" ")}
    ${pageSizeInvalid ? html`<span class="error-banner" role="alert" style="display:inline;margin-left:0.5rem">Invalid pageSize value ignored; showing default (${DEFAULT_PAGE_SIZE}).</span>` : ""}
  </p>`;
  const pageNav = totalPages > 1 ? html`
    <p class="meta">
      ${page > 1
        ? html`<a href="${buildBoardHref(statusFilter, labelFilters, page - 1, pageSize)}">&laquo; Previous</a>`
        : html`<span class="page-nav-disabled">&laquo; Previous</span>`}
      &nbsp; Page ${page} of ${totalPages} (${totalRows} rows) &nbsp;
      ${page < totalPages
        ? html`<a href="${buildBoardHref(statusFilter, labelFilters, page + 1, pageSize)}">Next &raquo;</a>`
        : html`<span class="page-nav-disabled">Next &raquo;</span>`}
    </p>` : html`<p class="meta">Page 1 of ${totalPages} (${totalRows} rows)</p>`;

  return html`<!doctype html>
    ${htmlLangTag(lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(L.metaDescription)}">${modernistStyles()}${pageStyles()}<title>${pageTitle("Board — three-source join", identity, lang)}</title></head>
    <body>${renderMobileChrome("board", "board", lang)}${renderSiteNav("board", lang)}<main id="main">
      <h1>${pageNameFor("Board", lang)} — ${L.h1Subtitle}</h1>
      <p class="meta">${intentNote} · ${execNote} · ${landingNote}</p>
      ${filterForm}
      ${filterNav}
      ${pageSizeNav}
      ${viewNote}
      ${showTable ? pageNav : ""}
      ${showTable ? tableWrap(html`<table>
        <tr><th>id</th><th>${L.colIntent}</th><th>${L.colExec}</th><th>${L.colLanding}</th></tr>
        ${rows}
      </table>`) : ""}
    </main></body></html>`;
}

// ══ gap-ac292-criterion-cold-miss-30s-ttl-always-expired: the /board SNAPSHOT ═══════════════════
// AC-292's criterion is a probe over the LIVE server (`curl --max-time 10` on /board), re-run once
// per goal-sweep — structurally further apart than every TTL on this page, and it does TWO fetches
// (en + zh) per run. Measured on the unmodified code at this repo's size (2274 tasks): the cold
// path cost 9.17 / 9.62 / 9.78 s against that fixed 10 s budget — i.e. it STRADDLES the budget, so
// the same correct implementation flips red/green per run. That is the ledger's intermittent
// `CAUSE=en-fetch-failed`, not a broken zh wiring (the other three arms passed 61 s later).
//
// The cost is per-request and SCALES WITH THE STORE, so neither "raise the 8 s timeout" nor "lengthen
// the 30 s TTL" can fix it (both were tried — see the task body's table; the consumer's interval is
// structurally > TTL, so a longer TTL never gets hit). The fix is the one AC-179 already landed for
// /dashboard's structurally identical defect: the build moves to a BACKGROUND TICK and the request
// path reads a SNAPSHOT — a synchronous Map lookup, zero readers, zero subprocesses, zero scans.
//
// What the request path used to pay, per request (measured on this worktree):
//   readBoardLanding        → spawns `node task-status-drift-check.ts --json`, a FULL scan: 6.46 s
//   readTaskStatusMapAtRef  → `git ls-tree` + `cat-file --batch` over EVERY task file:     1.41 s
//   client.taskList()       → a provider round-trip over every task file
//   readBoardExecution      → readLive over .workflow-events/                             0.04 s
// All four are snapshotted, so the request path does ZERO work whose cost grows with the store
// (AC3). The tick re-builds every BOARD_SNAPSHOT_REFRESH_MS, matching the 30 s freshness contract
// every other card on this page already had.
//
// A reader that fails is snapshotted AS a failure (its honest「读失败」/「读取超时」shape): the page
// keeps rendering the same four landing states it always did, and the transient default view keeps
// refusing to read an unreadable source as "nothing is in flight" (硬规则 3b/5).
//
// ⊢ DELIBERATE DEVIATION from the AC-179 正本, and why: the dashboard publishes an INTERIM snapshot
// between its cheap and its shell-out readers, to shrink the window right after `listen` where no
// snapshot exists yet. The board does NOT, because the interim's own required inputs are what make
// it useless here: the landing subprocess is started first but the cheap half still costs a provider
// round-trip (~1 s) plus the develop-ref scan (~1.4 s), so an interim can only appear ~2.5 s in —
// and an interim published EARLIER than that would carry an EMPTY task list, rendering a board with
// no rows, which is 硬规则 5's cardinal sin (「无法判定」 painted as 「没有」). The un-snapshotted
// window is therefore the first build only (one ~7 s window per process start), during which the
// request path takes the legacy in-request build below — byte-for-byte today's behaviour, so that
// window is never WORSE than the pre-fix server. Every steady-state request, and every request
// while a refresh is in flight, reads the previous snapshot.
export const BOARD_SNAPSHOT_REFRESH_MS = 30_000;

/** Kill switch for the whole mechanism. Setting it to "1" makes BOTH the tick and the request-path
 *  lookup inert, so `/board` falls back to the legacy in-request build. That fallback is not
 *  dead code: it is also the unwired-state path during the first build after startup. */
export const BOARD_SNAPSHOT_DISABLED_ENV = "QUAY_BOARD_SNAPSHOT_DISABLED";

/** The provider's task row as the board consumes it. Kept structurally identical to what
 *  `client.taskList()` returns so the join below is unchanged. */
type BoardTaskRow = { id?: unknown; title?: unknown; status?: unknown; labels?: unknown };

/** Everything `/board` joins at one instant: the three sources (意图 / 执行 / 落地) plus the
 *  intent read's own degraded-state. Holding the VALUES (not a rendered page) keeps the render
 *  pure and lets `?status=/?label=/?page=` stay per-request without rebuilding. */
export interface BoardSnapshot {
  builtAt: number;
  landing: BoardLanding;
  execution: BoardExecution;
  /** Provider tasks, each status already overridden from the develop ref (see readBoardIntent). */
  tasks: BoardTaskRow[];
  intentStatus: "ok" | "error";
  intentReason: string | null;
}

const boardSnapshots = new Map<string, BoardSnapshot>();
const boardSnapshotRebuilds = new Map<string, Promise<void>>();

/** Test seam: an optional hook awaited BETWEEN the build's cooperative steps. Production never sets
 *  it. It lets a test hold a build open and observe what concurrent requests see WHILE it runs,
 *  rather than racing a fixture build that finishes in microseconds. */
let boardSnapshotStepHook: (() => Promise<void>) | null = null;
export function setBoardSnapshotStepHook(hook: (() => Promise<void>) | null): void {
  boardSnapshotStepHook = hook;
}

/** True when the snapshot mechanism is switched off. Read at CALL time, not at module load, so a
 *  test can flip it per test (mirrors `dashboardSnapshotDisabled`). */
export function boardSnapshotDisabled(): boolean {
  return process.env[BOARD_SNAPSHOT_DISABLED_ENV] === "1";
}

/** The snapshot for `root`, or null when none has been built yet. **Sync and non-building** — this
 *  is the request path's whole lookup, and it never awaits, so a request can never be made to wait
 *  for a rebuild. */
export function peekBoardSnapshot(root: string): BoardSnapshot | null {
  if (boardSnapshotDisabled()) return null;
  return boardSnapshots.get(root) ?? null;
}

/** Test-hygiene handle: drop every snapshot, in-flight build marker and step hook. */
export function clearBoardSnapshots(): void {
  boardSnapshots.clear();
  boardSnapshotRebuilds.clear();
  boardSnapshotStepHook = null;
}

/** True while a build for `root` is in flight — a direct reading of the mechanism's own state, not
 *  an inference from a timestamp. */
export function isBoardSnapshotRebuilding(root: string): boolean {
  return boardSnapshotRebuilds.has(root);
}

/** Await the build for `root`, if any (test seam — the request path never does this). */
export function awaitBoardSnapshotRebuild(root: string): Promise<void> {
  return boardSnapshotRebuilds.get(root) ?? Promise.resolve();
}

const EMPTY_LANDING: BoardLanding = { status: "error", timedOut: false, reason: "internal: board snapshot build failed before the landing read", flags: new Map(), scanned: 0 };
const EMPTY_EXECUTION: BoardExecution = { status: "error", reason: "internal: board snapshot build failed before the execution read", flags: new Map(), inFlight: [] };

/** The 意图 read: provider tasks with each status overridden from the develop ref
 *  (gap-web-task-status-reads-stale-main-checkout — the 意图 column's status face is the develop git
 *  ref, not the manager working branch's disk, which is a stale agent-proxy per 硬规则 4b; a task
 *  absent from develop keeps its disk status). Returns the degraded shape instead of throwing, so a
 *  failed intent read is snapshotted AS a failed read — never as an empty store (硬规则 3b). */
async function readBoardIntent(
  root: string,
  client: ProviderClient,
): Promise<{ tasks: BoardTaskRow[]; intentStatus: "ok" | "error"; intentReason: string | null }> {
  try {
    const r = await client.taskList({ includeBody: false });
    let tasks: BoardTaskRow[] = r.tasks ?? [];
    const devStatus = readTaskStatusMapAtRef(root, "develop");
    if (devStatus.size > 0) {
      tasks = tasks.map((t) => {
        const id = typeof t.id === "string" ? t.id : "";
        const atRef = id ? devStatus.get(id) : undefined;
        return atRef != null ? { ...t, status: atRef } : t;
      });
    }
    return { tasks, intentStatus: "ok", intentReason: null };
  } catch (err) {
    return { tasks: [], intentStatus: "error", intentReason: err instanceof Error ? err.message : String(err) };
  }
}

/** Build one snapshot. Cooperative by construction: the landing SUBPROCESS is started first so it
 *  runs in the OS while the two blocking steps below each get their OWN macrotask (a single
 *  blocking build would stall every concurrent request — `/health` included). Never throws: a
 *  failing reader yields the same honest degraded shape the request path already used. */
export async function buildBoardSnapshot(root: string, client: ProviderClient): Promise<BoardSnapshot> {
  // Long poles first. The landing read is an async subprocess (6.46 s measured) and the provider
  // round-trip is async too, so neither blocks the loop while the sync steps below yield.
  const landingPromise = readBoardLanding(root).catch(() => EMPTY_LANDING);
  const intentPromise = readBoardIntent(root, client);

  // Blocking step #1 — `readLive` over .workflow-events/.
  await yieldToEventLoop();
  if (boardSnapshotStepHook) await boardSnapshotStepHook();
  let execution: BoardExecution;
  try { execution = await readBoardExecution(root); } catch { execution = EMPTY_EXECUTION; }

  const [landing, intent] = await Promise.all([landingPromise, intentPromise]);
  return { builtAt: Date.now(), landing, execution, tasks: intent.tasks, intentStatus: intent.intentStatus, intentReason: intent.intentReason };
}

/** Start the background rebuild tick for `root`. Runs one build immediately (the cold build lives
 *  HERE, after `listen`, not in a request — the same shape as the dashboard's and the develop-ref
 *  ticks), then re-builds every `intervalMs`. The interval is unref'd so it never keeps the process
 *  alive.
 *
 *  Rebuilds never stack: while one is in flight the periodic tick is SKIPPED, so a slow store cannot
 *  queue up work that all lands at once. A FAILED rebuild keeps the previous snapshot rather than
 *  blanking the page — a stale board is honest, an empty one would be a fabricated absence. */
export function startBoardSnapshotRefresh(
  root: string,
  client: ProviderClient,
  { intervalMs = BOARD_SNAPSHOT_REFRESH_MS }: { intervalMs?: number } = {},
): { stop: () => void; rebuildNow: () => Promise<void> } {
  if (boardSnapshotDisabled()) return { stop: () => {}, rebuildNow: () => Promise.resolve() };
  // Only ever called when nothing is in flight for `root` (its own `finally` keeps a stale build
  // from deleting a newer build's marker).
  const start = (): Promise<void> => {
    const p = buildBoardSnapshot(root, client)
      .then((snap) => { boardSnapshots.set(root, snap); })
      .catch(() => { /* keep the previous snapshot — see the contract above */ })
      .finally(() => { if (boardSnapshotRebuilds.get(root) === p) boardSnapshotRebuilds.delete(root); });
    boardSnapshotRebuilds.set(root, p);
    return p;
  };
  const tick = (): Promise<void> => {
    const inFlight = boardSnapshotRebuilds.get(root);
    return inFlight ?? start();
  };
  /** Explicit caller: wait out any incumbent FIRST, so the build this returns post-dates the call.
   *  (The tick's "skip" policy would return a build that started before the caller's change and is
   *  therefore structurally incapable of reflecting it.) */
  const rebuildNow = async (): Promise<void> => {
    const inFlight = boardSnapshotRebuilds.get(root);
    if (inFlight) await inFlight;
    return start();
  };
  const handle = setInterval(() => { void tick(); }, intervalMs);
  // unref'd — the tick must never be the reason the process stays alive.
  if (typeof handle.unref === "function") handle.unref();
  void start();
  return { stop: () => clearInterval(handle), rebuildNow };
}

/** The request path's join + filter + paginate + render, PURE and SYNCHRONOUS: every input is
 *  already in the snapshot, so nothing here waits on I/O. Split out so the snapshot path and the
 *  legacy fallback below render through ONE implementation (a second copy would be a second
 *  behaviour). */
function renderBoardResponse(res: ServerResponse, snap: BoardSnapshot, url: URL, cfg: ServePageCfg): void {
  const { landing, execution, tasks, intentStatus, intentReason } = snap;

  // Union of provider tasks + landing-flagged taskIds, so every drift-flagged task renders a row
  // even if the provider's view diverges (the Contract's invariant: the scanned set must match).
  const byId = new Map<string, { title: string; status: string; labels: string[] }>();
  for (const t of tasks) {
    if (typeof t.id === "string" && t.id.length > 0) {
      byId.set(t.id, {
        title: typeof t.title === "string" ? t.title : "",
        status: typeof t.status === "string" ? t.status : "",
        labels: Array.isArray(t.labels) ? (t.labels as unknown[]).filter((l): l is string => typeof l === "string") : [],
      });
    }
  }
  // The transient sources join too, for the same reason: a run that is in flight (or an orphan
  // flagged by the execution read) MUST have a row to render — otherwise the default view, whose
  // whole purpose is to show those rows, would drop exactly them when the intent read diverges.
  for (const taskId of landing.flags.keys()) {
    if (!byId.has(taskId)) byId.set(taskId, { title: "", status: "", labels: [] });
  }
  for (const taskId of execution.flags.keys()) {
    if (!byId.has(taskId)) byId.set(taskId, { title: "", status: "", labels: [] });
  }
  for (const t of execution.inFlight) {
    if (!byId.has(t.taskId)) byId.set(t.taskId, { title: "", status: "", labels: [] });
  }

  const rows = [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, meta]) => {
    const landingFlag = landing.flags.get(id) ?? null;
    const execFlags = [...(execution.flags.get(id) ?? [])];
    const inFlight = execution.inFlight.find((t) => t.taskId === id);
    return {
      id,
      title: meta.title,
      status: meta.status,
      labels: meta.labels,
      landingFlag,
      execFlags,
      inFlightMinutes: inFlight ? inFlight.minutes : null,
      awaitingLand: inFlight ? inFlight.implCompletedAtMs != null : false,
    };
  });

  // gap-webui-board-no-pagination: server-side status/label filtering + pagination, applied to
  // the JOINED board view (provider tasks ∪ drift-flagged ids). Filter semantics mirror the
  // /tasks handler: ?status= is exact match, ?label= (repeated) is AND-logic over all labels.
  // Pagination mirrors QW-007: ?page=N (1-based, default 1), ?pageSize=N (default DEFAULT_PAGE_SIZE);
  // invalid values silently fall back to defaults. Everything below is server-side — no client JS.
  const statusFilter = url.searchParams.get("status");
  const labelFilters = url.searchParams.getAll("label").filter(Boolean);
  const explicitFilter = Boolean(statusFilter) || labelFilters.length > 0;
  const filteredRows = explicitFilter
    ? rows.filter((r) =>
        (!statusFilter || r.status === statusFilter) &&
        (labelFilters.length === 0 || labelFilters.every((l) => r.labels.includes(l)))
      )
    : rows;

  // gap-webui-board-transient-columns-drowned-by-history: the DEFAULT view shows only rows with a
  // live transient signal — but ONLY when both transient sources actually read. An absent/unreadable
  // source gets its own view state ("off-source-incomplete") instead of being silently read as
  // 「nothing is in flight」 (硬规则 3b/5: never render 「无法判定」 as a confident 「没有」).
  const allParam = (url.searchParams.get("all") ?? "").trim().toLowerCase();
  const showAll = allParam === "1" || allParam === "true" || allParam === "yes";
  // The names are this page's body copy, so they come from the board dictionary (ROW 11) resolved
  // for `cfg.lang` — NOT from the render function's roster, which is why they are read here through
  // `boardLabel` by key. A source's own STATE is preserved per source: 「no data」 and 「read failed」
  // are different facts and must not collapse into a generic 「a source failed」.
  const incompleteSources: string[] = [];
  if (execution.status !== "ok") {
    incompleteSources.push(boardLabel(execution.status === "empty" ? "srcExecEmpty" : "srcExecFailed", cfg.lang));
  }
  if (landing.status !== "ok") {
    incompleteSources.push(boardLabel(
      landing.timedOut === true
        ? "srcLandingTimeout"
        : landing.status === "empty"
          ? "srcLandingUnavailable"
          : "srcLandingFailed",
      cfg.lang,
    ));
  }
  // An explicit status/label filter is the user asking for a NAMED set — the transient default must
  // not narrow it further (AC2: the manual filters stay, and they are one of the two ways back to
  // the full store; ?all=1 is the other). No note renders for that path: the filter chip + row count
  // already say what is on screen.
  const transientView: BoardTransientView | undefined = explicitFilter
    ? undefined
    : showAll
      ? "off-explicit-all"
      : incompleteSources.length === 0
        ? "applied"
        : "off-source-incomplete";
  const visibleRows = transientView === "applied" ? filteredRows.filter(isTransientRow) : filteredRows;
  const pageSizeParam = parseInt(url.searchParams.get("pageSize") || "", 10);
  const pageSizeInvalid = url.searchParams.has("pageSize") &&
    (!Number.isFinite(pageSizeParam) || pageSizeParam < 1);
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam >= 1
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;
  const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const totalRows = visibleRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = visibleRows.slice(offset, offset + pageSize);

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderBoardPage({
    landing, execution, intentStatus, intentReason,
    rows: pageRows,
    page: safePage,
    totalPages,
    totalRows,
    statusFilter,
    labelFilters,
    pageSize,
    pageSizeInvalid,
    transientView,
    joinedTotal: rows.length,
    incompleteSources,
  }, cfg.identity, cfg.lang));
}

/** `/board`'s route handler. The request path is a synchronous snapshot lookup whose cost does NOT
 *  depend on the store's size or on when the last refresh ran (AC3) — the property the pre-fix
 *  version could not have, because its readers were TTL caches whose window the criterion's own
 *  consumption interval always outlived.
 *
 *  The legacy in-request build survives as TWO things, and both matter:
 *   - the unwired state (no snapshot yet — the first build after startup, one ~7 s window per
 *     process), and
 *   - `QUAY_BOARD_SNAPSHOT_DISABLED=1`, the negative control that makes the fast reading
 *     attributable to this mechanism rather than to the host.
 *  So it is neither dead code nor a race: it is the same `buildBoardSnapshot` the tick runs, which
 *  is why the two paths can never diverge. */
export async function handleBoard(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
  _manifest: Manifest,
  cfg: ServePageCfg,
): Promise<void> {
  const snapshot = peekBoardSnapshot(cfg.workspaceRoot);
  if (snapshot) {
    renderBoardResponse(res, snapshot, url, cfg);
    return;
  }
  renderBoardResponse(res, await buildBoardSnapshot(cfg.workspaceRoot, client), url, cfg);
}

// ── /git-history — vertical commit timeline (gap-git-history-vertical-graph-thirdparty-lib) ──
//
// Data access is quarantined in observation.readGitHistory (the ONLY serve-path module allowed to
// know git); this file renders. The page is NO LONGER server-rendered SVG: the 「零客户端 JS」
// invariant was RETIRED site-wide by human ruling (2026-08-23, 「引入第三方库。'零客户端 JS' 原则取消。」 —
// recorded in docs/webui-guide.md). The graph is a VERTICAL timeline — develop trunk + task branches
// forking from / merging back into the trunk — rendered client-side with the D3 library (d3.min.js,
// inlined the same way the Modernist CSS is). layoutGitGraph() is a PURE function (deterministic on
// its input) that computes the trunk + branch fork/merge structure; the client script only draws it.
//
// THE Y-AXIS IS COMMIT LANDING ORDER (%ct), NOT A DURATION. git branch lifespan ≠ task work hours
// (measured: 149/164 fan-in branches lived <1h — the task finished before its first commit landed),
// and real work hours live in telemetry with a ~6% join rate to git. The chart draws only what git
// proves: which commits landed, in what order, and where the merges are (diamonds = fan-in landings).

// AC102: the chart's marks are coloured by token-derived CSS classes (git-svg-*, defined in
// pageStyles()) — ZERO hardcoded hex in the rendering code (including the inlined client script);
// the hex values live only in the webui-modernist.css asset. Branch identity is carried by LANE
// POSITION + direct label, never by a cycled hue (dataviz skill).
