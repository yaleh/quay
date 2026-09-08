// serve-goal.ts — /goal + /goal/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { html, escapeHtml, shellStyles, renderMarkdown, renderSiteNav, renderMobileChrome, renderBackLink } from "./serve-render.ts";

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

function goalCriterionRow(g: { id?: unknown; status?: unknown }): string {
  const ext = g as unknown as Record<string, unknown>;
  return html`<tr>
    <td>${goalIdLink(g.id)}</td>
    <td>${escapeHtml(String(g.status ?? ""))}</td>
    <td>${goalEvidenceCell(ext)}</td>
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
  let goals;
  let readError: string | null = null;
  // draft = 唯一「等着人裁定」的态（SPEC-goal-mechanism 裁定 3：draft→active 保留给人）。
  // 它必须【在任何筛选下都可见】——否则提案写了也没人看得见（escalations.md 的死法：
  // 12 条未答、无人知道它们在等）。故与筛选后的列表分开计数。
  let draftCount = 0;
  try {
    goals = await client.goalList({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(kindFilter ? { kind: kindFilter } : {}),
    });
    draftCount = (await client.goalList({ status: "draft" })).length;
  } catch (err) {
    goals = [];
    readError = err instanceof Error ? err.message : String(err);
  }
  const rows = goals.map((g) => {
    const ext = g as unknown as Record<string, unknown>;
    const criterion = typeof ext.criterion === "string" ? ext.criterion : "";
    const criterionCell = criterion.length > 60 ? `${escapeHtml(criterion.slice(0, 60))}…` : escapeHtml(criterion);
    return html`<tr>
      <td>${goalIdLink(g.id)}</td>
      <td>${escapeHtml(String(g.kind ?? ""))}</td>
      <td>${escapeHtml(String(g.status ?? ""))}</td>
      <td>${escapeHtml(String(g.goal ?? ""))}</td>
      <td>${escapeHtml(String(g.title ?? ""))}</td>
      <td><code>${criterionCell || "—"}</code></td>
      <td>${goalEvidenceCell(ext)}</td>
      <td>${escapeHtml(String(ext.origin ?? ""))}</td>
    </tr>`;
  }).join("\n");
  const statusNav = [
    statusFilter ? html`<a href="/goal">All</a>` : html`<strong>All</strong>`,
    // draft 排在最前：它是唯一需要人动作的态（此前该筛选项缺失 ⇒ ?status=draft 有记录
    // 但页面上没有任何入口能到达它）。
    ...["draft", "active", "achieved", "superseded", "retired"].map((s) =>
      s === statusFilter
        ? html`<strong>${s}</strong>`
        : html`<a href="/goal?status=${s}">${s}</a>`
    ),
  ].join(" · ");
  const kindNav = [
    kindFilter ? html`<a href="/goal">All</a>` : html`<strong>All</strong>`,
    ...["goal", "criterion"].map((k) =>
      k === kindFilter
        ? html`<strong>${k}</strong>`
        : html`<a href="/goal?kind=${k}">${k}</a>`
    ),
  ].join(" · ");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shellStyles()}<title>Goals</title></head>
    <body>${renderMobileChrome("goal", "goals")}${renderSiteNav("goal")}<main id="main">
      <h1>Goals — 阶段目标与 AC (${goals.length})</h1>
      ${readError ? html`<div class="error-banner" role="alert"><strong>读失败:</strong> ${escapeHtml(readError)}</div>` : ""}
      ${draftCount > 0 && statusFilter !== "draft"
        ? html`<div class="info-banner" role="status">
            <p><strong>${String(draftCount)} 条待人裁定</strong> — draft 记录不会自己生效：
            激活是人的动作（<code>goal-store.ts write &lt;id&gt; --status active</code>），
            不激活就一直是提案。<a href="/goal?status=draft">查看待裁定</a></p>
          </div>`
        : ""}
      <p class="meta">Kind: ${kindNav}</p>
      <p class="meta">Status: ${statusNav}</p>
      ${goals.length === 0
        ? (readError
            ? "" /* 读失败：上方 error-banner 已传达，空态不得再叠加误导性的「目录为空」（live 空态同纪律） */
            : html`<div class="info-banner" role="status">
                <p><strong>${statusFilter || kindFilter ? "当前筛选下无记录" : "goals/ 目录为空"}</strong> — 本页是 goal-store 的机读视图，<code>goals/</code> 即正本。</p>
                <p class="meta">（此处原先指向 <code>orchestration/manager-phase-goal.md</code>，该文件已随 G3 降级为归档，不再是正本——指针已修正。）</p>
              </div>`)
        : html`<table>
          <tr><th>id</th><th>kind</th><th>status</th><th>goal</th><th>title</th><th>criterion</th><th>recent verdict</th><th>origin</th></tr>
          ${rows}
        </table>`}
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
  const criteriaBlock = isGoal
    ? html`<section id="goal-criteria">
        <h2>本 goal 的 criterion (${criteria.length})</h2>
        ${criteria.length === 0
          ? html`<p class="meta">（暂无 criterion）</p>`
          : html`<table>
            <tr><th>id</th><th>status</th><th>recent verdict</th></tr>
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
      ${typeof ext.criterion === "string" && (ext.criterion as string).length > 0
        ? html`<p class="meta">criterion: <code>${escapeHtml(ext.criterion as string)}</code></p>` : ""}
      ${ext.expect ? html`<p class="meta">expect: ${escapeHtml(String(ext.expect))}</p>` : ""}
      <p class="meta">origin: ${escapeHtml(String(ext.origin ?? ""))}</p>
      ${criteriaBlock}
      <article>${renderMarkdown(g.body || "", { headingOffset: 0, linkResolver })}</article>
    </main></body></html>`);
}
