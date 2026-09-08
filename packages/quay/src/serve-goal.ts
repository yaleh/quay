// serve-goal.ts — /goal + /goal/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { html, escapeHtml, shellStyles, renderMarkdown, renderSiteNav, renderMobileChrome, renderBackLink, relativeTime, tableWrap } from "./serve-render.ts";

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

/** M2 default order: kind:goal on top (id asc), then criteria grouped by `goal` (contiguous) with
 *  AC id DESC within each group. */
function defaultSortGoalRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const isGoal = (g: Record<string, unknown>) => String(g.kind) === "goal";
  const goals = rows.filter(isGoal).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const criteria = rows.filter((g) => !isGoal(g)).sort((a, b) => {
    const ga = String(a.goal ?? "");
    const gb = String(b.goal ?? "");
    if (ga !== gb) return ga.localeCompare(gb);
    return String(b.id).localeCompare(String(a.id)); // within a goal, AC id DESC
  });
  return [...goals, ...criteria];
}

// M1: the list table must fit inside <main> (AC1). Removing the whole-prose `origin` column alone
// did NOT do it — a long GOAL `title` (Chinese prose wraps per-char) and a long unbreakable
// `criterion` shell command still pushed the table to 1404px vs a 900px <main> and rows to 132px.
// `table-layout: fixed` + per-column widths makes the table exactly `main`'s width, and
// nowrap+ellipsis keeps every row single-line (the full title stays reachable via the `title` attr).
const GOAL_COL_WIDTHS = ["10%", "7%", "9%", "8%", "24%", "14%", "8%", "7%", "7%", "6%"];

function goalTableStyles(): string {
  return `<style>.goal-table{table-layout:fixed;width:100%}.goal-table th,.goal-table td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.goal-table th a{color:inherit}</style>`;
}

function goalCriterionRow(g: { id?: unknown; status?: unknown }): string {
  const ext = g as unknown as Record<string, unknown>;
  return html`<tr>
    <td>${goalIdLink(g.id)}</td>
    <td>${escapeHtml(String(g.status ?? ""))}</td>
    <td>${goalEvidenceCell(ext)}</td>
    <td>${timeCell(ext.lastProgressAt)}</td>
    <td>${timeCell(ext.firstEvidenceAt)}</td>
  </tr>`;
}

export async function handleGoalList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
): Promise<void> {
  const statusFilter = url.searchParams.get("status");
  const kindFilter = url.searchParams.get("kind");
  const goalFilter = url.searchParams.get("goal");
  const sortParam = url.searchParams.get("sort");
  const dirParam = url.searchParams.get("dir");

  let all: Record<string, unknown>[] = [];
  let readError: string | null = null;
  // M4: ONE unfiltered read. list() reads every file then filters in memory anyway (a filtered call
  // is exactly as expensive as an unfiltered one), so the status/kind/goal filters, the draft count,
  // AND the AC rollup are ALL derived in memory from this single 65-record array — 2 calls → 1.
  try {
    all = (await client.goalList()) as unknown as Record<string, unknown>[];
  } catch (err) {
    all = [];
    readError = err instanceof Error ? err.message : String(err);
  }

  // draft = 唯一「等着人裁定」的态（SPEC-goal-mechanism 裁定 3：draft→active 保留给人）。
  // 它必须【在任何筛选下都可见】——否则提案写了也没人看得见。故从【未筛选】的全集计数。
  const draftCount = all.filter((g) => g.status === "draft").length;

  // In-memory filters (M3: `goal` reached the store but was dropped HERE — now honored).
  let goals = all;
  if (statusFilter) goals = goals.filter((g) => g.status === statusFilter);
  if (kindFilter) goals = goals.filter((g) => g.kind === kindFilter);
  if (goalFilter) goals = goals.filter((g) => String(g.goal) === goalFilter);

  // M2: sort in the handler. ?sort is whitelisted; absent → the goal-first default order.
  goals = sortParam ? sortGoalRows(goals, sortParam, dirParam) : defaultSortGoalRows(goals);

  // M4: AC rollup over the UNFILTERED array — so ?kind=goal does NOT collapse it to 0 (hard rule 3b).
  // The formula is renderGoalCard's own: acs = goal==gid, achieved = status=="achieved".
  const rollupFor = (gid: string): { achieved: number; total: number } => {
    const acs = all.filter((r) => String(r.goal ?? "") === gid);
    const achieved = acs.filter((r) => r.status === "achieved").length;
    return { achieved, total: acs.length };
  };

  const rows = goals.map((g) => {
    const kind = String(g.kind ?? "");
    const goal = String(g.goal ?? "");
    const criterion = typeof g.criterion === "string" ? g.criterion : "";
    const criterionCell = criterion.length > 60 ? `${escapeHtml(criterion.slice(0, 60))}…` : escapeHtml(criterion);
    const rollup = kind === "goal" ? rollupFor(String(g.id ?? "")) : null;
    return html`<tr>
      <td>${goalIdLink(g.id)}</td>
      <td>${escapeHtml(kind)}</td>
      <td>${escapeHtml(String(g.status ?? ""))}</td>
      <td>${goal ? html`<a href="/goal?goal=${encodeURIComponent(goal)}">${escapeHtml(goal)}</a>` : "—"}</td>
      <td title="${escapeHtml(String(g.title ?? ""))}">${escapeHtml(String(g.title ?? ""))}</td>
      <td><code>${criterionCell || "—"}</code></td>
      <td>${goalEvidenceCell(g)}</td>
      <td>${timeCell(g.lastProgressAt)}</td>
      <td>${timeCell(g.firstEvidenceAt)}</td>
      <td class="ac-rollup">${rollup ? html`${rollup.achieved}/${rollup.total}` : "—"}</td>
    </tr>`;
  }).join("\n");

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
  const kindNav = [
    !kindFilter ? html`<strong>All</strong>` : html`<a href="${goalListHref({ status: statusFilter, goal: goalFilter })}">All</a>`,
    ...["goal", "criterion"].map((k) =>
      k === kindFilter
        ? html`<strong>${k}</strong>`
        : html`<a href="${goalListHref({ kind: k, status: statusFilter, goal: goalFilter })}">${k}</a>`
    ),
  ].join(" · ");
  // Sortable column headers (M2): each is a link that toggles asc↔desc, preserving all filters.
  const th = (col: string, label: string): string => {
    const active = sortParam === col;
    const nextDir = active && dirParam !== "desc" ? "desc" : "asc";
    const arrow = active ? (dirParam === "desc" ? " ↓" : " ↑") : "";
    return html`<th><a href="${goalListHref({ status: statusFilter, kind: kindFilter, goal: goalFilter, sort: col, dir: nextDir })}">${label}${arrow}</a></th>`;
  };

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shellStyles()}${goalTableStyles()}<title>Goals</title></head>
    <body>${renderMobileChrome("goal", "goals")}${renderSiteNav("goal")}<main id="main">
      <h1>Goals — 阶段目标与 AC (${goals.length})</h1>
      ${readError ? html`<div class="error-banner" role="alert"><strong>读失败:</strong> ${escapeHtml(readError)}</div>` : ""}
      ${draftCount > 0 && statusFilter !== "draft"
        ? html`<div class="info-banner" role="status">
            <p><strong>${String(draftCount)} 条待人裁定</strong> — draft 记录不会自己生效：
            激活是人的动作（<code>goal-store.ts write &lt;id&gt; --status active</code>），
            不激活就一直是提案。<a href="${goalListHref({ status: "draft", kind: kindFilter, goal: goalFilter })}">查看待裁定</a></p>
          </div>`
        : ""}
      <p class="meta">Kind: ${kindNav}</p>
      <p class="meta">Status: ${statusNav}</p>
      ${goals.length === 0
        ? (readError
            ? "" /* 读失败：上方 error-banner 已传达，空态不得再叠加误导性的「目录为空」（live 空态同纪律） */
            : html`<div class="info-banner" role="status">
                <p><strong>${statusFilter || kindFilter || goalFilter ? "当前筛选下无记录" : "goals/ 目录为空"}</strong> — 本页是 goal-store 的机读视图，<code>goals/</code> 即正本。</p>
                <p class="meta">（此处原先指向 <code>orchestration/manager-phase-goal.md</code>，该文件已随 G3 降级为归档，不再是正本——指针已修正。）</p>
              </div>`)
        : tableWrap(html`<table class="goal-table">
          <colgroup>${GOAL_COL_WIDTHS.map((w) => html`<col style="width:${w}">`).join("")}</colgroup>
          <tr>${th("id", "id")}${th("kind", "kind")}${th("status", "status")}${th("goal", "goal")}${th("title", "title")}${th("criterion", "criterion")}${th("verdict", "recent verdict")}${th("lastProgressAt", "last progress")}${th("firstEvidenceAt", "first evidence")}<th>AC 达成</th></tr>
          ${rows}
        </table>`)}
    </main></body></html>`);
}

export async function handleGoalDetail(
  req: IncomingMessage,
  res: ServerResponse,
  goalId: string,
  client: ProviderClient,
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
            <tr><th>id</th><th>status</th><th>recent verdict</th><th>last progress</th><th>first evidence</th></tr>
            ${criteria.map((c) => goalCriterionRow(c)).join("\n")}
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
      ${typeof ext.criterion === "string" && (ext.criterion as string).length > 0
        ? html`<p class="meta">criterion: <code>${escapeHtml(ext.criterion as string)}</code></p>` : ""}
      ${ext.expect ? html`<p class="meta">expect: ${escapeHtml(String(ext.expect))}</p>` : ""}
      ${originBlock}
      ${criteriaBlock}
      <article>${renderMarkdown(g.body || "", { headingOffset: 0, linkResolver })}</article>
    </main></body></html>`);
}
