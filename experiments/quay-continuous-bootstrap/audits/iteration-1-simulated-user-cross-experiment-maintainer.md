# Simulated-user audit — Cross-experiment maintainer
# Iteration 1

**Persona**: Cross-experiment maintainer — a developer who actively manages tasks across multiple experiment workstreams (QN-*, QC-*, QW-*, QX-* prefixes) and needs to jump between them efficiently in one session.

**Date**: 2026-07-17
**Surfaces tested**: CLI, Web UI desktop (HTML inspection at http://localhost:4173/), Web UI mobile (viewport CSS/HTML inspection), MCP tools (registered `mcp__quay__*` tools + direct stdio protocol verification)

---

## Summary of changes since iteration 0

Three tasks shipped between iteration 0 and this audit that directly target this persona's pain points:

- **QX-002**: Added `--prefix` filter to CLI `quay task list`
- **QX-003**: Added `prefix` parameter to MCP `task_list` tool
- **QX-004**: Added prefix/experiment filter to Web UI list page
- **QX-005**: Improved CLI help output

These collectively resolve the top-rated findings from the iteration-0 audit. This audit re-runs the same workflow and re-assesses each surface.

---

## CLI Surface

**Verdict: PASS**

### Holistic impression

The CLI now works well for the cross-experiment maintainer's primary workflows. `--prefix QX` scopes to exactly the right tasks with a discoverable header line ("# filtered: QX-* (5 tasks)"). Combined filters (`--prefix QN --status needs-human`) work correctly. The help text is now substantive. The main remaining gap is the absence of a "most recently updated" sort — this is a real workflow limitation but not blocking.

### Specific findings

1. **`--prefix` filter works correctly** — `quay task list --prefix QX` returns exactly QX-001 through QX-005 with a header `# filtered: QX-* (5 tasks)`. Confirmed live. All other prefix values tested (QN, QC, QW) also work and return correct counts (73, 10, 9 respectively).

2. **Combined prefix + status works** — `quay task list --prefix QN --status needs-human` returns QN-017, QN-020, QN-022 — the 3 QN-* tasks in needs-human status, and nothing else. This is exactly the cross-experiment triage workflow.

3. **`--sort updated` does not exist** (severity: significant) — "Find my most recently updated task" requires falling back to filesystem mtime (`ls -lt tasks/`), which is not a discoverable quay CLI operation. The sort options remain `id` and `status` only. The most-recently-updated task (QX-001, modified 2026-07-17 04:16) cannot be surfaced via `quay task list` alone. QX-001 is in `todo` status so `--status todo` narrows to 3 tasks (PC-PARENT, QN-021, QX-001), which is usable but is a workaround, not a solution.

4. **`--sort updated` silently ignored, returns default order** — Passing `--sort updated` produces no error and silently returns default (insertion) order. A maintainer who guesses this flag gets no feedback that it is unsupported.

5. **Help text is now substantially better** — `quay --help` returns a multi-line usage block with all subcommands, all options with descriptions, and two concrete examples (`quay task list --prefix QX`, `quay task view QX-001`). The iteration-0 finding (one-line help) is resolved.

6. **No `--sort updated` in help** (severity: minor) — The help correctly documents `--sort id|status` — this is accurate — but does not note the absence of time-based sort, so a maintainer still has to wonder "is there a way to sort by recent activity?" with no answer.

7. **`task view` shows full status and AC content** — `quay task view QX-001` renders the full task body and shows status in brackets (`[todo]`). Note: the `--json` view reports `status: todo` but the human-readable `task view` shows `[ready]` when the task has been advanced — confirmed this was a test artifact from advancing QX-001 to `ready` mid-session and then reverting it. Both modes are consistent after revert.

---

## Web UI — Desktop Viewport

**Verdict: PASS**

### Holistic impression

The prefix filter is discoverable on first load: the list page shows a "Prefix" nav row with All, PC, QC, QN, QW, QX links. Clicking QX correctly scopes to 5 tasks. Combined prefix+status filters compose correctly. Filter state carries through pagination and across filter dimension changes (clicking status while prefix is active preserves the prefix, and vice versa). The main remaining gaps are: no sort by time, action buttons absent from list view, and the back link from task detail loses filter context.

### Specific findings

1. **Prefix filter is discoverable without docs** — The prefix nav row (`Prefix: All · PC · QC · QN · QW · QX`) appears at the top of the filter section, above status and sort. A new maintainer visiting the page for the first time will see it immediately. Confirmed live at `http://localhost:4173/`.

2. **Prefix filter scopes correctly** — `/?prefix=QX` returns QX-001 through QX-005 with correct prefix highlight (`<strong>QX</strong>` in nav). All other prefix links tested and confirmed correct.

3. **Combined prefix + status composes cleanly** — `/?prefix=QX&status=todo` returns QX-001 only (correct). The prefix bar's "All" link preserves `?status=todo`; the status bar's "All" link preserves `?prefix=QX`. Filter dimensions are independent and composable. This is good UX.

4. **Filter state carries through pagination** — Tested with `/?prefix=QN&page=2`: prev/next links correctly include `?prefix=QN`, so navigating pages within a filtered view stays filtered. Confirmed live.

5. **Sort composes with prefix** — `/?prefix=QX&sort=id` works; the sort bar's Default/id/status links preserve `?prefix=QX`. No filter dimension is silently dropped.

6. **Back link from task detail loses filter context** (severity: significant) — Clicking any task from the `/?prefix=QX` view opens `/task/QX-001`. The back link on that page is `← back to list` pointing to `/` (the unfiltered list). After drilling into a task, the maintainer returns to page 1 of all 98 tasks with no filter applied. There is no "breadcrumb" or referrer-aware back link.

7. **No sort by time** (severity: significant) — Sort options: Default, id, status. No "updated" or "recently changed" option. Identifying the most recently touched task requires using file mtime outside the UI.

8. **Action buttons absent from list view** (severity: significant) — Advancing a task's status requires navigating to the task detail page (`/task/QX-001`) first. The list view shows only ID, status, role, title, labels — no action column. For a multi-task triage session across experiments, this is a per-task round-trip cost.

9. **Label filter bar has 41 labels** (severity: minor) — The label filter row lists all 41 unique labels inline. This is a long line on desktop; it wraps to multiple lines. Labels are sorted alphabetically and each is individually clickable, which is functional, but scanning 41 labels to find a relevant one is not efficient. A search/type-ahead input would serve better at this scale.

10. **Prefix filter only shows prefixes present in the task set** — The prefix nav bar shows exactly: All, PC, QC, QN, QW, QX. These are derived from the actual task population, not hardcoded. If a new experiment adds QY-* tasks, they will appear automatically. This is correct behavior.

---

## Web UI — Mobile Viewport (HTML/CSS inspection)

**Verdict: CONCERNS**

### Holistic impression

The HTML is semantically correct with viewport meta tag and a `@media (max-width: 600px)` breakpoint. The prefix filter is present and uses the same link-based nav. However, the label filter row (41 labels, 539 characters of plain text with `·` separators) is likely to wrap into many lines or overflow on a 375px viewport. Without a live browser rendering this cannot be confirmed as broken, but the structural conditions for a poor mobile experience are present. The back-link and no-sort-by-time issues from desktop apply equally.

### Specific findings

1. **Prefix filter present on mobile** — The same link-based prefix nav is rendered; no mobile-specific degradation at the HTML level.

2. **Label filter bar likely unwieldy at 375px** (severity: significant) — 41 labels rendered inline with `·` separators at `font-size: 0.85rem` (the mobile override). At 375px viewport, this wraps into an unpredictable number of lines. The CSS breakpoint at 600px addresses table scrolling but does not collapse or simplify the filter bars. A user on an iPhone SE class device will scroll past several lines of label links before reaching the task table.

3. **Table is horizontally scrollable** — The `@media (max-width: 600px)` CSS applies `display: block; overflow-x: auto` to the table. This is correct and prevents horizontal body overflow. With 5 columns (ID, status, role, title, labels), some horizontal scroll is expected on narrow viewports, but the table is still usable.

4. **Same filter-context loss on back navigation** — The back link issue from desktop applies identically on mobile.

5. **No touch-specific affordances for action buttons** — The task detail page's Advance button uses standard `<button>` with `padding: 0.4rem 1rem`. At 375px, this is likely tappable but no minimum 44px touch target height is guaranteed by the CSS.

---

## MCP Tools

**Verdict: CONCERNS**

### Holistic impression

The MCP `task_list` tool has been updated (QX-003) to support a `prefix` parameter in the server implementation. However, the registered Claude Code tool schema (`mcp__quay__task_list`) does not expose the `prefix` parameter — the schema snapshot cached by Claude Code predates QX-003. This means an agent using the registered MCP tool cannot discover or use prefix filtering through the tool's declared interface. The underlying server supports it, but the interface as seen by the caller does not advertise it.

The other MCP tools (`task_get`, `action_list`, `task_write`, `task_check`) work as expected for the single-task workflows tested.

### Specific findings

1. **`mcp__quay__task_list` schema missing `prefix` parameter** (severity: significant) — The registered tool schema (observed via ToolSearch) shows only `{provider, status, label}`. The `prefix` field is absent. Direct stdio protocol interrogation (`tools/list` JSON-RPC call) confirms the live server schema includes `prefix` — so the server implementation is correct, but the Claude Code session's cached registration does not reflect it. An agent relying on the registered schema will not know to pass `prefix` and will receive all 98 tasks on every `task_list` call.

2. **`task_list` without prefix returns full corpus, hitting token limit** — Calling `mcp__quay__task_list` with no arguments returned all 98 tasks (559,836 characters), which exceeded the session token limit and required the result to be saved to disk for processing. This is the same finding as iteration 0. The fix (QX-003) exists in the server code but is not discoverable via the registered schema.

3. **`task_list` with `status=todo` works as workaround** — Calling `mcp__quay__task_list` with `status=todo` returns 3 tasks (PC-PARENT, QN-021, QX-001). This is functional but mixes experiment populations.

4. **`task_get` works correctly** — `mcp__quay__task_get` with `id=QX-001` returns the full task object with correct status, labels, body. Confirmed live.

5. **`action_list` works correctly** — `mcp__quay__action_list` with `id=QX-001` returns `[{"id":"advance","label":"Advance",...,"whenStatus":["todo","ready"]}]`. The advance action is correctly available for a `todo` task. Confirmed live.

6. **`task_write` schema present** — Schema confirmed via ToolSearch: supports `{id, title, status, labels, parent, children, body, extra, expectedStatus, provider}`. This is the correct shape for advancing a task's status or patching fields.

7. **No MCP tool for "sort by updated"** — Same gap as CLI. No MCP-accessible timestamp or recency ordering.

---

## Overall assessment

| Surface | Iteration 0 verdict | Iteration 1 verdict |
|---|---|---|
| CLI | CONCERNS | PASS |
| Web UI desktop | CONCERNS | PASS |
| Web UI mobile | CONCERNS | CONCERNS |
| MCP tools | CONCERNS | CONCERNS |

**Net improvement**: The three top-rated iteration-0 findings (no prefix filter on CLI, Web UI, or MCP) are resolved at the implementation level. CLI and Web UI desktop both reach PASS. Mobile and MCP remain CONCERNS due to:

- **Mobile**: label bar overflow at narrow viewports (structural, needs live browser verification to confirm severity)
- **MCP**: the registered tool schema does not expose `prefix`, so agents cannot discover or use the implemented filter

**Persistent cross-surface gaps** (not newly introduced, not yet addressed):
- No sort by most-recently-updated on any surface
- Back link from task detail loses filter context (Web UI)
- Action buttons absent from task list (Web UI)

**Blocking findings**: None on any surface.
