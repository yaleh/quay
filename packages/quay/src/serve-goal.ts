// serve-goal.ts — /goal + /goal/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import type { ServePageCfg } from "./serve-render.ts";
import {
  html, escapeHtml, shellStyles, renderMarkdown, renderSiteNav, renderMobileChrome, renderBackLink, relativeTime, tableWrap, pageTitle,
  // AC-301 (gap-ac301-goal-page-zh-chrome-nav-current-and-own-title): the /goal LIST page consumes
  // the AC-288 mechanism (`htmlLangTag`) and the AC-289 dictionary (`pageNameFor`) through this one
  // import — `serve-render.ts` re-exports both, so the page never re-parses `?lang=`/the cookie (a
  // second parse is a second decision table, and it would also read a different request's inputs than
  // the one `Vary`/the cookie was declared for) and never re-derives a label.
  htmlLangTag, pageNameFor,
} from "./serve-render.ts";
import { readTaskSummary, isAcRollupCounted, type TaskSummary } from "./serve-dashboard.ts";
// gap-webui-goal-body-copy-en-zh: this page's BODY copy dictionary (serve-i18n.ts ROW 21). The
// roster is taken ONCE per render (`goalLabelsFor(lang)`) rather than re-read per call site; the
// interpolated rows are filled with `fillLabel`, which THROWS on a hole the caller did not supply
// (ROW 6 — a silently-unfilled template would render `{n}` to the reader and no "does the page carry
// the value it should" check would go red).
import { goalLabelsFor, fillLabel, type GoalKey } from "./serve-i18n.ts";

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
 *  → 「未记录」 — a DISTINCT value from `—` (the recent-verdict cell's "no evidence"), never a timestamp
 *  (hard rule 6: missing = not-checked, not false).
 *
 *  `L` is passed in rather than defaulted: every caller in this file already holds the per-request
 *  roster, and a defaulted language here would silently render the marker in the wrong language on a
 *  page whose other copy had switched (硬规则 3b — a silently-defaulted label is indistinguishable
 *  from a wired one). */
function timeCell(ts: unknown, L: Record<GoalKey, string>): string {
  if (typeof ts !== "string" || ts === "") return `<span class="not-recorded">${L.notRecorded}</span>`;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return `<span class="not-recorded">${L.notRecorded}</span>`;
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

// M1 (historical, now superseded): the list table must fit inside <main> (AC1). Removing the
// whole-prose `origin` column alone did NOT do it — a long GOAL `title` and a long unbreakable
// `criterion` shell command still pushed the table past a 900px <main>. The fix at the time was
// `table-layout: fixed` + a percentage `<colgroup>`; gap-webui-goal-list-tab-split-goal-ac then
// split the merged view into two tabs so each table carried only its own columns.
//
// gap-webui-goal-list-full-id-status-title-and-real-width-ac (2026-09-24) REVERSED that regime.
// ⛔ Why the old one could not be patched: `table-layout:fixed` applies the declared share to the
// DATA cells exactly as it does to the headers, and the shares that make the *labels* fit
// (`id` 5% ≈ 43px, `status` 9% ≈ 78px) are far below what the *values* need (`GOAL-020` ≈ 75px,
// `achieved`/`superseded` ≈ 80px). Production therefore rendered `G…` / `achi…` at 1440px while
// ~280px of gutter sat unused on either side, because `serve-render.ts`'s `main{max-width:900px}`
// capped the table at ≈868px. The old AC3 measured only `<th>` scrollWidth, so nothing ever went
// red — **a criterion that measures the header structurally cannot see a data-row truncation**.
//
// The new regime is auto layout + a wider (but still bounded) page, and it deliberately does ⛔ NOT
// re-state any percentage: percentages were the old mechanism's unit, and re-adding them would
// re-create the defect. The browser now distributes width by content; `/goal` alone lifts `main`
// to `min(1400px,96vw)` so a 1440px screen has room for the content-sized table; and a table that
// still exceeds its page is scrolled by `tableWrap()`'s `.table-wrap` rather than widening the page.
// `title` is the one prose column and gets two clamped lines (its full text, like every id cell's,
// stays on the `title` attribute — so even a clipped case is recoverable on hover).
function goalTableStyles(): string {
  return `<style>`
    // The page's own content width. This rule is emitted ONLY on /goal (`goalTableStyles()` is
    // concatenated into this page's <head>, AFTER `shellStyles()`), so every other page keeps
    // `pageStyles()`'s `main{max-width:900px}` — that equality is the AC's negative control, not an
    // accident: a rule that leaked into the base sheet would widen /tasks /board and be invisible
    // to a criterion that only reads /goal.
    + `main{max-width:min(1400px,96vw)}`
    + `.goal-table{table-layout:auto;width:100%}`
    + `.goal-table th{white-space:nowrap}`
    + `.goal-table td{vertical-align:top}`
    // nowrap and ⛔ NO `text-overflow:ellipsis`. These are SHORT values whose full text IS the
    // information: an ellipsized `GOAL-020` is not "slightly less precise", it is unreadable, and
    // the reader cannot tell `G…` for GOAL-020 from `G…` for GOAL-021 (硬规则 3b — a truncated id
    // and an absent id look the same). The rest stay single-line so a row is one visual line.
    + `.goal-table .c-id,.goal-table .c-status,.goal-table .c-goal,.goal-table .c-criterion,`
    + `.goal-table .c-verdict,.goal-table .c-time,.goal-table .ac-rollup,.goal-table .task-attach`
    + `{white-space:nowrap}`
    // title: two clamped lines instead of an ellipsized fragment. (Verified in headless Chrome:
    // `-webkit-line-clamp` on a table cell keeps the row's layout and clamps to exactly 2 lines.)
    + `.goal-table .c-title{white-space:normal;overflow:hidden;display:-webkit-box;`
    + `-webkit-line-clamp:2;-webkit-box-orient:vertical}`
    // ≤900px the viewport cannot hold the content-sized table, so `.table-wrap` scrolls it — and the
    // id column is pinned to the container's left edge, otherwise scrolling right loses the row's
    // identity. The `background` is load-bearing: a sticky cell must be opaque or the cells scrolling
    // underneath it show through.
    + `@media (max-width:900px){.goal-table .c-id{position:sticky;left:0;`
    + `background:var(--color-surface)}}`
    + `.goal-table th a{color:inherit}</style>`;
}

function goalCriterionRow(g: { id?: unknown; status?: unknown }, taskAttach: string, L: Record<GoalKey, string>): string {
  const ext = g as unknown as Record<string, unknown>;
  return html`<tr>
    <td>${goalIdLink(g.id)}</td>
    <td>${escapeHtml(String(g.status ?? ""))}</td>
    <td>${goalEvidenceCell(ext)}</td>
    <td>${timeCell(ext.lastProgressAt, L)}</td>
    <td>${timeCell(ext.firstEvidenceAt, L)}</td>
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
 *  3b): a concrete count + status distribution ("N（done 2 · ready 1）"), 「未挂靠」 (read succeeded,
 *  zero tasks reference any of these ACs), or 「未读到（reason）」 (the read itself failed).
 *
 *  ⚠️ `L` DEFAULTED, and that default is a deliberate two-sided choice. This function is EXPORTED and
 *  has a direct-import unit test, so a required third argument would break that caller — but the
 *  default is `DEFAULT_LANG`, i.e. the English roster, NOT the pre-change Chinese bytes. That is the
 *  point: a caller which forgets `L` renders the marker in the DEFAULT language, which is visible and
 *  wrong, rather than silently keeping Chinese on an English page. (The direct-import test was
 *  migrated to pass `lang: "zh"` explicitly — the ROW 5 ④ discipline.) */
export function renderTaskAttachText(
  read: GoalTaskRead,
  acIds: string[],
  L: Record<GoalKey, string> = goalLabelsFor(),
): string {
  if (read.ok === false) return fillLabel(L.attachReadFailed, { reason: read.error });
  const wanted = new Set(acIds);
  const attached = read.tasks.filter((t) => {
    const ac = goalAcOf(t);
    return ac !== null && wanted.has(ac);
  });
  if (attached.length === 0) return L.attachNotLinked;
  const byStatus = new Map<string, number>();
  for (const t of attached) {
    const s = typeof t.status === "string" ? t.status : "unknown";
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const dist = [...byStatus.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([s, c]) => `${s} ${c}`)
    .join(" · ");
  // The parens live INSIDE the `attachCount` row (full-width in zh) — see serve-i18n ROW 21's note.
  return fillLabel(L.attachCount, { n: attached.length, dist });
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
  L: Record<GoalKey, string>,
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
    const taskAttach = renderTaskAttachText(taskRead, criteriaIdsFor(gid), L);
    return html`<tr>
      <td class="c-id" title="${escapeHtml(gid)}">${goalIdLink(g.id)}</td>
      <td class="c-status">${escapeHtml(String(g.status ?? ""))}</td>
      <td class="c-title" title="${escapeHtml(String(g.title ?? ""))}">${escapeHtml(String(g.title ?? ""))}</td>
      <td class="ac-rollup"><a href="${criteriaHref(gid)}">${rollup.achieved}/${rollup.total}</a></td>
      <td class="c-time">${timeCell(g.lastProgressAt, L)}</td>
      <td class="c-time">${timeCell(g.firstEvidenceAt, L)}</td>
      <td class="task-attach"><a href="${criteriaHref(gid)}">${escapeHtml(taskAttach)}</a></td>
    </tr>`;
  }).join("\n");
  // ⛔ NO `<colgroup>`: the per-column percentage widths were the truncation mechanism (see
  // `goalTableStyles()` above). The header row keeps the same 7 columns in the same order.
  return html`<table class="goal-table">
    <tr>${th("id", "id")}${th("status", "status")}${th("title", "title")}<th>${L.colAcRollup}</th>${th("lastProgressAt", "last progress")}${th("firstEvidenceAt", "first evidence")}<th>${L.colAttachedTasks}</th></tr>
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
  L: Record<GoalKey, string>,
): string {
  const body = rows.map((g) => {
    const goal = String(g.goal ?? "");
    const gid = String(g.id ?? "");
    const criterion = typeof g.criterion === "string" ? g.criterion : "";
    const criterionCell = criterion.length > 60 ? `${escapeHtml(criterion.slice(0, 60))}…` : escapeHtml(criterion);
    const taskAttach = renderTaskAttachText(taskRead, [gid], L);
    return html`<tr>
      <td class="c-id" title="${escapeHtml(gid)}">${goalIdLink(g.id)}</td>
      <td class="c-goal">${goal ? html`<a href="/goal?kind=criterion&goal=${encodeURIComponent(goal)}">${escapeHtml(goal)}</a>` : "—"}</td>
      <td class="c-status">${escapeHtml(String(g.status ?? ""))}</td>
      <td class="c-title" title="${escapeHtml(String(g.title ?? ""))}">${escapeHtml(String(g.title ?? ""))}</td>
      <td class="c-criterion"><code>${criterionCell || "—"}</code></td>
      <td class="c-verdict">${goalEvidenceCell(g)}</td>
      <td class="c-time">${timeCell(g.lastProgressAt, L)}</td>
      <td class="task-attach">${escapeHtml(taskAttach)}</td>
    </tr>`;
  }).join("\n");
  // ⛔ NO `<colgroup>` — same reason as the Goals table above.
  return html`<table class="goal-table">
    <tr>${th("id", "id")}${th("goal", "goal")}${th("status", "status")}${th("title", "title")}${th("criterion", "criterion")}${th("verdict", "recent verdict")}${th("lastProgressAt", "last progress")}<th>${L.colAttachedTasks}</th></tr>
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
  // AC-301: the per-request language AC-288 resolved (`reqCfg.lang`, assembled in serve-handlers.ts)
  // rides on the SAME object as the workspace root, so the LIST page reads it off `pageCfg` rather
  // than re-parsing `?lang=`/the cookie. It stays `undefined` for the legacy call shapes above, and
  // every consumer below has a `DEFAULT_LANG` default parameter — so "no lang was passed" falls back
  // to the pre-AC-301 bytes BY CONSTRUCTION, not by remembering, and ⛔ no `?? "en"` fallback is
  // written here (that would make "not passed" and "passed en" the same value — 硬规则 3b).
  const lang = pageCfg?.lang;
  // AC-301 / ROW 21: the per-request BODY roster, taken ONCE here (the `dashboardLabelsFor` idiom)
  // and threaded down to every helper — never re-read per call site, and never defaulted at a call
  // site (a defaulted label renders the wrong language silently; 硬规则 3b).
  const L = goalLabelsFor(lang);
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
  // AC-301: the `Goals` tab label is this page's OWN chrome and goes through `pageNameFor` on BOTH
  // branches (the active `<strong>` and the inactive `<a>`) — they are the same token, and wiring
  // only the branch the criterion happens to read would leave the tab bar visibly half-English on
  // `?kind=criterion` under zh. The `Criteria` label is ⛔ deliberately NOT wired: the task's scope
  // is this page's two registered tokens, and `Criteria` would need a third `PAGE_LABELS` entry. It
  // is registered as NAMED RESIDUE in this file's AC-301 note below rather than silently counted as
  // bilingual.
  const tabNav = html`${tab === "goal"
    ? `<strong>${pageNameFor("Goals", lang)}</strong>`
    : `<a href="${goalListHref({ status: statusFilter, goal: goalFilter })}">${pageNameFor("Goals", lang)}</a>`} · ${tab === "criterion"
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
  // AC-301: this page's chrome sites take the per-request language resolved by AC-288 (`lang`, read
  // off `pageCfg` above) and the AC-289 dictionary. Each call site passes `lang` rather than
  // defaulting, so `undefined` still falls back to `DEFAULT_LANG` — the default-locale bytes are
  // unchanged by construction, not by remembering.
  //
  // ⚠️ TWO tokens for this page's OWN chrome, and they differ IN CASE, so they are two independent
  // lookups: `"Goals"` (the `pageTitle` token, the `<h1>`'s constant prefix, AND the tab-nav label —
  // three call sites, one entry, because they are byte-equal) and the LOWERCASE `"goals"` the mobile
  // header carries. `pageNameFor` is an EXACT-token lookup, so `"Goals"` does NOT serve `"goals"` —
  // registering only the capitalised key would leave the mobile header English while the <title>
  // switched, and the criterion's own arms (nav region + <title>) would stay green.
  //
  // ⚠️ The `<h1>` is a DYNAMIC string: `<token> — <subtitle> (<n>)`. Only its CONSTANT prefix goes
  // through the dictionary; the tab subtitle and the row count are interpolated raw. Registering a
  // finished string such as `"Goals — 阶段目标 (3)"` would go stale the moment a goal is added (and
  // would be a lookup that misses, i.e. an English `<h1>` under zh).
  //
  // ⛔ NAMED RESIDUE, deliberately out of scope and registered rather than silently counted as
  // bilingual:
  //  ① the `Criteria` tab label (the sibling of the `Goals` token wired just above) and the
  //     `otherTabLabel` banner link below — ⚠️ the latter renders ONLY when the OTHER tab has drafts
  //     (`statusFilter !== "draft" && otherDraft > 0`), so it is structurally unreachable on the
  //     default URL the goal criterion reads; wiring it would need a THIRD `PAGE_LABELS` entry,
  //     which this task's two-token scope does not grant;
  //  ② `handleGoalDetail` below (`/goal/<id>` — NOT one of `SITE_NAV_ROUTES`' 15 nav views, and its
  //     `<title>` is the bare entity id, which `pageTitle`'s contract says detail pages
  //     intentionally do not route) keeps its own hard-coded English html-lang attribute and its
  //     lang-less `renderMobileChrome`/`renderSiteNav`. GOAL-024's scope limits this task to the nav
  //     route; AC-301's AC5④ therefore reads 2→1, ⛔ not 2→0.
  //
  // ⚠️ gap-webui-goal-body-copy-en-zh (the BODY-copy task) TOUCHED NEITHER OF THESE, and ② is why its
  // AC3 (zh zero-change) holds: wiring ② would MOVE the `?lang=zh` bytes — the nav, the mobile menu
  // and the html-lang attribute would switch from the English the helper's default produces today to
  // Chinese. That is a zh-page IMPROVEMENT and belongs to a future detail-chrome task, not to a
  // task whose contract is "the zh rendering does not change". ✅ What that task DID change here:
  // the page's body copy (ROW 21) and — on the DETAIL page only — the shared `renderBackLink`, whose
  // `lang` argument it now passes. The back link's zh bytes are unchanged (`← 返回列表` both before
  // and after); only its EN bytes moved, which is the whole point. The other two callers of that
  // helper (/adr, /doc) were given their own `lang` in the same change, because a caller that omits
  // it silently renders EN on a `?lang=zh` page (硬规则 3b).
  // ⚠️ This comment deliberately SPELLS OUT no html-lang literal: AC-301's AC5④ counts the
  // occurrences of that literal in THIS FILE, and a mention inside a comment is not an occurrence
  // (hard rule 2 — judge by position, not by keyword). Writing it here would inflate the count and
  // make the residue look twice as large as it is.
  res.end(html`<!doctype html>
    ${htmlLangTag(lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shellStyles()}${goalTableStyles()}<title>${pageTitle("Goals", pageCfg?.identity, lang)}</title></head>
    <body>${renderMobileChrome("goal", pageNameFor("goals", lang), lang)}${renderSiteNav("goal", lang)}<main id="main">
      <h1>${pageNameFor("Goals", lang)} — ${tab === "goal" ? L.pageSubtitleGoal : L.pageSubtitleCriteria} (${rows.length})</h1>
      ${readError ? html`<div class="error-banner" role="alert"><strong>${L.listReadFailed}</strong> ${escapeHtml(readError)}</div>` : ""}
      ${statusFilter !== "draft" && (ownDraft > 0 || otherDraft > 0)
        ? html`<div class="info-banner" role="status">
            ${ownDraft > 0 ? html`<p><strong>${fillLabel(L.draftOwnBanner, { n: ownDraft, kind: ownLabel })}</strong>${fillLabel(L.draftExplain, { cmd: `<code>goal-store.ts write &lt;id&gt; --status active</code>` })}<a href="${goalListHref({ status: "draft", kind: kindFilter, goal: goalFilter })}">${L.viewDrafts}</a></p>` : ""}
            ${otherDraft > 0 ? html`<p><strong>${fillLabel(L.draftOtherBanner, { n: otherDraft, kind: otherLabel })}</strong> → <a href="${otherHref}">${fillLabel(L.draftOtherLink, { tab: otherTabLabel })}</a></p>` : ""}
          </div>`
        : ""}
      <p class="meta">Tab: ${tabNav}</p>
      <p class="meta">Status: ${statusNav}</p>
      ${rows.length === 0
        ? (readError
            ? "" /* 读失败：上方 error-banner 已传达，空态不得再叠加误导性的「目录为空」（live 空态同纪律） */
            : html`<div class="info-banner" role="status">
                <p><strong>${statusFilter || goalFilter ? L.emptyFiltered : L.emptyDir}</strong>${fillLabel(L.emptyExplain, { code: "<code>goals/</code>" })}</p>
                <p class="meta">${fillLabel(L.emptyPointerNote, { code: "<code>orchestration/manager-phase-goal.md</code>" })}</p>
              </div>`)
        : tableWrap(tab === "goal"
          ? renderGoalsTable(rows, all, taskRead, th, L)
          : renderCriteriaTable(rows, taskRead, th, L))}
    </main></body></html>`);
}

export async function handleGoalDetail(
  req: IncomingMessage,
  res: ServerResponse,
  goalId: string,
  client: ProviderClient,
  cfg: ServePageCfg | string,
): Promise<void> {
  // ⚠️ THE DETAIL PAGE TAKES THE SAME DUAL-SHAPE 5th ARGUMENT AS THE LIST HANDLER, for the same
  // reason: production's dispatcher passes the full `ServePageCfg` (workspace root + the per-request
  // language AC-288 resolved), while direct-import unit tests pass the bare workspace root as a
  // string — and one of them (`gap-webui-goal-detail-no-entity-links` AC6) omits the argument
  // entirely. Normalising at this ONE boundary keeps all three shapes working; reading
  // `cfg.workspaceRoot` unconditionally would turn the tolerated shape into a TypeError.
  const pageCfg: ServePageCfg | undefined = typeof cfg === "string" ? { workspaceRoot: cfg } : cfg;
  const workspaceRoot = pageCfg?.workspaceRoot;
  // The per-request BODY roster (ROW 21) — see the LIST handler above for why it is taken once.
  const lang = pageCfg?.lang;
  const L = goalLabelsFor(lang);
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
  const detailTaskAttach = renderTaskAttachText(taskRead, isGoal ? criteria.map((r) => String(r.id)) : [goalId], L);
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
    <p class="meta">${L.detailRecentProgress}${timeCell(ext.lastProgressAt, L)}</p>
    <p class="meta">${L.detailFirstEvidence}${timeCell(ext.firstEvidenceAt, L)}</p>`;
  // M1: origin is a provenance citation (median 191 / max 2775 chars) — it must NOT sit inside a
  // `<p class="meta">` (which used to inflate a single meta line to 1138 chars on /goal/GOAL-008).
  const origin = typeof ext.origin === "string" ? (ext.origin as string).trim() : "";
  const originBlock = origin.length > 0
    ? html`<section class="origin-block"><h2>origin</h2><p>${escapeHtml(origin)}</p></section>`
    : "";
  const criteriaBlock = isGoal
    ? html`<section id="goal-criteria">
        <h2>${fillLabel(L.detailCriteriaHeading, { n: criteria.length })}</h2>
        ${criteria.length === 0
          ? html`<p class="meta">${L.detailNoCriteria}</p>`
          : html`<table>
            <tr><th>id</th><th>status</th><th>recent verdict</th><th>last progress</th><th>first evidence</th><th>${L.colAttachedTasks}</th></tr>
            ${criteria.map((c) => goalCriterionRow(c, renderTaskAttachText(taskRead, [String(c.id)], L), L)).join("\n")}
          </table>`}
      </section>`
    : "";
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  // ⛔ NAMED RESIDUE, UNCHANGED BY THIS TASK (AC-301 registered it here first, and AC-300/AC-302
  // registered the identical residue on the two sibling detail pages): the detail page's CHROME — its
  // hard-coded English html-lang attribute and its lang-less `renderMobileChrome`/`renderSiteNav` —
  // is deliberately NOT wired to `lang`. Two reasons, and the second is the load-bearing one:
  //   ① GOAL-024's per-page scope was the 15 NAV routes; `/goal/<id>` is not one of them, and its
  //      `<title>` is the bare entity id, which `pageTitle`'s contract says detail pages do not route.
  //   ② Wiring it would MOVE the `?lang=zh` bytes (the nav would switch from the English labels the
  //      helper's default produces today to the Chinese ones) — and this task's AC3 requires the zh
  //      render to be unchanged, with the ONE exception of body copy that was Chinese-by-accident on
  //      an English page. A zh-page improvement is a different task's change, not this one's.
  // ⇒ Under `en` the detail page is fully English (chrome, back link, body copy). Under `zh` it is
  //   byte-identical to before except that nothing changed at all. Both are asserted in
  //   `serve-goal-body-i18n.test.mjs`.
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}">${shellStyles("detail")}<title>${escapeHtml(String(g.id))}</title></head>
    <body class="detail-page">${renderMobileChrome("goal", String(g.id))}${renderSiteNav("goal")}<main id="main">
      ${renderBackLink("/goal", lang)}
      <h1>${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}</h1>
      <p class="meta">kind: <strong>${escapeHtml(String(g.kind ?? ""))}</strong> · status: <strong>${escapeHtml(String(g.status ?? ""))}</strong>${g.goal ? html` · goal: ${idSet.has(String(g.goal)) ? html`<a href="/goal/${encodeURIComponent(String(g.goal))}">${escapeHtml(String(g.goal))}</a>` : escapeHtml(String(g.goal))}` : ""}</p>
      ${evidenceCell !== "—" ? html`<p class="meta">${L.detailRecentVerdict}${evidenceCell}</p>` : ""}
      ${timeInfo}
      <p class="meta">${L.detailAttachedTasks}${escapeHtml(detailTaskAttach)}</p>
      ${typeof ext.criterion === "string" && (ext.criterion as string).length > 0
        ? html`<p class="meta">criterion: <code>${escapeHtml(ext.criterion as string)}</code></p>` : ""}
      ${ext.expect ? html`<p class="meta">expect: ${escapeHtml(String(ext.expect))}</p>` : ""}
      ${originBlock}
      ${criteriaBlock}
      <article>${renderMarkdown(g.body || "", { headingOffset: 0, linkResolver })}</article>
    </main></body></html>`);
}
