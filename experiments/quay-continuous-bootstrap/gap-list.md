# Gap List — quay-continuous-bootstrap (Experiment 4)

**Storage decision**: plain markdown file (chosen at iteration 0, recorded in provenance.md).
**Format**: each entry has id, dimension, description, severity, source, date added, and status (open/closed + evidence).

---

## Open gaps

### capability_breadth

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| CB-003 | Action buttons ("Advance") missing from Web UI list page — only on task detail page | significant | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-004 | No sort-by-time (created/updated) on CLI task list | significant | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-005 | No sort-by-time (created/updated) on Web UI list page — sort options limited to Default/id/status | significant | direct-observation (human, 2026-07-17) + simulated-user (all 3 personas, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-006 | Configurable page size not available on Web UI list page (fixed at 20) | minor | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-007 | No full-text/title search in CLI or Web UI | significant | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-008 | No packaging/distribution — users must install Node.js ≥20 separately; no single-file executables (DIR-004) | significant | directive (DIR-004, experiment 3) | 2026-07-17 | 2026-07-17 |
| CB-010 | `task_list` MCP tool response size (550K chars for 94 tasks) exceeds inline processing limits — partially addressed by CB-009 prefix filter but full response still large when no prefix is used | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |
| CB-011 | MCP `task_list` registered schema in Claude Code does not include `prefix` parameter (stale snapshot) — agents cannot discover or use the implemented filter via the declared interface | significant | simulated-user (cross-experiment maintainer, iteration 1) | 2026-07-17 | 2026-07-17 |
| CB-012 | `--sort updated` silently ignored in CLI `task list` (no error, no sort by time) — a user who guesses this flag gets no feedback that it is unsupported | significant | simulated-user (cross-experiment maintainer, iteration 1) | 2026-07-17 | 2026-07-17 |

### usability_quality

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| UQ-003 | No onboarding/orientation content in Web UI (no "what is this" header, no status lifecycle explanation) | minor | simulated-user (new contributor, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-004 | No timestamp column in CLI list output — cannot identify most-recently-updated task from CLI | minor | simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-005 | No visual age indicator on Web UI list rows ("updated X ago") | minor | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-006 | Label filter on Web UI is a flat 40+ item inline list — likely unwieldy on mobile viewport | minor | simulated-user (comparison reviewer + cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-007 | Web UI task list table (5 columns) may overflow on narrow mobile viewports — not live-verified | minor | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-008 | MCP task_list response too large for inline context — no streaming or pagination at MCP layer (full unfiltered response remains large) | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |
| UQ-009 | Back link from task detail page drops filter/prefix context (returns to unfiltered `/`) — after drilling into a task the maintainer lands on page 1 of all tasks with no filter | minor | simulated-user (cross-experiment maintainer, iteration 1) | 2026-07-17 | 2026-07-17 |

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
| CB-009 | `task_list` MCP tool has no prefix/experiment filter — returns all 94 tasks requiring post-processing | iteration 1 | QX-003 (done); `prefix` parameter added to `task_list` MCP tool, tested in `packages/quay/test/mcp-server.test.mjs` test 12 |

### usability_quality

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| UQ-001 | CLI `--help` returns one line — no project description, no subcommand docs, no examples | iteration 1 | QX-005 (done); `quay --help` now prints structured usage guide with all subcommands and examples |
| UQ-002 | CLI subcommand help is missing or shows error messages instead of usage | iteration 1 | QX-005 (done); `quay task --help` and `quay task list --help` now print usage documentation |
| UQ-010 | `quay serve --help` and `quay action --help` silently exit with no output | iteration 1 | QX-007 (done); `printHelp()` now emits a stub usage line for unrecognised subcommands; test 16 in cli.test.mjs asserts non-empty output |

### verification_coverage

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| VC-001 | No automated test for CLI `--help` output content | iteration 1 | QX-005 (done); CLI test 14 in `packages/quay/test/cli.test.mjs` asserts `quay --help` exits 0 and includes expected content |

### system_health

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| SH-001 | `quay task list --prefix` (no value) crashes with `TypeError: prefix.toUpperCase is not a function` — regression from QX-002 | iteration 1 | QX-006 (done); guard added in `packages/quay/bin/quay.js`; test 15 in cli.test.mjs asserts exit 1 + usage error, no TypeError; all 30 test suites pass |

---

## Cumulative counter

- Iteration 0: 19 gaps added (CB-001..CB-010, UQ-001..UQ-008, VC-001); 0 closed
- Iteration 1: 5 new gaps found (CB-011, CB-012, UQ-009, UQ-010, SH-001); 9 gaps closed (CB-001, CB-002, CB-009, UQ-001, UQ-002, UQ-010, VC-001, SH-001) — note SH-001 was found and closed in the same iteration
- **Cumulative gaps closed (all-time): 9** (CB-001, CB-002, CB-009, UQ-001, UQ-002, UQ-010, VC-001, SH-001; CB-010 partially addressed)
- **Net open gaps after iteration 1**: 16 (9 CB, 7 UQ, 0 VC, 0 SH)
