# Gap List — quay-continuous-bootstrap (Experiment 4)

**Storage decision**: plain markdown file (chosen at iteration 0, recorded in provenance.md).
**Format**: each entry has id, dimension, description, severity, source, date added, and status (open/closed + evidence).

---

## Open gaps

### capability_breadth

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| CB-006 | Configurable page size not available on Web UI list page (fixed at 20) | minor | direct-observation (human, 2026-07-17) + simulated-user (cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| ~~CB-007~~ | ~~No full-text/title search in CLI or Web UI~~ | ~~significant~~ | Closed iteration 5 — QX-021; `--search` on CLI + `?q=` on Web UI |
| CB-008 | No packaging/distribution — users must install Node.js ≥20 separately; no single-file executables (DIR-004) | significant | directive (DIR-004, experiment 3) | 2026-07-17 | 2026-07-17 |
| CB-010 | `task_list` MCP tool response size (550K chars for 94 tasks) exceeds inline processing limits — partially addressed by CB-009 prefix filter but full response still large when no prefix is used | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |
| CB-014 | MCP `task_list` schema still shows stale version in live Claude Code session (`prefix` absent in ToolSearch cache) — structural: CB-011's "fix" (new session) did not permanently resolve the underlying session-cache lifecycle; requires a session-independent fix (version header, or MCP reconnect signal) | significant | simulated-user (cross-experiment maintainer, iteration 4) | 2026-07-17 | 2026-07-17 |
| CB-015 | MCP `task_list` has no multi-label filter parity — CLI and Web UI both support multi-label AND-join (`--label A --label B` / `?label=A&label=B`); MCP `task_list` only accepts a single `label` string parameter | minor | simulated-user (cross-experiment, iteration 4) | 2026-07-17 | 2026-07-17 |
| ~~CB-016~~ | ~~Search is title-only; body/description content is not searchable. Significant gap vs. GitHub Issues / Linear where full-text body search is standard~~ | ~~significant~~ | Closed iteration 6 — QX-023; search now matches title + body content; cli.test.mjs + serve.test.mjs body-search tests added |
| ~~CB-017~~ | ~~Body search produces false positives for structural markdown heading terms~~ | ~~significant~~ | Closed iteration 7 — QX-028; stripHeadings() added to both CLI and Web UI search paths; heading lines excluded from body search index; tests added |

### usability_quality

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| ~~UQ-004~~ | ~~No timestamp column in CLI list output~~ | ~~minor~~ | Closed iteration 5 — QX-022; "updated" column added to non-JSON CLI output |
| UQ-006 | Label filter on Web UI is a flat 40+ item inline list — likely unwieldy on mobile viewport | minor | simulated-user (comparison reviewer + cross-experiment maintainer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-007 | Web UI task list table (5 columns) may overflow on narrow mobile viewports — not live-verified | minor | simulated-user (comparison reviewer, iteration 0) | 2026-07-17 | 2026-07-17 |
| UQ-008 | MCP task_list response too large for inline context — no streaming or pagination at MCP layer (full unfiltered response remains large) | significant | simulated-user (cross-experiment maintainer, iteration 0) + direct-observation | 2026-07-17 | 2026-07-17 |
| ~~UQ-019~~ | ~~Multi-label filter label-nav replaces entire filter instead of toggling individual labels~~ | ~~significant~~ | Closed iteration 5 — QX-020; label nav now uses toggle semantics; active labels shown bold |
| UQ-020 | CLI `task list` returns empty output (no rows, no message) with no "0 tasks found" line when filter matches nothing — user cannot distinguish "no matches" from "command failed silently" | minor | simulated-user (cross-experiment maintainer, iteration 4) | 2026-07-17 | 2026-07-17 |
| UQ-021 | `--label` with no value is silently ignored (returns all tasks), while `--prefix` with no value exits with error (QX-006) — inconsistency in flag validation | minor | simulated-user (cross-experiment maintainer, iteration 4) | 2026-07-17 | 2026-07-17 |
| UQ-022 | `needs-human` task detail page shows empty space where Advance button would be — no call-to-action, no explanatory text, no guidance on what action the human should take | minor | simulated-user (comparison-reviewer, iteration 4) | 2026-07-17 | 2026-07-17 |
| ~~UQ-023~~ | ~~Redundant `statSync` in `store.js list()` after QX-018 changes — `get()` already fetches mtime and sets `updatedAt`; `list()`'s subsequent post-`get()` stat call is redundant (same value, stale comment)~~ | ~~minor~~ | Closed iteration 6 — QX-025; redundant statSync block removed from list() in store.js; existing tests confirm no regression |
| ~~UQ-024~~ | ~~`--search <query>` returns 0 results when a user searches for a label name with no hint to use `--label` instead — new-contributor persona found this disorienting~~ | ~~minor~~ | Closed iteration 6 — QX-025; zero-result hint added to CLI non-JSON output; cli.test.mjs test added |
| ~~UQ-025~~ | ~~Label navigation degrades at 40+ distinct labels — becomes a flat wall with no grouping, truncation, or search; significant at scale~~ | ~~significant~~ | Closed iteration 6 — QX-024; label nav truncated at 25 with "… N more labels" note; serve.test.mjs test added |
| ~~UQ-026~~ | ~~The "clear" search link in the Web UI resets all active filters (status, labels, sort) rather than just clearing the `?q=` query~~ | ~~minor~~ | Closed iteration 6 — QX-025; confirmed clear link uses buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, null) — preserves all filters except q; serve.test.mjs test confirms href includes status=todo when other filters active |
| ~~UQ-027~~ | ~~Active label hidden by alphabetic label nav truncation~~ | ~~significant~~ | Closed iteration 7 — QX-026; active label pinning implemented; active filters always appear in visible nav regardless of position |
| ~~UQ-028~~ | ~~Label nav uses alphabetic ordering rather than frequency-based ordering~~ | ~~significant~~ | Closed iteration 7 — QX-026; frequency-based sort implemented (most-used labels first, then alphabetically within equal counts); tests added |
| ~~UQ-029~~ | ~~Documentation staleness — --help says "title substring", placeholder says "Search titles…"~~ | ~~significant~~ | Closed iteration 7 — QX-027; help text updated to "title/body content (case-insensitive)"; example updated; placeholder updated to "Search titles and descriptions…" |
| UQ-030 | Search form is positioned below the label navigation wall on mobile (375px). At 46 labels, the above-the-fold area is consumed by label nav before the search form appears. Fix: move search form above label nav, or add CSS `order` to prioritize it on narrow screens. | minor | simulated-user (mobile-only, iteration 6) | 2026-07-17 | 2026-07-17 |
| UQ-031 | No search result highlighting — matching query terms are not highlighted in task list results; users must visually scan to find why a result matched. | minor | simulated-user (comparison-reviewer, iteration 7) | 2026-07-17 | 2026-07-17 |
| UQ-032 | No label count display in nav — label nav shows label names only without task counts; users cannot see which labels are most-used directly from the nav. | minor | simulated-user (comparison-reviewer, iteration 7) | 2026-07-17 | 2026-07-17 |
| UQ-033 | "N more labels" is non-interactive — no way to expand or see all hidden labels without editing the URL; non-interactive text with no expand path. | minor | simulated-user (comparison-reviewer, iteration 7) | 2026-07-17 | 2026-07-17 |

### verification_coverage

*(No open gaps — VC-001 closed iteration 1: CLI help content now has automated test coverage)*

### system_health

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| SH-003 | `stripHeadings()` strips `#`-prefixed lines inside fenced code blocks (false negative — e.g., `# comment` inside a code block would be excluded from body search). Low practical impact; worth fixing if code-heavy task bodies become common. | minor | G3 audit (PASS-WITH-NOTES, iteration 7) | 2026-07-17 | 2026-07-17 |

### process (experiment self-execution — outside the four V_instance dimensions; tracked here because it affects whether steering directives actually take effect)

| ID | Description | Severity | Source | Date added | Last confirmed open |
|----|-------------|----------|--------|------------|---------------------|
| PR-001 | §0 precondition step "list `directives/pending/` and give every file an explicit applied/deferred/rejected outcome" is not being genuinely re-executed each iteration. Iterations 1, 2, and 3 each contain the exact same verbatim boilerplate line — "directives/pending/ listed: DIR-004 remains pending (in scope, not yet prioritized)" — with no `ls` output shown and no mention of DIR-005 (committed 2026-07-17 04:05:28, before iteration 1 started 04:15:13) or DIR-006 (committed 2026-07-17 05:09:30, before iteration 3 started 05:26:24), even though both were present in `directives/pending/` well before the relevant iteration began. A worktree branch-point-staleness hypothesis was tested directly (`git worktree list`, `ls` inside each iteration's own worktree checkout, `git merge-base --is-ancestor`) and disproven for iterations 2 and 3 — both the worktree checkout and the main tree had the files present at iteration start. Net effect: DIR-005 and DIR-006 have gone unacknowledged by three consecutive iterations despite satisfying every documented precondition for being picked up — the directive mechanism itself is not currently reliable, independent of any individual directive's content. | blocking | direct-observation (human-directed investigation, this steering conversation) + commit-timestamp cross-reference against `iterations/iteration-{1,2,3}.md` | 2026-07-17 | 2026-07-17 |

---

## Closed gaps

### capability_breadth

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| CB-001 | No prefix/experiment filter in CLI (`quay task list`) — returns all experiments' tasks in one flat list | iteration 1 | QX-002 (done); `quay task list --prefix QX` implemented and tested in `packages/quay/test/cli.test.mjs` test 13 |
| CB-002 | No prefix/experiment filter in Web UI list page — no "show only QX-*" affordance | iteration 1 | QX-004 (done); `?prefix=QX` query param + Prefix nav row implemented and tested in `packages/quay/test/serve.test.mjs` |
| CB-003 | Action buttons ("Advance") missing from Web UI list page — only on task detail page | iteration 2 | QX-009 (done); inline action buttons added to each list row; POST with ?from= redirects back to list; tested in `packages/quay/test/serve.test.mjs` QX-009 block |
| CB-004 | No sort-by-time (created/updated) on CLI task list | iteration 2 | QX-008 (done); `--sort updated` now sorts by file mtime descending; tested in `packages/quay/test/cli.test.mjs` test 17 |
| CB-005 | No sort-by-time (created/updated) on Web UI list page | iteration 2 | QX-008 (done); `?sort=updated` + "Updated ↓" nav link; tested in `packages/quay/test/serve.test.mjs` QX-008 block |
| CB-009 | `task_list` MCP tool has no prefix/experiment filter — returns all 94 tasks requiring post-processing | iteration 1 | QX-003 (done); `prefix` parameter added to `task_list` MCP tool, tested in `packages/quay/test/mcp-server.test.mjs` test 12 |
| CB-011 | MCP `task_list` registered schema in Claude Code does not include `prefix` parameter (stale snapshot) | iteration 2 | QX-010 (done); server code already correct since QX-003; automated `tools/list` schema test added in `packages/quay/test/mcp-server.test.mjs` Block 13 confirming `prefix` in inputSchema; stale session cache resolved by new session |
| CB-012 | `--sort updated` silently ignored in CLI `task list` | iteration 2 | QX-008 (done); `--sort updated` now correctly sorts by file mtime (not silently falls through to default order); CLI test 17 proves non-default ordering |
| CB-007 | No full-text/title search in CLI or Web UI | iteration 5 | QX-021 (done); `--search <query>` on CLI (case-insensitive substring, test 19 cli.test.mjs); `?q=<query>` on Web UI with GET form (QX-020/021 block serve.test.mjs) |
| CB-013 | Multi-label filtering broken: CLI last-wins; Web UI first-wins; surfaces inconsistent | iteration 4 | QX-016 (done); parseFlags() collects repeated --label flags as array; CLI AND-logic filter; Web UI uses searchParams.getAll('label') + AND-filter; buildHref() supports array label; cli.test.mjs test 18 + serve.test.mjs QX-016..019 block; commit 446d95a |

### usability_quality

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| UQ-001 | CLI `--help` returns one line — no project description, no subcommand docs, no examples | iteration 1 | QX-005 (done); `quay --help` now prints structured usage guide with all subcommands and examples |
| UQ-002 | CLI subcommand help is missing or shows error messages instead of usage | iteration 1 | QX-005 (done); `quay task --help` and `quay task list --help` now print usage documentation |
| UQ-003 | No onboarding/orientation content in Web UI — significant barrier for new contributors | iteration 3 | QX-015 (done); orientation banner added to list page with project description and status lifecycle; serve.test.mjs assertion; commit f4b3b8d |
| UQ-009 | Back link from task detail page drops filter/prefix context | iteration 3 | QX-011 (done); task title links on list page include ?from= param; detail page back link uses from= value with open-redirect guard; serve.test.mjs block; commit f4b3b8d |
| UQ-010 | `quay serve --help` and `quay action --help` silently exit with no output | iteration 1 | QX-007 (done); `printHelp()` now emits a stub usage line for unrecognised subcommands; test 16 in cli.test.mjs asserts non-empty output |
| UQ-011 | Advance button (actions column) hidden off-screen at 375px viewport | iteration 4 (FULLY CLOSED) | QX-017 (done); .col-actions CSS class added to th/td; position:sticky;right:0;z-index:2 in @media (max-width:600px) block; Advance button always visible even when table scrolls horizontally; serve.test.mjs QX-016..019 block; commit 446d95a |
| UQ-012 | Table role and labels columns not hidden at mobile viewport (≤600px) | iteration 3 | QX-012 (done); .col-role and .col-labels hidden in @media (max-width: 600px) block; serve.test.mjs assertion; commit f4b3b8d |
| UQ-013 | Gate-fail feedback is silent — page silently refreshes when Advance is blocked | iteration 3 | QX-013 (done); gate check added to action POST handler; ?error= redirect on gate-fail; error/success banners on list and detail pages; serve.test.mjs block; commit f4b3b8d |
| UQ-014 | Advance button has no tooltip, no hover text, no post-action confirmation | iteration 3 | QX-014 (done); title="Advance task to next status" on list page buttons; title="Advance to [next]" on detail page buttons; serve.test.mjs assertion; commit f4b3b8d |
| UQ-005 | No visual age indicator on Web UI list rows ("updated X ago") | iteration 4 | Closed as duplicate — covered by UQ-017 (updatedAt display, closed in iteration 4 via QX-018). Source: simulated-user (comparison reviewer, iteration 0); confirmed duplicate by comparison reviewer, iteration 4. |
| UQ-015 | `updatedAt` field absent from `task_get` MCP tool response — asymmetry between task_list and task_get | iteration 4 | QX-018 (done); store.js get() now includes updatedAt (file mtime via statSync); closes asymmetry with list() path; commit 446d95a |
| UQ-016 | Orientation banner shows wrong status model (`in_progress` listed, does not exist; `ready` missing) | iteration 3 (found + closed same iteration) | Banner text corrected to `todo → ready → needs-human → done`; test added to serve.test.mjs asserting banner does NOT contain `in_progress` and DOES contain `ready`; source: simulated-user (comparison-reviewer, iteration 3); commit 05a8ec9 |
| UQ-017 | `updatedAt` timestamp tracked but never displayed on list or detail page | iteration 4 | QX-018 (done); relativeTime() helper added to serve.js; "updated" column on list page + "last updated" meta on detail page; serve.test.mjs QX-016..019 block; commit 446d95a |
| UQ-004 | No timestamp column in CLI list output | iteration 5 | QX-022 (done); relativeTimeCli() helper added to bin/quay.js; 5th tab-separated column added to non-JSON output; cli.test.mjs test 19 |
| UQ-018 | List-page Advance button tooltip generic vs detail-page target-status | iteration 4 | QX-019 (done); listNextStatusMap lookup per task in row renderer; list now shows "Advance to ready" for todo, "Advance to done" for ready; serve.test.mjs assertion; commit 446d95a |
| UQ-019 | Multi-label filter label-nav replaces entire filter instead of toggling | iteration 5 | QX-020 (done); label nav uses toggle semantics (add if inactive, remove if active); active labels shown bold in multi-label state; "All" clear link shown when 2+ labels active; serve.test.mjs QX-020/021 block |
| CB-016 | Search is title-only; body/description content is not searchable | iteration 6 | QX-023 (done); search now matches `(t.title + ' ' + (t.body || '')).toLowerCase()` in CLI + Web UI; serve.test.mjs QX-023 body-search block; cli.test.mjs BSRCH-1/BSRCH-2 body-search tests |
| CB-017 | Body search template boilerplate false positives | iteration 7 | QX-028 (done); stripHeadings() added to CLI + Web UI search paths; heading lines excluded; serve.test.mjs QX-028 block (HDNG-1/HDNG-2 tests); cli.test.mjs test 20 |
| UQ-025 | Label navigation degrades at 40+ distinct labels — flat wall with no truncation | iteration 6 | QX-024 (done); LABEL_NAV_MAX=25; visibleLabels = allLabels.slice(0,25); hiddenLabelCount>0 appends "… N more labels" note; serve.test.mjs "5 more labels" test with 30 labels |
| UQ-023 | Redundant statSync in store.js list() after QX-018 | iteration 6 | QX-025 (done); redundant statSync block removed from list(); get() already sets updatedAt; existing tests confirm no regression |
| UQ-024 | --search returns 0 results with no hint to use --label | iteration 6 | QX-025 (done); zero-result hint added to CLI output when sorted.length===0 && searchQuery!==null; cli.test.mjs BSRCH-2/no-match test |
| UQ-026 | Web UI clear search link resets all filters not just ?q= | iteration 6 | QX-025 (done); confirmed clear link uses buildHref(statusFilter, sortKey, labelFilters, null, prefixFilter, null) — null q omits q param but preserves all other filters; serve.test.mjs clear-link-href test confirms status=todo preserved |
| UQ-027 | Active label hidden by alphabetic label nav truncation | iteration 7 | QX-026 (done); active-label pinning implemented; activeHidden labels prepended to pinnedFirst list before slice(0,25); serve.test.mjs QX-026b test (zzz-rare-z pinned to front) |
| UQ-028 | Label nav alphabetic ordering hides most-used labels | iteration 7 | QX-026 (done); frequency-based sort (labelCounts Map + sort by count desc then alpha); serve.test.mjs QX-026a test (freq-common before zzz-rare-*) |
| UQ-029 | Doc staleness — --help says "title substring", placeholder says "Search titles…" | iteration 7 | QX-027 (done); --help updated to "title/body content (case-insensitive)"; example updated to "in title or body"; placeholder updated to "Search titles and descriptions…"; cli.test.mjs test 20 + serve.test.mjs QX-027 test |

### verification_coverage

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| VC-001 | No automated test for CLI `--help` output content | iteration 1 | QX-005 (done); CLI test 14 in `packages/quay/test/cli.test.mjs` asserts `quay --help` exits 0 and includes expected content |

### system_health

| ID | Description | Closed in | Evidence |
|----|-------------|-----------|---------|
| SH-001 | `quay task list --prefix` (no value) crashes with `TypeError: prefix.toUpperCase is not a function` — regression from QX-002 | iteration 1 | QX-006 (done); guard added in `packages/quay/bin/quay.js`; test 15 in cli.test.mjs asserts exit 1 + usage error, no TypeError; all 30 test suites pass |
| SH-002 | Open-redirect guard for `?from=` back-link parameter accepts protocol-relative URLs (`//evil.com` passes `startsWith("/")` guard) | iteration 3 (found + closed same iteration) | Guard tightened to `startsWith("/") && !startsWith("//")` in serve.js line ~563; test added to serve.test.mjs asserting `?from=//evil.com` results in back-link `href="/"`; source: G3 audit (iteration 3); commit 05a8ec9 |

---

## Cumulative counter

- Iteration 0: 19 gaps added (CB-001..CB-010, UQ-001..UQ-008, VC-001); 0 closed
- Iteration 1: 5 new gaps found (CB-011, CB-012, UQ-009, UQ-010, SH-001); 9 gaps closed (CB-001, CB-002, CB-009, UQ-001, UQ-002, UQ-010, VC-001, SH-001) — note SH-001 was found and closed in the same iteration
- Iteration 2: 6 new gaps found (UQ-011, UQ-012, UQ-013, UQ-014, UQ-015 added; UQ-003 severity escalated from minor to significant); 5 gaps closed (CB-003, CB-004, CB-005, CB-011, CB-012)
- Iteration 3 (FINAL): development phase closed 6 gaps (UQ-003, UQ-009, UQ-011 partially, UQ-012, UQ-013, UQ-014); simulated-user + G3 found and closed 2 additional gaps (UQ-016, SH-002); simulated-user found 5 new gaps (CB-013, UQ-011 re-opened as still-significant, UQ-017, UQ-018, UQ-016→closed, SH-002→closed); net gaps closed this iteration: 8 (UQ-003, UQ-009, UQ-011 partial, UQ-012, UQ-013, UQ-014, UQ-016, SH-002)
- **Cumulative gaps closed (all-time, iteration 3 final): 22** (CB-001..005, CB-009, CB-011, CB-012, UQ-001..003, UQ-009..014, UQ-016, VC-001, SH-001, SH-002; UQ-011 partially closed/re-opened; CB-010 partially addressed)
- **Net open gaps after iteration 3 final**: 14 (5 CB, 9 UQ, 0 VC, 0 SH) — CB-006/007/008/010/013 open; UQ-004/005/006/007/008/011/015/017/018 open
- Post-iteration-3 steering (out of band, this conversation): 1 new gap found, PR-001 (process dimension — the `directives/pending/` precondition check has not been genuinely re-executed for 3 consecutive iterations, so DIR-005 and DIR-006 went unacknowledged despite being available before their respective iterations started). No DIR filed for this finding — filing another directive into a mechanism already shown not to be reliably read would not fix it; recorded directly here and in `provenance.md` instead, per explicit human instruction.
- Iteration 4 (FINAL): development phase closed 5 gaps (CB-013, UQ-011 fully, UQ-015, UQ-017, UQ-018); simulated-user + G3 found 7 new gaps (CB-014 significant, CB-015 minor, UQ-019 significant, UQ-020 minor, UQ-021 minor, UQ-022 minor, UQ-023 minor); UQ-005 closed as duplicate of UQ-017 (comparison reviewer, iteration 4); total gaps closed this iteration: 6 (CB-013, UQ-005 as duplicate, UQ-011, UQ-015, UQ-017, UQ-018)
- **Cumulative gaps closed (all-time, iteration 4 final): 28** (adds CB-013, UQ-005 as duplicate closure, UQ-011 full, UQ-015, UQ-017, UQ-018)
- **Net open gaps after iteration 4 final**: 15 (6 CB, 9 UQ, 0 VC, 0 SH) + 1 process (PR-001) — CB-006/007/008/010/014/015 open; UQ-004/006/007/008/019/020/021/022/023 open
- Iteration 5 (development phase): closed CB-007 (QX-021), UQ-004 (QX-022), UQ-019 (QX-020); 3 gaps closed in development phase; G3 + simulated-user pending (dispatched by orchestrator)
- **Cumulative gaps closed (all-time, iteration 5 development phase): 31** (adds CB-007, UQ-004, UQ-019)
- **Net open gaps after iteration 5 development phase**: 12 (5 CB, 7 UQ, 0 VC, 0 SH) + 1 process — CB-006/008/010/014/015 open; UQ-006/007/008/020/021/022/023 open
- Iteration 5 (G3 + simulated-user, FINAL): G3 PASS; 3 persona simulated-user pass (new-contributor PASS, comparison-reviewer CONCERNS, cross-experiment-maintainer PASS); 4 new gaps logged (CB-016 significant, UQ-024 minor, UQ-025 significant, UQ-026 minor); 0 additional gaps closed in synthesis; cumulative gaps closed unchanged at 31
- **Cumulative gaps closed (all-time, iteration 5 FINAL): 31**
- **Net open gaps after iteration 5 FINAL**: 16 (6 CB, 10 UQ, 0 VC, 0 SH) + 1 process — CB-006/008/010/014/015/016 open; UQ-006/007/008/020/021/022/023/024/025/026 open
- Iteration 6 (development phase): closed CB-016 (QX-023), UQ-025 (QX-024), UQ-023 (QX-025), UQ-024 (QX-025), UQ-026 (QX-025); 5 gaps closed in development phase; G3 + simulated-user pending (dispatched by orchestrator)
- **Cumulative gaps closed (all-time, iteration 6 development phase): 36** (adds CB-016, UQ-023, UQ-024, UQ-025, UQ-026)
- **Net open gaps after iteration 6 development phase**: 11 (5 CB, 6 UQ, 0 VC, 0 SH) + 1 process — CB-006/008/010/014/015 open; UQ-006/007/008/020/021/022 open
- Iteration 6 (G3 + simulated-user, FINAL): G3 PASS-WITH-NOTES (C-5 correctness gap: active-label hidden by truncation); 1× FAIL (new-power-user), 2× CONCERNS (mobile-only, cross-experiment-maintainer); 5 new gaps logged (CB-017 significant, UQ-027 significant, UQ-028 significant, UQ-029 significant, UQ-030 minor); 0 additional gaps closed in synthesis; cumulative gaps closed unchanged at 36
- **Cumulative gaps closed (all-time, iteration 6 FINAL): 36**
- **Net open gaps after iteration 6 FINAL**: 16 (6 CB, 10 UQ, 0 VC, 0 SH) + 1 process — CB-006/008/010/014/015/017 open; UQ-006/007/008/020/021/022/027/028/029/030 open
- Iteration 7 (development phase): closed CB-017 (QX-028), UQ-027 (QX-026), UQ-028 (QX-026), UQ-029 (QX-027); 4 gaps closed in development phase; G3 + simulated-user pending (dispatched by orchestrator)
- **Cumulative gaps closed (all-time, iteration 7 development phase): 40** (adds CB-017, UQ-027, UQ-028, UQ-029)
- **Net open gaps after iteration 7 development phase**: 12 (5 CB, 7 UQ, 0 VC, 0 SH) + 1 process — CB-006/008/010/014/015 open; UQ-006/007/008/020/021/022/030 open
- Iteration 7 (G3 + simulated-user, FINAL): G3 PASS-WITH-NOTES (2 low-severity notes: stripHeadings code-block false-negative, phantom URL label edge case); 2× PASS (new-contributor, cross-experiment-maintainer), 1× CONCERNS (comparison-reviewer); 4 new gaps logged (SH-003 minor, UQ-031 minor, UQ-032 minor, UQ-033 minor); 0 additional gaps closed in synthesis; cumulative gaps closed unchanged at 40. Human operator issued HALT after iteration 7.
- **Cumulative gaps closed (all-time, iteration 7 FINAL): 40**
- **Net open gaps after iteration 7 FINAL (HALT state)**: 16 (5 CB, 10 UQ, 0 VC, 1 SH) + 1 process — CB-006/008/010/014/015 open; UQ-006/007/008/020/021/022/030/031/032/033 open; SH-003 open
