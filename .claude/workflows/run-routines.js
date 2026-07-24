export const meta = {
  name: 'run-routines',
  description: 'Evaluate the standing routine track from .quay/loop.yml routines: — scheduler → readProbeSpec → dispatch probes → gate findings → FILE-ONLY verify. Replaces OUTER-LOOP.md step 5a (DIR-051/056, wired 2026-07-24).',
  phases: [
    { title: 'Schedule', detail: 'Read routines config + evaluate triggers' },
    { title: 'Dispatch', detail: 'Dispatch DUE probes as fresh-context background agents' },
    { title: 'Gate',     detail: 'Gate each finding through routine-file-gate (quality/dedup/rate)' },
    { title: 'Verify',   detail: 'FILE-ONLY invariant — no product/method code touched' },
  ],
}

// ── Phase: Schedule ──────────────────────────────────────────────────────────────────
phase('Schedule')

const scheduleResult = await agent(
  `Read the routines configuration for workspace ${args.workspaceRoot}.

1. Read \`routines:\` from \`.quay/loop.yml\` (falls back to \`.quay/config.yml\` \`loop:\` section, DIR-050).
   Default \`[]\` = no routines — return {due: [], fire: 0} immediately.
2. If routines are present, write them as a temporary JSON array to a temp file
   (e.g. \`/tmp/routines-<milestone>.json\`), one object per routine with
   {name, trigger, probe?, dispatch?}.
3. Run \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/routine-scheduler.ts" --iteration <milestone_counter>
   --event checkpoint --plugin-root "\${CLAUDE_PLUGIN_ROOT}" /tmp/routines-<milestone>.json\`
   (DIR-051). These scripts ship WITH the plugin (\`\${CLAUDE_PLUGIN_ROOT}/scripts/\`,
   per DIR-049/056) — do NOT look for them in the workspace's own scripts/.
   Exit 0 + lists DUE routines (one per line: \`DUE: <name> (<trigger>) → probe <name>\`);
   exit 3 = none due.
4. Return {due: [{name, probe}], fire: <count>}. If no routines or none due,
   return {due: [], fire: 0} — the rest of this workflow is a no-op.

Milestone counter: ${args.milestoneCounter}
Workspace root: ${args.workspaceRoot}`,
  { phase: 'Schedule',
    schema: { type: 'object', required: ['due', 'fire'], properties: {
      due: { type: 'array', items: { type: 'object', properties: { name: {type:'string'}, probe: {type:'string'} } } },
      fire: { type: 'number' },
    } } }
)

if (!scheduleResult || scheduleResult.fire === 0) {
  log('No routines due — nothing to fire.')
  return { fired: 0 }
}
log(`Routine scheduler: ${scheduleResult.fire} DUE — ${scheduleResult.due.map(d => d.name).join(', ')}`)

// ── Phase: Dispatch ──────────────────────────────────────────────────────────────────
phase('Dispatch')

const dispatchResults = await parallel(
  scheduleResult.due.map(r => () => agent(
    `Fire routine probe "${r.probe}" (routine "${r.name}") for workspace ${args.workspaceRoot}.

1. Call readProbeSpec("${r.probe}", CLAUDE_PLUGIN_ROOT) from
   \`\${CLAUDE_PLUGIN_ROOT}/scripts/read-probe-spec.ts\` (DIR-056) to get
   {instrument, fallback, output_routing, objective}. FAIL-CLOSED: if readProbeSpec throws,
   return {probe: "${r.probe}", error: 'readProbeSpec failed', filed: false} — skip this
   routine, never crash the loop.

2. INSTRUMENT AVAILABILITY CHECK: if instrument !== "none", verify the named MCP server
   (e.g. meta-cc, archguard) is available in the current session. If unavailable and
   fallback === "none", return {probe: "${r.probe}", error: 'instrument unavailable',
   filed: false} — skip and log; the routine will fire again on its next trigger.

3. Prepend \`WORKSPACE: ${args.workspaceRoot}\\n\` to spec.objective (so the probe agent
   can resolve workspace-relative paths without hardcoding).

4. DISPATCH a fresh-context background subagent (DIR-048 dispatched infra) with the
   combined objective prompt. The agent explores the workspace, finds real defects/gaps,
   and writes its findings as candidate task files (## Finding-bearing, evidence-backed).

5. Return {probe: "${r.probe}", routine: "${r.name}", candidates: [<paths to candidate .md files>],
   filed: true, instrumentChecked: <bool>}.

MCP servers available in this session: check \`/mcp\` or the tool list.
If instrument is required and unavailable, DO NOT dispatch — return filed:false immediately.`,
    { label: `probe-${r.name}`, phase: 'Dispatch',
      schema: { type: 'object', required: ['probe', 'filed'], properties: {
        probe: { type: 'string' }, routine: { type: 'string' },
        candidates: { type: 'array', items: { type: 'string' } },
        filed: { type: 'boolean' }, error: { type: 'string' },
      } } }
  ))
)

const allCandidates = dispatchResults.filter(Boolean).flatMap(r => (r.candidates || []).map(c => ({
  path: c, probe: r.probe, routine: r.routine, output_routing: r.output_routing
})))
log(`Dispatch complete: ${allCandidates.length} candidate finding(s) from ${dispatchResults.filter(Boolean).filter(r => r.filed).length} probe(s)`)

if (allCandidates.length === 0) {
  log('No candidates filed — all probes returned empty or failed instrument check.')
  return { fired: scheduleResult.fire, filed: 0 }
}

// ── Phase: Gate ──────────────────────────────────────────────────────────────────────
phase('Gate')

const gateResults = await parallel(
  allCandidates.map(c => () => agent(
    `Gate candidate finding at ${c.path} (from probe "${c.probe}", routine "${c.routine}").

Run \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/routine-file-gate.ts" --board ${args.tasksDir}
--recent 3 --k 3 ${c.path}\` (DIR-051). These scripts ship WITH the plugin
(\`\${CLAUDE_PLUGIN_ROOT}/scripts/\`, per DIR-049/056) — do NOT look for workspace scripts/.

Exit 0 = ACCEPT: actionable finding with reproduction evidence, NOT a duplicate on the
board, within the per-window rate cap → MOVE the file into the board directory
(${args.tasksDir}/) and label it per the probe's output_routing[type] (default
"milestone-candidate"). Exit 1 = REJECT → DISCARD the candidate file (do NOT move it
to the board).

The gate self-reject bug (M96) is FIXED as of 2026-07-22: routine-file-gate.ts
boardKeys() excludes the candidate file itself via realpath comparison. The candidate
may sit wherever the probe agent wrote it — the gate handles it correctly.

Return {candidate: "${c.path}", probe: "${c.probe}", accepted: true|false, reason: <string>}.`,
    { label: `gate-${c.probe}`, phase: 'Gate',
      schema: { type: 'object', required: ['candidate', 'accepted'], properties: {
        candidate: { type: 'string' }, probe: { type: 'string' },
        accepted: { type: 'boolean' }, reason: { type: 'string' },
      } } }
  ))
)

const accepted = gateResults.filter(Boolean).filter(g => g.accepted)
const rejected = gateResults.filter(Boolean).filter(g => !g.accepted)
log(`Gate complete: ${accepted.length} ACCEPTED, ${rejected.length} REJECTED (${rejected.map(r => r.candidate).join(', ') || 'none'})`)

// ── Phase: Verify ────────────────────────────────────────────────────────────────────
phase('Verify')

const verifyResult = await agent(
  `Verify the FILE-ONLY invariant for workspace ${args.workspaceRoot}.

Run \`git -C ${args.workspaceRoot} status --porcelain\`. The routine track MUST have
produced ONLY new task files (or board entries under ${args.tasksDir}/). If git status
shows ANY change to product code, method docs, scripts, config, or anything outside the
board directory: the FILE-ONLY invariant is violated → discard those changes and flag.

Specifically ACCEPTABLE (these are routine-filed findings, expected):
- New files under ${args.tasksDir}/ (task .md files)
- No other changes

UNACCEPTABLE (routine touched what it shouldn't):
- Any modified/deleted file anywhere
- Any new file outside ${args.tasksDir}/

If violation found: \`git checkout -- <offending files>\` to discard, and return
{violation: true, detail: <what was discarded>}.

Return {violation: false} if clean, or {violation: true, detail: ...} if any product/method
files were touched and discarded.`,
  { phase: 'Verify',
    schema: { type: 'object', required: ['violation'], properties: {
      violation: { type: 'boolean' }, detail: { type: 'string' },
    } } }
)

if (verifyResult?.violation) {
  log(`FILE-ONLY VIOLATION: ${verifyResult.detail} — discarded.`)
}

return {
  fired: scheduleResult.fire,
  filed: accepted.length,
  rejected: rejected.length,
  fileOnlyViolation: verifyResult?.violation || false,
}