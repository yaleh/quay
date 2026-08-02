// workflow-metadata-conformance-stale.js — RED fixture for DIR-124-A4.
//
// Deliberately STALE metadata surface (WIRING-CLAIM C4: test-only file, NEVER committed to
// .claude/workflows/). It fabricates every FAIL-level drift class the checker must catch:
//   - meta.phases lists `DeadPhase` which the body never enters (phantom phase → FAIL)
//   - the body calls `phase('ExtraPhase')` which meta.phases does not list (stale metadata → FAIL)
//   - meta.description claims outcome 'building' which no return site produces (stale claim → FAIL)
//   - the body returns 'needs-human' which meta.description does not claim (incomplete claim → FAIL)
// The checker MUST exit 1 (RED) on this file.
export const meta = {
  name: 'fixture-stale',
  description: 'Returns {outcome: "done"|"building"}.',
  phases: [
    { title: 'Verify', detail: 'runs the checks' },
    { title: 'DeadPhase', detail: 'phantom phase — never entered in the body' },
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
