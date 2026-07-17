# G3 Audit — Iteration 11

**Date**: 2026-07-17
**Auditor**: G3 (independent out-of-band)
**Tasks audited**: QX-041, QX-042, QX-043
**Result**: PASS

---

## QX-041 (SH-003 — stripHeadings fence tracking)

### Implementation (`packages/quay/src/serve.js` lines 39–46)

```js
function stripHeadings(text) {
  let inFence = false;
  return (text || "").split("\n").filter((line) => {
    if (/^```/.test(line)) { inFence = !inFence; return true; }
    if (inFence) return true; // preserve code content (including # comment lines)
    return !/^#+\s/.test(line); // strip structural headings outside fences
  }).join(" ");
}
```

**State machine correctness**: The `inFence` toggle is applied on any line matching `/^```/`. Opening fence toggles `false → true`, closing fence toggles `true → false`. The fence delimiter line itself is always retained (`return true`). Content inside the fence is returned as-is via the `if (inFence) return true` guard. Lines outside the fence are stripped if they match `/^#+\s/`. This is correct for well-formed Markdown.

**Edge case analysis**:

| Case | Behavior | Correct? |
|---|---|---|
| `# comment` inside fence | Preserved (inFence=true) | YES |
| `## Heading` outside fence | Stripped (!/^#+\s/.test fails) | YES |
| Consecutive fences (open → close → open → close) | Each ``` toggles state correctly | YES |
| Unclosed fence at EOF | `inFence` remains true, all trailing lines preserved | ACCEPTABLE — more permissive than Markdown spec, but correct for search (no false exclusion) |
| Nested fences (``` inside ```) | Not standard Markdown; state machine treats second ``` as a close. Identical to `renderMarkdown()`'s behavior in the same file. | ACCEPTABLE — consistent with the parallel implementation |
| Empty input | `(text || "").split(...)` handles `null`/`undefined`/empty gracefully | YES |

**Consistency note**: `mcp-server.js` (line 167–169) has an **older copy** of `stripHeadings()` without the `inFence` fix — it still filters all `^#+\s` lines unconditionally. The mcp-server.js comment acknowledges the three-location duplication by design ("inlined here rather than imported because mcp-server.js is a separate entry point"). QX-041 updated `serve.js` and `bin/quay.js` (via the `serve.js` path — serve.js is the `startServer()` code path); the mcp-server.js copy was not updated. This is a **note**, not a blocker: Block 18 tests (QX-042) do not test fenced-code search through the MCP path, and MCP `task_list` search going through the old `stripHeadings()` is a pre-existing limitation documented in the header. A follow-up task (SH-003 parity for mcp-server.js) would be appropriate.

**Test coverage** (`serve.test.mjs` lines 1254–1331):

- Positive: `?q=bash-comment-token` finds `SH03-1` whose body has `` ` ``bash`` `` / `# bash-comment-token` inside a fence. Directly exercises the fix.
- Negative: `?q=Proposal-outside-fence` does NOT find `SH03-1` (heading outside fence still stripped). Regression guard for the original QX-028 behavior.
- Fixture is hand-written directly to the tasks dir (bypassing CLI creation), which correctly preserves the raw markdown without CLI rewriting the body.

**Verdict**: PASS. The implementation is correct for all realistic cases. The mcp-server.js copy gap is a known, pre-existing structural issue, not introduced by QX-041.

---

## QX-042 (SH-004 — pagination edge case tests)

### Tests (`mcp-server.test.mjs` Block 18, lines 1181–1261)

Three edge cases verified against the `mcp-server.js` implementation at lines 248–256:

```js
const pageNum = Math.max(1, parseInt(page) || 1);
const size = Math.min(200, Math.max(1, parseInt(pageSize) || 50));
const totalPages = Math.ceil(total / size);
```

**Case (a): `total=0` → `totalPages=0`**

- Assertion: `sc.totalPages === 0` when filtering by a non-existent status.
- Math: `Math.ceil(0 / 50) = 0`. No rounding or clamping; this is mathematically exact.
- The test comment correctly documents this as an API contract lock: if future code adds `Math.max(1, Math.ceil(...))`, this test catches the regression.
- **Assessment**: Correct assertion, correct mathematical derivation. PASS.

**Case (b): `pageSize=0` → treated as 50 (default), NOT 1**

- The expression `parseInt(0) || 50` evaluates: `parseInt("0")=0`, and `0 || 50 = 50` (0 is falsy in JS), so `Math.max(1, 50) = 50`.
- Assertion: `sc.pageSize === 50` — matches the actual code path.
- The test comment explicitly documents this behavior (0 is falsy → falls through to default 50, not clamped to 1 by `Math.max(1, ...)`).
- **Assessment**: The assertion correctly matches actual code behavior, not a hypothetical. The comment is honest about why (falsy 0). PASS.

**Case (c): `pageSize=201` → clamped to 200**

- `Math.min(200, Math.max(1, parseInt(201) || 50)) = Math.min(200, Math.max(1, 201)) = Math.min(200, 201) = 200`.
- Assertion: `sc.pageSize === 200` — correct.
- **Assessment**: PASS.

**False-positive risk**: All three assertions are derived from the actual runtime expression rather than a desired spec. They cannot produce spurious passes — they will fail precisely when the implementation diverges from the tested contract. Fixture uses 3 seeded tasks, large enough to distinguish "all tasks returned" from "empty page."

**Schema check**: Block 18 does not repeat the schema assertions (`page`/`pageSize` in `listTools()`) already locked by Block 15. This is correct — there is no point duplicating existing coverage.

**Verdict**: PASS. Assertions are internally consistent with the implementation, and the documented contract (especially `totalPages=0` for empty results) is now test-locked.

---

## QX-043 (UQ-030/006/007 — mobile layout)

### Changes

1. **HTML order** (`serve.js` lines 718–720): `${searchForm}` and `${searchResultBanner}` now appear before `${labelNav ? html`<div class="label-nav-wrap">...` }`. Previously, the label nav was rendered before the search form.

2. **CSS** (`serve.js` lines 200–209): New `.label-nav-wrap` rule with `overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap; padding-bottom: 0.2rem; margin-bottom: 0.25rem`.

**HTML order impact on CSS selectors**: The list page does not use CSS sibling combinators (`+`, `~`) or structural pseudo-selectors (`:nth-child`, `:first-of-type`) on the search form or label nav container. All CSS rules target class names (`.label-nav-wrap`, `.meta`, `.error-banner`, etc.) independently. Reordering does not affect any existing CSS rule.

**HTML order impact on JS**: No client-side JavaScript exists in this file (no `<script>` tags, no JS that queries DOM structure). The order change is purely cosmetic/layout.

**XSS analysis for `.label-nav-wrap` content**: The `labelNav` string is built via `escapeHtml()` on all user-controlled data (label names from `t.labels`). The `href` attributes use `buildHref()` which constructs URLs from sanitized `URLSearchParams`. The `countBadge` (` (N)`) is an integer from `labelCounts.get(l) || 0` — cannot contain markup. The `<details>`/`<summary>` elements in the overflow section also go through the same escaping pipeline. No new XSS vector is introduced.

**`overflow-x: auto` on `.label-nav-wrap`**: This is a layout property; it has no XSS implications regardless of content. The relevant XSS protection is at the HTML generation layer, which is unchanged.

**Test coverage** (`serve.test.mjs` lines 1333–1391):

- Asserts `name="q"` position precedes `<div class="label-nav-wrap">` in HTML body (not the CSS block, which would appear earlier — the test correctly uses the DOM element's opening tag, not the style rule).
- Asserts `.label-nav-wrap` div is present in the page.
- Fixture creates a task with a label so the label nav actually renders (without a labeled task, `labelNav` is null and the div is omitted).

The test for HTML ordering is correctly implemented: it searches for the label nav div opening tag (`<div class="label-nav-wrap">`) not the CSS class name (which appears in `<style>` before the `<body>` content). This avoids the false-pass trap.

**Verdict**: PASS. No CSS selector regressions, no XSS vector, test correctly distinguishes HTML-body position from style-block position.

---

## Test suite

```
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 53465
```

30/30 tests pass. The three new test blocks (QX-041 in serve.test.mjs, QX-042 Block 18 in mcp-server.test.mjs, QX-043 in serve.test.mjs) all pass without regression to any prior block.

---

## Overall verdict

**PASS-WITH-NOTES**

All three tasks are correctly implemented and tested. No blockers.

**Notes** (non-blocking, for future iterations):

1. **mcp-server.js `stripHeadings()` not updated**: The copy in `mcp-server.js` (line 167–169) still uses the pre-QX-041 implementation without `inFence` tracking. This means MCP `task_list?search=...` will still miss `# comment` tokens inside fenced code blocks. The architectural reason (no cross-entry-point imports) is documented and intentional, but the parity gap is now wider. A follow-up SH-003-parity task for `mcp-server.js` is warranted.

2. **`totalPages=0` contract**: The API contract that `total=0` → `totalPages=0` (not `totalPages=1`) is now test-locked, which is the correct outcome of QX-042. Callers of the MCP API should be aware that `totalPages=0` is the canonical empty-result signal.

---

## σ_QX co-sign

QX-041: PASS
QX-042: PASS
QX-043: PASS

σ_QX update: 36/37 → 39/40 = 0.975
