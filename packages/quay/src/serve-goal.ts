// serve-goal.ts — /goal + /goal/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { html, escapeHtml, pageStyles, modernistStyles, detailStyles, renderMarkdown, renderSiteNav, renderMobileChrome } from "./serve-render.ts";

// ── /goal — the third sibling kind (goal store), now PROVIDER-BACKED
// (SPEC-goal-mechanism-2026-09-06.md §5.2): these routes read goals through the
// Provider ABI (`client.goalList` / `client.goalGet`), NOT the Core store directly
// (the store moved to quay-native). Same list/detail shape as /adr (SPEC §4: "照
// /adr 形状"). The goal page's most valuable column is the most recent verdict +
// time (SPEC §4: "最近 verdict 与时刻"), read from the record's `evidence` field,
// which the goal gate runner updates after every criterion execution.

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
      <td><a href="/goal/${encodeURIComponent(String(g.id))}">${escapeHtml(String(g.id))}</a></td>
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${modernistStyles()}${pageStyles()}<title>Goals</title></head>
    <body>${renderMobileChrome("goal", "goals")}${renderSiteNav("goal")}<main>
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
  const g = await client.goalGet(goalId);
  if (!g) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const ext = g as unknown as Record<string, unknown>;
  const evidenceCell = goalEvidenceCell(ext);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}">${modernistStyles()}${detailStyles()}<title>${escapeHtml(String(g.id))}</title></head>
    <body class="detail-page">${renderMobileChrome("goal", String(g.id))}${renderSiteNav("goal")}<main>
      <h1>${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}</h1>
      <p class="meta">kind: <strong>${escapeHtml(String(g.kind ?? ""))}</strong> · status: <strong>${escapeHtml(String(g.status ?? ""))}</strong>${g.goal ? html` · goal: ${escapeHtml(String(g.goal))}` : ""}</p>
      ${evidenceCell !== "—" ? html`<p class="meta">最近 verdict: ${evidenceCell}</p>` : ""}
      ${typeof ext.criterion === "string" && (ext.criterion as string).length > 0
        ? html`<p class="meta">criterion: <code>${escapeHtml(ext.criterion as string)}</code></p>` : ""}
      ${ext.expect ? html`<p class="meta">expect: ${escapeHtml(String(ext.expect))}</p>` : ""}
      <p class="meta">origin: ${escapeHtml(String(ext.origin ?? ""))}</p>
      <article>${renderMarkdown(g.body || "")}</article>
    </main></body></html>`);
}
