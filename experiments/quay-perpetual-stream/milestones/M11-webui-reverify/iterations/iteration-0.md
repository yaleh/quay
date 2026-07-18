# M11-webui-reverify — iteration-0

**Worktree:** `experiments/quay-perpetual-stream/milestones/M11-webui-reverify/worktrees/iteration-0`
**Branch:** `exp5-m11-iteration-0`
**Dev server:** `node bin/quay.js serve --port 4174` (port 4173 was not explicitly checked for
availability first; 4174 was used directly and confirmed live — noted here per the setup
instructions' "use whatever port `quay serve` actually binds" clause).

## Setup — HARD GATES (literal pasted output)

### 1. `git worktree add` output

```
$ git worktree add experiments/quay-perpetual-stream/milestones/M11-webui-reverify/worktrees/iteration-0 -b exp5-m11-iteration-0
Preparing worktree (new branch 'exp5-m11-iteration-0')
HEAD is now at f2fa5b6 SELECT m11 = M-WEBUI-REVERIFY: author charter for Web UI cov re-verification
```

Confirmed `pwd` inside the worktree before any edits/commits:
```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M11-webui-reverify/worktrees/iteration-0
$ git branch --show-current
exp5-m11-iteration-0
```

### 2. `ls -1 experiments/quay-perpetual-stream/directives/pending/`

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
(no output — directory is empty)
```

**Disposition:** N/A — no pending directives exist this iteration. Stated explicitly per the
instruction: the directory is empty, nothing to apply/defer/reject.

### 3. `.manda/hub.addr` + healthz

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

### 4. G7 liveness curl (port the dev server actually bound to: 4174)

```
$ curl -s http://localhost:4174/ -o /dev/null -w "%{http_code}\n"
200
```

This is G7 liveness ONLY — real rendering/interaction verification is via `mcp__playwright__*`
below, per `inherited-core.md`'s Web UI verification requirement (curl demoted for that purpose).

## The actual milestone work — real browser-tool re-verification

All navigation/screenshot/snapshot calls below are literal `mcp__playwright__*` tool-call traces,
pasted directly (not narrated), against `http://localhost:4174` (the actually-running dev server,
same product M04-discover's own iteration-0 tested, current tree).

### Desktop viewport (1280×900)

**Resize + navigate to list page:**
```
mcp__playwright__browser_resize(width=1280, height=900)
mcp__playwright__browser_navigate(url="http://localhost:4174/")
→ Page URL: http://localhost:4174/
  Page Title: Quay — quay-native
  Console: 1 errors, 0 warnings
```

**Full accessibility snapshot** (`mcp__playwright__browser_snapshot`) confirmed: prefix nav (DIR,
PC, QC, QN, QW, QX, SU, TEST), status filter nav (todo/ready/done/needs-human), sort nav
(id/status/updated), search box (`name` visible as "Search titles and descriptions…"), label nav
(25+ labels with counts, "… 46 more labels" overflow indicator), page-size nav (10/20/50/100),
pagination ("Page 1 of 9 (169 tasks)"), and a full task table (id/status/role/title/labels/
updated/actions columns) with working `Advance` action buttons on `ready`/`todo` rows. List page
renders correctly.

**Console check** (`mcp__playwright__browser_console_messages`):
```
Total messages: 1 (Errors: 1, Warnings: 0)
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
  @ http://localhost:4174/favicon.ico:0
```
Same benign `favicon.ico` 404 M04-discover's own report noted — not a gap.

**Screenshot saved:** `evidence/m11-desktop-list.png`
(`mcp__playwright__browser_take_screenshot`, type=png, scale=css, fullPage=false)

#### UQ-049 re-check (live browser, not curl)

```
mcp__playwright__browser_navigate(url="http://localhost:4174/?search=DIR-004")
mcp__playwright__browser_evaluate(function="() => { ... rowCount, pageInfo ... }")
→ { rowCount: 21, pageInfo: "Page 1 of 9 (169 tasks)" }
```
`?search=DIR-004` is a no-op — full unfiltered 169-task listing returned, exactly as M04-discover
found. Screenshot: `evidence/m11-desktop-search-param.png`.

```
mcp__playwright__browser_navigate(url="http://localhost:4174/?q=DIR-004")
mcp__playwright__browser_evaluate(function="() => { ... pageInfo, ids ... }")
→ {
    pageInfo: "Page 1 of 1 (9 tasks)",
    ids: ["DIR-004","QN-027","QN-042","QN-050","QX-033","QX-040","QX-056","QX-057","QX-067"]
  }
```
`?q=DIR-004` correctly filters to 9 tasks. Screenshot: `evidence/m11-desktop-q-param.png`.

**UQ-049 status: STILL PRESENT** — re-confirmed with live browser evidence (DOM-level row-count
extraction via `browser_evaluate`, not curl), identical behavior to M04-discover's original find.

#### Detail page

```
mcp__playwright__browser_navigate(url="http://localhost:4174/task/DIR-005?from=%2F")
→ Page Title: DIR-005
mcp__playwright__browser_snapshot()
```
Full snapshot confirmed: back-to-list nav, `<h1>` title with status suffix, role/labels meta line,
`updated` timestamp, `Advance` button, full "Details" section rendering DIR-005's markdown body
(headings, paragraphs, code spans, lists) correctly. Screenshot: `evidence/m11-desktop-detail.png`.

#### Filter (combined status+label)

```
mcp__playwright__browser_navigate(url="http://localhost:4174/?status=ready&label=directive")
mcp__playwright__browser_evaluate(function="() => { ... pageInfo, ids, statuses ... }")
→ { pageInfo: "Page 1 of 1 (1 tasks)", ids: ["DIR-005"], statuses: ["ready"] }
```
Combined status+label filter correctly narrows to exactly 1 matching task. Screenshot:
`evidence/m11-desktop-filter-combined.png`.

#### Action-flow gating (Advance click)

```
mcp__playwright__browser_navigate(url="http://localhost:4174/task/DIR-005?from=%2F")
mcp__playwright__browser_click(target="Advance button", ref=f20e10)
→ Page URL: http://localhost:4174/task/DIR-005?error=Gate+check+failed%3A+0%2F0+AC+checkboxes+checked
```
`Advance` correctly blocks/errors when no AC checkboxes exist (0/0 gate check failure), matching
M04-discover's original claim — no silent false success. Screenshot:
`evidence/m11-desktop-action-gate-error.png`.

### Mobile viewport (390×844, emulated touch layout via viewport resize)

```
mcp__playwright__browser_resize(width=390, height=844)
mcp__playwright__browser_navigate(url="http://localhost:4174/")
```
List page renders correctly at mobile width — table remains horizontally scrollable (`overflow-x:
auto` in `serve.js`'s CSS), core content readable. Screenshot: `evidence/m11-mobile-list.png`.

```
mcp__playwright__browser_navigate(url="http://localhost:4174/?page=2")
mcp__playwright__browser_evaluate(function="() => { ... pageInfo ... }")
→ { pageInfo: "Page 2 of 9 (169 tasks)" }
```
Pagination works correctly at mobile viewport.

#### UQ-050 re-check (live browser, DOM-level overflow inspection)

```
mcp__playwright__browser_navigate(url="http://localhost:4174/task/DIR-004?from=%2F")
→ Page Title: DIR-004
mcp__playwright__browser_take_screenshot(filename="m11-mobile-detail-DIR-004.png")
```

**h1-specific check** (`mcp__playwright__browser_evaluate`):
```
function: () => { const h1 = document.querySelector('h1'); ... }
→ {
    found: true, scrollWidth: 366, clientWidth: 366, overflowX: false,
    rectRight: 378, innerWidth: 390, viewportOverflow: false,
    computedOverflowWrap: "normal", computedWordBreak: "normal", whiteSpace: "normal",
    text: "DIR-004: DIR-004: Node SEA/Bun compile release artifacts + GitHub Actions build/"
  }
```
On THIS specific task's `<h1>`, there is NO overflow — the title (which contains spaces) wraps
cleanly within its box (`scrollWidth === clientWidth === 366`, `rectRight 378 < innerWidth 390`).
Screenshot `evidence/m11-mobile-detail-DIR-004.png` visually confirms clean 4-line wrap, no
truncation.

**Page-wide overflow check** (`mcp__playwright__browser_evaluate`):
```
function: () => { ... document.body.scrollWidth vs window.innerWidth ... }
→ { bodyOverflowX: "visible", htmlOverflowX: "visible", scrollWidthBody: 477, innerWidth: 390 }
```
`document.body.scrollWidth` (477px) DOES exceed `window.innerWidth` (390px) on this same page —
a genuine 87px horizontal overflow exists, just not attributable to the `<h1>` on this task.

**Element-level offender search** (`mcp__playwright__browser_evaluate`):
```
function: () => { ... document.querySelectorAll('a, li, p') ... scrollWidth > clientWidth ... }
→ [
    {
      tag: "LI",
      text: "Release: https://github.com/yaleh/quay/releases/tag/v0.2.0",
      scrollWidth: 401,
      clientWidth: 302
    }
  ]
```
The overflowing element is a `<li>` list item in the task body's rendered markdown, containing an
unbroken long URL (`https://github.com/yaleh/quay/releases/tag/v0.2.0`) with no CSS `word-break`/
`overflow-wrap` rule to force it to wrap — `serve.js`'s CSS (`h1 { font-size: 1.5rem; margin: ...
}`, checked directly, line 68) has no `overflow-wrap`/`word-break` declared anywhere for body
content either. Scrolled this element into view and re-screenshotted:
`evidence/m11-mobile-detail-url-overflow2.png` — visually confirms the URL text
("https://github.com/yaleh/quay/releases…") is cut off flush against the right edge of the
390px viewport, no wrap, no ellipsis, no horizontal scroll affordance visible in the normal
reading flow.

**UQ-050 status: STILL PRESENT, with refined root-cause attribution.** The underlying defect class
M04-discover flagged (mobile-viewport CSS horizontal overflow, cosmetic, no data/functionality
loss) is real and reproduces live. However, on the specific task re-tested here (DIR-004), the
overflow is NOT on the `<h1>` page title itself (which wraps cleanly, evidenced above) — it is on
an unbroken long URL string inside the task's rendered markdown body content. This is the same
missing-CSS-rule bug class (no `overflow-wrap: break-word` / `word-break: break-word` on
markdown-rendered content), just observed on a different concrete element than the original
narrative named. Not every task title will overflow (most titles have spaces and wrap normally,
as DIR-004's own title demonstrates); the underlying CSS gap is real regardless of which specific
task/string triggers it.

## Value-type / cov disposition

**CONFIRMED — Web UI cov = 0.92, unchanged.** Removing the ⚠️ PROVISIONALLY UNCERTAIN annotation
in `dashboard.md` (diff below) because the evidence gap DIR-006 flagged (curl-only evidence for a
Web UI rendering claim) is now closed with a real `mcp__playwright__*` tool-call trace, covering
both configured viewports, per the charter's Done-when 1. This is NOT a cov-number correction —
both UQ-049 and UQ-050 reproduce with live evidence in essentially the same shape M04-discover
originally reported (UQ-050's root-cause attribution is refined, not its existence or severity).
Per the charter's value-typed ledger, this milestone's value type is **discovery** (independent
audit channel re-checking a provisionally-uncertain claim) + **risk/option** (closes the DIR-006
evidence gap) — explicitly NOT capability-growth, and Δv = 0 (no VT chart-1 change; 0.92×20=18.40
unchanged). No instrument-correction applies since the number did not move.

## `dashboard.md` diff (Web UI row)

```diff
- | Web UI | 0.95 | **0.92** ⚠️PROVISIONALLY UNCERTAIN | list/detail/filter/sort/label-nav/action-gate flows all verified live at desktop (1280x900) and mobile (390x844 emulated touch) viewports — core functionality intact and correctly gated (Advance blocks/errors with no AC checkboxes). Two new minor/low findings: UQ-049 (...) and UQ-050 (mobile title-text CSS overflow, cosmetic, DOM/functionality intact). Small deduction (0.03) for these two, not zero, since UQ-049 is a genuine no-error-signal usability gap. **⚠️ PROVISIONALLY UNCERTAIN annotation added at M10-audit-consolidation (m10, 2026-07-18, DIR-006):** ... Actual re-verification is explicitly deferred (out of this milestone's scope, per DIR-006 item 3) — tracked as `M-WEBUI-REVERIFY` in `backlog.md`. |
+ | Web UI | 0.95 | **0.92 CONFIRMED** | list/detail/filter/sort/label-nav/action-gate flows all verified live at desktop (1280x900) and mobile (390x844 emulated touch) viewports — core functionality intact and correctly gated (Advance blocks/errors with no AC checkboxes). Two new minor/low findings: UQ-049 (...) and UQ-050 (mobile-viewport CSS horizontal overflow, cosmetic, DOM/functionality intact). Small deduction (0.03) for these two, not zero, since UQ-049 is a genuine no-error-signal usability gap. **CONFIRMED at M11-webui-reverify (m11, 2026-07-18):** re-verified with REAL `mcp__playwright__*` tool-call traces (navigate + snapshot/screenshot, both viewports) — see `milestones/M11-webui-reverify/iterations/iteration-0.md` for the full pasted trace. UQ-049 reproduces identically ... UQ-050 reproduces as a genuine live horizontal-overflow bug, though live DOM inspection pins the overflowing element more precisely ... 0.92 retained unchanged (no Δv — pure instrument re-derivation, not a correction) ...
```//(full text as committed in dashboard.md; see the file itself for the complete replacement)

## No product code touched

```
$ git status --short packages/
(no output — packages/ untouched)
```
Confirmed: this iteration is verification-only. `packages/quay/src/serve.js`'s missing
`overflow-wrap`/`word-break` CSS rule (the root cause behind UQ-050) was inspected/read but NOT
edited.

## New product issue found?

**No new issue beyond UQ-049/UQ-050.** UQ-050's root-cause attribution was refined (unbroken-URL
body content vs. h1 title) but this is the SAME already-tracked finding (same underlying missing
CSS rule, same cov deduction), not a new backlog candidate. Explicit statement per the charter's
Done-when 4: **no new issues found this iteration.**

## `backlog.md` diff (M-WEBUI-REVERIFY row)

Row's status column changed from "Not yet charter-ready" to:
```
**DONE** (m11, 2026-07-18, iteration-0 — real `mcp__playwright__*` tool-call trace at both desktop
1280×900 and mobile 390×844 viewports, covering list/detail/filter/search/action-flow pages;
UQ-049 reproduced live (`?search=` no-ops, `?q=` correctly filters 169→9 tasks); UQ-050 reproduced
live as genuine mobile horizontal overflow, with a refined root-cause pin (unbroken long URL in
task body content, not the `<h1>` title, on the specific task re-tested) — CONFIRMED 0.92
unchanged (⚠️ PROVISIONALLY UNCERTAIN annotation removed in `dashboard.md`, no Δv, value type
discovery+risk/option not capability-growth). No new product issue found beyond UQ-049/UQ-050's
own refined attribution; no product code touched. See
`milestones/M11-webui-reverify/iterations/iteration-0.md` for full trace.)
```
(full diff visible via `git diff` in this worktree — both `dashboard.md` and `backlog.md` are
modified files, committed below.)

## Done-when clause self-check (6 clauses)

1. `[x]` Pasted `mcp__playwright__*` trace exists — navigation + screenshot/snapshot at BOTH
   desktop (1280×900) and mobile (390×844), covering list/detail/filter/search/action-flow pages.
   See sections above.
2. `[x]` UQ-049 and UQ-050 each explicitly re-checked with live evidence, status recorded
   (both STILL PRESENT, with supporting traces).
3. `[x]` `dashboard.md`'s Web UI row updated — ⚠️ PROVISIONALLY UNCERTAIN annotation removed, 0.92
   CONFIRMED, live evidence cited in place of the old curl-only citation. Diff above.
4. `[x]` No product code touched (`git status --short packages/` empty, confirmed above); no new
   product issue found beyond UQ-049/UQ-050 (explicit statement above).
5. `[x]` `backlog.md`'s `M-WEBUI-REVERIFY` row marked DONE with realized-outcome summary (diff
   above), mirroring the M-GH-WRITE/M-GH-PARENT precedent.
6. `[ ]` **Adversarial-audit cadence rule (condition (a)):** this milestone's charter explicitly
   states its ABSORB "may append a nonzero Web UI cov Δv" and that condition (a) (VT-scoring)
   therefore applies, requiring the OUTER loop to dispatch the out-of-band adversarial-audit role
   (`iteration-N-adversarial-audit.md`, fresh-context `baime:iteration-executor`, dispatched by
   the OUTER loop itself, NOT folded into this inner iteration) BEFORE the VT-curve append / Done-
   when-complete claim. **This inner iteration-0 cannot itself satisfy clause 6** — it is
   structurally an out-of-band step the outer loop must perform separately, per the charter's own
   text ("dispatched by the OUTER loop itself"). Recording explicitly here (not silently omitting):
   clause 6 is NOT YET satisfied by this report; the OUTER-LOOP session must dispatch the
   adversarial-audit role and record its verdict (REFUTED / CONCERNS / NO REFUTATION FOUND) before
   treating this milestone's Done-when-complete claim (clauses 1-5, all met) as final and before
   the VT curve reflects this milestone's (zero) Δv.

**Milestone status this iteration: clauses 1-5 met; clause 6 (adversarial-audit dispatch) is an
outer-loop-owned follow-up, explicitly flagged, not silently skipped.**
