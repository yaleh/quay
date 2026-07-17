# G3 Audit — Iteration 12

**Date**: 2026-07-17
**Auditor**: G3 independent reviewer
**Result**: PASS

---

## QX-044 (SH-005 — mcp-server.js stripHeadings sync): PASS

**Implementation review** (`packages/quay/src/mcp-server.js` lines 172–179):

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

**Byte-identical** to the canonical implementation in `serve.js` lines 39–46. The state machine is correct:

- Fence toggle: `/^```/` matches any opening or closing fence line, flips `inFence`, and the fence line itself is **kept** (`return true`) — prevents the fence delimiter itself from triggering any heading strip if it started with `#` (degenerate case).
- Inside fence: `if (inFence) return true` short-circuits before the heading pattern, preserving all content including `# comment` lines.
- Outside fence: `/^#+\s/` strips lines that are structural headings (one or more `#` followed by a space).

**Edge case analysis**:
- Unclosed fence: `inFence` stays `true` to end of text — all lines after the opening `` ``` `` are preserved. This is the correct fallback (treat rest of body as code content rather than risk stripping valid content).
- Multiple fences: state correctly toggles back off on the closing `` ``` `` and back on again for subsequent fences. Verified by the logic: each `` ``` `` line flips the boolean.
- Empty/null input: `(text || "")` guard handles null/undefined cleanly.

**Test coverage** (Block 19, `mcp-server.test.mjs` lines 1263–1337):

- **FENCE-1** (positive): body has `` ```bash\n# bash-comment-token\necho hello\n``` `` — search for `bash-comment-token` **must find** FENCE-1. Directly targets the SH-005 regression (hash inside fence was stripped before the fix).
- **FENCE-2** (negative): body has `## Proposal-outside-fence` as a heading outside any fence — search for `Proposal-outside-fence` must **not find** FENCE-2. Regression-locks that the heading-strip behavior for genuinely structural headings is not broken by the inFence addition.

Both positive and negative arms are present and clearly targeted. Coverage is sufficient.

---

## QX-045 (CB-020 — JSON path regression test): PASS

**Implementation check** (`packages/quay/bin/quay.js` lines 239/243):

```js
if (flags.json) {
  printJson(sorted);      // line 239 — JSON path: only emits JSON array
} else {
  if (prefix) console.log(`# filtered: ...`);  // line 243 — non-JSON path only
  ...
}
```

The `# filtered:` comment is structurally inside the `else` branch. The `--json` path calls `printJson(sorted)` with no surrounding comment output. This invariant was always present in the code — CB-020 was correctly diagnosed as a testing gap, not a real bug.

**Test coverage** (Section 22, `cli.test.mjs` lines 1404–1482):

Three arms:

(a) `--prefix QX --json`: asserts `JSON.parse(r.stdout)` succeeds and returns an array including `QX-T1`. Any leading `# filtered:` comment would break `JSON.parse()` and trigger the assertion. Correct and sufficient.

(b) `--json` without prefix: baseline — verifies the no-prefix JSON path also produces valid JSON with 2 tasks.

(c) `--prefix QX` without `--json`: confirms the `# filtered:` comment IS present in human-readable output (the invariant does not accidentally suppress the comment in non-JSON mode either).

All three arms are meaningful. The test correctly regression-locks the branching invariant without over-specifying the implementation.

**Note on "no bug found"**: The test correctly documents that CB-020 was a testing-gap issue, not a behavioral regression. The test added value anyway — it locks the existing correct behavior against future refactors that could accidentally add pre-JSON logging to the `--json` path.

---

## QX-046 (UQ-035 — search banner page indicator): PASS

**Implementation** (`packages/quay/src/serve.js` lines 709–711):

```js
const searchResultBanner = qFilter
  ? html`<p class="meta" style="color:#0066cc">Showing ${totalTasks} results for &ldquo;${escapeHtml(qFilter)}&rdquo;${totalPages > 1 ? ` · Page ${safePage} of ${totalPages}` : ""}</p>`
  : "";
```

**Correctness analysis**:

- Condition `totalPages > 1`: correctly absent when all results fit on one page; present only when pagination is active. The `""` (empty string) alternative means no suffix when single-page — correct.
- `safePage`: the already-clamped page number (`Math.min(page, totalPages)` at line 466), so it's always in `[1, totalPages]` — no underflow/overflow.
- `totalPages`: `Math.max(1, Math.ceil(totalTasks / PAGE_SIZE))` — always ≥ 1. When `totalTasks > 0` and results span multiple pages, this is the correct total.
- Both `safePage` and `totalPages` are integers computed from internal arithmetic, not user input. No XSS risk: they are not passed through `escapeHtml()` (correctly — integers cannot contain HTML characters).
- `totalTasks` is the count of *filtered* tasks (before pagination), so "Showing N results" still correctly counts the full matched set, not just the page.

**Test coverage** (QX-046 block, `serve.test.mjs` lines 1393–1483):

- **25 tasks** seeded — PAGE_SIZE=20, so 25 tasks yields `totalPages=2`. The fixture is correctly designed to force `totalPages > 1`.
- Page 1 assertion: `page1Resp.body.includes("Page 1 of 2")` — verifies both the correct page number and total.
- Page 2 assertion: `page2Resp.body.includes("Page 2 of 2")` — verifies the suffix updates on page change.
- Single-page negative: `PGSRCH-SINGLE` task with unique title `"xyzzy-qx46-unique-singleton"` added; search returns 1 result → `totalPages=1` → banner should have **no** page indicator. The test extracts the banner element using a CSS-attribute regex (`color:#0066cc`) and asserts neither `"Page"` nor `"·"` appears in it. This correctly isolates the banner from the page-nav `<p>` element (which also renders "Page 1 of 1 (N tasks)").

**Minor observation**: The regex `/<p[^>]*color:#0066cc[^>]*>([^<]*)<\/p>/` assumes the banner paragraph has no child elements. Inspecting the implementation: the banner is `html\`...\`` with a template literal containing `&ldquo;`, `&rdquo;`, `·` (literal), and `escapeHtml(qFilter)` — so if `qFilter` contains `<` or `>` characters, `escapeHtml()` would produce child entities that are still just text nodes (not elements). The regex still matches because `[^<]*` stops before any `<`. No false-negative risk for normal search queries. No false-positive risk either, because `color:#0066cc` is unique to this banner in the rendered HTML.

---

## Test suite: 30/30 PASS

```
ℹ tests 30
ℹ pass  30
ℹ fail  0
```

All packages (quay, quay-native, quay-github) pass including the new Block 19 (QX-044), Section 22 (QX-045), and QX-046 blocks.

---

## Overall verdict

**PASS** — no findings requiring remediation.

QX-044: PASS
QX-045: PASS
QX-046: PASS

σ_QX update: 39/40 → 42/43 = 0.977 (all three new QX units pass their own tests and the full suite is green)
