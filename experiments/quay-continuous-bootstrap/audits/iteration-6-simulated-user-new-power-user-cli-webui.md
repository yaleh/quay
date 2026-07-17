# Simulated User Audit — New Power User Persona
Date: 2026-07-17
Iteration: 6
Persona: New power user (GitHub Issues background)

---

## CLI feature completeness — PASS

`quay --help` exposes: `task list` (with `--status`, `--label`, `--prefix`, `--sort`, `--search`, `--json`), `task view`, `task edit`, `task check`, `action list`, `action run`, `serve`, `mcp`. Feature surface is comparable to a lightweight GitHub Issues substitute for task tracking. All advertised flags tested and working.

**Minor inconsistency**: The `--search` help text reads "Filter by title substring" and the example says "List tasks with 'bootstrap' in title", but the actual implementation (added in QX-023 this iteration) searches title AND body. The zero-result hint at the bottom correctly says "title/body content." The `--help` text and example are stale — body search is real and working but not reflected in the help copy.

## Search quality (body search false positives?) — FAIL

**Critical false positive problem confirmed.**

Searching `"Proposal"` (case-insensitive) returns **117 of 118 tasks** (CLI: `# search: "Proposal" (117 matches)`; Web UI: "Page 1 of 6 (117 tasks)"). The one non-matching task is `PC-PARENT`, which has a minimal body ("test").

Root cause: virtually every task body in this workspace follows a template that includes a `## Proposal` section. Searching for "Proposal" is therefore useless — it is functionally equivalent to listing all tasks.

This generalizes to any term that appears in the standard task-body template. Other potential false-positive terms include:
- "Done when" / "AC" / "Acceptance Criteria" (present in every task's AC section)
- "Proposal" / "Context" / "Approach" (boilerplate section headings)

**Search result quality for "iteration"**: 100 of 118 tasks matched. Of those 100, only 9 had "iteration" in their title; 91 matched body only. This is technically correct (body search is working as designed), but from a user perspective, most results appear for context mentions in task bodies, not because the task is actually *about* iteration. Signal-to-noise is low for common terms.

**CLI vs Web UI parity**: Both return 100 results for "iteration" and 117 for "Proposal" — parity is exact.

**Web UI placeholder misleads**: The search input shows `placeholder="Search titles…"` despite body search being active. Users who expect title-only scope to reduce noise get the opposite.

## Label nav usability — CONCERNS

The workspace has **46 distinct labels**. The Web UI truncates at 25, showing "… 21 more labels". The truncation is alphabetically ordered, which means labels appearing later alphabetically are hidden. Labels cut off include:

- `usability_quality` — **19 tasks** (active, high-value filter)
- `v1` — **33 tasks** (the single largest label group in the workspace)
- `verification_coverage` — 1 task
- `methodology` — 6 tasks
- `skill` — 3 tasks

**The two most frequently used labels (`v1` with 33 tasks and `usability_quality` with 19 tasks) are not clickable in the label nav.** A power user tracking `v1` scope would need to manually type `/?label=v1` in the URL — there is no affordance in the UI.

The truncation itself (collapsing 40+ labels to avoid an unusable wall) is correct. But alphabetic truncation is the wrong strategy — frequency-based or recency-based truncation would be more useful. "… 21 more labels" gives no indication of what's hidden.

**CLI label filtering**: `--label` works correctly and is not truncated, so CLI users have full access. The gap is Web UI only.

## Filter composition — PASS

`?q=fix&label=experiment-4` returns 3 tasks (QX-006, QX-007, QX-011), all of which are tagged `experiment-4` and have "fix" in title or body. Filter composition is correct. Back-links on task detail pages preserve the combined filter context (`/task/QX-006?from=%2F%3Flabel%3Dexperiment-4%26q%3Dfix`), which is a good UX touch.

Multi-label AND-filter (`?label=A&label=B`) is supported and tested in previous iterations (CB-013 fix). No regressions observed.

## MCP gap note — CONCERNS

CB-014 (MCP `task_list` lacks `search` parameter) remains open and confirmed. The `task_list` MCP tool accepts `status`, `label`, `prefix` but not `search`. An AI agent using the MCP interface cannot replicate the body search that CLI and Web UI offer. This is a parity gap that becomes more significant now that body search is a real, working feature.

MCP tool was not directly exercised in this session (would require a live MCP client session), but the schema gap is confirmed from source inspection: `/home/yale/work/quay/packages/quay/src/mcp-server.js` line 161–163 shows `status`, `label`, `prefix` only; no `search` field.

---

## New gaps found

### [blocking] Body search false positives from template boilerplate
Searching any term that appears in the standard task-body template (e.g., "Proposal", "Done when", "AC", "Context") matches nearly all tasks. This makes full-text search unreliable for common words. A user who types "Proposal" expecting to find tasks about proposals gets 117/118 results. Mitigation options: scope body search to exclude heading-level boilerplate; add title-only search mode; document the limitation prominently.

### [significant] Label nav truncation hides highest-frequency labels
`v1` (33 tasks) and `usability_quality` (19 tasks) are both truncated from the Web UI label nav due to alphabetic ordering. These are the most task-dense labels in the workspace. A power user managing a v1 milestone cannot one-click filter by it. Mitigation: sort nav labels by frequency descending, or allow active/recently-used labels to float to the top.

### [significant] Help text and UI placeholder contradict body search behavior
`--help` says "title substring"; example says "in title"; Web UI placeholder says "Search titles…" — but search actually covers title+body. Users who are surprised by unexpected body matches (or who expect title-only scoping to reduce false positives) get no documentation support. Help text and placeholder should be updated to "title or body".

### [minor] MCP search parity gap (CB-014 still open)
`task_list` MCP tool has no `search` parameter. Confirmed not addressed this iteration.

---

## Overall: FAIL

Body search quality is a blocking concern: searching any boilerplate template term (e.g., "Proposal") matches 117/118 tasks, rendering search useless for those terms. Label nav hides the two highest-frequency labels (`v1`, `usability_quality`) due to alphabetic truncation ordering. Help text does not reflect the new body search capability. These issues together would cause a power user migrating from GitHub Issues to question search reliability as a core workflow tool.
