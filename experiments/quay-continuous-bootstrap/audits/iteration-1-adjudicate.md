# G3 Audit — Iteration 1

**Auditor**: fresh context (independent invocation, not the iteration-executor session)
**Commit**: 36c0a58
**Date**: 2026-07-17

## Changes reviewed

Source files modified:
- `packages/quay/bin/quay.js` — `printHelp()` function + `--help`/`-h` detection + `--prefix` client-side filter on `task list`
- `packages/quay/src/mcp-server.js` — `prefix: z.string().optional()` added to `task_list` inputSchema; client-side filter after provider fetch
- `packages/quay/src/serve.js` — `?prefix=` query param parsed; prefix filter applied before status/label filters; `allPrefixes` detection; `prefixNav` HTML row; `buildHref()` extended with `prefix` param; all nav links carry `prefixFilter` through

Test files modified:
- `packages/quay/test/cli.test.mjs` — tests 13 (prefix filter) and 14 (help output)
- `packages/quay/test/mcp-server.test.mjs` — test 12 (MCP prefix filter)
- `packages/quay/test/serve.test.mjs` — Web UI prefix filter test

Task files added: `tasks/QX-002.md`, `tasks/QX-003.md`, `tasks/QX-004.md`, `tasks/QX-005.md`

Experiment files updated: `experiments/quay-continuous-bootstrap/gap-list.md`, `iterations/iteration-1.md`, `provenance.md`

---

## Core-stays-dumb check

**Finding: PASS**

No backend-specific conditional rendering found anywhere in the diff. Searched all three source files for patterns like `github`, `gitlab`, `backend`, `provider ===`, and `if provider` — zero hits on added lines. The prefix filter is applied identically regardless of which provider backend is active (native, GitHub, or any future provider). The filter operates entirely on the `tasks` array returned from the provider, after the provider fetch, with no provider-aware branching.

The `allPrefixes` extraction in `serve.js` reads task ids uniformly from whatever the backend returns. The MCP `task_list` tool applies the same `.toUpperCase().startsWith(prefix.toUpperCase())` logic regardless of provider. This is exactly the correct pattern for a read-only filtering feature: the Core layer stays backend-agnostic.

---

## Correctness check

**Finding: PASS WITH ONE MINOR NOTE**

**Prefix filter logic (all three surfaces):**
- Filter expression: `t.id.toUpperCase().startsWith(prefix.toUpperCase())` — correct. Case-insensitive via `.toUpperCase()` on both sides. Applied after provider fetch (client-side), no provider-side changes needed.
- Applied before status/label filters in `serve.js` — correct order. Prefix scopes the view first, then status/label narrow within that scope.
- No-prefix path correctly bypasses the filter (`prefix ? [...filter...] : tasks`) — no regression on unfiltered queries.
- Non-matching prefix returns empty array, not an error — correct and consistent with existing status/label filter behavior.

**Help output (`printHelp`):**
- Top-level `--help`/`-h`: caught before `cmd` is evaluated — correct. Handles `quay --help` and `quay -h`.
- `quay task --help`: `sub === "--help"` triggers `printHelp("task")` — correct, full usage printed.
- `quay task list --help`: `sub === "list"`, `flags.help === true` → `printHelp("task")` — correct.
- `quay task list --help` is caught before the `if (cmd === "task" && sub === "list")` branch — no flag parsing or provider call happens when help is requested — correct.
- Unknown command after help flag addition: still exits 1 and prints to stderr — verified by test 14.

**Minor note — silent no-output for non-task subcommand help:**
`quay serve --help` and `quay action --help` enter `printHelp("serve")` / `printHelp("action")` respectively. The `printHelp` function only prints when `!sub || sub === "task"`, so both calls return silently with exit 0 and no output. This is not a regression (serve/action help was equally absent before), and it is a UX-minor gap rather than a correctness bug — `serve --help` exits 0 with no output instead of showing even a stub. This gap is not covered by any existing or new test. It is noted here as a candidate for a future gap entry (not a G3 FAIL criterion).

**Prefix nav in serve.js:**
- Only rendered when `allPrefixes.length >= 2` — prevents clutter in single-experiment workspaces. Correct.
- Prefix nav computed from `allTasks` (unfiltered) — correct; nav should always show all available prefixes, not just the ones visible in the current filter.
- All nav links (filter, sort, label, page) thread `prefixFilter` through `buildHref()` — verified in diff. No link drops the prefix when navigating within a filtered view.

**Duplicate comment in serve.js:**
Lines 419–420 in the current `serve.js` contain an exact duplicate of the comment `// QW-007: page navigation — Previous / Next links with page info.` introduced by this commit. This is a cosmetic defect (no functional impact) introduced when the QX-004 comment was inserted adjacently to an existing identical comment. Not a correctness issue; noted for cleanliness.

---

## Test suite results

Command run: `node --test packages/quay/test/*.mjs`

```
✔ packages/quay/test/action-mock-delivery.test.mjs
✔ packages/quay/test/cli.test.mjs
✔ packages/quay/test/config.test.mjs
✔ packages/quay/test/core-three-way-symmetry.test.mjs
✔ packages/quay/test/mcp-server.test.mjs
✔ packages/quay/test/provider-env-symmetry.test.mjs
✔ packages/quay/test/serve-action-delivery.test.mjs
✔ packages/quay/test/serve-browser-render.test.mjs
✔ packages/quay/test/serve-github.test.mjs
✔ packages/quay/test/serve.test.mjs
✔ packages/quay/test/task-check.test.mjs
✔ packages/quay/test/web-ui-browser.test.mjs

ℹ tests 12
ℹ pass 12
ℹ fail 0
```

Total individual assertions across the full run: 413 PASS, 0 FAIL. All 12 test file suites passed with no failures, no cancellations, no skips.

The iteration report claimed "30/30 existing tests pass; new tests pass." The test suite counter shows 12 suites (one per file), each internally exercising multiple assertions. The 413 individual PASS assertions confirm full green. No regression detected.

---

## Test coverage assessment

**Finding: PASS**

New tests independently re-derived and verified:

**Test 13 (cli.test.mjs) — CLI prefix filter:**
- Creates isolated workspace with tasks PRFA-001, PRFA-002, PRFB-001
- Verifies `--prefix PRFA` returns only PRFA-* tasks (inclusion and exclusion)
- Verifies `--prefix PRFA --json` returns a parseable JSON array of exactly 2 tasks
- Verifies case-insensitive match via `--prefix prfa` (lowercase)
- Verifies no-prefix regression: all 3 tasks returned
- Verifies filter indicator ("filtered") appears in non-JSON output
- Coverage is complete for the stated feature: inclusion, exclusion, case-insensitivity, JSON mode, no-filter regression

**Test 14 (cli.test.mjs) — CLI help:**
- Verifies `quay --help` exits 0 and includes "Usage:", "task list", "task view", "--prefix", "quay"
- Verifies `-h` alias also exits 0 and includes "Usage:"
- Verifies `quay task list --help` exits 0 and mentions "--prefix" and "--status"
- Verifies unknown command still exits 1 with "usage:" on stderr (no regression)
- Coverage closes VC-001 as claimed; the unknown-command regression guard is correct

**Test 12 (mcp-server.test.mjs) — MCP prefix filter:**
- Seeds PFXA-001, PFXA-002, PFXB-001 in isolated workspace
- Verifies `task_list {prefix: "PFXA"}` returns only PFXA-* tasks
- Verifies `structuredContent.tasks` contains both PFXA-001 and PFXA-002
- Verifies PFXB-001 excluded
- Verifies case-insensitive via lowercase `prefix: "pfxa"`
- Verifies no-prefix returns all 3 tasks
- Verifies non-matching prefix returns empty array (not an error)
- Coverage: thorough. The "non-matching returns empty, not error" case is a boundary case correctly covered.

**serve.test.mjs — Web UI prefix filter:**
- Isolated server with PFXA-1, PFXB-1
- Verifies `/?prefix=PFXA` returns 200, includes PFXA-1, excludes PFXB-1
- Verifies `/?prefix=PFXB` returns 200, includes PFXB-1, excludes PFXA-1
- Verifies no-filter regression: both tasks included
- Verifies "Prefix:" nav row appears in no-filter response (confirming 2+ prefixes trigger nav)
- Verifies case-insensitive via `/?prefix=pfxa`
- Coverage is thorough for the Web UI surface

**Gap in new test coverage:** `quay serve --help` and `quay action --help` producing silent exit 0 with no output is not tested. This is consistent with the existing test pattern (no test for serve/action subcommand help existence) and is not a regression, but it is an untested behavior introduced by this commit's flags.help catch-all. Minor; does not affect PASS/FAIL determination for a read-filter feature audit.

---

## Scope check (G5)

**Finding: PASS**

Work delivered is fully within the stated iteration 1 scope:
- CB-001: CLI `--prefix` filter — delivered (QX-002)
- CB-002: Web UI `?prefix=` filter + nav — delivered (QX-004)
- CB-009: MCP `task_list` prefix parameter — delivered (QX-003)
- UQ-001: CLI `--help` structured output — delivered (QX-005)
- UQ-002: CLI subcommand help — delivered (QX-005)
- VC-001: automated test for help output — delivered (test 14)

No out-of-scope work found silently folded in. The diff contains no modifications outside the six files named in scope (plus the four new task files QX-002..QX-005.md and the three experiment metadata files, all of which are expected artifacts of the protocol). No new write surfaces introduced. No new MCP tools registered. No provider-side changes. The `buildHref()` signature extension (adding `prefix` parameter) is a necessary internal refactor to carry prefix through all nav links — not a new feature, just the correct mechanical threading of an existing parameter.

The cosmetic duplicate comment at `serve.js:419–420` is a minor defect in scope, not out-of-scope addition.

---

## Verdict: PASS WITH NOTES

**Rationale:**

The commit delivers exactly what it claims: prefix filtering across all three surfaces (CLI, MCP, Web UI) plus structured CLI help. The implementation is correct, backend-agnostic, tested with genuine assertions (not just narrated), and introduces no new write surfaces. All 413 assertions pass across all 12 test suites with zero failures. No regressions detected.

**Two notes carried forward** (neither rises to a FAIL or required correction):

1. **Silent help for non-task subcommands**: `quay serve --help` and `quay action --help` exit 0 with no output — arguably better than an error exit but potentially confusing. This is a new untested behavior introduced by the broad `flags.help` catch-all in the help dispatch logic. Recommend adding a gap entry (UQ candidate) for future iteration and/or adding a stub output in `printHelp` for unrecognized subcommands.

2. **Duplicate comment in serve.js line 419–420**: `// QW-007: page navigation — Previous / Next links with page info.` appears twice consecutively. Cosmetic; zero functional impact. Recommend cleanup in a future pass.

Neither note affects the correctness of the delivered features. G3 co-signs this iteration's σ contribution for QX-002, QX-003, QX-004, and QX-005.
