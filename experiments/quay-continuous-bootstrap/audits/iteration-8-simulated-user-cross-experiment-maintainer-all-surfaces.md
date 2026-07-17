# Simulated User Audit — Cross-Experiment Maintainer Persona
Date: 2026-07-17
Iteration: 8
Persona: Cross-experiment maintainer (power user, all surfaces)

## CLI regressions — PASS

- `task list` output: 5 tab-separated columns confirmed (id, status, role, title, updated). Verified with `awk -F'\t' '{print NF}'` on a representative row → 5.
- `task list --search "toggle"` → 3 matches (QN-042, QX-020, QX-029). Result summary line `# search: "toggle" (3 matches)` still rendered. No regression.
- `task list --prefix QX` → 31 tasks (QX-001 through QX-031), summary `# filtered: QX-* (31 tasks)` correct. No regression.

## Web UI regressions — PASS

- `curl -s 'http://localhost:4173/'` → full HTML response with orientation banner, nav filters, and paginated table. Label nav is frequency-sorted (v1=36 → usability_quality=22 → experiment-4=20 → capability_breadth=13 → bug=10; matches computed label counts). Sorting implemented via QX-026 (iteration 7). Active label pinned first.
- `curl -s 'http://localhost:4173/?q=toggle'` → search banner shows `"toggle"`, 3 matching rows (QN-042, QX-020, QX-029). Filter context preserved in prefix/status/sort nav links.
- `curl -s 'http://localhost:4173/?label=experiment-4&q=fix'` → label+search compose working: active label `experiment-4` shown with `(remove)` link; search `"fix"` banner shown; results include QX-006/QX-007/QX-011 (correct). All nav links preserve both filters. Multi-label stacking via repeated `?label=` still visible in nav (Web UI multi-label supported, as in prior iterations).

## MCP search + pagination — PASS

Implementation verified by reading `packages/quay/src/mcp-server.js` and running `packages/quay/test/mcp-server.test.mjs` directly (`node --experimental-vm-modules`). All 23 Block 14+15 assertions passed — zero failures.

**Search (QX-029/CB-014 partial):**
- `search="toggle"` → returns SRCH-1 only (title match). Excludes SRCH-2 (no match), SRCH-3 (no match). PASS.
- `search="Proposal"` → returns 0 tasks. Heading exclusion via `stripHeadings()` prevents `## Proposal` from matching. PASS.
- `search="unique-xyzzy-prose"` → returns SRCH-3 (prose body match). PASS.
- Schema introspection: `task_list.inputSchema.properties` includes `search` (string type). PASS.

Note: ToolSearch returns a stale cached schema `{label, provider, status}` only — the new `search`, `page`, `pageSize`, `prefix` params are absent from ToolSearch's view. This is the known CB-014 session-cache recurrence pattern: the server-side schema IS correct, but ToolSearch reflects the connection-time `tools/list` snapshot. CB-014 remains open (significant) but the underlying feature is correctly implemented.

**Pagination (QX-030/CB-010):**
- Default (no pagination params): `total=4`, `page=1`, `pageSize=50`, `totalPages=1`. All 4 tasks returned. Metadata fields present. PASS.
- `page=1, pageSize=2`: `total=4`, `totalPages=2`, 2 tasks returned. PASS.
- `page=2, pageSize=2`: 2 tasks returned; disjoint from page 1. `totalPages=2`. PASS.
- `page=99, pageSize=2`: `total=4`, empty `tasks` array (beyond last page, no error). PASS.
- `search + pagination`: `search="pag-special"` + pagination → `total=1`, 1 task returned (PAG-4 only). Filters compose correctly. PASS.
- Schema: `page` and `pageSize` present in `inputSchema.properties`. PASS.

Response structure: `{ tasks, total, page, pageSize, totalPages }` — all metadata fields present in both `content[0].text` (JSON) and `structuredContent`.

## MCP parity vs CLI/Web UI — PASS (with known gaps)

MCP `task_list` now supports all core filters available on CLI and Web UI:

| Filter | CLI | Web UI | MCP |
|---|---|---|---|
| status | `--status` | `?status=` | `status` param |
| single label | `--label` | `?label=` | `label` param |
| prefix | `--prefix` | `?prefix=` | `prefix` param |
| search (title+body) | `--search` | `?q=` | `search` param (NEW iter-8) |
| pagination | N/A | `?page=` | `page`/`pageSize` (NEW iter-8) |
| multi-label AND | `--label A --label B` | `?label=A&label=B` | NOT supported (CB-015) |
| sort | `--sort` | `?sort=` | NOT supported |

CB-014 (significant) remains open: ToolSearch/session-cached schema does not expose `prefix`, `search`, `page`, `pageSize`. Feature works at runtime but is invisible to a fresh-session tool inspector.

CB-015 (minor) remains open: MCP `label` is a single string — no multi-label AND-filter parity. The `label` parameter description now explicitly documents this limitation ("For multi-label AND-filter use CLI or Web UI"), which is an improvement over prior iterations where the limitation was undocumented. Gap itself is not closed.

Sort filter absent from MCP — not a tracked gap previously, remains untracked (minor capability gap vs CLI/Web UI `--sort`/`?sort=`).

## New gaps found

No new gaps found this iteration. All iteration-8 capability changes (search, pagination, schema descriptions) are correctly implemented and tested.

**Known open gaps confirmed still open (not regressed):**
- CB-014 (significant): MCP schema cache in ToolSearch doesn't reflect new parameters — structural/session-cache issue, not fixable in server code.
- CB-015 (minor): MCP `task_list` single-label only; multi-label AND-filter requires CLI or Web UI.
- CB-006 (minor): Web UI fixed page size (20 items/page); no user-selectable page size control.

## Overall: PASS

All surfaces functional, no regressions detected. Iteration-8's two new MCP capabilities (search via QX-029, pagination via QX-030) are correctly implemented with full test coverage. The schema description refresh (QX-031) accurately documents the label limitation (CB-015). The CB-014 session-cache issue persists as expected but does not block runtime functionality. CB-015 remains open as a minor known gap.
