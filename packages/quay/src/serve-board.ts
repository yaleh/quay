// serve-board.ts — /board route handler, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { readBoardLanding, readBoardExecution, readTaskStatusMapAtRef, type BoardLanding, type BoardExecution } from "./observation.ts";
import type { Manifest, ServePageCfg, ServeIdentity } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, DEFAULT_PAGE_SIZE, buildHref, renderSiteNav, renderMobileChrome, tableWrap, pageTitle } from "./serve-render.ts";

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
}, identity: ServeIdentity | null = null): string {
  const landingNote = board.landing.status === "ok"
    ? html`<span>落地: <code>task-status-drift-check.ts</code> · 扫描 ${board.landing.scanned} 任务</span>`
    : board.landing.status === "empty"
      ? html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>无数据</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
      : board.landing.timedOut
        // gap-webui-board-load-120s AC3 — fail-open: a subprocess that exceeded LANDING_TIMEOUT_MS
        // renders 「读取超时」 (distinct from a generic 读失败) instead of empty-waiting to the old
        // 120s hard cap.
        ? html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>读取超时</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
        : html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>读失败</strong> — ${escapeHtml(board.landing.reason || "")}</span>`;
  // gap-inflight-states-missing-impl-complete-event: the in-flight view splits into TWO independent
  // counts — implementing (start, no impl-complete: 真正在实现) vs awaiting-land (impl-complete, no
  // end: 排队待落地). Build dispatch reads the former; the land single-flight gate reads the latter.
  const implementingCount = board.execution.inFlight.filter((t) => t.implCompletedAtMs == null).length;
  const awaitingLandCount = board.execution.inFlight.length - implementingCount;
  const execNote = board.execution.status === "ok"
    ? html`<span>执行: <code>.workflow-events/</code> · ${implementingCount} 实现中 · ${awaitingLandCount} 待落地</span>`
    : board.execution.status === "empty"
      ? html`<span>执行: <code>.workflow-events/</code> · <strong>无数据</strong> — ${escapeHtml(board.execution.reason || "")}</span>`
      : html`<span>执行: <code>.workflow-events/</code> · <strong>读失败</strong> — ${escapeHtml(board.execution.reason || "")}</span>`;
  const intentNote = board.intentStatus === "ok"
    ? html`<span>意图: 任务库 (Provider ABI)</span>`
    : html`<span>意图: 任务库 (Provider ABI) · <strong>读失败</strong> — ${escapeHtml(board.intentReason || "")}</span>`;

  const rows = board.rows.map((r) => {
    const flagAttr = r.landingFlag ? ` data-flag="${escapeHtml(r.landingFlag)}"` : "";
    const execAttr = r.execFlags.length > 0 ? ` data-exec-flag="${escapeHtml(r.execFlags.join(","))}"` : "";
    const execCell = r.inFlightMinutes != null
      ? html`在飞 ${escapeHtml(r.inFlightMinutes.toFixed(1))} 分钟${r.awaitingLand ? html` · <strong>待落地</strong>` : ""}${r.execFlags.map((f) => html` · <strong>${f === "in-flight-timeout" ? "在飞超时" : "孤儿"}</strong>`).join("")}`
      : (r.execFlags.length > 0 ? r.execFlags.map((f) => html`<strong>${f === "in-flight-timeout" ? "在飞超时" : "孤儿"}</strong>`).join(" · ") : "—");
    const landingCell = r.landingFlag === "done-unlanded"
      ? html`<strong>done 但未落地</strong>`
      : r.landingFlag === "landed-not-closed"
        ? html`<strong>已落地但未收尾</strong>`
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
  const allRowsHref = html`<a href="${showAllHref}">显示全部 ${joinedTotal} 行（含历史任务）</a>`;
  let viewNote = "";
  if (transientView === "applied" && !hasRows) {
    // AC1's explicit empty state: NOT an empty table, NOT a dash wall — the page says why it is empty
    // and how to get the full list back.
    viewNote = html`<div class="info-banner" role="status">
      <p><strong>当前没有在飞 / 待落地的任务</strong> <code>board_default_view=transient-empty</code></p>
      <p>默认视图只显示「执行」或「落地」列非空的行 —— 全部 ${joinedTotal} 行里没有一行处于在飞 / 待落地 / 落地异常，故不铺开历史任务。</p>
      <p>${allRowsHref}，或用上方的 status / label 筛选查看指定子集。</p>
    </div>`;
  } else if (transientView === "applied") {
    viewNote = html`<p class="meta list-nav" role="status">默认视图：只显示「执行」或「落地」列非空的行 —— ${totalRows} 行（全部 ${joinedTotal} 行）。${allRowsHref}</p>`;
  } else if (transientView === "off-source-incomplete") {
    // The filter could NOT be applied: at least one transient source did not read. Say so, and show
    // everything — an unread source is not evidence of absence (硬规则 5).
    const why = (board.incompleteSources ?? []).join(" · ");
    viewNote = html`<div class="info-banner" role="status">
      <p><strong>默认过滤未生效</strong> <code>board_default_view=unfiltered-source-incomplete</code></p>
      <p>${escapeHtml(why)} 读不到（无数据 / 读失败 / 读取超时），无法判定哪些任务当前在飞或待落地 —— 因此下面显示全部 ${joinedTotal} 行，而不是把「无法判定」渲染成「没有」。</p>
    </div>`;
  } else if (transientView === "off-explicit-all") {
    viewNote = html`<p class="meta list-nav" role="status">已显示全部 ${joinedTotal} 行（含历史任务）。<a href="${buildBoardHref(statusFilter, labelFilters, null, pageSize, false)}">只看当前在飞 / 待落地</a></p>`;
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay board — 三源 join 看板">${modernistStyles()}${pageStyles()}<title>${pageTitle("Board — 三源 join 看板", identity)}</title></head>
    <body>${renderMobileChrome("board", "board")}${renderSiteNav("board")}<main id="main">
      <h1>Board — 意图 / 执行 / 落地</h1>
      <p class="meta">${intentNote} · ${execNote} · ${landingNote}</p>
      ${filterForm}
      ${filterNav}
      ${pageSizeNav}
      ${viewNote}
      ${showTable ? pageNav : ""}
      ${showTable ? tableWrap(html`<table>
        <tr><th>id</th><th>意图</th><th>执行</th><th>落地</th></tr>
        ${rows}
      </table>`) : ""}
    </main></body></html>`;
}

export async function handleBoard(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
  manifest: Manifest,
  cfg: ServePageCfg,
): Promise<void> {
  let landing: BoardLanding;
  try {
    landing = await readBoardLanding(cfg.workspaceRoot);
  } catch (err) {
    landing = { status: "error", timedOut: false, reason: `internal: ${err instanceof Error ? err.message : String(err)}`, flags: new Map(), scanned: 0 };
  }
  let execution: BoardExecution;
  try {
    execution = await readBoardExecution(cfg.workspaceRoot);
  } catch (err) {
    execution = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, flags: new Map(), inFlight: [] };
  }

  let tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown }> = [];
  let intentStatus: "ok" | "error" = "ok";
  let intentReason: string | null = null;
  try {
    const r = await client.taskList({ includeBody: false });
    tasks = r.tasks ?? [];
    // gap-web-task-status-reads-stale-main-checkout: the board's 意图 column status read face is
    // the develop git ref, not the manager working branch's disk (a stale agent-proxy — 硬规则 4b).
    // Override each task's status from develop; a task absent from develop keeps its disk status.
    const devStatus = readTaskStatusMapAtRef(cfg.workspaceRoot, "develop");
    if (devStatus.size > 0) {
      tasks = tasks.map((t) => {
        const id = typeof t.id === "string" ? t.id : "";
        const atRef = id ? devStatus.get(id) : undefined;
        return atRef != null ? { ...t, status: atRef } : t;
      });
    }
  } catch (err) {
    intentStatus = "error";
    intentReason = err instanceof Error ? err.message : String(err);
  }

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
  const incompleteSources: string[] = [];
  if (execution.status !== "ok") {
    incompleteSources.push(execution.status === "empty"
      ? "执行源（.workflow-events/）无数据"
      : "执行源（.workflow-events/）读失败");
  }
  if (landing.status !== "ok") {
    incompleteSources.push(landing.timedOut === true
      ? "落地源（task-status-drift-check.ts）读取超时"
      : landing.status === "empty"
        ? "落地源（task-status-drift-check.ts）不可用"
        : "落地源（task-status-drift-check.ts）读失败");
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
  }, cfg.identity));
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
