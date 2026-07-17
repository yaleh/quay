# Simulated-user audit — Comparison-to-mature-tool reviewer
# Iteration 0, inline degraded-fallback (ENV gap confirmed: no native Agent tool in deferred-tools list)

**Persona**: Comparison reviewer explicitly holding quay's interface up against GitHub Issues (the chosen mainstream comparator — widely known, overlapping purpose: task tracking with status, labels, assignments, and a browseable list).

**Date**: 2026-07-17
**Comparison tool**: GitHub Issues (as experienced at github.com)
**Surfaces tested**: CLI, Web UI desktop, Web UI mobile (viewport-aware HTML inspection)

---

## CLI Surface

**Verdict: CONCERNS**

### Holistic impression
Compared to `gh` (the GitHub CLI), `quay` CLI is functional but sparse. `gh issue list` has `--assignee`, `--author`, `--label`, `--search`, `--state`, `--limit`, `--json`, `--template` — a rich surface. `quay task list` has `--status`, `--label`, `--json` — sufficient for basics but missing search and the key cross-experiment filter.

### What GitHub Issues would have that quay is missing

1. **Text search** (severity: significant) — `gh issue list --search "keyword"` or GitHub's UI search bar. Quay has no full-text or title search on either CLI or Web UI. With 94+ tasks, finding a task by keyword requires manual grep.

2. **Sort by updated/created time** (severity: significant) — GitHub Issues defaults to "newest first" and allows sorting by Created/Updated/Comments. Quay's `quay task list` has no timestamp sort. This is the single most common cross-session task-discovery workflow.

3. **Assignee/owner filter** (severity: minor) — GitHub Issues has `--assignee`. Quay tasks have no assignee concept. For single-user projects this is fine; for teams it would be a gap.

4. **Prefix/namespace filter** (severity: significant) — GitHub Issues has repositories as the namespace boundary; you list issues within one repo. Quay has no equivalent scoping primitive (prefix-based or otherwise). With tasks from 4 experiments in one flat namespace, the cross-experiment maintainer workflow is genuinely harder than GitHub Issues.

5. **Inline status mutation from list view** (severity: significant) — GitHub UI allows labeling/assigning/closing issues from the list view without navigating to each issue. Quay's Web UI has action buttons only on detail pages.

### What quay does differently

6. **Structured Proposal/Plan/AC/DoD body** (positive) — GitHub issue bodies are freeform markdown. Quay's task body has a structured lifecycle: Proposal, Plan, AC checkboxes, DoD. This is more disciplined for methodology-driven work.

7. **Gate semantics (`task check`)** (positive) — `quay task check` asserts artifact completeness and AC checkbox state before allowing status advance. GitHub Issues has no equivalent gate — you can close any issue at any time regardless of acceptance criteria.

8. **Explicit `role: primitive/compound` distinction** (positive) — GitHub Issues has no analog for compound/epic parent-child task with recursive-children-done gate.

---

## Web UI — Desktop Viewport

**Verdict: CONCERNS**

### Holistic impression
Compared to GitHub Issues' web interface, quay's Web UI is clean and correct for what it does but notably sparse on interactive affordances. GitHub's list page allows multi-select, bulk-label, bulk-close, search, sorting by recency, and filter by label/assignee/milestone from dropdowns — all on one page. Quay's list page offers status/sort/label filter by clicking links but no search, no bulk actions, no action buttons inline.

### Specific findings

1. **No text/title search** (severity: significant) — GitHub Issues has a search bar at the top. Quay Web UI has none. Finding a task by title keyword requires knowing its ID or browsing pages.

2. **Action buttons only on detail page** (severity: significant) — GitHub Issues allows closing/labeling from the list with checkboxes. Quay requires navigating to each task's detail page to trigger any action.

3. **No inline status editing** (severity: significant) — GitHub Issues allows changing labels inline from the list. Quay's `--status` edit requires the CLI or navigating to the detail page.

4. **No visual "age" indicator** (severity: minor) — GitHub shows "opened X days ago" or "updated Y hours ago" on each issue row. Quay's list has no timestamp column.

5. **No bulk actions** (severity: minor) — GitHub Issues allows selecting multiple issues and applying labels/closing in bulk. Quay has no bulk operation concept.

6. **Label list is a flat enumeration, not a dropdown** (severity: minor) — GitHub Issues shows labels in a collapsible multi-select sidebar. Quay shows labels as 40+ inline link items. This is less scalable as the label count grows.

---

## Web UI — Mobile Viewport (HTML/CSS inspection)

**Verdict: CONCERNS**

### Holistic impression
GitHub Mobile has a dedicated app or mobile-responsive web with well-tested narrow-viewport affordances. Quay's responsive CSS breakpoint handles the overall layout but the 40+ label filter list and 5-column table are challenges on mobile. The holistic impression is "desktop-first, works on mobile but not optimized for it."

### Specific findings

1. **Label filter line on mobile** (severity: significant) — 40+ label links as a long inline list at the top of the page. GitHub Issues on mobile collapses filters into a bottom sheet or sidebar. On a 390px viewport this list may extend vertically many lines.

2. **Table with 5 columns on mobile** (severity: minor) — The labels column in particular likely overflows or wraps awkwardly at narrow widths. GitHub's mobile list uses a card layout. Quay's table structure is desktop-centric.

---

## Summary of blocking/significant findings

| Finding | Severity | Dimension | Surface | GitHub equivalent |
|---------|----------|-----------|---------|-------------------|
| No text/title search | significant | capability_breadth | CLI, Web UI | `gh issue list --search` / search bar |
| No sort by updated/created | significant | capability_breadth | CLI, Web UI | Sort by Newest/Updated |
| No prefix/namespace filter | significant | capability_breadth | CLI, Web UI, MCP | Repository boundary |
| Action buttons absent from list | significant | capability_breadth + usability_quality | Web UI | Inline close/label from list |
| No inline status editing from list | significant | usability_quality | Web UI | Inline label/close |
| Label filter line on mobile | significant | usability_quality | Web UI mobile | Collapsible filter sidebar |
| No visual age indicator | minor | usability_quality | Web UI | "opened X days ago" |
| Label list not collapsible/dropdown | minor | usability_quality | Web UI | Label multi-select sidebar |
| No bulk actions | minor | capability_breadth | Web UI | Bulk select + close/label |
