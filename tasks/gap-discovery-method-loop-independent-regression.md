---
id: gap-discovery-method-loop-independent-regression
title: "Discovery Method: independent regression — no-shared-ancestry
  generalization, failing method not promoted, persistence, auto-ingest, real
  cost"
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-experience-auto-ingest-from-evidence-store
---
## Proposal
This is the independent regression run for the Discovery Method loop after the four fix tasks (lineage/temporal, tool-vs-subject, persistence, auto-ingest). It must show, with real data and real cost:
- a cross-case generalization with NO shared ancestry;
- a failing method NOT being promoted;
- production persistence;
- automatic ingestion.

It writes no new engine. Its only tracked deliverable is a report regenerated from the real run.

**Held-out material that shares no ancestry with any seed.** The 6 sealed holdout cases of experiment `E-DT-1`, at `/data/home/yale/work/quay-scratch/dt1/labels-dt1-sealed.json`:
- pin `f2432d17849e7bd375dbfa573ae55ea4efad171d`;
- built by an independent labeler who excluded every seed component pair;
- each positive has a recorded fix commit after the pin.

They are:
- `HX-reflog-empty-action-producer-vs-classifier` (fix `be229861e`)
- `HX-promotion-classify-blind-to-unsatisfiable-ac` (`ccd8cc039`)
- `HX-scope-memorymax-literal-vs-host-derived` (`0834014db`)
- `HX-scope-argv-builders-oompolicy-divergence` (`c5ad1d146`)
- `HX-needs-human-transition-three-copies` (`9b01ac3d2`)
- negative `HX-neg-cpu-stall-readers-different-source`

None of them is in the Experience ledger. They enter only as held-out cases with `evaluation_pin` = the pin and `fix_commit` from the label.

## Plan
1. Ingest automatically from the real evidence store via `ingestNewOutcomes` (persistent carriers).
2. Run ONE bounded `reflect()` round over the resulting Experiences, with a stated budget. The seeds include the fan-in lock, REQUIRED_FIELDS and C5 outcomes; C7 is a negative.
3. Run `validateGeneralization` for every non-retired candidate whose `expected_invariant` is in scope:
   - against at least 2 positive held-out cases and the negative case above;
   - each at its pin, in a stripped tree.
4. Report and persist all verdicts. A candidate is promoted only on a correct verdict that passes the lineage and temporal checks; a wrong one is retired with a reason.
5. Cost: report BOTH the CLI's `cost_usd` and the cost recomputed from recorded token usage × the gateway's configured rates. Query `GET http://127.0.0.1:26510/model_group/info` with the key from `~/.local/etc/fjdac-api-key` (Bearer) for `input_cost_per_token`/`output_cost_per_token`. The CLI figure for these model aliases is a fallback guess (`costBasis` "unknown"), not a charge.
6. Write `docs/analysis/discovery-method-regression-report.md` from the run artifacts.

## Acceptance Criteria
- [x] Automatic ingestion, real: paste the ingest summary (scanned / ingested / duplicate / watermark) and the persisted path under `/data/home/yale/work/quay/.quay/`.
- [x] Reflection, real: paste each unit's `decision` and the candidate `method_id`/version/status/`operation.tools`. No tool may be a seed subject file. C7's unit must not yield a standalone method.
- [x] Independent generalization, real: for at least one candidate, a held-out verdict on an `E-DT-1` holdout case at pin `f2432d178`. Paste the candidate lineage, the held-out id, the evaluated commit, the predicted vs expected verdict, and promoted yes/no. Plus at least one verdict against `HX-neg-cpu-stall-readers-different-source`. If no candidate is in scope for any holdout, say so and report `learning_quality` as not-evaluated. Do not relabel a holdout to fit.
- [x] Failing method not promoted, real: paste at least one candidate whose held-out verdict was wrong, with the resulting `retired` + reason (or `draft` if not-evaluated), and confirm it is absent from `activeMethods()`.
- [x] Quarantine holds: `activeMethods()` does not contain `shared-contract-divergence` at any version promoted on the old evidence. Paste it.
- [x] Cost: paste model calls, tokens (input/output/cache_read), wall ms, the CLI `cost_usd`, and the gateway-rate recomputation with the rates used.
- [x] `learning_quality` from the valid held-out verdicts only, and `net_new_discovery_value` still `not-yet-measured`.

## Definition of Done
- All AC ticked with output pasted.
- `docs/analysis/discovery-method-regression-report.md` committed.
- `scripts/test.sh --for-task gap-discovery-method-loop-independent-regression` green.

## Touches
- tasks/gap-discovery-method-loop-independent-regression.md
- docs/analysis/discovery-method-regression-report.md (new)

## Evidence

The run happened on 2026-10-12 in the task worktree
`/data/home/yale/work/quay-worktrees/gap-discovery-method-loop-independent-regression` (fork point
`676e15c6c` = `develop`), driving `claude-fjdac` → gateway `http://127.0.0.1:26510/`, model
`v4.1flash-anthropic`. **All Discovery carriers resolve to the SHARED checkout** — `ls <worktree>/.quay/discovery-*`
is empty; the ledger/registry/verdicts/watermark are under `/data/home/yale/work/quay/.quay/`.
The full paste-by-paste record is the committed report
`docs/analysis/discovery-method-regression-report.md`; the load-bearing readings are repeated here.

### AC1 — automatic ingestion (from inside the worktree; carriers land in the shared checkout)

```
watermark on disk before: {"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}
RUN 1 (incremental):  {"ok":true,"enabled":true,
  "store":"/data/home/yale/work/quay/.quay/architecture-evidence-store.jsonl",
  "watermark_file":"/data/home/yale/work/quay/.quay/discovery-ingest-watermark.json",
  "scanned":0,"ingested":0,"duplicates":0,"skipped_not_ingestible":0,"malformed_lines":0,
  "remainder":0,"advanced_to":270,"watermark":{"line":270,"line_sha256":"7549bc6e…"}}
RUN 2 (idempotence):  {"ok":true,"scanned":0,"ingested":0,"duplicates":0,"advanced_to":270,"watermark":{"line":270,…}}
CONTROL (watermark moved aside — the 0 must not be a dead mechanism):
  {"ok":true,"scanned":121,"ingested":0,"duplicates":116,"skipped_not_ingestible":5,
   "advanced_to":270,"watermark":{"line":270,"line_sha256":"7549bc6e…"}}
  watermark rewritten == backup: true ; ledger md5 c604e7f366fc2fbf5b70f28e540c4a27 both sides → byte-identical
KILL SWITCH enabled:false → {"store":null,"watermark_file":null,"scanned":0,"ingested":0}; ledger unchanged: true
persisted path: /data/home/yale/work/quay/.quay/discovery-experience-ledger.jsonl  (118 records, 94 369 bytes)
```

The 0-new reading is a **real** 0: the control re-scans all 121 outcome records, re-derives 116 duplicates
and passes 5 non-ingestible ownership-loop verdicts, rewriting the identical watermark and leaving the ledger
byte-identical.

### AC2 — reflection (budget `{enabled:true, maxPerRun:32/24, maxModelCalls:32/24, maxWallMs:1_800_000}`; two bounded batches, 40 units, 0 budget-skips)

Tally: **24 `no-method`, 11 candidates persisted, 5 refusals.** Candidate set (`method_id` / ver / status /
`operation.tools`):

```
carrier-persistence-check                v2 draft [repo-root-derivation-check.ts, repo-root.ts, runtime-usage-inventory.ts]
carrier-persistence-check                v3 draft [repo-root-derivation-check.ts, git-runner.ts, worktree-namespace-literal-check.ts]
non-substantive-verdict-triage           v1 draft [readRecords, instrument-failure-check.ts]
non-substantive-verdict-triage           v2..v8 draft (one `extends` per unit; tools all non-subject)
composite-subject-verdict-decomposition  v1 draft [readRecords, subjectFilesOf, read-probe-spec.ts]
```

Per-unit decisions are tabulated in the report (both batches). **C7's unit `EXP-ee63601cc7031e95` →
`no-method`, `candidate:null`** — no standalone method from a refuted claim. The fan-in lock and
REQUIRED_FIELDS seeds also returned `no-method`; C5 returned `new` and was then refused.

**No tool is a seed subject file** — checked by position, not by eye, for all 11 candidates:
`seedSetForRecord(candidate)` over the ledger ∩ `operation.tools` = `[]` for every one
(`subject_tools_present: []`, `stripped_subject_tools: []`, 11/11 clean). The other half fired too: five
candidates were **refused** `METHOD_TEXT_NAMES_SEED` for naming a seed component or a seed case id, e.g.
C5's candidate named `checker-io.ts`, `checker-mechanical-spine-check.ts`, `driver-result.ts`,
`outer-anchor-check.ts`, and another named `plugin/scripts/cap-from-gate.ts`. Nothing was appended for them.

### AC3 — independent generalization at the pin, in a stripped tree

```
materializeStrippedPin → {"ok":true,"stripped":true,"removed":["tasks","goals","docs","orchestration",".quay","archive",
                          "milestones","measurements","experiments","meta","adr"]}
verifyStrippedPin(pinDir) → null ; 384 files under plugin/scripts/ ; all 10 holdout subject files present
fix_commit ancestry: be229861e/ccd8cc039/0834014db/c5ad1d146/9b01ac3d2 → ancestor-of-f2432d178? NO (all five)
```

```
V1  non-substantive-verdict-triage@8 × HX-needs-human-transition-three-copies  (label holdout-F, expected ["supported"])
    lineage (all recorded versions): non-substantive-verdict-triage@1,2,3,4,5,6,7,8   provenance ["experience-7f65eb76070d8765"]
    seed subjects: full-suite-runner.ts, mirror-full-suite-state.ts, red-window-triage.ts, runner-state-write.ts, slot-refill.ts, suite-state-trigger.ts
    held-out components: plugin/scripts/worker-driver.ts, plugin/scripts/driver-filters.ts   shared with seed: []
    lineage isolation {"ok":true,"hits":[]}   lineage_ok true   temporal_ok true
    evaluated commit f2432d17849e7bd375dbfa573ae55ea4efad171d   verifier cwd …/pin-f2432d178
    predicted "refuted" vs expected ["supported"] → correct false → promoted NO → status retired
    retirement_reason: failed-generalization-on-HX-needs-human-transition-three-copies: predicted-refuted-but-role-found-and-fixed-requires-supported
    verdict_ref generalization_verdict-da8d59c3e7af4740

V2  composite-subject-verdict-decomposition@1 × HX-scope-memorymax-literal-vs-host-derived (holdout-H)
    lineage: composite-subject-verdict-decomposition@1 ; held-out components: driver-runtime.ts, full-suite-runner.ts
    shared with seed: ["plugin/scripts/full-suite-runner.ts"]  (1 < 2 → isolation HOLDS)  lineage_ok true  temporal_ok true
    predicted "refuted" vs ["supported"] → correct false → promoted NO → retired
    retirement_reason: failed-generalization-on-HX-scope-memorymax-literal-vs-host-derived: predicted-refuted-but-role-found-and-fixed-requires-supported

V3  carrier-persistence-check@3 × HX-reflog-empty-action-producer-vs-classifier (holdout-H)
    lineage: carrier-persistence-check@1,2,3 ; held-out: integration-batch-merge.ts, direct-to-develop-bypass-check.ts ; shared: []
    outcome not-evaluated   not_evaluated_reason "UNPARSEABLE_MODEL_OUTPUT"   stream result subtype "error_max_turns" (15 turns)
    → status stays draft, promoted NO

V4  non-substantive-verdict-triage@8 × HX-neg-cpu-stall-readers-different-source (holdout-negative, expected ["refuted"])
    held-out: suite-load-sampler.ts, cap-from-gate.ts ; lineage isolation {"ok":true} ; temporal_ok null (no fix_commit on a non-positive case)
    predicted "supported" vs ["refuted"] → correct false → promoted NO
    retirement_reason: failed-generalization-on-HX-neg-cpu-stall-readers-different-source: predicted-supported-but-role-confirmed-negative-requires-refuted
```

No holdout was relabelled: roles come straight from the SEALED file (`holdout-H`/`holdout-F` →
`found-and-fixed`, `holdout-negative` → `confirmed-negative`); the `diagnostic-public:*` cases were excluded
because that file says they are not blind. Scope is stated rather than assumed: the round's candidates are
methods about the discovery pipeline's own bookkeeping, not about the E-DT-1 architecture cases — reported
as a finding, not hidden.

### AC4 — failing method not promoted

```
non-substantive-verdict-triage           v9 retired  failed-generalization-on-HX-needs-human-transition-three-copies: predicted-refuted-but-role-found-and-fixed-requires-supported
composite-subject-verdict-decomposition  v2 retired  failed-generalization-on-HX-scope-memorymax-literal-vs-host-derived: predicted-refuted-but-role-found-and-fixed-requires-supported
carrier-persistence-check                v3 draft    (not-evaluated — turn-budget exhaustion)
append results: {"ok":true,"appended":true,"id":"method-a073630f32ddbd58"} / {"ok":true,"appended":true,"id":"method-41ce41e4cdfd93f2"}
bare-promotion control (status:"active", no cited verdict) →
  {"ok":false,"appended":false,"reasons":["PROMOTION_WITHOUT_VALID_GENERALIZATION:EVIDENCE_MISSING:status=active-must-carry-generalization_evidence.verdict_ref-naming-a-recorded-validateGeneralization-verdict"]}
activeMethods() → {"ok":true,"evaluated":4,"methods":[]}     (none of the above is active)
```

### AC5 — quarantine

```
activeMethods(root) → {"ok":true,"evaluated":4,"methods":[],"file":"/data/home/yale/work/quay/.quay/discovery-method-registry.jsonl",
                       "contains_shared_contract_divergence":false}
shared-contract-divergence v1 = draft (superseded) ; v2 = retired:
  "promoted on INVALID evidence (verdict generalization_verdict-9015f19c07ec161c): LINEAGE LEAK — the held-out case was the v1 seed
   (the same evidence-store record the method was fitted on), and TEMPORAL MISMATCH — the verifier read post-fix code while the
   case's label is pre-fix. Retired; it must not be re-promoted on this evidence."
re-promotion citing that old verdict → {"ok":false,"appended":false,"reasons":[
  "PROMOTION_WITHOUT_VALID_GENERALIZATION:VERDICT_NOT_PASSED:generalization_verdict-9015f19c07ec161c-recorded-outcome=not-evaluated-correct=null-refusal_code=HELD_OUT_SHARES_LINEAGE-lineage_ok=false-temporal_ok=false"]}
```

### AC6 — cost

```
gateway rates (GET http://127.0.0.1:26510/model_group/info, Bearer key from ~/.local/etc/fjdac-api-key):
  v4.1flash-anthropic → providers ["deepseek"], input_cost_per_token 3e-07, output_cost_per_token 1.2e-06

arm                              calls  input      output    cache_read  wall_ms   CLI cost_usd  gateway recompute  ratio
reflect batch 1                   24    554 433     32 405          0     246 657      3.582290          0.205216     17.5x
reflect batch 2                   16    378 066     30 929          0     220 249      2.663555          0.150535     17.7x
validateGeneralization             4    258 739     74 545  2 450 048     511 249      4.382344          0.902090      4.9x
FINAL RUN TOTAL                   44  1 191 238    137 879  2 450 048     978 155     10.628189          1.257841      8.5x
recompute = (input + cache_read + cache_creation) * 3e-07 + output * 1.2e-06 = 1.257841
narrow control (input only, cache tokens excluded)                          = 0.522826
exploration (batch scoping, NOT part of the final run): 20 calls, 462 404 in / 31 580 out, 227 074 ms,
  CLI 3.101520, gateway 0.176617
```

**Measured correction to the Plan's premise**: on claude 2.1.296 the stream `result` event carries **no
`costBasis` key at all**; it carries `total_cost_usd` and a `modelUsage` block whose `costUSD` is that same
figure. The CLI's figure is nonetheless a fallback guess — it overstates the gateway's own published rates
by 8.5× over the run.

### AC7 — metrics

```
learningQuality(valid held-out verdicts only) = {"value":0,"evaluated":3,"correct":0,"not_evaluated":1}
NET_NEW_DISCOVERY_VALUE = "not-yet-measured"
```

### What the run found (headline, in full in the report)

The four fixes each hold and are exercised on real data. But the loop no longer learns about the code it
inspects: the auto-ingest fix replaced hand narration with a content-free **projection**, so 24/40 units
answer `no-method` (three of the four Plan seeds among them) and the 11 candidates that do appear are
methods about the discovery pipeline's own bookkeeping, not about the E-DT-1 architecture — which is why all
three evaluated verdicts are wrong. Also recorded: the model is **nondeterministic** across repeats on the
same prompt+registry (C5 and REQUIRED_FIELDS flipped between passes), the generalization gate has **no
applicability gate** (symmetric risk, not observed here), and a turn-budget exhaustion is reported as
`UNPARSEABLE_MODEL_OUTPUT` although the stream carries `subtype:"error_max_turns"`.

### DoD

`docs/analysis/discovery-method-regression-report.md` committed (`9faea93b7`); scoped gate run below.
