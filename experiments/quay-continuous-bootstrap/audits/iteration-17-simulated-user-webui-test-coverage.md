# Simulated User: Web UI test-coverage verifier — Iteration 17

## TST-001: pageSize in nav links

PASS — assertion found at `serve.test.mjs` lines 1562–1565:

```js
assert(
  body.includes("pageSize=3"),
  `GET /?pageSize=3 carries pageSize=3 in page nav links (TST-001, iteration 17). body excerpt: ${body.slice(0, 800)}`
);
```

The test fetches `/?pageSize=3` against a fixture of 8 tasks. With 3 tasks per page and 3 pages total, a "Next" link is rendered; `buildHref` at serve.js lines 683–684 calls `buildHref(…, safePage + 1, …)` without a `pszOverride`, so `effectivePsz` defaults to `pageSizeFilter` (3), and `params.set("pageSize", "3")` is added (line 548 — non-default values only). The assertion `body.includes("pageSize=3")` will match the href.

**Weak-spot noted:** The assertion is a substring check on the full body — it would pass even if "pageSize=3" appeared in the page-size-selector links (e.g. a link switching *to* size 3) rather than specifically in the prev/next pagination link. The test does not anchor the check to the `Next` link's href. This is a low-severity gap in assertion precision, not a correctness failure.

## TST-002: active size bolded

PASS — two-part assertion found at `serve.test.mjs` lines 1574–1583:

```js
assert(
  body.includes("<strong>10</strong>"),
  `GET /?pageSize=10 renders <strong>10</strong> as active page size in pageSizeNav (TST-002, iteration 17). body excerpt: ${body.slice(0, 800)}`
);
// The default (20) should NOT be bold since a different size is active
const strongMatch = body.match(/<strong>(\d+)<\/strong>/g);
assert(
  strongMatch && strongMatch.some(m => m.includes(">10<")),
  `GET /?pageSize=10 has <strong>10</strong> in pageSizeNav (TST-002). found: ${JSON.stringify(strongMatch)}`
);
```

The second part (regex match) is strictly redundant given the first (`body.includes("<strong>10</strong>")` already implies `strongMatch.some(m => m.includes(">10<"))`), but both pass.

## Source verification

**pageSizeNav bold-wrapping (serve.js lines 729–734):**

```js
const pageSizeOptions = [10, 20, 50, 100];
const pageSizeNav = html`<p class="meta">Per page: ${pageSizeOptions.map((n) =>
  n === pageSizeFilter
    ? html`<strong>${n}</strong>`
    : html`<a href="${buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, qFilter, n)}">${n}</a>`
).join(" · ")}</p>`;
```

Confirmed: the active size is wrapped in `<strong>`, exactly matching TST-002's expectation.

**prev/next links carry pageSize (serve.js lines 677–686):**

```js
const pageNav = totalPages > 1 ? html`
  <p class="meta">
    ${safePage > 1
      ? html`<a href="${buildHref(statusFilter, sortKey, labelFilters, safePage - 1, prefixFilter, qFilter)}">&laquo; Previous</a>`
      : html`<span class="page-nav-disabled">&laquo; Previous</span>`}
    &nbsp; Page ${safePage} of ${totalPages} (${totalTasks} tasks) &nbsp;
    ${safePage < totalPages
      ? html`<a href="${buildHref(statusFilter, sortKey, labelFilters, safePage + 1, prefixFilter, qFilter)}">Next &raquo;</a>`
      : html`<span class="page-nav-disabled">Next &raquo;</span>`}
  </p>` : html`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>`;
```

`buildHref` is called without `pszOverride`, so `effectivePsz = pageSizeFilter` (the active page size). Line 548: `if (effectivePsz && effectivePsz !== 20) params.set("pageSize", String(effectivePsz));` — the pageSize param is carried in the href whenever it differs from the default of 20. TST-001 uses `?pageSize=3`, which is non-default, so the Next link href will contain `pageSize=3`. Confirmed correct.

**Note on TST-002 fixture:** The test fetches `/?pageSize=10` against the same 8-task fixture. With 10 tasks per page and only 8 tasks, `totalPages = 1` — no prev/next navigation is rendered. The pageSizeNav is always rendered (unconditionally), so `<strong>10</strong>` still appears in the output. TST-002 passes correctly. However, the comment in the test ("When viewing page 1 of a paginated result") is slightly misleading since there is no pagination when using pageSize=10 with 8 tasks — though the assertion itself is valid.

## New gaps

1. **TST-001 assertion is underspecified.** `body.includes("pageSize=3")` matches any occurrence of the string in the entire HTML body — including the page-size-selector link for 3 (if 3 were a selector option), search form hidden inputs, or other contexts. The test should assert that a `Next` link specifically contains `pageSize=3`, e.g. by checking `body.includes('href="/?page=2&pageSize=3"')` or similar.

2. **TST-001 does not verify the Previous link also carries pageSize.** Only the Next link is implicitly tested (and only by substring, as above). A test on page 2 checking that the "Previous" link carries pageSize would fully cover both directions.

3. **TST-002 comment says "paginated result" but uses a non-paginated fixture.** The active-bold behavior is independent of pagination, so this is not a functional problem, but the comment is misleading and may confuse future readers.

4. **pageSize=20 (the default) is excluded from the href by `effectivePsz !== 20`.** If a user explicitly clicks a "20" size link, the URL becomes clean (`/`) — which is correct UX. But if they navigate to `/?pageSize=20` manually, the pageSizeNav for 20 renders as `<strong>20</strong>` (correct), while the Next/Prev links drop `pageSize` from the href (also correct — default is implicit). No bug, but worth knowing there is no test covering `?pageSize=20` explicitly.

## Overall verdict

PARTIAL — Both TST-001 and TST-002 assertions are present and will pass against the correct serve.js implementation. The source matches what the tests assert. However, TST-001's assertion precision is weak (substring match on full body rather than anchored to the Next link href), and neither test covers the Previous link direction. The implementation itself is correct.
