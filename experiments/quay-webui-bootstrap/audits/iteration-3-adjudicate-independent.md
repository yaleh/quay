# Iteration 3 G3 Independent Adjudicate Audit — QW-004, QW-005, QW-006

**Date**: 2026-07-17
**Reviewer**: Fresh-context independent agent (G3 out-of-band, dispatched by orchestrator via native Agent/Task tool — not the iteration-executor's session, not via manda)
**Supersedes**: `experiments/quay-webui-bootstrap/audits/iteration-3-adjudicate.md` (executor's inline self-assessment, same-session degraded-fallback mode)
**Tasks audited**: QW-004 (sort by id/status), QW-005 (filter by label), QW-006 (heading-order + mobile CSS)
**Source read**: `packages/quay/src/serve.js` (full), `packages/quay/test/web-ui-browser.test.mjs` (full), executor inline audit, ITERATION-PROMPTS.md §Core-scope constraints

---

## Overall Verdict: PASS

No blocking issues found. All eleven criteria assessed independently. Three non-blocking notes recorded below (items 4, 7, 8); one finding the executor's audit did not explicitly surface (item 6 — `buildHref()` URL parameter ordering creates a minor UX inconsistency, non-blocking). No criterion warrants a CONCERNS or FAIL rating.

---

## Per-Criterion Assessment

### 1. Write-surface boundary preserved

**PASS**

Verified by reading the full handler structure in `serve.js`. QW-004 and QW-005 modify only the `GET /` handler (query param reading, filter/sort logic, nav HTML). QW-006 modifies only `pageStyles()` (CSS) and the `GET /task/:id` response (adds `<h2 class="sr-only">Details</h2>`). No new route was added. The existing `POST /task/:id/action/:actionId` route is unchanged. No new form elements or input affordances were introduced anywhere. Confirmed: scope boundary intact.

### 2. "Core stays dumb" — no backend-specific conditional rendering

**PASS**

Sort comparators use `t.id` and `t.status` — both are generic task schema fields common to all providers (defined in quay-proposal.md's task structure). Label filter uses `t.labels` — also generic. `buildHref()` is pure URL construction logic with no provider awareness. No `if provider === 'github'`, no `if backend === 'native'`, no hardcoded per-backend branches anywhere in the diff scope. Confirmed: Core stays dumb.

### 3. HTML injection safety

**PASS**

Full audit of every query-param-derived value path:

- `statusFilter` (`url.searchParams.get("status")`): Used only as `t.status === statusFilter` (comparison). The filterNav renders from the hardcoded `statuses` array (`["todo", "ready", "done", "needs-human"]`) with `escapeHtml(s)` applied. The raw `statusFilter` value is never rendered into HTML directly.
- `sortKey` (`url.searchParams.get("sort")`): Used only as `sortKey === "id"` / `sortKey === "status"` (comparison). The sortNav renders from hardcoded string literals ("Default", "id", "status"). The raw `sortKey` value is never rendered into HTML.
- `labelFilter` (`url.searchParams.get("label")`): Used only as `t.labels.includes(labelFilter)` (comparison). In `labelNav`, label values come from `allLabels` — derived from `t.labels` task data (not the raw URL param) — with `escapeHtml(l)` applied on render. The `<strong>All</strong>` fallback uses a literal, not the param. The active label comparison `l === labelFilter` renders `escapeHtml(l)` (from the task-data side, not from `labelFilter`).
- `buildHref()` embeds params into URLs only via `URLSearchParams.set()`, which encodes them as valid URL parameters — never via string concatenation into HTML attribute values. The `href="..."` URLs are produced by template literal interpolation of the already-URL-encoded `params.toString()` result; this is not HTML injection (URL-encoding protects the attribute context, and `buildHref` returns a path like `/?status=foo&sort=bar` which is used in `href="..."` — the `"` delimiters in the HTML template are the enclosing quotes, not injected by the params).

One subtle point reviewed carefully: the `labelNav` conditional in the template — `${labelNav ? html`<p class="meta">Label: ${labelNav}</p>` : ""}` — renders `labelNav` as already-computed HTML. The `labelNav` string is composed of `html`...`` tagged template literals with `escapeHtml(l)` applied to every label value from task data. No raw user input reaches the HTML output. CONFIRMED SAFE.

### 4. `buildHref()` correctness

**PASS** with non-blocking note.

The function at lines 335–342:
```js
function buildHref(status, sort, label) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (label) params.set("label", label);
  if (sort) params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}
```

Correctly composes all three filters. Falsy guards (`if (status)`, `if (label)`, `if (sort)`) correctly skip null/undefined/empty params. `buildHref(null, null, null)` → `"/"`. `buildHref("todo", "id", "alpha")` → `"/?status=todo&label=alpha&sort=id"`. Preservation: filterNav calls `buildHref(null, sortKey, labelFilter)` and `buildHref(s, sortKey, labelFilter)` — both correctly carry the active sort and label through. sortNav calls `buildHref(statusFilter, ...)` — correctly carries the active status filter. labelNav calls `buildHref(statusFilter, sortKey, ...)` — correctly carries the active status and sort.

**Non-blocking note**: The URL parameter order inside `buildHref` is `status` → `label` → `sort` (set in that order). This produces `/?status=todo&label=alpha&sort=id` rather than the arguably more natural `/?status=todo&sort=id&label=alpha`. This is purely cosmetic — `URLSearchParams` order does not affect behavior, and the server reads each param individually. No action required. (The executor's inline audit also noted this; confirming independently.)

### 5. Sort correctness — determinism, null/undefined edge cases

**PASS**

Sort-by-id (lines 309–310):
```js
tasks = filtered.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
```
Lexicographic string comparison. Deterministic: for any two distinct IDs (IDs are strings by quay schema), exactly one of `a.id < b.id` or `a.id > b.id` is true. Zero case is only for identical IDs (same task, cannot appear in a de-duplicated task list). `.slice()` avoids mutating `filtered` or `allTasks`.

Sort-by-status (lines 311–315):
```js
tasks = filtered.slice().sort((a, b) =>
  a.status < b.status ? -1 : a.status > b.status ? 1 :
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0
);
```
Primary sort by status string (lexicographic), tiebreaker by id. Deterministic: if status strings are equal, id comparison is applied, and since IDs are unique, the tiebreaker always resolves. The zero case is only reachable if two tasks have both the same status AND same id — impossible in a valid task list. `.slice()` used correctly.

**Null/undefined status edge case**: `a.status` and `b.status` are task fields. If either is `null` or `undefined`, the string comparisons (`<`, `>`) will produce falsy results for both branches (since `null < "todo"` is `true` in JS but `null > "todo"` is `false`). Specifically: `null < "any-string"` is `true` in JS (null coerces to 0, string to NaN... actually: `null < "todo"` evaluates to `false` because string-to-number gives NaN). Let me trace more carefully:

- `null < "todo"` → `false` (null coerces to 0, "todo" coerces to NaN; NaN comparison is false)
- `null > "todo"` → `false` (same)

This means two tasks both with `null` status would compare as `0` (equal on status), falling through to id tiebreaker — correct. A task with `null` status vs. a task with a real status string would also produce `false < false` → `0` on the status comparison, again falling through to id. This could produce an implementation-defined ordering for null-status tasks relative to non-null-status tasks, but it will not crash or produce undefined behavior. The quay task schema requires `status` to be a string (all providers set it), so null status is not an expected real-world case; the edge case is tolerated correctly.

**Verdict: deterministic for all well-formed tasks; gracefully stable (no crash) for null-status edge cases.**

### 6. Label filter correctness — null-safe check, multi-value, no-labels-field tasks

**PASS**

Lines 301–303:
```js
const filtered = labelFilter
  ? filteredByStatus.filter((t) => Array.isArray(t.labels) && t.labels.includes(labelFilter))
  : filteredByStatus;
```

- `Array.isArray(t.labels)` guard: handles `t.labels = undefined` (field absent), `t.labels = null`, `t.labels = "string"` (non-array scalar), `t.labels = 42` — all return `false` from `Array.isArray`, short-circuiting and correctly excluding the task.
- `t.labels.includes(labelFilter)`: called only when `Array.isArray` is true, so no TypeError risk. Does exact string equality on each element.
- Multi-value label arrays (e.g., `["alpha", "beta"]`): `includes("alpha")` returns `true`, correctly matching. Verified by LBL-3 fixture and its tests.
- Unknown label (e.g., `?label=gamma`): no tasks have `t.labels.includes("gamma")` true → empty result, 200 response. Not an error. Confirmed by test.
- Tasks with no labels field (e.g., WUI-1, WUI-ACT): `Array.isArray(undefined)` → `false` → excluded. Confirmed by test assertion (WUI-1 excluded when `?label=alpha` active).

**Label collection for nav (line 333)**:
```js
const allLabels = [...new Set(allTasks.flatMap((t) => Array.isArray(t.labels) ? t.labels : []))].sort();
```
Same null-safety pattern: `Array.isArray` guard returns `[]` for tasks without labels, so `flatMap` produces no entries for them. `new Set` deduplicates. `[...new Set(...)]` produces an Array (Set has no `.sort()`). `.sort()` on the Array is correct. Distinct labels are sorted lexicographically. Confirmed.

### 7. Heading-order fix — semantic correctness, accessibility

**PASS** with non-blocking note.

The `<h2 class="sr-only">Details</h2>` is inserted at line 427, between the action buttons `<div>` and the `.body` div. The `.body` div contains `renderMarkdown(t.body)` output, which maps `##` → `<h3>`, `###` → `<h4>` (see `renderMarkdown` line 192: `const lvl = hm[1].length + 1`). Without this fix, the heading hierarchy on the detail page was: `<h1>` (page title) → `<h3>` (from `## Proposal` in task body) — skipping h2, which Lighthouse flags as a heading-order violation (accessibility).

With the fix: `<h1>` → `<h2 class="sr-only">Details</h2>` → `<h3>` — the hierarchy is contiguous. The `.sr-only` CSS class uses the W3C-approved visually-hidden pattern (position:absolute, 1px×1px, clip, white-space:nowrap, overflow:hidden, border:0), which hides the element visually while keeping it in the accessibility tree. Screen readers and Lighthouse's heading-order checker both see it.

**Non-blocking note**: the `<h2 class="sr-only">Details</h2>` element is inserted AFTER the action-button `<div>` (line 426) but BEFORE the `.body` div (line 428). Semantically, the h2 labels the content below it (the rendered markdown body), which is correct. However, the action buttons that appear ABOVE the h2 in the DOM are not labeled by any heading — they are effectively in their own unlabeled section. This is a minor semantic imperfection but not an accessibility defect: buttons are self-labeled by their text content, and the detail page is simple enough that the overall structure is clear. Not blocking.

### 8. Mobile CSS — scrollability, layout side effects

**PASS** with non-blocking note.

The `@media (max-width: 600px)` block (lines 126–130):
```css
@media (max-width: 600px) {
  main { padding: 1rem 0.75rem; }
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  th, td { padding: 0.45rem 0.6rem; font-size: 0.85rem; }
}
```

`table { display: block }` converts the table from a table formatting context to a block formatting context at narrow widths. This is the standard technique for making HTML tables horizontally scrollable on mobile: the table becomes a block-level scroll container, and `overflow-x: auto` enables horizontal scroll when cell content exceeds the container width. `-webkit-overflow-scrolling: touch` enables momentum-based touch scrolling on iOS (a Safari-specific enhancement; benign on other browsers). `th, td` padding/font-size reduction adapts cell density for smaller viewports.

The outer `<main>` container's `max-width: 900px` and `margin: 0 auto` are unchanged by the media query (only `padding` is adjusted), so the centering behavior is preserved on narrow screens.

**Potential side effect reviewed**: The top-level table CSS already includes `overflow: hidden` and `border-radius: 6px` (lines 63–64). When `display: block` overrides the table context in the media query, the `overflow: hidden` on the table element itself may clip the outer rounded corners. This is an existing minor visual issue on mobile that the media query does not introduce (it exists under the static CSS too, just at narrower widths). Not a regression introduced by QW-006; not blocking.

**Non-blocking note**: `.meta a { text-decoration: underline }` (line 93) is listed in the QW-006 description as an accessibility fix (Lighthouse underline requirement for links). Verified present in `pageStyles()`. This is a non-media-query addition that applies globally to `.meta` links (the filter, sort, and label nav links). This is correct and needed — the base `a` rule sets `text-decoration: none`, which Lighthouse flags for links not otherwise distinguishable by color alone.

### 9. Test coverage adequacy

**PASS**

Tests reviewed in `web-ui-browser.test.mjs` for QW-004, QW-005, QW-006:

**QW-004 (sort)**:
- Sort nav presence in GET / (lines 501–504): checks for `sort=id` and `sort=status` links — confirms nav rendered.
- `GET /?sort=id` order: indexOf checks confirm SORT-A < SORT-B < SORT-C in HTML (lines 512–515).
- `GET /?sort=status` order: indexOf checks confirm SORT-B(done) < SORT-C(ready) < SORT-A(todo) (lines 523–527) — correct alphabetical-by-status order.
- Combined `GET /?status=todo&sort=id` (lines 531–539): confirms filter-then-sort composition; SORT-A < WUI-1 (S < W alphabetically).
- Sort nav href preservation (lines 543–545): confirms `sort=id` appears in `?status=todo` response (nav link preserves status filter).

The sort tests use distinct tasks inserted in non-alphabetical order (C, A, B) specifically to prove sort overrides insertion order. This is a meaningful, not a smoke test.

**QW-005 (label filter)**:
- Label nav presence (lines 553–554): checks for `label=alpha` in GET / response.
- `GET /?label=alpha`: includes LBL-1 (alpha), LBL-3 (alpha+beta); excludes LBL-2 (beta only) (lines 557–564).
- `GET /?label=beta`: includes LBL-2 (beta), LBL-3 (alpha+beta); excludes LBL-1 (alpha only) (lines 566–574).
- `GET /?label=gamma`: 200 response, no LBL-* tasks (unknown label graceful empty) (lines 576–581).
- Combined `GET /?status=todo&label=alpha`: LBL-1 and LBL-3 included; LBL-2 (done, excluded by status), WUI-1 (todo but no labels, excluded by label filter) (lines 583–594).

Tests cover the null-label case (WUI-1 excluded by label filter), multi-value label case (LBL-3), unknown label graceful empty, and combined filter composition. Adequate.

**QW-006 (heading-order + mobile CSS)**:
- `<h2 class="sr-only">Details</h2>` presence in detail page (line 601): structural test.
- `.sr-only` CSS rule in pageStyles (lines 605–606).
- `@media` and `max-width` in pageStyles (lines 608–610).
- `overflow-x: auto` or `overflow-x:auto` in pageStyles (lines 612–614).

These are structural HTML/CSS presence checks, not behavioral browser rendering tests. They correctly catch regressions in `serve.js` that would break these elements. The limitation (no live browser render tested) is inherent to the "no browser npm dependency" G5 constraint and is acknowledged in the test file's header comment. Non-blocking.

**One gap not covered**: no test verifies that `buildHref(statusFilter, sortKey, null)` generates the "All" link in `labelNav` when a label filter is active, or that the label nav renders with the active label as `<strong>` and others as links. The tests check nav presence but not the active-state rendering detail. Non-blocking (the logic is simple and the structural pattern is the same as filterNav which was tested in QW-003).

### 10. G5 preserved — no external dependency introduced

**PASS**

Reading the full `serve.js` file: no new `import` statements. `URLSearchParams` is a Node.js builtin global (available since Node.js 10.x without import). `Set`, `Array.isArray`, `Array.prototype.flatMap`, `Array.prototype.includes`, `Array.prototype.sort` are all standard ECMAScript — no polyfills needed in any modern Node.js version. The file remains self-contained: one file, no build step, no npm modules beyond those already in package.json (confirmed: no package.json modification in this iteration's scope).

### 11. Backward compatibility — existing test assertions still pass

**PASS**

Reviewed all pre-existing test assertions in `web-ui-browser.test.mjs` (lines 235–415 — QC-001, QC-002, QW-001, QW-002, QW-003 sections) against the current `serve.js`:

- GET / still returns 200 with `<title>Quay — ...`, `<h1>... task list ...`, task rows, task links.
- GET /task/WUI-1 still returns 200 with `<title>WUI-1`, `[todo]`, role paragraph, "Advance" button.
- GET /task/WUI-2 still returns 200 with `[done]`, no button.
- GET /task/NONEXISTENT-999 still returns 404.
- Content-Type still declares `charset=utf-8`.
- POST /task/WUI-ACT/action/advance still returns 302 with correct Location.
- `<style>` tag, `border="1"` absence, `<main>`, `<nav>`, viewport meta, `lang="en"` — all unchanged.
- `<div class="body">`, `<h3>Proposal</h3>`, `<h3>Plan</h3>`, `<li>` in body — renderMarkdown unchanged.
- `/?status=todo` and `/?status=done` filter links present in GET / — filterNav still rendered.
- Status filter tests (QW-003): all three status-filter paths unchanged in behavior.

The `filteredByStatus` → `filtered` → `tasks` pipeline correctly chains QW-003 (status), QW-005 (label), QW-004 (sort) in the right order: status filter first, then label filter, then sort. The default (no params) case: `statusFilter = null` → `filteredByStatus = allTasks`; `labelFilter = null` → `filtered = allTasks`; `sortKey = null` → `else { tasks = filtered }` → insertion order. Identical to pre-QW-004/QW-005 behavior.

---

## Findings the Executor's Inline Audit Did Not Surface

1. **The mobile table `overflow: hidden` + `border-radius` interaction** (criterion 8 note): the outer table CSS sets `overflow: hidden` + `border-radius: 6px`, and the mobile `display: block` override will affect how border-radius renders on the table element at narrow widths. This is a pre-existing minor visual quirk, not a regression introduced by QW-006, but it was not called out in the executor's audit. Non-blocking.

2. **Null-status JavaScript coercion behavior** (criterion 5 note): the `<` / `>` comparators on potentially-null status values involve non-obvious JS coercion rules (null vs. string comparison evaluates to false on both sides due to NaN semantics). The executor's audit noted sort stability but did not trace the specific null coercion path. The result is still stable (gracefully produces consistent ordering for null-status tasks), but the specific coercion path was not verified by the executor. Non-blocking — null status is not a valid real-world task state per the quay schema.

3. **Test gap: active-label-nav rendering** (criterion 9 note): no test verifies the active label nav renders `<strong>alpha</strong>` when `?label=alpha` is active and other labels as `<a href="...">`. The executor's audit assessed coverage as PASS without calling out this specific gap. Minor omission; non-blocking given the pattern is structurally identical to filterNav (tested in QW-003).

---

## Non-Blocking Notes (Summary)

1. `buildHref()` URL parameter order is `status → label → sort` rather than the arguably more natural `status → sort → label`. Valid and functional; purely cosmetic. (Also noted by executor.)
2. The `<h2 class="sr-only">Details</h2>` is positioned after the action buttons, leaving the button section unlabeled by any heading. Semantically imperfect but not an accessibility defect; buttons are self-labeled.
3. Mobile `table { display: block }` combined with existing `overflow: hidden; border-radius: 6px` may cause minor border-radius clipping on narrow viewports. Not a QW-006 regression.
4. Test coverage does not verify active-label nav rendering (active label as `<strong>`, others as `<a>`). Non-blocking given structural pattern match to the tested filterNav.

---

## Conclusion

QW-004, QW-005, and QW-006 are functionally correct, HTML-injection safe, scope-boundary compliant, backward compatible, and covered by adequate (if not exhaustive) tests. G5 is preserved. The executor's inline self-assessment is accurate on all material claims. The three independent findings above are all non-blocking and do not affect the verdict.

**This audit supersedes `iteration-3-adjudicate.md` as the authoritative G3 verdict for iteration 3.**
