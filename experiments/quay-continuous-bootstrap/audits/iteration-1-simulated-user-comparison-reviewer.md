# Simulated-user audit — Comparison-to-mature-tool reviewer
# Iteration 1 — live CLI and Web UI exercise

**Persona**: Comparison reviewer holding quay's interface up against GitHub Issues (chosen comparator: widely-used, overlapping purpose — task tracking with status, labels, assignees, and a browseable list).

**Date**: 2026-07-17
**Comparison tool**: GitHub Issues (as experienced at github.com / via `gh` CLI)
**Surfaces tested**:
- CLI: `node packages/quay/bin/quay.js` — all subcommands exercised
- Web UI desktop: `http://localhost:4173/` (inspected via `curl` + HTML analysis, 900px-max viewport)
- Web UI mobile: `http://localhost:4173/` (CSS @media query inspection, 375px viewport)

**Total tasks observed**: 98 tasks (3 todo, 92 done, 3 needs-human)

---

## CLI Surface

**Verdict: CONCERNS**

### Holistic impression

The quay CLI is functional and internally consistent. Running `--help` gives a clear, concise usage block. Core flows — list, view, filter by status/label/prefix, edit status, check gate, run actions — all work. However, compared to the `gh` CLI (GitHub's official tool), the quay CLI is narrow on discoverability and mutation surface. A GitHub Issues user would find task creation, body editing, assignment, comment/discussion, and text search entirely absent. The CLI is primarily a read-and-filter surface with one write (status change via `task edit`).

### What GitHub Issues would have that quay is missing

1. **Text/title search** (severity: significant) — `gh issue list --search "keyword"` searches across title and body. Quay has no `--search` or `--query` flag. With 98 tasks across 5 prefixes, finding a task by concept requires either knowing its ID or manually piping to `grep`. Confirmed by reading `quay.js` — no search flag exists.

2. **Sort by creation time / last updated** (severity: significant) — `gh issue list` defaults to newest-first and supports `--sort created|updated`. Quay's `--sort` only offers `id` and `status`, with default being insertion order. There is no timestamp on tasks at all, so "when was this filed?" and "what changed recently?" are unanswerable from the CLI.

3. **Task creation from the CLI** (severity: significant) — `gh issue create --title "..." --body "..."` is a first-class operation. Quay has no `task create` CLI command. New tasks must be created via `task_write` MCP tool or by writing files directly. This is a meaningful capability gap for a human user who discovered a bug and wants to file it immediately.

4. **Task body/title editing** (severity: significant) — `gh issue edit` allows updating title, body, labels, assignees. Quay's `task edit` only accepts `--status`. There is no CLI command to update title, body, or labels. Confirmed by source inspection: `bin/quay.js` line 160 states "v1 supports status-only writes."

5. **Assignee support** (severity: minor) — GitHub Issues has `--assignee` for filtering and `gh issue edit --add-assignee`. Quay has no assignee concept. For single-user AI-assisted projects this is acceptable; for teams it is a gap.

6. **Comments/discussion** (severity: minor) — GitHub Issues supports threaded comments on each issue. Quay has no comment model. Discussion happens only in the task body itself. This is an intentional design choice (body is the single-source record) but would confuse users expecting a comment thread.

7. **Closing/reopening issues** (severity: minor) — `gh issue close` / `gh issue reopen`. Quay's closest analog is `task edit --status done`, but there is no explicit "reopen" subcommand (it would require `task edit --status todo`). The verb mismatch ("done" vs "closed") could confuse GitHub users.

8. **Error when `--prefix` given without a value** (severity: significant — bug) — Running `node quay.js task list --prefix` (no value) throws a TypeError crash: `TypeError: prefix.toUpperCase is not a function`. GitHub's `gh` CLI gives a proper usage error. This is a real reliability gap.

### What quay does differently

9. **Gate semantics (`task check`)** (positive) — `quay task check QX-001 --json` returns a structured gate result with artifact presence and AC checkbox counts before allowing status advance. GitHub Issues has no equivalent; issues close at any time regardless of acceptance criteria. This is a genuine discipline advantage for methodology-driven work.

10. **Structured body lifecycle (Proposal/Plan/AC/DoD)** (positive) — GitHub issue bodies are freeform markdown. Quay tasks have a structured schema: Proposal, Plan, AC checkboxes, DoD. The gate (`task check`) enforces this schema. This is more disciplined and machine-checkable.

11. **Compound/epic role** (positive) — Quay's `role: compound` with children enforcement has no GitHub Issues equivalent (GitHub has linked issues but no native compound-done gate that blocks the parent from closing).

12. **`task check` output is machine-readable (`--json`)** (positive) — Returns `{ok, gate, artifacts, acTotal, acChecked, reason}`. GitHub's merge-block checks are not exposed in the `gh issue` surface.

13. **Prefix filter is quay-native namespace scoping** (positive) — `--prefix QN` scopes to one experiment's tasks. GitHub uses repositories as the namespace boundary; there is no sub-repo prefix filter. This is a better fit for multi-workstream single-repo usage, though it is undiscoverable (no `--help` example shows combining `--prefix` with `--status`).

---

## Web UI — Desktop Viewport (900px max-width)

**Verdict: CONCERNS**

### Holistic impression

The Web UI is clean, fast (pure HTML, no JS), and renders correctly. Navigation between list and detail works. Filter controls (prefix, status, sort, label) are present and functional as clickable links. Pagination (20 tasks/page, 5 pages) works. Markdown body is rendered on detail pages. Parent/children task links are shown on compound task detail pages.

However, compared to GitHub Issues' web interface, quay's Web UI is read-heavy and interaction-thin. GitHub allows inline status changes, multi-select bulk close, search, and comment threading from the web. Quay's web surface is strictly read + action-button trigger — no create, no text edit, no search, no bulk ops.

### Specific findings

1. **No text/title search** (severity: significant) — GitHub Issues has a persistent search bar. Quay's list page has no search form at all (`grep -c '<form'` returns 0 on the list page). Finding a task by keyword requires browsing 5 pages or knowing the ID.

2. **Filter controls are link-based, not combinable visually** (severity: significant) — Each filter (prefix, status, sort, label) displays as a row of links. Clicking one replaces the current URL. There is no way to visually combine, e.g., "prefix=QN AND status=needs-human" — the links do not compose. However, manually constructing `?prefix=QN&status=needs-human` in the URL works correctly and the web server supports combined query params. The UI does not expose or indicate this to users.

3. **41 label filter links on one line** (severity: significant on mobile, minor on desktop) — The label filter row renders 41 links inline. On desktop this wraps across multiple lines but is readable. A collapsible dropdown or sidebar (as GitHub uses) would be more scalable. As the label count grows, this will become unusable.

4. **No inline status editing from list** (severity: significant) — GitHub Issues allows closing/labeling issues from the list page via checkboxes. Quay requires navigating to the task detail page to trigger the `Advance` action button, and there is no `Close` / status-change button on the list page.

5. **Action buttons present but not explained** (severity: minor) — The detail page shows an `Advance` button. A GitHub Issues user would expect a `Close` button, a `Reopen` button, or a `Labels` dropdown. The word "Advance" is domain-specific to quay's lifecycle model and unexplained on the page.

6. **No visual age/recency indicator** (severity: minor) — GitHub shows "opened 3 days ago" and "updated 2 hours ago" on each issue row. Quay's list table has no timestamp column. With 98 tasks and no timestamps, there is no way to determine which tasks were recently worked on.

7. **No creation workflow in web UI** (severity: significant) — GitHub Issues has a "New issue" button on the list page. Quay's web UI has no way to create a task. The UI is read-only + action-trigger only.

8. **Status column shows raw status values** (severity: minor) — GitHub Issues uses colored badges (green Open, purple Merged, red Closed). Quay shows plain text `todo`, `done`, `needs-human`, `ready`. Visual differentiation would improve scannability.

9. **`needs-human` status with no action buttons** (severity: minor) — The detail page for QN-017 (needs-human) shows no action buttons — the Advance button is absent. This is correct behavior (needs-human blocks the lifecycle), but there is no explanation on the page about why no actions are available or what the user should do next.

---

## Web UI — Mobile Viewport (375px)

**Verdict: CONCERNS**

### Holistic impression

The mobile breakpoint CSS exists (`@media (max-width: 600px)`) and makes the table horizontally scrollable. This is the minimum viable responsive treatment. GitHub Mobile (both native app and mobile web) provides a purpose-built narrow-viewport layout. Quay's mobile experience is "desktop compressed."

### Specific findings

1. **41 label filter links overflow severely on mobile** (severity: significant) — The label filter line with 41 links rendered inline will wrap to many vertical lines on a 375px viewport. No mobile-specific treatment (dropdown, collapsible, hidden) is applied. This is the single biggest mobile UX problem.

2. **Table is scrollable but not card-based** (severity: minor) — The CSS uses `display: block; overflow-x: auto` on the table, which is a pragmatic mobile fix — it scrolls horizontally rather than truncating. GitHub's mobile layout converts the issue list to cards. Quay's approach is functional but forces horizontal scrolling to see all 5 columns (ID, status, role, title, labels).

3. **No touch-specific affordances** (severity: minor) — The `Advance` button on detail pages is adequately sized (0.4rem padding). However, row taps to navigate to task detail are only afforded by the `<a>` in the ID column cell, not the full row. On mobile, full-row tap targets are expected.

4. **Filter state not preserved across page navigations** (severity: minor) — On desktop this is tolerable. On mobile, where each navigation is a full-page reload, losing filter context on `back` navigation is more disruptive. GitHub preserves filter state. Quay's stateless URL-param approach does preserve state in theory, but the back-button behavior depends on browser history, which works correctly.

---

## What a user coming from GitHub Issues would find confusing

1. **"Advance" as the only action** — GitHub users expect `Close issue`, `Reopen`, and `Label`. "Advance" implies a workflow state machine that is not explained in the UI.

2. **`ready` and `needs-human` statuses** — GitHub has only `open` and `closed`. Quay's 4-state model (`todo`, `ready`, `done`, `needs-human`) requires learning a new mental model. `needs-human` in particular has no analog.

3. **task `check` before status changes** — GitHub users can close issues freely. Quay's `task check` gate (AC checkboxes must be checked, artifacts must exist) would block a naive `task edit --status done` if AC boxes are unchecked. The gate error message is clear (`"0/4 AC checkboxes checked"`) but the concept of a gate is foreign.

4. **No way to create tasks from the UI** — GitHub users' first instinct is "New issue." This button does not exist in quay's web UI or CLI (`task create` is absent).

5. **Task IDs must be known to use the detail page** — GitHub Issues uses auto-incrementing numbers (`#123`) that appear in list view. Quay uses human-assigned prefixed IDs (QX-001). If you don't know the ID, navigation requires scrolling 5 pages or using filters — and there is no search.

6. **`--prefix` filter is not in the main help examples** — The help text shows `--prefix QX` but doesn't explain that prefixes map to experiment namespaces. A new user would not know what `QX`, `QN`, `QW`, `QC` mean without reading the tasks or documentation.

7. **Crashing on `--prefix` with no value** — A user who types `quay task list --prefix` and hits Enter gets a TypeError stack trace, not a helpful error message. This would immediately erode trust.

---

## Summary table

| Finding | Severity | Surface | GitHub equivalent |
|---------|----------|---------|-------------------|
| No text/title search | significant | CLI, Web UI | `gh issue list --search` / search bar |
| No task creation | significant | CLI, Web UI | `gh issue create` / "New issue" button |
| No body/title/label editing | significant | CLI | `gh issue edit` |
| `--prefix` crash with no value (bug) | significant | CLI | gh gives usage error |
| Sort by updated/created missing | significant | CLI, Web UI | Sort by Newest/Updated |
| Filter controls not visually composable | significant | Web UI | Filter dropdowns persist across navigations |
| 41 label links unmanageable on mobile | significant | Web UI mobile | Collapsible filter panel |
| No creation workflow in web UI | significant | Web UI | "New issue" button |
| Action buttons absent from list view | significant | Web UI | Inline close/label from list |
| "Advance" button unexplained | minor | Web UI | Labeled Close/Reopen/Label buttons |
| No visual age/recency | minor | CLI, Web UI | "opened X days ago" |
| No status color badges | minor | Web UI | Green/red/purple status pills |
| `needs-human` shows no action buttons, no explanation | minor | Web UI | "This issue is locked" explanation banner |
| No comment/discussion model | minor | CLI, Web UI | Issue comment thread |
| Table is not card-based on mobile | minor | Web UI mobile | Card layout on mobile |
| **Gate semantics (task check)** | **positive** | CLI | No equivalent — discipline advantage |
| **Structured body (Proposal/Plan/AC/DoD)** | **positive** | CLI, Web UI | No equivalent — methodology advantage |
| **Compound/epic with children gate** | **positive** | CLI, Web UI | No equivalent — structural advantage |
| **Prefix-based experiment scoping** | **positive** | CLI, Web UI | Better than repo-boundary for multi-workstream |
