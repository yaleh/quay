# Gap List — quay-continuous-bootstrap (Experiment 4)

**Storage decision**: plain markdown file (chosen at iteration 0, recorded in provenance.md).
**Format**: each entry has id, dimension, description, severity, source, date added, and status (open/closed + evidence).

---

## Open gaps

### capability_breadth

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| CB-001 | No prefix/experiment filter in CLI (`quay task list`) — returns all experiments' tasks in one flat list | significant | direct-observation (human, 2026-07-17) + simulated-user (all 3 personas, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-002 | No prefix/experiment filter in Web UI list page — no "show only QX-*" affordance | significant | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-003 | Action buttons ("Advance") missing from Web UI list page — only on task detail page | significant | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-004 | No sort-by-time (created/updated) on CLI task list | significant | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-005 | No sort-by-time (created/updated) on Web UI list page — sort options limited to Default/id/status | significant | direct-observation (human, 2026-07-17) + simulated-user (all 3 personas, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-006 | Configurable page size not available on Web UI list page (fixed at 20) | minor | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-007 | No full-text/title search in CLI or Web UI | significant | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| CB-008 | No packaging/distribution — users must install Node.js ≥20 separately; no single-file executables (DIR-004) | significant | directive (DIR-004, experiment 3) | 2026-07-17 | 2026-07-17 |
| CB-009 | `task_list` MCP tool has no prefix/experiment filter — returns all 94 tasks requiring post-processing | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation (iteration 0 self-hosted tracking test) | 2026-07-17 | 2026-07-17 |
| CB-010 | `task_list` MCP tool response size (550K chars for 94 tasks) exceeds inline processing limits — not scalable | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |

### usability_quality

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| UQ-001 | CLI `--help` returns one line — no project description, no subcommand docs, no examples | significant | simulated-user (new contributor + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-002 | CLI subcommand help is missing or shows error messages instead of usage | significant | simulated-user (new contributor, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-003 | No onboarding/orientation content in Web UI (no "what is this" header, no status lifecycle explanation) | minor | simulated-user (new contributor, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-004 | No timestamp column in CLI list output — cannot identify most-recently-updated task from CLI | minor | simulated-user (cross-experiment maintainer + comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-005 | No visual age indicator on Web UI list rows ("updated X ago") | minor | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-006 | Label filter on Web UI is a flat 40+ item inline list — likely unwieldy on mobile viewport | minor | simulated-user (comparison reviewer + cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-007 | Web UI task list table (5 columns) may overflow on narrow mobile viewports — not live-verified | minor | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-008 | MCP task_list response too large for inline context — no streaming or pagination at MCP layer | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |

### verification_coverage

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| VC-001 | No automated test for CLI `--help` output content (currently returns a one-liner; if it changes, no test catches it) | minor | direct-observation (iteration 0) | 2026-07-17 | 2026-07-17 |

### system_health

*(No open gaps at iteration 0 — all inherited snapshots confirmed intact)*

---

## Closed gaps

*(none yet — iteration 0 is purely observational)*

---

## Cumulative counter

- Gaps added this iteration: 19 (CB-001..CB-010, UQ-001..UQ-008, VC-001)
- Gaps closed this iteration: 0
- **Cumulative gaps closed (all-time): 0**
