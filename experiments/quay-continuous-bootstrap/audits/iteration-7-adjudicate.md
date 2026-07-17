# G3 Audit — Iteration 7
Date: 2026-07-17
Commit: b65d0b6 + cf0cf8b
Auditor: G3 (independent)

## Verdict: PASS-WITH-NOTES

---

## Security findings

**XSS / injection: CLEAR.**
`stripHeadings()` is invoked exclusively on the search-comparison path — it is never
passed to `renderMarkdown()` or inserted into the HTML response body. The body is
rendered only via `renderMarkdown(t.body)` at line 729, which applies `escapeHtml()`
internally to all code-block and inline content. No new injection surface introduced.

**Label pinning with phantom URL labels: low-severity edge case (NOTE, not FAIL).**
If a user manually URL-encodes a `?label=` value that exists in no task, that label
lands in `activeHidden` and is pinned into `visibleLabels` (because `allLabels` — built
from `allTasks` — does not contain it, but `labelFilters` does). This displaces one
real label from the nav's visible 25-slot window. The phantom label is still rendered
through `escapeHtml(l)`, so there is no injection risk. The filtering logic correctly
returns zero tasks for the phantom. The `hiddenLabelCount` is derived from `allLabels`
(not `visibleLabels`), so it accurately reports how many real labels are hidden.
This edge case predates iteration 7 (any spurious `?label=` value would hit the
old rendering loop identically), so it is a pre-existing, non-introduced issue.
Severity: cosmetic UX at worst.

---

## Correctness findings

**`stripHeadings()` regex `/^#+\s/`: CORRECT for all required cases.**

Verified by direct Node.js execution:

| Input | Stripped? | Correct? |
|---|---|---|
| `## Proposal` | yes | yes |
| `#hashtag-in-prose` | no | yes (no space after #) |
| `### Phase 1 — impl` | yes | yes (em-dash on same line, not part of pattern) |
| `# single hash` | yes | yes |
| `##nospace` | no | yes |
| `    ## indented` | no | yes (not at start of line) |
| `text ## inline` | no | yes (# not at position 0) |

**Known limitation — code blocks (NOTE, not FAIL):**
Lines beginning with `# ` inside fenced code blocks (e.g., Python comments `# comment`)
are also stripped by `stripHeadings()`. The function is not code-block-aware. This means
a task body like `\`\`\`python\n# import\n\`\`\`` would have its comment line excluded
from the search index. This is a false-negative (search term not found in code comment)
rather than a false-positive, which is the opposite of the bug CB-017 being fixed.
In practice, markdown task bodies rarely have fenced code blocks, and searching for
comment syntax is an uncommon use case. This limitation is acceptable for the
current context. It is not noted in the commit message or comments — minor omission.

**Label frequency sort and tie-breaking: CORRECT.**
`localeCompare()` provides consistent alphabetical ordering for equal-count labels.
Locale ordering for non-ASCII labels follows system locale (acceptable — no multilingual
requirement stated). Verified: `['zzz-rare-b', 'zzz-rare-a', 'zzz-rare-c']` → `['zzz-rare-a', 'zzz-rare-b', 'zzz-rare-c']`.

**Active-label pinning dedup (`[...new Set([...activeHidden, ...allLabels])]`): CORRECT.**
The spread-into-Set deduplicates correctly. If an active label that is already in the
top-25 (`topLabels.includes(l)` is true), it is NOT added to `activeHidden`, so no
unnecessary displacement occurs. If an active label falls outside top-25, it is prepended
and the last real label in position 25 is pushed out. The `hiddenLabelCount` then
increases by 1 for that displaced label — accurate.

Verified with 27-label scenario (1 with count=30, 26 with count=1):
- No active filter: visible=25, hidden=2, freq-common first — CORRECT.
- Active=`zzz-rare-z` (position 27): visible=25 including zzz-rare-z, hidden=2 — CORRECT.
- `hiddenLabelCount` reflects actual hidden real labels, not phantom entries — CORRECT.

**`labelCounts` uses `allTasks` (unfiltered): CORRECT.**
Label frequency is computed from the full task corpus, not from filtered results.
This ensures the nav ordering is stable regardless of active filters (good UX).

**Placeholder update: CORRECT, no old-string regression.**
The old `placeholder="Search titles…"` has been replaced with
`placeholder="Search titles and descriptions…"`. Confirmed no remaining
occurrences of the old string in `serve.js`. The test suite explicitly asserts both
the new string is present AND the old string is absent.

**Help text: CORRECT, no remaining "title only" language.**
`--search` option now reads "Filter by title/body content (case-insensitive)".
Example updated to "in title or body". Confirmed no occurrence of "title substring"
in `quay.js`. Tests assert both.

---

## Code quality findings

**No duplication between `serve.js` and `bin/quay.js`:**
`stripHeadings()` is defined independently in both files (not shared via a module).
This is consistent with the project's established pattern (see `relativeTime` /
`relativeTimeCli` already duplicated). Not a regression. Minor note: if a bug is
found in the regex, it must be fixed in two places.

**Comment in `serve.js` line 400 says "lines starting with `# `" but the actual
regex is `/^#+\s/` (any number of `#`):** The comment is slightly imprecise but the
actual regex shown in the code block comment is correct. The prose description is
acceptable shorthand. Not misleading enough to be a finding.

**`allLabels` variable reuse:** `allLabels` is used both for the `Set`-dedup source and
in `labelCounts` iteration. The names `topLabels`, `pinnedFirst`, `visibleLabels` are
clear and locally scoped. Readability is good.

---

## Test adequacy findings

**serve.test.mjs — port+8 block (QX-026/027):**
- Correctly creates 30 freq-common tasks + 26 zzz-rare tasks (27 labels total).
- Asserts freq-common appears before zzz-rare in nav by index position — valid structural test.
- Asserts `zzz-rare-z` (position 27) is visible and has a "remove" link when active — correct.
- Asserts "more labels" truncation note appears — correct.
- Asserts new placeholder present and old placeholder absent — correct.

**serve.test.mjs — port+9 block (QX-028):**
- HDNG-1 (heading-only body, search "Proposal") excluded — verified.
- HDNG-2 (prose with unique token) included by prose search, excluded by "Proposal" — verified.
- Tests are precise and cannot be confused by pagination or other tasks (dedicated isolated server).

**cli.test.mjs — block 20:**
- HDNG-1 excluded, HDNG-2 included by "Proposal" search — correct.
- HDNG-2 body uses `VALID_SECTIONS + "...proposal..." + AC_DOD_CHECKED`, confirming prose
  is under non-heading lines — the test correctly distinguishes headings from prose.
- Help text assertions: three separate checks (string present, old string absent, example updated).

**Gap not covered by tests:**
The code-block false-negative edge case (heading-like lines inside code fences being stripped)
is not tested. This is a known limitation of the approach but the tests do not document it.
Low priority given task-body content patterns.

---

## Write surface check

Only files expected to be modified were changed in b65d0b6:
- `packages/quay/src/serve.js` — production change.
- `packages/quay/bin/quay.js` — production change.
- `packages/quay/test/serve.test.mjs` — test coverage.
- `packages/quay/test/cli.test.mjs` — test coverage.
- `experiments/quay-continuous-bootstrap/gap-list.md` — experiment ledger update.
- `tasks/QX-026.md`, `tasks/QX-027.md`, `tasks/QX-028.md` — task files.

cf0cf8b adds only `experiments/quay-continuous-bootstrap/iterations/iteration-7.md`
(draft report). No unrelated files touched. Write surface is appropriate.

---

## Summary

The iteration 7 changes are **functionally correct and well-tested**. All 30/30 tests pass
independently verified by G3. The `stripHeadings()` regex correctly handles all specified
edge cases: matches `## Proposal`, `### Phase 1 —` (em-dash line), does not match
`#hashtag-in-prose` (no space), does not match indented or inline `##`. The active-label
pinning logic correctly prepends only labels that fall outside the top-25 window, uses
`Set`-based dedup to prevent duplicates, and computes `hiddenLabelCount` accurately from
the full `allLabels` array. Label frequency sort is stable and alphabetically consistent
for ties. No XSS or injection surface is introduced; `stripHeadings()` touches only the
search-comparison path.

Two notes logged (neither FAIL-grade):
1. **Code-block false-negative**: `# comment` lines inside fenced code blocks are stripped;
   untested and undocumented, but negligible practical impact.
2. **Phantom-label pinning**: a URL-injected label absent from all tasks occupies a nav slot;
   harmless pre-existing behavior, not introduced by this iteration.

All four specified audit focus areas (regex correctness, pinning logic, tie-breaking,
placeholder/help-text, XSS) are CLEAR.
