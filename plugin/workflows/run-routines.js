export const meta = {
  name: 'run-routines',
  description: 'Evaluate the standing routine track from .quay/loop.yml — delegates to the quay:run-routines skill (plugin/skills/routines/SKILL.md). Backward-compat thin wrapper (M140, 2026-07-25).',
  phases: [
    { title: 'Skill', detail: 'Invoke quay:run-routines plugin skill (Schedule → Dispatch → Gate → Verify)' },
  ],
}

// ── Phase: Skill ────────────────────────────────────────────────────────────────────────
phase('Skill')

// Delegate to the quay:run-routines plugin skill (M140). The skill is the single source
// of truth for the routine track pipeline. This workflow exists for backward compat
// only — new callers should invoke the skill directly via `/routines` or the Skill tool.
const result = await Skill({
  skill: 'quay:run-routines',
  args: `workspaceRoot=${args.workspaceRoot} tasksDir=${args.tasksDir} milestoneCounter=${args.milestoneCounter || 0}`,
})

log(`Routines skill returned: ${JSON.stringify(result)}`)

return result || { fired: 0, filed: 0, rejected: 0, fileOnlyViolation: false }
