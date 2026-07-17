# Simulated User Audit — New Contributor Persona
Date: 2026-07-17
Iteration: 8
Persona: New contributor (no prior context)

## CLI learnability — PASS

`--help` output is concise and well-structured. A new user can immediately see:
- Available commands (`task list`, `task view`, `task edit`, `task check`, `action list`, `action run`, `serve`, `mcp`)
- All `task list` filters documented inline: `--status`, `--label`, `--prefix`, `--sort`, `--search`, `--json`
- Concrete examples that cover the most common patterns (prefix filter, status filter, search)

`task list` output: readable tabular format with columns for id, status, role, title, and relative timestamps (e.g. "5h ago", "16h ago", "2d ago"). Timestamps are present and human-readable. The leading `quay-native mcp: serving tasks from /home/yale/work/quay/tasks` line is a minor distraction (stderr-style noise on stdout) but not blocking.

`task list --search "label"`: returns 50 matches with a clear header `# search: "label" (50 matches)`. Match count is helpful for confirming the filter worked.

`task list --status todo --search "QX"`: returns exactly 1 result (`QX-001`) with a clear match count. A new user could derive this command from `--help` alone — both `--status` and `--search` are shown in the usage line and the examples.

## Web UI usability — PASS

`GET /`: Loads successfully. Orientation banner is present and informative:
> "Quay — AI-assisted task management. Task statuses: `todo` → `ready` → `needs-human` → `done`. Use the Prefix filter to focus on one experiment's tasks."

Navigation controls visible: Prefix filter links (PC, QC, QN, QW, QX), status filter links, sort options, label cloud with "… 21 more labels" overflow notice. Search input pre-populated and functional. Timestamps in `updated` column present.

`GET /?q=search`: Search form works correctly — query is reflected in the input field, results are paginated (`Next »` link present), each result row shows id, status, role, title, labels, updated, and actions columns. Orientation banner remains visible even during search.

## No regressions from iteration 8 MCP changes — PASS

All CLI and Web UI surfaces behave identically to expectations based on prior iterations:
- `task list` with no filters: full task roster returned, timestamps present
- `--search` filtering: match count header present, results accurate
- `--status` + `--search` combination: works correctly, derivable from `--help`
- Web UI `/`: orientation banner, search form, filter links all functional
- Web UI `/?q=...`: search filtering reflected, results paginated

No evidence of regressions. The MCP layer is separate from the HTTP serve path and the CLI dispatch path; changes there did not bleed into these surfaces.

## New gaps found

**Minor:** The line `quay-native mcp: serving tasks from /home/yale/work/quay/tasks` appears on stdout before every CLI command output. For a new contributor, this looks like an error or debug noise mixed into the data stream. It would be cleaner on stderr, or suppressed when not in MCP mode. Severity: minor.

**Minor:** Web UI label cloud shows "… 21 more labels" as plain text with no link or expand affordance. A new contributor wanting to filter by a less-common label must fall back to the CLI or guess URL parameters. Severity: minor.

## Overall: PASS

No regressions from iteration 8's MCP changes on CLI or Web UI surfaces. Both surfaces are learnable and functional for a new contributor with no prior context.
