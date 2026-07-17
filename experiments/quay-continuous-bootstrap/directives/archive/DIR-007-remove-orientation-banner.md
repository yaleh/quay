# DIR-007

- status: **APPLIED** (iteration 10, 2026-07-17)
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-17
- applied_at: iteration 10, 2026-07-17
- title: Remove the task-list page's orientation banner

## Finding

`packages/quay/src/serve.js:676` renders a persistent orientation banner
above the task-list table (`.orientation-banner`, styled at
`serve.js:156-164`, added under QX-015/QW-003, most recently touched for
QX-034):

```html
<div class="orientation-banner"><strong>Quay</strong> — AI-assisted task
management. Task statuses: <code>todo</code> → <code>ready</code> →
<code>needs-human</code> → <code>done</code>. Use the Prefix filter to
focus on one experiment's tasks.</div>
```

Two independent problems were identified in conversation before this
directive was drafted:

1. **Content is misleading.** The banner depicts `needs-human` as a
   required, sequential step in the status flow
   (`todo → ready → needs-human → done`). It is not — per the status
   filter definition at `serve.js:495` (`["todo", "ready", "done",
   "needs-human"]`) and the `task_write`/`task_list` status parameter
   documentation in `mcp-server.js:204` and `mcp-server.js:302`,
   `needs-human` is a side-branch/blocked state a task can enter from any
   stage, not a mandatory link in a linear chain. Presenting it with a
   sequential arrow (`→`) misrepresents the actual state model to new
   users.
2. **Layout cost is disproportionate to its value.** The banner is a
   permanent, always-visible block (`padding: 0.6rem 1rem`,
   `margin-bottom: 1rem`) sitting above the `<h1>` and the filter/search
   controls. On narrow viewports (mobile) it consumes a meaningful
   fraction of first-screen height for information that is largely
   redundant with what the filter navigation row already exposes
   (`serve.js:680-683` already renders Prefix/Filter/Sort/Label rows
   listing the same statuses as clickable links).

## Requested action

Remove the orientation banner entirely from the task-list page template
(`serve.js:676` and its supporting `.orientation-banner` CSS block at
`serve.js:156-164`), rather than editing its wording in place. Do not
replace it with an equivalent-sized block elsewhere by default — if the
handling iteration judges that some of the lost context (the status
vocabulary explanation, or the Prefix-filter hint) is worth preserving,
it must be integrated into existing UI elements with no added dedicated
vertical space (e.g., a `title` attribute/tooltip on the existing status
filter links at `serve.js:680-683`, not a new banner-shaped element).
Any such addition must correctly represent `needs-human` as a
branch/blocked state, not a sequential step in a `→` chain. Update
`serve.test.mjs` assertions that currently check for the banner's
presence/text accordingly.

## Resolution

**APPLIED in iteration 10 (2026-07-17).** Source: `iterations/iteration-10.md` §3
("DIR-007 — Orientation banner removal") and §4 (dev-phase gap/directive log).

- Removed `<div class="orientation-banner">...</div>` from the list-page
  template in `packages/quay/src/serve.js`.
- The `.orientation-banner {}` CSS rule was retained as an empty block with an
  explanatory comment (not deleted outright) — see `serve.js:717` region,
  which now carries a comment referencing this directive and the two findings
  above (misleading `needs-human` sequencing; disproportionate mobile layout
  cost).
- No replacement banner-shaped element was added, per the requested action's
  "no added dedicated vertical space" constraint. The existing status filter
  navigation (`serve.js:518-520`) was left as the sole status-vocabulary
  affordance.
- `serve.test.mjs` updated: two assertion blocks now check the banner text is
  ABSENT (iteration 10, port+11 test block region).
- Full test suite: 30/30 pass, no regressions (iteration 10 dev-phase run).
- Directive counted in iteration 10's V_instance provisional scoring as a
  `usability_quality` cosmetic improvement (0.875).
</content>
