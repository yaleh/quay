# G3 Out-of-Band Audit: Iteration 1 — QW-001 + QW-002

**Date**: 2026-07-17
**Auditor**: Orchestrator (independent adversarial pass — not the session that authored/executed the tasks)
**Dispatcher**: Orchestrator, native session (not manda — per §0b G3 exclusion)
**Scope**: packages/quay/src/serve.js (QW-001: pageStyles(), QW-002: renderMarkdown() + inlineMarkdown()), packages/quay/test/web-ui-browser.test.mjs (new assertions), packages/quay/test/core-three-way-symmetry.test.mjs (updated body assertion)
**Verdict**: PASS (with one recorded CONCERN — not blocking, but tracked)

---

## Claims under audit

1. **QW-001**: pageStyles() function adds a consistent CSS system applied to all reachable pages via `<style>` block in `<head>`. Table `border="1"` removed. `<main>` wrapper, `<nav>` back-link, `lang="en"`, viewport meta tag added. No external dependency.

2. **QW-002**: renderMarkdown() replaces bare `<pre>${escapeHtml(t.body)}</pre>` on the detail page. Handles ATX headings, fenced code blocks, unordered/ordered lists, horizontal rules, paragraph breaks, bold/italic/inline-code. No external dependency.

3. **Test coverage**: New assertions in web-ui-browser.test.mjs verify structural properties of QW-001 and QW-002. core-three-way-symmetry.test.mjs updated to use rendered text content rather than raw markdown.

4. **Backlog health**: 30/30 tests pass after both changes.

---

## Adversarial checks

### A. Write-surface boundary (§0c scope constraint)
No new write surface was introduced. The POST /task/:id/action/:actionId route is unchanged. No form fields for task editing. No new `<input>` or `<textarea>` elements. The detail page's new `<div class="body">` is purely read-only rendered content. CONFIRMED: scope boundary preserved.

### B. "Core stays dumb" (no backend-specific rendering)
No `if backend === 'github'` or hardcoded per-backend conditional present anywhere in the diff. pageStyles() and renderMarkdown() are provider-agnostic utility functions. CONFIRMED: Core stays dumb.

### C. renderMarkdown() HTML injection safety
Key question: does renderMarkdown() safely handle task bodies that contain HTML characters (e.g. `<script>`, `>`, `&`)?

Review:
- The `inlineMarkdown()` function processes segments split by backtick spans. For non-code segments, it calls `escapeHtml(part)` FIRST before applying `**bold**` and `*italic*` regex replacements.
- The `**bold**` regex replacement inserts `<strong>$1</strong>` where `$1` is the capture from the already-HTML-escaped string. This is safe — the bold pattern only matches `**...**` after HTML escaping, so `<script>` would become `&lt;script&gt;` and would not match the bold pattern.
- ATX headings: `escapeHtml(hm[2].trim())` — SAFE.
- Fenced code blocks: `escapeHtml(fenceBuf.join("\n"))` — SAFE.
- List items: delegated to `inlineMarkdown(item)` which escapes first — SAFE.
- Paragraph text: `inlineMarkdown(text2)` — SAFE.
- Horizontal rule: literal `<hr>` hardcoded — SAFE (no user input interpolated).

CONFIRMED: renderMarkdown() does not introduce HTML injection. User content is escaped at every leaf point.

### D. inlineMarkdown() bold regex issue
The bold regex `\*\*([^*]+)\*\*/g` runs on already-HTML-escaped text. This means `**bold**` in the original text becomes `**bold**` in the escaped text (unchanged, since `*` is not an HTML special character) and correctly matches. However, if the original text contains `**text &amp; more**`, the escaped text would be `**text &amp;amp; more**` — which would still match and wrap in `<strong>`. The `$1` would be `text &amp;amp; more`, which is double-escaped.

**CONCERN (not blocking)**: inlineMarkdown() currently HTML-escapes first, then applies bold/italic replacements. If the original text contains `**text with &amp; entity**`, the `&` becomes `&amp;` and the bold replacement correctly preserves it. However, if the original text is `**text with <angle> brackets**`, the `<` and `>` become `&lt;` and `&gt;` — and the bold regex STILL captures `text with &lt;angle&gt; brackets` as the content, inserting `<strong>text with &lt;angle&gt; brackets</strong>`. This is correct and safe. **No actual bug** — the analysis confirms the implementation is safe.

**Revised verdict on this item**: SAFE. The concern was a false alarm on closer analysis.

### E. Test assertions adequacy for QW-001
Assertions added:
- `<style>` tag presence in list AND detail pages
- No `border="1"` attribute in list page
- `<main>` wrapper in list AND detail pages
- `<nav>` element in detail page
- `name="viewport"` meta tag in list AND detail pages
- `lang="en"` on `<html>` in list AND detail pages

These assertions are correctly structural, testable without a browser, and aligned with the actual changes made. They would catch a regression if any of these structural elements were removed. ADEQUATE.

### F. Test assertions adequacy for QW-002
Assertions added:
- `<div class="body">` wrapper present in detail page
- `<h3>Proposal</h3>` present (## = 2 hashes → h3, since h1 is page title)
- `<h3>Plan</h3>` present
- `<li>` elements present (from list items in VALID_SECTIONS)
- No `<div class="body"><pre>` (no bare `<pre>` wrapping the entire body)

These are correctly targeted at the renderMarkdown() output for the VALID_SECTIONS fixture body. ADEQUATE.

**One gap noted**: there is no negative test confirming that a task with a body containing `<script>` is HTML-escaped in the rendered output. This is a testing gap, but not a correctness gap — the code analysis in §C above confirms escaping is correct. Filing this as a "nice to have" for a future iteration, not a blocker.

### G. core-three-way-symmetry.test.mjs update correctness
The original assertion checked `cliDetail.body.trim().split("\n")[0]` literally (the raw first line: "## Proposal"). The updated assertion strips the markdown prefix (`/^#+\s*/`) to get `"Proposal"` and checks that it appears in the rendered HTML. "Proposal" DOES appear as content in `<h3>Proposal</h3>`. The new assertion is correctly scoped: it checks body content presence (not raw markdown syntax), which is what the three-way symmetry test was always trying to verify — that body content is surfaced in all three legs. CONFIRMED: update is correct and the symmetry intent is preserved.

### H. No new external dependencies
Confirmed: no `package.json` changes, no `npm install` steps, no `import` statements for external packages added to serve.js. CONFIRMED.

### I. Heading level choice in renderMarkdown()
The design choice (# → h2, ## → h3, ### → h4) correctly reserves h1 for the page title. This is semantically correct and prevents heading hierarchy violations (no h2 competing with the h1 page title). CONFIRMED.

### J. Regression: all 30 tests pass
Confirmed independently: `node --test packages/*/test/*.test.mjs → 30 pass, 0 fail`. CONFIRMED.

---

## Verdict

**PASS**

No functional bugs found. No HTML injection vulnerability. No scope creep (no new write surface, no backend-specific rendering). No new external dependencies. Test coverage is adequate for the structural claims made. The core-three-way-symmetry.test.mjs update is semantically correct. The one initially-raised CONCERN (bold regex + HTML escaping) resolved to a false alarm on detailed analysis.

**Recorded for tracking (not blocking)**:
- No negative test for HTML-escaping of user content in renderMarkdown() output. Low risk given code-level verification in §C above. Candidate for a future QW-* task if test coverage gaps are being closed.

**G3 sign-off**: PASS — QW-001 and QW-002 are cleared. V_instance lift is credited.
