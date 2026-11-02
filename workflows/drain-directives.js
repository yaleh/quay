export const meta = {
  name: "drain-directives",
  description: "DRAIN pending directives: Schedule → Dispose → Verify. Reads directives from the task store, runs drain-scheduler.ts, disposes each due directive by adding label:milestone-candidate and setting dirStatus: applied, then verifies. Replaces OUTER-LOOP.md step 0 (DIR-071, 2026-07-24).",
  phases: [
    { title: "Schedule", detail: "Read directives via task store + evaluate drain scheduler" },
    { title: "Dispose", detail: "For each DUE directive: add label:milestone-candidate, set dirStatus: applied, append DRAIN disposition section" },
    { title: "Verify", detail: "Read back dispositioned directives → confirm dirStatus: applied → return {drained: N}" },
  ],
}

// DIR-114 (M175): Workflow tool sometimes delivers the `args` global as a JSON-encoded
// string rather than the parsed object its contract promises "verbatim" — normalize once,
// up front, and read everything through `$a` below (no bare `args` field access past this point).
const $a = (typeof args === "string") ? JSON.parse(args) : args

// ── Phase: Schedule ──────────────────────────────────────────────────────────────────
phase("Schedule")

const scheduleResult = await agent(
  `Read the pending directives for workspace ${$a.workspaceRoot} and evaluate DRAIN.

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

Workspace root: ${$a.workspaceRoot}`,
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
// gap-drain-dispose-body-corruption (2026-07-31): a prior real run (wf_bb989746-4a0, 2026-07-26)
// corrupted 3 of 5 directive bodies here — the dispatched agent read the body via `task_get`, then
// manually retyped the ENTIRE body as `task_write`'s `body` argument, copying the JSON-escaped text
// it saw in the tool result (where real newlines are legitimately shown escaped as the two
// characters `\` `n` for wire transport) instead of decoding it back to a real newline. Confirmed
// at the tool-call-INPUT level (not just the on-disk artifact) via the agent's own
// agent-*.jsonl transcript: the corrupted runs' own `task_write` `body` parameter already had 0
// real newlines / 100+ literal `\n` sequences before it ever reached the Provider ABI. This
// happened non-deterministically (same prompt, 3 of 5 independent dispatches) — so the fix below
// is structural: the prompt no longer asks the agent to read-and-retype the body AT ALL. The
// actual append now happens inside `quay task edit --append-notes`, a small deterministic CLI
// step (`current.body + "\n\n" + noteText`, real JS string concat) the agent only supplies
// (id, short freshly-authored section text) to — never the pre-existing body. A mechanical,
// non-LLM-judgment post-write check (drain-dispose-corruption-check.ts) then fails closed on
// exactly the corruption shape this bug produced.
phase("Dispose")

const dispositioned = []
for (const directive of scheduleResult.due) {
  const result = await agent(
    `Dispose directive ${directive.id} ("${directive.title}", classification: ${directive.classification}) in workspace ${$a.workspaceRoot}.

CRITICAL — body-corruption prevention (gap-drain-dispose-body-corruption): a prior DRAIN run
corrupted 3 of 5 directive bodies because the dispatched agent read the body via \`task_get\`, then
manually retyped the ENTIRE body (old content + new section) as \`task_write\`'s \`body\` argument —
copying the JSON-escaped text it saw in the \`task_get\` tool result (where real newlines are
legitimately shown escaped as the two literal characters \`\\\` and \`n\` for wire transport) instead
of decoding them back to a real newline. This happened non-deterministically (same prompt template,
3 of 5 dispatches) — so this prompt no longer asks you to read-and-retype the body at all. NEVER
pass the existing body text (in whole or in part) as an argument to \`task_write\` or to any CLI
flag below.

1. Read the current task via \`task_get ${directive.id}\` — use ONLY the \`labels\` and \`extra\`
   fields from the result (short scalar/array values, safe to retype). Do NOT use the \`body\` field
   from this result as an intermediate to reconstruct or retype anything — that is exactly the
   corruption mechanism above.
2. Compute the new label array: existing labels + "milestone-candidate" (dedup, preserve order).
3. Compute the new extra object: existing extra fields, with \`dirStatus\` set to \`"applied"\`
   (merge — keep every other existing extra key, e.g. \`schema\`, \`acceptance\`).
4. Determine the native provider's on-disk tasks directory: read \`.quay/config.yml\`'s
   \`providers.native.tasks_dir\` (default \`tasks\` if unset), relative to workspace root
   ${$a.workspaceRoot}. Call it \`<tasks_dir>\` below. Via Bash, record the PRE-write real line
   count of that directive's file: \`OLD_LINES=$(wc -l < <tasks_dir>/${directive.id}.md)\`.
5. Run this exact command via the Bash tool (cwd = workspace root ${$a.workspaceRoot}) —
   \`quay task edit\`'s \`--append-notes\` flag reads the current body and appends ENTIRELY inside
   the CLI process (never through your own context), so this is the ONLY step allowed to touch the
   body, and you only ever supply a fresh, freshly-authored, short NEW section — never the old body:

   cd ${$a.workspaceRoot} && node packages/quay/bin/quay.ts task edit ${directive.id} \\
     --labels "<merged-labels-comma-separated>" \\
     --extra '<merged-extra-as-JSON>' \\
     --append-notes "$(cat <<'DRAINNOTE'
   ## DRAIN disposition

   - Classification: ${directive.classification}
   - Timestamp: <ISO timestamp you generate now, e.g. via \`date -u +%Y-%m-%dT%H:%M:%S.000Z\`>
   - Action: added label:milestone-candidate, set dirStatus: applied
   DRAINNOTE
   )"

6. Run the mechanical post-write corruption check via Bash — this is NOT optional, and its exit
   code decides pass/fail, not your own reading of the file:
   \`node experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts --file <tasks_dir>/${directive.id}.md --min-lines "$OLD_LINES"\`
   Exit 0 = integrity check passed. Exit non-zero = FAIL CLOSED — treat this directive as
   \`ok: false\` regardless of whether step 5's command itself reported success, and copy the check
   script's own printed JSON \`reasons\` array into your \`error\` field verbatim.
7. Return {id: "${directive.id}", classification: "${directive.classification}", ok: true,
   oldLineCount: <the $OLD_LINES value from step 4, as a number>}.
   If step 5's command fails (CAS conflict, task not found, non-zero exit, etc.) OR step 6's
   corruption check exits non-zero, return {id: "${directive.id}", ok: false, error: <reason —
   include the corruption check's reasons verbatim if that is what failed>, oldLineCount: <the
   $OLD_LINES value, as a number, if you got that far>}.`,
    { phase: "Dispose",
      schema: { type: "object", required: ["id", "ok"], properties: {
        id: { type: "string" }, classification: { type: "string" },
        ok: { type: "boolean" }, error: { type: "string" }, oldLineCount: { type: "number" },
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
// gap-drain-dispose-body-corruption: the ORIGINAL Verify phase already did step 1 below (task_get
// + eyeball dirStatus/labels/DRAIN-disposition-presence) and its own `{"failed":[]}` summary still
// silently passed all 3 corrupted directives from wf_bb989746-4a0 — an LLM reading a task_get
// result did not notice the body was JSON-escaped garbage. Step 2 below is new: an independent,
// mechanical (non-LLM-judgment) re-run of the SAME corruption check the Dispose phase used, this
// time as a second, separately-dispatched confirmation. Step 1 alone is NOT sufficient evidence.
phase("Verify")

const verifyResult = await agent(
  `Verify DRAIN dispositions for these directives in workspace ${$a.workspaceRoot}:
${JSON.stringify(ok.map(d => ({ id: d.id, oldLineCount: d.oldLineCount })))}

For EACH disposed directive:
1. Read the task via \`task_get <id>\` and confirm:
   a. \`extra.dirStatus\` is exactly "applied" (not "pending", not missing)
   b. The task's labels include "milestone-candidate"
   c. The task body contains a \`## DRAIN disposition\` section (the appended record)
2. Independently re-run the SAME mechanical post-write corruption check the Dispose phase used —
   this is the check a prior run's LLM-only pass (step 1 alone) missed on 3 of 5 corrupted
   directives, so step 1 passing is NOT sufficient on its own. Determine the native provider's
   tasks directory (read \`.quay/config.yml\`'s \`providers.native.tasks_dir\`, default \`tasks\`,
   relative to workspace root), then via Bash for each directive:
   \`node experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts --file <tasks_dir>/<id>.md --min-lines <that directive's oldLineCount from the list above>\`
   Exit 0 = pass. Exit non-zero = FAIL CLOSED for that directive regardless of step 1's result —
   copy the script's printed JSON \`reasons\` into that directive's detail.

Return {verified: <N>, failed: <N>, detail: <per-directive status, including any corruption-check
reasons verbatim>}.
If EVERY directive passes BOTH step 1 and step 2, return {verified: ${ok.length}, failed: 0, drained: ${ok.length}}.
If ANY directive fails either step, do NOT report {failed: 0} — flag exactly which directives
failed and why (distinguish a step-1 field mismatch from a step-2 corruption-check failure).`,
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
