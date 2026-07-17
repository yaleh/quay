# Simulated-user audit — Cross-experiment maintainer
# Iteration 2

**Persona**: Cross-experiment maintainer — a developer who actively manages tasks across multiple experiment workstreams (QN-*, QC-*, QW-*, QX-* prefixes) and needs to jump between them efficiently in one session.

**Date**: 2026-07-17
**Surfaces tested**: CLI, Web UI desktop (HTML inspection at http://localhost:4173/), Web UI mobile (viewport CSS/HTML inspection), MCP tools (registered schema + source inspection)

---

## Summary of changes since iteration 1

Four tasks shipped between iteration 1 and this audit that directly target this persona's pain points:

- **QX-006**: Fixed `--prefix` crash when no value provided (regression guard)
- **QX-007**: Fixed `quay serve --help` and `quay action --help` silent exit
- **QX-008**: Added `--sort updated` to CLI and Web UI (resolves top-rated iteration-1 finding)
- **QX-009**: Added "Advance" action button to Web UI list page (resolves iteration-1 finding)
- **QX-010**: Added MCP `task_list` schema test for `prefix` parameter (CB-011 verification)

These collectively address three of the four "significant" iteration-1 findings. This audit re-runs the same workflow tasks and re-assesses each surface.

---

## Workflow 1: CLI — `quay task list --prefix QX --sort updated`

**Verdict: PASS**

### Test run

```
node packages/quay/bin/quay.js task list --prefix QX --sort updated
```

Output:
```
quay-native mcp: serving tasks from /home/yale/work/quay/tasks
# filtered: QX-* (10 tasks)
QX-010	done	primitive	Add MCP task_list schema test for prefix parameter (CB-011)
QX-009	done	primitive	Add Advance action button to Web UI list page (CB-003)
QX-008	done	primitive	Add sort-by-updated to CLI and Web UI (CB-004/CB-005/CB-012)
QX-007	done	primitive	Fix quay serve --help and quay action --help silent exit with no output
QX-006	done	primitive	Fix --prefix crash when no value provided (regression from QX-002)
QX-001	todo	primitive	Add cross-experiment task filtering to CLI and Web UI
QX-005	done	primitive	Improve CLI help output (--help and subcommand help)
QX-004	done	primitive	Add prefix/experiment filter to Web UI list page
QX-003	done	primitive	Add prefix filter to task_list MCP tool
QX-002	done	primitive	Add --prefix filter to quay task list CLI
```

### Specific findings

1. **`--sort updated` now works** (iteration-1 "significant" gap resolved) — The flag is accepted and produces a most-recently-modified-first order. Verified against filesystem mtimes: QX-010 (04:46), QX-009 (04:46), QX-008 (04:46), QX-007 (04:28), QX-006 (04:28), QX-001 (04:17), QX-005–QX-002 (04:09). The sort order matches file mtimes exactly. For a cross-experiment maintainer doing end-of-day triage, this is exactly the right signal.

2. **Prefix + sort compose correctly** — `--prefix QX --sort updated` applies both filters without either being silently dropped. The `# filtered: QX-* (10 tasks)` header line is present, confirming the prefix scope is active.

3. **Sort order is stable when timestamps collide** — QX-010, QX-009, QX-008 share the same mtime (04:46). Their relative order (010 > 009 > 008) is deterministic (consistent with task id descending within the same second). No jitter observed across multiple runs.

4. **Prefix crash regression fixed (QX-006)** — `quay task list --prefix` (missing value) was confirmed to be a previous crash regression. QX-006 fixed this. Not re-tested explicitly in this session since the flag is used with a value throughout, but the fix is in code.

5. **No cross-prefix "recently updated" view** (severity: minor) — `--sort updated` without `--prefix` returns all 98+ tasks sorted by mtime. This is the right behavior, but no deduplicated "one recent task per experiment" summary exists. A cross-experiment maintainer who wants "show me the most recently touched task in each workstream" still has to run four separate invocations.

---

## Workflow 2: Web UI — `?prefix=QX&sort=updated`

**Verdict: PASS**

### Test run

`curl http://localhost:4173/?prefix=QX&sort=updated`

### Specific findings

1. **Prefix + sort compose correctly in Web UI** — The URL `/?prefix=QX&sort=updated` returns 10 tasks in newest-first order, matching the CLI output. The sort bar shows `<strong>Updated ↓</strong>` (active indicator). The prefix bar shows `<strong>QX</strong>`. Both active states are correctly reflected simultaneously.

2. **All filter dimensions preserve each other's state** — Inspecting all generated links in the filtered view confirms:
   - Status links include `?prefix=QX&sort=updated`
   - Sort links include `?prefix=QX`
   - Prefix links include `?sort=updated`
   - Label links include `?prefix=QX&sort=updated`
   - Page nav (if applicable) carries all active params
   No filter dimension is silently dropped when switching another dimension.

3. **Task count and pagination metadata correct** — `Page 1 of 1 (10 tasks)` — accurate for QX-* set.

4. **Label filter bar now has 46 labels** (severity: minor) — The label bar at `?prefix=QX&sort=updated` renders 46 labels inline. Within the QX prefix context, many labels are irrelevant to QX tasks (e.g. `github`, `github-provider`). The label bar is not scoped to labels actually present on QX-* tasks; it shows the global label universe. This makes the label bar longer and harder to scan for the cross-experiment maintainer.

5. **"Updated ↓" sort label is clear** — The display text "Updated ↓" (descending arrow) communicates direction without ambiguity. A maintainer reading the sort bar immediately understands which end of the list is newest.

---

## Workflow 3: Web UI — "Advance" action button on list page

**Verdict: PASS**

### Test run

Inspected HTML at `/?prefix=QX&sort=updated`. Only QX-001 (`todo` status) has an Advance button (done-status tasks do not).

### Specific findings

1. **Advance button appears only for actionable tasks** — Tasks in `done` status show an empty actions cell. QX-001 (`todo`) shows an Advance button. This matches the `whenStatus: ["todo","ready"]` filter on the action definition. Confirmed via HTML inspection.

2. **`from=` parameter correctly encodes current filter URL** — The form action URL is:
   ```
   /task/QX-001/action/advance?from=%2F%3Fprefix%3DQX%26sort%3Dupdated
   ```
   Decoded: `from=/?prefix=QX&sort=updated`. After POSTing, the server (serve.js line 562) redirects to this URL, returning the user to the filtered list. The iteration-1 "action buttons absent from list" finding is fully resolved.

3. **Context preserved after Advance** — The redirect target is exactly `/?prefix=QX&sort=updated` — the full filter state, not just `/`. After advancing a task from the list page, the maintainer stays in their filtered, sorted view. This is the correct UX for a multi-task triage session.

4. **Security check on `from=` parameter present** — serve.js line 562 validates `fromParam.startsWith("/")` before using it as a redirect target. Open-redirect to external domains is prevented.

---

## Workflow 4: MCP — `task_list` schema with `prefix` parameter (CB-011)

**Verdict: PASS (with qualification)**

### Test run

Inspected `/home/yale/work/quay/packages/quay/src/mcp-server.js` for `task_list` registered schema.

### Specific findings

1. **`prefix` parameter is now registered in `task_list` inputSchema** — The `server.registerTool("task_list", ...)` call (mcp-server.js) declares:
   ```js
   inputSchema: {
     provider: z.string().optional(),
     status: z.string().optional(),
     label: z.string().optional(),
     prefix: z.string().optional(),
   }
   ```
   This resolves CB-011 (prefix absent from MCP schema). The iteration-1 finding that "the registered Claude Code tool schema does not expose the `prefix` parameter" is addressed at the source level.

2. **Qualification — live Claude Code session still shows stale schema** — The registered `mcp__quay__task_list` tool as visible in this session's ToolSearch may still reflect the pre-QX-003 schema if the MCP server was not restarted since then. CB-011 fix (QX-010) adds a test to catch this regression, but the live schema in the currently running quay MCP server needs a restart to refresh. This is an operational note, not a code defect: the code is correct.

3. **Tool description updated to mention `prefix`** — The `description` field in `registerTool` now reads: "…optionally filtered by status/label/prefix. The `prefix` parameter filters by task id prefix (e.g. prefix='QX' returns only QX-* tasks), reducing response size for large workspaces." An agent reading the tool description will discover the parameter without needing to inspect the schema.

4. **Response size benefit is real** — With 10 QX-* tasks out of ~98 total, using `prefix=QX` reduces response payload by roughly 90%. The token-limit issue from iteration 0/1 (full 98-task corpus exceeding session limits) is now avoidable with documented, registered tooling.

5. **No MCP tool for "sort by updated"** (severity: minor) — `task_list` does not support a `sort` parameter. An agent wanting newest-first ordering must fetch all tasks and sort client-side. This is a known gap, but with prefix filtering reducing corpus size, the workaround is more tractable.

---

## Workflow 5: Back link from task detail page

**Verdict: CONCERNS** (severity: significant — unchanged from iteration 1)

### Test run

Inspected `/task/QX-001` HTML and serve.js lines 496–537.

### Specific findings

1. **Back link still points to bare `/`** — serve.js line 529: `<nav><a href="/">&larr; back to list</a></nav>`. The task detail page does not receive or use a `from=` query parameter on GET requests; the `from=` mechanism exists only for the POST action redirect (workflow 3 above).

2. **Task links from list page do not carry `from=` context** — The list page renders task links as `<a href="/task/QX-010">QX-010</a>` — plain `/task/<id>` with no `?from=` or `?back=` parameter. The task detail page has no way to know what filtered list the user came from.

3. **Effect on cross-experiment maintainer**: Clicking QX-010 from `/?prefix=QX&sort=updated`, reading the task body, then clicking "← back to list" lands on `/?` (all 98+ tasks, default sort). The maintainer must manually re-navigate to `/?prefix=QX&sort=updated`. This is a per-task round-trip interruption. The Advance action (workflow 3) correctly restores context because it goes through POST+redirect, but the Browse→Read→Back flow does not.

4. **Suggested fix** — Pass `?from=<encoded-list-url>` in the task `<a href>` links on the list page, and use it in the detail page's back `<nav>` link. This mirrors the existing `from=` logic in the action POST flow and requires two small changes: one in the list-page link renderer (one line) and one in the detail-page nav renderer (one line).

---

## Overall assessment

| Surface | Iteration 0 | Iteration 1 | Iteration 2 |
|---|---|---|---|
| CLI | CONCERNS | PASS | PASS |
| Web UI desktop | CONCERNS | PASS | PASS |
| Web UI mobile | CONCERNS | CONCERNS | CONCERNS |
| MCP tools | CONCERNS | CONCERNS | PASS (qualified) |

### Net improvement

Three of the four "significant" iteration-1 findings are resolved:

| Finding | Iteration 1 severity | Iteration 2 status |
|---|---|---|
| No `--sort updated` on CLI | significant | **RESOLVED** (QX-008) |
| No sort by time in Web UI | significant | **RESOLVED** (QX-008) |
| Action buttons absent from list | significant | **RESOLVED** (QX-009) |
| Back link loses filter context | significant | **UNCHANGED** |
| MCP `prefix` not in registered schema | significant | **RESOLVED** (QX-003 + QX-010) |

### Remaining significant finding

- **Back link from task detail loses filter context** (Web UI desktop and mobile) — The only iteration-1 "significant" finding not addressed in iteration 2. The `from=` mechanism already exists for the action POST flow; extending it to GET navigation is a small, localized change.

### Blocking findings

None on any surface.

### Persistent minor gaps

- No cross-prefix "one most-recent per workstream" summary view (CLI or Web UI)
- Label bar in Web UI shows global label universe, not labels scoped to current prefix filter
- No `sort` parameter in MCP `task_list`
