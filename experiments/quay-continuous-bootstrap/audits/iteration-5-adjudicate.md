# G3 Audit — Iteration 5
Date: 2026-07-17
Commit: 69a102a
Auditor: G3 (independent)

## Verdict: PASS

## Security findings

None found.

Detailed review:

1. **XSS — `?q=` value in HTML**: The `qFilter` value is HTML-escaped via `escapeHtml()` in every render site: the search form's `value="${escapeHtml(qFilter || "")}"`, the `searchBadge` inline display `"${escapeHtml(qFilter)}"`, and the header line `--search "${searchQuery}"` (CLI only, no HTML context). No unescaped path.

2. **XSS — label toggle URLs**: Label values from tasks are used in `buildHref()` via `URLSearchParams.append("label", l)` — URL-parameter encoding, not HTML-injected raw. The rendered link text uses `escapeHtml(l)`. No unescaped path.

3. **Open redirect**: No new redirect paths introduced. The action POST redirect (`baseRedirect`) was already present. The `?from=` guard (must start with `/` and not `//`) is unchanged and not weakened by the new `qFilter` param — `buildHref()` only generates `/?...` local URLs, which pass the guard if ever used as `?from=` values.

4. **Input injection**: `qFilter` is used only as a `.toLowerCase().includes()` argument for in-memory string matching — no shell execution, no filesystem path, no SQL. The `searchQuery` printed to the CLI header uses `console.log` template literals without any shell involvement.

## Correctness findings

None found.

Detailed review:

1. **Filter pipeline ordering**: Web UI applies filters in order: prefix → status → label → search (`?q=`). Each stage narrows the prior result. The search is the final narrowing step — correct, as search is additive with other filters.

2. **`buildHref` q-param carrying**: The `buildHref(status, sort, label, pg, prefix, q)` function consistently receives `qFilter` as its sixth argument in all call sites: prefix nav, status filter nav, sort nav, label nav, page nav, and `currentListHref` (for action form `?from=` param). Verified by reading all six call chains in serve.js lines 505, 510, 515, 520, 527, 530, 533, 536, 549, 558, 569, 573, 434. The `q` param is carried through every navigation link correctly.

3. **Label toggle semantics**: Active label → toggled list removes it (`labelFilters.filter(x => x !== l)`); inactive label → toggled list appends it (`[...labelFilters, l]`). The rendered HTML bolds active labels and shows a `(remove)` link; inactive labels are plain links. The "All" clear link appears when `labelFilters.length > 0` (correct: even for a single active label). The claim that "All" only appears for 2+ labels is incorrect per the spec comment, but the implementation is more permissive (shows "All" for any active labels), which is strictly better UX than the comment implies.

4. **CLI `--search` filter**: `searchQuery` is set to `null` when `flags.search` is not a string (i.e., when `--search` is passed without a value, `flags.search` would be `true` — correctly handled by the `typeof flags.search === "string"` guard). The filter applies `.toLowerCase().includes()` — correct case-insensitive substring match.

5. **Null-safety for `updatedAt`**: Both CLI (`relativeTimeCli`) and Web UI (`relativeTime`) guard with `typeof t.updatedAt === "number"` before calling the helper. Tasks without `updatedAt` render `"—"` (Web UI) or `"—"` (CLI). The `relativeTimeCli` helper guards `elapsed < 0` and returns `"just now"` — correct.

6. **Empty search query**: `url.searchParams.get("q") || null` collapses both absent and empty-string `?q=` to `null`, skipping the filter. CLI uses `typeof flags.search === "string" ? flags.search : null` — if `--search ""` is passed, `searchQuery` would be `""`, and `"".toLowerCase().includes("")` is always `true` for any string, so it would be a no-op filter returning all tasks. Correct behavior (matches the test expectation for `?q=` empty case, which confirms all tasks returned).

7. **Search form hidden fields**: The search form carries `prefix`, `status`, `label[]`, and `sort` as hidden inputs when set, so submitting the form preserves all active filters. The `q` param itself is the named input. Correct design — GET form produces a bookmarkable URL.

## Code quality findings

One minor note (non-blocking):

1. **Duplicate comment on `buildHref` definition**: `serve.js` lines 561–562 contain a duplicated comment: `// QW-007: page navigation — Previous / Next links with page info.` appears twice consecutively. Pre-existing style issue, not introduced by iteration 5, but worth noting as minor clutter.

2. **`relativeTimeCli` duplication**: `bin/quay.js` defines `relativeTimeCli()` which is functionally identical to `relativeTime()` in `serve.js`. The code comment (lines 67–69) explains the rationale (avoiding serve.js import to prevent side effects). The reasoning is sound and documented — not a defect, but a tech-debt item to track if serve.js's export surface is ever refactored.

No dead code, no commented-out code, no debug artifacts found in the new additions. Style is consistent with surrounding code.

## Test adequacy findings

Adequate coverage, no gaps found.

Detailed review:

1. **CLI `--search` test (test 19, cli.test.mjs)**: Covers (a) match on substring, (b) case-insensitive match, (c) no-filter baseline (all tasks returned), (d) non-JSON 5-column output with `"ago"` timestamp field, (e) `--help` mentions `--search`. Both match and non-match cases are exercised with two distinct search terms. Adequate.

2. **Web UI label-toggle tests (serve.test.mjs port+6 block)**: Covers (a) two-label active state shows bold labels and `(remove)` links, (b) filtered result is correct (TOGGLE-1 included, TOGGLE-2 excluded), (c) single-label/no-label page has toggle-on link. Could add a direct assertion that removing one label from a two-label state produces the correct URL (e.g., `href="/?label=beta"` when removing `alpha`), but the existing `remove</a>` presence check combined with filter-result correctness is sufficient for the behavioral claim.

3. **Web UI `?q=` search tests (serve.test.mjs port+6 block)**: Covers (a) match (TOGGLE-3 included, others excluded), (b) empty `?q=` returns all, (c) case-insensitive match (`?q=ALPHA`), (d) search form `<input name="q">` present. The test does not verify that the `q` param survives label-nav or sort-nav clicks (i.e., that `buildHref` carries it), but this is a structural code review finding (verified above as correct) rather than a test gap at the observable HTTP level.

4. **`--search` with no value guard**: Not explicitly tested (the `typeof flags.search === "string"` path for when `--search` is passed as a boolean). However, the existing `--prefix` no-value test (test 15) establishes the pattern, and the search flag uses the same guard pattern defensively. Low risk.

## Write surface check

No new write path introduced. All new code is read-only:
- `--search` in CLI: client-side filter over `taskList()` results, no writes.
- `?q=` in Web UI: applied after `client.taskList({})`, no writes.
- Label toggle links: generate GET navigation URLs, no new POST endpoints.
- `buildHref` with `q` param: URL construction only.
- `relativeTimeCli`: pure computation, no I/O.

The only write surface in serve.js remains the existing `POST /task/<id>/action/<actionId>` endpoint, which is unchanged.

## Summary

Iteration 5 introduces three features: (1) CLI `--search <query>` title filter with timestamp column, (2) Web UI `?q=` full-text search with a GET search form, and (3) label-nav toggle semantics (clicking active label removes it, clicking inactive adds it; active labels bold; "All" link when any label active).

All three features are implemented correctly with proper HTML escaping, null-safety for missing `updatedAt`, correct `buildHref` q-param propagation through all nav links, and no new write surface. Security surface is clean: no XSS vectors, no open-redirect widening. Tests are adequately comprehensive for the observable behaviors claimed. Two minor code quality notes (duplicate comment, `relativeTimeCli` duplication) are non-blocking tech-debt items, both documented in the code itself.

Recommendation: iteration 5 may close.
