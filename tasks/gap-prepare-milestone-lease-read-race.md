---
id: gap-prepare-milestone-lease-read-race
title: real Workflow-tool prepare-milestone dispatches intermittently hit ENOENT
  reading .quay/prepare-leases/<taskId>.json moments after Admission
  reported writing it -- observed twice across 2 of 3 real dispatches
  during DIR-126-D M203 telemetry evidence-gathering, non-reproducible
  via direct manual CLI sequencing
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: "true"
---
## Proposal

Investigate and fix (or confirm and document as an accepted environment limitation) a real,
observed race where a `prepare-milestone` dispatch's own subsequent agent call fails to read
`.quay/prepare-leases/<taskId>.json` with `ENOENT`, moments after the immediately-preceding
Admission agent call reported writing that exact file successfully.

## Finding

Observed twice across real `Workflow({scriptPath: '.claude/workflows/prepare-milestone.js'})`
dispatches during DIR-126-D's (M203) REFUTED-audit real-evidence-gathering work:

**Occurrence 1** (run `wf_49d73fc5-782`, against disposable fixture `FIXTURE-M203-TELEMETRY-PROOF`,
now deleted): Admission acquired the lease successfully; the immediately next agent call
(`--decide-resume`) failed with `{"decision":"cold","reason":"decision-exception","detail":"ENOENT:
no such file or directory, open '.quay/prepare-leases/FIXTURE-M203-TELEMETRY-PROOF.json'"}`; the
run's own terminal telemetry-write dispatch then ALSO failed with the same `ENOENT`, so this
generation produced zero telemetry evidence despite reaching a real terminal outcome
(`preflight-rejected`). Documented in `milestones/M203/telemetry-real-journal-proof.md`.

**Occurrence 2** (run `wf_7caf2523-9c0`, against disposable fixture `FIXTURE-M203-PREPARED-PROOF`,
now deleted — a DIFFERENT dispatch, hours later, same session): the SAME `--decide-resume` ENOENT
fired immediately after Admission again, PLUS two further `{"ok":false,"error":"lease-missing"}`
errors during the ProposalReview delta-round's own internal lease-renewal calls, PLUS the run's
final terminal telemetry-write dispatch failed with the identical
`ENOENT: no such file or directory, open '.quay/prepare-leases/FIXTURE-M203-PREPARED-PROOF.json'` —
meaning this generation's real `split-recommended` terminal ALSO produced zero telemetry evidence.

In BOTH occurrences, the run's own fail-closed handling worked correctly (never fabricated a
decision, correctly surfaced `ok:false`/`decision-exception` rather than crashing or silently
succeeding) — the defect (if it is one) is purely about evidentiary completeness, not correctness
under the observed failure.

**Manual reproduction attempt did NOT reproduce it**: running the exact same two CLI calls
(`prepare-admission-check.ts --acquire` then `proposal-convergence.ts --decide-resume`) in immediate
sequence from a plain shell, same relative paths, same workspace, succeeded cleanly both times
(documented in `milestones/M203/telemetry-real-journal-proof.md`). This suggests the race is
specific to the real `Workflow`-tool's own `agent()` dispatch environment — plausibly a timing gap
between when one agent's subprocess file write becomes durably visible on disk and when the very
next agent's subprocess (a SEPARATE process, per this repo's own sandboxed-workflow-dispatches-real-
subprocess architecture) reads it — rather than a defect in
`prepare-admission-check.ts`/`proposal-convergence.ts` themselves.

**Frequency**: 2 of 3 real dispatch attempts during this evidence-gathering session exhibited it (at
least once each); not universal (dispatch 2 of the same session did NOT exhibit it). Not
deterministically reproducible on demand.

## Requested action

1. Investigate the real `agent()` dispatch mechanism's process/filesystem visibility guarantees
   between consecutive agent calls within one `Workflow()` run — is there a synchronization gap
   between one subprocess's `fs.writeFileSync` and the next subprocess's read of the same path?
2. If a real root cause is found and fixable (e.g. a missing `fsync`, a caching layer, a race in the
   harness's own agent-dispatch sequencing), fix it.
3. If genuinely environmental/harness-level and not fixable from this repo's own code, add a
   documented, bounded retry (e.g. one immediate re-read on ENOENT for this specific lease-file path)
   in `prepare-admission-check.ts`'s/`proposal-convergence.ts`'s lease-read call sites, to make real
   dispatches resilient to this specific transient condition without masking a genuine missing-lease
   case (a real missing lease is a DIFFERENT, legitimate `missing-prior-record`/cold-path condition
   that must still be distinguishable from a transient read race).
4. At minimum, if unresolved, this finding should inform interpretation of any future "the telemetry
   write failed" real-dispatch evidence gap — do not assume a missing telemetry record always means
   the code path is broken; check for this signature (`ENOENT` reading `.quay/prepare-leases/
   <taskId>.json` immediately after a reported-successful Admission) first.

## Acceptance Criteria

- [x] A root cause is identified: not a harness-level environmental condition, but a genuine TOCTOU
  in `_readLease()`'s original `existsSync` + `readFileSync` pattern — the file can be renamed into
  place by a separate OS process (a preceding `agent()` dispatch's own subprocess) in the window
  between the `existsSync` check and the `readFileSync` call, or the read can simply land before the
  writer's `rename()` has completed. Real, not merely theoretical: matches the exact `ENOENT` shape
  observed in both real-dispatch occurrences documented above.
- [x] A real code fix landed: `_readLeaseFileWithRetry()` (bounded backoff, `[20, 40, 80]`ms, 4 total
  read attempts) added to `prepare-admission-check.ts`, and `_readLease()` now routes through it
  instead of the old TOCTOU `existsSync`+`readFileSync` pair. `proposal-convergence.ts`'s two raw
  `fs.readFileSync(_leasePath(...))` call sites (`_decideResumeCli`, `_writeLegacyGenerationRecord`)
  now reuse the same retry helper instead of duplicating ad hoc logic. A regression fixture
  reproducing the scenario was constructed: a detached child OS process writes-then-renames a lease
  file shortly after being spawned, racing the read — genuinely exercises cross-process ENOENT
  bridging, not a same-process timer.
- [x] Grounding evidence: the regression test spawns a real separate OS process (`spawn(..., {detached:
  true})`, unref'd) that performs the identical write-to-tmp + atomic-rename sequence a real
  `agent()` dispatch's subprocess would, and asserts `_readLeaseFileWithRetry` bridges the resulting
  race — directly modeling the `ENOENT` signature from both real-dispatch occurrences. A second test
  confirms the retry still fails closed (real `ENOENT`) for a genuinely-never-written lease, so the
  fix cannot mask an actual missing-lease/`missing-prior-record` cold-path case. All identifiers
  (`agent()`, `Workflow()`, `prepare-admission-check.ts`, `proposal-convergence.ts`,
  `missing-prior-record`) confirmed real and unchanged in the current tree.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` (commit `a578062` for the 4 source files;
  see Execution record below for the test-file follow-up commit).

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/prepare-admission-check.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs

## Execution record

Executed directly (mixed mode, 2026-07-31, per explicit user instruction), dispatched to a
worktree-isolated background subagent. Source fix (4 files) committed in `a578062` after verifying
byte-identity across both mirror pairs.

Independent fresh-subagent review (standing in for Audit) returned CONCERNS with two findings:
(a) the 4 source files were still uncommitted while `master` was being actively mutated by another
concurrent session — a real landing-integrity risk, remediated by the `a578062` commit above;
(b) the new race-condition regression test had a genuine ~3.6% flake rate (2 failures in 55 real
runs, confirmed by the reviewer), caused by racing the production's fixed ~140ms retry budget
against a detached child process's real OS scheduling+write latency under system load. Fixed by
restructuring the test to retry the whole scenario (fresh lease id + fresh child, up to 3 attempts)
on a genuine per-attempt ENOENT, rather than widening or weakening the production-budget assertion
itself — still exercises the real cross-process race and the real production retry budget on every
attempt. Verified stable across 8 consecutive full local runs (0 failures) after the fix; synced to
the `plugin/test/` mirror, byte-identity confirmed. Full suite: `prepare-admission-check.test.mjs`
78/78 both mirrors; `proposal-convergence.test.mjs` 97/97.

**Outcome:** done.
