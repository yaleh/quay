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
      // QW-003 (experiment 3, iteration 2): filter by ?status=<value> query param.
      // No param → all tasks; unknown value → empty list (not an error).
      const statusFilter = url.searchParams.get("status");
      const tasks = statusFilter
        ? allTasks.filter((t) => t.status === statusFilter)
        : allTasks;
      const rows = tasks
        .map(
          (t) => html`<tr>
            <td><a href="/task/${t.id}">${escapeHtml(t.id)}</a></td>
            <td>${escapeHtml(t.status)}</td>
            <td>${escapeHtml(t.role)}</td>
            <td>${escapeHtml(t.title)}</td>
          </tr>`
        )
        .join("\n");
      // QW-003: filter navigation links — All, todo, ready, done, needs-human.
      // Active filter is shown as plain text; others as links.
      const statuses = ["todo", "ready", "done", "needs-human"];
      const filterNav = [
        statusFilter ? html`<a href="/">All</a>` : html`<strong>All</strong>`,
        ...statuses.map((s) =>
          s === statusFilter
            ? html`<strong>${escapeHtml(s)}</strong>`
            : html`<a href="/?status=${encodeURIComponent(s)}">${escapeHtml(s)}</a>`
        ),
      ].join(" · ");
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
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${pageStyles()}<title>Quay — ${escapeHtml(manifest.name)}</title></head>
        <body><main>
          <h1>Quay — task list (${escapeHtml(manifest.id)} provider)</h1>
          <p class="meta">Filter: ${filterNav}</p>
          <table>
            <tr><th>id</th><th>status</th><th>role</th><th>title</th></tr>
            ${rows}
          </table>
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
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${pageStyles()}<title>${escapeHtml(t.id)}</title></head>
        <body><main>
          <nav><a href="/">&larr; back to list</a></nav>
          <h1>${escapeHtml(t.id)}: ${escapeHtml(t.title)} [${escapeHtml(t.status)}]</h1>
          <p class="meta">role: ${escapeHtml(t.role)} · labels: ${escapeHtml((t.labels || []).join(", "))}</p>
          <div>${buttons}</div>
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
