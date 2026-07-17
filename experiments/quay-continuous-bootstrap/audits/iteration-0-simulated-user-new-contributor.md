# Simulated-user audit — New contributor with no context
# Iteration 0, inline degraded-fallback (ENV gap confirmed: no native Agent tool in deferred-tools list)

**Persona**: New contributor with no prior knowledge of quay's conventions. Goal: become productive using only what the interface itself teaches.

**Date**: 2026-07-17
**Surfaces tested**: CLI (`--help`), Web UI desktop, Web UI mobile (viewport-aware HTML inspection)

---

## CLI Surface

**Verdict: CONCERNS**

### Holistic impression
The CLI's top-level `--help` gives exactly one line: `usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...`. This is enough to discover that subcommands exist, but a new contributor has no idea what `quay` is for, what a "task" means in this context, what the statuses mean, or how to start contributing. The subcommand surface is functional but undocumented.

### Specific findings

1. **One-line `--help` reveals nothing about the project** (severity: significant) — `quay --help` returns: `usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...`. There is no description of what quay does, no "getting started" hint, no mention of providers or config. A new contributor cannot self-orient from this alone.

2. **Subcommand help is missing** (severity: significant) — `quay task list --help` shows a task list but no usage text. `quay task edit --help` shows `quay task edit: --status <s> is required (v1 supports status-only writes)` — an error message, not help text. `quay action --help` returns the global usage line again. There is no `--help` path that explains what statuses exist (todo/ready/done/needs-human) or how to advance a task.

3. **Advancing a task status requires knowing the convention** (severity: significant) — To advance QX-001 from `todo` to `ready`, a new contributor must know to run `quay task edit QX-001 --status ready`. This convention is not discoverable from the CLI without reading external documentation.

4. **`quay task list` output mixes all experiments without warning** (severity: minor) — A new contributor seeing 94 tasks across 4 prefix namespaces (QN-*, QC-*, QW-*, QX-*) has no way to know which are relevant to their work. The list is functional but provides no orientation.

5. **`quay mcp` not usable without configuration context** (severity: minor) — A new contributor attempting `quay mcp` without first setting up `.quay/config.yml` will get a configuration error. The error message is helpful (`quay-native mcp: serving tasks from /home/yale/work/quay/tasks`) but the config setup path is not documented in `--help`.

---

## Web UI — Desktop Viewport

**Verdict: PASS with concerns**

### Holistic impression
The Web UI is the best self-orienting surface for a new contributor. The list page shows tasks immediately, the labels and status filters are discoverable, and the detail page shows the full task body (Proposal, Plan, AC, DoD sections). A new contributor can read task bodies and understand what each task requires. The "Advance" action button on the detail page allows status advancement without knowing the CLI convention.

However, the Web UI also provides no explanation of what quay is or what the task lifecycle means. A new contributor arriving at `http://localhost:4173/` sees a table of tasks with no preamble.

### Specific findings

1. **No onboarding or "getting started" content** (severity: minor) — The Web UI shows a task list immediately with no header explaining what quay is, what the experiment is, or what a new contributor should do first. Compare: GitHub Issues shows repository context, description, and README link at the top.

2. **Task status values not explained** (severity: minor) — The filter row shows `todo`, `ready`, `done`, `needs-human` as clickable links but provides no explanation of what each status means or how to advance a task from one to the next.

3. **"Advance" action button on detail page is clear** (severity: N/A, positive) — The action button on the detail page is well-labeled and works. A new contributor can discover this by clicking a task.

4. **Label filter is discoverable** (severity: N/A, positive) — The label list is visible on the list page and filters work correctly.

5. **Page 1 default view (sorted by filesystem order) starts with QC-001** (severity: minor) — A new contributor has no reason to know which of the 94 tasks is the most recent or most relevant to their onboarding. No "start here" affordance exists.

---

## Web UI — Mobile Viewport (HTML/CSS inspection)

**Verdict: PASS with concerns**

### Holistic impression
Responsive CSS breakpoint at 600px is present. The viewport meta tag is correct. On mobile, the same information is accessible but the label filter line (40+ labels as inline links) is likely visually overwhelming on a narrow viewport. The table structure (5 columns: id, status, role, title, labels) may be compressed awkwardly at narrow widths.

### Specific findings

1. **Label filter on mobile** (severity: minor) — 40+ label links rendered inline with `·` separators. On a 390px viewport the CSS adapts the layout but the label list may require significant scrolling or appear as a dense block. Requires live browser verification.

2. **Table columns on narrow viewport** (severity: minor) — The task list table has 5 columns. The mobile CSS adapts the overall layout but individual table columns may overflow or require horizontal scroll. Again, requires live browser verification for definitive assessment.

---

## Summary of blocking/significant findings

| Finding | Severity | Dimension | Surface |
|---------|----------|-----------|---------|
| One-line `--help` reveals nothing about the project | significant | usability_quality | CLI |
| Subcommand help is missing | significant | usability_quality | CLI |
| Advancing a task requires knowing the convention | significant | usability_quality | CLI |
| No onboarding/orientation content | minor | usability_quality | Web UI |
| Task status values not explained | minor | usability_quality | Web UI |
| Page 1 not oriented to new contributor | minor | usability_quality | Web UI |
