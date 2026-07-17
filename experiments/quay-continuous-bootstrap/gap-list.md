# Gap List — quay-continuous-bootstrap (Experiment 4)

**Storage decision**: plain markdown file (chosen at iteration 0, recorded in provenance.md).
**Format**: each entry has id, dimension, description, severity, source, date added, and status (open/closed + evidence).

---

## Open gaps

### capability_breadth

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| CB-006 | Configurable page size not available on Web UI list page (fixed at 20) | minor | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-007 | No full-text/title search in CLI or Web UI | significant | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-008 | No packaging/distribution — users must install Node.js ≥20 separately; no single-file executables (DIR-004) | significant | directive (DIR-004, experiment 3) | 2026-07-17 | 2026-07-17 |
| CB-010 | `task_list` MCP tool response size (550K chars for 94 tasks) exceeds inline processing limits — partially addressed by CB-009 prefix filter but full response still large when no prefix is used | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |
| CB-013 | Multi-label filtering broken: CLI `--label A --label B` silently uses last label only (last-wins); Web UI `?label=A&label=B` silently uses first label only (first-wins); behavior differs between surfaces; no error or warning given — **triage: blocking capability gap; scheduled for iteration 4; does not affect core gate mechanics or inherited experiment snapshots** | blocking | simulated-user (comparison-reviewer, iteration 3) | 2026-07-17 | 2026-07-17 |

### usability_quality

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| UQ-004 | No timestamp column in CLI list output — cannot identify most-recently-updated task from CLI | minor | simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-005 | No visual age indicator on Web UI list rows ("updated X ago") | minor | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-006 | Label filter on Web UI is a flat 40+ item inline list — likely unwieldy on mobile viewport | minor | simulated-user (comparison reviewer + cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-007 | Web UI task list table (5 columns) may overflow on narrow mobile viewports — not live-verified | minor | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-008 | MCP task_list response too large for inline context — no streaming or pagination at MCP layer (full unfiltered response remains large) | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |
| UQ-011 | Actions column still overflows at 375px viewport for long task IDs / long titles — QX-012 fix (hiding role/labels) works for short-ID filtered pages (e.g. QX-prefix) but actions column right edge reaches ~436px on unfiltered page; fix: `position: sticky; right: 0` on actions column cells — **PARTIALLY CLOSED in iteration 3** (col-role/col-labels hidden; short-ID case fixed); re-opened for long-ID/unfiltered case | significant | simulated-user (mobile-single-task, iteration 3) | 2026-07-17 | 2026-07-17 |
| UQ-015 | `updatedAt` field absent from `task_get` MCP tool response — asymmetry between `task_list` (includes `updatedAt`) and `task_get` (omits it); detail-page "last updated" display not possible via MCP | minor | G3 audit notes (iteration 2) | 2026-07-17 | 2026-07-17 |
| UQ-017 | `updatedAt` timestamp is tracked internally (used for sort-by-updated) and available in task JSON but never displayed on list page (no column) or detail page (no "last updated" field) — user cannot see recency without inferring from sort position | significant | simulated-user (comparison-reviewer, iteration 3) | 2026-07-17 | 2026-07-17 |
| UQ-018 | List-page Advance button tooltip is generic ("Advance task to next status") while detail-page shows target status ("Advance to ready") — inconsistency between surfaces; list-page should show target status | minor | simulated-user (new-contributor + comparison-reviewer, iteration 3) | 2026-07-17 | 2026-07-17 |

### verification_coverage

*(No open gaps — VC-001 closed iteration 1: CLI help content now has automated test coverage)*

### system_health

*(No open gaps — SH-001 triaged and closed iteration 1 with QX-006 fix)*

---

## Closed gaps

### capability_breadth

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| CB-001 | No prefix/experiment filter in CLI (`quay task list`) — returns all experiments' tasks in one flat list | iteration 1 | QX-002 (done); `quay task list --prefix QX` implemented and tested in `packages/quay/test/cli.test.mjs` test 13 |
| CB-002 | No prefix/experiment filter in Web UI list page — no "show only QX-*" affordance | iteration 1 | QX-004 (done); `?prefix=QX` query param + Prefix nav row implemented and tested in `packages/quay/test/serve.test.mjs` |
| CB-003 | Action buttons ("Advance") missing from Web UI list page — only on task detail page | iteration 2 | QX-009 (done); inline action buttons added to each list row; POST with ?from= redirects back to list; tested in `packages/quay/test/serve.test.mjs` QX-009 block |
| CB-004 | No sort-by-time (created/updated) on CLI task list | iteration 2 | QX-008 (done); `--sort updated` now sorts by file mtime descending; tested in `packages/quay/test/cli.test.mjs` test 17 |
| CB-005 | No sort-by-time (created/updated) on Web UI list page | iteration 2 | QX-008 (done); `?sort=updated` + "Updated ↓" nav link; tested in `packages/quay/test/serve.test.mjs` QX-008 block |
| CB-009 | `task_list` MCP tool has no prefix/experiment filter — returns all 94 tasks requiring post-processing | iteration 1 | QX-003 (done); `prefix` parameter added to `task_list` MCP tool, tested in `packages/quay/test/mcp-server.test.mjs` test 12 |
| CB-011 | MCP `task_list` registered schema in Claude Code does not include `prefix` parameter (stale snapshot) | iteration 2 | QX-010 (done); server code already correct since QX-003; automated `tools/list` schema test added in `packages/quay/test/mcp-server.test.mjs` Block 13 confirming `prefix` in inputSchema; stale session cache resolved by new session |
| CB-012 | `--sort updated` silently ignored in CLI `task list` | iteration 2 | QX-008 (done); `--sort updated` now correctly sorts by file mtime (not silently falls through to default order); CLI test 17 proves non-default ordering |

### usability_quality

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| UQ-001 | CLI `--help` returns one line — no project description, no subcommand docs, no examples | iteration 1 | QX-005 (done); `quay --help` now prints structured usage guide with all subcommands and examples |
| UQ-002 | CLI subcommand help is missing or shows error messages instead of usage | iteration 1 | QX-005 (done); `quay task --help` and `quay task list --help` now print usage documentation |
| UQ-003 | No onboarding/orientation content in Web UI — significant barrier for new contributors | iteration 3 | QX-015 (done); orientation banner added to list page with project description and status lifecycle; serve.test.mjs assertion; commit f4b3b8d |
| UQ-009 | Back link from task detail page drops filter/prefix context | iteration 3 | QX-011 (done); task title links on list page include ?from= param; detail page back link uses from= value with open-redirect guard; serve.test.mjs block; commit f4b3b8d |
| UQ-010 | `quay serve --help` and `quay action --help` silently exit with no output | iteration 1 | QX-007 (done); `printHelp()` now emits a stub usage line for unrecognised subcommands; test 16 in cli.test.mjs asserts non-empty output |
| UQ-011 | Advance button (actions column) hidden off-screen at 375px viewport | iteration 3 (PARTIALLY CLOSED — re-opened) | QX-012 (done); role/labels columns hidden at ≤600px; works for short-ID contexts (e.g. QX-prefix filtered list); re-opened for long-ID/unfiltered case where actions column right edge exceeds viewport; see open UQ-011 entry above |
| UQ-012 | Table role and labels columns not hidden at mobile viewport (≤600px) | iteration 3 | QX-012 (done); .col-role and .col-labels hidden in @media (max-width: 600px) block; serve.test.mjs assertion; commit f4b3b8d |
| UQ-013 | Gate-fail feedback is silent — page silently refreshes when Advance is blocked | iteration 3 | QX-013 (done); gate check added to action POST handler; ?error= redirect on gate-fail; error/success banners on list and detail pages; serve.test.mjs block; commit f4b3b8d |
| UQ-014 | Advance button has no tooltip, no hover text, no post-action confirmation | iteration 3 | QX-014 (done); title="Advance task to next status" on list page buttons; title="Advance to [next]" on detail page buttons; serve.test.mjs assertion; commit f4b3b8d |
| UQ-016 | Orientation banner shows wrong status model (`in_progress` listed, does not exist; `ready` missing) | iteration 3 (found + closed same iteration) | Banner text corrected to `todo → ready → needs-human → done`; test added to serve.test.mjs asserting banner does NOT contain `in_progress` and DOES contain `ready`; source: simulated-user (comparison-reviewer, iteration 3); commit 05a8ec9 |

### verification_coverage

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| VC-001 | No automated test for CLI `--help` output content | iteration 1 | QX-005 (done); CLI test 14 in `packages/quay/test/cli.test.mjs` asserts `quay --help` exits 0 and includes expected content |

### system_health

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| SH-001 | `quay task list --prefix` (no value) crashes with `TypeError: prefix.toUpperCase is not a function` — regression from QX-002 | iteration 1 | QX-006 (done); guard added in `packages/quay/bin/quay.js`; test 15 in cli.test.mjs asserts exit 1 + usage error, no TypeError; all 30 test suites pass |
| SH-002 | Open-redirect guard for `?from=` back-link parameter accepts protocol-relative URLs (`//evil.com` passes `startsWith("/")` guard) | iteration 3 (found + closed same iteration) | Guard tightened to `startsWith("/") && !startsWith("//")` in serve.js line ~563; test added to serve.test.mjs asserting `?from=//evil.com` results in back-link `href="/"`; source: G3 audit (iteration 3); commit 05a8ec9 |

---

## Cumulative counter

- Iteration 0: 19 gaps added (CB-001..CB-010, UQ-001..UQ-008, VC-001); 0 closed
- Iteration 1: 5 new gaps found (CB-011, CB-012, UQ-009, UQ-010, SH-001); 9 gaps closed (CB-001, CB-002, CB-009, UQ-001, UQ-002, UQ-010, VC-001, SH-001) — note SH-001 was found and closed in the same iteration
- Iteration 2: 6 new gaps found (UQ-011, UQ-012, UQ-013, UQ-014, UQ-015 added; UQ-003 severity escalated from minor to significant); 5 gaps closed (CB-003, CB-004, CB-005, CB-011, CB-012)
- Iteration 3 (FINAL): development phase closed 6 gaps (UQ-003, UQ-009, UQ-011 partially, UQ-012, UQ-013, UQ-014); simulated-user + G3 found and closed 2 additional gaps (UQ-016, SH-002); simulated-user found 5 new gaps (CB-013, UQ-011 re-opened as still-significant, UQ-017, UQ-018, UQ-016→closed, SH-002→closed); net gaps closed this iteration: 8 (UQ-003, UQ-009, UQ-011 partial, UQ-012, UQ-013, UQ-014, UQ-016, SH-002)
- **Cumulative gaps closed (all-time, iteration 3 final): 22** (CB-001..005, CB-009, CB-011, CB-012, UQ-001..003, UQ-009..014, UQ-016, VC-001, SH-001, SH-002; UQ-011 partially closed/re-opened; CB-010 partially addressed)
- **Net open gaps after iteration 3 final**: 14 (5 CB, 9 UQ, 0 VC, 0 SH) — CB-006/007/008/010/013 open; UQ-004/005/006/007/008/011/015/017/018 open
