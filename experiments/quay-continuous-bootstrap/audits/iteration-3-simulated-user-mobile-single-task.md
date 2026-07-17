# Simulated-user audit — Mobile single-task user
# Iteration 3

**Persona**: "mobile-single-task" — mobile-only user, 375×812 viewport. One concrete goal per session: find a blocked task, try to advance it, understand the error, then find a task that CAN be advanced. No CLI access.

**Date**: 2026-07-17
**Surfaces tested**:
- Web UI list page at 375px — Advance button visibility (UQ-011/012 fix verification)
- Web UI list page at 375px — gate-fail error banner (UQ-013 fix verification)
- Web UI task detail page — "← back to list" filter preservation (UQ-009 fix verification)

**Method**: Live Playwright browser at 375×812 + `curl` for raw HTML and POST simulation. `getBoundingClientRect()` measurements taken in-browser for exact pixel positions. `node packages/quay/bin/quay.js task check` used to confirm gate state.

---

## Fix verification: UQ-011 / UQ-012 — Advance button visible at 375px without horizontal scrolling

**Verdict: CONCERNS** — severity: **significant**

The CSS fix (QX-012) correctly hides the `col-role` and `col-labels` columns via `@media (max-width: 600px) { .col-role, .col-labels { display: none; } }`. Both columns are confirmed `display: none` in-browser. This is the correct structural change.

**However, the button is still off-screen on the unfiltered `/` page.**

In-browser `getBoundingClientRect()` measurements at 375px viewport:

| Column | Left | Right | Width |
|--------|------|-------|-------|
| id | 12px | 84px | 72px |
| status | 84px | 151px | 67px |
| role | hidden | — | 0 |
| title | 151px | 325px | 174px |
| labels | hidden | — | 0 |
| actions | 325px | 436px | 111px |

The actions column header extends to **436px** — 61px past the 375px viewport edge. The PC-PARENT row's Advance button sits at left=334px, right=422px (button is 88px wide) — its **right edge overflows by 47px**. `isWithinViewport: false`.

The table has `overflow-x: auto` so horizontal scrolling is available, but the button is not immediately visible. A mobile user must scroll the table right to see and tap Advance.

**Root cause**: Despite hiding the role/labels columns, the remaining three visible columns (id ~72px, status ~67px, title ~174px) plus actions (~111px) sum to ~424px — still wider than the 375px viewport (minus 24px padding = 351px usable). The title column is naturally wide (long task names) and is not width-constrained.

**Partial fix acknowledged**: The QX-prefix filtered list shows only short-titled QX tasks. For QX-001 row, the Advance button measured `left=274px, right=362px, isWithinViewport: true` — within the 375px viewport. The fix works for narrower contexts where title text is short enough.

**Conclusion**: UQ-011/012 is **partially fixed** — the structural improvement (hiding role/labels) is in place and works in filtered/shorter-title contexts. On the unfiltered page or with long task IDs (e.g. PC-PARENT), the Advance button can still overflow. The fix is incomplete for worst-case layout, where title takes its natural width.

---

## Fix verification: UQ-013 — Error banner when Advance is gate-blocked

**Verdict: PASS**

Test procedure:
1. `POST /task/QX-001/action/advance?from=%2F%3Fprefix%3DQX` — gate check result: `{"gate":"author->ready","ok":false,"acTotal":4,"acChecked":0,"reason":"0/4 AC checkboxes checked"}`
2. Server responds HTTP 302 to: `/?prefix=QX&error=Gate+check+failed%3A+0%2F4+AC+checkboxes+checked`
3. Redirect target renders: `<div class="error-banner" role="alert"><strong>Error:</strong> Gate check failed: 0/4 AC checkboxes checked</div>`

In-browser verification on the redirected page at 375px:
- Error banner text: "Error: Gate check failed: 0/4 AC checkboxes checked"
- Visible: `true`
- Bounding rect: left=12, right=363, top=236, bottom=301 — fully within viewport
- `role="alert"` attribute present (accessibility)

The error is surfaced clearly, in the viewport, above the filter controls and table. The user can immediately read why their Advance did not work.

**UQ-013 is FIXED and working correctly.**

---

## Fix verification: UQ-009 — "← back to list" returns to filtered view

**Verdict: PASS**

Navigation path tested:
1. User lands on `/?prefix=QX` (filtered list)
2. Clicks `QX-001` link → navigates to `/task/QX-001?from=%2F%3Fprefix%3DQX`
3. Detail page renders `<nav><a href="/?prefix=QX">← back to list</a></nav>`
4. Back link href: `http://localhost:4173/?prefix=QX` — correctly decodes and restores the filtered view

The `from=` query parameter is properly URL-encoded in the task link href and correctly decoded into the back link's `href`. The filtered context (`prefix=QX`) is fully preserved on return. Confirmed via `returnsToFilteredView: true` in in-browser evaluation.

**UQ-009 is FIXED and working correctly.**

---

## Surface: Task detail page at 375px — general usability

**Verdict: PASS**

The detail page for QX-001:
- "← back to list" link: visible at top, tappable, above fold
- H1: "QX-001: Add cross-experiment task filtering to CLI and Web UI [todo]" — wraps gracefully
- Advance button: `<button type="submit" title="Advance to ready">Advance</button>` — block-level, full width, easily tappable
- Orientation banner: present and within viewport
- No horizontal overflow observed on detail page

---

## Surface: Finding a task that CAN be advanced

**Verdict: N/A (observation)**

In the current task corpus, no task exists with all AC conditions satisfied and status not yet `done`:
- `QX-001` (todo): 0/4 AC checked → gate blocks
- `QN-021` (todo): 1/2 AC checked → gate blocks (AC item 1 structurally unsatisfiable per task design)
- `QN-017`, `QN-020` (needs-human): soft-stop gates → gate blocks

The mobile-single-task persona has no path to a successful Advance in the current corpus. This is a **task data reality**, not a UI bug. The error banners (UQ-013 fix) correctly explain each failure.

---

## Summary table

| Surface / Issue | Verdict | Severity | Notes |
|---|---|---|---|
| UQ-011/012: Advance button visible at 375px | CONCERNS | significant | Partially fixed — works on short-ID/title filtered pages, still overflows on unfiltered or long-title pages. actions column right edge at 436px vs 375px viewport. |
| UQ-013: Error banner on gate-fail | PASS | — | Banner present, in-viewport, accessible (role=alert), message clear |
| UQ-009: Back link preserves filter | PASS | — | from= param correctly decoded; returns to /?prefix=QX |
| Detail page mobile layout | PASS | — | Single-column, no overflow, Advance button tappable |
| Orientation banner presence | PASS | — | Visible in viewport above all content |

---

## Regression notes vs iteration 2

| Finding (iteration 2) | Status in iteration 3 |
|---|---|
| Advance button hidden off-screen (UQ-011) | Partially improved: col-role/col-labels hidden. Button in-viewport for QX-prefix context; still overflows on unfiltered `/` page (long tasks, wide ids) |
| role/labels columns not hidden at mobile (UQ-012) | Fixed: `display: none` confirmed at 375px |
| Gate-fail feedback silent (UQ-013) | Fixed: error-banner rendered, in-viewport, role=alert |
| Back link loses filter context (UQ-009) | Fixed: from= param preserved, returns to /?prefix=QX |

---

## Blocking assessment

**No blocking failures.** The user can navigate the task list, filter to a prefix, see a gate-fail error when Advance is blocked (UQ-013 fixed), and return to their filtered view from task detail (UQ-009 fixed).

**One significant remaining concern**:

**UQ-011 (Advance button off-screen)** is partially mitigated but not fully closed. The CSS fix works when task titles and IDs are short — the QX-prefix view demonstrates this. On the unfiltered list page, or any page where long IDs (e.g. PC-PARENT) or many tasks produce natural table width exceeding ~424px, the Advance button overflows the visible area. The table is scrollable (overflow-x: auto) so the button is reachable, but it is not discoverable on first render. A stronger fix would constrain the title column's `max-width` on mobile (e.g. `max-width: 120px; overflow: hidden; text-overflow: ellipsis`) or make the actions column sticky (`position: sticky; right: 0`).

**Recommended follow-up**: Open a new task to either (a) apply `position: sticky; right: 0` to the actions `<th>` and `<td>` cells, or (b) apply `max-width + text-overflow: ellipsis` to the title column at `≤600px`. Either closes the remaining Advance visibility gap on long-content pages.
