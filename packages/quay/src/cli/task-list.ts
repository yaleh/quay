// cli/task-list.ts — `quay task list` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change (golden-replay
// equivalence verified in packages/quay/test/cli.test.mjs).

import { withProvider, printJson, resolvePageSize, stripHeadings, relativeTimeCli } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleTaskList({ flags, positional, wantsJson }: CliCtx) {
  // QX-005: task list --help is caught above by the sub === "--help" branch.
  // UQ-047/UQ-048: --page-size validated up front — invalid values (0, -1,
  // "abc") are a hard error, not a silent "show everything" fallback.
  const { pageSize, error: pageSizeError } = resolvePageSize(flags);
  if (pageSizeError) {
    console.error(pageSizeError);
    process.exitCode = 1;
    return;
  }
  await withProvider(async (client) => {
    // QX-021/QX-023/QX-028: --search matches title + heading-stripped body. Its
    // value is read BEFORE the fetch because it is now PUSHED DOWN to the
    // Provider as a server-side filter (gap-stripheadings-quadruple-duplication-
    // cli-task-list-client-filter).
    const searchQuery = typeof flags.search === "string" ? flags.search : null;
    // QX-006 (experiment 4, iteration 1): guard against `--prefix` passed with
    // no value. parseFlags() sets flags.prefix = true (boolean) in that case,
    // which would throw a TypeError (SH-001 regression from QX-002). Detect early
    // and exit with a clear usage error. Read before the fetch because the value
    // now feeds the Provider filter.
    const prefix = flags.prefix;
    if (prefix !== undefined && typeof prefix !== "string") {
      console.error("Error: --prefix requires a value (e.g., --prefix QX)");
      process.exitCode = 1;
      return;
    }
    // QX-037 (experiment 4, iteration 10): UQ-021 — guard --label with no value.
    // parseFlags() sets flags.label = true (boolean) when --label is passed with no
    // value. Inconsistency with --prefix (which exits 1) filed as UQ-021; fix mirrors
    // QX-006. [].concat(flags.label).filter(Boolean) below would silently drop a
    // boolean true, producing no label filter — even more confusing than a crash.
    const rawLabel = flags.label;
    if (rawLabel !== undefined && typeof rawLabel !== "string" && !Array.isArray(rawLabel)) {
      console.error("Error: --label requires a value (e.g., --label experiment-4)");
      process.exitCode = 1;
      return;
    }
    // QX-016 (experiment 4, iteration 4): flags.label may be undefined (no
    // filter), a string (single --label), or an array of strings (repeated
    // --label, collected by parseFlags). [].concat(...).filter(Boolean) normalises
    // all three cases to an array for the AND-join.
    const labelFilters = [].concat(flags.label).filter(Boolean);
    // ── PUSH THE FILTERS DOWN ─────────────────────────────────────────────────
    // gap-stripheadings-quadruple-duplication-cli-task-list-client-filter: this
    // command used to fetch EVERY task (bodies included) and then re-apply prefix
    // / label / search matching in TypeScript — a second, client-side copy of
    // predicates the Provider's own task_list already applies (the native store's
    // `matchesListFilter`: status → label → prefix → search, the SAME order and
    // predicates, including the heading-stripped body search). Now the filters go
    // to the Provider and only the matching set crosses the ABI.
    //
    // gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp (follow-up):
    // the table view renders id/status/role/title/updatedAt — never a body — so it
    // asks for the frontmatter-only projection (`includeBody:false`, the same one
    // the web board / dashboard / /tasks page use). `--json` DOES print the task
    // objects, body included, so it keeps the full shape.
    const wantBodiesInOutput = wantsJson === true;
    // ── PUSH THE PAGE DOWN ────────────────────────────────────────────────────
    // gap-cli-task-list-page-size-post-hoc-slice-not-pushed-down: `--page-size`
    // used to be a POST-HOC slice — every matching task was fetched (bodies
    // included, per `wantBodiesInOutput`) and then `.slice(0, N)` threw almost
    // all of it away. The Provider ABI already has a two-phase paged read
    // (native store `queryPage`: phase 1 resolves the matching id set WITHOUT
    // bodies, phase 2 reads bodies for the page WINDOW only), and Core's MCP
    // `task_list` handler already pushes `page`/`pageSize` down and trusts
    // `paged:true` (mcp-handlers.ts). This command never did — the same fix,
    // applied to the last consumer still full-fetch-then-slicing.
    //
    // ⛔ NOT pushed down when `--sort` is requested: a page of the Provider's
    // own order is NOT the top-N of a SORTED view (top-N by `updatedAt` needs
    // the WHOLE filtered set to sort first). Pushing the page there would
    // silently change WHICH tasks are shown, so a sorted request keeps the
    // pre-existing full fetch + local sort + local slice. Correctness over cost,
    // and only for the narrower already-slow sorted case.
    const sortKey = flags.sort;
    const canPushPage = pageSize != null && sortKey === undefined;
    const providerFilter: Record<string, unknown> = {};
    if (flags.status !== undefined) providerFilter.status = flags.status;
    if (labelFilters.length === 1) providerFilter.label = labelFilters[0];
    // >1 label: the array form is what the AND-join needs; a Provider whose schema
    // rejects arrays falls into the catch below rather than failing the read.
    else if (labelFilters.length > 1) providerFilter.label = labelFilters;
    if (prefix) providerFilter.prefix = prefix;
    if (searchQuery) providerFilter.search = searchQuery;
    if (!wantBodiesInOutput) providerFilter.includeBody = false;
    // `page` stays 1 — the CLI has no --page flag. The window is the ONLY thing
    // the Provider must read bodies for, so `--json --page-size N` costs N body
    // reads, not the store's (store.ts `queryPage` phase 2).
    if (canPushPage) providerFilter.pageSize = pageSize;
    // ── did the Provider actually apply them? ─────────────────────────────────
    // A Provider that implements the pushed-down filter surface reports the
    // FILTERED `total` and a `scannedFiles` boolean (the native store always
    // does). One whose task_list schema knows only status/label silently DROPS
    // the rest and reports neither — the signal that the filters were NOT applied
    // and must be re-applied here (硬规则 3b: a silently-ignoring Provider must
    // not be confused with one that filtered). A Provider whose schema REJECTS an
    // extended arg instead of dropping it throws the whole call: same fallback.
    // Either way the caller gets a correct answer; only the cost differs.
    //
    // The page has its OWN sentinel: `paged:true` (native store: `pageSize` was
    // sent and applied). A Provider that applied the filters but IGNORED
    // `pageSize` (or an older build whose schema dropped it) sets no `paged` —
    // that is the honest "not paged" signal, and the local slice below still
    // produces the right answer (硬规则 3b: "did not page" must not read as
    // "paged with everything").
    let listRes;
    let providerFiltered = false;
    // `providerPaged` is the Provider's own signal that `listRes.tasks` is
    // already the requested WINDOW of the filtered set — so it must NOT be
    // sliced again below, and `total` (not `tasks.length`) is the filtered
    // count the header reports. Mirrors mcp-handlers.ts's trust-`paged` shape.
    let providerPaged = false;
    try {
      const first = await client.taskList(providerFilter);
      if (canPushPage && first.paged === true) {
        listRes = first;
        providerFiltered = true;
        providerPaged = true;
      } else if (typeof first.total === "number" && typeof first.scannedFiles === "boolean") {
        listRes = first;
        providerFiltered = true;
      }
    } catch { /* fall through to the fallback fetch below */ }
    if (!providerFiltered) {
      // Client-side fallback — the pre-existing behaviour, kept for Providers that
      // do not implement the optional filter args. Bodies are requested only when
      // the OUTPUT (--json) or a client-side `search` must read them.
      // gap-one-unparseable-task-takes-down-the-whole-board: taskList() returns
      // partial success { tasks, malformed }; the unparseable files are reported
      // on stderr below — never silently dropped, never treated as "0 tasks".
      const needBodies = wantBodiesInOutput || searchQuery !== null;
      listRes = await client.taskList(
        needBodies ? { status: flags.status } : { status: flags.status, includeBody: false }
      );
    }
    const { tasks, malformed } = listRes;
    // When the Provider applied status → label → prefix → search (the pushed-down
    // path), a second pass here would merely re-implement the same predicates.
    // Only the fallback path filters locally (QX-002 prefix / QX-016 AND-label /
    // QX-028 heading-stripped body search — the same semantics either way).
    const filtered = providerFiltered
      ? tasks
      : tasks
          .filter((t) => !prefix || t.id.toUpperCase().startsWith(prefix.toUpperCase()))
          .filter((t) =>
            labelFilters.length === 0 ||
            (Array.isArray(t.labels) && labelFilters.every((l) => t.labels.includes(l)))
          )
          .filter((t) =>
            !searchQuery ||
            (t.title + " " + stripHeadings(t.body)).toLowerCase().includes(searchQuery.toLowerCase())
          );
    // QX-008 (experiment 4, iteration 2): sort-by-updated support.
    // Closes CB-004 (no sort-by-time on CLI) and CB-012 (--sort updated
    // silently ignored). Tasks include `updatedAt` (file mtime in ms) from
    // the provider (quay-native's store.js list() path). Sort descending
    // (most-recently-modified first). Tasks without updatedAt (e.g. from a
    // provider that doesn't expose it) sort after those that have it.
    // `sortKey` was read up top, where it also decided whether the page could
    // be pushed down (a SORTED view cannot push a page — see the note there).
    let sorted;
    if (sortKey === "updated") {
      sorted = filtered.slice().sort((a, b) => {
        const ta = typeof a.updatedAt === "number" ? a.updatedAt : -Infinity;
        const tb = typeof b.updatedAt === "number" ? b.updatedAt : -Infinity;
        return tb - ta; // descending: most-recent first
      });
    } else if (sortKey === "id") {
      sorted = filtered.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    } else if (sortKey === "status") {
      sorted = filtered.slice().sort((a, b) =>
        a.status < b.status ? -1 : a.status > b.status ? 1 :
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      );
    } else {
      sorted = filtered; // insertion order (default)
    }
    // CB-006/CB-022/UQ-047 (M08-merge-recover): --page-size N truncates to
    // the first N tasks (post-filter, post-sort), applied identically in
    // BOTH output modes below — this is the printJson(sorted) bug fix
    // (previously the full array was always printed in JSON mode
    // regardless of --page-size).
    //
    // ⛔ When the Provider already applied the page (`providerPaged`) `sorted`
    // IS the window: slicing it again is a no-op, and `total` — not the window
    // length — is the filtered count (so the "# showing N of M" header stays
    // truthful). The local slice is the FALLBACK path for a Provider that
    // ignored the pushed-down `pageSize` (or whose schema rejected it).
    const totalCount =
      providerPaged && typeof listRes.total === "number" ? listRes.total : sorted.length;
    const paged = pageSize != null && !providerPaged ? sorted.slice(0, pageSize) : sorted;
    // gap-one-unparseable-task-takes-down-the-whole-board: report unparseable
    // task files on stderr (so --json stays parseable) instead of silently
    // dropping them or letting them 500 the whole list.
    if (malformed.length > 0) {
      console.error(`Warning: ${malformed.length} task file(s) could not be parsed and were excluded from the list:`);
      for (const m of malformed) console.error(`  ${m.file}: ${m.error}`);
    }
    if (wantsJson) {
      printJson(paged);
    } else {
      // QX-021 (iteration 5): show active search query in header line.
      // QX-022 (iteration 5): include "updated" timestamp as rightmost column.
      if (prefix) console.log(`# filtered: ${prefix.toUpperCase()}-* (${totalCount} tasks)${searchQuery ? ` --search "${searchQuery}"` : ""}`);
      else if (searchQuery) console.log(`# search: "${searchQuery}" (${totalCount} matches)`);
      if (pageSize != null && pageSize < totalCount) {
        console.log(`# showing ${paged.length} of ${totalCount} tasks (--page-size ${pageSize})`);
      }
      for (const t of paged) {
        const updatedStr = typeof t.updatedAt === "number" ? relativeTimeCli(t.updatedAt) : "—";
        console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}\t${updatedStr}`);
      }
      // QX-025 (experiment 4, iteration 6): zero-result hint when --search
      // returns nothing — users often search for a label name and are confused
      // by an empty result with no guidance. Closes UQ-024 (minor).
      if (paged.length === 0 && searchQuery !== null) {
        console.log(`Hint: use --label to filter by label, or --search to match title/body content.`);
      }
      // QX-037 (experiment 4, iteration 10): UQ-020 — "No tasks found." message
      // when any filter combination returns zero results. Without this, the CLI
      // exits silently with no output and no message, which users cannot distinguish
      // from a command that failed silently or a tool that is malfunctioning.
      // The --search hint above fires for the specific search-with-no-results case;
      // this is a broader catch-all for status/label/prefix filter combinations.
      // Written to stdout (consistent with other informational output in this branch).
      if (paged.length === 0 && searchQuery === null) {
        console.log("No tasks found.");
      }
    }
  }, { providerId: flags.provider, root: flags.root });
  return;
}
