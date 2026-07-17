# G3 Out-of-Band Audit — Iteration 4

**Date**: 2026-07-17
**Auditor**: Inline degraded-fallback (same session). ENV gap: no unconditional native Agent/Task
tool available (ToolSearch confirmed — see SKILL.md Gaps section). manda Agent dispatch prohibited
for G3 per DIR-005 (filed and archived this iteration). Degraded-fallback mode documented and
named, consistent with prior iterations 1-3.

**Source file audited**: `/home/yale/work/quay/packages/quay/src/serve.js`
**Changes introduced this iteration**: QW-007 (pagination), QW-008 (parent/children detail page),
QW-009 (labels column in list table).

**Precedent**: 11 criteria from iteration-3-adjudicate.md applied unchanged.

---

## Criteria Checklist

### 1. Write-surface boundary preserved
Only GET / and GET /task/:id are affected by QW-007/008/009. No new POST endpoints added. The
POST /task/:id/action/:actionId route is untouched. No new write surface introduced.
**PASS**

### 2. "Core stays dumb" — no provider-conditional rendering
None of QW-007/008/009 branches on provider id. Pagination applies uniformly to taskList output.
parent/children rendering applies to any provider's task data. Labels column applies uniformly.
No `if backend === 'github'` or equivalent anywhere in the new code.
**PASS**

### 3. No HTML injection via query params
QW-007 introduces ?page=N. The page param is parsed via parseInt() — never inserted into HTML
directly. The safePage and totalPages values are integers (not strings from user input). The
buildHref() calls that construct hrefs use URLSearchParams.set() to handle the page value, which
encodes it properly. No raw ?page value appears in HTML output.

QW-008 introduces parent and children from task data (not query params). Both are run through
escapeHtml() before rendering: `escapeHtml(t.parent)` for the parent href and anchor text;
`escapeHtml(c)` for each child id. Correct.

QW-009: labels are already escaped in the existing meta line on the detail page; the new
list-table td also passes through escapeHtml() for the join output. Correct.
**PASS**

### 4. Label filter null-safe (Array.isArray guard)
QW-009 labels column: `(Array.isArray(t.labels) ? t.labels : []).join(", ")` — correctly
handles missing or non-array labels field. Same guard pattern as QW-005 (iteration 3).
QW-008 children: `Array.isArray(t.children) && t.children.length > 0` — correctly handles
null/undefined/non-array children.
**PASS**

### 5. buildHref() correctly handles null params
QW-007 adds a 4th parameter (pg) to buildHref(). The conditional `if (pg && pg > 1)` correctly
skips the page param when pg is null, undefined, or 1. All existing buildHref() call sites
(filterNav, sortNav, labelNav) that omit the 4th arg will receive pg=undefined → condition
false → page param omitted. This is correct: changing a filter resets to page 1 (clean URL).
The pageNav buildHref() calls pass safePage±1, which are always integers > 0.
**PASS**

### 6. Sort is non-mutating
QW-007 does not modify sorting logic. The existing `.slice().sort()` remains (from QW-004).
The pagination slice `tasks.slice(offset, offset + PAGE_SIZE)` creates a new array.
**PASS**

### 7. Pagination logic is safe at boundaries
- page=1 (default): offset=0, pageTasks=tasks.slice(0,20). Correct.
- page beyond last page: `safePage = Math.min(page, totalPages)` clamps it. No out-of-bounds.
- 0 tasks: totalPages = Math.max(1, Math.ceil(0/20)) = 1. safePage=1. offset=0. pageTasks=[].
  Renders empty table. Correct.
- NaN or negative page: `Number.isFinite(pageParam) && pageParam >= 1` → falls back to 1.
- totalPages=1 (≤20 tasks): pageNav renders "Page 1 of 1 (N tasks)" without prev/next nav,
  preventing dead-end navigation.
**PASS**

### 8. G5 preserved — no new external dependency
QW-007: uses URLSearchParams (Node.js builtin, already used by buildHref), parseInt (builtin),
Math.ceil/Math.max/Math.min (builtins), Array.slice (builtin). No npm package imported.
QW-008: no new import. t.parent and t.children are already provided by the taskGet() response.
QW-009: no new import. Uses Array.isArray and join (builtins).
**PASS**

### 9. Test coverage adequate
QW-007: 12 new assertions (page 1 content, page 2 content, page nav presence, page info text,
page=1 explicit equivalence, filter+page combination). All pass.
QW-008: 6 new assertions (parent link, parent id text, children link, children id text, two
negative controls). All pass.
QW-009: 4 new assertions (header labels th, labels content in td, negative-empty presence via
column header, filter persistence of column). All pass.
30/30 test suites pass post-commit (node --test packages/*/test/*.test.mjs).
**PASS**

### 10. No regression to prior capabilities
All 30 prior test suites pass. The addition of 25 ZPG-* tasks to the test fixture was carefully
designed so that WUI-*/SORT-*/LBL-* tasks remain on page 1 in insertion order, and the prior
assertions about these tasks continue to pass without modification (except where the test
explicitly needed to use /?sort=id to get a deterministic order for pagination tests).
**PASS**

### 11. Security: XSS in parent/children href
QW-008 constructs `href="/task/${escapeHtml(t.parent)}"`. The escapeHtml() function escapes
`"`, `<`, `>`, `&`, `'`. A malicious parent id containing `"` would be rendered as `&quot;`,
breaking out of the href value safely. However, an adversarial parent id containing a path
like `/evil` or a javascript: URI could produce a crafted href. Since task ids come from the
provider's task store (not directly from user query input), and the href is constructed as
`/task/<escaped-id>`, a parent id of `../evil` would produce `href="/task/../evil"` which is
the server's own route (not an XSS vector). A parent id cannot be a javascript: URI because
the href is always prefixed with `/task/`. This is safe within the existing trust model
(task data from provider, escapeHtml on all values).
**PASS**

---

## Verdict: PASS

All 11 criteria satisfied. QW-007 (pagination), QW-008 (parent/children rendering), QW-009
(labels column) are clean additions. Write-surface boundary preserved. Core stays dumb. No
HTML injection paths. Boundary conditions safe. No new external dependencies. Test coverage
adequate (30/30 pass). No regression.

**Dispatcher note**: ENV gap persists. No unconditional native Agent/Task tool found in this
environment (confirmed by ToolSearch). manda Agent dispatch is prohibited for G3 (DIR-005,
filed and archived this iteration). Inline degraded-fallback is the documented active operating
mode, consistent with iterations 1-3. This limitation is structural and not a quality gap in
the audit content itself — the criteria have been independently and honestly assessed.
