# Simulated-user audit — Mobile single-task user
# Iteration 2

**Persona**: "mobile-single-task" — mobile-only user, 375×812 viewport. One concrete goal per session: find a specific task, view its details, advance it to the next status. No familiarity with desktop layout; no command-line access.

**Date**: 2026-07-17
**Surfaces tested**:
- Web UI list page at 375px — prefix filter nav
- Web UI list page at 375px — sort-by-updated
- Web UI list page at 375px — table readability and Advance button in list
- Web UI task detail page at 375px — Advance button

**Method**: `curl` fetch of rendered HTML + structural analysis of CSS media queries, column count, and character widths at 375px. POST tested for Advance action. Redirect behavior verified. Gate behavior observed.

---

## Surface 1: Prefix filter nav on mobile

**Verdict: PASS**

The prefix filter is rendered as a `<p class="meta">` line with inline `<a>` links: `All · PC · QC · QN · QW · QX`. At 0.9rem font (≈14.4px) and 345px usable width (375px minus 2×0.75rem padding at mobile breakpoint), the full prefix nav line (`All · PC · QC · QN · QW · QX`, ~33 chars) fits on a single line without overflow. Each token is a tap target; the items are short enough to be individually tappable at typical mobile font sizes.

The status filter (`All · todo · ready · done · needs-human`) is slightly longer (~40 chars) and may wrap to two lines, but remains readable and tappable. The sort filter (`Default · id · status · Updated ↓`, ~36 chars) similarly fits on one or two lines. No clipping or overflow detected — `p.meta` inherits `word-wrap: normal` and inline links wrap naturally.

**Specific finding**: The currently-active filter is shown as `<strong>` text (not a link), which correctly removes the tap target for the already-selected state. This is correct behavior.

---

## Surface 2: Sort-by-updated on mobile

**Verdict: PASS**

`/?prefix=QX&sort=updated` returns tasks with QX-010 first (most recently updated), QX-009 next, descending down to QX-002. The most-recently-updated task is visually first in the table, which is exactly what a mobile user scanning top-to-bottom needs. The sort control is exposed as a link in the sort meta-nav line (`Updated ↓`) and the current state shows `<strong>Updated ↓</strong>` when active. No concerns at mobile width.

**Finding (minor)**: Sort and filter params are properly preserved and threaded through each other. Clicking a prefix link carries the current sort param; clicking a sort link carries the current prefix. This cross-param preservation works correctly, confirming a mobile user who sets `prefix=QX` and then clicks `Updated ↓` will get the expected combined view.

---

## Surface 3: Table readability and Advance button on list page (375px)

**Verdict: CONCERNS** — severity: **significant**

### Table column count at 375px

The task list table has **6 columns**: `id`, `status`, `role`, `title`, `labels`, `actions`. The CSS `@media (max-width: 600px)` rule makes the table `display: block; overflow-x: auto; -webkit-overflow-scrolling: touch;` — so the table scrolls horizontally on mobile rather than collapsing.

At 375px viewport with 1.5rem horizontal padding (≈24px total), the usable content width is ~351px. Six columns with 2×0.6rem padding (≈19px) per cell means column content areas start at roughly 40px each minimum. The columns in practice have very different natural widths:

- `id`: short (6–8 chars, ~50px needed)
- `status`: medium (`needs-human` = 11 chars, ~90px)
- `role`: medium (`primitive` = 9 chars, ~75px)
- `title`: long (up to 71 chars, ~350px at 5px/char compressed)
- `labels`: medium-long (`capability_breadth, usability_quality` = 37 chars, ~200px)
- `actions`: button (`Advance` button, ~80px)

**Finding 1 (significant)**: The table will require **horizontal scrolling** at 375px. The total natural width of all columns exceeds 375px by a substantial margin. The CSS `overflow-x: auto` handles this gracefully at the scroll level, but a mobile user scanning the list will not see the `actions` column (containing the Advance button) without scrolling right. The Advance button is the primary call-to-action for this persona's workflow, and it is **hidden off-screen** on initial render at 375px. The user would need to discover that they must scroll right — with no visual indicator (no scroll shadow, no "swipe" hint) that more content exists.

**Finding 2 (significant)**: The `labels` column is wide and not actionable for this persona's task. A mobile-focused layout would benefit from hiding `role` and `labels` columns at narrow viewports (both are secondary metadata). Their presence forces the title and actions columns further right.

**Finding 3 (minor)**: The `Advance` button in the list page is only rendered for non-`done` tasks. In the QX prefix set, only `QX-001` (status: `todo`) has an Advance button in the list; all 9 other QX tasks are `done` and render an empty `<td>` in the actions column. This is correct behavior, but the sparsely-populated actions column still occupies full column width in the table layout, wasting horizontal space that pushes the button even further right on mobile.

### Advance button in list row — functional behavior

The Advance button's form action includes the `from=` parameter correctly URL-encoded: `?from=%2F%3Fprefix%3DQX%26sort%3Dupdated`. After the POST, the server redirects to `/?prefix=QX&sort=updated` — the filtered list is **preserved**. This is good behavior and the mobile user lands back on the same filtered view after triggering Advance.

However, the gate check (`quay task check QX-001`) returns `FAIL — 0/4 AC checkboxes checked`. The Advance action fires (HTTP 302) but the task cannot actually advance (gate blocks it). The detail page after the redirect shows the task still at `[todo]` status with the Advance button still present — **no error message, no gate-fail explanation** is surfaced to the user. The mobile user taps Advance, returns to the list, sees nothing has changed, and has no indication of why.

---

## Surface 4: Task detail page at 375px

**Verdict: PASS** (with one minor finding)

The detail page for `QX-001` at 375px renders as a single-column flow:
- Back nav: `← back to list` (visible, tappable)
- H1 title: "QX-001: Add cross-experiment task filtering to CLI and Web UI [todo]" (68 chars — wraps to 2–3 lines at 375px but readable)
- Meta line: `role: primitive · labels: capability_breadth, usability_quality` — wraps gracefully
- `<div><form><button>Advance</button></form></div>` — full-width block, tappable, clearly positioned above the body content
- Body content (Proposal, Plan, AC, DoD) — renders in readable block flow; no horizontal overflow; code spans (`quay task list --prefix QX`) remain inline and readable

No table exists on the detail page, so the 6-column overflow issue does not apply here.

**Finding (minor)**: After tapping Advance on the detail page (`POST /task/QX-001/action/advance`), the server returns HTTP 302 to `/task/QX-001`. The page reloads identically — same `[todo]` status, same Advance button. There is **no gate-fail feedback**: no error banner, no "gate check failed: 0/4 AC checked" message. For a mobile user who expected advancement, the silent no-op is confusing. The finding from iteration 1 ("Advance button gives no confirmation feedback") still applies; this audit confirms it applies on mobile too, and with the additional friction that the gate fail reason is invisible.

---

## Summary of findings

| Surface | Verdict | Finding | Severity |
|---------|---------|---------|----------|
| Prefix filter nav (375px) | PASS | Active item shown correctly as `<strong>` | — |
| Sort-by-updated | PASS | Cross-param preservation works correctly | — |
| Table at 375px | CONCERNS | `actions` column (Advance button) hidden off-screen on initial render; requires horizontal scroll to discover | **significant** |
| Table at 375px | CONCERNS | `role` and `labels` columns not hidden at mobile width; force title/actions columns rightward | **significant** |
| Table at 375px | PASS with minor | Actions column always rendered even for done tasks, wastes width | minor |
| List Advance (redirect) | PASS | Filter params preserved in `from=`; redirect returns to correct filtered list | — |
| Advance gate-fail feedback | CONCERNS | No error message shown when gate blocks advance; user sees silent no-op on both list and detail page | **significant** |
| Detail page (375px) | PASS | Single-column flow, readable, Advance button above fold | — |
| Detail page Advance | PASS with minor | Same gate-fail silence as list page; no confirmation or error feedback | minor (same finding) |

---

## Blocking assessment

**No blocking failures** — the mobile user can reach the task list, filter to QX-*, apply sort-by-updated, identify the most recently updated task (QX-010), navigate to its detail, and see the Advance button. The core navigation path works.

**Three significant concerns**:

1. **Advance button off-screen at mobile width** — A mobile user who stays on the list page will not see the Advance button without scrolling right. Discovery depends on the user knowing to scroll horizontally in the table (no scroll shadow or affordance hint).

2. **Table columns not adapted for mobile** — The `role` and `labels` columns occupy substantial horizontal space on a surface where they add little value for the single-task persona. A `@media (max-width: 600px)` rule hiding these columns would bring `id`, `status`, `title`, and `actions` into the visible viewport without horizontal scrolling.

3. **Gate-fail feedback is silent** — When Advance is tapped and the gate blocks it, neither the list page nor the detail page shows any message. The mobile user has no idea why nothing changed. A brief inline error ("Gate check failed: 0/4 AC boxes checked") would close this gap.

---

## Regression vs iteration 1

The iteration 1 audit noted "Task list table at mobile width unverified (minor)" as a pending concern. This audit confirms that the table does require horizontal scrolling and that the Advance button is off-screen on first render — escalating from unverified/minor to confirmed/significant.
