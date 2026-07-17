# G3 Adjudication — Iteration 18

**Verdict:** PASS-WITH-NOTES

---

## Test suite

12/12, 0 failures.

```
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 57236.942419
```

All 12 test files pass. No regressions.

---

## QX-064: README.md

PASS — Substantive and complete.

The file at `packages/quay/README.md` (163 lines) covers:
- **Installation**: Option A (global npm install from GitHub release artifact) + Option B (from source); Node.js >= 20 requirement.
- **CLI usage**: All flags — `--prefix`, `--status`, `--label` (AND-join repeatable), `--search`, `--sort`, `--page-size`, `--json`, `--format json`, `--version`, `--help`; concrete examples with jq.
- **Web UI**: `quay serve` invocation, port/host options, full feature list (filter, search, pageSize nav 10/20/50/100, sort, inline Advance buttons, gate-fail banner, mobile layout).
- **MCP server**: Claude Code `mcp.json` config block, tool table (task_list, task_get, task_write, task_check), full `task_list` parameters table (8 params), staleness detection guidance.
- **Configuration**: `.quay/config.yml` example.
- **Updating quay**: Process restart guidance (in-package mitigation for ENV-001).
- **License**: Pointer to LICENSE file.

`package.json` `files` field lists `"README.md"` and the file now exists at `packages/quay/README.md`. The ghost entry is resolved.

---

## QX-065: TST-003/004 precision

PASS.

**TST-003 (tightened TST-001):** The assertion at line 1567 extracts the Next link href via:
```js
const nextLinkMatch = body.match(/href="([^"]*page=2[^"]*)"/);
```
This anchors the match to a href containing `page=2` — correctly targeting the page-nav Next link rather than a pageSizeNav link. It then asserts `nextHref.includes("pageSize=3")`. This is a genuine precision improvement: the old `body.includes("pageSize=3")` could pass from incidental pageSizeNav matches.

**TST-004 (new):** The assertion at line 1587 fetches `/?pageSize=3&page=2` and extracts the Previous link href via:
```js
const prevLinkMatch = body.match(/href="([^"]*)"[^>]*>(?:&laquo; |«\s*)?Previous/);
```
It then asserts `prevHref.includes("pageSize=3")`. The regex handles both the HTML entity `&laquo;` and the literal `«` character, covering the actual rendered HTML. The logic reasoning is sound: `buildHref` omits `page=` when page=1 (the `pg>1` guard), so the Previous href on page 2 is `/?pageSize=3`, which the test correctly expects.

Both assertions are correctly anchored and would catch genuine regressions.

---

## PKG-007 (LICENSE ghost)

PRESENT in `files` field; file does NOT exist at the package level.

`package.json` lists `"LICENSE"` in `files`, but `packages/quay/LICENSE` does not exist. The LICENSE file exists at the worktree root (`experiments/quay-continuous-bootstrap/worktrees/iteration-18/LICENSE`) but npm pack resolves `files` entries relative to the package root (`packages/quay/`), so the LICENSE will be silently omitted from the npm artifact.

This gap was pre-existing in iteration-17's `package.json` (identical `files` field, confirmed by diff). The executor correctly identified it as a new observational gap (PKG-007) and logged it as found-not-fixed this iteration. The gap is inherited, not introduced in iteration-18. No regression; gap remains open for a future iteration.

---

## Worktree isolation

PASS.

Running `git status packages/quay/src packages/quay/bin packages/quay/test` on the main repo returned clean (nothing to commit). The worktree-scoped changes (`packages/quay/README.md` created, `packages/quay/test/serve.test.mjs` modified) are confined to the worktree. The shared tree is untouched.

---

## σ_QX

Previous: 59/61 = 0.967.

This iteration closes 2 tasks (QX-064, QX-065) and opens 1 new gap (PKG-007, mapped to a future QX task but not yet counted as authored). Per the standard σ_QX formula (closed / total-authored), the denominator grows only when a QX task is authored.

QX-064 and QX-065 are both authored and executed → 2 new numerator and denominator entries.
PKG-007 is noted but no QX-066 task is counted as authored this iteration (executor explicitly deferred QX-066 for MCP and did not author a PKG-007 QX task this iteration).

New σ_QX = 61/63 = **0.968**.

---

## Transfer_breadth = 1.0 assessment

DEFENSIBLE, with a minor caveat on simulated-user sourcing strength.

**Rubric requirements:**
(a) Gap sourced from simulated-user or directive lifecycle: PKG-006 was raised by a prior simulated-user audit (Persona C's finding — README.md absent from the package directory, ghost files entry). The simulated-user audit file `iteration-18-simulated-user-new-user-readme.md` confirms this is a genuine user-facing pain point.

(b) Corresponding QX task authored and executed via native methodology path: QX-064 was authored and executed in the native QX task system and committed as part of the iteration-18 worktree (`packages/quay/README.md` created, git show confirms this is the only source file touched for QX-064).

**Caveat:** The PKG-006 origin was an observational gap (ghost files entry) rather than a user directly saying "I couldn't find documentation." However, the simulated-user audit for iteration-18 (`iteration-18-simulated-user-new-user-readme.md`) was explicitly scoped to the docs/README surface — this is a legitimate methodology-chain sourcing. The README is substantive (163 lines covering all 4 surfaces: CLI, Web UI, MCP, installation/config). The docs surface was genuinely uncovered before this iteration.

**Verdict: DEFENSIBLE.** Transfer_breadth = 1.0 (5/5 surfaces now covered by at least one methodology-driven change) is a fair claim. The docs surface was the last uncovered surface, and QX-064 meets both rubric conditions. Not overstated.

---

## Gate status

σ_QX = 0.968. Gate **OPEN**.

Notes:
- PKG-007 (LICENSE ghost in `files`) is an open carry-forward gap. Not blocking.
- TST-003/004 precision improvements are correctly implemented and pass cleanly.
- transfer_breadth = 1.0 claim is defensible.
- No worktree isolation violations found.
