---
id: gap-fan-in-lock-hold-pairing-two-divergent-keys
title: fan-in lock hold intervals are paired by two independent functions with
  different keys and double-acquire handling, so the same lock-event log yields
  different intervals and verdicts
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
Found by pre-registered experiment `E-DT-1`, arm Hp, verifier cluster c11 (verdict supported, no documented intentional difference). The operator re-checked it on 2026-10-12, at pin `f2432d178` and again at develop:
- `plugin/scripts/fan-in-ff-protocol-check.ts:120` `buildLockHoldIntervals`:
  - key `${taskId}|${pid}` (no runId);
  - a second acquire on an open key sets `malformed = true` and is skipped, so the FIRST acquire wins;
  - `malformed` is a boolean.
- `plugin/scripts/fan-in-queueing-model.ts:166` `pairLockHolds`:
  - key `${taskId} ${runId} ${pid}`;
  - a second acquire OVERWRITES (`open.set`), so the LAST acquire wins;
  - unpaired releases are COUNTED.
  - Its own comment states that this key is the same set as `readFanInLockHold` (worker-driver.ts), "⛔ 不另造一套（硬规则 5b）" ("do not make a second set (hard rule 5b)").
- So for the same lock-event log, the two produce different hold intervals and different malformed verdicts. The protocol checker is the one that diverges from the key the codebase itself calls canonical.

**Prior work and novelty.**
- `gap-fan-in-ff-protocol-check-cross-task-false-positive` (done) scoped the checker by taskId. It did not address this key and double-acquire divergence.
- No task mentions `pairLockHolds`.
- Earlier hypothesis runs only claimed "two lock-event carriers exist", which is a different claim from this one.

## Plan
- Derive the pairing KEY from one shared definition: the canonical `(taskId, runId, pid)` that `readFanInLockHold` uses. Both consumers use it.
- Keep each consumer's own malformed POLICY if it is intentionally different (protocol check: a double acquire is a violation; model: statistics). Write that intent as a comment next to each consumer.
- No change to any carrier format.

## Acceptance Criteria
- [ ] `node --test plugin/test/fan-in-ff-protocol-check.test.mjs plugin/test/fan-in-queueing-model.test.mjs` exits 0, with new cases:
  - (a) A log with two runs of the same task under the same pid but different runIds pairs into 2 intervals in BOTH functions, and the protocol check does not flag it malformed.
  - (b) A true double acquire within one (taskId, runId, pid) is still flagged by the protocol check.
- [ ] Static check: `grep -n 'taskId}|${e.pid' plugin/scripts/fan-in-ff-protocol-check.ts` prints nothing, and both files reference one shared key helper. Paste the output.
- [ ] Mutation control: restore the protocol checker's `taskId|pid` key and show case (a) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-fan-in-lock-hold-pairing-two-divergent-keys` green.

## Touches
- tasks/gap-fan-in-lock-hold-pairing-two-divergent-keys.md
- plugin/scripts/fan-in-ff-protocol-check.ts
- plugin/scripts/fan-in-queueing-model.ts
- plugin/test/fan-in-ff-protocol-check.test.mjs
- plugin/test/fan-in-queueing-model.test.mjs
