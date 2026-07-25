export const meta = {
  name: 'select-preflight',
  description: 'Encapsulate OUTER-LOOP SELECT preflight (steps 1-3) into a thin workflow with exactly ONE agent call for deliverable classification. Replaces ~15 manual turns per /loop wake-up. Other steps (script run, composeShortlist) are shell commands within the same agent invocation. (DIR-072/M153, 2026-07-25)',
  phases: [
    { title: 'SelectPreflight', detail: 'Run select-preflight.ts → classify deliverable (LLM judgment) → compose shortlist → return. Exactly ONE agent call.' },
  ],
}

// ── Phase: SelectPreflight ──────────────────────────────────────────────────────────────
// SINGLE agent call that:
//   1. Runs select-preflight.ts (shell command, no LLM judgment)
//   2. Classifies deliverable:yes|no per candidate (THE ONE LLM judgment step)
//   3. Runs deliverable-governor.ts --shortlist (shell command, no LLM judgment)
//   4. Returns complete structured result
phase('SelectPreflight')

const result = await agent(
  `Encapsulate OUTER-LOOP SELECT preflight (steps 1-3) into a single structured invocation. You have three sequential tasks:

## TASK 1: Run preflight script (shell command — no LLM judgment needed)

1. Extract milestone_counter from experiments/quay-perpetual-stream/dashboard.md: grep for \`**milestone_counter: <N>**\`.
2. Run: \`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts --json --workspace-root ${args.workspaceRoot || '.'} --milestone-counter <counter>\`
3. Parse the JSON output as PreflightResult.
4. If \`halt: true\` → return \`{outcome: "halted", reason: haltReason}\` immediately.
5. If \`pendingDirectives\` non-empty → record as WARNING (informational, not blocking — the caller should /drain-directives first per DIR-071).
6. If 0 candidates → return \`{outcome: "done", shortlist: [], s: 0, ...}\`.

## TASK 2: Classify deliverable (THE ONE LLM judgment step — criterion 丙)

For each candidate in the preflight result, classify deliverable:yes|no:

**Criterion 丙:**
- YES: landed output consumed OUTSIDE this loop — shipped code, release pipeline, skill/ADR used by other workspaces, fix observed in real downstream.
- NO: loop's own machinery (scripts, workflows, dashboards, methodology docs only the loop reads).
- AMBIGUOUS → NO (conservative).

Return an array: \`[{id: "<task-id>", deliverable: "yes"|"no"}]\`

## TASK 3: Compose shortlist (shell command — no LLM judgment needed)

1. Merge each candidate's rank from Task 1 with its deliverable verdict from Task 2 into:
   \`\`\`json
   {"candidates": [{"id":"...", "deliverable":"yes"|"no", "rank": N}, ...], "streak": <cadence.streak>, "sMax": 4}
   \`\`\`
2. Pipe to: \`echo '<json>' | node --experimental-strip-types experiments/quay-perpetual-stream/scripts/deliverable-governor.ts --shortlist\`
3. Parse the ShortlistResult.

## TASK 4: Return

Return the complete structured result:
\`\`\`
{
  outcome: "done",
  halt: false,
  pendingDirectives: [...],
  cadence: {verdict, streak, threshold, lastExploreAt},
  candidates: [{id, title, rank, schemaPass, hasTouches, deliverable}],
  shortlist: [{id, deliverable, rank, ...}],
  s: <shortlist size>,
  deliverableStreak: <cadence.streak>,
  starvation: <true|false>,
  floor: <shortlist floor>,
  milestoneCounter: <N>
}
\`\`\``,
  {
    phase: 'SelectPreflight',
    schema: {
      type: 'object',
      required: ['outcome'],
      properties: {
        outcome: { type: 'string' },
        halt: { type: 'boolean' },
        haltReason: { type: 'string' },
        pendingDirectives: { type: 'array', items: { type: 'string' } },
        cadence: { type: 'object' },
        candidates: { type: 'array' },
        shortlist: { type: 'array' },
        s: { type: 'number' },
        deliverableStreak: { type: 'number' },
        starvation: { type: 'boolean' },
        floor: { type: 'number' },
        milestoneCounter: { type: 'number' },
      },
    },
  },
)

return result || { outcome: 'needs-human', reason: 'agent returned null' }
