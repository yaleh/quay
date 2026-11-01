// task-list-content.ts — the ONE definition of task_list's budgeted `content`
// block, shared by Core's MCP fan-out and the native Provider's own MCP server.
//
// gap-routine-semantic-dedup-scan-a1: the "serialize, measure, return verbatim
// when small, else a one-line summary" logic lived in TWO copies — Core's
// `mcp-handlers.ts` and native's `mcp-server.ts` — and had ALREADY diverged:
// the native copy grew a `scannedFiles` arm (appends "(resolved from the
// directory listing; no task file was read)" when the result was derived from
// the directory listing) plus the matching field, while Core's copy had no such
// arm. That is the defect class this module closes: one definition, both
// callers import it, so a future budget change cannot reach one surface and
// miss the other (same shape as search-index.ts / stripHeadings).
//
// Why the definition lives in Core and not in the native copy: `quay-native`
// DEPENDS ON `quay` (packages/quay-native/package.json), so Core importing a
// native module would be a package cycle and break Core's provider-agnosticism.
// The native server already reaches Core leaves by relative path
// (`../../quay/src/search-index.ts`, `core/*`), which is the direction the
// dependency graph already runs.
//
// Below the budget the text form is kept VERBATIM (every existing small
// response, and every test that reads it, is byte-identical); above it the
// text becomes a one-line summary and the data lives exactly once, in
// structuredContent. The budget sits far below where the stdio framing cost
// turns super-linear (gap-abi-task-list-times-out-at-2000-tasks-head-of-line-
// blocks-mcp).
export const TEXT_PAYLOAD_BUDGET_BYTES = 256 * 1024;

/** The values the one-line summary reports. `scannedFiles` is native's extra
 *  signal: false means the result was resolved from the directory listing and
 *  no task file was read — a fact Core's fan-out never needs to report, so it
 *  simply omits the field (which produces the byte-identical pre-extraction
 *  text with no directory arm). */
export interface TaskListSummary {
  count: number;
  total: number;
  page: number;
  totalPages: number;
  scannedFiles?: boolean;
}

/** Build a task_list result's `content` block under the budget above. `payload`
 *  is measured, and returned verbatim when it fits — so the small-payload
 *  surface is unchanged. */
export function budgetedTaskListContent(
  payload: Record<string, unknown>,
  summary: TaskListSummary,
): Array<{ type: "text"; text: string }> {
  const json = JSON.stringify(payload, null, 2);
  if (json.length <= TEXT_PAYLOAD_BUDGET_BYTES) return [{ type: "text" as const, text: json }];
  const directoryArm =
    summary.scannedFiles === false
      ? " (resolved from the directory listing; no task file was read)"
      : "";
  return [
    {
      type: "text" as const,
      text:
        `task_list: ${summary.count} task(s) — page ${summary.page}/${Math.max(1, summary.totalPages)} ` +
        `of ${summary.total} matching task(s)${directoryArm}. ` +
        `This page (${json.length} bytes) is in this result's structuredContent. ` +
        `The text form is omitted above ${TEXT_PAYLOAD_BUDGET_BYTES} bytes because a second copy of the ` +
        `same bytes doubles the stdio payload, whose framing cost grows super-linearly.`,
    },
  ];
}
