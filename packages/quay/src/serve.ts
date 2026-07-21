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

import http, { type IncomingMessage, type ServerResponse, type Server } from "node:http";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.ts";
import { connectProvider, type ProviderClient } from "./provider-client.ts";
import { resolveProviderEnv } from "./provider-env.ts";

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc: string, s: string, i: number) => acc + s + (values[i] ?? ""), "");
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

// QX-028 (experiment 4, iteration 7): strip structural heading lines from
// body content before using it as a search index. Lines matching /^#+\s/
// (one or more # followed by a space) are structural headers ("## Proposal",
// "## Plan", "## AC", "## DoD", etc.) — excluding them prevents template
// boilerplate section names from causing false positives in body search.
// Closes CB-017 (significant: searching "Proposal" matched 117/118 tasks).
// QX-041 (experiment 4, iteration 11): fix SH-003 — track fenced code blocks
// so that `# comment` lines inside ``` fences are NOT stripped. Only lines
// outside a fence that match /^#+\s/ are heading boilerplate; lines inside
// fences are code content that should remain searchable.
function stripHeadings(text: string | undefined | null): string {
  let inFence = false;
  return (text || "").split("\n").filter((line) => {
    if (/^```/.test(line)) { inFence = !inFence; return true; }
    if (inFence) return true; // preserve code content (including # comment lines)
    return !/^#+\s/.test(line); // strip structural headings outside fences
  }).join(" ");
}

// QW-001: minimal, consistent CSS system — applied via <link> in every page's
// <head>. No external file: inlined as a <style> block so the single-file
// serve.ts remains self-contained (G5: no framework, no build step).
function pageStyles(): string {
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
.body li.task-list-item { list-style: none; margin-left: -1.2rem; }
.body li.task-list-item input[type="checkbox"] { margin-right: 0.35em; }
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
  /* QX-012 (experiment 4, iteration 3): hide role/labels columns on mobile so
     id, status, title, and actions all fit in the visible viewport at 375px.
     Closes UQ-011 (action button hidden off-screen) and UQ-012 (role/labels
     columns crowd out title and actions). */
  .col-role, .col-labels { display: none; }
  /* QX-017 (experiment 4, iteration 4): sticky actions column at mobile — the
     actions column (th/td) sticks to the right edge so Advance button is always
     visible even when the table scrolls horizontally for long task IDs. Also hide
     the updated column at mobile to reduce clutter. Closes UQ-011 (remainder). */
  .col-actions { position: sticky; right: 0; background: #fff; z-index: 2; }
  .col-updated { display: none; }
}
/* QX-015 (experiment 4, iteration 3): project orientation banner — REMOVED by
   DIR-007 (iteration 10). Banner had two problems: (1) depicted needs-human as
   sequential step in todo→ready→needs-human→done chain rather than as a
   side-branch/blocked state; (2) permanent top-of-page layout cost
   disproportionate to value. CSS class left as empty rule for no-op safety
   in case any test or external reference still matches on it; the HTML element
   was removed from the list-page template. */
/* QX-013 (experiment 4, iteration 3): error and success banners for
   gate-fail and post-action feedback. Closes UQ-013. */
.error-banner {
  background: #fff0f0;
  border-left: 3px solid #cc0000;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  color: #8b0000;
  border-radius: 0 4px 4px 0;
}
.success-banner {
  background: #f0fff0;
  border-left: 3px solid #007700;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  color: #004400;
  border-radius: 0 4px 4px 0;
}
/* QX-037 (experiment 4, iteration 10): info banner for needs-human CTA (UQ-022). */
.info-banner {
  background: #fffbf0;
  border-left: 3px solid #cc8800;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  color: #664400;
  border-radius: 0 4px 4px 0;
}
/* QX-043 (experiment 4, iteration 11): label nav scrollable strip on mobile (UQ-006).
   On narrow viewports the label nav wraps into a multi-line wall; convert to a
   single scrollable horizontal strip so the vertical space cost is bounded. */
.label-nav-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  white-space: nowrap;
  padding-bottom: 0.2rem;
  margin-bottom: 0.25rem;
}
</style>`;
}

// QW-002: minimal inline markdown-to-HTML renderer. Handles the constructs
// found in quay task bodies: fenced code blocks, ATX headings (#/##/###),
// bold (**...**), inline code (`...`), unordered lists (- item), ordered
// lists (1. item), horizontal rules (---/***), and paragraph breaks.
// Uses a line-by-line state machine; no external dependency.
function renderMarkdown(text: string | undefined | null): string {
  const lines = String(text ?? "").split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let listBuf: string[] = [];
  let paraBuf: string[] = [];

  function flushList(): void {
    if (!inList) return;
    const tag = inList;
    out.push(`<${tag}>`);
    for (const item of listBuf) {
      // DIR-025/M41: GFM task-list checkbox glyphs (`[ ]` / `[x]`) at the start of a list
      // item — as found rendering literally (e.g. "[ ] some AC text") when the full DIR
      // Acceptance Criteria / Definition of Done checklists were first projected into
      // directive task bodies. Render as a real (disabled, state-only) checkbox input
      // instead of leaving the bracket glyph as plain text. Minimal, additive tweak only —
      // does not touch any other list/paragraph rendering path.
      const cbm = /^\[([ xX])\]\s+(.*)$/.exec(item);
      if (cbm) {
        const checked = cbm[1].toLowerCase() === "x";
        out.push(
          `<li class="task-list-item"><input type="checkbox" disabled${checked ? " checked" : ""}> ${inlineMarkdown(cbm[2])}</li>`
        );
      } else {
        out.push(`<li>${inlineMarkdown(item)}</li>`);
      }
    }
    out.push(`</${tag}>`);
    listBuf = [];
    inList = null;
  }

  function flushPara(): void {
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
function inlineMarkdown(text: string): string {
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

// QX-018 (experiment 4, iteration 4): relative-time helper for updatedAt display.
// Given a millisecond timestamp, returns a human-readable "X ago" string.
// Used on both the list page (updated column) and detail page (last updated meta).
function relativeTime(ts: number): string {
  const elapsed = Date.now() - ts;
  if (elapsed < 0) return "just now";
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// M26-adversarial-eval finding ADV-003: shared open-redirect guard for
// ?from= redirect targets, replacing the two previously-DIVERGING inline
// checks (GET /task/<id>'s backHref had startsWith("/") &&
// !startsWith("//"); POST .../action/<id>'s baseRedirect had only
// startsWith("/"), a real bypass closed by ADV-003 above). Also closes two
// further real bypasses the audit found neither inline check caught: a
// backslash immediately after the leading slash (e.g. "/\evil.com") and a
// literal-tab/control-char immediately after the leading slash (e.g.
// "/\t/evil.com") -- both are accepted by a naive startsWith("/") &&
// !startsWith("//") check, but the WHATWG URL spec (which real browsers
// implement) normalizes a leading backslash to a forward slash and treats
// a leading control character as insignificant whitespace BEFORE resolving
// the URL, so a browser actually navigates "/\evil.com" or "/\t/evil.com"
// to the external origin http://evil.com/ despite the string itself
// starting with a single "/" -- confirmed by direct WHATWG URL resolution
// (`new URL(v, base).host !== base.host`) during this audit. This helper
// rejects any candidate whose second character (after the leading "/") is
// "/", "\", or a C0 control character (which covers both confirmed bypass
// shapes and the general class they belong to), in addition to the
// original external-scheme and protocol-relative checks.
function isSafeRelativeRedirect(v: string | null): boolean {
  if (!v || typeof v !== "string") return false;
  if (!v.startsWith("/")) return false;
  const second = v.charCodeAt(1);
  if (Number.isNaN(second)) return true; // v === "/" exactly
  if (second === 0x2f /* / */ || second === 0x5c /* \ */) return false;
  if (second <= 0x1f || second === 0x7f) return false; // C0 control chars incl. \t, \0
  return true;
}

export interface StartServerOptions {
  port?: number;
}

export async function startServer({ port = 4173 }: StartServerOptions = {}): Promise<Server & { client: ProviderClient }> {
  const cfg = loadConfig();
  const provider = activeProvider(cfg, undefined);
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

  // QX-013 (iteration 3): helper to append a query param to an existing URL path
  // (which may already have params). Used to add ?error= and ?success= to redirect
  // targets without clobbering existing filter params already in the target URL.
  function addParam(urlPath: string, key: string, value: string): string {
    const u = new URL(urlPath, "http://x");
    u.searchParams.set(key, value);
    return u.pathname + "?" + u.searchParams.toString();
  }

  // M26-adversarial-eval finding M26-F2 (Phase A audit): this request
  // handler had no top-level try/catch. Combined with provider-client.js's
  // taskList() previously swallowing Provider errors into an empty array,
  // failures were invisible; now that taskList() (and any other client.*
  // call) can throw on a real Provider failure (malformed task file
  // crashing the store, or a live rate-limit/network failure), an unhandled
  // throw inside this async handler would leave the request hanging (no
  // res.end() ever called) rather than degrading safely. This wrapper
  // ensures ANY thrown error from the request-handling logic below (not
  // just the taskList() case) results in a clean 500 response instead of a
  // hung connection or an uncaught rejection that could take the whole
  // server down.
  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // M26-adversarial-eval finding ADV-002/M26-F2 (both iterations
    // independently found this): this handler previously had no try/catch
    // anywhere -- a thrown/rejected error from any route (e.g. the Provider
    // layer throwing on a malformed task file, now correctly surfaced by
    // ADV-001/M26-F2's provider-client.js fix instead of being silently
    // masked as an empty list) went fully uncaught, crashing the ENTIRE Node
    // process (taking down the Web UI for every other task and every other
    // request, not just the one bad task) -- an unhandled rejection inside
    // an http.createServer async callback is fatal by default. Wrapping the
    // whole handler body closes this: any single request's failure now
    // degrades to a 500 for THAT request only, with the server, other
    // tasks, and other requests unaffected -- matching DIR-001's "should
    // degrade safely... not crash" framing. Response body deliberately omits
    // err.message/stack (logged server-side only via console.error) to
    // avoid leaking internal error detail to the client.
    try {
      await handleRequest(req, res);
    } catch (err) {
      console.error(`[quay serve] request handler error (${req.method} ${req.url}):`, (err as Error).stack || String(err));
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("internal server error");
      } else {
        res.end();
      }
    }
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url as string, `http://${req.headers.host}`);

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
      // QX-016 (experiment 4, iteration 4): use getAll() instead of get() to support
      // repeated ?label=A&label=B params. Applies AND-logic: task must have ALL labels.
      // Closes CB-013 (Web UI first-wins bug). Single ?label=A still works as before.
      const labelFilters = url.searchParams.getAll("label").filter(Boolean);
      const filteredByLabel = labelFilters.length > 0
        ? filteredByStatus.filter((t) =>
            Array.isArray(t.labels) && labelFilters.every((l) => t.labels.includes(l))
          )
        : filteredByStatus;
      // QX-021 (experiment 4, iteration 5): full-text title search via ?q=<query>.
      // Case-insensitive substring match on task title. Empty or absent ?q means no filter.
      // Closes CB-007 (significant: no search affordance in CLI or Web UI).
      // QX-023 (experiment 4, iteration 6): extend to body content too.
      // Closes CB-016 (significant: title-only search misses body content).
      // QX-028 (experiment 4, iteration 7): strip structural heading lines before
      // indexing body content — lines starting with "# " (any number of #s followed
      // by a space) are excluded from the search index. This prevents template section
      // headers ("## Proposal", "## Plan", "## AC", "## DoD") from causing false
      // positives when searching for those terms. Closes CB-017 (significant).
      const qFilter = url.searchParams.get("q") || null;
      const filtered = qFilter
        ? filteredByLabel.filter((t) =>
            (t.title + " " + stripHeadings(t.body)).toLowerCase().includes(qFilter.toLowerCase())
          )
        : filteredByLabel;
      // QW-004 (experiment 3, iteration 3): sort by ?sort=<value> query param.
      // QX-008 (experiment 4, iteration 2): added 'updated' sort value —
      // sorts by task file mtime (updatedAt field in ms from quay-native's
      // store.js list()), descending (most-recently-modified first). Closes
      // CB-005 (no sort-by-time on Web UI). The 'updated' sort option also
      // resolves the Web UI's analog of CB-012.
      const sortKey = url.searchParams.get("sort");
      let tasks;
      if (sortKey === "id") {
        tasks = filtered.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      } else if (sortKey === "status") {
        tasks = filtered.slice().sort((a, b) =>
          a.status < b.status ? -1 : a.status > b.status ? 1 :
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        );
      } else if (sortKey === "updated") {
        tasks = filtered.slice().sort((a, b) => {
          const ta = typeof (a as unknown as Record<string, unknown>).updatedAt === "number" ? (a as unknown as Record<string, unknown>).updatedAt as number : -Infinity;
          const tb = typeof (b as unknown as Record<string, unknown>).updatedAt === "number" ? (b as unknown as Record<string, unknown>).updatedAt as number : -Infinity;
          return tb - ta; // descending: most-recently-modified first
        });
      } else {
        tasks = filtered;
      }
      // QW-007 (experiment 3, iteration 4): pagination — 20 tasks per page
      // by default. ?page=N selects the page (1-based, default 1). Applied
      // after filter+sort.
      // CB-006/CB-022 (M08-merge-recover): ?pageSize=N overrides the
      // default page size. Invalid values (0, negative, non-numeric) are
      // ignored and fall back to the default (UQ-048's CLI-side hard-error
      // behavior doesn't map cleanly onto a GET-request query param — a
      // malformed URL param silently reverting to the default, rather than
      // rendering an error page, matches this Web UI's existing convention
      // for every other filter param above, e.g. an unknown ?status= value).
      const DEFAULT_PAGE_SIZE = 20;
      const pageSizeParam = parseInt(url.searchParams.get("pageSize") || "", 10);
      const pageSizeInvalid = url.searchParams.has("pageSize") &&
        (!Number.isFinite(pageSizeParam) || pageSizeParam < 1);
      const PAGE_SIZE = Number.isFinite(pageSizeParam) && pageSizeParam >= 1
        ? pageSizeParam
        : DEFAULT_PAGE_SIZE;
      const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
      const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
      const totalTasks = tasks.length;
      const totalPages = Math.max(1, Math.ceil(totalTasks / PAGE_SIZE));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * PAGE_SIZE;
      const pageTasks = tasks.slice(offset, offset + PAGE_SIZE);
      // QW-009 (experiment 3, iteration 4): add labels column to list table.
      // QX-009 (experiment 4, iteration 2): add inline action buttons to each
      // list row. Closes CB-003: "Advance" (and any other applicable action
      // button) is now available without navigating to the task detail page.
      // Write-surface: the POST goes to the existing /task/<id>/action/<actionId>
      // endpoint (not a new write surface — same backend-agnostic composition as
      // the detail page). The action POST URL includes ?from= carrying the
      // current list URL so the redirect returns to the list with filter context
      // preserved, rather than to the task detail page.
      const currentListHref = buildHref(statusFilter, sortKey, labelFilters, safePage > 1 ? safePage : null, prefixFilter, qFilter);
      const rows = pageTasks
        .map(
          (t) => {
            const applicableButtons = ((manifest.action_buttons ?? []) as Array<{ id: string; label: string; whenStatus?: string[] }>).filter(
              (b) => !b.whenStatus || b.whenStatus.includes(t.status)
            );
            // QX-014 (iteration 3): action buttons include title= tooltip.
            // QX-019 (iteration 4): backport target-status tooltip to list page (UQ-018).
            // Compute next status per-task using the same map as the detail page.
            const listNextStatusMap: Record<string, string> = { todo: "ready", ready: "done" };
            const listNextStatus = listNextStatusMap[t.status];
            const actionCell = applicableButtons.length > 0
              ? applicableButtons.map((b) => {
                  const titleAttr = listNextStatus
                    ? `title="Advance to ${escapeHtml(listNextStatus)}"`
                    : `title="Advance task to next status"`;
                  return html`<form method="post" action="/task/${encodeURIComponent(t.id)}/action/${encodeURIComponent(b.id)}?from=${encodeURIComponent(currentListHref)}" style="display:inline">
                    <button type="submit" ${titleAttr}>${escapeHtml(b.label)}</button>
                  </form>`;
                }).join("")
              : "";
            // QX-018 (iteration 4): show updatedAt as relative time in list row.
            const updatedAt = (t as unknown as Record<string, unknown>).updatedAt;
            const updatedCell = typeof updatedAt === "number"
              ? escapeHtml(relativeTime(updatedAt))
              : "—";
            // QX-011 (iteration 3): task title link includes ?from= so the detail page
            // back link can return to the current filtered list view (UQ-009).
            return html`<tr>
            <td><a href="/task/${encodeURIComponent(t.id)}?from=${encodeURIComponent(currentListHref)}">${escapeHtml(t.id)}</a></td>
            <td>${escapeHtml(t.status)}</td>
            <td class="col-role">${escapeHtml(t.role)}</td>
            <td>${escapeHtml(t.title)}</td>
            <td class="col-labels">${escapeHtml((Array.isArray(t.labels) ? t.labels : []).join(", "))}</td>
            <td class="col-updated">${updatedCell}</td>
            <td class="col-actions">${actionCell}</td>
          </tr>`;
          }
        )
        .join("\n");
      // QW-003: filter navigation links — All, todo, ready, done, needs-human.
      // Active filter is shown as plain text; others as links.
      const statuses = ["todo", "ready", "done", "needs-human"];
      // Build query param helper: merges prefix, status, sort, label, and page params.
      // QW-007: page param added; when page=1 it is omitted from the href (clean URL).
      // QX-004: prefix param added; omitted when null/falsy (clears the prefix filter).
      // QX-016 (iteration 4): label param now supports an array (for multi-label AND-filter)
      // or a string (for single-label nav links). Array generates repeated ?label=X&label=Y.
      // QX-021 (iteration 5): q param carries the active title-search query.
      // CB-006/CB-022 (M08-merge-recover): pageSize carries the active
      // ?pageSize= override through every other nav link (filter/sort/label/
      // page/search) so switching e.g. status filter doesn't silently reset
      // page size back to the default. Defaults to the enclosing PAGE_SIZE
      // (already resolved from ?pageSize= or the default above) so every
      // EXISTING buildHref(...) call site needs no change; the page-size
      // selector links below pass an explicit override as a 7th argument.
      function buildHref(status: string | null, sort: string | null, label: string | string[] | null, pg: number | null, prefix: string | null, q: string | null, pageSizeOverride: number = PAGE_SIZE): string {
        const params = new URLSearchParams();
        if (prefix) params.set("prefix", prefix);
        if (status) params.set("status", status);
        const labels = ([] as string[]).concat(label as string[]).filter(Boolean);
        for (const l of labels) params.append("label", l);
        if (sort) params.set("sort", sort);
        if (q) params.set("q", q);
        if (pg && pg > 1) params.set("page", String(pg));
        if (pageSizeOverride !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSizeOverride));
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
          ? html`<a href="${buildHref(statusFilter, sortKey, labelFilters, null, null, qFilter)}">All</a>`
          : html`<strong>All</strong>`,
        ...allPrefixes.map((p) =>
          p === prefixFilter
            ? html`<strong>${escapeHtml(p)}</strong>`
            : html`<a href="${buildHref(statusFilter, sortKey, labelFilters, null, p, qFilter)}">${escapeHtml(p)}</a>`
        ),
      ].join(" · ") : null;
      const filterNav = [
        statusFilter
          ? html`<a href="${buildHref(null, sortKey, labelFilters, null, prefixFilter, qFilter)}">All</a>`
          : html`<strong>All</strong>`,
        ...statuses.map((s) =>
          s === statusFilter
            ? html`<strong>${escapeHtml(s)}</strong>`
            : html`<a href="${buildHref(s, sortKey, labelFilters, null, prefixFilter, qFilter)}">${escapeHtml(s)}</a>`
        ),
      ].join(" · ");
      // QW-004: sort navigation links — Default, id, status.
      // QX-008: added "Updated ↓" sort link (sort by mtime descending).
      // Active sort shown as plain text; others as links (preserving active status, label, and prefix filters).
      const sortNav = [
        !sortKey ? html`<strong>Default</strong>` : html`<a href="${buildHref(statusFilter, null, labelFilters, null, prefixFilter, qFilter)}">Default</a>`,
        sortKey === "id"
          ? html`<strong>id</strong>`
          : html`<a href="${buildHref(statusFilter, "id", labelFilters, null, prefixFilter, qFilter)}">id</a>`,
        sortKey === "status"
          ? html`<strong>status</strong>`
          : html`<a href="${buildHref(statusFilter, "status", labelFilters, null, prefixFilter, qFilter)}">status</a>`,
        sortKey === "updated"
          ? html`<strong>Updated ↓</strong>`
          : html`<a href="${buildHref(statusFilter, "updated", labelFilters, null, prefixFilter, qFilter)}">Updated ↓</a>`,
      ].join(" · ");
      // QW-005: label navigation links — All + each distinct label.
      // Only rendered when at least one task has labels.
      // QX-020 (experiment 4, iteration 5): toggle semantics — clicking a label link
      // adds the label to the current filter if not active, removes it if active.
      // Active labels are shown bold (works for multi-label state too).
      // When 2+ labels are active, an "All" / clear-all link is shown first.
      // Closes UQ-019 (significant: multi-label label-nav replaced entire filter).
      // QX-024 (experiment 4, iteration 6): truncate label nav at 25 labels.
      // When more than 25 distinct labels exist, show only the first 25 and append
      // a non-link "… N more labels" note. Closes UQ-025 (significant: flat wall
      // of 40+ labels becomes unusable at scale).
      // QX-026 (experiment 4, iteration 7): sort by frequency (most-used first),
      // then alphabetically within equal counts. Pin active filter labels to the
      // front of the visible list so they are never hidden by truncation.
      // Closes UQ-028 (alphabetic ordering hides most-used labels) and UQ-027
      // (active label hidden when it falls after position 25 alphabetically).
      const LABEL_NAV_MAX = 25;
      // QX-037 (experiment 4, iteration 10): UQ-034 — label counts scoped to current
      // status/prefix/search filters (but NOT label filter) so the (N) badge shows how
      // many tasks in the current context have each label, not the global total.
      // filteredByStatusAndSearch = prefix + status + search filters applied; label filter
      // deliberately excluded so clicking a label shows "how many tasks would match."
      const filteredByStatusAndSearch = qFilter
        ? filteredByStatus.filter((t) =>
            (t.title + " " + stripHeadings(t.body)).toLowerCase().includes(qFilter.toLowerCase())
          )
        : filteredByStatus;
      const labelCounts = new Map<string, number>();
      for (const t of filteredByStatusAndSearch) {
        for (const l of (Array.isArray(t.labels) ? t.labels : [])) {
          labelCounts.set(l, (labelCounts.get(l) || 0) + 1);
        }
      }
      // All distinct labels (from full task list for nav completeness) sorted by filter-scoped
      // frequency descending, then alphabetically.
      const allLabels = [...new Set(allTasks.flatMap((t) => Array.isArray(t.labels) ? t.labels : []))]
        .sort((a, b) => (labelCounts.get(b) || 0) - (labelCounts.get(a) || 0) || a.localeCompare(b));
      // Pin active labels that would be hidden (fall after position LABEL_NAV_MAX).
      const topLabels = allLabels.slice(0, LABEL_NAV_MAX);
      const activeHidden = labelFilters.filter((l) => !topLabels.includes(l));
      // Build the visible list: pinned-active first, then frequency-sorted rest, up to LABEL_NAV_MAX.
      const pinnedFirst = [...new Set([...activeHidden, ...allLabels])];
      const visibleLabels = pinnedFirst.slice(0, LABEL_NAV_MAX);
      // Hidden count = labels in allLabels that are NOT in visibleLabels.
      const hiddenLabelCount = allLabels.filter((l) => !visibleLabels.includes(l)).length;
      // QX-034 (experiment 4, iteration 9): UQ-032 — show task count per label;
      // UQ-033 — convert "N more labels" plain text to a details/summary expandable.
      const labelNav = allLabels.length > 0 ? [
        labelFilters.length > 0
          ? html`<a href="${buildHref(statusFilter, sortKey, null, null, prefixFilter, qFilter)}">All</a>`
          : html`<strong>All</strong>`,
        ...visibleLabels.map((l) => {
          const isActive = labelFilters.includes(l);
          // Toggle: if active, remove l from filters; if inactive, add l to filters.
          const toggledLabels = isActive
            ? labelFilters.filter((x) => x !== l)
            : [...labelFilters, l];
          // UQ-032: append (N) count after label name so users can see relative label usage.
          const countBadge = ` (${labelCounts.get(l) || 0})`;
          return isActive
            ? html`<strong>${escapeHtml(l)}${countBadge}</strong> (<a href="${buildHref(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">remove</a>)`
            : html`<a href="${buildHref(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">${escapeHtml(l)}${countBadge}</a>`;
        }),
        // UQ-033: hidden labels rendered inside a <details> expand element so users can
        // see all labels without editing the URL. Previously was non-interactive plain text.
        ...(hiddenLabelCount > 0 ? [
          html`<details style="display:inline"><summary>… ${hiddenLabelCount} more labels</summary><div style="margin:0.25rem 0">${
            allLabels.filter((l) => !visibleLabels.includes(l)).map((l) => {
              const toggledLabels = labelFilters.includes(l)
                ? labelFilters.filter((x) => x !== l)
                : [...labelFilters, l];
              const countBadge = ` (${labelCounts.get(l) || 0})`;
              return html`<a href="${buildHref(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">${escapeHtml(l)}${countBadge}</a>`;
            }).join(" · ")
          }</div></details>`,
        ] : []),
      ].join(" · ") : null;
      // QW-007: page navigation — Previous / Next links with page info.
      // QW-007: page navigation — Previous / Next links with page info.
      // Filter/sort nav links reset to page 1 (no pg param) when clicked, which is correct:
      // changing a filter changes which tasks are in view.
      // QX-004: prefix param carried through page nav links.
      const pageNav = totalPages > 1 ? html`
        <p class="meta">
          ${safePage > 1
            ? html`<a href="${buildHref(statusFilter, sortKey, labelFilters, safePage - 1, prefixFilter, qFilter)}">&laquo; Previous</a>`
            : html`<span class="page-nav-disabled">&laquo; Previous</span>`}
          &nbsp; Page ${safePage} of ${totalPages} (${totalTasks} tasks) &nbsp;
          ${safePage < totalPages
            ? html`<a href="${buildHref(statusFilter, sortKey, labelFilters, safePage + 1, prefixFilter, qFilter)}">Next &raquo;</a>`
            : html`<span class="page-nav-disabled">Next &raquo;</span>`}
        </p>` : html`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>`;
      // CB-006/CB-022 (M08-merge-recover): page-size selector — 10/20/50/100,
      // mirroring the CLI's --page-size flag and the MCP task_list pageSize
      // param (mcp-server.ts). Changing page size always resets to page 1
      // (pg=null passed to buildHref) since the prior page number may no
      // longer be meaningful at a different page size.
      const pageSizeOptions = [10, 20, 50, 100];
      const pageSizeNav = html`<p class="meta">Page size:
        ${pageSizeOptions.map((sz) =>
          sz === PAGE_SIZE
            ? html`<strong>${sz}</strong>`
            : html`<a href="${buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, qFilter, sz)}">${sz}</a>`
        ).join(" ")}
        ${pageSizeInvalid ? html`<span class="error-banner" role="alert" style="display:inline;margin-left:0.5rem">Invalid pageSize value ignored; showing default (${DEFAULT_PAGE_SIZE}).</span>` : ""}
      </p>`;
      // QN-046 (closes discussion-doc §2.1's browser-rendering gap): a real
      // browser (driven via playwright MCP tooling) decodes this body as
      // mojibake (e.g. "Quay â€" task list") without an explicit charset —
      // the bytes on the wire are correct UTF-8, but a browser with no
      // charset hint falls back to a legacy encoding. Raw-HTTP-body string
      // assertions (serve.test.mjs) never caught this because they check
      // substring presence in the raw byte buffer, not decoded/rendered
      // text. Fixed by declaring charset=utf-8 explicitly.
      // QX-013: read ?error= and ?success= params for post-action feedback banners.
      const errorParam = url.searchParams.get("error");
      const successParam = url.searchParams.get("success");
      // QX-021 (iteration 5): search form — GET form so URL is bookmarkable.
      // Carries all other active filters as hidden fields so they are preserved on submit.
      // A visible "active search" badge is rendered when qFilter is set.
      const searchBadge = qFilter
        ? html` <strong style="color:#0066cc">"${escapeHtml(qFilter)}"</strong> (<a href="${buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, null)}">clear</a>)`
        : "";
      const searchForm = html`<form method="GET" style="margin:0.5rem 0 0.75rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
        ${prefixFilter ? html`<input type="hidden" name="prefix" value="${escapeHtml(prefixFilter)}">` : ""}
        ${statusFilter ? html`<input type="hidden" name="status" value="${escapeHtml(statusFilter)}">` : ""}
        ${labelFilters.map((l) => html`<input type="hidden" name="label" value="${escapeHtml(l)}">`).join("")}
        ${sortKey ? html`<input type="hidden" name="sort" value="${escapeHtml(sortKey)}">` : ""}
        <input name="q" type="search" value="${escapeHtml(qFilter || "")}" placeholder="Search titles and descriptions…" style="padding:0.4rem 0.6rem;border:1px solid #ced4da;border-radius:4px;font-size:0.9rem;min-width:180px">
        <button type="submit" style="padding:0.4rem 0.8rem">Search</button>
        ${searchBadge}
      </form>`;
      // QX-034 (experiment 4, iteration 9): UQ-031 — when ?q= is active, show
      // "Showing N results for 'query'" to acknowledge the search is active and
      // how many results matched, without needing to count rows manually.
      //
      // QX-046 (experiment 4, iteration 12): UQ-035 — when search results span
      // multiple pages, users could not tell which page they were on or that a
      // page 2 existed from the banner alone. Add "· Page X of Y" suffix when
      // totalPages > 1 so the pagination context is visible in the banner itself,
      // not only in the page navigation links below the table.
      const searchResultBanner = qFilter
        ? html`<p class="meta" style="color:#0066cc">Showing ${totalTasks} results for &ldquo;${escapeHtml(qFilter)}&rdquo;${totalPages > 1 ? ` · Page ${safePage} of ${totalPages}` : ""}</p>`
        : "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay task list — ${escapeHtml(manifest.name)}">${pageStyles()}<title>Quay — ${escapeHtml(manifest.name)}</title></head>
        <body><main>
          <!-- QX-015 orientation banner removed by DIR-007 (iteration 10): misleading
               needs-human placement + disproportionate layout cost. -->
          <h1>Quay — task list (${escapeHtml(manifest.id)} provider)</h1>
          <p class="meta"><a href="/adr">ADRs →</a></p>
          ${errorParam ? html`<div class="error-banner" role="alert"><strong>Error:</strong> ${escapeHtml(errorParam)}</div>` : ""}
          ${successParam ? html`<div class="success-banner" role="status"><strong>Done:</strong> ${escapeHtml(successParam)}</div>` : ""}
          ${prefixNav ? html`<p class="meta">Prefix: ${prefixNav}</p>` : ""}
          <p class="meta">Filter: ${filterNav}</p>
          <p class="meta">Sort: ${sortNav}</p>
          ${searchForm}
          ${searchResultBanner}
          ${labelNav ? html`<div class="label-nav-wrap"><p class="meta" style="white-space:normal">Label: ${labelNav}</p></div>` : ""}
          ${pageSizeNav}
          ${pageNav}
          <table>
            <tr><th>id</th><th>status</th><th class="col-role">role</th><th>title</th><th class="col-labels">labels</th><th class="col-updated">updated</th><th class="col-actions">actions</th></tr>
            ${rows}
          </table>
          ${totalPages > 1 ? pageNav : ""}
        </main></body></html>`);
      return;
    }

    // ── ADR views (separate object kind — decision lifecycle, not tasks) ──
    if (url.pathname === "/adr") {
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
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${pageStyles()}<title>ADRs</title></head>
        <body><main>
          <p class="meta"><a href="/">← tasks</a></p>
          <h1>ADRs (${adrs.length})</h1>
          ${adrs.length === 0 ? html`<p class="meta">No ADRs.</p>` : html`<table>
            <tr><th>id</th><th>status</th><th>date</th><th>title</th></tr>
            ${rows}
          </table>`}
        </main></body></html>`);
      return;
    }

    const adrM = /^\/adr\/([^/]+)$/.exec(url.pathname);
    if (adrM) {
      const id = decodeURIComponent(adrM[1]);
      const a = await client.adrGet(id);
      if (!a) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const adrExt = a as unknown as Record<string, unknown>;
      const link = (x: string) => html`<a href="/adr/${encodeURIComponent(x)}">${escapeHtml(x)}</a>`;
      const supersedesMeta = (adrExt.supersedes && (adrExt.supersedes as string[]).length)
        ? html`<p class="meta">supersedes: ${(adrExt.supersedes as string[]).map(link).join(" · ")}</p>` : "";
      const supersededByMeta = (adrExt.supersededBy && (adrExt.supersededBy as string[]).length)
        ? html`<p class="meta">superseded by: ${(adrExt.supersededBy as string[]).map(link).join(" · ")}</p>` : "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(a.id)}: ${escapeHtml(a.title)}">${pageStyles()}<title>${escapeHtml(a.id)}</title></head>
        <body><main>
          <p class="meta"><a href="/adr">← ADRs</a></p>
          <h1>${escapeHtml(a.id)}: ${escapeHtml(a.title)}</h1>
          <p class="meta">status: <strong>${escapeHtml(a.status)}</strong>${adrExt.date ? ` · ${escapeHtml(adrExt.date as string)}` : ""}</p>
          ${supersedesMeta}${supersededByMeta}
          <article>${renderMarkdown(a.body || "")}</article>
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
      // QX-011 (iteration 3): read ?from= param to restore the back link's
      // filter context (UQ-009). Guard against open redirect (must start with /,
      // not // or \ or a control-char-prefixed variant -- see
      // isSafeRelativeRedirect()'s own doc comment, ADV-003).
      const fromParam = url.searchParams.get("from");
      const backHref = isSafeRelativeRedirect(fromParam) ? fromParam as string : "/";
      // QX-013 (iteration 3): read ?error= and ?success= for post-action feedback.
      const detailErrorParam = url.searchParams.get("error");
      const detailSuccessParam = url.searchParams.get("success");
      // QX-014 (iteration 3): compute target status for tooltip on detail page.
      const nextStatusMap: Record<string, string> = { todo: "ready", ready: "done" };
      const buttons = ((manifest.action_buttons ?? []) as Array<{ id: string; label: string; whenStatus?: string[] }>)
        .filter((b) => !b.whenStatus || b.whenStatus.includes(t.status))
        .map((b) => {
          const nextStatus = nextStatusMap[t.status];
          const titleAttr = nextStatus
            ? `title="Advance to ${escapeHtml(nextStatus)}"`
            : `title="Advance task to next status"`;
          return html`<form method="post" action="/task/${encodeURIComponent(t.id)}/action/${encodeURIComponent(b.id)}" style="display:inline">
            <button type="submit" ${titleAttr}>${escapeHtml(b.label)}</button>
          </form>`;
        })
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
      const tExt = t as unknown as Record<string, unknown>;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(t.id)}: ${escapeHtml(t.title)}">${pageStyles()}<title>${escapeHtml(t.id)}</title></head>
        <body><main>
          <!-- QX-011: back link uses ?from= param to restore filter context (UQ-009) -->
          <nav><a href="${escapeHtml(backHref)}">&larr; back to list</a></nav>
          <h1>${escapeHtml(t.id)}: ${escapeHtml(t.title)} [${escapeHtml(t.status)}]</h1>
          ${detailErrorParam ? html`<div class="error-banner" role="alert"><strong>Error:</strong> ${escapeHtml(detailErrorParam)}</div>` : ""}
          ${detailSuccessParam ? html`<div class="success-banner" role="status"><strong>Done:</strong> ${escapeHtml(detailSuccessParam)}</div>` : ""}
          <p class="meta">role: ${escapeHtml(t.role)} · labels: ${escapeHtml((t.labels || []).join(", "))}${parentMeta}</p>
          ${typeof tExt.updatedAt === "number" ? html`<p class="meta">last updated: ${escapeHtml(relativeTime(tExt.updatedAt as number))}</p>` : ""}
          ${childrenMeta}
          <div>${buttons}</div>
          ${t.status === "needs-human" && buttons.length > 0
            ? html`<div class="info-banner" role="note">This task needs human attention. Use the action buttons above to advance or resolve it.</div>`
            : ""}
          <h2 class="sr-only">Details</h2>
          <div class="body">${renderMarkdown(t.body)}</div>
        </main></body></html>`);
      return;
    }

    const am = /^\/task\/([^/]+)\/action\/([^/]+)$/.exec(url.pathname);
    if (am && req.method === "POST") {
      const [, id, actionId] = am;
      const { composePayload, deliverTrigger } = await import("./action.ts");
      const decodedId = decodeURIComponent(id);
      const t = await client.taskGet(decodedId);
      // QX-009 (experiment 4, iteration 2): read ?from= param for list-context redirect.
      // M26-adversarial-eval finding ADV-003/M26-F3 (both iterations independently found
      // this): this guard previously checked ONLY fromParam.startsWith("/") -- missing the
      // !startsWith("//") protocol-relative-URL guard the GET /task/<id> detail route's own
      // ?from= handling already has (QX-011/SH-002, see backHref above). Now uses the same
      // shared isSafeRelativeRedirect() helper as backHref above, which also closes the
      // backslash/control-char bypass variants the plain startsWith("//") check would miss
      // (see that helper's doc comment).
      // Live-exploitability note (iteration-1's independent finding, verified correct):
      // `baseRedirect` here is never used directly as a Location header value -- both call
      // sites below route it through addParam(), which always builds a `new URL(urlPath,
      // "http://x")` and returns only `.pathname + "?" + ...`, stripping any scheme/host.
      // That means a `//evil.com`-style bypass value is already neutralized end-to-end on
      // THIS route regardless of this guard (verified: `new URL("//evil.com", "http://x")`
      // resolves to the `evil.com` origin with pathname "/", which addParam then discards,
      // yielding a same-origin path). So this specific fix is defense-in-depth /
      // guard-consistency with the GET route (which does use its guarded value more
      // directly, via backHref, rendered straight into an href attribute) -- not a
      // confirmed live open-redirect on the POST route itself.
      const fromParam = url.searchParams.get("from");
      const baseRedirect = isSafeRelativeRedirect(fromParam) ? fromParam as string : `/task/${t.id}`;
      // QX-013 (experiment 4, iteration 3): gate-check BEFORE delivering the trigger.
      // If gate is blocked (ok: false), redirect back with ?error= instead of silently
      // delivering. Closes UQ-013 (silent gate-fail feedback). The gate check uses the
      // same client.taskCheck() the CLI/MCP 'quay task check' uses — no new API surface.
      const gateResult = await client.taskCheck(decodedId) as { ok: boolean; reason?: string };
      if (!gateResult.ok) {
        const errorMsg = gateResult.reason
          ? `Gate check failed: ${gateResult.reason}`
          : "Gate check failed: task not ready to advance";
        const errorRedirect = addParam(baseRedirect, "error", errorMsg);
        res.writeHead(302, { Location: errorRedirect });
        res.end();
        console.log(`[quay serve] action ${actionId} on ${decodedId}: gate blocked — ${errorMsg}`);
        return;
      }
      const payloadObj = composePayload({ providerManifest: manifest, task: t, actionId: decodeURIComponent(actionId) });
      // QN-042 (DIR-009): QUAY_ACTION_MOCK_LOG opts into the deterministic
      // mock/file-log delivery mode instead of manda/print — see
      // src/action.ts#deliverTrigger's own doc comment.
      const mockLogPath = process.env.QUAY_ACTION_MOCK_LOG || undefined;
      const result = await deliverTrigger({
        root: cfg.workspaceRoot,
        channel: `task-${t.id}`,
        payloadObj,
        mockLogPath,
      }) as { delivered: string };
      // QX-013 (iteration 3): on success, redirect with ?success= for feedback.
      // G-S4-01 (M33-webui-trigger-honesty, M28 Scenario 4 finding): the banner
      // text MUST be conditioned on result.delivered, not a hardcoded
      // "advanced" claim. None of deliverTrigger()'s three modes perform a
      // synchronous task-status write (confirmed by reading action.ts's
      // deliverTrigger() in full — "mock" appends a JSON-lines test record,
      // "manda" fires an async, fire-and-forget dispatch with no delivery-
      // confirmation callback, "print" only logs to stdout) — so no mode may
      // claim "advanced"/"done" wording. "print" and "manda" use "requested"-
      // flavored language per AC 2; "mock" gets its own honest, non-"advanced"
      // label since it is a test-only recording mode, not a production claim.
      const successMsg = ({
        print: `Task ${t.id}: advance requested (no live dispatcher configured — run the printed command to complete it)`,
        manda: `Task ${t.id}: advance requested (dispatched to manda, delivery not confirmed)`,
        mock: `Task ${t.id}: advance recorded (mock delivery mode)`,
      } as Record<string, string>)[result.delivered] || `Task ${t.id}: advance requested`;
      const successRedirect = addParam(baseRedirect, "success", successMsg);
      res.writeHead(302, { Location: successRedirect });
      res.end();
      console.log(`[quay serve] action ${actionId} on ${decodedId}:`, result);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }

  // QX-038 (experiment 4, iteration 11): DIR-005 item 5 — bind explicitly to 0.0.0.0
  // (all interfaces) instead of relying on Node's implicit default, and update the log
  // line to reflect the actual binding. Previously `server.listen(port)` with no host
  // bound all interfaces (0.0.0.0) by default, but the log line claimed `localhost`,
  // misleading the G7 precondition check ("reachable on 0.0.0.0, not localhost-only")
  // into reading it as a localhost-only binding when it was not.
  server.listen(port, "0.0.0.0", () => {
    console.log(`quay serve: listening on http://0.0.0.0:${port} (all interfaces)`);
  });

  // QN-031 (iteration 21): expose the underlying provider client so a caller
  // (notably an automated test) can shut down the MCP child process cleanly
  // instead of leaving it running after http.Server.close(). This is a pure
  // addition (a new property on the returned object) — no existing caller's
  // behavior changes, since nothing previously read `server.client`.
  (server as Server & { client: ProviderClient }).client = client;
  return server as Server & { client: ProviderClient };
}
