export const meta = {
  name: 'run-routines',
  description: 'Evaluate the standing routine track from .quay/loop.yml — delegates to the quay:run-routines skill (plugin/skills/routines/SKILL.md). Backward-compat thin wrapper (M140, 2026-07-25).',
  phases: [
    { title: 'Skill', detail: 'Invoke quay:run-routines plugin skill (Schedule → Dispatch → Gate → Verify)' },
  ],
}

// DIR-114 (M175): Workflow tool sometimes delivers the `args` global as a JSON-encoded
// string rather than the parsed object its contract promises "verbatim" — normalize once,
// up front, and read everything through `$a` below (no bare `args` field access past this point).
const $a = (typeof args === 'string') ? JSON.parse(args) : args

// ── Phase: Routines ──────────────────────────────────────────────────────────────────────
phase('Routines')

// DIR-073 follow-up (2026-07-25): Replaced broken Skill() call with agent().
// Skill() is not available in the workflow JS runtime. The agent implements the
// routine track pipeline from plugin/skills/routines/SKILL.md directly.

const result = await agent(
  `Evaluate the standing routine track for workspace ${$a.workspaceRoot}, tasks dir ${$a.tasksDir || $a.workspaceRoot + '/tasks'}, milestone counter ${$a.milestoneCounter || 0}.

Pipeline (from plugin/skills/routines/SKILL.md):

### Phase 1 — Schedule
1. Read \`routines:\` from \`.quay/loop.yml\` (fall back to \`.quay/config.yml\` \`loop:\` section). Default [] = no routines — return {fired: 0} immediately.
2. Write routines as a temporary JSON array.
3. Run \`node experiments/quay-perpetual-stream/scripts/routine-scheduler.ts --iteration <counter> --event checkpoint --plugin-root . /tmp/routines-<counter>.json\`. Exit 0 = DUE list; exit 3 = none due.
4. If none due, return {fired: 0}.

### Phase 2 — Dispatch
For each DUE routine, read probe spec, check instrument availability, dispatch background agent with the probe objective.

### Phase 3 — Gate
Run findings through routine-file-gate.ts for quality/dedup/rate → ACCEPT|REJECT.

### Phase 4 — Verify
FILE-ONLY invariant: git status --porcelain → no product/method code touched.

Return {fired: <N>, filed: <N>, rejected: <N>, fileOnlyViolation: <bool>}.`,
  { phase: 'Routines',
    schema: { type: 'object', required: ['fired'], properties: {
      fired: { type: 'number' }, filed: { type: 'number' },
      rejected: { type: 'number' }, fileOnlyViolation: { type: 'boolean' },
    } } }
)

log(`Routines returned: fired=${result?.fired || 0}, filed=${result?.filed || 0}`)

return result || { fired: 0, filed: 0, rejected: 0, fileOnlyViolation: false }
