# Simulated User Audit — Web UI User Persona
Date: 2026-07-17
Iteration: 9
Persona: Web UI user (browser-primary)

## Label count badges — PASS

All visible label links in the nav include `(N)` count suffixes, e.g. `v1 (36)`,
`experiment-4 (23)`, `bug (10)`. Labels are sorted descending by count — `v1`
highest at 36, followed by `experiment-4` and `usability_quality` tied at 23.
Accuracy check: navigating `/?label=v1` shows "36 tasks" in the pagination line,
confirming the badge count matches the actual filtered result count. Hidden labels
inside the `<details>` block also carry counts (all `(1)` for the long tail).
No regressions observed; counts propagate correctly into composed URLs when `?q=`
or `?prefix=` are active.

## Expandable hidden labels (details/summary) — PASS

A `<details style="display:inline">` element is present when the label list
exceeds 25 entries. On the default (all-prefix) view, 25 labels are rendered
before the `<details>` and 22 are hidden inside it; the summary reads
"… 22 more labels". On the `?prefix=QX` view, 25 labels show before the element
and 25 are hidden inside it, summary reads "… 25 more labels". The hidden labels
inside `<details>` carry correct toggle hrefs that preserve active query params
(`?prefix=QX&label=…`). The `display:inline` style allows the element to sit
inline within the `<p class="meta">` text flow without line-break disruption.

Minor observation: the threshold is exactly 25 visible items — the 26th and
beyond go into `<details>`. This is consistent across views.

## Search result count banner — PASS

When `?q=fix` is active, the page renders:
```
<p class="meta" style="color:#0066cc">Showing 92 results for "fix"</p>
```
The count (92) matches the pagination "Page 1 of 5 (92 tasks)" figure, so the
banner reflects the total filtered set, not the current page. The active query
term is also echoed in the search box value and in the inline tag
`<strong style="color:#0066cc">"fix"</strong>` with a clear link. The banner
disappears when `?q=` is absent (no spurious "Showing 128 results" on the
default view).

## XSS safety of search banner — PASS

Request: `GET /?q=<script>alert(1)</script>`

The rendered output contains:
```
Showing 0 results for "&lt;script&gt;alert(1)&lt;/script&gt;"
```
The `<` and `>` characters are HTML-entity-escaped to `&lt;` / `&gt;`. The raw
`<script>` tag does not appear in the document source. XSS injection is
blocked at the template level.

## Compose: search + label filter — PASS

Request: `GET /?q=QX&label=experiment-4`

- Search banner shows "Showing 7 results for "QX"" (total after both filters).
- Pagination confirms "7 tasks".
- The active label `experiment-4` is rendered as `<strong>experiment-4 (23)</strong>`
  in the label nav (bolded/active state), with a `(remove)` link.
- All other label links in the nav correctly include `&label=experiment-4&q=QX`
  to preserve both active filters when navigating.
- No double-counting or mismatched totals observed.

## Mobile rendering — PASS

Sending a `User-Agent: iPhone iOS 17` header returns identical HTML (server-side
render; no user-agent branching). The responsive CSS is already in place
(`@media (max-width: 600px)`) and was not changed in iteration 9, so mobile
layout inherits the existing `.col-role`/`.col-labels` hide rules and sticky
`.col-actions`. Label count badges render as plain text within `<a>` tags —
no separate component — so they work in all viewports without additional CSS.
The `<details>/<summary>` element is a native HTML control, fully supported by
mobile Safari (iOS 6+) and Chrome for Android; no JS polyfill required. No
mobile-specific regressions detected.

## New gaps found

- **minor**: The `<details>` element uses `display:inline` set directly on the
  element via a `style` attribute rather than a CSS class. In older WebKit
  versions, `display:inline` on `<details>` may not override the UA stylesheet's
  `display:block`, causing a visual line break. Not a functional regression
  (labels are still accessible) but could cause cosmetic misalignment in Safari
  ≤14. Suggest adding a CSS class `.label-details { display:inline }` and testing
  in Safari.

- **minor**: The search banner and active-search tag (`<strong>"fix"</strong>`)
  both use `color:#0066cc` hardcoded inline. If a dark-mode preference is
  eventually added, these inline styles would need to be updated separately.
  Currently no dark mode support, so not blocking.

- **minor**: Label counts in the nav reflect all tasks regardless of the current
  `?status=` or `?prefix=` filter. For example, `/?status=todo` shows
  `v1 (36)` even though only a subset of v1 tasks are `todo`. The badge counts
  are therefore "global" counts, not "current filter" counts. This may mislead
  users who expect the count to reflect the currently filtered view. Low severity
  now but could be confusing as the task list grows.

## Overall: PASS

All three iteration-9 features (label count badges, expandable hidden labels,
search result count banner) are correctly implemented and consistent. XSS safety
is confirmed. No blocking issues found; three minor gaps logged above.
