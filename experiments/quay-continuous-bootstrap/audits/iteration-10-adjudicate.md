# G3 Audit — Iteration 10 (quay-continuous-bootstrap, Experiment 4)

**Date:** 2026-07-17
**Auditor:** G3 (fresh-context subagent)
**Verdict:** PASS-WITH-NOTES

---

## Summary

All six iteration 10 changes (QX-035, QX-036, QX-037 ×4, DIR-007) are logically correct with no security vulnerabilities, no regressions, and adequate test coverage for the primary paths. Two low-severity notes are recorded: (1) the `--json` mode edge case for "No tasks found." is handled correctly by code placement but is not covered by a test assertion; (2) the `allLabels` nav completeness design (sourced from unfiltered `allTasks`) means labels absent from the current status/search scope still appear in the label nav — this is intentional and documented but may surprise users who expect the nav itself to be filter-scoped.

---

## Per-change findings

### QX-035 — MCP staleness mitigations (mcp-server.js)

**`QUAY_VERSION` computation (lines 57–60):**
```js
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version: QUAY_VERSION } = JSON.parse(
  readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
);
```
- Path resolution: `__dirname` is the `src/` directory; `../package.json` resolves to `packages/quay/package.json`. This is correct.
- Failure mode: if the file is missing, `readFileSync` throws at module startup — the MCP server process exits with a clear Node.js error, not silently. This is the correct failure mode (fail-fast at startup, not at call time).
- The `version` field is present in `package.json` as `"0.1.0"` — confirmed.

**`_version` field in response (line 256):**
```js
const result = { tasks: paged, total, page: pageNum, pageSize: size, totalPages, _version: QUAY_VERSION };
return {
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  structuredContent: result,
};
```
- `_version` is present in BOTH `content[0].text` (JSON serialization of `result`) and `structuredContent`. Correct.
- The `_version` field name uses an underscore prefix — this is a quay-specific extension, not a standard MCP field. This is acceptable (no collision with MCP-standard fields) and is documented in the tool description and README.

**Version: prefix in tool description:**
- Prefix is `"Version: ${QUAY_VERSION}. "` at the very start of the description string (line 200–201). Correct placement — hosts that truncate descriptions will still surface the version.
- Format is parseable by regex: `/Version:\s+([\d.]+)/`.
- The rest of the description is unchanged and still accurately documents the tool.

**Verdict for QX-035:** PASS.

---

### QX-037 — `--label` guard (bin/quay.js)

**`parseFlags()` behavior:** When `--label` is the last argument with no following value (or the next token starts with `--`), `parseFlags()` sets `flags.label = true` (boolean). This is the same behavior as `--prefix` without a value.

**Guard condition (lines 182–187):**
```js
const rawLabel = flags.label;
if (rawLabel !== undefined && typeof rawLabel !== "string" && !Array.isArray(rawLabel)) {
  console.error("Error: --label requires a value (e.g., --label experiment-4)");
  process.exitCode = 1;
  return;
}
```
- The condition correctly identifies the boolean-true case (passed with no value).
- `typeof rawLabel !== "string"` excludes single-value strings. `!Array.isArray(rawLabel)` excludes arrays from repeated `--label A --label B`. The `true` boolean case falls through all these guards and triggers the error. Correct.
- Error exits via `process.exitCode = 1; return` — identical pattern to the `--prefix` guard. Consistent.
- Error message is actionable: includes a concrete example `--label experiment-4`.

**Guard placement:** The guard is placed AFTER the `--prefix` guard (lines 171–176) and BEFORE `[].concat(flags.label).filter(Boolean)` (line 195). Without the guard, `[].concat(true).filter(Boolean)` would produce `[true]`, which would filter tasks by label `true` — yielding 0 results silently. The guard prevents this. Correct placement.

**Verdict for QX-037 `--label` guard:** PASS.

---

### QX-037 — Empty result message (bin/quay.js)

**Logic (lines 252–264):**
```js
// (inside `else` block — not --json mode)
if (sorted.length === 0 && searchQuery !== null) {
  console.log(`Hint: use --label to filter by label...`);
}
if (sorted.length === 0 && searchQuery === null) {
  console.log("No tasks found.");
}
```

**`--json` mode:** Both messages are inside the `else` block (the non-`--json` branch). When `flags.json` is truthy, `printJson(sorted)` is called instead and both messages are skipped. A `--json` consumer with zero results receives `[]` (empty array) — correct JSON output with no contaminating plaintext. PASS.

**Interaction with `--search`:** When `--search` is active, `searchQuery` is non-null. If results are zero, the search hint fires (line 252); "No tasks found." does NOT fire (line 262 condition: `searchQuery === null` is false). The two messages are mutually exclusive. Correct.

**Edge case — `--search` active AND zero results:** The search hint message is slightly different in character ("Hint: use --label...") vs "No tasks found." This is reasonable — the hint directs users to try `--label` instead. No issue.

**Note (low severity):** The test for UQ-020 (Test 21 in cli.test.mjs) does not have an assertion confirming "No tasks found." is ABSENT in `--json` mode. The code is correct, but this edge case is untested. Recorded as a note (not a blocking finding — the code structure makes the --json/non-json branch separation clear and robust).

**Verdict for QX-037 empty result:** PASS (with note on untested --json edge case).

---

### QX-037 — Filter-scoped labelCounts (serve.js)

**Variable chain:**
1. `allTasks` — all tasks (unfiltered)
2. `filteredByPrefix` — prefix filter applied to `allTasks`
3. `filteredByStatus` — status filter applied to `filteredByPrefix`
4. `filteredByLabel` — label filter applied to `filteredByStatus`
5. `filtered` (qFilter) — search filter applied to `filteredByLabel`
6. `filteredByStatusAndSearch` — qFilter applied to `filteredByStatus` (label filter deliberately excluded)

The intent: label counts show "how many tasks in the current prefix+status+search scope have each label." If I'm on `?status=todo`, label counts reflect only todo tasks. If I add `?label=A`, the other labels' counts do NOT drop (they still reflect the pre-label-filter scope). This is the correct UX for additive label toggling.

**`allLabels` sourced from `allTasks` (line 598):** Labels from ALL tasks appear in the nav, even if a label has 0 matching tasks in the current filtered scope. The `labelCounts.get(l) || 0` default means such labels show `(0)`. This is intentional for nav completeness (users can discover labels that exist in other contexts). This design decision is documented in the code comment.

**Potential concern (low severity, NOTE):** A label with count `(0)` in the current filter scope is still clickable in the nav — clicking it would add it to the filter and produce zero results. A user on `?status=todo` could click a label that only exists on `done` tasks and get an empty list. This is the same behavior as before (pre-QX-037), since labels were always sourced from `allTasks`. Not a regression; the count badge `(0)` provides a signal. Recorded as a note.

**XSS:** `escapeHtml(l)` is applied to all label names before rendering (line 623, 624). The count badge `${labelCounts.get(l) || 0}` is a number — no XSS risk.

**Verdict for QX-037 filter-scoped labelCounts:** PASS (with note on 0-count clickable labels, not a regression).

---

### QX-037 — Info-banner CTA (serve.js)

**Condition (lines 767–769):**
```js
${t.status === "needs-human" && buttons.length > 0
  ? html`<div class="info-banner" role="note">This task needs human attention. Use the action buttons above to advance or resolve it.</div>`
  : ""}
```

**`buttons` variable:** `buttons` is defined at line 730–741 by filtering `manifest.action_buttons` and mapping to HTML form strings. It is a string (joined array). `buttons.length` is the character length of this string — NOT the count of buttons.

**Bug analysis:** If `buttons` is an array, `buttons.length > 0` would count buttons. But `buttons` is a `string` (the result of `.join("\n")`). A non-empty string has `length > 0`. This works correctly: if there are no action buttons, the join produces `""` (length 0); if there are any buttons, the join produces a non-empty string. The condition correctly distinguishes the two cases. PASS (the string-length check is semantically equivalent to checking whether any buttons were rendered).

**Banner text:** Entirely static string — no user data embedded. No XSS risk.

**`role="note"`:** Valid ARIA role for an informational region. Correct.

**Verdict for QX-037 info-banner:** PASS.

---

### DIR-007 — Orientation banner removal (serve.js)

**CSS:** `.orientation-banner {}` retained as empty rule (line 154–160 area). No regression for any test or external reference that matches on the class name.

**HTML comment (line 691–692):**
```html
<!-- QX-015 orientation banner removed by DIR-007 (iteration 10): misleading
     needs-human placement + disproportionate layout cost. -->
```
Comment contains no user data — no XSS risk. The comment is informational only.

**List page template (line 688–710):** No `<div class="orientation-banner">` element present. The banner is completely removed from the HTML output.

**serve.test.mjs:** Two existing assertions updated to check that banner text is ABSENT (confirmed per iteration 10 dev phase notes). This is correct regression protection.

**Verdict for DIR-007:** PASS.

---

### QX-036 — engines field + README (package.json, README.md)

**`engines` field:**
```json
"engines": {
  "node": ">=20.0.0"
}
```
- npm `engines` field format is correct. `">=20.0.0"` is a valid semver range.
- The field is placed before `"dependencies"` — valid JSON, correct position.

**README Install section:**
- Option A uses `npm install -g quay-*.tgz` with a glob. The glob avoids the v-prefix bug from iteration 9 synthesis (where `quay-v0.1.0.tgz` was incorrect). PASS.
- The comment "replace with the actual filename from the release" is helpful for users.
- "Updating quay" section (lines 69–77) correctly explains MCP server restart requirement, references the root cause (process lifetime controlled by host), and gives actionable guidance.

**Verdict for QX-036:** PASS.

---

## Test coverage assessment

| Change | Primary path tested | Edge cases tested | Assessment |
|--------|--------------------|--------------------|------------|
| QX-035 _version | Yes (Block 17: structuredContent._version is string, non-empty) | No: `_version` in content text not asserted separately; `QUAY_VERSION` value correctness not asserted | Adequate — structuredContent is the canonical consumer path |
| QX-035 Version: prefix | Yes (Block 17: description.includes("Version:")) | No: prefix is at start (not asserted); version value in description not verified | Adequate for the stated goal |
| QX-037 --label guard | Yes (Test 21: exits non-zero, stderr includes "--label requires a value") | No: `--label --prefix QX` (two flags, label last) not tested | Adequate |
| QX-037 empty result | Yes (Test 21: exits 0, stdout includes "No tasks found") | No: --json mode with empty result not asserted | Adequate; --json branch is structurally separate |
| QX-037 filter-scoped counts | Yes (QX-037 serve block: global=5, todo-scoped=2, no-global-on-todo) | No: search-scoped counts not tested; 0-count label behavior not tested | Adequate for primary use case |
| QX-037 info-banner | Not present in serve.test.mjs | Banner presence on needs-human task not asserted | Minor gap — banner rendering is untested |
| DIR-007 | Yes (two assertions that banner text is absent) | N/A | Adequate |
| QX-036 engines | Not applicable (package metadata, not runtime behavior) | N/A | N/A |

**Missing test: info-banner (UQ-022):** The `.info-banner` HTML for `needs-human` tasks has no automated test assertion. The code is correct (reviewed above), but a regression could be introduced silently. This is a minor coverage gap — the banner is a cosmetic/informational element, not a functional path.

---

## Notes / recommendations

1. **[NOTE-1] `--json` mode + empty result:** "No tasks found." is correctly suppressed in `--json` mode by code structure, but this is not tested. Low risk; low priority.

2. **[NOTE-2] 0-count labels in nav:** Labels with 0 matching tasks in the current filter scope still appear in the label nav (sourced from `allTasks`). They show `(0)` count badge. Clicking them produces an empty result page. This is not a regression and is intentional for nav completeness, but may be surprising to users. Pre-existing design characteristic documented here.

3. **[NOTE-3] info-banner test coverage missing:** No serve.test.mjs assertion verifies `.info-banner` presence on a `needs-human` task detail page. Recommend adding in a future iteration.

4. **[NOTE-4] `_version` content text not asserted:** Block 17 verifies `_version` in `structuredContent` but not in the `content[0].text` JSON. Since both use the same `result` object, this is low risk. The test is adequate for the primary consumer path.

---

## Verdict rationale

All changes are logically correct, security-clean, and test-covered for their primary paths. The four notes are low-severity: two are untested edge cases where the code is verifiably correct by structure (--json branch separation, `result` object shared between content and structuredContent), one is a pre-existing design characteristic (0-count labels), and one is a missing test for a cosmetic element. No blocking bugs, no security issues, no regressions detected.

**Final verdict: PASS-WITH-NOTES**

σ_QX for iteration 10: QX-035 PASS, QX-036 PASS, QX-037 PASS → all 3 tasks co-signed. σ_QX = 37/37 = 1.000 (iteration 10 adds 3 tasks to the 34-task base; the 3 pending G3 co-signs from the dev phase are now resolved).
