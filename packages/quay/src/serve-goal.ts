// serve-goal.ts — /goal + /goal/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import type { ServePageCfg } from "./serve-render.ts";
import { html, escapeHtml, shellStyles, renderMarkdown, renderSiteNav, renderMobileChrome, renderBackLink, relativeTime, tableWrap, pageTitle } from "./serve-render.ts";
import { readTaskSummary, isAcRollupCounted, type TaskSummary } from "./serve-dashboard.ts";

// ── /goal — the third sibling kind (goal store), now PROVIDER-BACKED
// (SPEC-goal-mechanism-2026-09-06.md §5.2): these routes read goals through the
// Provider ABI (`client.goalList` / `client.goalGet`), NOT the Core store directly
// (the store moved to quay-native). Same list/detail shape as /adr (SPEC §4: "照
// /adr 形状"). The goal page's most valuable column is the most recent verdict +
// time (SPEC §4: "最近 verdict 与时刻"), read from the record's `evidence` field.
// `evidence` is ledger-DERIVED, never stored (gap-goal-evidence-cache-should-not-enter-git):
// the provider's goal verbs surface the store's ledger-derived view-model (the LAST `gate:"goal"`
// event in `.quay/gate-events.jsonl`), so a fresh checkout with no ledger renders "—".

function goalEvidenceCell(ext: Record<string, unknown>): string {
  const ev = ext.evidence as { at?: string; verdict?: string; reading?: string } | undefined;
  if (!ev || typeof ev !== "object") return "—";
  const verdict = typeof ev.verdict === "string" ? ev.verdict : "";
  const at = typeof ev.at === "string" ? ev.at : "";
  if (!verdict && !at) return "—";
  // AC100: no hardcoded hex — the verdict colour classes are token-defined
  // (detailStyles()) and hex-defined for the legacy list pages (pageStyles()).
  const vColored = verdict === "pass"
    ? `<strong class="verdict-pass">pass</strong>`
    : `<strong class="verdict-fail">${escapeHtml(verdict || "unknown")}</strong>`;
  return html`${vColored}${at ? ` · ${escapeHtml(at)}` : ""}`;
}

// gap-webui-goal-detail-no-entity-links (提案 1): the /goal list and the detail page's criterion
// block share the SAME cell rendering (goalIdLink + goalEvidenceCell), never a second copy.
function goalIdLink(id: unknown): string {
  return html`<a href="/goal/${encodeURIComponent(String(id))}">${escapeHtml(String(id))}</a>`;
}

// ── M2/M4 list-page helpers (filter/sort/time/rollup), all in-memory over the ONE unfiltered read ──

/** Build a /goal query string, preserving status/kind/goal filters and adding sort/dir. */
function goalListHref(opts: { status?: string | null; kind?: string | null; goal?: string | null; sort?: string | null; dir?: string | null }): string {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.goal) params.set("goal", opts.goal);
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.dir) params.set("dir", opts.dir);
  const qs = params.toString();
  return qs ? `/goal?${qs}` : "/goal";
}

/** A ledger-derived time cell: relative time with the absolute timestamp on `title`. Absent/unparseable
 *  → "未记录" — a DISTINCT value from `—` (the recent-verdict cell's "no evidence"), never a timestamp
 *  (hard rule 6: missing = not-checked, not false). */
function timeCell(ts: unknown): string {
  if (typeof ts !== "string" || ts === "") return `<span class="not-recorded">未记录</span>`;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return `<span class="not-recorded">未记录</span>`;
  return `<span title="${escapeHtml(ts)}">${escapeHtml(relativeTime(ms))}</span>`;
}

/** Sortable column keys. Anything else → "" (fail-closed: an unknown ?sort= never reorders). */
function goalSortKey(g: Record<string, unknown>, col: string): string {
  switch (col) {
    case "id": return String(g.id ?? "");
    case "kind": return String(g.kind ?? "");
    case "status": return String(g.status ?? "");
    case "goal": return String(g.goal ?? "");
    case "title": return String(g.title ?? "");
    case "criterion": return String(g.criterion ?? "");
    case "verdict": return String((g.evidence as { verdict?: string } | undefined)?.verdict ?? "");
    case "lastProgressAt": return String(g.lastProgressAt ?? "");
    case "firstEvidenceAt": return String(g.firstEvidenceAt ?? "");
    default: return "";
  }
}

/** M2: sort in the handler (65 rows, negligible), never the Provider ABI. Missing values sink to the
 *  bottom in BOTH directions so "no value" never interleaves with real values (hard rule 3b). */
function sortGoalRows(rows: Record<string, unknown>[], sort: string | null, dir: string | null): Record<string, unknown>[] {
  const asc = dir !== "desc";
  return [...rows].sort((a, b) => {
    const ka = goalSortKey(a, sort ?? "");
    const kb = goalSortKey(b, sort ?? "");
    if (ka === "" || kb === "") return ka === "" ? (kb === "" ? 0 : 1) : -1;
    const cmp = ka.localeCompare(kb);
    return asc ? cmp : -cmp;
  });
}

// gap-webui-goal-list-tab-split-goal-ac: the merged view is gone — GOAL and AC are two different
// objects that no longer share one table, so their default orders split too. The Goals tab's
// highest-frequency query is "which goals are being worked on now", hence status priority (active
// first, then draft → achieved → superseded → retired, id asc within each group) instead of the old
// pure id-locale order. Unknown statuses sink to the bottom (fail-closed: never interleave with
// ranked states — hard rule 3b).
const GOAL_STATUS_ORDER = ["active", "draft", "achieved", "superseded", "retired"];

function goalStatusRank(s: unknown): number {
  const i = GOAL_STATUS_ORDER.indexOf(String(s));
  return i === -1 ? GOAL_STATUS_ORDER.length : i;
}

/** Goals-tab default order: status priority (active → draft → achieved → superseded → retired),
 *  then id asc within each group. */
function defaultSortGoalRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const ra = goalStatusRank(a.status);
    const rb = goalStatusRank(b.status);
    if (ra !== rb) return ra - rb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** Criteria-tab default order: group by `goal` (contiguous) with AC id DESC within each group —
 *  the SAME group-by-goal / AC-id-desc logic the merged view used, minus the now-impossible GOAL
 *  branch (this table only renders criteria). */
function defaultSortCriteriaRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const ga = String(a.goal ?? "");
    const gb = String(b.goal ?? "");
    if (ga !== gb) return ga.localeCompare(gb);
    return String(b.id).localeCompare(String(a.id)); // within a goal, AC id DESC
  });
}

// M1: the list table must fit inside <main> (AC1). Removing the whole-prose `origin` column alone
// did NOT do it — a long GOAL `title` (Chinese prose wraps per-char) and a long unbreakable
// `criterion` shell command still pushed the table to 1404px vs a 900px <main> and rows to 132px.
// `table-layout: fixed` + per-column widths makes the table exactly `main`'s width, and
// nowrap+ellipsis keeps every row single-line (the full title stays reachable via the `title` attr).
//
// gap-webui-goal-list-tab-split-goal-ac: the tab split lets each table carry ONLY its own columns,
// so every remaining header fits WITHOUT truncation (AC3: no `<th>` scrollWidth > clientWidth) and
// the semantic columns get a wider budget — title is the widest on both tabs (30% / 16%), up from
// the merged view's 18% (the pre-fix 336px-vs-156px title squeeze came from packing 11 columns).
// Goals tab (7 cols): id / status / title / AC 达成 / last progress / first evidence / 挂靠任务.
// Widths are sized so every `<th>` label fits WITHOUT ellipsis (AC3: no header scrollWidth >
// clientWidth, measured at 1440px = 868px table). `title` keeps the widest share (34%, up from the
// merged view's 18% / 156px) — the pre-fix 336px title truncated 180px; at ~295px it truncates ~41px
// (a ~77% reduction). The long time labels (last progress / first evidence) need ≥128px / ≥132px.
const GOAL_COL_WIDTHS = ["5%", "9%", "34%", "10%", "15%", "16%", "11%"];
// Criteria tab (8 cols): id / goal / status / title / criterion / recent verdict / last progress /
// 挂靠任务. Same header-fit discipline: `recent verdict` (the longest label) needs ≥135px; title
// keeps 24% (208px — still wider than the merged view's 156px) while the long labels keep their
// exact-required shares.
const CRITERIA_COL_WIDTHS = ["5%", "8%", "9%", "24%", "11%", "16%", "15%", "12%"];

function goalTableStyles(): string {
  return `<style>.goal-table{table-layout:fixed;width:100%}.goal-table th,.goal-table td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.goal-table th a{color:inherit}</style>`;
}

function goalCriterionRow(g: { id?: unknown; status?: unknown }, taskAttach: string): string {
  const ext = g as unknown as Record<string, unknown>;
  return html`<tr>
    <td>${goalIdLink(g.id)}</td>
    <td>${escapeHtml(String(g.status ?? ""))}</td>
    <td>${goalEvidenceCell(ext)}</td>
    <td>${timeCell(ext.lastProgressAt)}</td>
    <td>${timeCell(ext.firstEvidenceAt)}</td>
    <td class="task-attach">${escapeHtml(taskAttach)}</td>
  </tr>`;
}

// ── goal↔task rollup (gap-webui-goal-task-rollup-via-shared-summary-cache) ────────────────────
// A task's owning goal AC (`goal_ac`, task→AC linkage, G7) was structured-recorded but never consumed
// by any read surface. /goal now rolls it up — per-criterion task count + status distribution, and a
// goal-level sum over its criteria — reading the SAME 30s-TTL taskSummaryCache the dashboard uses
// (方案 A), so /goal and /dashboard share ONE `client.taskList({includeBody:false})` per TTL window.

/** The task-summary read as a THREE-STATE value (hard rule 6/3b): ok+tasks, or failed+reason. A
 *  failed read is never coerced to [] (that would render "未挂靠" for "没读到" — the exact
 *  conflation hard rule 3b forbids). */
export type GoalTaskRead =
  | { ok: true; tasks: TaskSummary[] }
  | { ok: false; error: string };

/** A task's owning goal AC id. Top-level `goal_ac` is canonical (native); the github provider
 *  surfaces it via `extra.goal_ac`, so fall back there. null = unset (缺值 = 未查, never ""). */
export function goalAcOf(t: TaskSummary): string | null {
  if (typeof t.goal_ac === "string" && t.goal_ac.length > 0) return t.goal_ac;
  const extra = (t as { extra?: unknown }).extra as Record<string, unknown> | undefined;
  const nested = extra?.goal_ac;
  return typeof nested === "string" && nested.length > 0 ? nested : null;
}

/** Render the task-attach cell text for the set of AC ids `acIds`. Three DISTINCT states (hard rule
 *  3b): a concrete count + status distribution ("N（done 2 · ready 1）"), "未挂靠" (read succeeded,
 *  zero tasks reference any of these ACs), or "未读到（reason）" (the read itself failed). */
export function renderTaskAttachText(read: GoalTaskRead, acIds: string[]): string {
  if (read.ok === false) return `未读到（${read.error}）`;
  const wanted = new Set(acIds);
  const attached = read.tasks.filter((t) => {
    const ac = goalAcOf(t);
    return ac !== null && wanted.has(ac);
  });
  if (attached.length === 0) return "未挂靠";
  const byStatus = new Map<string, number>();
  for (const t of attached) {
    const s = typeof t.status === "string" ? t.status : "unknown";
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const dist = [...byStatus.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([s, c]) => `${s} ${c}`)
    .join(" · ");
  return `${attached.length}（${dist}）`;
}

/** Wrap `readTaskSummary` (the dashboard cache accessor) in the three-state read. */
async function readGoalTasks(workspaceRoot: string, client: ProviderClient): Promise<GoalTaskRead> {
  try {
    const tasks = await readTaskSummary(workspaceRoot, client);
    return { ok: true, tasks };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Goals-tab table (7 cols): id / status / title / AC 达成 / last progress / first evidence /
 *  挂靠任务. The "AC 达成" and "挂靠任务" cells link to `/goal?kind=criterion&goal=<id>` (proposal 4:
 *  "先看 GOAL 概览、点进去看它的 AC 明细" without leaving the list page). */
function renderGoalsTable(
  rows: Record<string, unknown>[],
  all: Record<string, unknown>[],
  taskRead: GoalTaskRead,
  th: (col: string, label: string) => string,
): string {
  // AC rollup over the UNFILTERED array (renderGoalCard's own formula: acs = goal==gid, achieved =
  // status=="achieved") — so a goal with 0 criteria shows 0/0, never a hard-rule-6 "—".
  // gap-dashboard-goal-card-ac-denominator-includes-superseded-retired: the denominator drops the
  // 已退场 terminal states (`superseded`/`retired`) through the SAME `isAcRollupCounted` predicate the
  // dashboard goal card uses — this column is the same 「AC 达成」 number for the same goal, so fixing
  // only the card would leave this surface reporting 「6/10」 for GOAL-020 beside a card saying 「6/7」.
  // ⛔ one predicate, two callers — never a second, looser copy of the rule.
  const rollupFor = (gid: string): { achieved: number; total: number } => {
    const acs = all.filter((r) => String(r.goal ?? "") === gid && isAcRollupCounted(r.status));
    const achieved = acs.filter((r) => r.status === "achieved").length;
    return { achieved, total: acs.length };
  };
  // AC ids of ONE goal (the task-attach口径: a task hangs on an AC, never directly on the goal —
  // the same `goal == gid && id != gid` filter the detail page's criteria block uses).
  const criteriaIdsFor = (gid: string): string[] =>
    all.filter((r) => String(r.goal ?? "") === gid && String(r.id ?? "") !== gid).map((r) => String(r.id));
  const criteriaHref = (gid: string): string => `/goal?kind=criterion&goal=${encodeURIComponent(gid)}`;
  const body = rows.map((g) => {
    const gid = String(g.id ?? "");
    const rollup = rollupFor(gid);
    const taskAttach = renderTaskAttachText(taskRead, criteriaIdsFor(gid));
    return html`<tr>
      <td>${goalIdLink(g.id)}</td>
      <td>${escapeHtml(String(g.status ?? ""))}</td>
      <td title="${escapeHtml(String(g.title ?? ""))}">${escapeHtml(String(g.title ?? ""))}</td>
      <td class="ac-rollup"><a href="${criteriaHref(gid)}">${rollup.achieved}/${rollup.total}</a></td>
      <td>${timeCell(g.lastProgressAt)}</td>
      <td>${timeCell(g.firstEvidenceAt)}</td>
      <td class="task-attach"><a href="${criteriaHref(gid)}">${escapeHtml(taskAttach)}</a></td>
    </tr>`;
  }).join("\n");
  return html`<table class="goal-table">
    <colgroup>${GOAL_COL_WIDTHS.map((w) => html`<col style="width:${w}">`).join("")}</colgroup>
    <tr>${th("id", "id")}${th("status", "status")}${th("title", "title")}<th>AC 达成</th>${th("lastProgressAt", "last progress")}${th("firstEvidenceAt", "first evidence")}<th>挂靠任务</th></tr>
    ${body}
  </table>`;
}

/** Criteria-tab table (8 cols): id / goal / status / title / criterion / recent verdict /
 *  last progress / 挂靠任务. The `goal` cell is the NEW clickable entry point to the store's
 *  long-supported `?goal=` filter (proposal 3 / AC4): `/goal?kind=criterion&goal=<id>`. */
function renderCriteriaTable(
  rows: Record<string, unknown>[],
  taskRead: GoalTaskRead,
  th: (col: string, label: string) => string,
): string {
  const body = rows.map((g) => {
    const goal = String(g.goal ?? "");
    const gid = String(g.id ?? "");
    const criterion = typeof g.criterion === "string" ? g.criterion : "";
    const criterionCell = criterion.length > 60 ? `${escapeHtml(criterion.slice(0, 60))}…` : escapeHtml(criterion);
    const taskAttach = renderTaskAttachText(taskRead, [gid]);
    return html`<tr>
      <td>${goalIdLink(g.id)}</td>
      <td>${goal ? html`<a href="/goal?kind=criterion&goal=${encodeURIComponent(goal)}">${escapeHtml(goal)}</a>` : "—"}</td>
      <td>${escapeHtml(String(g.status ?? ""))}</td>
      <td title="${escapeHtml(String(g.title ?? ""))}">${escapeHtml(String(g.title ?? ""))}</td>
      <td><code>${criterionCell || "—"}</code></td>
      <td>${goalEvidenceCell(g)}</td>
      <td>${timeCell(g.lastProgressAt)}</td>
      <td class="task-attach">${escapeHtml(taskAttach)}</td>
    </tr>`;
  }).join("\n");
  return html`<table class="goal-table">
    <colgroup>${CRITERIA_COL_WIDTHS.map((w) => html`<col style="width:${w}">`).join("")}</colgroup>
    <tr>${th("id", "id")}${th("goal", "goal")}${th("status", "status")}${th("title", "title")}${th("criterion", "criterion")}${th("verdict", "recent verdict")}${th("lastProgressAt", "last progress")}<th>挂靠任务</th></tr>
    ${body}
  </table>`;
}

export async function handleGoalList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
  cfg: ServePageCfg | string,
): Promise<void> {
  // Two call shapes reach this handler, and BOTH must keep working. Production arrives through the
  // route dispatcher, which passes the full ServePageCfg (workspace root + resolved identity).
  // Direct unit tests written before the identity work pass the bare workspace root as a string, or
  // omit the argument entirely — and the omitted shape was TOLERATED by the previous signature (a
  // missing 5th argument simply read `undefined`, which `readTaskSummary`'s cache key accepts).
  // Reading `cfg.workspaceRoot` unconditionally turns that tolerated shape into a TypeError, so the
  // normalisation lives here, at the one boundary. Neither legacy shape carries an identity, and an
  // identity-less cfg renders through `pageTitle` as the explicit 「未接入项目身份」 label — never as
  // the anonymous pre-task title (硬规则 3b: "not read" must not look like "read, and fine").
  const pageCfg: ServePageCfg | undefined = typeof cfg === "string" ? { workspaceRoot: cfg } : cfg;
  const workspaceRoot = pageCfg?.workspaceRoot;
  const statusFilter = url.searchParams.get("status");
  const kindFilter = url.searchParams.get("kind");
  const goalFilter = url.searchParams.get("goal");
  const sortParam = url.searchParams.get("sort");
  const dirParam = url.searchParams.get("dir");

  let all: Record<string, unknown>[] = [];
  let readError: string | null = null;
  // M4: ONE unfiltered read. list() reads every file then filters in memory anyway (a filtered call
  // is exactly as expensive as an unfiltered one), so the status/kind/goal filters, the draft counts,
  // AND the AC rollup are ALL derived in memory from this single array — the tab split (proposal 5)
  // only changes the RENDER, never the query: both tabs share this one `client.goalList()`.
  try {
    all = (await client.goalList()) as unknown as Record<string, unknown>[];
  } catch (err) {
    all = [];
    readError = err instanceof Error ? err.message : String(err);
  }

  // goal↔task rollup: reuse the dashboard's shared 30s-TTL taskSummaryCache (方案 A — same window,
  // same taskList, never a second Map). The read is three-state (ok / failed), never a silent [].
  const taskRead = await readGoalTasks(workspaceRoot, client);

  // draft = 唯一「等着人裁定」的态（SPEC-goal-mechanism 裁定 3：draft→active 保留给人）。
  // 它必须【在任何筛选下都可见】——否则提案写了也没人看得见。故从【未筛选】的全集计数，且
  // 拆成两个量（proposal 4）：每个 tab 显示自己那类，另一类有待裁定时跨 tab 加一行提示。
  const draftGoalCount = all.filter((g) => g.status === "draft" && g.kind === "goal").length;
  const draftAcCount = all.filter((g) => g.status === "draft" && g.kind === "criterion").length;

  // Tab routing (proposal 1): reuse the existing `kind` param — no new `tab=` param (single source
  // of truth). `/goal` (no kind) and `?kind=goal` both land on the Goals tab; `?kind=criterion`
  // lands on the Criteria tab. The "All" merged view is gone.
  const tab = kindFilter === "criterion" ? "criterion" : "goal";

  // In-memory filters: rows of the ACTIVE tab only, then status/goal (M3: `goal` is honored).
  let rows = all.filter((g) => String(g.kind ?? "") === tab);
  if (statusFilter) rows = rows.filter((g) => g.status === statusFilter);
  if (goalFilter) rows = rows.filter((g) => String(g.goal) === goalFilter);

  // M2: sort in the handler. ?sort is whitelisted; absent → the tab's own default order.
  rows = sortParam
    ? sortGoalRows(rows, sortParam, dirParam)
    : tab === "goal" ? defaultSortGoalRows(rows) : defaultSortCriteriaRows(rows);

  const statusNav = [
    !statusFilter ? html`<strong>All</strong>` : html`<a href="${goalListHref({ kind: kindFilter, goal: goalFilter })}">All</a>`,
    // draft 排在最前：它是唯一需要人动作的态（此前该筛选项缺失 ⇒ ?status=draft 有记录
    // 但页面上没有任何入口能到达它）。
    ...["draft", "active", "achieved", "superseded", "retired"].map((s) =>
      s === statusFilter
        ? html`<strong>${s}</strong>`
        : html`<a href="${goalListHref({ status: s, kind: kindFilter, goal: goalFilter })}">${s}</a>`
    ),
  ].join(" · ");
  // Tab nav (proposal 1): two pure server-rendered links (no client JS), reusing the kindNav styling
  // discipline. Goals = `/goal` (no kind, the default tab); Criteria = `/goal?kind=criterion`.
  const tabNav = html`${tab === "goal"
    ? `<strong>Goals</strong>`
    : `<a href="${goalListHref({ status: statusFilter, goal: goalFilter })}">Goals</a>`} · ${tab === "criterion"
      ? `<strong>Criteria</strong>`
      : `<a href="${goalListHref({ kind: "criterion", status: statusFilter, goal: goalFilter })}">Criteria</a>`}`;
  // Sortable column headers (M2): each is a link that toggles asc↔desc, preserving all filters.
  const th = (col: string, label: string): string => {
    const active = sortParam === col;
    const nextDir = active && dirParam !== "desc" ? "desc" : "asc";
    const arrow = active ? (dirParam === "desc" ? " ↓" : " ↑") : "";
    return html`<th><a href="${goalListHref({ status: statusFilter, kind: kindFilter, goal: goalFilter, sort: col, dir: nextDir })}">${label}${arrow}</a></th>`;
  };

  // Draft banner (proposal 4 / AC5): the current tab's own drafts + a cross-tab hint when the OTHER
  // tab has drafts. Both counts came from the one unfiltered read above — never a second query.
  const ownDraft = tab === "goal" ? draftGoalCount : draftAcCount;
  const otherDraft = tab === "goal" ? draftAcCount : draftGoalCount;
  const ownLabel = tab === "goal" ? "GOAL" : "AC";
  const otherLabel = tab === "goal" ? "AC" : "GOAL";
  const otherHref = tab === "goal"
    ? goalListHref({ kind: "criterion", status: "draft" })
    : goalListHref({ status: "draft" });
  const otherTabLabel = tab === "goal" ? "Criteria" : "Goals";

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shellStyles()}${goalTableStyles()}<title>${pageTitle("Goals", pageCfg?.identity)}</title></head>
    <body>${renderMobileChrome("goal", "goals")}${renderSiteNav("goal")}<main id="main">
      <h1>Goals — ${tab === "goal" ? "阶段目标" : "AC / criterion"} (${rows.length})</h1>
      ${readError ? html`<div class="error-banner" role="alert"><strong>读失败:</strong> ${escapeHtml(readError)}</div>` : ""}
      ${statusFilter !== "draft" && (ownDraft > 0 || otherDraft > 0)
        ? html`<div class="info-banner" role="status">
            ${ownDraft > 0 ? html`<p><strong>${String(ownDraft)} 条 ${ownLabel} 待裁定</strong> — draft 记录不会自己生效：
            激活是人的动作（<code>goal-store.ts write &lt;id&gt; --status active</code>），
            不激活就一直是提案。<a href="${goalListHref({ status: "draft", kind: kindFilter, goal: goalFilter })}">查看待裁定</a></p>` : ""}
            ${otherDraft > 0 ? html`<p><strong>另有 ${String(otherDraft)} 条 ${otherLabel} 待裁定</strong> → <a href="${otherHref}">去 ${otherTabLabel} tab 查看</a></p>` : ""}
          </div>`
        : ""}
      <p class="meta">Tab: ${tabNav}</p>
      <p class="meta">Status: ${statusNav}</p>
      ${rows.length === 0
        ? (readError
            ? "" /* 读失败：上方 error-banner 已传达，空态不得再叠加误导性的「目录为空」（live 空态同纪律） */
            : html`<div class="info-banner" role="status">
                <p><strong>${statusFilter || goalFilter ? "当前筛选下无记录" : "goals/ 目录为空"}</strong> — 本页是 goal-store 的机读视图，<code>goals/</code> 即正本。</p>
                <p class="meta">（此处原先指向 <code>orchestration/manager-phase-goal.md</code>，该文件已随 G3 降级为归档，不再是正本——指针已修正。）</p>
              </div>`)
        : tableWrap(tab === "goal"
          ? renderGoalsTable(rows, all, taskRead, th)
          : renderCriteriaTable(rows, taskRead, th))}
    </main></body></html>`);
}

export async function handleGoalDetail(
  req: IncomingMessage,
  res: ServerResponse,
  goalId: string,
  client: ProviderClient,
  workspaceRoot: string,
): Promise<void> {
  // 「换」不是「加」（提案 1 / AC6）：一次 `goalList()` 取代 `goalGet()`。list() 的实现是
  // 先 readdir 读全部文件再内存 filter（带不带筛选一样贵），而 goalGet 与 goalList 各自都要
  // 解析一遍 6.87MB 的 .quay/gate-events.jsonl —— 一次调用 = 一次账本解析，既挑出本记录又
  // filter 出它的全部 AC。若做成 goalGet + goalList 就白白多付一次 0.2s + 多解析一遍账本。
  let all;
  try {
    all = await client.goalList();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("goal list failed");
    return;
  }
  const g = all.find((r) => String(r.id) === goalId);
  if (!g) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const isGoal = String(g.id).startsWith("GOAL-");
  // 反向边不存在于存储中（AC 单向持 goal 字段、GOAL 无 children）——必须靠扫描算出来（提案根因）。
  const criteria = isGoal ? all.filter((r) => String(r.goal) === goalId && String(r.id) !== goalId) : [];
  // goal↔task rollup: the SAME shared cache + the SAME口径 as the list page, so /goal/<id> and
  // /goal show byte-identical values for the same id (AC7).
  const taskRead = await readGoalTasks(workspaceRoot, client);
  const detailTaskAttach = renderTaskAttachText(taskRead, isGoal ? criteria.map((r) => String(r.id)) : [goalId]);
  // 正文实体编号回链（提案 2）：只回链真实存在的实体，不存在则保持纯文本（不造死链，AC3）。
  const idSet = new Set(all.map((r) => String(r.id)));
  const linkResolver = (raw: string): string | null => {
    // 正文常见无连字符形态 "AC156" → 规范化到存储里的 "AC-156"。
    const id = /^AC(\d+)$/.test(raw) ? `AC-${raw.slice(2)}` : raw;
    return idSet.has(id) ? `/goal/${encodeURIComponent(id)}` : null;
  };
  const ext = g as unknown as Record<string, unknown>;
  const evidenceCell = goalEvidenceCell(ext);
  // M1: the ledger-derived time info — the SAME values the list page renders for this id (both come
  // from the single `client.goalList()` view-models, so title/absolute timestamps are byte-identical).
  const timeInfo = html`
    <p class="meta">最近进展: ${timeCell(ext.lastProgressAt)}</p>
    <p class="meta">首次证据: ${timeCell(ext.firstEvidenceAt)}</p>`;
  // M1: origin is a provenance citation (median 191 / max 2775 chars) — it must NOT sit inside a
  // `<p class="meta">` (which used to inflate a single meta line to 1138 chars on /goal/GOAL-008).
  const origin = typeof ext.origin === "string" ? (ext.origin as string).trim() : "";
  const originBlock = origin.length > 0
    ? html`<section class="origin-block"><h2>origin</h2><p>${escapeHtml(origin)}</p></section>`
    : "";
  const criteriaBlock = isGoal
    ? html`<section id="goal-criteria">
        <h2>本 goal 的 criterion (${criteria.length})</h2>
        ${criteria.length === 0
          ? html`<p class="meta">（暂无 criterion）</p>`
          : html`<table>
            <tr><th>id</th><th>status</th><th>recent verdict</th><th>last progress</th><th>first evidence</th><th>挂靠任务</th></tr>
            ${criteria.map((c) => goalCriterionRow(c, renderTaskAttachText(taskRead, [String(c.id)]))).join("\n")}
          </table>`}
      </section>`
    : "";
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}">${shellStyles("detail")}<title>${escapeHtml(String(g.id))}</title></head>
    <body class="detail-page">${renderMobileChrome("goal", String(g.id))}${renderSiteNav("goal")}<main id="main">
      ${renderBackLink("/goal")}
      <h1>${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}</h1>
      <p class="meta">kind: <strong>${escapeHtml(String(g.kind ?? ""))}</strong> · status: <strong>${escapeHtml(String(g.status ?? ""))}</strong>${g.goal ? html` · goal: ${idSet.has(String(g.goal)) ? html`<a href="/goal/${encodeURIComponent(String(g.goal))}">${escapeHtml(String(g.goal))}</a>` : escapeHtml(String(g.goal))}` : ""}</p>
      ${evidenceCell !== "—" ? html`<p class="meta">最近 verdict: ${evidenceCell}</p>` : ""}
      ${timeInfo}
      <p class="meta">挂靠任务: ${escapeHtml(detailTaskAttach)}</p>
      ${typeof ext.criterion === "string" && (ext.criterion as string).length > 0
        ? html`<p class="meta">criterion: <code>${escapeHtml(ext.criterion as string)}</code></p>` : ""}
      ${ext.expect ? html`<p class="meta">expect: ${escapeHtml(String(ext.expect))}</p>` : ""}
      ${originBlock}
      ${criteriaBlock}
      <article>${renderMarkdown(g.body || "", { headingOffset: 0, linkResolver })}</article>
    </main></body></html>`);
}
