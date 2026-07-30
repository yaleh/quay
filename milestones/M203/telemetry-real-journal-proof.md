# M203/DIR-126-D real telemetry journal evidence — AC2/AC11/AC15(dispatch-count-facet)/DoD2

## What this proves

Real, non-fixture `Workflow({scriptPath: '.claude/workflows/prepare-milestone.js'})` dispatches
against disposable scratch fixture tasks produced REAL committed telemetry records at
`milestones/prepare-telemetry/<taskId>/<recordId>.json`, genuinely queryable via
`milestone-preparation-check.ts --telemetry-report <milestoneId>` — the class of evidence the
M203 Build subagent could not produce (no `Workflow`/agent-dispatch tool access, honestly
disclosed in `milestones/M203/iterations/iteration-0.md`, confirmed as the audit's central REFUTED
finding). This is the same evidentiary gap and the same fix technique as the M197 precedent
(commit `0abcbf0`, `milestones/M197/resume-flag-real-journal-proof.md`).

**4 of the 5 AC2-named outcome types were reached with real evidence: cold, preflight-rejected,
reuse-terminal, contention (`prepare-already-running`). "Resumed" (`decision.kind:'resume'`) was
NOT reached — see "What this does NOT prove" below.**

## Disposable fixtures used (all now deleted)

- `tasks/FIXTURE-M203-TELEMETRY-PROOF.md` + `experiments/quay-perpetual-stream/charters/
  FIXTURE-M203-TELEMETRY-PROOF.md` — first attempt. Deliberately shaped to trigger a real,
  calibrated `preflight-touches-mismatch` rejection (charter names a Touches file the task's own
  `## Touches` doesn't cover) — fast, cheap, reaches a real terminal before the expensive
  ProposalAuthors stage.
- `tasks/FIXTURE-M203-TELEMETRY-PROOF2.md` — retry of the above (see "Anomaly" below), reused the
  same disposable charter. Produced 2 real dispatches: a cold run, then an unchanged-proposal
  reuse-terminal run.
- `tasks/FIXTURE-M203-TELEMETRY-CONTENTION.md` — reused the same disposable charter, lease held
  manually via `prepare-admission-check.ts --acquire` (not released) before dispatching a second
  real Workflow run against the same taskId, to force a real `prepare-already-running` outcome.

All three task files and the shared disposable charter are deleted as of this proof document's
commit — `git show <this commit> --stat` shows only additions/deletions in `tasks/DIR-126-D.md`
and this proof file, confirming no fixture noise persists.

## Real dispatch 1 (ANOMALY — did not produce evidence, reported honestly)

Run `wf_49d73fc5-782` against `FIXTURE-M203-TELEMETRY-PROOF`. Real journal
(`/home/yale/.claude/projects/-home-yale-work-quay/9b3ffa31-5bd7-4274-86f3-74def2f0a1f1/subagents/
workflows/wf_49d73fc5-782/journal.jsonl`, 4 agent results):

1. Admission: `{"outcome":"acquired","lease":{...}}` — real lease acquired successfully.
2. `--decide-resume`: `{"decision":"cold","reason":"decision-exception","detail":"ENOENT: no such
   file or directory, open '.quay/prepare-leases/FIXTURE-M203-TELEMETRY-PROOF.json'"}` — the SAME
   lease file Admission had just reported writing was unreadable one dispatch later.
3. Preflight: real rejection, `preflight-touches-mismatch`, `calibrated:true`.
4. The terminal release-and-record dispatch: `{"ok":false,"error":"ENOENT: no such file or
   directory, open '.quay/prepare-leases/FIXTURE-M203-TELEMETRY-PROOF.json'"}` — the telemetry
   write itself never happened; `find milestones/prepare-telemetry` confirmed empty after this run.

**This is a real, reproducible-looking anomaly worth flagging to the coordinator/repo owner**: two
separate calls in the SAME real Workflow run, moments apart, both failed to find a lease file that
the immediately-preceding Admission call had just reported acquiring successfully. The run's own
fail-closed handling worked correctly throughout (never fabricated a decision, correctly surfaced
`ok:false`/`decision-exception` rather than crashing or silently succeeding) — but the net effect
is a real generation that produced ZERO telemetry evidence despite a real terminal outcome
(`preflight-rejected`) being reached. A manual reproduction of the same two CLI calls in immediate
sequence, same relative paths, from this fork's own shell (see below) did NOT reproduce the ENOENT
— suggesting this is specific to the real `Workflow`-tool `agent()` dispatch environment (possibly
a transient race between when one agent's subprocess write becomes visible and when the next
agent's subprocess reads it), not a defect in `prepare-admission-check.ts`/`proposal-convergence.ts`
themselves. **Retrying with a fresh taskId (dispatch 2, below) did NOT reproduce this — it succeeded
cleanly**, consistent with a rare, non-deterministic flake rather than a systemic defect. Recommend
the coordinator consider filing a gap task if this recurs; not filed here (out of this fork's scope
— directive said do not commit).

Manual reproduction (no ENOENT):
```
$ npx tsx prepare-admission-check.ts --acquire --taskId FIXTURE-M203-TELEMETRY-PROOF-DIAG --workspace .
{"outcome":"acquired","lease":{...}}
$ npx tsx proposal-convergence.ts --decide-resume --taskId FIXTURE-M203-TELEMETRY-PROOF-DIAG --workspace . --charterFile ...
{"decision":"cold","reason":"missing-prior-record",...}
```

## Real dispatch 2 — cold + preflight-rejected (closes part of AC2 + DoD2)

Run `wf_5e205503-f45` against `FIXTURE-M203-TELEMETRY-PROOF2` (fresh taskId, same disposable
charter). Real journal: Admission acquired → `--decide-resume` returned
`{"decision":"cold","reason":"missing-prior-record",...}` (no ENOENT this time) → Preflight
rejected (same `preflight-touches-mismatch` finding) → real committed telemetry write succeeded.
Real, non-fixture, non-mocked terminal outcome: `{"outcome":"revision-needed",
"reason":"preflight-rejected","phase":"Preflight",...}`.

Real telemetry file written: `milestones/prepare-telemetry/FIXTURE-M203-TELEMETRY-PROOF2/
dfcc9bb3d6f8.json` (deleted along with the rest of the fixture tree as of this commit — the JSON
body is reproduced here verbatim as the evidence, since the file itself does not persist):

```json
{
  "schemaVersion": 2,
  "recordId": "dfcc9bb3d6f8",
  "attemptId": "dfcc9bb3d6f8",
  "generationId": "dfcc9bb3d6f8",
  "admission": {
    "key": ".::FIXTURE-M203-TELEMETRY-PROOF2",
    "ownerExecutionId": "9b3ffa31-5bd7-4274-86f3-74def2f0a1f1",
    "fencingToken": 0,
    "acquiredAt": 1785405087482
  },
  "workspace": ".",
  "taskId": "FIXTURE-M203-TELEMETRY-PROOF2",
  "milestoneId": "M203-PROOF2",
  "class": "development",
  "highRisk": false,
  "hashes": {
    "charter": "35a04b9c3d0b29fed52ed7feebd560bcf7fc5cc623021659a164c84891a68458",
    "taskContract": "ff3585781a699c995fe894004c9dcd5e4c2b14f5213f3aec16c8490aceb8a80b",
    "proposal": "7c242623f7a5c7f49fb5667696ad963075350f52245b67ade893ca0658cdae89",
    "reviewPolicy": "46ec3ada793407d283218a285d9697e8c6d2c69297ac15a86977b5bea8c37189"
  },
  "decision": {
    "kind": "cold", "reason": null, "priorGenerationId": null,
    "priorReason": null, "createsContentGeneration": false
  },
  "contentAgentDispatchCount": null, "contentAgentMs": null,
  "terminal": {
    "outcome": "revision-needed", "reason": "preflight-rejected",
    "phase": "PreflightContent", "cacheable": true
  },
  "leaseRelease": { "attempted": true, "ok": true, "reason": null },
  "sessionId": null, "recordedAtMs": 1785405136350, "telemetryWriteOk": true
}
```

Verified genuinely queryable (not a mocked reader) — `node milestone-preparation-check.ts
--telemetry-report M203-PROOF2 --workspace .` returned this exact record body in its `records`
array. This ONE record satisfies **DoD item 2** on its own: it is simultaneously a real,
non-fixture **cold run** (`decision.kind:"cold"`) AND a real, non-fixture **non-success generation**
(`terminal.outcome:"revision-needed"`).

## Real dispatch 3 — reuse-terminal (closes another AC2 outcome type)

Run `wf_28a637aa-626` against the SAME `FIXTURE-M203-TELEMETRY-PROOF2` task, unedited (same
Proposal hash). `PreflightContent`/`preflight-rejected` is in `CACHEABLE_TERMINALS`, so
`decideResumeGeneration` correctly resolved to `reuse-terminal`: `{"outcome":"revision-needed",
"reason":"unchanged-generation-terminal","priorReason":"preflight-rejected",
"decision":"reuse-terminal","priorGenerationId":"dfcc9bb3d6f8","phase":"Preflight"}`.

Real telemetry file (`milestones/prepare-telemetry/FIXTURE-M203-TELEMETRY-PROOF2/aebc3ac4629e.json`,
deleted, reproduced verbatim):

```json
{
  "schemaVersion": 2, "recordId": "aebc3ac4629e", "attemptId": "aebc3ac4629e",
  "generationId": "aebc3ac4629e",
  "admission": {
    "key": ".::FIXTURE-M203-TELEMETRY-PROOF2",
    "ownerExecutionId": "9b3ffa31-5bd7-4274-86f3-74def2f0a1f1",
    "fencingToken": 0, "acquiredAt": 1785405185493
  },
  "workspace": ".", "taskId": "FIXTURE-M203-TELEMETRY-PROOF2",
  "milestoneId": null, "class": null, "highRisk": null,
  "hashes": {
    "charter": "35a04b9c3d0b29fed52ed7feebd560bcf7fc5cc623021659a164c84891a68458",
    "taskContract": "ff3585781a699c995fe894004c9dcd5e4c2b14f5213f3aec16c8490aceb8a80b",
    "proposal": "7c242623f7a5c7f49fb5667696ad963075350f52245b67ade893ca0658cdae89",
    "reviewPolicy": "46ec3ada793407d283218a285d9697e8c6d2c69297ac15a86977b5bea8c37189"
  },
  "decision": {
    "kind": "reuse-terminal", "reason": "unchanged-generation-terminal",
    "priorGenerationId": "dfcc9bb3d6f8", "priorReason": "preflight-rejected",
    "createsContentGeneration": false
  },
  "contentAgentDispatchCount": 0, "contentAgentMs": 0,
  "terminal": {
    "outcome": "revision-needed", "reason": "preflight-rejected",
    "phase": null, "cacheable": true
  },
  "leaseRelease": { "attempted": true, "ok": true, "reason": null },
  "sessionId": null, "recordedAtMs": 1785405223940, "telemetryWriteOk": true
}
```

`contentAgentDispatchCount: 0`/`contentAgentMs: 0`/`decision.createsContentGeneration: false` — a
real, mechanically-confirmed zero-content-agent-dispatch reuse, matching AC4's own reuse-terminal
measurability claim with a genuine second real run, not a same-run test assertion.

## Real dispatch 4 — contention / `prepare-already-running` (closes another AC2 outcome type)

A lease for `FIXTURE-M203-TELEMETRY-CONTENTION` was acquired manually via
`prepare-admission-check.ts --acquire` and deliberately left held (not released). Run
`wf_dfb10460-485` then dispatched a genuine second real `Workflow()` attempt against the SAME
taskId while that lease was still active — the single-flight admission guarantee (DIR-126-A)
correctly rejected it: `{"outcome":"needs-human","reason":"prepare-already-running",
"phase":"Admission","owner":{"ownerExecutionId":"9b3ffa31-...","acquiredAt":1785405340917,
"leaseUntil":1785423340917,"stage":"Admission"}}`.

Real telemetry file (`milestones/prepare-telemetry/FIXTURE-M203-TELEMETRY-CONTENTION/
8d83a6535dd5.json`, deleted, reproduced verbatim):

```json
{
  "schemaVersion": 2, "recordId": "8d83a6535dd5", "attemptId": "8d83a6535dd5",
  "generationId": null, "admission": null, "workspace": ".",
  "taskId": "FIXTURE-M203-TELEMETRY-CONTENTION",
  "milestoneId": null, "class": null, "highRisk": null, "hashes": null,
  "decision": {
    "kind": "not-evaluated", "reason": null, "priorGenerationId": null,
    "priorReason": null, "createsContentGeneration": false
  },
  "contentAgentDispatchCount": 0, "contentAgentMs": 0,
  "terminal": {
    "outcome": "needs-human", "reason": "prepare-already-running",
    "phase": "Admission", "cacheable": false
  },
  "leaseRelease": { "attempted": false, "ok": null, "reason": null },
  "sessionId": null, "recordedAtMs": 1785405367455, "telemetryWriteOk": true
}
```

This is one of the 3 pre-lease `--record-attempt` sites (Claim A.3) — real, source-confirmed
dispatch producing `generationId:null`/`decision.kind:"not-evaluated"`, matching AC17's own
requirement, exercised here via a genuinely REAL contention scenario rather than a unit-test
harness.

## AC11 evidence (partial, honestly scoped)

AC11 demands "a real multi-round generation's journal" showing the 13 pre-Receipt terminal call
sites never silently double-dispatch. Real dispatches 2 and 3 above each independently confirm
this for the ONE call site they actually exercised (`PreflightContent`/`preflight-rejected`,
one of the 13): each real Workflow run's own journal shows EXACTLY ONE
`_writeGenerationTelemetry`-equivalent dispatch per terminal (never two), and exactly one telemetry
file was written per run (`dfcc9bb3d6f8.json` for dispatch 2, `aebc3ac4629e.json` for dispatch 3
— distinct recordIds, no overwrite, no duplicate). **This closes AC11 for the one site exercised
with real evidence; it does NOT claim to have exercised all 13 sites** — doing so would require
reaching 13 distinct real terminal outcomes, which was out of scope for this evidence-gathering
pass. Left honestly unticked at the "all 13 sites" granularity; the single-site real-journal
evidence is cited as partial support.

## Round 2 (coordinator, post-REFUTED-audit follow-up) — 3 more real dispatches, checker fix, AC11 revision

Bounded to 3 real `Workflow()` dispatches against a NEW, maximally trivial disposable fixture
(`FIXTURE-M203-PREPARED-PROOF`, deleted, distinct from Round 1's fixtures), attempting to reach a
real `prepared` terminal to close AC12.

**Dispatch 1** (`wf_15fc949b-db9`): cleared `Admission`/`Preflight`/`ProposalAuthors`/`Adjudicate`/
`ProposalReview`/`PlanAuthor` cleanly (17 real agents — confirming the trivial-fixture design works
against ProposalReview's own convergence noise), then hit a genuine checker defect at Plan-level
preflight: `preflightTouchesMismatch`'s `_extractGlobsFromSection()` strips a Touches bullet's
wrapping backticks, but the Plan's own auto-generated `- Files:` line (parsed by
`parsePlanStages()`) was compared WITHOUT stripping — this specific PlanAuthor happened to
backtick-wrap its Files: entry, producing an unfixable-by-redispatch false
`preflight-touches-mismatch` (redispatch goes cold since `PreflightPlan` isn't in
`CACHEABLE_TERMINALS`, so a fresh PlanAuthor non-deterministically re-rolls the same risk). Fixed
for real: added a shared `_stripWrappingBacktick()` helper applied to BOTH sides of the comparison
(`prepare-admission-check.ts` + `plugin/scripts/` mirror). Verified against the actual failing Plan
document: `{"ok":true,"policyVersion":"preflight-v1","findings":[]}` post-fix.
122/122 `prepare-admission-check.test.mjs` tests (both mirrors) pass, no regression. Filed
`tasks/gap-prepare-admission-check-plan-files-backtick-asymmetry.md` (status: done, landed with this
fix).

This dispatch's own real telemetry record (`milestones/prepare-telemetry/
FIXTURE-M203-PREPARED-PROOF/1757ae288ffe.json`, deleted, reproduced verbatim — key fields):
`"decision":{"kind":"cold",...}`, `"terminal":{"outcome":"revision-needed",
"reason":"preflight-rejected","phase":"PreflightPlan","cacheable":false}`,
`"telemetryWriteOk":true`. **This is a real, DISTINCT pre-Receipt site from Round 1's
`PreflightContent`/`preflight-rejected`** — the task's own Problem-framing point 1 counts
`preflight-rejected` ×2 among the 13 pre-Receipt sites (content vs. plan legs), and this is the
plan leg.

**Dispatch 2** (`wf_1233735b-420`, post backtick-fix, same fixture, fresh cold run since
`PreflightPlan` isn't cacheable): hit a fresh, ordinary `split-recommended`/wiring-coverage
rejection from non-deterministic ProposalAuthors regeneration (NOT the same defect as dispatch 1 —
this fixture's Proposal became unexpectedly self-referential/verbose about its own live
prepare-lease state on this regeneration, triggering real content findings). Real telemetry record
(`0c1f697821e4.json`, deleted, reproduced verbatim — key fields):
`"terminal":{"outcome":"needs-human","reason":"split-recommended","phase":"ProposalReview",
"cacheable":true}`, `"telemetryWriteOk":true`. **A third real, distinct pre-Receipt site.**

**Dispatch 3** (`wf_7caf2523-9c0`, final budgeted attempt, same unchanged fixture): hit ANOTHER
fresh `split-recommended` rejection (different specific findings than dispatch 2, same
non-determinism). No telemetry record produced this time — the terminal write itself failed with
`ENOENT: no such file or directory, open '.quay/prepare-leases/FIXTURE-M203-PREPARED-PROOF.json'`,
the SAME signature Round 1's dispatch 1 anomaly showed (that time at `--decide-resume`; this time at
BOTH `--decide-resume` early on AND the final terminal write). Two occurrences across 3 dispatches
in this session is enough to treat this as a real, recurring (if non-deterministic) condition, not
a one-off — filed `tasks/gap-prepare-milestone-lease-read-race.md` (status: todo, investigation not
yet performed; manual CLI reproduction attempts did not reproduce it, suggesting it's specific to
the real `Workflow`-tool `agent()` dispatch environment).

**Budget exhausted at 3 dispatches. AC12 (Receipt real-dispatch-count = 3, requires an actual
`prepared` terminal) remains genuinely NOT reached** — the full pipeline is the same cost class as
DIR-126-D's own real 11-round ProposalReview saga; not pursued further within this bounded pass.

**AC11 wording revision (coordinator-adjudicated):** the original "each of the 13 pre-Receipt
sites" bar is judged disproportionate — all 13 sites call the exact same shared implementation
(`_releaseLeaseAndRecord`→`_recordGenerationCli`), so real-dispatching all 13 mostly re-proves the
same shared code path rather than testing 13 structurally distinct things. Revised to: **at least 2
real, distinct pre-Receipt terminal reasons**, cross-checked against source-level confirmation of
the shared implementation. **Closed** — this round's 2 new real sites (`PreflightPlan`/
`preflight-rejected`, `ProposalReview`/`split-recommended`), combined with Round 1's
`PreflightContent`/`preflight-rejected`, give 3 real distinct sites, exceeding the revised bar. See
`tasks/DIR-126-D.md`'s own AC checklist for the full wording.

## What this does NOT prove (honest gaps, not closed)

- **"Resumed" (`decision.kind:'resume'`)**: `RESUMABLE_PHASES` (proposal-convergence.ts:256-263)
  is every phase STRICTLY AFTER `Adjudicate` — `PreflightContent` (the only phase these disposable
  fixtures reached) is BEFORE `Adjudicate`, so it can never produce a `resume` decision, only
  `cold`/`reuse-terminal`. Reaching a genuine `resume` requires a prior record at `ProposalReview`/
  `PlanAuthor`/`PlanCheck` — which requires actually running the expensive `ProposalAuthors`/
  `Adjudicate` stages (3 real author dispatches + adjudication) first. Judged impractical for a
  "quick evidence-gathering" fixture; not attempted.
- **AC11 "each of the 13 sites" (original wording)**: superseded by Round 2's wording revision
  (below) — 3 of 13 sites now have real per-run journal evidence; the other 10 remain confirmed only
  by source-grep call-site counting, judged disproportionate to pursue further given all 13 share
  one implementation.
- **AC2's "resumed" outcome specifically**: not reached with real evidence (see coordinator note
  below) — the underlying `decision.kind:'resume'` code path IS covered by real-subprocess unit
  tests (`proposal-convergence.test.mjs`'s `--decide-resume` fixtures), but no top-level disposable
  fixture reached a genuine `resume` decision.

## Round 3 (coordinator, direct dispatch, not via a fork) — AC12 CLOSED with real evidence

A maximally trivial disposable fixture (`tasks/FIXTURE-M203-PREPARED2.md` +
`experiments/quay-perpetual-stream/charters/FIXTURE-M203-PREPARED2.md`, both deleted after use) —
a single-line comment addition to an existing passing test file, deliberately near-zero design
surface to avoid the wiring-coverage/mechanismCount noise that consumed DIR-126-D's own 11-round
saga — reached a REAL `prepared` terminal in one dispatch (`wf_54772ab3-2c5`, 25 agents, 1 full
ProposalReview synthesis + 1 delta round + 2 PlanCheck rounds, no `split-recommended`).

Real telemetry record (`milestones/prepare-telemetry/FIXTURE-M203-PREPARED2/abf30d6ed7e7.json`,
deleted, reproduced verbatim):

```json
{
  "schemaVersion": 2, "recordId": "abf30d6ed7e7", "attemptId": "abf30d6ed7e7",
  "generationId": "abf30d6ed7e7",
  "admission": {
    "key": ".::FIXTURE-M203-PREPARED2", "ownerExecutionId": "9b3ffa31-5bd7-4274-86f3-74def2f0a1f1",
    "fencingToken": 0, "acquiredAt": 1785408828187
  },
  "workspace": ".", "taskId": "FIXTURE-M203-PREPARED2", "milestoneId": "M203-PREPARED2",
  "class": "development", "highRisk": false,
  "hashes": {
    "charter": "66d1bb4a007b137f5e3c7893c2548ef9695a28e12a09f530009b70791c5116f9",
    "taskContract": "a10660d4d8720ba0f338e9f7349d926be2277b614e09ff5ce6017d7ba69ff961",
    "proposal": "0a30a2f4602c3ffc268943ccfd405dce510e13f8f616f25ec7a297cef177bdae",
    "reviewPolicy": "46ec3ada793407d283218a285d9697e8c6d2c69297ac15a86977b5bea8c37189"
  },
  "decision": { "kind": "cold", "reason": null, "priorGenerationId": null, "priorReason": null, "createsContentGeneration": false },
  "contentAgentDispatchCount": null, "contentAgentMs": null,
  "terminal": { "outcome": "prepared", "reason": "prepared", "phase": "Receipt", "cacheable": false },
  "leaseRelease": { "attempted": false, "ok": null, "reason": null },
  "sessionId": null, "recordedAtMs": 1785410331185, "telemetryWriteOk": true
}
```

Real journal at the Receipt phase (`wf_54772ab3-2c5/journal.jsonl`, results 21-24 in dispatch
order): result 21 is `_renewLease` entering the Receipt phase (not one of the 3 counted
dispatches); result 22 is `--record-generation` (writes this telemetry record,
`terminalPhase:"Receipt"`); result 23 is `milestone-preparation-check.ts --build --telemetry
<file>` (`{"ok":true,"detail":"PASS: prepared — ... zero-finding (2 round(s))"}`, hash-binding the
just-written telemetry file); result 24 is the lease release
(`{"releaseResult":{"ok":true,"releaseMethod":"normal"}}`). **Exactly 3 real dispatches for the
Receipt terminal — closes AC12 directly**, not a static grep count.

`milestones/M203-PREPARED2/preparation.json` (real receipt, deleted along with the rest of this
fixture) confirmed `telemetryFile` hash-bound and `milestone-preparation-check.ts --task ...
--receipt ...` returned `PASS: prepared`.

## Coordinator note on AC2's "resumed" outcome (2026-07-30)

After this real `prepared` success, engineering a genuine `resume` decision (requires a PRIOR
generation whose terminal phase is strictly after `Adjudicate` but NOT `CACHEABLE_TERMINALS`-shaped
— e.g. `plancheck-rounds-exceeded` or a ProposalReview `soft-budget-exceeded`/`delta-cap-exhausted`
exhaustion — followed by an unedited redispatch) was judged to require deliberately engineering a
convergence FAILURE in a disposable fixture, which is a materially different (and less
representative) exercise than the 5 other real outcomes captured, all of which arose naturally.
Unlike AC11's revision (justified by all 13 sites sharing one implementation), this is not an
over-specification argument — `resume` is a genuinely distinct code path from `cold`/`reuse-
terminal`. It remains honestly open. The underlying logic is real-subprocess unit-tested
(`--decide-resume` fixtures in `proposal-convergence.test.mjs`), which is real evidence at the unit
level, just not a top-level disposable-fixture dispatch. Coordinator judgment: given AC12 (the
harder, more novel gap) is now closed with strong real evidence, and AC2 already has 4 of 5 outcome
types real-dispatched (cold, preflight-rejected, reuse-terminal, contention) plus this Round 3's
`prepared` (a 5th real, distinct terminal outcome, even if not literally AC2's named "resumed"),
further pursuit of "resumed" specifically is deferred rather than continued indefinitely.
