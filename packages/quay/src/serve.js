// quay serve — starts Web + provider host (proposal §9). v0 walking
// skeleton (G5): a crude but real list/detail HTTP view, no framework, no
// styling beyond what's needed to prove the loop. The Core renders
// presentation; the Provider declares semantics only (design §6.3) — this
// file never branches on provider id.
//
// QW-001 (experiment 3, iteration 1): adds a consistent CSS styling system
// via pageStyles() — applied to all reachable pages. No external dependency.
// QW-002 (experiment 3, iteration 1): adds renderMarkdown() — a minimal
// inline markdown-to-HTML renderer replacing the bare <pre> body dump on
// the detail page. No external dependency.

import http from "node:http";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.js";
import { connectProvider } from "./provider-client.js";
import { resolveProviderEnv } from "./provider-env.js";

function html(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// QW-001: minimal, consistent CSS system — applied via <link> in every page's
// <head>. No external file: inlined as a <style> block so the single-file
// serve.js remains self-contained (G5: no framework, no build step).
function pageStyles() {
  return `<style>
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 1rem;
  line-height: 1.6;
  color: #1a1a1a;
  background: #f8f9fa;
  margin: 0;
  padding: 0;
}
main {
  max-width: 900px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}
h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; color: #111; }
h2 { font-size: 1.2rem; margin: 1.2rem 0 0.4rem; color: #222; }
h3 { font-size: 1rem; margin: 1rem 0 0.3rem; color: #333; }
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
nav { margin-bottom: 1rem; }
nav a { font-size: 0.95rem; color: #555; }
table {
  border-collapse: collapse;
  width: 100%;
  margin-top: 0.5rem;
  background: #fff;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
}
th {
  background: #e9ecef;
  padding: 0.55rem 0.85rem;
  text-align: left;
  font-size: 0.85rem;
  font-weight: 600;
  color: #444;
  border-bottom: 2px solid #ced4da;
}
td {
  padding: 0.5rem 0.85rem;
  border-bottom: 1px solid #e9ecef;
  font-size: 0.9rem;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f1f3f5; }
button {
  background: #0066cc;
  color: #fff;
  border: none;
  padding: 0.4rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  margin: 0 0.25rem 0.25rem 0;
}
button:hover { background: #0052a3; }
.meta { color: #555; font-size: 0.9rem; margin: 0.5rem 0 1rem; }
.meta a { text-decoration: underline; }
.body { margin-top: 1rem; }
.body h2, .body h3 { margin-top: 1rem; }
.body ul, .body ol { margin: 0.4rem 0 0.4rem 1.5rem; }
.body li { margin: 0.15rem 0; }
.body pre {
  background: #f1f3f5;
  border-radius: 4px;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  font-size: 0.85rem;
}
.body code {
  background: #f1f3f5;
  border-radius: 3px;
  padding: 0.1em 0.35em;
  font-size: 0.88em;
}
.body pre code { background: none; padding: 0; font-size: inherit; }
hr { border: none; border-top: 1px solid #dee2e6; margin: 1rem 0; }
/* QW-007: disabled page-nav items — non-clickable; use #666 (5.74:1 on white, AA pass) */
.page-nav-disabled { color: #666; cursor: default; }
/* QW-006: visually-hidden class for semantic headings that should not disrupt layout */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
/* QW-006: mobile-responsive layout (DIR-003) — narrow viewport adaptations */
@media (max-width: 600px) {
  main { padding: 1rem 0.75rem; }
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  th, td { padding: 0.45rem 0.6rem; font-size: 0.85rem; }
}
</style>`;
}

// QW-002: minimal inline markdown-to-HTML renderer. Handles the constructs
// found in quay task bodies: fenced code blocks, ATX headings (#/##/###),
// bold (**...**), inline code (`...`), unordered lists (- item), ordered
// lists (1. item), horizontal rules (---/***), and paragraph breaks.
// Uses a line-by-line state machine; no external dependency.
function renderMarkdown(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = [];
  let inFence = false;
  let fenceLang = "";
  let fenceBuf = [];
  let inList = null; // "ul" | "ol" | null
  let listBuf = [];
  let paraBuf = [];

  function flushList() {
    if (!inList) return;
    const tag = inList;
    out.push(`<${tag}>`);
    for (const item of listBuf) out.push(`<li>${inlineMarkdown(item)}</li>`);
    out.push(`</${tag}>`);
    listBuf = [];
    inList = null;
  }

  function flushPara() {
    if (paraBuf.length === 0) return;
    const text2 = paraBuf.join(" ");
    if (text2.trim()) out.push(`<p>${inlineMarkdown(text2)}</p>`);
    paraBuf = [];
  }

  for (const line of lines) {
    // Fenced code block toggle
    if (/^```/.test(line)) {
      if (!inFence) {
        flushList();
        flushPara();
        inFence = true;
        fenceLang = line.slice(3).trim();
        fenceBuf = [];
      } else {
        const langAttr = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : "";
        out.push(`<pre><code${langAttr}>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`);
        inFence = false;
        fenceLang = "";
        fenceBuf = [];
      }
      continue;
    }
    if (inFence) { fenceBuf.push(line); continue; }

    // ATX headings
    const hm = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hm) {
      flushList();
      flushPara();
      const lvl = hm[1].length + 1; // # → h2, ## → h3, ### → h4 (h1 is the page title)
      out.push(`<h${lvl}>${escapeHtml(hm[2].trim())}</h${lvl}>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*]{3,}\s*$/.test(line.trim())) {
      flushList();
      flushPara();
      out.push("<hr>");
      continue;
    }

    // Unordered list item
    const ulm = /^[-*+]\s+(.*)$/.exec(line);
    if (ulm) {
      flushPara();
      if (inList !== "ul") { flushList(); inList = "ul"; }
      listBuf.push(ulm[1]);
      continue;
    }

    // Ordered list item
    const olm = /^\d+\.\s+(.*)$/.exec(line);
    if (olm) {
      flushPara();
      if (inList !== "ol") { flushList(); inList = "ol"; }
      listBuf.push(olm[1]);
      continue;
    }

    // Blank line — flush current list or paragraph
    if (/^\s*$/.test(line)) {
      flushList();
      flushPara();
      continue;
    }

    // Regular text — accumulate into paragraph (flush list first)
    if (inList) { flushList(); }
    paraBuf.push(line.trimEnd());
  }

  // End-of-input flush
  if (inFence) {
    const langAttr = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : "";
    out.push(`<pre><code${langAttr}>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`);
  }
  flushList();
  flushPara();

  return out.join("\n");
}

// Inline markdown: code spans, bold, italic — with correct HTML escaping.
// Process segments: alternate between code spans and the rest.
function inlineMarkdown(text) {
  // Process segments: alternate between code spans and the rest.
  const parts = text.split(/(`[^`]*`)/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Code span
      const inner = part.slice(1, -1);
      return `<code>${escapeHtml(inner)}</code>`;
    }
    // Regular text: escape HTML, then apply bold/italic
    let s = escapeHtml(part);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return s;
  }).join("");
}

export async function startServer({ port = 4173 } = {}) {
  const cfg = loadConfig();
  const provider = activeProvider(cfg);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;

  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    // QN-045 (closes DESIGN.md §4.4's asymmetry): previously this built a
    // single-key env object from `provider.tasks_dir` directly, ignoring
    // `provider.env` entirely — the CLI/MCP legs resolved env the other way
    // (via resolveProviderEnv(cfg, provider), reading only `provider.env`).
    // A workspace config setting `tasks_dir` and `env` to different values
    // would silently serve a different task store to the Web UI than to the
    // CLI/MCP legs. Now all three bindings share the one resolution path.
    env: resolveProviderEnv(cfg, provider),
  });

  const manifest = await client.manifest();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/") {
      const allTasks = await client.taskList({});
      // QX-004 (experiment 4, iteration 1): filter by ?prefix=<value> query param.
      // Closes CB-002: "show only QX-* tasks" affordance in Web UI.
      // Applied FIRST, before status/label filters — prefix scopes the whole view.
      // No param → all tasks; unknown prefix → empty list (not an error).
      const prefixFilter = url.searchParams.get("prefix");
      const filteredByPrefix = prefixFilter
        ? allTasks.filter((t) => t.id.toUpperCase().startsWith(prefixFilter.toUpperCase()))
        : allTasks;
      // QW-003 (experiment 3, iteration 2): filter by ?status=<value> query param.
      // No param → all tasks; unknown value → empty list (not an error).
      const statusFilter = url.searchParams.get("status");
      const filteredByStatus = statusFilter
        ? filteredByPrefix.filter((t) => t.status === statusFilter)
        : filteredByPrefix;
      // QW-005 (experiment 3, iteration 3): filter by ?label=<value> query param.
      // No param → all tasks; unknown value → empty list (not an error).
      // Applied after prefix and status filters.
      const labelFilter = url.searchParams.get("label");
      const filtered = labelFilter
        ? filteredByStatus.filter((t) => Array.isArray(t.labels) && t.labels.includes(labelFilter))
        : filteredByStatus;
      // QW-004 (experiment 3, iteration 3): sort by ?sort=<value> query param.
      // Supported values: 'id' (lexicographic) and 'status' (then id tiebreaker).
      // No param or unknown value → insertion order preserved.
      const sortKey = url.searchParams.get("sort");
      let tasks;
      if (sortKey === "id") {
        tasks = filtered.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      } else if (sortKey === "status") {
        tasks = filtered.slice().sort((a, b) =>
          a.status < b.status ? -1 : a.status > b.status ? 1 :
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        );
      } else {
        tasks = filtered;
      }
      // QW-007 (experiment 3, iteration 4): pagination — 20 tasks per page.
      // ?page=N selects the page (1-based, default 1). Applied after filter+sort.
      const PAGE_SIZE = 20;
      const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
      const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
      const totalTasks = tasks.length;
      const totalPages = Math.max(1, Math.ceil(totalTasks / PAGE_SIZE));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * PAGE_SIZE;
      const pageTasks = tasks.slice(offset, offset + PAGE_SIZE);
      // QW-009 (experiment 3, iteration 4): add labels column to list table.
      const rows = pageTasks
        .map(
          (t) => html`<tr>
            <td><a href="/task/${t.id}">${escapeHtml(t.id)}</a></td>
            <td>${escapeHtml(t.status)}</td>
            <td>${escapeHtml(t.role)}</td>
            <td>${escapeHtml(t.title)}</td>
            <td>${escapeHtml((Array.isArray(t.labels) ? t.labels : []).join(", "))}</td>
          </tr>`
        )
        .join("\n");
      // QW-003: filter navigation links — All, todo, ready, done, needs-human.
      // Active filter is shown as plain text; others as links.
      const statuses = ["todo", "ready", "done", "needs-human"];
      // Build query param helper: merges prefix, status, sort, label, and page params.
      // QW-007: page param added; when page=1 it is omitted from the href (clean URL).
      // QX-004: prefix param added; omitted when null/falsy (clears the prefix filter).
      function buildHref(status, sort, label, pg, prefix) {
        const params = new URLSearchParams();
        if (prefix) params.set("prefix", prefix);
        if (status) params.set("status", status);
        if (label) params.set("label", label);
        if (sort) params.set("sort", sort);
        if (pg && pg > 1) params.set("page", String(pg));
        const qs = params.toString();
        return qs ? `/?${qs}` : "/";
      }
      // QX-004: prefix navigation links — All + each distinct task-id prefix.
      // A "prefix" is the part of a task id before the first `-` (e.g. "QX" from "QX-001").
      // Only rendered when 2+ distinct prefixes exist across ALL tasks (single-experiment
      // workspaces need no clutter). Placed FIRST in the nav, before status/sort/label.
      const allPrefixes = [...new Set(allTasks.map((t) => {
        const dash = t.id.indexOf("-");
        return dash > 0 ? t.id.slice(0, dash) : t.id;
      }))].sort();
      const prefixNav = allPrefixes.length >= 2 ? [
        prefixFilter
          ? html`<a href="${buildHref(statusFilter, sortKey, labelFilter, null, null)}">All</a>`
          : html`<strong>All</strong>`,
        ...allPrefixes.map((p) =>
          p === prefixFilter
            ? html`<strong>${escapeHtml(p)}</strong>`
            : html`<a href="${buildHref(statusFilter, sortKey, labelFilter, null, p)}">${escapeHtml(p)}</a>`
        ),
      ].join(" · ") : null;
      const filterNav = [
        statusFilter
          ? html`<a href="${buildHref(null, sortKey, labelFilter, null, prefixFilter)}">All</a>`
          : html`<strong>All</strong>`,
        ...statuses.map((s) =>
          s === statusFilter
            ? html`<strong>${escapeHtml(s)}</strong>`
            : html`<a href="${buildHref(s, sortKey, labelFilter, null, prefixFilter)}">${escapeHtml(s)}</a>`
        ),
      ].join(" · ");
      // QW-004: sort navigation links — Default, id, status.
      // Active sort shown as plain text; others as links (preserving active status, label, and prefix filters).
      const sortNav = [
        !sortKey ? html`<strong>Default</strong>` : html`<a href="${buildHref(statusFilter, null, labelFilter, null, prefixFilter)}">Default</a>`,
        sortKey === "id"
          ? html`<strong>id</strong>`
          : html`<a href="${buildHref(statusFilter, "id", labelFilter, null, prefixFilter)}">id</a>`,
        sortKey === "status"
          ? html`<strong>status</strong>`
          : html`<a href="${buildHref(statusFilter, "status", labelFilter, null, prefixFilter)}">status</a>`,
      ].join(" · ");
      // QW-005: label navigation links — All + each distinct label.
      // Only rendered when at least one task has labels.
      const allLabels = [...new Set(allTasks.flatMap((t) => Array.isArray(t.labels) ? t.labels : []))].sort();
      const labelNav = allLabels.length > 0 ? [
        labelFilter
          ? html`<a href="${buildHref(statusFilter, sortKey, null, null, prefixFilter)}">All</a>`
          : html`<strong>All</strong>`,
        ...allLabels.map((l) =>
          l === labelFilter
            ? html`<strong>${escapeHtml(l)}</strong>`
            : html`<a href="${buildHref(statusFilter, sortKey, l, null, prefixFilter)}">${escapeHtml(l)}</a>`
        ),
      ].join(" · ") : null;
      // QW-007: page navigation — Previous / Next links with page info.
      // QW-007: page navigation — Previous / Next links with page info.
      // Filter/sort nav links reset to page 1 (no pg param) when clicked, which is correct:
      // changing a filter changes which tasks are in view.
      // QX-004: prefix param carried through page nav links.
      const pageNav = totalPages > 1 ? html`
        <p class="meta">
          ${safePage > 1
            ? html`<a href="${buildHref(statusFilter, sortKey, labelFilter, safePage - 1, prefixFilter)}">&laquo; Previous</a>`
            : html`<span class="page-nav-disabled">&laquo; Previous</span>`}
          &nbsp; Page ${safePage} of ${totalPages} (${totalTasks} tasks) &nbsp;
          ${safePage < totalPages
            ? html`<a href="${buildHref(statusFilter, sortKey, labelFilter, safePage + 1, prefixFilter)}">Next &raquo;</a>`
            : html`<span class="page-nav-disabled">Next &raquo;</span>`}
        </p>` : html`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>`;
      // QN-046 (closes discussion-doc §2.1's browser-rendering gap): a real
      // browser (driven via playwright MCP tooling) decodes this body as
      // mojibake (e.g. "Quay â€" task list") without an explicit charset —
      // the bytes on the wire are correct UTF-8, but a browser with no
      // charset hint falls back to a legacy encoding. Raw-HTTP-body string
      // assertions (serve.test.mjs) never caught this because they check
      // substring presence in the raw byte buffer, not decoded/rendered
      // text. Fixed by declaring charset=utf-8 explicitly.
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay task list — ${escapeHtml(manifest.name)}">${pageStyles()}<title>Quay — ${escapeHtml(manifest.name)}</title></head>
        <body><main>
          <h1>Quay — task list (${escapeHtml(manifest.id)} provider)</h1>
          ${prefixNav ? html`<p class="meta">Prefix: ${prefixNav}</p>` : ""}
          <p class="meta">Filter: ${filterNav}</p>
          <p class="meta">Sort: ${sortNav}</p>
          ${labelNav ? html`<p class="meta">Label: ${labelNav}</p>` : ""}
          ${pageNav}
          <table>
            <tr><th>id</th><th>status</th><th>role</th><th>title</th><th>labels</th></tr>
            ${rows}
          </table>
          ${totalPages > 1 ? pageNav : ""}
        </main></body></html>`);
      return;
    }

    const m = /^\/task\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const t = await client.taskGet(id);
      if (!t) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const buttons = (manifest.action_buttons ?? [])
        .filter((b) => !b.whenStatus || b.whenStatus.includes(t.status))
        .map(
          (b) => html`<form method="post" action="/task/${t.id}/action/${b.id}" style="display:inline">
            <button type="submit">${escapeHtml(b.label)}</button>
          </form>`
        )
        .join("\n");
      // QN-046: same charset fix as the list route above (the "·" separator
      // on this page is likewise mis-decoded by a real browser without it).
      // QW-008 (experiment 3, iteration 4): render parent and children links in detail page meta.
      // t.parent: string id or null. t.children: array of child ids (may be empty).
      const parentMeta = t.parent
        ? html` · parent: <a href="/task/${escapeHtml(t.parent)}">${escapeHtml(t.parent)}</a>`
        : "";
      const childrenMeta = Array.isArray(t.children) && t.children.length > 0
        ? html`<p class="meta">children: ${t.children.map((c) =>
            html`<a href="/task/${escapeHtml(c)}">${escapeHtml(c)}</a>`
          ).join(" · ")}</p>`
        : "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(t.id)}: ${escapeHtml(t.title)}">${pageStyles()}<title>${escapeHtml(t.id)}</title></head>
        <body><main>
          <nav><a href="/">&larr; back to list</a></nav>
          <h1>${escapeHtml(t.id)}: ${escapeHtml(t.title)} [${escapeHtml(t.status)}]</h1>
          <p class="meta">role: ${escapeHtml(t.role)} · labels: ${escapeHtml((t.labels || []).join(", "))}${parentMeta}</p>
          ${childrenMeta}
          <div>${buttons}</div>
          <h2 class="sr-only">Details</h2>
          <div class="body">${renderMarkdown(t.body)}</div>
        </main></body></html>`);
      return;
    }

    const am = /^\/task\/([^/]+)\/action\/([^/]+)$/.exec(url.pathname);
    if (am && req.method === "POST") {
      const [, id, actionId] = am;
      const { composePayload, deliverTrigger } = await import("./action.js");
      const t = await client.taskGet(decodeURIComponent(id));
      const payloadObj = composePayload({ providerManifest: manifest, task: t, actionId: decodeURIComponent(actionId) });
      // QN-042 (DIR-009): QUAY_ACTION_MOCK_LOG opts into the deterministic
      // mock/file-log delivery mode instead of manda/print — see
      // src/action.js#deliverTrigger's own doc comment.
      const mockLogPath = process.env.QUAY_ACTION_MOCK_LOG || undefined;
      const result = await deliverTrigger({
        root: cfg.workspaceRoot,
        channel: `task-${t.id}`,
        payloadObj,
        mockLogPath,
      });
      res.writeHead(302, { Location: `/task/${t.id}` });
      res.end();
      console.log(`[quay serve] action ${actionId} on ${id}:`, result);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  server.listen(port, () => {
    console.log(`quay serve: listening on http://localhost:${port}`);
  });

  // QN-031 (iteration 21): expose the underlying provider client so a caller
  // (notably an automated test) can shut down the MCP child process cleanly
  // instead of leaving it running after http.Server.close(). This is a pure
  // addition (a new property on the returned object) — no existing caller's
  // behavior changes, since nothing previously read `server.client`.
  server.client = client;
  return server;
}
