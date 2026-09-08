// serve-adr.ts — /adr + /adr/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { html, escapeHtml, shellStyles, renderMarkdown, renderSiteNav, renderMobileChrome, renderBackLink } from "./serve-render.ts";

export async function handleAdrList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
): Promise<void> {
  const statusFilter = url.searchParams.get("status");
  const adrs = await client.adrList(statusFilter ? { status: statusFilter } : {});
  const rows = adrs.map((a) => html`<tr>
    <td><a href="/adr/${encodeURIComponent(a.id)}">${escapeHtml(a.id)}</a></td>
    <td>${escapeHtml(a.status)}</td>
    <td>${escapeHtml((a as unknown as Record<string, unknown>).date as string || "")}</td>
    <td>${escapeHtml(a.title || "")}</td>
  </tr>`).join("\n");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shellStyles()}<title>ADRs</title></head>
    <body>${renderMobileChrome("adr", "adrs")}${renderSiteNav("adr")}<main id="main">
      <h1>ADRs (${adrs.length})</h1>
      ${adrs.length === 0 ? html`<p class="meta">No ADRs.</p>` : html`<table>
        <tr><th>id</th><th>status</th><th>date</th><th>title</th></tr>
        ${rows}
      </table>`}
    </main></body></html>`);
}

export async function handleAdrDetail(
  req: IncomingMessage,
  res: ServerResponse,
  adrId: string,
  client: ProviderClient,
): Promise<void> {
  // 与 /goal 详情同形（硬规则 5b）：一次 `adrList()` 取代 `adrGet()` —— 既取本记录又拿到全部
  // ADR id 用于正文实体回链。ADR store 没有 goal 账本（无 6.87MB 解析成本），一次调用即最优。
  const adrs = await client.adrList();
  const a = adrs.find((r) => String(r.id) === adrId);
  if (!a) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const idSet = new Set(adrs.map((r) => String(r.id)));
  const linkResolver = (raw: string): string | null =>
    idSet.has(raw) ? `/adr/${encodeURIComponent(raw)}` : null;
  const adrExt = a as unknown as Record<string, unknown>;
  const link = (x: string) => html`<a href="/adr/${encodeURIComponent(x)}">${escapeHtml(x)}</a>`;
  const supersedesMeta = (adrExt.supersedes && (adrExt.supersedes as string[]).length)
    ? html`<p class="meta">supersedes: ${(adrExt.supersedes as string[]).map(link).join(" · ")}</p>` : "";
  const supersededByMeta = (adrExt.supersededBy && (adrExt.supersededBy as string[]).length)
    ? html`<p class="meta">superseded by: ${(adrExt.supersededBy as string[]).map(link).join(" · ")}</p>` : "";
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(a.id)}: ${escapeHtml(a.title)}">${shellStyles("detail")}<title>${escapeHtml(a.id)}</title></head>
    <body class="detail-page">${renderMobileChrome("adr", a.id)}${renderSiteNav("adr")}<main id="main">
      ${renderBackLink("/adr")}
      <h1>${escapeHtml(a.id)}: ${escapeHtml(a.title)}</h1>
      <p class="meta">status: <strong>${escapeHtml(a.status)}</strong>${adrExt.date ? ` · ${escapeHtml(adrExt.date as string)}` : ""}</p>
      ${supersedesMeta}${supersededByMeta}
      <article>${renderMarkdown(a.body || "", { headingOffset: 0, linkResolver })}</article>
    </main></body></html>`);
}
