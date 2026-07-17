# Simulated-User Audit — Persona C: MCP AI Agent Consumer
# Iteration 10 (quay-continuous-bootstrap, Experiment 4)

**Date:** 2026-07-17
**Persona:** MCP AI agent consumer (Claude Code connected to quay MCP server)
**Verdict:** PASS

---

## Scenario walkthrough

### `_version` field in task_list response (QX-035 Mitigation A)

**What changed:** Every `task_list` response now includes a `_version` field containing the quay package version.

**Code analysis (mcp-server.js lines 57–60, 256):**

```js
// Startup (module load):
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version: QUAY_VERSION } = JSON.parse(
  readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
);

// In task_list handler:
const result = { tasks: paged, total, page: pageNum, pageSize: size, totalPages, _version: QUAY_VERSION };
return {
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  structuredContent: result,
};
```

**Staleness detection utility:**
- `_version` is present in BOTH `structuredContent` (machine-readable) and `content[0].text` (JSON string). As an AI agent, I can read it from either path.
- The version value is `"0.1.0"` (from `package.json`). I can compare this against the version I expect to be running.
- If the MCP server is stale (old code, new deployment), `_version` will show the OLD version. I can detect this mismatch and warn the user to restart.

**Failure mode:** `readFileSync` at module startup — if `package.json` is missing, the server process exits with an error at startup (not at call time). This is the correct failure mode. A server that starts successfully is guaranteed to have a valid `_version` value.

**`_version` as quay-specific extension:** This field is not in the MCP standard — it is a quay addition. As an AI agent, I need to know to look for it. The README "Updating quay" section documents the restart requirement, and the tool description documents the `_version` field implicitly by prefixing with `"Version: X.Y.Z."`. The field name `_version` (underscore prefix) signals "metadata, not task data" — a reasonable convention.

Assessment: The `_version` field is well-implemented and useful for staleness detection. PASS.

---

### "Version:" prefix in tool description (QX-035 Mitigation B)

**What changed:** The `task_list` tool description now begins with `"Version: ${QUAY_VERSION}. "`.

**Code analysis (mcp-server.js lines 199–213):**
```js
description:
  `Version: ${QUAY_VERSION}. ` +
  "List tasks from an enabled Provider..."
```

**Placement:** The prefix is at the VERY START of the description. This is critical: some MCP hosts display only the first N characters of a description. Having the version at position 0 ensures it is always visible on `tools/list`.

**Parseability:** The format `Version: X.Y.Z.` (note: trailing dot after version, then space) is parseable by regex: `/^Version:\s+([\d.]+)\./`. However, the trailing dot inside the version string is part of the sentence structure (`"Version: 0.1.0. List tasks..."`) — the regex needs to account for this. A cleaner parse: `/Version:\s+([\d.]+)/` captures `"0.1.0"` from `"Version: 0.1.0. List tasks..."`. This works correctly.

**Impact on tool functionality:** The version prefix is purely informational. It does not change the tool's input schema, parameter handling, or response shape.

**As an AI agent:** On session start, I call `tools/list` to enumerate available tools. I see `task_list` with description starting `"Version: 0.1.0. List tasks..."`. If I later call `task_list` and see `_version: "0.1.1"`, I know the server was updated and I should restart the session. The combination of Mitigation A (runtime check) + Mitigation B (pre-call check via description) gives me two independent detection points.

Assessment: PASS. The prefix is correctly placed and parseable.

---

### README "Updating quay" section (QX-035 Mitigation C)

**Content (README.md lines 69–77):**
```
## Updating quay

If you update quay (by installing a new release artifact or pulling from source)
while a Claude Code session that registered the `quay` MCP server is already open,
**restart the Claude Code session** for the MCP server to pick up the changes.
The MCP server process is started once when Claude Code launches and does not
auto-restart when the underlying files change. After a restart, the updated tool
schemas and any new parameters will be available to the AI agent.
```

This is exactly the information an operator configuring quay for AI agent use needs:
- Clear trigger: "while a Claude Code session... is already open"
- Clear action: "restart the Claude Code session"
- Root cause explanation: "started once when Claude Code launches"
- Benefit: "updated tool schemas and any new parameters will be available"

As an AI agent consumer, I cannot restart my own session. But the human operator reading this documentation will know to restart the session after updating quay. This is the correct audience for this documentation.

Assessment: PASS. The documentation is clear and actionable.

---

### Overall ENV-001 mitigation assessment

**Before iteration 10:** An AI agent using the quay MCP server had no way to detect whether the running process was stale. The agent could call `task_list` with new parameters (e.g., multi-label `label: ["A", "B"]`) and get unexpected results if the server was running old code that only accepted string labels — with no indication that a mismatch existed.

**After iteration 10 (3 mitigations):**

| Mitigation | Detection point | Who reads it |
|-----------|----------------|-------------|
| A: `_version` in response | After each `task_list` call | AI agent (runtime) |
| B: `Version:` in description | On `tools/list` (before any call) | AI agent (session init) |
| C: README guidance | Before session starts | Human operator |

The combination covers:
- Proactive detection (B: check description on session init)
- Reactive detection (A: check `_version` in each response)
- Human operator awareness (C: documentation)

**Limitations (known, acceptable):**
- The root cause (process lifetime controlled by Claude Code) cannot be fixed at the quay code level. The mitigations reduce the impact but do not eliminate the environmental constraint.
- If the session was already started BEFORE the update, and the agent never calls `tools/list` again in the same session, Mitigation B is only visible at session start. Mitigation A covers the ongoing case.
- An AI agent that doesn't implement staleness detection logic (i.e., doesn't check `_version`) gets no benefit from Mitigation A. This is a documentation gap for agents, but acceptable given the current scope.

**Overall assessment:** The three mitigations together provide a reasonable and practical solution to an inherently environmental problem. The gap remains open at **minor** severity (as reclassified in dev phase) — the root cause is unchanged, but the impact is substantially reduced. PASS.

---

### Test coverage for `_version` (Block 17)

**Assertions in mcp-server.test.mjs Block 17:**
1. `task_list` returns no error (sanity check)
2. `structuredContent._version` is a string
3. `structuredContent._version` is non-empty
4. `listTools()` includes `task_list`
5. `task_list` description includes `"Version:"`

These cover:
- Mitigation A: fields 2 and 3 verify `_version` is present and non-empty in `structuredContent`
- Mitigation B: field 5 verifies "Version:" appears in the tool description

What is NOT tested:
- `_version` appears in `content[0].text` JSON (the text representation) — this is correct by code structure (same `result` object), low risk
- The description starts WITH "Version:" (only `includes`, not `startsWith`) — could regress if the version prefix is moved to the end; low risk given the prefix is a template literal at the start

Assessment: Adequate for the primary consumer path. The missing assertions are low-risk.

---

## Gaps found (new, if any)

No new gaps found.

One observation (not filed as a gap): the `_version` field is a quay-specific extension with no documentation inside the MCP tool description itself (only the `Version:` prefix in the description, not an explanation of `_version`). An AI agent that reads the tool description carefully would see "Version: 0.1.0" but might not know to look for `_version` in the response. This could be improved by adding a note to the task_list description like "Response includes `_version` field for staleness detection." Minor friction for a new AI agent integration, but not a blocking gap at minor severity.

---

## Verdict rationale

All three QX-035 mitigations (Mitigation A: `_version` field, Mitigation B: "Version:" description prefix, Mitigation C: README guidance) are correctly implemented and provide practical value for an AI agent consumer. The `_version` field is present in both `structuredContent` and `content[0].text`. The description prefix is at position 0 (always visible). The README documentation is clear and actionable for operators. ENV-001 correctly remains at minor severity — the root cause is environmental and unchanged, but the impact is meaningfully reduced.

**Verdict: PASS**
