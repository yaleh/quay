export const meta = {
  name: "drain-directives",
  description: "DRAIN pending directives: Schedule → Dispose → Verify. Reads directives from the task store, runs drain-scheduler.ts, disposes each due directive by adding label:milestone-candidate and setting dirStatus: applied, then verifies. Replaces OUTER-LOOP.md step 0 (DIR-071, 2026-07-24).",
  phases: [
    { title: "Schedule", detail: "Read directives via task store + evaluate drain scheduler" },
    { title: "Dispose", detail: "For each DUE directive: add label:milestone-candidate, set dirStatus: applied, append DRAIN disposition section" },
    { title: "Verify", detail: "Read back dispositioned directives → confirm dirStatus: applied → return {drained: N}" },
  ],
}

// ── Phase: Schedule ──────────────────────────────────────────────────────────────────
phase("Schedule")

const scheduleResult = await agent(
  `Read the pending directives for workspace ${args.workspaceRoot} and evaluate DRAIN.

1. Fetch ALL tasks with label "directive" via \`task_list --label directive\`.
   Filter to those with \`extra.dirStatus: pending\` (already applied/deferred directives are excluded).
2. Write the full directive task list as a temporary JSON file at
   \`/tmp/drain-directives-<timestamp>.json\` — one JSON array of task objects as returned
   by \`task_list\`.
3. Run \`node experiments/quay-perpetual-stream/scripts/drain-scheduler.ts --json /tmp/drain-directives-<timestamp>.json\`
   (DIR-071). This script reads the JSON, filters to pending, classifies each directive
   as autonomous or human-steered, and outputs a JSON array of DUE directives.
   Exit 0 = directives due (prints JSON array to stdout); exit 3 = none due (no-op).
4. Parse the stdout JSON. Return {due: [{id, title, classification, ...}], count: <N>}.
   If exit 3 or empty JSON, return {due: [], count: 0} — the rest of this workflow is a no-op.

Workspace root: ${args.workspaceRoot}`,
  { phase: "Schedule",
    schema: { type: "object", required: ["due", "count"], properties: {
      due: { type: "array", items: { type: "object", properties: { id: {type:"string"}, title: {type:"string"}, classification: {type:"string"} } } },
      count: { type: "number" },
    } } }
)

if (!scheduleResult || scheduleResult.count === 0) {
  log("No directives due — nothing to drain.")
  return { drained: 0 }
}
log(`Drain scheduler: ${scheduleResult.count} DUE — ${scheduleResult.due.map(d => d.id).join(", ")}`)

// ── Phase: Dispose ──────────────────────────────────────────────────────────────────
phase("Dispose")

const dispositioned = []
for (const directive of scheduleResult.due) {
  const result = await agent(
    `Dispose directive ${directive.id} ("${directive.title}", classification: ${directive.classification}).

1. Read the current task via \`task_get ${directive.id}\`.
2. ADD label "milestone-candidate" to the task's labels (via \`task_write\` — merge with existing labels,
   do not replace). The directive task IS the milestone candidate — follows the SPLIT-OR-COMMIT
   discipline: if splitting is needed, the directive author should have created children.
3. SET \`extra.dirStatus: "applied"\` on the task (via \`task_write\`).
4. APPEND a \`## DRAIN disposition\` section to the task body (append to existing body, do not replace)
   recording:
   - Classification: ${directive.classification}
   - Timestamp: \`new Date().toISOString()\`
   - Action: added label:milestone-candidate, set dirStatus: applied
5. Return {id: "${directive.id}", classification: "${directive.classification}", ok: true}.
   If task_write fails (CAS conflict, task not found, etc.), return {id: "${directive.id}", ok: false, error: <reason>}.`,
    { phase: "Dispose",
      schema: { type: "object", required: ["id", "ok"], properties: {
        id: { type: "string" }, classification: { type: "string" },
        ok: { type: "boolean" }, error: { type: "string" },
      } } }
  )
  if (result) dispositioned.push(result)
}

const ok = dispositioned.filter(d => d.ok)
const failed = dispositioned.filter(d => !d.ok)
log(`Dispose complete: ${ok.length} dispositioned, ${failed.length} FAILED`)

if (failed.length > 0) {
  log(`FAILED dispositions: ${failed.map(d => `${d.id}: ${d.error}`).join("; ")}`)
}

// ── Phase: Verify ────────────────────────────────────────────────────────────────────
phase("Verify")

const verifyResult = await agent(
  `Verify DRAIN dispositions for directives [${ok.map(d => d.id).join(", ")}] in workspace ${args.workspaceRoot}.

For EACH disposed directive, read the task via \`task_get <id>\` and confirm:
1. \`extra.dirStatus\` is exactly "applied" (not "pending", not missing)
2. The task's labels include "milestone-candidate"
3. The task body contains a \`## DRAIN disposition\` section (the appended record)

Return {verified: <N>, failed: <N>, detail: <per-directive status>}.
If all passed, return {verified: ${ok.length}, failed: 0, drained: ${ok.length}}.
If any failed, flag which directives did not verify and why.`,
  { phase: "Verify",
    schema: { type: "object", required: ["verified", "failed"], properties: {
      verified: { type: "number" }, failed: { type: "number" },
      drained: { type: "number" }, detail: { type: "string" },
    } } }
)

const drained = verifyResult?.drained || ok.length
log(`DRAIN complete: ${drained} directive(s) drained → milestone-candidates.`)

return {
  drained,
  created: ok.map(d => d.id),
  failed: failed.map(d => d.id),
}
