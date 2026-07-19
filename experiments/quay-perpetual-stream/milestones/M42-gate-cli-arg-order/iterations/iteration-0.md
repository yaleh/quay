# M42-gate-cli-arg-order — iteration-0 (DIR-014 item 4 DOGFOOD: first live run of the wired pipeline)

**Class:** development (capability-growth, product CLI code) → routed through OUTER-LOOP
**step 5a** (the quay-task-to-plan pipeline wired by DIR-014 items 2/3). This milestone is the
FIRST customer of that pipeline — DIR-014 item 4's required real-milestone dogfood.

NOTE: the exp5 loop is paused (human-directed), so the pipeline's steps were invoked MANUALLY
(as step 5a mandates the loop do) — the dogfood proves the wired flow runs end-to-end and earns
its keep, independent of who pulls the trigger.

## Pipeline run (the item-4 evidence: N-independent-proposal → adjudication → grounded check)

1. **N-independent-proposal (N=2, blank-slate, no inter-agent comms).** Two independent
   subagents each drafted a proposal for the fix approach from the code alone.
   - Both CONVERGED: derive id flag-aware (not raw `sub`); `gate-log` no-id → usage error;
     don't touch `run` / `task view/edit/create`; add flag-before-id tests.
   - They DIVERGED on mechanism: (A) `const id = positional[0]` per branch; (B) a shared
     `resolveTaskId(sub, positional)` helper with a `sub` fallback.
2. **Adjudication (M13-style, grounded against real code — the diversity paid off).**
   Empirically verified (node repro + reading real `parseFlags`/argv destructure) that
   BOTH proposals were INSUFFICIENT: for a verb-less command `parseFlags(rest)` parses only
   `argv[4:]`, so a leading flag (`gate --gate dod ID`) leaves `--gate` in `sub`, unparsed —
   its value `dod` becomes `positional[0]` (misread as id) AND `flags.gate` is silently lost.
   Both A and B read that broken `positional`. **Correct approach = re-parse the full
   `[sub, ...rest]` (as `run` already does).** This is exactly the "expensive approach error
   caught before code is written" that step 5a's upstream diversity exists for — a single-
   proposal path would have shipped a regression (flags dropped; `dod` used as the id).
3. **Grounded plan-check.** Plan (`docs/plans/9-cli-arg-order-fix.md`) verified against the
   real `run`-command idiom and the 6 branches' flag usage before implementing.

## Implementation (TDD)
- RED: 3 new tests (2 in gate.test.mjs, 1 in lifecycle.test.mjs) fail on unfixed code.
- GREEN: added `parseVerbless(sub, rest)` helper; fixed all 6 branches + `if (!id)` usage
  guard each (closes `gate-log`'s prior silent-empty no-id case). `run` and `task *` untouched.
- Regression: **144/144 non-network suites pass** (the 2 failing suites — serve-github,
  provider-abi-conformance — fail identically on the unmodified baseline; both hit live
  github.com and are network-dependent, unrelated to this CLI change).

## AC status (all 5 met — ticked on the task)
See `tasks/exp5-M-GATE-CLI-ARG-ORDER.md` — every AC bullet checked with evidence.

## Outcome
DONE. This closes DIR-014 item 4 (dogfood) and item 5 (first customer) — DIR-014's full
program (items 1/2/3/4/5/6) is now delivered.
