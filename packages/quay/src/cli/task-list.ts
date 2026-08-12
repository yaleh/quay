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
    // QX-016 (iteration 4): pass only status to taskList; label filtering handled
    // client-side below so we can apply AND-logic for multiple --label values.
    // gap-one-unparseable-task-takes-down-the-whole-board: taskList() returns
    // partial success { tasks, malformed }. The unparseable files are reported
    // on stderr — never silently dropped, and never treated as "0 tasks".
    const { tasks, malformed } = await client.taskList({ status: flags.status });
    // QX-002 (experiment 4, iteration 1): --prefix filter for experiment scoping.
    // Closes CB-001: `quay task list --prefix QX` returns only QX-* tasks.
    // Client-side filter after provider fetch — no provider-side changes needed.
    //
    // QX-006 (experiment 4, iteration 1): guard against `--prefix` passed with
    // no value. parseFlags() sets flags.prefix = true (boolean) in that case,
    // which causes prefix.toUpperCase() to throw a TypeError (SH-001 regression
    // from QX-002). Detect early and exit with a clear usage error.
    const prefix = flags.prefix;
    if (prefix !== undefined && typeof prefix !== "string") {
      console.error("Error: --prefix requires a value (e.g., --prefix QX)");
      process.exitCode = 1;
      return;
    }
    // QX-037 (experiment 4, iteration 10): UQ-021 — guard --label with no value.
    // parseFlags() sets flags.label = true (boolean) when --label is passed with no value.
    // Inconsistency with --prefix (which exits 1) filed as UQ-021; fix mirrors QX-006.
    // [].concat(flags.label).filter(Boolean) below would silently drop a boolean true,
    // producing no label filter — even more confusing than a crash.
    const rawLabel = flags.label;
    if (rawLabel !== undefined && typeof rawLabel !== "string" && !Array.isArray(rawLabel)) {
      console.error("Error: --label requires a value (e.g., --label experiment-4)");
      process.exitCode = 1;
      return;
    }
    const filteredByPrefix = prefix
      ? tasks.filter((t) => t.id.toUpperCase().startsWith(prefix.toUpperCase()))
      : tasks;
    // QX-016 (experiment 4, iteration 4): AND-logic multi-label filter.
    // flags.label may be: undefined (no filter), a string (single --label),
    // or an array of strings (repeated --label, collected by parseFlags).
    // [].concat(flags.label).filter(Boolean) normalises all three cases to an array.
    const labelFilters = [].concat(flags.label).filter(Boolean);
    const filteredByLabel = labelFilters.length > 0
      ? filteredByPrefix.filter((t) =>
          Array.isArray(t.labels) && labelFilters.every((l) => t.labels.includes(l))
        )
      : filteredByPrefix;
    // QX-021 (experiment 4, iteration 5): --search <query> title filter.
    // Case-insensitive substring match on task title. Closes CB-007.
    // QX-023 (experiment 4, iteration 6): extend to body content too.
    // Closes CB-016 (significant: title-only search misses body content).
    // QX-028 (experiment 4, iteration 7): use stripHeadings() to exclude
    // structural markdown heading lines from the body search index.
    // Closes CB-017 (significant: template boilerplate false positives).
    const searchQuery = typeof flags.search === "string" ? flags.search : null;
    const filtered = searchQuery
      ? filteredByLabel.filter((t) =>
          (t.title + " " + stripHeadings(t.body)).toLowerCase().includes(searchQuery.toLowerCase())
        )
      : filteredByLabel;
    // QX-008 (experiment 4, iteration 2): sort-by-updated support.
    // Closes CB-004 (no sort-by-time on CLI) and CB-012 (--sort updated
    // silently ignored). Tasks include `updatedAt` (file mtime in ms) from
    // the provider (quay-native's store.js list() path). Sort descending
    // (most-recently-modified first). Tasks without updatedAt (e.g. from a
    // provider that doesn't expose it) sort after those that have it.
    const sortKey = flags.sort;
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
    const totalCount = sorted.length;
    const paged = pageSize != null ? sorted.slice(0, pageSize) : sorted;
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
