# Simulated-User Report — Iteration 13
# Persona: MCP AI Consumer + Cross-Surface Maintainer

**Date**: 2026-07-17
**Worktree under test**: `experiments/quay-continuous-bootstrap/worktrees/iteration-13`
**Shared-tree binary**: `packages/quay/bin/quay.js` (unchanged this iteration — changes are worktree-isolated)

**Overall verdict**: PASS (with standing ENV-001 caveat noted)

---

## MCP surface verification

### task_list — unfiltered call

`mcp__quay__task_list` (no params) returned 147 tasks total.

Top-level keys: `{tasks}` only — **no `_version`, `total`, `page`, `pageSize`, `totalPages` fields** in the response envelope.

Task objects contain: `body, children, extra, id, labels, parent, role, status, title` — **no `_version` field per task either**.

This is the ENV-001 stale-process condition. The MCP server this session connected to predates all experiment-4 MCP improvements. Evidence:

- Tool description (as registered): `"List tasks from an enabled Provider (defaults to the default-enabled Provider if \`provider\` is omitted), optionally filtered by status/label. Proxies the Provider's own task_list tool via Core's MCP client fan-out."` — this is the pre-QX-003/QX-029/QX-030/QX-035 description. The current `mcp-server.js` starts with `"Version: 0.1.0. List tasks... optionally filtered by status, label, prefix... Supports pagination..."`.
- Schema exposed to this session: `{label: string, provider: string, status: string}` only — 3 params. The current code registers 7: `{label, provider, status, prefix, search, page, pageSize}`.
- `label` type in session schema: single `z.string()`, not `z.union([z.array, z.string])`. This predates QX-032 (iteration 9 multi-label array support).

The running process was most likely started from a Jul15 or early-Jul16 terminal session using the shared-tree code that predated commit `36c0a58` ("experiment 4 iteration 1: prefix filtering") — i.e., it predates ALL 13 iterations of experiment 4.

**Impact on this verification**: `prefix`, `search`, `page`, and `pageSize` params passed to the tool call were silently ignored by the running server. Every `task_list` call returned all 147 unfiltered tasks.

### task_list — prefix + pagination call

Called `mcp__quay__task_list` with `prefix="QX"`, `page=1`, `pageSize=10`. Response: 147 tasks, no pagination metadata, all prefixes present (DIR, PC, QC, QN, QW, QX, SU, TEST). The stale server accepted the call without error but applied no filter — **graceful degradation** (no crash, no error), consistent with ENV-001 documented behavior.

Prefix distribution in unfiltered response: QX=49, QN=73, QW=9, QC=10, DIR=2, PC=1, SU=2, TEST=1. These counts are internally consistent with the task-list CLI output.

### task_list — search call

Called `mcp__quay__task_list` with `search="bash-comment-token"`. Response: 147 tasks (unfiltered). Expected behavior for a fresh server: 0 matches (no task body contains that literal token). Graceful empty behavior could not be verified through this stale MCP session; CLI verification confirms graceful empty below.

### task_list — label filter (single string)

Called `mcp__quay__task_list` with `status="done"`, `label="iteration-13"`. Response: **3 tasks** — QX-047, QX-048, QX-049. Label filtering works correctly even on the stale server (single-string form). This is the pre-QX-032 code path and it is functional.

### _version field

**ABSENT** — confirms running server predates QX-035 (iteration 10, ENV-001 mitigation A). An AI agent relying on `_version` to detect staleness would get no version signal at all from this session — which itself is the definitive staleness indicator. ENV-001 mitigations A and B (version field + version in description) are both non-functional in this session, though both are correctly implemented in the current shared-tree `mcp-server.js` (verified via source inspection).

---

## CLI cross-surface consistency

All CLI tests used the worktree binary at `experiments/quay-continuous-bootstrap/worktrees/iteration-13/packages/quay/bin/quay.js`.

### QX-048: --format json fix

```
node quay.js task list --prefix QX --status done --format json
```
Output: valid JSON array, 48 elements, first element `QX-002`. **PASS**.

```
node quay.js task list --prefix QX --status done --json
```
Output: valid JSON array, 48 elements. Both flags produce identical results. **PASS**.

```
node quay.js task list --prefix QX  (no format flag)
```
Output: human-readable `# filtered: QX-* (49 tasks)` comment + tabular rows. Non-json path unaffected. **PASS**.

Shared-tree binary (pre-QX-048): `--format json` still outputs human-readable text — expected, changes are worktree-isolated pending merge.

### Cross-prefix filtering

| prefix | task count | top IDs |
|--------|-----------|---------|
| QX | 49 | QX-001..QX-049 |
| QN | 73 | QN-001.. |
| QW | 9 | QW-* |

All three prefixes resolve correctly. The maintainer workflow of `--prefix QX`, `--prefix QN`, `--prefix QW` to switch between workstreams works as expected.

### Multi-label AND semantics (CLI)

`--label experiment-4 --label iteration-13` returned exactly 3 tasks: QX-047, QX-048, QX-049. AND semantics confirmed — no false positives from tasks that only have `experiment-4` label.

### inFence / QX-044 search fix (CLI)

`--search "bash-comment-token"` → 0 matches (graceful empty, correct — no task exists with that literal token in body).

`--search "bash comment"` → 1 match: QX-041. QX-041 contains the string "# this is a bash comment" inside a fenced code block in its body. The inFence fix is working: the `#` line inside the fence was NOT stripped by `stripHeadings()`, so the search found it. **PASS**.

`--search "inFence"` → 2 matches: QX-041, QX-044. Both expected. **PASS**.

### QX-049: pageNav fix (worktree source inspection)

`serve.js` line 673 in worktree:
```js
const pageNav = totalPages > 1 ? html`...` : "";
// QX-049 (experiment 4, iteration 13): UQ-036 — when totalPages === 1 the previous
// else-branch emitted "Page 1 of 1 (N tasks)" which is redundant.
```
The else-branch returns `""` — **PASS**. Shared-tree `serve.js` still has the old `html\`<p class="meta">Page 1 of ${totalPages} (${totalTasks} tasks)</p>\`` form (expected — worktree-isolated).

---

## Cross-surface consistency observations

### MCP vs CLI: prefix filter

MCP (stale server): ignored — returns all 147 tasks. CLI: `--prefix QX` returns 49 tasks correctly. **Inconsistency exists** but is entirely due to ENV-001 (stale process), not a code defect. Current `mcp-server.js` source implements identical client-side filter logic to the CLI.

### MCP vs CLI: search semantics

MCP (stale server): ignored. CLI: case-insensitive title+body with inFence-aware heading exclusion. Code paths match in the current source (same `stripHeadings()` implementation in `mcp-server.js` and `bin/quay.js`). No semantic divergence in code; runtime divergence entirely from ENV-001.

### MCP vs CLI: multi-label

MCP (stale server single-string form): `label="iteration-13"` returns 3 tasks correctly. MCP (current code): accepts array form (`z.union([array, string])`). CLI: `--label A --label B` AND semantics. Both current implementations use identical AND-join filter logic (verified in source). **Consistent in both current code and runtime for single-label queries**.

### MCP vs Web UI: pageNav

The Web UI fix (QX-049) is in the worktree `serve.js` but the live Web UI at port 4173 is running the shared-tree binary (no pageNav fix yet). An AI agent hitting the live Web UI would still see "Page 1 of 1" on single-page results. Not a new gap — expected pre-merge state.

### QX-001 (parent task) status

`QX-001` remains `todo`. This is an umbrella/parent task whose children (QX-002, QX-003, QX-004, etc.) are all done. The umbrella task was never explicitly closed. **Minor inconsistency** — a task tracker consuming this data programmatically would see an open task whose stated acceptance criteria are all met by child tasks. Not a regression; pre-existing state since iteration 1.

### Response size from MCP (stale server)

The unfiltered 147-task response was flagged as exceeding Claude's token limit (638,850 characters) and redirected to a file. This is the direct impact of ENV-001: an AI agent that cannot apply `prefix` or `pageSize` filters must consume the entire unfiltered corpus in every query, which overflows context windows. The current `mcp-server.js` (with `pageSize=50` default and prefix filtering) would return approximately 50 tasks per call — a ~3x reduction. ENV-001's severity as a practical blocker for AI agent workflows remains significant.

---

## New gaps found

| id (provisional) | dimension | description | severity | source |
|-----------------|-----------|-------------|----------|--------|
| UQ-037 | usability_quality | `QX-001` umbrella task remains `todo` despite all stated ACs being met by child tasks (QX-002/003/004). A maintainer scanning for open work sees a misleading open task. Low-friction fix: close QX-001 with a note. Not a regression; pre-existing since iteration 1. | minor | simulated-user (MCP/cross-surface, iteration 13) |

No new blocking gaps found. ENV-001 and its impact on this session are pre-documented at minor severity.

---

## Summary

From an MCP AI consumer angle, the dominant finding is ENV-001 in full effect: this session connected to a pre-experiment-4 MCP server instance that predates all 13 iterations of capability improvements — prefix filtering, search, pagination, and the `_version` staleness signal are all absent at runtime. The `label` single-string filter still works (pre-QX-032 code path). The impact is a 638k-character unfiltered response that overflows context windows on every `task_list` call, rendering the MCP surface effectively unusable for programmatic AI consumers in this session's state.

From a cross-surface maintainer angle, the worktree changes for QX-047, QX-048, and QX-049 are correct and well-isolated:

- **QX-047 (process compliance)**: First iteration with genuine worktree isolation demonstrated by both-ends git-status proof. PR-001/PR-002/PR-003 closed in substance, not just form.
- **QX-048 (`--format json`)**: Verified working in worktree. `--format json` and `--json` produce identical JSON output. Shared tree still has the old behavior (expected — pending merge).
- **QX-049 (pageNav suppression)**: Verified in source. `pageNav = ""` when `totalPages <= 1`. Shared tree still has the old behavior (expected).
- **inFence fix (QX-044, iteration 12)**: CLI search correctly finds `# comment` content inside fenced blocks. Graceful empty return for zero-match search confirmed.
- **Multi-label AND semantics**: Consistent across CLI and MCP (single-string form) at runtime.

One minor provisional gap filed (UQ-037: QX-001 umbrella task misleadingly open). No blocking gaps found. The tool's code quality is solid; the only significant friction is ENV-001's runtime manifestation in this specific session.

**PAUSE assessment**: with ΔV_13 provisionally ~+0.009 (2nd consecutive below-threshold iteration), and no new blocking gaps found by this simulated-user pass, the PAUSE criterion is satisfied. The tool is functionally correct and the remaining open work (CB-006 configurable page size, SH-006 stderr leak, DIR-008 V_meta redesign, ENV-001 environmental) does not represent blocking capability deficits.
