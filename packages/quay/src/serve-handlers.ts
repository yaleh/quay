// serve-handlers.ts — extracted route handlers and rendering helpers for quay serve.
// Companion to serve.ts (M100 refactor: startServer god-function decomposition).
//
// IMPORTANT: This file MUST NOT import from ./serve.ts (would create circular import).
// All shared rendering helpers live here; serve.ts imports them from here.

import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ProviderClient } from "./provider-client.ts";
import { readLive, readJournal, readBoardLanding, readBoardExecution, readGitHistory, type LiveResult, type JournalResult, type JournalSection, type BoardLanding, type BoardExecution, type GitHistoryCommit, type GitHistoryResult } from "./observation.ts";
import { createGoalStore } from "./goal-store.ts";
import { createDocumentStore } from "./document-store.ts";
// live-state discriminator texts (gap-live-cannot-tell-a-dead-loop-from-an-unwired-one) — the
// two telemetry-empty states must have DIFFERENT copy AND a next-step action, and never collapse
// back to the generic 「无数据」.
export const LIVE_STATE_RUNNING_UNWIRED_LABEL = "在跑但未接遥测";
export const LIVE_STATE_NOT_RUNNING_LABEL = "未在运行";

// ── Rendering helpers (moved from serve.ts) ──────────────────────────────────

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc: string, s: string, i: number) => acc + s + (values[i] ?? ""), "");
}

export function escapeHtml(s: unknown): string {
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
export function stripHeadings(text: string | undefined | null): string {
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
export function pageStyles(): string {
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
.malformed-row td { background: #fff8e6; color: #8a6d3b; font-weight: 600; }
.malformed-row a { color: #8a6d3b; }
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
     id, status, title fit in the visible viewport at 375px.
     Closes UQ-012 (role/labels columns crowd out title). */
  .col-role, .col-labels { display: none; }
  /* QX-017 (experiment 4, iteration 4): hide the updated column at mobile to
     reduce clutter. (The sticky .col-actions rule that once lived here was
     removed with the web action-buttons route — gap-web-action-buttons-unused-
     route-and-open-redirect-delete.) */
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
export function renderMarkdown(text: string | undefined | null): string {
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
export function inlineMarkdown(text: string): string {
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
export function relativeTime(ts: number): string {
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
// !startsWith("//"); the web action-buttons POST route's baseRedirect had
// only startsWith("/"), a real bypass closed by ADV-003 above — that POST
// route was later REMOVED wholesale by
// gap-web-action-buttons-unused-route-and-open-redirect-delete, so only the
// GET route's backHref uses this helper today). Also closes two further real
// bypasses the audit found neither inline check caught: a
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
export function isSafeRelativeRedirect(v: string | null): boolean {
  if (!v || typeof v !== "string") return false;
  if (!v.startsWith("/")) return false;
  const second = v.charCodeAt(1);
  if (Number.isNaN(second)) return true; // v === "/" exactly
  if (second === 0x2f /* / */ || second === 0x5c /* \ */) return false;
  if (second <= 0x1f || second === 0x7f) return false; // C0 control chars incl. \t, \0
  return true;
}

// ── Utility functions (moved/extracted from startServer closures) ─────────────

// CB-006/CB-022 (M08-merge-recover): pagination constants moved here so
// serve-handlers.ts can use them in buildHref without circular import.
export const DEFAULT_PAGE_SIZE = 20;

// Build query param helper: merges prefix, status, sort, label, page, and q params.
// Previously a closure inside GET / handler that closed over PAGE_SIZE and
// DEFAULT_PAGE_SIZE; now module-level with explicit pageSizeOverride and
// defaultPageSize args.
export function buildHref(
  status: string | null,
  sort: string | null,
  label: string | string[] | null,
  pg: number | null,
  prefix: string | null,
  q: string | null,
  pageSizeOverride: number,
  defaultPageSize: number,
): string {
  const params = new URLSearchParams();
  if (prefix) params.set("prefix", prefix);
  if (status) params.set("status", status);
  const labels = ([] as string[]).concat(label as string[]).filter(Boolean);
  for (const l of labels) params.append("label", l);
  if (sort) params.set("sort", sort);
  if (q) params.set("q", q);
  if (pg && pg > 1) params.set("page", String(pg));
  if (pageSizeOverride !== defaultPageSize) params.set("pageSize", String(pageSizeOverride));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

// ── Route handlers ────────────────────────────────────────────────────────────

type Manifest = Awaited<ReturnType<ProviderClient["manifest"]>>;

// gap-serve-task-list-dies-on-one-malformed-task: a task is "missing-id" when
// the provider surfaced no usable id (id absent or not a non-empty string) OR
// explicitly marked it malformed. quay-native falls back to the filename for
// the id and sets extra.malformed=["missing-id"] — fallback is NOT a fix, and
// the list page must surface it VISIBLY rather than crash (a single malformed
// task must never 500 the whole board — 3/588 = 0.5% malformed data took down
// 100% of the only graphical UI) and rather than silently dropping it (a
// silent drop would make "3 bad tasks" indistinguishable from "585 good tasks").
export function isMissingIdTask(t: { id?: unknown; title?: unknown; extra?: Record<string, unknown> }): boolean {
  return typeof t.id !== "string" || t.id.length === 0 ||
    (Array.isArray(t.extra?.malformed) && (t.extra!.malformed as string[]).includes("missing-id"));
}

export async function handleTaskList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
  manifest: Manifest,
): Promise<void> {
  // gap-one-unparseable-task-takes-down-the-whole-board: the Provider's
  // task_list now returns PARTIAL success — the parseable tasks plus a
  // machine-readable `malformed` list ({file, error}) for the files whose
  // frontmatter failed to parse. A bad task must poison exactly its own row,
  // not the whole board: the malformed entries are rendered as visible
  // `.malformed-row` placeholder rows below, and the good tasks list normally.
  // gap-task-list-route-is-linear-in-task-count: the list page renders only
  // frontmatter fields (id/title/status/labels/role/children/updatedAt) — it
  // does NOT render task bodies. The Provider ABI task_list accepts an
  // optional `includeBody` (default true = full tasks, backward compatible).
  // Passing false when no ?q= search is active shrinks the MCP round-trip
  // payload from ~5.7MB (all 619 task bodies) to ~0.3MB (frontmatter only) —
  // the dominant cost of the "MCP round-trip + rendering" half of this route.
  // When ?q= IS active, body search needs the bodies, so we request them.
  // (The qFilter read is duplicated below where it drives filtering; reading
  // the URLSearchParams twice is cheap and keeps the two uses independent.)
  const qFilter = url.searchParams.get("q") || null;
  const { tasks: allTasks, malformed } = await client.taskList({ includeBody: qFilter ? true : false });
  // QX-004 (experiment 4, iteration 1): filter by ?prefix=<value> query param.
  // Closes CB-002: "show only QX-* tasks" affordance in Web UI.
  // Applied FIRST, before status/label filters — prefix scopes the whole view.
  // No param → all tasks; unknown prefix → empty list (not an error).
  const prefixFilter = url.searchParams.get("prefix");
  // gap-serve-task-list-dies-on-one-malformed-task: guard the prefix filter
  // against a task with no usable id (`t.id.toUpperCase()` was a second
  // same-class crash vector alongside the allPrefixes `indexOf` below).
  const filteredByPrefix = prefixFilter
    ? allTasks.filter((t) => typeof t.id === "string" && t.id.toUpperCase().startsWith(prefixFilter.toUpperCase()))
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
  // NOTE: qFilter is read above (before the taskList call) so the route can
  // request bodies only when body search needs them — this read drives filtering.
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
  // gap-serve-task-list-dies-on-one-malformed-task: normalize possibly-missing
  // id/status to "" in the sort comparators so a malformed task sorts
  // deterministically (undefined < comparisons never threw, but made ordering
  // non-deterministic for missing-id tasks).
  if (sortKey === "id") {
    tasks = filtered.slice().sort((a, b) => {
      const ia = String(a.id ?? "");
      const ib = String(b.id ?? "");
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
  } else if (sortKey === "status") {
    tasks = filtered.slice().sort((a, b) => {
      const sa = String(a.status ?? "");
      const sb = String(b.status ?? "");
      if (sa !== sb) return sa < sb ? -1 : sa > sb ? 1 : 0;
      const ia = String(a.id ?? "");
      const ib = String(b.id ?? "");
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
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

  // Convenience wrapper that fills in PAGE_SIZE and DEFAULT_PAGE_SIZE for callers
  // that don't need to override them (all call sites within this handler).
  function bh(status: string | null, sort: string | null, label: string | string[] | null, pg: number | null, prefix: string | null, q: string | null, pageSizeOverride: number = PAGE_SIZE): string {
    return buildHref(status, sort, label, pg, prefix, q, pageSizeOverride, DEFAULT_PAGE_SIZE);
  }

  // QW-009 (experiment 3, iteration 4): add labels column to list table.
  const currentListHref = bh(statusFilter, sortKey, labelFilters, safePage > 1 ? safePage : null, prefixFilter, qFilter);
  const rows = pageTasks
    .map(
      (t) => {
        // gap-serve-task-list-dies-on-one-malformed-task: a task with no usable
        // id (or explicitly flagged missing-id by the provider) renders as a
        // VISIBLE placeholder row — never a 500 (a single malformed task must
        // not take down the whole board) and never a silent drop (a silent drop
        // would make "3 bad tasks" indistinguishable from "585 good tasks").
        if (isMissingIdTask(t)) {
          const display = (typeof t.id === "string" && t.id.length > 0)
            ? t.id
            : (typeof t.title === "string" && t.title.length > 0 ? t.title : "unknown task");
          const idCell = (typeof t.id === "string" && t.id.length > 0)
            ? html`<a href="/task/${encodeURIComponent(t.id)}">${escapeHtml(t.id)}</a>`
            : escapeHtml(display);
          return html`<tr class="malformed-row">
            <td colspan="6">⚠ ${idCell} — 缺少 id 字段</td>
          </tr>`;
        }
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
      </tr>`;
      }
    )
    .join("\n");
  // gap-one-unparseable-task-takes-down-the-whole-board: render the Provider's
  // machine-readable parse-failure list as VISIBLE placeholder rows, reusing
  // the same `.malformed-row` style and colspan shape as the existing
  // missing-id placeholder (no second bespoke style). These rows are always
  // shown regardless of filter/pagination — an unparseable file has no id,
  // title, status or labels to filter by, and hiding it would recreate the
  // "0 tasks and no error" failure this whole mechanism exists to prevent.
  const malformedRows = malformed
    .map((m) => html`<tr class="malformed-row">
      <td colspan="6">⚠ <code>${escapeHtml(m.file)}</code> — 解析失败: ${escapeHtml(m.error)}</td>
    </tr>`)
    .join("\n");
  // QW-003: filter navigation links — All, todo, ready, done, needs-human, superseded.
  // Active filter is shown as plain text; others as links.
  const statuses = ["todo", "ready", "done", "needs-human", "superseded"];
  // QX-004: prefix navigation links — All + each distinct task-id prefix.
  // A "prefix" is the part of a task id before the first `-` (e.g. "QX" from "QX-001").
  // Only rendered when 2+ distinct prefixes exist across ALL tasks (single-experiment
  // workspaces need no clutter). Placed FIRST in the nav, before status/sort/label.
  // gap-serve-task-list-dies-on-one-malformed-task: skip tasks with no usable
  // id when computing prefixes — `t.id.indexOf("-")` was THE 500 crash site
  // (undefined.indexOf → TypeError). A missing-id task is still rendered as a
  // placeholder row above; it just must not contribute a prefix (and never an
  // "undefined" pseudo-prefix) to the nav.
  const allPrefixes = [...new Set(allTasks
    .filter((t) => typeof t.id === "string" && t.id.length > 0)
    .map((t) => {
      const dash = t.id.indexOf("-");
      return dash > 0 ? t.id.slice(0, dash) : t.id;
    }))].sort();
  const prefixNav = allPrefixes.length >= 2 ? [
    prefixFilter
      ? html`<a href="${bh(statusFilter, sortKey, labelFilters, null, null, qFilter)}">All</a>`
      : html`<strong>All</strong>`,
    ...allPrefixes.map((p) =>
      p === prefixFilter
        ? html`<strong>${escapeHtml(p)}</strong>`
        : html`<a href="${bh(statusFilter, sortKey, labelFilters, null, p, qFilter)}">${escapeHtml(p)}</a>`
    ),
  ].join(" · ") : null;
  const filterNav = [
    statusFilter
      ? html`<a href="${bh(null, sortKey, labelFilters, null, prefixFilter, qFilter)}">All</a>`
      : html`<strong>All</strong>`,
    ...statuses.map((s) =>
      s === statusFilter
        ? html`<strong>${escapeHtml(s)}</strong>`
        : html`<a href="${bh(s, sortKey, labelFilters, null, prefixFilter, qFilter)}">${escapeHtml(s)}</a>`
    ),
  ].join(" · ");
  // QW-004: sort navigation links — Default, id, status.
  // QX-008: added "Updated ↓" sort link (sort by mtime descending).
  // Active sort shown as plain text; others as links (preserving active status, label, and prefix filters).
  const sortNav = [
    !sortKey ? html`<strong>Default</strong>` : html`<a href="${bh(statusFilter, null, labelFilters, null, prefixFilter, qFilter)}">Default</a>`,
    sortKey === "id"
      ? html`<strong>id</strong>`
      : html`<a href="${bh(statusFilter, "id", labelFilters, null, prefixFilter, qFilter)}">id</a>`,
    sortKey === "status"
      ? html`<strong>status</strong>`
      : html`<a href="${bh(statusFilter, "status", labelFilters, null, prefixFilter, qFilter)}">status</a>`,
    sortKey === "updated"
      ? html`<strong>Updated ↓</strong>`
      : html`<a href="${bh(statusFilter, "updated", labelFilters, null, prefixFilter, qFilter)}">Updated ↓</a>`,
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
      ? html`<a href="${bh(statusFilter, sortKey, null, null, prefixFilter, qFilter)}">All</a>`
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
        ? html`<strong>${escapeHtml(l)}${countBadge}</strong> (<a href="${bh(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">remove</a>)`
        : html`<a href="${bh(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">${escapeHtml(l)}${countBadge}</a>`;
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
          return html`<a href="${bh(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">${escapeHtml(l)}${countBadge}</a>`;
        }).join(" · ")
      }</div></details>`,
    ] : []),
  ].join(" · ") : null;
  // QW-007: page navigation — Previous / Next links with page info.
  // Filter/sort nav links reset to page 1 (no pg param) when clicked, which is correct:
  // changing a filter changes which tasks are in view.
  // QX-004: prefix param carried through page nav links.
  const pageNav = totalPages > 1 ? html`
    <p class="meta">
      ${safePage > 1
        ? html`<a href="${bh(statusFilter, sortKey, labelFilters, safePage - 1, prefixFilter, qFilter)}">&laquo; Previous</a>`
        : html`<span class="page-nav-disabled">&laquo; Previous</span>`}
      &nbsp; Page ${safePage} of ${totalPages} (${totalTasks} tasks) &nbsp;
      ${safePage < totalPages
        ? html`<a href="${bh(statusFilter, sortKey, labelFilters, safePage + 1, prefixFilter, qFilter)}">Next &raquo;</a>`
        : html`<span class="page-nav-disabled">Next &raquo;</span>`}
    </p>` : html`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>`;
  // CB-006/CB-022 (M08-merge-recover): page-size selector — 10/20/50/100,
  // mirroring the CLI's --page-size flag and the MCP task_list pageSize
  // param (mcp-server.ts). Changing page size always resets to page 1
  // (pg=null passed to bh) since the prior page number may no
  // longer be meaningful at a different page size.
  const pageSizeOptions = [10, 20, 50, 100];
  const pageSizeNav = html`<p class="meta">Page size:
    ${pageSizeOptions.map((sz) =>
      sz === PAGE_SIZE
        ? html`<strong>${sz}</strong>`
        : html`<a href="${bh(statusFilter, sortKey, labelFilters, null, prefixFilter, qFilter, sz)}">${sz}</a>`
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
    ? html` <strong style="color:#0066cc">"${escapeHtml(qFilter)}"</strong> (<a href="${bh(statusFilter, sortKey, labelFilters, null, prefixFilter, null)}">clear</a>)`
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
      <p class="meta"><a href="/live">live</a> · <a href="/journal">journal</a> · <a href="/git-history">git-history</a> · <a href="/adr">ADRs →</a> · <a href="/goal">goals →</a> · <a href="/doc">docs →</a></p>
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
        <tr><th>id</th><th>status</th><th class="col-role">role</th><th>title</th><th class="col-labels">labels</th><th class="col-updated">updated</th></tr>
        ${malformedRows}
        ${rows}
      </table>
      ${totalPages > 1 ? pageNav : ""}
    </main></body></html>`);
}

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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${pageStyles()}<title>ADRs</title></head>
    <body><main>
      <p class="meta"><a href="/">← tasks</a> · <a href="/live">live</a> · <a href="/journal">journal</a></p>
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
  const a = await client.adrGet(adrId);
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
      <p class="meta"><a href="/adr">← ADRs</a> · <a href="/live">live</a> · <a href="/journal">journal</a></p>
      <h1>${escapeHtml(a.id)}: ${escapeHtml(a.title)}</h1>
      <p class="meta">status: <strong>${escapeHtml(a.status)}</strong>${adrExt.date ? ` · ${escapeHtml(adrExt.date as string)}` : ""}</p>
      ${supersedesMeta}${supersededByMeta}
      <article>${renderMarkdown(a.body || "")}</article>
    </main></body></html>`);
}

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
  const vColored = verdict === "pass"
    ? `<strong style="color:#1a7f37">pass</strong>`
    : `<strong style="color:#cf222e">${escapeHtml(verdict || "unknown")}</strong>`;
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
      <td>${escapeHtml(String(g.phase ?? ""))}</td>
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
    ...["phase", "criterion"].map((k) =>
      k === kindFilter
        ? html`<strong>${k}</strong>`
        : html`<a href="/goal?kind=${k}">${k}</a>`
    ),
  ].join(" · ");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${pageStyles()}<title>Goals</title></head>
    <body><main>
      <p class="meta"><a href="/">← tasks</a> · <a href="/live">live</a> · <a href="/journal">journal</a> · <a href="/adr">ADRs →</a> · <a href="/doc">docs →</a></p>
      <h1>Goals — 阶段目标与 AC (${goals.length})</h1>
      ${readError ? html`<div class="error-banner" role="alert"><strong>读失败:</strong> ${escapeHtml(readError)}</div>` : ""}
      <p class="meta">Kind: ${kindNav}</p>
      <p class="meta">Status: ${statusNav}</p>
      ${goals.length === 0 ? html`<p class="meta">No goals.</p>` : html`<table>
        <tr><th>id</th><th>kind</th><th>status</th><th>phase</th><th>title</th><th>criterion</th><th>recent verdict</th><th>origin</th></tr>
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}">${pageStyles()}<title>${escapeHtml(String(g.id))}</title></head>
    <body><main>
      <p class="meta"><a href="/goal">← goals</a> · <a href="/live">live</a> · <a href="/journal">journal</a></p>
      <h1>${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}</h1>
      <p class="meta">kind: <strong>${escapeHtml(String(g.kind ?? ""))}</strong> · status: <strong>${escapeHtml(String(g.status ?? ""))}</strong>${g.phase ? html` · phase: ${escapeHtml(String(g.phase))}` : ""}</p>
      ${evidenceCell !== "—" ? html`<p class="meta">最近 verdict: ${evidenceCell}</p>` : ""}
      ${typeof ext.criterion === "string" && (ext.criterion as string).length > 0
        ? html`<p class="meta">criterion: <code>${escapeHtml(ext.criterion as string)}</code></p>` : ""}
      ${ext.expect ? html`<p class="meta">expect: ${escapeHtml(String(ext.expect))}</p>` : ""}
      <p class="meta">origin: ${escapeHtml(String(ext.origin ?? ""))}</p>
      <article>${renderMarkdown(g.body || "")}</article>
    </main></body></html>`);
}

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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${pageStyles()}<title>Docs</title></head>
    <body><main>
      <p class="meta"><a href="/">← tasks</a> · <a href="/live">live</a> · <a href="/journal">journal</a> · <a href="/adr">ADRs →</a> · <a href="/goal">goals →</a></p>
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(String(d.id))}: ${escapeHtml(String(d.title))}">${pageStyles()}<title>${escapeHtml(String(d.id))}</title></head>
    <body><main>
      <p class="meta"><a href="/doc">← docs</a> · <a href="/live">live</a> · <a href="/journal">journal</a></p>
      <h1>${escapeHtml(String(d.id))}: ${escapeHtml(String(d.title))}</h1>
      <p class="meta">status: <strong>${escapeHtml(String(d.status ?? ""))}</strong>${ext.kind ? ` · kind: ${escapeHtml(String(ext.kind))}` : ""}</p>
      <article>${renderMarkdown(d.body || "")}</article>
    </main></body></html>`);
}

export async function handleTaskDetail(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  taskId: string,
  client: ProviderClient,
): Promise<void> {
  const t = await client.taskGet(taskId);
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
  // QX-013 (iteration 3): read ?error= and ?success= for read-only display of
  // gate/action feedback query params. (The web action-buttons POST route that
  // originally produced these params was removed — gap-web-action-buttons-unused-
  // route-and-open-redirect-delete — but the read-only banners are kept as a
  // display surface, AC5.)
  const detailErrorParam = url.searchParams.get("error");
  const detailSuccessParam = url.searchParams.get("success");
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
      <nav><a href="${escapeHtml(backHref)}">&larr; back to list</a> · <a href="/live">live</a> · <a href="/journal">journal</a></nav>
      <h1>${escapeHtml(t.id)}: ${escapeHtml(t.title)} [${escapeHtml(t.status)}]</h1>
      ${detailErrorParam ? html`<div class="error-banner" role="alert"><strong>Error:</strong> ${escapeHtml(detailErrorParam)}</div>` : ""}
      ${detailSuccessParam ? html`<div class="success-banner" role="status"><strong>Done:</strong> ${escapeHtml(detailSuccessParam)}</div>` : ""}
      <p class="meta">role: ${escapeHtml(t.role)} · labels: ${escapeHtml((t.labels || []).join(", "))}${parentMeta}</p>
      ${typeof tExt.updatedAt === "number" ? html`<p class="meta">last updated: ${escapeHtml(relativeTime(tExt.updatedAt as number))}</p>` : ""}
      ${childrenMeta}
      <h2 class="sr-only">Details</h2>
      <div class="body">${renderMarkdown(t.body)}</div>
    </main></body></html>`);
}

// ── Loop-observation routes (gap-web-cannot-show-what-the-loop-is-doing-now) ────────────────
// /live + /journal render the loop's live state from workspace observation files. The data
// access is quarantined in observation.ts; these handlers only render what it returns. Each
// handler is wrapped defensively so ANY unexpected throw degrades to a 200 page with an error
// note (never a 500) — the hard degradation contract of this task.

function renderSectionBlock(s: JournalSection, title: string): string {
  if (s.status === "ok") {
    if (s.markdown && s.markdown.trim()) {
      return html`<h2>${title}</h2><div class="body">${renderMarkdown(s.markdown)}</div>`;
    }
    // Source exists and is readable, but has no recent content — distinct from both 无数据
    // (source absent) and 读失败 (source unreadable).
    return html`<h2>${title}</h2><p class="meta">暂无内容。</p>`;
  }
  if (s.status === "empty") {
    return html`<h2>${title}</h2><p class="meta"><strong>无数据</strong> — ${escapeHtml(s.reason || "")}</p>`;
  }
  return html`<h2>${title}</h2><p class="meta"><strong>读失败</strong> — ${escapeHtml(s.reason || "")}</p>`;
}

function renderLivePage(live: LiveResult): string {
  const rows = live.inFlight.length > 0 ? html`<table>
    <tr><th>task id</th><th>run id</th><th>started</th><th>elapsed</th></tr>
    ${live.inFlight.map((t) => html`<tr>
      <td><a href="/task/${encodeURIComponent(t.taskId)}">${escapeHtml(t.taskId)}</a></td>
      <td>${escapeHtml(t.runId)}</td>
      <td>${escapeHtml(relativeTime(t.startedAtMs))}</td>
      <td>${escapeHtml(t.minutes.toFixed(1))} 分钟</td>
    </tr>`).join("\n")}
  </table>` : "";

  // gap-live-cannot-tell-a-dead-loop-from-an-unwired-one: telemetry-empty no longer renders one
  // generic 「无数据」 — it renders one of TWO states decided by activity signals, each with the
  // judgment evidence (which signal present/absent) and a next-step action. The machine key
  // (`live_state=…`) is emitted in-band so `curl /live | grep live_state` is the contract measure.
  // A telemetry READ FAILURE still renders 「读失败」 and nothing else (AC4: no regression — the
  // two empty-state texts must never mask an unreadable store).
  let statusNote = "";
  if (live.status === "error") {
    statusNote = html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(live.reason || "")}</p>`;
  } else if (live.liveState === "running-unwired") {
    statusNote = html`<div class="info-banner" role="status">
      <p><strong>${LIVE_STATE_RUNNING_UNWIRED_LABEL}</strong> <code>live_state=running-unwired</code></p>
      <p>${escapeHtml(live.liveExplanation || "")}</p>
      <p>下一步：检查目标项目的循环是否调用 <code>--task-start</code>/<code>--task-end</code>。</p>
    </div>`;
  } else if (live.liveState === "not-running") {
    statusNote = html`<div class="error-banner" role="alert">
      <p><strong>${LIVE_STATE_NOT_RUNNING_LABEL}</strong> <code>live_state=not-running</code></p>
      <p>${escapeHtml(live.liveExplanation || "")}</p>
      <p>下一步：检查会话/cron 是否启动。</p>
    </div>`;
  }

  const summary = live.status === "ok"
    ? html`<p class="meta"><code>live_state=running</code> · 并发数: ${live.concurrency} · 在飞: ${live.inFlight.length}${live.cpuPressure != null
        ? html` · CPU 压力 (some avg10): ${escapeHtml(live.cpuPressure.toFixed(2))}`
        : ""}</p>`
    : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay live — what the loop is doing right now">${pageStyles()}<title>Live — loop activity</title></head>
    <body><main>
      <p class="meta"><a href="/">← tasks</a> · <a href="/live">live</a> · <a href="/journal">journal</a> · <a href="/adr">ADRs →</a></p>
      <h1>Live — 循环此刻在做什么</h1>
      ${statusNote}
      ${summary}
      ${live.status === "ok" && live.inFlight.length === 0 ? html`<p class="meta">当前无在飞任务。</p>` : rows}
    </main></body></html>`;
}

function renderJournalPage(journal: JournalResult): string {
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay journal — recent loop record">${pageStyles()}<title>Journal — recent loop record</title></head>
    <body><main>
      <p class="meta"><a href="/">← tasks</a> · <a href="/live">live</a> · <a href="/journal">journal</a> · <a href="/adr">ADRs →</a></p>
      <h1>Journal — 循环最近记录</h1>
      ${renderSectionBlock(journal.escalations, "升级项 (escalations.md)")}
      ${renderSectionBlock(journal.tickLog, "Tick 记录 (tick-log.md)")}
      ${renderSectionBlock(journal.commits, "最近提交 (git log)")}
    </main></body></html>`;
}

export async function handleLive(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let live: LiveResult;
  try {
    live = readLive(cfg.workspaceRoot);
  } catch (err) {
    live = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      inFlight: [],
      concurrency: 0,
      cpuPressure: null,
      liveState: null,
      liveExplanation: null,
      activity: null,
    };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderLivePage(live));
}

export async function handleJournal(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let journal: JournalResult;
  try {
    journal = readJournal(cfg.workspaceRoot);
  } catch (err) {
    const degraded: JournalSection = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      markdown: null,
    };
    journal = { escalations: degraded, tickLog: degraded, commits: degraded };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderJournalPage(journal));
}

// ── /board — 三源 join 看板 (gap-web-board-needs-an-inconsistency-verdict-it-does-not-have) ──
// The board joins 意图 (task store) + 执行 (telemetry) + 落地 (git code existence). The LANDING
// judgment is REUSED from plugin/scripts/task-status-drift-check.ts via observation.readBoardLanding
// (AC1: reuse, not reimplement — the drift checker is the single authority). The board emits one
// `data-flag` attribute per task matching the checker's suspects/reverse, so the Contract's band
// (board_flags == suspects + reverse, per-task) holds BY CONSTRUCTION (AC2/AC3). Execution flags
// (在飞超时/孤儿) use a separate `data-exec-flag` attribute so they never pollute the data-flag count.

function renderBoardPage(board: {
  landing: BoardLanding;
  execution: BoardExecution;
  intentStatus: "ok" | "error";
  intentReason: string | null;
  rows: Array<{
    id: string;
    title: string;
    status: string;
    labels: string[];
    landingFlag: string | null;
    execFlags: string[];
    inFlightMinutes: number | null;
  }>;
}): string {
  const landingNote = board.landing.status === "ok"
    ? html`<span>落地: <code>task-status-drift-check.ts</code> · 扫描 ${board.landing.scanned} 任务</span>`
    : board.landing.status === "empty"
      ? html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>无数据</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
      : html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>读失败</strong> — ${escapeHtml(board.landing.reason || "")}</span>`;
  const execNote = board.execution.status === "ok"
    ? html`<span>执行: <code>.workflow-events/</code> · ${board.execution.inFlight.length} 在飞</span>`
    : board.execution.status === "empty"
      ? html`<span>执行: <code>.workflow-events/</code> · <strong>无数据</strong> — ${escapeHtml(board.execution.reason || "")}</span>`
      : html`<span>执行: <code>.workflow-events/</code> · <strong>读失败</strong> — ${escapeHtml(board.execution.reason || "")}</span>`;
  const intentNote = board.intentStatus === "ok"
    ? html`<span>意图: 任务库 (Provider ABI)</span>`
    : html`<span>意图: 任务库 (Provider ABI) · <strong>读失败</strong> — ${escapeHtml(board.intentReason || "")}</span>`;

  const rows = board.rows.map((r) => {
    const flagAttr = r.landingFlag ? ` data-flag="${escapeHtml(r.landingFlag)}"` : "";
    const execAttr = r.execFlags.length > 0 ? ` data-exec-flag="${escapeHtml(r.execFlags.join(","))}"` : "";
    const execCell = r.inFlightMinutes != null
      ? html`在飞 ${escapeHtml(r.inFlightMinutes.toFixed(1))} 分钟${r.execFlags.map((f) => html` · <strong>${f === "in-flight-timeout" ? "在飞超时" : "孤儿"}</strong>`).join("")}`
      : (r.execFlags.length > 0 ? r.execFlags.map((f) => html`<strong>${f === "in-flight-timeout" ? "在飞超时" : "孤儿"}</strong>`).join(" · ") : "—");
    const landingCell = r.landingFlag === "done-unlanded"
      ? html`<strong>done 但未落地</strong>`
      : r.landingFlag === "landed-not-closed"
        ? html`<strong>已落地但未收尾</strong>`
        : "—";
    return html`<tr${flagAttr}${execAttr}>
      <td><a href="/task/${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a></td>
      <td>${escapeHtml(r.status)}${(r.labels.length > 0 ? ` · ${escapeHtml(r.labels.join(", "))}` : "")}</td>
      <td>${execCell}</td>
      <td>${landingCell}</td>
    </tr>`;
  }).join("\n");

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay board — 三源 join 看板">${pageStyles()}<title>Board — 三源 join 看板</title></head>
    <body><main>
      <p class="meta"><a href="/">← tasks</a> · <a href="/live">live</a> · <a href="/journal">journal</a> · <a href="/adr">ADRs →</a></p>
      <h1>Board — 意图 / 执行 / 落地</h1>
      <p class="meta">${intentNote} · ${execNote} · ${landingNote}</p>
      <table>
        <tr><th>id</th><th>意图</th><th>执行</th><th>落地</th></tr>
        ${rows}
      </table>
    </main></body></html>`;
}

export async function handleBoard(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: ProviderClient,
  manifest: Manifest,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let landing: BoardLanding;
  try {
    landing = await readBoardLanding(cfg.workspaceRoot);
  } catch (err) {
    landing = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, flags: new Map(), scanned: 0 };
  }
  let execution: BoardExecution;
  try {
    execution = await readBoardExecution(cfg.workspaceRoot);
  } catch (err) {
    execution = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, flags: new Map(), inFlight: [] };
  }

  let tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown }> = [];
  let intentStatus: "ok" | "error" = "ok";
  let intentReason: string | null = null;
  try {
    const r = await client.taskList({ includeBody: false });
    tasks = r.tasks ?? [];
  } catch (err) {
    intentStatus = "error";
    intentReason = err instanceof Error ? err.message : String(err);
  }

  // Union of provider tasks + landing-flagged taskIds, so every drift-flagged task renders a row
  // even if the provider's view diverges (the Contract's invariant: the scanned set must match).
  const byId = new Map<string, { title: string; status: string; labels: string[] }>();
  for (const t of tasks) {
    if (typeof t.id === "string" && t.id.length > 0) {
      byId.set(t.id, {
        title: typeof t.title === "string" ? t.title : "",
        status: typeof t.status === "string" ? t.status : "",
        labels: Array.isArray(t.labels) ? (t.labels as unknown[]).filter((l): l is string => typeof l === "string") : [],
      });
    }
  }
  for (const taskId of landing.flags.keys()) {
    if (!byId.has(taskId)) byId.set(taskId, { title: "", status: "", labels: [] });
  }

  const rows = [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, meta]) => {
    const landingFlag = landing.flags.get(id) ?? null;
    const execFlags = [...(execution.flags.get(id) ?? [])];
    const inFlight = execution.inFlight.find((t) => t.taskId === id);
    return {
      id,
      title: meta.title,
      status: meta.status,
      labels: meta.labels,
      landingFlag,
      execFlags,
      inFlightMinutes: inFlight ? inFlight.minutes : null,
    };
  });

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderBoardPage({ landing, execution, intentStatus, intentReason, rows }));
}

// ── /git-history — server-rendered SVG of the commit-landing timeline (gap-git-history-svg-server-rendered) ──
//
// Data access is quarantined in observation.readGitHistory (the ONLY serve-path module allowed to
// know git); this file only renders. The SVG is built by STRING CONCATENATION — no template engine,
// no new dependency, and no <script> anywhere (zero client JS, the AC4 invariant; the browser's
// native <title> tooltip is used, which needs no JS).
//
// THE X-AXIS SEMANTIC IS THE COMMIT LANDING TIME (%ct), NOT A DURATION. git branch lifespan ≠ task
// work hours (measured: 149/164 fan-in branches lived <1h — the task finished before its first commit
// even landed), and real work hours live in telemetry with a ~6% join rate to git. So the chart draws
// only what git can prove: when commits landed (points), on which branch lane (Y), and where the
// merges are (orange diamonds = the fan-in landing events). The branch interval line is explicitly a
// 「存活区间」(existence span), never labeled as work time.

// SVG color/ink tokens — the blue/orange pair validated all-pairs in light mode (dataviz skill);
// branch identity is carried by LANE POSITION + direct label, never by a cycled hue.
const GIT_SVG_BLUE = "#2a78d6";   // regular commit point
const GIT_SVG_ORANGE = "#eb6834"; // merge commit point (diamond)
const GIT_SVG_INK = "#52514e";    // secondary ink (text)
const GIT_SVG_MUTED = "#898781";  // muted (axis labels)
const GIT_SVG_GRID = "#e1e0d9";   // hairline gridline
const GIT_SVG_SURFACE = "#fcfcfb"; // chart surface

export interface GitHistoryBranch {
  ref: string;
  commits: Array<{ hash: string; t: number; parents: number; subject: string }>;
  firstT: number;
  lastT: number;
}

/**
 * Group commits into per-branch lanes, ordered by most-recent landing time (desc) then name.
 * A commit reached via multiple refs is attributed to the one `--source` picked in the git
 * traversal — the chart shows where the traversal saw it land, not a full DAG (honest scope).
 */
export function groupCommitsByBranch(commits: GitHistoryCommit[]): GitHistoryBranch[] {
  const byRef = new Map<string, GitHistoryBranch>();
  for (const c of commits) {
    let b = byRef.get(c.ref);
    if (!b) {
      b = { ref: c.ref, commits: [], firstT: c.t, lastT: c.t };
      byRef.set(c.ref, b);
    }
    b.commits.push(c);
    if (c.t < b.firstT) b.firstT = c.t;
    if (c.t > b.lastT) b.lastT = c.t;
  }
  // Within a lane, render commits oldest→newest (left→right along the interval line). git log
  // yields newest-first, but element order is only cosmetic; ascending keeps the segment + points
  // in reading order and makes the x-axis mapping deterministic to test.
  for (const b of byRef.values()) b.commits.sort((a, c) => a.t - c.t || a.hash.localeCompare(c.hash));
  return [...byRef.values()].sort((a, b) => b.lastT - a.lastT || a.ref.localeCompare(b.ref));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "Nice" x-axis tick positions+labels for a [x0,x1] unix-second window. */
function niceTicks(x0: number, x1: number, maxTicks = 6): Array<{ x: number; label: string }> {
  const span = x1 - x0;
  const rawStep = span / Math.max(maxTicks, 1);
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800, 1209600, 2592000];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (s >= rawStep) { step = s; break; }
  }
  const ticks: Array<{ x: number; label: string }> = [];
  const start = Math.ceil(x0 / step) * step;
  const fine = span <= 3 * 86400; // <3-day window → clock time; wider → date
  for (let x = start; x <= x1; x += step) {
    const d = new Date(x * 1000);
    const label = fine
      ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    ticks.push({ x, label });
  }
  return ticks;
}

function isoTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Render the commit-landing timeline as a pure, dependency-free SVG string. Returns "" when the
 * history is degraded/empty (the page then shows the 无数据/读失败 note instead). Deterministic on
 * its input — the AC3 x-axis semantics (landing time, not duration) are testable directly here.
 */
export function renderGitHistorySvg(history: GitHistoryResult): string {
  if (history.status !== "ok" || history.commits.length === 0) return "";
  const branches = groupCommitsByBranch(history.commits);
  const M = { top: 34, right: 170, bottom: 40, left: 10 };
  const laneH = 26;
  const W = 940;
  const plotW = W - M.left - M.right;
  const H = M.top + M.bottom + branches.length * laneH;

  const ts = history.commits.map((c) => c.t);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const rawSpan = Math.max(t1 - t0, 1);
  const pad = rawSpan < 3600 ? 3600 : rawSpan * 0.02; // single-instant window still gets a visible plot
  const x0 = t0 - pad;
  const x1 = t1 + pad;
  const xSpan = x1 - x0;
  const X = (t: number): number => M.left + ((t - x0) / xSpan) * plotW;

  const ticks = niceTicks(x0, x1);
  const gridlines = ticks.map((tk) => {
    const gx = X(tk.x);
    return `<line x1="${gx.toFixed(1)}" y1="${M.top}" x2="${gx.toFixed(1)}" y2="${H - M.bottom}" stroke="${GIT_SVG_GRID}" stroke-width="1" />` +
      `<text x="${gx.toFixed(1)}" y="${H - M.bottom + 16}" font-size="10" fill="${GIT_SVG_MUTED}" text-anchor="middle">${escapeHtml(tk.label)}</text>`;
  }).join("");

  const lanes = branches.map((b, i) => {
    const y = M.top + i * laneH + laneH / 2;
    const xFirst = X(b.firstT);
    const xLast = X(b.lastT);
    const seg = b.commits.length > 1
      ? `<line x1="${xFirst.toFixed(1)}" y1="${y.toFixed(1)}" x2="${xLast.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${GIT_SVG_GRID}" stroke-width="2" />`
      : "";
    const points = b.commits.map((c) => {
      const cx = X(c.t);
      const tooltip = `${escapeHtml(c.hash.slice(0, 7))} · ${isoTime(c.t)} · ${escapeHtml(c.subject)}`;
      if (c.parents > 1) {
        const s = 4; // 8px diamond (the mark-spec ≥8px marker)
        return `<rect x="${(cx - s).toFixed(1)}" y="${(y - s).toFixed(1)}" width="${2 * s}" height="${2 * s}" transform="rotate(45 ${cx} ${y})" fill="${GIT_SVG_ORANGE}"><title>merge ${tooltip}</title></rect>`;
      }
      return `<circle cx="${cx.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${GIT_SVG_BLUE}"><title>${tooltip}</title></circle>`;
    }).join("");
    return `<g>${seg}${points}<text x="${(W - M.right + 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="11" fill="${GIT_SVG_INK}">${escapeHtml(b.ref)}</text></g>`;
  }).join("");

  // In-SVG legend: the two mark kinds (merge vs regular). Identity is never color-alone — the
  // legend pairs each hue with its mark shape + label.
  const legend = `<g font-size="10" fill="${GIT_SVG_INK}">
    <circle cx="${M.left + 6}" cy="18" r="4" fill="${GIT_SVG_BLUE}" /><text x="${M.left + 16}" y="22">普通提交</text>
    <rect x="${M.left + 92}" y="14" width="8" height="8" transform="rotate(45 ${M.left + 96} 18)" fill="${GIT_SVG_ORANGE}" /><text x="${M.left + 106}" y="22">合并提交（fan-in 落地）</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Git commit landing timeline; x-axis is commit landing time, not work duration" style="background:${GIT_SVG_SURFACE};max-width:100%;height:auto;border:1px solid ${GIT_SVG_GRID};border-radius:6px;font-family:system-ui,-apple-system,sans-serif;">
${legend}
${gridlines}
${lanes}
</svg>`;
}

/**
 * Render the full /git-history HTML page. Zero <script> tags by construction (AC4): the page is
 * static server-rendered HTML + one inline SVG; interactivity is limited to the browser's native
 * SVG <title> tooltip.
 */
function renderGitHistoryPage(history: GitHistoryResult): string {
  const statusNote = history.status === "error"
    ? html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(history.reason || "")}</p>`
    : history.status === "empty"
      ? html`<p class="meta"><strong>无数据</strong> — ${escapeHtml(history.reason || "")}</p>`
      : "";
  const chart = history.status === "ok" && history.commits.length > 0 ? renderGitHistorySvg(history) : "";
  const nCommits = history.commits.length;
  const branches = history.status === "ok" ? groupCommitsByBranch(history.commits) : [];
  const mergeCount = history.commits.filter((c) => c.parents > 1).length;

  const summaryRows = branches.map((b) => html`<tr>
    <td>${escapeHtml(b.ref)}</td>
    <td>${escapeHtml(isoTime(b.firstT))}</td>
    <td>${escapeHtml(isoTime(b.lastT))}</td>
    <td>${b.commits.length}</td>
    <td>${b.commits.filter((c) => c.parents > 1).length}</td>
  </tr>`).join("\n");
  const summaryTable = branches.length > 0 ? html`<h2>分支汇总（git 可证的事实，非工时）</h2>
    <table>
      <tr><th>分支</th><th>首提交落地</th><th>末提交落地</th><th>提交数</th><th>合并数</th></tr>
      ${summaryRows}
    </table>` : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay git history — commit landing timeline (server-rendered SVG, zero client JS)">${pageStyles()}<title>Git history — commit landing timeline</title></head>
    <body><main>
      <p class="meta"><a href="/">← tasks</a> · <a href="/live">live</a> · <a href="/journal">journal</a> · <a href="/git-history">git-history</a> · <a href="/adr">ADRs →</a></p>
      <h1>Git History — 提交落地时间轴</h1>
      <p class="meta"><strong>横轴 = 提交落地时刻（git commit time），不是工时/持续时间。</strong> git 分支存活区间 ≠ 任务工时（实测 149/164 fan-in 分支寿命 &lt;1h——任务在首提交落地前就干完了）。真工时不在此图中：它在遥测里（#55，join 率仅 ~6%）。菱形 = 合并提交（fan-in 落地事件）。当前窗口：最近 ${nCommits} 条提交、${mergeCount} 个合并（跨所有本地分支）。</p>
      ${statusNote}
      ${chart}
      ${summaryTable}
    </main></body></html>`;
}

export async function handleGitHistory(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let history: GitHistoryResult;
  try {
    history = readGitHistory(cfg.workspaceRoot);
  } catch (err) {
    history = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, commits: [] };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderGitHistoryPage(history));
}

// ── Facade dispatcher (M99 pattern: single entry point keeps startServer outDegree low) ──

export async function handleAllRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: { workspaceRoot: string },
): Promise<void> {
  const url = new URL(req.url as string, `http://${req.headers.host}`);

  if (url.pathname === "/") {
    await handleTaskList(req, res, url, client, manifest);
    return;
  }

  // gap-web-cannot-show-what-the-loop-is-doing-now: /live + /journal are the loop-observation
  // surface. They read workspace observation files through the observation.ts facade (the ONLY
  // module allowed to know `.workflow-events/`, `orchestration/`, `git`), never directly.
  if (url.pathname === "/live") {
    await handleLive(req, res, cfg);
    return;
  }

  if (url.pathname === "/journal") {
    await handleJournal(req, res, cfg);
    return;
  }

  if (url.pathname === "/git-history") {
    await handleGitHistory(req, res, cfg);
    return;
  }

  // gap-web-board-needs-an-inconsistency-verdict-it-does-not-have: /board joins 意图/执行/落地
  // and renders the four inconsistency flags. The landing judgment is REUSED from the drift
  // checker (observation.ts's readBoardLanding) so per-task agreement holds by construction.
  if (url.pathname === "/board") {
    await handleBoard(req, res, url, client, manifest, cfg);
    return;
  }

  if (url.pathname === "/adr") {
    await handleAdrList(req, res, url, client);
    return;
  }

  const adrM = /^\/adr\/([^/]+)$/.exec(url.pathname);
  if (adrM) {
    const id = decodeURIComponent(adrM[1]);
    await handleAdrDetail(req, res, id, client);
    return;
  }

  // /goal + /doc — SPEC §4: the third sibling kind's route, done TOGETHER with /doc
  // (which had NO route — grep -c document = 0), both following the /adr shape. The
  // goal page shows target / criterion / status / recent verdict+time / origin.
  if (url.pathname === "/goal") {
    await handleGoalList(req, res, url, cfg);
    return;
  }

  const goalM = /^\/goal\/([^/]+)$/.exec(url.pathname);
  if (goalM) {
    const id = decodeURIComponent(goalM[1]);
    await handleGoalDetail(req, res, id, cfg);
    return;
  }

  if (url.pathname === "/doc") {
    await handleDocList(req, res, url, cfg);
    return;
  }

  const docM = /^\/doc\/([^/]+)$/.exec(url.pathname);
  if (docM) {
    const id = decodeURIComponent(docM[1]);
    await handleDocDetail(req, res, id, cfg);
    return;
  }

  const taskM = /^\/task\/([^/]+)$/.exec(url.pathname);
  if (taskM) {
    const id = decodeURIComponent(taskM[1]);
    await handleTaskDetail(req, res, url, id, client);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}
