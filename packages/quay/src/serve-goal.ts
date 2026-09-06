// serve-goal.ts — /goal + /goal/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createGoalStore } from "./goal-store.ts";
import { html, escapeHtml, pageStyles, modernistStyles, detailStyles, renderMarkdown, renderSiteNav, renderMobileChrome } from "./serve-render.ts";

// ── /goal + /doc — the third sibling kind (goal store) + the second (document store) ──
// Both are CORE stores (not Provider ABI surfaces), so these routes read them directly
// from the workspace root's `goals/` and `docs-managed/` dirs — same list/detail shape
// as /adr (SPEC §4: "照 /adr 形状"). The goal page's most valuable column is the most
// recent verdict + time (SPEC §4: "最近 verdict 与时刻"), read from the record's
// `evidence` field, which the goal gate runner updates after every criterion execution.

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
  cfg: { workspaceRoot: string },
): Promise<void> {
  const statusFilter = url.searchParams.get("status");
  const kindFilter = url.searchParams.get("kind");
  const goalDir = path.join(cfg.workspaceRoot, "goals");
  let goals;
  let readError: string | null = null;
  try {
    goals = createGoalStore(goalDir).list({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(kindFilter ? { kind: kindFilter } : {}),
    });
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
    ...["active", "achieved", "superseded", "retired"].map((s) =>
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
      <p class="meta">Kind: ${kindNav}</p>
      <p class="meta">Status: ${statusNav}</p>
      ${goals.length === 0
        ? (readError
            ? "" /* 读失败：上方 error-banner 已传达，空态不得再叠加误导性的「目录为空」（live 空态同纪律） */
            : html`<div class="info-banner" role="status">
                <p><strong>${statusFilter || kindFilter ? "当前筛选下无记录" : "goals/ 目录为空"}</strong> — 本页是 goal-store 的机读视图；阶段目标正本在 prose 文件：</p>
                <p><code>orchestration/manager-phase-goal.md</code> · <code>orchestration/outer-phase-goal.md</code></p>
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
  cfg: { workspaceRoot: string },
): Promise<void> {
  const goalDir = path.join(cfg.workspaceRoot, "goals");
  const store = createGoalStore(goalDir);
  const g = store.get(goalId);
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
