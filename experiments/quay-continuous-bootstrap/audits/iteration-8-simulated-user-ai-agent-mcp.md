# Simulated User Audit — AI Agent / MCP-Focused Persona
Date: 2026-07-17
Iteration: 8
Persona: AI agent using quay via MCP tools

## Pagination — FAIL

`task_list` with `{"pageSize": 10, "page": 1}` and `{"pageSize": 10, "page": 2}` both returned all 124 tasks starting from the same IDs (PC-PARENT, QC-001, QC-002). Pagination parameters are silently ignored. The response shape has no `total`, `page`, `pageSize`, or `totalPages` fields — only `{"tasks": [...]}`. Default pageSize=50 is also not applied (124 tasks returned instead of 50).

Root cause confirmed: the MCP server process running in this Claude Code session predates the iteration 8 changes. `mcp-server.js` was last modified at 08:31 today (with QX-029/QX-030 code), but the process was started before those changes were written. The server needs a restart to pick up the new code. This is a deployment/session-lifecycle gap, not a code logic gap.

## Search (basic) — FAIL

`task_list` with `{"search": "toggle"}` returned all 124 tasks. Search parameter is silently ignored — same root cause as pagination (stale MCP server process). The code in `mcp-server.js:212-216` implements correct search logic (title + stripHeadings(body) case-insensitive substring match), but it is not reachable until the process restarts.

## Search (heading exclusion) — FAIL

`task_list` with `{"search": "Proposal"}` returned all 124 tasks. Cannot evaluate heading-exclusion behavior because search itself is not functioning. Expected behavior per code: heading lines (`## Proposal`, `## Plan`, etc.) are stripped before matching to avoid template boilerplate false positives.

## Search + filter composition — FAIL (partial)

`task_list` with `{"search": "experiment", "pageSize": 5, "page": 1}` returned all 124 tasks — search and pagination both ignored.

`task_list` with `{"search": "MCP", "status": "done"}` returned 118 tasks, all with status "done". The `status` filter works correctly (pre-existing, prior iteration). The `search` parameter was ignored (118 tasks instead of the much smaller subset mentioning "MCP" in done tasks).

Conclusion: existing filters (status, label) compose correctly with each other. New filters (search, pagination) are non-functional due to stale process.

## Schema descriptions — FAIL

The MCP tool schema returned via ToolSearch for `mcp__quay__task_list` does NOT include `search`, `page`, or `pageSize` parameters. Schema shown:

```
{"status": ..., "label": ..., "provider": ...}
```

Expected (per mcp-server.js:194-202):
```
{"provider", "status", "label", "prefix", "search", "page", "pageSize"}
```

This is the primary reason the features don't work: Claude Code's MCP client reads the schema to construct parameter objects; parameters not in the schema are unknown and silently dropped before the call reaches the server. Even if the server process were restarted, the schema served would reflect the new code, but the current session's ToolSearch cached schema is the old one.

The code itself has excellent descriptions — all three new params have clear `.describe()` strings (mcp-server.js:199-201). The problem is entirely the stale process / schema cache.

## Task roundtrip — PASS

Full roundtrip worked correctly:
1. `task_write` CREATE — `TEST-SIMUSER-AI-001` created with `status: todo`, body with unique phrase. Response was immediate and correct.
2. `task_list` with `search=unique_test_phrase_xyz` — task appeared in results (search ignored, but task was in the full 125-task list, confirming it was persisted).
3. `task_get "TEST-SIMUSER-AI-001"` — returned full task with title, status, body as written.
4. `task_write` UPDATE — set `status: done`. Response confirmed the status change.

Basic create/read/update lifecycle is solid. The roundtrip only fails at the search-to-find step (search not filtering), but the task was locatable via `task_get` by known ID.

## New gaps found

**[severity: blocking]** MCP server process must be restarted after code changes for new features to take effect. The current session is running a pre-iteration-8 server binary. All QX-029 (search) and QX-030 (pagination) features are unreachable. The MCP schema cache in the calling client (Claude Code / ToolSearch) also reflects the old schema, so even with a restart in a NEW session the ToolSearch schema would update — but this session remains broken.

**[severity: significant]** No mechanism exists to alert an AI agent user that the server is stale. The agent receives well-formed but unfiltered responses with no indication that `search` and `page` parameters were ignored. Silent parameter dropping is a correctness hazard — the agent may believe it received filtered results when it received the full dataset.

**[severity: significant]** Default pageSize=50 is not applied. With 124+ tasks, unfiltered `task_list` returns 600KB+ responses that exceed Claude Code's token limit, forcing output to file. This is the exact problem CB-010 / UQ-008 aimed to fix. Until the server is restarted, every `task_list` call in this session will overflow.

**[severity: minor]** The MCP proxy tool description (quay's own proxy layer `mcp__quay__task_list`) does not mention `prefix`, `search`, `page`, or `pageSize` in the description text, only in the input schema. If an AI agent reads only the tool description (not the schema), it would not know these parameters exist.

## Overall: FAIL

The iteration 8 MCP features (search, pagination, schema descriptions) are correctly implemented in source code (`mcp-server.js` QX-029/QX-030) but are completely non-functional in the live session due to the MCP server process not being restarted after the code changes were committed. This is a deployment gap, not a design or logic gap. The existing features (status filter, task CRUD roundtrip) continue to work correctly. Recommend restarting the MCP server and re-running this audit in a fresh session to validate the actual feature behavior.
