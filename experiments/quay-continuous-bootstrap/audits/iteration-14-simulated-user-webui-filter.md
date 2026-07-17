# Simulated User: Web UI filter user — Iteration 14

## Persona
Web UI task-filter user, manages tasks through browser interface.

## Source verification approach
Source code reading only. The live server at `http://localhost:4173/` likely runs from the main packages, not the worktree. All verification is done by reading:
- `/home/yale/work/quay/experiments/quay-continuous-bootstrap/worktrees/iteration-14/packages/quay/src/serve.js`
- `/home/yale/work/quay/experiments/quay-continuous-bootstrap/worktrees/iteration-14/packages/quay/test/serve.test.mjs`

## Findings

### QX-051: Grammar fix (singular "result")

PASS — The ternary is present and correct at line 717 of serve.js:

```js
const searchResultBanner = qFilter
  ? html`<p class="meta" style="color:#0066cc">Showing ${totalTasks} ${totalTasks === 1 ? "result" : "results"} for &ldquo;${escapeHtml(qFilter)}&rdquo;${totalPages > 1 ? ` · Page ${safePage} of ${totalPages}` : ""}</p>`
  : "";
```

The comment immediately above this block (lines 714–715) explicitly references the fix:
```
// QX-051 (experiment 4, iteration 14): UQ-037 — "Showing 1 results" is
// grammatically incorrect. Use singular "result" when totalTasks === 1.
```

The fix correctly uses `totalTasks === 1 ? "result" : "results"` and handles both the singular and plural cases.

### QX-052: Filter-zero "No tasks found." message

PASS — The fallback row is present at line 737 of serve.js (the table body rendering):

```js
${rows || (pageTasks.length === 0 && !qFilter ? html`<tr><td colspan="7" style="text-align:center;color:#666;padding:1rem">No tasks found.</td></tr>` : "")}
```

The condition is `pageTasks.length === 0 && !qFilter`. This correctly:
- Shows "No tasks found." when a filter (status/label/prefix) yields zero results and there is no active `?q=` search
- Does NOT show it when `qFilter` is set — in that case the `searchResultBanner` already shows "Showing 0 results for …", avoiding a double message

The comment block at lines 739–743 confirms the intent:
```
<!-- QX-052 (experiment 4, iteration 14): UQ-038 — when filter (not search)
     yields zero results the table body was empty with no message. The
     searchResultBanner covers the ?q= case ("Showing 0 results for X");
     this fallback covers filter-only zero-results. Only shown when !qFilter
     so it does not conflict with the searchResultBanner message. -->
```

### Test coverage for QX-051 and QX-052

**QX-051 tests (lines 1485–1543 of serve.test.mjs):** Adequate and correct.
- Creates 3 tasks: one with a unique singular-match term, two sharing a plural-match term
- Tests that `?q=unique-qx51-singular-match` produces `"Showing 1 result for"` (positive assertion)
- Tests that it does NOT produce `"Showing 1 results for"` (negative assertion — explicitly catches the regression)
- Tests that `?q=plural-qx51-match` produces `"Showing 2 results for"`

One minor note: the existing QX-046 block (line 1466) has a slightly weaker check `singleBannerText.includes("Showing 1 results") || singleBannerText.includes("Showing 1 result")` — this OR condition was written before QX-051 was implemented and would have accepted the grammatically incorrect form. The new QX-051 dedicated block is more precise and correctly rejects the plural form when count is 1.

**QX-052 tests (lines 1545–1603 of serve.test.mjs):** Adequate and correct.
- Creates 2 tasks with `status=todo`; filters to `?status=needs-human` to produce zero filter results
- Asserts `"No tasks found"` appears in the response body
- Also checks the `?q=` zero-result case: asserts `"Showing 0 results for"` appears and `"No tasks found"` does NOT (verifying the no-double-message invariant)

The assertions are correctly aligned with the source code behavior.

## New gaps found

One minor gap observed during test review:

**Residual weak assertion in QX-046 block (line 1466):** The test uses `singleBannerText.includes("Showing 1 results") || singleBannerText.includes("Showing 1 result")` — the OR still allows the pre-QX-051 incorrect plural form to pass in that block. Now that QX-051 is fixed, the QX-046 block's banner assertion could be tightened to `"Showing 1 result"` only (singular, no "s"). This is low severity since the dedicated QX-051 block covers the correct assertion; it's only a latent weakness in the QX-046 block's negative check coverage.

No structural or functional gaps in the filter-zero or grammar-fix surfaces were found.

## Overall verdict

PASS — Both QX-051 and QX-052 are correctly implemented in source with appropriate test coverage; no regressions detected.
