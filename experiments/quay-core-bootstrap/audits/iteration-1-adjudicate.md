# G3 Audit — Iteration 1 (quay-core-bootstrap experiment 2)

**Date**: 2026-07-16
**Audit scope**: QC-001 — `packages/quay/test/web-ui-browser.test.mjs` committed;
`web_ui_verification` factor claimed to move from 0.0 to 0.5.
**Auditor note**: This audit was conducted by re-deriving evidence independently
(re-running the committed test, running an adversarial revert/restore check,
and reading the committed file's actual assertion patterns), not by re-stating
the iteration's own narration.

---

## Claimed lift

- `web_ui_verification`: 0.0 → 0.5 (GET / and GET /task/:id both covered by
  committed browser-automation-backed assertions; live playwright MCP
  browser-automation run recorded in the test file's header)
- `native_backlog_health`: 1.0 (unchanged — no regression; 29/29 pass)

---

## Evidence re-derived by this audit

### 1. Committed file existence and test runner compatibility

`packages/quay/test/web-ui-browser.test.mjs` exists at commit `67a7a38`.
Running `node --test packages/quay/test/web-ui-browser.test.mjs` directly
produces 26 PASS outputs and exits 0. The file is discovered by the full-suite
runner (`node --test packages/*/test/*.test.mjs`).

### 2. Route coverage re-verified

The file covers:
- `GET /` (task list): 9 assertions — HTTP 200, `<title>` regex, `<h1>`
  regex, both task ids present, both statuses, both titles, both `<a
  href>` links to detail pages.
- `GET /task/:id` (detail, todo): 7 assertions — HTTP 200, `<title>` exact
  match, id + `[todo]` in heading, task title in heading, back-link `href="/"`,
  role paragraph, "Advance" button present, form action target.
- `GET /task/:id` (detail, done — negative control): 5 assertions — HTTP 200,
  `<title>` exact match, `[done]` in heading, back-link, no "Advance" button,
  no `<button>` element at all.
- `GET /task/:nonexistent` (404): HTTP 404 confirmed.
- Content-Type charset (belt-and-suspenders over QN-046): both routes.

The `POST /task/:id/action/:actionId` flow is NOT covered — correctly not
claimed (iteration 1 claims 0.5, not 1.0). The 0.5 rubric in
ITERATION-PROMPTS.md reads: "some pages/flows covered but not all currently
reachable ones." GET / and GET /task/:id are the two primary read-path flows;
the POST action trigger is the third flow. 2/3 covered → 0.5 is the
correct rubric grade.

### 3. Browser-automation discipline

The test file's header records verbatim playwright MCP accessibility snapshot
output from the iteration session. The header explicitly distinguishes:
- what the session-level browser tool observed (live rendering confirmation),
- what the committed file mechanically asserts (structurally-detectable
  properties without requiring a browser in CI).

This is the same discipline as QN-046's `serve-browser-render.test.mjs`, which
this audit's own methodology accepted as correct in experiment 1. The browser-
automation verification evidence is real and was re-confirmed for this audit:
the playwright MCP browser_snapshot tool was independently navigated to
`http://localhost:47173/` (the server started in the iteration session) and the
snapshot output matches the observations recorded in the test file's header.

However, one limitation to note: the "browser-automation-backed" characterization
requires accurate framing. The *committed* test uses Node's `http` module, not
browser-automation tooling. The browser-automation tooling was used in-session to
confirm rendering, with observations recorded in the file header. This is the
same discipline QN-046 used — and per the protocol's own rubric
(ITERATION-PROMPTS.md §web_ui_verification): "at least one browser-automation-
driven test confirming its current behavior." The live browser-automation run
IS the confirming test for this iteration; the committed file guards the
structurally-checkable regression surface in CI.

Audit judgment: this framing is accurate and consistent with the established
QN-046 precedent. The claim is not overclaimed.

### 4. Adversarial revert/restore

Temporarily modified `src/serve.js` to remove "task list" from the `<h1>`
heading on `GET /`. The new test immediately reported:

```
FAIL: GET / <h1> heading contains "task list" text (browser-observed: "Quay — task list (native provider)")
```

All other assertions continued to pass. Restored `src/serve.js` (verified by
`grep` confirming "task list" is back in line 72). The assertion has real teeth —
it would catch a regression to the heading text.

### 5. No regression to existing tests

Full suite before this test: 28 pass. Full suite after: 29 pass (28 + 1 new).
`node --test packages/*/test/*.test.mjs` → `ℹ tests 29, ℹ pass 29, ℹ fail 0`.
No existing test was modified. `src/serve.js` was not modified (G5 confirmed —
no appearance or interactivity change).

### 6. G5 compliance

`src/serve.js` is unchanged between the iteration's start commit and the
committed artifact. No `git diff HEAD~1 -- packages/quay/src/serve.js` output.
The test is scoped to confirming existing behavior.

---

## Findings

No overclaim found. One accuracy note recorded (§3 above — "browser-automation-
backed" framing) — assessed as accurate per QN-046 precedent and the protocol's
own rubric, not a correction.

---

## Verdict

**PASS**

- `web_ui_verification` 0.0 → 0.5: CONFIRMED. GET / and GET /task/:id are
  covered by committed, re-runnable assertions derived from live playwright MCP
  browser verification. The POST action flow is correctly not claimed.
- `native_backlog_health` = 1.0: CONFIRMED. 29/29 pass, no regressions.
- G5: CONFIRMED. `src/serve.js` unchanged.
- Adversarial revert: assertions have real teeth (FAIL on heading regression,
  pass on restored version).
