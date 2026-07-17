# Simulated-User Report — Iteration 13
# Persona: Web UI Daily User (pagination/search focus)

_Date: 2026-07-17_
_Iteration: 13 (experiment 4)_
_Surface: Web UI — pagination and search UX_
_Live server: http://localhost:4173/ (main-tree, pre-QX-049 merge — 200 OK)_
_Worktree verified: `experiments/quay-continuous-bootstrap/worktrees/iteration-13`_

---

**Overall verdict**: PASS (with two new minor gaps found)

---

## QX-049 verification (pageNav single-page fix)

### Source code review

**File**: `worktrees/iteration-13/packages/quay/src/serve.js`, lines 664–678

The fix is exactly right. The ternary at line 664:

```js
const pageNav = totalPages > 1 ? html`...Page ${safePage} of ${totalPages}...` : "";
```

The old else-branch (`html\`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>\``) is gone; the new else is the empty string `""`. The comment at lines 674–678 correctly identifies the symmetry with `searchResultBanner`'s own `totalPages > 1` guard (QX-046).

Both uses of `pageNav` in the HTML template are now consistent:
- Line 732: `${pageNav}` (above table) — empty when single-page, content when multi-page
- Line 737: `${totalPages > 1 ? pageNav : ""}` (below table) — also correctly gated

The below-table guard was redundant after the fix (since `pageNav` itself is now `""` when `totalPages <= 1`) but causes no harm. It is slightly defensive / belt-and-suspenders, which is fine.

**Edge case covered**: `Math.max(1, Math.ceil(0 / PAGE_SIZE))` = 1, so zero-result searches also get `pageNav = ""`. Confirmed: the old live server rendered `"Page 1 of 1 (0 tasks)"` for a no-results search — which is both confusing and factually misleading.

### Test assertions

**File**: `worktrees/iteration-13/packages/quay/test/serve.test.mjs`, QX-049 block (lines 1485–1560)

The test creates a fresh 25-task workspace, starts a dedicated server on port `port + 15`, then runs:

- **(a) Single-page check**: `GET /?q=qx49-unique-singleton` — a query that matches exactly one task (26th task added after the 25). Assertion: `!body.includes("Page 1 of 1")`. This is correct and sufficient — if the fix regresses, the old else-branch would re-emit the string and this assertion would fire.

- **(b) Multi-page check**: `GET /?q=qx49+task&page=1` — the 25 "qx49 task N" tasks match, PAGE_SIZE=20, so totalPages=2. Assertions: body includes `"Page 1 of 2"` AND body includes `"Next"`. Both are necessary to confirm page nav is preserved for multi-page results (the fix should not suppress legitimate pagination).

**Assessment**: Assertions are complete and well-targeted. The existing QX-046 block's updated comment at line 1460–1462 correctly notes that `pageNav no longer renders "Page 1 of 1 (N tasks)"` as expected behavior, removing a potentially misleading assertion comment.

**One observation**: test (a) asserts absence of `"Page 1 of 1"` but does not assert that the single-result `searchResultBanner` still appears. That is already covered by the QX-046 single-page test, so there is no coverage gap here — just a note that QX-049's test is tightly scoped to the pageNav element only.

### Live server confirmation (pre-fix behavior on main-tree)

The live server is running the main-tree version (pre-QX-049). Querying a single-result search confirms the bug that QX-049 fixes:

```
GET /?q=iteration-13
→ "Showing 1 results for "iteration-13""   ← searchResultBanner (QX-046, correct)
→ "Page 1 of 1 (1 tasks)"                  ← pageNav redundant element (BUG, fixed by QX-049)
```

And for a zero-result search:

```
GET /?q=zzz-not-found-xyz
→ "Showing 0 results for "zzz-not-found-xyz""   ← searchResultBanner
→ "Page 1 of 1 (0 tasks)"                       ← pageNav with "0 tasks" (BUG, fixed by QX-049)
```

The "0 tasks" variant is particularly confusing — a user reads "Page 1 of 1" which implies at least one page of content, yet the table is empty.

**QX-049 verdict: CORRECT and COMPLETE.** The logic fix is sound, the edge cases (0 tasks, single task, exactly 1 page) are handled correctly, and the tests cover both the regression target (single-page suppression) and the preservation target (multi-page navigation still appears).

---

## QX-046 verification (search result banner page indicator)

As confirmed above, the combined behavior after QX-046 + QX-049 is:

| Scenario | searchResultBanner | pageNav |
|---|---|---|
| No search active | (hidden) | shows when totalPages > 1 |
| Search, 1 page | "Showing N results for X" | (hidden — QX-049 fix) |
| Search, N pages, page 1 | "Showing N results for X · Page 1 of N" | "«Prev Page 1 of N Next»" |
| Search, N pages, page 2 | "Showing N results for X · Page 2 of N" | "«Prev Page 2 of N Next»" |

This is coherent. The "Page X of Y" context is available in the banner (above the table) when searching, and the navigation widget appears above and below the table for multi-page results.

One mild redundancy remains for multi-page search results: "Page X of Y" appears in both the `searchResultBanner` line and the `pageNav` widget. This is acceptable — the banner is informational context, the nav widget is interactive. A daily user would not find this confusing.

---

## General Web UI scan

### (1) "Sort: Default" nav label — wording is clear

The sort nav shows `Default · id · status · Updated ↓`. The word "Default" for the unsorted state is intuitive. No issue here.

### (2) Label counts correct and scoped

Tested `/?status=todo` — label counts in the nav reflect only the todo-filtered context, not global totals. This is the QX-037 behavior, confirmed working correctly.

### (3) Prefix nav only appears with multiple prefixes

Confirmed: on the root page, `Prefix: All · DIR · PC · QC · QN · QW · QX · SU · TEST` appears. Single-experiment workspaces would not see this. Correct behavior.

### (4) Action button tooltip text

Spot-checked via HTML: action buttons include `title="Advance to ready"` or `title="Advance to done"` based on task status. The tooltip correctly tracks per-task status (QX-019 behavior) — still working.

### (5) Expand-overflow label nav

The `… 37 more labels` `<details>` expand element is working correctly — hides overflow labels with an expandable summary.

### (6) Empty table state when search/filter matches no tasks

When a search or filter yields zero tasks, the table body is empty (only the header row renders). There is no "No tasks found" message within the table or below it. The `searchResultBanner` says "Showing 0 results for X" — which is technically sufficient but slightly jarring: the next thing a user sees is an empty table with no in-context explanation. This is a **new gap** (see below).

### (7) "Showing N results" — singular/plural grammar

When exactly one result is returned, the banner reads `"Showing 1 results for …"` — grammatically incorrect (should be "Showing 1 result"). This is a **new minor gap** (see below).

### (8) Page count "Page 1 of 8 (147 tasks)" — total task count in nav

On the root (unfiltered, multi-page) view, the pageNav shows `Page 1 of 8 (147 tasks)` which is helpful — the total count anchors the pagination. This is correct behavior already existing.

---

## New gaps found

| ID (provisional) | Dimension | Description | Severity | Source |
|---|---|---|---|---|
| UQ-037 | usability_quality | `searchResultBanner` uses fixed plural "results" regardless of count — "Showing 1 results for X" is grammatically incorrect. Should read "Showing 1 result" (singular) when `totalTasks === 1`. Affects both 0-result and 1-result search states (though "0 results" is idiomatic English and less jarring than "1 results"). | minor | simulated-user (Web UI daily user, iteration 13) |
| UQ-038 | usability_quality | Web UI table shows no in-table "no tasks found" message when filter or search yields zero results. The table renders header only, with an empty body. The `searchResultBanner` covers the search case ("Showing 0 results for X"), but filtered views with zero results (e.g., `?status=needs-human` returning 0 tasks) show an empty table with no explanation. A daily user could mistake an empty table for a rendering error. | minor | simulated-user (Web UI daily user, iteration 13) |

---

## Summary

**QX-049 (pageNav single-page suppression)**: VERIFIED CORRECT. The `totalPages > 1` ternary in `serve.js` now returns `""` for single-page results, eliminating the redundant "Page 1 of 1 (N tasks)" element — which on the live (pre-fix) server appeared simultaneously with the QX-046 `searchResultBanner`, creating a confusing double-annotation. The zero-result case ("Page 1 of 1 (0 tasks)") was particularly misleading and is also fixed. Test assertions are complete and cover both the regression target and the multi-page preservation target.

**QX-046 + QX-049 combined UX**: The pagination UX is now clean for all cases. No redundant text on single-page results; multi-page nav is preserved and unaffected by the fix.

**Two new minor gaps identified** (UQ-037, UQ-038) — neither is blocking, neither affects core task management, but both are noticeable to a detail-oriented daily user.

**PAUSE recommendation**: These two new gaps are minor cosmetic issues, not significant functionality gaps. If the ΔV_13 < 0.02 threshold is met (as projected), the new gaps found here do not override the PAUSE signal — they would be addressed in a post-PAUSE iteration if the experiment resumes.
