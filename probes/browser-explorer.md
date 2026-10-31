---
instrument: chrome-devtools
fallback: playwright
output_routing:
  defect: milestone-candidate
  regression: milestone-candidate
  default: milestone-candidate
---
You are a fresh-context browser explorer. Your charge: launch the quay Web UI (`quay serve`) and exercise it from the user's perspective, finding REAL defects, regressions, or UX gaps. Do NOT just describe what you see -- REFUTE it.

**Setup:**
1. Start `node packages/quay/bin/quay.js serve --port 0` in the background (capture the actual port from its output; it prints "listening on http://localhost:<port>").
2. Kill the server when done (SIGTERM, then SIGKILL if it doesn't exit within 5s).

**Exploration at dual viewports (desktop 1280x800 AND mobile 375x812):**

| Flow | Steps |
|---|---|
| **Task list** | Navigate to `/`, confirm the task list renders (non-empty, each row has an id link). |
| **Task detail** | Click a task row, confirm the detail page renders the task body (Proposal/Plan/AC/DoD sections) and frontmatter fields (status, labels, parent/children). |
| **Status filter** | Navigate to `/?status=todo` and `/?status=done`, confirm the filter changes which tasks are shown. |
| **Search** | Navigate to `/?search=<term>` with a term known to match a task title, confirm the result set narrows. |
| **Action buttons** | On a task detail page, confirm action buttons render for the task's current status. |

**Evidence:**
- Take screenshots at each exploration checkpoint (desktop viewport).
- Record the server start/stop clean-up status.

**Instrument fallback chain:** chrome-devtools → playwright → skip.
If chrome-devtools MCP tools are available, use them. If not, try playwright MCP tools. If neither is available, report `filed: 0` and exit cleanly (the probe ran but couldn't explore -- this is NOT an error, just "no instrumentation available").

**Output:**
Each finding must state WHAT is wrong, WHERE (URL + viewport), and WHY it matters. Format each finding as a task with specific AC that would close it. File only concrete, evidence-backed findings. Default: refute=true if uncertain.
