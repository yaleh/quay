---
id: gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening
title: proposal-convergence.ts's --new-epoch/--override-budget CLI have a
  real TOCTOU race under concurrent invocation, plus an undocumented
  epoch-file-deletion bypass -- found by the round-3 adversarial review of
  gap-prepare-milestone-task-epoch-budget-reset, explicitly out of that
  task's own threat model (single-actor sequential redispatch), filed as a
  follow-up rather than blocking that task's land
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
---
## Proposal

Harden `_newEpochCli`/`_overrideBudgetCli` (`experiments/quay-perpetual-stream/scripts/
proposal-convergence.ts`, + `plugin/scripts/` mirror) against concurrent-invocation and
direct-filesystem-tampering bypasses of the epoch-cumulative budget circuit breaker
(`gap-prepare-milestone-task-epoch-budget-reset`), and explicitly decide (rather than leave
implicit) whether `maxOverrideCount`/`maxNewEpochResetCount` need a genuine human-authorized
escape valve once exhausted.

## Finding

Discovered 2026-07-31 by the round-3 independent adversarial review of
`gap-prepare-milestone-task-epoch-budget-reset` (explicitly briefed for maximal adversarial effort,
given that task's own track record of 2 real defects found in its first 2 review rounds). The
round-2 defect the review was checking (an unrate-limited `--new-epoch` reset) was independently
confirmed genuinely closed — verdict CONCERNS, not REFUTED, and the task was landed on that basis,
per the reviewer's own explicit recommendation. These 3 items are real but were assessed as a
DIFFERENT threat model than the one that task closes: the actual DIR-126-D incident this whole
mechanism exists to prevent was a single actor's ordinary SEQUENTIAL redispatch (11 attempts over
~5 hours), never a deliberate concurrent-process race or direct filesystem tampering.

**1. TOCTOU race (new, real, reproduced).** `_newEpochCli` and `_overrideBudgetCli` both follow a
read-existing-record → check-hard-ceiling → `_atomicWriteJson` sequence with NO inter-process lock
around the check-then-act window — unlike this codebase's own Admission lease
(`prepare-admission-check.ts`), which uses an exclusive `wx`-flag file for exactly this class of
race. The reviewer fired concurrent `--new-epoch --confirmUnchangedScope true` calls (6 and
separately 20 concurrent processes) against a fresh epoch with `maxNewEpochResetCount:3` and
consistently got **4** `ok:true` responses, not 3 — the hard ceiling this whole task's round-2/3
fixes rely on is provably exceeded by one real event during the race window. Worse: the final
on-disk record still shows only 3 resets (last-writer-wins on the JSON file silently drops one
caller's entry), meaning a caller that was told `ok:true` has its own reset silently vanish from the
audit trail — undermining the "remains visible to later capacity reports" property the parent
task's own AC requires.

**2. Epoch-file deletion bypass (real, undocumented).** `rm .quay/prepare-epochs/<taskId>.json`
followed by a fresh `--new-epoch` call: `_readEpochRecord` returns `exists:false`/`record:null`,
`_newEpochCli`'s entire ceiling/distinctness block is wrapped in `if (existing) {...}` and is
therefore skipped completely — a fresh record is created with `resets:[]` and `parentEpochId:null`
(lineage severed), a total bypass of the whole mechanism. Same threat class as tampering with any
other `.quay/` runtime state (leases, checkpoints), but — unlike those — this specific risk was
never mentioned as an accepted/out-of-scope risk anywhere across `gap-prepare-milestone-task-epoch-
budget-reset`'s 3 rounds of Proposal/Finding/AC/DoD.

**3. No escape valve past the hard ceilings (design question, not yet confirmed either way).**
Once `maxOverrideCount`/`maxNewEpochResetCount` is reached, `_epochBreachExit`'s own
`allowedActions` still lists `NEW-EPOCH`/`OVERRIDE`, but both will now always be mechanically
rejected — the only real paths forward are COMMIT/SPLIT. The error text for a ceiling breach says
"escalate to a human decision outside this CLI," but no such escalation mechanism exists in code.
Plausibly this is entirely intentional (the ceilings exist specifically to FORCE convergence to
COMMIT/SPLIT rather than allow indefinite further attempts) — but this was never explicitly
confirmed as the intended design versus an oversight, across 3 rounds of that task's own work.

## Requested action

1. Add an exclusive-lock (or equivalent atomic compare-and-swap) guard around `_newEpochCli`'s and
   `_overrideBudgetCli`'s read-check-write sequence, reusing `prepare-admission-check.ts`'s existing
   `wx`-flag lease-acquisition pattern rather than inventing a new locking primitive. Add a
   regression test firing genuinely concurrent CLI invocations (matching the reviewer's own
   6-and-20-process reproduction) and asserting the hard ceiling is never exceeded and no accepted
   reset/override silently vanishes from the audit trail.
2. Explicitly decide and document whether direct deletion/tampering of
   `.quay/prepare-epochs/<taskId>.json` is an accepted, out-of-scope operator-level risk (matching
   how this repo treats tampering with other gitignored `.quay/` runtime state), or whether it
   needs active protection (e.g. a checksum/tamper-evidence field, or treating a "missing epoch
   record where recent activity would be expected" as itself suspicious and requiring human
   confirmation before treating it as a fresh cold start). Record the decision explicitly, not
   implicitly by omission.
3. Explicitly decide and document whether reaching `maxOverrideCount`/`maxNewEpochResetCount` needs
   a genuine, distinctly-authorized ceiling-override escape valve (e.g. a `--force-new-epoch` mode
   requiring a SEPARATE, higher-bar human confirmation than an ordinary `--new-epoch` call), or
   whether "converge to COMMIT/SPLIT, no further resets, ever" is the correct terminal behavior by
   design. If the latter, update `_epochBreachExit`'s `allowedActions` list and/or error text to stop
   implying an escalation path that doesn't actually exist in code.

## Acceptance Criteria

- [ ] A real concurrent-invocation regression test (6+ genuinely concurrent processes) proves the
  hard ceiling (`maxOverrideCount` and separately `maxNewEpochResetCount`) is never exceeded, and
  that every `ok:true` response corresponds to a real, permanently-persisted entry in the epoch
  record — no silent last-writer-wins data loss.
- [ ] The epoch-file-deletion risk has an explicit, recorded decision (accepted-risk with reasoning,
  or a real mitigation implemented) — not silently absent from this task's own AC/DoD the way it was
  from the parent task's.
- [ ] The "no escape valve past the hard ceilings" design question has an explicit, recorded
  decision, and `_epochBreachExit`'s `allowedActions`/error text accurately reflect whatever that
  decision is (never implying an escalation path that doesn't exist in code).
- [ ] Existing epoch-budget regression suites (`proposal-convergence.test.mjs`,
  `prepare-milestone-convergence.test.mjs`, both mirrors) remain green.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on master, OR closed as an explicit accepted-risk decision with documented reasoning
  for whichever of items 1-3 above are judged not to warrant a code change.

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
