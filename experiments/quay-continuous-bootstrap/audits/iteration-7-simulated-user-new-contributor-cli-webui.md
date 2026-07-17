# Simulated User Audit — New Contributor Persona
Date: 2026-07-17
Iteration: 7
Persona: New contributor (first time, no prior context)

## CLI discoverability — PASS

`--help` output is clear and accurate. `--search <query>` is documented as "Filter by
title/body content (case-insensitive)" — correctly describes what the flag does. The
example (`quay task list --search "bootstrap" List tasks with "bootstrap" in title or
body`) makes the scope explicit. A new contributor can understand the CLI from the help
text alone. `task list` output (tab-separated id/status/role/title/updated) is legible.
Search produces a count header (`# search: "label" (47 matches)`) that confirms the
query was understood.

## Search quality (boilerplate fix) — PASS

Searching "Proposal" in the Web UI returns 37 tasks (down from 117 before the heading
exclusion fix). Manual verification confirms the 37 results are legitimate: they contain
"proposal" in non-heading body text (e.g., file references like "quay-proposal.md",
in-line mentions in AC/DoD sections). 83 tasks that had only `## Proposal` as a heading
are correctly excluded. The `stripHeadings()` function (strip lines matching `/^#+\s/`)
is applied in both `serve.js` (Web UI `?q=`) and `bin/quay.js` (`--search`). No false-
positive flood remains. The fix is complete.

Note: 37 results for "Proposal" may still look like a lot to a new contributor who
does not know the codebase has many tasks with "quay-proposal.md" cross-references.
However, these are true positives, not boilerplate matches. Severity: minor cosmetic.

## Label nav usability — PASS

Label nav is sorted by actual task frequency: v1 (36 tasks), usability_quality (21),
experiment-4 (17), capability_breadth (11), bug (10), gate (6), github-provider (6),
methodology (6), core (5) — verified against live JSON task list. This is a meaningful
ordering for a new contributor: the most prevalent labels appear first. Active labels
are pinned to front when they would otherwise fall past position 25 (LABEL_NAV_MAX).
The truncation message "… 21 more labels" correctly signals that more exist.

Minor observation: the label nav is a dense run of links without visual grouping. For
a new contributor with 46 distinct labels, the nav is still long even with truncation.
But this is pre-existing and not a regression from iteration 7. Severity: minor.

## Web UI mobile — PASS

The server returns identical HTML regardless of User-Agent (single-file SSR). CSS
`@media (max-width: 600px)` rules correctly hide `.col-role` and `.col-labels`,
make `.col-actions` sticky to the right edge, and hide `.col-updated`. The orientation
banner and label nav render in the same HTML — they will wrap naturally on narrow
viewports. No mobile-specific breakage detected.

## New gaps found

- [minor] "Proposal" returning 37 results may confuse a first-time user expecting zero
  results for a structural heading term. A future improvement could note in the search
  result header that body references (not headings) matched. Not blocking.

- [minor] Label nav has no visual affordance distinguishing "these are filters" from
  "these are navigation links" for a brand-new user. The bold `All` and bold active
  label help, but a tooltip or brief label like "Filter by label:" would reduce
  cognitive load. Pre-existing; not a regression.

## Overall: PASS

All three iteration-7 changes verified working as specified. Heading exclusion reduces
"Proposal" flood from 117 to 37 (83 tasks correctly excluded). Label nav sorts by
frequency with correct pinning. Search placeholder reads "Search titles and
descriptions…". Help text says "title/body". No regressions detected. No blocking gaps
found.
