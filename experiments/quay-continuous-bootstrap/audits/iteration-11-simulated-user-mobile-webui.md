# Simulated User Audit — Iteration 11
**Persona**: Mobile Web UI daily user
**Date**: 2026-07-17
**Verdict**: CONCERNS

---

## Check 1: Web UI Accessible
`curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` → **200** ✓

---

## UQ-030 (search form position): FAIL — live server not reloaded

**Expected**: Search form HTML appears *before* the label nav in the page.

**Observed in live HTML**:
- Label nav (`Label: <strong>All</strong> · ...`) at character offset 5,979
- Search form (`<form method="GET" ...>`) at character offset 9,001
- Label nav is **3,022 characters before** the search form — old ordering still in effect

**Root cause**: The running server process (PID 3885190) was started on 2026-07-16 at 09:41 and has not been restarted. `serve.js` was modified on 2026-07-17 at 10:09 with QX-043 changes. The Node.js process loads source once at startup; the live instance is serving stale code.

**Code-level verification**: `serve.js` line 718 has `${searchForm}` and line 720 has `${labelNav ? html\`<div class="label-nav-wrap">...\` : ""}` — correct ordering is present in source, just not deployed to the running server.

---

## UQ-006 (label nav scrollable): FAIL — live server not reloaded

**Expected**: Label nav wrapped in `<div class="label-nav-wrap">` with `overflow-x: auto; white-space: nowrap` CSS.

**Observed in live HTML**:
- No `label-nav-wrap` div found anywhere in the page HTML
- Only one `<div>` in the entire page: `<div style="margin:0.25rem 0">` (inside the `<details>` overflow for extra labels)
- The `.meta` CSS class has no overflow-x styling: `.meta { color: #555; font-size: 0.9rem; margin: 0.5rem 0 1rem; }`
- On a 375px mobile screen, the label nav (57 labels visible + 32 in `<details>`) wraps into a multi-line wall

**Code-level verification**: `serve.js` lines 200–211 define `.label-nav-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap; ... }`. Fix is in source, not running.

**UX impact as mobile user**: The label nav is still an unscrollable wall of 25+ links. A first-time mobile visitor at 375px must scroll through all of it before reaching the search box. This is the primary usability gap of the iteration that has not landed in the live environment.

---

## SH-003 (stripHeadings): VERIFIED (indirect — code-level)

**Method**: No task in the corpus has `#`-prefixed lines inside fenced code blocks to directly test against the live server's old `stripHeadings()`. Indirect verification performed:

1. `serve.js` lines 35–46 show the new implementation tracking `inFence` state:
   ```js
   function stripHeadings(text) {
     let inFence = false;
     return (text || "").split("\n").filter((line) => {
       if (/^```/.test(line)) { inFence = !inFence; return true; }
       if (inFence) return true; // preserve code content
       return !/^#+\s/.test(line);
     }).join(" ");
   }
   ```
2. Search `?q=bash+comment` returns 1 result (QX-041, which mentions "bash comment" in prose). No false negatives observed from available corpus.
3. Cannot confirm SH-003 is fixed in the *running* server (same stale-process issue), but the source fix is complete and correct.

**Verdict**: N/A (indirect) — fix is in source; live test inconclusive due to server not being reloaded.

---

## Search result banner regression: PASS

`curl -s "http://localhost:4173/?q=quay"` → `Showing 119 results for "quay"` present in blue `.meta` style. No regression from iteration 9.

---

## New gaps found

### GAP-NEW-001: Server not restarted after iteration 11 source changes (blocking)
The quay serve process (PID 3885190) was started 2026-07-16 09:41, before `serve.js` was last modified (2026-07-17 10:09). All iteration 11 Web UI changes (QX-041, QX-043) are in source code but NOT reflected in the live server. The server must be restarted (`kill 3885190 && node packages/quay/bin/quay.js serve --port 4173 --host 0.0.0.0`) to make them visible to users.

### GAP-OBS-001: Label nav still wraps to wall in live environment (pre-existing, not fixed in live)
Until the server is restarted, the label nav continues to be an unscrollable multi-line wall on 375px mobile. This was the primary UQ targeted by this iteration.

### GAP-OBS-002: `<details>` truncation of 32+ labels still requires tap — not blocked
The current live behavior truncates labels at 25 visible + `… 32 more labels` in a `<details>` element. On mobile, tapping to expand works, but all 57 labels then wrap to multiple lines with no scrolling. This is a post-restart concern (UQ-006 fix addresses it via `white-space: nowrap` + `overflow-x: auto`).

---

## Overall verdict

**CONCERNS: Server not restarted — iteration 11 Web UI changes not live**

The QX-043 (UQ-030 + UQ-006) and QX-041 (SH-003) fixes are correctly implemented in `serve.js` and are in a good shape in source. However, the running server has not been restarted and is serving the pre-iteration-11 code. From a mobile user perspective, neither the search-first layout nor the scrollable label strip is visible. The search result banner remains intact (no regression on that front).

**Blocking issue**: Restart the serve process to deploy the iteration 11 changes before treating this iteration as complete from a user-visible standpoint.
