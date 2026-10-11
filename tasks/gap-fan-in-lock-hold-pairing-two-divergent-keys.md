---
id: gap-fan-in-lock-hold-pairing-two-divergent-keys
title: fan-in lock hold intervals are paired by two independent functions with
  different keys and double-acquire handling, so the same lock-event log yields
  different intervals and verdicts
status: done
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
- [x] `node --test plugin/test/fan-in-ff-protocol-check.test.mjs plugin/test/fan-in-queueing-model.test.mjs` exits 0, with new cases:
  - (a) A log with two runs of the same task under the same pid but different runIds pairs into 2 intervals in BOTH functions, and the protocol check does not flag it malformed.
  - (b) A true double acquire within one (taskId, runId, pid) is still flagged by the protocol check.
  - ```
    $ node --test plugin/test/fan-in-ff-protocol-check.test.mjs plugin/test/fan-in-queueing-model.test.mjs ; echo exit=$?
    ✔ AC(a) two runs of the SAME task under the SAME pid pair into 2 intervals — NOT a double acquire
    ✔ AC(b) a TRUE double acquire within one (taskId, runId, pid) is still flagged (POLICY kept)
    ✔ AC(a) 同任务同 pid 的两个 run（不同 runId）配成 2 个区间——与协议检查器读同一份日志同解
    ℹ tests 50   ℹ pass 50   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
    exit=0
    ```
  - Case (a) is asserted on TWO log shapes: the AC's literal sequential shape, AND an interleaved shape (two holders of one task under different lock domains per SPEC-goal-branch §4.6, recycled pid). Only the interleaved one makes the two keys produce different VERDICTS, so it is asserted first — the AC's own claims go red under the AC3 mutation, not just a key string.
- [x] Static check: `grep -n 'taskId}|${e.pid' plugin/scripts/fan-in-ff-protocol-check.ts` prints nothing, and both files reference one shared key helper. Paste the output.
  - ```
    $ grep -n 'taskId}|${e.pid' plugin/scripts/fan-in-ff-protocol-check.ts
    (no output — exit 1)
    $ grep -n 'lockHoldKey' plugin/scripts/fan-in-ff-protocol-check.ts plugin/scripts/fan-in-queueing-model.ts
    plugin/scripts/fan-in-ff-protocol-check.ts:127:export function lockHoldKey(e) {
    plugin/scripts/fan-in-ff-protocol-check.ts:155:    const key = lockHoldKey(e);
    plugin/scripts/fan-in-queueing-model.ts:50:import { lockHoldKey } from "./fan-in-ff-protocol-check.ts";
    plugin/scripts/fan-in-queueing-model.ts:184:    const key = lockHoldKey(e);
    ```
  - ⚠️ Reported, not hidden (硬规则 2, positive control): the AC's literal predicate is VACUOUS — it prints nothing on the PRE-change file too, because the old line read `${e.taskId ?? "?"}|${e.pid ?? "?"}`, which contains no `taskId}|` substring. `git show HEAD:plugin/scripts/fan-in-ff-protocol-check.ts | grep -c 'taskId}|${e.pid'` = 0. Non-vacuous replacement of the same static check: `grep -nE '\$\{e\.taskId[^}]*\}\|\$\{e\.pid'` = 1 hit before (`:127`, the inline key) and nothing after. AC3 below is the behavioural half; AC2 as written can only witness the key's spelling.
- [x] Mutation control: restore the protocol checker's `taskId|pid` key and show case (a) goes red. Paste the output, then revert.
  - ```
    MUTATION: lockHoldKey returns `${taskId}|${pid}` (runId dropped) — the checker's old key
    $ node --test --test-name-pattern='AC\(a\)' plugin/test/fan-in-ff-protocol-check.test.mjs plugin/test/fan-in-queueing-model.test.mjs
    ✖ AC(a) two runs of the SAME task under the SAME pid pair into 2 intervals — NOT a double acquire
      AssertionError [ERR_ASSERTION]: a second holder under a recycled pid is NOT a double acquire
        actual: true
      expected: false
    ✖ AC(a) 同任务同 pid 的两个 run（不同 runId）配成 2 个区间——与协议检查器读同一份日志同解
      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
        actual:   [ [ 'wk-2', 150, 200 ] ]
        expected: [ [ 'wk-1', 100, 250 ], [ 'wk-2', 150, 200 ] ]
    ℹ tests 2   ℹ pass 0   ℹ fail 2
    ```
  - The mutated helper is the ONE shared definition, so the single mutation reds BOTH files — the evidence that the key is now shared rather than merely renamed.
  - Revert: `md5sum` of `plugin/scripts/fan-in-ff-protocol-check.ts` = `e867caf70027b3eb41713f04f0d073cc` before the mutation and identical after the revert; post-revert run is 50/50 pass (exit 0).

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-fan-in-lock-hold-pairing-two-divergent-keys` green.

## Touches
- tasks/gap-fan-in-lock-hold-pairing-two-divergent-keys.md
- plugin/scripts/fan-in-ff-protocol-check.ts
- plugin/scripts/fan-in-queueing-model.ts
- plugin/test/fan-in-ff-protocol-check.test.mjs
- plugin/test/fan-in-queueing-model.test.mjs
