# Simulated User Audit — Comparison Reviewer Persona
Date: 2026-07-17
Iteration: 5
Persona: Comparison reviewer (GitHub Issues / Linear user)

## Search capability — CONCERNS

Iteration 5 added title search to both CLI (`--search <query>`) and Web UI (`?q=<query>`). Here's what works and what's still short:

**What works:**
- Case-insensitive substring matching confirmed (searching "BOOTSTRAP" returns same results as "bootstrap").
- Multi-word substring search works ("mobile table" correctly finds the single matching task).
- URL parameter `?q=<query>` is bookmarkable and shareable — correct REST-style approach.
- Search form appears inline on the list page below the filter nav — reasonably discoverable.
- Search composes with label filters: form correctly emits hidden fields for `label`, `prefix`, `status`, and `sort` when those are active, so submitting the form doesn't lose your current filter context.
- Search + pagination composes correctly: `?q=QX&page=2` works (returns page 1 of 1 with 1 task — pagination is applied after filtering, not before).
- CLI output header correctly shows `# search: "QX" (1 matches)`.

**Gaps vs. GitHub Issues / Linear:**
- **Title-only search** — GitHub Issues searches title + body + comments; Linear searches title, description, and comments. For any project where task descriptions contain the real content (not just titles), this is a meaningful gap. Severity: **significant** for projects where body content matters.
- **No search result highlighting** — matched terms are not highlighted in results. Minor UX gap.
- **No search operators** — GitHub Issues supports `is:open`, `label:bug`, `assignee:@me` inline in the search box as a unified query language. Quay requires separate filter controls. Not a blocker but reduces power-user efficiency.
- **No full-text body search** — task description/body is not indexed.

## Filter/label UX — PASS

**What works well:**
- Multi-label AND-filter via repeated `?label=A&label=B` params works correctly. Tested `?label=experiment-4&label=iteration-5` — returned 3 tasks, all having both labels.
- Label toggle semantics are correct: active labels render as `<strong>label-name</strong> (remove)` with a remove link that drops just that label from the active set. Inactive labels render as regular links that add them. This is correct toggle behavior.
- Remove links are accurate: with `?label=experiment-4&label=iteration-5` active, clicking "remove" on `experiment-4` navigates to `/?label=iteration-5` — correctly retaining the other active label.
- All other active filters (prefix, status, sort) are preserved in both nav links and the search form's hidden fields.
- Label "All" link correctly strips labels while preserving other filters.

**Remaining concerns:**
- **No OR-label filter** — only AND is supported. GitHub Issues and Linear both support OR semantics for labels (`label:bug OR label:enhancement`). This is minor for small projects but notable at scale.
- **Label nav is a flat unsorted wall of text** when 40+ labels exist — no grouping, no search-within-labels. GitHub Issues renders a dropdown with search. At this label count it's already hard to scan.
- **No active-filters summary bar** — there's no consolidated "active filters: prefix=QX, status=done, label=experiment-4 [clear all]" bar. GitHub Issues shows chips; Linear shows a filter bar. Current UX requires knowing where each filter control lives to clear it.

## CLI ergonomics — PASS

**What works:**
- `--search <query>` flag is intuitive and documented in `--help`.
- `--help` output is clean with examples including `--search`.
- Timestamp column present in list output (`2h ago` format).
- Relative timestamps are readable; the format matches what Linear and `gh` use.
- `--search` composes with `--label`, `--prefix`, `--status`, `--sort` — tested search + status combination works.

**Gaps vs. `gh` CLI:**
- `gh issue list --search` accepts GitHub's full search syntax (assignee, milestone, date ranges, etc.). Quay `--search` is substring-only with no operator support.
- No `--json` fields selector (equivalent of `--jq` in `gh`). `--json` outputs everything.
- No `gh`-style `--limit` / `--assignee` / `--milestone` equivalents — quay is intentionally narrower in domain (no assignees), but the absence of date-range filtering (`--updated-since`, `--created-before`) is notable.
- Relative timestamp format ("2h ago") is human-readable but not machine-sortable from plain-text output. `gh` outputs ISO timestamps. Minor for scripting.

## Overall maturity assessment — CONCERNS

For its intended domain (AI-assisted task management, small projects, no multi-user assignment), quay is reaching a usable baseline. The iteration-5 additions meaningfully close the gap in the area where the product was most obviously lacking.

**What's in place that works:**
- Filtering by prefix, status, label (multi), sort, and now search — all composable.
- Bookmarkable, shareable URLs for all filter combinations.
- Label toggle semantics correct (was broken before iteration 5).
- CLI and Web UI at feature parity for filtering.
- Mobile layout with responsive table.

**What's still missing for real-world use (compared to GitHub Issues):**
1. **Body/description search** — title-only is limiting for projects where context lives in task bodies.
2. **Saved filters / views** — no way to bookmark a named view the way GitHub's "saved searches" or Linear's "custom views" work.
3. **Task creation from the Web UI** — read-only Web UI means you must use CLI or MCP to create tasks. GitHub Issues and Linear are fully writable from the browser.
4. **No assignee / owner concept** — intentional for solo use, but blocks team use.
5. **No due dates / milestones** — not present; Linear's cycle/milestone concept is absent.
6. **No notification or watch mechanism** — no email, webhook, or feed.
7. **Label management UI** — no way to create, rename, or delete labels from UI or CLI; labels emerge from task metadata only.
8. **No bulk operations** — can't multi-select and change status, add label, etc.

The product is coherent and self-consistent for its niche. A small solo project with AI-assisted task creation would find it adequate. Team use, projects with >100 tasks, or workflows requiring body-search or saved views would hit blockers.

## New gaps found

| Gap | Severity |
|-----|----------|
| No body/description search — only title substring | significant |
| Label nav becomes unusable at 40+ labels (flat wall, no grouping/search) | significant |
| No active-filters summary / chip bar to see and clear all active filters at once | significant |
| Sort param is preserved in search form hidden fields but is NOT preserved in label nav add-links (label clicks lose sort context when adding a new label) | minor |
| Search form "clear" link (`<a href="/">clear</a>`) resets ALL filters, not just the query — equivalent to "reset everything" not "clear search" | minor |
| Relative timestamp ("6m ago") is not refreshed in a long-lived browser tab without a page reload | minor |

**Clarification on the "clear" link behavior:** When searching `?q=QX`, the clear link href is `/` (root), which drops prefix, status, label, sort, AND the query. This is surprising — a user expects "clear" to remove the search query while preserving other filters. GitHub Issues' search box clear button removes only the query. Severity: minor/significant depending on workflow.

**Clarification on sort loss in label nav:** When sort=updated is active and you click a label in the nav to add it, the generated href is `/?label=experiment-4&label=iteration-5&sort=updated` — actually, confirmed sort IS preserved in label add-links. The gap above about sort is withdrawn — sort is correctly threaded through all nav links.

**Revised new gaps (confirmed):**

| Gap | Severity |
|-----|----------|
| No body/description search — title-only | significant |
| Label nav flat wall at 40+ labels — no grouping or searchable dropdown | significant |
| No active-filter chip bar — can't see all active filters at a glance | significant |
| "Clear" search link resets ALL filters, not just the query | minor |
| Relative timestamps not auto-refreshed without page reload | minor |

## Overall: CONCERNS

Iteration 5 delivers the headline search and toggle features correctly. The core search contract (case-insensitive substring, URL-composable, filter-preserving) is solid. However, from a comparison-reviewer standpoint, two concerns remain blocking for broader adoption: body search is absent, and the label nav degrades badly at realistic label counts (40 labels is already painful). These are significant gaps relative to GitHub Issues or Linear, not minor polish. The product is appropriate for its stated niche (small, AI-driven, solo projects) but would require at minimum body search to be a credible general-purpose tracker.
