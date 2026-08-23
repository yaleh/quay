// serve-handlers.ts — extracted route handlers and rendering helpers for quay serve.
// Companion to serve.ts (M100 refactor: startServer god-function decomposition).
//
// IMPORTANT: This file MUST NOT import from ./serve.ts (would create circular import).
// All shared rendering helpers live here; serve.ts imports them from here.

import type { IncomingMessage, ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProviderClient } from "./provider-client.ts";
import { readLive, readJournal, readBoardLanding, readBoardExecution, readGitHistory, readSystem, readManager, readManagerLight, readTests, readSessions, readArchitecture, SESSION_LAYERS, type LiveResult, type JournalResult, type JournalSection, type BoardLanding, type BoardExecution, type GitHistoryCommit, type GitHistoryResult, type SystemResult, type ManagerResult, type TestsResult, type SessionsResult, type SessionDetail, type ArchitectureResult, type TestRunRecord } from "./observation.ts";
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
  // AC102: this shared base sheet is TOKEN-DERIVED — every colour comes from the Modernist token
  // sheet (webui-modernist.css, inlined by modernistStyles()) via var(--color-*). The base sheet is
  // ALWAYS emitted AFTER modernistStyles() so its component rules win, but carries ZERO hardcoded
  // hex — the hex values live only in the .css asset (AC102②: grep -cE '#[0-9a-fA-F]{6}' = 0).
  return `<style>
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
  margin: 0;
  padding: 0;
}
main {
  max-width: 900px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}
h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; color: var(--color-text); }
h2 { font-size: 1.2rem; margin: 1.2rem 0 0.4rem; color: var(--color-neutral-800); }
h3 { font-size: 1rem; margin: 1rem 0 0.3rem; color: var(--color-neutral-700); }
a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
nav { margin-bottom: 1rem; }
nav a { font-size: 0.95rem; color: var(--color-neutral-700); }
table {
  border-collapse: collapse;
  width: 100%;
  margin-top: 0.5rem;
  background: var(--color-surface);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
th {
  background: var(--color-neutral-200);
  padding: 0.55rem 0.85rem;
  text-align: left;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-neutral-700);
  border-bottom: 2px solid var(--color-divider);
}
td {
  padding: 0.5rem 0.85rem;
  border-bottom: 1px solid var(--color-divider);
  font-size: 0.9rem;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--color-neutral-100); }
.malformed-row td { background: var(--color-accent-100); color: var(--color-accent-800); font-weight: 600; }
.malformed-row a { color: var(--color-accent-800); }
button {
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  padding: 0.4rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  margin: 0 0.25rem 0.25rem 0;
}
button:hover { background: var(--color-accent-600); }
.meta { color: var(--color-neutral-700); font-size: 0.9rem; margin: 0.5rem 0 1rem; }
.meta a { text-decoration: underline; }
.body { margin-top: 1rem; }
.body h2, .body h3 { margin-top: 1rem; }
.body ul, .body ol { margin: 0.4rem 0 0.4rem 1.5rem; }
.body li { margin: 0.15rem 0; }
.body li.task-list-item { list-style: none; margin-left: -1.2rem; }
.body li.task-list-item input[type="checkbox"] { margin-right: 0.35em; }
.body pre {
  background: var(--color-neutral-100);
  border-radius: 4px;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  font-size: 0.85rem;
}
.body code {
  background: var(--color-neutral-100);
  border-radius: 3px;
  padding: 0.1em 0.35em;
  font-size: 0.88em;
}
.body pre code { background: none; padding: 0; font-size: inherit; }
hr { border: none; border-top: 1px solid var(--color-divider); margin: 1rem 0; }
/* QW-007: disabled page-nav items — non-clickable; token muted (AA pass) */
.page-nav-disabled { color: var(--color-neutral-600); cursor: default; }
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
/* QX-015 (experiment 4, iteration 3): project orientation banner — REMOVED by
   DIR-007 (iteration 10). Banner had two problems: (1) depicted needs-human as
   sequential step in todo→ready→needs-human→done chain rather than as a
   side-branch/blocked state; (2) permanent top-of-page layout cost
   disproportionate to value. CSS class left as empty rule for no-op safety
   in case any test or external reference still matches on it; the HTML element
   was removed from the list-page template. */
/* QX-013 (experiment 4, iteration 3): error and success banners for
   gate-fail and post-action feedback. Closes UQ-013. Token colors: error uses the
   accent (red) family; success/info use the muted accent-2 / neutral families (the
   Modernist palette has no green — AC102 token compliance over legacy hue). */
.error-banner {
  background: var(--color-accent-100);
  border-left: 3px solid var(--color-accent);
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  color: var(--color-accent-800);
  border-radius: 0 4px 4px 0;
}
.success-banner {
  background: var(--color-accent-2-100);
  border-left: 3px solid var(--color-accent-2-600);
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  color: var(--color-accent-2-800);
  border-radius: 0 4px 4px 0;
}
/* QX-037 (experiment 4, iteration 10): info banner for needs-human CTA (UQ-022). */
.info-banner {
  background: var(--color-neutral-100);
  border-left: 3px solid var(--color-neutral-500);
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  color: var(--color-neutral-800);
  border-radius: 0 4px 4px 0;
}
/* QX-043 (experiment 4, iteration 11): label nav scrollable strip on mobile (UQ-006).
   AC96: upgraded from a nowrap text line to the design's chip/pill form — each label is a
   pill (flex: none, nowrap) and the container wraps on desktop (flex-wrap: wrap) but is a
   single-row horizontal scroll on mobile (the ≤600px media query sets flex-wrap: nowrap +
   overflow-x: auto). This ALSO fixes the AC96-audit bug where a <details> inside the old
   <p class="meta"> was invalid HTML — the HTML parser broke the <p> open, stacking the
   expandable onto its own line (2-block label nav) and wasting vertical budget. */
.label-nav-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.4rem;
  align-items: center;
  padding-bottom: 0.2rem;
  margin-bottom: 0.25rem;
}
.label-chip {
  flex: none;
  white-space: nowrap;
  font-size: 0.85rem;
  line-height: 1.5;
  padding: 0.08rem 0.55rem;
  border: 1px solid var(--color-divider);
  border-radius: 999px;
  background: var(--color-surface);
}
.label-chip a { color: var(--color-accent); }
.label-chip strong { color: var(--color-text); }
.label-chip-label { flex: none; font-size: 0.85rem; color: var(--color-neutral-700); }
.label-chip-more summary { cursor: pointer; color: var(--color-neutral-700); }
.label-chip-more > div { white-space: normal; padding-top: 0.2rem; }
/* AC96: the desktop site-nav meta line (hidden on mobile — its links live in the hamburger).
   .mobile-chrome (header + menu) is the MOBILE-ONLY chrome: display:none on desktop, and the
   ≤600px media query (at the end of this sheet) flips it to display:block. */
.site-nav { display: block; }
.mobile-chrome { display: none; }
/* gap-webui-nav-inconsistent-routes: unified header-bar site nav. The .nav / .nav-brand
   classes come from the Modernist token sheet (webui-modernist.css, inlined before this sheet);
   these rules implement the sc-if design's desktop navGroupDefs rendering (Quay改进版WebUI.dc.html
   nav block): single-row header bar, brand flush left, a vertical bar separating each of the
   four groups, current page red+bold (accent-700 — the design's ACCENT700), inactive items
   ink-weight-600, and the Board NEW badge. */
.nav { flex-wrap: wrap; row-gap: var(--space-2); }
.nav-brand { margin-right: var(--space-2); }
.nav-group {
  display: inline-flex; align-items: center; flex-wrap: wrap;
  gap: var(--space-3);
  padding-left: var(--space-3);
  border-left: 1px solid color-mix(in srgb, var(--color-text) 20%, transparent);
}
.nav .nav-item { color: var(--color-text); font-weight: 600; font-size: 14px; }
.nav .nav-current { color: var(--color-accent-700); font-weight: 800; font-size: 14px; }
.nav-badge {
  font-size: 9px; letter-spacing: 0.06em; line-height: 1;
  background: var(--color-accent); color: var(--color-bg);
  padding: 2px 5px;
}
/* AC100/AC102: verdict colouring is token-defined on BOTH the list pages (this sheet)
   and the detail pages (detailStyles()) — the two sheets agree on the accent family. */
.verdict-pass { color: var(--color-accent-700); }
.verdict-fail { color: var(--color-accent-800); }
/* AC102: git-history SVG mark colours — token-derived so the server-rendered chart carries
   no hardcoded hex. The hex values live only in webui-modernist.css. */
.git-svg-surface { background: var(--color-neutral-100); }
.git-svg-grid { stroke: var(--color-neutral-200); }
.git-svg-commit { fill: var(--color-accent-600); }
.git-svg-merge { fill: var(--color-accent-2-500); }
.git-svg-ink { fill: var(--color-text); }
.git-svg-muted { fill: var(--color-neutral-600); }
/* AC102 (same token discipline): suite-load curve stroke — token-derived, no hardcoded hex.
   Surface/grid/ink/muted reuse the git-svg-* classes above (they are generic chart tokens). */
.load-svg-line { fill: none; stroke: var(--color-accent-600); stroke-width: 2; }
/* QW-006: mobile-responsive layout (DIR-003) — narrow viewport adaptations.
   Kept at the END of the sheet so its rules win the cascade over every base rule above
   (media queries add no specificity — a later base rule would otherwise beat them). */
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
  /* AC96: true two-form responsive (sc-if isMobile). Mobile gets a hamburger
     header + full-screen nav menu (checkbox-toggled, zero client JS — the AC4
     invariant) and the label/filter/sort navs collapse to single-row horizontal
     scrolls, so the 375×812 first screen shows the task table's first row. */
  .mobile-chrome { display: block; }
  .mobile-header {
    display: flex; position: sticky; top: 0; z-index: 20;
    align-items: center; gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-divider);
    background: var(--color-bg);
  }
  .mobile-header-title { font-weight: 800; font-size: 1.05rem; }
  .mobile-header-page { margin-left: auto; font-size: 0.8rem; color: var(--color-neutral-700); }
  .mobile-menu-burger {
    display: inline-flex; flex-direction: column; justify-content: center; gap: 4px;
    width: 40px; height: 40px; padding: 8px 9px; cursor: pointer;
  }
  .mobile-menu-burger span {
    display: block; width: 22px; height: 2px; background: var(--color-text);
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  .mobile-menu-toggle-input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .mobile-menu {
    display: none; position: fixed; inset: 0; z-index: 15;
    background: var(--color-bg);
    padding: 3.5rem 0.75rem 1rem;
    overflow-y: auto;
  }
  .mobile-menu-toggle-input:checked ~ .mobile-menu { display: block; }
  .mobile-menu-toggle-input:checked ~ .mobile-header .mobile-menu-burger span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
  .mobile-menu-toggle-input:checked ~ .mobile-header .mobile-menu-burger span:nth-child(2) { opacity: 0; }
  .mobile-menu-toggle-input:checked ~ .mobile-header .mobile-menu-burger span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }
  /* The desktop site-nav meta line's links live in the hamburger menu on mobile. */
  .site-nav { display: none; }
  /* Mobile full-screen menu content: the design's isMobile form renders the SAME
     navGroupDefs as block links under per-group section labels. */
  .mobile-menu-group { margin-bottom: var(--space-3); }
  .mobile-menu-group-label {
    font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--color-neutral-700); background: var(--color-surface);
    padding: 8px 20px 4px;
  }
  .mobile-menu .mobile-menu-item {
    display: flex; align-items: center; min-height: 48px; padding: 0 20px;
    font-size: 16px; text-decoration: none;
    color: var(--color-text); font-weight: 600;
    border-bottom: 1px solid color-mix(in srgb, var(--color-text) 15%, transparent);
  }
  .mobile-menu .mobile-menu-item.nav-current { color: var(--color-accent-700); font-weight: 800; }
  h1 { font-size: 1.2rem; margin: 0.4rem 0 0.6rem; }
  /* Filter/sort navs become single-row horizontal scrolls (design's isMobile chips). */
  .list-nav { display: flex; align-items: baseline; gap: 0.35rem; overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap; }
  .label-nav-wrap { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; }
}
</style>`;
}

// ── AC100: Modernist token styling for the three existing detail pages ─────
// The design's sc-if views only drew the LIST pages; /adr/:id, /goal/:id and
// /doc/:id already exist and must not be left on the legacy hardcoded-hex
// styling — they share the SAME style source as the 15 design views: the
// Modernist token sheet (docs/design/.../_ds/modernist-*/styles.css's
// --color-* / --font-* / --space-* / --radius-*).
//
// The server ships a canonical product copy of that stylesheet
// (./webui-modernist.css) and inlines it, so the rendering code below carries
// ZERO hardcoded hex (AC100 judge ①: grep '#[0-9a-fA-F]{6}' over the three
// detail-page code segments must be 0 — the hex lives only in the .css asset).
// webui-modernist-sync.test.mjs asserts the product copy is byte-identical to
// the design source, which is what makes "same style source" mechanically true.
//
// gap-webui-modernist-css-missing-in-tgz: the canonical product copy lives
// beside this file in src/ (so source-tree runs read it fine), but the bundled
// dist/quay.js has no sibling .css — npm pack ships the file under src/, never
// dist/ — so every bundled serve logged ENOENT and served an empty <style>.
// build-dist.mjs now INLINES the stylesheet into the bundle (its banner sets
// globalThis.__WEBUI_MODERNIST_CSS__ before any module executes), making the
// dist self-contained. Prefer that inlined value when present; fall back to the
// sibling-file read for source runs (node --experimental-strip-types).
const __webuiCssGlobal = globalThis as unknown as { __WEBUI_MODERNIST_CSS__?: string };
const WEBUI_MODERNIST_CSS = (() => {
  if (__webuiCssGlobal.__WEBUI_MODERNIST_CSS__ !== undefined) return __webuiCssGlobal.__WEBUI_MODERNIST_CSS__;
  try {
    return readFileSync(new URL("./webui-modernist.css", import.meta.url), "utf8");
  } catch (err) {
    console.error(`[quay serve] webui-modernist.css missing:`, (err as Error).message);
    return "";
  }
})();

export function modernistStyles(): string {
  return `<style>\n${WEBUI_MODERNIST_CSS}\n</style>`;
}

// Detail-page chrome the token sheet's component layer doesn't cover (main
// gutter, .meta, markdown article/code blocks, tables without a .table class,
// verdict colours) plus the 375px mobile pass (AC100 judge ②). Written against
// the tokens ONLY (var(--*)) — no hardcoded hex.
export function detailStyles(): string {
  return `<style>
.detail-page main { max-width: 900px; margin: 0 auto; padding: 1.5rem 1rem; }
.detail-page h1 { font-size: 32px; }
.detail-page .meta {
  font-size: 13px;
  margin: 0 0 var(--space-3);
  color: color-mix(in srgb, var(--color-text) 60%, transparent);
}
.detail-page .meta strong { color: var(--color-text); font-weight: var(--font-heading-weight); }
.detail-page .meta a { text-decoration: underline; }
.detail-page article { margin-top: var(--space-4); }
.detail-page article h2, .detail-page article h3, .detail-page article h4 { margin-top: var(--space-6); }
.detail-page article ul, .detail-page article ol { margin: 0 0 var(--space-3) 1.5rem; }
.detail-page article li { margin: var(--space-1) 0; }
.detail-page article li.task-list-item { list-style: none; margin-left: -1.4rem; }
.detail-page article li.task-list-item input[type="checkbox"] { margin-right: 0.35em; }
.detail-page article pre {
  background: var(--color-surface);
  padding: var(--space-3) var(--space-4);
  overflow-x: auto;
  font-size: 13px;
}
.detail-page article code {
  background: var(--color-surface);
  padding: 0.1em 0.35em;
  font-size: 0.88em;
}
.detail-page article pre code { background: none; padding: 0; font-size: inherit; }
.detail-page table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: var(--space-3); }
.detail-page th {
  text-align: left; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: color-mix(in srgb, var(--color-text) 60%, transparent);
  padding: var(--space-2); border-bottom: 2px solid var(--color-divider);
}
.detail-page td { padding: var(--space-2); border-bottom: 1px solid var(--color-divider); }
.verdict-pass { color: var(--color-accent-700); }
.verdict-fail { color: var(--color-accent-800); }
@media (max-width: 600px) {
  .detail-page main { padding: var(--space-4) var(--space-3); }
  .detail-page table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .detail-page h1 { font-size: 26px; }
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
// Previously a closure inside the GET / handler that closed over PAGE_SIZE and
// DEFAULT_PAGE_SIZE; now module-level with explicit pageSizeOverride and
// defaultPageSize args. The list route it builds links for lives at /tasks
// (gap-webui-root-should-show-dashboard: `/` is the dashboard landing page).
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
  // gap-webui-root-should-show-dashboard: `/` is now the dashboard landing page, so the task-list
  // route (and every filter/sort/page link built here) lives at `/tasks`.
  return qs ? `/tasks?${qs}` : "/tasks";
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
  // AC96: the label nav is rendered as pill/chip items (the design's isMobile chips). Each
  // item is a <span class="label-chip">; the container (.label-nav-wrap) is flex and wraps on
  // desktop but scrolls on one row on mobile. The <details> expandable is a flex CHILD (not
  // inside a <p>, which was invalid HTML — the parser broke the <p> open and stacked it on a
  // second line). Keeps the .label-nav-wrap opening tag for QX-043's UQ-006 test.
  const labelChips = allLabels.length > 0 ? [
    html`<span class="label-chip">${
      labelFilters.length > 0
        ? html`<a href="${bh(statusFilter, sortKey, null, null, prefixFilter, qFilter)}">All</a>`
        : html`<strong>All</strong>`
    }</span>`,
    ...visibleLabels.map((l) => {
      const isActive = labelFilters.includes(l);
      // Toggle: if active, remove l from filters; if inactive, add l to filters.
      const toggledLabels = isActive
        ? labelFilters.filter((x) => x !== l)
        : [...labelFilters, l];
      // UQ-032: append (N) count after label name so users can see relative label usage.
      const countBadge = ` (${labelCounts.get(l) || 0})`;
      return html`<span class="label-chip">${
        isActive
          ? html`<strong>${escapeHtml(l)}${countBadge}</strong> (<a href="${bh(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">remove</a>)`
          : html`<a href="${bh(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">${escapeHtml(l)}${countBadge}</a>`
      }</span>`;
    }),
    // UQ-033: hidden labels rendered inside a <details> expand element so users can
    // see all labels without editing the URL. Previously was non-interactive plain text.
    ...(hiddenLabelCount > 0 ? [
      html`<details class="label-chip label-chip-more"><summary>… ${hiddenLabelCount} more labels</summary><div>${
        allLabels.filter((l) => !visibleLabels.includes(l)).map((l) => {
          const toggledLabels = labelFilters.includes(l)
            ? labelFilters.filter((x) => x !== l)
            : [...labelFilters, l];
          const countBadge = ` (${labelCounts.get(l) || 0})`;
          return html`<a href="${bh(statusFilter, sortKey, toggledLabels, null, prefixFilter, qFilter)}">${escapeHtml(l)}${countBadge}</a>`;
        }).join(" · ")
      }</div></details>`,
    ] : []),
  ] : [];
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
    ? html` <strong style="color:var(--color-accent)">"${escapeHtml(qFilter)}"</strong> (<a href="${bh(statusFilter, sortKey, labelFilters, null, prefixFilter, null)}">clear</a>)`
    : "";
  const searchForm = html`<form method="GET" style="margin:0.5rem 0 0.75rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
    ${prefixFilter ? html`<input type="hidden" name="prefix" value="${escapeHtml(prefixFilter)}">` : ""}
    ${statusFilter ? html`<input type="hidden" name="status" value="${escapeHtml(statusFilter)}">` : ""}
    ${labelFilters.map((l) => html`<input type="hidden" name="label" value="${escapeHtml(l)}">`).join("")}
    ${sortKey ? html`<input type="hidden" name="sort" value="${escapeHtml(sortKey)}">` : ""}
    <input name="q" type="search" value="${escapeHtml(qFilter || "")}" placeholder="Search titles and descriptions…" style="padding:0.4rem 0.6rem;border:1px solid var(--color-divider);border-radius:4px;font-size:0.9rem;min-width:180px">
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
    ? html`<p class="meta" style="color:var(--color-accent)">Showing ${totalTasks} results for &ldquo;${escapeHtml(qFilter)}&rdquo;${totalPages > 1 ? ` · Page ${safePage} of ${totalPages}` : ""}</p>`
    : "";
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay task list — ${escapeHtml(manifest.name)}">${modernistStyles()}${pageStyles()}<title>Quay — ${escapeHtml(manifest.name)}</title></head>
    <body>${renderMobileChrome("tasks", "task list")}${renderSiteNav("tasks")}<main>
      <!-- QX-015 orientation banner removed by DIR-007 (iteration 10): misleading
           needs-human placement + disproportionate layout cost. -->
      <h1>Quay — task list (${escapeHtml(manifest.id)} provider)</h1>
      ${errorParam ? html`<div class="error-banner" role="alert"><strong>Error:</strong> ${escapeHtml(errorParam)}</div>` : ""}
      ${successParam ? html`<div class="success-banner" role="status"><strong>Done:</strong> ${escapeHtml(successParam)}</div>` : ""}
      ${prefixNav ? html`<p class="meta list-nav">Prefix: ${prefixNav}</p>` : ""}
      <p class="meta list-nav">Filter: ${filterNav}</p>
      <p class="meta list-nav">Sort: ${sortNav}</p>
      ${searchForm}
      ${searchResultBanner}
      ${labelChips.length > 0 ? html`<div class="label-nav-wrap"><span class="label-chip-label">Label:</span>${labelChips.join("")}</div>` : ""}
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${modernistStyles()}${pageStyles()}<title>ADRs</title></head>
    <body>${renderMobileChrome("adr", "adrs")}${renderSiteNav("adr")}<main>
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(a.id)}: ${escapeHtml(a.title)}">${modernistStyles()}${detailStyles()}<title>${escapeHtml(a.id)}</title></head>
    <body class="detail-page">${renderMobileChrome("adr", a.id)}${renderSiteNav("adr")}<main>
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(String(g.id))}: ${escapeHtml(String(g.title))}">${modernistStyles()}${detailStyles()}<title>${escapeHtml(String(g.id))}</title></head>
    <body class="detail-page">${renderMobileChrome("goal", String(g.id))}${renderSiteNav("goal")}<main>
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
  const backHref = isSafeRelativeRedirect(fromParam) ? fromParam as string : "/tasks";
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(t.id)}: ${escapeHtml(t.title)}">${modernistStyles()}${pageStyles()}<title>${escapeHtml(t.id)}</title></head>
    <body>${renderMobileChrome("tasks", t.id)}${renderSiteNav("tasks")}<main>
      <!-- QX-011: back link uses ?from= param to restore filter context (UQ-009).
           The site-nav above already carries the full 15-view nav; this contextual
           link restores the list's filter/sort/page context. -->
      <nav><a href="${escapeHtml(backHref)}">&larr; back to list</a></nav>
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

// gap-webui-live-implcomplete-state-render: the impl-complete boundary (implCompletedAtMs) splits an
// in-flight run into implementing (null) vs awaiting-land (non-null). The awaiting-land duration is
// now − implCompletedAtMs, where "now" is the observation instant ALREADY embedded in the snapshot
// (minutes = (now − startedAtMs)/60000) — so the render stays a pure function of LiveResult, with no
// Date.now() inside it (deterministic and testable against a fixed nowMs).
function awaitingLandMs(t: { startedAtMs: number; minutes: number; implCompletedAtMs: number | null }): number | null {
  if (t.implCompletedAtMs == null) return null;
  const nowMs = t.startedAtMs + t.minutes * 60_000;
  return Math.max(0, nowMs - t.implCompletedAtMs);
}

function formatAwaitingDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "<1m";
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function renderLivePage(live: LiveResult): string {
  // gap-webui-cross-task-blocking-visibility: render the cross-task blocking relation (Touches
  // intersection + depends_on chain) computed by observation.computeInFlightBlocking. A task-id list
  // renders as comma-joined links; an empty list renders the 「无」 placeholder so "no relation" is
  // visually DISTINCT from "no data" (hard rule: a missing value must not look like a pass/absence).
  const linkList = (ids: string[]): string =>
    ids.length > 0
      ? ids.map((id) => html`<a href="/task/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`).join(", ")
      : html`<span class="meta">无</span>`;

  const rows = live.inFlight.length > 0 ? html`<table>
    <tr><th>task id</th><th>run id</th><th>started</th><th>elapsed</th><th>状态</th><th>待落地时长</th><th>阻塞 (blocks)</th><th>被阻塞 (blockedBy)</th></tr>
    ${live.inFlight.map((t) => html`<tr>
      <td><a href="/task/${encodeURIComponent(t.taskId)}">${escapeHtml(t.taskId)}</a></td>
      <td>${escapeHtml(t.runId)}</td>
      <td>${escapeHtml(relativeTime(t.startedAtMs))}</td>
      <td>${escapeHtml(t.minutes.toFixed(1))} 分钟</td>
      <td>${t.implCompletedAtMs == null ? "实现中" : html`<strong>已完工待落地</strong>`}</td>
      <td>${escapeHtml(formatAwaitingDuration(awaitingLandMs(t)))}</td>
      <td>${linkList(t.blocks)}</td>
      <td>${linkList(t.blockedBy)}</td>
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

  // gap-webui-cross-task-blocking-visibility (AC2): the cross-task blocking relation as a literal
  // 「任务 X 正在阻塞 [Y, Z]」 sentence per blocking in-flight task (plus the 「被 … 阻塞」 mirror), so
  // `curl /live | grep 阻塞` is the unambiguous contract measure — the relation no longer lives only
  // in tick-log prose. A task with neither relation contributes no line; the whole section falls back
  // to 「无跨任务阻塞关系」 when no in-flight task blocks anything.
  const blockingLines = live.inFlight.flatMap((t) => {
    const blocks = t.blocks.length > 0
      ? [html`<li>任务 <a href="/task/${encodeURIComponent(t.taskId)}">${escapeHtml(t.taskId)}</a> 正在阻塞 [${t.blocks.map((id) => html`<a href="/task/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`).join(", ")}]</li>`]
      : [];
    const blockedBy = t.blockedBy.length > 0
      ? [html`<li>任务 <a href="/task/${encodeURIComponent(t.taskId)}">${escapeHtml(t.taskId)}</a> 被 [${t.blockedBy.map((id) => html`<a href="/task/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`).join(", ")}] 阻塞</li>`]
      : [];
    return [...blocks, ...blockedBy];
  });
  const blockingSection = blockingLines.length > 0
    ? html`<h2>跨任务阻塞关系</h2><ul>${blockingLines.join("\n")}</ul>`
    : html`<p class="meta">无跨任务阻塞关系。</p>`;

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay live — what the loop is doing right now">${modernistStyles()}${pageStyles()}<title>Live — loop activity</title></head>
    <body>${renderMobileChrome("live", "live")}${renderSiteNav("live")}<main>
      <h1>Live — 循环此刻在做什么</h1>
      ${statusNote}
      ${summary}
      ${blockingSection}
      ${live.status === "ok" && live.inFlight.length === 0 ? html`<p class="meta">当前无在飞任务。</p>` : rows}
    </main></body></html>`;
}

function renderJournalPage(journal: JournalResult): string {
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay journal — recent loop record">${modernistStyles()}${pageStyles()}<title>Journal — recent loop record</title></head>
    <body>${renderMobileChrome("journal", "journal")}${renderSiteNav("journal")}<main>
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
//
// gap-webui-board-no-pagination: the board renders 1257 rows with no pagination and no filters.
// This adds server-side pagination (?page=N, ?pageSize=N) and status/label filtering
// (?status=<s>, ?label=<l> repeated for AND-logic), all evaluated in handleBoard against the
// joined board view and rendered server-side — no client JS (AC3). The page nav mirrors the
// /tasks handler's QW-007 pagination pattern.

// Build /board query links preserving active status/label filters and page size while changing
// the page. Mirrors buildHref (/tasks) scoped to the board's params. Zero client JS — the links
// are plain server-rendered <a href>.
function buildBoardHref(
  status: string | null,
  label: string[],
  pg: number | null,
  pageSizeOverride: number,
): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  for (const l of label) params.append("label", l);
  if (pg && pg > 1) params.set("page", String(pg));
  if (pageSizeOverride !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSizeOverride));
  const qs = params.toString();
  return qs ? `/board?${qs}` : "/board";
}

export function renderBoardPage(board: {
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
    /** True when the run has an impl-complete event (awaiting-land segment — 排队待落地). */
    awaitingLand: boolean;
  }>;
  // gap-webui-board-no-pagination: server-side pagination + status/label filter metadata.
  // Optional — a board built without it (e.g. direct renderBoardPage unit-test callers) renders
  // as a single unfiltered page (defaults applied inside the render, never a crash).
  page?: number;
  totalPages?: number;
  totalRows?: number;
  statusFilter?: string | null;
  labelFilters?: string[];
  pageSize?: number;
  pageSizeInvalid?: boolean;
}): string {
  const landingNote = board.landing.status === "ok"
    ? html`<span>落地: <code>task-status-drift-check.ts</code> · 扫描 ${board.landing.scanned} 任务</span>`
    : board.landing.status === "empty"
      ? html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>无数据</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
      : board.landing.timedOut
        // gap-webui-board-load-120s AC3 — fail-open: a subprocess that exceeded LANDING_TIMEOUT_MS
        // renders 「读取超时」 (distinct from a generic 读失败) instead of empty-waiting to the old
        // 120s hard cap.
        ? html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>读取超时</strong> — ${escapeHtml(board.landing.reason || "")}</span>`
        : html`<span>落地: <code>task-status-drift-check.ts</code> · <strong>读失败</strong> — ${escapeHtml(board.landing.reason || "")}</span>`;
  // gap-inflight-states-missing-impl-complete-event: the in-flight view splits into TWO independent
  // counts — implementing (start, no impl-complete: 真正在实现) vs awaiting-land (impl-complete, no
  // end: 排队待落地). Build dispatch reads the former; the land single-flight gate reads the latter.
  const implementingCount = board.execution.inFlight.filter((t) => t.implCompletedAtMs == null).length;
  const awaitingLandCount = board.execution.inFlight.length - implementingCount;
  const execNote = board.execution.status === "ok"
    ? html`<span>执行: <code>.workflow-events/</code> · ${implementingCount} 实现中 · ${awaitingLandCount} 待落地</span>`
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
      ? html`在飞 ${escapeHtml(r.inFlightMinutes.toFixed(1))} 分钟${r.awaitingLand ? html` · <strong>待落地</strong>` : ""}${r.execFlags.map((f) => html` · <strong>${f === "in-flight-timeout" ? "在飞超时" : "孤儿"}</strong>`).join("")}`
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

  // ── gap-webui-board-no-pagination: filter summary + page-size selector + page nav ──
  // All server-rendered: plain <a href> links and one GET form — no <script> anywhere (AC3).
  // The metadata is optional on the input board: a board object built without pagination/filter
  // fields (direct renderBoardPage callers, e.g. the load-120s AC3 fail-open unit test) renders
  // as a single unfiltered page at the default page size — never a crash.
  const page = board.page ?? 1;
  const totalPages = board.totalPages ?? 1;
  const totalRows = board.totalRows ?? board.rows.length;
  const statusFilter = board.statusFilter ?? null;
  const labelFilters = board.labelFilters ?? [];
  const pageSize = board.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSizeInvalid = board.pageSizeInvalid ?? false;
  const filterParts: string[] = [];
  if (statusFilter) {
    filterParts.push(html`status=${escapeHtml(statusFilter)} (<a href="${buildBoardHref(null, labelFilters, null, pageSize)}">clear</a>)`);
  }
  for (const l of labelFilters) {
    filterParts.push(html`label=${escapeHtml(l)} (<a href="${buildBoardHref(statusFilter, labelFilters.filter((x) => x !== l), null, pageSize)}">clear</a>)`);
  }
  const filterNav = filterParts.length > 0
    ? html`<p class="meta list-nav">Filter: ${filterParts.join(" · ")}</p>`
    : "";
  const filterForm = html`<form method="GET" style="margin:0.5rem 0 0.75rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
    <input name="status" type="text" placeholder="status (e.g. done)" value="${escapeHtml(statusFilter || "")}" style="padding:0.4rem 0.6rem;border:1px solid var(--color-divider);border-radius:4px;font-size:0.9rem;min-width:120px">
    <input name="label" type="text" placeholder="label (e.g. gap)" value="${escapeHtml(labelFilters[0] || "")}" style="padding:0.4rem 0.6rem;border:1px solid var(--color-divider);border-radius:4px;font-size:0.9rem;min-width:120px">
    <button type="submit" style="padding:0.4rem 0.8rem">Filter</button>
    ${filterParts.length > 0 ? html`<a href="/board" style="margin-left:0.25rem">clear all</a>` : ""}
  </form>`;
  const pageSizeOptions = [20, 50, 100, 250];
  const pageSizeNav = html`<p class="meta">Page size:
    ${pageSizeOptions.map((sz) =>
      sz === pageSize
        ? html`<strong>${sz}</strong>`
        : html`<a href="${buildBoardHref(statusFilter, labelFilters, null, sz)}">${sz}</a>`
    ).join(" ")}
    ${pageSizeInvalid ? html`<span class="error-banner" role="alert" style="display:inline;margin-left:0.5rem">Invalid pageSize value ignored; showing default (${DEFAULT_PAGE_SIZE}).</span>` : ""}
  </p>`;
  const pageNav = totalPages > 1 ? html`
    <p class="meta">
      ${page > 1
        ? html`<a href="${buildBoardHref(statusFilter, labelFilters, page - 1, pageSize)}">&laquo; Previous</a>`
        : html`<span class="page-nav-disabled">&laquo; Previous</span>`}
      &nbsp; Page ${page} of ${totalPages} (${totalRows} rows) &nbsp;
      ${page < totalPages
        ? html`<a href="${buildBoardHref(statusFilter, labelFilters, page + 1, pageSize)}">Next &raquo;</a>`
        : html`<span class="page-nav-disabled">Next &raquo;</span>`}
    </p>` : html`<p class="meta">Page 1 of ${totalPages} (${totalRows} rows)</p>`;

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay board — 三源 join 看板">${modernistStyles()}${pageStyles()}<title>Board — 三源 join 看板</title></head>
    <body>${renderMobileChrome("board", "board")}${renderSiteNav("board")}<main>
      <h1>Board — 意图 / 执行 / 落地</h1>
      <p class="meta">${intentNote} · ${execNote} · ${landingNote}</p>
      ${filterForm}
      ${filterNav}
      ${pageSizeNav}
      ${pageNav}
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
    landing = { status: "error", timedOut: false, reason: `internal: ${err instanceof Error ? err.message : String(err)}`, flags: new Map(), scanned: 0 };
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
      awaitingLand: inFlight ? inFlight.implCompletedAtMs != null : false,
    };
  });

  // gap-webui-board-no-pagination: server-side status/label filtering + pagination, applied to
  // the JOINED board view (provider tasks ∪ drift-flagged ids). Filter semantics mirror the
  // /tasks handler: ?status= is exact match, ?label= (repeated) is AND-logic over all labels.
  // Pagination mirrors QW-007: ?page=N (1-based, default 1), ?pageSize=N (default DEFAULT_PAGE_SIZE);
  // invalid values silently fall back to defaults. Everything below is server-side — no client JS.
  const statusFilter = url.searchParams.get("status");
  const labelFilters = url.searchParams.getAll("label").filter(Boolean);
  const filteredRows = (statusFilter || labelFilters.length > 0)
    ? rows.filter((r) =>
        (!statusFilter || r.status === statusFilter) &&
        (labelFilters.length === 0 || labelFilters.every((l) => r.labels.includes(l)))
      )
    : rows;
  const pageSizeParam = parseInt(url.searchParams.get("pageSize") || "", 10);
  const pageSizeInvalid = url.searchParams.has("pageSize") &&
    (!Number.isFinite(pageSizeParam) || pageSizeParam < 1);
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam >= 1
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;
  const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = filteredRows.slice(offset, offset + pageSize);

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderBoardPage({
    landing, execution, intentStatus, intentReason,
    rows: pageRows,
    page: safePage,
    totalPages,
    totalRows,
    statusFilter,
    labelFilters,
    pageSize,
    pageSizeInvalid,
  }));
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

// AC102: the chart's marks are coloured by token-derived CSS classes (git-svg-*, defined in
// pageStyles()) — ZERO hardcoded hex in the rendering code; the hex values live only in the
// webui-modernist.css asset. Branch identity is carried by LANE POSITION + direct label, never
// by a cycled hue (dataviz skill), so the class swap is purely mechanical.

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
    return `<line class="git-svg-grid" x1="${gx.toFixed(1)}" y1="${M.top}" x2="${gx.toFixed(1)}" y2="${H - M.bottom}" stroke-width="1" />` +
      `<text class="git-svg-muted" x="${gx.toFixed(1)}" y="${H - M.bottom + 16}" font-size="10" text-anchor="middle">${escapeHtml(tk.label)}</text>`;
  }).join("");

  const lanes = branches.map((b, i) => {
    const y = M.top + i * laneH + laneH / 2;
    const xFirst = X(b.firstT);
    const xLast = X(b.lastT);
    const seg = b.commits.length > 1
      ? `<line class="git-svg-grid" x1="${xFirst.toFixed(1)}" y1="${y.toFixed(1)}" x2="${xLast.toFixed(1)}" y2="${y.toFixed(1)}" stroke-width="2" />`
      : "";
    const points = b.commits.map((c) => {
      const cx = X(c.t);
      const tooltip = `${escapeHtml(c.hash.slice(0, 7))} · ${isoTime(c.t)} · ${escapeHtml(c.subject)}`;
      if (c.parents > 1) {
        const s = 4; // 8px diamond (the mark-spec ≥8px marker)
        return `<rect class="git-svg-merge" x="${(cx - s).toFixed(1)}" y="${(y - s).toFixed(1)}" width="${2 * s}" height="${2 * s}" transform="rotate(45 ${cx} ${y})"><title>merge ${tooltip}</title></rect>`;
      }
      return `<circle class="git-svg-commit" cx="${cx.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${tooltip}</title></circle>`;
    }).join("");
    return `<g>${seg}${points}<text class="git-svg-ink" x="${(W - M.right + 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="11">${escapeHtml(b.ref)}</text></g>`;
  }).join("");

  // In-SVG legend: the two mark kinds (merge vs regular). Identity is never color-alone — the
  // legend pairs each hue with its mark shape + label.
  const legend = `<g class="git-svg-ink" font-size="10">
    <circle class="git-svg-commit" cx="${M.left + 6}" cy="18" r="4" /><text x="${M.left + 16}" y="22">普通提交</text>
    <rect class="git-svg-merge" x="${M.left + 92}" y="14" width="8" height="8" transform="rotate(45 ${M.left + 96} 18)" /><text x="${M.left + 106}" y="22">合并提交（fan-in 落地）</text>
  </g>`;

  return `<svg class="git-svg-surface" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Git commit landing timeline; x-axis is commit landing time, not work duration" style="max-width:100%;height:auto;border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif;">
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
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay git history — commit landing timeline (server-rendered SVG, zero client JS)">${modernistStyles()}${pageStyles()}<title>Git history — commit landing timeline</title></head>
    <body>${renderMobileChrome("git", "git history")}${renderSiteNav("git")}<main>
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

// ── AC95: the six new design views (dashboard · system · manager · tests · sessions · architecture) ──
// Data access is quarantined in observation.ts; these handlers only render what it returns. Each
// handler is wrapped defensively so ANY unexpected throw degrades to a 200 page with an error note
// (never a 500), and every data source renders its own 未接入/无数据/读失败 state (AC3 — never blank/0).

const SITE_NAV_GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  { label: "核心", items: [["dashboard", "Dashboard"], ["tasks", "Tasks"]] },
  { label: "观测", items: [["live", "Live"], ["board", "Board"], ["system", "System"], ["manager", "Manager"]] },
  { label: "记录", items: [["journal", "Journal"], ["git", "Git History"], ["tests", "Tests"], ["sessions", "Sessions"]] },
  { label: "知识", items: [["adr", "ADRs"], ["goal", "Goals"], ["doc", "Docs"], ["architecture", "Architecture"]] },
];

const SITE_NAV_ROUTES: Record<string, string> = {
  dashboard: "/dashboard", tasks: "/tasks", live: "/live", board: "/board", system: "/system",
  manager: "/manager", journal: "/journal", git: "/git-history", tests: "/tests",
  sessions: "/sessions", adr: "/adr", goal: "/goal", doc: "/doc", architecture: "/architecture",
};

/** One nav item: the current page is a non-link span (red+bold via .nav-current), everything
 *  else an <a> to its route. Board carries the design's NEW badge (sc-if mkItem.badge). */
function navItem(key: string, label: string, current: string, prefix: "nav-" | "mobile-menu-"): string {
  const badge = key === "board" ? html`<span class="nav-badge">NEW</span>` : "";
  if (key === current) {
    return html`<span class="${prefix}item nav-current" aria-current="page">${escapeHtml(label)}${badge}</span>`;
  }
  return html`<a class="${prefix}item" href="${SITE_NAV_ROUTES[key]}">${escapeHtml(label)}${badge}</a>`;
}

/** Full 15-view site nav (the design's navGroupDefs) as the header bar. Rendered with the
 *  Modernist `.nav` / `.nav-brand` classes (the design system's "header bar",
 *  components/navigation.html): brand flush left, a vertical bar separating each of the four
 *  groups, the current page red+bold (sc-if mkItem: active → accent-700 + weight 800,
 *  inactive → text + weight 600), and the Board NEW badge. The `.site-nav` strip sits OUTSIDE
 *  <main> (an independent full-width bar) and is hidden on mobile — its links live in the
 *  hamburger menu (renderMobileMenu). */
export function renderSiteNav(current: string): string {
  return html`<nav class="site-nav" aria-label="Site navigation">
    <div class="nav">
      <span class="nav-brand">Quay</span>
      ${SITE_NAV_GROUPS.map((g) => html`<span class="nav-group">${
        g.items.map(([key, label]) => navItem(key, label, current, "nav-")).join("")
      }</span>`).join("")}
    </div>
  </nav>`;
}

/** Mobile full-screen menu content (the sc-if design's isMobile form): the SAME navGroupDefs
 *  as the desktop bar, but as block links under per-group section labels. */
function renderMobileMenu(current: string): string {
  return SITE_NAV_GROUPS.map((g) => html`<div class="mobile-menu-group">
    <div class="mobile-menu-group-label">${escapeHtml(g.label)}</div>
    ${g.items.map(([key, label]) => navItem(key, label, current, "mobile-menu-")).join("")}
  </div>`).join("");
}

/**
 * AC96: mobile-only chrome — a hamburger header + a checkbox-toggled full-screen nav menu.
 * This is the server-rendered equivalent of the sc-if design's isMobile form's `mobileMenuOpen`
 * state: the hidden checkbox's `:checked` state shows the menu (pure CSS, zero client JS — the
 * AC4 invariant). The wrapper is `display: none` on desktop (>600px), so it has zero desktop
 * cost; on mobile the header is sticky and the menu carries the FULL 15-view site nav so the
 * hamburger is the "go anywhere" affordance the design provides. Page label shown at right.
 */
export function renderMobileChrome(current: string, pageLabel: string): string {
  return html`<div class="mobile-chrome">
    <input type="checkbox" id="mobile-menu-toggle" class="mobile-menu-toggle-input" aria-hidden="true">
    <header class="mobile-header">
      <label for="mobile-menu-toggle" class="mobile-menu-burger" aria-label="Toggle navigation">
        <span></span><span></span><span></span>
      </label>
      <span class="mobile-header-title">Quay</span>
      <span class="mobile-header-page">${escapeHtml(pageLabel)}</span>
    </header>
    <nav class="mobile-menu" aria-label="Site navigation">
      ${renderMobileMenu(current)}
    </nav>
  </div>`;
}

function obsNote(status: string, reason: string | null): string {
  if (status === "ok") return "";
  if (status === "empty") return html`<p class="meta"><strong>未接入/无数据</strong> — ${escapeHtml(reason || "")}</p>`;
  return html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(reason || "")}</p>`;
}

// ── /system ─────────────────────────────────────────────────────────────────────────────────────────

function renderSystemPage(sys: SystemResult): string {
  const rg = sys.resourceGate;
  const pb = sys.processBudget;
  const bothOk = rg.status === "ok" && pb.status === "ok";
  const goVerdict = bothOk && rg.verdict === "GO" && pb.verdict === "GO";
  const banner = bothOk
    ? html`<div class="${goVerdict ? "success-banner" : "error-banner"}" role="status"><strong>⇒ ${goVerdict ? "GO" : "WAIT"}</strong>：${goVerdict ? "资源充足，可以跑" : "资源受限，等待"}</div>`
    : "";
  const bar = (label: string, val: number | null, limit: string | null): string => {
    const pct = val != null ? Math.min(100, Math.max(1, (val / (Number(limit) || 1)) * 100)) : 0;
    return html`<div><div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:2px">
      <span>${escapeHtml(label)}</span><span>${val != null ? escapeHtml(String(val)) : "—"}${limit ? html` <span style="color:var(--color-neutral-700)">/ ${escapeHtml(limit)}</span>` : ""}</span>
    </div>${val != null ? html`<div style="height:8px;background:var(--color-neutral-300)"><div style="height:100%;width:${pct.toFixed(1)}%;background:var(--color-text)"></div></div>` : ""}</div>`;
  };
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay system — resource gate and process budget">${modernistStyles()}${pageStyles()}<title>System — 系统状态</title></head>
    <body>${renderMobileChrome("system", "system")}${renderSiteNav("system")}<main>
      <h1>System — 系统状态</h1>
      <p class="meta">数据源：<code>resource-gate.sh --json</code> · <code>process-budget.sh --json</code>（稳定机读 JSON 输出）</p>
      ${banner}
      ${obsNote(rg.status, rg.reason)}
      <h2>resource-gate.sh</h2>
      ${rg.status === "ok" ? html`<div style="display:flex;flex-direction:column;gap:0.75rem;max-width:640px">
        ${bar("cpu_stall (avg10)", rg.cpuStallAvg10, "60")}
        ${bar("cpu_stall (avg300)", rg.cpuStallAvg300, "60")}
        ${bar("loadavg (1m)", rg.loadAvg, rg.loadThreshold != null ? `nproc×${rg.loadOverFactor ?? "?"}≈${rg.loadThreshold}` : "nproc×factor")}
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>mem_avail</span><span>${rg.memAvailMb != null ? `${escapeHtml(String(rg.memAvailMb))} MB` : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>nproc / node_procs</span><span>${rg.nproc != null ? escapeHtml(String(rg.nproc)) : "—"} / ${rg.nodeProcs != null ? escapeHtml(String(rg.nodeProcs)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>verdict</span><span>${escapeHtml(rg.verdict ?? "—")}</span></div>
      </div>` : ""}
      ${obsNote(pb.status, pb.reason)}
      <h2>process-budget.sh</h2>
      ${pb.status === "ok" ? html`<div style="display:flex;flex-direction:column;gap:0.5rem;max-width:640px">
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>total_budget</span><span>${pb.totalBudget != null ? escapeHtml(String(pb.totalBudget)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>in_use</span><span>${pb.inUse != null ? escapeHtml(String(pb.inUse)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>available</span><span>${pb.available != null ? escapeHtml(String(pb.available)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>verdict</span><span>${escapeHtml(pb.verdict ?? "—")}</span></div>
      </div>` : ""}
      <p class="meta" style="margin-top:1rem">阈值按 <code>nproc</code> 动态计算显示，不写死当前机器上的数字。</p>
    </main></body></html>`;
}

export async function handleSystem(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let sys: SystemResult;
  try {
    sys = await readSystem(cfg.workspaceRoot);
  } catch (err) {
    sys = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      resourceGate: { status: "error", reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null },
      processBudget: { status: "error", reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSystemPage(sys));
}

// ── /manager ───────────────────────────────────────────────────────────────────────────────────────

function renderManagerPage(mgr: ManagerResult): string {
  const loopCards = (label: string, statusText: string, note: string): string => html`<div style="background:var(--color-surface);padding:1rem">
    <div style="font-size:0.85rem;color:var(--color-neutral-700);margin-bottom:4px">${escapeHtml(label)}</div>
    <div style="font-weight:700">${statusText}</div>
    <p style="font-size:0.8rem;margin:4px 0 0">${escapeHtml(note)}</p>
  </div>`;

  const ld = mgr.loopDriver;
  const livenessRows = mgr.liveness.sessions.length > 0 ? html`<table>
    <tr><th>会话</th><th>alive</th><th>pid</th><th>halted</th></tr>
    ${mgr.liveness.sessions.map((s) => html`<tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.alive ? "LIVE" : "GONE"}</td>
      <td>${s.pid != null ? escapeHtml(String(s.pid)) : "—"}</td>
      <td>${s.halted ? "halted" : "—"}</td>
    </tr>`).join("\n")}
  </table>` : "";

  const observerRows = mgr.observers.rows.length > 0 ? html`<table>
    <tr><th>name</th><th>status</th><th>root</th><th>note</th></tr>
    ${mgr.observers.rows.map((r) => html`<tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td><code>${escapeHtml(r.root)}</code></td>
      <td>${escapeHtml(r.note)}</td>
    </tr>`).join("\n")}
  </table>` : "";

  const pool = mgr.pool;
  const poolNote = pool.status === "ok"
    ? html`<div style="font-family:ui-monospace,monospace;font-size:0.85rem;line-height:1.7">
        pool=${pool.pool ?? "—"} floor=${pool.floor ?? "—"} deficit=${pool.deficit ?? "—"} cap=${pool.cap ?? "—"}
        ${pool.lastPromoted.length > 0 ? html`<div style="color:var(--color-neutral-700)">最近一轮晋升（promotion-driver）：${pool.lastPromoted.map((id) => html`<a href="/task/${encodeURIComponent(id)}" style="color:var(--color-accent)">${escapeHtml(id)}</a>`).join(" · ")}</div>` : ""}
      </div>`
    : obsNote(pool.status, pool.reason);

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay manager — Manager/Outer/Inner 三层状态">${modernistStyles()}${pageStyles()}<title>Manager / Outer / Inner</title></head>
    <body>${renderMobileChrome("manager", "manager")}${renderSiteNav("manager")}<main>
      <h1>Manager / Outer / Inner — 三层状态</h1>
      <p class="meta">三层自适应探测：多信号加权判定，缺失信号诚实标注「未检测到」，不静默假设。</p>
      <h2>Loop / 会话</h2>
      ${obsNote(ld.status, ld.reason)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:2px;margin-bottom:1rem">
        ${loopCards("Loop driver", ld.verdict ?? "—", ld.detail || `exit=${ld.exitCode ?? "—"}`)}
        ${mgr.liveness.sessions.map((s) => loopCards(s.name, s.alive ? "LIVE" : "GONE", s.halted ? "halted" : s.pid != null ? `pid ${s.pid}` : "—")).join("")}
      </div>
      ${obsNote(mgr.liveness.status, mgr.liveness.reason)}
      ${livenessRows}
      <h2>Monitor 注册表</h2>
      ${obsNote(mgr.observers.status, mgr.observers.reason)}
      ${observerRows}
      <p class="meta">读 <code>observer-registry.conf</code> 单一登记表。</p>
      <h2>主要观测指标</h2>
      ${poolNote}
      <p class="meta">pool/floor/deficit/cap 读 <code>.quay/promotion-round.jsonl</code>（promotion-driver round 记录，cap 默认 5，floor = cap × 4）</p>
      <p class="meta">release=${escapeHtml(mgr.version ?? "—")} · develop 领先 ${mgr.developLead != null ? escapeHtml(String(mgr.developLead)) : "—"} 提交</p>
    </main></body></html>`;
}

export async function handleManager(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let mgr: ManagerResult;
  try {
    mgr = await readManager(cfg.workspaceRoot);
  } catch (err) {
    mgr = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      loopDriver: { status: "error", reason: null, verdict: null, exitCode: null, detail: null },
      liveness: { status: "error", reason: null, sessions: [] },
      observers: { status: "error", reason: null, rows: [] },
      pool: { status: "error", reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] },
      version: null,
      developLead: null,
    };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderManagerPage(mgr));
}

// ── /tests load curve — server-rendered SVG of the suite-load timeseries (gap-test-detail-load-timeseries) ──
//
// plugin/scripts/suite-load-sampler.ts appends one JSON line per sample — {t, loadavg, cpu_stall,
// mem_avail} — to .quay/suite-load-<runId>.jsonl while a suite runs (and stops the moment the suite
// ends). The curve plotted here is the loadavg (1m) series over the suite's elapsed time; cpu_stall
// and mem_avail ride the same samples but are not plotted (a load curve is the 1-minute load). Built
// by STRING CONCATENATION — no template engine, no new dependency, and no <script> anywhere (zero
// client JS, the same invariant as the git-history SVG). Marks carry token-derived CSS classes
// (git-svg-* / load-svg-line) — ZERO hardcoded hex.

export interface SuiteLoadSample {
  t: number; // epoch ms
  loadavg: number | null; // /proc/loadavg 1m
  cpu_stall: number | null; // /proc/pressure/cpu some avg10 %
  mem_avail: number | null; // /proc/meminfo MemAvailable, MB
}

/** Read one suite-load timeseries file; malformed lines are skipped, valid samples sorted by t. */
export function readSuiteLoadSamples(root: string, runId: string): SuiteLoadSample[] {
  const file = path.join(root, ".quay", `suite-load-${runId}.jsonl`);
  const samples: SuiteLoadSample[] = [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (!o || typeof o !== "object") continue;
      const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const t = num(o.t);
      if (t == null) continue; // a sample without a timestamp is unusable for a time series
      samples.push({ t, loadavg: num(o.loadavg), cpu_stall: num(o.cpu_stall), mem_avail: num(o.mem_avail) });
    } catch {
      // skip malformed line (never throw — the page degrades to no-curve, not a 500)
    }
  }
  return samples.sort((a, b) => a.t - b.t);
}

/** The current .quay/full-suite-state.json runId (the run the page should plot), or null. */
function readCurrentSuiteRunId(root: string): string | null {
  try {
    const j = JSON.parse(readFileSync(path.join(root, ".quay", "full-suite-state.json"), "utf8"));
    return typeof j?.runId === "string" && j.runId ? j.runId : null;
  } catch {
    return null;
  }
}

function isPlottableSample(s: SuiteLoadSample): s is SuiteLoadSample & { loadavg: number } {
  return s.loadavg != null && Number.isFinite(s.loadavg);
}

/**
 * Render the suite-run loadavg curve as a pure, dependency-free SVG string. Returns "" when there
 * are no plottable samples (the page then omits the section). Deterministic on its input.
 */
export function renderLoadCurveSvg(samples: SuiteLoadSample[]): string {
  const pts = samples.filter(isPlottableSample);
  if (pts.length === 0) return "";
  const M = { top: 24, right: 24, bottom: 44, left: 48 };
  const W = 940;
  const H = 240;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const ts = pts.map((s) => s.t);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const durSec = Math.max((t1 - t0) / 1000, 1); // single-sample still a finite plot
  const X = (t: number): number => M.left + ((t - t0) / 1000 / durSec) * plotW;

  const loads = pts.map((s) => s.loadavg);
  const yMaxRaw = Math.max(...loads);
  const yMax = yMaxRaw > 0 ? yMaxRaw * 1.15 : 1;
  const Y = (v: number): number => M.top + plotH - (v / yMax) * plotH;

  const xSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  let xStep = xSteps[xSteps.length - 1];
  const xStepRaw = durSec / 5;
  for (const s of xSteps) {
    if (s >= xStepRaw) { xStep = s; break; }
  }
  const xTicks: Array<{ x: number; label: string }> = [];
  for (let v = 0; v <= durSec; v += xStep) {
    xTicks.push({ x: X(t0 + v * 1000), label: v === 0 ? "0s" : `${v}s` });
  }
  const yTicks: Array<{ y: number; label: string }> = [];
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    yTicks.push({ y: Y(v), label: v.toFixed(1) });
  }

  const grid = [
    ...xTicks.map((tk) => `<line class="git-svg-grid" x1="${tk.x.toFixed(1)}" y1="${M.top}" x2="${tk.x.toFixed(1)}" y2="${H - M.bottom}" stroke-width="1" /><text class="git-svg-muted" x="${tk.x.toFixed(1)}" y="${H - M.bottom + 16}" font-size="10" text-anchor="middle">${escapeHtml(tk.label)}</text>`),
    ...yTicks.map((tk) => `<line class="git-svg-grid" x1="${M.left}" y1="${tk.y.toFixed(1)}" x2="${W - M.right}" y2="${tk.y.toFixed(1)}" stroke-width="1" /><text class="git-svg-muted" x="${(M.left - 6).toFixed(1)}" y="${(tk.y + 3).toFixed(1)}" font-size="10" text-anchor="end">${escapeHtml(tk.label)}</text>`),
  ].join("");
  const polyline = `<polyline class="load-svg-line" points="${pts.map((s) => `${X(s.t).toFixed(1)},${Y(s.loadavg).toFixed(1)}`).join(" ")}" />`;
  const points = pts.map((s) => {
    const d = new Date(s.t);
    const hhmmss = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return `<circle class="git-svg-commit" cx="${X(s.t).toFixed(1)}" cy="${Y(s.loadavg).toFixed(1)}" r="2.5"><title>${hhmmss} · loadavg ${s.loadavg}</title></circle>`;
  }).join("");

  return `<svg class="git-svg-surface" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Suite-run loadavg curve" style="max-width:100%;height:auto;border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif;">
${grid}
${polyline}
${points}
<text class="git-svg-ink" x="${M.left}" y="${M.top - 6}" font-size="11">loadavg (1m) · suite 运行期采样</text>
</svg>`;
}

// ── /tests ─────────────────────────────────────────────────────────────────────────────────────────

function runStatusClass(state: string | null): string {
  if (state === "green" || state === "pass") return "verdict-pass";
  if (state === "red" || state === "fail" || state === "running") return "verdict-fail";
  return "";
}

/**
 * gap-test-detail-perfile-duration-failed AC2 — render the per-file duration table for one round.
 * Sorted by duration DESC (server-side — zero client JS, same style as the git-history SVG), failed
 * files marked with the existing `verdict-fail` class (red). Empty/absent perFile ⇒ "" (no fabricated
 * table). Pure on its input, so the sort + fail-marking contract is unit-testable directly.
 */
export function renderPerFileTable(
  perFile: { file: string; durationMs: number; passed: boolean }[] | null | undefined,
): string {
  if (!perFile || perFile.length === 0) return "";
  const sorted = [...perFile].sort((a, b) => b.durationMs - a.durationMs);
  const rows = sorted.map((f) => html`<tr>
    <td><code>${escapeHtml(f.file)}</code></td>
    <td>${escapeHtml(String(Math.round(f.durationMs)))} ms</td>
    <td class="${f.passed ? "" : "verdict-fail"}" style="${f.passed ? "" : "font-weight:700"}">${f.passed ? "passed" : "failed"}</td>
  </tr>`).join("\n");
  return html`<details open style="margin-top:1rem">
    <summary style="cursor:pointer;font-weight:600">perFile 耗时明细（耗时降序 · 失败标红）</summary>
    <table style="margin-top:0.5rem">
      <tr><th>file</th><th>duration</th><th>result</th></tr>
      ${rows}
    </table>
  </details>`;
}

function renderTestsPage(tests: TestsResult, samples: SuiteLoadSample[] = []): string {
  const latest = tests.runs[0] ?? null;
  const latestBanner = latest
    ? html`<div style="border:1px solid var(--color-divider);background:var(--color-surface);padding:1rem;margin-bottom:1.5rem">
        <div style="font-weight:700;font-size:1rem"><span class="${runStatusClass(latest.state)}">${escapeHtml(latest.state ?? "unknown")}</span>${latest.scope ? ` · ${escapeHtml(latest.scope)}` : ""}</div>
        <p class="meta" style="margin:0.25rem 0">startedAt: ${escapeHtml(latest.startedAt ?? "—")} · duration: ${latest.durationMs != null ? `${escapeHtml(String(Math.round(latest.durationMs / 1000)))}s` : "—"}${latest.commit ? ` · commit <code>${escapeHtml(latest.commit.slice(0, 8))}</code>` : ""}${latest.runner ? ` · runner ${escapeHtml(latest.runner)}` : ""}${latest.buckets ? ` · buckets ${escapeHtml(latest.buckets)}` : ""}</p>
        <p class="meta" style="margin:0">tests ${latest.tests ?? "—"} · pass ${latest.pass ?? "—"} · fail ${latest.fail ?? "—"} · cancelled ${latest.cancelled ?? "—"}</p>
      </div>`
    : "";
  const historyRows = tests.runs.map((r) => html`<tr>
    <td>${r.round != null ? `#${escapeHtml(String(r.round))}` : "—"}</td>
    <td>${r.startedAt ? escapeHtml(r.startedAt) : "—"}</td>
    <td class="${runStatusClass(r.state)}" style="font-weight:700">${escapeHtml(r.state ?? "—")}</td>
    <td>${r.pass ?? "—"}/${r.fail ?? "—"}/${r.cancelled ?? "—"}</td>
    <td>${r.durationMs != null ? `${escapeHtml(String(Math.round(r.durationMs / 1000)))}s` : "—"}</td>
    <td>${r.scope ? escapeHtml(r.scope) : "—"}</td>
    <td>${r.buckets ? escapeHtml(r.buckets) : "—"}</td>
    <td>${r.commit ? html`<a href="/git-history?commit=${encodeURIComponent(r.commit)}"><code>${escapeHtml(r.commit.slice(0, 8))}</code></a>` : "—"}</td>
  </tr>`).join("\n");
  const failedRun = tests.runs.find((r) => r.fail != null && r.fail > 0 && r.failures && r.failures.length > 0);
  const failureDetails = failedRun
    ? html`<details style="margin-top:1rem">
        <summary style="cursor:pointer;font-weight:600">#${escapeHtml(String(failedRun.round))} 失败用例明细（点击展开）</summary>
        <ul style="padding-left:1.5rem;font-size:0.85rem;line-height:1.7;color:var(--color-accent-800)">
          ${failedRun.failures!.map((f) => html`<li>${escapeHtml(f)}</li>`).join("")}
        </ul>
      </details>`
    : "";
  const loadCurveSvg = renderLoadCurveSvg(samples);
  const loadCurve = loadCurveSvg
    ? html`<h2>负载曲线（最近一轮）</h2>
        <p class="meta">数据源：<code>.quay/suite-load-&lt;runId&gt;.jsonl</code>（suite 运行期采样，结束即停）</p>
        ${loadCurveSvg}`
    : "";
  // gap-test-detail-perfile-duration-failed AC2 — render the per-file table for the newest run that
  // actually carries perFile data (legacy rows have no perFile field → skipped, never fabricated).
  const perFileRun = tests.runs.find((r) => r.perFile && r.perFile.length > 0);
  const perFileTable = perFileRun ? renderPerFileTable(perFileRun.perFile) : "";
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay tests — verification rounds">${modernistStyles()}${pageStyles()}<title>Tests — 验证轮记录</title></head>
    <body>${renderMobileChrome("tests", "tests")}${renderSiteNav("tests")}<main>
      <h1>Tests — 验证轮记录</h1>
      <p class="meta">数据源：<code>.quay/verification-round.jsonl</code>（suite-state 机制写入）${tests.currentState ? html` · 当前 suite-state: <strong>${escapeHtml(tests.currentState)}</strong>` : ""}</p>
      ${obsNote(tests.status, tests.reason)}
      ${latestBanner}
      ${loadCurve}
      ${tests.runs.length > 0 ? html`<h2>历史运行（新→旧）</h2>
      <table>
        <tr><th>round</th><th>startedAt</th><th>state</th><th>pass/fail/cancel</th><th>duration</th><th>scope</th><th>buckets</th><th>commit</th></tr>
        ${historyRows}
      </table>` : ""}
      ${failureDetails}
      ${perFileTable}
    </main></body></html>`;
}

export async function handleTests(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let tests: TestsResult;
  try {
    tests = readTests(cfg.workspaceRoot);
  } catch (err) {
    tests = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, runs: [], currentState: null };
  }
  const runId = readCurrentSuiteRunId(cfg.workspaceRoot);
  const samples = runId ? readSuiteLoadSamples(cfg.workspaceRoot, runId) : [];
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderTestsPage(tests, samples));
}

// ── /sessions ──────────────────────────────────────────────────────────────────────────────────────

function renderSessionsPage(sessions: SessionsResult): string {
  const cardFor = (s: SessionDetail): string => {
    const msgHtml = s.messages && s.messages.length > 0
      ? s.messages.map((m) => html`<div style="border-left:2px solid var(--color-divider);padding-left:0.6rem;margin-bottom:0.5rem">
          <div style="font-size:0.7rem;color:var(--color-neutral-700)">${escapeHtml(m.time)} · ${escapeHtml(m.role)}</div>
          <p style="font-size:0.8rem;line-height:1.4;margin:0">${escapeHtml(m.text)}</p>
        </div>`).join("")
      : obsNote(s.transcriptStatus, s.transcriptReason);
    return html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:0.5rem;min-height:180px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <b>${escapeHtml(s.name)}</b>
        <span style="font-size:0.75rem;font-weight:700;color:${s.alive ? "var(--color-accent-700)" : "var(--color-accent-800)"}">${s.alive ? "LIVE" : "GONE"}</span>
      </div>
      <div style="font-size:0.75rem;color:var(--color-neutral-700)">${s.halted ? "halted" : s.pid != null ? `pid ${s.pid}` : "—"}</div>
      ${msgHtml}
    </div>`;
  };

  // Group by layer (Manager / Outer / Inner, plus Other for names that carry no layer marker) so
  // each section renders only its own layer's sessions — never mixed. SESSION_LAYERS covers every
  // possible layer value, so no session is dropped.
  const byLayer = new Map<SessionDetail["layer"], SessionDetail[]>();
  for (const s of sessions.sessions) {
    const list = byLayer.get(s.layer) ?? [];
    list.push(s);
    byLayer.set(s.layer, list);
  }
  const sections = SESSION_LAYERS.map(({ layer, heading }) => {
    const items = byLayer.get(layer) ?? [];
    return html`<section style="margin-bottom:1.5rem">
      <h2>${escapeHtml(heading)}</h2>
      ${items.length > 0
        ? html`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem">${items.map(cardFor).join("")}</div>`
        : html`<p class="meta">无该层会话目标</p>`}
    </section>`;
  }).join("");
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay sessions — Manager/Outer/Inner 最近会话">${modernistStyles()}${pageStyles()}<title>Sessions — 三层最近会话</title></head>
    <body>${renderMobileChrome("sessions", "sessions")}${renderSiteNav("sessions")}<main>
      <h1>Sessions — Manager / Outer / Inner 最近会话</h1>
      <p class="meta">数据源：<code>session-liveness.sh --once</code> + 会话 transcript 尾部</p>
      ${obsNote(sessions.status, sessions.reason)}
      ${sessions.sessions.length > 0 ? sections : ""}
    </main></body></html>`;
}

export async function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let sessions: SessionsResult;
  try {
    sessions = await readSessions(cfg.workspaceRoot);
  } catch (err) {
    sessions = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, sessions: [] };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSessionsPage(sessions));
}

// ── /architecture ──────────────────────────────────────────────────────────────────────────────────

interface ArchNode { label: string; x: number; y: number; w: number; h: number; highlight: "dev" | "recent" | "plain" | "stale"; fill: string; stroke: string }

function renderArchitecturePage(arch: ArchitectureResult): string {
  // Fixed diagram layout; node highlights derive from git facts (recent commits / open worktrees).
  const names = arch.components.map((c) => c.name);
  const nodeDefs: Array<{ name: string; x: number; y: number; w: number; h: number }> = [
    { name: "quay (Core)", x: 30, y: 20, w: 130, h: 44 },
    { name: "web-ui", x: 30, y: 130, w: 130, h: 44 },
    { name: "provider-abi", x: 190, y: 75, w: 130, h: 44 },
    { name: "quay-native", x: 350, y: 20, w: 120, h: 44 },
    { name: "quay-github", x: 350, y: 130, w: 120, h: 44 },
  ];
  // map design-node names → package dir names for git facts.
  const pkgByName = new Map(arch.components.map((c) => [c.name, c]));
  const recentNames = new Set(arch.components.filter((c) => c.recentCommits > 0).map((c) => c.name));
  const highlightFor = (n: string): "dev" | "recent" | "plain" | "stale" => {
    // quay (Core) is the package that owns the Web UI; quay-native/quay-github are providers.
    const pkg = n === "quay (Core)" ? pkgByName.get("quay") : pkgByName.get(n);
    if (arch.inDevelopment && n === "quay (Core)") return "dev";
    if (pkg && recentNames.has(pkg.name)) return "recent";
    if (n === "quay-github") return "stale"; // GitHub provider has had no recent write-path work (design note)
    return "plain";
  };
  const fillStroke: Record<string, [string, string]> = {
    dev: ["var(--color-accent-100)", "var(--color-accent)"],
    recent: ["var(--color-accent-100)", "var(--color-accent-700)"],
    stale: ["var(--color-neutral-200)", "var(--color-neutral-700)"],
    plain: ["var(--color-surface)", "var(--color-neutral-400)"],
  };
  const nodes: ArchNode[] = nodeDefs.map((d) => {
    const hl = highlightFor(d.name);
    const [fill, stroke] = fillStroke[hl];
    return { ...d, label: d.name, highlight: hl, x: d.x, y: d.y, w: d.w, h: d.h, fill, stroke };
  });
  const edges = [
    { x1: 95, y1: 64, x2: 95, y2: 130 },
    { x1: 95, y1: 88, x2: 190, y2: 97 },
    { x1: 255, y1: 97, x2: 350, y2: 42 },
    { x1: 255, y1: 97, x2: 350, y2: 152 },
  ];
  const svg = html`<svg viewBox="0 0 500 220" width="100%" style="background:var(--color-bg);border:1px solid var(--color-divider);border-radius:6px;max-width:100%">
    ${edges.map((e) => html`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" style="stroke:var(--color-neutral-400)" stroke-width="1.5"></line>`).join("")}
    ${nodes.map((n) => html`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" style="fill:${n.fill};stroke:${n.stroke}" stroke-width="2" rx="4"></rect>`).join("")}
    ${nodes.map((n) => html`<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2}" font-size="11" text-anchor="middle" dominant-baseline="middle" style="fill:var(--color-text)">${escapeHtml(n.label)}</text>`).join("")}
  </svg>`;
  const componentTable = arch.components.length > 0 ? html`<h2>组件最近变更（git 可证，近 ${7} 天）</h2>
    <table>
      <tr><th>组件</th><th>路径</th><th>近 7 天提交</th><th>末次提交</th></tr>
      ${arch.components.map((c) => html`<tr>
        <td>${escapeHtml(c.name)}</td>
        <td><code>${escapeHtml(c.path)}</code></td>
        <td>${c.recentCommits}</td>
        <td>${c.lastCommitAt != null ? escapeHtml(new Date(c.lastCommitAt * 1000).toISOString().slice(0, 16)) : "—"}</td>
      </tr>`).join("\n")}
    </table>` : "";
  const legend = html`<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;font-size:0.75rem;color:var(--color-neutral-700)">
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-accent-100);border:2px solid var(--color-accent)"></span> 正在开发</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-accent-100);border:2px solid var(--color-accent-700)"></span> 最近变更</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-neutral-200);border:2px solid var(--color-neutral-700)"></span> 已标记问题</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-surface);border:2px solid var(--color-neutral-400)"></span> 稳定</span>
  </div>`;
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay architecture — system component map">${modernistStyles()}${pageStyles()}<title>Architecture — 系统组件图</title></head>
    <body>${renderMobileChrome("architecture", "architecture")}${renderSiteNav("architecture")}<main>
      <h1>Architecture — 系统组件图</h1>
      <p class="meta">数据源：<code>packages/*</code>（git log 提交事实）· <code>git worktree list</code>（在飞开发）</p>
      ${obsNote(arch.status, arch.reason)}
      ${arch.status === "ok" ? legend : ""}
      ${arch.status === "ok" ? svg : ""}
      ${componentTable}
    </main></body></html>`;
}

export async function handleArchitecture(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let arch: ArchitectureResult;
  try {
    arch = readArchitecture(cfg.workspaceRoot);
  } catch (err) {
    arch = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, components: [], inDevelopment: false };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderArchitecturePage(arch));
}

// ── /dashboard ─────────────────────────────────────────────────────────────────────────────────────

function renderDashboardPage(d: {
  live: LiveResult;
  sys: SystemResult;
  mgr: ManagerResult;
  tests: TestsResult;
  history: GitHistoryResult;
  tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>;
}): string {
  const live = d.live;
  const liveStateText = live.status === "error" ? "读失败" : live.liveState === "running" ? "running" : live.liveState === "running-unwired" ? "在跑但未接遥测" : live.liveState === "not-running" ? "未在运行" : "—";
  // gap-webui-live-implcomplete-state-render (AC2): the liveCard is no longer a bare count line —
  // it renders a mini list of the first 3 in-flight tasks with a per-task state tag, so a task that
  // finished implementing but is stuck awaiting-land is visible at a glance (待落地 + duration in
  // the warning color), instead of hiding inside a "在飞 N" number.
  const liveMiniList = live.inFlight.slice(0, 3).map((t) => html`<div style="display:flex;justify-content:space-between;gap:0.5rem;font-size:0.78rem;line-height:1.4">
      <a href="/task/${encodeURIComponent(t.taskId)}" style="color:var(--color-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.taskId)}</a>
      <span style="flex:none;${t.implCompletedAtMs == null ? "color:var(--color-neutral-700)" : "color:var(--color-accent-700);font-weight:700"}">${t.implCompletedAtMs == null ? "实现中" : `待落地 ${formatAwaitingDuration(awaitingLandMs(t))}`}</span>
    </div>`).join("");
  const liveCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">循环脉搏</div>
    <div style="font-weight:800">${escapeHtml(liveStateText)}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">在飞 ${live.inFlight.length} · 并发 ${live.concurrency}</p>
    ${live.status === "ok" && live.inFlight.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-divider);padding-top:6px">${liveMiniList}</div>` : ""}
    <a href="/live" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Live →</a>
  </div>`;

  const sysGo = d.sys.resourceGate.status === "ok" && d.sys.processBudget.status === "ok" &&
    d.sys.resourceGate.verdict === "GO" && d.sys.processBudget.verdict === "GO";
  const sysCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">系统资源</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.5">cpu_stall ${d.sys.resourceGate.cpuStallAvg10 != null ? escapeHtml(String(d.sys.resourceGate.cpuStallAvg10)) : "—"} · loadavg ${d.sys.resourceGate.loadAvg != null ? escapeHtml(String(d.sys.resourceGate.loadAvg)) : "—"}</p>
    <div style="font-weight:800;color:${sysGo ? "var(--color-accent-700)" : "var(--color-accent-800)"}">⇒ ${sysGo ? "GO" : d.sys.resourceGate.status === "ok" ? "WAIT" : "未接入"}</div>
    <a href="/system" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看系统状态 →</a>
  </div>`;

  const mgrAlive = d.mgr.liveness.sessions.filter((s) => s.alive).length;
  const mgrCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Manager / Outer / Inner</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.5">loop-driver: ${escapeHtml(d.mgr.loopDriver.verdict ?? "未接入")} · ${mgrAlive} 会话 LIVE</p>
    <a href="/manager" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看三层状态 →</a>
  </div>`;

  const counts = new Map<string, number>();
  for (const t of d.tasks) {
    const s = typeof t.status === "string" ? t.status : "unknown";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const statuses = ["done", "ready", "todo", "needs-human", "superseded"];
  const total = d.tasks.length;
  const bar = (s: string): string => {
    const c = counts.get(s) ?? 0;
    const pct = total > 0 ? (c / total) * 100 : 0;
    return html`<div style="width:${pct.toFixed(1)}%;background:${s === "done" ? "var(--color-text)" : s === "needs-human" ? "var(--color-accent)" : "var(--color-neutral-400)"}" title="${escapeHtml(s)} ${c}"></div>`;
  };
  const recentActive = d.tasks
    .filter((t) => (t.status ?? "") !== "done" && typeof (t as { updatedAt?: unknown }).updatedAt === "number")
    .sort((a, b) => ((b as { updatedAt?: unknown }).updatedAt as number) - ((a as { updatedAt?: unknown }).updatedAt as number))
    .slice(0, 5);

  const latestRun = d.tests.runs[0] ?? null;
  const testsCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">测试</div>
    <div style="font-weight:800">${latestRun ? `${escapeHtml(latestRun.state ?? "—")}` : "未接入"}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">${latestRun ? `pass ${latestRun.pass ?? "—"}/${latestRun.tests ?? "—"}` : d.tests.reason ? escapeHtml(d.tests.reason) : "无验证轮记录"}</p>
    <a href="/tests" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Tests →</a>
  </div>`;

  const recentCommits = d.history.status === "ok" ? d.history.commits.slice(0, 3).map((c) => `${c.hash.slice(0, 7)} ${c.subject}`).join("<br>") : (d.history.status === "empty" ? "无提交" : "读失败");
  const commitsCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">最近提交</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.6;font-family:ui-monospace,monospace">${recentCommits}</p>
    <a href="/journal" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Journal →</a>
  </div>`;

  const taskCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">任务台账速览</div>
    <div style="display:flex;height:14px;width:100%;overflow:hidden">${statuses.map(bar).join("")}</div>
    <div style="display:flex;gap:0.75rem;font-size:0.75rem;flex-wrap:wrap;color:var(--color-neutral-700)">
      ${statuses.map((s) => html`<span><b>${counts.get(s) ?? 0}</b> ${escapeHtml(s)}</span>`).join("")}
    </div>
    ${recentActive.length > 0 ? html`<div style="border-top:1px solid var(--color-divider);margin-top:2px;padding-top:8px;display:flex;flex-direction:column;gap:4px">
      <div style="font-size:0.7rem;color:var(--color-neutral-700)">最近更新（非 done）</div>
      ${recentActive.map((t) => html`<a href="/task/${encodeURIComponent(String(t.id))}" style="display:flex;justify-content:space-between;gap:8px;text-decoration:none;color:var(--color-text);font-size:0.75rem">
        <span style="font-weight:600;color:var(--color-accent)">${escapeHtml(String(t.id))}</span>
        <span style="flex:none">${escapeHtml(String(t.status ?? ""))}</span>
      </a>`).join("")}
    </div>` : ""}
    <a href="/tasks" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看任务列表 →</a>
  </div>`;

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay dashboard — 循环脉搏、任务台账、系统资源与三层状态总览">${modernistStyles()}${pageStyles()}<title>Dashboard</title></head>
    <body>${renderMobileChrome("dashboard", "dashboard")}${renderSiteNav("dashboard")}<main>
      <h1>Dashboard</h1>
      <p class="meta">循环脉搏、任务台账、系统资源与三层调度状态的总览 — 每张卡片指向对应完整页面。</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem">${liveCard}${sysCard}${mgrCard}</div>
      <h2>工作进展</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem">${taskCard}${testsCard}</div>
      <h2>变更记录</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider)">${commitsCard}${html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Git History</div>
        <p style="margin:0;font-size:0.8rem">提交落地时间轴（服务端渲染 SVG，零客户端 JS）。</p>
        <a href="/git-history" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Git History →</a>
      </div>`}</div>
    </main></body></html>`;
}

// ── Task-summary short-TTL cache (dashboard display surface only) ────────────────────────────────
// gap-webui-dashboard-load-time-optimization AC3: the dashboard's taskCard shows only STATUS COUNTS
// + the 5 most-recently-updated non-done tasks, yet the pre-cache path called
// client.taskList({includeBody:false}) on EVERY /dashboard load — a full walkTasks() over the task
// store (listIds() → get() per id = readFileSync + statSync + YAML.parse). Measured ~89ms warm /
// ~640ms cold on the live store, plus the MCP subprocess round-trip. This cache (the poolMetricsCache
// 范式 in observation.ts: 30s TTL, keyed by workspaceRoot so two served workspaces never share a
// board) holds the whole frontmatter-only array the summary is derived from — on a hit,
// client.taskList is never called, so the provider's walkTasks never executes (the AC3 mechanical
// check). A 30s TTL bounds staleness: the dashboard is a display snapshot; the task store itself
// (which the promotion-driver writes on todo→ready) is always read fresh, never through this cache.
export const TASK_SUMMARY_CACHE_TTL_MS = 30_000;
const taskSummaryCache = new Map<string, { at: number; tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }> }>();

/** Test-hygiene handle: drop all cached task-summary readings. */
export function clearTaskSummaryCache(): void {
  taskSummaryCache.clear();
}

/** Dashboard task-summary source: client.taskList({includeBody:false}), short-TTL-cached per
 *  workspace root. On a hit the provider is not contacted, so its walkTasks() does not run (the AC3
 *  mechanical check). A failed read is NOT cached — the next load retries instead of pinning the
 *  error for the whole TTL (same fail-open policy as poolMetricsCache).
 *
 *  AC136 (gap-ac136-web-truth-source-follows-driver): the task ledger's truth source is the task
 *  store itself (tasks/*.md frontmatter) — the SAME store the promotion-driver writes on todo→ready.
 *  So a driver-completed promotion is reflected here (status count + 最近更新) within the 30s TTL,
 *  with no separate carrier read needed: reading client.taskList IS reading the driver's write
 *  target (口径一致). */
export async function readTaskSummary(
  root: string,
  client: ProviderClient,
): Promise<Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>> {
  const hit = taskSummaryCache.get(root);
  if (hit && Date.now() - hit.at < TASK_SUMMARY_CACHE_TTL_MS) return hit.tasks;
  const r = await client.taskList({ includeBody: false });
  const tasks = r.tasks ?? [];
  taskSummaryCache.set(root, { at: Date.now(), tasks });
  return tasks;
}

export async function handleDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let live: LiveResult;
  try { live = readLive(cfg.workspaceRoot); } catch {
    live = { status: "error", reason: "internal", inFlight: [], concurrency: 0, cpuPressure: null, liveState: null, liveExplanation: null, activity: null };
  }
  // AC1 + AC2 (gap-webui-dashboard-load-time-optimization): the dashboard manager probe is now
  // readManagerLight — loop-driver + liveness ONLY, NO pool probe (the pool metrics are not shown on
  // the dashboard card; /manager still runs the full readManager).
  // readSystem + the light manager probe + the (cached) task summary are independent — run them
  // CONCURRENTLY (Promise.all); client.taskList is no longer serialized AFTER the sys/mgr group
  // (the prior gap-webui-dashboard-manager-slow-parallelize shape awaited it later).
  const [sys, mgr, tasks] = await Promise.all([
    readSystem(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", resourceGate: { status: "error" as const, reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }, processBudget: { status: "error" as const, reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    })),
    readManagerLight(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", loopDriver: { status: "error" as const, reason: null, verdict: null, exitCode: null, detail: null }, liveness: { status: "error" as const, reason: null, sessions: [] }, observers: { status: "error" as const, reason: null, rows: [] }, pool: { status: "error" as const, reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] }, version: null, developLead: null,
    })),
    readTaskSummary(cfg.workspaceRoot, client).catch(() => [] as Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>),
  ]);
  let tests: TestsResult;
  try { tests = readTests(cfg.workspaceRoot); } catch {
    tests = { status: "error", reason: "internal", runs: [], currentState: null };
  }
  let history: GitHistoryResult;
  try { history = readGitHistory(cfg.workspaceRoot); } catch {
    history = { status: "error", reason: "internal", commits: [] };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderDashboardPage({ live, sys, mgr, tests, history, tasks }));
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

  // gap-webui-root-should-show-dashboard: `/` is the design's landing page → dashboard.
  // AC95 had kept `/` wired to the legacy task list; the design (state.page: 'dashboard' default,
  // navGroupDefs 核心 order [dashboard, tasks]) says dashboard lands first. `/` now 302s to the
  // canonical /dashboard, and the task list moves to its own /tasks route (still nav-reachable).
  if (url.pathname === "/") {
    res.writeHead(302, { Location: "/dashboard" });
    res.end();
    return;
  }

  if (url.pathname === "/tasks") {
    await handleTaskList(req, res, url, client, manifest);
    return;
  }

  // AC95: the six new design views. dashboard needs the provider taskList (task-ledger card);
  // the rest read workspace observation via observation.ts (mechanism scripts / git / suite-state).
  if (url.pathname === "/dashboard") {
    await handleDashboard(req, res, client, manifest, cfg);
    return;
  }

  if (url.pathname === "/system") {
    await handleSystem(req, res, cfg);
    return;
  }

  if (url.pathname === "/manager") {
    await handleManager(req, res, cfg);
    return;
  }

  if (url.pathname === "/tests") {
    await handleTests(req, res, cfg);
    return;
  }

  if (url.pathname === "/sessions") {
    await handleSessions(req, res, cfg);
    return;
  }

  if (url.pathname === "/architecture") {
    await handleArchitecture(req, res, cfg);
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

  // gap-git-history-svg-server-rendered: server-rendered git history SVG. Reads git via the same
  // workspace-observation path as /live + /journal (observation.ts shells out to git too).
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
