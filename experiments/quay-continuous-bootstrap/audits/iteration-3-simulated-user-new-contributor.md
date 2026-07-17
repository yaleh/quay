# Simulated-user audit — New contributor with no context
# Iteration 3

**Persona**: New contributor ("new-contributor") — zero prior knowledge of quay's conventions. Goal: become productive using only what the interface itself teaches.

**Date**: 2026-07-17
**Surfaces tested**: CLI (`--help`, `task list`, `task view`), Web UI desktop (HTML/CSS analysis + curl), gate-block feedback (POST advance on unchecked-AC task)

**Fixes under verification this iteration**:
- UQ-003 — Project orientation banner (QX-015)
- UQ-014 — Advance button tooltip and target status label (QX-014)
- UQ-013 — Gate-fail error banner when Advance is blocked (QX-013)

---

## Goal 1 — Web UI orientation banner (UQ-003 fix verification)

**Verdict: PASS** (severity: N/A — previously significant, now resolved)

### Evidence

```
curl http://localhost:4173/ | grep "orientation-banner"
```

Returns:

```html
<div class="orientation-banner">
  <strong>Quay</strong> — AI-assisted task management.
  Task statuses: <code>todo</code> → <code>in_progress</code> → <code>needs-human</code> → <code>done</code>.
  Use the Prefix filter to focus on one experiment's tasks.
</div>
```

### Assessment

The banner is present at the top of the list page, styled with a left-border accent and subtle blue background (`.orientation-banner { background: #f0f4ff; border-left: 3px solid #0066cc; }`). It provides:

1. **Project name and purpose** — "Quay — AI-assisted task management" — matches the CLI's `--help` tagline. A new contributor now sees the same framing from both surfaces.
2. **Status lifecycle** — `todo → in_progress → needs-human → done` — directly answers the question "what do these status values mean?" that was raised as a minor finding in iterations 1 and 2.
3. **Actionable UX hint** — "Use the Prefix filter to focus on one experiment's tasks" — tells a new contributor the single most useful filtering strategy to reduce noise from 100+ tasks.

The banner does not dominate the layout (font-size 0.9rem, compact padding). It functions as exactly the kind of one-sentence orientation that was missing in iterations 1 and 2.

**UQ-003 is CLOSED.** Significant finding from iteration 2 fully resolved.

---

## Goal 2 — CLI help output

**Verdict: PASS** (unchanged from iteration 2)

### Evidence

```
node packages/quay/bin/quay.js --help
```

Output (abridged):

```
quay — task management for AI-assisted development

Usage:
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--json]
  quay task view <task-id> [--json]
  quay task edit <task-id> --status <status> [--json]
  quay task check <task-id> [--json]
  quay action list <task-id> [--json]
  quay action run <task-id> <action-id> [--json]
  quay serve [--port <port>]
  quay mcp

Examples:
  quay task list --prefix QX          List only QX-* tasks
  quay task list --status todo        List todo tasks
  quay task view QX-001               View task details
  quay task edit QX-001 --status done Mark task done
```

Comprehensive, self-contained, good examples. No regression from iteration 2. Minor findings carried forward (MCP startup noise, `action run` output is technical, `quay mcp` undescribed) — these are unchanged and already tracked.

---

## Goal 3 — Finding a task to work on (sort by updated, prefix filter)

**Verdict: PASS**

### Evidence

```
node packages/quay/bin/quay.js task list --prefix QX --sort updated
```

Returns:
```
# filtered: QX-* (15 tasks)
QX-015	done	primitive	Add project orientation banner to Web UI homepage (UQ-003)
QX-014	done	primitive	Advance button tooltip and target status label (UQ-014)
QX-013	done	primitive	Gate-fail feedback — show error banner when Advance is blocked (UQ-013)
...
QX-001	todo	primitive	Add cross-experiment task filtering to CLI and Web UI
```

The `# filtered: QX-* (15 tasks)` header is self-labeling — a new contributor knows exactly what the filter applied. The only open (`todo`) task in the QX experiment is `QX-001`, easily findable at the bottom of the updated-sort list. The Web UI equivalent (`/?prefix=QX&sort=updated`) produces the same scoping, confirmed by the Prefix filter links in the rendered HTML.

Task discovery workflow is viable and discoverable from the `--help` output and the Web UI filter links.

---

## Goal 4 — Advance button tooltip (UQ-014 fix verification)

**Verdict: PASS with CONCERNS** (severity: minor)

### Evidence — task list page

```
curl http://localhost:4173/ | grep 'title='
```

Returns:

```
title="Advance task to next status"
```

### Evidence — task detail page

```
curl http://localhost:4173/task/QX-001 | grep 'title='
```

Returns:

```
title="Advance to ready"
```

### Assessment

**Detail page (PASS)**: The Advance button on the task detail page carries `title="Advance to ready"` — the tooltip names the concrete target status (`ready`). A new contributor hovering the button (on desktop) will see the target state in the browser tooltip. This directly closes UQ-014 for the detail page.

**List page (CONCERNS — minor)**: The Advance button on the task list page carries the generic `title="Advance task to next status"` — it does not name the target status. This is a weaker tooltip than the detail page. A new contributor on the list page hovering "Advance" next to a `todo` task still does not know whether clicking will move it to `ready`, `in_progress`, or something else.

The discrepancy between list-page and detail-page tooltip quality is minor — a contributor who clicks through to the detail page gets the precise label — but the list-page gap means UQ-014 is only partially resolved at the list-page level.

**UQ-014 status**: PARTIALLY resolved. Detail page: closed. List page: tooltip generic (not target-specific).

---

## Goal 5 — Task detail readability and "Advance to [status]" label

**Verdict: PASS**

### Evidence

```
curl http://localhost:4173/task/QX-001
```

The detail page for `QX-001` renders:

- **H1**: `QX-001: Add cross-experiment task filtering to CLI and Web UI [todo]` — task ID, title, and current status all in one line.
- **Meta**: `role: primitive · labels: capability_breadth, usability_quality`
- **Advance button**: `<button type="submit" title="Advance to ready">Advance</button>`
- **Body**: Full structured content — Proposal, Plan, AC (with checkbox state), DoD — rendered as clean HTML via marked-markdown.

### Assessment

The task body is readable and well-structured. Headings (`h3`) mark each section. AC items are rendered as checkboxes (`[ ]` for open, `[x]` for closed). A new contributor can read the task and understand exactly what is needed.

The "Advance to ready" label (in the tooltip) and the `[todo]` suffix on the h1 together tell a contributor: "This task is currently `todo`; clicking Advance will move it to `ready`." That is sufficient context.

Back-link reads `← back to list` and, when accessed via `?from=`, restores the exact filter/sort context (confirmed: `href="/?prefix=QX&sort=updated"` when navigating from that URL). This is a well-executed UX detail.

---

## Goal 6 — Gate-block feedback (UQ-013 fix verification)

**Verdict: PASS** (severity: N/A — previously not addressed, now resolved)

### Evidence — attempting to advance an AC-unchecked task

```
curl -X POST http://localhost:4173/task/QX-001/action/advance -L | grep "error-banner"
```

Returns:

```html
<div class="error-banner" role="alert">
  <strong>Error:</strong> Gate check failed: 0/4 AC checkboxes checked
</div>
```

### Assessment

The error banner is:

1. **Visible and styled** — `.error-banner { background: #fff0f0; border-left: 3px solid #cc0000; color: #8b0000; }` — red left-border and background clearly signals an error, distinct from the page's normal styling.
2. **Semantically correct** — `role="alert"` is set, so screen readers will announce the error without requiring the user to navigate to it.
3. **Informative** — "Gate check failed: 0/4 AC checkboxes checked" tells the contributor exactly why the advance was blocked and how many criteria remain. A contributor reading this knows: (a) there is a gate, (b) it checks AC checkboxes, (c) all 4 are unchecked. They know what they need to do before advancing.

For comparison, the prior behavior was an HTTP redirect back to the list page with no feedback — the contributor had no way to tell the action failed. This was the significant UQ-013 gap.

The success case (advancing a `done` task) produces `<div class="success-banner" role="status"><strong>Done:</strong> Task QX-015 advanced</div>` — analogously styled in green, also with an ARIA role.

**UQ-013 is CLOSED.** Significant finding from iterations 1–2 fully resolved.

---

## Comparison to iteration 2 (regression / improvement check)

| Finding (iter 2) | Status in iter 3 |
|---|---|
| "Advance" button: no tooltip, no description (significant) | **Resolved** — tooltip present on both pages; detail page has target-status specific text; list page generic (minor remaining gap) |
| No project orientation / "what is Quay?" preamble (significant, UQ-003) | **Resolved** — orientation banner present with lifecycle description |
| No gate-block feedback after Advance POST (not yet tracked as finding, but UQ-013) | **Resolved** — error-banner with `role="alert"` and specific message |
| Status values not defined in UI (minor) | **Resolved** — orientation banner includes `todo → in_progress → needs-human → done` |
| "Advance" button in last (scrollable) column on mobile (minor) | Carried — not tested this iteration (no mobile testing configured) |
| Label filter list is long with no grouping (minor) | Carried |
| Default pagination not oriented to new contributor (minor) | Carried |
| favicon.ico 404 (minor) | Carried |
| CLI: subcommand `--help` delegates to global (minor) | Carried |
| CLI: `action run` output is technical / ambiguous (minor) | Carried |
| CLI: `quay mcp` undescribed in `--help` (minor) | Carried |
| CLI: MCP startup noise (minor) | Carried |

### Net change

Two significant findings from iteration 2 are now fully resolved (UQ-003, UQ-013). One significant finding (UQ-014) is partially resolved — detail page closed, list page tooltip remains generic (downgraded to minor). No regressions introduced.

---

## Summary of findings

| Finding | Severity | Surface | Change from iter 2 |
|---------|----------|---------|---|
| UQ-014 partially resolved: list-page Advance tooltip is generic, not target-specific | minor | Web UI list page | **Downgraded from significant** (was no tooltip at all; now has tooltip but generic) |
| "Advance" button in last (scrollable) column on mobile | minor | Web UI mobile | Carried |
| Label filter list is long with no grouping | minor | Web UI | Carried |
| Default pagination not oriented to new contributor | minor | Web UI | Carried |
| favicon.ico 404 | minor | Web UI | Carried |
| Subcommand `--help` delegates to global | minor | CLI | Carried |
| `action run` output is technical / ambiguous | minor | CLI | Carried |
| `quay mcp` undescribed in `--help` | minor | CLI | Carried |
| MCP startup noise on every command | minor | CLI | Carried |

**Zero blocking findings. Zero significant findings.** All remaining findings are minor. The new-contributor experience has materially improved in iteration 3.

### Per-surface verdicts

| Surface | Verdict | Severity |
|---------|---------|----------|
| Web UI — orientation and discoverability | **PASS** | — |
| Web UI — Advance button tooltip (detail page) | **PASS** | — |
| Web UI — Advance button tooltip (list page) | **CONCERNS** | minor |
| Web UI — gate-block error feedback | **PASS** | — |
| Web UI — task detail readability | **PASS** | — |
| CLI — `--help` output | **PASS** | — |
| CLI — task discovery workflow | **PASS** | — |

### Recommended next actions (minor priority)

1. **List-page Advance tooltip** — render target status in the `title` attribute at the list-page level, just as the detail page does. This closes the remaining UQ-014 gap.
2. **Label filter grouping** — consider grouping 40+ labels by prefix or category to reduce visual noise for new contributors.
3. **Pagination default** — consider defaulting to `sort=updated` to surface recently active tasks without requiring contributors to know the query param.
