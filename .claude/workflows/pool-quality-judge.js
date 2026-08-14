export const meta = {
  name: 'pool-quality-judge',
  description:
    'pool 任务质量语义闸 (task gap-pool-quality-semantic-gate, ADR-033): 机械触发 (pool>25 / 最久未复核>48h / 每 10 轮) 后,每 pool 任务一个 schema agent 判 ready/needs-work/should-remove/uncertain,JS 算术聚合,should-remove → 撤出/重定范围。泛化自 nyf-semantic-judge (49c0be86 证明过一次然后丢失——三层执行核只有「检测 workflow 没被调用」的仪器,没有「调用 workflow」的步骤;本 workflow 就是那个被调用的动作)。',
  phases: [
    { title: 'Plan', detail: 'run plugin/scripts/pool-quality-judge.ts --plan (mechanical triggers + pool enumeration, no LLM judgment) → if not triggered and not forced, return not-triggered' },
    { title: 'Judge', detail: 'one schema agent per pool task — ready/needs-work/should-remove/uncertain + premiseSound + evidence + recommendation' },
    { title: 'Aggregate', detail: 'JS arithmetic over the agent verdicts (distribution + action routing, should-remove → remove-or-rescope)' },
  ],
}

// DIR-114 (M175): Workflow tool sometimes delivers the `args` global as a JSON-encoded string rather
// than the parsed object its contract promises — normalize once, read everything through `$a`.
const $a = (typeof args === 'string') ? JSON.parse(args) : (args || {})
const root = $a.root || $a.workspaceRoot || '.'

// ── Phase: Plan ──────────────────────────────────────────────────────────────────────────────────
// MECHANICAL only — run the deterministic script, return its JSON verbatim. No LLM judgment here.
// (trigger uses mechanical quantities; judgment is the agent's job — ADR-033.)
phase('Plan')

const plan = await agent(
  `Run the deterministic mechanical planner (no LLM judgment — it is pure arithmetic):

1. Run: \`node --no-warnings --experimental-strip-types plugin/scripts/pool-quality-judge.ts --root ${root} --plan\`
2. Parse its JSON output. It contains:
   - \`triggers\`: { poolCount, oldestUnreviewedAgeMs, roundsSinceLastJudge, fired, reasons }
   - \`pool\`: the list of pool task ids (status:ready minus not-yet-flipped/fixture/parked)
   - \`tasks\`: per-task mechanical input [{ id, acChecked, acTotal, acCompleteness, sections, fileAgeMs }]
3. Return the PARSED object verbatim under these fields: { triggers, pool, tasks, poolCount, currentRound }.

Do NOT add, remove, or judge any task. If the script exits non-zero, return { error: <stderr> } and stop.`,
  {
    phase: 'Plan',
    schema: {
      type: 'object',
      required: ['triggers', 'pool'],
      properties: {
        triggers: {
          type: 'object',
          required: ['fired', 'reasons', 'poolCount', 'oldestUnreviewedAgeMs', 'roundsSinceLastJudge'],
          properties: {
            fired: { type: 'boolean' },
            reasons: { type: 'array', items: { type: 'string' } },
            poolCount: { type: 'number' },
            oldestUnreviewedAgeMs: { type: 'number' },
            roundsSinceLastJudge: { type: 'number' },
          },
        },
        pool: { type: 'array', items: { type: 'string' } },
        tasks: { type: 'array' },
        poolCount: { type: 'number' },
        currentRound: { type: 'number' },
        error: { type: 'string' },
      },
    },
  },
)

if (plan.error) {
  return { outcome: 'error', reason: plan.error }
}
if (!plan.triggers.fired && !$a.force) {
  return {
    outcome: 'not-triggered',
    reasons: plan.triggers.reasons,
    triggers: plan.triggers,
    pool: plan.pool,
  }
}

// ── Phase: Judge ─────────────────────────────────────────────────────────────────────────────────
// ONE schema agent per pool task. The judgment is semantic (premise sound? work truly landed?
// should it be removed/rescoped?) — script only prepared the mechanical input (ADR-033).
const POOL = (plan.pool || []).filter(Boolean)

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ready', 'needs-work', 'should-remove', 'uncertain'] },
    acCompleteness: { type: 'string', enum: ['all-checked', 'partial', 'none'] },
    premiseSound: { type: 'boolean' },
    evidence: { type: 'string' },
    recommendation: { type: 'string' },
  },
  required: ['verdict', 'acCompleteness', 'premiseSound', 'evidence', 'recommendation'],
}

phase('Judge')
const results = POOL.length
  ? await pipeline(
      POOL,
      async (id) => {
        const mech = (plan.tasks || []).find((t) => t && t.id === id) || {}
        const r = await agent(
          `Judge task ${id} in ${root}/tasks/${id}.md as a POOL-QUALITY gate (ADR-033: judgment is semantic, mechanical script only counts AC boxes).

Mechanical input (from the script, trust it as arithmetic, NOT a verdict): acChecked=${mech.acChecked}/${mech.acTotal} acCompleteness=${mech.acCompleteness} sections=[${(mech.sections || []).join(',')}].

Read the task file (${root}/tasks/${id}.md) and decide ONE of four verdicts:
- ready        — the work truly landed (all substantive ACs genuinely done, implementation on the target branch), premise holds, dispatchable.
- needs-work   — real work remains (ACs unchecked or incomplete plan); premise holds but the task is not finishable as-is.
- should-remove — the task's PREMISE is falsified (the gap it claims does not exist, or the mechanism it targets was retired/replaced — cf. gap-crosscut-checks-zero-coverage-of-plugin-scripts which was manually RESCOPED after its premise was disproven). Such a task must be removed or rescoped, NOT dispatched.
- uncertain    — verification-window ACs (need outer re-run) or genuinely ambiguous; needs human.

Return { verdict, acCompleteness, premiseSound, evidence, recommendation }.`,
          { label: `judge:${id}`, phase: 'Judge', schema: VERDICT_SCHEMA },
        )
        return { id, ...r }
      },
    )
  : []

// ── Phase: Aggregate (JS arithmetic — the deterministic part, ADR-033) ─────────────────────────
phase('Aggregate')

const counted = { ready: 0, needsWork: 0, shouldRemove: 0, uncertain: 0 }
const actions = []
for (const r of results) {
  const v = r.verdict
  counted[({ ready: 'ready', 'needs-work': 'needsWork', 'should-remove': 'shouldRemove', uncertain: 'uncertain' })[v]] += 1
  const action = ({ ready: 'dispatchable', 'needs-work': 'back-to-todo', 'should-remove': 'remove-or-rescope', uncertain: 'needs-human' })[v]
  actions.push({
    id: r.id,
    verdict: v,
    action,
    reason: v === 'should-remove' ? `premise-falsified → ${action}: ${r.evidence}` : r.evidence,
  })
}
const shouldRemoveIds = actions.filter((a) => a.verdict === 'should-remove').map((a) => a.id)

// ── Phase: Record (write end — B15: 完成态持久化,单写者) ────────────────────────────────
// The judge COMPLETED (verdicts aggregated). Persist lastRound so the every-10-rounds trigger
// resets — this is the missing write half of readLastJudgeRound (B3-戊族「永远响」). Single
// writer = the deterministic script's --record-last-round; the workflow only invokes it here at
// the completion path. NOT a new mechanism — the read end already existed; this completes it.
phase('Record')

const recorded = await agent(
  `Persist the completed judge's lastRound (B15 — the every-10-rounds trigger must reset after a judge).

Run: \`node --no-warnings --experimental-strip-types plugin/scripts/pool-quality-judge.ts --root ${root} --record-last-round\`
Return the parsed JSON verbatim: { recorded, lastRound, path }.`,
  {
    phase: 'Record',
    schema: {
      type: 'object',
      required: ['recorded', 'lastRound'],
      properties: {
        recorded: { type: 'boolean' },
        lastRound: { type: 'number' },
        path: { type: 'string' },
      },
    },
  },
)

log(`pool=${POOL.length} ready=${counted.ready} needs-work=${counted.needsWork} should-remove=${counted.shouldRemove} uncertain=${counted.uncertain}`)
return {
  outcome: 'judged',
  distribution: counted,
  shouldRemoveIds,
  actions,
  results,
  triggers: plan.triggers,
  lastJudgeRecorded: (recorded && recorded.recorded) ? recorded.lastRound : null,
}
