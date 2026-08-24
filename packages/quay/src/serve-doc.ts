// serve-doc.ts — /doc + /doc/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createDocumentStore } from "./document-store.ts";
import { html, escapeHtml, pageStyles, modernistStyles, detailStyles, renderMarkdown, renderSiteNav, renderMobileChrome } from "./serve-render.ts";

export async function handleDocList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  cfg: { workspaceRoot: string },
): Promise<void> {
  const statusFilter = url.searchParams.get("status");
  const docDir = path.join(cfg.workspaceRoot, "docs-managed");
  let docs;
  let readError: string | null = null;
  try {
    docs = createDocumentStore(docDir).list(statusFilter ? { status: statusFilter } : {});
  } catch (err) {
    docs = [];
    readError = err instanceof Error ? err.message : String(err);
  }
  const rows = docs.map((d) => {
    const ext = d as unknown as Record<string, unknown>;
    return html`<tr>
      <td><a href="/doc/${encodeURIComponent(String(d.id))}">${escapeHtml(String(d.id))}</a></td>
      <td>${escapeHtml(String(d.status ?? ""))}</td>
      <td>${escapeHtml(String(ext.kind ?? ""))}</td>
      <td>${escapeHtml(String(d.title ?? ""))}</td>
    </tr>`;
  }).join("\n");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${modernistStyles()}${pageStyles()}<title>Docs</title></head>
    <body>${renderMobileChrome("doc", "docs")}${renderSiteNav("doc")}<main>
      <h1>Managed documents (${docs.length})</h1>
      ${readError ? html`<div class="error-banner" role="alert"><strong>读失败:</strong> ${escapeHtml(readError)}</div>` : ""}
      ${docs.length === 0 ? html`<p class="meta">No documents.</p>` : html`<table>
        <tr><th>id</th><th>status</th><th>kind</th><th>title</th></tr>
        ${rows}
      </table>`}
    </main></body></html>`);
}

export async function handleDocDetail(
  req: IncomingMessage,
  res: ServerResponse,
  docId: string,
  cfg: { workspaceRoot: string },
): Promise<void> {
  const docDir = path.join(cfg.workspaceRoot, "docs-managed");
  const store = createDocumentStore(docDir);
  const d = store.get(docId);
  if (!d) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const ext = d as unknown as Record<string, unknown>;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(String(d.id))}: ${escapeHtml(String(d.title))}">${modernistStyles()}${detailStyles()}<title>${escapeHtml(String(d.id))}</title></head>
    <body class="detail-page">${renderMobileChrome("doc", String(d.id))}${renderSiteNav("doc")}<main>
      <h1>${escapeHtml(String(d.id))}: ${escapeHtml(String(d.title))}</h1>
      <p class="meta">status: <strong>${escapeHtml(String(d.status ?? ""))}</strong>${ext.kind ? ` · kind: ${escapeHtml(String(ext.kind))}` : ""}</p>
      <article>${renderMarkdown(d.body || "")}</article>
    </main></body></html>`);
}
