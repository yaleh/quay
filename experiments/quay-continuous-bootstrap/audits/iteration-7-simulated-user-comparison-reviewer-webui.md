# Simulated User Audit — Comparison Reviewer Persona
Date: 2026-07-17
Iteration: 7
Persona: Comparison reviewer (GitHub Issues / Linear)

## Search quality (boilerplate fix) — CONCERNS

**What changed:** Body search now strips markdown heading lines before indexing, targeting the "Proposal" boilerplate flood.

**Result:** `?q=Proposal` returns **37 tasks** (down from 117/118 in iteration 6 — a 68% reduction). This is a meaningful improvement.

**Quality of remaining 37 results:** All sampled results (QC-003, QN-002, QN-003, QN-026, QN-040) have "proposal" appearing in actual prose content — either as references to "quay-proposal.md", inline citations to "proposal §X", or substantive discussion of design proposals. The heading-stripping achieved its goal: the remaining matches are genuine content hits, not structural boilerplate.

**Remaining concern:** 37/121 = ~31% of all tasks still match "Proposal". While these are legitimate matches (this workspace documents a bootstrapping experiment that discusses its own proposal extensively), a new user searching "Proposal" would still see a large result set. This is a data characteristic, not a filter bug — but it means search quality for this particular corpus is inherently limited by the domain vocabulary. The fix correctly addresses the mechanical boilerplate problem; residual noise is genuine.

**Useful term searches:**
- `?q=toggle` — 2 results (1 page). Signal-to-noise ratio is excellent for narrow terms.
- `?q=label` — 47 results (3 pages). Higher volume but plausible given label infrastructure is a recurring topic across many tasks.

**Help text / placeholder:** `--help` documents `--search <query>` as "Filter by title/body content (case-insensitive)". Web UI placeholder reads "Search titles and descriptions…". Both correctly describe body search. This closes the stale-copy gap flagged in iteration 6.

## Label nav frequency sort — PASS

**Observed order:** v1 (36 tasks) · usability_quality (21) · experiment-4 (17) · capability_breadth (11) · bug (10) · gate (6) · github-provider · methodology · core · deliberately-adversarial · experiment-2 · docs · iteration-5 · provenance · quay-github · skill · abi-symmetry · cli · data.write · epic · abi · author · browser-automation · bugfix · completeness · … 21 more labels

**Frequency sort confirmed:** The ordering is strictly descending by task count. The two previously-hidden high-value labels `v1` and `usability_quality` now appear in positions 1 and 2. A power user managing a v1 milestone can now one-click filter to it directly. This directly resolves the "most task-dense labels buried in alphabetic truncation" issue from iteration 6.

**Comparison to GitHub Issues:** GitHub's label nav is a searchable dropdown; Linear offers a searchable panel with counts. Quay's flat frequency-sorted list is simpler but immediately more usable than the previous alphabetic version. For a project of this size (46 total labels), the frequency sort plus "N more labels" truncation is a reasonable approximation.

## Active label pinning — PASS

**Test 1 — label in top 25:** `?label=usability_quality` renders nav as: `All · <strong>usability_quality</strong> (remove) · v1 · experiment-4 · ...`. Active label is bold, has a correct remove link (strips back to `/`), and sits in position 2 (immediately after "All").

**Test 2 — label in "21 more" (hidden from homepage nav):** `?label=verification` (a low-frequency label not shown on the homepage nav) renders nav as: `All · <strong>verification</strong> (remove) · v1 · usability_quality · ...`. The active label is pinned to position 1 even though it is not in the top 25 by frequency. This is correct behavior — a user who navigated here via a bookmarked URL or direct link can see and remove their active filter.

**Comparison to GitHub Issues:** GitHub Issues shows active label filters as removable chips above the issue list. Quay's inline-bold approach is less visually distinct but functionally equivalent: the active state is visible and removable from the nav.

## Overall maturity vs. GitHub Issues — CONCERNS

**Iteration 7 specifically addressed:**
1. Body search boilerplate flooding — substantially fixed (117 → 37 for "Proposal").
2. Label nav ordering — fixed (frequency sort, high-value labels now accessible).
3. Active label pinning — fixed (works correctly for hidden labels too).
4. Help text accuracy — fixed (both CLI and Web UI now correctly describe body search).

**Remaining gaps vs. GitHub Issues (unchanged from iteration 6 except as noted):**

| Gap | Severity | Status vs iteration 6 |
|-----|----------|----------------------|
| Body search still noisy for domain-vocabulary terms (31% of tasks match "Proposal") | significant | Improved (was blocking at 99%; now a data characteristic, not a filter bug) |
| No search result highlighting — matched terms not visible in result rows | minor | Unchanged |
| No search operators (is:open, label:bug in unified search box) | minor | Unchanged |
| Label nav is still a flat wall of text (no search-within-labels, no grouping) | minor | Improved (frequency sort helps; still no dropdown/search) |
| No active-filters summary bar / chip UI | minor | Unchanged |
| No OR-label filter (only AND) | minor | Unchanged |
| Task creation is read-only from Web UI | significant | Unchanged |
| No assignee, due dates, milestones | minor for solo use | Unchanged |
| MCP `task_list` lacks `search` parameter (CB-014) | significant | Unchanged |
| No bulk operations | minor | Unchanged |

## New gaps found

- **[minor] "21 more labels" link is not a link** — the text "… 21 more labels" in the label nav is plain text, not a clickable element that expands or navigates to a full label list. A user who wants to browse or filter by one of those 21 labels must know the label name in advance and type it manually into the URL. GitHub Issues shows all labels in a dropdown; Linear has a searchable label panel. Low severity for small teams but noticeable for label-heavy workflows.

- **[minor] Label task counts not shown in nav** — the nav shows label names in frequency order but does not display the count (e.g., "v1 (36)"). A reviewer scanning the nav to choose a useful filter cannot see at a glance how many tasks each label contains without clicking each one. GitHub Issues and Linear both show counts inline with labels.

- **[minor] Search result count visible only at bottom of header, not adjacent to search box** — the task count ("121 tasks") appears in the pagination header, which is below the search form and filter nav. After submitting a search, the count is not immediately adjacent to the input, requiring a visual scan to find. GitHub Issues shows "N results" inline with the search box.

## Overall: CONCERNS

Iteration 7 delivered on all three targeted improvements — the "Proposal" boilerplate flood is substantially resolved, label nav is now frequency-sorted with high-value labels accessible, and active label pinning works correctly for both visible and hidden labels. The most severe issues from iteration 6 (blocking body search quality, hidden v1/usability_quality labels) are closed. Remaining gaps are significant but not blocking for the tool's intended use case (solo AI-assisted task management). The comparison with GitHub Issues / Linear shows continued maturity progress; the product is now viable for its niche without the search reliability concerns that dominated iteration 6's assessment.
