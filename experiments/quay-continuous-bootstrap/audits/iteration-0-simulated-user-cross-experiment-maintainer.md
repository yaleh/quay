# Simulated-user audit — Cross-experiment maintainer
# Iteration 0, inline degraded-fallback (ENV gap confirmed: no native Agent tool in deferred-tools list)

**Persona**: Cross-experiment maintainer — a developer who actively manages tasks across multiple experiment workstreams (QN-*, QC-*, QW-*, QX-* prefixes) and needs to jump between them efficiently in one session.

**Date**: 2026-07-17
**Surfaces tested**: CLI, Web UI desktop, Web UI mobile (viewport simulation via HTML inspection), MCP tools

---

## CLI Surface

**Verdict: CONCERNS**

### Holistic impression
The CLI is clean and consistent for single-experiment use but has no mechanism to scope to one experiment's tasks. `quay task list` dumps all 94 tasks from all 4 experiments. For a maintainer jumping between QN-*, QC-*, QW-*, and QX-* tasks in one session, this is signal-drowning noise.

### Specific findings

1. **No prefix filter** (severity: significant) — `quay task list` has no `--prefix`, `--experiment`, or `--id-filter` option. Confirmed by running `quay task list --help` (returns only the global usage line) and `quay task list --status todo` (returns PC-PARENT, QN-021, QX-001 — mixes experiment populations). To find only QX-* tasks, the maintainer must either (a) know to use `--label capability_breadth` (works for this specific task, does not generalize) or (b) pipe through grep. Neither is discoverable.

2. **No sort by updated/created time** (severity: significant) — "show me my most recently touched task" is a core cross-session workflow. `quay task list` default order appears to be filesystem insertion order (alphabetical by ID). No `--sort updated` or `--sort created` option exists. Confirmed: running `quay task list` lists 94 tasks starting with PC-PARENT, QC-001, etc. No timestamp column visible.

3. **Help text too sparse** (severity: minor) — `quay --help` returns `usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...` — one line. No description of what quay is, no example commands, no mention of filtering options. A maintainer re-orienting after context switch has nothing to work with.

4. **`task list` output does not show timestamps** (severity: minor) — even if the maintainer scrolls to find their experiment's tasks, there is no "updated at" column to identify the most recently changed task.

---

## Web UI — Desktop Viewport

**Verdict: CONCERNS**

### Holistic impression
Visually clean and pleasant. Filter/sort/label affordances are discoverable on the list page. However, with 5 pages of 20 tasks each (94 total), finding experiment-4-specific work requires either knowing to filter by `capability_breadth` label (an experiment-4 convention not explained anywhere), or browsing to page 5. No "experiment" or "prefix" grouping concept exists.

### Specific findings

1. **No prefix/experiment filter in Web UI** (severity: significant) — The label filter shows 40+ labels as clickable links; useful for label-based scoping but no `prefix:QX` or `experiment:4` filter is available. The maintainer must know that QX-001 has the label `capability_breadth` and use that as a proxy filter. This works today (1 QX-* task), but will break as the QX-* population grows and gains diverse labels.

2. **QX-001 buried on page 5** (severity: significant) — With default sort and 94 tasks across 5 pages, QX-001 (the only current-experiment task) appears on page 5. The maintainer has no way to sort by "tasks relevant to my current experiment" without the prefix filter.

3. **Action buttons absent from list page** (severity: significant) — The "Advance" action button appears only on the task detail page (`/task/QX-001`), not on any row in the list table. To perform a common action (advance a task's status), the maintainer must click into each task's detail page first. For a multi-task triage session, this is a per-task round-trip cost.

4. **No sort by time on list** (severity: significant) — Sort options visible on the list page: Default, id, status. No "updated" or "created" sort. The maintainer cannot surface recently-touched tasks without manual inspection.

5. **Page size not configurable** (severity: minor) — Fixed at 20 tasks per page. With 94 tasks, this produces 5 pages. A power user doing a cross-experiment review session has no way to widen the view.

---

## Web UI — Mobile Viewport (HTML/CSS inspection)

**Verdict: CONCERNS**

### Holistic impression
The HTML includes responsive CSS (`@media (max-width: 600px)`) and the `viewport` meta tag, which is correct. However, the same filter-gap and action-button-gap findings apply equally on mobile — the mobile layout makes these worse, not better, since narrow viewports compress the label list and make multi-page browsing more tedious.

### Specific findings

1. **Same prefix/experiment filter gap** (severity: significant) — No fix on mobile.
2. **Same action-button-absent-from-list gap** (severity: significant) — No fix on mobile. The label filter column (40+ labels rendered as a long horizontal list) is likely to overflow or wrap awkwardly on a 390px viewport, though exact rendering requires a live browser check.
3. **Label filter line likely unwieldy on mobile** (severity: minor) — 40+ label links rendered inline with `·` separators. On a 600px-breakpoint CSS, these may wrap into many lines, making the label filter unusable without horizontal scrolling.

---

## MCP Tools

**Verdict: CONCERNS**

### Holistic impression
`task_list` MCP tool returns all 94 tasks in one call — confirmed live. The result is 550,343 characters, exceeding token limits in this session and requiring jq post-processing to extract QX-* tasks. For an agent-based cross-experiment maintainer, this is a real workflow impediment.

### Specific findings

1. **`task_list` returns all tasks, no prefix filter** (severity: significant) — Confirmed: `mcp__quay__task_list` with no arguments returns 94 tasks. Extracting only QX-* tasks required `jq '[.tasks[] | select(.id | startswith("QX"))] | length'` post-processing — not a discoverable MCP interface capability.

2. **Response too large for inline processing** (severity: significant) — The 94-task response was 550,343 characters, exceeding context limits and requiring the output to be saved to a file for jq processing. For a 94-task corpus this is already unwieldy; at 500+ tasks this would be unusable.

3. **No `task_list --status` filter friction** (severity: minor) — `task_list --status todo` does work (returns PC-PARENT, QN-021, QX-001) but mixes experiment populations.

---

## Summary of blocking/significant findings

| Finding | Severity | Dimension | Surface |
|---------|----------|-----------|---------|
| No prefix/experiment filter | significant | capability_breadth | CLI, Web UI, MCP |
| Action buttons absent from list page | significant | capability_breadth + usability_quality | Web UI |
| No sort by time | significant | capability_breadth | CLI, Web UI |
| `task_list` response too large for inline processing | significant | usability_quality | MCP |
| Page size not configurable | minor | capability_breadth | Web UI |
| Help text too sparse | minor | usability_quality | CLI |
| No timestamp column in CLI output | minor | usability_quality | CLI |
| Mobile label filter line likely unwieldy | minor | usability_quality | Web UI mobile |
