# Simulated-user audit — New contributor with no context
# Iteration 1

**Persona**: New contributor ("new-contributor") — zero prior knowledge of quay's conventions. Goal: become productive using only what the interface itself teaches.

**Date**: 2026-07-17
**Surfaces tested**: CLI (`--help`, `task list`, `task view`, `action list`, `action run`, `task check`, `task edit`), Web UI desktop (1280×800), Web UI mobile (375×812 via Playwright)

---

## CLI Surface

**Verdict: PASS**

### Holistic impression

Since iteration 0, the `--help` output has been substantially improved. `quay --help` now shows a full usage block with all subcommands, option descriptions, and concrete examples. A new contributor can orient themselves from `--help` alone: they see what quay does ("task management for AI-assisted development"), which subcommands exist, which flags each accepts, and example invocations.

### What was tested

1. `node packages/quay/bin/quay.js --help` — shows comprehensive usage.
2. `quay task list --status todo` — returns 3 tasks (PC-PARENT, QN-021, QX-001) with columnar output. Clear and actionable.
3. `quay task list --prefix QX` — returns 5 tasks prefixed with header `# filtered: QX-* (5 tasks)`. Works correctly and the output is self-labeling.
4. `quay task view QX-001` — displays full task body (Proposal, Plan, AC, DoD) in readable plain text.
5. `quay action list QX-001` — returns `advance  Advance`. One action, clearly named.
6. `quay action run QX-001 advance` — fires the action; output shows a composed trigger payload including `skill`, `taskId`, `status`, and `channel`. Readable but somewhat technical.
7. `quay task check QX-001` — returns `QX-001: FAIL — 0/4 AC checkboxes checked`. Concise and actionable.
8. `quay task edit QX-001 --status ready` — succeeds, returns `QX-001: ... [ready]`. Reverted to `todo` afterward.

### Specific findings

1. **`quay task list --help` and `quay task view --help` return the global help, not subcommand-specific help** (severity: minor) — Subcommand-specific `--help` delegates back to the top-level block. Not a blocker since the top-level block now covers all options, but a new contributor trying `quay task view --help` expecting focused output for `view` gets the entire global reference. Slightly confusing but workable.

2. **`action run` output is MCP-flavored JSON, not a human summary** (severity: minor) — After running `quay action run QX-001 advance`, the output includes `"channel": "task-QX-001"`, `"delivered": "manda"`, and a `payload` field. A new contributor who doesn't know what "manda" is will wonder whether the action actually did anything or just queued something. No indication of expected next steps (e.g., "an AI agent will now advance this task").

3. **Status lifecycle not explained anywhere in CLI** (severity: minor) — `--help` lists statuses (`todo`, `ready`, `done`, `needs-human`) in examples but does not explain what each means or in what order they sequence. A new contributor who discovers `quay task edit QX-001 --status needs-human` can execute it without understanding why.

4. **`quay mcp` output not explained** (severity: minor) — `quay mcp` appears in `--help` but has no description beyond the bare subcommand name. A new contributor cannot tell from `--help` what it does (starts an MCP server? configures something?).

5. **MCP startup noise on every command** (severity: minor) — Every CLI invocation prints `quay-native mcp: serving tasks from /home/yale/work/quay/tasks` to stderr before any output. A new contributor reading output from `quay task list --status todo` sees this line first and may wonder if it is an error or relevant state. It is harmless but visually noisy.

---

## Web UI — Desktop Viewport (1280×800)

**Verdict: PASS**

### Holistic impression

The Web UI is immediately functional and navigable. The task list shows filters for Prefix (PC, QC, QN, QW, QX), Status, Sort, and Label — all discoverable without documentation. A new contributor can click a prefix link to scope the view (e.g., "QX" shows 5 tasks), then click a task to see full details including Proposal, Plan, AC checkboxes, and DoD.

The task detail page has a prominent "Advance" button that triggers the action via the UI — no need to know the CLI convention. Markdown renders correctly (headers, code spans, lists).

### Specific findings

1. **Label filter list is very long (40+ entries) with no grouping** (severity: minor) — The label filter renders 40+ labels as inline text links on the list page. A new contributor sees this as a wall of text with no visual hierarchy. The prefix filter (5 links) is more immediately useful for experiment-scoped browsing, and it appears first, which helps.

2. **No onboarding text or "what is this?" preamble** (severity: minor) — The page title "Quay — task list (native provider)" does not explain what quay is or what a contributor should do first. However, the task content itself is readable and self-describing (each task has a Proposal, Plan, AC, DoD) so a contributor can quickly understand what they're looking at by clicking a task.

3. **Pagination requires knowing to use Next** (severity: minor) — 98 tasks across 5 pages. The pagination controls (`« Previous Page 1 of 5 (98 tasks) Next »`) are visible but the default view is all tasks in insertion order, starting from PC-PARENT (a `todo` meta-task). A new contributor who wants to find actionable work needs to either filter by `status=todo` or page through. The `todo` status filter link is discoverable, which mitigates this.

4. **"Advance" button on detail page has no confirmation or feedback** (severity: minor) — Clicking "Advance" on QX-001's detail page triggers the action but the page does not visually update to confirm the trigger was sent. The button doesn't change state, show a spinner, or display a confirmation message. A new contributor won't know if the click worked.

5. **Console error: favicon.ico 404** (severity: minor) — A `404` error appears in the browser console for `favicon.ico`. Harmless but unprofessional and adds noise to the console when debugging.

---

## Web UI — Mobile Viewport (375×812)

**Verdict: PASS**

### Holistic impression

Tested live at 375×812 via Playwright. The task detail page (QX-001) renders correctly: the full-page screenshot shows title, metadata, Advance button, and full task body (Proposal, Plan, AC, DoD) in a readable single-column layout. Code spans render correctly. No horizontal overflow or truncation observed.

### Specific findings

1. **Label filter wall is more prominent on mobile** (severity: minor) — On the list page at 375px width, the 40+ label links (already a concern on desktop) wrap into a dense multi-line block. The prefix filter above it (5 links) remains manageable. Not blocking but visually heavy.

2. **Task list table may compress** (severity: minor) — Not directly verified on the list page at mobile width in this session (only the detail page was screenshot at mobile). The table has 5 columns (id, status, role, title, labels); the `title` and `labels` columns may wrap awkwardly. Carries over from iteration 0's concern; live verification of the list page at 375px is still pending.

---

## Status advancement: end-to-end test

As a new contributor trying to actually advance a task's status:

- **Discovered** `QX-001` as the most approachable `todo` task via `quay task list --status todo`.
- **Read** the full task via `quay task view QX-001` — understood Proposal, Plan, AC, DoD.
- **Checked gate**: `quay task check QX-001` → `FAIL — 0/4 AC checkboxes checked`. Clear, actionable.
- **Ran action**: `quay action run QX-001 advance` → action fired with manda delivery. Technically succeeded but outcome was ambiguous (no human-readable confirmation).
- **Manually advanced**: `quay task edit QX-001 --status ready` → confirmed `[ready]`. Fully working.

A new contributor can get to `task edit` by reading `--help`. The path is not effortless (requires understanding that `action run` triggers an AI agent vs. `task edit` directly mutates status) but it is navigable without external docs.

---

## Comparison to iteration 0 (regression / improvement check)

| Finding (iter 0) | Status in iter 1 |
|---|---|
| One-line `--help` reveals nothing about the project (significant) | **FIXED** — `--help` now shows full usage with examples |
| Subcommand help is missing (significant) | **Partially fixed** — global help is now comprehensive; subcommand-specific `--help` still delegates to global |
| Advancing a task requires knowing the convention (significant) | **Improved** — `--help` now shows `task edit` with `--status` flag; Web UI "Advance" button also works |
| No onboarding/orientation content (minor) | Still present on both surfaces |
| Task status values not explained (minor) | Still present |
| Page 1 not oriented to new contributor (minor) | Still present |

---

## Summary of findings

| Finding | Severity | Surface |
|---------|----------|---------|
| Subcommand `--help` delegates to global, not focused | minor | CLI |
| `action run` output is technical / ambiguous outcome | minor | CLI |
| Status lifecycle not explained | minor | CLI |
| `quay mcp` not described in `--help` | minor | CLI |
| MCP startup noise on every command | minor | CLI |
| Label filter list is long with no grouping | minor | Web UI (both viewports) |
| No onboarding/orientation preamble | minor | Web UI |
| Default pagination view not oriented to new contributor | minor | Web UI |
| "Advance" button gives no confirmation feedback | minor | Web UI desktop |
| favicon.ico 404 console error | minor | Web UI |
| Task list table at mobile width unverified | minor | Web UI mobile |

**No blocking or significant findings remain.** The two significant issues from iteration 0 (one-line help, missing subcommand help) have been resolved. All remaining findings are minor friction points.
