# G3 Audit — Iteration 8
Date: 2026-07-17
Commit: 8605ba9 + ef0973f
Auditor: G3 (independent)

## Verdict: PASS-WITH-NOTES

---

## Security findings

**No issues found.**

- `search` input is lowercased via `.toLowerCase()` and used only in a JavaScript string `.includes()` call — no filesystem path construction, no shell interpolation, no eval. Safe.
- `page` and `pageSize` are processed with `parseInt()` and immediately clamped: `Math.max(1, parseInt(page) || 1)` and `Math.min(200, Math.max(1, parseInt(pageSize) || 50))`. Both sanitized before any arithmetic. No raw passthrough to filesystem or shell.
- `search`, `prefix`, `status`, `label` never reach filesystem paths; all filtering is in-memory on the already-fetched task array.

---

## Correctness findings

### stripHeadings() copy fidelity — PASS

All three copies are byte-identical:

- `bin/quay.js` line 89: `(text || "").split("\n").filter((line) => !/^#+\s/.test(line)).join(" ")`
- `src/serve.js` line 36: identical
- `src/mcp-server.js` line 157: identical

Regex `/^#+\s/` matches in all three. No divergence.

The mcp-server.js copy also correctly handles `null`/`undefined` body via `(text || "")` — the handler passes `t.body || ""` before calling `stripHeadings()`, so there is a minor double-guard (harmless), but both are safe.

### Pagination math — PASS-WITH-NOTES

**Normal cases correct:**
- `total=4, pageSize=2`: `totalPages = ceil(4/2) = 2` — correct.
- `page=99` (beyond last): `start = 98*2 = 196`, `tasks.slice(196, 198)` on a 4-element array → `[]` — correct. No error thrown, empty array returned.
- `pageSize=0`: `Math.max(1, 0)` → clamped to 1 — correct.
- `pageSize` negative: `Math.max(1, negative)` → clamped to 1 — correct.
- `pageSize > 200`: `Math.min(200, ...)` → clamped to 200 — correct.
- `page=0` or `page` negative: `Math.max(1, parseInt(0) || 1)` → `Math.max(1, 0 || 1) = 1` — correct (NOTE: `parseInt(0)` = `0`, which is falsy, so `|| 1` kicks in, resulting in page 1; this is the intended clamp behavior and works correctly).

**NOTE — `total=0` edge case:**
When `total=0`, `pageSize=50` (default): `totalPages = Math.ceil(0/50) = 0`. The response returns `totalPages: 0`. This is mathematically defensible (there are zero pages of results) but slightly surprising — some APIs return `totalPages: 1` even for empty result sets (treating "page 1 of nothing" as still page 1). This is not a defect per the spec as written (spec says "ceil(total/pageSize)") but is a potential consumer surprise. No test covers this edge case.

**NOTE — `parseInt()` on non-integer floats:**
`parseInt(2.9)` → `2`; `parseInt("abc")` → `NaN` → `|| 1` kicks in (page=1) or `|| 50` (pageSize=50). Both degrade gracefully. No issue.

### Filter-then-paginate ordering — PASS

Code order in handler (lines 206-224):
1. `client.taskList({ status, label })` — status/label filters happen in Provider
2. `prefix` filter (if present) — lines 208-210
3. `search` filter (if present) — lines 211-217
4. pagination (`total = tasks.length`, then slice) — lines 218-225

This is correct. `total` is captured after all filters and before slicing, so `total` always reflects the filtered-set size, not the raw store size.

### label parameter — PASS

The `label` parameter description at line 197 accurately states: "Filter by a single label string. Tasks must have this label to be included. For multi-label AND-filter use CLI or Web UI." This is correct and honest. The implementation delegates to `client.taskList({ status, label })` where `label` is a single string — single-label behavior as documented.

### Response shape change and backward compatibility — PASS

The shape change from `{ tasks }` to `{ tasks, total, page, pageSize, totalPages }` is additive — existing fields are not renamed or removed. Existing tests access `r.structuredContent.tasks` or `r.structuredContent?.tasks ?? []` which still works correctly against the new shape.

The Block 5 byte-identity assertion (`JSON.stringify(direct.structuredContent) === JSON.stringify(viaCore.structuredContent)` at line 248) applies only to `task_get` and `task_check`, not `task_list`, so it is not broken by the pagination metadata addition.

All tests in Blocks 3, 4, 6, 7, 9, 12, and 13 that access `.structuredContent.tasks` or `.structuredContent?.tasks ?? []` are unaffected — the new metadata keys are orthogonal additions.

---

## Code quality findings

**Positive:**
- The pagination math is compact and correct (`Math.max/min` clamping, `parseInt() || default` fallback).
- Filter ordering is clearly commented ("applied after all filters so page/total reflect filtered set").
- `stripHeadings()` is inlined with a clear rationale comment (cross-entry-point dependency avoidance) rather than silently duplicated.
- `parseInt(page) || 1` pattern: safe for the supported types (number via MCP schema, or omitted). Zod schema declares `page: z.number().int().optional()`, so MCP SDK will coerce/validate before the handler receives it — `parseInt()` is a defensive belt-and-suspenders on top of Zod, which is acceptable.

**Minor note:**
The `mcp-server.js` `stripHeadings` call is `stripHeadings(t.body || "")` (line 215) while the function itself already handles falsy input via `(text || "")`. This double-guard is harmless but slightly redundant. Not a defect.

---

## Test adequacy findings

### Block 14 (search) — PASS

Tests are adequate:

- **(a) search="toggle"**: verifies title match on SRCH-1, excludes SRCH-2 and SRCH-3. Confirms title-match path.
- **(b) search="Proposal"**: The key heading-exclusion test. SRCH-1's body contains `## Proposal\nThis task is about toggling...`. After stripping headings, "Proposal" would only appear if it were in a prose line. None of the 3 tasks have "Proposal" as prose. The test asserts `tasks.length === 0`. This **genuinely verifies heading exclusion**, not merely "fewer results" — because SRCH-1's body contains "Proposal" in a heading line (which should be excluded) but also contains the word "toggling" in prose. If `stripHeadings()` were broken (no stripping), search="Proposal" would return all 3 tasks. The assert of 0 is the correct discriminating test. PASS.
- **(c) search="unique-xyzzy-prose"**: verifies prose body match on SRCH-3 only. The unique token ensures no accidental cross-task matches.
- **(d) no search**: regression test, returns all 3.
- **(e) schema**: `listTools()` confirms `search` in `inputSchema.properties`.

### Block 15 (pagination) — PASS

Tests are adequate:

- **(a) default**: verifies `total=4`, `page=1`, `pageSize=50`, all 4 tasks returned, `totalPages` field present.
- **(b) page=1, pageSize=2**: verifies count=2, metadata correct.
- **(c) page=2, pageSize=2**: verifies **disjoint sets** explicitly — `overlap.length === 0` assertion at line 945. This is the gold-standard disjointness test, not just "right count on page 2."
- **(d) page=99 (beyond last)**: verifies empty array, no error, `total` still accurate.
- **(e) search + pagination**: verifies filter-then-paginate ordering with a concrete case (`search="pag-special"` → `total=1`, `tasks=[PAG-4]`).
- **(f) schema**: `page` and `pageSize` in `inputSchema.properties`.

**Gaps (minor, not blocking):**
- `total=0` edge case not tested (what does `totalPages` equal when there are no tasks?). The code returns `Math.ceil(0/50) = 0`; a consumer expecting `1` might misbehave. Low risk for current consumers (Agent reads `tasks` array directly).
- `pageSize=0` and `pageSize=201` clamping not explicitly tested. Clamping logic is correct (audited above) but not regression-protected.
- `pageSize > 200` over-clamp: no test verifies that requesting `pageSize=500` actually returns only 200. The code is correct but the behavior is unspecified to test consumers.

None of these gaps affect correctness of the shipped code; they are coverage gaps for future protection.

---

## Write surface check

- `mcp-server.js` changes: purely in-memory filtering and response assembly. No new filesystem writes, no new shell invocations, no new MCP resource registrations beyond the existing 6 tools and 2 resource types.
- `stripHeadings()` is pure (no I/O).
- `parseInt()` inputs are Zod-validated numbers before reaching the handler.
- No new dependencies added.

---

## Summary

All focus-area checks pass. The `stripHeadings()` copy is byte-identical across all three files. Pagination math correctly handles boundary conditions (clamp on 0/negative/overlarge pageSize, empty result on beyond-last-page). Filter-then-paginate ordering is correctly implemented and commented. The response shape change is backward-compatible (additive metadata). The `label` parameter description accurately states single-label semantics. No security concerns. Tests in Block 14 genuinely verify heading exclusion (not just "fewer results"), and Block 15 tests disjoint pagination pages explicitly.

Two minor notes (not defects): (1) `total=0` yields `totalPages=0` — mathematically correct but potentially surprising; not tested. (2) `pageSize` clamping edge cases (0, >200) are correct but not regression-tested.
