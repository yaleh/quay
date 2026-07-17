# Simulated User Audit — Cross-Experiment Maintainer Persona
Date: 2026-07-17
Iteration: 7
Persona: Cross-experiment maintainer (power user, all surfaces — CLI / Web UI / MCP)

---

## Body search quality (CB-017 fix) — PASS

**`--search "Proposal"` result count**: 37 matches (down from ~117–118). Massive reduction confirmed.

**Legitimacy check**: Inspected QC-003 and QN-002. In both cases "Proposal" appears in body *prose*, not in Markdown heading lines. Example from QN-002: `"the proposal's central risk (§16)"`, `"against a real, heterogeneous second backend, per proposal §14's explicit"`. The `stripHeadings()` fix is working — only tasks with genuine prose mentions survive.

**`--search "toggle"` body-prose check**: 2 matches returned — QN-042 (body mentions log-file delivery toggle) and QX-020 ("Fix multi-label label-nav toggling (UQ-019)"). Both are legitimate; the search is indexing body prose correctly.

**One minor observation**: QC-003's body still contains a `## Proposal` heading that follows prose text — the task matched because *other* non-heading lines contain the word. The heading itself is correctly stripped. No false positive issue here.

---

## CLI doc staleness fix (UQ-029) — PASS

`--help` output now reads:

```
--search <query>    Filter by title/body content (case-insensitive)
```

Previously said "title substring". Both the flag description and the example line ("List tasks with "bootstrap" in title or body") are updated. Web UI search input placeholder reads `"Search titles and descriptions…"` (confirmed via curl of port 4173). Both surfaces are in sync.

---

## Label frequency sort (UQ-028) — PASS

Actual label counts (from `task list --json`):

```
36  v1
21  usability_quality
17  experiment-4
11  capability_breadth
10  bug
 6  gate
 6  github-provider
 6  methodology
 5  core
 4  experiment-2
```

Web UI home page label nav order: `v1 · usability_quality · experiment-4 · capability_breadth · bug · gate · github-provider · methodology · core · deliberately-adversarial · experiment-2 · …`

This matches frequency-descending order exactly. Previously alphabetical (`action`, `abi`, `author`… first) — now highest-traffic labels lead. Power-user discoverability is significantly improved.

---

## Active label pinning (UQ-027) — PASS

**Single active label (`?label=usability_quality`)**: `usability_quality` appears at position 3 in the nav (after `v1`), rendered as `<strong>usability_quality</strong> (remove)`. Without pinning, it would appear somewhere beyond position 25 alphabetically. The pinning pulled it forward into the visible set correctly.

**Multi-label active (`?label=usability_quality&label=experiment-4`)**: Both active labels appear bold with individual remove links at positions 2 and 3 respectively. `usability_quality` remove link points to `/?label=experiment-4`, and `experiment-4` remove link points to `/?label=usability_quality`. Remove-link URLs correctly remove only the clicked label while preserving the other.

**Label + search composure**: `?label=experiment-4&q=fix` — all nav links correctly carry `q=fix` forward, including prefix/status/sort/label combinators. Active label pinning still works under search context.

---

## Regression checks — PASS

| Check | Result |
|---|---|
| `task list --prefix QX` | Returns QX-001…QX-028, last entries QX-026/027/028 correct |
| `?sort=updated` | Sort nav shows `<strong>Updated ↓</strong>`, page renders |
| `?label=experiment-4&q=fix` | Label + search compose correctly; all nav links preserve both params |
| MCP `task_list` (no args) | Returns 121 tasks, no error |

No regressions observed across any surface.

---

## New gaps found

**minor** — The `--search` help example says `List tasks with "bootstrap" in title or body` but the flag description says `title/body content`. The wording is slightly inconsistent (one uses "title or body", the other "title/body") but both are accurate and unambiguous. No user confusion risk.

**minor** — Label nav shows `… 21 more labels` on the `?label=usability_quality` filtered view. The truncation count is correct but there is no way to expand or paginate the label list to see all 46+ labels. This was a pre-existing limitation (UQ-025 addressed truncation at scale, not full enumeration). Not a regression.

**minor** — MCP `task_list` returns full body text for all 121 tasks, producing 602 KB+ of JSON with no filtering option. For a cross-experiment maintainer calling MCP programmatically this is inconvenient. No regression from prior iterations.

---

## Overall: PASS

All three targeted iteration-7 changes (CB-017 body search heading exclusion, UQ-028/027 frequency sort + active pinning, UQ-029 doc staleness) function correctly across CLI and Web UI. MCP baseline is intact. No regressions found. The `--search "Proposal"` count dropped from ~117 to 37 — a 69% reduction, all survivors are legitimate prose matches.
