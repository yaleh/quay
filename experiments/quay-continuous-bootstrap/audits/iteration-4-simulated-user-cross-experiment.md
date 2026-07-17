# Simulated-user audit — Cross-experiment maintainer
# Iteration 4

**Persona**: Cross-experiment maintainer — manages tasks across QN-*, QC-*, QW-*, QX-* prefixes simultaneously. Cares about multi-experiment navigation, sorting/filtering efficiency, and surface consistency across CLI / Web UI / MCP.

**Date**: 2026-07-17
**Surfaces tested**: CLI (`task list` multi-label, prefix), Web UI desktop (HTML/curl analysis), MCP schema (ToolSearch introspection + unit test)

**Fixes under verification this iteration**:
- CB-013 — Multi-label AND-filter on CLI and Web UI (QX-016)
- UQ-017 — `updatedAt` timestamp on list rows and detail page (QX-018)

**CB-011 persistence check**: Does `task_list` MCP tool's `prefix` parameter appear in the registered Claude Code schema?

---

## Workflow 1 — Multi-label AND-filter (CB-013 fix, QX-016)

### CLI

**Command tested**: `node packages/quay/bin/quay.js task list --prefix QX --label experiment-4 --label usability_quality`

**Result**: 8 tasks returned. Spot-checked all 8: every returned task carries both `experiment-4` and `usability_quality` in its labels array. AND-join is correct.

**Control — non-overlapping labels**: `--label experiment-4 --label epic` returned 0 tasks (correct; no QX-* task carries both). The zero-result case exits 0 with no output (minor: see Remaining Gaps below).

**Regression check — single label**: `--label experiment-4` returns 11 tasks; `--label usability_quality` alone also returns the expected superset. No regression.

**Three-label AND**: `--label experiment-4 --label usability_quality --label bug` returned 0 tasks (correct; no task has all three). Silent exit 0.

**Unit test confirmation**: `node --test packages/quay/test/cli.test.mjs` passes including:
- `quay task list --label bug --label cli exits 0 (multi-label AND-filter, QX-016, CB-013)`
- `quay task list --label bug --label cli excludes MBUG-1 (has only bug, not cli) (QX-016, CB-013)`

**CLI multi-label verdict: PASS**

### Web UI

**URL tested**: `http://localhost:4173/?prefix=QX&label=experiment-4&label=usability_quality`

**Result**: 8 task rows returned in the table. Spot-checked: all match the CLI result (QX-011, QX-012, QX-013, QX-014, QX-015, QX-017, QX-018, QX-019). AND-logic via `searchParams.getAll("label")` + `labelFilters.every(...)` is working.

**Control — non-overlapping labels**: `?prefix=QX&label=experiment-4&label=epic` — the HTML contains only the header row (`<tr>` count = 1 total). Zero data rows. Correct AND-behavior confirmed. (Earlier confusion: QX-* strings appear in CSS/HTML comments embedded in the page; checking actual `<tr>` count was necessary to avoid false positives from comment text.)

**Web UI multi-label verdict: PASS**

---

## Workflow 2 — Updated column timestamps (UQ-017 fix, QX-018)

### List page

**URL tested**: `http://localhost:4173/?prefix=QX&sort=updated`

**Result**: 19 task rows each contain a relative timestamp (`13m ago`, `45m ago`, `1h ago`, etc.) in the `col-updated` column. Tasks are ordered most-recently-modified first. The `sort=updated` parameter works.

**Default list (no sort param)**: `http://localhost:4173/?prefix=QX` — timestamps also present in all rows. The `updatedAt` column is populated regardless of the active sort key; `sort=updated` only affects row ordering, not column visibility. Desktop viewport: `col-updated` is visible by default (the `display: none` rule is inside `@media (max-width: 600px)` only).

**Detail page**: `http://localhost:4173/task/QX-018` renders `<p class="meta">last updated: 15m ago</p>`. Note: the correct detail URL is `/task/<id>`, not `/<id>` (the latter returns "not found"). The list-page links correctly generate `/task/QX-NNN?from=<encoded-list-url>` hrefs.

**Updated verdict: PASS**

---

## Workflow 3 — Multi-label label-nav behavior (new, UX gap assessment)

When two labels are active (`?label=experiment-4&label=usability_quality`), the label navigation bar:

1. **Active-label highlighting**: Only works for single-label filter. When `labelFilters.length === 1 && labelFilters[0] === l`, the label is shown in `<strong>`. With 2+ active labels, **neither active label is shown in bold** — the user gets no visual confirmation of which labels are currently filtering. This is a UX gap.

2. **Label-nav link behavior**: Each label nav link generates `?label=<single-label>` (via `buildHref(statusFilter, sortKey, l, null, prefixFilter)`), which **replaces** all active labels with only the clicked label. This is documented in the source (`// clicking a label link replaces the current multi-label filter with just that one label`), so it is a deliberate design choice, not a bug — but it makes multi-label filtering navigable only by typing URLs manually. There is no "add this label to current filter" or "remove just this label" affordance.

**Severity**: Medium. Multi-label filtering works correctly (Workflow 1 PASS), but the nav UI gives no feedback on what's active and no way to incrementally add/remove labels. For the cross-experiment maintainer persona this surfaces as: once in a multi-label view, you can only exit by clicking "All" or editing the URL.

**Label-nav multi-label verdict: CONCERNS (medium severity)**

New gap: **UQ-019** — Label nav shows no active state and offers no additive/subtractive clicks when 2+ labels are active.

---

## CB-011 Persistence Check — MCP `task_list` prefix in Claude Code schema

**Method 1 — ToolSearch introspection (live Claude Code session schema)**:

```
mcp__quay__task_list schema:
  properties: { label, provider, status }
  description: "...optionally filtered by status/label..."
```

`prefix` is **absent** from the registered schema. The description also omits it. This is the same CB-011 symptom (stale session cache) that was filed in iteration 1 and nominally closed in iteration 2.

**Method 2 — Unit test (server-side ground truth)**:

`node --test packages/quay/test/mcp-server.test.mjs` passes:
- `PASS: task_list inputSchema.properties includes 'prefix' (CB-011: stale session snapshot had this missing)`
- `PASS: task_list inputSchema.properties.prefix is declared as a string type`

**Diagnosis**: The server-side MCP schema is correct and has included `prefix` since QX-003 (iteration 1). The issue is session-lifecycle: the Claude Code process that opens the MCP connection caches the `tools/list` schema at connection time. If the schema changed between when this session started and when ToolSearch was called, the cached schema is stale. CB-011's "fix" (new session) was structural, not a code fix — it will re-appear whenever a session predates a server schema change.

**Root cause**: No permanent fix has been made. A new Claude Code session would show the correct schema; the current session does not. The unit test confirms the server is correct; the session cache is wrong.

**MCP prefix schema verdict: CONCERNS (medium severity — schema gap affects any agent using the cached tool list)**

Note: MCP `task_list` also only supports a **single** `label` parameter (type: `string`), not an array. Multi-label AND-filter is not available via MCP, unlike CLI and Web UI.

New gap: **CB-014** — MCP `task_list` schema stale in-session (CB-011 structural recurrence: requires a new session or server restart signal mechanism to clear). Gap stays open until there is a session-independent fix (e.g., version header in schema, or Claude Code MCP schema refresh on reconnect).

New gap: **CB-015** — MCP `task_list` only accepts a single `label` (string) — no multi-label AND-filter via MCP, unlike CLI (`--label A --label B`) and Web UI (`?label=A&label=B`). Asymmetric surface capability.

---

## Workflow 4 — Remaining gaps observed by maintainer persona

### 4a. Zero-result CLI output is silent (low severity)

`quay task list --label experiment-4 --label epic` (no matching tasks) exits 0 with no output — not even a "0 tasks" or "# no tasks match" header. In contrast, a non-empty filtered result shows `# filtered: QX-* (N tasks)`. A maintainer who accidentally miskeys a label name gets no signal that the query ran but found nothing.

New gap: **UQ-020** — CLI `task list` silent exit on 0 results with active filters; should print a `# 0 tasks` line or similar to distinguish "no matches" from "command failed silently."

### 4b. `--label` with no value is silently ignored (low severity)

`quay task list --label` (no value) exits 0 and returns all tasks, silently treating the no-value flag as absent. This is inconsistent with `--prefix` (no value), which was fixed to exit 1 with an error message (QX-006). A typo like `quay task list --label --prefix QX` would silently return all tasks with no prefix filter applied either.

New gap: **UQ-021** — `quay task list --label` with no value should exit 1 with an error message, consistent with `--prefix` behavior after QX-006.

### 4c. No cross-prefix count in nav (cosmetic)

When `?prefix=QX` is active, the Prefix nav shows all prefixes as links but doesn't show task counts per prefix (e.g., `QX (19) · QN (25)`). This is cosmetic for a maintainer switching contexts.

Not filed as a gap (cosmetic); noted for completeness.

---

## Summary verdicts

| Surface | CB-013 multi-label | UQ-017 updated | CB-011 prefix in MCP | Label-nav multi-label |
|---------|-------------------|----------------|---------------------|----------------------|
| CLI | **PASS** | N/A | N/A | N/A |
| Web UI (desktop) | **PASS** | **PASS** | N/A | **CONCERNS (medium)** |
| MCP | **CONCERNS (medium)** | N/A | **CONCERNS (medium)** | — |

**New gaps opened this audit**:
- UQ-019 (medium): Label nav no active-state or additive/subtractive behavior with 2+ labels
- CB-014 (medium): MCP task_list schema stale in-session — CB-011 structural recurrence
- CB-015 (medium): MCP task_list single-label only — no multi-label AND-filter parity with CLI/Web UI
- UQ-020 (low): CLI silent exit on 0 results with active filters
- UQ-021 (low): `--label` with no value silently ignored vs. `--prefix` exits 1

**Gaps confirmed closed**: CB-013 (Web UI + CLI multi-label AND-filter), UQ-017 (updatedAt timestamps on list and detail pages)
