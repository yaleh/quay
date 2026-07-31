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

## Decisions (items 2 and 3 — explicit, not silent omission)

**Item 2 — epoch-file-deletion tampering: ACCEPTED RISK, same class as existing `.quay/` runtime
state.** No code change; no checksum/tamper-evidence field added.

Reasoning:
- This repo's own established, unchallenged precedent is that `.quay/` runtime state
  (`.quay/prepare-leases/*.json`, `.quay/prepare-checkpoints/*.json`, and now
  `.quay/prepare-epochs/*.json`) is gitignored, locally-writable, unauthenticated state with NO
  tamper-evidence protection of any kind. Direct deletion of a lease file bypasses the
  single-flight admission check exactly as directly as deleting the epoch file bypasses the budget
  circuit breaker — and that has never been treated as needing special protection for leases or
  checkpoints. Singling out the epoch file for a checksum would be an inconsistent, partial
  mitigation.
- The real DIR-126-D incident this whole mechanism exists to prevent (11 ordinary sequential
  redispatches over ~5h, `tasks/DIR-126.md`) was a human using the CLI's own front door, not an
  actor with shell/filesystem access deliberately tampering to bypass a circuit breaker. Anyone
  with enough access to `rm .quay/prepare-epochs/<taskId>.json` already has equal or greater access
  to call `--new-epoch --confirmUnchangedScope true --reason ... --owner ...` legitimately (the
  front door), or to edit the JSON file's own `counters`/`policy`/`resets`/`overrides` fields
  directly rather than deleting the whole file (which a checksum on the file's EXISTENCE, as
  opposed to a full-content signature nothing else in this repo does either, would not even catch).
  A tamper-evidence field on this one file raises the bar for the least-sophisticated tamper (a bare
  `rm`) while doing nothing for the more direct one (editing the file in place) — not a real
  security boundary, just complexity for a threat model this task's own Finding explicitly
  distinguishes from what it closes (concurrent-process races, not filesystem tampering).
- Conclusion: treat epoch-file deletion/tampering as an accepted, out-of-scope operator-level risk,
  matching the trust boundary already extended to every other piece of `.quay/` runtime state. This
  decision is now recorded explicitly (unlike the parent task, where it was a silent omission).

**Item 3 — no escape valve past the hard ceilings: INTENTIONAL terminal design, confirmed.** Real
code change: `_epochBreachExit`'s `allowedActions` (both `.claude/workflows/prepare-milestone.js`
and `plugin/workflows/prepare-milestone.js`) now OMITS `NEW-EPOCH`/`OVERRIDE` once their own
respective ceiling (`maxNewEpochResetCount`/`maxOverrideCount`) is already exhausted, via a new
`_epochEscapeValveActions()` helper computed from the SAME `_epochResets`/`_epochOverrides`/
`_epochPolicy` state already loaded at Admission. `COMMIT`/`SPLIT` are always listed (never
mechanically gated) — the genuine, always-available terminal paths.

Reasoning:
- `maxOverrideCount`/`maxNewEpochResetCount` default to 3 each — already generous for a rare,
  human-invoked mechanism (the real incident this closes was 11 attempts over ~5h; 3 resets/3
  overrides is not a tight ceiling relative to that).
- A "human-authorized override of the human-authorized override" mechanism (e.g. a
  `--force-new-epoch` requiring a higher-bar confirmation) would risk recreating the exact
  infinite-regress problem this circuit breaker exists to prevent — there is no principled place to
  stop adding escalation tiers once you start.
- Reproduced via this task's own regression coverage
  (`new-epoch-reset-count-cap-exceeded`/`override-count-cap-exceeded` in
  `proposal-convergence.test.mjs`, and the two new `item 3` tests in
  `prepare-milestone-convergence.test.mjs`) that `NEW-EPOCH`/`OVERRIDE` genuinely ARE mechanically-
  guaranteed dead ends once their ceiling is met — so the fix here is purely about
  `allowedActions`/error-text ACCURACY, not adding new capability. The `_newEpochCli`/
  `_overrideBudgetCli` ceiling-exceeded error text ("no further resets/overrides can be granted via
  this mechanism") was already accurate and is left unchanged.
- Conclusion: COMMIT/SPLIT are the correct, intentional terminal paths once a hard ceiling is
  reached — this is working as intended, not an oversight to fix with a new escalation mechanism.

## Acceptance Criteria

- [x] A real concurrent-invocation regression test (6+ genuinely concurrent processes) proves the
  hard ceiling (`maxOverrideCount` and separately `maxNewEpochResetCount`) is never exceeded, and
  that every `ok:true` response corresponds to a real, permanently-persisted entry in the epoch
  record — no silent last-writer-wins data loss. Evidence: two new 20-concurrent-child-process
  regression tests in `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
  ("REGRESSION (gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening): 20 genuinely
  concurrent --new-epoch/--override-budget child processes..."), both real `node:child_process`
  `spawn()` invocations (not in-process mocks). Confirmed the pre-fix race is real by temporarily
  reverting the lock (`git stash`) and re-running: the `--new-epoch` test failed with "expected at
  most 3 ... to succeed, got 5" (ceiling exceeded), matching the independent reviewer's own
  reproduction (4 ok:true against a cap of 3). Post-fix, both tests pass consistently across 4
  repeated full-suite runs plus 3 additional isolated re-runs (zero flakes observed).
- [x] The epoch-file-deletion risk has an explicit, recorded decision (accepted-risk with reasoning,
  or a real mitigation implemented) — not silently absent from this task's own AC/DoD the way it was
  from the parent task's. Evidence: see "## Decisions" item 2 above.
- [x] The "no escape valve past the hard ceilings" design question has an explicit, recorded
  decision, and `_epochBreachExit`'s `allowedActions`/error text accurately reflect whatever that
  decision is (never implying an escalation path that doesn't exist in code). Evidence: see
  "## Decisions" item 3 above; `_epochEscapeValveActions()` in both `prepare-milestone.js` mirrors;
  2 new regression tests per mirror (4 total) in `prepare-milestone-convergence.test.mjs`.
- [x] Existing epoch-budget regression suites (`proposal-convergence.test.mjs`,
  `prepare-milestone-convergence.test.mjs`, both mirrors) remain green. Evidence: 171/171 pass in
  `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`; 106/106 pass in
  `plugin/test/prepare-milestone-convergence.test.mjs`; 83/83 pass in both
  `prepare-admission-check.test.mjs` mirrors; 2/2 pass in
  `plugin/test/prepare-milestone-preparation-e2e.test.mjs`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on master, OR closed as an explicit accepted-risk decision with documented reasoning
  for whichever of items 1-3 above are judged not to warrant a code change. NOTE: item 1 (TOCTOU
  lock) and item 3 (allowedActions accuracy) are real, tested code changes on this task's own
  worktree branch (commit noted in the session report); item 2 is an accepted-risk decision only.
  Landing on master is NOT yet done — left for the orchestrating session's independent adversarial
  review, per this task's own convention (status intentionally left `todo`, not set to `done` by
  the implementing agent).

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
