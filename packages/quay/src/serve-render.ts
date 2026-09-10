// serve-render.ts — shared rendering helpers, site nav, and small utilities for quay serve.
// Split from serve-handlers.ts (gap-serve-handlers-split-by-concern). Domain handlers import
// their shared render primitives from here; serve.ts and tests reach them via serve-handlers.ts.
//
// IMPORTANT: This file MUST NOT import from ./serve.ts (would create circular import).

import { readFileSync } from "node:fs";
import type { ProviderClient } from "./provider-client.ts";

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

// gap-webui-list-table-no-overflow-container: the shared data-table shell. Wrap a (possibly wide)
// list-page table element in a `.table-wrap` scroll container so it scrolls INSIDE its container
// instead of widening the page — the one shell every data-dense list page routes through, so a wide
// table is handled by a single mechanism rather than per-page width tuning. `inner` is the
// already-built table markup; pass the page's own table HTML through verbatim.
export function tableWrap(inner: string): string {
  return `<div class="table-wrap">${inner}</div>`;
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
/* gap-webui-list-table-no-overflow-container: the shared data-table shell. A wide table must
   scroll INSIDE its container (never widen the page) on desktop AND mobile alike — the pre-fix
   horizontal-scroll fallback lived only in the detail view's stylesheet (its ≤600px media query),
   so the data-dense LIST pages (/goal /live /board /needs-human /tests) had no scroll rule, and
   the base sheet's "table { display:block }" mobile hack broke the table's real layout (headers
   folded to vertical single chars). Wrapping in a plain <div class="table-wrap"> keeps the
   table's layout intact while the wrapper scrolls. ".table-wrap table { display:table }"
   (specificity 0,1,1) beats the ≤600px "table { display:block }" (0,0,1), so a wrapped table is
   never display:block. */
.table-wrap {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.table-wrap table {
  display: table;
  min-width: 100%;
}
.table-wrap th { white-space: nowrap; }
/* Prose column clamp: a long prose cell must not blow the table to viewport width. The full text
   stays reachable via the cell's title attribute / the detail page. */
.clamp {
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
button:hover { background: var(--color-accent-800); }
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
  /* gap-webui-list-table-no-overflow-container: long unbreakable inline code (a commit hash,
     a long path, a criterion shell one-liner in /journal) must wrap instead of widening the page
     past the viewport on mobile — same wrap the detail view already gets on its inline-code rule. */
  overflow-wrap: anywhere;
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
/* AC4 (gap-webui-a11y-focus-ring-and-token-contrast-unvalidated): skip-link — the FIRST tab
   stop on every page, visually hidden until focused. It targets <main id="main"> so keyboard
   users skip the 15-item site nav straight to the page content. Off-screen via transform (kept
   in the tab order), revealed on :focus; the same :focus outline rule from the Modernist sheet
   makes the revealed link visible. */
.skip-link {
  position: absolute;
  top: 0;
  left: 0;
  transform: translateY(-100%);
  background: var(--color-bg);
  color: var(--color-accent);
  padding: var(--space-2) var(--space-3);
  z-index: 100;
  font-weight: 600;
}
.skip-link:focus { transform: translateY(0); }
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
   and the detail pages (detailStyles()) — pass uses the positive (green) hue, fail stays
   in the accent (red-orange) family. */
.verdict-pass { color: var(--color-positive-700); }
.verdict-fail { color: var(--color-accent-800); }
/* AC102: git-history SVG mark colours — token-derived so the client-rendered chart carries
   no hardcoded hex. The hex values live only in webui-modernist.css, except the per-lane
   categorical palette (gap-git-graph-lane-visual-encoding-and-fixed-width), whose hex lives in
   serve-git.ts and is emitted per-page as a scoped --color-lane-* token sheet (gitGraphLaneTokenCss)
   — the renderer script references the tokens, never the hex. */
.git-svg-surface { background: var(--color-neutral-100); }
/* grid stays the faint neutral-200 (real grid lines only) — the trunk axis is .git-svg-trunk. */
.git-svg-grid { stroke: var(--color-neutral-200); }
/* trunk vertical spine: a visible dark neutral (the old grid neutral-200 measured 1.13:1 on the
   surface and was invisible at 2x zoom). neutral-700 also holds ≥4.5:1 against both text
   backgrounds, so the matching legend glyph is not a text-contrast violation. */
.git-svg-trunk { stroke: var(--color-neutral-700); }
.git-svg-commit { fill: var(--color-accent-600); }
.git-svg-merge { fill: var(--color-accent-2-500); }
.git-svg-ink { fill: var(--color-text); }
.git-svg-muted { fill: var(--color-neutral-600); }
/* gap-git-history-collapse-commits: a dense lane collapses to its endpoints + a summary label
   ("N commits · T span"); the full per-commit marks live in .git-svg-lane-points and are revealed
   on :hover — pure CSS, so the AC4 zero-client-JS invariant holds. */
.git-svg-lane-points { display: none; }
.git-svg-lane-collapsed:hover .git-svg-lane-points { display: inline; }
.git-svg-lane-collapsed:hover .git-svg-collapsed-label { display: none; }
/* AC102 (same token discipline): suite-load curve stroke — token-derived, no hardcoded hex.
   Surface/grid/ink/muted reuse the git-svg-* classes above (they are generic chart tokens). */
.load-svg-line { fill: none; stroke: var(--color-accent-600); stroke-width: 2; }
/* gap-test-detail-timeline AC2 — the per-file timeline bars are token-derived (no hardcoded hex),
   reusing the git-svg-* surface/grid/ink/muted tokens for the chart frame. Passed bars use the
   accent ramp; failed bars use the darker step (same fail-vs-pass shade language as verdict-fail). */
.gantt-svg-bar { fill: var(--color-accent-600); }
.gantt-svg-bar-fail { fill: var(--color-accent-800); }
/* gap-webui-bucket-color-distinction — the Gantt timeline bars are bucket-coloured: HUE = bucket
   (P 产品 / S 套件 / M 机件 / multi 多桶 / unresolved 未解析), SHADE = pass/fail (the fail step reuses
   gantt-svg-bar-fail as a darker modifier of the same bucket family, so the two-class selector below
   beats the bare .gantt-svg-bar-fail). Token-derived, zero hardcoded hex. */
.gantt-bucket-P { fill: var(--color-accent-600); }
.gantt-bucket-P.gantt-svg-bar-fail { fill: var(--color-accent-800); }
.gantt-bucket-S { fill: var(--color-accent-2-500); }
.gantt-bucket-S.gantt-svg-bar-fail { fill: var(--color-accent-2-800); }
.gantt-bucket-M { fill: var(--color-neutral-500); }
.gantt-bucket-M.gantt-svg-bar-fail { fill: var(--color-neutral-700); }
.gantt-bucket-multi { fill: color-mix(in srgb, var(--color-accent-600) 45%, var(--color-accent-2-500)); }
.gantt-bucket-multi.gantt-svg-bar-fail { fill: var(--color-neutral-800); }
.gantt-bucket-unresolved { fill: var(--color-neutral-300); }
.gantt-bucket-unresolved.gantt-svg-bar-fail { fill: var(--color-neutral-500); }
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
  color: var(--color-neutral-700);
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
/* gap-webui-detail-page-head-drops-pagestyles AC4: long unbreakable inline code (e.g. a goal
   detail's criterion shell command in the .meta line) must wrap on the 390px mobile form —
   otherwise it widens the page past the viewport and re-introduces a horizontal scrollbar
   (scrollWidth > clientWidth) even after the double-nav is gone. overflow-wrap: anywhere
   breaks only the tokens that would otherwise overflow; pre code is unaffected (its pre
   keeps white-space: pre, which disables wrapping). */
.detail-page code { overflow-wrap: anywhere; }
.detail-page table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: var(--space-3); }
.detail-page th {
  text-align: left; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-neutral-700);
  padding: var(--space-2); border-bottom: 2px solid var(--color-divider);
}
.detail-page td { padding: var(--space-2); border-bottom: 1px solid var(--color-divider); }
.verdict-pass { color: var(--color-positive-700); }
.verdict-fail { color: var(--color-accent-800); }
@media (max-width: 600px) {
  .detail-page main { padding: var(--space-4) var(--space-3); }
  .detail-page table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .detail-page h1 { font-size: 26px; }
}
</style>`;
}

// gap-webui-detail-page-head-drops-pagestyles: the page SHELL's styles are now ONE atomic entry —
// a page cannot render the nav markup (renderSiteNav / renderMobileChrome) without the sheet that
// makes it visible. pageStyles() carries the .nav-* + .mobile-chrome rules AND the ≤600px @media
// overrides (`.mobile-chrome { display:none }` desktop / `display:block` mobile; `.site-nav { display:none }`
// mobile); detailStyles() has only .detail-page typography — ZERO nav rules. gap-ac100 swapped
// pageStyles()→detailStyles() on the three detail pages ("换成" not "追加"), which DROPPED the shell:
// bare nav on desktop, double nav + horizontal overflow on mobile. shellStyles(kind) ALWAYS includes
// the shell (modernistStyles + pageStyles); the "detail" kind layers detail typography ON TOP (last
// wins). A page rendered with shellStyles("detail") can never lose the nav/mobile-chrome rules.
export function shellStyles(kind: "list" | "detail" = "list"): string {
  const detail = kind === "detail" ? detailStyles() : "";
  return `${modernistStyles()}${pageStyles()}${detail}`;
}

// QW-002: minimal inline markdown-to-HTML renderer. Handles the constructs
// found in quay task bodies: fenced code blocks, ATX headings (#/##/###),
// bold (**...**), inline code (`...`), unordered lists (- item), ordered
// lists (1. item), horizontal rules (---/***), and paragraph breaks.
// Uses a line-by-line state machine; no external dependency.
// gap-webui-goal-detail-no-entity-links: two backward-compatible opt-ins on renderMarkdown
// (default opts reproduce the exact pre-task output, so the task page and /live are untouched):
//   - `headingOffset` (default 1): the ATX '#' count's offset. The task detail page keeps the
//     historical `# → h2, ## → h3` demotion ("h1 is the page title"); the three ENTITY detail
//     pages (/goal /adr /doc) pass 0 so a body `## Section` renders as `<h2>` and never skips
//     straight from the page `<h1>` to `<h3>` (AC5).
//   - `linkResolver` (default undefined): when set, bare entity ids (AC-?\d+ / GOAL-\d+ / DIR-\d+
//     / ADR-\d+) the resolver maps to an href are turned into `<a>` links; ids the resolver
//     rejects stay plain text (AC3 — never fabricate a dead link).
export interface RenderMarkdownOpts {
  linkResolver?: (id: string) => string | null;
  headingOffset?: number;
}

// Entity-id shape shared by the three entity detail pages' body back-links. `AC-?` admits both
// the prose form "AC156" (no dash) and the canonical "AC-156" — the resolver normalizes to the
// canonical id before its existence lookup.
const ENTITY_REF_RE = /\b(AC-?\d+|GOAL-\d+|DIR-\d+|ADR-\d+)\b/g;

// Pure linkifier: turn every entity-shaped token for which `hrefFor` returns a non-null href into
// an <a>; leave the rest as plain text (AC3 — a non-existent id must never become a dead link).
export function linkifyEntities(text: string, hrefFor: (id: string) => string | null): string {
  return text.replace(ENTITY_REF_RE, (match, id: string) => {
    const href = hrefFor(id);
    return href ? `<a href="${escapeHtml(href)}">${id}</a>` : match;
  });
}

export function renderMarkdown(text: string | undefined | null, opts: RenderMarkdownOpts = {}): string {
  const headingOffset = opts.headingOffset ?? 1;
  const linkResolver = opts.linkResolver;
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
          `<li class="task-list-item"><input type="checkbox" disabled${checked ? " checked" : ""}> ${inlineMarkdown(cbm[2], opts)}</li>`
        );
      } else {
        out.push(`<li>${inlineMarkdown(item, opts)}</li>`);
      }
    }
    out.push(`</${tag}>`);
    listBuf = [];
    inList = null;
  }

  function flushPara(): void {
    if (paraBuf.length === 0) return;
    const text2 = paraBuf.join(" ");
    if (text2.trim()) out.push(`<p>${inlineMarkdown(text2, opts)}</p>`);
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
      const lvl = hm[1].length + headingOffset; // default # → h2, ## → h3 (task page); detail pages pass 0 → ## → h2
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
export function inlineMarkdown(text: string, opts: RenderMarkdownOpts = {}): string {
  // Process segments: alternate between code spans and the rest.
  const parts = text.split(/(`[^`]*`)/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Code span — entity ids inside code are code, never links.
      const inner = part.slice(1, -1);
      return `<code>${escapeHtml(inner)}</code>`;
    }
    // Regular text: escape HTML, then apply bold/italic, then linkify entity ids.
    let s = escapeHtml(part);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    if (opts.linkResolver) s = linkifyEntities(s, opts.linkResolver);
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

export type Manifest = Awaited<ReturnType<ProviderClient["manifest"]>>;

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
// ── AC95: the six new design views (dashboard · system · manager · tests · sessions · architecture) ──
// Data access is quarantined in observation.ts; these handlers only render what it returns. Each
// handler is wrapped defensively so ANY unexpected throw degrades to a 200 page with an error note
// (never a 500), and every data source renders its own 未接入/无数据/读失败 state (AC3 — never blank/0).

const SITE_NAV_GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  { label: "核心", items: [["dashboard", "Dashboard"], ["tasks", "Tasks"]] },
  { label: "观测", items: [["live", "Live"], ["board", "Board"], ["system", "System"], ["manager", "Manager"], ["needs-human", "Needs Human"]] },
  { label: "记录", items: [["journal", "Journal"], ["git", "Git History"], ["tests", "Tests"], ["sessions", "Sessions"]] },
  { label: "知识", items: [["adr", "ADRs"], ["goal", "Goals"], ["doc", "Docs"], ["architecture", "Architecture"]] },
];

const SITE_NAV_ROUTES: Record<string, string> = {
  dashboard: "/dashboard", tasks: "/tasks", live: "/live", board: "/board", system: "/system",
  manager: "/manager", "needs-human": "/needs-human", journal: "/journal", git: "/git-history", tests: "/tests",
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
/** AC4 (gap-webui-a11y-focus-ring-and-token-contrast-unvalidated): skip-link — the first
 *  keyboard tab stop on every page, jumping straight to <main id="main">. Emitted as the FIRST
 *  element of the site nav so every page that renders renderSiteNav gets it with zero per-page
 *  churn; the .skip-link class (pageStyles) keeps it visually hidden until :focus. */
export function renderSkipLink(): string {
  return html`<a class="skip-link" href="#main">跳到主要内容</a>`;
}

export function renderSiteNav(current: string): string {
  return html`${renderSkipLink()}<nav class="site-nav" aria-label="Site navigation">
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

// gap-webui-goal-detail-no-entity-links (AC4): the three entity detail pages (/goal /adr /doc)
// each render a "back to the list" link as the FIRST element of <main> — previously none of them
// had any way back to their list (main a[href="/goal"] did not exist). One shared helper, one
// href each, so the affordance stays consistent and is never re-invented per page.
export function renderBackLink(href: string): string {
  return html`<p class="meta"><a class="back-link" href="${href}">← 返回列表</a></p>`;
}

// ── Small shared helpers used by multiple domain handlers ────────────────────

/** Zero-pad to two digits (shared by /git-history timestamps and /tests timeline labels). */
export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Observation-state note — "未接入/无数据" for empty, "读失败" for error, "" for ok. */
export function obsNote(status: string, reason: string | null): string {
  if (status === "ok") return "";
  if (status === "empty") return html`<p class="meta"><strong>未接入/无数据</strong> — ${escapeHtml(reason || "")}</p>`;
  return html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(reason || "")}</p>`;
}
