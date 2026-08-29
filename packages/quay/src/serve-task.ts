// serve-task.ts — /tasks + /task/<id> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import type { Manifest } from "./serve-render.ts";
import {
  html, escapeHtml, stripHeadings, pageStyles, modernistStyles, renderMarkdown,
  relativeTime, isSafeRelativeRedirect, DEFAULT_PAGE_SIZE, buildHref, isMissingIdTask,
  renderSiteNav, renderMobileChrome,
} from "./serve-render.ts";
import {
  readWorkerOutcomeRecords, isValidSessionId, readLiveWorkerProcesses, liveSessionIdForPid,
  workerDriverActive,
} from "./observation.ts";
import type { LiveWorker } from "./observation.ts";

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
  // payload from ~5.7MB (all task bodies) to ~0.3MB (frontmatter only) —
  // the dominant cost of the "MCP round-trip + rendering" half of this route.
  //
  // gap-serve-search-timeout-all-body-fetch: when ?q= IS active we previously
  // requested EVERY body (`includeBody: true`) so the client-side filter below
  // could search body text — with 1572 tasks that payload timed out the MCP
  // round-trip (-32001) and the search rendered 0 rows. Now the search is
  // pushed DOWN to the Provider: task_list accepts a `search` param that filters
  // title+body server-side, so the round-trip carries only the matches (whose
  // bodies default to included — a handful, not 1572). The client-side filter
  // below is kept because a Provider that does not implement `search` (e.g.
  // quay-github) still returns the full list and the local filter is the correct
  // search for it; for a Provider that DID filter, re-filtering the
  // already-scoped matches is an idempotent no-op.
  // (The qFilter read is duplicated below where it drives filtering; reading
  // the URLSearchParams twice is cheap and keeps the two uses independent.)
  const qFilter = url.searchParams.get("q") || null;
  const { tasks: allTasks, malformed } = await client.taskList(
    qFilter ? { search: qFilter } : { includeBody: false }
  );
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

/** Render the Runs block for /task/<id> — the worker-outcome records for THIS task, one row per
 *  attempt (gap-webui-task-runs-block AC1). Reads `.quay/worker-outcome.jsonl` via the observation
 *  facade and reuses the transcript-access validation (isValidSessionId) + the existing /session
 *  endpoint rather than re-implementing read/validation (AC3 — no second implementation).
 *
 *  gap-task-detail-runs-block-inflight-session-link: the outcome carrier is written only at worker
 *  END, so a still-running worker (no END record yet) is structurally invisible to the records above.
 *  Surface it from the /proc live-process signal — the SAME path /live uses — and reuse
 *  liveSessionIdForPid to join pid → live transcript session id (the /live-clickable link, now
 *  mirrored here). The auto-scan is gated on the worker driver being active for THIS root (a
 *  non-worker workspace never scans /proc, which would surface OTHER workspaces' workers); the
 *  `liveWorkers` test seam bypasses the gate, and `sessionHome` makes the pid→sessionId join testable. */
export function taskRunsBlock(
  root: string,
  taskId: string,
  opts: { liveWorkers?: LiveWorker[] | null; sessionHome?: string } = {},
): string {
  const records = readWorkerOutcomeRecords(root).filter((r) => r.task === taskId);

  const live = opts.liveWorkers ?? (workerDriverActive(root) ? readLiveWorkerProcesses("/proc") : []);
  const inFlight = live.filter((w) => w && w.taskId === taskId);

  if (records.length === 0 && inFlight.length === 0) {
    return html`<h2>Runs</h2><p class="meta">无 worker 运行记录（<code>.quay/worker-outcome.jsonl</code>）</p>`;
  }

  const inFlightRows = inFlight.map((w) => {
    const started = w.startedAtMs != null ? new Date(w.startedAtMs).toISOString() : "—";
    const sessionId = liveSessionIdForPid(w.pid, opts.sessionHome);
    const transcript = sessionId != null
      ? html`<a href="/session/${encodeURIComponent(sessionId)}">view</a> · <a href="/session/${encodeURIComponent(sessionId)}/download">download</a>`
      : "—";
    return html`<tr>
      <td>${escapeHtml(started)}</td>
      <td><strong>进行中</strong></td>
      <td>—</td>
      <td>—</td>
      <td>${escapeHtml(w.pid)}</td>
      <td><code>${escapeHtml(`worker-${w.taskId}`)}</code></td>
      <td>${transcript}</td>
    </tr>`;
  }).join("\n");

  const rows = records.map((r) => {
    const exit = r.exit_code != null ? String(r.exit_code) : r.signal != null ? `signal ${r.signal}` : "—";
    const wall = r.wall_clock_ms != null ? `${r.wall_clock_ms}ms` : "—";
    const state = r.failure_reason != null
      ? html`${escapeHtml(r.final_state ?? "?")}<br><span style="font-size:0.75rem;color:var(--color-neutral-700)">${escapeHtml(r.failure_reason)}</span>`
      : escapeHtml(r.final_state ?? "?");
    const transcript = r.session_id != null && isValidSessionId(r.session_id)
      ? html`<a href="/session/${encodeURIComponent(r.session_id)}">view</a> · <a href="/session/${encodeURIComponent(r.session_id)}/download">download</a>`
      : "—";
    return html`<tr>
      <td>${escapeHtml(r.started_at ?? "—")}</td>
      <td>${state}</td>
      <td>${escapeHtml(exit)}</td>
      <td>${escapeHtml(wall)}</td>
      <td>${r.worker_pid != null ? escapeHtml(String(r.worker_pid)) : "—"}</td>
      <td><code>${escapeHtml(r.run_id ?? "—")}</code></td>
      <td>${transcript}</td>
    </tr>`;
  }).join("\n");
  return html`<h2>Runs</h2>
    <table>
      <tr><th>started</th><th>state</th><th>exit</th><th>wall</th><th>worker pid</th><th>run id</th><th>transcript</th></tr>
      ${inFlightRows}
      ${rows}
    </table>`;
}

export async function handleTaskDetail(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  taskId: string,
  client: ProviderClient,
  cfg: { workspaceRoot: string },
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
      ${taskRunsBlock(cfg.workspaceRoot, taskId)}
      <h2 class="sr-only">Details</h2>
      <div class="body">${renderMarkdown(t.body)}</div>
    </main></body></html>`);
}
