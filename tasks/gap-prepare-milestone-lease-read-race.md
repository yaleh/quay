---
id: gap-prepare-milestone-lease-read-race
title: real Workflow-tool prepare-milestone dispatches intermittently hit ENOENT
  reading .quay/prepare-leases/<taskId>.json moments after Admission
  reported writing it -- observed twice across 2 of 3 real dispatches
  during DIR-126-D M203 telemetry evidence-gathering, non-reproducible
  via direct manual CLI sequencing
status: todo
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

- [ ] A root cause is identified (or the investigation concludes it is a harness-level environmental
  condition outside this repo's control, with the reasoning documented) — not left as an unexplained
  "flaky" label.
- [ ] Either a real code fix lands (with a regression fixture reproducing the scenario if
  practically constructible), or a documented, bounded retry-on-ENOENT is added to the relevant
  lease-read call sites, or an explicit accepted-risk note is added here explaining why neither is
  warranted.
- [ ] Grounding evidence (wiring-coverage completeness): the exact `prepare-milestone` dispatch
  reading `.quay/prepare-leases/<taskId>.json` and hitting `ENOENT` moments after Admission's own
  successful write is reproduced (or its non-reproducibility documented) as part of closing this
  gap. Also grounding the Requested-action identifiers: `agent()`, `Workflow()`,
  `fs.writeFileSync`, `prepare-admission-check.ts`, `proposal-convergence.ts`,
  `missing-prior-record` — all already-real names confirmed present in the current tree, not new
  invention.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`, OR closed as accepted-risk with documented reasoning (this is genuinely
  uncertain whether it is a fixable defect vs. an environmental limitation — the investigation itself
  is the primary deliverable).

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/prepare-admission-check.ts
- plugin/scripts/proposal-convergence.ts
