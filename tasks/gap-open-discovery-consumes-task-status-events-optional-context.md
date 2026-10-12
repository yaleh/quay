---
id: gap-open-discovery-consumes-task-status-events-optional-context
title: open semantic discovery reads task_log since its cursor as OPTIONAL
  context (never gates/triggers a round)
status: todo
labels:
  - gap
  - task-trace
  - open-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-quay-task-log-trace-read-surface
  - gap-open-semantic-discovery-routine-track
---
## Proposal
Under SEMANTIC FIRST, MECHANIZE LATER, the open semantic discovery routine (`gap-open-semantic-discovery-routine-track`) explores source on its own judgment every 60m. Reliable "what changed since my last round" context helps it choose where to look: tasks that just landed, tasks reset after a failed landing, tasks escalated to needs-human. That context comes from real transition events read through `quay task log`, not from commit-title guesses.

The context is OPTIONAL. Events never gate or trigger a round:
- no events ⇒ the round still runs;
- many events ⇒ still one bounded round.
Mechanics only fetch and persist a cursor. What to do with the context is the model's call.

## Plan
1. At round start, read `quay task log --since <stored cursor> --limit <n>` (n from config, default 50).
   - Pass a compact summary (task id, from→to, at, evidence.commit, `inferred` flag) into the investigator prompt as "recent changes you MAY consider". The model may also read the commits' diffs with its own tools.
   - Store the new cursor in the routine's carrier only after the round's append, so a crashed round re-reads (at-least-once). Dedupe by `eventId`.
2. On `rebase:true` or `complete:false`, pass that fact to the model as-is ("this list may be incomplete: <reasons>"). No mechanical fallback to commit titles.
3. The round record lists the cursor before/after, the event count offered, and whether the model's stated focus cited any of them (its own statement, not a mechanical attribution).
4. No extra model call; it adds prompt tokens only. Its cost is visible in the round's per-call token and gateway cost.

## Acceptance Criteria
- [ ] Tests exit 0, covering:
  - (a) 0 events ⇒ the round runs normally;
  - (b) more events than `n` ⇒ capped, and the remainder is picked up next round;
  - (c) a crash before the append ⇒ the next round re-offers the same events, deduped by `eventId`;
  - (d) `rebase:true` / `complete:false` reaches the prompt verbatim;
  - (e) no code path skips or schedules a round based on events (static control).
- [ ] Negative control: make the round skip when there are 0 events in a scratch copy ⇒ (a) red. Paste the output.
- [ ] Production reading: the first resident round after landing. Paste its cursor before/after, the event summary it was offered, its stated focus and the files it read. If the focus did not use the events, say so; that is a valid outcome. （待外部）

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-consumes-task-status-events-optional-context` green.

## Touches
- tasks/gap-open-discovery-consumes-task-status-events-optional-context.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
