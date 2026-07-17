# Simulated-user audit — Comparison-to-mature-tool reviewer
# Iteration 3 — live CLI and Web UI exercise

**Persona**: Comparison reviewer holding quay up against GitHub Issues AND Linear (chosen comparators: GitHub Issues for breadth, Linear for modern task-tracker UX — in-progress status, keyboard shortcuts, cycle/priority model).

**Date**: 2026-07-17
**Comparison tools**: GitHub Issues / `gh` CLI; Linear (app.linear.app)
**Surfaces tested**:
- CLI: `node packages/quay/bin/quay.js` — all documented subcommands
- Web UI: `http://localhost:4173/` — list page, detail page, action flows
- Task data model: JSON output via `--json` and raw `.md` files in `tasks/`
**Task corpus**: 108 tasks (3 todo, 3 needs-human, 102 done; no `ready` or `in_progress` tasks currently in corpus)

**Scope note**: Findings already tracked in previous iterations are excluded. This report targets NEW gaps a comparison reviewer would find AFTER the iteration-1 and iteration-2 improvements were shipped (sort-by-updated, inline Advance button on list, prefix filter, back-link context preservation, mobile column hiding, orientation banner, gate-fail feedback, tooltip on Advance).

---

## 1. CLI Surface

**Verdict: CONCERNS**

### New findings not in previous iterations

**CR-001: Multi-label CLI flag silently last-wins — no error, wrong behavior** (severity: significant)

Running `node quay.js task list --label bug --label cli` silently returns only `cli`-labeled tasks (2 results). The `parseFlags()` function (quay.js lines 15-34) uses simple key-value assignment: the second `--label` overwrites the first. There is no error, no warning, and no indication that the first label was dropped.

- GitHub Issues: `gh issue list --label bug --label cli` applies AND-logic across multiple labels.
- Linear: the label filter panel supports multi-select, applying AND-logic.
- Quay: last flag wins silently. A user who writes `--label bug --label cli` expecting intersection gets only `cli`. The help text (`--label <label>`) does not indicate that the flag is single-valued.

This is particularly problematic because the task prompt explicitly asks users to check multi-label filtering — and the result looks plausible (returns tasks) without revealing that the first label was ignored.

**CR-002: No "in_progress" / active-work status — the 4-state model has a gap for work-in-flight** (severity: significant)

Linear's core model has `Backlog → Todo → In Progress → Done`. The `In Progress` state is the fundamental signal: "someone is actively working this right now." Quay's 4-state model (`todo → ready → done / needs-human`) substitutes `ready` for "someone should work this next" but has no explicit `in_progress` state.

Confirmed by inspection: the `provider.yml` status list is `[todo, ready, done, needs-human]`. The status_skill_map maps `todo → quay:author` and `ready → quay:execute`. There is no `in_progress` state. With 108 tasks and 0 in `ready` state in the live corpus, the intermediate states are effectively invisible in practice.

Impact: a team using quay has no way to see which tasks are actively being worked. GitHub Issues uses the assignee + comment activity as a proxy. Linear uses `In Progress` as an explicit status. Quay provides neither. The `ready` state (meaning "execution skill should run this") is not equivalent to `in_progress` (meaning "a human or agent is actively running it now").

**CR-003: No priority / urgency dimension** (severity: significant)

Linear's defining feature is the priority field (Urgent / High / Medium / Low / No priority). GitHub Issues uses milestones and labels as a priority proxy. Quay has no priority concept.

Confirmed by examining the task data model (`--json` output): fields are `id, title, status, labels, parent, children, role, extra, body, updatedAt`. No `priority` field exists. The `extra: {}` field is present but unused and undocumented.

A reviewer coming from Linear would immediately ask: "How do I know which task to work on next?" Quay's answer is implicitly "sort by status" or "use labels" — but there is no enforced or documented convention for urgency, and the `extra` escape hatch is opaque.

**CR-004: `task edit` is status-only — no CLI path to update title, body, or labels** (severity: significant, already partially noted but clarified here)

Iteration 1 noted this. What is NEW in iteration 3: after the `task_write` MCP tool (which does support title/body/labels/parent/children) was confirmed to exist, the CLI-MCP asymmetry is now sharper and more confusing. The MCP interface (`task_write`) is a superset of the CLI (`task edit --status only`). A user who reads the MCP schema and then goes to the CLI will find the CLI missing 5 of the 7 writable fields.

Quay's own CLI help text says `quay task edit <task-id> --status <status>` and notes "v1 supports status-only writes" in the error message. This is accurate documentation of a limitation, but the limitation is surprising given the MCP tool's broader surface.

**CR-005: No `--assignee` filter and no assignee field in data model** (severity: minor)

Already noted as minor in iteration 1. NEW in iteration 3: confirmed that the `extra: {}` field does not contain assignee data in any existing tasks. The gap is real and total — no workaround exists. Linear makes assignee the most prominent task attribute (each task shows who owns it).

**CR-006: No `task create` CLI command — new-task creation has no human-facing path** (severity: significant, confirmed still absent)

Already noted in iteration 1. Still absent in iteration 3. The MCP `task_write` tool can create tasks (id + title + status is sufficient for a minimal task). The CLI has no equivalent. This means the only human-facing creation path is: write a `.md` file manually in the `tasks/` directory with the correct frontmatter syntax.

No "New Task" button exists in the Web UI either (confirmed: `curl http://localhost:4173/new` returns "not found"; no creation form exists on the list page).

---

## 2. Web UI — Task List Page

**Verdict: CONCERNS**

### New findings not in previous iterations

**CR-007: Multi-label filtering via URL params silently takes only the first label** (severity: significant)

The Web UI's serve.js uses `url.searchParams.get("label")` (line 355), which returns only the first value when `?label=bug&label=cli` is supplied. Unlike the CLI (which uses last-wins), the Web UI uses first-wins. Neither is documented or surfaced to the user.

Effect: `?label=bug&label=cli` silently returns only bug-labeled tasks. The label filter UI renders links for exactly one label at a time and does not offer a multi-select UI at all. However, a technically sophisticated user who manually constructs the URL expecting AND-logic gets silently wrong behavior.

This is a new finding because: (a) it is distinct from the "label filter wall" (UQ-006 / CB-007, already known), and (b) the behavior differs between CLI (last-wins) and Web UI (first-wins) — an additional inconsistency.

**CR-008: Advance button on list page triggers action without showing which status will result** (severity: minor)

The `Advance` button on the list page (added in QX-009) has a `title` tooltip ("Advance task to next status") that does not name the target status. On the detail page (QX-014), the tooltip shows "Advance to ready" or "Advance to done". This improvement was NOT backported to the list-page button.

Confirmed by examining the list page HTML: `<button type="submit" title="Advance task to next status">Advance</button>` (list page) vs `<button type="submit" title="Advance to ready">Advance</button>` (detail page).

Impact: on the list page, a user clicking `Advance` on a todo task does not know the button will move it to `ready` vs `done`. Linear shows the target state in the status transition UI. This is a minor but concrete inconsistency between the two action surfaces.

**CR-009: No "last updated" timestamp column on the task list** (severity: significant)

The task data model includes `updatedAt` (ms timestamp from file mtime). The sort-by-updated feature (QX-008) uses this to sort. However, the `updatedAt` value is never rendered in the UI — neither on the list page (no timestamp column) nor on the detail page (no "Last updated: 3 hours ago" display).

Confirmed: task detail page HTML contains no rendered timestamp. The list table columns are: id, status, role, title, labels, actions. No date column.

GitHub Issues shows "opened 3 days ago · updated 2 hours ago" on every issue row. Linear shows the last-modified date in the task view. Quay knows the mtime (uses it for sort) but never shows it. A reviewer who wants to know "when was this task last touched?" must sort by updated and infer recency from position — they cannot see the actual date.

**CR-010: Orientation banner does not explain the status lifecycle or what "Advance" does** (severity: minor)

The orientation banner added in QX-015 reads: "Quay — AI-assisted task management. Task statuses: `todo` → `in_progress` → `needs-human` → `done`. Use the Prefix filter to focus on one experiment's tasks."

However, the status lifecycle shown in the banner (`todo → in_progress → needs-human → done`) does not match the actual status model. The actual statuses are `todo → ready → done / needs-human`. There is no `in_progress` status in the system. The banner introduces a status name that does not exist.

This is a new finding: the banner is inconsistent with the actual data model, which could confuse a new user into looking for tasks with `status: in_progress` and finding none.

**CR-011: Detail page shows no task age / creation metadata** (severity: minor)

Linear shows: created by, created at, updated at, cycle, priority, estimate. GitHub Issues shows: opened by, opened at, milestone. Quay's detail page shows: role, labels, parent (if any), children (if any), body. No authorship, no dates.

The `updatedAt` field is available in the task JSON but not rendered on the detail page. There is no `createdAt` field at all (creation date is not tracked separately from mtime). This means even with improvements, a user reading a task detail has no way to know if the task was filed yesterday or 3 months ago.

---

## 3. Web UI — Task Detail Page

**Verdict: CONCERNS**

### New findings

**CR-012: Action button present for "needs-human" tasks — should be absent** (severity: significant — potential bug)

The `Advance` button is configured to show `whenStatus: [todo, ready]` per `provider.yml`. On detail pages, the serve.js code filters action buttons by `!b.whenStatus || b.whenStatus.includes(t.status)`. This should correctly hide the button for `needs-human` tasks.

However, when checking a `needs-human` task, the behavior needs verification. Iteration 1 noted "for QN-017 (needs-human), no Advance button is present — correct." This was not independently re-verified in iteration 3 after the QX-009 and QX-013 changes. If the gate-check logic introduced in QX-013 (which now runs before the action is delivered) is correct, a manual click of a hypothetical Advance button on a `needs-human` task would be blocked at the gate, not at the button-render level.

This is not a confirmed bug but a gap that was not re-verified after two rounds of changes to the action flow.

**CR-013: "needs-human" task detail gives no guidance on what to do** (severity: minor — confirmed still present from iteration 1)

Noted in iteration 1, still present in iteration 3. A `needs-human` task shows no action buttons and no explanation. A GitHub Issues user would see a "This issue requires human attention" label or similar. Quay shows the task body and nothing else. There is no call-to-action, no instructions, no indication of what the human is supposed to do.

---

## 4. Filtering — Multi-Label and Multi-Dimension

**Verdict: FAIL**

### Summary of filtering gaps (new findings only)

| Mechanism | What user expects | What quay does |
|-----------|-------------------|----------------|
| `--label A --label B` (CLI) | AND filter (tasks with both A and B) | silently takes last label only (B) |
| `?label=A&label=B` (Web UI URL) | AND filter | silently takes first label only (A) |
| CLI `--label A --label B` vs Web UI | consistent behavior | inconsistent: CLI=last-wins, Web=first-wins |
| `--assignee <user>` (CLI) | filter by owner | not supported; assignee field does not exist |
| Label + prefix combined in Web UI | composable via URL | works via manual URL construction; UI does not indicate this |

The CLI/Web UI inconsistency on multi-label handling (last-wins vs first-wins) is the new finding here. Both are wrong (expected behavior: AND-join or at minimum an error), and they fail differently, which is worse than a single consistent failure.

---

## 5. What a Linear user specifically would find missing (new vs iteration 1)

Linear-specific gaps not previously documented:

1. **No priority field** — Linear's defining UX. Every task has Urgent/High/Medium/Low. Quay has none.
2. **No cycle/sprint concept** — Linear organizes work into cycles (sprints). Quay has no time-boxing concept.
3. **No "In Progress" state** — Linear's most-used state. Quay's `ready` is the closest analog but means "ready for AI to work" not "currently being worked."
4. **No estimates** — Linear supports story points / time estimates. Quay has none.
5. **No project/team scoping** — Linear has projects and teams as first-class concepts above issues. Quay's prefix scoping is a workaround, not a native concept.
6. **No keyboard shortcuts** — Linear is keyboard-first (press `C` to create, `E` to edit, etc.). Quay's Web UI has no keyboard interactions at all (pure HTML, no JS, confirmed by inspecting the page source).

---

## 6. Positives confirmed still present (not regressed)

- Gate semantics (`task check`) remain a genuine discipline advantage over both GitHub Issues and Linear.
- Structured body (Proposal/Plan/AC/DoD) is more machine-checkable than either comparator.
- Prefix-based experiment scoping is a clean solution for multi-workstream single-repo usage.
- Sort-by-updated (added QX-008) closes the recency ordering gap with GitHub Issues list view.
- Advance button on list page (added QX-009) reduces clicks vs iteration-1 state.
- Back-link filter context preservation (QX-011) — correct and absent in both comparators' basic interfaces.
- Gate-fail feedback banner (QX-013) — Linear shows similar validation errors inline.

---

## 7. Summary table — NEW findings only (not in previous iteration reports)

| Finding ID | Description | Severity | Surface | Comparator gap |
|------------|-------------|----------|---------|----------------|
| CR-001 | Multi-label `--label A --label B` silently uses last label (CLI) | significant | CLI | gh/Linear use AND |
| CR-002 | No `in_progress` / active-work status | significant | Data model, CLI, Web UI | Linear `In Progress` |
| CR-003 | No priority / urgency field | significant | Data model, CLI, Web UI | Linear priority; GH milestones |
| CR-004 | CLI `task edit` is status-only; MCP `task_write` is broader (asymmetry sharpened) | significant | CLI vs MCP | gh issue edit |
| CR-007 | Multi-label `?label=A&label=B` silently uses first label (Web UI) | significant | Web UI | expected AND |
| CR-007b | CLI multi-label = last-wins; Web UI multi-label = first-wins (inconsistency) | significant | CLI vs Web UI | — |
| CR-008 | List-page Advance tooltip lacks target status (detail page has it — inconsistency) | minor | Web UI list | Linear shows target state |
| CR-009 | `updatedAt` known but never displayed (sort uses it, UI never shows it) | significant | Web UI list + detail | GH "updated X ago"; Linear timestamp |
| CR-010 | Orientation banner says `in_progress` — status that does not exist in the model | minor | Web UI | — (internal inconsistency) |
| CR-011 | Task detail page shows no dates, no authorship | minor | Web UI detail | GH "opened by / at"; Linear timestamps |
| CR-013 | `needs-human` task detail gives no guidance (confirmed still present) | minor | Web UI detail | GH "locked issue" explanation |

**Blocking gaps** (would prevent adoption by a team coming from GitHub Issues or Linear):
- No task creation from any human-facing surface (CR-006, known) — still blocking.
- No multi-label filtering (CR-001, CR-007) — the feature is expected and silently broken.
- No priority or active-work status (CR-002, CR-003) — fundamental Linear features absent.

**Significant gaps** (friction, not blocking):
- `updatedAt` never displayed despite being available (CR-009)
- CLI/MCP write asymmetry (CR-004)

**Minor / polish gaps**:
- List-page Advance tooltip inconsistency (CR-008)
- Orientation banner status inconsistency (CR-010)
- No task age on detail page (CR-011)
- No guidance on `needs-human` tasks (CR-013)
