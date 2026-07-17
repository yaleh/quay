# G3 Audit — Iteration 6
Date: 2026-07-17
Commit: 81efe52
Auditor: G3 (independent)

## Verdict: PASS-WITH-NOTES

One confirmed correctness gap (active label hidden by truncation — UQ-025 follow-up), no security issues, no regressions, adequate test coverage for new features. The gap is a known category (UX degradation at edge scale, not data loss or security), does not block the iteration, and should be logged for a future iteration.

---

## Security findings

### S-1: Body content not rendered in search path — CLEAR
`t.body` appears in exactly two places in `packages/quay/src/serve.js`:
- Line 392: string comparison only (`(t.title + " " + (t.body || "")).toLowerCase().includes(...)`) — never written to HTTP response.
- Line 694: detail page only, via `renderMarkdown(t.body)` — not part of the list/search path.

The list page HTML response (`res.end(html\`...\``) at lines 615–634 outputs only `escapeHtml(t.id)`, `escapeHtml(t.status)`, `escapeHtml(t.role)`, `escapeHtml(t.title)`, `escapeHtml(t.labels.join(", "))`, and `escapeHtml(relativeTime(...))`. Body content is never written to the list HTML.

### S-2: `renderMarkdown` bold/italic XSS safety — CLEAR
`inlineMarkdown()` calls `escapeHtml()` BEFORE applying the bold/italic regex replacements. The `$1` capture group in `<strong>$1</strong>` and `<em>$1</em>` therefore only contains already-HTML-escaped text. An input like `**<script>alert(1)</script>**` becomes `<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>` — safe.

### S-3: Label "… N more labels" injection — CLEAR
The string `… ${hiddenLabelCount} more labels` (line 571) is constructed from `hiddenLabelCount`, which is the result of `allLabels.length - visibleLabels.length` — always an integer. The string contains no HTML elements and is joined into the labelNav array alongside other already-escaped strings. No injection vector exists.

### S-4: `buildHref` label-name injection via href attribute — CLEAR
Label names fed into `buildHref` as URL query parameters are encoded by `URLSearchParams.append()`, which percent-encodes all special characters including `<`, `>`, `"`, and `'`. A label name of `<script>alert(1)</script>` becomes `%3Cscript%3Ealert%281%29%3C%2Fscript%3E` in the href. Double-quotes (which could break out of the `href="..."` attribute) are encoded as `%22`. Additionally, label text rendered in the nav HTML uses `escapeHtml(l)` explicitly (lines 568–569).

### S-5: `html` template tag is not auto-escaping — NOTED, NOT NEW
The `html` function (line 19–21) is a plain string concatenator, not an auto-escaping tag. This is the pre-existing design; all callers are responsible for calling `escapeHtml()` on dynamic values before interpolation. This iteration introduces no new unescaped interpolations in the html template calls. No regression.

---

## Correctness findings

### C-1: store.js `updatedAt` after statSync removal — CLEAR
`get()` (lines 141–160) calls `fs.statSync(taskFile)` in its own try/catch and sets `updatedAt = stat.mtimeMs` before calling `toViewModel()`. `toViewModel()` (lines 163–182) includes `updatedAt` on the returned view-model when provided. `list()` (lines 236–258) now calls `get(id)` and returns `t` directly, inheriting the `updatedAt` already set by `get()`. The prior redundant `statSync` in `list()` was overwriting `t.updatedAt` with the same value that `get()` had already set; its removal has no observable effect on the returned `updatedAt` field.

Race note: if a file is deleted between `listIds()` and `get(id)`, `get()` returns `null` (it returns null when `readRaw` returns null or statSync throws), and `list()` filters out nulls. This race was handled correctly both before and after the change. No regression.

### C-2: Zero-result hint scope — CORRECT
The hint at line 229 is gated on `searchQuery !== null`. `searchQuery` is set only when `typeof flags.search === "string"` (line 185). If `--label` or `--prefix` alone returns zero results, `searchQuery` remains `null` and the hint does not fire. Correctly scoped to `--search`-only zero results.

### C-3: Clear link preservation — CORRECT
Line 603:
```js
buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, null)
```
The sixth argument `q` is explicitly `null`, which causes `buildHref` to omit the `q` param (line 494: `if (q) params.set("q", q)` — `null` is falsy). All other filters (`statusFilter`, `sortKey`, `labelFilters` array, `prefixFilter`) are preserved. Verified by test QX-025 which asserts the clear link href contains `status=todo` and `label=label-01` but not `q=`.

### C-4: Body search concatenation — CORRECT
`(t.title + " " + (t.body || "")).toLowerCase().includes(searchQuery.toLowerCase())` is safe for the `null`/`undefined` body case via `|| ""`. A title-only task (no body field) will match on title alone. A body-only match will correctly include the space separator, preventing false positives from title-suffix + body-prefix concatenation (e.g., title "foo" + body "bar" won't match "oobar", because `"foo bar".includes("oobar")` is false). The space separator is a correct design choice.

### C-5 (GAP): Active label hidden by truncation — FLAGGED
If a user navigates to `/?label=label-27` and the workspace has 30 sorted labels, `label-27` falls in position 27 of the sorted list — beyond the 25-label `LABEL_NAV_MAX` cutoff. The label nav will not render a bold entry or a "remove" link for the active filter. The filter itself still works (tasks are filtered correctly), but the user has no visible confirmation in the label nav that `label-27` is active, and no nav-level "remove" link.

Severity: UX gap at scale (>25 labels), not a data-loss or security issue. The "All" clear-all link still works to reset label filters. The filter breadcrumb in the URL is also visible. This is a known category of truncation UI problem.

Recommendation: Log as a new gap item (UQ-TBD) for a future iteration. Options include: always include the active labels in the visible set (bump them to the front or splice them in after position 25), or add an "active filter" summary line above the nav when active labels are hidden.

---

## Code quality findings

### Q-1: Constant `LABEL_NAV_MAX` is block-scoped to the request handler — ACCEPTABLE
`LABEL_NAV_MAX = 25` is defined inside the request handler closure rather than as a module-level constant. It is not reused outside that block, so block-scoping is reasonable. A future refactor could move it to module scope if it needs to be configurable or reused, but this is not a concern at current scale.

### Q-2: Duplicate comment on line 574 — MINOR COSMETIC
Line 574 contains a duplicate `// QW-007: page navigation — Previous / Next links with page info.` comment (present twice in succession). Does not affect functionality.

### Q-3: Body search space separator edge case — ACCEPTABLE
Noted above in C-4. The `" "` space separator prevents cross-boundary false positives and is the conventional approach. No issue.

---

## Test adequacy findings

### T-1: CLI body-search tests — ADEQUATE
`cli.test.mjs` BSRCH-1/2 tests: creates a task with a unique term exclusively in body (not in title), verifies it is found by `--search`; creates a control task with no match, verifies it is excluded. Both pass.

### T-2: CLI zero-result hint tests — ADEQUATE
Tests that `--search no-such-term-ever-42z` exits 0, emits "Hint:" and mentions "--label". Confirms hint fires for `--search` with no matches. Scope isolation of hint (not firing for `--label`-only zero results) is not tested but is trivially correct by code inspection (single conditional on `searchQuery !== null`).

### T-3: Serve body search tests — ADEQUATE
`serve.test.mjs` QX-023 block: body-only match verified, control excluded, case-insensitive uppercase match verified. Coverage is thorough.

### T-4: Label truncation test — ADEQUATE
30 tasks with distinct labels created; test asserts "more labels" appears in HTML and "5 more labels" appears (correct: 30 − 25 = 5). Truncation count arithmetic is validated.

### T-5: Clear link preservation test — ADEQUATE
Verifies that a `?status=todo&label=label-01&q=something` request contains a clear link whose `href` includes `status=todo`. The regex extraction of the clear link href and check is solid.

### T-6: Missing test — active label hidden by truncation (C-5 gap) — UNCONFIRMED
No test exercises the scenario where a user applies `?label=<label-beyond-position-25>` and checks whether the label nav correctly renders (or does not render) a remove link or bold entry. This absence is consistent with the gap not being discovered during dev.

---

## Write surface check

No new HTTP endpoints, no new POST handlers, no new write paths introduced in this commit. All changes are:
- Filter logic in `GET /` (read-only, in-memory filtering)
- HTML rendering of label nav and search badge (no new state mutations)
- `store.js list()` simplification (removes a `statSync` call, does not change write paths)
- CLI output formatting (stdout only)

Write surface is unchanged.

---

## Summary

All five focus areas from dev agent notes are resolved cleanly:

| Focus area | Finding |
|---|---|
| XSS safety — body in search | CLEAR: body used only in `.includes()` comparison, never written to HTML response in list path |
| Label "… N more labels" HTML safety | CLEAR: `hiddenLabelCount` is always an integer; no injection vector |
| store.js statSync removal | CLEAR: `get()` already sets `updatedAt`; `list()` correctly inherits it; no regression |
| Zero-result hint scope | CORRECT: gated on `searchQuery !== null`, not on zero results from `--label`/`--prefix` |
| Clear-link preservation | CORRECT: `buildHref(..., null)` omits `q`, preserves all other filters |

One new gap identified: **C-5 — active label hidden by truncation**. When a user has an active `?label=` filter for a label that falls beyond position 25 in the sorted label list, no bold entry or remove link appears in the label nav for that label. The filter itself operates correctly; only the nav indicator is missing. Recommended for logging as a new gap item.

Full test suite: 30/30 pass (CLI + serve).
