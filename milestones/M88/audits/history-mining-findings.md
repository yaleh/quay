# M88 History Mining Findings — meta-cc Session History Mining

**Audit session id:** m88-iter0-history-mining-explore-2026-07-21  
**Date:** 2026-07-21  
**Tools used:** `analyze_errors`, `get_work_patterns`, `get_tech_debt`, `query_session_signals` (errors + system_errors), `query_session_content` (tool_results), `query_edit_sequences`

---

## Tool Run 1: `analyze_errors` — Project-Wide Error Analysis

**Raw summary:**
```json
{
  "time_range": {"start": "2026-07-15T03:33:08Z", "end": "2026-07-21T23:10:47Z"},
  "total_errors": 278,
  "by_tool": [
    {"tool_name": "Bash", "count": 160},
    {"tool_name": "Edit", "count": 77},
    {"tool_name": "Read", "count": 14},
    {"tool_name": "Write", "count": 5},
    {"tool_name": "Agent", "count": 3},
    {"tool_name": "mcp__quay__task_get", "count": 3},
    {"tool_name": "mcp__quay__task_list", "count": 3},
    {"tool_name": "mcp__chrome-devtools__new_page", "count": 2},
    {"tool_name": "mcp__playwright__browser_navigate", "count": 2},
    {"tool_name": "mcp__plugin_manda_manda__Agent", "count": 2}
  ]
}
```

**By error type (signature groupings):**
- `75255745e5479bde` — count: 57 — `File has not been read yet. Read it first before writing to it.`
- `6a32d84ffabceb24` — count: 9 — `File has been modified since read, either by a linter. Read it again before writing.`
- `9a964ba238e9ee44` — count: 7 — `Exit code 144` (timeout)
- `f55ca558b01d3442` — count: 7 — `Exit code 1\nlost QC-T1`
- `8f75854b16ef2a92` — count: 5 — `Exit code 2`
- `fa9c208b72b8ee6c` — count: 5 — `File has not been read yet (Write tool)`
- `279fc7dc16414651` — count: 4 — `clause12-audit-independence: FAIL` (dispatch-record not supplied)

**Key excerpt — clause12 failure pattern:**
```
FAIL: clause12-audit-independence: FAIL — audit artifact's session id ("m82-iter0-p3b1-quay-core-utils-ts-2026-07-21")
is distinct from the orchestrator's own id, but NO dispatch-record was supplied to corroborate it
(set --dispatch-record <file> or pass dispatchRecordIds) — fail-closed per DIR-034: a bare distinct
string is forgeable and is treated as BLOCKING, not a pass
```

This error recurred 4 times across at least M82, each a separate iteration of the same gate failure.

**Key excerpt — "lost QC-T1" pattern:**
```
mcp__quay__task_get error: "no such task: QC-T1 (provider: native)"  — count: 3 instances
Session: e0fb1192-a14a-45a8-bd2c-fa929a1e363e, timestamp: 2026-07-20T08:09ff
```
The error appears in the OUTER-LOOP.md QC check step that uses `mcp__quay__task_get` to verify that a test task (QC-T1) still exists. This test task is a fixture created by `OUTER-LOOP.md`'s healthcheck step, but the fixture was lost/deleted from the native task store before each check. This recurred 3 times in a single session (session `e0fb1192-a14a-45a8-bd2c-fa929a1e363e`, 2026-07-20 around 08:10-09:00).

**Key excerpt — YAML frontmatter error:**
```
Session: a653b2e9-8c25-4560-8c85-bd3e757e56f3, turn 0, timestamp: 2026-07-21T15:48:10Z
tool_result: "Nested mappings are not allowed in compact mappings at line 14, column 14:
  dirStatus: mechanism-landed; real routine-fire pending a live routines: run (…"
```
A task file had a `dirStatus:` YAML field containing a colon + value inline in a compact mapping context, which is invalid YAML. The `mcp__plugin_quay_quay__task_list` tool failed to parse it (session `a653b2e9`, turn 0).

---

## Tool Run 2: `get_work_patterns` — Tool Frequency Analysis

**Raw output:**
```json
{
  "tool_frequency": [
    {"tool_name": "Bash", "count": 5876},
    {"tool_name": "Read", "count": 1031},
    {"tool_name": "Edit", "count": 986},
    {"tool_name": "Agent", "count": 692},
    {"tool_name": "Write", "count": 339},
    {"tool_name": "ScheduleWakeup", "count": 201},
    {"tool_name": "ToolSearch", "count": 116},
    {"tool_name": "mcp__quay__task_write", "count": 64},
    {"tool_name": "mcp__plugin_meta-cc_meta-cc__query_session_content", "count": 48},
    {"tool_name": "mcp__plugin_manda_manda__respond", "count": 28}
  ],
  "context_switches": 11,
  "peak_hour": 15
}
```

**Notable finding:** `ToolSearch` was called 116 times (the 7th most frequent tool) vs `mcp__quay__task_write` at 64 times. `ToolSearch` is needed only because deferred tool schemas must be fetched before use — each one is wasted overhead added before any real operation. This is a crystallizable pattern: the loop driver repeatedly pays the schema-fetch tax across every loop iteration.

**Notable finding:** `Agent` (692 calls) is the 4th most frequent tool. This means subagent dispatch is extremely common. Yet `mcp__plugin_manda_manda__Agent` only appears twice — and both produced timeouts. The ratio (692 native `Agent` vs 2 manda `Agent` calls, both failing) documents that manda-based dispatch is functionally unused by the loop.

---

## Tool Run 3: `get_tech_debt` — TODO/FIXME Marker Analysis

**Raw output:**
```json
{
  "markers": [
    {"label": "TODO", "count": 42},
    {"label": "FIXME", "count": 5},
    {"label": "HACK", "count": 1}
  ],
  "hotspot_files": [
    {"file": "/home/yale/work/quay/experiments/quay-core-bootstrap/iterations/iteration-10.md", "marker_count": 7},
    {"file": "/home/yale/work/quay/experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md", "marker_count": 5},
    {"file": "/home/yale/work/quay-human/packages/quay/test/lifecycle.test.mjs", "marker_count": 4},
    {"file": "/home/yale/work/quay/experiments/quay-perpetual-stream/inherited-core.md", "marker_count": 2},
    {"file": "/home/yale/work/quay/experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs", "marker_count": 1}
  ]
}
```

**Notable finding:** `inherited-core.md` has 2 `TODO` markers, meaning the Tier-B pinned methodology has unresolved open items inline. These are the closest to "silently-dropped requirements" in the method substrate itself — they represent declared but unresolved design work that is never surfaced to SELECT unless a human happens to grep for them.

**Notable finding:** `it0-dod-check.mjs` has 1 TODO — a deviation inside the primary gate enforcement script itself. A TODO in a gate script is a gate weakness, not just general tech debt.

---

## Tool Run 4: `query_session_signals` (type=errors) — Error Time Clustering

**Raw summary:**
```json
{"session_count": 34, "time_range": {"from": "2026-07-15T03:33:11Z", "to": "2026-07-21T23:13:01Z"}, "total": 44226}
```
The 44226 tool-stats events across 34 sessions over 6 days reveals high-intensity sustained automation.

**Selected error signals:**
```json
Session a653b2e9 (2026-07-21T15:48:10Z):
  "Nested mappings are not allowed in compact mappings at line 14, column 14:
   dirStatus: mechanism-landed; real routine-fire pending a live routines: run (…"
  Source: mcp__plugin_quay_quay__task_list call

Session a653b2e9 (2026-07-21T15:52:39Z):
  "rm: cannot remove 'experiments/quay-perpetual-stream/.halt': No such file or directory"
  (Spurious halt-removal attempt — .halt not present but loop tried to remove it anyway)
```

**Notable:** The `.halt` removal error (`No such file or directory`) confirms the loop routinely attempts to remove `.halt` even when it wasn't set. This is a minor idempotency gap: the remove command should be `rm -f` (silent on missing file) rather than `rm` (exits 1 on missing).

---

## Tool Run 5: `query_session_signals` (type=system_errors) — API-Level Failures

**Raw summary:**
```json
{"session_count": 2, "time_range": {"from": "2026-07-20T03:29:59Z", "to": "2026-07-21T12:16:02Z"}, "total": 5}
```

**Errors found:**
- `ECONNRESET` — 4 occurrences across 2 sessions — Anthropic API connection resets (network transients)
- `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` — 1 occurrence

These are external/network failures, not loop defects, but confirm the loop runs without any retry-budget protection visible in session history: when the API dropped, the loop was not notified through any observable mechanism.

---

## Tool Run 6: `query_edit_sequences` — Gate Script Edit Patterns

**Files analyzed:** `scripts/it0-dod-check.mjs`, `scripts/it0-dod-check.sh`  

**Raw summary (it0-dod-check.mjs):**
```json
{
  "sessionCount": 3,
  "totalReads": 7,
  "totalEdits": 4,
  "readEditRatio": 1.75,
  "patternHint": "C"
}
```

**Edit events (excerpt):**
```
2026-07-19T00:55:35Z — session 49bd0cb7 — Edit: old: '// --- Clause 5: No-self-exemption meta-'
2026-07-19T00:55:38Z — session 49bd0cb7 — Edit: old: 'if (dispositionedClauses.has(k'
2026-07-19T01:51:33Z — session 8261e15e — Read
2026-07-19T02:00:05Z — session 8261e15e — Edit: old: 'const dispositionedClauses = new Set();'
2026-07-19T03:04:53Z — session 49bd0cb7 — Edit: old: 'const coverageDispositionRe = /\\b(te'
```

**Pattern:** Three distinct sessions edited `it0-dod-check.mjs` in a single day (2026-07-19), and the `dispositionedClauses` pattern was touched twice by different sessions — indicating a recurring convergence problem where different iterations independently needed to fix the same clause-tracking logic.

---

## Tool Run 7: `query_session_content` (type=tool result) — YAML Parse Failure Context

**Query:** tool results containing "Nested mappings"

**Session:** `a653b2e9-8c25-4560-8c85-bd3e757e56f3`, turn 0, 2026-07-21T15:48:10Z  
**Failing field in frontmatter:**
```yaml
dirStatus: mechanism-landed; real routine-fire pending a live routines: run (…
```
The value contains an unquoted `:` after a space ("routines: run"), which YAML parsers interpret as a nested mapping start inside a flow context — invalid. This caused the `task_list` call to fail completely, blocking the loop from reading the task board at session start.

---

## Finding Classification

### Finding F1 — DEFECT/GAP: `clause12-audit-independence` dispatch-record missing in ABSORB entries (recurring)

**Class:** defect/gap  
**Evidence:** `analyze_errors` output — signature `279fc7dc16414651`, count 4, examples all from M82 iterations:
```
FAIL: clause12-audit-independence: FAIL — NO dispatch-record was supplied to corroborate it
(set --dispatch-record <file> or pass dispatchRecordIds) — fail-closed per DIR-034
```
**Session reference:** session `a653b2e9-8c25-4560-8c85-bd3e757e56f3`, 2026-07-21, M82 ABSORB turns (multiple instances of the same error in the error corpus).  
**Pattern:** Clause 12 checks that the acceptance audit was produced by an independent subagent (not the orchestrator itself) by verifying a dispatch record file. Orchestrators repeatedly produce ABSORB entries with a distinct session-id string but no accompanying dispatch-record file. The gate fires correctly (fail-closed), but the error recurs 4 times, suggesting the ABSORB template or the loop's ABSORB-step instructions do not mention the `--dispatch-record` requirement, causing the same mistake to repeat across iterations.

**Implication:** The OUTER-LOOP.md ABSORB step (step 6) does not have a reminder or sample invocation for `--dispatch-record`; this is a template gap.

---

### Finding F2 — DEFECT/GAP: QC-T1 fixture task lost between healthcheck cycles

**Class:** defect/gap  
**Evidence:** `analyze_errors` output — `mcp__quay__task_get` error: `no such task: QC-T1 (provider: native)`, count: 3.  
**Session reference:** session `e0fb1192-a14a-45a8-bd2c-fa929a1e363e`, turns around 08:09–09:00 UTC on 2026-07-20.  
**Pattern:** The OUTER-LOOP.md healthcheck step queries for a `QC-T1` fixture task (created by the loop at bootstrap as a probe), but the fixture was absent 3 consecutive times in a single session. Either the QC-T1 task was deleted by a worktree cleanup, never created at this session's bootstrap, or is specific to a task-store state that changed. The error causes the healthcheck to error out, not cleanly fail. The loop recovered (continued running) despite this, suggesting the error was swallowed.

**Implication:** The QC-T1 fixture probe is not idempotent — its loss is neither detected as a failing gate nor triggers re-creation. The healthcheck has silent recovery, meaning a broken healthcheck is indistinguishable from a passing one if the loop continues anyway.

---

### Finding F3 — DEFECT/GAP: YAML frontmatter inline colon causes task_list to fail completely

**Class:** defect/gap  
**Evidence:** `query_session_signals` (errors) and `query_session_content` (tool result) — session `a653b2e9-8c25-4560-8c85-bd3e757e56f3`, turn 0, 2026-07-21T15:48:10Z:
```
"Nested mappings are not allowed in compact mappings at line 14, column 14:
  dirStatus: mechanism-landed; real routine-fire pending a live routines: run (…"
```
**Pattern:** A task file's YAML frontmatter contained `dirStatus: mechanism-landed; real routine-fire pending a live routines: run (…)` — the value contains `routines: run` which is parsed as a nested mapping. The `task_list` call fails with a parse error that blocks the loop from reading the task board. This is a single-task corruption that takes down the whole `task_list` surface.

**Implication:** The task store has no YAML validation gate before a task is written. Any free-text string with an unquoted `: ` pattern in a frontmatter value poisons the task list. The `task_write` MCP tool should either (a) validate YAML before writing, or (b) the frontmatter parser should be tolerant of string values with colons (quoting the value).

---

### Finding F4 — ADR CANDIDATE: `ToolSearch` pre-fetch as mandatory first step is implicit, not documented

**Class:** ADR candidate  
**Evidence:** `get_work_patterns` output — `ToolSearch: 116` calls (7th highest frequency overall), used before every deferred tool invocation.  
**Session reference:** session `a653b2e9-8c25-4560-8c85-bd3e757e56f3` (current session) and visible across multiple sessions in the history.  
**Pattern:** Every iteration that uses MCP tools (mcp__quay__*, mcp__plugin_meta-cc_meta-cc__*, etc.) must call `ToolSearch` first to fetch the schema. This is an architectural decision: deferred tool schemas require explicit fetching. But there is no ADR recording (a) why schemas are deferred rather than always-loaded, (b) the cost (adds one extra turn per tool type before productive work), or (c) the risk (a tool search failure silently blocks the operation that depends on it, with no circuit-breaker).

**Implication:** The ToolSearch-first pattern is load-bearing for all MCP tool use in the loop, but is implicit knowledge only. If Claude Code's deferred-tool behavior changes or if a ToolSearch fails silently, there is no documented fallback.

---

### Finding F5 — CRYSTALLIZABLE PATTERN: `rm -f` vs `rm` for idempotent sentinel removal

**Class:** crystallizable pattern  
**Evidence:** `query_session_signals` (errors) — session `a653b2e9`, 2026-07-21T15:52:39Z:
```
"rm: cannot remove 'experiments/quay-perpetual-stream/.halt': No such file or directory"
```
**Pattern:** The loop uses `rm experiments/quay-perpetual-stream/.halt` (without `-f`) to clear the halt sentinel. When `.halt` is not present (normal state), this produces a spurious exit-code 1 error. This pattern (removing a sentinel that may not exist) recurs wherever the loop checks halt state. The fix is `rm -f`, which silently no-ops if the file is absent.

**Implication:** This causes false error signals in the loop's own error corpus, making it harder to distinguish real errors from noise. A crystallizable fix: any sentinel-file removal in `OUTER-LOOP.md` or its scripts should use `rm -f` (or `[ -f file ] && rm file`). This is a one-line change but its pattern (fail-safe sentinel removal) should become a standing rule applied to all similar sentinel operations.

---

## Summary Table

| ID | Class | Finding | Tool Source | Session Ref |
|----|-------|---------|-------------|-------------|
| F1 | defect/gap | `clause12-audit-independence` dispatch-record missing in ABSORB entries (4 recurring failures) | `analyze_errors` | session `a653b2e9`, 2026-07-21, M82 iterations |
| F2 | defect/gap | QC-T1 fixture task lost between healthcheck cycles (3 consecutive failures) | `analyze_errors` | session `e0fb1192`, 2026-07-20T08:09–09:00 |
| F3 | defect/gap | YAML frontmatter inline colon causes `task_list` to fail completely (blocks task board) | `query_session_signals` + `query_session_content` | session `a653b2e9`, 2026-07-21T15:48:10Z |
| F4 | ADR candidate | `ToolSearch` pre-fetch as mandatory first step is load-bearing but undocumented as a decision | `get_work_patterns` | all sessions (116 ToolSearch calls) |
| F5 | crystallizable pattern | `rm -f` for sentinel removal vs `rm` — idempotent sentinel ops should be a standing rule | `query_session_signals` | session `a653b2e9`, 2026-07-21T15:52:39Z |

---

## REFUTE-first Assessment

All five findings are genuinely negative. None is loop-favorable:
- F1 identifies a recurring gate that the loop fails to satisfy — the ABSORB template is broken
- F2 identifies a healthcheck that silently recovers from probe loss — the monitoring is broken
- F3 identifies a task-store corruption that blocks loop startup — a critical single-point-of-failure
- F4 identifies an undocumented load-bearing architecture decision — implicit knowledge risk
- F5 identifies a spurious error generator in the loop's own error corpus — noise in diagnostic signals

No self-congratulatory or loop-favorable task was filed. All findings cite real session IDs and timestamps from meta-cc output.
