# Simulated-user audit — New contributor with no context
# Iteration 2

**Persona**: New contributor ("new-contributor") — zero prior knowledge of quay's conventions. Goal: become productive using only what the interface itself teaches.

**Date**: 2026-07-17
**Surfaces tested**: CLI (`--help`, `task list`, `task view`), Web UI desktop (HTML/CSS analysis + curl), Web UI mobile (CSS/HTML analysis)

---

## CLI Surface

**Verdict: PASS**

### Holistic impression

`quay --help` output is comprehensive and self-contained. A new contributor learns in one command: the project is "task management for AI-assisted development", the full subcommand set (`task list`, `task view`, `task edit`, `task check`, `action list`, `action run`, `serve`, `mcp`), all options with descriptions, and concrete examples. The `--sort id|status|updated` option is clearly listed with its accepted values.

`quay task list --sort updated --status todo` returns 3 tasks (QX-001, PC-PARENT, QN-021) in descending-updated order, with a `# filtered:` header confirming what the filter applied. Fully usable.

### What was tested

1. `node packages/quay/bin/quay.js --help` — comprehensive, unchanged from iteration 1.
2. `quay task list --sort updated --status todo` — 3 tasks, correct columnar output, self-labeling header.
3. `quay task view QX-001` — full task body (Proposal, Plan, AC, DoD) in readable plain text.

### Specific findings (carried over from iteration 1, no regressions)

1. **`--help` on subcommands delegates to global** (severity: minor, carried from iter 1) — unchanged.
2. **`action run` output is MCP-flavored, no human-readable confirmation** (severity: minor, carried) — unchanged.
3. **Status lifecycle not explained in CLI** (severity: minor, carried) — unchanged.
4. **`quay mcp` has no description in `--help`** (severity: minor, carried) — unchanged.
5. **MCP startup noise on every command** (severity: minor, carried) — unchanged.

No new CLI regressions introduced in iteration 2.

---

## Web UI — Desktop Viewport (HTML/CSS analysis)

**Verdict: PASS with CONCERNS**

### Holistic impression

The Web UI renders a functional task list with filters for Prefix, Status, Sort, and Label. The new `Updated ↓` sort link is present and correctly labeled — clicking it sorts tasks by last-updated descending, surfacing the most recently active work first. That is a concrete improvement for a new contributor trying to find active tasks.

The new inline "Advance" button is now present on the task list page (in addition to the detail page). However, discoverability and meaning of "Advance" remain concerns for a zero-context new contributor.

### Specific findings

1. **"Advance" button has no tooltip, no description, no hover text** (severity: significant) — The list page renders `<button type="submit">Advance</button>` with no `title` attribute, no `aria-label` beyond the button text, and no adjacent explanation. A new contributor sees a blue "Advance" button next to a task they've never heard of, with no indication of what it does (does it move the task to the next status? trigger an AI agent? notify someone?). The `provider.yml` defines `payload: "Drive task {{id}} forward one status transition using its current status's Skill"` but this payload text is never surfaced in the UI. The detail page has the same button with the same absence of explanation.

   Compared to iteration 1, the button has moved to the list page (CB-003 implemented), but the discoverability gap from iteration 1 finding #4 ("no confirmation or feedback") remains unresolved, and the new list-page placement magnifies it: a contributor may click "Advance" on the wrong task by accident, with no undo.

2. **No project orientation / "what is Quay?" preamble on the homepage** (severity: significant, UQ-003 remains open) — The page title is "Quay — task list (native provider)". There is no tagline, no one-sentence description, no link to a README or "Getting started" page. A new contributor landing on this UI sees a table of 103 tasks with cryptic IDs (PC-PARENT, QC-001, QN-021...) and no explanation of what this system is, what the statuses mean, or what their role as a contributor should be. The CLI `--help` says "task management for AI-assisted development" — this string does not appear anywhere in the Web UI.

3. **Status values not defined anywhere in the UI** (severity: minor) — `todo`, `ready`, `done`, `needs-human` appear in filter links and task rows. None are explained. A new contributor filtering for `ready` tasks does not know what "ready" means in this system (ready for AI execution? for human review? for merge?).

4. **Sort label "Updated ↓" — PASS** — The updated sort is clearly labeled with the arrow direction indicating descending order. A new contributor can find it intuitively. The link becomes bold text when active (`<strong>Updated ↓</strong>`), confirming the current sort. This is well-executed.

5. **Inline "Advance" button preserves filter context after POST — PASS** — The `?from=` param correctly encodes the current list URL (including `sort=updated&status=todo`) so clicking Advance and returning to the list retains the filter/sort state. This is a good UX detail.

6. **Only `todo` tasks show "Advance"; `done` tasks correctly show no button** — The `whenStatus: ["todo", "ready"]` filter in `provider.yml` is applied correctly. A contributor does not see an Advance button on already-completed tasks. This is correct behavior.

7. **Label filter wall (40+ labels) — no grouping** (severity: minor, carried from iter 1) — unchanged, more prominent now that the label list itself has grown.

8. **No favicon** (severity: minor, carried from iter 1) — 404 on `favicon.ico`.

9. **Pagination defaults not oriented to new contributor** (severity: minor, carried from iter 1) — Default view is insertion order, not updated order; 103 tasks across 6 pages. Still requires knowing to apply `?sort=updated&status=todo` to see active work.

---

## Web UI — Mobile Viewport (CSS/HTML analysis)

**Verdict: PASS**

### Holistic impression

The CSS includes appropriate mobile adaptations at `max-width: 600px`: `table { display: block; overflow-x: auto; }` with `-webkit-overflow-scrolling: touch`, and reduced padding on `th`/`td`. The new "Advance" button in the `actions` column will be visible on mobile, though the table scrolling means it may be off-screen on very narrow viewports until the user scrolls right.

### Specific findings

1. **"Advance" button in scrollable table on mobile** (severity: minor) — The actions column is the last column in the table (id, status, role, title, labels, actions). On a 375px viewport, the table scrolls horizontally. The "Advance" button is in the rightmost column and may not be immediately visible without scrolling. A new contributor on mobile may not discover it. The detail page's Advance button (above the fold) is a more reliable path on mobile.

2. **Label filter wall on mobile** (severity: minor, carried) — The 40+ label links wrap into a multi-line block on narrow viewports.

---

## "Advance" UX: end-to-end assessment

A new contributor arriving at the Web UI who clicks "Advance" on `QX-001`:
- The form POSTs to `/task/QX-001/action/advance`
- The action handler composes a payload and attempts manda delivery (or degrades to print)
- The server returns HTTP 302 back to the list page (with `?from=` preserved)
- **The contributor sees no confirmation, no error, no change in the task row** — the page refreshes and looks identical

This means: clicking "Advance" on a task the contributor doesn't fully understand, with no feedback that anything happened, no indication of what was triggered, and no way to tell if it succeeded. The action does work internally (manda delivery), but this is invisible to the user.

Compare to a contributor using the CLI: `quay action run QX-001 advance` at least prints a JSON object showing `"delivered": "manda"` or `"delivered": "print"`, giving some confirmation.

The Web UI Advance button is less informative than the CLI equivalent.

---

## Comparison to iteration 1 (regression / improvement check)

| Finding (iter 1) | Status in iter 2 |
|---|---|
| "Advance" button on detail page, no confirmation/feedback (minor) | **Regressed** — now also on list page (CB-003 delivered), but still no feedback; gap is more visible now |
| Label filter list very long, no grouping (minor) | Still present (list has grown to 40+ labels) |
| No onboarding/orientation preamble (minor) | **Upgraded to significant** — 103 tasks now visible; UQ-003 remains open; problem feels larger |
| Pagination not oriented to new contributor (minor) | Still present (now 6 pages / 103 tasks) |
| favicon.ico 404 (minor) | Still present |
| Task list table at mobile width unverified (minor) | Partially addressed by CSS analysis; live Playwright verification still pending |
| CLI: all minor findings | Unchanged; no regressions |

### New improvements in iteration 2

| Improvement | Surface | Notes |
|---|---|---|
| "Updated ↓" sort link on list page (CB-004/CB-005/CB-012) | Web UI, CLI | Clear label, correct behavior, filter context preserved |
| Inline "Advance" button on list page (CB-003) | Web UI | Functional; discoverability gap remains |
| Prefix filter navigation (QX-004) | Web UI | Already present from prior iteration; working correctly |

---

## Summary of findings

| Finding | Severity | Surface | Change from iter 1 |
|---------|----------|---------|---|
| "Advance" button: no tooltip, no description, no feedback | significant | Web UI desktop + mobile | Escalated (now on list page too) |
| No project orientation / "what is Quay?" preamble (UQ-003) | significant | Web UI | Escalated (103 tasks now) |
| Status values not defined in UI | minor | Web UI | Carried |
| "Advance" button in last (scrollable) column on mobile | minor | Web UI mobile | New |
| Label filter list is long with no grouping | minor | Web UI (both) | Carried |
| Default pagination not oriented to new contributor | minor | Web UI | Carried |
| favicon.ico 404 | minor | Web UI | Carried |
| Subcommand `--help` delegates to global | minor | CLI | Carried |
| `action run` output is technical / ambiguous | minor | CLI | Carried |
| Status lifecycle not explained | minor | CLI | Carried |
| `quay mcp` undescribed in `--help` | minor | CLI | Carried |
| MCP startup noise | minor | CLI | Carried |

**Two significant findings remain open.** No new blocking findings. The "Advance" discoverability gap was minor in iteration 1 (button only on detail page); it is now significant because the button appears on the list page where a contributor might click it for the wrong task without understanding the consequence, with zero visual feedback.

**Recommended next actions**:
- Add a `title` attribute to Advance buttons: `title="Drive this task forward using its current Skill (quay:author for todo, quay:execute for ready)"`.
- Add a one-sentence page header or footer: "Quay: AI-assisted task management. todo → AI drafts → ready → AI executes → done."
- Flash a brief success/error message after Advance POST (e.g., "Action queued for QX-001").
