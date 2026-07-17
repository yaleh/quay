# Simulated User Audit — Iteration 11
**Persona**: Search power user (cross-experiment maintainer)
**Date**: 2026-07-17
**Verdict**: PASS

## SH-003 fix (stripHeadings fence tracking): VERIFIED

The fix is live in `packages/quay/src/serve.js` (lines 35–44). `stripHeadings()` now maintains
`inFence` state toggled by lines matching `/^```/`, and only applies the heading-strip regex
(`/^#+\s/`) when `!inFence`. Lines inside fenced code blocks (including `# bash comment` lines)
are preserved in the search index.

Test coverage confirmed in `packages/quay/test/serve.test.mjs` (QX-041 block, lines 1254–1319):
- Positive test: task with `# bash-comment-token` inside a code fence IS found by `?q=bash-comment-token`. PASS.
- Negative control: `## Proposal-outside-fence` heading outside a fence is NOT found by
  `?q=Proposal-outside-fence`. PASS.

Full test suite: 158 assertions, 0 failures.

## CLI search regression: PASS

- `--search "stripHeadings"` returns QX-028, QX-029, QX-041 — correct, all relevant tasks.
- `--search "fence"` returns QX-041 — correct.
- `--search "quay"` returns 30 tasks (full QX corpus that mentions "quay") — consistent with
  task content; no spurious inclusions or false negatives observed.

## Web UI / CLI search consistency: PASS

Initial comparison appeared to show a 30 vs 20 discrepancy. Investigation confirmed this is
pagination: the Web UI has a hard 20-tasks-per-page limit (PAGE_SIZE constant, QW-007). Both
pages combined yield the identical 30-task set as the CLI. No search-logic divergence detected;
both surfaces call the same `stripHeadings()` path in `serve.js`.

Note: the Web UI is running from a server process started at 09:41. Tasks created at 10:15
(QX-041, QX-042, QX-043) are served live via `statSync`-based file loading — no stale cache
observed. The server correctly returns these tasks in searches.

## Heading strip behavior: PASS

`--search "Proposal"` returns exactly 2 tasks (QX-028, QX-029). Both tasks genuinely discuss
the word "Proposal" in their prose body content (not just as a `## Proposal` section header).
All other ~41 QX tasks have `## Proposal` headings that are correctly stripped by
`stripHeadings()` and do not appear in results. The fix to fence tracking did not change this
behavior.

## New gaps found

1. **Web UI pagination not signposted in search context**: When searching with `?q=quay&prefix=QX`,
   the first page silently returns 20/30 results. There is a page counter ("Page 1 of 2") but
   no indication at the top of the list that results are paginated. A user comparing CLI output
   to Web UI would initially see different counts and could be confused. Low severity — existing
   gap, not introduced by this iteration.

2. **CLI `--format json` not supported**: `task list --format json` outputs a `#` comment line
   that breaks JSON parsing. Not a regression (this was not the focus of iteration 11), but
   noted as an ongoing gap for power users who want to script on search results. Existing gap.

No new gaps introduced by the SH-003 fix.

## Overall verdict

PASS

The `stripHeadings()` fence-tracking fix (SH-003/QX-041) is correctly implemented, has
automated test coverage with both positive and negative controls, and all 158 test assertions
pass. CLI and Web UI search results are consistent (pagination accounts for the page-size
difference). Heading strip behavior is unchanged for content outside fences. No regressions
detected.
