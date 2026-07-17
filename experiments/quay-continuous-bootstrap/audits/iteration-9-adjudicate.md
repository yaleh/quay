# G3 Audit — Iteration 9
Date: 2026-07-17
Commit: 9c8e571
Auditor: G3 (independent)

## Verdict: PASS-WITH-NOTES

---

## Security findings

**CLEAR — no security issues.**

1. **Label count badge XSS**: `countBadge = \` (${labelCounts.get(l) || 0})\`` — the value is an
   integer accumulated by the `labelCounts` Map from `allTasks`; it is never derived from user
   input. No escaping needed and none is missing. Clean.

2. **`<details>/<summary>` label hrefs**: hidden labels inside the `<details>` block use
   `buildHref(...)` (which builds via `URLSearchParams`) and `escapeHtml(l)` for the visible
   text. Both the visible text and the href attribute are correctly escaped. Clean.

3. **Search result banner**: `escapeHtml(qFilter)` is applied at line 669 before inserting
   the query string into the HTML. Clean.

4. **`package.sh` command injection**: the script uses only fixed strings and `ls`/`cd`/`npm`.
   No user-supplied input is shell-expanded. Clean.

5. **`release.yml` permissions**: `permissions: contents: write` is correctly scoped — only
   the write needed for release asset upload. Read-only checkout does not need broader scope.
   Clean.

---

## Correctness findings

**All core logic is correct. One minor note (not a bug).**

1. **`z.union([z.array(z.string()), z.string()])` Zod type** (line 205 mcp-server.js):
   Zod `union` tries the first branch first. `z.array(z.string())` correctly matches `[]` and
   `["a","b"]`. `z.string()` correctly matches `"foo"`. The `.optional()` wrapper means `undefined`
   is accepted and bypasses both. Correct.

2. **Backward-compatibility normalization** (line 215):
   `const labelFilters = Array.isArray(label) ? label : (label ? [label] : [])`.
   - `label = "foo"` → `["foo"]` ✓
   - `label = ["a","b"]` → `["a","b"]` ✓
   - `label = []` → `[]` → `labelFilters.length === 0` → no filter applied ✓
   - `label = undefined` → `[]` → no filter applied ✓
   Correct in all four cases.

3. **AND-join filter** (line 220–223):
   `labelFilters.every((l) => Array.isArray(t.labels) && t.labels.includes(l))`.
   - Tasks with `undefined`/`null` labels: `Array.isArray(undefined)` is `false`, so `.every`
     short-circuits to `false` — task is excluded. Correct.
   - Tasks with empty `[]` labels: `[].includes(l)` is `false` — excluded. Correct.
   - AND semantics: all filters must match. Correct.

4. **Filter ordering** (mcp-server.js lines 216–241): status → label → prefix → search →
   pagination. Matches the tool description and the CLI/Web UI convention. Correct.

5. **`searchResultBanner` count** (serve.js line 669): uses `totalTasks` which equals
   `tasks.length` after all filters and sort, before pagination slicing (line 439). This is
   the correct filtered count (not the paginated subset, not the unfiltered total). Correct.

6. **`labelCounts` map reuse** (serve.js lines 575–583 vs 605): the same `labelCounts` Map
   computed for the frequency sort is reused for the count badge. Not recomputed. Correct.

7. **`package.sh` exit semantics**: `set -euo pipefail` causes any non-zero command to abort.
   The explicit `exit 1` at line 39 handles the missing-artifact guard. Implicit `exit 0` on
   success (script reaches end). Correct.

8. **`release.yml` artifact path**: `package.sh` `cd`s to `packages/quay/` and runs `npm pack`
   there, producing `packages/quay/quay-*.tgz`. The `ARTIFACT=$(ls -1t packages/quay/quay-*.tgz)`
   lookup in the workflow correctly targets that directory. Correct.

---

## Code quality findings

**Two notes — neither is a bug.**

1. **`release.yml` actions not SHA-pinned**: `actions/checkout@v4`, `actions/setup-node@v4`,
   and `softprops/action-gh-release@v2` use floating major-version tags, not pinned SHAs.
   This is a common supply-chain hardening omission. For a dev-tooling internal project it is
   low risk, but worth noting. Not a functional defect.

2. **`release.yml` skips test run before publish**: the workflow installs dependencies and
   packs but never runs `npm test` (or any equivalent) before uploading to a GitHub Release.
   A broken release could be published if the test suite would have caught the regression.
   Recommend adding a test step between "Install dependencies" and "Build release artifact."
   Low severity since `package.sh` itself verifies the artifact exists and the `set -e` flag
   aborts on failure, but the test gap is real.

3. **`package.sh` does not clean up the `.tgz` artifact after exit**: the `.tgz` stays in
   `packages/quay/`. The `.gitignore` entry `*.tgz` prevents accidental commits (good), and
   CI discards the runner after the job, so this is a non-issue in practice. Local developers
   running the script manually will accumulate artifacts. Low-priority cosmetic note.

---

## Test adequacy findings

**Tests are adequate for the stated assertions. Two mild gaps noted.**

1. **Block 16 (mcp-server.test.mjs) — AND-join test is discriminating**: assertion (a)
   verifies `label:["experiment-4","iteration-9"]` returns exactly 1 task (MLT-2). Under
   OR semantics this would return 4 tasks, so the test correctly distinguishes AND from OR.
   Pass.

2. **Block 16 (d) — empty array path**: `label:[]` is tested and verified to return all 4
   tasks. Pass.

3. **Block 16 (e) — schema type not verified**: the test only checks `"label" in props`, not
   that the schema shows it as an array type. Mild gap — the functional tests (a–d) cover
   the behavior, so this is a documentation gap, not a safety gap.

4. **QX-034 block (serve.test.mjs) — `<details>` label href toggle semantics not verified**:
   the test verifies `<details>`, `<summary>`, and `"more labels"` text presence, but does
   not verify that clicking a hidden label would navigate to the correct toggle URL (e.g., by
   checking a `href="/?label=rare-label-04"` substring). Low severity — the code path is
   identical to visible labels which are tested in earlier blocks.

5. **QX-020 bold assertions updated** (serve.test.mjs lines 766–774): changed from exact
   `<strong>alpha</strong>` match to prefix `<strong>alpha` match to accommodate the new
   count badge. Still correctly verifies the label is bold. Not weakened in a meaningful way.

6. **Search result banner test** (serve.test.mjs lines 1162–1168): verifies "results for"
   text and the raw `SEARCH_TERM` in the body. Sufficient to confirm the banner appears with
   the correct term. Does not verify the exact count digit, but the functional correctness of
   `totalTasks` is established by the filter logic analysis above.

---

## Write surface check

No new write surfaces introduced.

- `task_write` and `task_check` are unchanged.
- The action POST endpoint (`/task/<id>/action/<actionId>`) is unchanged.
- `package.sh` and `release.yml` are build/CI artifacts — no runtime write surface.
- `<details>/<summary>` is a read-only navigation element. No form, no POST.

---

## Summary

All three QX-032/033/034 changes are correct:

- **QX-032 (MCP multi-label)**: Zod union, normalization, AND-join filter, and filter
  ordering are all correct. Backward compatibility (single string) and edge cases (empty
  array, undefined labels field) are handled properly. Tests are discriminating.

- **QX-033 (packaging/release)**: `package.sh` is clean with `set -euo pipefail` and
  proper artifact detection. `release.yml` trigger (`v*` tags), permissions, and artifact
  path are correct. Two notes: no SHA pinning on third-party actions, and no test step
  before publish.

- **QX-034 (serve.js polish)**: label count badges reuse the existing Map correctly with
  no XSS risk. `<details>/<summary>` uses `escapeHtml` and `buildHref` correctly for
  hidden label links. Search result banner uses `escapeHtml(qFilter)` correctly and
  references the post-filter, pre-pagination count. QX-020 bold assertions are adapted
  correctly, not weakened.

**Recommended action**: Add a `npm test` step to `release.yml` before the pack step
(release pipeline quality). No code changes required for correctness.
