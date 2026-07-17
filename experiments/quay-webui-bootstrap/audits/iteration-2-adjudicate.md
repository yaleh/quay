# G3 Out-of-Band Adjudicate — Iteration 2

**Dispatcher**: Orchestrator (this session), native, NOT manda.
**Trigger**: QW-003 touches packages/quay/src/serve.js (Core source file).
**Scope**: QW-003 changes to GET / route and associated browser-automation tests.
**Date**: 2026-07-17

## Adversarial review checklist

### 1. Write-surface boundary preservation

QW-003 only modifies the GET / route handler. The POST /task/:id/action/:actionId
route is UNCHANGED. The GET /task/:id detail route is UNCHANGED. No new form
elements, textarea, or write-capable UI surfaces were added. The filter navigation
links are all GET links (href= attributes), not POST forms.

Verdict: PASS — write-surface boundary preserved.

### 2. "Core stays dumb" (no backend-specific rendering)

The filter logic reads `url.searchParams.get("status")` and compares against
`t.status` values. `t.status` is whatever the provider returns — no provider-
specific status labels are hardcoded in the filter logic. The filter nav links
hardcode the status labels ["todo", "ready", "done", "needs-human"] — these are
the standard quay-native status values. However, this list appears in serve.js
(Core), not derived from the provider manifest. This is a minor "Core stays dumb"
concern: if a future provider uses different status labels, the filter nav would
show wrong labels while the filter logic itself would still work correctly (it
compares against whatever the provider returns). The filter nav is a UI affordance
whose correctness depends on the provider's status set — not a correctness bug
for today's single native provider, but worth documenting.

Verdict: PASS with one non-blocking note — filter nav labels hardcoded in Core
against the current native provider's status set. This is acceptable for the v0
walking-skeleton scope (G5: no framework, no config-driven status enumeration).
A future QW-* task could read status values from the provider manifest instead.

### 3. Query parameter injection safety

`url.searchParams.get("status")` returns a plain string or null. The filter
logic only uses it for strict equality comparison (`t.status === statusFilter`).
The statusFilter value is never rendered directly into HTML without escaping.

Wait — let me check the filter nav rendering. The filterNav uses:
`html<a href="/?status=${encodeURIComponent(s)}">${escapeHtml(s)}</a>`

For the static `statuses` array values, this is safe (they are hardcoded strings).
The `statusFilter` itself (user-supplied) is NOT rendered directly — the nav shows
the active filter as `<strong>All</strong>` or `<strong>${escapeHtml(s)}</strong>`
(where s comes from the statuses array, not from the query param directly).

However, verify: is the statusFilter value itself ever rendered into HTML output?
Looking at the template:
- `filterNav` contains: active status from `statuses` array rendered with
  `escapeHtml(s)` — NOT the raw query param.
- The `filterNav` itself is interpolated into the html`` template literal, which
  does NOT escape it (the html`` function concatenates strings directly).
- But `filterNav` is constructed from hardcoded `statuses` values (via escapeHtml)
  plus the All case — neither of which uses the raw query param.

Therefore: the user-supplied ?status= value is ONLY used in the equality comparison
`t.status === statusFilter`, never rendered raw into HTML.

Verdict: PASS — no HTML injection vector via query param.

### 4. Backward compatibility: GET / with no query param

The original behavior (show all tasks) is preserved. When `statusFilter` is null
(no ?status param), `tasks = allTasks` (unfiltered). The template renders `filterNav`
with "All" as plain text (bold), and links for each status. The rest of the template
is unchanged from the pre-QW-003 version.

Regression test evidence: the existing assertions "GET / body contains both seeded
task ids (WUI-1, WUI-2)" and "GET / body contains both seeded tasks' statuses"
still pass (confirmed: 0 FAIL, 63 PASS in web-ui-browser.test.mjs).

Verdict: PASS — backward compatibility preserved.

### 5. Test assertion adequacy

New assertions added:
- GET / baseline (all tasks visible, filter nav present): 2 assertions
- GET /?status=todo (includes todo, excludes done): 4 assertions
- GET /?status=done (includes done, excludes todo): 4 assertions
- GET /?status=ready (empty, not error): 2 assertions
Total new: 12 assertions. All pass in web-ui-browser.test.mjs.

The tests correctly exercise:
- The include path (matching tasks shown)
- The exclude path (non-matching tasks absent)
- The empty-result path (no matching tasks → 200, no tasks shown)
- The unfiltered baseline (no param → all tasks)

One gap not tested: the filter nav links' href values (e.g. `href="/?status=todo"`).
The test verifies `/?status=todo` OR `/?status=done` in the body, but doesn't assert
the exact href format. This is a minor test gap — the functional behavior is tested
by actually requesting /?status=todo and /?status=done. Low priority for a future QW-*.

Verdict: PASS — adequate test coverage for the new filter behavior.

### 6. No external dependencies added

The change uses only:
- `url.searchParams.get("status")` — Node.js URL API (already used on line 268)
- `encodeURIComponent(s)` — Node.js built-in
- `Array.prototype.filter()` — built-in
- `Array.prototype.map()` — built-in

No new npm dependencies. G5 discipline preserved.

Verdict: PASS.

### 7. Full test suite regression

`node --test packages/*/test/*.test.mjs` → 30 pass, 0 fail (confirmed post-commit).

Verdict: PASS — no regression.

### 8. Syntax correctness

Initial edit introduced Unicode curly quotes ("/" instead of "/") from the Edit
tool's text processing. This was caught immediately (node -e import() failed with
SyntaxError at line 270) and corrected via a python3 byte-level replacement. The
committed code has been verified syntax-clean (node -e import() returns without
error, and all 30 test suites pass).

Verdict: PASS — syntax clean in committed code. The curly-quote issue is a known
artifact of the Edit tool processing unicode and has been documented.

## Overall verdict

**PASS** — all seven checks pass. One non-blocking documentation note:
- Filter nav status labels are hardcoded in Core against the native provider's
  status set. Acceptable for v0 scope; future improvement if multi-provider
  status diversity arises.
- Test gap: filter nav href format not explicitly asserted. Low priority.

QW-003 is clear to advance to done. G3 co-sign for iteration-2 execute->done
gate on QW-003.
