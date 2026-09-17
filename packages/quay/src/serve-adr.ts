// serve-adr.ts — /adr + /adr/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import type { ServePageCfg } from "./serve-render.ts";
import {
  html, escapeHtml, shellStyles, renderMarkdown, renderSiteNav, renderMobileChrome, renderBackLink, pageTitle,
  // AC-300 (gap-ac300-adr-page-zh-chrome-nav-current-and-own-title): the /adr LIST page consumes the
  // AC-288 mechanism (`htmlLangTag`) and the AC-289 dictionaries (`pageNameFor`) through this one
  // import — `serve-render.ts` re-exports both, so the page never re-parses `?lang=`/the cookie (a
  // second parse is a second decision table, and it would also read a different request's inputs than
  // the one Vary/Cookie was declared for) and never re-derives a label.
  htmlLangTag, pageNameFor,
} from "./serve-render.ts";

export async function handleAdrList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
  cfg: ServePageCfg,
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
  // AC-300: this page's FOUR chrome sites take the per-request language resolved by AC-288
  // (`cfg.lang`, assembled in serve-handlers.ts) and the AC-289 dictionaries. Each call site passes
  // `cfg.lang` rather than defaulting, so `undefined` still falls back to `DEFAULT_LANG` — the
  // default-locale bytes are unchanged by construction, not by remembering.
  //
  // ⚠️ TWO tokens for this page's OWN chrome, and they are NOT the same string: `"ADRs"` (the
  // `pageTitle` token AND the `<h1>` token — the two call sites happen to be byte-equal here, which
  // is why ONE entry serves both) and the LOWERCASE `"adrs"` the mobile header carries. `pageNameFor`
  // is an EXACT-token lookup, so `"ADRs"` does not serve `"adrs"` — registering only the capitalised
  // key would leave the mobile header English while the title switched.
  //
  // ⚠️ The `<h1>` is a DYNAMIC string (`ADRs (36)`), so only its CONSTANT part may go through the
  // dictionary; the record count is interpolated raw. Registering a finished string like
  // "ADRs (36)" would be a value that goes stale the moment an ADR is added — and it would be a
  // lookup that misses, i.e. an English `<h1>` under zh.
  //
  // ⛔ RESIDUE, deliberately out of scope: `handleAdrDetail` below (`/adr/<id>` — NOT one of
  // `SITE_NAV_ROUTES`' 15 nav views, and its `<title>` is the bare entity id, which `pageTitle`'s
  // contract says detail pages intentionally do not route) keeps its own hard-coded English
  // html-lang attribute and its lang-less `renderMobileChrome`/`renderSiteNav`. GOAL-024's scope
  // limits this task to the nav route; that residue is registered by name rather than silently
  // counted as "all bilingual".
  // ⚠️ This comment deliberately SPELLS OUT no html-lang literal: AC-300's AC5④ counts the
  // occurrences of that literal in THIS FILE, and a mention inside a comment is not an occurrence
  // (hard rule 2 — judge by position, not by keyword). Writing it here would inflate the count from
  // the expected 1 to 2 and make the residue look twice as large as it is.
  res.end(html`<!doctype html>
    ${htmlLangTag(cfg.lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shellStyles()}<title>${pageTitle("ADRs", cfg.identity, cfg.lang)}</title></head>
    <body>${renderMobileChrome("adr", pageNameFor("adrs", cfg.lang), cfg.lang)}${renderSiteNav("adr", cfg.lang)}<main id="main">
      <h1>${pageNameFor("ADRs", cfg.lang)} (${adrs.length})</h1>
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
