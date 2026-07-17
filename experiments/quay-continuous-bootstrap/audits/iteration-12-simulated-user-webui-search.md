# Simulated User Audit — Iteration 12
**Persona**: Web UI search heavy user
**Date**: 2026-07-17
**Verdict**: CONCERNS

---

## Environment

- Web UI: http://localhost:4173/ — HTTP 200, accessible
- Server process PID 4041295 started at 10:28:18 UTC
- `packages/quay/src/serve.js` last modified at 10:37:57 UTC (9 minutes after server start)
- **Server is running stale code** — QX-046 banner changes are in the file but NOT active in the running server

---

## QX-046 (UQ-035 — page indicator): FAIL (stale server)

### Multi-page results (`?q=quay` — 122 results, 7 pages)

**Expected banner**: `Showing 122 results for "quay" · Page 1 of 7`

**Actual banner (live server)**:
```
Showing 122 results for "quay"
```

The "· Page X of Y" suffix is absent. The page nav widget below the table does show "Page 1 of 7 (122 tasks)" correctly, so pagination itself works — but the banner-level indicator (QX-046's core feature) is not present.

**Root cause**: The server was started before `serve.js` was modified with the QX-046 changes. A server restart is required.

### Single-page results (`?q=stripHeadings` — 4 results, 1 page)

**Expected**: No page indicator at all

**Actual (live server)**:
```
Page 1 of 1 (4 tasks)
```

A separate code-level bug is present in `serve.js` line 673–727: `pageNav` falls back to `html\`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>\`` when `totalPages === 1`, and line 727 renders `${pageNav}` unconditionally (no guard). Only the bottom repeat at line 732 is guarded by `totalPages > 1`. The result is that single-page views always display an unnecessary "Page 1 of 1 (N tasks)" line.

**This is a code bug independent of the stale server issue.** Even after a server restart, `?q=stripHeadings` would incorrectly show "Page 1 of 1 (4 tasks)".

---

## Search banner regression: PASS (with caveat)

Basic banner (`?q=task`) shows "Showing 135 results for 'task'" — the iter-11 banner feature is intact. The banner itself has not regressed; only the QX-046 addition is missing due to the stale server.

---

## New gaps found

### GAP-1 (Blocker): Server restart required after code changes

The iteration-12 development cycle modified `serve.js` after starting the server. The live server does not pick up changes automatically. QX-046 cannot be verified without restarting the server. Workflow-level issue: CI/CD or the development runbook should ensure the server is restarted after code changes are deployed.

### GAP-2 (Code bug): `pageNav` single-page fallback renders "Page 1 of 1"

In `packages/quay/src/serve.js` line 673:
```js
} : html`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>`;
```
This branch fires when `totalPages === 1`. Combined with unconditional `${pageNav}` at line 727, single-page search results always display "Page 1 of 1 (N tasks)" — noisy and misleading. The fix: change the ternary else-branch to `""` or guard line 727 with `${totalPages > 1 ? pageNav : ""}`.

### GAP-3 (UX): Banner page suffix visible but nav widget redundant on multi-page

After a server restart, both the banner (`Showing N results · Page X of Y`) and the nav widget above the table (`Page X of Y (N tasks)`) will show pagination info. This is slightly redundant. For a search power user this is acceptable, but a lighter approach would be to rely solely on the banner suffix and simplify the above-table nav to just Prev/Next links without the "Page X of Y" text. Not blocking, but worth noting for a future cleanup.

---

## Overall verdict: CONCERNS

Two issues require action before this iteration can be fully accepted:

1. **Server must be restarted** to verify QX-046's banner suffix actually works in production.
2. **Code bug in single-page `pageNav` fallback** (line 673) must be fixed: single-page results should not show "Page 1 of 1".

Once the server is restarted and bug fixed, re-verify:
- `?q=quay` banner shows "· Page 1 of 7"
- `?q=stripHeadings` banner shows NO page indicator
