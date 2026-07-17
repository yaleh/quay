# G3 Independent Out-of-Band Audit — Iteration 4

**Date**: 2026-07-17
**Auditor**: Fresh-context agent dispatched by orchestrator (independent of the authoring/executing session).
**Source file audited**: `packages/quay/src/serve.js`
**Test file audited**: `packages/quay/test/web-ui-browser.test.mjs`
**Self-assessment audited**: `experiments/quay-webui-bootstrap/audits/iteration-4-adjudicate.md`
**Protocol reference**: `experiments/quay-webui-bootstrap/ITERATION-PROMPTS.md` §Core-scope constraints
**Changes under review**: QW-007 (pagination), QW-008 (parent/children on detail page), QW-009 (labels column in list table), CSS fix (.page-nav-disabled color #adb5bd → #666)

**Test run (live, not asserted)**: `node --test packages/*/test/*.test.mjs` — 30 suites, 30 pass, 0 fail, 128 individual assertions all PASS.

---

## Per-Criterion Assessment

### 1. Write-surface boundary: no new write path opened by ?page param

Verified. The `page` query parameter is consumed only in the GET `/` handler (lines 324–330 of serve.js). It affects only which slice of the already-retrieved `tasks` array is rendered. No new POST endpoint, no mutation, no write path is introduced. The existing POST `/task/:id/action/:actionId` route is textually untouched. The parameter contributes exclusively to the read/display path.

**PASS**

---

### 2. "Core stays dumb": no per-backend branching

Verified by full read of serve.js. The file contains no `if (provider.id === ...)`, no `if (backend === 'github')`, no hardcoded per-backend component, in any of the new iteration-4 code. Pagination, parent/children rendering, and labels column all apply uniformly to whatever `taskList()` and `taskGet()` return, regardless of provider identity. The comment on line 5 ("this file never branches on provider id") continues to accurately describe the code.

**PASS**

---

### 3. HTML injection via ?page param

**Analysis of the integer-parse chain** (lines 324–325):

```js
const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
```

All downstream uses of `page`, `safePage`, `totalPages`, and `offset` are pure arithmetic on integers. The integer values are embedded in HTML only as numeric literals inside attribute-free text content: `Page ${safePage} of ${totalPages} (${totalTasks} tasks)`. These variables are integers at all times — they can never carry HTML markup.

**Edge-case trace verified by direct execution**:
- `?page=<script>` → `parseInt('<script>', 10)` = NaN → `Number.isFinite(NaN)` = false → `page=1`. Safe.
- `?page=-1` → `pageParam=-1`, `pageParam >= 1` is false → `page=1`. Safe.
- `?page=0` → `pageParam=0`, `0 >= 1` is false → `page=1`. Safe.
- `?page=1abc` → `parseInt('1abc', 10)` = 1 → valid integer `page=1`. Safe (the alphanumeric suffix is silently dropped; the integer 1 is used, not the raw string).
- `?page=1.5` → `parseInt('1.5', 10)` = 1 → truncated to integer 1. Safe.

The `buildHref()` function (lines 350–358) constructs hrefs using `URLSearchParams.set("page", String(pg))` — this correctly percent-encodes any special characters before they appear in an href attribute. However, since `pg` is always an integer (derived from `safePage ± 1`), no encoding is ever needed in practice. The integer-only invariant holds throughout the call chain.

No raw ?page value ever appears in HTML output. **PASS**

---

### 4. Pagination boundary conditions

Verified by direct execution against the production logic. All cases resolve safely:

| Input | pageParam | page (after guard) | safePage (after clamp) | offset | Result |
|---|---|---|---|---|---|
| (no param) | 1 | 1 | 1 | 0 | First 20 tasks |
| `?page=1` | 1 | 1 | 1 | 0 | First 20 tasks |
| `?page=0` | 0 | 1 | 1 | 0 | Clamped to first page |
| `?page=-1` | -1 | 1 | 1 | 0 | Clamped to first page |
| `?page=NaN` or `<script>` | NaN | 1 | 1 | 0 | Clamped to first page |
| `?page=999` (beyond last) | 999 | 999 | totalPages | valid offset | Clamped to last page |
| 0 tasks total | — | 1 | 1 | 0 | Empty table; `Page 1 of 1 (0 tasks)` |

The `Math.max(1, ...)` on `totalPages` prevents division by zero and prevents a 0-page display for empty task lists. The `Math.min(page, totalPages)` clamp prevents out-of-bounds slicing — `tasks.slice(offset, offset + PAGE_SIZE)` always returns `[]` or a valid sub-array, never throws. No boundary condition produces HTML injection or a runtime error.

**PASS**

---

### 5. `buildHref()` page handling and filter/sort/label reset behavior

The function signature is `buildHref(status, sort, label, pg)` (line 350). The `pg` parameter is the fourth argument.

**Reset behavior when filter/sort/label nav is clicked**: All filter nav, sort nav, and label nav `buildHref()` calls (lines 360–391) pass at most three arguments — the new `pg` argument is omitted entirely. With `pg=undefined`, the condition `if (pg && pg > 1)` is false (since `undefined` is falsy), so `page` is not added to the URLSearchParams. This correctly resets to page 1 (a clean `/` or `/?status=todo` etc. URL, with no page param) when a filter, sort, or label is changed.

**Page=1 omission from URLs**: Verified — when `pg=1`, `1 > 1` is false, so `page` is not set. The URL is clean. When `pg=2`, `page=2` is set. This matches the documented "page=1 omitted as a clean URL" behavior.

**Previous/Next navigation**: The pageNav section (lines 395–404) passes `safePage - 1` and `safePage + 1` to `buildHref()`. Since `safePage` is always in `[1, totalPages]`, `safePage - 1 >= 1` and `safePage + 1 <= totalPages` are both checked before the respective link is rendered (the disabled span is shown otherwise). The links are only generated when they would point to a valid page.

**PASS**

---

### 6. Parent/children HTML injection (QW-008)

The parent link (lines 453–454):
```js
html` · parent: <a href="/task/${escapeHtml(t.parent)}">${escapeHtml(t.parent)}</a>`
```
Both the `href` attribute value and the link text are independently passed through `escapeHtml()`. The `"` character (which would allow breaking out of the href attribute) is escaped to `&quot;`. The href is always prefixed with `/task/` — a `javascript:` URI cannot be injected because the prefix is a literal string, not user-controlled.

The children rendering (lines 455–459):
```js
t.children.map((c) =>
  html`<a href="/task/${escapeHtml(c)}">${escapeHtml(c)}</a>`
)
```
Same pattern: both href and link text are escaped. The `Array.isArray(t.children) && t.children.length > 0` guard correctly handles null, undefined, empty array, and non-array values for `t.children`.

**PASS**

---

### 7. Labels column injection (QW-009)

The list table row rendering (lines 332–341):
```js
<td>${escapeHtml((Array.isArray(t.labels) ? t.labels : []).join(", "))}</td>
```
The `escapeHtml()` is applied to the joined string. A label value containing `<`, `>`, `&`, `"`, or `'` would be correctly escaped. The `Array.isArray()` guard handles missing/null labels. Comma-separated joining occurs before escaping — this means the separator `, ` itself is not escaped (it contains no HTML-special characters, so this is safe).

**PASS**

---

### 8. `meta description` content injection

List page (line 415):
```js
<meta name="description" content="Quay task list — ${escapeHtml(manifest.name)}">
```
`manifest.name` is the provider's declared name (from the provider MCP server's manifest response). It is escaped before insertion. The content attribute is double-quoted; `escapeHtml` escapes `"` → `&quot;`, preventing attribute-boundary breakout.

Detail page (line 462):
```js
<meta name="description" content="${escapeHtml(t.id)}: ${escapeHtml(t.title)}">
```
Both `t.id` and `t.title` come from the provider's task store (not from user query input). Both are escaped. The separator `: ` contains no HTML-special characters. Attribute-boundary breakout is prevented by the `&quot;` escaping of `"`.

Note: the `meta description` tag is not executable (unlike `<script>`), but injection into an attribute could still allow attribute-boundary breakout leading to additional attributes (e.g., injecting `" onload=evil`). The escaping correctly prevents this.

**PASS**

---

### 9. Test coverage

**Pagination (QW-007)**: 12 distinct assertions covering:
- Page 1 content (ZPG-01 in, ZPG-10 out, ZPG-25 out, ZPG-09 in)
- Page 2 content (ZPG-10 in, ZPG-25 in, ZPG-01 out, ZPG-09 out)
- Page nav presence on page 1 and page 2
- Page info text
- Explicit `?page=1` equivalence to default
- Filter + pagination interaction (`?sort=id&status=todo&page=2`)

**Gap noted — not a blocker**: The tests do not explicitly cover the `?page=0`, `?page=-1`, or `?page=<script>` boundary inputs. The code's behavior for these is correct (all clamp to page 1 as verified above), but the test file does not assert this mechanically. This is a coverage gap, not a functional defect. The mathematical tracing above confirms safety regardless.

**Gap noted — not a blocker**: The `?page=999` (beyond-last-page) clamp is not tested. The clamp logic is correct and confirmed by manual execution, but not covered by a mechanical test.

**Parent/children (QW-008)**: 6 assertions covering parent link presence, parent id text, children link presence, children id text, and two negative controls (no parent/children for WUI-1). Adequate for the feature surface.

**Labels column (QW-009)**: 4 assertions covering header presence, label content in `<td>`, column persistence under filters. The XSS-escaped-labels case is not tested directly (the fixture only uses benign label values `alpha`, `beta`), but the `escapeHtml()` path is exercised by other parts of the test suite (e.g., task title/id escaping) and is unit-testable at the function level.

**All 30 test suites, 128 assertions — 0 failures** confirmed by live run at audit time.

**PASS** (coverage adequate for a read-side UI feature; noted gaps are improvements, not blocking defects)

---

### 10. G5 preserved: no new external dependencies

Verified by full import list inspection. `serve.js` imports only:
- `node:http` (Node.js builtin)
- `node:path` (Node.js builtin)
- `./config.js`, `./provider-client.js`, `./provider-env.js`, `./action.js` (local project modules)

The iteration-4 changes (QW-007/008/009) add no `import` or `require()` statements. All new APIs used (`URLSearchParams`, `parseInt`, `Number.isFinite`, `Math.max`, `Math.min`, `Math.ceil`, `Array.isArray`, `Array.prototype.slice`, `Array.prototype.join`, `Array.prototype.map`) are JavaScript/Node.js builtins. No npm package is referenced.

**PASS**

---

### 11. Backward compatibility: prior assertions preserved

Live test run confirms all 30 test suites and all 128 assertions pass, including all pre-iteration-4 assertions (QC-001, QC-002, QW-001 through QW-006). The addition of 25 ZPG-* pagination tasks to the fixture was carefully designed so that:

- Non-ZPG tasks (WUI-1, WUI-2, WUI-ACT, SORT-A/B/C, LBL-1/2/3, PC-PARENT, PC-CHILD) appear on page 1 in insertion-order mode (total 11 tasks < PAGE_SIZE=20).
- Filter-specific prior assertions (e.g., `?status=todo` showing WUI-1) continue to hold because the filtered set also fits on one page.
- The prior sort assertions use `?sort=id`, which orders alphabetically — the ZPG-* tasks sort to the end (Z > W), so prior assertions about SORT-A/B/C ordering remain valid on page 1.

No prior assertion was modified or weakened to accommodate the pagination feature.

**PASS**

---

## Verdict: PASS

All 11 criteria satisfied. The three QW-* deliverables (QW-007 pagination, QW-008 parent/children detail, QW-009 labels column) plus the CSS contrast fix are clean, correctness-sound additions to `packages/quay/src/serve.js`.

**Key findings from independent audit**:

1. The integer-parse chain for `?page` is robust against all adversarial inputs (XSS, negative, zero, NaN, beyond-last-page) — confirmed by direct execution of the production logic.
2. `escapeHtml()` is correctly applied to all user-data-derived values in all three new features: parent/children ids in both href and text positions, labels in the list table, and manifest/task fields in `<meta description>`.
3. `buildHref()` correctly resets to page 1 when filter/sort/label nav is clicked, by omitting the `pg` argument at all filter/sort/label call sites.
4. No new write surface, no per-backend branching, no external dependency.
5. Two minor test coverage gaps identified (page=0/negative/XSS boundary inputs, and page=beyond-last clamp) — neither is a functional defect; both are improvement candidates for future iterations.
6. The inline self-assessment (iteration-4-adjudicate.md) is accurate and honest. All 11 criteria it assessed align with this independent audit's findings.

**Auditor note on dispatch mode**: This audit was dispatched by the orchestrator as a fresh-context agent, per protocol §Core-scope constraints item 5 and §0b's absolute G3 exclusion from manda. The G3 independence criterion is satisfied.
