# Simulated User Audit — New Contributor Persona
Date: 2026-07-17
Iteration: 5
Persona: New contributor (first-time quay user)

## CLI — PASS

**What I tried:**

1. `quay --help` — The output is well-organized. Commands are listed with flags, options are documented, and examples are included at the bottom. As a first-time user I can understand the basic workflow (list → view → edit) without needing external docs. The usage block is scannable.

2. `quay task list` — Output is a clean TSV-like table with columns: id, status, role, title, and **timestamp** ("3h ago", "14h ago"). The relative timestamp column is immediately understandable and useful — it tells me which tasks were recently active without needing to parse a full date.

3. `quay task list --search "experiment-4"` — Returns `# search: "experiment-4" (0 matches)`. This is technically correct since `--search` filters on title text, not labels — "experiment-4" appears in labels but not task titles. However, as a new user I don't know that distinction, and the zero-match result with no hint about trying `--label` instead is confusing. I'd expect a note like "no title matches — try --label experiment-4". The help text does say "title substring" so a careful reader would catch it, but the zero-match UX doesn't guide me.

4. `quay task list --label "experiment-4"` — Works correctly, returns 14 tasks all tagged with the label. The output is clean. Discovering that I should use `--label` instead of `--search` requires re-reading the --help output, which is acceptable but could be smoother.

5. `quay task view QX-006` — Full task detail rendered in Markdown-like plain text: title, status, Proposal, Plan, AC checkboxes, DoD. Very readable. No issues.

**Concerns:**
- `--search` returning 0 for "experiment-4" with no guidance about `--label` is a minor usability gap. A new user who types `--search experiment-4` thinking they'll find experiment tasks will get 0 results and may think the system is empty or broken.

## Web UI Desktop — PASS

**What I tried:**

1. `http://localhost:4173/` — First impression is clean. There is an orientation banner: "Quay — AI-assisted task management. Task statuses: todo → ready → needs-human → done." This is exactly what a new contributor needs. The label nav, prefix filter, status filter, and sort controls are all visible above the table.

2. Search form (`?q=experiment`) — The search input is visible on page load with placeholder "Search titles…" and there is an explicit "Search" submit button. Submitting with `q=experiment` filters to 7 matching tasks and the search term is preserved in the input. The URL `/?q=experiment` is bookmarkable and shareable. Works as expected.

3. Label filtering (`?label=experiment-4`) — Clicking a label link in the nav filters the list to 14 tasks. The active label `experiment-4` is shown in **bold** with a `(remove)` link next to it — this is a clear affordance. Adding a second label (`?label=experiment-4&label=iteration-5`) narrows to 3 tasks, and the label nav updates all links to preserve the existing filters while adding/removing individual labels. Multi-label AND filtering works correctly and is discoverable through the nav links.

4. Task detail link — Clicking a task ID brings up a detail page. The back link from detail preserves filter context (e.g., `from=%2F%3Flabel%3Dexperiment-4`), so the browser back button returns me to the filtered view. Good UX.

5. The label nav is long (40+ labels rendered inline). As a new user, the sheer volume of labels is overwhelming at first glance. However, the active label highlight and "remove" link make the current state clear once you're filtering.

**No blocking concerns.** One minor note: no explicit "Search" button visible in initial HTML scan was corrected — there is indeed a Search button (`<button type="submit">Search</button>`). The form works correctly.

## Web UI Mobile — PASS

**What I tried:**

Fetched `http://localhost:4173/` with an iPhone User-Agent. The response HTML includes:
- `<meta name="viewport" content="width=device-width,initial-scale=1">` — correct mobile viewport tag
- `@media (max-width: 600px)` block that hides `col-role` and `col-labels` columns, shows table with `overflow-x: auto`, reduces padding, and makes the actions column sticky
- `-webkit-overflow-scrolling: touch` for smooth iOS scrolling
- The orientation banner, search form, label nav, and table are all present in the HTML — no JavaScript-required rendering

The mobile adaptation is structural (CSS media query, no JS required), which means the page loads and is functional on mobile without any JavaScript framework. Key columns (id, status, title, updated, actions) remain visible; the less-critical role/labels columns are hidden at ≤600px. This is a reasonable trade-off.

**No concerns for a first visit.** The page is readable, the critical task information is accessible, and the search form works.

## New gaps found

1. **`--search` zero-match gives no label hint** (severity: minor) — When `quay task list --search "experiment-4"` returns 0 matches, there is no suggestion to try `--label experiment-4`. A new user who doesn't carefully re-read the help text won't know why they got zero results. Suggestion: when `--search` returns 0 results, print a note like "Tip: to filter by label, use --label <name>" on stderr.

2. **Label nav overload on first visit** (severity: minor) — The label navigation on the homepage lists 40+ labels in a single dense paragraph. While functional, it is visually overwhelming for a new contributor who doesn't know which labels are relevant. A collapsible or "show top N labels" affordance would help discoverability without removing the full list.

3. **Search form does not cross-link to label filter** (severity: minor) — If I search for "experiment" in the web UI and find tasks, there is no hint that clicking a label name in the results table would add a label filter. The label column text is not clickable — only the label nav links at the top are. A new contributor may miss that labels are filterable from the nav.

## Overall: PASS

The CLI is learnable from `--help` alone, timestamps are clear, label filtering works correctly on both CLI and Web UI. The Web UI desktop experience is polished: orientation banner, search form with explicit submit button, label toggling with active-state indicator and remove link, bookmarkable URLs. Mobile renders correctly via CSS media query with viewport meta tag. The only meaningful friction point is `--search "experiment-4"` returning 0 with no guidance toward `--label`, but this is minor — the help text does document the distinction, and `--label` works correctly once discovered.
