# Simulated User: Web UI pagination user — Iteration 16

## Approach

Primary method: source-code reading of the worktree serve.js at
`experiments/quay-continuous-bootstrap/worktrees/iteration-16/packages/quay/src/serve.js`
and the test file at
`experiments/quay-continuous-bootstrap/worktrees/iteration-16/packages/quay/test/serve.test.mjs`.

Live UI check: The server at `http://localhost:4173/` does NOT reflect the
iteration-16 changes — `curl http://localhost:4173/` returns no "Per page:"
text and `?pageSize=5` has no effect. The shared-tree serve.js (not the
worktree version) is running. All functional findings are therefore source-only.

---

## Findings

### pageSizeNav rendering

PASS

The `pageSizeNav` is rendered at line 730–734:

```js
const pageSizeOptions = [10, 20, 50, 100];
const pageSizeNav = html`<p class="meta">Per page: ${pageSizeOptions.map((n) =>
  n === pageSizeFilter
    ? html`<strong>${n}</strong>`
    : html`<a href="${buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, qFilter, n)}">${n}</a>`
).join(" · ")}</p>`;
```

This produces exactly `Per page: 10 · 20 · 50 · 100` with the active value
bolded (`<strong>`) and inactive values as `<a href="/?pageSize=N">` links
(the `null` for the `pg` argument resets to page 1 on size change, which is
correct). The nav is inserted into the list-page HTML at line 747 between the
sort nav and the search form.

---

### ?pageSize param parsing

PASS

Lines 463–470:

```js
const rawPageSize = parseInt(url.searchParams.get("pageSize") || "20", 10);
const PAGE_SIZE = (Number.isFinite(rawPageSize) && rawPageSize >= 1)
  ? Math.min(rawPageSize, 200)
  : 20;
const pageSizeFilter = PAGE_SIZE;
```

- Default: 20 (when `?pageSize` is absent or non-numeric)
- Minimum: 1 (enforced by `rawPageSize >= 1`; invalid values fall back to 20)
- Maximum: 200 (clamped via `Math.min(rawPageSize, 200)`)
- Validation: non-finite values (e.g., `?pageSize=abc`) fall back to 20

The default is reasonable; the 200-item cap prevents runaway memory on
large task stores.

One minor gap: `?pageSize=0` parses as 0, which fails `>= 1`, so it correctly
falls back to 20. `?pageSize=-5` similarly produces a negative value that
fails `>= 1`. Both edge cases are handled correctly.

---

### buildHref() pageSize propagation

PASS

`buildHref` (lines 538–551) carries `pageSize` to all navigation links:

```js
function buildHref(status, sort, label, pg, prefix, q, pszOverride) {
  ...
  const effectivePsz = pszOverride !== undefined ? pszOverride : pageSizeFilter;
  if (effectivePsz && effectivePsz !== 20) params.set("pageSize", String(effectivePsz));
  ...
}
```

When `pageSize` is 10, every call to `buildHref` without a `pszOverride`
(prev/next/filter/sort/label links) automatically carries `?pageSize=10`.
When navigating to page 2 at `?pageSize=10`, the `buildHref` call for the
"Next" link passes `pageSizeFilter` (10) and produces `/?page=2&pageSize=10`.

The default 20 is intentionally omitted from the URL (clean URLs when using
the default — `pageSize !== 20` guard at line 548). This is correct: 20 is
the stated default, so omitting it is equivalent to including it.

The `pageSizeNav` links pass `pszOverride = n` and `pg = null`, which resets
to page 1 when switching page size — appropriate behavior.

---

### Temporal dead zone fix

PASS

The comment at line 467–470 is accurate:

```
// pageSizeFilter must be declared BEFORE buildHref is called (even though buildHref
// is hoisted as a function declaration, the const reference inside it is evaluated
// at call time, and needs pageSizeFilter to be initialized by then).
const pageSizeFilter = PAGE_SIZE;
```

`buildHref` is a `function` declaration (line 538), hoisted within the
enclosing async arrow function scope. However, `pageSizeFilter` is a `const`
— it lives in the temporal dead zone until its initializer runs at line 470.
Since `buildHref` closes over `pageSizeFilter` but only reads it when *called*
(not when declared), there is no actual temporal dead zone hazard: by the time
any `buildHref(...)` call appears (line 487 onward), `pageSizeFilter` has
already been initialized at line 470.

The code ordering is: `pageSizeFilter = PAGE_SIZE` (line 470) → first
`buildHref()` call (line 487). This ordering is correct and the fix is valid.

---

### Test coverage (3 assertions)

PASS

The 3 new assertions are in the `QX-061` block (lines 1519–1553 of
serve.test.mjs). They use 8 freshly-created test tasks on an isolated port:

- **(a) line 1519–1531**: `GET /?pageSize=5` — asserts exactly 5 task rows
  are rendered (matching `/>PGSZ-0[0-9]<\/a>/g`). Tests that `pageSize` param
  actually limits the slice.
- **(b) line 1533–1542**: `GET /?pageSize=5&page=2` — asserts exactly 3 task
  rows remain (8 − 5 = 3). Tests that pagination + pageSize combine correctly.
- **(c) line 1545–1553**: `GET /` (default pageSize) — asserts `body.includes("Per page:")`.
  Tests that the nav is always rendered regardless of pageSize param.

The assertions are appropriate and meaningful. One minor gap: assertion (c)
does not verify the correct active value is bolded when `?pageSize=10` is
requested; it only confirms the nav string is present. The bold/active test
is implicit but not explicit. This is a minor coverage gap, not a blocker.

Also missing: no test that `buildHref` carries `pageSize` to prev/next links
(i.e., that `?pageSize=5&page=2` prev link contains `pageSize=5`). This would
catch a regression if `pageSizeFilter` stopped being included in `buildHref`.

---

## New gaps

1. **No test for pageSize propagation in page nav links**: no assertion checks
   that `<< Previous` / `Next >>` links contain `pageSize=N` when a non-default
   pageSize is active. A future refactor that dropped `effectivePsz` from
   `buildHref` would break user experience (users lose their page size on page
   turn) but the existing tests would not catch it.

2. **Active bold not verified for non-default sizes**: assertion (c) only
   checks `Per page:` string presence; no test verifies that `<strong>10</strong>`
   appears when `?pageSize=10` is active. If the `n === pageSizeFilter` branch
   broke silently, the nav would still render and (c) would still pass.

3. **Live server does not reflect iteration-16 changes**: the server at port
   4173 is running from the shared tree, not the worktree. Real users hitting
   the live server would not see the pageSizeNav. (This is an experiment
   infrastructure issue, not a code defect in the worktree.)

4. **`pageSizeFilter` omitted from `buildHref` when value is 20**: the
   `effectivePsz !== 20` guard produces clean URLs but means that a user who
   manually types `?pageSize=20` will not have that param carried forward
   (it gets silently dropped to `/`). This is a very minor cosmetic issue —
   behavior is identical — but could confuse a user who deliberately set
   `?pageSize=20` and sees it disappear from the URL.

---

## Overall verdict

PASS

All four targeted areas (pageSizeNav rendering, pageSize param parsing,
buildHref propagation, temporal dead zone fix) are correctly implemented.
The 3 test assertions cover the core behavior adequately. The new gaps
(#1 and #2) are coverage holes that would be worth adding in a follow-up
but do not represent functional defects in the current implementation.
