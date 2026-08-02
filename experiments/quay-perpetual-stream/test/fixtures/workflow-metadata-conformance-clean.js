// workflow-metadata-conformance-clean.js — GREEN fixture for DIR-124-A4.
//
// The corrected variant of workflow-metadata-conformance-stale.js: the phantom `DeadPhase` entry is
// removed, `ExtraPhase` is added to meta.phases, and the description claims exactly the outcome
// union the body actually returns. The checker MUST exit 0 (GREEN) on this file.
export const meta = {
  name: 'fixture-clean',
  description: 'Returns {outcome: "done"|"needs-human"}.',
  phases: [
    { title: 'Verify', detail: 'runs the checks' },
    { title: 'ExtraPhase', detail: 'does extra work' },
  ],
}
phase('Verify')
phase('ExtraPhase')
function work() {
  return { outcome: 'done', reason: 'ok' }
}
function blocked() {
  return { outcome: 'needs-human', reason: 'blocked' }
}
