# Simulated User Audit — Cross-Experiment Maintainer Persona
Date: 2026-07-17
Iteration: 6
Persona: Cross-experiment maintainer (power user — tracking quay across all 4 experiments, uses CLI/Web UI/MCP regularly)

---

## Body search (CB-016) — PASS with minor doc staleness

### CLI
- `--search "Proposal"` returns 117 tasks; QX-023 is included despite "Proposal" not appearing in its title — body match confirmed.
- `--search "toViewModel"` returns 7 tasks including QX-023 (only body match; title is about "body content", not "toViewModel") — body-only match verified.
- Implementation: `(t.title + " " + (t.body || "")).toLowerCase().includes(...)` in `bin/quay.js:188` — correct.

### Web UI
- `?q=toViewModel` returns QX-023 (body match) alongside QN-063, QN-067 (body matches), and QN-008/009/010/011 (title matches). Body search working.
- `?q=Proposal` returns a large set; QX-023 included.

### Doc staleness (minor gap):
- CLI help text (`--help`) still reads: `"Filter by title substring (case-insensitive full-text search)"` and example says `"List tasks with 'bootstrap' in title"` — **stale after QX-023** since search now also matches body. Low severity but misleading.
- Web UI search input placeholder: `"Search titles…"` — **stale**; should read `"Search title/body…"` or similar.

---

## Label truncation (UQ-025) — CONCERNS

### What works
- Label nav is truncated at 25, showing `"… 21 more labels"` text. Wall-of-labels problem addressed.
- Filtering by a label not shown in nav (e.g. `?label=iteration-5`) **does filter correctly** — the URL filter mechanism is independent of nav visibility.

### Concern: active label after position 25 has no nav affordance
- When `?label=iteration-5` is the active filter, `iteration-5` falls outside the first 25 labels (alphabetically, after "hardening") — it does not appear as `<strong>` (active) in the label nav, and there is no "remove" link for it.
- Code confirms: `visibleLabels = allLabels.slice(0, LABEL_NAV_MAX)` with no promotion of active labels (`serve.js:555`).
- A power user who sets `?label=iteration-5` (e.g. via bookmarked URL or typing) will see the label applied and results filtered, but the nav shows no visual confirmation — the active label is invisible in the nav. This is confusing: how do you "remove" an active label that isn't visible?
- Severity: **significant** — active labels beyond position 25 are orphaned from nav affordance (no bold, no remove link).

---

## Clear-link filter preservation (UQ-026) — PASS

- `?q=QX&label=experiment-4&status=todo` → clear link: `<a href="/?status=todo&label=experiment-4">clear</a>` — removes only `q`, preserves `status` and `label`. Correct.
- `?q=QX&label=experiment-4&status=todo&sort=updated` → clear link: `/?status=todo&label=experiment-4&sort=updated` — `sort` also preserved. Correct.
- `?q=QX&label=experiment-4&status=todo&sort=updated&prefix=QX` → clear link: `/?prefix=QX&status=todo&label=experiment-4&sort=updated` — `prefix` also preserved. Correct.
- Implementation at `serve.js:603`: `buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, null)` — correctly passes null for q only.

---

## Zero-result hint (UQ-024) — PASS

- `--search "somethingthatdoesnotexist1234"` outputs:
  ```
  # search: "somethingthatdoesnotexist1234" (0 matches)
  Hint: use --label to filter by label, or --search to match title/body content.
  ```
- Hint fires correctly on 0-match search results (`bin/quay.js:229-230`).
- Wording is accurate and helpful. PASS.

---

## Regression checks — PASS

- `task list` still shows `"N ago"` timestamp column on every row — `updatedAt` present. No regression from statSync removal.
- `task list --prefix QX` still works, shows 25 tasks with timestamps. PASS.
- `task view QX-023 --json` includes `"updatedAt": 1784271450721.769` — `get()` still returns updatedAt after redundant statSync was removed (QX-025 fix). PASS.
- Multi-label AND-join (`?label=experiment-4&label=iteration-5`) returns correct intersection (QX-020, QX-021, QX-022, etc.). PASS.
- Full test suite: **30/30 pass**, 0 fail — no regressions from all iteration-6 changes.
- `store.js statSync`: The `list()` function no longer has its own redundant statSync — delegates to `get()` which still calls `statSync` internally (`store.js:155`). Correct behavior confirmed by test suite and manual verification.

---

## New gaps found

1. **[significant] Active label beyond truncation position has no nav affordance** — when `?label=iteration-5` (or any label after position 25 alphabetically) is the active filter, the label nav shows no bold indicator and no remove link. User cannot tell from the nav which label is active, nor toggle it off without editing the URL manually. Fix: promote any active labelFilters not in first 25 into a visible section, or show them above the truncation point.

2. **[minor] Stale help text for `--search`** — `bin/quay.js` help still reads "Filter by title substring" and "List tasks with 'bootstrap' in title" (lines 111, 117). Should be updated to reflect body-content search after QX-023.

3. **[minor] Stale Web UI search placeholder** — `serve.js` input placeholder still reads `"Search titles…"`. Should read `"Search title & body…"` or equivalent to set correct user expectation.

---

## Overall: CONCERNS

The three core deliverables — body search, clear-link preservation, zero-result hint — work correctly and pass. The statSync regression check is clean. However, label truncation (UQ-025) has a significant residual gap: active labels beyond position 25 lack any nav affordance (no bold/active indicator, no remove link). This is a usability hole for any power user who bookmarks or shares a URL with a non-top-25 label. Two minor doc-staleness items also remain.
